import type { InventoryCategory, Prisma } from "@prisma/client";
import { NextResponse, type NextRequest } from "next/server";

import { canAccess } from "@/lib/auth/permissions";
import { requireApiPermission } from "@/lib/auth/api-guard";
import { auditActorFromSession, recordAuditLog } from "@/lib/audit";
import {
  parseDateOrNull,
  parseInventoryCategory,
  parseNumeric,
  resolveExpenseApprovalStatus,
  resolveExpenseCategoryFromInventoryCategory,
  roundCurrency
} from "@/lib/inventory-server";
import { prisma } from "@/lib/prisma";
import { parseReceiptSubmissionPayload, type ReceiptSubmissionStatus } from "@/lib/receipt-intake-submission";

interface IntakeLinePayload {
  id?: string;
  description?: string;
  quantity?: number | string;
  unitPrice?: number | string;
  lineTotal?: number | string;
  selectedItemId?: string | null;
  selectedCategory?: string | null;
  mode?: "MATCH" | "NEW" | "EXPENSE_ONLY";
  newItem?: {
    name?: string;
    sku?: string;
    category?: string;
    minimumStockLevel?: number | string;
    locationId?: string | null;
    status?: "ACTIVE" | "INACTIVE";
    notes?: string;
  };
}

interface IntakeCommitPayload {
  submissionId?: string | null;
  receipt?: {
    url?: string;
    fileName?: string;
    supplierId?: string | null;
    supplierName?: string;
    tin?: string;
    vrn?: string;
    serialNumber?: string;
    receiptNumber?: string;
    verificationCode?: string;
    verificationUrl?: string;
    rawQrValue?: string;
    receiptDate?: string;
    receiptTime?: string;
    traReceiptNumber?: string;
    invoiceReference?: string;
    paymentMethod?: string;
    taxOffice?: string;
    ocrTextPreview?: string;
    currency?: string;
    subtotal?: number | string;
    tax?: number | string;
    total?: number | string;
  };
  linkContext?: {
    clientId?: string | null;
    projectId?: string | null;
    rigId?: string | null;
    maintenanceRequestId?: string | null;
    locationFromId?: string | null;
    locationToId?: string | null;
  };
  createExpense?: boolean;
  allowDuplicateSave?: boolean;
  receiptType?:
    | "INVENTORY_PURCHASE"
    | "MAINTENANCE_LINKED_PURCHASE"
    | "EXPENSE_ONLY"
    | "INTERNAL_TRANSFER";
  expenseOnlyCategory?: "TRAVEL" | "FOOD" | "FUEL" | "MISC";
  receiptPurpose?: "INVENTORY_PURCHASE" | "BUSINESS_EXPENSE_ONLY" | "INVENTORY_AND_EXPENSE" | "EVIDENCE_ONLY" | "OTHER_MANUAL";
  lines?: IntakeLinePayload[];
}

interface NormalizedIntakeLine {
  lineId: string;
  description: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  selectedItemId: string | null;
  selectedCategory: string | null;
  newItem: NonNullable<IntakeLinePayload["newItem"]> | null;
  mode: "MATCH" | "NEW" | "EXPENSE_ONLY";
}

interface SkippedIntakeLine {
  lineId: string;
  description: string;
  reason: string;
}

type IntakeAllocationStatus = "ALLOCATED" | "PARTIALLY_ALLOCATED" | "UNALLOCATED";

interface ReceiptDuplicateFingerprint {
  supplierName: string;
  tin: string;
  vrn: string;
  receiptNumber: string;
  serialNumber: string;
  receiptDate: string;
  total: number;
  verificationCode: string;
  traReceiptNumber: string;
  receiptUrl: string;
}

interface ReceiptDuplicateMatch {
  source: "inventory_movement" | "expense";
  id: string;
  matchedFields: string[];
  reason: string;
  viewUrl: string;
  createdAt: Date;
  supplierName: string;
  receiptNumber: string;
  verificationCode: string;
  serialNumber: string;
  receiptDate: string;
  total: number;
  traReceiptNumber: string;
  stockMovementId: string | null;
  expenseId: string | null;
  itemId: string | null;
  itemName: string | null;
  receiptPurpose: string;
}

interface DuplicateLinkedRecord {
  id: string;
  label: string;
  type: "RECEIPT_INTAKE" | "INVENTORY_ITEM" | "STOCK_MOVEMENT" | "EXPENSE";
  url: string;
}

interface DuplicateReviewPayload {
  summary: {
    supplierName: string;
    receiptNumber: string;
    verificationCode: string;
    serialNumber: string;
    receiptDate: string;
    total: number;
    traReceiptNumber: string;
    processedAt: string;
    duplicateConfidence: "HIGH" | "MEDIUM" | "LOW";
    matchReason: string;
    matchedFields: string[];
    receiptPurpose: string;
  };
  primaryRecord: DuplicateLinkedRecord | null;
  linkedRecords: {
    receiptIntake: DuplicateLinkedRecord[];
    inventoryItems: DuplicateLinkedRecord[];
    stockMovements: DuplicateLinkedRecord[];
    expenses: DuplicateLinkedRecord[];
  };
}

type ReceiptPurpose =
  | "INVENTORY_PURCHASE"
  | "BUSINESS_EXPENSE_ONLY"
  | "INVENTORY_AND_EXPENSE"
  | "EVIDENCE_ONLY"
  | "OTHER_MANUAL";
type ReceiptType =
  | "INVENTORY_PURCHASE"
  | "MAINTENANCE_LINKED_PURCHASE"
  | "EXPENSE_ONLY"
  | "INTERNAL_TRANSFER";

const RECEIPT_SUBMISSION_REPORT_TYPE = "INVENTORY_RECEIPT_SUBMISSION";

