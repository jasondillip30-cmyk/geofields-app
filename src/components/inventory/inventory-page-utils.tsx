import type { ReactNode } from "react";

import { formatInventoryCategory } from "@/lib/inventory";

export interface IssueOperationalContext {
  affectedItemNames: string[];
  projectNames: string[];
  rigCodes: string[];
  categoryLabels: string[];
  maintenanceCodes: string[];
  movementIds: string[];
  receiptRefs: string[];
  inventoryValueAffected: number;
  movementsImpacted: number;
  costAtRisk: number;
  latestMovementId: string | null;
}

type InventoryIssueLike = {
  id: string;
  type: string;
  title: string;
  message: string;
  suggestion: string;
  itemIds: string[];
};

type InventoryItemLike = {
  id: string;
  name: string;
  category: string;
  inventoryValue?: number | null;
  compatibleRig?: { rigCode?: string | null } | null;
};

type InventoryMovementLike = {
  id: string;
  itemId: string;
  movementType: "IN" | "OUT" | "ADJUSTMENT" | "TRANSFER";
  totalCost?: number | null;
  date: string;
  traReceiptNumber?: string | null;
  supplierInvoiceNumber?: string | null;
  receiptUrl?: string | null;
  item?: { name?: string | null; sku?: string | null } | null;
  rig?: { rigCode?: string | null } | null;
  project?: { id?: string | null; name?: string | null } | null;
  drillReport?: { id?: string | null; holeNumber?: string | null } | null;
  maintenanceRequest?:
    | {
        id?: string | null;
        requestCode?: string | null;
        breakdownReportId?: string | null;
      }
    | null;
  breakdownReport?: { id?: string | null; title?: string | null } | null;
  linkedBreakdown?: { id?: string | null; title?: string | null } | null;
  expense?: { id?: string; approvalStatus?: string } | null;
  linkedUsageRequest?:
    | {
        id?: string;
        reasonType?: string | null;
        drillReportId?: string | null;
        breakdownReportId?: string | null;
        maintenanceRequestId?: string | null;
        maintenanceRequest?: {
          id?: string | null;
          requestCode?: string | null;
          breakdownReportId?: string | null;
        } | null;
        breakdownReport?: { id?: string | null; title?: string | null } | null;
        drillReport?: { id?: string | null; holeNumber?: string | null } | null;
      }
    | null;
};

type UsageRequestLike = {
  status: string;
  decidedAt?: string | null;
  approvedMovementId?: string | null;
  decisionNote?: string | null;
};

export function toIsoDate(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "-";
  }
  return parsed.toISOString().slice(0, 10);
}

export function formatUsageRequestDecision(requestRow: UsageRequestLike) {
  if (requestRow.status === "APPROVED") {
    const approvedOn = requestRow.decidedAt ? toIsoDate(requestRow.decidedAt) : "recently";
    return `Approved ${approvedOn}${requestRow.approvedMovementId ? " • stock movement recorded" : ""}`;
  }
  if (requestRow.status === "REJECTED") {
    return requestRow.decisionNote?.trim() ? `Rejected • ${requestRow.decisionNote}` : "Rejected by approver";
  }
  if (requestRow.status === "PENDING") {
    return "Pending manager review";
  }
  return "Awaiting review";
}

export function deriveIssueTypeTag(issue: InventoryIssueLike): "Missing Movement" | "Missing Expense" | "Unlinked Receipt" | "Data Mismatch" {
  const details = `${issue.title} ${issue.message} ${issue.suggestion}`.toLowerCase();
  if (details.includes("receipt") && (details.includes("missing") || details.includes("unlinked") || details.includes("not linked"))) {
    return "Unlinked Receipt";
  }
  if (details.includes("expense") || details.includes("cost not recognized") || details.includes("recognition")) {
    return "Missing Expense";
  }
  if (details.includes("movement") && (details.includes("missing") || details.includes("no linked"))) {
    return "Missing Movement";
  }
  if (issue.type === "STOCK_ANOMALY") {
    return "Missing Movement";
  }
  if (issue.type === "PRICE_ANOMALY") {
    return "Missing Expense";
  }
  return "Data Mismatch";
}

export function isIssueNeedsLinking(issue: InventoryIssueLike) {
  const tag = deriveIssueTypeTag(issue);
  if (tag === "Missing Movement" || tag === "Unlinked Receipt") {
    return true;
  }
  const details = `${issue.title} ${issue.message} ${issue.suggestion}`.toLowerCase();
  return details.includes("link") || details.includes("missing");
}

