import type { Prisma } from "@prisma/client";
import { NextResponse, type NextRequest } from "next/server";

import { logLegacyFinanceApiUsage, withLegacyFinanceDeprecationHeaders } from "@/lib/api-deprecation";
import { requireApiPermission } from "@/lib/auth/api-guard";
import { withFinancialDrillReportApproval } from "@/lib/financial-approval-policy";
import { debugLog } from "@/lib/observability";
import { prisma } from "@/lib/prisma";
import { buildRecognizedSpendContext } from "@/lib/recognized-spend-context";
import { resolveSpendingMovementCategory } from "@/lib/spending-expense-category";

interface AggregateRowBase {
  id: string;
  name: string;
  revenue: number;
  expenses: number;
}

interface AggregateRow extends AggregateRowBase {
  profit: number;
  margin: number;
}

interface TrendRow {
  revenue: number;
  expenses: number;
  profit: number;
}

type CostGroupKey = "fuel" | "salaries" | "maintenance" | "consumables" | "other";
type ExpenseStatusKey = "DRAFT" | "SUBMITTED" | "APPROVED" | "REJECTED";

interface RigCostBreakdown {
  id: string;
  name: string;
  fuel: number;
  salaries: number;
  maintenance: number;
  consumables: number;
  other: number;
  totalExpenses: number;
}

interface PurposeSummary {
  totalRecognizedSpend: number;
  breakdownCost: number;
  maintenanceCost: number;
  stockReplenishmentCost: number;
  operatingCost: number;
  otherUnlinkedCost: number;
}

const UNASSIGNED_CLIENT_ID = "__unassigned_client__";
const UNASSIGNED_PROJECT_ID = "__unassigned_project__";
const UNASSIGNED_RIG_ID = "__unassigned_rig__";
const UNASSIGNED_CLIENT_NAME = "Unassigned Client";
const UNASSIGNED_PROJECT_NAME = "Unassigned Project";
const UNASSIGNED_RIG_NAME = "Unassigned Rig";

