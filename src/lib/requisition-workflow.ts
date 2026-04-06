import { roundCurrency } from "@/lib/inventory-server";

export const PURCHASE_REQUISITION_REPORT_TYPE = "PURCHASE_REQUISITION";

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

export interface PurchaseRequisitionLineItem {
  id: string;
  description: string;
  quantity: number;
  estimatedUnitCost: number;
  estimatedTotalCost: number;
  notes: string | null;
}

export interface PurchaseRequisitionPayload {
  schemaVersion: 1;
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
  context: {
    clientId: string | null;
    projectId: string | null;
    rigId: string | null;
    maintenanceRequestId: string | null;
    breakdownReportId?: string | null;
  };
  lineItems: PurchaseRequisitionLineItem[];
  totals: {
    estimatedTotalCost: number;
    approvedTotalCost: number;
    actualPostedCost: number;
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

export interface ParsedPurchaseRequisition {
  payload: PurchaseRequisitionPayload;
  sourcePayload: Record<string, unknown>;
}

export function parseRequisitionType(value: unknown): RequisitionType | null {
  if (
    value === "LIVE_PROJECT_PURCHASE" ||
    value === "INVENTORY_STOCK_UP" ||
    value === "MAINTENANCE_PURCHASE"
  ) {
    return value;
  }
  return null;
}

export function parseRequisitionStatus(value: unknown): RequisitionStatus | null {
  if (
    value === "SUBMITTED" ||
    value === "APPROVED" ||
    value === "REJECTED" ||
    value === "PURCHASE_COMPLETED"
  ) {
    return value;
  }
  return null;
}

export function parseLiveProjectSpendType(value: unknown): LiveProjectSpendType | null {
  if (value === "BREAKDOWN" || value === "NORMAL_EXPENSE") {
    return value;
  }
  return null;
}

export function parsePurchaseRequisitionPayload(
  payloadJson: string | null
): ParsedPurchaseRequisition | null {
  if (!payloadJson) {
    return null;
  }

  try {
    const parsed = JSON.parse(payloadJson) as unknown;
    const root = asRecord(parsed);
    if (!root) {
      return null;
    }

    const type = parseRequisitionType(root.type);
    const status = parseRequisitionStatus(root.status);
    if (!type || !status) {
      return null;
    }
    const liveProjectSpendType = parseLiveProjectSpendType(root.liveProjectSpendType);

    const lineItemsRaw = Array.isArray(root.lineItems) ? root.lineItems : [];
    const lineItems: PurchaseRequisitionLineItem[] = lineItemsRaw
      .map((entry, index) => normalizeLineItem(entry, index))
      .filter((entry): entry is PurchaseRequisitionLineItem => Boolean(entry));

    const submittedBy = asRecord(root.submittedBy);
    const approval = asRecord(root.approval);
    const context = asRecord(root.context);
    const totals = asRecord(root.totals);
    const purchase = asRecord(root.purchase);

    const estimatedTotalFromLines = roundCurrency(
      lineItems.reduce((sum, line) => sum + line.estimatedTotalCost, 0)
    );

    const payload: PurchaseRequisitionPayload = {
      schemaVersion: 1,
      requisitionCode: readString(root.requisitionCode) || "REQ-UNKNOWN",
      type,
      status,
      liveProjectSpendType: type === "LIVE_PROJECT_PURCHASE" ? liveProjectSpendType : null,
      category: readString(root.category) || "General",
      subcategory: readNullableString(root.subcategory),
      categoryId: readNullableString(root.categoryId),
      subcategoryId: readNullableString(root.subcategoryId),
      requestedVendorId: readNullableString(root.requestedVendorId),
      requestedVendorName: readNullableString(root.requestedVendorName),
      notes: readNullableString(root.notes),
      submittedAt: readString(root.submittedAt) || new Date(0).toISOString(),
      submittedBy: {
        userId: readString(submittedBy?.userId),
        name: readString(submittedBy?.name) || "Unknown",
        role: readString(submittedBy?.role) || "UNKNOWN"
      },
      approval: {
        approvedAt: readNullableString(approval?.approvedAt),
        approvedBy: normalizeActor(approval?.approvedBy),
        rejectedAt: readNullableString(approval?.rejectedAt),
        rejectedBy: normalizeActor(approval?.rejectedBy),
        rejectionReason: readNullableString(approval?.rejectionReason),
        lineItemMode: "FULL_ONLY"
      },
      context: {
        clientId: readNullableString(context?.clientId),
        projectId: readNullableString(context?.projectId),
        rigId: readNullableString(context?.rigId),
        maintenanceRequestId: readNullableString(context?.maintenanceRequestId),
        breakdownReportId: readNullableString(context?.breakdownReportId)
      },
      lineItems,
      totals: {
        estimatedTotalCost:
          readNumber(totals?.estimatedTotalCost) > 0
            ? roundCurrency(readNumber(totals?.estimatedTotalCost))
            : estimatedTotalFromLines,
        approvedTotalCost: roundCurrency(readNumber(totals?.approvedTotalCost)),
        actualPostedCost: roundCurrency(readNumber(totals?.actualPostedCost))
      },
      purchase: {
        receiptSubmissionId: readNullableString(purchase?.receiptSubmissionId),
        receiptNumber: readNullableString(purchase?.receiptNumber),
        supplierName: readNullableString(purchase?.supplierName),
        expenseId: readNullableString(purchase?.expenseId),
        movementCount: Math.max(0, Math.floor(readNumber(purchase?.movementCount))),
        postedAt: readNullableString(purchase?.postedAt)
      }
    };

    return {
      payload,
      sourcePayload: root
    };
  } catch {
    return null;
  }
}

export function buildRequisitionCode(now = new Date()) {
  const year = now.getUTCFullYear();
  const month = `${now.getUTCMonth() + 1}`.padStart(2, "0");
  const day = `${now.getUTCDate()}`.padStart(2, "0");
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `REQ-${year}${month}${day}-${suffix}`;
}

export function mapRequisitionToReceiptClassification(type: RequisitionType) {
  if (type === "MAINTENANCE_PURCHASE") {
    return "MAINTENANCE_LINKED_PURCHASE" as const;
  }
  return "INVENTORY_PURCHASE" as const;
}

export function mapRequisitionToReceiptPurpose(type: RequisitionType) {
  if (type === "INVENTORY_STOCK_UP") {
    return "INVENTORY_PURCHASE" as const;
  }
  return "INVENTORY_AND_EXPENSE" as const;
}

export function requisitionTypeLabel(type: RequisitionType) {
  if (type === "LIVE_PROJECT_PURCHASE") {
    return "Live project purchase";
  }
  if (type === "MAINTENANCE_PURCHASE") {
    return "Maintenance purchase";
  }
  return "Inventory stock-up";
}

export function liveProjectSpendTypeLabel(
  spendType: LiveProjectSpendType | null | undefined
) {
  if (spendType === "BREAKDOWN") {
    return "Breakdown";
  }
  if (spendType === "NORMAL_EXPENSE") {
    return "Normal expense";
  }
  return "-";
}

function normalizeLineItem(value: unknown, index: number): PurchaseRequisitionLineItem | null {
  const candidate = asRecord(value);
  if (!candidate) {
    return null;
  }
  const description = readString(candidate.description);
  const quantity = readNumber(candidate.quantity);
  const estimatedUnitCost = readNumber(candidate.estimatedUnitCost);
  const estimatedTotalCostRaw = readNumber(candidate.estimatedTotalCost);
  if (!description || quantity <= 0 || estimatedUnitCost < 0) {
    return null;
  }
  const estimatedTotalCost =
    estimatedTotalCostRaw > 0
      ? roundCurrency(estimatedTotalCostRaw)
      : roundCurrency(quantity * estimatedUnitCost);

  return {
    id: readString(candidate.id) || `line-${index + 1}`,
    description,
    quantity: roundCurrency(quantity),
    estimatedUnitCost: roundCurrency(estimatedUnitCost),
    estimatedTotalCost,
    notes: readNullableString(candidate.notes)
  };
}

function asRecord(value: unknown) {
  if (!value || typeof value !== "object") {
    return null;
  }
  return value as Record<string, unknown>;
}

function readString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function readNullableString(value: unknown) {
  const raw = readString(value);
  return raw.length > 0 ? raw : null;
}

function readNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeActor(value: unknown) {
  const actor = asRecord(value);
  if (!actor) {
    return null;
  }
  const userId = readString(actor.userId);
  const name = readString(actor.name);
  const role = readString(actor.role);
  if (!userId || !name || !role) {
    return null;
  }
  return { userId, name, role };
}
