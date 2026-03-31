import type { EntryApprovalStatus } from "@prisma/client";
import { NextResponse, type NextRequest } from "next/server";

import { requireApiPermission } from "@/lib/auth/api-guard";
import { auditActorFromSession, recordAuditLog } from "@/lib/audit";
import { prisma } from "@/lib/prisma";

const reportInclude = {
  client: { select: { id: true, name: true } },
  project: { select: { id: true, name: true, status: true } },
  rig: { select: { id: true, rigCode: true, status: true } },
  submittedBy: { select: { id: true, fullName: true } },
  approvedBy: { select: { id: true, fullName: true } }
} as const;

type SubmissionMode = "draft" | "submit";

export async function GET(request: NextRequest) {
  const auth = await requireApiPermission(request, "drilling:view");
  if (!auth.ok) {
    return auth.response;
  }

  const fromDate = parseDateOrNull(request.nextUrl.searchParams.get("from"));
  const toDate = parseDateOrNull(request.nextUrl.searchParams.get("to"), true);
  const clientId = nullableFilter(request.nextUrl.searchParams.get("clientId"));
  const projectId = nullableFilter(request.nextUrl.searchParams.get("projectId"));
  const rigId = nullableFilter(request.nextUrl.searchParams.get("rigId"));
  const approvalStatus = parseApprovalStatusFilter(request.nextUrl.searchParams.get("approvalStatus"));

  const where = {
    ...(clientId ? { clientId } : {}),
    ...(projectId ? { projectId } : {}),
    ...(rigId ? { rigId } : {}),
    ...(approvalStatus ? { approvalStatus } : {}),
    ...(fromDate || toDate
      ? {
          date: {
            ...(fromDate ? { gte: fromDate } : {}),
            ...(toDate ? { lte: toDate } : {})
          }
        }
      : {})
  };

  const reports = await prisma.drillReport.findMany({
    where,
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    include: reportInclude
  });

  const stats = calculateStats(reports);

  return NextResponse.json({ data: reports, stats });
}

export async function POST(request: NextRequest) {
  const auth = await requireApiPermission(request, "drilling:submit");
  if (!auth.ok) {
    return auth.response;
  }

  const body = await request.json().catch(() => null);

  const date = typeof body?.date === "string" ? body.date : "";
  const projectId = typeof body?.projectId === "string" ? body.projectId : "";
  const rigId = typeof body?.rigId === "string" ? body.rigId : "";
  const holeNumber = typeof body?.holeNumber === "string" ? body.holeNumber.trim() : "";
  const areaLocation = typeof body?.areaLocation === "string" ? body.areaLocation.trim() : "";

  if (!date || !projectId || !rigId || !holeNumber || !areaLocation) {
    return NextResponse.json(
      { message: "date, projectId, rigId, holeNumber, and areaLocation are required." },
      { status: 400 }
    );
  }

  const [project, rig] = await Promise.all([
    prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, clientId: true, status: true, contractRatePerM: true }
    }),
    prisma.rig.findUnique({
      where: { id: rigId },
      select: { id: true, status: true }
    })
  ]);

  if (!project) {
    return NextResponse.json({ message: "Project not found." }, { status: 404 });
  }
  if (project.status !== "ACTIVE") {
    return NextResponse.json({ message: "Only ACTIVE projects can receive daily drilling reports." }, { status: 400 });
  }

  if (!rig) {
    return NextResponse.json({ message: "Rig not found." }, { status: 404 });
  }
  if (rig.status !== "ACTIVE") {
    return NextResponse.json({ message: "Only ACTIVE rigs can be used for daily drilling reports." }, { status: 400 });
  }

  const fromMeter = toNumber(body?.fromMeter);
  const toMeter = toNumber(body?.toMeter);
  const totalMetersFromInput = toNumber(body?.totalMetersDrilled);
  const totalMetersDrilled = totalMetersFromInput > 0 ? totalMetersFromInput : Math.max(0, toMeter - fromMeter);
  const billableAmount = roundCurrency(totalMetersDrilled * project.contractRatePerM);
  const approval = resolveInitialApprovalStatus(
    auth.session.role,
    parseSubmissionMode(typeof body?.submissionMode === "string" ? body.submissionMode : "")
  );

  const created = await prisma.$transaction(async (tx) => {
    const inserted = await tx.drillReport.create({
      data: {
        date: new Date(date),
        clientId: project.clientId,
        projectId,
        rigId,
        submittedById: auth.session.userId,
        approvalStatus: approval.status,
        submittedAt: approval.submittedAt,
        holeNumber,
        areaLocation,
        fromMeter,
        toMeter,
        totalMetersDrilled,
        workHours: toNumber(body?.workHours),
        rigMoves: Math.round(toNumber(body?.rigMoves)),
        standbyHours: toNumber(body?.standbyHours),
        delayHours: toNumber(body?.delayHours),
        comments: typeof body?.comments === "string" ? body.comments.trim() : null,
        operatorCrew: typeof body?.operatorCrew === "string" ? body.operatorCrew.trim() : null,
        billableAmount
      },
      include: reportInclude
    });

    await recordAuditLog({
      db: tx,
      module: "drilling_reports",
      entityType: "drilling_report",
      entityId: inserted.id,
      action: "create",
      description: `${auth.session.name} created Drilling Report ${inserted.id}.`,
      after: reportAuditSnapshot(inserted),
      actor: auditActorFromSession(auth.session)
    });

    return inserted;
  });

  const reports = await prisma.drillReport.findMany({
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    include: reportInclude
  });

  return NextResponse.json(
    {
      data: created,
      calculatedBillableAmount: billableAmount,
      stats: calculateStats(reports)
    },
    { status: 201 }
  );
}

