import { ProjectStatus } from "@prisma/client";
import { NextResponse, type NextRequest } from "next/server";

import { requireAnyApiPermission, requireApiPermission } from "@/lib/auth/api-guard";
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

export async function GET(request: NextRequest) {
  const auth = await requireAnyApiPermission(request, ["projects:view", "inventory:view"]);
  if (!auth.ok) {
    return auth.response;
  }

  const fromDate = parseDateOrNull(request.nextUrl.searchParams.get("from"));
  const toDate = parseDateOrNull(request.nextUrl.searchParams.get("to"), true);
  const clientId = nullableFilter(request.nextUrl.searchParams.get("clientId"));
  const rigId = nullableFilter(request.nextUrl.searchParams.get("rigId"));
  const hasDateFilter = Boolean(fromDate || toDate);
  const hasScopeFilter = Boolean(clientId || rigId || hasDateFilter);

  const projects = await prisma.project.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      client: {
        select: { id: true, name: true }
      },
      assignedRig: {
        select: { id: true, rigCode: true }
      },
      backupRig: {
        select: { id: true, rigCode: true }
      }
    }
  });

  if (!hasScopeFilter) {
    return NextResponse.json({ data: projects });
  }

  const reports = await prisma.drillReport.findMany({
    where: {
      ...(clientId ? { clientId } : {}),
      ...(rigId ? { rigId } : {}),
      ...(fromDate || toDate
        ? {
            date: {
              ...(fromDate ? { gte: fromDate } : {}),
              ...(toDate ? { lte: toDate } : {})
            }
          }
        : {})
    },
    select: {
      projectId: true
    }
  });

  const reportProjectIds = new Set(reports.map((report) => report.projectId));
  const filteredProjects = projects.filter((project) => {
    const matchesClient = !clientId || project.clientId === clientId;
    if (!matchesClient) {
      return false;
    }

    const matchesRig =
      !rigId ||
      project.assignedRigId === rigId ||
      project.backupRigId === rigId ||
      reportProjectIds.has(project.id);
    if (!matchesRig) {
      return false;
    }

    if (hasDateFilter && !reportProjectIds.has(project.id)) {
      return false;
    }

    return true;
  });

  return NextResponse.json({ data: filteredProjects });
}

export async function POST(request: NextRequest) {
  const auth = await requireApiPermission(request, "projects:manage");
  if (!auth.ok) {
    return auth.response;
  }

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

  const created = await prisma.$transaction(async (tx) => {
    const inserted = await tx.project.create({
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
      entityId: inserted.id,
      action: "create",
      description: `${auth.session.name} created Project ${inserted.name}.`,
      after: projectAuditSnapshot(inserted),
      actor: auditActorFromSession(auth.session)
    });

    return inserted;
  });

  return NextResponse.json({ data: created }, { status: 201 });
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

function parseDateOrNull(value: string | null, endOfDay = false) {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  if (endOfDay) {
    parsed.setUTCHours(23, 59, 59, 999);
  } else {
    parsed.setUTCHours(0, 0, 0, 0);
  }

  return parsed;
}

function nullableFilter(value: string | null) {
  return value && value !== "all" ? value : null;
}
