import {
  DEFAULT_WORKSPACE_MODE,
  normalizeWorkspaceMode,
  type WorkspaceMode
} from "@/lib/workspace-mode";

export interface AnalyticsScopeFilters {
  workspaceMode: WorkspaceMode;
  projectId: string;
  clientId: string;
  rigId: string;
  from: string;
  to: string;
}

export interface AnalyticsScopeIntent {
  workspaceMode?: WorkspaceMode | string | null;
  projectId?: string | null;
  clientId?: string | null;
  rigId?: string | null;
  from?: string | null;
  to?: string | null;
}

export const ANALYTICS_FILTERS_STORAGE_KEY = "gf:analytics-filters";
export const ANALYTICS_LAST_PROJECT_ID_STORAGE_KEY = "gf:analytics-last-project-id";

export const DEFAULT_ANALYTICS_SCOPE_FILTERS: AnalyticsScopeFilters = {
  workspaceMode: DEFAULT_WORKSPACE_MODE,
  projectId: "all",
  clientId: "all",
  rigId: "all",
  from: "",
  to: ""
};

export function normalizeScopeFilters(
  intent: AnalyticsScopeIntent,
  fallback: AnalyticsScopeFilters = DEFAULT_ANALYTICS_SCOPE_FILTERS,
  rememberedProjectId = ""
): AnalyticsScopeFilters {
  const mode = normalizeWorkspaceMode(intent.workspaceMode, fallback.workspaceMode);
  const from = normalizeDateValue(intent.from ?? fallback.from);
  const to = normalizeDateValue(intent.to ?? fallback.to);

  if (mode === "workshop") {
    return {
      workspaceMode: "workshop",
      projectId: "all",
      clientId: "all",
      rigId: "all",
      from,
      to
    };
  }

  if (mode === "project") {
    const requestedProjectId = normalizeScopeValue(intent.projectId ?? fallback.projectId, "all");
    const projectId =
      requestedProjectId !== "all"
        ? requestedProjectId
        : rememberedProjectId || (fallback.projectId !== "all" ? fallback.projectId : "all");
    return {
      workspaceMode: "project",
      projectId,
      clientId: "all",
      rigId: "all",
      from,
      to
    };
  }

  return {
    workspaceMode: "all-projects",
    projectId: "all",
    clientId: normalizeScopeValue(intent.clientId ?? fallback.clientId, "all"),
    rigId: normalizeScopeValue(intent.rigId ?? fallback.rigId, "all"),
    from,
    to
  };
}

export function parseScopeIntentFromSearchParams(searchParams: URLSearchParams) {
  const workspaceMode = searchParams.get("workspace");
  const projectId = searchParams.get("projectId");
  const clientId = searchParams.get("clientId");
  const rigId = searchParams.get("rigId");
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  const hasScopeParam =
    workspaceMode !== null ||
    projectId !== null ||
    clientId !== null ||
    rigId !== null ||
    from !== null ||
    to !== null;

  if (!hasScopeParam) {
    return null;
  }

  return {
    workspaceMode,
    projectId,
    clientId,
    rigId,
    from,
    to
  } satisfies AnalyticsScopeIntent;
}

export function readStoredScopeFilters() {
  if (typeof window === "undefined") {
    return null;
  }
  const raw = window.sessionStorage.getItem(ANALYTICS_FILTERS_STORAGE_KEY);
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as AnalyticsScopeIntent;
    const rememberedProjectId =
      window.sessionStorage.getItem(ANALYTICS_LAST_PROJECT_ID_STORAGE_KEY) || "";
    return normalizeScopeFilters(parsed, DEFAULT_ANALYTICS_SCOPE_FILTERS, rememberedProjectId);
  } catch {
    return null;
  }
}

export function persistScopeFilters(filters: AnalyticsScopeFilters) {
  if (typeof window === "undefined") {
    return;
  }
  window.sessionStorage.setItem(ANALYTICS_FILTERS_STORAGE_KEY, JSON.stringify(filters));
  if (filters.projectId !== "all") {
    window.sessionStorage.setItem(ANALYTICS_LAST_PROJECT_ID_STORAGE_KEY, filters.projectId);
  }
}

export function applyScopeIntentToSession(intent: AnalyticsScopeIntent) {
  if (typeof window === "undefined") {
    return DEFAULT_ANALYTICS_SCOPE_FILTERS;
  }
  const rememberedProjectId =
    window.sessionStorage.getItem(ANALYTICS_LAST_PROJECT_ID_STORAGE_KEY) || "";
  const baseFilters = readStoredScopeFilters() || DEFAULT_ANALYTICS_SCOPE_FILTERS;
  const nextFilters = normalizeScopeFilters(intent, baseFilters, rememberedProjectId);
  persistScopeFilters(nextFilters);
  return nextFilters;
}

export function areScopeFiltersEqual(left: AnalyticsScopeFilters, right: AnalyticsScopeFilters) {
  return (
    left.workspaceMode === right.workspaceMode &&
    left.projectId === right.projectId &&
    left.clientId === right.clientId &&
    left.rigId === right.rigId &&
    left.from === right.from &&
    left.to === right.to
  );
}

function normalizeDateValue(value: string | null | undefined) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeScopeValue(value: string | null | undefined, fallback = "all") {
  if (typeof value !== "string") {
    return fallback;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : fallback;
}