export async function POST(request: NextRequest) {
  const auth = await requireApiPermission(request, "inventory:view");
  if (!auth.ok) {
    return auth.response;
  }
  const canManage = canAccess(auth.session.role, "inventory:manage");

  const body = (await request.json().catch(() => null)) as IntakeCommitPayload | null;
  const submissionId =
    typeof body?.submissionId === "string" && body.submissionId.trim().length > 0
      ? body.submissionId.trim()
      : null;
  const lines = Array.isArray(body?.lines) ? body.lines : [];
  const receiptType = resolveReceiptType(body?.receiptType);
  const receiptPurpose = resolveReceiptPurpose(body?.receiptPurpose);
  const requestedCreateExpense = Boolean(body?.createExpense);
  const createExpense = resolveCreateExpenseByPurpose({
    receiptType,
    receiptPurpose,
    requestedCreateExpense
  });
  const allowDuplicateSave = Boolean(body?.allowDuplicateSave);
  if (receiptPurpose === "OTHER_MANUAL") {
    return NextResponse.json(
      {
        message: "Receipt purpose is set to manual decision. Complete mapping before final save."
      },
      { status: 400 }
    );
  }
  const normalizedInputLines =
    receiptType === "EXPENSE_ONLY" ||
    receiptPurpose === "BUSINESS_EXPENSE_ONLY" ||
    receiptPurpose === "EVIDENCE_ONLY"
      ? lines.map((line) => ({ ...line, mode: "EXPENSE_ONLY" as const, selectedItemId: null }))
      : lines;
  if (normalizedInputLines.length === 0 && !createExpense) {
    return NextResponse.json(
      {
        message:
          "At least one intake line is required unless you are saving receipt evidence as an expense."
      },
      { status: 400 }
    );
  }

  const intakeDate =
    parseDateOrNull(typeof body?.receipt?.receiptDate === "string" ? body.receipt.receiptDate : null) || new Date();
  const receiptUrl = typeof body?.receipt?.url === "string" ? body.receipt.url.trim() : "";
  const receiptFileName = typeof body?.receipt?.fileName === "string" ? body.receipt.fileName.trim() : "";
  const traReceiptNumber =
    typeof body?.receipt?.traReceiptNumber === "string" ? body.receipt.traReceiptNumber.trim() : "";
  const receiptNumber =
    typeof body?.receipt?.receiptNumber === "string" ? body.receipt.receiptNumber.trim() : "";
  const receiptTin = typeof body?.receipt?.tin === "string" ? body.receipt.tin.trim() : "";
  const receiptVrn = typeof body?.receipt?.vrn === "string" ? body.receipt.vrn.trim() : "";
  const serialNumber =
    typeof body?.receipt?.serialNumber === "string" ? body.receipt.serialNumber.trim() : "";
  const verificationCode =
    typeof body?.receipt?.verificationCode === "string" ? body.receipt.verificationCode.trim() : "";
  const verificationUrl =
    typeof body?.receipt?.verificationUrl === "string" ? body.receipt.verificationUrl.trim() : "";
  const rawQrValue =
    typeof body?.receipt?.rawQrValue === "string" ? body.receipt.rawQrValue.trim() : "";
  const receiptTime =
    typeof body?.receipt?.receiptTime === "string" ? body.receipt.receiptTime.trim() : "";
  const invoiceReference =
    typeof body?.receipt?.invoiceReference === "string" ? body.receipt.invoiceReference.trim() : "";
  const paymentMethod =
    typeof body?.receipt?.paymentMethod === "string" ? body.receipt.paymentMethod.trim() : "";
  const taxOffice = typeof body?.receipt?.taxOffice === "string" ? body.receipt.taxOffice.trim() : "";
  const ocrTextPreview =
    typeof body?.receipt?.ocrTextPreview === "string" ? body.receipt.ocrTextPreview.trim() : "";
  const clientId =
    typeof body?.linkContext?.clientId === "string" && body.linkContext.clientId !== "all"
      ? body.linkContext.clientId
      : null;
  const projectId =
    typeof body?.linkContext?.projectId === "string" && body.linkContext.projectId !== "all"
      ? body.linkContext.projectId
      : null;
  const rigId =
    typeof body?.linkContext?.rigId === "string" && body.linkContext.rigId !== "all"
      ? body.linkContext.rigId
      : null;
  const maintenanceRequestId =
    typeof body?.linkContext?.maintenanceRequestId === "string" &&
    body.linkContext.maintenanceRequestId !== "all"
      ? body.linkContext.maintenanceRequestId
      : null;
  const locationFromId =
    typeof body?.linkContext?.locationFromId === "string" && body.linkContext.locationFromId !== "all"
      ? body.linkContext.locationFromId
      : null;
  const locationToId =
    typeof body?.linkContext?.locationToId === "string" && body.linkContext.locationToId !== "all"
      ? body.linkContext.locationToId
      : null;
  const expenseOnlyCategory = resolveExpenseOnlyCategory(body?.expenseOnlyCategory);
  const allocationStatus = resolveIntakeAllocationStatus({ clientId, projectId });

  if (receiptType === "MAINTENANCE_LINKED_PURCHASE" && !maintenanceRequestId) {
    return NextResponse.json(
      { message: "Maintenance-linked receipts require a maintenance request." },
      { status: 400 }
    );
  }
  if (receiptType === "EXPENSE_ONLY" && !expenseOnlyCategory) {
    return NextResponse.json(
      {
        message:
          "Expense-only receipts require an expense category (Travel, Food, Fuel, or Misc)."
      },
      { status: 400 }
    );
  }
  if (receiptType === "INTERNAL_TRANSFER" && !locationToId) {
    return NextResponse.json(
      { message: "Internal transfer receipts require a destination stock location." },
      { status: 400 }
    );
  }

  const normalization = normalizeLines(normalizedInputLines);
  const normalizedLines = normalization.normalized;
  const skippedLines = normalization.skipped;
  if (normalizedLines.length === 0 && !createExpense) {
    return NextResponse.json(
      {
        message:
          "No valid intake lines found after validation. Add at least one valid line or save as expense evidence."
      },
      { status: 400 }
    );
  }
  const inventoryActionLines = normalizedLines.filter((line) => line.mode !== "EXPENSE_ONLY");
  const evidenceOnlyLines = normalizedLines.filter((line) => line.mode === "EXPENSE_ONLY");
  if (inventoryActionLines.length === 0 && !createExpense) {
    return NextResponse.json(
      {
        message:
          "All lines are marked as expense evidence only. Enable expense evidence or switch at least one line to an inventory action."
      },
      { status: 400 }
    );
  }
  if (receiptType === "INTERNAL_TRANSFER") {
    if (!locationFromId || !locationToId) {
      return NextResponse.json(
        { message: "Internal transfer requires both from-location and to-location." },
        { status: 400 }
      );
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

  const [existingItems, existingSupplier, existingLocationFrom, existingLocationTo, existingMaintenanceRequest] = await Promise.all([
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
          select: { id: true, status: true, requestCode: true }
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
    if (process.env.NODE_ENV !== "production") {
      console.info("[inventory][receipt-intake][duplicate-detected]", {
        fingerprint: duplicateFingerprint,
        matches: duplicateMatches.map((match) => ({
          source: match.source,
          id: match.id,
          matchedFields: match.matchedFields,
          reason: match.reason
        }))
      });
    }
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
  if (duplicateMatches.length > 0 && allowDuplicateSave && process.env.NODE_ENV !== "production") {
    console.info("[inventory][receipt-intake][duplicate-override]", {
      fingerprint: duplicateFingerprint,
      matches: duplicateMatches.map((match) => ({
        source: match.source,
        id: match.id,
        matchedFields: match.matchedFields,
        reason: match.reason
      }))
    });
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
      currency: typeof body?.receipt?.currency === "string" ? body.receipt.currency.trim() || "TZS" : "TZS",
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
          payloadJson: true
        }
      })
    : null;

  if (submissionId) {
    if (!linkedSubmission || linkedSubmission.reportType !== RECEIPT_SUBMISSION_REPORT_TYPE) {
      return NextResponse.json({ message: "Receipt submission not found." }, { status: 404 });
    }
    const parsed = parseReceiptSubmissionPayload(linkedSubmission.payloadJson);
    if (parsed?.status === "APPROVED") {
      return NextResponse.json({ message: "Receipt submission is already finalized." }, { status: 409 });
    }
  }

  const result = await prisma.$transaction(async (tx) => {
    const supplier = await resolveSupplier({
      tx,
      existingSupplierId: existingSupplier?.id || null,
      supplierName: receiptSupplierName
    });

    const categoryCandidates: InventoryCategory[] = [];
    for (const line of inventoryActionLines) {
      if (line.selectedItemId) {
        const existing = existingItemById.get(line.selectedItemId);
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

    if (createExpense) {
      const expenseApprovalStatus = resolveExpenseApprovalStatus({
        role: auth.session.role,
        linkedMaintenanceStatus: existingMaintenanceRequest?.status || null
      });
      const submittedAt = expenseApprovalStatus === "DRAFT" ? null : new Date();
      const approvedAt = expenseApprovalStatus === "APPROVED" ? new Date() : null;
      const approvedById = expenseApprovalStatus === "APPROVED" ? auth.session.userId : null;
      const isEvidenceOnlyPurpose = receiptPurpose === "EVIDENCE_ONLY";
      const expenseCategory = resolveExpenseCategoryForReceiptType({
        receiptType,
        expenseOnlyCategory,
        dominantCategory,
        isEvidenceOnlyPurpose
      });
      const expenseAmount = isEvidenceOnlyPurpose
        ? 0
        : receiptTotal && receiptTotal > 0
          ? receiptTotal
          : computedLinesTotal;
      const expense = await tx.expense.create({
        data: {
          date: intakeDate,
          amount: expenseAmount,
          category: expenseCategory,
          subcategory: isEvidenceOnlyPurpose ? "Receipt Evidence Only" : "Inventory Receipt Intake",
          entrySource: "INVENTORY",
          vendor: supplier?.name || receiptSupplierName || null,
          receiptNumber: receiptNumber || traReceiptNumber || invoiceReference || null,
          receiptUrl: receiptUrl || null,
          receiptFileName: receiptFileName || null,
          notes: `Receipt intake: ${receiptSupplierName}${receiptTin ? ` (TIN: ${receiptTin})` : ""}${receiptMetadataNote ? `\n${receiptMetadataNote}` : ""}`,
          enteredByUserId: auth.session.userId,
          approvalStatus: expenseApprovalStatus,
          submittedAt,
          approvedById,
          approvedAt,
          clientId,
          projectId,
          rigId
        },
        select: { id: true }
      });
      createdExpenseId = expense.id;
    }

    const createdMovements: Array<{ id: string; itemId: string; quantity: number; totalCost: number }> = [];
    let itemsCreatedCount = 0;
    const lineOutcomes: Array<Record<string, unknown>> = [];
    const skippedReasons: string[] = [];

    for (const line of evidenceOnlyLines) {
      lineOutcomes.push({
        lineId: line.lineId,
        description: line.description,
        mode: line.mode,
        result: "SKIPPED_EVIDENCE_ONLY",
        reason: "Line was marked as receipt/expense evidence only."
      });
      skippedReasons.push(`"${line.description}": evidence-only`);
    }

    for (const skipped of skippedLines) {
      lineOutcomes.push({
        lineId: skipped.lineId,
        description: skipped.description,
        mode: "SKIPPED",
        result: "SKIPPED_VALIDATION",
        reason: skipped.reason
      });
      skippedReasons.push(`"${skipped.description || skipped.lineId}": ${skipped.reason}`);
    }

    for (const line of inventoryActionLines) {
      const resolvedItem = await resolveIntakeItem({
        tx,
        line,
        existingItemById,
        supplierId: supplier?.id || null,
        locationToId
      });
      if (resolvedItem.resolution === "AUTO_CREATED") {
        itemsCreatedCount += 1;
      }

      if (process.env.NODE_ENV !== "production") {
        console.info("[inventory][receipt-intake][line]", {
          lineId: line.lineId,
          description: line.description,
          mode: line.mode,
          resolution: resolvedItem.resolution,
          matchedItemId: resolvedItem.resolution === "MATCHED_EXISTING" ? resolvedItem.id : null,
          matchedItemName: resolvedItem.resolution === "MATCHED_EXISTING" ? resolvedItem.name : null,
          createdItemId: resolvedItem.resolution === "AUTO_CREATED" ? resolvedItem.id : null,
          createdItemName: resolvedItem.resolution === "AUTO_CREATED" ? resolvedItem.name : null
        });
      }

      const movement = await tx.inventoryMovement.create({
        data: {
          itemId: resolvedItem.id,
          movementType: receiptType === "INTERNAL_TRANSFER" ? "TRANSFER" : "IN",
          quantity: line.quantity,
          unitCost: line.unitPrice,
          totalCost: line.lineTotal,
          date: intakeDate,
          performedByUserId: auth.session.userId,
          clientId,
          projectId,
          rigId,
          maintenanceRequestId,
          expenseId: createdExpenseId,
          supplierId: supplier?.id || null,
          locationFromId: locationFromId || null,
          locationToId: locationToId || line.newItem?.locationId || null,
          traReceiptNumber: traReceiptNumber || receiptNumber || null,
          supplierInvoiceNumber: invoiceReference || receiptNumber || null,
          receiptUrl: receiptUrl || null,
          receiptFileName: receiptFileName || null,
          notes: `Receipt intake line: ${line.description}${receiptMetadataNote ? `\n${receiptMetadataNote}` : ""}`
        },
        select: {
          id: true,
          itemId: true,
          quantity: true,
          totalCost: true
        }
      });

      const nextStock =
        receiptType === "INTERNAL_TRANSFER"
          ? roundCurrency(resolvedItem.quantityInStock)
          : roundCurrency(resolvedItem.quantityInStock + line.quantity);
      await tx.inventoryItem.update({
        where: { id: resolvedItem.id },
        data: {
          quantityInStock: nextStock,
          unitCost:
            receiptType !== "INTERNAL_TRANSFER" && line.unitPrice > 0 ? line.unitPrice : undefined,
          supplierId: supplier?.id || null,
          locationId:
            receiptType === "INTERNAL_TRANSFER"
              ? locationToId || line.newItem?.locationId || undefined
              : locationToId || line.newItem?.locationId || undefined
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
        description: `${auth.session.name} created stock intake movement for ${line.description}.`,
        after: {
          movementId: movement.id,
          itemId: movement.itemId,
          quantity: line.quantity,
          unitCost: line.unitPrice,
          lineTotal: line.lineTotal,
          receiptUrl,
          traReceiptNumber
        },
        actor: auditActorFromSession(auth.session)
      });
    }

    return {
      createdMovements,
      createdExpenseId,
      supplierName: supplier?.name || receiptSupplierName,
      itemsCreatedCount,
      evidenceOnlyLinesCount: evidenceOnlyLines.length,
      skippedLinesCount: skippedLines.length,
      lineOutcomes,
      skippedReasons
    };
  });

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

  if (process.env.NODE_ENV !== "production") {
    console.info("[inventory][receipt-intake][save-summary]", {
      receiptSaved: true,
      itemsCreated: result.itemsCreatedCount,
      stockMovementsCreated: result.createdMovements.length,
      evidenceOnlyLines: result.evidenceOnlyLinesCount,
      skippedLines: result.skippedLinesCount,
      outcomeReasons
    });
  }

  if (submissionId && linkedSubmission) {
    const previousPayload = parseReceiptSubmissionPayload(linkedSubmission.payloadJson);
    const approvedAtIso = new Date().toISOString();
    const previousSubmittedBy =
      previousPayload?.submittedBy && previousPayload.submittedBy.userId
        ? previousPayload.submittedBy
        : null;
    const approvedPayload = {
      schemaVersion: 1,
      status: "APPROVED" as ReceiptSubmissionStatus,
      submissionStatus: "FINALIZED",
      submittedAt: previousPayload?.submittedAt || approvedAtIso,
      submittedBy:
        previousSubmittedBy || {
          userId: auth.session.userId,
          name: auth.session.name,
          role: auth.session.role
        },
      reviewer: {
        userId: auth.session.userId,
        name: auth.session.name,
        role: auth.session.role,
        decision: "APPROVED",
        decidedAt: approvedAtIso,
        note: ""
      },
      resolution: {
        approvedAt: approvedAtIso,
        movementCount: result.createdMovements.length,
        itemsCreatedCount: result.itemsCreatedCount,
        evidenceOnlyLinesCount: result.evidenceOnlyLinesCount,
        skippedLinesCount: result.skippedLinesCount,
        expenseId: result.createdExpenseId
      },
      draft: submissionDraft
    };

    await prisma.summaryReport.update({
      where: { id: submissionId },
      data: {
        payloadJson: JSON.stringify(approvedPayload),
        reportDate: new Date()
      }
    });

    await recordAuditLog({
      module: "inventory",
      entityType: "receipt_intake_submission",
      entityId: submissionId,
      action: "approve",
      description: `${auth.session.name} approved and finalized receipt intake submission ${submissionId}.`,
      before: {
        status: previousPayload?.status || "SUBMITTED"
      },
      after: {
        status: "APPROVED",
        movementCount: result.createdMovements.length,
        expenseId: result.createdExpenseId
      },
      actor: auditActorFromSession(auth.session)
    });
  }

  return NextResponse.json({
    success: true,
    message:
      result.createdMovements.length > 0
        ? `Saved with ${result.createdMovements.length} stock-in movement(s).`
        : outcomeReasons[0] || "Saved as receipt evidence only.",
    data: {
        submissionStatus: submissionId ? "FINALIZED" : null,
        submissionId: submissionId || null,
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

function normalizeLines(lines: IntakeLinePayload[]): {
  normalized: NormalizedIntakeLine[];
  skipped: SkippedIntakeLine[];
} {
  const normalized: NormalizedIntakeLine[] = [];
  const skipped: SkippedIntakeLine[] = [];

  for (const [index, line] of lines.entries()) {
    const lineId =
      typeof line.id === "string" && line.id.trim().length > 0
        ? line.id
        : `line-${index + 1}`;
    const description = typeof line.description === "string" ? line.description.trim() : "";
    const quantity = parseNumeric(line.quantity);
    const unitPrice = parseNumeric(line.unitPrice);
    const lineTotal = parseNumeric(line.lineTotal);
    const selectedItemId = typeof line.selectedItemId === "string" && line.selectedItemId.trim() ? line.selectedItemId : null;
    const requestedMode =
      line.mode === "NEW" ? "NEW" : line.mode === "EXPENSE_ONLY" ? "EXPENSE_ONLY" : "MATCH";
    const mode: "MATCH" | "NEW" | "EXPENSE_ONLY" =
      requestedMode === "MATCH" && !selectedItemId ? "NEW" : requestedMode;
    const selectedCategory = typeof line.selectedCategory === "string" ? line.selectedCategory : null;
    const normalizedLineTotal =
      lineTotal && lineTotal > 0
        ? lineTotal
        : quantity && unitPrice
          ? quantity * unitPrice
          : 0;

    if (!description) {
      skipped.push({
        lineId,
        description: "",
        reason: "Missing description."
      });
      continue;
    }
    if (!quantity || quantity <= 0) {
      skipped.push({
        lineId,
        description,
        reason: "Missing or invalid quantity."
      });
      continue;
    }
    if ((!unitPrice || unitPrice <= 0) && (!lineTotal || lineTotal <= 0)) {
      skipped.push({
        lineId,
        description,
        reason: "Missing line total and unit price."
      });
      continue;
    }
    const safeUnitPrice = unitPrice && unitPrice > 0 ? unitPrice : normalizedLineTotal / Math.max(1, quantity);
    const safeLineTotal = normalizedLineTotal > 0 ? normalizedLineTotal : safeUnitPrice * quantity;
    if (!Number.isFinite(safeUnitPrice) || !Number.isFinite(safeLineTotal)) {
      skipped.push({
        lineId,
        description,
        reason: "Invalid unit price or line total."
      });
      continue;
    }

    normalized.push({
      lineId,
      description,
      quantity: roundCurrency(quantity),
      unitPrice: roundCurrency(Math.max(0, safeUnitPrice)),
      lineTotal: roundCurrency(Math.max(0, safeLineTotal)),
      selectedItemId,
      selectedCategory,
      newItem: line.newItem || null,
      mode
    });
  }

  return { normalized, skipped };
}

async function resolveSupplier({
  tx,
  existingSupplierId,
  supplierName
}: {
  tx: Prisma.TransactionClient;
  existingSupplierId: string | null;
  supplierName: string;
}) {
  if (existingSupplierId) {
    return tx.inventorySupplier.findUnique({
      where: { id: existingSupplierId },
      select: { id: true, name: true }
    });
  }
  const normalizedName = supplierName.trim();
  if (!normalizedName) {
    return null;
  }

  const existing = await tx.inventorySupplier.findFirst({
    where: {
      name: normalizedName
    },
    select: { id: true, name: true }
  });
  if (existing) {
    return existing;
  }

  return tx.inventorySupplier.create({
    data: {
      name: normalizedName
    },
    select: { id: true, name: true }
  });
}

async function resolveIntakeItem({
  tx,
  line,
  existingItemById,
  supplierId,
  locationToId
}: {
  tx: Prisma.TransactionClient;
  line: NormalizedIntakeLine;
  existingItemById: Map<
    string,
    {
      id: string;
      name: string;
      sku: string;
      category: InventoryCategory;
      quantityInStock: number;
      minimumStockLevel: number;
      unitCost: number;
      status: "ACTIVE" | "INACTIVE";
    }
  >;
  supplierId: string | null;
  locationToId: string | null;
}) {
  if (line.mode === "MATCH" && line.selectedItemId) {
    const existing = existingItemById.get(line.selectedItemId);
    if (existing) {
      return {
        ...existing,
        resolution: "MATCHED_EXISTING" as const
      };
    }
  }

  const newItemName = line.newItem?.name?.trim() || line.description;
  const newItemCategory = parseInventoryCategory(line.newItem?.category || line.selectedCategory || "") || "OTHER";
  const newItemSku =
    line.newItem?.sku?.trim().toUpperCase() || buildGeneratedSku(newItemName);
  const minimumStockLevel = parseNumeric(line.newItem?.minimumStockLevel);

  const skuConflict = await tx.inventoryItem.findUnique({
    where: { sku: newItemSku },
    select: { id: true }
  });
  const finalSku = skuConflict ? `${newItemSku}-${Math.random().toString(36).slice(2, 6).toUpperCase()}` : newItemSku;

  const created = await tx.inventoryItem.create({
    data: {
      name: newItemName,
      sku: finalSku,
      category: newItemCategory,
      description: `Created from receipt intake: ${line.description}`,
      quantityInStock: 0,
      minimumStockLevel: minimumStockLevel && minimumStockLevel >= 0 ? minimumStockLevel : 0,
      unitCost: line.unitPrice,
      supplierId,
      locationId: locationToId || line.newItem?.locationId || null,
      status: line.newItem?.status || "ACTIVE",
      notes: line.newItem?.notes || null
    },
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
  });

  return {
    ...created,
    resolution: "AUTO_CREATED" as const
  };
}

function chooseDominantCategory(categories: InventoryCategory[]) {
  if (categories.length === 0) {
    return null;
  }
  const counts = new Map<InventoryCategory, number>();
  for (const category of categories) {
    counts.set(category, (counts.get(category) || 0) + 1);
  }
  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
}

function buildGeneratedSku(name: string) {
  const base = name
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 12);
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `RCPT-${base || "ITEM"}-${suffix}`;
}

function buildReceiptMetadataNote({
  tin,
  vrn,
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
}: {
  tin: string;
  vrn: string;
  serialNumber: string;
  receiptNumber: string;
  verificationCode: string;
  verificationUrl: string;
  rawQrValue: string;
  receiptTime: string;
  paymentMethod: string;
  taxOffice: string;
  ocrTextPreview: string;
  allocationStatus: IntakeAllocationStatus;
  duplicateFingerprint: string;
  receiptPurpose: ReceiptPurpose;
}) {
  const parts: string[] = [];
  if (tin) parts.push(`TIN=${tin}`);
  if (vrn) parts.push(`VRN=${vrn}`);
  if (serialNumber) parts.push(`Serial=${serialNumber}`);
  if (receiptNumber) parts.push(`ReceiptNo=${receiptNumber}`);
  if (verificationCode) parts.push(`VerificationCode=${verificationCode}`);
  if (verificationUrl) parts.push(`VerificationURL=${verificationUrl}`);
  if (receiptTime) parts.push(`Time=${receiptTime}`);
  if (paymentMethod) parts.push(`PaymentMethod=${paymentMethod}`);
  if (taxOffice) parts.push(`TaxOffice=${taxOffice}`);
  if (allocationStatus) parts.push(`AllocationStatus=${allocationStatus}`);
  if (receiptPurpose) parts.push(`ReceiptPurpose=${receiptPurpose}`);
  if (duplicateFingerprint) parts.push(`Fingerprint=${duplicateFingerprint}`);
  if (rawQrValue) {
    const compact = rawQrValue.length > 320 ? `${rawQrValue.slice(0, 317)}...` : rawQrValue;
    parts.push(`RawQR=${compact}`);
  }
  if (ocrTextPreview) {
    const compactOcr = ocrTextPreview.length > 320 ? `${ocrTextPreview.slice(0, 317)}...` : ocrTextPreview;
    parts.push(`OCR=${compactOcr}`);
  }
  if (parts.length === 0) {
    return "";
  }
  return `Receipt metadata: ${parts.join(" | ")}`;
}

function resolveIntakeAllocationStatus({
  clientId,
  projectId
}: {
  clientId: string | null;
  projectId: string | null;
}): IntakeAllocationStatus {
  if (clientId && projectId) {
    return "ALLOCATED";
  }
  if (clientId || projectId) {
    return "PARTIALLY_ALLOCATED";
  }
  return "UNALLOCATED";
}

function resolveReceiptPurpose(value: unknown): ReceiptPurpose {
  if (
    value === "INVENTORY_PURCHASE" ||
    value === "BUSINESS_EXPENSE_ONLY" ||
    value === "INVENTORY_AND_EXPENSE" ||
    value === "EVIDENCE_ONLY" ||
    value === "OTHER_MANUAL"
  ) {
    return value;
  }
  return "INVENTORY_PURCHASE";
}

function resolveReceiptType(value: unknown): ReceiptType {
  if (
    value === "INVENTORY_PURCHASE" ||
    value === "MAINTENANCE_LINKED_PURCHASE" ||
    value === "EXPENSE_ONLY" ||
    value === "INTERNAL_TRANSFER"
  ) {
    return value;
  }
  return "INVENTORY_PURCHASE";
}

function resolveCreateExpenseByPurpose({
  receiptType,
  receiptPurpose,
  requestedCreateExpense
}: {
  receiptType: ReceiptType;
  receiptPurpose: ReceiptPurpose;
  requestedCreateExpense: boolean;
}) {
  if (receiptType === "INTERNAL_TRANSFER") {
    return false;
  }
  if (receiptType === "EXPENSE_ONLY") {
    return true;
  }
  if (receiptType === "MAINTENANCE_LINKED_PURCHASE") {
    return true;
  }

  if (receiptPurpose === "BUSINESS_EXPENSE_ONLY" || receiptPurpose === "INVENTORY_AND_EXPENSE") {
    return requestedCreateExpense;
  }
  return false;
}

function resolveExpenseOnlyCategory(value: unknown) {
  if (value === "TRAVEL" || value === "FOOD" || value === "FUEL" || value === "MISC") {
    return value;
  }
  return null;
}

function resolveExpenseCategoryForReceiptType({
  receiptType,
  expenseOnlyCategory,
  dominantCategory,
  isEvidenceOnlyPurpose
}: {
  receiptType: ReceiptType;
  expenseOnlyCategory: "TRAVEL" | "FOOD" | "FUEL" | "MISC" | null;
  dominantCategory: InventoryCategory | null;
  isEvidenceOnlyPurpose: boolean;
}) {
  if (isEvidenceOnlyPurpose) {
    return resolveExpenseCategoryFromInventoryCategory("OTHER");
  }
  if (receiptType === "EXPENSE_ONLY") {
    if (expenseOnlyCategory === "TRAVEL") return "Travel";
    if (expenseOnlyCategory === "FOOD") return "Food";
    if (expenseOnlyCategory === "FUEL") return "Fuel";
    if (expenseOnlyCategory === "MISC") return "Misc";
    return "Misc";
  }
  if (receiptType === "MAINTENANCE_LINKED_PURCHASE") {
    return "Maintenance";
  }
  return resolveExpenseCategoryFromInventoryCategory(dominantCategory || "OTHER");
}

function sanitizeSubmissionLines(lines: IntakeLinePayload[]) {
  return lines.map((line, index) => {
    const quantity = parseNumeric(line.quantity);
    const unitPrice = parseNumeric(line.unitPrice);
    const lineTotal = parseNumeric(line.lineTotal);
    return {
      id:
        typeof line.id === "string" && line.id.trim().length > 0
          ? line.id.trim()
          : `line-${index + 1}`,
      description: typeof line.description === "string" ? line.description.trim() : "",
      quantity: quantity && quantity > 0 ? roundCurrency(quantity) : 0,
      unitPrice: unitPrice && unitPrice > 0 ? roundCurrency(unitPrice) : 0,
      lineTotal: lineTotal && lineTotal > 0 ? roundCurrency(lineTotal) : 0,
      selectedItemId:
        typeof line.selectedItemId === "string" && line.selectedItemId.trim().length > 0
          ? line.selectedItemId.trim()
          : null,
      selectedCategory:
        typeof line.selectedCategory === "string" && line.selectedCategory.trim().length > 0
          ? line.selectedCategory.trim()
          : null,
      mode: line.mode === "NEW" || line.mode === "EXPENSE_ONLY" ? line.mode : "MATCH",
      newItem:
        line.newItem && typeof line.newItem === "object"
          ? {
              name: typeof line.newItem.name === "string" ? line.newItem.name.trim() : "",
              sku: typeof line.newItem.sku === "string" ? line.newItem.sku.trim() : "",
              category:
                typeof line.newItem.category === "string" ? line.newItem.category.trim() : "",
              minimumStockLevel: parseNumeric(line.newItem.minimumStockLevel) || 0,
              locationId:
                typeof line.newItem.locationId === "string" && line.newItem.locationId.trim().length > 0
                  ? line.newItem.locationId.trim()
                  : null,
              status: line.newItem.status === "INACTIVE" ? "INACTIVE" : "ACTIVE",
              notes: typeof line.newItem.notes === "string" ? line.newItem.notes.trim() : ""
            }
          : null
    };
  });
}

function normalizeText(value: string) {
  return value.trim().replace(/\s+/g, " ").toUpperCase();
}

function normalizeCode(value: string) {
  return value.trim().replace(/\s+/g, "").toUpperCase();
}

function formatDateOnly(date: Date) {
  const year = date.getUTCFullYear();
  const month = `${date.getUTCMonth() + 1}`.padStart(2, "0");
  const day = `${date.getUTCDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function toReceiptFingerprintRecord(input: {
  supplierName: string;
  tin: string;
  vrn: string;
  receiptNumber: string;
  serialNumber: string;
  receiptDate: string;
  total: number;
  verificationCode: string;
  traReceiptNumber: string;
  receiptUrl: string;
}): ReceiptDuplicateFingerprint {
  return {
    supplierName: normalizeText(input.supplierName),
    tin: normalizeCode(input.tin),
    vrn: normalizeCode(input.vrn),
    receiptNumber: normalizeCode(input.receiptNumber),
    serialNumber: normalizeCode(input.serialNumber),
    receiptDate: normalizeCode(input.receiptDate),
    total: roundCurrency(input.total || 0),
    verificationCode: normalizeCode(input.verificationCode),
    traReceiptNumber: normalizeCode(input.traReceiptNumber),
    receiptUrl: input.receiptUrl.trim()
  };
}

function buildDuplicateFingerprint(input: {
  supplierName: string;
  tin: string;
  vrn: string;
  receiptNumber: string;
  serialNumber: string;
  receiptDate: string;
  total: number;
  verificationCode: string;
  traReceiptNumber: string;
  receiptUrl: string;
}) {
  const normalized = toReceiptFingerprintRecord(input);
  const entries = [
    ["supplier", normalized.supplierName] as const,
    ["tin", normalized.tin] as const,
    ["vrn", normalized.vrn] as const,
    ["receiptNo", normalized.receiptNumber] as const,
    ["serial", normalized.serialNumber] as const,
    ["date", normalized.receiptDate] as const,
    ["total", normalized.total > 0 ? normalized.total.toFixed(2) : ""] as const,
    ["verification", normalized.verificationCode] as const,
    ["traReceiptNo", normalized.traReceiptNumber] as const,
    ["receiptUrl", normalized.receiptUrl] as const
  ].filter((entry) => entry[1].trim().length > 0);
  return entries.map(([key, value]) => `${key}:${value}`).join("|");
}

function parseMetadataValue(notes: string | null | undefined, key: string) {
  if (!notes) {
    return "";
  }
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`${escaped}=([^|\\n]+)`, "i");
  const match = notes.match(regex);
  return match?.[1] ? normalizeCode(match[1]) : "";
}

function compareDateOnly(left: Date, rightDateOnly: string) {
  if (!rightDateOnly) {
    return false;
  }
  return formatDateOnly(left) === rightDateOnly;
}

function compareTotals(left: number | null | undefined, right: number) {
  if (!left || left <= 0 || !right || right <= 0) {
    return false;
  }
  return Math.abs(left - right) <= Math.max(1, right * 0.02);
}

function buildDuplicateReason(matchedFields: string[]) {
  if (matchedFields.includes("verificationCode")) {
    return "Matched verification code from a previously processed receipt.";
  }
  if (matchedFields.includes("traReceiptNumber")) {
    return "Matched TRA receipt number from a previously processed receipt.";
  }
  if (
    matchedFields.includes("receiptNumber") &&
    matchedFields.includes("receiptDate") &&
    matchedFields.includes("supplierName")
  ) {
    return "Matched supplier, receipt number, and receipt date.";
  }
  return `Matched fields: ${matchedFields.join(", ")}.`;
}

function isStrongDuplicate(fields: string[]) {
  if (fields.includes("verificationCode")) {
    return true;
  }
  if (fields.includes("traReceiptNumber")) {
    return true;
  }
  if (fields.includes("receiptNumber") && fields.includes("supplierName") && fields.includes("receiptDate")) {
    return true;
  }
  if (fields.includes("receiptNumber") && fields.includes("tin") && fields.includes("receiptDate")) {
    return true;
  }
  return false;
}

async function detectReceiptDuplicates(fingerprintInput: {
  supplierName: string;
  tin: string;
  vrn: string;
  receiptNumber: string;
  serialNumber: string;
  receiptDate: string;
  total: number;
  verificationCode: string;
  traReceiptNumber: string;
  receiptUrl: string;
}): Promise<ReceiptDuplicateMatch[]> {
  const fingerprint = toReceiptFingerprintRecord(fingerprintInput);
  const movementOr: Prisma.InventoryMovementWhereInput[] = [];
  const expenseOr: Prisma.ExpenseWhereInput[] = [];

  if (fingerprint.verificationCode) {
    movementOr.push({ notes: { contains: `VerificationCode=${fingerprint.verificationCode}` } });
    expenseOr.push({ notes: { contains: `VerificationCode=${fingerprint.verificationCode}` } });
  }
  if (fingerprint.traReceiptNumber) {
    movementOr.push({ traReceiptNumber: fingerprint.traReceiptNumber });
    expenseOr.push({ receiptNumber: fingerprint.traReceiptNumber });
  }
  if (fingerprint.receiptNumber) {
    movementOr.push({ supplierInvoiceNumber: fingerprint.receiptNumber });
    expenseOr.push({ receiptNumber: fingerprint.receiptNumber });
  }
  if (fingerprint.receiptUrl) {
    movementOr.push({ receiptUrl: fingerprint.receiptUrl });
    expenseOr.push({ receiptUrl: fingerprint.receiptUrl });
  }
  if (movementOr.length === 0 && expenseOr.length === 0) {
    return [];
  }

  const [movements, expenses] = await Promise.all([
    movementOr.length
      ? prisma.inventoryMovement.findMany({
          where: { OR: movementOr },
          orderBy: { createdAt: "desc" },
          take: 25,
          select: {
            id: true,
            createdAt: true,
            date: true,
            totalCost: true,
            traReceiptNumber: true,
            supplierInvoiceNumber: true,
            receiptUrl: true,
            notes: true,
            expenseId: true,
            supplier: { select: { name: true } },
            item: {
              select: {
                id: true,
                name: true
              }
            }
          }
        })
      : Promise.resolve([]),
    expenseOr.length
      ? prisma.expense.findMany({
          where: { OR: expenseOr },
          orderBy: { createdAt: "desc" },
          take: 25,
          select: {
            id: true,
            createdAt: true,
            date: true,
            amount: true,
            vendor: true,
            receiptNumber: true,
            receiptUrl: true,
            notes: true
          }
        })
      : Promise.resolve([])
  ]);

  const matches: ReceiptDuplicateMatch[] = [];

  for (const movement of movements) {
    const matchedFields: string[] = [];
    const noteTin = parseMetadataValue(movement.notes, "TIN");
    const noteVrn = parseMetadataValue(movement.notes, "VRN");
    const noteSerial = parseMetadataValue(movement.notes, "Serial");
    const noteVerification = parseMetadataValue(movement.notes, "VerificationCode");
    const noteReceipt = parseMetadataValue(movement.notes, "ReceiptNo");
    const noteReceiptPurpose = parseMetadataValue(movement.notes, "ReceiptPurpose");
    const movementSupplierName = normalizeText(movement.supplier?.name || "");
    const movementReceiptNumber = normalizeCode(movement.supplierInvoiceNumber || noteReceipt);
    const movementTraReceiptNo = normalizeCode(movement.traReceiptNumber || "");

    if (fingerprint.supplierName && movementSupplierName === fingerprint.supplierName) matchedFields.push("supplierName");
    if (fingerprint.tin && noteTin === fingerprint.tin) matchedFields.push("tin");
    if (fingerprint.vrn && noteVrn === fingerprint.vrn) matchedFields.push("vrn");
    if (fingerprint.serialNumber && noteSerial === fingerprint.serialNumber) matchedFields.push("serialNumber");
    if (fingerprint.receiptNumber && movementReceiptNumber === fingerprint.receiptNumber) matchedFields.push("receiptNumber");
    if (fingerprint.verificationCode && noteVerification === fingerprint.verificationCode) matchedFields.push("verificationCode");
    if (fingerprint.traReceiptNumber && movementTraReceiptNo === fingerprint.traReceiptNumber) matchedFields.push("traReceiptNumber");
    if (fingerprint.receiptUrl && movement.receiptUrl === fingerprint.receiptUrl) matchedFields.push("receiptUrl");
    if (compareDateOnly(movement.date, fingerprint.receiptDate)) matchedFields.push("receiptDate");
    if (compareTotals(movement.totalCost, fingerprint.total)) matchedFields.push("total");

    if (!isStrongDuplicate(matchedFields)) {
      continue;
    }
    const movementReceiptDate = formatDateOnly(movement.date);
    const movementTotal = roundCurrency(movement.totalCost || 0);
    const supplierNameDisplay = movement.supplier?.name?.trim() || fingerprint.supplierName;
    matches.push({
      source: "inventory_movement",
      id: movement.id,
      matchedFields,
      reason: buildDuplicateReason(matchedFields),
      viewUrl: `/inventory/stock-movements?movementId=${movement.id}`,
      createdAt: movement.createdAt,
      supplierName: supplierNameDisplay,
      receiptNumber: movementReceiptNumber || fingerprint.receiptNumber,
      verificationCode: noteVerification || fingerprint.verificationCode,
      serialNumber: noteSerial || fingerprint.serialNumber,
      receiptDate: movementReceiptDate || fingerprint.receiptDate,
      total: movementTotal > 0 ? movementTotal : fingerprint.total,
      traReceiptNumber: movementTraReceiptNo || fingerprint.traReceiptNumber,
      stockMovementId: movement.id,
      expenseId: movement.expenseId || null,
      itemId: movement.item?.id || null,
      itemName: movement.item?.name || null,
      receiptPurpose: noteReceiptPurpose || "UNKNOWN"
    });
  }

  for (const expense of expenses) {
    const matchedFields: string[] = [];
    const noteTin = parseMetadataValue(expense.notes, "TIN");
    const noteVrn = parseMetadataValue(expense.notes, "VRN");
    const noteSerial = parseMetadataValue(expense.notes, "Serial");
    const noteVerification = parseMetadataValue(expense.notes, "VerificationCode");
    const noteReceiptPurpose = parseMetadataValue(expense.notes, "ReceiptPurpose");
    const expenseVendor = normalizeText(expense.vendor || "");
    const expenseReceiptNo = normalizeCode(expense.receiptNumber || "");

    if (fingerprint.supplierName && expenseVendor === fingerprint.supplierName) matchedFields.push("supplierName");
    if (fingerprint.tin && noteTin === fingerprint.tin) matchedFields.push("tin");
    if (fingerprint.vrn && noteVrn === fingerprint.vrn) matchedFields.push("vrn");
    if (fingerprint.serialNumber && noteSerial === fingerprint.serialNumber) matchedFields.push("serialNumber");
    if (fingerprint.receiptNumber && expenseReceiptNo === fingerprint.receiptNumber) matchedFields.push("receiptNumber");
    if (fingerprint.verificationCode && noteVerification === fingerprint.verificationCode) matchedFields.push("verificationCode");
    if (fingerprint.receiptUrl && expense.receiptUrl === fingerprint.receiptUrl) matchedFields.push("receiptUrl");
    if (compareDateOnly(expense.date, fingerprint.receiptDate)) matchedFields.push("receiptDate");
    if (compareTotals(expense.amount, fingerprint.total)) matchedFields.push("total");

    if (!isStrongDuplicate(matchedFields)) {
      continue;
    }
    const expenseReceiptDate = formatDateOnly(expense.date);
    const expenseTotal = roundCurrency(expense.amount || 0);
    matches.push({
      source: "expense",
      id: expense.id,
      matchedFields,
      reason: buildDuplicateReason(matchedFields),
      viewUrl: `/expenses?expenseId=${expense.id}`,
      createdAt: expense.createdAt,
      supplierName: expense.vendor?.trim() || fingerprint.supplierName,
      receiptNumber: expenseReceiptNo || fingerprint.receiptNumber,
      verificationCode: noteVerification || fingerprint.verificationCode,
      serialNumber: noteSerial || fingerprint.serialNumber,
      receiptDate: expenseReceiptDate || fingerprint.receiptDate,
      total: expenseTotal > 0 ? expenseTotal : fingerprint.total,
      traReceiptNumber: fingerprint.traReceiptNumber,
      stockMovementId: null,
      expenseId: expense.id,
      itemId: null,
      itemName: null,
      receiptPurpose: noteReceiptPurpose || "UNKNOWN"
    });
  }

  const dedupedByKey = new Map<string, ReceiptDuplicateMatch>();
  for (const match of matches) {
    const key = `${match.source}:${match.id}`;
    const existing = dedupedByKey.get(key);
    if (!existing || match.matchedFields.length > existing.matchedFields.length) {
      dedupedByKey.set(key, match);
    }
  }

  return Array.from(dedupedByKey.values()).sort((a, b) => b.matchedFields.length - a.matchedFields.length);
}

function toMatchedFieldLabel(field: string) {
  const map: Record<string, string> = {
    supplierName: "Supplier",
    tin: "TIN",
    vrn: "VRN",
    receiptNumber: "Receipt Number",
    serialNumber: "Serial Number",
    receiptDate: "Receipt Date",
    total: "Total",
    verificationCode: "Verification Code",
    traReceiptNumber: "TRA Receipt Number",
    receiptUrl: "Receipt URL"
  };
  return map[field] || field;
}

function inferDuplicateConfidence(fields: string[]): "HIGH" | "MEDIUM" | "LOW" {
  if (fields.includes("verificationCode") || fields.includes("traReceiptNumber")) {
    return "HIGH";
  }
  if (fields.length >= 4) {
    return "MEDIUM";
  }
  return "LOW";
}

function buildDuplicateReview({
  matches,
  fingerprint
}: {
  matches: ReceiptDuplicateMatch[];
  fingerprint: {
    supplierName: string;
    tin: string;
    vrn: string;
    receiptNumber: string;
    serialNumber: string;
    receiptDate: string;
    total: number;
    verificationCode: string;
    traReceiptNumber: string;
    receiptUrl: string;
  };
}): DuplicateReviewPayload | null {
  if (matches.length === 0) {
    return null;
  }

  const primary = matches[0];

  const receiptIntakeMap = new Map<string, DuplicateLinkedRecord>();
  const inventoryItemsMap = new Map<string, DuplicateLinkedRecord>();
  const stockMovementsMap = new Map<string, DuplicateLinkedRecord>();
  const expensesMap = new Map<string, DuplicateLinkedRecord>();

  for (const match of matches) {
    if (match.stockMovementId) {
      if (!receiptIntakeMap.has(match.stockMovementId)) {
        receiptIntakeMap.set(match.stockMovementId, {
          id: match.stockMovementId,
          label: `Receipt intake ${match.stockMovementId.slice(-8)}`,
          type: "RECEIPT_INTAKE",
          url: `/inventory/receipt-intake?movementId=${match.stockMovementId}`
        });
      }
      if (!stockMovementsMap.has(match.stockMovementId)) {
        stockMovementsMap.set(match.stockMovementId, {
          id: match.stockMovementId,
          label: `Stock movement ${match.stockMovementId.slice(-8)}`,
          type: "STOCK_MOVEMENT",
          url: `/inventory/stock-movements?movementId=${match.stockMovementId}`
        });
      }
    }
    if (match.itemId) {
      inventoryItemsMap.set(match.itemId, {
        id: match.itemId,
        label: match.itemName || `Inventory item ${match.itemId.slice(-8)}`,
        type: "INVENTORY_ITEM",
        url: `/inventory/items?itemId=${match.itemId}`
      });
    }
    if (match.expenseId) {
      expensesMap.set(match.expenseId, {
        id: match.expenseId,
        label: `Expense ${match.expenseId.slice(-8)}`,
        type: "EXPENSE",
        url: `/expenses?expenseId=${match.expenseId}`
      });
    }
  }

  const receiptIntake = Array.from(receiptIntakeMap.values());
  const inventoryItems = Array.from(inventoryItemsMap.values());
  const stockMovements = Array.from(stockMovementsMap.values());
  const expenses = Array.from(expensesMap.values());

  const primaryRecord =
    receiptIntake[0] ||
    stockMovements[0] ||
    inventoryItems[0] ||
    expenses[0] ||
    null;

  return {
    summary: {
      supplierName: primary.supplierName || fingerprint.supplierName,
      receiptNumber: primary.receiptNumber || fingerprint.receiptNumber,
      verificationCode: primary.verificationCode || fingerprint.verificationCode,
      serialNumber: primary.serialNumber || fingerprint.serialNumber,
      receiptDate: primary.receiptDate || fingerprint.receiptDate,
      total: primary.total > 0 ? primary.total : fingerprint.total,
      traReceiptNumber: primary.traReceiptNumber || fingerprint.traReceiptNumber,
      processedAt: primary.createdAt.toISOString(),
      duplicateConfidence: inferDuplicateConfidence(primary.matchedFields),
      matchReason: primary.reason,
      matchedFields: primary.matchedFields.map(toMatchedFieldLabel),
      receiptPurpose: primary.receiptPurpose || "UNKNOWN"
    },
    primaryRecord,
    linkedRecords: {
      receiptIntake,
      inventoryItems,
      stockMovements,
      expenses
    }
  };
}
