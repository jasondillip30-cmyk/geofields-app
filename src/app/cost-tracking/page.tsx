"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { RotateCw } from "lucide-react";

import { AccessGate } from "@/components/layout/access-gate";
import { useAnalyticsFilters } from "@/components/layout/analytics-filters-provider";
import { FilterScopeBanner, hasActiveScopeFilters } from "@/components/layout/filter-scope-banner";
import { BarCategoryChart } from "@/components/charts/bar-category-chart";
import { DonutStatusChart } from "@/components/charts/donut-status-chart";
import { LineTrendChart } from "@/components/charts/line-trend-chart";
import { Card, MetricCard } from "@/components/ui/card";
import { SectionHeader } from "@/components/ui/section-header";
import { DataTable } from "@/components/ui/table";
import type { BudgetVsActualSummaryResponse } from "@/lib/budget-vs-actual";
import type { CostTrackingSummaryPayload } from "@/lib/cost-tracking";
import { formatCurrency, formatPercent } from "@/lib/utils";

const UNASSIGNED_RIG_ID = "__unassigned_rig__";
const UNASSIGNED_PROJECT_ID = "__unassigned_project__";
const COST_TRACKING_SECTIONS = [
  { id: "overview", label: "Overview" },
  { id: "cost-by-rig", label: "Cost by Rig" },
  { id: "cost-by-project", label: "Cost by Project" },
  { id: "maintenance-cost", label: "Maintenance Cost" },
  { id: "spending-breakdown", label: "Spending Breakdown / Trend" }
] as const;
const COST_TRACKING_DONUT_PALETTE = ["#1e63f5", "#0f766e", "#0ea5e9", "#6366f1", "#14b8a6", "#64748b", "#94a3b8"];
const emptyBudgetAlerts = {
  overspentCount: 0,
  criticalCount: 0,
  watchCount: 0,
  noBudgetCount: 0
};

const emptySummary: CostTrackingSummaryPayload = {
  filters: {
    clientId: "all",
    rigId: "all",
    from: null,
    to: null
  },
  overview: {
    totalApprovedExpenses: 0,
    totalMaintenanceRelatedCost: 0,
    totalInventoryRelatedCost: 0,
    totalNonInventoryExpenseCost: 0,
    highestCostRig: null,
    highestCostProject: null
  },
  trendGranularity: "week",
  costByRig: [],
  costByProject: [],
  costByMaintenanceRequest: [],
  spendingCategoryBreakdown: [],
  costTrend: []
};

