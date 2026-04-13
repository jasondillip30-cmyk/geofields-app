"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { CalendarDays, Filter, PanelLeft, PanelLeftClose, X } from "lucide-react";

import { roleLabels } from "@/lib/auth/roles";
import { canViewApprovalWorkspace } from "@/lib/auth/approval-policy";
import { useAnalyticsFilters } from "@/components/layout/analytics-filters-provider";
import { useRole } from "@/components/layout/role-provider";
import { cn } from "@/lib/utils";
import { WORKSPACE_MODE_LABELS, type WorkspaceMode } from "@/lib/workspace-mode";

interface TopbarProps {
  sidebarHidden: boolean;
  onToggleSidebar: () => void;
}

interface PageMeta {
  title: string;
  subtitle: string;
}

interface ProjectScopeOption {
  id: string;
  name: string;
  status: string;
}

const PAGE_META: Array<{ test: (pathname: string) => boolean; meta: PageMeta }> = [
  {
    test: (pathname) => pathname === "/",
    meta: {
      title: "Dashboard",
      subtitle: "Drilling-first operations dashboard: rigs, projects, costs, revenue, and profitability."
    }
  },
  {
    test: (pathname) => pathname.startsWith("/executive-overview"),
    meta: {
      title: "Executive Overview",
      subtitle: "High-level management snapshot across recognized finance, operations, and approval risk."
    }
  },
  {
    test: (pathname) => pathname.startsWith("/alerts-center"),
    meta: {
      title: "Alerts Center",
      subtitle: "Manager attention workspace for budget pressure, stale approvals, and linkage issues."
    }
  },
  {
    test: (pathname) => pathname.startsWith("/data-quality/linkage-center"),
    meta: {
      title: "Data Quality / Linkage Center",
      subtitle: "Manager workspace for correcting recognized spend records missing rig, project, or maintenance linkage."
    }
  },
  {
    test: (pathname) => pathname.startsWith("/clients"),
    meta: {
      title: "Clients",
      subtitle: "Client workspaces, profitability context, and project performance."
    }
  },
  {
    test: (pathname) => pathname.startsWith("/projects"),
    meta: {
      title: "Projects",
      subtitle: "Project profitability center across drilling progress, revenue, costs, and rig assignment."
    }
  },
  {
    test: (pathname) => pathname.startsWith("/drilling-reports"),
    meta: {
      title: "Drilling Reports",
      subtitle: "Record daily drilling progress and review what happened on the project."
    }
  },
  {
    test: (pathname) => pathname.startsWith("/spending/profit"),
    meta: {
      title: "Project Operations / Profit",
      subtitle: "Project-first profit view with margin and trend for the locked project."
    }
  },
  {
    test: (pathname) => pathname.startsWith("/spending/drilling-reports"),
    meta: {
      title: "Project Operations / Drilling Reports",
      subtitle: "Project-first drilling report list and detail inside the Project Operations workspace."
    }
  },
  {
    test: (pathname) => pathname.startsWith("/spending"),
    meta: {
      title: "Project Operations",
      subtitle: "Project-first workspace for revenue, transactions, and drilling operations."
    }
  },
  {
    test: (pathname) => pathname.startsWith("/expenses"),
    meta: {
      title: "Purchase Requests",
      subtitle: "Requisition-to-cost workspace for operational purchases and project-linked spending."
    }
  },
  {
    test: (pathname) => pathname.startsWith("/purchasing/receipt-follow-up"),
    meta: {
      title: "Purchase Receipt Follow-up",
      subtitle: "Continue approved requisitions into guided receipt capture, review, and posting."
    }
  },
  {
    test: (pathname) => pathname.startsWith("/forecasting"),
    meta: {
      title: "Forecasting",
      subtitle: "Scenario planning, simulation, and forward-looking projections."
    }
  },
  {
    test: (pathname) => pathname.startsWith("/inventory/receipt-intake"),
    meta: {
      title: "Purchase Receipt Follow-up",
      subtitle: "Legacy route: continue approved requisitions into guided receipt capture and posting."
    }
  },
  {
    test: (pathname) => pathname.startsWith("/inventory/expenses"),
    meta: {
      title: "Inventory Expenses",
      subtitle: "Cost recognition workspace for inventory and operational activity."
    }
  },
  {
    test: (pathname) => pathname.startsWith("/inventory/suppliers"),
    meta: {
      title: "Vendors",
      subtitle: "Setup registry for supplier/vendor master data used in purchases and receipts."
    }
  },
  {
    test: (pathname) => pathname.startsWith("/inventory/locations"),
    meta: {
      title: "Locations",
      subtitle: "Setup registry for inventory storage and transfer locations."
    }
  },
  {
    test: (pathname) => pathname.startsWith("/inventory"),
    meta: {
      title: "Inventory",
      subtitle: "Track what the project can use, what was used, and key stock flow."
    }
  },
  {
    test: (pathname) => pathname.startsWith("/rigs"),
    meta: {
      title: "Rigs",
      subtitle: "Rig status and profitability visibility across active, idle, maintenance, and breakdown states."
    }
  },
  {
    test: (pathname) => pathname.startsWith("/maintenance"),
    meta: {
      title: "Maintenance",
      subtitle: "Record maintenance activity and follow rig repair progress."
    }
  },
  {
    test: (pathname) => pathname.startsWith("/breakdowns"),
    meta: {
      title: "Breakdowns",
      subtitle: "Report rig breakdowns and track repair follow-up for the project."
    }
  },
  {
    test: (pathname) => pathname.startsWith("/approvals"),
    meta: {
      title: "Approvals",
      subtitle: "Centralized review queue for submitted operational records."
    }
  },
  {
    test: (pathname) => pathname.startsWith("/activity-log"),
    meta: {
      title: "Activity Log",
      subtitle: "Audit trail and operational traceability across modules."
    }
  },
  {
    test: (pathname) => pathname.startsWith("/employees"),
    meta: {
      title: "Employees",
      subtitle: "People directory and workforce assignment visibility."
    }
  }
];

