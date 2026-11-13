import { NextResponse, type NextRequest } from "next/server";

import { requireApiPermission } from "@/lib/auth/api-guard";
import { prisma } from "@/lib/prisma";
import { buildRecognizedSpendContext } from "@/lib/recognized-spend-context";
import {
  buildSpendingMovementCategories,
  LABOR_EXPENSE_CATEGORY,
  resolveSpendingExpenseCategory,
  resolveSpendingMovementCategory
} from "@/lib/spending-expense-category";

export async function GET(request: NextRequest) {
  const auth = await requireApiPermission(request, "finance:view");
  if (!auth.ok) {
    return auth.response;
  }

  const fromParam = request.nextUrl.searchParams.get("from");
  const toParam = request.nextUrl.searchParams.get("to");
  const categoryParam = normalizeCategoryQuery(request.nextUrl.searchParams.get("category"));
  if (!categoryParam) {
    return NextResponse.json({ error: "Category is required." }, { status: 400 });
  }

  const rawClientId = nullableFilter(request.nextUrl.searchParams.get("clientId"));
  const rawRigId = nullableFilter(request.nextUrl.searchParams.get("rigId"));
  const projectId = nullableFilter(request.nextUrl.searchParams.get("projectId"));
  const clientId = projectId ? null : rawClientId;
  const rigId = projectId ? null : rawRigId;
  const fromDate = parseDateOrNull(fromParam);
  const toDate = parseDateOrNull(toParam, true);
  const filters = {
    projectId: projectId || "all",
    clientId: clientId || "all",
    rigId: rigId || "all",
    from: fromParam,
    to: toParam,
    category: categoryParam
  };

  if (categoryParam.toLowerCase() === LABOR_EXPENSE_CATEGORY.toLowerCase()) {
    if (!projectId) {
      return NextResponse.json({ error: "Select a project to view its labor total." }, { status: 400 });
    }
    const spend = await buildRecognizedSpendContext({ projectId, fromDate, toDate });
    const recognizedIds = new Set(spend.projectExpensePolicy.rows.map((row) => row.expenseId));
    const movementCategoryByExpenseId = buildSpendingMovementCategories(spend.movements);
    const totalCost = spend.recognizedExpenses.reduce((total, expense) => {
      if (!recognizedIds.has(expense.id)) return total;
      const category = resolveSpendingExpenseCategory({ expense, movementCategoryByExpenseId });
      return category.toLowerCase() === LABOR_EXPENSE_CATEGORY.toLowerCase() ? total + safeNumber(expense.amount) : total;
    }, 0);

    // Keep individual pay, posting dates, and record IDs out of this response for every role.
    return NextResponse.json({
      filters,
      summary: { totalCost: roundCurrency(totalCost), totalQuantity: 0 },
      detailMode: "project-total",
      rows: []
    }, { headers: { "Cache-Control": "private, no-store" } });
  }

  const rows = await prisma.inventoryMovement.findMany({
    where: {
      movementType: "OUT",
      expenseId: {
        not: null
      },
      ...(projectId ? { projectId } : {}),
      ...(clientId ? { clientId } : {}),
      ...(rigId ? { rigId } : {}),
      ...(fromDate || toDate
        ? {
            date: {
              ...(fromDate ? { gte: fromDate } : {}),
              ...(toDate ? { lte: toDate } : {})
            }
          }
        : {})
    },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    select: {
      id: true,
      date: true,
      quantity: true,
      totalCost: true,
      item: {
        select: {
          name: true,
          category: true
        }
      },
      rig: {
        select: {
          rigCode: true
        }
      },
      drillReport: {
        select: {
          holeNumber: true
        }
      }
    }
  });

  const matchingRows = rows.filter((entry) => {
    const resolvedCategory = resolveSpendingMovementCategory({
      itemCategory: entry.item?.category,
      fallbackCategory: "Uncategorized"
    });
    return resolvedCategory.toLowerCase() === categoryParam.toLowerCase();
  });

  const ledgerRows = matchingRows.map((entry) => ({
    id: entry.id,
    date: entry.date.toISOString(),
    item: normalizeLabel(entry.item?.name, "Inventory item"),
    quantityUsed: safeNumber(entry.quantity),
    totalCost: roundCurrency(safeNumber(entry.totalCost)),
    rig: normalizeLabel(entry.rig?.rigCode, "-"),
    reportHole: normalizeLabel(entry.drillReport?.holeNumber, "-")
  }));

  const summary = ledgerRows.reduce(
    (current, entry) => {
      current.totalCost += safeNumber(entry.totalCost);
      current.totalQuantity += safeNumber(entry.quantityUsed);
      return current;
    },
    { totalCost: 0, totalQuantity: 0 }
  );

  return NextResponse.json({
    filters,
    summary: {
      totalCost: roundCurrency(summary.totalCost),
      totalQuantity: roundNumber(summary.totalQuantity)
    },
    rows: ledgerRows
  });
}

function nullableFilter(value: string | null) {
  return value && value !== "all" ? value : null;
}

function parseDateOrNull(value: string | null, endOfDay = false) {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  if (endOfDay) {
    parsed.setUTCHours(23, 59, 59, 999);
  } else {
    parsed.setUTCHours(0, 0, 0, 0);
  }
  return parsed;
}

function normalizeCategoryQuery(value: string | null) {
  if (!value) {
    return "";
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  try {
    return decodeURIComponent(trimmed);
  } catch {
    return trimmed;
  }
}

function normalizeLabel(value: string | null | undefined, fallback: string) {
  const trimmed = `${value || ""}`.trim();
  return trimmed || fallback;
}

function safeNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function roundCurrency(value: number) {
  return Math.round(safeNumber(value) * 100) / 100;
}

function roundNumber(value: number) {
  return Math.round(safeNumber(value) * 100) / 100;
}
