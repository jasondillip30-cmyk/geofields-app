export type ReceiptType =
  | "INVENTORY_PURCHASE"
  | "MAINTENANCE_LINKED_PURCHASE"
  | "EXPENSE_ONLY"
  | "INTERNAL_TRANSFER";

export type ReceiptPurpose =
  | "INVENTORY_PURCHASE"
  | "BUSINESS_EXPENSE_ONLY"
  | "INVENTORY_AND_EXPENSE"
  | "EVIDENCE_ONLY"
  | "OTHER_MANUAL";

export type ReceiptSpendTag = "STOCK" | "MAINTENANCE" | "EXPENSE";
export type ReceiptPriority = "HIGH" | "MEDIUM" | "LOW";
export type ReceiptStockUse = "WAREHOUSE_STOCK" | "URGENT_USE" | null;

export interface ReceiptApprovalClassification {
  tag: ReceiptSpendTag;
  priority: ReceiptPriority;
  stockUse: ReceiptStockUse;
  contextLabel: string;
}

export function normalizeReceiptType(value: string | null | undefined): ReceiptType {
  if (
    value === "INVENTORY_PURCHASE" ||
    value === "MAINTENANCE_LINKED_PURCHASE" ||
    value === "EXPENSE_ONLY" ||
    value === "INTERNAL_TRANSFER"
  ) {
    return value;
  }
  return "INVENTORY_PURCHASE";
}

export function normalizeReceiptPurpose(value: string | null | undefined): ReceiptPurpose {
  if (
    value === "INVENTORY_PURCHASE" ||
    value === "BUSINESS_EXPENSE_ONLY" ||
    value === "INVENTORY_AND_EXPENSE" ||
    value === "EVIDENCE_ONLY" ||
    value === "OTHER_MANUAL"
  ) {
    return value;
  }
  return "INVENTORY_PURCHASE";
}

export function deriveReceiptApprovalClassification({
  receiptType,
  receiptPurpose,
  maintenanceRequestId
}: {
  receiptType: ReceiptType;
  receiptPurpose: ReceiptPurpose;
  maintenanceRequestId: string | null | undefined;
}): ReceiptApprovalClassification {
  if (receiptType === "MAINTENANCE_LINKED_PURCHASE" || Boolean(maintenanceRequestId)) {
    return {
      tag: "MAINTENANCE",
      priority: "HIGH",
      stockUse: "URGENT_USE",
      contextLabel: "Maintenance / breakdown-linked"
    };
  }

  if (
    receiptType === "EXPENSE_ONLY" ||
    receiptPurpose === "BUSINESS_EXPENSE_ONLY" ||
    receiptPurpose === "EVIDENCE_ONLY"
  ) {
    return {
      tag: "EXPENSE",
      priority: "LOW",
      stockUse: null,
      contextLabel: "Administrative / non-inventory"
    };
  }

  if (receiptType === "INTERNAL_TRANSFER") {
    return {
      tag: "STOCK",
      priority: "MEDIUM",
      stockUse: "WAREHOUSE_STOCK",
      contextLabel: "Internal stock transfer"
    };
  }

  return {
    tag: "STOCK",
    priority: "MEDIUM",
    stockUse: "WAREHOUSE_STOCK",
    contextLabel: "Warehouse stock replenishment"
  };
}
