import { NextResponse, type NextRequest } from "next/server";

import { requireAnyApiPermission, requireApiPermission } from "@/lib/auth/api-guard";
import { auditActorFromSession, recordAuditLog } from "@/lib/audit";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  const auth = await requireAnyApiPermission(request, ["clients:view", "inventory:view"]);
  if (!auth.ok) {
    return auth.response;
  }

  const fromDate = parseDateOrNull(request.nextUrl.searchParams.get("from"));
  const toDate = parseDateOrNull(request.nextUrl.searchParams.get("to"), true);
  const clientId = nullableFilter(request.nextUrl.searchParams.get("clientId"));
  const rigId = nullableFilter(request.nextUrl.searchParams.get("rigId"));
  const hasDateFilter = Boolean(fromDate || toDate);
  const hasScopeFilter = Boolean(clientId || rigId || hasDateFilter);

  const clients = await prisma.client.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      projects: {
        select: {
          id: true,
          status: true,
          assignedRigId: true,
          backupRigId: true
        }
      }
    }
  });

  if (!hasScopeFilter) {
    return NextResponse.json({
      data: clients.map((client) => ({
        ...client,
        activeProjects: client.projects.filter((project) => project.status === "ACTIVE").length
      }))
    });
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
      clientId: true,
      projectId: true
    }
  });

  const reportProjectIds = new Set(reports.map((report) => report.projectId));
  const scopedProjectIds = new Set<string>();
  const scopedClientIds = new Set<string>();

  if (clientId) {
    scopedClientIds.add(clientId);
  }

  for (const report of reports) {
    scopedClientIds.add(report.clientId);
    scopedProjectIds.add(report.projectId);
  }

  for (const client of clients) {
    if (clientId && client.id !== clientId) {
      continue;
    }

    for (const project of client.projects) {
      const matchesRig = !rigId || project.assignedRigId === rigId || project.backupRigId === rigId;
      if (!matchesRig) {
        continue;
      }

      if (!hasDateFilter) {
        scopedProjectIds.add(project.id);
        scopedClientIds.add(client.id);
        continue;
      }

      if (reportProjectIds.has(project.id)) {
        scopedProjectIds.add(project.id);
        scopedClientIds.add(client.id);
      }
    }
  }

  const scopedClients = clients
    .filter((client) => scopedClientIds.has(client.id))
    .map((client) => ({
      ...client,
      activeProjects: client.projects.filter(
        (project) => project.status === "ACTIVE" && scopedProjectIds.has(project.id)
      ).length
    }));

  return NextResponse.json({
    data: scopedClients
  });
}

export async function POST(request: NextRequest) {
  const auth = await requireApiPermission(request, "clients:manage");
  if (!auth.ok) {
    return auth.response;
  }

  const body = await request.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";

  if (!name) {
    return NextResponse.json({ message: "Client name is required." }, { status: 400 });
  }

  const created = await prisma.$transaction(async (tx) => {
    const inserted = await tx.client.create({
      data: {
        name,
        contactPerson: typeof body?.contactPerson === "string" ? body.contactPerson.trim() : null,
        email: typeof body?.email === "string" ? body.email.trim().toLowerCase() : null,
        phone: typeof body?.phone === "string" ? body.phone.trim() : null,
        description: typeof body?.description === "string" ? body.description.trim() : null,
        address: typeof body?.address === "string" ? body.address.trim() : null,
        logoUrl: typeof body?.logoUrl === "string" ? body.logoUrl.trim() : null,
        profilePhotoUrl: typeof body?.profilePhotoUrl === "string" ? body.profilePhotoUrl.trim() : null
      }
    });

    await recordAuditLog({
      db: tx,
      module: "clients",
      entityType: "client",
      entityId: inserted.id,
      action: "create",
      description: `${auth.session.name} created Client ${inserted.name}.`,
      after: clientAuditSnapshot(inserted),
      actor: auditActorFromSession(auth.session)
    });

    return inserted;
  });

  return NextResponse.json({ data: created }, { status: 201 });
}

function clientAuditSnapshot(client: {
  id: string;
  name: string;
  contactPerson: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
}) {
  return {
    id: client.id,
    name: client.name,
    contactPerson: client.contactPerson,
    email: client.email,
    phone: client.phone,
    address: client.address
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
