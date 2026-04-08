import type { InventoryCategory } from "@prisma/client";
import { existsSync } from "node:fs";
import { BarcodeFormat, BinaryBitmap, DecodeHintType, GlobalHistogramBinarizer, HybridBinarizer, MultiFormatReader, RGBLuminanceSource } from "@zxing/library";
import sharp from "sharp";
import { createWorker } from "tesseract.js";

import { inferCategorySuggestion } from "@/lib/inventory-intelligence";
import { suggestInventoryMatch } from "@/lib/inventory-receipt-intake-match";
import {
  buildImageOcrVariants,
  extractHeaderFields,
  extractLineCandidates,
  roundTo,
  scoreOcrCandidate
} from "@/lib/inventory-receipt-intake-ocr";
import {
  buildQrFailureResult,
  detectQrContentType,
  extractUrl,
  extractVerificationUrlCandidate,
  isTraVerificationUrl,
  mergeParsedFields,
  normalizeDecodedQrValue,
  parseGenericKeyValueText,
  parseQrFromUrl,
  parseQrKeyValueText,
  parseQrPayload,
  toUrl
} from "@/lib/inventory-receipt-intake-qr";
import { buildReceiptScanDiagnostics } from "@/lib/inventory-receipt-intake-payload";
import { detectReceiptType, resolveScanStatus } from "@/lib/inventory-receipt-intake-reconcile";
import {
  buildTraParseContext,
  countParsedFields,
  extractTraCriticalFields,
  extractTraLabelValuePairs,
  extractTraLineCandidates,
  mapTraLabelToField,
  normalizeTraFinancialFields,
  sanitizeTraFieldValue,
  selectBestTraFieldCandidates
} from "@/lib/inventory-receipt-intake-tra";
import {
  containsAny
} from "@/lib/inventory-receipt-intake-parse-utils";
import { resolveNextDistDir, resolveNextDistPath } from "@/lib/next-dist-dir";
import { debugLog } from "@/lib/observability";

export type ReceiptFieldConfidence = "HIGH" | "MEDIUM" | "LOW" | "NONE";
export type ReceiptLineConfidence = "HIGH" | "MEDIUM" | "LOW";
export type ReceiptFieldReadability = "HIGH" | "MEDIUM" | "LOW" | "UNREADABLE";
export type ReceiptFieldSource = "QR" | "OCR" | "DERIVED" | "NONE";
export type ReceiptScanStatus = "COMPLETE" | "PARTIAL" | "UNREADABLE";
export type ReceiptType = "INVENTORY_PURCHASE" | "GENERAL_EXPENSE" | "UNCLEAR";
export type ReceiptQrContentType = "TRA_URL" | "URL" | "STRUCTURED_TEXT" | "UNKNOWN" | "NONE";
export type ReceiptQrDecodeStatus = "DECODED" | "NOT_DETECTED" | "DECODE_FAILED";
export type ReceiptQrParseStatus = "PARSED" | "PARTIAL" | "UNPARSED";
export type ReceiptVerificationLookupStatus = "NOT_ATTEMPTED" | "SUCCESS" | "FAILED";
export type ReceiptScanFailureStage =
  | "NONE"
  | "QR_NOT_DETECTED"
  | "QR_DECODE_FAILED"
  | "QR_PARSE_UNPARSED"
  | "TRA_LOOKUP_FAILED";

export interface ReceiptQrStages {
  decode: {
    success: boolean;
    status: ReceiptQrDecodeStatus;
    pass: string;
    reason: string;
  };
  classification: {
    success: boolean;
    type: ReceiptQrContentType;
    isTraUrl: boolean;
  };
  verificationLookup: {
    attempted: boolean;
    success: boolean;
    status: ReceiptVerificationLookupStatus;
    reason: string;
    httpStatus: number | null;
    parsed: boolean;
    fieldsParseStatus: "NOT_ATTEMPTED" | "SUCCESS" | "PARTIAL" | "FAILED";
    lineItemsParseStatus: "NOT_ATTEMPTED" | "SUCCESS" | "PARTIAL" | "FAILED";
    parsedFieldCount: number;
    parsedLineItemsCount: number;
  };
}

interface TraLookupResult {
  attempted: boolean;
  success: boolean;
  status: ReceiptVerificationLookupStatus;
  reason: string;
  httpStatus: number | null;
  parsed: boolean;
  parsedFields: Partial<ReceiptHeaderExtraction>;
  parsedLineCandidates: ReceiptLineCandidate[];
  fieldsParseStatus: "NOT_ATTEMPTED" | "SUCCESS" | "PARTIAL" | "FAILED";
  lineItemsParseStatus: "NOT_ATTEMPTED" | "SUCCESS" | "PARTIAL" | "FAILED";
  parsedFieldCount: number;
  parsedLineItemsCount: number;
  debugRawTextPreview: string;
  debugFieldCandidates: Array<{ field: string; value: string; confidence: number; source: string }>;
}

