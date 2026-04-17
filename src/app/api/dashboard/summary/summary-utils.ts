import type { RigStatus } from "@prisma/client";

import { buildRecognizedSpendContext } from "@/lib/recognized-spend-context";
import { formatProjectContractRateDisplay } from "@/lib/project-contract-display";

interface RigProfitAccumulator {
  id: string;
  name: string;
  revenue: number;
  expenses: number;
  profit: number;
}

interface RigProfitSnapshot {
  id: string;
  name: string;
  revenue: number;
  expenses: number;
  profit: number;
  margin: number;
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

export function nullableFilter(value: string | null) {
  return value && value !== "all" ? value : null;
}

export function extractErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return "Unknown error";
}

export function extractRouteLine(error: unknown) {
  if (!(error instanceof Error) || !error.stack) {
    return null;
  }
  const lineMatch = error.stack.match(/route\.ts:(\d+:\d+)/);
  return lineMatch ? `route.ts:${lineMatch[1]}` : null;
}

export function parseDateOrNull(value: string | null, endOfDay = false) {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  if (endOfDay) {
    parsed.setUTCHours(23, 59, 59, 999);
  } else {
    parsed.setUTCHours(0, 0, 0, 0);
  }
  return parsed;
}

export function resolveTrendGranularity({
  fromDate,
  toDate,
  reportDates,
  expenseDates
}: {
  fromDate: Date | null;
  toDate: Date | null;
  reportDates: Date[];
  expenseDates: Date[];
}): "day" | "month" {
  if (fromDate && toDate) {
    return inclusiveRangeDays(fromDate, toDate) <= 31 ? "day" : "month";
  }

  const allDates = [...reportDates, ...expenseDates];
  if (allDates.length === 0) {
    return "day";
  }

  let min = allDates[0];
  let max = allDates[0];
  for (const date of allDates) {
    if (date.getTime() < min.getTime()) {
      min = date;
    }
    if (date.getTime() > max.getTime()) {
      max = date;
    }
  }

  return inclusiveRangeDays(min, max) <= 31 ? "day" : "month";
}

export function resolveEffectiveRange({
  fromDate,
  toDate,
  reportDates,
  expenseDates
}: {
  fromDate: Date | null;
  toDate: Date | null;
  reportDates: Date[];
  expenseDates: Date[];
}) {
  const allDates = [...reportDates, ...expenseDates];
  const minDate = findDateBoundary(allDates, "min");
  const maxDate = findDateBoundary(allDates, "max");

  const start = fromDate || minDate || startOfUtcDay(new Date());
  let end = toDate || maxDate || endOfUtcDay(start);
  if (end.getTime() < start.getTime()) {
    end = endOfUtcDay(start);
  }

  return {
    start,
    end,
    days: inclusiveRangeDays(start, end)
  };
}

export function inclusiveRangeDays(start: Date, end: Date) {
  const utcStart = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate());
  const utcEnd = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate());
  return Math.max(1, Math.floor((utcEnd - utcStart) / 86400000) + 1);
}

export function buildTrendKey(date: Date, granularity: "day" | "month") {
  return granularity === "day" ? date.toISOString().slice(0, 10) : date.toISOString().slice(0, 7);
}

export function formatBucketLabel(bucketStart: string, granularity: "day" | "month") {
  if (granularity === "day") {
    const date = new Date(`${bucketStart}T00:00:00.000Z`);
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "2-digit",
      timeZone: "UTC"
    }).format(date);
  }

  const date = new Date(`${bucketStart}-01T00:00:00.000Z`);
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    year: "2-digit",
    timeZone: "UTC"
  }).format(date);
}

export function sortByRevenue<T extends { revenue: number }>(items: T[]) {
  return [...items].sort((a, b) => b.revenue - a.revenue);
}

export function upsertRigProfit(map: Map<string, RigProfitAccumulator>, id: string, name: string) {
  const current = map.get(id) || {
    id,
    name,
    revenue: 0,
    expenses: 0,
    profit: 0
  };

  if ((!current.name || current.name.startsWith("Unknown")) && name) {
    current.name = name;
  }

  map.set(id, current);
  return current;
}

