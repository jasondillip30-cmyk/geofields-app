import { PrismaClient } from "@prisma/client";

const SMOKE_TEXT_TOKENS = ["smoke-", "smoke test", "operational lifecycle smoke", "Smoke Breakdown"];

function containsSmokeToken(value: string | null | undefined) {
  const text = (value || "").toLowerCase();
  return SMOKE_TEXT_TOKENS.some((token) => text.includes(token.toLowerCase()));
}

export async function purgeDanglingSmokeArtifacts(prisma: PrismaClient) {
  const [usageRows, movementRows, expenseRows, summaryRows, maintenanceRows, breakdownRows, drillRows] =
    await Promise.all([
      prisma.inventoryUsageRequest.findMany({
        where: {
          OR: SMOKE_TEXT_TOKENS.map((token) => ({ reason: { contains: token } }))
        },
        select: { id: true }
      }),
      prisma.inventoryMovement.findMany({
        where: {
          OR: SMOKE_TEXT_TOKENS.map((token) => ({ notes: { contains: token } }))
        },
        select: { id: true }
      }),
      prisma.expense.findMany({
        where: {
          OR: [
            { subcategory: "SMOKE_TEST" },
            ...SMOKE_TEXT_TOKENS.map((token) => ({ notes: { contains: token } }))
          ]
        },
        select: { id: true, notes: true }
      }),
      prisma.summaryReport.findMany({
        where: { reportType: "INVENTORY_RECEIPT_SUBMISSION" },
        select: { id: true, payloadJson: true }
      }),
      prisma.maintenanceRequest.findMany({
        where: {
          OR: [
            ...SMOKE_TEXT_TOKENS.map((token) => ({ issueDescription: { contains: token } })),
            ...SMOKE_TEXT_TOKENS.map((token) => ({ notes: { contains: token } }))
          ]
        },
        select: { id: true }
      }),
      prisma.breakdownReport.findMany({
        where: {
          OR: [
            ...SMOKE_TEXT_TOKENS.map((token) => ({ title: { contains: token } })),
            ...SMOKE_TEXT_TOKENS.map((token) => ({ description: { contains: token } }))
          ]
        },
        select: { id: true }
      }),
      prisma.drillReport.findMany({
        where: {
          OR: [
            ...SMOKE_TEXT_TOKENS.map((token) => ({ holeNumber: { contains: token } })),
            ...SMOKE_TEXT_TOKENS.map((token) => ({ comments: { contains: token } }))
          ]
        },
        select: { id: true }
      })
    ]);

  const summaryIds = summaryRows.filter((row) => containsSmokeToken(row.payloadJson)).map((row) => row.id);
  const usageIds = usageRows.map((row) => row.id);
  const movementIds = movementRows.map((row) => row.id);
  const expenseIds = expenseRows.map((row) => row.id);
  const maintenanceIds = maintenanceRows.map((row) => row.id);
  const breakdownIds = breakdownRows.map((row) => row.id);
  const drillIds = drillRows.map((row) => row.id);

  if (summaryIds.length > 0) {
    await prisma.summaryReport.deleteMany({ where: { id: { in: summaryIds } } });
  }
  if (usageIds.length > 0) {
    await prisma.inventoryUsageRequest.deleteMany({ where: { id: { in: usageIds } } });
  }
  if (movementIds.length > 0) {
    await prisma.inventoryMovement.deleteMany({ where: { id: { in: movementIds } } });
  }
  if (expenseIds.length > 0) {
    await prisma.expense.deleteMany({ where: { id: { in: expenseIds } } });
  }
  if (maintenanceIds.length > 0) {
    await prisma.maintenanceUpdate.deleteMany({ where: { maintenanceId: { in: maintenanceIds } } });
  }
  if (maintenanceIds.length > 0) {
    await prisma.maintenanceRequest.deleteMany({ where: { id: { in: maintenanceIds } } });
  }
  if (breakdownIds.length > 0) {
    await prisma.breakdownReport.deleteMany({ where: { id: { in: breakdownIds } } });
  }
  if (drillIds.length > 0) {
    await prisma.drillReport.deleteMany({ where: { id: { in: drillIds } } });
  }
}