export interface ReceiptQrAssistCrop {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ReceiptHeaderExtraction {
  supplierName: string;
  tin: string;
  vrn: string;
  serialNumber: string;
  receiptNumber: string;
  verificationCode: string;
  receiptDate: string;
  receiptTime: string;
  traReceiptNumber: string;
  invoiceReference: string;
  paymentMethod: string;
  taxOffice: string;
  currency: string;
  itemCount: number;
  subtotal: number;
  tax: number;
  total: number;
}

export interface ReceiptFieldConfidenceMap {
  supplierName: ReceiptFieldReadability;
  tin: ReceiptFieldReadability;
  vrn: ReceiptFieldReadability;
  serialNumber: ReceiptFieldReadability;
  receiptNumber: ReceiptFieldReadability;
  verificationCode: ReceiptFieldReadability;
  receiptDate: ReceiptFieldReadability;
  receiptTime: ReceiptFieldReadability;
  traReceiptNumber: ReceiptFieldReadability;
  invoiceReference: ReceiptFieldReadability;
  paymentMethod: ReceiptFieldReadability;
  taxOffice: ReceiptFieldReadability;
  currency: ReceiptFieldReadability;
  subtotal: ReceiptFieldReadability;
  tax: ReceiptFieldReadability;
  total: ReceiptFieldReadability;
  itemCount: ReceiptFieldReadability;
}

export interface ReceiptFieldSourceMap {
  supplierName: ReceiptFieldSource;
  tin: ReceiptFieldSource;
  vrn: ReceiptFieldSource;
  serialNumber: ReceiptFieldSource;
  receiptNumber: ReceiptFieldSource;
  verificationCode: ReceiptFieldSource;
  receiptDate: ReceiptFieldSource;
  receiptTime: ReceiptFieldSource;
  traReceiptNumber: ReceiptFieldSource;
  invoiceReference: ReceiptFieldSource;
  paymentMethod: ReceiptFieldSource;
  taxOffice: ReceiptFieldSource;
  currency: ReceiptFieldSource;
  subtotal: ReceiptFieldSource;
  tax: ReceiptFieldSource;
  total: ReceiptFieldSource;
  itemCount: ReceiptFieldSource;
}

export interface ReceiptQrResult {
  detected: boolean;
  rawValue: string;
  normalizedRawValue: string;
  contentType: ReceiptQrContentType;
  isTraVerification: boolean;
  isQrOnlyImage: boolean;
  decodeStatus: ReceiptQrDecodeStatus;
  decodePass: string;
  parseStatus: ReceiptQrParseStatus;
  failureReason: string;
  verificationUrl: string;
  parsedFields: Partial<ReceiptHeaderExtraction>;
  parsedLineCandidates: ReceiptLineCandidate[];
  confidence: ReceiptFieldReadability;
  warnings: string[];
  stages: ReceiptQrStages;
  debug?: {
    imageReceived: boolean;
    imageLoaded: boolean;
    attemptedPasses: string[];
    successfulPass: string;
    variantCount: number;
  };
}

export interface ReceiptScanDiagnostics {
  qrDetected: boolean;
  qrDecodeStatus: ReceiptQrDecodeStatus;
  qrDecodePass: string;
  qrParseStatus: ReceiptQrParseStatus;
  qrFailureReason: string;
  qrContentType: ReceiptQrContentType;
  qrRawValue: string;
  qrNormalizedRawValue: string;
  qrRawLength: number;
  qrRawPreview: string;
  qrRawPayloadFormat:
    | "EMPTY"
    | "URL"
    | "JSON"
    | "QUERY_STRING"
    | "KEY_VALUE"
    | "PERCENT_ENCODED"
    | "BASE64_LIKE"
    | "TEXT";
  qrVerificationUrl: string;
  qrIsTraVerification: boolean;
  qrParsedFieldCount: number;
  qrParsedLineItemsCount: number;
  qrLookupStatus: ReceiptVerificationLookupStatus;
  qrLookupReason: string;
  qrLookupHttpStatus: number | null;
  qrLookupParsed: boolean;
  ocrAttempted: boolean;
  ocrSucceeded: boolean;
  ocrError: string;
  scanStatus: ReceiptScanStatus;
  extractionMethod: string;
  returnedFrom: "qr_tra" | "qr_tra_plus_ocr";
  failureStage: ReceiptScanFailureStage;
}

export interface ReceiptLineMatchSuggestion {
  itemId: string | null;
  itemName: string | null;
  confidence: ReceiptFieldConfidence;
  score: number;
}

export interface ReceiptCategorySuggestion {
  category: InventoryCategory | null;
  confidence: ReceiptFieldConfidence;
  reason: string;
}

export interface ReceiptLineExtraction {
  id: string;
  description: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  extractionConfidence: ReceiptLineConfidence;
  matchSuggestion: ReceiptLineMatchSuggestion;
  categorySuggestion: ReceiptCategorySuggestion;
}

export interface ReceiptExtractionResult {
  header: ReceiptHeaderExtraction;
  fieldConfidence: ReceiptFieldConfidenceMap;
  fieldSource: ReceiptFieldSourceMap;
  lines: ReceiptLineExtraction[];
  warnings: string[];
  rawTextPreview: string;
  extractionMethod: "QR_ONLY" | "QR_PLUS_OCR" | "OCR_IMAGE_PREPROCESSED" | "OCR_IMAGE" | "PDF_TEXT" | "NONE";
  scanStatus: ReceiptScanStatus;
  receiptType: ReceiptType;
  preprocessingApplied: string[];
  qr: ReceiptQrResult;
  intakeDebug: {
    qrDecoded: boolean;
    traLookupSucceeded: boolean;
    traParseSucceeded: boolean;
    ocrAttempted: boolean;
    ocrSucceeded: boolean;
    ocrError: string;
    enrichmentWarning: string;
    returnedFrom: "qr_tra" | "qr_tra_plus_ocr";
    partialEnrichment: boolean;
  };
  scanDiagnostics: ReceiptScanDiagnostics;
  debug?: {
    ocrCandidates: Array<{
      label: string;
      confidence: number;
      score: number;
      textLength: number;
    }>;
  };
}

interface InventoryReferenceItem {
  id: string;
  name: string;
  sku: string;
  category: InventoryCategory;
}

export interface ReceiptLineCandidate {
  description: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  extractionConfidence: ReceiptLineConfidence;
}

export interface HeaderExtractionResult {
  header: ReceiptHeaderExtraction;
  fieldConfidence: ReceiptFieldConfidenceMap;
}

type QrDecoderFn = (
  data: Uint8ClampedArray,
  width: number,
  height: number,
  options?: { inversionAttempts?: "dontInvert" | "onlyInvert" | "attemptBoth" | "invertFirst" }
) => { data: string } | null;

interface QrDecoderStrategy {
  name: string;
  decode: (data: Uint8ClampedArray, width: number, height: number) => string | null;
}

let cachedQrDecoderStrategies: QrDecoderStrategy[] | undefined;

interface PdfParseInstance {
  getText: () => Promise<{ text?: string }>;
  destroy?: () => Promise<void> | void;
}

type PdfParseCtor = new (options: { data: Buffer }) => PdfParseInstance;

const PDF_MODULE_WARNING_PREFIX = "[PDF_MODULE_ERROR]";
const OCR_ENRICHMENT_TIMEOUT_MS = 4000;
const qrOcrCompletionFields: Array<keyof ReceiptHeaderExtraction> = [
  "supplierName",
  "tin",
  "vrn",
  "serialNumber",
  "receiptNumber",
  "verificationCode",
  "receiptDate",
  "receiptTime",
  "traReceiptNumber",
  "paymentMethod",
  "taxOffice",
  "subtotal",
  "tax",
  "total",
  "itemCount"
];

export async function extractReceiptData({
  fileBuffer,
  mimeType,
  fileName,
  inventoryItems,
  qrAssistCrop = null,
  debug = false
}: {
  fileBuffer: Buffer;
  mimeType: string;
  fileName: string;
  inventoryItems: InventoryReferenceItem[];
  qrAssistCrop?: ReceiptQrAssistCrop | null;
  debug?: boolean;
}): Promise<ReceiptExtractionResult> {
  const qrResult = await extractQrDataFromReceipt({ fileBuffer, mimeType, qrAssistCrop });
  const warnings: string[] = [];
  const verificationLookup = qrResult.stages.verificationLookup;
  const traLookupSucceeded =
    verificationLookup.attempted && verificationLookup.status === "SUCCESS" && verificationLookup.success;
  const traParseSucceeded =
    traLookupSucceeded &&
    (verificationLookup.parsed ||
      verificationLookup.parsedFieldCount > 0 ||
      verificationLookup.parsedLineItemsCount > 0);
  const missingFieldsBeforeOCR = listMissingHeaderFields(qrResult.parsedFields, qrOcrCompletionFields);
  if (process.env.NODE_ENV !== "production") {
    debugLog("[inventory][receipt-intake][merge]", {
      missingFieldsBeforeOCR
    });
  }
  const shouldRunOcrForCompletion = !qrResult.isQrOnlyImage && missingFieldsBeforeOCR.length > 0;
  const shouldRunOcrForReliability =
    !qrResult.isQrOnlyImage &&
    (!qrResult.detected ||
      qrResult.confidence !== "HIGH" ||
      !hasMeaningfulMetadataFromQr(qrResult.parsedFields));
  const shouldRunOcr = shouldRunOcrForCompletion || shouldRunOcrForReliability;
  let extraction: Awaited<ReturnType<typeof extractRawText>> | null = null;
  let ocrAttempted = false;
  let ocrSucceeded = false;
  let ocrError = "";
  if (shouldRunOcr) {
    ocrAttempted = true;
    if (process.env.NODE_ENV !== "production") {
      debugLog("[inventory][receipt-intake][postprocess]", {
        stage: "optional_postprocess_started",
        mode: "ocr"
      });
    }
    try {
      extraction = await extractRawText({
        fileBuffer,
        mimeType,
        timeoutMs: OCR_ENRICHMENT_TIMEOUT_MS
      });
      if (extraction.warning) {
        ocrError = extraction.warning;
        if (process.env.NODE_ENV !== "production") {
          debugLog("[inventory][receipt-intake][postprocess]", {
            stage: "enrichment_warning",
            mode: "ocr",
            reason: extraction.warning
          });
        }
      } else if (extraction.text.trim().length > 0) {
        ocrSucceeded = true;
      }
    } catch (error) {
      const reason = normalizeOcrEnrichmentError(error);
      ocrError = reason;
      if (process.env.NODE_ENV !== "production") {
        debugLog("[inventory][receipt-intake][postprocess]", {
          stage: "enrichment_warning",
          mode: "ocr",
          reason
        });
      }
    }
  }
  if (traParseSucceeded && ocrAttempted && !ocrSucceeded) {
    warnings.push("Core receipt data captured. Some optional details may need review.");
  } else if (ocrError) {
    warnings.push(`Optional enrichment needs review: ${ocrError}`);
  }

  const text = extraction?.text || "";

  if (!text.trim() && !qrResult.detected) {
    warnings.push("Capture quality is low and automatic text extraction returned limited data.");
  } else if (text.trim().length > 0 && text.trim().length < 40) {
    warnings.push("Extracted text is very limited. Please verify all fields carefully before saving.");
  }

  const ocrHeaderResult = text.trim()
    ? extractHeaderFields(text, fileName)
    : buildEmptyHeaderResult(fileName);
  const mergedHeaderResult = mergeHeaderResults({
    qrParsed: qrResult.parsedFields,
    ocrHeader: ocrHeaderResult.header,
    ocrConfidence: ocrHeaderResult.fieldConfidence
  });
  const ocrExtractedFields = text.trim()
    ? listReadableHeaderFields(ocrHeaderResult.header, ocrHeaderResult.fieldConfidence, qrOcrCompletionFields)
    : [];
  const mergedFinalFields = listPresentHeaderFields(mergedHeaderResult.header, qrOcrCompletionFields);
  const ocrFilledFields = missingFieldsBeforeOCR.filter(
    (field) => mergedHeaderResult.fieldSource[field] === "OCR" && hasHeaderFieldValue(mergedHeaderResult.header[field])
  );
  if (process.env.NODE_ENV !== "production") {
    debugLog("[inventory][receipt-intake][merge]", {
      ocrExtractedFields,
      mergedFinalFields
    });
  }
  const shouldSuppressLimitedQrWarnings =
    ocrFilledFields.length > 0 || (traParseSucceeded && ocrAttempted && !ocrSucceeded);
  const qrWarnings = qrResult.warnings.filter((warning) => {
    if (!shouldSuppressLimitedQrWarnings) {
      return true;
    }
    const lower = warning.toLowerCase();
    return !containsAny(lower, [
      "decoded with limited fields",
      "manual review is still required",
      "limited data",
      "ocr enrichment skipped"
    ]);
  });
  warnings.push(...qrWarnings);

  const header = mergedHeaderResult.header;
  const candidates = text.trim()
    ? extractLineCandidates(text)
    : qrResult.parsedLineCandidates.length > 0
      ? qrResult.parsedLineCandidates
      : [];
  if (candidates.length === 0) {
    warnings.push("No line items were detected automatically yet. Please add or confirm lines before saving.");
  }

  const lines = candidates.map((candidate, index) => {
    const matchSuggestion = suggestInventoryMatch(candidate.description, inventoryItems);
    const category = inferCategorySuggestion({
      name: candidate.description,
      existingItems: inventoryItems.map((item) => ({
        id: item.id,
        name: item.name,
        category: item.category
      }))
    });
    const categoryConfidence: ReceiptFieldConfidence =
      category.confidence === "HIGH"
        ? "HIGH"
        : category.confidence === "MEDIUM"
          ? "MEDIUM"
          : category.confidence === "LOW"
            ? "LOW"
            : "NONE";
    const allowAutoCategorySuggestion = categoryConfidence === "HIGH" || categoryConfidence === "MEDIUM";
    const safeSuggestedCategory = allowAutoCategorySuggestion ? category.suggestedCategory : null;
    const categoryReason = allowAutoCategorySuggestion
      ? category.reason
      : "Category confidence is low. Keep as Uncategorized or confirm manually before creating inventory.";

    return {
      id: `line-${index + 1}`,
      description: candidate.description,
      quantity: candidate.quantity,
      unitPrice: candidate.unitPrice,
      lineTotal: candidate.lineTotal,
      extractionConfidence: candidate.extractionConfidence,
      matchSuggestion,
      categorySuggestion: {
        category: safeSuggestedCategory,
        confidence: categoryConfidence,
        reason: categoryReason
      }
    };
  });

  if (lines.some((line) => line.extractionConfidence === "LOW")) {
    warnings.push("Some fields are low confidence. Review highlighted line items before confirming.");
  }

  const receiptType = detectReceiptType({ text, lines });
  if (receiptType === "UNCLEAR") {
    warnings.push("Receipt type is unclear. You can still save as expense evidence after review.");
  }
  if (lines.length === 0) {
    warnings.push("Line items were not detected automatically yet. Header fields were captured for review.");
  }

  const scanStatus = resolveScanStatus({
    text: text || qrResult.normalizedRawValue || qrResult.rawValue,
    lines,
    fieldConfidence: mergedHeaderResult.fieldConfidence,
    qr: qrResult
  });

  const extractionMethod = resolveExtractionMethod({
    qrDetected: qrResult.detected,
    ocrMethod: extraction?.method ?? "NONE"
  });
  const preprocessingApplied = extraction?.preprocessingApplied || [];
  const rawTextPreview = text.slice(0, 6000);
  const returnedFrom: "qr_tra" | "qr_tra_plus_ocr" = ocrSucceeded ? "qr_tra_plus_ocr" : "qr_tra";
  const partialEnrichment = traParseSucceeded && ocrAttempted && !ocrSucceeded;
  const enrichmentWarning =
    traParseSucceeded && ocrAttempted && !ocrSucceeded
      ? "Core receipt data captured. Some optional details may need review."
      : ocrError
        ? `Optional enrichment needs review: ${ocrError}`
        : "";
  const intakeDebug = {
    qrDecoded: qrResult.decodeStatus === "DECODED",
    traLookupSucceeded,
    traParseSucceeded,
    ocrAttempted,
    ocrSucceeded,
    ocrError,
    enrichmentWarning,
    returnedFrom,
    partialEnrichment
  };
  const scanDiagnostics = buildReceiptScanDiagnostics({
    qrResult,
    intakeDebug,
    scanStatus,
    extractionMethod
  });

  return {
    header,
    fieldConfidence: mergedHeaderResult.fieldConfidence,
    fieldSource: mergedHeaderResult.fieldSource,
    lines,
    warnings: Array.from(new Set(warnings)),
    rawTextPreview,
    extractionMethod,
    scanStatus,
    receiptType,
    preprocessingApplied,
    qr: qrResult,
    intakeDebug,
    scanDiagnostics,
    debug:
      debug && extraction && extraction.debugCandidates.length > 0
        ? {
            ocrCandidates: extraction.debugCandidates
          }
        : undefined
  };
}

export async function extractQrDataOnly({
  fileBuffer,
  mimeType,
  qrAssistCrop = null
}: {
  fileBuffer: Buffer;
  mimeType: string;
  qrAssistCrop?: ReceiptQrAssistCrop | null;
}) {
  return extractQrDataFromReceipt({
    fileBuffer,
    mimeType,
    qrAssistCrop,
    mode: "decode-only"
  });
}

async function extractRawText({
  fileBuffer,
  mimeType,
  timeoutMs = OCR_ENRICHMENT_TIMEOUT_MS
}: {
  fileBuffer: Buffer;
  mimeType: string;
  timeoutMs?: number;
}) {
  if (mimeType.includes("pdf")) {
    const parsed = await parsePdfTextSafely(fileBuffer, "ocr");
    if (parsed.ok) {
      return {
        text: parsed.text,
        method: "PDF_TEXT" as const,
        preprocessingApplied: [] as string[],
        warning: "",
        debugCandidates: [] as Array<{
          label: string;
          confidence: number;
          score: number;
          textLength: number;
        }>
      };
    }
    return {
      text: "",
      method: "NONE" as const,
      preprocessingApplied: [] as string[],
      warning: parsed.message || "PDF OCR text extraction unavailable.",
      debugCandidates: [] as Array<{
        label: string;
        confidence: number;
        score: number;
        textLength: number;
      }>
    };
  }

  const variants = await buildImageOcrVariants(fileBuffer);
  if (variants.length === 0) {
    return {
      text: "",
      method: "NONE" as const,
      preprocessingApplied: [] as string[],
      warning: "Image OCR preprocessing produced no usable variants.",
      debugCandidates: [] as Array<{
        label: string;
        confidence: number;
        score: number;
        textLength: number;
      }>
    };
  }

  if (!isTesseractWorkerLikelyAvailable()) {
    return {
      text: "",
      method: "NONE" as const,
      preprocessingApplied: [] as string[],
      warning:
        `OCR enrichment worker module is unavailable (${resolveNextDistDir()}/worker-script/node/index.js). Skipping optional OCR enrichment.`,
      debugCandidates: [] as Array<{
        label: string;
        confidence: number;
        score: number;
        textLength: number;
      }>
    };
  }

  try {
    const worker = await createWorker("eng");
    const startedAt = Date.now();
    let timedOut = false;
    const candidates: Array<{
      label: string;
      text: string;
      confidence: number;
      score: number;
      textLength: number;
      preprocessingApplied: string[];
    }> = [];

    for (const variant of variants) {
      const remainingMs = timeoutMs - (Date.now() - startedAt);
      if (remainingMs <= 0) {
        timedOut = true;
        break;
      }
      try {
        const result = await withTimeout(
          worker.recognize(variant.buffer),
          remainingMs,
          `OCR enrichment timed out after ${timeoutMs}ms`
        );
        const text = (result.data.text || "").trim();
        const confidence = Number(result.data.confidence || 0);
        const score = scoreOcrCandidate(text, confidence);
        candidates.push({
          label: variant.label,
          text,
          confidence: roundTo(confidence, 2),
          score: roundTo(score, 3),
          textLength: text.length,
          preprocessingApplied: variant.preprocessingApplied
        });
      } catch (error) {
        const reason = normalizeOcrEnrichmentError(error);
        if (reason.toLowerCase().includes("timed out")) {
          timedOut = true;
          break;
        }
        candidates.push({
          label: variant.label,
          text: "",
          confidence: 0,
          score: 0,
          textLength: 0,
          preprocessingApplied: variant.preprocessingApplied
        });
      }
    }

    await worker.terminate().catch(() => undefined);

    if (timedOut) {
      return {
        text: "",
        method: "NONE" as const,
        preprocessingApplied: [] as string[],
        warning: `OCR enrichment timed out after ${timeoutMs}ms`,
        debugCandidates: candidates.map((candidate) => ({
          label: candidate.label,
          confidence: candidate.confidence,
          score: candidate.score,
          textLength: candidate.textLength
        }))
      };
    }

    const best = [...candidates].sort((a, b) => b.score - a.score)[0];
    if (!best || !best.text) {
      return {
        text: "",
        method: "NONE" as const,
        preprocessingApplied: [] as string[],
        warning: "OCR did not return readable text from processed variants.",
        debugCandidates: candidates.map((candidate) => ({
          label: candidate.label,
          confidence: candidate.confidence,
          score: candidate.score,
          textLength: candidate.textLength
        }))
      };
    }

    const usedPreprocessing = best.preprocessingApplied.filter((step) => step !== "original");
    return {
      text: best.text,
      method: usedPreprocessing.length > 0 ? ("OCR_IMAGE_PREPROCESSED" as const) : ("OCR_IMAGE" as const),
      preprocessingApplied: usedPreprocessing,
      warning: "",
      debugCandidates: candidates.map((candidate) => ({
        label: candidate.label,
        confidence: candidate.confidence,
        score: candidate.score,
        textLength: candidate.textLength
      }))
    };
  } catch (error) {
    const reason = normalizeOcrEnrichmentError(error);
    return {
      text: "",
      method: "NONE" as const,
      preprocessingApplied: [] as string[],
      warning: reason,
      debugCandidates: [] as Array<{
        label: string;
        confidence: number;
        score: number;
        textLength: number;
      }>
    };
  }
}

function isTesseractWorkerLikelyAvailable() {
  const workerPath = resolveNextDistPath("worker-script", "node", "index.js");
  return existsSync(workerPath);
}

function normalizeOcrEnrichmentError(error: unknown) {
  const reason = error instanceof Error ? error.message : "Optional OCR enrichment failed.";
  if (reason.includes("/worker-script/node/index.js")) {
    return "OCR enrichment worker module is unavailable (dist worker-script path missing).";
  }
  return reason;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, timeoutMessage: string): Promise<T> {
  let timeoutHandle: NodeJS.Timeout | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutHandle = setTimeout(() => {
          reject(new Error(timeoutMessage));
        }, timeoutMs);
      })
    ]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}

