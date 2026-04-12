import Link from "next/link";

import { WorkflowAssistPanel, type WorkflowAssistModel } from "@/components/layout/workflow-assist-panel";
import { Card, MetricCard } from "@/components/ui/card";
import { formatCurrency, formatNumber } from "@/lib/utils";

import type {
  ApprovalTab,
  DrillingApprovalRow,
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
  sortedInventoryRows: InventoryUsageApprovalRow[];
  sortedReceiptSubmissionRows: ReceiptSubmissionApprovalRow[];
  sortedRequisitionRows: RequisitionApprovalRow[];
  onDrillingNoteChange: (rowId: string, value: string) => void;
  onDrillingStatus: (rowId: string, action: "approve" | "reject") => void;
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
  sortedInventoryRows,
  sortedReceiptSubmissionRows,
  sortedRequisitionRows,
  onDrillingNoteChange,
  onDrillingStatus,
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
              <table className="min-w-full text-left text-sm">
                <thead className="sticky top-0 z-10 bg-white text-xs uppercase tracking-wide text-slate-600">
                  <tr>
                    <th className="px-3 py-2">Submitted</th>
                    <th className="px-3 py-2">Supplier / Receipt</th>
                    <th className="px-3 py-2">Type</th>
                    <th className="px-3 py-2">Operational Context</th>
                    <th className="px-3 py-2 text-right">Total Amount</th>
                    <th className="px-3 py-2">Pending Age</th>
                    <th className="px-3 py-2">Review</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {sortedReceiptSubmissionRows.map((row) => {
                    const pendingMeta = getPendingAgeMeta(getReceiptSubmissionPendingDate(row));
                    const isHighValue =
                      highValueReceiptThreshold > 0 && row.summary.total >= highValueReceiptThreshold;
                    const rowToneClass =
                      row.classification.tag === "MAINTENANCE"
                        ? "bg-amber-50/50"
                        : row.classification.tag === "EXPENSE"
                          ? "bg-slate-50/65"
                          : "";
                    return (
                      <tr
                        key={row.id}
                        id={`ai-focus-${makeApprovalFocusRowId("receipt", row.id)}`}
                        className={`transition-colors duration-150 hover:bg-slate-50/80 ${
                          focusedRowId === makeApprovalFocusRowId("receipt", row.id)
                            ? "bg-indigo-50 ring-1 ring-inset ring-indigo-200"
                            : pendingMeta?.rowClass || rowToneClass
                        }`}
                      >
                        <td className="px-3 py-2 text-ink-700">
                          {formatReceiptSubmissionDate(row.submittedAt, row.reportDate)}
                        </td>
                        <td className="px-3 py-2">
                          <p className="font-medium text-ink-900">{row.summary.supplierName || "-"}</p>
                          <p className="text-xs text-slate-600">
                            Receipt: {row.summary.receiptNumber || "-"}
                            {row.summary.traReceiptNumber ? ` • TRA: ${row.summary.traReceiptNumber}` : ""}
                          </p>
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex flex-wrap items-center gap-1">
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
                          </div>
                        </td>
                        <td className="px-3 py-2 text-xs text-ink-800">
                          <span className="font-medium">{row.classification.contextLabel}</span>
                          {row.classification.tag === "STOCK" ? (
                            <span className="text-slate-600">
                              {" "}• {row.classification.stockUse === "URGENT_USE" ? "Urgent use" : "Warehouse stock"}
                            </span>
                          ) : null}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <span className="font-semibold text-ink-900">{formatCurrency(row.summary.total || 0)}</span>
                            {isHighValue ? <StatusBadge label="High value" tone="amber" /> : null}
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          {pendingMeta ? <StatusBadge label={pendingMeta.label} tone={pendingMeta.badgeTone} /> : "-"}
                        </td>
                        <td className="px-3 py-2">
                          <Link
                            href={`/purchasing/receipt-follow-up?submissionId=${encodeURIComponent(row.id)}`}
                            className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                          >
                            Review
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
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
                <table className="min-w-full text-left text-sm">
                  <thead className="sticky top-0 z-10 bg-slate-50 text-xs uppercase tracking-wide text-slate-600">
                    <tr>
                      <th className="px-3 py-2">Submitted</th>
                      <th className="px-3 py-2">Requisition</th>
                      <th className="px-3 py-2">Type</th>
                      <th className="px-3 py-2">Path</th>
                      <th className="px-3 py-2">Context</th>
                      <th className="px-3 py-2 text-right">Estimated Total</th>
                      <th className="px-3 py-2">Pending Age</th>
                      <th className="px-3 py-2">Submitted By</th>
                      <th className="px-3 py-2">Comment</th>
                      <th className="px-3 py-2">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white">
                    {sortedRequisitionRows.map((row) => {
                      const pendingMeta = getPendingAgeMeta(row.submittedAt);
                      return (
                        <tr
                          key={row.id}
                          id={`ai-focus-${makeApprovalFocusRowId("requisition", row.id)}`}
                          className={`transition-colors duration-150 hover:bg-slate-50/80 ${
                            focusedRowId === makeApprovalFocusRowId("requisition", row.id)
                              ? "bg-indigo-50 ring-1 ring-inset ring-indigo-200"
                              : pendingMeta?.rowClass || ""
                          }`}
                        >
                          <td className="px-3 py-2 text-ink-700">{formatReceiptSubmissionDate(row.submittedAt, row.submittedAt)}</td>
                          <td className="px-3 py-2 text-ink-800">{row.requisitionCode}</td>
                          <td className="px-3 py-2 text-ink-700">{formatRequisitionType(row.type)}</td>
                          <td className="px-3 py-2 text-ink-700">{formatLiveProjectSpendType(row.liveProjectSpendType)}</td>
                          <td className="px-3 py-2 text-ink-700">
                            {formatRequisitionContext(row.type, row.context, row.contextLabels)}
                          </td>
                          <td className="px-3 py-2 text-right text-ink-800">{formatCurrency(row.totals.estimatedTotalCost || 0)}</td>
                          <td className="px-3 py-2">
                            {pendingMeta ? <StatusBadge label={pendingMeta.label} tone={pendingMeta.badgeTone} /> : "-"}
                          </td>
                          <td className="px-3 py-2 text-ink-700">{row.submittedBy.name || "-"}</td>
                          <td className="px-3 py-2">
                            <input
                              type="text"
                              value={requisitionNotes[row.id] || ""}
                              onChange={(event) => onRequisitionNoteChange(row.id, event.target.value)}
                              placeholder="Optional rejection reason"
                              className="w-52 rounded-md border border-slate-200 px-2 py-1 text-xs"
                            />
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex flex-wrap gap-2">
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
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
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
                <table className="min-w-full text-left text-sm">
                  <thead className="sticky top-0 z-10 bg-slate-50 text-xs uppercase tracking-wide text-slate-600">
                    <tr>
                      <th className="px-3 py-2">Date</th>
                      <th className="px-3 py-2">Project</th>
                      <th className="px-3 py-2">Client</th>
                      <th className="px-3 py-2">Rig</th>
                      <th className="px-3 py-2">Hole Number</th>
                      <th className="px-3 py-2 text-right">Meters Drilled</th>
                      <th className="px-3 py-2 text-right">Work Hours</th>
                      <th className="px-3 py-2">Submitted By</th>
                      <th className="px-3 py-2">Pending Age</th>
                      <th className="px-3 py-2">Status</th>
                      <th className="px-3 py-2">Comment</th>
                      <th className="px-3 py-2">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white">
                    {sortedDrillingRows.map((row) => {
                      const pendingMeta = getPendingAgeMeta(getDrillingPendingDate(row));
                      return (
                        <tr
                          key={row.id}
                          id={`ai-focus-${makeApprovalFocusRowId("drilling", row.id)}`}
                          className={`transition-colors duration-150 hover:bg-slate-50/80 ${
                            focusedRowId === makeApprovalFocusRowId("drilling", row.id)
                              ? "bg-indigo-50 ring-1 ring-inset ring-indigo-200"
                              : pendingMeta?.rowClass || ""
                          }`}
                        >
                          <td className="px-3 py-2 text-ink-700">{new Date(row.date).toISOString().slice(0, 10)}</td>
                          <td className="px-3 py-2 text-ink-800">{row.project.name}</td>
                          <td className="px-3 py-2 text-ink-700">{row.client.name}</td>
                          <td className="px-3 py-2 text-ink-700">{row.rig.rigCode}</td>
                          <td className="px-3 py-2 text-ink-700">{row.holeNumber}</td>
                          <td className="px-3 py-2 text-right text-ink-700">{formatNumber(row.totalMetersDrilled)}</td>
                          <td className="px-3 py-2 text-right text-ink-700">{row.workHours.toFixed(1)}</td>
                          <td className="px-3 py-2 text-ink-700">{row.submittedBy?.fullName || "-"}</td>
                          <td className="px-3 py-2">{pendingMeta ? <StatusBadge label={pendingMeta.label} tone={pendingMeta.badgeTone} /> : "-"}</td>
                          <td className="px-3 py-2">
                            <StatusBadge label="Submitted" tone="blue" />
                          </td>
                          <td className="px-3 py-2">
                            <input
                              type="text"
                              value={drillingNotes[row.id] || ""}
                              onChange={(event) => onDrillingNoteChange(row.id, event.target.value)}
                              placeholder="Optional rejection reason"
                              className="w-52 rounded-md border border-slate-200 px-2 py-1 text-xs"
                            />
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex flex-wrap gap-2">
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
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )
        ) : loading ? (
          <p className="text-sm text-ink-600">Loading inventory usage requests...</p>
        ) : sortedInventoryRows.length === 0 ? (
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
            <div className="max-h-[620px] overflow-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="sticky top-0 z-10 bg-slate-50 text-xs uppercase tracking-wide text-slate-600">
                  <tr>
                    <th className="px-3 py-2">Date</th>
                    <th className="px-3 py-2">Requested For</th>
                    <th className="px-3 py-2">Item</th>
                    <th className="px-3 py-2 text-right">Qty</th>
                    <th className="px-3 py-2">Pending Age</th>
                    <th className="px-3 py-2">Requester</th>
                    <th className="px-3 py-2">Project</th>
                    <th className="px-3 py-2">Rig/Location</th>
                    <th className="px-3 py-2">Maintenance</th>
                    <th className="px-3 py-2">Reason</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Comment</th>
                    <th className="px-3 py-2">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {sortedInventoryRows.map((row) => {
                    const pendingMeta = getPendingAgeMeta(getInventoryPendingDate(row));
                    return (
                      <tr
                        key={row.id}
                        id={`ai-focus-${makeApprovalFocusRowId("inventory", row.id)}`}
                        className={`transition-colors duration-150 hover:bg-slate-50/80 ${
                          focusedRowId === makeApprovalFocusRowId("inventory", row.id)
                            ? "bg-indigo-50 ring-1 ring-inset ring-indigo-200"
                            : inventoryRowWarnings[row.id]
                              ? "bg-amber-50/55"
                              : pendingMeta?.rowClass || ""
                        }`}
                      >
                        <td className="px-3 py-2 text-ink-700">{new Date(row.createdAt).toISOString().slice(0, 10)}</td>
                        <td className="px-3 py-2 text-ink-700">
                          {row.requestedForDate ? new Date(row.requestedForDate).toISOString().slice(0, 10) : "-"}
                        </td>
                        <td className="px-3 py-2 text-ink-800">{row.item.name}</td>
                        <td className="px-3 py-2 text-right text-ink-700">{formatNumber(row.quantity)}</td>
                        <td className="px-3 py-2">{pendingMeta ? <StatusBadge label={pendingMeta.label} tone={pendingMeta.badgeTone} /> : "-"}</td>
                        <td className="px-3 py-2 text-ink-700">{row.requestedBy?.fullName || "-"}</td>
                        <td className="px-3 py-2 text-ink-700">{row.project?.name || "-"}</td>
                        <td className="px-3 py-2 text-ink-700">{row.rig?.rigCode || row.location?.name || "-"}</td>
                        <td className="px-3 py-2 text-ink-700">{row.maintenanceRequest?.requestCode || "-"}</td>
                        <td className="max-w-[300px] px-3 py-2 text-ink-800">{row.reason}</td>
                        <td className="px-3 py-2">
                          <div className="flex flex-wrap items-center gap-1">
                            <StatusBadge
                              label={row.status === "PENDING" ? "Pending" : "Submitted"}
                              tone={row.status === "PENDING" ? "amber" : "blue"}
                            />
                            {inventoryRowWarnings[row.id] ? (
                              <StatusBadge label={inventoryRowWarnings[row.id]} tone="red" />
                            ) : null}
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="text"
                            value={inventoryNotes[row.id] || ""}
                            onChange={(event) => onInventoryNoteChange(row.id, event.target.value)}
                            placeholder="Optional note"
                            className="w-52 rounded-md border border-slate-200 px-2 py-1 text-xs"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex flex-wrap gap-2">
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
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}
