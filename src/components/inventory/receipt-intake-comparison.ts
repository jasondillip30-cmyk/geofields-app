import type {
  ReceiptIntakePanelProps,
  ReceiptSnapshotLine,
  RequisitionComparisonResult,
  ReviewState
} from "@/components/inventory/receipt-intake-panel-types";
import { formatCurrency } from "@/lib/utils";
import { applyReceiptClassificationLineDefaults } from "@/components/inventory/receipt-intake-workflow-utils";
import {
  asString,
  isMeaningfulSnapshotLine,
  mapRequisitionLineItems,
  normalizeSupplierName,
  resolveRequisitionEstimatedTotal
} from "@/components/inventory/receipt-intake-review-state";

type ComparisonSignalLevel = "MATCHED" | "CLOSE_MATCH" | "MISMATCH" | "UNAVAILABLE";

export function buildRequisitionMismatchReview({
  scannedReview,
  initialRequisition
}: {
  scannedReview: ReviewState;
  initialRequisition: ReceiptIntakePanelProps["initialRequisition"];
}): ReviewState {
  const requisitionSupplier = normalizeSupplierName(asString(initialRequisition?.requestedVendorName));
  const requisitionEstimatedTotal = resolveRequisitionEstimatedTotal(initialRequisition);
  const requisitionLines = mapRequisitionLineItems(initialRequisition, scannedReview.receiptClassification);
  const hasRequisitionTotal = Number.isFinite(requisitionEstimatedTotal) && requisitionEstimatedTotal > 0;

  return {
    ...scannedReview,
    supplierId: requisitionSupplier ? "" : scannedReview.supplierId,
    supplierName: requisitionSupplier || scannedReview.supplierName,
    subtotal: hasRequisitionTotal ? String(requisitionEstimatedTotal) : scannedReview.subtotal,
    tax: hasRequisitionTotal ? "0" : scannedReview.tax,
    total: hasRequisitionTotal ? String(requisitionEstimatedTotal) : scannedReview.total,
    warnings: Array.from(
      new Set([
        ...scannedReview.warnings,
        "Receipt does not match requisition. Complete receipt fields manually."
      ])
    ),
    scanFallbackMode: "NONE",
    lines:
      requisitionLines.length > 0
        ? applyReceiptClassificationLineDefaults(requisitionLines, scannedReview.receiptClassification)
        : scannedReview.lines
  };
}

