"use client";
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Card } from "@/components/ui/card";
import { type FocusedLinkedRecord } from "@/components/inventory/receipt-intake-panel-fields";
import { buildEmptyScanDiagnostics } from "@/components/inventory/receipt-intake-diagnostics-utils";
import { applyWorkflowSelectionUpdate, formatReceiptPurposeLabel, mapRequisitionTypeToReceiptClassification, mapRequisitionTypeToWorkflowChoice, resolveCreateExpenseForPurpose, resolveWorkflowChoiceFromReview, resolveWorkflowSelectionConfig } from "@/components/inventory/receipt-intake-workflow-utils";
import { calmMessage, evaluateAutoSaveEligibility, evaluateSaveReadiness, markFrontendMappingGap, readApiError, readJsonPayload, readPayloadMessage, resolveScanFailureNotice } from "@/components/inventory/receipt-intake-save-readiness";
import { asString, buildManualAssistReview, buildReviewStateFromPayload, buildReviewStateFromSubmission, deriveAllocationStatus, extractReceiptPurposeFromDetails, formatDateTimeText, formatMoneyText, hasMeaningfulExtractedPayload, hasMeaningfulReviewData, isReceiptCommitSuccessPayload, isReceiptExtractSuccessPayload, isDuplicateCommitPayload, normalizeAllocationStatus, readDuplicateReviewPayload } from "@/components/inventory/receipt-intake-review-state";
import { buildRequisitionMismatchReview, evaluateRequisitionComparison } from "@/components/inventory/receipt-intake-comparison";
import { ReceiptIntakePanelContent } from "@/components/inventory/receipt-intake-panel-content";
import { applyReviewLinePatch, createManualSeededReview, fetchFocusedRecordPayload, handleReceiptCaptureModeSwitch, handleQrPointerDownSelection, handleQrPointerMoveSelection, handleQrPointerUpSelection, handleReceiptFileSelection, resetFocusedRecordOverlayState, resetScanSessionStateValues } from "@/components/inventory/receipt-intake-panel-actions";
import { RECEIPT_INTAKE_DEBUG_ENABLED, SCAN_FALLBACK_MESSAGE, type DuplicatePromptState, type ExtractState, type FocusedRecordPayload, type IntakeAllocationStatus, type NoticeTone, type QrCropSelection, type ReceiptClassification, type ReceiptCaptureMode, type ReceiptFollowUpStage, type ReceiptIntakePanelProps, type ReceiptWorkflowChoice, type ReviewLineState, type ScanDiagnosticsState, type ReviewState } from "@/components/inventory/receipt-intake-panel-types";
import { formatCurrency } from "@/lib/utils";
export type { ExpenseOnlyCategory, FieldConfidence, QrDecodeStatus, QrLookupStatus, QrParseStatus, ReadabilityConfidence, ReceiptClassification, ReceiptFollowUpStage, ReceiptIntakePanelProps, ReceiptSnapshotLine, ReceiptWorkflowChoice, RequisitionComparisonResult, ReviewLineState, ReviewState, SaveReadiness, ScanDiagnosticsState, ScanFailureStage, IntakeAllocationStatus, DuplicatePromptState, QrCropSelection, ExtractState, ReceiptPurpose } from "@/components/inventory/receipt-intake-panel-types";
export function ReceiptIntakePanel({
  canManage,
  items,
  suppliers,
  locations,
  maintenanceRequests,
  clients,
  projects,
  rigs,
  defaultClientId = "all",
  defaultRigId = "all",
  initialRequisition = null,
  activeSubmission = null,
  preferredInputMethod = "SCAN",
  renderCard = true,
  onFollowUpStageChange,
  onGuidedStepChange,
  onCompleted
}: ReceiptIntakePanelProps) {
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [receiptPreviewUrl, setReceiptPreviewUrl] = useState("");
  const [extractState, setExtractState] = useState<ExtractState>("IDLE");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [noticeTone, setNoticeTone] = useState<NoticeTone>("SUCCESS");
  const [actionToast, setActionToast] = useState<{
    tone: "SUCCESS" | "WARNING" | "ERROR";
    message: string;
    actionLabel: string;
  } | null>(null);
  const [review, setReview] = useState<ReviewState | null>(null);
  const [activeSubmissionId, setActiveSubmissionId] = useState<string | null>(null);
  const [duplicatePrompt, setDuplicatePrompt] = useState<DuplicatePromptState | null>(null);
  const [showDuplicateReview, setShowDuplicateReview] = useState(false);
  const [focusedRecordPayload, setFocusedRecordPayload] = useState<FocusedRecordPayload | null>(null);
  const [focusedRecordLoading, setFocusedRecordLoading] = useState(false);
  const [focusedRecordError, setFocusedRecordError] = useState<string | null>(null);
  const focusedOverlayOpen = Boolean(focusedRecordLoading || focusedRecordError || focusedRecordPayload);
  const [focusedOverlayMounted, setFocusedOverlayMounted] = useState(focusedOverlayOpen);
  const [focusedOverlayVisible, setFocusedOverlayVisible] = useState(focusedOverlayOpen);
  const [lastSavedAllocationStatus, setLastSavedAllocationStatus] = useState<IntakeAllocationStatus | null>(null);
  const [debugMode, setDebugMode] = useState(false);
  const [autoSaveEnabled, setAutoSaveEnabled] = useState(false);
  const [showTechnicalDetails, setShowTechnicalDetails] = useState(false);
  const [inventoryActionEditorByLine, setInventoryActionEditorByLine] = useState<Record<string, boolean>>({});
  const [showMismatchInventoryHandling, setShowMismatchInventoryHandling] = useState(false);
  const [receiptClassification, setReceiptClassification] = useState<ReceiptClassification | "">("");
  const [receiptWorkflowChoice, setReceiptWorkflowChoice] = useState<ReceiptWorkflowChoice | "">("");
  const [duplicateOverrideConfirmed, setDuplicateOverrideConfirmed] = useState(false);
  const [manualQrAssistEnabled, setManualQrAssistEnabled] = useState(false);
  const [qrAssistSelection, setQrAssistSelection] = useState<QrCropSelection | null>(null);
  const [drawingQrSelection, setDrawingQrSelection] = useState(false);
  const [followUpStage, setFollowUpStage] = useState<ReceiptFollowUpStage>("SCAN");
  const [receiptCaptureMode, setReceiptCaptureMode] = useState<ReceiptCaptureMode>(
    preferredInputMethod === "MANUAL" ? "MANUAL" : "SCAN"
  );
  const [showMismatchFinalizeConfirm, setShowMismatchFinalizeConfirm] = useState(false);
  const [showScannedDetails, setShowScannedDetails] = useState(false);
  const [showFinalizePostingOptions, setShowFinalizePostingOptions] = useState(false);
  const [finalizeSuccess, setFinalizeSuccess] = useState<{
    projectName: string;
    totalAmount: string;
  } | null>(null);
  const [lastScanDiagnostics, setLastScanDiagnostics] = useState<ScanDiagnosticsState | null>(null);
  const [hasScanAttempted, setHasScanAttempted] = useState(false);
  const showDeveloperDebugUi = process.env.NEXT_PUBLIC_RECEIPT_INTAKE_DEBUG_UI === "1";
  const panelRenderTimestamp = new Date().toISOString();
  if (RECEIPT_INTAKE_DEBUG_ENABLED) {
    console.info("RECEIPT INTAKE PANEL RENDERED", {
      component: "ReceiptIntakePanel",
      pagePath: "/purchasing/receipt-follow-up",
      timestamp: panelRenderTimestamp,
      version: "receipt-follow-up-debug-v1"
    });
  }
  const qrPreviewContainerRef = useRef<HTMLDivElement | null>(null);
  const qrSelectionStartRef = useRef<{ x: number; y: number } | null>(null);
  const clearQrAssistSelection = useCallback(() => {
    setQrAssistSelection(null);
    setDrawingQrSelection(false);
    qrSelectionStartRef.current = null;
  }, []);
  const extracting = extractState === "UPLOADING" || extractState === "PROCESSING";
  const canPreviewReceiptImage = Boolean(
    receiptPreviewUrl && receiptFile?.type.toLowerCase().startsWith("image/")
  );
  const manualInputSelected = receiptCaptureMode === "MANUAL";
  const requisitionLocked = Boolean(initialRequisition);
  const requisitionClassification = useMemo(
    () =>
      initialRequisition
        ? mapRequisitionTypeToReceiptClassification(initialRequisition.type)
        : null,
    [initialRequisition]
  );
  useEffect(() => {
    let timeoutId: number | undefined;
    if (focusedOverlayOpen) {
      setFocusedOverlayMounted(true);
      timeoutId = window.setTimeout(() => setFocusedOverlayVisible(true), 12);
    } else if (focusedOverlayMounted) {
      setFocusedOverlayVisible(false);
      timeoutId = window.setTimeout(() => setFocusedOverlayMounted(false), 180);
    }
    return () => {
      if (timeoutId !== undefined) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [focusedOverlayMounted, focusedOverlayOpen]);
  useEffect(() => {
    return () => {
      if (receiptPreviewUrl) {
        URL.revokeObjectURL(receiptPreviewUrl);
      }
    };
  }, [receiptPreviewUrl]);
  useEffect(() => {
    if (!initialRequisition || review || activeSubmission) {
      return;
    }
    if (requisitionClassification && receiptClassification !== requisitionClassification) {
      setReceiptClassification(requisitionClassification);
      setReceiptWorkflowChoice(mapRequisitionTypeToWorkflowChoice(initialRequisition.type));
    }
  }, [
    activeSubmission,
    initialRequisition,
    receiptClassification,
    requisitionClassification,
    review
  ]);
  useEffect(() => {
    if (preferredInputMethod === "MANUAL") {
      setReceiptCaptureMode("MANUAL");
      return;
    }
    if (preferredInputMethod === "SCAN") {
      setReceiptCaptureMode("SCAN");
    }
  }, [preferredInputMethod]);
  useEffect(() => {
    if (!manualInputSelected || review || activeSubmission) {
      return;
    }
    if (!receiptWorkflowChoice && !initialRequisition) {
      return;
    }
    const workflowChoice = initialRequisition
      ? mapRequisitionTypeToWorkflowChoice(initialRequisition.type)
      : receiptWorkflowChoice;
    if (!workflowChoice) {
      return;
    }
    const seededReview = createManualSeededReview({
      payload: {},
      receiptFileName: "",
      defaultClientId,
      defaultRigId,
      warning: "Manual entry selected. Complete receipt details directly and finalize when ready.",
      fallbackMode: "MANUAL_ENTRY",
      receiptClassification:
        receiptClassification ||
        (initialRequisition
          ? mapRequisitionTypeToReceiptClassification(initialRequisition.type)
          : resolveWorkflowSelectionConfig(workflowChoice).classification),
      receiptWorkflowChoice: workflowChoice,
      initialRequisition
    });
    setReview(seededReview);
    setFinalizeSuccess(null);
    setNoticeTone("WARNING");
    setNotice("Manual receipt mode started. Fill details directly, then finalize posting.");
    setError(null);
    setFollowUpStage("SCAN");
  }, [
    activeSubmission,
    defaultClientId,
    defaultRigId,
    initialRequisition,
    manualInputSelected,
    receiptClassification,
    receiptWorkflowChoice,
    review
  ]);
  useEffect(() => {
    if (!activeSubmission) {
      setActiveSubmissionId(null);
      return;
    }
    if (activeSubmission.status === "APPROVED") {
      setNoticeTone("WARNING");
      setNotice("This submission is already finalized.");
      setActiveSubmissionId(null);
      return;
    }
    const hydrated = buildReviewStateFromSubmission({
      submission: activeSubmission,
      defaultClientId,
      defaultRigId,
      initialRequisition
    });
    setReview(hydrated);
    setFinalizeSuccess(null);
    setReceiptClassification(hydrated.receiptClassification);
    setReceiptWorkflowChoice(resolveWorkflowChoiceFromReview(hydrated));
    setActiveSubmissionId(activeSubmission.id);
    setNoticeTone("WARNING");
    setNotice(
      `Loaded submission ${activeSubmission.id.slice(-8)} for manager review. Edit if needed, then finalize posting.`
    );
    setError(null);
    setDuplicatePrompt(null);
    setShowDuplicateReview(false);
    setFollowUpStage("REVIEW");
  }, [activeSubmission, defaultClientId, defaultRigId, initialRequisition]);
  useEffect(() => {
    if (!notice) {
      return;
    }
    setActionToast({
      tone: noticeTone,
      message: notice,
      actionLabel: noticeTone === "SUCCESS" ? "Receipt action completed" : "Receipt action needs review"
    });
  }, [notice, noticeTone]);
  useEffect(() => {
    if (!error) {
      return;
    }
    setActionToast({
      tone: "ERROR",
      message: error,
      actionLabel: "Receipt action blocked"
    });
  }, [error]);
  useEffect(() => {
    if (!actionToast) {
      return;
    }
    const timeout = window.setTimeout(() => {
      setActionToast(null);
    }, 4200);
    return () => window.clearTimeout(timeout);
  }, [actionToast]);
  useEffect(() => {
    if (!notice && !error) {
      return;
    }
    const timeout = window.setTimeout(() => {
      setNotice(null);
      setError(null);
    }, 8500);
    return () => window.clearTimeout(timeout);
  }, [notice, error]);
  const filteredProjects = useMemo(() => {
    if (!review?.clientId || review.clientId === "all") {
      return projects;
    }
    return projects.filter((project) => project.clientId === review.clientId);
  }, [projects, review?.clientId]);
  const unmatchedLines = useMemo(() => {
    if (!review) {
      return [];
    }
    return review.lines.filter((line) => line.mode !== "EXPENSE_ONLY" && !line.selectedItemId);
  }, [review]);
  const allocationPreview = useMemo(() => {
    if (!review) {
      return null;
    }
    return deriveAllocationStatus(review.clientId, review.projectId);
  }, [review]);
  const requisitionComparison = useMemo(
    () => evaluateRequisitionComparison(review, initialRequisition),
    [initialRequisition, review]
  );
  const activeWorkflowChoice = useMemo<ReceiptWorkflowChoice | "">(() => {
    if (review) {
      return resolveWorkflowChoiceFromReview(review);
    }
    return receiptWorkflowChoice;
  }, [receiptWorkflowChoice, review]);
  const requisitionContextLocked = requisitionLocked && Boolean(initialRequisition);
  const requiresAllocation = useMemo(() => {
    return activeWorkflowChoice === "PROJECT_PURCHASE" || activeWorkflowChoice === "MAINTENANCE_PURCHASE";
  }, [activeWorkflowChoice]);
  useEffect(() => {
    if (!review) {
      setFollowUpStage("SCAN");
      return;
    }
    setFollowUpStage((current) => (current === "FINALIZE" || current === "REVIEW" ? current : "SCAN"));
  }, [manualInputSelected, review]);
  useEffect(() => {
    setShowScannedDetails(false);
  }, [review?.receiptFileName, review?.requisitionId, review?.scanFallbackMode]);
  useEffect(() => {
    onFollowUpStageChange?.(followUpStage);
  }, [followUpStage, onFollowUpStageChange]);
  useEffect(() => {
    if (followUpStage !== "FINALIZE") {
      setShowFinalizePostingOptions(false);
    }
  }, [followUpStage]);
  function applyWorkflowChoice(choice: ReceiptWorkflowChoice) {
    const workflowConfig = resolveWorkflowSelectionConfig(choice);
    setReceiptWorkflowChoice(choice);
    setReceiptClassification(workflowConfig.classification);
    setReview((current) =>
      current ? applyWorkflowSelectionUpdate(current, workflowConfig) : current
    );
  }
  function handleReceiptCaptureModeChange(mode: ReceiptCaptureMode) {
    handleReceiptCaptureModeSwitch({
      mode,
      setReceiptCaptureMode,
      review,
      activeSubmission,
      initialRequisition,
      receiptWorkflowChoice,
      receiptClassification,
      defaultClientId,
      defaultRigId,
      setReview,
      setFinalizeSuccess,
      setNoticeTone,
      setNotice,
      setError,
      setFollowUpStage
    });
  }
  function closeFocusedRecordOverlay() {
    resetFocusedRecordOverlayState({
      setFocusedRecordPayload,
      setFocusedRecordError,
      setFocusedRecordLoading
    });
  }
  function resetScanSessionState() {
    resetScanSessionStateValues({
      setHasScanAttempted,
      setLastScanDiagnostics,
      setExtractState,
      setInventoryActionEditorByLine,
      setShowMismatchInventoryHandling,
      setShowFinalizePostingOptions,
      setShowTechnicalDetails,
      setShowMismatchFinalizeConfirm,
      setShowScannedDetails
    });
  }
  function handleReceiptFileChange(file: File | null) {
    handleReceiptFileSelection({
      file,
      receiptPreviewUrl,
      setReceiptFile,
      setReceiptPreviewUrl,
      setFinalizeSuccess,
      resetScanSessionState,
      setError,
      setNotice,
      setNoticeTone,
      setDuplicatePrompt,
      setShowDuplicateReview,
      setDuplicateOverrideConfirmed,
      setFocusedRecordPayload,
      setFocusedRecordError,
      setLastSavedAllocationStatus,
      setQrAssistSelection,
      setDrawingQrSelection,
      qrSelectionStartRef,
      hasReview: Boolean(review),
      setFollowUpStage
    });
  }
  function handleQrPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    handleQrPointerDownSelection({
      event,
      manualQrAssistEnabled,
      canPreviewReceiptImage,
      container: qrPreviewContainerRef.current,
      setDrawingQrSelection,
      setQrAssistSelection,
      qrSelectionStartRef
    });
  }
  function handleQrPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    handleQrPointerMoveSelection({
      event,
      drawingQrSelection,
      manualQrAssistEnabled,
      container: qrPreviewContainerRef.current,
      qrSelectionStartRef,
      setQrAssistSelection
    });
  }
  function handleQrPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    handleQrPointerUpSelection({
      event,
      drawingQrSelection,
      container: qrPreviewContainerRef.current,
      qrSelectionStartRef,
      setQrAssistSelection,
      setDrawingQrSelection
    });
  }
  async function handleExtract(options?: { userInitiated?: boolean }) {
    if (!options?.userInitiated) {
      return;
    }
    if (!receiptFile) {
      setError("Please choose a receipt image or PDF first.");
      setExtractState("FAILED");
      return;
    }
    if (!receiptWorkflowChoice) {
      setError("Select a receipt workflow type before scanning.");
      setExtractState("FAILED");
      return;
    }
    const selectedWorkflowConfig = resolveWorkflowSelectionConfig(receiptWorkflowChoice);
    setHasScanAttempted(true);
    setFinalizeSuccess(null);
    setShowScannedDetails(false);
    setExtractState("UPLOADING");
    setError(null);
    setNotice(null);
    setNoticeTone("SUCCESS");
    setDuplicatePrompt(null);
    setShowDuplicateReview(false);
    setDuplicateOverrideConfirmed(false);
    setFocusedRecordPayload(null);
    setFocusedRecordError(null);
    setLastSavedAllocationStatus(null);
    setInventoryActionEditorByLine({});
    setShowMismatchInventoryHandling(false);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 45000);
    try {
      const formData = new FormData();
      formData.set("receipt", receiptFile);
      if (debugMode) {
        formData.set("debug", "1");
      }
      if (manualQrAssistEnabled && qrAssistSelection) {
        formData.set("qrCrop", JSON.stringify(qrAssistSelection));
      }
      const response = await fetch("/api/inventory/receipt-intake/extract", {
        method: "POST",
        body: formData,
        signal: controller.signal
      });
      setExtractState("PROCESSING");
      const payload = await readJsonPayload(response);
      if (response.ok && isReceiptExtractSuccessPayload(payload)) {
        const nextReview = buildReviewStateFromPayload({
          payload,
          receiptFileName: receiptFile.name,
          defaultClientId,
          defaultRigId,
          receiptClassification: selectedWorkflowConfig.classification,
          receiptWorkflowChoice,
          initialRequisition
        });
        const extractedHasUsableData = hasMeaningfulExtractedPayload(payload.extracted);
        const mappedReviewHasUsableData = hasMeaningfulReviewData(nextReview);
        const qrDecodeSucceeded =
          nextReview.scanDiagnostics.qrDecodeStatus === "DECODED" ||
          nextReview.scanDiagnostics.qrParseStatus === "PARSED" ||
          nextReview.scanDiagnostics.qrLookupStatus === "SUCCESS";
        const shouldFallbackToManual = (!extractedHasUsableData || !mappedReviewHasUsableData) && !qrDecodeSucceeded;
        if (shouldFallbackToManual) {
          const fallbackReview = buildManualAssistReview({
            payload,
            receiptFileName: receiptFile.name,
            defaultClientId,
            defaultRigId,
            warning: SCAN_FALLBACK_MESSAGE,
            fallbackMode: "SCAN_FAILURE",
            receiptClassification: selectedWorkflowConfig.classification,
            receiptWorkflowChoice,
            initialRequisition
          });
          setReview(fallbackReview);
          setLastScanDiagnostics(fallbackReview.scanDiagnostics);
          setNoticeTone("WARNING");
          setNotice(resolveScanFailureNotice(fallbackReview));
          setError(null);
          setExtractState("FAILED");
          setFollowUpStage("SCAN");
          return;
        }
        const effectiveReview = !mappedReviewHasUsableData && qrDecodeSucceeded
          ? markFrontendMappingGap(nextReview)
          : nextReview;
        const requisitionComparison = evaluateRequisitionComparison(effectiveReview, initialRequisition);
        if (requisitionComparison?.status === "MISMATCH") {
          const mismatchReview = buildRequisitionMismatchReview({
            scannedReview: effectiveReview,
            initialRequisition
          });
          setReview(mismatchReview);
          setLastScanDiagnostics(mismatchReview.scanDiagnostics);
          setNoticeTone("WARNING");
          setNotice(null);
          setError(null);
          setExtractState("SUCCESS");
          setFollowUpStage("SCAN");
          return;
        }
        setReview(effectiveReview);
        setLastScanDiagnostics(effectiveReview.scanDiagnostics);
        const intakeMessage = calmMessage(
          payload.message ||
            (effectiveReview.scanStatus === "COMPLETE"
              ? "Captured from QR/TRA. Review and save."
              : "Some fields still need review.")
        );
        const autoSaveReadiness = evaluateAutoSaveEligibility(effectiveReview);
        if (canManage && autoSaveEnabled && autoSaveReadiness.ready) {
          setNoticeTone("SUCCESS");
          setNotice("Captured from QR/TRA. Finalizing automatically...");
        } else if (canManage && autoSaveEnabled && !autoSaveReadiness.ready) {
          setNoticeTone("WARNING");
          setNotice(
            `Review recommended before save. ${autoSaveReadiness.reasons[0] || "Some optional fields need confirmation."}`
          );
        } else {
          setNoticeTone(effectiveReview.scanStatus === "COMPLETE" ? "SUCCESS" : "WARNING");
          setNotice(
            effectiveReview.scanDiagnostics.failureStage === "FRONTEND_MAPPING_EMPTY"
              ? `${intakeMessage} Scan details were captured but field mapping needs manual review.`
              : intakeMessage
          );
        }
        setExtractState("SUCCESS");
        setFollowUpStage("SCAN");
        if (canManage && autoSaveEnabled && autoSaveReadiness.ready) {
          await commitReview(effectiveReview, { auto: true });
        }
        return;
      }
      const fallbackReview = buildManualAssistReview({
        payload,
        receiptFileName: receiptFile.name,
        defaultClientId,
        defaultRigId,
        warning:
          response.ok
            ? readPayloadMessage(payload, SCAN_FALLBACK_MESSAGE)
            : readApiError(response, payload, SCAN_FALLBACK_MESSAGE),
        fallbackMode: "SCAN_FAILURE",
        receiptClassification: selectedWorkflowConfig.classification,
        receiptWorkflowChoice,
        initialRequisition
      });
      setReview(fallbackReview);
      setLastScanDiagnostics(fallbackReview.scanDiagnostics);
      setNoticeTone("WARNING");
      setNotice(resolveScanFailureNotice(fallbackReview));
      setError(null);
      setExtractState("FAILED");
      setFollowUpStage("SCAN");
    } catch (scanError) {
      const timeoutMessage =
        scanError instanceof DOMException && scanError.name === "AbortError"
          ? "Capture is taking longer than expected. You can retry or continue manually."
          : null;
      const fallbackReview = buildManualAssistReview({
        payload: null,
        receiptFileName: receiptFile.name,
        defaultClientId,
        defaultRigId,
        warning:
          timeoutMessage ||
          (scanError instanceof Error && scanError.message
            ? scanError.message
            : SCAN_FALLBACK_MESSAGE),
        fallbackMode: "SCAN_FAILURE",
        receiptClassification: selectedWorkflowConfig.classification,
        receiptWorkflowChoice,
        initialRequisition
      });
      setReview(fallbackReview);
      setLastScanDiagnostics(fallbackReview.scanDiagnostics);
      setNoticeTone("WARNING");
      setNotice(resolveScanFailureNotice(fallbackReview));
      setError(null);
      setExtractState("FAILED");
      setFollowUpStage("SCAN");
    } finally {
      clearTimeout(timeoutId);
      setExtractState((current) =>
        current === "UPLOADING" || current === "PROCESSING" ? "FAILED" : current
      );
    }
  }
  async function handleCommit() {
    if (!review) {
      return;
    }
    await commitReview(review, { auto: false });
  }
  async function commitReview(
    nextReview: ReviewState,
    options: { auto: boolean; allowDuplicateSave?: boolean }
  ) {
    const readiness = evaluateSaveReadiness(nextReview);
    if (!readiness.ready) {
      setError(readiness.reasons[0] || "Complete required receipt context before saving.");
      return;
    }
    if (options.auto) {
      const autoReadiness = evaluateAutoSaveEligibility(nextReview);
      if (!autoReadiness.ready) {
        setNoticeTone("WARNING");
        setNotice(`Review recommended before save. ${autoReadiness.reasons[0] || "Some fields still need review."}`);
        return;
      }
    }
    if (nextReview.lines.length === 0 && !resolveCreateExpenseForPurpose(nextReview)) {
      setError("No line items were extracted. Add a line item or enable expense evidence before saving.");
      return;
    }
    if (nextReview.receiptPurpose === "OTHER_MANUAL") {
      setError("Select a final receipt purpose before saving.");
      return;
    }
    const effectiveCreateExpense = resolveCreateExpenseForPurpose(nextReview);
    const effectiveLines =
      nextReview.receiptClassification === "EXPENSE_ONLY" ||
      nextReview.receiptPurpose === "BUSINESS_EXPENSE_ONLY" ||
      nextReview.receiptPurpose === "EVIDENCE_ONLY"
        ? nextReview.lines.map((line) => ({
            ...line,
            mode: "EXPENSE_ONLY" as const,
            selectedItemId: ""
          }))
        : nextReview.lines;
    setSaving(true);
    setError(null);
    setNotice(null);
    setNoticeTone("SUCCESS");
    setDuplicatePrompt(null);
    setShowDuplicateReview(false);
    setDuplicateOverrideConfirmed(false);
    try {
      const response = await fetch("/api/inventory/receipt-intake/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requisitionId: nextReview.requisitionId || null,
          submissionId: activeSubmissionId,
          receipt: {
            url: nextReview.receiptUrl,
            fileName: nextReview.receiptFileName,
            supplierId: nextReview.supplierId || null,
            supplierName: nextReview.supplierName,
            tin: nextReview.tin,
            vrn: nextReview.vrn,
            serialNumber: nextReview.serialNumber,
            receiptNumber: nextReview.receiptNumber,
            verificationCode: nextReview.verificationCode,
            verificationUrl: nextReview.verificationUrl,
            rawQrValue: nextReview.rawQrValue,
            receiptDate: nextReview.receiptDate,
            receiptTime: nextReview.receiptTime,
            traReceiptNumber: nextReview.traReceiptNumber,
            invoiceReference: nextReview.invoiceReference,
            paymentMethod: nextReview.paymentMethod,
            taxOffice: nextReview.taxOffice,
            ocrTextPreview: nextReview.rawTextPreview,
            currency: nextReview.currency,
            subtotal: Number(nextReview.subtotal || 0),
            tax: Number(nextReview.tax || 0),
            total: Number(nextReview.total || 0)
          },
          linkContext: {
            clientId: nextReview.clientId || null,
            projectId: nextReview.projectId || null,
            rigId: nextReview.rigId || null,
            maintenanceRequestId: nextReview.maintenanceRequestId || null,
            locationFromId: nextReview.locationFromId || null,
            locationToId: nextReview.locationToId || null
          },
          allowDuplicateSave: Boolean(options.allowDuplicateSave),
          workflowType: resolveWorkflowChoiceFromReview(nextReview),
          receiptType: nextReview.receiptClassification,
          expenseOnlyCategory: nextReview.expenseOnlyCategory || null,
          receiptPurpose: nextReview.receiptPurpose,
          createExpense: effectiveCreateExpense,
          lines: effectiveLines.map((line) => {
            const effectiveMode: "MATCH" | "NEW" | "EXPENSE_ONLY" =
              line.mode === "MATCH" && !line.selectedItemId ? "NEW" : line.mode;
            return {
              id: line.id,
              description: line.description,
              quantity: Number(line.quantity || 0),
              unitPrice: Number(line.unitPrice || 0),
              lineTotal: Number(line.lineTotal || 0),
              selectedItemId: effectiveMode === "MATCH" ? line.selectedItemId || null : null,
              selectedCategory: line.selectedCategory,
              mode: effectiveMode,
              newItem:
                effectiveMode === "NEW"
                  ? {
                      name: line.newItemName || line.description,
                      sku: line.newItemSku || "",
                      category: line.selectedCategory,
                      minimumStockLevel: Number(line.newItemMinimumStockLevel || 0),
                      locationId: nextReview.locationToId || null,
                      status: "ACTIVE"
                    }
                  : undefined
            };
          })
        })
      });
      const payload = await readJsonPayload(response);
      if ((response.status === 409 || response.status === 403) && isDuplicateCommitPayload(payload)) {
        const duplicatePayload = payload.duplicate;
        const duplicateMessage =
          typeof payload.message === "string" && payload.message.trim().length > 0
            ? payload.message
            : "This receipt appears to have already been processed. Review the earlier receipt and its linked records before saving again.";
        setDuplicatePrompt({
          message: duplicateMessage,
          matches: duplicatePayload.matches,
          review: readDuplicateReviewPayload(duplicatePayload.review),
          reviewSnapshot: nextReview,
          auto: options.auto
        });
        setDuplicateOverrideConfirmed(false);
        setShowDuplicateReview(true);
        setNoticeTone("WARNING");
        setNotice(duplicateMessage);
        setLastSavedAllocationStatus(null);
        return;
      }
      if (!response.ok) {
        throw new Error(readApiError(response, payload, "Failed to save stock intake."));
      }
      if (!isReceiptCommitSuccessPayload(payload)) {
        throw new Error("Failed to save stock intake. Please review your inputs and try again.");
      }
      const submissionStatus = asString(payload?.data?.submissionStatus);
      const submissionReference = asString(payload?.data?.submissionId);
      const projectName =
        projects.find((project) => project.id === nextReview.projectId)?.name || "No linked project";
      const totalAmount = formatMoneyText(nextReview.total, nextReview.currency);
      if (submissionStatus === "PENDING_REVIEW") {
        setNoticeTone("SUCCESS");
        setNotice(
          submissionReference
            ? `Submitted for review (${submissionReference.slice(-8)}). A manager/admin will verify and finalize posting.`
            : "Submitted for review. A manager/admin will verify and finalize posting."
        );
        setLastSavedAllocationStatus(normalizeAllocationStatus(payload?.data?.allocationStatus));
        setFinalizeSuccess({
          projectName,
          totalAmount
        });
        setReview(null);
        setActiveSubmissionId(null);
        setReceiptFile(null);
        if (receiptPreviewUrl) {
          URL.revokeObjectURL(receiptPreviewUrl);
        }
        setReceiptPreviewUrl("");
        setQrAssistSelection(null);
        setDrawingQrSelection(false);
        qrSelectionStartRef.current = null;
        resetScanSessionState();
        setFollowUpStage("SCAN");
        await onCompleted();
        return;
      }
      const totalValue = Number(payload?.data?.totals?.total || 0);
      const movementCount = Number(payload?.data?.movementCount || 0);
      const itemsCreatedCount = Number(payload?.data?.itemsCreatedCount || 0);
      const evidenceOnlyLinesCount = Number(payload?.data?.evidenceOnlyLinesCount || 0);
      const allocationStatus = normalizeAllocationStatus(payload?.data?.allocationStatus);
      const allocationMessage =
        typeof payload?.data?.allocationMessage === "string" ? payload.data.allocationMessage : "";
      const outcomeReasons = Array.isArray(payload?.data?.outcomeReasons)
        ? payload.data.outcomeReasons.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
        : [];
      if (RECEIPT_INTAKE_DEBUG_ENABLED) {
        console.info("[inventory][receipt-intake][frontend-save-outcome]", {
          receiptSaved: true,
          itemsCreatedCount,
          stockMovementsCreated: movementCount,
          evidenceOnlyLinesCount,
          outcomeReasons
        });
      }
      if (movementCount === 0) {
        setNoticeTone("WARNING");
        setNotice(
          outcomeReasons[0] ||
            "Receipt saved as evidence only. No stock-in movement was created because all lines were set to evidence-only or skipped."
        );
      } else {
        if (allocationStatus === "UNALLOCATED") {
          setNoticeTone("WARNING");
          setNotice(
            `${allocationMessage || "Saved with missing project/client context"} ${movementCount} stock-in movement(s) created (${formatCurrency(totalValue)}). You can complete linkage later.`
          );
        } else if (allocationStatus === "PARTIALLY_ALLOCATED") {
          setNoticeTone("WARNING");
          setNotice(
            `${allocationMessage || "Saved with partial project/client context"} ${movementCount} stock-in movement(s) created (${formatCurrency(totalValue)}).`
          );
        } else {
          setNoticeTone("SUCCESS");
          setNotice(
            options.auto
              ? `Saved automatically. ${movementCount} stock-in movement(s) created (${formatCurrency(totalValue)}).`
              : `Saved to inventory. ${movementCount} stock-in movement(s) created (${formatCurrency(totalValue)}).`
          );
        }
      }
      setLastSavedAllocationStatus(allocationStatus);
      setFinalizeSuccess({
        projectName,
        totalAmount
      });
      setReview(null);
      setActiveSubmissionId(null);
      setReceiptFile(null);
      if (receiptPreviewUrl) {
        URL.revokeObjectURL(receiptPreviewUrl);
      }
      setReceiptPreviewUrl("");
      setQrAssistSelection(null);
      setDrawingQrSelection(false);
      qrSelectionStartRef.current = null;
      resetScanSessionState();
      setFollowUpStage("SCAN");
      await onCompleted();
    } catch (commitError) {
      setError(commitError instanceof Error ? commitError.message : "Could not finalize intake. Please review and try again.");
    } finally {
      setSaving(false);
    }
  }
  function updateLine(lineId: string, patch: Partial<ReviewLineState>) {
    setReview((current) => {
      if (!current) {
        return current;
      }
      return applyReviewLinePatch(current, lineId, patch);
    });
  }
  async function openFocusedRecord(record: FocusedLinkedRecord) {
    setFocusedRecordLoading(true);
    setFocusedRecordError(null);
    setFocusedRecordPayload(null);
    try {
      const payload = await fetchFocusedRecordPayload(record);
      setFocusedRecordPayload(payload);
    } catch (recordError) {
      setFocusedRecordError(
        recordError instanceof Error ? recordError.message : "Failed to load record details."
      );
    } finally {
      setFocusedRecordLoading(false);
    }
  }
  const duplicateConfidence = duplicatePrompt?.review?.summary.duplicateConfidence || "LOW";
  const duplicateIsHighConfidence = duplicateConfidence === "HIGH";
  const canOverrideDuplicate = duplicateOverrideConfirmed && (!duplicateIsHighConfidence || canManage);
  const activeScanDiagnostics = review?.scanDiagnostics || lastScanDiagnostics;
  const visibleScanDiagnostics =
    hasScanAttempted || Boolean(activeScanDiagnostics)
      ? activeScanDiagnostics || buildEmptyScanDiagnostics()
      : null;
  const mismatchDetected = requisitionComparison?.status === "MISMATCH";
  const inventoryActionNeeded = useMemo(() => {
    if (!review) {
      return false;
    }
    return review.lines.some(
      (line) =>
        line.mode === "NEW" ||
        (line.mode === "MATCH" && !line.selectedItemId.trim())
    );
  }, [review]);
  const showAdvancedLineItemEditor = followUpStage === "REVIEW" && showMismatchInventoryHandling;
  const guidedStep = useMemo<1 | 2 | 3 | 4>(() => {
    if (finalizeSuccess) {
      return 4;
    }
    if (followUpStage === "FINALIZE") {
      return 4;
    }
    if (followUpStage === "REVIEW" && showMismatchInventoryHandling && inventoryActionNeeded) {
      return 3;
    }
    if (followUpStage === "REVIEW") {
      return 2;
    }
    return 1;
  }, [finalizeSuccess, followUpStage, inventoryActionNeeded, showMismatchInventoryHandling]);
  useEffect(() => {
    onGuidedStepChange?.(guidedStep);
  }, [guidedStep, onGuidedStepChange]);
  const content = (
    <ReceiptIntakePanelContent
      panelFeedbackProps={{
        actionToast,
        setActionToast,
        notice,
        error,
        noticeTone,
        showDeveloperDebugUi,
        panelRenderTimestamp,
        hasScanAttempted,
        visibleScanDiagnostics
      }}
      duplicateReviewProps={{
        duplicatePrompt,
        duplicateConfidence,
        duplicateIsHighConfidence,
        showDuplicateReview,
        setShowDuplicateReview,
        duplicateOverrideConfirmed,
        setDuplicateOverrideConfirmed,
        canOverrideDuplicate,
        canManage,
        commitReview,
        openFocusedRecord,
        setDuplicatePrompt,
        formatCurrency,
        formatDateTimeText: (value) => formatDateTimeText(value ?? ""),
        formatReceiptPurposeLabel
      }}
      mismatchStepProps={{
        showMismatchFinalizeConfirm,
        setShowMismatchFinalizeConfirm,
        setFollowUpStage,
        showScannedDetails,
        setShowScannedDetails,
        requisitionComparison
      }}
      guidedStagesProps={{
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
        inventoryActionEditorByLine,
        setInventoryActionEditorByLine,
        setShowMismatchFinalizeConfirm,
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
        saving
      }}
      focusedOverlayProps={{
        focusedOverlayMounted,
        focusedOverlayVisible,
        closeFocusedRecordOverlay,
        focusedRecordPayload,
        focusedRecordLoading,
        focusedRecordError,
        extractReceiptPurposeFromDetails
      }}
    />
  );
  if (!renderCard) {
    return content;
  }
  return (
    <Card
      className="min-w-0"
      title="Smart Receipt Intake"
      subtitle="Upload a receipt image/PDF, review extracted data, and safely create stock-in movements"
    >
      {content}
    </Card>
  );
}