async function parsePdfTextSafely(
  fileBuffer: Buffer,
  context: "qr" | "ocr"
): Promise<{ ok: true; text: string } | { ok: false; message: string }> {
  try {
    const parserCtor = await loadPdfParserCtor();
    if (!parserCtor) {
      const message = "PDF parser module could not be loaded.";
      if (process.env.NODE_ENV !== "production") {
        debugLog("[inventory][receipt-intake][pdf][error]", {
          stage: "module_import",
          context,
          message
        });
      }
      return {
        ok: false,
        message
      };
    }

    const parser = new parserCtor({ data: fileBuffer });
    const parsed = await parser.getText();
    if (typeof parser.destroy === "function") {
      await parser.destroy();
    }
    return {
      ok: true,
      text: parsed.text || ""
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "PDF parsing failed.";
    if (process.env.NODE_ENV !== "production") {
      debugLog("[inventory][receipt-intake][pdf][error]", {
        stage: "parse",
        context,
        message
      });
    }
    return {
      ok: false,
      message
    };
  }
}

async function loadPdfParserCtor(): Promise<PdfParseCtor | null> {
  try {
    const pdfModule = await import("pdf-parse");
    const candidate = ("PDFParse" in pdfModule ? pdfModule.PDFParse : null) as unknown;
    if (typeof candidate === "function") {
      return candidate as PdfParseCtor;
    }
    return null;
  } catch {
    return null;
  }
}

async function extractQrDataFromReceipt({
  fileBuffer,
  mimeType,
  qrAssistCrop = null,
  mode = "full"
}: {
  fileBuffer: Buffer;
  mimeType: string;
  qrAssistCrop?: ReceiptQrAssistCrop | null;
  mode?: "full" | "decode-only";
}): Promise<ReceiptQrResult> {
  if (process.env.NODE_ENV !== "production") {
    debugLog("[inventory][receipt-intake][qr][stage]", {
      stage: "image_received",
      mimeType,
      fileBytes: fileBuffer.length
    });
  }
  if (mimeType.includes("pdf")) {
    const parsedPdf = await parsePdfTextSafely(fileBuffer, "qr");
    if (parsedPdf.ok) {
      const maybeUrl = extractUrl(parsedPdf.text);
      if (maybeUrl) {
        return resolveQrDecodedResult({
          rawValue: maybeUrl,
          decodePass: "pdf-text-url",
          attemptedPasses: ["pdf-text-url"],
          variantCount: 1,
          mode
        });
      }
      if (containsAny(parsedPdf.text.toLowerCase(), ["verification", "receipt", "tin", "vat"])) {
        return resolveQrDecodedResult({
          rawValue: parsedPdf.text,
          decodePass: "pdf-text-structured",
          attemptedPasses: ["pdf-text-structured"],
          variantCount: 1,
          mode
        });
      }
      return buildQrFailureResult({
        decodeStatus: "NOT_DETECTED",
        failureReason: "No QR detected",
        warnings: ["QR not detected in the uploaded document. Continuing with OCR fallback."],
        imageLoaded: true,
        attemptedPasses: ["pdf-text"],
        variantCount: 1
      });
    }
    const pdfWarning = `${PDF_MODULE_WARNING_PREFIX} ${parsedPdf.message || "PDF parser unavailable."}`;
    return buildQrFailureResult({
      decodeStatus: "NOT_DETECTED",
      failureReason: "No QR detected",
      warnings: [pdfWarning, "Unable to decode QR from PDF. Try exporting the receipt as an image."],
      imageLoaded: false,
      attemptedPasses: ["pdf-text"],
      variantCount: 1
    });
  }

  try {
    const image = sharp(fileBuffer, { failOn: "none" }).rotate();
    const metadata = await image.metadata();
    const isQrOnlyCandidate = Boolean(
      metadata.width && metadata.height && looksLikeQrOnlyImage(metadata.width, metadata.height)
    );
    if (!metadata.width || !metadata.height) {
      return buildQrFailureResult({
        decodeStatus: "NOT_DETECTED",
        failureReason: "No QR detected",
        warnings: ["QR not detected. Continuing with OCR fallback."],
        imageLoaded: false,
        isQrOnlyImage: isQrOnlyCandidate
      });
    }

    const qrVariants = await buildQrDetectionVariants({
      image,
      width: metadata.width,
      height: metadata.height,
      qrAssistCrop
    });
    if (process.env.NODE_ENV !== "production") {
      debugLog("[inventory][receipt-intake][qr][stage]", {
        stage: "image_loaded",
        width: metadata.width,
        height: metadata.height,
        isQrOnlyCandidate
      });
      debugLog("[inventory][receipt-intake][qr][stage]", {
        stage: "preprocessing_applied",
        variantCount: qrVariants.length,
        samplePasses: qrVariants.slice(0, 8).map((variant) => variant.label)
      });
    }
    const decoderStrategies = await getQrDecoderStrategies();
    if (decoderStrategies.length === 0) {
      return buildQrFailureResult({
        decodeStatus: "DECODE_FAILED",
        failureReason: "QR detected but decode failed",
        warnings: ["QR decoder is unavailable. Continuing with OCR fallback."],
        isQrOnlyImage: isQrOnlyCandidate,
        attemptedPasses: qrVariants.map((variant) => variant.label).slice(0, 100),
        variantCount: qrVariants.length
      });
    }
    if (process.env.NODE_ENV !== "production") {
      debugLog("[inventory][receipt-intake][qr][decode]", {
        stage: "decode_started",
        decoderStrategies: decoderStrategies.map((strategy) => strategy.name),
        variantCount: qrVariants.length
      });
    }

    const attemptLabels: string[] = [];
    for (const variant of qrVariants) {
      for (const decoderStrategy of decoderStrategies) {
        const attemptLabel = `${variant.label}|${decoderStrategy.name}`;
        attemptLabels.push(attemptLabel);
        const decodedRaw = decoderStrategy.decode(variant.data, variant.width, variant.height);
        if (!decodedRaw) {
          continue;
        }
        const parsedResult = await resolveQrDecodedResult({
          rawValue: decodedRaw,
          decodePass: attemptLabel,
          isQrOnlyImage: isQrOnlyCandidate,
          attemptedPasses: attemptLabels,
          variantCount: qrVariants.length,
          mode
        });
        if (process.env.NODE_ENV !== "production") {
          debugLog("[inventory][receipt-intake][qr][decode]", {
            stage: "decode_result",
            detected: true,
            pass: attemptLabel,
            decoder: decoderStrategy.name,
            rawQrContent: truncateQrLogValue(decodedRaw)
          });
        }
        return parsedResult;
      }
    }

    const likelyQrRegion =
      isValidQrAssistCrop(qrAssistCrop) || isQrOnlyCandidate;
    const decodeStatus: ReceiptQrDecodeStatus = likelyQrRegion ? "DECODE_FAILED" : "NOT_DETECTED";
    const failureMessage =
      decodeStatus === "DECODE_FAILED"
        ? "QR detected but could not be decoded. Try a clearer crop or continue manually."
        : "QR not detected. Continuing with OCR fallback.";
    if (process.env.NODE_ENV !== "production") {
      debugLog("[inventory][receipt-intake][qr][decode]", {
        stage: "decode_result",
        detected: false,
        decodeStatus,
        attemptedPasses: attemptLabels.slice(0, 50),
        decoderStrategies: decoderStrategies.map((strategy) => strategy.name)
      });
    }

    return buildQrFailureResult({
      decodeStatus,
      failureReason: decodeStatus === "DECODE_FAILED" ? "QR detected but decode failed" : "No QR detected",
      isQrOnlyImage: isQrOnlyCandidate,
      attemptedPasses: attemptLabels,
      variantCount: qrVariants.length,
      warnings: isValidQrAssistCrop(qrAssistCrop)
        ? ["Manual QR area could not be decoded. Continuing with OCR fallback.", failureMessage]
        : [failureMessage]
    });
  } catch {
    return buildQrFailureResult({
      decodeStatus: "DECODE_FAILED",
      failureReason: "QR detected but decode failed",
      warnings: ["QR detected but could not be decoded. Continuing with OCR fallback."],
      imageLoaded: false
    });
  }
}

async function resolveQrDecodedResult({
  rawValue,
  decodePass,
  isQrOnlyImage = false,
  attemptedPasses = [],
  variantCount = 0,
  mode
}: {
  rawValue: string;
  decodePass: string;
  isQrOnlyImage?: boolean;
  attemptedPasses?: string[];
  variantCount?: number;
  mode: "full" | "decode-only";
}) {
  logDecodedRawPayload(rawValue, decodePass);
  if (mode === "decode-only") {
    return buildDecodeOnlyQrResult({
      rawValue,
      decodePass,
      isQrOnlyImage,
      attemptedPasses,
      variantCount
    });
  }

  return finalizeQrResult(
    parseQrPayload(rawValue, {
      decodePass,
      isQrOnlyImage,
      attemptedPasses,
      variantCount
    })
  );
}

function logDecodedRawPayload(rawValue: string, decodePass: string) {
  const exactRaw = typeof rawValue === "string" ? rawValue : "";
  const preview = truncateQrLogValue(exactRaw, 200);
  debugLog("[inventory][receipt-intake][qr][raw-decoder]", {
    detected: true,
    decodeSucceeded: exactRaw.length > 0,
    decodePass: decodePass || "unknown",
    rawLength: exactRaw.length,
    rawPreview: preview
  });
}

function buildDecodeOnlyQrResult({
  rawValue,
  decodePass,
  isQrOnlyImage,
  attemptedPasses,
  variantCount
}: {
  rawValue: string;
  decodePass: string;
  isQrOnlyImage: boolean;
  attemptedPasses: string[];
  variantCount: number;
}): ReceiptQrResult {
  const rawDecodedValue = typeof rawValue === "string" ? rawValue : "";
  const normalizedRaw = normalizeDecodedQrValue(rawDecodedValue);
  const contentType = detectQrContentType(normalizedRaw);
  const verificationUrl =
    contentType === "URL"
      ? toUrl(normalizedRaw)?.toString() || ""
      : extractVerificationUrlCandidate(normalizedRaw);
  const isTraVerification = isTraVerificationUrl(verificationUrl);
  const classifiedType: ReceiptQrContentType =
    contentType === "URL" && isTraVerification ? "TRA_URL" : contentType;

  return {
    detected: true,
    rawValue: rawDecodedValue,
    normalizedRawValue: normalizedRaw,
    contentType: classifiedType,
    isTraVerification,
    isQrOnlyImage,
    decodeStatus: "DECODED",
    decodePass,
    parseStatus: "UNPARSED",
    failureReason: "",
    verificationUrl,
    parsedFields: {},
    parsedLineCandidates: [],
    confidence: "LOW",
    warnings: ["Decode-only mode: receipt parsing was skipped."],
    stages: {
      decode: {
        success: true,
        status: "DECODED",
        pass: decodePass,
        reason: ""
      },
      classification: {
        success: true,
        type: classifiedType,
        isTraUrl: isTraVerification
      },
      verificationLookup: {
        attempted: false,
        success: false,
        status: "NOT_ATTEMPTED",
        reason: "Decode-only mode",
        httpStatus: null,
        parsed: false,
        fieldsParseStatus: "NOT_ATTEMPTED",
        lineItemsParseStatus: "NOT_ATTEMPTED",
        parsedFieldCount: 0,
        parsedLineItemsCount: 0
      }
    },
    debug: {
      imageReceived: true,
      imageLoaded: true,
      attemptedPasses,
      successfulPass: decodePass,
      variantCount
    }
  };
}

async function finalizeQrResult(qrResult: ReceiptQrResult): Promise<ReceiptQrResult> {
  if (!qrResult.detected || !qrResult.isTraVerification || !qrResult.verificationUrl) {
    return qrResult;
  }

  const lookup = await attemptTraVerificationLookup(qrResult.verificationUrl);
  const mergedParsedFields = mergeParsedFields(qrResult.parsedFields, lookup.parsedFields);
  const mergedWarnings = Array.from(
    new Set([
      ...qrResult.warnings,
      lookup.status === "FAILED" ? "TRA verification lookup returned limited data and needs review." : "",
      lookup.success && !lookup.parsed
        ? "TRA verification lookup succeeded, but parsing returned limited fields."
        : "",
      lookup.status === "SUCCESS" && lookup.fieldsParseStatus === "PARTIAL"
        ? "TRA fields were parsed partially. Please review mapped values."
        : "",
      lookup.status === "SUCCESS" && lookup.lineItemsParseStatus === "FAILED"
        ? "TRA line items were not detected automatically. Add or confirm line items manually."
        : ""
    ].filter(Boolean))
  );

  return {
    ...qrResult,
    parsedFields: mergedParsedFields,
    parsedLineCandidates:
      lookup.parsedLineCandidates.length > 0 ? lookup.parsedLineCandidates : qrResult.parsedLineCandidates,
    warnings: mergedWarnings,
    stages: {
      ...qrResult.stages,
      verificationLookup: {
        attempted: lookup.attempted,
        success: lookup.success,
        status: lookup.status,
        reason: lookup.reason,
        httpStatus: lookup.httpStatus,
        parsed: lookup.parsed,
        fieldsParseStatus: lookup.fieldsParseStatus,
        lineItemsParseStatus: lookup.lineItemsParseStatus,
        parsedFieldCount: lookup.parsedFieldCount,
        parsedLineItemsCount: lookup.parsedLineItemsCount
      }
    }
  };
}

async function attemptTraVerificationLookup(url: string): Promise<TraLookupResult> {
  const target = toUrl(url);
  if (!target || !isTraVerificationUrl(url)) {
    return {
      attempted: false,
      success: false,
      status: "NOT_ATTEMPTED",
      reason: "",
      httpStatus: null,
      parsed: false,
      parsedFields: {},
      parsedLineCandidates: [],
      fieldsParseStatus: "NOT_ATTEMPTED",
      lineItemsParseStatus: "NOT_ATTEMPTED",
      parsedFieldCount: 0,
      parsedLineItemsCount: 0,
      debugRawTextPreview: "",
      debugFieldCandidates: []
    };
  }

  try {
    if (process.env.NODE_ENV !== "production") {
      debugLog("[inventory][receipt-intake][tra-lookup][request]", { url: target.toString() });
    }
    const renderedLookup = await fetchTraRenderedHtml(target.toString());
    const body = renderedLookup.html;
    const parsedLookup = parseTraLookupResponse({ url: target, body });
    const parsedFields = parsedLookup.parsedFields;
    const parsedCount = countParsedFields(parsedFields);
    const parsed = parsedCount > 0;
    const success = renderedLookup.ok;
    const reason = success
      ? parsed
        ? ""
        : "Lookup response could not be parsed"
      : renderedLookup.error || `Lookup failed with status ${renderedLookup.httpStatus ?? "unknown"}`;

    if (process.env.NODE_ENV !== "production") {
      debugLog("[inventory][receipt-intake][tra-lookup][response]", {
        status: renderedLookup.httpStatus,
        ok: renderedLookup.ok,
        source: renderedLookup.source,
        htmlLength: body.length,
        containsReceipt: renderedLookup.containsReceipt,
        containsTin: renderedLookup.containsTin,
        containsPurchasedItems: renderedLookup.containsPurchasedItems,
        parsed,
        parsedCount,
        lineItems: parsedLookup.parsedLineCandidates.length,
        fieldsParseStatus: parsedLookup.fieldsParseStatus,
        lineItemsParseStatus: parsedLookup.lineItemsParseStatus
      });
      debugLog("[inventory][receipt-intake][tra-lookup][mapped-fields]", parsedFields);
      if (parsedLookup.debugRawTextPreview) {
        debugLog("[inventory][receipt-intake][tra-lookup][raw-text-preview]", {
          preview: parsedLookup.debugRawTextPreview
        });
      }
      if (parsedLookup.debugFieldCandidates.length > 0) {
        debugLog("[inventory][receipt-intake][tra-lookup][field-candidates]", {
          candidates: parsedLookup.debugFieldCandidates.slice(0, 20)
        });
      }
    }

    return {
      attempted: true,
      success,
      status: success ? "SUCCESS" : "FAILED",
      reason,
      httpStatus: renderedLookup.httpStatus,
      parsed,
      parsedFields,
      parsedLineCandidates: parsedLookup.parsedLineCandidates,
      fieldsParseStatus: parsedLookup.fieldsParseStatus,
      lineItemsParseStatus: parsedLookup.lineItemsParseStatus,
      parsedFieldCount: parsedCount,
      parsedLineItemsCount: parsedLookup.parsedLineCandidates.length,
      debugRawTextPreview: parsedLookup.debugRawTextPreview,
      debugFieldCandidates: parsedLookup.debugFieldCandidates
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Lookup request failed";
    if (process.env.NODE_ENV !== "production") {
      debugLog("[inventory][receipt-intake][tra-lookup][error]", { reason });
    }
    return {
      attempted: true,
      success: false,
      status: "FAILED",
      reason,
      httpStatus: null,
      parsed: false,
      parsedFields: {},
      parsedLineCandidates: [],
      fieldsParseStatus: "FAILED",
      lineItemsParseStatus: "FAILED",
      parsedFieldCount: 0,
      parsedLineItemsCount: 0,
      debugRawTextPreview: "",
      debugFieldCandidates: []
    };
  }
}

async function fetchTraRenderedHtml(url: string): Promise<{
  ok: boolean;
  httpStatus: number | null;
  html: string;
  source: "playwright" | "fetch-fallback";
  containsReceipt: boolean;
  containsTin: boolean;
  containsPurchasedItems: boolean;
  error: string;
}> {
  const fallbackFetch = async (reason: string) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    try {
      const response = await fetch(url, {
        method: "GET",
        signal: controller.signal
      });
      const html = await response.text().catch(() => "");
      const metrics = buildTraHtmlKeywordMetrics(html);
      if (process.env.NODE_ENV !== "production") {
        debugLog("[inventory][receipt-intake][tra-lookup][fetch-fallback]", {
          reason,
          status: response.status,
          ok: response.ok,
          htmlLength: html.length,
          ...metrics
        });
      }
      return {
        ok: response.ok,
        httpStatus: response.status,
        html,
        source: "fetch-fallback" as const,
        containsReceipt: metrics.containsReceipt,
        containsTin: metrics.containsTin,
        containsPurchasedItems: metrics.containsPurchasedItems,
        error: reason
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : reason;
      return {
        ok: false,
        httpStatus: null,
        html: "",
        source: "fetch-fallback" as const,
        containsReceipt: false,
        containsTin: false,
        containsPurchasedItems: false,
        error: message
      };
    } finally {
      clearTimeout(timeout);
    }
  };

  try {
    const playwrightModule = await import("playwright");
    const chromium = playwrightModule.chromium;
    if (!chromium) {
      return fallbackFetch("Playwright chromium is unavailable.");
    }

    const browser = await chromium.launch({
      headless: true
    });
    try {
      const page = await browser.newPage();
      const response = await page.goto(url, {
        waitUntil: "networkidle",
        timeout: 15000
      });
      await page.waitForSelector("body", {
        timeout: 5000
      });
      await page
        .waitForFunction(
          () => {
            const text = (document.body?.innerText || "").toUpperCase();
            return text.includes("RECEIPT") || text.includes("TIN") || text.includes("PURCHASED ITEMS");
          },
          { timeout: 7000 }
        )
        .catch(() => null);

      const html = await page.content();
      const status = response?.status() ?? null;
      const ok = response ? response.ok() : true;
      const metrics = buildTraHtmlKeywordMetrics(html);

      if (process.env.NODE_ENV !== "production") {
        debugLog("[inventory][receipt-intake][tra-lookup][playwright-rendered]", {
          status,
          ok,
          htmlLength: html.length,
          ...metrics
        });
      }

      return {
        ok,
        httpStatus: status,
        html,
        source: "playwright" as const,
        containsReceipt: metrics.containsReceipt,
        containsTin: metrics.containsTin,
        containsPurchasedItems: metrics.containsPurchasedItems,
        error: ""
      };
    } finally {
      await browser.close();
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Playwright rendering failed before lookup parsing.";
    if (process.env.NODE_ENV !== "production") {
      debugLog("[inventory][receipt-intake][tra-lookup][playwright-error]", { reason: message });
    }
    return fallbackFetch(message);
  }
}

function buildTraHtmlKeywordMetrics(html: string) {
  const upper = html.toUpperCase();
  return {
    containsReceipt: upper.includes("RECEIPT"),
    containsTin: upper.includes("TIN"),
    containsPurchasedItems: upper.includes("PURCHASED ITEMS")
  };
}

function parseTraLookupResponse({
  url,
  body
}: {
  url: URL;
  body: string;
}) {
  const parseContext = buildTraParseContext(body);
  const text = parseContext.selectedText;
  const lineCandidates = extractTraLineCandidates(parseContext.selectedHtml, text);
  const fieldCandidates: Array<{ field: keyof ReceiptHeaderExtraction; value: string | number; confidence: number; source: string }> =
    [];

  const fromUrl = parseQrFromUrl(url);
  for (const [field, value] of Object.entries(fromUrl)) {
    if (typeof value === "string" && value.trim()) {
      fieldCandidates.push({
        field: field as keyof ReceiptHeaderExtraction,
        value: value.trim(),
        confidence: 0.55,
        source: "url-query"
      });
      continue;
    }
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      fieldCandidates.push({
        field: field as keyof ReceiptHeaderExtraction,
        value,
        confidence: 0.55,
        source: "url-query"
      });
    }
  }

  const labelPairs = extractTraLabelValuePairs(parseContext.selectedHtml, text);
  for (const pair of labelPairs) {
    const mappedField = mapTraLabelToField(pair.label);
    if (!mappedField) {
      continue;
    }
    const sanitized = sanitizeTraFieldValue(mappedField, pair.value, pair.label);
    if (sanitized === null) {
      continue;
    }
    fieldCandidates.push({
      field: mappedField,
      value: sanitized,
      confidence: pair.confidence,
      source: pair.source
    });
  }

  const fromBodyStructured = parseQrKeyValueText(text);
  for (const [field, value] of Object.entries(fromBodyStructured)) {
    const sanitized = sanitizeTraFieldValue(
      field as keyof ReceiptHeaderExtraction,
      value as string | number,
      field
    );
    if (sanitized === null) {
      continue;
    }
    fieldCandidates.push({
      field: field as keyof ReceiptHeaderExtraction,
      value: sanitized,
      confidence: 0.5,
      source: "structured-text"
    });
  }

  const fromBodyGeneric = parseGenericKeyValueText(text);
  for (const [field, value] of Object.entries(fromBodyGeneric)) {
    const sanitized = sanitizeTraFieldValue(
      field as keyof ReceiptHeaderExtraction,
      value as string | number,
      field
    );
    if (sanitized === null) {
      continue;
    }
    fieldCandidates.push({
      field: field as keyof ReceiptHeaderExtraction,
      value: sanitized,
      confidence: 0.4,
      source: "generic-text"
    });
  }

  const criticalFields = extractTraCriticalFields({
    selectedText: text,
    fullText: parseContext.fullText,
    selectedHtml: parseContext.selectedHtml,
    fullHtml: body
  });
  if (criticalFields.supplierName) {
    fieldCandidates.push({
      field: "supplierName",
      value: criticalFields.supplierName,
      confidence: 0.92,
      source: "critical-fallback"
    });
  }
  if (criticalFields.verificationCode) {
    fieldCandidates.push({
      field: "verificationCode",
      value: criticalFields.verificationCode,
      confidence: 0.93,
      source: "critical-fallback"
    });
  }

  const parsedFields = selectBestTraFieldCandidates(fieldCandidates);
  const parsedFieldCount = countParsedFields(parsedFields);
  if (parsedFieldCount < 3 && parseContext.selectedText !== parseContext.fullText) {
    const fallbackStructured = parseQrKeyValueText(parseContext.fullText);
    for (const [field, value] of Object.entries(fallbackStructured)) {
      const sanitized = sanitizeTraFieldValue(
        field as keyof ReceiptHeaderExtraction,
        value as string | number,
        field
      );
      if (sanitized === null) {
        continue;
      }
      fieldCandidates.push({
        field: field as keyof ReceiptHeaderExtraction,
        value: sanitized,
        confidence: 0.45,
        source: "fallback-structured-text"
      });
    }
    const fallbackGeneric = parseGenericKeyValueText(parseContext.fullText);
    for (const [field, value] of Object.entries(fallbackGeneric)) {
      const sanitized = sanitizeTraFieldValue(
        field as keyof ReceiptHeaderExtraction,
        value as string | number,
        field
      );
      if (sanitized === null) {
        continue;
      }
      fieldCandidates.push({
        field: field as keyof ReceiptHeaderExtraction,
        value: sanitized,
        confidence: 0.35,
        source: "fallback-generic-text"
      });
    }
  }
  const resolvedFields = selectBestTraFieldCandidates(fieldCandidates);
  const financiallyNormalizedFields = normalizeTraFinancialFields(resolvedFields);
  const resolvedParsedFieldCount = countParsedFields(financiallyNormalizedFields);
  const fieldsParseStatus: "NOT_ATTEMPTED" | "SUCCESS" | "PARTIAL" | "FAILED" =
    resolvedParsedFieldCount >= 8 ? "SUCCESS" : resolvedParsedFieldCount >= 3 ? "PARTIAL" : "FAILED";
  const lineItemsParseStatus: "NOT_ATTEMPTED" | "SUCCESS" | "PARTIAL" | "FAILED" =
    lineCandidates.length > 0 ? "SUCCESS" : "FAILED";

  if (process.env.NODE_ENV !== "production") {
    debugLog("[inventory][receipt-intake][tra-lookup][html-structure]", parseContext.structureSummary);
    debugLog("[inventory][receipt-intake][tra-lookup][selected-container]", {
      source: parseContext.selectedSource,
      score: parseContext.selectedScore,
      keywordHits: parseContext.selectedKeywordHits,
      preview: parseContext.selectedHtml.slice(0, 1200)
    });
    debugLog("[inventory][receipt-intake][tra-lookup][candidate-summary]", {
      candidates: parseContext.candidateSummaries.slice(0, 8)
    });
    debugLog("[inventory][receipt-intake][tra-lookup][parsed-summary]", {
      parsedFieldCount: resolvedParsedFieldCount,
      parsedLineItemsCount: lineCandidates.length,
      fieldsParseStatus,
      lineItemsParseStatus
    });
  }

  return {
    parsedFields: financiallyNormalizedFields,
    parsedLineCandidates: lineCandidates,
    fieldsParseStatus,
    lineItemsParseStatus,
    debugRawTextPreview: text.slice(0, 1200),
    debugFieldCandidates: fieldCandidates
      .slice(0, 60)
      .map((candidate) => ({
        field: candidate.field,
        value: String(candidate.value),
        confidence: roundTo(candidate.confidence, 2),
        source: candidate.source
      }))
  };
}

function createZxingDecoderStrategy(): QrDecoderStrategy | null {
  try {
    const hints = new Map();
    hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.QR_CODE]);
    hints.set(DecodeHintType.TRY_HARDER, true);

    const decodeWithBinarizer = (
      data: Uint8ClampedArray,
      width: number,
      height: number,
      useGlobalBinarizer = false
    ) => {
      const source = new RGBLuminanceSource(data, width, height);
      const bitmap = new BinaryBitmap(
        useGlobalBinarizer ? new GlobalHistogramBinarizer(source) : new HybridBinarizer(source)
      );
      const reader = new MultiFormatReader();
      reader.setHints(hints);
      return reader.decode(bitmap).getText();
    };

    return {
      name: "zxing",
      decode: (data, width, height) => {
        try {
          return decodeWithBinarizer(data, width, height, false);
        } catch {
          // Try alternate binarizer for difficult thermal/low-contrast images.
        }
        try {
          return decodeWithBinarizer(data, width, height, true);
        } catch {
          // Try inverted pixels as a final ZXing pass.
        }
        try {
          const inverted = invertRgbaImageData(data);
          return decodeWithBinarizer(inverted, width, height, false);
        } catch {
          return null;
        }
      }
    };
  } catch {
    return null;
  }
}

