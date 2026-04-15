import type { UserRole } from "@/lib/types";
import { isWorkspaceLaunchEnabled } from "@/lib/feature-flags";

export function getDefaultRouteForRole(role: UserRole) {
  if (isWorkspaceLaunchEnabled()) {
    return "/workspace-launch";
  }
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
