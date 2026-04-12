import { NextResponse, type NextRequest } from "next/server";

import { requireAnyApiPermission } from "@/lib/auth/api-guard";
import { withFinancialDrillReportApproval } from "@/lib/financial-approval-policy";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  const auth = await requireAnyApiPermission(request, ["finance:view", "drilling:view"]);
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

  const reports = await prisma.drillReport.findMany({
    where,
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    select: {
      id: true,
      date: true,
      holeNumber: true,
      totalMetersDrilled: true,
      workHours: true,
      delayHours: true,
      rigMoves: true,
      operatorCrew: true,
      leadOperatorName: true,
      assistantCount: true,
      submittedById: true,
      rig: {
        select: {
          rigCode: true
        }
      }
    }
  });

  return NextResponse.json({
    filters: {
      projectId: projectId || "all",
      clientId: clientId || "all",
      rigId: rigId || "all",
      from: fromParam,
      to: toParam
    },
    rows: reports.map((report) => ({
      id: report.id,
      date: report.date.toISOString(),
      holeNumber: report.holeNumber,
      rigCode: report.rig?.rigCode || "-",
      totalMetersDrilled: safeNumber(report.totalMetersDrilled),
      workHours: safeNumber(report.workHours),
      delayHours: safeNumber(report.delayHours),
      rigMoves: safeNumber(report.rigMoves),
      crew: formatCrewSummary({
        leadOperatorName: report.leadOperatorName,
        assistantCount: report.assistantCount,
        operatorCrew: report.operatorCrew
      }),
      submittedById: report.submittedById || null
    }))
  });
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

function safeNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatCrewSummary(report: {
  leadOperatorName: string | null;
  assistantCount: number;
  operatorCrew: string | null;
}) {
  const leadOperatorName = report.leadOperatorName?.trim() || "";
  const operatorCrew = report.operatorCrew?.trim() || "";
  const assistantCount = Math.max(0, Math.round(Number(report.assistantCount || 0)));
  if (leadOperatorName && assistantCount > 0) {
    return `${leadOperatorName} + ${assistantCount} assistant${assistantCount === 1 ? "" : "s"}`;
  }
  if (leadOperatorName) {
    return leadOperatorName;
  }
  if (assistantCount > 0) {
    return `${assistantCount} assistant${assistantCount === 1 ? "" : "s"}`;
  }
  if (operatorCrew) {
    return operatorCrew;
  }
  return "Crew not recorded";
}
