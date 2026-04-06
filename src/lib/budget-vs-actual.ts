import type { BudgetScopeType, Prisma } from "@prisma/client";
import type { CostSpendCategoryKey } from "@/lib/cost-tracking";
import type { OperationalPurposeBucket } from "@/lib/approved-spend-classification";

export type BudgetConsumptionStatus = "ON_TRACK" | "OVERSPENT" | "NO_BUDGET";
export type BudgetAlertLevel = "NONE" | "WATCH_80" | "CRITICAL_90" | "OVERSPENT";
export type BudgetStatusLabel = "On Track" | "Watch" | "Critical" | "Overspent" | "No Budget";

export interface BudgetAlertSummary {
  overspentCount: number;
  criticalCount: number;
  watchCount: number;
  noBudgetCount: number;
  attentionCount: number;
}

export interface BudgetVsActualRow {
  id: string;
  name: string;
  budgetAmount: number;
  recognizedSpend: number;
  remainingBudget: number;
  percentUsed: number | null;
  status: BudgetConsumptionStatus;
  alertLevel: BudgetAlertLevel;
  statusLabel: BudgetStatusLabel;
}

export interface BudgetVsActualSummaryResponse {
  filters: {
    clientId: string;
    rigId: string;
    from: string | null;
    to: string | null;
  };
  totals: {
    totalBudget: number;
    recognizedSpend: number;
    remainingBudget: number;
    overspentCount: number;
  };
  byRig: BudgetVsActualRow[];
  byProject: BudgetVsActualRow[];
  alerts?: BudgetAlertSummary;
  classification?: {
    rows: BudgetClassifiedSpendRow[];
    purposeTotals: {
      recognizedSpendTotal: number;
      breakdownCost: number;
      maintenanceCost: number;
      stockReplenishmentCost: number;
      operatingCost: number;
      otherUnlinkedCost: number;
    };
    categoryTotals: Record<string, number>;
    audit: {
      recognizedSpendTotal: number;
      purposeTotals: {
        recognizedSpendTotal: number;
        breakdownCost: number;
        maintenanceCost: number;
        stockReplenishmentCost: number;
        operatingCost: number;
        otherUnlinkedCost: number;
      };
      categoryTotals: Record<string, number>;
      purposeCounts: Record<string, number>;
      legacyUnlinkedCount: number;
      reconciliationDelta: number;
    };
  };
}

export interface BudgetClassifiedSpendRow {
  expenseId: string;
  date: string;
  amount: number;
  purposeBucket: OperationalPurposeBucket;
  purposeLabel: string;
  accountingCategoryKey: CostSpendCategoryKey;
  accountingCategoryLabel: string;
  traceability: string;
  sourceType:
    | "EXPLICIT_BREAKDOWN"
    | "EXPLICIT_MAINTENANCE"
    | "STOCK_LINKAGE"
    | "PROJECT_LINKAGE"
    | "LEGACY_HINT"
    | "UNLINKED";
  linkedProjectId: string | null;
  linkedRigId: string | null;
  maintenanceRequestId: string | null;
  breakdownReportId: string | null;
  requisitionCode: string | null;
  movementSummary: string | null;
  legacyFlags: {
    legacyBreakdownMarker: boolean;
    maintenanceLikeWithoutLink: boolean;
    noProjectLink: boolean;
    noRigLink: boolean;
  };
}

export function nullableFilter(value: string | null) {
  return value && value !== "all" ? value : null;
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

export function parseBudgetScopeType(value: string | null | undefined): BudgetScopeType | null {
  if (value === "RIG" || value === "PROJECT") {
    return value;
  }
  return null;
}

export function parseNumeric(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return parsed;
}

export function roundCurrency(value: number) {
  return Math.round(value * 100) / 100;
}

export function calculatePercentUsed(spend: number, budget: number) {
  if (budget <= 0) {
    return null;
  }
  return roundCurrency((spend / budget) * 100);
}

export function resolveBudgetStatus(spend: number, budget: number): BudgetConsumptionStatus {
  if (budget <= 0) {
    return "NO_BUDGET";
  }
  if (spend >= budget) {
    return "OVERSPENT";
  }
  return "ON_TRACK";
}

export function deriveBudgetRowState(spend: number, budget: number) {
  const percentUsed = calculatePercentUsed(spend, budget);
  const status = resolveBudgetStatus(spend, budget);

  if (status === "NO_BUDGET") {
    return {
      status,
      percentUsed,
      alertLevel: "NONE" as const,
      statusLabel: "No Budget" as const
    };
  }

  if (status === "OVERSPENT") {
    return {
      status,
      percentUsed,
      alertLevel: "OVERSPENT" as const,
      statusLabel: "Overspent" as const
    };
  }

  if ((percentUsed || 0) >= 90) {
    return {
      status,
      percentUsed,
      alertLevel: "CRITICAL_90" as const,
      statusLabel: "Critical" as const
    };
  }

  if ((percentUsed || 0) >= 80) {
    return {
      status,
      percentUsed,
      alertLevel: "WATCH_80" as const,
      statusLabel: "Watch" as const
    };
  }

  return {
    status,
    percentUsed,
    alertLevel: "NONE" as const,
    statusLabel: "On Track" as const
  };
}

export function summarizeBudgetAlerts(rows: BudgetVsActualRow[]): BudgetAlertSummary {
  const overspentCount = rows.filter((entry) => entry.alertLevel === "OVERSPENT").length;
  const criticalCount = rows.filter((entry) => entry.alertLevel === "CRITICAL_90").length;
  const watchCount = rows.filter((entry) => entry.alertLevel === "WATCH_80").length;
  const noBudgetCount = rows.filter((entry) => entry.status === "NO_BUDGET").length;

  return {
    overspentCount,
    criticalCount,
    watchCount,
    noBudgetCount,
    attentionCount: overspentCount + criticalCount
  };
}

export function buildBudgetDateOverlapWhere({
  fromDate,
  toDate
}: {
  fromDate: Date | null;
  toDate: Date | null;
}): Prisma.BudgetPlanWhereInput {
  if (!fromDate && !toDate) {
    return {};
  }

  const from = fromDate || new Date("1970-01-01T00:00:00.000Z");
  const to = toDate || new Date("9999-12-31T23:59:59.999Z");
  return {
    periodStart: { lte: to },
    periodEnd: { gte: from }
  };
}

export function normalizePlanName(value: string | null | undefined) {
  return (value || "").trim();
}
