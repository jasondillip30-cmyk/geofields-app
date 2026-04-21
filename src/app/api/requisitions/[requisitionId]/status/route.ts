import { NextResponse, type NextRequest } from "next/server";

import { canManageExpenseApprovalActions } from "@/lib/auth/approval-policy";
import { requireApiPermission } from "@/lib/auth/api-guard";
import { isRequisitionTypeAllowedForRole } from "@/lib/auth/requisition-access";
import { auditActorFromSession, recordAuditLog } from "@/lib/audit";
import {
  parsePurchaseRequisitionPayload,
  PURCHASE_REQUISITION_REPORT_TYPE,
  type PurchaseRequisitionPayload
} from "@/lib/requisition-workflow";
import { prisma } from "@/lib/prisma";

type RequisitionStatusAction = "approve" | "reject" | "reopen";

export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ requisitionId: string }> }
) {
  const auth = await requireApiPermission(request, "requisitions:view");
  if (!auth.ok) {
    return auth.response;
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const action = parseAction(body?.action);
  if (!action) {
    return NextResponse.json(
      { message: "action is required. Use approve, reject, or reopen." },
      { status: 400 }
    );
  }

  if (!canManageExpenseApprovalActions(auth.session.role)) {
    return NextResponse.json(
      { message: "Only Admin or Manager can approve or reject requisitions." },
      { status: 403 }
    );
  }

  const { requisitionId } = await params;
  if (!requisitionId) {
    return NextResponse.json({ message: "Requisition ID is required." }, { status: 400 });
  }

  const row = await prisma.summaryReport.findUnique({
    where: { id: requisitionId }
  });
  if (!row || row.reportType !== PURCHASE_REQUISITION_REPORT_TYPE) {
    return NextResponse.json({ message: "Requisition not found." }, { status: 404 });
  }

  const parsed = parsePurchaseRequisitionPayload(row.payloadJson);
  if (!parsed) {
    return NextResponse.json({ message: "Requisition payload is invalid." }, { status: 422 });
  }
  if (!isRequisitionTypeAllowedForRole(auth.session.role, parsed.payload.type)) {
    return NextResponse.json({ message: "Requisition not found." }, { status: 404 });
  }

  const rejectionReason = typeof body?.reason === "string" ? body.reason.trim() : "";
  if (action === "reject" && rejectionReason.length < 3) {
    return NextResponse.json(
      { message: "Rejection reason is required (minimum 3 characters)." },
      { status: 400 }
    );
  }

  const transition = transitionPayload({
    current: parsed.payload,
    action,
    actor: {
      userId: auth.session.userId,
      name: auth.session.name,
      role: auth.session.role
    },
    rejectionReason
  });
  if (!transition.ok) {
    return NextResponse.json({ message: transition.message }, { status: 409 });
  }

  let updated: NonNullable<Awaited<ReturnType<typeof prisma.summaryReport.findUnique>>> | null =
    null;
  try {
    updated = await prisma.$transaction(async (tx) => {
      const transitionLock = await tx.summaryReport.updateMany({
        where: {
          id: row.id,
          updatedAt: row.updatedAt
        },
        data: {
          payloadJson: JSON.stringify(transition.payload),
          reportDate: new Date()
        }
      });

      if (transitionLock.count === 0) {
        throw new Error("RequisitionStatusTransitionConflict");
      }

      const next = await tx.summaryReport.findUnique({
        where: { id: row.id }
      });
      if (!next) {
        throw new Error("RequisitionMissingAfterTransition");
      }

      await recordAuditLog({
        db: tx,
        module: "expenses",
        entityType: "purchase_requisition",
        entityId: row.id,
        action,
        description: buildAuditDescription(action, auth.session.name, transition.payload.requisitionCode),
        before: {
          status: parsed.payload.status,
          rejectionReason: parsed.payload.approval.rejectionReason
        },
        after: {
          status: transition.payload.status,
          rejectionReason: transition.payload.approval.rejectionReason
        },
        actor: auditActorFromSession(auth.session)
      });

      return next;
    });
  } catch (error) {
    if (error instanceof Error && error.message === "RequisitionStatusTransitionConflict") {
      return NextResponse.json(
        {
          message:
            "Requisition status changed by another action. Refresh and retry with the latest record state."
        },
        { status: 409 }
      );
    }
    throw error;
  }

  if (!updated) {
    return NextResponse.json(
      { message: "Requisition status update could not be confirmed." },
      { status: 500 }
    );
  }

  return NextResponse.json({
    data: {
      id: updated.id,
      reportDate: updated.reportDate.toISOString(),
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
      ...transition.payload
    }
  });
}

function parseAction(value: unknown): RequisitionStatusAction | null {
  if (value === "approve" || value === "reject" || value === "reopen") {
    return value;
  }
  return null;
}

function transitionPayload({
  current,
  action,
  actor,
  rejectionReason
}: {
  current: PurchaseRequisitionPayload;
  action: RequisitionStatusAction;
  actor: {
    userId: string;
    name: string;
    role: string;
  };
  rejectionReason: string;
}) {
  if (current.status === "PURCHASE_COMPLETED") {
    return {
      ok: false as const,
      message: "Completed requisitions cannot be modified."
    };
  }

  const next: PurchaseRequisitionPayload = JSON.parse(JSON.stringify(current));
  const nowIso = new Date().toISOString();

  if (action === "approve") {
    if (current.status !== "SUBMITTED") {
      return {
        ok: false as const,
        message: "Only submitted requisitions can be approved."
      };
    }
    next.status = "APPROVED";
    next.approval.approvedAt = nowIso;
    next.approval.approvedBy = actor;
    next.approval.rejectedAt = null;
    next.approval.rejectedBy = null;
    next.approval.rejectionReason = null;
    return { ok: true as const, payload: next };
  }

  if (action === "reject") {
    if (current.status !== "SUBMITTED") {
      return {
        ok: false as const,
        message: "Only submitted requisitions can be rejected."
      };
    }
    next.status = "REJECTED";
    next.approval.rejectedAt = nowIso;
    next.approval.rejectedBy = actor;
    next.approval.rejectionReason = rejectionReason;
    next.approval.approvedAt = null;
    next.approval.approvedBy = null;
    return { ok: true as const, payload: next };
  }

  if (current.status !== "REJECTED" && current.status !== "APPROVED") {
    return {
      ok: false as const,
      message: "Only approved/rejected requisitions can be reopened."
    };
  }
  next.status = "SUBMITTED";
  next.approval.approvedAt = null;
  next.approval.approvedBy = null;
  next.approval.rejectedAt = null;
  next.approval.rejectedBy = null;
  next.approval.rejectionReason = null;
  return { ok: true as const, payload: next };
}

function buildAuditDescription(
  action: RequisitionStatusAction,
  actorName: string,
  requisitionCode: string
) {
  if (action === "approve") {
    return `${actorName} approved requisition ${requisitionCode}.`;
  }
  if (action === "reject") {
    return `${actorName} rejected requisition ${requisitionCode}.`;
  }
  return `${actorName} reopened requisition ${requisitionCode}.`;
}
