import assert from "node:assert/strict";

import {
  getCreatableRequisitionTypesForRole,
  isRequisitionTypeCreatableForRole
} from "../src/lib/auth/requisition-access";
import { canAccess } from "../src/lib/auth/permissions";
import {
  canManageInventoryApprovalActions,
  canManageRequisitionApprovalActions,
  canReviewRequisition
} from "../src/lib/auth/approval-policy";
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
assert.equal(canAccess("OFFICE", "inventory:approve"), true);
assert.equal(canAccess("OFFICE", "inventory:manage"), false);
assert.equal(canManageInventoryApprovalActions("OFFICE"), true);
assert.equal(canManageRequisitionApprovalActions("OFFICE"), false);
assert.equal(canManageInventoryApprovalActions("MANAGER"), false);
assert.equal(canManageInventoryApprovalActions("ADMIN"), false);
assert.equal(canManageInventoryApprovalActions("MECHANIC"), false);
const stockUpRequest = {
  type: "INVENTORY_STOCK_UP",
  submittedBy: { userId: "requester" }
};
assert.equal(canReviewRequisition("MANAGER", "reviewer", stockUpRequest), true);
assert.equal(canReviewRequisition("MANAGER", "requester", stockUpRequest), false);
assert.equal(canReviewRequisition("MANAGER", null, stockUpRequest), false);
assert.equal(canReviewRequisition("OFFICE", "reviewer", stockUpRequest), false);
assert.equal(canReviewRequisition("ADMIN", "reviewer", stockUpRequest), false);
assert.equal(canReviewRequisition("ADMIN", "reviewer", { ...stockUpRequest, type: "LIVE_PROJECT_PURCHASE" }), true);

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
