import type { RequisitionFormState, RequisitionType } from "./requisition-workflow-types";

interface RequisitionProjectOption {
  id: string;
  name: string;
  clientId: string;
  assignedRigId?: string | null;
}

export function deriveForcedRequestType(options: {
  hasBreakdownEntryContext: boolean;
  hasMaintenanceEntryContext: boolean;
  isProjectMode: boolean;
  isWorkshopMode: boolean;
}): RequisitionType | null {
  if (options.hasBreakdownEntryContext) {
    return "LIVE_PROJECT_PURCHASE";
  }
  if (options.isProjectMode) {
    return "LIVE_PROJECT_PURCHASE";
  }
  if (options.isWorkshopMode) {
    return options.hasMaintenanceEntryContext ? "MAINTENANCE_PURCHASE" : "INVENTORY_STOCK_UP";
  }
  return null;
}

export function deriveHistoryTypeFilter(options: {
  hasMaintenanceEntryContext: boolean;
  isProjectMode: boolean;
  isWorkshopMode: boolean;
}): RequisitionType | null {
  if (options.isProjectMode) {
    return "LIVE_PROJECT_PURCHASE";
  }
  if (options.isWorkshopMode && options.hasMaintenanceEntryContext) {
    return "MAINTENANCE_PURCHASE";
  }
  if (options.isWorkshopMode) {
    return "INVENTORY_STOCK_UP";
  }
  return null;
}

export function deriveLockedRequestTypeCard(options: {
  hasBreakdownEntryContext: boolean;
  hasMaintenanceEntryContext: boolean;
  isProjectLocked: boolean;
  isProjectMode: boolean;
  isWorkshopMode: boolean;
}) {
  if (options.hasBreakdownEntryContext) {
    return {
      title: "Breakdown-linked Purchase",
      description: "This request was opened from a breakdown case."
    };
  }
  if (options.isProjectMode) {
    return {
      title: "Project Purchase",
      description: options.isProjectLocked
        ? "Project mode keeps this request in the locked project."
        : "Project mode keeps this request as a project purchase."
    };
  }
  if (options.isWorkshopMode && options.hasMaintenanceEntryContext) {
    return {
      title: "Maintenance-linked Purchase",
      description: "This request was opened from a maintenance case."
    };
  }
  if (options.isWorkshopMode) {
    return {
      title: "Inventory Stock-up",
      description: "Workshop mode creates stock-up requests for inventory operations."
    };
  }
  return null;
}

export function coerceFormForForcedRequestType(options: {
  current: RequisitionFormState;
  forcedRequestType: RequisitionType | null;
  filtersProjectId: string;
  initialMaintenanceRequestId: string;
  initialProjectId: string;
  isProjectLocked: boolean;
  projects: RequisitionProjectOption[];
}): RequisitionFormState {
  const {
    current,
    forcedRequestType,
    filtersProjectId,
    initialMaintenanceRequestId,
    initialProjectId,
    isProjectLocked,
    projects
  } = options;
  if (!forcedRequestType) {
    return current;
  }

  let next = current;
  let changed = false;
  const applyUpdate = (value: Partial<RequisitionFormState>) => {
    next = { ...next, ...value };
    changed = true;
  };

  if (next.type !== forcedRequestType) {
    applyUpdate({ type: forcedRequestType });
  }

  if (forcedRequestType === "LIVE_PROJECT_PURCHASE") {
    const nextProjectId = (isProjectLocked ? filtersProjectId : next.projectId) || initialProjectId || "";
    const sourceProject = (nextProjectId && projects.find((project) => project.id === nextProjectId)) || null;
    const nextClientId = sourceProject?.clientId || "";
    const nextRigId = sourceProject?.assignedRigId || "";
    const nextLiveSpendType = next.breakdownReportId ? "BREAKDOWN" : "NORMAL_EXPENSE";
    if (next.projectId !== nextProjectId) {
      applyUpdate({ projectId: nextProjectId });
    }
    if (next.clientId !== nextClientId) {
      applyUpdate({ clientId: nextClientId });
    }
    if (next.rigId !== nextRigId) {
      applyUpdate({ rigId: nextRigId });
    }
    if (next.maintenanceRequestId) {
      applyUpdate({ maintenanceRequestId: "" });
    }
    if (next.stockLocationId || next.inventoryReason || next.maintenancePriority) {
      applyUpdate({
        stockLocationId: "",
        inventoryReason: "",
        maintenancePriority: ""
      });
    }
    if (next.liveProjectSpendType !== nextLiveSpendType) {
      applyUpdate({ liveProjectSpendType: nextLiveSpendType });
    }
  } else if (forcedRequestType === "INVENTORY_STOCK_UP") {
    if (
      next.projectId ||
      next.clientId ||
      next.rigId ||
      next.maintenanceRequestId ||
      next.breakdownReportId ||
      next.liveProjectSpendType ||
      next.maintenancePriority
    ) {
      applyUpdate({
        projectId: "",
        clientId: "",
        rigId: "",
        maintenanceRequestId: "",
        breakdownReportId: "",
        liveProjectSpendType: "",
        maintenancePriority: ""
      });
    }
  } else if (forcedRequestType === "MAINTENANCE_PURCHASE") {
    const nextMaintenanceRequestId = initialMaintenanceRequestId || next.maintenanceRequestId;
    if (next.projectId || next.clientId || next.breakdownReportId || next.stockLocationId || next.inventoryReason) {
      applyUpdate({
        projectId: "",
        clientId: "",
        breakdownReportId: "",
        stockLocationId: "",
        inventoryReason: ""
      });
    }
    if (next.liveProjectSpendType) {
      applyUpdate({ liveProjectSpendType: "" });
    }
    if (next.maintenanceRequestId !== nextMaintenanceRequestId) {
      applyUpdate({ maintenanceRequestId: nextMaintenanceRequestId });
    }
  }

  return changed ? next : current;
}

export function hasRequisitionDraftStarted(options: {
  form: RequisitionFormState;
  minimumWizardStep: number;
  wizardStep: number;
}) {
  if (options.wizardStep > options.minimumWizardStep) {
    return true;
  }
  return Boolean(
    options.form.itemName.trim() ||
      options.form.shortReason.trim() ||
      options.form.requestedVendorName.trim() ||
      options.form.estimatedUnitCost.trim() ||
      options.form.itemNote.trim()
  );
}
