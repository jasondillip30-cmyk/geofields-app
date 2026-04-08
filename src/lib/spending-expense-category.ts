import { formatInventoryCategory } from "@/lib/inventory";
import { prisma } from "@/lib/prisma";

export interface SpendingCategoryExpenseLike {
  id: string;
  category: string;
  entrySource: string | null;
}

export function resolveSpendingMovementCategory({
  itemCategory,
  fallbackCategory
}: {
  itemCategory: string | null | undefined;
  fallbackCategory?: string | null | undefined;
}) {
  if (itemCategory) {
    return normalizeLabel(formatInventoryCategory(itemCategory), "Uncategorized");
  }
  return normalizeLabel(fallbackCategory, "Uncategorized");
}

export function resolveSpendingExpenseCategory({
  expense,
  movementCategoryByExpenseId
}: {
  expense: SpendingCategoryExpenseLike;
  movementCategoryByExpenseId: Map<string, string>;
}) {
  const normalizedEntrySource = normalizeLabel(expense.entrySource, "").toUpperCase();
  const normalizedCategory = normalizeLabel(expense.category, "").toLowerCase();
  const isInventoryUsageExpense =
    normalizedEntrySource === "INVENTORY_USAGE" || normalizedCategory === "inventory usage";

  if (isInventoryUsageExpense) {
    const mappedCategory = movementCategoryByExpenseId.get(expense.id);
    if (mappedCategory) {
      return mappedCategory;
    }
  }

  return normalizeLabel(expense.category, "Uncategorized");
}

export async function loadMovementCategoryByExpenseId(expenseIds: string[]) {
  if (expenseIds.length === 0) {
    return new Map<string, string>();
  }

  const movementRows = await prisma.inventoryMovement.findMany({
    where: {
      expenseId: {
        in: expenseIds
      }
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      expenseId: true,
      item: {
        select: {
          category: true
        }
      }
    }
  });

  const byExpenseId = new Map<string, string>();
  for (const row of movementRows) {
    const expenseId = row.expenseId || "";
    if (!expenseId || byExpenseId.has(expenseId)) {
      continue;
    }
    const category = row.item?.category;
    if (!category) {
      continue;
    }
    byExpenseId.set(expenseId, formatInventoryCategory(category));
  }
  return byExpenseId;
}

function normalizeLabel(value: string | null | undefined, fallback: string) {
  const trimmed = `${value || ""}`.trim();
  return trimmed || fallback;
}
