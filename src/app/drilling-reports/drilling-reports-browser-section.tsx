"use client";

import { Card } from "@/components/ui/card";
import { DataTable } from "@/components/ui/table";
import type {
  DrillOperationalKpiSummary,
  DrillReportDirectCostSummary
} from "@/lib/drilling-direct-cost-summary";
import { cn, formatCurrency, formatNumber } from "@/lib/utils";
import {
  DetailRow,
  formatCrewSummary,
  formatDateTime,
  formatDelayReasonLabel,
  toIsoDate
} from "./drilling-reports-page-utils";
import type { DrillReportRecord } from "./drilling-reports-page-types";

interface DrillingReportsBrowserSectionProps {
  focusedSectionId: string | null;
  focusedRowId: string | null;
  selectedProjectName: string | null;
  referencesLoading: boolean;
  reportsLoading: boolean;
  reports: DrillReportRecord[];
  selectedReportId: string | null;
  onSelectReport: (reportId: string) => void;
  canCreateReport: boolean;
  onCreateReport: () => void;
  selectedReport: DrillReportRecord | null;
  selectedReportDirectCostSummary: DrillReportDirectCostSummary | null;
  selectedReportOperationalKpis: DrillOperationalKpiSummary | null;
  buildInventoryMovementHref: (movementId: string) => string;
  canEditReport: (report: DrillReportRecord) => boolean;
  onEditReport: (report: DrillReportRecord) => void;
}

