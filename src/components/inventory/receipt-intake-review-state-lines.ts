import type {
  FieldConfidence,
  ReceiptSnapshotLine,
  ReviewLineState,
  ReviewState
} from "@/components/inventory/receipt-intake-panel-types";
import { asRecord, asString } from "@/components/inventory/receipt-intake-review-state-primitives";

export function hasMeaningfulExtractedPayload(extracted: Record<string, unknown>) {
  const header = asRecord(extracted.header);
  const qr = asRecord(extracted.qr);
  const qrParsedFields = asRecord(qr?.parsedFields);
  const extractedLines = mapExtractedLines(extracted.lines);
  if (extractedLines.some((line) => isMeaningfulSnapshotLine({
    id: line.id,
    description: line.description,
    quantity: line.quantity,
    unitPrice: line.unitPrice,
    lineTotal: line.lineTotal
  }))) {
    return true;
  }

  const identityKeys = [
    "supplierName",
    "receiptNumber",
    "verificationCode",
    "traReceiptNumber",
    "serialNumber",
    "invoiceReference",
    "tin",
    "vrn"
  ];
  for (const source of [header, qrParsedFields]) {
    if (!source) {
      continue;
    }
    for (const key of identityKeys) {
      const value = source[key];
      if (typeof value === "string" && value.trim().length > 0) {
        return true;
      }
    }
  }

  const numericKeys = ["subtotal", "tax", "total"];
  for (const source of [header, qrParsedFields]) {
    if (!source) {
      continue;
    }
    for (const key of numericKeys) {
      const raw = source[key];
      const parsed =
        typeof raw === "number"
          ? raw
          : typeof raw === "string"
            ? Number(raw.replace(/,/g, ""))
            : Number.NaN;
      if (Number.isFinite(parsed) && parsed > 0) {
        return true;
      }
    }
  }

  const qrHasDecodedCore =
    qr?.decodeStatus === "DECODED" ||
    qr?.parseStatus === "PARSED" ||
    qr?.fieldsParseStatus === "SUCCESS" ||
    qr?.lineItemsParseStatus === "SUCCESS";
  if (qrHasDecodedCore) {
    const hasQrIdentityFields = [
      asString(qrParsedFields?.verificationCode),
      asString(qrParsedFields?.traReceiptNumber),
      asString(qrParsedFields?.tin),
      asString(qrParsedFields?.receiptNumber),
      asString(qrParsedFields?.supplierName)
    ].some((value) => value.trim().length > 0);
    if (hasQrIdentityFields) {
      return true;
    }
    const verificationUrl =
      typeof qr?.verificationUrl === "string" ? qr.verificationUrl.trim() : "";
    const rawValue = typeof qr?.rawValue === "string" ? qr.rawValue.trim() : "";
    if (verificationUrl.length > 0 || rawValue.length > 0) {
      return true;
    }
  }

  const qrLookup = asRecord(asRecord(qr?.stages)?.verificationLookup);
  if (asString(qrLookup?.status).toUpperCase() === "SUCCESS") {
    return true;
  }
  return false;
}

export function hasMeaningfulReviewData(review: ReviewState) {
  const meaningfulScannedLines = review.scannedSnapshot.lines.filter((line) => isMeaningfulSnapshotLine(line));
  if (meaningfulScannedLines.length > 0) {
    return true;
  }
  if (
    review.scannedSnapshot.supplierName ||
    review.scannedSnapshot.receiptNumber ||
    review.scannedSnapshot.receiptDate ||
    review.verificationCode ||
    review.traReceiptNumber ||
    review.serialNumber ||
    review.tin ||
    review.vrn
  ) {
    return true;
  }
  if (Number(review.scannedSnapshot.total || 0) > 0) {
    return true;
  }
  const qrHasDecodedCore =
    review.qrDecodeStatus === "DECODED" ||
    review.qrParseStatus === "PARSED" ||
    review.qrFieldsParseStatus === "SUCCESS" ||
    review.qrLineItemsParseStatus === "SUCCESS";
  if (
    qrHasDecodedCore &&
    (
      review.verificationCode.trim().length > 0 ||
      review.traReceiptNumber.trim().length > 0 ||
      review.verificationUrl.trim().length > 0 ||
      review.rawQrValue.trim().length > 0
    )
  ) {
    return true;
  }
  return false;
}

