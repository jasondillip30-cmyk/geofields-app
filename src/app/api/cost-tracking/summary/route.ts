import type { Prisma } from "@prisma/client";
import { NextResponse, type NextRequest } from "next/server";

import { requireApiPermission } from "@/lib/auth/api-guard";
import {
  calculatePercent,
  COST_SPENDING_CATEGORY_LABELS,
  deriveCostSpendType,
  deriveSpendingCategory,
  type CostByMaintenanceRequestRow,
  type CostByProjectRow,
  type CostByRigRow,
  type CostTrackingSummaryPayload,
  formatTrendBucketLabel,
  buildTrendBucketKey,
  nullableFilter,
  parseDateOrNull,
  resolveTrendGranularity,
  roundCurrency
} from "@/lib/cost-tracking";
import { withFinancialExpenseApproval } from "@/lib/financial-approval-policy";
import { prisma } from "@/lib/prisma";
import { parseReceiptSubmissionPayload } from "@/lib/receipt-intake-submission";
import type { ReceiptSpendTag } from "@/lib/receipt-approval-classification";

const RECEIPT_SUBMISSION_REPORT_TYPE = "INVENTORY_RECEIPT_SUBMISSION";
const UNASSIGNED_RIG_ID = "__unassigned_rig__";
const UNASSIGNED_RIG_NAME = "Unassigned Rig";
const UNASSIGNED_PROJECT_ID = "__unassigned_project__";
const UNASSIGNED_PROJECT_NAME = "Unassigned Project";

interface RigAccumulator {
  id: string;
  name: string;
  totalApprovedCost: number;
  maintenanceCost: number;
  inventoryPartsCost: number;
  otherExpenseCost: number;
}

interface ProjectAccumulator {
  id: string;
  name: string;
  totalApprovedCost: number;
  maintenanceLinkedCost: number;
  inventoryPurchaseCost: number;
  expenseOnlyCost: number;
}

interface MaintenanceAccumulator {
  id: string;
  totalLinkedCost: number;
  linkedPurchaseCount: number;
}

interface TrendAccumulator {
  bucketStart: string;
  totalApprovedCost: number;
  maintenanceCost: number;
  inventoryCost: number;
  nonInventoryCost: number;
}

interface MovementExpenseContext {
  maintenanceRequestIds: Set<string>;
}

interface ReceiptExpenseContext {
  tag: ReceiptSpendTag | null;
  maintenanceRequestId: string | null;
}

