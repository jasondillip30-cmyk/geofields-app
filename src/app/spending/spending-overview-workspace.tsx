"use client";

import type { ReactNode } from "react";
import { ChevronLeft, ChevronRight, RotateCw } from "lucide-react";

import { AnalyticsEmptyState } from "@/components/layout/analytics-empty-state";
import { DonutStatusChart } from "@/components/charts/donut-status-chart";
import { Card } from "@/components/ui/card";
import { DataTable } from "@/components/ui/table";
import { cn, formatCurrency } from "@/lib/utils";
import type { SpendingSummaryPayload } from "./spending-page-types";
import { scaledBarHeight } from "./spending-page-utils";

type ActiveView = "expenses" | "revenue";
type TimePeriodView = "monthly" | "yearly";

interface SpendingOverviewWorkspaceProps {
  loading: boolean;
  periodLoading: boolean;
  refreshing: boolean;
  summary: SpendingSummaryPayload;
  hasData: boolean;
  isFilteredEmpty: boolean;
  activeHasData: boolean;
  activeView: ActiveView;
  centerTotal: number;
  expenseRows: ReactNode[][];
  incomeRows: ReactNode[][];
  largestExpenseRows: ReactNode[];
  frequentUsageTiles: ReactNode[];
  revenueShare: number;
  expenseShare: number;
  timePeriodView: TimePeriodView;
  selectedPeriodKey: string;
  selectedPeriodLabel: string;
  isPeriodScoped: boolean;
  visibleBuckets: Array<{
    bucketKey: string;
    label: string;
    income: number;
    expenses: number;
  }>;
  periodMaxValue: number;
  canGoPrev: boolean;
  canGoNext: boolean;
  onRefresh: () => void;
  onActiveViewChange: (view: ActiveView) => void;
  onTimePeriodViewChange: (view: TimePeriodView) => void;
  onSelectPeriodBucket: (bucketKey: string) => void;
  onResetPeriodScope: () => void;
  onPrevPeriod: () => void;
  onNextPeriod: () => void;
  onClearFilters: () => void;
  onLast30Days: () => void;
  onLast90Days: () => void;
  onOpenExpenseCategory: (category: string) => void;
  onOpenProfit: () => void;
}

