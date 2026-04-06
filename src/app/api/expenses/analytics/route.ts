import { NextResponse, type NextRequest } from "next/server";
import type { EntryApprovalStatus, Prisma } from "@prisma/client";

import { requireApiPermission } from "@/lib/auth/api-guard";
import { withFinancialExpenseApproval } from "@/lib/financial-approval-policy";
import { debugLog } from "@/lib/observability";
import { prisma } from "@/lib/prisma";

interface AggregateBucket {
  id?: string;
  name: string;
  amount: number;
}

type ExpenseStatus = "DRAFT" | "SUBMITTED" | "APPROVED" | "REJECTED";

export async function GET(request: NextRequest) {
  const auth = await requireApiPermission(request, "expenses:manual");
  if (!auth.ok) {
    return auth.response;
  }

  const fromDate = parseDateOrNull(request.nextUrl.searchParams.get("from"));
  const toDate = parseDateOrNull(request.nextUrl.searchParams.get("to"), true);
  const expenseId = nullableFilter(request.nextUrl.searchParams.get("expenseId"));
  const clientId = nullableFilter(request.nextUrl.searchParams.get("clientId"));
  const rigId = nullableFilter(request.nextUrl.searchParams.get("rigId"));
  const projectId = nullableFilter(request.nextUrl.searchParams.get("projectId"));
  const category = nullableFilter(request.nextUrl.searchParams.get("category"));
  const statusFilter = parseApprovalStatus(request.nextUrl.searchParams.get("status"));
  const includeAllStatuses = request.nextUrl.searchParams.get("includeAllStatuses") === "true";
  const appliedFilters = {
    from: fromDate ? fromDate.toISOString() : null,
    to: toDate ? toDate.toISOString() : null,
    expenseId: expenseId || "all",
    clientId: clientId || "all",
    rigId: rigId || "all",
    projectId: projectId || "all",
    category: category || "all",
    status: statusFilter || "all",
    inclusionPolicy: includeAllStatuses ? "ALL_STATUSES" : "APPROVED_ONLY"
  };

  const baseWhere: Prisma.ExpenseWhereInput = expenseId
    ? {
        id: expenseId,
        ...(includeAllStatuses && statusFilter ? { approvalStatus: statusFilter } : {})
      }
    : {
        ...(clientId ? { clientId } : {}),
        ...(rigId ? { rigId } : {}),
        ...(projectId ? { projectId } : {}),
        ...(category ? { category } : {}),
        ...(includeAllStatuses && statusFilter ? { approvalStatus: statusFilter } : {}),
        ...(fromDate || toDate
          ? {
              date: {
                ...(fromDate ? { gte: fromDate } : {}),
                ...(toDate ? { lte: toDate } : {})
              }
            }
          : {})
      };
  const where = includeAllStatuses ? baseWhere : withFinancialExpenseApproval(baseWhere);

  const expenses = await prisma.expense.findMany({
    where,
    orderBy: [{ date: "asc" }, { createdAt: "asc" }],
    include: {
      client: { select: { id: true, name: true } },
      project: { select: { id: true, name: true } },
      rig: { select: { id: true, rigCode: true } }
    }
  });

  const byDateMap = new Map<string, number>();
  const byProjectMap = new Map<string, AggregateBucket>();
  const byRigMap = new Map<string, AggregateBucket>();
  const byCategoryMap = new Map<string, AggregateBucket>();
  const statusCounts: Record<ExpenseStatus, number> = {
    DRAFT: 0,
    SUBMITTED: 0,
    APPROVED: 0,
    REJECTED: 0
  };

  const minDate = expenses[0]?.date || null;
  const maxDate = expenses[expenses.length - 1]?.date || null;
  const dateRangeDays =
    minDate && maxDate ? Math.max(1, Math.floor((maxDate.getTime() - minDate.getTime()) / 86400000) + 1) : 0;
  const trendGranularity: "day" | "month" = dateRangeDays <= 31 ? "day" : "month";

  let totalExpenses = 0;
  let approvedIntentAmount = 0;

  for (const entry of expenses) {
    totalExpenses += entry.amount;
    const approvalStatus = (entry.approvalStatus as ExpenseStatus) || "DRAFT";
    statusCounts[approvalStatus] += 1;
    if (approvalStatus === "APPROVED") {
      approvedIntentAmount += entry.amount;
    }

    const bucket = trendGranularity === "day" ? entry.date.toISOString().slice(0, 10) : entry.date.toISOString().slice(0, 7);
    byDateMap.set(bucket, (byDateMap.get(bucket) || 0) + entry.amount);

    const projectId = entry.project?.id || "unassigned-project";
    const projectName = entry.project?.name || "Unassigned";
    byProjectMap.set(projectId, {
      id: projectId,
      name: projectName,
      amount: (byProjectMap.get(projectId)?.amount || 0) + entry.amount
    });

    const rigId = entry.rig?.id || "unassigned-rig";
    const rigName = entry.rig?.rigCode || "Unassigned";
    byRigMap.set(rigId, {
      id: rigId,
      name: rigName,
      amount: (byRigMap.get(rigId)?.amount || 0) + entry.amount
    });

    const categoryName = entry.category || "Uncategorized";
    byCategoryMap.set(categoryName, {
      id: categoryName,
      name: categoryName,
      amount: (byCategoryMap.get(categoryName)?.amount || 0) + entry.amount
    });
  }

  const expenseTrend = Array.from(byDateMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([bucketStart, amount]) => ({
      bucketStart,
      label: formatBucketLabel(bucketStart, trendGranularity),
      amount
    }));

  const expensesByProject = sortBuckets(Array.from(byProjectMap.values()));
  const expensesByRig = sortBuckets(Array.from(byRigMap.values()));
  const expensesByCategory = sortBuckets(Array.from(byCategoryMap.values()));

  debugLog(
    "[expense-visibility][expenses-analytics]",
    {
      appliedFilters,
      expenseRecordCount: expenses.length,
      totalExpenses,
      approvedIntentAmount,
      statusCounts
    },
    { channel: "finance" }
  );

  return NextResponse.json({
    kpis: {
      totalExpenses,
      approvedIntentAmount,
      highestExpenseProject: expensesByProject[0]?.name || "N/A",
      highestExpenseRig: expensesByRig[0]?.name || "N/A",
      biggestCategory: expensesByCategory[0]?.name || "N/A"
    },
    trendGranularity,
    expenseTrend,
    expensesByProject,
    expensesByRig,
    expensesByCategory,
    projectTotals: expensesByProject,
    rigTotals: expensesByRig,
    meta: {
      appliedFilters,
      expenseRecordCount: expenses.length,
      statusCounts,
      totalExpenses,
      approvedIntentAmount,
      inclusionPolicy: includeAllStatuses ? "ALL_STATUSES" : "APPROVED_ONLY"
    }
  });
}

function sortBuckets(items: AggregateBucket[]) {
  return [...items].sort((a, b) => b.amount - a.amount);
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

function nullableFilter(value: string | null) {
  return value && value !== "all" ? value : null;
}

function parseApprovalStatus(value: string | null): EntryApprovalStatus | null {
  if (value === "DRAFT" || value === "SUBMITTED" || value === "APPROVED" || value === "REJECTED") {
    return value;
  }
  return null;
}

function formatBucketLabel(bucketStart: string, granularity: "day" | "month") {
  if (granularity === "day") {
    const date = new Date(`${bucketStart}T00:00:00.000Z`);
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "2-digit",
      timeZone: "UTC"
    }).format(date);
  }

  const date = new Date(`${bucketStart}-01T00:00:00.000Z`);
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    year: "2-digit",
    timeZone: "UTC"
  }).format(date);
}
