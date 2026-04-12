export type ExpenseApprovalStatus = "DRAFT" | "SUBMITTED" | "APPROVED" | "REJECTED";
export type ExpenseQueueStatus =
  | "NEEDS_RECOGNITION"
  | "PENDING_APPROVAL"
  | "COST_RECOGNIZED"
  | "UNLINKED";
export type ExpenseQueueFilter = "ALL" | ExpenseQueueStatus;

export interface InventoryExpenseMovement {
  id: string;
  date: string;
  movementType: "IN" | "OUT" | "ADJUSTMENT" | "TRANSFER";
  quantity: number;
  unitCost: number | null;
  totalCost: number | null;
  traReceiptNumber: string | null;
  supplierInvoiceNumber: string | null;
  receiptUrl: string | null;
  notes: string | null;
  item: { id: string; name: string; sku: string } | null;
  project: { id: string; name: string } | null;
  rig: { id: string; rigCode: string } | null;
  drillReport: { id: string; holeNumber: string; date: string } | null;
  maintenanceRequest: { id: string; requestCode: string; status: string } | null;
}

export interface InventoryExpenseRow {
  id: string;
  date: string;
  amount: number;
  category: string;
  subcategory: string | null;
  entrySource: string | null;
  vendor: string | null;
  receiptNumber: string | null;
  receiptUrl: string | null;
  approvalStatus: ExpenseApprovalStatus;
  submittedAt: string | null;
  approvedAt: string | null;
  rejectionReason: string | null;
  notes: string | null;
  client: { id: string; name: string } | null;
  project: { id: string; name: string } | null;
  rig: { id: string; rigCode: string } | null;
  enteredBy: { id: string; fullName: string } | null;
  approvedBy: { id: string; fullName: string } | null;
  recognized: boolean;
  purposeBucket:
    | "BREAKDOWN_COST"
    | "MAINTENANCE_COST"
    | "STOCK_REPLENISHMENT"
    | "OPERATING_COST"
    | "OTHER_UNLINKED"
    | null;
  purposeLabel: string | null;
  purposeTraceability: string | null;
  inventoryMovements: InventoryExpenseMovement[];
}

export interface ModalOriginFrame {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface RecognizedCostLedgerRow {
  id: string;
  date: string;
  item: string;
  quantityUsed: number;
  cost: number;
  project: string;
  rig: string;
  reportHole: string;
  reference: string;
}

export const queueFilterLabels: Array<{ key: ExpenseQueueStatus; label: string }> = [
  { key: "NEEDS_RECOGNITION", label: "Needs recognition" },
  { key: "PENDING_APPROVAL", label: "Pending approval" },
  { key: "COST_RECOGNIZED", label: "Cost recognized" },
  { key: "UNLINKED", label: "Unlinked cost" }
];
