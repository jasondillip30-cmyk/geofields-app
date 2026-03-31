import { NextResponse, type NextRequest } from "next/server";

import { requireApiPermission } from "@/lib/auth/api-guard";
import { auditActorFromSession, recordAuditLog } from "@/lib/audit";
import { isSupportedExpenseCategory } from "@/lib/expense-categories";
import { prisma } from "@/lib/prisma";

const expenseInclude = {
  client: { select: { id: true, name: true } },
  project: { select: { id: true, name: true } },
  rig: { select: { id: true, rigCode: true } },
  enteredBy: { select: { id: true, fullName: true } },
  approvedBy: { select: { id: true, fullName: true } }
} as const;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ expenseId: string }> }
) {
  const auth = await requireApiPermission(request, "expenses:manual");
  if (!auth.ok) {
    return auth.response;
  }

  const { expenseId } = await params;
  const expense = await prisma.expense.findUnique({
    where: { id: expenseId },
    include: expenseInclude
  });

  if (!expense) {
    return NextResponse.json({ message: "Expense not found." }, { status: 404 });
  }

  return NextResponse.json({ data: serializeExpenseForClient(expense) });
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ expenseId: string }> }
) {
  const auth = await requireApiPermission(request, "expenses:manual");
  if (!auth.ok) {
    return auth.response;
  }

  const { expenseId } = await params;
  const body = await request.json().catch(() => null);

  const date = parseDate(typeof body?.date === "string" ? body.date : "");
  const amount = parseAmount(body?.amount);
  const quantity = parsePositiveNumber(body?.quantity);
  const unitCost = parsePositiveNumber(body?.unitCost);
  const resolvedAmount = resolveExpenseAmount({
    amount,
    quantity,
    unitCost
  });
  const category = typeof body?.category === "string" ? body.category : "";
  const clientId = nullableString(typeof body?.clientId === "string" ? body.clientId.trim() : "");
  const projectId = nullableString(typeof body?.projectId === "string" ? body.projectId.trim() : "");

  if (!date || resolvedAmount === null || !category || !isSupportedExpenseCategory(category)) {
    return NextResponse.json({ message: "Valid date, amount, and category are required." }, { status: 400 });
  }

  const [validation, existing] = await Promise.all([
    validateClientProject(clientId, projectId),
    prisma.expense.findUnique({
      where: { id: expenseId },
      include: expenseInclude
    })
  ]);

  if (!validation.ok) {
    return validation.response;
  }
  if (!existing) {
    return NextResponse.json({ message: "Expense not found." }, { status: 404 });
  }

  if (existing.approvalStatus === "APPROVED") {
    return NextResponse.json(
      { message: "Approved expenses are locked. Reopen the record before editing." },
      { status: 409 }
    );
  }

  const rigId = nullableString(typeof body?.rigId === "string" ? body.rigId : "");
  const isRejectedEdit = existing.approvalStatus === "REJECTED";

  const updated = await prisma.$transaction(async (tx) => {
    const next = await tx.expense.update({
      where: { id: expenseId },
      data: {
        date: new Date(date),
        category,
        subcategory: nullableString(typeof body?.subcategory === "string" ? body.subcategory : ""),
        amount: resolvedAmount,
        quantity,
        unitCost,
        receiptNumber: nullableString(typeof body?.receiptNumber === "string" ? body.receiptNumber : ""),
        vendor: nullableString(typeof body?.vendor === "string" ? body.vendor : ""),
        notes: nullableString(typeof body?.notes === "string" ? body.notes : ""),
        receiptUrl: nullableString(typeof body?.receiptUrl === "string" ? body.receiptUrl : ""),
        client: validation.value.clientId
          ? { connect: { id: validation.value.clientId } }
          : { disconnect: true },
        project: validation.value.projectId
          ? { connect: { id: validation.value.projectId } }
          : { disconnect: true },
        rig: rigId ? { connect: { id: rigId } } : { disconnect: true },
        ...(isRejectedEdit
          ? {
              approvalStatus: "DRAFT",
              rejectionReason: null,
              approvedAt: null,
              approvedBy: { disconnect: true }
            }
          : {})
      },
      include: expenseInclude
    });

    await recordAuditLog({
      db: tx,
      module: "expenses",
      entityType: "expense",
      entityId: next.id,
      action: "edit",
      description: `${auth.session.name} updated Expense ${next.id}.`,
      before: expenseAuditSnapshot(existing),
      after: expenseAuditSnapshot(next),
      actor: auditActorFromSession(auth.session)
    });

    return next;
  });

  return NextResponse.json({ data: serializeExpenseForClient(updated) });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ expenseId: string }> }
) {
  const auth = await requireApiPermission(request, "expenses:manual");
  if (!auth.ok) {
    return auth.response;
  }

  const { expenseId } = await params;
  const existing = await prisma.expense.findUnique({
    where: { id: expenseId },
    include: expenseInclude
  });

  if (!existing) {
    return NextResponse.json({ message: "Expense not found." }, { status: 404 });
  }

  if (existing.approvalStatus === "APPROVED") {
    return NextResponse.json(
      { message: "Approved expenses are locked and cannot be deleted." },
      { status: 409 }
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.expense.delete({
      where: { id: expenseId }
    });

    await recordAuditLog({
      db: tx,
      module: "expenses",
      entityType: "expense",
      entityId: expenseId,
      action: "delete",
      description: `${auth.session.name} deleted Expense ${expenseId}.`,
      before: expenseAuditSnapshot(existing),
      actor: auditActorFromSession(auth.session)
    });
  });

  return NextResponse.json({ ok: true });
}

