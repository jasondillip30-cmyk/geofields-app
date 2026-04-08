import { ProjectStatus, RigStatus, UrgencyLevel } from "@prisma/client";
import { NextResponse, type NextRequest } from "next/server";

import { requireAnyApiPermission, requireApiPermission } from "@/lib/auth/api-guard";
import { auditActorFromSession, recordAuditLog } from "@/lib/audit";
import { normalizeBreakdownStatus } from "@/lib/breakdown-lifecycle";
import { prisma } from "@/lib/prisma";

function parseSeverity(value: unknown): UrgencyLevel {
  if (typeof value !== "string") {
    return UrgencyLevel.MEDIUM;
  }

  const upper = value.toUpperCase();
  if (upper in UrgencyLevel) {
    return UrgencyLevel[upper as keyof typeof UrgencyLevel];
  }
  return UrgencyLevel.MEDIUM;
}

export async function GET(request: NextRequest) {
  const auth = await requireAnyApiPermission(request, ["breakdowns:view", "inventory:view"]);
  if (!auth.ok) {
    return auth.response;
  }

  const projectId = normalizeNullableId(request.nextUrl.searchParams.get("projectId"));
  const rigId = normalizeNullableId(request.nextUrl.searchParams.get("rigId"));
  const statusFilter = parseStatusFilter(request.nextUrl.searchParams.get("status"));

  const records = await prisma.breakdownReport.findMany({
    where: {
      ...(projectId ? { projectId } : {}),
      ...(rigId ? { rigId } : {})
    },
    orderBy: { createdAt: "desc" },
    include: {
      client: { select: { name: true } },
      project: { select: { id: true, name: true, status: true } },
      rig: { select: { id: true, rigCode: true, status: true } },
      reportedBy: { select: { fullName: true, role: true } }
    }
  });

  const filtered = records
    .map((record) => ({
      ...record,
      status: normalizeBreakdownStatus(record.status)
    }))
    .filter((record) => {
      if (statusFilter === "all") {
        return true;
      }
      return record.status === statusFilter;
    });

  return NextResponse.json({ data: filtered });
}

export async function POST(request: NextRequest) {
  const auth = await requireApiPermission(request, "breakdowns:submit");
  if (!auth.ok) {
    return auth.response;
  }

  const body = await request.json().catch(() => null);
  const projectId = typeof body?.projectId === "string" ? body.projectId : "";
  const selectedRigId = typeof body?.rigId === "string" ? body.rigId : "";
  const title = typeof body?.title === "string" ? body.title.trim() : "";
  const description =
    typeof body?.description === "string" ? body.description.trim() : "";
  const downtimeRaw = Number(body?.downtimeHours ?? 0);
  const downtimeHours = Number.isFinite(downtimeRaw) && downtimeRaw > 0 ? downtimeRaw : 0;

  if (!projectId || !title) {
    return NextResponse.json(
      { message: "projectId and title are required." },
      { status: 400 }
    );
  }

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      clientId: true,
      assignedRigId: true,
      backupRigId: true,
      status: true
    }
  });

  if (!project) {
    return NextResponse.json({ message: "Project not found." }, { status: 404 });
  }

  const allowedRigIds = [project.assignedRigId, project.backupRigId].filter(
    (value): value is string => Boolean(value)
  );
  if (allowedRigIds.length === 0) {
    return NextResponse.json(
      { message: "This project has no assigned rig. Assign a rig to the project first." },
      { status: 400 }
    );
  }
  if (selectedRigId && !allowedRigIds.includes(selectedRigId)) {
    return NextResponse.json(
      { message: "Selected rig is not assigned to this project. Choose one of the project rigs." },
      { status: 400 }
    );
  }
  const rigId = selectedRigId || project.assignedRigId || project.backupRigId;
  if (!rigId) {
    return NextResponse.json(
      { message: "This project has no assigned rig. Assign a rig to the project first." },
      { status: 400 }
    );
  }

  const created = await prisma.$transaction(async (tx) => {
    const createdRecord = await tx.breakdownReport.create({
      data: {
        projectId: project.id,
        clientId: project.clientId,
        rigId,
        reportedById: auth.session.userId,
        title,
        description: description || title,
        severity: parseSeverity(body?.severity),
        downtimeHours,
        status: "OPEN",
        photoUrls: typeof body?.photoUrls === "string" ? body.photoUrls : null
      }
    });

    if (project.status !== ProjectStatus.COMPLETED && project.status !== ProjectStatus.ON_HOLD) {
      await tx.project.update({
        where: { id: project.id },
        data: {
          status: ProjectStatus.ON_HOLD
        }
      });
    }

    await tx.rig.update({
      where: { id: rigId },
      data: {
        status: RigStatus.BREAKDOWN
      }
    });

    await recordAuditLog({
      db: tx,
      module: "breakdowns",
      entityType: "breakdown_report",
      entityId: createdRecord.id,
      action: "create",
      description: `${auth.session.name} reported breakdown "${title}".`,
      after: {
        breakdownId: createdRecord.id,
        projectId: project.id,
        rigId,
        status: "OPEN",
        projectStatusApplied: project.status === ProjectStatus.COMPLETED ? null : "ON_HOLD",
        rigStatusApplied: "BREAKDOWN"
      },
      actor: auditActorFromSession(auth.session)
    });

    return createdRecord;
  });

  return NextResponse.json(
    {
      data: {
        ...created,
        status: "OPEN"
      }
    },
    { status: 201 }
  );
}

function normalizeNullableId(value: string | null) {
  if (!value || value === "all") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseStatusFilter(value: string | null): "OPEN" | "RESOLVED" | "all" {
  if (!value || value === "all") {
    return "all";
  }
  const normalized = value.trim().toUpperCase();
  if (
    normalized === "OPEN" ||
    normalized === "SUBMITTED" ||
    normalized === "IN_PROGRESS" ||
    normalized === "UNDER_REVIEW"
  ) {
    return "OPEN";
  }
  if (normalized === "RESOLVED" || normalized === "COMPLETED" || normalized === "CLOSED") {
    return "RESOLVED";
  }
  return "all";
}
