"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { RotateCw } from "lucide-react";
import { useRouter } from "next/navigation";

import { AccessGate } from "@/components/layout/access-gate";
import { useRegisterCopilotContext } from "@/components/layout/ai-copilot-context";
import { useAnalyticsFilters } from "@/components/layout/analytics-filters-provider";
import { scrollToFocusElement, useCopilotFocusTarget } from "@/components/layout/copilot-focus-target";
import { FilterScopeBanner, hasActiveScopeFilters } from "@/components/layout/filter-scope-banner";
import { BarCategoryChart } from "@/components/charts/bar-category-chart";
import { DonutStatusChart } from "@/components/charts/donut-status-chart";
import { LineTrendChart } from "@/components/charts/line-trend-chart";
import { StackedBarChart } from "@/components/charts/stacked-bar-chart";
import { Card, MetricCard } from "@/components/ui/card";
import { SectionHeader } from "@/components/ui/section-header";
import { DataTable } from "@/components/ui/table";
import type { CopilotPageContext } from "@/lib/ai/contextual-copilot";
import { buildScopedHref, getBucketDateRange } from "@/lib/drilldown";
import { cn, formatCurrency, formatPercent } from "@/lib/utils";

interface ProfitRow {
  id: string;
  name: string;
  revenue: number;
  expenses: number;
  profit: number;
  margin: number;
}

type CostGroupKey = "fuel" | "salaries" | "maintenance" | "consumables" | "other";

interface ProfitAlert {
  tone: "danger" | "warn" | "good";
  title: string;
  message: string;
}

interface ProfitSummary {
  totals: {
    totalRevenue: number;
    totalExpenses: number;
    totalProfit: number;
  };
  kpis: {
    highestProfitRig: string;
    highestProfitProject: string;
    lowestProfitRig: string;
    lowestProfitProject: string;
    highestProfitClient?: string;
    lowestProfitClient?: string;
    highestMarginRig: string;
    highestMarginProject: string;
  };
  trendGranularity: "day" | "month";
  profitTrend: Array<{
    bucketStart: string;
    label: string;
    revenue: number;
    expenses: number;
    profit: number;
  }>;
  profitByRig: ProfitRow[];
  profitByProject: ProfitRow[];
  profitByClient: ProfitRow[];
  marginByRig: ProfitRow[];
  marginByProject: ProfitRow[];
  costBreakdownByCategory: Array<{
    category: string;
    totalCost: number;
    percentOfTotalExpenses: number;
  }>;
  costBreakdownByGroup: Array<{
    key: CostGroupKey;
    category: string;
    totalCost: number;
    percentOfTotalExpenses: number;
  }>;
  costBreakdownByRig: Array<{
    id: string;
    name: string;
    fuel: number;
    salaries: number;
    maintenance: number;
    consumables: number;
    other: number;
    totalExpenses: number;
  }>;
}

const emptySummary: ProfitSummary = {
  totals: {
    totalRevenue: 0,
    totalExpenses: 0,
    totalProfit: 0
  },
  kpis: {
    highestProfitRig: "N/A",
    highestProfitProject: "N/A",
    lowestProfitRig: "N/A",
    lowestProfitProject: "N/A",
    highestMarginRig: "N/A",
    highestMarginProject: "N/A"
  },
  trendGranularity: "day",
  profitTrend: [],
  profitByRig: [],
  profitByProject: [],
  profitByClient: [],
  marginByRig: [],
  marginByProject: [],
  costBreakdownByCategory: [],
  costBreakdownByGroup: [],
  costBreakdownByRig: []
};

