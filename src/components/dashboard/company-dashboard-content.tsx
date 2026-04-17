"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";

import { Card, MetricCard } from "@/components/ui/card";
import { SectionHeader } from "@/components/ui/section-header";
import { DataTable } from "@/components/ui/table";
import { useAnalyticsFilters } from "@/components/layout/analytics-filters-provider";
import {
  FilterScopeBanner,
  hasActiveScopeFilters
} from "@/components/layout/filter-scope-banner";
import {
  AnalyticsEmptyState,
  getScopedKpiHelper,
  getScopedKpiValue
} from "@/components/layout/analytics-empty-state";
import { isDashboardSmartRecommendationsEnabled, isForecastingEnabled } from "@/lib/feature-flags";
import { formatCurrency, formatNumber } from "@/lib/utils";
import {
  buildDevFallbackSummary,
  DashboardEmptyState,
  DashboardSummarySkeleton,
  extractRecommendationRigName,
  isDashboardSummaryPayload,
  isMeaningfulEntity,
  normalizeDashboardSummaryPayload,
  readApiError,
  startOfCurrentWeekIso,
  todayIso,
  toIsoDate
} from "./company-dashboard-helpers";
import { emptySummary, type DashboardSummary, type RecommendationItem } from "./company-dashboard-types";

const CompanyDashboardRecommendationsCard = dynamic(
  () =>
    import("./company-dashboard-recommendations-card").then(
      (module) => module.CompanyDashboardRecommendationsCard
    ),
  {
    loading: () => (
      <Card title="Recommendations">
        <p className="text-sm text-ink-600">Loading recommendations...</p>
      </Card>
    )
  }
);

const CompanyDashboardTrendSection = dynamic(
  () => import("./company-dashboard-trend-section").then((module) => module.CompanyDashboardTrendSection),
  {
    loading: () => (
      <Card title="Trend Analytics">
        <p className="text-sm text-ink-600">Loading trend analytics...</p>
      </Card>
    )
  }
);

