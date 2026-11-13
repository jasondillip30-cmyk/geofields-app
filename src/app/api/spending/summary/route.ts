import { NextResponse, type NextRequest } from "next/server";

import { requireApiPermission } from "@/lib/auth/api-guard";
import {
  withFinancialActualUseMovementApproval,
  withFinancialDrillReportApproval
} from "@/lib/financial-approval-policy";
import { prisma } from "@/lib/prisma";
import { calculateProjectRevenueFromBillableLines } from "@/lib/project-revenue-calculator";
import { buildRecognizedSpendContext } from "@/lib/recognized-spend-context";
import {
  buildSpendingMovementCategories,
  resolveSpendingExpenseCategory
} from "@/lib/spending-expense-category";

interface RevenueTrendPoint {
  bucketStart: string;
  label: string;
  revenue: number;
}

interface TimePeriodBucket {
  bucketKey: string;
  label: string;
  income: number;
  expenses: number;
}

interface LargestExpenseRow {
  id: string;
  label: string;
  dateLabel: string;
  amount: number;
}

interface FrequentUsageRow {
  itemId: string;
  itemName: string;
  usageCount: number;
}

interface ProjectExpenseRecord {
  id: string;
  date: Date;
  amount: number;
  label: string;
  category: string;
}

type RevenueRateCardMode =
  | "STAGED_PER_METER"
  | "PER_METER"
  | "DAY_RATE"
  | "LUMP_SUM"
  | "NOT_CONFIGURED";

interface RevenueRateCardRow {
  id: string;
  label: string;
  rangeLabel: string | null;
  rate: number;
  rateSuffix: string;
}

interface RevenueRateCardPayload {
  mode: RevenueRateCardMode;
  rows: RevenueRateCardRow[];
  message: string | null;
}

