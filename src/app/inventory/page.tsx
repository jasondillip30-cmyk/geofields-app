"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Eye } from "lucide-react";

import { AccessGate } from "@/components/layout/access-gate";
import { useRegisterCopilotContext } from "@/components/layout/ai-copilot-context";
import { FilterScopeBanner } from "@/components/layout/filter-scope-banner";
import { useAnalyticsFilters } from "@/components/layout/analytics-filters-provider";
import { scrollToFocusElement, useCopilotFocusTarget } from "@/components/layout/copilot-focus-target";
import { useRole } from "@/components/layout/role-provider";
import { Card, MetricCard } from "@/components/ui/card";
import { DataTable } from "@/components/ui/table";
import { canAccess } from "@/lib/auth/permissions";
import type { CopilotPageContext } from "@/lib/ai/contextual-copilot";
import { buildScopedHref } from "@/lib/drilldown";
import { formatInventoryCategory, formatMovementType, inventoryCategoryOptions, inventoryMovementTypeOptions } from "@/lib/inventory";
import { cn, formatCurrency, formatNumber } from "@/lib/utils";

interface InventoryItemRow {
  id: string;
  name: string;
  sku: string;
  category: string;
  description: string | null;
  quantityInStock: number;
  minimumStockLevel: number;
  unitCost: number;
  inventoryValue: number;
  supplierId: string | null;
  supplier: { id: string; name: string } | null;
  locationId: string | null;
  location: { id: string; name: string } | null;
  compatibleRigId: string | null;
  compatibleRig: { id: string; rigCode: string } | null;
  compatibleRigType: string | null;
  partNumber: string | null;
  status: "ACTIVE" | "INACTIVE";
  notes: string | null;
  lowStock: boolean;
  outOfStock: boolean;
  latestMovementDate: string | null;
  latestMovementType: string | null;
  createdAt: string;
  updatedAt: string;
}

interface InventorySupplier {
  id: string;
  name: string;
  contactPerson: string | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
  isActive: boolean;
  itemCount: number;
  movementCount: number;
  purchaseCount: number;
  totalPurchaseCost: number;
  latestPurchaseDate: string | null;
}

interface InventoryLocation {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  itemCount: number;
}

interface InventoryMovementRow {
  id: string;
  itemId: string;
  movementType: "IN" | "OUT" | "ADJUSTMENT" | "TRANSFER";
  quantity: number;
  unitCost: number | null;
  totalCost: number | null;
  date: string;
  notes: string | null;
  traReceiptNumber: string | null;
  supplierInvoiceNumber: string | null;
  receiptUrl: string | null;
  item: {
    id: string;
    name: string;
    sku: string;
    category?: string;
    quantityInStock?: number;
    minimumStockLevel?: number;
    unitCost?: number;
  } | null;
  rig: { id: string; rigCode: string } | null;
  project: { id: string; name: string } | null;
  client: { id: string; name: string } | null;
  maintenanceRequest: { id: string; requestCode: string; status: string } | null;
  expense: { id: string; amount: number; category: string; approvalStatus: string } | null;
  supplier: { id: string; name: string } | null;
  locationFrom: { id: string; name: string } | null;
  locationTo: { id: string; name: string } | null;
  performedBy: { id: string; fullName: string; role: string } | null;
}

interface InventoryOverviewResponse {
  overview: {
    totalItems: number;
    totalUnitsInStock: number;
    totalInventoryValue: number;
    lowStockCount: number;
    outOfStockCount: number;
    recentlyUsedItems: Array<{ id: string; name: string; date: string; quantity: number }>;
    recentlyPurchasedItems: Array<{ id: string; name: string; date: string; quantity: number; supplier: string | null }>;
  };
  lowStockItems: Array<{ id: string; name: string; sku: string; quantityInStock: number; minimumStockLevel: number; category: string }>;
  outOfStockItems: Array<{ id: string; name: string; sku: string; minimumStockLevel: number; category: string }>;
  analytics: {
    topUsedItems: Array<{ id: string; name: string; quantity: number; totalCost: number }>;
    leastUsedItems: Array<{ id: string; name: string; quantity: number; totalCost: number }>;
    deadStockItems: Array<{ id: string; name: string; sku: string; inventoryValue: number; quantityInStock: number; lastUsedAt: string | null }>;
    highestCostCategories: Array<{ category: string; cost: number; percentOfTotal: number }>;
    monthlyConsumption: Array<{ month: string; quantity: number; cost: number }>;
    movementTrend: Array<{ date: string; inQty: number; outQty: number; adjustmentQty: number; transferQty: number }>;
    inventoryCostByRig: Array<{ id: string; name: string; totalCost: number; quantity: number }>;
    inventoryCostByProject: Array<{ id: string; name: string; totalCost: number; quantity: number }>;
    recommendations: string[];
  };
}

interface InventoryItemDetailsResponse {
  data: InventoryItemRow;
  movements: InventoryMovementRow[];
  usageHistory: InventoryMovementRow[];
  purchaseHistory: InventoryMovementRow[];
  linkedMaintenance: Array<{
    movementId: string;
    requestId: string;
    requestCode: string;
    status: string;
    quantity: number;
    totalCost: number;
    date: string;
  }>;
  linkedExpenses: Array<{
    movementId: string;
    expenseId: string;
    amount: number;
    category: string;
    approvalStatus: string;
    receiptUrl: string | null;
    date: string;
  }>;
  stockMovementOverTime: Array<{ date: string; inQty: number; outQty: number; adjustmentQty: number; transferQty: number }>;
  monthlyConsumption: Array<{ month: string; quantity: number; cost: number }>;
}

interface CategorySuggestionState {
  suggestedCategory: string | null;
  confidence: "HIGH" | "MEDIUM" | "LOW" | "NONE";
  confidenceLabel: string;
  reason: string;
  matchedKeywords: string[];
  similarItems: Array<{ id: string; name: string; category: string }>;
  alternatives: Array<{ category: string; label: string; score: number }>;
  mismatchWarning: string | null;
  existingCategoryNames: string[];
  similarCategoryNames: string[];
}

interface InventoryIssueRow {
  id: string;
  type: "CATEGORY_CONFLICT" | "DUPLICATE_ITEM" | "NAMING_INCONSISTENCY" | "STOCK_ANOMALY" | "PRICE_ANOMALY";
  severity: "HIGH" | "MEDIUM" | "LOW";
  title: string;
  message: string;
  suggestion: string;
  itemIds: string[];
  suggestedCategory?: string;
  suggestedName?: string;
  confidence?: "HIGH" | "MEDIUM" | "LOW" | "NONE";
  autoFixSafe?: boolean;
  affectedCategory?: string;
}

interface InventoryIssuesResponse {
  summary: {
    total: number;
    high: number;
    medium: number;
    low: number;
  };
  categorySummary: Array<{
    category: string;
    label: string;
    itemCount: number;
    totalValue: number;
  }>;
  issues: InventoryIssueRow[];
}

interface ItemFormState {
  name: string;
  sku: string;
  category: string;
  customCategoryLabel: string;
  description: string;
  quantityInStock: string;
  minimumStockLevel: string;
  unitCost: string;
  supplierId: string;
  locationId: string;
  compatibleRigId: string;
  compatibleRigType: string;
  partNumber: string;
  status: "ACTIVE" | "INACTIVE";
  notes: string;
}

interface MovementFormState {
  itemId: string;
  movementType: "IN" | "OUT" | "ADJUSTMENT" | "TRANSFER";
  quantity: string;
  unitCost: string;
  totalCost: string;
  date: string;
  clientId: string;
  projectId: string;
  rigId: string;
  maintenanceRequestId: string;
  supplierId: string;
  locationFromId: string;
  locationToId: string;
  traReceiptNumber: string;
  supplierInvoiceNumber: string;
  receiptUrl: string;
  notes: string;
  createExpense: boolean;
  allowNegativeStock: boolean;
  receiptFile: File | null;
}

interface SupplierFormState {
  name: string;
  contactPerson: string;
  email: string;
  phone: string;
  notes: string;
}

interface LocationFormState {
  name: string;
  description: string;
}

interface UseRequestFormState {
  quantity: string;
  reason: string;
  projectId: string;
  rigId: string;
  maintenanceRequestId: string;
  locationId: string;
  requestedForDate: string;
}

interface InventoryUsageRequestRow {
  id: string;
  quantity: number;
  reason: string;
  status: "SUBMITTED" | "PENDING" | "APPROVED" | "REJECTED";
  decisionNote: string | null;
  requestedForDate: string | null;
  createdAt: string;
  decidedAt: string | null;
  approvedMovementId: string | null;
  item: { id: string; name: string; sku: string } | null;
  project: { id: string; name: string; clientId: string } | null;
  rig: { id: string; rigCode: string } | null;
  location: { id: string; name: string } | null;
  maintenanceRequest: { id: string; requestCode: string; status: string } | null;
  requestedBy: { id: string; fullName: string; role: string } | null;
  decidedBy: { id: string; fullName: string; role: string } | null;
}

const defaultOverview: InventoryOverviewResponse = {
  overview: {
    totalItems: 0,
    totalUnitsInStock: 0,
    totalInventoryValue: 0,
    lowStockCount: 0,
    outOfStockCount: 0,
    recentlyUsedItems: [],
    recentlyPurchasedItems: []
  },
  lowStockItems: [],
  outOfStockItems: [],
  analytics: {
    topUsedItems: [],
    leastUsedItems: [],
    deadStockItems: [],
    highestCostCategories: [],
    monthlyConsumption: [],
    movementTrend: [],
    inventoryCostByRig: [],
    inventoryCostByProject: [],
    recommendations: []
  }
};

const defaultSuggestion: CategorySuggestionState = {
  suggestedCategory: null,
  confidence: "NONE",
  confidenceLabel: "No match",
  reason: "Enter item details to get a category suggestion.",
  matchedKeywords: [],
  similarItems: [],
  alternatives: [],
  mismatchWarning: null,
  existingCategoryNames: [],
  similarCategoryNames: []
};

const defaultIssues: InventoryIssuesResponse = {
  summary: {
    total: 0,
    high: 0,
    medium: 0,
    low: 0
  },
  categorySummary: [],
  issues: []
};

type InventorySection = "overview" | "items" | "stock-movements" | "issues" | "suppliers" | "locations";

function resolveInventorySection(pathname: string | null, sectionQuery: string | null): InventorySection {
  if (pathname === "/inventory/items") return "items";
  if (pathname === "/inventory/stock-movements") return "stock-movements";
  if (pathname === "/inventory/issues") return "issues";
  if (pathname === "/inventory/suppliers") return "suppliers";
  if (pathname === "/inventory/locations") return "locations";

  const requestedSection = (sectionQuery || "overview").toLowerCase();
  if (
    requestedSection === "items" ||
    requestedSection === "stock-movements" ||
    requestedSection === "issues" ||
    requestedSection === "suppliers" ||
    requestedSection === "locations"
  ) {
    return requestedSection;
  }
  return "overview";
}

export default function InventoryPage() {
  return (
    <Suspense fallback={<InventoryPageFallback />}>
      <InventoryPageContent />
    </Suspense>
  );
}

