import { RigCondition, RigCostAllocationBasis, RigStatus } from "@prisma/client";
import { NextResponse, type NextRequest } from "next/server";

import { requireApiPermission } from "@/lib/auth/api-guard";
import { auditActorFromSession, recordAuditLog } from "@/lib/audit";
import { prisma } from "@/lib/prisma";

function parseRigStatus(value: unknown): RigStatus {
  if (typeof value !== "string") {
    return RigStatus.IDLE;
  }
  const upper = value.toUpperCase();
  if (upper in RigStatus) {
    return RigStatus[upper as keyof typeof RigStatus];
  }
  return RigStatus.IDLE;
}

function parseRigCondition(value: unknown): RigCondition {
  if (typeof value !== "string") {
    return RigCondition.GOOD;
  }
  const upper = value.toUpperCase();
  if (upper in RigCondition) {
    return RigCondition[upper as keyof typeof RigCondition];
  }
  return RigCondition.GOOD;
}

function parseRigCostAllocationBasis(value: unknown): RigCostAllocationBasis {
  if (typeof value !== "string") {
    return RigCostAllocationBasis.DAY;
  }
  const upper = value.toUpperCase();
  if (upper in RigCostAllocationBasis) {
    return RigCostAllocationBasis[upper as keyof typeof RigCostAllocationBasis];
  }
  return RigCostAllocationBasis.DAY;
}

export async function GET(request: NextRequest) {
  const auth = await requireApiPermission(request, "rigs:view");
  if (!auth.ok) {
    return auth.response;
  }

  const status = parseRigStatusFilter(request.nextUrl.searchParams.get("status"));
  const projectId = nullableFilter(request.nextUrl.searchParams.get("projectId"));
  const fromDate = parseDateOrNull(request.nextUrl.searchParams.get("from"));
  const toDate = parseDateOrNull(request.nextUrl.searchParams.get("to"), true);
  const clientId = nullableFilter(request.nextUrl.searchParams.get("clientId"));
  const rigId = nullableFilter(request.nextUrl.searchParams.get("rigId"));

  if (projectId) {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: {
        assignedRigId: true,
        backupRigId: true
      }
    });

    if (!project) {
      return NextResponse.json({ data: [] });
    }

    const orderedRigIds = [project.assignedRigId, project.backupRigId].filter(
      (value): value is string => Boolean(value)
    );
    const uniqueRigIds = Array.from(new Set(orderedRigIds));

    if (uniqueRigIds.length === 0) {
      return NextResponse.json({ data: [] });
    }

    const rigs = await prisma.rig.findMany({
      where: {
        id: { in: uniqueRigIds },
        ...(status ? { status } : {})
      }
    });
    const rigById = new Map(rigs.map((entry) => [entry.id, entry]));
    const orderedRigs = uniqueRigIds
      .map((id) => rigById.get(id))
      .filter((entry): entry is (typeof rigs)[number] => Boolean(entry));

    return NextResponse.json({ data: orderedRigs });
  }

  const hasDateFilter = Boolean(fromDate || toDate);
  const hasScopeFilter = Boolean(clientId || rigId || hasDateFilter);

  const rigs = await prisma.rig.findMany({
    where: status ? { status } : undefined,
    orderBy: { createdAt: "desc" }
  });

  if (!hasScopeFilter) {
    return NextResponse.json({ data: rigs });
  }

  const [reports, projects] = await Promise.all([
    prisma.drillReport.findMany({
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
        rigId: true
      }
    }),
    prisma.project.findMany({
      where: clientId ? { clientId } : undefined,
      select: {
        assignedRigId: true,
        backupRigId: true
      }
    })
  ]);

  const scopedRigIds = new Set<string>();
  if (rigId) {
    scopedRigIds.add(rigId);
  }

  for (const report of reports) {
    scopedRigIds.add(report.rigId);
  }

  if (!hasDateFilter) {
    for (const project of projects) {
      if (project.assignedRigId) {
        if (!rigId || project.assignedRigId === rigId) {
          scopedRigIds.add(project.assignedRigId);
        }
      }
      if (project.backupRigId) {
        if (!rigId || project.backupRigId === rigId) {
          scopedRigIds.add(project.backupRigId);
        }
      }
    }
  }

  const filteredRigs = rigs.filter((rig) => scopedRigIds.has(rig.id));

  return NextResponse.json({ data: filteredRigs });
}

