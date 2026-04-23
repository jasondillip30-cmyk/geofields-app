"use client";

import type { Dispatch, MutableRefObject, PointerEvent as ReactPointerEvent, SetStateAction } from "react";
import Link from "next/link";

import { ReceiptIntakeFinalizePosting } from "@/components/inventory/receipt-intake-finalize-posting";
import { ReceiptIntakeFinalizeStep } from "@/components/inventory/receipt-intake-finalize-step";
import { ReceiptIntakeReviewStep } from "@/components/inventory/receipt-intake-review-step";
import { ReceiptIntakeScanStep } from "@/components/inventory/receipt-intake-scan-step";
import { inventoryCategoryOptions, formatInventoryCategory } from "@/lib/inventory";
import type {
  ExtractState,
  IntakeAllocationStatus,
  QrCropSelection,
  ReceiptCaptureMode,
  ReceiptFollowUpStage,
  ReceiptIntakePanelProps,
  ReceiptWorkflowChoice,
  ReviewLineState,
  ReviewState
} from "@/components/inventory/receipt-intake-panel-types";

interface ReceiptIntakeGuidedStagesProps {
  finalizeSuccess: { projectName: string; totalAmount: string } | null;
  setFinalizeSuccess: Dispatch<SetStateAction<{ projectName: string; totalAmount: string } | null>>;
  resetScanSessionState: () => void;
  setFollowUpStage: Dispatch<SetStateAction<ReceiptFollowUpStage>>;
  followUpStage: ReceiptFollowUpStage;
  manualInputSelected: boolean;
  handleReceiptCaptureModeChange: (mode: ReceiptCaptureMode) => void;
  lastSavedAllocationStatus: IntakeAllocationStatus | null;
  requisitionContextLocked: boolean;
  initialRequisition: ReceiptIntakePanelProps["initialRequisition"];
  activeWorkflowChoice: ReceiptWorkflowChoice | "";
  applyWorkflowChoice: (choice: ReceiptWorkflowChoice) => void;
  receiptFile: File | null;
  extracting: boolean;
  receiptWorkflowChoice: ReceiptWorkflowChoice | "";
  extractState: ExtractState;
  handleReceiptFileChange: (file: File | null) => void;
  handleExtract: (options?: { userInitiated?: boolean }) => Promise<void>;
  canManage: boolean;
  autoSaveEnabled: boolean;
  setAutoSaveEnabled: Dispatch<SetStateAction<boolean>>;
  manualQrAssistEnabled: boolean;
  setManualQrAssistEnabled: Dispatch<SetStateAction<boolean>>;
  clearQrAssistSelection: () => void;
  canPreviewReceiptImage: boolean;
  receiptPreviewUrl: string;
  qrPreviewContainerRef: MutableRefObject<HTMLDivElement | null>;
  handleQrPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  handleQrPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  handleQrPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => void;
  qrAssistSelection: QrCropSelection | null;
  debugMode: boolean;
  setDebugMode: Dispatch<SetStateAction<boolean>>;
  review: ReviewState | null;
  mismatchDetected: boolean;
  showScannedDetails: boolean;
  setShowScannedDetails: Dispatch<SetStateAction<boolean>>;
  setReview: Dispatch<SetStateAction<ReviewState | null>>;
  inventoryActionNeeded: boolean;
  setShowMismatchInventoryHandling: Dispatch<SetStateAction<boolean>>;
  showMismatchInventoryHandling: boolean;
  unmatchedLines: ReviewState["lines"];
  showAdvancedLineItemEditor: boolean;
  items: ReceiptIntakePanelProps["items"];
  updateLine: (lineId: string, patch: Partial<ReviewLineState>) => void;
  addScannedLineItem: () => void;
  inventoryActionEditorByLine: Record<string, boolean>;
  setInventoryActionEditorByLine: Dispatch<SetStateAction<Record<string, boolean>>>;
  mismatchOverrideAccepted: boolean;
  requestMismatchOverride: () => void;
  requisitionComparison: ReturnType<typeof import("@/components/inventory/receipt-intake-comparison").evaluateRequisitionComparison>;
  showFinalizePostingOptions: boolean;
  setShowFinalizePostingOptions: Dispatch<SetStateAction<boolean>>;
  formatMoneyText: (value: string, currency: string) => string;
  suppliers: ReceiptIntakePanelProps["suppliers"];
  clients: ReceiptIntakePanelProps["clients"];
  projects: ReceiptIntakePanelProps["projects"];
  filteredProjects: ReceiptIntakePanelProps["projects"];
  rigs: ReceiptIntakePanelProps["rigs"];
  maintenanceRequests: ReceiptIntakePanelProps["maintenanceRequests"];
  locations: ReceiptIntakePanelProps["locations"];
  requiresAllocation: boolean;
  allocationPreview: IntakeAllocationStatus | null;
  showDeveloperDebugUi: boolean;
  showTechnicalDetails: boolean;
  setShowTechnicalDetails: Dispatch<SetStateAction<boolean>>;
  handleCommit: () => Promise<void>;
  saving: boolean;
  mismatchOverrideReady: boolean;
}

