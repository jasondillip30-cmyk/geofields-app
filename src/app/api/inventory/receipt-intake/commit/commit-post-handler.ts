import { NextResponse, type NextRequest } from "next/server";

import { canAccess } from "@/lib/auth/permissions";
import { requireApiPermission } from "@/lib/auth/api-guard";
import { auditActorFromSession, recordAuditLog } from "@/lib/audit";
import {
  parseNumeric,
  roundCurrency
} from "@/lib/inventory-server";
import { debugLog } from "@/lib/observability";
import { prisma } from "@/lib/prisma";
import { parseReceiptSubmissionPayload, type ReceiptSubmissionStatus } from "@/lib/receipt-intake-submission";
import {
  mapRequisitionToReceiptClassification,
  parsePurchaseRequisitionPayload,
  PURCHASE_REQUISITION_REPORT_TYPE
} from "@/lib/requisition-workflow";
import {
  buildDuplicateFingerprint,
  buildDuplicateReview,
  buildReceiptMetadataNote,
  deriveWorkflowTypeFromContext,
  detectReceiptDuplicates,
  formatWorkflowTypeLabel,
  formatDateOnly,
  inferDuplicateConfidence,
  mapRequisitionTypeToWorkflowType,
  normalizeLines,
  resolveCreateExpenseByPurpose,
  resolveExpenseOnlyCategory,
  resolveIntakeAllocationStatus,
  resolveReceiptPurpose,
  resolveReceiptType,
  resolveReceiptWorkflowType,
  sanitizeSubmissionLines
} from "./commit-utils";
import {
  runReceiptCommitTransaction,
  type ReceiptCommitTransactionResult
} from "./commit-transaction";
import {
  RECEIPT_SUBMISSION_REPORT_TYPE,
  type IntakeCommitPayload
} from "./commit-types";
import {
  applyWorkflowContextReset,
  parseEntityIdentifiers,
  parseLinkContext,
  parseReceiptSnapshot
} from "./commit-request-parsing";

