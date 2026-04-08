"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import Link from "next/link";

import { Card } from "@/components/ui/card";
import {
  DuplicateLinksGroup,
  InputField,
  RecordLinkedRows,
  RecordSummaryGrid,
  SelectField,
  formatLinkedRecordType,
  normalizeLinkedRecordUrl,
  type FocusedLinkedRecord,
  type LinkedRecordType
} from "@/components/inventory/receipt-intake-panel-fields";
import { ReceiptIntakeScanStep } from "@/components/inventory/receipt-intake-scan-step";
import { ReceiptIntakeFinalizeStep } from "@/components/inventory/receipt-intake-finalize-step";
import { ReceiptIntakeReviewStep } from "@/components/inventory/receipt-intake-review-step";
import { ReceiptIntakeMismatchStep } from "@/components/inventory/receipt-intake-mismatch-step";
import {
  clampNormalized,
  formatFieldSource,
  formatQrContentType,
  formatQrDecodeStatus,
  formatQrLookupStatus,
  formatQrParseStatus,
  formatReadability,
  formatScanFailureStage,
  readabilityBadgeClass
} from "@/components/inventory/receipt-intake-scan-utils";
import { buildEmptyScanDiagnostics } from "@/components/inventory/receipt-intake-diagnostics-utils";
import {
  applyWorkflowSelectionUpdate,
  formatReceiptPurposeLabel,
  mapRequisitionTypeToReceiptClassification,
  mapRequisitionTypeToWorkflowChoice,
  normalizeReceiptWorkflowChoice,
  resolveCreateExpenseForPurpose,
  resolveExpenseOnlyCategory,
  resolveWorkflowChoiceFromReview,
  resolveWorkflowSelectionConfig
} from "@/components/inventory/receipt-intake-workflow-utils";
import {
  calmMessage,
  deriveCriticalManualFieldHints,
  deriveManualFieldHints,
  evaluateAutoSaveEligibility,
  evaluateSaveReadiness,
  markFrontendMappingGap,
  readApiError,
  readJsonPayload,
  readPayloadMessage,
  resolveScanFailureNotice
} from "@/components/inventory/receipt-intake-save-readiness";
import {
  asString,
  buildManualAssistReview,
  buildReviewStateFromPayload,
  buildReviewStateFromSubmission,
  deriveAllocationStatus,
  extractReceiptPurposeFromDetails,
  formatDateTimeText,
  formatMoneyText,
  hasMeaningfulExtractedPayload,
  hasMeaningfulReviewData,
  isReceiptCommitSuccessPayload,
  isReceiptExtractSuccessPayload,
  isDuplicateCommitPayload,
  normalizeAllocationStatus,
  readDuplicateReviewPayload,
} from "@/components/inventory/receipt-intake-review-state";
import {
  buildRequisitionMismatchReview,
  evaluateRequisitionComparison
} from "@/components/inventory/receipt-intake-comparison";
import { inventoryCategoryOptions, formatInventoryCategory } from "@/lib/inventory";
import { formatCurrency } from "@/lib/utils";

export type FieldConfidence = "HIGH" | "MEDIUM" | "LOW" | "NONE";
export type ReadabilityConfidence = "HIGH" | "MEDIUM" | "LOW" | "UNREADABLE";
type ReceiptScanStatus = "COMPLETE" | "PARTIAL" | "UNREADABLE";
type ReceiptType = "INVENTORY_PURCHASE" | "GENERAL_EXPENSE" | "UNCLEAR";
export type ExpenseOnlyCategory = "TRAVEL" | "FOOD" | "FUEL" | "MISC";
type QrContentType = "TRA_URL" | "URL" | "STRUCTURED_TEXT" | "UNKNOWN" | "NONE";
export type QrDecodeStatus = "DECODED" | "NOT_DETECTED" | "DECODE_FAILED";
export type QrParseStatus = "PARSED" | "PARTIAL" | "UNPARSED";
export type QrLookupStatus = "NOT_ATTEMPTED" | "SUCCESS" | "FAILED";
type QrParseDetailStatus = "NOT_ATTEMPTED" | "SUCCESS" | "PARTIAL" | "FAILED";
const RECEIPT_INTAKE_DEBUG_ENABLED =
  process.env.NEXT_PUBLIC_RECEIPT_INTAKE_DEBUG_UI === "1" &&
  process.env.NODE_ENV !== "production";

export interface ReceiptIntakePanelProps {
  canManage: boolean;
  items: Array<{
    id: string;
    name: string;
    sku: string;
    category: string;
    minimumStockLevel: number;
  }>;
  suppliers: Array<{ id: string; name: string }>;
  locations: Array<{ id: string; name: string }>;
  maintenanceRequests: Array<{ id: string; requestCode: string }>;
  clients: Array<{ id: string; name: string }>;
  projects: Array<{ id: string; name: string; clientId: string }>;
  rigs: Array<{ id: string; rigCode: string }>;
  defaultClientId?: string;
  defaultRigId?: string;
  initialRequisition?: {
    id: string;
    requisitionCode: string;
    type: "LIVE_PROJECT_PURCHASE" | "INVENTORY_STOCK_UP" | "MAINTENANCE_PURCHASE";
    liveProjectSpendType?: "BREAKDOWN" | "NORMAL_EXPENSE" | null;
    category?: string | null;
    subcategory?: string | null;
    requestedVendorName?: string | null;
    clientId?: string | null;
    projectId?: string | null;
    rigId?: string | null;
    maintenanceRequestId?: string | null;
    lineItems?: Array<{
      id: string;
      description: string;
      quantity: number;
      estimatedUnitCost: number;
      estimatedTotalCost: number;
      notes: string | null;
    }>;
    totals?: {
      estimatedTotalCost?: number;
      approvedTotalCost?: number;
      actualPostedCost?: number;
    };
  } | null;
  activeSubmission?: {
    id: string;
    status: "SUBMITTED" | "APPROVED" | "REJECTED";
    draft: {
      workflowType?:
        | "PROJECT_PURCHASE"
        | "MAINTENANCE_PURCHASE"
        | "STOCK_PURCHASE"
        | "INTERNAL_TRANSFER";
      receiptType?:
        | "INVENTORY_PURCHASE"
        | "MAINTENANCE_LINKED_PURCHASE"
        | "EXPENSE_ONLY"
        | "INTERNAL_TRANSFER";
      requisitionId?: string | null;
      expenseOnlyCategory?: "TRAVEL" | "FOOD" | "FUEL" | "MISC";
      receiptPurpose?:
        | "INVENTORY_PURCHASE"
        | "BUSINESS_EXPENSE_ONLY"
        | "INVENTORY_AND_EXPENSE"
        | "EVIDENCE_ONLY"
        | "OTHER_MANUAL";
      createExpense?: boolean;
      receipt?: {
        url?: string | null;
        fileName?: string | null;
        supplierId?: string | null;
        supplierName?: string | null;
        tin?: string | null;
        vrn?: string | null;
        serialNumber?: string | null;
        receiptNumber?: string | null;
        verificationCode?: string | null;
        verificationUrl?: string | null;
        rawQrValue?: string | null;
        receiptDate?: string | null;
        receiptTime?: string | null;
        traReceiptNumber?: string | null;
        invoiceReference?: string | null;
        paymentMethod?: string | null;
        taxOffice?: string | null;
        ocrTextPreview?: string | null;
        currency?: string | null;
        subtotal?: number | null;
        tax?: number | null;
        total?: number | null;
      };
      linkContext?: {
        clientId?: string | null;
        projectId?: string | null;
        rigId?: string | null;
        maintenanceRequestId?: string | null;
        locationFromId?: string | null;
        locationToId?: string | null;
      };
      lines?: Array<{
        id?: string;
        description?: string;
        quantity?: number;
        unitPrice?: number;
        lineTotal?: number;
        selectedItemId?: string | null;
        selectedCategory?: string | null;
        mode?: "MATCH" | "NEW" | "EXPENSE_ONLY";
        newItem?: {
          name?: string;
          sku?: string;
          category?: string;
          minimumStockLevel?: number;
          locationId?: string | null;
          status?: "ACTIVE" | "INACTIVE";
          notes?: string;
        } | null;
      }>;
    };
  } | null;
  preferredInputMethod?: ReceiptInputMethod;
  renderCard?: boolean;
  onFollowUpStageChange?: (stage: ReceiptFollowUpStage) => void;
  onGuidedStepChange?: (step: 1 | 2 | 3 | 4) => void;
  onCompleted: () => Promise<void> | void;
}

