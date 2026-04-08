import { randomUUID } from "node:crypto";

import type { MaintenanceStatus, Prisma, UrgencyLevel } from "@prisma/client";
import { NextResponse, type NextRequest } from "next/server";

import { requireAnyApiPermission, requireApiPermission } from "@/lib/auth/api-guard";
import { auditActorFromSession, recordAuditLog } from "@/lib/audit";
import { nullableFilter, parseDateOrNull, parseNumeric, roundCurrency } from "@/lib/inventory-server";
import { prisma } from "@/lib/prisma";

const maintenanceInclude = {
  rig: { select: { id: true, rigCode: true, status: true } },
  client: { select: { id: true, name: true } },
  project: { select: { id: true, name: true, status: true, clientId: true } },
  breakdownReport: { select: { id: true, title: true, status: true, severity: true } },
  mechanic: { select: { id: true, fullName: true, specialization: true } },
} satisfies Prisma.MaintenanceRequestInclude;

type MaintenanceWithRelations = Prisma.MaintenanceRequestGetPayload<{ include: typeof maintenanceInclude }>;

export async function GET(request: NextRequest) {
  const auth = await requireAnyApiPermission(request, ["maintenance:view", "inventory:view"]);
  if (!auth.ok) {
    return auth.response;
  }

  const status = parseStatusFilter(request.nextUrl.searchParams.get("status"));
  const clientId = nullableFilter(request.nextUrl.searchParams.get("clientId"));
  const projectId = nullableFilter(request.nextUrl.searchParams.get("projectId"));
  const rigId = nullableFilter(request.nextUrl.searchParams.get("rigId"));
  const breakdownReportId = nullableFilter(request.nextUrl.searchParams.get("breakdownReportId"));
  const maintenanceRequestId = nullableFilter(
    request.nextUrl.searchParams.get("maintenanceRequestId")
  );
  const fromDate = parseDateOrNull(request.nextUrl.searchParams.get("from"));
  const toDate = parseDateOrNull(request.nextUrl.searchParams.get("to"), true);

  const where: Prisma.MaintenanceRequestWhereInput = {
    ...(status ? { status } : {}),
    ...(clientId ? { clientId } : {}),
    ...(projectId ? { projectId } : {}),
    ...(rigId ? { rigId } : {}),
    ...(breakdownReportId ? { breakdownReportId } : {}),
    ...(maintenanceRequestId ? { id: maintenanceRequestId } : {}),
    ...(fromDate || toDate
      ? {
          requestDate: {
            ...(fromDate ? { gte: fromDate } : {}),
            ...(toDate ? { lte: toDate } : {})
          }
        }
      : {})
  };

  const rows = await prisma.maintenanceRequest.findMany({
    where,
    include: maintenanceInclude,
    orderBy: [{ requestDate: "desc" }, { createdAt: "desc" }]
  });

  return NextResponse.json({
    data: rows.map((row) => serializeMaintenanceForClient(row)),
    meta: { count: rows.length }
  });
}

