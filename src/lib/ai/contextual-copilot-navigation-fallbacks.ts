import type { CopilotNavigationTarget } from "@/lib/ai/contextual-copilot-types";

export const COPILOT_NAVIGATION_FALLBACKS: Record<string, CopilotNavigationTarget[]> = {
  "atlas-related": [
    { label: "Open Alerts Center", href: "/alerts-center", reason: "Triage operational alerts first.", pageKey: "alerts-center" },
    { label: "Open Project Operations", href: "/spending", reason: "Check budget pressure behind current risks.", pageKey: "budget-vs-actual" },
    { label: "Open Data Quality Center", href: "/data-quality/linkage-center", reason: "Fix missing linkage impacts quickly.", pageKey: "data-quality-linkage-center" }
  ],
  "atlas-whole-app": [
    { label: "Open Executive Overview", href: "/executive-overview", reason: "Start from top-level risk posture.", pageKey: "executive-overview" },
    { label: "Open Alerts Center", href: "/alerts-center", reason: "Clear urgent alert backlog.", pageKey: "alerts-center" },
    { label: "Open Project Operations", href: "/spending", reason: "Prioritize overspent and critical buckets.", pageKey: "budget-vs-actual" }
  ],
  "executive-overview": [
    { label: "Open Alerts Center", href: "/alerts-center", reason: "Triage current risk signals.", pageKey: "alerts-center" },
    { label: "Open Project Operations", href: "/spending", reason: "Review budget pressure.", pageKey: "budget-vs-actual" },
    { label: "Open Drilling Reports Approvals", href: "/approvals?tab=drilling-reports", reason: "Process drilling backlog.", pageKey: "approvals", sectionId: "approvals-tab-drilling-reports" }
  ],
  "alerts-center": [
    { label: "Open Alerts Center", href: "/alerts-center", reason: "Continue triage in current queue.", pageKey: "alerts-center", sectionId: "alerts-active-section" },
    { label: "Open Approvals", href: "/approvals", reason: "Process pending queue items.", pageKey: "approvals" },
    { label: "Open Data Quality Center", href: "/data-quality/linkage-center", reason: "Fix linkage-driven alerts.", pageKey: "data-quality-linkage-center" },
    { label: "Open Drilling Reports Approvals", href: "/approvals?tab=drilling-reports", reason: "Resolve stale drilling approvals first.", pageKey: "approvals", sectionId: "approvals-tab-drilling-reports" }
  ],
  "data-quality-linkage-center": [
    { label: "Open Data Quality Center", href: "/data-quality/linkage-center", reason: "Apply linkage corrections.", pageKey: "data-quality-linkage-center" },
    { label: "Open Project Operations", href: "/spending", reason: "Validate impact after corrections.", pageKey: "cost-tracking" }
  ],
  "budget-vs-actual": [
    { label: "Open Project Operations", href: "/spending", reason: "Review budget buckets.", pageKey: "budget-vs-actual" },
    { label: "Open Project Operations", href: "/spending", reason: "Inspect spend drivers.", pageKey: "cost-tracking" },
    { label: "Open Alerts Center", href: "/alerts-center", reason: "Review related budget alerts.", pageKey: "alerts-center" }
  ],
  expenses: [
    { label: "Open Expenses", href: "/expenses", reason: "Review cost drivers and expense records.", pageKey: "expenses", sectionId: "expenses-records-section" },
    { label: "Open Project Operations", href: "/spending", reason: "Check budget pressure related to current spend.", pageKey: "budget-vs-actual" },
    { label: "Open Approvals", href: "/approvals", reason: "Clear submitted records affecting expense visibility.", pageKey: "approvals" },
    { label: "Open Linkage Center", href: "/data-quality/linkage-center", reason: "Fix missing rig/project linkage from expense records.", pageKey: "data-quality-linkage-center" }
  ],
  "drilling-reports": [
    { label: "Open Drilling Reports", href: "/drilling-reports", reason: "Review drilling records and status.", pageKey: "drilling-reports", sectionId: "drilling-reports-table-section" },
    { label: "Open Approvals", href: "/approvals?tab=drilling-reports", reason: "Resolve drilling approval queue.", pageKey: "approvals", sectionId: "approvals-tab-drilling-reports" },
    { label: "Open Revenue", href: "/spending", reason: "Validate drilling impact on revenue.", pageKey: "revenue" }
  ],
  breakdowns: [
    { label: "Open Breakdown Reports", href: "/breakdowns", reason: "Review breakdown severity and downtime.", pageKey: "breakdowns", sectionId: "breakdown-log-section" },
    { label: "Open Maintenance", href: "/maintenance", reason: "Coordinate maintenance response.", pageKey: "maintenance", sectionId: "maintenance-log-section" }
  ],
  "inventory-overview": [
    { label: "Open Inventory Items", href: "/inventory/items", reason: "Review inventory item health.", pageKey: "inventory-items", sectionId: "inventory-items-section" },
    { label: "Open Stock Movements", href: "/inventory/stock-movements", reason: "Trace stock changes.", pageKey: "inventory-stock-movements", sectionId: "inventory-movements-section" }
  ],
  "inventory-items": [
    { label: "Open Inventory Items", href: "/inventory/items", reason: "Manage inventory items.", pageKey: "inventory-items", sectionId: "inventory-items-section" },
    { label: "Open Stock Movements", href: "/inventory/stock-movements", reason: "Review linked movements.", pageKey: "inventory-stock-movements", sectionId: "inventory-movements-section" }
  ],
  "inventory-stock-movements": [
    { label: "Open Stock Movements", href: "/inventory/stock-movements", reason: "Trace movement records.", pageKey: "inventory-stock-movements", sectionId: "inventory-movements-section" },
    { label: "Open Inventory Items", href: "/inventory/items", reason: "Inspect affected items.", pageKey: "inventory-items", sectionId: "inventory-items-section" }
  ],
  "inventory-issues": [
    { label: "Open Data Quality Center", href: "/data-quality/linkage-center", reason: "Fix cross-module linkage risks.", pageKey: "data-quality-linkage-center" }
  ],
  "inventory-receipt-intake": [
    { label: "Open Purchase Follow-up", href: "/purchasing/receipt-follow-up", reason: "Review receipt scan and intake flow.", pageKey: "inventory-receipt-intake", sectionId: "inventory-receipt-scan-section" },
    { label: "Open Intake History", href: "/purchasing/receipt-follow-up?view=history", reason: "Review pending and finalized intake records.", pageKey: "inventory-receipt-intake", sectionId: "inventory-receipt-history-section" },
    { label: "Open Stock Movements", href: "/inventory/stock-movements", reason: "Trace inventory impact from receipt intake.", pageKey: "inventory-stock-movements", sectionId: "inventory-movements-section" }
  ],
  maintenance: [
    { label: "Open Maintenance", href: "/maintenance", reason: "Review maintenance activity log and rig status.", pageKey: "maintenance", sectionId: "maintenance-log-section" },
    { label: "Open Breakdowns", href: "/breakdowns", reason: "Check open breakdowns linked to maintenance work.", pageKey: "breakdowns", sectionId: "breakdown-log-section" }
  ],
  rigs: [
    { label: "Open Rigs", href: "/rigs", reason: "Review rig condition and utilization risk.", pageKey: "rigs", sectionId: "rig-registry-section" },
    { label: "Open Maintenance", href: "/maintenance", reason: "Confirm maintenance demand for attention rigs.", pageKey: "maintenance", sectionId: "maintenance-log-section" },
    { label: "Open Project Operations", href: "/spending", reason: "Check rig cost concentration.", pageKey: "cost-tracking" }
  ],
  profit: [
    { label: "Open Profit", href: "/spending/profit", reason: "Review profitability drivers.", pageKey: "profit", sectionId: "profit-primary-kpi-section" },
    { label: "Open Forecasting", href: "/forecasting", reason: "Compare forecast scenarios.", pageKey: "forecasting", sectionId: "forecast-kpi-section" },
    { label: "Open Expenses", href: "/expenses", reason: "Inspect cost contributors.", pageKey: "expenses" }
  ],
  forecasting: [
    { label: "Open Forecasting", href: "/forecasting", reason: "Review simulation details.", pageKey: "forecasting", sectionId: "forecast-kpi-section" },
    { label: "Open Profit", href: "/spending/profit", reason: "Validate profitability impact.", pageKey: "profit", sectionId: "profit-primary-kpi-section" }
  ]
};
