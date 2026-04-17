import type { UserRole } from "@/lib/types";
import { navItems } from "@/lib/navigation";
import {
  DEFAULT_WORKSPACE_MODE,
  MODE_VISIBLE_NAV_LABELS,
  resolveWorkspaceRouteRule,
  type WorkspaceMode
} from "@/lib/workspace-mode";
import { canAccess, type Permission } from "@/lib/auth/permissions";

export function resolveFirstAllowedRoute(role: UserRole, pathname: string) {
  const routeRule = resolveWorkspaceRouteRule(pathname);
  const prioritizedModes = buildModePriority(routeRule?.recommendedMode);

  for (const mode of prioritizedModes) {
    const candidate = resolveModeVisibleRoute(role, mode, pathname);
    if (candidate) {
      return candidate;
    }
  }

  for (const item of navItems) {
    if (item.href === pathname) {
      continue;
    }
    if (isNavItemAllowedForRole(role, item.permission, item.anyOf)) {
      return item.href;
    }
  }

  return "/login";
}

function buildModePriority(recommendedMode: WorkspaceMode | undefined) {
  const priority: WorkspaceMode[] = [];
  const push = (mode: WorkspaceMode) => {
    if (!priority.includes(mode)) {
      priority.push(mode);
    }
  };

  push(recommendedMode || DEFAULT_WORKSPACE_MODE);
  push("project");
  push("workshop");
  push("all-projects");

  return priority;
}

function resolveModeVisibleRoute(role: UserRole, mode: WorkspaceMode, pathname: string) {
  const labels = MODE_VISIBLE_NAV_LABELS[mode] || [];

  for (const label of labels) {
    const item = navItems.find((entry) => entry.label === label);
    if (!item || item.href === pathname) {
      continue;
    }
    if (isNavItemAllowedForRole(role, item.permission, item.anyOf)) {
      return item.href;
    }
  }

  return null;
}

function isNavItemAllowedForRole(
  role: UserRole,
  permission?: Permission,
  anyOf?: Permission[]
) {
  if (permission) {
    return canAccess(role, permission);
  }
  if (Array.isArray(anyOf) && anyOf.length > 0) {
    return anyOf.some((entry) => canAccess(role, entry));
  }
  return false;
}
