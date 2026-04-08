import type {
  QrDecodeStatus,
  QrLookupStatus,
  QrParseStatus,
  ScanDiagnosticsState,
  ScanFailureStage
} from "@/components/inventory/receipt-intake-panel";

function asString(value: unknown) {
  return typeof value === "string" ? value : "";
}

export function buildEmptyScanDiagnostics(): ScanDiagnosticsState {
  return {
    failureStage: "QR_NOT_DETECTED",
    failureMessage: "No scan diagnostics captured yet.",
    qrDetected: false,
    qrDecodeStatus: "NOT_DETECTED",
    qrDecodePass: "",
    qrParseStatus: "UNPARSED",
    qrFailureReason: "",
    qrContentType: "NONE",
    qrRawValue: "",
    qrNormalizedRawValue: "",
    qrRawLength: 0,
    qrRawPreview: "",
    qrRawPayloadFormat: "EMPTY",
    qrVerificationUrl: "",
    qrIsTraVerification: false,
    qrParsedFieldCount: 0,
    qrParsedLineItemsCount: 0,
    qrLookupStatus: "NOT_ATTEMPTED",
    qrLookupReason: "",
    qrLookupHttpStatus: null,
    qrLookupParsed: false,
    ocrAttempted: false,
    ocrSucceeded: false,
    ocrError: "",
    scanStatus: "UNREADABLE",
    extractionMethod: "NONE",
    returnedFrom: "qr_tra",
    attemptedPassCount: 0,
    attemptedPassSample: [],
    successfulPass: "",
    variantCount: 0,
    imageReceived: true,
    imageLoaded: true
  };
}

export function parseOptionalFiniteNumber(value: unknown): number | null {
  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    return numeric;
  }
  return null;
}

export function countPopulatedRecordFields(record: Record<string, unknown> | null) {
  if (!record) {
    return 0;
  }
  let count = 0;
  Object.values(record).forEach((value) => {
    if (typeof value === "string" && value.trim()) {
      count += 1;
      return;
    }
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      count += 1;
    }
  });
  return count;
}

export function normalizeScanFailureStage(value: unknown): ScanFailureStage | null {
  const normalized = asString(value).toUpperCase();
  if (
    normalized === "NONE" ||
    normalized === "QR_NOT_DETECTED" ||
    normalized === "QR_DECODE_FAILED" ||
    normalized === "QR_PARSE_UNPARSED" ||
    normalized === "TRA_LOOKUP_FAILED" ||
    normalized === "FRONTEND_MAPPING_EMPTY"
  ) {
    return normalized;
  }
  return null;
}

export function resolveScanFailureStageFromSignals({
  qrDetected,
  decodeStatus,
  parseStatus,
  lookupStatus
}: {
  qrDetected: boolean;
  decodeStatus: QrDecodeStatus;
  parseStatus: QrParseStatus;
  lookupStatus: QrLookupStatus;
}): ScanFailureStage {
  if (!qrDetected || decodeStatus === "NOT_DETECTED") {
    return "QR_NOT_DETECTED";
  }
  if (decodeStatus === "DECODE_FAILED") {
    return "QR_DECODE_FAILED";
  }
  if (decodeStatus === "DECODED" && parseStatus === "UNPARSED") {
    return "QR_PARSE_UNPARSED";
  }
  if (decodeStatus === "DECODED" && lookupStatus === "FAILED") {
    return "TRA_LOOKUP_FAILED";
  }
  return "NONE";
}

export function failureStageMessage(stage: ScanFailureStage) {
  if (stage === "QR_NOT_DETECTED") {
    return "QR was not detected in the uploaded receipt image.";
  }
  if (stage === "QR_DECODE_FAILED") {
    return "QR was detected but decoding failed.";
  }
  if (stage === "QR_PARSE_UNPARSED") {
    return "QR decoded, but structured field parsing was limited.";
  }
  if (stage === "TRA_LOOKUP_FAILED") {
    return "QR decoded, but TRA verification lookup returned limited data.";
  }
  if (stage === "FRONTEND_MAPPING_EMPTY") {
    return "Backend returned scan data, but review mapping could not populate usable fields.";
  }
  return "No scan-stage failure detected.";
}

export function normalizeRawQrForDisplay(value: string) {
  return value
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, " ")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function truncateQrPreview(value: string, max = 200) {
  if (!value) {
    return "";
  }
  if (value.length <= max) {
    return value;
  }
  return `${value.slice(0, max)}...`;
}

export function normalizeRawPayloadFormat(value: unknown): ScanDiagnosticsState["qrRawPayloadFormat"] | null {
  const normalized = asString(value).toUpperCase();
  if (
    normalized === "EMPTY" ||
    normalized === "URL" ||
    normalized === "JSON" ||
    normalized === "QUERY_STRING" ||
    normalized === "KEY_VALUE" ||
    normalized === "PERCENT_ENCODED" ||
    normalized === "BASE64_LIKE" ||
    normalized === "TEXT"
  ) {
    return normalized;
  }
  return null;
}

export function detectRawPayloadFormat(rawValue: string): ScanDiagnosticsState["qrRawPayloadFormat"] {
  const trimmed = rawValue.trim();
  if (!trimmed) {
    return "EMPTY";
  }
  if (/^https?:\/\//i.test(trimmed) || /\btra\.go\.tz\b/i.test(trimmed)) {
    return "URL";
  }
  if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
    try {
      JSON.parse(trimmed);
      return "JSON";
    } catch {
      // continue
    }
  }
  if ((trimmed.includes("&") && trimmed.includes("=")) || /(?:^|[?&])[a-z0-9_\-]+=/.test(trimmed)) {
    return "QUERY_STRING";
  }
  if (/[a-z][a-z0-9_\s-]{1,32}\s*[:=]\s*[^&;\n\r]+/i.test(trimmed)) {
    return "KEY_VALUE";
  }
  if (/%[0-9a-f]{2}/i.test(trimmed)) {
    return "PERCENT_ENCODED";
  }
  if (/^[A-Za-z0-9+/=]{24,}$/.test(trimmed) && !trimmed.includes(" ")) {
    return "BASE64_LIKE";
  }
  return "TEXT";
}
