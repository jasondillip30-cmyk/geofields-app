import { canAccess } from "@/lib/auth/permissions";
import type { UserRole } from "@/lib/types";

export function canManageDrillingApprovalActions(role: string | null | undefined) {
  return role === "ADMIN" || role === "MANAGER";
}

export function canUseElevatedDrillingEdit(role: string | null | undefined) {
  return canManageDrillingApprovalActions(role);
}

export function canManageExpenseApprovalActions(role: string | null | undefined) {
  return role === "ADMIN" || role === "MANAGER";
}

export function canViewApprovalWorkspace(role: string | null | undefined) {
  return canRoleAccess(role, "reports:view");
}

export function canSubmitMaintenanceRequests(role: string | null | undefined) {
  return canRoleAccess(role, "maintenance:submit");
}

export function canManageMaintenanceApprovalActions(role: string | null | undefined) {
  return canRoleAccess(role, "maintenance:approve");
}

export function canManageInventoryApprovalActions(role: string | null | undefined) {
  return canRoleAccess(role, "inventory:manage");
}

function canRoleAccess(role: string | null | undefined, permission: Parameters<typeof canAccess>[1]) {
  const normalizedRole = normalizeUserRole(role);
  if (!normalizedRole) {
    return false;
  }
  return canAccess(normalizedRole, permission);
}

function normalizeUserRole(role: string | null | undefined): UserRole | null {
  if (
    role === "ADMIN" ||
    role === "MANAGER" ||
    role === "STAFF" ||
    role === "OFFICE" ||
    role === "MECHANIC" ||
    role === "FIELD"
  ) {
    return role;
  }
  return null;
}
