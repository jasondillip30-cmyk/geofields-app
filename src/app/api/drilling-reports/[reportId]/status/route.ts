import { NextResponse, type NextRequest } from "next/server";

import { requireApiPermission } from "@/lib/auth/api-guard";
import { canManageDrillingApprovalActions, canUseElevatedDrillingEdit } from "@/lib/auth/approval-policy";
import { auditActorFromSession, recordAuditLog } from "@/lib/audit";
import { prisma } from "@/lib/prisma";

const reportInclude = {
  client: { select: { id: true, name: true } },
  project: { select: { id: true, name: true, status: true } },
  rig: { select: { id: true, rigCode: true, status: true } },
  submittedBy: { select: { id: true, fullName: true } },
  approvedBy: { select: { id: true, fullName: true } }
} as const;

type StatusAction = "submit" | "approve" | "reject" | "reopen";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ reportId: string }> }
) {
  const auth = await requireApiPermission(request, "drilling:view");
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

  const { reportId } = await params;
  const existing = await prisma.drillReport.findUnique({
    where: { id: reportId },
    include: reportInclude
  });

  if (!existing) {
    return NextResponse.json({ message: "Drilling report not found." }, { status: 404 });
  }

  const authorization = ensureAllowedAction({
    action,
    role: auth.session.role,
    submittedById: existing.submittedById,
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

  const updated = await prisma.$transaction(async (tx) => {
    const next = await tx.drillReport.update({
      where: { id: reportId },
      data: transition.data,
      include: reportInclude
    });

    await recordAuditLog({
      db: tx,
      module: "drilling_reports",
      entityType: "drilling_report",
      entityId: reportId,
      action,
      description: buildAuditDescription(action, auth.session.name, reportId),
      before: reportAuditSnapshot(existing),
      after: reportAuditSnapshot(next),
      actor: auditActorFromSession(auth.session)
    });

    return next;
  });

  return NextResponse.json({ data: updated });
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
  submittedById,
  currentUserId
}: {
  action: StatusAction;
  role: string;
  submittedById: string | null;
  currentUserId: string;
}) {
  if (action === "approve" || action === "reject") {
    if (!canManageDrillingApprovalActions(role)) {
      return {
        ok: false as const,
        status: 403,
        message: "Only Admin or Manager can approve or reject drilling reports."
      };
    }
    return { ok: true as const };
  }

  if (action === "reopen") {
    if (role !== "ADMIN" && role !== "MANAGER") {
      return {
        ok: false as const,
        status: 403,
        message: "Only Admin or Manager can reopen drilling reports."
      };
    }
    return { ok: true as const };
  }

  if (action === "submit") {
    if (canUseElevatedDrillingEdit(role)) {
      return { ok: true as const };
    }
    if (submittedById && submittedById !== currentUserId) {
      return {
        ok: false as const,
        status: 403,
        message: "You can only submit drilling reports that you created."
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
  status: string;
  userId: string;
  reason: string;
}) {
  if (action === "submit") {
    if (status === "SUBMITTED") {
      return { ok: false as const, message: "Drilling report is already submitted." };
    }
    if (status === "APPROVED") {
      return { ok: false as const, message: "Approved drilling report cannot be submitted again." };
    }
    return {
      ok: true as const,
      data: {
        approvalStatus: "SUBMITTED" as const,
        submittedAt: new Date(),
        rejectionReason: null,
        approvedAt: null,
        approvedBy: { disconnect: true }
      }
    };
  }

  if (action === "approve") {
    if (status !== "SUBMITTED") {
      return { ok: false as const, message: "Only submitted drilling reports can be approved." };
    }
    return {
      ok: true as const,
      data: {
        approvalStatus: "APPROVED" as const,
        approvedAt: new Date(),
        rejectionReason: null,
        approvedBy: { connect: { id: userId } }
      }
    };
  }

  if (action === "reject") {
    if (status !== "SUBMITTED") {
      return { ok: false as const, message: "Only submitted drilling reports can be rejected." };
    }
    return {
      ok: true as const,
      data: {
        approvalStatus: "REJECTED" as const,
        approvedAt: new Date(),
        rejectionReason: reason,
        approvedBy: { connect: { id: userId } }
      }
    };
  }

  if (status !== "APPROVED") {
    return { ok: false as const, message: "Only approved drilling reports can be reopened." };
  }
  return {
    ok: true as const,
    data: {
      approvalStatus: "DRAFT" as const,
      approvedAt: null,
      rejectionReason: null,
      approvedBy: { disconnect: true }
    }
  };
}

function buildAuditDescription(action: StatusAction, actorName: string, reportId: string) {
  if (action === "submit") {
    return `${actorName} submitted Drilling Report ${reportId} for approval.`;
  }
  if (action === "approve") {
    return `${actorName} approved Drilling Report ${reportId}.`;
  }
  if (action === "reject") {
    return `${actorName} rejected Drilling Report ${reportId}.`;
  }
  return `${actorName} reopened Drilling Report ${reportId}.`;
}

function reportAuditSnapshot(report: {
  id: string;
  date: Date;
  projectId: string;
  rigId: string;
  clientId: string;
  totalMetersDrilled: number;
  billableAmount: number;
  approvalStatus: string;
  submittedAt: Date | null;
  approvedAt: Date | null;
  rejectionReason: string | null;
}) {
  return {
    id: report.id,
    date: report.date,
    projectId: report.projectId,
    rigId: report.rigId,
    clientId: report.clientId,
    totalMetersDrilled: report.totalMetersDrilled,
    billableAmount: report.billableAmount,
    approvalStatus: report.approvalStatus,
    submittedAt: report.submittedAt,
    approvedAt: report.approvedAt,
    rejectionReason: report.rejectionReason
  };
}
