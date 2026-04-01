"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronRight } from "lucide-react";

import { Card, MetricCard } from "@/components/ui/card";
import { SectionHeader } from "@/components/ui/section-header";
import { DataTable } from "@/components/ui/table";
import { BarCategoryChart } from "@/components/charts/bar-category-chart";
import { DonutStatusChart } from "@/components/charts/donut-status-chart";
import { LineTrendChart } from "@/components/charts/line-trend-chart";
import { ActualVsForecastChart } from "@/components/charts/actual-vs-forecast-chart";
import { useAnalyticsFilters } from "@/components/layout/analytics-filters-provider";
import { hasActiveScopeFilters } from "@/components/layout/filter-scope-banner";
import { getBucketDateRange } from "@/lib/drilldown";
import { isDashboardSmartRecommendationsEnabled } from "@/lib/feature-flags";
import { formatCurrency, formatNumber } from "@/lib/utils";

interface FinancialPoint {
  bucketStart: string;
  label: string;
  revenue: number;
  expenses: number;
  profit: number;
}

interface RecommendationItem {
  tone: "danger" | "warn" | "good";
  priority: "HIGH" | "MEDIUM" | "LOW";
  title: string;
  message: string;
  estimatedImpact: number | null;
  actions: string[];
  primaryActionLabel: "Take Action" | "View Details";
  secondaryActionLabel?: "Take Action" | "View Details";
}

interface DashboardSummary {
  snapshot: {
    totalClients: number;
    totalProjects: number;
    totalRigs: number;
    activeRigs: number;
    idleRigs: number;
    maintenanceRigs: number;
    totalRevenue: number;
    totalExpenses: number;
    grossProfit: number;
    totalMeters: number;
    bestPerformingClient: string;
    bestPerformingClientId?: string | null;
    bestPerformingRig: string;
    bestPerformingRigId?: string | null;
    topRevenueRig: string;
    topRevenueRigId?: string | null;
    topForecastRig: string;
    topForecastRigId?: string | null;
    pendingApprovals: number;
    rejectedThisWeek: number;
    approvedToday: number;
  };
  trendGranularity: "day" | "month";
  financialTrend: FinancialPoint[];
  revenueByClient: Array<{ id?: string; name: string; revenue: number }>;
  revenueByRig: Array<{ id?: string; name: string; revenue: number }>;
  metersTrend: Array<{ bucketStart: string; label: string; meters: number }>;
  rigStatusData: Array<{ status: string; value: number }>;
  expenseBreakdown: Array<{ category: string; amount: number }>;
  projectAssignments: Array<{
    id: string;
    name: string;
    location: string;
    status: string;
    assignedRigCode: string;
    contractRatePerM: number;
  }>;
  recommendations: RecommendationItem[];
  profitForecast: {
    daysInScope: number;
    avgDailyProfit: number;
    forecastNext7Profit: number;
    forecastNext30Profit: number;
    projectedTotalProfit30: number;
    topForecastRig: string;
    actualVsForecastProfit: Array<{
      bucketStart: string;
      label: string;
      actualProfit: number | null;
      forecastProfit: number | null;
    }>;
    forecastByRig: Array<{
      id: string;
      name: string;
      currentProfit: number;
      avgDailyProfit: number;
      forecastNext30Profit: number;
    }>;
  };
}

const emptySummary: DashboardSummary = {
  snapshot: {
    totalClients: 0,
    totalProjects: 0,
    totalRigs: 0,
    activeRigs: 0,
    idleRigs: 0,
    maintenanceRigs: 0,
    totalRevenue: 0,
    totalExpenses: 0,
    grossProfit: 0,
    totalMeters: 0,
    bestPerformingClient: "N/A",
    bestPerformingClientId: null,
    bestPerformingRig: "N/A",
    bestPerformingRigId: null,
    topRevenueRig: "N/A",
    topRevenueRigId: null,
    topForecastRig: "N/A",
    topForecastRigId: null,
    pendingApprovals: 0,
    rejectedThisWeek: 0,
    approvedToday: 0
  },
  trendGranularity: "day",
  financialTrend: [],
  revenueByClient: [],
  revenueByRig: [],
  metersTrend: [],
  rigStatusData: [],
  expenseBreakdown: [],
  projectAssignments: [],
  recommendations: [],
  profitForecast: {
    daysInScope: 1,
    avgDailyProfit: 0,
    forecastNext7Profit: 0,
    forecastNext30Profit: 0,
    projectedTotalProfit30: 0,
    topForecastRig: "N/A",
    actualVsForecastProfit: [],
    forecastByRig: []
  }
};

