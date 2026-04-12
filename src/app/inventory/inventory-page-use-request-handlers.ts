import type {
  BreakdownContextOption,
  InventoryItemDetailsResponse,
  MaintenanceContextOption,
  UseRequestFormState
} from "./inventory-page-types";

type ScopedProject = {
  id: string;
  assignedRigId: string | null;
  backupRigId: string | null;
} | null;

type CreateInventoryUseRequestHandlersParams = {
  selectedItemDetails: InventoryItemDetailsResponse | null;
  isSingleProjectScope: boolean;
  scopedProject: ScopedProject;
  preselectedUsageReason: string;
  preselectedBreakdownId: string;
  openBreakdownReports: BreakdownContextOption[];
  preselectedMaintenanceRequestId: string;
  openMaintenanceRequests: MaintenanceContextOption[];
  maintenanceRigOptions: Array<{ id: string; rigCode: string }>;
  preselectedProjectId: string;
  preselectedRigId: string;
  useRequestForm: UseRequestFormState;
  openMaintenanceRequestsForSelectedRig: MaintenanceContextOption[];
  selectedBreakdownContext: BreakdownContextOption | null;
  selectedMaintenanceContext: MaintenanceContextOption | null;
  setUseRequestError: (value: string | null) => void;
  setUseRequestForm: (value: UseRequestFormState) => void;
  setRequestUseModalOpen: (value: boolean) => void;
  setSubmittingUseRequest: (value: boolean) => void;
  setErrorMessage: (value: string | null) => void;
  setNotice: (value: string | null) => void;
  setUsageRequestToast: (value: { tone: "success" | "error"; message: string } | null) => void;
  setUsageRequestStatusFilter: (value: "ALL" | "SUBMITTED" | "PENDING" | "APPROVED" | "REJECTED") => void;
  loadMyUsageRequests: (status?: "ALL" | "SUBMITTED" | "PENDING" | "APPROVED" | "REJECTED") => Promise<void>;
  routerPush: (href: string) => void;
  readApiError: (response: Response, fallback: string) => Promise<string>;
};