export default function ProfitPage() {
  const router = useRouter();
  const { filters } = useAnalyticsFilters();
  const [summary, setSummary] = useState<ProfitSummary>(emptySummary);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [rigSortBy, setRigSortBy] = useState<"profit" | "margin">("profit");
  const [projectSortBy, setProjectSortBy] = useState<"profit" | "margin">("profit");
  const [focusedSectionId, setFocusedSectionId] = useState<string | null>(null);

  const loadProfitSummary = useCallback(
    async (silent = false) => {
      if (!silent) {
        setLoading(true);
      } else {
        setRefreshing(true);
      }

      try {
        const search = new URLSearchParams();
        if (filters.from) search.set("from", filters.from);
        if (filters.to) search.set("to", filters.to);
        if (filters.clientId !== "all") search.set("clientId", filters.clientId);
        if (filters.rigId !== "all") search.set("rigId", filters.rigId);

        const query = search.toString();
        const response = await fetch(`/api/profit/summary${query ? `?${query}` : ""}`, { cache: "no-store" });
        const payload = response.ok ? await response.json() : emptySummary;
        setSummary(payload);
      } catch (_error) {
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

  useEffect(() => {
    void loadProfitSummary();
  }, [loadProfitSummary]);

  useEffect(() => {
    const interval = setInterval(() => {
      void loadProfitSummary(true);
    }, 8000);

    return () => clearInterval(interval);
  }, [loadProfitSummary]);

  useEffect(() => {
    function onStorage(event: StorageEvent) {
      if (event.key === "gf:revenue-updated-at" || event.key === "gf:profit-updated-at") {
        void loadProfitSummary(true);
      }
    }

    function onProfitUpdate() {
      void loadProfitSummary(true);
    }

    function onFocus() {
      void loadProfitSummary(true);
    }

    window.addEventListener("storage", onStorage);
    window.addEventListener("focus", onFocus);
    window.addEventListener("gf:profit-updated", onProfitUpdate);

    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("gf:profit-updated", onProfitUpdate);
    };
  }, [loadProfitSummary]);

  const totalProfitTone = useMemo(
    () => (summary.totals.totalProfit >= 0 ? "good" : "danger"),
    [summary.totals.totalProfit]
  );
  const overallMargin = useMemo(() => {
    if (summary.totals.totalRevenue <= 0) {
      return 0;
    }
    return (summary.totals.totalProfit / summary.totals.totalRevenue) * 100;
  }, [summary.totals.totalProfit, summary.totals.totalRevenue]);
  const overallMarginTone = useMemo<"good" | "warn" | "danger">(() => {
    if (overallMargin >= 40) {
      return "good";
    }
    if (overallMargin >= 15) {
      return "warn";
    }
    return "danger";
  }, [overallMargin]);
  const sortedRigRows = useMemo(
    () => sortProfitRows(summary.profitByRig, rigSortBy),
    [rigSortBy, summary.profitByRig]
  );
  const sortedProjectRows = useMemo(
    () => sortProfitRows(summary.profitByProject, projectSortBy),
    [projectSortBy, summary.profitByProject]
  );
  const profitAlerts = useMemo(() => buildProfitAlerts(summary), [summary]);
  const categoryInsight = useMemo(
    () => buildCategoryInsight(summary.costBreakdownByCategory),
    [summary.costBreakdownByCategory]
  );
  const groupedCostInsight = useMemo(
    () => buildGroupedCostInsight(summary.costBreakdownByGroup),
    [summary.costBreakdownByGroup]
  );
  const rigCostInsight = useMemo(
    () => buildRigCostInsight(summary.costBreakdownByRig),
    [summary.costBreakdownByRig]
  );
  const isScoped = hasActiveScopeFilters(filters);
  const buildHref = useCallback(
    (path: string, overrides?: Record<string, string | null | undefined>) =>
      buildScopedHref(filters, path, overrides),
    [filters]
  );

  const copilotContext = useMemo<CopilotPageContext>(
    () => ({
      pageKey: "profit",
      pageName: "Profit",
      filters: {
        clientId: filters.clientId,
        rigId: filters.rigId,
        from: filters.from || null,
        to: filters.to || null
      },
      summaryMetrics: [
        { key: "totalRevenue", label: "Total Revenue", value: summary.totals.totalRevenue },
        { key: "totalExpenses", label: "Total Expenses", value: summary.totals.totalExpenses },
        { key: "totalProfit", label: "Total Profit", value: summary.totals.totalProfit },
        { key: "profitMargin", label: "Profit Margin", value: overallMargin },
        {
          key: "lowMarginContributors",
          label: "Low Margin Contributors",
          value: summary.profitByRig.filter((entry) => entry.margin < 15).length +
            summary.profitByProject.filter((entry) => entry.margin < 15).length
        },
        {
          key: "negativeProfitContributors",
          label: "Negative Profit Contributors",
          value: summary.profitByRig.filter((entry) => entry.profit < 0).length +
            summary.profitByProject.filter((entry) => entry.profit < 0).length
        }
      ],
      tablePreviews: [
        {
          key: "profit-by-rig",
          title: "Profit by Rig",
          rowCount: summary.profitByRig.length,
          columns: ["Rig", "Revenue", "Expenses", "Profit", "Margin"],
          rows: sortedRigRows.slice(0, 8).map((entry) => ({
            id: entry.id,
            name: entry.name,
            revenue: entry.revenue,
            expenses: entry.expenses,
            profit: entry.profit,
            margin: entry.margin,
            href: buildHref("/profit"),
            sectionId: "profit-leaderboards-section",
            targetPageKey: "profit"
          }))
        },
        {
          key: "profit-by-project",
          title: "Profit by Project",
          rowCount: summary.profitByProject.length,
          columns: ["Project", "Revenue", "Expenses", "Profit", "Margin"],
          rows: sortedProjectRows.slice(0, 8).map((entry) => ({
            id: entry.id,
            name: entry.name,
            revenue: entry.revenue,
            expenses: entry.expenses,
            profit: entry.profit,
            margin: entry.margin,
            href: buildHref("/profit", { projectId: entry.id }),
            sectionId: "profit-leaderboards-section",
            targetPageKey: "profit"
          }))
        }
      ],
      priorityItems: [
        ...summary.profitByRig
          .filter((entry) => entry.profit < 0 || entry.margin < 15)
          .sort((a, b) => a.profit - b.profit)
          .slice(0, 3)
          .map((entry) => ({
            id: `rig-${entry.id}`,
            label: `Rig • ${entry.name}`,
            reason:
              entry.profit < 0
                ? `Negative profit ${formatCurrency(entry.profit)} with ${formatPercent(entry.margin)} margin.`
                : `Low margin at ${formatPercent(entry.margin)} with ${formatCurrency(entry.profit)} profit.`,
            severity: entry.profit < 0 ? ("CRITICAL" as const) : ("HIGH" as const),
            amount: entry.profit,
            href: buildHref("/profit", { rigId: entry.id }),
            issueType: "PROFIT_PRESSURE",
            sectionId: "profit-leaderboards-section",
            targetPageKey: "profit"
          })),
        ...summary.costBreakdownByCategory
          .filter((entry) => entry.percentOfTotalExpenses >= 40)
          .slice(0, 2)
          .map((entry) => ({
            id: `cost-${entry.category}`,
            label: `Cost Driver • ${entry.category}`,
            reason: `${formatPercent(entry.percentOfTotalExpenses)} of total expenses (${formatCurrency(entry.totalCost)}).`,
            severity: entry.percentOfTotalExpenses >= 55 ? ("HIGH" as const) : ("MEDIUM" as const),
            amount: entry.totalCost,
            href: buildHref("/expenses", { category: entry.category }),
            issueType: "COST_DRIVER",
            sectionId: "profit-cost-detail-section",
            targetPageKey: "expenses"
          }))
      ],
      navigationTargets: [
        {
          label: "Open Expenses",
          href: buildHref("/expenses"),
          reason: "Inspect top cost drivers in detail.",
          pageKey: "expenses"
        },
        {
          label: "Open Forecasting",
          href: buildHref("/forecasting"),
          reason: "Validate scenario impact from profitability signals.",
          pageKey: "forecasting",
          sectionId: "forecast-kpi-section"
        },
        {
          label: "Open Budget vs Actual",
          href: buildHref("/cost-tracking/budget-vs-actual"),
          reason: "Review budget pressure behind profit variance.",
          pageKey: "budget-vs-actual"
        }
      ],
      notes: ["Profit copilot output is advisory-only and does not change financial data."]
    }),
    [
      buildHref,
      filters.clientId,
      filters.from,
      filters.rigId,
      filters.to,
      overallMargin,
      sortedProjectRows,
      sortedRigRows,
      summary.costBreakdownByCategory,
      summary.profitByProject,
      summary.profitByRig,
      summary.totals.totalExpenses,
      summary.totals.totalProfit,
      summary.totals.totalRevenue
    ]
  );

  useRegisterCopilotContext(copilotContext);

  useCopilotFocusTarget({
    pageKey: "profit",
    onFocus: (target) => {
      setFocusedSectionId(target.sectionId || null);
      scrollToFocusElement({
        sectionId: target.sectionId,
        targetId: target.targetId
      });
    }
  });

  useEffect(() => {
    if (!focusedSectionId) {
      return;
    }
    const timeout = window.setTimeout(() => {
      setFocusedSectionId(null);
    }, 2600);
    return () => window.clearTimeout(timeout);
  }, [focusedSectionId]);

  return (
    <AccessGate permission="finance:view">
      <div className="gf-page-stack">
        <FilterScopeBanner filters={filters} />

        <section
          id="profit-primary-kpi-section"
          className={cn(
            "gf-section",
            focusedSectionId === "profit-primary-kpi-section" &&
              "rounded-2xl ring-2 ring-indigo-100 ring-offset-2 ring-offset-slate-50"
          )}
        >
          <SectionHeader
            title="Primary Profit KPIs"
            description="Management-level profitability signals for the active scope."
          />
          <div className="gf-kpi-grid-primary">
            <MetricCard
              label={isScoped ? "Profit in Scope" : "Total Profit"}
              value={formatCurrency(summary.totals.totalProfit)}
              tone={totalProfitTone}
            />
            <MetricCard
              label="Profit Margin"
              value={formatPercent(overallMargin)}
              tone={overallMarginTone}
            />
            <MetricCard label="Highest Profit Rig" value={summary.kpis.highestProfitRig} tone="good" />
            <MetricCard label="Lowest Profit Rig" value={summary.kpis.lowestProfitRig} tone="danger" />
          </div>
        </section>

        <section
          id="profit-risk-section"
          className={cn(
            "gf-section",
            focusedSectionId === "profit-risk-section" && "rounded-2xl ring-2 ring-indigo-100 ring-offset-2 ring-offset-slate-50"
          )}
        >
          <SectionHeader
            title="Secondary Profit Signals"
            description="Supporting context for projects and margin efficiency."
          />
          <div className="gf-kpi-grid-secondary">
            <MetricCard label="Highest Profit Project" value={summary.kpis.highestProfitProject} />
            <MetricCard label="Lowest Profit Project" value={summary.kpis.lowestProfitProject} tone="danger" />
            <MetricCard label="Highest Margin Rig" value={summary.kpis.highestMarginRig} />
            <MetricCard label="Highest Margin Project" value={summary.kpis.highestMarginProject} />
          </div>
        </section>

        <section
          id="profit-trends-section"
          className={cn(
            "gf-section",
            focusedSectionId === "profit-trends-section" &&
              "rounded-2xl ring-2 ring-indigo-100 ring-offset-2 ring-offset-slate-50"
          )}
        >
          <SectionHeader
            title="Profit Risk Signals"
            description="Leak detection alerts with actionable guidance."
          />
          <Card title="Profit Leak Alerts" subtitle="Automatic detection of cost drivers and efficiency risks">
            <div className="space-y-2">
              {loading ? (
                <p className="text-sm text-ink-600">Analyzing profit leak signals...</p>
              ) : (
                profitAlerts.map((alert, index) => (
                  <div key={`${alert.title}-${index}`} className={`rounded-lg border px-3 py-2 ${alertToneClass[alert.tone]}`}>
                    <p className="text-xs font-semibold uppercase tracking-wide">{alert.title}</p>
                    <p className="mt-1 text-sm">{alert.message}</p>
                  </div>
                ))
              )}
            </div>
          </Card>
        </section>

        <section
          id="profit-leaderboards-section"
          className={cn(
            "gf-section",
            focusedSectionId === "profit-leaderboards-section" &&
              "rounded-2xl ring-2 ring-indigo-100 ring-offset-2 ring-offset-slate-50"
          )}
        >
          <SectionHeader
            title="Profit Trends and Drivers"
            description="Time-series and contribution views by rig, project, client, and margin."
          />
          <div className="gf-chart-grid">
          <Card
            title="Profit Trend Over Time"
            subtitle={summary.trendGranularity === "day" ? "Grouped by day" : "Grouped by month"}
            className="transition-shadow hover:shadow-md"
            onClick={() => {
              router.push(buildHref("/profit"));
            }}
            clickLabel="Open profit trend details"
            action={
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  void loadProfitSummary(true);
                }}
                className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs text-ink-700 hover:bg-slate-50"
              >
                <RotateCw size={12} className={refreshing ? "animate-spin" : ""} />
                Refresh
              </button>
            }
          >
            {loading ? (
              <p className="text-sm text-ink-600">Loading profit trend...</p>
            ) : summary.profitTrend.length === 0 ? (
              <p className="text-sm text-ink-600">No revenue or expense data in the selected period.</p>
            ) : (
              <LineTrendChart
                data={summary.profitTrend.map((entry) => ({
                  bucketStart: entry.bucketStart,
                  label: entry.label,
                  profit: entry.profit
                }))}
                xKey="label"
                yKey="profit"
                color="#15803d"
                clickHint="Click trend points to drill into profit period"
                onBackgroundClick={() => {
                  router.push(buildHref("/profit"));
                }}
                onElementClick={(entry) => {
                  const range = getBucketDateRange(entry.bucketStart);
                  if (!range) {
                    router.push(buildHref("/profit"));
                    return;
                  }
                  router.push(
                    buildHref("/profit", {
                      from: range.from,
                      to: range.to
                    })
                  );
                }}
              />
            )}
          </Card>

          <Card
            title="Profit by Rig"
            subtitle="Rig-level profit contribution in current scope."
            className="transition-shadow hover:shadow-md"
            onClick={() => {
              router.push(buildHref("/profit"));
            }}
            clickLabel="Open rig profit details"
          >
            {loading ? (
              <p className="text-sm text-ink-600">Loading...</p>
            ) : (
              <BarCategoryChart
                data={summary.profitByRig}
                xKey="name"
                yKey="profit"
                color="#166534"
                clickHint="Click rig bar to filter profit"
                onBackgroundClick={() => {
                  router.push(buildHref("/profit"));
                }}
                onElementClick={(entry) => {
                  router.push(buildHref("/profit", { rigId: entry.id }));
                }}
              />
            )}
          </Card>

          <Card
            title="Profit by Project"
            subtitle="Project-level profitability by selected filters."
            className="transition-shadow hover:shadow-md"
            onClick={() => {
              router.push(buildHref("/revenue"));
            }}
            clickLabel="Open project profit details"
          >
            {loading ? (
              <p className="text-sm text-ink-600">Loading...</p>
            ) : (
              <BarCategoryChart
                data={summary.profitByProject}
                xKey="name"
                yKey="profit"
                color="#0369a1"
                clickHint="Click project bar to drill into project revenue"
                onBackgroundClick={() => {
                  router.push(buildHref("/revenue"));
                }}
                onElementClick={(entry) => {
                  router.push(buildHref("/revenue", { projectId: entry.id }));
                }}
              />
            )}
          </Card>

          <Card
            title="Profit by Client"
            subtitle="Client contribution to total profit."
            className="transition-shadow hover:shadow-md"
            onClick={() => {
              router.push(buildHref("/profit"));
            }}
            clickLabel="Open client profit details"
          >
            {loading ? (
              <p className="text-sm text-ink-600">Loading...</p>
            ) : (
              <BarCategoryChart
                data={summary.profitByClient}
                xKey="name"
                yKey="profit"
                color="#1d4ed8"
                clickHint="Click client bar to filter profit"
                onBackgroundClick={() => {
                  router.push(buildHref("/profit"));
                }}
                onElementClick={(entry) => {
                  if (!entry.id || entry.id.startsWith("__unassigned")) {
                    router.push(buildHref("/profit", { clientId: null }));
                    return;
                  }
                  router.push(buildHref("/profit", { clientId: entry.id }));
                }}
              />
            )}
          </Card>

          <Card
            title="Profit Margin by Rig"
            subtitle="Efficiency view using margin percentage by rig."
            className="transition-shadow hover:shadow-md"
            onClick={() => {
              router.push(buildHref("/profit"));
            }}
            clickLabel="Open rig margin details"
          >
            {loading ? (
              <p className="text-sm text-ink-600">Loading...</p>
            ) : (
              <BarCategoryChart
                data={summary.marginByRig}
                xKey="name"
                yKey="margin"
                color="#15803d"
                clickHint="Click rig bar to filter margin details"
                onBackgroundClick={() => {
                  router.push(buildHref("/profit"));
                }}
                onElementClick={(entry) => {
                  if (!entry.id || entry.id.startsWith("__unassigned")) {
                    router.push(buildHref("/profit", { rigId: null }));
                    return;
                  }
                  router.push(buildHref("/profit", { rigId: entry.id }));
                }}
              />
            )}
          </Card>

          <Card
            title="Profit Margin by Project"
            subtitle="Project efficiency view based on margin percentage."
            className="transition-shadow hover:shadow-md"
            onClick={() => {
              router.push(buildHref("/revenue"));
            }}
            clickLabel="Open project margin details"
          >
            {loading ? (
              <p className="text-sm text-ink-600">Loading...</p>
            ) : (
              <BarCategoryChart
                data={summary.marginByProject}
                xKey="name"
                yKey="margin"
                color="#0284c7"
                clickHint="Click project bar to open project revenue"
                onBackgroundClick={() => {
                  router.push(buildHref("/revenue"));
                }}
                onElementClick={(entry) => {
                  router.push(buildHref("/revenue", { projectId: entry.id }));
                }}
              />
            )}
          </Card>

          <Card
            title="Cost Breakdown by Category"
            subtitle="Category-level cost drivers shaping profitability."
            className="transition-shadow hover:shadow-md"
            onClick={() => {
              router.push(buildHref("/expenses"));
            }}
            clickLabel="Open cost category details"
          >
            {loading ? (
              <p className="text-sm text-ink-600">Loading...</p>
            ) : summary.costBreakdownByCategory.length === 0 ? (
              <p className="text-sm text-ink-600">No expense data for selected filters.</p>
            ) : (
              <>
                <BarCategoryChart
                  data={summary.costBreakdownByCategory}
                  xKey="category"
                  yKey="totalCost"
                  color="#ea580c"
                  clickHint="Click category bar to drill into expenses"
                  onBackgroundClick={() => {
                    router.push(buildHref("/expenses"));
                  }}
                  onElementClick={(entry) => {
                    router.push(buildHref("/expenses", { category: entry.category }));
                  }}
                />
                <p className="mt-3 text-xs text-ink-600">{categoryInsight}</p>
              </>
            )}
          </Card>

          <Card
            title="Cost Mix (Fuel, Salaries, Maintenance, Consumables, Other)"
            subtitle="Grouped cost mix to explain margin pressure."
            className="transition-shadow hover:shadow-md"
            onClick={() => {
              router.push(buildHref("/expenses"));
            }}
            clickLabel="Open cost mix details"
          >
            {loading ? (
              <p className="text-sm text-ink-600">Loading...</p>
            ) : summary.costBreakdownByGroup.length === 0 ? (
              <p className="text-sm text-ink-600">No grouped cost data for selected filters.</p>
            ) : (
              <>
                <DonutStatusChart
                  data={summary.costBreakdownByGroup.map((entry) => ({
                    status: entry.category,
                    value: entry.totalCost
                  }))}
                  nameKey="status"
                  valueKey="value"
                  clickHint="Click cost group to open expenses"
                  onBackgroundClick={() => {
                    router.push(buildHref("/expenses"));
                  }}
                  onElementClick={(entry) => {
                    router.push(buildHref("/expenses", { category: entry.status }));
                  }}
                />
                <p className="mt-3 text-xs text-ink-600">{groupedCostInsight}</p>
              </>
            )}
          </Card>

          <Card
            title="Cost Breakdown by Rig (Stacked)"
            subtitle="Stacked rig cost view by major cost drivers."
            className="transition-shadow hover:shadow-md"
            onClick={() => {
              router.push(buildHref("/profit"));
            }}
            clickLabel="Open rig cost details"
          >
            {loading ? (
              <p className="text-sm text-ink-600">Loading...</p>
            ) : summary.costBreakdownByRig.length === 0 ? (
              <p className="text-sm text-ink-600">No rig-level expense data for selected filters.</p>
            ) : (
              <>
                <StackedBarChart
                  data={summary.costBreakdownByRig}
                  xKey="name"
                  stacks={[
                    { key: "fuel", label: "Fuel", color: "#f59e0b" },
                    { key: "salaries", label: "Salaries", color: "#0ea5e9" },
                    { key: "maintenance", label: "Maintenance", color: "#ef4444" },
                    { key: "consumables", label: "Consumables", color: "#8b5cf6" },
                    { key: "other", label: "Other", color: "#64748b" }
                  ]}
                  clickHint="Click rig stacks to filter profit by rig"
                  onBackgroundClick={() => {
                    router.push(buildHref("/profit"));
                  }}
                  onElementClick={(entry) => {
                    if (!entry.id || entry.id.startsWith("__unassigned")) {
                      router.push(buildHref("/profit", { rigId: null }));
                      return;
                    }
                    router.push(buildHref("/profit", { rigId: entry.id }));
                  }}
                />
                <p className="mt-3 text-xs text-ink-600">{rigCostInsight}</p>
              </>
            )}
          </Card>
          </div>
        </section>

        <section
          id="profit-cost-detail-section"
          className={cn(
            "gf-section",
            focusedSectionId === "profit-cost-detail-section" &&
              "rounded-2xl ring-2 ring-indigo-100 ring-offset-2 ring-offset-slate-50"
          )}
        >
          <SectionHeader
            title="Profit Leaderboards"
            description="Sortable profitability rankings for rigs and projects."
          />
          <div className="gf-chart-grid">
          <Card
            title="Profit by Rig"
            action={
              <SortSelect
                value={rigSortBy}
                onChange={setRigSortBy}
                labelPrefix="Rig"
              />
            }
          >
            {loading ? (
              <p className="text-sm text-ink-600">Loading rig profitability...</p>
            ) : (
              <DataTable
                columns={["Rig", "Revenue", "Expenses", "Profit", "Margin (%)"]}
                rows={sortedRigRows.map((entry) => [
                  entry.name,
                  formatCurrency(entry.revenue),
                  formatCurrency(entry.expenses),
                  formatCurrency(entry.profit),
                  formatPercent(entry.margin)
                ])}
              />
            )}
          </Card>

          <Card
            title="Profit by Project"
            action={
              <SortSelect
                value={projectSortBy}
                onChange={setProjectSortBy}
                labelPrefix="Project"
              />
            }
          >
            {loading ? (
              <p className="text-sm text-ink-600">Loading project profitability...</p>
            ) : (
              <DataTable
                columns={["Project", "Revenue", "Expenses", "Profit", "Margin (%)"]}
                rows={sortedProjectRows.map((entry) => [
                  entry.name,
                  formatCurrency(entry.revenue),
                  formatCurrency(entry.expenses),
                  formatCurrency(entry.profit),
                  formatPercent(entry.margin)
                ])}
              />
            )}
          </Card>
          </div>
        </section>

        <section className="gf-section">
          <SectionHeader
            title="Cost Detail Tables"
            description="Detailed category and rig-level expense structure for review."
          />
          <div className="gf-chart-grid">
          <Card title="Cost Breakdown Table">
            {loading ? (
              <p className="text-sm text-ink-600">Loading cost breakdown...</p>
            ) : (
              <DataTable
                columns={["Category", "Total Cost", "% of Total Expenses", "Status"]}
                rows={summary.costBreakdownByCategory.map((entry) => [
                  entry.category,
                  formatCurrency(entry.totalCost),
                  formatPercent(entry.percentOfTotalExpenses),
                  <StatusBadge
                    key={`${entry.category}-status`}
                    tone={costStatusTone(entry.percentOfTotalExpenses)}
                    label={costStatusLabel(entry.percentOfTotalExpenses)}
                  />
                ])}
              />
            )}
          </Card>

          <Card title="Per-Rig Cost Profile">
            {loading ? (
              <p className="text-sm text-ink-600">Loading rig cost profile...</p>
            ) : (
              <DataTable
                columns={["Rig", "Fuel", "Maintenance", "Salaries", "Consumables", "Other", "Total Expenses"]}
                rows={summary.costBreakdownByRig.map((entry) => [
                  entry.name,
                  formatCurrency(entry.fuel),
                  formatCurrency(entry.maintenance),
                  formatCurrency(entry.salaries),
                  formatCurrency(entry.consumables),
                  formatCurrency(entry.other),
                  formatCurrency(entry.totalExpenses)
                ])}
              />
            )}
          </Card>
          </div>
        </section>
      </div>
    </AccessGate>
  );
}

