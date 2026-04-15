import type { Permission } from "@/lib/auth/permissions";

const routePermissionMap: Array<{ prefix: string; permission: Permission }> = [
  { prefix: "/executive-overview", permission: "finance:view" },
  { prefix: "/alerts-center", permission: "finance:view" },
  { prefix: "/data-quality/linkage-center", permission: "finance:view" },
  { prefix: "/clients", permission: "clients:view" },
  { prefix: "/projects", permission: "projects:view" },
  { prefix: "/employees", permission: "employees:view" },
  { prefix: "/drilling-reports", permission: "drilling:view" },
  { prefix: "/approvals", permission: "reports:view" },
  { prefix: "/breakdowns", permission: "breakdowns:view" },
  { prefix: "/spending/profit", permission: "finance:view" },
  { prefix: "/spending/expenses", permission: "finance:view" },
  { prefix: "/spending", permission: "drilling:view" },
  { prefix: "/revenue", permission: "finance:view" },
  { prefix: "/expenses", permission: "expenses:manual" },
  { prefix: "/cost-tracking", permission: "finance:view" },
  { prefix: "/inventory", permission: "inventory:view" },
  { prefix: "/profit", permission: "finance:view" },
  { prefix: "/forecasting", permission: "finance:view" },
  { prefix: "/activity-log", permission: "reports:view" },
  { prefix: "/rigs", permission: "rigs:view" },
  { prefix: "/maintenance", permission: "maintenance:view" },
  { prefix: "/mechanics", permission: "mechanics:view" },
  { prefix: "/reports", permission: "reports:view" },
  { prefix: "/workspace-launch", permission: "rigs:view" },
  { prefix: "/", permission: "dashboard:view" }
];

export function getPermissionForPath(pathname: string): Permission | null {
  const sorted = [...routePermissionMap].sort((a, b) => b.prefix.length - a.prefix.length);
  const match = sorted.find((entry) => pathname === entry.prefix || pathname.startsWith(`${entry.prefix}/`));
  return match?.permission ?? null;
}
