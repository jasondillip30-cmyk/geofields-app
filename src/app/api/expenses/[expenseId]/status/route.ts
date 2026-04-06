import type { EntryApprovalStatus } from "@prisma/client";
import { NextResponse, type NextRequest } from "next/server";

import { canManageExpenseApprovalActions } from "@/lib/auth/approval-policy";
import { requireApiPermission } from "@/lib/auth/api-guard";
import { auditActorFromSession, recordAuditLog } from "@/lib/audit";
import { prisma } from "@/lib/prisma";

const expenseInclude = {
  client: { select: { id: true, name: true } },
  project: { select: { id: true, name: true } },
  rig: { select: { id: true, rigCode: true } },
  enteredBy: { select: { id: true, fullName: true } },
  approvedBy: { select: { id: true, fullName: true } }
} as const;

type StatusAction = "submit" | "approve" | "reject" | "reopen";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ expenseId: string }> }
) {
  const auth = await requireApiPermission(request, "expenses:manual");
  if (!auth.ok) {
    return auth.response;
  }

  const body = await request.json().catch(() => null);
  const action = parseAction(typeof body?.action === "string" ? body.action : "");
  if (!action) {
    return NextResponse.json(
      { message: "action is required. Use submit, approve, reject, or reopen." },
      { status: 400 }
    );
  }

  const rejectionReason = typeof body?.reason === "string" ? body.reason.trim() : "";
  if (action === "reject" && rejectionReason.length < 3) {
    return NextResponse.json(
      { message: "Rejection reason is required (minimum 3 characters)." },
      { status: 400 }
    );
  }

  const { expenseId } = await params;
  const existing = await prisma.expense.findUnique({
    where: { id: expenseId },
    include: expenseInclude
  });

  if (!existing) {
    return NextResponse.json({ message: "Expense not found." }, { status: 404 });
  }

  const authorization = ensureAllowedAction({
    action,
    role: auth.session.role,
    submittedByUserId: existing.enteredByUserId,
    currentUserId: auth.session.userId
  });
  if (!authorization.ok) {
    return NextResponse.json({ message: authorization.message }, { status: authorization.status });
  }

  const transition = buildTransition({
    action,
    status: existing.approvalStatus,
    userId: auth.session.userId,
    reason: rejectionReason
  });
  if (!transition.ok) {
    return NextResponse.json({ message: transition.message }, { status: 409 });
  }

  let updated: NonNullable<Awaited<ReturnType<typeof prisma.expense.findUnique>>> | null = null;
  try {
    updated = await prisma.$transaction(async (tx) => {
      const transitionLock = await tx.expense.updateMany({
        where: {
          id: expenseId,
          approvalStatus: transition.expectedStatus
        },
        data: transition.data
      });

      if (transitionLock.count === 0) {
        throw new Error("ExpenseStatusTransitionConflict");
      }

      const next = await tx.expense.findUnique({
        where: { id: expenseId },
        include: expenseInclude
      });
      if (!next) {
        throw new Error("ExpenseMissingAfterTransition");
      }

      await recordAuditLog({
        db: tx,
        module: "expenses",
        entityType: "expense",
        entityId: expenseId,
        action,
        description: buildAuditDescription(action, auth.session.name, expenseId),
        before: expenseAuditSnapshot(existing),
        after: expenseAuditSnapshot(next),
        actor: auditActorFromSession(auth.session)
      });

      return next;
    });
  } catch (error) {
    if (error instanceof Error && error.message === "ExpenseStatusTransitionConflict") {
      return NextResponse.json(
        {
          message:
            "Expense status changed by another action. Refresh and retry with the latest record state."
        },
        { status: 409 }
      );
    }
    throw error;
  }

  if (!updated) {
    return NextResponse.json({ message: "Expense status update could not be confirmed." }, { status: 500 });
  }

  return NextResponse.json({ data: serializeExpenseForClient(updated) });
}

function parseAction(value: string): StatusAction | null {
  if (value === "submit" || value === "approve" || value === "reject" || value === "reopen") {
    return value;
  }
  return null;
}

function ensureAllowedAction({
  action,
  role,
  submittedByUserId,
  currentUserId
}: {
  action: StatusAction;
  role: string;
  submittedByUserId: string | null;
  currentUserId: string;
}) {
  if (action === "approve" || action === "reject" || action === "reopen") {
    if (!canManageExpenseApprovalActions(role)) {
      return {
        ok: false as const,
        status: 403,
        message: "Only Admin or Manager can approve, reject, or reopen expenses."
      };
    }
    return { ok: true as const };
  }

  if (action === "submit") {
    if (role === "ADMIN") {
      return { ok: true as const };
    }
    if (submittedByUserId && submittedByUserId !== currentUserId) {
      return {
        ok: false as const,
        status: 403,
        message: "You can only submit your own expense records."
      };
    }
    return { ok: true as const };
  }

  return { ok: true as const };
}

function buildTransition({
  action,
  status,
  userId,
  reason
}: {
  action: StatusAction;
  status: EntryApprovalStatus;
  userId: string;
  reason: string;
}) {
  if (action === "submit") {
    if (status === "SUBMITTED") {
      return { ok: false as const, message: "Expense is already submitted." };
    }
    if (status === "APPROVED") {
      return { ok: false as const, message: "Approved expense cannot be submitted again." };
    }
    return {
      ok: true as const,
      expectedStatus: status,
      data: {
        approvalStatus: "SUBMITTED" as const,
        submittedAt: new Date(),
        rejectionReason: null,
        approvedAt: null,
        approvedById: null
      }
    };
  }

  if (action === "approve") {
    if (status !== "SUBMITTED") {
      return { ok: false as const, message: "Only submitted expenses can be approved." };
    }
    return {
      ok: true as const,
      expectedStatus: status,
      data: {
        approvalStatus: "APPROVED" as const,
        approvedAt: new Date(),
        rejectionReason: null,
        approvedById: userId
      }
    };
  }

  if (action === "reject") {
    if (status !== "SUBMITTED") {
      return { ok: false as const, message: "Only submitted expenses can be rejected." };
    }
    return {
      ok: true as const,
      expectedStatus: status,
      data: {
        approvalStatus: "REJECTED" as const,
        approvedAt: new Date(),
        rejectionReason: reason,
        approvedById: userId
      }
    };
  }

  if (status !== "APPROVED") {
    return { ok: false as const, message: "Only approved expenses can be reopened." };
  }
  return {
    ok: true as const,
    expectedStatus: status,
    data: {
      approvalStatus: "DRAFT" as const,
      approvedAt: null,
      rejectionReason: null,
      approvedById: null
    }
  };
}

function buildAuditDescription(action: StatusAction, actorName: string, expenseId: string) {
  if (action === "submit") {
    return `${actorName} submitted Expense ${expenseId} for approval.`;
  }
  if (action === "approve") {
    return `${actorName} approved Expense ${expenseId}.`;
  }
  if (action === "reject") {
    return `${actorName} rejected Expense ${expenseId}.`;
  }
  return `${actorName} reopened Expense ${expenseId}.`;
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
    approvalStatus: expense.approvalStatus,
    submittedAt: expense.submittedAt,
    approvedAt: expense.approvedAt,
    rejectionReason: expense.rejectionReason,
    clientId: expense.clientId,
    projectId: expense.projectId,
    rigId: expense.rigId
  };
}
