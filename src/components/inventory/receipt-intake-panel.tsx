"use client";

import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import Link from "next/link";

import { Card } from "@/components/ui/card";
import { inventoryCategoryOptions, formatInventoryCategory } from "@/lib/inventory";
import { formatCurrency } from "@/lib/utils";

type FieldConfidence = "HIGH" | "MEDIUM" | "LOW" | "NONE";
type ReadabilityConfidence = "HIGH" | "MEDIUM" | "LOW" | "UNREADABLE";
type ReceiptScanStatus = "COMPLETE" | "PARTIAL" | "UNREADABLE";
type ReceiptType = "INVENTORY_PURCHASE" | "GENERAL_EXPENSE" | "UNCLEAR";
type ExpenseOnlyCategory = "TRAVEL" | "FOOD" | "FUEL" | "MISC";
type QrContentType = "TRA_URL" | "URL" | "STRUCTURED_TEXT" | "UNKNOWN" | "NONE";
type QrDecodeStatus = "DECODED" | "NOT_DETECTED" | "DECODE_FAILED";
type QrParseStatus = "PARSED" | "PARTIAL" | "UNPARSED";
type QrLookupStatus = "NOT_ATTEMPTED" | "SUCCESS" | "FAILED";
type QrParseDetailStatus = "NOT_ATTEMPTED" | "SUCCESS" | "PARTIAL" | "FAILED";