export function evaluateRequisitionComparison(
  review: ReviewState | null,
  initialRequisition: ReceiptIntakePanelProps["initialRequisition"]
): RequisitionComparisonResult | null {
  if (!review) {
    return null;
  }

  const approvedLines = mapRequisitionSnapshotLines(initialRequisition);
  const scannedLines = review.scannedSnapshot.lines.filter((line) => isMeaningfulSnapshotLine(line));
  const approvedSupplier = normalizeSupplierName(asString(initialRequisition?.requestedVendorName));
  const scannedSupplier = normalizeSupplierName(review.scannedSnapshot.supplierName);
  const approvedTotalValue = resolveRequisitionEstimatedTotal(initialRequisition);
  const scannedTotalValue = Number(review.scannedSnapshot.total || 0);
  const scanTrust = resolveScanTrustState(review, scannedLines);
  const supplierComparison = compareTextSimilarity(approvedSupplier, scannedSupplier, {
    matchedThreshold: 0.84,
    closeThreshold: 0.62
  });
  const totalComparison = compareNumericSimilarity(approvedTotalValue, scannedTotalValue, {
    matchedToleranceRatio: 0.03,
    closeToleranceRatio: 0.1
  });
  const lineComparison = evaluateLineComparison(approvedLines, scannedLines);
  const inferredTraToken = inferTraTokenFromRawQrValue(review.rawQrValue || review.verificationUrl);
  const inferredFields: string[] = [];
  if (inferredTraToken?.verificationCode) {
    inferredFields.push("verification code");
  }
  if (inferredTraToken?.traReceiptNumber) {
    inferredFields.push("control / TRA number");
  }
  const scannedControlDisplay = formatInferredScanField({
    scannedValue: review.traReceiptNumber,
    inferredValue: inferredTraToken?.traReceiptNumber || ""
  });
  const scannedVerificationCodeDisplay = formatInferredScanField({
    scannedValue: review.verificationCode,
    inferredValue: inferredTraToken?.verificationCode || ""
  });
  const missingCriticalFields = [
    !review.scannedSnapshot.supplierName ? "supplier" : "",
    !review.scannedSnapshot.receiptNumber ? "receipt number" : "",
    !review.scannedSnapshot.receiptDate ? "receipt date" : "",
    !review.scannedSnapshot.total ? "total amount" : ""
  ].filter(Boolean);
  const approvedRequestedItem = approvedLines[0]?.description || "-";
  const scannedRequestedItem = scannedLines[0]?.description || "-";

  const headerRows: RequisitionComparisonResult["headerRows"] = [
    {
      label: "Supplier",
      approved: approvedSupplier || "-",
      scanned: review.scannedSnapshot.supplierName || "-",
      mismatch: supplierComparison.level === "MISMATCH"
    },
    {
      label: "Receipt Number",
      approved: "-",
      scanned: review.scannedSnapshot.receiptNumber || "-",
      mismatch: false
    },
    {
      label: "Control / TRA #",
      approved: "-",
      scanned: scannedControlDisplay,
      mismatch: false
    },
    {
      label: "Verification Code",
      approved: "-",
      scanned: scannedVerificationCodeDisplay,
      mismatch: false
    },
    {
      label: "TIN",
      approved: "-",
      scanned: review.tin || "-",
      mismatch: false
    },
    {
      label: "Verification URL",
      approved: "-",
      scanned: review.verificationUrl || "-",
      mismatch: false
    },
    {
      label: "Raw QR Content",
      approved: "-",
      scanned: truncateComparisonValue(review.rawQrValue, 96),
      mismatch: false
    },
    {
      label: "Receipt Date",
      approved: "-",
      scanned: review.scannedSnapshot.receiptDate || "-",
      mismatch: false
    },
    {
      label: "Total Amount",
      approved: approvedTotalValue > 0 ? formatCurrency(approvedTotalValue) : "-",
      scanned: review.scannedSnapshot.total
        ? formatCurrency(Number(review.scannedSnapshot.total || 0))
        : "-",
      mismatch: totalComparison.level === "MISMATCH"
    }
  ];

  const canInspectScannedDetails =
    scanTrust.meaningfulData &&
    (scannedLines.length > 0 ||
      review.scannedSnapshot.receiptNumber.trim().length > 0 ||
      review.traReceiptNumber.trim().length > 0 ||
      review.verificationCode.trim().length > 0 ||
      review.verificationUrl.trim().length > 0 ||
      review.rawQrValue.trim().length > 0 ||
      review.tin.trim().length > 0 ||
      Number(review.scannedSnapshot.total || 0) > 0);
  const differenceRows: RequisitionComparisonResult["differenceRows"] = [
    {
      label: "Supplier",
      approved: approvedSupplier || "-",
      scanned: review.scannedSnapshot.supplierName || "-"
    },
    {
      label: "Total amount",
      approved: approvedTotalValue > 0 ? formatCurrency(approvedTotalValue) : "-",
      scanned: scannedTotalValue > 0 ? formatCurrency(scannedTotalValue) : "-"
    },
    {
      label: "Requested item",
      approved: approvedRequestedItem,
      scanned: scannedRequestedItem
    }
  ];

  const baseResult = {
    scanTrustLabel: scanTrust.label,
    scanTrustMessage: scanTrust.message,
    differenceRows: [],
    headerRows,
    approvedLines,
    scannedLines
  };

  if (review.scanFallbackMode === "SCAN_FAILURE") {
    return {
      status: "SCAN_FAILED",
      label: "Manual review needed",
      message: "Receipt scan could not be completed confidently. Please review and complete required fields.",
      canInspectScannedDetails: false,
      ...baseResult
    };
  }

  if (review.scanFallbackMode === "MANUAL_ENTRY") {
    return {
      status: "MANUAL_ENTRY",
      label: "Manual review needed",
      message: "Manual receipt entry is active. Confirm key fields before continuing.",
      canInspectScannedDetails: false,
      ...baseResult
    };
  }

  if (!scanTrust.meaningfulData) {
    return {
      status: "SCAN_FAILED",
      label: "Manual review needed",
      message: "Receipt scan data is incomplete. Please review and complete required fields.",
      canInspectScannedDetails: false,
      ...baseResult
    };
  }

  const hardMismatch =
    supplierComparison.level === "MISMATCH" ||
    totalComparison.level === "MISMATCH" ||
    lineComparison.level === "MISMATCH";

  if (hardMismatch) {
    return {
      status: "MISMATCH",
      label: "Receipt does not match requisition",
      message: "Review scanned receipt details or complete receipt fields manually.",
      canInspectScannedDetails,
      ...baseResult,
      differenceRows
    };
  }

  const closeMatchSignals =
    supplierComparison.level === "CLOSE_MATCH" ||
    totalComparison.level === "CLOSE_MATCH" ||
    lineComparison.level === "CLOSE_MATCH" ||
    review.scanStatus !== "COMPLETE" ||
    missingCriticalFields.length > 0 ||
    inferredFields.length > 0;

  if (closeMatchSignals) {
    const inferredFieldsMessage =
      inferredFields.length > 0
        ? `${joinFieldLabels(inferredFields)} inferred from QR URL and should be verified.`
        : "";
    const missingFieldsMessage =
      missingCriticalFields.length > 0
        ? `Some fields need manual review: ${missingCriticalFields.join(", ")}${inferredFieldsMessage ? `. ${inferredFieldsMessage}` : "."}`
        : inferredFieldsMessage
          ? inferredFieldsMessage
          : "Scanned details are close to the approved requisition. Quick review is recommended.";
    return {
      status: "CLOSE_MATCH",
      label: "Manual review needed",
      message: missingFieldsMessage,
      canInspectScannedDetails,
      ...baseResult
    };
  }

  return {
    status: "MATCHED",
    label: "Receipt scanned successfully",
    message: "Scanned receipt details align with the approved requisition.",
    canInspectScannedDetails,
    ...baseResult
  };
}

