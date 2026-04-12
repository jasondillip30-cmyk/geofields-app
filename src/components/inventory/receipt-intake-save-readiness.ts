import type { ReviewState, SaveReadiness, ScanDiagnosticsState, ScanFailureStage } from "@/components/inventory/receipt-intake-panel-types";
import {
  detectRawPayloadFormat,
  failureStageMessage,
  normalizeRawPayloadFormat,
  normalizeRawQrForDisplay,
  normalizeScanFailureStage,
  parseOptionalFiniteNumber,
  resolveScanFailureStageFromSignals,
  truncateQrPreview,
  countPopulatedRecordFields
} from "@/components/inventory/receipt-intake-diagnostics-utils";
import {
  normalizeQrContentType,
  normalizeQrDecodeStatus,
  normalizeQrLookupStatus,
  normalizeQrParseStatus,
  normalizeScanStatus
} from "@/components/inventory/receipt-intake-scan-utils";
import { resolveCreateExpenseForPurpose, resolveWorkflowChoiceFromReview } from "@/components/inventory/receipt-intake-workflow-utils";

const SCAN_FALLBACK_MESSAGE = "Scan could not extract receipt data. Please complete manually.";

function asString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function asRecord(value: unknown) {
  if (!value || typeof value !== "object") {
    return null;
  }
  return value as Record<string, unknown>;
}

export async function readJsonPayload(response: Response): Promise<unknown | null> {
  const contentType = (response.headers.get("content-type") || "").toLowerCase();
  if (!contentType.includes("application/json")) {
    return null;
  }
  return response.json().catch(() => null);
}

export function readApiError(response: Response, payload: unknown, fallbackMessage: string) {
  if (payload && typeof payload === "object") {
    const candidate = payload as Record<string, unknown>;
    const possibleMessage = [candidate.error, candidate.message, candidate.detail].find(
      (entry) => typeof entry === "string" && entry.trim().length > 0
    );
    if (typeof possibleMessage === "string" && possibleMessage.trim()) {
      return possibleMessage.trim();
    }
  }

  if (response.status === 413) {
    return "Receipt file is too large. Please upload a smaller file.";
  }
  if (response.status === 415) {
    return "Unsupported file type. Please upload a receipt image or PDF.";
  }
  if (response.status === 401 || response.status === 403) {
    return "You do not have permission to process receipts.";
  }

  return fallbackMessage;
}

export function readPayloadMessage(payload: unknown, fallbackMessage: string) {
  if (payload && typeof payload === "object") {
    const candidate = payload as Record<string, unknown>;
    const possibleMessage = [candidate.message, candidate.error, candidate.detail].find(
      (entry) => typeof entry === "string" && entry.trim().length > 0
    );
    if (typeof possibleMessage === "string" && possibleMessage.trim()) {
      return possibleMessage.trim();
    }
  }
  return fallbackMessage;
}

export function readDebugFlags(payload: unknown): ReviewState["debugFlags"] {
  const root = asRecord(payload);
  const debugFlags = asRecord(root?.debugFlags);
  const returnedFromRaw = asString(debugFlags?.returnedFrom);
  return {
    qrDecoded: Boolean(debugFlags?.qrDecoded),
    traLookupSucceeded: Boolean(debugFlags?.traLookupSucceeded),
    traParseSucceeded: Boolean(debugFlags?.traParseSucceeded),
    ocrAttempted: Boolean(debugFlags?.ocrAttempted),
    ocrSucceeded: Boolean(debugFlags?.ocrSucceeded),
    ocrError: asString(debugFlags?.ocrError),
    enrichmentWarning: asString(debugFlags?.enrichmentWarning),
    returnedFrom: returnedFromRaw === "qr_tra_plus_ocr" ? "qr_tra_plus_ocr" : "qr_tra",
    partialEnrichment: Boolean(debugFlags?.partialEnrichment)
  };
}

