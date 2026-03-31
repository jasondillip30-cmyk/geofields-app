import { ProjectStatus } from "@prisma/client";
import { NextResponse, type NextRequest } from "next/server";

import { requireApiPermission } from "@/lib/auth/api-guard";
import { auditActorFromSession, recordAuditLog } from "@/lib/audit";
import { prisma } from "@/lib/prisma";

function parseProjectStatus(value: unknown): ProjectStatus {
  if (typeof value !== "string") {
    return ProjectStatus.PLANNED;
  }

  const upper = value.toUpperCase();
  if (upper in ProjectStatus) {
    return ProjectStatus[upper as keyof typeof ProjectStatus];
  }
  return ProjectStatus.PLANNED;
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const auth = await requireApiPermission(request, "projects:manage");
  if (!auth.ok) {
    return auth.response;
  }

  const { projectId } = await params;
  const body = await request.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const clientId = typeof body?.clientId === "string" ? body.clientId : "";
  const location = typeof body?.location === "string" ? body.location.trim() : "";
  const startDate = typeof body?.startDate === "string" ? body.startDate : "";
  const rate = Number(body?.contractRatePerM ?? 0);

  if (!name || !clientId || !location || !startDate || Number.isNaN(rate)) {
    return NextResponse.json(
      { message: "name, clientId, location, startDate, and contractRatePerM are required." },
      { status: 400 }
    );
  }

  const existing = await prisma.project.findUnique({ where: { id: projectId } });
  if (!existing) {
    return NextResponse.json({ message: "Project not found." }, { status: 404 });
  }

  const updated = await prisma.$transaction(async (tx) => {
    const next = await tx.project.update({
      where: { id: projectId },
      data: {
        name,
        clientId,
        location,
        description: typeof body?.description === "string" ? body.description.trim() : null,
        photoUrl: typeof body?.photoUrl === "string" ? body.photoUrl.trim() : null,
        startDate: new Date(startDate),
        endDate: typeof body?.endDate === "string" && body.endDate ? new Date(body.endDate) : null,
        status: parseProjectStatus(body?.status),
        contractRatePerM: rate,
        assignedRigId: typeof body?.assignedRigId === "string" && body.assignedRigId ? body.assignedRigId : null,
        backupRigId: typeof body?.backupRigId === "string" && body.backupRigId ? body.backupRigId : null
      }
    });

    await recordAuditLog({
      db: tx,
      module: "projects",
      entityType: "project",
      entityId: projectId,
      action: "edit",
      description: `${auth.session.name} updated Project ${next.name}.`,
      before: projectAuditSnapshot(existing),
      after: projectAuditSnapshot(next),
      actor: auditActorFromSession(auth.session)
    });

    return next;
  });

  return NextResponse.json({ data: updated });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const auth = await requireApiPermission(request, "projects:manage");
  if (!auth.ok) {
    return auth.response;
  }

  const { projectId } = await params;
  const existing = await prisma.project.findUnique({ where: { id: projectId } });
  if (!existing) {
    return NextResponse.json({ message: "Project not found." }, { status: 404 });
  }

  await prisma.$transaction(async (tx) => {
    await tx.project.delete({ where: { id: projectId } });
    await recordAuditLog({
      db: tx,
      module: "projects",
      entityType: "project",
      entityId: projectId,
      action: "delete",
      description: `${auth.session.name} deleted Project ${existing.name}.`,
      before: projectAuditSnapshot(existing),
      actor: auditActorFromSession(auth.session)
    });
  });
  return NextResponse.json({ ok: true });
}

function projectAuditSnapshot(project: {
  id: string;
  name: string;
  clientId: string;
  location: string;
  status: string;
  assignedRigId: string | null;
  backupRigId: string | null;
  contractRatePerM: number;
}) {
  return {
    id: project.id,
    name: project.name,
    clientId: project.clientId,
    location: project.location,
    status: project.status,
    assignedRigId: project.assignedRigId,
    backupRigId: project.backupRigId,
    contractRatePerM: project.contractRatePerM
  };
}