export function SpendingOverviewWorkspace({
  loading,
  periodLoading,
  refreshing,
  summary,
  hasData,
  isFilteredEmpty,
  activeHasData,
  activeView,
  centerTotal,
  expenseRows,
  incomeRows,
  largestExpenseRows,
  frequentUsageTiles,
  revenueShare,
  expenseShare,
  timePeriodView,
  selectedPeriodKey,
  selectedPeriodLabel,
  isPeriodScoped,
  visibleBuckets,
  periodMaxValue,
  canGoPrev,
  canGoNext,
  onRefresh,
  onActiveViewChange,
  onTimePeriodViewChange,
  onSelectPeriodBucket,
  onResetPeriodScope,
  onPrevPeriod,
  onNextPeriod,
  onClearFilters,
  onLast30Days,
  onLast90Days,
  onOpenExpenseCategory,
  onOpenProfit
}: SpendingOverviewWorkspaceProps) {
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
                  onTimePeriodViewChange(event.target.value as TimePeriodView);
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
                disabled={!canGoPrev}
                className={cn(
                  "inline-flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 transition-colors",
                  canGoPrev ? "hover:bg-slate-50" : "cursor-not-allowed opacity-45"
                )}
                aria-label="Previous period buckets"
              >
                <ChevronLeft size={14} />
              </button>
              <button
                type="button"
                onClick={onNextPeriod}
                disabled={!canGoNext}
                className={cn(
                  "inline-flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 transition-colors",
                  canGoNext ? "hover:bg-slate-50" : "cursor-not-allowed opacity-45"
                )}
                aria-label="Next period buckets"
              >
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
          {periodLoading ? (
            <p className="text-sm text-slate-600">Loading time period comparison...</p>
          ) : visibleBuckets.length === 0 ? (
            <p className="text-sm text-slate-600">No time period data for this scope.</p>
          ) : (
            <>
              <div className="h-28 rounded-xl border border-slate-100 bg-slate-50/45 px-3 py-2">
                <div className="flex h-full items-end justify-between gap-2">
                  {visibleBuckets.map((bucket) => (
                    <button
                      key={bucket.bucketKey}
                      type="button"
                      onClick={() => onSelectPeriodBucket(bucket.bucketKey)}
                      aria-pressed={selectedPeriodKey === bucket.bucketKey}
                      className={cn(
                        "flex min-w-0 flex-1 flex-col items-center gap-2 rounded-lg px-1 py-1 transition-all duration-200 ease-out",
                        selectedPeriodKey === bucket.bucketKey
                          ? "scale-[1.02] bg-brand-50/55 ring-1 ring-brand-300"
                          : "hover:bg-slate-100/70"
                      )}
                    >
                      <div className="flex h-20 items-end gap-1.5">
                        <div
                          className={cn(
                            "w-4 rounded transition-all duration-200",
                            selectedPeriodKey === bucket.bucketKey ? "bg-emerald-600" : "bg-emerald-700/35"
                          )}
                          style={{
                            height: `${scaledBarHeight(bucket.income, periodMaxValue)}px`
                          }}
                          title={`Revenue: ${formatCurrency(bucket.income)}`}
                        />
                        <div
                          className={cn(
                            "w-4 rounded transition-all duration-200",
                            selectedPeriodKey === bucket.bucketKey ? "bg-lime-300" : "bg-lime-200"
                          )}
                          style={{
                            height: `${scaledBarHeight(bucket.expenses, periodMaxValue)}px`
                          }}
                          title={`Expenses: ${formatCurrency(bucket.expenses)}`}
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
                  <span className="h-2.5 w-2.5 rounded bg-emerald-700/35" />
                  Revenue
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="h-2.5 w-2.5 rounded bg-lime-200" />
                  Expenses
                </span>
              </div>
            </>
          )}
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[2.2fr_1fr]">
        <Card
          title="Category breakdown"
          action={
            <button type="button" onClick={onRefresh} className="gf-btn-subtle inline-flex items-center gap-1">
              <RotateCw size={13} className={refreshing ? "animate-spin" : ""} />
              Refresh
            </button>
          }
        >
          <div className="mb-4 flex items-center gap-2 border-b border-slate-100 pb-3">
            <button
              type="button"
              onClick={() => onActiveViewChange("expenses")}
              className={cn(
                "rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors",
                activeView === "expenses"
                  ? "border border-slate-300 bg-white text-ink-900"
                  : "text-slate-600 hover:bg-slate-100 hover:text-ink-900"
              )}
            >
              Expenses
            </button>
            <button
              type="button"
              onClick={() => onActiveViewChange("revenue")}
              className={cn(
                "rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors",
                activeView === "revenue"
                  ? "border border-slate-300 bg-white text-ink-900"
                  : "text-slate-600 hover:bg-slate-100 hover:text-ink-900"
              )}
            >
              Revenue
            </button>
          </div>

          {loading ? (
            <p className="text-sm text-slate-600">Loading breakdown...</p>
          ) : !hasData ? (
            <AnalyticsEmptyState
              variant={isFilteredEmpty ? "filtered-empty" : "no-data"}
              moduleHint="Create drilling reports and recognized spend records to populate Project Operations."
              onClearFilters={onClearFilters}
              onLast30Days={onLast30Days}
              onLast90Days={onLast90Days}
            />
          ) : !activeHasData ? (
            <p className="text-sm text-slate-600">
              {activeView === "expenses"
                ? "No recognized expense categories for this scope."
                : "No hole-level revenue data for this scope."}
            </p>
          ) : (
            <>
              <div className="relative">
                {activeView === "expenses" ? (
                  <DonutStatusChart
                    data={summary.expenseByCategory}
                    nameKey="category"
                    valueKey="total"
                    onElementClick={(payload) => onOpenExpenseCategory(payload.category)}
                    clickHint="Click category to open expense details"
                  />
                ) : (
                  <DonutStatusChart data={summary.incomeByHole} nameKey="holeNumber" valueKey="total" />
                )}
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                  <p className="text-3xl font-semibold tracking-tight text-ink-900">{formatCurrency(centerTotal)}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    {activeView === "expenses" ? "Amount spent" : "Revenue earned"}
                  </p>
                </div>
              </div>

              <DataTable
                className="mt-3"
                columns={
                  activeView === "expenses"
                    ? ["Category", "Amount spent", "% of expenses"]
                    : ["Hole", "Amount", "% of revenue"]
                }
                rows={activeView === "expenses" ? expenseRows : incomeRows}
                onRowClick={
                  activeView === "expenses"
                    ? (rowIndex) => {
                        const category = summary.expenseByCategory[rowIndex]?.category || "";
                        onOpenExpenseCategory(category);
                      }
                    : undefined
                }
                compact
              />
            </>
          )}
        </Card>

        <div className="space-y-4">
          <Card title="Cash flow summary" subtitle="Revenue, expenses, and profit.">
            <div className="space-y-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Revenue</p>
                <div className="mt-1 h-3 rounded-full bg-slate-100">
                  <div className="h-3 rounded-full bg-emerald-600" style={{ width: `${revenueShare}%` }} />
                </div>
                <p className="mt-1 text-sm font-medium text-ink-900">{formatCurrency(summary.totals.income)}</p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Expenses</p>
                <div className="mt-1 h-3 rounded-full bg-slate-100">
                  <div className="h-3 rounded-full bg-amber-500" style={{ width: `${expenseShare}%` }} />
                </div>
                <p className="mt-1 text-sm font-medium text-ink-900">{formatCurrency(summary.totals.expenses)}</p>
              </div>
              <button
                type="button"
                onClick={onOpenProfit}
                className="w-full rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-left transition-colors hover:bg-brand-100/70"
              >
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Profit</p>
                <p className="mt-1 text-base font-semibold text-ink-900">
                  {formatCurrency(summary.totals.netCashFlow)}
                </p>
              </button>
            </div>
          </Card>

          {activeView === "expenses" ? (
            <>
              <Card title="Largest expenses">
                {loading ? (
                  <p className="text-sm text-slate-600">Loading largest expenses...</p>
                ) : summary.largestExpenses.length === 0 ? (
                  <p className="text-sm text-slate-600">No recognized expenses in this scope.</p>
                ) : (
                  <div className="space-y-3">{largestExpenseRows}</div>
                )}
              </Card>

              <Card title="Most frequent usage">
                {loading ? (
                  <p className="text-sm text-slate-600">Loading usage frequency...</p>
                ) : summary.mostFrequentUsage.length === 0 ? (
                  <p className="text-sm text-slate-600">No usage recorded in this scope.</p>
                ) : (
                  <div className="grid grid-cols-3 gap-2">{frequentUsageTiles}</div>
                )}
              </Card>
            </>
          ) : (
            <Card title="Project rates">
              {loading ? (
                <p className="text-sm text-slate-600">Loading project rates...</p>
              ) : summary.revenueRateCard.mode === "NOT_CONFIGURED" ||
                summary.revenueRateCard.rows.length === 0 ? (
                <p className="text-sm text-slate-600">
                  {summary.revenueRateCard.message || "Rates not configured for this project."}
                </p>
              ) : summary.revenueRateCard.mode === "STAGED_PER_METER" ? (
                <DataTable
                  compact
                  columns={["Stage", "Range", "Rate"]}
                  rows={summary.revenueRateCard.rows.map((row) => [
                    row.label,
                    row.rangeLabel || "-",
                    `${formatCurrency(row.rate)}${row.rateSuffix}`
                  ])}
                />
              ) : (
                <DataTable
                  compact
                  columns={["Rate type", "Value"]}
                  rows={summary.revenueRateCard.rows.map((row) => [
                    row.label,
                    `${formatCurrency(row.rate)}${row.rateSuffix}`
                  ])}
                />
              )}
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