export interface ReviewLineState {
  id: string;
  description: string;
  quantity: string;
  unitPrice: string;
  lineTotal: string;
  extractionConfidence: "HIGH" | "MEDIUM" | "LOW";
  selectedCategory: string;
  suggestedCategory: string | null;
  categoryReason: string;
  mode: "MATCH" | "NEW" | "EXPENSE_ONLY";
  selectedItemId: string;
  matchConfidence: FieldConfidence;
  matchScore: number;
  newItemName: string;
  newItemSku: string;
  newItemMinimumStockLevel: string;
}

export interface ReceiptSnapshotLine {
  id: string;
  description: string;
  quantity: string;
  unitPrice: string;
  lineTotal: string;
}

export type ScanFailureStage =
  | "NONE"
  | "QR_NOT_DETECTED"
  | "QR_DECODE_FAILED"
  | "QR_PARSE_UNPARSED"
  | "TRA_LOOKUP_FAILED"
  | "FRONTEND_MAPPING_EMPTY";

export interface ScanDiagnosticsState {
  failureStage: ScanFailureStage;
  failureMessage: string;
  qrDetected: boolean;
  qrDecodeStatus: QrDecodeStatus;
  qrDecodePass: string;
  qrParseStatus: QrParseStatus;
  qrFailureReason: string;
  qrContentType: QrContentType;
  qrRawValue: string;
  qrNormalizedRawValue: string;
  qrRawLength: number;
  qrRawPreview: string;
  qrRawPayloadFormat:
    | "EMPTY"
    | "URL"
    | "JSON"
    | "QUERY_STRING"
    | "KEY_VALUE"
    | "PERCENT_ENCODED"
    | "BASE64_LIKE"
    | "TEXT";
  qrVerificationUrl: string;
  qrIsTraVerification: boolean;
  qrParsedFieldCount: number;
  qrParsedLineItemsCount: number;
  qrLookupStatus: QrLookupStatus;
  qrLookupReason: string;
  qrLookupHttpStatus: number | null;
  qrLookupParsed: boolean;
  ocrAttempted: boolean;
  ocrSucceeded: boolean;
  ocrError: string;
  scanStatus: ReceiptScanStatus;
  extractionMethod: string;
  returnedFrom: "qr_tra" | "qr_tra_plus_ocr";
  attemptedPassCount: number;
  attemptedPassSample: string[];
  successfulPass: string;
  variantCount: number;
  imageReceived: boolean;
  imageLoaded: boolean;
}

export interface ReviewState {
  requisitionId: string;
  requisitionCode: string;
  requisitionType: "LIVE_PROJECT_PURCHASE" | "INVENTORY_STOCK_UP" | "MAINTENANCE_PURCHASE" | "";
  receiptUrl: string;
  receiptFileName: string;
  supplierId: string;
  supplierName: string;
  tin: string;
  vrn: string;
  serialNumber: string;
  receiptNumber: string;
  verificationCode: string;
  verificationUrl: string;
  rawQrValue: string;
  qrContentType: QrContentType;
  isTraVerification: boolean;
  isQrOnlyImage: boolean;
  qrDecodeStatus: QrDecodeStatus;
  qrDecodePass: string;
  qrParseStatus: QrParseStatus;
  qrFailureReason: string;
  qrLookupStatus: QrLookupStatus;
  qrLookupReason: string;
  qrFieldsParseStatus: QrParseDetailStatus;
  qrLineItemsParseStatus: QrParseDetailStatus;
  receiptDate: string;
  receiptTime: string;
  traReceiptNumber: string;
  invoiceReference: string;
  paymentMethod: string;
  taxOffice: string;
  currency: string;
  subtotal: string;
  tax: string;
  total: string;
  clientId: string;
  projectId: string;
  rigId: string;
  maintenanceRequestId: string;
  locationFromId: string;
  locationToId: string;
  expenseOnlyCategory: ExpenseOnlyCategory | "";
  createExpense: boolean;
  receiptPurpose: ReceiptPurpose;
  receiptWorkflowChoice: ReceiptWorkflowChoice;
  receiptClassification: ReceiptClassification;
  warnings: string[];
  extractionMethod: string;
  scanStatus: ReceiptScanStatus;
  receiptType: ReceiptType;
  fieldConfidence: Record<string, ReadabilityConfidence>;
  fieldSource: Record<string, "QR" | "OCR" | "DERIVED" | "NONE">;
  rawTextPreview: string;
  debugFlags: {
    qrDecoded: boolean;
    traLookupSucceeded: boolean;
    traParseSucceeded: boolean;
    ocrAttempted: boolean;
    ocrSucceeded: boolean;
    ocrError: string;
    enrichmentWarning: string;
    returnedFrom: "qr_tra" | "qr_tra_plus_ocr";
    partialEnrichment: boolean;
  };
  debugCandidates: Array<{
    label: string;
    confidence: number;
    score: number;
    textLength: number;
  }>;
  scannedSnapshot: {
    supplierName: string;
    receiptNumber: string;
    receiptDate: string;
    total: string;
    lines: ReceiptSnapshotLine[];
  };
  scanDiagnostics: ScanDiagnosticsState;
  scanFallbackMode: "NONE" | "SCAN_FAILURE" | "MANUAL_ENTRY";
  lines: ReviewLineState[];
}

export type ExtractState = "IDLE" | "UPLOADING" | "PROCESSING" | "SUCCESS" | "FAILED";
type NoticeTone = "SUCCESS" | "WARNING";
type RequisitionComparisonStatus =
  | "MATCHED"
  | "CLOSE_MATCH"
  | "MISMATCH"
  | "SCAN_FAILED"
  | "MANUAL_ENTRY";

