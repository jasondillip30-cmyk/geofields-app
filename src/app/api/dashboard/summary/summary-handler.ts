import type { Prisma } from "@prisma/client";
import { NextResponse, type NextRequest } from "next/server";

import { requireApiPermission } from "@/lib/auth/api-guard";
import {
  getFinancialInclusionPolicy,
  withFinancialDrillReportApproval
} from "@/lib/financial-approval-policy";
import { debugLog } from "@/lib/observability";
import { prisma } from "@/lib/prisma";
import { parseReceiptSubmissionPayload } from "@/lib/receipt-intake-submission";
import { buildRecognizedSpendContext } from "@/lib/recognized-spend-context";
import {
  buildActualVsForecastProfit,
  buildEmptyRecognizedSpendContext,
  buildProjectAssignments,
  buildRecommendations,
  buildRigStatusData,
  buildTrendKey,
  calculateMargin,
  calculatePercent,
  endOfUtcDay,
  extractErrorMessage,
  extractRouteLine,
  formatBucketLabel,
  nullableFilter,
  parseDateOrNull,
  resolveEffectiveRange,
  resolveTrendGranularity,
  roundCurrency,
  sortByRevenue,
  startOfUtcDay,
  startOfUtcWeek,
  upsertRigProfit
} from "./summary-utils";

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
  | "pending inventory usage approvals"
  | "receipt submissions query"
  | "rejected expenses this week"
  | "rejected reports this week"
  | "rejected inventory usage this week"
  | "approved expenses today"
  | "approved reports today"
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

    const spendContext = await runSection(
      "expenses query",
      () =>
        buildRecognizedSpendContext({
          clientId,
          rigId,
          fromDate,
          toDate
        }),
      buildEmptyRecognizedSpendContext()
    );
    const rawExpenses = spendContext.rawExpenses;
    const recognizedExpenses = spendContext.recognizedExpenses;
    const recognizedExpenseResult = {
      stats: spendContext.recognitionStats
    };

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
      expenseDates: recognizedExpenses.map((entry) => entry.date)
    });
    const effectiveRange = resolveEffectiveRange({
      fromDate,
      toDate,
      reportDates: reports.map((entry) => entry.date),
      expenseDates: recognizedExpenses.map((entry) => entry.date)
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
    let approvedIntentAmount = 0;
    for (const expense of recognizedExpenses) {
      totalExpenses += expense.amount;
      const status = expense.approvalStatus as ExpenseStatusKey;
      if (status in expenseStatusCounts) {
        expenseStatusCounts[status] += 1;
      }
      if (expense.approvalStatus === "APPROVED") {
        approvedIntentAmount += expense.amount;
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
      meta: {
        expenseBasis: "recognized" as const
      },
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
        recognizedSpend: roundCurrency(totalExpenses),
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
          pendingInventoryUsageApprovals +
          pendingReceiptSubmissions,
        rejectedThisWeek:
          rejectedExpensesThisWeek +
          rejectedReportsThisWeek +
          rejectedInventoryUsageThisWeek +
          rejectedReceiptSubmissionsThisWeek,
        approvedToday:
          approvedExpensesToday +
          approvedReportsToday +
          approvedInventoryUsageToday +
          approvedReceiptSubmissionsToday,
        approvalBreakdown: {
          pending: {
            expenses: pendingExpenseApprovals,
            drillingReports: pendingReportApprovals,
            inventoryUsage: pendingInventoryUsageApprovals,
            receiptSubmissions: pendingReceiptSubmissions
          },
          rejectedThisWeek: {
            expenses: rejectedExpensesThisWeek,
            drillingReports: rejectedReportsThisWeek,
            inventoryUsage: rejectedInventoryUsageThisWeek,
            receiptSubmissions: rejectedReceiptSubmissionsThisWeek
          },
          approvedToday: {
            expenses: approvedExpensesToday,
            drillingReports: approvedReportsToday,
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
      operationalPurposeSummary: {
        totalRecognizedSpend: spendContext.purposeTotals.recognizedSpendTotal,
        breakdownCost: spendContext.purposeTotals.breakdownCost,
        maintenanceCost: spendContext.purposeTotals.maintenanceCost,
        stockReplenishmentCost: spendContext.purposeTotals.stockReplenishmentCost,
        operatingCost: spendContext.purposeTotals.operatingCost,
        otherUnlinkedCost: spendContext.purposeTotals.otherUnlinkedCost
      },
      classificationAudit: spendContext.classificationAudit,
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

    debugLog(
      "[expense-visibility][dashboard-summary]",
      {
        rawExpenseCount: rawExpenses.length,
        recognizedExpenseCount: recognizedExpenses.length,
        recognition: recognizedExpenseResult.stats,
        recognizedTotalExpenses: roundCurrency(totalExpenses),
        recognizedApprovalIntentAmount: roundCurrency(approvedIntentAmount),
        purposeTotals: spendContext.purposeTotals,
        classificationAudit: spendContext.classificationAudit
      },
      { channel: "finance" }
    );

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