function mapRequisitionSnapshotLines(
  initialRequisition: ReceiptIntakePanelProps["initialRequisition"]
): ReceiptSnapshotLine[] {
  if (!initialRequisition || !Array.isArray(initialRequisition.lineItems)) {
    return [];
  }
  return initialRequisition.lineItems
    .map((line, index) => ({
      id: `rq-${line.id || index + 1}`,
      description: String(line.description || "").trim(),
      quantity: String(Number(line.quantity || 0)),
      unitPrice: String(Number(line.estimatedUnitCost || 0)),
      lineTotal: String(Number(line.estimatedTotalCost || 0))
    }))
    .filter((line) => line.description.length > 0);
}

function evaluateLineComparison(
  approvedLines: ReceiptSnapshotLine[],
  scannedLines: ReceiptSnapshotLine[]
) {
  if (approvedLines.length === 0 || scannedLines.length === 0) {
    return { level: "UNAVAILABLE" as ComparisonSignalLevel };
  }

  const usedScannedIndices = new Set<number>();
  let strongMatches = 0;
  let closeMatches = 0;
  let weakMatches = 0;

  for (const approved of approvedLines) {
    let bestIndex = -1;
    let bestScore = -1;

    scannedLines.forEach((scanned, index) => {
      if (usedScannedIndices.has(index)) {
        return;
      }
      const score = evaluateLinePairScore(approved, scanned);
      if (score > bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    });

    if (bestIndex < 0) {
      weakMatches += 1;
      continue;
    }
    usedScannedIndices.add(bestIndex);
    if (bestScore >= 0.82) {
      strongMatches += 1;
    } else if (bestScore >= 0.62) {
      closeMatches += 1;
    } else {
      weakMatches += 1;
    }
  }

  const extraScannedLines = Math.max(0, scannedLines.length - usedScannedIndices.size);
  if (extraScannedLines > 1) {
    weakMatches += extraScannedLines;
  } else if (extraScannedLines === 1) {
    closeMatches += 1;
  }

  if (weakMatches > 0) {
    return { level: "MISMATCH" as ComparisonSignalLevel };
  }
  if (closeMatches > 0) {
    return { level: "CLOSE_MATCH" as ComparisonSignalLevel };
  }
  if (strongMatches > 0) {
    return { level: "MATCHED" as ComparisonSignalLevel };
  }
  return { level: "UNAVAILABLE" as ComparisonSignalLevel };
}

function evaluateLinePairScore(approved: ReceiptSnapshotLine, scanned: ReceiptSnapshotLine) {
  const descriptionScore = lineDescriptionSimilarity(approved.description, scanned.description);
  const quantityScore = comparisonLevelWeight(
    compareNumericSimilarity(Number(approved.quantity || 0), Number(scanned.quantity || 0), {
      matchedToleranceRatio: 0.05,
      closeToleranceRatio: 0.2
    }).level
  );
  const unitPriceScore = comparisonLevelWeight(
    compareNumericSimilarity(Number(approved.unitPrice || 0), Number(scanned.unitPrice || 0), {
      matchedToleranceRatio: 0.05,
      closeToleranceRatio: 0.2
    }).level
  );
  const totalScore = comparisonLevelWeight(
    compareNumericSimilarity(Number(approved.lineTotal || 0), Number(scanned.lineTotal || 0), {
      matchedToleranceRatio: 0.03,
      closeToleranceRatio: 0.12
    }).level
  );

  return descriptionScore * 0.55 + quantityScore * 0.15 + unitPriceScore * 0.1 + totalScore * 0.2;
}

function compareTextSimilarity(
  approvedValue: string,
  scannedValue: string,
  thresholds: {
    matchedThreshold: number;
    closeThreshold: number;
  }
) {
  if (!approvedValue || !scannedValue) {
    return {
      level: "UNAVAILABLE" as ComparisonSignalLevel,
      similarity: 0
    };
  }

  const similarity = lineDescriptionSimilarity(approvedValue, scannedValue);
  if (similarity >= thresholds.matchedThreshold) {
    return { level: "MATCHED" as ComparisonSignalLevel, similarity };
  }
  if (similarity >= thresholds.closeThreshold) {
    return { level: "CLOSE_MATCH" as ComparisonSignalLevel, similarity };
  }
  return { level: "MISMATCH" as ComparisonSignalLevel, similarity };
}

function compareNumericSimilarity(
  approvedValue: number,
  scannedValue: number,
  thresholds: {
    matchedToleranceRatio: number;
    closeToleranceRatio: number;
  }
) {
  if (
    !Number.isFinite(approvedValue) ||
    !Number.isFinite(scannedValue) ||
    approvedValue <= 0 ||
    scannedValue <= 0
  ) {
    return {
      level: "UNAVAILABLE" as ComparisonSignalLevel,
      differenceRatio: 0
    };
  }

  const differenceRatio = Math.abs(approvedValue - scannedValue) / Math.max(Math.abs(approvedValue), Math.abs(scannedValue), 1);
  if (differenceRatio <= thresholds.matchedToleranceRatio) {
    return { level: "MATCHED" as ComparisonSignalLevel, differenceRatio };
  }
  if (differenceRatio <= thresholds.closeToleranceRatio) {
    return { level: "CLOSE_MATCH" as ComparisonSignalLevel, differenceRatio };
  }
  return { level: "MISMATCH" as ComparisonSignalLevel, differenceRatio };
}

function comparisonLevelWeight(level: ComparisonSignalLevel) {
  if (level === "MATCHED") {
    return 1;
  }
  if (level === "CLOSE_MATCH") {
    return 0.72;
  }
  if (level === "UNAVAILABLE") {
    return 0.55;
  }
  return 0;
}

function resolveScanTrustState(review: ReviewState, scannedLines: ReceiptSnapshotLine[]) {
  if (review.scanFallbackMode === "SCAN_FAILURE") {
    return {
      meaningfulData: false,
      label: "Scan failed",
      message: "We could not read meaningful receipt or QR details from this file."
    };
  }
  if (review.scanFallbackMode === "MANUAL_ENTRY") {
    return {
      meaningfulData: false,
      label: "Manual entry",
      message: "Manual receipt entry was selected, so there is no scan payload to compare."
    };
  }

  const hasKeyFields =
    review.scannedSnapshot.receiptNumber.trim().length > 0 ||
    review.scannedSnapshot.supplierName.trim().length > 0 ||
    review.scannedSnapshot.receiptDate.trim().length > 0 ||
    Number(review.scannedSnapshot.total || 0) > 0;
  const hasQrMetadata =
    review.verificationCode.trim().length > 0 ||
    review.traReceiptNumber.trim().length > 0 ||
    review.tin.trim().length > 0 ||
    review.vrn.trim().length > 0 ||
    review.verificationUrl.trim().length > 0 ||
    review.rawQrValue.trim().length > 0;
  const qrDecodeSucceeded =
    review.qrDecodeStatus === "DECODED" ||
    review.qrParseStatus === "PARSED" ||
    review.qrFieldsParseStatus === "SUCCESS" ||
    review.qrLineItemsParseStatus === "SUCCESS";
  const hasMeaningfulData = hasKeyFields || scannedLines.length > 0 || (qrDecodeSucceeded && hasQrMetadata);

  if (!hasMeaningfulData) {
    return {
      meaningfulData: false,
      label: "Scan failed",
      message: "We could not read meaningful receipt or QR details from this file."
    };
  }

  if (qrDecodeSucceeded) {
    return {
      meaningfulData: true,
      label: "QR scanned",
      message: "QR/receipt data was detected and mapped. Review highlighted differences before posting."
    };
  }

  return {
    meaningfulData: true,
    label: "Scan captured",
    message: "Receipt data was captured, but some details may still need review."
  };
}

function lineDescriptionSimilarity(approved: string, scanned: string) {
  const approvedNormalized = normalizeLineDescription(approved);
  const scannedNormalized = normalizeLineDescription(scanned);
  if (!approvedNormalized || !scannedNormalized) {
    return 0.5;
  }
  if (approvedNormalized === scannedNormalized) {
    return 1;
  }
  if (approvedNormalized.includes(scannedNormalized) || scannedNormalized.includes(approvedNormalized)) {
    return 0.92;
  }

  const approvedTokens = tokenizeNormalized(approvedNormalized);
  const scannedTokens = tokenizeNormalized(scannedNormalized);
  const tokenSimilarity = jaccardSimilarity(approvedTokens, scannedTokens);
  const editSimilarity = levenshteinSimilarity(approvedNormalized, scannedNormalized);
  return Math.max(tokenSimilarity, editSimilarity);
}

function tokenizeNormalized(value: string) {
  return value
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length > 1);
}