function resolvePageMeta(pathname: string): PageMeta {
  const matched = PAGE_META.find((entry) => entry.test(pathname));
  if (matched) {
    return matched.meta;
  }
  return {
    title: "Operations Workspace",
    subtitle: "GeoFields operational intelligence and workflow execution."
  };
}

function compactTopbarSubtitle(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  const firstSentence = trimmed.split(".")[0]?.trim() || trimmed;
  if (firstSentence.length <= 90) {
    return firstSentence;
  }
  return `${firstSentence.slice(0, 87).trimEnd()}...`;
}

function resolveProjectStatusChip(status: string | null) {
  const normalized = `${status || ""}`.trim().toUpperCase();
  if (normalized === "ACTIVE") {
    return {
      label: "Active",
      toneClass: "text-emerald-800",
      borderClass: "border-emerald-200",
      surfaceClass: "bg-emerald-50",
      dotClass: "bg-emerald-500",
      dotGlowClass: "bg-emerald-400/70"
    };
  }
  if (normalized === "ON_HOLD") {
    return {
      label: "On hold",
      toneClass: "text-red-800",
      borderClass: "border-red-200",
      surfaceClass: "bg-red-50",
      dotClass: "bg-red-500",
      dotGlowClass: "bg-red-400/70"
    };
  }
  if (normalized === "COMPLETED") {
    return {
      label: "Completed",
      toneClass: "text-amber-800",
      borderClass: "border-amber-200",
      surfaceClass: "bg-amber-50",
      dotClass: "bg-amber-500",
      dotGlowClass: "bg-amber-400/70"
    };
  }
  if (normalized === "PLANNED") {
    return {
      label: "Planned",
      toneClass: "text-slate-800",
      borderClass: "border-slate-300",
      surfaceClass: "bg-slate-100",
      dotClass: "bg-slate-500",
      dotGlowClass: "bg-slate-400/70"
    };
  }
  return {
    label: "Planned",
    toneClass: "text-slate-800",
    borderClass: "border-slate-300",
    surfaceClass: "bg-slate-100",
    dotClass: "bg-slate-500",
    dotGlowClass: "bg-slate-400/70"
  };
}

