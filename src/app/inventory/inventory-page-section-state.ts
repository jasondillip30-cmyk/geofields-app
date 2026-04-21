import type { CopilotPageContext } from "@/lib/ai/contextual-copilot";
import { resolveInventorySection } from "./inventory-page-types";
import type { InventorySection } from "./inventory-page-types";

export interface InventorySectionState {
  inventorySection: InventorySection;
  lockedProjectSectionRedirected: boolean;
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
  const lockedProjectAllowedSections: InventorySection[] = ["items", "stock-movements"];

  const inventorySection =
    args.isSingleProjectScope && !lockedProjectAllowedSections.includes(requestedInventorySection)
      ? "items"
      : requestedInventorySection;

  const lockedProjectSectionRedirected =
    args.isSingleProjectScope && requestedInventorySection !== inventorySection;

  const showItems = inventorySection === "items";
  const showMovements = inventorySection === "stock-movements";
  const showIssues = inventorySection === "issues";
  const showIssuesWorkspace = showIssues && !args.isSingleProjectScope;
  const showIssuesLockedNotice = showIssues && args.isSingleProjectScope;
  const showSuppliers = inventorySection === "suppliers";
  const showLocations = inventorySection === "locations";
  const createFromDeepLinkBlocked =
    showItems && args.isSingleProjectScope && args.createFromDeepLinkFlag;
  const isProjectScopedInventoryView = showMovements || showIssues || showItems;

  const pageTitle = showItems
    ? "Inventory Items"
    : showMovements
      ? "Stock Movements"
      : showIssues
        ? "Inventory Issues"
        : showSuppliers
          ? "Inventory Suppliers"
          : "Inventory Locations";

  const pageSubtitle = showItems
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

  const copilotPageKey: CopilotPageContext["pageKey"] = showItems
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
