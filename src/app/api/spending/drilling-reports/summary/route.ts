import { NextResponse, type NextRequest } from "next/server";

import { requireAnyApiPermission } from "@/lib/auth/api-guard";
import { canAccess } from "@/lib/auth/permissions";
import { withFinancialDrillReportApproval } from "@/lib/financial-approval-policy";
import { prisma } from "@/lib/prisma";
import {
  buildSpendingStageProgress,
  normalizeSpendingStageBands,
  type SpendingStageBandInput
} from "@/lib/spending-stage-progress";

interface DrillingTimePeriodBucket {
  bucketKey: string;
  label: string;
  totalMeters: number;
  totalReports: number;
  totalWorkHours: number;
}

export async function GET(request: NextRequest) {
  const auth = await requireAnyApiPermission(request, ["finance:view", "drilling:view"]);
  if (!auth.ok) {
    return auth.response;
  }
  const canViewFinance = canAccess(auth.session.role, "finance:view");

  const fromParam = request.nextUrl.searchParams.get("from");
  const toParam = request.nextUrl.searchParams.get("to");
  const rawClientId = nullableFilter(request.nextUrl.searchParams.get("clientId"));
  const rawRigId = nullableFilter(request.nextUrl.searchParams.get("rigId"));
  const projectId = nullableFilter(request.nextUrl.searchParams.get("projectId"));
  const clientId = projectId ? null : rawClientId;
  const rigId = projectId ? null : rawRigId;
  const fromDate = parseDateOrNull(fromParam);
  const toDate = parseDateOrNull(toParam, true);

  const reportWhere = withFinancialDrillReportApproval({
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

  const movementWhere = {
    movementType: "OUT" as const,
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
  };

  const [reports, usageMovements, projectRateCard] = await Promise.all([
    prisma.drillReport.findMany({
      where: reportWhere,
      select: {
        date: true,
        holeNumber: true,
        totalMetersDrilled: true,
        workHours: true,
        fromMeter: true,
        toMeter: true
      }
    }),
    canViewFinance
      ? prisma.inventoryMovement.findMany({
          where: movementWhere,
          select: {
            totalCost: true
          }
        })
      : Promise.resolve([] as Array<{ totalCost: number }>),
    projectId
      ? prisma.project.findUnique({
          where: {
            id: projectId
          },
          select: {
            billingRateItems: {
              where: {
                isActive: true
              },
              select: {
                label: true,
                drillingStageLabel: true,
                depthBandStartM: true,
                depthBandEndM: true,
                sortOrder: true,
                unit: true
              }
            }
          }
        })
      : Promise.resolve(null)
  ]);

  const totalMeters = reports.reduce((sum, report) => sum + safeNumber(report.totalMetersDrilled), 0);
  const totalWorkHours = reports.reduce((sum, report) => sum + safeNumber(report.workHours), 0);
  const totalReports = reports.length;
  const timePeriod = buildDrillingTimePeriodBuckets(reports);
  const totalExpenses = canViewFinance
    ? usageMovements.reduce((sum, movement) => sum + safeNumber(movement.totalCost), 0)
    : 0;

  const rawStageBands = extractProjectStageBands(projectRateCard?.billingRateItems || []);
  const stageBands = normalizeSpendingStageBands(rawStageBands);
  const stageConfigured = stageBands.length > 0;
  const holeMap = new Map<string, { totalMeters: number; currentDepth: number }>();
  for (const report of reports) {
    const holeNumber = normalizeLabel(report.holeNumber, "Unknown hole");
    const totalMetersForReport = safeNumber(report.totalMetersDrilled);
    const depthForReport = Math.max(safeNumber(report.fromMeter), safeNumber(report.toMeter));
    const current = holeMap.get(holeNumber) || { totalMeters: 0, currentDepth: 0 };
    current.totalMeters += totalMetersForReport;
    current.currentDepth = Math.max(current.currentDepth, depthForReport);
    holeMap.set(holeNumber, current);
  }

  const metersByHole = Array.from(holeMap.entries())
    .map(([holeNumber, metrics]) => {
      const stageProgress = buildSpendingStageProgress({
        depthM: metrics.currentDepth,
        stageBands
      });
      return {
        holeNumber,
        totalMeters: roundMetric(metrics.totalMeters),
        percentOfMeters: totalMeters > 0 ? roundPercent((metrics.totalMeters / totalMeters) * 100) : 0,
        currentDepth: stageProgress.currentDepth,
        currentStageLabel: stageProgress.currentStageLabel,
        stageConfigured: stageProgress.stageConfigured,
        stageSegments: stageProgress.stageSegments
      };
    })
    .sort((left, right) => right.totalMeters - left.totalMeters);

  return NextResponse.json({
    filters: {
      projectId: projectId || "all",
      clientId: clientId || "all",
      rigId: rigId || "all",
      from: fromParam,
      to: toParam
    },
    timePeriod,
    summary: {
      totalMeters: roundMetric(totalMeters),
      totalReports,
      totalWorkHours: roundMetric(totalWorkHours),
      totalExpenses: canViewFinance ? roundCurrency(totalExpenses) : 0,
      totalCostPerMeter: canViewFinance && totalMeters > 0 ? roundCurrency(totalExpenses / totalMeters) : null
    },
    stageConfigured,
    metersByHole
  });
}

function buildDrillingTimePeriodBuckets(
  reports: Array<{
    date: Date;
    totalMetersDrilled: number;
    workHours: number;
  }>
) {
  const monthlyMap = new Map<string, { totalMeters: number; totalReports: number; totalWorkHours: number }>();
  const yearlyMap = new Map<string, { totalMeters: number; totalReports: number; totalWorkHours: number }>();

  for (const report of reports) {
    const monthKey = report.date.toISOString().slice(0, 7);
    const yearKey = report.date.toISOString().slice(0, 4);
    const totalMeters = safeNumber(report.totalMetersDrilled);
    const totalWorkHours = safeNumber(report.workHours);

    const monthEntry = monthlyMap.get(monthKey) || {
      totalMeters: 0,
      totalReports: 0,
      totalWorkHours: 0
    };
    monthEntry.totalMeters += totalMeters;
    monthEntry.totalReports += 1;
    monthEntry.totalWorkHours += totalWorkHours;
    monthlyMap.set(monthKey, monthEntry);

    const yearEntry = yearlyMap.get(yearKey) || {
      totalMeters: 0,
      totalReports: 0,
      totalWorkHours: 0
    };
    yearEntry.totalMeters += totalMeters;
    yearEntry.totalReports += 1;
    yearEntry.totalWorkHours += totalWorkHours;
    yearlyMap.set(yearKey, yearEntry);
  }

  const toBucketRows = (
    source: Map<string, { totalMeters: number; totalReports: number; totalWorkHours: number }>,
    labelResolver: (bucketKey: string) => string
  ) =>
    Array.from(source.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map<DrillingTimePeriodBucket>(([bucketKey, metrics]) => ({
        bucketKey,
        label: labelResolver(bucketKey),
        totalMeters: roundMetric(metrics.totalMeters),
        totalReports: Math.round(metrics.totalReports),
        totalWorkHours: roundMetric(metrics.totalWorkHours)
      }));

  return {
    monthly: toBucketRows(monthlyMap, formatMonthlyLabel),
    yearly: toBucketRows(yearlyMap, (bucketKey) => bucketKey)
  };
}

function extractProjectStageBands(
  billingRateItems: Array<{
    label: string;
    drillingStageLabel: string | null;
    depthBandStartM: number | null;
    depthBandEndM: number | null;
    sortOrder: number;
    unit: string;
  }>
) {
  return billingRateItems
    .filter((item) => item.unit.trim().toLowerCase() === "meter")
    .map<SpendingStageBandInput>((item) => ({
      label: item.drillingStageLabel || item.label,
      startM: item.depthBandStartM,
      endM: item.depthBandEndM,
      sortOrder: item.sortOrder
    }));
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

function normalizeLabel(value: string | null | undefined, fallback: string) {
  const trimmed = `${value || ""}`.trim();
  return trimmed || fallback;
}

function safeNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function roundMetric(value: number) {
  return Math.round(safeNumber(value) * 100) / 100;
}

function roundCurrency(value: number) {
  return Math.round(safeNumber(value) * 100) / 100;
}

function roundPercent(value: number) {
  return Math.round(safeNumber(value) * 100) / 100;
}

function formatMonthlyLabel(bucketKey: string) {
  const date = new Date(`${bucketKey}-01T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    return bucketKey;
  }
  const month = new Intl.DateTimeFormat("en-US", {
    month: "short",
    timeZone: "UTC"
  }).format(date);
  const year = date.toISOString().slice(2, 4);
  return `${month}'${year}`;
}
