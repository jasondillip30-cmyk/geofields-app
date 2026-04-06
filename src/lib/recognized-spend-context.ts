import { prisma } from "@/lib/prisma";
import {
  buildCategoryTotals,
  buildClassificationAuditSummary,
  buildPurposeTotals,
  classifyApprovedSpendRows
} from "@/lib/approved-spend-classification";
import { withFinancialExpenseApproval } from "@/lib/financial-approval-policy";
import {
  filterRecognizedApprovedExpenses,
  type FinancialExpenseRecognitionStats
} from "@/lib/financial-expense-recognition";
import { parseReceiptSubmissionPayload } from "@/lib/receipt-intake-submission";
import {
  parsePurchaseRequisitionPayload,
  PURCHASE_REQUISITION_REPORT_TYPE
} from "@/lib/requisition-workflow";

const RECEIPT_SUBMISSION_REPORT_TYPE = "INVENTORY_RECEIPT_SUBMISSION";

export interface RecognizedSpendContextFilters {
  clientId?: string | null;
  rigId?: string | null;
  projectId?: string | null;
  fromDate?: Date | null;
  toDate?: Date | null;
}

export async function buildRecognizedSpendContext({
  clientId = null,
  rigId = null,
  projectId = null,
  fromDate = null,
  toDate = null
}: RecognizedSpendContextFilters) {
  const expenseWhere = withFinancialExpenseApproval({
    ...(clientId ? { clientId } : {}),
    ...(rigId ? { rigId } : {}),
    ...(projectId ? { projectId } : {}),
    ...(fromDate || toDate
      ? {
          date: {
            ...(fromDate ? { gte: fromDate } : {}),
            ...(toDate ? { lte: toDate } : {})
          }
        }
      : {})
  });

  const rawExpenses = await prisma.expense.findMany({
    where: expenseWhere,
    orderBy: [{ date: "asc" }, { createdAt: "asc" }],
    include: {
      client: { select: { id: true, name: true } },
      project: { select: { id: true, name: true } },
      rig: { select: { id: true, rigCode: true } }
    }
  });

  const recognizedResult = await filterRecognizedApprovedExpenses(rawExpenses);
  const recognizedExpenses = recognizedResult.expenses;
  const expenseIds = recognizedExpenses.map((entry) => entry.id);
  const expenseIdSet = new Set(expenseIds);

  const [movements, receiptSubmissionRows, requisitionRows] = await Promise.all([
    expenseIds.length
      ? prisma.inventoryMovement.findMany({
          where: { expenseId: { in: expenseIds } },
          select: {
            id: true,
            expenseId: true,
            movementType: true,
            maintenanceRequestId: true,
            breakdownReportId: true,
            projectId: true,
            rigId: true
          }
        })
      : Promise.resolve([]),
    prisma.summaryReport.findMany({
      where: {
        reportType: RECEIPT_SUBMISSION_REPORT_TYPE,
        ...(clientId ? { clientId } : {})
      },
      select: {
        payloadJson: true
      }
    }),
    prisma.summaryReport.findMany({
      where: {
        reportType: PURCHASE_REQUISITION_REPORT_TYPE,
        ...(clientId ? { clientId } : {})
      },
      select: {
        payloadJson: true
      }
    })
  ]);

  const movementIds = movements.map((entry) => entry.id);
  const usageRequestRows = movementIds.length
    ? await prisma.inventoryUsageRequest.findMany({
        where: {
          status: "APPROVED",
          approvedMovementId: { in: movementIds }
        },
        select: {
          approvedMovementId: true,
          maintenanceRequestId: true,
          breakdownReportId: true,
          reason: true
        }
      })
    : [];

  const receiptContexts = receiptSubmissionRows
    .map((row) => parseReceiptSubmissionPayload(row.payloadJson))
    .filter((entry) => Boolean(entry))
    .flatMap((entry) => {
      if (!entry || entry.status !== "APPROVED") {
        return [];
      }
      const expenseId = entry.resolution?.expenseId || "";
      if (!expenseId || !expenseIdSet.has(expenseId)) {
        return [];
      }
      return [
        {
          expenseId,
          receiptTag: entry.classification?.tag || null,
          maintenanceRequestId: entry.normalizedDraft?.linkContext.maintenanceRequestId || null,
          breakdownReportId: entry.normalizedDraft?.linkContext.breakdownReportId || null
        }
      ];
    });

  const requisitionContexts = requisitionRows
    .map((row) => parsePurchaseRequisitionPayload(row.payloadJson)?.payload || null)
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
    .flatMap((entry) => {
      const expenseId = entry.purchase?.expenseId || null;
      if (!expenseId || !expenseIdSet.has(expenseId)) {
        return [];
      }
      return [
        {
          expenseId,
          requisitionCode: entry.requisitionCode,
          type: entry.type,
          liveProjectSpendType: entry.liveProjectSpendType,
          projectId: entry.context.projectId || null,
          rigId: entry.context.rigId || null,
          maintenanceRequestId: entry.context.maintenanceRequestId || null,
          breakdownReportId: entry.context.breakdownReportId || null
        }
      ];
    });

  const maintenanceRequestIds = new Set<string>();
  for (const movement of movements) {
    if (movement.maintenanceRequestId) {
      maintenanceRequestIds.add(movement.maintenanceRequestId);
    }
  }
  for (const usageRow of usageRequestRows) {
    if (usageRow.maintenanceRequestId) {
      maintenanceRequestIds.add(usageRow.maintenanceRequestId);
    }
  }
  for (const requisitionContext of requisitionContexts) {
    if (requisitionContext.maintenanceRequestId) {
      maintenanceRequestIds.add(requisitionContext.maintenanceRequestId);
    }
  }
  for (const receiptContext of receiptContexts) {
    if (receiptContext.maintenanceRequestId) {
      maintenanceRequestIds.add(receiptContext.maintenanceRequestId);
    }
  }

  const maintenanceRequests = maintenanceRequestIds.size
    ? await prisma.maintenanceRequest.findMany({
        where: { id: { in: Array.from(maintenanceRequestIds) } },
        select: {
          id: true,
          requestCode: true,
          urgency: true,
          status: true,
          breakdownReportId: true,
          rig: {
            select: {
              rigCode: true
            }
          }
        }
      })
    : [];

  const classifiedRows = classifyApprovedSpendRows({
    expenses: recognizedExpenses.map((entry) => ({
      id: entry.id,
      date: entry.date.toISOString(),
      amount: entry.amount,
      category: entry.category,
      subcategory: entry.subcategory,
      entrySource: entry.entrySource,
      notes: entry.notes,
      projectId: entry.projectId,
      rigId: entry.rigId
    })),
    movements: movements.map((entry) => ({
      id: entry.id,
      expenseId: entry.expenseId,
      movementType: entry.movementType,
      maintenanceRequestId: entry.maintenanceRequestId,
      breakdownReportId: entry.breakdownReportId,
      projectId: entry.projectId,
      rigId: entry.rigId
    })),
    usageContexts: usageRequestRows.map((entry) => ({
      approvedMovementId: entry.approvedMovementId,
      maintenanceRequestId: entry.maintenanceRequestId,
      breakdownReportId: entry.breakdownReportId,
      reasonType: entry.reason
    })),
    requisitionContexts,
    maintenanceContexts: maintenanceRequests.map((entry) => ({
      id: entry.id,
      breakdownReportId: entry.breakdownReportId
    })),
    receiptContexts
  });

  const purposeTotals = buildPurposeTotals(classifiedRows);
  const categoryTotals = buildCategoryTotals(classifiedRows);
  const classificationAudit = buildClassificationAuditSummary(classifiedRows);

  return {
    rawExpenses,
    recognizedExpenses,
    recognitionStats: recognizedResult.stats as FinancialExpenseRecognitionStats,
    movements,
    usageRequestRows,
    requisitionContexts,
    receiptContexts,
    maintenanceRequests,
    classifiedRows,
    purposeTotals,
    categoryTotals,
    classificationAudit
  };
}
