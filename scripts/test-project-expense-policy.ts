import assert from "node:assert/strict";

import type { ClassifiedApprovedSpendRow } from "../src/lib/approved-spend-classification";
import { buildProjectExpensePolicySummary } from "../src/lib/project-expense-policy";

function row(
  expenseId: string,
  amount: number,
  purposeBucket: ClassifiedApprovedSpendRow["purposeBucket"],
  movementSummary: string | null
): ClassifiedApprovedSpendRow {
  return {
    expenseId,
    date: "2026-04-07T00:00:00.000Z",
    amount,
    purposeBucket,
    purposeLabel: purposeBucket,
    accountingCategoryKey: "miscellaneous",
    accountingCategoryLabel: "Miscellaneous",
    traceability: "Synthetic policy fixture.",
    sourceType: purposeBucket === "STOCK_REPLENISHMENT" ? "STOCK_LINKAGE" : "PROJECT_LINKAGE",
    linkedProjectId: "project-1",
    linkedRigId: null,
    maintenanceRequestId: null,
    breakdownReportId: null,
    requisitionCode: null,
    movementSummary,
    legacyFlags: {
      legacyBreakdownMarker: false,
      maintenanceLikeWithoutLink: false,
      noProjectLink: false,
      noRigLink: true
    }
  };
}

const directProjectExpense = row("direct-expense", 250, "OPERATING_COST", null);
const stockPurchase = row("stock-purchase", 250, "STOCK_REPLENISHMENT", "Movements INx1");
const approvedConsumption = row("stock-consumption", 250, "OPERATING_COST", "Movements OUTx1");

const summary = buildProjectExpensePolicySummary([
  directProjectExpense,
  stockPurchase,
  approvedConsumption,
  approvedConsumption
]);

assert.deepEqual(
  summary.rows.map((entry) => entry.expenseId),
  ["direct-expense", "stock-consumption"],
  "Direct project expenses and approved consumption should count, while stock replenishment and duplicate rows should not."
);
assert.equal(summary.total, 500);
assert.equal(summary.excludedStockReplenishmentTotal, 250);

console.log("Project expense policy regression passed.");
