import {
  COST_SPENDING_CATEGORY_LABELS,
  deriveSpendingCategory,
  roundCurrency,
  type CostSpendCategoryKey
} from "@/lib/cost-tracking";
import type { ReceiptSpendTag } from "@/lib/receipt-approval-classification";

export type OperationalPurposeBucket =
  | "BREAKDOWN_COST"
  | "MAINTENANCE_COST"
  | "STOCK_REPLENISHMENT"
  | "OPERATING_COST"
  | "OTHER_UNLINKED";

export interface ApprovedExpenseRowInput {
  id: string;
  date: string;
  amount: number;
  category: string;
  subcategory: string | null;
  entrySource: string | null;
  notes: string | null;
  projectId: string | null;
  rigId: string | null;
}

export interface ApprovedMovementRowInput {
  id: string;
  expenseId: string | null;
  movementType: "IN" | "OUT" | "ADJUSTMENT" | "TRANSFER";
  maintenanceRequestId: string | null;
  breakdownReportId: string | null;
  projectId: string | null;
  rigId: string | null;
}

export interface ApprovedUsageContextRowInput {
  approvedMovementId: string | null;
  maintenanceRequestId: string | null;
  breakdownReportId: string | null;
  reasonType: string | null;
}

export interface ApprovedRequisitionContextRowInput {
  expenseId: string | null;
  requisitionCode: string | null;
  type: "LIVE_PROJECT_PURCHASE" | "INVENTORY_STOCK_UP" | "MAINTENANCE_PURCHASE";
  liveProjectSpendType: "BREAKDOWN" | "NORMAL_EXPENSE" | null;
  projectId: string | null;
  rigId: string | null;
  maintenanceRequestId: string | null;
  breakdownReportId: string | null;
}

export interface ApprovedMaintenanceContextRowInput {
  id: string;
  breakdownReportId: string | null;
}

export interface ApprovedReceiptContextRowInput {
  expenseId: string | null;
  receiptTag: ReceiptSpendTag | null;
  maintenanceRequestId: string | null;
  breakdownReportId: string | null;
}

export interface ClassifiedApprovedSpendRow {
  expenseId: string;
  date: string;
  amount: number;
  purposeBucket: OperationalPurposeBucket;
  purposeLabel: string;
  accountingCategoryKey: CostSpendCategoryKey;
  accountingCategoryLabel: string;
  traceability: string;
  sourceType:
    | "EXPLICIT_BREAKDOWN"
    | "EXPLICIT_MAINTENANCE"
    | "STOCK_LINKAGE"
    | "PROJECT_LINKAGE"
    | "LEGACY_HINT"
    | "UNLINKED";
  linkedProjectId: string | null;
  linkedRigId: string | null;
  maintenanceRequestId: string | null;
  breakdownReportId: string | null;
  requisitionCode: string | null;
  movementSummary: string | null;
  legacyFlags: {
    legacyBreakdownMarker: boolean;
    maintenanceLikeWithoutLink: boolean;
    noProjectLink: boolean;
    noRigLink: boolean;
  };
}

export interface PurposeTotals {
  recognizedSpendTotal: number;
  breakdownCost: number;
  maintenanceCost: number;
  stockReplenishmentCost: number;
  operatingCost: number;
  otherUnlinkedCost: number;
}

export interface CategoryTotals {
  [key: string]: number;
}

export interface ClassificationAuditSummary {
  recognizedSpendTotal: number;
  purposeTotals: PurposeTotals;
  categoryTotals: CategoryTotals;
  purposeCounts: Record<OperationalPurposeBucket, number>;
  legacyUnlinkedCount: number;
  reconciliationDelta: number;
}

