import type { RequisitionStatus } from "@/lib/requisition-workflow";

export type RequisitionLifecycleStage =
  | "PENDING_APPROVAL"
  | "APPROVED_AWAITING_RECEIPT"
  | "POSTED_COMPLETE"
  | "REJECTED";

export const REQUISITION_APPROVAL_QUEUE_STATUS: RequisitionStatus = "SUBMITTED";
export const REQUISITION_RECEIPT_ELIGIBLE_STATUS: RequisitionStatus = "APPROVED";

export function deriveRequisitionLifecycleStage(
  status: RequisitionStatus
): RequisitionLifecycleStage {
  if (status === "APPROVED") {
    return "APPROVED_AWAITING_RECEIPT";
  }
  if (status === "PURCHASE_COMPLETED") {
    return "POSTED_COMPLETE";
  }
  if (status === "REJECTED") {
    return "REJECTED";
  }
  return "PENDING_APPROVAL";
}

export function isRequisitionPendingApproval(status: RequisitionStatus) {
  return deriveRequisitionLifecycleStage(status) === "PENDING_APPROVAL";
}

export function isRequisitionAwaitingReceipt(status: RequisitionStatus) {
  return deriveRequisitionLifecycleStage(status) === "APPROVED_AWAITING_RECEIPT";
}

export function isRequisitionPostedComplete(status: RequisitionStatus) {
  return deriveRequisitionLifecycleStage(status) === "POSTED_COMPLETE";
}

