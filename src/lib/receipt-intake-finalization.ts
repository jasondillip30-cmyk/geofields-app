import { roundCurrency } from "@/lib/inventory-server";
import type { PurchaseRequisitionPayload } from "@/lib/requisition-workflow";
import type { ReceiptSubmissionStatus } from "@/lib/receipt-intake-submission";

interface SubmissionActor {
  userId: string;
  name: string;
  role: string;
}

export function buildApprovedReceiptSubmissionPayload({
  approvedAtIso,
  submittedAtIso,
  submittedBy,
  movementCount,
  itemsCreatedCount,
  evidenceOnlyLinesCount,
  skippedLinesCount,
  expenseId,
  submissionDraft
}: {
  approvedAtIso: string;
  submittedAtIso: string;
  submittedBy: SubmissionActor;
  movementCount: number;
  itemsCreatedCount: number;
  evidenceOnlyLinesCount: number;
  skippedLinesCount: number;
  expenseId: string | null;
  submissionDraft: Record<string, unknown>;
}) {
  return {
    schemaVersion: 1,
    status: "APPROVED" as ReceiptSubmissionStatus,
    submissionStatus: "FINALIZED",
    submittedAt: submittedAtIso,
    submittedBy,
    reviewer: {
      userId: submittedBy.userId,
      name: submittedBy.name,
      role: submittedBy.role,
      decision: "APPROVED",
      decidedAt: approvedAtIso,
      note: ""
    },
    resolution: {
      approvedAt: approvedAtIso,
      movementCount,
      itemsCreatedCount,
      evidenceOnlyLinesCount,
      skippedLinesCount,
      expenseId
    },
    draft: submissionDraft
  };
}

export function buildCompletedRequisitionPayload({
  payload,
  submissionId,
  receiptNumber,
  supplierName,
  expenseId,
  movementCount,
  postedAtIso,
  postedCost
}: {
  payload: PurchaseRequisitionPayload;
  submissionId: string | null;
  receiptNumber: string | null;
  supplierName: string | null;
  expenseId: string | null;
  movementCount: number;
  postedAtIso: string;
  postedCost: number;
}) {
  return {
    ...payload,
    status: "PURCHASE_COMPLETED" as const,
    totals: {
      ...payload.totals,
      actualPostedCost: roundCurrency(postedCost)
    },
    purchase: {
      receiptSubmissionId: submissionId,
      receiptNumber,
      supplierName,
      expenseId,
      movementCount,
      postedAt: postedAtIso
    }
  };
}
