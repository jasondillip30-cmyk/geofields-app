import type { BudgetVsActualSummaryResponse } from "@/lib/budget-vs-actual";
import type { CostTrackingSummaryPayload } from "@/lib/cost-tracking";

export interface ProfitSummaryPayload {
  totals: {
    totalRevenue: number;
    recognizedSpend: number;
    totalProfit: number;
  };
  kpis?: {
    highestProfitClient?: string;
    lowestProfitClient?: string;
  };
  trendGranularity: "day" | "month";
  profitTrend: Array<{
    bucketStart: string;
    label: string;
    revenue: number;
    expenses: number;
    profit: number;
  }>;
  profitByClient?: Array<{
    id: string;
    name: string;
    revenue: number;
    expenses: number;
    profit: number;
    margin: number;
  }>;
}

export interface RevenueSummaryPayload {
  totals: {
    totalRevenue: number;
    reportsLogged: number;
  };
  revenueByClient: Array<{ id: string; name: string; revenue: number }>;
  revenueByProject: Array<{ id: string; name: string; revenue: number }>;
  revenueByRig: Array<{ id: string; name: string; revenue: number }>;
}

export interface DrillingPendingRow {
  id: string;
  date?: string;
  submittedAt?: string | null;
  holeNumber?: string;
  project?: { id: string; name: string } | null;
  rig?: { id: string; rigCode: string } | null;
}

export interface MaintenancePendingRow {
  id: string;
  requestCode?: string;
  date?: string;
  requestDate?: string;
  createdAt?: string;
  issueType?: string;
  urgency?: string;
  rig?: { id: string; rigCode: string } | null;
}

export interface InventoryPendingRow {
  id: string;
  quantity: number;
  status: "SUBMITTED" | "PENDING";
  createdAt: string;
  requestedForDate: string | null;
  item?: { id: string; name: string; sku: string } | null;
  rig?: { id: string; rigCode: string } | null;
}

export interface ReceiptPendingRow {
  id: string;
  reportDate: string;
  submittedAt: string | null;
  status: "SUBMITTED" | "APPROVED" | "REJECTED";
  summary: {
    supplierName: string;
    receiptNumber: string;
    total: number;
  };
}

export type QueueKey = "drilling" | "maintenance" | "inventoryUsage" | "receiptSubmissions";

export interface QueueSummary {
  key: QueueKey;
  label: string;
  count: number;
  over24h: number;
  over3d: number;
  oldestPendingAt: string | null;
}

export interface PendingApprovalAttentionRow {
  id: string;
  queue: string;
  reference: string;
  pendingSince: string;
  ageHours: number;
  context: string;
}

export type ProfitabilityConcern = {
  id: string;
  scope: "Rig" | "Project";
  label: string;
  revenue: number;
  cost: number;
  gapAmount: number;
  href: string;
  sectionId: string;
  targetPageKey: "cost-tracking";
} | null;

export const emptyProfitSummary: ProfitSummaryPayload = {
  totals: {
    totalRevenue: 0,
    recognizedSpend: 0,
    totalProfit: 0
  },
  trendGranularity: "day",
  profitTrend: []
};

export const emptyRevenueSummary: RevenueSummaryPayload = {
  totals: {
    totalRevenue: 0,
    reportsLogged: 0
  },
  revenueByClient: [],
  revenueByProject: [],
  revenueByRig: []
};

export const emptyCostSummary: CostTrackingSummaryPayload = {
  filters: {
    clientId: "all",
    rigId: "all",
    from: null,
    to: null
  },
  overview: {
    totalRecognizedSpend: 0,
    totalMaintenanceRelatedCost: 0,
    totalInventoryRelatedCost: 0,
    totalNonInventoryExpenseCost: 0,
    highestCostRig: null,
    highestCostProject: null
  },
  trendGranularity: "week",
  costByRig: [],
  costByProject: [],
  costByMaintenanceRequest: [],
  spendingCategoryBreakdown: [],
  costTrend: []
};

export const emptyBudgetSummary: BudgetVsActualSummaryResponse = {
  filters: {
    clientId: "all",
    rigId: "all",
    from: null,
    to: null
  },
  totals: {
    totalBudget: 0,
    recognizedSpend: 0,
    remainingBudget: 0,
    overspentCount: 0
  },
  byRig: [],
  byProject: [],
  alerts: {
    overspentCount: 0,
    criticalCount: 0,
    watchCount: 0,
    noBudgetCount: 0,
    attentionCount: 0
  }
};
