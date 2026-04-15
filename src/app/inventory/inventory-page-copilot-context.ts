import {
  formatInventoryCategory,
  formatMovementType
} from "@/lib/inventory";
import type { CopilotPageContext } from "@/lib/ai/contextual-copilot";
import { formatCurrency, formatNumber } from "@/lib/utils";
import { toIsoDate } from "@/components/inventory/inventory-page-utils";

import type {
  InventoryIssueRow,
  InventoryItemDetailsResponse,
  InventoryItemRow,
  InventoryLocation,
  InventoryMovementRow,
  InventoryOverviewResponse,
  InventorySupplier
} from "./inventory-page-types";

type BuildInventoryCopilotContextParams = {
  copilotPageKey: CopilotPageContext["pageKey"];
  pageTitle: string;
  filters: {
    clientId: string;
    rigId: string;
    from: string;
    to: string;
  };
  isSingleProjectScope: boolean;
  showOverview: boolean;
  showItems: boolean;
  showMovements: boolean;
  showIssuesWorkspace: boolean;
  showSuppliers: boolean;
  showLocations: boolean;
  overview: InventoryOverviewResponse;
  movementsLength: number;
  stockAlertRows: Array<{
    id: string;
    name: string;
    sku: string;
    quantityInStock: number;
    minimumStockLevel: number;
    severity: "WARNING" | "CRITICAL" | "LOW";
  }>;
  items: InventoryItemRow[];
  filteredMovements: InventoryMovementRow[];
  filteredIssues: InventoryIssueRow[];
  suppliers: InventorySupplier[];
  locations: InventoryLocation[];
  selectedItemId: string;
  selectedItemDetails: InventoryItemDetailsResponse | null;
  buildHref: (path: string, overrides?: Record<string, string | null | undefined>) => string;
};

