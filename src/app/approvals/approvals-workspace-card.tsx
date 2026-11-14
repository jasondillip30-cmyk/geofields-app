import Link from "next/link";

import { WorkflowAssistPanel, type WorkflowAssistModel } from "@/components/layout/workflow-assist-panel";
import { Card } from "@/components/ui/card";
import { DataTable } from "@/components/ui/table";
import { formatCurrency, formatNumber } from "@/lib/utils";

import type {
  ApprovalTab,
  DrillingApprovalRow,
  InventoryUsageBatchApprovalRow,
  InventoryUsageApprovalRow,
  ReceiptSubmissionApprovalRow,
  RequisitionApprovalRow
} from "./approvals-page-types";
import {
  APPROVAL_SECTION_IDS,
  APPROVAL_TABS,
  StatusBadge,
  formatLiveProjectSpendType,
  formatReceiptSubmissionDate,
  formatRequisitionContext,
  formatRequisitionType,
  getInventoryBatchPendingDate,
  getDrillingPendingDate,
  getInventoryPendingDate,
  getPendingAgeMeta,
  getReceiptSubmissionPendingDate,
  makeApprovalFocusRowId
} from "./approvals-page-utils";

interface PendingSummary {
  counts: {
    drilling: number;
    requisitions: number;
    receiptSubmissions: number;
    inventoryUsage: number;
  };
  total: number;
  buckets: {
    under24: number;
    over24: number;
    over3d: number;
  };
}

export interface ApprovalsWorkspaceCardProps {
  activeTab: ApprovalTab;
  approvalWorkflowAssist: WorkflowAssistModel | null;
  actingRowId: string | null;
  canManageDrillingApprovals: boolean;
  canManageInventoryApprovals: boolean;
  canReviewRequisitionRow: (row: RequisitionApprovalRow) => boolean;
  focusedRowId: string | null;
  focusedSectionId: string | null;
  highValueReceiptThreshold: number;
  inventoryNotes: Record<string, string>;
  inventoryRowWarnings: Record<string, string>;
  loading: boolean;
  pendingSummary: PendingSummary;
  requisitionNotes: Record<string, string>;
  drillingNotes: Record<string, string>;
  sortedDrillingRows: DrillingApprovalRow[];
  sortedInventoryBatchRows: InventoryUsageBatchApprovalRow[];
  sortedInventoryRows: InventoryUsageApprovalRow[];
  sortedReceiptSubmissionRows: ReceiptSubmissionApprovalRow[];
  sortedRequisitionRows: RequisitionApprovalRow[];
  onDrillingNoteChange: (rowId: string, value: string) => void;
  onDrillingStatus: (rowId: string, action: "approve" | "reject") => void;
  onOpenInventoryBatchReview: (batchId: string) => void;
  onInventoryNoteChange: (rowId: string, value: string) => void;
  onInventoryStatus: (rowId: string, action: "approve" | "issue" | "reject") => void;
  onRequisitionNoteChange: (rowId: string, value: string) => void;
  onRequisitionStatus: (rowId: string, action: "approve" | "reject") => void;
  onTabChange: (tab: ApprovalTab) => void;
}

