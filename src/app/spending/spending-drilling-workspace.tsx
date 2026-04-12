"use client";

import type { ReactNode } from "react";
import { Plus, RotateCw } from "lucide-react";

import { DonutStatusChart } from "@/components/charts/donut-status-chart";
import { Card } from "@/components/ui/card";
import { DataTable } from "@/components/ui/table";
import { formatCurrency, formatNumber } from "@/lib/utils";
import type { SpendingDrillingSummaryPayload } from "./spending-page-types";

interface SpendingDrillingWorkspaceProps {
  canCreateReport: boolean;
  showFinanceMetrics: boolean;
  drillingLoading: boolean;
  drillingRefreshing: boolean;
  drillingSummary: SpendingDrillingSummaryPayload;
  hasDrillingData: boolean;
  drillingRows: ReactNode[][];
  onRefresh: () => void;
  onCreateReport: () => void;
  onOpenReportsList: () => void;
}

export function SpendingDrillingWorkspace({
  canCreateReport,
  showFinanceMetrics,
  drillingLoading,
  drillingRefreshing,
  drillingSummary,
  hasDrillingData,
  drillingRows,
  onRefresh,
  onCreateReport,
  onOpenReportsList
}: SpendingDrillingWorkspaceProps) {
  return (
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

            <DataTable className="mt-3" columns={["Hole", "Meters drilled", "% of meters", "Stage"]} rows={drillingRows} compact />
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
  );
}