export async function GET(request: NextRequest) {
  const auth = await requireApiPermission(request, "finance:view");
  if (!auth.ok) {
    return auth.response;
  }

  const clientId = nullableFilter(request.nextUrl.searchParams.get("clientId"));
  const rigId = nullableFilter(request.nextUrl.searchParams.get("rigId"));
  const fromDate = parseDateOrNull(request.nextUrl.searchParams.get("from"));
  const toDate = parseDateOrNull(request.nextUrl.searchParams.get("to"), true);

  const where: Prisma.ExpenseWhereInput = withFinancialExpenseApproval({
    ...(clientId ? { clientId } : {}),
    ...(rigId ? { rigId } : {}),
    ...(fromDate || toDate
      ? {
          date: {
            ...(fromDate ? { gte: fromDate } : {}),
            ...(toDate ? { lte: toDate } : {})
          }
        }
      : {})
  });

  const expenses = await prisma.expense.findMany({
    where,
    orderBy: [{ date: "asc" }, { createdAt: "asc" }],
    include: {
      rig: { select: { id: true, rigCode: true } },
      project: { select: { id: true, name: true } }
    }
  });

  const expenseIds = expenses.map((entry) => entry.id);
  const expenseIdSet = new Set(expenseIds);
  const [movements, receiptSubmissionRows] = await Promise.all([
    expenseIds.length
      ? prisma.inventoryMovement.findMany({
          where: { expenseId: { in: expenseIds } },
          select: {
            expenseId: true,
            maintenanceRequestId: true
          }
        })
      : Promise.resolve([]),
    prisma.summaryReport.findMany({
      where: {
        reportType: RECEIPT_SUBMISSION_REPORT_TYPE,
        ...(clientId ? { clientId } : {})
      },
      select: {
        payloadJson: true
      }
    })
  ]);

  const movementContextByExpenseId = new Map<string, MovementExpenseContext>();
  for (const movement of movements) {
    if (!movement.expenseId) {
      continue;
    }
    const context = movementContextByExpenseId.get(movement.expenseId) || {
      maintenanceRequestIds: new Set<string>()
    };
    if (movement.maintenanceRequestId) {
      context.maintenanceRequestIds.add(movement.maintenanceRequestId);
    }
    movementContextByExpenseId.set(movement.expenseId, context);
  }

  const receiptContextByExpenseId = new Map<string, ReceiptExpenseContext>();
  for (const row of receiptSubmissionRows) {
    const parsed = parseReceiptSubmissionPayload(row.payloadJson);
    const mappedExpenseId = parsed?.resolution?.expenseId || "";
    if (!parsed || parsed.status !== "APPROVED" || !mappedExpenseId || !expenseIdSet.has(mappedExpenseId)) {
      continue;
    }
    receiptContextByExpenseId.set(mappedExpenseId, {
      tag: parsed.classification?.tag || null,
      maintenanceRequestId: parsed.normalizedDraft?.linkContext.maintenanceRequestId || null
    });
  }

  const maintenanceRequestIds = new Set<string>();
  for (const context of movementContextByExpenseId.values()) {
    for (const maintenanceRequestId of context.maintenanceRequestIds) {
      maintenanceRequestIds.add(maintenanceRequestId);
    }
  }
  for (const context of receiptContextByExpenseId.values()) {
    if (context.maintenanceRequestId) {
      maintenanceRequestIds.add(context.maintenanceRequestId);
    }
  }

  const maintenanceRequests = maintenanceRequestIds.size
    ? await prisma.maintenanceRequest.findMany({
        where: { id: { in: Array.from(maintenanceRequestIds) } },
        select: {
          id: true,
          requestCode: true,
          urgency: true,
          status: true,
          rig: {
            select: {
              rigCode: true
            }
          }
        }
      })
    : [];
  const maintenanceRequestMap = new Map(maintenanceRequests.map((entry) => [entry.id, entry]));

  const trendGranularity = resolveTrendGranularity({
    fromDate,
    toDate,
    dates: expenses.map((entry) => entry.date)
  });

  const rigMap = new Map<string, RigAccumulator>();
  const projectMap = new Map<string, ProjectAccumulator>();
  const maintenanceMap = new Map<string, MaintenanceAccumulator>();
  const trendMap = new Map<string, TrendAccumulator>();
  const spendingCategoryTotals = new Map<keyof typeof COST_SPENDING_CATEGORY_LABELS, number>();
  (Object.keys(COST_SPENDING_CATEGORY_LABELS) as Array<keyof typeof COST_SPENDING_CATEGORY_LABELS>).forEach((key) =>
    spendingCategoryTotals.set(key, 0)
  );

  let totalApprovedExpenses = 0;
  let totalMaintenanceRelatedCost = 0;
  let totalInventoryRelatedCost = 0;
  let totalNonInventoryExpenseCost = 0;

  for (const expense of expenses) {
    totalApprovedExpenses += expense.amount;
    const movementContext = movementContextByExpenseId.get(expense.id);
    const receiptContext = receiptContextByExpenseId.get(expense.id);

    const linkedMaintenanceRequestIds = new Set<string>();
    if (receiptContext?.maintenanceRequestId) {
      linkedMaintenanceRequestIds.add(receiptContext.maintenanceRequestId);
    }
    for (const maintenanceRequestId of movementContext?.maintenanceRequestIds || []) {
      linkedMaintenanceRequestIds.add(maintenanceRequestId);
    }

    const validLinkedMaintenanceRequestIds = Array.from(linkedMaintenanceRequestIds).filter((maintenanceRequestId) => {
      const linkedRequest = maintenanceRequestMap.get(maintenanceRequestId);
      return linkedRequest ? linkedRequest.status !== "DENIED" : true;
    });

    const spendType = deriveCostSpendType({
      receiptTag: receiptContext?.tag || null,
      hasInventoryMovement: Boolean(movementContext),
      hasMaintenanceLink: validLinkedMaintenanceRequestIds.length > 0,
      entrySource: expense.entrySource,
      category: expense.category,
      subcategory: expense.subcategory,
      notes: expense.notes
    });

    if (spendType === "MAINTENANCE") {
      totalMaintenanceRelatedCost += expense.amount;
    } else if (spendType === "INVENTORY") {
      totalInventoryRelatedCost += expense.amount;
    } else {
      totalNonInventoryExpenseCost += expense.amount;
    }

    const spendingCategory = deriveSpendingCategory({
      spendType,
      category: expense.category,
      subcategory: expense.subcategory,
      notes: expense.notes
    });
    spendingCategoryTotals.set(
      spendingCategory,
      (spendingCategoryTotals.get(spendingCategory) || 0) + expense.amount
    );

    const rigKey = expense.rigId || UNASSIGNED_RIG_ID;
    const rigName = expense.rig?.rigCode || UNASSIGNED_RIG_NAME;
    const rigEntry = rigMap.get(rigKey) || {
      id: rigKey,
      name: rigName,
      totalApprovedCost: 0,
      maintenanceCost: 0,
      inventoryPartsCost: 0,
      otherExpenseCost: 0
    };
    rigEntry.totalApprovedCost += expense.amount;
    if (spendType === "MAINTENANCE") {
      rigEntry.maintenanceCost += expense.amount;
    } else if (spendType === "INVENTORY") {
      rigEntry.inventoryPartsCost += expense.amount;
    } else {
      rigEntry.otherExpenseCost += expense.amount;
    }
    rigMap.set(rigKey, rigEntry);

    const projectKey = expense.projectId || UNASSIGNED_PROJECT_ID;
    const projectName = expense.project?.name || UNASSIGNED_PROJECT_NAME;
    const projectEntry = projectMap.get(projectKey) || {
      id: projectKey,
      name: projectName,
      totalApprovedCost: 0,
      maintenanceLinkedCost: 0,
      inventoryPurchaseCost: 0,
      expenseOnlyCost: 0
    };
    projectEntry.totalApprovedCost += expense.amount;
    if (spendType === "MAINTENANCE") {
      projectEntry.maintenanceLinkedCost += expense.amount;
    } else if (spendType === "INVENTORY") {
      projectEntry.inventoryPurchaseCost += expense.amount;
    } else {
      projectEntry.expenseOnlyCost += expense.amount;
    }
    projectMap.set(projectKey, projectEntry);

    if (validLinkedMaintenanceRequestIds.length > 0) {
      const apportionedAmount = expense.amount / validLinkedMaintenanceRequestIds.length;
      for (const maintenanceRequestId of validLinkedMaintenanceRequestIds) {
        const maintenanceEntry = maintenanceMap.get(maintenanceRequestId) || {
          id: maintenanceRequestId,
          totalLinkedCost: 0,
          linkedPurchaseCount: 0
        };
        maintenanceEntry.totalLinkedCost += apportionedAmount;
        maintenanceEntry.linkedPurchaseCount += 1;
        maintenanceMap.set(maintenanceRequestId, maintenanceEntry);
      }
    }

    const trendKey = buildTrendBucketKey(expense.date, trendGranularity);
    const trendEntry = trendMap.get(trendKey) || {
      bucketStart: trendKey,
      totalApprovedCost: 0,
      maintenanceCost: 0,
      inventoryCost: 0,
      nonInventoryCost: 0
    };
    trendEntry.totalApprovedCost += expense.amount;
    if (spendType === "MAINTENANCE") {
      trendEntry.maintenanceCost += expense.amount;
    } else if (spendType === "INVENTORY") {
      trendEntry.inventoryCost += expense.amount;
    } else {
      trendEntry.nonInventoryCost += expense.amount;
    }
    trendMap.set(trendKey, trendEntry);
  }

  const costByRig: CostByRigRow[] = Array.from(rigMap.values())
    .map((entry) => ({
      id: entry.id,
      name: entry.name,
      totalApprovedCost: roundCurrency(entry.totalApprovedCost),
      maintenanceCost: roundCurrency(entry.maintenanceCost),
      inventoryPartsCost: roundCurrency(entry.inventoryPartsCost),
      otherExpenseCost: roundCurrency(entry.otherExpenseCost),
      percentOfTotalSpend: calculatePercent(entry.totalApprovedCost, totalApprovedExpenses)
    }))
    .sort((a, b) => b.totalApprovedCost - a.totalApprovedCost);

  const costByProject: CostByProjectRow[] = Array.from(projectMap.values())
    .map((entry) => ({
      id: entry.id,
      name: entry.name,
      totalApprovedCost: roundCurrency(entry.totalApprovedCost),
      maintenanceLinkedCost: roundCurrency(entry.maintenanceLinkedCost),
      inventoryPurchaseCost: roundCurrency(entry.inventoryPurchaseCost),
      expenseOnlyCost: roundCurrency(entry.expenseOnlyCost),
      percentOfTotalSpend: calculatePercent(entry.totalApprovedCost, totalApprovedExpenses)
    }))
    .sort((a, b) => b.totalApprovedCost - a.totalApprovedCost);

  const costByMaintenanceRequest: CostByMaintenanceRequestRow[] = Array.from(maintenanceMap.values())
    .map((entry) => {
      const request = maintenanceRequestMap.get(entry.id);
      return {
        id: entry.id,
        reference: request?.requestCode || entry.id,
        rigName: request?.rig?.rigCode || UNASSIGNED_RIG_NAME,
        totalLinkedCost: roundCurrency(entry.totalLinkedCost),
        linkedPurchaseCount: entry.linkedPurchaseCount,
        urgency: request?.urgency || null,
        status: request?.status || null
      };
    })
    .sort((a, b) => b.totalLinkedCost - a.totalLinkedCost);

  const spendingCategoryBreakdown = (Object.keys(COST_SPENDING_CATEGORY_LABELS) as Array<keyof typeof COST_SPENDING_CATEGORY_LABELS>)
    .map((key) => {
      const totalCost = spendingCategoryTotals.get(key) || 0;
      return {
        key,
        label: COST_SPENDING_CATEGORY_LABELS[key],
        totalCost: roundCurrency(totalCost),
        percentOfTotalSpend: calculatePercent(totalCost, totalApprovedExpenses)
      };
    })
    .sort((a, b) => b.totalCost - a.totalCost);

  const costTrend = Array.from(trendMap.values())
    .sort((a, b) => a.bucketStart.localeCompare(b.bucketStart))
    .map((entry) => ({
      bucketStart: entry.bucketStart,
      label: formatTrendBucketLabel(entry.bucketStart, trendGranularity),
      totalApprovedCost: roundCurrency(entry.totalApprovedCost),
      maintenanceCost: roundCurrency(entry.maintenanceCost),
      inventoryCost: roundCurrency(entry.inventoryCost),
      nonInventoryCost: roundCurrency(entry.nonInventoryCost)
    }));

  const highestCostRig = costByRig.find((entry) => entry.id !== UNASSIGNED_RIG_ID) || costByRig[0] || null;
  const highestCostProject =
    costByProject.find((entry) => entry.id !== UNASSIGNED_PROJECT_ID) || costByProject[0] || null;

  const response: CostTrackingSummaryPayload = {
    filters: {
      clientId: clientId || "all",
      rigId: rigId || "all",
      from: request.nextUrl.searchParams.get("from"),
      to: request.nextUrl.searchParams.get("to")
    },
    overview: {
      totalApprovedExpenses: roundCurrency(totalApprovedExpenses),
      totalMaintenanceRelatedCost: roundCurrency(totalMaintenanceRelatedCost),
      totalInventoryRelatedCost: roundCurrency(totalInventoryRelatedCost),
      totalNonInventoryExpenseCost: roundCurrency(totalNonInventoryExpenseCost),
      highestCostRig: highestCostRig
        ? {
            id: highestCostRig.id,
            name: highestCostRig.name,
            totalApprovedCost: highestCostRig.totalApprovedCost
          }
        : null,
      highestCostProject: highestCostProject
        ? {
            id: highestCostProject.id,
            name: highestCostProject.name,
            totalApprovedCost: highestCostProject.totalApprovedCost
          }
        : null
    },
    trendGranularity,
    costByRig,
    costByProject,
    costByMaintenanceRequest,
    spendingCategoryBreakdown,
    costTrend
  };

  if (process.env.NODE_ENV !== "production") {
    console.info("[cost-tracking][summary]", {
      filters: response.filters,
      approvedExpenseCount: expenses.length,
      totalApprovedExpenses: response.overview.totalApprovedExpenses
    });
  }

  return NextResponse.json(response);
}
