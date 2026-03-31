import type { BudgetScopeType } from "@prisma/client";
import { NextResponse, type NextRequest } from "next/server";

import { requireApiPermission } from "@/lib/auth/api-guard";
import { auditActorFromSession, recordAuditLog } from "@/lib/audit";
import { normalizePlanName, parseDateOrNull, parseNumeric } from "@/lib/budget-vs-actual";
import { prisma } from "@/lib/prisma";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ planId: string }> }
) {
  const auth = await requireApiPermission(request, "finance:view");
  if (!auth.ok) {
    return auth.response;
  }

  const { planId } = await context.params;
  if (!planId) {
    return NextResponse.json({ message: "planId is required." }, { status: 400 });
  }

  const plan = await prisma.budgetPlan.findUnique({
    where: { id: planId },
    include: {
      rig: { select: { id: true, rigCode: true } },
      project: { select: { id: true, name: true } },
      client: { select: { id: true, name: true } },
      createdBy: { select: { id: true, fullName: true } },
      updatedBy: { select: { id: true, fullName: true } }
    }
  });

  if (!plan) {
    return NextResponse.json({ message: "Budget plan not found." }, { status: 404 });
  }

  return NextResponse.json({
    data: {
      ...plan,
      rig: plan.rig ? { id: plan.rig.id, name: plan.rig.rigCode } : null,
      project: plan.project ? { id: plan.project.id, name: plan.project.name } : null,
      client: plan.client ? { id: plan.client.id, name: plan.client.name } : null,
      createdBy: { id: plan.createdBy.id, name: plan.createdBy.fullName },
      updatedBy: { id: plan.updatedBy.id, name: plan.updatedBy.fullName }
    }
  });
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ planId: string }> }
) {
  const auth = await requireApiPermission(request, "finance:edit");
  if (!auth.ok) {
    return auth.response;
  }

  const { planId } = await context.params;
  if (!planId) {
    return NextResponse.json({ message: "planId is required." }, { status: 400 });
  }

  const existing = await prisma.budgetPlan.findUnique({
    where: { id: planId },
    select: {
      id: true,
      scopeType: true,
      name: true,
      amount: true,
      currency: true,
      periodStart: true,
      periodEnd: true,
      notes: true,
      isActive: true,
      clientId: true,
      projectId: true,
      rigId: true
    }
  });
  if (!existing) {
    return NextResponse.json({ message: "Budget plan not found." }, { status: 404 });
  }

  const body = (await request.json().catch(() => null)) as
    | {
        name?: string;
        amount?: number | string;
        currency?: string;
        periodStart?: string;
        periodEnd?: string;
        notes?: string;
        isActive?: boolean;
        scopeType?: string;
        rigId?: string | null;
        projectId?: string | null;
        clientId?: string | null;
      }
    | null;

  if (body?.scopeType || body?.rigId || body?.projectId || body?.clientId) {
    return NextResponse.json(
      {
        message:
          "scopeType, rigId, projectId, and clientId are immutable for now. Create a new plan if scope changes."
      },
      { status: 400 }
    );
  }

  const nextName = body?.name !== undefined ? normalizePlanName(body.name) : existing.name;
  const nextAmount = body?.amount !== undefined ? parseNumeric(body.amount) : existing.amount;
  const nextCurrency =
    body?.currency !== undefined
      ? body.currency && body.currency.trim()
        ? body.currency.trim().toUpperCase()
        : existing.currency
      : existing.currency;
  const nextPeriodStart =
    body?.periodStart !== undefined ? parseDateOrNull(body.periodStart || null) : existing.periodStart;
  const nextPeriodEnd =
    body?.periodEnd !== undefined ? parseDateOrNull(body.periodEnd || null, true) : existing.periodEnd;
  const nextNotes = body?.notes !== undefined ? body.notes?.trim() || null : existing.notes;
  const nextIsActive = typeof body?.isActive === "boolean" ? body.isActive : existing.isActive;

  if (!nextName) {
    return NextResponse.json({ message: "name is required." }, { status: 400 });
  }
  if (nextAmount === null || nextAmount <= 0) {
    return NextResponse.json({ message: "amount must be a number greater than 0." }, { status: 400 });
  }
  if (!nextPeriodStart || !nextPeriodEnd) {
    return NextResponse.json({ message: "periodStart and periodEnd must be valid dates." }, { status: 400 });
  }
  if (nextPeriodStart.getTime() > nextPeriodEnd.getTime()) {
    return NextResponse.json({ message: "periodStart must be on or before periodEnd." }, { status: 400 });
  }

  if (nextIsActive) {
    const overlapping = await findOverlappingActivePlan({
      scopeType: existing.scopeType,
      rigId: existing.rigId,
      projectId: existing.projectId,
      periodStart: nextPeriodStart,
      periodEnd: nextPeriodEnd,
      excludeId: existing.id
    });
    if (overlapping) {
      return NextResponse.json(
        {
          message:
            "An active budget plan already exists for this scope entity in an overlapping period."
        },
        { status: 409 }
      );
    }
  }

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.budgetPlan.update({
      where: { id: planId },
      data: {
        name: nextName,
        amount: nextAmount,
        currency: nextCurrency,
        periodStart: nextPeriodStart,
        periodEnd: nextPeriodEnd,
        notes: nextNotes,
        isActive: nextIsActive,
        updatedById: auth.session.userId
      }
    });

    await recordAuditLog({
      db: tx,
      module: "budgeting",
      entityType: "budget_plan",
      entityId: row.id,
      action: "update",
      description: `${auth.session.name} updated budget plan ${row.name}.`,
      before: existing,
      after: {
        id: row.id,
        name: row.name,
        amount: row.amount,
        periodStart: row.periodStart,
        periodEnd: row.periodEnd,
        isActive: row.isActive
      },
      actor: auditActorFromSession(auth.session)
    });

    return row;
  });

  return NextResponse.json({ data: updated });
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ planId: string }> }
) {
  const auth = await requireApiPermission(request, "finance:edit");
  if (!auth.ok) {
    return auth.response;
  }

  const { planId } = await context.params;
  if (!planId) {
    return NextResponse.json({ message: "planId is required." }, { status: 400 });
  }

  const existing = await prisma.budgetPlan.findUnique({
    where: { id: planId },
    select: { id: true, name: true, isActive: true }
  });
  if (!existing) {
    return NextResponse.json({ message: "Budget plan not found." }, { status: 404 });
  }

  const archived = await prisma.$transaction(async (tx) => {
    const row = await tx.budgetPlan.update({
      where: { id: planId },
      data: {
        isActive: false,
        updatedById: auth.session.userId
      }
    });

    await recordAuditLog({
      db: tx,
      module: "budgeting",
      entityType: "budget_plan",
      entityId: row.id,
      action: "archive",
      description: `${auth.session.name} archived budget plan ${row.name}.`,
      before: existing,
      after: { id: row.id, isActive: false },
      actor: auditActorFromSession(auth.session)
    });

    return row;
  });

  return NextResponse.json({
    success: true,
    data: {
      id: archived.id,
      isActive: archived.isActive
    }
  });
}

async function findOverlappingActivePlan({
  scopeType,
  rigId,
  projectId,
  periodStart,
  periodEnd,
  excludeId
}: {
  scopeType: BudgetScopeType;
  rigId: string | null;
  projectId: string | null;
  periodStart: Date;
  periodEnd: Date;
  excludeId?: string;
}) {
  return prisma.budgetPlan.findFirst({
    where: {
      isActive: true,
      scopeType,
      ...(excludeId ? { id: { not: excludeId } } : {}),
      ...(scopeType === "RIG" ? { rigId } : { projectId }),
      periodStart: { lte: periodEnd },
      periodEnd: { gte: periodStart }
    },
    select: { id: true }
  });
}

