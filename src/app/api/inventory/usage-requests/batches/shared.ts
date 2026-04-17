import { Prisma } from "@prisma/client";

import { deriveInventoryUsageReasonType } from "@/lib/inventory-usage-context";
import { roundCurrency } from "@/lib/inventory-server";

export const usageRequestBatchInclude =
  Prisma.validator<Prisma.InventoryUsageRequestBatchInclude>()({
  project: { select: { id: true, name: true, clientId: true } },
  rig: { select: { id: true, rigCode: true } },
  location: { select: { id: true, name: true } },
  maintenanceRequest: {
    select: {
      id: true,
      requestCode: true,
      status: true,
      breakdownReportId: true
    }
  },
  breakdownReport: {
    select: {
      id: true,
      title: true,
      status: true,
      severity: true
    }
  },
  requestedBy: { select: { id: true, fullName: true, role: true } },
  decidedBy: { select: { id: true, fullName: true, role: true } },
  lines: {
    include: {
      item: {
        select: {
          id: true,
          name: true,
          sku: true,
          status: true,
          unitCost: true,
          quantityInStock: true,
          locationId: true
        }
      }
    },
    orderBy: { createdAt: "asc" }
  }
});

export type UsageRequestBatchWithRelations = Prisma.InventoryUsageRequestBatchGetPayload<{
  include: typeof usageRequestBatchInclude;
}>;

export type UsageRequestBatchLineWithItem = UsageRequestBatchWithRelations["lines"][number];

export function serializeUsageRequestBatchForClient(row: UsageRequestBatchWithRelations) {
  const reasonType = deriveInventoryUsageReasonType({
    explicitReasonType: row.contextType,
    maintenanceRequestId: row.maintenanceRequestId,
    breakdownReportId:
      row.breakdownReportId || row.maintenanceRequest?.breakdownReportId || null,
    drillReportId: row.drillReportId
  });
  const summary = row.lines.reduce(
    (acc, line) => {
      const normalizedQuantity = roundCurrency(line.quantity);
      acc.totalQuantity = roundCurrency(acc.totalQuantity + normalizedQuantity);
      if (line.status === "APPROVED") {
        acc.approved += 1;
      } else if (line.status === "REJECTED") {
        acc.rejected += 1;
      } else {
        acc.submitted += 1;
      }
      return acc;
    },
    {
      lineCount: row.lines.length,
      approved: 0,
      rejected: 0,
      submitted: 0,
      totalQuantity: 0
    }
  );

  return {
    id: row.id,
    batchCode: `BATCH-${row.id.slice(-6).toUpperCase()}`,
    contextType: row.contextType,
    reasonType,
    reason: row.reason || "",
    status: row.status,
    requestedForDate: row.requestedForDate,
    createdAt: row.createdAt,
    decidedAt: row.decidedAt,
    projectId: row.projectId,
    rigId: row.rigId,
    maintenanceRequestId: row.maintenanceRequestId,
    breakdownReportId:
      row.breakdownReportId || row.maintenanceRequest?.breakdownReportId || null,
    locationId: row.locationId,
    project: row.project,
    rig: row.rig,
    location: row.location,
    maintenanceRequest: row.maintenanceRequest,
    breakdownReport: row.breakdownReport,
    requestedBy: row.requestedBy,
    decidedBy: row.decidedBy,
    summary,
    lines: row.lines.map((line) => ({
      id: line.id,
      quantity: roundCurrency(line.quantity),
      status: line.status,
      decisionNote: line.decisionNote,
      approvedMovementId: line.approvedMovementId,
      item: line.item
        ? {
            id: line.item.id,
            name: line.item.name,
            sku: line.item.sku,
            status: line.item.status,
            unitCost: line.item.unitCost,
            quantityInStock: line.item.quantityInStock
          }
        : null
    }))
  };
}

export type UsageRequestBatchStatusFilter =
  | "ALL"
  | "SUBMITTED"
  | "PENDING"
  | "APPROVED"
  | "REJECTED"
  | "PARTIALLY_APPROVED"
  | "DEFAULT";

export function parseUsageRequestBatchStatusFilter(
  rawStatus: string | null
): UsageRequestBatchStatusFilter {
  const normalized = (rawStatus || "").trim().toUpperCase();
  if (!normalized) {
    return "DEFAULT";
  }
  if (
    normalized === "ALL" ||
    normalized === "SUBMITTED" ||
    normalized === "PENDING" ||
    normalized === "APPROVED" ||
    normalized === "REJECTED" ||
    normalized === "PARTIALLY_APPROVED"
  ) {
    return normalized;
  }
  return "DEFAULT";
}

export function buildUsageBatchStatusWhere(
  statusFilter: UsageRequestBatchStatusFilter,
  mineOnly: boolean
): Prisma.InventoryUsageRequestBatchWhereInput {
  if (statusFilter === "ALL") {
    return {};
  }
  if (
    statusFilter === "SUBMITTED" ||
    statusFilter === "PENDING" ||
    statusFilter === "APPROVED" ||
    statusFilter === "REJECTED" ||
    statusFilter === "PARTIALLY_APPROVED"
  ) {
    return { status: statusFilter };
  }
  if (!mineOnly) {
    return { status: { in: ["SUBMITTED", "PENDING"] } };
  }
  return {};
}
