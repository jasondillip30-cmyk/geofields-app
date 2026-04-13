import type { CopilotPageContext } from "@/lib/ai/contextual-copilot";
import { formatCurrency, formatPercent } from "@/lib/utils";

import {
  AUTO_ADJUST_MIN_IMPROVEMENT,
  AUTO_ADJUST_NEAR_OPTIMAL_DELTA_MIN,
  AUTO_ADJUST_NEAR_OPTIMAL_DELTA_RATIO,
  AUTO_ADJUST_PROFIT_TIE_EPSILON,
  AUTO_ADJUST_UTILIZATION_MAX,
  AUTO_ADJUST_UTILIZATION_MIN,
  type AutoAdjustSummary,
  type BaselineTotals,
  type ExpenseCategoryBaseline,
  type ScenarioComparisonEntry,
  type ScenarioDefinition,
  type ScenarioRecommendation,
  type ScenarioMetrics,
  type SimulationBaseline
} from "./forecasting-page-types";
import {
  assessRecommendationRisk,
  buildRecommendationDriverExplanation,
  calculateBreakEvenPlan,
  evaluateScenarioMetrics,
  formatSignedCurrency,
  formatSignedPercent,
  getAutoAdjustCandidateUtilizations,
  getScenarioProfit,
  isAboveBreakEven,
  roundValue
} from "./forecasting-page-utils";

export type ComparisonLeaders = {
  bestProfitEntry: ScenarioComparisonEntry;
  bestMarginEntry: ScenarioComparisonEntry;
  lowestRiskEntry: ScenarioComparisonEntry;
  bestLossReductionEntry: ScenarioComparisonEntry;
  hasAnyPositiveProfit: boolean;
  isLossContext: boolean;
  recommendedEntry: ScenarioComparisonEntry;
};

export function deriveComparisonLeaders(comparisonEntries: ScenarioComparisonEntry[]): ComparisonLeaders {
  const bestProfitEntry = comparisonEntries.reduce((best, current) =>
    current.metrics.forecast30Profit > best.metrics.forecast30Profit ? current : best
  );
  const bestMarginEntry = comparisonEntries.reduce((best, current) =>
    current.metrics.margin30 > best.metrics.margin30 ? current : best
  );
  const nonBaselineEntries = comparisonEntries.filter((item) => !item.isBaseline);
  const lowestRiskEntry =
    nonBaselineEntries.length === 0
      ? comparisonEntries[0]
      : nonBaselineEntries.reduce((best, current) => (current.riskScore < best.riskScore ? current : best));
  const bestLossReductionEntry =
    nonBaselineEntries.length === 0
      ? comparisonEntries[0]
      : nonBaselineEntries.reduce((best, current) =>
          current.metrics.diff30 > best.metrics.diff30 ? current : best
        );
  const hasAnyPositiveProfit = comparisonEntries.some((entry) => entry.metrics.forecast30Profit > 0);
  const allNegativeProfit = comparisonEntries.every((entry) => entry.metrics.forecast30Profit < 0);
  const allNegativeMargin = comparisonEntries.every((entry) => entry.metrics.margin30 < 0);
  const isLossContext = !hasAnyPositiveProfit || allNegativeProfit || allNegativeMargin;
  const recommendedEntry = comparisonEntries.reduce((best, current) => {
    if (current.metrics.forecast30Profit !== best.metrics.forecast30Profit) {
      return current.metrics.forecast30Profit > best.metrics.forecast30Profit ? current : best;
    }
    if (current.metrics.margin30 !== best.metrics.margin30) {
      return current.metrics.margin30 > best.metrics.margin30 ? current : best;
    }
    return current.riskScore < best.riskScore ? current : best;
  });

  return {
    bestProfitEntry,
    bestMarginEntry,
    lowestRiskEntry,
    bestLossReductionEntry,
    hasAnyPositiveProfit,
    isLossContext,
    recommendedEntry
  };
}

type BuildScenarioRecommendationParams = {
  comparisonEntries: ScenarioComparisonEntry[];
  leaders: ComparisonLeaders;
  baselineRevenue7: number;
  scenarioDefinitionById: Map<string, ScenarioDefinition>;
};

export function buildScenarioRecommendation({
  comparisonEntries,
  leaders,
  baselineRevenue7,
  scenarioDefinitionById
}: BuildScenarioRecommendationParams): ScenarioRecommendation | null {
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

  const {
    bestProfitEntry,
    bestMarginEntry,
    lowestRiskEntry,
    bestLossReductionEntry,
    isLossContext,
    recommendedEntry
  } = leaders;

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
    baselineRevenue: baselineRevenue7
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
}

export function buildComparisonInsights(params: {
  comparisonEntries: ScenarioComparisonEntry[];
  isLossContext: boolean;
  recommendation: ScenarioRecommendation | null;
}) {
  const { comparisonEntries, isLossContext, recommendation } = params;
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
}

export function buildScenarioForecastRows(
  baseline: SimulationBaseline,
  simulation: ScenarioMetrics
) {
  return Array.from({ length: 30 }, (_, index) => {
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
  });
}

export function buildForecastingCopilotContext(params: {
  filters: {
    clientId: string;
    rigId: string;
    from: string;
    to: string;
  };
  baselineTotals: BaselineTotals;
  simulation: ScenarioMetrics;
  comparisonEntries: ScenarioComparisonEntry[];
  recommendation: ScenarioRecommendation | null;
  compareMode: boolean;
  buildHref: (path: string, overrides?: Record<string, string | null | undefined>) => string;
}): CopilotPageContext {
  const { filters, baselineTotals, simulation, comparisonEntries, recommendation, compareMode, buildHref } = params;
  return {
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
        href: buildHref("/spending/profit"),
        reason: "Validate scenario assumptions against actual profit drivers.",
        pageKey: "profit",
        sectionId: "profit-primary-kpi-section"
      },
      {
        label: "Open Project Operations",
        href: buildHref("/spending"),
        reason: "Review recognized cost trends in the Spending workspace.",
        pageKey: "cost-tracking"
      }
    ],
    notes: [
      compareMode ? "Comparison mode active." : "Single-scenario mode active.",
      "Forecasting guidance is advisory-only and does not commit financial changes."
    ]
  };
}

export type AutoAdjustResult = {
  nextUtilization: number | null;
  summary: AutoAdjustSummary;
  audit: {
    action: string;
    entityId: string;
    description: string;
    before: {
      utilizationChangePct: number;
      forecast30Profit: number;
    };
    after: {
      utilizationChangePct: number;
      forecast30Profit: number;
    };
  };
};

export function computeAutoAdjustResult(params: {
  currentUtilization: number;
  simulation: ScenarioMetrics;
  baseline: SimulationBaseline;
  baselineTotals: BaselineTotals;
  activeScenarioDefinition: ScenarioDefinition;
  categoryMap: Map<string, ExpenseCategoryBaseline>;
  bestSavedScenario: { name: string; metrics: ScenarioMetrics } | null;
  activeEditingScenarioId: string | null;
}): AutoAdjustResult | null {
  const {
    currentUtilization,
    simulation,
    baseline,
    baselineTotals,
    activeScenarioDefinition,
    categoryMap,
    bestSavedScenario,
    activeEditingScenarioId
  } = params;
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
    return null;
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
    return {
      nextUtilization: null,
      summary: {
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
      },
      audit: {
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
      }
    };
  }

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

  return {
    nextUtilization: bestCandidate.utilization,
    summary: {
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
    },
    audit: {
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
    }
  };
}
