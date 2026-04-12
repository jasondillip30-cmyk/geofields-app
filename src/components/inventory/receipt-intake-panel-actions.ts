"use client";

import type { Dispatch, MutableRefObject, PointerEvent as ReactPointerEvent, SetStateAction } from "react";

import { normalizeLinkedRecordUrl, type FocusedLinkedRecord } from "@/components/inventory/receipt-intake-panel-fields";
import type {
  DuplicatePromptState,
  IntakeAllocationStatus,
  NoticeTone,
  QrCropSelection,
  ReceiptClassification,
  ReceiptIntakePanelProps,
  ReceiptWorkflowChoice,
  ReviewLineState,
  ReviewState
} from "@/components/inventory/receipt-intake-panel-types";
import {
  mapRequisitionTypeToWorkflowChoice,
  mapRequisitionTypeToReceiptClassification,
  resolveWorkflowSelectionConfig
} from "@/components/inventory/receipt-intake-workflow-utils";
import { buildManualAssistReview } from "@/components/inventory/receipt-intake-review-state";
import { clampNormalized } from "@/components/inventory/receipt-intake-scan-utils";
import { readApiError, readJsonPayload } from "@/components/inventory/receipt-intake-save-readiness";

export function createManualSeededReview({
  payload = {},
  receiptFileName = "",
  defaultClientId,
  defaultRigId,
  warning,
  fallbackMode,
  receiptClassification,
  receiptWorkflowChoice,
  initialRequisition
}: {
  payload?: unknown;
  receiptFileName?: string;
  defaultClientId: string;
  defaultRigId: string;
  warning: string;
  fallbackMode: "MANUAL_ENTRY" | "SCAN_FAILURE";
  receiptClassification: ReceiptClassification;
  receiptWorkflowChoice: ReceiptWorkflowChoice;
  initialRequisition: ReceiptIntakePanelProps["initialRequisition"];
}) {
  const workflowConfig = resolveWorkflowSelectionConfig(receiptWorkflowChoice);
  const effectiveClassification =
    receiptClassification ||
    (initialRequisition
      ? mapRequisitionTypeToReceiptClassification(initialRequisition.type)
      : workflowConfig.classification);
  return buildManualAssistReview({
    payload,
    receiptFileName,
    defaultClientId,
    defaultRigId,
    warning,
    fallbackMode,
    receiptClassification: effectiveClassification,
    receiptWorkflowChoice,
    initialRequisition
  });
}

export function handleReceiptCaptureModeSwitch({
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
}: {
  mode: "SCAN" | "MANUAL";
  setReceiptCaptureMode: Dispatch<SetStateAction<"SCAN" | "MANUAL">>;
  review: ReviewState | null;
  activeSubmission: ReceiptIntakePanelProps["activeSubmission"];
  initialRequisition: ReceiptIntakePanelProps["initialRequisition"];
  receiptWorkflowChoice: ReceiptWorkflowChoice | "";
  receiptClassification: ReceiptClassification | "";
  defaultClientId: string;
  defaultRigId: string;
  setReview: Dispatch<SetStateAction<ReviewState | null>>;
  setFinalizeSuccess: Dispatch<SetStateAction<{ projectName: string; totalAmount: string } | null>>;
  setNoticeTone: Dispatch<SetStateAction<NoticeTone>>;
  setNotice: Dispatch<SetStateAction<string | null>>;
  setError: Dispatch<SetStateAction<string | null>>;
  setFollowUpStage: Dispatch<SetStateAction<"SCAN" | "REVIEW" | "FINALIZE">>;
}) {
  setReceiptCaptureMode(mode);
  if (mode !== "MANUAL" || review || activeSubmission) {
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
    warning: "Manual receipt mode started. Fill details directly and finalize posting.",
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
}

export function applyReviewLinePatch(current: ReviewState, lineId: string, patch: Partial<ReviewLineState>): ReviewState {
  return {
    ...current,
    lines: current.lines.map((line) => (line.id === lineId ? { ...line, ...patch } : line))
  };
}

export function buildQrSelectionFromPoints(start: { x: number; y: number }, end: { x: number; y: number }): QrCropSelection {
  const left = Math.min(start.x, end.x);
  const top = Math.min(start.y, end.y);
  const width = Math.max(Math.abs(end.x - start.x), 0.01);
  const height = Math.max(Math.abs(end.y - start.y), 0.01);
  return {
    x: clampNormalized(left),
    y: clampNormalized(top),
    width: clampNormalized(width),
    height: clampNormalized(height)
  };
}

export function resolveNormalizedPointer(
  container: HTMLDivElement | null,
  event: ReactPointerEvent<HTMLDivElement>
) {
  if (!container) {
    return null;
  }
  const rect = container.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) {
    return null;
  }
  const x = clampNormalized((event.clientX - rect.left) / rect.width);
  const y = clampNormalized((event.clientY - rect.top) / rect.height);
  return { x, y };
}

