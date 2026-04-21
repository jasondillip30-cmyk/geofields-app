import { NextResponse, type NextRequest } from "next/server";

import { requireApiPermission } from "@/lib/auth/api-guard";
import {
  buildInventoryScopeFilters,
  nullableFilter,
  parseDateOrNull,
  roundCurrency
} from "@/lib/inventory-server";
import { prisma } from "@/lib/prisma";
import { buildProjectConsumablesPool } from "@/lib/project-consumables-pool";

const DAY_MS = 24 * 60 * 60 * 1000;

export async function GET(request: NextRequest) {
  const auth = await requireApiPermission(request, "inventory:view");
  if (!auth.ok) {
    return auth.response;
  }

  const fromDate = parseDateOrNull(request.nextUrl.searchParams.get("from"));
  const toDate = parseDateOrNull(request.nextUrl.searchParams.get("to"), true);
  const projectId = nullableFilter(request.nextUrl.searchParams.get("projectId"));
  const clientId = nullableFilter(request.nextUrl.searchParams.get("clientId"));
  const rigId = nullableFilter(request.nextUrl.searchParams.get("rigId"));

  const movementWhere = buildInventoryScopeFilters({
    fromDate,
    toDate,
    projectId,
    clientId,
    rigId
  });

  const [items, movements, projectConsumablesPool, projectUsageRequestCounts] = await Promise.all([
    prisma.inventoryItem.findMany({
      orderBy: [{ name: "asc" }],
      include: {
        supplier: { select: { id: true, name: true } },
        location: { select: { id: true, name: true } },
        compatibleRig: { select: { id: true, rigCode: true } }
      }
    }),
    prisma.inventoryMovement.findMany({
      where: movementWhere,
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      include: {
        item: { select: { id: true, name: true, sku: true, category: true } },
        rig: { select: { id: true, rigCode: true } },
        project: { select: { id: true, name: true } },
        supplier: { select: { id: true, name: true } },
        expense: { select: { id: true, approvalStatus: true } }
      }
    }),
    projectId
      ? buildProjectConsumablesPool({
          projectId,
          includeZeroAvailable: true
        })
      : Promise.resolve([]),
    projectId
      ? prisma.inventoryUsageRequest.groupBy({
          by: ["status"],
          where: { projectId },
          _count: { status: true }
        })
      : Promise.resolve([])
  ]);

  const approvedPoolRows = projectConsumablesPool.filter(
    (row) => row.approvedRequestQty + row.approvedPurchaseQty > 0
  );
  const requestCountByStatus = new Map(
    projectUsageRequestCounts.map((row) => [row.status, row._count.status || 0])
  );
  const projectLinkedSummary = projectId
    ? {
        approvedItems: approvedPoolRows.length,
        approvedQuantity: roundCurrency(
          approvedPoolRows.reduce((sum, row) => sum + row.approvedRequestQty + row.approvedPurchaseQty, 0)
        ),
        availableApprovedQuantity: roundCurrency(
          approvedPoolRows.reduce((sum, row) => sum + row.availableNow, 0)
        ),
        availableApprovedValue: roundCurrency(
          approvedPoolRows.reduce((sum, row) => sum + row.availableNow * row.unitCost, 0)
        ),
        usedQuantity: roundCurrency(
          approvedPoolRows.reduce((sum, row) => sum + row.consumedQty, 0)
        ),
        usedValue: roundCurrency(
          approvedPoolRows.reduce((sum, row) => sum + row.consumedQty * row.unitCost, 0)
        ),
        projectLinkedIn: roundCurrency(
          movements.reduce(
            (sum, movement) => sum + (movement.movementType === "IN" ? movement.quantity : 0),
            0
          )
        ),
        projectLinkedOut: roundCurrency(
          movements.reduce(
            (sum, movement) => sum + (movement.movementType === "OUT" ? movement.quantity : 0),
            0
          )
        ),
        recognizedInventoryCost: roundCurrency(
          movements.reduce((sum, movement) => {
            if (movement.movementType !== "OUT") {
              return sum;
            }
            if (String(movement.expense?.approvalStatus || "").toUpperCase() !== "APPROVED") {
              return sum;
            }
            return sum + (movement.totalCost || 0);
          }, 0)
        ),
        requestContext: {
          total: projectUsageRequestCounts.reduce(
            (sum, row) => sum + (row._count.status || 0),
            0
          ),
          submitted: requestCountByStatus.get("SUBMITTED") || 0,
          pending: requestCountByStatus.get("PENDING") || 0,
          approved: requestCountByStatus.get("APPROVED") || 0,
          rejected: requestCountByStatus.get("REJECTED") || 0
        }
      }
    : null;

  const totalItems = items.length;
  const totalUnitsInStock = roundCurrency(items.reduce((sum, item) => sum + item.quantityInStock, 0));
  const totalInventoryValue = roundCurrency(items.reduce((sum, item) => sum + item.quantityInStock * item.unitCost, 0));
  const inventoryValueByCategoryMap = new Map<string, number>();
  for (const item of items) {
    const categoryValue = item.quantityInStock * item.unitCost;
    inventoryValueByCategoryMap.set(
      item.category,
      (inventoryValueByCategoryMap.get(item.category) || 0) + categoryValue
    );
  }
  const lowStockItems = items
    .filter((item) => item.quantityInStock > 0 && item.quantityInStock <= item.minimumStockLevel)
    .map((item) => ({
      id: item.id,
      name: item.name,
      sku: item.sku,
      quantityInStock: item.quantityInStock,
      minimumStockLevel: item.minimumStockLevel,
      category: item.category
    }));
  const outOfStockItems = items
    .filter((item) => item.quantityInStock <= 0)
    .map((item) => ({
      id: item.id,
      name: item.name,
      sku: item.sku,
      minimumStockLevel: item.minimumStockLevel,
      category: item.category
    }));

  const usageByItem = new Map<string, { id: string; name: string; quantity: number; totalCost: number }>();
  const usageByRig = new Map<string, { id: string; name: string; totalCost: number; quantity: number }>();
  const usageByProject = new Map<string, { id: string; name: string; totalCost: number; quantity: number }>();
  const costByCategory = new Map<string, number>();
  const movementTrendMap = new Map<string, { date: string; inQty: number; outQty: number; adjustmentQty: number; transferQty: number }>();
  const monthlyConsumptionMap = new Map<string, { month: string; quantity: number; cost: number }>();
  const recentUsed = new Map<string, { id: string; name: string; date: Date; quantity: number }>();
  const recentPurchased = new Map<string, { id: string; name: string; date: Date; quantity: number; supplier: string | null }>();

  for (const movement of movements) {
    const dayKey = movement.date.toISOString().slice(0, 10);
    const trend = movementTrendMap.get(dayKey) || {
      date: dayKey,
      inQty: 0,
      outQty: 0,
      adjustmentQty: 0,
      transferQty: 0
    };
    if (movement.movementType === "IN") {
      trend.inQty += movement.quantity;
      if (!recentPurchased.has(movement.itemId)) {
        recentPurchased.set(movement.itemId, {
          id: movement.itemId,
          name: movement.item.name,
          date: movement.date,
          quantity: movement.quantity,
          supplier: movement.supplier?.name || null
        });
      }
    } else if (movement.movementType === "OUT") {
      trend.outQty += movement.quantity;
      if (!recentUsed.has(movement.itemId)) {
        recentUsed.set(movement.itemId, {
          id: movement.itemId,
          name: movement.item.name,
          date: movement.date,
          quantity: movement.quantity
        });
      }

      const usageRow = usageByItem.get(movement.itemId) || {
        id: movement.itemId,
        name: movement.item.name,
        quantity: 0,
        totalCost: 0
      };
      usageRow.quantity += movement.quantity;
      usageRow.totalCost += movement.totalCost || 0;
      usageByItem.set(movement.itemId, usageRow);

      const monthKey = `${movement.date.getUTCFullYear()}-${String(movement.date.getUTCMonth() + 1).padStart(2, "0")}`;
      const monthly = monthlyConsumptionMap.get(monthKey) || { month: monthKey, quantity: 0, cost: 0 };
      monthly.quantity += movement.quantity;
      monthly.cost += movement.totalCost || 0;
      monthlyConsumptionMap.set(monthKey, monthly);

      if (movement.rigId && movement.rig) {
        const rigRow = usageByRig.get(movement.rigId) || {
          id: movement.rigId,
          name: movement.rig.rigCode,
          totalCost: 0,
          quantity: 0
        };
        rigRow.totalCost += movement.totalCost || 0;
        rigRow.quantity += movement.quantity;
        usageByRig.set(movement.rigId, rigRow);
      }

      if (movement.projectId && movement.project) {
        const projectRow = usageByProject.get(movement.projectId) || {
          id: movement.projectId,
          name: movement.project.name,
          totalCost: 0,
          quantity: 0
        };
        projectRow.totalCost += movement.totalCost || 0;
        projectRow.quantity += movement.quantity;
        usageByProject.set(movement.projectId, projectRow);
      }

      costByCategory.set(movement.item.category, (costByCategory.get(movement.item.category) || 0) + (movement.totalCost || 0));
    } else if (movement.movementType === "ADJUSTMENT") {
      trend.adjustmentQty += movement.quantity;
    } else {
      trend.transferQty += movement.quantity;
    }
    movementTrendMap.set(dayKey, trend);
  }

  const today = new Date();
  const ninetyDaysAgo = new Date(today.getTime() - 90 * DAY_MS);
  const sixtyDaysAgo = new Date(today.getTime() - 60 * DAY_MS);
  const lastUsageDateByItem = new Map<string, Date>();
  for (const movement of movements) {
    if (movement.movementType !== "OUT") {
      continue;
    }
    if (!lastUsageDateByItem.has(movement.itemId)) {
      lastUsageDateByItem.set(movement.itemId, movement.date);
    }
  }

  const deadStockItems = items
    .filter((item) => item.quantityInStock > 0)
    .filter((item) => {
      const lastUsage = lastUsageDateByItem.get(item.id);
      return !lastUsage || lastUsage.getTime() < ninetyDaysAgo.getTime();
    })
    .map((item) => ({
      id: item.id,
      name: item.name,
      sku: item.sku,
      quantityInStock: item.quantityInStock,
      inventoryValue: roundCurrency(item.quantityInStock * item.unitCost),
      lastUsedAt: lastUsageDateByItem.get(item.id) || null
    }))
    .sort((a, b) => b.inventoryValue - a.inventoryValue);

  const recommendations: string[] = [];
  if (lowStockItems.length > 0) {
    recommendations.push(`${lowStockItems.length} item(s) are below minimum stock.`);
  }
  if (outOfStockItems.length > 0) {
    recommendations.push(`${outOfStockItems.length} critical item(s) are out of stock.`);
  }

  const highestCostCategory = Array.from(costByCategory.entries())
    .map(([category, cost]) => ({ category, cost: roundCurrency(cost) }))
    .sort((a, b) => b.cost - a.cost)[0];
  if (highestCostCategory) {
    recommendations.push(`Highest inventory spend category: ${highestCostCategory.category}.`);
  }

  const highUsageRig = Array.from(usageByRig.values())
    .sort((a, b) => b.totalCost - a.totalCost)[0];
  if (highUsageRig) {
    recommendations.push(`${highUsageRig.name} has the highest inventory consumption cost in current scope.`);
  }

  const atRiskFilters = Array.from(lastUsageDateByItem.entries())
    .filter(([, date]) => date.getTime() >= sixtyDaysAgo.getTime())
    .length;
  if (atRiskFilters === 0 && movements.length > 0) {
    recommendations.push("Usage activity is stale in this scope. Review movement logging completeness.");
  }

  return NextResponse.json({
    filters: {
      from: request.nextUrl.searchParams.get("from"),
      to: request.nextUrl.searchParams.get("to"),
      projectId: projectId || "all",
      clientId: clientId || "all",
      rigId: rigId || "all"
    },
    projectLinked: projectLinkedSummary,
    overview: {
      totalItems,
      totalUnitsInStock,
      totalInventoryValue,
      lowStockCount: lowStockItems.length,
      outOfStockCount: outOfStockItems.length,
      recentlyUsedItems: Array.from(recentUsed.values()).slice(0, 8),
      recentlyPurchasedItems: Array.from(recentPurchased.values()).slice(0, 8)
    },
    lowStockItems: lowStockItems.slice(0, 20),
    outOfStockItems: outOfStockItems.slice(0, 20),
    analytics: {
      topUsedItems: Array.from(usageByItem.values())
        .sort((a, b) => b.quantity - a.quantity)
        .slice(0, 10)
        .map((row) => ({
          ...row,
          totalCost: roundCurrency(row.totalCost)
        })),
      leastUsedItems: Array.from(usageByItem.values())
        .sort((a, b) => a.quantity - b.quantity)
        .slice(0, 10)
        .map((row) => ({
          ...row,
          totalCost: roundCurrency(row.totalCost)
        })),
      deadStockItems: deadStockItems.slice(0, 15),
      inventoryValueByCategory: Array.from(inventoryValueByCategoryMap.entries())
        .map(([category, value]) => ({
          category,
          label: formatInventoryCategoryLabel(category),
          value: roundCurrency(value),
          percent:
            totalInventoryValue > 0
              ? roundCurrency((value / totalInventoryValue) * 100)
              : 0
        }))
        .sort((a, b) => b.value - a.value),
      highestCostCategories: Array.from(costByCategory.entries())
        .map(([category, cost]) => ({
          category,
          cost: roundCurrency(cost),
          percentOfTotal:
            costByCategory.size > 0
              ? roundCurrency((cost / Array.from(costByCategory.values()).reduce((sum, value) => sum + value, 0)) * 100)
              : 0
        }))
        .sort((a, b) => b.cost - a.cost),
      monthlyConsumption: Array.from(monthlyConsumptionMap.values())
        .sort((a, b) => a.month.localeCompare(b.month))
        .map((entry) => ({
          month: entry.month,
          quantity: roundCurrency(entry.quantity),
          cost: roundCurrency(entry.cost)
        })),
      movementTrend: Array.from(movementTrendMap.values())
        .sort((a, b) => a.date.localeCompare(b.date))
        .map((entry) => ({
          date: entry.date,
          inQty: roundCurrency(entry.inQty),
          outQty: roundCurrency(entry.outQty),
          adjustmentQty: roundCurrency(entry.adjustmentQty),
          transferQty: roundCurrency(entry.transferQty)
        })),
      inventoryCostByRig: Array.from(usageByRig.values())
        .sort((a, b) => b.totalCost - a.totalCost)
        .map((row) => ({
          ...row,
          totalCost: roundCurrency(row.totalCost),
          quantity: roundCurrency(row.quantity)
        })),
      inventoryCostByProject: Array.from(usageByProject.values())
        .sort((a, b) => b.totalCost - a.totalCost)
        .map((row) => ({
          ...row,
          totalCost: roundCurrency(row.totalCost),
          quantity: roundCurrency(row.quantity)
        })),
      recommendations: recommendations.slice(0, 5)
    }
  });
}

function formatInventoryCategoryLabel(value: string) {
  return value
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/(^|\s)\w/g, (char) => char.toUpperCase());
}
