import { NextResponse, type NextRequest } from "next/server";

import { requireApiPermission } from "@/lib/auth/api-guard";
import { auditActorFromSession, recordAuditLog } from "@/lib/audit";
import { roundCurrency } from "@/lib/inventory-server";
import { prisma } from "@/lib/prisma";

export async function POST(request: NextRequest) {
  const auth = await requireApiPermission(request, "inventory:manage");
  if (!auth.ok) {
    return auth.response;
  }

  const body = await request.json().catch(() => null);
  const primaryItemId = typeof body?.primaryItemId === "string" ? body.primaryItemId.trim() : "";
  const rawDuplicateItemIds: unknown[] = Array.isArray(body?.duplicateItemIds) ? (body.duplicateItemIds as unknown[]) : [];
  const duplicateItemIds: string[] = rawDuplicateItemIds
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  const uniqueDuplicateIds: string[] = Array.from(new Set<string>(duplicateItemIds)).filter((id) => id !== primaryItemId);
  if (!primaryItemId || uniqueDuplicateIds.length === 0) {
    return NextResponse.json({ message: "primaryItemId and duplicateItemIds are required." }, { status: 400 });
  }

  const mergeIds = [primaryItemId, ...uniqueDuplicateIds];
  const existingItems = await prisma.inventoryItem.findMany({
    where: { id: { in: mergeIds } },
    select: {
      id: true,
      name: true,
      sku: true,
      category: true,
      quantityInStock: true,
      minimumStockLevel: true,
      unitCost: true,
      status: true,
      notes: true
    }
  });

  if (existingItems.length !== mergeIds.length) {
    return NextResponse.json({ message: "One or more inventory items were not found." }, { status: 404 });
  }

  const primary = existingItems.find((item) => item.id === primaryItemId);
  const duplicates = existingItems.filter((item) => uniqueDuplicateIds.includes(item.id));
  if (!primary || duplicates.length === 0) {
    return NextResponse.json({ message: "Nothing to merge." }, { status: 400 });
  }

  const totalStock = roundCurrency(existingItems.reduce((sum, item) => sum + item.quantityInStock, 0));
  const positiveStock = existingItems.filter((item) => item.quantityInStock > 0);
  const weightedUnitCost =
    positiveStock.length > 0
      ? roundCurrency(
          positiveStock.reduce((sum, item) => sum + item.unitCost * item.quantityInStock, 0) /
            positiveStock.reduce((sum, item) => sum + item.quantityInStock, 0)
        )
      : primary.unitCost;
  const nextMinimumStockLevel = Math.max(...existingItems.map((item) => item.minimumStockLevel));
  const nextStatus = existingItems.some((item) => item.status === "ACTIVE") ? "ACTIVE" : "INACTIVE";

  const mergedNotes = [
    primary.notes?.trim() || "",
    `Merged duplicate items (${duplicates.map((item) => `${item.name} [${item.sku}]`).join(", ")}) on ${new Date()
      .toISOString()
      .slice(0, 10)}`
  ]
    .filter(Boolean)
    .join("\n");

  const result = await prisma.$transaction(async (tx) => {
    await tx.inventoryMovement.updateMany({
      where: {
        itemId: { in: uniqueDuplicateIds }
      },
      data: {
        itemId: primaryItemId
      }
    });

    const updatedPrimary = await tx.inventoryItem.update({
      where: { id: primaryItemId },
      data: {
        quantityInStock: totalStock,
        minimumStockLevel: nextMinimumStockLevel,
        unitCost: weightedUnitCost,
        status: nextStatus,
        notes: mergedNotes
      },
      select: {
        id: true,
        name: true,
        sku: true,
        category: true,
        quantityInStock: true,
        minimumStockLevel: true,
        unitCost: true
      }
    });

    await tx.inventoryItem.deleteMany({
      where: { id: { in: uniqueDuplicateIds } }
    });

    await recordAuditLog({
      db: tx,
      module: "inventory",
      entityType: "inventory_item",
      entityId: primaryItemId,
      action: "merge",
      description: `${auth.session.name} merged duplicate items into ${updatedPrimary.name}.`,
      before: {
        primary,
        duplicates
      },
      after: {
        primary: updatedPrimary,
        mergedDuplicateIds: uniqueDuplicateIds
      },
      actor: auditActorFromSession(auth.session)
    });

    return updatedPrimary;
  });

  return NextResponse.json({
    data: {
      ...result,
      mergedDuplicateIds: uniqueDuplicateIds
    }
  });
}
