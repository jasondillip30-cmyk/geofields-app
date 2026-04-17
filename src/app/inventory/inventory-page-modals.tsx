"use client";

import type { Dispatch, FormEvent, SetStateAction } from "react";

import { InventoryIssueWorkflowModal } from "@/components/inventory/inventory-issue-workflow-modal";
import { InventoryManualMovementModal } from "@/components/inventory/inventory-manual-movement-modal";
import { ItemDetailModal } from "@/components/inventory/modals/item-detail-modal";
import { MovementDetailModal } from "@/components/inventory/modals/movement-detail-modal";
import { RequestUseBatchModal } from "@/components/inventory/modals/request-use-batch-modal";
import { RequestUseModal } from "@/components/inventory/modals/request-use-modal";
import { UsageRequestBatchDetailModal } from "@/components/inventory/modals/usage-request-batch-detail-modal";
import type { IssueOperationalContext } from "@/components/inventory/inventory-page-utils";

import type {
  BreakdownContextOption,
  InventoryIssueRow,
  InventoryItemDetailsResponse,
  InventoryItemRow,
  InventoryLocation,
  InventoryMovementRow,
  InventorySupplier,
  InventoryUsageBatchRow,
  MaintenanceContextOption,
  MovementFormState,
  UseRequestFormState
} from "./inventory-page-types";

