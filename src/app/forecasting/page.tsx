"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { BarCategoryChart } from "@/components/charts/bar-category-chart";
import { LineTrendChart } from "@/components/charts/line-trend-chart";
import { AccessGate } from "@/components/layout/access-gate";
import { useRegisterCopilotContext } from "@/components/layout/ai-copilot-context";
import { useAnalyticsFilters } from "@/components/layout/analytics-filters-provider";
import { scrollToFocusElement, useCopilotFocusTarget } from "@/components/layout/copilot-focus-target";
import { FilterScopeBanner } from "@/components/layout/filter-scope-banner";
import { Card, MetricCard } from "@/components/ui/card";
import { SectionHeader } from "@/components/ui/section-header";
import type { CopilotPageContext } from "@/lib/ai/contextual-copilot";
import { buildScopedHref, getBucketDateRange } from "@/lib/drilldown";
import { cn, formatCurrency, formatPercent } from "@/lib/utils";

interface Option {
  id: string;
  clientId?: string;
  name?: string;
}

interface MonthlyRow {
  month: string;
  revenue: number;
  expenses: number;
  profit: number;
}

interface SimulationBaseline {
  dailyRevenue: number;
  dailyExpense: number;
  forecast7Revenue: number;
  forecast7Expenses: number;
  forecast7Profit: number;
  forecast30Revenue: number;
  forecast30Expenses: number;
  forecast30Profit: number;
}

interface ExpenseCategoryBaseline {
  category: string;
  totalAmount: number;
  sharePercent: number;
  dailyExpense: number;
  forecast7Expense: number;
  forecast30Expense: number;
}

type AdjustmentMode = "percent" | "fixed";

interface SimulationRow {
  id: string;
  categorySelection: string;
  customCategoryName: string;
  mode: AdjustmentMode;
  value: number;
}

interface ScenarioRowDefinition {
  id?: string;
  categorySelection: string;
  customCategoryName: string;
  mode: AdjustmentMode;
  value: number;
}

interface ScenarioDefinition {
  utilizationChangePct: number;
  rows: ScenarioRowDefinition[];
}

interface SavedScenario {
  id: string;
  name: string;
  createdAt: string;
  definition: ScenarioDefinition;
}

interface CategoryImpact {
  rowId: string;
  category: string;
  source: "existing" | "custom";
  mode: AdjustmentMode;
  value: number;
  baseDailyExpense: number;
  adjustedDailyExpense: number;
  dailyDelta: number;
  delta7: number;
  delta30: number;
  isValid: boolean;
  note?: string;
}

interface BaselineTotals {
  dailyProfit: number;
  revenue7: number;
  expenses7: number;
  profit7: number;
  margin7: number;
  revenue30: number;
  expenses30: number;
  profit30: number;
  margin30: number;
}

interface ScenarioMetrics {
  dailyRevenue: number;
  dailyExpense: number;
  dailyProfit: number;
  forecast7Revenue: number;
  forecast7Expenses: number;
  forecast7Profit: number;
  forecast30Revenue: number;
  forecast30Expenses: number;
  forecast30Profit: number;
  margin7: number;
  margin30: number;
  diff7: number;
  diff30: number;
  impacts: CategoryImpact[];
}

interface ScenarioComparisonEntry {
  id: string;
  name: string;
  isBaseline: boolean;
  isLiveEditing?: boolean;
  metrics: ScenarioMetrics;
  riskScore: number;
}

interface ScenarioRecommendation {
  entry: ScenarioComparisonEntry;
  headline: string;
  summary: string;
  reasons: string[];
  isClearWinner: boolean;
  isMixed: boolean;
  riskLevel: "Low" | "Medium" | "High";
  confidenceLevel: "High" | "Medium" | "Low";
  riskMessage: string;
  riskScore: number;
  driverExplanation: string;
}

interface RiskAssessment {
  riskLevel: "Low" | "Medium" | "High";
  confidenceLevel: "High" | "Medium" | "Low";
  message: string;
  score: number;
}

interface BreakEvenPlan {
  isProfitable: boolean;
  currentLoss: number;
  breakEvenGap: number;
  revenueIncreaseNeeded: number;
  costReductionNeeded: number;
  utilizationRevenuePerPercent: number;
  utilizationIncreaseNeeded: number | null;
  recommendedPath: "none" | "utilization" | "cost" | "revenue";
  recommendedAction: string;
}

interface AutoAdjustSummary {
  status: "applied" | "near_optimal";
  previousUtilization: number;
  newUtilization: number;
  previousProfit30: number;
  newProfit30: number;
  profitChange30: number;
  driver: "Utilization";
  reason: string;
  details: string[];
}

const CUSTOM_CATEGORY_OPTION = "__custom__";
const MAX_SIMULATION_ROWS = 3;
const MAX_COMPARE_SCENARIOS = 2;
const SCENARIO_STORAGE_KEY = "geofields_forecasting_saved_scenarios_v1";
const UTILIZATION_REALISTIC_THRESHOLD_PCT = 20;
const COST_CUT_REALISTIC_THRESHOLD_PCT = 15;
const AUTO_ADJUST_UTILIZATION_MIN = -100;
const AUTO_ADJUST_UTILIZATION_MAX = 85;
const AUTO_ADJUST_UTILIZATION_STEP = 1;
const AUTO_ADJUST_PROFIT_TIE_EPSILON = 1;
const AUTO_ADJUST_NEAR_OPTIMAL_DELTA_MIN = 250;
const AUTO_ADJUST_NEAR_OPTIMAL_DELTA_RATIO = 0.005;
const AUTO_ADJUST_MIN_IMPROVEMENT = 1;

