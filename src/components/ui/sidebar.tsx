"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
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
  LogOut,
  Settings,
  UserCircle,
  Wrench,
  X,
  ChevronsUpDown
} from "lucide-react";

import { canAccess } from "@/lib/auth/permissions";
import { inventoryNavChildren, navItems } from "@/lib/navigation";
import { cn } from "@/lib/utils";
import { useRole } from "@/components/layout/role-provider";
import { useAnalyticsFilters } from "@/components/layout/analytics-filters-provider";
import { MODE_VISIBLE_NAV_LABELS } from "@/lib/workspace-mode";
import {
  resolveDevRuntimeResetCommand,
  SESSION_BOOTSTRAP_LOADING_TIMEOUT_MS
} from "@/components/layout/session-bootstrap-recovery";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";

const iconMap: Record<string, typeof LayoutDashboard> = {
  Dashboard: LayoutDashboard,
  Clients: Factory,
  Projects: ClipboardList,
  "Drilling Reports": Drill,
  Breakdowns: Drill,
  "Project Operations": BarChart3,
  Approvals: ClipboardList,
  "Purchase Requests": Gauge,
  Inventory: Boxes,
  Items: Boxes,
  "Stock Movements": ClipboardList,
  Vendors: Factory,
  Locations: Factory,
  "Activity Log": ClipboardList,
  Rigs: HardHat,
  Employees: Settings,
  Maintenance: Wrench
};

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
      "Breakdowns",
      "Maintenance",
      "Inventory",
      "Approvals"
    ]
  },
  {
    title: "Profitability",
    labels: ["Project Operations"]
  },
  {
    title: "System",
    labels: ["Activity Log"]
  }
];

const sidebarVariants = {
  open: { width: "15rem" },
  closed: { width: "3.2rem" },
  hidden: { width: "0rem" }
};

const transitionProps = {
  type: "tween",
  ease: "easeOut",
  duration: 0.2
} as const;

const motionVariants = {
  open: {
    x: 0,
    opacity: 1,
    transition: {
      x: { stiffness: 1000, velocity: -100 }
    }
  },
  closed: {
    x: -14,
    opacity: 0,
    transition: {
      x: { stiffness: 100 }
    }
  }
};