export function readScanDiagnostics(payload: unknown, extractedOverride?: Record<string, unknown> | null): ScanDiagnosticsState {
  const root = asRecord(payload);
  const extracted = extractedOverride || asRecord(root?.extracted);
  const qr = asRecord(extracted?.qr);
  const qrStages = asRecord(qr?.stages);
  const qrLookup = asRecord(qrStages?.verificationLookup);
  const qrDebug = asRecord(qr?.debug);
  const scanDiagnostics = asRecord(root?.scanDiagnostics);
  const debugFlags = readDebugFlags(root);

  const decodeStatus = normalizeQrDecodeStatus(scanDiagnostics?.qrDecodeStatus ?? qr?.decodeStatus);
  const parseStatus = normalizeQrParseStatus(scanDiagnostics?.qrParseStatus ?? qr?.parseStatus);
  const lookupStatus = normalizeQrLookupStatus(scanDiagnostics?.qrLookupStatus ?? qrLookup?.status);
  const rawQrValue = asString(scanDiagnostics?.qrRawValue) || asString(qr?.rawValue);
  const normalizedRawFromPayload =
    asString(scanDiagnostics?.qrNormalizedRawValue) || asString(qr?.normalizedRawValue);
  const normalizedRawValue = normalizedRawFromPayload || normalizeRawQrForDisplay(rawQrValue);
  const rawLengthFromPayload = Number(scanDiagnostics?.qrRawLength);
  const rawLength = Number.isFinite(rawLengthFromPayload) && rawLengthFromPayload >= 0
    ? rawLengthFromPayload
    : rawQrValue.length;
  const rawPreview = asString(scanDiagnostics?.qrRawPreview) || truncateQrPreview(rawQrValue);
  const rawPayloadFormat = normalizeRawPayloadFormat(scanDiagnostics?.qrRawPayloadFormat) || detectRawPayloadFormat(rawQrValue);
  const qrParsedFields = asRecord(qr?.parsedFields);
  const parsedFieldCount =
    Number(scanDiagnostics?.qrParsedFieldCount ?? Number.NaN) > -1 &&
    Number.isFinite(Number(scanDiagnostics?.qrParsedFieldCount))
      ? Number(scanDiagnostics?.qrParsedFieldCount)
      : countPopulatedRecordFields(qrParsedFields);
  const parsedLineItemsCount =
    Number(scanDiagnostics?.qrParsedLineItemsCount ?? Number.NaN) > -1 &&
    Number.isFinite(Number(scanDiagnostics?.qrParsedLineItemsCount))
      ? Number(scanDiagnostics?.qrParsedLineItemsCount)
      : Array.isArray(qr?.parsedLineCandidates)
        ? qr.parsedLineCandidates.length
        : 0;
  const qrDetectedExplicit = scanDiagnostics?.qrDetected;
  const qrDetected =
    typeof qrDetectedExplicit === "boolean"
      ? qrDetectedExplicit
      : Boolean(qr?.detected) ||
        decodeStatus === "DECODED" ||
        decodeStatus === "DECODE_FAILED" ||
        normalizedRawValue.length > 0;

  const failureStage =
    normalizeScanFailureStage(scanDiagnostics?.failureStage) ||
    resolveScanFailureStageFromSignals({
      qrDetected,
      decodeStatus,
      parseStatus,
      lookupStatus
    });

  const attemptedPasses = Array.isArray(qrDebug?.attemptedPasses)
    ? qrDebug.attemptedPasses.map((entry) => asString(entry)).filter(Boolean)
    : [];
  const extractionMethod = asString(scanDiagnostics?.extractionMethod) || asString(extracted?.extractionMethod) || "UNKNOWN";

  return {
    failureStage,
    failureMessage: failureStageMessage(failureStage),
    qrDetected,
    qrDecodeStatus: decodeStatus,
    qrDecodePass: asString(scanDiagnostics?.qrDecodePass) || asString(qr?.decodePass),
    qrParseStatus: parseStatus,
    qrFailureReason: asString(scanDiagnostics?.qrFailureReason) || asString(qr?.failureReason),
    qrContentType: normalizeQrContentType(scanDiagnostics?.qrContentType ?? qr?.contentType),
    qrRawValue: rawQrValue,
    qrNormalizedRawValue: normalizedRawValue,
    qrRawLength: rawLength,
    qrRawPreview: rawPreview,
    qrRawPayloadFormat: rawPayloadFormat,
    qrVerificationUrl: asString(scanDiagnostics?.qrVerificationUrl) || asString(qr?.verificationUrl),
    qrIsTraVerification:
      typeof scanDiagnostics?.qrIsTraVerification === "boolean"
        ? scanDiagnostics.qrIsTraVerification
        : Boolean(qr?.isTraVerification),
    qrParsedFieldCount: parsedFieldCount,
    qrParsedLineItemsCount: parsedLineItemsCount,
    qrLookupStatus: lookupStatus,
    qrLookupReason: asString(scanDiagnostics?.qrLookupReason) || asString(qrLookup?.reason),
    qrLookupHttpStatus: parseOptionalFiniteNumber(scanDiagnostics?.qrLookupHttpStatus ?? qrLookup?.httpStatus),
    qrLookupParsed:
      typeof scanDiagnostics?.qrLookupParsed === "boolean"
        ? scanDiagnostics.qrLookupParsed
        : Boolean(qrLookup?.parsed),
    ocrAttempted:
      typeof scanDiagnostics?.ocrAttempted === "boolean" ? scanDiagnostics.ocrAttempted : debugFlags.ocrAttempted,
    ocrSucceeded:
      typeof scanDiagnostics?.ocrSucceeded === "boolean" ? scanDiagnostics.ocrSucceeded : debugFlags.ocrSucceeded,
    ocrError: asString(scanDiagnostics?.ocrError) || debugFlags.ocrError,
    scanStatus: normalizeScanStatus(scanDiagnostics?.scanStatus ?? extracted?.scanStatus),
    extractionMethod,
    returnedFrom:
      asString(scanDiagnostics?.returnedFrom) === "qr_tra_plus_ocr" || debugFlags.returnedFrom === "qr_tra_plus_ocr"
        ? "qr_tra_plus_ocr"
        : "qr_tra",
    attemptedPassCount: attemptedPasses.length,
    attemptedPassSample: attemptedPasses.slice(0, 8),
    successfulPass: asString(qrDebug?.successfulPass),
    variantCount: Math.max(0, Number(qrDebug?.variantCount ?? 0) || 0),
    imageReceived: typeof qrDebug?.imageReceived === "boolean" ? qrDebug.imageReceived : true,
    imageLoaded: typeof qrDebug?.imageLoaded === "boolean" ? qrDebug.imageLoaded : true
  };
}

