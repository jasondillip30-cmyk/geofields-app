import type { Prisma, UserRole } from "@prisma/client";
import { NextResponse } from "next/server";
import { recordAuditLog } from "@/lib/audit";
import { isSafetyReviewerEligible } from "@/lib/safety-incident-policy";

type EmployeeAccess = { id: string; role: UserRole; isActive: boolean; isSafetyReviewer: boolean; fullName: string };

export class EmployeeAccessError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

export function employeeAccessFailure(error: unknown) {
  if (error instanceof EmployeeAccessError) return NextResponse.json({ message: error.message }, { status: error.status });
  throw error;
}

export async function lockEmployeeAccess(tx: Prisma.TransactionClient, actorId: string, targetId = actorId) {
  const rows = await tx.$queryRaw<EmployeeAccess[]>`
    SELECT "id", "role", "isActive", "isSafetyReviewer", "fullName"
    FROM "User" WHERE "id" IN (${actorId}, ${targetId})
    ORDER BY "id" FOR UPDATE
  `;
  const actor = rows.find(({ id }) => id === actorId);
  if (!actor || !isSafetyReviewerEligible(actor.role, actor.isActive)) {
    throw new EmployeeAccessError("Only active Managers and Admins can manage employee access.", 403);
  }
  return { actor, target: rows.find(({ id }) => id === targetId) };
}

export function resolveSafetyReviewerFlag(value: unknown, role: UserRole, isActive: boolean, existing = false) {
  if (value !== undefined && typeof value !== "boolean") {
    throw new EmployeeAccessError("Safety reviewer must be on or off.", 400);
  }
  const eligible = isSafetyReviewerEligible(role, isActive);
  if (value === true && !eligible) {
    throw new EmployeeAccessError("Only active Managers and Admins can be safety reviewers.", 400);
  }
  return eligible && (value ?? existing);
}

export async function auditSafetyReviewerChange(tx: Prisma.TransactionClient, actor: EmployeeAccess, targetId: string, before: boolean, after: boolean) {
  if (before === after) return;
  await recordAuditLog({
    db: tx, module: "employees", entityType: "employee", entityId: targetId,
    action: after ? "grant_safety_reviewer" : "revoke_safety_reviewer",
    description: after ? "Granted safety reviewer access." : "Removed safety reviewer access.",
    before: { isSafetyReviewer: before }, after: { isSafetyReviewer: after },
    actor: { id: actor.id, name: actor.fullName, role: actor.role }
  });
}
