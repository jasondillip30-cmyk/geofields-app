"use client";

import type { ComponentProps, Dispatch, SetStateAction } from "react";

import { AccessGate } from "@/components/layout/access-gate";
import { Card } from "@/components/ui/card";
import { DataTable } from "@/components/ui/table";
import {
  BreakdownStatusChip,
  toDate
} from "@/app/breakdowns/breakdowns-page-utils";
import {
  type BreakdownFormState,
  type BreakdownLogFilterState,
  type BreakdownRecord,
  type LinkedMaintenanceRow,
  type LinkedRequisitionRow,
  type LinkedUsageRequestRow,
  type AuditRow,
  type ProjectOption,
  type RigOption
} from "@/app/breakdowns/breakdowns-page-types";
import { BreakdownsRecordDetailModal, BreakdownsRigDetailModal } from "@/app/breakdowns/breakdowns-page-modals";
import { cn, formatNumber } from "@/lib/utils";

type RigDetailSelectedRig = ComponentProps<typeof BreakdownsRigDetailModal>["selectedRig"];
type RigDetailCaseSummary = ComponentProps<typeof BreakdownsRigDetailModal>["summary"];

interface BreakdownsPageViewProps {
  notice: string | null;
  errorMessage: string | null;
  isSingleProjectScope: boolean;
  scopeProjectId: string;
  scopedProject: ProjectOption | null;
  effectiveProject: ProjectOption | null;
  effectiveProjectRigOptions: RigOption[];
  activeProjects: ProjectOption[];
  selectedRigCode: string;
  form: BreakdownFormState;
  setForm: Dispatch<SetStateAction<BreakdownFormState>>;
  formError: string | null;
  submitBreakdown: (event: React.FormEvent<HTMLFormElement>) => void;
  submitting: boolean;
  focusedSectionId: string | null;
  openRecordsCount: number;
  criticalCount: number;
  blockedProjectCount: number;
  totalDowntime: number;
  logOpen: boolean;
  setLogOpen: Dispatch<SetStateAction<boolean>>;
  logFilters: BreakdownLogFilterState;
  setLogFilters: Dispatch<SetStateAction<BreakdownLogFilterState>>;
  projects: ProjectOption[];
  rigFilterOptions: RigOption[];
  loading: boolean;
  rigHistoryRows: Array<{
    rigId: string;
    resolvedRigId: string | null;
    rigCode: string;
    currentStatus: string | null;
    latestBreakdownDate: string;
    caseCount: number;
    cases: BreakdownRecord[];
  }>;
  selectedRigHistoryId: string | null;
  openRigDetail: (rigId: string) => void;
  focusedRowId: string | null;
  rigDetailOpen: boolean;
  rigDetailSelectedRig: RigDetailSelectedRig;
  rigDetailCases: BreakdownRecord[];
  rigDetailCaseSummary: RigDetailCaseSummary;
  rigDetailLoading: boolean;
  rigDetailError: string | null;
  closeRigDetail: () => void;
  openCaseFromRigDetail: (recordId: string) => void;
  detailOpen: boolean;
  selectedRecord: BreakdownRecord | null;
  selectedRecordIsOpen: boolean;
  resolvingId: string | null;
  linkedMaintenanceRows: LinkedMaintenanceRow[];
  linkedUsageRows: LinkedUsageRequestRow[];
  linkedRequisitionRows: LinkedRequisitionRow[];
  auditRows: AuditRow[];
  detailLoading: boolean;
  detailError: string | null;
  closeBreakdownDetail: () => void;
  goToBreakdownPartsRequest: (record: BreakdownRecord) => void;
  goToBreakdownPurchaseRequest: (record: BreakdownRecord) => void;
  resolveBreakdown: (record: BreakdownRecord) => Promise<void>;
}