export function buildActualVsForecastProfit({
  dailyProfitMap,
  avgDailyProfit,
  endDate,
  daysForward
}: {
  dailyProfitMap: Map<string, number>;
  avgDailyProfit: number;
  endDate: Date;
  daysForward: number;
}) {
  const rows: Array<{
    bucketStart: string;
    label: string;
    actualProfit: number | null;
    forecastProfit: number | null;
  }> = [];

  const sortedDays = Array.from(dailyProfitMap.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  let cumulativeProfit = 0;
  for (const [bucketStart, profit] of sortedDays) {
    cumulativeProfit += profit;
    rows.push({
      bucketStart,
      label: formatBucketLabel(bucketStart, "day"),
      actualProfit: roundCurrency(cumulativeProfit),
      forecastProfit: null
    });
  }

  const anchorDate = sortedDays.length > 0 ? parseDayKey(sortedDays[sortedDays.length - 1][0]) : startOfUtcDay(endDate);
  for (let index = 1; index <= daysForward; index += 1) {
    const futureDate = addUtcDays(anchorDate, index);
    const bucketStart = futureDate.toISOString().slice(0, 10);
    cumulativeProfit += avgDailyProfit;
    rows.push({
      bucketStart,
      label: formatBucketLabel(bucketStart, "day"),
      actualProfit: null,
      forecastProfit: roundCurrency(cumulativeProfit)
    });
  }

  return rows;
}

export function buildRigStatusData(statuses: RigStatus[]) {
  const counters: Record<RigStatus, number> = {
    ACTIVE: 0,
    IDLE: 0,
    MAINTENANCE: 0,
    BREAKDOWN: 0
  };

  for (const status of statuses) {
    counters[status] += 1;
  }

  return Object.entries(counters)
    .map(([status, value]) => ({ status, value }))
    .filter((entry) => entry.value > 0);
}

export function buildProjectAssignments({
  projects,
  clientId,
  rigId,
  shouldRestrictToScope,
  scopedProjectIds
}: {
  projects: Array<{
    id: string;
    clientId: string;
    name: string;
    location: string;
    status: string;
    contractType: "PER_METER" | "DAY_RATE" | "LUMP_SUM";
    contractRatePerM: number;
    contractDayRate: number;
    contractLumpSumValue: number;
    billingRateItems: Array<{
      unit: string;
      drillingStageLabel: string | null;
      depthBandStartM: number | null;
      depthBandEndM: number | null;
      isActive: boolean;
    }>;
    assignedRigId: string | null;
    backupRigId: string | null;
    assignedRig: { id: string; rigCode: string } | null;
  }>;
  clientId: string | null;
  rigId: string | null;
  shouldRestrictToScope: boolean;
  scopedProjectIds: Set<string>;
}) {
  return projects
    .filter((project) => {
      if (clientId && project.clientId !== clientId) {
        return false;
      }

      if (rigId && project.assignedRigId !== rigId && project.backupRigId !== rigId && !scopedProjectIds.has(project.id)) {
        return false;
      }

      if (shouldRestrictToScope && scopedProjectIds.size > 0 && !scopedProjectIds.has(project.id)) {
        return false;
      }
      if (shouldRestrictToScope && scopedProjectIds.size === 0) {
        return false;
      }

      return true;
    })
    .map((project) => ({
      id: project.id,
      name: project.name,
      location: project.location,
      status: project.status,
      assignedRigCode: project.assignedRig?.rigCode || "Unassigned",
      contractRatePerM: project.contractRatePerM,
      contractRateLabel: formatProjectContractRateDisplay({
        contractType: project.contractType,
        contractRatePerM: project.contractRatePerM,
        contractDayRate: project.contractDayRate,
        contractLumpSumValue: project.contractLumpSumValue,
        billingRateItems: project.billingRateItems
      })
    }));
}

export function findDateBoundary(dates: Date[], type: "min" | "max") {
  if (dates.length === 0) {
    return null;
  }

  let boundary = dates[0];
  for (const date of dates) {
    const isEarlier = date.getTime() < boundary.getTime();
    const isLater = date.getTime() > boundary.getTime();
    if ((type === "min" && isEarlier) || (type === "max" && isLater)) {
      boundary = date;
    }
  }

  return type === "min" ? startOfUtcDay(boundary) : endOfUtcDay(boundary);
}

export function parseDayKey(dayKey: string) {
  return new Date(`${dayKey}T00:00:00.000Z`);
}

export function startOfUtcDay(date: Date) {
  const normalized = new Date(date);
  normalized.setUTCHours(0, 0, 0, 0);
  return normalized;
}

export function endOfUtcDay(date: Date) {
  const normalized = new Date(date);
  normalized.setUTCHours(23, 59, 59, 999);
  return normalized;
}

export function startOfUtcWeek(date: Date) {
  const normalized = startOfUtcDay(date);
  const day = normalized.getUTCDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  normalized.setUTCDate(normalized.getUTCDate() + mondayOffset);
  return normalized;
}

export function addUtcDays(date: Date, days: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

export function buildRecommendations({
  grossProfit,
  forecastNext30Profit,
  totalExpenses,
  daysInScope,
  rigSnapshots,
  expenseCategoryShares,
  inventoryLowStockCount,
  inventoryOutOfStockCount
}: {
  grossProfit: number;
  forecastNext30Profit: number;
  totalExpenses: number;
  daysInScope: number;
  rigSnapshots: RigProfitSnapshot[];
  expenseCategoryShares: Array<{ category: string; amount: number; percentOfTotal: number }>;
  inventoryLowStockCount: number;
  inventoryOutOfStockCount: number;
}) {
  const recommendations: RecommendationItem[] = [];

  const safeDays = Math.max(1, daysInScope);
  const addRecommendation = (item: RecommendationItem) => {
    if (!recommendations.some((entry) => entry.title === item.title)) {
      recommendations.push(item);
    }
  };

  if (inventoryOutOfStockCount > 0) {
    addRecommendation({
      tone: "danger",
      priority: "HIGH",
      title: "Inventory Stockout Risk",
      message: `${inventoryOutOfStockCount} inventory item(s) are out of stock. Expedite purchasing for critical maintenance parts.`,
      estimatedImpact: null,
      actions: [
        "Prioritize emergency purchase orders for critical stockouts.",
        "Review impacted rigs and maintenance tasks immediately.",
        "Track stockout closure in daily operations standup."
      ],
      primaryActionLabel: "Take Action",
      secondaryActionLabel: "View Details"
    });
  } else if (inventoryLowStockCount > 0) {
    addRecommendation({
      tone: "warn",
      priority: "MEDIUM",
      title: "Inventory Low Stock",
      message: `${inventoryLowStockCount} item(s) are below minimum stock levels and trending toward stockout.`,
      estimatedImpact: null,
      actions: [
        "Raise replenishment requests for low-stock parts.",
        "Increase monitoring cadence for fast-moving components.",
        "Align stock plans with maintenance workload forecasts."
      ],
      primaryActionLabel: "View Details",
      secondaryActionLabel: "Take Action"
    });
  }

  if (grossProfit < 0) {
    const breakEvenReductionPercent = totalExpenses > 0 ? calculatePercent(Math.abs(grossProfit), totalExpenses) : 0;
    const targetReductionPercent = Math.max(20, breakEvenReductionPercent);
    const expenseReductionImpact =
      totalExpenses > 0 ? roundCurrency((targetReductionPercent / 100) * totalExpenses) : Math.abs(grossProfit);

    addRecommendation({
      tone: "danger",
      priority: "HIGH",
      title: "Loss Alert",
      message:
        breakEvenReductionPercent > 20
          ? `Business is operating at a loss. Reduce total expenses by at least 20% immediately; full break-even needs about ${formatPercent(
              breakEvenReductionPercent
            )}.`
          : "Business is operating at a loss. Reduce total expenses by at least 20% to break even.",
      estimatedImpact: expenseReductionImpact,
      actions: [
        "Cut non-essential operating spend this week.",
        "Review top cost centers and set hard reduction targets.",
        "Escalate unprofitable contracts for commercial review."
      ],
      primaryActionLabel: "Take Action",
      secondaryActionLabel: "View Details"
    });
  }

  if (forecastNext30Profit < 0) {
    addRecommendation({
      tone: "danger",
      priority: "HIGH",
      title: "Forecast Risk",
      message: "Projected losses will continue if no changes are made.",
      estimatedImpact: Math.abs(forecastNext30Profit),
      actions: [
        "Apply immediate cost controls on low-efficiency rigs.",
        "Increase utilization of high-margin rigs.",
        "Reassign rigs from weak projects to stronger contracts."
      ],
      primaryActionLabel: "Take Action",
      secondaryActionLabel: "View Details"
    });
  }

  const lossMakingRigs = [...rigSnapshots].filter((rig) => rig.profit < 0).sort((a, b) => a.profit - b.profit);
  for (const rig of lossMakingRigs.slice(0, 2)) {
    const dailyLoss = roundCurrency(Math.abs(rig.profit) / safeDays);
    const monthlyRecovery = roundCurrency(dailyLoss * 30);
    addRecommendation({
      tone: dailyLoss >= 300 ? "danger" : "warn",
      priority: dailyLoss >= 300 ? "HIGH" : "MEDIUM",
      title: `Rig Action: ${rig.name}`,
      message: `Rig ${rig.name} is losing ${formatCurrencyAmount(dailyLoss)}/day.`,
      estimatedImpact: monthlyRecovery,
      actions: [
        "Reduce operating costs on this rig.",
        "Increase drilling rate and billable output.",
        "Reassign to a higher-paying project."
      ],
      primaryActionLabel: "Take Action",
      secondaryActionLabel: "View Details"
    });
  }

  const dominantCategory = expenseCategoryShares.find((category) => category.percentOfTotal > 50);
  if (dominantCategory) {
    const reductionImpact = roundCurrency(dominantCategory.amount * 0.1);
    addRecommendation({
      tone: dominantCategory.percentOfTotal >= 70 ? "danger" : "warn",
      priority: dominantCategory.percentOfTotal >= 70 ? "HIGH" : "MEDIUM",
      title: "Cost Concentration",
      message: `${dominantCategory.category} represents ${formatPercent(
        dominantCategory.percentOfTotal
      )} of costs. Reducing by 10% would improve profit by ${formatCurrencyAmount(reductionImpact)}.`,
      estimatedImpact: reductionImpact,
      actions: [
        `Audit ${dominantCategory.category} consumption and waste.`,
        "Negotiate supplier pricing and enforce purchase controls.",
        "Track weekly variance against budget."
      ],
      primaryActionLabel: "View Details",
      secondaryActionLabel: "Take Action"
    });
  }

  const bestMarginRig = [...rigSnapshots]
    .filter((rig) => rig.revenue > 0 && rig.profit > 0)
    .sort((a, b) => {
      if (b.margin !== a.margin) {
        return b.margin - a.margin;
      }
      return b.profit - a.profit;
    })[0];
  if (bestMarginRig) {
    const dailyGain = roundCurrency(bestMarginRig.profit / safeDays);
    const utilizationImpact = roundCurrency(dailyGain * 30 * 0.2);
    addRecommendation({
      tone: "good",
      priority: "LOW",
      title: "Best Opportunity",
      message: `${bestMarginRig.name} generates ${formatCurrencyAmount(
        dailyGain
      )}/day. Increasing utilization by 20% could add ~${formatCurrencyAmount(utilizationImpact)}/month.`,
      estimatedImpact: utilizationImpact,
      actions: [
        "Prioritize this rig on high-rate projects.",
        "Minimize standby and movement downtime.",
        "Maintain preventive service to protect uptime."
      ],
      primaryActionLabel: "Take Action",
      secondaryActionLabel: "View Details"
    });
  }

  if (recommendations.length < 3 && totalExpenses > 0) {
    const topCategory = expenseCategoryShares[0];
    if (topCategory) {
      const impact = roundCurrency(topCategory.amount * 0.05);
      addRecommendation({
        tone: "warn",
        priority: "MEDIUM",
        title: "Spend Review",
        message: `A focused 5% reduction in ${topCategory.category} can improve profit by about ${formatCurrencyAmount(
          impact
        )}.`,
        estimatedImpact: impact,
        actions: [
          "Set category-specific approval thresholds.",
          "Review weekly spend against forecast.",
          "Escalate unexpected variances early."
        ],
        primaryActionLabel: "View Details",
        secondaryActionLabel: "Take Action"
      });
    }
  }

  if (recommendations.length < 3 && lossMakingRigs.length === 0 && grossProfit >= 0) {
    addRecommendation({
      tone: "good",
      priority: "LOW",
      title: "Portfolio Health",
      message: "Current rig portfolio is profitable. Keep reallocating capacity toward high-margin work.",
      estimatedImpact: null,
      actions: [
        "Maintain weekly margin monitoring.",
        "Protect uptime on top-performing rigs.",
        "Scale profitable project allocation."
      ],
      primaryActionLabel: "View Details"
    });
  }

  if (recommendations.length < 3) {
    const fallbackItems: RecommendationItem[] = [
      {
        tone: "warn",
        priority: "MEDIUM",
        title: "Cost Discipline",
        message: "Reduce costs on low-performing rigs and monitor fuel, salary, and maintenance trends weekly.",
        estimatedImpact: null,
        actions: ["Define rig-level cost ceilings.", "Run weekly variance reviews.", "Escalate repeated overruns quickly."],
        primaryActionLabel: "Take Action",
        secondaryActionLabel: "View Details"
      },
      {
        tone: "good",
        priority: "LOW",
        title: "Utilization Strategy",
        message: "Increase usage of high-margin rigs on billable projects to improve overall profitability.",
        estimatedImpact: null,
        actions: [
          "Prioritize dispatching efficient rigs first.",
          "Reduce idle transition time between projects.",
          "Track utilization uplift weekly."
        ],
        primaryActionLabel: "Take Action",
        secondaryActionLabel: "View Details"
      },
      {
        tone: "warn",
        priority: "MEDIUM",
        title: "Operational Review",
        message: "Review rig-to-project assignment and move underperforming rigs to stronger contracts where possible.",
        estimatedImpact: null,
        actions: [
          "Compare project rates against rig cost profiles.",
          "Rebalance assignments each planning cycle.",
          "Validate improvement after reassignment."
        ],
        primaryActionLabel: "View Details",
        secondaryActionLabel: "Take Action"
      }
    ];

    for (const fallback of fallbackItems) {
      if (recommendations.length >= 3) {
        break;
      }
      addRecommendation(fallback);
    }
  }

  return recommendations.slice(0, 5);
}

export function calculateMargin(profit: number, revenue: number) {
  if (revenue === 0) {
    return 0;
  }
  return roundCurrency((profit / revenue) * 100);
}

export function calculatePercent(value: number, total: number) {
  if (total === 0) {
    return 0;
  }
  return roundCurrency((value / total) * 100);
}

export function formatPercent(value: number) {
  const rounded = roundCurrency(value);
  return Number.isInteger(rounded) ? `${rounded.toFixed(0)}%` : `${rounded.toFixed(1)}%`;
}

export function formatCurrencyAmount(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0
  }).format(value);
}

