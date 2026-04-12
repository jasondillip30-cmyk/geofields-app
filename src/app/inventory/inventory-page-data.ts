import { readApiError } from "@/components/inventory/inventory-page-shared";
import {
  defaultIssues,
  defaultOverview,
  defaultSuggestion,
  type BreakdownContextOption,
  type CategorySuggestionState,
  type InventoryIssuesResponse,
  type InventoryItemDetailsResponse,
  type InventoryItemRow,
  type InventoryLocation,
  type InventoryMovementRow,
  type InventoryOverviewResponse,
  type InventorySupplier,
  type InventoryUsageRequestRow,
  type ItemFormState,
  type MaintenanceContextOption
} from "./inventory-page-types";

export interface InventoryFilterScope {
  from: string;
  to: string;
  clientId: string;
  rigId: string;
  projectId: string;
}

export interface InventoryReferenceData {
  clients: Array<{ id: string; name: string }>;
  projects: Array<{
    id: string;
    name: string;
    clientId: string;
    assignedRigId: string | null;
    backupRigId: string | null;
  }>;
  rigs: Array<{ id: string; rigCode: string }>;
  maintenanceRequests: MaintenanceContextOption[];
  breakdownReports: BreakdownContextOption[];
  suppliers: InventorySupplier[];
  locations: InventoryLocation[];
}

export interface InventoryWorkspaceData {
  items: InventoryItemRow[];
  movements: InventoryMovementRow[];
  overview: InventoryOverviewResponse;
  issues: InventoryIssuesResponse;
}

export async function loadInventoryReferenceData(): Promise<InventoryReferenceData> {
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

  return {
    clients: (clientsPayload.data || []).map((client: { id: string; name: string }) => ({ id: client.id, name: client.name })),
    projects: (
      projectsPayload.data || []
    ).map(
      (project: {
        id: string;
        name: string;
        clientId: string;
        assignedRigId?: string | null;
        backupRigId?: string | null;
      }) => ({
        id: project.id,
        name: project.name,
        clientId: project.clientId,
        assignedRigId: project.assignedRigId || null,
        backupRigId: project.backupRigId || null
      })
    ),
    rigs: (rigsPayload.data || []).map((rig: { id: string; rigCode: string }) => ({ id: rig.id, rigCode: rig.rigCode })),
    maintenanceRequests: (maintenancePayload.data || []).map(
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
    ),
    breakdownReports: (breakdownsPayload.data || []).map(
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
    ),
    suppliers: suppliersPayload.data || [],
    locations: locationsPayload.data || []
  };
}

export async function loadInventoryWorkspaceData({
  filters,
  isSingleProjectScope,
  itemSearch,
  itemCategoryFilter,
  supplierFilter,
  locationFilter,
  stockFilter
}: {
  filters: InventoryFilterScope;
  isSingleProjectScope: boolean;
  itemSearch: string;
  itemCategoryFilter: string;
  supplierFilter: string;
  locationFilter: string;
  stockFilter: string;
}): Promise<InventoryWorkspaceData> {
  const query = new URLSearchParams();
  if (itemSearch.trim()) query.set("search", itemSearch.trim());
  if (itemCategoryFilter !== "all") query.set("category", itemCategoryFilter);
  if (!isSingleProjectScope && supplierFilter !== "all") query.set("supplierId", supplierFilter);
  if (!isSingleProjectScope && locationFilter !== "all") query.set("locationId", locationFilter);
  if (stockFilter !== "all") query.set("stock", stockFilter);
  if (isSingleProjectScope) query.set("projectId", filters.projectId);

  const movementQuery = new URLSearchParams();
  if (filters.from) movementQuery.set("from", filters.from);
  if (filters.to) movementQuery.set("to", filters.to);
  if (isSingleProjectScope) {
    movementQuery.set("projectId", filters.projectId);
    movementQuery.set("projectView", "locked");
  } else {
    if (filters.clientId !== "all") movementQuery.set("clientId", filters.clientId);
    if (filters.rigId !== "all") movementQuery.set("rigId", filters.rigId);
  }

  const [itemsRes, movementsRes, overviewRes, issuesRes] = await Promise.all([
    fetch(`/api/inventory/items?${query.toString()}`, { cache: "no-store" }),
    fetch(`/api/inventory/movements?${movementQuery.toString()}`, { cache: "no-store" }),
    fetch(`/api/inventory/overview?${movementQuery.toString()}`, { cache: "no-store" }),
    isSingleProjectScope
      ? Promise.resolve(null)
      : fetch(`/api/inventory/issues?${movementQuery.toString()}`, { cache: "no-store" })
  ]);

  const [itemsPayload, movementsPayload, overviewPayload, issuesPayload] = await Promise.all([
    itemsRes.ok ? itemsRes.json() : Promise.resolve({ data: [] }),
    movementsRes.ok ? movementsRes.json() : Promise.resolve({ data: [] }),
    overviewRes.ok ? overviewRes.json() : Promise.resolve(defaultOverview),
    isSingleProjectScope
      ? Promise.resolve(defaultIssues)
      : issuesRes && issuesRes.ok
        ? issuesRes.json()
        : Promise.resolve(defaultIssues)
  ]);

  return {
    items: itemsPayload.data || [],
    movements: movementsPayload.data || [],
    overview: overviewPayload || defaultOverview,
    issues: issuesPayload || defaultIssues
  };
}

