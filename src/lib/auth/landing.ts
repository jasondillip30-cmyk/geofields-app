import type { UserRole } from "@/lib/types";

export function getDefaultRouteForRole(role: UserRole) {
  if (role === "STAFF") {
    return "/inventory";
  }
  if (role === "MECHANIC") {
    return "/maintenance";
  }
  if (role === "FIELD") {
    return "/breakdowns";
  }
  return "/";
}