export function DrillingReportsBrowserSection({
  focusedSectionId,
  focusedRowId,
  selectedProjectName,
  referencesLoading,
  reportsLoading,
  reports,
  selectedReportId,
  onSelectReport,
  canCreateReport,
  onCreateReport,
  selectedReport,
  selectedReportDirectCostSummary,
  selectedReportOperationalKpis,
  buildInventoryMovementHref,
  canEditReport,
  onEditReport
}: DrillingReportsBrowserSectionProps) {
  return (
    <>
      <div
        id="drilling-reports-table-section"
        className={cn(
          focusedSectionId === "drilling-reports-table-section" &&
            "rounded-2xl ring-2 ring-indigo-100 ring-offset-2 ring-offset-slate-50"
        )}
      >
        <Card
          title="Drilling Reports"
          subtitle={selectedProjectName ? `Project: ${selectedProjectName}` : "Select a project"}
          className="min-h-[420px]"
        >
          {referencesLoading || reportsLoading ? (
            <p className="text-sm text-ink-600">Loading drilling reports workspace...</p>
          ) : reports.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center">
              <p className="text-sm font-medium text-ink-800">No drilling reports for this project</p>
              <p className="mt-1 text-xs text-ink-600">
                Create your first report to start tracking drilling activity.
              </p>
              {canCreateReport && (
                <button
                  type="button"
                  onClick={onCreateReport}
                  className="mt-3 rounded-lg bg-brand-600 px-3 py-2 text-xs font-semibold text-white hover:bg-brand-700"
                >
                  Record first report
                </button>
              )}
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-slate-200">
              <div className="max-h-[560px] overflow-auto">
                <DataTable
                  columns={["Date", "Hole Number", "Rig", "Meters", "Work Hrs", "Delay Hrs", "Rig Moves", "Crew"]}
                  rows={reports.map((report) => [
                    toIsoDate(report.date),
                    report.holeNumber,
                    report.rig.rigCode,
                    <span key={`${report.id}-meters`} className="inline-block w-full text-right">
                      {formatNumber(report.totalMetersDrilled)}
                    </span>,
                    <span key={`${report.id}-work`} className="inline-block w-full text-right">
                      {report.workHours.toFixed(1)}
                    </span>,
                    <span key={`${report.id}-delay`} className="inline-block w-full text-right">
                      {report.delayHours.toFixed(1)}
                    </span>,
                    <span key={`${report.id}-moves`} className="inline-block w-full text-right">
                      {report.rigMoves}
                    </span>,
                    formatCrewSummary(report)
                  ])}
                  rowIds={reports.map((report) => `ai-focus-${report.id}`)}
                  rowClassNames={reports.map((report) =>
                    focusedRowId === report.id
                      ? "bg-indigo-50 ring-1 ring-inset ring-indigo-200"
                      : report.id === selectedReportId
                        ? "bg-brand-50"
                        : ""
                  )}
                  onRowClick={(rowIndex) => {
                    const report = reports[rowIndex];
                    if (report) {
                      onSelectReport(report.id);
                    }
                  }}
                />
              </div>
            </div>
          )}
        </Card>
      </div>

      <div
        id="drilling-report-detail-section"
        className={cn(
          focusedSectionId === "drilling-report-detail-section" &&
            "rounded-2xl ring-2 ring-indigo-100 ring-offset-2 ring-offset-slate-50"
        )}
      >
        <Card
          title="Report details"
          subtitle={selectedReport ? `Hole ${selectedReport.holeNumber}` : "Select a report from the table"}
          className="min-h-[420px] xl:sticky xl:top-24"
        >
          {!selectedReport ? (
            <p className="text-sm text-ink-600">Select a report to view daily activity and usage details.</p>
          ) : (
            <div className="space-y-4 text-sm">
              <div className="grid gap-2">
                <DetailRow label="Date" value={toIsoDate(selectedReport.date)} />
                <DetailRow label="Client" value={selectedReport.client.name} />
                <DetailRow label="Project" value={selectedReport.project.name} />
                <DetailRow label="Rig" value={selectedReport.rig.rigCode} />
                <DetailRow label="Hole" value={selectedReport.holeNumber} />
                <DetailRow label="Area" value={selectedReport.areaLocation} />
                <DetailRow label="Start depth" value={selectedReport.fromMeter.toFixed(1)} />
                <DetailRow label="End depth" value={selectedReport.toMeter.toFixed(1)} />
                <DetailRow label="Meters drilled today" value={formatNumber(selectedReport.totalMetersDrilled)} />
                <DetailRow label="Work hours" value={selectedReport.workHours.toFixed(1)} />
                <DetailRow label="Rig moves" value={String(selectedReport.rigMoves)} />
                <DetailRow label="Standby hours" value={selectedReport.standbyHours.toFixed(1)} />
                <DetailRow label="Delay hours" value={selectedReport.delayHours.toFixed(1)} />
                <DetailRow
                  label="Delay reason"
                  value={formatDelayReasonLabel(selectedReport.delayReasonCategory)}
                />
                <DetailRow label="Delay note" value={selectedReport.delayReasonNote || "-"} />
                <DetailRow
                  label="Continuity override reason"
                  value={selectedReport.holeContinuityOverrideReason || "-"}
                />
                <DetailRow label="Lead operator" value={selectedReport.leadOperatorName || "-"} />
                <DetailRow
                  label="Assistants"
                  value={String(Math.max(0, Math.round(Number(selectedReport.assistantCount || 0))))}
                />
                <DetailRow label="Crew" value={formatCrewSummary(selectedReport)} />
                <DetailRow label="Revenue" value={formatCurrency(selectedReport.billableAmount)} />
                <DetailRow label="Comments" value={selectedReport.comments || "-"} />
                <DetailRow label="Recorded by" value={selectedReport.submittedBy?.fullName || "-"} />
                <DetailRow
                  label="Recorded at"
                  value={formatDateTime(selectedReport.submittedAt || selectedReport.createdAt)}
                />
                <DetailRow label="Created At" value={formatDateTime(selectedReport.createdAt)} />
                <DetailRow label="Updated At" value={formatDateTime(selectedReport.updatedAt)} />
              </div>

              {selectedReportDirectCostSummary ? (
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Basic financial summary
                  </p>
                  <div className="mt-2 grid gap-1">
                    <DetailRow label="Revenue" value={formatCurrency(selectedReportDirectCostSummary.revenue)} />
                    <DetailRow
                      label="Consumables cost used"
                      value={formatCurrency(selectedReportDirectCostSummary.consumablesCostUsed)}
                    />
                    <DetailRow
                      label="Simple result"
                      value={formatCurrency(selectedReportDirectCostSummary.simpleResult)}
                    />
                  </div>
                  <p className="mt-2 text-xs text-slate-600">
                    Direct-cost only: includes drilling revenue and consumables used. Other project costs are not included.
                  </p>
                </div>
              ) : null}

              {selectedReportOperationalKpis ? (
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Operational KPI view
                  </p>
                  <div className="mt-2 grid gap-1">
                    <DetailRow label="Meters drilled" value={formatNumber(selectedReportOperationalKpis.metersDrilled)} />
                    <DetailRow label="Work hours" value={formatNumber(selectedReportOperationalKpis.workHours)} />
                    <DetailRow
                      label="Meters per hour"
                      value={
                        selectedReportOperationalKpis.metersPerHour === null
                          ? "—"
                          : formatNumber(selectedReportOperationalKpis.metersPerHour)
                      }
                    />
                    <DetailRow
                      label="Consumables cost used"
                      value={formatCurrency(selectedReportOperationalKpis.consumablesCostUsed)}
                    />
                    <DetailRow
                      label="Consumables cost per meter"
                      value={
                        selectedReportOperationalKpis.consumablesCostPerMeter === null
                          ? "—"
                          : formatCurrency(selectedReportOperationalKpis.consumablesCostPerMeter)
                      }
                    />
                  </div>
                  <p className="mt-2 text-xs text-slate-600">
                    Operational KPIs only: based on drilling activity and consumables used. This is not full project margin.
                  </p>
                </div>
              ) : null}

              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Consumables used
                </p>
                {(selectedReport.inventoryMovements || []).length === 0 ? (
                  <p className="mt-1 text-xs text-slate-600">
                    No consumables were recorded on this report.
                  </p>
                ) : (
                  <div className="mt-2 space-y-1.5">
                    {(selectedReport.inventoryMovements || []).slice(0, 8).map((movementRow) => (
                      <div
                        key={movementRow.id}
                        className="grid gap-1 rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-700 sm:grid-cols-[minmax(0,1fr)_auto_auto]"
                      >
                        <p className="truncate">
                          {formatNumber(movementRow.quantity)} x {movementRow.item?.name || "Item"}
                        </p>
                        <p className="font-medium">{formatCurrency(movementRow.totalCost || 0)}</p>
                        {movementRow.id ? (
                          <a
                            href={buildInventoryMovementHref(movementRow.id)}
                            className="text-brand-700 underline"
                          >
                            Movement
                          </a>
                        ) : (
                          <span className="text-slate-500">—</span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex flex-wrap gap-2 border-t border-slate-200 pt-3">
                {canEditReport(selectedReport) && (
                  <button
                    type="button"
                    onClick={() => onEditReport(selectedReport)}
                    className="rounded-md border border-slate-300 px-3 py-1.5 text-xs text-ink-700 hover:bg-slate-50"
                  >
                    Edit Report
                  </button>
                )}
              </div>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
