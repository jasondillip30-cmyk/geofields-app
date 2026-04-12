import { buildClassificationAuditSummary } from "@/lib/approved-spend-classification";
import { type BudgetClassifiedSpendRow, type BudgetVsActualRow, roundCurrency } from "@/lib/budget-vs-actual";
import { formatPercent } from "@/lib/utils";

export interface SpendComposition {
  totalRecognizedSpend: number;
  breakdownCost: number;
  maintenanceCost: number;
  operatingCost: number;
  stockReplenishmentCost: number;
  otherUnlinkedCost: number;
}

export interface ClassificationAudit {
  linkedExpenseCount: number;
  bucketTotals: {
    breakdown: number;
    maintenance: number;
    operating: number;
    stockReplenishment: number;
    otherUnlinked: number;
  };
  bucketCounts: {
    breakdown: number;
    maintenance: number;
    operating: number;
    stockReplenishment: number;
    otherUnlinked: number;
  };
  bucketSum: number;
  recognizedSpend: number;
  delta: number;
}

export type OperationalBudgetStatus = "Within Budget" | "Watch" | "Overspent" | "No Budget";

export const EMPTY_SPEND_COMPOSITION: SpendComposition = {
  totalRecognizedSpend: 0,
  breakdownCost: 0,
  maintenanceCost: 0,
  operatingCost: 0,
  stockReplenishmentCost: 0,
  otherUnlinkedCost: 0
};

type SpendBucket =
  | "BREAKDOWN_COST"
  | "MAINTENANCE_COST"
  | "OPERATING_COST"
  | "STOCK_REPLENISHMENT"
  | "OTHER_UNLINKED";

export function deriveProjectBudgetPeriod(
  project: { startDate: string; endDate: string | null } | null,
  fallback?: {
    periodStart?: string | null;
    periodEnd?: string | null;
  } | null
) {
  const periodStart =
    normalizeDateKey(project?.startDate) ||
    normalizeDateKey(fallback?.periodStart) ||
    toDateKey(new Date());
  const periodEnd =
    normalizeDateKey(project?.endDate) ||
    normalizeDateKey(fallback?.periodEnd) ||
    addOneYearToDateKey(periodStart);
  return { periodStart, periodEnd };
}

export function buildCompositionFromExpenses(
  expenses: Array<Pick<BudgetClassifiedSpendRow, "purposeBucket" | "amount">>
): SpendComposition {
  const composition = cloneSpendComposition(EMPTY_SPEND_COMPOSITION);
  for (const row of expenses) {
    applySpendToBucket(composition, row.purposeBucket, row.amount);
  }
  return roundSpendComposition(composition);
}

export function reconcileCompositionToRecognizedSpend(
  source: SpendComposition,
  recognizedSpend: number
): SpendComposition {
  const rounded = roundSpendComposition(source);
  if (recognizedSpend <= 0) {
    return cloneSpendComposition(EMPTY_SPEND_COMPOSITION);
  }

  const sum =
    rounded.breakdownCost +
    rounded.maintenanceCost +
    rounded.operatingCost +
    rounded.stockReplenishmentCost +
    rounded.otherUnlinkedCost;
  const delta = roundCurrency(recognizedSpend - sum);
  return {
    ...rounded,
    totalRecognizedSpend: roundCurrency(recognizedSpend),
    otherUnlinkedCost: roundCurrency(rounded.otherUnlinkedCost + delta)
  };
}

export function buildClassificationAudit({
  linkedExpenses,
  composition,
  recognizedSpend
}: {
  linkedExpenses: BudgetClassifiedSpendRow[];
  composition: SpendComposition;
  recognizedSpend: number;
}): ClassificationAudit {
  const sharedAudit = buildClassificationAuditSummary(linkedExpenses);
  const bucketCounts = {
    breakdown: sharedAudit.purposeCounts.BREAKDOWN_COST || 0,
    maintenance: sharedAudit.purposeCounts.MAINTENANCE_COST || 0,
    operating: sharedAudit.purposeCounts.OPERATING_COST || 0,
    stockReplenishment: sharedAudit.purposeCounts.STOCK_REPLENISHMENT || 0,
    otherUnlinked: sharedAudit.purposeCounts.OTHER_UNLINKED || 0
  };

  const bucketTotals = {
    breakdown: composition.breakdownCost,
    maintenance: composition.maintenanceCost,
    operating: composition.operatingCost,
    stockReplenishment: composition.stockReplenishmentCost,
    otherUnlinked: composition.otherUnlinkedCost
  };
  const bucketSum = roundCurrency(
    bucketTotals.breakdown +
      bucketTotals.maintenance +
      bucketTotals.operating +
      bucketTotals.stockReplenishment +
      bucketTotals.otherUnlinked
  );
  return {
    linkedExpenseCount: linkedExpenses.length,
    bucketTotals,
    bucketCounts,
    bucketSum,
    recognizedSpend: roundCurrency(recognizedSpend),
    delta: roundCurrency(recognizedSpend - bucketSum)
  };
}

