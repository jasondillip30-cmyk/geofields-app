import type {
  ReceiptApprovalClassification,
  ReceiptPurpose,
  ReceiptType
} from "@/lib/receipt-approval-classification";

export type ApprovalTab = "requisitions" | "drilling" | "inventory";

export interface DrillingApprovalRow {
  id: string;
  date: string;
  submittedAt?: string | null;
  holeNumber: string;
  totalMetersDrilled: number;
  workHours: number;
  approvalStatus: "SUBMITTED";
  project: { id: string; name: string };
  client: { id: string; name: string };
  rig: { id: string; rigCode: string };
  submittedBy: { id: string; fullName: string } | null;
}

export interface InventoryUsageApprovalRow {
  id: string;
  quantity: number;
  reason: string;
  status: "SUBMITTED" | "PENDING";
  createdAt: string;
  requestedForDate: string | null;
  item: { id: string; name: string; sku: string };
  project: { id: string; name: string; clientId: string } | null;
  rig: { id: string; rigCode: string } | null;
  maintenanceRequest: { id: string; requestCode: string; status: string } | null;
  location: { id: string; name: string } | null;
  requestedBy: { id: string; fullName: string; role: string } | null;
}

export interface InventoryUsageBatchApprovalLineRow {
  id: string;
  quantity: number;
  status: "SUBMITTED" | "APPROVED" | "REJECTED";
  decisionNote: string | null;
  approvedMovementId: string | null;
  item: {
    id: string;
    name: string;
    sku: string;
    status: "ACTIVE" | "INACTIVE";
    quantityInStock: number;
    unitCost: number;
  } | null;
}

export interface InventoryUsageBatchApprovalRow {
  id: string;
  batchCode: string;
  contextType: "DRILLING_REPORT" | "MAINTENANCE" | "BREAKDOWN" | "OTHER";
  reasonType: "DRILLING_REPORT" | "MAINTENANCE" | "BREAKDOWN" | "OTHER";
  reason: string;
  status: "SUBMITTED" | "PENDING" | "APPROVED" | "REJECTED" | "PARTIALLY_APPROVED";
  createdAt: string;
  decidedAt: string | null;
  project: { id: string; name: string; clientId: string } | null;
  rig: { id: string; rigCode: string } | null;
  maintenanceRequest: { id: string; requestCode: string; status: string } | null;
  location: { id: string; name: string } | null;
  requestedBy: { id: string; fullName: string; role: string } | null;
  decidedBy: { id: string; fullName: string; role: string } | null;
  summary: {
    lineCount: number;
    approved: number;
    rejected: number;
    submitted: number;
    totalQuantity: number;
  };
  lines: InventoryUsageBatchApprovalLineRow[];
}

export interface ReceiptSubmissionApprovalRow {
  id: string;
  reportDate: string;
  submittedAt: string | null;
  status: "SUBMITTED" | "APPROVED" | "REJECTED";
  summary: {
    supplierName: string;
    receiptNumber: string;
    verificationCode: string;
    serialNumber: string;
    receiptDate: string;
    total: number;
    traReceiptNumber: string;
  };
  receiptType: ReceiptType;
  receiptPurpose: ReceiptPurpose;
  linkContext: {
    clientId: string | null;
    projectId: string | null;
    rigId: string | null;
    maintenanceRequestId: string | null;
    locationFromId: string | null;
    locationToId: string | null;
  };
  classification: ReceiptApprovalClassification;
}

export interface RequisitionApprovalRow {
  id: string;
  requisitionCode: string;
  type: "LIVE_PROJECT_PURCHASE" | "INVENTORY_STOCK_UP" | "MAINTENANCE_PURCHASE";
  status: "SUBMITTED" | "APPROVED" | "REJECTED" | "PURCHASE_COMPLETED";
  liveProjectSpendType: "BREAKDOWN" | "NORMAL_EXPENSE" | null;
  submittedAt: string;
  category: string;
  subcategory: string | null;
  context: {
    clientId: string | null;
    projectId: string | null;
    rigId: string | null;
    maintenanceRequestId: string | null;
  };
  contextLabels?: {
    clientName: string | null;
    projectName: string | null;
    rigCode: string | null;
    maintenanceRequestCode: string | null;
  };
  totals: {
    estimatedTotalCost: number;
    approvedTotalCost: number;
    actualPostedCost: number;
  };
  submittedBy: {
    userId: string;
    name: string;
    role: string;
  };
}

export type ApprovalRowKind = "receipt" | "requisition" | "drilling" | "inventory";
export type PendingAgeBucket = "UNDER_24_HOURS" | "OVER_24_HOURS" | "OVER_3_DAYS";
