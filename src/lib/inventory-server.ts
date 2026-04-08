import type {
  EntryApprovalStatus,
  InventoryCategory,
  InventoryItemStatus,
  InventoryMovementType,
  MaintenanceStatus,
  Prisma
} from "@prisma/client";

export function nullableFilter(value: string | null) {
  return value && value !== "all" ? value : null;
}

export function parseDateOrNull(value: string | null, endOfDay = false) {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  if (endOfDay) {
    parsed.setUTCHours(23, 59, 59, 999);
  } else {
    parsed.setUTCHours(0, 0, 0, 0);
  }

  return parsed;
}

export function parseNumeric(value: unknown) {
  const parsed = Number(value ?? 0);
  if (Number.isNaN(parsed)) {
    return null;
  }
  return parsed;
}

export function parsePositiveNumeric(value: unknown) {
  const parsed = parseNumeric(value);
  if (parsed === null || parsed <= 0) {
    return null;
  }
  return parsed;
}

export function parseInventoryCategory(value: unknown): InventoryCategory | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().toUpperCase().replace(/\s+/g, "_");
  if (
    normalized === "DRILLING" ||
    normalized === "HYDRAULIC" ||
    normalized === "ELECTRICAL" ||
    normalized === "CONSUMABLES" ||
    normalized === "TIRES" ||
    normalized === "OILS" ||
    normalized === "FILTERS" ||
    normalized === "SPARE_PARTS" ||
    normalized === "OTHER"
  ) {
    return normalized;
  }
  return null;
}

export function parseInventoryStatus(value: unknown): InventoryItemStatus | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().toUpperCase();
  if (normalized === "ACTIVE" || normalized === "INACTIVE") {
    return normalized;
  }
  return null;
}

export function parseMovementType(value: unknown): InventoryMovementType | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().toUpperCase();
  if (normalized === "IN" || normalized === "OUT" || normalized === "ADJUSTMENT" || normalized === "TRANSFER") {
    return normalized;
  }
  return null;
}

export function roundCurrency(value: number) {
  return Math.round(value * 100) / 100;
}

export function buildDateFilter(fromDate: Date | null, toDate: Date | null) {
  if (!fromDate && !toDate) {
    return undefined;
  }
  return {
    ...(fromDate ? { gte: fromDate } : {}),
    ...(toDate ? { lte: toDate } : {})
  };
}

export function resolveExpenseCategoryFromInventoryCategory(category: InventoryCategory) {
  if (category === "OILS") {
    return "Fuel";
  }
  if (category === "DRILLING" || category === "HYDRAULIC" || category === "ELECTRICAL" || category === "FILTERS") {
    return "Maintenance";
  }
  if (category === "CONSUMABLES" || category === "TIRES" || category === "SPARE_PARTS") {
    return "Spare Parts";
  }
  return "Other";
}

export function resolveExpenseApprovalStatus({
  role,
  linkedMaintenanceStatus
}: {
  role: string;
  linkedMaintenanceStatus: MaintenanceStatus | null;
}): EntryApprovalStatus {
  if (
    linkedMaintenanceStatus === "IN_REPAIR" ||
    linkedMaintenanceStatus === "COMPLETED"
  ) {
    return "APPROVED";
  }
  if (role === "ADMIN") {
    return "APPROVED";
  }
  return "SUBMITTED";
}

export function buildInventoryScopeFilters({
  fromDate,
  toDate,
  projectId,
  clientId,
  rigId
}: {
  fromDate: Date | null;
  toDate: Date | null;
  projectId: string | null;
  clientId: string | null;
  rigId: string | null;
}) {
  const date = buildDateFilter(fromDate, toDate);
  const lockedProjectScope = Boolean(projectId);
  const where: Prisma.InventoryMovementWhereInput = {
    ...(projectId ? { projectId } : {}),
    ...(!lockedProjectScope && clientId ? { clientId } : {}),
    ...(!lockedProjectScope && rigId ? { rigId } : {}),
    ...(date ? { date } : {})
  };
  return where;
}
