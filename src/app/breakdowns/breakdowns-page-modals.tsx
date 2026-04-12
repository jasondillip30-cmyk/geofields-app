"use client";

import { Card } from "@/components/ui/card";
import { DataTable } from "@/components/ui/table";
import {
  BreakdownStatusChip,
  formatBreakdownCurrentState,
  formatMaintenanceLifecycleStatus,
  toDate,
  toDateTime
} from "@/app/breakdowns/breakdowns-page-utils";
import type {
  AuditRow,
  BreakdownRecord,
  LinkedMaintenanceRow,
  LinkedRequisitionRow,
  LinkedUsageRequestRow
} from "@/app/breakdowns/breakdowns-page-types";
import { isBreakdownOpenStatus, normalizeBreakdownStatus } from "@/lib/breakdown-lifecycle";
import { formatCurrency, formatNumber } from "@/lib/utils";

interface RigDetailCaseSummary {
  open: number;
  resolved: number;
  critical: number;
}

interface RigDetailSelectedRig {
  rigId: string;
  resolvedRigId: string | null;
  rigCode: string;
  currentStatus: string | null;
  latestBreakdownDate: string;
  caseCount: number;
  cases: BreakdownRecord[];
}

interface BreakdownsRigDetailModalProps {
  open: boolean;
  selectedRig: RigDetailSelectedRig | null;
  cases: BreakdownRecord[];
  summary: RigDetailCaseSummary;
  loading: boolean;
  error: string | null;
  onClose: () => void;
  onOpenCase: (recordId: string) => void;
}

interface BreakdownsRecordDetailModalProps {
  open: boolean;
  selectedRecord: BreakdownRecord | null;
  selectedRecordIsOpen: boolean;
  resolvingId: string | null;
  linkedMaintenanceRows: LinkedMaintenanceRow[];
  linkedUsageRows: LinkedUsageRequestRow[];
  linkedRequisitionRows: LinkedRequisitionRow[];
  auditRows: AuditRow[];
  loading: boolean;
  error: string | null;
  onClose: () => void;
  onRequestParts: (record: BreakdownRecord) => void;
  onCreatePurchaseRequest: (record: BreakdownRecord) => void;
  onResolve: (record: BreakdownRecord) => void;
}