export async function POST(request: NextRequest) {
  const auth = await requireApiPermission(request, "maintenance:submit");
  if (!auth.ok) {
    return auth.response;
  }

  const body = await request.json().catch(() => null);
  const rigId = typeof body?.rigId === "string" ? body.rigId : "";
  const projectId = nullableFilter(typeof body?.projectId === "string" ? body.projectId : null);
  const clientId = nullableFilter(typeof body?.clientId === "string" ? body.clientId : null);
  const breakdownReportId = nullableFilter(
    typeof body?.breakdownReportId === "string" ? body.breakdownReportId : null
  );
  const providedMechanicId = nullableFilter(typeof body?.mechanicId === "string" ? body.mechanicId : null);
  const issueDescription = typeof body?.issueDescription === "string" ? body.issueDescription.trim() : "";
  const maintenanceType = normalizeMaintenanceType(
    typeof body?.issueType === "string" ? body.issueType : ""
  );
  const operationalStatus = parseOperationalMaintenanceStatus(body?.status);
  const urgency = parseUrgency(body?.urgency) || "MEDIUM";
  const notes = nullableString(typeof body?.notes === "string" ? body.notes : "");
  const requestDate = parseDateOrNull(typeof body?.requestDate === "string" ? body.requestDate : null) || new Date();
  const estimatedDowntimeHrs = parseNumeric(body?.estimatedDowntimeHrs ?? body?.estimatedDowntimeHours) ?? 0;

  if (!rigId || !issueDescription) {
    return NextResponse.json(
      { message: "rigId and issueDescription are required." },
      { status: 400 }
    );
  }
  if (estimatedDowntimeHrs < 0) {
    return NextResponse.json(
      { message: "estimatedDowntimeHrs must be >= 0." },
      { status: 400 }
    );
  }

  try {
    const [rig, project, selectedClient, breakdown, activeProjectForRig, mechanicId] = await Promise.all([
      prisma.rig.findUnique({
        where: { id: rigId },
        select: { id: true, rigCode: true }
      }),
      projectId
        ? prisma.project.findUnique({
            where: { id: projectId },
            select: {
              id: true,
              name: true,
              clientId: true,
              assignedRigId: true,
              backupRigId: true
            }
          })
        : Promise.resolve(null),
      clientId
        ? prisma.client.findUnique({
            where: { id: clientId },
            select: { id: true }
          })
        : Promise.resolve(null),
      breakdownReportId
        ? prisma.breakdownReport.findUnique({
            where: { id: breakdownReportId },
            select: {
              id: true,
              projectId: true,
              clientId: true,
              rigId: true,
              title: true
            }
          })
        : Promise.resolve(null),
      prisma.project.findFirst({
        where: {
          assignedRigId: rigId,
          status: "ACTIVE"
        },
        select: {
          id: true,
          clientId: true
        }
      }),
      resolveMechanicId({
        providedMechanicId,
        sessionEmail: auth.session.email,
        sessionName: auth.session.name
      })
    ]);

    if (!rig) {
      return NextResponse.json({ message: "Rig not found." }, { status: 404 });
    }
    if (projectId && !project) {
      return NextResponse.json({ message: "Project not found." }, { status: 404 });
    }
    if (projectId && project) {
      const allowedProjectRigIds = [project.assignedRigId, project.backupRigId].filter(
        (value): value is string => Boolean(value)
      );
      if (allowedProjectRigIds.length === 0) {
        return NextResponse.json(
          { message: "This project has no assigned rig. Assign a rig to the project first." },
          { status: 400 }
        );
      }
      if (!allowedProjectRigIds.includes(rigId)) {
        return NextResponse.json(
          { message: "Selected rig is not assigned to this project. Choose one of the project rigs." },
          { status: 400 }
        );
      }
    }
    if (clientId && !selectedClient) {
      return NextResponse.json({ message: "Client not found." }, { status: 404 });
    }
    if (breakdownReportId && !breakdown) {
      return NextResponse.json({ message: "Breakdown report not found." }, { status: 404 });
    }
    if (!mechanicId) {
      return NextResponse.json(
        { message: "No mechanic profile found. Add a mechanic record before submitting." },
        { status: 409 }
      );
    }

    if (breakdown && projectId && breakdown.projectId !== projectId) {
      return NextResponse.json(
        { message: "Selected breakdown does not match the selected project." },
        { status: 400 }
      );
    }
    if (breakdown && clientId && breakdown.clientId !== clientId) {
      return NextResponse.json(
        { message: "Selected breakdown does not match the selected client." },
        { status: 400 }
      );
    }
    if (breakdown && rigId && breakdown.rigId !== rigId) {
      return NextResponse.json(
        { message: "Selected breakdown does not match the selected rig." },
        { status: 400 }
      );
    }

    const resolvedRigId = breakdown?.rigId || rig.id;
    const resolvedProjectId =
      projectId || breakdown?.projectId || activeProjectForRig?.id || null;
    const resolvedClientId =
      project?.clientId ||
      breakdown?.clientId ||
      activeProjectForRig?.clientId ||
      clientId ||
      null;
    if (clientId && project?.clientId && clientId !== project.clientId) {
      return NextResponse.json(
        { message: "Selected project does not belong to the selected client." },
        { status: 400 }
      );
    }

    const created = await prisma.$transaction(async (tx) => {
      const createdRequest = await tx.maintenanceRequest.create({
        data: {
          requestCode: buildRequestCode(),
          requestDate,
          rigId: resolvedRigId,
          clientId: resolvedClientId,
          projectId: resolvedProjectId,
          breakdownReportId: breakdown?.id || breakdownReportId,
          mechanicId,
          maintenanceType: maintenanceType || null,
          issueDescription,
          materialsNeeded: JSON.stringify([]),
          urgency,
          photoUrls: JSON.stringify([]),
          notes,
          estimatedDowntimeHrs: roundCurrency(estimatedDowntimeHrs),
          status: operationalStatus
        },
        include: maintenanceInclude
      });

      await recordAuditLog({
        db: tx,
        module: "maintenance",
        entityType: "maintenance_request",
        entityId: createdRequest.id,
        action: "create",
        description: `${auth.session.name} recorded maintenance activity ${createdRequest.requestCode}.`,
        after: maintenanceAuditSnapshot(createdRequest),
        actor: auditActorFromSession(auth.session)
      });

      return createdRequest;
    });

    return NextResponse.json(
      {
        message: "Maintenance activity recorded.",
        data: serializeMaintenanceForClient(created)
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("[maintenance][create][error]", {
      message: error instanceof Error ? error.message : "Unknown error"
    });
    return NextResponse.json({ message: "Failed to save maintenance activity." }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  const auth = await requireApiPermission(request, "maintenance:submit");
  if (!auth.ok) {
    return auth.response;
  }

  const payload = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const maintenanceRequestId =
    typeof payload?.id === "string" && payload.id.trim()
      ? payload.id.trim()
      : typeof payload?.maintenanceRequestId === "string" && payload.maintenanceRequestId.trim()
        ? payload.maintenanceRequestId.trim()
        : "";
  const action = typeof payload?.action === "string" ? payload.action.trim().toLowerCase() : "";
  const requestedStatus = parseOperationalMaintenanceStatus(payload?.status);
  const resolutionNote = nullableString(
    typeof payload?.resolutionNote === "string" ? payload.resolutionNote : null
  );

  if (!maintenanceRequestId) {
    return NextResponse.json({ message: "Maintenance request id is required." }, { status: 400 });
  }
  if (action !== "resolve" && action !== "set_status") {
    return NextResponse.json(
      { message: "Unsupported maintenance action. Use resolve or set_status." },
      { status: 400 }
    );
  }

  const existing = await prisma.maintenanceRequest.findUnique({
    where: { id: maintenanceRequestId },
    include: maintenanceInclude
  });
  if (!existing) {
    return NextResponse.json({ message: "Maintenance request not found." }, { status: 404 });
  }

  const nextStatus = action === "resolve" ? ("COMPLETED" as MaintenanceStatus) : requestedStatus;
  const nextNotes =
    resolutionNote && action === "resolve"
      ? [existing.notes, `Resolution: ${resolutionNote}`]
          .filter((entry) => Boolean(entry))
          .join("\n\n")
      : existing.notes;

  if (existing.status === nextStatus && existing.notes === nextNotes) {
    return NextResponse.json({
      message: "Maintenance record already up to date.",
      data: serializeMaintenanceForClient(existing)
    });
  }

  const updated = await prisma.$transaction(async (tx) => {
    const updatedRow = await tx.maintenanceRequest.update({
      where: { id: maintenanceRequestId },
      data: {
        status: nextStatus,
        notes: nextNotes
      },
      include: maintenanceInclude
    });

    await recordAuditLog({
      db: tx,
      module: "maintenance",
      entityType: "maintenance_request",
      entityId: updatedRow.id,
      action: action === "resolve" ? "resolve" : "update_status",
      description:
        action === "resolve"
          ? `${auth.session.name} resolved maintenance ${updatedRow.requestCode}.`
          : `${auth.session.name} updated maintenance ${updatedRow.requestCode} status.`,
      before: {
        status: existing.status,
        notes: existing.notes
      },
      after: {
        status: updatedRow.status,
        notes: updatedRow.notes
      },
      actor: auditActorFromSession(auth.session)
    });

    return updatedRow;
  });

  return NextResponse.json({
    message: action === "resolve" ? "Maintenance marked as completed." : "Maintenance status updated.",
    data: serializeMaintenanceForClient(updated)
  });
}

async function resolveMechanicId({
  providedMechanicId,
  sessionEmail,
  sessionName
}: {
  providedMechanicId: string | null;
  sessionEmail: string;
  sessionName: string;
}) {
  if (providedMechanicId) {
    const provided = await prisma.mechanic.findUnique({
      where: { id: providedMechanicId },
      select: { id: true }
    });
    return provided?.id || null;
  }

  const byEmail = await prisma.mechanic.findFirst({
    where: {
      email: sessionEmail
    },
    select: { id: true }
  });
  if (byEmail) {
    return byEmail.id;
  }

  const byName = await prisma.mechanic.findFirst({
    where: {
      fullName: sessionName
    },
    select: { id: true }
  });
  if (byName) {
    return byName.id;
  }

  const first = await prisma.mechanic.findFirst({
    orderBy: [{ fullName: "asc" }],
    select: { id: true }
  });
  return first?.id || null;
}

function parseStatusFilter(
  value: string | null
): Prisma.MaintenanceRequestWhereInput["status"] | null {
  if (!value || value === "all") {
    return null;
  }
  const normalized = value.toUpperCase();
  if (
    normalized === "OPEN" ||
    normalized === "WAITING_FOR_PARTS" ||
    normalized === "IN_REPAIR" ||
    normalized === "COMPLETED"
  ) {
    return normalized;
  }
  return null;
}

function parseOperationalMaintenanceStatus(value: unknown): MaintenanceStatus {
  if (typeof value === "string") {
    const normalized = value.trim().toUpperCase();
    if (
      normalized === "OPEN" ||
      normalized === "WAITING_FOR_PARTS" ||
      normalized === "IN_REPAIR" ||
      normalized === "COMPLETED"
    ) {
      return normalized;
    }
  }
  return "OPEN";
}

function normalizeMaintenanceType(value: string | null) {
  if (!value) {
    return null;
  }
  const compact = value.replace(/\s+/g, " ").trim();
  if (!compact) {
    return null;
  }
  return compact.replace(/[^\w\s/-]/g, "").slice(0, 60) || null;
}

function parseUrgency(value: unknown): UrgencyLevel | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().toUpperCase();
  if (normalized === "LOW" || normalized === "MEDIUM" || normalized === "HIGH" || normalized === "CRITICAL") {
    return normalized;
  }
  return null;
}

function nullableString(value: string | null) {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function buildRequestCode() {
  const year = new Date().getUTCFullYear();
  const token = randomUUID().slice(0, 6).toUpperCase();
  return `MR-${year}-${token}`;
}

function serializeMaintenanceForClient(row: MaintenanceWithRelations) {
  return {
    id: row.id,
    requestCode: row.requestCode,
    date: row.requestDate.toISOString().slice(0, 10),
    requestDate: row.requestDate.toISOString(),
    rigId: row.rigId,
    clientId: row.clientId,
    projectId: row.projectId,
    breakdownReportId: row.breakdownReportId || null,
    mechanicId: row.mechanicId,
    issueDescription: row.issueDescription,
    issueType: row.maintenanceType || "General",
    urgency: row.urgency,
    notes: row.notes,
    estimatedDowntimeHours: row.estimatedDowntimeHrs,
    status: row.status,
    rig: row.rig
      ? {
          id: row.rig.id,
          rigCode: row.rig.rigCode
        }
      : null,
    client: row.client
      ? {
          id: row.client.id,
          name: row.client.name
        }
      : null,
    project: row.project
      ? {
          id: row.project.id,
          name: row.project.name
        }
      : null,
    breakdownReport: row.breakdownReport
      ? {
          id: row.breakdownReport.id,
          title: row.breakdownReport.title,
          status: row.breakdownReport.status,
          severity: row.breakdownReport.severity
        }
      : null,
    mechanic: row.mechanic
      ? {
          id: row.mechanic.id,
          fullName: row.mechanic.fullName,
          specialization: row.mechanic.specialization
        }
      : null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function maintenanceAuditSnapshot(requestRow: {
  id: string;
  requestCode: string;
  status: MaintenanceStatus;
  requestDate: Date;
  rigId: string;
  clientId: string | null;
  projectId: string | null;
  breakdownReportId?: string | null;
  maintenanceType?: string | null;
  mechanicId: string;
  issueDescription: string;
  urgency: UrgencyLevel;
  estimatedDowntimeHrs: number;
}) {
  return {
    id: requestRow.id,
    requestCode: requestRow.requestCode,
    status: requestRow.status,
    requestDate: requestRow.requestDate,
    rigId: requestRow.rigId,
    clientId: requestRow.clientId,
    projectId: requestRow.projectId,
    breakdownReportId: requestRow.breakdownReportId || null,
    maintenanceType: requestRow.maintenanceType || null,
    mechanicId: requestRow.mechanicId,
    issueDescription: requestRow.issueDescription,
    urgency: requestRow.urgency,
    estimatedDowntimeHrs: requestRow.estimatedDowntimeHrs
  };
}
