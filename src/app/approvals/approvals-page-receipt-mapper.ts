import {
  deriveReceiptApprovalClassification,
  normalizeReceiptPurpose,
  normalizeReceiptType
} from "@/lib/receipt-approval-classification";
import type { ReceiptSubmissionApprovalRow } from "./approvals-page-types";
import {
  normalizeOptionalId,
  normalizeReceiptPriority,
  normalizeReceiptStockUse,
  normalizeReceiptTag,
  normalizeSubmissionStatus
} from "./approvals-page-utils";

export interface RawReceiptSubmissionRow {
  id: string;
  reportDate: string;
  submittedAt?: string;
  status?: string;
  summary?: {
    supplierName?: string;
    receiptNumber?: string;
    verificationCode?: string;
    serialNumber?: string;
    receiptDate?: string;
    total?: number;
    traReceiptNumber?: string;
  };
  classification?: {
    tag?: string;
    priority?: string;
    stockUse?: string | null;
    contextLabel?: string;
  };
  receiptType?: string;
  receiptPurpose?: string;
  linkContext?: {
    clientId?: string;
    projectId?: string;
    rigId?: string;
    maintenanceRequestId?: string;
    locationFromId?: string;
    locationToId?: string;
  };
}

export function mapReceiptSubmissionRows(
  rows: RawReceiptSubmissionRow[]
): ReceiptSubmissionApprovalRow[] {
  return rows.map((entry) => {
    const receiptType = normalizeReceiptType(entry.receiptType);
    const receiptPurpose = normalizeReceiptPurpose(entry.receiptPurpose);
    const linkContext = {
      clientId: normalizeOptionalId(entry.linkContext?.clientId),
      projectId: normalizeOptionalId(entry.linkContext?.projectId),
      rigId: normalizeOptionalId(entry.linkContext?.rigId),
      maintenanceRequestId: normalizeOptionalId(entry.linkContext?.maintenanceRequestId),
      locationFromId: normalizeOptionalId(entry.linkContext?.locationFromId),
      locationToId: normalizeOptionalId(entry.linkContext?.locationToId)
    };
    const fallbackClassification = deriveReceiptApprovalClassification({
      receiptType,
      receiptPurpose,
      maintenanceRequestId: linkContext.maintenanceRequestId
    });
    const classification = {
      tag: normalizeReceiptTag(entry.classification?.tag) || fallbackClassification.tag,
      priority:
        normalizeReceiptPriority(entry.classification?.priority) ||
        fallbackClassification.priority,
      stockUse:
        normalizeReceiptStockUse(entry.classification?.stockUse) ??
        fallbackClassification.stockUse,
      contextLabel:
        entry.classification?.contextLabel?.trim() || fallbackClassification.contextLabel
    };
    return {
      id: entry.id,
      reportDate: entry.reportDate,
      submittedAt: entry.submittedAt || null,
      status: normalizeSubmissionStatus(entry.status),
      summary: {
        supplierName: entry.summary?.supplierName?.trim() || "-",
        receiptNumber: entry.summary?.receiptNumber?.trim() || "-",
        verificationCode: entry.summary?.verificationCode?.trim() || "",
        serialNumber: entry.summary?.serialNumber?.trim() || "",
        receiptDate: entry.summary?.receiptDate?.trim() || "",
        total: Number(entry.summary?.total || 0),
        traReceiptNumber: entry.summary?.traReceiptNumber?.trim() || ""
      },
      receiptType,
      receiptPurpose,
      linkContext,
      classification
    };
  });
}