export function CompanyDashboard() {
  const router = useRouter();
  const { filters, setFilters, resetFilters } = useAnalyticsFilters();
  const [summary, setSummary] = useState<DashboardSummary>(emptySummary);
  const [loadState, setLoadState] = useState<"loading" | "success" | "error">("loading");
  const [hasLoadedSummary, setHasLoadedSummary] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [recommendationsExpanded, setRecommendationsExpanded] = useState(false);
  const [recommendationsToggleTouched, setRecommendationsToggleTouched] = useState(false);
  const [filterLabels, setFilterLabels] = useState<{
    clients: Map<string, string>;
    rigs: Map<string, string>;
  }>({
    clients: new Map(),
    rigs: new Map()
  });
  const smartRecommendationsEnabled = isDashboardSmartRecommendationsEnabled();
  const inFlightFilterKeyRef = useRef<string | null>(null);
  const requestSequenceRef = useRef(0);
  const hasLoadedSummaryRef = useRef(false);

  useEffect(() => {
    hasLoadedSummaryRef.current = hasLoadedSummary;
  }, [hasLoadedSummary]);

  const loadSummary = useCallback(async () => {
    const filterKey = `${filters.clientId}|${filters.rigId}|${filters.from}|${filters.to}`;
    if (inFlightFilterKeyRef.current === filterKey) {
      console.info("[dashboard-summary][ui-fetch-skip-duplicate]", { filterKey });
      return;
    }

    inFlightFilterKeyRef.current = filterKey;
    requestSequenceRef.current += 1;
    const requestId = requestSequenceRef.current;
    setLoadState((current) => (hasLoadedSummaryRef.current ? current : "loading"));
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 15000);
    const watchdogId = window.setTimeout(() => {
      if (requestSequenceRef.current !== requestId) {
        return;
      }

      console.error("[dashboard-summary][ui-fetch-watchdog-timeout]", {
        requestId,
        filterKey
      });
      setErrorMessage("Dashboard request timed out.");
      setLoadState("error");

      if (!hasLoadedSummaryRef.current && process.env.NODE_ENV !== "production") {
        setSummary(buildDevFallbackSummary());
      }

      controller.abort();
    }, 5000);

    try {
      const search = new URLSearchParams();
      if (filters.from) search.set("from", filters.from);
      if (filters.to) search.set("to", filters.to);
      if (filters.clientId !== "all") search.set("clientId", filters.clientId);
      if (filters.rigId !== "all") search.set("rigId", filters.rigId);

      const query = search.toString();
      const endpoint = `/api/dashboard/summary${query ? `?${query}` : ""}`;
      console.info("[dashboard-summary][ui-fetch-start]", {
        query: query || "none",
        endpoint
      });

      const response = await fetch(`/api/dashboard/summary${query ? `?${query}` : ""}`, {
        cache: "no-store",
        signal: controller.signal
      });
      const responseBodyClone = response.clone();

      if (!response.ok) {
        const apiError = await readApiError(response, "Failed to load company dashboard summary.");
        const rawBody = (await responseBodyClone.text().catch(() => "")).trim();
        if (requestSequenceRef.current !== requestId) {
          return;
        }
        setErrorMessage(apiError);
        setLoadState("error");

        if (!hasLoadedSummaryRef.current && process.env.NODE_ENV !== "production") {
          setSummary(buildDevFallbackSummary());
        }

        console.error("[dashboard-summary][ui-fetch-error]", {
          status: response.status,
          query: query || "none",
          error: apiError,
          body: rawBody || "(empty)"
        });
        return;
      }

      const payload = (await response.json()) as unknown;
      if (!isDashboardSummaryPayload(payload)) {
        if (requestSequenceRef.current !== requestId) {
          return;
        }
        setErrorMessage("Dashboard response was invalid.");
        setLoadState("error");

        if (!hasLoadedSummaryRef.current && process.env.NODE_ENV !== "production") {
          setSummary(buildDevFallbackSummary());
        }

        console.error("[dashboard-summary][ui-invalid-payload]", {
          query: query || "none",
          payload
        });
        return;
      }

      const normalized = normalizeDashboardSummaryPayload(payload);
      if (requestSequenceRef.current !== requestId) {
        return;
      }
      setSummary(normalized);
      setHasLoadedSummary(true);
      hasLoadedSummaryRef.current = true;
      setErrorMessage(null);
      setLoadState("success");
      console.info("[dashboard-summary][ui-fetch-success]", {
        query: query || "none",
        snapshot: normalized.snapshot
      });
    } catch (error) {
      if (requestSequenceRef.current !== requestId) {
        return;
      }
      const message = error instanceof Error ? error.message : "Failed to load company dashboard summary.";
      setErrorMessage(message);
      setLoadState("error");

      if (!hasLoadedSummaryRef.current && process.env.NODE_ENV !== "production") {
        setSummary(buildDevFallbackSummary());
      }

      console.error("[dashboard-summary][ui-unhandled-error]", {
        error,
        query: `${filters.clientId}|${filters.rigId}|${filters.from}|${filters.to}`
      });
    } finally {
      window.clearTimeout(timeoutId);
      window.clearTimeout(watchdogId);
      if (inFlightFilterKeyRef.current === filterKey) {
        inFlightFilterKeyRef.current = null;
      }
    }
  }, [filters.clientId, filters.from, filters.rigId, filters.to]);

  useEffect(() => {
    void loadSummary();
  }, [loadSummary]);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    async function loadFilterLabels() {
      try {
        const [clientsRes, rigsRes] = await Promise.all([
          fetch("/api/clients", { cache: "no-store", signal: controller.signal }),
          fetch("/api/rigs", { cache: "no-store", signal: controller.signal })
        ]);
        if (!clientsRes.ok || !rigsRes.ok) {
          return;
        }

        const [clientsPayload, rigsPayload] = await Promise.all([clientsRes.json(), rigsRes.json()]);
        if (cancelled) {
          return;
        }

        setFilterLabels({
          clients: new Map(
            (clientsPayload.data || []).map((entry: { id: string; name: string }) => [
              entry.id,
              entry.name || entry.id
            ])
          ),
          rigs: new Map(
            (rigsPayload.data || []).map((entry: { id: string; rigCode?: string; name?: string }) => [
              entry.id,
              entry.name || entry.rigCode || entry.id
            ])
          )
        });
      } catch (_error) {
        if (cancelled) {
          return;
        }
        setFilterLabels({
          clients: new Map(),
          rigs: new Map()
        });
      }
    }

    void loadFilterLabels();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, []);

  useEffect(() => {
    function onStorage(event: StorageEvent) {
      if (event.key === "gf:revenue-updated-at" || event.key === "gf:profit-updated-at") {
        void loadSummary();
      }
    }

    function onFocus() {
      void loadSummary();
    }

    function onLiveUpdate() {
      void loadSummary();
    }

    window.addEventListener("storage", onStorage);
    window.addEventListener("focus", onFocus);
    window.addEventListener("gf:revenue-updated", onLiveUpdate);
    window.addEventListener("gf:profit-updated", onLiveUpdate);

    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("gf:revenue-updated", onLiveUpdate);
      window.removeEventListener("gf:profit-updated", onLiveUpdate);
    };
  }, [loadSummary]);

  const leaderboardRows = useMemo(
    () =>
      summary.projectAssignments.map((project) => [
        project.name,
        project.location,
        project.status,
        project.assignedRigCode,
        `${project.contractRatePerM}/m`
      ]),
    [summary.projectAssignments]
  );
  const rigForecastRows = useMemo(
    () =>
      summary.profitForecast.forecastByRig.map((entry) => [
        entry.name,
        formatCurrency(entry.currentProfit),
        formatCurrency(entry.avgDailyProfit),
        formatCurrency(entry.forecastNext30Profit)
      ]),
    [summary.profitForecast.forecastByRig]
  );
  const forecastInsight = useMemo(() => {
    if (summary.profitForecast.daysInScope <= 0) {
      return "Forecast is unavailable for the current filter scope.";
    }
    return `At current rate, profit will reach ${formatCurrency(summary.profitForecast.projectedTotalProfit30)} in 30 days.`;
  }, [summary.profitForecast.daysInScope, summary.profitForecast.projectedTotalProfit30]);
  const forecast7Tone = useMemo(
    () => (summary.profitForecast.forecastNext7Profit >= 0 ? "good" : "danger"),
    [summary.profitForecast.forecastNext7Profit]
  );
  const forecast30Tone = useMemo(
    () => (summary.profitForecast.forecastNext30Profit >= 0 ? "good" : "danger"),
    [summary.profitForecast.forecastNext30Profit]
  );
  const topFiltersQuery = useMemo(() => {
    const search = new URLSearchParams();
    if (filters.from) search.set("from", filters.from);
    if (filters.to) search.set("to", filters.to);
    if (filters.clientId !== "all") search.set("clientId", filters.clientId);
    if (filters.rigId !== "all") search.set("rigId", filters.rigId);
    return search;
  }, [filters.clientId, filters.from, filters.rigId, filters.to]);
  const buildHref = useCallback(
    (path: string, overrides?: Record<string, string | null | undefined>) => {
      const search = new URLSearchParams(topFiltersQuery.toString());
      if (overrides) {
        for (const [key, value] of Object.entries(overrides)) {
          if (value === null || value === undefined || value === "") {
            search.delete(key);
          } else {
            search.set(key, value);
          }
        }
      }
      const query = search.toString();
      return query ? `${path}?${query}` : path;
    },
    [topFiltersQuery]
  );
  const pushWithFilters = useCallback(
    (path: string, overrides?: Record<string, string | null | undefined>) => {
      router.push(buildHref(path, overrides));
    },
    [buildHref, router]
  );
  const rigIdByName = useMemo(() => {
    const lookup = new Map<string, string>();
    for (const rig of summary.revenueByRig) {
      if (rig.id) {
        lookup.set(rig.name.trim().toLowerCase(), rig.id);
      }
    }
    for (const rig of summary.profitForecast.forecastByRig) {
      lookup.set(rig.name.trim().toLowerCase(), rig.id);
    }
    return lookup;
  }, [summary.profitForecast.forecastByRig, summary.revenueByRig]);
  const recommendationCounts = useMemo(() => {
    const critical = summary.recommendations.filter((item) => item.tone === "danger" || item.priority === "HIGH").length;
    const warning = summary.recommendations.filter((item) => item.tone === "warn").length;
    const opportunity = summary.recommendations.filter((item) => item.tone === "good").length;
    return {
      critical,
      warning,
      opportunity,
      total: summary.recommendations.length
    };
  }, [summary.recommendations]);
  const recommendationSubtitle = useMemo(() => {
    if (recommendationCounts.total === 0) {
      return "No recommendations in the current filter scope.";
    }
    return `${recommendationCounts.critical} critical • ${recommendationCounts.warning} warning • ${recommendationCounts.opportunity} opportunity`;
  }, [recommendationCounts.critical, recommendationCounts.opportunity, recommendationCounts.total, recommendationCounts.warning]);
  const resolveRecommendationTargets = useCallback(
    (item: RecommendationItem) => {
      const text = `${item.title} ${item.message} ${item.actions.join(" ")}`.toLowerCase();
      const has = (...tokens: string[]) => tokens.some((token) => text.includes(token));
      const recommendationRigName = extractRecommendationRigName(item);
      const recommendationRigId = recommendationRigName ? rigIdByName.get(recommendationRigName.toLowerCase()) || null : null;
      const rigOverrides = recommendationRigId ? { rigId: recommendationRigId } : undefined;

      let takeActionHref = buildHref("/forecasting", rigOverrides);
      let viewDetailsHref = buildHref("/profit", rigOverrides);

      if (has("inventory", "stock", "supplier", "parts", "warehouse")) {
        takeActionHref = buildHref("/inventory", rigOverrides);
        viewDetailsHref = buildHref("/inventory", rigOverrides);
      } else if (has("approval", "approved", "rejected", "pending")) {
        takeActionHref = buildHref("/approvals");
        viewDetailsHref = buildHref("/approvals");
      } else if (has("rig action", "reassign", "standby", "downtime")) {
        takeActionHref = buildHref("/maintenance", rigOverrides);
        viewDetailsHref = buildHref("/forecasting", rigOverrides);
      } else if (has("forecast", "projected", "utilization")) {
        takeActionHref = buildHref("/forecasting", rigOverrides);
        viewDetailsHref = buildHref("/profit", rigOverrides);
      } else if (has("revenue", "billable", "contract")) {
        takeActionHref = buildHref("/revenue", rigOverrides);
        viewDetailsHref = buildHref("/profit", rigOverrides);
      } else if (has("cost", "expense", "fuel", "salary", "maintenance", "spend")) {
        takeActionHref = buildHref("/expenses", rigOverrides);
        viewDetailsHref = buildHref("/profit", rigOverrides);
      } else if (has("loss", "profit")) {
        takeActionHref = buildHref("/profit", rigOverrides);
        viewDetailsHref = buildHref("/expenses", rigOverrides);
      } else if (has("rig")) {
        takeActionHref = buildHref("/rigs", rigOverrides);
        viewDetailsHref = buildHref("/forecasting", rigOverrides);
      }

      if (takeActionHref === viewDetailsHref) {
        viewDetailsHref = buildHref("/activity-log");
      }

      return {
        takeActionHref,
        viewDetailsHref
      };
    },
    [buildHref, rigIdByName]
  );
  useEffect(() => {
    if (recommendationsToggleTouched) {
      return;
    }
    const shouldAutoExpand = summary.recommendations.some((item) => item.tone === "danger" || item.priority === "HIGH");
    setRecommendationsExpanded(shouldAutoExpand);
  }, [recommendationsToggleTouched, summary.recommendations]);
  const bestClientId = summary.snapshot?.bestPerformingClientId || summary.revenueByClient[0]?.id || null;
  const bestRigId = summary.snapshot?.bestPerformingRigId || summary.revenueByRig[0]?.id || null;
  const topRevenueRigId = summary.snapshot?.topRevenueRigId || summary.revenueByRig[0]?.id || null;
  const topForecastRigId = summary.snapshot?.topForecastRigId || summary.profitForecast.forecastByRig[0]?.id || null;
  const hasBestClientTarget = Boolean(bestClientId) && isMeaningfulEntity(summary.snapshot?.bestPerformingClient);
  const hasBestRigTarget = Boolean(bestRigId) && isMeaningfulEntity(summary.snapshot?.bestPerformingRig);
  const hasTopRevenueRigTarget = Boolean(topRevenueRigId) && isMeaningfulEntity(summary.snapshot?.topRevenueRig);
  const hasTopForecastRigTarget = Boolean(topForecastRigId) && isMeaningfulEntity(summary.snapshot?.topForecastRig);
  const hasScopeFilters = hasActiveScopeFilters(filters);
  const breakdownRigCount = useMemo(
    () => summary.rigStatusData.find((entry) => entry.status.toUpperCase() === "BREAKDOWN")?.value || 0,
    [summary.rigStatusData]
  );
  const grossMarginPct = useMemo(() => {
    const revenue = summary.snapshot?.totalRevenue ?? 0;
    if (revenue <= 0) {
      return 0;
    }
    return ((summary.snapshot?.grossProfit ?? 0) / revenue) * 100;
  }, [summary.snapshot?.grossProfit, summary.snapshot?.totalRevenue]);
  const grossMarginTone = useMemo<"good" | "warn" | "danger">(() => {
    if (grossMarginPct >= 40) {
      return "good";
    }
    if (grossMarginPct >= 15) {
      return "warn";
    }
    return "danger";
  }, [grossMarginPct]);
  const hasAnyOperationalData = useMemo(
    () =>
      summary.financialTrend.length > 0 ||
      summary.revenueByClient.length > 0 ||
      summary.revenueByRig.length > 0 ||
      summary.metersTrend.length > 0 ||
      summary.expenseBreakdown.length > 0 ||
      summary.projectAssignments.length > 0 ||
      summary.profitForecast.actualVsForecastProfit.length > 0 ||
      (summary.snapshot?.totalRevenue ?? 0) > 0 ||
      (summary.snapshot?.totalExpenses ?? 0) > 0 ||
      (summary.snapshot?.totalMeters ?? 0) > 0,
    [
      summary.expenseBreakdown.length,
      summary.financialTrend.length,
      summary.metersTrend.length,
      summary.profitForecast.actualVsForecastProfit.length,
      summary.projectAssignments.length,
      summary.revenueByClient.length,
      summary.revenueByRig.length,
      summary.snapshot?.totalExpenses,
      summary.snapshot?.totalMeters,
      summary.snapshot?.totalRevenue
    ]
  );
  const selectedClientLabel = useMemo(() => {
    if (filters.clientId === "all") {
      return "All clients";
    }
    return filterLabels.clients.get(filters.clientId) || filters.clientId;
  }, [filterLabels.clients, filters.clientId]);
  const selectedRigLabel = useMemo(() => {
    if (filters.rigId === "all") {
      return "All rigs";
    }
    return filterLabels.rigs.get(filters.rigId) || filters.rigId;
  }, [filterLabels.rigs, filters.rigId]);
  const dateRangeLabel = useMemo(() => {
    if (!filters.from && !filters.to) {
      return "Any date";
    }
    return `${formatDateForScope(filters.from) || "Any"} - ${formatDateForScope(filters.to) || "Any"}`;
  }, [filters.from, filters.to]);
  const loading = loadState === "loading";
  const visibleErrorMessage =
    process.env.NODE_ENV === "production" ? "Please try again in a moment." : errorMessage;
  const applyDatePreset = useCallback(
    (days: number) => {
      const end = new Date();
      end.setUTCHours(0, 0, 0, 0);
      const start = new Date(end);
      start.setUTCDate(end.getUTCDate() - Math.max(days - 1, 0));

      setFilters((current) => ({
        ...current,
        from: toIsoDate(start),
        to: toIsoDate(end)
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
    <div className="gf-page-stack">
      <Card title="Filter Scope" subtitle="Current dashboard scope from the top filter bar">
        <div className="space-y-3">
          <p className="text-sm text-ink-700">
            {hasScopeFilters
              ? `Showing data for: ${selectedClientLabel} • ${selectedRigLabel} • ${dateRangeLabel}`
              : "Showing data for: All data"}
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleClearFilters}
              className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs text-ink-700 hover:bg-slate-50"
            >
              Clear filters
            </button>
            <button
              type="button"
              onClick={handleLast30Days}
              className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs text-ink-700 hover:bg-slate-50"
            >
              Last 30 days
            </button>
            <button
              type="button"
              onClick={handleLast90Days}
              className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs text-ink-700 hover:bg-slate-50"
            >
              Last 90 days
            </button>
          </div>
        </div>
      </Card>

      {errorMessage && (
        <Card title="Failed to load dashboard data" subtitle="Showing available layout while we retry in the background.">
          <p className="text-sm text-red-700">{visibleErrorMessage}</p>
        </Card>
      )}

      {!loading && !hasAnyOperationalData && (
        <Card title="No data for current filters" subtitle="The dashboard is working, but your current scope returned no records.">
          <DashboardEmptyState
            message="No revenue, expenses, or drilling activity found for the selected filters."
            onClearFilters={handleClearFilters}
            onLast30Days={handleLast30Days}
            onLast90Days={handleLast90Days}
          />
        </Card>
      )}

      {loading ? (
        <section className="gf-section">
          <SectionHeader
            title="Drilling Profitability KPIs"
            description="Loading drilling-focused financial performance."
          />
          <DashboardSummarySkeleton count={4} />
        </section>
      ) : (
        <>
          <section className="gf-section">
            <SectionHeader
              title="Drilling Profitability KPIs"
              description="Core drilling revenue, cost, and margin outcomes for the selected scope."
            />
            <div className="gf-kpi-grid-primary">
              <MetricCard
                label={hasScopeFilters ? "Revenue (Scope)" : "Total Revenue"}
                value={formatCurrency(summary.snapshot?.totalRevenue ?? 0)}
                tone="good"
                href={buildHref("/revenue")}
              />
              <MetricCard
                label={hasScopeFilters ? "Costs (Scope)" : "Total Costs"}
                value={formatCurrency(summary.snapshot?.totalExpenses ?? 0)}
                tone="warn"
                href={buildHref("/expenses")}
              />
              <MetricCard
                label={hasScopeFilters ? "Profit (Scope)" : "Gross Profit"}
                value={formatCurrency(summary.snapshot?.grossProfit ?? 0)}
                tone={(summary.snapshot?.grossProfit ?? 0) >= 0 ? "good" : "danger"}
                href={buildHref("/profit")}
              />
              <MetricCard
                label={hasScopeFilters ? "Margin (Scope)" : "Profit Margin"}
                value={`${grossMarginPct.toFixed(1)}%`}
                tone={grossMarginTone}
                href={buildHref("/profit")}
              />
            </div>
          </section>

          <section className="gf-section">
            <SectionHeader
              title="Operational Scope KPIs"
              description="Entity coverage and operational activity for the current filters."
            />
            <div className="gf-kpi-grid-secondary">
              <MetricCard
                label={hasScopeFilters ? "Clients in Scope" : "Total Clients"}
                value={String(summary.snapshot?.totalClients ?? 0)}
                href={buildHref("/clients")}
              />
              <MetricCard
                label={hasScopeFilters ? "Projects in Scope" : "Total Projects"}
                value={String(summary.snapshot?.totalProjects ?? 0)}
                href={buildHref("/projects")}
              />
              <MetricCard
                label={hasScopeFilters ? "Rigs in Scope" : "Total Rigs"}
                value={String(summary.snapshot?.totalRigs ?? 0)}
                href={buildHref("/rigs")}
              />
              <MetricCard
                label="Active Rigs"
                value={String(summary.snapshot?.activeRigs ?? 0)}
                change={`${summary.snapshot?.idleRigs ?? 0} idle`}
                tone="good"
                href={buildHref("/rigs", { status: "ACTIVE" })}
              />
              <MetricCard
                label="Rigs Under Maintenance"
                value={String(summary.snapshot?.maintenanceRigs ?? 0)}
                tone="warn"
                href={buildHref("/rigs", { status: "MAINTENANCE" })}
              />
              <MetricCard
                label="Current Breakdowns"
                value={String(breakdownRigCount)}
                tone={breakdownRigCount > 0 ? "danger" : "good"}
                href={buildHref("/rigs", { status: "BREAKDOWN" })}
              />
              <MetricCard
                label="Total Meters Drilled"
                value={formatNumber(summary.snapshot?.totalMeters ?? 0)}
                href={buildHref("/drilling-reports")}
              />
              <MetricCard
                label="Pending Approvals"
                value={String(summary.snapshot?.pendingApprovals ?? 0)}
                tone={(summary.snapshot?.pendingApprovals ?? 0) > 0 ? "warn" : "good"}
                href={buildHref("/approvals")}
              />
              <MetricCard
                label="Approved Today"
                value={String(summary.snapshot?.approvedToday ?? 0)}
                tone={(summary.snapshot?.approvedToday ?? 0) > 0 ? "good" : "neutral"}
                href={buildHref("/approvals")}
              />
            </div>
          </section>

          <section className="gf-section">
            <SectionHeader
              title="Leaders and Forecast"
              description="Top performers and short-horizon forecast signals."
            />
            <div className="gf-kpi-grid-secondary">
              <MetricCard
                label="Best Client"
                value={summary.snapshot?.bestPerformingClient || "N/A"}
                href={hasBestClientTarget ? buildHref(`/clients/${bestClientId || ""}`, { clientId: bestClientId }) : undefined}
                disabled={!hasBestClientTarget}
              />
              <MetricCard
                label="Best Rig"
                value={summary.snapshot?.bestPerformingRig || "N/A"}
                href={hasBestRigTarget ? buildHref(`/rigs/${bestRigId || ""}`, { rigId: bestRigId }) : undefined}
                disabled={!hasBestRigTarget}
              />
              <MetricCard
                label="Top Revenue Rig"
                value={summary.snapshot?.topRevenueRig || "N/A"}
                href={hasTopRevenueRigTarget ? buildHref("/revenue", { rigId: topRevenueRigId }) : undefined}
                disabled={!hasTopRevenueRigTarget}
              />
              <MetricCard
                label="Forecasted Profit (7 Days)"
                value={formatCurrency(summary.profitForecast?.forecastNext7Profit ?? 0)}
                tone={forecast7Tone}
                href={buildHref("/forecasting")}
              />
              <MetricCard
                label="Forecasted Profit (30 Days)"
                value={formatCurrency(summary.profitForecast?.forecastNext30Profit ?? 0)}
                tone={forecast30Tone}
                href={buildHref("/forecasting")}
              />
              <MetricCard
                label="Top Forecast Rig (30 Days)"
                value={summary.profitForecast?.topForecastRig || "N/A"}
                href={hasTopForecastRigTarget ? buildHref("/forecasting", { rigId: topForecastRigId }) : buildHref("/forecasting")}
                disabled={!hasTopForecastRigTarget}
              />
              <MetricCard
                label="Rejected This Week"
                value={String(summary.snapshot?.rejectedThisWeek ?? 0)}
                tone={(summary.snapshot?.rejectedThisWeek ?? 0) > 0 ? "danger" : "good"}
                href={buildHref("/activity-log", { action: "reject", from: startOfCurrentWeekIso(), to: todayIso() })}
              />
            </div>
          </section>
        </>
      )}

      {smartRecommendationsEnabled ? (
        <section className="gf-section">
          <SectionHeader
            title="Smart Recommendations"
            description="Prioritized actions generated from live performance, cost, and forecast signals."
          />
          <Card
            title={`Smart Recommendations (${recommendationCounts.total})`}
            subtitle={loading ? "Suggested actions based on live performance and forecast" : recommendationSubtitle}
            action={
              !loading && recommendationCounts.total > 0 ? (
                <button
                  type="button"
                  onClick={() => {
                    setRecommendationsToggleTouched(true);
                    setRecommendationsExpanded((current) => !current);
                  }}
                  className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-ink-700 hover:bg-slate-50"
                >
                  <span>{recommendationsExpanded ? "Collapse" : "Expand"}</span>
                  {recommendationsExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                </button>
              ) : undefined
            }
          >
            {loading ? (
              <p className="text-sm text-ink-600">Building recommendations...</p>
            ) : recommendationCounts.total === 0 ? (
              <p className="text-sm text-ink-600">No recommendations available for the current filter scope.</p>
            ) : !recommendationsExpanded ? (
              <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                <div className="flex flex-wrap gap-2 text-[11px] font-semibold uppercase tracking-wide">
                  <span className="rounded-full bg-red-100 px-2 py-0.5 text-red-700">
                    {recommendationCounts.critical} critical
                  </span>
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-700">
                    {recommendationCounts.warning} warning
                  </span>
                  <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-emerald-700">
                    {recommendationCounts.opportunity} opportunity
                  </span>
                </div>
                <p className="text-xs text-ink-600">Recommendations are collapsed to keep the dashboard compact.</p>
              </div>
            ) : (
              <div className="space-y-1.5">
                {summary.recommendations.map((item, index) => {
                  const targets = resolveRecommendationTargets(item);
                  const primaryHref = item.primaryActionLabel === "Take Action" ? targets.takeActionHref : targets.viewDetailsHref;
                  const secondaryLabel = item.secondaryActionLabel;
                  let secondaryHref: string | null = null;
                  if (secondaryLabel) {
                    secondaryHref = secondaryLabel === "Take Action" ? targets.takeActionHref : targets.viewDetailsHref;
                    if (secondaryHref === primaryHref) {
                      secondaryHref = secondaryLabel === "Take Action" ? targets.viewDetailsHref : targets.takeActionHref;
                    }
                  }
                  const actionPreview = item.actions.slice(0, 2).join(" • ");

                  return (
                    <div
                      key={`${item.title}-${index}`}
                      className={`rounded-md border px-3 py-2 ${recommendationToneClass[item.tone]}`}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <p className="text-[11px] font-semibold uppercase tracking-wide">{item.title}</p>
                            <span
                              className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${priorityToneClass[item.priority]}`}
                            >
                              {item.priority}
                            </span>
                            {item.estimatedImpact !== null && (
                              <span className="text-[11px] font-medium text-ink-700">
                                Impact: +{formatCurrency(item.estimatedImpact)}
                              </span>
                            )}
                          </div>
                          <p className="mt-0.5 text-xs leading-5">{item.message}</p>
                          {actionPreview && <p className="mt-1 text-[11px] text-ink-700">Next: {actionPreview}</p>}
                        </div>
                        <div className="flex shrink-0 items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => {
                              router.push(primaryHref);
                            }}
                            className="rounded-md border border-slate-300 bg-white px-2 py-1 text-[11px] font-medium text-ink-800 hover:bg-slate-50"
                          >
                            {item.primaryActionLabel}
                          </button>
                          {secondaryLabel && secondaryHref && (
                            <button
                              type="button"
                              onClick={() => {
                                router.push(secondaryHref);
                              }}
                              className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] text-ink-700 hover:bg-slate-100"
                            >
                              {secondaryLabel}
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </section>
      ) : null}

      <section className="gf-section">
        <SectionHeader
          title="Trend Analytics"
          description="Revenue, profit, rig activity, and forecast visuals for executive drill-down."
        />
        <div className="gf-chart-grid">
        <Card
          title="Monthly Revenue vs Expenses"
          subtitle="Financial trend and margin view"
          className="transition-shadow hover:shadow-md"
          onClick={() => {
            pushWithFilters("/revenue");
          }}
          clickLabel="Open revenue details"
        >
          {loading ? (
            <p className="text-sm text-ink-600">Loading financial trend...</p>
          ) : summary.financialTrend.length === 0 ? (
            <DashboardEmptyState
              message="No revenue or expense trend data for selected filters."
              onClearFilters={handleClearFilters}
              onLast30Days={handleLast30Days}
              onLast90Days={handleLast90Days}
            />
          ) : (
            <LineTrendChart
              data={summary.financialTrend}
              xKey="label"
              yKey="revenue"
              secondaryKey="expenses"
              clickHint="Click to view revenue details"
              onBackgroundClick={() => {
                pushWithFilters("/revenue");
              }}
              onElementClick={(entry) => {
                const range = getBucketDateRange(entry.bucketStart);
                if (!range) {
                  pushWithFilters("/revenue");
                  return;
                }
                pushWithFilters("/revenue", {
                  from: range.from,
                  to: range.to
                });
              }}
            />
          )}
        </Card>

        <Card
          title="Profit Trend Over Time"
          subtitle="Revenue minus expenses by period"
          className="transition-shadow hover:shadow-md"
          onClick={() => {
            pushWithFilters("/profit");
          }}
          clickLabel="Open profit details"
        >
          {loading ? (
            <p className="text-sm text-ink-600">Loading profit trend...</p>
          ) : summary.financialTrend.length === 0 ? (
            <DashboardEmptyState
              message="No profit trend data for selected filters."
              onClearFilters={handleClearFilters}
              onLast30Days={handleLast30Days}
              onLast90Days={handleLast90Days}
            />
          ) : (
            <LineTrendChart
              data={summary.financialTrend.map((entry) => ({
                bucketStart: entry.bucketStart,
                label: entry.label,
                profit: entry.profit
              }))}
              xKey="label"
              yKey="profit"
              color="#0f766e"
              clickHint="Click to view profit details"
              onBackgroundClick={() => {
                pushWithFilters("/profit");
              }}
              onElementClick={(entry) => {
                const range = getBucketDateRange(entry.bucketStart);
                if (!range) {
                  pushWithFilters("/profit");
                  return;
                }
                pushWithFilters("/profit", {
                  from: range.from,
                  to: range.to
                });
              }}
            />
          )}
        </Card>

        <Card
          title="Actual vs Forecast Profit"
          subtitle="Historical cumulative profit vs projected next 30 days"
          className="transition-shadow hover:shadow-md"
          onClick={() => {
            pushWithFilters("/forecasting");
          }}
          clickLabel="Open forecasting details"
        >
          {loading ? (
            <p className="text-sm text-ink-600">Loading profit forecast...</p>
          ) : summary.profitForecast.actualVsForecastProfit.length === 0 ? (
            <DashboardEmptyState
              message="Not enough data to build a forecast for selected filters."
              onClearFilters={handleClearFilters}
              onLast30Days={handleLast30Days}
              onLast90Days={handleLast90Days}
            />
          ) : (
            <>
              <ActualVsForecastChart
                data={summary.profitForecast.actualVsForecastProfit}
                xKey="label"
                actualKey="actualProfit"
                forecastKey="forecastProfit"
                clickHint="Click to open forecasting"
                onBackgroundClick={() => {
                  pushWithFilters("/forecasting");
                }}
                onElementClick={(entry) => {
                  const range = getBucketDateRange(entry.bucketStart);
                  if (!range) {
                    pushWithFilters("/forecasting");
                    return;
                  }
                  pushWithFilters("/forecasting", {
                    from: range.from,
                    to: range.to
                  });
                }}
              />
              <p className="mt-3 text-xs text-ink-600">{forecastInsight}</p>
            </>
          )}
        </Card>

        <Card
          title="Revenue by Client"
          subtitle="Client contribution to revenue in the selected scope."
          className="transition-shadow hover:shadow-md"
          onClick={() => {
            pushWithFilters("/revenue");
          }}
          clickLabel="Open revenue by client details"
        >
          {loading ? (
            <p className="text-sm text-ink-600">Loading...</p>
          ) : summary.revenueByClient.length === 0 ? (
            <DashboardEmptyState
              message="No revenue data by client for selected filters."
              onClearFilters={handleClearFilters}
              onLast30Days={handleLast30Days}
              onLast90Days={handleLast90Days}
            />
          ) : (
            <BarCategoryChart
              data={summary.revenueByClient}
              xKey="name"
              yKey="revenue"
              clickHint="Click client bar to drill into revenue"
              onBackgroundClick={() => {
                pushWithFilters("/revenue");
              }}
              onElementClick={(entry) => {
                pushWithFilters("/revenue", {
                  clientId: entry.id || null
                });
              }}
            />
          )}
        </Card>

        <Card
          title="Revenue by Rig"
          subtitle="Rig revenue distribution for the current filters."
          className="transition-shadow hover:shadow-md"
          onClick={() => {
            pushWithFilters("/revenue");
          }}
          clickLabel="Open revenue by rig details"
        >
          {loading ? (
            <p className="text-sm text-ink-600">Loading...</p>
          ) : summary.revenueByRig.length === 0 ? (
            <DashboardEmptyState
              message="No revenue data by rig for selected filters."
              onClearFilters={handleClearFilters}
              onLast30Days={handleLast30Days}
              onLast90Days={handleLast90Days}
            />
          ) : (
            <BarCategoryChart
              data={summary.revenueByRig}
              xKey="name"
              yKey="revenue"
              color="#0f766e"
              clickHint="Click rig bar to drill into revenue"
              onBackgroundClick={() => {
                pushWithFilters("/revenue");
              }}
              onElementClick={(entry) => {
                pushWithFilters("/revenue", {
                  rigId: entry.id || null
                });
              }}
            />
          )}
        </Card>

        <Card
          title="Meters Drilled Trend"
          subtitle="Drilling output trend by selected period."
          className="transition-shadow hover:shadow-md"
          onClick={() => {
            pushWithFilters("/drilling-reports");
          }}
          clickLabel="Open drilling report details"
        >
          {loading ? (
            <p className="text-sm text-ink-600">Loading...</p>
          ) : summary.metersTrend.length === 0 ? (
            <DashboardEmptyState
              message="No drilling activity for current filters."
              onClearFilters={handleClearFilters}
              onLast30Days={handleLast30Days}
              onLast90Days={handleLast90Days}
            />
          ) : (
            <LineTrendChart
              data={summary.metersTrend}
              xKey="label"
              yKey="meters"
              color="#1c3d8e"
              clickHint="Click to open drilling reports"
              onBackgroundClick={() => {
                pushWithFilters("/drilling-reports");
              }}
              onElementClick={(entry) => {
                const range = getBucketDateRange(entry.bucketStart);
                if (!range) {
                  pushWithFilters("/drilling-reports");
                  return;
                }
                pushWithFilters("/drilling-reports", {
                  from: range.from,
                  to: range.to
                });
              }}
            />
          )}
        </Card>

        <Card
          title="Active vs Idle vs Maintenance"
          subtitle="Current rig utilization status mix."
          className="transition-shadow hover:shadow-md"
          onClick={() => {
            pushWithFilters("/rigs");
          }}
          clickLabel="Open rig status details"
        >
          {loading ? (
            <p className="text-sm text-ink-600">Loading...</p>
          ) : summary.rigStatusData.length === 0 ? (
            <DashboardEmptyState
              message="No rig status data for selected filters."
              onClearFilters={handleClearFilters}
              onLast30Days={handleLast30Days}
              onLast90Days={handleLast90Days}
            />
          ) : (
            <DonutStatusChart
              data={summary.rigStatusData}
              nameKey="status"
              valueKey="value"
              clickHint="Click status slice to view rigs"
              onBackgroundClick={() => {
                pushWithFilters("/rigs");
              }}
              onElementClick={(entry) => {
                pushWithFilters("/rigs", {
                  status: entry.status
                });
              }}
            />
          )}
        </Card>

        <Card
          title="Expense Breakdown by Category"
          subtitle="Category-level expense concentrations."
          className="xl:col-span-2 transition-shadow hover:shadow-md"
          onClick={() => {
            pushWithFilters("/expenses");
          }}
          clickLabel="Open expense breakdown details"
        >
          {loading ? (
            <p className="text-sm text-ink-600">Loading...</p>
          ) : summary.expenseBreakdown.length === 0 ? (
            <DashboardEmptyState
              message="No expenses recorded in this date range."
              onClearFilters={handleClearFilters}
              onLast30Days={handleLast30Days}
              onLast90Days={handleLast90Days}
            />
          ) : (
            <BarCategoryChart
              data={summary.expenseBreakdown}
              xKey="category"
              yKey="amount"
              color="#f59e0b"
              clickHint="Click category bar to drill into expenses"
              onBackgroundClick={() => {
                pushWithFilters("/expenses");
              }}
              onElementClick={(entry) => {
                pushWithFilters("/expenses", {
                  category: entry.category
                });
              }}
            />
          )}
        </Card>

        <Card
          title="Profit Forecast by Rig (Next 30 Days)"
          subtitle="Projected rig profitability based on current trend."
          className="xl:col-span-2"
        >
          {loading ? (
            <p className="text-sm text-ink-600">Loading rig forecast...</p>
          ) : summary.profitForecast.forecastByRig.length === 0 ? (
            <DashboardEmptyState
              message="No rig-level profit forecast available for selected filters."
              onClearFilters={handleClearFilters}
              onLast30Days={handleLast30Days}
              onLast90Days={handleLast90Days}
            />
          ) : (
            <DataTable
              columns={["Rig", "Current Profit", "Avg Daily Profit", "Forecast Profit (30 Days)"]}
              rows={rigForecastRows}
            />
          )}
        </Card>
        </div>
      </section>

      <section className="gf-section">
        <SectionHeader
          title="Detailed Operations View"
          description="Project-to-rig assignment details for operational follow-up."
        />
        <Card title="Project Assignment Overview" subtitle="Rig assignment visibility for current filter scope">
          {loading ? (
            <p className="text-sm text-ink-600">Loading project assignments...</p>
          ) : leaderboardRows.length === 0 ? (
            <DashboardEmptyState
              message="No project assignments found for current filters."
              onClearFilters={handleClearFilters}
              onLast30Days={handleLast30Days}
              onLast90Days={handleLast90Days}
            />
          ) : (
            <DataTable
              columns={["Project", "Location", "Status", "Assigned Rig", "Rate per Meter"]}
              rows={leaderboardRows}
            />
          )}
        </Card>
      </section>
    </div>
  );
}

const recommendationToneClass: Record<RecommendationItem["tone"], string> = {
  danger: "border-red-200 bg-red-50 text-red-900",
  warn: "border-amber-200 bg-amber-50 text-amber-900",
  good: "border-emerald-200 bg-emerald-50 text-emerald-900"
};

const priorityToneClass: Record<RecommendationItem["priority"], string> = {
  HIGH: "bg-red-100 text-red-800",
  MEDIUM: "bg-amber-100 text-amber-800",
  LOW: "bg-emerald-100 text-emerald-800"
};

function extractRecommendationRigName(item: RecommendationItem) {
  const titleMatch = item.title.match(/rig action:\s*(.+)$/i);
  if (titleMatch && titleMatch[1]) {
    return titleMatch[1].trim();
  }

  const codeMatch = `${item.title} ${item.message}`.match(/\bGF-RIG-[A-Z0-9-]+\b/i);
  if (codeMatch && codeMatch[0]) {
    return codeMatch[0].trim();
  }

  return null;
}

function isMeaningfulEntity(value: string | null | undefined) {
  if (!value) {
    return false;
  }
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  return normalized !== "n/a" && normalized !== "unavailable" && !normalized.startsWith("no ");
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function startOfCurrentWeekIso() {
  const date = new Date();
  const day = date.getUTCDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  date.setUTCDate(date.getUTCDate() + mondayOffset);
  return date.toISOString().slice(0, 10);
}

function toIsoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function formatDateForScope(value: string) {
  if (!value) {
    return "";
  }

  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleDateString("en-US");
}

async function readApiError(response: Response, fallbackMessage: string) {
  const clone = response.clone();
  const payload = await response.json().catch(() => null);
  if (payload && typeof payload === "object" && "message" in payload) {
    const message = payload.message;
    if (typeof message === "string" && message.trim()) {
      return message;
    }
  }

  const rawBody = (await clone.text().catch(() => "")).trim();
  if (rawBody) {
    return rawBody;
  }

  return `${fallbackMessage} (HTTP ${response.status})`;
}

function isDashboardSummaryPayload(payload: unknown): payload is Partial<DashboardSummary> {
  if (!payload || typeof payload !== "object") {
    return false;
  }

  const candidate = payload as Partial<DashboardSummary>;
  if (!candidate.snapshot || typeof candidate.snapshot !== "object") {
    return false;
  }

  return true;
}

function normalizeDashboardSummaryPayload(payload: Partial<DashboardSummary>): DashboardSummary {
  const snapshot = payload.snapshot ?? {};
  const profitForecast: Partial<DashboardSummary["profitForecast"]> = payload.profitForecast ?? {};

  return {
    ...emptySummary,
    ...payload,
    snapshot: {
      ...emptySummary.snapshot,
      ...snapshot
    },
    financialTrend: Array.isArray(payload.financialTrend) ? payload.financialTrend : [],
    revenueByClient: Array.isArray(payload.revenueByClient) ? payload.revenueByClient : [],
    revenueByRig: Array.isArray(payload.revenueByRig) ? payload.revenueByRig : [],
    metersTrend: Array.isArray(payload.metersTrend) ? payload.metersTrend : [],
    rigStatusData: Array.isArray(payload.rigStatusData) ? payload.rigStatusData : [],
    expenseBreakdown: Array.isArray(payload.expenseBreakdown) ? payload.expenseBreakdown : [],
    projectAssignments: Array.isArray(payload.projectAssignments) ? payload.projectAssignments : [],
    recommendations: Array.isArray(payload.recommendations) ? payload.recommendations : [],
    profitForecast: {
      ...emptySummary.profitForecast,
      ...profitForecast,
      actualVsForecastProfit: Array.isArray(profitForecast.actualVsForecastProfit)
        ? profitForecast.actualVsForecastProfit
        : [],
      forecastByRig: Array.isArray(profitForecast.forecastByRig) ? profitForecast.forecastByRig : []
    }
  };
}

function buildDevFallbackSummary(): DashboardSummary {
  return {
    ...emptySummary,
    snapshot: {
      ...emptySummary.snapshot,
      bestPerformingClient: "Unavailable",
      bestPerformingRig: "Unavailable",
      topRevenueRig: "Unavailable",
      topForecastRig: "Unavailable"
    }
  };
}

function DashboardSummarySkeleton({ count = 8 }: { count?: number }) {
  return (
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {Array.from({ length: count }).map((_, index) => (
        <div key={`kpi-skeleton-${index}`} className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="h-3 w-24 animate-pulse rounded bg-slate-200" />
          <div className="mt-3 h-7 w-20 animate-pulse rounded bg-slate-200" />
          <div className="mt-3 h-3 w-16 animate-pulse rounded bg-slate-100" />
        </div>
      ))}
    </section>
  );
}

function DashboardEmptyState({
  message,
  onClearFilters,
  onLast30Days,
  onLast90Days
}: {
  message: string;
  onClearFilters: () => void;
  onLast30Days: () => void;
  onLast90Days: () => void;
}) {
  return (
    <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-4 text-center">
      <p className="text-sm font-medium text-ink-800">{message}</p>
      <p className="mt-1 text-xs text-ink-600">Try adjusting or clearing filters.</p>
      <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
        <button
          type="button"
          onClick={onClearFilters}
          className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs text-ink-700 hover:bg-slate-100"
        >
          Clear filters
        </button>
        <button
          type="button"
          onClick={onLast30Days}
          className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs text-ink-700 hover:bg-slate-100"
        >
          Last 30 days
        </button>
        <button
          type="button"
          onClick={onLast90Days}
          className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs text-ink-700 hover:bg-slate-100"
        >
          Last 90 days
        </button>
      </div>
    </div>
  );
}