export function roundCurrency(value: number) {
  return Math.round(value * 100) / 100;
}

export function buildEmptyRecognizedSpendContext(): Awaited<ReturnType<typeof buildRecognizedSpendContext>> {
  return {
    rawExpenses: [],
    recognizedExpenses: [],
    recognitionStats: {
      inputCount: 0,
      candidateCount: 0,
      recognizedCount: 0,
      linkedPurchaseExpenseCount: 0,
      recognizedPurchaseExpenseCount: 0,
      excludedUnpostedPurchaseCount: 0,
      excludedNonApprovedCount: 0
    },
    movements: [],
    usageRequestRows: [],
    requisitionContexts: [],
    receiptContexts: [],
    maintenanceRequests: [],
    classifiedRows: [],
    purposeTotals: {
      recognizedSpendTotal: 0,
      breakdownCost: 0,
      maintenanceCost: 0,
      stockReplenishmentCost: 0,
      operatingCost: 0,
      otherUnlinkedCost: 0
    },
    categoryTotals: {},
    classificationAudit: {
      recognizedSpendTotal: 0,
      purposeTotals: {
        recognizedSpendTotal: 0,
        breakdownCost: 0,
        maintenanceCost: 0,
        stockReplenishmentCost: 0,
        operatingCost: 0,
        otherUnlinkedCost: 0
      },
      categoryTotals: {},
      purposeCounts: {
        BREAKDOWN_COST: 0,
        MAINTENANCE_COST: 0,
        STOCK_REPLENISHMENT: 0,
        OPERATING_COST: 0,
        OTHER_UNLINKED: 0
      },
      legacyUnlinkedCount: 0,
      reconciliationDelta: 0
    }
  };
}
