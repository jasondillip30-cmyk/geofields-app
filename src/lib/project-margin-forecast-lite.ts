import {
  buildProjectCommercialRevenueSnapshot,
  deriveWorkProgressFromReports,
  type ProjectChangeOrderInput,
  type ProjectCommercialTermsInput
} from "@/lib/project-commercials";

type ConfidenceLevel = "STRONG" | "PARTIAL" | "WEAK";
type TrendDirection = "IMPROVING" | "STABLE" | "DETERIORATING" | "INSUFFICIENT_DATA";

interface MarginForecastSignal {
  level: "warn" | "info";
  title: string;
  detail: string;
}

interface MarginForecastSufficiency {
  windowDays: number;
  sampleSpanDays: number;
  revenueSampleDays: number;
  costSampleDays: number;
  irregularRevenue: boolean;
  irregularCost: boolean;
  weakReason: string | null;
}

export interface ProjectMarginForecastLiteSummary {
  confidenceLevel: ConfidenceLevel;
  hasNumericProjection: boolean;
  trendDirection: TrendDirection;
  dailyRevenueVelocity: number | null;
  dailyRecognizedCostVelocity: number | null;
  projected30DayRevenue: number | null;
  projected30DayRecognizedCost: number | null;
  projected30DayProfit: number | null;
  sufficiency: MarginForecastSufficiency;
  riskSignals: MarginForecastSignal[];
  narrative: string;
}

export interface ProjectMarginForecastLiteInput {
  terms: ProjectCommercialTermsInput;
  changeOrders: ProjectChangeOrderInput[];
  approvedReports: Array<{
    date: Date | string;
    totalMetersDrilled: number;
  }>;
  recognizedExpenses: Array<{
    date: Date | string;
    amount: number;
  }>;
  coverage: {
    laborCaptured: boolean;
    rigCoveragePartial: boolean;
    operatingAttributionPartial: boolean;
  };
  pendingRequisition: {
    count: number;
    value: number;
  };
  operationalRisk: {
    openBreakdowns: number;
    openMaintenance: number;
    downtimeHours: number;
  };
}