function parseAmount(value: unknown) {
  const parsed = Number(value ?? 0);
  if (Number.isNaN(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}

function parsePositiveNumber(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const parsed = Number(value);
  if (Number.isNaN(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}

function resolveExpenseAmount({
  amount,
  quantity,
  unitCost
}: {
  amount: number | null;
  quantity: number | null;
  unitCost: number | null;
}) {
  if (amount !== null) {
    return amount;
  }
  if (quantity !== null && unitCost !== null) {
    return Number((quantity * unitCost).toFixed(2));
  }
  return null;
}

function parseDate(value: string) {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed;
}

function nullableString(value: string) {
  return value ? value : null;
}

async function validateClientProject(clientId: string | null, projectId: string | null) {
  let normalizedClientId = clientId;
  let normalizedProjectId = projectId;

  if (normalizedProjectId) {
    const project = await prisma.project.findUnique({
      where: { id: normalizedProjectId },
      select: { id: true, clientId: true }
    });

    if (!project) {
      return {
        ok: false as const,
        response: NextResponse.json({ message: "Project not found." }, { status: 404 })
      };
    }

    if (normalizedClientId && project.clientId !== normalizedClientId) {
      return {
        ok: false as const,
        response: NextResponse.json(
          { message: "Selected project does not belong to selected client." },
          { status: 400 }
        )
      };
    }

    normalizedClientId = project.clientId;
    normalizedProjectId = project.id;
  }

  if (normalizedClientId) {
    const client = await prisma.client.findUnique({
      where: { id: normalizedClientId },
      select: { id: true }
    });
    if (!client) {
      return {
        ok: false as const,
        response: NextResponse.json({ message: "Client not found." }, { status: 404 })
      };
    }
  }

  return {
    ok: true as const,
    value: {
      clientId: normalizedClientId,
      projectId: normalizedProjectId
    }
  };
}

function serializeExpenseForClient(expense: {
  id: string;
  date: Date;
  amount: number;
  category: string;
  subcategory: string | null;
  entrySource: string;
  vendor: string | null;
  receiptNumber: string | null;
  quantity: number | null;
  unitCost: number | null;
  receiptUrl: string | null;
  receiptFileName: string | null;
  enteredByUserId: string | null;
  submittedAt: Date | null;
  approvedById: string | null;
  approvalStatus: string;
  approvedAt: Date | null;
  rejectionReason: string | null;
  clientId: string | null;
  projectId: string | null;
  rigId: string | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
  client?: { id: string; name: string } | null;
  project?: { id: string; name: string } | null;
  rig?: { id: string; rigCode: string } | null;
  enteredBy?: { id: string; fullName: string } | null;
  approvedBy?: { id: string; fullName: string } | null;
}) {
  return {
    id: expense.id,
    date: expense.date,
    amount: expense.amount,
    category: expense.category,
    subcategory: expense.subcategory,
    entrySource: expense.entrySource,
    vendor: expense.vendor,
    receiptNumber: expense.receiptNumber,
    quantity: expense.quantity,
    unitCost: expense.unitCost,
    receiptUrl: expense.receiptUrl,
    receiptFileName: expense.receiptFileName,
    enteredByUserId: expense.enteredByUserId,
    submittedAt: expense.submittedAt,
    approvedById: expense.approvedById,
    approvalStatus: expense.approvalStatus,
    approvedAt: expense.approvedAt,
    rejectionReason: expense.rejectionReason,
    clientId: expense.clientId,
    projectId: expense.projectId,
    rigId: expense.rigId,
    notes: expense.notes,
    createdAt: expense.createdAt,
    updatedAt: expense.updatedAt,
    client: expense.client || null,
    project: expense.project || null,
    rig: expense.rig || null,
    enteredBy: expense.enteredBy || null,
    approvedBy: expense.approvedBy || null
  };
}

function expenseAuditSnapshot(expense: {
  id: string;
  date: Date;
  amount: number;
  category: string;
  subcategory: string | null;
  vendor: string | null;
  quantity?: number | null;
  unitCost?: number | null;
  receiptNumber?: string | null;
  approvalStatus: string;
  submittedAt: Date | null;
  approvedAt: Date | null;
  rejectionReason: string | null;
  clientId: string | null;
  projectId: string | null;
  rigId: string | null;
}) {
  return {
    id: expense.id,
    date: expense.date,
    amount: expense.amount,
    category: expense.category,
    subcategory: expense.subcategory,
    vendor: expense.vendor,
    quantity: expense.quantity ?? null,
    unitCost: expense.unitCost ?? null,
    receiptNumber: expense.receiptNumber ?? null,
    approvalStatus: expense.approvalStatus,
    submittedAt: expense.submittedAt,
    approvedAt: expense.approvedAt,
    rejectionReason: expense.rejectionReason,
    clientId: expense.clientId,
    projectId: expense.projectId,
    rigId: expense.rigId
  };
}