function SortSelect({
  value,
  onChange,
  labelPrefix
}: {
  value: "profit" | "margin";
  onChange: (value: "profit" | "margin") => void;
  labelPrefix: string;
}) {
  return (
    <label className="inline-flex items-center gap-2 text-xs text-ink-700">
      <span>Sort {labelPrefix}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value as "profit" | "margin")}
        className="rounded-md border border-slate-200 px-2 py-1 text-xs text-ink-900"
      >
        <option value="profit">Profit (High to Low)</option>
        <option value="margin">Margin (High to Low)</option>
      </select>
    </label>
  );
}

function sortProfitRows(rows: ProfitRow[], metric: "profit" | "margin") {
  return [...rows].sort((a, b) => {
    if (metric === "margin" && b.margin !== a.margin) {
      return b.margin - a.margin;
    }
    if (metric === "profit" && b.profit !== a.profit) {
      return b.profit - a.profit;
    }
    if (b.revenue !== a.revenue) {
      return b.revenue - a.revenue;
    }
    return a.name.localeCompare(b.name);
  });
}

function buildProfitAlerts(summary: ProfitSummary): ProfitAlert[] {
  const alerts: ProfitAlert[] = [];

  const highCostDrivers = summary.costBreakdownByCategory.filter((entry) => entry.percentOfTotalExpenses > 50);
  highCostDrivers.forEach((entry) => {
    alerts.push({
      tone: "danger",
      title: "High Cost Driver",
      message: `${entry.category} accounts for ${formatPercentCompact(entry.percentOfTotalExpenses)} of expenses.`
    });
  });

  const groupedCostTotals = new Map(summary.costBreakdownByGroup.map((entry) => [entry.key, entry.totalCost]));
  if (summary.totals.totalExpenses === 0) {
    alerts.push({
      tone: "warn",
      title: "Missing Cost Data",
      message: "No expense entries recorded for the selected filter. Leak detection is limited."
    });
  }

  if ((groupedCostTotals.get("maintenance") || 0) === 0) {
    alerts.push({
      tone: "warn",
      title: "Missing Data or Not Recorded",
      message: "No maintenance costs recorded in the selected filter."
    });
  }

  if ((groupedCostTotals.get("salaries") || 0) === 0) {
    alerts.push({
      tone: "warn",
      title: "Missing Data or Not Recorded",
      message: "No salaries costs recorded in the selected filter."
    });
  }

  const lowMarginRigs = summary.profitByRig.filter((row) => row.margin < 40);
  if (lowMarginRigs.length > 0) {
    const names = lowMarginRigs
      .slice(0, 3)
      .map((row) => row.name)
      .join(", ");
    alerts.push({
      tone: "warn",
      title: "Low Efficiency Rig",
      message:
        lowMarginRigs.length === 1
          ? `${names} margin is ${formatPercentCompact(lowMarginRigs[0].margin)} (below 40%).`
          : `${lowMarginRigs.length} rigs are below 40% margin (${names}${lowMarginRigs.length > 3 ? ", ..." : ""}).`
    });
  }

  if (summary.profitByRig.length === 1) {
    alerts.push({
      tone: "warn",
      title: "Limited Comparison Scope",
      message: "Only one rig in current filter."
    });
  }

  if (alerts.length === 0) {
    alerts.push({
      tone: "good",
      title: "Healthy Cost Profile",
      message: "No major cost leak indicators detected for current filters."
    });
  }

  return alerts;
}

