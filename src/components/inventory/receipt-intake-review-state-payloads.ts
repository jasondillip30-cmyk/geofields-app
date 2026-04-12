import type {
  DuplicatePromptState,
  IntakeAllocationStatus
} from "@/components/inventory/receipt-intake-panel-types";
import { asRecord, asString } from "@/components/inventory/receipt-intake-review-state-primitives";

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