export function deriveOperationalBudgetStatus(
  row: Pick<BudgetVsActualRow, "status" | "alertLevel" | "recognizedSpend" | "budgetAmount" | "percentUsed">
): OperationalBudgetStatus {
  if (row.budgetAmount <= 0 && row.recognizedSpend > 0) {
    return "No Budget";
  }
  if (row.status === "OVERSPENT" || (row.budgetAmount > 0 && row.recognizedSpend > row.budgetAmount)) {
    return "Overspent";
  }
  if (row.alertLevel === "WATCH_80" || row.alertLevel === "CRITICAL_90" || (row.percentUsed || 0) >= 80) {
    return "Watch";
  }
  return "Within Budget";
}

export function formatPercentUsed(value: number | null) {
  if (value === null) {
    return "No Budget";
  }
  if (value >= 1000) {
    return "999%+";
  }
  return formatPercent(value);
}

export function formatDate(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "—";
  }
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "2-digit",
    year: "numeric"
  }).format(parsed);
}

export async function readApiError(response: Response, fallback: string) {
  try {
    const payload = await response.json();
    if (typeof payload?.message === "string" && payload.message.trim()) {
      return payload.message;
    }
  } catch {}
  return fallback;
}

export function buildFiltersQuery(filters: {
  workspaceMode?: string;
  projectId: string;
  clientId: string;
  rigId: string;
  from: string;
  to: string;
}) {
  const params = new URLSearchParams();
  if (filters.workspaceMode && filters.workspaceMode !== "all-projects") {
    params.set("workspace", filters.workspaceMode);
  }
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  if (filters.projectId !== "all") {
    params.set("projectId", filters.projectId);
    return params;
  }
  if (filters.clientId !== "all") params.set("clientId", filters.clientId);
  if (filters.rigId !== "all") params.set("rigId", filters.rigId);
  return params;
}

export function toDateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function cloneSpendComposition(source: SpendComposition): SpendComposition {
  return {
    totalRecognizedSpend: source.totalRecognizedSpend,
    breakdownCost: source.breakdownCost,
    maintenanceCost: source.maintenanceCost,
    operatingCost: source.operatingCost,
    stockReplenishmentCost: source.stockReplenishmentCost,
    otherUnlinkedCost: source.otherUnlinkedCost
  };
}

function applySpendToBucket(target: SpendComposition, bucket: SpendBucket, amount: number) {
  target.totalRecognizedSpend += amount;
  if (bucket === "BREAKDOWN_COST") {
    target.breakdownCost += amount;
    return;
  }
  if (bucket === "MAINTENANCE_COST") {
    target.maintenanceCost += amount;
    return;
  }
  if (bucket === "OPERATING_COST") {
    target.operatingCost += amount;
    return;
  }
  if (bucket === "STOCK_REPLENISHMENT") {
    target.stockReplenishmentCost += amount;
    return;
  }
  target.otherUnlinkedCost += amount;
}

function roundSpendComposition(source: SpendComposition): SpendComposition {
  return {
    totalRecognizedSpend: roundCurrency(source.totalRecognizedSpend),
    breakdownCost: roundCurrency(source.breakdownCost),
    maintenanceCost: roundCurrency(source.maintenanceCost),
    operatingCost: roundCurrency(source.operatingCost),
    stockReplenishmentCost: roundCurrency(source.stockReplenishmentCost),
    otherUnlinkedCost: roundCurrency(source.otherUnlinkedCost)
  };
}

function normalizeDateKey(value: string | null | undefined) {
  if (!value) {
    return "";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }
  return toDateKey(parsed);
}

function addOneYearToDateKey(startDateKey: string) {
  const parsed = new Date(startDateKey);
  if (Number.isNaN(parsed.getTime())) {
    return startDateKey;
  }
  const nextYear = new Date(parsed);
  nextYear.setUTCFullYear(nextYear.getUTCFullYear() + 1);
  return toDateKey(nextYear);
}
