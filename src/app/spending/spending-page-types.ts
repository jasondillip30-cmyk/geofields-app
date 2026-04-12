export interface SpendingCategoryRow {
  category: string;
  total: number;
  percentOfExpenses: number;
}

export interface SpendingHoleRow {
  holeNumber: string;
  total: number;
  percentOfRevenue: number;
  percentOfIncome?: number;
}

export interface SpendingTransactionRow {
  id: string;
  requisitionCode: string;
  date: string;
  merchant: string;
  category: string;
  amount: number;
  editable: boolean;
}

export interface SpendingTransactionsPayload {
  categories: string[];
  rows: SpendingTransactionRow[];
}

export interface SpendingRevenueRateRow {
  id: string;
  label: string;
  rangeLabel: string | null;
  rate: number;
  rateSuffix: string;
}

export interface SpendingRevenueRateCard {
  mode: "STAGED_PER_METER" | "PER_METER" | "DAY_RATE" | "LUMP_SUM" | "NOT_CONFIGURED";
  rows: SpendingRevenueRateRow[];
  message: string | null;
}

export interface SpendingSummaryPayload {
  meta?: {
    expenseBasis: "recognized" | "actual-use";
  };
  totals: {
    income: number;
    expenses: number;
    netCashFlow: number;
  };
  revenueTrend: Array<{
    bucketStart: string;
    label: string;
    revenue: number;
  }>;
  timePeriod: {
    monthly: Array<{
      bucketKey: string;
      label: string;
      income: number;
      expenses: number;
    }>;
    yearly: Array<{
      bucketKey: string;
      label: string;
      income: number;
      expenses: number;
    }>;
  };
  expenseByCategory: SpendingCategoryRow[];
  incomeByHole: SpendingHoleRow[];
  largestExpenses: Array<{
    id: string;
    label: string;
    dateLabel: string;
    amount: number;
  }>;
  mostFrequentUsage: Array<{
    itemId: string;
    itemName: string;
    usageCount: number;
  }>;
  revenueRateCard: SpendingRevenueRateCard;
}

export interface SpendingStageSegment {
  label: string;
  startM: number;
  endM: number;
  fillPercent: number;
}

export interface SpendingHoleStageRow {
  holeNumber: string;
  totalMeters: number;
  percentOfMeters: number;
  currentDepth: number;
  currentStageLabel: string | null;
  stageConfigured: boolean;
  stageSegments: SpendingStageSegment[];
}

export interface SpendingDrillingSummaryPayload {
  stageConfigured: boolean;
  summary: {
    totalMeters: number;
    totalReports: number;
    totalWorkHours: number;
    totalExpenses: number;
    totalCostPerMeter: number | null;
  };
  metersByHole: SpendingHoleStageRow[];
}

export interface SpendingApiErrorPayload {
  message?: string;
}

export interface SpendingTransactionPatchPayload {
  row?: SpendingTransactionRow;
}

export const emptySummary: SpendingSummaryPayload = {
  totals: {
    income: 0,
    expenses: 0,
    netCashFlow: 0
  },
  revenueTrend: [],
  timePeriod: {
    monthly: [],
    yearly: []
  },
  expenseByCategory: [],
  incomeByHole: [],
  largestExpenses: [],
  mostFrequentUsage: [],
  revenueRateCard: {
    mode: "NOT_CONFIGURED",
    rows: [],
    message: "Rates not configured for this project."
  }
};

export const emptyDrillingSummary: SpendingDrillingSummaryPayload = {
  stageConfigured: false,
  summary: {
    totalMeters: 0,
    totalReports: 0,
    totalWorkHours: 0,
    totalExpenses: 0,
    totalCostPerMeter: null
  },
  metersByHole: []
};

export const emptyTransactions: SpendingTransactionsPayload = {
  categories: [],
  rows: []
};
