import { roundCurrency } from "@/lib/inventory-server";
import type { PurchaseRequisitionPayload } from "@/lib/requisition-workflow";
import {
  resolveSpendingExpenseCategory,
  type SpendingCategoryExpenseLike
} from "@/lib/spending-expense-category";

export interface SpendingTransactionExpenseLike extends SpendingCategoryExpenseLike {
  date: Date;
  amount: number;
  vendor: string | null;
}

export interface SpendingTransactionRecord {
  id: string;
  requisitionCode: string;
  date: string;
  merchant: string;
  category: string;
  amount: number;
  expenseId: string | null;
  editable: boolean;
  dateValue: Date;
}

export interface SpendingTransactionFilters {
  fromDate?: Date | null;
  toDate?: Date | null;
  category?: string | null;
  query?: string | null;
}

export function buildSpendingTransactionRecord({
  requisitionId,
  reportDate,
  payload,
  expense,
  movementCategoryByExpenseId
}: {
  requisitionId: string;
  reportDate: Date;
  payload: PurchaseRequisitionPayload;
  expense: SpendingTransactionExpenseLike | null;
  movementCategoryByExpenseId: Map<string, string>;
}): SpendingTransactionRecord {
  const fallbackDate =
    (payload.purchase.postedAt ? parseIsoDateOrNull(payload.purchase.postedAt) : null) || reportDate;
  const dateValue = expense?.date || fallbackDate;
  const fallbackAmount = safeNumber(payload.totals.actualPostedCost);
  const amount =
    expense && safeNumber(expense.amount) > 0
      ? roundCurrency(safeNumber(expense.amount))
      : roundCurrency(fallbackAmount);

  const categoryFromExpense = expense
    ? resolveSpendingExpenseCategory({
        expense,
        movementCategoryByExpenseId
      })
    : "";

  const category = normalizeLabel(
    categoryFromExpense,
    normalizeLabel(payload.subcategory, normalizeLabel(payload.category, "Uncategorized"))
  );

  const merchant = normalizeLabel(
    expense?.vendor,
    normalizeLabel(payload.purchase.supplierName, normalizeLabel(payload.requestedVendorName, "Unknown merchant"))
  );

  const expenseId = normalizeLabel(payload.purchase.expenseId, "") || null;
  return {
    id: requisitionId,
    requisitionCode: normalizeLabel(payload.requisitionCode, requisitionId),
    date: toDateIso(dateValue),
    merchant,
    category,
    amount,
    expenseId,
    editable: Boolean(expense),
    dateValue
  };
}

export function matchesSpendingTransactionFilters(
  record: SpendingTransactionRecord,
  { fromDate, toDate, category, query }: SpendingTransactionFilters
) {
  if (fromDate && record.dateValue < fromDate) {
    return false;
  }
  if (toDate && record.dateValue > toDate) {
    return false;
  }

  const normalizedCategory = normalizeLabel(category, "");
  if (normalizedCategory && normalizedCategory !== "all") {
    if (record.category.toLowerCase() !== normalizedCategory.toLowerCase()) {
      return false;
    }
  }

  const normalizedQuery = normalizeLabel(query, "").toLowerCase();
  if (normalizedQuery) {
    const merchantMatch = record.merchant.toLowerCase().includes(normalizedQuery);
    const categoryMatch = record.category.toLowerCase().includes(normalizedQuery);
    const codeMatch = record.requisitionCode.toLowerCase().includes(normalizedQuery);
    if (!merchantMatch && !categoryMatch && !codeMatch) {
      return false;
    }
  }

  return true;
}

export function parseDateOrNull(value: string | null, endOfDay = false) {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  if (endOfDay) {
    parsed.setUTCHours(23, 59, 59, 999);
  } else {
    parsed.setUTCHours(0, 0, 0, 0);
  }
  return parsed;
}

export function nullableFilter(value: string | null) {
  return value && value !== "all" ? value : null;
}

export function normalizeLabel(value: string | null | undefined, fallback: string) {
  const trimmed = `${value || ""}`.trim();
  return trimmed || fallback;
}

export function safeNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function toDateIso(value: Date) {
  return value.toISOString().slice(0, 10);
}

export function parseIsoDateOrNull(value: string | null | undefined) {
  const normalized = normalizeLabel(value, "");
  if (!normalized) {
    return null;
  }
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed;
}

export function sortSpendingTransactions(rows: SpendingTransactionRecord[]) {
  return [...rows].sort((a, b) => {
    const dateDiff = b.dateValue.getTime() - a.dateValue.getTime();
    if (dateDiff !== 0) {
      return dateDiff;
    }
    const amountDiff = safeNumber(b.amount) - safeNumber(a.amount);
    if (amountDiff !== 0) {
      return amountDiff;
    }
    return a.requisitionCode.localeCompare(b.requisitionCode);
  });
}
