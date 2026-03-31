import type { UserRole } from "@/lib/types";

export const roleLabels: Record<UserRole, string> = {
  ADMIN: "Admin / Management",
  MANAGER: "Manager",
  STAFF: "Staff",
  OFFICE: "Office Staff",
  MECHANIC: "Mechanic",
  FIELD: "Field Operations"
};

export const roleDescriptions: Record<UserRole, string> = {
  ADMIN: "Full company visibility across operations, finance, and approvals.",
  MANAGER: "Operational management access with approvals and protected inventory controls.",
  STAFF: "Operational staff access for day-to-day workflows and request submission.",
  OFFICE: "Project administration and reporting with submit/review support and no protected management actions.",
  MECHANIC: "Rig view, damage reporting, maintenance requests, and repair tracking.",
  FIELD: "Daily drilling reports, production logs, and field expense capture."
};

export const allRoles: UserRole[] = ["ADMIN", "MANAGER", "STAFF", "OFFICE", "MECHANIC", "FIELD"];
