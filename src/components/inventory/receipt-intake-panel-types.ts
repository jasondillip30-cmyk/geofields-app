import type { FocusedLinkedRecord } from "@/components/inventory/receipt-intake-panel-fields";

export type FieldConfidence = "HIGH" | "MEDIUM" | "LOW" | "NONE";
export type ReadabilityConfidence = "HIGH" | "MEDIUM" | "LOW" | "UNREADABLE";
export type ReceiptScanStatus = "COMPLETE" | "PARTIAL" | "UNREADABLE";
export type ReceiptType = "INVENTORY_PURCHASE" | "GENERAL_EXPENSE" | "UNCLEAR";
export type ExpenseOnlyCategory = "TRAVEL" | "FOOD" | "FUEL" | "MISC";
export type QrContentType = "TRA_URL" | "URL" | "STRUCTURED_TEXT" | "UNKNOWN" | "NONE";
export type QrDecodeStatus = "DECODED" | "NOT_DETECTED" | "DECODE_FAILED";
export type QrParseStatus = "PARSED" | "PARTIAL" | "UNPARSED";
export type QrLookupStatus = "NOT_ATTEMPTED" | "SUCCESS" | "FAILED";
export type QrParseDetailStatus = "NOT_ATTEMPTED" | "SUCCESS" | "PARTIAL" | "FAILED";
export type ExtractState = "IDLE" | "UPLOADING" | "PROCESSING" | "SUCCESS" | "FAILED";
export type CameraSessionState = "idle" | "requesting" | "ready" | "detected" | "error";
export type NoticeTone = "SUCCESS" | "WARNING";
export type RequisitionComparisonStatus =
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
export type ReceiptInputMethod = "SCAN" | "MANUAL";
export type ReceiptFollowUpStage = "SCAN" | "REVIEW" | "FINALIZE";
export type ReceiptCaptureMode = "SCAN" | "MANUAL";
export interface CameraScanConfirmPayload {
  rawPayload: string;
  capturedFrameFile?: File | null;
}
export type ScanFailureStage =
  | "NONE"
  | "QR_NOT_DETECTED"
  | "QR_DECODE_FAILED"
  | "QR_PARSE_UNPARSED"
  | "TRA_LOOKUP_FAILED"
  | "FRONTEND_MAPPING_EMPTY";
export type IntakeAllocationStatus = "ALLOCATED" | "PARTIALLY_ALLOCATED" | "UNALLOCATED";

export const RECEIPT_INTAKE_DEBUG_ENABLED =
  process.env.NEXT_PUBLIC_RECEIPT_INTAKE_DEBUG_UI === "1" &&
  process.env.NODE_ENV !== "production";

export const SCAN_FALLBACK_MESSAGE = "Scan could not extract receipt data. Please complete manually.";

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

export interface FocusedRecordPayload {
  record: FocusedLinkedRecord;
  details: Record<string, unknown>;
}

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