export async function POST(request: NextRequest) {
  const auth = await requireApiPermission(request, "rigs:manage");
  if (!auth.ok) {
    return auth.response;
  }

  const body = await request.json().catch(() => null);
  const rigCode = typeof body?.rigCode === "string" ? body.rigCode.trim() : "";
  const model = typeof body?.model === "string" ? body.model.trim() : "";
  const serialNumber = typeof body?.serialNumber === "string" ? body.serialNumber.trim() : "";

  if (!rigCode || !model || !serialNumber) {
    return NextResponse.json({ message: "rigCode, model, and serialNumber are required." }, { status: 400 });
  }

  const created = await prisma.$transaction(async (tx) => {
    const inserted = await tx.rig.create({
      data: {
        rigCode,
        model,
        serialNumber,
        photoUrl: typeof body?.photoUrl === "string" ? body.photoUrl.trim() : null,
        acquisitionDate: typeof body?.acquisitionDate === "string" && body.acquisitionDate ? new Date(body.acquisitionDate) : null,
        status: parseRigStatus(body?.status),
        condition: parseRigCondition(body?.condition),
        conditionScore: Number(body?.conditionScore ?? 80),
        totalHoursWorked: Number(body?.totalHoursWorked ?? 0),
        totalMetersDrilled: Number(body?.totalMetersDrilled ?? 0),
        totalLifetimeDays: Number(body?.totalLifetimeDays ?? 0),
        costAllocationBasis: parseRigCostAllocationBasis(body?.costAllocationBasis),
        costRatePerDay: parseNonNegativeNumber(body?.costRatePerDay),
        costRatePerHour: parseNonNegativeNumber(body?.costRatePerHour)
      }
    });

    await recordAuditLog({
      db: tx,
      module: "rigs",
      entityType: "rig",
      entityId: inserted.id,
      action: "create",
      description: `${auth.session.name} created Rig ${inserted.rigCode}.`,
      after: rigAuditSnapshot(inserted),
      actor: auditActorFromSession(auth.session)
    });

    return inserted;
  });

  return NextResponse.json({ data: created }, { status: 201 });
}

function rigAuditSnapshot(rig: {
  id: string;
  rigCode: string;
  model: string;
  serialNumber: string;
  status: string;
  condition: string;
  conditionScore: number;
  totalHoursWorked: number;
  totalMetersDrilled: number;
  totalLifetimeDays: number;
  costAllocationBasis: string;
  costRatePerDay: number;
  costRatePerHour: number;
}) {
  return {
    id: rig.id,
    rigCode: rig.rigCode,
    model: rig.model,
    serialNumber: rig.serialNumber,
    status: rig.status,
    condition: rig.condition,
    conditionScore: rig.conditionScore,
    totalHoursWorked: rig.totalHoursWorked,
    totalMetersDrilled: rig.totalMetersDrilled,
    totalLifetimeDays: rig.totalLifetimeDays,
    costAllocationBasis: rig.costAllocationBasis,
    costRatePerDay: rig.costRatePerDay,
    costRatePerHour: rig.costRatePerHour
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

function parseRigStatusFilter(value: string | null) {
  if (!value || value === "all") {
    return null;
  }
  const upper = value.toUpperCase();
  if (upper in RigStatus) {
    return RigStatus[upper as keyof typeof RigStatus];
  }
  return null;
}

function parseNonNegativeNumber(value: unknown) {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }
  return parsed;
}