async function createJsQrDecoderStrategy(): Promise<QrDecoderStrategy | null> {
  try {
    const qrModule = await import("jsqr");
    const candidate = ("default" in qrModule ? qrModule.default : qrModule) as unknown;
    if (typeof candidate !== "function") {
      return null;
    }
    const decoder = candidate as QrDecoderFn;
    return {
      name: "jsqr",
      decode: (data, width, height) => {
        const decoded = decoder(data, width, height, {
          inversionAttempts: "attemptBoth"
        });
        if (!decoded || typeof decoded.data !== "string") {
          return null;
        }
        return decoded.data;
      }
    };
  } catch {
    return null;
  }
}

async function getQrDecoderStrategies(): Promise<QrDecoderStrategy[]> {
  if (cachedQrDecoderStrategies) {
    return cachedQrDecoderStrategies;
  }

  const strategies: QrDecoderStrategy[] = [];
  const zxingStrategy = createZxingDecoderStrategy();
  if (zxingStrategy) {
    strategies.push(zxingStrategy);
  }

  const jsQrStrategy = await createJsQrDecoderStrategy();
  if (jsQrStrategy) {
    strategies.push(jsQrStrategy);
  }

  cachedQrDecoderStrategies = strategies;
  return strategies;
}

function invertRgbaImageData(data: Uint8ClampedArray) {
  const inverted = new Uint8ClampedArray(data.length);
  for (let index = 0; index < data.length; index += 4) {
    inverted[index] = 255 - data[index];
    inverted[index + 1] = 255 - data[index + 1];
    inverted[index + 2] = 255 - data[index + 2];
    inverted[index + 3] = data[index + 3];
  }
  return inverted;
}

