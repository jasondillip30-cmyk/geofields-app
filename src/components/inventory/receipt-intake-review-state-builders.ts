import type {
  ReadabilityConfidence,
  ReceiptClassification,
  ReceiptIntakePanelProps,
  ReceiptWorkflowChoice,
  ReviewState
} from "@/components/inventory/receipt-intake-panel-types";
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
import {
  asRecord,
  asString,
  readNumericFieldValue,
  readNumericFieldValueOptional,
  readStringFieldValue,
  toNumericString
} from "@/components/inventory/receipt-intake-review-state-primitives";
import { mapExtractedLines } from "@/components/inventory/receipt-intake-review-state-lines";
import {
  mapRequisitionLineItems,
  normalizeSupplierName,
  resolveRequisitionEstimatedTotal,
  resolveRequisitionLink,
  resolveReviewLinesWithRequisitionFallback
} from "@/components/inventory/receipt-intake-review-state-domain";

const RECEIPT_INTAKE_DEBUG_ENABLED =
  process.env.NEXT_PUBLIC_RECEIPT_INTAKE_DEBUG_UI === "1" &&
  process.env.NODE_ENV !== "production";

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
      const mode =
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
