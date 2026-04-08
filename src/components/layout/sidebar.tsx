"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  Boxes,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Drill,
  Factory,
  Gauge,
  HardHat,
  LayoutDashboard,
  Settings,
  Wrench
} from "lucide-react";

import { canAccess } from "@/lib/auth/permissions";
import { inventoryNavChildren, navItems, setupNavChildren } from "@/lib/navigation";
import { cn } from "@/lib/utils";
import { useRole } from "@/components/layout/role-provider";

const iconMap: Record<string, typeof LayoutDashboard> = {
  Dashboard: LayoutDashboard,
  Clients: Factory,
  Projects: ClipboardList,
  "Drilling Reports": Drill,
  Breakdowns: Drill,
  Spending: BarChart3,
  Approvals: ClipboardList,
  "Purchase Requests": Gauge,
  Inventory: Boxes,
  "Inventory Overview": Boxes,
  Items: Boxes,
  "Stock Movements": ClipboardList,
  Issues: ClipboardList,
  Vendors: Factory,
  Locations: Factory,
  "Activity Log": ClipboardList,
  Rigs: HardHat,
  Employees: Settings,
  Maintenance: Wrench
};

const NAV_ICON_SIZE = 15;
const NAV_ICON_STROKE = 1.9;

const navGroups: Array<{ title: string; labels: string[] }> = [
  {
    title: "Core Workflow",
    labels: [
      "Dashboard",
      "Projects",
      "Purchase Requests",
      "Clients",
      "Employees",
      "Rigs",
      "Drilling Reports",
      "Breakdowns",
      "Maintenance",
      "Inventory",
      "Approvals"
    ]
  },
  {
    title: "Profitability",
    labels: ["Spending"]
  },
  {
    title: "System",
    labels: ["Activity Log"]
  }
];

