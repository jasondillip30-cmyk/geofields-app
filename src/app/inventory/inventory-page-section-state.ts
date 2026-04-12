import type { CopilotPageContext } from "@/lib/ai/contextual-copilot";
import { resolveInventorySection } from "./inventory-page-types";
import type { InventorySection } from "./inventory-page-types";

export interface InventorySectionState {
  inventorySection: InventorySection;
  lockedProjectSectionRedirected: boolean;
  showOverview: boolean;
  showItems: boolean;
  showMovements: boolean;
  showIssues: boolean;
  showIssuesWorkspace: boolean;
  showIssuesLockedNotice: boolean;
  showSuppliers: boolean;
  showLocations: boolean;
  isProjectScopedInventoryView: boolean;
  pageTitle: string;
  pageSubtitle: string;
  copilotPageKey: CopilotPageContext["pageKey"];
}

export function buildInventorySectionState(args: {
  pathname: string;
  sectionParam: string | null;
  isSingleProjectScope: boolean;
  createFromDeepLinkFlag: boolean;
}): InventorySectionState & { createFromDeepLinkBlocked: boolean } {
  const requestedInventorySection = resolveInventorySection(args.pathname, args.sectionParam);
  const lockedProjectAllowedSections: InventorySection[] = [
    "overview",
    "items",
    "stock-movements"
  ];

  const inventorySection =
    args.isSingleProjectScope && !lockedProjectAllowedSections.includes(requestedInventorySection)
      ? "overview"
      : requestedInventorySection;

  const lockedProjectSectionRedirected =
    args.isSingleProjectScope && requestedInventorySection !== inventorySection;

  const showOverview = inventorySection === "overview";
  const showItems = inventorySection === "items";
  const showMovements = inventorySection === "stock-movements";
  const showIssues = inventorySection === "issues";
  const showIssuesWorkspace = showIssues && !args.isSingleProjectScope;
  const showIssuesLockedNotice = showIssues && args.isSingleProjectScope;
  const showSuppliers = inventorySection === "suppliers";
  const showLocations = inventorySection === "locations";
  const createFromDeepLinkBlocked =
    showItems && args.isSingleProjectScope && args.createFromDeepLinkFlag;
  const isProjectScopedInventoryView = showOverview || showMovements || showIssues || showItems;

  const pageTitle = showOverview
    ? "Inventory Overview"
    : showItems
      ? "Inventory Items"
      : showMovements
        ? "Stock Movements"
        : showIssues
          ? "Inventory Issues"
          : showSuppliers
            ? "Inventory Suppliers"
            : "Inventory Locations";

  const pageSubtitle = showOverview
    ? args.isSingleProjectScope
      ? "Project working view: approved, available, used, and project-linked inventory activity."
      : "Dashboard summary and quick navigation for inventory operations."
    : showItems
      ? args.isSingleProjectScope
        ? "Approved items for the locked project. Warehouse stock remains global."
        : "Manage items, stock levels, suppliers, and linked history from one workspace."
      : showMovements
        ? args.isSingleProjectScope
          ? "Track project restock-in and usage-out activity."
          : "Track inventory movement history, operational linkage, and cost recognition."
        : showIssues
          ? args.isSingleProjectScope
            ? "Inventory issues are available in All projects mode."
            : "Resolve gaps in inventory, usage, and cost flow."
          : showSuppliers
            ? "Manage supplier records and purchasing context."
            : "Manage warehouse and site stock locations.";

  const copilotPageKey: CopilotPageContext["pageKey"] = showOverview
    ? "inventory-overview"
    : showItems
      ? "inventory-items"
      : showMovements
        ? "inventory-stock-movements"
        : showIssues
          ? "inventory-issues"
          : showSuppliers
            ? "inventory-suppliers"
            : "inventory-locations";

  return {
    inventorySection,
    lockedProjectSectionRedirected,
    showOverview,
    showItems,
    showMovements,
    showIssues,
    showIssuesWorkspace,
    showIssuesLockedNotice,
    showSuppliers,
    showLocations,
    isProjectScopedInventoryView,
    pageTitle,
    pageSubtitle,
    copilotPageKey,
    createFromDeepLinkBlocked
  };
}
