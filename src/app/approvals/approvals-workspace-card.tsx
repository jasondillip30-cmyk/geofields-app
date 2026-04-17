import Link from "next/link";

import { WorkflowAssistPanel, type WorkflowAssistModel } from "@/components/layout/workflow-assist-panel";
import { Card, MetricCard } from "@/components/ui/card";
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
  mostAttention: {
    label: string;
    count: number;
  } | null;
}

export interface ApprovalsWorkspaceCardProps {
  activeTab: ApprovalTab;
  approvalWorkflowAssist: WorkflowAssistModel | null;
  actingRowId: string | null;
  canManageDrillingApprovals: boolean;
  canManageInventoryApprovals: boolean;
  canManageRequisitionApprovals: boolean;
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
  onInventoryStatus: (rowId: string, action: "approve" | "reject") => void;
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
  canManageRequisitionApprovals,
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
  return (
    <Card
      title="Approvals Hub"
      subtitle="Centralized approval workflow for requisitions, drilling reports, inventory usage, and receipt submissions."
    >
      <div className="space-y-4">
        <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
          This workspace handles requisitions, drilling, inventory usage, and receipt submissions.
          Approved requisitions can then continue to receipt intake from Purchase Requests history.
        </p>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            label="Pending Requisition Approvals"
            value={String(pendingSummary.counts.requisitions)}
            tone={pendingSummary.counts.requisitions > 0 ? "warn" : "neutral"}
          />
          <MetricCard
            label="Pending Receipt Submissions"
            value={String(pendingSummary.counts.receiptSubmissions)}
            tone={pendingSummary.counts.receiptSubmissions > 0 ? "warn" : "neutral"}
          />
          <MetricCard
            label="Pending Inventory Usage"
            value={String(pendingSummary.counts.inventoryUsage)}
            tone={pendingSummary.counts.inventoryUsage > 0 ? "warn" : "neutral"}
          />
          <MetricCard
            label="Total Pending Approvals"
            value={String(pendingSummary.total)}
            tone={pendingSummary.total > 0 ? "warn" : "neutral"}
          />
        </div>

        <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">Pending Urgency Breakdown</p>
            <span className="rounded-full border border-slate-300 bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-700">
              Oldest pending first
            </span>
          </div>
          <div className="mt-2 flex flex-wrap gap-2 text-xs">
            <StatusBadge label={`Under 24h: ${pendingSummary.buckets.under24}`} tone="green" />
            <StatusBadge label={`Over 24h: ${pendingSummary.buckets.over24}`} tone="amber" />
            <StatusBadge label={`Over 3 days: ${pendingSummary.buckets.over3d}`} tone="red" />
          </div>
          {pendingSummary.mostAttention && pendingSummary.mostAttention.count > 0 && (
            <p className="mt-2 text-xs text-slate-700">
              Most attention needed:{" "}
              <span className="font-semibold text-ink-900">
                {pendingSummary.mostAttention.label} ({pendingSummary.mostAttention.count})
              </span>
            </p>
          )}
        </div>

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
              <h3 className="text-sm font-semibold text-ink-900">Pending Receipt Submissions</h3>
              <p className="text-xs text-slate-600">
                Spending visibility for stock and operational expense approvals.
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

        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200/85 bg-slate-50/75 p-2">
          {APPROVAL_TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => onTabChange(tab.key)}
              className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${
                activeTab === tab.key
                  ? "border-brand-500 bg-brand-50 text-brand-800"
                  : "border-slate-200 bg-white text-ink-700 hover:bg-slate-50"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <WorkflowAssistPanel model={approvalWorkflowAssist} />

        {activeTab === "requisitions" ? (
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
              {!canManageRequisitionApprovals ? (
                <div className="border-b border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  View only: requisition approval actions are available to ADMIN and MANAGER roles.
                </div>
              ) : null}
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
                      <input
                        key={`${row.id}-comment`}
                        type="text"
                        value={requisitionNotes[row.id] || ""}
                        onChange={(event) => onRequisitionNoteChange(row.id, event.target.value)}
                        placeholder="Optional rejection reason"
                        className="w-52 rounded-md border border-slate-200 px-2 py-1 text-xs"
                      />,
                      <div key={`${row.id}-actions`} className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          disabled={!canManageRequisitionApprovals || actingRowId === row.id}
                          onClick={() => onRequisitionStatus(row.id, "approve")}
                          className="rounded-md border border-emerald-200 px-2 py-1 text-xs text-emerald-700 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          Approve
                        </button>
                        <button
                          type="button"
                          disabled={!canManageRequisitionApprovals || actingRowId === row.id}
                          onClick={() => onRequisitionStatus(row.id, "reject")}
                          className="rounded-md border border-red-200 px-2 py-1 text-xs text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          Reject
                        </button>
                      </div>
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
            <p className="text-sm text-ink-600">No submitted drilling reports pending approval for current filters.</p>
          ) : (
            <div
              id={APPROVAL_SECTION_IDS.drilling}
              className={`overflow-hidden rounded-xl border border-slate-200 ${
                focusedSectionId === APPROVAL_SECTION_IDS.drilling
                  ? "ring-2 ring-indigo-100 ring-offset-2 ring-offset-slate-50"
                  : ""
              }`}
            >
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
                View only: approval actions are available to ADMIN and MANAGER roles.
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
                            label={row.status === "PENDING" ? "Pending" : "Submitted"}
                            tone={row.status === "PENDING" ? "amber" : "blue"}
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
                            onClick={() => onInventoryStatus(row.id, "approve")}
                            className="rounded-md border border-emerald-200 px-2 py-1 text-xs text-emerald-700 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            Approve
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
      </div>
    </Card>
  );
}
