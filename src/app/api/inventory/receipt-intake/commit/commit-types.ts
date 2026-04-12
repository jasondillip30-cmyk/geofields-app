import type { InventoryCategory } from "@prisma/client";

export interface IntakeLinePayload {
  id?: string;
  description?: string;
  quantity?: number | string;
  unitPrice?: number | string;
  lineTotal?: number | string;
  selectedItemId?: string | null;
  selectedCategory?: string | null;
  mode?: "MATCH" | "NEW" | "EXPENSE_ONLY";
  newItem?: {
    name?: string;
    sku?: string;
    category?: string;
    minimumStockLevel?: number | string;
    locationId?: string | null;
    status?: "ACTIVE" | "INACTIVE";
    notes?: string;
  };
}

export interface IntakeCommitPayload {
  requisitionId?: string | null;
  submissionId?: string | null;
  receipt?: {
    url?: string;
    fileName?: string;
    supplierId?: string | null;
    supplierName?: string;
    tin?: string;
    vrn?: string;
    serialNumber?: string;
    receiptNumber?: string;
    verificationCode?: string;
    verificationUrl?: string;
    rawQrValue?: string;
    receiptDate?: string;
    receiptTime?: string;
    traReceiptNumber?: string;
    invoiceReference?: string;
    paymentMethod?: string;
    taxOffice?: string;
    ocrTextPreview?: string;
    currency?: string;
    subtotal?: number | string;
    tax?: number | string;
    total?: number | string;
  };
  linkContext?: {
    clientId?: string | null;
    projectId?: string | null;
    rigId?: string | null;
    maintenanceRequestId?: string | null;
    breakdownReportId?: string | null;
    locationFromId?: string | null;
    locationToId?: string | null;
  };
  createExpense?: boolean;
  allowDuplicateSave?: boolean;
  workflowType?:
    | "PROJECT_PURCHASE"
    | "MAINTENANCE_PURCHASE"
    | "STOCK_PURCHASE"
    | "INTERNAL_TRANSFER";
  receiptType?:
    | "INVENTORY_PURCHASE"
    | "MAINTENANCE_LINKED_PURCHASE"
    | "EXPENSE_ONLY"
    | "INTERNAL_TRANSFER";
  expenseOnlyCategory?: "TRAVEL" | "FOOD" | "FUEL" | "MISC";
  receiptPurpose?: "INVENTORY_PURCHASE" | "BUSINESS_EXPENSE_ONLY" | "INVENTORY_AND_EXPENSE" | "EVIDENCE_ONLY" | "OTHER_MANUAL";
  lines?: IntakeLinePayload[];
}

export interface NormalizedIntakeLine {
  lineId: string;
  description: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  selectedItemId: string | null;
  selectedCategory: string | null;
  newItem: NonNullable<IntakeLinePayload["newItem"]> | null;
  mode: "MATCH" | "NEW" | "EXPENSE_ONLY";
}

export interface SkippedIntakeLine {
  lineId: string;
  description: string;
  reason: string;
}

export type IntakeAllocationStatus = "ALLOCATED" | "PARTIALLY_ALLOCATED" | "UNALLOCATED";

export interface ReceiptDuplicateFingerprint {
  supplierName: string;
  tin: string;
  vrn: string;
  receiptNumber: string;
  serialNumber: string;
  receiptDate: string;
  total: number;
  verificationCode: string;
  traReceiptNumber: string;
  receiptUrl: string;
}

export interface ReceiptDuplicateMatch {
  source: "inventory_movement" | "expense";
  id: string;
  matchedFields: string[];
  reason: string;
  viewUrl: string;
  createdAt: Date;
  supplierName: string;
  receiptNumber: string;
  verificationCode: string;
  serialNumber: string;
  receiptDate: string;
  total: number;
  traReceiptNumber: string;
  stockMovementId: string | null;
  expenseId: string | null;
  itemId: string | null;
  itemName: string | null;
  receiptPurpose: string;
}

export interface DuplicateLinkedRecord {
  id: string;
  label: string;
  type: "RECEIPT_INTAKE" | "INVENTORY_ITEM" | "STOCK_MOVEMENT" | "EXPENSE";
  url: string;
}

export interface DuplicateReviewPayload {
  summary: {
    supplierName: string;
    receiptNumber: string;
    verificationCode: string;
    serialNumber: string;
    receiptDate: string;
    total: number;
    traReceiptNumber: string;
    processedAt: string;
    duplicateConfidence: "HIGH" | "MEDIUM" | "LOW";
    matchReason: string;
    matchedFields: string[];
    receiptPurpose: string;
  };
  primaryRecord: DuplicateLinkedRecord | null;
  linkedRecords: {
    receiptIntake: DuplicateLinkedRecord[];
    inventoryItems: DuplicateLinkedRecord[];
    stockMovements: DuplicateLinkedRecord[];
    expenses: DuplicateLinkedRecord[];
  };
}

export type ReceiptPurpose =
  | "INVENTORY_PURCHASE"
  | "BUSINESS_EXPENSE_ONLY"
  | "INVENTORY_AND_EXPENSE"
  | "EVIDENCE_ONLY"
  | "OTHER_MANUAL";
export type ReceiptType =
  | "INVENTORY_PURCHASE"
  | "MAINTENANCE_LINKED_PURCHASE"
  | "EXPENSE_ONLY"
  | "INTERNAL_TRANSFER";
export type ReceiptWorkflowType =
  | "PROJECT_PURCHASE"
  | "MAINTENANCE_PURCHASE"
  | "STOCK_PURCHASE"
  | "INTERNAL_TRANSFER";

export const RECEIPT_SUBMISSION_REPORT_TYPE = "INVENTORY_RECEIPT_SUBMISSION";

export interface ResolveIntakeItemExistingRow {
  id: string;
  name: string;
  sku: string;
  category: InventoryCategory;
  quantityInStock: number;
  minimumStockLevel: number;
  unitCost: number;
  status: "ACTIVE" | "INACTIVE";
}
