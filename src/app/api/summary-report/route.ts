import type { MaintenanceStatus, Prisma } from "@prisma/client";
import { NextResponse, type NextRequest } from "next/server";

import { requireApiPermission } from "@/lib/auth/api-guard";
import { withFinancialDrillReportApproval, withFinancialExpenseApproval } from "@/lib/financial-approval-policy";
import { prisma } from "@/lib/prisma";

const UNASSIGNED_PROJECT_ID = "__unassigned_project__";
const UNASSIGNED_PROJECT_NAME = "Unassigned Project";
const UNASSIGNED_RIG_ID = "__unassigned_rig__";
const UNASSIGNED_RIG_NAME = "Unassigned Rig";

const ACTIVE_MAINTENANCE_STATUSES: MaintenanceStatus[] = [
  "SUBMITTED",
  "UNDER_REVIEW",
  "APPROVED",
  "WAITING_FOR_PARTS",
  "IN_REPAIR"
];

interface RevenueAggregate {
  id: string;
  name: string;
  revenue: number;
}

interface ExpenseAggregate {
  id: string;
  name: string;
  amount: number;
}

interface ProfitabilityAggregate {
  id: string;
  name: string;
  revenue: number;
  expenses: number;
  profit: number;
  marginPercent: number | null;
}

export async function GET(request: NextRequest) {
  const auth = await requireApiPermission(request, "reports:view");
  if (!auth.ok) {
    return auth.response;
  }

  const fromDate = parseDateOrNull(request.nextUrl.searchParams.get("from"));
  const toDate = parseDateOrNull(request.nextUrl.searchParams.get("to"), true);
  const clientId = nullableFilter(request.nextUrl.searchParams.get("clientId"));
  const rigId = nullableFilter(request.nextUrl.searchParams.get("rigId"));
  const projectId = nullableFilter(request.nextUrl.searchParams.get("projectId"));

  const drillWhere = withFinancialDrillReportApproval({
    ...(clientId ? { clientId } : {}),
    ...(rigId ? { rigId } : {}),
    ...(projectId ? { projectId } : {}),
    ...(fromDate || toDate
      ? {
          date: {
            ...(fromDate ? { gte: fromDate } : {}),
            ...(toDate ? { lte: toDate } : {})
          }
        }
      : {})
  });

  const expenseWhere = withFinancialExpenseApproval({
    ...(clientId ? { clientId } : {}),
    ...(rigId ? { rigId } : {}),
    ...(projectId ? { projectId } : {}),
    ...(fromDate || toDate
      ? {
          date: {
            ...(fromDate ? { gte: fromDate } : {}),
            ...(toDate ? { lte: toDate } : {})
          }
        }
      : {})
  });

  const projectWhere: Prisma.ProjectWhereInput = {
    ...(clientId ? { clientId } : {}),
    ...(projectId ? { id: projectId } : {}),
    ...(rigId
      ? {
          OR: [{ assignedRigId: rigId }, { backupRigId: rigId }]
        }
      : {})
  };

  const rigWhere: Prisma.RigWhereInput = {
    ...(rigId ? { id: rigId } : {})
  };

  const maintenanceWhere: Prisma.MaintenanceRequestWhereInput = {
    status: { in: ACTIVE_MAINTENANCE_STATUSES },
    ...(clientId ? { clientId } : {}),
    ...(projectId ? { projectId } : {}),
    ...(rigId ? { rigId } : {}),
    ...(fromDate || toDate
      ? {
          requestDate: {
            ...(fromDate ? { gte: fromDate } : {}),
            ...(toDate ? { lte: toDate } : {})
          }
        }
      : {})
  };

  const todayStart = startOfUtcDay(new Date());
  const todayEnd = endOfUtcDay(new Date());
  const weekStart = startOfUtcWeek(new Date());
  const monthStart = startOfUtcMonth(new Date());

  const [reports, expenses, projects, rigs, totalClientsCount, pendingMaintenanceRequests, dailyIssueCount, inventoryItems] =
    await Promise.all([
      prisma.drillReport.findMany({
        where: drillWhere,
        orderBy: [{ date: "asc" }, { createdAt: "asc" }],
        include: {
          client: { select: { id: true, name: true } },
          project: { select: { id: true, name: true } },
          rig: { select: { id: true, rigCode: true } }
        }
      }),
      prisma.expense.findMany({
        where: expenseWhere,
        orderBy: [{ date: "asc" }, { createdAt: "asc" }],
        include: {
          client: { select: { id: true, name: true } },
          project: { select: { id: true, name: true } },
          rig: { select: { id: true, rigCode: true } }
        }
      }),
      prisma.project.findMany({
        where: projectWhere,
        select: {
          id: true,
          name: true,
          status: true,
          clientId: true,
          assignedRigId: true,
          backupRigId: true
        }
      }),
      prisma.rig.findMany({
        where: rigWhere,
        select: {
          id: true,
          rigCode: true,
          status: true,
          condition: true
        }
      }),
      clientId ? prisma.client.count({ where: { id: clientId } }) : prisma.client.count(),
      prisma.maintenanceRequest.count({ where: maintenanceWhere }),
      prisma.maintenanceRequest.count({
        where: {
          ...maintenanceWhere,
          requestDate: {
            gte: maxDate(todayStart, fromDate),
            lte: minDate(todayEnd, toDate)
          }
        }
      }),
      prisma.inventoryItem.findMany({
        where: {
          ...(rigId ? { compatibleRigId: rigId } : {})
        },
        select: {
          id: true,
          quantityInStock: true,
          minimumStockLevel: true
        }
      })
    ]);

  const totalRevenue = roundCurrency(reports.reduce((sum, report) => sum + report.billableAmount, 0));
  const totalExpenses = roundCurrency(expenses.reduce((sum, expense) => sum + expense.amount, 0));
  const grossProfit = roundCurrency(totalRevenue - totalExpenses);

  const dailyReports = reports.filter((entry) => isWithinRange(entry.date, todayStart, todayEnd));
  const dailyExpenses = expenses.filter((entry) => isWithinRange(entry.date, todayStart, todayEnd));
  const weeklyReports = reports.filter((entry) => isWithinRange(entry.date, weekStart, todayEnd));
  const weeklyExpenses = expenses.filter((entry) => isWithinRange(entry.date, weekStart, todayEnd));
  const monthlyReports = reports.filter((entry) => isWithinRange(entry.date, monthStart, todayEnd));
  const monthlyExpenses = expenses.filter((entry) => isWithinRange(entry.date, monthStart, todayEnd));

  const revenueByClient = aggregateRevenueBy(reports, (entry) => ({
    id: entry.clientId,
    name: entry.client.name
  }));
  const revenueByProject = aggregateRevenueBy(reports, (entry) => ({
    id: entry.projectId,
    name: entry.project.name
  }));
  const revenueByRig = aggregateRevenueBy(reports, (entry) => ({
    id: entry.rigId,
    name: entry.rig.rigCode
  }));

  const expensesByCategory = aggregateExpensesByCategory(expenses);
  const projectProfitability = aggregateProjectProfitability(reports, expenses);
  const rigProfitability = aggregateRigProfitability(reports, expenses);

  const weeklyMostUsedRig = topBy(
    aggregateDrillingMetersByRig(weeklyReports),
    (entry) => entry.meters
  )?.name;
  const weeklyHighestRevenueRig = topBy(
    aggregateRevenueBy(weeklyReports, (entry) => ({ id: entry.rigId, name: entry.rig.rigCode })),
    (entry) => entry.revenue
  )?.name;
  const weeklyHighestExpenseRig = topBy(
    aggregateExpensesByRig(weeklyExpenses),
    (entry) => entry.amount
  )?.name;
  const weeklyBestProject = topBy(
    aggregateProjectProfitability(weeklyReports, weeklyExpenses),
    (entry) => entry.profit
  )?.name;

  const inScopeClientIds = new Set<string>();
  for (const report of reports) {
    inScopeClientIds.add(report.clientId);
  }
  for (const expense of expenses) {
    if (expense.clientId) {
      inScopeClientIds.add(expense.clientId);
    }
  }
  for (const project of projects) {
    inScopeClientIds.add(project.clientId);
  }

  const inScopeProjectIds = new Set<string>();
  for (const report of reports) {
    inScopeProjectIds.add(report.projectId);
  }
  for (const expense of expenses) {
    if (expense.projectId) {
      inScopeProjectIds.add(expense.projectId);
    }
  }
  for (const project of projects) {
    inScopeProjectIds.add(project.id);
  }

  const inScopeRigIds = new Set<string>();
  for (const report of reports) {
    inScopeRigIds.add(report.rigId);
  }
  for (const expense of expenses) {
    if (expense.rigId) {
      inScopeRigIds.add(expense.rigId);
    }
  }
  for (const project of projects) {
    if (project.assignedRigId) {
      inScopeRigIds.add(project.assignedRigId);
    }
    if (project.backupRigId) {
      inScopeRigIds.add(project.backupRigId);
    }
  }
  if (rigId) {
    inScopeRigIds.add(rigId);
  }

  const scopedRigs = rigId ? rigs.filter((rig) => rig.id === rigId) : rigs.filter((rig) => inScopeRigIds.has(rig.id) || inScopeRigIds.size === 0);
  const totalClientsInScope =
    clientId || projectId || rigId || fromDate || toDate ? inScopeClientIds.size : totalClientsCount;
  const totalProjectsInScope = inScopeProjectIds.size;
  const totalRigsInScope = scopedRigs.length;
  const activeRigs = scopedRigs.filter((rig) => rig.status === "ACTIVE").length;
  const idleRigs = scopedRigs.filter((rig) => rig.status === "IDLE").length;
  const maintenanceRigs = scopedRigs.filter((rig) => rig.status === "MAINTENANCE").length;
  const poorConditionRigs = scopedRigs.filter((rig) => rig.condition === "POOR" || rig.condition === "CRITICAL").length;

  const lowStockCount = inventoryItems.filter(
    (item) => item.quantityInStock > 0 && item.quantityInStock <= item.minimumStockLevel
  ).length;
  const outOfStockCount = inventoryItems.filter((item) => item.quantityInStock <= 0).length;

  const unassignedExpenseProjectCount = expenses.filter((entry) => !entry.projectId).length;
  const unassignedExpenseRigCount = expenses.filter((entry) => !entry.rigId).length;
  const unassignedExpenseClientCount = expenses.filter((entry) => !entry.clientId).length;
  const notes: string[] = [];
  if (unassignedExpenseProjectCount > 0 || unassignedExpenseRigCount > 0 || unassignedExpenseClientCount > 0) {
    notes.push("Some approved expenses are missing project/rig/client linkage and are reported as Unassigned.");
  }

  return NextResponse.json({
    filters: {
      from: request.nextUrl.searchParams.get("from"),
      to: request.nextUrl.searchParams.get("to"),
      clientId: clientId || "all",
      projectId: projectId || "all",
      rigId: rigId || "all"
    },
    totals: {
      totalRevenue,
      totalExpenses,
      grossProfit,
      profitMarginPercent: marginPercent(grossProfit, totalRevenue)
    },
    summaries: {
      daily: {
        projectsWorked: uniqueCount(dailyReports.map((entry) => entry.projectId)),
        rigsUsed: uniqueCount(dailyReports.map((entry) => entry.rigId)),
        metersDrilled: roundCurrency(dailyReports.reduce((sum, entry) => sum + entry.totalMetersDrilled, 0)),
        revenue: roundCurrency(dailyReports.reduce((sum, entry) => sum + entry.billableAmount, 0)),
        expenses: roundCurrency(dailyExpenses.reduce((sum, entry) => sum + entry.amount, 0)),
        issuesReported: dailyIssueCount
      },
      weekly: {
        metersDrilled: roundCurrency(weeklyReports.reduce((sum, entry) => sum + entry.totalMetersDrilled, 0)),
        revenue: roundCurrency(weeklyReports.reduce((sum, entry) => sum + entry.billableAmount, 0)),
        expenses: roundCurrency(weeklyExpenses.reduce((sum, entry) => sum + entry.amount, 0)),
        profit: roundCurrency(
          weeklyReports.reduce((sum, entry) => sum + entry.billableAmount, 0) -
            weeklyExpenses.reduce((sum, entry) => sum + entry.amount, 0)
        ),
        mostUsedRig: weeklyMostUsedRig || "No data in filters",
        highestRevenueRig: weeklyHighestRevenueRig || "No data in filters",
        highestExpenseRig: weeklyHighestExpenseRig || "No data in filters",
        bestProject: weeklyBestProject || "No data in filters"
      },
      monthly: {
        metersDrilled: roundCurrency(monthlyReports.reduce((sum, entry) => sum + entry.totalMetersDrilled, 0)),
        revenue: roundCurrency(monthlyReports.reduce((sum, entry) => sum + entry.billableAmount, 0)),
        expenses: roundCurrency(monthlyExpenses.reduce((sum, entry) => sum + entry.amount, 0)),
        profit: roundCurrency(
          monthlyReports.reduce((sum, entry) => sum + entry.billableAmount, 0) -
            monthlyExpenses.reduce((sum, entry) => sum + entry.amount, 0)
        )
      }
    },
    executive: {
      totalClients: totalClientsInScope,
      totalProjects: totalProjectsInScope,
      totalRigs: totalRigsInScope,
      activeRigs,
      idleRigs,
      maintenanceRigs,
      poorConditionRigs,
      pendingMaintenanceRequests,
      inventoryLowStockCount: lowStockCount,
      inventoryOutOfStockCount: outOfStockCount,
      bestPerformingClient: revenueByClient[0]?.name || "No data in filters",
      bestPerformingProject: projectProfitability[0]?.name || "No data in filters",
      bestPerformingRig: revenueByRig[0]?.name || "No data in filters"
    },
    reports: {
      revenueByClient,
      revenueByProject,
      revenueByRig,
      expensesByCategory,
      projectProfitability,
      rigProfitability
    },
    dataQuality: {
      unassignedExpenseProjectCount,
      unassignedExpenseRigCount,
      unassignedExpenseClientCount
    },
    availability: {
      dailySummary: true,
      weeklyMonthlySummary: true,
      executiveSummary: true,
      revenueBreakdowns: true,
      expenseCategoryBreakdown: true,
      projectProfitability: true,
      rigProfitability: true
    },
    notes
  });
}

