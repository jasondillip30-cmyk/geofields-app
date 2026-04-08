import { NextResponse, type NextRequest } from "next/server";

import { requireApiPermission } from "@/lib/auth/api-guard";
import {
  calculatePercent,
  COST_SPENDING_CATEGORY_LABELS,
  type CostByMaintenanceRequestRow,
  type CostByProjectRow,
  type CostByRigRow,
  type CostTrackingSummaryPayload,
  buildTrendBucketKey,
  formatTrendBucketLabel,
  nullableFilter,
  parseDateOrNull,
  resolveTrendGranularity,
  roundCurrency
} from "@/lib/cost-tracking";
import { debugLog } from "@/lib/observability";
import { prisma } from "@/lib/prisma";
import { buildRecognizedSpendContext } from "@/lib/recognized-spend-context";

const UNASSIGNED_RIG_ID = "__unassigned_rig__";
const UNASSIGNED_RIG_NAME = "Unassigned Rig";
const UNASSIGNED_PROJECT_ID = "__unassigned_project__";
const UNASSIGNED_PROJECT_NAME = "Unassigned Project";

interface RigAccumulator {
  id: string;
  name: string;
  totalRecognizedCost: number;
  maintenanceCost: number;
  inventoryPartsCost: number;
  otherExpenseCost: number;
}

interface ProjectAccumulator {
  id: string;
  name: string;
  totalRecognizedCost: number;
  maintenanceLinkedCost: number;
  inventoryPurchaseCost: number;
  expenseOnlyCost: number;
}

interface MaintenanceBreakdownAccumulator {
  key: string;
  type: "MAINTENANCE" | "BREAKDOWN";
  id: string;
  totalLinkedCost: number;
  linkedPurchaseCount: number;
  rigId: string | null;
}

interface TrendAccumulator {
  bucketStart: string;
  totalRecognizedCost: number;
  maintenanceCost: number;
  inventoryCost: number;
  nonInventoryCost: number;
}

