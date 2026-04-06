import { PrismaClient } from "@prisma/client";
import { parseLegacyInventoryUsageReason } from "../src/lib/legacy-inventory-usage-context";

const prisma = new PrismaClient();

async function main() {
  const legacyRows = await prisma.inventoryUsageRequest.findMany({
    where: {
      OR: [
        { reason: { contains: "[usageReasonType:" } },
        { reason: { contains: "[breakdown:" } }
      ]
    },
    select: {
      id: true,
      reason: true,
      maintenanceRequestId: true,
      breakdownReportId: true
    }
  });

  let updated = 0;
  for (const row of legacyRows) {
    const parsed = parseLegacyInventoryUsageReason(row.reason);
    const cleanedReason = parsed.reasonDetails || row.reason;
    const nextBreakdownId =
      row.maintenanceRequestId
        ? null
        : row.breakdownReportId || parsed.breakdownReportId || null;
    await prisma.inventoryUsageRequest.update({
      where: { id: row.id },
      data: {
        reason: cleanedReason,
        breakdownReportId: nextBreakdownId
      }
    });
    updated += 1;
  }

  console.info(
    JSON.stringify(
      {
        ok: true,
        scanned: legacyRows.length,
        updated
      },
      null,
      2
    )
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
