import { roundCurrency } from "@/lib/inventory-server";
import { prisma } from "@/lib/prisma";

type PoolDb = Pick<typeof prisma, "inventoryUsageRequest" | "inventoryMovement" | "inventoryItem">;

export interface ProjectConsumablesPoolRow {
  itemId: string;
  itemName: string;
  sku: string;
  stockOnHand: number;
  approvedRequestQty: number;
  approvedPurchaseQty: number;
  consumedQty: number;
  poolQty: number;
  availableNow: number;
  unitCost: number;
}

export async function buildProjectConsumablesPool({
  projectId,
  includeZeroAvailable = false,
  excludeDrillReportId = null,
  db = prisma
}: {
  projectId: string;
  includeZeroAvailable?: boolean;
  excludeDrillReportId?: string | null;
  db?: PoolDb;
}) {
  const approvedRequestGroups = await db.inventoryUsageRequest.groupBy({
    by: ["itemId"],
    where: {
      projectId,
      status: "APPROVED",
      OR: [
        { contextType: "DRILLING_REPORT" },
        {
          AND: [{ contextType: "OTHER" }, { drillReportId: { not: null } }]
        }
      ]
    },
    _sum: {
      quantity: true
    }
  });

  const approvedPurchaseGroups = await db.inventoryMovement.groupBy({
    by: ["itemId"],
    where: {
      projectId,
      movementType: "IN"
    },
    _sum: {
      quantity: true
    }
  });

  const consumedGroups = await db.inventoryMovement.groupBy({
    by: ["itemId"],
    where: {
      projectId,
      movementType: "OUT",
      OR: [{ contextType: "DRILLING_REPORT" }, { drillReportId: { not: null } }],
      ...(excludeDrillReportId ? { drillReportId: { not: excludeDrillReportId } } : {})
    },
    _sum: {
      quantity: true
    }
  });

  const itemIds = Array.from(
    new Set([
      ...approvedRequestGroups.map((row) => row.itemId),
      ...approvedPurchaseGroups.map((row) => row.itemId),
      ...consumedGroups.map((row) => row.itemId)
    ])
  );

  if (itemIds.length === 0) {
    return [] as ProjectConsumablesPoolRow[];
  }

  const items = await db.inventoryItem.findMany({
    where: {
      id: {
        in: itemIds
      }
    },
    select: {
      id: true,
      name: true,
      sku: true,
      quantityInStock: true,
      unitCost: true
    }
  });

  const approvedRequestByItem = new Map(
    approvedRequestGroups.map((row) => [row.itemId, roundCurrency(row._sum?.quantity || 0)])
  );
  const approvedPurchaseByItem = new Map(
    approvedPurchaseGroups.map((row) => [row.itemId, roundCurrency(row._sum?.quantity || 0)])
  );
  const consumedByItem = new Map(
    consumedGroups.map((row) => [row.itemId, roundCurrency(row._sum?.quantity || 0)])
  );

  const rows = items
    .map<ProjectConsumablesPoolRow>((item) => {
      const approvedRequestQty = approvedRequestByItem.get(item.id) || 0;
      const approvedPurchaseQty = approvedPurchaseByItem.get(item.id) || 0;
      const consumedQty = consumedByItem.get(item.id) || 0;
      const stockOnHand = Math.max(0, roundCurrency(item.quantityInStock || 0));
      const poolQty = Math.max(0, roundCurrency(approvedRequestQty + approvedPurchaseQty - consumedQty));
      const availableNow = Math.max(0, roundCurrency(Math.min(poolQty, stockOnHand)));

      return {
        itemId: item.id,
        itemName: item.name,
        sku: item.sku,
        stockOnHand,
        approvedRequestQty,
        approvedPurchaseQty,
        consumedQty,
        poolQty,
        availableNow,
        unitCost: Math.max(0, roundCurrency(item.unitCost || 0))
      };
    })
    .sort((left, right) => left.itemName.localeCompare(right.itemName));

  if (includeZeroAvailable) {
    return rows;
  }
  return rows.filter((row) => row.availableNow > 0);
}