export function createInventoryUseRequestHandlers({
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
  routerPush,
  readApiError
}: CreateInventoryUseRequestHandlersParams) {
  function openRequestUseModal() {
    if (!selectedItemDetails?.data?.id) {
      return;
    }
    const hasLockedProjectContext = isSingleProjectScope && Boolean(scopedProject?.id);
    if (hasLockedProjectContext && scopedProject) {
      const lockedProjectRigIds = [scopedProject.assignedRigId, scopedProject.backupRigId].filter(
        (value): value is string => Boolean(value && value.trim())
      );
      const defaultLockedRigId =
        lockedProjectRigIds.length === 1
          ? lockedProjectRigIds[0]
          : selectedItemDetails.data.compatibleRigId &&
              lockedProjectRigIds.includes(selectedItemDetails.data.compatibleRigId)
            ? selectedItemDetails.data.compatibleRigId
            : "";

      setUseRequestError(null);
      setUseRequestForm({
        quantity: "1",
        reasonType: "DRILLING_REPORT",
        reasonDetails: "",
        maintenanceRigId: "",
        projectId: scopedProject.id,
        rigId: defaultLockedRigId,
        drillReportId: "",
        maintenanceRequestId: "",
        breakdownReportId: "",
        locationId: selectedItemDetails.data.locationId || ""
      });
      setRequestUseModalOpen(true);
      return;
    }

    const preselectedBreakdown =
      preselectedBreakdownId.length > 0
        ? openBreakdownReports.find((entry) => entry.id === preselectedBreakdownId) || null
        : null;
    const preselectedMaintenance =
      preselectedMaintenanceRequestId.length > 0
        ? openMaintenanceRequests.find((entry) => entry.id === preselectedMaintenanceRequestId) || null
        : null;
    const hasPreselectedDrillingContext =
      preselectedUsageReason === "DRILLING_REPORT" || hasLockedProjectContext;
    const reasonType: UseRequestFormState["reasonType"] = hasPreselectedDrillingContext
      ? "DRILLING_REPORT"
      : preselectedBreakdown
        ? "BREAKDOWN"
        : preselectedMaintenance || preselectedUsageReason === "MAINTENANCE"
          ? "MAINTENANCE"
          : "";
    const defaultMaintenanceRigId = preselectedMaintenance?.rig?.id
      ? preselectedMaintenance.rig.id
      : selectedItemDetails.data.compatibleRigId &&
          maintenanceRigOptions.some((entry) => entry.id === selectedItemDetails.data.compatibleRigId)
        ? selectedItemDetails.data.compatibleRigId
        : "";
    const maintenanceRequestsForDefaultRig = defaultMaintenanceRigId
      ? openMaintenanceRequests.filter((requestRow) => requestRow.rig?.id === defaultMaintenanceRigId)
      : [];
    const defaultMaintenanceRequestId =
      preselectedMaintenance?.id ||
      (maintenanceRequestsForDefaultRig.length === 1 ? maintenanceRequestsForDefaultRig[0].id : "");
    setUseRequestError(null);
    setUseRequestForm({
      quantity: "1",
      reasonType,
      reasonDetails: "",
      maintenanceRigId: defaultMaintenanceRigId,
      projectId:
        preselectedMaintenance?.project?.id ||
        (hasLockedProjectContext ? scopedProject?.id : "") ||
        (hasPreselectedDrillingContext ? preselectedProjectId : "") ||
        "",
      rigId:
        preselectedMaintenance?.rig?.id ||
        (hasLockedProjectContext
          ? scopedProject?.assignedRigId || scopedProject?.backupRigId || ""
          : "") ||
        (hasPreselectedDrillingContext ? preselectedRigId : "") ||
        "",
      drillReportId: "",
      maintenanceRequestId: defaultMaintenanceRequestId,
      breakdownReportId: preselectedBreakdown?.id || "",
      locationId: selectedItemDetails.data.locationId || ""
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
      const isLockedProjectUseFlow = isSingleProjectScope && Boolean(scopedProject?.id);
      const effectiveReasonType: UseRequestFormState["reasonType"] = isLockedProjectUseFlow
        ? "DRILLING_REPORT"
        : useRequestForm.reasonType;
      const effectiveProjectId =
        effectiveReasonType === "DRILLING_REPORT"
          ? (isLockedProjectUseFlow ? scopedProject?.id || "" : useRequestForm.projectId).trim()
          : "";
      const effectiveRigId =
        effectiveReasonType === "DRILLING_REPORT" ? (useRequestForm.rigId || "").trim() : "";

      if (
        effectiveReasonType !== "MAINTENANCE" &&
        effectiveReasonType !== "BREAKDOWN" &&
        effectiveReasonType !== "DRILLING_REPORT"
      ) {
        throw new Error("Select Maintenance, Breakdown, or Drilling report before submitting.");
      }

      if (effectiveReasonType === "MAINTENANCE") {
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
      if (effectiveReasonType === "MAINTENANCE") {
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
      if (effectiveReasonType === "BREAKDOWN" && !useRequestForm.breakdownReportId) {
        throw new Error("Select an open breakdown record.");
      }
      if (effectiveReasonType === "DRILLING_REPORT" && !effectiveProjectId) {
        throw new Error("Select a project for drilling usage.");
      }
      if (effectiveReasonType === "DRILLING_REPORT" && !effectiveRigId) {
        throw new Error("Select a project rig for drilling usage.");
      }

      const response = await fetch("/api/inventory/usage-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          itemId: selectedItemDetails.data.id,
          quantity,
          reasonType: effectiveReasonType,
          usageReason: effectiveReasonType,
          reasonDetails: useRequestForm.reasonDetails.trim(),
          projectId: effectiveReasonType === "DRILLING_REPORT" ? effectiveProjectId || null : null,
          rigId:
            effectiveReasonType === "MAINTENANCE"
              ? useRequestForm.maintenanceRigId || null
              : effectiveReasonType === "DRILLING_REPORT"
                ? effectiveRigId || null
                : null,
          drillReportId: null,
          maintenanceRequestId:
            effectiveReasonType === "MAINTENANCE" ? resolvedMaintenanceRequestId || null : null,
          breakdownReportId:
            effectiveReasonType === "BREAKDOWN" ? useRequestForm.breakdownReportId || null : null,
          locationId: useRequestForm.locationId || null,
          sourceLocationId: useRequestForm.locationId || null
        })
      });

      if (!response.ok) {
        throw new Error(await readApiError(response, "Failed to submit item usage request."));
      }

      setNotice("Inventory usage request submitted for approval.");
      setUsageRequestToast({
        tone: "success",
        message: "Usage request submitted."
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
        drillReportId: "",
        maintenanceRequestId: "",
        breakdownReportId: "",
        locationId: ""
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
    const isLockedProjectUseFlow = isSingleProjectScope && Boolean(scopedProject?.id);
    const effectiveReasonType: UseRequestFormState["reasonType"] = isLockedProjectUseFlow
      ? "DRILLING_REPORT"
      : useRequestForm.reasonType;
    const query = new URLSearchParams();

    if (effectiveReasonType === "BREAKDOWN") {
      if (useRequestForm.breakdownReportId) {
        query.set("breakdownId", useRequestForm.breakdownReportId);
      }
      if (selectedBreakdownContext?.project?.id) {
        query.set("projectId", selectedBreakdownContext.project.id);
      }
    } else if (effectiveReasonType === "DRILLING_REPORT") {
      if (isLockedProjectUseFlow && scopedProject?.id) {
        query.set("projectId", scopedProject.id);
      } else if (useRequestForm.projectId) {
        query.set("projectId", useRequestForm.projectId);
      }
      if (useRequestForm.rigId) {
        query.set("rigId", useRequestForm.rigId);
      }
    } else if (effectiveReasonType === "MAINTENANCE") {
      if (!useRequestForm.maintenanceRigId) {
        setUseRequestError("Select a rig under maintenance first.");
        return;
      }
      if (openMaintenanceRequestsForSelectedRig.length === 0) {
        setUseRequestError("No open maintenance case exists for this rig. Open maintenance first.");
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
    routerPush(destination);
  }

  return {
    openRequestUseModal,
    submitUseRequest,
    closeRequestUseModal,
    continueToPurchaseRequest
  };
}
