export interface FinancialPoint {
  bucketStart: string;
  label: string;
  revenue: number;
  expenses: number;
  profit: number;
}

export interface RecommendationItem {
  tone: "danger" | "warn" | "good";
  priority: "HIGH" | "MEDIUM" | "LOW";
  title: string;
  message: string;
  estimatedImpact: number | null;
  actions: string[];
  primaryActionLabel: "Take Action" | "View Details";
  secondaryActionLabel?: "Take Action" | "View Details";
}

export interface DashboardSummary {
  snapshot: {
    totalClients: number;
    totalProjects: number;
    totalRigs: number;
    activeRigs: number;
    idleRigs: number;
    maintenanceRigs: number;
    totalRevenue: number;
    totalExpenses: number;
    grossProfit: number;
    totalMeters: number;
    bestPerformingClient: string;
    bestPerformingClientId?: string | null;
    bestPerformingRig: string;
    bestPerformingRigId?: string | null;
    topRevenueRig: string;
    topRevenueRigId?: string | null;
    topForecastRig: string;
    topForecastRigId?: string | null;
    pendingApprovals: number;
    rejectedThisWeek: number;
    approvedToday: number;
  };
  trendGranularity: "day" | "month";
  financialTrend: FinancialPoint[];
  revenueByClient: Array<{ id?: string; name: string; revenue: number }>;
  revenueByRig: Array<{ id?: string; name: string; revenue: number }>;
  metersTrend: Array<{ bucketStart: string; label: string; meters: number }>;
  rigStatusData: Array<{ status: string; value: number }>;
  expenseBreakdown: Array<{ category: string; amount: number }>;
  projectAssignments: Array<{
    id: string;
    name: string;
    location: string;
    status: string;
    assignedRigCode: string;
    contractRatePerM: number;
    contractRateLabel?: string;
  }>;
  recommendations: RecommendationItem[];
  profitForecast: {
    daysInScope: number;
    avgDailyProfit: number;
    forecastNext7Profit: number;
    forecastNext30Profit: number;
    projectedTotalProfit30: number;
    topForecastRig: string;
    actualVsForecastProfit: Array<{
      bucketStart: string;
      label: string;
      actualProfit: number | null;
      forecastProfit: number | null;
    }>;
    forecastByRig: Array<{
      id: string;
      name: string;
      currentProfit: number;
      avgDailyProfit: number;
      forecastNext30Profit: number;
    }>;
  };
}

export const emptySummary: DashboardSummary = {
  snapshot: {
    totalClients: 0,
    totalProjects: 0,
    totalRigs: 0,
    activeRigs: 0,
    idleRigs: 0,
    maintenanceRigs: 0,
    totalRevenue: 0,
    totalExpenses: 0,
    grossProfit: 0,
    totalMeters: 0,
    bestPerformingClient: "N/A",
    bestPerformingClientId: null,
    bestPerformingRig: "N/A",
    bestPerformingRigId: null,
    topRevenueRig: "N/A",
    topRevenueRigId: null,
    topForecastRig: "N/A",
    topForecastRigId: null,
    pendingApprovals: 0,
    rejectedThisWeek: 0,
    approvedToday: 0
  },
  trendGranularity: "day",
  financialTrend: [],
  revenueByClient: [],
  revenueByRig: [],
  metersTrend: [],
  rigStatusData: [],
  expenseBreakdown: [],
  projectAssignments: [],
  recommendations: [],
  profitForecast: {
    daysInScope: 1,
    avgDailyProfit: 0,
    forecastNext7Profit: 0,
    forecastNext30Profit: 0,
    projectedTotalProfit30: 0,
    topForecastRig: "N/A",
    actualVsForecastProfit: [],
    forecastByRig: []
  }
};