export async function GET(request: NextRequest) {
  const auth = await requireApiPermission(request, "finance:view");
  if (!auth.ok) {
    return auth.response;
  }
  logLegacyFinanceApiUsage("/api/profit/summary");

  const rawClientId = nullableFilter(request.nextUrl.searchParams.get("clientId"));
  const rawRigId = nullableFilter(request.nextUrl.searchParams.get("rigId"));
  const projectId = nullableFilter(request.nextUrl.searchParams.get("projectId"));
  const clientId = projectId ? null : rawClientId;
  const rigId = projectId ? null : rawRigId;
  const fromDate = parseDateOrNull(request.nextUrl.searchParams.get("from"));
  const toDate = parseDateOrNull(request.nextUrl.searchParams.get("to"), true);
  const appliedFilters = {
    from: fromDate ? fromDate.toISOString() : null,
    to: toDate ? toDate.toISOString() : null,
    projectId: projectId || "all",
    clientId: clientId || "all",
    rigId: rigId || "all"
  };

  const drillWhere: Prisma.DrillReportWhereInput = withFinancialDrillReportApproval({
    ...(projectId ? { projectId } : {}),
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

  const [reports, spendContext, expenseMovements] = await Promise.all([
    prisma.drillReport.findMany({
      where: drillWhere,
      orderBy: [{ date: "asc" }, { createdAt: "asc" }],
      include: {
        client: { select: { id: true, name: true } },
        project: { select: { id: true, name: true } },
        rig: { select: { id: true, rigCode: true } }
      }
    }),
    buildRecognizedSpendContext({
      clientId,
      rigId,
      projectId,
      fromDate,
      toDate
    }),
    prisma.inventoryMovement.findMany({
      where: {
        movementType: "OUT",
        expenseId: {
          not: null
        },
        ...(projectId ? { projectId } : {}),
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
      },
      orderBy: [{ date: "asc" }, { createdAt: "asc" }],
      select: {
        id: true,
        date: true,
        totalCost: true,
        contextType: true,
        clientId: true,
        projectId: true,
        rigId: true,
        client: { select: { name: true } },
        project: { select: { name: true } },
        rig: { select: { rigCode: true } },
        item: {
          select: {
            category: true
          }
        }
      }
    })
  ]);
  const recognizedExpenses = spendContext.recognizedExpenses;
  const usageExpenses = expenseMovements.map((movement) => ({
    id: movement.id,
    amount: safeNumber(movement.totalCost),
    date: movement.date,
    contextType: movement.contextType,
    category: normalizeExpenseCategory(
      resolveSpendingMovementCategory({
        itemCategory: movement.item?.category,
        fallbackCategory: "Uncategorized"
      })
    ),
    clientId: movement.clientId || null,
    projectId: movement.projectId || null,
    rigId: movement.rigId || null,
    clientName: movement.client?.name || null,
    projectName: movement.project?.name || null,
    rigName: movement.rig?.rigCode || null
  }));
  const recognizedExpenseResult = {
    stats: spendContext.recognitionStats
  };
  const purposeTotals = spendContext.purposeTotals;
  const usagePurposeSummary = buildUsagePurposeSummary(usageExpenses);
  const recognizedPurposeSummary = normalizeRecognizedPurposeSummary(purposeTotals);
  const classificationAudit = spendContext.classificationAudit;

  const trendGranularity = resolveTrendGranularity({
    fromDate,
    toDate,
    reportDates: reports.map((entry) => entry.date),
    expenseDates: usageExpenses.map((entry) => entry.date)
  });

  const trendMap = new Map<string, TrendRow>();
  const clientMap = new Map<string, AggregateRowBase>();
  const projectMap = new Map<string, AggregateRowBase>();
  const rigMap = new Map<string, AggregateRowBase>();
  const expenseCategoryMap = new Map<string, number>();
  const expenseStatusCounts: Record<ExpenseStatusKey, number> = {
    DRAFT: 0,
    SUBMITTED: 0,
    APPROVED: 0,
    REJECTED: 0
  };
  const costGroupTotals: Record<CostGroupKey, number> = {
    fuel: 0,
    salaries: 0,
    maintenance: 0,
    consumables: 0,
    other: 0
  };
  const rigCostBreakdownMap = new Map<string, RigCostBreakdown>();

  let totalRevenue = 0;
  for (const report of reports) {
    const revenue = report.billableAmount;
    totalRevenue += revenue;

    const trendKey = buildTrendKey(report.date, trendGranularity);
    const trend = trendMap.get(trendKey) || { revenue: 0, expenses: 0, profit: 0 };
    trend.revenue += revenue;
    trend.profit += revenue;
    trendMap.set(trendKey, trend);

    upsertAggregate(clientMap, report.clientId, report.client?.name || "Unknown Client", revenue, 0);
    upsertAggregate(projectMap, report.projectId, report.project?.name || "Unknown Project", revenue, 0);
    upsertAggregate(rigMap, report.rigId, report.rig?.rigCode || "Unknown Rig", revenue, 0);
  }

  let totalExpenses = 0;
  let approvedIntentAmount = 0;
  for (const expense of recognizedExpenses) {
    const status = expense.approvalStatus as ExpenseStatusKey;
    if (status in expenseStatusCounts) {
      expenseStatusCounts[status] += 1;
    }
    if (expense.approvalStatus === "APPROVED") {
      approvedIntentAmount += safeNumber(expense.amount);
    }
  }

  for (const expense of usageExpenses) {
    if (expense.amount <= 0) {
      continue;
    }
    totalExpenses += expense.amount;
    expenseCategoryMap.set(expense.category, (expenseCategoryMap.get(expense.category) || 0) + expense.amount);
    const costGroup = classifyCostGroup(expense.category, null, expense.contextType);
    costGroupTotals[costGroup] += expense.amount;

    const trendKey = buildTrendKey(expense.date, trendGranularity);
    const trend = trendMap.get(trendKey) || { revenue: 0, expenses: 0, profit: 0 };
    trend.expenses += expense.amount;
    trend.profit -= expense.amount;
    trendMap.set(trendKey, trend);

    const aggregateClientId = expense.clientId || UNASSIGNED_CLIENT_ID;
    const aggregateProjectId = expense.projectId || UNASSIGNED_PROJECT_ID;
    const aggregateRigId = expense.rigId || UNASSIGNED_RIG_ID;
    const aggregateClientName = expense.clientName || UNASSIGNED_CLIENT_NAME;
    const aggregateProjectName = expense.projectName || UNASSIGNED_PROJECT_NAME;
    const aggregateRigName = expense.rigName || UNASSIGNED_RIG_NAME;

    upsertAggregate(clientMap, aggregateClientId, aggregateClientName, 0, expense.amount);
    upsertAggregate(projectMap, aggregateProjectId, aggregateProjectName, 0, expense.amount);
    upsertAggregate(rigMap, aggregateRigId, aggregateRigName, 0, expense.amount);

    const currentRigBreakdown = rigCostBreakdownMap.get(aggregateRigId) || {
      id: aggregateRigId,
      name: aggregateRigName,
      fuel: 0,
      salaries: 0,
      maintenance: 0,
      consumables: 0,
      other: 0,
      totalExpenses: 0
    };

    currentRigBreakdown[costGroup] += expense.amount;
    currentRigBreakdown.totalExpenses += expense.amount;
    rigCostBreakdownMap.set(aggregateRigId, currentRigBreakdown);
  }

  const totalProfit = totalRevenue - totalExpenses;

  const profitTrend = Array.from(trendMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([bucketStart, row]) => ({
      bucketStart,
      label: formatBucketLabel(bucketStart, trendGranularity),
      revenue: roundCurrency(row.revenue),
      expenses: roundCurrency(row.expenses),
      profit: roundCurrency(row.profit)
    }));

  const profitByRig = finalizeAggregates(rigMap);
  const profitByProject = finalizeAggregates(projectMap);
  const profitByClient = finalizeAggregates(clientMap);
  const marginByRig = finalizeAggregates(rigMap, "margin");
  const marginByProject = finalizeAggregates(projectMap, "margin");
  const highestProfitRig = pickHighestByProfit(profitByRig);
  const lowestProfitRig = pickLowestByProfit(profitByRig);
  const highestProfitProject = pickHighestByProfit(profitByProject);
  const lowestProfitProject = pickLowestByProfit(profitByProject);
  const highestProfitClient = pickHighestByProfit(profitByClient);
  const lowestProfitClient = pickLowestByProfit(profitByClient);
  const costBreakdownByCategory = Array.from(expenseCategoryMap.entries())
    .map(([category, amount]) => ({
      category,
      totalCost: roundCurrency(amount),
      percentOfTotalExpenses: calculatePercent(amount, totalExpenses)
    }))
    .sort((a, b) => b.totalCost - a.totalCost);

  const costBreakdownByGroup =
    totalExpenses === 0
      ? []
      : (Object.keys(costGroupTotals) as CostGroupKey[]).map((key) => ({
          key,
          category: COST_GROUP_LABELS[key],
          totalCost: roundCurrency(costGroupTotals[key]),
          percentOfTotalExpenses: calculatePercent(costGroupTotals[key], totalExpenses)
        }));

  const costBreakdownByRig = Array.from(rigCostBreakdownMap.values())
    .map((entry) => ({
      ...entry,
      fuel: roundCurrency(entry.fuel),
      salaries: roundCurrency(entry.salaries),
      maintenance: roundCurrency(entry.maintenance),
      consumables: roundCurrency(entry.consumables),
      other: roundCurrency(entry.other),
      totalExpenses: roundCurrency(entry.totalExpenses)
    }))
    .sort((a, b) => b.totalExpenses - a.totalExpenses);

  debugLog(
    "[expense-visibility][profit-summary]",
    {
      appliedFilters,
      reportRecordCount: reports.length,
      expenseRecordCount: spendContext.rawExpenses.length,
      recognizedExpenseRecordCount: recognizedExpenses.length,
      usageExpenseMovementCount: usageExpenses.length,
      recognition: recognizedExpenseResult.stats,
      totalExpenses,
      approvedIntentAmount,
      usagePurposeSummary,
      expenseStatusCounts,
      purposeTotals: recognizedPurposeSummary,
      classificationAudit
    },
    { channel: "finance" }
  );

  return withLegacyFinanceDeprecationHeaders(
    NextResponse.json({
    filters: {
      projectId: projectId || "all",
      clientId: clientId || "all",
      rigId: rigId || "all",
      from: request.nextUrl.searchParams.get("from"),
      to: request.nextUrl.searchParams.get("to")
    },
    totals: {
      totalRevenue: roundCurrency(totalRevenue),
      totalExpenses: roundCurrency(totalExpenses),
      recognizedSpend: roundCurrency(totalExpenses),
      totalProfit: roundCurrency(totalProfit)
    },
    operationalPurposeSummary: usagePurposeSummary,
    recognizedPurposeSummary,
    meta: {
      expenseBasis: "actual-use" as const
    },
    classificationAudit,
    kpis: {
      highestProfitRig: highestProfitRig?.name || "N/A",
      highestProfitProject: highestProfitProject?.name || "N/A",
      lowestProfitRig: lowestProfitRig?.name || "N/A",
      lowestProfitProject: lowestProfitProject?.name || "N/A",
      highestProfitClient: highestProfitClient?.name || "N/A",
      lowestProfitClient: lowestProfitClient?.name || "N/A",
      highestMarginRig: marginByRig[0]?.name || "N/A",
      highestMarginProject: marginByProject[0]?.name || "N/A"
    },
    trendGranularity,
    profitTrend,
    profitByRig,
    profitByProject,
    profitByClient,
    marginByRig,
    marginByProject,
    costBreakdownByCategory,
    costBreakdownByGroup,
    costBreakdownByRig,
    expenseStatusCounts,
    leaderboards: {
      rigs: profitByRig,
      projects: profitByProject
    }
    }),
    "/api/profit/summary"
  );
}

function nullableFilter(value: string | null) {
  return value && value !== "all" ? value : null;
}

function parseDateOrNull(value: string | null, endOfDay = false) {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  if (endOfDay) {
    parsed.setUTCHours(23, 59, 59, 999);
  } else {
    parsed.setUTCHours(0, 0, 0, 0);
  }

  return parsed;
}

function resolveTrendGranularity({
  fromDate,
  toDate,
  reportDates,
  expenseDates
}: {
  fromDate: Date | null;
  toDate: Date | null;
  reportDates: Date[];
  expenseDates: Date[];
}): "day" | "month" {
  if (fromDate && toDate) {
    return inclusiveRangeDays(fromDate, toDate) <= 31 ? "day" : "month";
  }

  const allDates = [...reportDates, ...expenseDates];
  if (allDates.length === 0) {
    return "day";
  }

  let min = allDates[0];
  let max = allDates[0];
  for (const date of allDates) {
    if (date.getTime() < min.getTime()) {
      min = date;
    }
    if (date.getTime() > max.getTime()) {
      max = date;
    }
  }

  return inclusiveRangeDays(min, max) <= 31 ? "day" : "month";
}

function inclusiveRangeDays(start: Date, end: Date) {
  const utcStart = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate());
  const utcEnd = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate());
  return Math.max(1, Math.floor((utcEnd - utcStart) / 86400000) + 1);
}