export function Sidebar({ sidebarHidden }: { sidebarHidden: boolean }) {
  const pathname = usePathname();
  const { role, loading } = useRole();
  const [inventoryExpanded, setInventoryExpanded] = useState(false);
  const [setupExpanded, setSetupExpanded] = useState(false);

  const visibleNavItems = useMemo(
    () => (role ? navItems.filter((item) => canAccess(role, item.permission)) : []),
    [role]
  );
  const visibleInventoryChildren = useMemo(
    () => (role ? inventoryNavChildren.filter((item) => canAccess(role, item.permission)) : []),
    [role]
  );
  const visibleSetupChildren = useMemo(
    () => (role ? setupNavChildren.filter((item) => canAccess(role, item.permission)) : []),
    [role]
  );
  const visibleNavByLabel = useMemo(
    () => new Map(visibleNavItems.map((item) => [item.label, item])),
    [visibleNavItems]
  );

  const inventoryRouteActive =
    pathname === "/inventory" ||
    pathname.startsWith("/inventory/items") ||
    pathname.startsWith("/inventory/stock-movements") ||
    pathname.startsWith("/inventory/expenses") ||
    pathname.startsWith("/inventory/issues");
  const activeInventoryChildHref = resolveActiveInventoryChildHref({
    pathname,
    children: visibleInventoryChildren
  });
  const setupRouteActive =
    pathname.startsWith("/rigs/setup") ||
    pathname.startsWith("/projects/setup") ||
    pathname.startsWith("/clients/setup") ||
    pathname.startsWith("/employees/setup") ||
    pathname.startsWith("/inventory/suppliers") ||
    pathname.startsWith("/inventory/locations");
  const activeSetupChildHref = resolveActiveSetupChildHref({
    pathname,
    children: visibleSetupChildren
  });

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const saved = window.localStorage.getItem("geofields.inventorySidebarExpanded");
    if (saved === "1") {
      setInventoryExpanded(true);
      return;
    }
    if (saved === "0") {
      setInventoryExpanded(false);
      return;
    }
    setInventoryExpanded(false);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const saved = window.localStorage.getItem("geofields.setupSidebarExpanded");
    if (saved === "1") {
      setSetupExpanded(true);
      return;
    }
    if (saved === "0") {
      setSetupExpanded(false);
      return;
    }
    setSetupExpanded(false);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem("geofields.inventorySidebarExpanded", inventoryExpanded ? "1" : "0");
  }, [inventoryExpanded]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem("geofields.setupSidebarExpanded", setupExpanded ? "1" : "0");
  }, [setupExpanded]);

  return (
    <aside
      className={cn(
        "w-full border-b border-slate-200 bg-white/95 lg:sticky lg:top-0 lg:h-full lg:shrink-0 lg:border-b-0 lg:border-r lg:transition-all lg:duration-200",
        sidebarHidden ? "lg:w-0 lg:border-r-0 lg:opacity-0 lg:pointer-events-none lg:overflow-hidden" : "lg:w-72 lg:opacity-100"
      )}
    >
      <div className={cn("flex flex-col lg:h-full", sidebarHidden && "lg:hidden")}>
        <div className="border-b border-slate-200 px-5 py-5">
          <p className="font-display text-xl text-ink-900">GeoFields</p>
          <p className="text-sm text-slate-600">Drilling Profitability</p>
        </div>

        <nav className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3">
          {loading && (
            <div className="space-y-2 px-1 py-1">
              <p className="px-3 py-1 text-sm text-slate-600">Loading menu...</p>
              {Array.from({ length: 6 }).map((_, index) => (
                <div key={`menu-loading-${index}`} className="h-8 w-full animate-pulse rounded-lg bg-slate-100" />
              ))}
            </div>
          )}

          {!loading &&
            navGroups.map((group) => {
              const groupItems = group.labels
                .map((label) => visibleNavByLabel.get(label))
                .filter((item): item is NonNullable<typeof item> => Boolean(item));

              if (groupItems.length === 0) {
                return null;
              }

              return (
                <div key={group.title} className="space-y-1">
                  <p className="px-3 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    {group.title}
                  </p>
                  <div className="space-y-0.5">
                    {groupItems.map((item, index) => {
                      const currentSegment =
                        group.title === "Core Workflow"
                          ? resolveCoreWorkflowSegment(item.label)
                          : "secondary";
                      const previousSegment =
                        group.title === "Core Workflow" && index > 0
                          ? resolveCoreWorkflowSegment(groupItems[index - 1]?.label || "")
                          : currentSegment;
                      const startsSegment =
                        group.title === "Core Workflow" &&
                        index > 0 &&
                        currentSegment !== previousSegment;
                      const wrapperClass = startsSegment
                        ? "mt-1.5 border-t border-slate-200/70 pt-1.5"
                        : "";

                      if (item.label === "Inventory") {
                        return (
                          <div key={item.href} className={cn("space-y-1", wrapperClass)}>
                            <button
                              type="button"
                              onClick={() => setInventoryExpanded((current) => !current)}
                              className={cn(
                                "flex w-full items-center justify-between rounded-lg px-3 py-1.5 text-sm transition-all duration-200 ease-out hover:-translate-y-[1px]",
                                inventoryRouteActive
                                  ? "border border-brand-200 bg-brand-50 text-brand-900 shadow-sm"
                                  : "border border-transparent text-ink-700 hover:bg-slate-100"
                              )}
                            >
                              <span className="flex items-center gap-2">
                                <Boxes size={NAV_ICON_SIZE} strokeWidth={NAV_ICON_STROKE} />
                                {item.label}
                              </span>
                              {inventoryExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                            </button>
                            <div
                              className={cn(
                                "grid transition-[grid-template-rows,opacity] duration-300 ease-out",
                                inventoryExpanded ? "mt-1 grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
                              )}
                            >
                              <div className="overflow-hidden">
                                <div className="ml-4 space-y-0.5 border-l border-slate-200/90 pl-2.5">
                                  {visibleInventoryChildren.map((child) => {
                                    const isActive = child.href === activeInventoryChildHref;
                                    return (
                                      <Link
                                        key={child.href}
                                        href={child.href}
                                        className={cn(
                                          "flex items-center gap-2 rounded-md px-2.5 py-1 text-[13px] transition-all duration-200 ease-out hover:translate-x-[1px]",
                                          isActive
                                            ? "bg-brand-100/80 font-medium text-brand-900 shadow-sm"
                                            : "text-ink-700 hover:bg-slate-100"
                                        )}
                                      >
                                        <span
                                          className={cn(
                                            "h-1.5 w-1.5 rounded-full",
                                            isActive ? "bg-brand-700" : "bg-slate-300"
                                          )}
                                        />
                                        {child.label}
                                      </Link>
                                    );
                                  })}
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      }

                      const Icon = iconMap[item.label] || LayoutDashboard;
                      const isDashboardEntry = item.label === "Dashboard";
                      const purchaseRequestsAliasActive =
                        item.href === "/expenses" &&
                        (pathname.startsWith("/purchasing/receipt-follow-up") ||
                          pathname.startsWith("/inventory/receipt-intake"));
                      const rigSetupAliasActive =
                        item.href === "/rigs" && pathname.startsWith("/rigs/setup");
                      const projectSetupAliasActive =
                        item.href === "/projects" && pathname.startsWith("/projects/setup");
                      const clientSetupAliasActive =
                        item.href === "/clients" && pathname.startsWith("/clients/setup");
                      const employeeSetupAliasActive =
                        item.href === "/employees" && pathname.startsWith("/employees/setup");
                      const isActive =
                        purchaseRequestsAliasActive ||
                        pathname === item.href ||
                        (item.href !== "/" &&
                          pathname.startsWith(`${item.href}/`) &&
                          !rigSetupAliasActive &&
                          !projectSetupAliasActive &&
                          !clientSetupAliasActive &&
                          !employeeSetupAliasActive);
                      return (
                        <div key={item.href} className={wrapperClass}>
                          <Link
                            href={item.href}
                            className={cn(
                              "flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm transition-all duration-200 ease-out",
                              isActive
                                ? "bg-brand-100 text-brand-900 shadow-sm"
                                : "text-ink-700 hover:translate-x-[1px] hover:bg-slate-100",
                              isDashboardEntry &&
                                !isActive &&
                                "border border-slate-200/80 bg-slate-50/80 font-medium text-ink-800"
                            )}
                          >
                            <Icon size={NAV_ICON_SIZE} strokeWidth={NAV_ICON_STROKE} />
                            {item.label}
                          </Link>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}

          {!loading && visibleSetupChildren.length > 0 ? (
            <div className="space-y-1">
              <p className="px-3 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Setup</p>
              <div className="space-y-0.5">
                <div className="space-y-0.5">
                  <button
                    type="button"
                    onClick={() => setSetupExpanded((current) => !current)}
                    className={cn(
                      "flex w-full items-center justify-between rounded-lg px-3 py-1.5 text-sm transition-all duration-200 ease-out hover:-translate-y-[1px]",
                      setupRouteActive
                        ? "border border-brand-200 bg-brand-50 text-brand-900 shadow-sm"
                        : "border border-transparent text-ink-700 hover:bg-slate-100"
                    )}
                  >
                    <span className="flex items-center gap-2">
                      <Settings size={NAV_ICON_SIZE} strokeWidth={NAV_ICON_STROKE} />
                      Setup
                    </span>
                    {setupExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  </button>
                  <div
                    className={cn(
                      "grid transition-[grid-template-rows,opacity] duration-300 ease-out",
                      setupExpanded ? "mt-1 grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
                    )}
                  >
                    <div className="overflow-hidden">
                      <div className="ml-4 space-y-0.5 border-l border-slate-200/90 pl-2.5">
                        {visibleSetupChildren.map((child) => {
                          const isActive = child.href === activeSetupChildHref;
                          return (
                            <Link
                              key={child.href}
                              href={child.href}
                              className={cn(
                                "flex items-center gap-2 rounded-md px-2.5 py-1 text-[13px] transition-all duration-200 ease-out hover:translate-x-[1px]",
                                isActive
                                  ? "bg-brand-100/80 font-medium text-brand-900 shadow-sm"
                                  : "text-ink-700 hover:bg-slate-100"
                              )}
                            >
                              <span
                                className={cn(
                                  "h-1.5 w-1.5 rounded-full",
                                  isActive ? "bg-brand-700" : "bg-slate-300"
                                )}
                              />
                              {child.label}
                            </Link>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : null}
        </nav>
      </div>
    </aside>
  );
}

function resolveCoreWorkflowSegment(label: string): "primary" | "secondary" | "operational" {
  if (label === "Dashboard") {
    return "primary";
  }
  if (
    label === "Drilling Reports" ||
    label === "Breakdowns" ||
    label === "Maintenance" ||
    label === "Inventory" ||
    label === "Approvals"
  ) {
    return "operational";
  }
  return "secondary";
}

function resolveActiveInventoryChildHref({
  pathname,
  children
}: {
  pathname: string;
  children: Array<{ href: string }>;
}) {
  if (pathname === "/inventory/items") return "/inventory/items";
  if (pathname === "/inventory/stock-movements") return "/inventory/stock-movements";
  if (pathname === "/inventory/issues") return "/inventory/issues";
  if (pathname === "/inventory/expenses") {
    const overview = children.find((child) => child.href === "/inventory");
    return overview ? overview.href : "";
  }
  if (pathname !== "/inventory") return "";

  const overview = children.find((child) => child.href === "/inventory");
  return overview ? overview.href : "";
}

function resolveActiveSetupChildHref({
  pathname,
  children
}: {
  pathname: string;
  children: Array<{ href: string }>;
}) {
  if (pathname.startsWith("/rigs/setup")) return "/rigs/setup";
  if (pathname.startsWith("/projects/setup")) return "/projects/setup";
  if (pathname.startsWith("/clients/setup")) return "/clients/setup";
  if (pathname.startsWith("/employees/setup")) return "/employees/setup";
  if (pathname.startsWith("/inventory/suppliers")) return "/inventory/suppliers";
  if (pathname.startsWith("/inventory/locations")) return "/inventory/locations";
  const firstChild = children[0];
  return firstChild ? firstChild.href : "";
}
