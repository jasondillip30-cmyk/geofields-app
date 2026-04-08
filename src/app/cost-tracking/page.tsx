"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { RotateCw } from "lucide-react";

import { AccessGate } from "@/components/layout/access-gate";
import { useAnalyticsFilters } from "@/components/layout/analytics-filters-provider";
import { FilterScopeBanner, hasActiveScopeFilters } from "@/components/layout/filter-scope-banner";
import { ProjectLockedBanner } from "@/components/layout/project-locked-banner";
import {
  AnalyticsEmptyState,
  getScopedKpiHelper,
  getScopedKpiValue
} from "@/components/layout/analytics-empty-state";
import { BarCategoryChart } from "@/components/charts/bar-category-chart";
import { DonutStatusChart } from "@/components/charts/donut-status-chart";
import { LineTrendChart } from "@/components/charts/line-trend-chart";
import { Card, MetricCard } from "@/components/ui/card";
import { SectionHeader } from "@/components/ui/section-header";
import { DataTable } from "@/components/ui/table";
import type { CostTrackingSummaryPayload } from "@/lib/cost-tracking";
import { formatCurrency, formatPercent } from "@/lib/utils";

const UNASSIGNED_RIG_ID = "__unassigned_rig__";
const UNASSIGNED_PROJECT_ID = "__unassigned_project__";
const COST_TRACKING_SECTIONS = [
  { id: "overview", label: "Overview" },
  { id: "cost-by-project", label: "Cost by Project" },
  { id: "cost-by-category", label: "Cost by Category" },
  { id: "maintenance-breakdown-cost", label: "Maintenance / Breakdown" },
  { id: "unlinked-data-quality", label: "Unlinked / Data Quality" }
] as const;
const COST_TRACKING_DONUT_PALETTE = ["#1e63f5", "#0f766e", "#0ea5e9", "#6366f1", "#14b8a6", "#64748b", "#94a3b8"];

