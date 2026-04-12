import type { InventoryCategory } from "@prisma/client";

import { auditActorFromSession, recordAuditLog } from "@/lib/audit";
import { parseInventoryCategory, roundCurrency } from "@/lib/inventory-server";
import { debugLog } from "@/lib/observability";
import { prisma } from "@/lib/prisma";
import {
  buildApprovedReceiptSubmissionPayload,
  buildCompletedRequisitionPayload
} from "@/lib/receipt-intake-finalization";
import type { ParsedPurchaseRequisition } from "@/lib/requisition-workflow";
import type { ParsedReceiptSubmissionPayload } from "@/lib/receipt-intake-submission";
import type { AuthSession } from "@/lib/auth/session-types";
import {
  chooseDominantCategory,
  resolveExpenseCategoryForReceiptType,
  resolveIntakeItem,
  resolveSupplier
} from "./commit-utils";
import type {
  NormalizedIntakeLine,
  ReceiptPurpose,
  ReceiptType,
  ReceiptWorkflowType,
  ResolveIntakeItemExistingRow,
  SkippedIntakeLine
} from "./commit-types";

export interface RunReceiptCommitTransactionInput {
  session: AuthSession;
  submissionId: string | null;
  linkedSubmission: { id: string; updatedAt: Date } | null;
  linkedSubmissionParsed: ParsedReceiptSubmissionPayload | null;
  submissionDraft: Record<string, unknown>;
  requisitionId: string | null;
  linkedRequisition: { id: string } | null;
  parsedRequisition: ParsedPurchaseRequisition | null;
  existingSupplierId: string | null;
  receiptSupplierName: string;
  inventoryActionLines: NormalizedIntakeLine[];
  existingItemById: Map<string, ResolveIntakeItemExistingRow>;
  locationToId: string | null;
  receiptType: ReceiptType;
  createExpense: boolean;
  receiptPurpose: ReceiptPurpose;
  expenseOnlyCategory: "TRAVEL" | "FOOD" | "FUEL" | "MISC" | null;
  workflowType: ReceiptWorkflowType;
  receiptTotal: number;
  computedLinesTotal: number;
  rigId: string | null;
  intakeDate: Date;
  receiptNumber: string;
  traReceiptNumber: string;
  invoiceReference: string;
  receiptUrl: string;
  receiptFileName: string;
  receiptTin: string;
  receiptMetadataNote: string;
  clientId: string | null;
  projectId: string | null;
  maintenanceRequestId: string | null;
  breakdownReportId: string | null;
  locationFromId: string | null;
  evidenceOnlyLines: NormalizedIntakeLine[];
  skippedLines: SkippedIntakeLine[];
  normalizedLines: NormalizedIntakeLine[];
}

export interface ReceiptCommitTransactionResult {
  createdMovements: Array<{ id: string; itemId: string; quantity: number; totalCost: number }>;
  createdExpenseId: string | null;
  supplierName: string;
  itemsCreatedCount: number;
  evidenceOnlyLinesCount: number;
  skippedLinesCount: number;
  lineOutcomes: Array<Record<string, unknown>>;
  skippedReasons: string[];
  submissionStatus: "FINALIZED" | null;
  requisitionStatus: "PURCHASE_COMPLETED" | null;
}

