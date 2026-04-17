"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { RotateCw } from "lucide-react";
import type { ComponentType } from "react";

import { AccessGate } from "@/components/layout/access-gate";
import { AnalyticsEmptyState } from "@/components/layout/analytics-empty-state";
import { useAnalyticsFilters } from "@/components/layout/analytics-filters-provider";
import { Card, MetricCard } from "@/components/ui/card";
import { formatCurrency, formatPercent } from "@/lib/utils";

const LineTrendChart = dynamic(
  () => import("@/components/charts/line-trend-chart").then((module) => module.LineTrendChart),
  {
    loading: () => <p className="text-sm text-ink-600">Preparing profit trend chart...</p>
  }
) as ComponentType<{
  data: Array<Record<string, unknown>>;
  xKey: string;
  yKey: string;
  color?: string;
}>;

const SpendingProfitFlowChart = dynamic(
  () =>
    import("@/components/charts/spending-profit-flow-chart").then(
      (module) => module.SpendingProfitFlowChart
    ),
  {
    loading: () => <p className="text-sm text-ink-600">Preparing cash-flow chart...</p>
  }
);

interface ProfitTrendPoint {
  bucketStart: string;
  label: string;
  revenue: number;
  expenses: number;
  profit: number;
}

interface SpendingProfitSummaryPayload {
  totals: {
    totalRevenue: number;
    totalExpenses: number;
    totalProfit: number;
  };
  costBreakdownByCategory: Array<{
    category: string;
    totalCost: number;
    percentOfTotalExpenses: number;
  }>;
  trendGranularity: "day" | "month";
  profitTrend: ProfitTrendPoint[];
}

const emptySummary: SpendingProfitSummaryPayload = {
  totals: {
    totalRevenue: 0,
    totalExpenses: 0,
    totalProfit: 0
  },
  costBreakdownByCategory: [],
  trendGranularity: "day",
  profitTrend: []
};

