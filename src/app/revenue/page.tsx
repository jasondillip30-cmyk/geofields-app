"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { RotateCw } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";

import { AccessGate } from "@/components/layout/access-gate";
import { useAnalyticsFilters } from "@/components/layout/analytics-filters-provider";
import { FilterScopeBanner, hasActiveScopeFilters } from "@/components/layout/filter-scope-banner";
import { Card, MetricCard } from "@/components/ui/card";
import { SectionHeader } from "@/components/ui/section-header";
import { DataTable } from "@/components/ui/table";
import { BarCategoryChart } from "@/components/charts/bar-category-chart";
import { LineTrendChart } from "@/components/charts/line-trend-chart";
import { buildScopedHref, getBucketDateRange } from "@/lib/drilldown";
import { formatCurrency } from "@/lib/utils";

interface RevenueBucket {
  id: string;
  name: string;
  revenue: number;
}

interface MonthlyPoint {
  bucketStart: string;
  label: string;
  revenue: number;
}

interface RevenueSummary {
  totals: {
    totalRevenue: number;
    reportsLogged: number;
  };
  trendGranularity: "day" | "month";
  revenueTrend: MonthlyPoint[];
  revenueByClient: RevenueBucket[];
  revenueByProject: RevenueBucket[];
  revenueByRig: RevenueBucket[];
}

const emptySummary: RevenueSummary = {
  totals: {
    totalRevenue: 0,
    reportsLogged: 0
  },
  trendGranularity: "day",
  revenueTrend: [],
  revenueByClient: [],
  revenueByProject: [],
  revenueByRig: []
};

export default function RevenuePage() {
  return (
    <Suspense fallback={<RevenuePageFallback />}>
      <RevenuePageContent />
    </Suspense>
  );
}

function RevenuePageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { filters } = useAnalyticsFilters();
  const [summary, setSummary] = useState<RevenueSummary>(emptySummary);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const projectIdFilter = searchParams.get("projectId") || "all";

  const loadRevenueSummary = useCallback(async (silent = false) => {
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
      if (projectIdFilter !== "all") search.set("projectId", projectIdFilter);

      const query = search.toString();
      const response = await fetch(`/api/revenue/summary${query ? `?${query}` : ""}`, {
        cache: "no-store"
      });

      const payload = response.ok ? await response.json() : emptySummary;
      setSummary(payload || emptySummary);
    } catch (_error) {
      setSummary(emptySummary);
    } finally {
      if (!silent) {
        setLoading(false);
      } else {
        setRefreshing(false);
      }
    }
  }, [filters.clientId, filters.from, filters.rigId, filters.to, projectIdFilter]);

  useEffect(() => {
    void loadRevenueSummary();
  }, [loadRevenueSummary]);

  useEffect(() => {
    const interval = setInterval(() => {
      void loadRevenueSummary(true);
    }, 8000);

    return () => clearInterval(interval);
  }, [loadRevenueSummary]);

  useEffect(() => {
    function onStorage(event: StorageEvent) {
      if (event.key === "gf:revenue-updated-at") {
        void loadRevenueSummary(true);
      }
    }

    function onFocus() {
      void loadRevenueSummary(true);
    }

    function onRevenueUpdate() {
      void loadRevenueSummary(true);
    }

    window.addEventListener("storage", onStorage);
    window.addEventListener("focus", onFocus);
    window.addEventListener("gf:revenue-updated", onRevenueUpdate);

    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("gf:revenue-updated", onRevenueUpdate);
    };
  }, [loadRevenueSummary]);

  const bestRig = useMemo(() => summary.revenueByRig[0]?.name || "N/A", [summary.revenueByRig]);
  const bestClient = useMemo(() => summary.revenueByClient[0]?.name || "N/A", [summary.revenueByClient]);
  const bestProject = useMemo(() => summary.revenueByProject[0]?.name || "N/A", [summary.revenueByProject]);
  const isScoped = hasActiveScopeFilters(filters);
  const buildHref = useCallback(
    (path: string, overrides?: Record<string, string | null | undefined>) =>
      buildScopedHref(filters, path, {
        ...(projectIdFilter !== "all" ? { projectId: projectIdFilter } : {}),
        ...overrides
      }),
    [filters, projectIdFilter]
  );

  return (
    <AccessGate permission="finance:view">
      <div className="gf-page-stack">
        <FilterScopeBanner filters={filters} />

        <section className="gf-section">
          <SectionHeader
            title="Primary Revenue KPIs"
            description="Core live revenue signals for the current scope."
          />
          <div className="gf-kpi-grid-primary">
          <MetricCard
            label={isScoped ? "Revenue in Scope (Live)" : "Total Revenue (Live)"}
            value={formatCurrency(summary.totals.totalRevenue)}
            tone="good"
          />
          <MetricCard label="Highest Revenue Rig" value={bestRig} />
          <MetricCard label="Highest Revenue Client" value={bestClient} />
          <MetricCard label="Best Project" value={bestProject} />
          </div>
        </section>

        <section className="gf-section">
          <SectionHeader
            title="Revenue Trends and Distribution"
            description="Trends are grouped by day or month based on date-range scope."
          />
          <div className="gf-chart-grid">
          <Card
            title="Revenue Trend (From Drilling Reports)"
            subtitle={summary.trendGranularity === "day" ? "Grouped by day" : "Grouped by month"}
            className="transition-shadow hover:shadow-md"
            onClick={() => {
              router.push(buildHref("/drilling-reports", { projectId: null }));
            }}
            clickLabel="Open drilling report revenue details"
            action={
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  void loadRevenueSummary(true);
                }}
                className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs text-ink-700 hover:bg-slate-50"
              >
                <RotateCw size={12} className={refreshing ? "animate-spin" : ""} />
                Refresh
              </button>
            }
          >
            {loading ? (
              <p className="text-sm text-ink-600">Loading live revenue trend...</p>
            ) : summary.revenueTrend.length === 0 ? (
              <p className="text-sm text-ink-600">No drilling report revenue data in the selected period.</p>
            ) : (
              <LineTrendChart
                data={summary.revenueTrend.map((entry) => ({
                  bucketStart: entry.bucketStart,
                  label: entry.label,
                  revenue: entry.revenue
                }))}
                xKey="label"
                yKey="revenue"
                clickHint="Click chart to view drilling reports"
                onBackgroundClick={() => {
                  router.push(buildHref("/drilling-reports", { projectId: null }));
                }}
                onElementClick={(point) => {
                  const range = getBucketDateRange(point.bucketStart);
                  if (!range) {
                    router.push(buildHref("/drilling-reports", { projectId: null }));
                    return;
                  }
                  router.push(
                    buildHref("/drilling-reports", {
                      projectId: null,
                      from: range.from,
                      to: range.to
                    })
                  );
                }}
              />
            )}
          </Card>

          <Card
            title="Revenue by Rig (Live)"
            subtitle="Grouped by rig for the active scope filters."
            className="transition-shadow hover:shadow-md"
            onClick={() => {
              router.push(buildHref("/revenue"));
            }}
            clickLabel="Open revenue by rig details"
          >
            {loading ? (
              <p className="text-sm text-ink-600">Loading...</p>
            ) : (
              <BarCategoryChart
                data={summary.revenueByRig}
                xKey="name"
                yKey="revenue"
                color="#0f766e"
                clickHint="Click rig bar to filter revenue by rig"
                onBackgroundClick={() => {
                  router.push(buildHref("/revenue"));
                }}
                onElementClick={(entry) => {
                  router.push(buildHref("/revenue", { rigId: entry.id }));
                }}
              />
            )}
          </Card>

          <Card
            title="Revenue by Project (Live)"
            subtitle="Project-level billable performance in the selected scope."
            className="transition-shadow hover:shadow-md"
            onClick={() => {
              router.push(buildHref("/revenue"));
            }}
            clickLabel="Open revenue by project details"
          >
            {loading ? (
              <p className="text-sm text-ink-600">Loading...</p>
            ) : (
              <BarCategoryChart
                data={summary.revenueByProject}
                xKey="name"
                yKey="revenue"
                color="#184ee0"
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
            title="Revenue by Client (Live)"
            subtitle="Client-level contribution to current revenue."
            className="transition-shadow hover:shadow-md"
            onClick={() => {
              router.push(buildHref("/revenue"));
            }}
            clickLabel="Open revenue by client details"
          >
            {loading ? (
              <p className="text-sm text-ink-600">Loading...</p>
            ) : (
              <BarCategoryChart
                data={summary.revenueByClient}
                xKey="name"
                yKey="revenue"
                clickHint="Click client bar to filter revenue by client"
                onBackgroundClick={() => {
                  router.push(buildHref("/revenue"));
                }}
                onElementClick={(entry) => {
                  router.push(buildHref("/revenue", { clientId: entry.id }));
                }}
              />
            )}
          </Card>
          </div>
        </section>

        <section className="gf-section">
          <SectionHeader
            title="Detailed Breakdown"
            description="Project-level leaderboard for deeper revenue review."
          />
          <Card title="Revenue Leaderboard (Project)">
            {loading ? (
              <p className="text-sm text-ink-600">Loading leaderboard...</p>
            ) : (
              <DataTable
                columns={["Project", "Revenue"]}
                rows={summary.revenueByProject.map((entry) => [entry.name, formatCurrency(entry.revenue)])}
              />
            )}
          </Card>
        </section>
      </div>
    </AccessGate>
  );
}

function RevenuePageFallback() {
  return (
    <AccessGate permission="finance:view">
      <div className="gf-page-stack">
        <Card title="Revenue">
          <p className="text-sm text-ink-600">Loading revenue view...</p>
        </Card>
      </div>
    </AccessGate>
  );
}
