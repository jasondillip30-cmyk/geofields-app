import { NextResponse, type NextRequest } from "next/server";

import { requireApiPermission } from "@/lib/auth/api-guard";
import { prisma } from "@/lib/prisma";
import {
  parsePurchaseRequisitionPayload,
  PURCHASE_REQUISITION_REPORT_TYPE
} from "@/lib/requisition-workflow";
import { loadMovementCategoryByExpenseId } from "@/lib/spending-expense-category";
import {
  buildSpendingTransactionRecord,
  matchesSpendingTransactionFilters,
  normalizeLabel,
  nullableFilter,
  parseDateOrNull,
  sortSpendingTransactions,
  type SpendingTransactionExpenseLike
} from "@/lib/spending-transactions";

export async function GET(request: NextRequest) {
  const auth = await requireApiPermission(request, "finance:view");
  if (!auth.ok) {
    return auth.response;
  }

  const fromParam = request.nextUrl.searchParams.get("from");
  const toParam = request.nextUrl.searchParams.get("to");
  const projectId = nullableFilter(request.nextUrl.searchParams.get("projectId"));
  const rawCategory = normalizeLabel(request.nextUrl.searchParams.get("category"), "");
  const searchQuery = normalizeLabel(request.nextUrl.searchParams.get("q"), "");
  const fromDate = parseDateOrNull(fromParam);
  const toDate = parseDateOrNull(toParam, true);

  if (!projectId) {
    return NextResponse.json({
      filters: {
        projectId: "all",
        clientId: "all",
        rigId: "all",
        from: fromParam,
        to: toParam,
        category: rawCategory || "all",
        q: searchQuery
      },
      categories: [],
      rows: []
    });
  }

  const requisitionRows = await prisma.summaryReport.findMany({
    where: {
      reportType: PURCHASE_REQUISITION_REPORT_TYPE,
      projectId
    },
    orderBy: [{ reportDate: "desc" }, { createdAt: "desc" }],
    select: {
      id: true,
      reportDate: true,
      payloadJson: true
    }
  });

  const parsedRows = requisitionRows
    .map((row) => {
      const parsedPayload = parsePurchaseRequisitionPayload(row.payloadJson);
      if (!parsedPayload) {
        return null;
      }
      const payload = parsedPayload.payload;
      if (payload.type !== "LIVE_PROJECT_PURCHASE" || payload.status !== "PURCHASE_COMPLETED") {
        return null;
      }
      return {
        id: row.id,
        reportDate: row.reportDate,
        payload
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));

  const expenseIds = Array.from(
    new Set(
      parsedRows
        .map((entry) => normalizeLabel(entry.payload.purchase.expenseId, ""))
        .filter(Boolean)
    )
  );

  const [expenseRows, movementCategoryByExpenseId] = await Promise.all([
    expenseIds.length > 0
      ? prisma.expense.findMany({
          where: { id: { in: expenseIds } },
          select: {
            id: true,
            date: true,
            amount: true,
            vendor: true,
            category: true,
            entrySource: true
          }
        })
      : Promise.resolve([]),
    loadMovementCategoryByExpenseId(expenseIds)
  ]);

  const expenseById = new Map<string, SpendingTransactionExpenseLike>(
    expenseRows.map((entry) => [entry.id, entry])
  );

  const allRecords = parsedRows.map((entry) => {
    const expenseId = normalizeLabel(entry.payload.purchase.expenseId, "");
    const expense = expenseId ? expenseById.get(expenseId) || null : null;
    return buildSpendingTransactionRecord({
      requisitionId: entry.id,
      reportDate: entry.reportDate,
      payload: entry.payload,
      expense,
      movementCategoryByExpenseId
    });
  });

  const recordsWithinDate = allRecords.filter((record) =>
    matchesSpendingTransactionFilters(record, {
      fromDate,
      toDate
    })
  );

  const categories = Array.from(new Set(recordsWithinDate.map((record) => record.category))).sort((a, b) =>
    a.localeCompare(b)
  );

  const filteredRows = sortSpendingTransactions(
    recordsWithinDate.filter((record) =>
      matchesSpendingTransactionFilters(record, {
        category: rawCategory || null,
        query: searchQuery || null
      })
    )
  ).map((record) => ({
    id: record.id,
    requisitionCode: record.requisitionCode,
    date: record.date,
    merchant: record.merchant,
    category: record.category,
    amount: record.amount,
    editable: record.editable
  }));

  return NextResponse.json({
    filters: {
      projectId,
      clientId: "all",
      rigId: "all",
      from: fromParam,
      to: toParam,
      category: rawCategory || "all",
      q: searchQuery
    },
    categories,
    rows: filteredRows
  });
}
