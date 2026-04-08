import { inventoryCategoryOptions } from "@/lib/inventory";
import type {
  DuplicatePromptState,
  FieldConfidence,
  IntakeAllocationStatus,
  ReadabilityConfidence,
  ReceiptClassification,
  ReceiptIntakePanelProps,
  ReceiptSnapshotLine,
  ReceiptWorkflowChoice,
  ReviewLineState,
  ReviewState
} from "@/components/inventory/receipt-intake-panel";
import {
  readDebugCandidates,
  toFieldSource,
  toFieldSourceMap,
  toReadability,
  toReadabilityMap,
  normalizeQrContentType,
  normalizeQrDecodeStatus,
  normalizeQrLookupStatus,
  normalizeQrParseDetailStatus,
  normalizeQrParseStatus,
  normalizeReceiptType,
  normalizeScanStatus
} from "@/components/inventory/receipt-intake-scan-utils";
import {
  applyReceiptClassificationLineDefaults,
  formatReceiptPurposeLabel,
  mapRequisitionTypeToReceiptClassification,
  mapRequisitionTypeToWorkflowChoice,
  normalizeReceiptClassification,
  normalizeReceiptPurpose,
  normalizeReceiptWorkflowChoice,
  resolveExpenseOnlyCategory,
  resolveReceiptConfigForRequisitionType,
  resolveWorkflowChoiceFromClassification,
  resolveWorkflowSelectionConfig
} from "@/components/inventory/receipt-intake-workflow-utils";
import {
  buildSubmissionScanDiagnostics,
  calmMessage,
  readDebugFlags,
  readScanDiagnostics
} from "@/components/inventory/receipt-intake-save-readiness";

const RECEIPT_INTAKE_DEBUG_ENABLED =
  process.env.NEXT_PUBLIC_RECEIPT_INTAKE_DEBUG_UI === "1" &&
  process.env.NODE_ENV !== "production";

export function asString(value: unknown) {
  return typeof value === "string" ? value : "";
}

export function asRecord(value: unknown) {
  if (!value || typeof value !== "object") {
    return null;
  }
  return value as Record<string, unknown>;
}

