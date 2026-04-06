import { ProjectStatus, RigStatus } from "@prisma/client";
import { NextResponse, type NextRequest } from "next/server";

import { requireApiPermission } from "@/lib/auth/api-guard";
import { auditActorFromSession, recordAuditLog } from "@/lib/audit";
import { isBreakdownOpenStatus, normalizeBreakdownStatus } from "@/lib/breakdown-lifecycle";
import { prisma } from "@/lib/prisma";

interface RouteParams {
  params: Promise<{
    breakdownId: string;
  }>;
}

export async function GET(request: NextRequest, context: RouteParams) {
  const auth = await requireApiPermission(request, "breakdowns:view");
  if (!auth.ok) {
    return auth.response;
  }

  const params = await context.params;
  const breakdownId = normalizeNullableId(params.breakdownId);
  if (!breakdownId) {
    return NextResponse.json({ message: "Breakdown id is required." }, { status: 400 });
  }

  const record = await prisma.breakdownReport.findUnique({
    where: { id: breakdownId },
    include: {
      client: { select: { id: true, name: true } },
      project: { select: { id: true, name: true, status: true } },
      rig: { select: { id: true, rigCode: true, status: true } },
      reportedBy: { select: { id: true, fullName: true, role: true } }
    }
  });

  if (!record) {
    return NextResponse.json({ message: "Breakdown not found." }, { status: 404 });
  }

  return NextResponse.json({
    data: {
      ...record,
      status: normalizeBreakdownStatus(record.status)
    }
  });
}

export async function PATCH(request: NextRequest, context: RouteParams) {
  const auth = await requireApiPermission(request, "breakdowns:submit");
  if (!auth.ok) {
    return auth.response;
  }

  const params = await context.params;
  const breakdownId = normalizeNullableId(params.breakdownId);
  if (!breakdownId) {
    return NextResponse.json({ message: "Breakdown id is required." }, { status: 400 });
  }

  const payload = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const action = normalizeText(payload?.action);
  if (action !== "resolve") {
    return NextResponse.json(
      { message: "Unsupported breakdown action. Supported action: resolve." },
      { status: 400 }
    );
  }
  const resolutionNote = normalizeNullableText(payload?.resolutionNote);

  const existing = await prisma.breakdownReport.findUnique({
    where: { id: breakdownId },
    include: {
      project: {
        select: {
          id: true,
          status: true
        }
      },
      rig: {
        select: {
          id: true,
          status: true
        }
      }
    }
  });

  if (!existing) {
    return NextResponse.json({ message: "Breakdown not found." }, { status: 404 });
  }

  if (!isBreakdownOpenStatus(existing.status)) {
    return NextResponse.json({
      data: {
        id: existing.id,
        status: "RESOLVED"
      }
    });
  }

  const openLinkedMaintenanceCount = await prisma.maintenanceRequest.count({
    where: {
      breakdownReportId: existing.id,
      status: {
        in: ["OPEN", "IN_REPAIR", "WAITING_FOR_PARTS"]
      }
    }
  });
  if (openLinkedMaintenanceCount > 0) {
    return NextResponse.json(
      {
        message:
          "This breakdown still has open linked maintenance records. Complete linked maintenance first or unlink it before resolving the breakdown.",
        data: {
          id: existing.id,
          openLinkedMaintenanceCount
        }
      },
      { status: 409 }
    );
  }

  const updated = await prisma.$transaction(async (tx) => {
    const next = await tx.breakdownReport.update({
      where: { id: breakdownId },
      data: {
        status: "RESOLVED"
      },
      include: {
        project: { select: { id: true, status: true } },
        rig: { select: { id: true, status: true } }
      }
    });

    const [projectBreakdowns, rigBreakdowns] = await Promise.all([
      tx.breakdownReport.findMany({
        where: {
          projectId: next.projectId,
          id: {
            not: next.id
          }
        },
        select: { status: true }
      }),
      tx.breakdownReport.findMany({
        where: {
          rigId: next.rigId,
          id: {
            not: next.id
          }
        },
        select: { status: true }
      })
    ]);

    const hasOtherOpenProjectBreakdown = projectBreakdowns.some((row) =>
      isBreakdownOpenStatus(row.status)
    );
    const hasOtherOpenRigBreakdown = rigBreakdowns.some((row) =>
      isBreakdownOpenStatus(row.status)
    );

    let projectStatusApplied: ProjectStatus | null = null;
    if (!hasOtherOpenProjectBreakdown && next.project.status === ProjectStatus.ON_HOLD) {
      projectStatusApplied = ProjectStatus.ACTIVE;
      await tx.project.update({
        where: { id: next.projectId },
        data: {
          status: ProjectStatus.ACTIVE
        }
      });
    }

    let rigStatusApplied: RigStatus | null = null;
    if (!hasOtherOpenRigBreakdown) {
      const activeAssignments = await tx.project.count({
        where: {
          assignedRigId: next.rigId,
          status: ProjectStatus.ACTIVE
        }
      });
      rigStatusApplied = activeAssignments > 0 ? RigStatus.ACTIVE : RigStatus.IDLE;
      await tx.rig.update({
        where: { id: next.rigId },
        data: {
          status: rigStatusApplied
        }
      });
    }

    await recordAuditLog({
      db: tx,
      module: "breakdowns",
      entityType: "breakdown_report",
      entityId: next.id,
      action: "resolve",
      description: `${auth.session.name} resolved breakdown "${next.title}".`,
      before: {
        status: normalizeBreakdownStatus(existing.status),
        projectStatus: existing.project.status,
        rigStatus: existing.rig.status
      },
      after: {
        status: "RESOLVED",
        projectStatusApplied,
        rigStatusApplied,
        resolutionNote: resolutionNote || null
      },
      actor: auditActorFromSession(auth.session)
    });

    return next;
  });

  return NextResponse.json({
    data: {
      id: updated.id,
      status: "RESOLVED"
    }
  });
}

function normalizeNullableId(value: string | null | undefined) {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function normalizeNullableText(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
