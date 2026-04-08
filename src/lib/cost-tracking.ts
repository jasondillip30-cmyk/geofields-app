import type { ReceiptSpendTag } from "@/lib/receipt-approval-classification";

export type CostSpendType = "MAINTENANCE" | "INVENTORY" | "NON_INVENTORY";
export type CostSpendCategoryKey =
  | "maintenance"
  | "stockWarehouse"
  | "fuel"
  | "travel"
  | "foodMeetings"
  | "miscellaneous";
export type CostTrendGranularity = "week" | "month";

export interface CostTrackingFilters {
  projectId?: string | null;
  clientId: string | null;
  rigId: string | null;
  from: string | null;
  to: string | null;
}

export interface CostOverviewSummary {
  totalRecognizedSpend: number;
  totalMaintenanceRelatedCost: number;
  totalInventoryRelatedCost: number;
  totalNonInventoryExpenseCost: number;
  highestCostRig: {
    id: string;
    name: string;
    totalRecognizedCost: number;
  } | null;
  highestCostProject: {
    id: string;
    name: string;
    totalRecognizedCost: number;
  } | null;
}

export interface CostByRigRow {
  id: string;
  name: string;
  totalRecognizedCost: number;
  maintenanceCost: number;
  inventoryPartsCost: number;
  otherExpenseCost: number;
  percentOfTotalSpend: number;
}

export interface CostByProjectRow {
  id: string;
  name: string;
  totalRecognizedCost: number;
  maintenanceLinkedCost: number;
  inventoryPurchaseCost: number;
  expenseOnlyCost: number;
  percentOfTotalSpend: number;
}

export interface CostByMaintenanceRequestRow {
  id: string;
  reference: string;
  rigName: string;
  totalLinkedCost: number;
  linkedPurchaseCount: number;
  urgency: string | null;
  status: string | null;
}

export interface SpendingCategoryBreakdownRow {
  key: CostSpendCategoryKey;
  label: string;
  totalCost: number;
  percentOfTotalSpend: number;
}

export interface CostTrendRow {
  bucketStart: string;
  label: string;
  totalRecognizedCost: number;
  maintenanceCost: number;
  inventoryCost: number;
  nonInventoryCost: number;
}