export function classifyApprovedSpendRows({
  expenses,
  movements,
  usageContexts,
  requisitionContexts,
  maintenanceContexts,
  receiptContexts
}: {
  expenses: ApprovedExpenseRowInput[];
  movements: ApprovedMovementRowInput[];
  usageContexts: ApprovedUsageContextRowInput[];
  requisitionContexts: ApprovedRequisitionContextRowInput[];
  maintenanceContexts: ApprovedMaintenanceContextRowInput[];
  receiptContexts: ApprovedReceiptContextRowInput[];
}) {
  const movementsByExpenseId = new Map<string, ApprovedMovementRowInput[]>();
  for (const movement of movements) {
    if (!movement.expenseId) {
      continue;
    }
    const bucket = movementsByExpenseId.get(movement.expenseId) || [];
    bucket.push(movement);
    movementsByExpenseId.set(movement.expenseId, bucket);
  }

  const usageByMovementId = new Map<string, ApprovedUsageContextRowInput[]>();
  for (const usageContext of usageContexts) {
    if (!usageContext.approvedMovementId) {
      continue;
    }
    const bucket = usageByMovementId.get(usageContext.approvedMovementId) || [];
    bucket.push(usageContext);
    usageByMovementId.set(usageContext.approvedMovementId, bucket);
  }

  const requisitionByExpenseId = new Map<string, ApprovedRequisitionContextRowInput>();
  for (const requisitionContext of requisitionContexts) {
    if (!requisitionContext.expenseId) {
      continue;
    }
    requisitionByExpenseId.set(requisitionContext.expenseId, requisitionContext);
  }

  const receiptByExpenseId = new Map<string, ApprovedReceiptContextRowInput>();
  for (const receiptContext of receiptContexts) {
    if (!receiptContext.expenseId) {
      continue;
    }
    receiptByExpenseId.set(receiptContext.expenseId, receiptContext);
  }

  const maintenanceBreakdownById = new Map<string, string>();
  for (const maintenanceContext of maintenanceContexts) {
    if (maintenanceContext.breakdownReportId) {
      maintenanceBreakdownById.set(maintenanceContext.id, maintenanceContext.breakdownReportId);
    }
  }

  const rows: ClassifiedApprovedSpendRow[] = [];

  for (const expense of expenses) {
    const amount = roundCurrency(Math.max(0, expense.amount || 0));
    if (amount <= 0) {
      continue;
    }
    const movementRows = movementsByExpenseId.get(expense.id) || [];
    const requisitionContext = requisitionByExpenseId.get(expense.id) || null;
    const receiptContext = receiptByExpenseId.get(expense.id) || null;
    const movementUsageContexts = movementRows.flatMap((movement) => usageByMovementId.get(movement.id) || []);

    const maintenanceIds = new Set<string>();
    const breakdownIds = new Set<string>();

    if (requisitionContext?.maintenanceRequestId) {
      maintenanceIds.add(requisitionContext.maintenanceRequestId);
    }
    if (receiptContext?.maintenanceRequestId) {
      maintenanceIds.add(receiptContext.maintenanceRequestId);
    }
    for (const movementRow of movementRows) {
      if (movementRow.maintenanceRequestId) {
        maintenanceIds.add(movementRow.maintenanceRequestId);
      }
      if (movementRow.breakdownReportId) {
        breakdownIds.add(movementRow.breakdownReportId);
      }
    }
    for (const usageContext of movementUsageContexts) {
      if (usageContext.maintenanceRequestId) {
        maintenanceIds.add(usageContext.maintenanceRequestId);
      }
      if (usageContext.breakdownReportId) {
        breakdownIds.add(usageContext.breakdownReportId);
      }
    }

    if (requisitionContext?.breakdownReportId) {
      breakdownIds.add(requisitionContext.breakdownReportId);
    }
    if (receiptContext?.breakdownReportId) {
      breakdownIds.add(receiptContext.breakdownReportId);
    }

    for (const maintenanceId of maintenanceIds) {
      const linkedBreakdownId = maintenanceBreakdownById.get(maintenanceId);
      if (linkedBreakdownId) {
        breakdownIds.add(linkedBreakdownId);
      }
    }

    const legacyBreakdownMarker = requisitionContext?.liveProjectSpendType === "BREAKDOWN";
    const hasStockLinkage =
      requisitionContext?.type === "INVENTORY_STOCK_UP" ||
      movementRows.some((movementRow) => movementRow.movementType === "IN") ||
      receiptContext?.receiptTag === "STOCK";
    const hasProjectLink =
      Boolean(expense.projectId) ||
      Boolean(requisitionContext?.projectId) ||
      movementRows.some((movementRow) => Boolean(movementRow.projectId));
    const hasRigLink =
      Boolean(expense.rigId) ||
      Boolean(requisitionContext?.rigId) ||
      movementRows.some((movementRow) => Boolean(movementRow.rigId));
    const maintenanceLikeWithoutLink =
      breakdownIds.size === 0 &&
      maintenanceIds.size === 0 &&
      /maint|repair|breakdown/i.test(
        `${expense.category} ${expense.subcategory || ""} ${expense.notes || ""}`
      );

    const linkedProjectId =
      expense.projectId ||
      requisitionContext?.projectId ||
      movementRows.find((movementRow) => Boolean(movementRow.projectId))?.projectId ||
      null;
    const linkedRigId =
      expense.rigId ||
      requisitionContext?.rigId ||
      movementRows.find((movementRow) => Boolean(movementRow.rigId))?.rigId ||
      null;
    const maintenanceRequestId = Array.from(maintenanceIds)[0] || null;
    const breakdownReportId = Array.from(breakdownIds)[0] || null;

    const movementSummary = summarizeMovementSummary(movementRows);

    let purposeBucket: OperationalPurposeBucket;
    let sourceType: ClassifiedApprovedSpendRow["sourceType"];
    let traceability: string;

    if (breakdownIds.size > 0 || legacyBreakdownMarker) {
      purposeBucket = "BREAKDOWN_COST";
      sourceType = breakdownIds.size > 0 ? "EXPLICIT_BREAKDOWN" : "LEGACY_HINT";
      traceability =
        breakdownIds.size > 0
          ? "Breakdown-linked recognized spend (direct linkage)."
          : "Legacy breakdown spend marker on requisition (no direct breakdown id).";
    } else if (maintenanceIds.size > 0) {
      purposeBucket = "MAINTENANCE_COST";
      sourceType = "EXPLICIT_MAINTENANCE";
      traceability = "Maintenance-linked recognized spend (direct linkage).";
    } else if (hasStockLinkage) {
      purposeBucket = "STOCK_REPLENISHMENT";
      sourceType = "STOCK_LINKAGE";
      traceability = "Stock replenishment linkage detected from inventory/requisition path.";
    } else if (hasProjectLink) {
      purposeBucket = "OPERATING_COST";
      sourceType = maintenanceLikeWithoutLink ? "LEGACY_HINT" : "PROJECT_LINKAGE";
      traceability = maintenanceLikeWithoutLink
        ? "Legacy maintenance-like expense without direct maintenance/breakdown linkage."
        : "Project-linked recognized operating spend.";
    } else {
      purposeBucket = "OTHER_UNLINKED";
      sourceType = maintenanceLikeWithoutLink ? "LEGACY_HINT" : "UNLINKED";
      traceability = maintenanceLikeWithoutLink
        ? "Legacy maintenance-like expense without project/maintenance linkage."
        : "Recognized spend without sufficient linkage context.";
    }

    const spendTypeForCategory =
      purposeBucket === "BREAKDOWN_COST" || purposeBucket === "MAINTENANCE_COST"
        ? "MAINTENANCE"
        : purposeBucket === "STOCK_REPLENISHMENT"
          ? "INVENTORY"
          : "NON_INVENTORY";
    const accountingCategoryKey = deriveSpendingCategory({
      spendType: spendTypeForCategory,
      category: expense.category,
      subcategory: expense.subcategory,
      notes: expense.notes
    });

    rows.push({
      expenseId: expense.id,
      date: expense.date,
      amount,
      purposeBucket,
      purposeLabel: formatPurposeBucketLabel(purposeBucket),
      accountingCategoryKey,
      accountingCategoryLabel: COST_SPENDING_CATEGORY_LABELS[accountingCategoryKey],
      traceability,
      sourceType,
      linkedProjectId,
      linkedRigId,
      maintenanceRequestId,
      breakdownReportId,
      requisitionCode: requisitionContext?.requisitionCode || null,
      movementSummary,
      legacyFlags: {
        legacyBreakdownMarker,
        maintenanceLikeWithoutLink,
        noProjectLink: !hasProjectLink,
        noRigLink: !hasRigLink
      }
    });
  }

  return rows.sort((a, b) => {
    const byDate = new Date(b.date).getTime() - new Date(a.date).getTime();
    if (byDate !== 0) {
      return byDate;
    }
    return b.amount - a.amount;
  });
}