export function ReceiptIntakeGuidedStages({
  finalizeSuccess,
  setFinalizeSuccess,
  resetScanSessionState,
  setFollowUpStage,
  followUpStage,
  manualInputSelected,
  handleReceiptCaptureModeChange,
  lastSavedAllocationStatus,
  requisitionContextLocked,
  initialRequisition,
  activeWorkflowChoice,
  applyWorkflowChoice,
  receiptFile,
  extracting,
  receiptWorkflowChoice,
  extractState,
  handleReceiptFileChange,
  handleExtract,
  canManage,
  autoSaveEnabled,
  setAutoSaveEnabled,
  manualQrAssistEnabled,
  setManualQrAssistEnabled,
  clearQrAssistSelection,
  canPreviewReceiptImage,
  receiptPreviewUrl,
  qrPreviewContainerRef,
  handleQrPointerDown,
  handleQrPointerMove,
  handleQrPointerUp,
  qrAssistSelection,
  debugMode,
  setDebugMode,
  review,
  mismatchDetected,
  showScannedDetails,
  setShowScannedDetails,
  setReview,
  inventoryActionNeeded,
  setShowMismatchInventoryHandling,
  showMismatchInventoryHandling,
  unmatchedLines,
  showAdvancedLineItemEditor,
  items,
  updateLine,
  addScannedLineItem,
  inventoryActionEditorByLine,
  setInventoryActionEditorByLine,
  mismatchOverrideAccepted,
  requestMismatchOverride,
  requisitionComparison,
  showFinalizePostingOptions,
  setShowFinalizePostingOptions,
  formatMoneyText,
  suppliers,
  clients,
  projects,
  filteredProjects,
  rigs,
  maintenanceRequests,
  locations,
  requiresAllocation,
  allocationPreview,
  showDeveloperDebugUi,
  showTechnicalDetails,
  setShowTechnicalDetails,
  handleCommit,
  saving,
  mismatchOverrideReady
}: ReceiptIntakeGuidedStagesProps) {
  return (
    <>
      {finalizeSuccess && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-4">
          <p className="text-base font-semibold text-emerald-900">Receipt posted successfully</p>
          <div className="mt-2 grid gap-1 text-sm text-emerald-900 sm:grid-cols-2">
            <p><span className="font-medium">Project:</span> {finalizeSuccess.projectName}</p>
            <p><span className="font-medium">Total:</span> {finalizeSuccess.totalAmount}</p>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link
              href="/spending"
              className="rounded-md border border-emerald-300 bg-white px-3 py-1.5 text-sm font-medium text-emerald-900 hover:bg-emerald-100/60"
            >
              Go to cost tracking
            </Link>
            <button
              type="button"
              onClick={() => {
                setFinalizeSuccess(null);
                resetScanSessionState();
                setFollowUpStage("SCAN");
              }}
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100"
            >
              Create another receipt
            </button>
          </div>
        </div>
      )}

      {!finalizeSuccess && followUpStage === "SCAN" && (
        <ReceiptIntakeScanStep
          manualInputSelected={manualInputSelected}
          handleReceiptCaptureModeChange={handleReceiptCaptureModeChange}
          lastSavedAllocationStatus={lastSavedAllocationStatus}
          requisitionContextLocked={requisitionContextLocked}
          initialRequisition={initialRequisition}
          activeWorkflowChoice={activeWorkflowChoice}
          applyWorkflowChoice={applyWorkflowChoice}
          receiptFile={receiptFile}
          extracting={extracting}
          receiptWorkflowChoice={receiptWorkflowChoice}
          extractState={extractState}
          handleReceiptFileChange={handleReceiptFileChange}
          handleExtract={handleExtract}
          canManage={canManage}
          autoSaveEnabled={autoSaveEnabled}
          setAutoSaveEnabled={setAutoSaveEnabled}
          manualQrAssistEnabled={manualQrAssistEnabled}
          setManualQrAssistEnabled={setManualQrAssistEnabled}
          clearQrAssistSelection={clearQrAssistSelection}
          canPreviewReceiptImage={canPreviewReceiptImage}
          receiptPreviewUrl={receiptPreviewUrl}
          qrPreviewContainerRef={qrPreviewContainerRef}
          handleQrPointerDown={handleQrPointerDown}
          handleQrPointerMove={handleQrPointerMove}
          handleQrPointerUp={handleQrPointerUp}
          qrAssistSelection={qrAssistSelection}
          debugMode={debugMode}
          setDebugMode={setDebugMode}
          review={review}
          mismatchDetected={mismatchDetected}
          showScannedDetails={showScannedDetails}
          setShowScannedDetails={setShowScannedDetails}
          setReview={setReview}
          setFollowUpStage={setFollowUpStage}
          resetScanSessionState={resetScanSessionState}
        />
      )}

      {finalizeSuccess || !review ? null : (
        <div className="space-y-2.5 rounded-xl border border-slate-200/60 bg-white p-2.5">
          {followUpStage === "REVIEW" && (
            <ReceiptIntakeReviewStep
              showMismatchInventoryHandling={showMismatchInventoryHandling}
              requisitionComparison={requisitionComparison}
              showScannedDetails={showScannedDetails}
              setShowScannedDetails={setShowScannedDetails}
              inventoryActionNeeded={inventoryActionNeeded}
              setShowMismatchInventoryHandling={setShowMismatchInventoryHandling}
              unmatchedLines={unmatchedLines}
              showAdvancedLineItemEditor={showAdvancedLineItemEditor}
              review={review}
              mismatchDetected={mismatchDetected}
              items={items}
              updateLine={updateLine}
              addScannedLineItem={addScannedLineItem}
              inventoryActionEditorByLine={inventoryActionEditorByLine}
              setInventoryActionEditorByLine={setInventoryActionEditorByLine}
              inventoryCategoryOptions={inventoryCategoryOptions}
              formatInventoryCategory={formatInventoryCategory}
              mismatchOverrideAccepted={mismatchOverrideAccepted}
              requestMismatchOverride={requestMismatchOverride}
              setFollowUpStage={setFollowUpStage}
              manualInputSelected={manualInputSelected}
              setReview={setReview}
              resetScanSessionState={resetScanSessionState}
            />
          )}

          {followUpStage === "FINALIZE" && (
            <ReceiptIntakeFinalizeStep
              review={review}
              mismatchDetected={mismatchDetected}
              canInspectScannedDetails={Boolean(requisitionComparison?.canInspectScannedDetails)}
              showScannedDetails={showScannedDetails}
              setShowScannedDetails={setShowScannedDetails}
              setReview={setReview}
              addScannedLineItem={addScannedLineItem}
              mismatchOverrideAccepted={mismatchOverrideAccepted}
              requestMismatchOverride={requestMismatchOverride}
              showFinalizePostingOptions={showFinalizePostingOptions}
              setShowFinalizePostingOptions={setShowFinalizePostingOptions}
              formatMoneyText={formatMoneyText}
            />
          )}

          {followUpStage === "FINALIZE" && (
            <ReceiptIntakeFinalizePosting
              review={review}
              mismatchDetected={mismatchDetected}
              mismatchOverrideReady={mismatchOverrideReady}
              mismatchOverrideAccepted={mismatchOverrideAccepted}
              requestMismatchOverride={requestMismatchOverride}
              showFinalizePostingOptions={showFinalizePostingOptions}
              setShowFinalizePostingOptions={setShowFinalizePostingOptions}
              activeWorkflowChoice={activeWorkflowChoice}
              applyWorkflowChoice={applyWorkflowChoice}
              requisitionContextLocked={requisitionContextLocked}
              suppliers={suppliers}
              clients={clients}
              projects={projects}
              filteredProjects={filteredProjects}
              rigs={rigs}
              maintenanceRequests={maintenanceRequests}
              locations={locations}
              setReview={setReview}
              requiresAllocation={requiresAllocation}
              allocationPreview={allocationPreview}
              showDeveloperDebugUi={showDeveloperDebugUi}
              showTechnicalDetails={showTechnicalDetails}
              setShowTechnicalDetails={setShowTechnicalDetails}
              debugMode={debugMode}
              showMismatchInventoryHandling={showMismatchInventoryHandling}
              setFollowUpStage={setFollowUpStage}
              handleCommit={handleCommit}
              saving={saving}
              canManage={canManage}
              resetScanSessionState={resetScanSessionState}
            />
          )}
        </div>
      )}
    </>
  );
}