export async function fetchFocusedRecordPayload(record: FocusedLinkedRecord) {
  const normalizedRecord: FocusedLinkedRecord = {
    ...record,
    url: normalizeLinkedRecordUrl(record.url, record.type, record.id)
  };
  const endpoint =
    normalizedRecord.type === "INVENTORY_ITEM"
      ? `/api/inventory/items/${normalizedRecord.id}`
      : normalizedRecord.type === "EXPENSE"
        ? `/api/expenses/${normalizedRecord.id}`
        : `/api/inventory/movements/${normalizedRecord.id}`;
  const response = await fetch(endpoint, { cache: "no-store" });
  const payload = await readJsonPayload(response);
  if (!response.ok) {
    throw new Error(readApiError(response, payload, "Failed to load record details."));
  }
  const detailsRoot = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const details =
    detailsRoot.data && typeof detailsRoot.data === "object"
      ? (detailsRoot.data as Record<string, unknown>)
      : detailsRoot;
  return {
    record: normalizedRecord,
    details
  };
}

export function resetFocusedRecordOverlayState({
  setFocusedRecordPayload,
  setFocusedRecordError,
  setFocusedRecordLoading
}: {
  setFocusedRecordPayload: Dispatch<SetStateAction<{ record: FocusedLinkedRecord; details: Record<string, unknown> } | null>>;
  setFocusedRecordError: Dispatch<SetStateAction<string | null>>;
  setFocusedRecordLoading: Dispatch<SetStateAction<boolean>>;
}) {
  setFocusedRecordPayload(null);
  setFocusedRecordError(null);
  setFocusedRecordLoading(false);
}

export function resetScanSessionStateValues({
  setHasScanAttempted,
  setLastScanDiagnostics,
  setExtractState,
  setInventoryActionEditorByLine,
  setShowMismatchInventoryHandling,
  setShowFinalizePostingOptions,
  setShowTechnicalDetails,
  setShowMismatchFinalizeConfirm,
  setShowScannedDetails
}: {
  setHasScanAttempted: Dispatch<SetStateAction<boolean>>;
  setLastScanDiagnostics: Dispatch<SetStateAction<ReviewState["scanDiagnostics"] | null>>;
  setExtractState: Dispatch<SetStateAction<"IDLE" | "UPLOADING" | "PROCESSING" | "SUCCESS" | "FAILED">>;
  setInventoryActionEditorByLine: Dispatch<SetStateAction<Record<string, boolean>>>;
  setShowMismatchInventoryHandling: Dispatch<SetStateAction<boolean>>;
  setShowFinalizePostingOptions: Dispatch<SetStateAction<boolean>>;
  setShowTechnicalDetails: Dispatch<SetStateAction<boolean>>;
  setShowMismatchFinalizeConfirm: Dispatch<SetStateAction<boolean>>;
  setShowScannedDetails: Dispatch<SetStateAction<boolean>>;
}) {
  setHasScanAttempted(false);
  setLastScanDiagnostics(null);
  setExtractState("IDLE");
  setInventoryActionEditorByLine({});
  setShowMismatchInventoryHandling(false);
  setShowFinalizePostingOptions(false);
  setShowTechnicalDetails(false);
  setShowMismatchFinalizeConfirm(false);
  setShowScannedDetails(false);
}

