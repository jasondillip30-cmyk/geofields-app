import type { Prisma } from "@prisma/client";

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

export async function replaceDrillReportConsumablesUsage({
  tx,
  drillReportId,
  projectId,
  rigId,
  clientId,
  reportDate,
  actorUserId,
  lines,
  resetExisting
}: {
  tx: Prisma.TransactionClient;
  drillReportId: string;
  projectId: string;
  rigId: string;
  clientId: string | null;
  reportDate: Date;
  actorUserId: string;
  lines: DrillReportConsumableInput[];
  resetExisting: boolean;
}) {
  if (resetExisting) {
    await restoreExistingDrillingConsumableUsage(tx, drillReportId);
  }

  if (lines.length === 0) {
    return;
  }

  const poolRows = await buildProjectConsumablesPool({
    db: tx,
    projectId,
    includeZeroAvailable: true,
    excludeDrillReportId: drillReportId
  });
  const poolByItemId = new Map(poolRows.map((row) => [row.itemId, row]));

  for (const line of lines) {
    const pool = poolByItemId.get(line.itemId);
    if (!pool || pool.availableNow <= 0) {
      throw new DrillReportConsumablesValidationError(
        "This item is not approved and available for this project."
      );
    }
    if (line.quantity > pool.availableNow) {
      throw new DrillReportConsumablesValidationError(
        `Cannot use more than available for ${pool.itemName}. Requested ${formatNumber(
          line.quantity
        )}, available ${formatNumber(pool.availableNow)}.`
      );
    }
  }

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
        approvedById: actorUserId,
        approvalStatus: "APPROVED",
        approvedAt: reportDate,
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
        performedByUserId: actorUserId,
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

async function restoreExistingDrillingConsumableUsage(
  tx: Prisma.TransactionClient,
  drillReportId: string
) {
  const existingMovements = await tx.inventoryMovement.findMany({
    where: {
      drillReportId,
      movementType: "OUT",
      contextType: "DRILLING_REPORT"
    },
    select: {
      id: true,
      itemId: true,
      quantity: true,
      expenseId: true
    }
  });

  if (existingMovements.length === 0) {
    return;
  }

  for (const movement of existingMovements) {
    await tx.inventoryItem.update({
      where: { id: movement.itemId },
      data: {
        quantityInStock: {
          increment: movement.quantity
        }
      }
    });
  }

  const movementIds = existingMovements.map((movement) => movement.id);
  await tx.inventoryMovement.deleteMany({
    where: {
      id: {
        in: movementIds
      }
    }
  });

  const expenseIds = Array.from(
    new Set(
      existingMovements
        .map((movement) => movement.expenseId)
        .filter((expenseId): expenseId is string => Boolean(expenseId))
    )
  );
  if (expenseIds.length === 0) {
    return;
  }

  const stillReferenced = await tx.inventoryMovement.findMany({
    where: {
      expenseId: {
        in: expenseIds
      }
    },
    select: { expenseId: true }
  });
  const stillReferencedIds = new Set(
    stillReferenced
      .map((entry) => entry.expenseId)
      .filter((expenseId): expenseId is string => Boolean(expenseId))
  );
  const deletableExpenseIds = expenseIds.filter((expenseId) => !stillReferencedIds.has(expenseId));
  if (deletableExpenseIds.length === 0) {
    return;
  }

  await tx.expense.deleteMany({
    where: {
      id: {
        in: deletableExpenseIds
      },
      entrySource: "INVENTORY_USAGE"
    }
  });
}

function formatNumber(value: number) {
  return Number(value).toLocaleString(undefined, {
    maximumFractionDigits: 2
  });
}
