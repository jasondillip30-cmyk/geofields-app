"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { AccessGate } from "@/components/layout/access-gate";
import { InventoryIssuesWorkspace } from "@/components/inventory/inventory-issues-workspace";
import { InventoryMovementsWorkspace } from "@/components/inventory/inventory-movements-workspace";
import { toIsoDate } from "@/components/inventory/inventory-page-utils";
import { readApiError } from "@/components/inventory/inventory-page-shared";
import { useRegisterCopilotContext } from "@/components/layout/ai-copilot-context";
import { useAnalyticsFilters } from "@/components/layout/analytics-filters-provider";
import { scrollToFocusElement, useCopilotFocusTarget } from "@/components/layout/copilot-focus-target";
import { useRole } from "@/components/layout/role-provider";
import { canManageExpenseApprovalActions } from "@/lib/auth/approval-policy";
import { canAccess } from "@/lib/auth/permissions";
import type { CopilotPageContext } from "@/lib/ai/contextual-copilot";
import { buildScopedHref } from "@/lib/drilldown";
import { InventoryPageChrome } from "./inventory-page-chrome";
import { InventoryPageModals } from "./inventory-page-modals";
import {
  loadInventoryCategorySuggestion,
  loadInventoryItemDetailsById,
  loadInventoryMovementDetailsById,
  loadInventoryReferenceData,
  loadInventoryWorkspaceData,
  loadMyUsageRequestBatchesMine,
  loadMyUsageRequestsMine
} from "./inventory-page-data";
import { InventoryItemsSection, InventoryManualEntrySection, InventorySuppliersLocationsSection, UsageRequestToast } from "./inventory-page-panels";
import {
  defaultIssues,
  defaultOverview,
  defaultSuggestion,
  type BreakdownContextOption,
  type CategorySuggestionState,
  type InventoryIssueRow,
  type InventoryIssuesResponse,
  type InventoryItemDetailsResponse,
  type InventoryItemRow,
  type InventoryLocation,
  type InventoryMovementRow,
  type InventoryOverviewResponse,
  type InventorySupplier,
  type InventoryUsageBatchRow,
  type InventoryUsageRequestRow,
  type IssueTriageFilter,
  type ItemFormState,
  type LocationFormState,
  type MaintenanceContextOption,
  type MovementFormState,
  type SupplierFormState,
  type UseRequestFormState
} from "./inventory-page-types";
import { buildInventoryCopilotContext } from "./inventory-page-copilot-context";
import { createInventoryFormHandlers, defaultItemFormState } from "./inventory-page-form-handlers";
import { createInventoryIssueHandlers } from "./inventory-page-issue-handlers";
import { createInventoryUseRequestHandlers } from "./inventory-page-use-request-handlers";
import { buildInventorySectionState } from "./inventory-page-section-state";
import { useInventoryDerivedState } from "./inventory-page-derived-state";

