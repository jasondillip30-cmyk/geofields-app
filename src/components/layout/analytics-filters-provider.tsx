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

export interface AnalyticsFilters {
  clientId: string;
  rigId: string;
  from: string;
  to: string;
}

interface AnalyticsFiltersContextValue {
  filters: AnalyticsFilters;
  setFilters: Dispatch<SetStateAction<AnalyticsFilters>>;
  resetFilters: () => void;
}

const STORAGE_KEY = "gf:analytics-filters";

const defaultFilters: AnalyticsFilters = {
  clientId: "all",
  rigId: "all",
  from: "",
  to: ""
};

const AnalyticsFiltersContext = createContext<AnalyticsFiltersContextValue | null>(null);

export function AnalyticsFiltersProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [filters, setFilters] = useState<AnalyticsFilters>(defaultFilters);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return;
    }

    try {
      const parsed = JSON.parse(raw) as Partial<AnalyticsFilters>;
      setFilters({
        clientId: typeof parsed.clientId === "string" && parsed.clientId ? parsed.clientId : defaultFilters.clientId,
        rigId: typeof parsed.rigId === "string" && parsed.rigId ? parsed.rigId : defaultFilters.rigId,
        from: typeof parsed.from === "string" ? parsed.from : defaultFilters.from,
        to: typeof parsed.to === "string" ? parsed.to : defaultFilters.to
      });
    } catch {
      setFilters(defaultFilters);
    }
  }, []);

  const syncFiltersFromSearchParams = useCallback((searchParams: URLSearchParams) => {
    const clientIdParam = searchParams.get("clientId");
    const rigIdParam = searchParams.get("rigId");
    const fromParam = searchParams.get("from");
    const toParam = searchParams.get("to");
    const hasUrlFilter = clientIdParam !== null || rigIdParam !== null || fromParam !== null || toParam !== null;

    if (!hasUrlFilter) {
      return;
    }

    const nextFilters: AnalyticsFilters = {
      clientId: clientIdParam && clientIdParam !== "all" ? clientIdParam : "all",
      rigId: rigIdParam && rigIdParam !== "all" ? rigIdParam : "all",
      from: fromParam || "",
      to: toParam || ""
    };

    setFilters((current) =>
      current.clientId === nextFilters.clientId &&
      current.rigId === nextFilters.rigId &&
      current.from === nextFilters.from &&
      current.to === nextFilters.to
        ? current
        : nextFilters
    );
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(filters));
  }, [filters]);

  const value = useMemo<AnalyticsFiltersContextValue>(
    () => ({
      filters,
      setFilters,
      resetFilters: () => setFilters(defaultFilters)
    }),
    [filters]
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