export function buildInventoryCopilotContext({
  copilotPageKey,
  pageTitle,
  filters,
  isSingleProjectScope,
  showOverview,
  showItems,
  showMovements,
  showIssuesWorkspace,
  showSuppliers,
  showLocations,
  overview,
  movementsLength,
  stockAlertRows,
  items,
  filteredMovements,
  filteredIssues,
  suppliers,
  locations,
  selectedItemId,
  selectedItemDetails,
  buildHref
}: BuildInventoryCopilotContextParams): CopilotPageContext {
  const summaryMetrics: CopilotPageContext["summaryMetrics"] = isSingleProjectScope
    ? [
        { key: "approvedItems", label: "Approved Items", value: overview.projectLinked?.approvedItems || 0 },
        {
          key: "availableApprovedQty",
          label: "Available Approved Quantity",
          value: overview.projectLinked?.availableApprovedQuantity || 0
        },
        {
          key: "availableApprovedValue",
          label: "Available Approved Value",
          value: overview.projectLinked?.availableApprovedValue || 0
        },
        { key: "usedQty", label: "Used Quantity", value: overview.projectLinked?.usedQuantity || 0 },
        { key: "usedValue", label: "Used Value", value: overview.projectLinked?.usedValue || 0 },
        { key: "projectIn", label: "Project-linked IN", value: overview.projectLinked?.projectLinkedIn || 0 },
        { key: "projectOut", label: "Project-linked OUT", value: overview.projectLinked?.projectLinkedOut || 0 },
        {
          key: "recognizedProjectCost",
          label: "Recognized Inventory Cost",
          value: overview.projectLinked?.recognizedInventoryCost || 0
        }
      ]
    : [
        { key: "totalItems", label: "Total Items", value: overview.overview.totalItems },
        { key: "unitsInStock", label: "Units In Stock", value: overview.overview.totalUnitsInStock },
        { key: "inventoryValue", label: "Inventory Value", value: overview.overview.totalInventoryValue },
        { key: "lowStock", label: "Low Stock", value: overview.overview.lowStockCount },
        { key: "outOfStock", label: "Out of Stock", value: overview.overview.outOfStockCount },
        { key: "movements", label: "Recent Movements", value: movementsLength }
      ];

  const tablePreviews: CopilotPageContext["tablePreviews"] = [];
  if (showOverview && !isSingleProjectScope) {
    tablePreviews.push({
      key: "inventory-low-stock",
      title: "Low Stock Alerts",
      rowCount: stockAlertRows.length,
      columns: ["Item", "SKU", "Current", "Minimum", "Severity"],
      rows: stockAlertRows.slice(0, 10).map((item) => ({
        id: item.id.replace(/^(out|low)-/, ""),
        item: item.name,
        sku: item.sku,
        current: item.quantityInStock,
        minimum: item.minimumStockLevel,
        severity: item.severity,
        href: buildHref("/inventory"),
        sectionId: "inventory-low-stock-section",
        targetPageKey: "inventory-overview"
      }))
    });
  }
  if (showItems) {
    tablePreviews.push({
      key: "inventory-items",
      title: "Inventory Items",
      rowCount: items.length,
      columns: ["Item", "SKU", "Category", "Stock", "Value", "Status"],
      rows: items.slice(0, 10).map((item) => ({
        id: item.id,
        item: item.name,
        sku: item.sku,
        category: formatInventoryCategory(item.category),
        stock: item.quantityInStock,
        value: item.inventoryValue,
        status: item.status,
        href: buildHref("/inventory/items"),
        targetId: item.id,
        sectionId: "inventory-items-section",
        targetPageKey: "inventory-items"
      }))
    });
  }
  if (showMovements) {
    tablePreviews.push({
      key: "inventory-movements",
      title: "Inventory Movements",
      rowCount: filteredMovements.length,
      columns: ["Date", "Item", "Type", "Qty", "Cost"],
      rows: filteredMovements.slice(0, 10).map((movement) => ({
        id: movement.id,
        date: toIsoDate(movement.date),
        item: movement.item?.name || "Unknown item",
        type: formatMovementType(movement.movementType),
        qty: movement.quantity,
        cost: movement.totalCost || 0,
        href: buildHref("/inventory/stock-movements"),
        targetId: movement.id,
        sectionId: "inventory-movements-section",
        targetPageKey: "inventory-stock-movements"
      }))
    });
  }
  if (showIssuesWorkspace) {
    tablePreviews.push({
      key: "inventory-issues",
      title: "Inventory Issues",
      rowCount: filteredIssues.length,
      columns: ["Issue", "Severity", "Type", "Suggestion"],
      rows: filteredIssues.slice(0, 10).map((issue) => ({
        id: issue.id,
        issue: issue.title,
        severity: issue.severity,
        type: issue.type,
        suggestion: issue.suggestion
      }))
    });
  }
  if (showSuppliers) {
    tablePreviews.push({
      key: "inventory-suppliers",
      title: "Inventory Suppliers",
      rowCount: suppliers.length,
      columns: ["Supplier", "Items", "Purchases", "Recent Purchase"],
      rows: suppliers.slice(0, 10).map((supplier) => ({
        id: supplier.id,
        supplier: supplier.name,
        items: supplier.itemCount,
        purchases: supplier.purchaseCount,
        recentPurchase: supplier.latestPurchaseDate || "-",
        href: buildHref("/inventory/suppliers"),
        sectionId: "inventory-suppliers-section",
        targetPageKey: "inventory-suppliers"
      }))
    });
  }
  if (showLocations) {
    tablePreviews.push({
      key: "inventory-locations",
      title: "Inventory Locations",
      rowCount: locations.length,
      columns: ["Location", "Items", "Active"],
      rows: locations.slice(0, 10).map((location) => ({
        id: location.id,
        location: location.name,
        items: location.itemCount,
        active: location.isActive ? "Active" : "Inactive",
        href: buildHref("/inventory/locations"),
        sectionId: "inventory-locations-section",
        targetPageKey: "inventory-locations"
      }))
    });
  }

  const priorityItems: CopilotPageContext["priorityItems"] = [
    ...(!isSingleProjectScope
      ? stockAlertRows.slice(0, 3).map((item) => ({
          id: item.id,
          label: `${item.name} (${item.sku})`,
          reason:
            item.severity === "CRITICAL"
              ? `Out of stock while minimum is ${formatNumber(item.minimumStockLevel)}.`
              : `Low stock ${formatNumber(item.quantityInStock)} vs minimum ${formatNumber(item.minimumStockLevel)}.`,
          severity: item.severity === "CRITICAL" ? ("CRITICAL" as const) : ("MEDIUM" as const),
          amount: null,
          href: buildHref(showOverview ? "/inventory" : "/inventory/items"),
          issueType: item.severity === "CRITICAL" ? "OUT_OF_STOCK" : "LOW_STOCK",
          sectionId: "inventory-low-stock-section",
          targetPageKey: "inventory-overview"
        }))
      : []),
    ...filteredMovements
      .filter((movement) => movement.movementType === "OUT" && (movement.totalCost || 0) > 0)
      .sort((a, b) => (b.totalCost || 0) - (a.totalCost || 0))
      .slice(0, 2)
      .map((movement) => ({
        id: movement.id,
        label: movement.item?.name || "Unknown item",
        reason: `High-cost stock out at ${formatCurrency(movement.totalCost || 0)}.`,
        severity: (movement.totalCost || 0) >= 5000 ? ("HIGH" as const) : ("MEDIUM" as const),
        amount: movement.totalCost || 0,
        href: buildHref("/inventory/stock-movements"),
        issueType: "STOCK_OUT_COST",
        targetId: movement.id,
        sectionId: "inventory-movements-section",
        targetPageKey: "inventory-stock-movements"
      }))
  ];

  return {
    pageKey: copilotPageKey,
    pageName: pageTitle,
    filters: {
      clientId: filters.clientId,
      rigId: filters.rigId,
      from: filters.from || null,
      to: filters.to || null
    },
    summaryMetrics,
    tablePreviews,
    selectedItems: selectedItemId
      ? [
          {
            id: selectedItemId,
            type: "inventory-item",
            label: selectedItemDetails?.data?.name || selectedItemId
          }
        ]
      : [],
    priorityItems,
    navigationTargets: [
      {
        label: "Open Inventory Overview",
        href: buildHref("/inventory"),
        reason: "Review inventory-wide health and alerts.",
        pageKey: "inventory-overview"
      },
      {
        label: "Open Inventory Items",
        href: buildHref("/inventory/items"),
        reason: "Inspect item stock and metadata.",
        pageKey: "inventory-items",
        sectionId: "inventory-items-section"
      },
      {
        label: "Open Stock Movements",
        href: buildHref("/inventory/stock-movements"),
        reason: "Trace movement history and linked records.",
        pageKey: "inventory-stock-movements",
        sectionId: "inventory-movements-section"
      },
      ...(!isSingleProjectScope
        ? [
            {
              label: "Open Purchase Follow-up",
              href: buildHref("/purchasing/receipt-follow-up"),
              reason: "Process receipts and link evidence.",
              pageKey: "inventory-receipt-intake"
            }
          ]
        : [])
    ],
    notes: [
      `Current inventory workspace section: ${pageTitle}.`,
      "Use global AI Copilot for page-level triage; item and movement edits still require explicit user actions."
    ]
  };
}
