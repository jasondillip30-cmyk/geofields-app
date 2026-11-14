import assert from "node:assert/strict";
import { assessProjectBudgetHealth, type BudgetHealthPlan } from "../src/lib/project-budget-health";

const plan: BudgetHealthPlan = { amount: 100000, currency: "USD", periodStart: "2026-01-01", periodEnd: "2026-12-31" };
const input = {
  plans: [plan], projectStart: "2026-02-01", projectEnd: "2026-11-30",
  firstActualDate: "2026-02-01", lastActualDate: "2026-10-01",
  completed: false, actual: 60000, approvedMeters: 400, plannedMeters: 1000
};
const assess = (changes: Partial<Parameters<typeof assessProjectBudgetHealth>[0]> = {}) =>
  assessProjectBudgetHealth({ ...input, ...changes });

const risk = assess();
assert.equal(risk.verdict, "AT_RISK");
assert.equal(risk.budgetUsed, 0.6);
assert.equal(risk.progress, 0.4);
assert.equal(risk.remainingBudget, 40000);
assert.equal(risk.paceEstimate, 150000);
assert.equal(assess({ actual: 55000 }).verdict, "AT_RISK");
assert.equal(assess({ actual: 45000 }).verdict, "WATCH");
assert.equal(assess({ actual: 44000 }).verdict, "ON_TRACK");
assert.equal(assess({ actual: 90000, approvedMeters: 950 }).verdict, "WATCH");
assert.equal(assess({ actual: 100000, approvedMeters: 950 }).verdict, "AT_RISK");
assert.equal(assess({ actual: 100001, completed: true, plannedMeters: null }).verdict, "AT_RISK");
assert.equal(assess({ actual: 0 }).verdict, "INSUFFICIENT");
assert.equal(assess({ approvedMeters: 0 }).paceEstimate, null);
assert.equal(assess({ approvedMeters: 199 }).verdict, "INSUFFICIENT");
assert.equal(assess({ actual: 90000, approvedMeters: 199 }).verdict, "AT_RISK");
assert.equal(assess({ approvedMeters: 1000 }).verdict, "WATCH");
assert.equal(assess({ completed: true }).paceEstimate, null);
assert.equal(assess({ plannedMeters: 0 }).verdict, "INSUFFICIENT");
assert.equal(assess({ plans: [] }).verdict, "INSUFFICIENT");
assert.equal(assess({ plans: [plan, plan] }).remainingBudget, null);
assert.equal(assess({ plans: [{ ...plan, currency: "TZS" }] }).budgetUsed, null);
assert.equal(assess({ projectEnd: null }).budgetUsed, null);
assert.equal(assess({ lastActualDate: "2027-01-01" }).budgetUsed, null);
const periodOverrun = assess({ projectEnd: null, plannedMeters: null, actual: 145000, budgetPeriodPosted: 112000 });
assert.equal(periodOverrun.verdict, "AT_RISK");
assert.deepEqual(periodOverrun.periodOverrun, { posted: 112000, excess: 12000 });
assert.equal(periodOverrun.remainingBudget, null);
assert.equal(periodOverrun.paceEstimate, null);
assert.equal(assess({ projectEnd: null, actual: 145000, budgetPeriodPosted: 90000 }).verdict, "INSUFFICIENT");
assert.equal(assess({ projectEnd: null, plans: [{ ...plan, currency: "TZS" }], budgetPeriodPosted: 112000 }).verdict, "INSUFFICIENT");
assert.equal(assess({ plans: [{ ...plan, periodStart: "2026-03-01" }] }).budgetUsed, null);
console.log("Project Budget Health verdicts, forecast guards, and scope checks passed.");
