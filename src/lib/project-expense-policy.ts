import type { ClassifiedApprovedSpendRow } from "@/lib/approved-spend-classification";
import { roundCurrency } from "@/lib/cost-tracking";

export interface ProjectExpensePolicySummary {
  rows: ClassifiedApprovedSpendRow[];
  total: number;
  excludedStockReplenishmentTotal: number;
}

/**
 * Project Expenses include recognized direct costs and approved inventory use.
 * Stock replenishment is excluded until the stock is issued to project work.
 */
export function buildProjectExpensePolicySummary(
  rows: ClassifiedApprovedSpendRow[]
): ProjectExpensePolicySummary {
  const includedRows: ClassifiedApprovedSpendRow[] = [];
  const seenExpenseIds = new Set<string>();
  let excludedStockReplenishmentTotal = 0;

  for (const row of rows) {
    if (seenExpenseIds.has(row.expenseId)) {
      continue;
    }
    seenExpenseIds.add(row.expenseId);

    if (row.purposeBucket === "STOCK_REPLENISHMENT") {
      excludedStockReplenishmentTotal += row.amount;
      continue;
    }

    includedRows.push(row);
  }

  return {
    rows: includedRows,
    total: roundCurrency(includedRows.reduce((sum, row) => sum + row.amount, 0)),
    excludedStockReplenishmentTotal: roundCurrency(excludedStockReplenishmentTotal)
  };
}
