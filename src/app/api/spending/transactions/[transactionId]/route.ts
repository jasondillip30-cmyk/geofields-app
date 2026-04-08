import { NextResponse, type NextRequest } from "next/server";

import { requireApiPermission } from "@/lib/auth/api-guard";
import { auditActorFromSession, recordAuditLog } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import {
  parsePurchaseRequisitionPayload,
  PURCHASE_REQUISITION_REPORT_TYPE
} from "@/lib/requisition-workflow";
import { loadMovementCategoryByExpenseId } from "@/lib/spending-expense-category";
import {
  buildSpendingTransactionRecord,
  normalizeLabel,
  parseDateOrNull,
  toDateIso
} from "@/lib/spending-transactions";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ transactionId: string }> }
) {
  const auth = await requireApiPermission(request, "expenses:manual");
  if (!auth.ok) {
    return auth.response;
  }

  const { transactionId } = await params;
  if (!transactionId) {
    return NextResponse.json({ message: "Transaction ID is required." }, { status: 400 });
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const merchant = normalizeLabel(typeof body?.merchant === "string" ? body.merchant : "", "");
  const dateValue = parseDateOrNull(typeof body?.date === "string" ? body.date : null);

  if (!merchant || !dateValue) {
    return NextResponse.json(
      { message: "Date and merchant are required." },
      { status: 400 }
    );
  }

  const requisitionRow = await prisma.summaryReport.findUnique({
    where: { id: transactionId },
    select: {
      id: true,
      reportType: true,
      reportDate: true,
      payloadJson: true
    }
  });

  if (!requisitionRow || requisitionRow.reportType !== PURCHASE_REQUISITION_REPORT_TYPE) {
    return NextResponse.json({ message: "Transaction not found." }, { status: 404 });
  }

  const parsedPayload = parsePurchaseRequisitionPayload(requisitionRow.payloadJson);
  if (!parsedPayload) {
    return NextResponse.json({ message: "Transaction payload is invalid." }, { status: 422 });
  }

  const requisition = parsedPayload.payload;
  if (requisition.type !== "LIVE_PROJECT_PURCHASE" || requisition.status !== "PURCHASE_COMPLETED") {
    return NextResponse.json(
      { message: "Only completed live project purchases can be edited here." },
      { status: 409 }
    );
  }

  const expenseId = normalizeLabel(requisition.purchase.expenseId, "");
  if (!expenseId) {
    return NextResponse.json(
      { message: "This legacy transaction cannot be edited here." },
      { status: 409 }
    );
  }

  const existingExpense = await prisma.expense.findUnique({
    where: { id: expenseId },
    select: {
      id: true,
      date: true,
      amount: true,
      vendor: true,
      category: true,
      entrySource: true
    }
  });

  if (!existingExpense) {
    return NextResponse.json(
      { message: "This legacy transaction cannot be edited here." },
      { status: 409 }
    );
  }

  const updatedExpense = await prisma.$transaction(async (tx) => {
    const next = await tx.expense.update({
      where: { id: existingExpense.id },
      data: {
        date: new Date(toDateIso(dateValue)),
        vendor: merchant
      },
      select: {
        id: true,
        date: true,
        amount: true,
        vendor: true,
        category: true,
        entrySource: true
      }
    });

    await recordAuditLog({
      db: tx,
      module: "expenses",
      entityType: "expense",
      entityId: existingExpense.id,
      action: "edit",
      description: `${auth.session.name} updated spending transaction ${requisition.requisitionCode}.`,
      before: {
        date: toDateIso(existingExpense.date),
        merchant: existingExpense.vendor
      },
      after: {
        date: toDateIso(next.date),
        merchant: next.vendor
      },
      actor: auditActorFromSession(auth.session)
    });

    return next;
  });

  const movementCategoryByExpenseId = await loadMovementCategoryByExpenseId([updatedExpense.id]);
  const row = buildSpendingTransactionRecord({
    requisitionId: requisitionRow.id,
    reportDate: requisitionRow.reportDate,
    payload: requisition,
    expense: updatedExpense,
    movementCategoryByExpenseId
  });

  return NextResponse.json({
    row: {
      id: row.id,
      requisitionCode: row.requisitionCode,
      date: row.date,
      merchant: row.merchant,
      category: row.category,
      amount: row.amount,
      editable: row.editable
    }
  });
}
