export interface InventoryItemRow {
  id: string;
  name: string;
  sku: string;
  category: string;
  description: string | null;
  quantityInStock: number;
  minimumStockLevel: number;
  unitCost: number;
  inventoryValue: number;
  supplierId: string | null;
  supplier: { id: string; name: string } | null;
  locationId: string | null;
  location: { id: string; name: string } | null;
  compatibleRigId: string | null;
  compatibleRig: { id: string; rigCode: string } | null;
  compatibleRigType: string | null;
  partNumber: string | null;
  status: "ACTIVE" | "INACTIVE";
  notes: string | null;
  lowStock: boolean;
  outOfStock: boolean;
  latestMovementDate: string | null;
  latestMovementType: string | null;
  approvedProjectContext?: {
    approvedQuantity: number;
    availableApprovedQuantity: number;
    availableApprovedValue: number;
    usedQuantity: number;
    usedValue: number;
  } | null;
  createdAt: string;
  updatedAt: string;
}

export interface InventorySupplier {
  id: string;
  name: string;
  contactPerson: string | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
  isActive: boolean;
  itemCount: number;
  movementCount: number;
  purchaseCount: number;
  totalPurchaseCost: number;
  latestPurchaseDate: string | null;
}

export interface InventoryLocation {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  itemCount: number;
}

export interface InventoryMovementRow {
  id: string;
  itemId: string;
  movementType: "IN" | "OUT" | "ADJUSTMENT" | "TRANSFER";
  quantity: number;
  unitCost: number | null;
  totalCost: number | null;
  date: string;
  notes: string | null;
  traReceiptNumber: string | null;
  supplierInvoiceNumber: string | null;
  receiptUrl: string | null;
  item: {
    id: string;
    name: string;
    sku: string;
    category?: string;
    quantityInStock?: number;
    minimumStockLevel?: number;
    unitCost?: number;
  } | null;
  rig: { id: string; rigCode: string } | null;
  project: { id: string; name: string } | null;
  drillReport?: { id: string; holeNumber: string; date: string } | null;
  client: { id: string; name: string } | null;
  maintenanceRequest: {
    id: string;
    requestCode: string;
    status: string;
    breakdownReportId?: string | null;
  } | null;
  breakdownReport?: {
    id: string;
    title: string;
    status: string;
    severity: string;
    reportDate?: string | null;
  } | null;
  expense: {
    id: string;
    amount: number;
    category: string;
    approvalStatus: string;
    entrySource?: string;
    approvedAt?: string | null;
    submittedAt?: string | null;
  } | null;
  supplier: { id: string; name: string } | null;
  locationFrom: { id: string; name: string } | null;
  locationTo: { id: string; name: string } | null;
  performedBy: { id: string; fullName: string; role: string } | null;
  linkedUsageRequest?: {
    id: string;
    status: string;
    reason: string;
    reasonType?: "MAINTENANCE" | "BREAKDOWN" | "DRILLING_REPORT" | "OTHER";
    drillReportId?: string | null;
    breakdownReportId?: string | null;
    maintenanceRequestId?: string | null;
    requestedForDate?: string | null;
    decidedAt?: string | null;
    createdAt?: string;
    requestedBy?: { id: string; fullName: string; role: string } | null;
    decidedBy?: { id: string; fullName: string; role: string } | null;
    maintenanceRequest?: {
      id: string;
      requestCode: string;
      status: string;
      breakdownReportId?: string | null;
    } | null;
    breakdownReport?: {
      id: string;
      title: string;
      status: string;
      severity: string;
    } | null;
    drillReport?: {
      id: string;
      holeNumber: string;
      date: string;
    } | null;
  } | null;
  linkedBreakdown?: {
    id: string;
    title: string;
    status: string;
    severity: string;
    reportDate?: string | null;
  } | null;
}