export function Topbar({ sidebarHidden, onToggleSidebar }: TopbarProps) {
  const pathname = usePathname();
  const { user, logout } = useRole();
  const { filters, setFilters, setWorkspaceMode, resetFilters } = useAnalyticsFilters();
  const [projects, setProjects] = useState<ProjectScopeOption[]>([]);
  const [optionsLoaded, setOptionsLoaded] = useState(false);
  const [approvalSummary, setApprovalSummary] = useState<{
    pendingApprovals: number;
    rejectedThisWeek: number;
    approvedToday: number;
  } | null>(null);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 5000);

    async function loadFilterOptions() {
      try {
        const projectsRes = await fetch("/api/projects", { cache: "no-store", signal: controller.signal });
        const projectsPayload = projectsRes.ok ? await projectsRes.json() : { data: [] };

        if (cancelled) {
          return;
        }

        setProjects(
          (projectsPayload.data || []).map(
            (entry: { id: string; name: string; status?: string }) => ({
              id: entry.id,
              name: entry.name,
              status: entry.status || "ACTIVE"
            })
          )
        );
      } catch {
        if (cancelled) {
          return;
        }
        setProjects([]);
      } finally {
        window.clearTimeout(timeoutId);
        if (!cancelled) {
          setOptionsLoaded(true);
        }
      }
    }

    void loadFilterOptions();

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, []);

  useEffect(() => {
    if (!optionsLoaded) {
      return;
    }
    if (filters.projectId === "all") {
      return;
    }
    if (projects.some((project) => project.id === filters.projectId)) {
      return;
    }
    setFilters((current) => ({ ...current, projectId: "all" }));
  }, [filters.projectId, optionsLoaded, projects, setFilters]);

  useEffect(() => {
    if (!user || !canViewApprovalWorkspace(user.role)) {
      setApprovalSummary(null);
      return;
    }

    let isCancelled = false;
    let latestRequestId = 0;

    async function loadApprovalSummary() {
      latestRequestId += 1;
      const requestId = latestRequestId;
      const controller = new AbortController();
      const timeoutId = window.setTimeout(() => controller.abort(), 5000);

      try {
        const response = await fetch("/api/approvals/summary", { cache: "no-store", signal: controller.signal });
        if (!response.ok) {
          return;
        }
        const payload = await response.json();
        if (isCancelled || requestId !== latestRequestId) {
          return;
        }
        setApprovalSummary({
          pendingApprovals: Number(payload.pendingApprovals || 0),
          rejectedThisWeek: Number(payload.rejectedThisWeek || 0),
          approvedToday: Number(payload.approvedToday || 0)
        });
      } catch {
        if (!isCancelled && requestId === latestRequestId) {
          setApprovalSummary(null);
        }
      } finally {
        window.clearTimeout(timeoutId);
      }
    }

    function handleLiveUpdate() {
      void loadApprovalSummary();
    }

    void loadApprovalSummary();
    window.addEventListener("focus", handleLiveUpdate);
    window.addEventListener("gf:profit-updated", handleLiveUpdate);
    window.addEventListener("gf:revenue-updated", handleLiveUpdate);

    return () => {
      isCancelled = true;
      window.removeEventListener("focus", handleLiveUpdate);
      window.removeEventListener("gf:profit-updated", handleLiveUpdate);
      window.removeEventListener("gf:revenue-updated", handleLiveUpdate);
    };
  }, [user]);

  useEffect(() => {
    setMobileFiltersOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }

    if (!mobileFiltersOpen) {
      document.body.style.overflow = "";
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [mobileFiltersOpen]);

  const hasActiveFilters = useMemo(
    () =>
      filters.workspaceMode !== "all-projects" ||
      filters.projectId !== "all" ||
      Boolean(filters.from) ||
      Boolean(filters.to),
    [filters.from, filters.projectId, filters.to, filters.workspaceMode]
  );
  const selectedProjectLabel = useMemo(() => {
    if (filters.projectId === "all") {
      return "All projects";
    }
    return projects.find((project) => project.id === filters.projectId)?.name || "Selected project";
  }, [filters.projectId, projects]);
  const selectedProjectStatus = useMemo(() => {
    if (filters.workspaceMode !== "project" || filters.projectId === "all") {
      return null;
    }
    return projects.find((project) => project.id === filters.projectId)?.status || null;
  }, [filters.projectId, filters.workspaceMode, projects]);
  const selectedProjectStatusChip = useMemo(
    () => (selectedProjectStatus ? resolveProjectStatusChip(selectedProjectStatus) : null),
    [selectedProjectStatus]
  );
  const workspaceModeLabel = WORKSPACE_MODE_LABELS[filters.workspaceMode];
  const dateRangeSummary = useMemo(() => {
    if (!filters.from && !filters.to) {
      return "All dates";
    }
    if (filters.from && filters.to) {
      return `${filters.from} to ${filters.to}`;
    }
    if (filters.from) {
      return `From ${filters.from}`;
    }
    return `Until ${filters.to}`;
  }, [filters.from, filters.to]);
  const isProjectMode = filters.workspaceMode === "project";
  const workspaceModeOptions: Array<{ value: WorkspaceMode; label: string }> = useMemo(
    () => [
      { value: "all-projects", label: "All projects" },
      { value: "project", label: "Project" },
      { value: "workshop", label: "Workshop" }
    ],
    []
  );

  const pageMeta = useMemo(() => resolvePageMeta(pathname), [pathname]);
  const compactSubtitle = useMemo(() => compactTopbarSubtitle(pageMeta.subtitle), [pageMeta.subtitle]);

  return (
    <header className="sticky top-0 z-20 border-b border-slate-200/90 bg-white/95 px-4 py-3 shadow-sm backdrop-blur md:px-6">
      <div className="space-y-3.5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-brand-700">Project-first workspace</p>
            <h1 className="text-xl font-semibold tracking-tight text-ink-900">{pageMeta.title}</h1>
            <p className="text-sm text-slate-600">{compactSubtitle}</p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onToggleSidebar}
              className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-ink-700 hover:bg-slate-50 lg:hidden"
              aria-label="Open navigation menu"
            >
              <PanelLeft size={16} />
            </button>
            <button
              type="button"
              onClick={onToggleSidebar}
              className="hidden items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-ink-700 hover:bg-slate-50 lg:inline-flex"
              aria-label={sidebarHidden ? "Show navigation sidebar" : "Hide navigation sidebar"}
            >
              {sidebarHidden ? <PanelLeft size={14} /> : <PanelLeftClose size={14} />}
              {sidebarHidden ? "Show menu" : "Hide menu"}
            </button>

            {user && (
              <div className="hidden items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-ink-700 sm:flex">
                <div className="min-w-0 text-right">
                  <p className="truncate font-semibold text-ink-900">{user.name}</p>
                  <p className="text-slate-500">{roleLabels[user.role]}</p>
                </div>
                <button
                  type="button"
                  onClick={() => void logout()}
                  className="rounded-lg border border-slate-200 px-2 py-1 text-xs font-medium text-ink-700 hover:bg-slate-50"
                >
                  Logout
                </button>
              </div>
            )}
            {user ? (
              <button
                type="button"
                onClick={() => void logout()}
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-ink-700 hover:bg-slate-50 sm:hidden"
              >
                Logout
              </button>
            ) : null}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-gradient-to-r from-slate-50 to-white px-3 py-3">
          <div className="flex items-start justify-between gap-2 lg:hidden">
            <div className="min-w-0 space-y-1">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Scope</p>
              <p className="truncate text-sm font-medium text-ink-900">
                {workspaceModeLabel} · {isProjectMode ? selectedProjectLabel : "Global"}
              </p>
              <p className="truncate text-xs text-slate-600">{dateRangeSummary}</p>
            </div>
            <button
              type="button"
              onClick={() => setMobileFiltersOpen(true)}
              className="gf-btn-secondary px-3 py-2 text-xs"
            >
              Filters
            </button>
          </div>

          <div className="hidden flex-wrap items-center gap-2.5 lg:flex">
            <label className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-ink-700">
              <Filter size={14} />
              <span className="uppercase tracking-wide text-slate-500">Workspace</span>
              <select
                value={filters.workspaceMode}
                onChange={(event) => setWorkspaceMode(event.target.value as WorkspaceMode)}
                className="min-w-[150px] rounded-lg border border-slate-200 px-2 py-1 text-xs"
              >
                {workspaceModeOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-ink-700">
              <Filter size={14} />
              <span className="uppercase tracking-wide text-slate-500">Project</span>
              <select
                value={isProjectMode ? filters.projectId : "all"}
                onChange={(event) => {
                  const nextProjectId = event.target.value;
                  if (!isProjectMode) {
                    return;
                  }
                  setFilters((current) => ({
                    ...current,
                    projectId: nextProjectId,
                    clientId: nextProjectId === "all" ? current.clientId : "all",
                    rigId: nextProjectId === "all" ? current.rigId : "all"
                  }));
                }}
                disabled={!isProjectMode}
                className="min-w-[170px] rounded-lg border border-slate-200 px-2 py-1 text-xs"
              >
                <option value="all">All projects</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </label>

            <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-ink-700">
              <CalendarDays size={14} />
              <span className="uppercase tracking-wide text-slate-500">Date</span>
              <input
                type="date"
                value={filters.from}
                onChange={(event) => setFilters((current) => ({ ...current, from: event.target.value }))}
                className="rounded-lg border border-slate-200 px-2 py-1 text-xs"
                aria-label="From date"
              />
              <span className="text-slate-500">to</span>
              <input
                type="date"
                value={filters.to}
                onChange={(event) => setFilters((current) => ({ ...current, to: event.target.value }))}
                className="rounded-lg border border-slate-200 px-2 py-1 text-xs"
                aria-label="To date"
              />
            </div>

            {hasActiveFilters && (
              <button
                type="button"
                onClick={resetFilters}
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-ink-700 hover:bg-slate-100"
              >
                Reset scope
              </button>
            )}

            {isProjectMode && filters.projectId !== "all" && selectedProjectStatusChip ? (
              <span
                className={cn(
                  "ml-auto inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold",
                  selectedProjectStatusChip.borderClass,
                  selectedProjectStatusChip.surfaceClass,
                  selectedProjectStatusChip.toneClass
                )}
              >
                <span className={cn("relative inline-flex h-2.5 w-2.5 rounded-full", selectedProjectStatusChip.dotClass)}>
                  <span
                    className={cn(
                      "absolute inset-0 rounded-full blur-[4px] opacity-90",
                      selectedProjectStatusChip.dotGlowClass
                    )}
                  />
                </span>
                {selectedProjectStatusChip.label}
              </span>
            ) : null}
          </div>
          <div className="mt-2.5 flex flex-wrap items-center gap-2 text-xs">
            {filters.workspaceMode === "workshop" ? (
              <>
                <span className="rounded-full border border-slate-300 bg-slate-100 px-2.5 py-0.5 font-semibold text-slate-800">
                  Workshop mode
                </span>
                <span className="rounded-full border border-slate-200 bg-white px-2.5 py-0.5 text-slate-700">
                  Global workshop operations are in focus.
                </span>
              </>
            ) : isProjectMode && filters.projectId !== "all" ? (
              <>
                <span className="rounded-full border border-brand-300 bg-brand-100 px-2.5 py-0.5 font-semibold text-brand-900">
                  Project locked: {selectedProjectLabel}
                </span>
                <span className="rounded-full border border-slate-200 bg-white px-2.5 py-0.5 text-slate-700">
                  All actions stay in this project.
                </span>
              </>
            ) : isProjectMode ? (
              <>
                <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 font-semibold text-amber-900">
                  Project mode
                </span>
                <span className="rounded-full border border-slate-200 bg-white px-2.5 py-0.5 text-slate-700">
                  Select one project to lock this workspace.
                </span>
              </>
            ) : (
              <span className="rounded-full border border-slate-200 bg-white px-2.5 py-0.5 text-slate-700">
                {workspaceModeLabel} mode
              </span>
            )}
          </div>

          {approvalSummary && filters.workspaceMode === "all-projects" && (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
              <span className="rounded-full border border-amber-200 bg-amber-100 px-2.5 py-0.5 font-semibold text-amber-900">
                Pending approvals: {approvalSummary.pendingApprovals}
              </span>
              <span className="rounded-full border border-slate-200 bg-white px-2.5 py-0.5 text-slate-700">
                Rejected this week: {approvalSummary.rejectedThisWeek}
              </span>
              <span className="rounded-full border border-slate-200 bg-white px-2.5 py-0.5 text-slate-700">
                Approved today: {approvalSummary.approvedToday}
              </span>
            </div>
          )}
        </div>
      </div>

      {mobileFiltersOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-slate-900/45 backdrop-blur-[1px]"
            onClick={() => setMobileFiltersOpen(false)}
            aria-label="Close filters"
          />
          <section className="absolute inset-x-0 bottom-0 max-h-[88vh] overflow-hidden rounded-t-2xl border-t border-slate-200 bg-white shadow-[0_-16px_34px_rgba(15,23,42,0.26)]">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <p className="text-sm font-semibold text-ink-900">Scope filters</p>
              <button
                type="button"
                onClick={() => setMobileFiltersOpen(false)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-600"
                aria-label="Close filters panel"
              >
                <X size={15} />
              </button>
            </div>

            <div className="max-h-[calc(88vh-120px)] space-y-3 overflow-y-auto px-4 py-4">
              <label className="grid gap-1 text-xs font-medium text-ink-700">
                <span className="uppercase tracking-wide text-slate-500">Workspace</span>
                <select
                  value={filters.workspaceMode}
                  onChange={(event) => setWorkspaceMode(event.target.value as WorkspaceMode)}
                  className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
                >
                  {workspaceModeOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="grid gap-1 text-xs font-medium text-ink-700">
                <span className="uppercase tracking-wide text-slate-500">Project</span>
                <select
                  value={isProjectMode ? filters.projectId : "all"}
                  onChange={(event) => {
                    const nextProjectId = event.target.value;
                    if (!isProjectMode) {
                      return;
                    }
                    setFilters((current) => ({
                      ...current,
                      projectId: nextProjectId,
                      clientId: nextProjectId === "all" ? current.clientId : "all",
                      rigId: nextProjectId === "all" ? current.rigId : "all"
                    }));
                  }}
                  disabled={!isProjectMode}
                  className="rounded-lg border border-slate-200 px-3 py-2 text-sm disabled:opacity-60"
                >
                  <option value="all">All projects</option>
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
                </select>
              </label>

              <div className="grid gap-2">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Date range</p>
                <label className="grid gap-1 text-xs font-medium text-ink-700">
                  <span>From</span>
                  <input
                    type="date"
                    value={filters.from}
                    onChange={(event) => setFilters((current) => ({ ...current, from: event.target.value }))}
                    className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
                    aria-label="From date"
                  />
                </label>
                <label className="grid gap-1 text-xs font-medium text-ink-700">
                  <span>To</span>
                  <input
                    type="date"
                    value={filters.to}
                    onChange={(event) => setFilters((current) => ({ ...current, to: event.target.value }))}
                    className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
                    aria-label="To date"
                  />
                </label>
              </div>
            </div>

            <div className="flex items-center justify-between gap-2 border-t border-slate-200 px-4 py-3">
              <button
                type="button"
                onClick={() => {
                  resetFilters();
                  setMobileFiltersOpen(false);
                }}
                className="gf-btn-secondary px-3 py-2 text-xs"
              >
                Reset scope
              </button>
              <button
                type="button"
                onClick={() => setMobileFiltersOpen(false)}
                className="gf-btn-primary px-3 py-2 text-xs"
              >
                Done
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </header>
  );
}