function buildCategoryInsight(costBreakdownByCategory: ProfitSummary["costBreakdownByCategory"]) {
  const topCategory = costBreakdownByCategory[0];
  if (!topCategory) {
    return "No expense records available for this period.";
  }

  if (topCategory.percentOfTotalExpenses > 50) {
    return `${topCategory.category} dominates costs at ${formatPercentCompact(
      topCategory.percentOfTotalExpenses
    )}. Consider optimization strategies.`;
  }

  return `${topCategory.category} is the top expense category at ${formatPercentCompact(
    topCategory.percentOfTotalExpenses
  )}.`;
}

function buildGroupedCostInsight(costBreakdownByGroup: ProfitSummary["costBreakdownByGroup"]) {
  const sortedGroups = [...costBreakdownByGroup].sort((a, b) => b.totalCost - a.totalCost);
  const topGroup = sortedGroups[0];
  if (!topGroup) {
    return "No grouped cost data available for this period.";
  }

  const secondGroup = sortedGroups[1];
  if (!secondGroup) {
    return `${topGroup.category} is the only grouped cost recorded in this filter.`;
  }

  const combinedShare = topGroup.percentOfTotalExpenses + secondGroup.percentOfTotalExpenses;
  return `${topGroup.category} and ${secondGroup.category} combine for ${formatPercentCompact(combinedShare)} of expenses.`;
}