export function ApprovalsWorkspaceCard({
  activeTab,
  approvalWorkflowAssist,
  actingRowId,
  canManageDrillingApprovals,
  canManageInventoryApprovals,
  canReviewRequisitionRow,
  focusedRowId,
  focusedSectionId,
  highValueReceiptThreshold,
  inventoryNotes,
  inventoryRowWarnings,
  loading,
  pendingSummary,
  requisitionNotes,
  drillingNotes,
  sortedDrillingRows,
  sortedInventoryBatchRows,
  sortedInventoryRows,
  sortedReceiptSubmissionRows,
  sortedRequisitionRows,
  onDrillingNoteChange,
  onDrillingStatus,
  onOpenInventoryBatchReview,
  onInventoryNoteChange,
  onInventoryStatus,
  onRequisitionNoteChange,
  onRequisitionStatus,
  onTabChange
}: ApprovalsWorkspaceCardProps) {
  const counts: Record<ApprovalTab, number> = {
    requisitions: pendingSummary.counts.requisitions,
    drilling: pendingSummary.counts.drilling,
    inventory: pendingSummary.counts.inventoryUsage,
    receipts: pendingSummary.counts.receiptSubmissions
  };
  const activeLabel = APPROVAL_TABS.find(({ key }) => key === activeTab)?.label;

  return (
    <Card
      title="Approval queues"
      subtitle="Choose what to review."
    >
      <div className="space-y-4">
        <div role="group" aria-label="Choose an approval queue" className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          {APPROVAL_TABS.map((tab) => (
            <button key={tab.key} type="button" onClick={() => onTabChange(tab.key)}
              aria-pressed={activeTab === tab.key}
              aria-controls="current-approval-queue"
              aria-label={`${tab.label}, ${loading ? "loading" : `${counts[tab.key]} waiting`}`}
              className={`flex min-h-12 min-w-0 items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left text-sm font-semibold focus-visible:ring-2 focus-visible:ring-brand-500 ${
                activeTab === tab.key
                  ? "border-brand-500 bg-brand-50 text-brand-800"
                  : "border-slate-200 bg-white text-ink-700 hover:bg-slate-50"
              }`}>
              {tab.label}
              <span aria-hidden="true" className="rounded-full bg-slate-100 px-2 py-0.5 text-xs tabular-nums text-ink-800">
                {loading ? "-" : formatNumber(counts[tab.key])}
              </span>
            </button>
          ))}
        </div>

        <section id="current-approval-queue" aria-labelledby="active-approval-queue-title" className="space-y-3" aria-busy={loading}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 id="active-approval-queue-title" className="font-semibold text-ink-900">{activeLabel}</h3>
            <p className="text-xs text-ink-600">
              {activeTab === "inventory" ? "Oldest first within each request type" : "Oldest first"}
            </p>
          </div>
          <WorkflowAssistPanel model={approvalWorkflowAssist} />
        {activeTab === "receipts" ? (
        <div
          id={APPROVAL_SECTION_IDS.receipts}
          className={`overflow-hidden rounded-xl border border-slate-200 ${
            focusedSectionId === APPROVAL_SECTION_IDS.receipts
              ? "ring-2 ring-indigo-100 ring-offset-2 ring-offset-slate-50"
              : ""
          }`}
        >
          <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-3 py-2">
            <div>
              <p className="text-xs text-slate-600">
                Review receipt details before posting.
              </p>
            </div>
            <Link
              href="/purchasing/receipt-follow-up"
              className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100"
            >
              Open Purchase Follow-up
            </Link>
          </div>
          {loading ? (
            <p className="px-3 py-3 text-sm text-ink-600">Loading receipt submissions...</p>
          ) : sortedReceiptSubmissionRows.length === 0 ? (
            <p className="px-3 py-3 text-sm text-ink-600">No pending receipt submissions for current filters.</p>
          ) : (
            <div className="max-h-[280px] overflow-auto">
              <DataTable
                compact
                columns={["Submitted", "Supplier / Receipt", "Type", "Operational Context", "Total Amount", "Pending Age", "Review"]}
                rows={sortedReceiptSubmissionRows.map((row) => {
                  const pendingMeta = getPendingAgeMeta(getReceiptSubmissionPendingDate(row));
                  const isHighValue = highValueReceiptThreshold > 0 && row.summary.total >= highValueReceiptThreshold;
                  return [
                    formatReceiptSubmissionDate(row.submittedAt, row.reportDate),
                    <div key={`supplier-${row.id}`}>
                      <p className="font-medium text-ink-900">{row.summary.supplierName || "-"}</p>
                      <p className="text-xs text-slate-600">
                        Receipt: {row.summary.receiptNumber || "-"}
                        {row.summary.traReceiptNumber ? ` • TRA: ${row.summary.traReceiptNumber}` : ""}
                      </p>
                    </div>,
                    <div key={`type-${row.id}`} className="flex flex-wrap items-center gap-1">
                      <StatusBadge
                        label={row.classification.tag}
                        tone={
                          row.classification.tag === "MAINTENANCE"
                            ? "amber"
                            : row.classification.tag === "EXPENSE"
                              ? "gray"
                              : "blue"
                        }
                      />
                      <StatusBadge
                        label={
                          row.classification.priority === "HIGH"
                            ? "High priority"
                            : row.classification.priority === "LOW"
                              ? "Low priority"
                              : "Medium priority"
                        }
                        tone={
                          row.classification.priority === "HIGH"
                            ? "amber"
                            : row.classification.priority === "LOW"
                              ? "gray"
                              : "amber"
                        }
                      />
                    </div>,
                    <div key={`context-${row.id}`} className="text-xs text-ink-800">
                      <span className="font-medium">{row.classification.contextLabel}</span>
                      {row.classification.tag === "STOCK" ? (
                        <span className="text-slate-600">
                          {" "}• {row.classification.stockUse === "URGENT_USE" ? "Urgent use" : "Warehouse stock"}
                        </span>
                      ) : null}
                    </div>,
                    <div key={`total-${row.id}`} className="flex items-center justify-end gap-1">
                      <span className="font-semibold text-ink-900">{formatCurrency(row.summary.total || 0)}</span>
                      {isHighValue ? <StatusBadge label="High value" tone="amber" /> : null}
                    </div>,
                    pendingMeta ? <StatusBadge key={`age-${row.id}`} label={pendingMeta.label} tone={pendingMeta.badgeTone} /> : "-",
                    <Link
                      key={`review-${row.id}`}
                      href={`/purchasing/receipt-follow-up?submissionId=${encodeURIComponent(row.id)}`}
                      className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                    >
                      Review
                    </Link>
                  ];
                })}
                rowIds={sortedReceiptSubmissionRows.map((row) => `ai-focus-${makeApprovalFocusRowId("receipt", row.id)}`)}
                rowClassNames={sortedReceiptSubmissionRows.map((row) => {
                  const pendingMeta = getPendingAgeMeta(getReceiptSubmissionPendingDate(row));
                  const rowToneClass =
                    row.classification.tag === "MAINTENANCE"
                      ? "bg-amber-50/50"
                      : row.classification.tag === "EXPENSE"
                        ? "bg-slate-50/65"
                        : "";
                  if (focusedRowId === makeApprovalFocusRowId("receipt", row.id)) {
                    return "bg-indigo-50 ring-1 ring-inset ring-indigo-200";
                  }
                  return pendingMeta?.rowClass || rowToneClass;
                })}
              />
            </div>
          )}
        </div>

        ) : activeTab === "requisitions" ? (
          loading ? (
            <p className="text-sm text-ink-600">Loading submitted requisitions...</p>
          ) : sortedRequisitionRows.length === 0 ? (
            <p className="text-sm text-ink-600">No submitted requisitions pending approval.</p>
          ) : (
            <div
              id={APPROVAL_SECTION_IDS.requisitions}
              className={`overflow-hidden rounded-xl border border-slate-200 ${
                focusedSectionId === APPROVAL_SECTION_IDS.requisitions
                  ? "ring-2 ring-indigo-100 ring-offset-2 ring-offset-slate-50"
                  : ""
              }`}
            >
              <p className="border-b border-slate-200 px-3 py-2 text-xs text-ink-600">
                Workshop replenishment requires review by a Manager other than the requester.
              </p>
              <div className="max-h-[620px] overflow-auto">
                <DataTable
                  compact
                  columns={[
                    "Submitted",
                    "Requisition",
                    "Type",
                    "Path",
                    "Context",
                    "Estimated Total",
                    "Pending Age",
                    "Submitted By",
                    "Comment",
                    "Actions"
                  ]}
                  rows={sortedRequisitionRows.map((row) => {
                    const pendingMeta = getPendingAgeMeta(row.submittedAt);
                    const canReview = canReviewRequisitionRow(row);
                    return [
                      formatReceiptSubmissionDate(row.submittedAt, row.submittedAt),
                      row.requisitionCode,
                      formatRequisitionType(row.type),
                      formatLiveProjectSpendType(row.liveProjectSpendType),
                      formatRequisitionContext(row.type, row.context, row.contextLabels),
                      <span key={`${row.id}-estimated`} className="inline-block w-full text-right">
                        {formatCurrency(row.totals.estimatedTotalCost || 0)}
                      </span>,
                      pendingMeta ? <StatusBadge key={`${row.id}-pending`} label={pendingMeta.label} tone={pendingMeta.badgeTone} /> : "-",
                      row.submittedBy.name || "-",
                      canReview ? <input
                        key={`${row.id}-comment`}
                        type="text"
                        value={requisitionNotes[row.id] || ""}
                        onChange={(event) => onRequisitionNoteChange(row.id, event.target.value)}
                        placeholder="Reason required to reject"
                        className="w-52 rounded-md border border-slate-200 px-2 py-1 text-xs"
                      /> : "-",
                      canReview ? <div key={`${row.id}-actions`} className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          disabled={actingRowId === row.id}
                          onClick={() => onRequisitionStatus(row.id, "approve")}
                          className="rounded-md border border-emerald-200 px-2 py-1 text-xs text-emerald-700 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          Approve
                        </button>
                        <button
                          type="button"
                          disabled={actingRowId === row.id}
                          onClick={() => onRequisitionStatus(row.id, "reject")}
                          className="rounded-md border border-red-200 px-2 py-1 text-xs text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          Reject
                        </button>
                      </div> : "View only"
                    ];
                  })}
                  rowIds={sortedRequisitionRows.map((row) => `ai-focus-${makeApprovalFocusRowId("requisition", row.id)}`)}
                  rowClassNames={sortedRequisitionRows.map((row) => {
                    const pendingMeta = getPendingAgeMeta(row.submittedAt);
                    if (focusedRowId === makeApprovalFocusRowId("requisition", row.id)) {
                      return "bg-indigo-50 ring-1 ring-inset ring-indigo-200";
                    }
                    return pendingMeta?.rowClass || "";
                  })}
                />
              </div>
            </div>
          )
        ) : activeTab === "drilling" ? (
          loading ? (
            <p className="text-sm text-ink-600">Loading submitted drilling reports...</p>
          ) : sortedDrillingRows.length === 0 ? (
            <p className="text-sm text-ink-600">
              No drilling reports are waiting for review in this view.
            </p>
          ) : (
            <div
              id={APPROVAL_SECTION_IDS.drilling}
              className={`overflow-hidden rounded-xl border border-slate-200 ${
                focusedSectionId === APPROVAL_SECTION_IDS.drilling
                  ? "ring-2 ring-indigo-100 ring-offset-2 ring-offset-slate-50"
                  : ""
              }`}
            >
              <p className="border-b border-slate-200 px-3 py-2 text-xs text-ink-600">
                Approving a report recognizes its revenue and posts any listed consumables to stock and project costs.
              </p>
              {!canManageDrillingApprovals ? (
                <div className="border-b border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  View only: drilling approval actions are available to ADMIN and MANAGER roles.
                </div>
              ) : null}
              <div className="max-h-[620px] overflow-auto">
                <DataTable
                  compact
                  columns={[
                    "Date",
                    "Project",
                    "Client",
                    "Rig",
                    "Hole Number",
                    "Meters Drilled",
                    "Work Hours",
                    "Submitted By",
                    "Pending Age",
                    "Status",
                    "Consumables",
                    "Comment",
                    "Actions"
                  ]}
                  rows={sortedDrillingRows.map((row) => {
                    const pendingMeta = getPendingAgeMeta(getDrillingPendingDate(row));
                    return [
                      new Date(row.date).toISOString().slice(0, 10),
                      row.project.name,
                      row.client.name,
                      row.rig.rigCode,
                      row.holeNumber,
                      <span key={`${row.id}-meters`} className="inline-block w-full text-right">
                        {formatNumber(row.totalMetersDrilled)}
                      </span>,
                      <span key={`${row.id}-work`} className="inline-block w-full text-right">
                        {row.workHours.toFixed(1)}
                      </span>,
                      row.submittedBy?.fullName || "-",
                      pendingMeta ? <StatusBadge key={`${row.id}-pending`} label={pendingMeta.label} tone={pendingMeta.badgeTone} /> : "-",
                      <StatusBadge key={`${row.id}-status`} label="Submitted" tone="blue" />,
                      row.pendingConsumables?.map((line) => `${formatNumber(line.quantity)} × ${line.itemName}`).join(", ") || "-",
                      <input
                        key={`${row.id}-comment`}
                        type="text"
                        value={drillingNotes[row.id] || ""}
                        onChange={(event) => onDrillingNoteChange(row.id, event.target.value)}
                        placeholder="Optional rejection reason"
                        className="w-52 rounded-md border border-slate-200 px-2 py-1 text-xs"
                      />,
                      <div key={`${row.id}-actions`} className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          disabled={!canManageDrillingApprovals || actingRowId === row.id}
                          onClick={() => onDrillingStatus(row.id, "approve")}
                          className="rounded-md border border-emerald-200 px-2 py-1 text-xs text-emerald-700 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          Approve
                        </button>
                        <button
                          type="button"
                          disabled={!canManageDrillingApprovals || actingRowId === row.id}
                          onClick={() => onDrillingStatus(row.id, "reject")}
                          className="rounded-md border border-red-200 px-2 py-1 text-xs text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          Reject
                        </button>
                      </div>
                    ];
                  })}
                  rowIds={sortedDrillingRows.map((row) => `ai-focus-${makeApprovalFocusRowId("drilling", row.id)}`)}
                  rowClassNames={sortedDrillingRows.map((row) => {
                    const pendingMeta = getPendingAgeMeta(getDrillingPendingDate(row));
                    if (focusedRowId === makeApprovalFocusRowId("drilling", row.id)) {
                      return "bg-indigo-50 ring-1 ring-inset ring-indigo-200";
                    }
                    return pendingMeta?.rowClass || "";
                  })}
                />
              </div>
            </div>
          )
        ) : loading ? (
          <p className="text-sm text-ink-600">Loading inventory usage requests...</p>
        ) : sortedInventoryRows.length === 0 && sortedInventoryBatchRows.length === 0 ? (
          <p className="text-sm text-ink-600">No pending inventory usage requests for current filters.</p>
        ) : (
          <div
            id={APPROVAL_SECTION_IDS.inventory}
            className={`overflow-hidden rounded-xl border border-slate-200 ${
              focusedSectionId === APPROVAL_SECTION_IDS.inventory
                ? "ring-2 ring-indigo-100 ring-offset-2 ring-offset-slate-50"
                : ""
            }`}
          >
            {!canManageInventoryApprovals ? (
              <div className="border-b border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                View only: Office reviews inventory usage requests and issues stock.
              </div>
            ) : null}
            <div className="max-h-[620px] overflow-auto space-y-3 p-3">
              <div className="rounded-lg border border-slate-200 bg-white">
                <div className="border-b border-slate-200 bg-slate-50 px-3 py-2">
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                    Single-item usage requests
                  </h4>
                </div>
                {sortedInventoryRows.length === 0 ? (
                  <p className="px-3 py-3 text-sm text-ink-600">
                    No pending single-item usage requests for current filters.
                  </p>
                ) : (
                  <DataTable
                    compact
                    columns={[
                      "Date",
                      "Requested For",
                      "Item",
                      "Qty",
                      "Pending Age",
                      "Requester",
                      "Project",
                      "Rig/Location",
                      "Maintenance",
                      "Reason",
                      "Status",
                      "Comment",
                      "Actions"
                    ]}
                    rows={sortedInventoryRows.map((row) => {
                      const pendingMeta = getPendingAgeMeta(getInventoryPendingDate(row));
                      return [
                        new Date(row.createdAt).toISOString().slice(0, 10),
                        row.requestedForDate ? new Date(row.requestedForDate).toISOString().slice(0, 10) : "-",
                        row.item.name,
                        <span key={`${row.id}-qty`} className="inline-block w-full text-right">
                          {formatNumber(row.quantity)}
                        </span>,
                        pendingMeta ? <StatusBadge key={`${row.id}-pending`} label={pendingMeta.label} tone={pendingMeta.badgeTone} /> : "-",
                        row.requestedBy?.fullName || "-",
                        row.project?.name || "-",
                        row.rig?.rigCode || row.location?.name || "-",
                        row.maintenanceRequest?.requestCode || "-",
                        <span key={`${row.id}-reason`} className="inline-block max-w-[300px]">
                          {row.reason}
                        </span>,
                        <div key={`${row.id}-status`} className="flex flex-wrap items-center gap-1">
                          <StatusBadge
                            label={
                              row.status === "READY_TO_ISSUE"
                                ? "Ready to issue"
                                : row.status === "PENDING"
                                  ? "Pending"
                                  : "Submitted"
                            }
                            tone={row.status === "READY_TO_ISSUE" ? "green" : row.status === "PENDING" ? "amber" : "blue"}
                          />
                          {inventoryRowWarnings[row.id] ? <StatusBadge label={inventoryRowWarnings[row.id]} tone="red" /> : null}
                        </div>,
                        <input
                          key={`${row.id}-comment`}
                          type="text"
                          value={inventoryNotes[row.id] || ""}
                          onChange={(event) => onInventoryNoteChange(row.id, event.target.value)}
                          placeholder="Optional note"
                          className="w-52 rounded-md border border-slate-200 px-2 py-1 text-xs"
                        />,
                        <div key={`${row.id}-actions`} className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            disabled={!canManageInventoryApprovals || actingRowId === row.id}
                            onClick={() => onInventoryStatus(row.id, row.status === "READY_TO_ISSUE" ? "issue" : "approve")}
                            className="rounded-md border border-emerald-200 px-2 py-1 text-xs text-emerald-700 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {row.status === "READY_TO_ISSUE" ? "Issue item" : "Approve"}
                          </button>
                          <button
                            type="button"
                            disabled={!canManageInventoryApprovals || actingRowId === row.id}
                            onClick={() => onInventoryStatus(row.id, "reject")}
                            className="rounded-md border border-red-200 px-2 py-1 text-xs text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            Reject
                          </button>
                        </div>
                      ];
                    })}
                    rowIds={sortedInventoryRows.map((row) => `ai-focus-${makeApprovalFocusRowId("inventory", row.id)}`)}
                    rowClassNames={sortedInventoryRows.map((row) => {
                      const pendingMeta = getPendingAgeMeta(getInventoryPendingDate(row));
                      if (focusedRowId === makeApprovalFocusRowId("inventory", row.id)) {
                        return "bg-indigo-50 ring-1 ring-inset ring-indigo-200";
                      }
                      if (inventoryRowWarnings[row.id]) {
                        return "bg-amber-50/55";
                      }
                      return pendingMeta?.rowClass || "";
                    })}
                  />
                )}
              </div>

              <div className="rounded-lg border border-slate-200 bg-white">
                <div className="border-b border-slate-200 bg-slate-50 px-3 py-2">
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                    Batch usage requests
                  </h4>
                </div>
                {sortedInventoryBatchRows.length === 0 ? (
                  <p className="px-3 py-3 text-sm text-ink-600">
                    No pending batch usage requests for current filters.
                  </p>
                ) : (
                  <DataTable
                    compact
                    columns={[
                      "Submitted",
                      "Batch",
                      "Lines",
                      "Pending Age",
                      "Requester",
                      "Project",
                      "Rig/Location",
                      "Status",
                      "Review"
                    ]}
                    rows={sortedInventoryBatchRows.map((row) => {
                      const pendingMeta = getPendingAgeMeta(getInventoryBatchPendingDate(row));
                      return [
                        new Date(row.createdAt).toISOString().slice(0, 10),
                        row.batchCode,
                        `${formatNumber(row.summary.lineCount)} lines • Qty ${formatNumber(row.summary.totalQuantity)}`,
                        pendingMeta ? (
                          <StatusBadge
                            key={`${row.id}-pending`}
                            label={pendingMeta.label}
                            tone={pendingMeta.badgeTone}
                          />
                        ) : (
                          "-"
                        ),
                        row.requestedBy?.fullName || "-",
                        row.project?.name || "-",
                        row.rig?.rigCode || row.location?.name || "-",
                        <StatusBadge
                          key={`${row.id}-status`}
                          label={row.status === "PENDING" ? "Pending" : "Submitted"}
                          tone={row.status === "PENDING" ? "amber" : "blue"}
                        />,
                        <button
                          key={`${row.id}-review`}
                          type="button"
                          disabled={!canManageInventoryApprovals || actingRowId === row.id}
                          onClick={() => onOpenInventoryBatchReview(row.id)}
                          className="rounded-md border border-brand-300 bg-brand-50 px-2 py-1 text-xs font-semibold text-brand-800 hover:bg-brand-100 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          Review batch
                        </button>
                      ];
                    })}
                    rowIds={sortedInventoryBatchRows.map(
                      (row) => `ai-focus-${makeApprovalFocusRowId("inventory", row.id)}`
                    )}
                    rowClassNames={sortedInventoryBatchRows.map((row) => {
                      const pendingMeta = getPendingAgeMeta(getInventoryBatchPendingDate(row));
                      if (focusedRowId === makeApprovalFocusRowId("inventory", row.id)) {
                        return "bg-indigo-50 ring-1 ring-inset ring-indigo-200";
                      }
                      return pendingMeta?.rowClass || "";
                    })}
                  />
                )}
              </div>
            </div>
          </div>
        )}
        </section>
        {!loading && pendingSummary.total > 0 && (
          <details className="rounded-lg border border-slate-200 px-3 py-2 text-xs text-ink-700">
            <summary className="cursor-pointer font-semibold">Waiting time across all queues</summary>
            <div className="mt-2 flex flex-wrap gap-2">
              <StatusBadge label={`Under 24h: ${pendingSummary.buckets.under24}`} tone="green" />
              <StatusBadge label={`24h to under 3 days: ${pendingSummary.buckets.over24}`} tone="amber" />
              <StatusBadge label={`3 days or more: ${pendingSummary.buckets.over3d}`} tone="red" />
            </div>
          </details>
        )}
      </div>
    </Card>
  );
}
