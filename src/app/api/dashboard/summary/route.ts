import type { Prisma, RigStatus } from "@prisma/client";
import { NextResponse, type NextRequest } from "next/server";

import { requireApiPermission } from "@/lib/auth/api-guard";
import {
  getFinancialInclusionPolicy,
  withFinancialDrillReportApproval,
  withFinancialExpenseApproval
} from "@/lib/financial-approval-policy";
import { prisma } from "@/lib/prisma";
import { parseReceiptSubmissionPayload } from "@/lib/receipt-intake-submission";

interface FinancialBucket {
  revenue: number;
  expenses: number;
  profit: number;
}

interface RigProfitAccumulator {
  id: string;
  name: string;
  revenue: number;
  expenses: number;
  profit: number;
}

interface RigProfitSnapshot {
  id: string;
  name: string;
  revenue: number;
  expenses: number;
  profit: number;
  margin: number;
}

interface RecommendationItem {
  tone: "danger" | "warn" | "good";
  priority: "HIGH" | "MEDIUM" | "LOW";
  title: string;
  message: string;
  estimatedImpact: number | null;
  actions: string[];
  primaryActionLabel: "Take Action" | "View Details";
  secondaryActionLabel?: "Take Action" | "View Details";
}

type ExpenseStatusKey = "DRAFT" | "SUBMITTED" | "APPROVED" | "REJECTED";
type DashboardSectionKey =
  | "drill reports query"
  | "expenses query"
  | "rigs query"
  | "clients count query"
  | "projects query"
  | "rig usage query"
  | "pending expense approvals"
  | "pending report approvals"
  | "pending maintenance approvals"
  | "pending inventory usage approvals"
  | "receipt submissions query"
  | "rejected expenses this week"
  | "rejected reports this week"
  | "rejected maintenance this week"
  | "rejected inventory usage this week"
  | "approved expenses today"
  | "approved reports today"
  | "approved maintenance today"
  | "approved inventory usage today"
  | "inventory low stock count"
  | "inventory out of stock count";

interface DashboardSectionError {
  step: DashboardSectionKey;
  message: string;
  routeLine: string | null;
}

