import { containsAny } from "@/lib/inventory-receipt-intake-parse-utils";

export type ReceiptTypeReconciled = "INVENTORY_PURCHASE" | "GENERAL_EXPENSE" | "UNCLEAR";

export type ReceiptScanStatusReconciled = "COMPLETE" | "PARTIAL" | "UNREADABLE";

export interface ReceiptLineForClassification {
  description: string;
  matchSuggestion?: {
    itemId: string | null;
  };
}

export interface FieldConfidenceMapLike {
  [field: string]: "HIGH" | "MEDIUM" | "LOW" | "UNREADABLE";
}

export interface QrVerificationLookupLike {
  attempted: boolean;
  status: "NOT_ATTEMPTED" | "SUCCESS" | "FAILED";
  parsed: boolean;
  parsedFieldCount: number;
}

export interface QrForScanStatus {
  decodeStatus: "DECODED" | "NOT_DETECTED" | "DECODE_FAILED";
  rawValue: string;
  parseStatus: "PARSED" | "PARTIAL" | "UNPARSED";
  stages: {
    verificationLookup: QrVerificationLookupLike;
  };
}

export function detectReceiptType({
  text,
  lines
}: {
  text: string;
  lines: ReceiptLineForClassification[];
}): ReceiptTypeReconciled {
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
      lines.some((line) => line.matchSuggestion?.itemId))
  ) {
    return "INVENTORY_PURCHASE";
  }
  if (containsAny(lower, expenseKeywords) || containsAny(lineText, expenseKeywords)) {
    return "GENERAL_EXPENSE";
  }
  return "UNCLEAR";
}

export function resolveScanStatus({
  text,
  lines,
  fieldConfidence,
  qr
}: {
  text: string;
  lines: ReceiptLineForClassification[];
  fieldConfidence: FieldConfidenceMapLike;
  qr: QrForScanStatus;
}): ReceiptScanStatusReconciled {
  const verificationLookup = qr.stages.verificationLookup;
  const hasTraCoreParse =
    verificationLookup.attempted &&
    verificationLookup.status === "SUCCESS" &&
    (verificationLookup.parsed || verificationLookup.parsedFieldCount >= 6);
  if (hasTraCoreParse) {
    return "COMPLETE";
  }

  if (qr.decodeStatus === "DECODED" && qr.rawValue.trim()) {
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

  if (readableHeaderFields >= 8 && lines.length >= 1) {
    return "COMPLETE";
  }

  return "PARTIAL";
}