export async function GET(request: NextRequest) {
  const auth = await requireApiPermission(request, "finance:view");
  if (!auth.ok) {
    return auth.response;
  }

  const rawClientId = nullableFilter(request.nextUrl.searchParams.get("clientId"));
  const rawRigId = nullableFilter(request.nextUrl.searchParams.get("rigId"));
  const projectId = nullableFilter(request.nextUrl.searchParams.get("projectId"));
  const clientId = projectId ? null : rawClientId;
  const rigId = projectId ? null : rawRigId;
  const fromDate = parseDateOrNull(request.nextUrl.searchParams.get("from"));
  const toDate = parseDateOrNull(request.nextUrl.searchParams.get("to"), true);

  const spendContext = await buildRecognizedSpendContext({
    clientId,
    rigId,
    projectId,
    fromDate,
    toDate
  });

  const rawExpenses = spendContext.rawExpenses;
  const expenses = spendContext.recognizedExpenses;
  const maintenanceRequests = spendContext.maintenanceRequests;
  const classifiedRows = spendContext.classifiedRows;
  const purposeTotals = spendContext.purposeTotals;
  const categoryTotals = spendContext.categoryTotals;
  const classificationAudit = spendContext.classificationAudit;

  const maintenanceRequestMap = new Map(maintenanceRequests.map((entry) => [entry.id, entry]));
  const breakdownIds = new Set<string>();
  for (const row of classifiedRows) {
    if (row.breakdownReportId) {
      breakdownIds.add(row.breakdownReportId);
    }
  }
  for (const maintenanceRequest of maintenanceRequests) {
    if (maintenanceRequest.breakdownReportId) {
      breakdownIds.add(maintenanceRequest.breakdownReportId);
    }
  }

  const breakdownRows = breakdownIds.size
    ? await prisma.breakdownReport.findMany({
        where: { id: { in: Array.from(breakdownIds) } },
        select: {
          id: true,
          title: true,
          severity: true,
          status: true,
          rig: { select: { rigCode: true } }
        }
      })
    : [];
  const breakdownById = new Map(breakdownRows.map((entry) => [entry.id, entry]));

  const linkedProjectIds = Array.from(
    new Set(classifiedRows.map((entry) => entry.linkedProjectId).filter((value): value is string => Boolean(value)))
  );
  const linkedRigIds = Array.from(
    new Set(classifiedRows.map((entry) => entry.linkedRigId).filter((value): value is string => Boolean(value)))
  );
  const [linkedProjects, linkedRigs] = await Promise.all([
    linkedProjectIds.length
      ? prisma.project.findMany({
          where: { id: { in: linkedProjectIds } },
          select: { id: true, name: true }
        })
      : Promise.resolve([]),
    linkedRigIds.length
      ? prisma.rig.findMany({
          where: { id: { in: linkedRigIds } },
          select: { id: true, rigCode: true }
        })
      : Promise.resolve([])
  ]);
  const projectNameById = new Map(linkedProjects.map((entry) => [entry.id, entry.name]));
  const rigCodeById = new Map(linkedRigs.map((entry) => [entry.id, entry.rigCode]));

  const rigMap = new Map<string, RigAccumulator>();
  const projectMap = new Map<string, ProjectAccumulator>();
  const maintenanceBreakdownMap = new Map<string, MaintenanceBreakdownAccumulator>();
  const trendMap = new Map<string, TrendAccumulator>();

  const trendGranularity = resolveTrendGranularity({
    fromDate,
    toDate,
    dates: classifiedRows
      .map((entry) => new Date(entry.date))
      .filter((entry) => !Number.isNaN(entry.getTime()))
  });

  for (const row of classifiedRows) {
    const rigKey = row.linkedRigId || UNASSIGNED_RIG_ID;
    const rigName = row.linkedRigId ? rigCodeById.get(row.linkedRigId) || row.linkedRigId : UNASSIGNED_RIG_NAME;
    const rigEntry = rigMap.get(rigKey) || {
      id: rigKey,
      name: rigName,
      totalRecognizedCost: 0,
      maintenanceCost: 0,
      inventoryPartsCost: 0,
      otherExpenseCost: 0
    };
    rigEntry.totalRecognizedCost += row.amount;
    if (row.purposeBucket === "MAINTENANCE_COST" || row.purposeBucket === "BREAKDOWN_COST") {
      rigEntry.maintenanceCost += row.amount;
    } else if (row.purposeBucket === "STOCK_REPLENISHMENT") {
      rigEntry.inventoryPartsCost += row.amount;
    } else {
      rigEntry.otherExpenseCost += row.amount;
    }
    rigMap.set(rigKey, rigEntry);

    const projectKey = row.linkedProjectId || UNASSIGNED_PROJECT_ID;
    const projectName = row.linkedProjectId
      ? projectNameById.get(row.linkedProjectId) || row.linkedProjectId
      : UNASSIGNED_PROJECT_NAME;
    const projectEntry = projectMap.get(projectKey) || {
      id: projectKey,
      name: projectName,
      totalRecognizedCost: 0,
      maintenanceLinkedCost: 0,
      inventoryPurchaseCost: 0,
      expenseOnlyCost: 0
    };
    projectEntry.totalRecognizedCost += row.amount;
    if (row.purposeBucket === "MAINTENANCE_COST" || row.purposeBucket === "BREAKDOWN_COST") {
      projectEntry.maintenanceLinkedCost += row.amount;
    } else if (row.purposeBucket === "STOCK_REPLENISHMENT") {
      projectEntry.inventoryPurchaseCost += row.amount;
    } else {
      projectEntry.expenseOnlyCost += row.amount;
    }
    projectMap.set(projectKey, projectEntry);

    if (row.breakdownReportId) {
      const key = `breakdown:${row.breakdownReportId}`;
      const existing = maintenanceBreakdownMap.get(key) || {
        key,
        type: "BREAKDOWN" as const,
        id: row.breakdownReportId,
        totalLinkedCost: 0,
        linkedPurchaseCount: 0,
        rigId: row.linkedRigId || null
      };
      existing.totalLinkedCost += row.amount;
      existing.linkedPurchaseCount += 1;
      if (!existing.rigId && row.linkedRigId) {
        existing.rigId = row.linkedRigId;
      }
      maintenanceBreakdownMap.set(key, existing);
    } else if (row.maintenanceRequestId) {
      const key = `maintenance:${row.maintenanceRequestId}`;
      const existing = maintenanceBreakdownMap.get(key) || {
        key,
        type: "MAINTENANCE" as const,
        id: row.maintenanceRequestId,
        totalLinkedCost: 0,
        linkedPurchaseCount: 0,
        rigId: row.linkedRigId || null
      };
      existing.totalLinkedCost += row.amount;
      existing.linkedPurchaseCount += 1;
      if (!existing.rigId && row.linkedRigId) {
        existing.rigId = row.linkedRigId;
      }
      maintenanceBreakdownMap.set(key, existing);
    }

    const parsedDate = new Date(row.date);
    if (!Number.isNaN(parsedDate.getTime())) {
      const trendKey = buildTrendBucketKey(parsedDate, trendGranularity);
      const trendEntry = trendMap.get(trendKey) || {
        bucketStart: trendKey,
        totalRecognizedCost: 0,
        maintenanceCost: 0,
        inventoryCost: 0,
        nonInventoryCost: 0
      };
      trendEntry.totalRecognizedCost += row.amount;
      if (row.purposeBucket === "MAINTENANCE_COST" || row.purposeBucket === "BREAKDOWN_COST") {
        trendEntry.maintenanceCost += row.amount;
      } else if (row.purposeBucket === "STOCK_REPLENISHMENT") {
        trendEntry.inventoryCost += row.amount;
      } else {
        trendEntry.nonInventoryCost += row.amount;
      }
      trendMap.set(trendKey, trendEntry);
    }
  }

  const totalRecognizedSpend = purposeTotals.recognizedSpendTotal;
  const totalMaintenanceRelatedCost = roundCurrency(
    purposeTotals.breakdownCost + purposeTotals.maintenanceCost
  );
  const totalInventoryRelatedCost = purposeTotals.stockReplenishmentCost;
  const totalNonInventoryExpenseCost = roundCurrency(
    purposeTotals.operatingCost + purposeTotals.otherUnlinkedCost
  );

  const costByRig: CostByRigRow[] = Array.from(rigMap.values())
    .map((entry) => ({
      id: entry.id,
      name: entry.name,
      totalRecognizedCost: roundCurrency(entry.totalRecognizedCost),
      maintenanceCost: roundCurrency(entry.maintenanceCost),
      inventoryPartsCost: roundCurrency(entry.inventoryPartsCost),
      otherExpenseCost: roundCurrency(entry.otherExpenseCost),
      percentOfTotalSpend: calculatePercent(entry.totalRecognizedCost, totalRecognizedSpend)
    }))
    .sort((a, b) => b.totalRecognizedCost - a.totalRecognizedCost);

  const costByProject: CostByProjectRow[] = Array.from(projectMap.values())
    .map((entry) => ({
      id: entry.id,
      name: entry.name,
      totalRecognizedCost: roundCurrency(entry.totalRecognizedCost),
      maintenanceLinkedCost: roundCurrency(entry.maintenanceLinkedCost),
      inventoryPurchaseCost: roundCurrency(entry.inventoryPurchaseCost),
      expenseOnlyCost: roundCurrency(entry.expenseOnlyCost),
      percentOfTotalSpend: calculatePercent(entry.totalRecognizedCost, totalRecognizedSpend)
    }))
    .sort((a, b) => b.totalRecognizedCost - a.totalRecognizedCost);

  const costByMaintenanceRequest: CostByMaintenanceRequestRow[] = Array.from(
    maintenanceBreakdownMap.values()
  )
    .map((entry) => {
      if (entry.type === "BREAKDOWN") {
        const breakdown = breakdownById.get(entry.id);
        return {
          id: entry.id,
          reference: breakdown?.title ? `Breakdown: ${breakdown.title}` : `Breakdown ${entry.id.slice(-6).toUpperCase()}`,
          rigName:
            (entry.rigId ? rigCodeById.get(entry.rigId) : null) ||
            breakdown?.rig?.rigCode ||
            UNASSIGNED_RIG_NAME,
          totalLinkedCost: roundCurrency(entry.totalLinkedCost),
          linkedPurchaseCount: entry.linkedPurchaseCount,
          urgency: breakdown?.severity || null,
          status: breakdown?.status || "OPEN"
        };
      }

      const maintenance = maintenanceRequestMap.get(entry.id);
      return {
        id: entry.id,
        reference: maintenance?.requestCode || `Maintenance ${entry.id.slice(-6).toUpperCase()}`,
        rigName:
          (entry.rigId ? rigCodeById.get(entry.rigId) : null) ||
          maintenance?.rig?.rigCode ||
          UNASSIGNED_RIG_NAME,
        totalLinkedCost: roundCurrency(entry.totalLinkedCost),
        linkedPurchaseCount: entry.linkedPurchaseCount,
        urgency: maintenance?.urgency || null,
        status: maintenance?.status || null
      };
    })
    .sort((a, b) => b.totalLinkedCost - a.totalLinkedCost);

  const spendingCategoryBreakdown = (
    Object.keys(COST_SPENDING_CATEGORY_LABELS) as Array<keyof typeof COST_SPENDING_CATEGORY_LABELS>
  )
    .map((key) => {
      const totalCost = categoryTotals[key] || 0;
      return {
        key,
        label: COST_SPENDING_CATEGORY_LABELS[key],
        totalCost: roundCurrency(totalCost),
        percentOfTotalSpend: calculatePercent(totalCost, totalRecognizedSpend)
      };
    })
    .sort((a, b) => b.totalCost - a.totalCost);

  const costTrend = Array.from(trendMap.values())
    .sort((a, b) => a.bucketStart.localeCompare(b.bucketStart))
    .map((entry) => ({
      bucketStart: entry.bucketStart,
      label: formatTrendBucketLabel(entry.bucketStart, trendGranularity),
      totalRecognizedCost: roundCurrency(entry.totalRecognizedCost),
      maintenanceCost: roundCurrency(entry.maintenanceCost),
      inventoryCost: roundCurrency(entry.inventoryCost),
      nonInventoryCost: roundCurrency(entry.nonInventoryCost)
    }));

  const highestCostRig = costByRig.find((entry) => entry.id !== UNASSIGNED_RIG_ID) || costByRig[0] || null;
  const highestCostProject =
    costByProject.find((entry) => entry.id !== UNASSIGNED_PROJECT_ID) || costByProject[0] || null;

  const response: CostTrackingSummaryPayload = {
    filters: {
      projectId: projectId || "all",
      clientId: clientId || "all",
      rigId: rigId || "all",
      from: request.nextUrl.searchParams.get("from"),
      to: request.nextUrl.searchParams.get("to")
    },
    overview: {
      totalRecognizedSpend: roundCurrency(totalRecognizedSpend),
      totalMaintenanceRelatedCost: roundCurrency(totalMaintenanceRelatedCost),
      totalInventoryRelatedCost: roundCurrency(totalInventoryRelatedCost),
      totalNonInventoryExpenseCost: roundCurrency(totalNonInventoryExpenseCost),
      highestCostRig: highestCostRig
        ? {
            id: highestCostRig.id,
            name: highestCostRig.name,
            totalRecognizedCost: highestCostRig.totalRecognizedCost
          }
        : null,
      highestCostProject: highestCostProject
        ? {
            id: highestCostProject.id,
            name: highestCostProject.name,
            totalRecognizedCost: highestCostProject.totalRecognizedCost
          }
        : null
    },
    trendGranularity,
    costByRig,
    costByProject,
    costByMaintenanceRequest,
    spendingCategoryBreakdown,
    costTrend,
    classificationAudit
  };

  debugLog(
    "[cost-tracking][summary]",
    {
      filters: response.filters,
      approvedExpenseCount: rawExpenses.length,
      recognizedExpenseCount: expenses.length,
      recognition: spendContext.recognitionStats,
      totalRecognizedSpend: response.overview.totalRecognizedSpend,
      purposeTotals: classificationAudit.purposeTotals,
      legacyUnlinkedCount: classificationAudit.legacyUnlinkedCount,
      reconciliationDelta: classificationAudit.reconciliationDelta
    },
    { channel: "finance" }
  );

  return NextResponse.json(response);
}
