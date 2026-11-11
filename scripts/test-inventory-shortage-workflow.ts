import assert from "node:assert/strict";

import {
  calculateReplenishmentQuantity,
  deriveInitialUsageRequestStatus,
  derivePostReceiptUsageStatus
} from "../src/lib/inventory-shortage-workflow";

assert.equal(
  deriveInitialUsageRequestStatus({ quantityRequested: 8, quantityInStock: 3 }),
  "WAITING_FOR_STOCK"
);
assert.equal(calculateReplenishmentQuantity({ quantityRequested: 8, quantityInStock: 3 }), 5);
assert.equal(
  derivePostReceiptUsageStatus({
    currentStatus: "WAITING_FOR_STOCK",
    quantityRequested: 8,
    quantityInStock: 7
  }),
  "WAITING_FOR_STOCK"
);
assert.equal(
  derivePostReceiptUsageStatus({
    currentStatus: "WAITING_FOR_STOCK",
    quantityRequested: 8,
    quantityInStock: 8
  }),
  "READY_TO_ISSUE"
);
assert.equal(
  derivePostReceiptUsageStatus({
    currentStatus: "APPROVED",
    quantityRequested: 8,
    quantityInStock: 20
  }),
  "APPROVED"
);

console.log("Inventory shortage workflow regression passed.");