const WINDOW_DAYS = 30;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function buildProjectMarginForecastLiteSummary(
  input: ProjectMarginForecastLiteInput
): ProjectMarginForecastLiteSummary {
  const asOfDate = resolveAsOfDate(input);
  const windowStart = new Date(asOfDate.getTime() - (WINDOW_DAYS - 1) * MS_PER_DAY);

  const normalizedReports = normalizeReports(input.approvedReports);
  const normalizedExpenses = normalizeExpenses(input.recognizedExpenses);

  const reportsInWindow = normalizedReports.filter(
    (report) => report.date.getTime() >= windowStart.getTime() && report.date.getTime() <= asOfDate.getTime()
  );
  const expensesInWindow = normalizedExpenses.filter(
    (expense) => expense.date.getTime() >= windowStart.getTime() && expense.date.getTime() <= asOfDate.getTime()
  );

  const revenueSnapshotNow = buildProjectCommercialRevenueSnapshot({
    terms: input.terms,
    work: deriveWorkProgressFromReports(normalizedReports),
    changeOrders: input.changeOrders
  });
  const revenueSnapshotBeforeWindow = buildProjectCommercialRevenueSnapshot({
    terms: input.terms,
    work: deriveWorkProgressFromReports(
      normalizedReports.filter((report) => report.date.getTime() < windowStart.getTime())
    ),
    changeOrders: input.changeOrders
  });

  const earnedRevenueWindow = roundCurrency(
    Math.max(0, revenueSnapshotNow.earnedRevenue - revenueSnapshotBeforeWindow.earnedRevenue)
  );
  const recognizedCostWindow = roundCurrency(
    expensesInWindow.reduce((sum, expense) => sum + expense.amount, 0)
  );

  const revenueSampleDays = countUniqueDays(reportsInWindow.map((report) => report.date));
  const costSampleDays = countUniqueDays(expensesInWindow.map((expense) => expense.date));
  const sampleSpanDays = computeSampleSpanDays([
    ...reportsInWindow.map((report) => report.date),
    ...expensesInWindow.map((expense) => expense.date)
  ]);

  const irregularRevenue = isIrregular(
    toDailySeries(
      reportsInWindow.map((report) => ({
        date: report.date,
        value: report.totalMetersDrilled
      }))
    )
  );
  const irregularCost = isIrregular(
    toDailySeries(
      expensesInWindow.map((expense) => ({
        date: expense.date,
        value: expense.amount
      }))
    )
  );

  const baseConfidence = resolveBaseConfidence({
    revenueSampleDays,
    costSampleDays,
    sampleSpanDays,
    irregularRevenue,
    irregularCost
  });
  const confidenceLevel = downgradeConfidenceForCoverage(baseConfidence, input.coverage);
  const weakReason =
    confidenceLevel === "WEAK"
      ? resolveWeakReason({
          revenueSampleDays,
          costSampleDays,
          sampleSpanDays,
          irregularRevenue,
          irregularCost,
          coverage: input.coverage
        })
      : null;

  const hasNumericProjection = confidenceLevel !== "WEAK";
  const dailyRevenueVelocity = hasNumericProjection
    ? roundCurrency(earnedRevenueWindow / WINDOW_DAYS)
    : null;
  const dailyRecognizedCostVelocity = hasNumericProjection
    ? roundCurrency(recognizedCostWindow / WINDOW_DAYS)
    : null;
  const projected30DayRevenue =
    dailyRevenueVelocity !== null ? roundCurrency(dailyRevenueVelocity * WINDOW_DAYS) : null;
  const projected30DayRecognizedCost =
    dailyRecognizedCostVelocity !== null
      ? roundCurrency(dailyRecognizedCostVelocity * WINDOW_DAYS)
      : null;
  const projected30DayProfit =
    projected30DayRevenue !== null && projected30DayRecognizedCost !== null
      ? roundCurrency(projected30DayRevenue - projected30DayRecognizedCost)
      : null;

  const trendDirection = resolveTrendDirection({
    hasNumericProjection,
    dailyRevenueVelocity,
    dailyRecognizedCostVelocity
  });

  const riskSignals = buildRiskSignals({
    confidenceLevel,
    weakReason,
    trendDirection,
    projected30DayProfit,
    coverage: input.coverage,
    pendingRequisition: input.pendingRequisition,
    operationalRisk: input.operationalRisk
  });

  return {
    confidenceLevel,
    hasNumericProjection,
    trendDirection,
    dailyRevenueVelocity,
    dailyRecognizedCostVelocity,
    projected30DayRevenue,
    projected30DayRecognizedCost,
    projected30DayProfit,
    sufficiency: {
      windowDays: WINDOW_DAYS,
      sampleSpanDays,
      revenueSampleDays,
      costSampleDays,
      irregularRevenue,
      irregularCost,
      weakReason
    },
    riskSignals,
    narrative: buildNarrative({
      confidenceLevel,
      trendDirection,
      hasNumericProjection,
      weakReason
    })
  };
}

function resolveAsOfDate(input: ProjectMarginForecastLiteInput) {
  const timestamps = [
    ...input.approvedReports.map((entry) => toDate(entry.date).getTime()),
    ...input.recognizedExpenses.map((entry) => toDate(entry.date).getTime())
  ].filter((value) => Number.isFinite(value));

  if (timestamps.length === 0) {
    return new Date();
  }
  return new Date(Math.max(...timestamps));
}

function normalizeReports(
  reports: ProjectMarginForecastLiteInput["approvedReports"]
): Array<{ date: Date; totalMetersDrilled: number }> {
  return reports
    .map((report) => ({
      date: toDate(report.date),
      totalMetersDrilled: safeNumber(report.totalMetersDrilled)
    }))
    .filter((report) => !Number.isNaN(report.date.getTime()));
}

