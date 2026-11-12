import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";

import { recordAuditLog, auditActorFromSession } from "@/lib/audit";
import { roundCurrency } from "@/lib/inventory-server";
import { prisma } from "@/lib/prisma";

class StockCorrectionError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export async function postStockCorrection(
  input: { itemId: string; quantity: number } | { reversalOfId: string },
  reasonInput: unknown,
  session: Parameters<typeof auditActorFromSession>[0]
) {
  const reason = typeof reasonInput === "string" ? reasonInput.trim() : "";
  if (!reason || reason.length > 1000) {
    return NextResponse.json({ message: "Enter a correction reason (1 to 1,000 characters)." }, { status: 400 });
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const original = "reversalOfId" in input
        ? await tx.inventoryMovement.findUnique({
            where: { id: input.reversalOfId },
            select: { id: true, itemId: true, movementType: true, quantity: true, reversalOfId: true }
          })
        : null;
      if (original && (original.movementType === "TRANSFER" || original.reversalOfId)) {
        throw new StockCorrectionError("Transfers and reversals cannot be reversed here.", 409);
      }
      const itemId = original?.itemId ?? ("itemId" in input ? input.itemId : null);
      if (!itemId) throw new StockCorrectionError("Stock movement not found.", 404);
      const quantity = roundCurrency("quantity" in input
        ? input.quantity
        : (original?.movementType === "OUT" ? 1 : -1) * (original?.quantity ?? 0));
      if (!Number.isFinite(quantity) || quantity === 0) {
        throw new StockCorrectionError("Enter a non-zero stock change to two decimal places.", 400);
      }

      // Serialize corrections on the stock row so the audit records the actual before and after.
      const [item] = await tx.$queryRaw<Array<{ name: string; quantityInStock: number }>>`
        SELECT name, "quantityInStock" FROM "InventoryItem" WHERE id = ${itemId} FOR UPDATE`;
      if (!item) throw new StockCorrectionError("Inventory item not found.", 404);
      if (original && await tx.inventoryMovement.findUnique({ where: { reversalOfId: original.id }, select: { id: true } })) {
        throw new StockCorrectionError("This movement already has a reversal.", 409);
      }
      const nextStock = roundCurrency(item.quantityInStock + quantity);
      if (!Number.isFinite(nextStock) || nextStock < 0) {
        throw new StockCorrectionError("This correction would make stock negative.", 409);
      }

      const movement = await tx.inventoryMovement.create({
        data: {
          itemId,
          movementType: "ADJUSTMENT",
          quantity,
          date: new Date(),
          notes: reason,
          reversalOfId: original?.id,
          performedByUserId: session.userId
        }
      });
      await tx.inventoryItem.update({ where: { id: itemId }, data: { quantityInStock: nextStock } });
      await recordAuditLog({
        db: tx,
        module: "inventory",
        entityType: "inventory_movement",
        entityId: movement.id,
        action: original ? "reverse" : "adjust",
        description: `${original ? "Reversed a stock movement" : "Adjusted stock"} for ${item.name}: ${reason}`,
        before: { quantityInStock: item.quantityInStock },
        after: { quantityInStock: nextStock, quantity, reason, reversalOfId: original?.id ?? null },
        actor: auditActorFromSession(session)
      });
      return { data: movement, meta: { previousStock: item.quantityInStock, nextStock } };
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof StockCorrectionError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json({ message: "This movement already has a reversal." }, { status: 409 });
    }
    throw error;
  }
}