export interface InventoryOverviewResponse {
  projectLinked: {
    approvedItems: number;
    approvedQuantity: number;
    availableApprovedQuantity: number;
    availableApprovedValue: number;
    usedQuantity: number;
    usedValue: number;
    projectLinkedIn: number;
    projectLinkedOut: number;
    recognizedInventoryCost: number;
    requestContext: {
      total: number;
      submitted: number;
      pending: number;
      approved: number;
      rejected: number;
    };
  } | null;
  overview: {
    totalItems: number;
    totalUnitsInStock: number;
    totalInventoryValue: number;
    lowStockCount: number;
    outOfStockCount: number;
    recentlyUsedItems: Array<{ id: string; name: string; date: string; quantity: number }>;
    recentlyPurchasedItems: Array<{ id: string; name: string; date: string; quantity: number; supplier: string | null }>;
  };
  lowStockItems: Array<{ id: string; name: string; sku: string; quantityInStock: number; minimumStockLevel: number; category: string }>;
  outOfStockItems: Array<{ id: string; name: string; sku: string; minimumStockLevel: number; category: string }>;
  analytics: {
    topUsedItems: Array<{ id: string; name: string; quantity: number; totalCost: number }>;
    leastUsedItems: Array<{ id: string; name: string; quantity: number; totalCost: number }>;
    deadStockItems: Array<{ id: string; name: string; sku: string; inventoryValue: number; quantityInStock: number; lastUsedAt: string | null }>;
    highestCostCategories: Array<{ category: string; cost: number; percentOfTotal: number }>;
    monthlyConsumption: Array<{ month: string; quantity: number; cost: number }>;
    movementTrend: Array<{ date: string; inQty: number; outQty: number; adjustmentQty: number; transferQty: number }>;
    inventoryCostByRig: Array<{ id: string; name: string; totalCost: number; quantity: number }>;
    inventoryCostByProject: Array<{ id: string; name: string; totalCost: number; quantity: number }>;
    recommendations: string[];
  };
}

export interface InventoryItemDetailsResponse {
  data: InventoryItemRow;
  movements: InventoryMovementRow[];
  usageHistory: InventoryMovementRow[];
  purchaseHistory: InventoryMovementRow[];
  linkedMaintenance: Array<{
    movementId: string;
    requestId: string;
    requestCode: string;
    status: string;
    quantity: number;
    totalCost: number;
    date: string;
  }>;
  linkedExpenses: Array<{
    movementId: string;
    expenseId: string;
    amount: number;
    category: string;
    approvalStatus: string;
    receiptUrl: string | null;
    date: string;
  }>;
  stockMovementOverTime: Array<{ date: string; inQty: number; outQty: number; adjustmentQty: number; transferQty: number }>;
  monthlyConsumption: Array<{ month: string; quantity: number; cost: number }>;
}

export interface CategorySuggestionState {
  suggestedCategory: string | null;
  confidence: "HIGH" | "MEDIUM" | "LOW" | "NONE";
  confidenceLabel: string;
  reason: string;
  matchedKeywords: string[];
  similarItems: Array<{ id: string; name: string; category: string }>;
  alternatives: Array<{ category: string; label: string; score: number }>;
  mismatchWarning: string | null;
  existingCategoryNames: string[];
  similarCategoryNames: string[];
}

export interface InventoryIssueRow {
  id: string;
  type: "CATEGORY_CONFLICT" | "DUPLICATE_ITEM" | "NAMING_INCONSISTENCY" | "STOCK_ANOMALY" | "PRICE_ANOMALY";
  severity: "HIGH" | "MEDIUM" | "LOW";
  title: string;
  message: string;
  suggestion: string;
  itemIds: string[];
  suggestedCategory?: string;
  suggestedName?: string;
  confidence?: "HIGH" | "MEDIUM" | "LOW" | "NONE";
  autoFixSafe?: boolean;
  affectedCategory?: string;
}

export interface InventoryIssuesResponse {
  summary: {
    total: number;
    high: number;
    medium: number;
    low: number;
  };
  categorySummary: Array<{
    category: string;
    label: string;
    itemCount: number;
    totalValue: number;
  }>;
  issues: InventoryIssueRow[];
}