export function buildSubmissionScanDiagnostics({
  rawQrValue,
  verificationUrl,
  scanStatus,
  extractionMethod
}: {
  rawQrValue: string;
  verificationUrl: string;
  scanStatus: "COMPLETE" | "PARTIAL" | "UNREADABLE";
  extractionMethod: string;
}): ScanDiagnosticsState {
  const normalizedRawValue = normalizeRawQrForDisplay(rawQrValue);
  const qrDetected = normalizedRawValue.length > 0;
  const failureStage: ScanFailureStage = qrDetected ? "NONE" : "QR_NOT_DETECTED";
  return {
    failureStage,
    failureMessage: failureStageMessage(failureStage),
    qrDetected,
    qrDecodeStatus: qrDetected ? "DECODED" : "NOT_DETECTED",
    qrDecodePass: "",
    qrParseStatus: qrDetected ? "PARTIAL" : "UNPARSED",
    qrFailureReason: qrDetected ? "" : "No QR detected",
    qrContentType: "UNKNOWN",
    qrRawValue: rawQrValue,
    qrNormalizedRawValue: normalizedRawValue,
    qrRawLength: rawQrValue.length,
    qrRawPreview: truncateQrPreview(rawQrValue),
    qrRawPayloadFormat: detectRawPayloadFormat(rawQrValue),
    qrVerificationUrl: verificationUrl,
    qrIsTraVerification: verificationUrl.includes("tra.go.tz"),
    qrParsedFieldCount: 0,
    qrParsedLineItemsCount: 0,
    qrLookupStatus: "NOT_ATTEMPTED",
    qrLookupReason: "",
    qrLookupHttpStatus: null,
    qrLookupParsed: false,
    ocrAttempted: false,
    ocrSucceeded: false,
    ocrError: "",
    scanStatus,
    extractionMethod,
    returnedFrom: "qr_tra",
    attemptedPassCount: 0,
    attemptedPassSample: [],
    successfulPass: "",
    variantCount: 0,
    imageReceived: true,
    imageLoaded: true
  };
}