export function extractReceiptPurposeFromDetails(details: Record<string, unknown>) {
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

export function readStringFieldValue({
  header,
  qrParsedFields,
  keys,
  fallback = ""
}: {
  header: Record<string, unknown> | null | undefined;
  qrParsedFields: Record<string, unknown> | null | undefined;
  keys: string[];
  fallback?: string;
}) {
  for (const source of [header, qrParsedFields]) {
    if (!source) {
      continue;
    }
    for (const key of keys) {
      const value = source[key];
      if (typeof value === "string" && value.trim().length > 0) {
        return value.trim();
      }
    }
  }
  return fallback;
}

export function readNumericFieldValue({
  header,
  qrParsedFields,
  keys,
  fallback = 0
}: {
  header: Record<string, unknown> | null | undefined;
  qrParsedFields: Record<string, unknown> | null | undefined;
  keys: string[];
  fallback?: number;
}) {
  for (const source of [header, qrParsedFields]) {
    if (!source) {
      continue;
    }
    for (const key of keys) {
      const raw = source[key];
      if (typeof raw === "number" && Number.isFinite(raw)) {
        return String(raw);
      }
      if (typeof raw === "string" && raw.trim().length > 0) {
        const normalized = Number(raw.replace(/,/g, ""));
        if (Number.isFinite(normalized)) {
          return String(normalized);
        }
      }
    }
  }
  return String(fallback);
}

export function readNumericFieldValueOptional({
  header,
  qrParsedFields,
  keys
}: {
  header: Record<string, unknown> | null | undefined;
  qrParsedFields: Record<string, unknown> | null | undefined;
  keys: string[];
}) {
  for (const source of [header, qrParsedFields]) {
    if (!source) {
      continue;
    }
    for (const key of keys) {
      const raw = source[key];
      if (typeof raw === "number" && Number.isFinite(raw)) {
        return String(raw);
      }
      if (typeof raw === "string" && raw.trim().length > 0) {
        const normalized = Number(raw.replace(/,/g, ""));
        if (Number.isFinite(normalized)) {
          return String(normalized);
        }
      }
    }
  }
  return "";
}

export function toNumericString(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? String(parsed) : "0";
}

export function formatMoneyText(value: string, currency: string) {
  const parsed = Number(value || 0);
  if (!Number.isFinite(parsed)) {
    return "-";
  }
  return `${parsed.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${(
    currency || "USD"
  ).toUpperCase()}`;
}

export function formatDateTimeText(value: string) {
  if (!value) {
    return "-";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleString();
}

export function hasMeaningfulExtractedPayload(extracted: Record<string, unknown>) {
  const header = asRecord(extracted.header);
  const qr = asRecord(extracted.qr);
  const qrParsedFields = asRecord(qr?.parsedFields);
  const extractedLines = mapExtractedLines(extracted.lines);
  if (extractedLines.some((line) => isMeaningfulSnapshotLine({
    id: line.id,
    description: line.description,
    quantity: line.quantity,
    unitPrice: line.unitPrice,
    lineTotal: line.lineTotal
  }))) {
    return true;
  }

  const identityKeys = [
    "supplierName",
    "receiptNumber",
    "verificationCode",
    "traReceiptNumber",
    "serialNumber",
    "invoiceReference",
    "tin",
    "vrn"
  ];
  for (const source of [header, qrParsedFields]) {
    if (!source) {
      continue;
    }
    for (const key of identityKeys) {
      const value = source[key];
      if (typeof value === "string" && value.trim().length > 0) {
        return true;
      }
    }
  }

  const numericKeys = ["subtotal", "tax", "total"];
  for (const source of [header, qrParsedFields]) {
    if (!source) {
      continue;
    }
    for (const key of numericKeys) {
      const raw = source[key];
      const parsed =
        typeof raw === "number"
          ? raw
          : typeof raw === "string"
            ? Number(raw.replace(/,/g, ""))
            : Number.NaN;
      if (Number.isFinite(parsed) && parsed > 0) {
        return true;
      }
    }
  }

  const qrHasDecodedCore =
    qr?.decodeStatus === "DECODED" ||
    qr?.parseStatus === "PARSED" ||
    qr?.fieldsParseStatus === "SUCCESS" ||
    qr?.lineItemsParseStatus === "SUCCESS";
  if (qrHasDecodedCore) {
    const hasQrIdentityFields = [
      asString(qrParsedFields?.verificationCode),
      asString(qrParsedFields?.traReceiptNumber),
      asString(qrParsedFields?.tin),
      asString(qrParsedFields?.receiptNumber),
      asString(qrParsedFields?.supplierName)
    ].some((value) => value.trim().length > 0);
    if (hasQrIdentityFields) {
      return true;
    }
    const verificationUrl =
      typeof qr?.verificationUrl === "string" ? qr.verificationUrl.trim() : "";
    const rawValue = typeof qr?.rawValue === "string" ? qr.rawValue.trim() : "";
    if (verificationUrl.length > 0 || rawValue.length > 0) {
      return true;
    }
  }

  const qrLookup = asRecord(asRecord(qr?.stages)?.verificationLookup);
  if (asString(qrLookup?.status).toUpperCase() === "SUCCESS") {
    return true;
  }
  return false;
}

export function hasMeaningfulReviewData(review: ReviewState) {
  const meaningfulScannedLines = review.scannedSnapshot.lines.filter((line) => isMeaningfulSnapshotLine(line));
  if (meaningfulScannedLines.length > 0) {
    return true;
  }
  if (
    review.scannedSnapshot.supplierName ||
    review.scannedSnapshot.receiptNumber ||
    review.scannedSnapshot.receiptDate ||
    review.verificationCode ||
    review.traReceiptNumber ||
    review.serialNumber ||
    review.tin ||
    review.vrn
  ) {
    return true;
  }
  if (Number(review.scannedSnapshot.total || 0) > 0) {
    return true;
  }
  const qrHasDecodedCore =
    review.qrDecodeStatus === "DECODED" ||
    review.qrParseStatus === "PARSED" ||
    review.qrFieldsParseStatus === "SUCCESS" ||
    review.qrLineItemsParseStatus === "SUCCESS";
  if (
    qrHasDecodedCore &&
    (
      review.verificationCode.trim().length > 0 ||
      review.traReceiptNumber.trim().length > 0 ||
      review.verificationUrl.trim().length > 0 ||
      review.rawQrValue.trim().length > 0
    )
  ) {
    return true;
  }
  return false;
}

export function isMeaningfulSnapshotLine(line: ReceiptSnapshotLine) {
  const normalizedDescription = normalizeLineDescription(line.description);
  const hasUsefulDescription =
    normalizedDescription.length > 0 && normalizedDescription !== "unparsed receipt item";
  const hasNumericSignals =
    Number(line.quantity || 0) > 0 ||
    Number(line.unitPrice || 0) > 0 ||
    Number(line.lineTotal || 0) > 0;
  return hasUsefulDescription || hasNumericSignals;
}

export function mapExtractedLines(linesValue: unknown): ReviewLineState[] {
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

export function mapRequisitionCategoryToInventoryCategory(value: string | null | undefined): string {
  if (!value) {
    return "OTHER";
  }
  const normalized = value.trim().toUpperCase().replace(/\s+/g, "_");
  if (inventoryCategoryOptions.some((entry) => entry.value === normalized)) {
    return normalized;
  }
  if (normalized.includes("OIL") || normalized.includes("LUB")) {
    return "OILS";
  }
  if (normalized.includes("FILTER")) {
    return "FILTERS";
  }
  if (normalized.includes("TIRE")) {
    return "TIRES";
  }
  if (normalized.includes("HYDRAULIC")) {
    return "HYDRAULIC";
  }
  if (normalized.includes("ELECT")) {
    return "ELECTRICAL";
  }
  if (normalized.includes("SPARE")) {
    return "SPARE_PARTS";
  }
  if (normalized.includes("CONSUM")) {
    return "CONSUMABLES";
  }
  if (normalized.includes("DRILL")) {
    return "DRILLING";
  }
  return "OTHER";
}

export function resolveRequisitionEstimatedTotal(initialRequisition: ReceiptIntakePanelProps["initialRequisition"]) {
  if (!initialRequisition?.totals) {
    return 0;
  }
  const approvedTotal = Number(initialRequisition.totals.approvedTotalCost || 0);
  if (Number.isFinite(approvedTotal) && approvedTotal > 0) {
    return approvedTotal;
  }
  const estimatedTotal = Number(initialRequisition.totals.estimatedTotalCost || 0);
  if (Number.isFinite(estimatedTotal) && estimatedTotal > 0) {
    return estimatedTotal;
  }
  return 0;
}

export function mapRequisitionLineItems(
  initialRequisition: ReceiptIntakePanelProps["initialRequisition"],
  classification: ReceiptClassification
): ReviewLineState[] {
  if (!initialRequisition || !Array.isArray(initialRequisition.lineItems)) {
    return [];
  }
  const selectedCategory = mapRequisitionCategoryToInventoryCategory(initialRequisition.category);
  const subcategorySuffix = initialRequisition.subcategory?.trim()
    ? ` • ${initialRequisition.subcategory.trim()}`
    : "";
  return initialRequisition.lineItems
    .map((line, index) => {
      const description = String(line.description || "").trim();
      if (!description) {
        return null;
      }
      const quantity = Number(line.quantity || 0);
      const unitPrice = Number(line.estimatedUnitCost || 0);
      const total = Number(line.estimatedTotalCost || 0);
      const safeQuantity = Number.isFinite(quantity) && quantity > 0 ? quantity : 1;
      const safeUnitPrice = Number.isFinite(unitPrice) && unitPrice >= 0 ? unitPrice : 0;
      const safeTotal =
        Number.isFinite(total) && total > 0 ? total : Math.max(0, safeQuantity * safeUnitPrice);
      return {
        id: `req-${line.id || index + 1}`,
        description,
        quantity: String(safeQuantity),
        unitPrice: String(safeUnitPrice),
        lineTotal: String(safeTotal),
        extractionConfidence: "MEDIUM",
        selectedCategory,
        suggestedCategory: selectedCategory === "OTHER" ? null : selectedCategory,
        categoryReason: `Prefilled from approved requisition category${subcategorySuffix || ""}.`,
        mode:
          classification === "EXPENSE_ONLY"
            ? "EXPENSE_ONLY"
            : classification === "INTERNAL_TRANSFER"
              ? "MATCH"
              : "NEW",
        selectedItemId: "",
        matchConfidence: "NONE",
        matchScore: 0,
        newItemName: description,
        newItemSku: "",
        newItemMinimumStockLevel: "0"
      };
    })
    .filter((line): line is ReviewLineState => Boolean(line));
}

export function resolveReviewLinesWithRequisitionFallback({
  extractedLines,
  initialRequisition,
  classification
}: {
  extractedLines: ReviewLineState[];
  initialRequisition: ReceiptIntakePanelProps["initialRequisition"];
  classification: ReceiptClassification;
}) {
  if (extractedLines.length > 0) {
    return extractedLines;
  }
  return mapRequisitionLineItems(initialRequisition, classification);
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

export function buildReviewStateFromSubmission({
  submission,
  defaultClientId,
  defaultRigId,
  initialRequisition
}: {
  submission: NonNullable<ReceiptIntakePanelProps["activeSubmission"]>;
  defaultClientId: string;
  defaultRigId: string;
  initialRequisition: ReceiptIntakePanelProps["initialRequisition"];
}): ReviewState {
  const draft = submission.draft || {};
  const receipt = draft.receipt || {};
  const linkContext = draft.linkContext || {};
  const normalizedClassification = normalizeReceiptClassification(asString(draft.receiptType));
  const normalizedWorkflowChoice = normalizeReceiptWorkflowChoice(asString(draft.workflowType));
  const submittedLines = Array.isArray(draft.lines) ? draft.lines : [];
  const requisitionFromDraft = asString(draft.requisitionId);
  const requisitionLink = resolveRequisitionLink({
    requisitionId: requisitionFromDraft,
    initialRequisition
  });
  const draftReceiptPurpose = normalizeReceiptPurpose(asString(draft.receiptPurpose));
  const draftCreateExpense = typeof draft.createExpense === "boolean" ? draft.createExpense : undefined;
  const workflowChoice = requisitionLink.type
    ? mapRequisitionTypeToWorkflowChoice(requisitionLink.type)
    : normalizedWorkflowChoice ||
      resolveWorkflowChoiceFromClassification({
        receiptClassification: normalizedClassification,
        receiptPurpose: draftReceiptPurpose,
        createExpense: draftCreateExpense
      });
  const workflowConfig = resolveWorkflowSelectionConfig(workflowChoice);
  const effectiveClassification = requisitionLink.type
    ? mapRequisitionTypeToReceiptClassification(requisitionLink.type)
    : normalizedWorkflowChoice
      ? workflowConfig.classification
      : normalizedClassification;
  const receiptConfig = requisitionLink.type
    ? resolveReceiptConfigForRequisitionType(requisitionLink.type)
    : normalizedWorkflowChoice
      ? { receiptPurpose: workflowConfig.receiptPurpose, createExpense: workflowConfig.createExpense }
      : resolveReceiptConfigForClassification(effectiveClassification);
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
    effectiveClassification
  );

  const effectiveReceiptPurpose = requisitionLink.type
    ? receiptConfig.receiptPurpose
    : normalizedWorkflowChoice
      ? workflowConfig.receiptPurpose
      : draftReceiptPurpose;
  const effectiveCreateExpense = requisitionLink.type
    ? receiptConfig.createExpense
    : normalizedWorkflowChoice
      ? workflowConfig.createExpense
      : typeof draft.createExpense === "boolean"
        ? draft.createExpense
        : receiptConfig.createExpense;
  const defaultClientForWorkflow =
    workflowChoice === "PROJECT_PURCHASE" || workflowChoice === "MAINTENANCE_PURCHASE"
      ? defaultClientId
      : "";
  const defaultRigForWorkflow =
    workflowChoice === "PROJECT_PURCHASE" || workflowChoice === "MAINTENANCE_PURCHASE"
      ? defaultRigId
      : "";
  const scannedSnapshotLines = lines.map((line) => ({
    id: line.id,
    description: line.description,
    quantity: line.quantity,
    unitPrice: line.unitPrice,
    lineTotal: line.lineTotal
  }));
  return {
    requisitionId: requisitionLink.id,
    requisitionCode: requisitionLink.code,
    requisitionType: requisitionLink.type,
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
    currency: asString(receipt.currency) || "USD",
    subtotal: toNumericString(receipt.subtotal),
    tax: toNumericString(receipt.tax),
    total: toNumericString(receipt.total),
    clientId: requisitionLink.clientId || asString(linkContext.clientId) || defaultClientForWorkflow,
    projectId: requisitionLink.projectId || asString(linkContext.projectId),
    rigId: requisitionLink.rigId || asString(linkContext.rigId) || defaultRigForWorkflow,
    maintenanceRequestId:
      requisitionLink.maintenanceRequestId || asString(linkContext.maintenanceRequestId),
    locationFromId: asString(linkContext.locationFromId),
    locationToId: asString(linkContext.locationToId),
    expenseOnlyCategory: resolveExpenseOnlyCategory(asString(draft.expenseOnlyCategory)) || "",
    createExpense: effectiveCreateExpense,
    receiptPurpose: effectiveReceiptPurpose,
    receiptWorkflowChoice: workflowChoice,
    receiptClassification: effectiveClassification,
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
    scannedSnapshot: {
      supplierName: normalizeSupplierName(asString(receipt.supplierName)),
      receiptNumber: asString(receipt.receiptNumber),
      receiptDate: asString(receipt.receiptDate),
      total: toNumericString(receipt.total),
      lines: scannedSnapshotLines
    },
    scanDiagnostics: buildSubmissionScanDiagnostics({
      rawQrValue: asString(receipt.rawQrValue),
      verificationUrl: asString(receipt.verificationUrl),
      scanStatus: "PARTIAL",
      extractionMethod: "SUBMISSION"
    }),
    scanFallbackMode: "NONE",
    lines
  };
}

export function buildReviewStateFromPayload({
  payload,
  receiptFileName,
  defaultClientId,
  defaultRigId,
  receiptClassification,
  receiptWorkflowChoice,
  initialRequisition
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
  receiptWorkflowChoice: ReceiptWorkflowChoice | "";
  initialRequisition: ReceiptIntakePanelProps["initialRequisition"];
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
  if (RECEIPT_INTAKE_DEBUG_ENABLED) {
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
  const requisitionLink = resolveRequisitionLink({
    requisitionId: "",
    initialRequisition
  });
  const workflowChoice = requisitionLink.type
    ? mapRequisitionTypeToWorkflowChoice(requisitionLink.type)
    : receiptWorkflowChoice ||
      resolveWorkflowChoiceFromClassification({
        receiptClassification,
        receiptPurpose: "INVENTORY_PURCHASE",
        createExpense: false
      });
  const workflowConfig = resolveWorkflowSelectionConfig(workflowChoice);
  const effectiveClassification = requisitionLink.type
    ? mapRequisitionTypeToReceiptClassification(requisitionLink.type)
    : workflowConfig.classification;
  const receiptConfig = requisitionLink.type
    ? resolveReceiptConfigForRequisitionType(requisitionLink.type)
    : {
        receiptPurpose: workflowConfig.receiptPurpose,
        createExpense: workflowConfig.createExpense
      };
  const requisitionFallbackLines = mapRequisitionLineItems(
    initialRequisition,
    effectiveClassification
  );
  const extractedLines = mapExtractedLines(extracted.lines);
  const lines = resolveReviewLinesWithRequisitionFallback({
    extractedLines,
    initialRequisition,
    classification: effectiveClassification
  });
  const scannedReceiptNumber = readStringFieldValue({
    header: extractedHeader,
    qrParsedFields,
    keys: ["receiptNumber", "receiptNo", "receipt"]
  });
  const scannedReceiptDate = readStringFieldValue({
    header: extractedHeader,
    qrParsedFields,
    keys: ["receiptDate", "date"]
  });
  const scannedSubtotal = readNumericFieldValueOptional({
    header: extractedHeader,
    qrParsedFields,
    keys: ["subtotal", "subTotal", "amountBeforeTax"]
  });
  const scannedTax = readNumericFieldValueOptional({
    header: extractedHeader,
    qrParsedFields,
    keys: ["tax", "vat"]
  });
  const scannedTotal = readNumericFieldValueOptional({
    header: extractedHeader,
    qrParsedFields,
    keys: ["total", "amount", "grossTotal"]
  });
  const scannedSnapshotLines = extractedLines.map((line) => ({
    id: line.id,
    description: line.description,
    quantity: line.quantity,
    unitPrice: line.unitPrice,
    lineTotal: line.lineTotal
  }));

  const defaultClientForWorkflow =
    workflowChoice === "PROJECT_PURCHASE" || workflowChoice === "MAINTENANCE_PURCHASE"
      ? defaultClientId
      : "";
  const defaultRigForWorkflow =
    workflowChoice === "MAINTENANCE_PURCHASE" || workflowChoice === "PROJECT_PURCHASE"
      ? defaultRigId
      : "";

  return {
    requisitionId: requisitionLink.id,
    requisitionCode: requisitionLink.code,
    requisitionType: requisitionLink.type,
    receiptUrl: payload.receipt?.url || "",
    receiptFileName: payload.receipt?.fileName || receiptFileName,
    supplierId: asString(supplierSuggestion.supplierId),
    supplierName: resolvedSupplierName,
    tin: readStringFieldValue({
      header: extractedHeader,
      qrParsedFields,
      keys: ["tin"]
    }),
    vrn: readStringFieldValue({
      header: extractedHeader,
      qrParsedFields,
      keys: ["vrn", "vatNo"]
    }),
    serialNumber: readStringFieldValue({
      header: extractedHeader,
      qrParsedFields,
      keys: ["serialNumber", "serialNo", "serial"]
    }),
    receiptNumber: scannedReceiptNumber,
    verificationCode: readStringFieldValue({
      header: extractedHeader,
      qrParsedFields,
      keys: ["verificationCode", "verifyCode", "code"]
    }),
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
    receiptDate: scannedReceiptDate,
    receiptTime: readStringFieldValue({
      header: extractedHeader,
      qrParsedFields,
      keys: ["receiptTime", "time"]
    }),
    traReceiptNumber: readStringFieldValue({
      header: extractedHeader,
      qrParsedFields,
      keys: ["traReceiptNumber", "zNo", "znumber", "zno"]
    }),
    invoiceReference: readStringFieldValue({
      header: extractedHeader,
      qrParsedFields,
      keys: ["invoiceReference", "invoiceNo", "invoiceNumber", "invoice"]
    }),
    paymentMethod: readStringFieldValue({
      header: extractedHeader,
      qrParsedFields,
      keys: ["paymentMethod", "payment"]
    }),
    taxOffice: readStringFieldValue({
      header: extractedHeader,
      qrParsedFields,
      keys: ["taxOffice", "office"]
    }),
    currency:
      readStringFieldValue({
        header: extractedHeader,
        qrParsedFields,
        keys: ["currency"]
      }) || "USD",
    subtotal: scannedSubtotal,
    tax: scannedTax,
    total: scannedTotal,
    clientId: requisitionLink.clientId || defaultClientForWorkflow,
    projectId: requisitionLink.projectId || "",
    rigId: requisitionLink.rigId || defaultRigForWorkflow,
    maintenanceRequestId: requisitionLink.maintenanceRequestId || "",
    locationFromId: "",
    locationToId: "",
    expenseOnlyCategory: "",
    createExpense: receiptConfig.createExpense,
    receiptPurpose: receiptConfig.receiptPurpose,
    receiptWorkflowChoice: workflowChoice,
    receiptClassification: effectiveClassification,
    warnings: Array.isArray(extracted.warnings)
      ? Array.from(
          new Set(
            [
              ...extracted.warnings.map((warning) => calmMessage(asString(warning))).filter(Boolean),
              ...(extractedLines.length === 0 && requisitionFallbackLines.length > 0
                ? ["No receipt line items were extracted. Prefilled requisition line items for manual review."]
                : [])
            ].filter(Boolean)
          )
        )
      : extractedLines.length === 0 && requisitionFallbackLines.length > 0
        ? ["No receipt line items were extracted. Prefilled requisition line items for manual review."]
        : [],
    extractionMethod: asString(extracted.extractionMethod) || "UNKNOWN",
    scanStatus: normalizeScanStatus(extracted.scanStatus),
    receiptType: normalizeReceiptType(extracted.receiptType),
    fieldConfidence: supplierFieldMaps.fieldConfidence,
    fieldSource: supplierFieldMaps.fieldSource,
    rawTextPreview: asString(extracted.rawTextPreview),
    debugFlags: readDebugFlags(payload),
    debugCandidates: readDebugCandidates(extracted.debug),
    scannedSnapshot: {
      supplierName: resolvedSupplierName,
      receiptNumber: scannedReceiptNumber,
      receiptDate: scannedReceiptDate,
      total: scannedTotal,
      lines: scannedSnapshotLines
    },
    scanDiagnostics: readScanDiagnostics(payload, extracted),
    scanFallbackMode: "NONE",
    lines: applyReceiptClassificationLineDefaults(lines, effectiveClassification)
  };
}

export function buildManualAssistReview({
  payload,
  receiptFileName,
  defaultClientId,
  defaultRigId,
  warning,
  fallbackMode,
  receiptClassification,
  receiptWorkflowChoice,
  initialRequisition
}: {
  payload: unknown;
  receiptFileName: string;
  defaultClientId: string;
  defaultRigId: string;
  warning: string;
  fallbackMode: "SCAN_FAILURE" | "MANUAL_ENTRY";
  receiptClassification: ReceiptClassification;
  receiptWorkflowChoice: ReceiptWorkflowChoice | "";
  initialRequisition: ReceiptIntakePanelProps["initialRequisition"];
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
  if (RECEIPT_INTAKE_DEBUG_ENABLED) {
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
  const requisitionLink = resolveRequisitionLink({
    requisitionId: "",
    initialRequisition
  });
  const workflowChoice = requisitionLink.type
    ? mapRequisitionTypeToWorkflowChoice(requisitionLink.type)
    : receiptWorkflowChoice ||
      resolveWorkflowChoiceFromClassification({
        receiptClassification,
        receiptPurpose: "INVENTORY_PURCHASE",
        createExpense: false
      });
  const workflowConfig = resolveWorkflowSelectionConfig(workflowChoice);
  const effectiveClassification = requisitionLink.type
    ? mapRequisitionTypeToReceiptClassification(requisitionLink.type)
    : workflowConfig.classification;
  const receiptConfig = requisitionLink.type
    ? resolveReceiptConfigForRequisitionType(requisitionLink.type)
    : {
        receiptPurpose: workflowConfig.receiptPurpose,
        createExpense: workflowConfig.createExpense
      };
  const requisitionEstimatedTotal = resolveRequisitionEstimatedTotal(initialRequisition);
  const requisitionFallbackLines = mapRequisitionLineItems(
    initialRequisition,
    effectiveClassification
  );
  const extractedLines = mapExtractedLines(extracted?.lines);
  const lines = resolveReviewLinesWithRequisitionFallback({
    extractedLines,
    initialRequisition,
    classification: effectiveClassification
  });
  const fallbackSupplierName = normalizeSupplierName(
    asString(initialRequisition?.requestedVendorName)
  );
  const scannedReceiptNumber = readStringFieldValue({
    header: extractedHeader,
    qrParsedFields,
    keys: ["receiptNumber", "receiptNo", "receipt"]
  });
  const scannedReceiptDate = readStringFieldValue({
    header: extractedHeader,
    qrParsedFields,
    keys: ["receiptDate", "date"]
  });
  const scannedTotal = readNumericFieldValueOptional({
    header: extractedHeader,
    qrParsedFields,
    keys: ["total", "amount", "grossTotal"]
  });
  const scannedSnapshotLines = extractedLines.map((line) => ({
    id: line.id,
    description: line.description,
    quantity: line.quantity,
    unitPrice: line.unitPrice,
    lineTotal: line.lineTotal
  }));

  const defaultClientForWorkflow =
    workflowChoice === "PROJECT_PURCHASE" || workflowChoice === "MAINTENANCE_PURCHASE"
      ? defaultClientId
      : "";
  const defaultRigForWorkflow =
    workflowChoice === "MAINTENANCE_PURCHASE" || workflowChoice === "PROJECT_PURCHASE"
      ? defaultRigId
      : "";

  const warnings = [
    calmMessage(warning),
    ...(extractedLines.length === 0 && requisitionFallbackLines.length > 0
      ? ["Receipt lines could not be extracted. Prefilled line items from the approved requisition."]
      : []),
    ...(Array.isArray(extracted?.warnings)
      ? extracted?.warnings.map((entry) => calmMessage(asString(entry))).filter(Boolean)
      : [])
  ];

  return {
    requisitionId: requisitionLink.id,
    requisitionCode: requisitionLink.code,
    requisitionType: requisitionLink.type,
    receiptUrl: asString(receipt?.url),
    receiptFileName: asString(receipt?.fileName) || receiptFileName,
    supplierId: asString(supplierSuggestion?.supplierId),
    supplierName: resolvedSupplierName || fallbackSupplierName,
    tin: readStringFieldValue({
      header: extractedHeader,
      qrParsedFields,
      keys: ["tin"]
    }),
    vrn: readStringFieldValue({
      header: extractedHeader,
      qrParsedFields,
      keys: ["vrn", "vatNo"]
    }),
    serialNumber: readStringFieldValue({
      header: extractedHeader,
      qrParsedFields,
      keys: ["serialNumber", "serialNo", "serial"]
    }),
    receiptNumber: readStringFieldValue({
      header: extractedHeader,
      qrParsedFields,
      keys: ["receiptNumber", "receiptNo", "receipt"]
    }),
    verificationCode: readStringFieldValue({
      header: extractedHeader,
      qrParsedFields,
      keys: ["verificationCode", "verifyCode", "code"]
    }),
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
    receiptDate:
      readStringFieldValue({
        header: extractedHeader,
        qrParsedFields,
        keys: ["receiptDate", "date"]
      }) || new Date().toISOString().slice(0, 10),
    receiptTime: readStringFieldValue({
      header: extractedHeader,
      qrParsedFields,
      keys: ["receiptTime", "time"]
    }),
    traReceiptNumber: readStringFieldValue({
      header: extractedHeader,
      qrParsedFields,
      keys: ["traReceiptNumber", "zNo", "znumber", "zno"]
    }),
    invoiceReference: readStringFieldValue({
      header: extractedHeader,
      qrParsedFields,
      keys: ["invoiceReference", "invoiceNo", "invoiceNumber", "invoice"]
    }),
    paymentMethod: readStringFieldValue({
      header: extractedHeader,
      qrParsedFields,
      keys: ["paymentMethod", "payment"]
    }),
    taxOffice: readStringFieldValue({
      header: extractedHeader,
      qrParsedFields,
      keys: ["taxOffice", "office"]
    }),
    currency:
      readStringFieldValue({
        header: extractedHeader,
        qrParsedFields,
        keys: ["currency"]
      }) || "USD",
    subtotal: readNumericFieldValue({
      header: extractedHeader,
      qrParsedFields,
      keys: ["subtotal", "subTotal", "amountBeforeTax"],
      fallback: requisitionEstimatedTotal
    }),
    tax: readNumericFieldValue({
      header: extractedHeader,
      qrParsedFields,
      keys: ["tax", "vat"],
      fallback: 0
    }),
    total: readNumericFieldValue({
      header: extractedHeader,
      qrParsedFields,
      keys: ["total", "amount", "grossTotal"],
      fallback: requisitionEstimatedTotal
    }),
    clientId: requisitionLink.clientId || defaultClientForWorkflow,
    projectId: requisitionLink.projectId || "",
    rigId: requisitionLink.rigId || defaultRigForWorkflow,
    maintenanceRequestId: requisitionLink.maintenanceRequestId || "",
    locationFromId: "",
    locationToId: "",
    expenseOnlyCategory: "",
    createExpense: receiptConfig.createExpense,
    receiptPurpose: receiptConfig.receiptPurpose,
    receiptWorkflowChoice: workflowChoice,
    receiptClassification: effectiveClassification,
    warnings: Array.from(new Set(warnings.filter(Boolean))),
    extractionMethod:
      asString(extracted?.extractionMethod) ||
      (requisitionFallbackLines.length > 0 ? "REQUISITION_FALLBACK" : "UNKNOWN"),
    scanStatus,
    receiptType: normalizeReceiptType(extracted?.receiptType),
    fieldConfidence: supplierFieldMaps.fieldConfidence,
    fieldSource: supplierFieldMaps.fieldSource,
    rawTextPreview: asString(extracted?.rawTextPreview),
    debugFlags: readDebugFlags(root),
    debugCandidates: readDebugCandidates(extracted?.debug),
    scannedSnapshot: {
      supplierName: resolvedSupplierName,
      receiptNumber: scannedReceiptNumber,
      receiptDate: scannedReceiptDate,
      total: scannedTotal,
      lines: scannedSnapshotLines
    },
    scanDiagnostics: readScanDiagnostics(root, extracted),
    scanFallbackMode: fallbackMode,
    lines: applyReceiptClassificationLineDefaults(lines, effectiveClassification)
  };
}

export function resolveSupplierName({
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

export function resolveRequisitionLink({
  requisitionId,
  initialRequisition
}: {
  requisitionId: string;
  initialRequisition: ReceiptIntakePanelProps["initialRequisition"];
}): {
  id: string;
  code: string;
  type: "LIVE_PROJECT_PURCHASE" | "INVENTORY_STOCK_UP" | "MAINTENANCE_PURCHASE" | "";
  clientId: string;
  projectId: string;
  rigId: string;
  maintenanceRequestId: string;
} {
  const normalizedId = requisitionId.trim();
  if (normalizedId) {
    return {
      id: normalizedId,
      code: initialRequisition?.id === normalizedId ? initialRequisition.requisitionCode : "",
      type:
        initialRequisition?.id === normalizedId
          ? initialRequisition.type
          : "",
      clientId:
        initialRequisition?.id === normalizedId ? initialRequisition.clientId || "" : "",
      projectId:
        initialRequisition?.id === normalizedId ? initialRequisition.projectId || "" : "",
      rigId: initialRequisition?.id === normalizedId ? initialRequisition.rigId || "" : "",
      maintenanceRequestId:
        initialRequisition?.id === normalizedId
          ? initialRequisition.maintenanceRequestId || ""
          : ""
    };
  }
  if (!initialRequisition) {
    return {
      id: "",
      code: "",
      type: "",
      clientId: "",
      projectId: "",
      rigId: "",
      maintenanceRequestId: ""
    };
  }
  return {
    id: initialRequisition.id,
    code: initialRequisition.requisitionCode,
    type: initialRequisition.type,
    clientId: initialRequisition.clientId || "",
    projectId: initialRequisition.projectId || "",
    rigId: initialRequisition.rigId || "",
    maintenanceRequestId: initialRequisition.maintenanceRequestId || ""
  };
}

export function normalizeSupplierName(value: string) {
  return value
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

export function applySupplierFieldOverrides({
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

export function isReceiptExtractSuccessPayload(payload: unknown): payload is {
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

export function isDuplicateCommitPayload(payload: unknown): payload is {
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

export function readDuplicateReviewPayload(
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

export function isReceiptCommitSuccessPayload(payload: unknown): payload is {
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

export function deriveAllocationStatus(clientId: string, projectId: string): IntakeAllocationStatus {
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

export function normalizeAllocationStatus(value: unknown): IntakeAllocationStatus {
  if (value === "ALLOCATED" || value === "PARTIALLY_ALLOCATED" || value === "UNALLOCATED") {
    return value;
  }
  return "UNALLOCATED";
}

function resolveReceiptConfigForClassification(receiptClassification: ReceiptClassification): {
  receiptPurpose: ReviewState["receiptPurpose"];
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

function normalizeLineDescription(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