function buildTrendKey(date: Date, granularity: "day" | "month") {
  return granularity === "day" ? date.toISOString().slice(0, 10) : date.toISOString().slice(0, 7);
}

function formatBucketLabel(bucketStart: string, granularity: "day" | "month") {
  if (granularity === "day") {
    const date = new Date(`${bucketStart}T00:00:00.000Z`);
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "2-digit",
      timeZone: "UTC"
    }).format(date);
  }

  const date = new Date(`${bucketStart}-01T00:00:00.000Z`);
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    year: "2-digit",
    timeZone: "UTC"
  }).format(date);
}

function upsertAggregate(
  map: Map<string, AggregateRowBase>,
  id: string,
  name: string,
  revenueDelta: number,
  expenseDelta: number
) {
  const current = map.get(id) || {
    id,
    name,
    revenue: 0,
    expenses: 0
  };

  if ((!current.name || current.name.startsWith("Unknown")) && name) {
    current.name = name;
  }

  current.revenue += revenueDelta;
  current.expenses += expenseDelta;
  map.set(id, current);
}

function finalizeAggregates(map: Map<string, AggregateRowBase>, sortBy: "profit" | "margin" = "profit") {
  const rows: AggregateRow[] = Array.from(map.values()).map((entry) => ({
    ...entry,
    revenue: roundCurrency(entry.revenue),
    expenses: roundCurrency(entry.expenses),
    profit: roundCurrency(entry.revenue - entry.expenses),
    margin: calculateMargin(entry.revenue - entry.expenses, entry.revenue)
  }));

  return rows.sort((a, b) => {
    if (sortBy === "margin" && b.margin !== a.margin) {
      return b.margin - a.margin;
    }
    if (sortBy === "profit" && b.profit !== a.profit) {
      return b.profit - a.profit;
    }
    if (b.revenue !== a.revenue) {
      return b.revenue - a.revenue;
    }
    return a.name.localeCompare(b.name);
  });
}