export function markFrontendMappingGap(review: ReviewState): ReviewState {
  return {
    ...review,
    warnings: Array.from(
      new Set([
        ...review.warnings,
        "Scan data was captured, but some mapped fields were empty. Please verify and complete manually."
      ])
    ),
    scanDiagnostics: {
      ...review.scanDiagnostics,
      failureStage: "FRONTEND_MAPPING_EMPTY",
      failureMessage: failureStageMessage("FRONTEND_MAPPING_EMPTY")
    }
  };
}

export function resolveScanFailureNotice(review: ReviewState) {
  if (review.scanDiagnostics.failureStage === "QR_NOT_DETECTED") {
    return "QR was not detected. Please complete manually with requisition prefilled context.";
  }
  if (review.scanDiagnostics.failureStage === "QR_DECODE_FAILED") {
    return "QR was detected but could not be decoded. Please complete manually with requisition prefilled context.";
  }
  if (review.scanDiagnostics.failureStage === "QR_PARSE_UNPARSED") {
    return "QR decoded but parsing was limited. Review the captured details and complete remaining fields manually.";
  }
  if (review.scanDiagnostics.failureStage === "TRA_LOOKUP_FAILED") {
    return "QR decoded but TRA lookup returned limited details. Please review and complete the remaining fields.";
  }
  return SCAN_FALLBACK_MESSAGE;
}

export function evaluateSaveReadiness(review: ReviewState): SaveReadiness {
  const reasons: string[] = [];
  const workflowChoice = resolveWorkflowChoiceFromReview(review);
  const effectiveCreateExpense = resolveCreateExpenseForPurpose(review);
  const inventoryLines = review.lines.filter((line) => line.mode !== "EXPENSE_ONLY");
  if (!review.receiptNumber.trim()) {
    reasons.push("Add a receipt number before saving.");
  }
  if (!review.supplierId && !review.supplierName.trim()) {
    reasons.push("Add supplier details before saving.");
  }
  if (Number(review.total || 0) <= 0) {
    reasons.push("Add a valid total amount before saving.");
  }
  if (review.receiptPurpose === "OTHER_MANUAL") {
    reasons.push("Choose a final receipt purpose before saving.");
  }
  if (review.receiptClassification !== "EXPENSE_ONLY") {
    if (workflowChoice === "PROJECT_PURCHASE" && !review.projectId) {
      reasons.push("Select a project for Project Purchase.");
    }
    if (workflowChoice === "MAINTENANCE_PURCHASE" && !review.rigId) {
      reasons.push("Select a rig for Maintenance Purchase.");
    }
    if (workflowChoice === "STOCK_PURCHASE" && review.projectId) {
      reasons.push("Stock Purchase should not be linked to a project.");
    }
  }
  if (review.receiptClassification === "EXPENSE_ONLY" && !review.expenseOnlyCategory) {
    reasons.push("Select an expense category for expense-only receipts.");
  }
  if (workflowChoice === "INTERNAL_TRANSFER") {
    if (!review.locationFromId || !review.locationToId) {
      reasons.push("Select both from-location and to-location for internal transfers.");
    } else if (review.locationFromId === review.locationToId) {
      reasons.push("From-location and to-location must be different for internal transfers.");
    }
    if (inventoryLines.some((line) => line.mode !== "MATCH" || !line.selectedItemId)) {
      reasons.push("Internal transfer lines must be linked to existing inventory items.");
    }
  }
  if (review.lines.length === 0 && !effectiveCreateExpense) {
    reasons.push("Add at least one line item or enable expense evidence.");
  }
  if (inventoryLines.some((line) => !line.description.trim() || Number(line.quantity || 0) <= 0)) {
    reasons.push("Line descriptions and quantities need review.");
  }
  return {
    ready: reasons.length === 0,
    reasons
  };
}

