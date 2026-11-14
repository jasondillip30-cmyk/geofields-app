import assert from "node:assert/strict";
import { drillingWorkDate, groupShiftReports, parseDrillingShift, recentShiftWeekStart, shiftCellKey, shiftWeek, type ShiftReport } from "../src/lib/drilling-shifts";

assert.deepEqual(parseDrillingShift(undefined), { value: undefined });
assert.deepEqual(parseDrillingShift("DAY"), { value: "DAY" });
assert.deepEqual(parseDrillingShift("NIGHT"), { value: "NIGHT" });
assert.ok(parseDrillingShift("day").error);
assert.ok(parseDrillingShift(null).error);
assert.equal(shiftWeek("2026-02-30"), null);
const midnight = new Date("2026-11-12T22:00:00Z");
assert.equal(drillingWorkDate(midnight), "2026-11-13");
assert.equal(shiftWeek(recentShiftWeekStart(midnight))?.days.at(-1), "2026-11-13");
assert.equal(shiftWeek("2026-12-29")?.days.at(-1), "2027-01-04");

const base: ShiftReport = {
  id: "1", date: "2026-11-12T00:00:00Z", shift: "NIGHT", rigId: "rig-1",
  rig: { rigCode: "QA-RIG" }, holeNumber: "QA-1", totalMetersDrilled: 8,
  workHours: 4, standbyHours: 1, delayHours: 0,
  delayReasonCategory: null, delayReasonNote: null, approvalStatus: "APPROVED"
};
const { cells, unclassified } = groupShiftReports([
  base, { ...base, id: "2", holeNumber: "QA-2", approvalStatus: "SUBMITTED" },
  { ...base, id: "3", shift: "DAY" }, { ...base, id: "4", shift: null },
  { ...base, id: "5", rigId: "rig-2" }
]);
assert.equal(cells.size, 3);
assert.deepEqual(cells.get(shiftCellKey("rig-1", "2026-11-12", "NIGHT"))?.map(({ id }) => id), ["1", "2"]);
assert.deepEqual(unclassified.map(({ id }) => id), ["4"]);
console.log("Drilling shift validation, site date, and grid grouping passed.");