export function CompanyDashboard() {
  const router = useRouter();
  const { filters, setFilters, resetFilters } = useAnalyticsFilters();
  const debugLoggingEnabled = process.env.NEXT_PUBLIC_GEOFIELDS_DEBUG_DASHBOARD === "1";
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
  const forecastingEnabled = isForecastingEnabled();
  const inFlightFilterKeyRef = useRef<string | null>(null);
  const requestSequenceRef = useRef(0);
  const hasLoadedSummaryRef = useRef(false);

  useEffect(() => {
    hasLoadedSummaryRef.current = hasLoadedSummary;
  }, [hasLoadedSummary]);

  const loadSummary = useCallback(async () => {
    const filterKey = `${filters.clientId}|${filters.rigId}|${filters.from}|${filters.to}`;
    if (inFlightFilterKeyRef.current === filterKey) {
      if (debugLoggingEnabled) {
        console.info("[dashboard-summary][ui-fetch-skip-duplicate]", { filterKey });
      }
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
      if (debugLoggingEnabled) {
        console.info("[dashboard-summary][ui-fetch-start]", {
          query: query || "none",
          endpoint
        });
      }

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
      if (debugLoggingEnabled) {
        console.info("[dashboard-summary][ui-fetch-success]", {
          query: query || "none",
          snapshot: normalized.snapshot
        });
      }
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
  }, [debugLoggingEnabled, filters.clientId, filters.from, filters.rigId, filters.to]);

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
      } catch {
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
        project.contractRateLabel || `${project.contractRatePerM}/m`
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

      const forecastingHref = buildHref("/forecasting", rigOverrides);
      const profitHref = buildHref("/spending/profit", rigOverrides);
      let takeActionHref = forecastingEnabled ? forecastingHref : profitHref;
      let viewDetailsHref = forecastingEnabled ? profitHref : buildHref("/expenses", rigOverrides);

      if (has("inventory", "stock", "supplier", "parts", "warehouse")) {
        takeActionHref = buildHref("/inventory", rigOverrides);
        viewDetailsHref = buildHref("/inventory", rigOverrides);
      } else if (has("approval", "approved", "rejected", "pending")) {
        takeActionHref = buildHref("/approvals");
        viewDetailsHref = buildHref("/approvals");
      } else if (has("rig action", "reassign", "standby", "downtime")) {
        takeActionHref = buildHref("/maintenance", rigOverrides);
        viewDetailsHref = forecastingEnabled ? forecastingHref : buildHref("/rigs", rigOverrides);
      } else if (has("forecast", "projected", "utilization")) {
        takeActionHref = forecastingEnabled ? forecastingHref : profitHref;
        viewDetailsHref = profitHref;
      } else if (has("revenue", "billable", "contract")) {
        takeActionHref = buildHref("/spending", rigOverrides);
        viewDetailsHref = profitHref;
      } else if (has("cost", "expense", "fuel", "salary", "maintenance", "spend")) {
        takeActionHref = buildHref("/expenses", rigOverrides);
        viewDetailsHref = profitHref;
      } else if (has("loss", "profit")) {
        takeActionHref = profitHref;
        viewDetailsHref = buildHref("/expenses", rigOverrides);
      } else if (has("rig")) {
        takeActionHref = buildHref("/rigs", rigOverrides);
        viewDetailsHref = forecastingEnabled ? forecastingHref : buildHref("/rigs", rigOverrides);
      }

      if (takeActionHref === viewDetailsHref) {
        viewDetailsHref = buildHref("/activity-log");
      }

      return {
        takeActionHref,
        viewDetailsHref
      };
    },
    [buildHref, forecastingEnabled, rigIdByName]
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
  const loading = loadState === "loading";
  const isFilteredEmpty = !loading && hasScopeFilters && !hasAnyOperationalData;
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
      <FilterScopeBanner
        filters={filters}
        clientLabel={selectedClientLabel}
        rigLabel={selectedRigLabel}
        onClearFilters={handleClearFilters}
      />

      {errorMessage && (
        <Card title="Failed to load dashboard data" subtitle="Showing available layout while we retry in the background.">
          <p className="text-sm text-red-700">{visibleErrorMessage}</p>
        </Card>
      )}

      {!loading && !hasAnyOperationalData && (
        <Card title={isFilteredEmpty ? "No data for selected filters" : "No data recorded yet"}>
          <AnalyticsEmptyState
            variant={isFilteredEmpty ? "filtered-empty" : "no-data"}
            moduleHint="Add drilling reports and recognized expenses to populate the dashboard."
            scopeHint={`${summary.snapshot?.totalProjects ?? 0} projects in current scope • ${summary.snapshot?.totalRigs ?? 0} rigs in scope`}
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
                label={hasScopeFilters ? "Revenue (Scope)" : "Revenue"}
                value={getScopedKpiValue(formatCurrency(summary.snapshot?.totalRevenue ?? 0), isFilteredEmpty)}
                tone="good"
                href={buildHref("/spending")}
                change={getScopedKpiHelper(undefined, isFilteredEmpty)}
              />
              <MetricCard
                label={hasScopeFilters ? "Costs (Scope)" : "Costs"}
                value={getScopedKpiValue(formatCurrency(summary.snapshot?.totalExpenses ?? 0), isFilteredEmpty)}
                tone="warn"
                href={buildHref("/expenses")}
                change={getScopedKpiHelper(undefined, isFilteredEmpty)}
              />
              <MetricCard
                label={hasScopeFilters ? "Profit (Scope)" : "Profit"}
                value={getScopedKpiValue(formatCurrency(summary.snapshot?.grossProfit ?? 0), isFilteredEmpty)}
                tone={(summary.snapshot?.grossProfit ?? 0) >= 0 ? "good" : "danger"}
                href={buildHref("/spending/profit")}
                change={getScopedKpiHelper(undefined, isFilteredEmpty)}
              />
              <MetricCard
                label={hasScopeFilters ? "Margin (Scope)" : "Margin"}
                value={getScopedKpiValue(`${grossMarginPct.toFixed(1)}%`, isFilteredEmpty)}
                tone={grossMarginTone}
                href={buildHref("/spending/profit")}
                change={getScopedKpiHelper(undefined, isFilteredEmpty)}
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
                value={getScopedKpiValue(String(summary.snapshot?.totalClients ?? 0), isFilteredEmpty)}
                href={buildHref("/clients")}
                change={getScopedKpiHelper(undefined, isFilteredEmpty)}
              />
              <MetricCard
                label={hasScopeFilters ? "Projects in Scope" : "Total Projects"}
                value={getScopedKpiValue(String(summary.snapshot?.totalProjects ?? 0), isFilteredEmpty)}
                href={buildHref("/projects")}
                change={getScopedKpiHelper(undefined, isFilteredEmpty)}
              />
              <MetricCard
                label={hasScopeFilters ? "Rigs in Scope" : "Total Rigs"}
                value={getScopedKpiValue(String(summary.snapshot?.totalRigs ?? 0), isFilteredEmpty)}
                href={buildHref("/rigs")}
                change={getScopedKpiHelper(undefined, isFilteredEmpty)}
              />
              <MetricCard
                label="Active Rigs"
                value={getScopedKpiValue(String(summary.snapshot?.activeRigs ?? 0), isFilteredEmpty)}
                change={isFilteredEmpty ? "No data for current filters" : `${summary.snapshot?.idleRigs ?? 0} idle`}
                tone="good"
                href={buildHref("/rigs", { status: "ACTIVE" })}
              />
              <MetricCard
                label="Rigs Under Maintenance"
                value={getScopedKpiValue(String(summary.snapshot?.maintenanceRigs ?? 0), isFilteredEmpty)}
                tone="warn"
                href={buildHref("/rigs", { status: "MAINTENANCE" })}
                change={getScopedKpiHelper(undefined, isFilteredEmpty)}
              />
              <MetricCard
                label="Current Breakdowns"
                value={getScopedKpiValue(String(breakdownRigCount), isFilteredEmpty)}
                tone={breakdownRigCount > 0 ? "danger" : "good"}
                href={buildHref("/rigs", { status: "BREAKDOWN" })}
                change={getScopedKpiHelper(undefined, isFilteredEmpty)}
              />
              <MetricCard
                label="Total Meters Drilled"
                value={getScopedKpiValue(formatNumber(summary.snapshot?.totalMeters ?? 0), isFilteredEmpty)}
                href={buildHref("/drilling-reports")}
                change={getScopedKpiHelper(undefined, isFilteredEmpty)}
              />
              <MetricCard
                label="Pending Approvals"
                value={getScopedKpiValue(String(summary.snapshot?.pendingApprovals ?? 0), isFilteredEmpty)}
                tone={(summary.snapshot?.pendingApprovals ?? 0) > 0 ? "warn" : "good"}
                href={buildHref("/approvals")}
                change={getScopedKpiHelper(undefined, isFilteredEmpty)}
              />
              <MetricCard
                label="Approved Today"
                value={getScopedKpiValue(String(summary.snapshot?.approvedToday ?? 0), isFilteredEmpty)}
                tone={(summary.snapshot?.approvedToday ?? 0) > 0 ? "good" : "neutral"}
                href={buildHref("/approvals")}
                change={getScopedKpiHelper(undefined, isFilteredEmpty)}
              />
            </div>
          </section>

          {forecastingEnabled ? (
            <section className="gf-section">
              <SectionHeader
                title="Leaders and Forecast"
                description="Top performers and short-horizon forecast signals."
              />
              <div className="gf-kpi-grid-secondary">
                <MetricCard
                  label="Best Client"
                  value={getScopedKpiValue(summary.snapshot?.bestPerformingClient || "N/A", isFilteredEmpty)}
                  href={hasBestClientTarget ? buildHref(`/clients/${bestClientId || ""}`, { clientId: bestClientId }) : undefined}
                  disabled={!hasBestClientTarget}
                  change={getScopedKpiHelper(undefined, isFilteredEmpty)}
                />
                <MetricCard
                  label="Best Rig"
                  value={getScopedKpiValue(summary.snapshot?.bestPerformingRig || "N/A", isFilteredEmpty)}
                  href={hasBestRigTarget ? buildHref(`/rigs/${bestRigId || ""}`, { rigId: bestRigId }) : undefined}
                  disabled={!hasBestRigTarget}
                  change={getScopedKpiHelper(undefined, isFilteredEmpty)}
                />
                <MetricCard
                  label="Top Revenue Rig"
                  value={getScopedKpiValue(summary.snapshot?.topRevenueRig || "N/A", isFilteredEmpty)}
                  href={hasTopRevenueRigTarget ? buildHref("/spending", { rigId: topRevenueRigId }) : undefined}
                  disabled={!hasTopRevenueRigTarget}
                  change={getScopedKpiHelper(undefined, isFilteredEmpty)}
                />
                <MetricCard
                  label="Forecasted Profit (7 Days)"
                  value={getScopedKpiValue(formatCurrency(summary.profitForecast?.forecastNext7Profit ?? 0), isFilteredEmpty)}
                  tone={forecast7Tone}
                  href={buildHref("/forecasting")}
                  change={getScopedKpiHelper(undefined, isFilteredEmpty)}
                />
                <MetricCard
                  label="Forecasted Profit (30 Days)"
                  value={getScopedKpiValue(formatCurrency(summary.profitForecast?.forecastNext30Profit ?? 0), isFilteredEmpty)}
                  tone={forecast30Tone}
                  href={buildHref("/forecasting")}
                  change={getScopedKpiHelper(undefined, isFilteredEmpty)}
                />
                <MetricCard
                  label="Top Forecast Rig (30 Days)"
                  value={getScopedKpiValue(summary.profitForecast?.topForecastRig || "N/A", isFilteredEmpty)}
                  href={hasTopForecastRigTarget ? buildHref("/forecasting", { rigId: topForecastRigId }) : buildHref("/forecasting")}
                  disabled={!hasTopForecastRigTarget}
                  change={getScopedKpiHelper(undefined, isFilteredEmpty)}
                />
                <MetricCard
                  label="Rejected This Week"
                  value={getScopedKpiValue(String(summary.snapshot?.rejectedThisWeek ?? 0), isFilteredEmpty)}
                  tone={(summary.snapshot?.rejectedThisWeek ?? 0) > 0 ? "danger" : "good"}
                  href={buildHref("/activity-log", { action: "reject", from: startOfCurrentWeekIso(), to: todayIso() })}
                  change={getScopedKpiHelper(undefined, isFilteredEmpty)}
                />
              </div>
            </section>
          ) : null}
        </>
      )}

      {smartRecommendationsEnabled ? (
        <section className="gf-section">
          <SectionHeader
            title="Smart Recommendations"
            description={
              forecastingEnabled
                ? "Prioritized actions generated from live performance, cost, and forecast signals."
                : "Prioritized actions generated from live performance, cost, and operations signals."
            }
          />
          <CompanyDashboardRecommendationsCard
            loading={loading}
            recommendationCounts={recommendationCounts}
            recommendationSubtitle={recommendationSubtitle}
            recommendationsExpanded={recommendationsExpanded}
            recommendations={summary.recommendations}
            onToggleExpanded={() => {
              setRecommendationsToggleTouched(true);
              setRecommendationsExpanded((current) => !current);
            }}
            onNavigate={(href) => router.push(href)}
            resolveRecommendationTargets={resolveRecommendationTargets}
          />
        </section>
      ) : null}

      <CompanyDashboardTrendSection
        loading={loading}
        summary={summary}
        hasScopeFilters={hasScopeFilters}
        handleClearFilters={handleClearFilters}
        handleLast30Days={handleLast30Days}
        handleLast90Days={handleLast90Days}
        pushWithFilters={pushWithFilters}
        rigForecastRows={rigForecastRows}
        forecastInsight={forecastInsight}
        forecastingEnabled={forecastingEnabled}
      />

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
              isFiltered={hasScopeFilters}
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
