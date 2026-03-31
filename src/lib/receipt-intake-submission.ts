import {
  deriveReceiptApprovalClassification,
  normalizeReceiptPurpose,
  normalizeReceiptType,
  type ReceiptApprovalClassification,
  type ReceiptPurpose,
  type ReceiptType
} from "@/lib/receipt-approval-classification";

export type ReceiptSubmissionStatus = "SUBMITTED" | "APPROVED" | "REJECTED";

interface SubmissionActor {
  userId: string;
  name: string;
  role: string;
}

interface SubmissionReviewer extends SubmissionActor {
  decision: string;
  decidedAt: string;
  note: string;
}

interface SubmissionResolution {
  movementCount: number;
  itemsCreatedCount: number;
  expenseId: string;
}

interface NormalizedDraftReceipt {
  supplierName: string;
  receiptNumber: string;
  verificationCode: string;
  serialNumber: string;
  receiptDate: string;
  total: number;
  traReceiptNumber: string;
}

interface NormalizedDraftLinkContext {
  clientId: string;
  projectId: string;
  rigId: string;
  maintenanceRequestId: string;
  locationFromId: string;
  locationToId: string;
}

export interface ParsedReceiptSubmissionPayload {
  status: ReceiptSubmissionStatus;
  submissionStatus: string;
  submittedAt: string;
  submittedBy: SubmissionActor;
  reviewer: SubmissionReviewer | null;
  resolution: SubmissionResolution | null;
  draft: Record<string, unknown>;
  normalizedDraft:
    | {
        receiptType: ReceiptType;
        receiptPurpose: ReceiptPurpose;
        createExpense: boolean;
        receipt: NormalizedDraftReceipt;
        linkContext: NormalizedDraftLinkContext;
      }
    | null;
  classification: ReceiptApprovalClassification | null;
  raw: Record<string, unknown>;
}

export function parseReceiptSubmissionPayload(payloadJson: string | null): ParsedReceiptSubmissionPayload | null {
  if (!payloadJson) {
    return null;
  }

  try {
    const parsed = JSON.parse(payloadJson) as unknown;
    const root = asRecord(parsed);
    const draft = asRecord(root?.draft);

    if (!root || !draft) {
      return null;
    }

    const submittedBy = asRecord(root.submittedBy);
    const reviewer = asRecord(root.reviewer);
    const resolution = asRecord(root.resolution);
    const draftReceipt = asRecord(draft.receipt);
    const draftLinkContext = asRecord(draft.linkContext);
    const status = normalizeSubmissionStatus(asString(root.status));

    let normalizedDraft: ParsedReceiptSubmissionPayload["normalizedDraft"] = null;
    let classification: ReceiptApprovalClassification | null = null;

    if (draftReceipt && draftLinkContext) {
      const receiptType = normalizeReceiptType(asString(draft.receiptType));
      const receiptPurpose = normalizeReceiptPurpose(asString(draft.receiptPurpose));
      const linkContext = {
        clientId: asString(draftLinkContext.clientId),
        projectId: asString(draftLinkContext.projectId),
        rigId: asString(draftLinkContext.rigId),
        maintenanceRequestId: asString(draftLinkContext.maintenanceRequestId),
        locationFromId: asString(draftLinkContext.locationFromId),
        locationToId: asString(draftLinkContext.locationToId)
      };

      classification = deriveReceiptApprovalClassification({
        receiptType,
        receiptPurpose,
        maintenanceRequestId: linkContext.maintenanceRequestId
      });

      normalizedDraft = {
        receiptType,
        receiptPurpose,
        createExpense: asBoolean(draft.createExpense),
        receipt: {
          supplierName: asString(draftReceipt.supplierName),
          receiptNumber: asString(draftReceipt.receiptNumber),
          verificationCode: asString(draftReceipt.verificationCode),
          serialNumber: asString(draftReceipt.serialNumber),
          receiptDate: asString(draftReceipt.receiptDate),
          total: asNumber(draftReceipt.total),
          traReceiptNumber: asString(draftReceipt.traReceiptNumber)
        },
        linkContext
      };
    }

    return {
      status,
      submissionStatus: asString(root.submissionStatus) || (status === "SUBMITTED" ? "PENDING_REVIEW" : "FINALIZED"),
      submittedAt: asString(root.submittedAt),
      submittedBy: {
        userId: asString(submittedBy?.userId),
        name: asString(submittedBy?.name),
        role: asString(submittedBy?.role)
      },
      reviewer: reviewer
        ? {
            userId: asString(reviewer.userId),
            name: asString(reviewer.name),
            role: asString(reviewer.role),
            decision: asString(reviewer.decision),
            decidedAt: asString(reviewer.decidedAt),
            note: asString(reviewer.note)
          }
        : null,
      resolution: resolution
        ? {
            movementCount: asNumber(resolution.movementCount),
            itemsCreatedCount: asNumber(resolution.itemsCreatedCount),
            expenseId: asString(resolution.expenseId)
          }
        : null,
      draft,
      normalizedDraft,
      classification,
      raw: root
    };
  } catch {
    return null;
  }
}

function normalizeSubmissionStatus(value: string): ReceiptSubmissionStatus {
  if (value === "APPROVED" || value === "REJECTED" || value === "SUBMITTED") {
    return value;
  }
  return "SUBMITTED";
}

function asRecord(value: unknown) {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function asString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function asNumber(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function asBoolean(value: unknown) {
  return value === true;
}
