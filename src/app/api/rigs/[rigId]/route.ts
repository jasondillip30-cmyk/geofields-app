import { RigCondition, RigStatus } from "@prisma/client";
import { NextResponse, type NextRequest } from "next/server";

import { requireApiPermission } from "@/lib/auth/api-guard";
import { auditActorFromSession, recordAuditLog } from "@/lib/audit";
import { prisma } from "@/lib/prisma";

function parseRigStatus(value: unknown): RigStatus {
  if (typeof value !== "string") {
    return RigStatus.IDLE;
  }
  const upper = value.toUpperCase();
  if (upper in RigStatus) {
    return RigStatus[upper as keyof typeof RigStatus];
  }
  return RigStatus.IDLE;
}

function parseRigCondition(value: unknown): RigCondition {
  if (typeof value !== "string") {
    return RigCondition.GOOD;
  }
  const upper = value.toUpperCase();
  if (upper in RigCondition) {
    return RigCondition[upper as keyof typeof RigCondition];
  }
  return RigCondition.GOOD;
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ rigId: string }> }
) {
  const auth = await requireApiPermission(request, "rigs:manage");
  if (!auth.ok) {
    return auth.response;
  }

  const { rigId } = await params;
  const body = await request.json().catch(() => null);
  const rigCode = typeof body?.rigCode === "string" ? body.rigCode.trim() : "";
  const model = typeof body?.model === "string" ? body.model.trim() : "";
  const serialNumber = typeof body?.serialNumber === "string" ? body.serialNumber.trim() : "";

  if (!rigCode || !model || !serialNumber) {
    return NextResponse.json({ message: "rigCode, model, and serialNumber are required." }, { status: 400 });
  }

  const existing = await prisma.rig.findUnique({ where: { id: rigId } });
  if (!existing) {
    return NextResponse.json({ message: "Rig not found." }, { status: 404 });
  }

  const updated = await prisma.$transaction(async (tx) => {
    const next = await tx.rig.update({
      where: { id: rigId },
      data: {
        rigCode,
        model,
        serialNumber,
        photoUrl: typeof body?.photoUrl === "string" ? body.photoUrl.trim() : null,
        acquisitionDate: typeof body?.acquisitionDate === "string" && body.acquisitionDate ? new Date(body.acquisitionDate) : null,
        status: parseRigStatus(body?.status),
        condition: parseRigCondition(body?.condition),
        conditionScore: Number(body?.conditionScore ?? 80),
        totalHoursWorked: Number(body?.totalHoursWorked ?? 0),
        totalMetersDrilled: Number(body?.totalMetersDrilled ?? 0),
        totalLifetimeDays: Number(body?.totalLifetimeDays ?? 0)
      }
    });

    await recordAuditLog({
      db: tx,
      module: "rigs",
      entityType: "rig",
      entityId: rigId,
      action: "edit",
      description: `${auth.session.name} updated Rig ${next.rigCode}.`,
      before: rigAuditSnapshot(existing),
      after: rigAuditSnapshot(next),
      actor: auditActorFromSession(auth.session)
    });

    return next;
  });

  return NextResponse.json({ data: updated });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ rigId: string }> }
) {
  const auth = await requireApiPermission(request, "rigs:manage");
  if (!auth.ok) {
    return auth.response;
  }

  const { rigId } = await params;
  const existing = await prisma.rig.findUnique({ where: { id: rigId } });
  if (!existing) {
    return NextResponse.json({ message: "Rig not found." }, { status: 404 });
  }

  await prisma.$transaction(async (tx) => {
    await tx.rig.delete({ where: { id: rigId } });
    await recordAuditLog({
      db: tx,
      module: "rigs",
      entityType: "rig",
      entityId: rigId,
      action: "delete",
      description: `${auth.session.name} deleted Rig ${existing.rigCode}.`,
      before: rigAuditSnapshot(existing),
      actor: auditActorFromSession(auth.session)
    });
  });
  return NextResponse.json({ ok: true });
}

function rigAuditSnapshot(rig: {
  id: string;
  rigCode: string;
  model: string;
  serialNumber: string;
  status: string;
  condition: string;
  conditionScore: number;
  totalHoursWorked: number;
  totalMetersDrilled: number;
  totalLifetimeDays: number;
}) {
  return {
    id: rig.id,
    rigCode: rig.rigCode,
    model: rig.model,
    serialNumber: rig.serialNumber,
    status: rig.status,
    condition: rig.condition,
    conditionScore: rig.conditionScore,
    totalHoursWorked: rig.totalHoursWorked,
    totalMetersDrilled: rig.totalMetersDrilled,
    totalLifetimeDays: rig.totalLifetimeDays
  };
}
