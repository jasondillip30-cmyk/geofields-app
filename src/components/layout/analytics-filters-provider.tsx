"use client";

import {
  Suspense,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction
} from "react";
import { usePathname, useSearchParams } from "next/navigation";
import {
  DEFAULT_WORKSPACE_MODE,
  normalizeWorkspaceMode,
  type WorkspaceMode
} from "@/lib/workspace-mode";

export interface AnalyticsFilters {
  workspaceMode: WorkspaceMode;
  projectId: string;
  clientId: string;
  rigId: string;
  from: string;
  to: string;
}

interface AnalyticsFiltersContextValue {
  filters: AnalyticsFilters;
  setFilters: Dispatch<SetStateAction<AnalyticsFilters>>;
  setWorkspaceMode: (mode: WorkspaceMode) => void;
  resetFilters: () => void;
}

const STORAGE_KEY = "gf:analytics-filters";
const LAST_PROJECT_ID_KEY = "gf:analytics-last-project-id";

const defaultFilters: AnalyticsFilters = {
  workspaceMode: DEFAULT_WORKSPACE_MODE,
  projectId: "all",
  clientId: "all",
  rigId: "all",
  from: "",
  to: ""
};

const AnalyticsFiltersContext = createContext<AnalyticsFiltersContextValue | null>(null);

