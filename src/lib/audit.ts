import type { Prisma, PrismaClient, UserRole } from "@prisma/client";

import type { AuthSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";

type AuditDbClient = PrismaClient | Prisma.TransactionClient;

interface AuditActor {
  id?: string | null;
  name?: string | null;
  role?: UserRole | null;
}

interface RecordAuditLogInput {
  db?: AuditDbClient;
  module: string;
  entityType: string;
  entityId: string;
  action: string;
  description?: string | null;
  before?: unknown;
  after?: unknown;
  actor?: AuditActor | null;
}

export function auditActorFromSession(session: AuthSession): AuditActor {
  return {
    id: session.userId,
    name: session.name,
    role: session.role as UserRole
  };
}

export async function recordAuditLog(input: RecordAuditLogInput) {
  const db = input.db || prisma;

  return db.auditLog.create({
    data: {
      module: input.module,
      entityType: input.entityType,
      entityId: input.entityId,
      action: input.action,
      description: emptyToNull(input.description),
      beforeValueJson: serializeJson(input.before),
      afterValueJson: serializeJson(input.after),
      actorName: emptyToNull(input.actor?.name),
      actorRole: input.actor?.role || null,
      ...(input.actor?.id ? { actor: { connect: { id: input.actor.id } } } : {})
    }
  });
}

export function parseAuditJson(value: string | null) {
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value) as unknown;
  } catch (_error) {
    return null;
  }
}

function serializeJson(value: unknown) {
  if (value === undefined) {
    return null;
  }
  try {
    return JSON.stringify(value);
  } catch (_error) {
    return JSON.stringify({ error: "SERIALIZATION_FAILED" });
  }
}

function emptyToNull(value: string | null | undefined) {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
