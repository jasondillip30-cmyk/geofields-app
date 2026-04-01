import { NextResponse, type NextRequest } from "next/server";

import { requireApiPermission } from "@/lib/auth/api-guard";
import { parsePurchaseRequisitionPayload, PURCHASE_REQUISITION_REPORT_TYPE } from "@/lib/requisition-workflow";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ requisitionId: string }> }
) {
  const auth = await requireApiPermission(request, "expenses:manual");
  if (!auth.ok) {
    return auth.response;
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

  return NextResponse.json({
    data: {
      id: row.id,
      reportDate: row.reportDate.toISOString(),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      ...parsed.payload
    }
  });
}
