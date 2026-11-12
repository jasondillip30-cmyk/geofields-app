import assert from "node:assert/strict";

import { summarizeInventoryValuation } from "../src/lib/inventory-valuation";
import { calculateCostPerMeter } from "../src/lib/project-performance-metrics";
import {
  canCloseProject,
  resolveProjectOperationalStatus,
  resolveScheduledProjectStatus,
  scheduledProjectCloseout,
  unclosedProjectWhere
} from "../src/lib/project-status-policy";

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

const endDate = new Date("2026-06-30");
const lastMoment = new Date("2026-06-30T23:59:59.999Z");
const nextDay = new Date("2026-07-01T00:00:00.000Z");
const project = { status: "ACTIVE" as const, endDate, closedAt: null };
assert.equal(resolveProjectOperationalStatus(project, lastMoment), "ACTIVE");
assert.equal(resolveProjectOperationalStatus(project, nextDay), "COMPLETED");
assert.equal(resolveProjectOperationalStatus({ ...project, status: "ON_HOLD" }, nextDay), "COMPLETED");
assert.equal(resolveProjectOperationalStatus({ ...project, endDate: null }, nextDay), "ACTIVE");
assert.equal(resolveProjectOperationalStatus({ ...project, closedAt: lastMoment }, lastMoment), "COMPLETED");
assert.equal(resolveScheduledProjectStatus(new Date("2026-08-01"), null, nextDay), "PLANNED");
assert.deepEqual(scheduledProjectCloseout(endDate, nextDay), nextDay);
assert.deepEqual(unclosedProjectWhere(nextDay), {
  closedAt: null,
  OR: [{ endDate: null }, { endDate: { gte: nextDay } }]
});
assert.equal(canCloseProject("MANAGER"), true);
assert.equal(canCloseProject("ADMIN"), true);
assert.equal(canCloseProject("OFFICE"), false);

console.log("QA metric consistency regressions passed.");