function InventoryPageContent() {
  const { user } = useRole();
  const { filters } = useAnalyticsFilters();
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const canManage = Boolean(user?.role && canAccess(user.role, "inventory:manage"));

  const [clients, setClients] = useState<Array<{ id: string; name: string }>>([]);
  const [projects, setProjects] = useState<Array<{ id: string; name: string; clientId: string }>>([]);
  const [rigs, setRigs] = useState<Array<{ id: string; rigCode: string }>>([]);
  const [maintenanceRequests, setMaintenanceRequests] = useState<Array<{ id: string; requestCode: string }>>([]);
  const [suppliers, setSuppliers] = useState<InventorySupplier[]>([]);
  const [locations, setLocations] = useState<InventoryLocation[]>([]);
  const [items, setItems] = useState<InventoryItemRow[]>([]);
  const [movements, setMovements] = useState<InventoryMovementRow[]>([]);
  const [overview, setOverview] = useState<InventoryOverviewResponse>(defaultOverview);
  const [selectedItemId, setSelectedItemId] = useState<string>("");
  const [selectedItemDetails, setSelectedItemDetails] = useState<InventoryItemDetailsResponse | null>(null);
  const [selectedMovementId, setSelectedMovementId] = useState<string>("");
  const [selectedMovementDetails, setSelectedMovementDetails] = useState<InventoryMovementRow | null>(null);
  const [relatedMovementRows, setRelatedMovementRows] = useState<InventoryMovementRow[]>([]);

  const [itemSearch, setItemSearch] = useState("");
  const [itemCategoryFilter, setItemCategoryFilter] = useState("all");
  const [supplierFilter, setSupplierFilter] = useState("all");
  const [locationFilter, setLocationFilter] = useState("all");
  const [stockFilter, setStockFilter] = useState("all");
  const [movementTypeFilter, setMovementTypeFilter] = useState("all");
  const [movementQuery, setMovementQuery] = useState("");

  const [itemForm, setItemForm] = useState<ItemFormState>(() => ({
    name: "",
    sku: "",
    category: "SPARE_PARTS",
    customCategoryLabel: "",
    description: "",
    quantityInStock: "0",
    minimumStockLevel: "5",
    unitCost: "0",
    supplierId: "",
    locationId: "",
    compatibleRigId: "",
    compatibleRigType: "",
    partNumber: "",
    status: "ACTIVE",
    notes: ""
  }));
  const [categorySuggestion, setCategorySuggestion] = useState<CategorySuggestionState>(defaultSuggestion);
  const [issuesResponse, setIssuesResponse] = useState<InventoryIssuesResponse>(defaultIssues);
  const [suggestionLoading, setSuggestionLoading] = useState(false);
  const [issuesLoading, setIssuesLoading] = useState(false);
  const [showLowPriorityIssues, setShowLowPriorityIssues] = useState(false);
  const [issueSeverityFilter, setIssueSeverityFilter] = useState<"all" | "HIGH" | "MEDIUM" | "LOW">("all");
  const [issueTypeFilter, setIssueTypeFilter] = useState<"all" | InventoryIssueRow["type"]>("all");
  const [issueCategoryFilter, setIssueCategoryFilter] = useState<"all" | string>("all");
  const [issueItemQuery, setIssueItemQuery] = useState("");
  const [itemDetailModalOpen, setItemDetailModalOpen] = useState(false);
  const [movementDetailDrawerOpen, setMovementDetailDrawerOpen] = useState(false);
  const [showCreateItemForm, setShowCreateItemForm] = useState(false);
  const [requestUseModalOpen, setRequestUseModalOpen] = useState(false);
  const [submittingUseRequest, setSubmittingUseRequest] = useState(false);
  const [useRequestError, setUseRequestError] = useState<string | null>(null);
  const [usageRequestsLoading, setUsageRequestsLoading] = useState(false);
  const [usageRequestStatusFilter, setUsageRequestStatusFilter] = useState<
    "ALL" | "SUBMITTED" | "PENDING" | "APPROVED" | "REJECTED"
  >("ALL");
  const [myUsageRequests, setMyUsageRequests] = useState<InventoryUsageRequestRow[]>([]);
  const [usageRequestToast, setUsageRequestToast] = useState<{
    tone: "success" | "error";
    message: string;
  } | null>(null);
  const [useRequestForm, setUseRequestForm] = useState<UseRequestFormState>({
    quantity: "",
    reason: "",
    projectId: "",
    rigId: "",
    maintenanceRequestId: "",
    locationId: "",
    requestedForDate: new Date().toISOString().slice(0, 10)
  });

  const [movementForm, setMovementForm] = useState<MovementFormState>(() => ({
    itemId: "",
    movementType: "OUT",
    quantity: "",
    unitCost: "",
    totalCost: "",
    date: new Date().toISOString().slice(0, 10),
    clientId: "",
    projectId: "",
    rigId: "",
    maintenanceRequestId: "",
    supplierId: "",
    locationFromId: "",
    locationToId: "",
    traReceiptNumber: "",
    supplierInvoiceNumber: "",
    receiptUrl: "",
    notes: "",
    createExpense: true,
    allowNegativeStock: false,
    receiptFile: null
  }));

  const [supplierForm, setSupplierForm] = useState<SupplierFormState>({
    name: "",
    contactPerson: "",
    email: "",
    phone: "",
    notes: ""
  });

  const [locationForm, setLocationForm] = useState<LocationFormState>({
    name: "",
    description: ""
  });

  const [loading, setLoading] = useState(true);
  const [savingItem, setSavingItem] = useState(false);
  const [savingMovement, setSavingMovement] = useState(false);
  const [savingSupplier, setSavingSupplier] = useState(false);
  const [savingLocation, setSavingLocation] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [focusedRowId, setFocusedRowId] = useState<string | null>(null);
  const [focusedSectionId, setFocusedSectionId] = useState<string | null>(null);

  const selectedClientLabel = useMemo(() => {
    if (filters.clientId === "all") {
      return null;
    }
    return clients.find((client) => client.id === filters.clientId)?.name || null;
  }, [clients, filters.clientId]);

  const selectedRigLabel = useMemo(() => {
    if (filters.rigId === "all") {
      return null;
    }
    return rigs.find((rig) => rig.id === filters.rigId)?.rigCode || null;
  }, [filters.rigId, rigs]);

  const filteredProjectsForMovement = useMemo(() => {
    if (!movementForm.clientId) {
      return projects;
    }
    return projects.filter((project) => project.clientId === movementForm.clientId);
  }, [movementForm.clientId, projects]);

  const lowStockItems = useMemo(() => overview.lowStockItems || [], [overview.lowStockItems]);
  const outOfStockItems = useMemo(() => overview.outOfStockItems || [], [overview.outOfStockItems]);
  const stockAlertRows = useMemo(
    () => [
      ...outOfStockItems.map((item) => ({
        id: `out-${item.id}`,
        name: item.name,
        sku: item.sku,
        quantityInStock: 0,
        minimumStockLevel: item.minimumStockLevel,
        severity: "CRITICAL" as const
      })),
      ...lowStockItems.map((item) => ({
        id: `low-${item.id}`,
        name: item.name,
        sku: item.sku,
        quantityInStock: item.quantityInStock,
        minimumStockLevel: item.minimumStockLevel,
        severity: "LOW" as const
      }))
    ],
    [lowStockItems, outOfStockItems]
  );
  const filteredMovements = useMemo(() => {
    const query = movementQuery.trim().toLowerCase();
    return movements.filter((movement) => {
      if (movementTypeFilter !== "all" && movement.movementType !== movementTypeFilter) {
        return false;
      }
      if (!query) {
        return true;
      }
      const haystack = [
        movement.item?.name || "",
        movement.item?.sku || "",
        movement.project?.name || "",
        movement.rig?.rigCode || "",
        movement.client?.name || "",
        movement.supplier?.name || "",
        movement.maintenanceRequest?.requestCode || ""
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [movementQuery, movementTypeFilter, movements]);
  const selectedItemIssues = useMemo(() => {
    if (!selectedItemId) {
      return [];
    }
    return issuesResponse.issues.filter((issue) => issue.itemIds.includes(selectedItemId));
  }, [issuesResponse.issues, selectedItemId]);
  const itemById = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);
  const issueCategoryOptions = useMemo(() => {
    const values = new Set<string>();
    for (const issue of issuesResponse.issues) {
      if (issue.affectedCategory) {
        values.add(issue.affectedCategory);
        continue;
      }
      for (const itemId of issue.itemIds) {
        const category = itemById.get(itemId)?.category;
        if (category) {
          values.add(category);
        }
      }
    }
    return Array.from(values).sort((a, b) => a.localeCompare(b));
  }, [issuesResponse.issues, itemById]);
  const filteredIssues = useMemo(() => {
    const query = issueItemQuery.trim().toLowerCase();
    const rows = issuesResponse.issues.filter((issue) => {
      if (!showLowPriorityIssues && issue.severity === "LOW") {
        return false;
      }
      if (issueSeverityFilter !== "all" && issue.severity !== issueSeverityFilter) {
        return false;
      }
      if (issueTypeFilter !== "all" && issue.type !== issueTypeFilter) {
        return false;
      }
      if (issueCategoryFilter !== "all") {
        const matchedCategory =
          issue.affectedCategory ||
          issue.itemIds.map((itemId) => itemById.get(itemId)?.category).find(Boolean) ||
          "";
        if (matchedCategory !== issueCategoryFilter) {
          return false;
        }
      }
      if (query) {
        const names = issue.itemIds
          .map((itemId) => itemById.get(itemId)?.name || "")
          .join(" ")
          .toLowerCase();
        if (!names.includes(query) && !issue.title.toLowerCase().includes(query) && !issue.message.toLowerCase().includes(query)) {
          return false;
        }
      }
      return true;
    });

    return [...rows].sort((a, b) => {
      const severityOrder = { HIGH: 0, MEDIUM: 1, LOW: 2 };
      if (severityOrder[a.severity] !== severityOrder[b.severity]) {
        return severityOrder[a.severity] - severityOrder[b.severity];
      }
      const confidenceOrder = { HIGH: 0, MEDIUM: 1, LOW: 2, NONE: 3, undefined: 4 } as Record<string, number>;
      return (confidenceOrder[a.confidence || "undefined"] || 4) - (confidenceOrder[b.confidence || "undefined"] || 4);
    });
  }, [
    issueCategoryFilter,
    issueItemQuery,
    issueSeverityFilter,
    issueTypeFilter,
    issuesResponse.issues,
    itemById,
    showLowPriorityIssues
  ]);
  const lowPriorityHiddenCount = useMemo(
    () => issuesResponse.issues.filter((issue) => issue.severity === "LOW").length,
    [issuesResponse.issues]
  );
  const lowRiskNamingFixes = useMemo(
    () => {
      const byItemId = new Map<string, { itemId: string; suggestedName: string }>();
      for (const issue of issuesResponse.issues) {
        if (
          issue.type !== "NAMING_INCONSISTENCY" ||
          issue.severity !== "LOW" ||
          !issue.autoFixSafe ||
          !issue.suggestedName ||
          issue.itemIds.length === 0
        ) {
          continue;
        }
        const itemId = issue.itemIds[0];
        if (!byItemId.has(itemId)) {
          byItemId.set(itemId, {
            itemId,
            suggestedName: issue.suggestedName
          });
        }
      }
      return Array.from(byItemId.values());
    },
    [issuesResponse.issues]
  );
  const suggestionMismatch =
    categorySuggestion.suggestedCategory &&
    categorySuggestion.confidence !== "NONE" &&
    itemForm.category &&
    itemForm.category !== categorySuggestion.suggestedCategory;

  const loadReferenceData = useCallback(async () => {
    const [clientsRes, projectsRes, rigsRes, maintenanceRes, suppliersRes, locationsRes] = await Promise.all([
      fetch("/api/clients", { cache: "no-store" }),
      fetch("/api/projects", { cache: "no-store" }),
      fetch("/api/rigs", { cache: "no-store" }),
      fetch("/api/maintenance-requests", { cache: "no-store" }),
      fetch("/api/inventory/suppliers", { cache: "no-store" }),
      fetch("/api/inventory/locations", { cache: "no-store" })
    ]);

    const [clientsPayload, projectsPayload, rigsPayload, maintenancePayload, suppliersPayload, locationsPayload] =
      await Promise.all([
        clientsRes.ok ? clientsRes.json() : Promise.resolve({ data: [] }),
        projectsRes.ok ? projectsRes.json() : Promise.resolve({ data: [] }),
        rigsRes.ok ? rigsRes.json() : Promise.resolve({ data: [] }),
        maintenanceRes.ok ? maintenanceRes.json() : Promise.resolve({ data: [] }),
        suppliersRes.ok ? suppliersRes.json() : Promise.resolve({ data: [] }),
        locationsRes.ok ? locationsRes.json() : Promise.resolve({ data: [] })
      ]);

    setClients((clientsPayload.data || []).map((client: { id: string; name: string }) => ({ id: client.id, name: client.name })));
    setProjects(
      (projectsPayload.data || []).map((project: { id: string; name: string; clientId: string }) => ({
        id: project.id,
        name: project.name,
        clientId: project.clientId
      }))
    );
    setRigs((rigsPayload.data || []).map((rig: { id: string; rigCode: string }) => ({ id: rig.id, rigCode: rig.rigCode })));
    setMaintenanceRequests(
      (maintenancePayload.data || []).map((requestRow: { id: string; requestCode?: string }) => ({
        id: requestRow.id,
        requestCode: requestRow.requestCode || requestRow.id
      }))
    );
    setSuppliers(suppliersPayload.data || []);
    setLocations(locationsPayload.data || []);
  }, []);

  const loadInventoryData = useCallback(async () => {
    setLoading(true);
    setErrorMessage(null);
    setIssuesLoading(true);
    try {
      const query = new URLSearchParams();
      if (itemSearch.trim()) query.set("search", itemSearch.trim());
      if (itemCategoryFilter !== "all") query.set("category", itemCategoryFilter);
      if (supplierFilter !== "all") query.set("supplierId", supplierFilter);
      if (locationFilter !== "all") query.set("locationId", locationFilter);
      if (stockFilter !== "all") query.set("stock", stockFilter);

      const movementQuery = new URLSearchParams();
      if (filters.from) movementQuery.set("from", filters.from);
      if (filters.to) movementQuery.set("to", filters.to);
      if (filters.clientId !== "all") movementQuery.set("clientId", filters.clientId);
      if (filters.rigId !== "all") movementQuery.set("rigId", filters.rigId);

      const [itemsRes, movementsRes, overviewRes, issuesRes] = await Promise.all([
        fetch(`/api/inventory/items?${query.toString()}`, { cache: "no-store" }),
        fetch(`/api/inventory/movements?${movementQuery.toString()}`, { cache: "no-store" }),
        fetch(`/api/inventory/overview?${movementQuery.toString()}`, { cache: "no-store" }),
        fetch(`/api/inventory/issues?${movementQuery.toString()}`, { cache: "no-store" })
      ]);

      const [itemsPayload, movementsPayload, overviewPayload, issuesPayload] = await Promise.all([
        itemsRes.ok ? itemsRes.json() : Promise.resolve({ data: [] }),
        movementsRes.ok ? movementsRes.json() : Promise.resolve({ data: [] }),
        overviewRes.ok ? overviewRes.json() : Promise.resolve(defaultOverview),
        issuesRes.ok ? issuesRes.json() : Promise.resolve(defaultIssues)
      ]);

      setItems(itemsPayload.data || []);
      setMovements(movementsPayload.data || []);
      setOverview(overviewPayload || defaultOverview);
      setIssuesResponse(issuesPayload || defaultIssues);
      if (!selectedItemId && itemsPayload.data?.[0]?.id) {
        setSelectedItemId(itemsPayload.data[0].id);
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to load inventory data.");
      setItems([]);
      setMovements([]);
      setOverview(defaultOverview);
      setIssuesResponse(defaultIssues);
    } finally {
      setLoading(false);
      setIssuesLoading(false);
    }
  }, [filters.clientId, filters.from, filters.rigId, filters.to, itemCategoryFilter, itemSearch, locationFilter, selectedItemId, stockFilter, supplierFilter]);

  const loadMyUsageRequests = useCallback(
    async (statusOverride?: "ALL" | "SUBMITTED" | "PENDING" | "APPROVED" | "REJECTED") => {
    if (!user?.id) {
      setMyUsageRequests([]);
      return;
    }

    setUsageRequestsLoading(true);
    try {
      const query = new URLSearchParams();
      query.set("scope", "mine");
      query.set("requestedBy", "me");
      query.set("status", statusOverride || usageRequestStatusFilter);
      if (filters.from) query.set("from", filters.from);
      if (filters.to) query.set("to", filters.to);
      if (filters.clientId !== "all") query.set("clientId", filters.clientId);
      if (filters.rigId !== "all") query.set("rigId", filters.rigId);

      const response = await fetch(`/api/inventory/usage-requests?${query.toString()}`, { cache: "no-store" });
      if (!response.ok) {
        throw new Error(await readApiError(response, "Failed to load your usage requests."));
      }
      const payload = (await response.json()) as { data?: InventoryUsageRequestRow[] };
      setMyUsageRequests(payload.data || []);
    } catch {
      setMyUsageRequests([]);
    } finally {
      setUsageRequestsLoading(false);
    }
    },
    [filters.clientId, filters.from, filters.rigId, filters.to, usageRequestStatusFilter, user?.id]
  );

  const loadSelectedItemDetails = useCallback(async () => {
    if (!selectedItemId) {
      setSelectedItemDetails(null);
      return;
    }
    const query = new URLSearchParams();
    if (filters.from) query.set("from", filters.from);
    if (filters.to) query.set("to", filters.to);
    if (filters.clientId !== "all") query.set("clientId", filters.clientId);
    if (filters.rigId !== "all") query.set("rigId", filters.rigId);

    const response = await fetch(`/api/inventory/items/${selectedItemId}?${query.toString()}`, {
      cache: "no-store"
    });
    const payload = response.ok ? await response.json() : null;
    setSelectedItemDetails(payload);
  }, [filters.clientId, filters.from, filters.rigId, filters.to, selectedItemId]);

  const loadSelectedMovementDetails = useCallback(async () => {
    if (!selectedMovementId) {
      setSelectedMovementDetails(null);
      setRelatedMovementRows([]);
      return;
    }
    try {
      const response = await fetch(`/api/inventory/movements/${selectedMovementId}`, { cache: "no-store" });
      if (!response.ok) {
        throw new Error(await readApiError(response, "Failed to load movement details."));
      }
      const payload = await response.json();
      setSelectedMovementDetails((payload?.data || null) as InventoryMovementRow | null);
      setRelatedMovementRows((payload?.relatedMovements || []) as InventoryMovementRow[]);
    } catch {
      setSelectedMovementDetails(null);
      setRelatedMovementRows([]);
    }
  }, [selectedMovementId]);

  const loadCategorySuggestion = useCallback(async () => {
    if (!itemForm.name.trim() && !itemForm.sku.trim() && !itemForm.description.trim()) {
      setCategorySuggestion(defaultSuggestion);
      return;
    }

    setSuggestionLoading(true);
    try {
      const query = new URLSearchParams();
      query.set("name", itemForm.name);
      query.set("sku", itemForm.sku);
      query.set("description", itemForm.description);
      query.set("selectedCategory", itemForm.category);
      if (itemForm.supplierId) {
        query.set("supplierId", itemForm.supplierId);
      }
      if (itemForm.customCategoryLabel) {
        query.set("customCategory", itemForm.customCategoryLabel);
      }

      const response = await fetch(`/api/inventory/intelligence/suggest?${query.toString()}`, {
        cache: "no-store"
      });
      if (!response.ok) {
        setCategorySuggestion(defaultSuggestion);
        return;
      }

      const payload = await response.json();
      setCategorySuggestion({
        suggestedCategory: payload.suggestedCategory || null,
        confidence: payload.confidence || "NONE",
        confidenceLabel: payload.confidenceLabel || "No match",
        reason: payload.reason || "No strong category match found.",
        matchedKeywords: payload.matchedKeywords || [],
        similarItems: payload.similarItems || [],
        alternatives: payload.alternatives || [],
        mismatchWarning: payload.mismatchWarning || null,
        existingCategoryNames: payload.existingCategoryNames || [],
        similarCategoryNames: payload.similarCategoryNames || []
      });
    } catch {
      setCategorySuggestion(defaultSuggestion);
    } finally {
      setSuggestionLoading(false);
    }
  }, [
    itemForm.category,
    itemForm.customCategoryLabel,
    itemForm.description,
    itemForm.name,
    itemForm.sku,
    itemForm.supplierId
  ]);

  useEffect(() => {
    void loadReferenceData();
  }, [loadReferenceData]);

  useEffect(() => {
    void loadInventoryData();
  }, [loadInventoryData]);

  useEffect(() => {
    void loadMyUsageRequests();
  }, [loadMyUsageRequests]);

  useEffect(() => {
    void loadSelectedItemDetails();
  }, [loadSelectedItemDetails]);

  useEffect(() => {
    void loadSelectedMovementDetails();
  }, [loadSelectedMovementDetails]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void loadCategorySuggestion();
    }, 260);
    return () => window.clearTimeout(timeoutId);
  }, [loadCategorySuggestion]);

  useEffect(() => {
    const itemIdFromUrl = searchParams.get("itemId") || "";
    if (itemIdFromUrl && itemIdFromUrl !== selectedItemId) {
      setSelectedItemId(itemIdFromUrl);
      setItemDetailModalOpen(true);
    }
    const movementIdFromUrl = searchParams.get("movementId") || "";
    if (movementIdFromUrl && movementIdFromUrl !== selectedMovementId) {
      setSelectedMovementId(movementIdFromUrl);
      setMovementDetailDrawerOpen(true);
    }
  }, [searchParams, selectedItemId, selectedMovementId]);

  useEffect(() => {
    const movementItemId = searchParams.get("movementItemId") || "";
    const movementType = (searchParams.get("movementType") || "").toUpperCase();
    if (!movementItemId && !movementType) {
      return;
    }
    setMovementForm((current) => ({
      ...current,
      itemId: movementItemId || current.itemId,
      movementType:
        movementType === "IN" || movementType === "OUT" || movementType === "ADJUSTMENT" || movementType === "TRANSFER"
          ? (movementType as MovementFormState["movementType"])
          : current.movementType
    }));
  }, [searchParams]);

  useEffect(() => {
    if (pathname !== "/inventory/items") {
      setShowCreateItemForm(false);
      return;
    }
    if (searchParams.get("create") === "1") {
      setShowCreateItemForm(true);
    }
  }, [pathname, searchParams]);

  async function submitItemForm(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSavingItem(true);
    setNotice(null);
    setErrorMessage(null);

    try {
      const customCategoryLabel = itemForm.customCategoryLabel.trim();
      const mergedNotes = [itemForm.notes.trim(), customCategoryLabel ? `Category Label: ${customCategoryLabel}` : ""]
        .filter(Boolean)
        .join("\n");

      const response = await fetch("/api/inventory/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: itemForm.name,
          sku: itemForm.sku,
          category: itemForm.category,
          description: itemForm.description || null,
          quantityInStock: Number(itemForm.quantityInStock || 0),
          minimumStockLevel: Number(itemForm.minimumStockLevel || 0),
          unitCost: Number(itemForm.unitCost || 0),
          supplierId: itemForm.supplierId || null,
          locationId: itemForm.locationId || null,
          compatibleRigId: itemForm.compatibleRigId || null,
          compatibleRigType: itemForm.compatibleRigType || null,
          partNumber: itemForm.partNumber || null,
          status: itemForm.status,
          notes: mergedNotes || null
        })
      });

      if (!response.ok) {
        throw new Error(await readApiError(response, "Failed to create inventory item."));
      }

      setNotice("Inventory item created.");
      setItemForm({
        name: "",
        sku: "",
        category: "SPARE_PARTS",
        customCategoryLabel: "",
        description: "",
        quantityInStock: "0",
        minimumStockLevel: "5",
        unitCost: "0",
        supplierId: "",
        locationId: "",
        compatibleRigId: "",
        compatibleRigType: "",
        partNumber: "",
        status: "ACTIVE",
        notes: ""
      });
      setCategorySuggestion(defaultSuggestion);
      await loadInventoryData();
      await loadReferenceData();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to create inventory item.");
    } finally {
      setSavingItem(false);
    }
  }

  async function submitMovementForm(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSavingMovement(true);
    setNotice(null);
    setErrorMessage(null);

    try {
      const endpoint = "/api/inventory/movements";
      let response: Response;
      if (movementForm.receiptFile) {
        const formData = new FormData();
        formData.set("itemId", movementForm.itemId);
        formData.set("movementType", movementForm.movementType);
        formData.set("quantity", movementForm.quantity);
        formData.set("unitCost", movementForm.unitCost);
        formData.set("totalCost", movementForm.totalCost);
        formData.set("date", movementForm.date);
        formData.set("clientId", movementForm.clientId);
        formData.set("projectId", movementForm.projectId);
        formData.set("rigId", movementForm.rigId);
        formData.set("maintenanceRequestId", movementForm.maintenanceRequestId);
        formData.set("supplierId", movementForm.supplierId);
        formData.set("locationFromId", movementForm.locationFromId);
        formData.set("locationToId", movementForm.locationToId);
        formData.set("traReceiptNumber", movementForm.traReceiptNumber);
        formData.set("supplierInvoiceNumber", movementForm.supplierInvoiceNumber);
        formData.set("notes", movementForm.notes);
        formData.set("createExpense", String(movementForm.createExpense));
        formData.set("allowNegativeStock", String(movementForm.allowNegativeStock));
        formData.set("receipt", movementForm.receiptFile);
        response = await fetch(endpoint, {
          method: "POST",
          body: formData
        });
      } else {
        response = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            itemId: movementForm.itemId,
            movementType: movementForm.movementType,
            quantity: Number(movementForm.quantity),
            unitCost: movementForm.unitCost ? Number(movementForm.unitCost) : null,
            totalCost: movementForm.totalCost ? Number(movementForm.totalCost) : null,
            date: movementForm.date,
            clientId: movementForm.clientId || null,
            projectId: movementForm.projectId || null,
            rigId: movementForm.rigId || null,
            maintenanceRequestId: movementForm.maintenanceRequestId || null,
            supplierId: movementForm.supplierId || null,
            locationFromId: movementForm.locationFromId || null,
            locationToId: movementForm.locationToId || null,
            traReceiptNumber: movementForm.traReceiptNumber || null,
            supplierInvoiceNumber: movementForm.supplierInvoiceNumber || null,
            receiptUrl: movementForm.receiptUrl || null,
            notes: movementForm.notes || null,
            createExpense: movementForm.createExpense,
            allowNegativeStock: movementForm.allowNegativeStock
          })
        });
      }

      if (!response.ok) {
        throw new Error(await readApiError(response, "Failed to create stock movement."));
      }

      setNotice("Stock movement recorded and inventory updated.");
      setMovementForm((current) => ({
        ...current,
        quantity: "",
        unitCost: "",
        totalCost: "",
        notes: "",
        traReceiptNumber: "",
        supplierInvoiceNumber: "",
        receiptUrl: "",
        receiptFile: null
      }));
      await loadInventoryData();
      await loadSelectedItemDetails();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to create stock movement.");
    } finally {
      setSavingMovement(false);
    }
  }

  async function submitSupplierForm(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSavingSupplier(true);
    setErrorMessage(null);

    try {
      const response = await fetch("/api/inventory/suppliers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: supplierForm.name,
          contactPerson: supplierForm.contactPerson || null,
          email: supplierForm.email || null,
          phone: supplierForm.phone || null,
          notes: supplierForm.notes || null
        })
      });
      if (!response.ok) {
        throw new Error(await readApiError(response, "Failed to create supplier."));
      }
      setNotice("Supplier created.");
      setSupplierForm({ name: "", contactPerson: "", email: "", phone: "", notes: "" });
      await loadReferenceData();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to create supplier.");
    } finally {
      setSavingSupplier(false);
    }
  }

  async function submitLocationForm(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSavingLocation(true);
    setErrorMessage(null);

    try {
      const response = await fetch("/api/inventory/locations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: locationForm.name,
          description: locationForm.description || null
        })
      });
      if (!response.ok) {
        throw new Error(await readApiError(response, "Failed to create location."));
      }
      setNotice("Location created.");
      setLocationForm({ name: "", description: "" });
      await loadReferenceData();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to create location.");
    } finally {
      setSavingLocation(false);
    }
  }

  async function applyIssueQuickFix(issue: InventoryIssueRow, fix: "category" | "name") {
    const targetItemId = issue.itemIds[0];
    if (!targetItemId) {
      return;
    }

    const payload: Record<string, string> = {};
    if (fix === "category") {
      if (!issue.suggestedCategory) {
        return;
      }
      payload.category = issue.suggestedCategory;
    } else {
      if (!issue.suggestedName) {
        return;
      }
      payload.name = issue.suggestedName;
    }

    setErrorMessage(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/inventory/items/${targetItemId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (!response.ok) {
        throw new Error(await readApiError(response, "Failed to apply quick fix."));
      }
      setNotice("Inventory issue quick fix applied.");
      await loadInventoryData();
      if (selectedItemId === targetItemId) {
        await loadSelectedItemDetails();
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to apply quick fix.");
    }
  }

  async function applyNamingAutoFix(itemId: string, suggestedName: string) {
    if (!itemId || !suggestedName) {
      return;
    }
    setErrorMessage(null);
    setNotice(null);
    try {
      const response = await fetch("/api/inventory/issues/auto-fix-naming", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fixes: [{ itemId, suggestedName }]
        })
      });
      if (!response.ok) {
        throw new Error(await readApiError(response, "Failed to auto-fix naming."));
      }
      setNotice("Naming format standardized.");
      await loadInventoryData();
      if (selectedItemId === itemId) {
        await loadSelectedItemDetails();
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to auto-fix naming.");
    }
  }

  async function applyBulkLowRiskNamingAutoFix() {
    if (lowRiskNamingFixes.length === 0) {
      return;
    }
    setErrorMessage(null);
    setNotice(null);
    try {
      const response = await fetch("/api/inventory/issues/auto-fix-naming", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fixes: lowRiskNamingFixes
        })
      });
      if (!response.ok) {
        throw new Error(await readApiError(response, "Failed to auto-fix low-risk naming issues."));
      }
      const payload = await response.json().catch(() => null);
      const updatedCount = Number(payload?.data?.updatedCount || 0);
      setNotice(updatedCount > 0 ? `Applied ${updatedCount} low-risk naming auto-fix(es).` : "No naming fixes were needed.");
      await loadInventoryData();
      await loadSelectedItemDetails();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to auto-fix low-risk naming issues.");
    }
  }

  async function mergeDuplicateIssue(issue: InventoryIssueRow) {
    if (issue.type !== "DUPLICATE_ITEM" || issue.itemIds.length < 2) {
      return;
    }

    const [primaryItemId, ...duplicateItemIds] = issue.itemIds;
    setErrorMessage(null);
    setNotice(null);
    try {
      const response = await fetch("/api/inventory/items/merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ primaryItemId, duplicateItemIds })
      });
      if (!response.ok) {
        throw new Error(await readApiError(response, "Failed to merge duplicate items."));
      }
      setNotice("Duplicate inventory items merged successfully.");
      setSelectedItemId(primaryItemId);
      await loadInventoryData();
      await loadSelectedItemDetails();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to merge duplicate items.");
    }
  }

  function focusStockAdjustment(itemId: string) {
    if (!itemId) {
      return;
    }
    const query = new URLSearchParams();
    query.set("movementItemId", itemId);
    query.set("movementType", "ADJUSTMENT");
    router.push(`/inventory/stock-movements?${query.toString()}`);
  }

  function focusPricingReview(itemId: string) {
    if (!itemId) {
      return;
    }
    router.push(`/inventory/items?itemId=${encodeURIComponent(itemId)}`);
  }

  function openItemDetail(itemId: string) {
    if (!itemId) {
      return;
    }
    setSelectedItemId(itemId);
    setItemDetailModalOpen(true);
  }

  function openMovementDetail(movementId: string) {
    if (!movementId) {
      return;
    }
    setSelectedMovementId(movementId);
    setMovementDetailDrawerOpen(true);
  }

  function openRequestUseModal() {
    if (!selectedItemDetails?.data?.id) {
      return;
    }
    setUseRequestError(null);
    setUseRequestForm({
      quantity: "1",
      reason: "",
      projectId: "",
      rigId: selectedItemDetails.data.compatibleRigId || "",
      maintenanceRequestId: "",
      locationId: selectedItemDetails.data.locationId || "",
      requestedForDate: new Date().toISOString().slice(0, 10)
    });
    setRequestUseModalOpen(true);
  }

  async function submitUseRequest(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedItemDetails?.data?.id) {
      setErrorMessage("Select an inventory item before requesting usage.");
      return;
    }

    setSubmittingUseRequest(true);
    setErrorMessage(null);
    setNotice(null);
    setUseRequestError(null);

    try {
      const quantity = Number(useRequestForm.quantity);
      if (!Number.isFinite(quantity) || quantity <= 0) {
        throw new Error("Quantity must be greater than zero.");
      }
      if (selectedItemDetails.data.status !== "ACTIVE") {
        throw new Error("Only active inventory items can be requested.");
      }
      if (!useRequestForm.projectId) {
        throw new Error("Project is required.");
      }
      if (!useRequestForm.rigId) {
        throw new Error("Rig is required.");
      }
      if (!useRequestForm.reason.trim()) {
        throw new Error("Reason is required.");
      }

      const response = await fetch("/api/inventory/usage-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          itemId: selectedItemDetails.data.id,
          quantity,
          reason: useRequestForm.reason.trim(),
          projectId: useRequestForm.projectId || null,
          rigId: useRequestForm.rigId || null,
          maintenanceRequestId: useRequestForm.maintenanceRequestId || null,
          locationId: useRequestForm.locationId || null,
          requestedForDate: useRequestForm.requestedForDate || null
        })
      });

      if (!response.ok) {
        throw new Error(await readApiError(response, "Failed to submit item usage request."));
      }

      setNotice("Inventory usage request submitted for approval.");
      setUsageRequestToast({
        tone: "success",
        message: "Usage request submitted. It is now pending approval."
      });
      setUsageRequestStatusFilter("ALL");
      setUseRequestError(null);
      setRequestUseModalOpen(false);
      setUseRequestForm({
        quantity: "",
        reason: "",
        projectId: "",
        rigId: "",
        maintenanceRequestId: "",
        locationId: "",
        requestedForDate: new Date().toISOString().slice(0, 10)
      });
      await loadMyUsageRequests("ALL");
    } catch (error) {
      const nextMessage = error instanceof Error ? error.message : "Failed to submit item usage request.";
      setErrorMessage(nextMessage);
      setUseRequestError(nextMessage);
      setUsageRequestToast({
        tone: "error",
        message: nextMessage
      });
    } finally {
      setSubmittingUseRequest(false);
    }
  }

  function closeRequestUseModal() {
    setRequestUseModalOpen(false);
    setUseRequestError(null);
  }

  const inventorySection = resolveInventorySection(pathname, searchParams.get("section"));
  const showOverview = inventorySection === "overview";
  const showItems = inventorySection === "items";
  const showMovements = inventorySection === "stock-movements";
  const showIssues = inventorySection === "issues";
  const showSuppliers = inventorySection === "suppliers";
  const showLocations = inventorySection === "locations";
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
    ? "Dashboard summary and quick navigation for inventory operations."
    : showItems
      ? "Manage items, stock levels, suppliers, and linked history from one workspace."
      : showMovements
        ? "Record stock changes and review movement history with linked records."
        : showIssues
          ? "Detect, prioritize, and resolve inventory data quality issues."
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

  const buildHref = useCallback(
    (path: string, overrides?: Record<string, string | null | undefined>) => buildScopedHref(filters, path, overrides),
    [filters]
  );

  const copilotContext = useMemo<CopilotPageContext>(() => {
    const summaryMetrics: CopilotPageContext["summaryMetrics"] = [
      { key: "totalItems", label: "Total Items", value: overview.overview.totalItems },
      { key: "unitsInStock", label: "Units In Stock", value: overview.overview.totalUnitsInStock },
      { key: "inventoryValue", label: "Inventory Value", value: overview.overview.totalInventoryValue },
      { key: "lowStock", label: "Low Stock", value: overview.overview.lowStockCount },
      { key: "outOfStock", label: "Out of Stock", value: overview.overview.outOfStockCount },
      { key: "inventoryIssues", label: "Inventory Issues", value: issuesResponse.summary.total },
      { key: "movements", label: "Recent Movements", value: movements.length }
    ];

    const tablePreviews: CopilotPageContext["tablePreviews"] = [];
    if (showOverview) {
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
    if (showIssues) {
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
          suggestion: issue.suggestion,
          href: buildHref("/inventory/issues"),
          sectionId: "inventory-issues-section",
          targetPageKey: "inventory-issues"
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
      ...stockAlertRows.slice(0, 3).map((item) => ({
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
      })),
      ...filteredIssues
        .filter((issue) => issue.severity === "HIGH" || issue.severity === "MEDIUM")
        .slice(0, 3)
        .map((issue) => ({
          id: issue.id,
          label: issue.title,
          reason: issue.message,
          severity: issue.severity === "HIGH" ? ("HIGH" as const) : ("MEDIUM" as const),
          amount: null,
          href: buildHref("/inventory/issues"),
          issueType: issue.type,
          sectionId: "inventory-issues-section",
          targetPageKey: "inventory-issues",
          confidence: issue.confidence && issue.confidence !== "NONE" ? issue.confidence : null
        })),
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
        {
          label: "Open Receipt Intake",
          href: buildHref("/inventory/receipt-intake"),
          reason: "Process receipts and link evidence.",
          pageKey: "inventory-receipt-intake"
        },
        {
          label: "Open Inventory Issues",
          href: buildHref("/inventory/issues"),
          reason: "Resolve inventory data-quality risks.",
          pageKey: "inventory-issues",
          sectionId: "inventory-issues-section"
        }
      ],
      notes: [
        `Current inventory workspace section: ${pageTitle}.`,
        "Use global AI Copilot for page-level triage; item and movement edits still require explicit user actions."
      ]
    };
  }, [
    buildHref,
    copilotPageKey,
    filters.clientId,
    filters.from,
    filters.rigId,
    filters.to,
    filteredIssues,
    filteredMovements,
    items,
    issuesResponse.summary.total,
    locations,
    movements.length,
    overview.overview.lowStockCount,
    overview.overview.outOfStockCount,
    overview.overview.totalInventoryValue,
    overview.overview.totalItems,
    overview.overview.totalUnitsInStock,
    pageTitle,
    selectedItemDetails?.data?.name,
    selectedItemId,
    showIssues,
    showLocations,
    showMovements,
    showItems,
    showOverview,
    showSuppliers,
    stockAlertRows,
    suppliers
  ]);

  useRegisterCopilotContext(copilotContext);

  useCopilotFocusTarget({
    pageKey: copilotPageKey,
    onFocus: (target) => {
      setFocusedRowId(target.targetId || null);
      setFocusedSectionId(target.sectionId || null);
      if (target.targetId && showItems) {
        openItemDetail(target.targetId);
      } else if (target.targetId && showMovements) {
        openMovementDetail(target.targetId);
      }
      scrollToFocusElement({
        sectionId: target.sectionId,
        targetId: target.targetId
      });
    }
  });

  useEffect(() => {
    if (!focusedRowId && !focusedSectionId) {
      return;
    }
    const timeout = window.setTimeout(() => {
      setFocusedRowId(null);
      setFocusedSectionId(null);
    }, 2600);
    return () => window.clearTimeout(timeout);
  }, [focusedRowId, focusedSectionId]);

  useEffect(() => {
    if (!usageRequestToast) {
      return;
    }
    const timeout = window.setTimeout(() => {
      setUsageRequestToast(null);
    }, 4200);
    return () => window.clearTimeout(timeout);
  }, [usageRequestToast]);

  return (
    <AccessGate permission="inventory:view">
      <div className="gf-page-stack space-y-4 md:space-y-5">
        {notice && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{notice}</div>
        )}
        {errorMessage && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{errorMessage}</div>
        )}

        <FilterScopeBanner filters={filters} clientLabel={selectedClientLabel} rigLabel={selectedRigLabel} />

        <section className="gf-page-header">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h1 className="text-2xl font-semibold tracking-tight text-ink-900 md:text-[1.7rem]">{pageTitle}</h1>
              <p className="mt-1 text-sm text-slate-600">{pageSubtitle}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {showOverview ? (
                <>
                  {canManage ? (
                    <>
                      <Link href="/inventory/items?create=1" className="gf-btn-primary px-3 py-1.5 text-xs">
                        New Item
                      </Link>
                      <Link href="/inventory/stock-movements" className="gf-btn-secondary px-3 py-1.5 text-xs">
                        Record Movement
                      </Link>
                    </>
                  ) : null}
                  <Link href="/inventory/receipt-intake" className="gf-btn-secondary px-3 py-1.5 text-xs">
                    Scan Receipt
                  </Link>
                </>
              ) : (
                <>
                  <Link href="/inventory" className="gf-btn-secondary px-3 py-1.5 text-xs">
                    Back to Overview
                  </Link>
                  <Link href="/inventory/receipt-intake" className="gf-btn-secondary px-3 py-1.5 text-xs">
                    Open Receipt Intake
                  </Link>
                </>
              )}
            </div>
          </div>
          <div className="mt-4 border-t border-slate-200/80" />
        </section>

        {showOverview && (
        <section className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
          <MetricCard label="Total Items" value={String(overview.overview.totalItems)} />
          <MetricCard label="Units In Stock" value={formatNumber(overview.overview.totalUnitsInStock)} />
          <MetricCard label="Inventory Value" value={formatCurrency(overview.overview.totalInventoryValue)} tone="good" />
          <MetricCard label="Low Stock" value={String(overview.overview.lowStockCount)} tone={overview.overview.lowStockCount > 0 ? "warn" : "neutral"} />
          <MetricCard
            label="Out of Stock"
            value={String(overview.overview.outOfStockCount)}
            tone={overview.overview.outOfStockCount > 0 ? "danger" : "neutral"}
          />
          <MetricCard label="Recent Movements" value={String(movements.length)} />
        </section>
        )}

        {showOverview && (
        <section
          id="inventory-low-stock-section"
          className={cn(
            focusedSectionId === "inventory-low-stock-section" &&
              "rounded-2xl ring-2 ring-indigo-100 ring-offset-2 ring-offset-slate-50"
          )}
        >
          <Card className="min-w-0" title="Low Stock Alerts" subtitle="Critical items requiring replenishment and immediate action">
            <div className="space-y-3">
              {stockAlertRows.length === 0 ? (
                <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-3 text-sm text-emerald-800">
                  Stock health is good in current scope.
                </p>
              ) : (
                <div className="overflow-hidden rounded-lg border border-slate-200">
                  <div className="max-h-64 overflow-auto">
                    <table className="min-w-full text-left text-sm">
                      <thead className="sticky top-0 z-10 bg-slate-50 text-xs uppercase tracking-wide text-slate-600">
                        <tr>
                          <th className="px-3 py-2">Item</th>
                          <th className="px-3 py-2">SKU</th>
                          <th className="px-3 py-2 text-right">Current</th>
                          <th className="px-3 py-2 text-right">Minimum</th>
                          <th className="px-3 py-2">Severity</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 bg-white">
                        {stockAlertRows.slice(0, 30).map((item) => (
                          <tr key={item.id}>
                            <td className="px-3 py-2 text-ink-800">{item.name}</td>
                            <td className="px-3 py-2 text-ink-700">{item.sku}</td>
                            <td className="px-3 py-2 text-right text-ink-700">{formatNumber(item.quantityInStock)}</td>
                            <td className="px-3 py-2 text-right text-ink-700">{formatNumber(item.minimumStockLevel)}</td>
                            <td className="px-3 py-2">
                              <StockSeverityBadge severity={item.severity} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                {overview.analytics.recommendations.length === 0 ? "No recommendations in current scope." : overview.analytics.recommendations.join(" ")}
              </div>
            </div>
          </Card>
        </section>
        )}

        {showOverview && (
          <section className="grid min-w-0 items-start gap-4 xl:grid-cols-2">
            <Card className="min-w-0" title="Recent Stock Movements" subtitle="Latest movement entries in current filter scope">
              {movements.length === 0 ? (
                <p className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-4 text-sm text-ink-600">
                  No stock movements in current scope.
                </p>
              ) : (
                <DataTable
                  className="border-slate-200/70"
                  columns={["Date", "Item", "Type", "Qty", "Cost"]}
                  rows={movements.slice(0, 8).map((movement) => [
                    toIsoDate(movement.date),
                    movementItemLabel(movement),
                    formatMovementType(movement.movementType),
                    formatNumber(movement.quantity),
                    formatCurrency(movement.totalCost || 0)
                  ])}
                />
              )}
            </Card>
            <Card className="min-w-0" title="Recent Inventory Issues" subtitle="Top-priority data quality issues to resolve">
              {issuesResponse.issues.length === 0 ? (
                <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-3 text-sm text-emerald-800">
                  No major inventory inconsistencies detected in current scope.
                </p>
              ) : (
                <div className="space-y-2">
                  {issuesResponse.issues.slice(0, 6).map((issue) => (
                    <div key={`overview-issue-${issue.id}`} className="rounded border border-slate-200 bg-slate-50 px-3 py-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <IssueSeverityBadge severity={issue.severity} />
                        <p className="text-sm font-semibold text-ink-900">{issue.title}</p>
                      </div>
                      <p className="mt-1 text-xs text-slate-700">{issue.message}</p>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </section>
        )}

        {showIssues && (
        <section
          id="inventory-issues-section"
          className={cn(
            "grid min-w-0 items-start gap-4 xl:grid-cols-[1.25fr_1fr]",
            focusedSectionId === "inventory-issues-section" &&
              "rounded-2xl ring-2 ring-indigo-100 ring-offset-2 ring-offset-slate-50"
          )}
        >
          <Card className="min-w-0">
            {issuesLoading ? (
              <p className="text-sm text-ink-600">Analyzing inventory quality issues...</p>
            ) : issuesResponse.summary.total === 0 ? (
              <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-3 text-sm text-emerald-800">
                No major inventory inconsistencies detected in current scope.
              </p>
            ) : (
              <div className="space-y-3">
                <div className="flex flex-wrap gap-2">
                  <IssueSummaryBadge label="Total" value={issuesResponse.summary.total} tone="neutral" />
                  <IssueSummaryBadge label="High" value={issuesResponse.summary.high} tone="danger" />
                  <IssueSummaryBadge label="Medium" value={issuesResponse.summary.medium} tone="warn" />
                  <IssueSummaryBadge label="Low" value={issuesResponse.summary.low} tone="neutral" />
                </div>
                <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-5">
                  <FilterSelect
                    label="Severity"
                    value={issueSeverityFilter}
                    onChange={(value) => setIssueSeverityFilter((value as "all" | "HIGH" | "MEDIUM" | "LOW") || "all")}
                    options={[
                      { value: "all", label: "All severities" },
                      { value: "HIGH", label: "High" },
                      { value: "MEDIUM", label: "Medium" },
                      { value: "LOW", label: "Low" }
                    ]}
                  />
                  <FilterSelect
                    label="Issue Type"
                    value={issueTypeFilter}
                    onChange={(value) =>
                      setIssueTypeFilter(
                        (value as "all" | "CATEGORY_CONFLICT" | "DUPLICATE_ITEM" | "NAMING_INCONSISTENCY" | "STOCK_ANOMALY" | "PRICE_ANOMALY") || "all"
                      )
                    }
                    options={[
                      { value: "all", label: "All types" },
                      { value: "CATEGORY_CONFLICT", label: "Category conflict" },
                      { value: "DUPLICATE_ITEM", label: "Duplicate item" },
                      { value: "NAMING_INCONSISTENCY", label: "Naming" },
                      { value: "STOCK_ANOMALY", label: "Stock anomaly" },
                      { value: "PRICE_ANOMALY", label: "Price anomaly" }
                    ]}
                  />
                  <FilterSelect
                    label="Affected Category"
                    value={issueCategoryFilter}
                    onChange={(value) => setIssueCategoryFilter(value || "all")}
                    options={[
                      { value: "all", label: "All categories" },
                      ...issueCategoryOptions.map((category) => ({
                        value: category,
                        label: formatInventoryCategory(category)
                      }))
                    ]}
                  />
                  <label className="text-xs text-ink-700 md:col-span-2 xl:col-span-2">
                    <span className="mb-1 block uppercase tracking-wide text-slate-500">Affected Item</span>
                    <input
                      type="text"
                      value={issueItemQuery}
                      onChange={(event) => setIssueItemQuery(event.target.value)}
                      placeholder="Search item name"
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                    />
                  </label>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setShowLowPriorityIssues((current) => !current)}
                    className="rounded border border-slate-300 bg-white px-2 py-1 text-xs text-ink-700 hover:bg-slate-100"
                  >
                    {showLowPriorityIssues ? "Hide low-priority issues" : "Show low-priority issues"}
                  </button>
                  {!showLowPriorityIssues && lowPriorityHiddenCount > 0 && (
                    <span className="rounded-full border border-slate-300 bg-slate-100 px-2 py-1 text-xs text-slate-700">
                      {lowPriorityHiddenCount} low-priority issue(s) hidden (mostly formatting cleanup)
                    </span>
                  )}
                  {canManage && lowRiskNamingFixes.length > 0 && (
                    <button
                      type="button"
                      onClick={() => void applyBulkLowRiskNamingAutoFix()}
                      className="rounded border border-emerald-300 bg-emerald-50 px-2 py-1 text-xs text-emerald-800 hover:bg-emerald-100"
                    >
                      Fix all low-risk naming issues ({lowRiskNamingFixes.length})
                    </button>
                  )}
                </div>

                <div className="space-y-2">
                  {filteredIssues.slice(0, 12).map((issue) => (
                    <div key={issue.id} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                      <div className="mb-1 flex flex-wrap items-center gap-2">
                        <IssueSeverityBadge severity={issue.severity} />
                        <p className="text-sm font-semibold text-ink-900">{issue.title}</p>
                        {issue.confidence && (
                          <span className="rounded-full border border-slate-300 bg-white px-2 py-0.5 text-[11px] text-slate-700">
                            Confidence: {issue.confidence}
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-ink-700">{issue.message}</p>
                      <p className="mt-1 text-xs text-slate-600">{issue.suggestion}</p>
                      {issue.itemIds.length > 0 && (
                        <p className="mt-1 text-[11px] text-slate-600">
                          Affected:{" "}
                          {issue.itemIds
                            .map((itemId) => itemById.get(itemId)?.name || "Unknown item")
                            .slice(0, 3)
                            .join(", ")}
                        </p>
                      )}
                      <div className="mt-2 flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => openItemDetail(issue.itemIds[0] || "")}
                          className="rounded border border-slate-300 bg-white px-2 py-1 text-xs text-ink-700 hover:bg-slate-100"
                        >
                          Open Item
                        </button>
                        {issue.suggestedCategory && (
                          <button
                            type="button"
                            onClick={() => void applyIssueQuickFix(issue, "category")}
                            className="rounded border border-amber-300 bg-amber-50 px-2 py-1 text-xs text-amber-800 hover:bg-amber-100"
                          >
                            Reassign Category
                          </button>
                        )}
                        {issue.suggestedName && (
                          <button
                            type="button"
                            onClick={() =>
                              issue.autoFixSafe
                                ? void applyNamingAutoFix(issue.itemIds[0] || "", issue.suggestedName || "")
                                : void applyIssueQuickFix(issue, "name")
                            }
                            className="rounded border border-blue-300 bg-blue-50 px-2 py-1 text-xs text-blue-800 hover:bg-blue-100"
                          >
                            {issue.autoFixSafe ? "Auto-fix naming format" : "Standardize Name"}
                          </button>
                        )}
                        {issue.type === "DUPLICATE_ITEM" && issue.itemIds.length > 1 && (
                          <button
                            type="button"
                            onClick={() => void mergeDuplicateIssue(issue)}
                            className="rounded border border-emerald-300 bg-emerald-50 px-2 py-1 text-xs text-emerald-800 hover:bg-emerald-100"
                          >
                            Merge Duplicates
                          </button>
                        )}
                        {issue.type === "STOCK_ANOMALY" && (
                          <button
                            type="button"
                            onClick={() => focusStockAdjustment(issue.itemIds[0] || "")}
                            className="rounded border border-violet-300 bg-violet-50 px-2 py-1 text-xs text-violet-800 hover:bg-violet-100"
                          >
                            Adjust Stock
                          </button>
                        )}
                        {issue.type === "PRICE_ANOMALY" && (
                          <button
                            type="button"
                            onClick={() => focusPricingReview(issue.itemIds[0] || "")}
                            className="rounded border border-cyan-300 bg-cyan-50 px-2 py-1 text-xs text-cyan-800 hover:bg-cyan-100"
                          >
                            Review Pricing
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                  {filteredIssues.length === 0 && (
                    <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-700">
                      No issues found for current filters.
                    </p>
                  )}
                </div>
              </div>
            )}
          </Card>

          <Card className="min-w-0" title="Category Management" subtitle="Central category usage and value distribution">
            {issuesResponse.categorySummary.length === 0 ? (
              <p className="text-sm text-ink-600">No category data available in current scope.</p>
            ) : (
              <DataTable
                className="border-slate-200/70"
                columns={["Category", "Items", "Inventory Value"]}
                rows={issuesResponse.categorySummary.map((entry) => [
                  entry.label,
                  String(entry.itemCount),
                  formatCurrency(entry.totalValue)
                ])}
              />
            )}
          </Card>
        </section>
        )}

        {showItems && (
        <section
          id="inventory-items-section"
          className={cn(
            focusedSectionId === "inventory-items-section" && "rounded-2xl ring-2 ring-indigo-100 ring-offset-2 ring-offset-slate-50"
          )}
        >
          <Card className="min-w-0">
            <div className="space-y-4">
              <div className="rounded-xl border border-slate-200/85 bg-slate-50/75 p-3.5">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Filters</p>
                  <p className="text-xs text-slate-500">Refine items by category, supplier, location, and stock status</p>
                </div>
                <div className="grid items-end gap-2 md:grid-cols-2 xl:grid-cols-[2fr_repeat(4,minmax(0,1fr))_auto]">
                  <label className="text-xs text-ink-700 xl:col-span-1">
                    <span className="mb-1 block uppercase tracking-wide text-slate-500">Search</span>
                    <input
                      type="text"
                      value={itemSearch}
                      onChange={(event) => setItemSearch(event.target.value)}
                      placeholder="Item name, SKU, part number"
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                    />
                  </label>
                  <FilterSelect
                    label="Category"
                    value={itemCategoryFilter}
                    onChange={setItemCategoryFilter}
                    options={[
                      { value: "all", label: "All categories" },
                      ...inventoryCategoryOptions.map((entry) => ({ value: entry.value, label: entry.label }))
                    ]}
                  />
                  <FilterSelect
                    label="Supplier"
                    value={supplierFilter}
                    onChange={setSupplierFilter}
                    options={[
                      { value: "all", label: "All suppliers" },
                      ...suppliers.map((supplier) => ({ value: supplier.id, label: supplier.name }))
                    ]}
                  />
                  <FilterSelect
                    label="Location"
                    value={locationFilter}
                    onChange={setLocationFilter}
                    options={[
                      { value: "all", label: "All locations" },
                      ...locations.map((location) => ({ value: location.id, label: location.name }))
                    ]}
                  />
                  <FilterSelect
                    label="Stock"
                    value={stockFilter}
                    onChange={setStockFilter}
                    options={[
                      { value: "all", label: "All stock" },
                      { value: "low", label: "Low stock" },
                      { value: "out", label: "Out of stock" },
                      { value: "healthy", label: "Healthy stock" }
                    ]}
                  />
                  {canManage && (
                    <div className="flex justify-start xl:justify-end">
                      <button
                        type="button"
                        onClick={() => setShowCreateItemForm((current) => !current)}
                        className="gf-btn-primary px-3 py-1.5 text-xs"
                      >
                        {showCreateItemForm ? "Hide Create Form" : "Create New Item"}
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {loading ? (
                <p className="text-sm text-ink-600">Loading inventory items...</p>
              ) : items.length === 0 ? (
                <p className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-4 text-sm text-ink-600">
                  No inventory items found for current filters.
                </p>
              ) : (
                <div className="space-y-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Item List</p>
                  <DataTable
                    className="border-slate-200/70"
                    columns={[
                      "Item",
                      "SKU",
                      "Category",
                      "Stock",
                      "Min",
                      "Unit Cost",
                      "Value",
                      "Supplier",
                      "Location",
                      "Status",
                      "Action"
                    ]}
                    rows={items.slice(0, 50).map((item) => [
                      item.name,
                      item.sku,
                      formatInventoryCategory(item.category),
                      `${formatNumber(item.quantityInStock)}${item.outOfStock ? " (Out)" : item.lowStock ? " (Low)" : ""}`,
                      formatNumber(item.minimumStockLevel),
                      formatCurrency(item.unitCost),
                      formatCurrency(item.inventoryValue),
                      item.supplier?.name || "-",
                      item.location?.name || "-",
                      item.status,
                      <button
                        key={`${item.id}-view`}
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          openItemDetail(item.id);
                        }}
                        className="gf-btn-subtle"
                      >
                        <span className="inline-flex items-center gap-1">
                          <Eye size={13} />
                          View
                        </span>
                      </button>
                    ])}
                    rowIds={items.slice(0, 50).map((item) => `ai-focus-${item.id}`)}
                    rowClassNames={items.slice(0, 50).map((item) =>
                      focusedRowId === item.id ? "bg-indigo-50 ring-1 ring-inset ring-indigo-200" : ""
                    )}
                    onRowClick={(rowIndex) => openItemDetail(items.slice(0, 50)[rowIndex]?.id || "")}
                  />

                  <div className="mt-3 rounded-xl border border-slate-200/85 bg-slate-50/65 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">My Usage Requests</p>
                        <p className="text-xs text-slate-600">
                          Approved requests create stock-out history. Rejected or blocked approvals do not mutate stock.
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-1">
                        {(["ALL", "SUBMITTED", "PENDING", "APPROVED", "REJECTED"] as const).map((statusOption) => (
                          <button
                            key={`usage-status-${statusOption}`}
                            type="button"
                            onClick={() => setUsageRequestStatusFilter(statusOption)}
                            className={cn(
                              "rounded-full border px-2 py-0.5 text-[11px] font-semibold transition-colors",
                              usageRequestStatusFilter === statusOption
                                ? "border-brand-300 bg-brand-50 text-brand-800"
                                : "border-slate-300 bg-white text-slate-600 hover:border-slate-400 hover:text-slate-800"
                            )}
                          >
                            {statusOption === "ALL" ? "All" : statusOption.charAt(0) + statusOption.slice(1).toLowerCase()}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="mt-2">
                      {usageRequestsLoading ? (
                        <p className="text-sm text-slate-600">Loading your usage requests...</p>
                      ) : myUsageRequests.length === 0 ? (
                        <p className="rounded-lg border border-dashed border-slate-300 bg-white px-3 py-3 text-sm text-slate-600">
                          No usage requests found in this filter scope.
                        </p>
                      ) : (
                        <DataTable
                          className="border-slate-200/70"
                          columns={["Requested", "Item", "Qty", "Status", "Project / Rig", "Decision", "Action"]}
                          rows={myUsageRequests.slice(0, 20).map((requestRow) => [
                            toIsoDate(requestRow.createdAt),
                            requestRow.item ? `${requestRow.item.name} (${requestRow.item.sku})` : "-",
                            formatNumber(requestRow.quantity),
                            <UsageRequestStatusBadge key={`${requestRow.id}-status`} status={requestRow.status} />,
                            `${requestRow.project?.name || "-"} / ${requestRow.rig?.rigCode || requestRow.location?.name || "-"}`,
                            <span key={`${requestRow.id}-decision`} className="text-xs text-slate-700">
                              {formatUsageRequestDecision(requestRow)}
                            </span>,
                            <div key={`${requestRow.id}-actions`} className="flex flex-wrap gap-1">
                              {requestRow.item?.id ? (
                                <button
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    openItemDetail(requestRow.item?.id || "");
                                  }}
                                  className="gf-btn-subtle"
                                >
                                  Open item
                                </button>
                              ) : null}
                              {requestRow.approvedMovementId ? (
                                <button
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    openMovementDetail(requestRow.approvedMovementId || "");
                                  }}
                                  className="gf-btn-subtle"
                                >
                                  Open movement
                                </button>
                              ) : null}
                              {!requestRow.item?.id && !requestRow.approvedMovementId ? "-" : null}
                            </div>
                          ])}
                          onRowClick={(rowIndex) => openItemDetail(myUsageRequests.slice(0, 20)[rowIndex]?.item?.id || "")}
                        />
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </Card>
        </section>
        )}

        {(showMovements || (showItems && showCreateItemForm)) && (
        <section id="inventory-actions-section" className="grid min-w-0 items-start gap-4 xl:grid-cols-[1.2fr_1fr]">
          {canManage && showItems && showCreateItemForm && (
            <Card
              className="min-w-0"
              title="Inventory Manual Entry"
              subtitle="Create inventory items directly. Receipt scanning now lives in Inventory → Receipt Intake."
            >
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-xs text-brand-900">
                <p className="font-medium">Need receipt-based intake? Use the dedicated Receipt Intake workflow.</p>
                <Link
                  href="/inventory/receipt-intake"
                  className="inline-flex rounded border border-brand-300 bg-white px-2 py-1 font-semibold text-brand-800 hover:bg-brand-100"
                >
                  Open Receipt Intake
                </Link>
              </div>

              <form onSubmit={submitItemForm} className="grid gap-2 md:grid-cols-2">
                <InputField label="Item Name" value={itemForm.name} onChange={(value) => setItemForm((current) => ({ ...current, name: value }))} required />
                <InputField label="SKU / Item Code" value={itemForm.sku} onChange={(value) => setItemForm((current) => ({ ...current, sku: value.toUpperCase() }))} required />
                <FilterSelect
                  label="Category"
                  value={itemForm.category}
                  onChange={(value) => setItemForm((current) => ({ ...current, category: value }))}
                  options={inventoryCategoryOptions.map((entry) => ({ value: entry.value, label: entry.label }))}
                />
                <InputField label="Part Number" value={itemForm.partNumber} onChange={(value) => setItemForm((current) => ({ ...current, partNumber: value }))} />
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700 md:col-span-2">
                  <div className="mb-1 flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-ink-800">Suggested Category:</span>
                    <span className="rounded-full border border-slate-300 bg-white px-2 py-0.5 text-[11px]">
                      {categorySuggestion.suggestedCategory
                        ? formatInventoryCategory(categorySuggestion.suggestedCategory)
                        : "No strong match"}
                    </span>
                    <span className="rounded-full border border-slate-300 bg-white px-2 py-0.5 text-[11px]">
                      Confidence: {categorySuggestion.confidenceLabel}
                    </span>
                    {suggestionLoading && <span className="text-[11px] text-slate-500">Analyzing...</span>}
                  </div>
                  <p>{categorySuggestion.reason}</p>
                  {categorySuggestion.similarItems.length > 0 && (
                    <p className="mt-1 text-[11px] text-slate-600">
                      Similar items:{" "}
                      {categorySuggestion.similarItems
                        .slice(0, 3)
                        .map((entry) => `${entry.name} (${formatInventoryCategory(entry.category)})`)
                        .join(", ")}
                    </p>
                  )}
                  {categorySuggestion.suggestedCategory && categorySuggestion.confidence !== "NONE" && (
                    <div className="mt-2">
                      <button
                        type="button"
                        onClick={() =>
                          setItemForm((current) => ({
                            ...current,
                            category: categorySuggestion.suggestedCategory || current.category
                          }))
                        }
                        className="rounded border border-brand-300 bg-brand-50 px-2 py-1 text-[11px] text-brand-800 hover:bg-brand-100"
                      >
                        Use suggested category
                      </button>
                    </div>
                  )}
                  {suggestionMismatch && categorySuggestion.mismatchWarning && (
                    <p className="mt-2 rounded border border-amber-300 bg-amber-50 px-2 py-1 text-[11px] text-amber-800">
                      {categorySuggestion.mismatchWarning}
                    </p>
                  )}
                </div>
                <InputField
                  label="Custom Category Label (optional)"
                  value={itemForm.customCategoryLabel}
                  onChange={(value) => setItemForm((current) => ({ ...current, customCategoryLabel: value }))}
                />
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] text-slate-600">
                  {itemForm.customCategoryLabel.trim()
                    ? categorySuggestion.similarCategoryNames.length > 0
                      ? `Similar existing categories: ${categorySuggestion.similarCategoryNames.join(", ")}`
                      : "No close category name match found. This will be saved as a custom label in notes."
                    : "Use this when no strong category match exists. Primary category still uses the controlled list."}
                </div>
                <InputField label="Quantity In Stock" type="number" value={itemForm.quantityInStock} onChange={(value) => setItemForm((current) => ({ ...current, quantityInStock: value }))} required />
                <InputField label="Minimum Stock" type="number" value={itemForm.minimumStockLevel} onChange={(value) => setItemForm((current) => ({ ...current, minimumStockLevel: value }))} required />
                <InputField label="Unit Cost" type="number" value={itemForm.unitCost} onChange={(value) => setItemForm((current) => ({ ...current, unitCost: value }))} required />
                <FilterSelect
                  label="Status"
                  value={itemForm.status}
                  onChange={(value) => setItemForm((current) => ({ ...current, status: value as "ACTIVE" | "INACTIVE" }))}
                  options={[
                    { value: "ACTIVE", label: "Active" },
                    { value: "INACTIVE", label: "Inactive" }
                  ]}
                />
                <FilterSelect
                  label="Supplier"
                  value={itemForm.supplierId}
                  onChange={(value) => setItemForm((current) => ({ ...current, supplierId: value }))}
                  options={[
                    { value: "", label: "No supplier" },
                    ...suppliers.map((supplier) => ({ value: supplier.id, label: supplier.name }))
                  ]}
                />
                <FilterSelect
                  label="Location"
                  value={itemForm.locationId}
                  onChange={(value) => setItemForm((current) => ({ ...current, locationId: value }))}
                  options={[
                    { value: "", label: "No location" },
                    ...locations.map((location) => ({ value: location.id, label: location.name }))
                  ]}
                />
                <FilterSelect
                  label="Compatible Rig"
                  value={itemForm.compatibleRigId}
                  onChange={(value) => setItemForm((current) => ({ ...current, compatibleRigId: value }))}
                  options={[
                    { value: "", label: "Any rig" },
                    ...rigs.map((rig) => ({ value: rig.id, label: rig.rigCode }))
                  ]}
                />
                <InputField label="Compatible Rig Type" value={itemForm.compatibleRigType} onChange={(value) => setItemForm((current) => ({ ...current, compatibleRigType: value }))} />
                <label className="text-xs text-ink-700 md:col-span-2">
                  <span className="mb-1 block uppercase tracking-wide text-slate-500">Description / Notes</span>
                  <textarea
                    value={itemForm.description}
                    onChange={(event) => setItemForm((current) => ({ ...current, description: event.target.value }))}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                    rows={3}
                  />
                </label>
                <div className="md:col-span-2">
                  <button
                    type="submit"
                    disabled={savingItem}
                    className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {savingItem ? "Saving..." : "Create Item"}
                  </button>
                </div>
              </form>
            </Card>
          )}

          {canManage && showMovements && (
            <Card
              className="min-w-0"
              title="Manual Stock Movement"
              subtitle="Record manual purchases/usage/adjustments. Receipt intake already attaches receipts automatically."
            >
              <div id="stock-movement-form" />
              <form onSubmit={submitMovementForm} className="grid gap-2 md:grid-cols-2">
                <FilterSelect
                  label="Item"
                  value={movementForm.itemId}
                  onChange={(value) => setMovementForm((current) => ({ ...current, itemId: value }))}
                  options={[
                    { value: "", label: "Select item" },
                    ...items.map((item) => ({ value: item.id, label: `${item.name} (${item.sku})` }))
                  ]}
                />
                <FilterSelect
                  label="Movement Type"
                  value={movementForm.movementType}
                  onChange={(value) =>
                    setMovementForm((current) => ({
                      ...current,
                      movementType: value as MovementFormState["movementType"],
                      createExpense: value === "IN" ? false : current.createExpense
                    }))
                  }
                  options={inventoryMovementTypeOptions.map((entry) => ({ value: entry.value, label: entry.label }))}
                />
                <InputField label="Quantity" type="number" value={movementForm.quantity} onChange={(value) => setMovementForm((current) => ({ ...current, quantity: value }))} required />
                <InputField label="Date" type="date" value={movementForm.date} onChange={(value) => setMovementForm((current) => ({ ...current, date: value }))} required />
                <InputField label="Unit Cost" type="number" value={movementForm.unitCost} onChange={(value) => setMovementForm((current) => ({ ...current, unitCost: value }))} />
                <InputField label="Total Cost (optional override)" type="number" value={movementForm.totalCost} onChange={(value) => setMovementForm((current) => ({ ...current, totalCost: value }))} />
                <FilterSelect
                  label="Client"
                  value={movementForm.clientId}
                  onChange={(value) =>
                    setMovementForm((current) => ({
                      ...current,
                      clientId: value,
                      projectId: value && current.projectId && !projects.some((project) => project.id === current.projectId && project.clientId === value) ? "" : current.projectId
                    }))
                  }
                  options={[
                    { value: "", label: "No client" },
                    ...clients.map((client) => ({ value: client.id, label: client.name }))
                  ]}
                />
                <FilterSelect
                  label="Project"
                  value={movementForm.projectId}
                  onChange={(value) => setMovementForm((current) => ({ ...current, projectId: value }))}
                  options={[
                    { value: "", label: "No project" },
                    ...filteredProjectsForMovement.map((project) => ({ value: project.id, label: project.name }))
                  ]}
                />
                <FilterSelect
                  label="Rig"
                  value={movementForm.rigId}
                  onChange={(value) => setMovementForm((current) => ({ ...current, rigId: value }))}
                  options={[
                    { value: "", label: "No rig" },
                    ...rigs.map((rig) => ({ value: rig.id, label: rig.rigCode }))
                  ]}
                />
                <FilterSelect
                  label="Maintenance Request"
                  value={movementForm.maintenanceRequestId}
                  onChange={(value) => setMovementForm((current) => ({ ...current, maintenanceRequestId: value }))}
                  options={[
                    { value: "", label: "Not linked" },
                    ...maintenanceRequests.map((requestRow) => ({ value: requestRow.id, label: requestRow.requestCode }))
                  ]}
                />
                <FilterSelect
                  label="Supplier"
                  value={movementForm.supplierId}
                  onChange={(value) => setMovementForm((current) => ({ ...current, supplierId: value }))}
                  options={[
                    { value: "", label: "No supplier" },
                    ...suppliers.map((supplier) => ({ value: supplier.id, label: supplier.name }))
                  ]}
                />
                <FilterSelect
                  label="From Location"
                  value={movementForm.locationFromId}
                  onChange={(value) => setMovementForm((current) => ({ ...current, locationFromId: value }))}
                  options={[
                    { value: "", label: "No location" },
                    ...locations.map((location) => ({ value: location.id, label: location.name }))
                  ]}
                />
                <FilterSelect
                  label="To Location"
                  value={movementForm.locationToId}
                  onChange={(value) => setMovementForm((current) => ({ ...current, locationToId: value }))}
                  options={[
                    { value: "", label: "No location" },
                    ...locations.map((location) => ({ value: location.id, label: location.name }))
                  ]}
                />
                <InputField label="TRA Receipt Number" value={movementForm.traReceiptNumber} onChange={(value) => setMovementForm((current) => ({ ...current, traReceiptNumber: value }))} />
                <InputField label="Supplier Invoice Ref" value={movementForm.supplierInvoiceNumber} onChange={(value) => setMovementForm((current) => ({ ...current, supplierInvoiceNumber: value }))} />
                <InputField
                  label="Receipt URL (Optional manual)"
                  value={movementForm.receiptUrl}
                  onChange={(value) => setMovementForm((current) => ({ ...current, receiptUrl: value }))}
                />
                <label className="text-xs text-ink-700">
                  <span className="mb-1 block uppercase tracking-wide text-slate-500">Receipt Upload (Optional manual)</span>
                  <input
                    type="file"
                    accept="image/*,.pdf"
                    onChange={(event) =>
                      setMovementForm((current) => ({
                        ...current,
                        receiptFile: event.target.files && event.target.files.length > 0 ? event.target.files[0] : null
                      }))
                    }
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  />
                </label>
                <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] text-slate-600 md:col-span-2">
                  Movements created from the <span className="font-semibold">From Receipt</span> intake already carry the receipt and metadata automatically.
                  Use receipt upload here only for manual movements.
                </p>
                <label className="text-xs text-ink-700 md:col-span-2">
                  <span className="mb-1 block uppercase tracking-wide text-slate-500">Notes</span>
                  <textarea
                    value={movementForm.notes}
                    onChange={(event) => setMovementForm((current) => ({ ...current, notes: event.target.value }))}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                    rows={2}
                  />
                </label>
                <label className="inline-flex items-center gap-2 text-xs text-ink-700">
                  <input
                    type="checkbox"
                    checked={movementForm.createExpense}
                    onChange={(event) => setMovementForm((current) => ({ ...current, createExpense: event.target.checked }))}
                  />
                  Create / link expense entry for this movement
                </label>
                {user?.role === "ADMIN" && (
                  <label className="inline-flex items-center gap-2 text-xs text-ink-700">
                    <input
                      type="checkbox"
                      checked={movementForm.allowNegativeStock}
                      onChange={(event) => setMovementForm((current) => ({ ...current, allowNegativeStock: event.target.checked }))}
                    />
                    Allow negative stock (admin correction)
                  </label>
                )}
                <div className="md:col-span-2">
                  <button
                    type="submit"
                    disabled={savingMovement}
                    className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {savingMovement ? "Saving..." : "Record Movement"}
                  </button>
                </div>
              </form>
            </Card>
          )}
        </section>
        )}

        {showMovements && (
        <section
          id="inventory-movements-section"
          className={cn(
            focusedSectionId === "inventory-movements-section" &&
              "rounded-2xl ring-2 ring-indigo-100 ring-offset-2 ring-offset-slate-50"
          )}
        >
        <Card className="min-w-0">
          <div id="inventory-stock-movements-section" />
          <div className="mb-4 rounded-xl border border-slate-200/85 bg-slate-50/75 p-3.5">
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Filters</p>
              <p className="text-xs text-slate-500">Search and narrow movement history quickly</p>
            </div>
            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
              <FilterSelect
                label="Movement Type"
                value={movementTypeFilter}
                onChange={setMovementTypeFilter}
                options={[
                  { value: "all", label: "All movement types" },
                  ...inventoryMovementTypeOptions.map((entry) => ({ value: entry.value, label: entry.label }))
                ]}
              />
              <label className="text-xs text-ink-700 md:col-span-2 xl:col-span-3">
                <span className="mb-1 block uppercase tracking-wide text-slate-500">Search movements</span>
                <input
                  type="text"
                  value={movementQuery}
                  onChange={(event) => setMovementQuery(event.target.value)}
                  placeholder="Item, project, rig, supplier, maintenance code"
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
              </label>
            </div>
          </div>
          {filteredMovements.length === 0 ? (
            <p className="text-sm text-ink-600">No stock movements found for current scope.</p>
          ) : (
            <div className="space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Movement History</p>
              <DataTable
                className="border-slate-200/70"
                columns={["Date", "Item", "Type", "Qty", "Total Cost", "Origin", "Rig", "Project", "Maintenance", "Expense", "Receipt", "Action"]}
                rows={filteredMovements.slice(0, 80).map((movement) => [
                  toIsoDate(movement.date),
                  movementItemLabel(movement),
                  formatMovementType(movement.movementType),
                  formatNumber(movement.quantity),
                  formatCurrency(movement.totalCost || 0),
                  movement.receiptUrl || movement.traReceiptNumber || movement.supplierInvoiceNumber ? (
                    <a
                      key={`${movement.id}-origin`}
                      href={`/inventory/receipt-intake?movementId=${movement.id}`}
                      className="inline-flex items-center rounded-full border border-brand-300 bg-brand-50 px-2 py-0.5 text-[11px] font-semibold text-brand-800 hover:bg-brand-100"
                    >
                      Receipt Intake
                    </a>
                  ) : (
                    "Manual"
                  ),
                  movement.rig?.rigCode || "-",
                  movement.project?.name || "-",
                  movement.maintenanceRequest?.requestCode || "-",
                  movement.expense?.id ? `${movement.expense.id} (${movement.expense.approvalStatus})` : "-",
                  movement.receiptUrl ? (
                    <a
                      key={`${movement.id}-receipt`}
                      href={movement.receiptUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-brand-700 underline"
                    >
                      Open
                    </a>
                  ) : (
                    "-"
                  ),
                  <button
                    key={`${movement.id}-view`}
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      openMovementDetail(movement.id);
                    }}
                    className="gf-btn-subtle"
                  >
                    <span className="inline-flex items-center gap-1">
                      <Eye size={13} />
                      View
                    </span>
                  </button>
                ])}
                rowIds={filteredMovements.slice(0, 80).map((movement) => `ai-focus-${movement.id}`)}
                rowClassNames={filteredMovements.slice(0, 80).map((movement) =>
                  focusedRowId === movement.id ? "bg-indigo-50 ring-1 ring-inset ring-indigo-200" : ""
                )}
                onRowClick={(rowIndex) => openMovementDetail(filteredMovements.slice(0, 80)[rowIndex]?.id || "")}
              />
            </div>
          )}
        </Card>
        </section>
        )}

        {canManage && (showSuppliers || showLocations) && (
          <section className="grid min-w-0 items-start gap-4 xl:grid-cols-2">
            {showSuppliers && (
            <div
              id="inventory-suppliers-section"
              className={cn(
                focusedSectionId === "inventory-suppliers-section" &&
                  "rounded-2xl ring-2 ring-indigo-100 ring-offset-2 ring-offset-slate-50"
              )}
            >
            <Card className="min-w-0" title="Suppliers" subtitle="Track supplier contacts and purchasing activity">
              <form onSubmit={submitSupplierForm} className="mb-3 grid gap-2 md:grid-cols-2">
                <InputField label="Supplier Name" value={supplierForm.name} onChange={(value) => setSupplierForm((current) => ({ ...current, name: value }))} required />
                <InputField label="Contact Person" value={supplierForm.contactPerson} onChange={(value) => setSupplierForm((current) => ({ ...current, contactPerson: value }))} />
                <InputField label="Email" value={supplierForm.email} onChange={(value) => setSupplierForm((current) => ({ ...current, email: value }))} />
                <InputField label="Phone" value={supplierForm.phone} onChange={(value) => setSupplierForm((current) => ({ ...current, phone: value }))} />
                <label className="text-xs text-ink-700 md:col-span-2">
                  <span className="mb-1 block uppercase tracking-wide text-slate-500">Notes</span>
                  <textarea
                    value={supplierForm.notes}
                    onChange={(event) => setSupplierForm((current) => ({ ...current, notes: event.target.value }))}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                    rows={2}
                  />
                </label>
                <div className="md:col-span-2">
                  <button
                    type="submit"
                    disabled={savingSupplier}
                    className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm text-ink-800 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {savingSupplier ? "Saving..." : "Add Supplier"}
                  </button>
                </div>
              </form>

              <DataTable
                className="border-slate-200/70"
                columns={["Supplier", "Items", "Purchases", "Total Cost", "Latest Purchase"]}
                rows={suppliers.slice(0, 12).map((supplier) => [
                  supplier.name,
                  String(supplier.itemCount),
                  String(supplier.purchaseCount),
                  formatCurrency(supplier.totalPurchaseCost || 0),
                  supplier.latestPurchaseDate ? toIsoDate(supplier.latestPurchaseDate) : "-"
                ])}
              />
            </Card>
            </div>
            )}

            {showLocations && (
            <div
              id="inventory-locations-section"
              className={cn(
                focusedSectionId === "inventory-locations-section" &&
                  "rounded-2xl ring-2 ring-indigo-100 ring-offset-2 ring-offset-slate-50"
              )}
            >
            <Card className="min-w-0" title="Locations" subtitle="Warehouse and site stock locations">
              <form onSubmit={submitLocationForm} className="mb-3 grid gap-2 md:grid-cols-2">
                <InputField label="Location Name" value={locationForm.name} onChange={(value) => setLocationForm((current) => ({ ...current, name: value }))} required />
                <InputField label="Description" value={locationForm.description} onChange={(value) => setLocationForm((current) => ({ ...current, description: value }))} />
                <div className="md:col-span-2">
                  <button
                    type="submit"
                    disabled={savingLocation}
                    className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm text-ink-800 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {savingLocation ? "Saving..." : "Add Location"}
                  </button>
                </div>
              </form>

              <DataTable
                className="border-slate-200/70"
                columns={["Location", "Items", "Status", "Description"]}
                rows={locations.slice(0, 12).map((location) => [
                  location.name,
                  String(location.itemCount),
                  location.isActive ? "Active" : "Inactive",
                  location.description || "-"
                ])}
              />
            </Card>
            </div>
            )}
          </section>
        )}

        {usageRequestToast && (
          <aside className="pointer-events-none fixed bottom-5 right-5 z-[91] w-[min(420px,calc(100vw-2rem))]">
            <div
              className={cn(
                "pointer-events-auto rounded-2xl border px-3.5 py-3 shadow-[0_16px_36px_rgba(15,23,42,0.16)] backdrop-blur-sm",
                usageRequestToast.tone === "success"
                  ? "border-emerald-200 bg-white/95 text-emerald-900"
                  : "border-red-200 bg-white/95 text-red-900"
              )}
            >
              <p className="text-xs font-semibold uppercase tracking-wide">
                {usageRequestToast.tone === "success" ? "Usage Request Submitted" : "Usage Request Update"}
              </p>
              <p className="mt-1 text-sm leading-5">{usageRequestToast.message}</p>
              <button
                type="button"
                onClick={() => setUsageRequestToast(null)}
                className="mt-2 text-xs font-semibold underline underline-offset-2"
              >
                Dismiss
              </button>
            </div>
          </aside>
        )}

        <ItemDetailModal
          open={itemDetailModalOpen}
          onClose={() => setItemDetailModalOpen(false)}
          itemDetails={selectedItemDetails}
          issues={selectedItemIssues}
          canManage={canManage}
          onRequestUse={openRequestUseModal}
          onToggleStatus={async (nextStatus) => {
            if (!selectedItemDetails?.data?.id) {
              return;
            }
            setErrorMessage(null);
            setNotice(null);
            try {
              const response = await fetch(`/api/inventory/items/${selectedItemDetails.data.id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ status: nextStatus })
              });
              if (!response.ok) {
                throw new Error(await readApiError(response, "Failed to update item status."));
              }
              setNotice(nextStatus === "INACTIVE" ? "Inventory item archived." : "Inventory item re-activated.");
              await loadInventoryData();
              await loadSelectedItemDetails();
            } catch (statusError) {
              setErrorMessage(statusError instanceof Error ? statusError.message : "Failed to update item status.");
            }
          }}
        />
        <MovementDetailDrawer
          open={movementDetailDrawerOpen}
          onClose={() => setMovementDetailDrawerOpen(false)}
          movement={selectedMovementDetails}
          relatedMovements={relatedMovementRows}
        />
        <RequestUseModal
          open={requestUseModalOpen}
          onClose={closeRequestUseModal}
          onSubmit={submitUseRequest}
          form={useRequestForm}
          onFormChange={setUseRequestForm}
          projects={projects}
          rigs={rigs}
          maintenanceRequests={maintenanceRequests}
          locations={locations}
          item={selectedItemDetails?.data || null}
          submitting={submittingUseRequest}
          errorMessage={useRequestError}
        />
      </div>
    </AccessGate>
  );
}

function InventoryPageFallback() {
  return (
    <AccessGate permission="inventory:view">
      <div className="space-y-3">
        <p className="text-sm text-ink-600">Loading inventory workspace...</p>
      </div>
    </AccessGate>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <label className="text-xs text-ink-700">
      <span className="mb-1 block uppercase tracking-wide text-slate-500">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
      >
        {options.map((option) => (
          <option key={`${label}-${option.value}`} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function InputField({
  label,
  value,
  onChange,
  type = "text",
  required = false
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  required?: boolean;
}) {
  return (
    <label className="text-xs text-ink-700">
      <span className="mb-1 block uppercase tracking-wide text-slate-500">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        required={required}
        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
      />
    </label>
  );
}

function SummaryBadge({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5">
      <p className="text-[10px] uppercase tracking-wide text-slate-500">{label}</p>
      <p className="text-sm font-medium text-ink-800">{value}</p>
    </div>
  );
}

function IssueSummaryBadge({
  label,
  value,
  tone
}: {
  label: string;
  value: number;
  tone: "danger" | "warn" | "neutral";
}) {
  const toneClass =
    tone === "danger"
      ? "border-red-300 bg-red-50 text-red-800"
      : tone === "warn"
        ? "border-amber-300 bg-amber-50 text-amber-800"
        : "border-slate-300 bg-slate-50 text-slate-700";

  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${toneClass}`}>
      {label}: {formatNumber(value)}
    </span>
  );
}

function IssueSeverityBadge({ severity }: { severity: "HIGH" | "MEDIUM" | "LOW" }) {
  const toneClass =
    severity === "HIGH"
      ? "border-red-300 bg-red-100 text-red-800"
      : severity === "MEDIUM"
        ? "border-amber-300 bg-amber-100 text-amber-800"
        : "border-slate-300 bg-slate-100 text-slate-700";

  return <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${toneClass}`}>{severity}</span>;
}

function MovementDetailDrawer({
  open,
  onClose,
  movement,
  relatedMovements
}: {
  open: boolean;
  onClose: () => void;
  movement: InventoryMovementRow | null;
  relatedMovements: InventoryMovementRow[];
}) {
  const [isMounted, setIsMounted] = useState(open);
  const [isVisible, setIsVisible] = useState(open);

  useEffect(() => {
    let timeoutId: number | undefined;
    if (open) {
      setIsMounted(true);
      timeoutId = window.setTimeout(() => setIsVisible(true), 12);
    } else if (isMounted) {
      setIsVisible(false);
      timeoutId = window.setTimeout(() => setIsMounted(false), 180);
    }

    return () => {
      if (timeoutId !== undefined) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [isMounted, open]);

  if (!isMounted) {
    return null;
  }

  return (
    <div
      className={`fixed inset-0 z-[75] flex transition-opacity duration-200 ease-out ${
        isVisible ? "opacity-100" : "pointer-events-none opacity-0"
      }`}
    >
      <button
        type="button"
        onClick={onClose}
        className={`flex-1 bg-slate-900/35 backdrop-blur-[2px] transition-opacity duration-200 ${
          isVisible ? "opacity-100" : "opacity-0"
        }`}
        aria-label="Close movement detail drawer"
      />
      <aside
        className={`h-full w-full max-w-3xl overflow-y-auto border-l border-slate-200 bg-white shadow-[0_18px_42px_rgba(15,23,42,0.22)] transition-transform duration-200 ease-out ${
          isVisible ? "translate-x-0" : "translate-x-3"
        }`}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3">
          <div>
            <p className="text-sm font-semibold text-ink-900">
              {movement ? `Stock Movement ${movement.id.slice(-8)}` : "Stock Movement Detail"}
            </p>
            <p className="text-xs text-slate-600">Focused full-view detail with linked records</p>
          </div>
          <button type="button" onClick={onClose} className="rounded border border-slate-300 bg-white px-2 py-1 text-xs text-ink-700 hover:bg-slate-100">
            Close
          </button>
        </div>

        {!movement ? (
          <div className="p-4 text-sm text-ink-600">Loading movement details...</div>
        ) : (
          <div className="space-y-4 p-4">
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              <SummaryBadge label="Movement Type" value={formatMovementType(movement.movementType)} />
              <SummaryBadge label="Date" value={toIsoDate(movement.date)} />
              <SummaryBadge label="Quantity" value={formatNumber(movement.quantity)} />
              <SummaryBadge label="Unit Cost" value={formatCurrency(movement.unitCost || 0)} />
              <SummaryBadge label="Total Cost" value={formatCurrency(movement.totalCost || 0)} />
              <SummaryBadge label="Receipt #" value={movement.supplierInvoiceNumber || movement.traReceiptNumber || "-"} />
              <SummaryBadge
                label="Origin"
                value={movement.receiptUrl || movement.traReceiptNumber || movement.supplierInvoiceNumber ? "Receipt Intake" : "Manual"}
              />
              <SummaryBadge label="Item" value={movement.item?.name || "Unknown item"} />
              <SummaryBadge label="Project" value={movement.project?.name || "-"} />
              <SummaryBadge label="Rig" value={movement.rig?.rigCode || "-"} />
            </div>

            <div className="flex flex-wrap gap-2">
              {movement.item?.id && (
                <a
                  href={`/inventory/items?itemId=${movement.item.id}`}
                  className="rounded border border-brand-300 bg-brand-50 px-3 py-1.5 text-xs font-semibold text-brand-800 hover:bg-brand-100"
                >
                  Open Inventory Item
                </a>
              )}
              {(movement.receiptUrl || movement.traReceiptNumber || movement.supplierInvoiceNumber) && (
                <a
                  href={`/inventory/receipt-intake?movementId=${movement.id}`}
                  className="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs text-ink-700 hover:bg-slate-100"
                >
                  Open Receipt Intake Record
                </a>
              )}
              {movement.expense?.id && (
                <a
                  href={`/expenses?expenseId=${movement.expense.id}`}
                  className="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs text-ink-700 hover:bg-slate-100"
                >
                  Open Linked Expense
                </a>
              )}
              {movement.receiptUrl && (
                <a
                  href={movement.receiptUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs text-ink-700 hover:bg-slate-100"
                >
                  Open Receipt File
                </a>
              )}
            </div>

            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
              <p className="font-semibold text-slate-800">Metadata</p>
              <p className="mt-1">Performed by: {movement.performedBy?.fullName || "-"}</p>
              <p>Supplier: {movement.supplier?.name || "-"}</p>
              <p>Client: {movement.client?.name || "-"}</p>
              <p>Maintenance: {movement.maintenanceRequest?.requestCode || "-"}</p>
              <p>Location from: {movement.locationFrom?.name || "-"}</p>
              <p>Location to: {movement.locationTo?.name || "-"}</p>
              <p>Notes: {movement.notes || "-"}</p>
            </div>

            <DataTable
              className="border-slate-200/70"
              columns={["Related Movement", "Date", "Item", "Project", "Rig", "Amount", "Linked Expense"]}
              rows={(relatedMovements || []).slice(0, 10).map((entry) => [
                entry.id.slice(-8),
                toIsoDate(entry.date),
                entry.item?.name || "Unknown item",
                entry.project?.name || "-",
                entry.rig?.rigCode || "-",
                formatCurrency(entry.totalCost || 0),
                entry.expense?.id || "-"
              ])}
            />
          </div>
        )}
      </aside>
    </div>
  );
}

function ItemDetailModal({
  open,
  onClose,
  itemDetails,
  issues,
  canManage,
  onRequestUse,
  onToggleStatus
}: {
  open: boolean;
  onClose: () => void;
  itemDetails: InventoryItemDetailsResponse | null;
  issues: InventoryIssueRow[];
  canManage: boolean;
  onRequestUse: () => void;
  onToggleStatus: (nextStatus: "ACTIVE" | "INACTIVE") => Promise<void>;
}) {
  const [isMounted, setIsMounted] = useState(open);
  const [isVisible, setIsVisible] = useState(open);

  useEffect(() => {
    let timeoutId: number | undefined;
    if (open) {
      setIsMounted(true);
      timeoutId = window.setTimeout(() => setIsVisible(true), 12);
    } else if (isMounted) {
      setIsVisible(false);
      timeoutId = window.setTimeout(() => setIsMounted(false), 180);
    }

    return () => {
      if (timeoutId !== undefined) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [isMounted, open]);

  if (!isMounted) {
    return null;
  }

  const receiptRows = (itemDetails?.movements || [])
    .filter((movement) => movement.receiptUrl || movement.traReceiptNumber || movement.supplierInvoiceNumber)
    .map((movement) => [
      toIsoDate(movement.date),
      movement.supplier?.name || movement.expense?.category || "-",
      movement.traReceiptNumber || "-",
      movement.supplierInvoiceNumber || "-",
      movement.expense?.id || "-",
      movement.receiptUrl ? (
        <a key={`${movement.id}-drawer-receipt`} href={movement.receiptUrl} target="_blank" rel="noreferrer" className="text-brand-700 underline">
          Open Receipt
        </a>
      ) : (
        "-"
      )
    ]);

  return (
    <div
      className={`fixed inset-0 z-[80] flex items-center justify-center p-3 transition-opacity duration-200 ease-out sm:p-6 ${
        isVisible ? "opacity-100" : "pointer-events-none opacity-0"
      }`}
    >
      <button
        type="button"
        onClick={onClose}
        className={`absolute inset-0 bg-slate-900/40 backdrop-blur-[2px] transition-opacity duration-200 ${
          isVisible ? "opacity-100" : "opacity-0"
        }`}
        aria-label="Close item detail modal"
      />
      <section
        className={`relative z-10 flex h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-[0_24px_64px_rgba(15,23,42,0.24)] transition-all duration-200 ease-out ${
          isVisible ? "translate-y-0 scale-100 opacity-100" : "translate-y-1 scale-[0.985] opacity-0"
        }`}
      >
        <div className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 px-5 py-4 shadow-[0_1px_0_rgba(15,23,42,0.06)] backdrop-blur">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Inventory Item Workspace</p>
              <p className="text-xl font-semibold text-ink-900">
                {itemDetails?.data ? itemDetails.data.name : "Inventory Item"}
              </p>
              <p className="mt-0.5 text-xs font-medium text-slate-600">
                {itemDetails?.data ? itemDetails.data.sku : "Loading details"} • Full item workspace
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 p-1">
              {itemDetails?.data && (
                <>
                  {canManage ? (
                    <>
                      <a
                        href={`/inventory/items?itemId=${itemDetails.data.id}`}
                        className="gf-btn-primary px-3 py-1.5 text-xs"
                      >
                        Edit Item
                      </a>
                      <a
                        href={`/inventory/stock-movements?movementItemId=${itemDetails.data.id}&movementType=ADJUSTMENT`}
                        className="gf-btn-secondary px-3 py-1.5 text-xs"
                      >
                        Adjust Stock
                      </a>
                    </>
                  ) : null}
                  <button type="button" onClick={onRequestUse} className="gf-btn-primary px-3 py-1.5 text-xs">
                    Request Use
                  </button>
                  {canManage && (
                    <button
                      type="button"
                      onClick={() => void onToggleStatus(itemDetails.data.status === "ACTIVE" ? "INACTIVE" : "ACTIVE")}
                      className="gf-btn-secondary px-3 py-1.5 text-xs"
                    >
                      {itemDetails.data.status === "ACTIVE" ? "Archive" : "Restore"}
                    </button>
                  )}
                </>
              )}
              <button type="button" onClick={onClose} className="gf-btn-secondary px-3 py-1.5 text-xs">
                Back
              </button>
            </div>
          </div>
        </div>

        {!itemDetails?.data ? (
          <div className="p-4 text-sm text-ink-600">Loading selected item details...</div>
        ) : (
          <div className="space-y-5 overflow-y-auto bg-slate-50/40 p-4 sm:p-5">
            {issues.length > 0 && (
              <div className="rounded-lg border border-amber-300 bg-amber-50 p-3">
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-amber-800">Active Item Warnings</p>
                <p className="text-sm text-amber-900">
                  {issues.slice(0, 2).map((issue) => issue.title).join(" • ")}
                </p>
              </div>
            )}

            <section className="gf-section-shell p-4">
              <div className="gf-section-heading">
                <div className="gf-section-heading-block">
                  <h4 className="gf-section-title">Details</h4>
                </div>
                <span
                  className={`inline-flex rounded-full border px-2 py-1 text-[11px] font-semibold ${
                    itemDetails.data.status === "ACTIVE"
                      ? "border-emerald-300 bg-emerald-100 text-emerald-800"
                      : "border-slate-300 bg-slate-100 text-slate-700"
                  }`}
                >
                  {itemDetails.data.status}
                </span>
              </div>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <div
                  className={`rounded-xl border px-4 py-3 ${
                    itemDetails.data.quantityInStock <= itemDetails.data.minimumStockLevel
                      ? "border-amber-300 bg-amber-50"
                      : "border-emerald-300 bg-emerald-50"
                  }`}
                >
                  <p className="text-xs uppercase tracking-wide text-slate-600">Stock On Hand</p>
                  <p className="mt-1 text-2xl font-semibold text-ink-900">
                    {formatNumber(itemDetails.data.quantityInStock)}
                  </p>
                  <p className="text-xs text-slate-600">Minimum: {formatNumber(itemDetails.data.minimumStockLevel)}</p>
                </div>
                <div className="rounded-xl border border-brand-200 bg-brand-50 px-4 py-3">
                  <p className="text-xs uppercase tracking-wide text-slate-600">Inventory Value</p>
                  <p className="mt-1 text-2xl font-semibold text-brand-900">
                    {formatCurrency(itemDetails.data.inventoryValue)}
                  </p>
                  <p className="text-xs text-slate-600">Unit Cost: {formatCurrency(itemDetails.data.unitCost)}</p>
                </div>
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                <SummaryBadge label="Category" value={formatInventoryCategory(itemDetails.data.category)} />
                <SummaryBadge label="Supplier" value={itemDetails.data.supplier?.name || "-"} />
                <SummaryBadge label="Location" value={itemDetails.data.location?.name || "-"} />
                <SummaryBadge label="Part Number" value={itemDetails.data.partNumber || "-"} />
                <SummaryBadge
                  label="Compatible Rig"
                  value={itemDetails.data.compatibleRig?.rigCode || itemDetails.data.compatibleRigType || "-"}
                />
              </div>
            </section>

            <section className="gf-section-shell p-4">
              <div className="gf-section-heading">
                <div className="gf-section-heading-block">
                  <h4 className="gf-section-title">Stock History</h4>
                </div>
              </div>
              <div className="mt-3">
                <DataTable
                  className="border-slate-200/70"
                  columns={["Movement Date", "Type", "Qty", "Project", "Rig", "Maintenance", "Expense", "Receipt"]}
                  rows={(itemDetails.movements || []).slice(0, 20).map((movement) => [
                    toIsoDate(movement.date),
                    formatMovementType(movement.movementType),
                    formatNumber(movement.quantity),
                    movement.project?.name || "-",
                    movement.rig?.rigCode || "-",
                    movement.maintenanceRequest?.requestCode || "-",
                    movement.expense?.id || "-",
                    movement.receiptUrl ? (
                      <a key={`${movement.id}-movement-receipt`} href={movement.receiptUrl} target="_blank" rel="noreferrer" className="text-brand-700 underline">
                        Receipt
                      </a>
                    ) : (
                      "-"
                    )
                  ])}
                />
              </div>
            </section>

            <section className="gf-section-shell p-4">
              <div className="gf-section-heading">
                <div className="gf-section-heading-block">
                  <h4 className="gf-section-title">Receipts</h4>
                  <p className="gf-section-subtitle">Track which receipts created or updated stock.</p>
                </div>
              </div>
              <div className="mt-3">
                {receiptRows.length === 0 ? (
                  <p className="text-sm text-ink-600">No linked receipts for this item in current scope.</p>
                ) : (
                  <DataTable
                    className="border-slate-200/70"
                    columns={["Date", "Supplier/Source", "TRA Receipt", "Invoice Ref", "Linked Expense", "File"]}
                    rows={receiptRows}
                  />
                )}
              </div>
            </section>
          </div>
        )}
      </section>
    </div>
  );
}

function RequestUseModal({
  open,
  onClose,
  onSubmit,
  form,
  onFormChange,
  projects,
  rigs,
  maintenanceRequests,
  locations,
  item,
  submitting,
  errorMessage
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => Promise<void>;
  form: UseRequestFormState;
  onFormChange: React.Dispatch<React.SetStateAction<UseRequestFormState>>;
  projects: Array<{ id: string; name: string; clientId: string }>;
  rigs: Array<{ id: string; rigCode: string }>;
  maintenanceRequests: Array<{ id: string; requestCode: string }>;
  locations: InventoryLocation[];
  item: InventoryItemRow | null;
  submitting: boolean;
  errorMessage: string | null;
}) {
  const [isMounted, setIsMounted] = useState(open);
  const [isVisible, setIsVisible] = useState(open);

  useEffect(() => {
    let timeoutId: number | undefined;
    if (open) {
      setIsMounted(true);
      timeoutId = window.setTimeout(() => setIsVisible(true), 12);
    } else if (isMounted) {
      setIsVisible(false);
      timeoutId = window.setTimeout(() => setIsMounted(false), 180);
    }

    return () => {
      if (timeoutId !== undefined) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [isMounted, open]);

  if (!isMounted) {
    return null;
  }

  const projectedStock = Number(form.quantity || 0) > 0 ? item ? item.quantityInStock - Number(form.quantity || 0) : null : null;
  const projectedStockWarning =
    projectedStock !== null && Number.isFinite(projectedStock) && projectedStock < 0
      ? "Requested quantity exceeds stock on hand. Approval will be blocked unless stock is replenished."
      : null;

  return (
    <div
      className={`fixed inset-0 z-[82] flex items-center justify-center p-3 transition-opacity duration-200 ease-out sm:p-6 ${
        isVisible ? "opacity-100" : "pointer-events-none opacity-0"
      }`}
    >
      <button
        type="button"
        onClick={onClose}
        className={`absolute inset-0 bg-slate-900/35 backdrop-blur-[2px] transition-opacity duration-200 ${
          isVisible ? "opacity-100" : "opacity-0"
        }`}
        aria-label="Close request use modal"
      />
      <section
        className={`relative z-10 w-full max-w-xl rounded-2xl border border-slate-200 bg-white shadow-[0_20px_50px_rgba(15,23,42,0.24)] transition-all duration-200 ease-out ${
          isVisible ? "translate-y-0 scale-100 opacity-100" : "translate-y-1 scale-[0.985] opacity-0"
        }`}
      >
        <div className="border-b border-slate-200 px-4 py-3">
          <p className="text-sm font-semibold text-ink-900">Request Item Use</p>
          <p className="text-xs text-slate-600">
            {item ? `${item.name} (${item.sku})` : "Submit usage request for approval"}
          </p>
          {item && <p className="mt-1 text-xs text-slate-500">Stock on hand: {formatNumber(item.quantityInStock)}</p>}
        </div>
        {item?.status !== "ACTIVE" && (
          <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-900">
            This item is inactive. Reactivate it before submitting a usage request.
          </div>
        )}
        {projectedStockWarning && (
          <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-900">{projectedStockWarning}</div>
        )}
        {errorMessage && (
          <div className="border-b border-red-200 bg-red-50 px-4 py-2 text-xs text-red-800">{errorMessage}</div>
        )}
        <form onSubmit={(event) => void onSubmit(event)} className="grid gap-3 px-4 py-4 md:grid-cols-2">
          <InputField
            label="Quantity"
            type="number"
            value={form.quantity}
            onChange={(value) => onFormChange((current) => ({ ...current, quantity: value }))}
            required
          />
          <InputField
            label="Requested Date"
            type="date"
            value={form.requestedForDate}
            onChange={(value) => onFormChange((current) => ({ ...current, requestedForDate: value }))}
          />
          <FilterSelect
            label="Project"
            value={form.projectId}
            onChange={(value) => onFormChange((current) => ({ ...current, projectId: value }))}
            options={[
              { value: "", label: "Select project" },
              ...projects.map((project) => ({ value: project.id, label: project.name }))
            ]}
          />
          <FilterSelect
            label="Rig"
            value={form.rigId}
            onChange={(value) => onFormChange((current) => ({ ...current, rigId: value }))}
            options={[
              { value: "", label: "Select rig" },
              ...rigs.map((rig) => ({ value: rig.id, label: rig.rigCode }))
            ]}
          />
          <FilterSelect
            label="Maintenance Request"
            value={form.maintenanceRequestId}
            onChange={(value) => onFormChange((current) => ({ ...current, maintenanceRequestId: value }))}
            options={[
              { value: "", label: "Not linked" },
              ...maintenanceRequests.map((request) => ({ value: request.id, label: request.requestCode }))
            ]}
          />
          <FilterSelect
            label="From Location"
            value={form.locationId}
            onChange={(value) => onFormChange((current) => ({ ...current, locationId: value }))}
            options={[
              { value: "", label: "Select location" },
              ...locations.map((location) => ({ value: location.id, label: location.name }))
            ]}
          />
          <label className="text-xs text-ink-700 md:col-span-2">
            <span className="mb-1 block uppercase tracking-wide text-slate-500">Reason</span>
            <textarea
              value={form.reason}
              onChange={(event) => onFormChange((current) => ({ ...current, reason: event.target.value }))}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              rows={3}
              required
            />
          </label>
          <div className="flex flex-wrap justify-end gap-2 md:col-span-2">
            <button type="button" onClick={onClose} className="gf-btn-secondary px-3 py-1.5 text-xs">
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || item?.status !== "ACTIVE"}
              className="gf-btn-primary px-3 py-1.5 text-xs"
            >
              {submitting ? "Submitting..." : "Submit Request"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function StockSeverityBadge({ severity }: { severity: "CRITICAL" | "LOW" }) {
  const toneClass =
    severity === "CRITICAL"
      ? "border-red-300 bg-red-100 text-red-800"
      : "border-amber-300 bg-amber-100 text-amber-800";
  const label = severity === "CRITICAL" ? "Out of Stock" : "Low Stock";

  return <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${toneClass}`}>{label}</span>;
}

function UsageRequestStatusBadge({ status }: { status: InventoryUsageRequestRow["status"] }) {
  const toneClass =
    status === "APPROVED"
      ? "border-emerald-300 bg-emerald-100 text-emerald-800"
      : status === "REJECTED"
        ? "border-red-300 bg-red-100 text-red-800"
        : status === "PENDING"
          ? "border-amber-300 bg-amber-100 text-amber-800"
          : "border-blue-300 bg-blue-100 text-blue-800";
  const label = status.charAt(0) + status.slice(1).toLowerCase();

  return <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${toneClass}`}>{label}</span>;
}

function formatUsageRequestDecision(requestRow: InventoryUsageRequestRow) {
  if (requestRow.status === "APPROVED") {
    const approvedOn = requestRow.decidedAt ? toIsoDate(requestRow.decidedAt) : "recently";
    return `Approved ${approvedOn}${requestRow.approvedMovementId ? " • stock movement recorded" : ""}`;
  }
  if (requestRow.status === "REJECTED") {
    return requestRow.decisionNote?.trim() ? `Rejected • ${requestRow.decisionNote}` : "Rejected by approver";
  }
  if (requestRow.status === "PENDING") {
    return "Pending manager review";
  }
  return "Awaiting review";
}

function movementItemLabel(movement: InventoryMovementRow) {
  const itemName = movement.item?.name?.trim() || "Unknown item";
  const itemSku = movement.item?.sku?.trim();
  if (!itemSku) {
    return itemName;
  }
  return `${itemName} (${itemSku})`;
}

function toIsoDate(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "-";
  }
  return parsed.toISOString().slice(0, 10);
}

async function readApiError(response: Response, fallbackMessage: string) {
  const clone = response.clone();
  const payload = await response.json().catch(() => null);
  if (payload && typeof payload === "object" && "message" in payload) {
    const message = payload.message;
    if (typeof message === "string" && message.trim()) {
      return message;
    }
  }

  const rawBody = (await clone.text().catch(() => "")).trim();
  if (rawBody) {
    return rawBody;
  }

  return `${fallbackMessage} (HTTP ${response.status})`;
}
