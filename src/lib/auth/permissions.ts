import type { UserRole } from "@/lib/types";

export type Permission =
  | "dashboard:view"
  | "clients:view"
  | "clients:manage"
  | "projects:view"
  | "projects:manage"
  | "reports:view"
  | "drilling:submit"
  | "drilling:view"
  | "breakdowns:view"
  | "breakdowns:submit"
  | "finance:view"
  | "finance:edit"
  | "expenses:manual"
  | "maintenance:view"
  | "maintenance:submit"
  | "maintenance:approve"
  | "mechanics:view"
  | "rigs:view"
  | "rigs:manage"
  | "inventory:view"
  | "inventory:manage"
  | "employees:view"
  | "employees:manage";

const permissionMap: Record<UserRole, Permission[]> = {
  ADMIN: [
    "dashboard:view",
    "clients:view",
    "clients:manage",
    "projects:view",
    "projects:manage",
    "reports:view",
    "drilling:submit",
    "drilling:view",
    "breakdowns:view",
    "breakdowns:submit",
    "finance:view",
    "finance:edit",
    "expenses:manual",
    "maintenance:view",
    "maintenance:submit",
    "maintenance:approve",
    "mechanics:view",
    "rigs:view",
    "rigs:manage",
    "inventory:view",
    "inventory:manage",
    "employees:view",
    "employees:manage"
  ],
  MANAGER: [
    "dashboard:view",
    "clients:view",
    "clients:manage",
    "projects:view",
    "projects:manage",
    "reports:view",
    "drilling:submit",
    "drilling:view",
    "breakdowns:view",
    "finance:view",
    "finance:edit",
    "expenses:manual",
    "maintenance:view",
    "maintenance:approve",
    "mechanics:view",
    "rigs:view",
    "rigs:manage",
    "inventory:view",
    "inventory:manage",
    "employees:view",
    "employees:manage"
  ],
  STAFF: ["drilling:submit", "drilling:view", "projects:view", "rigs:view", "breakdowns:view", "breakdowns:submit", "inventory:view"],
  OFFICE: [
    "dashboard:view",
    "clients:view",
    "clients:manage",
    "projects:view",
    "projects:manage",
    "reports:view",
    "drilling:submit",
    "drilling:view",
    "breakdowns:view",
    "finance:view",
    "expenses:manual",
    "maintenance:view",
    "mechanics:view",
    "rigs:view",
    "inventory:view",
    "employees:view",
  ],
  MECHANIC: ["maintenance:view", "maintenance:submit", "rigs:view", "mechanics:view", "inventory:view"],
  FIELD: ["drilling:submit", "drilling:view", "projects:view", "rigs:view", "breakdowns:view", "breakdowns:submit"]
};

export function canAccess(role: UserRole, permission: Permission) {
  return permissionMap[role].includes(permission);
}

export function requirePermission(role: UserRole, permission: Permission) {
  if (!canAccess(role, permission)) {
    throw new Error(`Role ${role} is not permitted for action ${permission}`);
  }
}

export const rolePermissionMatrix = permissionMap;