async function buildQrDetectionVariants(
  {
    image,
    width,
    height,
    qrAssistCrop
  }: {
    image: sharp.Sharp;
    width: number;
    height: number;
    qrAssistCrop?: ReceiptQrAssistCrop | null;
  }
) {
  const regionVariants = buildQrRegionVariants({
    width,
    height,
    qrAssistCrop
  });
  const enhancementVariants: Array<{
    label: string;
    apply: (pipeline: sharp.Sharp) => sharp.Sharp;
  }> = [
    {
      label: "original",
      apply: (pipeline) => pipeline
    },
    {
      label: "grayscale-contrast",
      apply: (pipeline) => pipeline.grayscale().normalize().linear(1.2, -12)
    },
    {
      label: "grayscale",
      apply: (pipeline) => pipeline.grayscale().normalize()
    },
    {
      label: "contrast-boost",
      apply: (pipeline) => pipeline.grayscale().normalize().linear(1.35, -18)
    },
    {
      label: "sharpen",
      apply: (pipeline) => pipeline.grayscale().normalize().sharpen()
    },
    {
      label: "grayscale-contrast-sharpen",
      apply: (pipeline) => pipeline.grayscale().normalize().linear(1.25, -14).sharpen()
    },
    {
      label: "threshold-150",
      apply: (pipeline) => pipeline.grayscale().normalize().threshold(150)
    },
    {
      label: "threshold-130",
      apply: (pipeline) => pipeline.grayscale().normalize().threshold(130)
    },
    {
      label: "threshold-170",
      apply: (pipeline) => pipeline.grayscale().normalize().threshold(170)
    },
    {
      label: "threshold-180",
      apply: (pipeline) => pipeline.grayscale().normalize().threshold(180)
    },
    {
      label: "threshold-190",
      apply: (pipeline) => pipeline.grayscale().normalize().threshold(190)
    },
    {
      label: "noise-reduced",
      apply: (pipeline) => pipeline.grayscale().normalize().median(1).sharpen()
    },
    {
      label: "denoised",
      apply: (pipeline) => pipeline.grayscale().normalize().median(2)
    }
  ];

  const variants: Array<{ label: string; data: Uint8ClampedArray; width: number; height: number }> = [];
  for (const regionVariant of regionVariants) {
    const baseWidth = regionVariant.extractArea?.width || width;
    const baseHeight = regionVariant.extractArea?.height || height;
    const upscaleFactors = baseWidth < 420 || baseHeight < 420 ? [1, 2, 3, 4] : [1, 2, 3];
    const shouldAddPadding =
      baseWidth < 320 ||
      baseHeight < 320 ||
      regionVariant.key.includes("manual-qr-assist") ||
      regionVariant.key.includes("qr-crop");
    const paddingOptions = shouldAddPadding ? [0, 16, 32] : [0];
    for (const factor of upscaleFactors) {
      for (const enhancementVariant of enhancementVariants) {
        for (const padding of paddingOptions) {
          try {
            let pipeline = image.clone();
            if (regionVariant.extractArea) {
              pipeline = pipeline.extract(regionVariant.extractArea);
            }

            const targetWidth =
              factor === 1
                ? Math.min(baseWidth, 2200)
                : Math.min(Math.max(Math.round(baseWidth * factor), 700), 3000);
            if (targetWidth > 0 && targetWidth !== baseWidth) {
              pipeline = pipeline.resize({
                width: targetWidth,
                withoutEnlargement: false,
                kernel: sharp.kernel.nearest
              });
            }

            let rendered = enhancementVariant.apply(pipeline).ensureAlpha();
            if (padding > 0) {
              rendered = rendered.extend({
                top: padding,
                bottom: padding,
                left: padding,
                right: padding,
                background: {
                  r: 255,
                  g: 255,
                  b: 255,
                  alpha: 1
                }
              });
            }

            const variantMeta = await rendered.metadata();
            const raw = await rendered.raw().toBuffer();
            if (!variantMeta.width || !variantMeta.height) {
              continue;
            }
            variants.push({
              label: `${regionVariant.key}-${enhancementVariant.label}-${factor}x-pad${padding}`,
              data: new Uint8ClampedArray(raw),
              width: variantMeta.width,
              height: variantMeta.height
            });
          } catch {
            // ignore variant failure and continue
          }
        }
      }
    }
  }

  return variants;
}

