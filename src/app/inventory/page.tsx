"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Eye, X } from "lucide-react";

import { AccessGate } from "@/components/layout/access-gate";
import { SystemFlowBar } from "@/components/inventory/system-flow-bar";
import { InventoryIssuesWorkspace } from "@/components/inventory/inventory-issues-workspace";
import { InventoryMovementsWorkspace } from "@/components/inventory/inventory-movements-workspace";
import { InventoryManualMovementModal } from "@/components/inventory/inventory-manual-movement-modal";
import { InventoryIssueWorkflowModal } from "@/components/inventory/inventory-issue-workflow-modal";
import {
  buildIssueOperationalContext,
  deriveMovementRecognitionStatus,
  formatUsageRequestDecision,
  isIssueCostRecognitionGap,
  isIssueNeedsLinking,
  movementItemLabel,
  toIsoDate,
  type IssueOperationalContext
} from "@/components/inventory/inventory-page-utils";
import {
  FilterSelect,
  InputField,
  IssueSeverityBadge,
  SummaryBadge,
  StockSeverityBadge,
  UsageRequestStatusBadge,
  isOperationalMaintenanceOpen,
  normalizeBreakdownLikeStatus,
  readApiError
} from "@/components/inventory/inventory-page-shared";
import { useRegisterCopilotContext } from "@/components/layout/ai-copilot-context";
import { FilterScopeBanner } from "@/components/layout/filter-scope-banner";
import { useAnalyticsFilters } from "@/components/layout/analytics-filters-provider";
import { scrollToFocusElement, useCopilotFocusTarget } from "@/components/layout/copilot-focus-target";
import { useRole } from "@/components/layout/role-provider";
import { Card, MetricCard } from "@/components/ui/card";
import { DataTable } from "@/components/ui/table";
import { canManageExpenseApprovalActions } from "@/lib/auth/approval-policy";
import { canAccess } from "@/lib/auth/permissions";
import type { CopilotPageContext } from "@/lib/ai/contextual-copilot";
import { buildScopedHref } from "@/lib/drilldown";
import { formatInventoryCategory, formatMovementType, inventoryCategoryOptions } from "@/lib/inventory";
import { cn, formatCurrency, formatNumber } from "@/lib/utils";

export interface InventoryItemRow {
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

export interface InventorySupplier {
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

export interface InventoryLocation {
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
  maintenanceRequest: {
    id: string;
    requestCode: string;
    status: string;
    breakdownReportId?: string | null;
  } | null;
  breakdownReport?: {
    id: string;
    title: string;
    status: string;
    severity: string;
    reportDate?: string | null;
  } | null;
  expense: {
    id: string;
    amount: number;
    category: string;
    approvalStatus: string;
    entrySource?: string;
    approvedAt?: string | null;
    submittedAt?: string | null;
  } | null;
  supplier: { id: string; name: string } | null;
  locationFrom: { id: string; name: string } | null;
  locationTo: { id: string; name: string } | null;
  performedBy: { id: string; fullName: string; role: string } | null;
  linkedUsageRequest?: {
    id: string;
    status: string;
    reason: string;
    reasonType?: "MAINTENANCE" | "BREAKDOWN" | "OTHER";
    breakdownReportId?: string | null;
    maintenanceRequestId?: string | null;
    requestedForDate?: string | null;
    decidedAt?: string | null;
    createdAt?: string;
    requestedBy?: { id: string; fullName: string; role: string } | null;
    decidedBy?: { id: string; fullName: string; role: string } | null;
    maintenanceRequest?: {
      id: string;
      requestCode: string;
      status: string;
      breakdownReportId?: string | null;
    } | null;
    breakdownReport?: {
      id: string;
      title: string;
      status: string;
      severity: string;
    } | null;
  } | null;
  linkedBreakdown?: {
    id: string;
    title: string;
    status: string;
    severity: string;
    reportDate?: string | null;
  } | null;
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

export interface InventoryIssueRow {
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

export interface MovementFormState {
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
  reasonType: "MAINTENANCE" | "BREAKDOWN" | "";
  reasonDetails: string;
  maintenanceRigId: string;
  projectId: string;
  rigId: string;
  maintenanceRequestId: string;
  breakdownReportId: string;
  locationId: string;
}

export interface MaintenanceContextOption {
  id: string;
  requestCode: string;
  status: string;
  issueDescription: string;
  rig: { id: string; rigCode: string } | null;
  project: { id: string; name: string } | null;
}

interface BreakdownContextOption {
  id: string;
  title: string;
  status: string;
  severity: string;
  reportDate: string;
  rig: { id: string; rigCode: string } | null;
  project: { id: string; name: string } | null;
}

interface InventoryUsageRequestRow {
  id: string;
  quantity: number;
  reason: string;
  reasonType?: "MAINTENANCE" | "BREAKDOWN" | "OTHER";
  breakdownReportId?: string | null;
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
  breakdownReport: {
    id: string;
    title: string;
    status: string;
    severity: string;
  } | null;
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
type IssueTriageFilter = "ALL" | "HIGH_PRIORITY" | "NEEDS_LINKING" | "COST_NOT_RECOGNIZED" | "LOW_PRIORITY";

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
  const preselectedUsageReason = (searchParams.get("usageReason") || "").trim().toUpperCase();
  const preselectedBreakdownId = searchParams.get("breakdownId")?.trim() || "";
  const preselectedMaintenanceRequestId =
    searchParams.get("maintenanceRequestId")?.trim() || "";
  const canManage = Boolean(user?.role && canAccess(user.role, "inventory:manage"));
  const canApproveMovement = Boolean(user?.role && canManageExpenseApprovalActions(user.role));

