import { BarCategoryChart } from "@/components/charts/bar-category-chart";
import { Card } from "@/components/ui/card";
import { formatCurrency, formatPercent } from "@/lib/utils";

import type {
  ScenarioComparisonEntry,
  ScenarioRecommendation
} from "./forecasting-page-types";
import {
  formatSignedCurrency,
  roundValue
} from "./forecasting-page-utils";

type ComparisonChartRow = {
  id: string;
  isBaseline: boolean;
  scenario: string;
  profit: number;
};

type ForecastingComparisonSectionProps = {
  compareMode: boolean;
  comparisonEntries: ScenarioComparisonEntry[];
  recommendation: ScenarioRecommendation | null;
  isLossContext: boolean;
  bestProfitEntry: ScenarioComparisonEntry;
  bestMarginEntry: ScenarioComparisonEntry;
  lowestRiskEntry: ScenarioComparisonEntry;
  bestLossReductionEntry: ScenarioComparisonEntry;
  baselineDailyProfit: number;
  comparisonChartData: ComparisonChartRow[];
  comparisonInsights: string[];
  onOpenProfitDetails: () => void;
  onSelectScenarioForChart: (id: string) => void;
  onSelectBaselineForChart: () => void;
};

export function ForecastingComparisonSection({
  compareMode,
  comparisonEntries,
  recommendation,
  isLossContext,
  bestProfitEntry,
  bestMarginEntry,
  lowestRiskEntry,
  bestLossReductionEntry,
  baselineDailyProfit,
  comparisonChartData,
  comparisonInsights,
  onOpenProfitDetails,
  onSelectScenarioForChart,
  onSelectBaselineForChart
}: ForecastingComparisonSectionProps) {
  if (!compareMode) {
    return null;
  }

  return (
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
                  const dailyProfitChange = roundValue(entry.metrics.dailyProfit - baselineDailyProfit);
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
              onClick={onOpenProfitDetails}
              clickLabel="Open scenario profit details"
            >
              <BarCategoryChart
                data={comparisonChartData}
                xKey="scenario"
                yKey="profit"
                clickHint="Click scenario bar to load it for live editing"
                onBackgroundClick={onOpenProfitDetails}
                onElementClick={(entry) => {
                  if (!entry.id || entry.id === "baseline") {
                    onSelectBaselineForChart();
                    return;
                  }
                  onSelectScenarioForChart(entry.id);
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
  );
}
