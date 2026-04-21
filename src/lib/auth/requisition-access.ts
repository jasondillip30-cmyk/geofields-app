import type { UserRole } from "@/lib/types";

export type RoleScopedRequisitionType =
  | "LIVE_PROJECT_PURCHASE"
  | "INVENTORY_STOCK_UP"
  | "MAINTENANCE_PURCHASE";

const ALL_REQUISITION_TYPES: RoleScopedRequisitionType[] = [
  "LIVE_PROJECT_PURCHASE",
  "INVENTORY_STOCK_UP",
  "MAINTENANCE_PURCHASE"
];

const ROLE_REQUISITION_TYPES: Partial<Record<UserRole, RoleScopedRequisitionType[]>> = {
  FIELD: ["LIVE_PROJECT_PURCHASE"],
  MECHANIC: ["INVENTORY_STOCK_UP"]
};

export function getAllowedRequisitionTypesForRole(role: UserRole | null | undefined) {
  if (!role) {
    return ALL_REQUISITION_TYPES;
  }
  return ROLE_REQUISITION_TYPES[role] || ALL_REQUISITION_TYPES;
}

export function isRequisitionTypeAllowedForRole(
  role: UserRole | null | undefined,
  type: string
) {
  return getAllowedRequisitionTypesForRole(role).includes(type as RoleScopedRequisitionType);
}

export function getRoleForcedRequisitionType(role: UserRole | null | undefined) {
  if (!role) {
    return null;
  }
  const allowedTypes = ROLE_REQUISITION_TYPES[role];
  if (!allowedTypes || allowedTypes.length !== 1) {
    return null;
  }
  return allowedTypes[0];
}

