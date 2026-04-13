import type {
  InventoryLocationOption,
  MaintenanceLinkOption,
  RequisitionFormState,
  RequisitionLineItem,
  RequisitionStatus,
  RequisitionWizardStep,
  RequisitionWorkflowCardProps
} from "@/components/modules/requisition-workflow-types";
import { buildRequestNote } from "@/components/modules/requisition-workflow-helpers";

type Project = RequisitionWorkflowCardProps["projects"][number];

export function buildRequisitionHistorySearchParams({
  filters,
  isProjectLocked,
  statusFilter,
  historyTypeFilter,
  isWorkshopMode,
  hasMaintenanceEntryContext,
  maintenanceRequestId
}: {
  filters: RequisitionWorkflowCardProps["filters"];
  isProjectLocked: boolean;
  statusFilter: RequisitionStatus | "all";
  historyTypeFilter: string | null;
  isWorkshopMode: boolean;
  hasMaintenanceEntryContext: boolean;
  maintenanceRequestId: string;
}) {
  const query = new URLSearchParams();
  if (filters.from) query.set("from", filters.from);
  if (filters.to) query.set("to", filters.to);
  if (isProjectLocked) {
    query.set("projectId", filters.projectId);
  } else {
    if (filters.clientId !== "all") query.set("clientId", filters.clientId);
    if (filters.rigId !== "all") query.set("rigId", filters.rigId);
  }
  if (historyTypeFilter) {
    query.set("type", historyTypeFilter);
  }
  if (isWorkshopMode && hasMaintenanceEntryContext && maintenanceRequestId) {
    query.set("maintenanceRequestId", maintenanceRequestId);
  }
  if (statusFilter !== "all") {
    query.set("status", statusFilter);
  }
  return query;
}

export function validateRequisitionWizardStep({
  step,
  form,
  maintenanceLoading,
  maintenanceOptions,
  locationOptions,
  setupLoading,
  setupCategoriesCount,
  validLineItemsCount
}: {
  step: RequisitionWizardStep;
  form: RequisitionFormState;
  maintenanceLoading: boolean;
  maintenanceOptions: MaintenanceLinkOption[];
  locationOptions: InventoryLocationOption[];
  setupLoading: boolean;
  setupCategoriesCount: number;
  validLineItemsCount: number;
}) {
  if (step === 1 && !form.type) {
    return "Choose a requisition type to continue.";
  }
  if (step === 2) {
    if (form.type === "LIVE_PROJECT_PURCHASE" && !form.projectId) {
      return form.breakdownReportId
        ? "Breakdown-linked purchases require the linked project context."
        : "Project Purchase requires a project.";
    }
    if (form.type === "MAINTENANCE_PURCHASE" && !form.rigId) {
      return "Maintenance-linked purchases require a rig.";
    }
    if (form.type === "MAINTENANCE_PURCHASE") {
      if (maintenanceLoading) {
        return "Loading open maintenance cases for the selected rig.";
      }
      if (maintenanceOptions.length === 0) {
        return "No open maintenance case exists for this rig. Open a maintenance case first.";
      }
      if (maintenanceOptions.length > 1 && !form.maintenanceRequestId) {
        return "Select which open maintenance case this purchase belongs to.";
      }
    }
    if (
      form.type === "INVENTORY_STOCK_UP" &&
      locationOptions.length > 0 &&
      !form.stockLocationId
    ) {
      return "Inventory Stock-up requires a stock location.";
    }
  }
  if (step === 3 && validLineItemsCount === 0) {
    return "Enter item name, quantity, and estimated unit cost.";
  }
  if (step === 3 && setupLoading) {
    return "Loading setup categories.";
  }
  if (step === 3 && setupCategoriesCount === 0) {
    return "No setup categories are available. Configure categories in setup first.";
  }
  if (step === 3 && !form.categoryId.trim()) {
    return "Category is required.";
  }
  return null;
}

export function buildCreateRequisitionPayload({
  form,
  selectedLocationName,
  validLineItems,
  resolvedMaintenanceRequestId,
  effectiveProject,
  effectiveProjectId
}: {
  form: RequisitionFormState;
  selectedLocationName: string;
  validLineItems: RequisitionLineItem[];
  resolvedMaintenanceRequestId: string;
  effectiveProject: Project | null;
  effectiveProjectId: string;
}) {
  return {
    type: form.type,
    liveProjectSpendType:
      form.type === "LIVE_PROJECT_PURCHASE"
        ? form.breakdownReportId
          ? "BREAKDOWN"
          : "NORMAL_EXPENSE"
        : null,
    clientId:
      form.type === "LIVE_PROJECT_PURCHASE"
        ? effectiveProject?.clientId || null
        : null,
    projectId:
      form.type === "LIVE_PROJECT_PURCHASE"
        ? effectiveProjectId || null
        : null,
    rigId:
      form.type === "MAINTENANCE_PURCHASE"
        ? form.rigId || null
        : form.type === "LIVE_PROJECT_PURCHASE"
          ? effectiveProject?.assignedRigId || null
          : null,
    maintenanceRequestId:
      form.type === "MAINTENANCE_PURCHASE" && resolvedMaintenanceRequestId
        ? resolvedMaintenanceRequestId
        : null,
    breakdownReportId:
      form.type === "LIVE_PROJECT_PURCHASE" && form.breakdownReportId
        ? form.breakdownReportId
        : null,
    category: form.category,
    subcategory: form.subcategory || null,
    categoryId: form.categoryId || null,
    subcategoryId: form.subcategoryId || null,
    requestedVendorId: form.requestedVendorId || null,
    requestedVendorName: form.requestedVendorName || null,
    notes: buildRequestNote({
      type: form.type,
      shortReason: form.shortReason,
      maintenancePriority: form.maintenancePriority,
      inventoryReason: form.inventoryReason,
      stockLocationName: selectedLocationName
    }),
    lineItems: validLineItems
  };
}