export function buildPurposeTotals(rows: ClassifiedApprovedSpendRow[]): PurposeTotals {
  const totals: PurposeTotals = {
    recognizedSpendTotal: 0,
    breakdownCost: 0,
    maintenanceCost: 0,
    stockReplenishmentCost: 0,
    operatingCost: 0,
    otherUnlinkedCost: 0
  };

  for (const row of rows) {
    totals.recognizedSpendTotal += row.amount;
    if (row.purposeBucket === "BREAKDOWN_COST") {
      totals.breakdownCost += row.amount;
      continue;
    }
    if (row.purposeBucket === "MAINTENANCE_COST") {
      totals.maintenanceCost += row.amount;
      continue;
    }
    if (row.purposeBucket === "STOCK_REPLENISHMENT") {
      totals.stockReplenishmentCost += row.amount;
      continue;
    }
    if (row.purposeBucket === "OPERATING_COST") {
      totals.operatingCost += row.amount;
      continue;
    }
    totals.otherUnlinkedCost += row.amount;
  }

  return {
    recognizedSpendTotal: roundCurrency(totals.recognizedSpendTotal),
    breakdownCost: roundCurrency(totals.breakdownCost),
    maintenanceCost: roundCurrency(totals.maintenanceCost),
    stockReplenishmentCost: roundCurrency(totals.stockReplenishmentCost),
    operatingCost: roundCurrency(totals.operatingCost),
    otherUnlinkedCost: roundCurrency(totals.otherUnlinkedCost)
  };
}