interface ReceiptIntakePanelProps {
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
  activeSubmission?: {
    id: string;
    status: "SUBMITTED" | "APPROVED" | "REJECTED";
    draft: {
      receiptType?:
        | "INVENTORY_PURCHASE"
        | "MAINTENANCE_LINKED_PURCHASE"
        | "EXPENSE_ONLY"
        | "INTERNAL_TRANSFER";
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
  renderCard?: boolean;
  onCompleted: () => Promise<void> | void;
}

interface ReviewLineState {
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

interface ReviewState {
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
  lines: ReviewLineState[];
}

type ExtractState = "IDLE" | "UPLOADING" | "PROCESSING" | "SUCCESS" | "FAILED";
type NoticeTone = "SUCCESS" | "WARNING";
type WorkflowStage =
  | "READY_TO_SCAN"
  | "CAPTURING"
  | "CAPTURED_QR_TRA"
  | "REVIEW_RECOMMENDED"
  | "READY_TO_SAVE"
  | "SAVED_SUCCESSFULLY";

type ReceiptPurpose =
  | "INVENTORY_PURCHASE"
  | "BUSINESS_EXPENSE_ONLY"
  | "INVENTORY_AND_EXPENSE"
  | "EVIDENCE_ONLY"
  | "OTHER_MANUAL";

type ReceiptClassification =
  | "INVENTORY_PURCHASE"
  | "MAINTENANCE_LINKED_PURCHASE"
  | "EXPENSE_ONLY"
  | "INTERNAL_TRANSFER";

interface QrCropSelection {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface SaveReadiness {
  ready: boolean;
  reasons: string[];
}

type LinkedRecordType = "RECEIPT_INTAKE" | "INVENTORY_ITEM" | "STOCK_MOVEMENT" | "EXPENSE";

interface FocusedLinkedRecord {
  id: string;
  label: string;
  type: LinkedRecordType;
  url: string;
}

interface FocusedRecordPayload {
  record: FocusedLinkedRecord;
  details: Record<string, unknown>;
}

type IntakeAllocationStatus = "ALLOCATED" | "PARTIALLY_ALLOCATED" | "UNALLOCATED";

interface DuplicatePromptState {
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
  activeSubmission = null,
  renderCard = true,
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
  const [receiptClassification, setReceiptClassification] = useState<ReceiptClassification | "">("");
  const [duplicateOverrideConfirmed, setDuplicateOverrideConfirmed] = useState(false);
  const [manualQrAssistEnabled, setManualQrAssistEnabled] = useState(false);
  const [qrAssistSelection, setQrAssistSelection] = useState<QrCropSelection | null>(null);
  const [drawingQrSelection, setDrawingQrSelection] = useState(false);
  const qrPreviewContainerRef = useRef<HTMLDivElement | null>(null);
  const qrSelectionStartRef = useRef<{ x: number; y: number } | null>(null);
  const extracting = extractState === "UPLOADING" || extractState === "PROCESSING";
  const canPreviewReceiptImage = Boolean(
    receiptPreviewUrl && receiptFile?.type.toLowerCase().startsWith("image/")
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
      defaultRigId
    });
    setReview(hydrated);
    setReceiptClassification(hydrated.receiptClassification);
    setActiveSubmissionId(activeSubmission.id);
    setNoticeTone("WARNING");
    setNotice(
      `Loaded submission ${activeSubmission.id.slice(-8)} for manager review. Edit if needed, then finalize posting.`
    );
    setError(null);
    setDuplicatePrompt(null);
    setShowDuplicateReview(false);
  }, [activeSubmission, defaultClientId, defaultRigId]);

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

  const saveReadiness = useMemo(() => {
    if (!review) {
      return null;
    }
    return evaluateSaveReadiness(review);
  }, [review]);
  const autoSaveReadiness = useMemo(() => {
    if (!review) {
      return null;
    }
    return evaluateAutoSaveEligibility(review);
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
  const manualFieldHints = useMemo(() => {
    if (!review) {
      return [];
    }
    return deriveManualFieldHints(review);
  }, [review]);

  const workflowStage = resolveWorkflowStage({
    extractState,
    saving,
    notice,
    review,
    saveReadiness
  });

  function closeFocusedRecordOverlay() {
    setFocusedRecordPayload(null);
    setFocusedRecordError(null);
    setFocusedRecordLoading(false);
  }

  function handleReceiptFileChange(file: File | null) {
    if (receiptPreviewUrl) {
      URL.revokeObjectURL(receiptPreviewUrl);
    }
    setReceiptFile(file);
    setReceiptPreviewUrl(file ? URL.createObjectURL(file) : "");
    setExtractState("IDLE");
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

  async function handleExtract() {
    if (!receiptFile) {
      setError("Please choose a receipt image or PDF first.");
      setExtractState("FAILED");
      return;
    }
    if (!receiptClassification) {
      setError("Select a receipt type before scanning.");
      setExtractState("FAILED");
      return;
    }

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
          receiptClassification
        });
        setReview(nextReview);
        const intakeMessage = calmMessage(
          payload.message ||
            (nextReview.scanStatus === "COMPLETE"
              ? "Captured from QR/TRA. Review and save."
              : "Some fields still need review.")
        );
        const autoSaveReadiness = evaluateAutoSaveEligibility(nextReview);
        if (canManage && autoSaveEnabled && autoSaveReadiness.ready) {
          setNoticeTone("SUCCESS");
          setNotice("Captured from QR/TRA. Finalizing automatically...");
        } else if (canManage && autoSaveEnabled && !autoSaveReadiness.ready) {
          setNoticeTone("WARNING");
          setNotice(
            `Review recommended before save. ${autoSaveReadiness.reasons[0] || "Some optional fields need confirmation."}`
          );
        } else {
          setNoticeTone(nextReview.scanStatus === "COMPLETE" ? "SUCCESS" : "WARNING");
          setNotice(intakeMessage);
        }
        setExtractState("SUCCESS");
        if (canManage && autoSaveEnabled && autoSaveReadiness.ready) {
          await commitReview(nextReview, { auto: true });
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
            ? readPayloadMessage(payload, "Some fields need review. You can continue manually.")
            : readApiError(response, payload, "Some fields need review. You can continue manually."),
        receiptClassification
      });
      setReview(fallbackReview);
      setNoticeTone("WARNING");
      setNotice("Review recommended. You can continue manually with the captured receipt.");
      setError(null);
      setExtractState("FAILED");
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
            : "Some fields need review. You can continue manually."),
        receiptClassification
      });
      setReview(fallbackReview);
      setNoticeTone("WARNING");
      setNotice("Review recommended. You can continue manually with the captured receipt.");
      setError(null);
      setExtractState("FAILED");
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
      if (submissionStatus === "PENDING_REVIEW") {
        setNoticeTone("SUCCESS");
        setNotice(
          submissionReference
            ? `Submitted for review (${submissionReference.slice(-8)}). A manager/admin will verify and finalize posting.`
            : "Submitted for review. A manager/admin will verify and finalize posting."
        );
        setLastSavedAllocationStatus(normalizeAllocationStatus(payload?.data?.allocationStatus));
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

      if (process.env.NODE_ENV !== "production") {
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
            `${allocationMessage || "Saved successfully as Unallocated"} ${movementCount} stock-in movement(s) created (${formatCurrency(totalValue)}). You can assign project/client later.`
          );
        } else if (allocationStatus === "PARTIALLY_ALLOCATED") {
          setNoticeTone("WARNING");
          setNotice(
            `${allocationMessage || "Saved as Partially allocated"} ${movementCount} stock-in movement(s) created (${formatCurrency(totalValue)}).`
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

  function addManualLine() {
    setReview((current) => {
      if (!current) {
        return current;
      }
      return {
        ...current,
        lines: [
          ...current.lines,
          {
            id: `manual-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            description: "New receipt line item",
            quantity: "1",
            unitPrice: "0",
            lineTotal: "0",
            extractionConfidence: "LOW",
            selectedCategory: "OTHER",
            suggestedCategory: null,
            categoryReason: "Manual line",
            mode:
              current.receiptClassification === "EXPENSE_ONLY"
                ? "EXPENSE_ONLY"
                : current.receiptClassification === "INTERNAL_TRANSFER"
                  ? "MATCH"
                  : "NEW",
            selectedItemId: "",
            matchConfidence: "NONE",
            matchScore: 0,
            newItemName: "New receipt line item",
            newItemSku: "",
            newItemMinimumStockLevel: "0"
          }
        ]
      };
    });
  }

  function removeLine(lineId: string) {
    setReview((current) => {
      if (!current) {
        return current;
      }
      return {
        ...current,
        lines: current.lines.filter((line) => line.id !== lineId)
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

        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Receipt Intake Status</p>
            <span className={workflowBadgeClass(workflowStage)}>
              {formatWorkflowStage(workflowStage)}
            </span>
          </div>
          <p className="mt-1 text-xs text-slate-600">
            {workflowHelpText(workflowStage)}
          </p>
          {lastSavedAllocationStatus && lastSavedAllocationStatus !== "ALLOCATED" && (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-amber-900">
              <span className="rounded-full border border-amber-300 bg-amber-100 px-2 py-0.5 font-semibold">
                Needs allocation
              </span>
              <span>
                Saved as {formatAllocationStatusLabel(lastSavedAllocationStatus)}. Project/client can be assigned later.
              </span>
              <Link href="/inventory" className="rounded border border-amber-400 bg-white px-2 py-1 font-semibold hover:bg-amber-100">
                Open inventory
              </Link>
            </div>
          )}
        </div>

        <div className="grid gap-2 rounded-lg border border-slate-200 bg-white p-3 text-xs sm:grid-cols-3">
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5">
            <p className="font-semibold text-slate-800">Step 1</p>
            <p className="text-slate-600">Classify and scan receipt</p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5">
            <p className="font-semibold text-slate-800">Step 2</p>
            <p className="text-slate-600">Review extracted fields and line items</p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5">
            <p className="font-semibold text-slate-800">Step 3</p>
            <p className="text-slate-600">Complete links and submit/finalize</p>
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Step 1 — What type of receipt is this?</p>
          <p className="mt-1 text-xs text-slate-600">
            Select the business flow before scanning so posting and review rules apply correctly.
          </p>
          <div className="mt-2 grid gap-2 md:grid-cols-2">
            <button
              type="button"
              onClick={() => setReceiptClassification("INVENTORY_PURCHASE")}
              className={`rounded-lg border px-3 py-2 text-sm font-semibold ${
                receiptClassification === "INVENTORY_PURCHASE"
                  ? "border-brand-300 bg-brand-50 text-brand-800"
                  : "border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
              }`}
            >
              Inventory purchase (stock)
            </button>
            <button
              type="button"
              onClick={() => setReceiptClassification("MAINTENANCE_LINKED_PURCHASE")}
              className={`rounded-lg border px-3 py-2 text-sm font-semibold ${
                receiptClassification === "MAINTENANCE_LINKED_PURCHASE"
                  ? "border-brand-300 bg-brand-50 text-brand-800"
                  : "border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
              }`}
            >
              Maintenance-linked purchase
            </button>
            <button
              type="button"
              onClick={() => setReceiptClassification("EXPENSE_ONLY")}
              className={`rounded-lg border px-3 py-2 text-sm font-semibold ${
                receiptClassification === "EXPENSE_ONLY"
                  ? "border-brand-300 bg-brand-50 text-brand-800"
                  : "border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
              }`}
            >
              Expense only (non-inventory)
            </button>
            <button
              type="button"
              onClick={() => setReceiptClassification("INTERNAL_TRANSFER")}
              className={`rounded-lg border px-3 py-2 text-sm font-semibold ${
                receiptClassification === "INTERNAL_TRANSFER"
                  ? "border-brand-300 bg-brand-50 text-brand-800"
                  : "border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
              }`}
            >
              Internal transfer
            </button>
          </div>
        </div>

        <div className="grid gap-3 lg:grid-cols-[1fr_auto] lg:items-end">
          <label className="text-xs text-ink-700">
            <span className="mb-1 block uppercase tracking-wide text-slate-500">Receipt File (Image or PDF)</span>
            <input
              type="file"
              accept="image/*,.pdf"
              capture="environment"
              onChange={(event) =>
                handleReceiptFileChange(
                  event.target.files && event.target.files.length > 0 ? event.target.files[0] : null
                )
              }
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
          </label>
          <button
            type="button"
            onClick={() => void handleExtract()}
            disabled={!receiptFile || extracting || !receiptClassification}
            className="gf-btn-primary"
          >
            {extractState === "UPLOADING"
              ? "Capturing..."
              : extractState === "PROCESSING"
                ? "Reading..."
                : "Scan Receipt"}
          </button>
        </div>

        {canManage ? (
          <>
            <label className="inline-flex items-center gap-2 text-xs text-slate-700">
              <input
                type="checkbox"
                checked={autoSaveEnabled}
                onChange={(event) => setAutoSaveEnabled(event.target.checked)}
              />
              Auto Save when confidence is high
            </label>
            <p className="text-xs text-slate-600">
              Scan works in assist mode: we prefill captured fields, keep review available, and only auto-finalize when confidence thresholds are met.
            </p>
          </>
        ) : (
          <p className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-900">
            Your role can scan and submit receipts. Submissions are saved as pending review and are not posted to stock/accounting until approved by manager/admin.
          </p>
        )}
        <details className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
          <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-slate-600">
            Optional scan helpers (QR assist + debug)
          </summary>
          <div className="mt-2 space-y-2">
            <label className="inline-flex items-center gap-2 text-xs text-slate-700">
              <input
                type="checkbox"
                checked={manualQrAssistEnabled}
                onChange={(event) => {
                  setManualQrAssistEnabled(event.target.checked);
                  if (!event.target.checked) {
                    setQrAssistSelection(null);
                    setDrawingQrSelection(false);
                    qrSelectionStartRef.current = null;
                  }
                }}
              />
              Manual QR assist: select the QR area and retry scan if automatic detection misses it.
            </label>

            {manualQrAssistEnabled && receiptFile && !canPreviewReceiptImage && (
              <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                Manual QR selection currently works with receipt images. For PDFs, we still run QR/OCR automatically.
              </p>
            )}

            {manualQrAssistEnabled && canPreviewReceiptImage && (
              <div className="space-y-2 rounded-lg border border-slate-200 bg-white p-3">
                <p className="text-xs text-slate-700">
                  Drag on the receipt preview to mark the QR area. We prioritize this region, then fall back to OCR.
                </p>
                <div
                  ref={qrPreviewContainerRef}
                  onPointerDown={handleQrPointerDown}
                  onPointerMove={handleQrPointerMove}
                  onPointerUp={handleQrPointerUp}
                  onPointerCancel={handleQrPointerUp}
                  className="relative overflow-hidden rounded-lg border border-slate-300 bg-white"
                  style={{ touchAction: "none" }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={receiptPreviewUrl}
                    alt="Receipt preview"
                    className="max-h-[320px] w-full select-none object-contain"
                    draggable={false}
                  />
                  {qrAssistSelection && (
                    <div
                      className="pointer-events-none absolute border-2 border-brand-500 bg-brand-500/15"
                      style={{
                        left: `${qrAssistSelection.x * 100}%`,
                        top: `${qrAssistSelection.y * 100}%`,
                        width: `${qrAssistSelection.width * 100}%`,
                        height: `${qrAssistSelection.height * 100}%`
                      }}
                    />
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-700">
                  <button
                    type="button"
                    onClick={() => {
                      setQrAssistSelection(null);
                      setDrawingQrSelection(false);
                      qrSelectionStartRef.current = null;
                    }}
                    className="rounded border border-slate-300 bg-white px-2 py-1 text-slate-700 hover:bg-slate-100"
                  >
                    Clear QR Area
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleExtract()}
                    disabled={!receiptFile || !qrAssistSelection || extracting || !receiptClassification}
                    className="rounded border border-brand-300 bg-brand-50 px-2 py-1 font-semibold text-brand-800 hover:bg-brand-100 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Retry With Selected QR Area
                  </button>
                  <span>
                    {qrAssistSelection
                      ? `Selected area: x ${formatPercent(qrAssistSelection.x)}, y ${formatPercent(qrAssistSelection.y)}, w ${formatPercent(qrAssistSelection.width)}, h ${formatPercent(qrAssistSelection.height)}`
                      : "No manual QR area selected yet."}
                  </span>
                </div>
              </div>
            )}

            {process.env.NODE_ENV !== "production" && (
              <label className="inline-flex items-center gap-2 text-xs text-slate-600">
                <input
                  type="checkbox"
                  checked={debugMode}
                  onChange={(event) => setDebugMode(event.target.checked)}
                />
                Include OCR debug candidates (development only)
              </label>
            )}
          </div>
        </details>
        <p className="text-xs text-slate-600">
          QR is checked first for official receipt metadata. OCR is used only for missing fields and line items.
        </p>

        {!review ? null : (
          <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-4">
            {activeSubmissionId && canManage && (
              <div className="rounded-lg border border-brand-300 bg-brand-50 px-3 py-2 text-xs text-brand-900">
                Reviewing submission <span className="font-semibold">{activeSubmissionId.slice(-8)}</span>. Saving will finalize posting.
              </div>
            )}
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Step 2 — Review extracted receipt data</p>
              <p className="mt-1 text-xs text-slate-600">
                We prefill what was captured. Confirm values, then complete any business-context fields that cannot be inferred from the receipt image.
              </p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold text-slate-800">Receipt Review</p>
                <span
                  className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
                    saveReadiness?.ready
                      ? "border-emerald-300 bg-emerald-100 text-emerald-800"
                      : "border-amber-300 bg-amber-100 text-amber-800"
                  }`}
                >
                  {saveReadiness?.ready ? "Ready to save" : "Review recommended"}
                </span>
              </div>
              <div className="mt-1 grid gap-1 text-xs text-slate-700 sm:grid-cols-2 xl:grid-cols-4">
                <p><span className="font-semibold">File:</span> {review.receiptFileName}</p>
                <p><span className="font-semibold">Supplier:</span> {review.supplierName || "-"}</p>
                <p><span className="font-semibold">Receipt #:</span> {review.receiptNumber || "-"}</p>
                <p><span className="font-semibold">Total:</span> {formatMoneyText(review.total, review.currency)}</p>
                <p>
                  <span className="font-semibold">Allocation:</span>{" "}
                  <span
                    className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
                      allocationPreview === "ALLOCATED"
                        ? "border-emerald-300 bg-emerald-100 text-emerald-800"
                        : "border-amber-300 bg-amber-100 text-amber-800"
                    }`}
                  >
                    {formatAllocationStatusLabel(allocationPreview || "UNALLOCATED")}
                  </span>
                  {allocationPreview !== "ALLOCATED" && (
                    <span className="ml-2 text-amber-800">Needs allocation</span>
                  )}
                </p>
              </div>
              <div className="mt-2 rounded border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-700">
                <p>
                  <span className="font-semibold">Auto-filled from scan:</span> supplier, receipt number, date, totals, and verification fields when confidence is sufficient.
                </p>
                <p className="mt-1">
                  <span className="font-semibold">Usually manual:</span> client, project, rig, maintenance linkage, and allocation details.
                </p>
                {manualFieldHints.length > 0 && (
                  <p className="mt-1 text-amber-900">
                    <span className="font-semibold">Still needed:</span> {manualFieldHints.join(", ")}.
                  </p>
                )}
              </div>
              {review.receiptUrl && (
                <a
                  href={review.receiptUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 inline-flex rounded-lg border border-brand-300 bg-brand-50 px-2 py-1 text-xs font-semibold text-brand-800 hover:bg-brand-100"
                >
                  Open Receipt
                </a>
              )}
            </div>

            <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold text-ink-900">Line Items</p>
                <button
                  type="button"
                  onClick={addManualLine}
                  className="rounded border border-slate-300 bg-white px-2 py-1 text-xs text-ink-700 hover:bg-slate-100"
                >
                  Add Line
                </button>
              </div>
              {unmatchedLines.length > 0 && (
                <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                  <p className="font-semibold">Unmatched items need inventory action</p>
                  <div className="mt-1 space-y-1">
                    {unmatchedLines.map((line) => (
                      <p key={`unmatched-${line.id}`}>
                        {line.description} • qty {line.quantity || "0"} • unit {line.unitPrice || "0"} • total{" "}
                        {line.lineTotal || "0"} • category {line.suggestedCategory ? formatInventoryCategory(line.suggestedCategory) : "Other"} • action{" "}
                        {line.mode === "EXPENSE_ONLY" ? "Receipt/expense evidence only" : line.mode === "NEW" ? "Create new item" : "Link to existing item"}
                      </p>
                    ))}
                  </div>
                </div>
              )}
              {review.lines.length === 0 ? (
                <div className="rounded-lg border border-dashed border-slate-300 bg-white px-3 py-4 text-xs text-slate-700">
                  No line items detected automatically yet. Add line items manually or keep this as evidence only.
                </div>
              ) : (
                review.lines.map((line) => (
                  <div
                    key={line.id}
                    className={`space-y-2 rounded-lg border p-3 ${
                      line.extractionConfidence === "LOW" ? "border-amber-300 bg-amber-50" : "border-slate-200 bg-white"
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
                        <span className={readabilityBadgeClass(line.extractionConfidence as ReadabilityConfidence)}>
                          {line.extractionConfidence}
                        </span>
                        <span>Match: {line.matchScore.toFixed(2)}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeLine(line.id)}
                        className="rounded border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-700 hover:bg-red-100"
                      >
                        Remove
                      </button>
                    </div>

                    <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-5">
                      <InputField
                        label="Description"
                        value={line.description}
                        onChange={(value) => updateLine(line.id, { description: value, newItemName: value })}
                      />
                      <InputField
                        label="Quantity"
                        type="number"
                        value={line.quantity}
                        onChange={(value) => updateLine(line.id, { quantity: value })}
                      />
                      <InputField
                        label="Unit Price"
                        type="number"
                        value={line.unitPrice}
                        onChange={(value) => updateLine(line.id, { unitPrice: value })}
                      />
                      <InputField
                        label="Line Total"
                        type="number"
                        value={line.lineTotal}
                        onChange={(value) => updateLine(line.id, { lineTotal: value })}
                      />
                      <SelectField
                        label="Category"
                        value={line.selectedCategory}
                        onChange={(value) => updateLine(line.id, { selectedCategory: value })}
                        options={inventoryCategoryOptions.map((entry) => ({ value: entry.value, label: entry.label }))}
                      />
                    </div>

                    <div className="rounded border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs text-slate-700">
                      Suggested category:{" "}
                      <span className="font-semibold">
                        {line.suggestedCategory ? formatInventoryCategory(line.suggestedCategory) : "No strong match"}
                      </span>
                      . {line.categoryReason}
                      {line.suggestedCategory && line.suggestedCategory !== line.selectedCategory && (
                        <button
                          type="button"
                          onClick={() => updateLine(line.id, { selectedCategory: line.suggestedCategory || line.selectedCategory })}
                          className="ml-2 rounded border border-brand-300 bg-brand-50 px-2 py-0.5 text-[11px] text-brand-800 hover:bg-brand-100"
                        >
                          Use suggested
                        </button>
                      )}
                    </div>

                    <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                      <SelectField
                        label="Inventory Action"
                        value={line.mode}
                        onChange={(value) =>
                          updateLine(line.id, {
                            mode:
                              review.receiptClassification === "EXPENSE_ONLY"
                                ? "EXPENSE_ONLY"
                                : review.receiptClassification === "INTERNAL_TRANSFER"
                                  ? "MATCH"
                                  : value === "NEW"
                                    ? "NEW"
                                    : value === "EXPENSE_ONLY"
                                      ? "EXPENSE_ONLY"
                                      : "MATCH",
                            selectedItemId:
                              review.receiptClassification === "INTERNAL_TRANSFER" || value === "MATCH"
                                ? line.selectedItemId
                                : ""
                          })
                        }
                        options={
                          review.receiptClassification === "EXPENSE_ONLY"
                            ? [{ value: "EXPENSE_ONLY", label: "Expense evidence only (no stock item)" }]
                            : review.receiptClassification === "INTERNAL_TRANSFER"
                              ? [{ value: "MATCH", label: "Match existing item (required for transfer)" }]
                              : [
                                  { value: "MATCH", label: "Match existing item" },
                                  { value: "NEW", label: "Create new item" },
                                  { value: "EXPENSE_ONLY", label: "Expense evidence only (no stock item)" }
                                ]
                        }
                      />
                      {line.mode === "MATCH" ? (
                        <>
                          <SelectField
                            label="Matched Inventory Item"
                            value={line.selectedItemId}
                            onChange={(value) => updateLine(line.id, { selectedItemId: value })}
                            options={[
                              { value: "", label: "No match selected" },
                              ...items.map((item) => ({
                                value: item.id,
                                label: `${item.name} (${item.sku})`
                              }))
                            ]}
                          />
                          {!line.selectedItemId && (
                            <div className="col-span-full rounded border border-amber-300 bg-amber-50 px-2 py-1.5 text-xs text-amber-900">
                              {review.receiptClassification === "INTERNAL_TRANSFER"
                                ? "Select an existing item. Internal transfers can only move stock for existing inventory items."
                                : "No existing item selected. This line will be auto-created as a new inventory item when you save."}
                            </div>
                          )}
                        </>
                      ) : line.mode === "NEW" ? (
                        <>
                          <InputField
                            label="New Item Name"
                            value={line.newItemName}
                            onChange={(value) => updateLine(line.id, { newItemName: value })}
                          />
                          <InputField
                            label="New Item SKU (optional)"
                            value={line.newItemSku}
                            onChange={(value) => updateLine(line.id, { newItemSku: value.toUpperCase() })}
                          />
                          <InputField
                            label="Min Stock"
                            type="number"
                            value={line.newItemMinimumStockLevel}
                            onChange={(value) => updateLine(line.id, { newItemMinimumStockLevel: value })}
                          />
                        </>
                      ) : (
                        <div className="col-span-full rounded border border-amber-300 bg-amber-50 px-2 py-1.5 text-xs text-amber-900">
                          This line will be kept as receipt/expense evidence only. No inventory item or stock movement will be created.
                        </div>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Step 3 — Complete business context and submit</p>
              <p className="mt-1 text-xs text-slate-600">
                Confirm allocation and posting intent, then submit for review (staff) or finalize (manager/admin).
              </p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p className="text-sm font-semibold text-slate-800">Receipt Approval Card</p>
              <div className="mt-2 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
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
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
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
                <InputField
                  label="Receipt Number"
                  value={review.receiptNumber}
                  onChange={(value) => setReview((current) => (current ? { ...current, receiptNumber: value } : current))}
                />
                <InputField
                  label="Receipt Date"
                  type="date"
                  value={review.receiptDate}
                  onChange={(value) => setReview((current) => (current ? { ...current, receiptDate: value } : current))}
                />
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
                  label="Receipt Type"
                  value={review.receiptClassification}
                  onChange={(value) =>
                    {
                      const normalized = normalizeReceiptClassification(value);
                      const receiptConfig = resolveReceiptConfig(normalized);
                      setReceiptClassification(normalized);
                      setReview((current) =>
                        current ? applyReceiptClassificationUpdate(current, normalized, receiptConfig) : current
                      );
                    }
                  }
                  options={[
                    { value: "INVENTORY_PURCHASE", label: "Inventory purchase (stock)" },
                    { value: "MAINTENANCE_LINKED_PURCHASE", label: "Maintenance-linked purchase" },
                    { value: "EXPENSE_ONLY", label: "Expense only (non-inventory)" },
                    { value: "INTERNAL_TRANSFER", label: "Internal transfer" }
                  ]}
                />
                <SelectField
                  label="Link Client"
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
                  options={[
                    { value: "", label: "No client" },
                    ...clients.map((client) => ({ value: client.id, label: client.name }))
                  ]}
                />
                <SelectField
                  label="Link Project"
                  value={review.projectId}
                  onChange={(value) => setReview((current) => (current ? { ...current, projectId: value } : current))}
                  options={[
                    { value: "", label: "No project" },
                    ...filteredProjects.map((project) => ({ value: project.id, label: project.name }))
                  ]}
                />
                <SelectField
                  label="Link Rig"
                  value={review.rigId}
                  onChange={(value) => setReview((current) => (current ? { ...current, rigId: value } : current))}
                  options={[
                    { value: "", label: "No rig" },
                    ...rigs.map((rig) => ({ value: rig.id, label: rig.rigCode }))
                  ]}
                />
                {review.receiptClassification === "MAINTENANCE_LINKED_PURCHASE" && (
                  <SelectField
                    label="Maintenance Request"
                    value={review.maintenanceRequestId}
                    onChange={(value) =>
                      setReview((current) => (current ? { ...current, maintenanceRequestId: value } : current))
                    }
                    options={[
                      { value: "", label: "Select maintenance request" },
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
                {review.receiptClassification === "INTERNAL_TRANSFER" && (
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
                  label={review.receiptClassification === "INTERNAL_TRANSFER" ? "To Location" : "Stock Location"}
                  value={review.locationToId}
                  onChange={(value) => setReview((current) => (current ? { ...current, locationToId: value } : current))}
                  options={[
                    {
                      value: "",
                      label:
                        review.receiptClassification === "INTERNAL_TRANSFER"
                          ? "Select destination location"
                          : "No location"
                    },
                    ...locations.map((location) => ({ value: location.id, label: location.name }))
                  ]}
                />
              </div>
              <p className="mt-2 text-xs text-slate-700">
                {review.receiptClassification === "MAINTENANCE_LINKED_PURCHASE"
                  ? "Maintenance-linked purchase: stock and expense posting will be tied to the selected maintenance request."
                  : review.receiptClassification === "EXPENSE_ONLY"
                    ? "Expense-only: this will create an expense record and will not create inventory stock movements."
                    : review.receiptClassification === "INTERNAL_TRANSFER"
                      ? "Internal transfer: this creates transfer stock movements only and does not create an expense record."
                      : "Inventory purchase: this will create stock movements and record the purchase expense."}
              </p>
              {allocationPreview !== "ALLOCATED" && (
                <p className="mt-2 rounded border border-amber-300 bg-amber-50 px-2 py-1.5 text-xs text-amber-900">
                  Needs allocation: project/client are not fully assigned yet. You can save now and update allocation later.
                </p>
              )}
            </div>

            <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
              <button
                type="button"
                onClick={() => setShowTechnicalDetails((current) => !current)}
                className="flex w-full items-center justify-between text-left text-xs font-semibold uppercase tracking-wide text-slate-600"
              >
                <span>{showTechnicalDetails ? "Hide QR & technical details" : "Show QR & technical details"}</span>
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

                  {(review.rawQrValue || review.verificationUrl) && (
                    <div className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-900">
                      <p className="font-semibold uppercase tracking-wide text-sky-700">QR / TRA Details</p>
                      <p className="mt-1">
                        Content Type: <span className="font-medium">{formatQrContentType(review.qrContentType)}</span>
                      </p>
                      <p className="mt-1">
                        Decode:{" "}
                        <span className="font-medium">
                          {formatQrDecodeStatus(review.qrDecodeStatus)}
                          {review.qrDecodePass ? ` (${review.qrDecodePass})` : ""}
                        </span>
                      </p>
                      <p className="mt-1">
                        Parse: <span className="font-medium">{formatQrParseStatus(review.qrParseStatus)}</span>
                      </p>
                      <p className="mt-1">
                        Verification lookup:{" "}
                        <span className="font-medium">{formatQrLookupStatus(review.qrLookupStatus)}</span>
                      </p>
                      {review.verificationUrl && (
                        <p className="mt-1">
                          Verification Link:{" "}
                          <a
                            href={review.verificationUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="font-medium text-sky-800 underline"
                          >
                            Open verification URL
                          </a>
                        </p>
                      )}
                    </div>
                  )}

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

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void handleCommit()}
                disabled={saving}
                className="gf-btn-primary w-full px-6 py-3 text-base sm:w-auto"
              >
                {saving
                  ? "Saving..."
                  : !canManage
                    ? "Submit for Review"
                    : autoSaveEnabled && autoSaveReadiness?.ready
                    ? "Save Automatically"
                    : "Save to Inventory"}
              </button>
              <button
                type="button"
                onClick={() => setReview(null)}
                className="gf-btn-secondary"
              >
                Cancel Review
              </button>
            </div>
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

function InputField({
  label,
  value,
  onChange,
  type = "text"
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
}) {
  return (
    <label className="text-xs text-ink-700">
      <span className="mb-1 block uppercase tracking-wide text-slate-500">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
      />
    </label>
  );
}

function SelectField({
  label,
  value,
  onChange,
  options
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <label className="text-xs text-ink-700">
      <span className="mb-1 block uppercase tracking-wide text-slate-500">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
      >
        {options.map((option) => (
          <option key={`${label}-${option.value}`} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function DuplicateLinksGroup({
  title,
  emptyLabel,
  links,
  buttonLabel,
  onOpen
}: {
  title: string;
  emptyLabel: string;
  links: Array<{ id: string; label: string; type: string; url: string }>;
  buttonLabel: string;
  onOpen: (record: FocusedLinkedRecord) => void;
}) {
  return (
    <div className="rounded border border-slate-200 bg-slate-50 px-2 py-2">
      <p className="font-semibold text-slate-800">{title}</p>
      {links.length === 0 ? (
        <p className="mt-1 text-slate-600">{emptyLabel}</p>
      ) : (
        <div className="mt-2 space-y-1.5">
          {links.map((link) => (
            <div
              key={`${title}-${link.id}`}
              className="flex flex-wrap items-center justify-between gap-2 rounded border border-slate-200 bg-white px-2 py-1.5"
            >
              <span>{link.label}</span>
              <button
                type="button"
                onClick={() =>
                  onOpen({
                    id: link.id,
                    label: link.label,
                    type: normalizeLinkedRecordType(link.type),
                    url: link.url
                  })
                }
                className="rounded border border-slate-300 bg-white px-2 py-1 font-semibold text-slate-800 hover:bg-slate-100"
              >
                {buttonLabel}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function normalizeLinkedRecordType(value: string): LinkedRecordType {
  if (
    value === "INVENTORY_ITEM" ||
    value === "STOCK_MOVEMENT" ||
    value === "EXPENSE" ||
    value === "RECEIPT_INTAKE"
  ) {
    return value;
  }
  return "RECEIPT_INTAKE";
}

function normalizeLinkedRecordUrl(url: string, type: LinkedRecordType, id: string) {
  const trimmed = typeof url === "string" ? url.trim() : "";
  if (trimmed.startsWith("/inventory?section=items")) {
    return `/inventory/items?itemId=${id}`;
  }
  if (trimmed.startsWith("/inventory?section=stock-movements")) {
    return `/inventory/stock-movements?movementId=${id}`;
  }
  if (trimmed.startsWith("/inventory/items") || trimmed.startsWith("/inventory/stock-movements") || trimmed.startsWith("/inventory/receipt-intake")) {
    return trimmed;
  }
  if (trimmed.startsWith("/expenses")) {
    return trimmed;
  }
  if (type === "INVENTORY_ITEM") {
    return `/inventory/items?itemId=${id}`;
  }
  if (type === "EXPENSE") {
    return `/expenses?expenseId=${id}`;
  }
  if (type === "STOCK_MOVEMENT") {
    return `/inventory/stock-movements?movementId=${id}`;
  }
  return `/inventory/receipt-intake?movementId=${id}`;
}

function formatLinkedRecordType(value: LinkedRecordType) {
  if (value === "INVENTORY_ITEM") return "Inventory Item";
  if (value === "STOCK_MOVEMENT") return "Stock Movement";
  if (value === "EXPENSE") return "Expense Record";
  return "Receipt Intake";
}

function normalizeReceiptPurpose(value: string): ReceiptPurpose {
  if (
    value === "INVENTORY_PURCHASE" ||
    value === "BUSINESS_EXPENSE_ONLY" ||
    value === "INVENTORY_AND_EXPENSE" ||
    value === "EVIDENCE_ONLY" ||
    value === "OTHER_MANUAL"
  ) {
    return value;
  }
  return "INVENTORY_PURCHASE";
}

function normalizeReceiptClassification(value: string): ReceiptClassification {
  if (
    value === "INVENTORY_PURCHASE" ||
    value === "MAINTENANCE_LINKED_PURCHASE" ||
    value === "EXPENSE_ONLY" ||
    value === "INTERNAL_TRANSFER"
  ) {
    return value;
  }
  return "INVENTORY_PURCHASE";
}

function formatReceiptPurposeLabel(value: string) {
  const normalized = normalizeReceiptPurpose(value);
  if (normalized === "BUSINESS_EXPENSE_ONLY") return "Business expense only";
  if (normalized === "INVENTORY_AND_EXPENSE") return "Inventory + expense";
  if (normalized === "EVIDENCE_ONLY") return "Evidence only";
  if (normalized === "OTHER_MANUAL") return "Other / manual decision";
  return "Inventory purchase";
}

function resolveCreateExpenseForPurpose(review: ReviewState) {
  if (review.receiptClassification === "INTERNAL_TRANSFER") {
    return false;
  }
  if (review.receiptClassification === "EXPENSE_ONLY") {
    return true;
  }
  if (review.receiptPurpose === "EVIDENCE_ONLY" || review.receiptPurpose === "OTHER_MANUAL") {
    return false;
  }
  return review.createExpense;
}

function resolveExpenseOnlyCategory(value: string): ExpenseOnlyCategory | null {
  if (value === "TRAVEL" || value === "FOOD" || value === "FUEL" || value === "MISC") {
    return value;
  }
  return null;
}

function applyReceiptClassificationUpdate(
  current: ReviewState,
  classification: ReceiptClassification,
  config: { receiptPurpose: ReceiptPurpose; createExpense: boolean }
): ReviewState {
  return {
    ...current,
    receiptClassification: classification,
    receiptPurpose: config.receiptPurpose,
    createExpense: config.createExpense,
    maintenanceRequestId:
      classification === "MAINTENANCE_LINKED_PURCHASE" ? current.maintenanceRequestId : "",
    locationFromId: classification === "INTERNAL_TRANSFER" ? current.locationFromId : "",
    expenseOnlyCategory: classification === "EXPENSE_ONLY" ? current.expenseOnlyCategory : "",
    lines: applyReceiptClassificationLineDefaults(current.lines, classification)
  };
}

function applyReceiptClassificationLineDefaults(
  lines: ReviewLineState[],
  classification: ReceiptClassification
) {
  if (classification === "EXPENSE_ONLY") {
    return lines.map((line) => ({
      ...line,
      mode: "EXPENSE_ONLY" as const,
      selectedItemId: ""
    }));
  }
  if (classification === "INTERNAL_TRANSFER") {
    return lines.map((line) => ({
      ...line,
      mode: "MATCH" as const
    }));
  }
  return lines.map((line) => {
    if (line.mode !== "EXPENSE_ONLY") {
      return line;
    }
    const fallbackMode: ReviewLineState["mode"] = line.selectedItemId ? "MATCH" : "NEW";
    return {
      ...line,
      mode: fallbackMode
    };
  });
}

function extractReceiptPurposeFromDetails(details: Record<string, unknown>) {
  const direct = normalizeReceiptPurpose(asString(details.receiptPurpose));
  if (direct !== "INVENTORY_PURCHASE" || asString(details.receiptPurpose) === "INVENTORY_PURCHASE") {
    return formatReceiptPurposeLabel(direct);
  }
  const notes = asString(details.notes);
  if (notes) {
    const match = notes.match(/ReceiptPurpose=([A-Z_]+)/i);
    if (match?.[1]) {
      return formatReceiptPurposeLabel(match[1]);
    }
  }
  return "-";
}

function RecordSummaryGrid({ details }: { details: Record<string, unknown> }) {
  const data = asRecord(details.data) || details;
  const rows = Object.entries(data)
    .filter(([, value]) => value === null || ["string", "number", "boolean"].includes(typeof value))
    .slice(0, 20);

  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
        No summary fields available for this record.
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white">
      <p className="border-b border-slate-200 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
        Summary
      </p>
      <div className="grid gap-0.5 px-3 py-2 text-xs text-slate-800 sm:grid-cols-2">
        {rows.map(([key, value]) => (
          <p key={`summary-${key}`} className="rounded bg-slate-50 px-2 py-1">
            <span className="font-semibold">{humanizeKey(key)}:</span>{" "}
            {typeof value === "number" ? formatNumberValue(value) : value === null ? "-" : String(value)}
          </p>
        ))}
      </div>
    </div>
  );
}

function RecordLinkedRows({ details }: { details: Record<string, unknown> }) {
  const candidates: Array<{ label: string; value: string }> = [];
  const roots = [details, asRecord(details.data)].filter(Boolean) as Array<Record<string, unknown>>;
  for (const root of roots) {
    for (const [key, raw] of Object.entries(root)) {
      const entry = asRecord(raw);
      if (!entry) continue;
      const id = asString(entry.id);
      if (!id) continue;
      const labelCandidate =
        asString(entry.name) ||
        asString(entry.rigCode) ||
        asString(entry.requestCode) ||
        asString(entry.fullName) ||
        asString(entry.label) ||
        id;
      candidates.push({
        label: humanizeKey(key),
        value: labelCandidate
      });
    }
  }

  if (candidates.length === 0) {
    return null;
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white">
      <p className="border-b border-slate-200 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
        Linked Records
      </p>
      <div className="space-y-1 px-3 py-2 text-xs text-slate-800">
        {candidates.slice(0, 16).map((candidate, index) => (
          <p key={`linked-${candidate.label}-${index}`} className="rounded bg-slate-50 px-2 py-1">
            <span className="font-semibold">{candidate.label}:</span> {candidate.value}
          </p>
        ))}
      </div>
    </div>
  );
}

function humanizeKey(value: string) {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase())
    .trim();
}

function formatNumberValue(value: number) {
  if (!Number.isFinite(value)) {
    return "0";
  }
  if (Math.abs(value) >= 1000) {
    return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
  }
  return value.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

function asString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function asRecord(value: unknown) {
  if (!value || typeof value !== "object") {
    return null;
  }
  return value as Record<string, unknown>;
}

function toNumericString(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? String(parsed) : "0";
}

function formatMoneyText(value: string, currency: string) {
  const parsed = Number(value || 0);
  if (!Number.isFinite(parsed)) {
    return "-";
  }
  return `${parsed.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${(
    currency || "TZS"
  ).toUpperCase()}`;
}

function formatDateTimeText(value: string) {
  if (!value) {
    return "-";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleString();
}

function mapExtractedLines(linesValue: unknown): ReviewLineState[] {
  if (!Array.isArray(linesValue)) {
    return [];
  }

  return linesValue.map((rawLine) => {
    const line = asRecord(rawLine) || {};
    const categorySuggestion = asRecord(line.categorySuggestion);
    const suggestedCategory = asString(categorySuggestion?.category);
    const categoryConfidence = (asString(categorySuggestion?.confidence) as FieldConfidence) || "NONE";
    const matchSuggestion = asRecord(line.matchSuggestion);
    const description = asString(line.description) || "Unparsed receipt item";
    const qty = Number(line.quantity ?? 0);
    const unit = Number(line.unitPrice ?? 0);
    const total = Number(line.lineTotal ?? 0);

    const hasStrongCategorySignal = categoryConfidence === "HIGH" || categoryConfidence === "MEDIUM";
    const safeSuggestedCategory = hasStrongCategorySignal ? suggestedCategory : "";
    const hasItemMatch = Boolean(asString(matchSuggestion?.["itemId"]));
    const extractionConfidence = (asString(line.extractionConfidence) as "HIGH" | "MEDIUM" | "LOW") || "LOW";
    const hasReliableDescription = extractionConfidence !== "LOW" && description.length >= 3;
    const looksNonInventory = isLikelyNonInventoryLine(description);
    const extremelyWeakSignal = extractionConfidence === "LOW" && categoryConfidence === "NONE";
    const initialMode: ReviewLineState["mode"] = hasItemMatch
      ? "MATCH"
      : looksNonInventory || (extremelyWeakSignal && !hasReliableDescription)
        ? "EXPENSE_ONLY"
        : "NEW";

    return {
      id: asString(line.id) || `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      description,
      quantity: String(qty > 0 ? qty : 1),
      unitPrice: String(unit >= 0 ? unit : 0),
      lineTotal: String(total >= 0 ? total : unit),
      extractionConfidence,
      selectedCategory: safeSuggestedCategory || "OTHER",
      suggestedCategory: safeSuggestedCategory || null,
      categoryReason:
        asString(categorySuggestion?.reason) ||
        "No strong category match found. Keep as Uncategorized unless manually confirmed.",
      mode: initialMode,
      selectedItemId: asString(matchSuggestion?.["itemId"]),
      matchConfidence: (asString(matchSuggestion?.["confidence"]) as FieldConfidence) || "NONE",
      matchScore: Number(matchSuggestion?.["score"] ?? 0),
      newItemName: description,
      newItemSku: "",
      newItemMinimumStockLevel: "0"
    };
  });
}

function isLikelyNonInventoryLine(description: string) {
  const normalized = description.toLowerCase();
  const nonInventorySignals = [
    "hotel",
    "lodge",
    "restaurant",
    "meal",
    "lunch",
    "dinner",
    "taxi",
    "transport fare",
    "airtime",
    "office stationery"
  ];
  return nonInventorySignals.some((signal) => normalized.includes(signal));
}

function buildReviewStateFromSubmission({
  submission,
  defaultClientId,
  defaultRigId
}: {
  submission: NonNullable<ReceiptIntakePanelProps["activeSubmission"]>;
  defaultClientId: string;
  defaultRigId: string;
}): ReviewState {
  const draft = submission.draft || {};
  const receipt = draft.receipt || {};
  const linkContext = draft.linkContext || {};
  const normalizedClassification = normalizeReceiptClassification(asString(draft.receiptType));
  const receiptConfig = resolveReceiptConfig(normalizedClassification);
  const submittedLines = Array.isArray(draft.lines) ? draft.lines : [];
  const lines = applyReceiptClassificationLineDefaults(
    submittedLines.map((line, index) => {
      const description = asString(line.description) || "Submitted receipt line";
      const quantity = Number(line.quantity ?? 0);
      const unitPrice = Number(line.unitPrice ?? 0);
    const lineTotal = Number(line.lineTotal ?? 0);
    const selectedItemId = asString(line.selectedItemId);
    const selectedCategory = asString(line.selectedCategory) || asString(line.newItem?.category) || "OTHER";
    const mode: ReviewLineState["mode"] =
      line.mode === "EXPENSE_ONLY"
        ? "EXPENSE_ONLY"
        : line.mode === "NEW"
          ? "NEW"
          : selectedItemId
            ? "MATCH"
            : "NEW";

    return {
      id: asString(line.id) || `submission-line-${index + 1}`,
      description,
      quantity: String(quantity > 0 ? quantity : 1),
      unitPrice: String(unitPrice >= 0 ? unitPrice : 0),
      lineTotal: String(lineTotal >= 0 ? lineTotal : Math.max(0, quantity * unitPrice)),
      extractionConfidence: "MEDIUM",
      selectedCategory,
      suggestedCategory: selectedCategory || null,
      categoryReason: "Loaded from submitted receipt draft.",
      mode,
      selectedItemId: mode === "MATCH" ? selectedItemId : "",
      matchConfidence: mode === "MATCH" && selectedItemId ? "HIGH" : "NONE",
      matchScore: mode === "MATCH" && selectedItemId ? 1 : 0,
      newItemName: asString(line.newItem?.name) || description,
      newItemSku: asString(line.newItem?.sku),
      newItemMinimumStockLevel: String(Number(line.newItem?.minimumStockLevel ?? 0) || 0)
    };
    }),
    normalizedClassification
  );

  const receiptPurposeRaw = asString(draft.receiptPurpose);
  return {
    receiptUrl: asString(receipt.url),
    receiptFileName: asString(receipt.fileName) || "Submitted receipt",
    supplierId: asString(receipt.supplierId),
    supplierName: normalizeSupplierName(asString(receipt.supplierName)),
    tin: asString(receipt.tin),
    vrn: asString(receipt.vrn),
    serialNumber: asString(receipt.serialNumber),
    receiptNumber: asString(receipt.receiptNumber),
    verificationCode: asString(receipt.verificationCode),
    verificationUrl: asString(receipt.verificationUrl),
    rawQrValue: asString(receipt.rawQrValue),
    qrContentType: "UNKNOWN",
    isTraVerification: Boolean(asString(receipt.verificationUrl).includes("tra.go.tz")),
    isQrOnlyImage: false,
    qrDecodeStatus: asString(receipt.rawQrValue) ? "DECODED" : "NOT_DETECTED",
    qrDecodePass: "",
    qrParseStatus: "PARTIAL",
    qrFailureReason: "",
    qrLookupStatus: "NOT_ATTEMPTED",
    qrLookupReason: "",
    qrFieldsParseStatus: "NOT_ATTEMPTED",
    qrLineItemsParseStatus: "NOT_ATTEMPTED",
    receiptDate: asString(receipt.receiptDate) || new Date().toISOString().slice(0, 10),
    receiptTime: asString(receipt.receiptTime),
    traReceiptNumber: asString(receipt.traReceiptNumber),
    invoiceReference: asString(receipt.invoiceReference),
    paymentMethod: asString(receipt.paymentMethod),
    taxOffice: asString(receipt.taxOffice),
    currency: asString(receipt.currency) || "TZS",
    subtotal: toNumericString(receipt.subtotal),
    tax: toNumericString(receipt.tax),
    total: toNumericString(receipt.total),
    clientId: asString(linkContext.clientId) || defaultClientId,
    projectId: asString(linkContext.projectId),
    rigId: asString(linkContext.rigId) || defaultRigId,
    maintenanceRequestId: asString(linkContext.maintenanceRequestId),
    locationFromId: asString(linkContext.locationFromId),
    locationToId: asString(linkContext.locationToId),
    expenseOnlyCategory: resolveExpenseOnlyCategory(asString(draft.expenseOnlyCategory)) || "",
    createExpense:
      typeof draft.createExpense === "boolean" ? draft.createExpense : receiptConfig.createExpense,
    receiptPurpose:
      receiptPurposeRaw.length > 0
        ? normalizeReceiptPurpose(receiptPurposeRaw)
        : receiptConfig.receiptPurpose,
    receiptClassification: normalizedClassification,
    warnings: ["Loaded from pending submission. Review and finalize when ready."],
    extractionMethod: "SUBMISSION",
    scanStatus: "PARTIAL",
    receiptType: "UNCLEAR",
    fieldConfidence: {
      supplierName: "MEDIUM",
      tin: "MEDIUM",
      vrn: "MEDIUM",
      serialNumber: "MEDIUM",
      receiptNumber: "MEDIUM",
      verificationCode: "MEDIUM",
      receiptDate: "MEDIUM",
      receiptTime: "LOW",
      subtotal: "MEDIUM",
      tax: "MEDIUM",
      total: "MEDIUM"
    },
    fieldSource: {
      supplierName: "DERIVED",
      tin: "DERIVED",
      vrn: "DERIVED",
      serialNumber: "DERIVED",
      receiptNumber: "DERIVED",
      verificationCode: "DERIVED",
      receiptDate: "DERIVED",
      receiptTime: "DERIVED",
      subtotal: "DERIVED",
      tax: "DERIVED",
      total: "DERIVED"
    },
    rawTextPreview: asString(receipt.ocrTextPreview),
    debugFlags: {
      qrDecoded: Boolean(asString(receipt.rawQrValue)),
      traLookupSucceeded: Boolean(asString(receipt.verificationUrl)),
      traParseSucceeded: false,
      ocrAttempted: false,
      ocrSucceeded: false,
      ocrError: "",
      enrichmentWarning: "",
      returnedFrom: "qr_tra",
      partialEnrichment: false
    },
    debugCandidates: [],
    lines
  };
}

function buildReviewStateFromPayload({
  payload,
  receiptFileName,
  defaultClientId,
  defaultRigId,
  receiptClassification
}: {
  payload: {
    receipt?: { url?: string; fileName?: string };
    extracted: Record<string, unknown>;
    supplierSuggestion?: Record<string, unknown>;
    supplierName?: string;
    supplierConfidence?: string;
    supplierSource?: string;
  };
  receiptFileName: string;
  defaultClientId: string;
  defaultRigId: string;
  receiptClassification: ReceiptClassification;
}): ReviewState {
  const extracted = payload.extracted;
  const supplierSuggestion = asRecord(payload.supplierSuggestion) || {};
  const extractedHeader = asRecord(extracted.header);
  const qr = asRecord(extracted.qr);
  const qrParsedFields = asRecord(qr?.parsedFields);
  const qrStages = asRecord(qr?.stages);
  const qrLookup = asRecord(qrStages?.verificationLookup);
  const fromQrParsedSupplier = asString(qrParsedFields?.supplierName);
  const payloadSupplierName = asString(payload.supplierName);
  const payloadSupplierConfidence = toReadability(payload.supplierConfidence);
  const payloadSupplierSource = toFieldSource(payload.supplierSource);
  const baseFieldConfidence = toReadabilityMap(extracted.fieldConfidence);
  const baseFieldSource = toFieldSourceMap(extracted.fieldSource);
  const resolvedSupplierName = resolveSupplierName({
    fromHeader: asString(extractedHeader?.supplierName),
    fromQrParsed: fromQrParsedSupplier,
    fromSuggestion: asString(supplierSuggestion.supplierName),
    fromPayload: payloadSupplierName
  });
  const supplierFieldMaps = applySupplierFieldOverrides({
    supplierName: resolvedSupplierName,
    supplierFromQrParsed: fromQrParsedSupplier,
    fieldConfidence: baseFieldConfidence,
    fieldSource: baseFieldSource,
    supplierConfidenceHint: payloadSupplierConfidence,
    supplierSourceHint: payloadSupplierSource
  });
  if (process.env.NODE_ENV !== "production") {
    console.info("[inventory][receipt-intake][frontend-supplier]", {
      fromHeader: asString(extractedHeader?.supplierName),
      fromQrParsed: fromQrParsedSupplier,
      fromSuggestion: asString(supplierSuggestion.supplierName),
      fromPayload: payloadSupplierName,
      assignedSupplier: resolvedSupplierName,
      confidence: supplierFieldMaps.fieldConfidence.supplierName || "UNREADABLE",
      source: supplierFieldMaps.fieldSource.supplierName || "NONE"
    });
  }
  const receiptConfig = resolveReceiptConfig(receiptClassification);

  return {
    receiptUrl: payload.receipt?.url || "",
    receiptFileName: payload.receipt?.fileName || receiptFileName,
    supplierId: asString(supplierSuggestion.supplierId),
    supplierName: resolvedSupplierName,
    tin: asString(extractedHeader?.tin),
    vrn: asString(extractedHeader?.vrn),
    serialNumber: asString(extractedHeader?.serialNumber),
    receiptNumber: asString(extractedHeader?.receiptNumber),
    verificationCode: asString(extractedHeader?.verificationCode),
    verificationUrl: asString(qr?.verificationUrl),
    rawQrValue: asString(qr?.rawValue),
    qrContentType: normalizeQrContentType(qr?.contentType),
    isTraVerification: Boolean(qr?.isTraVerification),
    isQrOnlyImage: Boolean(qr?.isQrOnlyImage),
    qrDecodeStatus: normalizeQrDecodeStatus(qr?.decodeStatus),
    qrDecodePass: asString(qr?.decodePass),
    qrParseStatus: normalizeQrParseStatus(qr?.parseStatus),
    qrFailureReason: asString(qr?.failureReason),
    qrLookupStatus: normalizeQrLookupStatus(qrLookup?.status),
    qrLookupReason: asString(qrLookup?.reason),
    qrFieldsParseStatus: normalizeQrParseDetailStatus(qrLookup?.fieldsParseStatus),
    qrLineItemsParseStatus: normalizeQrParseDetailStatus(qrLookup?.lineItemsParseStatus),
    receiptDate: asString(extractedHeader?.receiptDate) || new Date().toISOString().slice(0, 10),
    receiptTime: asString(extractedHeader?.receiptTime),
    traReceiptNumber: asString(extractedHeader?.traReceiptNumber),
    invoiceReference: asString(extractedHeader?.invoiceReference),
    paymentMethod: asString(extractedHeader?.paymentMethod),
    taxOffice: asString(extractedHeader?.taxOffice),
    currency: asString(extractedHeader?.currency) || "TZS",
    subtotal: toNumericString(extractedHeader?.subtotal),
    tax: toNumericString(extractedHeader?.tax),
    total: toNumericString(extractedHeader?.total),
    clientId: defaultClientId,
    projectId: "",
    rigId: defaultRigId,
    maintenanceRequestId: "",
    locationFromId: "",
    locationToId: "",
    expenseOnlyCategory: "",
    createExpense: receiptConfig.createExpense,
    receiptPurpose: receiptConfig.receiptPurpose,
    receiptClassification,
    warnings: Array.isArray(extracted.warnings)
      ? Array.from(new Set(extracted.warnings.map((warning) => calmMessage(asString(warning))).filter(Boolean)))
      : [],
    extractionMethod: asString(extracted.extractionMethod) || "UNKNOWN",
    scanStatus: normalizeScanStatus(extracted.scanStatus),
    receiptType: normalizeReceiptType(extracted.receiptType),
    fieldConfidence: supplierFieldMaps.fieldConfidence,
    fieldSource: supplierFieldMaps.fieldSource,
    rawTextPreview: asString(extracted.rawTextPreview),
    debugFlags: readDebugFlags(payload),
    debugCandidates: readDebugCandidates(extracted.debug),
    lines: applyReceiptClassificationLineDefaults(
      mapExtractedLines(extracted.lines),
      receiptClassification
    )
  };
}

function buildManualAssistReview({
  payload,
  receiptFileName,
  defaultClientId,
  defaultRigId,
  warning,
  receiptClassification
}: {
  payload: unknown;
  receiptFileName: string;
  defaultClientId: string;
  defaultRigId: string;
  warning: string;
  receiptClassification: ReceiptClassification;
}): ReviewState {
  const root = asRecord(payload);
  const extracted = asRecord(root?.extracted);
  const receipt = asRecord(root?.receipt);
  const supplierSuggestion = asRecord(root?.supplierSuggestion);
  const extractedHeader = asRecord(extracted?.header);
  const qr = asRecord(extracted?.qr);
  const qrParsedFields = asRecord(qr?.parsedFields);
  const qrStages = asRecord(qr?.stages);
  const qrLookup = asRecord(qrStages?.verificationLookup);
  const scanStatus = extracted ? normalizeScanStatus(extracted?.scanStatus) : "UNREADABLE";
  const fromQrParsedSupplier = asString(qrParsedFields?.supplierName);
  const payloadSupplierName = asString(root?.supplierName);
  const payloadSupplierConfidence = toReadability(root?.supplierConfidence);
  const payloadSupplierSource = toFieldSource(root?.supplierSource);
  const baseFieldConfidence = toReadabilityMap(extracted?.fieldConfidence);
  const baseFieldSource = toFieldSourceMap(extracted?.fieldSource);
  const resolvedSupplierName = resolveSupplierName({
    fromHeader: asString(extractedHeader?.supplierName),
    fromQrParsed: fromQrParsedSupplier,
    fromSuggestion: asString(supplierSuggestion?.supplierName),
    fromPayload: payloadSupplierName
  });
  const supplierFieldMaps = applySupplierFieldOverrides({
    supplierName: resolvedSupplierName,
    supplierFromQrParsed: fromQrParsedSupplier,
    fieldConfidence: baseFieldConfidence,
    fieldSource: baseFieldSource,
    supplierConfidenceHint: payloadSupplierConfidence,
    supplierSourceHint: payloadSupplierSource
  });
  if (process.env.NODE_ENV !== "production") {
    console.info("[inventory][receipt-intake][frontend-supplier]", {
      fromHeader: asString(extractedHeader?.supplierName),
      fromQrParsed: fromQrParsedSupplier,
      fromSuggestion: asString(supplierSuggestion?.supplierName),
      fromPayload: payloadSupplierName,
      assignedSupplier: resolvedSupplierName,
      confidence: supplierFieldMaps.fieldConfidence.supplierName || "UNREADABLE",
      source: supplierFieldMaps.fieldSource.supplierName || "NONE"
    });
  }
  const receiptConfig = resolveReceiptConfig(receiptClassification);

  const warnings = [
    calmMessage(warning),
    ...(Array.isArray(extracted?.warnings)
      ? extracted?.warnings.map((entry) => calmMessage(asString(entry))).filter(Boolean)
      : [])
  ];

  return {
    receiptUrl: asString(receipt?.url),
    receiptFileName: asString(receipt?.fileName) || receiptFileName,
    supplierId: asString(supplierSuggestion?.supplierId),
    supplierName: resolvedSupplierName,
    tin: asString(extractedHeader?.tin),
    vrn: asString(extractedHeader?.vrn),
    serialNumber: asString(extractedHeader?.serialNumber),
    receiptNumber: asString(extractedHeader?.receiptNumber),
    verificationCode: asString(extractedHeader?.verificationCode),
    verificationUrl: asString(qr?.verificationUrl),
    rawQrValue: asString(qr?.rawValue),
    qrContentType: normalizeQrContentType(qr?.contentType),
    isTraVerification: Boolean(qr?.isTraVerification),
    isQrOnlyImage: Boolean(qr?.isQrOnlyImage),
    qrDecodeStatus: normalizeQrDecodeStatus(qr?.decodeStatus),
    qrDecodePass: asString(qr?.decodePass),
    qrParseStatus: normalizeQrParseStatus(qr?.parseStatus),
    qrFailureReason: asString(qr?.failureReason),
    qrLookupStatus: normalizeQrLookupStatus(qrLookup?.status),
    qrLookupReason: asString(qrLookup?.reason),
    qrFieldsParseStatus: normalizeQrParseDetailStatus(qrLookup?.fieldsParseStatus),
    qrLineItemsParseStatus: normalizeQrParseDetailStatus(qrLookup?.lineItemsParseStatus),
    receiptDate: asString(extractedHeader?.receiptDate) || new Date().toISOString().slice(0, 10),
    receiptTime: asString(extractedHeader?.receiptTime),
    traReceiptNumber: asString(extractedHeader?.traReceiptNumber),
    invoiceReference: asString(extractedHeader?.invoiceReference),
    paymentMethod: asString(extractedHeader?.paymentMethod),
    taxOffice: asString(extractedHeader?.taxOffice),
    currency: asString(extractedHeader?.currency) || "TZS",
    subtotal: toNumericString(extractedHeader?.subtotal),
    tax: toNumericString(extractedHeader?.tax),
    total: toNumericString(extractedHeader?.total),
    clientId: defaultClientId,
    projectId: "",
    rigId: defaultRigId,
    maintenanceRequestId: "",
    locationFromId: "",
    locationToId: "",
    expenseOnlyCategory: "",
    createExpense: receiptConfig.createExpense,
    receiptPurpose: receiptConfig.receiptPurpose,
    receiptClassification,
    warnings: Array.from(new Set(warnings.filter(Boolean))),
    extractionMethod: asString(extracted?.extractionMethod) || "UNKNOWN",
    scanStatus,
    receiptType: normalizeReceiptType(extracted?.receiptType),
    fieldConfidence: supplierFieldMaps.fieldConfidence,
    fieldSource: supplierFieldMaps.fieldSource,
    rawTextPreview: asString(extracted?.rawTextPreview),
    debugFlags: readDebugFlags(root),
    debugCandidates: readDebugCandidates(extracted?.debug),
    lines: applyReceiptClassificationLineDefaults(
      mapExtractedLines(extracted?.lines),
      receiptClassification
    )
  };
}

function resolveSupplierName({
  fromHeader,
  fromQrParsed,
  fromSuggestion,
  fromPayload
}: {
  fromHeader: string;
  fromQrParsed: string;
  fromSuggestion: string;
  fromPayload: string;
}) {
  const candidate = [fromQrParsed, fromHeader, fromSuggestion, fromPayload]
    .map((value) => normalizeSupplierName(value))
    .find((value) => value.length > 0);
  return candidate || "";
}

function resolveReceiptConfig(receiptClassification: ReceiptClassification): {
  receiptPurpose: ReceiptPurpose;
  createExpense: boolean;
} {
  if (
    receiptClassification === "INVENTORY_PURCHASE" ||
    receiptClassification === "MAINTENANCE_LINKED_PURCHASE"
  ) {
    return {
      receiptPurpose: "INVENTORY_AND_EXPENSE",
      createExpense: true
    };
  }
  if (receiptClassification === "EXPENSE_ONLY") {
    return {
      receiptPurpose: "BUSINESS_EXPENSE_ONLY",
      createExpense: true
    };
  }
  return {
    receiptPurpose: "INVENTORY_PURCHASE",
    createExpense: false
  };
}

function normalizeSupplierName(value: string) {
  return value
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

function applySupplierFieldOverrides({
  supplierName,
  supplierFromQrParsed,
  fieldConfidence,
  fieldSource,
  supplierConfidenceHint,
  supplierSourceHint
}: {
  supplierName: string;
  supplierFromQrParsed: string;
  fieldConfidence: Record<string, ReadabilityConfidence>;
  fieldSource: Record<string, "QR" | "OCR" | "DERIVED" | "NONE">;
  supplierConfidenceHint: ReadabilityConfidence;
  supplierSourceHint: "QR" | "OCR" | "DERIVED" | "NONE";
}) {
  const nextConfidence = { ...fieldConfidence };
  const nextSource = { ...fieldSource };
  if (supplierName) {
    if (!nextConfidence.supplierName || nextConfidence.supplierName === "UNREADABLE") {
      nextConfidence.supplierName =
        supplierConfidenceHint !== "UNREADABLE" ? supplierConfidenceHint : supplierFromQrParsed ? "HIGH" : "MEDIUM";
    }
    if (!nextSource.supplierName || nextSource.supplierName === "NONE") {
      nextSource.supplierName = supplierSourceHint !== "NONE" ? supplierSourceHint : supplierFromQrParsed ? "QR" : "OCR";
    }
  }
  return {
    fieldConfidence: nextConfidence,
    fieldSource: nextSource
  };
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

function isReceiptExtractSuccessPayload(payload: unknown): payload is {
  success: true;
  message?: string;
  receipt?: { url?: string; fileName?: string };
  extracted: {
    header?: Record<string, unknown>;
    fieldConfidence?: Record<string, unknown>;
    fieldSource?: Record<string, unknown>;
    warnings?: unknown[];
    lines: unknown[];
    extractionMethod?: string;
    scanStatus?: string;
    receiptType?: string;
    qr?: Record<string, unknown>;
    debug?: Record<string, unknown>;
    rawTextPreview?: string;
  };
  supplierSuggestion?: Record<string, unknown>;
} {
  if (!payload || typeof payload !== "object") {
    return false;
  }
  const candidate = payload as Record<string, unknown>;
  if (candidate.success !== true) {
    return false;
  }
  if (!candidate.extracted || typeof candidate.extracted !== "object") {
    return false;
  }
  const extracted = candidate.extracted as Record<string, unknown>;
  return (
    Array.isArray(extracted.lines) &&
    typeof extracted.scanStatus === "string" &&
    typeof extracted.receiptType === "string"
  );
}

function isDuplicateCommitPayload(payload: unknown): payload is {
  message?: string;
  duplicate: {
    review?: unknown;
    matches: Array<{
      source: string;
      id: string;
      matchedFields: string[];
      reason: string;
      viewUrl: string;
    }>;
  };
} {
  if (!payload || typeof payload !== "object") {
    return false;
  }
  const candidate = payload as Record<string, unknown>;
  if (!candidate.duplicate || typeof candidate.duplicate !== "object") {
    return false;
  }
  const duplicate = candidate.duplicate as Record<string, unknown>;
  return Array.isArray(duplicate.matches);
}

function readDuplicateReviewPayload(
  value: unknown
): DuplicatePromptState["review"] {
  const root = asRecord(value);
  if (!root) {
    return null;
  }
  const summary = asRecord(root.summary);
  const linkedRecords = asRecord(root.linkedRecords);
  const primaryRecord = asRecord(root.primaryRecord);
  if (!summary || !linkedRecords) {
    return null;
  }
  const receiptIntake = normalizeDuplicateLinkedRecordList(linkedRecords.receiptIntake);
  const inventoryItems = normalizeDuplicateLinkedRecordList(linkedRecords.inventoryItems);
  const stockMovements = normalizeDuplicateLinkedRecordList(linkedRecords.stockMovements);
  const expenses = normalizeDuplicateLinkedRecordList(linkedRecords.expenses);
  const normalizedPrimary = normalizeDuplicateLinkedRecord(primaryRecord);
  return {
    summary: {
      supplierName: asString(summary.supplierName),
      receiptNumber: asString(summary.receiptNumber),
      verificationCode: asString(summary.verificationCode),
      serialNumber: asString(summary.serialNumber),
      receiptDate: asString(summary.receiptDate),
      total: Number(summary.total ?? 0) || 0,
      traReceiptNumber: asString(summary.traReceiptNumber),
      processedAt: asString(summary.processedAt),
      duplicateConfidence:
        summary.duplicateConfidence === "HIGH" || summary.duplicateConfidence === "MEDIUM"
          ? (summary.duplicateConfidence as "HIGH" | "MEDIUM")
          : "LOW",
      matchReason: asString(summary.matchReason),
      matchedFields: Array.isArray(summary.matchedFields)
        ? summary.matchedFields.map((entry) => asString(entry)).filter(Boolean)
        : [],
      receiptPurpose: asString(summary.receiptPurpose)
    },
    primaryRecord: normalizedPrimary,
    linkedRecords: {
      receiptIntake,
      inventoryItems,
      stockMovements,
      expenses
    }
  };
}

function normalizeDuplicateLinkedRecordList(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => normalizeDuplicateLinkedRecord(asRecord(entry)))
    .filter((entry): entry is { id: string; label: string; type: "RECEIPT_INTAKE" | "INVENTORY_ITEM" | "STOCK_MOVEMENT" | "EXPENSE"; url: string } => Boolean(entry));
}

function normalizeDuplicateLinkedRecord(value: Record<string, unknown> | null) {
  if (!value) {
    return null;
  }
  const id = asString(value.id);
  const label = asString(value.label);
  const url = asString(value.url);
  const type = asString(value.type);
  if (!id || !label || !url) {
    return null;
  }
  const normalizedType =
    type === "RECEIPT_INTAKE" || type === "INVENTORY_ITEM" || type === "STOCK_MOVEMENT" || type === "EXPENSE"
      ? type
      : "RECEIPT_INTAKE";
  return {
    id,
    label,
    type: normalizedType as "RECEIPT_INTAKE" | "INVENTORY_ITEM" | "STOCK_MOVEMENT" | "EXPENSE",
    url
  };
}

function isReceiptCommitSuccessPayload(payload: unknown): payload is {
  success?: boolean;
  data: {
    submissionStatus?: string | null;
    submissionId?: string | null;
    movementCount?: number;
    itemsCreatedCount?: number;
    evidenceOnlyLinesCount?: number;
    skippedLinesCount?: number;
    allocationStatus?: string;
    allocationMessage?: string;
    outcomeReasons?: string[];
    lineOutcomes?: Array<Record<string, unknown>>;
    totals?: {
      total?: number;
    };
  };
} {
  if (!payload || typeof payload !== "object") {
    return false;
  }
  const candidate = payload as Record<string, unknown>;
  if (candidate.success === false) {
    return false;
  }
  return Boolean(candidate.data && typeof candidate.data === "object");
}

function deriveAllocationStatus(clientId: string, projectId: string): IntakeAllocationStatus {
  const hasClient = Boolean(clientId && clientId !== "all");
  const hasProject = Boolean(projectId && projectId !== "all");
  if (hasClient && hasProject) {
    return "ALLOCATED";
  }
  if (hasClient || hasProject) {
    return "PARTIALLY_ALLOCATED";
  }
  return "UNALLOCATED";
}

function normalizeAllocationStatus(value: unknown): IntakeAllocationStatus {
  if (value === "ALLOCATED" || value === "PARTIALLY_ALLOCATED" || value === "UNALLOCATED") {
    return value;
  }
  return "UNALLOCATED";
}

function formatAllocationStatusLabel(status: IntakeAllocationStatus) {
  if (status === "ALLOCATED") {
    return "Allocated";
  }
  if (status === "PARTIALLY_ALLOCATED") {
    return "Partially allocated";
  }
  return "Unallocated";
}

async function readJsonPayload(response: Response): Promise<unknown | null> {
  const contentType = (response.headers.get("content-type") || "").toLowerCase();
  if (!contentType.includes("application/json")) {
    return null;
  }
  return response.json().catch(() => null);
}

function readApiError(response: Response, payload: unknown, fallbackMessage: string) {
  if (payload && typeof payload === "object") {
    const candidate = payload as Record<string, unknown>;
    const possibleMessage = [candidate.error, candidate.message, candidate.detail].find(
      (entry) => typeof entry === "string" && entry.trim().length > 0
    );
    if (typeof possibleMessage === "string" && possibleMessage.trim()) {
      return possibleMessage.trim();
    }
  }

  if (response.status === 413) {
    return "Receipt file is too large. Please upload a smaller file.";
  }
  if (response.status === 415) {
    return "Unsupported file type. Please upload a receipt image or PDF.";
  }
  if (response.status === 401 || response.status === 403) {
    return "You do not have permission to process receipts.";
  }

  return fallbackMessage;
}

function readPayloadMessage(payload: unknown, fallbackMessage: string) {
  if (payload && typeof payload === "object") {
    const candidate = payload as Record<string, unknown>;
    const possibleMessage = [candidate.message, candidate.error, candidate.detail].find(
      (entry) => typeof entry === "string" && entry.trim().length > 0
    );
    if (typeof possibleMessage === "string" && possibleMessage.trim()) {
      return possibleMessage.trim();
    }
  }
  return fallbackMessage;
}

function readDebugFlags(payload: unknown): ReviewState["debugFlags"] {
  const root = asRecord(payload);
  const debugFlags = asRecord(root?.debugFlags);
  const returnedFromRaw = asString(debugFlags?.returnedFrom);
  return {
    qrDecoded: Boolean(debugFlags?.qrDecoded),
    traLookupSucceeded: Boolean(debugFlags?.traLookupSucceeded),
    traParseSucceeded: Boolean(debugFlags?.traParseSucceeded),
    ocrAttempted: Boolean(debugFlags?.ocrAttempted),
    ocrSucceeded: Boolean(debugFlags?.ocrSucceeded),
    ocrError: asString(debugFlags?.ocrError),
    enrichmentWarning: asString(debugFlags?.enrichmentWarning),
    returnedFrom: returnedFromRaw === "qr_tra_plus_ocr" ? "qr_tra_plus_ocr" : "qr_tra",
    partialEnrichment: Boolean(debugFlags?.partialEnrichment)
  };
}

function evaluateSaveReadiness(review: ReviewState): SaveReadiness {
  const reasons: string[] = [];
  const effectiveCreateExpense = resolveCreateExpenseForPurpose(review);
  const inventoryLines = review.lines.filter((line) => line.mode !== "EXPENSE_ONLY");
  if (!review.receiptNumber.trim()) {
    reasons.push("Add a receipt number before saving.");
  }
  if (!review.supplierId && !review.supplierName.trim()) {
    reasons.push("Add supplier details before saving.");
  }
  if (Number(review.total || 0) <= 0) {
    reasons.push("Add a valid total amount before saving.");
  }
  if (review.receiptPurpose === "OTHER_MANUAL") {
    reasons.push("Choose a final receipt purpose before saving.");
  }
  if (review.receiptClassification === "MAINTENANCE_LINKED_PURCHASE" && !review.maintenanceRequestId) {
    reasons.push("Select a maintenance request for maintenance-linked purchases.");
  }
  if (review.receiptClassification === "EXPENSE_ONLY" && !review.expenseOnlyCategory) {
    reasons.push("Select an expense category for expense-only receipts.");
  }
  if (review.receiptClassification === "INTERNAL_TRANSFER") {
    if (!review.locationFromId || !review.locationToId) {
      reasons.push("Select both from-location and to-location for internal transfers.");
    } else if (review.locationFromId === review.locationToId) {
      reasons.push("From-location and to-location must be different for internal transfers.");
    }
    if (inventoryLines.some((line) => line.mode !== "MATCH" || !line.selectedItemId)) {
      reasons.push("Internal transfer lines must be linked to existing inventory items.");
    }
  }
  if (review.lines.length === 0 && !effectiveCreateExpense) {
    reasons.push("Add at least one line item or enable expense evidence.");
  }
  if (inventoryLines.some((line) => !line.description.trim() || Number(line.quantity || 0) <= 0)) {
    reasons.push("Line descriptions and quantities need review.");
  }
  return {
    ready: reasons.length === 0,
    reasons
  };
}

function evaluateAutoSaveEligibility(review: ReviewState): SaveReadiness {
  const base = evaluateSaveReadiness(review);
  const reasons = [...base.reasons];
  if (!review.debugFlags.traParseSucceeded && review.qrLookupStatus !== "SUCCESS") {
    reasons.push("TRA/QR parse is still incomplete.");
  }
  if (review.receiptPurpose === "OTHER_MANUAL") {
    reasons.push("Receipt purpose requires manual decision.");
  }
  const lineCandidates = review.lines.filter(
    (line) => line.description.trim() && Number(line.quantity || 0) > 0
  );
  if (
    review.receiptClassification !== "EXPENSE_ONLY" &&
    review.receiptPurpose !== "EVIDENCE_ONLY" &&
    lineCandidates.length === 0
  ) {
    reasons.push("At least one valid line item is required.");
  }
  const hasConflict = hasConflictingParsedValues(review);
  if (hasConflict) {
    reasons.push("Totals look inconsistent and should be reviewed manually.");
  }
  return {
    ready: reasons.length === 0,
    reasons
  };
}

function hasConflictingParsedValues(review: ReviewState) {
  const subtotal = Number(review.subtotal || 0);
  const tax = Number(review.tax || 0);
  const total = Number(review.total || 0);
  if (subtotal <= 0 || total <= 0) {
    return false;
  }
  const expected = subtotal + Math.max(tax, 0);
  const tolerance = Math.max(1, total * 0.03);
  return Math.abs(expected - total) > tolerance;
}

function resolveWorkflowStage({
  extractState,
  saving,
  notice,
  review,
  saveReadiness
}: {
  extractState: ExtractState;
  saving: boolean;
  notice: string | null;
  review: ReviewState | null;
  saveReadiness: SaveReadiness | null;
}): WorkflowStage {
  if (saving) {
    return "READY_TO_SAVE";
  }
  if (notice && notice.toLowerCase().includes("saved successfully")) {
    return "SAVED_SUCCESSFULLY";
  }
  if (extractState === "UPLOADING" || extractState === "PROCESSING") {
    return "CAPTURING";
  }
  if (review) {
    if (saveReadiness?.ready) {
      return "READY_TO_SAVE";
    }
    if (review.qrLookupStatus === "SUCCESS" || review.debugFlags.traParseSucceeded) {
      return "CAPTURED_QR_TRA";
    }
    return "REVIEW_RECOMMENDED";
  }
  if (extractState === "FAILED") {
    return "REVIEW_RECOMMENDED";
  }
  return "READY_TO_SCAN";
}

function formatWorkflowStage(stage: WorkflowStage) {
  if (stage === "CAPTURING") return "Capturing receipt";
  if (stage === "CAPTURED_QR_TRA") return "Captured from QR/TRA";
  if (stage === "REVIEW_RECOMMENDED") return "Review recommended";
  if (stage === "READY_TO_SAVE") return "Ready to save";
  if (stage === "SAVED_SUCCESSFULLY") return "Saved successfully";
  return "Ready to scan";
}

function workflowHelpText(stage: WorkflowStage) {
  if (stage === "CAPTURING") return "Scanning in progress. We are preparing receipt data and inventory actions.";
  if (stage === "CAPTURED_QR_TRA") return "Core receipt fields were captured. Review optional details, then finalize.";
  if (stage === "REVIEW_RECOMMENDED") return "Some fields still need confirmation. You can continue manually.";
  if (stage === "READY_TO_SAVE") return "Receipt details are complete enough to finalize inventory updates.";
  if (stage === "SAVED_SUCCESSFULLY") return "Inventory updates, receipt evidence, and linked records were saved.";
  return "Upload a receipt image or PDF to begin.";
}

function workflowBadgeClass(stage: WorkflowStage) {
  if (stage === "CAPTURED_QR_TRA" || stage === "READY_TO_SAVE" || stage === "SAVED_SUCCESSFULLY") {
    return "rounded-full border border-emerald-300 bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-800";
  }
  if (stage === "REVIEW_RECOMMENDED") {
    return "rounded-full border border-amber-300 bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800";
  }
  return "rounded-full border border-slate-300 bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-700";
}

function deriveManualFieldHints(review: ReviewState) {
  const hints: string[] = [];
  if (!review.clientId) {
    hints.push("Link client");
  }
  if (!review.projectId) {
    hints.push("Link project");
  }
  if (!review.rigId) {
    hints.push("Link rig");
  }
  if (review.receiptClassification === "MAINTENANCE_LINKED_PURCHASE" && !review.maintenanceRequestId) {
    hints.push("Select maintenance request");
  }
  if (review.receiptClassification === "EXPENSE_ONLY" && !review.expenseOnlyCategory) {
    hints.push("Select expense category");
  }
  if (review.receiptClassification === "INTERNAL_TRANSFER") {
    if (!review.locationFromId) {
      hints.push("Select from-location");
    }
    if (!review.locationToId) {
      hints.push("Select to-location");
    }
  } else if (!review.locationToId) {
    hints.push("Select stock location");
  }
  return hints;
}

function calmMessage(message: string) {
  const value = message.trim();
  if (!value) {
    return "";
  }
  const normalized = value.toLowerCase();
  if (normalized.includes("extra ocr enrichment failed") || normalized.includes("optional ocr enrichment failed")) {
    return "Core receipt data captured. Some optional details may need review.";
  }
  if (normalized.includes("worker module is unavailable") || normalized.includes("timed out")) {
    return "Core receipt data captured. Optional enrichment was skipped for this scan.";
  }
  if (normalized.includes("unreadable")) {
    return "Some fields need review.";
  }
  if (normalized.includes("line items were not detected") || normalized.includes("line items could not be read")) {
    return "No line items detected automatically yet. You can add or confirm line items manually.";
  }
  if (normalized.includes("receipt image is unclear")) {
    return "Capture quality is low. You can still continue and complete missing fields manually.";
  }
  if (normalized.includes("failed")) {
    return value.replace(/failed/gi, "needs review");
  }
  if (normalized.includes("no qr detected")) {
    return "QR was not detected automatically. OCR/manual review is still available.";
  }
  return value;
}

function formatReadability(confidence?: ReadabilityConfidence) {
  if (!confidence) {
    return "Needs review";
  }
  if (confidence === "UNREADABLE") {
    return "Needs review";
  }
  return confidence.charAt(0) + confidence.slice(1).toLowerCase();
}

function formatFieldSource(source?: "QR" | "OCR" | "DERIVED" | "NONE") {
  if (!source || source === "NONE") {
    return "Manual";
  }
  if (source === "DERIVED") {
    return "Derived";
  }
  return source;
}

function readabilityBadgeClass(confidence?: ReadabilityConfidence) {
  if (confidence === "HIGH") {
    return "rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-800";
  }
  if (confidence === "MEDIUM") {
    return "rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800";
  }
  if (confidence === "LOW") {
    return "rounded-full bg-orange-100 px-2 py-0.5 text-[11px] font-semibold text-orange-800";
  }
  return "rounded-full bg-slate-200 px-2 py-0.5 text-[11px] font-semibold text-slate-700";
}

function normalizeScanStatus(value: unknown): ReceiptScanStatus {
  if (value === "COMPLETE" || value === "PARTIAL" || value === "UNREADABLE") {
    return value;
  }
  return "PARTIAL";
}

function normalizeReceiptType(value: unknown): ReceiptType {
  if (value === "INVENTORY_PURCHASE" || value === "GENERAL_EXPENSE" || value === "UNCLEAR") {
    return value;
  }
  return "UNCLEAR";
}

function normalizeQrContentType(value: unknown): QrContentType {
  if (value === "TRA_URL" || value === "URL" || value === "STRUCTURED_TEXT" || value === "UNKNOWN" || value === "NONE") {
    return value;
  }
  return "UNKNOWN";
}

function normalizeQrDecodeStatus(value: unknown): QrDecodeStatus {
  if (value === "DECODED" || value === "NOT_DETECTED" || value === "DECODE_FAILED") {
    return value;
  }
  return "NOT_DETECTED";
}

function normalizeQrParseStatus(value: unknown): QrParseStatus {
  if (value === "PARSED" || value === "PARTIAL" || value === "UNPARSED") {
    return value;
  }
  return "UNPARSED";
}

function normalizeQrLookupStatus(value: unknown): QrLookupStatus {
  if (value === "NOT_ATTEMPTED" || value === "SUCCESS" || value === "FAILED") {
    return value;
  }
  return "NOT_ATTEMPTED";
}

function normalizeQrParseDetailStatus(value: unknown): QrParseDetailStatus {
  if (value === "NOT_ATTEMPTED" || value === "SUCCESS" || value === "PARTIAL" || value === "FAILED") {
    return value;
  }
  return "NOT_ATTEMPTED";
}

function formatQrContentType(type: QrContentType) {
  if (type === "TRA_URL") {
    return "TRA URL";
  }
  if (type === "STRUCTURED_TEXT") {
    return "Structured Text";
  }
  if (type === "URL") {
    return "URL";
  }
  if (type === "UNKNOWN") {
    return "Unknown";
  }
  return "None";
}

function formatQrDecodeStatus(type: QrDecodeStatus) {
  if (type === "DECODED") {
    return "QR captured";
  }
  if (type === "DECODE_FAILED") {
    return "QR detected, decode needs review";
  }
  return "QR not detected automatically";
}

function formatQrParseStatus(type: QrParseStatus) {
  if (type === "PARSED") {
    return "Parse success";
  }
  if (type === "PARTIAL") {
    return "Partially parsed";
  }
  return "Parsed with review needed";
}

function formatQrLookupStatus(type: QrLookupStatus) {
  if (type === "SUCCESS") {
    return "Lookup captured";
  }
  if (type === "FAILED") {
    return "Lookup needs review";
  }
  return "Not attempted";
}

function toReadability(value: unknown): ReadabilityConfidence {
  if (value === "HIGH" || value === "MEDIUM" || value === "LOW" || value === "UNREADABLE") {
    return value;
  }
  return "UNREADABLE";
}

function toReadabilityMap(value: unknown): Record<string, ReadabilityConfidence> {
  const candidate = asRecord(value);
  if (!candidate) {
    return {};
  }
  const normalized: Record<string, ReadabilityConfidence> = {};
  for (const [key, raw] of Object.entries(candidate)) {
    normalized[key] = toReadability(raw);
  }
  return normalized;
}

function toFieldSource(value: unknown): "QR" | "OCR" | "DERIVED" | "NONE" {
  if (value === "QR" || value === "OCR" || value === "DERIVED" || value === "NONE") {
    return value;
  }
  return "NONE";
}

function toFieldSourceMap(value: unknown): Record<string, "QR" | "OCR" | "DERIVED" | "NONE"> {
  const candidate = asRecord(value);
  if (!candidate) {
    return {};
  }
  const normalized: Record<string, "QR" | "OCR" | "DERIVED" | "NONE"> = {};
  for (const [key, raw] of Object.entries(candidate)) {
    normalized[key] = toFieldSource(raw);
  }
  return normalized;
}

function readDebugCandidates(value: unknown) {
  const debug = asRecord(value);
  const candidates = Array.isArray(debug?.ocrCandidates) ? debug.ocrCandidates : [];
  return candidates
    .map((entry) => {
      const candidate = asRecord(entry);
      if (!candidate) {
        return null;
      }
      return {
        label: asString(candidate.label) || "variant",
        confidence: Number(candidate.confidence || 0),
        score: Number(candidate.score || 0),
        textLength: Number(candidate.textLength || 0)
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
}

function clampNormalized(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  if (value < 0) {
    return 0;
  }
  if (value > 1) {
    return 1;
  }
  return value;
}

function formatPercent(value: number) {
  return `${Math.round(clampNormalized(value) * 100)}%`;
}
