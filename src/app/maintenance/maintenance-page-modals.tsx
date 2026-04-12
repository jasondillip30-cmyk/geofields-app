"use client";

import { Card } from "@/components/ui/card";
import { DataTable } from "@/components/ui/table";
import { formatCurrency, formatNumber } from "@/lib/utils";
import {
  MaintenanceStatusChip,
  formatMaintenanceStatus,
  formatMaintenanceTypeLabel,
  normalizeMaintenanceStatus,
  toDate,
  toDateTime
} from "./maintenance-page-utils";
import type {
  AuditRow,
  LinkedRequisitionRow,
  LinkedUsageRequestRow,
  MaintenanceFormState,
  MaintenanceRow,
  RigMaintenanceHistoryRow
} from "./maintenance-page-types";

interface RigDetailCaseSummary {
  open: number;
  inRepair: number;
  waitingParts: number;
  completed: number;
}

interface MaintenanceRigDetailModalProps {
  open: boolean;
  selectedRig: RigMaintenanceHistoryRow | null;
  loading: boolean;
  error: string | null;
  cases: MaintenanceRow[];
  summary: RigDetailCaseSummary;
  onClose: () => void;
  onOpenCase: (recordId: string) => void;
}

interface MaintenanceRecordDetailModalProps {
  open: boolean;
  selectedRecord: MaintenanceRow | null;
  selectedRecordStatus: string | null;
  resolvingRecordId: string | null;
  loading: boolean;
  error: string | null;
  linkedUsageRows: LinkedUsageRequestRow[];
  linkedRequisitionRows: LinkedRequisitionRow[];
  auditRows: AuditRow[];
  onClose: () => void;
  onRequestItem: () => void;
  onCreatePurchaseRequest: () => void;
  onResolve: () => void;
}