function buildQrRegionVariants({
  width,
  height,
  qrAssistCrop
}: {
  width: number;
  height: number;
  qrAssistCrop?: ReceiptQrAssistCrop | null;
}) {
  const variants: Array<{
    key: string;
    extractArea: { left: number; top: number; width: number; height: number } | null;
  }> = [];
  const used = new Set<string>();

  const pushRegion = ({
    key,
    x,
    y,
    cropWidth,
    cropHeight
  }: {
    key: string;
    x: number;
    y: number;
    cropWidth: number;
    cropHeight: number;
  }) => {
    const area = toPixelCrop({
      imageWidth: width,
      imageHeight: height,
      x,
      y,
      cropWidth,
      cropHeight
    });
    if (!area) {
      return;
    }
    const dedupeKey = `${area.left}:${area.top}:${area.width}:${area.height}`;
    if (used.has(dedupeKey)) {
      return;
    }
    used.add(dedupeKey);
    variants.push({
      key,
      extractArea: area
    });
  };

  if (isValidQrAssistCrop(qrAssistCrop)) {
    pushRegion({
      key: "manual-qr-assist",
      x: qrAssistCrop.x,
      y: qrAssistCrop.y,
      cropWidth: qrAssistCrop.width,
      cropHeight: qrAssistCrop.height
    });
  }

  if (looksLikeQrOnlyImage(width, height)) {
    pushRegion({
      key: "qr-crop-full",
      x: 0,
      y: 0,
      cropWidth: 1,
      cropHeight: 1
    });
    pushRegion({
      key: "qr-crop-centered",
      x: 0.05,
      y: 0.05,
      cropWidth: 0.9,
      cropHeight: 0.9
    });
    return variants.length > 0
      ? variants
      : [
          {
            key: "fallback-full",
            extractArea: null
          }
        ];
  }

  pushRegion({
    key: "full-image",
    x: 0,
    y: 0,
    cropWidth: 1,
    cropHeight: 1
  });
  pushRegion({
    key: "bottom-half",
    x: 0,
    y: 0.45,
    cropWidth: 1,
    cropHeight: 0.55
  });
  pushRegion({
    key: "bottom-third",
    x: 0,
    y: 0.62,
    cropWidth: 1,
    cropHeight: 0.38
  });
  pushRegion({
    key: "bottom-center",
    x: 0.15,
    y: 0.52,
    cropWidth: 0.7,
    cropHeight: 0.45
  });
  pushRegion({
    key: "bottom-right",
    x: 0.48,
    y: 0.48,
    cropWidth: 0.52,
    cropHeight: 0.52
  });
  pushRegion({
    key: "center",
    x: 0.18,
    y: 0.18,
    cropWidth: 0.64,
    cropHeight: 0.64
  });

  const bottomWindowRows = [0.52, 0.62];
  const bottomWindowColumns = [0, 0.25, 0.5];
  for (const rowStart of bottomWindowRows) {
    for (const columnStart of bottomWindowColumns) {
      pushRegion({
        key: `bottom-window-${rowStart}-${columnStart}`,
        x: columnStart,
        y: rowStart,
        cropWidth: 0.5,
        cropHeight: 0.38
      });
    }
  }

  return variants.length > 0
    ? variants
    : [
        {
          key: "fallback-full",
          extractArea: null
        }
      ];
}

