type ReadabilityConfidence = "HIGH" | "MEDIUM" | "LOW" | "UNREADABLE";
type ReceiptScanStatus = "COMPLETE" | "PARTIAL" | "UNREADABLE";
type ReceiptType = "INVENTORY_PURCHASE" | "GENERAL_EXPENSE" | "UNCLEAR";
type QrContentType = "TRA_URL" | "URL" | "STRUCTURED_TEXT" | "UNKNOWN" | "NONE";
type QrDecodeStatus = "DECODED" | "NOT_DETECTED" | "DECODE_FAILED";
type QrParseStatus = "PARSED" | "PARTIAL" | "UNPARSED";
type QrLookupStatus = "NOT_ATTEMPTED" | "SUCCESS" | "FAILED";
type QrParseDetailStatus = "NOT_ATTEMPTED" | "SUCCESS" | "PARTIAL" | "FAILED";
type ScanFailureStage =
  | "NONE"
  | "QR_NOT_DETECTED"
  | "QR_DECODE_FAILED"
  | "QR_PARSE_UNPARSED"
  | "TRA_LOOKUP_FAILED"
  | "FRONTEND_MAPPING_EMPTY";

function asString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function asRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

export function formatReadability(confidence?: ReadabilityConfidence) {
  if (!confidence) {
    return "Needs review";
  }
  if (confidence === "UNREADABLE") {
    return "Needs review";
  }
  return confidence.charAt(0) + confidence.slice(1).toLowerCase();
}

export function formatFieldSource(source?: "QR" | "OCR" | "DERIVED" | "NONE") {
  if (!source || source === "NONE") {
    return "Manual";
  }
  if (source === "DERIVED") {
    return "Derived";
  }
  return source;
}

export function readabilityBadgeClass(confidence?: ReadabilityConfidence) {
  if (confidence === "HIGH") {
    return "rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-800";
  }
  if (confidence === "MEDIUM") {
    return "rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800";
  }
  if (confidence === "LOW") {
    return "rounded-full bg-orange-100 px-2 py-0.5 text-[11px] font-semibold text-orange-800";
  }
  return "rounded-full bg-slate-200 px-2 py-0.5 text-[11px] font-semibold text-slate-700";
}

export function normalizeScanStatus(value: unknown): ReceiptScanStatus {
  if (value === "COMPLETE" || value === "PARTIAL" || value === "UNREADABLE") {
    return value;
  }
  return "PARTIAL";
}

export function normalizeReceiptType(value: unknown): ReceiptType {
  if (value === "INVENTORY_PURCHASE" || value === "GENERAL_EXPENSE" || value === "UNCLEAR") {
    return value;
  }
  return "UNCLEAR";
}

export function normalizeQrContentType(value: unknown): QrContentType {
  if (value === "TRA_URL" || value === "URL" || value === "STRUCTURED_TEXT" || value === "UNKNOWN" || value === "NONE") {
    return value;
  }
  return "UNKNOWN";
}

export function normalizeQrDecodeStatus(value: unknown): QrDecodeStatus {
  if (value === "DECODED" || value === "NOT_DETECTED" || value === "DECODE_FAILED") {
    return value;
  }
  return "NOT_DETECTED";
}

export function normalizeQrParseStatus(value: unknown): QrParseStatus {
  if (value === "PARSED" || value === "PARTIAL" || value === "UNPARSED") {
    return value;
  }
  return "UNPARSED";
}

export function normalizeQrLookupStatus(value: unknown): QrLookupStatus {
  if (value === "NOT_ATTEMPTED" || value === "SUCCESS" || value === "FAILED") {
    return value;
  }
  return "NOT_ATTEMPTED";
}

export function normalizeQrParseDetailStatus(value: unknown): QrParseDetailStatus {
  if (value === "NOT_ATTEMPTED" || value === "SUCCESS" || value === "PARTIAL" || value === "FAILED") {
    return value;
  }
  return "NOT_ATTEMPTED";
}

export function formatQrContentType(type: QrContentType) {
  if (type === "TRA_URL") {
    return "TRA URL";
  }
  if (type === "STRUCTURED_TEXT") {
    return "Structured Text";
  }
  if (type === "URL") {
    return "URL";
  }
  if (type === "UNKNOWN") {
    return "Unknown";
  }
  return "None";
}

export function formatQrDecodeStatus(type: QrDecodeStatus) {
  if (type === "DECODED") {
    return "QR captured";
  }
  if (type === "DECODE_FAILED") {
    return "QR detected, decode needs review";
  }
  return "QR not detected automatically";
}

export function formatQrParseStatus(type: QrParseStatus) {
  if (type === "PARSED") {
    return "Parse success";
  }
  if (type === "PARTIAL") {
    return "Partially parsed";
  }
  return "Parsed with review needed";
}

export function formatQrLookupStatus(type: QrLookupStatus) {
  if (type === "SUCCESS") {
    return "Lookup captured";
  }
  if (type === "FAILED") {
    return "Lookup needs review";
  }
  return "Not attempted";
}

export function formatScanFailureStage(stage: ScanFailureStage) {
  if (stage === "QR_NOT_DETECTED") {
    return "QR not detected";
  }
  if (stage === "QR_DECODE_FAILED") {
    return "QR detected but decode failed";
  }
  if (stage === "QR_PARSE_UNPARSED") {
    return "QR decoded, parsing limited";
  }
  if (stage === "TRA_LOOKUP_FAILED") {
    return "TRA lookup returned limited data";
  }
  if (stage === "FRONTEND_MAPPING_EMPTY") {
    return "Mapping gap after scan";
  }
  return "No stage failure";
}

export function toReadability(value: unknown): ReadabilityConfidence {
  if (value === "HIGH" || value === "MEDIUM" || value === "LOW" || value === "UNREADABLE") {
    return value;
  }
  return "UNREADABLE";
}

export function toReadabilityMap(value: unknown): Record<string, ReadabilityConfidence> {
  const candidate = asRecord(value);
  if (!candidate) {
    return {};
  }
  const normalized: Record<string, ReadabilityConfidence> = {};
  for (const [key, raw] of Object.entries(candidate)) {
    normalized[key] = toReadability(raw);
  }
  return normalized;
}

export function toFieldSource(value: unknown): "QR" | "OCR" | "DERIVED" | "NONE" {
  if (value === "QR" || value === "OCR" || value === "DERIVED" || value === "NONE") {
    return value;
  }
  return "NONE";
}

export function toFieldSourceMap(value: unknown): Record<string, "QR" | "OCR" | "DERIVED" | "NONE"> {
  const candidate = asRecord(value);
  if (!candidate) {
    return {};
  }
  const normalized: Record<string, "QR" | "OCR" | "DERIVED" | "NONE"> = {};
  for (const [key, raw] of Object.entries(candidate)) {
    normalized[key] = toFieldSource(raw);
  }
  return normalized;
}

export function readDebugCandidates(value: unknown) {
  const debug = asRecord(value);
  const candidates = Array.isArray(debug?.ocrCandidates) ? debug.ocrCandidates : [];
  return candidates
    .map((entry) => {
      const candidate = asRecord(entry);
      if (!candidate) {
        return null;
      }
      return {
        label: asString(candidate.label) || "variant",
        confidence: Number(candidate.confidence || 0),
        score: Number(candidate.score || 0),
        textLength: Number(candidate.textLength || 0)
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
}

export function clampNormalized(value: number) {
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

export function formatPercent(value: number) {
  return `${Math.round(clampNormalized(value) * 100)}%`;
}