export async function runReceiptCommitTransaction(
  input: RunReceiptCommitTransactionInput
): Promise<ReceiptCommitTransactionResult> {
  return prisma.$transaction(async (tx) => {
    if (input.submissionId && input.linkedSubmission) {
      const finalizeLock = await tx.summaryReport.updateMany({
        where: {
          id: input.submissionId,
          updatedAt: input.linkedSubmission.updatedAt
        },
        data: {
          reportDate: new Date()
        }
      });
      if (finalizeLock.count === 0) {
        throw new Error("ReceiptSubmissionFinalizeConflict");
      }
    }

    const supplier = await resolveSupplier({
      tx,
      existingSupplierId: input.existingSupplierId,
      supplierName: input.receiptSupplierName
    });

    const categoryCandidates: InventoryCategory[] = [];
    for (const line of input.inventoryActionLines) {
      if (line.selectedItemId) {
        const existing = input.existingItemById.get(line.selectedItemId);
        if (existing) {
          categoryCandidates.push(existing.category);
          continue;
        }
      }
      const parsed = parseInventoryCategory(line.selectedCategory || line.newItem?.category || "");
      if (parsed) {
        categoryCandidates.push(parsed);
      }
    }
    const dominantCategory = chooseDominantCategory(categoryCandidates);
    let createdExpenseId: string | null = null;

    if (input.createExpense) {
      const expenseApprovalStatus = "APPROVED" as const;
      const submittedAt = new Date();
      const approvedAt = new Date();
      const approvedById = input.session.userId;
      const isEvidenceOnlyPurpose = input.receiptPurpose === "EVIDENCE_ONLY";
      const expenseCategory = resolveExpenseCategoryForReceiptType({
        receiptType: input.receiptType,
        expenseOnlyCategory: input.expenseOnlyCategory,
        dominantCategory,
        isEvidenceOnlyPurpose
      });
      const expenseAmount = isEvidenceOnlyPurpose
        ? 0
        : input.receiptTotal && input.receiptTotal > 0
          ? input.receiptTotal
          : input.computedLinesTotal;
      const expenseRigId = input.workflowType === "PROJECT_PURCHASE" ? null : input.rigId;
      const expense = await tx.expense.create({
        data: {
          date: input.intakeDate,
          amount: expenseAmount,
          category: expenseCategory,
          subcategory: isEvidenceOnlyPurpose ? "Receipt Evidence Only" : "Inventory Receipt Intake",
          entrySource: "INVENTORY",
          vendor: supplier?.name || input.receiptSupplierName || null,
          receiptNumber:
            input.receiptNumber || input.traReceiptNumber || input.invoiceReference || null,
          receiptUrl: input.receiptUrl || null,
          receiptFileName: input.receiptFileName || null,
          notes: `Receipt intake: ${input.receiptSupplierName}${input.receiptTin ? ` (TIN: ${input.receiptTin})` : ""}${input.receiptMetadataNote ? `\n${input.receiptMetadataNote}` : ""}`,
          enteredByUserId: input.session.userId,
          approvalStatus: expenseApprovalStatus,
          submittedAt,
          approvedById,
          approvedAt,
          clientId: input.clientId,
          projectId: input.projectId,
          rigId: expenseRigId
        },
        select: { id: true }
      });
      createdExpenseId = expense.id;
    }

    const createdMovements: Array<{ id: string; itemId: string; quantity: number; totalCost: number }> = [];
    let itemsCreatedCount = 0;
    const lineOutcomes: Array<Record<string, unknown>> = [];
    const skippedReasons: string[] = [];

    for (const line of input.evidenceOnlyLines) {
      lineOutcomes.push({
        lineId: line.lineId,
        description: line.description,
        mode: line.mode,
        result: "SKIPPED_EVIDENCE_ONLY",
        reason: "Line was marked as receipt/expense evidence only."
      });
      skippedReasons.push(`"${line.description}": evidence-only`);
    }

    for (const skipped of input.skippedLines) {
      lineOutcomes.push({
        lineId: skipped.lineId,
        description: skipped.description,
        mode: "SKIPPED",
        result: "SKIPPED_VALIDATION",
        reason: skipped.reason
      });
      skippedReasons.push(`"${skipped.description || skipped.lineId}": ${skipped.reason}`);
    }

    for (const line of input.inventoryActionLines) {
      const resolvedItem = await resolveIntakeItem({
        tx,
        line,
        existingItemById: input.existingItemById,
        supplierId: supplier?.id || null,
        locationToId: input.locationToId
      });
      if (resolvedItem.resolution === "AUTO_CREATED") {
        itemsCreatedCount += 1;
      }

      debugLog(
        "[inventory][receipt-intake][line]",
        {
          lineId: line.lineId,
          description: line.description,
          mode: line.mode,
          resolution: resolvedItem.resolution,
          matchedItemId: resolvedItem.resolution === "MATCHED_EXISTING" ? resolvedItem.id : null,
          matchedItemName: resolvedItem.resolution === "MATCHED_EXISTING" ? resolvedItem.name : null,
          createdItemId: resolvedItem.resolution === "AUTO_CREATED" ? resolvedItem.id : null,
          createdItemName: resolvedItem.resolution === "AUTO_CREATED" ? resolvedItem.name : null
        },
        { channel: "inventory-receipt" }
      );

      const movement = await tx.inventoryMovement.create({
        data: {
          itemId: resolvedItem.id,
          movementType: input.receiptType === "INTERNAL_TRANSFER" ? "TRANSFER" : "IN",
          quantity: line.quantity,
          unitCost: line.unitPrice,
          totalCost: line.lineTotal,
          date: input.intakeDate,
          performedByUserId: input.session.userId,
          clientId: input.clientId,
          projectId: input.projectId,
          rigId: input.rigId,
          maintenanceRequestId: input.maintenanceRequestId,
          breakdownReportId: input.breakdownReportId,
          expenseId: createdExpenseId,
          supplierId: supplier?.id || null,
          locationFromId: input.locationFromId || null,
          locationToId: input.locationToId || line.newItem?.locationId || null,
          traReceiptNumber: input.traReceiptNumber || input.receiptNumber || null,
          supplierInvoiceNumber: input.invoiceReference || input.receiptNumber || null,
          receiptUrl: input.receiptUrl || null,
          receiptFileName: input.receiptFileName || null,
          notes: `Receipt intake line: ${line.description}${input.receiptMetadataNote ? `\n${input.receiptMetadataNote}` : ""}`
        },
        select: {
          id: true,
          itemId: true,
          quantity: true,
          totalCost: true
        }
      });

      const nextStock =
        input.receiptType === "INTERNAL_TRANSFER"
          ? roundCurrency(resolvedItem.quantityInStock)
          : roundCurrency(resolvedItem.quantityInStock + line.quantity);
      await tx.inventoryItem.update({
        where: { id: resolvedItem.id },
        data: {
          quantityInStock: nextStock,
          unitCost: input.receiptType !== "INTERNAL_TRANSFER" && line.unitPrice > 0 ? line.unitPrice : undefined,
          supplierId: supplier?.id || null,
          locationId: input.locationToId || line.newItem?.locationId || undefined
        }
      });

      createdMovements.push({
        id: movement.id,
        itemId: movement.itemId,
        quantity: roundCurrency(movement.quantity),
        totalCost: roundCurrency(movement.totalCost || 0)
      });
      lineOutcomes.push({
        lineId: line.lineId,
        description: line.description,
        mode: line.mode,
        result: "STOCK_IN_CREATED",
        movementId: movement.id,
        itemId: resolvedItem.id,
        itemName: resolvedItem.name
      });

      await recordAuditLog({
        db: tx,
        module: "inventory",
        entityType: "inventory_movement",
        entityId: movement.id,
        action: "create",
        description: `${input.session.name} created stock intake movement for ${line.description}.`,
        after: {
          movementId: movement.id,
          itemId: movement.itemId,
          quantity: line.quantity,
          unitCost: line.unitPrice,
          lineTotal: line.lineTotal,
          receiptUrl: input.receiptUrl,
          traReceiptNumber: input.traReceiptNumber
        },
        actor: auditActorFromSession(input.session)
      });
    }

    let submissionStatus: "FINALIZED" | null = null;
    if (input.submissionId && input.linkedSubmission) {
      const approvedAtIso = new Date().toISOString();
      const previousSubmittedBy =
        input.linkedSubmissionParsed?.submittedBy && input.linkedSubmissionParsed.submittedBy.userId
          ? input.linkedSubmissionParsed.submittedBy
          : null;
      const approvedPayload = buildApprovedReceiptSubmissionPayload({
        approvedAtIso,
        submittedAtIso: input.linkedSubmissionParsed?.submittedAt || approvedAtIso,
        submittedBy:
          previousSubmittedBy || {
            userId: input.session.userId,
            name: input.session.name,
            role: input.session.role
          },
        movementCount: createdMovements.length,
        itemsCreatedCount,
        evidenceOnlyLinesCount: input.evidenceOnlyLines.length,
        skippedLinesCount: input.skippedLines.length,
        expenseId: createdExpenseId,
        submissionDraft: input.submissionDraft
      });

      await tx.summaryReport.update({
        where: { id: input.submissionId },
        data: {
          payloadJson: JSON.stringify(approvedPayload),
          reportDate: new Date()
        }
      });

      await recordAuditLog({
        db: tx,
        module: "inventory",
        entityType: "receipt_intake_submission",
        entityId: input.submissionId,
        action: "approve",
        description: `${input.session.name} approved and finalized receipt intake submission ${input.submissionId}.`,
        before: {
          status: input.linkedSubmissionParsed?.status || "SUBMITTED"
        },
        after: {
          status: "APPROVED",
          movementCount: createdMovements.length,
          expenseId: createdExpenseId
        },
        actor: auditActorFromSession(input.session)
      });

      submissionStatus = "FINALIZED";
    }

    let requisitionStatus: "PURCHASE_COMPLETED" | null = null;
    if (input.requisitionId && input.linkedRequisition && input.parsedRequisition) {
      const postedAtIso = new Date().toISOString();
      const postedCost = roundCurrency(
        (input.receiptTotal && input.receiptTotal > 0
          ? input.receiptTotal
          : input.normalizedLines.reduce((sum, line) => sum + line.lineTotal, 0)) || 0
      );
      const nextRequisitionPayload = buildCompletedRequisitionPayload({
        payload: input.parsedRequisition.payload,
        submissionId: input.submissionId || null,
        receiptNumber:
          input.receiptNumber || input.traReceiptNumber || input.invoiceReference || null,
        supplierName: supplier?.name || input.receiptSupplierName || null,
        expenseId: createdExpenseId || null,
        movementCount: createdMovements.length,
        postedAtIso,
        postedCost
      });

      await tx.summaryReport.update({
        where: { id: input.requisitionId },
        data: {
          payloadJson: JSON.stringify(nextRequisitionPayload),
          reportDate: new Date()
        }
      });

      await recordAuditLog({
        db: tx,
        module: "expenses",
        entityType: "purchase_requisition",
        entityId: input.requisitionId,
        action: "purchase_complete",
        description: `${input.session.name} completed requisition purchase posting ${nextRequisitionPayload.requisitionCode}.`,
        before: {
          status: input.parsedRequisition.payload.status
        },
        after: {
          status: nextRequisitionPayload.status,
          expenseId: nextRequisitionPayload.purchase.expenseId,
          movementCount: nextRequisitionPayload.purchase.movementCount,
          actualPostedCost: nextRequisitionPayload.totals.actualPostedCost
        },
        actor: auditActorFromSession(input.session)
      });

      requisitionStatus = "PURCHASE_COMPLETED";
    }

    return {
      createdMovements,
      createdExpenseId,
      supplierName: supplier?.name || input.receiptSupplierName,
      itemsCreatedCount,
      evidenceOnlyLinesCount: input.evidenceOnlyLines.length,
      skippedLinesCount: input.skippedLines.length,
      lineOutcomes,
      skippedReasons,
      submissionStatus,
      requisitionStatus
    };
  });
}
