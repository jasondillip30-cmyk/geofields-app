import { NextResponse, type NextRequest } from "next/server";

import { requireApiPermission } from "@/lib/auth/api-guard";
import { withFinancialDrillReportApproval } from "@/lib/financial-approval-policy";
import { prisma } from "@/lib/prisma";

const reportInclude = {
  client: { select: { id: true, name: true } },
  project: { select: { id: true, name: true, status: true } },
  rig: { select: { id: true, rigCode: true, status: true } },
  submittedBy: { select: { id: true, fullName: true } },
  approvedBy: { select: { id: true, fullName: true } },
  inventoryMovements: {
    where: {
      movementType: "OUT",
      contextType: "DRILLING_REPORT"
    },
    orderBy: { date: "desc" },
    select: {
      id: true,
      date: true,
      quantity: true,
      totalCost: true,
      item: {
        select: {
          id: true,
          name: true,
          sku: true
        }
      },
      expense: {
        select: {
          id: true,
          amount: true,
          approvalStatus: true
        }
      }
    }
  }
} as const;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ reportId: string }> }
) {
  const auth = await requireApiPermission(request, "finance:view");
  if (!auth.ok) {
    return auth.response;
  }

  const { reportId } = await params;
  if (!reportId) {
    return NextResponse.json({ message: "Report ID is required." }, { status: 400 });
  }

  const fromDate = parseDateOrNull(request.nextUrl.searchParams.get("from"));
  const toDate = parseDateOrNull(request.nextUrl.searchParams.get("to"), true);
  const rawClientId = nullableFilter(request.nextUrl.searchParams.get("clientId"));
  const rawRigId = nullableFilter(request.nextUrl.searchParams.get("rigId"));
  const projectId = nullableFilter(request.nextUrl.searchParams.get("projectId"));
  const clientId = projectId ? null : rawClientId;
  const rigId = projectId ? null : rawRigId;

  const where = withFinancialDrillReportApproval({
    id: reportId,
    ...(projectId ? { projectId } : {}),
    ...(clientId ? { clientId } : {}),
    ...(rigId ? { rigId } : {}),
    ...(fromDate || toDate
      ? {
          date: {
            ...(fromDate ? { gte: fromDate } : {}),
            ...(toDate ? { lte: toDate } : {})
          }
        }
      : {})
  });

  const report = await prisma.drillReport.findFirst({
    where,
    include: reportInclude
  });

  if (!report) {
    return NextResponse.json({ message: "Drilling report not found in this scope." }, { status: 404 });
  }

  return NextResponse.json({
    data: report
  });
}

function nullableFilter(value: string | null) {
  return value && value !== "all" ? value : null;
}

function parseDateOrNull(value: string | null, endOfDay = false) {
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
