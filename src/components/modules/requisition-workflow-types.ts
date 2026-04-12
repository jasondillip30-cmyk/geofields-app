import type { AnalyticsFilters } from "@/components/layout/analytics-filters-provider";

export type RequisitionType =
  | "LIVE_PROJECT_PURCHASE"
  | "INVENTORY_STOCK_UP"
  | "MAINTENANCE_PURCHASE";
export type LiveProjectSpendType = "BREAKDOWN" | "NORMAL_EXPENSE";

export type RequisitionStatus =
  | "SUBMITTED"
  | "APPROVED"
  | "REJECTED"
  | "PURCHASE_COMPLETED";

export type RequisitionWizardStep = 1 | 2 | 3 | 4;
export type MaintenancePriority = "LOW" | "MEDIUM" | "HIGH";
export type InventoryReason = "LOW_STOCK" | "RESTOCK" | "EMERGENCY" | "OTHER";

export interface RequisitionLineItem {
  id: string;
  description: string;
  quantity: number;
  estimatedUnitCost: number;
  estimatedTotalCost: number;
  notes: string | null;
}

export interface RequisitionRow {
  id: string;
  requisitionCode: string;
  type: RequisitionType;
  status: RequisitionStatus;
  liveProjectSpendType: LiveProjectSpendType | null;
  category: string;
  subcategory: string | null;
  categoryId: string | null;
  subcategoryId: string | null;
  requestedVendorId: string | null;
  requestedVendorName: string | null;
  notes: string | null;
  submittedAt: string;
  submittedBy: {
    userId: string;
    name: string;
    role: string;
  };
  context: {
    clientId: string | null;
    projectId: string | null;
    rigId: string | null;
    maintenanceRequestId: string | null;
    breakdownReportId: string | null;
  };
  lineItems: RequisitionLineItem[];
  totals: {
    estimatedTotalCost: number;
    approvedTotalCost: number;
    actualPostedCost: number;
  };
  approval: {
    approvedAt: string | null;
    approvedBy: {
      userId: string;
      name: string;
      role: string;
    } | null;
    rejectedAt: string | null;
    rejectedBy: {
      userId: string;
      name: string;
      role: string;
    } | null;
    rejectionReason: string | null;
    lineItemMode: "FULL_ONLY";
  };
  purchase: {
    receiptSubmissionId: string | null;
    receiptNumber: string | null;
    supplierName: string | null;
    expenseId: string | null;
    movementCount: number;
    postedAt: string | null;
  };
}

export interface InventoryLocationOption {
  id: string;
  name: string;
  isActive: boolean;
}

export interface InventoryItemSuggestion {
  id: string;
  name: string;
  sku: string;
  category: string;
}

export interface VendorSuggestion {
  id: string;
  name: string;
  additionalInfo: string | null;
}

export interface RequisitionCategoryOption {
  id: string;
  name: string;
}

export interface RequisitionSubcategoryOption {
  id: string;
  name: string;
  categoryId: string;
}

export interface BreakdownLinkOption {
  id: string;
  title: string;
  severity: string;
  reportDate: string;
}

export interface MaintenanceLinkOption {
  id: string;
  requestCode: string;
  issueDescription: string;
  status: string;
}

export interface RequisitionInitialContext {
  projectId?: string;
  breakdownId?: string;
  maintenanceRequestId?: string;
}

export interface RequisitionWorkflowCardProps {
  filters: AnalyticsFilters;
  clients: Array<{ id: string; name: string }>;
  projects: Array<{ id: string; name: string; clientId: string; assignedRigId?: string | null }>;
  rigs: Array<{ id: string; name: string }>;
  initialContext?: RequisitionInitialContext;
  onWorkflowChanged?: () => Promise<void> | void;
}

export interface RequisitionFormState {
  type: RequisitionType | "";
  liveProjectSpendType: LiveProjectSpendType | "";
  clientId: string;
  projectId: string;
  rigId: string;
  maintenanceRequestId: string;
  breakdownReportId: string;
  stockLocationId: string;
  maintenancePriority: MaintenancePriority | "";
  inventoryReason: InventoryReason | "";
  categoryId: string;
  category: string;
  subcategoryId: string;
  subcategory: string;
  requestedVendorId: string;
  requestedVendorName: string;
  shortReason: string;
  itemName: string;
  quantity: string;
  unit: string;
  estimatedUnitCost: string;
  itemNote: string;
}

export function createInitialFormState(initialContext?: RequisitionInitialContext): RequisitionFormState {
  const prefilledProjectId = initialContext?.projectId?.trim() || "";
  const prefilledBreakdownId = initialContext?.breakdownId?.trim() || "";
  const prefilledMaintenanceRequestId =
    initialContext?.maintenanceRequestId?.trim() || "";
  const prefilledMaintenancePurchase = prefilledMaintenanceRequestId.length > 0;
  const prefilledBreakdownPurchase =
    !prefilledMaintenancePurchase && prefilledBreakdownId.length > 0;
  const prefilledProjectPurchase =
    !prefilledMaintenancePurchase &&
    !prefilledBreakdownPurchase &&
    prefilledProjectId.length > 0;
  return {
    type: (
      prefilledMaintenancePurchase
        ? "MAINTENANCE_PURCHASE"
        : prefilledBreakdownPurchase || prefilledProjectPurchase
          ? "LIVE_PROJECT_PURCHASE"
          : ""
    ) as RequisitionType | "",
    liveProjectSpendType: "" as LiveProjectSpendType | "",
    clientId: "",
    projectId: prefilledProjectId,
    rigId: "",
    maintenanceRequestId: prefilledMaintenanceRequestId,
    breakdownReportId: prefilledBreakdownId,
    stockLocationId: "",
    maintenancePriority: "" as MaintenancePriority | "",
    inventoryReason: "" as InventoryReason | "",
    categoryId: "",
    category: "",
    subcategoryId: "",
    subcategory: "",
    requestedVendorId: "",
    requestedVendorName: "",
    shortReason: "",
    itemName: "",
    quantity: "1",
    unit: "PCS",
    estimatedUnitCost: "",
    itemNote: ""
  };
}
