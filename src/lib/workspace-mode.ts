export type WorkspaceMode = "all-projects" | "project" | "workshop";

export const DEFAULT_WORKSPACE_MODE: WorkspaceMode = "all-projects";

export const WORKSPACE_MODE_LABELS: Record<WorkspaceMode, string> = {
  "all-projects": "All projects",
  project: "Project",
  workshop: "Workshop"
};

export const MODE_VISIBLE_NAV_LABELS: Record<WorkspaceMode, string[]> = {
  "all-projects": [
    "Dashboard",
    "Projects",
    "Clients",
    "Employees",
    "Rigs",
    "Project Operations",
    "Activity Log"
  ],
  project: [
    "Projects",
    "Clients",
    "Rigs",
    "Breakdowns",
    "Inventory",
    "Purchase Requests",
    "Project Operations"
  ],
  workshop: ["Inventory", "Maintenance", "Rigs", "Approvals", "Purchase Requests", "Activity Log"]
};

export const MODE_VISIBLE_SETUP_LABELS: Record<WorkspaceMode, string[]> = {
  "all-projects": ["Rigs", "Projects", "Clients", "Employees", "Vendors", "Locations"],
  project: ["Rigs", "Projects", "Clients"],
  workshop: ["Rigs", "Vendors", "Locations"]
};

export function isWorkspaceMode(value: unknown): value is WorkspaceMode {
  return value === "all-projects" || value === "project" || value === "workshop";
}

export function normalizeWorkspaceMode(value: unknown, fallback: WorkspaceMode = DEFAULT_WORKSPACE_MODE): WorkspaceMode {
  return isWorkspaceMode(value) ? value : fallback;
}

interface WorkspaceRouteRule {
  allowedModes: WorkspaceMode[];
  recommendedMode: WorkspaceMode;
}

const WORKSPACE_ROUTE_RULES: Array<{
  test: (pathname: string) => boolean;
  rule: WorkspaceRouteRule;
}> = [
  {
    test: (pathname) => pathname === "/",
    rule: { allowedModes: ["all-projects"], recommendedMode: "all-projects" }
  },
  {
    test: (pathname) => pathname.startsWith("/projects"),
    rule: { allowedModes: ["all-projects", "project"], recommendedMode: "project" }
  },
  {
    test: (pathname) => pathname.startsWith("/clients"),
    rule: { allowedModes: ["all-projects", "project"], recommendedMode: "project" }
  },
  {
    test: (pathname) => pathname.startsWith("/employees"),
    rule: { allowedModes: ["all-projects"], recommendedMode: "all-projects" }
  },
  {
    test: (pathname) => pathname.startsWith("/rigs"),
    rule: { allowedModes: ["all-projects", "project", "workshop"], recommendedMode: "project" }
  },
  {
    test: (pathname) => pathname.startsWith("/breakdowns"),
    rule: { allowedModes: ["project"], recommendedMode: "project" }
  },
  {
    test: (pathname) => pathname.startsWith("/maintenance"),
    rule: { allowedModes: ["workshop"], recommendedMode: "workshop" }
  },
  {
    test: (pathname) =>
      pathname.startsWith("/inventory/suppliers") || pathname.startsWith("/inventory/locations"),
    rule: { allowedModes: ["all-projects", "workshop"], recommendedMode: "workshop" }
  },
  {
    test: (pathname) => pathname.startsWith("/inventory"),
    rule: { allowedModes: ["all-projects", "project", "workshop"], recommendedMode: "project" }
  },
  {
    test: (pathname) => pathname.startsWith("/approvals"),
    rule: { allowedModes: ["workshop"], recommendedMode: "workshop" }
  },
  {
    test: (pathname) =>
      pathname.startsWith("/expenses") ||
      pathname.startsWith("/purchasing/receipt-follow-up"),
    rule: { allowedModes: ["project", "workshop"], recommendedMode: "project" }
  },
  {
    test: (pathname) => pathname.startsWith("/spending"),
    rule: { allowedModes: ["all-projects", "project"], recommendedMode: "project" }
  },
  {
    test: (pathname) => pathname.startsWith("/activity-log"),
    rule: { allowedModes: ["all-projects", "workshop"], recommendedMode: "workshop" }
  },
  {
    test: (pathname) =>
      pathname.startsWith("/alerts-center") ||
      pathname.startsWith("/executive-overview") ||
      pathname.startsWith("/data-quality") ||
      pathname.startsWith("/forecasting"),
    rule: { allowedModes: ["all-projects"], recommendedMode: "all-projects" }
  }
];

export function resolveWorkspaceRouteRule(pathname: string): WorkspaceRouteRule | null {
  const normalized = pathname.trim() || "/";
  const match = WORKSPACE_ROUTE_RULES.find((entry) => entry.test(normalized));
  return match ? match.rule : null;
}
