"use client";

import type { Dispatch, SetStateAction } from "react";

import { Card } from "@/components/ui/card";
import { DataTable } from "@/components/ui/table";
import { MaintenanceStatusChip } from "@/app/maintenance/maintenance-page-utils";
import type {
  LogFilterState,
  RigMaintenanceHistoryRow,
  RigOption
} from "@/app/maintenance/maintenance-page-types";
import { formatNumber } from "@/lib/utils";

interface MaintenanceHistorySectionProps {
  isSingleProjectScope: boolean;
  scopedProjectName: string | null;
  logOpen: boolean;
  onToggleLogOpen: () => void;
  statusCounts: {
    total: number;
    open: number;
    inRepair: number;
    waitingParts: number;
    completed: number;
  };
  logFilters: LogFilterState;
  setLogFilters: Dispatch<SetStateAction<LogFilterState>>;
  scopedProjectRigOptions: RigOption[];
  rigs: RigOption[];
  loadingRows: boolean;
  rigHistoryRows: RigMaintenanceHistoryRow[];
  selectedRigHistoryId: string | null;
  onOpenRigDetail: (rigId: string) => void;
}

export function MaintenanceHistorySection({
  isSingleProjectScope,
  scopedProjectName,
  logOpen,
  onToggleLogOpen,
  statusCounts,
  logFilters,
  setLogFilters,
  scopedProjectRigOptions,
  rigs,
  loadingRows,
  rigHistoryRows,
  selectedRigHistoryId,
  onOpenRigDetail
}: MaintenanceHistorySectionProps) {
  return (
    <section id="maintenance-log-section" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Maintenance History</h2>
          <p className="text-xs text-slate-600">
            Total {statusCounts.total} • Open {statusCounts.open} • In repair{" "}
            {statusCounts.inRepair} • Waiting for parts {statusCounts.waitingParts} • Completed{" "}
            {statusCounts.completed}
          </p>
        </div>
        <button
          type="button"
          onClick={onToggleLogOpen}
          className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
        >
          {logOpen ? "Hide history" : "View history"}
        </button>
      </div>

      {logOpen && (
        <div className="space-y-3">
          <Card title="History Filters">
            {isSingleProjectScope ? (
              <p className="mb-3 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-xs text-brand-900">
                Project locked to {scopedProjectName || "selected project"}. History below is limited to this project.
              </p>
            ) : null}
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-5">
              <label className="text-sm text-ink-700">
                Rig
                <select
                  value={logFilters.rigId}
                  onChange={(event) =>
                    setLogFilters((current) => ({
                      ...current,
                      rigId: event.target.value
                    }))
                  }
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
                >
                  <option value="">All rigs</option>
                  {(isSingleProjectScope ? scopedProjectRigOptions : rigs).map((rig) => (
                    <option key={rig.id} value={rig.id}>
                      {rig.rigCode}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm text-ink-700">
                Status
                <select
                  value={logFilters.status}
                  onChange={(event) =>
                    setLogFilters((current) => ({
                      ...current,
                      status: event.target.value as LogFilterState["status"]
                    }))
                  }
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
                >
                  <option value="all">All statuses</option>
                  <option value="OPEN">Open</option>
                  <option value="IN_REPAIR">In repair</option>
                  <option value="WAITING_FOR_PARTS">Waiting for parts</option>
                  <option value="COMPLETED">Completed</option>
                </select>
              </label>
              <label className="text-sm text-ink-700">
                From
                <input
                  type="date"
                  value={logFilters.from}
                  onChange={(event) =>
                    setLogFilters((current) => ({
                      ...current,
                      from: event.target.value
                    }))
                  }
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
                />
              </label>
              <label className="text-sm text-ink-700">
                To
                <input
                  type="date"
                  value={logFilters.to}
                  onChange={(event) =>
                    setLogFilters((current) => ({
                      ...current,
                      to: event.target.value
                    }))
                  }
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
                />
              </label>
              <label className="text-sm text-ink-700">
                Linked breakdown
                <select
                  value={logFilters.linkage}
                  onChange={(event) =>
                    setLogFilters((current) => ({
                      ...current,
                      linkage: event.target.value as LogFilterState["linkage"]
                    }))
                  }
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
                >
                  <option value="all">All</option>
                  <option value="linked">Linked only</option>
                  <option value="unlinked">Unlinked only</option>
                </select>
              </label>
            </div>
          </Card>

          <Card title="Rigs with Maintenance Activity">
            {loadingRows ? (
              <p className="text-sm text-slate-600">Loading maintenance records...</p>
            ) : rigHistoryRows.length === 0 ? (
              <p className="text-sm text-slate-600">
                No maintenance records found for the current filters.
              </p>
            ) : (
              <DataTable
                columns={[
                  "Rig",
                  "Current maintenance state",
                  "Maintenance cases",
                  "Latest maintenance",
                  "Action"
                ]}
                rows={rigHistoryRows.map((entry) => [
                  entry.rigCode,
                  entry.currentStatus ? (
                    <MaintenanceStatusChip
                      key={`${entry.rigId}-state`}
                      status={entry.currentStatus}
                      legacySource={null}
                    />
                  ) : (
                    "No active case"
                  ),
                  formatNumber(entry.caseCount),
                  entry.latestMaintenanceDate,
                  <button
                    key={`${entry.rigId}-view`}
                    type="button"
                    onClick={() => onOpenRigDetail(entry.rigId)}
                    className={`rounded-md border px-2 py-1 text-xs font-semibold ${
                      selectedRigHistoryId === entry.rigId
                        ? "border-brand-300 bg-brand-50 text-brand-800"
                        : "border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
                    }`}
                  >
                    View
                  </button>
                ])}
              />
            )}
          </Card>
        </div>
      )}
    </section>
  );
}
