import type { UserRole } from "@/lib/types";
import { isWorkspaceLaunchEnabled } from "@/lib/feature-flags";
import { buildWorkshopScopedHref } from "@/lib/auth/workspace-launch-access";

export function getDefaultRouteForRole(role: UserRole) {
  if (role === "MECHANIC") {
    return buildWorkshopScopedHref("/maintenance");
  }
  if (isWorkspaceLaunchEnabled()) {
    return "/workspace-launch";
  }
  if (role === "STAFF") {
    return "/inventory";
  }
  if (role === "FIELD") {
    return "/breakdowns";
  }
  return "/";
}