export type ReceiptPurpose =
  | "INVENTORY_PURCHASE"
  | "BUSINESS_EXPENSE_ONLY"
  | "INVENTORY_AND_EXPENSE"
  | "EVIDENCE_ONLY"
  | "OTHER_MANUAL";

export type ReceiptClassification =
  | "INVENTORY_PURCHASE"
  | "MAINTENANCE_LINKED_PURCHASE"
  | "EXPENSE_ONLY"
  | "INTERNAL_TRANSFER";

export type ReceiptWorkflowChoice =
  | "PROJECT_PURCHASE"
  | "MAINTENANCE_PURCHASE"
  | "STOCK_PURCHASE"
  | "INTERNAL_TRANSFER";
type ReceiptInputMethod = "SCAN" | "MANUAL";
export type ReceiptFollowUpStage = "SCAN" | "REVIEW" | "FINALIZE";
export type ReceiptCaptureMode = "SCAN" | "MANUAL";

const SCAN_FALLBACK_MESSAGE = "Scan could not extract receipt data. Please complete manually.";

export interface QrCropSelection {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SaveReadiness {
  ready: boolean;
  reasons: string[];
}

export interface RequisitionComparisonResult {
  status: RequisitionComparisonStatus;
  label: string;
  message: string;
  canInspectScannedDetails: boolean;
  scanTrustLabel: string;
  scanTrustMessage: string;
  differenceRows: Array<{
    label: string;
    approved: string;
    scanned: string;
  }>;
  headerRows: Array<{
    label: string;
    approved: string;
    scanned: string;
    mismatch: boolean;
  }>;
  approvedLines: ReceiptSnapshotLine[];
  scannedLines: ReceiptSnapshotLine[];
}

interface FocusedRecordPayload {
  record: FocusedLinkedRecord;
  details: Record<string, unknown>;
}

export type IntakeAllocationStatus = "ALLOCATED" | "PARTIALLY_ALLOCATED" | "UNALLOCATED";

export interface DuplicatePromptState {
  message: string;
  matches: Array<{
    source: string;
    id: string;
    matchedFields: string[];
    reason: string;
    viewUrl: string;
  }>;
  review: {
    summary: {
      supplierName: string;
      receiptNumber: string;
      verificationCode: string;
      serialNumber: string;
      receiptDate: string;
      total: number;
      traReceiptNumber: string;
      processedAt: string;
      duplicateConfidence: "HIGH" | "MEDIUM" | "LOW";
      matchReason: string;
      matchedFields: string[];
      receiptPurpose: string;
    };
    primaryRecord: {
      id: string;
      label: string;
      type: "RECEIPT_INTAKE" | "INVENTORY_ITEM" | "STOCK_MOVEMENT" | "EXPENSE";
      url: string;
    } | null;
    linkedRecords: {
      receiptIntake: Array<{ id: string; label: string; type: string; url: string }>;
      inventoryItems: Array<{ id: string; label: string; type: string; url: string }>;
      stockMovements: Array<{ id: string; label: string; type: string; url: string }>;
      expenses: Array<{ id: string; label: string; type: string; url: string }>;
    };
  } | null;
  reviewSnapshot: ReviewState;
  auto: boolean;
}

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

    const workflowConfig = resolveWorkflowSelectionConfig(workflowChoice);
    const effectiveClassification =
      receiptClassification ||
      (initialRequisition
        ? mapRequisitionTypeToReceiptClassification(initialRequisition.type)
        : workflowConfig.classification);

