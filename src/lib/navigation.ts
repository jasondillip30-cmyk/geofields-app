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
  { href: "/", label: "Dashboard", permission: "dashboard:view" },
  { href: "/projects", label: "Projects", permission: "projects:view" },
  { href: "/rigs", label: "Rigs", permission: "rigs:view" },
  { href: "/drilling-reports", label: "Drilling Reports", permission: "drilling:view" },
  { href: "/expenses", label: "Purchase Requests", permission: "expenses:manual" },
  { href: "/breakdowns", label: "Breakdowns", permission: "breakdowns:view" },
  { href: "/maintenance", label: "Maintenance", permission: "maintenance:view" },
  { href: "/inventory", label: "Inventory", permission: "inventory:view" },
  { href: "/approvals", label: "Approvals", permission: "reports:view" },
  { href: "/revenue", label: "Revenue", permission: "finance:view" },
  { href: "/cost-tracking", label: "Cost Tracking", permission: "finance:view" },
  { href: "/cost-tracking/budget-vs-actual", label: "Budget vs Actual", permission: "finance:view" },
  { href: "/profit", label: "Profit", permission: "finance:view" },
  { href: "/activity-log", label: "Activity Log", permission: "reports:view" },
  { href: "/clients", label: "Clients", permission: "clients:view" },
  { href: "/employees", label: "Employees", permission: "employees:view" },
  { href: "/inventory/suppliers", label: "Vendors", permission: "inventory:view" },
  { href: "/inventory/locations", label: "Locations", permission: "inventory:view" }
];

export const inventoryNavChildren: NavChildItem[] = [
  { href: "/inventory", label: "Inventory Overview", permission: "inventory:view" },
  { href: "/inventory/items", label: "Items", permission: "inventory:view" },
  { href: "/inventory/stock-movements", label: "Stock Movements", permission: "inventory:view" },
  { href: "/inventory/issues", label: "Issues", permission: "inventory:view" }
];

export const setupNavChildren: NavChildItem[] = [
  { href: "/clients", label: "Clients", permission: "clients:view" },
  { href: "/employees", label: "Employees", permission: "employees:view" },
  { href: "/inventory/suppliers", label: "Vendors", permission: "inventory:view" },
  { href: "/inventory/locations", label: "Locations", permission: "inventory:view" }
];

// Backward-compatible export for older sidebar implementations.
export const receiptProcessingChildren: NavChildItem[] = [
  { href: "/purchasing/receipt-follow-up", label: "Complete Purchase", permission: "inventory:view" },
  { href: "/purchasing/receipt-follow-up?view=history", label: "Intake History", permission: "inventory:view" }
];