function pickHighestByProfit(rows: AggregateRow[]) {
  if (rows.length === 0) {
    return null;
  }
  return rows.reduce((max, row) => (row.profit > max.profit ? row : max));
}

function pickLowestByProfit(rows: AggregateRow[]) {
  if (rows.length <= 1) {
    return null;
  }
  return rows.reduce((min, row) => (row.profit < min.profit ? row : min));
}

function roundCurrency(value: number) {
  return Math.round(safeNumber(value) * 100) / 100;
}

function calculateMargin(profit: number, revenue: number) {
  const safeRevenue = safeNumber(revenue);
  if (safeRevenue === 0) {
    return 0;
  }
  return Math.round((safeNumber(profit) / safeRevenue) * 1000) / 10;
}

function calculatePercent(value: number, total: number) {
  const safeTotal = safeNumber(total);
  if (safeTotal === 0) {
    return 0;
  }
  return Math.round((safeNumber(value) / safeTotal) * 1000) / 10;
}

function normalizeExpenseCategory(category: string | null | undefined) {
  const value = category?.trim();
  return value || "Uncategorized";
}

function buildUsagePurposeSummary(
  expenses: Array<{
    amount: number;
    contextType: string | null;
    clientId: string | null;
    projectId: string | null;
    rigId: string | null;
  }>
): PurposeSummary {
  const totals: PurposeSummary = {
    totalRecognizedSpend: 0,
    breakdownCost: 0,
    maintenanceCost: 0,
    stockReplenishmentCost: 0,
    operatingCost: 0,
    otherUnlinkedCost: 0
  };

  for (const expense of expenses) {
    const amount = safeNumber(expense.amount);
    if (amount <= 0) {
      continue;
    }
    totals.totalRecognizedSpend += amount;

    if (expense.contextType === "BREAKDOWN") {
      totals.breakdownCost += amount;
      continue;
    }

    if (expense.contextType === "MAINTENANCE") {
      totals.maintenanceCost += amount;
      continue;
    }

    if (
      expense.contextType === "OTHER" &&
      !expense.clientId &&
      !expense.projectId &&
      !expense.rigId
    ) {
      totals.otherUnlinkedCost += amount;
      continue;
    }

    totals.operatingCost += amount;
  }

  return {
    totalRecognizedSpend: roundCurrency(totals.totalRecognizedSpend),
    breakdownCost: roundCurrency(totals.breakdownCost),
    maintenanceCost: roundCurrency(totals.maintenanceCost),
    stockReplenishmentCost: roundCurrency(totals.stockReplenishmentCost),
    operatingCost: roundCurrency(totals.operatingCost),
    otherUnlinkedCost: roundCurrency(totals.otherUnlinkedCost)
  };
}

