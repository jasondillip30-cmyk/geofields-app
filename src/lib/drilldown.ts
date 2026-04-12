import type { AnalyticsFilters } from "@/components/layout/analytics-filters-provider";

export function buildScopedHref(
  filters: AnalyticsFilters,
  path: string,
  overrides?: Record<string, string | null | undefined>
) {
  const search = new URLSearchParams();
  if (filters.workspaceMode && filters.workspaceMode !== "all-projects") {
    search.set("workspace", filters.workspaceMode);
  }
  if (filters.from) search.set("from", filters.from);
  if (filters.to) search.set("to", filters.to);
  if (filters.projectId !== "all") {
    search.set("projectId", filters.projectId);
  } else {
    if (filters.clientId !== "all") search.set("clientId", filters.clientId);
    if (filters.rigId !== "all") search.set("rigId", filters.rigId);
  }

  if (overrides) {
    for (const [key, value] of Object.entries(overrides)) {
      if (value === null || value === undefined || value === "") {
        search.delete(key);
      } else {
        search.set(key, value);
      }
    }
  }

  const effectiveProjectId = search.get("projectId");
  if (effectiveProjectId && effectiveProjectId !== "all") {
    search.delete("clientId");
    search.delete("rigId");
  }

  const query = search.toString();
  return query ? `${path}?${query}` : path;
}

export function getBucketDateRange(bucketStart: string) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(bucketStart)) {
    return {
      from: bucketStart,
      to: bucketStart
    };
  }

  if (/^\d{4}-\d{2}$/.test(bucketStart)) {
    const [yearToken, monthToken] = bucketStart.split("-");
    const year = Number(yearToken);
    const month = Number(monthToken);
    if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
      return null;
    }

    const start = new Date(Date.UTC(year, month - 1, 1));
    const end = new Date(Date.UTC(year, month, 0));
    return {
      from: start.toISOString().slice(0, 10),
      to: end.toISOString().slice(0, 10)
    };
  }

  return null;
}
