"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { LineTrendChart } from "@/components/charts/line-trend-chart";
import { AccessGate } from "@/components/layout/access-gate";
import { useRegisterCopilotContext } from "@/components/layout/ai-copilot-context";
import { useAnalyticsFilters } from "@/components/layout/analytics-filters-provider";
import { scrollToFocusElement, useCopilotFocusTarget } from "@/components/layout/copilot-focus-target";
import { FilterScopeBanner } from "@/components/layout/filter-scope-banner";
import { Card, MetricCard } from "@/components/ui/card";
import { SectionHeader } from "@/components/ui/section-header";
import { DataTable } from "@/components/ui/table";
import type { CopilotPageContext } from "@/lib/ai/contextual-copilot";
import { buildScopedHref, getBucketDateRange } from "@/lib/drilldown";
import { cn, formatCurrency, formatPercent } from "@/lib/utils";
import { Select } from "./forecasting-page-components";
import { ScenarioBuilderCard } from "./forecasting-scenario-builder-card";
import {
  CUSTOM_CATEGORY_OPTION, MAX_COMPARE_SCENARIOS, SCENARIO_STORAGE_KEY, emptyBaseline,
  type AutoAdjustSummary, type ExpenseCategoryBaseline, type MonthlyRow, type Option,
  type SavedScenario, type ScenarioComparisonEntry, type ScenarioDefinition,
  type ScenarioRecommendation, type SimulationBaseline, type SimulationRow
} from "./forecasting-page-types";
import {
  buildScenarioDefinition, calculateBreakEvenPlan, calculateRiskScore, evaluateScenarioMetrics,
  formatSignedCurrency, formatSignedPercent, getBaselineTotals, getScenarioProfit, isAboveBreakEven, roundValue
} from "./forecasting-page-utils";
import {
  buildComparisonInsights, buildForecastingCopilotContext, buildScenarioForecastRows,
  buildScenarioRecommendation, computeAutoAdjustResult, deriveComparisonLeaders
} from "./forecasting-page-derived";
import { createScenarioEditingActions } from "./forecasting-page-scenario-actions";
import { ForecastingComparisonSection } from "./forecasting-page-comparison-section";

