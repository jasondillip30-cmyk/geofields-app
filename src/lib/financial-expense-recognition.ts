import {
  parsePurchaseRequisitionPayload,
  PURCHASE_REQUISITION_REPORT_TYPE
} from "@/lib/requisition-workflow";
import { prisma } from "@/lib/prisma";

interface ExpenseCandidate {
  id: string;
  approvalStatus?: string | null;
}

interface RequisitionExpenseLinkState {
  linked: boolean;
  recognized: boolean;
}

export interface FinancialExpenseRecognitionStats {
  inputCount: number;
  candidateCount: number;
  recognizedCount: number;
  linkedPurchaseExpenseCount: number;
  recognizedPurchaseExpenseCount: number;
  excludedUnpostedPurchaseCount: number;
  excludedNonApprovedCount: number;
}

export async function filterRecognizedApprovedExpenses<T extends ExpenseCandidate>(expenses: T[]) {
  const approvedCandidates = expenses.filter((entry) => {
    if (!Object.prototype.hasOwnProperty.call(entry, "approvalStatus")) {
      return true;
    }
    const status = typeof entry.approvalStatus === "string" ? entry.approvalStatus.trim().toUpperCase() : "";
    return status === "APPROVED";
  });

  if (approvedCandidates.length === 0) {
    return {
      expenses: approvedCandidates,
      stats: {
        inputCount: expenses.length,
        candidateCount: approvedCandidates.length,
        recognizedCount: 0,
        linkedPurchaseExpenseCount: 0,
        recognizedPurchaseExpenseCount: 0,
        excludedUnpostedPurchaseCount: 0,
        excludedNonApprovedCount: Math.max(0, expenses.length - approvedCandidates.length)
      } satisfies FinancialExpenseRecognitionStats
    };
  }

  const expenseIdSet = new Set(approvedCandidates.map((entry) => entry.id));
  const requisitionRows = await prisma.summaryReport.findMany({
    where: {
      reportType: PURCHASE_REQUISITION_REPORT_TYPE
    },
    select: {
      payloadJson: true
    }
  });

  const linkageByExpenseId = new Map<string, RequisitionExpenseLinkState>();

  for (const row of requisitionRows) {
    const parsed = parsePurchaseRequisitionPayload(row.payloadJson);
    const payload = parsed?.payload;
    const expenseId = payload?.purchase?.expenseId || null;
    if (!payload || !expenseId || !expenseIdSet.has(expenseId)) {
      continue;
    }

    const current = linkageByExpenseId.get(expenseId) || {
      linked: true,
      recognized: false
    };
    current.linked = true;
    if (isRequisitionExpenseRecognized(payload.status, payload.purchase?.postedAt || null)) {
      current.recognized = true;
    }
    linkageByExpenseId.set(expenseId, current);
  }

  let linkedPurchaseExpenseCount = 0;
  let recognizedPurchaseExpenseCount = 0;
  let excludedUnpostedPurchaseCount = 0;

  const recognized = approvedCandidates.filter((entry) => {
    const linkage = linkageByExpenseId.get(entry.id);
    if (!linkage?.linked) {
      return true;
    }

    linkedPurchaseExpenseCount += 1;
    if (linkage.recognized) {
      recognizedPurchaseExpenseCount += 1;
      return true;
    }

    excludedUnpostedPurchaseCount += 1;
    return false;
  });

  return {
    expenses: recognized,
    stats: {
      inputCount: expenses.length,
      candidateCount: approvedCandidates.length,
      recognizedCount: recognized.length,
      linkedPurchaseExpenseCount,
      recognizedPurchaseExpenseCount,
      excludedUnpostedPurchaseCount,
      excludedNonApprovedCount: Math.max(0, expenses.length - approvedCandidates.length)
    } satisfies FinancialExpenseRecognitionStats
  };
}

function isRequisitionExpenseRecognized(status: string, postedAt: string | null) {
  return status === "PURCHASE_COMPLETED" && Boolean(postedAt);
}