export async function POST(request: NextRequest) {
  const auth = await requireApiPermission(request, "inventory:view");
  if (!auth.ok) {
    return auth.response;
  }
  const canManage = canAccess(auth.session.role, "inventory:manage");

  const body = (await request.json().catch(() => null)) as IntakeCommitPayload | null;
  const { requisitionId, submissionId } = parseEntityIdentifiers(body);
  const lines = Array.isArray(body?.lines) ? body.lines : [];
  const receiptType = resolveReceiptType(body?.receiptType);
  const receiptPurpose = resolveReceiptPurpose(body?.receiptPurpose);
  const requestedCreateExpense = Boolean(body?.createExpense);
  const createExpense = resolveCreateExpenseByPurpose({
    receiptType,
    receiptPurpose,
    requestedCreateExpense
  });
  let workflowType = resolveReceiptWorkflowType(body?.workflowType);
  const allowDuplicateSave = Boolean(body?.allowDuplicateSave);
  if (receiptPurpose === "OTHER_MANUAL") {
    return NextResponse.json({ message: "Receipt purpose is set to manual decision. Complete mapping before final save." }, { status: 400 });
  }
  const normalizedInputLines =
    receiptType === "EXPENSE_ONLY" ||
    receiptPurpose === "BUSINESS_EXPENSE_ONLY" ||
    receiptPurpose === "EVIDENCE_ONLY"
      ? lines.map((line) => ({ ...line, mode: "EXPENSE_ONLY" as const, selectedItemId: null }))
      : lines;
  if (normalizedInputLines.length === 0 && !createExpense) {
    return NextResponse.json({ message: "At least one intake line is required unless you are saving receipt evidence as an expense." }, { status: 400 });
  }

  const {
    intakeDate,
    receiptUrl,
    receiptFileName,
    traReceiptNumber,
    receiptNumber,
    receiptTin,
    receiptVrn,
    serialNumber,
    verificationCode,
    verificationUrl,
    rawQrValue,
    receiptTime,
    invoiceReference,
    paymentMethod,
    taxOffice,
    ocrTextPreview
  } = parseReceiptSnapshot(body);
  let {
    clientId,
    projectId,
    rigId,
    maintenanceRequestId,
    breakdownReportId,
    locationFromId,
    locationToId
  } = parseLinkContext(body);
  const expenseOnlyCategory = resolveExpenseOnlyCategory(body?.expenseOnlyCategory);
  workflowType =
    workflowType ||
    deriveWorkflowTypeFromContext({
      receiptType,
      receiptPurpose,
      createExpense,
      projectId
    });
  ({
    clientId,
    projectId,
    rigId,
    maintenanceRequestId,
    breakdownReportId,
    locationFromId,
    locationToId
  } = applyWorkflowContextReset({
    workflowType,
    context: {
      clientId,
      projectId,
      rigId,
      maintenanceRequestId,
      breakdownReportId,
      locationFromId,
      locationToId
    }
  }));
  let allocationStatus = resolveIntakeAllocationStatus({ clientId, projectId });

  if (receiptType === "EXPENSE_ONLY" && !expenseOnlyCategory) {
    return NextResponse.json({ message: "Expense-only receipts require an expense category (Travel, Food, Fuel, or Misc)." }, { status: 400 });
  }
  if (receiptType === "INTERNAL_TRANSFER" && !locationToId) {
    return NextResponse.json({ message: "Internal transfer receipts require a destination stock location." }, { status: 400 });
  }

  const normalization = normalizeLines(normalizedInputLines);
  const normalizedLines = normalization.normalized;
  const skippedLines = normalization.skipped;
  if (normalizedLines.length === 0 && !createExpense) {
    return NextResponse.json({ message: "No valid intake lines found after validation. Add at least one valid line or save as expense evidence." }, { status: 400 });
  }
  const inventoryActionLines = normalizedLines.filter((line) => line.mode !== "EXPENSE_ONLY");
  const evidenceOnlyLines = normalizedLines.filter((line) => line.mode === "EXPENSE_ONLY");
  if (inventoryActionLines.length === 0 && !createExpense) {
    return NextResponse.json({ message: "All lines are marked as expense evidence only. Enable expense evidence or switch at least one line to an inventory action." }, { status: 400 });
  }
  if (receiptType === "INTERNAL_TRANSFER") {
    if (!locationFromId || !locationToId) {
      return NextResponse.json({ message: "Internal transfer requires both from-location and to-location." }, { status: 400 });
    }
    if (locationFromId === locationToId) {
      return NextResponse.json(
        { message: "Internal transfer locations must be different." },
        { status: 400 }
      );
    }
    const hasNonMatchLine = inventoryActionLines.some(
      (line) => line.mode !== "MATCH" || !line.selectedItemId
    );
    if (hasNonMatchLine) {
      return NextResponse.json(
        {
          message:
            "Internal transfer requires linking each line to an existing inventory item."
        },
        { status: 400 }
      );
    }
  }

  const selectedItemIds = Array.from(
    new Set(
      inventoryActionLines
        .map((line) => line.selectedItemId)
        .filter((value): value is string => Boolean(value))
    )
  );

  const [existingItems, existingSupplier, existingLocationFrom, existingLocationTo, existingMaintenanceRequest, existingBreakdownReport, linkedRequisition] = await Promise.all([
    selectedItemIds.length
      ? prisma.inventoryItem.findMany({
          where: { id: { in: selectedItemIds } },
          select: {
            id: true,
            name: true,
            sku: true,
            category: true,
            quantityInStock: true,
            minimumStockLevel: true,
            unitCost: true,
            status: true
          }
        })
      : Promise.resolve([]),
    body?.receipt?.supplierId
      ? prisma.inventorySupplier.findUnique({
          where: { id: body.receipt.supplierId },
          select: { id: true, name: true }
        })
      : Promise.resolve(null),
    locationFromId
      ? prisma.inventoryLocation.findUnique({
          where: { id: locationFromId },
          select: { id: true }
        })
      : Promise.resolve(null),
    locationToId
      ? prisma.inventoryLocation.findUnique({
          where: { id: locationToId },
          select: { id: true }
        })
      : Promise.resolve(null),
    maintenanceRequestId
      ? prisma.maintenanceRequest.findUnique({
          where: { id: maintenanceRequestId },
          select: {
            id: true,
            status: true,
            requestCode: true,
            rigId: true,
            projectId: true,
            clientId: true,
            breakdownReportId: true
          }
        })
      : Promise.resolve(null),
    breakdownReportId
      ? prisma.breakdownReport.findUnique({
          where: { id: breakdownReportId },
          select: { id: true, rigId: true, projectId: true, clientId: true }
        })
      : Promise.resolve(null),
    requisitionId
      ? prisma.summaryReport.findUnique({
          where: { id: requisitionId },
          select: { id: true, reportType: true, payloadJson: true }
        })
      : Promise.resolve(null)
  ]);

  if (selectedItemIds.length !== existingItems.length) {
    return NextResponse.json({ message: "One or more selected inventory items were not found." }, { status: 404 });
  }
  if (locationFromId && !existingLocationFrom) {
    return NextResponse.json({ message: "Selected from-location was not found." }, { status: 404 });
  }
  if (locationToId && !existingLocationTo) {
    return NextResponse.json({ message: "Selected stock location not found." }, { status: 404 });
  }
  if (maintenanceRequestId && !existingMaintenanceRequest) {
    return NextResponse.json({ message: "Selected maintenance request was not found." }, { status: 404 });
  }
  if (breakdownReportId && !existingBreakdownReport) {
    return NextResponse.json({ message: "Selected breakdown report was not found." }, { status: 404 });
  }
  if (
    breakdownReportId &&
    existingMaintenanceRequest?.breakdownReportId &&
    breakdownReportId !== existingMaintenanceRequest.breakdownReportId
  ) {
    return NextResponse.json(
      {
        message:
          "Selected maintenance request is linked to a different breakdown report."
      },
      { status: 400 }
    );
  }
  if (
    breakdownReportId &&
    existingBreakdownReport &&
    projectId &&
    existingBreakdownReport.projectId !== projectId
  ) {
    return NextResponse.json(
      { message: "Selected breakdown report does not belong to the selected project." },
      { status: 400 }
    );
  }
  if (
    breakdownReportId &&
    existingBreakdownReport &&
    rigId &&
    existingBreakdownReport.rigId !== rigId
  ) {
    return NextResponse.json(
      { message: "Selected breakdown report does not belong to the selected rig." },
      { status: 400 }
    );
  }
  const parsedRequisition = linkedRequisition
    ? parsePurchaseRequisitionPayload(linkedRequisition.payloadJson)
    : null;
  if (requisitionId) {
    if (!linkedRequisition || linkedRequisition.reportType !== PURCHASE_REQUISITION_REPORT_TYPE) {
      return NextResponse.json({ message: "Linked requisition not found." }, { status: 404 });
    }
    if (!parsedRequisition) {
      return NextResponse.json({ message: "Linked requisition payload is invalid." }, { status: 422 });
    }
    if (parsedRequisition.payload.status !== "APPROVED") {
      return NextResponse.json(
        {
          message:
            "Only approved requisitions can proceed to purchase and receipt posting."
        },
        { status: 409 }
      );
    }
    const requisitionContext = parsedRequisition.payload.context;
    if (requisitionContext.clientId && clientId && requisitionContext.clientId !== clientId) {
      return NextResponse.json(
        { message: "Linked requisition client does not match selected client." },
        { status: 400 }
      );
    }
    if (requisitionContext.projectId && projectId && requisitionContext.projectId !== projectId) {
      return NextResponse.json(
        { message: "Linked requisition project does not match selected project." },
        { status: 400 }
      );
    }
    if (requisitionContext.rigId && rigId && requisitionContext.rigId !== rigId) {
      return NextResponse.json(
        { message: "Linked requisition rig does not match selected rig." },
        { status: 400 }
      );
    }
    if (
      requisitionContext.maintenanceRequestId &&
      maintenanceRequestId &&
      requisitionContext.maintenanceRequestId !== maintenanceRequestId
    ) {
      return NextResponse.json(
        {
          message:
            "Linked requisition maintenance request does not match selected maintenance request."
        },
        { status: 400 }
      );
    }
    if (
      requisitionContext.breakdownReportId &&
      breakdownReportId &&
      requisitionContext.breakdownReportId !== breakdownReportId
    ) {
      return NextResponse.json(
        {
          message:
            "Linked requisition breakdown context does not match selected breakdown."
        },
        { status: 400 }
      );
    }

    clientId = clientId || requisitionContext.clientId || null;
    projectId = projectId || requisitionContext.projectId || null;
    rigId = rigId || requisitionContext.rigId || null;
    maintenanceRequestId =
      maintenanceRequestId || requisitionContext.maintenanceRequestId || null;
    breakdownReportId =
      breakdownReportId || requisitionContext.breakdownReportId || null;

    if (parsedRequisition.payload.type === "INVENTORY_STOCK_UP" && projectId) {
      return NextResponse.json(
        {
          message:
            "Inventory stock-up requisitions cannot be posted as live project costs."
        },
        { status: 400 }
      );
    }

    const expectedReceiptType = mapRequisitionToReceiptClassification(
      parsedRequisition.payload.type
    );
    if (receiptType !== expectedReceiptType) {
      return NextResponse.json(
        {
          message: `Linked requisition expects ${expectedReceiptType} receipt workflow.`
        },
        { status: 400 }
      );
    }
    const expectedWorkflowType = mapRequisitionTypeToWorkflowType(parsedRequisition.payload.type);
    if (workflowType !== expectedWorkflowType) {
      return NextResponse.json(
        {
          message: `Linked requisition expects ${formatWorkflowTypeLabel(expectedWorkflowType)}.`
        },
        { status: 400 }
      );
    }
    workflowType = expectedWorkflowType;
  }

  if (workflowType === "PROJECT_PURCHASE") {
    maintenanceRequestId = null;
    breakdownReportId = null;
  }
  if (breakdownReportId && existingBreakdownReport) {
    projectId = projectId || existingBreakdownReport.projectId || null;
    rigId = rigId || existingBreakdownReport.rigId || null;
    clientId = clientId || existingBreakdownReport.clientId || null;
  }

  if (workflowType === "MAINTENANCE_PURCHASE") {
    if (!rigId && existingMaintenanceRequest?.rigId) rigId = existingMaintenanceRequest.rigId;
    if (!projectId && existingMaintenanceRequest?.projectId) {
      projectId = existingMaintenanceRequest.projectId;
    }
    if (!clientId && existingMaintenanceRequest?.clientId) {
      clientId = existingMaintenanceRequest.clientId;
    }
    if (!breakdownReportId && existingMaintenanceRequest?.breakdownReportId) {
      breakdownReportId = existingMaintenanceRequest.breakdownReportId;
    }
  }
  if (workflowType === "STOCK_PURCHASE" || workflowType === "INTERNAL_TRANSFER") {
    clientId = null;
    projectId = null;
    if (workflowType === "STOCK_PURCHASE") {
      rigId = null;
      maintenanceRequestId = null;
      breakdownReportId = null;
    }
  }

  if (workflowType === "PROJECT_PURCHASE" && !projectId) {
    return NextResponse.json({ message: "Project Purchase requires linking a project before submission." }, { status: 400 });
  }
  if (workflowType === "MAINTENANCE_PURCHASE" && !rigId) {
    return NextResponse.json({ message: "Maintenance Purchase (Rig Repair) requires linking a rig before submission." }, { status: 400 });
  }
  allocationStatus = resolveIntakeAllocationStatus({ clientId, projectId });

  const existingItemById = new Map(existingItems.map((item) => [item.id, item]));
  const supplierNameRaw = typeof body?.receipt?.supplierName === "string" ? body.receipt.supplierName.trim() : "";
  const receiptSupplierName = existingSupplier?.name || supplierNameRaw || "Unknown Supplier";
  const receiptSubtotal = parseNumeric(body?.receipt?.subtotal);
  const receiptTax = parseNumeric(body?.receipt?.tax);
  const receiptTotal = parseNumeric(body?.receipt?.total);
  const computedLinesTotal = roundCurrency(
    normalizedLines.reduce((sum, line) => sum + line.lineTotal, 0)
  );
  const candidateTotal = roundCurrency(
    (receiptTotal && receiptTotal > 0 ? receiptTotal : computedLinesTotal) || 0
  );
  const duplicateFingerprintRecord = {
    supplierName: receiptSupplierName,
    tin: receiptTin,
    vrn: receiptVrn,
    receiptNumber: receiptNumber || invoiceReference || "",
    serialNumber,
    receiptDate: formatDateOnly(intakeDate),
    total: candidateTotal,
    verificationCode,
    traReceiptNumber,
    receiptUrl
  };
  const duplicateFingerprint = buildDuplicateFingerprint(duplicateFingerprintRecord);
  const duplicateMatches = await detectReceiptDuplicates(duplicateFingerprintRecord);
  const duplicateReview = buildDuplicateReview({
    matches: duplicateMatches,
    fingerprint: duplicateFingerprintRecord
  });
  const duplicateConfidence =
    duplicateReview?.summary?.duplicateConfidence ||
    (duplicateMatches[0] ? inferDuplicateConfidence(duplicateMatches[0].matchedFields) : "LOW");
  const duplicateRequiresManagerOverride = duplicateConfidence === "HIGH";
  if (duplicateMatches.length > 0 && !allowDuplicateSave) {
    debugLog(
      "[inventory][receipt-intake][duplicate-detected]",
      {
        fingerprint: duplicateFingerprint,
        matches: duplicateMatches.map((match) => ({
          source: match.source,
          id: match.id,
          matchedFields: match.matchedFields,
          reason: match.reason
        }))
      },
      { channel: "inventory-receipt" }
    );
    return NextResponse.json(
      {
        success: false,
        message:
          "This receipt appears to have already been processed. Review the earlier receipt and its linked records before saving again.",
        duplicate: {
          fingerprint: duplicateFingerprint,
          matches: duplicateMatches,
          confidence: duplicateConfidence,
          requiresManagerOverride: duplicateRequiresManagerOverride,
          review: duplicateReview
        }
      },
      { status: 409 }
    );
  }
  if (duplicateMatches.length > 0 && allowDuplicateSave && duplicateRequiresManagerOverride && !canManage) {
    return NextResponse.json(
      {
        success: false,
        message:
          "High-confidence duplicate detected. A manager/admin must review and override this duplicate before continuing.",
        duplicate: {
          fingerprint: duplicateFingerprint,
          matches: duplicateMatches,
          confidence: duplicateConfidence,
          requiresManagerOverride: duplicateRequiresManagerOverride,
          review: duplicateReview
        }
      },
      { status: 403 }
    );
  }
  if (duplicateMatches.length > 0 && allowDuplicateSave) {
    debugLog(
      "[inventory][receipt-intake][duplicate-override]",
      {
        fingerprint: duplicateFingerprint,
        matches: duplicateMatches.map((match) => ({
          source: match.source,
          id: match.id,
          matchedFields: match.matchedFields,
          reason: match.reason
        }))
      },
      { channel: "inventory-receipt" }
    );
  }
  const receiptMetadataNote = buildReceiptMetadataNote({
    tin: receiptTin,
    vrn: receiptVrn,
    serialNumber,
    receiptNumber,
    verificationCode,
    verificationUrl,
    rawQrValue,
    receiptTime,
    paymentMethod,
    taxOffice,
    ocrTextPreview,
    allocationStatus,
    duplicateFingerprint,
    receiptPurpose
  });

  const submissionDraft = {
    requisitionId,
    workflowType,
    receiptType,
    receiptPurpose,
    createExpense,
    expenseOnlyCategory,
    allowDuplicateSave,
    receipt: {
      url: receiptUrl || null,
      fileName: receiptFileName || null,
      supplierId: existingSupplier?.id || null,
      supplierName: receiptSupplierName || null,
      tin: receiptTin || null,
      vrn: receiptVrn || null,
      serialNumber: serialNumber || null,
      receiptNumber: receiptNumber || null,
      verificationCode: verificationCode || null,
      verificationUrl: verificationUrl || null,
      rawQrValue: rawQrValue || null,
      receiptDate: formatDateOnly(intakeDate),
      receiptTime: receiptTime || null,
      traReceiptNumber: traReceiptNumber || null,
      invoiceReference: invoiceReference || null,
      paymentMethod: paymentMethod || null,
      taxOffice: taxOffice || null,
      ocrTextPreview: ocrTextPreview || null,
      currency: typeof body?.receipt?.currency === "string" ? body.receipt.currency.trim() || "USD" : "USD",
      subtotal: roundCurrency(receiptSubtotal || 0),
      tax: roundCurrency(receiptTax || 0),
      total: roundCurrency(
        (receiptTotal && receiptTotal > 0
          ? receiptTotal
          : normalizedLines.reduce((sum, line) => sum + line.lineTotal, 0)) || 0
      )
    },
    linkContext: {
      clientId,
      projectId,
      rigId,
      maintenanceRequestId,
      breakdownReportId,
      locationFromId,
      locationToId
    },
    lines: sanitizeSubmissionLines(normalizedInputLines),
    normalization: {
      validLineCount: normalizedLines.length,
      skippedLineCount: skippedLines.length
    },
    duplicate: {
      fingerprint: duplicateFingerprint,
      matchCount: duplicateMatches.length
    },
    allocationStatus
  };

  if (!canManage) {
    const submittedAt = new Date();
    const pendingPayload = {
      schemaVersion: 1,
      status: "SUBMITTED" as ReceiptSubmissionStatus,
      submissionStatus: "PENDING_REVIEW",
      submittedAt: submittedAt.toISOString(),
      submittedBy: {
        userId: auth.session.userId,
        name: auth.session.name,
        role: auth.session.role
      },
      reviewer: null,
      resolution: null,
      draft: submissionDraft
    };

    const submission = await prisma.summaryReport.create({
      data: {
        reportDate: submittedAt,
        reportType: RECEIPT_SUBMISSION_REPORT_TYPE,
        clientId,
        projectId,
        payloadJson: JSON.stringify(pendingPayload),
        generatedById: auth.session.userId
      },
      select: {
        id: true
      }
    });

    await recordAuditLog({
      module: "inventory",
      entityType: "receipt_intake_submission",
      entityId: submission.id,
      action: "submit",
      description: `${auth.session.name} submitted a receipt intake for manager review.`,
      after: {
        submissionId: submission.id,
        receiptNumber: receiptNumber || null,
        traReceiptNumber: traReceiptNumber || null,
        supplierName: receiptSupplierName,
        allocationStatus
      },
      actor: auditActorFromSession(auth.session)
    });

    return NextResponse.json({
      success: true,
      message: "Receipt submitted for review. A manager/admin will review and finalize posting.",
      data: {
        submissionStatus: "PENDING_REVIEW",
        submissionId: submission.id,
        requisitionId,
        workflowType,
        receiptType,
        movementCount: 0,
        itemsCreatedCount: 0,
        evidenceOnlyLinesCount: evidenceOnlyLines.length,
        skippedLinesCount: skippedLines.length,
        allocationStatus,
        needsAllocation: allocationStatus !== "ALLOCATED",
        receiptPurpose,
        allocationMessage:
          allocationStatus === "ALLOCATED"
            ? "Submitted for review"
            : "Submitted for review. Project/client allocation can be completed during manager review.",
        totals: {
          subtotal: roundCurrency(receiptSubtotal || 0),
          tax: roundCurrency(receiptTax || 0),
          total: roundCurrency(
            (receiptTotal && receiptTotal > 0
              ? receiptTotal
              : normalizedLines.reduce((sum, line) => sum + line.lineTotal, 0)) || 0
          )
        },
        createdMovements: [],
        lineOutcomes: [],
        outcomeReasons: [
          "Submitted as pending review. No inventory stock, accounting, or irreversible posting actions were applied."
        ]
      }
    });
  }

  const linkedSubmission = submissionId
    ? await prisma.summaryReport.findUnique({
        where: { id: submissionId },
        select: {
          id: true,
          reportType: true,
          payloadJson: true,
          updatedAt: true
        }
      })
    : null;
  const linkedSubmissionParsed = linkedSubmission
    ? parseReceiptSubmissionPayload(linkedSubmission.payloadJson)
    : null;

  if (submissionId) {
    if (!linkedSubmission || linkedSubmission.reportType !== RECEIPT_SUBMISSION_REPORT_TYPE) {
      return NextResponse.json({ message: "Receipt submission not found." }, { status: 404 });
    }
    if (linkedSubmissionParsed?.status === "APPROVED") {
      return NextResponse.json({ message: "Receipt submission is already finalized." }, { status: 409 });
    }
  }

  let result: ReceiptCommitTransactionResult;
  try {
    result = await runReceiptCommitTransaction({
      session: auth.session,
      submissionId,
      linkedSubmission: linkedSubmission
        ? { id: linkedSubmission.id, updatedAt: linkedSubmission.updatedAt }
        : null,
      linkedSubmissionParsed,
      submissionDraft: submissionDraft as Record<string, unknown>,
      requisitionId,
      linkedRequisition: linkedRequisition ? { id: linkedRequisition.id } : null,
      parsedRequisition,
      existingSupplierId: existingSupplier?.id || null,
      receiptSupplierName,
      inventoryActionLines,
      existingItemById,
      locationToId,
      receiptType,
      createExpense,
      receiptPurpose,
      expenseOnlyCategory,
      workflowType,
      receiptTotal: receiptTotal ?? 0,
      computedLinesTotal,
      rigId,
      intakeDate,
      receiptNumber,
      traReceiptNumber,
      invoiceReference,
      receiptUrl,
      receiptFileName,
      receiptTin,
      receiptMetadataNote,
      clientId,
      projectId,
      maintenanceRequestId,
      breakdownReportId,
      locationFromId,
      evidenceOnlyLines,
      skippedLines,
      normalizedLines
    });
  } catch (error) {
    if (error instanceof Error && error.message === "ReceiptSubmissionFinalizeConflict") {
      return NextResponse.json(
        {
          message:
            "Receipt submission is already being finalized in another session. Refresh and retry."
        },
        { status: 409 }
      );
    }
    console.error("[inventory/receipt-intake/commit]", {
      message: error instanceof Error ? error.message : "Unknown error"
    });
    return NextResponse.json(
      { message: "Failed to save receipt intake posting. Please retry." },
      { status: 500 }
    );
  }

  const outcomeReasons: string[] = [];
  if (result.createdMovements.length === 0) {
    if (result.evidenceOnlyLinesCount > 0) {
      outcomeReasons.push(
        `${result.evidenceOnlyLinesCount} line(s) were saved as receipt/expense evidence only.`
      );
    }
    if (result.skippedLinesCount > 0) {
      const skippedPreview = result.skippedReasons.slice(0, 3).join("; ");
      outcomeReasons.push(
        `${result.skippedLinesCount} line(s) were skipped due to validation${skippedPreview ? ` (${skippedPreview})` : ""}.`
      );
    }
    if (result.evidenceOnlyLinesCount === 0 && result.skippedLinesCount === 0) {
      outcomeReasons.push("No valid inventory-action lines were available for stock-in creation.");
    }
  }

  debugLog(
    "[inventory][receipt-intake][save-summary]",
    {
      receiptSaved: true,
      itemsCreated: result.itemsCreatedCount,
      stockMovementsCreated: result.createdMovements.length,
      evidenceOnlyLines: result.evidenceOnlyLinesCount,
      skippedLines: result.skippedLinesCount,
      outcomeReasons
    },
    { channel: "inventory-receipt" }
  );

  return NextResponse.json({
    success: true,
    message:
      result.createdMovements.length > 0
        ? `Saved with ${result.createdMovements.length} stock-in movement(s).`
        : outcomeReasons[0] || "Saved as receipt evidence only.",
    data: {
      submissionStatus: result.submissionStatus,
      submissionId: submissionId || null,
      requisitionId,
      requisitionStatus: result.requisitionStatus,
      workflowType,
      receiptType,
      supplier: result.supplierName,
      movementCount: result.createdMovements.length,
      itemsCreatedCount: result.itemsCreatedCount,
      evidenceOnlyLinesCount: result.evidenceOnlyLinesCount,
      skippedLinesCount: result.skippedLinesCount,
      outcomeReasons,
      allocationStatus,
      needsAllocation: allocationStatus !== "ALLOCATED",
      receiptPurpose,
      allocationMessage:
        allocationStatus === "ALLOCATED"
          ? "Allocated"
          : allocationStatus === "PARTIALLY_ALLOCATED"
            ? "Saved as Partially allocated. Project or client is still missing."
            : "Saved as Unallocated. You can assign project/client later.",
      expenseId: result.createdExpenseId,
      totals: {
        subtotal: roundCurrency(receiptSubtotal || 0),
        tax: roundCurrency(receiptTax || 0),
        total: roundCurrency(
          (receiptTotal && receiptTotal > 0
            ? receiptTotal
            : normalizedLines.reduce((sum, line) => sum + line.lineTotal, 0)) || 0
        )
      },
      createdMovements: result.createdMovements,
      lineOutcomes: result.lineOutcomes
    }
  });
}