export function isIssueCostRecognitionGap(issue: InventoryIssueLike) {
  const tag = deriveIssueTypeTag(issue);
  if (tag === "Missing Expense") {
    return true;
  }
  const details = `${issue.title} ${issue.message} ${issue.suggestion}`.toLowerCase();
  return details.includes("cost") || details.includes("expense") || details.includes("recognition");
}

export function truncateIssueText(value: string, maxLength: number) {
  const trimmed = value.trim();
  if (trimmed.length <= maxLength) {
    return trimmed;
  }
  return `${trimmed.slice(0, maxLength - 1).trimEnd()}…`;
}

export function buildIssueOperationalContext(
  issue: InventoryIssueLike,
  itemById: Map<string, InventoryItemLike>,
  movements: InventoryMovementLike[]
): IssueOperationalContext {
  const affectedItems = issue.itemIds
    .map((itemId) => itemById.get(itemId) || null)
    .filter(Boolean) as InventoryItemLike[];
  const relatedMovements = movements.filter((movement) => issue.itemIds.includes(movement.itemId));
  const sortedMovements = [...relatedMovements].sort((a, b) => {
    const dateA = new Date(a.date).getTime();
    const dateB = new Date(b.date).getTime();
    return Number.isNaN(dateB - dateA) ? 0 : dateB - dateA;
  });

  const inventoryValueAffected = affectedItems.reduce((sum, item) => sum + (item.inventoryValue || 0), 0);
  const costAtRisk = relatedMovements
    .filter((movement) => movement.movementType === "OUT")
    .reduce((sum, movement) => sum + (movement.totalCost || 0), 0);

  const unique = (values: Array<string | null | undefined>) =>
    Array.from(new Set(values.filter((value): value is string => Boolean(value && value.trim()))));

  return {
    affectedItemNames: unique(affectedItems.map((item) => item.name)),
    projectNames: unique(relatedMovements.map((movement) => movement.project?.name || null)),
    rigCodes: unique([
      ...relatedMovements.map((movement) => movement.rig?.rigCode || null),
      ...affectedItems.map((item) => item.compatibleRig?.rigCode || null)
    ]),
    categoryLabels: unique(affectedItems.map((item) => formatInventoryCategory(item.category))),
    maintenanceCodes: unique(relatedMovements.map((movement) => movement.maintenanceRequest?.requestCode || null)),
    movementIds: unique(relatedMovements.map((movement) => movement.id.slice(-8))),
    receiptRefs: unique(
      relatedMovements.map((movement) =>
        movement.traReceiptNumber || movement.supplierInvoiceNumber || (movement.receiptUrl ? "Attached" : null)
      )
    ),
    inventoryValueAffected,
    movementsImpacted: relatedMovements.length,
    costAtRisk,
    latestMovementId: sortedMovements[0]?.id || null
  };
}

export function deriveMovementPurpose(movement: InventoryMovementLike): {
  label:
    | "Stock Replenishment"
    | "Maintenance Usage"
    | "Breakdown Usage"
    | "Drilling Report Usage"
    | "Operating / Project Usage"
    | "Adjustment / Unlinked";
  detail: string;
} {
  const usageReasonType = (movement.linkedUsageRequest?.reasonType || "").toUpperCase();
  const hasDrillingReportLink =
    usageReasonType === "DRILLING_REPORT" ||
    Boolean(movement.drillReport?.id) ||
    Boolean(movement.linkedUsageRequest?.drillReport?.id) ||
    Boolean(movement.linkedUsageRequest?.drillReportId);
  const hasBreakdownLink =
    usageReasonType === "BREAKDOWN" ||
    Boolean(movement.breakdownReport?.id) ||
    Boolean(movement.linkedUsageRequest?.breakdownReport?.id) ||
    Boolean(movement.linkedUsageRequest?.breakdownReportId) ||
    Boolean(movement.linkedBreakdown?.id) ||
    Boolean(movement.maintenanceRequest?.breakdownReportId);
  const hasMaintenanceLink =
    usageReasonType === "MAINTENANCE" ||
    Boolean(movement.linkedUsageRequest?.maintenanceRequest?.id) ||
    Boolean(movement.linkedUsageRequest?.maintenanceRequestId) ||
    Boolean(movement.maintenanceRequest?.id);

  if (hasBreakdownLink) {
    return {
      label: "Breakdown Usage",
      detail: "This movement is linked to a breakdown case and contributes to breakdown-related operating cost."
    };
  }
  if (hasMaintenanceLink) {
    return {
      label: "Maintenance Usage",
      detail: "This movement is linked to a maintenance case and supports repair/maintenance activity."
    };
  }
  if (hasDrillingReportLink) {
    return {
      label: "Drilling Report Usage",
      detail: "This movement is linked to a drilling report and tracks consumables used for daily drilling activity."
    };
  }
  if (movement.movementType === "IN") {
    return {
      label: "Stock Replenishment",
      detail: "This movement increases stock and is treated as inventory replenishment."
    };
  }
  if (movement.movementType === "OUT" && (movement.project?.id || movement.rig?.rigCode)) {
    return {
      label: "Operating / Project Usage",
      detail: "This movement is operational stock usage tied to project or rig context."
    };
  }
  return {
    label: "Adjustment / Unlinked",
    detail: "This movement is an adjustment, transfer, or lacks clear operational linkage."
  };
}

