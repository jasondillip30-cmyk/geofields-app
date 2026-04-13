import { inventoryCategoryOptions } from "@/lib/inventory";
import type {
  ReceiptClassification,
  ReceiptIntakePanelProps,
  ReviewLineState
} from "@/components/inventory/receipt-intake-panel-types";

export function mapRequisitionCategoryToInventoryCategory(value: string | null | undefined): string {
  if (!value) {
    return "OTHER";
  }
  const normalized = value.trim().toUpperCase().replace(/\s+/g, "_");
  if (inventoryCategoryOptions.some((entry) => entry.value === normalized)) {
    return normalized;
  }
  if (normalized.includes("OIL") || normalized.includes("LUB")) {
    return "OILS";
  }
  if (normalized.includes("FILTER")) {
    return "FILTERS";
  }
  if (normalized.includes("TIRE")) {
    return "TIRES";
  }
  if (normalized.includes("HYDRAULIC")) {
    return "HYDRAULIC";
  }
  if (normalized.includes("ELECT")) {
    return "ELECTRICAL";
  }
  if (normalized.includes("SPARE")) {
    return "SPARE_PARTS";
  }
  if (normalized.includes("CONSUM")) {
    return "CONSUMABLES";
  }
  if (normalized.includes("DRILL")) {
    return "DRILLING";
  }
  return "OTHER";
}

export function resolveRequisitionEstimatedTotal(initialRequisition: ReceiptIntakePanelProps["initialRequisition"]) {
  if (!initialRequisition?.totals) {
    return 0;
  }
  const approvedTotal = Number(initialRequisition.totals.approvedTotalCost || 0);
  if (Number.isFinite(approvedTotal) && approvedTotal > 0) {
    return approvedTotal;
  }
  const estimatedTotal = Number(initialRequisition.totals.estimatedTotalCost || 0);
  if (Number.isFinite(estimatedTotal) && estimatedTotal > 0) {
    return estimatedTotal;
  }
  return 0;
}

export function mapRequisitionLineItems(
  initialRequisition: ReceiptIntakePanelProps["initialRequisition"],
  classification: ReceiptClassification
): ReviewLineState[] {
  if (!initialRequisition || !Array.isArray(initialRequisition.lineItems)) {
    return [];
  }
  const selectedCategory = mapRequisitionCategoryToInventoryCategory(initialRequisition.category);
  const subcategorySuffix = initialRequisition.subcategory?.trim()
    ? ` • ${initialRequisition.subcategory.trim()}`
    : "";
  return initialRequisition.lineItems
    .map((line, index) => {
      const description = String(line.description || "").trim();
      if (!description) {
        return null;
      }
      const quantity = Number(line.quantity || 0);
      const unitPrice = Number(line.estimatedUnitCost || 0);
      const total = Number(line.estimatedTotalCost || 0);
      const safeQuantity = Number.isFinite(quantity) && quantity > 0 ? quantity : 1;
      const safeUnitPrice = Number.isFinite(unitPrice) && unitPrice >= 0 ? unitPrice : 0;
      const safeTotal =
        Number.isFinite(total) && total > 0 ? total : Math.max(0, safeQuantity * safeUnitPrice);
      return {
        id: `req-${line.id || index + 1}`,
        description,
        quantity: String(safeQuantity),
        unitPrice: String(safeUnitPrice),
        lineTotal: String(safeTotal),
        extractionConfidence: "MEDIUM",
        selectedCategory,
        suggestedCategory: selectedCategory === "OTHER" ? null : selectedCategory,
        categoryReason: `Prefilled from approved requisition category${subcategorySuffix || ""}.`,
        mode:
          classification === "EXPENSE_ONLY"
            ? "EXPENSE_ONLY"
            : classification === "INTERNAL_TRANSFER"
              ? "MATCH"
              : "NEW",
        selectedItemId: "",
        matchConfidence: "NONE",
        matchScore: 0,
        newItemName: description,
        newItemSku: "",
        newItemMinimumStockLevel: "0"
      };
    })
    .filter((line): line is ReviewLineState => Boolean(line));
}

export function resolveReviewLinesWithRequisitionFallback({
  extractedLines,
  initialRequisition,
  classification
}: {
  extractedLines: ReviewLineState[];
  initialRequisition: ReceiptIntakePanelProps["initialRequisition"];
  classification: ReceiptClassification;
}) {
  if (extractedLines.length > 0) {
    return extractedLines;
  }
  return mapRequisitionLineItems(initialRequisition, classification);
}

export function resolveRequisitionLink({
  requisitionId,
  initialRequisition
}: {
  requisitionId: string;
  initialRequisition: ReceiptIntakePanelProps["initialRequisition"];
}): {
  id: string;
  code: string;
  type: "LIVE_PROJECT_PURCHASE" | "INVENTORY_STOCK_UP" | "MAINTENANCE_PURCHASE" | "";
  clientId: string;
  projectId: string;
  rigId: string;
  maintenanceRequestId: string;
} {
  const normalizedId = requisitionId.trim();
  if (normalizedId) {
    return {
      id: normalizedId,
      code: initialRequisition?.id === normalizedId ? initialRequisition.requisitionCode : "",
      type:
        initialRequisition?.id === normalizedId
          ? initialRequisition.type
          : "",
      clientId:
        initialRequisition?.id === normalizedId ? initialRequisition.clientId || "" : "",
      projectId:
        initialRequisition?.id === normalizedId ? initialRequisition.projectId || "" : "",
      rigId: initialRequisition?.id === normalizedId ? initialRequisition.rigId || "" : "",
      maintenanceRequestId:
        initialRequisition?.id === normalizedId
          ? initialRequisition.maintenanceRequestId || ""
          : ""
    };
  }
  if (!initialRequisition) {
    return {
      id: "",
      code: "",
      type: "",
      clientId: "",
      projectId: "",
      rigId: "",
      maintenanceRequestId: ""
    };
  }
  return {
    id: initialRequisition.id,
    code: initialRequisition.requisitionCode,
    type: initialRequisition.type,
    clientId: initialRequisition.clientId || "",
    projectId: initialRequisition.projectId || "",
    rigId: initialRequisition.rigId || "",
    maintenanceRequestId: initialRequisition.maintenanceRequestId || ""
  };
}

export function normalizeSupplierName(value: string) {
  return value
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}
