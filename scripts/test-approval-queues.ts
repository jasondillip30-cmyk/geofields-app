import assert from "node:assert/strict";

import {
  APPROVAL_SECTION_IDS,
  APPROVAL_TABS,
  parseApprovalTab,
  resolveApprovalTabForFocus,
  sortApprovalsOldestFirst
} from "../src/app/approvals/approvals-page-utils";

assert.equal(APPROVAL_TABS.length, 4);
for (const { key } of APPROVAL_TABS) {
  assert.equal(parseApprovalTab(key), key);
  assert.equal(resolveApprovalTabForFocus(APPROVAL_SECTION_IDS[key]), key);
}
assert.equal(parseApprovalTab("drilling-reports"), "drilling");
assert.equal(parseApprovalTab("receipt-submissions"), "receipts");
assert.equal(parseApprovalTab("unknown"), null);
assert.equal(resolveApprovalTabForFocus(null, "receipt-example"), "receipts");

const rows = [
  { id: "new", submittedAt: "2025-02-01" },
  { id: "missing", submittedAt: null },
  { id: "old", submittedAt: "2025-01-01" },
  { id: "invalid", submittedAt: "unknown" }
];
assert.deepEqual(sortApprovalsOldestFirst(rows, (row) => row.submittedAt).map(({ id }) => id), [
  "old", "new", "missing", "invalid"
]);
assert.equal(rows[0].id, "new");
console.log("Approval queue links, focus targets, and oldest-first ordering passed.");
