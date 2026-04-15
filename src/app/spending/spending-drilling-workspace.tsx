"use client";

import type { ReactNode } from "react";
import { ChevronLeft, ChevronRight, Plus, RotateCw } from "lucide-react";

import { DonutStatusChart } from "@/components/charts/donut-status-chart";
import { Card } from "@/components/ui/card";
import { DataTable } from "@/components/ui/table";
import { cn, formatCurrency, formatNumber } from "@/lib/utils";
import type {
  SpendingDrillingPeriodBucket,
  SpendingDrillingSummaryPayload
} from "./spending-page-types";
import { scaledBarHeight } from "./spending-page-utils";

interface SpendingDrillingWorkspaceProps {
  canCreateReport: boolean;
  showFinanceMetrics: boolean;
  drillingLoading: boolean;
  periodLoading: boolean;
  drillingRefreshing: boolean;
  timePeriodView: "monthly" | "yearly";
  selectedPeriodKey: string;
  selectedPeriodLabel: string;
  isPeriodScoped: boolean;
  visiblePeriodBuckets: SpendingDrillingPeriodBucket[];
  periodMaxMeters: number;
  canGoPrevPeriod: boolean;
  canGoNextPeriod: boolean;
  drillingSummary: SpendingDrillingSummaryPayload;
  hasDrillingData: boolean;
  drillingRows: ReactNode[][];
  onRefresh: () => void;
  onTimePeriodViewChange: (view: "monthly" | "yearly") => void;
  onSelectPeriodBucket: (bucketKey: string) => void;
  onResetPeriodScope: () => void;
  onPrevPeriod: () => void;
  onNextPeriod: () => void;
  onCreateReport: () => void;
  onOpenReportsList: () => void;
}

