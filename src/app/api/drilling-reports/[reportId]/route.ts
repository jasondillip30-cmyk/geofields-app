import { NextResponse, type NextRequest } from "next/server";

import { requireApiPermission } from "@/lib/auth/api-guard";
import { canUseElevatedDrillingEdit } from "@/lib/auth/approval-policy";
import { auditActorFromSession, recordAuditLog } from "@/lib/audit";
import { prisma } from "@/lib/prisma";

const reportInclude = {
  client: { select: { id: true, name: true } },
  project: { select: { id: true, name: true, status: true } },
  rig: { select: { id: true, rigCode: true, status: true } },
  submittedBy: { select: { id: true, fullName: true } },
  approvedBy: { select: { id: true, fullName: true } }
} as const;

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ reportId: string }> }
) {
  const auth = await requireApiPermission(request, "drilling:submit");
  if (!auth.ok) {
    return auth.response;
  }

  const { reportId } = await params;
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

  const existing = await prisma.drillReport.findUnique({
    where: { id: reportId },
    include: reportInclude
  });
  if (!existing) {
    return NextResponse.json({ message: "Drilling report not found." }, { status: 404 });
  }

  if (existing.approvalStatus === "APPROVED" || existing.approvalStatus === "SUBMITTED") {
    return NextResponse.json(
      { message: "Only draft or rejected drilling reports can be edited." },
      { status: 409 }
    );
  }

  const isOwner = existing.submittedById === auth.session.userId;
  if (!canUseElevatedDrillingEdit(auth.session.role) && !isOwner) {
    return NextResponse.json(
      { message: "You can only edit drilling reports that you created." },
      { status: 403 }
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

  const updated = await prisma.$transaction(async (tx) => {
    const next = await tx.drillReport.update({
      where: { id: reportId },
      data: {
        date: new Date(date),
        clientId: project.clientId,
        projectId,
        rigId,
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
      entityId: reportId,
      action: "edit",
      description: `${auth.session.name} edited Drilling Report ${reportId}.`,
      before: reportAuditSnapshot(existing),
      after: reportAuditSnapshot(next),
      actor: auditActorFromSession(auth.session)
    });

    return next;
  });

  return NextResponse.json({ data: updated });
}

function toNumber(value: unknown) {
  const numeric = Number(value ?? 0);
  return Number.isNaN(numeric) ? 0 : numeric;
}

function roundCurrency(value: number) {
  return Math.round(value * 100) / 100;
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