export default function ForecastingPage() {
  const router = useRouter();
  const { filters } = useAnalyticsFilters();
  const [projects, setProjects] = useState<Option[]>([]);
  const [monthly, setMonthly] = useState<MonthlyRow[]>([]);
  const [baseline, setBaseline] = useState<SimulationBaseline>(emptyBaseline);
  const [expenseCategories, setExpenseCategories] = useState<ExpenseCategoryBaseline[]>([]);
  const [loading, setLoading] = useState(true);
  const [localFilters, setLocalFilters] = useState({
    projectId: "all"
  });
  const [utilizationChangePct, setUtilizationChangePct] = useState(0);
  const [simulationRows, setSimulationRows] = useState<SimulationRow[]>([]);
  const [savedScenarios, setSavedScenarios] = useState<SavedScenario[]>([]);
  const [scenarioNameDraft, setScenarioNameDraft] = useState("");
  const [compareMode, setCompareMode] = useState(false);
  const [comparisonSelection, setComparisonSelection] = useState({
    scenarioAId: "none",
    scenarioBId: "none"
  });
  const [activeEditingScenarioId, setActiveEditingScenarioId] = useState<string | null>(null);
  const [autoAdjustSummary, setAutoAdjustSummary] = useState<AutoAdjustSummary | null>(null);
  const [focusedSectionId, setFocusedSectionId] = useState<string | null>(null);

  const buildHref = useCallback(
    (path: string, overrides?: Record<string, string | null | undefined>) =>
      buildScopedHref(filters, path, {
        ...(localFilters.projectId !== "all" ? { projectId: localFilters.projectId } : {}),
        ...overrides
      }),
    [filters, localFilters.projectId]
  );

  const categoryNames = useMemo(() => expenseCategories.map((item) => item.category), [expenseCategories]);
  const categoryMap = useMemo(
    () => new Map(expenseCategories.map((item) => [item.category, item])),
    [expenseCategories]
  );

  const logScenarioAudit = useCallback(
    (payload: {
      action: string;
      entityId: string;
      description: string;
      before?: unknown;
      after?: unknown;
    }) => {
      void fetch("/api/audit-logs", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          module: "forecasting",
          entityType: "scenario",
          entityId: payload.entityId,
          action: payload.action,
          description: payload.description,
          before: payload.before,
          after: payload.after
        })
      }).catch(() => undefined);
    },
    []
  );

  async function loadReferenceData() {
    const projectsRes = await fetch("/api/projects", { cache: "no-store" });
    const projectsPayload = await projectsRes.json();
    setProjects(projectsPayload.data || []);
  }

  const loadForecastData = useCallback(async () => {
    setLoading(true);
    setAutoAdjustSummary(null);
    try {
      const search = new URLSearchParams();
      if (filters.from) search.set("from", filters.from);
      if (filters.to) search.set("to", filters.to);
      if (filters.clientId !== "all") search.set("clientId", filters.clientId);
      if (filters.rigId !== "all") search.set("rigId", filters.rigId);
      if (localFilters.projectId !== "all") search.set("projectId", localFilters.projectId);

      const query = search.toString();
      const response = await fetch(`/api/forecasting${query ? `?${query}` : ""}`, { cache: "no-store" });
      const payload = await response.json();
      setMonthly(payload.monthly || []);
      setBaseline(payload.simulationBaseline || emptyBaseline);
      setExpenseCategories(payload.expenseCategoryBaselines || []);
    } catch {
      setMonthly([]);
      setBaseline(emptyBaseline);
      setExpenseCategories([]);
    } finally {
      setLoading(false);
    }
  }, [filters.clientId, filters.from, filters.rigId, filters.to, localFilters.projectId]);

  const {
    addSimulationRow,
    removeSimulationRow,
    updateSimulationRow,
    setRowCategory,
    resetScenario,
    saveCurrentScenario,
    applySavedScenario,
    deleteSavedScenario
  } = createScenarioEditingActions({
    categoryNames,
    utilizationChangePct,
    simulationRows,
    scenarioNameDraft,
    savedScenarios,
    setSimulationRows,
    setUtilizationChangePct,
    setAutoAdjustSummary,
    setSavedScenarios,
    setScenarioNameDraft,
    setActiveEditingScenarioId,
    setComparisonSelection,
    logScenarioAudit
  });

  useEffect(() => {
    void loadReferenceData();
  }, []);

  useEffect(() => {
    void loadForecastData();
  }, [loadForecastData]);

  useEffect(() => {
    if (localFilters.projectId === "all") {
      return;
    }

    const selectedProject = projects.find((project) => project.id === localFilters.projectId);
    if (!selectedProject) {
      setLocalFilters((current) => ({ ...current, projectId: "all" }));
      return;
    }

    if (filters.clientId !== "all" && selectedProject.clientId !== filters.clientId) {
      setLocalFilters((current) => ({ ...current, projectId: "all" }));
    }
  }, [filters.clientId, localFilters.projectId, projects]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    try {
      const raw = window.localStorage.getItem(SCENARIO_STORAGE_KEY);
      if (!raw) {
        return;
      }
      const parsed = JSON.parse(raw) as SavedScenario[];
      if (Array.isArray(parsed)) {
        setSavedScenarios(
          parsed.filter(
            (item) =>
              item &&
              typeof item.id === "string" &&
              typeof item.name === "string" &&
              item.definition &&
              typeof item.definition.utilizationChangePct === "number" &&
              Array.isArray(item.definition.rows)
          )
        );
      }
    } catch {
      setSavedScenarios([]);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    try {
      window.localStorage.setItem(SCENARIO_STORAGE_KEY, JSON.stringify(savedScenarios));
    } catch {
      // ignore quota/storage write failures
    }
  }, [savedScenarios]);

  useEffect(() => {
    if (!activeEditingScenarioId) {
      return;
    }
    const stillExists = savedScenarios.some((scenario) => scenario.id === activeEditingScenarioId);
    if (!stillExists) {
      setActiveEditingScenarioId(null);
    }
  }, [activeEditingScenarioId, savedScenarios]);

  useEffect(() => {
    setSimulationRows((current) => {
      if (current.length === 0) {
        return current;
      }

      const used = new Set<string>();
      return current.map((row) => {
        if (row.categorySelection === CUSTOM_CATEGORY_OPTION) {
          return row;
        }

        const isStillAvailable = categoryNames.includes(row.categorySelection);
        if (isStillAvailable && !used.has(row.categorySelection)) {
          used.add(row.categorySelection);
          return row;
        }

        const replacement = categoryNames.find((category) => !used.has(category));
        if (replacement) {
          used.add(replacement);
          return { ...row, categorySelection: replacement };
        }

        return { ...row, categorySelection: CUSTOM_CATEGORY_OPTION };
      });
    });
  }, [categoryNames]);

  const filteredProjects = useMemo(() => {
    if (filters.clientId === "all") {
      return projects;
    }
    return projects.filter((project) => project.clientId === filters.clientId);
  }, [filters.clientId, projects]);

  const baselineTotals = useMemo(() => getBaselineTotals(baseline), [baseline]);

  const duplicateCustomNameSet = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of simulationRows) {
      if (row.categorySelection !== CUSTOM_CATEGORY_OPTION) {
        continue;
      }
      const key = row.customCategoryName.trim().toLowerCase();
      if (!key) {
        continue;
      }
      counts.set(key, (counts.get(key) || 0) + 1);
    }

    const duplicates = new Set<string>();
    for (const [key, count] of counts.entries()) {
      if (count > 1) {
        duplicates.add(key);
      }
    }
    return duplicates;
  }, [simulationRows]);

  const activeScenarioDefinition = useMemo(
    () => buildScenarioDefinition(utilizationChangePct, simulationRows),
    [simulationRows, utilizationChangePct]
  );

  const simulation = useMemo(
    () =>
      evaluateScenarioMetrics({
        definition: activeScenarioDefinition,
        baseline,
        baselineTotals,
        categoryMap
      }),
    [activeScenarioDefinition, baseline, baselineTotals, categoryMap]
  );

  const impactByRowId = useMemo(
    () => new Map(simulation.impacts.map((impact) => [impact.rowId, impact])),
    [simulation.impacts]
  );

  const activeScenarioLines = useMemo(() => {
    const lines: string[] = [];
    if (utilizationChangePct !== 0) {
      lines.push(`${formatSignedPercent(utilizationChangePct)} utilization`);
    }

    for (const impact of simulation.impacts) {
      if (!impact.isValid || impact.value === 0) {
        continue;
      }
      if (impact.mode === "percent") {
        lines.push(`${formatSignedPercent(impact.value)} ${impact.category}`);
      } else {
        lines.push(`${formatSignedCurrency(impact.value)} ${impact.category}`);
      }
    }

    return lines;
  }, [simulation.impacts, utilizationChangePct]);

  const changedImpacts = useMemo(
    () =>
      simulation.impacts
        .filter((impact) => impact.value !== 0 && impact.isValid)
        .sort((a, b) => Math.abs(b.delta30) - Math.abs(a.delta30)),
    [simulation.impacts]
  );

  const savedScenarioEvaluations = useMemo(
    () =>
      savedScenarios.map((scenario) => ({
        id: scenario.id,
        name: scenario.name,
        metrics: evaluateScenarioMetrics({
          definition: scenario.definition,
          baseline,
          baselineTotals,
          categoryMap
        })
      })),
    [baseline, baselineTotals, categoryMap, savedScenarios]
  );

  const bestSavedScenario = useMemo(() => {
    if (savedScenarioEvaluations.length === 0) {
      return null;
    }
    return savedScenarioEvaluations.reduce((best, current) =>
      current.metrics.forecast30Profit > best.metrics.forecast30Profit ? current : best
    );
  }, [savedScenarioEvaluations]);

  function autoAdjustScenario() {
    const result = computeAutoAdjustResult({
      currentUtilization: utilizationChangePct,
      simulation,
      baseline,
      baselineTotals,
      activeScenarioDefinition,
      categoryMap,
      bestSavedScenario,
      activeEditingScenarioId
    });
    if (!result) {
      return;
    }
    if (result.nextUtilization !== null) {
      setUtilizationChangePct(result.nextUtilization);
    }
    setAutoAdjustSummary(result.summary);
    logScenarioAudit(result.audit);
  }

  const selectedCompareIds = useMemo(() => {
    const ids = [comparisonSelection.scenarioAId, comparisonSelection.scenarioBId].filter(
      (id) => id !== "none"
    );
    return Array.from(new Set(ids)).slice(0, MAX_COMPARE_SCENARIOS);
  }, [comparisonSelection.scenarioAId, comparisonSelection.scenarioBId]);

  const scenarioDefinitionById = useMemo(() => {
    const map = new Map<string, ScenarioDefinition>();
    map.set("baseline", { utilizationChangePct: 0, rows: [] });
    for (const scenario of savedScenarios) {
      map.set(scenario.id, scenario.definition);
    }
    if (activeEditingScenarioId) {
      map.set(activeEditingScenarioId, activeScenarioDefinition);
    }
    return map;
  }, [activeEditingScenarioId, activeScenarioDefinition, savedScenarios]);

  const comparisonEntries = useMemo(() => {
    const baselineEntry: ScenarioComparisonEntry = {
      id: "baseline",
      name: "Baseline",
      isBaseline: true,
      isLiveEditing: false,
      metrics: evaluateScenarioMetrics({
        definition: { utilizationChangePct: 0, rows: [] },
        baseline,
        baselineTotals,
        categoryMap
      }),
      riskScore: 0
    };

    const selectedSavedEntries = selectedCompareIds
      .map((id) => savedScenarios.find((scenario) => scenario.id === id))
      .filter((scenario): scenario is SavedScenario => Boolean(scenario))
      .map((scenario) => {
        const isLiveEditing = activeEditingScenarioId === scenario.id;
        const comparisonDefinition = isLiveEditing ? activeScenarioDefinition : scenario.definition;
        const comparisonMetrics = isLiveEditing
          ? simulation
          : evaluateScenarioMetrics({
              definition: scenario.definition,
              baseline,
              baselineTotals,
              categoryMap
            });

        return {
          id: scenario.id,
          name: scenario.name,
          isBaseline: false,
          isLiveEditing,
          metrics: comparisonMetrics,
          riskScore: calculateRiskScore(comparisonDefinition, baselineTotals.expenses30)
        };
      });

    return [baselineEntry, ...selectedSavedEntries];
  }, [
    activeEditingScenarioId,
    activeScenarioDefinition,
    baseline,
    baselineTotals,
    categoryMap,
    savedScenarios,
    selectedCompareIds,
    simulation
  ]);

  const leaders = useMemo(
    () => deriveComparisonLeaders(comparisonEntries),
    [comparisonEntries]
  );
  const {
    bestProfitEntry,
    bestMarginEntry,
    lowestRiskEntry,
    bestLossReductionEntry,
    isLossContext
  } = leaders;

  const recommendation = useMemo<ScenarioRecommendation | null>(
    () =>
      buildScenarioRecommendation({
        comparisonEntries,
        leaders,
        baselineRevenue7: baselineTotals.revenue7,
        scenarioDefinitionById
      }),
    [baselineTotals.revenue7, comparisonEntries, leaders, scenarioDefinitionById]
  );

  const comparisonInsights = useMemo(
    () =>
      buildComparisonInsights({
        comparisonEntries,
        isLossContext,
        recommendation
      }),
    [comparisonEntries, isLossContext, recommendation]
  );

  const comparisonChartData = useMemo(
    () =>
      comparisonEntries.map((entry) => ({
        id: entry.id,
        isBaseline: entry.isBaseline,
        scenario: entry.name,
        profit: roundValue(entry.metrics.forecast30Profit)
      })),
    [comparisonEntries]
  );

  const activeScenarioBreakEven = useMemo(
    () =>
      calculateBreakEvenPlan({
        metrics: simulation,
        definition: activeScenarioDefinition,
        baselineRevenue: baselineTotals.revenue7
      }),
    [activeScenarioDefinition, baselineTotals.revenue7, simulation]
  );

  const activeScenarioIsAboveBreakEven = useMemo(
    () => isAboveBreakEven(getScenarioProfit(simulation)),
    [simulation]
  );

  useEffect(() => {
    if (process.env.NODE_ENV === "production") {
      return;
    }
    comparisonEntries.forEach((entry) => {
      const profit = getScenarioProfit(entry.metrics);
      console.log({
        scenario: entry.name,
        profit,
        isProfitable: isAboveBreakEven(profit)
      });
    });
  }, [comparisonEntries]);

  const scenarioForecast = useMemo(
    () => buildScenarioForecastRows(baseline, simulation),
    [baseline, simulation]
  );

  const copilotContext = useMemo<CopilotPageContext>(
    () =>
      buildForecastingCopilotContext({
        filters,
        baselineTotals,
        simulation,
        comparisonEntries,
        recommendation,
        compareMode,
        buildHref
      }),
    [baselineTotals, buildHref, compareMode, comparisonEntries, filters, recommendation, simulation]
  );

  useRegisterCopilotContext(copilotContext);

  useCopilotFocusTarget({
    pageKey: "forecasting",
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

        <section className="gf-section">
          <SectionHeader
            title="Forecast Scope"
            description="Use top-bar filters and optional project scope to focus forecasting outputs."
          />
          <Card title="Forecast Filters" subtitle="Filter forecast by company, client, project, and rig">
            <div className="grid gap-3 md:grid-cols-2">
              <Select
                label="Project (optional)"
                value={localFilters.projectId}
                onChange={(value) => setLocalFilters((current) => ({ ...current, projectId: value }))}
                options={[
                  { value: "all", label: "All projects" },
                  ...filteredProjects.map((project) => ({ value: project.id, label: project.name || "-" }))
                ]}
              />
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-ink-700">
                Global filters from top bar are active for client, rig, and date range.
              </div>
            </div>
          </Card>
        </section>

        <section
          id="forecast-kpi-section"
          className={cn(
            "gf-section",
            focusedSectionId === "forecast-kpi-section" && "rounded-2xl ring-2 ring-indigo-100 ring-offset-2 ring-offset-slate-50"
          )}
        >
          <SectionHeader
            title="Primary Forecast KPIs"
            description="Baseline versus scenario outcomes for quick executive comparison."
          />
          <div className="gf-kpi-grid-primary">
            <MetricCard
              label="Baseline Profit (30 Days)"
              value={formatCurrency(baselineTotals.profit30)}
              tone={baselineTotals.profit30 >= 0 ? "good" : "danger"}
            />
            <MetricCard
              label="Simulated Profit (30 Days)"
              value={formatCurrency(simulation.forecast30Profit)}
              tone={simulation.forecast30Profit >= 0 ? "good" : "danger"}
            />
            <MetricCard
              label="Scenario Delta (30 Days)"
              value={formatSignedCurrency(simulation.diff30)}
              tone={simulation.diff30 > 0 ? "good" : simulation.diff30 < 0 ? "danger" : "neutral"}
            />
            <MetricCard
              label="Simulated Margin"
              value={formatPercent(simulation.margin30)}
              tone={simulation.margin30 >= 40 ? "good" : simulation.margin30 >= 15 ? "warn" : "danger"}
            />
          </div>
        </section>

        <section className="gf-section">
          <SectionHeader
            title="Scenario Builder"
            description="Simulate utilization and cost changes, then compare strategy outcomes."
          />
          <ScenarioBuilderCard
            loading={loading}
            autoAdjustScenario={autoAdjustScenario}
            resetScenario={resetScenario}
            utilizationChangePct={utilizationChangePct}
            setUtilizationChangePct={setUtilizationChangePct}
            simulationRows={simulationRows}
            addSimulationRow={addSimulationRow}
            removeSimulationRow={removeSimulationRow}
            updateSimulationRow={updateSimulationRow}
            setRowCategory={setRowCategory}
            categoryNames={categoryNames}
            duplicateCustomNameSet={duplicateCustomNameSet}
            impactByRowId={impactByRowId}
            scenarioNameDraft={scenarioNameDraft}
            setScenarioNameDraft={setScenarioNameDraft}
            saveCurrentScenario={saveCurrentScenario}
            savedScenarios={savedScenarios}
            applySavedScenario={applySavedScenario}
            deleteSavedScenario={deleteSavedScenario}
            activeScenarioLines={activeScenarioLines}
            simulationDiff30={simulation.diff30}
            baselineProfit30={baselineTotals.profit30}
            simulatedProfit30={simulation.forecast30Profit}
            autoAdjustSummary={autoAdjustSummary}
            compareMode={compareMode}
            setCompareMode={setCompareMode}
            comparisonSelection={comparisonSelection}
            setComparisonSelection={setComparisonSelection}
          />

        <ForecastingComparisonSection
          compareMode={compareMode}
          comparisonEntries={comparisonEntries}
          recommendation={recommendation}
          isLossContext={isLossContext}
          bestProfitEntry={bestProfitEntry}
          bestMarginEntry={bestMarginEntry}
          lowestRiskEntry={lowestRiskEntry}
          bestLossReductionEntry={bestLossReductionEntry}
          baselineDailyProfit={baselineTotals.dailyProfit}
          comparisonChartData={comparisonChartData}
          comparisonInsights={comparisonInsights}
          onOpenProfitDetails={() => {
            router.push(buildHref("/spending/profit"));
          }}
          onSelectScenarioForChart={(id) => {
            applySavedScenario(id);
          }}
          onSelectBaselineForChart={() => {
            setActiveEditingScenarioId(null);
            resetScenario();
          }}
        />

        <section className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
          <MetricCard
            label="Current 7-Day Profit"
            value={formatCurrency(baselineTotals.profit7)}
            tone={baselineTotals.profit7 >= 0 ? "good" : "danger"}
          />
          <MetricCard
            label="Simulated 7-Day Profit"
            value={formatCurrency(simulation.forecast7Profit)}
            tone={simulation.forecast7Profit >= 0 ? "good" : "danger"}
          />
          <MetricCard
            label="7-Day Difference"
            value={formatSignedCurrency(simulation.diff7)}
            tone={simulation.diff7 >= 0 ? "good" : "danger"}
          />
          <MetricCard
            label="Current 30-Day Profit"
            value={formatCurrency(baselineTotals.profit30)}
            tone={baselineTotals.profit30 >= 0 ? "good" : "danger"}
          />
          <MetricCard
            label="Simulated 30-Day Profit"
            value={formatCurrency(simulation.forecast30Profit)}
            tone={isAboveBreakEven(getScenarioProfit(simulation)) ? "good" : "danger"}
          />
          <MetricCard
            label="30-Day Difference"
            value={formatSignedCurrency(simulation.diff30)}
            tone={simulation.diff30 >= 0 ? "good" : "danger"}
          />
        </section>

        <section className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
          <MetricCard label="Simulated 7-Day Revenue" value={formatCurrency(simulation.forecast7Revenue)} tone="good" />
          <MetricCard label="Simulated 7-Day Expenses" value={formatCurrency(simulation.forecast7Expenses)} tone="warn" />
          <MetricCard label="Simulated 7-Day Margin" value={formatPercent(simulation.margin7)} />
          <MetricCard label="Simulated 30-Day Revenue" value={formatCurrency(simulation.forecast30Revenue)} tone="good" />
          <MetricCard label="Simulated 30-Day Expenses" value={formatCurrency(simulation.forecast30Expenses)} tone="warn" />
          <MetricCard label="Simulated 30-Day Margin" value={formatPercent(simulation.margin30)} />
        </section>

        <Card title="Break-Even Insight" subtitle="What needs to change to reach profitability">
          {activeScenarioIsAboveBreakEven ? (
            <p className="text-sm font-medium text-emerald-700">Scenario is already above break-even.</p>
          ) : (
            <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-3">
              <p className="text-sm font-semibold text-amber-900">
                Current loss: {formatSignedCurrency(activeScenarioBreakEven.currentLoss)}
              </p>
              <p className="text-sm text-amber-900">To reach break-even, you need one of the following:</p>
              <ul className="list-disc space-y-1 pl-5 text-sm text-amber-900">
                <li>
                  Increase utilization by{" "}
                  {activeScenarioBreakEven.utilizationIncreaseNeeded !== null
                    ? formatSignedPercent(roundValue(activeScenarioBreakEven.utilizationIncreaseNeeded))
                    : "N/A"}
                </li>
                <li>OR increase revenue by {formatSignedCurrency(activeScenarioBreakEven.revenueIncreaseNeeded)}</li>
                <li>OR reduce costs by {formatSignedCurrency(activeScenarioBreakEven.costReductionNeeded * -1)}</li>
              </ul>
              <p className="text-sm font-medium text-amber-900">
                Recommended action: {activeScenarioBreakEven.recommendedAction}
              </p>
            </div>
          )}
        </Card>

        <Card title="Simulation Impact Detail" subtitle="Profit impact from selected cost adjustments (30-day)">
          {changedImpacts.length === 0 ? (
            <p className="text-sm text-ink-600">No active cost adjustment impact yet.</p>
          ) : (
            <DataTable
              compact
              columns={["Category", "Type", "Adjustment", "Impact on Profit (30d)"]}
              rows={changedImpacts.map((impact) => {
                const profitImpact = -impact.delta30;
                return [
                  impact.category,
                  impact.mode === "percent" ? "Percent" : "Fixed",
                  impact.mode === "percent" ? formatSignedPercent(impact.value) : formatSignedCurrency(impact.value),
                  <span
                    key={`${impact.rowId}-profit-impact`}
                    className={
                      profitImpact > 0 ? "font-medium text-emerald-700" : profitImpact < 0 ? "font-medium text-red-700" : "font-medium text-ink-700"
                    }
                  >
                    {formatSignedCurrency(profitImpact)}
                  </span>
                ];
              })}
            />
          )}
        </Card>
        </section>

        <section
          id="forecast-comparison-section"
          className={cn(
            "gf-section",
            focusedSectionId === "forecast-comparison-section" &&
              "rounded-2xl ring-2 ring-indigo-100 ring-offset-2 ring-offset-slate-50"
          )}
        >
          <SectionHeader
            title="Forecast Charts and Context"
            description="Historical versus simulated trends for revenue, expenses, and profit."
          />
          <div className="gf-chart-grid">
          <Card
            title="Historical Revenue vs Expense (Filtered)"
            subtitle="Actual revenue and expense history under current filters."
            onClick={() => {
              router.push(buildHref("/spending"));
            }}
            clickLabel="Open historical revenue and expense details"
          >
            {loading ? (
              <p className="text-sm text-ink-600">Loading historical trend...</p>
            ) : (
              <LineTrendChart
                data={monthly.map((row) => ({
                  bucketStart: row.month,
                  month: row.month,
                  revenue: row.revenue,
                  expenses: row.expenses
                }))}
                xKey="month"
                yKey="revenue"
                secondaryKey="expenses"
                clickHint="Click month to open revenue details"
                onBackgroundClick={() => {
                  router.push(buildHref("/spending"));
                }}
                onElementClick={(entry) => {
                  const range = getBucketDateRange(entry.bucketStart);
                  if (!range) {
                    router.push(buildHref("/spending"));
                    return;
                  }
                  router.push(
                    buildHref("/spending", {
                      from: range.from,
                      to: range.to
                    })
                  );
                }}
              />
            )}
          </Card>

          <Card
            title="30-Day Scenario Forecast"
            subtitle="Revenue and expenses after applying simulation controls"
            onClick={() => {
              router.push(buildHref("/forecasting"));
            }}
            clickLabel="Open forecasting details"
          >
            {loading ? (
              <p className="text-sm text-ink-600">Loading forecast...</p>
            ) : (
              <LineTrendChart
                data={scenarioForecast.map((row) => ({
                  day: row.day,
                  revenue: row.revenue,
                  expenses: row.expenses
                }))}
                xKey="day"
                yKey="revenue"
                secondaryKey="expenses"
                clickHint="Click to review forecasting details"
                onBackgroundClick={() => {
                  router.push(buildHref("/forecasting"));
                }}
                onElementClick={() => {
                  router.push(buildHref("/forecasting"));
                }}
              />
            )}
          </Card>

          <Card
            title="Profit Baseline vs Scenario"
            subtitle="Comparison of baseline profit against simulated adjustments."
            className="xl:col-span-2"
            onClick={() => {
              router.push(buildHref("/spending/profit"));
            }}
            clickLabel="Open profit comparison details"
          >
            {loading ? (
              <p className="text-sm text-ink-600">Loading profit comparison...</p>
            ) : (
              <LineTrendChart
                data={scenarioForecast.map((row) => ({
                  day: row.day,
                  scenarioProfit: row.scenarioProfit,
                  baselineProfit: row.baselineProfit
                }))}
                xKey="day"
                yKey="scenarioProfit"
                secondaryKey="baselineProfit"
                clickHint="Click to open profit details"
                onBackgroundClick={() => {
                  router.push(buildHref("/spending/profit"));
                }}
                onElementClick={() => {
                  router.push(buildHref("/spending/profit"));
                }}
              />
            )}
          </Card>
          </div>
        </section>
      </div>
    </AccessGate>
  );
}