export function evaluateAutoSaveEligibility(review: ReviewState): SaveReadiness {
  const base = evaluateSaveReadiness(review);
  const reasons = [...base.reasons];
  if (!review.debugFlags.traParseSucceeded && review.qrLookupStatus !== "SUCCESS") {
    reasons.push("TRA/QR parse is still incomplete.");
  }
  if (review.receiptPurpose === "OTHER_MANUAL") {
    reasons.push("Receipt purpose requires manual decision.");
  }
  const lineCandidates = review.lines.filter(
    (line) => line.description.trim() && Number(line.quantity || 0) > 0
  );
  if (
    review.receiptClassification !== "EXPENSE_ONLY" &&
    review.receiptPurpose !== "EVIDENCE_ONLY" &&
    lineCandidates.length === 0
  ) {
    reasons.push("At least one valid line item is required.");
  }
  const hasConflict = hasConflictingParsedValues(review);
  if (hasConflict) {
    reasons.push("Totals look inconsistent and should be reviewed manually.");
  }
  return {
    ready: reasons.length === 0,
    reasons
  };
}

function hasConflictingParsedValues(review: ReviewState) {
  const subtotal = Number(review.subtotal || 0);
  const tax = Number(review.tax || 0);
  const total = Number(review.total || 0);
  if (subtotal <= 0 || total <= 0) {
    return false;
  }
  const expected = subtotal + Math.max(tax, 0);
  const tolerance = Math.max(1, total * 0.03);
  return Math.abs(expected - total) > tolerance;
}

export function deriveManualFieldHints(review: ReviewState) {
  const hints: string[] = [];
  const workflowChoice = resolveWorkflowChoiceFromReview(review);
  if (review.receiptClassification !== "EXPENSE_ONLY") {
    if (workflowChoice === "PROJECT_PURCHASE" && !review.projectId) {
      hints.push("Select project");
    }
    if (workflowChoice === "MAINTENANCE_PURCHASE" && !review.rigId) {
      hints.push("Select rig");
    }
  }
  if (review.receiptClassification === "EXPENSE_ONLY" && !review.expenseOnlyCategory) {
    hints.push("Select expense category");
  }
  if (workflowChoice === "INTERNAL_TRANSFER") {
    if (!review.locationFromId) {
      hints.push("Select from-location");
    }
    if (!review.locationToId) {
      hints.push("Select to-location");
    }
  } else if (!review.locationToId) {
    hints.push("Select stock location");
  }
  return hints;
}

export function deriveCriticalManualFieldHints(review: ReviewState) {
  const hints: string[] = [];
  if (!review.supplierName.trim() && !review.supplierId.trim()) {
    hints.push("Supplier");
  }
  if (!review.receiptNumber.trim()) {
    hints.push("Receipt number");
  }
  if (Number(review.total || 0) <= 0) {
    hints.push("Total amount");
  }
  if (!review.receiptDate.trim()) {
    hints.push("Receipt date");
  }
  return hints;
}

export function calmMessage(message: string) {
  const value = message.trim();
  if (!value) {
    return "";
  }
  const normalized = value.toLowerCase();
  if (normalized.includes("extra ocr enrichment failed") || normalized.includes("optional ocr enrichment failed")) {
    return "Core receipt data captured. Some optional details may need review.";
  }
  if (normalized.includes("worker module is unavailable") || normalized.includes("timed out")) {
    return "Core receipt data captured. Optional enrichment was skipped for this scan.";
  }
  if (normalized.includes("unreadable")) {
    return "Some fields need review.";
  }
  if (normalized.includes("line items were not detected") || normalized.includes("line items could not be read")) {
    return "No line items detected automatically yet. You can add or confirm line items manually.";
  }
  if (normalized.includes("receipt image is unclear")) {
    return "Capture quality is low. You can still continue and complete missing fields manually.";
  }
  if (normalized.includes("failed")) {
    return value.replace(/failed/gi, "needs review");
  }
  if (normalized.includes("no qr detected")) {
    return "QR was not detected automatically. OCR/manual review is still available.";
  }
  return value;
}