export async function GET(request: NextRequest) {
  const auth = await requireApiPermission(request, "dashboard:view");
  if (!auth.ok) {
    return auth.response;
  }

  let failingStep: string = "request setup";
  const sectionErrors: DashboardSectionError[] = [];
  try {
    const rawFilters = {
      from: request.nextUrl.searchParams.get("from"),
      to: request.nextUrl.searchParams.get("to"),
      clientId: request.nextUrl.searchParams.get("clientId"),
      rigId: request.nextUrl.searchParams.get("rigId")
    };

    const clientId = nullableFilter(rawFilters.clientId);
    const rigId = nullableFilter(rawFilters.rigId);
    const fromDate = parseDateOrNull(rawFilters.from);
    const toDate = parseDateOrNull(rawFilters.to, true);
    const hasDimensionFilter = Boolean(clientId || rigId);

    const runSection = async <T,>(step: DashboardSectionKey, task: () => Promise<T>, fallback: T): Promise<T> => {
      failingStep = step;
      try {
        return await task();
      } catch (error) {
        const sectionError: DashboardSectionError = {
          step,
          message: extractErrorMessage(error),
          routeLine: extractRouteLine(error)
        };
        sectionErrors.push(sectionError);
        console.error("[dashboard-summary][section-error]", {
          ...sectionError,
          stack: error instanceof Error ? error.stack : undefined
        });
        return fallback;
      }
    };

    const drillWhere: Prisma.DrillReportWhereInput = withFinancialDrillReportApproval({
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

    const expenseWhere: Prisma.ExpenseWhereInput = withFinancialExpenseApproval({
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

    const now = new Date();
    const todayStart = startOfUtcDay(now);
    const todayEnd = endOfUtcDay(now);
    const weekStart = startOfUtcWeek(now);

    const reports = await runSection(
      "drill reports query",
      () =>
        prisma.drillReport.findMany({
          where: drillWhere,
          orderBy: [{ date: "asc" }, { createdAt: "asc" }],
          include: {
            client: { select: { id: true, name: true } },
            project: { select: { id: true, name: true, location: true, status: true, contractRatePerM: true } },
            rig: { select: { id: true, rigCode: true } }
          }
        }),
      []
    );

    const expenses = await runSection(
      "expenses query",
      () =>
        prisma.expense.findMany({
          where: expenseWhere,
          orderBy: [{ date: "asc" }, { createdAt: "asc" }],
          include: {
            project: { select: { id: true, name: true } },
            rig: { select: { id: true, rigCode: true } },
            client: { select: { id: true, name: true } }
          }
        }),
      []
    );

    const rigs = await runSection(
      "rigs query",
      () =>
        prisma.rig.findMany({
          where: {
            ...(rigId ? { id: rigId } : {})
          },
          select: { id: true, rigCode: true, status: true }
        }),
      []
    );

    const clientsCount = await runSection("clients count query", () => prisma.client.count(), 0);

    const projects = await runSection(
      "projects query",
      () =>
        prisma.project.findMany({
          include: {
            assignedRig: { select: { id: true, rigCode: true } }
          },
          orderBy: { createdAt: "desc" }
        }),
      []
    );

    const rigUsageLinks = await runSection(
      "rig usage query",
      () =>
        prisma.rigUsage.findMany({
          where: {
            ...(clientId ? { clientId } : {}),
            ...(rigId ? { rigId } : {})
          },
          select: {
            rigId: true,
            clientId: true,
            projectId: true
          }
        }),
      []
    );

    const pendingExpenseApprovals = await runSection(
      "pending expense approvals",
      () =>
        prisma.expense.count({
          where: {
            ...(clientId ? { clientId } : {}),
            ...(rigId ? { rigId } : {}),
            ...(fromDate || toDate
              ? {
                  date: {
                    ...(fromDate ? { gte: fromDate } : {}),
                    ...(toDate ? { lte: toDate } : {})
                  }
                }
              : {}),
            approvalStatus: "SUBMITTED"
          }
        }),
      0
    );

    const pendingReportApprovals = await runSection(
      "pending report approvals",
      () =>
        prisma.drillReport.count({
          where: {
            ...(clientId ? { clientId } : {}),
            ...(rigId ? { rigId } : {}),
            ...(fromDate || toDate
              ? {
                  date: {
                    ...(fromDate ? { gte: fromDate } : {}),
                    ...(toDate ? { lte: toDate } : {})
                  }
                }
              : {}),
            approvalStatus: "SUBMITTED"
          }
        }),
      0
    );

    const pendingMaintenanceApprovals = await runSection(
      "pending maintenance approvals",
      () =>
        prisma.maintenanceRequest.count({
          where: {
            ...(clientId ? { clientId } : {}),
            ...(rigId ? { rigId } : {}),
            ...(fromDate || toDate
              ? {
                  requestDate: {
                    ...(fromDate ? { gte: fromDate } : {}),
                    ...(toDate ? { lte: toDate } : {})
                  }
                }
              : {}),
            status: "SUBMITTED"
          }
        }),
      0
    );

    const pendingInventoryUsageApprovals = await runSection(
      "pending inventory usage approvals",
      () =>
        prisma.inventoryUsageRequest.count({
          where: {
            ...(rigId ? { rigId } : {}),
            ...(clientId ? { project: { clientId } } : {}),
            ...(fromDate || toDate
              ? {
                  createdAt: {
                    ...(fromDate ? { gte: fromDate } : {}),
                    ...(toDate ? { lte: toDate } : {})
                  }
                }
              : {}),
            status: {
              in: ["SUBMITTED", "PENDING"]
            }
          }
        }),
      0
    );

    const receiptSubmissionRows = await runSection(
      "receipt submissions query",
      () =>
        prisma.summaryReport.findMany({
          where: {
            reportType: "INVENTORY_RECEIPT_SUBMISSION",
            ...(clientId ? { clientId } : {})
          },
          select: {
            reportDate: true,
            payloadJson: true
          }
        }),
      [] as Array<{ reportDate: Date; payloadJson: string }>
    );

    const rejectedExpensesThisWeek = await runSection(
      "rejected expenses this week",
      () =>
        prisma.expense.count({
          where: {
            ...(clientId ? { clientId } : {}),
            ...(rigId ? { rigId } : {}),
            approvalStatus: "REJECTED",
            approvedAt: {
              gte: weekStart,
              lte: now
            }
          }
        }),
      0
    );

    const rejectedReportsThisWeek = await runSection(
      "rejected reports this week",
      () =>
        prisma.drillReport.count({
          where: {
            ...(clientId ? { clientId } : {}),
            ...(rigId ? { rigId } : {}),
            approvalStatus: "REJECTED",
            approvedAt: {
              gte: weekStart,
              lte: now
            }
          }
        }),
      0
    );

    const rejectedMaintenanceThisWeek = await runSection(
      "rejected maintenance this week",
      () =>
        prisma.maintenanceRequest.count({
          where: {
            ...(clientId ? { clientId } : {}),
            ...(rigId ? { rigId } : {}),
            status: "DENIED",
            updatedAt: {
              gte: weekStart,
              lte: now
            }
          }
        }),
      0
    );

    const rejectedInventoryUsageThisWeek = await runSection(
      "rejected inventory usage this week",
      () =>
        prisma.inventoryUsageRequest.count({
          where: {
            ...(rigId ? { rigId } : {}),
            ...(clientId ? { project: { clientId } } : {}),
            status: "REJECTED",
            decidedAt: {
              gte: weekStart,
              lte: now
            }
          }
        }),
      0
    );

    const approvedExpensesToday = await runSection(
      "approved expenses today",
      () =>
        prisma.expense.count({
          where: {
            ...(clientId ? { clientId } : {}),
            ...(rigId ? { rigId } : {}),
            approvalStatus: "APPROVED",
            approvedAt: {
              gte: todayStart,
              lte: todayEnd
            }
          }
        }),
      0
    );

    const approvedReportsToday = await runSection(
      "approved reports today",
      () =>
        prisma.drillReport.count({
          where: {
            ...(clientId ? { clientId } : {}),
            ...(rigId ? { rigId } : {}),
            approvalStatus: "APPROVED",
            approvedAt: {
              gte: todayStart,
              lte: todayEnd
            }
          }
        }),
      0
    );

    const approvedMaintenanceToday = await runSection(
      "approved maintenance today",
      () =>
        prisma.maintenanceRequest.count({
          where: {
            ...(clientId ? { clientId } : {}),
            ...(rigId ? { rigId } : {}),
            status: "APPROVED",
            updatedAt: {
              gte: todayStart,
              lte: todayEnd
            }
          }
        }),
      0
    );

    const approvedInventoryUsageToday = await runSection(
      "approved inventory usage today",
      () =>
        prisma.inventoryUsageRequest.count({
          where: {
            ...(rigId ? { rigId } : {}),
            ...(clientId ? { project: { clientId } } : {}),
            status: "APPROVED",
            decidedAt: {
              gte: todayStart,
              lte: todayEnd
            }
          }
        }),
      0
    );

    let pendingReceiptSubmissions = 0;
    let rejectedReceiptSubmissionsThisWeek = 0;
    let approvedReceiptSubmissionsToday = 0;

    for (const row of receiptSubmissionRows) {
      const parsed = parseReceiptSubmissionPayload(row.payloadJson);
      if (!parsed || !parsed.normalizedDraft) {
        continue;
      }
      if (rigId && parsed.normalizedDraft.linkContext.rigId !== rigId) {
        continue;
      }

      const inAppliedDateRange = (!fromDate || row.reportDate >= fromDate) && (!toDate || row.reportDate <= toDate);
      if (parsed.status === "SUBMITTED" && inAppliedDateRange) {
        pendingReceiptSubmissions += 1;
        continue;
      }
      if (parsed.status === "REJECTED" && row.reportDate >= weekStart && row.reportDate <= now) {
        rejectedReceiptSubmissionsThisWeek += 1;
        continue;
      }
      if (parsed.status === "APPROVED" && row.reportDate >= todayStart && row.reportDate <= todayEnd) {
        approvedReceiptSubmissionsToday += 1;
      }
    }

    const inventoryLowStockCount = await runSection(
      "inventory low stock count",
      async () => {
        const inventoryRows = await prisma.inventoryItem.findMany({
          select: {
            quantityInStock: true,
            minimumStockLevel: true
          }
        });
        return inventoryRows.filter(
          (item) => item.quantityInStock > 0 && item.quantityInStock <= item.minimumStockLevel
        ).length;
      },
      0
    );

    const inventoryOutOfStockCount = await runSection(
      "inventory out of stock count",
      () =>
        prisma.inventoryItem.count({
          where: {
            quantityInStock: {
              lte: 0
            }
          }
        }),
      0
    );

    const trendGranularity = resolveTrendGranularity({
      fromDate,
      toDate,
      reportDates: reports.map((entry) => entry.date),
      expenseDates: expenses.map((entry) => entry.date)
    });
    const effectiveRange = resolveEffectiveRange({
      fromDate,
      toDate,
      reportDates: reports.map((entry) => entry.date),
      expenseDates: expenses.map((entry) => entry.date)
    });

    const financialTrendMap = new Map<string, FinancialBucket>();
    const dailyProfitMap = new Map<string, number>();
    const metersTrendMap = new Map<string, number>();
    const revenueByClientMap = new Map<string, { id: string; name: string; revenue: number }>();
    const revenueByRigMap = new Map<string, { id: string; name: string; revenue: number }>();
    const rigProfitMap = new Map<string, RigProfitAccumulator>();
    const expenseCategoryMap = new Map<string, { category: string; amount: number }>();

    const activeClientIds = new Set<string>();
    const activeProjectIds = new Set<string>();
    const activeRigIds = new Set<string>();
    const expenseStatusCounts: Record<ExpenseStatusKey, number> = {
      DRAFT: 0,
      SUBMITTED: 0,
      APPROVED: 0,
      REJECTED: 0
    };

    let totalRevenue = 0;
    let totalMeters = 0;
    for (const report of reports) {
      const revenue = report.billableAmount;
      totalRevenue += revenue;
      totalMeters += report.totalMetersDrilled;

      activeClientIds.add(report.clientId);
      activeProjectIds.add(report.projectId);
      activeRigIds.add(report.rigId);

      const bucket = buildTrendKey(report.date, trendGranularity);
      const trend = financialTrendMap.get(bucket) || { revenue: 0, expenses: 0, profit: 0 };
      trend.revenue += revenue;
      trend.profit += revenue;
      financialTrendMap.set(bucket, trend);

      const dayBucket = buildTrendKey(report.date, "day");
      dailyProfitMap.set(dayBucket, (dailyProfitMap.get(dayBucket) || 0) + revenue);

      metersTrendMap.set(bucket, (metersTrendMap.get(bucket) || 0) + report.totalMetersDrilled);

      revenueByClientMap.set(report.clientId, {
        id: report.clientId,
        name: report.client.name,
        revenue: (revenueByClientMap.get(report.clientId)?.revenue || 0) + revenue
      });

      revenueByRigMap.set(report.rigId, {
        id: report.rigId,
        name: report.rig.rigCode,
        revenue: (revenueByRigMap.get(report.rigId)?.revenue || 0) + revenue
      });

      const rigProfit = upsertRigProfit(rigProfitMap, report.rigId, report.rig.rigCode);
      rigProfit.revenue += revenue;
      rigProfit.profit += revenue;
    }

    let totalExpenses = 0;
    let approvedExpenses = 0;
    for (const expense of expenses) {
      totalExpenses += expense.amount;
      const status = expense.approvalStatus as ExpenseStatusKey;
      if (status in expenseStatusCounts) {
        expenseStatusCounts[status] += 1;
      }
      if (expense.approvalStatus === "APPROVED") {
        approvedExpenses += expense.amount;
      }

      if (expense.clientId) activeClientIds.add(expense.clientId);
      if (expense.projectId) activeProjectIds.add(expense.projectId);
      if (expense.rigId) activeRigIds.add(expense.rigId);

      const bucket = buildTrendKey(expense.date, trendGranularity);
      const trend = financialTrendMap.get(bucket) || { revenue: 0, expenses: 0, profit: 0 };
      trend.expenses += expense.amount;
      trend.profit -= expense.amount;
      financialTrendMap.set(bucket, trend);

      const dayBucket = buildTrendKey(expense.date, "day");
      dailyProfitMap.set(dayBucket, (dailyProfitMap.get(dayBucket) || 0) - expense.amount);

      const category = expense.category || "Uncategorized";
      expenseCategoryMap.set(category, {
        category,
        amount: (expenseCategoryMap.get(category)?.amount || 0) + expense.amount
      });

      if (expense.rigId) {
        const rigName = expense.rig?.rigCode || "Unknown Rig";
        const rigProfit = upsertRigProfit(rigProfitMap, expense.rigId, rigName);
        rigProfit.expenses += expense.amount;
        rigProfit.profit -= expense.amount;
      }
    }

    const grossProfit = totalRevenue - totalExpenses;

    const financialTrend = Array.from(financialTrendMap.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([bucketStart, row]) => ({
        bucketStart,
        label: formatBucketLabel(bucketStart, trendGranularity),
        revenue: roundCurrency(row.revenue),
        expenses: roundCurrency(row.expenses),
        profit: roundCurrency(row.profit)
      }));

    const metersTrend = Array.from(metersTrendMap.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([bucketStart, meters]) => ({
        bucketStart,
        label: formatBucketLabel(bucketStart, trendGranularity),
        meters: roundCurrency(meters)
      }));

    const revenueByClient = sortByRevenue(
      Array.from(revenueByClientMap.values()).map((entry) => ({
        id: entry.id,
        name: entry.name,
        revenue: roundCurrency(entry.revenue)
      }))
    );

    const revenueByRig = sortByRevenue(
      Array.from(revenueByRigMap.values()).map((entry) => ({
        id: entry.id,
        name: entry.name,
        revenue: roundCurrency(entry.revenue)
      }))
    );

    const expenseBreakdown = Array.from(expenseCategoryMap.values())
      .map((entry) => ({ category: entry.category, amount: roundCurrency(entry.amount) }))
      .sort((a, b) => b.amount - a.amount);

    const scopedClientIds = new Set<string>();
    const scopedProjectIds = new Set<string>();
    const scopedRigIds = new Set<string>();
    const rigUsageProjectIds = new Set<string>();

    if (clientId) {
      scopedClientIds.add(clientId);
    }
    if (rigId) {
      scopedRigIds.add(rigId);
    }

    for (const usage of rigUsageLinks) {
      scopedClientIds.add(usage.clientId);
      scopedProjectIds.add(usage.projectId);
      scopedRigIds.add(usage.rigId);
      rigUsageProjectIds.add(usage.projectId);
    }

    for (const project of projects) {
      const matchesClient = !clientId || project.clientId === clientId;
      if (!matchesClient) {
        continue;
      }

      const matchesRigByAssignment = !rigId || project.assignedRigId === rigId || project.backupRigId === rigId;
      const matchesRigByUsage = !rigId || rigUsageProjectIds.has(project.id);
      if (!matchesRigByAssignment && !matchesRigByUsage) {
        continue;
      }

      scopedProjectIds.add(project.id);
      scopedClientIds.add(project.clientId);
      if (project.assignedRigId) {
        scopedRigIds.add(project.assignedRigId);
      }
      if (project.backupRigId) {
        scopedRigIds.add(project.backupRigId);
      }
    }

    for (const id of activeClientIds) {
      scopedClientIds.add(id);
    }
    for (const id of activeProjectIds) {
      scopedProjectIds.add(id);
    }
    for (const id of activeRigIds) {
      scopedRigIds.add(id);
    }

    let scopedRigs = rigs;
    if (hasDimensionFilter) {
      if (rigId) {
        scopedRigs = rigs;
      } else {
        scopedRigs = rigs.filter((rig) => scopedRigIds.has(rig.id));
      }
    }

    const totalClientsInScope = hasDimensionFilter ? scopedClientIds.size : clientsCount;
    const totalProjectsInScope = hasDimensionFilter ? scopedProjectIds.size : projects.length;
    const totalRigsInScope = hasDimensionFilter ? scopedRigs.length : rigs.length;

    const rigStatusData = buildRigStatusData(scopedRigs.map((rig) => rig.status));

    const projectAssignments = buildProjectAssignments({
      projects,
      clientId,
      rigId,
      shouldRestrictToScope: hasDimensionFilter,
      scopedProjectIds
    });
    const avgDailyProfit = grossProfit / effectiveRange.days;
    const forecastNext7Profit = roundCurrency(avgDailyProfit * 7);
    const forecastNext30Profit = roundCurrency(avgDailyProfit * 30);
    const projectedTotalProfit30 = roundCurrency(grossProfit + forecastNext30Profit);
    const actualVsForecastProfit = buildActualVsForecastProfit({
      dailyProfitMap,
      avgDailyProfit,
      endDate: effectiveRange.end,
      daysForward: 30
    });
    const rigProfitSnapshots: RigProfitSnapshot[] = Array.from(rigProfitMap.values()).map((entry) => ({
      id: entry.id,
      name: entry.name,
      revenue: roundCurrency(entry.revenue),
      expenses: roundCurrency(entry.expenses),
      profit: roundCurrency(entry.profit),
      margin: calculateMargin(entry.profit, entry.revenue)
    }));
    const forecastByRig = rigProfitSnapshots
      .map((entry) => {
        const avgRigDailyProfit = entry.profit / effectiveRange.days;
        return {
          id: entry.id,
          name: entry.name,
          currentProfit: roundCurrency(entry.profit),
          avgDailyProfit: roundCurrency(avgRigDailyProfit),
          forecastNext30Profit: roundCurrency(avgRigDailyProfit * 30),
          margin: roundCurrency(entry.margin)
        };
      })
      .sort((a, b) => b.forecastNext30Profit - a.forecastNext30Profit);
    const topForecastRig = forecastByRig[0]?.name || "No data in filters";
    const topForecastRigId = forecastByRig[0]?.id || null;
    const noRevenueLabel = reports.length === 0 ? "No revenue in filters" : "N/A";
    const expenseCategoryShares = Array.from(expenseCategoryMap.values())
      .map((entry) => ({
        category: entry.category,
        amount: roundCurrency(entry.amount),
        percentOfTotal: calculatePercent(entry.amount, totalExpenses)
      }))
      .sort((a, b) => b.amount - a.amount);
    const recommendations = buildRecommendations({
      grossProfit,
      forecastNext30Profit,
      totalExpenses,
      daysInScope: effectiveRange.days,
      rigSnapshots: rigProfitSnapshots,
      expenseCategoryShares,
      inventoryLowStockCount,
      inventoryOutOfStockCount
    });

    const responsePayload = {
      ok: sectionErrors.length === 0,
      sectionErrors,
      financialInclusionPolicy: getFinancialInclusionPolicy(),
      filters: {
        clientId: clientId || "all",
        rigId: rigId || "all",
        from: request.nextUrl.searchParams.get("from"),
        to: request.nextUrl.searchParams.get("to")
      },
      snapshot: {
        totalClients: totalClientsInScope,
        totalProjects: totalProjectsInScope,
        totalRigs: totalRigsInScope,
        activeRigs: scopedRigs.filter((rig) => rig.status === "ACTIVE").length,
        idleRigs: scopedRigs.filter((rig) => rig.status === "IDLE").length,
        maintenanceRigs: scopedRigs.filter((rig) => rig.status === "MAINTENANCE").length,
        totalRevenue: roundCurrency(totalRevenue),
        totalExpenses: roundCurrency(totalExpenses),
        approvedExpenses: roundCurrency(approvedExpenses),
        grossProfit: roundCurrency(grossProfit),
        totalMeters: roundCurrency(totalMeters),
        bestPerformingClient: revenueByClient[0]?.name || noRevenueLabel,
        bestPerformingClientId: revenueByClient[0]?.id || null,
        bestPerformingRig: revenueByRig[0]?.name || noRevenueLabel,
        bestPerformingRigId: revenueByRig[0]?.id || null,
        topRevenueRig: revenueByRig[0]?.name || noRevenueLabel,
        topRevenueRigId: revenueByRig[0]?.id || null,
        topForecastRig,
        topForecastRigId,
        pendingApprovals:
          pendingExpenseApprovals +
          pendingReportApprovals +
          pendingMaintenanceApprovals +
          pendingInventoryUsageApprovals +
          pendingReceiptSubmissions,
        rejectedThisWeek:
          rejectedExpensesThisWeek +
          rejectedReportsThisWeek +
          rejectedMaintenanceThisWeek +
          rejectedInventoryUsageThisWeek +
          rejectedReceiptSubmissionsThisWeek,
        approvedToday:
          approvedExpensesToday +
          approvedReportsToday +
          approvedMaintenanceToday +
          approvedInventoryUsageToday +
          approvedReceiptSubmissionsToday,
        approvalBreakdown: {
          pending: {
            expenses: pendingExpenseApprovals,
            drillingReports: pendingReportApprovals,
            maintenance: pendingMaintenanceApprovals,
            inventoryUsage: pendingInventoryUsageApprovals,
            receiptSubmissions: pendingReceiptSubmissions
          },
          rejectedThisWeek: {
            expenses: rejectedExpensesThisWeek,
            drillingReports: rejectedReportsThisWeek,
            maintenance: rejectedMaintenanceThisWeek,
            inventoryUsage: rejectedInventoryUsageThisWeek,
            receiptSubmissions: rejectedReceiptSubmissionsThisWeek
          },
          approvedToday: {
            expenses: approvedExpensesToday,
            drillingReports: approvedReportsToday,
            maintenance: approvedMaintenanceToday,
            inventoryUsage: approvedInventoryUsageToday,
            receiptSubmissions: approvedReceiptSubmissionsToday
          }
        },
        inventoryLowStockCount,
        inventoryOutOfStockCount
      },
      trendGranularity,
      financialTrend,
      revenueByClient,
      revenueByRig,
      metersTrend,
      rigStatusData,
      expenseBreakdown,
      projectAssignments,
      expenseStatusCounts,
      profitForecast: {
        daysInScope: effectiveRange.days,
        avgDailyProfit: roundCurrency(avgDailyProfit),
        forecastNext7Profit,
        forecastNext30Profit,
        projectedTotalProfit30,
        topForecastRig,
        actualVsForecastProfit,
        forecastByRig
      },
      recommendations
    };

    return NextResponse.json(responsePayload);
  } catch (error) {
    console.error("[expense-visibility][dashboard-summary][error]", {
      step: failingStep,
      message: error instanceof Error ? error.message : "Unknown error",
      stack: error instanceof Error ? error.stack : undefined,
      filters: {
        from: request.nextUrl.searchParams.get("from"),
        to: request.nextUrl.searchParams.get("to"),
        clientId: request.nextUrl.searchParams.get("clientId"),
        rigId: request.nextUrl.searchParams.get("rigId")
      }
    });

    return NextResponse.json({
      ok: false,
      step: failingStep,
      message: extractErrorMessage(error),
      sectionErrors,
      ...(process.env.NODE_ENV === "production"
        ? {}
        : {
            stack: error instanceof Error ? error.stack : undefined
          })
    }, { status: 500 });
  }
}

function nullableFilter(value: string | null) {
  return value && value !== "all" ? value : null;
}

function extractErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return "Unknown error";
}

function extractRouteLine(error: unknown) {
  if (!(error instanceof Error) || !error.stack) {
    return null;
  }
  const lineMatch = error.stack.match(/route\.ts:(\d+:\d+)/);
  return lineMatch ? `route.ts:${lineMatch[1]}` : null;
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

function resolveEffectiveRange({
  fromDate,
  toDate,
  reportDates,
  expenseDates
}: {
  fromDate: Date | null;
  toDate: Date | null;
  reportDates: Date[];
  expenseDates: Date[];
}) {
  const allDates = [...reportDates, ...expenseDates];
  const minDate = findDateBoundary(allDates, "min");
  const maxDate = findDateBoundary(allDates, "max");

  const start = fromDate || minDate || startOfUtcDay(new Date());
  let end = toDate || maxDate || endOfUtcDay(start);
  if (end.getTime() < start.getTime()) {
    end = endOfUtcDay(start);
  }

  return {
    start,
    end,
    days: inclusiveRangeDays(start, end)
  };
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

function sortByRevenue<T extends { revenue: number }>(items: T[]) {
  return [...items].sort((a, b) => b.revenue - a.revenue);
}

function upsertRigProfit(map: Map<string, RigProfitAccumulator>, id: string, name: string) {
  const current = map.get(id) || {
    id,
    name,
    revenue: 0,
    expenses: 0,
    profit: 0
  };

  if ((!current.name || current.name.startsWith("Unknown")) && name) {
    current.name = name;
  }

  map.set(id, current);
  return current;
}

function buildActualVsForecastProfit({
  dailyProfitMap,
  avgDailyProfit,
  endDate,
  daysForward
}: {
  dailyProfitMap: Map<string, number>;
  avgDailyProfit: number;
  endDate: Date;
  daysForward: number;
}) {
  const rows: Array<{
    bucketStart: string;
    label: string;
    actualProfit: number | null;
    forecastProfit: number | null;
  }> = [];

  const sortedDays = Array.from(dailyProfitMap.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  let cumulativeProfit = 0;
  for (const [bucketStart, profit] of sortedDays) {
    cumulativeProfit += profit;
    rows.push({
      bucketStart,
      label: formatBucketLabel(bucketStart, "day"),
      actualProfit: roundCurrency(cumulativeProfit),
      forecastProfit: null
    });
  }

  const anchorDate = sortedDays.length > 0 ? parseDayKey(sortedDays[sortedDays.length - 1][0]) : startOfUtcDay(endDate);
  for (let index = 1; index <= daysForward; index += 1) {
    const futureDate = addUtcDays(anchorDate, index);
    const bucketStart = futureDate.toISOString().slice(0, 10);
    cumulativeProfit += avgDailyProfit;
    rows.push({
      bucketStart,
      label: formatBucketLabel(bucketStart, "day"),
      actualProfit: null,
      forecastProfit: roundCurrency(cumulativeProfit)
    });
  }

  return rows;
}

function buildRigStatusData(statuses: RigStatus[]) {
  const counters: Record<RigStatus, number> = {
    ACTIVE: 0,
    IDLE: 0,
    MAINTENANCE: 0,
    BREAKDOWN: 0
  };

  for (const status of statuses) {
    counters[status] += 1;
  }

  return Object.entries(counters)
    .map(([status, value]) => ({ status, value }))
    .filter((entry) => entry.value > 0);
}

function buildProjectAssignments({
  projects,
  clientId,
  rigId,
  shouldRestrictToScope,
  scopedProjectIds
}: {
  projects: Array<{
    id: string;
    clientId: string;
    name: string;
    location: string;
    status: string;
    contractRatePerM: number;
    assignedRigId: string | null;
    backupRigId: string | null;
    assignedRig: { id: string; rigCode: string } | null;
  }>;
  clientId: string | null;
  rigId: string | null;
  shouldRestrictToScope: boolean;
  scopedProjectIds: Set<string>;
}) {
  return projects
    .filter((project) => {
      if (clientId && project.clientId !== clientId) {
        return false;
      }

      if (rigId && project.assignedRigId !== rigId && project.backupRigId !== rigId && !scopedProjectIds.has(project.id)) {
        return false;
      }

      if (shouldRestrictToScope && scopedProjectIds.size > 0 && !scopedProjectIds.has(project.id)) {
        return false;
      }
      if (shouldRestrictToScope && scopedProjectIds.size === 0) {
        return false;
      }

      return true;
    })
    .map((project) => ({
      id: project.id,
      name: project.name,
      location: project.location,
      status: project.status,
      assignedRigCode: project.assignedRig?.rigCode || "Unassigned",
      contractRatePerM: project.contractRatePerM
    }));
}

function findDateBoundary(dates: Date[], type: "min" | "max") {
  if (dates.length === 0) {
    return null;
  }

  let boundary = dates[0];
  for (const date of dates) {
    const isEarlier = date.getTime() < boundary.getTime();
    const isLater = date.getTime() > boundary.getTime();
    if ((type === "min" && isEarlier) || (type === "max" && isLater)) {
      boundary = date;
    }
  }

  return type === "min" ? startOfUtcDay(boundary) : endOfUtcDay(boundary);
}

function parseDayKey(dayKey: string) {
  return new Date(`${dayKey}T00:00:00.000Z`);
}

function startOfUtcDay(date: Date) {
  const normalized = new Date(date);
  normalized.setUTCHours(0, 0, 0, 0);
  return normalized;
}

function endOfUtcDay(date: Date) {
  const normalized = new Date(date);
  normalized.setUTCHours(23, 59, 59, 999);
  return normalized;
}

function startOfUtcWeek(date: Date) {
  const normalized = startOfUtcDay(date);
  const day = normalized.getUTCDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  normalized.setUTCDate(normalized.getUTCDate() + mondayOffset);
  return normalized;
}

function addUtcDays(date: Date, days: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function buildRecommendations({
  grossProfit,
  forecastNext30Profit,
  totalExpenses,
  daysInScope,
  rigSnapshots,
  expenseCategoryShares,
  inventoryLowStockCount,
  inventoryOutOfStockCount
}: {
  grossProfit: number;
  forecastNext30Profit: number;
  totalExpenses: number;
  daysInScope: number;
  rigSnapshots: RigProfitSnapshot[];
  expenseCategoryShares: Array<{ category: string; amount: number; percentOfTotal: number }>;
  inventoryLowStockCount: number;
  inventoryOutOfStockCount: number;
}) {
  const recommendations: RecommendationItem[] = [];

  const safeDays = Math.max(1, daysInScope);
  const addRecommendation = (item: RecommendationItem) => {
    if (!recommendations.some((entry) => entry.title === item.title)) {
      recommendations.push(item);
    }
  };

  if (inventoryOutOfStockCount > 0) {
    addRecommendation({
      tone: "danger",
      priority: "HIGH",
      title: "Inventory Stockout Risk",
      message: `${inventoryOutOfStockCount} inventory item(s) are out of stock. Expedite purchasing for critical maintenance parts.`,
      estimatedImpact: null,
      actions: [
        "Prioritize emergency purchase orders for critical stockouts.",
        "Review impacted rigs and maintenance tasks immediately.",
        "Track stockout closure in daily operations standup."
      ],
      primaryActionLabel: "Take Action",
      secondaryActionLabel: "View Details"
    });
  } else if (inventoryLowStockCount > 0) {
    addRecommendation({
      tone: "warn",
      priority: "MEDIUM",
      title: "Inventory Low Stock",
      message: `${inventoryLowStockCount} item(s) are below minimum stock levels and trending toward stockout.`,
      estimatedImpact: null,
      actions: [
        "Raise replenishment requests for low-stock parts.",
        "Increase monitoring cadence for fast-moving components.",
        "Align stock plans with maintenance workload forecasts."
      ],
      primaryActionLabel: "View Details",
      secondaryActionLabel: "Take Action"
    });
  }

  if (grossProfit < 0) {
    const breakEvenReductionPercent = totalExpenses > 0 ? calculatePercent(Math.abs(grossProfit), totalExpenses) : 0;
    const targetReductionPercent = Math.max(20, breakEvenReductionPercent);
    const expenseReductionImpact =
      totalExpenses > 0 ? roundCurrency((targetReductionPercent / 100) * totalExpenses) : Math.abs(grossProfit);

    addRecommendation({
      tone: "danger",
      priority: "HIGH",
      title: "Loss Alert",
      message:
        breakEvenReductionPercent > 20
          ? `Business is operating at a loss. Reduce total expenses by at least 20% immediately; full break-even needs about ${formatPercent(
              breakEvenReductionPercent
            )}.`
          : "Business is operating at a loss. Reduce total expenses by at least 20% to break even.",
      estimatedImpact: expenseReductionImpact,
      actions: [
        "Cut non-essential operating spend this week.",
        "Review top cost centers and set hard reduction targets.",
        "Escalate unprofitable contracts for commercial review."
      ],
      primaryActionLabel: "Take Action",
      secondaryActionLabel: "View Details"
    });
  }

  if (forecastNext30Profit < 0) {
    addRecommendation({
      tone: "danger",
      priority: "HIGH",
      title: "Forecast Risk",
      message: "Projected losses will continue if no changes are made.",
      estimatedImpact: Math.abs(forecastNext30Profit),
      actions: [
        "Apply immediate cost controls on low-efficiency rigs.",
        "Increase utilization of high-margin rigs.",
        "Reassign rigs from weak projects to stronger contracts."
      ],
      primaryActionLabel: "Take Action",
      secondaryActionLabel: "View Details"
    });
  }

  const lossMakingRigs = [...rigSnapshots].filter((rig) => rig.profit < 0).sort((a, b) => a.profit - b.profit);
  for (const rig of lossMakingRigs.slice(0, 2)) {
    const dailyLoss = roundCurrency(Math.abs(rig.profit) / safeDays);
    const monthlyRecovery = roundCurrency(dailyLoss * 30);
    addRecommendation({
      tone: dailyLoss >= 300 ? "danger" : "warn",
      priority: dailyLoss >= 300 ? "HIGH" : "MEDIUM",
      title: `Rig Action: ${rig.name}`,
      message: `Rig ${rig.name} is losing ${formatCurrencyAmount(dailyLoss)}/day.`,
      estimatedImpact: monthlyRecovery,
      actions: [
        "Reduce operating costs on this rig.",
        "Increase drilling rate and billable output.",
        "Reassign to a higher-paying project."
      ],
      primaryActionLabel: "Take Action",
      secondaryActionLabel: "View Details"
    });
  }

  const dominantCategory = expenseCategoryShares.find((category) => category.percentOfTotal > 50);
  if (dominantCategory) {
    const reductionImpact = roundCurrency(dominantCategory.amount * 0.1);
    addRecommendation({
      tone: dominantCategory.percentOfTotal >= 70 ? "danger" : "warn",
      priority: dominantCategory.percentOfTotal >= 70 ? "HIGH" : "MEDIUM",
      title: "Cost Concentration",
      message: `${dominantCategory.category} represents ${formatPercent(
        dominantCategory.percentOfTotal
      )} of costs. Reducing by 10% would improve profit by ${formatCurrencyAmount(reductionImpact)}.`,
      estimatedImpact: reductionImpact,
      actions: [
        `Audit ${dominantCategory.category} consumption and waste.`,
        "Negotiate supplier pricing and enforce purchase controls.",
        "Track weekly variance against budget."
      ],
      primaryActionLabel: "View Details",
      secondaryActionLabel: "Take Action"
    });
  }

  const bestMarginRig = [...rigSnapshots]
    .filter((rig) => rig.revenue > 0 && rig.profit > 0)
    .sort((a, b) => {
      if (b.margin !== a.margin) {
        return b.margin - a.margin;
      }
      return b.profit - a.profit;
    })[0];
  if (bestMarginRig) {
    const dailyGain = roundCurrency(bestMarginRig.profit / safeDays);
    const utilizationImpact = roundCurrency(dailyGain * 30 * 0.2);
    addRecommendation({
      tone: "good",
      priority: "LOW",
      title: "Best Opportunity",
      message: `${bestMarginRig.name} generates ${formatCurrencyAmount(
        dailyGain
      )}/day. Increasing utilization by 20% could add ~${formatCurrencyAmount(utilizationImpact)}/month.`,
      estimatedImpact: utilizationImpact,
      actions: [
        "Prioritize this rig on high-rate projects.",
        "Minimize standby and movement downtime.",
        "Maintain preventive service to protect uptime."
      ],
      primaryActionLabel: "Take Action",
      secondaryActionLabel: "View Details"
    });
  }

  if (recommendations.length < 3 && totalExpenses > 0) {
    const topCategory = expenseCategoryShares[0];
    if (topCategory) {
      const impact = roundCurrency(topCategory.amount * 0.05);
      addRecommendation({
        tone: "warn",
        priority: "MEDIUM",
        title: "Spend Review",
        message: `A focused 5% reduction in ${topCategory.category} can improve profit by about ${formatCurrencyAmount(
          impact
        )}.`,
        estimatedImpact: impact,
        actions: [
          "Set category-specific approval thresholds.",
          "Review weekly spend against forecast.",
          "Escalate unexpected variances early."
        ],
        primaryActionLabel: "View Details",
        secondaryActionLabel: "Take Action"
      });
    }
  }

  if (recommendations.length < 3 && lossMakingRigs.length === 0 && grossProfit >= 0) {
    addRecommendation({
      tone: "good",
      priority: "LOW",
      title: "Portfolio Health",
      message: "Current rig portfolio is profitable. Keep reallocating capacity toward high-margin work.",
      estimatedImpact: null,
      actions: [
        "Maintain weekly margin monitoring.",
        "Protect uptime on top-performing rigs.",
        "Scale profitable project allocation."
      ],
      primaryActionLabel: "View Details"
    });
  }

  if (recommendations.length < 3) {
    const fallbackItems: RecommendationItem[] = [
      {
        tone: "warn",
        priority: "MEDIUM",
        title: "Cost Discipline",
        message: "Reduce costs on low-performing rigs and monitor fuel, salary, and maintenance trends weekly.",
        estimatedImpact: null,
        actions: ["Define rig-level cost ceilings.", "Run weekly variance reviews.", "Escalate repeated overruns quickly."],
        primaryActionLabel: "Take Action",
        secondaryActionLabel: "View Details"
      },
      {
        tone: "good",
        priority: "LOW",
        title: "Utilization Strategy",
        message: "Increase usage of high-margin rigs on billable projects to improve overall profitability.",
        estimatedImpact: null,
        actions: [
          "Prioritize dispatching efficient rigs first.",
          "Reduce idle transition time between projects.",
          "Track utilization uplift weekly."
        ],
        primaryActionLabel: "Take Action",
        secondaryActionLabel: "View Details"
      },
      {
        tone: "warn",
        priority: "MEDIUM",
        title: "Operational Review",
        message: "Review rig-to-project assignment and move underperforming rigs to stronger contracts where possible.",
        estimatedImpact: null,
        actions: [
          "Compare project rates against rig cost profiles.",
          "Rebalance assignments each planning cycle.",
          "Validate improvement after reassignment."
        ],
        primaryActionLabel: "View Details",
        secondaryActionLabel: "Take Action"
      }
    ];

    for (const fallback of fallbackItems) {
      if (recommendations.length >= 3) {
        break;
      }
      addRecommendation(fallback);
    }
  }

  return recommendations.slice(0, 5);
}

function calculateMargin(profit: number, revenue: number) {
  if (revenue === 0) {
    return 0;
  }
  return roundCurrency((profit / revenue) * 100);
}

function calculatePercent(value: number, total: number) {
  if (total === 0) {
    return 0;
  }
  return roundCurrency((value / total) * 100);
}

function formatPercent(value: number) {
  const rounded = roundCurrency(value);
  return Number.isInteger(rounded) ? `${rounded.toFixed(0)}%` : `${rounded.toFixed(1)}%`;
}

function formatCurrencyAmount(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0
  }).format(value);
}

function roundCurrency(value: number) {
  return Math.round(value * 100) / 100;
}
