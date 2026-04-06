import { NextResponse, type NextRequest } from "next/server";

import { requireAnyApiPermission, requireApiPermission } from "@/lib/auth/api-guard";
import { auditActorFromSession, recordAuditLog } from "@/lib/audit";
import { prisma } from "@/lib/prisma";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const auth = await requireAnyApiPermission(request, ["projects:view", "finance:view"]);
  if (!auth.ok) {
    return auth.response;
  }

  const { projectId } = await params;
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true }
  });
  if (!project) {
    return NextResponse.json({ message: "Project not found." }, { status: 404 });
  }

  const entries = await prisma.projectLaborEntry.findMany({
    where: { projectId },
    orderBy: [{ workDate: "desc" }, { createdAt: "desc" }],
    include: {
      rig: {
        select: {
          id: true,
          rigCode: true
        }
      },
      createdBy: {
        select: {
          id: true,
          fullName: true
        }
      }
    }
  });

  return NextResponse.json({ data: entries });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const auth = await requireApiPermission(request, "projects:manage");
  if (!auth.ok) {
    return auth.response;
  }

  const { projectId } = await params;
  const body = await request.json().catch(() => null);

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, name: true }
  });
  if (!project) {
    return NextResponse.json({ message: "Project not found." }, { status: 404 });
  }

  const workDate = parseDate(body?.workDate);
  const hoursWorked = parsePositiveNumber(body?.hoursWorked);
  const hourlyRate = parsePositiveNumber(body?.hourlyRate);
  const crewRole = typeof body?.crewRole === "string" ? body.crewRole.trim() : "";
  const personLabel = typeof body?.personLabel === "string" ? body.personLabel.trim() : "";
  const notes = typeof body?.notes === "string" ? body.notes.trim() : "";
  const rigId = typeof body?.rigId === "string" && body.rigId.trim() ? body.rigId.trim() : null;

  if (!workDate) {
    return NextResponse.json({ message: "Valid workDate is required." }, { status: 400 });
  }
  if (hoursWorked === null) {
    return NextResponse.json({ message: "hoursWorked must be greater than zero." }, { status: 400 });
  }
  if (hourlyRate === null) {
    return NextResponse.json({ message: "hourlyRate must be greater than zero." }, { status: 400 });
  }

  if (rigId) {
    const rig = await prisma.rig.findUnique({
      where: { id: rigId },
      select: { id: true }
    });
    if (!rig) {
      return NextResponse.json({ message: "Selected rig was not found." }, { status: 400 });
    }
  }

  const totalCost = roundCurrency(hoursWorked * hourlyRate);

  const created = await prisma.$transaction(async (tx) => {
    const inserted = await tx.projectLaborEntry.create({
      data: {
        projectId,
        rigId,
        workDate,
        crewRole: crewRole || null,
        personLabel: personLabel || null,
        hoursWorked,
        hourlyRate,
        totalCost,
        notes: notes || null,
        createdByUserId: auth.session.userId
      },
      include: {
        rig: {
          select: {
            id: true,
            rigCode: true
          }
        },
        createdBy: {
          select: {
            id: true,
            fullName: true
          }
        }
      }
    });

    await recordAuditLog({
      db: tx,
      module: "projects",
      entityType: "project_labor_entry",
      entityId: inserted.id,
      action: "create",
      description: `${auth.session.name} added labor entry on project ${project.name}.`,
      after: {
        projectId: inserted.projectId,
        rigId: inserted.rigId,
        workDate: inserted.workDate.toISOString(),
        crewRole: inserted.crewRole,
        personLabel: inserted.personLabel,
        hoursWorked: inserted.hoursWorked,
        hourlyRate: inserted.hourlyRate,
        totalCost: inserted.totalCost,
        notes: inserted.notes
      },
      actor: auditActorFromSession(auth.session)
    });

    return inserted;
  });

  return NextResponse.json({ data: created }, { status: 201 });
}

function parseDate(value: unknown) {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed;
}

function parsePositiveNumber(value: unknown) {
  const parsed = Number(value ?? null);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}

function roundCurrency(value: number) {
  return Math.round(value * 100) / 100;
}
