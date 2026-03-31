import { NextResponse, type NextRequest } from "next/server";

import { requireApiPermission } from "@/lib/auth/api-guard";
import { auditActorFromSession, recordAuditLog } from "@/lib/audit";
import { standardizeInventoryItemName } from "@/lib/inventory-intelligence";
import { prisma } from "@/lib/prisma";

interface NamingFixInput {
  itemId: string;
  suggestedName?: string;
}

export async function POST(request: NextRequest) {
  const auth = await requireApiPermission(request, "inventory:manage");
  if (!auth.ok) {
    return auth.response;
  }

  const body = await request.json().catch(() => null);
  const rawFixes: unknown[] = Array.isArray(body?.fixes) ? (body.fixes as unknown[]) : [];
  const fixes: NamingFixInput[] = rawFixes
    .map((entry) => (entry && typeof entry === "object" ? (entry as Record<string, unknown>) : null))
    .filter(Boolean)
    .map((entry) => ({
      itemId: typeof entry?.itemId === "string" ? entry.itemId.trim() : "",
      suggestedName: typeof entry?.suggestedName === "string" ? entry.suggestedName.trim() : undefined
    }))
    .filter((entry) => Boolean(entry.itemId));

  if (fixes.length === 0) {
    return NextResponse.json({ message: "No naming fixes provided." }, { status: 400 });
  }

  const uniqueItemIds = Array.from(new Set(fixes.map((fix) => fix.itemId)));
  const items = await prisma.inventoryItem.findMany({
    where: { id: { in: uniqueItemIds } },
    select: {
      id: true,
      name: true,
      sku: true,
      category: true,
      minimumStockLevel: true,
      unitCost: true,
      status: true
    }
  });
  const itemsById = new Map(items.map((item) => [item.id, item]));

  const applied = await prisma.$transaction(async (tx) => {
    const changed: Array<{ itemId: string; beforeName: string; afterName: string }> = [];
    for (const fix of fixes) {
      const item = itemsById.get(fix.itemId);
      if (!item) {
        continue;
      }

      const target = fix.suggestedName || standardizeInventoryItemName(item.name).name;
      if (!target || target === item.name) {
        continue;
      }

      const updated = await tx.inventoryItem.update({
        where: { id: item.id },
        data: {
          name: target
        },
        select: {
          id: true,
          name: true
        }
      });

      changed.push({
        itemId: updated.id,
        beforeName: item.name,
        afterName: updated.name
      });

      await recordAuditLog({
        db: tx,
        module: "inventory",
        entityType: "inventory_item",
        entityId: updated.id,
        action: "edit",
        description: `${auth.session.name} applied naming auto-fix on ${item.name}.`,
        before: {
          id: item.id,
          name: item.name,
          sku: item.sku,
          category: item.category,
          minimumStockLevel: item.minimumStockLevel,
          unitCost: item.unitCost,
          status: item.status
        },
        after: {
          id: item.id,
          name: updated.name,
          sku: item.sku,
          category: item.category,
          minimumStockLevel: item.minimumStockLevel,
          unitCost: item.unitCost,
          status: item.status
        },
        actor: auditActorFromSession(auth.session)
      });
    }
    return changed;
  });

  return NextResponse.json({
    data: {
      updatedCount: applied.length,
      updates: applied
    }
  });
}
