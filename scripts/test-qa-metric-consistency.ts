import assert from "node:assert/strict";

import { summarizeInventoryValuation } from "../src/lib/inventory-valuation";
import { calculateCostPerMeter } from "../src/lib/project-performance-metrics";
import { resolveProjectStatusOnSetupSave } from "../src/lib/project-status-policy";

const valuation = summarizeInventoryValuation([
  { quantityInStock: 10, unitCost: 100, locationId: "warehouse-1" },
  { quantityInStock: 2, unitCost: 250, locationId: null }
]);
assert.deepEqual(valuation, {
  totalValue: 1500,
  locatedValue: 1000,
  unassignedLocationValue: 500,
  unassignedLocationItemCount: 1
});

assert.equal(calculateCostPerMeter(26_550, 122), 217.62);
assert.equal(calculateCostPerMeter(26_550, 0), null);

assert.equal(
  resolveProjectStatusOnSetupSave({
    existingStatus: "ACTIVE",
    dateDerivedStatus: "COMPLETED"
  }),
  "ACTIVE",
  "A setup edit must not silently close an operationally active project."
);
assert.equal(
  resolveProjectStatusOnSetupSave({ dateDerivedStatus: "PLANNED" }),
  "PLANNED",
  "New projects should use the initial date-derived status."
);

console.log("QA metric consistency regressions passed.");