function toPixelCrop({
  imageWidth,
  imageHeight,
  x,
  y,
  cropWidth,
  cropHeight
}: {
  imageWidth: number;
  imageHeight: number;
  x: number;
  y: number;
  cropWidth: number;
  cropHeight: number;
}) {
  if (imageWidth <= 0 || imageHeight <= 0) {
    return null;
  }

  const normalizedX = clamp01(x);
  const normalizedY = clamp01(y);
  const normalizedWidth = clamp01(cropWidth);
  const normalizedHeight = clamp01(cropHeight);
  if (normalizedWidth <= 0 || normalizedHeight <= 0) {
    return null;
  }

  const left = Math.max(0, Math.floor(normalizedX * imageWidth));
  const top = Math.max(0, Math.floor(normalizedY * imageHeight));
  const rawWidth = Math.floor(normalizedWidth * imageWidth);
  const rawHeight = Math.floor(normalizedHeight * imageHeight);
  const width = Math.min(imageWidth - left, Math.max(rawWidth, 48));
  const height = Math.min(imageHeight - top, Math.max(rawHeight, 48));
  if (width < 48 || height < 48) {
    return null;
  }

  return {
    left,
    top,
    width,
    height
  };
}

function isValidQrAssistCrop(value: ReceiptQrAssistCrop | null | undefined): value is ReceiptQrAssistCrop {
  if (!value) {
    return false;
  }
  const numbers = [value.x, value.y, value.width, value.height];
  if (numbers.some((entry) => !Number.isFinite(entry))) {
    return false;
  }
  if (value.width <= 0 || value.height <= 0) {
    return false;
  }
  if (value.x >= 1 || value.y >= 1) {
    return false;
  }
  if (value.x + value.width <= 0 || value.y + value.height <= 0) {
    return false;
  }
  return true;
}