function normalizeExpenses(
  expenses: ProjectMarginForecastLiteInput["recognizedExpenses"]
): Array<{ date: Date; amount: number }> {
  return expenses
    .map((expense) => ({
      date: toDate(expense.date),
      amount: safeNumber(expense.amount)
    }))
    .filter((expense) => !Number.isNaN(expense.date.getTime()) && expense.amount > 0);
}

function resolveBaseConfidence(input: {
  revenueSampleDays: number;
  costSampleDays: number;
  sampleSpanDays: number;
  irregularRevenue: boolean;
  irregularCost: boolean;
}): ConfidenceLevel {
  if (
    input.revenueSampleDays >= 8 &&
    input.costSampleDays >= 8 &&
    input.sampleSpanDays >= 21 &&
    !input.irregularRevenue &&
    !input.irregularCost
  ) {
    return "STRONG";
  }

  if (
    input.revenueSampleDays >= 4 &&
    input.costSampleDays >= 4 &&
    input.sampleSpanDays >= 10 &&
    !input.irregularRevenue &&
    !input.irregularCost
  ) {
    return "PARTIAL";
  }

  return "WEAK";
}

function downgradeConfidenceForCoverage(
  base: ConfidenceLevel,
  coverage: ProjectMarginForecastLiteInput["coverage"]
): ConfidenceLevel {
  if (!coverage.rigCoveragePartial && !coverage.operatingAttributionPartial && coverage.laborCaptured) {
    return base;
  }
  if (base === "STRONG") {
    return "PARTIAL";
  }
  if (base === "PARTIAL") {
    return "WEAK";
  }
  return "WEAK";
}

function resolveWeakReason(input: {
  revenueSampleDays: number;
  costSampleDays: number;
  sampleSpanDays: number;
  irregularRevenue: boolean;
  irregularCost: boolean;
  coverage: ProjectMarginForecastLiteInput["coverage"];
}) {
  if (input.revenueSampleDays < 4 || input.costSampleDays < 4) {
    return "Insufficient recent sample days for reliable velocity.";
  }
  if (input.sampleSpanDays < 10) {
    return "Recent sample span is too short for stable trend projection.";
  }
  if (input.irregularRevenue || input.irregularCost) {
    return "Recent revenue/cost activity is too irregular for reliable numeric projection.";
  }
  if (!input.coverage.laborCaptured || input.coverage.rigCoveragePartial || input.coverage.operatingAttributionPartial) {
    return "Cost coverage gaps reduce trust in forward-looking margin projection.";
  }
  return "Forecast confidence is weak due to combined data-quality constraints.";
}

function resolveTrendDirection(input: {
  hasNumericProjection: boolean;
  dailyRevenueVelocity: number | null;
  dailyRecognizedCostVelocity: number | null;
}): TrendDirection {
  if (!input.hasNumericProjection || input.dailyRevenueVelocity === null || input.dailyRecognizedCostVelocity === null) {
    return "INSUFFICIENT_DATA";
  }
  const diff = input.dailyRevenueVelocity - input.dailyRecognizedCostVelocity;
  const threshold = Math.max(
    25,
    Math.max(input.dailyRevenueVelocity, input.dailyRecognizedCostVelocity) * 0.08
  );

  if (diff > threshold) {
    return "IMPROVING";
  }
  if (diff < -threshold) {
    return "DETERIORATING";
  }
  return "STABLE";
}

