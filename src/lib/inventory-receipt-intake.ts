import { inferCategorySuggestion } from "@/lib/inventory-intelligence";
import { suggestInventoryMatch } from "@/lib/inventory-receipt-intake-match";
import { extractHeaderFields, extractLineCandidates } from "@/lib/inventory-receipt-intake-ocr";
import { OCR_ENRICHMENT_TIMEOUT_MS, extractRawText, normalizeOcrEnrichmentError } from "@/lib/inventory-receipt-intake-ocr-enrichment";
import { containsAny } from "@/lib/inventory-receipt-intake-parse-utils";
import { buildReceiptScanDiagnostics } from "@/lib/inventory-receipt-intake-payload";
import {
  buildEmptyHeaderResult,
  extractQrDataFromReceipt,
  hasMeaningfulMetadataFromQr,
  listMissingHeaderFields,
  listPresentHeaderFields,
  listReadableHeaderFields,
  mergeHeaderResults,
  resolveExtractionMethod
} from "@/lib/inventory-receipt-intake-qr-pipeline";
import { detectReceiptType, resolveScanStatus } from "@/lib/inventory-receipt-intake-reconcile";
import type {
  InventoryReferenceItem,
  ReceiptExtractionResult,
  ReceiptFieldConfidence,
  ReceiptHeaderExtraction,
  ReceiptQrAssistCrop
} from "@/lib/inventory-receipt-intake-types";
import { debugLog } from "@/lib/observability";

export type {
  HeaderExtractionResult,
  InventoryReferenceItem,
  ReceiptCategorySuggestion,
  ReceiptExtractionResult,
  ReceiptFieldConfidence,
  ReceiptFieldConfidenceMap,
  ReceiptFieldReadability,
  ReceiptFieldSource,
  ReceiptFieldSourceMap,
  ReceiptHeaderExtraction,
  ReceiptLineCandidate,
  ReceiptLineConfidence,
  ReceiptLineExtraction,
  ReceiptLineMatchSuggestion,
  ReceiptQrAssistCrop,
  ReceiptQrContentType,
  ReceiptQrDecodeStatus,
  ReceiptQrParseStatus,
  ReceiptQrResult,
  ReceiptQrStages,
  ReceiptScanDiagnostics,
  ReceiptScanFailureStage,
  ReceiptScanStatus,
  ReceiptType,
  ReceiptVerificationLookupStatus
} from "@/lib/inventory-receipt-intake-types";

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

function hasHeaderFieldValue(value: unknown) {
  if (typeof value === "number") {
    return Number.isFinite(value) && value > 0;
  }
  return typeof value === "string" && value.trim().length > 0;
}

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
