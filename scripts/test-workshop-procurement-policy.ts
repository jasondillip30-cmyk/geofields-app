import assert from "node:assert/strict";

import {
  getCreatableRequisitionTypesForRole,
  isRequisitionTypeCreatableForRole
} from "../src/lib/auth/requisition-access";
import { canAccess } from "../src/lib/auth/permissions";
import {
  buildBreakdownMaintenanceHref,
  canOpenMaintenanceForRig
} from "../src/lib/maintenance-workflow";
import { resolveWorkspaceRouteRule } from "../src/lib/workspace-mode";

const workshopRoles = ["ADMIN", "MANAGER", "OFFICE", "MECHANIC"] as const;
for (const role of workshopRoles) {
  assert.deepEqual(
    getCreatableRequisitionTypesForRole(role),
    ["INVENTORY_STOCK_UP"],
    `${role} should create workshop stock-up requisitions only.`
  );
  assert.equal(isRequisitionTypeCreatableForRole(role, "LIVE_PROJECT_PURCHASE"), false);
  assert.equal(isRequisitionTypeCreatableForRole(role, "MAINTENANCE_PURCHASE"), false);
}

assert.deepEqual(getCreatableRequisitionTypesForRole("FIELD"), []);
assert.deepEqual(getCreatableRequisitionTypesForRole("STAFF"), []);
assert.equal(canAccess("FIELD", "requisitions:view"), false);
assert.equal(canAccess("MECHANIC", "requisitions:view"), true);

const purchaseRouteRule = resolveWorkspaceRouteRule("/expenses");
assert.deepEqual(purchaseRouteRule?.allowedModes, ["workshop"]);
assert.equal(purchaseRouteRule?.recommendedMode, "workshop");

const maintenanceRouteRule = resolveWorkspaceRouteRule("/maintenance");
assert.deepEqual(maintenanceRouteRule?.allowedModes, ["workshop"]);
assert.equal(maintenanceRouteRule?.recommendedMode, "workshop");

assert.equal(
  canOpenMaintenanceForRig({ rigStatus: "IDLE", breakdownReportId: null }),
  true
);
assert.equal(
  canOpenMaintenanceForRig({ rigStatus: "BREAKDOWN", breakdownReportId: "breakdown-1" }),
  true
);
assert.equal(
  canOpenMaintenanceForRig({ rigStatus: "BREAKDOWN", breakdownReportId: null }),
  false
);
assert.equal(
  canOpenMaintenanceForRig({ rigStatus: "ACTIVE", breakdownReportId: "breakdown-1" }),
  false
);

assert.equal(
  buildBreakdownMaintenanceHref({
    breakdownReportId: "breakdown-1",
    maintenanceRequestId: "maintenance-1"
  }),
  "/maintenance?workspace=workshop&maintenanceRequestId=maintenance-1"
);
assert.equal(
  buildBreakdownMaintenanceHref({ breakdownReportId: "breakdown-1" }),
  "/maintenance?workspace=workshop&breakdownId=breakdown-1"
);

console.log("Workshop procurement policy regression checks passed.");
