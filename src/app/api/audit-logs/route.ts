import type { Prisma } from "@prisma/client";
import { NextResponse, type NextRequest } from "next/server";

import { requireApiPermission } from "@/lib/auth/api-guard";
import { getSessionFromRequest } from "@/lib/auth/session";
import { auditActorFromSession, parseAuditJson, recordAuditLog } from "@/lib/audit";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  const auth = await requireApiPermission(request, "reports:view");
  if (!auth.ok) {
    return auth.response;
  }

  const from = parseDateOrNull(request.nextUrl.searchParams.get("from"));
  const to = parseDateOrNull(request.nextUrl.searchParams.get("to"), true);
  const userId = nullable(request.nextUrl.searchParams.get("userId"));
  const moduleName = nullable(request.nextUrl.searchParams.get("module"));
  const action = nullable(request.nextUrl.searchParams.get("action"));
  const entityType = nullable(request.nextUrl.searchParams.get("entityType"));
  const entityId = nullable(request.nextUrl.searchParams.get("entityId"));
  const limit = parseLimit(request.nextUrl.searchParams.get("limit"));

  const where: Prisma.AuditLogWhereInput = {
    ...(userId ? { actorId: userId } : {}),
    ...(moduleName ? { module: moduleName } : {}),
    ...(action ? { action } : {}),
    ...(entityType ? { entityType } : {}),
    ...(entityId ? { entityId } : {}),
    ...(from || to
      ? {
          createdAt: {
            ...(from ? { gte: from } : {}),
            ...(to ? { lte: to } : {})
          }
        }
      : {})
  };

  const [logs, users] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
      include: {
        actor: {
          select: {
            id: true,
            fullName: true,
            role: true
          }
        }
      }
    }),
    prisma.user.findMany({
      orderBy: { fullName: "asc" },
      select: {
        id: true,
        fullName: true,
        role: true
      }
    })
  ]);

  return NextResponse.json({
    data: logs.map((entry) => ({
      id: entry.id,
      module: entry.module,
      entityType: entry.entityType,
      entityId: entry.entityId,
      action: entry.action,
      description: entry.description,
      beforeValue: parseAuditJson(entry.beforeValueJson),
      afterValue: parseAuditJson(entry.afterValueJson),
      actorId: entry.actorId,
      actorName: entry.actor?.fullName || entry.actorName,
      actorRole: entry.actor?.role || entry.actorRole,
      createdAt: entry.createdAt
    })),
    filterOptions: {
      users: users.map((user) => ({
        id: user.id,
        name: user.fullName,
        role: user.role
      }))
    }
  });
}

export async function POST(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const moduleName = asRequiredString(body?.module);
  const entityType = asRequiredString(body?.entityType);
  const entityId = asRequiredString(body?.entityId);
  const action = asRequiredString(body?.action);

  if (!moduleName || !entityType || !entityId || !action) {
    return NextResponse.json(
      { message: "module, entityType, entityId, and action are required." },
      { status: 400 }
    );
  }

  const created = await recordAuditLog({
    module: moduleName,
    entityType,
    entityId,
    action,
    description: typeof body?.description === "string" ? body.description : null,
    before: body?.before,
    after: body?.after,
    actor: auditActorFromSession(session)
  });

  return NextResponse.json({ data: created }, { status: 201 });
}

function nullable(value: string | null) {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed !== "all" ? trimmed : null;
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

function parseLimit(value: string | null) {
  const parsed = Number(value || 200);
  if (Number.isNaN(parsed)) {
    return 200;
  }
  return Math.min(500, Math.max(1, Math.round(parsed)));
}

function asRequiredString(value: unknown) {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim();
}
