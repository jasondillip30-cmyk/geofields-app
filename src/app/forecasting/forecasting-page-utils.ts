import { formatCurrency, formatPercent } from "@/lib/utils";
import {
  AUTO_ADJUST_UTILIZATION_MAX,
  AUTO_ADJUST_UTILIZATION_MIN,
  AUTO_ADJUST_UTILIZATION_STEP,
  COST_CUT_REALISTIC_THRESHOLD_PCT,
  CUSTOM_CATEGORY_OPTION,
  UTILIZATION_REALISTIC_THRESHOLD_PCT,
  type BaselineTotals,
  type BreakEvenPlan,
  type ExpenseCategoryBaseline,
  type RiskAssessment,
  type ScenarioComparisonEntry,
  type ScenarioDefinition,
  type ScenarioMetrics,
  type SimulationBaseline,
  type SimulationRow
} from "./forecasting-page-types";

export function buildScenarioDefinition(
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

export function getBaselineTotals(baseline: SimulationBaseline): BaselineTotals {
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

export function evaluateScenarioMetrics({
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

  const impacts = definition.rows.map((row, index) => {
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
        source: isCustom ? ("custom" as const) : ("existing" as const),
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
      source: isCustom ? ("custom" as const) : ("existing" as const),
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

export function calculateBreakEvenPlan({
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

export function buildRecommendationDriverExplanation({
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

export function assessRecommendationRisk({
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

export function calculateRiskScore(definition: ScenarioDefinition, baselineExpense30: number) {
  const base = Math.max(1, baselineExpense30);
  const adjustmentScore = definition.rows.reduce((sum, row) => {
    if (row.mode === "percent") {
      return sum + Math.abs(row.value);
    }
    return sum + (Math.abs(row.value) / base) * 100;
  }, 0);
  return roundValue(Math.abs(definition.utilizationChangePct) * 0.4 + adjustmentScore);
}

export function getUsedExistingCategories(rows: SimulationRow[], excludedRowId?: string) {
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

export function generateId() {
  return `sim-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function getAutoAdjustCandidateUtilizations(currentUtilization: number) {
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

export function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function parseNumber(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function getScenarioProfit(metrics: ScenarioMetrics) {
  return metrics.forecast7Profit;
}

export function getScenarioRevenue(metrics: ScenarioMetrics) {
  return metrics.forecast7Revenue;
}

export function getScenarioExpenses(metrics: ScenarioMetrics) {
  return metrics.forecast7Expenses;
}

export function isAboveBreakEven(profit: number) {
  return profit >= 0;
}

export function roundValue(value: number) {
  return Math.round(value * 100) / 100;
}

export function formatSignedPercent(value: number) {
  if (value > 0) {
    return `+${value}%`;
  }
  return `${value}%`;
}

export function formatSignedCurrency(value: number) {
  if (value > 0) {
    return `+${formatCurrency(value)}`;
  }
  if (value < 0) {
    return `-${formatCurrency(Math.abs(value))}`;
  }
  return formatCurrency(0);
}
