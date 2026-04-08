import { NextResponse, type NextRequest } from "next/server";

import { requireApiPermission } from "@/lib/auth/api-guard";
import { withFinancialDrillReportApproval } from "@/lib/financial-approval-policy";
import { prisma } from "@/lib/prisma";

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

  const where = withFinancialDrillReportApproval({
    ...(clientId ? { clientId } : {}),
    ...(rigId ? { rigId } : {}),
    ...(projectId ? { projectId } : {}),
    ...(fromDate ? { date: { gte: fromDate } } : {}),
    ...(toDate ? { date: { ...(fromDate ? { gte: fromDate } : {}), lte: toDate } } : {})
  });

  const reports = await prisma.drillReport.findMany({
    where,
    orderBy: [{ date: "asc" }, { createdAt: "asc" }],
    include: {
      client: { select: { id: true, name: true } },
      project: { select: { id: true, name: true } },
      rig: { select: { id: true, rigCode: true } }
    }
  });

  const trendMap = new Map<string, number>();
  const clientMap = new Map<string, { id: string; name: string; revenue: number }>();
  const projectMap = new Map<string, { id: string; name: string; revenue: number }>();
  const rigMap = new Map<string, { id: string; name: string; revenue: number }>();

  let totalRevenue = 0;
  const minDate = reports[0]?.date || null;
  const maxDate = reports[reports.length - 1]?.date || null;
  const dateRangeDays =
    minDate && maxDate ? Math.max(1, Math.floor((maxDate.getTime() - minDate.getTime()) / 86400000) + 1) : 0;
  const trendGranularity: "day" | "month" = dateRangeDays <= 31 ? "day" : "month";

  for (const report of reports) {
    const revenue = report.billableAmount;
    totalRevenue += revenue;

    const bucket = trendGranularity === "day" ? report.date.toISOString().slice(0, 10) : report.date.toISOString().slice(0, 7);
    trendMap.set(bucket, (trendMap.get(bucket) || 0) + revenue);

    clientMap.set(report.clientId, {
      id: report.clientId,
      name: report.client.name,
      revenue: (clientMap.get(report.clientId)?.revenue || 0) + revenue
    });

    projectMap.set(report.projectId, {
      id: report.projectId,
      name: report.project.name,
      revenue: (projectMap.get(report.projectId)?.revenue || 0) + revenue
    });

    rigMap.set(report.rigId, {
      id: report.rigId,
      name: report.rig.rigCode,
      revenue: (rigMap.get(report.rigId)?.revenue || 0) + revenue
    });
  }

  const revenueTrend = Array.from(trendMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([bucketStart, revenue]) => ({
      bucketStart,
      label: formatBucketLabel(bucketStart, trendGranularity),
      revenue
    }));

  const revenueByClient = sortRevenue(Array.from(clientMap.values()));
  const revenueByProject = sortRevenue(Array.from(projectMap.values()));
  const revenueByRig = sortRevenue(Array.from(rigMap.values()));

  return NextResponse.json({
    filters: {
      projectId: projectId || "all",
      clientId: clientId || "all",
      rigId: rigId || "all",
      from: fromParam,
      to: toParam
    },
    totals: {
      totalRevenue,
      reportsLogged: reports.length
    },
    trendGranularity,
    revenueTrend,
    monthlyTrend: revenueTrend,
    revenueByClient,
    revenueByProject,
    revenueByRig
  });
}

function sortRevenue(items: Array<{ id: string; name: string; revenue: number }>) {
  return [...items].sort((a, b) => b.revenue - a.revenue);
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
