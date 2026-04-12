export interface ReferenceClient {
  id: string;
  name: string;
}

export interface ReferenceProject {
  id: string;
  name: string;
  clientId: string;
}

export interface ReferenceRig {
  id: string;
  rigCode: string;
}

export interface ReferenceSupplier {
  id: string;
  name: string;
}

export interface ReferenceLocation {
  id: string;
  name: string;
}

export interface ReferenceItem {
  id: string;
  name: string;
  sku: string;
  category: string;
  minimumStockLevel: number;
}

export interface ReferenceMaintenanceRequest {
  id: string;
  requestCode: string;
}

export interface ReceiptMovementRow {
  id: string;
  date: string;
  quantity: number;
  totalCost: number | null;
  traReceiptNumber: string | null;
  supplierInvoiceNumber: string | null;
  receiptUrl: string | null;
  notes: string | null;
  item: { id: string; name: string; sku: string } | null;
  supplier: { id: string; name: string } | null;
  performedBy: { id: string; fullName: string } | null;
  project: { id: string; name: string } | null;
  client: { id: string; name: string } | null;
  rig: { id: string; rigCode: string } | null;
  expense: { id: string; amount: number } | null;
}

export interface ReceiptSubmissionSummary {
  id: string;
  reportDate: string;
  status: "SUBMITTED" | "APPROVED" | "REJECTED";
  submissionStatus: string;
  submittedAt: string;
  submittedBy: { userId: string; name: string; role: string };
  reviewer:
    | {
        userId: string;
        name: string;
        role: string;
        decision: string;
        decidedAt: string;
        note: string;
      }
    | null;
  summary: {
    supplierName: string;
    receiptNumber: string;
    verificationCode: string;
    serialNumber: string;
    receiptDate: string;
    total: number;
    traReceiptNumber: string;
  };
}

export interface ReceiptSubmissionDetail {
  id: string;
  status: "SUBMITTED" | "APPROVED" | "REJECTED";
  draft: {
    receiptType?:
      | "INVENTORY_PURCHASE"
      | "MAINTENANCE_LINKED_PURCHASE"
      | "EXPENSE_ONLY"
      | "INTERNAL_TRANSFER";
    expenseOnlyCategory?: "TRAVEL" | "FOOD" | "FUEL" | "MISC";
    receiptPurpose?:
      | "INVENTORY_PURCHASE"
      | "BUSINESS_EXPENSE_ONLY"
      | "INVENTORY_AND_EXPENSE"
      | "EVIDENCE_ONLY"
      | "OTHER_MANUAL";
    createExpense?: boolean;
    receipt?: {
      url?: string | null;
      fileName?: string | null;
      supplierId?: string | null;
      supplierName?: string | null;
      tin?: string | null;
      vrn?: string | null;
      serialNumber?: string | null;
      receiptNumber?: string | null;
      verificationCode?: string | null;
      verificationUrl?: string | null;
      rawQrValue?: string | null;
      receiptDate?: string | null;
      receiptTime?: string | null;
      traReceiptNumber?: string | null;
      invoiceReference?: string | null;
      paymentMethod?: string | null;
      taxOffice?: string | null;
      ocrTextPreview?: string | null;
      currency?: string | null;
      subtotal?: number | null;
      tax?: number | null;
      total?: number | null;
    };
    linkContext?: {
      clientId?: string | null;
      projectId?: string | null;
      rigId?: string | null;
      maintenanceRequestId?: string | null;
      locationFromId?: string | null;
      locationToId?: string | null;
    };
    lines?: Array<{
      id?: string;
      description?: string;
      quantity?: number;
      unitPrice?: number;
      lineTotal?: number;
      selectedItemId?: string | null;
      selectedCategory?: string | null;
      mode?: "MATCH" | "NEW" | "EXPENSE_ONLY";
      newItem?: {
        name?: string;
        sku?: string;
        category?: string;
        minimumStockLevel?: number;
        locationId?: string | null;
        status?: "ACTIVE" | "INACTIVE";
        notes?: string;
      } | null;
    }>;
  };
}

export interface RequisitionPrefill {
  id: string;
  requisitionCode: string;
  type: "LIVE_PROJECT_PURCHASE" | "INVENTORY_STOCK_UP" | "MAINTENANCE_PURCHASE";
  liveProjectSpendType: "BREAKDOWN" | "NORMAL_EXPENSE" | null;
  category: string | null;
  subcategory: string | null;
  requestedVendorName: string | null;
  clientId: string | null;
  projectId: string | null;
  rigId: string | null;
  maintenanceRequestId: string | null;
  lineItems: Array<{
    id: string;
    description: string;
    quantity: number;
    estimatedUnitCost: number;
    estimatedTotalCost: number;
    notes: string | null;
  }>;
  totals: {
    estimatedTotalCost: number;
    approvedTotalCost: number;
    actualPostedCost: number;
  };
}

export type ReceiptEntryMode = "REQUISITION" | "MANUAL" | "";
export type ReceiptInputMethod = "SCAN" | "MANUAL" | "";

export interface ApprovedRequisitionRow {
  id: string;
  requisitionCode: string;
  type: "LIVE_PROJECT_PURCHASE" | "INVENTORY_STOCK_UP" | "MAINTENANCE_PURCHASE";
  liveProjectSpendType: "BREAKDOWN" | "NORMAL_EXPENSE" | null;
  status: "SUBMITTED" | "APPROVED" | "REJECTED" | "PURCHASE_COMPLETED";
  category: string | null;
  subcategory: string | null;
  requestedVendorName: string | null;
  submittedAt: string;
  context: {
    clientId: string | null;
    projectId: string | null;
    rigId: string | null;
    maintenanceRequestId: string | null;
  };
  lineItems: Array<{
    id: string;
    description: string;
    quantity: number;
    estimatedUnitCost: number;
    estimatedTotalCost: number;
    notes: string | null;
  }>;
  totals: {
    estimatedTotalCost: number;
    approvedTotalCost: number;
    actualPostedCost: number;
  };
}