export default function CostTrackingPage() {
  const { filters } = useAnalyticsFilters();
  const [summary, setSummary] = useState<CostTrackingSummaryPayload>(emptySummary);
  const [budgetAlerts, setBudgetAlerts] = useState(emptyBudgetAlerts);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const isScoped = hasActiveScopeFilters(filters);

  const loadCostSummary = useCallback(
    async (silent = false) => {
      if (!silent) {
        setLoading(true);
      } else {
        setRefreshing(true);
      }
      try {
        const params = new URLSearchParams();
        if (filters.from) params.set("from", filters.from);
        if (filters.to) params.set("to", filters.to);
        if (filters.clientId !== "all") params.set("clientId", filters.clientId);
        if (filters.rigId !== "all") params.set("rigId", filters.rigId);

        const query = params.toString();
        const response = await fetch(`/api/cost-tracking/summary${query ? `?${query}` : ""}`, {
          cache: "no-store"
        });
        const payload = response.ok ? ((await response.json()) as CostTrackingSummaryPayload) : emptySummary;
        setSummary(payload || emptySummary);
      } catch {
        setSummary(emptySummary);
      } finally {
        if (!silent) {
          setLoading(false);
        } else {
          setRefreshing(false);
        }
      }
    },
    [filters.clientId, filters.from, filters.rigId, filters.to]
  );

  const loadBudgetAlerts = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (filters.from) params.set("from", filters.from);
      if (filters.to) params.set("to", filters.to);
      if (filters.clientId !== "all") params.set("clientId", filters.clientId);
      if (filters.rigId !== "all") params.set("rigId", filters.rigId);

      const query = params.toString();
      const response = await fetch(`/api/budgets/summary${query ? `?${query}` : ""}`, {
        cache: "no-store"
      });
      const payload = response.ok
        ? ((await response.json()) as BudgetVsActualSummaryResponse)
        : null;
      setBudgetAlerts(resolveBudgetAlertCounts(payload));
    } catch {
      setBudgetAlerts(emptyBudgetAlerts);
    }
  }, [filters.clientId, filters.from, filters.rigId, filters.to]);

  useEffect(() => {
    void Promise.all([loadCostSummary(), loadBudgetAlerts()]);
  }, [loadBudgetAlerts, loadCostSummary]);

  useEffect(() => {
    const interval = setInterval(() => {
      void Promise.all([loadCostSummary(true), loadBudgetAlerts()]);
    }, 10000);

    return () => clearInterval(interval);
  }, [loadBudgetAlerts, loadCostSummary]);

  const rigRows = useMemo(
    () =>
      summary.costByRig.map((entry) => [
        <div key={`${entry.id}-name`} className="flex items-center gap-2">
          <span className="font-medium text-ink-900">{entry.name}</span>
          {entry.id === UNASSIGNED_RIG_ID ? (
            <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800">
              Needs linkage
            </span>
          ) : null}
        </div>,
        formatCurrency(entry.totalApprovedCost),
        formatCurrency(entry.maintenanceCost),
        formatCurrency(entry.inventoryPartsCost),
        formatCurrency(entry.otherExpenseCost),
        formatPercent(entry.percentOfTotalSpend)
      ]),
    [summary.costByRig]
  );

  const projectRows = useMemo(
    () =>
      summary.costByProject.map((entry) => [
        <div key={`${entry.id}-name`} className="flex items-center gap-2">
          <span className="font-medium text-ink-900">{entry.name}</span>
          {entry.id === UNASSIGNED_PROJECT_ID ? (
            <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800">
              Needs linkage
            </span>
          ) : null}
        </div>,
        formatCurrency(entry.totalApprovedCost),
        formatCurrency(entry.maintenanceLinkedCost),
        formatCurrency(entry.inventoryPurchaseCost),
        formatCurrency(entry.expenseOnlyCost),
        formatPercent(entry.percentOfTotalSpend)
      ]),
    [summary.costByProject]
  );

  const maintenanceRows = useMemo(
    () =>
      summary.costByMaintenanceRequest.map((entry) => [
        <span key={`${entry.id}-ref`} className="font-medium text-ink-900">
          {entry.reference}
        </span>,
        entry.rigName,
        formatCurrency(entry.totalLinkedCost),
        `${entry.linkedPurchaseCount}`,
        entry.urgency || "-",
        entry.status || "-"
      ]),
    [summary.costByMaintenanceRequest]
  );

  const topCostShare = useMemo(() => {
    const leader = summary.costByRig[0];
    if (!leader || summary.overview.totalApprovedExpenses <= 0) {
      return 0;
    }
    return (leader.totalApprovedCost / summary.overview.totalApprovedExpenses) * 100;
  }, [summary.costByRig, summary.overview.totalApprovedExpenses]);

  const largestCostCategory = useMemo(
    () => summary.spendingCategoryBreakdown.find((entry) => entry.totalCost > 0) || null,
    [summary.spendingCategoryBreakdown]
  );

  const unassignedRigSpend = useMemo(
    () => summary.costByRig.find((entry) => entry.id === UNASSIGNED_RIG_ID)?.totalApprovedCost || 0,
    [summary.costByRig]
  );
  const unassignedProjectSpend = useMemo(
    () => summary.costByProject.find((entry) => entry.id === UNASSIGNED_PROJECT_ID)?.totalApprovedCost || 0,
    [summary.costByProject]
  );

  const categoryLegendRows = useMemo(
    () =>
      summary.spendingCategoryBreakdown
        .filter((entry) => entry.totalCost > 0)
        .map((entry, index) => ({
          ...entry,
          color: COST_TRACKING_DONUT_PALETTE[index % COST_TRACKING_DONUT_PALETTE.length]
        })),
    [summary.spendingCategoryBreakdown]
  );

  return (
    <AccessGate permission="finance:view">
      <div className="gf-page-stack">
        <FilterScopeBanner filters={filters} />

        <nav className="rounded-xl border border-slate-200/90 bg-white/85 px-3 py-2 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Jump to</span>
            {COST_TRACKING_SECTIONS.map((section) => (
              <a
                key={section.id}
                href={`#${section.id}`}
                className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-100"
              >
                {section.label}
              </a>
            ))}
          </div>
        </nav>

        <section id="overview" className="gf-section scroll-mt-24">
          <SectionHeader
            title="Cost Overview Summary"
            description="Approved operational spend visibility across rigs, projects, and maintenance work."
            action={
              <button
                type="button"
                onClick={() => void Promise.all([loadCostSummary(true), loadBudgetAlerts()])}
                className="gf-btn-subtle inline-flex items-center gap-1"
              >
                <RotateCw size={13} className={refreshing ? "animate-spin" : ""} />
                Refresh
              </button>
            }
          />
          <div className="gf-kpi-grid-primary">
            <MetricCard
              label={isScoped ? "Approved Expenses in Scope" : "Total Approved Expenses"}
              value={formatCurrency(summary.overview.totalApprovedExpenses)}
              tone="warn"
            />
            <MetricCard
              label="Maintenance-Related Cost"
              value={formatCurrency(summary.overview.totalMaintenanceRelatedCost)}
              tone="danger"
            />
            <MetricCard
              label="Inventory-Related Cost"
              value={formatCurrency(summary.overview.totalInventoryRelatedCost)}
            />
            <MetricCard
              label="Non-Inventory Expense Cost"
              value={formatCurrency(summary.overview.totalNonInventoryExpenseCost)}
            />
          </div>
          <div className="gf-kpi-grid-secondary">
            <MetricCard
              label="Highest Cost Rig"
              value={summary.overview.highestCostRig?.name || "N/A"}
              change={
                summary.overview.highestCostRig
                  ? formatCurrency(summary.overview.highestCostRig.totalApprovedCost)
                  : undefined
              }
              tone="danger"
            />
            <MetricCard
              label="Highest Cost Project"
              value={summary.overview.highestCostProject?.name || "N/A"}
              change={
                summary.overview.highestCostProject
                  ? formatCurrency(summary.overview.highestCostProject.totalApprovedCost)
                  : undefined
              }
              tone="warn"
            />
            <MetricCard
              label="Top Rig Cost Share"
              value={formatPercent(topCostShare)}
              change={
                summary.costByRig[0]
                  ? `${summary.costByRig[0].name} of approved spend`
                  : "No rig cost data in scope"
              }
            />
            <MetricCard
              label="Largest Cost Category"
              value={largestCostCategory?.label || "N/A"}
              change={
                largestCostCategory
                  ? `${formatCurrency(largestCostCategory.totalCost)} (${formatPercent(largestCostCategory.percentOfTotalSpend)})`
                  : "No categorized spend in scope"
              }
            />
          </div>
          <div className="rounded-xl border border-slate-200/90 bg-white/85 px-4 py-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Budget Alerts</p>
                <p className="mt-1 text-sm text-slate-700">
                  Overspent <span className="font-semibold text-red-700">{budgetAlerts.overspentCount}</span> •
                  Critical <span className="font-semibold text-orange-700"> {budgetAlerts.criticalCount}</span> •
                  Watch <span className="font-semibold text-amber-700"> {budgetAlerts.watchCount}</span>
                </p>
              </div>
              <Link href="/cost-tracking/budget-vs-actual" className="gf-btn-subtle">
                Open Budget vs Actual
              </Link>
            </div>
          </div>
          {(unassignedRigSpend > 0 || unassignedProjectSpend > 0) && (
            <div className="gf-inline-note">
              <span className="font-medium text-slate-800">Data quality note:</span>{" "}
              {`Unassigned rig spend ${formatCurrency(unassignedRigSpend)} • Unassigned project spend ${formatCurrency(unassignedProjectSpend)} (needs linkage).`}
            </div>
          )}
        </section>

        <section id="cost-by-rig" className="gf-section scroll-mt-24 border-t border-slate-200/70 pt-4 md:pt-5">
          <SectionHeader
            title="Cost by Rig"
            description="Approved cost allocation by rig, including maintenance, inventory/parts, and other expense."
          />
          <div className="gf-chart-grid">
            <Card title="Approved Cost by Rig" subtitle="Compare highest spend rigs in the current scope.">
              {loading ? (
                <p className="text-sm text-slate-600">Loading rig cost distribution...</p>
              ) : summary.costByRig.length === 0 ? (
                <div className="gf-empty-state">No approved rig-linked costs found for the selected filters.</div>
              ) : (
                <BarCategoryChart data={summary.costByRig.slice(0, 12)} xKey="name" yKey="totalApprovedCost" color="#1e63f5" />
              )}
            </Card>

            <Card title="Rig Cost Detail" subtitle="Operational spend detail with percentage of total approved cost.">
              {loading ? (
                <p className="text-sm text-slate-600">Loading rig cost detail...</p>
              ) : rigRows.length === 0 ? (
                <div className="gf-empty-state">No approved rig costs found for the selected filters.</div>
              ) : (
                <DataTable
                  columns={[
                    "Rig",
                    "Total Approved Cost",
                    "Maintenance Cost",
                    "Inventory / Parts Cost",
                    "Other Expense Cost",
                    "% of Total Spend"
                  ]}
                  rows={rigRows}
                />
              )}
            </Card>
          </div>
        </section>

        <section id="cost-by-project" className="gf-section scroll-mt-24 border-t border-slate-200/70 pt-4 md:pt-5">
          <SectionHeader
            title="Cost by Project"
            description="Approved project spend split into maintenance-linked, inventory purchase, and expense-only."
          />
          <div className="gf-chart-grid">
            <Card title="Approved Cost by Project" subtitle="Project spend leaderboard for manager prioritization.">
              {loading ? (
                <p className="text-sm text-slate-600">Loading project cost distribution...</p>
              ) : summary.costByProject.length === 0 ? (
                <div className="gf-empty-state">No approved project costs found for the selected filters.</div>
              ) : (
                <BarCategoryChart
                  data={summary.costByProject.slice(0, 12)}
                  xKey="name"
                  yKey="totalApprovedCost"
                  color="#1e63f5"
                />
              )}
            </Card>

            <Card title="Project Cost Detail" subtitle="Which projects are consuming the most approved spend.">
              {loading ? (
                <p className="text-sm text-slate-600">Loading project cost detail...</p>
              ) : projectRows.length === 0 ? (
                <div className="gf-empty-state">No approved project costs found for the selected filters.</div>
              ) : (
                <DataTable
                  columns={[
                    "Project",
                    "Total Approved Cost",
                    "Maintenance-Linked Cost",
                    "Inventory Purchase Cost",
                    "Expense-Only Cost",
                    "% of Total Spend"
                  ]}
                  rows={projectRows}
                />
              )}
            </Card>
          </div>
        </section>

        <section id="maintenance-cost" className="gf-section scroll-mt-24 border-t border-slate-200/70 pt-4 md:pt-5">
          <SectionHeader
            title="Cost by Maintenance Request / Breakdown"
            description="Most expensive approved maintenance-linked spend by request reference."
          />
          <Card
            title="Maintenance Cost Detail"
            subtitle="Use this to identify high-cost breakdowns and prioritize reliability actions."
          >
            {loading ? (
              <p className="text-sm text-slate-600">Loading maintenance cost details...</p>
            ) : maintenanceRows.length === 0 ? (
              <div className="gf-empty-state">No approved maintenance-linked costs found for the selected filters.</div>
            ) : (
              <DataTable
                columns={[
                  "Request / Breakdown Ref",
                  "Rig",
                  "Total Linked Cost",
                  "Linked Purchases",
                  "Urgency",
                  "Status"
                ]}
                rows={maintenanceRows}
              />
            )}
          </Card>
        </section>

        <section id="spending-breakdown" className="gf-section scroll-mt-24 border-t border-slate-200/70 pt-4 md:pt-5">
          <SectionHeader
            title="Spending Category Breakdown and Trend"
            description="Understand where approved spend is concentrated and whether costs are rising or easing."
          />
          <div className="gf-chart-grid">
            <Card title="Spending Category Breakdown" subtitle="Approved spend grouped into operational decision categories.">
              {loading ? (
                <p className="text-sm text-slate-600">Loading spending categories...</p>
              ) : summary.spendingCategoryBreakdown.every((entry) => entry.totalCost === 0) ? (
                <div className="gf-empty-state">No approved spending categories found for the selected filters.</div>
              ) : (
                <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
                  <DonutStatusChart
                    data={summary.spendingCategoryBreakdown}
                    nameKey="label"
                    valueKey="totalCost"
                    palette={COST_TRACKING_DONUT_PALETTE}
                  />
                  <div className="space-y-2">
                    {categoryLegendRows.map((entry) => (
                      <div
                        key={entry.key}
                        className="flex items-center justify-between rounded-lg border border-slate-200/80 bg-slate-50/60 px-3 py-2"
                      >
                        <div className="flex items-center gap-2">
                          <span
                            className="inline-block h-2.5 w-2.5 rounded-full"
                            style={{ backgroundColor: entry.color }}
                            aria-hidden
                          />
                          <span className="text-sm font-medium text-ink-900">{entry.label}</span>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-semibold text-ink-900">{formatCurrency(entry.totalCost)}</p>
                          <p className="text-xs text-slate-600">{formatPercent(entry.percentOfTotalSpend)}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </Card>

            <Card
              title={`Approved Cost Trend (${summary.trendGranularity === "week" ? "Weekly" : "Monthly"})`}
              subtitle="Trend of approved operational costs to support spend direction decisions."
            >
              {loading ? (
                <p className="text-sm text-slate-600">Loading cost trend...</p>
              ) : summary.costTrend.length === 0 ? (
                <div className="gf-empty-state">No approved cost trend data found for the selected filters.</div>
              ) : (
                <LineTrendChart
                  data={summary.costTrend}
                  xKey="label"
                  yKey="totalApprovedCost"
                  secondaryKey="maintenanceCost"
                  color="#1e63f5"
                  secondaryColor="#0f766e"
                />
              )}
            </Card>
          </div>
        </section>
      </div>
    </AccessGate>
  );
}

function resolveBudgetAlertCounts(payload: BudgetVsActualSummaryResponse | null) {
  if (!payload) {
    return emptyBudgetAlerts;
  }
  if (payload.alerts) {
    return {
      overspentCount: payload.alerts.overspentCount,
      criticalCount: payload.alerts.criticalCount,
      watchCount: payload.alerts.watchCount,
      noBudgetCount: payload.alerts.noBudgetCount
    };
  }

  const rows = [...(payload.byRig || []), ...(payload.byProject || [])];
  const overspentCount = rows.filter((entry) => entry.alertLevel === "OVERSPENT").length;
  const criticalCount = rows.filter((entry) => entry.alertLevel === "CRITICAL_90").length;
  const watchCount = rows.filter((entry) => entry.alertLevel === "WATCH_80").length;
  const noBudgetCount = rows.filter((entry) => entry.status === "NO_BUDGET").length;

  return {
    overspentCount,
    criticalCount,
    watchCount,
    noBudgetCount
  };
}