function aggregateRevenueBy<T extends { billableAmount: number }>(
  reports: T[],
  resolver: (entry: T) => { id: string; name: string }
) {
  const map = new Map<string, RevenueAggregate>();
  for (const report of reports) {
    const target = resolver(report);
    map.set(target.id, {
      id: target.id,
      name: target.name,
      revenue: roundCurrency((map.get(target.id)?.revenue || 0) + report.billableAmount)
    });
  }

  return [...map.values()].sort((a, b) => b.revenue - a.revenue);
}

function aggregateExpensesByCategory(expenses: Array<{ category: string; amount: number }>) {
  const map = new Map<string, ExpenseAggregate>();
  for (const expense of expenses) {
    const key = expense.category?.trim() || "Uncategorized";
    map.set(key, {
      id: key,
      name: key,
      amount: roundCurrency((map.get(key)?.amount || 0) + expense.amount)
    });
  }

  return [...map.values()].sort((a, b) => b.amount - a.amount);
}

function aggregateExpensesByRig(
  expenses: Array<{ rigId: string | null; amount: number; rig: { rigCode: string } | null }>
) {
  const map = new Map<string, ExpenseAggregate>();
  for (const expense of expenses) {
    const id = expense.rigId || UNASSIGNED_RIG_ID;
    const name = expense.rig?.rigCode || UNASSIGNED_RIG_NAME;
    map.set(id, {
      id,
      name,
      amount: roundCurrency((map.get(id)?.amount || 0) + expense.amount)
    });
  }
  return [...map.values()].sort((a, b) => b.amount - a.amount);
}

