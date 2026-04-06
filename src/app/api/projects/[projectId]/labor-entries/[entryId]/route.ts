import { NextResponse, type NextRequest } from "next/server";

import { requireApiPermission } from "@/lib/auth/api-guard";
import { auditActorFromSession, recordAuditLog } from "@/lib/audit";
import { prisma } from "@/lib/prisma";

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string; entryId: string }> }
) {
  const auth = await requireApiPermission(request, "projects:manage");
  if (!auth.ok) {
    return auth.response;
  }

  const { projectId, entryId } = await params;
  const body = await request.json().catch(() => null);
  const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
  if (!reason) {
    return NextResponse.json(
      { message: "Deletion reason is required for labor-entry correction audit." },
      { status: 400 }
    );
  }

  const existing = await prisma.projectLaborEntry.findUnique({
    where: { id: entryId },
    include: {
      project: {
        select: {
          id: true,
          name: true
        }
      },
      rig: {
        select: {
          id: true,
          rigCode: true
        }
      }
    }
  });

  if (!existing || existing.projectId !== projectId) {
    return NextResponse.json({ message: "Labor entry not found for this project." }, { status: 404 });
  }

  await prisma.$transaction(async (tx) => {
    await tx.projectLaborEntry.delete({
      where: { id: entryId }
    });

    await recordAuditLog({
      db: tx,
      module: "projects",
      entityType: "project_labor_entry",
      entityId: entryId,
      action: "delete",
      description: `${auth.session.name} deleted labor entry from project ${existing.project.name}.`,
      before: {
        id: existing.id,
        projectId: existing.projectId,
        rigId: existing.rigId,
        rigCode: existing.rig?.rigCode || null,
        workDate: existing.workDate.toISOString(),
        crewRole: existing.crewRole,
        personLabel: existing.personLabel,
        hoursWorked: existing.hoursWorked,
        hourlyRate: existing.hourlyRate,
        totalCost: existing.totalCost,
        notes: existing.notes
      },
      after: {
        deletionReason: reason
      },
      actor: auditActorFromSession(auth.session)
    });
  });

  return NextResponse.json({ ok: true });
}
