export type ReceiptScanFailureStageReconciled =
  | "NONE"
  | "QR_NOT_DETECTED"
  | "QR_DECODE_FAILED"
  | "QR_PARSE_UNPARSED"
  | "TRA_LOOKUP_FAILED";

export interface ReceiptQrForDiagnostics {
  detected: boolean;
  rawValue: string;
  normalizedRawValue: string;
  contentType: "TRA_URL" | "URL" | "STRUCTURED_TEXT" | "UNKNOWN" | "NONE";
  isTraVerification: boolean;
  decodeStatus: "DECODED" | "NOT_DETECTED" | "DECODE_FAILED";
  decodePass: string;
  parseStatus: "PARSED" | "PARTIAL" | "UNPARSED";
  failureReason: string;
  verificationUrl: string;
  parsedFields: Record<string, unknown>;
  parsedLineCandidates: Array<unknown>;
  stages: {
    verificationLookup: {
      status: "NOT_ATTEMPTED" | "SUCCESS" | "FAILED";
      reason: string;
      httpStatus: number | null;
      parsed: boolean;
      attempted: boolean;
    };
  };
}

export interface IntakeDebugLike {
  ocrAttempted: boolean;
  ocrSucceeded: boolean;
  ocrError: string;
  returnedFrom: "qr_tra" | "qr_tra_plus_ocr";
}

export interface ReceiptScanDiagnosticsPayload {
  qrDetected: boolean;
  qrDecodeStatus: "DECODED" | "NOT_DETECTED" | "DECODE_FAILED";
  qrDecodePass: string;
  qrParseStatus: "PARSED" | "PARTIAL" | "UNPARSED";
  qrFailureReason: string;
  qrContentType: "TRA_URL" | "URL" | "STRUCTURED_TEXT" | "UNKNOWN" | "NONE";
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
  qrLookupStatus: "NOT_ATTEMPTED" | "SUCCESS" | "FAILED";
  qrLookupReason: string;
  qrLookupHttpStatus: number | null;
  qrLookupParsed: boolean;
  ocrAttempted: boolean;
  ocrSucceeded: boolean;
  ocrError: string;
  scanStatus: "COMPLETE" | "PARTIAL" | "UNREADABLE";
  extractionMethod: string;
  returnedFrom: "qr_tra" | "qr_tra_plus_ocr";
  failureStage: ReceiptScanFailureStageReconciled;
}

export function buildReceiptScanDiagnostics({
  qrResult,
  intakeDebug,
  scanStatus,
  extractionMethod
}: {
  qrResult: ReceiptQrForDiagnostics;
  intakeDebug: IntakeDebugLike;
  scanStatus: "COMPLETE" | "PARTIAL" | "UNREADABLE";
  extractionMethod: string;
}): ReceiptScanDiagnosticsPayload {
  const lookup = qrResult.stages.verificationLookup;
  const rawValue = qrResult.rawValue;
  return {
    qrDetected: qrResult.detected,
    qrDecodeStatus: qrResult.decodeStatus,
    qrDecodePass: qrResult.decodePass,
    qrParseStatus: qrResult.parseStatus,
    qrFailureReason: qrResult.failureReason,
    qrContentType: qrResult.contentType,
    qrRawValue: rawValue,
    qrNormalizedRawValue: qrResult.normalizedRawValue || qrResult.rawValue,
    qrRawLength: rawValue.length,
    qrRawPreview: truncateQrLogValue(rawValue, 200),
    qrRawPayloadFormat: detectRawQrPayloadFormat(rawValue),
    qrVerificationUrl: qrResult.verificationUrl,
    qrIsTraVerification: qrResult.isTraVerification,
    qrParsedFieldCount: countParsedFields(qrResult.parsedFields),
    qrParsedLineItemsCount: qrResult.parsedLineCandidates.length,
    qrLookupStatus: lookup.status,
    qrLookupReason: lookup.reason,
    qrLookupHttpStatus: lookup.httpStatus,
    qrLookupParsed: lookup.parsed,
    ocrAttempted: intakeDebug.ocrAttempted,
    ocrSucceeded: intakeDebug.ocrSucceeded,
    ocrError: intakeDebug.ocrError,
    scanStatus,
    extractionMethod,
    returnedFrom: intakeDebug.returnedFrom,
    failureStage: resolveScanFailureStage(qrResult)
  };
}

export function resolveScanFailureStage(
  qrResult: ReceiptQrForDiagnostics
): ReceiptScanFailureStageReconciled {
  if (qrResult.decodeStatus === "NOT_DETECTED") {
    return "QR_NOT_DETECTED";
  }
  if (qrResult.decodeStatus === "DECODE_FAILED") {
    return "QR_DECODE_FAILED";
  }
  if (qrResult.decodeStatus === "DECODED" && qrResult.parseStatus === "UNPARSED") {
    return "QR_PARSE_UNPARSED";
  }
  if (
    qrResult.decodeStatus === "DECODED" &&
    qrResult.isTraVerification &&
    qrResult.stages.verificationLookup.attempted &&
    qrResult.stages.verificationLookup.status === "FAILED"
  ) {
    return "TRA_LOOKUP_FAILED";
  }
  return "NONE";
}

function countParsedFields(parsed: Record<string, unknown>) {
  let count = 0;
  for (const value of Object.values(parsed)) {
    if (typeof value === "string") {
      if (value.trim()) {
        count += 1;
      }
      continue;
    }
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      count += 1;
      continue;
    }
    if (Array.isArray(value) && value.length > 0) {
      count += 1;
    }
  }
  return count;
}

function truncateQrLogValue(value: string, maxLength = 500) {
  const normalized = value.trim();
  if (!normalized) {
    return "";
  }
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(maxLength - 1, 0))}…`;
}

function detectRawQrPayloadFormat(
  rawValue: string
): ReceiptScanDiagnosticsPayload["qrRawPayloadFormat"] {
  const normalized = rawValue.trim();
  if (!normalized) {
    return "EMPTY";
  }
  if (/^https?:\/\//i.test(normalized)) {
    return "URL";
  }
  if ((normalized.startsWith("{") && normalized.endsWith("}")) || (normalized.startsWith("[") && normalized.endsWith("]"))) {
    return "JSON";
  }
  if (normalized.includes("=") && normalized.includes("&")) {
    return "QUERY_STRING";
  }
  if (normalized.includes("=") && normalized.includes("\n")) {
    return "KEY_VALUE";
  }
  if (/%[0-9A-F]{2}/i.test(normalized)) {
    return "PERCENT_ENCODED";
  }
  if (/^[A-Za-z0-9+/]+={0,2}$/.test(normalized) && normalized.length >= 24) {
    return "BASE64_LIKE";
  }
  return "TEXT";
}