function aggregateProjectProfitability(
  reports: Array<{
    projectId: string;
    billableAmount: number;
    project: { name: string };
  }>,
  expenses: Array<{
    projectId: string | null;
    amount: number;
    project: { name: string } | null;
  }>
) {
  const map = new Map<string, ProfitabilityAggregate>();

  for (const report of reports) {
    const current = map.get(report.projectId) || {
      id: report.projectId,
      name: report.project.name,
      revenue: 0,
      expenses: 0,
      profit: 0,
      marginPercent: null
    };
    current.revenue = roundCurrency(current.revenue + report.billableAmount);
    current.profit = roundCurrency(current.revenue - current.expenses);
    current.marginPercent = marginPercent(current.profit, current.revenue);
    map.set(report.projectId, current);
  }

  for (const expense of expenses) {
    const id = expense.projectId || UNASSIGNED_PROJECT_ID;
    const name = expense.project?.name || UNASSIGNED_PROJECT_NAME;
    const current = map.get(id) || {
      id,
      name,
      revenue: 0,
      expenses: 0,
      profit: 0,
      marginPercent: null
    };
    current.expenses = roundCurrency(current.expenses + expense.amount);
    current.profit = roundCurrency(current.revenue - current.expenses);
    current.marginPercent = marginPercent(current.profit, current.revenue);
    map.set(id, current);
  }

  return [...map.values()].sort((a, b) => b.profit - a.profit);
}