function normalizeRecognizedPurposeSummary(source: {
  recognizedSpendTotal: number;
  breakdownCost: number;
  maintenanceCost: number;
  stockReplenishmentCost: number;
  operatingCost: number;
  otherUnlinkedCost: number;
}): PurposeSummary {
  return {
    totalRecognizedSpend: roundCurrency(source.recognizedSpendTotal),
    breakdownCost: roundCurrency(source.breakdownCost),
    maintenanceCost: roundCurrency(source.maintenanceCost),
    stockReplenishmentCost: roundCurrency(source.stockReplenishmentCost),
    operatingCost: roundCurrency(source.operatingCost),
    otherUnlinkedCost: roundCurrency(source.otherUnlinkedCost)
  };
}

function classifyCostGroup(
  category: string,
  subcategory: string | null,
  contextType: string | null | undefined
) {
  const searchText = `${category} ${subcategory || ""} ${contextType || ""}`.toLowerCase();

  if (hasAny(searchText, ["maintenance", "maint", "breakdown"])) {
    return "maintenance";
  }

  if (hasAny(searchText, ["fuel", "diesel", "petrol", "gasoline", "camp fuel", "light plant", "water pump"])) {
    return "fuel";
  }

  if (hasAny(searchText, ["salary", "salaries", "labor", "labour", "wage", "wages", "payroll", "casual"])) {
    return "salaries";
  }

  if (hasAny(searchText, ["maint", "repair", "service", "workshop"])) {
    return "maintenance";
  }

  if (
    hasAny(searchText, [
      "consumable",
      "rc bit",
      "rc bits",
      "bit",
      "bits",
      "pvc",
      "shroud",
      "hammer oil",
      "hydraulic oil",
      "compressor oil",
      "spare part",
      "spare parts",
      "drilling",
      "consumables",
      "filters",
      "hydraulic",
      "electrical",
      "oils",
      "tires"
    ])
  ) {
    return "consumables";
  }

  return "other";
}

function safeNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function hasAny(text: string, tokens: string[]) {
  return tokens.some((token) => text.includes(token));
}

const COST_GROUP_LABELS: Record<CostGroupKey, string> = {
  fuel: "Fuel",
  salaries: "Salaries",
  maintenance: "Maintenance",
  consumables: "Consumables",
  other: "Other"
};
