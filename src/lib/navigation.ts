import type { Permission } from "@/lib/auth/permissions";

export interface NavItem {
  href: string;
  label: string;
  permission: Permission;
}

export interface NavChildItem {
  href: string;
  label: string;
  permission: Permission;
}

export const navItems: NavItem[] = [
  { href: "/", label: "Company Dashboard", permission: "dashboard:view" },
  { href: "/executive-overview", label: "Executive Overview", permission: "finance:view" },
  { href: "/alerts-center", label: "Alerts Center", permission: "finance:view" },
  { href: "/data-quality/linkage-center", label: "Data Quality Center", permission: "finance:view" },
  { href: "/clients", label: "Clients", permission: "clients:view" },
  { href: "/projects", label: "Projects", permission: "projects:view" },
  { href: "/employees", label: "Employees", permission: "employees:view" },
  { href: "/drilling-reports", label: "Drilling Reports", permission: "drilling:view" },
  { href: "/approvals", label: "Approvals", permission: "reports:view" },
  { href: "/breakdowns", label: "Breakdown Reports", permission: "breakdowns:view" },
  { href: "/revenue", label: "Revenue", permission: "finance:view" },
  { href: "/expenses", label: "Expenses", permission: "expenses:manual" },
  { href: "/cost-tracking", label: "Cost Tracking", permission: "finance:view" },
  { href: "/cost-tracking/budget-vs-actual", label: "Budget vs Actual", permission: "finance:view" },
  { href: "/inventory", label: "Inventory", permission: "inventory:view" },
  { href: "/profit", label: "Profit", permission: "finance:view" },
  { href: "/forecasting", label: "Forecasting", permission: "finance:view" },
  { href: "/activity-log", label: "Activity Log", permission: "reports:view" },
  { href: "/rigs", label: "Rigs", permission: "rigs:view" },
  { href: "/maintenance", label: "Maintenance", permission: "maintenance:view" },
  { href: "/mechanics", label: "Mechanics Directory", permission: "mechanics:view" },
  { href: "/reports", label: "Summary Reports", permission: "reports:view" }
];

export const inventoryNavChildren: NavChildItem[] = [
  { href: "/inventory", label: "Inventory Overview", permission: "inventory:view" },
  { href: "/inventory/items", label: "Items", permission: "inventory:view" },
  { href: "/inventory/stock-movements", label: "Stock Movements", permission: "inventory:view" },
  { href: "/inventory/receipt-intake", label: "Receipt Intake", permission: "inventory:view" },
  { href: "/inventory/issues", label: "Issues", permission: "inventory:view" },
  { href: "/inventory/suppliers", label: "Suppliers", permission: "inventory:view" },
  { href: "/inventory/locations", label: "Locations", permission: "inventory:view" }
];

// Backward-compatible export for older sidebar implementations.
export const receiptProcessingChildren: NavChildItem[] = [
  { href: "/inventory/receipt-intake", label: "Scan Receipt", permission: "inventory:view" },
  { href: "/inventory/receipt-intake?view=history", label: "Intake History", permission: "inventory:view" }
];