  const [clients, setClients] = useState<Array<{ id: string; name: string }>>([]);
  const [projects, setProjects] = useState<Array<{ id: string; name: string; clientId: string }>>([]);
  const [rigs, setRigs] = useState<Array<{ id: string; rigCode: string }>>([]);
  const [maintenanceRequests, setMaintenanceRequests] = useState<MaintenanceContextOption[]>([]);
  const [breakdownReports, setBreakdownReports] = useState<BreakdownContextOption[]>([]);
  const [suppliers, setSuppliers] = useState<InventorySupplier[]>([]);
  const [locations, setLocations] = useState<InventoryLocation[]>([]);
  const [items, setItems] = useState<InventoryItemRow[]>([]);
  const [movements, setMovements] = useState<InventoryMovementRow[]>([]);
  const [overview, setOverview] = useState<InventoryOverviewResponse>(defaultOverview);
  const [selectedItemId, setSelectedItemId] = useState<string>("");
  const [selectedItemDetails, setSelectedItemDetails] = useState<InventoryItemDetailsResponse | null>(null);
  const [selectedMovementId, setSelectedMovementId] = useState<string>("");
  const [selectedMovementDetails, setSelectedMovementDetails] = useState<InventoryMovementRow | null>(null);

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
  const [issueTriageFilter, setIssueTriageFilter] = useState<IssueTriageFilter>("ALL");
  const [selectedIssueId, setSelectedIssueId] = useState<string>("");
  const [issueWorkflowModalOpen, setIssueWorkflowModalOpen] = useState(false);
  const [issueWorkflowInitialStep, setIssueWorkflowInitialStep] = useState<1 | 2 | 3>(1);
  const [itemDetailModalOpen, setItemDetailModalOpen] = useState(false);
  const [movementDetailDrawerOpen, setMovementDetailDrawerOpen] = useState(false);
  const [manualMovementModalOpen, setManualMovementModalOpen] = useState(false);
  const [showCreateItemForm, setShowCreateItemForm] = useState(false);
  const [requestUseModalOpen, setRequestUseModalOpen] = useState(false);
  const [submittingUseRequest, setSubmittingUseRequest] = useState(false);
  const [useRequestError, setUseRequestError] = useState<string | null>(null);
  const [usageRequestsLoading, setUsageRequestsLoading] = useState(false);
  const [usageRequestStatusFilter, setUsageRequestStatusFilter] = useState<
    "ALL" | "SUBMITTED" | "PENDING" | "APPROVED" | "REJECTED"
  >("ALL");
  const [myUsageRequests, setMyUsageRequests] = useState<InventoryUsageRequestRow[]>([]);
  const usageRequestFetchSeq = useRef(0);
  const [usageRequestToast, setUsageRequestToast] = useState<{
    tone: "success" | "error";
    message: string;
  } | null>(null);
  const [useRequestForm, setUseRequestForm] = useState<UseRequestFormState>({
    quantity: "",
    reasonType: "",
    reasonDetails: "",
    maintenanceRigId: "",
    projectId: "",
    rigId: "",
    maintenanceRequestId: "",
    breakdownReportId: "",
    locationId: "",
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
  const movementSubmitInFlightRef = useRef(false);
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

  const openMaintenanceRequests = useMemo(
    () => maintenanceRequests.filter((requestRow) => isOperationalMaintenanceOpen(requestRow.status)),
    [maintenanceRequests]
  );
  const openBreakdownReports = useMemo(
    () => breakdownReports.filter((entry) => normalizeBreakdownLikeStatus(entry.status) === "OPEN"),
    [breakdownReports]
  );
  const maintenanceRigOptions = useMemo(() => {
    const byId = new Map<string, { id: string; rigCode: string }>();
    for (const requestRow of openMaintenanceRequests) {
      if (requestRow.rig?.id && requestRow.rig?.rigCode) {
        byId.set(requestRow.rig.id, {
          id: requestRow.rig.id,
          rigCode: requestRow.rig.rigCode
        });
      }
    }
    return Array.from(byId.values()).sort((a, b) =>
      a.rigCode.localeCompare(b.rigCode)
    );
  }, [openMaintenanceRequests]);
  const selectedMaintenanceContext = useMemo(
    () =>
      openMaintenanceRequests.find((requestRow) => requestRow.id === useRequestForm.maintenanceRequestId) ||
      null,
    [openMaintenanceRequests, useRequestForm.maintenanceRequestId]
  );
  const openMaintenanceRequestsForSelectedRig = useMemo(
    () =>
      useRequestForm.maintenanceRigId
        ? openMaintenanceRequests.filter(
            (requestRow) => requestRow.rig?.id === useRequestForm.maintenanceRigId
          )
        : [],
    [openMaintenanceRequests, useRequestForm.maintenanceRigId]
  );
  const selectedBreakdownContext = useMemo(
    () =>
      openBreakdownReports.find((entry) => entry.id === useRequestForm.breakdownReportId) || null,
    [openBreakdownReports, useRequestForm.breakdownReportId]
  );

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
  const visibleMovements = useMemo(() => filteredMovements.slice(0, 80), [filteredMovements]);
  const movementLedgerSummary = useMemo(() => {
    const summary = {
      total: filteredMovements.length,
      recognized: 0,
      pending: 0,
      stockOnly: 0
    };
    for (const movement of filteredMovements) {
      const recognition = deriveMovementRecognitionStatus(movement);
      if (recognition.label === "Cost Recognized") {
        summary.recognized += 1;
      } else if (recognition.label === "Pending Recognition") {
        summary.pending += 1;
      } else {
        summary.stockOnly += 1;
      }
    }
    return summary;
  }, [filteredMovements]);
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
  const needsLinkingCount = useMemo(
    () => filteredIssues.filter((issue) => isIssueNeedsLinking(issue)).length,
    [filteredIssues]
  );
  const costNotRecognizedCount = useMemo(
    () => filteredIssues.filter((issue) => isIssueCostRecognitionGap(issue)).length,
    [filteredIssues]
  );
  const triageQueueIssues = useMemo(() => {
    if (issueTriageFilter === "HIGH_PRIORITY") {
      return filteredIssues.filter((issue) => issue.severity === "HIGH");
    }
    if (issueTriageFilter === "NEEDS_LINKING") {
      return filteredIssues.filter((issue) => isIssueNeedsLinking(issue));
    }
    if (issueTriageFilter === "COST_NOT_RECOGNIZED") {
      return filteredIssues.filter((issue) => isIssueCostRecognitionGap(issue));
    }
    if (issueTriageFilter === "LOW_PRIORITY") {
      return filteredIssues.filter((issue) => issue.severity === "LOW");
    }
    return filteredIssues;
  }, [filteredIssues, issueTriageFilter]);
  const issueContextById = useMemo(() => {
    const contextMap = new Map<string, IssueOperationalContext>();
    for (const issue of filteredIssues) {
      contextMap.set(issue.id, buildIssueOperationalContext(issue, itemById, movements));
    }
    return contextMap;
  }, [filteredIssues, itemById, movements]);
  const selectedIssue = useMemo(
    () =>
      triageQueueIssues.find((issue) => issue.id === selectedIssueId) ||
      filteredIssues.find((issue) => issue.id === selectedIssueId) ||
      triageQueueIssues[0] ||
      filteredIssues[0] ||
      null,
    [filteredIssues, selectedIssueId, triageQueueIssues]
  );
  const selectedIssueContext = useMemo(
    () => (selectedIssue ? issueContextById.get(selectedIssue.id) || null : null),
    [issueContextById, selectedIssue]
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
    const [clientsRes, projectsRes, rigsRes, maintenanceRes, breakdownsRes, suppliersRes, locationsRes] = await Promise.all([
      fetch("/api/clients", { cache: "no-store" }),
      fetch("/api/projects", { cache: "no-store" }),
      fetch("/api/rigs", { cache: "no-store" }),
      fetch("/api/maintenance-requests", { cache: "no-store" }),
      fetch("/api/breakdowns?status=OPEN", { cache: "no-store" }),
      fetch("/api/inventory/suppliers", { cache: "no-store" }),
      fetch("/api/inventory/locations", { cache: "no-store" })
    ]);

    const [clientsPayload, projectsPayload, rigsPayload, maintenancePayload, breakdownsPayload, suppliersPayload, locationsPayload] =
      await Promise.all([
        clientsRes.ok ? clientsRes.json() : Promise.resolve({ data: [] }),
        projectsRes.ok ? projectsRes.json() : Promise.resolve({ data: [] }),
        rigsRes.ok ? rigsRes.json() : Promise.resolve({ data: [] }),
        maintenanceRes.ok ? maintenanceRes.json() : Promise.resolve({ data: [] }),
        breakdownsRes.ok ? breakdownsRes.json() : Promise.resolve({ data: [] }),
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
      (maintenancePayload.data || []).map(
        (requestRow: {
          id: string;
          requestCode?: string;
          status?: string;
          issueDescription?: string;
          rig?: { id?: string; rigCode?: string } | null;
          project?: { id?: string; name?: string } | null;
        }) => ({
          id: requestRow.id,
          requestCode: requestRow.requestCode || requestRow.id,
          status: requestRow.status || "IN_REPAIR",
          issueDescription: requestRow.issueDescription || "",
          rig:
            requestRow.rig?.id && requestRow.rig?.rigCode
              ? { id: requestRow.rig.id, rigCode: requestRow.rig.rigCode }
              : null,
          project:
            requestRow.project?.id && requestRow.project?.name
              ? { id: requestRow.project.id, name: requestRow.project.name }
              : null
        })
      )
    );
    setBreakdownReports(
      (breakdownsPayload.data || []).map(
        (entry: {
          id: string;
          title?: string;
          status?: string;
          severity?: string;
          reportDate?: string;
          rig?: { id?: string; rigCode?: string } | null;
          project?: { id?: string; name?: string } | null;
        }) => ({
          id: entry.id,
          title: entry.title || "Breakdown",
          status: entry.status || "OPEN",
          severity: entry.severity || "MEDIUM",
          reportDate: entry.reportDate || new Date().toISOString(),
          rig:
            entry.rig?.id && entry.rig?.rigCode
              ? { id: entry.rig.id, rigCode: entry.rig.rigCode }
              : null,
          project:
            entry.project?.id && entry.project?.name
              ? { id: entry.project.id, name: entry.project.name }
              : null
        })
      )
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
    const requestSeq = ++usageRequestFetchSeq.current;
    setUsageRequestsLoading(true);
    try {
      const query = new URLSearchParams();
      query.set("scope", "mine");
      query.set("requestedBy", "me");
      query.set("status", statusOverride || usageRequestStatusFilter);

      const response = await fetch(`/api/inventory/usage-requests?${query.toString()}`, { cache: "no-store" });
      if (!response.ok) {
        throw new Error(await readApiError(response, "Failed to load your usage requests."));
      }
      const payload = (await response.json()) as { data?: InventoryUsageRequestRow[] };
      if (requestSeq === usageRequestFetchSeq.current) {
        setMyUsageRequests(payload.data || []);
      }
    } catch {
      if (requestSeq === usageRequestFetchSeq.current) {
        setMyUsageRequests([]);
      }
    } finally {
      if (requestSeq === usageRequestFetchSeq.current) {
        setUsageRequestsLoading(false);
      }
    }
    },
    [usageRequestStatusFilter]
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
      return;
    }
    try {
      const response = await fetch(`/api/inventory/movements/${selectedMovementId}`, { cache: "no-store" });
      if (!response.ok) {
        throw new Error(await readApiError(response, "Failed to load movement details."));
      }
      const payload = await response.json();
      setSelectedMovementDetails((payload?.data || null) as InventoryMovementRow | null);
    } catch {
      setSelectedMovementDetails(null);
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
    if (canManage && resolveInventorySection(pathname, searchParams.get("section")) === "stock-movements") {
      setManualMovementModalOpen(true);
    }
  }, [canManage, pathname, searchParams]);

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
    if (movementSubmitInFlightRef.current) {
      return;
    }
    movementSubmitInFlightRef.current = true;
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
      setManualMovementModalOpen(false);
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
      movementSubmitInFlightRef.current = false;
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
      setNotice("Issue resolved.");
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
      setNotice("Issue resolved.");
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
      setNotice(updatedCount > 0 ? `Resolved ${updatedCount} low-risk issue(s).` : "No naming fixes were needed.");
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
      setNotice("Issue resolved.");
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

  function fixInventoryIssue(issue: InventoryIssueRow) {
    if (issue.suggestedCategory) {
      void applyIssueQuickFix(issue, "category");
      return;
    }
    if (issue.suggestedName) {
      const targetItemId = issue.itemIds[0] || "";
      if (issue.autoFixSafe && targetItemId) {
        void applyNamingAutoFix(targetItemId, issue.suggestedName);
      } else {
        void applyIssueQuickFix(issue, "name");
      }
      return;
    }
    if (issue.type === "DUPLICATE_ITEM" && issue.itemIds.length > 1) {
      void mergeDuplicateIssue(issue);
      return;
    }
    if (issue.type === "STOCK_ANOMALY") {
      focusStockAdjustment(issue.itemIds[0] || "");
      return;
    }
    if (issue.type === "PRICE_ANOMALY") {
      focusPricingReview(issue.itemIds[0] || "");
      return;
    }
    if (issue.itemIds[0]) {
      openItemDetail(issue.itemIds[0]);
    }
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
    const movementExists = movements.some((movement) => movement.id === movementId);
    if (!movementExists) {
      setErrorMessage("Movement record is no longer available. Refresh and try again.");
      return;
    }
    setSelectedMovementId(movementId);
    setMovementDetailDrawerOpen(true);
  }

  function openIssueQueueForMovement(movementId: string) {
    if (!movementId) {
      return;
    }
    setMovementDetailDrawerOpen(false);
    router.push(`/inventory/issues?movementId=${encodeURIComponent(movementId)}`);
  }

  function openIssueWorkflow(issueId: string, initialStep: 1 | 2 | 3 = 1) {
    if (!issueId) {
      return;
    }
    const issueExists = issuesResponse.issues.some((issue) => issue.id === issueId);
    if (!issueExists) {
      setErrorMessage("Issue context could not be found. Refresh and try again.");
      return;
    }
    setSelectedIssueId(issueId);
    setIssueWorkflowInitialStep(initialStep);
    setIssueWorkflowModalOpen(true);
  }

  function openRequestUseModal() {
    if (!selectedItemDetails?.data?.id) {
      return;
    }
    const preselectedBreakdown =
      preselectedBreakdownId.length > 0
        ? openBreakdownReports.find((entry) => entry.id === preselectedBreakdownId) || null
        : null;
    const preselectedMaintenance =
      preselectedMaintenanceRequestId.length > 0
        ? openMaintenanceRequests.find(
            (entry) => entry.id === preselectedMaintenanceRequestId
          ) || null
        : null;
    const reasonType: UseRequestFormState["reasonType"] =
      preselectedBreakdown
        ? "BREAKDOWN"
        : preselectedMaintenance || preselectedUsageReason === "MAINTENANCE"
          ? "MAINTENANCE"
          : "";
    const defaultMaintenanceRigId = preselectedMaintenance?.rig?.id
      ? preselectedMaintenance.rig.id
      : selectedItemDetails.data.compatibleRigId &&
          maintenanceRigOptions.some(
            (entry) => entry.id === selectedItemDetails.data.compatibleRigId
          )
        ? selectedItemDetails.data.compatibleRigId
        : "";
    const maintenanceRequestsForDefaultRig = defaultMaintenanceRigId
      ? openMaintenanceRequests.filter(
          (requestRow) => requestRow.rig?.id === defaultMaintenanceRigId
        )
      : [];
    const defaultMaintenanceRequestId =
      preselectedMaintenance?.id ||
      (maintenanceRequestsForDefaultRig.length === 1
        ? maintenanceRequestsForDefaultRig[0].id
        : "");
    setUseRequestError(null);
    setUseRequestForm({
      quantity: "1",
      reasonType,
      reasonDetails: "",
      maintenanceRigId: defaultMaintenanceRigId,
      projectId: preselectedMaintenance?.project?.id || "",
      rigId: preselectedMaintenance?.rig?.id || selectedItemDetails.data.compatibleRigId || "",
      maintenanceRequestId: defaultMaintenanceRequestId,
      breakdownReportId: preselectedBreakdown?.id || "",
      locationId: selectedItemDetails.data.locationId || "",
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
      if (quantity > selectedItemDetails.data.quantityInStock) {
        throw new Error("Requested quantity is above stock on hand. Create a purchase request to replenish first.");
      }
      if (
        useRequestForm.reasonType !== "MAINTENANCE" &&
        useRequestForm.reasonType !== "BREAKDOWN"
      ) {
        throw new Error("Select Maintenance or Breakdown before submitting.");
      }

      if (useRequestForm.reasonType === "MAINTENANCE") {
        if (!useRequestForm.maintenanceRigId) {
          throw new Error("Select a rig under maintenance.");
        }
        if (openMaintenanceRequestsForSelectedRig.length === 0) {
          throw new Error(
            "No open maintenance case exists for the selected rig. Open a maintenance case first."
          );
        }
      }

      let resolvedMaintenanceRequestId = useRequestForm.maintenanceRequestId.trim();
      if (useRequestForm.reasonType === "MAINTENANCE") {
        if (openMaintenanceRequestsForSelectedRig.length === 1) {
          resolvedMaintenanceRequestId = openMaintenanceRequestsForSelectedRig[0].id;
        } else {
          if (!resolvedMaintenanceRequestId) {
            throw new Error("Select which open maintenance case this request belongs to.");
          }
          const linkedCase = openMaintenanceRequestsForSelectedRig.some(
            (requestRow) => requestRow.id === resolvedMaintenanceRequestId
          );
          if (!linkedCase) {
            throw new Error("Selected maintenance case is not open for the selected rig.");
          }
        }
      }
      if (useRequestForm.reasonType === "BREAKDOWN" && !useRequestForm.breakdownReportId) {
        throw new Error("Select an open breakdown record.");
      }

      const response = await fetch("/api/inventory/usage-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          itemId: selectedItemDetails.data.id,
          quantity,
          reasonType: useRequestForm.reasonType,
          usageReason: useRequestForm.reasonType,
          reasonDetails: useRequestForm.reasonDetails.trim(),
          projectId: null,
          rigId:
            useRequestForm.reasonType === "MAINTENANCE"
              ? useRequestForm.maintenanceRigId || null
              : null,
          maintenanceRequestId:
            useRequestForm.reasonType === "MAINTENANCE"
              ? resolvedMaintenanceRequestId || null
              : null,
          breakdownReportId: useRequestForm.breakdownReportId || null,
          locationId: useRequestForm.locationId || null,
          sourceLocationId: useRequestForm.locationId || null,
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
        reasonType: "",
        reasonDetails: "",
        maintenanceRigId: "",
        projectId: "",
        rigId: "",
        maintenanceRequestId: "",
        breakdownReportId: "",
        locationId: "",
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

  function continueToPurchaseRequest() {
    const query = new URLSearchParams();

    if (useRequestForm.reasonType === "BREAKDOWN") {
      if (useRequestForm.breakdownReportId) {
        query.set("breakdownId", useRequestForm.breakdownReportId);
      }
      if (selectedBreakdownContext?.project?.id) {
        query.set("projectId", selectedBreakdownContext.project.id);
      }
    } else if (useRequestForm.reasonType === "MAINTENANCE") {
      if (!useRequestForm.maintenanceRigId) {
        setUseRequestError("Select a rig under maintenance first.");
        return;
      }
      if (openMaintenanceRequestsForSelectedRig.length === 0) {
        setUseRequestError(
          "No open maintenance case exists for this rig. Open maintenance first."
        );
        return;
      }
      if (
        openMaintenanceRequestsForSelectedRig.length > 1 &&
        !useRequestForm.maintenanceRequestId
      ) {
        setUseRequestError(
          "Select which open maintenance case this purchase request belongs to."
        );
        return;
      }
      const resolvedMaintenanceContext =
        selectedMaintenanceContext ||
        (openMaintenanceRequestsForSelectedRig.length === 1
          ? openMaintenanceRequestsForSelectedRig[0]
          : null);
      if (resolvedMaintenanceContext?.project?.id) {
        query.set("projectId", resolvedMaintenanceContext.project.id);
      }
      if (resolvedMaintenanceContext?.id) {
        query.set("maintenanceRequestId", resolvedMaintenanceContext.id);
      }
    }

    const destination = query.toString() ? `/expenses?${query.toString()}` : "/expenses";
    setRequestUseModalOpen(false);
    setUseRequestError(null);
    router.push(destination);
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
        ? "Track inventory movement history, operational linkage, and cost recognition."
        : showIssues
          ? "Resolve gaps in inventory, usage, and cost flow."
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
          label: "Open Purchase Follow-up",
          href: buildHref("/purchasing/receipt-follow-up"),
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

  useEffect(() => {
    if (!showIssues) {
      return;
    }
    const nextIssueId = triageQueueIssues[0]?.id || filteredIssues[0]?.id || "";
    if (!selectedIssueId && nextIssueId) {
      setSelectedIssueId(nextIssueId);
      return;
    }
    if (selectedIssueId && !filteredIssues.some((issue) => issue.id === selectedIssueId)) {
      setSelectedIssueId(nextIssueId);
    }
  }, [filteredIssues, selectedIssueId, showIssues, triageQueueIssues]);

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
              {showMovements ? (
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Inventory</p>
              ) : null}
              <h1
                className={cn(
                  "font-semibold tracking-tight text-ink-900",
                  showMovements ? "text-3xl md:text-[2rem]" : "text-2xl md:text-[1.7rem]"
                )}
              >
                {pageTitle}
              </h1>
              <p className="mt-1 text-sm text-slate-600">{pageSubtitle}</p>
            </div>
            <div className={cn("flex flex-wrap gap-2", showMovements ? "ml-auto justify-end" : "")}>
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
                  <Link href="/purchasing/receipt-follow-up" className="gf-btn-secondary px-3 py-1.5 text-xs">
                    Complete Purchase
                  </Link>
                </>
              ) : showMovements ? (
                <>
                  {canManage ? (
                    <button
                      type="button"
                      onClick={() => setManualMovementModalOpen(true)}
                      className="gf-btn-primary px-3 py-1.5 text-xs"
                    >
                      New Manual Adjustment
                    </button>
                  ) : null}
                  <Link href="/purchasing/receipt-follow-up" className="gf-btn-secondary px-3 py-1.5 text-xs">
                    Open Purchase Follow-up
                  </Link>
                  <Link href="/inventory?section=overview" className="gf-btn-secondary px-3 py-1.5 text-xs">
                    Back to Overview
                  </Link>
                </>
              ) : (
                <>
                  <Link href="/inventory" className="gf-btn-secondary px-3 py-1.5 text-xs">
                    Back to Overview
                  </Link>
                  <Link href="/purchasing/receipt-follow-up" className="gf-btn-secondary px-3 py-1.5 text-xs">
                    Open Purchase Follow-up
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
          <InventoryIssuesWorkspace
            focusedSectionId={focusedSectionId}
            issuesLoading={issuesLoading}
            issuesResponse={issuesResponse}
            issueTriageFilter={issueTriageFilter}
            setIssueTriageFilter={setIssueTriageFilter}
            needsLinkingCount={needsLinkingCount}
            costNotRecognizedCount={costNotRecognizedCount}
            showLowPriorityIssues={showLowPriorityIssues}
            setShowLowPriorityIssues={setShowLowPriorityIssues}
            lowPriorityHiddenCount={lowPriorityHiddenCount}
            filteredIssues={filteredIssues}
            issueSeverityFilter={issueSeverityFilter}
            setIssueSeverityFilter={setIssueSeverityFilter}
            issueTypeFilter={issueTypeFilter}
            setIssueTypeFilter={setIssueTypeFilter}
            issueCategoryFilter={issueCategoryFilter}
            setIssueCategoryFilter={setIssueCategoryFilter}
            issueCategoryOptions={issueCategoryOptions}
            issueItemQuery={issueItemQuery}
            setIssueItemQuery={setIssueItemQuery}
            triageQueueIssues={triageQueueIssues}
            issueContextById={issueContextById}
            selectedIssue={selectedIssue}
            selectedIssueContext={selectedIssueContext}
            openIssueWorkflow={openIssueWorkflow}
            openItemDetail={openItemDetail}
            openMovementDetail={openMovementDetail}
            canManage={canManage}
            lowRiskNamingFixes={lowRiskNamingFixes}
            applyBulkLowRiskNamingAutoFix={applyBulkLowRiskNamingAutoFix}
          />
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
                          Scoped to your account. Approved requests create stock-out history; rejected requests do not mutate stock.
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
                          No usage requests found for your account in this status.
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

        {showItems && showCreateItemForm && (
        <section id="inventory-actions-section" className="grid min-w-0 items-start gap-4 xl:grid-cols-[1.2fr_1fr]">
          {canManage && showItems && showCreateItemForm && (
            <Card
              className="min-w-0"
              title="Inventory Manual Entry"
              subtitle="Create inventory items directly. Purchase receipt follow-up now lives in Purchasing → Receipt Follow-up."
            >
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-xs text-brand-900">
                <p className="font-medium">Need receipt-based intake? Use the dedicated Purchase Follow-up workflow.</p>
                <Link
                  href="/purchasing/receipt-follow-up"
                  className="inline-flex rounded border border-brand-300 bg-white px-2 py-1 font-semibold text-brand-800 hover:bg-brand-100"
                >
                  Open Purchase Follow-up
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

        </section>
        )}

        {showMovements && (
          <InventoryMovementsWorkspace
            focusedSectionId={focusedSectionId}
            movementLedgerSummary={movementLedgerSummary}
            movementTypeFilter={movementTypeFilter}
            setMovementTypeFilter={setMovementTypeFilter}
            movementQuery={movementQuery}
            setMovementQuery={setMovementQuery}
            filteredMovements={filteredMovements}
            visibleMovements={visibleMovements}
            focusedRowId={focusedRowId}
            openMovementDetail={openMovementDetail}
          />
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

        <InventoryIssueWorkflowModal
          open={issueWorkflowModalOpen}
          onClose={() => setIssueWorkflowModalOpen(false)}
          issue={selectedIssue}
          issueContext={selectedIssueContext}
          initialStep={issueWorkflowInitialStep}
          onFixIssue={fixInventoryIssue}
          onOpenItem={openItemDetail}
          onOpenMovement={openMovementDetail}
        />

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
        <InventoryManualMovementModal
          open={manualMovementModalOpen}
          onClose={() => setManualMovementModalOpen(false)}
          onSubmit={submitMovementForm}
          saving={savingMovement}
          form={movementForm}
          onFormChange={(patch) => setMovementForm((current) => ({ ...current, ...patch }))}
          items={items}
          clients={clients}
          projects={projects}
          rigs={rigs}
          maintenanceRequests={maintenanceRequests}
          suppliers={suppliers}
          locations={locations}
        />
        <MovementDetailModal
          open={movementDetailDrawerOpen}
          onClose={() => setMovementDetailDrawerOpen(false)}
          movement={selectedMovementDetails}
          canApproveMovement={canApproveMovement}
          onRefresh={async () => {
            await loadInventoryData();
            await loadSelectedMovementDetails();
          }}
          onFlagIssue={openIssueQueueForMovement}
        />
        <RequestUseModal
          open={requestUseModalOpen}
          onClose={closeRequestUseModal}
          onSubmit={submitUseRequest}
          onContinueToPurchaseRequest={continueToPurchaseRequest}
          form={useRequestForm}
          onFormChange={setUseRequestForm}
          maintenanceRequests={openMaintenanceRequests}
          breakdownReports={openBreakdownReports}
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

function MovementDetailModal({
  open,
  onClose,
  movement,
  canApproveMovement,
  onRefresh,
  onFlagIssue
}: {
  open: boolean;
  onClose: () => void;
  movement: InventoryMovementRow | null;
  canApproveMovement: boolean;
  onRefresh: () => Promise<void>;
  onFlagIssue: (movementId: string) => void;
}) {
  const [isMounted, setIsMounted] = useState(open);
  const [isVisible, setIsVisible] = useState(open);
  const [workflowStep, setWorkflowStep] = useState<1 | 2 | 3>(1);
  const [submittingDecision, setSubmittingDecision] = useState(false);
  const [decisionFeedback, setDecisionFeedback] = useState<{
    tone: "success" | "error" | "info";
    message: string;
  } | null>(null);

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

  useEffect(() => {
    if (!open) {
      return;
    }
    setWorkflowStep(1);
    setDecisionFeedback(null);
    setSubmittingDecision(false);
  }, [movement?.id, open]);

  if (!isMounted) {
    return null;
  }

  const stepSummary = [
    { id: 1 as const, title: "Understand", subtitle: "Confirm item movement details." },
    { id: 2 as const, title: "Validate", subtitle: "Check operational context before approval." },
    { id: 3 as const, title: "Confirm", subtitle: "Approve this movement or flag an issue." }
  ];
  const linkedMaintenance =
    movement?.linkedUsageRequest?.maintenanceRequest || movement?.maintenanceRequest || null;
  const expenseStatus = String(movement?.expense?.approvalStatus || "").toUpperCase();
  const expenseStatusLabel = movement?.expense?.approvalStatus
    ? `${movement.expense.approvalStatus.charAt(0)}${movement.expense.approvalStatus
        .slice(1)
        .toLowerCase()}`
    : "Not linked";
  const modalTitle = movement
    ? movement.item?.name?.trim()
      ? `${movement.item.name.trim()} movement`
      : `${formatMovementType(movement.movementType)} movement`
    : "Loading movement";

  async function approveMovement() {
    if (!movement) {
      return;
    }
    if (!movement.expense?.id) {
      setDecisionFeedback({
        tone: "error",
        message: "No linked expense found. Flag this movement so traceability can be restored."
      });
      return;
    }
    if (!canApproveMovement) {
      setDecisionFeedback({
        tone: "error",
        message: "Only Admin or Manager can approve this movement confirmation."
      });
      return;
    }
    if (expenseStatus === "APPROVED") {
      setDecisionFeedback({
        tone: "success",
        message: "Movement already confirmed. Linked expense is approved."
      });
      return;
    }
    if (expenseStatus !== "SUBMITTED") {
      setDecisionFeedback({
        tone: "error",
        message: `Linked expense is ${expenseStatus ? expenseStatus.toLowerCase() : "not submitted"}. Submit it before approval.`
      });
      return;
    }

    setSubmittingDecision(true);
    setDecisionFeedback(null);
    try {
      const response = await fetch(`/api/expenses/${encodeURIComponent(movement.expense.id)}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "approve" })
      });
      if (!response.ok) {
        throw new Error(await readApiError(response, "Failed to approve movement."));
      }
      await onRefresh();
      setDecisionFeedback({
        tone: "success",
        message: "Movement approved. Linked expense is now recognized."
      });
    } catch (error) {
      setDecisionFeedback({
        tone: "error",
        message: error instanceof Error ? error.message : "Failed to approve movement."
      });
    } finally {
      setSubmittingDecision(false);
    }
  }

  return (
    <div
      className={`fixed inset-0 z-[84] flex items-center justify-center p-3 transition-opacity duration-200 ease-out sm:p-6 ${
        isVisible ? "opacity-100" : "pointer-events-none opacity-0"
      }`}
    >
      <button
        type="button"
        onClick={onClose}
        className={`absolute inset-0 bg-slate-900/35 backdrop-blur-[2px] transition-opacity duration-200 ${
          isVisible ? "opacity-100" : "opacity-0"
        }`}
        aria-label="Close movement detail modal"
      />
      <section
        className={`relative z-10 flex h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-[0_24px_64px_rgba(15,23,42,0.24)] transition-all duration-200 ease-out ${
          isVisible ? "translate-y-0 scale-100 opacity-100" : "translate-y-1 scale-[0.985] opacity-0"
        }`}
      >
        <div className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 px-5 py-4 shadow-[0_1px_0_rgba(15,23,42,0.06)] backdrop-blur">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Movement Approval</p>
              <p className="text-xl font-semibold text-ink-900">{modalTitle}</p>
              <p className="mt-0.5 text-xs font-medium text-slate-600">Step {workflowStep} of 3</p>
              <SystemFlowBar current="movement" className="mt-2" />
              <div className="mt-2 flex items-center gap-1.5">
                {stepSummary.map((step) => (
                  <span
                    key={step.id}
                    className={cn(
                      "h-1.5 w-6 rounded-full",
                      workflowStep === step.id
                        ? "bg-ink-900"
                        : workflowStep > step.id
                          ? "bg-emerald-400"
                          : "bg-slate-200"
                    )}
                  />
                ))}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 p-1">
              <button
                type="button"
                onClick={onClose}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-900"
                aria-label="Close movement detail"
              >
                <X size={14} />
              </button>
            </div>
          </div>
        </div>

        {!movement ? (
          <div className="p-4 text-sm text-ink-600">Loading movement details...</div>
        ) : (
          <>
            <div className="flex-1 overflow-y-auto bg-slate-50/40 p-4 sm:p-5">
              <section className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {stepSummary[workflowStep - 1]?.title}
                </p>
                <p className="text-xs text-slate-600">{stepSummary[workflowStep - 1]?.subtitle}</p>
              </section>

              {workflowStep === 1 ? (
                <section className="mt-3 rounded-lg border border-slate-200 bg-white p-3 transition-all duration-200 ease-out">
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    <SummaryBadge label="Item" value={movementItemLabel(movement)} />
                    <SummaryBadge label="Type" value={formatMovementType(movement.movementType)} />
                    <SummaryBadge label="Quantity" value={formatNumber(movement.quantity)} />
                    <SummaryBadge label="Location From" value={movement.locationFrom?.name || "-"} />
                    <SummaryBadge label="Location To" value={movement.locationTo?.name || "-"} />
                    <SummaryBadge label="Date" value={toIsoDate(movement.date)} />
                  </div>
                </section>
              ) : null}

              {workflowStep === 2 ? (
                <section className="mt-3 rounded-lg border border-slate-200 bg-white p-3 transition-all duration-200 ease-out">
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                    <SummaryBadge label="Project" value={movement.project?.name || "-"} />
                    <SummaryBadge label="Rig" value={movement.rig?.rigCode || "-"} />
                    <SummaryBadge
                      label="User"
                      value={
                        movement.performedBy?.fullName ||
                        movement.linkedUsageRequest?.requestedBy?.fullName ||
                        "-"
                      }
                    />
                    <SummaryBadge label="Maintenance" value={linkedMaintenance?.requestCode || "-"} />
                  </div>
                </section>
              ) : null}

              {workflowStep === 3 ? (
                <section className="mt-3 rounded-lg border border-slate-200 bg-white p-3 transition-all duration-200 ease-out">
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    <SummaryBadge label="Linked Expense" value={movement.expense?.id ? movement.expense.id.slice(-8) : "Not linked"} />
                    <SummaryBadge label="Expense Status" value={expenseStatusLabel} />
                    <SummaryBadge
                      label="Recognition"
                      value={expenseStatus === "APPROVED" ? "Cost recognized" : "Pending recognition"}
                    />
                  </div>
                  {decisionFeedback ? (
                    <div
                      className={cn(
                        "mt-2 rounded-lg border px-3 py-2 text-xs",
                        decisionFeedback.tone === "success"
                          ? "border-emerald-300 bg-emerald-50 text-emerald-900"
                          : decisionFeedback.tone === "error"
                            ? "border-red-300 bg-red-50 text-red-900"
                            : "border-slate-200 bg-slate-50 text-slate-700"
                      )}
                    >
                      {decisionFeedback.message}
                    </div>
                  ) : null}
                </section>
              ) : null}
            </div>

            <div className="flex items-center justify-between border-t border-slate-200 bg-white px-5 py-3">
              <div>
                {workflowStep > 1 ? (
                  <button
                    type="button"
                    onClick={() => setWorkflowStep((step) => (step > 1 ? ((step - 1) as 1 | 2 | 3) : step))}
                    className="gf-btn-secondary px-3 py-1.5 text-xs"
                  >
                    Back
                  </button>
                ) : null}
              </div>
              <div>
                {workflowStep < 3 ? (
                  <button
                    type="button"
                    onClick={() => setWorkflowStep((step) => (step < 3 ? ((step + 1) as 1 | 2 | 3) : step))}
                    className="gf-btn-primary px-3 py-1.5 text-xs"
                  >
                    Continue
                  </button>
                ) : (
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        if (movement?.id) {
                          onFlagIssue(movement.id);
                        }
                      }}
                      className="gf-btn-secondary px-3 py-1.5 text-xs"
                    >
                      Flag issue
                    </button>
                    <button
                      type="button"
                      onClick={() => void approveMovement()}
                      disabled={submittingDecision}
                      className="gf-btn-primary px-3 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {submittingDecision ? "Approving..." : "Approve movement"}
                    </button>
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </section>
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
  onContinueToPurchaseRequest,
  form,
  onFormChange,
  maintenanceRequests,
  breakdownReports,
  locations,
  item,
  submitting,
  errorMessage
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => Promise<void>;
  onContinueToPurchaseRequest: () => void;
  form: UseRequestFormState;
  onFormChange: React.Dispatch<React.SetStateAction<UseRequestFormState>>;
  maintenanceRequests: MaintenanceContextOption[];
  breakdownReports: BreakdownContextOption[];
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

  const maintenanceRigOptions = useMemo(() => {
    const byId = new Map<string, { id: string; rigCode: string }>();
    for (const requestRow of maintenanceRequests) {
      if (requestRow.rig?.id && requestRow.rig?.rigCode) {
        byId.set(requestRow.rig.id, {
          id: requestRow.rig.id,
          rigCode: requestRow.rig.rigCode
        });
      }
    }
    return Array.from(byId.values()).sort((a, b) => a.rigCode.localeCompare(b.rigCode));
  }, [maintenanceRequests]);
  const maintenanceRequestsForSelectedRig = useMemo(() => {
    if (!form.maintenanceRigId) {
      return [];
    }
    return maintenanceRequests.filter(
      (requestRow) => requestRow.rig?.id === form.maintenanceRigId
    );
  }, [form.maintenanceRigId, maintenanceRequests]);

  useEffect(() => {
    if (form.reasonType !== "MAINTENANCE") {
      return;
    }
    if (!form.maintenanceRigId) {
      if (form.maintenanceRequestId) {
        onFormChange((current) =>
          current.reasonType === "MAINTENANCE" && !current.maintenanceRigId
            ? { ...current, maintenanceRequestId: "" }
            : current
        );
      }
      return;
    }

    if (maintenanceRequestsForSelectedRig.length === 1) {
      const autoLinkedId = maintenanceRequestsForSelectedRig[0].id;
      if (form.maintenanceRequestId !== autoLinkedId) {
        onFormChange((current) =>
          current.reasonType === "MAINTENANCE" &&
          current.maintenanceRigId === form.maintenanceRigId
            ? { ...current, maintenanceRequestId: autoLinkedId, rigId: current.maintenanceRigId }
            : current
        );
      }
      return;
    }

    if (
      form.maintenanceRequestId &&
      !maintenanceRequestsForSelectedRig.some(
        (requestRow) => requestRow.id === form.maintenanceRequestId
      )
    ) {
      onFormChange((current) =>
        current.reasonType === "MAINTENANCE" &&
        current.maintenanceRigId === form.maintenanceRigId
          ? { ...current, maintenanceRequestId: "" }
          : current
      );
    }
  }, [
    form.maintenanceRequestId,
    form.maintenanceRigId,
    form.reasonType,
    maintenanceRequestsForSelectedRig,
    onFormChange
  ]);

  if (!isMounted) {
    return null;
  }

  const projectedStock = Number(form.quantity || 0) > 0 ? item ? item.quantityInStock - Number(form.quantity || 0) : null : null;
  const selectedMaintenanceContext =
    maintenanceRequests.find((requestRow) => requestRow.id === form.maintenanceRequestId) || null;
  const resolvedMaintenanceContext =
    selectedMaintenanceContext ||
    (maintenanceRequestsForSelectedRig.length === 1
      ? maintenanceRequestsForSelectedRig[0]
      : null);
  const selectedBreakdownContext =
    breakdownReports.find((entry) => entry.id === form.breakdownReportId) || null;
  const workflowStep = form.reasonType ? 2 : 1;
  const hasStockShortage =
    projectedStock !== null && Number.isFinite(projectedStock) && projectedStock < 0;
  const hasRequiredContextSelection =
    form.reasonType === "MAINTENANCE"
      ? form.maintenanceRigId
        ? maintenanceRequestsForSelectedRig.length === 1
          ? true
          : maintenanceRequestsForSelectedRig.length > 1
            ? Boolean(form.maintenanceRequestId)
            : false
        : false
      : form.reasonType === "BREAKDOWN"
        ? Boolean(form.breakdownReportId)
        : false;
  const projectedStockWarning =
    hasStockShortage
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
        <div className="space-y-2 border-b border-slate-200 px-4 py-3">
          <p className="text-sm font-semibold text-ink-900">Request Item Use</p>
          <p className="text-xs text-slate-600">
            {item ? `${item.name} (${item.sku})` : "Submit usage request for approval"}
          </p>
          {item && <p className="mt-1 text-xs text-slate-500">Stock on hand: {formatNumber(item.quantityInStock)}</p>}
          <div className="flex flex-wrap gap-1.5">
            <span
              className={cn(
                "rounded-full border px-2 py-0.5 text-[11px] font-semibold",
                workflowStep === 1
                  ? "border-brand-300 bg-brand-50 text-brand-800"
                  : "border-slate-200 bg-slate-50 text-slate-500"
              )}
            >
              1. Reason
            </span>
            <span
              className={cn(
                "rounded-full border px-2 py-0.5 text-[11px] font-semibold",
                workflowStep === 2
                  ? "border-brand-300 bg-brand-50 text-brand-800"
                  : "border-slate-200 bg-slate-50 text-slate-500"
              )}
            >
              2. Operational context
            </span>
          </div>
        </div>
        {item?.status !== "ACTIVE" && (
          <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-900">
            This item is inactive. Reactivate it before submitting a usage request.
          </div>
        )}
        {projectedStockWarning && (
          <div className="space-y-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-900">
            <p>{projectedStockWarning}</p>
            <button
              type="button"
              onClick={onContinueToPurchaseRequest}
              className="rounded-md border border-amber-300 bg-amber-100 px-2 py-1 text-[11px] font-semibold text-amber-900 hover:bg-amber-200"
            >
              Create purchase request
            </button>
          </div>
        )}
        {errorMessage && (
          <div className="border-b border-red-200 bg-red-50 px-4 py-2 text-xs text-red-800">{errorMessage}</div>
        )}
        <form onSubmit={(event) => void onSubmit(event)} className="space-y-3 px-4 py-4">
          <section className="space-y-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Step 1 — Reason for request
            </p>
            <div className="grid gap-2 md:grid-cols-2">
              {([
                { value: "MAINTENANCE", label: "Maintenance" },
                { value: "BREAKDOWN", label: "Breakdown" }
              ] as const).map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() =>
                    onFormChange((current) => ({
                      ...current,
                      reasonType: option.value,
                      maintenanceRigId:
                        option.value === "MAINTENANCE"
                          ? current.maintenanceRigId
                          : "",
                      maintenanceRequestId:
                        option.value === "MAINTENANCE" ? current.maintenanceRequestId : "",
                      breakdownReportId:
                        option.value === "BREAKDOWN" ? current.breakdownReportId : ""
                    }))
                  }
                  className={cn(
                    "rounded-lg border px-3 py-2 text-left text-sm font-medium transition-colors",
                    form.reasonType === option.value
                      ? "border-brand-300 bg-brand-50 text-brand-900"
                      : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </section>

          <section className="space-y-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Step 2 — Operational context
            </p>
            {!form.reasonType ? (
              <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                Select a reason to continue.
              </p>
            ) : (
              <div className="grid gap-3 md:grid-cols-2">
                <InputField
                  label="Quantity"
                  type="number"
                  value={form.quantity}
                  onChange={(value) =>
                    onFormChange((current) => ({ ...current, quantity: value }))
                  }
                  required
                />
                <FilterSelect
                  label="From Location"
                  value={form.locationId}
                  onChange={(value) =>
                    onFormChange((current) => ({ ...current, locationId: value }))
                  }
                  options={[
                    { value: "", label: "Select location" },
                    ...locations.map((location) => ({ value: location.id, label: location.name }))
                  ]}
                />

                {form.reasonType === "MAINTENANCE" && (
                  <>
                    <FilterSelect
                      label="Rig Under Maintenance"
                      value={form.maintenanceRigId}
                      onChange={(value) =>
                        onFormChange((current) => ({
                          ...current,
                          maintenanceRigId: value,
                          maintenanceRequestId: ""
                        }))
                      }
                      options={[
                        {
                          value: "",
                          label:
                            maintenanceRigOptions.length > 0
                              ? "Select rig"
                              : "No rigs currently under maintenance"
                        },
                        ...maintenanceRigOptions.map((entry) => ({
                          value: entry.id,
                          label: entry.rigCode
                        }))
                      ]}
                    />
                    {form.maintenanceRigId && maintenanceRequestsForSelectedRig.length === 1 ? (
                      <label className="text-xs text-ink-700">
                        <span className="mb-1 block uppercase tracking-wide text-slate-500">
                          Open Maintenance
                        </span>
                        <input
                          value={`${maintenanceRequestsForSelectedRig[0].requestCode} (auto-linked)`}
                          readOnly
                          className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700"
                        />
                      </label>
                    ) : (
                      <FilterSelect
                        label="Open Maintenance"
                        value={form.maintenanceRequestId}
                        onChange={(value) =>
                          onFormChange((current) => ({
                            ...current,
                            maintenanceRequestId: value
                          }))
                        }
                        options={[
                          {
                            value: "",
                            label:
                              form.maintenanceRigId
                                ? maintenanceRequestsForSelectedRig.length > 1
                                  ? "Select maintenance record"
                                  : "No open records for selected rig"
                                : "Select rig first"
                          },
                          ...maintenanceRequestsForSelectedRig.map((requestRow) => ({
                            value: requestRow.id,
                            label: `${requestRow.requestCode} • ${
                              requestRow.rig?.rigCode || "No rig"
                            }`
                          }))
                        ]}
                      />
                    )}
                    <label className="text-xs text-ink-700">
                      <span className="mb-1 block uppercase tracking-wide text-slate-500">
                        Note (optional)
                      </span>
                      <input
                        value={form.reasonDetails}
                        onChange={(event) =>
                          onFormChange((current) => ({
                            ...current,
                            reasonDetails: event.target.value
                          }))
                        }
                        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                        placeholder="Short usage note"
                      />
                    </label>
                    {form.maintenanceRigId &&
                      maintenanceRequestsForSelectedRig.length === 0 && (
                        <p className="md:col-span-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                          No open maintenance case found for this rig. Report maintenance first,
                          then request item usage.
                        </p>
                      )}
                    {form.maintenanceRigId &&
                      maintenanceRequestsForSelectedRig.length > 1 &&
                      !form.maintenanceRequestId && (
                        <p className="md:col-span-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
                          Multiple open maintenance cases found for this rig. Select the case this
                          request belongs to.
                        </p>
                      )}
                    {resolvedMaintenanceContext && (
                      <div className="md:col-span-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
                        <p>
                          <span className="font-semibold">Rig:</span>{" "}
                          {resolvedMaintenanceContext.rig?.rigCode || "-"}
                        </p>
                        <p>
                          <span className="font-semibold">Project:</span>{" "}
                          {resolvedMaintenanceContext.project?.name || "No active project"}
                        </p>
                        {resolvedMaintenanceContext.issueDescription ? (
                          <p>
                            <span className="font-semibold">Work:</span>{" "}
                            {resolvedMaintenanceContext.issueDescription}
                          </p>
                        ) : null}
                      </div>
                    )}
                  </>
                )}

                {form.reasonType === "BREAKDOWN" && (
                  <>
                    <FilterSelect
                      label="Open Breakdown"
                      value={form.breakdownReportId}
                      onChange={(value) =>
                        onFormChange((current) => ({
                          ...current,
                          breakdownReportId: value
                        }))
                      }
                      options={[
                        {
                          value: "",
                          label:
                            breakdownReports.length > 0
                              ? "Select breakdown record"
                              : "No open breakdown records"
                        },
                        ...breakdownReports.map((entry) => ({
                          value: entry.id,
                          label: `${entry.title} • ${entry.rig?.rigCode || "No rig"}`
                        }))
                      ]}
                    />
                    <label className="text-xs text-ink-700">
                      <span className="mb-1 block uppercase tracking-wide text-slate-500">
                        Note (optional)
                      </span>
                      <input
                        value={form.reasonDetails}
                        onChange={(event) =>
                          onFormChange((current) => ({
                            ...current,
                            reasonDetails: event.target.value
                          }))
                        }
                        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                        placeholder="Short usage note"
                      />
                    </label>
                    {selectedBreakdownContext && (
                      <div className="md:col-span-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
                        <p>
                          <span className="font-semibold">Rig:</span>{" "}
                          {selectedBreakdownContext.rig?.rigCode || "-"}
                        </p>
                        <p>
                          <span className="font-semibold">Project:</span>{" "}
                          {selectedBreakdownContext.project?.name || "-"}
                        </p>
                        <p>
                          <span className="font-semibold">Severity:</span>{" "}
                          {selectedBreakdownContext.severity}
                        </p>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </section>

          <div className="flex flex-wrap justify-end gap-2 md:col-span-2">
            <button type="button" onClick={onClose} className="gf-btn-secondary px-3 py-1.5 text-xs">
              Cancel
            </button>
            {hasStockShortage && (
              <button
                type="button"
                onClick={onContinueToPurchaseRequest}
                className="rounded-md border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-900 hover:bg-amber-100"
              >
                Create purchase request
              </button>
            )}
            <button
              type="submit"
              disabled={
                submitting ||
                item?.status !== "ACTIVE" ||
                hasStockShortage ||
                !hasRequiredContextSelection
              }
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