export function AnalyticsFiltersProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [filters, setFilters] = useState<AnalyticsFilters>(defaultFilters);
  const [rememberedProjectId, setRememberedProjectId] = useState("");

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const rememberedProject = window.sessionStorage.getItem(LAST_PROJECT_ID_KEY) || "";
    setRememberedProjectId(rememberedProject);

    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return;
    }

    try {
      const parsed = JSON.parse(raw) as Partial<AnalyticsFilters>;
      const parsedProjectId =
        typeof parsed.projectId === "string" && parsed.projectId && parsed.projectId !== "all"
          ? parsed.projectId
          : "all";
      const requestedMode = normalizeWorkspaceMode(
        parsed.workspaceMode,
        parsedProjectId !== "all" ? "project" : DEFAULT_WORKSPACE_MODE
      );
      const mode =
        requestedMode === "project" && parsedProjectId === "all" && rememberedProject
          ? "project"
          : requestedMode;
      const normalizedProjectId =
        mode === "project"
          ? parsedProjectId !== "all"
            ? parsedProjectId
            : rememberedProject || "all"
          : "all";
      const clientId =
        mode === "workshop"
          ? "all"
          : typeof parsed.clientId === "string" && parsed.clientId
            ? parsed.clientId
            : defaultFilters.clientId;
      const rigId =
        mode === "workshop"
          ? "all"
          : typeof parsed.rigId === "string" && parsed.rigId
            ? parsed.rigId
            : defaultFilters.rigId;
      setFilters({
        workspaceMode: mode,
        projectId: normalizedProjectId,
        clientId,
        rigId,
        from: typeof parsed.from === "string" ? parsed.from : defaultFilters.from,
        to: typeof parsed.to === "string" ? parsed.to : defaultFilters.to
      });
    } catch {
      setFilters(defaultFilters);
    }
  }, []);

  const syncFiltersFromSearchParams = useCallback((searchParams: URLSearchParams) => {
    const projectIdParam = searchParams.get("projectId");
    const clientIdParam = searchParams.get("clientId");
    const rigIdParam = searchParams.get("rigId");
    const fromParam = searchParams.get("from");
    const toParam = searchParams.get("to");
    const workspaceParam = searchParams.get("workspace");
    const hasUrlFilter =
      projectIdParam !== null || clientIdParam !== null || rigIdParam !== null || fromParam !== null || toParam !== null;
    const hasWorkspaceParam = workspaceParam !== null;

    if (!hasUrlFilter && !hasWorkspaceParam) {
      return;
    }

    const normalizedProjectId =
      projectIdParam && projectIdParam !== "all" ? projectIdParam : "all";
    const requestedMode = normalizeWorkspaceMode(
      workspaceParam,
      normalizedProjectId !== "all" ? "project" : DEFAULT_WORKSPACE_MODE
    );
    const mode =
      requestedMode === "project" && normalizedProjectId === "all" && rememberedProjectId
        ? "project"
        : requestedMode;
    const restoredProjectId =
      mode === "project"
        ? normalizedProjectId !== "all"
          ? normalizedProjectId
          : rememberedProjectId || "all"
        : "all";
    const nextClientId =
      mode === "workshop"
        ? "all"
        : clientIdParam && clientIdParam !== "all"
          ? clientIdParam
          : "all";
    const nextRigId =
      mode === "workshop"
        ? "all"
        : rigIdParam && rigIdParam !== "all"
          ? rigIdParam
          : "all";
    const nextFilters: AnalyticsFilters =
      restoredProjectId !== "all"
        ? {
            workspaceMode: mode,
            projectId: restoredProjectId,
            clientId: "all",
            rigId: "all",
            from: fromParam || "",
            to: toParam || ""
          }
        : {
            workspaceMode: mode,
            projectId: "all",
            clientId: nextClientId,
            rigId: nextRigId,
            from: fromParam || "",
            to: toParam || ""
          };

    setFilters((current) =>
      current.workspaceMode === nextFilters.workspaceMode &&
      current.projectId === nextFilters.projectId &&
      current.clientId === nextFilters.clientId &&
      current.rigId === nextFilters.rigId &&
      current.from === nextFilters.from &&
      current.to === nextFilters.to
        ? current
        : nextFilters
    );
  }, [rememberedProjectId]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(filters));
  }, [filters]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    if (!rememberedProjectId) {
      window.sessionStorage.removeItem(LAST_PROJECT_ID_KEY);
      return;
    }
    window.sessionStorage.setItem(LAST_PROJECT_ID_KEY, rememberedProjectId);
  }, [rememberedProjectId]);

  useEffect(() => {
    if (filters.projectId === "all") {
      return;
    }
    if (filters.projectId === rememberedProjectId) {
      return;
    }
    setRememberedProjectId(filters.projectId);
  }, [filters.projectId, rememberedProjectId]);

  useEffect(() => {
    if (filters.projectId === "all") {
      return;
    }
    if (filters.clientId === "all" && filters.rigId === "all") {
      return;
    }
    setFilters((current) =>
      current.projectId !== "all" &&
      (current.clientId !== "all" || current.rigId !== "all")
        ? { ...current, clientId: "all", rigId: "all" }
        : current
    );
  }, [filters.clientId, filters.projectId, filters.rigId]);

  useEffect(() => {
    if (filters.workspaceMode === "all-projects" && filters.projectId !== "all") {
      setFilters((current) =>
        current.workspaceMode === "all-projects" && current.projectId !== "all"
          ? { ...current, projectId: "all" }
          : current
      );
      return;
    }

    if (
      filters.workspaceMode === "workshop" &&
      (filters.projectId !== "all" || filters.clientId !== "all" || filters.rigId !== "all")
    ) {
      setFilters((current) =>
        current.workspaceMode === "workshop" &&
        (current.projectId !== "all" || current.clientId !== "all" || current.rigId !== "all")
          ? { ...current, projectId: "all", clientId: "all", rigId: "all" }
          : current
      );
    }
  }, [filters.clientId, filters.projectId, filters.rigId, filters.workspaceMode]);

  const setWorkspaceMode = useCallback(
    (mode: WorkspaceMode) => {
      if (mode !== "project" && filters.projectId !== "all") {
        setRememberedProjectId(filters.projectId);
      }
      setFilters((current) => {
        if (current.workspaceMode === mode) {
          return current;
        }

        if (mode === "workshop") {
          return {
            ...current,
            workspaceMode: "workshop",
            projectId: "all",
            clientId: "all",
            rigId: "all"
          };
        }

        if (mode === "all-projects") {
          return {
            ...current,
            workspaceMode: "all-projects",
            projectId: "all"
          };
        }

        const restoredProjectId =
          current.projectId !== "all" ? current.projectId : rememberedProjectId || "all";
        return {
          ...current,
          workspaceMode: "project",
          projectId: restoredProjectId,
          clientId: restoredProjectId !== "all" ? "all" : current.clientId,
          rigId: restoredProjectId !== "all" ? "all" : current.rigId
        };
      });
    },
    [filters.projectId, rememberedProjectId]
  );

  const value = useMemo<AnalyticsFiltersContextValue>(
    () => ({
      filters,
      setFilters,
      setWorkspaceMode,
      resetFilters: () => setFilters(defaultFilters)
    }),
    [filters, setWorkspaceMode]
  );

  return (
    <AnalyticsFiltersContext.Provider value={value}>
      {children}
      <Suspense fallback={null}>
        <UrlFiltersSync pathname={pathname} onSync={syncFiltersFromSearchParams} />
      </Suspense>
    </AnalyticsFiltersContext.Provider>
  );
}

export function useAnalyticsFilters() {
  const context = useContext(AnalyticsFiltersContext);
  if (!context) {
    throw new Error("useAnalyticsFilters must be used inside AnalyticsFiltersProvider");
  }

  return context;
}

function UrlFiltersSync({
  pathname,
  onSync
}: {
  pathname: string;
  onSync: (searchParams: URLSearchParams) => void;
}) {
  const searchParams = useSearchParams();

  useEffect(() => {
    onSync(new URLSearchParams(searchParams.toString()));
  }, [onSync, pathname, searchParams]);

  return null;
}