export function deriveMovementRecognitionStatus(movement: InventoryMovementLike): {
  label: "Cost Recognized" | "Pending Recognition" | "Stock Movement Only";
  detail: string;
  tone: "good" | "warn" | "neutral";
} {
  const linkedExpense = movement.expense;
  if (!linkedExpense) {
    if (movement.movementType === "IN") {
      return {
        label: "Stock Movement Only",
        detail: "Stock intake/replenishment is recorded, but no linked expense is attached to this movement.",
        tone: "neutral"
      };
    }
    return {
      label: "Pending Recognition",
      detail: "No linked expense record is attached yet, so this movement does not add recognized cost.",
      tone: "warn"
    };
  }
  if (String(linkedExpense.approvalStatus || "").toUpperCase() === "APPROVED") {
    return {
      label: "Cost Recognized",
      detail: `Linked expense ${linkedExpense.id?.slice(-8) || ""} is approved and contributes to recognized financial totals.`,
      tone: "good"
    };
  }
  return {
    label: "Pending Recognition",
    detail: `Linked expense ${linkedExpense.id?.slice(-8) || ""} is ${(linkedExpense.approvalStatus || "").toLowerCase()} and not recognized yet.`,
    tone: "warn"
  };
}

export function deriveMovementRecognitionSubLine(
  movement: InventoryMovementLike,
  recognition: ReturnType<typeof deriveMovementRecognitionStatus>
) {
  if (recognition.label === "Cost Recognized" && movement.expense?.id) {
    return "Expense approved";
  }
  if (recognition.label === "Pending Recognition") {
    return movement.expense?.id ? "Pending approval" : "No expense";
  }
  return "Stock only";
}

export function movementLinkedToDisplay(movement: InventoryMovementLike): ReactNode {
  const linkedMaintenance =
    movement.linkedUsageRequest?.maintenanceRequest || movement.maintenanceRequest || null;
  const linkedDrillReport =
    movement.linkedUsageRequest?.drillReport || movement.drillReport || null;
  const drillReportLabel = linkedDrillReport?.holeNumber ? `Report ${linkedDrillReport.holeNumber}` : null;
  const linkedBreakdown =
    movement.breakdownReport ||
    movement.linkedUsageRequest?.breakdownReport ||
    movement.linkedBreakdown ||
    null;
  const primaryCase = drillReportLabel || linkedMaintenance?.requestCode || linkedBreakdown?.title || null;
  const secondaryContext = movement.project?.name || movement.rig?.rigCode || null;
  const allContextValues = [
    drillReportLabel,
    linkedMaintenance?.requestCode || null,
    linkedBreakdown?.title || null,
    movement.project?.name || null,
    movement.rig?.rigCode || null,
    movement.linkedUsageRequest?.id ? movement.linkedUsageRequest.id.slice(-8) : null
  ].filter(Boolean) as string[];
  const visibleValues = [primaryCase, secondaryContext].filter(Boolean) as string[];
  const moreCount = Math.max(allContextValues.length - visibleValues.length, 0);

  if (visibleValues.length === 0) {
    return "—";
  }

  return (
    <div className="flex flex-wrap items-center gap-0.5">
      {visibleValues.map((rowLabel) => (
        <span
          key={`${movement.id}-${rowLabel}`}
          className="inline-flex max-w-[12rem] truncate rounded-full border border-slate-300 bg-white px-1.5 py-[1px] text-[10px] font-medium text-slate-700"
        >
          {rowLabel}
        </span>
      ))}
      {moreCount > 0 ? (
        <p className="text-[10px] text-slate-500">+{moreCount} more</p>
      ) : null}
    </div>
  );
}

export function movementItemLabel(movement: InventoryMovementLike) {
  const itemName = movement.item?.name?.trim() || "Unknown item";
  const itemSku = movement.item?.sku?.trim();
  if (!itemSku) {
    return itemName;
  }
  return `${itemName} (${itemSku})`;
}
