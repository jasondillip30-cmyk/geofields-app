import { NextResponse, type NextRequest } from "next/server";
import type { Prisma } from "@prisma/client";

import { canAccess } from "@/lib/auth/permissions";
import { requireAnyApiPermission } from "@/lib/auth/api-guard";
import { prisma } from "@/lib/prisma";
import { parseReceiptSubmissionPayload, type ReceiptSubmissionStatus } from "@/lib/receipt-intake-submission";

const RECEIPT_SUBMISSION_REPORT_TYPE = "INVENTORY_RECEIPT_SUBMISSION";

export async function GET(request: NextRequest) {
  const auth = await requireAnyApiPermission(request, ["inventory:view", "requisitions:view"]);
  if (!auth.ok) {
    return auth.response;
  }

  const canManage = canAccess(auth.session.role, "inventory:manage");
  const statusFilter = normalizeSubmissionStatus(request.nextUrl.searchParams.get("status"));
  const from = parseDate(request.nextUrl.searchParams.get("from"));
  const to = parseDate(request.nextUrl.searchParams.get("to"), true);
  const clientId = normalizeScopedId(request.nextUrl.searchParams.get("clientId"));
  const rigId = normalizeScopedId(request.nextUrl.searchParams.get("rigId"));

  const where: Prisma.SummaryReportWhereInput = {
    reportType: RECEIPT_SUBMISSION_REPORT_TYPE,
    ...(canManage ? {} : { generatedById: auth.session.userId }),
    ...(clientId ? { clientId } : {}),
    ...(from || to
      ? {
          reportDate: {
            ...(from ? { gte: from } : {}),
            ...(to ? { lte: to } : {})
          }
        }
      : {})
  };

  const rows = await prisma.summaryReport.findMany({
    where,
    orderBy: { reportDate: "desc" },
    take: 150,
    select: {
      id: true,
      reportDate: true,
      generatedById: true,
      payloadJson: true,
      projectId: true,
      clientId: true
    }
  });

  const data = rows
    .map((row) => {
      const parsed = parseReceiptSubmissionPayload(row.payloadJson);
      if (!parsed || !parsed.normalizedDraft || !parsed.classification) {
        return null;
      }
      if (statusFilter && parsed.status !== statusFilter) {
        return null;
      }
      if (rigId && parsed.normalizedDraft.linkContext.rigId !== rigId) {
        return null;
      }
      return {
        id: row.id,
        reportDate: row.reportDate.toISOString(),
        generatedById: row.generatedById || null,
        status: parsed.status,
        submissionStatus: parsed.submissionStatus,
        submittedAt: parsed.submittedAt,
        submittedBy: parsed.submittedBy,
        reviewer: parsed.reviewer,
        resolution: parsed.resolution,
        summary: {
          supplierName: parsed.normalizedDraft.receipt.supplierName || "",
          receiptNumber: parsed.normalizedDraft.receipt.receiptNumber || "",
          verificationCode: parsed.normalizedDraft.receipt.verificationCode || "",
          serialNumber: parsed.normalizedDraft.receipt.serialNumber || "",
          receiptDate: parsed.normalizedDraft.receipt.receiptDate || "",
          total: parsed.normalizedDraft.receipt.total || 0,
          traReceiptNumber: parsed.normalizedDraft.receipt.traReceiptNumber || ""
        },
        classification: parsed.classification,
        receiptType: parsed.normalizedDraft.receiptType,
        receiptPurpose: parsed.normalizedDraft.receiptPurpose,
        linkContext: parsed.normalizedDraft.linkContext
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));

  return NextResponse.json({ data });
}

function normalizeScopedId(value: string | null) {
  if (!value || value === "all") {
    return null;
  }
  return value;
}

function normalizeSubmissionStatus(value: string | null): ReceiptSubmissionStatus | null {
  if (value === "SUBMITTED" || value === "APPROVED" || value === "REJECTED") {
    return value;
  }
  return null;
}

function parseDate(value: string | null, endOfDay = false) {
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
