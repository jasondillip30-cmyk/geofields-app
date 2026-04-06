export type InventoryUsageReasonType = "MAINTENANCE" | "BREAKDOWN" | "OTHER";

export function normalizeInventoryUsageReasonType(
  value: unknown
): InventoryUsageReasonType {
  if (typeof value !== "string") {
    return "OTHER";
  }
  const normalized = value.trim().toUpperCase();
  if (normalized === "MAINTENANCE" || normalized === "BREAKDOWN" || normalized === "OTHER") {
    return normalized;
  }
  return "OTHER";
}

export function deriveInventoryUsageReasonType({
  explicitReasonType,
  maintenanceRequestId,
  breakdownReportId
}: {
  explicitReasonType: unknown;
  maintenanceRequestId: string | null;
  breakdownReportId: string | null;
}) {
  if (maintenanceRequestId) {
    return "MAINTENANCE" as const;
  }
  if (breakdownReportId) {
    return "BREAKDOWN" as const;
  }
  return normalizeInventoryUsageReasonType(explicitReasonType);
}
