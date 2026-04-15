"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { CalendarDays, PanelLeft, PanelLeftClose, X } from "lucide-react";

import { roleLabels } from "@/lib/auth/roles";
import { useAnalyticsFilters } from "@/components/layout/analytics-filters-provider";
import { useRole } from "@/components/layout/role-provider";
import { cn } from "@/lib/utils";
import { WORKSPACE_MODE_LABELS } from "@/lib/workspace-mode";
import { isWorkspaceLaunchEnabled } from "@/lib/feature-flags";

interface TopbarProps {
  sidebarHidden: boolean;
  onToggleSidebar: () => void;
  onOpenWorkspaceLaunch?: () => void;
}

interface PageMeta {
  title: string;
}

interface ProjectScopeOption {
  id: string;
  name: string;
  status: string;
  clientId: string | null;
}

const PAGE_META: Array<{ test: (pathname: string) => boolean; meta: PageMeta }> = [
  {
    test: (pathname) => pathname === "/",
    meta: {
      title: "Dashboard"
    }
  },
  {
    test: (pathname) => pathname.startsWith("/executive-overview"),
    meta: {
      title: "Executive Overview"
    }
  },
  {
    test: (pathname) => pathname.startsWith("/alerts-center"),
    meta: {
      title: "Alerts Center"
    }
  },
  {
    test: (pathname) => pathname.startsWith("/data-quality/linkage-center"),
    meta: {
      title: "Data Quality / Linkage Center"
    }
  },
  {
    test: (pathname) => pathname.startsWith("/clients"),
    meta: {
      title: "Clients"
    }
  },
  {
    test: (pathname) => pathname.startsWith("/projects"),
    meta: {
      title: "Projects"
    }
  },
  {
    test: (pathname) => pathname.startsWith("/drilling-reports"),
    meta: {
      title: "Drilling Reports"
    }
  },
  {
    test: (pathname) => pathname.startsWith("/spending/profit"),
    meta: {
      title: "Project Operations / Profit"
    }
  },
  {
    test: (pathname) => pathname.startsWith("/spending/drilling-reports"),
    meta: {
      title: "Project Operations / Drilling Reports"
    }
  },
  {
    test: (pathname) => pathname.startsWith("/spending"),
    meta: {
      title: "Project Operations"
    }
  },
  {
    test: (pathname) => pathname.startsWith("/expenses"),
    meta: {
      title: "Purchase Requests"
    }
  },
  {
    test: (pathname) => pathname.startsWith("/purchasing/receipt-follow-up"),
    meta: {
      title: "Purchase Receipt Follow-up"
    }
  },
  {
    test: (pathname) => pathname.startsWith("/forecasting"),
    meta: {
      title: "Forecasting"
    }
  },
  {
    test: (pathname) => pathname.startsWith("/inventory/receipt-intake"),
    meta: {
      title: "Purchase Receipt Follow-up"
    }
  },
  {
    test: (pathname) => pathname.startsWith("/inventory/expenses"),
    meta: {
      title: "Inventory Expenses"
    }
  },
  {
    test: (pathname) => pathname.startsWith("/inventory/suppliers"),
    meta: {
      title: "Vendors"
    }
  },
  {
    test: (pathname) => pathname.startsWith("/inventory/locations"),
    meta: {
      title: "Locations"
    }
  },
  {
    test: (pathname) => pathname.startsWith("/inventory"),
    meta: {
      title: "Inventory"
    }
  },
  {
    test: (pathname) => pathname.startsWith("/rigs"),
    meta: {
      title: "Rigs"
    }
  },
  {
    test: (pathname) => pathname.startsWith("/maintenance"),
    meta: {
      title: "Maintenance"
    }
  },
  {
    test: (pathname) => pathname.startsWith("/breakdowns"),
    meta: {
      title: "Breakdowns"
    }
  },
  {
    test: (pathname) => pathname.startsWith("/approvals"),
    meta: {
      title: "Approvals"
    }
  },
  {
    test: (pathname) => pathname.startsWith("/activity-log"),
    meta: {
      title: "Activity Log"
    }
  },
  {
    test: (pathname) => pathname.startsWith("/employees"),
    meta: {
      title: "Employees"
    }
  }
];

