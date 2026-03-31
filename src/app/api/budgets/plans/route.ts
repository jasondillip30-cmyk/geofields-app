import type { BudgetScopeType, Prisma } from "@prisma/client";
import { NextResponse, type NextRequest } from "next/server";

import { requireApiPermission } from "@/lib/auth/api-guard";
import { auditActorFromSession, recordAuditLog } from "@/lib/audit";
import {
  normalizePlanName,
  parseBudgetScopeType,
  parseDateOrNull,
  parseNumeric
} from "@/lib/budget-vs-actual";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  const auth = await requireApiPermission(request, "finance:view");
  if (!auth.ok) {
    return auth.response;
  }

  const scopeType = parseBudgetScopeType(request.nextUrl.searchParams.get("scopeType"));
  const activeOnly = request.nextUrl.searchParams.get("activeOnly") !== "false";

  const where: Prisma.BudgetPlanWhereInput = {
    ...(scopeType ? { scopeType } : {}),
    ...(activeOnly ? { isActive: true } : {})
  };

  const plans = await prisma.budgetPlan.findMany({
    where,
    include: {
      rig: { select: { id: true, rigCode: true } },
      project: { select: { id: true, name: true } },
      client: { select: { id: true, name: true } },
      createdBy: { select: { id: true, fullName: true } },
      updatedBy: { select: { id: true, fullName: true } }
    },
    orderBy: [{ periodStart: "desc" }, { createdAt: "desc" }]
  });

  return NextResponse.json({
    data: plans.map((plan) => ({
      id: plan.id,
      scopeType: plan.scopeType,
      name: plan.name,
      amount: plan.amount,
      currency: plan.currency,
      periodStart: plan.periodStart,
      periodEnd: plan.periodEnd,
      isActive: plan.isActive,
      notes: plan.notes,
      clientId: plan.clientId,
      projectId: plan.projectId,
      rigId: plan.rigId,
      rig: plan.rig ? { id: plan.rig.id, name: plan.rig.rigCode } : null,
      project: plan.project ? { id: plan.project.id, name: plan.project.name } : null,
      client: plan.client ? { id: plan.client.id, name: plan.client.name } : null,
      createdBy: { id: plan.createdBy.id, name: plan.createdBy.fullName },
      updatedBy: { id: plan.updatedBy.id, name: plan.updatedBy.fullName },
      createdAt: plan.createdAt,
      updatedAt: plan.updatedAt
    }))
  });
}

export async function POST(request: NextRequest) {
  const auth = await requireApiPermission(request, "finance:edit");
  if (!auth.ok) {
    return auth.response;
  }

  const body = (await request.json().catch(() => null)) as
    | {
        scopeType?: string;
        name?: string;
        amount?: number | string;
        currency?: string;
        periodStart?: string;
        periodEnd?: string;
        notes?: string;
        clientId?: string | null;
        projectId?: string | null;
        rigId?: string | null;
      }
    | null;

  const scopeType = parseBudgetScopeType(body?.scopeType || null);
  const name = normalizePlanName(body?.name);
  const amount = parseNumeric(body?.amount);
  const periodStart = parseDateOrNull(body?.periodStart || null);
  const periodEnd = parseDateOrNull(body?.periodEnd || null, true);
  const currency = typeof body?.currency === "string" && body.currency.trim() ? body.currency.trim().toUpperCase() : "USD";
  const notes = typeof body?.notes === "string" ? body.notes.trim() : "";
  const rawClientId = normalizeId(body?.clientId || null);
  const rawProjectId = normalizeId(body?.projectId || null);
  const rawRigId = normalizeId(body?.rigId || null);

  if (!scopeType) {
    return NextResponse.json({ message: "scopeType must be RIG or PROJECT." }, { status: 400 });
  }
  if (!name) {
    return NextResponse.json({ message: "name is required." }, { status: 400 });
  }
  if (amount === null || amount <= 0) {
    return NextResponse.json({ message: "amount must be a number greater than 0." }, { status: 400 });
  }
  if (!periodStart || !periodEnd) {
    return NextResponse.json({ message: "periodStart and periodEnd are required valid dates." }, { status: 400 });
  }
  if (periodStart.getTime() > periodEnd.getTime()) {
    return NextResponse.json({ message: "periodStart must be on or before periodEnd." }, { status: 400 });
  }

  const normalized = await normalizeScopeContext({
    scopeType,
    clientId: rawClientId,
    projectId: rawProjectId,
    rigId: rawRigId
  });
  if (!normalized.ok) {
    return normalized.response;
  }

  const overlapping = await findOverlappingActivePlan({
    scopeType,
    rigId: normalized.value.rigId,
    projectId: normalized.value.projectId,
    periodStart,
    periodEnd
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

  const created = await prisma.$transaction(async (tx) => {
    const inserted = await tx.budgetPlan.create({
      data: {
        scopeType,
        name,
        amount,
        currency,
        periodStart,
        periodEnd,
        notes: notes || null,
        isActive: true,
        clientId: normalized.value.clientId,
        projectId: normalized.value.projectId,
        rigId: normalized.value.rigId,
        createdById: auth.session.userId,
        updatedById: auth.session.userId
      }
    });

    await recordAuditLog({
      db: tx,
      module: "budgeting",
      entityType: "budget_plan",
      entityId: inserted.id,
      action: "create",
      description: `${auth.session.name} created budget plan ${inserted.name}.`,
      after: {
        id: inserted.id,
        scopeType: inserted.scopeType,
        amount: inserted.amount,
        periodStart: inserted.periodStart,
        periodEnd: inserted.periodEnd,
        projectId: inserted.projectId,
        rigId: inserted.rigId
      },
      actor: auditActorFromSession(auth.session)
    });

    return inserted;
  });

  return NextResponse.json({ data: created }, { status: 201 });
}

function normalizeId(value: string | null) {
  if (!value || value === "all") {
    return null;
  }
  return value;
}

async function normalizeScopeContext({
  scopeType,
  clientId,
  projectId,
  rigId
}: {
  scopeType: BudgetScopeType;
  clientId: string | null;
  projectId: string | null;
  rigId: string | null;
}) {
  if (scopeType === "RIG") {
    if (!rigId) {
      return {
        ok: false as const,
        response: NextResponse.json({ message: "rigId is required for RIG budgets." }, { status: 400 })
      };
    }

    const rig = await prisma.rig.findUnique({
      where: { id: rigId },
      select: { id: true }
    });
    if (!rig) {
      return {
        ok: false as const,
        response: NextResponse.json({ message: "Selected rig was not found." }, { status: 404 })
      };
    }

    if (clientId) {
      const client = await prisma.client.findUnique({
        where: { id: clientId },
        select: { id: true }
      });
      if (!client) {
        return {
          ok: false as const,
          response: NextResponse.json({ message: "Selected client was not found." }, { status: 404 })
        };
      }
    }

    return {
      ok: true as const,
      value: {
        clientId,
        projectId: null,
        rigId
      }
    };
  }

  if (!projectId) {
    return {
      ok: false as const,
      response: NextResponse.json({ message: "projectId is required for PROJECT budgets." }, { status: 400 })
    };
  }

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, clientId: true }
  });
  if (!project) {
    return {
      ok: false as const,
      response: NextResponse.json({ message: "Selected project was not found." }, { status: 404 })
    };
  }
  if (clientId && clientId !== project.clientId) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { message: "Project does not belong to selected client." },
        { status: 400 }
      )
    };
  }

  return {
    ok: true as const,
    value: {
      clientId: project.clientId,
      projectId: project.id,
      rigId: null
    }
  };
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