export function isMeaningfulSnapshotLine(line: ReceiptSnapshotLine) {
  const normalizedDescription = normalizeLineDescription(line.description);
  const hasUsefulDescription =
    normalizedDescription.length > 0 && normalizedDescription !== "unparsed receipt item";
  const hasNumericSignals =
    Number(line.quantity || 0) > 0 ||
    Number(line.unitPrice || 0) > 0 ||
    Number(line.lineTotal || 0) > 0;
  return hasUsefulDescription || hasNumericSignals;
}

export function mapExtractedLines(linesValue: unknown): ReviewLineState[] {
  if (!Array.isArray(linesValue)) {
    return [];
  }

  return linesValue.map((rawLine) => {
    const line = asRecord(rawLine) || {};
    const categorySuggestion = asRecord(line.categorySuggestion);
    const suggestedCategory = asString(categorySuggestion?.category);
    const categoryConfidence = (asString(categorySuggestion?.confidence) as FieldConfidence) || "NONE";
    const matchSuggestion = asRecord(line.matchSuggestion);
    const description = asString(line.description) || "Unparsed receipt item";
    const qty = Number(line.quantity ?? 0);
    const unit = Number(line.unitPrice ?? 0);
    const total = Number(line.lineTotal ?? 0);

    const hasStrongCategorySignal = categoryConfidence === "HIGH" || categoryConfidence === "MEDIUM";
    const safeSuggestedCategory = hasStrongCategorySignal ? suggestedCategory : "";
    const hasItemMatch = Boolean(asString(matchSuggestion?.["itemId"]));
    const extractionConfidence = (asString(line.extractionConfidence) as "HIGH" | "MEDIUM" | "LOW") || "LOW";
    const hasReliableDescription = extractionConfidence !== "LOW" && description.length >= 3;
    const looksNonInventory = isLikelyNonInventoryLine(description);
    const extremelyWeakSignal = extractionConfidence === "LOW" && categoryConfidence === "NONE";
    const initialMode: ReviewLineState["mode"] = hasItemMatch
      ? "MATCH"
      : looksNonInventory || (extremelyWeakSignal && !hasReliableDescription)
        ? "EXPENSE_ONLY"
        : "NEW";

    return {
      id: asString(line.id) || `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      description,
      quantity: String(qty > 0 ? qty : 1),
      unitPrice: String(unit >= 0 ? unit : 0),
      lineTotal: String(total >= 0 ? total : unit),
      extractionConfidence,
      selectedCategory: safeSuggestedCategory || "OTHER",
      suggestedCategory: safeSuggestedCategory || null,
      categoryReason:
        asString(categorySuggestion?.reason) ||
        "No strong category match found. Keep as Uncategorized unless manually confirmed.",
      mode: initialMode,
      selectedItemId: asString(matchSuggestion?.["itemId"]),
      matchConfidence: (asString(matchSuggestion?.["confidence"]) as FieldConfidence) || "NONE",
      matchScore: Number(matchSuggestion?.["score"] ?? 0),
      newItemName: description,
      newItemSku: "",
      newItemMinimumStockLevel: "0"
    };
  });
}

function isLikelyNonInventoryLine(description: string) {
  const normalized = description.toLowerCase();
  const nonInventorySignals = [
    "hotel",
    "lodge",
    "restaurant",
    "meal",
    "lunch",
    "dinner",
    "taxi",
    "transport fare",
    "airtime",
    "office stationery"
  ];
  return nonInventorySignals.some((signal) => normalized.includes(signal));
}

function normalizeLineDescription(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
