import { NextResponse, type NextRequest } from "next/server";

import { auditActorFromSession, recordAuditLog } from "@/lib/audit";
import { requireApiPermission } from "@/lib/auth/api-guard";
import { prisma } from "@/lib/prisma";
import { canCloseProject, resolveProjectOperationalStatus, unclosedProjectWhere } from "@/lib/project-status-policy";

export async function POST(request: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const auth = await requireApiPermission(request, "projects:manage");
  if (!auth.ok) return auth.response;
  if (!canCloseProject(auth.session.role)) {
    return NextResponse.json({ message: "Only Managers and Admins can close projects." }, { status: 403 });
  }

  const { projectId } = await params;
  const now = new Date();
  return prisma.$transaction(async (tx) => {
    const project = await tx.project.findUnique({ where: { id: projectId } });
    if (!project) return NextResponse.json({ message: "Project not found." }, { status: 404 });
    const status = resolveProjectOperationalStatus(project, now);
    if (status === "COMPLETED") {
      return NextResponse.json({ data: { id: project.id, status, closedAt: project.closedAt } });
    }

    const updated = await tx.project.updateMany({
      where: { id: projectId, updatedAt: project.updatedAt, ...unclosedProjectWhere(now) },
      data: { closedAt: now }
    });
    if (!updated.count) {
      return NextResponse.json({ message: "The project changed. Refresh before closing it." }, { status: 409 });
    }
    await recordAuditLog({
      db: tx,
      module: "projects",
      entityType: "project",
      entityId: project.id,
      action: "close",
      description: `${auth.session.name} closed project ${project.name}.`,
      before: { status, closedAt: null },
      after: { status: "COMPLETED", closedAt: now.toISOString() },
      actor: auditActorFromSession(auth.session)
    });
    return NextResponse.json({ data: { id: project.id, status: "COMPLETED", closedAt: now } });
  });
}