export function BreakdownsRigDetailModal(props: BreakdownsRigDetailModalProps) {
  if (!props.open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[88] flex items-center justify-center bg-slate-900/45 p-4">
      <section className="max-h-[90vh] w-full max-w-5xl overflow-y-auto rounded-2xl border border-slate-200 bg-white shadow-2xl">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3">
          <div>
            <h3 className="text-base font-semibold text-slate-900">
              Rig Breakdown View {props.selectedRig?.rigCode ? `• ${props.selectedRig.rigCode}` : ""}
            </h3>
            <p className="text-xs text-slate-600">Rig-level breakdown summary and case list</p>
          </div>
          <button
            type="button"
            onClick={props.onClose}
            className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100"
          >
            Close
          </button>
        </div>

        <div className="space-y-4 px-4 py-4">
          <div className="grid gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-700 md:grid-cols-2 lg:grid-cols-4">
            <p>
              <span className="font-semibold">Rig:</span> {props.selectedRig?.rigCode || "-"}
            </p>
            <p>
              <span className="font-semibold">Current breakdown state:</span>{" "}
              {formatBreakdownCurrentState(props.selectedRig?.currentStatus)}
            </p>
            <p>
              <span className="font-semibold">Active breakdown case:</span>{" "}
              {props.cases.find((entry) => isBreakdownOpenStatus(entry.status))?.id || "None"}
            </p>
            <p>
              <span className="font-semibold">Total breakdown cases:</span>{" "}
              {formatNumber(props.cases.length)}
            </p>
          </div>

          {props.error && (
            <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
              {props.error}
            </p>
          )}

          {props.loading ? (
            <p className="text-sm text-slate-600">Loading rig breakdown details...</p>
          ) : (
            <div className="space-y-3">
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
                <p>
                  Open breakdown cases: <span className="font-semibold">{props.summary.open}</span>
                </p>
                <p>
                  Resolved breakdown cases:{" "}
                  <span className="font-semibold">{props.summary.resolved}</span>
                </p>
                <p>
                  Critical severity cases:{" "}
                  <span className="font-semibold">{props.summary.critical}</span>
                </p>
                <p className="mt-1 text-slate-600">
                  Rig-level view is summary only. Open a case to see linked requests and actions.
                </p>
              </div>

              <Card title="Breakdown Cases">
                {props.cases.length === 0 ? (
                  <p className="text-sm text-slate-600">No breakdown cases found for this rig.</p>
                ) : (
                  <DataTable
                    columns={[
                      "Breakdown case ID",
                      "Date opened",
                      "Issue summary",
                      "Severity",
                      "Status",
                      "View details"
                    ]}
                    rows={props.cases.map((row) => [
                      row.id,
                      toDate(row.reportDate),
                      row.title || "-",
                      row.severity || "-",
                      <BreakdownStatusChip key={`${row.id}-rig-status`} status={row.status} />,
                      <button
                        key={`${row.id}-open`}
                        type="button"
                        onClick={() => props.onOpenCase(row.id)}
                        className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                      >
                        View details
                      </button>
                    ])}
                  />
                )}
              </Card>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

export function BreakdownsRecordDetailModal(props: BreakdownsRecordDetailModalProps) {
  if (!props.open || !props.selectedRecord) {
    return null;
  }
  const selectedRecord = props.selectedRecord;

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-900/45 p-4">
      <section className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-2xl border border-slate-200 bg-white shadow-2xl">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3">
          <div>
            <h3 className="text-base font-semibold text-slate-900">
              Breakdown Case {props.selectedRecord.id}
            </h3>
            <p className="text-xs text-slate-600">Operational case details and next actions</p>
          </div>
          <button
            type="button"
            onClick={props.onClose}
            className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100"
          >
            Close
          </button>
        </div>

        <div className="space-y-4 px-4 py-4">
          <div className="grid gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-700 md:grid-cols-2">
            <p>
              <span className="font-semibold">Breakdown ID:</span> {props.selectedRecord.id}
            </p>
            <p>
              <span className="font-semibold">Status:</span>{" "}
              {normalizeBreakdownStatus(props.selectedRecord.status)}
            </p>
            <p>
              <span className="font-semibold">Project:</span> {props.selectedRecord.project?.name || "-"}
            </p>
            <p>
              <span className="font-semibold">Rig:</span> {props.selectedRecord.rig?.rigCode || "-"}
            </p>
            <p>
              <span className="font-semibold">Client:</span> {props.selectedRecord.client?.name || "-"}
            </p>
            <p>
              <span className="font-semibold">Date reported:</span> {toDate(props.selectedRecord.reportDate)}
            </p>
            <p>
              <span className="font-semibold">Severity:</span> {props.selectedRecord.severity}
            </p>
            <p>
              <span className="font-semibold">Downtime:</span> {formatNumber(props.selectedRecord.downtimeHours)} hrs
            </p>
            <p className="md:col-span-2">
              <span className="font-semibold">Issue summary:</span> {props.selectedRecord.title}
            </p>
            <p className="md:col-span-2">
              <span className="font-semibold">Problem description:</span> {props.selectedRecord.description || "-"}
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => props.onRequestParts(selectedRecord)}
              disabled={!props.selectedRecordIsOpen}
              className="rounded-md border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-800 hover:bg-indigo-100 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Request parts
            </button>
            <button
              type="button"
              onClick={() => props.onCreatePurchaseRequest(selectedRecord)}
              disabled={!props.selectedRecordIsOpen}
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Create purchase request
            </button>
            <button
              type="button"
              onClick={() => props.onResolve(selectedRecord)}
              disabled={!props.selectedRecordIsOpen || props.resolvingId === selectedRecord.id}
              className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-800 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {props.resolvingId === selectedRecord.id ? "Resolving..." : "Mark breakdown resolved"}
            </button>
          </div>
          {!props.selectedRecordIsOpen && (
            <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
              This breakdown case is resolved. Linked history remains viewable, but new item or purchase actions are disabled.
            </p>
          )}

          {props.error && (
            <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
              {props.error}
            </p>
          )}

          {props.loading ? (
            <p className="text-sm text-slate-600">Loading linked case details...</p>
          ) : (
            <div className="grid gap-3 lg:grid-cols-2">
              <Card title="Linked Maintenance Records">
                {props.linkedMaintenanceRows.length === 0 ? (
                  <p className="text-sm text-slate-600">No linked maintenance records yet.</p>
                ) : (
                  <DataTable
                    columns={["Record", "Date", "Status", "Description"]}
                    rows={props.linkedMaintenanceRows.map((row) => [
                      row.requestCode,
                      toDate(row.requestDate),
                      formatMaintenanceLifecycleStatus(row.status),
                      row.issueDescription || "-"
                    ])}
                  />
                )}
              </Card>

              <Card title="Linked Inventory Usage Requests">
                {props.linkedUsageRows.length === 0 ? (
                  <p className="text-sm text-slate-600">No linked inventory usage requests yet.</p>
                ) : (
                  <DataTable
                    columns={["Requested", "Item", "Qty", "Status", "Requester"]}
                    rows={props.linkedUsageRows.map((row) => [
                      toDate(row.createdAt),
                      row.item ? `${row.item.name} (${row.item.sku})` : "-",
                      formatNumber(row.quantity),
                      row.status,
                      row.requestedBy?.fullName || "-"
                    ])}
                  />
                )}
              </Card>

              <Card title="Linked Purchase Requests">
                {props.linkedRequisitionRows.length === 0 ? (
                  <p className="text-sm text-slate-600">No linked purchase requests yet.</p>
                ) : (
                  <DataTable
                    columns={["Requisition", "Type", "Status", "Submitted", "Estimated"]}
                    rows={props.linkedRequisitionRows.map((row) => [
                      row.requisitionCode,
                      row.type,
                      row.status,
                      toDate(row.submittedAt),
                      formatCurrency(row.totals?.estimatedTotalCost || 0)
                    ])}
                  />
                )}
              </Card>

              <Card title="Case Update History">
                {props.auditRows.length === 0 ? (
                  <p className="text-sm text-slate-600">No update history available for this record.</p>
                ) : (
                  <div className="space-y-2">
                    {props.auditRows.map((entry) => (
                      <div
                        key={entry.id}
                        className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700"
                      >
                        <p className="font-semibold text-slate-900">
                          {entry.action.replaceAll("_", " ")}
                        </p>
                        <p className="mt-0.5">{entry.description || "Breakdown case updated."}</p>
                        <p className="mt-0.5 text-slate-500">
                          {toDateTime(entry.createdAt)}
                          {entry.actorName ? ` • ${entry.actorName}` : ""}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
