import assert from "node:assert/strict";

import {
  isFinancialActualUseMovement,
  withFinancialActualUseMovementApproval
} from "../src/lib/financial-approval-policy";

assert.equal(
  isFinancialActualUseMovement({
    movementType: "OUT",
    expenseId: "approved-expense",
    expenseApprovalStatus: "APPROVED"
  }),
  true
);
assert.equal(
  isFinancialActualUseMovement({
    movementType: "OUT",
    expenseId: "draft-expense",
    expenseApprovalStatus: "DRAFT"
  }),
  false,
  "A stock-out linked to a draft expense must not enter approved actual-use totals."
);
assert.equal(
  isFinancialActualUseMovement({
    movementType: "IN",
    expenseId: "approved-purchase",
    expenseApprovalStatus: "APPROVED"
  }),
  false,
  "A purchase receipt is recognized spend, not actual-use stock-out."
);

const where = withFinancialActualUseMovementApproval({ projectId: "project-1" });
assert.deepEqual(where, {
  projectId: "project-1",
  movementType: "OUT",
  expenseId: { not: null },
  expense: {
    is: {
      approvalStatus: { in: ["APPROVED"] }
    }
  }
});

console.log("Actual-use movement approval regression passed.");