const emptyBaseline: SimulationBaseline = {
  dailyRevenue: 0,
  dailyExpense: 0,
  forecast7Revenue: 0,
  forecast7Expenses: 0,
  forecast7Profit: 0,
  forecast30Revenue: 0,
  forecast30Expenses: 0,
  forecast30Profit: 0
};

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

  function addSimulationRow() {
    setSimulationRows((current) => {
      if (current.length >= MAX_SIMULATION_ROWS) {
        return current;
      }

      const availableCategory =
        categoryNames.find((category) => !getUsedExistingCategories(current).has(category)) || CUSTOM_CATEGORY_OPTION;

      return [
        ...current,
        {
          id: generateId(),
          categorySelection: availableCategory,
          customCategoryName: "",
          mode: "percent",
          value: 0
        }
      ];
    });
  }

  function removeSimulationRow(rowId: string) {
    setSimulationRows((current) => current.filter((row) => row.id !== rowId));
  }

  function updateSimulationRow(rowId: string, patch: Partial<SimulationRow>) {
    setSimulationRows((current) =>
      current.map((row) => (row.id === rowId ? { ...row, ...patch } : row))
    );
  }

  function setRowCategory(rowId: string, categorySelection: string) {
    setSimulationRows((current) => {
      const usedByOthers = getUsedExistingCategories(current, rowId);
      if (categorySelection !== CUSTOM_CATEGORY_OPTION && usedByOthers.has(categorySelection)) {
        return current;
      }

      return current.map((row) =>
        row.id === rowId
          ? {
              ...row,
              categorySelection,
              customCategoryName: categorySelection === CUSTOM_CATEGORY_OPTION ? row.customCategoryName : ""
            }
          : row
      );
    });
  }

  function resetScenario() {
    setUtilizationChangePct(0);
    setSimulationRows([]);
    setAutoAdjustSummary(null);
  }

  function saveCurrentScenario() {
    const hasAnyChange =
      utilizationChangePct !== 0 ||
      simulationRows.some((row) => row.value !== 0 || row.customCategoryName.trim().length > 0);
    if (!hasAnyChange) {
      return;
    }

    const scenarioName = scenarioNameDraft.trim() || `Scenario ${savedScenarios.length + 1}`;
    const definition = buildScenarioDefinition(utilizationChangePct, simulationRows);
    const nextScenario: SavedScenario = {
      id: generateId(),
      name: scenarioName,
      createdAt: new Date().toISOString(),
      definition
    };

    setSavedScenarios((current) => [nextScenario, ...current]);
    setScenarioNameDraft("");
    logScenarioAudit({
      action: "scenario_save",
      entityId: nextScenario.id,
      description: `Saved scenario "${nextScenario.name}".`,
      after: nextScenario.definition
    });
  }

  function applySavedScenario(scenarioId: string) {
    const scenario = savedScenarios.find((item) => item.id === scenarioId);
    if (!scenario) {
      return;
    }

    setActiveEditingScenarioId(scenarioId);
    setAutoAdjustSummary(null);
    setUtilizationChangePct(scenario.definition.utilizationChangePct);
    setSimulationRows(
      scenario.definition.rows.slice(0, MAX_SIMULATION_ROWS).map((row) => ({
        id: generateId(),
        categorySelection: row.categorySelection,
        customCategoryName: row.customCategoryName,
        mode: row.mode,
        value: row.value
      }))
    );
    logScenarioAudit({
      action: "scenario_load",
      entityId: scenario.id,
      description: `Loaded scenario "${scenario.name}" for live editing.`,
      after: scenario.definition
    });
  }

  function deleteSavedScenario(scenarioId: string) {
    const scenario = savedScenarios.find((item) => item.id === scenarioId);
    if (scenario) {
      logScenarioAudit({
        action: "scenario_delete",
        entityId: scenario.id,
        description: `Deleted scenario "${scenario.name}".`,
        before: scenario.definition
      });
    }

    setSavedScenarios((current) => current.filter((item) => item.id !== scenarioId));
    setComparisonSelection((current) => ({
      scenarioAId: current.scenarioAId === scenarioId ? "none" : current.scenarioAId,
      scenarioBId: current.scenarioBId === scenarioId ? "none" : current.scenarioBId
    }));
    setActiveEditingScenarioId((current) => (current === scenarioId ? null : current));
  }

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
    const currentUtilization = utilizationChangePct;
    const currentProfit30 = simulation.forecast30Profit;
    const baselineProfit30 = baselineTotals.profit30;

    const candidateUtilizations = getAutoAdjustCandidateUtilizations(currentUtilization);
    const candidateResults = candidateUtilizations.map((candidateUtilization) => {
      const candidateMetrics = evaluateScenarioMetrics({
        definition: {
          utilizationChangePct: candidateUtilization,
          rows: activeScenarioDefinition.rows
        },
        baseline,
        baselineTotals,
        categoryMap
      });

      return {
        utilization: candidateUtilization,
        profit30: candidateMetrics.forecast30Profit
      };
    });

    const bestCandidate = candidateResults.reduce((best, candidate) => {
      if (!best) {
        return candidate;
      }

      if (candidate.profit30 > best.profit30 + AUTO_ADJUST_PROFIT_TIE_EPSILON) {
        return candidate;
      }

      if (Math.abs(candidate.profit30 - best.profit30) <= AUTO_ADJUST_PROFIT_TIE_EPSILON) {
        const absoluteDelta = Math.abs(candidate.utilization) - Math.abs(best.utilization);
        if (absoluteDelta !== 0) {
          return absoluteDelta < 0 ? candidate : best;
        }

        const proximityDelta =
          Math.abs(candidate.utilization - currentUtilization) - Math.abs(best.utilization - currentUtilization);
        if (proximityDelta !== 0) {
          return proximityDelta < 0 ? candidate : best;
        }
      }

      return best;
    }, null as { utilization: number; profit30: number } | null);

    if (!bestCandidate) {
      return;
    }

    const improvement = roundValue(bestCandidate.profit30 - currentProfit30);
    const nearOptimalDeltaThreshold = Math.max(
      AUTO_ADJUST_NEAR_OPTIMAL_DELTA_MIN,
      Math.abs(bestCandidate.profit30) * AUTO_ADJUST_NEAR_OPTIMAL_DELTA_RATIO
    );
    const nearOptimalLowerCandidate = candidateResults
      .filter(
        (candidate) =>
          candidate.utilization < bestCandidate.utilization &&
          bestCandidate.profit30 - candidate.profit30 <= nearOptimalDeltaThreshold
      )
      .sort((a, b) => a.utilization - b.utilization)[0];
    const belowBaseline = currentProfit30 < baselineProfit30;
    const belowBestSaved =
      bestSavedScenario !== null && currentProfit30 < bestSavedScenario.metrics.forecast30Profit;
    const baselineGap = roundValue(baselineProfit30 - currentProfit30);
    const bestSavedGap =
      bestSavedScenario !== null
        ? roundValue(bestSavedScenario.metrics.forecast30Profit - currentProfit30)
        : 0;

    if (improvement <= AUTO_ADJUST_MIN_IMPROVEMENT) {
      setAutoAdjustSummary({
        status: "near_optimal",
        previousUtilization: currentUtilization,
        newUtilization: currentUtilization,
        previousProfit30: currentProfit30,
        newProfit30: currentProfit30,
        profitChange30: 0,
        driver: "Utilization",
        reason: "Current scenario is already near-optimal under available adjustments.",
        details: [
          `Best tested utilization level was ${formatSignedPercent(bestCandidate.utilization)} in range ${AUTO_ADJUST_UTILIZATION_MIN}% to ${AUTO_ADJUST_UTILIZATION_MAX}%.`,
          `Current projected 30-day profit remains ${formatCurrency(currentProfit30)}.`
        ]
      });
      logScenarioAudit({
        action: "auto_adjust",
        entityId: activeEditingScenarioId || "active_scenario",
        description: "Auto Adjust evaluated scenario and found it already near-optimal.",
        before: {
          utilizationChangePct: currentUtilization,
          forecast30Profit: currentProfit30
        },
        after: {
          utilizationChangePct: currentUtilization,
          forecast30Profit: currentProfit30
        }
      });
      return;
    }

    setUtilizationChangePct(bestCandidate.utilization);

    const details: string[] = [];
    if (belowBaseline) {
      details.push(`Scenario was below baseline by ${formatCurrency(baselineGap)} before optimization.`);
    }
    if (belowBestSaved && bestSavedScenario) {
      details.push(
        `Scenario was below best saved scenario (${bestSavedScenario.name}) by ${formatCurrency(bestSavedGap)}.`
      );
    }
    if (details.length === 0) {
      details.push("Utilization was still tested and improved using deterministic candidate values.");
    }
    if (nearOptimalLowerCandidate) {
      details.push(
        `Diminishing returns observed: ${formatSignedPercent(
          nearOptimalLowerCandidate.utilization
        )} is near-optimal with only ${formatCurrency(
          roundValue(bestCandidate.profit30 - nearOptimalLowerCandidate.profit30)
        )} less projected profit.`
      );
    } else if (bestCandidate.utilization === AUTO_ADJUST_UTILIZATION_MAX) {
      details.push(
        `No clear diminishing returns within tested range. Gains stayed positive up to the realistic cap (${AUTO_ADJUST_UTILIZATION_MAX}%).`
      );
    }

    setAutoAdjustSummary({
      status: "applied",
      previousUtilization: currentUtilization,
      newUtilization: bestCandidate.utilization,
      previousProfit30: currentProfit30,
      newProfit30: bestCandidate.profit30,
      profitChange30: improvement,
      driver: "Utilization",
      reason: `Optimal utilization found at ${formatSignedPercent(
        bestCandidate.utilization
      )} based on highest projected 30-day profit.`,
      details
    });
    logScenarioAudit({
      action: "auto_adjust",
      entityId: activeEditingScenarioId || "active_scenario",
      description: `Auto Adjust changed utilization from ${formatSignedPercent(
        currentUtilization
      )} to ${formatSignedPercent(bestCandidate.utilization)}.`,
      before: {
        utilizationChangePct: currentUtilization,
        forecast30Profit: currentProfit30
      },
      after: {
        utilizationChangePct: bestCandidate.utilization,
        forecast30Profit: bestCandidate.profit30
      }
    });
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

  const bestProfitEntry = useMemo(() => {
    return comparisonEntries.reduce((best, current) =>
      current.metrics.forecast30Profit > best.metrics.forecast30Profit ? current : best
    );
  }, [comparisonEntries]);

  const bestMarginEntry = useMemo(() => {
    return comparisonEntries.reduce((best, current) =>
      current.metrics.margin30 > best.metrics.margin30 ? current : best
    );
  }, [comparisonEntries]);

  const lowestRiskEntry = useMemo(() => {
    const candidates = comparisonEntries.filter((item) => !item.isBaseline);
    if (candidates.length === 0) {
      return comparisonEntries[0];
    }
    return candidates.reduce((best, current) => (current.riskScore < best.riskScore ? current : best));
  }, [comparisonEntries]);

  const bestLossReductionEntry = useMemo(() => {
    const candidates = comparisonEntries.filter((item) => !item.isBaseline);
    if (candidates.length === 0) {
      return comparisonEntries[0];
    }
    return candidates.reduce((best, current) =>
      current.metrics.diff30 > best.metrics.diff30 ? current : best
    );
  }, [comparisonEntries]);

  const hasAnyPositiveProfit = useMemo(
    () => comparisonEntries.some((entry) => entry.metrics.forecast30Profit > 0),
    [comparisonEntries]
  );

  const isLossContext = useMemo(() => {
    const allNegativeProfit = comparisonEntries.every((entry) => entry.metrics.forecast30Profit < 0);
    const allNegativeMargin = comparisonEntries.every((entry) => entry.metrics.margin30 < 0);
    return !hasAnyPositiveProfit || allNegativeProfit || allNegativeMargin;
  }, [comparisonEntries, hasAnyPositiveProfit]);

  const recommendedEntry = useMemo(() => {
    return comparisonEntries.reduce((best, current) => {
      if (current.metrics.forecast30Profit !== best.metrics.forecast30Profit) {
        return current.metrics.forecast30Profit > best.metrics.forecast30Profit ? current : best;
      }
      if (current.metrics.margin30 !== best.metrics.margin30) {
        return current.metrics.margin30 > best.metrics.margin30 ? current : best;
      }
      return current.riskScore < best.riskScore ? current : best;
    });
  }, [comparisonEntries]);

  const recommendation = useMemo<ScenarioRecommendation | null>(() => {
    const baselineEntry = comparisonEntries.find((entry) => entry.isBaseline);
    const nonBaselineEntries = comparisonEntries.filter((entry) => !entry.isBaseline);
    if (!baselineEntry) {
      return null;
    }

    if (nonBaselineEntries.length === 0) {
      return {
        entry: baselineEntry,
        headline: "Recommended Strategy: Baseline",
        summary: "Add at least one saved scenario to generate strategic recommendations.",
        reasons: [
          "Baseline is the only available option in comparison.",
          `Current baseline margin: ${formatPercent(baselineEntry.metrics.margin30)}`
        ],
        isClearWinner: false,
        isMixed: false,
        riskLevel: "Low",
        confidenceLevel: "High",
        riskMessage: "Baseline outcome is stable because no alternative scenario assumptions are applied.",
        riskScore: 20,
        driverExplanation: "No active scenario drivers selected yet"
      };
    }

    const clearWinner =
      !recommendedEntry.isBaseline &&
      recommendedEntry.id === bestProfitEntry.id &&
      recommendedEntry.id === bestMarginEntry.id;
    const mixed =
      !clearWinner &&
      nonBaselineEntries.length > 1 &&
      (bestProfitEntry.id !== bestMarginEntry.id || bestProfitEntry.id !== lowestRiskEntry.id);

    const reasons: string[] = [];

    if (isLossContext) {
      if (recommendedEntry.isBaseline) {
        reasons.push("All compared scenarios are still operating at a loss.");
        reasons.push(
          `Baseline has the lowest projected loss (${formatCurrency(
            Math.abs(baselineEntry.metrics.forecast30Profit)
          )}/month).`
        );
      } else {
        if (recommendedEntry.metrics.diff30 > 0) {
          reasons.push(
            `Reduces losses by ${formatCurrency(recommendedEntry.metrics.diff30)}/month vs baseline.`
          );
        } else {
          reasons.push("Delivers the least projected loss under current assumptions.");
        }
        reasons.push(
          `Lowest loss among scenarios (${formatCurrency(
            Math.abs(recommendedEntry.metrics.forecast30Profit)
          )}/month).`
        );
      }

      if (!recommendedEntry.isBaseline && recommendedEntry.id === bestLossReductionEntry.id) {
        reasons.push("Improves losses the most across compared scenarios.");
      } else if (!recommendedEntry.isBaseline && recommendedEntry.id === lowestRiskEntry.id) {
        reasons.push("Lowest risk profile among selected scenarios.");
      } else {
        reasons.push("Strongest improvement trend under current assumptions.");
      }
    } else {
      if (recommendedEntry.isBaseline) {
        reasons.push("No selected scenario exceeds baseline profit under current filters.");
      } else {
        reasons.push(
          `Highest profit (${formatSignedCurrency(recommendedEntry.metrics.diff30)}/month vs baseline).`
        );
      }

      if (recommendedEntry.id === bestMarginEntry.id) {
        reasons.push(`Best margin (${formatPercent(recommendedEntry.metrics.margin30)}).`);
      } else {
        reasons.push(`Strong margin performance (${formatPercent(recommendedEntry.metrics.margin30)}).`);
      }

      if (!recommendedEntry.isBaseline && recommendedEntry.id === lowestRiskEntry.id) {
        reasons.push("Lowest risk profile among selected scenarios.");
      } else if (recommendedEntry.metrics.forecast30Profit >= baselineEntry.metrics.forecast30Profit) {
        reasons.push("Strong forecast performance under current assumptions.");
      }
    }

    let summary = `${recommendedEntry.name} is recommended based on profit-first scoring.`;
    if (isLossContext) {
      if (clearWinner && !recommendedEntry.isBaseline) {
        summary = `${recommendedEntry.name} is the clearest loss-reduction winner across both loss and margin.`;
      } else if (mixed) {
        const riskNote =
          !lowestRiskEntry.isBaseline &&
          lowestRiskEntry.id !== bestProfitEntry.id &&
          lowestRiskEntry.id !== bestMarginEntry.id
            ? ` ${lowestRiskEntry.name} has the lowest risk profile.`
            : "";
        summary = `${bestProfitEntry.name} offers the lowest loss, while ${bestMarginEntry.name} has the least negative margin.${riskNote} Choose based on strategy.`;
      } else if (recommendedEntry.isBaseline) {
        summary = "Baseline remains the least-loss option under current filters.";
      }
    } else if (clearWinner) {
      summary = `${recommendedEntry.name} is a clear winner across both profit and margin.`;
    } else if (mixed) {
      const riskNote =
        !lowestRiskEntry.isBaseline &&
        lowestRiskEntry.id !== bestProfitEntry.id &&
        lowestRiskEntry.id !== bestMarginEntry.id
          ? ` ${lowestRiskEntry.name} has the lowest risk profile.`
          : "";
      summary = `${bestProfitEntry.name} offers highest profit, while ${bestMarginEntry.name} has better margin.${riskNote} Choose based on strategy.`;
    } else if (recommendedEntry.isBaseline) {
      summary = "Baseline remains the strongest option with current filter conditions.";
    }

    const recommendedDefinition = scenarioDefinitionById.get(recommendedEntry.id) || {
      utilizationChangePct: 0,
      rows: []
    };
    const recommendedBreakEvenPlan = calculateBreakEvenPlan({
      metrics: recommendedEntry.metrics,
      definition: recommendedDefinition,
      baselineRevenue: baselineTotals.revenue7
    });
    const driverExplanation = buildRecommendationDriverExplanation({
      definition: recommendedDefinition,
      recommendedEntry,
      baselineEntry
    });
    const riskAssessment = assessRecommendationRisk({
      definition: recommendedDefinition,
      comparisonEntries,
      isLossContext,
      driverExplanation
    });
    const recommendedIsAboveBreakEven = isAboveBreakEven(getScenarioProfit(recommendedEntry.metrics));
    const displayReasons = recommendedIsAboveBreakEven
      ? reasons.slice(0, 3)
      : [
          reasons[0],
          reasons[1],
          `Break-even path: ${recommendedBreakEvenPlan.recommendedAction}`
        ].filter((item): item is string => Boolean(item));

    return {
      entry: recommendedEntry,
      headline: `Recommended Strategy: ${recommendedEntry.name}`,
      summary,
      reasons: displayReasons,
      isClearWinner: clearWinner,
      isMixed: mixed,
      riskLevel: riskAssessment.riskLevel,
      confidenceLevel: riskAssessment.confidenceLevel,
      riskMessage: riskAssessment.message,
      riskScore: riskAssessment.score,
      driverExplanation
    };
  }, [
    baselineTotals.revenue7,
    bestLossReductionEntry,
    bestMarginEntry,
    bestProfitEntry,
    comparisonEntries,
    isLossContext,
    lowestRiskEntry,
    recommendedEntry,
    scenarioDefinitionById
  ]);

  const comparisonInsights = useMemo(() => {
    const baselineEntry = comparisonEntries.find((entry) => entry.isBaseline);
    const nonBaselineEntries = comparisonEntries.filter((entry) => !entry.isBaseline);
    if (!baselineEntry || nonBaselineEntries.length === 0) {
      return ["Select saved scenarios to compare with baseline."];
    }

    const insights: string[] = [];
    const bestImprovement = nonBaselineEntries.reduce((best, current) =>
      current.metrics.diff30 > best.metrics.diff30 ? current : best
    );
    if (isLossContext) {
      if (bestImprovement.metrics.diff30 > 0) {
        insights.push(
          `${bestImprovement.name} reduces losses by ${formatCurrency(bestImprovement.metrics.diff30)}/month vs baseline.`
        );
      } else {
        insights.push("No selected scenario currently reduces losses versus baseline.");
      }
    } else if (bestImprovement.metrics.diff30 > 0) {
      insights.push(
        `${bestImprovement.name} improves profit by ${formatCurrency(bestImprovement.metrics.diff30)}/month vs baseline.`
      );
    } else {
      insights.push("No selected scenario currently improves 30-day profit over baseline.");
    }

    const expansionWithMarginDrop = nonBaselineEntries.find(
      (entry) =>
        entry.metrics.forecast30Revenue > baselineEntry.metrics.forecast30Revenue &&
        entry.metrics.margin30 < baselineEntry.metrics.margin30
    );
    if (expansionWithMarginDrop) {
      if (isLossContext) {
        insights.push(
          `${expansionWithMarginDrop.name} increases revenue but keeps margins more negative than baseline.`
        );
      } else {
        insights.push(
          `${expansionWithMarginDrop.name} increases revenue but reduces margin versus baseline.`
        );
      }
    }

    if (recommendation?.isMixed) {
      insights.push(recommendation.summary);
    }

    return insights.slice(0, 3);
  }, [comparisonEntries, isLossContext, recommendation]);

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
    () =>
      Array.from({ length: 30 }, (_, index) => {
        const day = index + 1;
        const baselineRevenue = roundValue(baseline.dailyRevenue * day);
        const baselineExpense = roundValue(baseline.dailyExpense * day);
        const scenarioRevenue = roundValue(simulation.dailyRevenue * day);
        const scenarioExpense = roundValue(simulation.dailyExpense * day);

        return {
          day: `Day ${day}`,
          revenue: scenarioRevenue,
          expenses: scenarioExpense,
          baselineProfit: roundValue(baselineRevenue - baselineExpense),
          scenarioProfit: roundValue(scenarioRevenue - scenarioExpense)
        };
      }),
    [baseline.dailyExpense, baseline.dailyRevenue, simulation.dailyExpense, simulation.dailyRevenue]
  );

  const copilotContext = useMemo<CopilotPageContext>(
    () => ({
      pageKey: "forecasting",
      pageName: "Forecasting",
      filters: {
        clientId: filters.clientId,
        rigId: filters.rigId,
        from: filters.from || null,
        to: filters.to || null
      },
      summaryMetrics: [
        { key: "baselineProfit30Day", label: "Baseline Profit (30 Days)", value: baselineTotals.profit30 },
        { key: "simulatedProfit30Day", label: "Simulated Profit (30 Days)", value: simulation.forecast30Profit },
        { key: "scenarioDelta30Day", label: "Scenario Delta (30 Days)", value: simulation.diff30 },
        { key: "simulatedMargin30", label: "Simulated Margin", value: simulation.margin30 },
        { key: "comparisonEntries", label: "Scenario Comparison Entries", value: comparisonEntries.length },
        {
          key: "recommendationRiskScore",
          label: "Recommendation Risk Score",
          value: recommendation?.riskScore ?? 0
        }
      ],
      tablePreviews: [
        {
          key: "scenario-comparison",
          title: "Scenario Comparison",
          rowCount: comparisonEntries.length,
          columns: ["Scenario", "Profit30", "Delta30", "Margin30", "RiskScore"],
          rows: comparisonEntries.slice(0, 8).map((entry) => ({
            id: entry.id,
            scenario: entry.name,
            profit30: entry.metrics.forecast30Profit,
            delta30: entry.metrics.diff30,
            margin30: entry.metrics.margin30,
            riskScore: entry.riskScore,
            href: buildHref("/forecasting"),
            sectionId: "forecast-comparison-section",
            targetPageKey: "forecasting"
          }))
        }
      ],
      priorityItems: [
        ...(recommendation
          ? [
              {
                id: `recommendation-${recommendation.entry.id}`,
                label: recommendation.entry.name,
                reason: `${recommendation.summary} Risk ${recommendation.riskLevel.toLowerCase()} (${recommendation.riskScore}).`,
                severity:
                  recommendation.entry.metrics.forecast30Profit < baselineTotals.profit30
                    ? ("HIGH" as const)
                    : recommendation.riskLevel === "High"
                      ? ("HIGH" as const)
                      : ("MEDIUM" as const),
                amount: recommendation.entry.metrics.forecast30Profit,
                href: buildHref("/forecasting"),
                issueType: "FORECAST_RECOMMENDATION",
                sectionId: "forecast-comparison-section",
                targetPageKey: "forecasting"
              }
            ]
          : []),
        ...comparisonEntries
          .filter((entry) => !entry.isBaseline && entry.metrics.forecast30Profit < 0)
          .sort((a, b) => a.metrics.forecast30Profit - b.metrics.forecast30Profit)
          .slice(0, 2)
          .map((entry) => ({
            id: `loss-${entry.id}`,
            label: entry.name,
            reason: `Scenario remains loss-making at ${formatCurrency(entry.metrics.forecast30Profit)} over 30 days.`,
            severity: "CRITICAL" as const,
            amount: entry.metrics.forecast30Profit,
            href: buildHref("/forecasting"),
            issueType: "FORECAST_LOSS",
            sectionId: "forecast-comparison-section",
            targetPageKey: "forecasting"
          }))
      ],
      navigationTargets: [
        {
          label: "Open Profit",
          href: buildHref("/profit"),
          reason: "Validate scenario assumptions against actual profit drivers.",
          pageKey: "profit",
          sectionId: "profit-primary-kpi-section"
        },
        {
          label: "Open Cost Tracking",
          href: buildHref("/cost-tracking"),
          reason: "Review recognized cost trends behind forecast shifts.",
          pageKey: "cost-tracking"
        }
      ],
      notes: [
        compareMode ? "Comparison mode active." : "Single-scenario mode active.",
        "Forecasting guidance is advisory-only and does not commit financial changes."
      ]
    }),
    [
      baselineTotals.profit30,
      buildHref,
      compareMode,
      comparisonEntries,
      filters.clientId,
      filters.from,
      filters.rigId,
      filters.to,
      recommendation,
      simulation.diff30,
      simulation.forecast30Profit,
      simulation.margin30
    ]
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
          <Card
            title="Scenario Simulation Panel"
            subtitle="Compact strategy builder: pick only the cost changes you want to test"
            action={
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={autoAdjustScenario}
                  disabled={loading}
                  className="rounded-md bg-blue-600 px-2 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                >
                  Auto Adjust
                </button>
                <button
                  type="button"
                  onClick={resetScenario}
                  className="rounded-md border border-slate-200 px-2 py-1 text-xs text-ink-700 hover:bg-slate-50"
                >
                  Reset Scenario
                </button>
              </div>
            }
          >
          <div className="grid gap-4 xl:grid-cols-[2fr_1fr]">
            <div className="space-y-4">
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-sm font-medium text-ink-900">Rig Utilization</p>
                  <p className="text-xs font-medium text-ink-700">{formatSignedPercent(utilizationChangePct)}</p>
                </div>
                <input
                  type="range"
                  min={-100}
                  max={100}
                  step={1}
                  value={clamp(utilizationChangePct, -100, 100)}
                  onChange={(event) => setUtilizationChangePct(Number(event.target.value))}
                  className="w-full accent-blue-600"
                />
                <div className="mt-1 flex justify-between text-[11px] text-ink-500">
                  <span>-100%</span>
                  <span>+100%</span>
                </div>
                <label className="mt-2 block text-xs text-ink-700">
                  <span className="mb-1 block">Manual utilization input (%)</span>
                  <input
                    type="number"
                    value={utilizationChangePct}
                    onChange={(event) => setUtilizationChangePct(parseNumber(event.target.value))}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2"
                  />
                </label>
              </div>

              <div className="rounded-lg border border-slate-200 bg-white p-3">
                <div className="mb-3 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-ink-900">Cost Simulations</p>
                    <p className="text-xs text-ink-600">Up to 3 selected categories at a time.</p>
                  </div>
                  {simulationRows.length < MAX_SIMULATION_ROWS && (
                    <button
                      type="button"
                      onClick={addSimulationRow}
                      className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
                    >
                      Add Simulation
                    </button>
                  )}
                </div>

                {simulationRows.length === 0 ? (
                  <p className="rounded-md border border-dashed border-slate-300 px-3 py-2 text-sm text-ink-600">
                    No cost simulations added yet.
                  </p>
                ) : (
                  <div className="space-y-3">
                    {simulationRows.map((row) => {
                      const usedByOthers = getUsedExistingCategories(simulationRows, row.id);
                      const options = categoryNames.filter(
                        (category) => category === row.categorySelection || !usedByOthers.has(category)
                      );
                      const duplicateCustomName =
                        row.categorySelection === CUSTOM_CATEGORY_OPTION &&
                        duplicateCustomNameSet.has(row.customCategoryName.trim().toLowerCase()) &&
                        row.customCategoryName.trim().length > 0;
                      const rowImpact = impactByRowId.get(row.id);

                      return (
                        <SimulationRowEditor
                          key={row.id}
                          row={row}
                          options={options}
                          duplicateCustomName={duplicateCustomName}
                          note={rowImpact?.note}
                          onCategoryChange={(value) => setRowCategory(row.id, value)}
                          onModeChange={(mode) => updateSimulationRow(row.id, { mode })}
                          onValueChange={(value) => updateSimulationRow(row.id, { value })}
                          onCustomNameChange={(value) => updateSimulationRow(row.id, { customCategoryName: value })}
                          onRemove={() => removeSimulationRow(row.id)}
                        />
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="rounded-lg border border-slate-200 bg-white p-3">
                <p className="text-sm font-medium text-ink-900">Save Scenario</p>
                <p className="mt-1 text-xs text-ink-600">
                  Save this simulation setup and reuse it in comparison mode.
                </p>
                <div className="mt-3 grid gap-2 md:grid-cols-[1fr_auto]">
                  <input
                    type="text"
                    value={scenarioNameDraft}
                    onChange={(event) => setScenarioNameDraft(event.target.value)}
                    placeholder="Scenario name (e.g. Cost Cut)"
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  />
                  <button
                    type="button"
                    onClick={saveCurrentScenario}
                    className="rounded-md bg-emerald-600 px-3 py-2 text-xs font-medium text-white hover:bg-emerald-700"
                  >
                    Save Scenario
                  </button>
                </div>

                <div className="mt-3 space-y-2">
                  {savedScenarios.length === 0 ? (
                    <p className="text-xs text-ink-600">No saved scenarios yet.</p>
                  ) : (
                    savedScenarios.slice(0, 6).map((scenario) => (
                      <div
                        key={scenario.id}
                        className="flex items-center justify-between rounded-md border border-slate-200 px-3 py-2 text-xs"
                      >
                        <div>
                          <p className="font-medium text-ink-800">{scenario.name}</p>
                          <p className="text-ink-600">
                            {new Date(scenario.createdAt).toLocaleDateString("en-US")}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => applySavedScenario(scenario.id)}
                            className="rounded-md border border-slate-200 px-2 py-1 text-ink-700 hover:bg-slate-50"
                          >
                            Load
                          </button>
                          <button
                            type="button"
                            onClick={() => deleteSavedScenario(scenario.id)}
                            className="rounded-md border border-red-200 px-2 py-1 text-red-700 hover:bg-red-50"
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <p className="text-sm font-semibold text-ink-900">Active Scenario Summary</p>
                {activeScenarioLines.length === 0 ? (
                  <p className="mt-2 text-sm text-ink-600">No active adjustments yet.</p>
                ) : (
                  <ul className="mt-2 space-y-1 text-sm text-ink-700">
                    {activeScenarioLines.map((line, index) => (
                      <li key={`${line}-${index}`}>{line}</li>
                    ))}
                  </ul>
                )}
                <div className="mt-3 rounded-md border border-slate-200 bg-white px-3 py-2">
                  <p className="text-xs text-ink-600">Estimated impact (30 days)</p>
                  <p
                    className={`text-base font-semibold ${
                      simulation.diff30 > 0
                        ? "text-emerald-700"
                        : simulation.diff30 < 0
                          ? "text-red-700"
                          : "text-ink-800"
                    }`}
                  >
                    {formatSignedCurrency(simulation.diff30)}
                  </p>
                </div>
                <p className="mt-2 text-xs text-ink-600">
                  Baseline 30-day profit: {formatCurrency(baselineTotals.profit30)}
                </p>
                <p className="text-xs text-ink-600">
                  Simulated 30-day profit: {formatCurrency(simulation.forecast30Profit)}
                </p>
              </div>

              {autoAdjustSummary && (
                <div
                  className={`rounded-lg border p-3 ${
                    autoAdjustSummary.status === "applied"
                      ? "border-emerald-200 bg-emerald-50"
                      : "border-slate-200 bg-slate-50"
                  }`}
                >
                  <p className="text-sm font-semibold text-ink-900">Auto Adjust Summary</p>
                  {autoAdjustSummary.status === "applied" ? (
                    <p className="mt-1 text-xs text-emerald-800">
                      Auto Adjust applied using the strongest available driver.
                    </p>
                  ) : (
                    <p className="mt-1 text-xs text-ink-700">
                      Current scenario is already near-optimal under available adjustments.
                    </p>
                  )}
                  <p className="mt-2 text-xs text-ink-700">
                    Optimal utilization found: {formatSignedPercent(autoAdjustSummary.newUtilization)}
                  </p>
                  <p className="text-xs text-ink-700">
                    Previous utilization: {formatSignedPercent(autoAdjustSummary.previousUtilization)}
                  </p>
                  <p className="text-xs text-ink-700">
                    Projected 30-day profit: {formatCurrency(autoAdjustSummary.previousProfit30)} to{" "}
                    {formatCurrency(autoAdjustSummary.newProfit30)}
                  </p>
                  <p
                    className={`text-xs font-medium ${
                      autoAdjustSummary.profitChange30 > 0
                        ? "text-emerald-700"
                        : autoAdjustSummary.profitChange30 < 0
                          ? "text-red-700"
                          : "text-ink-700"
                    }`}
                  >
                    Improvement: {formatSignedCurrency(autoAdjustSummary.profitChange30)}
                  </p>
                  <p className="mt-1 text-xs text-ink-700">Driver used: {autoAdjustSummary.driver}</p>
                  <p className="text-xs text-ink-700">{autoAdjustSummary.reason}</p>
                  <ul className="mt-2 space-y-1 text-xs text-ink-700">
                    {autoAdjustSummary.details.map((detail, index) => (
                      <li key={`${detail}-${index}`}>{detail}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="rounded-lg border border-slate-200 bg-white p-3">
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-sm font-semibold text-ink-900">Compare Scenarios</p>
                  <button
                    type="button"
                    onClick={() => setCompareMode((current) => !current)}
                    className="rounded-md border border-slate-200 px-2 py-1 text-xs text-ink-700 hover:bg-slate-50"
                  >
                    {compareMode ? "Hide" : "Show"}
                  </button>
                </div>
                <p className="text-xs text-ink-600">
                  Baseline is always included. Select up to two saved scenarios.
                </p>
                {compareMode && (
                  <div className="mt-2 grid gap-2">
                    <label className="text-xs text-ink-700">
                      <span className="mb-1 block">Scenario A</span>
                      <select
                        value={comparisonSelection.scenarioAId}
                        onChange={(event) => {
                          const nextId = event.target.value;
                          setComparisonSelection((current) => ({
                            scenarioAId: nextId,
                            scenarioBId:
                              nextId !== "none" && current.scenarioBId === nextId ? "none" : current.scenarioBId
                          }));
                        }}
                        className="w-full rounded-lg border border-slate-200 px-3 py-2"
                      >
                        <option value="none">Select scenario</option>
                        {savedScenarios.map((scenario) => (
                          <option key={scenario.id} value={scenario.id}>
                            {scenario.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="text-xs text-ink-700">
                      <span className="mb-1 block">Scenario B</span>
                      <select
                        value={comparisonSelection.scenarioBId}
                        onChange={(event) => {
                          const nextId = event.target.value;
                          setComparisonSelection((current) => ({
                            scenarioAId:
                              nextId !== "none" && current.scenarioAId === nextId ? "none" : current.scenarioAId,
                            scenarioBId: nextId
                          }));
                        }}
                        className="w-full rounded-lg border border-slate-200 px-3 py-2"
                      >
                        <option value="none">Select scenario</option>
                        {savedScenarios.map((scenario) => (
                          <option key={scenario.id} value={scenario.id}>
                            {scenario.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                )}
              </div>
            </div>
          </div>
        </Card>

        {compareMode && (
          <Card title="Scenario Comparison" subtitle="Side-by-side strategy outcomes against baseline">
            {comparisonEntries.length <= 1 ? (
              <p className="text-sm text-ink-600">Select at least one saved scenario to compare.</p>
            ) : (
              <div className="space-y-4">
                {recommendation && (
                  <div
                    className={`rounded-xl border-2 px-4 py-3 ${
                      isLossContext ? "border-amber-300 bg-amber-50" : "border-emerald-300 bg-emerald-50"
                    }`}
                  >
                    <p
                      className={`text-sm font-semibold ${
                        isLossContext ? "text-amber-900" : "text-emerald-800"
                      }`}
                    >
                      {recommendation.headline}
                    </p>
                    <p
                      className={`mt-1 text-sm ${
                        isLossContext ? "text-amber-900" : "text-emerald-900"
                      }`}
                    >
                      {recommendation.summary}
                    </p>
                    <p
                      className={`mt-1 text-xs ${
                        isLossContext ? "text-amber-800" : "text-emerald-800"
                      }`}
                    >
                      {isLossContext
                        ? "Status: All compared scenarios are currently operating at a loss."
                        : "Status: At least one compared scenario is profitable."}
                    </p>
                    <p
                      className={`mt-1 text-xs ${
                        isLossContext ? "text-amber-800" : "text-emerald-800"
                      }`}
                    >
                      Key drivers: {recommendation.driverExplanation}.
                    </p>
                    <div className="mt-2 grid gap-2 sm:grid-cols-2">
                      <div className="rounded-md border border-white/60 bg-white/70 px-2 py-1">
                        <p className="text-[11px] text-ink-600">Risk Level</p>
                        <p
                          className={`text-sm font-semibold ${
                            recommendation.riskLevel === "High"
                              ? "text-red-700"
                              : recommendation.riskLevel === "Medium"
                                ? "text-amber-700"
                                : "text-emerald-700"
                          }`}
                        >
                          {recommendation.riskLevel}
                        </p>
                      </div>
                      <div className="rounded-md border border-white/60 bg-white/70 px-2 py-1">
                        <p className="text-[11px] text-ink-600">Confidence</p>
                        <p
                          className={`text-sm font-semibold ${
                            recommendation.confidenceLevel === "Low"
                              ? "text-red-700"
                              : recommendation.confidenceLevel === "Medium"
                                ? "text-amber-700"
                                : "text-emerald-700"
                          }`}
                        >
                          {recommendation.confidenceLevel}
                        </p>
                      </div>
                    </div>
                    <p
                      className={`mt-2 text-xs ${
                        recommendation.riskLevel === "High"
                          ? "text-red-800"
                          : recommendation.riskLevel === "Medium"
                            ? "text-amber-800"
                            : isLossContext
                              ? "text-amber-800"
                              : "text-emerald-800"
                      }`}
                    >
                      {recommendation.riskMessage}
                    </p>
                    <ul
                      className={`mt-2 space-y-1 text-sm ${
                        isLossContext ? "text-amber-900" : "text-emerald-900"
                      }`}
                    >
                      {recommendation.reasons.map((reason, index) => (
                        <li key={`${reason}-${index}`}>{reason}</li>
                      ))}
                    </ul>
                  </div>
                )}
                <p className="text-xs text-ink-600">
                  Profit uses 7-day projection. 30-day Forecast uses monthly projection.
                </p>
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-ink-600">
                        <th className="px-2 py-2">Scenario Name</th>
                        <th className="px-2 py-2">Revenue</th>
                        <th className="px-2 py-2">Expenses</th>
                        <th className="px-2 py-2">Profit</th>
                        <th className="px-2 py-2">Profit Change vs Baseline</th>
                        <th className="px-2 py-2">30-day Forecast</th>
                        <th className="px-2 py-2">Forecast Change vs Baseline</th>
                        <th className="px-2 py-2">Margin %</th>
                        <th className="px-2 py-2">Break-even</th>
                      </tr>
                    </thead>
                    <tbody>
                      {comparisonEntries.map((entry) => {
                        const dailyProfitChange = roundValue(entry.metrics.dailyProfit - baselineTotals.dailyProfit);
                        const isBestProfit = entry.id === bestProfitEntry.id;
                        const isBestMargin = entry.id === bestMarginEntry.id;
                        const isLowestRisk = entry.id === lowestRiskEntry.id && !entry.isBaseline;
                        const isBestLossReduction =
                          !entry.isBaseline &&
                          entry.id === bestLossReductionEntry.id &&
                          entry.metrics.diff30 > 0;
                        const isRecommended = recommendation?.entry.id === entry.id;
                        const isLiveEditing = Boolean(entry.isLiveEditing);

                        return (
                          <tr
                            key={entry.id}
                            className={`border-b border-slate-100 ${
                              isRecommended
                                ? "bg-emerald-100/80 ring-1 ring-emerald-300"
                                : isLiveEditing
                                  ? "bg-blue-50/70"
                                : ""
                            }`}
                          >
                            <td
                              className={`px-2 py-2 text-ink-800 ${
                                isRecommended
                                  ? "border-l-4 border-emerald-500"
                                  : isLiveEditing
                                    ? "border-l-4 border-blue-400"
                                    : ""
                              }`}
                            >
                              <div className="font-medium">{entry.name}</div>
                              <div className="mt-1 flex flex-wrap gap-1 text-[10px]">
                                {isRecommended && (
                                  <span className="rounded bg-emerald-200 px-1.5 py-0.5 text-emerald-800">
                                    Recommended
                                  </span>
                                )}
                                {entry.isBaseline && (
                                  <span className="rounded bg-slate-200 px-1.5 py-0.5 text-slate-700">
                                    Baseline
                                  </span>
                                )}
                                {isLiveEditing && (
                                  <span className="rounded bg-blue-100 px-1.5 py-0.5 text-blue-700">
                                    Live editing
                                  </span>
                                )}
                                {isBestProfit && (
                                  <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-emerald-700">
                                    {isLossContext ? "Least loss" : "Highest profit"}
                                  </span>
                                )}
                                {isBestMargin && (
                                  <span className="rounded bg-blue-100 px-1.5 py-0.5 text-blue-700">
                                    {isLossContext ? "Least negative margin" : "Best margin"}
                                  </span>
                                )}
                                {isLossContext && isBestLossReduction && (
                                  <span className="rounded bg-purple-100 px-1.5 py-0.5 text-purple-700">
                                    Best loss reduction
                                  </span>
                                )}
                                {isLowestRisk && (
                                  <span className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-700">
                                    Lowest risk
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="px-2 py-2 text-ink-700">
                              {formatCurrency(entry.metrics.forecast30Revenue)}
                            </td>
                            <td className="px-2 py-2 text-ink-700">
                              {formatCurrency(entry.metrics.forecast30Expenses)}
                            </td>
                            <td className="px-2 py-2 text-ink-700">
                              {formatCurrency(entry.metrics.forecast7Profit)}
                            </td>
                            <td
                              className={`px-2 py-2 font-medium ${
                                dailyProfitChange > 0
                                  ? "text-emerald-700"
                                  : dailyProfitChange < 0
                                    ? "text-red-700"
                                    : "text-ink-700"
                              }`}
                            >
                              {formatSignedCurrency(dailyProfitChange)}
                            </td>
                            <td className="px-2 py-2 text-ink-700">
                              {formatCurrency(entry.metrics.forecast30Profit)}
                            </td>
                            <td
                              className={`px-2 py-2 font-medium ${
                                entry.metrics.diff30 > 0
                                  ? "text-emerald-700"
                                  : entry.metrics.diff30 < 0
                                    ? "text-red-700"
                                    : "text-ink-700"
                              }`}
                            >
                              {formatSignedCurrency(entry.metrics.diff30)}
                            </td>
                            <td className="px-2 py-2 text-ink-700">
                              {formatPercent(entry.metrics.margin30)}
                            </td>
                            <td
                              className={`px-2 py-2 font-medium ${
                                entry.metrics.forecast30Profit >= 0
                                  ? "text-emerald-700"
                                  : "text-amber-800"
                              }`}
                            >
                              {entry.metrics.forecast30Profit >= 0
                                ? "Above break-even"
                                : `${formatCurrency(Math.abs(entry.metrics.forecast30Profit))} below`}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <div className="grid gap-4 xl:grid-cols-2">
                  <Card
                    title="Profit by Scenario"
                    onClick={() => {
                      router.push(buildHref("/profit"));
                    }}
                    clickLabel="Open scenario profit details"
                  >
                    <BarCategoryChart
                      data={comparisonChartData}
                      xKey="scenario"
                      yKey="profit"
                      clickHint="Click scenario bar to load it for live editing"
                      onBackgroundClick={() => {
                        router.push(buildHref("/profit"));
                      }}
                      onElementClick={(entry) => {
                        if (!entry.id || entry.id === "baseline") {
                          setActiveEditingScenarioId(null);
                          resetScenario();
                          return;
                        }
                        applySavedScenario(entry.id);
                      }}
                    />
                  </Card>
                  <Card title="Comparison Insights">
                    <ul className="space-y-2 text-sm text-ink-700">
                      {comparisonInsights.map((insight, index) => (
                        <li key={`${insight}-${index}`}>{insight}</li>
                      ))}
                    </ul>
                  </Card>
                </div>
              </div>
            )}
          </Card>
        )}

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
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-ink-600">
                    <th className="px-2 py-2">Category</th>
                    <th className="px-2 py-2">Type</th>
                    <th className="px-2 py-2">Adjustment</th>
                    <th className="px-2 py-2">Impact on Profit (30d)</th>
                  </tr>
                </thead>
                <tbody>
                  {changedImpacts.map((impact) => {
                    const profitImpact = -impact.delta30;
                    return (
                      <tr key={impact.rowId} className="border-b border-slate-100">
                        <td className="px-2 py-2 text-ink-800">{impact.category}</td>
                        <td className="px-2 py-2 text-ink-700">{impact.mode === "percent" ? "Percent" : "Fixed"}</td>
                        <td className="px-2 py-2 text-ink-700">
                          {impact.mode === "percent"
                            ? formatSignedPercent(impact.value)
                            : formatSignedCurrency(impact.value)}
                        </td>
                        <td
                          className={`px-2 py-2 font-medium ${
                            profitImpact > 0
                              ? "text-emerald-700"
                              : profitImpact < 0
                                ? "text-red-700"
                                : "text-ink-700"
                          }`}
                        >
                          {formatSignedCurrency(profitImpact)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
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
              router.push(buildHref("/revenue"));
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
                  router.push(buildHref("/revenue"));
                }}
                onElementClick={(entry) => {
                  const range = getBucketDateRange(entry.bucketStart);
                  if (!range) {
                    router.push(buildHref("/revenue"));
                    return;
                  }
                  router.push(
                    buildHref("/revenue", {
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
              router.push(buildHref("/profit"));
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
                  router.push(buildHref("/profit"));
                }}
                onElementClick={() => {
                  router.push(buildHref("/profit"));
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

function Select({
  label,
  value,
  onChange,
  options
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <label className="text-sm text-ink-700">
      <span className="mb-1 block">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-lg border border-slate-200 px-3 py-2"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function SimulationRowEditor({
  row,
  options,
  duplicateCustomName,
  note,
  onCategoryChange,
  onModeChange,
  onValueChange,
  onCustomNameChange,
  onRemove
}: {
  row: SimulationRow;
  options: string[];
  duplicateCustomName: boolean;
  note?: string;
  onCategoryChange: (value: string) => void;
  onModeChange: (mode: AdjustmentMode) => void;
  onValueChange: (value: number) => void;
  onCustomNameChange: (value: string) => void;
  onRemove: () => void;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
      <div className="grid gap-2 md:grid-cols-[1.2fr_0.9fr_0.9fr_auto]">
        <label className="text-xs text-ink-700">
          <span className="mb-1 block">Category</span>
          <select
            value={row.categorySelection}
            onChange={(event) => onCategoryChange(event.target.value)}
            className="w-full rounded-lg border border-slate-200 px-3 py-2"
          >
            {options.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
            <option value={CUSTOM_CATEGORY_OPTION}>Add Custom Category</option>
          </select>
        </label>

        <label className="text-xs text-ink-700">
          <span className="mb-1 block">Change type</span>
          <select
            value={row.mode}
            onChange={(event) => onModeChange(event.target.value as AdjustmentMode)}
            className="w-full rounded-lg border border-slate-200 px-3 py-2"
          >
            <option value="percent">Percent (%)</option>
            <option value="fixed">Fixed amount ($)</option>
          </select>
        </label>

        <label className="text-xs text-ink-700">
          <span className="mb-1 block">Value</span>
          <input
            type="number"
            value={row.value}
            onChange={(event) => onValueChange(parseNumber(event.target.value))}
            className="w-full rounded-lg border border-slate-200 px-3 py-2"
          />
        </label>

        <button
          type="button"
          onClick={onRemove}
          className="self-end rounded-md border border-slate-200 px-3 py-2 text-xs text-ink-700 hover:bg-white"
        >
          Remove
        </button>
      </div>

      {row.categorySelection === CUSTOM_CATEGORY_OPTION && (
        <label className="mt-2 block text-xs text-ink-700">
          <span className="mb-1 block">Custom category name</span>
          <input
            type="text"
            value={row.customCategoryName}
            onChange={(event) => onCustomNameChange(event.target.value)}
            placeholder="e.g. Insurance"
            className="w-full rounded-lg border border-slate-200 px-3 py-2"
          />
        </label>
      )}

      {row.mode === "percent" && (
        <div className="mt-2">
          <input
            type="range"
            min={-100}
            max={100}
            step={1}
            value={clamp(row.value, -100, 100)}
            onChange={(event) => onValueChange(Number(event.target.value))}
            className="w-full accent-blue-600"
          />
          <div className="mt-1 flex justify-between text-[11px] text-ink-500">
            <span>-100%</span>
            <span>+100%</span>
          </div>
          {Math.abs(row.value) > 100 && (
            <p className="mt-1 text-[11px] text-amber-700">
              Manual percent value beyond slider range is active: {formatSignedPercent(row.value)}.
            </p>
          )}
        </div>
      )}

      {duplicateCustomName && (
        <p className="mt-1 text-[11px] text-amber-700">This custom category is duplicated in another row.</p>
      )}
      {note && <p className="mt-1 text-[11px] text-ink-600">{note}</p>}
    </div>
  );
}

function buildScenarioDefinition(
  utilizationChangePct: number,
  rows: Array<Omit<SimulationRow, "id"> | SimulationRow>
): ScenarioDefinition {
  return {
    utilizationChangePct,
    rows: rows.map((row) => ({
      categorySelection: row.categorySelection,
      customCategoryName: row.customCategoryName,
      mode: row.mode,
      value: row.value
    }))
  };
}

function getBaselineTotals(baseline: SimulationBaseline): BaselineTotals {
  const revenue7 = baseline.forecast7Revenue || roundValue(baseline.dailyRevenue * 7);
  const expenses7 = baseline.forecast7Expenses || roundValue(baseline.dailyExpense * 7);
  const profit7 = baseline.forecast7Profit || roundValue(revenue7 - expenses7);

  const revenue30 = baseline.forecast30Revenue || roundValue(baseline.dailyRevenue * 30);
  const expenses30 = baseline.forecast30Expenses || roundValue(baseline.dailyExpense * 30);
  const profit30 = baseline.forecast30Profit || roundValue(revenue30 - expenses30);

  const dailyProfit = roundValue(baseline.dailyRevenue - baseline.dailyExpense);
  const margin7 = revenue7 > 0 ? (profit7 / revenue7) * 100 : 0;
  const margin30 = revenue30 > 0 ? (profit30 / revenue30) * 100 : 0;

  return {
    dailyProfit,
    revenue7,
    expenses7,
    profit7,
    margin7,
    revenue30,
    expenses30,
    profit30,
    margin30
  };
}

function evaluateScenarioMetrics({
  definition,
  baseline,
  baselineTotals,
  categoryMap
}: {
  definition: ScenarioDefinition;
  baseline: SimulationBaseline;
  baselineTotals: BaselineTotals;
  categoryMap: Map<string, ExpenseCategoryBaseline>;
}): ScenarioMetrics {
  const utilizationMultiplier = Math.max(0, 1 + definition.utilizationChangePct / 100);
  const dailyRevenue = roundValue(baseline.dailyRevenue * utilizationMultiplier);

  const impacts: CategoryImpact[] = definition.rows.map((row, index) => {
    const rowId = row.id || `row-${index}`;
    const isCustom = row.categorySelection === CUSTOM_CATEGORY_OPTION;
    const customName = row.customCategoryName.trim();
    const category = isCustom ? (customName || "Custom category") : row.categorySelection;
    const baseDailyExpense = isCustom ? 0 : categoryMap.get(row.categorySelection)?.dailyExpense || 0;
    const hasValidCustomName = !isCustom || customName.length > 0;

    if (!hasValidCustomName) {
      return {
        rowId,
        category,
        source: isCustom ? "custom" : "existing",
        mode: row.mode,
        value: row.value,
        baseDailyExpense: roundValue(baseDailyExpense),
        adjustedDailyExpense: roundValue(baseDailyExpense),
        dailyDelta: 0,
        delta7: 0,
        delta30: 0,
        isValid: false,
        note: "Enter a custom category name to apply this simulation."
      };
    }

    let adjustedDailyExpense = baseDailyExpense;
    let note: string | undefined;
    if (row.mode === "percent") {
      if (isCustom && baseDailyExpense === 0 && row.value !== 0) {
        note = "Percent mode has no baseline here. Use fixed amount for new costs.";
      }
      const rawAdjusted = baseDailyExpense * (1 + row.value / 100);
      adjustedDailyExpense = isCustom ? baseDailyExpense : Math.max(0, rawAdjusted);
    } else {
      const dailyAdjustment = row.value / 30;
      if (isCustom) {
        adjustedDailyExpense = dailyAdjustment;
      } else {
        const rawAdjusted = baseDailyExpense + dailyAdjustment;
        adjustedDailyExpense = Math.max(0, rawAdjusted);
      }
    }

    const dailyDelta = adjustedDailyExpense - baseDailyExpense;
    return {
      rowId,
      category,
      source: isCustom ? "custom" : "existing",
      mode: row.mode,
      value: row.value,
      baseDailyExpense: roundValue(baseDailyExpense),
      adjustedDailyExpense: roundValue(adjustedDailyExpense),
      dailyDelta: roundValue(dailyDelta),
      delta7: roundValue(dailyDelta * 7),
      delta30: roundValue(dailyDelta * 30),
      isValid: true,
      note
    };
  });

  const totalDailyExpenseDelta = impacts.reduce((sum, item) => sum + item.dailyDelta, 0);
  const dailyExpense = roundValue(Math.max(0, baseline.dailyExpense + totalDailyExpenseDelta));
  const dailyProfit = roundValue(dailyRevenue - dailyExpense);

  const forecast7Revenue = roundValue(dailyRevenue * 7);
  const forecast7Expenses = roundValue(dailyExpense * 7);
  const forecast7Profit = roundValue(forecast7Revenue - forecast7Expenses);

  const forecast30Revenue = roundValue(dailyRevenue * 30);
  const forecast30Expenses = roundValue(dailyExpense * 30);
  const forecast30Profit = roundValue(forecast30Revenue - forecast30Expenses);

  const margin7 = forecast7Revenue > 0 ? (forecast7Profit / forecast7Revenue) * 100 : 0;
  const margin30 = forecast30Revenue > 0 ? (forecast30Profit / forecast30Revenue) * 100 : 0;

  const diff7 = roundValue(forecast7Profit - baselineTotals.profit7);
  const diff30 = roundValue(forecast30Profit - baselineTotals.profit30);

  return {
    dailyRevenue,
    dailyExpense,
    dailyProfit,
    forecast7Revenue,
    forecast7Expenses,
    forecast7Profit,
    forecast30Revenue,
    forecast30Expenses,
    forecast30Profit,
    margin7,
    margin30,
    diff7,
    diff30,
    impacts
  };
}

function calculateBreakEvenPlan({
  metrics,
  definition,
  baselineRevenue
}: {
  metrics: ScenarioMetrics;
  definition: ScenarioDefinition;
  baselineRevenue: number;
}): BreakEvenPlan {
  const scenarioProfit = getScenarioProfit(metrics);
  const scenarioRevenue = getScenarioRevenue(metrics);
  const scenarioExpenses = getScenarioExpenses(metrics);

  if (isAboveBreakEven(scenarioProfit)) {
    return {
      isProfitable: true,
      currentLoss: 0,
      breakEvenGap: 0,
      revenueIncreaseNeeded: 0,
      costReductionNeeded: 0,
      utilizationRevenuePerPercent: baselineRevenue / 100,
      utilizationIncreaseNeeded: 0,
      recommendedPath: "none",
      recommendedAction: "Maintain current performance and protect margin discipline."
    };
  }

  const breakEvenGap = Math.abs(scenarioProfit);
  const revenueIncreaseNeeded = breakEvenGap;
  const costReductionNeeded = breakEvenGap;

  const utilizationPct = definition.utilizationChangePct;
  const scenarioRevenueDelta = scenarioRevenue - baselineRevenue;
  const utilizationRevenuePerPercent =
    utilizationPct > 0 && scenarioRevenueDelta > 0
      ? scenarioRevenueDelta / utilizationPct
      : baselineRevenue > 0
        ? baselineRevenue / 100
        : 0;
  const utilizationIncreaseNeeded =
    utilizationRevenuePerPercent > 0 ? breakEvenGap / utilizationRevenuePerPercent : null;

  const costCutPercentOfCurrent =
    scenarioExpenses > 0 ? (costReductionNeeded / scenarioExpenses) * 100 : Infinity;
  const utilizationFeasible =
    utilizationIncreaseNeeded !== null && utilizationIncreaseNeeded <= UTILIZATION_REALISTIC_THRESHOLD_PCT;
  const costFeasible = costCutPercentOfCurrent <= COST_CUT_REALISTIC_THRESHOLD_PCT;

  let recommendedPath: BreakEvenPlan["recommendedPath"] = "revenue";
  let recommendedAction = `Increase revenue by ${formatCurrency(revenueIncreaseNeeded)} through pricing or contract improvements.`;
  if (utilizationFeasible && utilizationIncreaseNeeded !== null) {
    recommendedPath = "utilization";
    const targetUtilization = Math.max(
      0,
      roundValue(definition.utilizationChangePct + utilizationIncreaseNeeded)
    );
    recommendedAction = `Increase utilization to ${formatPercent(
      targetUtilization
    )} to achieve break-even.`;
  } else if (costFeasible) {
    recommendedPath = "cost";
    recommendedAction = `Reduce costs by ${formatCurrency(
      costReductionNeeded
    )} to reach break-even.`;
  }

  return {
    isProfitable: isAboveBreakEven(scenarioProfit),
    currentLoss: scenarioProfit,
    breakEvenGap,
    revenueIncreaseNeeded,
    costReductionNeeded,
    utilizationRevenuePerPercent: roundValue(utilizationRevenuePerPercent),
    utilizationIncreaseNeeded: utilizationIncreaseNeeded !== null ? roundValue(utilizationIncreaseNeeded) : null,
    recommendedPath,
    recommendedAction
  };
}

function buildRecommendationDriverExplanation({
  definition,
  recommendedEntry,
  baselineEntry
}: {
  definition: ScenarioDefinition;
  recommendedEntry: ScenarioComparisonEntry;
  baselineEntry: ScenarioComparisonEntry;
}) {
  const factors: Array<{ label: string; weight: number }> = [];
  const utilizationChange = definition.utilizationChangePct;
  const revenueDelta = roundValue(
    recommendedEntry.metrics.forecast30Revenue - baselineEntry.metrics.forecast30Revenue
  );
  const expenseDelta = roundValue(
    recommendedEntry.metrics.forecast30Expenses - baselineEntry.metrics.forecast30Expenses
  );

  const revenueThreshold = Math.max(500, Math.abs(baselineEntry.metrics.forecast30Revenue) * 0.015);
  const expenseThreshold = Math.max(500, Math.abs(baselineEntry.metrics.forecast30Expenses) * 0.015);

  if (Math.abs(utilizationChange) > 0) {
    factors.push({
      label:
        utilizationChange > 0
          ? `higher utilization (${formatSignedPercent(utilizationChange)})`
          : `lower utilization (${formatSignedPercent(utilizationChange)})`,
      weight: Math.abs(utilizationChange) * 120
    });
  }

  if (Math.abs(revenueDelta) > revenueThreshold) {
    factors.push({
      label:
        revenueDelta > 0
          ? `revenue increase (${formatSignedCurrency(revenueDelta)})`
          : `revenue decline (${formatSignedCurrency(revenueDelta)})`,
      weight: Math.abs(revenueDelta)
    });
  }

  if (expenseDelta < -expenseThreshold) {
    factors.push({
      label: `cost reduction (${formatCurrency(Math.abs(expenseDelta))})`,
      weight: Math.abs(expenseDelta)
    });
  } else if (expenseDelta > expenseThreshold) {
    factors.push({
      label: `higher costs (${formatSignedCurrency(expenseDelta)})`,
      weight: Math.abs(expenseDelta)
    });
  } else {
    factors.push({
      label: "stable costs",
      weight: expenseThreshold / 2
    });
  }

  if (factors.length === 0) {
    return "current baseline assumptions";
  }

  const topLabels = factors
    .sort((a, b) => b.weight - a.weight)
    .map((factor) => factor.label)
    .filter((label, index, array) => array.indexOf(label) === index)
    .slice(0, 2);

  if (topLabels.length === 1) {
    return topLabels[0];
  }
  return `${topLabels[0]} and ${topLabels[1]}`;
}

function assessRecommendationRisk({
  definition,
  comparisonEntries,
  isLossContext,
  driverExplanation
}: {
  definition: ScenarioDefinition;
  comparisonEntries: ScenarioComparisonEntry[];
  isLossContext: boolean;
  driverExplanation: string;
}): RiskAssessment {
  const nonBaselineEntries = comparisonEntries.filter((entry) => !entry.isBaseline);
  const profitValues = comparisonEntries.map((entry) => entry.metrics.forecast30Profit);
  const averageProfit =
    profitValues.length > 0
      ? profitValues.reduce((sum, value) => sum + value, 0) / profitValues.length
      : 0;
  const maxProfit = profitValues.length > 0 ? Math.max(...profitValues) : 0;
  const minProfit = profitValues.length > 0 ? Math.min(...profitValues) : 0;
  const profitRange = maxProfit - minProfit;
  const variabilityRatio = profitRange / Math.max(1, Math.abs(averageProfit));

  const activeRows = definition.rows.filter(
    (row) =>
      row.value !== 0 &&
      (row.categorySelection !== CUSTOM_CATEGORY_OPTION || row.customCategoryName.trim().length > 0)
  ).length;
  const utilizationAbs = Math.abs(definition.utilizationChangePct);
  const factorCount = activeRows + (utilizationAbs !== 0 ? 1 : 0);
  const improvementRatio =
    nonBaselineEntries.length > 0
      ? nonBaselineEntries.filter((entry) => entry.metrics.diff30 > 0).length / nonBaselineEntries.length
      : 1;

  let score = 50;
  let utilizationDependent = false;

  if (variabilityRatio > 1.2) {
    score += 22;
  } else if (variabilityRatio > 0.7) {
    score += 12;
  } else if (variabilityRatio < 0.35) {
    score -= 8;
  }

  if (utilizationAbs >= 40 && factorCount <= 2) {
    score += 20;
    utilizationDependent = true;
  } else if (utilizationAbs >= 20 && factorCount <= 2) {
    score += 12;
    utilizationDependent = true;
  } else if (utilizationAbs === 0 && activeRows >= 2) {
    score -= 6;
  } else if (factorCount >= 3) {
    score -= 4;
  }

  if (improvementRatio >= 0.75) {
    score -= 10;
  } else if (improvementRatio < 0.4) {
    score += 12;
  }

  if (isLossContext) {
    score += 8;
  }

  const normalizedScore = clamp(roundValue(score), 0, 100);
  const riskLevel: RiskAssessment["riskLevel"] =
    normalizedScore >= 68 ? "High" : normalizedScore >= 40 ? "Medium" : "Low";
  const confidenceLevel: RiskAssessment["confidenceLevel"] =
    riskLevel === "High" ? "Low" : riskLevel === "Medium" ? "Medium" : "High";

  let message = `Consistent profit improvement driven by ${driverExplanation}.`;
  if (isLossContext && riskLevel === "Low") {
    message = `Consistent loss reduction driven by ${driverExplanation}.`;
  } else if (utilizationDependent && riskLevel !== "Low") {
    message = isLossContext
      ? `Loss improvement depends on utilization assumptions, mainly ${driverExplanation}.`
      : `Profit increase depends on utilization assumptions, mainly ${driverExplanation}.`;
  } else if (riskLevel === "High") {
    message = `Outcome highly sensitive to cost changes, with ${driverExplanation} as the main driver.`;
  } else if (riskLevel === "Medium") {
    message = `Scenario outcome is moderately sensitive to assumptions; key drivers are ${driverExplanation}.`;
  }

  return {
    riskLevel,
    confidenceLevel,
    message,
    score: normalizedScore
  };
}

function calculateRiskScore(definition: ScenarioDefinition, baselineExpense30: number) {
  const base = Math.max(1, baselineExpense30);
  const adjustmentScore = definition.rows.reduce((sum, row) => {
    if (row.mode === "percent") {
      return sum + Math.abs(row.value);
    }
    return sum + (Math.abs(row.value) / base) * 100;
  }, 0);
  return roundValue(Math.abs(definition.utilizationChangePct) * 0.4 + adjustmentScore);
}

function getUsedExistingCategories(rows: SimulationRow[], excludedRowId?: string) {
  const used = new Set<string>();
  for (const row of rows) {
    if (row.id === excludedRowId) {
      continue;
    }
    if (row.categorySelection !== CUSTOM_CATEGORY_OPTION) {
      used.add(row.categorySelection);
    }
  }
  return used;
}

function generateId() {
  return `sim-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function getAutoAdjustCandidateUtilizations(currentUtilization: number) {
  const candidates: number[] = [];
  for (
    let value = AUTO_ADJUST_UTILIZATION_MIN;
    value <= AUTO_ADJUST_UTILIZATION_MAX;
    value += AUTO_ADJUST_UTILIZATION_STEP
  ) {
    candidates.push(roundValue(value));
  }

  const normalizedCurrent = clamp(
    roundValue(currentUtilization),
    AUTO_ADJUST_UTILIZATION_MIN,
    AUTO_ADJUST_UTILIZATION_MAX
  );
  if (!candidates.includes(normalizedCurrent)) {
    candidates.push(normalizedCurrent);
  }
  return Array.from(new Set(candidates)).sort((a, b) => a - b);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function parseNumber(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function getScenarioProfit(metrics: ScenarioMetrics) {
  return metrics.forecast7Profit;
}

function getScenarioRevenue(metrics: ScenarioMetrics) {
  return metrics.forecast7Revenue;
}

function getScenarioExpenses(metrics: ScenarioMetrics) {
  return metrics.forecast7Expenses;
}

function isAboveBreakEven(profit: number) {
  return profit >= 0;
}

function roundValue(value: number) {
  return Math.round(value * 100) / 100;
}

function formatSignedPercent(value: number) {
  if (value > 0) {
    return `+${value}%`;
  }
  return `${value}%`;
}

function formatSignedCurrency(value: number) {
  if (value > 0) {
    return `+${formatCurrency(value)}`;
  }
  if (value < 0) {
    return `-${formatCurrency(Math.abs(value))}`;
  }
  return formatCurrency(0);
}