function buildRiskSignals(input: {
  confidenceLevel: ConfidenceLevel;
  weakReason: string | null;
  trendDirection: TrendDirection;
  projected30DayProfit: number | null;
  coverage: ProjectMarginForecastLiteInput["coverage"];
  pendingRequisition: ProjectMarginForecastLiteInput["pendingRequisition"];
  operationalRisk: ProjectMarginForecastLiteInput["operationalRisk"];
}): MarginForecastSignal[] {
  const signals: MarginForecastSignal[] = [];

  if (input.confidenceLevel === "WEAK") {
    signals.push({
      level: "warn",
      title: "Forecast confidence is weak",
      detail: input.weakReason || "Trend projection is qualitative only due to weak sample sufficiency."
    });
  }

  if (input.trendDirection === "DETERIORATING") {
    signals.push({
      level: "warn",
      title: "Cost velocity is outpacing revenue velocity",
      detail: "Current run-rate trend indicates margin pressure if recent trajectory continues."
    });
  }

  if (input.projected30DayProfit !== null && input.projected30DayProfit < 0) {
    signals.push({
      level: "warn",
      title: "Projected 30-day margin is negative",
      detail: "Near-term run-rate projection suggests loss risk under current trend."
    });
  }

  if (!input.coverage.laborCaptured || input.coverage.rigCoveragePartial || input.coverage.operatingAttributionPartial) {
    signals.push({
      level: "info",
      title: "Coverage gaps reduce forecast trust",
      detail:
        "Labor capture, rig-cost basis, or operating attribution gaps can weaken confidence in forward-looking margin."
    });
  }

  if (input.pendingRequisition.count > 0 && input.pendingRequisition.value > 0) {
    signals.push({
      level: "info",
      title: "Pending recognized-cost pressure",
      detail:
        `${input.pendingRequisition.count} approved requisition(s) may post additional recognized cost soon.`
    });
  }

  if (input.operationalRisk.openBreakdowns > 0 || input.operationalRisk.openMaintenance > 0) {
    signals.push({
      level: "info",
      title: "Operational disruptions can shift forecast",
      detail:
        `${input.operationalRisk.openBreakdowns} open breakdown(s) and ${input.operationalRisk.openMaintenance} open maintenance case(s) can alter near-term margin trajectory.`
    });
  }

  if (signals.length === 0) {
    signals.push({
      level: "info",
      title: "No immediate forward-looking margin alerts",
      detail: "Recent run-rate and coverage context do not indicate urgent forecast risk."
    });
  }

  return signals;
}

function buildNarrative(input: {
  confidenceLevel: ConfidenceLevel;
  trendDirection: TrendDirection;
  hasNumericProjection: boolean;
  weakReason: string | null;
}) {
  if (!input.hasNumericProjection) {
    return input.weakReason || "Forecast is qualitative only in current scope.";
  }
  if (input.trendDirection === "IMPROVING") {
    return "Recent run-rate suggests margin is trending in a positive direction.";
  }
  if (input.trendDirection === "DETERIORATING") {
    return "Recent run-rate suggests margin deterioration risk.";
  }
  return "Recent run-rate indicates a relatively stable margin trend.";
}

function countUniqueDays(dates: Date[]) {
  return new Set(dates.map((date) => date.toISOString().slice(0, 10))).size;
}

function computeSampleSpanDays(dates: Date[]) {
  if (dates.length === 0) {
    return 0;
  }
  let minTime = dates[0].getTime();
  let maxTime = dates[0].getTime();
  for (const date of dates) {
    const time = date.getTime();
    if (time < minTime) {
      minTime = time;
    }
    if (time > maxTime) {
      maxTime = time;
    }
  }
  return Math.floor((maxTime - minTime) / MS_PER_DAY) + 1;
}

function toDailySeries(rows: Array<{ date: Date; value: number }>) {
  const map = new Map<string, number>();
  for (const row of rows) {
    const key = row.date.toISOString().slice(0, 10);
    map.set(key, (map.get(key) || 0) + safeNumber(row.value));
  }
  return Array.from(map.values()).filter((value) => value > 0);
}

function isIrregular(series: number[]) {
  if (series.length < 3) {
    return true;
  }
  const mean = series.reduce((sum, value) => sum + value, 0) / series.length;
  if (mean <= 0) {
    return true;
  }
  const max = Math.max(...series);
  return max >= mean * 4;
}

function toDate(value: Date | string) {
  return value instanceof Date ? value : new Date(value);
}

function safeNumber(value: unknown) {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }
  return parsed;
}

function roundCurrency(value: number) {
  return Math.round(value * 100) / 100;
}