function jaccardSimilarity(leftTokens: string[], rightTokens: string[]) {
  if (leftTokens.length === 0 || rightTokens.length === 0) {
    return 0;
  }
  const left = new Set(leftTokens);
  const right = new Set(rightTokens);
  let overlap = 0;
  left.forEach((token) => {
    if (right.has(token)) {
      overlap += 1;
    }
  });
  return overlap / Math.max(left.size + right.size - overlap, 1);
}

function levenshteinSimilarity(left: string, right: string) {
  if (!left || !right) {
    return 0;
  }
  const distance = levenshteinDistance(left, right);
  const maxLength = Math.max(left.length, right.length, 1);
  return Math.max(0, 1 - distance / maxLength);
}

function levenshteinDistance(left: string, right: string) {
  const matrix: number[][] = Array.from({ length: left.length + 1 }, () =>
    Array.from({ length: right.length + 1 }, () => 0)
  );
  for (let row = 0; row <= left.length; row += 1) {
    matrix[row][0] = row;
  }
  for (let col = 0; col <= right.length; col += 1) {
    matrix[0][col] = col;
  }
  for (let row = 1; row <= left.length; row += 1) {
    for (let col = 1; col <= right.length; col += 1) {
      const cost = left[row - 1] === right[col - 1] ? 0 : 1;
      matrix[row][col] = Math.min(
        matrix[row - 1][col] + 1,
        matrix[row][col - 1] + 1,
        matrix[row - 1][col - 1] + cost
      );
    }
  }
  return matrix[left.length][right.length];
}

