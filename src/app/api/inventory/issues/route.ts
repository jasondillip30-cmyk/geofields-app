import type { InventoryCategory, Prisma } from "@prisma/client";
import { NextResponse, type NextRequest } from "next/server";

import { requireApiPermission } from "@/lib/auth/api-guard";
import { buildLearningContextFromAuditLogs, detectInventoryIssues, formatCategoryLabel } from "@/lib/inventory-intelligence";
import { buildDateFilter, nullableFilter, parseDateOrNull, roundCurrency } from "@/lib/inventory-server";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  const auth = await requireApiPermission(request, "inventory:view");
  if (!auth.ok) {
    return auth.response;
  }

  const fromDate = parseDateOrNull(request.nextUrl.searchParams.get("from"));
  const toDate = parseDateOrNull(request.nextUrl.searchParams.get("to"), true);
  const clientId = nullableFilter(request.nextUrl.searchParams.get("clientId"));
  const rigId = nullableFilter(request.nextUrl.searchParams.get("rigId"));

  const movementWhere: Prisma.InventoryMovementWhereInput = {
    ...(clientId ? { clientId } : {}),
    ...(rigId ? { rigId } : {}),
    ...(buildDateFilter(fromDate, toDate) ? { date: buildDateFilter(fromDate, toDate) } : {})
  };

  const scopedMovements = await prisma.inventoryMovement.findMany({
    where: movementWhere,
    select: {
      id: true,
      itemId: true,
      movementType: true,
      quantity: true,
      unitCost: true,
      date: true
    }
  });

  const hasScopeFilters = Boolean(clientId || rigId || fromDate || toDate);
  const scopedItemIds = Array.from(new Set(scopedMovements.map((movement) => movement.itemId)));

  const [items, suppliers, learningLogs, maintenanceRequests] = await Promise.all([
    prisma.inventoryItem.findMany({
      where: hasScopeFilters
        ? {
            id: { in: scopedItemIds.length > 0 ? scopedItemIds : ["__none__"] }
          }
        : undefined,
      select: {
        id: true,
        name: true,
        sku: true,
        category: true,
        description: true,
        quantityInStock: true,
        minimumStockLevel: true,
        unitCost: true,
        status: true,
        supplierId: true,
        createdAt: true
      }
    }),
    prisma.inventorySupplier.findMany({
      select: {
        id: true,
        name: true
      }
    }),
    prisma.auditLog.findMany({
      where: {
        module: "inventory",
        entityType: "inventory_item",
        action: { in: ["edit", "merge"] }
      },
      orderBy: { createdAt: "desc" },
      take: 400,
      select: {
        action: true,
        beforeValueJson: true,
        afterValueJson: true
      }
    }),
    prisma.maintenanceRequest.findMany({
      where: {
        ...(clientId ? { clientId } : {}),
        ...(rigId ? { rigId } : {}),
        ...(buildDateFilter(fromDate, toDate) ? { requestDate: buildDateFilter(fromDate, toDate) } : {}),
        status: { in: ["IN_REPAIR", "COMPLETED"] }
      },
      select: {
        id: true,
        requestCode: true,
        status: true
      }
    })
  ]);
  const suppliersById = new Map(suppliers.map((supplier) => [supplier.id, supplier]));
  const learningContext = buildLearningContextFromAuditLogs(learningLogs);

  const baseIssues = detectInventoryIssues({
    items,
    movements: scopedMovements,
    suppliersById,
    learningContext
  });
  const maintenanceMovementCount = new Map<string, number>();
  const maintenanceLinkedMovementRows = await prisma.inventoryMovement.findMany({
    where: {
      maintenanceRequestId: {
        in: maintenanceRequests.map((entry) => entry.id)
      }
    },
    select: {
      maintenanceRequestId: true
    }
  });
  for (const movement of maintenanceLinkedMovementRows) {
    if (!movement.maintenanceRequestId) {
      continue;
    }
    maintenanceMovementCount.set(
      movement.maintenanceRequestId,
      (maintenanceMovementCount.get(movement.maintenanceRequestId) || 0) + 1
    );
  }
  const maintenanceLinkIssues = maintenanceRequests
    .filter((request) => (maintenanceMovementCount.get(request.id) || 0) === 0)
    .map((request) => ({
      id: `maintenance-link-${request.id}`,
      type: "STOCK_ANOMALY" as const,
      severity: "HIGH" as const,
      title: "Maintenance request missing inventory linkage",
      message: `${request.requestCode} (${request.status}) has no linked inventory movement.`,
      suggestion: "Link parts usage to maintenance requests to keep cost and stock tracking accurate.",
      itemIds: [],
      confidence: "HIGH" as const
    }));
  const issues = [...baseIssues, ...maintenanceLinkIssues];

  const summary = {
    total: issues.length,
    high: issues.filter((entry) => entry.severity === "HIGH").length,
    medium: issues.filter((entry) => entry.severity === "MEDIUM").length,
    low: issues.filter((entry) => entry.severity === "LOW").length
  };

  const categoryStats = items.reduce<Record<InventoryCategory, { category: InventoryCategory; itemCount: number; totalValue: number }>>(
    (acc, item) => {
      const key = item.category;
      const current = acc[key] || {
        category: key,
        itemCount: 0,
        totalValue: 0
      };
      current.itemCount += 1;
      current.totalValue += item.quantityInStock * item.unitCost;
      acc[key] = current;
      return acc;
    },
    {} as Record<InventoryCategory, { category: InventoryCategory; itemCount: number; totalValue: number }>
  );

  const categorySummary = Object.values(categoryStats)
    .map((entry) => ({
      category: entry.category,
      label: formatCategoryLabel(entry.category),
      itemCount: entry.itemCount,
      totalValue: roundCurrency(entry.totalValue)
    }))
    .sort((a, b) => b.itemCount - a.itemCount);

  return NextResponse.json({
    filters: {
      from: request.nextUrl.searchParams.get("from"),
      to: request.nextUrl.searchParams.get("to"),
      clientId: clientId || "all",
      rigId: rigId || "all"
    },
    summary,
    categorySummary,
    issues
  });
}