function toNumber(value: unknown) {
  const numeric = Number(value ?? 0);
  return Number.isNaN(numeric) ? 0 : numeric;
}

function calculateStats(
  reports: Array<{
    totalMetersDrilled: number;
    billableAmount: number;
    workHours: number;
  }>
) {
  const reportsLogged = reports.length;
  const totalMeters = reports.reduce((sum, report) => sum + report.totalMetersDrilled, 0);
  const billableActivity = reports.reduce((sum, report) => sum + report.billableAmount, 0);
  const totalHours = reports.reduce((sum, report) => sum + report.workHours, 0);

  return {
    reportsLogged,
    totalMeters,
    billableActivity,
    averageWorkHours: reportsLogged > 0 ? totalHours / reportsLogged : 0
  };
}

function roundCurrency(value: number) {
  return Math.round(value * 100) / 100;
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

function parseApprovalStatusFilter(value: string | null): EntryApprovalStatus | null {
  if (!value || value === "all") {
    return null;
  }
  const normalized = value.toUpperCase();
  if (normalized === "DRAFT" || normalized === "SUBMITTED" || normalized === "APPROVED" || normalized === "REJECTED") {
    return normalized;
  }
  return null;
}

function parseSubmissionMode(value: string): SubmissionMode | null {
  if (value === "draft" || value === "submit") {
    return value;
  }
  return null;
}

function resolveInitialApprovalStatus(role: string, mode: SubmissionMode | null): {
  status: EntryApprovalStatus;
  submittedAt: Date | null;
} {
  if (mode === "draft") {
    return {
      status: "DRAFT",
      submittedAt: null
    };
  }
  if (mode === "submit") {
    return {
      status: "SUBMITTED",
      submittedAt: new Date()
    };
  }

  if (role === "ADMIN") {
    return {
      status: "DRAFT",
      submittedAt: null
    };
  }
  return {
    status: "SUBMITTED",
    submittedAt: new Date()
  };
}

function reportAuditSnapshot(report: {
  id: string;
  date: Date;
  projectId: string;
  rigId: string;
  clientId: string;
  totalMetersDrilled: number;
  billableAmount: number;
  approvalStatus: string;
  submittedAt: Date | null;
  approvedAt: Date | null;
  rejectionReason: string | null;
}) {
  return {
    id: report.id,
    date: report.date,
    projectId: report.projectId,
    rigId: report.rigId,
    clientId: report.clientId,
    totalMetersDrilled: report.totalMetersDrilled,
    billableAmount: report.billableAmount,
    approvalStatus: report.approvalStatus,
    submittedAt: report.submittedAt,
    approvedAt: report.approvedAt,
    rejectionReason: report.rejectionReason
  };
}