function normalizeLineDescription(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function inferTraTokenFromRawQrValue(rawValue: string) {
  const normalized = rawValue.trim();
  if (!normalized) {
    return null;
  }
  const candidateUrl = toLikelyUrl(normalized);
  if (!candidateUrl) {
    return null;
  }
  const host = candidateUrl.hostname.toLowerCase();
  if (!(host === "tra.go.tz" || host.endsWith(".tra.go.tz"))) {
    return null;
  }
  const segments = candidateUrl.pathname
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean);
  const token = segments[segments.length - 1] || "";
  const matched = token.match(/^([0-9a-z\-]{6,32})[_]([0-9a-z\-]{1,16})$/i);
  if (!matched) {
    return null;
  }
  const verificationCode = matched[1]?.trim().toUpperCase() || "";
  const traReceiptNumber = matched[2]?.trim().toUpperCase() || "";
  if (!verificationCode || !traReceiptNumber) {
    return null;
  }
  return { verificationCode, traReceiptNumber };
}

function toLikelyUrl(value: string) {
  try {
    if (/^https?:\/\//i.test(value)) {
      return new URL(value);
    }
    if (/^(?:www\.)?(?:[a-z0-9-]+\.)+[a-z]{2,}(?:[/?#][^\s]*)?$/i.test(value)) {
      return new URL(`https://${value}`);
    }
    return null;
  } catch {
    return null;
  }
}

function formatInferredScanField({
  scannedValue,
  inferredValue
}: {
  scannedValue: string;
  inferredValue: string;
}) {
  const normalizedScanned = scannedValue.trim();
  if (!inferredValue) {
    return normalizedScanned || "-";
  }
  if (!normalizedScanned) {
    return `${inferredValue} (inferred from QR URL; verify)`;
  }
  if (normalizedScanned.toUpperCase() === inferredValue.toUpperCase()) {
    return `${normalizedScanned} (inferred from QR URL; verify)`;
  }
  return normalizedScanned;
}

function joinFieldLabels(fields: string[]) {
  if (fields.length === 0) {
    return "";
  }
  if (fields.length === 1) {
    return fields[0];
  }
  if (fields.length === 2) {
    return `${fields[0]} and ${fields[1]}`;
  }
  return `${fields.slice(0, -1).join(", ")}, and ${fields[fields.length - 1]}`;
}

function truncateComparisonValue(value: string, maxLength = 96) {
  const trimmed = value.trim();
  if (!trimmed) {
    return "-";
  }
  if (trimmed.length <= maxLength) {
    return trimmed;
  }
  return `${trimmed.slice(0, Math.max(0, maxLength - 3))}...`;
}
