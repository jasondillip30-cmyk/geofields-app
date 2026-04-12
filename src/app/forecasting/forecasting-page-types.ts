export interface Option {
  id: string;
  clientId?: string;
  name?: string;
}

export interface MonthlyRow {
  month: string;
  revenue: number;
  expenses: number;
  profit: number;
}

export interface SimulationBaseline {
  dailyRevenue: number;
  dailyExpense: number;
  forecast7Revenue: number;
  forecast7Expenses: number;
  forecast7Profit: number;
  forecast30Revenue: number;
  forecast30Expenses: number;
  forecast30Profit: number;
}

export interface ExpenseCategoryBaseline {
  category: string;
  totalAmount: number;
  sharePercent: number;
  dailyExpense: number;
  forecast7Expense: number;
  forecast30Expense: number;
}

export type AdjustmentMode = "percent" | "fixed";

export interface SimulationRow {
  id: string;
  categorySelection: string;
  customCategoryName: string;
  mode: AdjustmentMode;
  value: number;
}

export interface ScenarioRowDefinition {
  id?: string;
  categorySelection: string;
  customCategoryName: string;
  mode: AdjustmentMode;
  value: number;
}

export interface ScenarioDefinition {
  utilizationChangePct: number;
  rows: ScenarioRowDefinition[];
}

export interface SavedScenario {
  id: string;
  name: string;
  createdAt: string;
  definition: ScenarioDefinition;
}

export interface CategoryImpact {
  rowId: string;
  category: string;
  source: "existing" | "custom";
  mode: AdjustmentMode;
  value: number;
  baseDailyExpense: number;
  adjustedDailyExpense: number;
  dailyDelta: number;
  delta7: number;
  delta30: number;
  isValid: boolean;
  note?: string;
}

export interface BaselineTotals {
  dailyProfit: number;
  revenue7: number;
  expenses7: number;
  profit7: number;
  margin7: number;
  revenue30: number;
  expenses30: number;
  profit30: number;
  margin30: number;
}

export interface ScenarioMetrics {
  dailyRevenue: number;
  dailyExpense: number;
  dailyProfit: number;
  forecast7Revenue: number;
  forecast7Expenses: number;
  forecast7Profit: number;
  forecast30Revenue: number;
  forecast30Expenses: number;
  forecast30Profit: number;
  margin7: number;
  margin30: number;
  diff7: number;
  diff30: number;
  impacts: CategoryImpact[];
}

export interface ScenarioComparisonEntry {
  id: string;
  name: string;
  isBaseline: boolean;
  isLiveEditing?: boolean;
  metrics: ScenarioMetrics;
  riskScore: number;
}

export interface ScenarioRecommendation {
  entry: ScenarioComparisonEntry;
  headline: string;
  summary: string;
  reasons: string[];
  isClearWinner: boolean;
  isMixed: boolean;
  riskLevel: "Low" | "Medium" | "High";
  confidenceLevel: "High" | "Medium" | "Low";
  riskMessage: string;
  riskScore: number;
  driverExplanation: string;
}

export interface RiskAssessment {
  riskLevel: "Low" | "Medium" | "High";
  confidenceLevel: "High" | "Medium" | "Low";
  message: string;
  score: number;
}

export interface BreakEvenPlan {
  isProfitable: boolean;
  currentLoss: number;
  breakEvenGap: number;
  revenueIncreaseNeeded: number;
  costReductionNeeded: number;
  utilizationRevenuePerPercent: number;
  utilizationIncreaseNeeded: number | null;
  recommendedPath: "none" | "utilization" | "cost" | "revenue";
  recommendedAction: string;
}

export interface AutoAdjustSummary {
  status: "applied" | "near_optimal";
  previousUtilization: number;
  newUtilization: number;
  previousProfit30: number;
  newProfit30: number;
  profitChange30: number;
  driver: "Utilization";
  reason: string;
  details: string[];
}

export const CUSTOM_CATEGORY_OPTION = "__custom__";
export const MAX_SIMULATION_ROWS = 3;
export const MAX_COMPARE_SCENARIOS = 2;
export const SCENARIO_STORAGE_KEY = "geofields_forecasting_saved_scenarios_v1";
export const UTILIZATION_REALISTIC_THRESHOLD_PCT = 20;
export const COST_CUT_REALISTIC_THRESHOLD_PCT = 15;
export const AUTO_ADJUST_UTILIZATION_MIN = -100;
export const AUTO_ADJUST_UTILIZATION_MAX = 85;
export const AUTO_ADJUST_UTILIZATION_STEP = 1;
export const AUTO_ADJUST_PROFIT_TIE_EPSILON = 1;
export const AUTO_ADJUST_NEAR_OPTIMAL_DELTA_MIN = 250;
export const AUTO_ADJUST_NEAR_OPTIMAL_DELTA_RATIO = 0.005;
export const AUTO_ADJUST_MIN_IMPROVEMENT = 1;

export const emptyBaseline: SimulationBaseline = {
  dailyRevenue: 0,
  dailyExpense: 0,
  forecast7Revenue: 0,
  forecast7Expenses: 0,
  forecast7Profit: 0,
  forecast30Revenue: 0,
  forecast30Expenses: 0,
  forecast30Profit: 0
};
