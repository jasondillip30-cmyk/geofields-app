import type { InventoryCategory } from "@prisma/client";
import { existsSync } from "node:fs";
import {
  BarcodeFormat,
  BinaryBitmap,
  DecodeHintType,
  GlobalHistogramBinarizer,
  HybridBinarizer,
  MultiFormatReader,
  RGBLuminanceSource
} from "@zxing/library";
import sharp from "sharp";
import { createWorker } from "tesseract.js";

import { inferCategorySuggestion } from "@/lib/inventory-intelligence";
import { roundCurrency } from "@/lib/inventory-server";
import { resolveNextDistDir, resolveNextDistPath } from "@/lib/next-dist-dir";

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

interface ReceiptLineCandidate {
  description: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  extractionConfidence: ReceiptLineConfidence;
}

interface HeaderExtractionResult {
  header: ReceiptHeaderExtraction;
  fieldConfidence: ReceiptFieldConfidenceMap;
}

const lineSkipKeywords = [
  "subtotal",
  "total",
  "grand total",
  "vat",
  "tax",
  "receipt",
  "invoice",
  "amount due",
  "balance",
  "cash",
  "change",
  "payment",
  "operator",
  "tra",
  "tin",
  "tel",
  "phone"
];

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
    console.info("[inventory][receipt-intake][merge]", {
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
      console.info("[inventory][receipt-intake][postprocess]", {
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
          console.info("[inventory][receipt-intake][postprocess]", {
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
        console.info("[inventory][receipt-intake][postprocess]", {
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
    console.info("[inventory][receipt-intake][merge]", {
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
    text: text || qrResult.rawValue,
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
    intakeDebug: {
      qrDecoded: qrResult.decodeStatus === "DECODED",
      traLookupSucceeded,
      traParseSucceeded,
      ocrAttempted,
      ocrSucceeded,
      ocrError,
      enrichmentWarning,
      returnedFrom,
      partialEnrichment
    },
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
        console.info("[inventory][receipt-intake][pdf][error]", {
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
      console.info("[inventory][receipt-intake][pdf][error]", {
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
    console.info("[inventory][receipt-intake][qr][stage]", {
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
      console.info("[inventory][receipt-intake][qr][stage]", {
        stage: "image_loaded",
        width: metadata.width,
        height: metadata.height,
        isQrOnlyCandidate
      });
      console.info("[inventory][receipt-intake][qr][stage]", {
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
      console.info("[inventory][receipt-intake][qr][decode]", {
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
          console.info("[inventory][receipt-intake][qr][decode]", {
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
      console.info("[inventory][receipt-intake][qr][decode]", {
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
  const normalizedRaw = rawValue.trim();
  const contentType = detectQrContentType(normalizedRaw);
  const verificationUrl = contentType === "URL" ? toUrl(normalizedRaw)?.toString() || "" : extractUrl(normalizedRaw);
  const isTraVerification = isTraVerificationUrl(verificationUrl);
  const classifiedType: ReceiptQrContentType =
    contentType === "URL" && isTraVerification ? "TRA_URL" : contentType;

  return {
    detected: true,
    rawValue: normalizedRaw,
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
      console.info("[inventory][receipt-intake][tra-lookup][request]", { url: target.toString() });
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
      console.info("[inventory][receipt-intake][tra-lookup][response]", {
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
      console.info("[inventory][receipt-intake][tra-lookup][mapped-fields]", parsedFields);
      if (parsedLookup.debugRawTextPreview) {
        console.info("[inventory][receipt-intake][tra-lookup][raw-text-preview]", {
          preview: parsedLookup.debugRawTextPreview
        });
      }
      if (parsedLookup.debugFieldCandidates.length > 0) {
        console.info("[inventory][receipt-intake][tra-lookup][field-candidates]", {
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
      console.info("[inventory][receipt-intake][tra-lookup][error]", { reason });
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
        console.info("[inventory][receipt-intake][tra-lookup][fetch-fallback]", {
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
        console.info("[inventory][receipt-intake][tra-lookup][playwright-rendered]", {
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
      console.info("[inventory][receipt-intake][tra-lookup][playwright-error]", { reason: message });
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
    console.info("[inventory][receipt-intake][tra-lookup][html-structure]", parseContext.structureSummary);
    console.info("[inventory][receipt-intake][tra-lookup][selected-container]", {
      source: parseContext.selectedSource,
      score: parseContext.selectedScore,
      keywordHits: parseContext.selectedKeywordHits,
      preview: parseContext.selectedHtml.slice(0, 1200)
    });
    console.info("[inventory][receipt-intake][tra-lookup][candidate-summary]", {
      candidates: parseContext.candidateSummaries.slice(0, 8)
    });
    console.info("[inventory][receipt-intake][tra-lookup][parsed-summary]", {
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

function extractTraCriticalFields({
  selectedText,
  fullText,
  selectedHtml,
  fullHtml
}: {
  selectedText: string;
  fullText: string;
  selectedHtml: string;
  fullHtml: string;
}) {
  const criticalTextPool = [
    selectedText,
    fullText,
    extractReadableTraText(selectedHtml, { keepScripts: true }),
    extractReadableTraText(fullHtml, { keepScripts: true })
  ]
    .filter(Boolean)
    .join("\n");

  const lineAwareTextPool = [
    selectedText,
    fullText,
    extractReadableTraTextWithLineBreaks(selectedHtml, { keepScripts: true }),
    extractReadableTraTextWithLineBreaks(fullHtml, { keepScripts: true })
  ]
    .filter(Boolean)
    .join("\n");

  const supplierCandidateFromHeader = extractTraSupplierFromLegalReceiptHeader(lineAwareTextPool);
  const supplierCandidateFromHeading = extractTraSupplierFromHeadingBlock(fullHtml || selectedHtml);
  const supplierCandidateFromRawText = extractTraSupplierFromRawText(lineAwareTextPool || criticalTextPool);
  const supplierName =
    supplierCandidateFromHeader ||
    supplierCandidateFromHeading ||
    supplierCandidateFromRawText ||
    extractTraSupplierName(criticalTextPool);

  if (process.env.NODE_ENV !== "production") {
    console.info("[inventory][receipt-intake][tra-lookup][supplier-candidates]", {
      supplierCandidateFromHeader,
      supplierCandidateFromRawText,
      supplierSelectedFinal: supplierName || "",
      supplierSource: supplierCandidateFromHeader
        ? "LEGAL_RECEIPT_HEADER"
        : supplierCandidateFromHeading
          ? "HEADING_BLOCK"
          : supplierCandidateFromRawText
            ? "RAW_TEXT_FALLBACK"
            : supplierName
              ? "LEGACY_PATTERN"
              : "NONE"
    });
  }

  const verificationCode = extractTraVerificationCode(criticalTextPool);

  return {
    supplierName,
    verificationCode
  };
}

function extractTraSupplierName(text: string) {
  if (!text) {
    return "";
  }

  const patterns = [
    /\b(?:supplier|merchant|trader|business|company)\s*(?:name)?\s*[:\-]?\s*([^\n\r]{3,120})/i,
    /\b(?:name\s+of\s+supplier|supplier\s+name|business\s+name|trader\s+name)\s*[:\-]?\s*([^\n\r]{3,120})/i,
    /\b(?:supplier|merchant|business|trader)\s*(?:name)?\s*(?:\n|\r|\s{2,})([A-Z][A-Z0-9&().,'\-\/ ]{3,120})/i
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    const candidate = normalizeSupplierCandidate(match?.[1] || "");
    if (isLikelySupplierName(candidate)) {
      return candidate;
    }
  }

  return "";
}

function extractTraSupplierFromLegalReceiptHeader(text: string) {
  if (!text) {
    return "";
  }

  const lines = text
    .split(/\r?\n/g)
    .map((line) => normalizeWhitespace(line))
    .filter(Boolean);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] || "";
    if (!/start\s+of\s+legal\s+receipt/i.test(line)) {
      continue;
    }

    const window = lines.slice(index + 1, index + 18);
    const supplier = extractFirstLikelySupplierFromLines(window);
    if (supplier) {
      return supplier;
    }
  }

  return "";
}

function extractTraSupplierFromHeadingBlock(html: string) {
  if (!html) {
    return "";
  }

  const headingMatches = Array.from(html.matchAll(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/gi));
  for (const match of headingMatches) {
    const heading = normalizeSupplierCandidate(
      normalizeWhitespace(decodeHtmlEntities((match[1] || "").replace(/<[^>]+>/g, " ")))
    );
    if (!heading) {
      continue;
    }
    const lower = heading.toLowerCase();
    if (containsAny(lower, ["taxpayer", "verification portal", "receipt verification", "submit", "tra"])) {
      continue;
    }
    if (isLikelySupplierName(heading)) {
      return heading;
    }
  }

  return "";
}

function extractTraSupplierFromRawText(text: string) {
  if (!text) {
    return "";
  }

  const boundedMatch = text.match(
    /start\s+of\s+legal\s+receipt[\s\S]{0,1200}?(?:\n|\r| )([^\n\r]{3,180}?)(?=(?:\n|\r| )?(?:p\.?\s*o\.?\s*box|mobile|tin|vrn)\b)/i
  );
  const boundedCandidate = normalizeSupplierCandidate(boundedMatch?.[1] || "");
  if (isLikelySupplierName(boundedCandidate)) {
    return boundedCandidate;
  }

  const blockMatch = text.match(
    /start\s+of\s+legal\s+receipt([\s\S]{0,1400}?)(?=\b(?:p\.?\s*o\.?\s*box|mobile|tin|vrn)\b)/i
  );
  if (blockMatch?.[1]) {
    const lines = blockMatch[1]
      .split(/\r?\n/g)
      .map((line) => normalizeWhitespace(line))
      .filter(Boolean);
    const supplier = extractFirstLikelySupplierFromLines(lines);
    if (supplier) {
      return supplier;
    }
  }

  const collapsed = normalizeWhitespace(text);
  const collapsedMatch = collapsed.match(
    /start\s+of\s+legal\s+receipt\s*[*:-]*\s*([a-z0-9&().,'\-\/ ]{3,180}?)(?=\s+(?:p\.?\s*o\.?\s*box|mobile|tin|vrn)\b)/i
  );
  const collapsedCandidate = normalizeSupplierCandidate(collapsedMatch?.[1] || "");
  if (isLikelySupplierName(collapsedCandidate)) {
    return collapsedCandidate;
  }

  return "";
}

function extractFirstLikelySupplierFromLines(lines: string[]) {
  for (const line of lines) {
    const normalizedLine = normalizeWhitespace(line || "");
    if (!normalizedLine) {
      continue;
    }
    const lower = normalizedLine.toLowerCase();
    if (
      containsAny(lower, [
        "start of legal receipt",
        "end of legal receipt",
        "efd receipt verification",
        "taxpayer receipt verification",
        "submit"
      ])
    ) {
      continue;
    }
    if (looksLikeSupplierStopLine(lower)) {
      break;
    }
    const candidate = normalizeSupplierCandidate(normalizedLine);
    if (isLikelySupplierName(candidate)) {
      return candidate;
    }
  }
  return "";
}

function looksLikeSupplierStopLine(lowerLine: string) {
  return containsAny(lowerLine, [
    "p.o box",
    "po box",
    "mobile",
    "tin",
    "vrn",
    "serial",
    "receipt no",
    "receipt number",
    "verification code",
    "z number",
    "tax office",
    "purchased items",
    "customer",
    "subtotal",
    "total",
    "vat",
    "tax"
  ]);
}

function normalizeSupplierCandidate(value: string) {
  if (!value) {
    return "";
  }
  return normalizeWhitespace(value)
    .replace(/\b(?:tin|vrn|serial(?:\s*no)?|receipt(?:\s*no)?|verification(?:\s*code)?|z\s*number|tax\s*office)\b.*$/i, "")
    .replace(/^[^a-z0-9]+/i, "")
    .trim();
}

function extractReadableTraTextWithLineBreaks(value: string, options?: { keepScripts?: boolean }) {
  if (!value) {
    return "";
  }
  const withBreaks = value
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/\s*(p|div|li|tr|td|th|h1|h2|h3|h4|h5|h6|table|section|article)\s*>/gi, "\n")
    .replace(/<style[\s\S]*?<\/style>/gi, " ");
  const withoutScripts = options?.keepScripts ? withBreaks : withBreaks.replace(/<script[\s\S]*?<\/script>/gi, " ");
  const stripped = withoutScripts.replace(/<[^>]+>/g, " ");
  return decodeHtmlEntities(stripped)
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function isLikelySupplierName(value: string) {
  if (!value) {
    return false;
  }
  const normalized = normalizeWhitespace(value);
  if (normalized.length < 3 || normalized.length > 120) {
    return false;
  }
  const lower = normalized.toLowerCase();
  if (containsAny(lower, ["portal", "submit", "verification", "receipt no", "receipt number"])) {
    return false;
  }
  const tokens = normalized.split(" ").filter(Boolean);
  if (tokens.length < 2 && !/\b(ltd|limited|company|co)\b/i.test(normalized)) {
    return false;
  }
  return /[a-z]/i.test(normalized);
}

function extractTraVerificationCode(text: string) {
  if (!text) {
    return "";
  }
  const patterns = [
    /\b(?:receipt\s*)?verification\s*(?:code|no|number|#)?\s*[:\-]?\s*([0-9A-Z\-]{6,24})\b/i,
    /\bverify\s*(?:code|no|number|#)?\s*[:\-]?\s*([0-9A-Z\-]{6,24})\b/i,
    /\bverification\s*code\s*(?:\n|\r|\s{2,})([0-9A-Z\-]{6,24})\b/i
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    const candidate = (match?.[1] || "").trim().toUpperCase();
    if (!candidate) {
      continue;
    }
    if (!/[0-9]/.test(candidate) || !/[A-Z]/.test(candidate)) {
      continue;
    }
    return candidate;
  }
  return "";
}

function buildTraParseContext(html: string) {
  const structureSummary = summarizeTraHtmlStructure(html);
  const candidates = extractTraParseCandidates(html);
  const selected =
    [...candidates].sort((a, b) => b.score - a.score)[0] || {
      source: "full-body",
      html,
      text: extractReadableTraText(html),
      score: 0,
      keywordHits: [] as string[]
    };

  return {
    selectedHtml: selected.html || html,
    selectedText: selected.text || extractReadableTraText(selected.html || html),
    fullText: extractReadableTraText(html),
    selectedSource: selected.source,
    selectedScore: roundTo(selected.score, 2),
    selectedKeywordHits: selected.keywordHits,
    candidateSummaries: candidates
      .sort((a, b) => b.score - a.score)
      .slice(0, 12)
      .map((candidate) => ({
        source: candidate.source,
        score: roundTo(candidate.score, 2),
        keywordHits: candidate.keywordHits,
        textLength: candidate.text.length
      })),
    structureSummary
  };
}

function extractTraParseCandidates(html: string) {
  const candidates: Array<{ source: string; html: string; text: string; score: number; keywordHits: string[] }> = [];
  const seen = new Set<string>();
  const normalizedHtml = html || "";

  const pushCandidate = ({
    source,
    htmlSegment,
    textSegment
  }: {
    source: string;
    htmlSegment?: string;
    textSegment?: string;
  }) => {
    const resolvedHtml = htmlSegment ?? normalizedHtml;
    const resolvedText = (textSegment ?? extractReadableTraText(resolvedHtml))
      .replace(/\u00a0/g, " ")
      .replace(/[ \t]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    if (!resolvedText || resolvedText.length < 24) {
      return;
    }
    const dedupeKey = `${source}:${resolvedText.slice(0, 180)}`;
    if (seen.has(dedupeKey)) {
      return;
    }
    seen.add(dedupeKey);
    const scoring = scoreTraParseText(resolvedText);
    candidates.push({
      source,
      html: resolvedHtml,
      text: resolvedText,
      score: scoring.score,
      keywordHits: scoring.keywordHits
    });
  };

  pushCandidate({
    source: "full-body",
    htmlSegment: normalizedHtml
  });

  const markerSlice = extractMarkerSlice(normalizedHtml, "start of legal receipt", "end of legal receipt");
  if (markerSlice) {
    pushCandidate({
      source: "legal-receipt-marker",
      htmlSegment: markerSlice
    });
  }

  const purchasedSlice = extractMarkerSlice(normalizedHtml, "purchased items", "end of legal receipt");
  if (purchasedSlice) {
    pushCandidate({
      source: "purchased-items-marker",
      htmlSegment: purchasedSlice
    });
  }

  const keywordWindows = ["efd receipt verification", "start of legal receipt", "purchased items", "receipt no", "tin", "vrn"];
  for (const keyword of keywordWindows) {
    const windowSlice = extractKeywordWindow(normalizedHtml, keyword, 3500, 28000);
    if (!windowSlice) {
      continue;
    }
    pushCandidate({
      source: `keyword-window:${keyword}`,
      htmlSegment: windowSlice
    });
  }

  const tableMatches = Array.from(normalizedHtml.matchAll(/<table\b[^>]*>[\s\S]*?<\/table>/gi))
    .map((entry) => entry[0] || "")
    .filter(Boolean)
    .slice(0, 120);
  for (const tableHtml of tableMatches) {
    const text = extractReadableTraText(tableHtml);
    if (!text) {
      continue;
    }
    const lower = text.toLowerCase();
    if (!containsAny(lower, ["receipt", "tin", "vrn", "purchased", "subtotal", "total"])) {
      continue;
    }
    pushCandidate({
      source: "table-candidate",
      htmlSegment: tableHtml,
      textSegment: text
    });
  }

  const preMatches = Array.from(normalizedHtml.matchAll(/<(pre|textarea)\b[^>]*>([\s\S]*?)<\/\1>/gi))
    .map((entry) => normalizeWhitespace(decodeHtmlEntities((entry[2] || "").replace(/<[^>]+>/g, " "))))
    .filter(Boolean)
    .slice(0, 24);
  for (const text of preMatches) {
    pushCandidate({
      source: "preformatted-text",
      htmlSegment: normalizedHtml,
      textSegment: text
    });
  }

  const scriptCandidates = extractTraScriptTextCandidates(normalizedHtml);
  for (const scriptCandidate of scriptCandidates) {
    pushCandidate({
      source: scriptCandidate.source,
      htmlSegment: normalizedHtml,
      textSegment: scriptCandidate.text
    });
  }

  return candidates;
}

function summarizeTraHtmlStructure(html: string) {
  const headings = Array.from(html.matchAll(/<h[1-4][^>]*>([\s\S]*?)<\/h[1-4]>/gi))
    .map((entry) => normalizeWhitespace(decodeHtmlEntities((entry[1] || "").replace(/<[^>]+>/g, " "))))
    .filter(Boolean)
    .slice(0, 10);
  const markers = {
    hasEfdHeader: /efd\s*receipt\s*verification/i.test(html),
    hasStartLegalReceipt: /start\s+of\s+legal\s+receipt/i.test(html),
    hasPurchasedItems: /purchased\s+items/i.test(html),
    hasReceiptNo: /receipt\s*(no|number|#)/i.test(html),
    hasTin: /\btin\b/i.test(html),
    hasVrn: /\bvrn\b/i.test(html)
  };
  return {
    htmlLength: html.length,
    tableCount: (html.match(/<table\b/gi) || []).length,
    formCount: (html.match(/<form\b/gi) || []).length,
    scriptCount: (html.match(/<script\b/gi) || []).length,
    headingPreview: headings,
    markers
  };
}

function scoreTraParseText(text: string) {
  const lower = text.toLowerCase();
  const weightedKeywords: Array<{ keyword: string; score: number }> = [
    { keyword: "start of legal receipt", score: 8 },
    { keyword: "purchased items", score: 7 },
    { keyword: "efd receipt verification", score: 6 },
    { keyword: "receipt no", score: 5 },
    { keyword: "receipt number", score: 5 },
    { keyword: "tin", score: 4 },
    { keyword: "vrn", score: 4 },
    { keyword: "serial", score: 3 },
    { keyword: "verification code", score: 4 },
    { keyword: "total incl", score: 4 },
    { keyword: "tax", score: 2 }
  ];
  const keywordHits: string[] = [];
  let score = 0;
  for (const entry of weightedKeywords) {
    if (lower.includes(entry.keyword)) {
      score += entry.score;
      keywordHits.push(entry.keyword);
    }
  }
  const labelLikeLines = (text.match(/\b(?:tin|vrn|receipt|serial|total|tax|subtotal|verification)\b[^\n:]{0,28}[:]/gi) || [])
    .length;
  score += Math.min(7, labelLikeLines * 0.7);
  const rows = text.split(/\r?\n/g).filter((line) => normalizeWhitespace(line).length > 0).length;
  if (rows > 6) {
    score += Math.min(3, rows / 12);
  }
  if (text.length < 70) {
    score -= 3;
  }
  if (containsAny(lower, ["submit", "verification portal"]) && keywordHits.length <= 1) {
    score -= 3;
  }

  return {
    score,
    keywordHits
  };
}

function extractMarkerSlice(html: string, startMarker: string, endMarker: string) {
  const lower = html.toLowerCase();
  const start = lower.indexOf(startMarker);
  if (start < 0) {
    return "";
  }
  const endSearchStart = start + startMarker.length;
  const endIndex = lower.indexOf(endMarker, endSearchStart);
  const resolvedEnd = endIndex >= 0 ? endIndex + endMarker.length : Math.min(html.length, start + 42000);
  const from = Math.max(0, start - 2400);
  const to = Math.min(html.length, resolvedEnd + 3200);
  return html.slice(from, to);
}

function extractKeywordWindow(html: string, keyword: string, before: number, after: number) {
  const lower = html.toLowerCase();
  const start = lower.indexOf(keyword.toLowerCase());
  if (start < 0) {
    return "";
  }
  const from = Math.max(0, start - Math.max(600, before));
  const to = Math.min(html.length, start + Math.max(1200, after));
  return html.slice(from, to);
}

function extractTraScriptTextCandidates(html: string) {
  const results: Array<{ source: string; text: string }> = [];
  const scriptMatches = Array.from(html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)).slice(0, 50);
  for (const [index, match] of scriptMatches.entries()) {
    const scriptBody = decodeHtmlEntities(match[1] || "");
    if (!scriptBody) {
      continue;
    }
    const lower = scriptBody.toLowerCase();
    if (!containsAny(lower, ["receipt", "tin", "vrn", "verification", "purchased", "legal"])) {
      continue;
    }
    const directText = normalizeWhitespace(scriptBody.replace(/<[^>]+>/g, " "));
    if (directText.length >= 40) {
      results.push({
        source: `script-body-${index + 1}`,
        text: directText
      });
    }

    const stringLiteralRegex = /(["'])(?:(?=(\\?))\2.)*?\1/g;
    const literals = scriptBody.match(stringLiteralRegex) || [];
    for (const literal of literals.slice(0, 80)) {
      const unescaped = safelyUnescapeJsString(literal);
      if (!unescaped || unescaped.length < 40) {
        continue;
      }
      const lowered = unescaped.toLowerCase();
      if (!containsAny(lowered, ["receipt", "tin", "vrn", "verification", "purchased", "subtotal", "total"])) {
        continue;
      }
      results.push({
        source: `script-literal-${index + 1}`,
        text: normalizeWhitespace(unescaped.replace(/<[^>]+>/g, " "))
      });
    }
  }
  return results.slice(0, 60);
}

function safelyUnescapeJsString(value: string) {
  if (!value || value.length < 2) {
    return "";
  }
  const quote = value[0];
  if ((quote !== "\"" && quote !== "'") || value[value.length - 1] !== quote) {
    return "";
  }
  const inner = value.slice(1, -1);
  if (!inner) {
    return "";
  }
  try {
    const normalized = quote === "'" ? `"${inner.replace(/"/g, "\\\"")}"` : value;
    const parsed = JSON.parse(normalized);
    return typeof parsed === "string" ? parsed : "";
  } catch {
    const fallback = inner
      .replace(/\\n/g, "\n")
      .replace(/\\r/g, " ")
      .replace(/\\t/g, " ")
      .replace(/\\u003c/gi, "<")
      .replace(/\\u003e/gi, ">")
      .replace(/\\\//g, "/")
      .replace(/\\"/g, "\"")
      .replace(/\\'/g, "'");
    return decodeHtmlEntities(fallback);
  }
}

function extractReadableTraText(value: string, options?: { keepScripts?: boolean }) {
  if (!value) {
    return "";
  }
  const withBreaks = value
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/\s*(p|div|li|tr|td|th|h1|h2|h3|h4|h5|h6)\s*>/gi, "\n")
    .replace(/<style[\s\S]*?<\/style>/gi, " ");
  const withoutScripts = options?.keepScripts ? withBreaks : withBreaks.replace(/<script[\s\S]*?<\/script>/gi, " ");
  const stripped = withoutScripts.replace(/<[^>]+>/g, " ");
  return decodeHtmlEntities(stripped)
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function decodeHtmlEntities(value: string) {
  if (!value) {
    return "";
  }
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function extractTraLabelValuePairs(html: string, text: string) {
  const pairs: Array<{ label: string; value: string; source: string; confidence: number }> = [];

  const sections = collectTraLabelSections(html);
  for (const section of sections) {
    const rowMatches = section.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi);
    for (const rowMatch of rowMatches) {
      const rowHtml = rowMatch[1] || "";
      const cells = Array.from(rowHtml.matchAll(/<(?:th|td)[^>]*>([\s\S]*?)<\/(?:th|td)>/gi))
        .map((entry) => normalizeWhitespace(decodeHtmlEntities((entry[1] || "").replace(/<[^>]+>/g, " "))))
        .filter(Boolean);
      if (cells.length < 2) {
        continue;
      }

      if (cells.length >= 4 && cells.length % 2 === 0) {
        for (let index = 0; index < cells.length - 1; index += 2) {
          const label = cells[index];
          const value = cells[index + 1];
          if (!label || !value || !looksLikeTraLabel(label)) {
            continue;
          }
          pairs.push({
            label,
            value,
            source: "html-table-paired",
            confidence: 0.9
          });
        }
        continue;
      }

      const label = cells[0];
      const value = cells.slice(1).join(" ");
      if (!looksLikeTraLabel(label)) {
        continue;
      }
      pairs.push({
        label,
        value,
        source: "html-table",
        confidence: 0.85
      });
    }
  }

  const inlinePairs = html.matchAll(
    /<(?:span|label|strong|b)[^>]*>\s*([^<]{2,80})\s*<\/(?:span|label|strong|b)>\s*<(?:span|div|p|td)[^>]*>\s*([^<]{1,180})\s*<\/(?:span|div|p|td)>/gi
  );
  for (const inlinePair of inlinePairs) {
    const label = normalizeWhitespace(decodeHtmlEntities((inlinePair[1] || "").replace(/<[^>]+>/g, " ")));
    const value = normalizeWhitespace(decodeHtmlEntities((inlinePair[2] || "").replace(/<[^>]+>/g, " ")));
    if (!label || !value || !looksLikeTraLabel(label)) {
      continue;
    }
    pairs.push({
      label,
      value,
      source: "html-inline-pair",
      confidence: 0.76
    });
  }

  const definitionMatches = html.matchAll(/<dt[^>]*>([\s\S]*?)<\/dt>\s*<dd[^>]*>([\s\S]*?)<\/dd>/gi);
  for (const definition of definitionMatches) {
    const label = normalizeWhitespace(decodeHtmlEntities((definition[1] || "").replace(/<[^>]+>/g, " ")));
    const value = normalizeWhitespace(decodeHtmlEntities((definition[2] || "").replace(/<[^>]+>/g, " ")));
    if (!label || !value || !looksLikeTraLabel(label)) {
      continue;
    }
    pairs.push({
      label,
      value,
      source: "html-definition",
      confidence: 0.82
    });
  }

  const textLines = text.split(/\r?\n/g).map((line) => normalizeWhitespace(line)).filter(Boolean);
  for (const line of textLines) {
    const kv = line.match(/^([^:]{2,80})\s*:\s*(.+)$/);
    if (!kv) {
      continue;
    }
    const label = normalizeWhitespace(kv[1] || "");
    const value = normalizeWhitespace(kv[2] || "");
    if (!label || !value || !looksLikeTraLabel(label)) {
      continue;
    }
    pairs.push({
      label,
      value,
      source: "text-label",
      confidence: 0.72
    });
  }

  return pairs;
}

function collectTraLabelSections(html: string) {
  const sections: string[] = [];
  const seen = new Set<string>();
  const push = (section: string) => {
    const normalized = section.trim();
    if (!normalized) {
      return;
    }
    const key = normalized.slice(0, 240);
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    sections.push(normalized);
  };

  push(html);
  const legalSlice = extractMarkerSlice(html, "start of legal receipt", "end of legal receipt");
  if (legalSlice) {
    push(legalSlice);
  }
  const purchasedSlice = extractMarkerSlice(html, "purchased items", "end of legal receipt");
  if (purchasedSlice) {
    push(purchasedSlice);
  }

  const tableSlices = Array.from(html.matchAll(/<table\b[^>]*>[\s\S]*?<\/table>/gi))
    .map((entry) => entry[0] || "")
    .filter(Boolean)
    .slice(0, 120);
  for (const tableSlice of tableSlices) {
    const lower = tableSlice.toLowerCase();
    if (!containsAny(lower, ["receipt", "tin", "vrn", "verification", "total", "tax", "serial"])) {
      continue;
    }
    push(tableSlice);
  }

  return sections;
}

function looksLikeTraLabel(label: string) {
  const normalized = normalizeWhitespace(label).toLowerCase();
  if (!normalized || normalized.length > 80) {
    return false;
  }
  if (/^\d[\d,.\s-]*$/.test(normalized)) {
    return false;
  }
  return containsAny(normalized, [
    "supplier",
    "merchant",
    "store",
    "tin",
    "vrn",
    "serial",
    "receipt",
    "verification",
    "verify",
    "z number",
    "tax office",
    "invoice",
    "reference",
    "payment",
    "subtotal",
    "tax",
    "vat",
    "total",
    "currency",
    "item count",
    "customer"
  ]);
}

function mapTraLabelToField(label: string): keyof ReceiptHeaderExtraction | null {
  const normalized = normalizeWhitespace(label).toLowerCase();
  if (!normalized) {
    return null;
  }
  if (/\b(supplier|merchant|store|seller|trader|business\s*name|company\s*name|trader\s*name)\b/.test(normalized))
    return "supplierName";
  if (/\btin\b/.test(normalized)) return "tin";
  if (/\bvrn\b|\bvat\s*reg/.test(normalized)) return "vrn";
  if (/\bserial\b|\bs\/n\b/.test(normalized)) return "serialNumber";
  if (/\breceipt\b.*\b(no|number|#)\b|\brct\b.*\b(no|number)\b/.test(normalized)) return "receiptNumber";
  if (/\bz\s*(no|number|#)\b/.test(normalized)) return "traReceiptNumber";
  if (/\bverification\b.*\b(code|no|number|#)\b|\bverify\b.*\b(code|no|#)\b/.test(normalized)) return "verificationCode";
  if (/\breceipt\s*date\b|\bdate\b/.test(normalized)) return "receiptDate";
  if (/\breceipt\s*time\b|\btime\b/.test(normalized)) return "receiptTime";
  if (/\btax\s*office\b|\boffice\b/.test(normalized)) return "taxOffice";
  if (/\binvoice\b|\breference\b|\bref\b/.test(normalized)) return "invoiceReference";
  if (/\bpayment\b|\bmethod\b/.test(normalized)) return "paymentMethod";
  if (/\bcurrency\b/.test(normalized)) return "currency";
  if (/\bsub\s*total\b|\bsubtotal\b|\btotal\s*excl/.test(normalized)) return "subtotal";
  if (
    /\bgrand\s*total\b|\btotal\s*incl\b|\btotal\s*inc\b|\btotal\s*inclusive\b|\btotal\s*amount\b|\bamount\s*due\b|\bamount\s*payable\b|\btotal\b/.test(
      normalized
    )
  )
    return "total";
  if (/\b(?:tax|vat)\b/.test(normalized) && !/\btotal\b/.test(normalized)) return "tax";
  if (/\bitem\s*count\b|\bno\s*of\s*items\b/.test(normalized)) return "itemCount";
  return null;
}

function sanitizeTraFieldValue(
  field: keyof ReceiptHeaderExtraction,
  value: string | number,
  labelHint: string
): string | number | null {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      return null;
    }
    if (field === "itemCount") {
      return Math.max(0, Math.round(value));
    }
    if (field === "subtotal" || field === "tax" || field === "total") {
      return value > 0 ? roundCurrency(value) : null;
    }
    return value;
  }

  let cleaned = normalizeWhitespace(decodeHtmlEntities(value));
  if (!cleaned) {
    return null;
  }

  const normalizedLabel = normalizeWhitespace(labelHint).toLowerCase();
  if (normalizedLabel) {
    const escaped = normalizedLabel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    cleaned = cleaned.replace(new RegExp(`^${escaped}\\s*[:\\-]*\\s*`, "i"), "").trim();
  }

  cleaned = cleaned.replace(/^(receipt|verification|verify|code|portal)\s*[:\-#]?\s*/i, "").trim();
  if (!cleaned) {
    return null;
  }

  const lowered = cleaned.toLowerCase();
  const weakValues = new Set([
    "verification",
    "portal",
    "verification portal",
    "receipt",
    "receipt verification",
    "receipt verification code",
    "code"
  ]);
  if (weakValues.has(lowered)) {
    return null;
  }

  if (field === "receiptDate") {
    const date = normalizeQrDate(cleaned);
    return date || null;
  }
  if (field === "supplierName") {
    const supplier = normalizeWhitespace(cleaned).toUpperCase();
    if (!isLikelySupplierName(supplier)) {
      return null;
    }
    return supplier;
  }
  if (field === "receiptTime") {
    return findTime(cleaned) || null;
  }
  if (field === "currency") {
    const code = cleaned.toUpperCase().match(/\b(TZS|USD|KES|EUR|GBP)\b/)?.[1] || "";
    return code || null;
  }
  if (field === "subtotal" || field === "tax" || field === "total") {
    const amount = parseNumberSafe(cleaned);
    return amount > 0 ? roundCurrency(amount) : null;
  }
  if (field === "itemCount") {
    const amount = Number(cleaned.replace(/[^0-9]/g, ""));
    return Number.isFinite(amount) && amount >= 0 ? Math.round(amount) : null;
  }
  if (field === "tin") {
    const tin = cleaned.match(/\b[0-9]{8,15}\b/)?.[0] || "";
    return tin || null;
  }
  if (field === "vrn") {
    const vrn = cleaned.match(/\b[0-9a-z]{8,18}\b/i)?.[0] || "";
    return vrn || null;
  }
  if (field === "verificationCode") {
    const code = cleaned.match(/\b[0-9a-z\-]{6,}\b/i)?.[0] || "";
    if (!code || !/[0-9]/.test(code) || !/[a-z]/i.test(code)) {
      return null;
    }
    return code;
  }
  if (field === "traReceiptNumber") {
    const zNumber = cleaned.match(/\b\d{1,6}\b/)?.[0] || cleaned.match(/\b[0-9a-z\-\/]{1,12}\b/i)?.[0] || "";
    if (!zNumber || !/[0-9]/.test(zNumber)) {
      return null;
    }
    return zNumber;
  }
  if (field === "receiptNumber" || field === "serialNumber" || field === "invoiceReference") {
    const token = cleaned.match(/\b[0-9a-z\-\/]{4,}\b/i)?.[0] || "";
    if (!token || !/[0-9]/.test(token)) {
      return null;
    }
    return token;
  }

  return cleaned;
}

function normalizeTraFinancialFields(parsed: Partial<ReceiptHeaderExtraction>) {
  const next: Partial<ReceiptHeaderExtraction> = { ...parsed };
  const subtotal = toPositiveMoney(next.subtotal);
  const tax = toPositiveMoney(next.tax);
  const total = toPositiveMoney(next.total);

  if (subtotal > 0 && total > 0) {
    const impliedTax = roundCurrency(total - subtotal);
    if (impliedTax >= 0 && (tax <= 0 || approximatelyEqual(tax, total, 0.01) || tax > total)) {
      next.tax = impliedTax;
    }
  }

  const normalizedSubtotal = toPositiveMoney(next.subtotal);
  const normalizedTax = toPositiveMoney(next.tax);
  const normalizedTotal = toPositiveMoney(next.total);
  if (normalizedSubtotal > 0 && normalizedTax > 0 && normalizedTotal <= 0) {
    next.total = roundCurrency(normalizedSubtotal + normalizedTax);
  }
  if (normalizedTotal > 0 && normalizedTax > 0 && normalizedSubtotal <= 0 && normalizedTotal >= normalizedTax) {
    next.subtotal = roundCurrency(normalizedTotal - normalizedTax);
  }

  return next;
}

function toPositiveMoney(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? roundCurrency(parsed) : 0;
}

function approximatelyEqual(a: number, b: number, tolerance = 0.01) {
  return Math.abs(a - b) <= tolerance;
}

function selectBestTraFieldCandidates(
  candidates: Array<{ field: keyof ReceiptHeaderExtraction; value: string | number; confidence: number; source: string }>
) {
  const next: Partial<ReceiptHeaderExtraction> = {};
  const bestScores = new Map<keyof ReceiptHeaderExtraction, number>();
  const writable = next as Record<string, unknown>;
  for (const candidate of candidates) {
    const existingScore = bestScores.get(candidate.field) ?? -1;
    if (candidate.confidence < existingScore) {
      continue;
    }
    writable[candidate.field] = candidate.value;
    bestScores.set(candidate.field, candidate.confidence);
  }
  return next;
}

function extractTraLineCandidates(html: string, text: string) {
  const targetedHtml = extractTraPurchasedItemsSection(html) || html;
  const lineCandidates: ReceiptLineCandidate[] = [];
  const rows = Array.from(targetedHtml.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)).map((row) =>
    Array.from((row[1] || "").matchAll(/<(?:th|td)[^>]*>([\s\S]*?)<\/(?:th|td)>/gi))
      .map((cell) => normalizeWhitespace(decodeHtmlEntities((cell[1] || "").replace(/<[^>]+>/g, " "))))
      .filter(Boolean)
  );

  for (const row of rows) {
    if (row.length < 2) {
      continue;
    }
    const loweredJoined = row.join(" ").toLowerCase();
    if (
      containsAny(loweredJoined, [
        "subtotal",
        "grand total",
        "vat",
        "tax",
        "total inclusive",
        "total incl",
        "total excl",
        "amount due"
      ])
    ) {
      continue;
    }
    if (containsAny(loweredJoined, ["description", "qty", "quantity", "unit price", "line total", "amount"])) {
      continue;
    }
    const amountTokens = row.flatMap((cell) =>
      (cell.match(/-?\d[\d,]*(?:\.\d+)?/g) || []).map((token) => parseNumberSafe(token))
    );
    const positiveAmounts = amountTokens.filter((value) => Number.isFinite(value) && value > 0);
    if (positiveAmounts.length === 0) {
      continue;
    }

    const descriptionCell =
      row.find((cell) => /[a-z]/i.test(cell) && !/^\d[\d,]*(?:\.\d+)?$/.test(cell)) || row[0] || "";
    const description = cleanupDescription(descriptionCell);
    if (!description || containsAny(description.toLowerCase(), lineSkipKeywords)) {
      continue;
    }

    const qty = positiveAmounts.length >= 2 && positiveAmounts[0] <= 1000 ? positiveAmounts[0] : 1;
    const lineTotal = positiveAmounts[positiveAmounts.length - 1];
    const unitPrice = positiveAmounts.length >= 3 ? positiveAmounts[positiveAmounts.length - 2] : lineTotal / Math.max(1, qty);

    lineCandidates.push({
      description,
      quantity: roundCurrency(Math.max(1, qty)),
      unitPrice: roundCurrency(Math.max(0, unitPrice)),
      lineTotal: roundCurrency(Math.max(0, lineTotal)),
      extractionConfidence: positiveAmounts.length >= 2 ? "HIGH" : "MEDIUM"
    });
  }

  if (lineCandidates.length > 0) {
    return mergeDuplicateLineCandidates(lineCandidates).slice(0, 40);
  }

  return extractLineCandidates(text).slice(0, 40);
}

function extractTraPurchasedItemsSection(html: string) {
  const lower = html.toLowerCase();
  const start = lower.indexOf("purchased items");
  if (start < 0) {
    return "";
  }
  const endCandidates = [
    lower.indexOf("subtotal", start + 14),
    lower.indexOf("total excl", start + 14),
    lower.indexOf("total incl", start + 14),
    lower.indexOf("end of legal receipt", start + 14)
  ].filter((entry) => entry >= 0);
  const end = endCandidates.length > 0 ? Math.min(...endCandidates) : Math.min(html.length, start + 32000);
  const from = Math.max(0, start - 1600);
  const to = Math.min(html.length, end + 2600);
  return html.slice(from, to);
}

function countParsedFields(parsed: Partial<ReceiptHeaderExtraction>) {
  return Object.values(parsed).filter((value) => {
    if (typeof value === "number") {
      return value > 0;
    }
    return typeof value === "string" && value.trim().length > 0;
  }).length;
}

async function getQrDecoderStrategies(): Promise<QrDecoderStrategy[]> {
  if (cachedQrDecoderStrategies !== undefined) {
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
        return decoded?.data?.trim() || null;
      }
    };
  } catch {
    return null;
  }
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

function buildQrFailureResult({
  decodeStatus,
  failureReason,
  warnings = [],
  isQrOnlyImage = false,
  attemptedPasses = [],
  variantCount = 0,
  imageReceived = true,
  imageLoaded = true
}: {
  decodeStatus: ReceiptQrDecodeStatus;
  failureReason: string;
  warnings?: string[];
  isQrOnlyImage?: boolean;
  attemptedPasses?: string[];
  variantCount?: number;
  imageReceived?: boolean;
  imageLoaded?: boolean;
}): ReceiptQrResult {
  const classificationType: ReceiptQrContentType = "NONE";
  return {
    detected: false,
    rawValue: "",
    contentType: classificationType,
    isTraVerification: false,
    isQrOnlyImage,
    decodeStatus,
    decodePass: "",
    parseStatus: "UNPARSED",
    failureReason,
    verificationUrl: "",
    parsedFields: {},
    parsedLineCandidates: [],
    confidence: "UNREADABLE",
    warnings,
    stages: {
      decode: {
        success: false,
        status: decodeStatus,
        pass: "",
        reason: failureReason
      },
      classification: {
        success: false,
        type: classificationType,
        isTraUrl: false
      },
      verificationLookup: {
        attempted: false,
        success: false,
        status: "NOT_ATTEMPTED",
        reason: "",
        httpStatus: null,
        parsed: false,
        fieldsParseStatus: "NOT_ATTEMPTED",
        lineItemsParseStatus: "NOT_ATTEMPTED",
        parsedFieldCount: 0,
        parsedLineItemsCount: 0
      }
    },
    debug: {
      imageReceived,
      imageLoaded,
      attemptedPasses,
      successfulPass: "",
      variantCount
    }
  };
}

function parseQrPayload(
  rawValue: string,
  options?: {
    decodePass?: string;
    isQrOnlyImage?: boolean;
    attemptedPasses?: string[];
    variantCount?: number;
  }
): ReceiptQrResult {
  const decodePass = options?.decodePass || "";
  const isQrOnlyImage = Boolean(options?.isQrOnlyImage);
  const attemptedPasses = options?.attemptedPasses || [];
  const variantCount = Number(options?.variantCount || 0);
  const normalizedRaw = rawValue.trim();
  if (!normalizedRaw) {
    return buildQrFailureResult({
      decodeStatus: "NOT_DETECTED",
      failureReason: "No QR detected",
      isQrOnlyImage,
      attemptedPasses,
      variantCount,
      warnings: ["No QR detected. Continuing with OCR fallback."]
    });
  }

  const contentType = detectQrContentType(normalizedRaw);
  let parsed: Partial<ReceiptHeaderExtraction> = {};
  let verificationUrl = "";

  if (contentType === "URL") {
    const asUrl = toUrl(normalizedRaw);
    if (asUrl) {
      verificationUrl = asUrl.toString();
      parsed = mergeParsedFields(parsed, parseQrFromUrl(asUrl));
    } else {
      verificationUrl = extractUrl(normalizedRaw);
    }
  } else if (contentType === "STRUCTURED_TEXT") {
    const asJson = parseQrJson(normalizedRaw);
    if (asJson) {
      parsed = mergeParsedFields(parsed, asJson);
    }
    parsed = mergeParsedFields(parsed, parseQrKeyValueText(normalizedRaw));
    parsed = mergeParsedFields(parsed, parseGenericKeyValueText(normalizedRaw));
    const embeddedUrl = extractUrl(normalizedRaw);
    if (embeddedUrl) {
      verificationUrl = embeddedUrl;
    }
  } else {
    const asJson = parseQrJson(normalizedRaw);
    if (asJson) {
      parsed = mergeParsedFields(parsed, asJson);
    }
  }

  const extractedCount = Object.values(parsed).filter(
    (value) => (typeof value === "number" && value > 0) || (typeof value === "string" && value.trim().length > 0)
  ).length;
  const confidence: ReceiptFieldReadability = resolveQrConfidence({
    contentType,
    extractedCount,
    hasVerificationUrl: Boolean(verificationUrl)
  });
  const isTraVerification = isTraVerificationUrl(verificationUrl);
  const classifiedType: ReceiptQrContentType =
    contentType === "URL" && isTraVerification ? "TRA_URL" : contentType;
  const parseStatus: ReceiptQrParseStatus =
    extractedCount >= 3 ? "PARSED" : extractedCount > 0 || Boolean(verificationUrl) ? "PARTIAL" : "UNPARSED";

  const warnings: string[] = [];
  if (parseStatus === "PARTIAL") {
    warnings.push("QR was captured with limited fields. OCR/manual review is recommended.");
  }
  if (parseStatus === "UNPARSED") {
    warnings.push("QR was captured, but structured parsing needs review. Raw QR content is available.");
  }
  if (contentType === "UNKNOWN") {
    warnings.push("QR content was captured but format is unrecognized. Review manually.");
  }
  if (verificationUrl && !isTraVerification) {
    warnings.push("QR URL is non-TRA. Stored as a standard verification link.");
  }
  const failureReason = parseStatus === "UNPARSED" ? "QR decoded but parse failed" : "";

  return {
    detected: true,
    rawValue: normalizedRaw,
    contentType: classifiedType,
    isTraVerification,
    isQrOnlyImage,
    decodeStatus: "DECODED",
    decodePass,
    parseStatus,
    failureReason,
    verificationUrl,
    parsedFields: parsed,
    parsedLineCandidates: [],
    confidence,
    warnings,
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
        reason: "",
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

function detectQrContentType(value: string): ReceiptQrContentType {
  const normalized = value.trim();
  if (!normalized) {
    return "NONE";
  }
  if (/^https?:\/\//i.test(normalized)) {
    return "URL";
  }
  if (looksLikeStructuredText(normalized)) {
    return "STRUCTURED_TEXT";
  }
  return "UNKNOWN";
}

function looksLikeStructuredText(value: string) {
  if (!value) {
    return false;
  }
  if (/[a-z][a-z0-9_\s-]{1,32}\s*=\s*[^&;\n\r]+/i.test(value)) {
    return true;
  }
  if (/[a-z][a-z0-9_\s-]{1,32}\s*:\s*[^&;\n\r]+/i.test(value)) {
    return true;
  }
  if ((value.startsWith("{") && value.endsWith("}")) || (value.startsWith("[") && value.endsWith("]"))) {
    return true;
  }
  const lower = value.toLowerCase();
  return (
    /\b(?:supplier|merchant|store|tin|vrn|receipt|receipt_no|receiptnumber|date|total|amount|vat|tax)\b/.test(lower) &&
    /[=:]/.test(value)
  );
}

function resolveQrConfidence({
  contentType,
  extractedCount,
  hasVerificationUrl
}: {
  contentType: ReceiptQrContentType;
  extractedCount: number;
  hasVerificationUrl: boolean;
}): ReceiptFieldReadability {
  if (extractedCount >= 6) {
    return "HIGH";
  }
  if (extractedCount >= 3) {
    return "MEDIUM";
  }
  if (extractedCount > 0) {
    return "LOW";
  }
  if (contentType === "URL" && hasVerificationUrl) {
    return "LOW";
  }
  if (contentType === "STRUCTURED_TEXT" || contentType === "UNKNOWN") {
    return "LOW";
  }
  return "UNREADABLE";
}

function isTraVerificationUrl(value: string) {
  if (!value) {
    return false;
  }
  const url = toUrl(value);
  if (!url) {
    return false;
  }
  const hostname = url.hostname.toLowerCase();
  return hostname === "tra.go.tz" || hostname.endsWith(".tra.go.tz");
}

function mergeParsedFields(
  current: Partial<ReceiptHeaderExtraction>,
  patch: Partial<ReceiptHeaderExtraction>
) {
  const next: Partial<ReceiptHeaderExtraction> = { ...current };
  const writable = next as Record<string, unknown>;
  for (const [key, value] of Object.entries(patch)) {
    if (typeof value === "string") {
      if (value.trim()) {
        writable[key] = value;
      }
      continue;
    }
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      writable[key] = value;
    }
  }
  return next;
}

function parseQrFromUrl(url: URL): Partial<ReceiptHeaderExtraction> {
  const query = url.searchParams;
  const valueFrom = (...keys: string[]) => {
    for (const key of keys) {
      const value = query.get(key);
      if (value && value.trim()) {
        return value.trim();
      }
    }
    return "";
  };
  const numberFrom = (...keys: string[]) => {
    const value = valueFrom(...keys);
    const parsed = Number(value.replace(/,/g, ""));
    return Number.isFinite(parsed) ? roundCurrency(parsed) : 0;
  };

  return {
    receiptNumber: valueFrom("receiptNo", "receipt_number", "receipt", "rct", "rctNo"),
    verificationCode: valueFrom("verifyCode", "verificationCode", "code", "vcode"),
    supplierName: valueFrom("supplier", "merchant", "seller", "name"),
    tin: valueFrom("tin"),
    vrn: valueFrom("vrn", "vatNo"),
    serialNumber: valueFrom("serial", "serialNo", "sno"),
    receiptDate: normalizeQrDate(valueFrom("date", "receiptDate")),
    receiptTime: valueFrom("time", "receiptTime"),
    taxOffice: valueFrom("office", "taxOffice"),
    subtotal: numberFrom("subtotal", "subTotal", "amountBeforeTax"),
    tax: numberFrom("tax", "vat"),
    total: numberFrom("total", "amount", "grossTotal")
  };
}

function parseQrJson(raw: string): Partial<ReceiptHeaderExtraction> | null {
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    const obj = parsed as Record<string, unknown>;
    const numberOf = (value: unknown) => {
      const n = Number(value);
      return Number.isFinite(n) ? roundCurrency(n) : 0;
    };

    return {
      supplierName: toStringValue(obj.supplier || obj.merchant || obj.storeName),
      tin: toStringValue(obj.tin),
      vrn: toStringValue(obj.vrn || obj.vatNo),
      serialNumber: toStringValue(obj.serialNo || obj.serial),
      receiptNumber: toStringValue(obj.receiptNo || obj.receiptNumber || obj.receipt),
      verificationCode: toStringValue(obj.verificationCode || obj.verifyCode || obj.code),
      receiptDate: normalizeQrDate(toStringValue(obj.date || obj.receiptDate)),
      receiptTime: toStringValue(obj.time || obj.receiptTime),
      taxOffice: toStringValue(obj.taxOffice || obj.office),
      subtotal: numberOf(obj.subtotal || obj.subTotal),
      tax: numberOf(obj.tax || obj.vat),
      total: numberOf(obj.total || obj.amount)
    };
  } catch {
    return null;
  }
}

function parseQrKeyValueText(raw: string): Partial<ReceiptHeaderExtraction> {
  const field = (patterns: RegExp[]) => findPattern(raw, patterns);
  const amountField = (patterns: RegExp[]) => {
    const value = field(patterns);
    const numeric = Number(value.replace(/,/g, ""));
    return Number.isFinite(numeric) ? roundCurrency(numeric) : 0;
  };

  return {
    supplierName: field([/\b(?:supplier|merchant|store)\s*[:=\-]\s*([^\n]+)/i]),
    tin: field([/\btin\s*[:=\-]?\s*([0-9]{8,15})/i]),
    vrn: field([/\bvrn\s*[:=\-]?\s*([0-9a-z]{8,18})/i]),
    serialNumber: field([/\bserial\s*(?:no|number|#)?\s*[:=\-]?\s*([0-9a-z\-\/]{4,})/i]),
    receiptNumber: field([/\breceipt\s*(?:no|number|#)?\s*[:=\-]?\s*([0-9a-z\-\/]{4,})/i]),
    verificationCode: field([/\b(?:verify|verification)\s*(?:code|no|#)?\s*[:=\-]?\s*([0-9a-z\-]{4,})/i]),
    receiptDate: normalizeQrDate(field([/\bdate\s*[:=\-]?\s*([0-9]{4}[\/-][0-9]{1,2}[\/-][0-9]{1,2})/i])),
    receiptTime: field([/\btime\s*[:=\-]?\s*([0-2]?\d:[0-5]\d(?:\s*[ap]m)?)/i]),
    subtotal: amountField([/\bsubtotal\s*[:=\-]?\s*([0-9][0-9,]*(?:\.\d+)?)/i]),
    tax: amountField([/\b(?:tax|vat)\s*[:=\-]?\s*([0-9][0-9,]*(?:\.\d+)?)/i]),
    total: amountField([/\btotal\s*[:=\-]?\s*([0-9][0-9,]*(?:\.\d+)?)/i])
  };
}

function parseGenericKeyValueText(raw: string): Partial<ReceiptHeaderExtraction> {
  const segments = raw
    .split(/[\n\r&;|]+/g)
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (segments.length === 0) {
    return {};
  }

  const keyValueMap = new Map<string, string>();
  for (const segment of segments) {
    const pair = segment.match(/^([^:=]{2,50})\s*[:=]\s*(.+)$/);
    if (!pair) {
      continue;
    }
    const key = normalizeQrKey(pair[1] || "");
    const value = (pair[2] || "").trim();
    if (!key || !value) {
      continue;
    }
    keyValueMap.set(key, value);
  }

  if (keyValueMap.size === 0) {
    return {};
  }

  const valueFrom = (...keys: string[]) => {
    for (const key of keys) {
      const value = keyValueMap.get(normalizeQrKey(key));
      if (value && value.trim()) {
        return value.trim();
      }
    }
    return "";
  };

  const numberFrom = (...keys: string[]) => {
    const value = valueFrom(...keys);
    const parsed = Number(value.replace(/,/g, ""));
    return Number.isFinite(parsed) ? roundCurrency(parsed) : 0;
  };

  return {
    supplierName: valueFrom("supplier", "merchant", "store", "seller", "name"),
    tin: valueFrom("tin"),
    vrn: valueFrom("vrn", "vatno", "vatnumber"),
    serialNumber: valueFrom("serial", "serialno", "sno"),
    receiptNumber: valueFrom("receiptno", "receiptnumber", "receipt", "rct", "rctno"),
    verificationCode: valueFrom("verificationcode", "verifycode", "verification", "vcode", "code"),
    receiptDate: normalizeQrDate(valueFrom("date", "receiptdate")),
    receiptTime: valueFrom("time", "receipttime"),
    taxOffice: valueFrom("taxoffice", "office"),
    subtotal: numberFrom("subtotal", "subtotalamount", "subtotalvalue", "subtotalamt"),
    tax: numberFrom("tax", "vat"),
    total: numberFrom("total", "amount", "gross", "grossamount")
  };
}

function normalizeQrKey(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .trim();
}

function extractUrl(value: string) {
  const match = value.match(/https?:\/\/[^\s]+/i);
  return match?.[0] || "";
}

function toUrl(value: string) {
  try {
    if (!/^https?:\/\//i.test(value)) {
      return null;
    }
    return new URL(value);
  } catch {
    return null;
  }
}

function normalizeQrDate(value: string) {
  if (!value) {
    return "";
  }
  return findDate(value);
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

async function buildImageOcrVariants(fileBuffer: Buffer) {
  try {
    const source = sharp(fileBuffer, { failOn: "none" }).rotate();
    const metadata = await source.metadata();
    const targetWidth = metadata.width && metadata.width > 1800 ? 1800 : metadata.width && metadata.width < 1200 ? 1600 : null;
    const resizeConfig = targetWidth
      ? {
          width: targetWidth,
          withoutEnlargement: false
        }
      : null;

    const basePipeline = () => {
      let pipeline = source.clone();
      if (resizeConfig) {
        pipeline = pipeline.resize(resizeConfig);
      }
      return pipeline;
    };

    const variants: Array<{
      label: string;
      preprocessingApplied: string[];
      bufferPromise: Promise<Buffer>;
    }> = [
      {
        label: "original",
        preprocessingApplied: ["original"],
        bufferPromise: basePipeline().toBuffer()
      },
      {
        label: "thermal-enhanced",
        preprocessingApplied: ["grayscale", "normalize", "sharpen", "median", "trim"],
        bufferPromise: basePipeline().grayscale().normalize().sharpen().median(1).trim().toBuffer()
      },
      {
        label: "thermal-threshold",
        preprocessingApplied: ["grayscale", "normalize", "threshold", "trim"],
        bufferPromise: basePipeline().grayscale().normalize().threshold(165).trim().toBuffer()
      },
      {
        label: "contrast-emphasis",
        preprocessingApplied: ["grayscale", "linear-contrast", "sharpen"],
        bufferPromise: basePipeline().grayscale().linear(1.18, -14).sharpen().toBuffer()
      }
    ];

    const resolved: Array<{
      label: string;
      buffer: Buffer;
      preprocessingApplied: string[];
    }> = [];

    for (const variant of variants) {
      try {
        const buffer = await variant.bufferPromise;
        resolved.push({
          label: variant.label,
          buffer,
          preprocessingApplied: variant.preprocessingApplied
        });
      } catch {
        // Skip failed preprocessing variants and continue with others.
      }
    }

    return resolved;
  } catch {
    return [
      {
        label: "original",
        buffer: fileBuffer,
        preprocessingApplied: ["original"]
      }
    ];
  }
}

function scoreOcrCandidate(text: string, confidence: number) {
  const cleaned = text.trim();
  if (!cleaned) {
    return 0;
  }

  const textLengthScore = Math.min(cleaned.length / 2200, 1) * 0.45;
  const confidenceScore = Math.min(Math.max(confidence, 0) / 100, 1) * 0.35;
  const digits = cleaned.match(/\d/g)?.length ?? 0;
  const alpha = cleaned.match(/[a-z]/gi)?.length ?? 0;
  const numericBalance = digits > 0 && alpha > 0 ? 0.12 : digits > 0 || alpha > 0 ? 0.06 : 0;
  const receiptHintBonus = containsAny(cleaned.toLowerCase(), ["receipt", "tin", "vat", "subtotal", "total"])
    ? 0.08
    : 0;

  return textLengthScore + confidenceScore + numericBalance + receiptHintBonus;
}

function roundTo(value: number, decimals: number) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function extractHeaderFields(text: string, fileName: string): HeaderExtractionResult {
  const lines = text
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter(Boolean);

  const supplierLine =
    lines.find((line) => /[a-z]/i.test(line) && !containsAny(line.toLowerCase(), ["receipt", "invoice", "tin", "tel"])) ||
    "";
  const supplierName = supplierLine || fileName.replace(/\.[^.]+$/, "") || "Unknown Supplier";

  const tin = findPattern(text, [
    /\btin\s*(?:no|number|#)?\s*[:\-]?\s*([0-9]{8,15})\b/i,
    /\btin[:\s]+([0-9]{8,15})\b/i
  ]);
  const vrn = findPattern(text, [
    /\bvrn\s*(?:no|number|#)?\s*[:\-]?\s*([0-9a-z]{8,18})\b/i,
    /\bvat\s*reg(?:istration)?\s*(?:no|number|#)?\s*[:\-]?\s*([0-9a-z]{8,18})\b/i
  ]);
  const serialNumber = findPattern(text, [
    /\bserial\s*(?:no|number|#)?\s*[:\-]?\s*([0-9a-z\-\/]{4,})\b/i,
    /\bs\/n\s*[:\-]?\s*([0-9a-z\-\/]{4,})\b/i
  ]);
  const receiptNumber = findPattern(text, [
    /\breceipt\s*(?:no|number|#)?\s*[:\-]?\s*([0-9a-z\-\/]{4,})\b/i,
    /\brct\s*no\s*[:\-]?\s*([0-9a-z\-\/]{4,})\b/i
  ]);
  const verificationCode = findPattern(text, [
    /\b(?:verification|verify|vcode)\s*(?:code|no|#)?\s*[:\-]?\s*([0-9a-z\-]{4,})\b/i
  ]);
  const receiptDate = findDate(text) || new Date().toISOString().slice(0, 10);
  const receiptTime = findTime(text);
  const traReceiptNumber = findPattern(text, [
    /\b(?:tra\s*)?(?:receipt)\s*(?:no|number|#)?\s*[:\-]?\s*([a-z0-9\-\/]+)/i,
    /\b(?:tra)\s*(?:ref|reference|no|#)?\s*[:\-]?\s*([a-z0-9\-\/]+)/i
  ]);
  const invoiceReference = findPattern(text, [
    /\b(?:invoice|inv|ref(?:erence)?)\s*(?:no|number|#)?\s*[:\-]?\s*([a-z0-9\-\/]+)/i
  ]);
  const paymentMethod = findPaymentMethod(text);
  const taxOffice = findPattern(text, [
    /\b(?:tax office|office)\s*[:\-]?\s*([a-z0-9\s\-]{4,})/i
  ]);
  const currency = findCurrency(text);
  const subtotal = findLabeledAmount(text, ["sub total", "subtotal"]);
  const tax = findLabeledAmount(text, ["vat", "tax"]);
  const total = findTotalAmount(text, subtotal + tax);
  const itemCount = findItemCount(text);

  const header: ReceiptHeaderExtraction = {
    supplierName: supplierName || "Unknown Supplier",
    tin,
    vrn,
    serialNumber,
    receiptNumber,
    verificationCode,
    receiptDate,
    receiptTime,
    traReceiptNumber,
    invoiceReference,
    paymentMethod,
    taxOffice,
    currency,
    itemCount,
    subtotal: roundCurrency(subtotal),
    tax: roundCurrency(tax),
    total: roundCurrency(total)
  };

  const fieldConfidence: ReceiptFieldConfidenceMap = {
    supplierName: readabilityForText(header.supplierName, { minLength: 3, allowDefaultUnknown: true }),
    tin: readabilityForStructuredId(header.tin),
    vrn: readabilityForStructuredId(header.vrn),
    serialNumber: readabilityForStructuredId(header.serialNumber),
    receiptNumber: readabilityForStructuredId(header.receiptNumber),
    verificationCode: readabilityForStructuredId(header.verificationCode),
    receiptDate: readabilityForDate(header.receiptDate),
    receiptTime: readabilityForTime(header.receiptTime),
    traReceiptNumber: readabilityForStructuredId(header.traReceiptNumber),
    invoiceReference: readabilityForStructuredId(header.invoiceReference),
    paymentMethod: readabilityForText(header.paymentMethod, { minLength: 2 }),
    taxOffice: readabilityForText(header.taxOffice, { minLength: 4 }),
    currency: readabilityForStructuredId(header.currency),
    subtotal: readabilityForAmount(header.subtotal),
    tax: readabilityForAmount(header.tax),
    total: readabilityForAmount(header.total),
    itemCount: readabilityForCount(header.itemCount)
  };

  return {
    header,
    fieldConfidence
  };
}

function extractLineCandidates(text: string): ReceiptLineCandidate[] {
  const lines = text
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter(Boolean);

  const results: ReceiptLineCandidate[] = [];
  for (const rawLine of lines) {
    const line = normalizeWhitespace(rawLine);
    if (!/[a-z]/i.test(line)) {
      continue;
    }
    if (containsAny(line.toLowerCase(), lineSkipKeywords)) {
      continue;
    }

    const explicit = parseExplicitLinePattern(line);
    if (explicit) {
      results.push(explicit);
      continue;
    }

    const fallback = parseFallbackLinePattern(line);
    if (fallback) {
      results.push(fallback);
    }
  }

  if (results.length === 0) {
    return [];
  }

  return mergeDuplicateLineCandidates(results);
}

function parseExplicitLinePattern(line: string): ReceiptLineCandidate | null {
  const match = line.match(
    /^(.*?)[\s\t]+(\d+(?:[.,]\d+)?)\s*(?:x|@)?\s*(\d[\d,]*(?:\.\d+)?)\s+(\d[\d,]*(?:\.\d+)?)$/i
  );
  if (!match) {
    return null;
  }

  const description = cleanupDescription(match[1] || "");
  const quantity = parseNumberSafe(match[2] || "");
  const unitPrice = parseNumberSafe(match[3] || "");
  const lineTotal = parseNumberSafe(match[4] || "");
  if (!description || quantity <= 0 || unitPrice < 0 || lineTotal < 0) {
    return null;
  }

  return {
    description,
    quantity,
    unitPrice: roundCurrency(unitPrice),
    lineTotal: roundCurrency(lineTotal),
    extractionConfidence: "HIGH"
  };
}

function parseFallbackLinePattern(line: string): ReceiptLineCandidate | null {
  const amountMatches = line.match(/-?\d[\d,]*(?:\.\d+)?/g) || [];
  const amounts = amountMatches.map((token) => parseNumberSafe(token)).filter((value) => Number.isFinite(value) && value > 0);
  if (amounts.length === 0) {
    return null;
  }

  const description = cleanupDescription(line.replace(/-?\d[\d,]*(?:\.\d+)?/g, " "));
  if (!description || description.length < 3) {
    return null;
  }

  if (amounts.length >= 2) {
    const qtyCandidate = amounts[0] <= 1000 ? amounts[0] : 1;
    const lineTotal = amounts[amounts.length - 1];
    let unitPrice = amounts.length >= 3 ? amounts[amounts.length - 2] : lineTotal / Math.max(1, qtyCandidate);
    if (Math.abs(unitPrice - lineTotal) < 0.01 && qtyCandidate > 1) {
      unitPrice = lineTotal / qtyCandidate;
    }
    return {
      description,
      quantity: roundCurrency(Math.max(1, qtyCandidate)),
      unitPrice: roundCurrency(Math.max(0, unitPrice)),
      lineTotal: roundCurrency(Math.max(0, lineTotal)),
      extractionConfidence: "MEDIUM"
    };
  }

  return {
    description,
    quantity: 1,
    unitPrice: roundCurrency(amounts[0]),
    lineTotal: roundCurrency(amounts[0]),
    extractionConfidence: "LOW"
  };
}

function mergeDuplicateLineCandidates(lines: ReceiptLineCandidate[]) {
  const byDescription = new Map<string, ReceiptLineCandidate>();
  for (const line of lines) {
    const key = normalizeName(line.description);
    if (!key) {
      continue;
    }
    const existing = byDescription.get(key);
    if (!existing) {
      byDescription.set(key, line);
      continue;
    }
    const mergedQuantity = roundCurrency(existing.quantity + line.quantity);
    const mergedTotal = roundCurrency(existing.lineTotal + line.lineTotal);
    byDescription.set(key, {
      description: existing.description,
      quantity: mergedQuantity,
      unitPrice: mergedQuantity > 0 ? roundCurrency(mergedTotal / mergedQuantity) : existing.unitPrice,
      lineTotal: mergedTotal,
      extractionConfidence:
        existing.extractionConfidence === "LOW" || line.extractionConfidence === "LOW"
          ? "LOW"
          : existing.extractionConfidence === "MEDIUM" || line.extractionConfidence === "MEDIUM"
            ? "MEDIUM"
            : "HIGH"
    });
  }
  return Array.from(byDescription.values()).slice(0, 80);
}

function suggestInventoryMatch(description: string, items: InventoryReferenceItem[]): ReceiptLineMatchSuggestion {
  const normalizedDescription = normalizeName(description);
  const compactDescription = normalizeCompactName(description);
  const descriptionTokens = splitNormalizedTokens(normalizedDescription);
  if (!normalizedDescription || items.length === 0) {
    return {
      itemId: null,
      itemName: null,
      confidence: "NONE",
      score: 0
    };
  }

  let best: { id: string; name: string; score: number } | null = null;
  for (const item of items) {
    const normalizedName = normalizeName(item.name);
    const normalizedSku = normalizeName(item.sku);
    const compactName = normalizeCompactName(item.name);
    const compactSku = normalizeCompactName(item.sku);
    const itemTokens = splitNormalizedTokens(normalizedName);
    let score = similarityScore(normalizedDescription, normalizedName);
    score = Math.max(score, tokenOverlapScore(descriptionTokens, itemTokens));

    if (normalizedDescription === normalizedName) {
      score = 1;
    } else if (compactDescription && compactName && compactDescription === compactName) {
      score = Math.max(score, 0.96);
    } else if (
      compactDescription &&
      compactName &&
      (compactDescription.includes(compactName) || compactName.includes(compactDescription))
    ) {
      score = Math.max(score, 0.9);
    } else if (normalizedDescription.includes(normalizedName) || normalizedName.includes(normalizedDescription)) {
      score = Math.max(score, 0.85);
    } else if (normalizedSku && normalizedDescription.includes(normalizedSku)) {
      score = Math.max(score, 0.78);
    } else if (
      compactSku &&
      compactDescription &&
      (compactDescription.includes(compactSku) || compactSku.includes(compactDescription))
    ) {
      score = Math.max(score, 0.8);
    }

    if (!best || score > best.score) {
      best = {
        id: item.id,
        name: item.name,
        score
      };
    }
  }

  if (!best || best.score < 0.72) {
    return {
      itemId: null,
      itemName: null,
      confidence: "NONE",
      score: roundCurrency(best?.score || 0)
    };
  }

  const confidence: ReceiptFieldConfidence = best.score >= 0.88 ? "HIGH" : "MEDIUM";
  return {
    itemId: best.id,
    itemName: best.name,
    confidence,
    score: roundCurrency(best.score)
  };
}

function normalizeName(value: string) {
  return value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Za-z])(\d)/g, "$1 $2")
    .replace(/(\d)([A-Za-z])/g, "$1 $2")
    .toLowerCase()
    .replace(/[._,/\\-]+/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeCompactName(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "").trim();
}

function splitNormalizedTokens(value: string) {
  if (!value) {
    return [];
  }
  return value.split(" ").filter(Boolean);
}

function tokenOverlapScore(left: string[], right: string[]) {
  if (left.length === 0 || right.length === 0) {
    return 0;
  }
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  let intersection = 0;
  for (const token of leftSet) {
    if (rightSet.has(token)) {
      intersection += 1;
    }
  }
  const union = new Set([...leftSet, ...rightSet]).size;
  if (union === 0) {
    return 0;
  }
  return intersection / union;
}

function cleanupDescription(value: string) {
  return normalizeWhitespace(value)
    .replace(/^[x@\-:|]+/g, "")
    .replace(/\bqty\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function parseNumberSafe(value: string) {
  const cleaned = value.replace(/,/g, "").trim();
  const parsed = Number(cleaned);
  if (Number.isNaN(parsed)) {
    return 0;
  }
  return parsed;
}

function toStringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function findPattern(text: string, patterns: RegExp[]) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      return match[1].trim();
    }
  }
  return "";
}

function findDate(text: string) {
  const iso = text.match(/\b(20\d{2})[\/-](\d{1,2})[\/-](\d{1,2})\b/);
  if (iso) {
    const [, year, month, day] = iso;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }

  const dmy = text.match(/\b(\d{1,2})[\/-](\d{1,2})[\/-](20\d{2})\b/);
  if (dmy) {
    const [, day, month, year] = dmy;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }

  return "";
}

function findTime(text: string) {
  const twelveHour = text.match(/\b(0?[1-9]|1[0-2]):([0-5]\d)\s*([ap]m)\b/i);
  if (twelveHour) {
    const [, hour, minute, meridiem] = twelveHour;
    return `${hour.padStart(2, "0")}:${minute} ${meridiem.toUpperCase()}`;
  }

  const twentyFour = text.match(/\b([01]?\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?\b/);
  if (twentyFour) {
    const [, hour, minute] = twentyFour;
    return `${hour.padStart(2, "0")}:${minute}`;
  }

  return "";
}

function findPaymentMethod(text: string) {
  const lower = text.toLowerCase();
  if (containsAny(lower, ["cash", "paid cash"])) {
    return "Cash";
  }
  if (containsAny(lower, ["mpesa", "m-pesa"])) {
    return "M-Pesa";
  }
  if (containsAny(lower, ["card", "visa", "mastercard", "pos"])) {
    return "Card";
  }
  if (containsAny(lower, ["bank transfer", "eft", "transfer"])) {
    return "Bank Transfer";
  }
  if (containsAny(lower, ["credit"])) {
    return "Credit";
  }
  return "";
}

function findItemCount(text: string) {
  const countMatch = text.match(/\b(?:items?|qty|quantity)\s*[:\-]?\s*(\d{1,4})\b/i);
  if (countMatch?.[1]) {
    return Number(countMatch[1]);
  }

  const lines = text
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter(Boolean);
  const probableItemLines = lines.filter((line) => {
    if (containsAny(line.toLowerCase(), lineSkipKeywords)) {
      return false;
    }
    const amounts = line.match(/-?\d[\d,]*(?:\.\d+)?/g) || [];
    return amounts.length >= 1 && /[a-z]/i.test(line);
  });

  if (probableItemLines.length === 0) {
    return 0;
  }
  return Math.min(probableItemLines.length, 999);
}

function readabilityForText(
  value: string,
  options?: {
    minLength?: number;
    allowDefaultUnknown?: boolean;
  }
): ReceiptFieldReadability {
  const normalized = value.trim();
  if (!normalized) {
    return "UNREADABLE";
  }
  if (options?.allowDefaultUnknown && normalized.toLowerCase() === "unknown supplier") {
    return "LOW";
  }
  const minLength = options?.minLength ?? 3;
  if (normalized.length >= Math.max(minLength + 4, 8)) {
    return "HIGH";
  }
  if (normalized.length >= minLength) {
    return "MEDIUM";
  }
  return "LOW";
}

function readabilityForStructuredId(value: string): ReceiptFieldReadability {
  const normalized = value.trim();
  if (!normalized) {
    return "UNREADABLE";
  }
  if (/^[a-z0-9\-\/]{8,}$/i.test(normalized)) {
    return "HIGH";
  }
  if (/^[a-z0-9\-\/]{5,}$/i.test(normalized)) {
    return "MEDIUM";
  }
  return "LOW";
}

function readabilityForDate(value: string): ReceiptFieldReadability {
  if (!value) {
    return "UNREADABLE";
  }
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? "HIGH" : "LOW";
}

function readabilityForTime(value: string): ReceiptFieldReadability {
  if (!value) {
    return "UNREADABLE";
  }
  return /^([01]\d|2[0-3]):[0-5]\d(?:\s[AP]M)?$/.test(value) ? "HIGH" : "LOW";
}

function readabilityForAmount(value: number): ReceiptFieldReadability {
  if (!Number.isFinite(value) || value <= 0) {
    return "UNREADABLE";
  }
  return value >= 1 ? "HIGH" : "LOW";
}

function readabilityForCount(value: number): ReceiptFieldReadability {
  if (!Number.isFinite(value) || value <= 0) {
    return "UNREADABLE";
  }
  return value >= 1 ? "HIGH" : "MEDIUM";
}

function detectReceiptType({
  text,
  lines
}: {
  text: string;
  lines: ReceiptLineExtraction[];
}): ReceiptType {
  const lower = text.toLowerCase();
  const inventoryKeywords = [
    "filter",
    "hose",
    "belt",
    "bit",
    "rod",
    "bearing",
    "hydraulic",
    "compressor",
    "engine oil",
    "spare part",
    "drill"
  ];
  const expenseKeywords = ["hotel", "lodge", "restaurant", "meal", "transport", "taxi", "airtime", "office"];

  const lineText = lines.map((line) => line.description.toLowerCase()).join(" ");
  if (
    lines.length > 0 &&
    (containsAny(lower, inventoryKeywords) ||
      containsAny(lineText, inventoryKeywords) ||
      lines.some((line) => line.matchSuggestion.itemId))
  ) {
    return "INVENTORY_PURCHASE";
  }
  if (containsAny(lower, expenseKeywords) || containsAny(lineText, expenseKeywords)) {
    return "GENERAL_EXPENSE";
  }
  return "UNCLEAR";
}

function resolveScanStatus({
  text,
  lines,
  fieldConfidence,
  qr
}: {
  text: string;
  lines: ReceiptLineExtraction[];
  fieldConfidence: ReceiptFieldConfidenceMap;
  qr: ReceiptQrResult;
}): ReceiptScanStatus {
  const verificationLookup = qr.stages.verificationLookup;
  const hasTraCoreParse =
    verificationLookup.attempted &&
    verificationLookup.status === "SUCCESS" &&
    (verificationLookup.parsed || verificationLookup.parsedFieldCount >= 6);
  if (hasTraCoreParse) {
    return "COMPLETE";
  }

  if (qr.decodeStatus === "DECODED" && qr.rawValue.trim()) {
    // QR decode success is its own valid signal, even when OCR text is empty.
    // Keep this as PARTIAL unless full OCR/header confidence also indicates COMPLETE.
    if (!text.trim()) {
      return "PARTIAL";
    }
    if (qr.parseStatus === "UNPARSED") {
      return "PARTIAL";
    }
  }

  if (!text.trim()) {
    return "UNREADABLE";
  }

  const readableHeaderFields = Object.values(fieldConfidence).filter(
    (confidence) => confidence !== "UNREADABLE"
  ).length;
  if (readableHeaderFields <= 2 && lines.length === 0) {
    return "UNREADABLE";
  }

  const lowConfidenceLineCount = lines.filter((line) => line.extractionConfidence === "LOW").length;
  const hasPartialSignals = lines.length === 0 || lowConfidenceLineCount > 0 || readableHeaderFields < 8;
  return hasPartialSignals ? "PARTIAL" : "COMPLETE";
}

function findCurrency(text: string) {
  const upper = text.toUpperCase();
  if (upper.includes("TZS") || upper.includes("T SH") || upper.includes("TSH")) return "TZS";
  if (upper.includes("USD")) return "USD";
  if (upper.includes("KES")) return "KES";
  if (upper.includes("EUR")) return "EUR";
  return "TZS";
}

function findLabeledAmount(text: string, labels: string[]) {
  const rows = text.split(/\r?\n/g);
  for (const row of rows) {
    const normalized = row.toLowerCase();
    if (!containsAny(normalized, labels)) {
      continue;
    }
    const amounts = row.match(/-?\d[\d,]*(?:\.\d+)?/g) || [];
    if (amounts.length === 0) {
      continue;
    }
    const value = parseNumberSafe(amounts[amounts.length - 1]);
    if (value > 0) {
      return value;
    }
  }
  return 0;
}

function findTotalAmount(text: string, fallbackTotal: number) {
  const rows = text.split(/\r?\n/g);
  const candidateTotals: number[] = [];
  for (const row of rows) {
    const normalized = row.toLowerCase();
    if (!containsAny(normalized, ["total", "grand total", "amount due"])) {
      continue;
    }
    const amounts = row.match(/-?\d[\d,]*(?:\.\d+)?/g) || [];
    if (amounts.length === 0) {
      continue;
    }
    const value = parseNumberSafe(amounts[amounts.length - 1]);
    if (value > 0) {
      candidateTotals.push(value);
    }
  }

  if (candidateTotals.length === 0) {
    return fallbackTotal > 0 ? fallbackTotal : 0;
  }

  return Math.max(...candidateTotals);
}

function containsAny(value: string, keywords: string[]) {
  return keywords.some((keyword) => value.includes(keyword));
}

function similarityScore(a: string, b: string) {
  if (!a || !b) {
    return 0;
  }
  if (a === b) {
    return 1;
  }
  const aTokens = new Set(a.split(" "));
  const bTokens = new Set(b.split(" "));
  let intersection = 0;
  for (const token of aTokens) {
    if (bTokens.has(token)) {
      intersection += 1;
    }
  }
  const union = new Set([...aTokens, ...bTokens]).size;
  return union === 0 ? 0 : intersection / union;
}
