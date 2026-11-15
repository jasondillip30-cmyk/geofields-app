import assert from "node:assert/strict";
import { buildFilterScopeSummary } from "../src/components/layout/filter-scope-banner";
import { DEFAULT_ANALYTICS_SCOPE_FILTERS } from "../src/lib/analytics-scope";

const filters = {
  ...DEFAULT_ANALYTICS_SCOPE_FILTERS,
  workspaceMode: "project" as const,
  projectId: "qa-project",
  from: "2026-10-01",
  to: "2026-11-14"
};

for (const timeZone of ["America/Chicago", "Pacific/Honolulu", "UTC", "Africa/Dar_es_Salaam"]) {
  process.env.TZ = timeZone;
  assert.equal(
    buildFilterScopeSummary({ filters, projectLabel: "QA Project" }),
    "Project locked: QA Project • Date 10/1/2026 to 11/14/2026",
    timeZone
  );
  assert.match(buildFilterScopeSummary({ filters: { ...filters, from: "" } }), /Date Any to 11\/14\/2026$/);
}

console.log("Filter banner preserves calendar dates across time zones.");