export function buildCategoryTotals(rows: ClassifiedApprovedSpendRow[]) {
  const totals = new Map<CostSpendCategoryKey, number>();
  (Object.keys(COST_SPENDING_CATEGORY_LABELS) as CostSpendCategoryKey[]).forEach((key) =>
    totals.set(key, 0)
  );

  for (const row of rows) {
    totals.set(
      row.accountingCategoryKey,
      (totals.get(row.accountingCategoryKey) || 0) + row.amount
    );
  }

  const output: CategoryTotals = {};
  for (const [key, value] of totals.entries()) {
    output[key] = roundCurrency(value);
  }
  return output;
}

export function buildClassificationAuditSummary(rows: ClassifiedApprovedSpendRow[]) {
  const purposeTotals = buildPurposeTotals(rows);
  const categoryTotals = buildCategoryTotals(rows);
  const purposeCounts: Record<OperationalPurposeBucket, number> = {
    BREAKDOWN_COST: 0,
    MAINTENANCE_COST: 0,
    STOCK_REPLENISHMENT: 0,
    OPERATING_COST: 0,
    OTHER_UNLINKED: 0
  };

  let legacyUnlinkedCount = 0;
  for (const row of rows) {
    purposeCounts[row.purposeBucket] += 1;
    if (row.sourceType === "LEGACY_HINT" || row.purposeBucket === "OTHER_UNLINKED") {
      legacyUnlinkedCount += 1;
    }
  }

  const purposeTotalSum = roundCurrency(
    purposeTotals.breakdownCost +
      purposeTotals.maintenanceCost +
      purposeTotals.stockReplenishmentCost +
      purposeTotals.operatingCost +
      purposeTotals.otherUnlinkedCost
  );

  return {
    recognizedSpendTotal: purposeTotals.recognizedSpendTotal,
    purposeTotals,
    categoryTotals,
    purposeCounts,
    legacyUnlinkedCount,
    reconciliationDelta: roundCurrency(purposeTotals.recognizedSpendTotal - purposeTotalSum)
  } satisfies ClassificationAuditSummary;
}

export function formatPurposeBucketLabel(bucket: OperationalPurposeBucket) {
  if (bucket === "BREAKDOWN_COST") {
    return "Breakdown Cost";
  }
  if (bucket === "MAINTENANCE_COST") {
    return "Maintenance Cost";
  }
  if (bucket === "STOCK_REPLENISHMENT") {
    return "Stock Replenishment";
  }
  if (bucket === "OPERATING_COST") {
    return "Operating Cost";
  }
  return "Other / Unlinked";
}

function summarizeMovementSummary(movementRows: ApprovedMovementRowInput[]) {
  if (movementRows.length === 0) {
    return null;
  }
  const counts = movementRows.reduce(
    (acc, movementRow) => {
      if (movementRow.movementType === "IN") acc.in += 1;
      if (movementRow.movementType === "OUT") acc.out += 1;
      if (movementRow.movementType === "ADJUSTMENT") acc.adjustment += 1;
      if (movementRow.movementType === "TRANSFER") acc.transfer += 1;
      return acc;
    },
    { in: 0, out: 0, adjustment: 0, transfer: 0 }
  );
  const parts: string[] = [];
  if (counts.out > 0) parts.push(`OUT×${counts.out}`);
  if (counts.in > 0) parts.push(`IN×${counts.in}`);
  if (counts.adjustment > 0) parts.push(`ADJUSTMENT×${counts.adjustment}`);
  if (counts.transfer > 0) parts.push(`TRANSFER×${counts.transfer}`);
  return parts.length > 0 ? `Movements ${parts.join(" • ")}` : null;
}