export interface ItemFormState {
  name: string;
  sku: string;
  category: string;
  customCategoryLabel: string;
  description: string;
  quantityInStock: string;
  minimumStockLevel: string;
  unitCost: string;
  supplierId: string;
  locationId: string;
  compatibleRigId: string;
  compatibleRigType: string;
  partNumber: string;
  status: "ACTIVE" | "INACTIVE";
  notes: string;
}

export interface MovementFormState {
  itemId: string;
  movementType: "IN" | "OUT" | "ADJUSTMENT" | "TRANSFER";
  quantity: string;
  unitCost: string;
  totalCost: string;
  date: string;
  clientId: string;
  projectId: string;
  rigId: string;
  maintenanceRequestId: string;
  supplierId: string;
  locationFromId: string;
  locationToId: string;
  traReceiptNumber: string;
  supplierInvoiceNumber: string;
  receiptUrl: string;
  notes: string;
  createExpense: boolean;
  allowNegativeStock: boolean;
  receiptFile: File | null;
}

export interface SupplierFormState {
  name: string;
  contactPerson: string;
  email: string;
  phone: string;
  notes: string;
}

export interface LocationFormState {
  name: string;
  description: string;
}

export interface UseRequestFormState {
  quantity: string;
  reasonType: "MAINTENANCE" | "BREAKDOWN" | "DRILLING_REPORT" | "";
  reasonDetails: string;
  maintenanceRigId: string;
  projectId: string;
  rigId: string;
  drillReportId: string;
  maintenanceRequestId: string;
  breakdownReportId: string;
  locationId: string;
}

export interface MaintenanceContextOption {
  id: string;
  requestCode: string;
  status: string;
  issueDescription: string;
  rig: { id: string; rigCode: string } | null;
  project: { id: string; name: string } | null;
}

export interface BreakdownContextOption {
  id: string;
  title: string;
  status: string;
  severity: string;
  reportDate: string;
  rig: { id: string; rigCode: string } | null;
  project: { id: string; name: string } | null;
}

export interface InventoryUsageRequestRow {
  id: string;
  quantity: number;
  reason: string;
  reasonType?: "MAINTENANCE" | "BREAKDOWN" | "DRILLING_REPORT" | "OTHER";
  drillReportId?: string | null;
  breakdownReportId?: string | null;
  status: "SUBMITTED" | "PENDING" | "APPROVED" | "REJECTED";
  decisionNote: string | null;
  requestedForDate: string | null;
  createdAt: string;
  decidedAt: string | null;
  approvedMovementId: string | null;
  item: { id: string; name: string; sku: string } | null;
  project: { id: string; name: string; clientId: string } | null;
  rig: { id: string; rigCode: string } | null;
  location: { id: string; name: string } | null;
  maintenanceRequest: { id: string; requestCode: string; status: string } | null;
  breakdownReport: {
    id: string;
    title: string;
    status: string;
    severity: string;
  } | null;
  drillReport: {
    id: string;
    holeNumber: string;
    date: string;
    project: { id: string; name: string } | null;
    rig: { id: string; rigCode: string } | null;
  } | null;
  requestedBy: { id: string; fullName: string; role: string } | null;
  decidedBy: { id: string; fullName: string; role: string } | null;
}

export type InventoryUsageBatchStatus =
  | "SUBMITTED"
  | "PENDING"
  | "APPROVED"
  | "REJECTED"
  | "PARTIALLY_APPROVED";

export type InventoryUsageBatchLineStatus = "SUBMITTED" | "APPROVED" | "REJECTED";

export interface InventoryUsageBatchLineRow {
  id: string;
  quantity: number;
  status: InventoryUsageBatchLineStatus;
  decisionNote: string | null;
  approvedMovementId: string | null;
  item: {
    id: string;
    name: string;
    sku: string;
    status: "ACTIVE" | "INACTIVE";
    unitCost: number;
    quantityInStock: number;
  } | null;
}