    const seededReview = buildManualAssistReview({
      payload: {},
      receiptFileName: "",
      defaultClientId,
      defaultRigId,
      warning:
        "Manual entry selected. Complete receipt details directly and finalize when ready.",
      fallbackMode: "MANUAL_ENTRY",
      receiptClassification: effectiveClassification,
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

  const _saveReadiness = useMemo(() => {
    if (!review) {
      return null;
    }
    return evaluateSaveReadiness(review);
  }, [review]);
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
  const _manualFieldHints = useMemo(() => {
    if (!review) {
      return [];
    }
    return deriveManualFieldHints(review);
  }, [review]);
  const _criticalManualFieldHints = useMemo(() => {
    if (!review) {
      return [];
    }
    return deriveCriticalManualFieldHints(review);
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
    const workflowConfig = resolveWorkflowSelectionConfig(workflowChoice);
    const effectiveClassification =
      receiptClassification ||
      (initialRequisition
        ? mapRequisitionTypeToReceiptClassification(initialRequisition.type)
        : workflowConfig.classification);
    const seededReview = buildManualAssistReview({
      payload: {},
      receiptFileName: "",
      defaultClientId,
      defaultRigId,
      warning: "Manual entry selected. Complete receipt details directly and finalize when ready.",
      fallbackMode: "MANUAL_ENTRY",
      receiptClassification: effectiveClassification,
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

  function closeFocusedRecordOverlay() {
    setFocusedRecordPayload(null);
    setFocusedRecordError(null);
    setFocusedRecordLoading(false);
  }

  function resetScanSessionState() {
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

  function handleReceiptFileChange(file: File | null) {
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
    if (!review) {
      setFollowUpStage("SCAN");
    }
  }

  function updateQrSelectionFromPoints(start: { x: number; y: number }, end: { x: number; y: number }) {
    const left = Math.min(start.x, end.x);
    const top = Math.min(start.y, end.y);
    const width = Math.max(Math.abs(end.x - start.x), 0.01);
    const height = Math.max(Math.abs(end.y - start.y), 0.01);
    setQrAssistSelection({
      x: clampNormalized(left),
      y: clampNormalized(top),
      width: clampNormalized(width),
      height: clampNormalized(height)
    });
  }

  function resolveNormalizedPointer(event: ReactPointerEvent<HTMLDivElement>) {
    const container = qrPreviewContainerRef.current;
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

  function handleQrPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (!manualQrAssistEnabled || !canPreviewReceiptImage) {
      return;
    }
    const point = resolveNormalizedPointer(event);
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

  function handleQrPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!drawingQrSelection || !manualQrAssistEnabled) {
      return;
    }
    const point = resolveNormalizedPointer(event);
    const start = qrSelectionStartRef.current;
    if (!point || !start) {
      return;
    }
    event.preventDefault();
    updateQrSelectionFromPoints(start, point);
  }

  function handleQrPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    if (!drawingQrSelection) {
      return;
    }
    const start = qrSelectionStartRef.current;
    const point = resolveNormalizedPointer(event);
    if (start && point) {
      updateQrSelectionFromPoints(start, point);
    }
    setDrawingQrSelection(false);
    qrSelectionStartRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
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
      return {
        ...current,
        lines: current.lines.map((line) => (line.id === lineId ? { ...line, ...patch } : line))
      };
    });
  }

  async function openFocusedRecord(record: FocusedLinkedRecord) {
    const normalizedRecord: FocusedLinkedRecord = {
      ...record,
      url: normalizeLinkedRecordUrl(record.url, record.type, record.id)
    };
    setFocusedRecordLoading(true);
    setFocusedRecordError(null);
    setFocusedRecordPayload(null);
    try {
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
      setFocusedRecordPayload({
        record: normalizedRecord,
        details
      });
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
    <div className="space-y-4">
        {actionToast && (
          <aside className="pointer-events-none fixed bottom-5 right-5 z-[91] w-[min(440px,calc(100vw-2rem))]">
            <div
              className={`pointer-events-auto rounded-2xl border px-3.5 py-3 shadow-[0_16px_36px_rgba(15,23,42,0.16)] backdrop-blur-sm ${
                actionToast.tone === "SUCCESS"
                  ? "border-emerald-200 bg-white/95 text-emerald-900"
                  : actionToast.tone === "ERROR"
                    ? "border-red-200 bg-white/95 text-red-900"
                    : "border-amber-200 bg-white/95 text-amber-900"
              }`}
            >
              <p className="text-xs font-semibold uppercase tracking-wide">{actionToast.actionLabel}</p>
              <p className="mt-1 text-sm leading-5">{actionToast.message}</p>
              <button
                type="button"
                onClick={() => setActionToast(null)}
                className="mt-2 text-xs font-semibold underline underline-offset-2"
              >
                Dismiss
              </button>
            </div>
          </aside>
        )}
        {(notice || error) && (
          <p
            className={`rounded-lg px-3 py-2 text-sm ${
              !error && noticeTone === "SUCCESS"
                ? "border border-emerald-200 bg-emerald-50 text-emerald-800"
                : "border border-amber-300 bg-amber-50 text-amber-900"
            }`}
          >
            {error || notice}
          </p>
        )}
        {showDeveloperDebugUi && (
          <section className="rounded-xl border-2 border-fuchsia-600 bg-fuchsia-100 px-3 py-3 text-sm text-fuchsia-950 shadow-sm">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-fuchsia-900">
            receipt-follow-up debug build active
          </p>
          <p className="mt-1 text-base font-black uppercase tracking-wide text-fuchsia-900">
            RECEIPT INTAKE PANEL RENDERED
          </p>
          <div className="mt-2 grid gap-1 sm:grid-cols-2">
            <p>
              component name: <span className="font-semibold">ReceiptIntakePanel</span>
            </p>
            <p>
              page path: <span className="font-semibold">/purchasing/receipt-follow-up</span>
            </p>
            <p>
              current timestamp at render: <span className="font-semibold">{panelRenderTimestamp}</span>
            </p>
            <p>
              version: <span className="font-semibold">receipt-follow-up-debug-v1</span>
            </p>
          </div>
          <div className="mt-3 rounded-lg border-2 border-fuchsia-500 bg-white p-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-fuchsia-900">RAW QR DEBUG PANEL</p>
            <div className="mt-2 grid gap-1 sm:grid-cols-2">
              <p>
                hasScanAttempted: <span className="font-medium">{hasScanAttempted ? "true" : "false"}</span>
              </p>
              <p>
                qrDetected:{" "}
                <span className="font-medium">
                  {visibleScanDiagnostics ? (visibleScanDiagnostics.qrDetected ? "true" : "false") : "not attempted"}
                </span>
              </p>
              <p>
                qrDecodeStatus:{" "}
                <span className="font-medium">{visibleScanDiagnostics?.qrDecodeStatus || "NOT_ATTEMPTED"}</span>
              </p>
              <p>
                qrRawLength: <span className="font-medium">{visibleScanDiagnostics?.qrRawLength ?? 0}</span>
              </p>
              <p>
                qrRawPayloadFormat:{" "}
                <span className="font-medium">{visibleScanDiagnostics?.qrRawPayloadFormat || "NOT_ATTEMPTED"}</span>
              </p>
              <p>
                qrRawPreview:{" "}
                <span className="font-medium">{visibleScanDiagnostics?.qrRawPreview || "(not attempted)"}</span>
              </p>
            </div>
            <div className="mt-2 rounded border-2 border-fuchsia-300 bg-slate-50 p-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-fuchsia-900">full raw qrRawValue</p>
              <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded border border-slate-200 bg-white p-2 text-xs text-slate-900">
                {visibleScanDiagnostics?.qrRawValue || "(not attempted)"}
              </pre>
            </div>
          </div>
          </section>
        )}
        {duplicatePrompt && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-3 text-sm text-amber-900">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-semibold">{duplicatePrompt.message}</p>
              <span
                className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
                  duplicateIsHighConfidence
                    ? "border-red-300 bg-red-100 text-red-800"
                    : "border-amber-300 bg-amber-100 text-amber-900"
                }`}
              >
                Duplicate confidence: {duplicateConfidence}
              </span>
            </div>
            <p className="mt-1 text-xs text-amber-900">
              Current receipt data closely matches a previously processed receipt. Review the prior record relationship before deciding.
            </p>
            {duplicatePrompt.matches.length > 0 && (
              <div className="mt-2 space-y-1 text-xs">
                {duplicatePrompt.matches.slice(0, 3).map((match) => (
                  <p key={`${match.source}-${match.id}`}>
                    {match.source === "expense" ? "Expense" : "Stock movement"} {match.id.slice(-8)} • {match.reason}
                  </p>
                ))}
              </div>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setShowDuplicateReview((current) => !current)}
                className="rounded border border-amber-400 bg-white px-3 py-1.5 text-xs font-semibold text-amber-900 hover:bg-amber-100"
              >
                {showDuplicateReview ? "Hide duplicate review" : "Review duplicate"}
              </button>
              {!duplicateIsHighConfidence || canManage ? (
                <label className="inline-flex items-center gap-2 rounded border border-amber-300 bg-white px-2 py-1 text-xs text-amber-900">
                  <input
                    type="checkbox"
                    checked={duplicateOverrideConfirmed}
                    onChange={(event) => setDuplicateOverrideConfirmed(event.target.checked)}
                  />
                  {duplicateIsHighConfidence
                    ? "I confirm this is intentional and should override duplicate protection"
                    : "I understand and want to continue anyway"}
                </label>
              ) : (
                <span className="rounded border border-red-300 bg-red-50 px-2 py-1 text-xs text-red-800">
                  High-confidence duplicates require manager/admin override.
                </span>
              )}
              <button
                type="button"
                onClick={() =>
                  void commitReview(duplicatePrompt.reviewSnapshot, {
                    auto: duplicatePrompt.auto,
                    allowDuplicateSave: true
                  })
                }
                disabled={!canOverrideDuplicate}
                className="rounded border border-brand-300 bg-brand-50 px-3 py-1.5 text-xs font-semibold text-brand-800 hover:bg-brand-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Override duplicate and continue
              </button>
              <button
                type="button"
                onClick={() => {
                  setDuplicatePrompt(null);
                  setShowDuplicateReview(false);
                  setDuplicateOverrideConfirmed(false);
                }}
                className="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-100"
              >
                Cancel
              </button>
            </div>
            {showDuplicateReview && (
              <div className="mt-3 space-y-3 rounded-lg border border-amber-300 bg-white p-3 text-xs text-slate-800">
                <p className="text-sm font-semibold text-slate-900">Duplicate Receipt Review</p>
                {duplicatePrompt.review ? (
                  <>
                    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                      <p><span className="font-semibold">Supplier:</span> {duplicatePrompt.review.summary.supplierName || "-"}</p>
                      <p><span className="font-semibold">Receipt #:</span> {duplicatePrompt.review.summary.receiptNumber || "-"}</p>
                      <p><span className="font-semibold">Verification:</span> {duplicatePrompt.review.summary.verificationCode || "-"}</p>
                      <p><span className="font-semibold">Serial #:</span> {duplicatePrompt.review.summary.serialNumber || "-"}</p>
                      <p><span className="font-semibold">Receipt Date:</span> {duplicatePrompt.review.summary.receiptDate || "-"}</p>
                      <p><span className="font-semibold">TRA Receipt #:</span> {duplicatePrompt.review.summary.traReceiptNumber || "-"}</p>
                      <p><span className="font-semibold">Total:</span> {formatCurrency(duplicatePrompt.review.summary.total || 0)}</p>
                      <p><span className="font-semibold">Processed:</span> {formatDateTimeText(duplicatePrompt.review.summary.processedAt)}</p>
                      <p><span className="font-semibold">Confidence:</span> {duplicatePrompt.review.summary.duplicateConfidence}</p>
                      <p><span className="font-semibold">Receipt Purpose:</span> {formatReceiptPurposeLabel(duplicatePrompt.review.summary.receiptPurpose)}</p>
                    </div>
                    <div className="rounded border border-slate-200 bg-slate-50 px-2 py-1.5">
                      <p className="font-semibold">Match reason</p>
                      <p className="mt-0.5">{duplicatePrompt.review.summary.matchReason || "-"}</p>
                      {duplicatePrompt.review.summary.matchedFields.length > 0 && (
                        <p className="mt-1 text-slate-600">
                          Matched fields: {duplicatePrompt.review.summary.matchedFields.join(", ")}
                        </p>
                      )}
                    </div>
                    {duplicatePrompt.review.primaryRecord && (
                      <div className="rounded border border-emerald-300 bg-emerald-50 px-2 py-1.5 text-emerald-900">
                        <p className="font-semibold">Primary prior receipt record</p>
                        <div className="mt-1 flex flex-wrap items-center gap-2">
                          <span>{duplicatePrompt.review.primaryRecord.label}</span>
                          <button
                            type="button"
                            onClick={() =>
                              void openFocusedRecord({
                                id: duplicatePrompt.review?.primaryRecord?.id || "",
                                label: duplicatePrompt.review?.primaryRecord?.label || "Primary record",
                                type: (duplicatePrompt.review?.primaryRecord?.type || "RECEIPT_INTAKE") as LinkedRecordType,
                                url: duplicatePrompt.review?.primaryRecord?.url || "/inventory"
                              })
                            }
                            className="rounded border border-emerald-400 bg-white px-2 py-1 font-semibold hover:bg-emerald-100"
                          >
                            {duplicatePrompt.review.primaryRecord.type === "EXPENSE"
                              ? "Open expense record"
                              : duplicatePrompt.review.primaryRecord.type === "INVENTORY_ITEM"
                                ? "Open inventory item"
                                : "Open receipt intake"}
                          </button>
                        </div>
                      </div>
                    )}
                    <div className="grid gap-2 sm:grid-cols-2">
                      <DuplicateLinksGroup
                        title="Receipt intake record"
                        emptyLabel="No receipt intake record linked"
                        links={duplicatePrompt.review.linkedRecords.receiptIntake}
                        buttonLabel="Open receipt intake"
                        onOpen={(link) => void openFocusedRecord(link)}
                      />
                      <DuplicateLinksGroup
                        title="Inventory items created"
                        emptyLabel="No linked inventory items"
                        links={duplicatePrompt.review.linkedRecords.inventoryItems}
                        buttonLabel="Open inventory item"
                        onOpen={(link) => void openFocusedRecord(link)}
                      />
                      <DuplicateLinksGroup
                        title="Stock movements created"
                        emptyLabel="No linked stock movements"
                        links={duplicatePrompt.review.linkedRecords.stockMovements}
                        buttonLabel="Open stock movement"
                        onOpen={(link) => void openFocusedRecord(link)}
                      />
                      <DuplicateLinksGroup
                        title="Expense records created"
                        emptyLabel="No linked expenses"
                        links={duplicatePrompt.review.linkedRecords.expenses}
                        buttonLabel="Open expense record"
                        onOpen={(link) => void openFocusedRecord(link)}
                      />
                    </div>
                  </>
                ) : (
                  <p>Duplicate details are available. You can still save anyway if this is intentional.</p>
                )}
              </div>
            )}
          </div>
        )}

        <ReceiptIntakeMismatchStep
          showMismatchFinalizeConfirm={showMismatchFinalizeConfirm}
          setShowMismatchFinalizeConfirm={setShowMismatchFinalizeConfirm}
          setFollowUpStage={setFollowUpStage}
          showScannedDetails={showScannedDetails}
          setShowScannedDetails={setShowScannedDetails}
          requisitionComparison={requisitionComparison}
        />

        {finalizeSuccess && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-4">
            <p className="text-base font-semibold text-emerald-900">Receipt posted successfully</p>
            <div className="mt-2 grid gap-1 text-sm text-emerald-900 sm:grid-cols-2">
              <p><span className="font-medium">Project:</span> {finalizeSuccess.projectName}</p>
              <p><span className="font-medium">Total:</span> {finalizeSuccess.totalAmount}</p>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Link
                href="/cost-tracking"
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
                inventoryActionEditorByLine={inventoryActionEditorByLine}
                setInventoryActionEditorByLine={setInventoryActionEditorByLine}
                inventoryCategoryOptions={inventoryCategoryOptions}
                formatInventoryCategory={formatInventoryCategory}
                setShowMismatchFinalizeConfirm={setShowMismatchFinalizeConfirm}
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
                showFinalizePostingOptions={showFinalizePostingOptions}
                setShowFinalizePostingOptions={setShowFinalizePostingOptions}
                formatMoneyText={formatMoneyText}
              />
            )}
            {followUpStage === "FINALIZE" && (
              <>
                {(!mismatchDetected || showFinalizePostingOptions) && (
                  <>
            <div className="rounded-lg border border-slate-200/55 bg-white px-2.5 py-1.5">
              <p className="text-sm font-semibold text-slate-800">Posting Details</p>
              <div className="mt-1.5 grid gap-1.5 md:grid-cols-2 xl:grid-cols-4">
                <label className="text-xs text-ink-700">
                  <span className="mb-1 block uppercase tracking-wide text-slate-500">Supplier (existing)</span>
                  <select
                    value={review.supplierId}
                    onChange={(event) =>
                      setReview((current) =>
                        current
                          ? {
                              ...current,
                              supplierId: event.target.value,
                              supplierName:
                                suppliers.find((supplier) => supplier.id === event.target.value)?.name || current.supplierName
                            }
                          : current
                      )
                    }
                    className="w-full rounded-lg border border-slate-200/70 px-3 py-1.5 text-sm"
                  >
                    <option value="">No supplier match</option>
                    {suppliers.map((supplier) => (
                      <option key={supplier.id} value={supplier.id}>
                        {supplier.name}
                      </option>
                    ))}
                  </select>
                </label>
                <InputField
                  label="Supplier Name"
                  value={review.supplierName}
                  onChange={(value) =>
                    setReview((current) => (current ? { ...current, supplierName: value, supplierId: "" } : current))
                  }
                />
                {!mismatchDetected && (
                  <InputField
                    label="Receipt Number"
                    value={review.receiptNumber}
                    onChange={(value) => setReview((current) => (current ? { ...current, receiptNumber: value } : current))}
                  />
                )}
                {!mismatchDetected && (
                  <InputField
                    label="Receipt Date"
                    type="date"
                    value={review.receiptDate}
                    onChange={(value) => setReview((current) => (current ? { ...current, receiptDate: value } : current))}
                  />
                )}
                <InputField
                  label="Subtotal"
                  type="number"
                  value={review.subtotal}
                  onChange={(value) => setReview((current) => (current ? { ...current, subtotal: value } : current))}
                />
                <InputField
                  label="Tax / VAT"
                  type="number"
                  value={review.tax}
                  onChange={(value) => setReview((current) => (current ? { ...current, tax: value } : current))}
                />
                <InputField
                  label="Total"
                  type="number"
                  value={review.total}
                  onChange={(value) => setReview((current) => (current ? { ...current, total: value } : current))}
                />
                <InputField
                  label="Currency"
                  value={review.currency}
                  onChange={(value) => setReview((current) => (current ? { ...current, currency: value.toUpperCase() } : current))}
                />
                <SelectField
                  label="Workflow Type"
                  value={activeWorkflowChoice}
                  onChange={(value) => {
                    const normalizedWorkflowChoice = normalizeReceiptWorkflowChoice(value);
                    if (!normalizedWorkflowChoice) {
                      return;
                    }
                    applyWorkflowChoice(normalizedWorkflowChoice);
                  }}
                  disabled={requisitionContextLocked}
                  options={[
                    { value: "PROJECT_PURCHASE", label: "Project Purchase" },
                    { value: "MAINTENANCE_PURCHASE", label: "Maintenance Purchase" },
                    { value: "STOCK_PURCHASE", label: "Stock Purchase (Inventory)" },
                    { value: "INTERNAL_TRANSFER", label: "Internal Transfer" }
                  ]}
                />
                <SelectField
                  label={
                    activeWorkflowChoice === "PROJECT_PURCHASE"
                      ? "Client Context"
                      : "Link Client"
                  }
                  value={review.clientId}
                  onChange={(value) =>
                    setReview((current) =>
                      current
                        ? {
                            ...current,
                            clientId: value,
                            projectId:
                              value &&
                              current.projectId &&
                              !projects.some((project) => project.id === current.projectId && project.clientId === value)
                                ? ""
                                : current.projectId
                          }
                        : current
                    )
                  }
                  disabled={
                    requisitionContextLocked ||
                    activeWorkflowChoice === "STOCK_PURCHASE" ||
                    activeWorkflowChoice === "INTERNAL_TRANSFER"
                  }
                  options={[
                    { value: "", label: "No client" },
                    ...clients.map((client) => ({ value: client.id, label: client.name }))
                  ]}
                />
                <SelectField
                  label="Link Project"
                  value={review.projectId}
                  onChange={(value) => setReview((current) => (current ? { ...current, projectId: value } : current))}
                  disabled={
                    requisitionContextLocked ||
                    review.requisitionType === "INVENTORY_STOCK_UP" ||
                    activeWorkflowChoice === "STOCK_PURCHASE" ||
                    activeWorkflowChoice === "INTERNAL_TRANSFER"
                  }
                  options={[
                    {
                      value: "",
                      label:
                        review.requisitionType === "INVENTORY_STOCK_UP" ||
                        activeWorkflowChoice === "STOCK_PURCHASE" ||
                        activeWorkflowChoice === "INTERNAL_TRANSFER"
                          ? "Project not required for this workflow"
                          : "Select project (required)"
                    },
                    ...filteredProjects.map((project) => ({ value: project.id, label: project.name }))
                  ]}
                />
                <SelectField
                  label={
                    activeWorkflowChoice === "PROJECT_PURCHASE"
                      ? "Rig Context"
                      : "Link Rig"
                  }
                  value={review.rigId}
                  onChange={(value) => setReview((current) => (current ? { ...current, rigId: value } : current))}
                  disabled={
                    requisitionContextLocked ||
                    activeWorkflowChoice === "STOCK_PURCHASE" ||
                    activeWorkflowChoice === "INTERNAL_TRANSFER"
                  }
                  options={[
                    {
                      value: "",
                      label:
                        activeWorkflowChoice === "MAINTENANCE_PURCHASE"
                          ? "Select rig (required)"
                          : activeWorkflowChoice === "PROJECT_PURCHASE"
                            ? "No rig context"
                            : "No rig"
                    },
                    ...rigs.map((rig) => ({ value: rig.id, label: rig.rigCode }))
                  ]}
                />
                {activeWorkflowChoice === "MAINTENANCE_PURCHASE" && (
                  <SelectField
                    label="Maintenance Request (optional)"
                    value={review.maintenanceRequestId}
                    onChange={(value) =>
                      setReview((current) => (current ? { ...current, maintenanceRequestId: value } : current))
                    }
                    disabled={requisitionContextLocked}
                    options={[
                      { value: "", label: "No maintenance request selected" },
                      ...maintenanceRequests.map((request) => ({
                        value: request.id,
                        label: request.requestCode
                      }))
                    ]}
                  />
                )}
                {review.receiptClassification === "EXPENSE_ONLY" && (
                  <SelectField
                    label="Expense Category"
                    value={review.expenseOnlyCategory}
                    onChange={(value) =>
                      setReview((current) =>
                        current ? { ...current, expenseOnlyCategory: resolveExpenseOnlyCategory(value) || "" } : current
                      )
                    }
                    options={[
                      { value: "", label: "Select category" },
                      { value: "TRAVEL", label: "Travel" },
                      { value: "FOOD", label: "Food" },
                      { value: "FUEL", label: "Fuel" },
                      { value: "MISC", label: "Misc" }
                    ]}
                  />
                )}
                {activeWorkflowChoice === "INTERNAL_TRANSFER" && (
                  <SelectField
                    label="From Location"
                    value={review.locationFromId}
                    onChange={(value) => setReview((current) => (current ? { ...current, locationFromId: value } : current))}
                    options={[
                      { value: "", label: "Select source location" },
                      ...locations.map((location) => ({ value: location.id, label: location.name }))
                    ]}
                  />
                )}
                <SelectField
                  label={activeWorkflowChoice === "INTERNAL_TRANSFER" ? "To Location" : "Stock Location"}
                  value={review.locationToId}
                  onChange={(value) => setReview((current) => (current ? { ...current, locationToId: value } : current))}
                  options={[
                    {
                      value: "",
                      label:
                        activeWorkflowChoice === "INTERNAL_TRANSFER"
                          ? "Select destination location"
                          : "No location"
                    },
                    ...locations.map((location) => ({ value: location.id, label: location.name }))
                  ]}
                />
              </div>
              {requiresAllocation && allocationPreview !== "ALLOCATED" && (
                <p className="mt-1.5 rounded border border-amber-200/80 bg-amber-50/60 px-2 py-1 text-xs text-amber-900">
                  Project/client link is incomplete. You can finalize now and complete linkage later.
                </p>
              )}
              {review.requisitionType === "INVENTORY_STOCK_UP" && (
                <p className="mt-1.5 rounded border border-sky-200/80 bg-sky-50/55 px-2 py-1 text-xs text-sky-900">
                  Stock-up requisition linked. Posting as inventory replenishment.
                </p>
              )}
            </div>

            {showDeveloperDebugUi && (
              <>
                <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                  <button
                    type="button"
                    onClick={() => setShowTechnicalDetails((current) => !current)}
                    className="flex w-full items-center justify-between text-left text-xs font-semibold uppercase tracking-wide text-slate-600"
                  >
                      <span>{showTechnicalDetails ? "Hide debug details" : "Show debug details"}</span>
                    <span>{showTechnicalDetails ? "▾" : "▸"}</span>
                  </button>
                  {showTechnicalDetails && (
                    <div className="mt-2 space-y-3">
                      {review.warnings.length > 0 && (
                        <div className="space-y-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
                          {review.warnings.map((warning) => (
                            <p key={warning}>• {calmMessage(warning)}</p>
                          ))}
                        </div>
                      )}

                      <div className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-900">
                        <p className="font-semibold uppercase tracking-wide text-sky-700">Scan Diagnostics</p>
                        <div className="mt-2 grid gap-1 sm:grid-cols-2">
                          <p>
                            Stage:{" "}
                            <span className="font-medium">
                              {formatScanFailureStage(review.scanDiagnostics.failureStage)}
                            </span>
                          </p>
                          <p>
                            Content type:{" "}
                            <span className="font-medium">
                              {formatQrContentType(review.scanDiagnostics.qrContentType)}
                            </span>
                          </p>
                          <p>
                            QR detected:{" "}
                            <span className="font-medium">{review.scanDiagnostics.qrDetected ? "Yes" : "No"}</span>
                          </p>
                          <p>
                            Decode:{" "}
                            <span className="font-medium">
                              {formatQrDecodeStatus(review.scanDiagnostics.qrDecodeStatus)}
                              {review.scanDiagnostics.qrDecodePass
                                ? ` (${review.scanDiagnostics.qrDecodePass})`
                                : ""}
                            </span>
                          </p>
                          <p>
                            Parse:{" "}
                            <span className="font-medium">
                              {formatQrParseStatus(review.scanDiagnostics.qrParseStatus)}
                            </span>
                          </p>
                          <p>
                            Lookup:{" "}
                            <span className="font-medium">
                              {formatQrLookupStatus(review.scanDiagnostics.qrLookupStatus)}
                            </span>
                          </p>
                          <p>
                            OCR fallback:{" "}
                            <span className="font-medium">
                              {review.scanDiagnostics.ocrAttempted
                                ? review.scanDiagnostics.ocrSucceeded
                                  ? "Attempted and succeeded"
                                  : "Attempted with limited results"
                                : "Not attempted"}
                            </span>
                          </p>
                          <p>
                            Parsed fields:{" "}
                            <span className="font-medium">{review.scanDiagnostics.qrParsedFieldCount}</span>
                          </p>
                          <p>
                            Parsed lines:{" "}
                            <span className="font-medium">{review.scanDiagnostics.qrParsedLineItemsCount}</span>
                          </p>
                        </div>
                        <p className="mt-2 text-[11px] text-sky-800">{review.scanDiagnostics.failureMessage}</p>
                        {review.scanDiagnostics.qrLookupReason && (
                          <p className="mt-1 text-[11px] text-sky-800">
                            Lookup reason: {review.scanDiagnostics.qrLookupReason}
                          </p>
                        )}
                        {review.scanDiagnostics.ocrError && (
                          <p className="mt-1 text-[11px] text-sky-800">OCR note: {review.scanDiagnostics.ocrError}</p>
                        )}
                        {review.scanDiagnostics.qrVerificationUrl && (
                          <p className="mt-2">
                            Verification Link:{" "}
                            <a
                              href={review.scanDiagnostics.qrVerificationUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="font-medium text-sky-800 underline"
                            >
                              Open verification URL
                            </a>
                          </p>
                        )}
                        {(review.scanDiagnostics.qrRawValue || review.scanDiagnostics.qrNormalizedRawValue) && (
                          <details className="mt-2 rounded border border-sky-300 bg-white/70 px-2 py-1.5">
                            <summary className="cursor-pointer text-[11px] font-semibold text-sky-800">
                              View raw scanned QR details
                            </summary>
                            <div className="mt-2 space-y-2 text-[11px] text-slate-800">
                              <p>
                                Raw length:{" "}
                                <span className="font-medium">{review.scanDiagnostics.qrRawValue.length}</span>
                              </p>
                              <p>
                                Normalized length:{" "}
                                <span className="font-medium">{review.scanDiagnostics.qrNormalizedRawValue.length}</span>
                              </p>
                              <div>
                                <p className="font-semibold text-slate-700">Raw payload</p>
                                <pre className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap rounded border border-slate-200 bg-slate-50 p-2">
                                  {review.scanDiagnostics.qrRawValue || "(empty)"}
                                </pre>
                              </div>
                              <div>
                                <p className="font-semibold text-slate-700">Normalized payload</p>
                                <pre className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap rounded border border-slate-200 bg-slate-50 p-2">
                                  {review.scanDiagnostics.qrNormalizedRawValue || "(empty)"}
                                </pre>
                              </div>
                              {review.scanDiagnostics.attemptedPassCount > 0 && (
                                <div>
                                  <p className="font-semibold text-slate-700">
                                    Decode attempts: {review.scanDiagnostics.attemptedPassCount}
                                  </p>
                                  <p className="mt-1 text-slate-600">
                                    {review.scanDiagnostics.attemptedPassSample.join(", ")}
                                  </p>
                                </div>
                              )}
                            </div>
                          </details>
                        )}
                      </div>

                      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
                        <InputField
                          label="TIN"
                          value={review.tin}
                          onChange={(value) => setReview((current) => (current ? { ...current, tin: value } : current))}
                        />
                        <InputField
                          label="VRN"
                          value={review.vrn}
                          onChange={(value) => setReview((current) => (current ? { ...current, vrn: value } : current))}
                        />
                        <InputField
                          label="Serial Number"
                          value={review.serialNumber}
                          onChange={(value) => setReview((current) => (current ? { ...current, serialNumber: value } : current))}
                        />
                        <InputField
                          label="Verification Code"
                          value={review.verificationCode}
                          onChange={(value) => setReview((current) => (current ? { ...current, verificationCode: value } : current))}
                        />
                        <InputField
                          label="Verification URL"
                          value={review.verificationUrl}
                          onChange={(value) => setReview((current) => (current ? { ...current, verificationUrl: value } : current))}
                        />
                        <InputField
                          label="Receipt Time"
                          value={review.receiptTime}
                          onChange={(value) => setReview((current) => (current ? { ...current, receiptTime: value } : current))}
                        />
                        <InputField
                          label="TRA Receipt #"
                          value={review.traReceiptNumber}
                          onChange={(value) => setReview((current) => (current ? { ...current, traReceiptNumber: value } : current))}
                        />
                        <InputField
                          label="Invoice / Ref #"
                          value={review.invoiceReference}
                          onChange={(value) => setReview((current) => (current ? { ...current, invoiceReference: value } : current))}
                        />
                        <InputField
                          label="Payment Method"
                          value={review.paymentMethod}
                          onChange={(value) => setReview((current) => (current ? { ...current, paymentMethod: value } : current))}
                        />
                        <InputField
                          label="Tax Office"
                          value={review.taxOffice}
                          onChange={(value) => setReview((current) => (current ? { ...current, taxOffice: value } : current))}
                        />
                      </div>

                      <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Field Confidence</p>
                        <div className="mt-2 grid gap-1 text-xs text-slate-700 sm:grid-cols-2 xl:grid-cols-4">
                          {receiptFieldLabels.map((entry) => (
                            <div key={entry.key} className="flex items-center justify-between gap-2 rounded border border-slate-100 px-2 py-1">
                              <span>{entry.label}</span>
                              <span className={readabilityBadgeClass(review.fieldConfidence[entry.key])}>
                                {formatReadability(review.fieldConfidence[entry.key])} • {formatFieldSource(review.fieldSource[entry.key])}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {process.env.NODE_ENV !== "production" &&
                  debugMode &&
                  showTechnicalDetails &&
                  review.debugCandidates.length > 0 && (
                  <div className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-indigo-700">OCR Debug (Dev)</p>
                    <div className="mt-2 space-y-1 text-xs text-indigo-900">
                      {review.debugCandidates.map((candidate) => (
                        <p key={candidate.label}>
                          {candidate.label}: score {candidate.score.toFixed(3)}, confidence {candidate.confidence.toFixed(1)}, text{" "}
                          {candidate.textLength} chars
                        </p>
                      ))}
                    </div>
                  </div>
                )}
                  </>
                )}
                  </>
                )}

            {followUpStage === "FINALIZE" && (
              <div className="flex flex-wrap items-center gap-2 border-t border-slate-200/70 pt-2">
                <button
                  type="button"
                  onClick={() => setFollowUpStage("REVIEW")}
                  className="gf-btn-secondary"
                >
                  {showMismatchInventoryHandling ? "Back to inventory" : "Back to items"}
                </button>
                <button
                  type="button"
                  onClick={() => void handleCommit()}
                  disabled={saving}
                  className="gf-btn-primary"
                >
                  {saving
                    ? "Saving..."
                    : !canManage
                      ? "Submit for review"
                      : "Finalize posting"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setReview(null);
                    resetScanSessionState();
                    setFollowUpStage("SCAN");
                  }}
                  className="gf-btn-secondary"
                >
                  Start over
                </button>
              </div>
            )}
              </>
            )}
          </div>
        )}
        {focusedOverlayMounted && (
          <div
            className={`fixed inset-0 z-[90] flex transition-opacity duration-200 ease-out ${
              focusedOverlayVisible ? "opacity-100" : "pointer-events-none opacity-0"
            }`}
          >
            <button
              type="button"
              onClick={closeFocusedRecordOverlay}
              className={`flex-1 bg-slate-900/35 backdrop-blur-[2px] transition-opacity duration-200 ${
                focusedOverlayVisible ? "opacity-100" : "opacity-0"
              }`}
              aria-label="Close focused record detail"
            />
            <aside
              className={`h-full w-full max-w-3xl overflow-y-auto border-l border-slate-200 bg-white shadow-[0_18px_42px_rgba(15,23,42,0.22)] transition-transform duration-200 ease-out ${
                focusedOverlayVisible ? "translate-x-0" : "translate-x-3"
              }`}
            >
              <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3">
                <div>
                  <p className="text-sm font-semibold text-ink-900">
                    {focusedRecordPayload?.record.label || "Linked Record Detail"}
                  </p>
                  <p className="text-xs text-slate-600">
                    Focused full-view detail
                  </p>
                </div>
                <button
                  type="button"
                  onClick={closeFocusedRecordOverlay}
                  className="rounded border border-slate-300 bg-white px-2 py-1 text-xs text-ink-700 hover:bg-slate-100"
                >
                  Close
                </button>
              </div>
              <div className="space-y-3 p-4 text-sm">
                {focusedRecordLoading && <p className="text-ink-600">Loading linked record details...</p>}
                {focusedRecordError && (
                  <p className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-amber-900">{focusedRecordError}</p>
                )}
                {focusedRecordPayload && (
                  <>
                    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                      <p><span className="font-semibold">Record type:</span> {formatLinkedRecordType(focusedRecordPayload.record.type)}</p>
                      <p><span className="font-semibold">Record ID:</span> {focusedRecordPayload.record.id}</p>
                      <p><span className="font-semibold">Receipt Purpose:</span> {extractReceiptPurposeFromDetails(focusedRecordPayload.details)}</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <a
                        href={focusedRecordPayload.record.url}
                        className="rounded border border-brand-300 bg-brand-50 px-3 py-1.5 text-xs font-semibold text-brand-800 hover:bg-brand-100"
                      >
                        Open in module
                      </a>
                      {focusedRecordPayload.record.type === "EXPENSE" && (
                        <a
                          href={`/expenses?expenseId=${focusedRecordPayload.record.id}`}
                          className="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs text-ink-700 hover:bg-slate-100"
                        >
                          Edit expense
                        </a>
                      )}
                    </div>
                    <RecordSummaryGrid details={focusedRecordPayload.details} />
                    <RecordLinkedRows details={focusedRecordPayload.details} />
                  </>
                )}
              </div>
            </aside>
          </div>
        )}
      </div>
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


const receiptFieldLabels: Array<{ key: keyof ReviewState["fieldConfidence"]; label: string }> = [
  { key: "supplierName", label: "Supplier" },
  { key: "tin", label: "TIN" },
  { key: "vrn", label: "VRN" },
  { key: "serialNumber", label: "Serial" },
  { key: "receiptNumber", label: "Receipt #" },
  { key: "verificationCode", label: "Verify Code" },
  { key: "receiptDate", label: "Date" },
  { key: "receiptTime", label: "Time" },
  { key: "subtotal", label: "Subtotal" },
  { key: "tax", label: "Tax" },
  { key: "total", label: "Total" },
  { key: "paymentMethod", label: "Payment" },
  { key: "taxOffice", label: "Tax Office" },
  { key: "itemCount", label: "Item Count" }
];