export interface CostTrackingSummaryPayload {
  filters: CostTrackingFilters;
  overview: CostOverviewSummary;
  trendGranularity: CostTrendGranularity;
  costByRig: CostByRigRow[];
  costByProject: CostByProjectRow[];
  costByMaintenanceRequest: CostByMaintenanceRequestRow[];
  spendingCategoryBreakdown: SpendingCategoryBreakdownRow[];
  costTrend: CostTrendRow[];
  classificationAudit?: {
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
}

export const COST_SPENDING_CATEGORY_LABELS: Record<CostSpendCategoryKey, string> = {
  maintenance: "Maintenance",
  stockWarehouse: "Stock / Warehouse",
  fuel: "Fuel",
  travel: "Travel",
  foodMeetings: "Food / Meetings",
  miscellaneous: "Miscellaneous"
};

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

export function roundCurrency(value: number) {
  return Math.round(value * 100) / 100;
}

export function calculatePercent(part: number, total: number) {
  if (total <= 0) {
    return 0;
  }
  return roundCurrency((part / total) * 100);
}

export function deriveCostSpendType({
  receiptTag,
  hasInventoryMovement,
  hasMaintenanceLink,
  entrySource,
  category,
  subcategory,
  notes
}: {
  receiptTag: ReceiptSpendTag | null;
  hasInventoryMovement: boolean;
  hasMaintenanceLink: boolean;
  entrySource: string | null;
  category: string | null;
  subcategory: string | null;
  notes: string | null;
}): CostSpendType {
  if (receiptTag === "MAINTENANCE") {
    return "MAINTENANCE";
  }
  if (receiptTag === "STOCK") {
    return "INVENTORY";
  }
  if (receiptTag === "EXPENSE") {
    return "NON_INVENTORY";
  }
  if (hasMaintenanceLink) {
    return "MAINTENANCE";
  }
  if (hasInventoryMovement || normalizeText(entrySource) === "inventory") {
    return "INVENTORY";
  }

  const searchable = buildSearchableText(category, subcategory, notes);
  if (hasAny(searchable, MAINTENANCE_TOKENS)) {
    return "MAINTENANCE";
  }
  if (hasAny(searchable, STOCK_TOKENS)) {
    return "INVENTORY";
  }
  return "NON_INVENTORY";
}

export function deriveSpendingCategory({
  spendType,
  category,
  subcategory,
  notes
}: {
  spendType: CostSpendType;
  category: string | null;
  subcategory: string | null;
  notes: string | null;
}): CostSpendCategoryKey {
  if (spendType === "MAINTENANCE") {
    return "maintenance";
  }
  if (spendType === "INVENTORY") {
    return "stockWarehouse";
  }

  const searchable = buildSearchableText(category, subcategory, notes);
  if (hasAny(searchable, FUEL_TOKENS)) {
    return "fuel";
  }
  if (hasAny(searchable, TRAVEL_TOKENS)) {
    return "travel";
  }
  if (hasAny(searchable, FOOD_MEETING_TOKENS)) {
    return "foodMeetings";
  }
  return "miscellaneous";
}

export function resolveTrendGranularity({
  fromDate,
  toDate,
  dates
}: {
  fromDate: Date | null;
  toDate: Date | null;
  dates: Date[];
}): CostTrendGranularity {
  if (fromDate && toDate) {
    return inclusiveRangeDays(fromDate, toDate) <= 120 ? "week" : "month";
  }

  if (dates.length === 0) {
    return "week";
  }

  let minDate = dates[0];
  let maxDate = dates[0];
  for (const date of dates) {
    if (date.getTime() < minDate.getTime()) {
      minDate = date;
    }
    if (date.getTime() > maxDate.getTime()) {
      maxDate = date;
    }
  }
  return inclusiveRangeDays(minDate, maxDate) <= 120 ? "week" : "month";
}

export function buildTrendBucketKey(date: Date, granularity: CostTrendGranularity) {
  if (granularity === "month") {
    return date.toISOString().slice(0, 7);
  }
  return startOfUtcWeek(date).toISOString().slice(0, 10);
}

export function formatTrendBucketLabel(bucketStart: string, granularity: CostTrendGranularity) {
  if (granularity === "month") {
    const monthDate = new Date(`${bucketStart}-01T00:00:00.000Z`);
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      year: "2-digit",
      timeZone: "UTC"
    }).format(monthDate);
  }

  const weekStart = new Date(`${bucketStart}T00:00:00.000Z`);
  const weekEnd = new Date(weekStart);
  weekEnd.setUTCDate(weekEnd.getUTCDate() + 6);
  const startLabel = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "2-digit",
    timeZone: "UTC"
  }).format(weekStart);
  const endLabel = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "2-digit",
    timeZone: "UTC"
  }).format(weekEnd);
  return `${startLabel} - ${endLabel}`;
}

function normalizeText(value: string | null | undefined) {
  return (value || "").trim().toLowerCase();
}

function buildSearchableText(
  category: string | null | undefined,
  subcategory: string | null | undefined,
  notes: string | null | undefined
) {
  return `${normalizeText(category)} ${normalizeText(subcategory)} ${normalizeText(notes)}`.trim();
}

function hasAny(text: string, tokens: string[]) {
  return tokens.some((token) => text.includes(token));
}

function startOfUtcWeek(date: Date) {
  const next = new Date(date);
  next.setUTCHours(0, 0, 0, 0);
  const day = next.getUTCDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  next.setUTCDate(next.getUTCDate() + mondayOffset);
  return next;
}

function inclusiveRangeDays(start: Date, end: Date) {
  const utcStart = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate());
  const utcEnd = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate());
  return Math.max(1, Math.floor((utcEnd - utcStart) / 86400000) + 1);
}

const MAINTENANCE_TOKENS = [
  "maint",
  "repair",
  "service",
  "workshop",
  "breakdown",
  "spare part",
  "spare parts",
  "hydraulic",
  "electrical",
  "mechanic"
];
const STOCK_TOKENS = [
  "stock",
  "warehouse",
  "inventory",
  "transfer",
  "consumable",
  "filter",
  "oil",
  "drill bit",
  "parts"
];
const FUEL_TOKENS = ["fuel", "diesel", "petrol", "gasoline", "lubricant"];
const TRAVEL_TOKENS = ["travel", "transport", "accommodation", "hotel", "lodging"];
const FOOD_MEETING_TOKENS = ["food", "meal", "camp food", "meeting", "refreshment"];