export interface InventoryUsageBatchRow {
  id: string;
  batchCode: string;
  contextType: "DRILLING_REPORT" | "MAINTENANCE" | "BREAKDOWN" | "OTHER";
  reasonType: "MAINTENANCE" | "BREAKDOWN" | "DRILLING_REPORT" | "OTHER";
  reason: string;
  status: InventoryUsageBatchStatus;
  requestedForDate: string | null;
  createdAt: string;
  decidedAt: string | null;
  projectId: string | null;
  rigId: string | null;
  maintenanceRequestId: string | null;
  breakdownReportId: string | null;
  locationId: string | null;
  project: { id: string; name: string; clientId: string } | null;
  rig: { id: string; rigCode: string } | null;
  location: { id: string; name: string } | null;
  maintenanceRequest: { id: string; requestCode: string; status: string } | null;
  breakdownReport: {
    id: string;
    title: string;
    status: string;
    severity: string;
  } | null;
  requestedBy: { id: string; fullName: string; role: string } | null;
  decidedBy: { id: string; fullName: string; role: string } | null;
  summary: {
    lineCount: number;
    approved: number;
    rejected: number;
    submitted: number;
    totalQuantity: number;
  };
  lines: InventoryUsageBatchLineRow[];
}

export interface UseRequestBatchFormState {
  reasonType: "MAINTENANCE" | "BREAKDOWN" | "DRILLING_REPORT" | "";
  reasonDetails: string;
  maintenanceRigId: string;
  projectId: string;
  rigId: string;
  maintenanceRequestId: string;
  breakdownReportId: string;
  locationId: string;
}

export const defaultOverview: InventoryOverviewResponse = {
  projectLinked: null,
  overview: {
    totalItems: 0,
    totalUnitsInStock: 0,
    totalInventoryValue: 0,
    lowStockCount: 0,
    outOfStockCount: 0,
    recentlyUsedItems: [],
    recentlyPurchasedItems: []
  },
  lowStockItems: [],
  outOfStockItems: [],
  analytics: {
    topUsedItems: [],
    leastUsedItems: [],
    deadStockItems: [],
    highestCostCategories: [],
    monthlyConsumption: [],
    movementTrend: [],
    inventoryCostByRig: [],
    inventoryCostByProject: [],
    recommendations: []
  }
};

export const defaultSuggestion: CategorySuggestionState = {
  suggestedCategory: null,
  confidence: "NONE",
  confidenceLabel: "No match",
  reason: "Enter item details to get a category suggestion.",
  matchedKeywords: [],
  similarItems: [],
  alternatives: [],
  mismatchWarning: null,
  existingCategoryNames: [],
  similarCategoryNames: []
};

export const defaultIssues: InventoryIssuesResponse = {
  summary: {
    total: 0,
    high: 0,
    medium: 0,
    low: 0
  },
  categorySummary: [],
  issues: []
};

export type InventorySection = "overview" | "items" | "stock-movements" | "issues" | "suppliers" | "locations";
export type IssueTriageFilter = "ALL" | "HIGH_PRIORITY" | "NEEDS_LINKING" | "COST_NOT_RECOGNIZED" | "LOW_PRIORITY";

export function resolveInventorySection(pathname: string | null, sectionQuery: string | null): InventorySection {
  if (pathname === "/inventory/items") return "items";
  if (pathname === "/inventory/stock-movements") return "stock-movements";
  if (pathname === "/inventory/issues") return "issues";
  if (pathname === "/inventory/suppliers") return "suppliers";
  if (pathname === "/inventory/locations") return "locations";

  const requestedSection = (sectionQuery || "overview").toLowerCase();
  if (
    requestedSection === "items" ||
    requestedSection === "stock-movements" ||
    requestedSection === "issues" ||
    requestedSection === "suppliers" ||
    requestedSection === "locations"
  ) {
    return requestedSection;
  }
  return "overview";
}
