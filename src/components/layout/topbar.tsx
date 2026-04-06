"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { CalendarDays, Filter, PanelLeft, PanelLeftClose } from "lucide-react";

import { roleLabels } from "@/lib/auth/roles";
import { canViewApprovalWorkspace } from "@/lib/auth/approval-policy";
import { useAnalyticsFilters } from "@/components/layout/analytics-filters-provider";
import { useRole } from "@/components/layout/role-provider";

interface TopbarProps {
  sidebarHidden: boolean;
  onToggleSidebar: () => void;
}

interface PageMeta {
  title: string;
  subtitle: string;
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
      subtitle: "Operational reporting workspace for drilling output and daily progress."
    }
  },
  {
    test: (pathname) => pathname.startsWith("/revenue"),
    meta: {
      title: "Revenue",
      subtitle: "Live revenue analytics by client, project, and rig."
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
    test: (pathname) => pathname.startsWith("/cost-tracking"),
    meta: {
      title: "Cost Tracking",
      subtitle: "Manager cost workspace for recognized spend across rigs, projects, and maintenance."
    }
  },
  {
    test: (pathname) => pathname.startsWith("/profit"),
    meta: {
      title: "Profit",
      subtitle: "Profitability, margin insights, and performance drivers."
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
      subtitle: "Stock, movement, supplier, and data quality management."
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
      subtitle: "Breakdown and repair workflow linked to rig status, downtime, and active projects."
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

export function Topbar({ sidebarHidden, onToggleSidebar }: TopbarProps) {
  const pathname = usePathname();
  const { user, logout } = useRole();
  const { filters, setFilters, resetFilters } = useAnalyticsFilters();
  const [clients, setClients] = useState<Array<{ id: string; name: string }>>([]);
  const [rigs, setRigs] = useState<Array<{ id: string; name: string }>>([]);
  const [optionsLoaded, setOptionsLoaded] = useState(false);
  const [approvalSummary, setApprovalSummary] = useState<{
    pendingApprovals: number;
    rejectedThisWeek: number;
    approvedToday: number;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 5000);

    async function loadFilterOptions() {
      try {
        const [clientsRes, rigsRes] = await Promise.all([
          fetch("/api/clients", { cache: "no-store", signal: controller.signal }),
          fetch("/api/rigs", { cache: "no-store", signal: controller.signal })
        ]);

        const clientsPayload = clientsRes.ok ? await clientsRes.json() : { data: [] };
        const rigsPayload = rigsRes.ok ? await rigsRes.json() : { data: [] };

        if (cancelled) {
          return;
        }

        setClients((clientsPayload.data || []).map((entry: { id: string; name: string }) => ({ id: entry.id, name: entry.name })));
        setRigs(
          (rigsPayload.data || []).map((entry: { id: string; rigCode?: string; name?: string }) => ({
            id: entry.id,
            name: entry.name || entry.rigCode || "Unnamed Rig"
          }))
        );
      } catch {
        if (cancelled) {
          return;
        }
        setClients([]);
        setRigs([]);
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
    if (filters.clientId === "all") {
      return;
    }
    if (clients.some((client) => client.id === filters.clientId)) {
      return;
    }
    setFilters((current) => ({ ...current, clientId: "all" }));
  }, [clients, filters.clientId, optionsLoaded, setFilters]);

  useEffect(() => {
    if (!optionsLoaded) {
      return;
    }
    if (filters.rigId === "all") {
      return;
    }
    if (rigs.some((rig) => rig.id === filters.rigId)) {
      return;
    }
    setFilters((current) => ({ ...current, rigId: "all" }));
  }, [filters.rigId, optionsLoaded, rigs, setFilters]);

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

  const hasActiveFilters = useMemo(
    () => filters.clientId !== "all" || filters.rigId !== "all" || Boolean(filters.from) || Boolean(filters.to),
    [filters.clientId, filters.from, filters.rigId, filters.to]
  );

  const pageMeta = useMemo(() => resolvePageMeta(pathname), [pathname]);

  return (
    <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 px-4 py-3 shadow-sm backdrop-blur md:px-6">
      <div className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-brand-700">GeoFields Operations Dashboard</p>
            <h1 className="text-xl font-semibold tracking-tight text-ink-900">{pageMeta.title}</h1>
            <p className="text-sm text-slate-600">{pageMeta.subtitle}</p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onToggleSidebar}
              className="hidden items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-ink-700 hover:bg-slate-50 lg:inline-flex"
              aria-label={sidebarHidden ? "Show navigation sidebar" : "Hide navigation sidebar"}
            >
              {sidebarHidden ? <PanelLeft size={14} /> : <PanelLeftClose size={14} />}
              {sidebarHidden ? "Show menu" : "Hide menu"}
            </button>

            {user && (
              <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-ink-700">
                <div className="text-right">
                  <p className="font-semibold text-ink-900">{user.name}</p>
                  <p className="text-slate-500">{roleLabels[user.role]}</p>
                </div>
                <button
                  type="button"
                  onClick={() => void logout()}
                  className="rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-ink-700 hover:bg-slate-50"
                >
                  Logout
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-ink-700">
              <Filter size={14} />
              <span>Client</span>
              <select
                value={filters.clientId}
                onChange={(event) => setFilters((current) => ({ ...current, clientId: event.target.value }))}
                className="min-w-[150px] rounded-md border border-slate-200 px-2 py-1 text-xs"
              >
                <option value="all">All clients</option>
                {clients.map((client) => (
                  <option key={client.id} value={client.id}>
                    {client.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-ink-700">
              <span>Rig</span>
              <select
                value={filters.rigId}
                onChange={(event) => setFilters((current) => ({ ...current, rigId: event.target.value }))}
                className="min-w-[130px] rounded-md border border-slate-200 px-2 py-1 text-xs"
              >
                <option value="all">All rigs</option>
                {rigs.map((rig) => (
                  <option key={rig.id} value={rig.id}>
                    {rig.name}
                  </option>
                ))}
              </select>
            </label>

            <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-ink-700">
              <CalendarDays size={14} />
              <span>Date</span>
              <input
                type="date"
                value={filters.from}
                onChange={(event) => setFilters((current) => ({ ...current, from: event.target.value }))}
                className="rounded-md border border-slate-200 px-2 py-1 text-xs"
                aria-label="From date"
              />
              <span className="text-slate-500">to</span>
              <input
                type="date"
                value={filters.to}
                onChange={(event) => setFilters((current) => ({ ...current, to: event.target.value }))}
                className="rounded-md border border-slate-200 px-2 py-1 text-xs"
                aria-label="To date"
              />
            </div>

            {hasActiveFilters && (
              <button
                type="button"
                onClick={resetFilters}
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-ink-700 hover:bg-slate-100"
              >
                Clear filters
              </button>
            )}
          </div>

          {approvalSummary && (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
              <span className="rounded-full border border-amber-200 bg-amber-100 px-2 py-0.5 font-semibold text-amber-900">
                Pending approvals: {approvalSummary.pendingApprovals}
              </span>
              <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-slate-700">
                Rejected this week: {approvalSummary.rejectedThisWeek}
              </span>
              <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-slate-700">
                Approved today: {approvalSummary.approvedToday}
              </span>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
