import {
  formatReceiptPurposeLabel,
  normalizeReceiptPurpose
} from "@/components/inventory/receipt-intake-workflow-utils";

export function asString(value: unknown) {
  return typeof value === "string" ? value : "";
}

export function asRecord(value: unknown) {
  if (!value || typeof value !== "object") {
    return null;
  }
  return value as Record<string, unknown>;
}

export function extractReceiptPurposeFromDetails(details: Record<string, unknown>) {
  const direct = normalizeReceiptPurpose(asString(details.receiptPurpose));
  if (direct !== "INVENTORY_PURCHASE" || asString(details.receiptPurpose) === "INVENTORY_PURCHASE") {
    return formatReceiptPurposeLabel(direct);
  }
  const notes = asString(details.notes);
  if (notes) {
    const match = notes.match(/ReceiptPurpose=([A-Z_]+)/i);
    if (match?.[1]) {
      return formatReceiptPurposeLabel(match[1]);
    }
  }
  return "-";
}

export function readStringFieldValue({
  header,
  qrParsedFields,
  keys,
  fallback = ""
}: {
  header: Record<string, unknown> | null | undefined;
  qrParsedFields: Record<string, unknown> | null | undefined;
  keys: string[];
  fallback?: string;
}) {
  for (const source of [header, qrParsedFields]) {
    if (!source) {
      continue;
    }
    for (const key of keys) {
      const value = source[key];
      if (typeof value === "string" && value.trim().length > 0) {
        return value.trim();
      }
    }
  }
  return fallback;
}

export function readNumericFieldValue({
  header,
  qrParsedFields,
  keys,
  fallback = 0
}: {
  header: Record<string, unknown> | null | undefined;
  qrParsedFields: Record<string, unknown> | null | undefined;
  keys: string[];
  fallback?: number;
}) {
  for (const source of [header, qrParsedFields]) {
    if (!source) {
      continue;
    }
    for (const key of keys) {
      const raw = source[key];
      if (typeof raw === "number" && Number.isFinite(raw)) {
        return String(raw);
      }
      if (typeof raw === "string" && raw.trim().length > 0) {
        const normalized = Number(raw.replace(/,/g, ""));
        if (Number.isFinite(normalized)) {
          return String(normalized);
        }
      }
    }
  }
  return String(fallback);
}

export function readNumericFieldValueOptional({
  header,
  qrParsedFields,
  keys
}: {
  header: Record<string, unknown> | null | undefined;
  qrParsedFields: Record<string, unknown> | null | undefined;
  keys: string[];
}) {
  for (const source of [header, qrParsedFields]) {
    if (!source) {
      continue;
    }
    for (const key of keys) {
      const raw = source[key];
      if (typeof raw === "number" && Number.isFinite(raw)) {
        return String(raw);
      }
      if (typeof raw === "string" && raw.trim().length > 0) {
        const normalized = Number(raw.replace(/,/g, ""));
        if (Number.isFinite(normalized)) {
          return String(normalized);
        }
      }
    }
  }
  return "";
}

export function toNumericString(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? String(parsed) : "0";
}

export function formatMoneyText(value: string, currency: string) {
  const parsed = Number(value || 0);
  if (!Number.isFinite(parsed)) {
    return "-";
  }
  return `${parsed.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${(
    currency || "USD"
  ).toUpperCase()}`;
}

export function formatDateTimeText(value: string) {
  if (!value) {
    return "-";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleString();
}
