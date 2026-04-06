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

  const changeOrders = await prisma.projectChangeOrder.findMany({
    where: { projectId },
    orderBy: [{ createdAt: "desc" }]
  });

  return NextResponse.json({ data: changeOrders });
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
  const description = typeof body?.description === "string" ? body.description.trim() : "";
  const addedValue = parsePositiveNumber(body?.addedValue);
  const addedMetersRaw = body?.addedMeters;
  const addedDaysRaw = body?.addedDays;
  const addedMeters = parseOptionalNonNegativeNumber(addedMetersRaw);
  const addedDays = parseOptionalNonNegativeNumber(addedDaysRaw);

  if (!description) {
    return NextResponse.json({ message: "Change order description is required." }, { status: 400 });
  }
  if (addedValue === null) {
    return NextResponse.json(
      { message: "Change order added value must be greater than zero." },
      { status: 400 }
    );
  }
  if (isProvidedNumberInput(addedMetersRaw) && addedMeters === null) {
    return NextResponse.json(
      { message: "Added meters must be a non-negative number." },
      { status: 400 }
    );
  }
  if (isProvidedNumberInput(addedDaysRaw) && addedDays === null) {
    return NextResponse.json(
      { message: "Added days must be a non-negative number." },
      { status: 400 }
    );
  }

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, name: true }
  });
  if (!project) {
    return NextResponse.json({ message: "Project not found." }, { status: 404 });
  }

  const created = await prisma.$transaction(async (tx) => {
    const inserted = await tx.projectChangeOrder.create({
      data: {
        projectId,
        description,
        addedValue,
        addedMeters,
        addedDays
      }
    });

    await recordAuditLog({
      db: tx,
      module: "projects",
      entityType: "project_change_order",
      entityId: inserted.id,
      action: "create",
      description: `${auth.session.name} added change order to project ${project.name}.`,
      after: {
        projectId,
        description: inserted.description,
        addedValue: inserted.addedValue,
        addedMeters: inserted.addedMeters,
        addedDays: inserted.addedDays
      },
      actor: auditActorFromSession(auth.session)
    });

    return inserted;
  });

  return NextResponse.json({ data: created }, { status: 201 });
}

function parsePositiveNumber(value: unknown) {
  const parsed = Number(value ?? null);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}

function parseOptionalNonNegativeNumber(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }
  return parsed;
}

function isProvidedNumberInput(value: unknown) {
  return value !== null && value !== undefined && value !== "";
}
