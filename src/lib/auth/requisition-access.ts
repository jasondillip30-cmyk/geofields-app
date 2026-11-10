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

const WORKSHOP_REQUISITION_TYPES: RoleScopedRequisitionType[] = ["INVENTORY_STOCK_UP"];

const ROLE_CREATABLE_REQUISITION_TYPES: Record<UserRole, RoleScopedRequisitionType[]> = {
  ADMIN: WORKSHOP_REQUISITION_TYPES,
  MANAGER: WORKSHOP_REQUISITION_TYPES,
  OFFICE: WORKSHOP_REQUISITION_TYPES,
  MECHANIC: WORKSHOP_REQUISITION_TYPES,
  FIELD: [],
  STAFF: []
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

export function getCreatableRequisitionTypesForRole(
  role: UserRole | null | undefined
) {
  if (!role) {
    return WORKSHOP_REQUISITION_TYPES;
  }
  return ROLE_CREATABLE_REQUISITION_TYPES[role];
}

export function isRequisitionTypeCreatableForRole(
  role: UserRole | null | undefined,
  type: string
) {
  return getCreatableRequisitionTypesForRole(role).includes(
    type as RoleScopedRequisitionType
  );
}

export function getRoleForcedRequisitionType(role: UserRole | null | undefined) {
  const allowedTypes = getCreatableRequisitionTypesForRole(role);
  if (allowedTypes.length !== 1) {
    return null;
  }
  return allowedTypes[0];
}
