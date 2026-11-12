import assert from "node:assert/strict";

import { resolveIntakeAllocationStatus } from "../src/app/api/inventory/receipt-intake/commit/commit-utils";
import { buildManualAssistReview } from "../src/components/inventory/receipt-intake-review-state-builders";
import { resolveRequisitionStockLocation } from "../src/components/inventory/receipt-intake-review-state-domain";

const locations = [{ id: "store", name: "Main Store" }];
const requisition = {
  id: "req-1",
  requisitionCode: "REQ-1",
  type: "INVENTORY_STOCK_UP" as const,
  stockLocationId: "store",
  requestedVendorId: "supplier",
  requestedVendorName: "Workshop Supplies",
  lineItems: [{
    id: "line-1",
    description: "Hydraulic Hose",
    quantity: 2,
    estimatedUnitCost: 50,
    estimatedTotalCost: 100,
    notes: null
  }]
};
const reviewOptions = {
  receiptFileName: "",
  defaultClientId: "",
  defaultRigId: "",
  warning: "",
  fallbackMode: "MANUAL_ENTRY" as const,
  receiptClassification: "INVENTORY_PURCHASE" as const,
  receiptWorkflowChoice: "STOCK_PURCHASE" as const,
  initialRequisition: requisition,
  items: [
    { id: "wrong-store", name: "Hydraulic Hose", sku: "HOSE-2", category: "HYDRAULIC", minimumStockLevel: 0, locationId: "other" },
    { id: "hose", name: "Hydraulic Hose", sku: "HOSE", category: "HYDRAULIC", minimumStockLevel: 0, locationId: "store" }
  ]
};
const review = buildManualAssistReview({ ...reviewOptions, payload: {} });
assert.equal(review.locationToId, "store");
assert.equal(review.supplierId, "supplier");
assert.equal(review.supplierName, "Workshop Supplies");
assert.equal(review.lines[0].selectedItemId, "hose");
assert.equal(review.lines[0].mode, "MATCH");
assert.equal(review.lines[0].quantity, "2");
assert.equal(review.lines[0].unitPrice, "50");
assert.equal(review.lines[0].lineTotal, "100");
assert.equal(review.scannedSnapshot?.lines.length, 0);
assert.equal(review.total, "");

const partialScan = buildManualAssistReview({
  ...reviewOptions,
  fallbackMode: "SCAN_FAILURE",
  payload: { extracted: { header: { supplierName: "Actual Receipt Supplier", total: 40 } } }
});
assert.equal(partialScan.supplierName, "ACTUAL RECEIPT SUPPLIER");
assert.equal(partialScan.supplierId, "");
assert.equal(partialScan.total, "40");

assert.equal(resolveRequisitionStockLocation(requisition, locations), "store");
const legacy = { type: requisition.type, notes: "Stock location: Main Store | Reason: Low stock" };
assert.equal(resolveRequisitionStockLocation(legacy, locations), "store");
assert.equal(resolveRequisitionStockLocation(legacy, [...locations, { id: "other", name: "Main Store" }]), null);
assert.equal(resolveIntakeAllocationStatus({ clientId: null, projectId: null, workflowType: "STOCK_PURCHASE" }), "ALLOCATED");
assert.equal(resolveIntakeAllocationStatus({ clientId: "client", projectId: null, workflowType: "PROJECT_PURCHASE" }), "PARTIALLY_ALLOCATED");

console.log("Workshop receipt prefill regression passed.");
