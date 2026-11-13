import { createHash } from "node:crypto";

import { canAccess } from "@/lib/auth/permissions";
import { prisma } from "@/lib/prisma";
import type { GuidedBillingRateItem } from "@/lib/drilling-report-guided-inputs";

export const offlineBillingSelect = {
  itemCode: true, unit: true, unitRate: true, label: true, isActive: true, sortOrder: true,
  depthBandStartM: true, depthBandEndM: true, drillingStageLabel: true
} as const;

export function offlineBillingVersion(project: {
  contractRatePerM: number;
  contractType: string;
}, items: Array<GuidedBillingRateItem & { unitRate: number }>) {
  return offlineDigest([
    project.contractType,
    project.contractRatePerM,
    [...items].sort((a, b) => a.itemCode.localeCompare(b.itemCode)).map((item) => [
      item.itemCode, item.unit, item.unitRate, item.depthBandStartM ?? null, item.depthBandEndM ?? null
    ])
  ]);
}

export function offlineDigest(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export async function canSyncOfflineDrilling(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId }, select: { isActive: true, role: true }
  });
  return Boolean(user?.isActive && canAccess(user.role, "drilling:submit"));
}