export async function GET(request: NextRequest) {
  const auth = await requireApiPermission(request, "finance:view");
  if (!auth.ok) {
    return auth.response;
  }

  const fromParam = request.nextUrl.searchParams.get("from");
  const toParam = request.nextUrl.searchParams.get("to");
  const rawClientId = nullableFilter(request.nextUrl.searchParams.get("clientId"));
  const rawRigId = nullableFilter(request.nextUrl.searchParams.get("rigId"));
  const projectId = nullableFilter(request.nextUrl.searchParams.get("projectId"));
  const clientId = projectId ? null : rawClientId;
  const rigId = projectId ? null : rawRigId;
  const fromDate = parseDateOrNull(fromParam);
  const toDate = parseDateOrNull(toParam, true);

  const drillWhere = withFinancialDrillReportApproval({
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

  const [reports, spendContext, usageMovements, projectRateCard] = await Promise.all([
    prisma.drillReport.findMany({
      where: drillWhere,
      orderBy: [{ date: "asc" }, { createdAt: "asc" }],
      select: {
        id: true,
        date: true,
        holeNumber: true,
        totalMetersDrilled: true,
        billableAmount: true,
        billableLines: {
          select: {
            itemCode: true,
            quantity: true,
            unit: true
          }
        }
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
      where: withFinancialActualUseMovementApproval({
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
      }),
      select: {
        itemId: true,
        item: {
          select: {
            name: true
          }
        }
      }
    }),
    projectId
      ? prisma.project.findUnique({
          where: { id: projectId },
          select: {
            contractType: true,
            contractRatePerM: true,
            contractDayRate: true,
            contractLumpSumValue: true,
            billingRateItems: {
              where: { isActive: true },
              orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
              select: {
                id: true,
                itemCode: true,
                label: true,
                unit: true,
                unitRate: true,
                drillingStageLabel: true,
                depthBandStartM: true,
                depthBandEndM: true,
                sortOrder: true
              }
            }
          }
        })
      : Promise.resolve(null)
  ]);

  const recognizedExpenseById = new Map(
    spendContext.recognizedExpenses.map((expense) => [expense.id, expense])
  );
  const movementByExpenseId = new Map<
    string,
    (typeof spendContext.movements)[number]
  >();
  const movementCategoryByExpenseId = buildSpendingMovementCategories(spendContext.movements);
  for (const movement of spendContext.movements) {
    if (!movement.expenseId || movementByExpenseId.has(movement.expenseId)) {
      continue;
    }
    movementByExpenseId.set(movement.expenseId, movement);
  }
  const projectExpenses = spendContext.projectExpensePolicy.rows.flatMap<ProjectExpenseRecord>((row) => {
    const expense = recognizedExpenseById.get(row.expenseId);
    if (!expense) {
      return [];
    }
    const movement = movementByExpenseId.get(row.expenseId);
    return [
      {
        id: expense.id,
        date: expense.date,
        amount: safeNumber(expense.amount),
        label: normalizeLabel(
          movement?.item?.name,
          normalizeLabel(expense.subcategory, normalizeLabel(expense.category, "Expense"))
        ),
        category: resolveSpendingExpenseCategory({ expense, movementCategoryByExpenseId })
      }
    ];
  });

  const totalIncome = reports.reduce((sum, report) => sum + safeNumber(report.billableAmount), 0);
  const totalExpenses = spendContext.projectExpensePolicy.total;
  const netCashFlow = totalIncome - totalExpenses;
  const totalMetersDrilled = reports.reduce(
    (sum, report) => sum + safeNumber(report.totalMetersDrilled),
    0
  );

  const revenueTrend = buildRevenueTrend(reports);
  const expenseByCategory = buildExpenseCategoryRows(projectExpenses, totalExpenses);
  const incomeByHole = buildIncomeByHoleRows(reports, totalIncome);
  const timePeriod = buildTimePeriodBuckets(
    reports,
    projectExpenses.map((expense) => ({
      date: expense.date,
      amount: expense.amount
    }))
  );
  const largestExpenses = buildLargestExpenses(projectExpenses);
  const mostFrequentUsage = buildMostFrequentUsage(usageMovements);
  const revenueRateCard = buildRevenueRateCard(projectRateCard);
  const revenueBreakdown = projectRateCard
    ? calculateProjectRevenueFromBillableLines({
        approvedReports: reports,
        activeRateItems: projectRateCard.billingRateItems
      }).lineItems
    : [];

  return NextResponse.json({
    meta: {
      expenseBasis: "project-expenses" as const,
      excludedStockReplenishment: spendContext.projectExpensePolicy.excludedStockReplenishmentTotal
    },
    filters: {
      projectId: projectId || "all",
      clientId: clientId || "all",
      rigId: rigId || "all",
      from: fromParam,
      to: toParam
    },
    totals: {
      income: roundCurrency(totalIncome),
      expenses: roundCurrency(totalExpenses),
      netCashFlow: roundCurrency(netCashFlow),
      metersDrilled: roundCurrency(totalMetersDrilled)
    },
    revenueTrend,
    timePeriod,
    expenseByCategory,
    incomeByHole,
    largestExpenses,
    mostFrequentUsage,
    revenueRateCard,
    revenueBreakdown
  });
}

function buildRevenueRateCard(
  project:
    | {
        contractType: "PER_METER" | "DAY_RATE" | "LUMP_SUM";
        contractRatePerM: number;
        contractDayRate: number;
        contractLumpSumValue: number;
        billingRateItems: Array<{
          id: string;
          itemCode: string;
          label: string;
          unit: string;
          unitRate: number;
          drillingStageLabel: string | null;
          depthBandStartM: number | null;
          depthBandEndM: number | null;
          sortOrder: number;
        }>;
      }
    | null
): RevenueRateCardPayload {
  if (!project) {
    return {
      mode: "NOT_CONFIGURED",
      rows: [],
      message: "Rates not configured for this project."
    };
  }

  const stagedRows = project.billingRateItems
    .filter((entry) => `${entry.unit || ""}`.trim().toLowerCase() === "meter")
    .filter((entry) => Number.isFinite(entry.depthBandStartM) && Number.isFinite(entry.depthBandEndM))
    .sort((left, right) => left.sortOrder - right.sortOrder)
    .map<RevenueRateCardRow>((entry) => ({
      id: entry.id,
      label: normalizeLabel(entry.drillingStageLabel || entry.label, "Stage"),
      rangeLabel: `${safeNumber(entry.depthBandStartM)}-${safeNumber(entry.depthBandEndM)} m`,
      rate: roundCurrency(safeNumber(entry.unitRate)),
      rateSuffix: "/ m"
    }));

  if (stagedRows.length > 0) {
    return {
      mode: "STAGED_PER_METER",
      rows: stagedRows,
      message: null
    };
  }

  if (project.contractType === "DAY_RATE" && safeNumber(project.contractDayRate) > 0) {
    return {
      mode: "DAY_RATE",
      rows: [
        {
          id: "day-rate",
          label: "Day rate",
          rangeLabel: null,
          rate: roundCurrency(safeNumber(project.contractDayRate)),
          rateSuffix: "/ day"
        }
      ],
      message: null
    };
  }

  if (project.contractType === "LUMP_SUM" && safeNumber(project.contractLumpSumValue) > 0) {
    return {
      mode: "LUMP_SUM",
      rows: [
        {
          id: "lump-sum",
          label: "Lump sum",
          rangeLabel: null,
          rate: roundCurrency(safeNumber(project.contractLumpSumValue)),
          rateSuffix: ""
        }
      ],
      message: null
    };
  }

  if (project.contractType === "PER_METER" && safeNumber(project.contractRatePerM) > 0) {
    return {
      mode: "PER_METER",
      rows: [
        {
          id: "per-meter",
          label: "Per meter rate",
          rangeLabel: null,
          rate: roundCurrency(safeNumber(project.contractRatePerM)),
          rateSuffix: "/ m"
        }
      ],
      message: null
    };
  }

  return {
    mode: "NOT_CONFIGURED",
    rows: [],
    message: "Rates not configured for this project."
  };
}

function buildRevenueTrend(
  reports: Array<{
    date: Date;
    billableAmount: number;
  }>
) {
  if (reports.length === 0) {
    return [] as RevenueTrendPoint[];
  }

  const minDate = reports[0]?.date || null;
  const maxDate = reports[reports.length - 1]?.date || null;
  const dateRangeDays =
    minDate && maxDate ? Math.max(1, Math.floor((maxDate.getTime() - minDate.getTime()) / 86400000) + 1) : 0;
  const trendGranularity: "day" | "month" = dateRangeDays <= 31 ? "day" : "month";

  const trendMap = new Map<string, number>();
  for (const report of reports) {
    const bucket =
      trendGranularity === "day" ? report.date.toISOString().slice(0, 10) : report.date.toISOString().slice(0, 7);
    trendMap.set(bucket, (trendMap.get(bucket) || 0) + safeNumber(report.billableAmount));
  }

  return Array.from(trendMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([bucketStart, revenue]) => ({
      bucketStart,
      label: formatBucketLabel(bucketStart, trendGranularity),
      revenue: roundCurrency(revenue)
    }));
}

function buildExpenseCategoryRows(
  expenses: ProjectExpenseRecord[],
  totalExpenses: number
) {
  const categoryMap = new Map<string, number>();
  for (const expense of expenses) {
    categoryMap.set(
      expense.category,
      (categoryMap.get(expense.category) || 0) + expense.amount
    );
  }

  return Array.from(categoryMap.entries())
    .map(([category, total]) => ({
      category,
      total: roundCurrency(total),
      percentOfExpenses: calculatePercent(total, totalExpenses)
    }))
    .sort((a, b) => b.total - a.total);
}

function buildIncomeByHoleRows(
  reports: Array<{ holeNumber: string; billableAmount: number }>,
  totalIncome: number
) {
  const holeMap = new Map<string, number>();
  for (const report of reports) {
    const holeNumber = normalizeLabel(report.holeNumber, "Unknown hole");
    holeMap.set(holeNumber, (holeMap.get(holeNumber) || 0) + safeNumber(report.billableAmount));
  }

  return Array.from(holeMap.entries())
    .map(([holeNumber, total]) => ({
      holeNumber,
      total: roundCurrency(total),
      percentOfRevenue: calculatePercent(total, totalIncome),
      percentOfIncome: calculatePercent(total, totalIncome)
    }))
    .sort((a, b) => b.total - a.total);
}

function buildTimePeriodBuckets(
  reports: Array<{ date: Date; billableAmount: number }>,
  expenses: Array<{ date: Date; amount: number }>
) {
  const monthlyMap = new Map<string, { income: number; expenses: number }>();
  const yearlyMap = new Map<string, { income: number; expenses: number }>();

  for (const report of reports) {
    const income = safeNumber(report.billableAmount);
    const monthKey = report.date.toISOString().slice(0, 7);
    const yearKey = report.date.toISOString().slice(0, 4);
    const monthEntry = monthlyMap.get(monthKey) || { income: 0, expenses: 0 };
    monthEntry.income += income;
    monthlyMap.set(monthKey, monthEntry);
    const yearEntry = yearlyMap.get(yearKey) || { income: 0, expenses: 0 };
    yearEntry.income += income;
    yearlyMap.set(yearKey, yearEntry);
  }

  for (const expense of expenses) {
    const amount = safeNumber(expense.amount);
    const monthKey = expense.date.toISOString().slice(0, 7);
    const yearKey = expense.date.toISOString().slice(0, 4);
    const monthEntry = monthlyMap.get(monthKey) || { income: 0, expenses: 0 };
    monthEntry.expenses += amount;
    monthlyMap.set(monthKey, monthEntry);
    const yearEntry = yearlyMap.get(yearKey) || { income: 0, expenses: 0 };
    yearEntry.expenses += amount;
    yearlyMap.set(yearKey, yearEntry);
  }

  const monthly: TimePeriodBucket[] = Array.from(monthlyMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([bucketKey, entry]) => ({
      bucketKey,
      label: formatMonthlyLabel(bucketKey),
      income: roundCurrency(entry.income),
      expenses: roundCurrency(entry.expenses)
    }));

  const yearly: TimePeriodBucket[] = Array.from(yearlyMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([bucketKey, entry]) => ({
      bucketKey,
      label: bucketKey,
      income: roundCurrency(entry.income),
      expenses: roundCurrency(entry.expenses)
    }));

  return {
    monthly,
    yearly
  };
}

function buildLargestExpenses(
  expenses: ProjectExpenseRecord[]
) {
  return [...expenses]
    .map<LargestExpenseRow>((expense) => ({
      id: expense.id,
      label: expense.label,
      dateLabel: formatDateLabel(expense.date),
      amount: roundCurrency(expense.amount)
    }))
    .sort((left, right) => right.amount - left.amount)
    .slice(0, 3);
}

function buildMostFrequentUsage(
  movements: Array<{
    itemId: string;
    item: { name: string } | null;
  }>
) {
  const usageMap = new Map<string, { itemName: string; usageCount: number }>();
  for (const movement of movements) {
    const itemName = normalizeLabel(movement.item?.name, "Inventory item");
    const existing = usageMap.get(movement.itemId) || { itemName, usageCount: 0 };
    existing.usageCount += 1;
    usageMap.set(movement.itemId, existing);
  }

  return Array.from(usageMap.entries())
    .map<FrequentUsageRow>(([itemId, entry]) => ({
      itemId,
      itemName: entry.itemName,
      usageCount: entry.usageCount
    }))
    .sort((left, right) => right.usageCount - left.usageCount || left.itemName.localeCompare(right.itemName))
    .slice(0, 3);
}

function normalizeLabel(value: string | null | undefined, fallback: string) {
  const trimmed = `${value || ""}`.trim();
  return trimmed || fallback;
}

function safeNumber(value: unknown) {
  const next = Number(value);
  if (!Number.isFinite(next)) {
    return 0;
  }
  return next;
}

function roundCurrency(value: number) {
  return Math.round(safeNumber(value) * 100) / 100;
}

function calculatePercent(part: number, total: number) {
  if (safeNumber(total) <= 0) {
    return 0;
  }
  return roundCurrency((safeNumber(part) / safeNumber(total)) * 100);
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

function nullableFilter(value: string | null) {
  return value && value !== "all" ? value : null;
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

function formatMonthlyLabel(bucketKey: string) {
  const date = new Date(`${bucketKey}-01T00:00:00.000Z`);
  const month = new Intl.DateTimeFormat("en-US", {
    month: "short",
    timeZone: "UTC"
  }).format(date);
  const year = new Intl.DateTimeFormat("en-US", {
    year: "2-digit",
    timeZone: "UTC"
  }).format(date);
  return `${month}'${year}`;
}

function formatDateLabel(date: Date) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "2-digit",
    timeZone: "UTC"
  }).format(date);
}
