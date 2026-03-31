import { NextResponse, type NextRequest } from "next/server";

import { canAccess } from "@/lib/auth/permissions";
import { requireApiPermission } from "@/lib/auth/api-guard";
import { auditActorFromSession, recordAuditLog } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { parseReceiptSubmissionPayload, type ReceiptSubmissionStatus } from "@/lib/receipt-intake-submission";

const RECEIPT_SUBMISSION_REPORT_TYPE = "INVENTORY_RECEIPT_SUBMISSION";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ submissionId: string }> }
) {
  const auth = await requireApiPermission(request, "inventory:view");
  if (!auth.ok) {
    return auth.response;
  }

  const canManage = canAccess(auth.session.role, "inventory:manage");
  const { submissionId } = await context.params;
  if (!submissionId) {
    return NextResponse.json({ message: "Submission ID is required." }, { status: 400 });
  }

  const row = await prisma.summaryReport.findUnique({
    where: { id: submissionId },
    select: {
      id: true,
      reportType: true,
      reportDate: true,
      generatedById: true,
      payloadJson: true
    }
  });

  if (!row || row.reportType !== RECEIPT_SUBMISSION_REPORT_TYPE) {
    return NextResponse.json({ message: "Receipt submission not found." }, { status: 404 });
  }
  if (!canManage && row.generatedById !== auth.session.userId) {
    return NextResponse.json(
      { message: "Forbidden: missing required permission 'inventory:manage'." },
      { status: 403 }
    );
  }

  const parsed = parseReceiptSubmissionPayload(row.payloadJson);
  if (!parsed) {
    return NextResponse.json({ message: "Receipt submission payload is invalid." }, { status: 422 });
  }

  return NextResponse.json({
    data: {
      id: row.id,
      reportDate: row.reportDate.toISOString(),
      generatedById: row.generatedById,
      status: parsed.status,
      submissionStatus: parsed.submissionStatus,
      submittedAt: parsed.submittedAt,
      submittedBy: parsed.submittedBy,
      reviewer: parsed.reviewer,
      resolution: parsed.resolution,
      draft: parsed.draft
    }
  });
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ submissionId: string }> }
) {
  const auth = await requireApiPermission(request, "inventory:manage");
  if (!auth.ok) {
    return auth.response;
  }

  const { submissionId } = await context.params;
  if (!submissionId) {
    return NextResponse.json({ message: "Submission ID is required." }, { status: 400 });
  }

  const body = (await request.json().catch(() => null)) as
    | {
        action?: "reject" | "reopen";
        reason?: string;
      }
    | null;

  const action = body?.action;
  if (action !== "reject" && action !== "reopen") {
    return NextResponse.json({ message: "Action must be reject or reopen." }, { status: 400 });
  }

  const existing = await prisma.summaryReport.findUnique({
    where: { id: submissionId },
    select: {
      id: true,
      reportType: true,
      payloadJson: true
    }
  });

  if (!existing || existing.reportType !== RECEIPT_SUBMISSION_REPORT_TYPE) {
    return NextResponse.json({ message: "Receipt submission not found." }, { status: 404 });
  }

  const parsed = parseReceiptSubmissionPayload(existing.payloadJson);
  if (!parsed) {
    return NextResponse.json({ message: "Receipt submission payload is invalid." }, { status: 422 });
  }

  if (action === "reject" && parsed.status === "APPROVED") {
    return NextResponse.json({ message: "Approved submissions cannot be rejected." }, { status: 409 });
  }

  const note = typeof body?.reason === "string" ? body.reason.trim() : "";
  if (action === "reject" && note.length < 3) {
    return NextResponse.json({ message: "Rejection reason must be at least 3 characters." }, { status: 400 });
  }

  const decidedAtIso = new Date().toISOString();
  const nextStatus: ReceiptSubmissionStatus = action === "reject" ? "REJECTED" : "SUBMITTED";
  const nextPayload = {
    ...parsed.raw,
      status: nextStatus,
      submissionStatus: nextStatus === "SUBMITTED" ? "PENDING_REVIEW" : "REJECTED",
    reviewer: {
      userId: auth.session.userId,
      name: auth.session.name,
      role: auth.session.role,
      decision: action === "reject" ? "REJECTED" : "REOPENED",
      decidedAt: decidedAtIso,
      note
    }
  };

  await prisma.summaryReport.update({
    where: { id: submissionId },
    data: {
      payloadJson: JSON.stringify(nextPayload),
      reportDate: new Date()
    }
  });

  await recordAuditLog({
    module: "inventory",
    entityType: "receipt_intake_submission",
    entityId: submissionId,
    action: action === "reject" ? "reject" : "reopen",
    description:
      action === "reject"
        ? `${auth.session.name} rejected receipt submission ${submissionId}.`
        : `${auth.session.name} reopened receipt submission ${submissionId}.`,
    before: {
      status: parsed.status
    },
    after: {
      status: nextStatus,
      note
    },
    actor: auditActorFromSession(auth.session)
  });

  return NextResponse.json({
    success: true,
    message: action === "reject" ? "Receipt submission rejected." : "Receipt submission reopened for review.",
    data: {
      id: submissionId,
      status: nextStatus,
      submissionStatus: nextStatus === "SUBMITTED" ? "PENDING_REVIEW" : "REJECTED"
    }
  });
}