const emptySummary: CostTrackingSummaryPayload = {
  filters: {
    projectId: "all",
    clientId: "all",
    rigId: "all",
    from: null,
    to: null
  },
  overview: {
    totalRecognizedSpend: 0,
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
  const { filters, resetFilters, setFilters } = useAnalyticsFilters();
  const [summary, setSummary] = useState<CostTrackingSummaryPayload>(emptySummary);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const scopeProjectId = filters.projectId !== "all" ? filters.projectId : "";
  const isSingleProjectScope = scopeProjectId.length > 0;
  const effectiveScopeFilters = useMemo(
    () =>
      isSingleProjectScope
        ? {
            ...filters,
            clientId: "all",
            rigId: "all"
          }
        : filters,
    [filters, isSingleProjectScope]
  );
  const lockedProjectName = useMemo(() => {
    if (!isSingleProjectScope) {
      return null;
    }
    return summary.costByProject.find((entry) => entry.id === scopeProjectId)?.name || null;
  }, [isSingleProjectScope, scopeProjectId, summary.costByProject]);
  const isScoped = hasActiveScopeFilters(effectiveScopeFilters);
  const recognizedSpendTotal = summary.overview.totalRecognizedSpend;
  const hasCostData = useMemo(
    () =>
      summary.costByRig.length > 0 ||
      summary.costByProject.length > 0 ||
      summary.costByMaintenanceRequest.length > 0 ||
      summary.spendingCategoryBreakdown.some((entry) => entry.totalCost > 0) ||
      summary.costTrend.length > 0 ||
      recognizedSpendTotal > 0,
    [
      summary.costByMaintenanceRequest.length,
      summary.costByProject.length,
      summary.costByRig.length,
      summary.costTrend.length,
      recognizedSpendTotal,
      summary.spendingCategoryBreakdown
    ]
  );
  const isFilteredEmpty = !loading && isScoped && !hasCostData;

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
        if (isSingleProjectScope) {
          params.set("projectId", scopeProjectId);
        } else {
          if (filters.clientId !== "all") params.set("clientId", filters.clientId);
          if (filters.rigId !== "all") params.set("rigId", filters.rigId);
          if (filters.projectId !== "all") params.set("projectId", filters.projectId);
        }

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
    [filters.clientId, filters.from, filters.projectId, filters.rigId, filters.to, isSingleProjectScope, scopeProjectId]
  );

  useEffect(() => {
    void loadCostSummary();
  }, [loadCostSummary]);

  useEffect(() => {
    const interval = setInterval(() => {
      void loadCostSummary(true);
    }, 10000);

    return () => clearInterval(interval);
  }, [loadCostSummary]);

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
        formatCurrency(entry.totalRecognizedCost),
        formatCurrency(entry.maintenanceLinkedCost),
        formatCurrency(entry.inventoryPurchaseCost),
        formatCurrency(entry.expenseOnlyCost),
        formatPercent(entry.percentOfTotalSpend),
        entry.id === UNASSIGNED_PROJECT_ID ? (
          <span key={`${entry.id}-action`} className="text-xs text-slate-500">
            Resolve linkage
          </span>
        ) : (
          <Link
            key={`${entry.id}-action`}
            href={`/projects/${entry.id}`}
            className="gf-btn-subtle"
          >
            Open project
          </Link>
        )
      ]),
    [summary.costByProject]
  );

  const maintenanceBreakdownRows = useMemo(
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

  const topProjectCostShare = useMemo(() => {
    const leader = summary.costByProject[0];
    if (!leader || recognizedSpendTotal <= 0) {
      return 0;
    }
      return (leader.totalRecognizedCost / recognizedSpendTotal) * 100;
  }, [summary.costByProject, recognizedSpendTotal]);

  const largestCostCategory = useMemo(
    () => summary.spendingCategoryBreakdown.find((entry) => entry.totalCost > 0) || null,
    [summary.spendingCategoryBreakdown]
  );

  const unassignedRigSpend = useMemo(
    () => summary.costByRig.find((entry) => entry.id === UNASSIGNED_RIG_ID)?.totalRecognizedCost || 0,
    [summary.costByRig]
  );
  const unassignedProjectSpend = useMemo(
    () => summary.costByProject.find((entry) => entry.id === UNASSIGNED_PROJECT_ID)?.totalRecognizedCost || 0,
    [summary.costByProject]
  );
  const legacyUnlinkedCount = summary.classificationAudit?.legacyUnlinkedCount || 0;
  const unlinkedRows = useMemo(() => {
    const rows = [];
    if (unassignedProjectSpend > 0) {
      rows.push([
        <span key="project-linkage" className="font-medium text-ink-900">
          Recognized spend missing project linkage
        </span>,
        formatCurrency(unassignedProjectSpend),
        "Project profitability is understated until this is linked.",
        <Link key="project-action" href="/expenses" className="gf-btn-subtle">
          Review purchase requests
        </Link>
      ]);
    }
    if (unassignedRigSpend > 0) {
      rows.push([
        <span key="rig-linkage" className="font-medium text-ink-900">
          Recognized spend missing rig context
        </span>,
        formatCurrency(unassignedRigSpend),
        "Operational traceability is reduced for maintenance/breakdown follow-up.",
        <Link key="rig-action" href="/rigs" className="gf-btn-subtle">
          Review rig linkage
        </Link>
      ]);
    }
    return rows;
  }, [unassignedProjectSpend, unassignedRigSpend]);

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
  const applyDatePreset = useCallback(
    (days: number) => {
      const end = new Date();
      end.setUTCHours(0, 0, 0, 0);
      const start = new Date(end);
      start.setUTCDate(end.getUTCDate() - Math.max(days - 1, 0));
      setFilters((current) => ({
        ...current,
        from: toDateKey(start),
        to: toDateKey(end)
      }));
    },
    [setFilters]
  );
  const handleClearFilters = useCallback(() => {
    resetFilters();
  }, [resetFilters]);
  const handleLast30Days = useCallback(() => {
    applyDatePreset(30);
  }, [applyDatePreset]);
  const handleLast90Days = useCallback(() => {
    applyDatePreset(90);
  }, [applyDatePreset]);

  return (
    <AccessGate permission="finance:view">
      <div className="gf-page-stack">
        <ProjectLockedBanner projectId={scopeProjectId} projectName={lockedProjectName} />
        <FilterScopeBanner filters={effectiveScopeFilters} onClearFilters={handleClearFilters} />

        {!loading && !hasCostData ? (
          <Card title={isFilteredEmpty ? "No data for selected filters" : "No data recorded yet"}>
            <AnalyticsEmptyState
              variant={isFilteredEmpty ? "filtered-empty" : "no-data"}
              moduleHint="Record recognized expenses to populate cost tracking."
              scopeHint={`${summary.costByProject.length} projects in current scope • ${summary.costByRig.length} rigs in scope`}
              onClearFilters={handleClearFilters}
              onLast30Days={handleLast30Days}
              onLast90Days={handleLast90Days}
            />
          </Card>
        ) : null}

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
            description="Project-first view of recognized spend so teams can understand what is driving project cost."
            action={
              <button
                type="button"
                onClick={() => void loadCostSummary(true)}
                className="gf-btn-subtle inline-flex items-center gap-1"
              >
                <RotateCw size={13} className={refreshing ? "animate-spin" : ""} />
                Refresh
              </button>
            }
          />
          <div className="gf-kpi-grid-primary">
            <MetricCard
              label={isScoped ? "Recognized Spend (Scope)" : "Recognized Spend"}
              value={getScopedKpiValue(formatCurrency(recognizedSpendTotal), isFilteredEmpty)}
              tone="warn"
              change={getScopedKpiHelper(undefined, isFilteredEmpty)}
            />
            <MetricCard
              label="Highest-Cost Project"
              value={getScopedKpiValue(summary.overview.highestCostProject?.name || "N/A", isFilteredEmpty)}
              change={
                isFilteredEmpty
                  ? "No data for current filters"
                  : summary.overview.highestCostProject
                    ? formatCurrency(
                        summary.overview.highestCostProject.totalRecognizedCost
                      )
                    : "No project spend in scope"
              }
              tone="danger"
            />
            <MetricCard
              label="Largest Cost Category"
              value={getScopedKpiValue(largestCostCategory?.label || "N/A", isFilteredEmpty)}
              change={
                isFilteredEmpty
                  ? "No data for current filters"
                  : largestCostCategory
                    ? `${formatCurrency(largestCostCategory.totalCost)} (${formatPercent(largestCostCategory.percentOfTotalSpend)})`
                    : "No categorized spend in scope"
              }
            />
            <MetricCard
              label="Maintenance / Breakdown Spend"
              value={getScopedKpiValue(formatCurrency(summary.overview.totalMaintenanceRelatedCost), isFilteredEmpty)}
              tone="warn"
              change={getScopedKpiHelper(undefined, isFilteredEmpty)}
            />
          </div>
          <div className="gf-kpi-grid-secondary">
            <MetricCard
              label="Top Project Spend Share"
              value={getScopedKpiValue(formatPercent(topProjectCostShare), isFilteredEmpty)}
              change={
                isFilteredEmpty
                  ? "No data for current filters"
                  : summary.costByProject[0]
                    ? `${summary.costByProject[0].name} of recognized spend`
                    : "No project spend data in scope"
              }
            />
            <MetricCard
              label="Unlinked Project Spend"
              value={getScopedKpiValue(formatCurrency(unassignedProjectSpend), isFilteredEmpty)}
              tone={unassignedProjectSpend > 0 ? "warn" : "good"}
              change={
                isFilteredEmpty
                  ? "No data for current filters"
                  : unassignedProjectSpend > 0
                    ? "Needs project linkage"
                    : "All recognized spend linked to projects"
              }
            />
            <MetricCard
              label="Unlinked Rig Context Spend"
              value={getScopedKpiValue(formatCurrency(unassignedRigSpend), isFilteredEmpty)}
              tone={unassignedRigSpend > 0 ? "warn" : "good"}
              change={
                isFilteredEmpty
                  ? "No data for current filters"
                  : unassignedRigSpend > 0
                    ? "Needs rig context linkage"
                    : "Rig context linkage looks clean"
              }
            />
            <MetricCard
              label="Other Operating Spend"
              value={getScopedKpiValue(formatCurrency(summary.overview.totalNonInventoryExpenseCost), isFilteredEmpty)}
              change={getScopedKpiHelper(undefined, isFilteredEmpty)}
            />
          </div>
          <div className="rounded-xl border border-slate-200/90 bg-white/85 px-4 py-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-slate-700">
                Approval grants permission to spend; this page tracks posted/recognized spend. Use Budget vs Actual to
                monitor budget pressure, and Profit to confirm project margin.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <Link href="/cost-tracking/budget-vs-actual" className="gf-btn-subtle">
                  Open Budget vs Actual
                </Link>
                <Link href="/profit" className="gf-btn-subtle">
                  Open Profit
                </Link>
              </div>
            </div>
          </div>
        </section>

        <section id="cost-by-project" className="gf-section scroll-mt-24 border-t border-slate-200/70 pt-4 md:pt-5">
          <SectionHeader
            title="Cost by Project"
            description="Project-first recognized spend leaderboard to identify where costs are concentrated."
          />
          <div className="gf-chart-grid">
            <Card title="Recognized Spend by Project" subtitle="Top projects by recognized spend in current scope.">
              {loading ? (
                <p className="text-sm text-slate-600">Loading project spend distribution...</p>
              ) : summary.costByProject.length === 0 ? (
                <AnalyticsEmptyState
                  variant={isScoped ? "filtered-empty" : "no-data"}
                  moduleHint="No recognized project spend found yet."
                  scopeHint={`${summary.costByProject.length} projects in current scope`}
                  onClearFilters={handleClearFilters}
                  onLast30Days={handleLast30Days}
                  onLast90Days={handleLast90Days}
                />
              ) : (
                <BarCategoryChart
                  data={summary.costByProject.slice(0, 12)}
                  xKey="name"
                  yKey="totalRecognizedCost"
                  color="#1e63f5"
                />
              )}
            </Card>

            <Card title="Project Spend Detail" subtitle="Break down recognized spend drivers by project.">
              {loading ? (
                <p className="text-sm text-slate-600">Loading project spend detail...</p>
              ) : projectRows.length === 0 ? (
                <AnalyticsEmptyState
                  variant={isScoped ? "filtered-empty" : "no-data"}
                  moduleHint="No project spend rows found yet."
                  scopeHint={`${projectRows.length} project rows in current scope`}
                  onClearFilters={handleClearFilters}
                  onLast30Days={handleLast30Days}
                  onLast90Days={handleLast90Days}
                />
              ) : (
                <DataTable
                  columns={[
                    "Project",
                    "Recognized Spend",
                    "Maintenance / Breakdown",
                    "Stock / Warehouse",
                    "Other Operating",
                    "% of Scope Spend",
                    "Action"
                  ]}
                  rows={projectRows}
                />
              )}
            </Card>
          </div>
        </section>

        <section id="cost-by-category" className="gf-section scroll-mt-24 border-t border-slate-200/70 pt-4 md:pt-5">
          <SectionHeader
            title="Cost by Category"
            description="Accounting-category view of recognized spend (Fuel, Travel, Stock, etc.). Operational purpose buckets are shown in the overview and maintenance/breakdown sections."
          />
          <div className="gf-chart-grid">
            <Card title="Recognized Spend by Category" subtitle="Category mix in the current filter scope.">
              {loading ? (
                <p className="text-sm text-slate-600">Loading spending categories...</p>
              ) : summary.spendingCategoryBreakdown.every((entry) => entry.totalCost === 0) ? (
                <AnalyticsEmptyState
                  variant={isScoped ? "filtered-empty" : "no-data"}
                  moduleHint="No recognized spending categories found yet."
                  scopeHint={`${categoryLegendRows.length} categories in current scope`}
                  onClearFilters={handleClearFilters}
                  onLast30Days={handleLast30Days}
                  onLast90Days={handleLast90Days}
                />
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
              title={`Recognized Spend Trend (${summary.trendGranularity === "week" ? "Weekly" : "Monthly"})`}
              subtitle="Track whether recognized costs are accelerating or easing."
            >
              {loading ? (
                <p className="text-sm text-slate-600">Loading spend trend...</p>
              ) : summary.costTrend.length === 0 ? (
                <AnalyticsEmptyState
                  variant={isScoped ? "filtered-empty" : "no-data"}
                  moduleHint="No recognized spend trend data found yet."
                  scopeHint={`${summary.costTrend.length} trend points in current scope`}
                  onClearFilters={handleClearFilters}
                  onLast30Days={handleLast30Days}
                  onLast90Days={handleLast90Days}
                />
              ) : (
                <LineTrendChart
                  data={summary.costTrend}
                  xKey="label"
                  yKey="totalRecognizedCost"
                  secondaryKey="maintenanceCost"
                  color="#1e63f5"
                  secondaryColor="#0f766e"
                />
              )}
            </Card>
          </div>
        </section>

        <section
          id="maintenance-breakdown-cost"
          className="gf-section scroll-mt-24 border-t border-slate-200/70 pt-4 md:pt-5"
        >
          <SectionHeader
            title="Maintenance / Breakdown Cost View"
            description="Recognized spend linked to maintenance workflows and breakdown-related work."
          />
          <Card
            title="Linked Maintenance / Breakdown Recognized Spend"
            subtitle="Use this to identify high-cost operational cases and reliability pressure."
          >
            {loading ? (
              <p className="text-sm text-slate-600">Loading maintenance/breakdown spend view...</p>
            ) : maintenanceBreakdownRows.length === 0 ? (
              <AnalyticsEmptyState
                variant={isScoped ? "filtered-empty" : "no-data"}
                moduleHint="No recognized maintenance/breakdown-linked spend found in this scope."
                scopeHint={`${maintenanceBreakdownRows.length} linked rows in current scope`}
                onClearFilters={handleClearFilters}
                onLast30Days={handleLast30Days}
                onLast90Days={handleLast90Days}
              />
            ) : (
              <DataTable
                columns={[
                  "Maintenance / Breakdown Ref",
                  "Rig",
                  "Recognized Spend",
                  "Linked Purchases",
                  "Urgency",
                  "Status"
                ]}
                rows={maintenanceBreakdownRows}
              />
            )}
          </Card>
        </section>

        <section
          id="unlinked-data-quality"
          className="gf-section scroll-mt-24 border-t border-slate-200/70 pt-4 md:pt-5"
        >
          <SectionHeader
            title="Unlinked / Data Quality"
            description="Recognized spend that could not be confidently tied to project/rig context."
          />
          {unlinkedRows.length === 0 ? (
            <Card>
              <div className="space-y-1.5">
                <p className="text-sm text-slate-700">
                  No unlinked recognized spend found in this scope. Project and rig linkage look consistent.
                </p>
                {legacyUnlinkedCount > 0 ? (
                  <p className="text-xs text-amber-700">
                    {legacyUnlinkedCount} legacy rows remain in Other / Unlinked due to incomplete historical linkage.
                  </p>
                ) : null}
              </div>
            </Card>
          ) : (
            <Card>
              {legacyUnlinkedCount > 0 ? (
                <p className="mb-2 text-xs text-amber-700">
                  {legacyUnlinkedCount} legacy rows remain in Other / Unlinked due to incomplete historical linkage.
                </p>
              ) : null}
              <DataTable
                columns={["Issue", "Amount", "Why It Matters", "Action"]}
                rows={unlinkedRows}
              />
            </Card>
          )}
        </section>
      </div>
    </AccessGate>
  );
}

function toDateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}