export function BreakdownsPageView({
  notice,
  errorMessage,
  isSingleProjectScope,
  scopeProjectId: _scopeProjectId,
  scopedProject,
  effectiveProject,
  effectiveProjectRigOptions,
  activeProjects,
  selectedRigCode,
  form,
  setForm,
  formError,
  submitBreakdown,
  submitting,
  focusedSectionId,
  openRecordsCount,
  criticalCount,
  blockedProjectCount,
  totalDowntime,
  logOpen,
  setLogOpen,
  logFilters,
  setLogFilters,
  projects,
  rigFilterOptions,
  loading,
  rigHistoryRows,
  selectedRigHistoryId,
  openRigDetail,
  focusedRowId,
  rigDetailOpen,
  rigDetailSelectedRig,
  rigDetailCases,
  rigDetailCaseSummary,
  rigDetailLoading,
  rigDetailError,
  closeRigDetail,
  openCaseFromRigDetail,
  detailOpen,
  selectedRecord,
  selectedRecordIsOpen,
  resolvingId,
  linkedMaintenanceRows,
  linkedUsageRows,
  linkedRequisitionRows,
  auditRows,
  detailLoading,
  detailError,
  closeBreakdownDetail,
  goToBreakdownPartsRequest,
  goToBreakdownPurchaseRequest,
  resolveBreakdown
}: BreakdownsPageViewProps) {
  return (
    <AccessGate permission="breakdowns:view">
      <div className="gf-page-stack">
        {notice ? (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            {notice}
          </div>
        ) : null}
        {errorMessage ? (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {errorMessage}
          </div>
        ) : null}
        <AccessGate permission="breakdowns:submit">
          <Card
            title="Report breakdown"
            subtitle="Capture the issue quickly, then continue with repair actions."
          >
            <form onSubmit={submitBreakdown} className="space-y-3">
              <div className="gf-guided-strip">
                <p className="gf-guided-strip-title">Guided workflow</p>
                <div className="gf-guided-step-list">
                  <p className="gf-guided-step">1. Confirm project rig context.</p>
                  <p className="gf-guided-step">2. Enter issue summary and severity.</p>
                  <p className="gf-guided-step">3. Save and continue with repair actions.</p>
                </div>
              </div>
              {isSingleProjectScope ? (
                <div className="rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-xs text-brand-900">
                  <p>
                    <span className="font-semibold">Project locked:</span>{" "}
                    {scopedProject?.name || "Selected project"}
                  </p>
                  <p>
                    <span className="font-semibold">Client:</span>{" "}
                    {scopedProject?.client?.name || "-"}
                  </p>
                  <p>
                    <span className="font-semibold">Allowed rigs:</span>{" "}
                    {effectiveProjectRigOptions.length > 0
                      ? effectiveProjectRigOptions.map((entry) => entry.rigCode).join(", ")
                      : "None"}
                  </p>
                </div>
              ) : null}
              {effectiveProject && effectiveProjectRigOptions.length === 0 ? (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  This project has no assigned rig. Assign a rig to the project first.
                </div>
              ) : null}
              <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
                {isSingleProjectScope ? (
                  <label className="text-sm text-ink-700">
                    Project
                    <input
                      value={scopedProject?.name || "Selected project"}
                      disabled
                      className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-slate-700"
                    />
                  </label>
                ) : (
                  <label className="text-sm text-ink-700">
                    Project
                    <select
                      value={form.projectId}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          projectId: event.target.value,
                          rigId: ""
                        }))
                      }
                      className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
                      required
                    >
                      <option value="">Select active project</option>
                      {activeProjects.map((project) => (
                        <option key={project.id} value={project.id}>
                          {project.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {effectiveProjectRigOptions.length > 1 ? (
                  <label className="text-sm text-ink-700">
                    Project rig
                    <select
                      value={form.rigId}
                      onChange={(event) =>
                        setForm((current) => ({ ...current, rigId: event.target.value }))
                      }
                      className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
                      required
                    >
                      <option value="">Select project rig</option>
                      {effectiveProjectRigOptions.map((rig) => (
                        <option key={rig.id} value={rig.id}>
                          {rig.rigCode}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : (
                  <label className="text-sm text-ink-700">
                    Project rig
                    <input
                      value={
                        selectedRigCode ||
                        (effectiveProject ? "No assigned project rig" : "Select project first")
                      }
                      disabled
                      className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-slate-700"
                    />
                  </label>
                )}
                <label className="text-sm text-ink-700">
                  Severity / priority
                  <select
                    value={form.severity}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        severity: event.target.value as BreakdownFormState["severity"]
                      }))
                    }
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
                  >
                    <option value="LOW">LOW</option>
                    <option value="MEDIUM">MEDIUM</option>
                    <option value="HIGH">HIGH</option>
                    <option value="CRITICAL">CRITICAL</option>
                  </select>
                </label>
                <label className="text-sm text-ink-700 lg:col-span-2">
                  Issue summary
                  <input
                    value={form.title}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, title: event.target.value }))
                    }
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
                    placeholder="e.g. Hydraulic pressure loss while drilling"
                    required
                  />
                </label>
                <label className="text-sm text-ink-700">
                  Estimated downtime (hrs)
                  <input
                    type="number"
                    min="0"
                    step="0.1"
                    value={form.downtimeHours}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        downtimeHours: event.target.value
                      }))
                    }
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
                    placeholder="Optional"
                  />
                </label>
                <label className="text-sm text-ink-700 lg:col-span-4">
                  Problem description (optional)
                  <textarea
                    value={form.description}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, description: event.target.value }))
                    }
                    className="mt-1 min-h-20 w-full rounded-lg border border-slate-200 px-3 py-2"
                    placeholder="Quick details for maintenance handoff"
                  />
                </label>
              </div>
              {effectiveProject && effectiveProjectRigOptions.length === 1 ? (
                <p className="rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-xs text-brand-900">
                  Project rig is fixed to {effectiveProjectRigOptions[0].rigCode}. Continue with issue details.
                </p>
              ) : null}

              <div className="flex flex-wrap items-center gap-2 border-t border-slate-200 pt-3">
                <button
                  type="submit"
                  disabled={submitting || Boolean(formError)}
                  className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
                >
                  {submitting ? "Reporting..." : "Report breakdown"}
                </button>
                {formError ? <p className="text-xs text-amber-800">{formError}</p> : null}
              </div>
            </form>
          </Card>
        </AccessGate>

        <section
          id="breakdown-log-section"
          className={cn(
            focusedSectionId === "breakdown-log-section" &&
              "rounded-2xl ring-2 ring-indigo-100 ring-offset-2 ring-offset-slate-50"
          )}
        >
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">Breakdown Log</h2>
              <p className="text-xs text-slate-600">
                Open {openRecordsCount} • Critical {criticalCount} • Blocked projects{" "}
                {blockedProjectCount} • Downtime {totalDowntime.toFixed(1)} hrs
              </p>
            </div>
            <button
              type="button"
              onClick={() => setLogOpen((current) => !current)}
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
            >
              {logOpen ? "Hide log" : "View log"}
            </button>
          </div>

          {logOpen ? (
            <div className="space-y-3">
              <Card title="Log Filters">
                {isSingleProjectScope ? (
                  <p className="mb-3 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-xs text-brand-900">
                    Project locked to {scopedProject?.name || "selected project"}. Filters below apply only within this project.
                  </p>
                ) : null}
                <div className={`grid gap-3 md:grid-cols-2 ${isSingleProjectScope ? "lg:grid-cols-4" : "lg:grid-cols-5"}`}>
                  {!isSingleProjectScope ? (
                    <label className="text-sm text-ink-700">
                      Project
                      <select
                        value={logFilters.projectId}
                        onChange={(event) =>
                          setLogFilters((current) => ({
                            ...current,
                            projectId: event.target.value
                          }))
                        }
                        className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
                      >
                        <option value="">All projects</option>
                        {projects.map((project) => (
                          <option key={project.id} value={project.id}>
                            {project.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}
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
                      {rigFilterOptions.map((rig) => (
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
                          status: event.target.value as BreakdownLogFilterState["status"]
                        }))
                      }
                      className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
                    >
                      <option value="all">All statuses</option>
                      <option value="OPEN">Open</option>
                      <option value="RESOLVED">Resolved</option>
                    </select>
                  </label>
                  <label className="text-sm text-ink-700">
                    From
                    <input
                      type="date"
                      value={logFilters.from}
                      onChange={(event) =>
                        setLogFilters((current) => ({ ...current, from: event.target.value }))
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
                        setLogFilters((current) => ({ ...current, to: event.target.value }))
                      }
                      className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
                    />
                  </label>
                </div>
              </Card>

              <Card title="Rigs with Breakdown Activity">
                {loading ? (
                  <p className="text-sm text-ink-600">Loading breakdown records...</p>
                ) : rigHistoryRows.length === 0 ? (
                  <p className="text-sm text-slate-600">
                    No breakdown records found for the selected filters.
                  </p>
                ) : (
                  <DataTable
                    columns={[
                      "Rig",
                      "Current breakdown state",
                      "Breakdown cases",
                      "Latest breakdown",
                      "Action"
                    ]}
                    rows={rigHistoryRows.map((entry) => [
                      entry.rigCode,
                      entry.currentStatus ? (
                        <BreakdownStatusChip
                          key={`${entry.rigId}-state`}
                          status={entry.currentStatus}
                        />
                      ) : (
                        "No active case"
                      ),
                      formatNumber(entry.caseCount),
                      toDate(entry.latestBreakdownDate),
                      <button
                        key={`${entry.rigId}-view`}
                        type="button"
                        onClick={() => {
                          openRigDetail(entry.rigId);
                        }}
                        className={`rounded-md border px-2 py-1 text-xs font-semibold ${
                          selectedRigHistoryId === entry.rigId
                            ? "border-brand-300 bg-brand-50 text-brand-800"
                            : "border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
                        }`}
                      >
                        View
                      </button>
                    ])}
                    rowClassNames={rigHistoryRows.map((entry) =>
                      focusedRowId && entry.cases.some((record) => record.id === focusedRowId)
                        ? "bg-indigo-50 ring-1 ring-inset ring-indigo-200"
                        : ""
                    )}
                  />
                )}
              </Card>
            </div>
          ) : null}
        </section>

        <BreakdownsRigDetailModal
          open={rigDetailOpen}
          selectedRig={rigDetailSelectedRig}
          cases={rigDetailCases}
          summary={rigDetailCaseSummary}
          loading={rigDetailLoading}
          error={rigDetailError}
          onClose={closeRigDetail}
          onOpenCase={openCaseFromRigDetail}
        />

        <BreakdownsRecordDetailModal
          open={detailOpen}
          selectedRecord={selectedRecord}
          selectedRecordIsOpen={selectedRecordIsOpen}
          resolvingId={resolvingId}
          linkedMaintenanceRows={linkedMaintenanceRows}
          linkedUsageRows={linkedUsageRows}
          linkedRequisitionRows={linkedRequisitionRows}
          auditRows={auditRows}
          loading={detailLoading}
          error={detailError}
          onClose={closeBreakdownDetail}
          onRequestParts={goToBreakdownPartsRequest}
          onCreatePurchaseRequest={goToBreakdownPurchaseRequest}
          onResolve={(record) => {
            void resolveBreakdown(record);
          }}
        />
      </div>
    </AccessGate>
  );
}