function aggregateRigProfitability(
  reports: Array<{
    rigId: string;
    billableAmount: number;
    rig: { rigCode: string };
  }>,
  expenses: Array<{
    rigId: string | null;
    amount: number;
    rig: { rigCode: string } | null;
  }>
) {
  const map = new Map<string, ProfitabilityAggregate>();

  for (const report of reports) {
    const current = map.get(report.rigId) || {
      id: report.rigId,
      name: report.rig.rigCode,
      revenue: 0,
      expenses: 0,
      profit: 0,
      marginPercent: null
    };
    current.revenue = roundCurrency(current.revenue + report.billableAmount);
    current.profit = roundCurrency(current.revenue - current.expenses);
    current.marginPercent = marginPercent(current.profit, current.revenue);
    map.set(report.rigId, current);
  }

  for (const expense of expenses) {
    const id = expense.rigId || UNASSIGNED_RIG_ID;
    const name = expense.rig?.rigCode || UNASSIGNED_RIG_NAME;
    const current = map.get(id) || {
      id,
      name,
      revenue: 0,
      expenses: 0,
      profit: 0,
      marginPercent: null
    };
    current.expenses = roundCurrency(current.expenses + expense.amount);
    current.profit = roundCurrency(current.revenue - current.expenses);
    current.marginPercent = marginPercent(current.profit, current.revenue);
    map.set(id, current);
  }

  return [...map.values()].sort((a, b) => b.profit - a.profit);
}

