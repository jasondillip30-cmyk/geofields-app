import type { UserRole } from "@/lib/types";

import { canAccess } from "@/lib/auth/permissions";

interface LaunchDateRange {
  from?: string | null;
  to?: string | null;
}

export function canUseLaunchGlobe(role: UserRole | null | undefined) {
  if (!role) {
    return true;
  }
  return role !== "MECHANIC";
}

export function canUnlockAllProjectsFromLaunch(role: UserRole | null | undefined) {
  if (!role) {
    return true;
  }
  return role !== "MECHANIC" && role !== "FIELD";
}

export function canUseWorkshopFromLaunch(role: UserRole | null | undefined) {
  if (!role) {
    return true;
  }
  return role !== "FIELD";
}

export function resolveProjectLaunchDestination(role: UserRole | null | undefined) {
  if (role && (canAccess(role, "drilling:view") || canAccess(role, "finance:view"))) {
    return "/spending";
  }
  return "/rigs";
}

export function resolveWorkshopLaunchDestination(role: UserRole | null | undefined) {
  if (role === "MECHANIC") {
    return "/maintenance";
  }
  if (role && canAccess(role, "inventory:view")) {
    return "/inventory";
  }
  if (role && canAccess(role, "maintenance:view")) {
    return "/maintenance";
  }
  return "/rigs";
}

export function buildWorkshopScopedHref(
  destination: string,
  { from, to }: LaunchDateRange = {}
) {
  const params = new URLSearchParams();
  params.set("workspace", "workshop");
  params.set("projectId", "all");
  params.set("clientId", "all");
  params.set("rigId", "all");
  if (typeof from === "string" && from.trim()) {
    params.set("from", from);
  }
  if (typeof to === "string" && to.trim()) {
    params.set("to", to);
  }
  return `${destination}?${params.toString()}`;
}