export function handleReceiptFileSelection({
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
  hasReview,
  setFollowUpStage
}: {
  file: File | null;
  receiptPreviewUrl: string;
  setReceiptFile: Dispatch<SetStateAction<File | null>>;
  setReceiptPreviewUrl: Dispatch<SetStateAction<string>>;
  setFinalizeSuccess: Dispatch<SetStateAction<{ projectName: string; totalAmount: string } | null>>;
  resetScanSessionState: () => void;
  setError: Dispatch<SetStateAction<string | null>>;
  setNotice: Dispatch<SetStateAction<string | null>>;
  setNoticeTone: Dispatch<SetStateAction<NoticeTone>>;
  setDuplicatePrompt: Dispatch<SetStateAction<DuplicatePromptState | null>>;
  setShowDuplicateReview: Dispatch<SetStateAction<boolean>>;
  setDuplicateOverrideConfirmed: Dispatch<SetStateAction<boolean>>;
  setFocusedRecordPayload: Dispatch<SetStateAction<{ record: FocusedLinkedRecord; details: Record<string, unknown> } | null>>;
  setFocusedRecordError: Dispatch<SetStateAction<string | null>>;
  setLastSavedAllocationStatus: Dispatch<SetStateAction<IntakeAllocationStatus | null>>;
  setQrAssistSelection: Dispatch<SetStateAction<QrCropSelection | null>>;
  setDrawingQrSelection: Dispatch<SetStateAction<boolean>>;
  qrSelectionStartRef: MutableRefObject<{ x: number; y: number } | null>;
  hasReview: boolean;
  setFollowUpStage: Dispatch<SetStateAction<"SCAN" | "REVIEW" | "FINALIZE">>;
}) {
  if (receiptPreviewUrl) {
    URL.revokeObjectURL(receiptPreviewUrl);
  }
  setReceiptFile(file);
  setReceiptPreviewUrl(file ? URL.createObjectURL(file) : "");
  setFinalizeSuccess(null);
  resetScanSessionState();
  setError(null);
  setNotice(null);
  setNoticeTone("SUCCESS");
  setDuplicatePrompt(null);
  setShowDuplicateReview(false);
  setDuplicateOverrideConfirmed(false);
  setFocusedRecordPayload(null);
  setFocusedRecordError(null);
  setLastSavedAllocationStatus(null);
  setQrAssistSelection(null);
  setDrawingQrSelection(false);
  qrSelectionStartRef.current = null;
  if (!hasReview) {
    setFollowUpStage("SCAN");
  }
}

export function handleQrPointerDownSelection({
  event,
  manualQrAssistEnabled,
  canPreviewReceiptImage,
  container,
  setDrawingQrSelection,
  setQrAssistSelection,
  qrSelectionStartRef
}: {
  event: ReactPointerEvent<HTMLDivElement>;
  manualQrAssistEnabled: boolean;
  canPreviewReceiptImage: boolean;
  container: HTMLDivElement | null;
  setDrawingQrSelection: Dispatch<SetStateAction<boolean>>;
  setQrAssistSelection: Dispatch<SetStateAction<QrCropSelection | null>>;
  qrSelectionStartRef: MutableRefObject<{ x: number; y: number } | null>;
}) {
  if (!manualQrAssistEnabled || !canPreviewReceiptImage) {
    return;
  }
  const point = resolveNormalizedPointer(container, event);
  if (!point) {
    return;
  }
  event.preventDefault();
  qrSelectionStartRef.current = point;
  setDrawingQrSelection(true);
  setQrAssistSelection({
    x: point.x,
    y: point.y,
    width: 0.01,
    height: 0.01
  });
  event.currentTarget.setPointerCapture(event.pointerId);
}

export function handleQrPointerMoveSelection({
  event,
  drawingQrSelection,
  manualQrAssistEnabled,
  container,
  qrSelectionStartRef,
  setQrAssistSelection
}: {
  event: ReactPointerEvent<HTMLDivElement>;
  drawingQrSelection: boolean;
  manualQrAssistEnabled: boolean;
  container: HTMLDivElement | null;
  qrSelectionStartRef: MutableRefObject<{ x: number; y: number } | null>;
  setQrAssistSelection: Dispatch<SetStateAction<QrCropSelection | null>>;
}) {
  if (!drawingQrSelection || !manualQrAssistEnabled) {
    return;
  }
  const point = resolveNormalizedPointer(container, event);
  const start = qrSelectionStartRef.current;
  if (!point || !start) {
    return;
  }
  event.preventDefault();
  setQrAssistSelection(buildQrSelectionFromPoints(start, point));
}

export function handleQrPointerUpSelection({
  event,
  drawingQrSelection,
  container,
  qrSelectionStartRef,
  setQrAssistSelection,
  setDrawingQrSelection
}: {
  event: ReactPointerEvent<HTMLDivElement>;
  drawingQrSelection: boolean;
  container: HTMLDivElement | null;
  qrSelectionStartRef: MutableRefObject<{ x: number; y: number } | null>;
  setQrAssistSelection: Dispatch<SetStateAction<QrCropSelection | null>>;
  setDrawingQrSelection: Dispatch<SetStateAction<boolean>>;
}) {
  if (!drawingQrSelection) {
    return;
  }
  const start = qrSelectionStartRef.current;
  const point = resolveNormalizedPointer(container, event);
  if (start && point) {
    setQrAssistSelection(buildQrSelectionFromPoints(start, point));
  }
  setDrawingQrSelection(false);
  qrSelectionStartRef.current = null;
  if (event.currentTarget.hasPointerCapture(event.pointerId)) {
    event.currentTarget.releasePointerCapture(event.pointerId);
  }
}