function aggregateDrillingMetersByRig(
  reports: Array<{ rigId: string; totalMetersDrilled: number; rig: { rigCode: string } }>
) {
  const map = new Map<string, { id: string; name: string; meters: number }>();
  for (const report of reports) {
    map.set(report.rigId, {
      id: report.rigId,
      name: report.rig.rigCode,
      meters: roundCurrency((map.get(report.rigId)?.meters || 0) + report.totalMetersDrilled)
    });
  }
  return [...map.values()];
}

function topBy<T>(entries: T[], getter: (entry: T) => number) {
  return [...entries].sort((a, b) => getter(b) - getter(a))[0] || null;
}

function uniqueCount(values: string[]) {
  return new Set(values).size;
}

function marginPercent(profit: number, revenue: number) {
  if (revenue <= 0) {
    return null;
  }
  return roundCurrency((profit / revenue) * 100);
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

function startOfUtcDay(date: Date) {
  const next = new Date(date);
  next.setUTCHours(0, 0, 0, 0);
  return next;
}

function endOfUtcDay(date: Date) {
  const next = new Date(date);
  next.setUTCHours(23, 59, 59, 999);
  return next;
}

function startOfUtcWeek(date: Date) {
  const next = startOfUtcDay(date);
  const day = next.getUTCDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  next.setUTCDate(next.getUTCDate() + mondayOffset);
  return next;
}

function startOfUtcMonth(date: Date) {
  const next = startOfUtcDay(date);
  next.setUTCDate(1);
  return next;
}

function isWithinRange(date: Date, start: Date, end: Date) {
  return date >= start && date <= end;
}

function maxDate(primary: Date, candidate: Date | null) {
  if (!candidate) {
    return primary;
  }
  return candidate > primary ? candidate : primary;
}

function minDate(primary: Date, candidate: Date | null) {
  if (!candidate) {
    return primary;
  }
  return candidate < primary ? candidate : primary;
}

function roundCurrency(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