function resolvePageMeta(pathname: string): PageMeta {
  const matched = PAGE_META.find((entry) => entry.test(pathname));
  if (matched) {
    return matched.meta;
  }
  return {
    title: "Operations Workspace"
  };
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

function isInteractiveGestureTarget(target: EventTarget | null) {
  const element = target as Element | null;
  if (!element) {
    return false;
  }
  return Boolean(element.closest("input, textarea, select, button, a, [contenteditable='true']"));
}

function isWorkspaceScrollAtTop() {
  if (typeof document === "undefined") {
    return true;
  }
  const scrollHost = document.getElementById("gf-app-main-scroll");
  if (scrollHost) {
    return scrollHost.scrollTop <= 6;
  }
  return window.scrollY <= 6;
}

export function Topbar({ sidebarHidden, onToggleSidebar, onOpenWorkspaceLaunch }: TopbarProps) {
  const pathname = usePathname();
  const { user, logout } = useRole();
  const { filters, setFilters } = useAnalyticsFilters();
  const [projects, setProjects] = useState<ProjectScopeOption[]>([]);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [desktopDateFiltersOpen, setDesktopDateFiltersOpen] = useState(false);
  const topbarRef = useRef<HTMLElement | null>(null);
  const desktopDateFiltersRef = useRef<HTMLDivElement | null>(null);
  const lastGlobeScrollTriggerAt = useRef(0);
  const topbarWheelIntentAccumulator = useRef(0);
  const topbarWheelIntentResetTimeout = useRef<number | null>(null);
  const topbarTouchStartY = useRef<number | null>(null);

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
            (entry: {
              id: string;
              name: string;
              status?: string;
              client?: { id?: string };
            }) => ({
              id: entry.id,
              name: entry.name,
              status: entry.status || "ACTIVE",
              clientId: typeof entry.client?.id === "string" ? entry.client.id : null
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
    setMobileFiltersOpen(false);
    setDesktopDateFiltersOpen(false);
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

  useEffect(() => {
    if (!desktopDateFiltersOpen || typeof document === "undefined") {
      return;
    }

    function handleOutsideClick(event: MouseEvent) {
      const target = event.target as Node | null;
      if (!target || !desktopDateFiltersRef.current?.contains(target)) {
        setDesktopDateFiltersOpen(false);
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setDesktopDateFiltersOpen(false);
      }
    }

    document.addEventListener("mousedown", handleOutsideClick);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [desktopDateFiltersOpen]);

  const selectedProjectLabel = useMemo(() => {
    if (filters.projectId === "all") {
      return "All projects";
    }
    return projects.find((project) => project.id === filters.projectId)?.name || filters.projectId;
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

  const pageMeta = useMemo(() => resolvePageMeta(pathname), [pathname]);
  const workspaceLaunchEnabled = isWorkspaceLaunchEnabled();
  const modeChipLabel = useMemo(() => {
    if (filters.workspaceMode === "workshop") {
      return "Workshop mode";
    }
    if (isProjectMode && filters.projectId !== "all") {
      return `Project locked: ${selectedProjectLabel}`;
    }
    if (isProjectMode) {
      return "Project mode";
    }
    return `${workspaceModeLabel} mode`;
  }, [filters.workspaceMode, filters.projectId, isProjectMode, selectedProjectLabel, workspaceModeLabel]);
  const triggerOpenLaunch = useCallback(() => {
    if (!workspaceLaunchEnabled) {
      return;
    }
    onOpenWorkspaceLaunch?.();
  }, [onOpenWorkspaceLaunch, workspaceLaunchEnabled]);

  const handleTopbarWheel = useCallback(
    (event: React.WheelEvent<HTMLElement>) => {
      if (!workspaceLaunchEnabled || pathname.startsWith("/workspace-launch")) {
        return;
      }
      if (desktopDateFiltersOpen || mobileFiltersOpen) {
        return;
      }
      if (!isWorkspaceScrollAtTop()) {
        return;
      }
      if (isInteractiveGestureTarget(event.target)) {
        return;
      }
      if (event.deltaY >= 0) {
        topbarWheelIntentAccumulator.current = 0;
        if (topbarWheelIntentResetTimeout.current !== null) {
          window.clearTimeout(topbarWheelIntentResetTimeout.current);
          topbarWheelIntentResetTimeout.current = null;
        }
        return;
      }

      topbarWheelIntentAccumulator.current += Math.abs(event.deltaY);
      if (topbarWheelIntentResetTimeout.current !== null) {
        window.clearTimeout(topbarWheelIntentResetTimeout.current);
      }
      topbarWheelIntentResetTimeout.current = window.setTimeout(() => {
        topbarWheelIntentAccumulator.current = 0;
        topbarWheelIntentResetTimeout.current = null;
      }, 220);

      if (topbarWheelIntentAccumulator.current < 110) {
        return;
      }

      topbarWheelIntentAccumulator.current = 0;
      const now = Date.now();
      if (now - lastGlobeScrollTriggerAt.current < 1200) {
        return;
      }
      lastGlobeScrollTriggerAt.current = now;
      triggerOpenLaunch();
    },
    [desktopDateFiltersOpen, mobileFiltersOpen, pathname, triggerOpenLaunch, workspaceLaunchEnabled]
  );

  const handleTopbarTouchStart = useCallback(
    (event: React.TouchEvent<HTMLElement>) => {
      if (!workspaceLaunchEnabled || pathname.startsWith("/workspace-launch")) {
        return;
      }
      topbarTouchStartY.current = event.touches[0]?.clientY ?? null;
    },
    [pathname, workspaceLaunchEnabled]
  );

  const handleTopbarTouchEnd = useCallback(
    (event: React.TouchEvent<HTMLElement>) => {
      if (!workspaceLaunchEnabled || pathname.startsWith("/workspace-launch")) {
        return;
      }
      if (desktopDateFiltersOpen || mobileFiltersOpen) {
        return;
      }
      const startY = topbarTouchStartY.current;
      topbarTouchStartY.current = null;
      if (startY === null) {
        return;
      }
      const endY = event.changedTouches[0]?.clientY ?? startY;
      const swipeDistance = endY - startY;
      if (swipeDistance < 70 || !isWorkspaceScrollAtTop()) {
        return;
      }
      if (isInteractiveGestureTarget(event.target)) {
        return;
      }
      const now = Date.now();
      if (now - lastGlobeScrollTriggerAt.current < 1200) {
        return;
      }
      lastGlobeScrollTriggerAt.current = now;
      triggerOpenLaunch();
    },
    [desktopDateFiltersOpen, mobileFiltersOpen, pathname, triggerOpenLaunch, workspaceLaunchEnabled]
  );

  useEffect(() => {
    return () => {
      if (topbarWheelIntentResetTimeout.current !== null) {
        window.clearTimeout(topbarWheelIntentResetTimeout.current);
      }
    };
  }, []);

  return (
    <header
      ref={topbarRef}
      onWheel={handleTopbarWheel}
      onTouchStart={handleTopbarTouchStart}
      onTouchEnd={handleTopbarTouchEnd}
      className="sticky top-0 z-20 border-b border-slate-200/90 bg-white/95 px-4 py-2.5 shadow-sm backdrop-blur md:px-6"
    >
      <div className="space-y-2.5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold tracking-tight text-ink-900">{pageMeta.title}</h1>
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
            {workspaceLaunchEnabled ? (
              <button
                type="button"
                onClick={triggerOpenLaunch}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-ink-700 hover:bg-slate-50"
              >
                Globe view
              </button>
            ) : null}

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

        <div className="rounded-2xl border border-slate-200 bg-gradient-to-r from-slate-50 to-white px-3 py-2.5">
          <div className="flex items-start justify-between gap-2 lg:hidden">
            <div className="min-w-0 space-y-0.5">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Date</p>
              <p className="truncate text-sm font-medium text-ink-900">{dateRangeSummary}</p>
            </div>
            <button
              type="button"
              onClick={() => setMobileFiltersOpen(true)}
              className="gf-btn-secondary px-3 py-2 text-xs"
            >
              Date
            </button>
          </div>

          <div className="hidden flex-wrap items-center gap-2 lg:flex">
            <div className="relative" ref={desktopDateFiltersRef}>
              <button
                type="button"
                onClick={() => setDesktopDateFiltersOpen((current) => !current)}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-ink-700 hover:bg-slate-50"
                aria-haspopup="dialog"
                aria-expanded={desktopDateFiltersOpen}
                aria-label="Open date range filters"
              >
                <CalendarDays size={14} />
                <span className="uppercase tracking-wide text-slate-500">Date</span>
              </button>
              {desktopDateFiltersOpen ? (
                <section
                  role="dialog"
                  aria-label="Date range filters"
                  className="absolute right-0 z-30 mt-2 w-[290px] rounded-xl border border-slate-200 bg-white p-3 shadow-[0_12px_30px_rgba(15,23,42,0.15)]"
                >
                  <div className="grid gap-2">
                    <label className="grid gap-1 text-xs font-medium text-ink-700">
                      <span>From</span>
                      <input
                        type="date"
                        value={filters.from}
                        onChange={(event) => setFilters((current) => ({ ...current, from: event.target.value }))}
                        className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs"
                        aria-label="From date"
                      />
                    </label>
                    <label className="grid gap-1 text-xs font-medium text-ink-700">
                      <span>To</span>
                      <input
                        type="date"
                        value={filters.to}
                        onChange={(event) => setFilters((current) => ({ ...current, to: event.target.value }))}
                        className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs"
                        aria-label="To date"
                      />
                    </label>
                  </div>
                  <div className="mt-3 flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => setFilters((current) => ({ ...current, from: "", to: "" }))}
                      className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-ink-700 hover:bg-slate-50"
                    >
                      Clear
                    </button>
                    <button
                      type="button"
                      onClick={() => setDesktopDateFiltersOpen(false)}
                      className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-ink-700 hover:bg-slate-50"
                    >
                      Done
                    </button>
                  </div>
                </section>
              ) : null}
            </div>

            {isProjectMode && filters.projectId !== "all" && selectedProjectStatusChip ? (
              <span
                className={cn(
                  "ml-auto inline-flex items-center gap-2 rounded-xl border px-3 py-1.5 text-xs font-semibold",
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
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
            <span
              className={cn(
                "rounded-full px-2.5 py-0.5",
                filters.workspaceMode === "workshop"
                  ? "border border-slate-300 bg-slate-100 font-semibold text-slate-800"
                  : isProjectMode && filters.projectId !== "all"
                    ? "border border-brand-300 bg-brand-100 font-semibold text-brand-900"
                    : isProjectMode
                      ? "border border-amber-200 bg-amber-50 font-semibold text-amber-900"
                      : "border border-slate-200 bg-white text-slate-700"
              )}
            >
              {modeChipLabel}
            </span>
          </div>
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
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2.5">
              <p className="text-sm font-semibold text-ink-900">Date range</p>
              <button
                type="button"
                onClick={() => setMobileFiltersOpen(false)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-600"
                aria-label="Close filters panel"
              >
                <X size={15} />
              </button>
            </div>

            <div className="max-h-[calc(88vh-120px)] space-y-2.5 overflow-y-auto px-4 py-3.5">
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

            <div className="flex items-center justify-between gap-2 border-t border-slate-200 px-4 py-2.5">
              <button
                type="button"
                onClick={() => {
                  setFilters((current) => ({ ...current, from: "", to: "" }));
                }}
                className="gf-btn-secondary px-3 py-2 text-xs"
              >
                Clear
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