function clamp01(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  if (value < 0) {
    return 0;
  }
  if (value > 1) {
    return 1;
  }
  return value;
}

function looksLikeQrOnlyImage(width: number, height: number) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return false;
  }
  const ratio = width / height;
  const maxDimension = Math.max(width, height);
  return ratio >= 0.65 && ratio <= 1.55 && maxDimension <= 1400;
}

function truncateQrLogValue(value: string, maxLength = 500) {
  if (!value) {
    return "";
  }
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength - 3)}...`;
}

function hasMeaningfulMetadataFromQr(parsed: Partial<ReceiptHeaderExtraction>) {
  const meaningfulKeys: Array<keyof ReceiptHeaderExtraction> = [
    "receiptNumber",
    "verificationCode",
    "tin",
    "supplierName",
    "receiptDate",
    "total"
  ];
  return meaningfulKeys.some((key) => {
    const value = parsed[key];
    if (typeof value === "number") {
      return value > 0;
    }
    return typeof value === "string" && value.trim().length > 0;
  });
}

function hasHeaderFieldValue(value: unknown) {
  if (typeof value === "number") {
    return Number.isFinite(value) && value > 0;
  }
  return typeof value === "string" && value.trim().length > 0;
}

function listMissingHeaderFields(
  header: Partial<ReceiptHeaderExtraction>,
  fields: Array<keyof ReceiptHeaderExtraction>
) {
  return fields.filter((field) => !hasHeaderFieldValue(header[field]));
}

function listPresentHeaderFields(
  header: Partial<ReceiptHeaderExtraction>,
  fields: Array<keyof ReceiptHeaderExtraction>
) {
  return fields.filter((field) => hasHeaderFieldValue(header[field]));
}

function listReadableHeaderFields(
  header: Partial<ReceiptHeaderExtraction>,
  confidence: Partial<ReceiptFieldConfidenceMap>,
  fields: Array<keyof ReceiptHeaderExtraction>
) {
  return fields.filter(
    (field) => hasHeaderFieldValue(header[field]) && confidence[field as keyof ReceiptFieldConfidenceMap] !== "UNREADABLE"
  );
}

function buildEmptyHeaderResult(fileName: string): HeaderExtractionResult {
  const fallback = extractHeaderFields("", fileName);
  return {
    header: {
      ...fallback.header,
      supplierName: ""
    },
    fieldConfidence: {
      ...fallback.fieldConfidence,
      supplierName: "UNREADABLE"
    }
  };
}

function mergeHeaderResults({
  qrParsed,
  ocrHeader,
  ocrConfidence
}: {
  qrParsed: Partial<ReceiptHeaderExtraction>;
  ocrHeader: ReceiptHeaderExtraction;
  ocrConfidence: ReceiptFieldConfidenceMap;
}) {
  const mergedHeader = { ...ocrHeader };
  const mergedConfidence = { ...ocrConfidence };
  const mergedSource: ReceiptFieldSourceMap = {
    supplierName: "NONE",
    tin: "NONE",
    vrn: "NONE",
    serialNumber: "NONE",
    receiptNumber: "NONE",
    verificationCode: "NONE",
    receiptDate: "NONE",
    receiptTime: "NONE",
    traReceiptNumber: "NONE",
    invoiceReference: "NONE",
    paymentMethod: "NONE",
    taxOffice: "NONE",
    currency: "NONE",
    subtotal: "NONE",
    tax: "NONE",
    total: "NONE",
    itemCount: "NONE"
  };

  const qrEntries: Array<keyof ReceiptFieldConfidenceMap> = [
    "supplierName",
    "tin",
    "vrn",
    "serialNumber",
    "receiptNumber",
    "verificationCode",
    "receiptDate",
    "receiptTime",
    "traReceiptNumber",
    "invoiceReference",
    "paymentMethod",
    "taxOffice",
    "currency",
    "subtotal",
    "tax",
    "total",
    "itemCount"
  ];

  for (const key of qrEntries) {
    const qrValue = qrParsed[key as keyof ReceiptHeaderExtraction];
    const hasQrValue =
      (typeof qrValue === "string" && qrValue.trim().length > 0) ||
      (typeof qrValue === "number" && Number.isFinite(qrValue) && qrValue > 0);
    if (hasQrValue) {
      // Prefer QR for official metadata when available.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (mergedHeader as any)[key] = qrValue;
      mergedConfidence[key] = "HIGH";
      mergedSource[key] = "QR";
    } else {
      const ocrValue = ocrHeader[key as keyof ReceiptHeaderExtraction];
      const hasOcrValue =
        (typeof ocrValue === "string" && ocrValue.trim().length > 0) ||
        (typeof ocrValue === "number" && Number.isFinite(ocrValue) && ocrValue > 0);
      if (hasOcrValue) {
        mergedConfidence[key] = "MEDIUM";
      }
      mergedSource[key] = hasOcrValue ? "OCR" : "NONE";
    }
  }

  return {
    header: mergedHeader,
    fieldConfidence: mergedConfidence,
    fieldSource: mergedSource
  };
}

function resolveExtractionMethod({
  qrDetected,
  ocrMethod
}: {
  qrDetected: boolean;
  ocrMethod: "OCR_IMAGE_PREPROCESSED" | "OCR_IMAGE" | "PDF_TEXT" | "NONE";
}): "QR_ONLY" | "QR_PLUS_OCR" | "OCR_IMAGE_PREPROCESSED" | "OCR_IMAGE" | "PDF_TEXT" | "NONE" {
  if (qrDetected && ocrMethod !== "NONE") {
    return "QR_PLUS_OCR";
  }
  if (qrDetected) {
    return "QR_ONLY";
  }
  return ocrMethod;
}
