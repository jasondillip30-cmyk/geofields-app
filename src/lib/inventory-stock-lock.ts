import { Prisma } from "@prisma/client";

export async function lockInventoryStock(tx: Prisma.TransactionClient, itemIds: string[]) {
  if (itemIds.length === 0) return;
  // Lock in a consistent order for multi-item postings; FK checks can still reference these rows.
  await tx.$queryRaw`SELECT id FROM "InventoryItem"
    WHERE id IN (${Prisma.join(itemIds)})
    ORDER BY id FOR NO KEY UPDATE`;
}