export type {
  BreakdownContextOption,
  InventoryIssueRow,
  InventoryItemDetailsResponse,
  InventoryItemRow,
  InventoryLocation,
  InventoryMovementRow,
  InventorySupplier,
  MaintenanceContextOption,
  MovementFormState,
  UseRequestFormState
} from "./inventory-page-types";

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
  const preselectedProjectId = searchParams.get("projectId")?.trim() || "";
  const preselectedRigId = searchParams.get("rigId")?.trim() || "";
  const canManage = Boolean(user?.role && canAccess(user.role, "inventory:manage"));
  const canApproveMovement = Boolean(user?.role && canManageExpenseApprovalActions(user.role));
  const canViewInventoryValue = user?.role ? user.role !== "MECHANIC" && user.role !== "FIELD" : true;

  const [clients, setClients] = useState<Array<{ id: string; name: string }>>([]);
  const [projects, setProjects] = useState<
    Array<{
      id: string;
      name: string;
      clientId: string;
      assignedRigId: string | null;
      backupRigId: string | null;
    }>
  >([]);
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

  const [itemForm, setItemForm] = useState<ItemFormState>(() => ({ ...defaultItemFormState }));
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
  const [requestUseBatchModalOpen, setRequestUseBatchModalOpen] = useState(false);
  const [usageBatchDetailModalOpen, setUsageBatchDetailModalOpen] = useState(false);
  const [submittingUseRequest, setSubmittingUseRequest] = useState(false);
  const [useRequestError, setUseRequestError] = useState<string | null>(null);
  const [usageRequestsLoading, setUsageRequestsLoading] = useState(false);
  const [usageBatchRequestsLoading, setUsageBatchRequestsLoading] = useState(false);
  const [usageRequestStatusFilter, setUsageRequestStatusFilter] = useState<
    "ALL" | "SUBMITTED" | "PENDING" | "APPROVED" | "REJECTED"
  >("ALL");
  const [usageBatchStatusFilter, setUsageBatchStatusFilter] = useState<
    "ALL" | "SUBMITTED" | "PENDING" | "APPROVED" | "REJECTED" | "PARTIALLY_APPROVED"
  >("ALL");
  const [myUsageRequests, setMyUsageRequests] = useState<InventoryUsageRequestRow[]>([]);
  const [myUsageBatchRequests, setMyUsageBatchRequests] = useState<InventoryUsageBatchRow[]>([]);
  const [selectedUsageBatchId, setSelectedUsageBatchId] = useState("");
  const [selectedUsageBatchDetails, setSelectedUsageBatchDetails] =
    useState<InventoryUsageBatchRow | null>(null);
  const usageRequestFetchSeq = useRef(0);
  const usageBatchFetchSeq = useRef(0);
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
    drillReportId: "",
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
  const isSingleProjectScope = filters.projectId !== "all";
  const {
    scopedProject,
    selectedClientLabel,
    selectedRigLabel,
    openMaintenanceRequests,
    openBreakdownReports,
    maintenanceRigOptions,
    selectedMaintenanceContext,
    openMaintenanceRequestsForSelectedRig,
    selectedBreakdownContext,
    stockAlertRows,
    filteredMovements,
    visibleMovements,
    projectUsageSummary,
    movementLedgerSummary,
    selectedItemIssues,
    issueCategoryOptions,
    filteredIssues,
    lowPriorityHiddenCount,
    needsLinkingCount,
    costNotRecognizedCount,
    triageQueueIssues,
    issueContextById,
    selectedIssue,
    selectedIssueContext,
    lowRiskNamingFixes,
    suggestionMismatch
  } = useInventoryDerivedState({
    projects,
    projectId: filters.projectId,
    clientId: filters.clientId,
    rigId: filters.rigId,
    isSingleProjectScope,
    clients,
    rigs,
    maintenanceRequests,
    breakdownReports,
    useRequestForm,
    overview,
    movements,
    movementTypeFilter,
    movementQuery,
    items,
    selectedItemId,
    issues: issuesResponse.issues,
    showLowPriorityIssues,
    issueSeverityFilter,
    issueTypeFilter,
    issueCategoryFilter,
    issueItemQuery,
    issueTriageFilter,
    selectedIssueId,
    itemForm,
    categorySuggestion
  });

  const loadReferenceData = useCallback(async () => {
    const referenceData = await loadInventoryReferenceData();
    setClients(referenceData.clients);
    setProjects(referenceData.projects);
    setRigs(referenceData.rigs);
    setMaintenanceRequests(referenceData.maintenanceRequests);
    setBreakdownReports(referenceData.breakdownReports);
    setSuppliers(referenceData.suppliers);
    setLocations(referenceData.locations);
  }, []);

  const loadInventoryData = useCallback(async () => {
    setLoading(true);
    setErrorMessage(null);
    setIssuesLoading(true);
    try {
      const workspaceData = await loadInventoryWorkspaceData({
        filters: {
          from: filters.from,
          to: filters.to,
          clientId: filters.clientId,
          rigId: filters.rigId,
          projectId: filters.projectId
        },
        isSingleProjectScope,
        itemSearch,
        itemCategoryFilter,
        supplierFilter,
        locationFilter,
        stockFilter
      });

      setItems(workspaceData.items);
      setMovements(workspaceData.movements);
      setOverview(workspaceData.overview || defaultOverview);
      setIssuesResponse(workspaceData.issues || defaultIssues);
      if (!selectedItemId && workspaceData.items?.[0]?.id) {
        setSelectedItemId(workspaceData.items[0].id);
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
  }, [
    filters.clientId,
    filters.from,
    filters.projectId,
    filters.rigId,
    filters.to,
    isSingleProjectScope,
    itemCategoryFilter,
    itemSearch,
    locationFilter,
    selectedItemId,
    stockFilter,
    supplierFilter
  ]);

  const loadMyUsageRequests = useCallback(
    async (statusOverride?: "ALL" | "SUBMITTED" | "PENDING" | "APPROVED" | "REJECTED") => {
      const requestSeq = ++usageRequestFetchSeq.current;
      setUsageRequestsLoading(true);
      try {
        const payload = await loadMyUsageRequestsMine({
          status: statusOverride || usageRequestStatusFilter,
          filters: {
            from: filters.from,
            to: filters.to,
            clientId: filters.clientId,
            rigId: filters.rigId,
            projectId: filters.projectId
          }
        });
        if (requestSeq === usageRequestFetchSeq.current) {
          setMyUsageRequests(payload || []);
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
    [
      filters.clientId,
      filters.from,
      filters.projectId,
      filters.rigId,
      filters.to,
      usageRequestStatusFilter
    ]
  );

  const loadMyUsageBatchRequests = useCallback(
    async (
      statusOverride?:
        | "ALL"
        | "SUBMITTED"
        | "PENDING"
        | "APPROVED"
        | "REJECTED"
        | "PARTIALLY_APPROVED"
    ) => {
      const requestSeq = ++usageBatchFetchSeq.current;
      setUsageBatchRequestsLoading(true);
      try {
        const payload = await loadMyUsageRequestBatchesMine({
          status: statusOverride || usageBatchStatusFilter,
          filters: {
            from: filters.from,
            to: filters.to,
            clientId: filters.clientId,
            rigId: filters.rigId,
            projectId: filters.projectId
          }
        });
        if (requestSeq === usageBatchFetchSeq.current) {
          setMyUsageBatchRequests(payload || []);
        }
      } catch {
        if (requestSeq === usageBatchFetchSeq.current) {
          setMyUsageBatchRequests([]);
        }
      } finally {
        if (requestSeq === usageBatchFetchSeq.current) {
          setUsageBatchRequestsLoading(false);
        }
      }
    },
    [
      filters.clientId,
      filters.from,
      filters.projectId,
      filters.rigId,
      filters.to,
      usageBatchStatusFilter
    ]
  );

  const loadSelectedItemDetails = useCallback(async () => {
    const payload = await loadInventoryItemDetailsById({
      itemId: selectedItemId,
      filters: {
        from: filters.from,
        to: filters.to,
        clientId: filters.clientId,
        rigId: filters.rigId,
        projectId: filters.projectId
      }
    });
    setSelectedItemDetails(payload);
  }, [filters.clientId, filters.from, filters.projectId, filters.rigId, filters.to, selectedItemId]);

  const loadSelectedMovementDetails = useCallback(async () => {
    try {
      const payload = await loadInventoryMovementDetailsById(selectedMovementId);
      setSelectedMovementDetails(payload);
    } catch {
      setSelectedMovementDetails(null);
    }
  }, [selectedMovementId]);

  const loadSelectedUsageBatchDetails = useCallback(async () => {
    if (!selectedUsageBatchId) {
      setSelectedUsageBatchDetails(null);
      return;
    }
    try {
      const query = new URLSearchParams();
      query.set("scope", "mine");
      query.set("requestedBy", "me");
      const response = await fetch(
        `/api/inventory/usage-requests/batches/${selectedUsageBatchId}?${query.toString()}`,
        { cache: "no-store" }
      );
      if (!response.ok) {
        throw new Error(
          await readApiError(response, "Failed to load usage batch details.")
        );
      }
      const payload = (await response.json()) as { data?: InventoryUsageBatchRow };
      setSelectedUsageBatchDetails(payload.data || null);
    } catch {
      setSelectedUsageBatchDetails(null);
    }
  }, [selectedUsageBatchId]);

  const loadCategorySuggestion = useCallback(async () => {
    setSuggestionLoading(true);
    try {
      const suggestion = await loadInventoryCategorySuggestion({
        name: itemForm.name,
        sku: itemForm.sku,
        description: itemForm.description,
        category: itemForm.category,
        supplierId: itemForm.supplierId,
        customCategoryLabel: itemForm.customCategoryLabel
      });
      setCategorySuggestion(suggestion);
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
    void loadMyUsageBatchRequests();
  }, [loadMyUsageBatchRequests]);

  useEffect(() => {
    void loadSelectedItemDetails();
  }, [loadSelectedItemDetails]);

  useEffect(() => {
    void loadSelectedMovementDetails();
  }, [loadSelectedMovementDetails]);

  useEffect(() => {
    void loadSelectedUsageBatchDetails();
  }, [loadSelectedUsageBatchDetails]);

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
    const sectionFromQuery = (searchParams.get("section") || "").toLowerCase();
    const movementSectionActive =
      pathname === "/inventory/stock-movements" || sectionFromQuery === "stock-movements";
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
    if (canManage && movementSectionActive) {
      setManualMovementModalOpen(true);
    }
  }, [canManage, pathname, searchParams]);

  useEffect(() => {
    const itemsRouteActive = pathname === "/inventory/items" || pathname === "/inventory";
    if (!itemsRouteActive || isSingleProjectScope) {
      setShowCreateItemForm(false);
      return;
    }
    if (searchParams.get("create") === "1") {
      setShowCreateItemForm(true);
    }
  }, [isSingleProjectScope, pathname, searchParams]);

  const {
    submitItemForm,
    submitMovementForm,
    submitSupplierForm,
    submitLocationForm
  } = createInventoryFormHandlers({
    itemForm,
    movementForm,
    supplierForm,
    locationForm,
    movementSubmitInFlightRef,
    setSavingItem,
    setSavingMovement,
    setSavingSupplier,
    setSavingLocation,
    setNotice,
    setErrorMessage,
    setItemForm,
    setCategorySuggestion,
    defaultSuggestion,
    loadInventoryData,
    loadReferenceData,
    setManualMovementModalOpen,
    setMovementForm,
    loadSelectedItemDetails,
    setSupplierForm,
    setLocationForm
  });

  const {
    applyBulkLowRiskNamingAutoFix,
    fixInventoryIssue,
    openItemDetail,
    openMovementDetail,
    openIssueWorkflow
  } = createInventoryIssueHandlers({
    issues: issuesResponse.issues,
    movements,
    selectedItemId,
    lowRiskNamingFixes,
    setErrorMessage,
    setNotice,
    setSelectedItemId,
    setSelectedMovementId,
    setMovementDetailDrawerOpen,
    setSelectedIssueId,
    setIssueWorkflowInitialStep,
    setIssueWorkflowModalOpen,
    setItemDetailModalOpen,
    loadInventoryData,
    loadSelectedItemDetails,
    routerPush: (href) => router.push(href)
  });

  const {
    openRequestUseModal,
    submitUseRequest,
    closeRequestUseModal,
    continueToPurchaseRequest
  } = createInventoryUseRequestHandlers({
    selectedItemDetails,
    isSingleProjectScope,
    scopedProject,
    preselectedUsageReason,
    preselectedBreakdownId,
    openBreakdownReports,
    preselectedMaintenanceRequestId,
    openMaintenanceRequests,
    maintenanceRigOptions,
    preselectedProjectId,
    preselectedRigId,
    useRequestForm,
    openMaintenanceRequestsForSelectedRig,
    selectedBreakdownContext,
    selectedMaintenanceContext,
    setUseRequestError,
    setUseRequestForm,
    setRequestUseModalOpen,
    setSubmittingUseRequest,
    setErrorMessage,
    setNotice,
    setUsageRequestToast,
    setUsageRequestStatusFilter,
    loadMyUsageRequests,
    routerPush: (href) => router.push(href),
    readApiError
  });

  const openRequestUseBatchModal = useCallback(() => {
    setUseRequestError(null);
    setRequestUseBatchModalOpen(true);
  }, []);

  const closeRequestUseBatchModal = useCallback(() => {
    setRequestUseBatchModalOpen(false);
  }, []);

  const handleUsageBatchSubmitted = useCallback(async () => {
    setNotice("Inventory usage batch submitted for approval.");
    setUsageRequestToast({
      tone: "success",
      message: "Usage batch request submitted."
    });
    setUsageBatchStatusFilter("ALL");
    await Promise.all([
      loadMyUsageRequests("ALL"),
      loadMyUsageBatchRequests("ALL")
    ]);
  }, [loadMyUsageBatchRequests, loadMyUsageRequests]);

  const openUsageBatchDetail = useCallback((batchId: string) => {
    if (!batchId) {
      return;
    }
    setSelectedUsageBatchId(batchId);
    setUsageBatchDetailModalOpen(true);
  }, []);

  const closeUsageBatchDetail = useCallback(() => {
    setUsageBatchDetailModalOpen(false);
  }, []);

  const handleToggleSelectedItemStatus = useCallback(
    async (nextStatus: "ACTIVE" | "INACTIVE") => {
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
    },
    [loadInventoryData, loadSelectedItemDetails, selectedItemDetails?.data?.id]
  );

  const refreshMovementDetails = useCallback(async () => {
    await loadInventoryData();
    await loadSelectedMovementDetails();
  }, [loadInventoryData, loadSelectedMovementDetails]);

  const {
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
  } = useMemo(
    () =>
      buildInventorySectionState({
        pathname,
        sectionParam: searchParams.get("section"),
        isSingleProjectScope,
        createFromDeepLinkFlag: searchParams.get("create") === "1"
      }),
    [isSingleProjectScope, pathname, searchParams]
  );

  const buildHref = useCallback(
    (path: string, overrides?: Record<string, string | null | undefined>) => buildScopedHref(filters, path, overrides),
    [filters]
  );

  useEffect(() => {
    if (!lockedProjectSectionRedirected) {
      return;
    }
    const nextQuery = new URLSearchParams(searchParams.toString());
    nextQuery.delete("section");
    const query = nextQuery.toString();
    router.replace(query ? `/inventory/items?${query}` : "/inventory/items");
  }, [lockedProjectSectionRedirected, router, searchParams]);

  const copilotContext = useMemo<CopilotPageContext>(() => buildInventoryCopilotContext({
    copilotPageKey,
    pageTitle,
    filters,
    isSingleProjectScope,
    canViewInventoryValue,
    showItems,
    showMovements,
    showIssuesWorkspace,
    showSuppliers,
    showLocations,
    overview,
    movementsLength: movements.length,
    stockAlertRows,
    items,
    filteredMovements,
    filteredIssues,
    suppliers,
    locations,
    selectedItemId,
    selectedItemDetails,
    buildHref
  }), [
    buildHref,
    copilotPageKey,
    filters,
    filteredIssues,
    filteredMovements,
    isSingleProjectScope,
    canViewInventoryValue,
    items,
    locations,
    movements.length,
    overview,
    pageTitle,
    selectedItemDetails,
    selectedItemId,
    showIssuesWorkspace,
    showLocations,
    showMovements,
    showItems,
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
    <AccessGate denyBehavior="redirect" permission="inventory:view">
      <InventoryPageChrome
        notice={notice}
        errorMessage={errorMessage}
        filters={filters}
        selectedClientLabel={selectedClientLabel}
        selectedRigLabel={selectedRigLabel}
        isSingleProjectScope={isSingleProjectScope}
        isProjectScopedInventoryView={isProjectScopedInventoryView}
        showMovements={showMovements}
        pageTitle={pageTitle}
        pageSubtitle={pageSubtitle}
      >
        {showIssuesWorkspace && (
          <InventoryIssuesWorkspace
            isProjectLocked={isSingleProjectScope}
            projectName={scopedProject?.name || null}
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

        {showIssuesLockedNotice && (
          <section className="rounded-xl border border-slate-200 bg-white px-4 py-4">
            <p className="text-sm font-semibold text-ink-900">Inventory issues are hidden in locked project mode.</p>
            <p className="mt-1 text-sm text-slate-700">
              Switch to All projects mode to manage warehouse issues.
            </p>
          </section>
        )}

        <InventoryItemsSection
          showItems={showItems}
          canViewInventoryValue={canViewInventoryValue}
          focusedSectionId={focusedSectionId}
          isSingleProjectScope={isSingleProjectScope}
          createFromDeepLinkBlocked={createFromDeepLinkBlocked}
          canManage={canManage}
          showCreateItemForm={showCreateItemForm}
          setShowCreateItemForm={setShowCreateItemForm}
          itemSearch={itemSearch}
          setItemSearch={setItemSearch}
          itemCategoryFilter={itemCategoryFilter}
          setItemCategoryFilter={setItemCategoryFilter}
          supplierFilter={supplierFilter}
          setSupplierFilter={setSupplierFilter}
          locationFilter={locationFilter}
          setLocationFilter={setLocationFilter}
          stockFilter={stockFilter}
          setStockFilter={setStockFilter}
          suppliers={suppliers}
          locations={locations}
          loading={loading}
          items={items}
          overview={overview}
          focusedRowId={focusedRowId}
          openItemDetail={openItemDetail}
          projectUsageSummary={projectUsageSummary}
          usageRequestStatusFilter={usageRequestStatusFilter}
          setUsageRequestStatusFilter={setUsageRequestStatusFilter}
          usageRequestsLoading={usageRequestsLoading}
          myUsageRequests={myUsageRequests}
          usageBatchStatusFilter={usageBatchStatusFilter}
          setUsageBatchStatusFilter={setUsageBatchStatusFilter}
          usageBatchRequestsLoading={usageBatchRequestsLoading}
          myUsageBatchRequests={myUsageBatchRequests}
          openUsageBatchDetail={openUsageBatchDetail}
          openMovementDetail={openMovementDetail}
        />

        <InventoryManualEntrySection
          showItems={showItems}
          showCreateItemForm={showCreateItemForm}
          isSingleProjectScope={isSingleProjectScope}
          canManage={canManage}
          submitItemForm={submitItemForm}
          itemForm={itemForm}
          setItemForm={setItemForm}
          categorySuggestion={categorySuggestion}
          suggestionLoading={suggestionLoading}
          suggestionMismatch={Boolean(suggestionMismatch)}
          suppliers={suppliers}
          locations={locations}
          rigs={rigs}
          savingItem={savingItem}
        />

        {showMovements && (
          <InventoryMovementsWorkspace
            isProjectLocked={isSingleProjectScope}
            projectName={scopedProject?.name || null}
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

        <InventorySuppliersLocationsSection
          canManage={canManage}
          showSuppliers={showSuppliers}
          showLocations={showLocations}
          focusedSectionId={focusedSectionId}
          supplierForm={supplierForm}
          setSupplierForm={setSupplierForm}
          submitSupplierForm={submitSupplierForm}
          savingSupplier={savingSupplier}
          suppliers={suppliers}
          locationForm={locationForm}
          setLocationForm={setLocationForm}
          submitLocationForm={submitLocationForm}
          savingLocation={savingLocation}
          locations={locations}
          toIsoDate={toIsoDate}
        />

        <UsageRequestToast
          toast={usageRequestToast}
          onDismiss={() => setUsageRequestToast(null)}
        />

        <InventoryPageModals
          issueWorkflowModalOpen={issueWorkflowModalOpen}
          onCloseIssueWorkflowModal={() => setIssueWorkflowModalOpen(false)}
          selectedIssue={selectedIssue}
          selectedIssueContext={selectedIssueContext}
          issueWorkflowInitialStep={issueWorkflowInitialStep}
          fixInventoryIssue={fixInventoryIssue}
          openItemDetail={openItemDetail}
          openMovementDetail={openMovementDetail}
          itemDetailModalOpen={itemDetailModalOpen}
          onCloseItemDetailModal={() => setItemDetailModalOpen(false)}
          selectedItemDetails={selectedItemDetails}
          selectedItemIssues={selectedItemIssues}
          canManage={canManage}
          isSingleProjectScope={isSingleProjectScope}
          openRequestUseModal={openRequestUseModal}
          openRequestUseBatchModal={openRequestUseBatchModal}
          onToggleItemStatus={handleToggleSelectedItemStatus}
          manualMovementModalOpen={manualMovementModalOpen}
          onCloseManualMovementModal={() => setManualMovementModalOpen(false)}
          submitMovementForm={submitMovementForm}
          savingMovement={savingMovement}
          movementForm={movementForm}
          setMovementForm={(patch) => setMovementForm((current) => ({ ...current, ...patch }))}
          items={items}
          clients={clients}
          projects={projects}
          rigs={rigs}
          maintenanceRequests={maintenanceRequests}
          suppliers={suppliers}
          locations={locations}
          movementDetailDrawerOpen={movementDetailDrawerOpen}
          onCloseMovementDetailDrawer={() => setMovementDetailDrawerOpen(false)}
          selectedMovementDetails={selectedMovementDetails}
          canApproveMovement={canApproveMovement}
          refreshMovementDetails={refreshMovementDetails}
          requestUseModalOpen={requestUseModalOpen}
          closeRequestUseModal={closeRequestUseModal}
          submitUseRequest={submitUseRequest}
          requestUseBatchModalOpen={requestUseBatchModalOpen}
          closeRequestUseBatchModal={closeRequestUseBatchModal}
          onUsageBatchSubmitted={handleUsageBatchSubmitted}
          usageBatchDetailModalOpen={usageBatchDetailModalOpen}
          closeUsageBatchDetailModal={closeUsageBatchDetail}
          selectedUsageBatch={selectedUsageBatchDetails}
          continueToPurchaseRequest={continueToPurchaseRequest}
          useRequestForm={useRequestForm}
          setUseRequestForm={setUseRequestForm}
          openMaintenanceRequests={openMaintenanceRequests}
          openBreakdownReports={openBreakdownReports}
          scopedProject={scopedProject}
          submittingUseRequest={submittingUseRequest}
          useRequestError={useRequestError}
        />
      </InventoryPageChrome>
    </AccessGate>
  );
}

function InventoryPageFallback() {
  return (
    <AccessGate denyBehavior="redirect" permission="inventory:view">
      <div className="space-y-3">
        <p className="text-sm text-ink-600">Loading inventory workspace...</p>
      </div>
    </AccessGate>
  );
}