export function SessionNavBar({
  sidebarHidden,
  mobileOpen,
  onRequestClose
}: {
  sidebarHidden: boolean;
  mobileOpen: boolean;
  onRequestClose: () => void;
}) {
  const pathname = usePathname();
  const { role, user, loading, bootstrapError, refreshSession, logout } = useRole();
  const { filters, scopeBootstrapped } = useAnalyticsFilters();

  const [inventoryExpanded, setInventoryExpanded] = useState(false);
  const [loadingTimedOut, setLoadingTimedOut] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(true);
  const [hydrated, setHydrated] = useState(false);

  const allowedNavLabels = useMemo(
    () => new Set(MODE_VISIBLE_NAV_LABELS[filters.workspaceMode]),
    [filters.workspaceMode]
  );

  const visibleNavItems = useMemo(
    () =>
      role
        ? navItems.filter((item) => {
            if (!allowedNavLabels.has(item.label)) {
              return false;
            }
            if (item.permission && canAccess(role, item.permission)) {
              return true;
            }
            return Array.isArray(item.anyOf) ? item.anyOf.some((permission) => canAccess(role, permission)) : false;
          })
        : [],
    [allowedNavLabels, role]
  );

  const visibleInventoryChildren = useMemo(
    () =>
      role
        ? inventoryNavChildren.filter(
            (item) =>
              canAccess(role, item.permission) &&
              isInventoryChildVisibleForMode(item.label, filters.workspaceMode)
          )
        : [],
    [filters.workspaceMode, role]
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
    pathname.startsWith("/inventory/issues") ||
    pathname.startsWith("/inventory/suppliers") ||
    pathname.startsWith("/inventory/locations");
  const activeInventoryChildHref = resolveActiveInventoryChildHref({
    pathname,
    children: visibleInventoryChildren
  });

  const showText = !isDesktop || !isCollapsed;
  const sidebarState = sidebarHidden ? "hidden" : isDesktop && !mobileOpen ? (isCollapsed ? "closed" : "open") : "open";

  useEffect(() => {
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const mediaQuery = window.matchMedia("(min-width: 1024px)");
    const updateDesktop = () => {
      const desktop = mediaQuery.matches;
      setIsDesktop(desktop);
      if (!desktop) {
        setIsCollapsed(false);
      }
    };
    updateDesktop();
    mediaQuery.addEventListener("change", updateDesktop);
    return () => {
      mediaQuery.removeEventListener("change", updateDesktop);
    };
  }, []);

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
    window.localStorage.setItem("geofields.inventorySidebarExpanded", inventoryExpanded ? "1" : "0");
  }, [inventoryExpanded]);

  useEffect(() => {
    if (!loading) {
      setLoadingTimedOut(false);
      return;
    }
    const timeoutId = window.setTimeout(() => {
      setLoadingTimedOut(true);
    }, SESSION_BOOTSTRAP_LOADING_TIMEOUT_MS);
    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [loading]);

  const recoveryMessage = bootstrapError || (loadingTimedOut ? "Access profile is taking longer than expected." : null);
  const sidebarBootstrapping = !hydrated || loading || !scopeBootstrapped;
  const resetCommand = resolveDevRuntimeResetCommand();
  const handleLinkNavigation = () => {
    if (mobileOpen) {
      onRequestClose();
    }
  };

  return (
    <motion.aside
      className={cn(
        "fixed inset-y-0 left-0 z-40 max-w-[88vw] shrink-0 border-r border-slate-200 bg-white/95 shadow-[0_14px_32px_rgba(15,23,42,0.16)] transition-transform duration-200 lg:sticky lg:top-0 lg:h-full lg:max-w-none lg:translate-x-0 lg:border-b-0 lg:shadow-none",
        isDesktop ? "w-auto" : "w-72",
        mobileOpen ? "translate-x-0" : "-translate-x-full pointer-events-none lg:pointer-events-auto",
        sidebarHidden ? "lg:pointer-events-none lg:overflow-hidden lg:opacity-0" : "lg:opacity-100"
      )}
      initial={false}
      animate={sidebarState}
      variants={sidebarVariants}
      transition={transitionProps}
      onMouseEnter={() => {
        if (isDesktop && !sidebarHidden) {
          setIsCollapsed(false);
        }
      }}
      onMouseLeave={() => {
        if (isDesktop && !sidebarHidden) {
          setIsCollapsed(true);
        }
      }}
    >
      <motion.div className="relative z-40 flex h-full shrink-0 flex-col bg-white text-slate-600" animate={sidebarState}>
        <div className="flex h-[54px] shrink-0 items-center border-b border-slate-200 px-2">
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger className="w-full" asChild>
              <Button variant="ghost" size="sm" className={cn("flex w-full items-center gap-2 px-2", !showText && "justify-center")}>
                <Avatar className="h-5 w-5 rounded">
                  <AvatarFallback>G</AvatarFallback>
                </Avatar>
                <motion.div variants={motionVariants} className="flex min-w-0 flex-1 items-center gap-2">
                  {showText ? (
                    <>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-ink-900">GeoFields</p>
                        <p className="truncate text-[11px] text-slate-500">Drilling Profitability</p>
                      </div>
                      <ChevronsUpDown className="ml-auto h-4 w-4 text-slate-400" />
                    </>
                  ) : null}
                </motion.div>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56">
              <DropdownMenuItem asChild>
                <Link href="/settings/profile" onClick={handleLinkNavigation} className="flex items-center gap-2">
                  <UserCircle className="h-4 w-4" /> Profile
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem
                className="flex items-center gap-2"
                onSelect={(event) => {
                  event.preventDefault();
                  void logout();
                }}
              >
                <LogOut className="h-4 w-4" /> Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <button
            type="button"
            onClick={onRequestClose}
            className="ml-2 inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 lg:hidden"
            aria-label="Close navigation menu"
          >
            <X size={15} />
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex min-h-0 flex-1 flex-col gap-2 p-2">
            <ScrollArea className="min-h-0 flex-1">
              <div className="space-y-4 pr-1">
                {sidebarBootstrapping && !recoveryMessage ? (
                  <div className="space-y-2 py-1">
                    <p className={cn("px-2 text-sm text-slate-600", !showText && "sr-only")}>Loading menu...</p>
                    {Array.from({ length: 6 }).map((_, index) => (
                      <Skeleton key={`menu-loading-${index}`} className="h-8 w-full rounded-lg" />
                    ))}
                  </div>
                ) : null}

                {recoveryMessage ? (
                  <div className={cn("rounded-xl border border-amber-200 bg-amber-50 p-3 text-amber-900", !showText && "p-2")}>
                    {showText ? (
                      <>
                        <p className="text-sm font-medium">Menu unavailable</p>
                        <p className="mt-1 text-xs">{recoveryMessage}</p>
                        <p className="mt-2 text-[11px]">
                          If this persists in local dev, run <code>{resetCommand}</code> and refresh.
                        </p>
                        <button
                          type="button"
                          onClick={() => {
                            void refreshSession();
                          }}
                          className="mt-3 rounded-md border border-amber-300 bg-white px-2.5 py-1 text-xs font-semibold text-amber-900 hover:bg-amber-100"
                        >
                          Retry session
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          void refreshSession();
                        }}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-amber-300 bg-white text-amber-900"
                        aria-label="Retry session"
                      >
                        <ChevronRight className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                ) : null}

                {!sidebarBootstrapping && !recoveryMessage
                  ? navGroups.map((group) => {
                      const groupItems = group.labels
                        .map((label) => visibleNavByLabel.get(label))
                        .filter((item): item is NonNullable<typeof item> => Boolean(item));
                      if (groupItems.length === 0) {
                        return null;
                      }

                      return (
                        <div key={group.title} className="space-y-1">
                          {showText ? (
                            <p className="px-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{group.title}</p>
                          ) : null}
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
                                group.title === "Core Workflow" && index > 0 && currentSegment !== previousSegment;
                              const wrapperClass = startsSegment && showText ? "mt-1.5 pt-1.5" : "";

                              if (item.label === "Inventory") {
                                if (!showText) {
                                  const Icon = iconMap[item.label] || LayoutDashboard;
                                  return (
                                    <Link
                                      key={item.href}
                                      href={item.href}
                                      onClick={handleLinkNavigation}
                                      className={cn(
                                        "flex h-8 items-center justify-center rounded-md px-2 py-1.5 transition hover:bg-slate-100",
                                        inventoryRouteActive && "bg-slate-100 text-brand-700"
                                      )}
                                      aria-label={item.label}
                                      title={item.label}
                                    >
                                      <Icon className="h-4 w-4" />
                                    </Link>
                                  );
                                }

                                return (
                                  <div key={item.href} className={cn("space-y-1", wrapperClass)}>
                                    <button
                                      type="button"
                                      onClick={() => setInventoryExpanded((current) => !current)}
                                      className={cn(
                                        "flex h-8 w-full items-center justify-between rounded-md px-2 py-1.5 text-sm transition hover:bg-slate-100",
                                        inventoryRouteActive && "bg-slate-100 text-brand-700"
                                      )}
                                    >
                                      <span className="flex items-center gap-2">
                                        <Boxes className="h-4 w-4" />
                                        Inventory
                                      </span>
                                      {inventoryExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                                    </button>
                                    <div
                                      className={cn(
                                        "grid transition-[grid-template-rows,opacity] duration-300 ease-out",
                                        inventoryExpanded ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
                                      )}
                                    >
                                      <div className="overflow-hidden">
                                        <div className="ml-4 space-y-0.5 border-l border-slate-200 pl-2.5">
                                          {visibleInventoryChildren.map((child) => {
                                            const isActive = child.href === activeInventoryChildHref;
                                            return (
                                              <Link
                                                key={child.href}
                                                href={child.href}
                                                onClick={handleLinkNavigation}
                                                className={cn(
                                                  "flex items-center gap-2 rounded-md px-2.5 py-1 text-[13px] transition hover:bg-slate-100",
                                                  isActive && "bg-brand-50 text-brand-700"
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
                              const purchaseRequestsAliasActive =
                                item.href === "/expenses" &&
                                (pathname.startsWith("/purchasing/receipt-follow-up") ||
                                  pathname.startsWith("/inventory/receipt-intake"));
                              const isActive =
                                purchaseRequestsAliasActive ||
                                pathname === item.href ||
                                (item.href !== "/" && pathname.startsWith(`${item.href}/`));

                              return (
                                <Link
                                  key={item.href}
                                  href={item.href}
                                  onClick={handleLinkNavigation}
                                  className={cn(
                                    "flex h-8 items-center rounded-md px-2 py-1.5 transition hover:bg-slate-100",
                                    showText ? "justify-start gap-2" : "justify-center",
                                    isActive && "bg-slate-100 text-brand-700",
                                    wrapperClass
                                  )}
                                  aria-label={showText ? undefined : item.label}
                                  title={showText ? undefined : item.label}
                                >
                                  <Icon className="h-4 w-4 shrink-0" />
                                  <motion.div variants={motionVariants}>
                                    {showText ? (
                                      <div className="flex items-center gap-2">
                                        <span className="text-sm font-medium">{item.label}</span>
                                        {item.label === "Project Operations" ? <Badge tone="blue">BETA</Badge> : null}
                                      </div>
                                    ) : null}
                                  </motion.div>
                                </Link>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })
                  : null}

              </div>
            </ScrollArea>
          </div>

          <div className="border-t border-slate-200 p-2">
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger className="w-full">
                <div
                  className={cn(
                    "flex h-8 w-full items-center rounded-md px-2 py-1.5 transition hover:bg-slate-100",
                    showText ? "gap-2" : "justify-center"
                  )}
                >
                  <Avatar className="h-4 w-4">
                    <AvatarFallback>{getInitials(user?.name || "User")}</AvatarFallback>
                  </Avatar>
                  {showText ? (
                    <>
                      <p className="line-clamp-1 text-sm font-medium text-ink-900">{user?.name || "Account"}</p>
                      <ChevronsUpDown className="ml-auto h-4 w-4 text-slate-400" />
                    </>
                  ) : null}
                </div>
              </DropdownMenuTrigger>
              <DropdownMenuContent sideOffset={5} align="start" className="w-56">
                <div className="flex items-center gap-2 p-2">
                  <Avatar className="h-6 w-6">
                    <AvatarFallback>{getInitials(user?.name || "User")}</AvatarFallback>
                  </Avatar>
                  <div className="flex flex-col text-left">
                    <span className="text-sm font-medium">{user?.name || "Unknown user"}</span>
                    <span className="line-clamp-1 text-xs text-slate-500">{user?.email || "No email"}</span>
                  </div>
                </div>
                <Separator className="my-1" />
                <DropdownMenuItem asChild>
                  <Link href="/settings/profile" onClick={handleLinkNavigation} className="flex items-center gap-2">
                    <UserCircle className="h-4 w-4" /> Profile
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="flex items-center gap-2"
                  onSelect={(event) => {
                    event.preventDefault();
                    void logout();
                  }}
                >
                  <LogOut className="h-4 w-4" /> Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </motion.div>
    </motion.aside>
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
  if (pathname === "/inventory" || pathname === "/inventory/items") {
    const items = children.find((child) => child.href === "/inventory/items");
    return items ? items.href : "";
  }
  if (pathname === "/inventory/stock-movements") return "/inventory/stock-movements";
  if (pathname.startsWith("/inventory/suppliers")) return "/inventory/suppliers";
  if (pathname.startsWith("/inventory/locations")) return "/inventory/locations";
  if (pathname === "/inventory/expenses") {
    const items = children.find((child) => child.href === "/inventory/items");
    return items ? items.href : "";
  }
  return "";
}

function getInitials(value: string) {
  return value
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function isInventoryChildVisibleForMode(
  label: string,
  workspaceMode: "all-projects" | "project" | "workshop"
) {
  if (label === "Vendors" || label === "Locations") {
    return workspaceMode !== "project";
  }
  return true;
}