function buildRigCostInsight(costBreakdownByRig: ProfitSummary["costBreakdownByRig"]) {
  const topRig = costBreakdownByRig[0];
  if (!topRig) {
    return "No rig-level expense records available for this period.";
  }

  const dominantCategory = pickDominantRigCategory(topRig);
  return `${topRig.name} has the highest rig-linked expenses (${formatCurrency(
    topRig.totalExpenses
  )}), led by ${dominantCategory}.`;
}

function pickDominantRigCategory(row: ProfitSummary["costBreakdownByRig"][number]) {
  const entries: Array<{ label: string; value: number }> = [
    { label: "Fuel", value: row.fuel },
    { label: "Salaries", value: row.salaries },
    { label: "Maintenance", value: row.maintenance },
    { label: "Consumables", value: row.consumables },
    { label: "Other", value: row.other }
  ];

  return entries.reduce((max, entry) => (entry.value > max.value ? entry : max), entries[0]).label;
}

function costStatusTone(percentOfTotalExpenses: number): ProfitAlert["tone"] {
  if (percentOfTotalExpenses > 50) {
    return "danger";
  }
  if (percentOfTotalExpenses >= 25) {
    return "warn";
  }
  return "good";
}

function costStatusLabel(percentOfTotalExpenses: number) {
  if (percentOfTotalExpenses > 50) {
    return "High Cost Driver";
  }
  if (percentOfTotalExpenses >= 25) {
    return "Watch";
  }
  return "Healthy";
}

function formatPercentCompact(value: number) {
  const rounded = Math.round(value * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)}%`;
}

function StatusBadge({ tone, label }: { tone: ProfitAlert["tone"]; label: string }) {
  return (
    <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${badgeToneClass[tone]}`}>{label}</span>
  );
}

const alertToneClass: Record<ProfitAlert["tone"], string> = {
  danger: "border-red-200 bg-red-50 text-red-900",
  warn: "border-amber-200 bg-amber-50 text-amber-900",
  good: "border-emerald-200 bg-emerald-50 text-emerald-900"
};

const badgeToneClass: Record<ProfitAlert["tone"], string> = {
  danger: "border-red-200 bg-red-50 text-red-700",
  warn: "border-amber-200 bg-amber-50 text-amber-700",
  good: "border-emerald-200 bg-emerald-50 text-emerald-700"
};
