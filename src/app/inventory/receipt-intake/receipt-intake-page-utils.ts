import type { ReceiptSubmissionSummary } from "./receipt-intake-page-types";

export function toIsoDate(value: string) {
  if (!value) {
    return "-";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toISOString().slice(0, 10);
}

export function normalizeOptionalId(value: string | null) {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed !== "all" ? trimmed : null;
}

export function normalizeRequisitionType(value: string | null) {
  if (
    value === "LIVE_PROJECT_PURCHASE" ||
    value === "INVENTORY_STOCK_UP" ||
    value === "MAINTENANCE_PURCHASE"
  ) {
    return value;
  }
  return null;
}

export function normalizeLiveProjectSpendType(value: unknown): "BREAKDOWN" | "NORMAL_EXPENSE" | null {
  if (value === "BREAKDOWN" || value === "NORMAL_EXPENSE") {
    return value;
  }
  return null;
}

export function countSubmissionStatus(
  submissions: ReceiptSubmissionSummary[],
  status: ReceiptSubmissionSummary["status"]
) {
  return submissions.filter((row) => row.status === status).length;
}
