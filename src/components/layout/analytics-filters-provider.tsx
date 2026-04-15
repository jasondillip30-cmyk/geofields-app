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
  type WorkspaceMode
} from "@/lib/workspace-mode";
import {
  ANALYTICS_LAST_PROJECT_ID_STORAGE_KEY,
  DEFAULT_ANALYTICS_SCOPE_FILTERS,
  areScopeFiltersEqual,
  normalizeScopeFilters,
  parseScopeIntentFromSearchParams,
  persistScopeFilters,
  readStoredScopeFilters,
  type AnalyticsScopeFilters,
  type AnalyticsScopeIntent
} from "@/lib/analytics-scope";

export type AnalyticsFilters = AnalyticsScopeFilters;

interface AnalyticsFiltersContextValue {
  filters: AnalyticsFilters;
  setFilters: Dispatch<SetStateAction<AnalyticsFilters>>;
  applyScope: (intent: AnalyticsScopeIntent) => void;
  setWorkspaceMode: (mode: WorkspaceMode) => void;
  resetFilters: () => void;
  scopeBootstrapped: boolean;
}

const defaultFilters: AnalyticsFilters = DEFAULT_ANALYTICS_SCOPE_FILTERS;

const AnalyticsFiltersContext = createContext<AnalyticsFiltersContextValue | null>(null);

export function AnalyticsFiltersProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [filters, setFilters] = useState<AnalyticsFilters>(defaultFilters);
  const [rememberedProjectId, setRememberedProjectId] = useState("");
  const [scopeBootstrapped, setScopeBootstrapped] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const rememberedProject = window.sessionStorage.getItem(ANALYTICS_LAST_PROJECT_ID_STORAGE_KEY) || "";
    setRememberedProjectId(rememberedProject);

    const initialSearchParams = new URLSearchParams(window.location.search);
    const sanitizedInitialSearchParams = sanitizeScopeSearchParams(
      window.location.pathname,
      initialSearchParams
    );
    const urlIntent = parseScopeIntentFromSearchParams(sanitizedInitialSearchParams);
    if (urlIntent) {
      const nextFilters = normalizeScopeFilters(urlIntent, defaultFilters, rememberedProject);
      setFilters(nextFilters);
      persistScopeFilters(nextFilters);
      setScopeBootstrapped(true);
      return;
    }

    const storedFilters = readStoredScopeFilters();
    if (!storedFilters) {
      setScopeBootstrapped(true);
      return;
    }
    setFilters(storedFilters);
    setScopeBootstrapped(true);
  }, []);

  const syncFiltersFromSearchParams = useCallback((pathname: string, searchParams: URLSearchParams) => {
    const sanitizedSearchParams = sanitizeScopeSearchParams(pathname, searchParams);
    const urlIntent = parseScopeIntentFromSearchParams(sanitizedSearchParams);
    if (!urlIntent) {
      return;
    }

    setFilters((current) =>
      (() => {
        const nextFilters = normalizeScopeFilters(urlIntent, current, rememberedProjectId);
        return areScopeFiltersEqual(current, nextFilters) ? current : nextFilters;
      })()
    );
  }, [rememberedProjectId]);

  const applyScope = useCallback(
    (intent: AnalyticsScopeIntent) => {
      setFilters((current) => {
        const nextFilters = normalizeScopeFilters(intent, current, rememberedProjectId);
        return areScopeFiltersEqual(current, nextFilters) ? current : nextFilters;
      });
    },
    [rememberedProjectId]
  );

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    persistScopeFilters(filters);
  }, [filters]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    if (!rememberedProjectId) {
      window.sessionStorage.removeItem(ANALYTICS_LAST_PROJECT_ID_STORAGE_KEY);
      return;
    }
    window.sessionStorage.setItem(ANALYTICS_LAST_PROJECT_ID_STORAGE_KEY, rememberedProjectId);
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
      setFilters((current) => {
        const nextFilters = normalizeScopeFilters({ workspaceMode: mode }, current, rememberedProjectId);
        if (areScopeFiltersEqual(current, nextFilters)) {
          return current;
        }
        return nextFilters;
      });
    },
    [rememberedProjectId]
  );

  const value = useMemo<AnalyticsFiltersContextValue>(
    () => ({
      filters,
      setFilters,
      applyScope,
      setWorkspaceMode,
      resetFilters: () => setFilters(defaultFilters),
      scopeBootstrapped
    }),
    [applyScope, filters, scopeBootstrapped, setWorkspaceMode]
  );

  return (
    <AnalyticsFiltersContext.Provider value={value}>
      {children}
      <Suspense fallback={null}>
        <UrlFiltersSync
          pathname={pathname}
          onSync={syncFiltersFromSearchParams}
          disabled={!scopeBootstrapped}
        />
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
  onSync,
  disabled
}: {
  pathname: string;
  onSync: (pathname: string, searchParams: URLSearchParams) => void;
  disabled?: boolean;
}) {
  const searchParams = useSearchParams();

  useEffect(() => {
    if (disabled) {
      return;
    }
    onSync(pathname, new URLSearchParams(searchParams.toString()));
  }, [disabled, onSync, pathname, searchParams]);

  return null;
}

const SETUP_SCOPE_GUARD_PREFIXES = ["/clients/setup", "/rigs/setup", "/projects/setup"] as const;

function sanitizeScopeSearchParams(pathname: string, searchParams: URLSearchParams) {
  if (!shouldIgnoreEntityScopeParams(pathname)) {
    return searchParams;
  }

  const sanitized = new URLSearchParams(searchParams.toString());
  sanitized.delete("projectId");
  sanitized.delete("clientId");
  sanitized.delete("rigId");
  return sanitized;
}

function shouldIgnoreEntityScopeParams(pathname: string) {
  return SETUP_SCOPE_GUARD_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}
