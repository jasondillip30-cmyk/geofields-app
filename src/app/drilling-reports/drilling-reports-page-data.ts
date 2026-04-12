import { buildHoleProgressSummaries } from "./drilling-reports-page-utils";
import { emptyStats, type DrillReportRecord, type DrillStats, type HoleProgressSummary, type ProjectConsumablePoolItem, type ProjectOption, type RigOption } from "./drilling-reports-page-types";

export interface DrillingPageFilterScope {
  from: string;
  to: string;
  clientId: string;
  rigId: string;
}

export interface DrillingReferenceData {
  projects: ProjectOption[];
  rigs: RigOption[];
}

export interface DrillingReportsData {
  rows: DrillReportRecord[];
  stats: DrillStats;
}

export async function loadDrillingReferenceData(): Promise<DrillingReferenceData> {
  const [projectsRes, rigsRes] = await Promise.all([
    fetch("/api/projects", { cache: "no-store" }),
    fetch("/api/rigs", { cache: "no-store" })
  ]);

  const [projectsPayload, rigsPayload] = await Promise.all([
    projectsRes.ok ? projectsRes.json() : Promise.resolve({ data: [] }),
    rigsRes.ok ? rigsRes.json() : Promise.resolve({ data: [] })
  ]);

  return {
    projects: projectsPayload.data || [],
    rigs: rigsPayload.data || []
  };
}

export async function loadDrillingReportsData({
  scopedProjectId,
  filters,
  isSingleProjectScope
}: {
  scopedProjectId: string;
  filters: DrillingPageFilterScope;
  isSingleProjectScope: boolean;
}): Promise<DrillingReportsData> {
  if (!scopedProjectId) {
    return {
      rows: [],
      stats: emptyStats
    };
  }

  const search = new URLSearchParams();
  if (filters.from) search.set("from", filters.from);
  if (filters.to) search.set("to", filters.to);
  if (!isSingleProjectScope && filters.clientId !== "all") search.set("clientId", filters.clientId);
  if (!isSingleProjectScope && filters.rigId !== "all") search.set("rigId", filters.rigId);
  search.set("projectId", scopedProjectId);

  const response = await fetch(`/api/drilling-reports?${search.toString()}`, { cache: "no-store" });
  const payload = response.ok ? await response.json() : { data: [], stats: emptyStats };

  return {
    rows: payload.data || [],
    stats: payload.stats || emptyStats
  };
}

export async function loadProjectHoleProgress(projectId: string): Promise<HoleProgressSummary[]> {
  if (!projectId) {
    return [];
  }
  const response = await fetch(`/api/drilling-reports?projectId=${encodeURIComponent(projectId)}`, {
    cache: "no-store"
  });
  const payload = response.ok ? await response.json() : { data: [] };
  return buildHoleProgressSummaries(Array.isArray(payload.data) ? payload.data : []);
}

export async function loadDrillingConsumablesPool({
  projectId,
  excludeDrillReportId
}: {
  projectId: string;
  excludeDrillReportId: string | null;
}): Promise<ProjectConsumablePoolItem[]> {
  if (!projectId) {
    return [];
  }
  const search = new URLSearchParams({ projectId });
  if (excludeDrillReportId) {
    search.set("excludeDrillReportId", excludeDrillReportId);
  }
  const response = await fetch(`/api/drilling-reports/consumables?${search.toString()}`, {
    cache: "no-store"
  });
  const payload = response.ok ? await response.json() : { data: [] };
  return Array.isArray(payload.data) ? payload.data : [];
}