export function SpendingDrillingWorkspace({
  canCreateReport,
  showFinanceMetrics,
  drillingLoading,
  periodLoading,
  drillingRefreshing,
  timePeriodView,
  selectedPeriodKey,
  selectedPeriodLabel,
  isPeriodScoped,
  visiblePeriodBuckets,
  periodMaxMeters,
  canGoPrevPeriod,
  canGoNextPeriod,
  drillingSummary,
  hasDrillingData,
  drillingRows,
  onRefresh,
  onTimePeriodViewChange,
  onSelectPeriodBucket,
  onResetPeriodScope,
  onPrevPeriod,
  onNextPeriod,
  onCreateReport,
  onOpenReportsList
}: SpendingDrillingWorkspaceProps) {
  return (
    <>
      <Card>
        <div className="space-y-4">
          <div className="border-b border-slate-100 pb-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-500">TIME PERIOD</p>
          </div>
          <div className="flex items-center justify-between gap-3">
            <div className="inline-flex items-center rounded-full border border-slate-300 bg-white px-2 py-1">
              <select
                value={timePeriodView}
                onChange={(event) => {
                  onTimePeriodViewChange(event.target.value as "monthly" | "yearly");
                }}
                className="rounded-full border-none bg-transparent px-2 py-0.5 text-base text-ink-900 focus:outline-none"
              >
                <option value="monthly">Monthly</option>
                <option value="yearly">Yearly</option>
              </select>
            </div>
            <div className="flex items-center gap-2">
              {isPeriodScoped ? (
                <button
                  type="button"
                  onClick={onResetPeriodScope}
                  className="inline-flex items-center rounded-full border border-brand-300 bg-brand-50 px-3 py-1.5 text-xs font-semibold text-brand-900 transition-colors hover:bg-brand-100/70"
                >
                  Reset scope ({selectedPeriodLabel})
                </button>
              ) : null}
              <button
                type="button"
                onClick={onPrevPeriod}
                disabled={!canGoPrevPeriod}
                className={cn(
                  "inline-flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 transition-colors",
                  canGoPrevPeriod ? "hover:bg-slate-50" : "cursor-not-allowed opacity-45"
                )}
                aria-label="Previous period buckets"
              >
                <ChevronLeft size={14} />
              </button>
              <button
                type="button"
                onClick={onNextPeriod}
                disabled={!canGoNextPeriod}
                className={cn(
                  "inline-flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 transition-colors",
                  canGoNextPeriod ? "hover:bg-slate-50" : "cursor-not-allowed opacity-45"
                )}
                aria-label="Next period buckets"
              >
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
          {periodLoading ? (
            <p className="text-sm text-slate-600">Loading drilling time period summary...</p>
          ) : visiblePeriodBuckets.length === 0 ? (
            <p className="text-sm text-slate-600">No drilling time period data for this scope.</p>
          ) : (
            <>
              <div className="h-28 rounded-xl border border-slate-100 bg-slate-50/45 px-3 py-2">
                <div className="flex h-full items-end justify-between gap-2">
                  {visiblePeriodBuckets.map((bucket) => (
                    <button
                      key={bucket.bucketKey}
                      type="button"
                      onClick={() => onSelectPeriodBucket(bucket.bucketKey)}
                      aria-pressed={selectedPeriodKey === bucket.bucketKey}
                      className={cn(
                        "flex min-w-0 flex-1 flex-col items-center gap-1.5 rounded-lg px-1 py-1 transition-all duration-200 ease-out",
                        selectedPeriodKey === bucket.bucketKey
                          ? "scale-[1.02] bg-brand-50/55 ring-1 ring-brand-300"
                          : "hover:bg-slate-100/70"
                      )}
                    >
                      <div className="flex h-20 items-end gap-1.5">
                        <div
                          className={cn(
                            "w-5 rounded transition-all duration-200",
                            selectedPeriodKey === bucket.bucketKey ? "bg-brand-500" : "bg-brand-500/35"
                          )}
                          style={{
                            height: `${scaledBarHeight(bucket.totalMeters, periodMaxMeters)}px`
                          }}
                          title={`Meters: ${formatNumber(bucket.totalMeters)}`}
                        />
                      </div>
                      <p
                        className={cn(
                          "truncate text-xs transition-colors duration-200",
                          selectedPeriodKey === bucket.bucketKey ? "font-semibold text-ink-900" : "text-slate-500"
                        )}
                      >
                        {bucket.label}
                      </p>
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-4 text-xs text-slate-500">
                <span className="inline-flex items-center gap-1">
                  <span className="h-2.5 w-2.5 rounded bg-brand-500/45" />
                  Meters drilled
                </span>
              </div>
            </>
          )}
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[2.2fr_1fr]">
        <Card
          title="Drilling reports by hole"
          subtitle="Meters drilled in this project scope."
          action={
            <div className="flex items-center gap-2">
              <button type="button" onClick={onRefresh} className="gf-btn-subtle inline-flex items-center gap-1">
                <RotateCw size={13} className={drillingRefreshing ? "animate-spin" : ""} />
                Refresh
              </button>
              {canCreateReport ? (
                <button
                  type="button"
                  onClick={onCreateReport}
                  className="gf-btn-primary inline-flex items-center gap-1 px-3 py-1.5 text-xs"
                >
                  <Plus size={13} />
                  New report
                </button>
              ) : null}
            </div>
          }
        >
          {drillingLoading ? (
            <p className="text-sm text-slate-600">Loading drilling summary...</p>
          ) : !hasDrillingData ? (
            <p className="text-sm text-slate-600">No drilling report data in this scope yet.</p>
          ) : (
            <>
              <div className="relative">
                <DonutStatusChart
                  data={drillingSummary.metersByHole}
                  nameKey="holeNumber"
                  valueKey="totalMeters"
                />
                <button
                  type="button"
                  onClick={onOpenReportsList}
                  className="absolute left-1/2 top-1/2 w-44 -translate-x-1/2 -translate-y-1/2 rounded-full px-5 py-5 text-center transition-transform duration-200 hover:scale-[1.04] focus:scale-[1.04] focus:outline-none"
                  aria-label="Open drilling reports list"
                  title="Open drilling reports"
                >
                  <p className="text-3xl font-semibold tracking-tight text-ink-900">
                    {drillingSummary.summary.totalMeters.toLocaleString(undefined, {
                      maximumFractionDigits: 2
                    })}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">Meters drilled</p>
                </button>
              </div>

              <DataTable
                className="mt-3"
                columns={["Hole", "Meters drilled", "% of meters", "Stage"]}
                rows={drillingRows}
                compact
              />
            </>
          )}
        </Card>

        <div className="space-y-4">
          {showFinanceMetrics ? (
            <Card title="Total cost per meter">
              <p className="text-2xl font-semibold tracking-tight text-ink-900">
                {drillingSummary.summary.totalCostPerMeter === null
                  ? "—"
                  : formatCurrency(drillingSummary.summary.totalCostPerMeter)}
              </p>
              <p className="mt-1 text-xs text-slate-500">Based on project expenses and total meters in scope.</p>
            </Card>
          ) : null}

          <Card title="Work hours">
            <p className="text-2xl font-semibold tracking-tight text-ink-900">
              {drillingSummary.summary.totalWorkHours.toLocaleString(undefined, {
                maximumFractionDigits: 2
              })}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Average work hours:{" "}
              {drillingSummary.summary.totalReports > 0
                ? formatNumber(drillingSummary.summary.totalWorkHours / drillingSummary.summary.totalReports)
                : "—"}
            </p>
          </Card>

          <Card title="Total reports">
            <p className="text-2xl font-semibold tracking-tight text-ink-900">
              {drillingSummary.summary.totalReports.toLocaleString()}
            </p>
            <button
              type="button"
              onClick={onOpenReportsList}
              className="mt-3 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-xs font-medium text-brand-800 transition-colors hover:bg-brand-100/70"
            >
              Open report list
            </button>
          </Card>
        </div>
      </div>
    </>
  );
}