export function MaintenanceRigDetailModal(props: MaintenanceRigDetailModalProps) {
  if (!props.open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[88] flex items-center justify-center bg-slate-900/45 p-4">
      <section className="max-h-[90vh] w-full max-w-5xl overflow-y-auto rounded-2xl border border-slate-200 bg-white shadow-2xl">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3">
          <div>
            <h3 className="text-base font-semibold text-slate-900">
              Rig Maintenance View {props.selectedRig?.rigCode ? `• ${props.selectedRig.rigCode}` : ""}
            </h3>
            <p className="text-xs text-slate-600">
              Rig-level maintenance history and linked operational records
            </p>
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
              <span className="font-semibold">Current maintenance state:</span>{" "}
              {props.selectedRig?.currentStatus
                ? formatMaintenanceStatus(props.selectedRig.currentStatus)
                : "No active case"}
            </p>
            <p>
              <span className="font-semibold">Active maintenance case:</span>{" "}
              {props.cases.find((entry) => normalizeMaintenanceStatus(entry.status).status !== "COMPLETED")
                ?.requestCode || "None"}
            </p>
            <p>
              <span className="font-semibold">Total maintenance cases:</span>{" "}
              {formatNumber(props.cases.length)}
            </p>
          </div>

          {props.error && (
            <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
              {props.error}
            </p>
          )}

          {props.loading ? (
            <p className="text-sm text-slate-600">Loading rig maintenance details...</p>
          ) : (
            <div className="space-y-3">
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
                <p>
                  Active maintenance cases:{" "}
                  <span className="font-semibold">
                    {props.summary.open + props.summary.inRepair + props.summary.waitingParts}
                  </span>
                </p>
                <p>
                  Historical completed cases:{" "}
                  <span className="font-semibold">{props.summary.completed}</span>
                </p>
                <p className="mt-1 text-slate-600">
                  Rig-level view is summary only. Open a case to manage linked requests and actions.
                </p>
              </div>
              <Card title="Maintenance Cases">
                {props.cases.length === 0 ? (
                  <p className="text-sm text-slate-600">No maintenance cases found for this rig.</p>
                ) : (
                  <DataTable
                    columns={[
                      "Maintenance case ID",
                      "Date opened",
                      "Type",
                      "Status",
                      "Linked breakdown",
                      "View details"
                    ]}
                    rows={props.cases.map((row) => {
                      const normalizedStatus = normalizeMaintenanceStatus(row.status);
                      return [
                        row.requestCode,
                        row.date,
                        formatMaintenanceTypeLabel(
                          (row.issueType || "").toUpperCase() as MaintenanceFormState["maintenanceType"]
                        ),
                        <MaintenanceStatusChip
                          key={`${row.id}-rig-status`}
                          status={normalizedStatus.status}
                          legacySource={normalizedStatus.legacySource}
                        />,
                        row.breakdownReport?.title || row.breakdownReportId || "-",
                        <button
                          key={`${row.id}-open`}
                          type="button"
                          onClick={() => props.onOpenCase(row.id)}
                          className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                        >
                          View details
                        </button>
                      ];
                    })}
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

export function MaintenanceRecordDetailModal(props: MaintenanceRecordDetailModalProps) {
  if (!props.open || !props.selectedRecord) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-900/45 p-4">
      <section className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-2xl border border-slate-200 bg-white shadow-2xl">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3">
          <div>
            <h3 className="text-base font-semibold text-slate-900">
              Maintenance Case {props.selectedRecord.requestCode}
            </h3>
            <p className="text-xs text-slate-600">
              Operational case details and next actions
            </p>
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
              <span className="font-semibold">Maintenance ID:</span> {props.selectedRecord.id}
            </p>
            <p>
              <span className="font-semibold">Current status:</span>{" "}
              {formatMaintenanceStatus(props.selectedRecord.status, true)}
            </p>
            <p>
              <span className="font-semibold">Rig:</span>{" "}
              {props.selectedRecord.rig?.rigCode || props.selectedRecord.rigId}
            </p>
            <p>
              <span className="font-semibold">Project:</span>{" "}
              {props.selectedRecord.project?.name || "No active project"}
            </p>
            <p>
              <span className="font-semibold">Linked breakdown:</span>{" "}
              {props.selectedRecord.breakdownReport?.title ||
                props.selectedRecord.breakdownReportId ||
                "-"}
            </p>
            <p>
              <span className="font-semibold">Date opened:</span> {props.selectedRecord.date}
            </p>
            <p>
              <span className="font-semibold">Maintenance type:</span>{" "}
              {formatMaintenanceTypeLabel(props.selectedRecord.issueType)}
            </p>
            <p>
              <span className="font-semibold">Downtime:</span>{" "}
              {formatNumber(props.selectedRecord.estimatedDowntimeHours)} hrs
            </p>
            <p className="md:col-span-2">
              <span className="font-semibold">Issue / work description:</span>{" "}
              {props.selectedRecord.issueDescription}
            </p>
            <p className="md:col-span-2">
              <span className="font-semibold">Notes:</span> {props.selectedRecord.notes || "-"}
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={props.onRequestItem}
              disabled={props.selectedRecordStatus === "COMPLETED"}
              className="rounded-md border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-800 hover:bg-indigo-100 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Request item
            </button>
            <button
              type="button"
              onClick={props.onCreatePurchaseRequest}
              disabled={props.selectedRecordStatus === "COMPLETED"}
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Create purchase request
            </button>
            <button
              type="button"
              onClick={props.onResolve}
              disabled={
                props.selectedRecordStatus === "COMPLETED" ||
                props.resolvingRecordId === props.selectedRecord.id
              }
              className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-800 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {props.resolvingRecordId === props.selectedRecord.id ? "Resolving..." : "Mark resolved"}
            </button>
          </div>
          {props.selectedRecordStatus === "COMPLETED" && (
            <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
              This maintenance case is completed. Linked history remains viewable, but new item or purchase actions are disabled.
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

              <Card title="Activity History">
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
                        <p className="mt-0.5">{entry.description || "Maintenance case updated."}</p>
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
