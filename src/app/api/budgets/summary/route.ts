import { NextResponse, type NextRequest } from "next/server";

import { requireApiPermission } from "@/lib/auth/api-guard";
import {
  buildBudgetDateOverlapWhere,
  deriveBudgetRowState,
  nullableFilter,
  parseDateOrNull,
  roundCurrency,
  summarizeBudgetAlerts,
  type BudgetVsActualSummaryResponse
} from "@/lib/budget-vs-actual";
import { withFinancialExpenseApproval } from "@/lib/financial-approval-policy";
import { prisma } from "@/lib/prisma";

const UNASSIGNED_RIG_ID = "__unassigned_rig__";
const UNASSIGNED_RIG_NAME = "Unassigned Rig";
const UNASSIGNED_PROJECT_ID = "__unassigned_project__";
const UNASSIGNED_PROJECT_NAME = "Unassigned Project";

export async function GET(request: NextRequest) {
  const auth = await requireApiPermission(request, "finance:view");
  if (!auth.ok) {
    return auth.response;
  }

  const clientId = nullableFilter(request.nextUrl.searchParams.get("clientId"));
  const rigId = nullableFilter(request.nextUrl.searchParams.get("rigId"));
  const fromDate = parseDateOrNull(request.nextUrl.searchParams.get("from"));
  const toDate = parseDateOrNull(request.nextUrl.searchParams.get("to"), true);

  const expenseWhere = withFinancialExpenseApproval({
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
  });

  const budgetWhere = {
    isActive: true,
    ...(clientId ? { clientId } : {}),
    ...buildBudgetDateOverlapWhere({ fromDate, toDate }),
    ...(rigId
      ? {
          OR: [
            {
              scopeType: "RIG" as const,
              rigId
            },
            {
              scopeType: "PROJECT" as const,
              project: {
                assignedRigId: rigId
              }
            }
          ]
        }
      : {})
  };

  const [expenses, budgetPlans] = await Promise.all([
    prisma.expense.findMany({
      where: expenseWhere,
      include: {
        rig: { select: { id: true, rigCode: true } },
        project: { select: { id: true, name: true } }
      }
    }),
    prisma.budgetPlan.findMany({
      where: budgetWhere,
      include: {
        rig: { select: { id: true, rigCode: true } },
        project: { select: { id: true, name: true } }
      },
      orderBy: [{ periodStart: "asc" }, { createdAt: "asc" }]
    })
  ]);

  const spendByRig = new Map<string, { id: string; name: string; spend: number }>();
  const spendByProject = new Map<string, { id: string; name: string; spend: number }>();
  let totalApprovedSpend = 0;

  for (const expense of expenses) {
    totalApprovedSpend += expense.amount;

    const rigKey = expense.rigId || UNASSIGNED_RIG_ID;
    const rigName = expense.rig?.rigCode || UNASSIGNED_RIG_NAME;
    const rigEntry = spendByRig.get(rigKey) || { id: rigKey, name: rigName, spend: 0 };
    rigEntry.spend += expense.amount;
    spendByRig.set(rigKey, rigEntry);

    const projectKey = expense.projectId || UNASSIGNED_PROJECT_ID;
    const projectName = expense.project?.name || UNASSIGNED_PROJECT_NAME;
    const projectEntry = spendByProject.get(projectKey) || { id: projectKey, name: projectName, spend: 0 };
    projectEntry.spend += expense.amount;
    spendByProject.set(projectKey, projectEntry);
  }

  const budgetByRig = new Map<string, { id: string; name: string; budget: number }>();
  const budgetByProject = new Map<string, { id: string; name: string; budget: number }>();
  let totalBudget = 0;

  for (const plan of budgetPlans) {
    totalBudget += plan.amount;

    if (plan.scopeType === "RIG") {
      const rigKey = plan.rigId || UNASSIGNED_RIG_ID;
      const rigName = plan.rig?.rigCode || UNASSIGNED_RIG_NAME;
      const rigEntry = budgetByRig.get(rigKey) || { id: rigKey, name: rigName, budget: 0 };
      rigEntry.budget += plan.amount;
      budgetByRig.set(rigKey, rigEntry);
      continue;
    }

    const projectKey = plan.projectId || UNASSIGNED_PROJECT_ID;
    const projectName = plan.project?.name || UNASSIGNED_PROJECT_NAME;
    const projectEntry = budgetByProject.get(projectKey) || { id: projectKey, name: projectName, budget: 0 };
    projectEntry.budget += plan.amount;
    budgetByProject.set(projectKey, projectEntry);
  }

  const rigKeys = new Set([...spendByRig.keys(), ...budgetByRig.keys()]);
  const byRig = Array.from(rigKeys)
    .map((key) => {
      const spend = spendByRig.get(key)?.spend || 0;
      const budget = budgetByRig.get(key)?.budget || 0;
      const name = spendByRig.get(key)?.name || budgetByRig.get(key)?.name || UNASSIGNED_RIG_NAME;
      const derived = deriveBudgetRowState(spend, budget);
      return {
        id: key,
        name,
        budgetAmount: roundCurrency(budget),
        approvedSpend: roundCurrency(spend),
        remainingBudget: roundCurrency(budget - spend),
        percentUsed: derived.percentUsed,
        status: derived.status,
        alertLevel: derived.alertLevel,
        statusLabel: derived.statusLabel
      };
    })
    .sort((a, b) => {
      if (b.approvedSpend !== a.approvedSpend) {
        return b.approvedSpend - a.approvedSpend;
      }
      if (b.budgetAmount !== a.budgetAmount) {
        return b.budgetAmount - a.budgetAmount;
      }
      return a.name.localeCompare(b.name);
    });

  const projectKeys = new Set([...spendByProject.keys(), ...budgetByProject.keys()]);
  const byProject = Array.from(projectKeys)
    .map((key) => {
      const spend = spendByProject.get(key)?.spend || 0;
      const budget = budgetByProject.get(key)?.budget || 0;
      const name = spendByProject.get(key)?.name || budgetByProject.get(key)?.name || UNASSIGNED_PROJECT_NAME;
      const derived = deriveBudgetRowState(spend, budget);
      return {
        id: key,
        name,
        budgetAmount: roundCurrency(budget),
        approvedSpend: roundCurrency(spend),
        remainingBudget: roundCurrency(budget - spend),
        percentUsed: derived.percentUsed,
        status: derived.status,
        alertLevel: derived.alertLevel,
        statusLabel: derived.statusLabel
      };
    })
    .sort((a, b) => {
      if (b.approvedSpend !== a.approvedSpend) {
        return b.approvedSpend - a.approvedSpend;
      }
      if (b.budgetAmount !== a.budgetAmount) {
        return b.budgetAmount - a.budgetAmount;
      }
      return a.name.localeCompare(b.name);
    });

  const overspentCount =
    byRig.filter((entry) => entry.status === "OVERSPENT").length +
    byProject.filter((entry) => entry.status === "OVERSPENT").length;
  const alerts = summarizeBudgetAlerts([...byRig, ...byProject]);

  const response: BudgetVsActualSummaryResponse = {
    filters: {
      clientId: clientId || "all",
      rigId: rigId || "all",
      from: request.nextUrl.searchParams.get("from"),
      to: request.nextUrl.searchParams.get("to")
    },
    totals: {
      totalBudget: roundCurrency(totalBudget),
      approvedSpend: roundCurrency(totalApprovedSpend),
      remainingBudget: roundCurrency(totalBudget - totalApprovedSpend),
      overspentCount
    },
    byRig,
    byProject,
    alerts
  };

  return NextResponse.json(response);
}
