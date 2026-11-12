import { Prisma } from "@prisma/client";

import { roundCurrency } from "@/lib/inventory-server";
import { buildProjectConsumablesPool } from "@/lib/project-consumables-pool";

export interface DrillReportConsumableInput {
  itemId: string;
  quantity: number;
}

export class DrillReportConsumablesValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DrillReportConsumablesValidationError";
  }
}

export function parseDrillReportConsumablesUsedInput(value: unknown): {
  lines: DrillReportConsumableInput[];
  error: string | null;
} {
  if (typeof value === "undefined") {
    return { lines: [], error: null };
  }
  if (!Array.isArray(value)) {
    return { lines: [], error: "Consumables must be provided as a list of items used." };
  }
  const lines: DrillReportConsumableInput[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (!entry || typeof entry !== "object") {
      return { lines: [], error: "Each consumable entry must include an item and quantity." };
    }
    const record = entry as Record<string, unknown>;
    const itemId = typeof record.itemId === "string" ? record.itemId.trim() : "";
    if (!itemId) {
      return { lines: [], error: "Select a valid consumable item before saving." };
    }
    if (seen.has(itemId)) {
      return { lines: [], error: "Each consumable item can only be added once per report." };
    }
    seen.add(itemId);
    const quantity = Number(record.quantity ?? 0);
    if (!Number.isFinite(quantity) || quantity < 0) {
      return { lines: [], error: "Consumable quantity must be zero or greater." };
    }
    const normalizedQuantity = roundCurrency(quantity);
    if (normalizedQuantity <= 0) {
      continue;
    }
    lines.push({
      itemId,
      quantity: normalizedQuantity
    });
  }
  return {
    lines,
    error: null
  };
}

export async function validateDrillReportConsumables(
  tx: Prisma.TransactionClient,
  projectId: string,
  lines: DrillReportConsumableInput[]
) {
  if (!lines.length) return new Map<string, Awaited<ReturnType<typeof buildProjectConsumablesPool>>[number]>();
  const rows = await buildProjectConsumablesPool({ db: tx, projectId, includeZeroAvailable: true });
  const poolByItemId = new Map(rows.map((row) => [row.itemId, row]));
  for (const line of lines) {
    const pool = poolByItemId.get(line.itemId);
    if (!pool || pool.availableNow <= 0) {
      throw new DrillReportConsumablesValidationError("This item is not approved and available for this project.");
    }
    if (line.quantity > pool.availableNow) {
      throw new DrillReportConsumablesValidationError(
        `Cannot use more than available for ${pool.itemName}. Requested ${formatNumber(line.quantity)}, available ${formatNumber(pool.availableNow)}.`
      );
    }
  }
  return poolByItemId;
}

export async function stageDrillReportConsumables(
  tx: Prisma.TransactionClient,
  projectId: string,
  lines: DrillReportConsumableInput[]
) {
  const poolByItemId = await validateDrillReportConsumables(tx, projectId, lines);
  return lines.map((line) => ({
    ...line,
    itemName: poolByItemId.get(line.itemId)?.itemName || "Item",
    sku: poolByItemId.get(line.itemId)?.sku || ""
  }));
}

export async function postDrillReportConsumablesUsage({
  tx,
  drillReportId,
  projectId,
  rigId,
  clientId,
  reportDate,
  actorUserId,
  approverUserId,
  lines
}: {
  tx: Prisma.TransactionClient;
  drillReportId: string;
  projectId: string;
  rigId: string;
  clientId: string | null;
  reportDate: Date;
  actorUserId: string;
  approverUserId: string;
  lines: DrillReportConsumableInput[];
}) {
  if (lines.length === 0) {
    return;
  }

  // Serialize approvals that draw from the same stock before rechecking availability.
  await tx.$queryRaw`SELECT id FROM "InventoryItem"
    WHERE id IN (${Prisma.join(lines.map((line) => line.itemId))})
    ORDER BY id FOR UPDATE`;
  const poolByItemId = await validateDrillReportConsumables(tx, projectId, lines);

  for (const line of lines) {
    const pool = poolByItemId.get(line.itemId);
    if (!pool) {
      throw new DrillReportConsumablesValidationError(
        "This item is not approved and available for this project."
      );
    }

    const unitCost = pool.unitCost;
    const totalCost = roundCurrency(line.quantity * unitCost);
    const expense = await tx.expense.create({
      data: {
        date: reportDate,
        amount: totalCost,
        category: "Inventory Usage",
        subcategory: pool.itemName,
        entrySource: "INVENTORY_USAGE",
        vendor: null,
        notes: `Consumables used on drilling report ${drillReportId}.`,
        enteredByUserId: actorUserId,
        submittedAt: reportDate,
        approvedById: approverUserId,
        approvalStatus: "APPROVED",
        approvedAt: new Date(),
        clientId,
        projectId,
        rigId,
        quantity: line.quantity,
        unitCost
      },
      select: { id: true }
    });

    const stockUpdate = await tx.inventoryItem.updateMany({
      where: {
        id: line.itemId,
        quantityInStock: {
          gte: line.quantity
        }
      },
      data: {
        quantityInStock: {
          decrement: line.quantity
        }
      }
    });
    if (stockUpdate.count === 0) {
      throw new DrillReportConsumablesValidationError(
        `Not enough stock to use ${pool.itemName}. Refresh and try again.`
      );
    }

    await tx.inventoryMovement.create({
      data: {
        itemId: line.itemId,
        movementType: "OUT",
        contextType: "DRILLING_REPORT",
        quantity: line.quantity,
        unitCost,
        totalCost,
        date: reportDate,
        performedByUserId: approverUserId,
        clientId,
        projectId,
        rigId,
        drillReportId,
        expenseId: expense.id,
        notes: `Consumables used on drilling report ${drillReportId}.`
      }
    });
  }
}

export function hasPostedDrillReportConsumables(tx: Prisma.TransactionClient, drillReportId: string) {
  return tx.inventoryMovement.findFirst({
    where: {
      drillReportId,
      movementType: "OUT",
      notes: `Consumables used on drilling report ${drillReportId}.`
    },
    select: { id: true }
  });
}

function formatNumber(value: number) {
  return Number(value).toLocaleString(undefined, {
    maximumFractionDigits: 2
  });
}