export default function SpendingProfitPage() {
  const { filters, resetFilters, setFilters } = useAnalyticsFilters();
  const scopeProjectId = filters.projectId !== "all" ? filters.projectId : "";
  const isSingleProjectScope = scopeProjectId.length > 0;
  const [summary, setSummary] = useState<SpendingProfitSummaryPayload>(emptySummary);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const hasData = useMemo(
    () => summary.profitTrend.length > 0 || summary.totals.totalRevenue > 0 || summary.totals.totalExpenses > 0,
    [summary.profitTrend.length, summary.totals.totalExpenses, summary.totals.totalRevenue]
  );

  const loadSummary = useCallback(
    async (silent = false) => {
      if (!isSingleProjectScope) {
        setSummary(emptySummary);
        setLoading(false);
        setRefreshing(false);
        return;
      }

      if (silent) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }

      try {
        const search = new URLSearchParams();
        search.set("projectId", scopeProjectId);
        if (filters.from) search.set("from", filters.from);
        if (filters.to) search.set("to", filters.to);

        const query = search.toString();
        const response = await fetch(`/api/profit/summary${query ? `?${query}` : ""}`, { cache: "no-store" });
        const payload = response.ok ? ((await response.json()) as SpendingProfitSummaryPayload) : emptySummary;
        setSummary(payload || emptySummary);
      } catch {
        setSummary(emptySummary);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [filters.from, filters.to, isSingleProjectScope, scopeProjectId]
  );

  useEffect(() => {
    void loadSummary();
  }, [loadSummary]);

  const applyDatePreset = useCallback(
    (days: number) => {
      const end = new Date();
      end.setUTCHours(0, 0, 0, 0);
      const start = new Date(end);
      start.setUTCDate(end.getUTCDate() - Math.max(days - 1, 0));
      setFilters((current) => ({
        ...current,
        from: toDateIso(start),
        to: toDateIso(end)
      }));
    },
    [setFilters]
  );

  const margin = useMemo(() => {
    if (summary.totals.totalRevenue <= 0) {
      return 0;
    }
    return (summary.totals.totalProfit / summary.totals.totalRevenue) * 100;
  }, [summary.totals.totalProfit, summary.totals.totalRevenue]);

  const spendingHref = useMemo(() => {
    const search = new URLSearchParams();
    if (isSingleProjectScope) {
      search.set("projectId", scopeProjectId);
    }
    if (filters.from) search.set("from", filters.from);
    if (filters.to) search.set("to", filters.to);
    const query = search.toString();
    return query ? `/spending?${query}` : "/spending";
  }, [filters.from, filters.to, isSingleProjectScope, scopeProjectId]);

  const drillingWorkspaceHref = useMemo(() => {
    const search = new URLSearchParams();
    if (isSingleProjectScope) {
      search.set("projectId", scopeProjectId);
    }
    if (filters.from) search.set("from", filters.from);
    if (filters.to) search.set("to", filters.to);
    search.set("view", "drilling-reports");
    const query = search.toString();
    return query ? `/spending?${query}` : "/spending?view=drilling-reports";
  }, [filters.from, filters.to, isSingleProjectScope, scopeProjectId]);

  const marginTone = useMemo<"good" | "warn" | "danger">(() => {
    if (margin >= 40) return "good";
    if (margin >= 15) return "warn";
    return "danger";
  }, [margin]);

  const profitTone = useMemo<"good" | "danger">(
    () => (summary.totals.totalProfit >= 0 ? "good" : "danger"),
    [summary.totals.totalProfit]
  );

  const isFilteredEmpty = (filters.from || filters.to) && !hasData;

  const cashFlowSankey = useMemo(() => {
    const revenue = Math.max(0, summary.totals.totalRevenue);
    const expenses = Math.max(0, summary.totals.totalExpenses);
    const profit = summary.totals.totalProfit;
    if (revenue <= 0 || expenses <= 0) {
      return null;
    }

    return {
      revenue,
      expenses,
      profit,
      categories: summary.costBreakdownByCategory
        .filter((entry) => entry.totalCost > 0)
        .map((entry) => ({
          name: entry.category,
          value: entry.totalCost
        }))
    };
  }, [summary.costBreakdownByCategory, summary.totals.totalExpenses, summary.totals.totalProfit, summary.totals.totalRevenue]);

  return (
    <AccessGate denyBehavior="redirect"
      permission="finance:view"
      fallback={
        <Card title="Finance permission required">
          <p className="text-sm text-ink-700">
            Profit view is available to finance roles only.
          </p>
          <Link href={drillingWorkspaceHref} className="gf-btn-subtle mt-3 inline-flex">
            Open drilling reports in Project Operations
          </Link>
        </Card>
      }
    >
      <div className="gf-page-stack">
        {!isSingleProjectScope ? (
          <Card title="Select one project to continue">
            <p className="text-sm text-ink-700">
              Project Operations profit is project-first. Choose one project in the top bar to view project profit and margin.
            </p>
          </Card>
        ) : (
          <section className="gf-section">
            <Card
              title="Project profit view"
              subtitle="Operational finance view for the locked project."
              action={
                <Link href={spendingHref} className="gf-btn-subtle">
                  Back to Project Operations
                </Link>
              }
            >
              <div className="gf-kpi-grid-primary">
                <MetricCard label="Profit" value={formatCurrency(summary.totals.totalProfit)} tone={profitTone} />
                <MetricCard label="Margin" value={formatPercent(margin)} tone={marginTone} />
              </div>
            </Card>

            <Card
              title="Cash flow by category"
              subtitle="Revenue to expenses and profit, with expense category breakdown."
            >
              {!cashFlowSankey ? (
                <p className="text-sm text-ink-600">No cash-flow category data available in this scope.</p>
              ) : (
                <SpendingProfitFlowChart
                  revenue={cashFlowSankey.revenue}
                  expenses={cashFlowSankey.expenses}
                  profit={cashFlowSankey.profit}
                  categories={cashFlowSankey.categories}
                />
              )}
            </Card>

            <Card
              title="Profit trend over time"
              subtitle={summary.trendGranularity === "day" ? "Grouped by day" : "Grouped by month"}
              action={
                <button
                  type="button"
                  onClick={() => void loadSummary(true)}
                  className="gf-btn-subtle inline-flex items-center gap-1"
                >
                  <RotateCw size={13} className={refreshing ? "animate-spin" : ""} />
                  Refresh
                </button>
              }
            >
              {loading ? (
                <p className="text-sm text-ink-600">Loading profit trend...</p>
              ) : !hasData ? (
                <AnalyticsEmptyState
                  variant={isFilteredEmpty ? "filtered-empty" : "no-data"}
                  moduleHint="Create drilling reports and recognized project operations records to populate profit trend."
                  onClearFilters={resetFilters}
                  onLast30Days={() => applyDatePreset(30)}
                  onLast90Days={() => applyDatePreset(90)}
                />
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
                />
              )}
            </Card>
          </section>
        )}
      </div>
    </AccessGate>
  );
}

function toDateIso(value: Date) {
  return value.toISOString().slice(0, 10);
}