export function InventoryPageModals({
  issueWorkflowModalOpen,
  onCloseIssueWorkflowModal,
  selectedIssue,
  selectedIssueContext,
  issueWorkflowInitialStep,
  fixInventoryIssue,
  openItemDetail,
  openMovementDetail,
  itemDetailModalOpen,
  onCloseItemDetailModal,
  selectedItemDetails,
  selectedItemIssues,
  canManage,
  isSingleProjectScope,
  openRequestUseModal,
  onToggleItemStatus,
  manualMovementModalOpen,
  onCloseManualMovementModal,
  submitMovementForm,
  savingMovement,
  movementForm,
  setMovementForm,
  items,
  clients,
  projects,
  rigs,
  maintenanceRequests,
  suppliers,
  locations,
  movementDetailDrawerOpen,
  onCloseMovementDetailDrawer,
  selectedMovementDetails,
  canApproveMovement,
  refreshMovementDetails,
  requestUseModalOpen,
  closeRequestUseModal,
  submitUseRequest,
  requestUseBatchModalOpen,
  closeRequestUseBatchModal,
  onUsageBatchSubmitted,
  openRequestUseBatchModal,
  usageBatchDetailModalOpen,
  closeUsageBatchDetailModal,
  selectedUsageBatch,
  continueToPurchaseRequest,
  useRequestForm,
  setUseRequestForm,
  openMaintenanceRequests,
  openBreakdownReports,
  scopedProject,
  submittingUseRequest,
  useRequestError
}: {
  issueWorkflowModalOpen: boolean;
  onCloseIssueWorkflowModal: () => void;
  selectedIssue: InventoryIssueRow | null;
  selectedIssueContext: IssueOperationalContext | null;
  issueWorkflowInitialStep: 1 | 2 | 3;
  fixInventoryIssue: (issue: InventoryIssueRow) => void;
  openItemDetail: (itemId: string) => void;
  openMovementDetail: (movementId: string) => void;
  itemDetailModalOpen: boolean;
  onCloseItemDetailModal: () => void;
  selectedItemDetails: InventoryItemDetailsResponse | null;
  selectedItemIssues: InventoryIssueRow[];
  canManage: boolean;
  isSingleProjectScope: boolean;
  openRequestUseModal: () => void;
  onToggleItemStatus: (nextStatus: "ACTIVE" | "INACTIVE") => Promise<void>;
  manualMovementModalOpen: boolean;
  onCloseManualMovementModal: () => void;
  submitMovementForm: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  savingMovement: boolean;
  movementForm: MovementFormState;
  setMovementForm: (patch: Partial<MovementFormState>) => void;
  items: InventoryItemRow[];
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
  suppliers: InventorySupplier[];
  locations: InventoryLocation[];
  movementDetailDrawerOpen: boolean;
  onCloseMovementDetailDrawer: () => void;
  selectedMovementDetails: InventoryMovementRow | null;
  canApproveMovement: boolean;
  refreshMovementDetails: () => Promise<void>;
  requestUseModalOpen: boolean;
  closeRequestUseModal: () => void;
  submitUseRequest: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  requestUseBatchModalOpen: boolean;
  closeRequestUseBatchModal: () => void;
  onUsageBatchSubmitted: () => Promise<void>;
  openRequestUseBatchModal: () => void;
  usageBatchDetailModalOpen: boolean;
  closeUsageBatchDetailModal: () => void;
  selectedUsageBatch: InventoryUsageBatchRow | null;
  continueToPurchaseRequest: () => void;
  useRequestForm: UseRequestFormState;
  setUseRequestForm: Dispatch<SetStateAction<UseRequestFormState>>;
  openMaintenanceRequests: MaintenanceContextOption[];
  openBreakdownReports: BreakdownContextOption[];
  scopedProject: {
    id: string;
    name: string;
    clientId: string;
    assignedRigId: string | null;
    backupRigId: string | null;
  } | null;
  submittingUseRequest: boolean;
  useRequestError: string | null;
}) {
  return (
    <>
      <InventoryIssueWorkflowModal
        open={issueWorkflowModalOpen}
        onClose={onCloseIssueWorkflowModal}
        issue={selectedIssue}
        issueContext={selectedIssueContext}
        initialStep={issueWorkflowInitialStep}
        onFixIssue={fixInventoryIssue}
        onOpenItem={openItemDetail}
        onOpenMovement={openMovementDetail}
      />

      <ItemDetailModal
        open={itemDetailModalOpen}
        onClose={onCloseItemDetailModal}
        itemDetails={selectedItemDetails}
        issues={selectedItemIssues}
        canManage={canManage}
        isProjectLocked={isSingleProjectScope}
        onRequestUse={openRequestUseModal}
        onRequestBatch={openRequestUseBatchModal}
        onToggleStatus={onToggleItemStatus}
      />

      <InventoryManualMovementModal
        open={manualMovementModalOpen}
        onClose={onCloseManualMovementModal}
        onSubmit={submitMovementForm}
        saving={savingMovement}
        form={movementForm}
        onFormChange={setMovementForm}
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
        onClose={onCloseMovementDetailDrawer}
        movement={selectedMovementDetails}
        isProjectLocked={isSingleProjectScope}
        canApproveMovement={canApproveMovement}
        onRefresh={refreshMovementDetails}
      />

      <RequestUseModal
        open={requestUseModalOpen}
        onClose={closeRequestUseModal}
        onSubmit={submitUseRequest}
        onContinueToPurchaseRequest={continueToPurchaseRequest}
        form={useRequestForm}
        onFormChange={setUseRequestForm}
        projects={projects}
        rigs={rigs}
        lockedProject={isSingleProjectScope ? scopedProject : null}
        maintenanceRequests={openMaintenanceRequests}
        breakdownReports={openBreakdownReports}
        locations={locations}
        item={selectedItemDetails?.data || null}
        submitting={submittingUseRequest}
        errorMessage={useRequestError}
      />

      <RequestUseBatchModal
        open={requestUseBatchModalOpen}
        onClose={closeRequestUseBatchModal}
        onSubmitted={onUsageBatchSubmitted}
        projects={projects}
        rigs={rigs}
        lockedProject={isSingleProjectScope ? scopedProject : null}
        maintenanceRequests={openMaintenanceRequests}
        breakdownReports={openBreakdownReports}
        locations={locations}
        preselectedItem={selectedItemDetails?.data || null}
      />

      <UsageRequestBatchDetailModal
        open={usageBatchDetailModalOpen}
        onClose={closeUsageBatchDetailModal}
        batch={selectedUsageBatch}
        onOpenMovement={openMovementDetail}
      />
    </>
  );
}
