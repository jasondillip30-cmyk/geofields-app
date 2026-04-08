export type InventoryUsageContextType = "MAINTENANCE" | "BREAKDOWN" | "DRILLING_REPORT" | "OTHER";
export type InventoryUsageReasonType = InventoryUsageContextType;

export function normalizeInventoryUsageContextType(
  value: unknown
): InventoryUsageContextType {
  if (typeof value !== "string") {
    return "OTHER";
  }
  const normalized = value.trim().toUpperCase();
  if (
    normalized === "MAINTENANCE" ||
    normalized === "BREAKDOWN" ||
    normalized === "DRILLING_REPORT" ||
    normalized === "OTHER"
  ) {
    return normalized;
  }
  return "OTHER";
}

export function normalizeInventoryUsageReasonType(
  value: unknown
): InventoryUsageReasonType {
  return normalizeInventoryUsageContextType(value);
}

export function deriveInventoryUsageContextType({
  explicitContextType,
  explicitReasonType,
  maintenanceRequestId,
  breakdownReportId,
  drillReportId
}: {
  explicitContextType: unknown;
  explicitReasonType: unknown;
  maintenanceRequestId: string | null;
  breakdownReportId: string | null;
  drillReportId: string | null;
}) {
  if (maintenanceRequestId) {
    return "MAINTENANCE" as const;
  }
  if (breakdownReportId) {
    return "BREAKDOWN" as const;
  }
  if (drillReportId) {
    return "DRILLING_REPORT" as const;
  }
  const normalizedContextType = normalizeInventoryUsageContextType(explicitContextType);
  if (normalizedContextType !== "OTHER") {
    return normalizedContextType;
  }
  return normalizeInventoryUsageReasonType(explicitReasonType);
}

export function deriveInventoryUsageReasonType(input: {
  explicitReasonType: unknown;
  maintenanceRequestId: string | null;
  breakdownReportId: string | null;
  drillReportId: string | null;
  explicitContextType?: unknown;
}) {
  return deriveInventoryUsageContextType({
    explicitContextType:
      typeof input.explicitContextType === "undefined" ? null : input.explicitContextType,
    explicitReasonType: input.explicitReasonType,
    maintenanceRequestId: input.maintenanceRequestId,
    breakdownReportId: input.breakdownReportId,
    drillReportId: input.drillReportId
  });
}