export async function loadMyUsageRequestsMine(status: "ALL" | "SUBMITTED" | "PENDING" | "APPROVED" | "REJECTED") {
  const query = new URLSearchParams();
  query.set("scope", "mine");
  query.set("requestedBy", "me");
  query.set("status", status);

  const response = await fetch(`/api/inventory/usage-requests?${query.toString()}`, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(await readApiError(response, "Failed to load your usage requests."));
  }
  const payload = (await response.json()) as { data?: InventoryUsageRequestRow[] };
  return payload.data || [];
}

export async function loadInventoryItemDetailsById({
  itemId,
  filters
}: {
  itemId: string;
  filters: InventoryFilterScope;
}): Promise<InventoryItemDetailsResponse | null> {
  if (!itemId) {
    return null;
  }
  const query = new URLSearchParams();
  if (filters.from) query.set("from", filters.from);
  if (filters.to) query.set("to", filters.to);
  if (filters.clientId !== "all") query.set("clientId", filters.clientId);
  if (filters.rigId !== "all") query.set("rigId", filters.rigId);

  const response = await fetch(`/api/inventory/items/${itemId}?${query.toString()}`, {
    cache: "no-store"
  });
  if (!response.ok) {
    return null;
  }
  return (await response.json()) as InventoryItemDetailsResponse;
}

export async function loadInventoryMovementDetailsById(movementId: string): Promise<InventoryMovementRow | null> {
  if (!movementId) {
    return null;
  }
  const response = await fetch(`/api/inventory/movements/${movementId}`, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(await readApiError(response, "Failed to load movement details."));
  }
  const payload = await response.json();
  return (payload?.data || null) as InventoryMovementRow | null;
}

export async function loadInventoryCategorySuggestion(form: Pick<ItemFormState, "name" | "sku" | "description" | "category" | "supplierId" | "customCategoryLabel">): Promise<CategorySuggestionState> {
  if (!form.name.trim() && !form.sku.trim() && !form.description.trim()) {
    return defaultSuggestion;
  }

  const query = new URLSearchParams();
  query.set("name", form.name);
  query.set("sku", form.sku);
  query.set("description", form.description);
  query.set("selectedCategory", form.category);
  if (form.supplierId) {
    query.set("supplierId", form.supplierId);
  }
  if (form.customCategoryLabel) {
    query.set("customCategory", form.customCategoryLabel);
  }

  const response = await fetch(`/api/inventory/intelligence/suggest?${query.toString()}`, {
    cache: "no-store"
  });
  if (!response.ok) {
    return defaultSuggestion;
  }

  const payload = await response.json();
  return {
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
  };
}
