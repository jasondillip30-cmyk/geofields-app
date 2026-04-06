import type { Prisma } from "@prisma/client";
import { NextResponse, type NextRequest } from "next/server";

import { requireApiPermission } from "@/lib/auth/api-guard";
import { withFinancialDrillReportApproval, withFinancialExpenseApproval } from "@/lib/financial-approval-policy";
import { debugLog } from "@/lib/observability";
import { prisma } from "@/lib/prisma";

type ExpenseStatusKey = "DRAFT" | "SUBMITTED" | "APPROVED" | "REJECTED";

export async function GET(request: NextRequest) {
  const auth = await requireApiPermission(request, "finance:view");
  if (!auth.ok) {
    return auth.response;
  }

  const clientId = nullable(request.nextUrl.searchParams.get("clientId"));
  const projectId = nullable(request.nextUrl.searchParams.get("projectId"));
  const rigId = nullable(request.nextUrl.searchParams.get("rigId"));
  const fromDate = parseDateOrNull(request.nextUrl.searchParams.get("from"));
  const toDate = parseDateOrNull(request.nextUrl.searchParams.get("to"), true);
  const appliedFilters = {
    from: fromDate ? fromDate.toISOString() : null,
    to: toDate ? toDate.toISOString() : null,
    clientId: clientId || "all",
    projectId: projectId || "all",
    rigId: rigId || "all"
  };

  const drillWhere: Prisma.DrillReportWhereInput = withFinancialDrillReportApproval({
    ...(clientId ? { clientId } : {}),
    ...(projectId ? { projectId } : {}),
    ...(rigId ? { rigId } : {}),
    ...(fromDate || toDate
      ? {
          date: {
            ...(fromDate ? { gte: fromDate } : {}),
            ...(toDate ? { lte: toDate } : {})
          }
        }
      : {})
  });

  const expenseWhere: Prisma.ExpenseWhereInput = withFinancialExpenseApproval({
    ...(clientId ? { clientId } : {}),
    ...(projectId ? { projectId } : {}),
    ...(rigId ? { rigId } : {}),
    ...(fromDate || toDate
      ? {
          date: {
            ...(fromDate ? { gte: fromDate } : {}),
            ...(toDate ? { lte: toDate } : {})
          }
        }
      : {})
  });

  const [reports, expenses] = await Promise.all([
    prisma.drillReport.findMany({
      where: drillWhere,
      orderBy: { date: "asc" }
    }),
    prisma.expense.findMany({
      where: expenseWhere,
      orderBy: { date: "asc" }
    })
  ]);

  const expenseStatusCounts: Record<ExpenseStatusKey, number> = {
    DRAFT: 0,
    SUBMITTED: 0,
    APPROVED: 0,
    REJECTED: 0
  };
  let totalExpenseAmount = 0;
  let approvedExpenseAmount = 0;
  for (const expense of expenses) {
    totalExpenseAmount += expense.amount;
    const status = expense.approvalStatus as ExpenseStatusKey;
    if (status in expenseStatusCounts) {
      expenseStatusCounts[status] += 1;
    }
    if (expense.approvalStatus === "APPROVED") {
      approvedExpenseAmount += expense.amount;
    }
  }

  const grouped = new Map<string, { revenue: number; expenses: number }>();

  for (const row of reports) {
    const month = row.date.toISOString().slice(0, 7);
    const current = grouped.get(month) || { revenue: 0, expenses: 0 };
    current.revenue += row.billableAmount;
    grouped.set(month, current);
  }

  for (const row of expenses) {
    const month = row.date.toISOString().slice(0, 7);
    const current = grouped.get(month) || { revenue: 0, expenses: 0 };
    current.expenses += row.amount;
    grouped.set(month, current);
  }

  const monthly = Array.from(grouped.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([month, values]) => ({
      month,
      revenue: values.revenue,
      expenses: values.expenses,
      profit: values.revenue - values.expenses
    }));

  const dailyRevenue = averagePerDay(reports.map((item) => ({ date: item.date, value: item.billableAmount })));
  const dailyExpense = averagePerDay(expenses.map((item) => ({ date: item.date, value: item.amount })));
  const categoryTotals = new Map<string, { category: string; amount: number }>();

  for (const row of expenses) {
    const category = normalizedCategory(row.category);
    const key = category.toLowerCase();
    const current = categoryTotals.get(key) || { category, amount: 0 };
    current.amount += row.amount;
    categoryTotals.set(key, current);
  }

  const expenseCategoryBaselines = Array.from(categoryTotals.values())
    .sort((a, b) => b.amount - a.amount)
    .map((item) => {
      const share = totalExpenseAmount > 0 ? item.amount / totalExpenseAmount : 0;
      const categoryDailyExpense = dailyExpense * share;
      return {
        category: item.category,
        totalAmount: roundCurrency(item.amount),
        sharePercent: roundCurrency(share * 100),
        dailyExpense: roundCurrency(categoryDailyExpense),
        forecast7Expense: roundCurrency(categoryDailyExpense * 7),
        forecast30Expense: roundCurrency(categoryDailyExpense * 30)
      };
    });

  const forecast30 = Array.from({ length: 30 }, (_, index) => {
    const day = index + 1;
    return {
      day: `Day ${day}`,
      revenueForecast: roundCurrency(dailyRevenue * day),
      expenseForecast: roundCurrency(dailyExpense * day),
      projectedProfit: roundCurrency((dailyRevenue - dailyExpense) * day)
    };
  });

  const baselineForecast7Revenue = roundCurrency(dailyRevenue * 7);
  const baselineForecast7Expenses = roundCurrency(dailyExpense * 7);
  const baselineForecast7Profit = roundCurrency(baselineForecast7Revenue - baselineForecast7Expenses);
  const baselineForecast30Revenue = roundCurrency(dailyRevenue * 30);
  const baselineForecast30Expenses = roundCurrency(dailyExpense * 30);
  const baselineForecast30Profit = roundCurrency(baselineForecast30Revenue - baselineForecast30Expenses);

  debugLog(
    "[expense-visibility][forecasting]",
    {
      appliedFilters,
      reportRecordCount: reports.length,
      expenseRecordCount: expenses.length,
      totalExpenseAmount,
      approvedExpenseAmount,
      expenseStatusCounts
    },
    { channel: "finance" }
  );

  return NextResponse.json({
    filters: { clientId, projectId, rigId, fromDate, toDate },
    monthly,
    forecast30,
    simulationBaseline: {
      dailyRevenue: roundCurrency(dailyRevenue),
      dailyExpense: roundCurrency(dailyExpense),
      forecast7Revenue: baselineForecast7Revenue,
      forecast7Expenses: baselineForecast7Expenses,
      forecast7Profit: baselineForecast7Profit,
      forecast30Revenue: baselineForecast30Revenue,
      forecast30Expenses: baselineForecast30Expenses,
      forecast30Profit: baselineForecast30Profit
    },
    expenseCategoryBaselines,
    expenseStatusCounts,
    totals: {
      totalExpenseAmount: roundCurrency(totalExpenseAmount),
      approvedExpenseAmount: roundCurrency(approvedExpenseAmount)
    }
  });
}

function nullable(value: string | null) {
  return value && value !== "all" ? value : null;
}

function averagePerDay(entries: Array<{ date: Date; value: number }>) {
  if (entries.length === 0) {
    return 0;
  }

  const grouped = new Map<string, number>();
  for (const entry of entries) {
    const day = entry.date.toISOString().slice(0, 10);
    grouped.set(day, (grouped.get(day) || 0) + entry.value);
  }

  const total = Array.from(grouped.values()).reduce((sum, value) => sum + value, 0);
  return total / grouped.size;
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

function normalizedCategory(category: string | null | undefined) {
  const value = (category || "").trim();
  return value.length > 0 ? value : "Uncategorized";
}

function roundCurrency(value: number) {
  return Math.round(value * 100) / 100;
}
