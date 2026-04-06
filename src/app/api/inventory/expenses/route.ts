import { NextResponse, type NextRequest } from "next/server";

import { requireApiPermission } from "@/lib/auth/api-guard";
import { filterRecognizedApprovedExpenses } from "@/lib/financial-expense-recognition";
import { prisma } from "@/lib/prisma";
import { buildRecognizedSpendContext } from "@/lib/recognized-spend-context";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const auth = await requireApiPermission(request, "inventory:view");
  if (!auth.ok) {
    return auth.response;
  }

  const fromDate = parseDate(request.nextUrl.searchParams.get("from") || "");
  const toDate = parseDate(request.nextUrl.searchParams.get("to") || "");
  const clientId = nullableFilter(request.nextUrl.searchParams.get("clientId"));
  const rigId = nullableFilter(request.nextUrl.searchParams.get("rigId"));
  const projectId = nullableFilter(request.nextUrl.searchParams.get("projectId"));

  const where = {
    ...(clientId ? { clientId } : {}),
    ...(rigId ? { rigId } : {}),
    ...(projectId ? { projectId } : {}),
    ...(fromDate || toDate
      ? {
          date: {
            ...(fromDate ? { gte: startOfDayUtc(fromDate) } : {}),
            ...(toDate ? { lte: endOfDayUtc(toDate) } : {})
          }
        }
      : {})
  };

  const rows = await prisma.expense.findMany({
    where,
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    include: {
      client: { select: { id: true, name: true } },
      project: { select: { id: true, name: true } },
      rig: { select: { id: true, rigCode: true } },
      enteredBy: { select: { id: true, fullName: true } },
      approvedBy: { select: { id: true, fullName: true } },
      inventoryMovements: {
        orderBy: [{ date: "desc" }, { createdAt: "desc" }],
        include: {
          item: { select: { id: true, name: true, sku: true } },
          project: { select: { id: true, name: true } },
          rig: { select: { id: true, rigCode: true } },
          maintenanceRequest: { select: { id: true, requestCode: true, status: true } }
        }
      }
    }
  });

  const recognizedResult = await filterRecognizedApprovedExpenses(rows);
  const recognizedIds = new Set(recognizedResult.expenses.map((entry) => entry.id));
  const classifiedContext = await buildRecognizedSpendContext({
    clientId,
    rigId,
    projectId,
    fromDate: fromDate || null,
    toDate: toDate || null
  });
  const classificationByExpenseId = new Map(
    classifiedContext.classifiedRows.map((entry) => [entry.expenseId, entry])
  );

  return NextResponse.json({
    data: rows.map((row) => ({
      id: row.id,
      date: row.date,
      amount: row.amount,
      category: row.category,
      subcategory: row.subcategory,
      entrySource: row.entrySource,
      vendor: row.vendor,
      receiptNumber: row.receiptNumber,
      receiptUrl: row.receiptUrl,
      approvalStatus: row.approvalStatus,
      submittedAt: row.submittedAt,
      approvedAt: row.approvedAt,
      rejectionReason: row.rejectionReason,
      notes: row.notes,
      client: row.client,
      project: row.project,
      rig: row.rig,
      enteredBy: row.enteredBy,
      approvedBy: row.approvedBy,
      recognized: recognizedIds.has(row.id),
      purposeBucket: classificationByExpenseId.get(row.id)?.purposeBucket || null,
      purposeLabel: classificationByExpenseId.get(row.id)?.purposeLabel || null,
      purposeTraceability: classificationByExpenseId.get(row.id)?.traceability || null,
      inventoryMovements: row.inventoryMovements.map((movement) => ({
        id: movement.id,
        date: movement.date,
        movementType: movement.movementType,
        quantity: movement.quantity,
        unitCost: movement.unitCost,
        totalCost: movement.totalCost,
        traReceiptNumber: movement.traReceiptNumber,
        supplierInvoiceNumber: movement.supplierInvoiceNumber,
        receiptUrl: movement.receiptUrl,
        notes: movement.notes,
        item: movement.item,
        project: movement.project,
        rig: movement.rig,
        maintenanceRequest: movement.maintenanceRequest
      }))
    })),
    meta: {
      total: rows.length,
      recognizedCount: recognizedIds.size,
      pendingRecognitionCount: rows.filter(
        (row) => row.approvalStatus === "APPROVED" && !recognizedIds.has(row.id)
      ).length
    }
  });
}

function nullableFilter(value: string | null) {
  if (!value) {
    return null;
  }
  const normalized = value.trim();
  if (!normalized || normalized.toLowerCase() === "all") {
    return null;
  }
  return normalized;
}

function parseDate(value: string) {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed;
}

function startOfDayUtc(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0));
}

function endOfDayUtc(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 23, 59, 59, 999));
}
