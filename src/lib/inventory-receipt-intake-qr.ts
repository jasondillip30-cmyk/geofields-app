import { roundCurrency } from "@/lib/inventory-server";
import { findDate, findPattern, toStringValue } from "@/lib/inventory-receipt-intake-parse-utils";
import type {
  ReceiptFieldReadability,
  ReceiptHeaderExtraction,
  ReceiptQrContentType,
  ReceiptQrDecodeStatus,
  ReceiptQrParseStatus,
  ReceiptQrResult
} from "@/lib/inventory-receipt-intake";

export function buildQrFailureResult({
  decodeStatus,
  failureReason,
  warnings = [],
  imageReceived = true,
  imageLoaded = false,
  isQrOnlyImage = false,
  attemptedPasses = [],
  variantCount = 0
}: {
  decodeStatus: ReceiptQrDecodeStatus;
  failureReason: string;
  warnings?: string[];
  imageReceived?: boolean;
  imageLoaded?: boolean;
  isQrOnlyImage?: boolean;
  attemptedPasses?: string[];
  variantCount?: number;
}): ReceiptQrResult {
  return {
    detected: false,
    rawValue: "",
    normalizedRawValue: "",
    contentType: "NONE",
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
        type: "NONE",
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

export function parseQrPayload(
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
  const rawDecodedValue = typeof rawValue === "string" ? rawValue : "";
  const normalizedRaw = normalizeDecodedQrValue(rawDecodedValue);
  if (!rawDecodedValue) {
    return buildQrFailureResult({
      decodeStatus: "NOT_DETECTED",
      failureReason: "No QR detected",
      isQrOnlyImage,
      attemptedPasses,
      variantCount,
      warnings: ["No QR detected. Continuing with OCR fallback."]
    });
  }
  if (!normalizedRaw) {
    return {
      detected: true,
      rawValue: rawDecodedValue,
      normalizedRawValue: "",
      contentType: "UNKNOWN",
      isTraVerification: false,
      isQrOnlyImage,
      decodeStatus: "DECODED",
      decodePass,
      parseStatus: "UNPARSED",
      failureReason: "QR decoded but normalized payload was empty",
      verificationUrl: "",
      parsedFields: {},
      parsedLineCandidates: [],
      confidence: "LOW",
      warnings: ["QR decoded, but payload could not be normalized. Raw payload is available for review."],
      stages: {
        decode: {
          success: true,
          status: "DECODED",
          pass: decodePass,
          reason: ""
        },
        classification: {
          success: false,
          type: "UNKNOWN",
          isTraUrl: false
        },
        verificationLookup: {
          attempted: false,
          success: false,
          status: "NOT_ATTEMPTED",
          reason: "Normalized payload was empty",
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

  const extractedUrlCandidate = extractVerificationUrlCandidate(normalizedRaw);
  const contentType = detectQrContentType(extractedUrlCandidate || normalizedRaw);
  let parsed: Partial<ReceiptHeaderExtraction> = {};
  let verificationUrl = "";

  if (contentType === "URL") {
    const asUrl = toUrl(extractedUrlCandidate || normalizedRaw);
    if (asUrl) {
      verificationUrl = asUrl.toString();
      parsed = mergeParsedFields(parsed, parseQrFromUrl(asUrl));
    } else {
      verificationUrl = extractVerificationUrlCandidate(normalizedRaw);
    }
  } else if (contentType === "STRUCTURED_TEXT") {
    const asJson = parseQrJson(normalizedRaw);
    if (asJson) {
      parsed = mergeParsedFields(parsed, asJson);
    }
    parsed = mergeParsedFields(parsed, parseQrKeyValueText(normalizedRaw));
    parsed = mergeParsedFields(parsed, parseGenericKeyValueText(normalizedRaw));
    const embeddedUrl = extractVerificationUrlCandidate(normalizedRaw);
    if (embeddedUrl) {
      verificationUrl = embeddedUrl;
    }
  } else {
    const asJson = parseQrJson(normalizedRaw);
    if (asJson) {
      parsed = mergeParsedFields(parsed, asJson);
    }
  }

  if (!verificationUrl && extractedUrlCandidate) {
    verificationUrl = extractedUrlCandidate;
  }
  if (verificationUrl) {
    const parsedFromUrl = toUrl(verificationUrl);
    if (parsedFromUrl) {
      parsed = mergeParsedFields(parsed, parseQrFromUrl(parsedFromUrl));
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
    rawValue: rawDecodedValue,
    normalizedRawValue: normalizedRaw,
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

export function detectQrContentType(value: string): ReceiptQrContentType {
  const normalized = value.trim();
  if (!normalized) {
    return "NONE";
  }
  if (looksLikeUrlLikeQrValue(normalized)) {
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

export function isTraVerificationUrl(value: string) {
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

export function mergeParsedFields(
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

export function parseQrFromUrl(url: URL): Partial<ReceiptHeaderExtraction> {
  const query = url.searchParams;
  const lowerQuery = new Map<string, string>();
  query.forEach((value, key) => {
    const trimmed = value.trim();
    if (trimmed) {
      lowerQuery.set(key.toLowerCase(), trimmed);
    }
  });
  const valueFrom = (...keys: string[]) => {
    for (const key of keys) {
      const exact = query.get(key);
      if (exact && exact.trim()) {
        return exact.trim();
      }
      const fallback = lowerQuery.get(key.toLowerCase());
      if (fallback) {
        return fallback;
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
    receiptNumber: valueFrom(
      "receiptNo",
      "receipt_number",
      "receipt",
      "rct",
      "rctNo",
      "receiptnumber",
      "receiptno"
    ),
    verificationCode: valueFrom("verifyCode", "verificationCode", "code", "vcode", "verification"),
    supplierName: valueFrom("supplier", "merchant", "seller", "name", "supplierName", "businessName", "traderName"),
    tin: valueFrom("tin", "supplierTin", "merchantTin"),
    vrn: valueFrom("vrn", "vatNo", "vat"),
    serialNumber: valueFrom("serial", "serialNo", "sno", "serialNumber"),
    receiptDate: normalizeQrDate(valueFrom("date", "receiptDate", "issuedDate", "transactionDate")),
    receiptTime: valueFrom("time", "receiptTime", "issuedTime"),
    taxOffice: valueFrom("office", "taxOffice", "taxAuthority"),
    subtotal: numberFrom("subtotal", "subTotal", "amountBeforeTax", "netAmount"),
    tax: numberFrom("tax", "vat", "vatAmount"),
    total: numberFrom("total", "amount", "grossTotal", "totalAmount", "grandTotal")
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

export function parseQrKeyValueText(raw: string): Partial<ReceiptHeaderExtraction> {
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

export function parseGenericKeyValueText(raw: string): Partial<ReceiptHeaderExtraction> {
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

export function extractUrl(value: string) {
  const httpMatch = value.match(/https?:\/\/[^\s]+/i);
  if (httpMatch?.[0]) {
    return httpMatch[0];
  }
  const domainMatch = value.match(/\b(?:www\.)?(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s]*)?/i);
  if (domainMatch?.[0]) {
    const candidate = domainMatch[0].trim();
    if (!candidate) {
      return "";
    }
    return /^https?:\/\//i.test(candidate) ? candidate : `https://${candidate.replace(/^\/+/, "")}`;
  }
  return "";
}

export function toUrl(value: string) {
  try {
    const normalized = value.trim().replace(/^[`"'(<\[]+|[`"')>\]]+$/g, "");
    if (!normalized) {
      return null;
    }
    if (/^https?:\/\//i.test(normalized)) {
      return new URL(normalized);
    }
    if (looksLikeUrlLikeQrValue(normalized)) {
      const withScheme = `https://${normalized.replace(/^\/+/, "")}`;
      return new URL(withScheme);
    }
    return null;
  } catch {
    return null;
  }
}

function looksLikeUrlLikeQrValue(value: string) {
  const normalized = value.trim();
  if (!normalized) {
    return false;
  }
  if (/^https?:\/\//i.test(normalized)) {
    return true;
  }
  if (/^(?:www\.)?(?:[a-z0-9-]+\.)+[a-z]{2,}(?:[/?#][^\s]*)?$/i.test(normalized)) {
    return true;
  }
  return false;
}

export function normalizeDecodedQrValue(value: string) {
  if (!value) {
    return "";
  }
  let normalized = value
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, " ")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  normalized = normalized.replace(/^(?:qr(?:\s*code)?|qr\s*data|payload|url)\s*[:=\-]\s*/i, "");
  normalized = normalized.replace(/\\\//g, "/");
  const decoded = safeDecodeURIComponent(normalized);
  if (decoded) {
    normalized = decoded;
  }
  return normalized.trim();
}

function safeDecodeURIComponent(value: string) {
  if (!value || !/%[0-9a-f]{2}/i.test(value)) {
    return "";
  }
  try {
    return decodeURIComponent(value).trim();
  } catch {
    return "";
  }
}

export function extractVerificationUrlCandidate(value: string) {
  const candidates = Array.from(
    new Set(
      [value, safeDecodeURIComponent(value), value.replace(/\\u0026/gi, "&"), value.replace(/\\\//g, "/")]
        .map((entry) => entry.trim())
        .filter(Boolean)
    )
  );
  for (const candidate of candidates) {
    const extracted = extractUrl(candidate);
    if (extracted) {
      return extracted;
    }
    const compact = candidate.replace(/\s+/g, "");
    if (looksLikeUrlLikeQrValue(compact)) {
      const asUrl = toUrl(compact);
      if (asUrl) {
        return asUrl.toString();
      }
    }
  }
  return "";
}

function normalizeQrDate(value: string) {
  if (!value) {
    return "";
  }
  return findDate(value);
}
