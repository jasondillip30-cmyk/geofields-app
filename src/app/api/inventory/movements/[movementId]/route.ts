import { NextResponse, type NextRequest } from "next/server";

import { requireApiPermission } from "@/lib/auth/api-guard";
import { deriveInventoryUsageReasonType } from "@/lib/inventory-usage-context";
import { prisma } from "@/lib/prisma";

const movementInclude = {
  item: {
    select: {
      id: true,
      name: true,
      sku: true,
      category: true,
      quantityInStock: true,
      minimumStockLevel: true,
      unitCost: true
    }
  },
  performedBy: { select: { id: true, fullName: true, role: true } },
  client: { select: { id: true, name: true } },
  rig: { select: { id: true, rigCode: true } },
  project: { select: { id: true, name: true } },
  drillReport: { select: { id: true, holeNumber: true, date: true } },
  maintenanceRequest: {
    select: { id: true, requestCode: true, status: true, breakdownReportId: true }
  },
  breakdownReport: {
    select: { id: true, title: true, status: true, severity: true, reportDate: true }
  },
  expense: {
    select: {
      id: true,
      amount: true,
      category: true,
      subcategory: true,
      entrySource: true,
      approvalStatus: true,
      date: true,
      submittedAt: true,
      approvedAt: true,
      client: { select: { id: true, name: true } },
      project: { select: { id: true, name: true } },
      rig: { select: { id: true, rigCode: true } },
      enteredBy: { select: { id: true, fullName: true } }
    }
  },
  supplier: { select: { id: true, name: true } },
  locationFrom: { select: { id: true, name: true } },
  locationTo: { select: { id: true, name: true } }
} as const;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ movementId: string }> }
) {
  const auth = await requireApiPermission(request, "inventory:view");
  if (!auth.ok) {
    return auth.response;
  }

  const { movementId } = await params;
  const movement = await prisma.inventoryMovement.findUnique({
    where: { id: movementId },
    include: movementInclude
  });

  if (!movement) {
    return NextResponse.json({ message: "Stock movement not found." }, { status: 404 });
  }

  const linkedUsageRequestRaw = await prisma.inventoryUsageRequest.findFirst({
    where: { approvedMovementId: movement.id },
    orderBy: [{ decidedAt: "desc" }, { updatedAt: "desc" }],
    select: {
      id: true,
      status: true,
      reason: true,
      drillReportId: true,
      breakdownReportId: true,
      maintenanceRequestId: true,
      requestedForDate: true,
      decidedAt: true,
      createdAt: true,
      requestedBy: { select: { id: true, fullName: true, role: true } },
      decidedBy: { select: { id: true, fullName: true, role: true } },
      maintenanceRequest: {
        select: { id: true, requestCode: true, status: true, breakdownReportId: true }
      },
      breakdownReport: {
        select: { id: true, title: true, status: true, severity: true }
      },
      drillReport: {
        select: {
          id: true,
          holeNumber: true,
          date: true
        }
      }
    }
  });
  const linkedUsageRequest = linkedUsageRequestRaw
    ? serializeLinkedUsageRequest(linkedUsageRequestRaw)
    : null;

  const fallbackBreakdownId =
    movement.breakdownReport?.id ||
    movement.breakdownReportId ||
    linkedUsageRequest?.breakdownReport?.id ||
    linkedUsageRequest?.breakdownReportId ||
    movement.maintenanceRequest?.breakdownReportId ||
    null;
  const linkedBreakdown = movement.breakdownReport
    ? movement.breakdownReport
    : fallbackBreakdownId
      ? await prisma.breakdownReport.findUnique({
          where: { id: fallbackBreakdownId },
          select: { id: true, title: true, status: true, severity: true, reportDate: true }
        })
      : null;

  const relatedFilters: Array<{ receiptUrl?: string; traReceiptNumber?: string; supplierInvoiceNumber?: string }> = [];
  if (movement.receiptUrl) {
    relatedFilters.push({ receiptUrl: movement.receiptUrl });
  }
  if (movement.traReceiptNumber) {
    relatedFilters.push({ traReceiptNumber: movement.traReceiptNumber });
  }
  if (movement.supplierInvoiceNumber) {
    relatedFilters.push({ supplierInvoiceNumber: movement.supplierInvoiceNumber });
  }

  const relatedMovements =
    relatedFilters.length === 0
      ? []
      : await prisma.inventoryMovement.findMany({
          where: {
            id: { not: movement.id },
            OR: relatedFilters
          },
          orderBy: [{ date: "desc" }, { createdAt: "desc" }],
          take: 10,
          include: {
            item: { select: { id: true, name: true, sku: true } },
            expense: { select: { id: true, amount: true, approvalStatus: true } },
            rig: { select: { id: true, rigCode: true } },
            project: { select: { id: true, name: true } }
          }
        });

  return NextResponse.json({
    data: {
      ...movement,
      linkedUsageRequest,
      linkedBreakdown
    },
    relatedMovements
  });
}

function serializeLinkedUsageRequest(
  requestRow: {
    id: string;
    status: string;
    reason: string;
    drillReportId: string | null;
    breakdownReportId: string | null;
    maintenanceRequestId: string | null;
    requestedForDate: Date | null;
    decidedAt: Date | null;
    createdAt: Date;
    requestedBy: { id: string; fullName: string | null; role: string } | null;
    decidedBy: { id: string; fullName: string | null; role: string } | null;
    maintenanceRequest: {
      id: string;
      requestCode: string;
      status: string;
      breakdownReportId: string | null;
    } | null;
    breakdownReport: { id: string; title: string; status: string; severity: string } | null;
    drillReport: { id: string; holeNumber: string; date: Date } | null;
  }
) {
  const fallbackBreakdownId =
    requestRow.breakdownReportId ||
    requestRow.maintenanceRequest?.breakdownReportId ||
    null;
  const reasonType = deriveInventoryUsageReasonType({
    explicitReasonType: null,
    maintenanceRequestId: requestRow.maintenanceRequestId,
    breakdownReportId: fallbackBreakdownId,
    drillReportId: requestRow.drillReportId
  });

  return {
    id: requestRow.id,
    status: requestRow.status,
    reason: requestRow.reason,
    reasonType,
    drillReportId: requestRow.drillReportId,
    breakdownReportId: fallbackBreakdownId,
    maintenanceRequestId: requestRow.maintenanceRequestId,
    requestedForDate: requestRow.requestedForDate,
    decidedAt: requestRow.decidedAt,
    createdAt: requestRow.createdAt,
    requestedBy: requestRow.requestedBy
      ? {
          id: requestRow.requestedBy.id,
          fullName: requestRow.requestedBy.fullName || "Unknown user",
          role: requestRow.requestedBy.role
        }
      : null,
    decidedBy: requestRow.decidedBy
      ? {
          id: requestRow.decidedBy.id,
          fullName: requestRow.decidedBy.fullName || "Unknown user",
          role: requestRow.decidedBy.role
        }
      : null,
    maintenanceRequest: requestRow.maintenanceRequest,
    breakdownReport: requestRow.breakdownReport,
    drillReport: requestRow.drillReport
  };
}
