import type { UserRole } from "@prisma/client";
import { NextResponse, type NextRequest } from "next/server";

import {
  buildScopedHref,
  calculateAgeHours,
  endOfUtcDay,
  nullableFilter,
  parseDateOrNull,
  roundCurrency,
  startOfUtcDay,
  type AlertsCenterRow,
  type AlertsCenterSummaryResponse
} from "@/lib/alerts-center";
import { requireApiPermission } from "@/lib/auth/api-guard";
import { auditActorFromSession, recordAuditLog } from "@/lib/audit";
import { deriveBudgetRowState } from "@/lib/budget-vs-actual";
import { withFinancialExpenseApproval } from "@/lib/financial-approval-policy";
import { prisma } from "@/lib/prisma";
import { parseReceiptSubmissionPayload } from "@/lib/receipt-intake-submission";

const RECEIPT_SUBMISSION_REPORT_TYPE = "INVENTORY_RECEIPT_SUBMISSION";
const UNASSIGNED_RIG_ID = "__unassigned_rig__";
const UNASSIGNED_RIG_NAME = "Unassigned Rig";
const UNASSIGNED_PROJECT_ID = "__unassigned_project__";
const UNASSIGNED_PROJECT_NAME = "Unassigned Project";
const ALERT_MODULE = "alerts_center";

export async function GET(request: NextRequest) {
  const auth = await requireApiPermission(request, "finance:view");
  if (!auth.ok) {
    return auth.response;
  }
  if (!isManagerOrAdmin(auth.session.role)) {
    return NextResponse.json(
      { message: "Forbidden: Alerts Center is available to ADMIN and MANAGER roles only." },
      { status: 403 }
    );
  }

  const clientId = nullableFilter(request.nextUrl.searchParams.get("clientId"));
  const rigId = nullableFilter(request.nextUrl.searchParams.get("rigId"));
  const fromDate = parseDateOrNull(request.nextUrl.searchParams.get("from"));
  const toDate = parseDateOrNull(request.nextUrl.searchParams.get("to"), true);
  const includeResolved = request.nextUrl.searchParams.get("includeResolved") === "true";
  const now = new Date();

  const recognizedExpenseWhere = withFinancialExpenseApproval({
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
    ...(fromDate || toDate
      ? {
          periodStart: { lte: toDate || new Date("9999-12-31T23:59:59.999Z") },
          periodEnd: { gte: fromDate || new Date("1970-01-01T00:00:00.000Z") }
        }
      : {}),
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

  const stalePendingWhereDate =
    fromDate || toDate
      ? {
          ...(fromDate ? { gte: fromDate } : {}),
          ...(toDate ? { lte: toDate } : {})
        }
      : undefined;

  const [
    recognizedExpenses,
    budgetPlans,
    pendingExpenses,
    pendingDrillingReports,
    pendingMaintenanceRequests,
    pendingInventoryUsageRequests,
    pendingReceiptSubmissions,
    missingRigExpenses,
    missingProjectExpenses,
    missingMaintenanceMovements,
    resolvedToday,
    assignableUsers
  ] = await Promise.all([
    prisma.expense.findMany({
      where: recognizedExpenseWhere,
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
      }
    }),
    prisma.expense.findMany({
      where: {
        approvalStatus: "SUBMITTED",
        ...(clientId ? { clientId } : {}),
        ...(rigId ? { rigId } : {}),
        ...(stalePendingWhereDate ? { date: stalePendingWhereDate } : {})
      },
      include: {
        client: { select: { id: true, name: true } },
        project: { select: { id: true, name: true } },
        rig: { select: { id: true, rigCode: true } }
      },
      orderBy: [{ submittedAt: "asc" }, { createdAt: "asc" }]
    }),
    prisma.drillReport.findMany({
      where: {
        approvalStatus: "SUBMITTED",
        ...(clientId ? { clientId } : {}),
        ...(rigId ? { rigId } : {}),
        ...(stalePendingWhereDate ? { date: stalePendingWhereDate } : {})
      },
      include: {
        project: { select: { id: true, name: true } },
        rig: { select: { id: true, rigCode: true } }
      },
      orderBy: [{ submittedAt: "asc" }, { createdAt: "asc" }]
    }),
    prisma.maintenanceRequest.findMany({
      where: {
        status: "OPEN",
        ...(clientId ? { clientId } : {}),
        ...(rigId ? { rigId } : {}),
        ...(stalePendingWhereDate ? { requestDate: stalePendingWhereDate } : {})
      },
      include: {
        rig: { select: { id: true, rigCode: true } },
        project: { select: { id: true, name: true } }
      },
      orderBy: [{ requestDate: "asc" }, { createdAt: "asc" }]
    }),
    prisma.inventoryUsageRequest.findMany({
      where: {
        status: { in: ["SUBMITTED", "PENDING"] },
        ...(rigId ? { rigId } : {}),
        ...(clientId ? { project: { clientId } } : {}),
        ...(stalePendingWhereDate ? { createdAt: stalePendingWhereDate } : {})
      },
      include: {
        item: { select: { id: true, name: true, sku: true } },
        project: { select: { id: true, name: true } },
        rig: { select: { id: true, rigCode: true } }
      },
      orderBy: [{ createdAt: "asc" }]
    }),
    prisma.summaryReport.findMany({
      where: {
        reportType: RECEIPT_SUBMISSION_REPORT_TYPE,
        ...(clientId ? { clientId } : {}),
        ...(fromDate || toDate
          ? {
              reportDate: {
                ...(fromDate ? { gte: fromDate } : {}),
                ...(toDate ? { lte: toDate } : {})
              }
            }
          : {})
      },
      select: {
        id: true,
        reportDate: true,
        payloadJson: true
      },
      orderBy: [{ reportDate: "asc" }, { createdAt: "asc" }]
    }),
    prisma.expense.findMany({
      where: {
        ...withFinancialExpenseApproval({
          ...(clientId ? { clientId } : {}),
          ...(fromDate || toDate
            ? {
                date: {
                  ...(fromDate ? { gte: fromDate } : {}),
                  ...(toDate ? { lte: toDate } : {})
                }
              }
            : {})
        }),
        rigId: null
      },
      include: {
        client: { select: { id: true, name: true } },
        project: { select: { id: true, name: true } }
      },
      orderBy: [{ date: "asc" }, { createdAt: "asc" }]
    }),
    prisma.expense.findMany({
      where: {
        ...withFinancialExpenseApproval({
          ...(clientId ? { clientId } : {}),
          ...(fromDate || toDate
            ? {
                date: {
                  ...(fromDate ? { gte: fromDate } : {}),
                  ...(toDate ? { lte: toDate } : {})
                }
              }
            : {})
        }),
        projectId: null,
        ...(rigId ? { rigId } : {})
      },
      include: {
        client: { select: { id: true, name: true } },
        rig: { select: { id: true, rigCode: true } }
      },
      orderBy: [{ date: "asc" }, { createdAt: "asc" }]
    }),
    prisma.inventoryMovement.findMany({
      where: {
        movementType: "OUT",
        maintenanceRequestId: null,
        breakdownReportId: null,
        expenseId: { not: null },
        ...(rigId ? { rigId } : {}),
        ...(fromDate || toDate
          ? {
              date: {
                ...(fromDate ? { gte: fromDate } : {}),
                ...(toDate ? { lte: toDate } : {})
              }
            }
          : {}),
        expense: withFinancialExpenseApproval({
          ...(clientId ? { clientId } : {})
        })
      },
      include: {
        item: { select: { id: true, name: true, sku: true } },
        project: { select: { id: true, name: true } },
        rig: { select: { id: true, rigCode: true } },
        expense: { select: { id: true, amount: true } }
      },
      orderBy: [{ date: "asc" }, { createdAt: "asc" }]
    }),
    prisma.alertCenterState.count({
      where: {
        status: "RESOLVED",
        resolvedAt: {
          gte: startOfUtcDay(now),
          lte: endOfUtcDay(now)
        }
      }
    }),
    prisma.user.findMany({
      where: {
        isActive: true
      },
      select: {
        id: true,
        fullName: true
      },
      orderBy: [{ fullName: "asc" }]
    })
  ]);

  const derivedAlerts: AlertsCenterRow[] = [];
  const scopedFilterValues = {
    clientId,
    rigId,
    from: request.nextUrl.searchParams.get("from"),
    to: request.nextUrl.searchParams.get("to")
  };

  const spendByRig = new Map<string, { id: string; name: string; spend: number; latestDate: Date | null }>();
  const spendByProject = new Map<string, { id: string; name: string; spend: number; latestDate: Date | null }>();
  for (const expense of recognizedExpenses) {
    const rigKey = expense.rigId || UNASSIGNED_RIG_ID;
    const rigName = expense.rig?.rigCode || UNASSIGNED_RIG_NAME;
    const rigEntry = spendByRig.get(rigKey) || {
      id: rigKey,
      name: rigName,
      spend: 0,
      latestDate: null
    };
    rigEntry.spend += expense.amount;
    rigEntry.latestDate = !rigEntry.latestDate || expense.date > rigEntry.latestDate ? expense.date : rigEntry.latestDate;
    spendByRig.set(rigKey, rigEntry);

    const projectKey = expense.projectId || UNASSIGNED_PROJECT_ID;
    const projectName = expense.project?.name || UNASSIGNED_PROJECT_NAME;
    const projectEntry = spendByProject.get(projectKey) || {
      id: projectKey,
      name: projectName,
      spend: 0,
      latestDate: null
    };
    projectEntry.spend += expense.amount;
    projectEntry.latestDate =
      !projectEntry.latestDate || expense.date > projectEntry.latestDate ? expense.date : projectEntry.latestDate;
    spendByProject.set(projectKey, projectEntry);
  }

  const budgetByRig = new Map<string, { id: string; name: string; budget: number }>();
  const budgetByProject = new Map<string, { id: string; name: string; budget: number }>();
  for (const plan of budgetPlans) {
    if (plan.scopeType === "RIG") {
      const key = plan.rigId || UNASSIGNED_RIG_ID;
      const name = plan.rig?.rigCode || UNASSIGNED_RIG_NAME;
      const row = budgetByRig.get(key) || { id: key, name, budget: 0 };
      row.budget += plan.amount;
      budgetByRig.set(key, row);
      continue;
    }
    const key = plan.projectId || UNASSIGNED_PROJECT_ID;
    const name = plan.project?.name || UNASSIGNED_PROJECT_NAME;
    const row = budgetByProject.get(key) || { id: key, name, budget: 0 };
    row.budget += plan.amount;
    budgetByProject.set(key, row);
  }

  const rigBudgetKeys = new Set([...spendByRig.keys(), ...budgetByRig.keys()]);
  for (const key of rigBudgetKeys) {
    const spend = spendByRig.get(key)?.spend || 0;
    const budget = budgetByRig.get(key)?.budget || 0;
    if (budget <= 0) {
      continue;
    }
    const derived = deriveBudgetRowState(spend, budget);
    if (derived.alertLevel !== "OVERSPENT" && derived.alertLevel !== "CRITICAL_90" && derived.alertLevel !== "WATCH_80") {
      continue;
    }

    const type =
      derived.alertLevel === "OVERSPENT"
        ? "BUDGET_OVERSPENT"
        : derived.alertLevel === "CRITICAL_90"
          ? "BUDGET_CRITICAL"
          : "BUDGET_WATCH";
    const severity = derived.alertLevel === "WATCH_80" ? "WARNING" : "CRITICAL";
    const entityName = spendByRig.get(key)?.name || budgetByRig.get(key)?.name || UNASSIGNED_RIG_NAME;
    const latestDate = spendByRig.get(key)?.latestDate || null;
    derivedAlerts.push({
      alertKey: `budget:rig:${key}`,
      severity,
      alertType: type,
      entity: entityName,
      source: "Budget vs Actual",
      amount: roundCurrency(spend),
      ageHours: calculateAgeHours(latestDate, now),
      currentContext: `Budget ${roundCurrency(budget)} vs spend ${roundCurrency(spend)}.`,
      recommendedAction:
        derived.alertLevel === "WATCH_80"
          ? "Monitor this rig budget closely and review pending spend drivers."
          : "Immediate budget intervention recommended for this rig.",
      destinationHref: buildScopedHref({
        path: "/spending",
        filters: scopedFilterValues,
        extra: key !== UNASSIGNED_RIG_ID ? { rigId: key } : undefined
      }),
      status: "OPEN",
      detectedAt: latestDate ? latestDate.toISOString() : null,
      snoozedUntil: null
    });
  }

  const projectBudgetKeys = new Set([...spendByProject.keys(), ...budgetByProject.keys()]);
  for (const key of projectBudgetKeys) {
    const spend = spendByProject.get(key)?.spend || 0;
    const budget = budgetByProject.get(key)?.budget || 0;
    if (budget <= 0) {
      continue;
    }
    const derived = deriveBudgetRowState(spend, budget);
    if (derived.alertLevel !== "OVERSPENT" && derived.alertLevel !== "CRITICAL_90" && derived.alertLevel !== "WATCH_80") {
      continue;
    }
    const type =
      derived.alertLevel === "OVERSPENT"
        ? "BUDGET_OVERSPENT"
        : derived.alertLevel === "CRITICAL_90"
          ? "BUDGET_CRITICAL"
          : "BUDGET_WATCH";
    const severity = derived.alertLevel === "WATCH_80" ? "WARNING" : "CRITICAL";
    const entityName = spendByProject.get(key)?.name || budgetByProject.get(key)?.name || UNASSIGNED_PROJECT_NAME;
    const latestDate = spendByProject.get(key)?.latestDate || null;
    derivedAlerts.push({
      alertKey: `budget:project:${key}`,
      severity,
      alertType: type,
      entity: entityName,
      source: "Budget vs Actual",
      amount: roundCurrency(spend),
      ageHours: calculateAgeHours(latestDate, now),
      currentContext: `Budget ${roundCurrency(budget)} vs spend ${roundCurrency(spend)}.`,
      recommendedAction:
        derived.alertLevel === "WATCH_80"
          ? "Watch this project budget and review near-term costs."
          : "Immediate budget intervention recommended for this project.",
      destinationHref: buildScopedHref({
        path: "/spending",
        filters: scopedFilterValues
      }),
      status: "OPEN",
      detectedAt: latestDate ? latestDate.toISOString() : null,
      snoozedUntil: null
    });
  }

  for (const expense of pendingExpenses) {
    const pendingDate = expense.submittedAt || expense.date || expense.createdAt;
    const ageHours = calculateAgeHours(pendingDate, now);
    if ((ageHours || 0) < 24) {
      continue;
    }
    derivedAlerts.push({
      alertKey: `approval:expense:${expense.id}`,
      severity: (ageHours || 0) >= 72 ? "CRITICAL" : "WARNING",
      alertType: "STALE_PENDING_APPROVAL",
      entity: expense.receiptNumber?.trim() ? `Expense Receipt ${expense.receiptNumber.trim()}` : `Expense ${expense.id.slice(-8)}`,
      source: "Approvals Queue",
      amount: roundCurrency(expense.amount),
      ageHours,
      currentContext: `${expense.client?.name || "Unassigned Client"} • ${expense.rig?.rigCode || "Unassigned Rig"}`,
      recommendedAction: "Review and approve/reject this expense submission.",
      destinationHref: buildScopedHref({
        path: "/approvals",
        filters: scopedFilterValues
      }),
      status: "OPEN",
      detectedAt: pendingDate?.toISOString() || null,
      snoozedUntil: null
    });
  }

  for (const report of pendingDrillingReports) {
    const pendingDate = report.submittedAt || report.date || report.createdAt;
    const ageHours = calculateAgeHours(pendingDate, now);
    if ((ageHours || 0) < 24) {
      continue;
    }
    derivedAlerts.push({
      alertKey: `approval:drilling:${report.id}`,
      severity: (ageHours || 0) >= 72 ? "CRITICAL" : "WARNING",
      alertType: "STALE_PENDING_APPROVAL",
      entity: report.holeNumber ? `Drilling ${report.holeNumber}` : `Drilling ${report.id.slice(-8)}`,
      source: "Approvals Queue",
      amount: report.billableAmount ? roundCurrency(report.billableAmount) : null,
      ageHours,
      currentContext: `${report.project?.name || "Unassigned Project"} • ${report.rig?.rigCode || "Unassigned Rig"}`,
      recommendedAction: "Review and approve/reject this drilling report.",
      destinationHref: buildScopedHref({
        path: "/approvals",
        filters: scopedFilterValues
      }),
      status: "OPEN",
      detectedAt: pendingDate?.toISOString() || null,
      snoozedUntil: null
    });
  }

  for (const requestRow of pendingMaintenanceRequests) {
    const pendingDate = requestRow.requestDate || requestRow.createdAt;
    const ageHours = calculateAgeHours(pendingDate, now);
    if ((ageHours || 0) < 24) {
      continue;
    }
    derivedAlerts.push({
      alertKey: `maintenance:open:${requestRow.id}`,
      severity: (ageHours || 0) >= 72 ? "CRITICAL" : "WARNING",
      alertType: "STALE_PENDING_APPROVAL",
      entity: requestRow.requestCode || `Maintenance ${requestRow.id.slice(-8)}`,
      source: "Maintenance Cases",
      amount: null,
      ageHours,
      currentContext: `${requestRow.rig?.rigCode || "Unassigned Rig"} • ${requestRow.project?.name || "Unassigned Project"}`,
      recommendedAction: "Review this open maintenance case and move it forward.",
      destinationHref: buildScopedHref({
        path: "/maintenance",
        filters: scopedFilterValues
      }),
      status: "OPEN",
      detectedAt: pendingDate?.toISOString() || null,
      snoozedUntil: null
    });
  }

  for (const usageRequest of pendingInventoryUsageRequests) {
    const pendingDate = usageRequest.createdAt || usageRequest.requestedForDate;
    const ageHours = calculateAgeHours(pendingDate, now);
    if ((ageHours || 0) < 24) {
      continue;
    }
    derivedAlerts.push({
      alertKey: `approval:inventory-usage:${usageRequest.id}`,
      severity: (ageHours || 0) >= 72 ? "CRITICAL" : "WARNING",
      alertType: "STALE_PENDING_APPROVAL",
      entity: usageRequest.item?.name || `Usage Request ${usageRequest.id.slice(-8)}`,
      source: "Approvals Queue",
      amount: null,
      ageHours,
      currentContext: `${usageRequest.rig?.rigCode || "Unassigned Rig"} • ${usageRequest.project?.name || "Unassigned Project"}`,
      recommendedAction: "Review and decide this inventory usage request.",
      destinationHref: buildScopedHref({
        path: "/approvals",
        filters: scopedFilterValues
      }),
      status: "OPEN",
      detectedAt: pendingDate?.toISOString() || null,
      snoozedUntil: null
    });
  }

  for (const row of pendingReceiptSubmissions) {
    const parsed = parseReceiptSubmissionPayload(row.payloadJson);
    if (!parsed || parsed.status !== "SUBMITTED") {
      continue;
    }
    if (rigId && parsed.normalizedDraft?.linkContext.rigId !== rigId) {
      continue;
    }

    const pendingDate = parsed.submittedAt ? new Date(parsed.submittedAt) : row.reportDate;
    const validPendingDate = Number.isNaN(pendingDate.getTime()) ? row.reportDate : pendingDate;
    const ageHours = calculateAgeHours(validPendingDate, now);
    if ((ageHours || 0) < 24) {
      continue;
    }

    const receiptNumber = parsed.normalizedDraft?.receipt.receiptNumber || row.id.slice(-8);
    derivedAlerts.push({
      alertKey: `approval:receipt-submission:${row.id}`,
      severity: (ageHours || 0) >= 72 ? "CRITICAL" : "WARNING",
      alertType: "STALE_PENDING_APPROVAL",
      entity: `Receipt Submission ${receiptNumber}`,
      source: "Approvals Queue",
      amount: parsed.normalizedDraft?.receipt.total ? roundCurrency(parsed.normalizedDraft.receipt.total) : null,
      ageHours,
      currentContext: `${parsed.normalizedDraft?.receipt.supplierName || "Unknown Supplier"} • ${
        parsed.normalizedDraft?.linkContext.rigId || "Unassigned Rig"
      }`,
      recommendedAction: "Review and approve/reject this receipt submission.",
      destinationHref: buildScopedHref({
        path: "/approvals",
        filters: scopedFilterValues
      }),
      status: "OPEN",
      detectedAt: validPendingDate.toISOString(),
      snoozedUntil: null
    });
  }

  for (const expense of missingRigExpenses) {
    derivedAlerts.push({
      alertKey: `linkage:rig:expense:${expense.id}`,
      severity: "WARNING",
      alertType: "MISSING_RIG_LINKAGE",
      entity: expense.receiptNumber?.trim() ? `Expense Receipt ${expense.receiptNumber.trim()}` : `Expense ${expense.id.slice(-8)}`,
      source: "Data Quality / Linkage Center",
      amount: roundCurrency(expense.amount),
      ageHours: calculateAgeHours(expense.date, now),
      currentContext: `${expense.client?.name || "Unassigned Client"} • ${expense.project?.name || "Unassigned Project"}`,
      recommendedAction: "Assign rig linkage to restore rig-level cost attribution.",
      destinationHref: buildScopedHref({
        path: "/data-quality/linkage-center",
        filters: scopedFilterValues
      }),
      status: "OPEN",
      detectedAt: expense.date.toISOString(),
      snoozedUntil: null
    });
  }

  for (const expense of missingProjectExpenses) {
    derivedAlerts.push({
      alertKey: `linkage:project:expense:${expense.id}`,
      severity: "WARNING",
      alertType: "MISSING_PROJECT_LINKAGE",
      entity: expense.receiptNumber?.trim() ? `Expense Receipt ${expense.receiptNumber.trim()}` : `Expense ${expense.id.slice(-8)}`,
      source: "Data Quality / Linkage Center",
      amount: roundCurrency(expense.amount),
      ageHours: calculateAgeHours(expense.date, now),
      currentContext: `${expense.client?.name || "Unassigned Client"} • ${expense.rig?.rigCode || "Unassigned Rig"}`,
      recommendedAction: "Assign project linkage to restore project-level profitability and budget visibility.",
      destinationHref: buildScopedHref({
        path: "/data-quality/linkage-center",
        filters: scopedFilterValues
      }),
      status: "OPEN",
      detectedAt: expense.date.toISOString(),
      snoozedUntil: null
    });
  }

  for (const movement of missingMaintenanceMovements) {
    derivedAlerts.push({
      alertKey: `linkage:maintenance:movement:${movement.id}`,
      severity: "CRITICAL",
      alertType: "MISSING_MAINTENANCE_LINKAGE",
      entity: movement.item?.name || `Movement ${movement.id.slice(-8)}`,
      source: "Data Quality / Linkage Center",
      amount: roundCurrency(movement.totalCost || movement.expense?.amount || 0),
      ageHours: calculateAgeHours(movement.date, now),
      currentContext: `${movement.rig?.rigCode || "Unassigned Rig"} • ${movement.project?.name || "Unassigned Project"}`,
      recommendedAction: "Link this stock-out movement to the related maintenance request.",
      destinationHref: buildScopedHref({
        path: "/data-quality/linkage-center",
        filters: scopedFilterValues
      }),
      status: "OPEN",
      detectedAt: movement.date.toISOString(),
      snoozedUntil: null
    });
  }

  const alertKeys = derivedAlerts.map((entry) => entry.alertKey);
  const states = alertKeys.length
    ? await prisma.alertCenterState.findMany({
        where: {
          alertKey: { in: alertKeys }
        }
      })
    : [];
  const stateByKey = new Map(states.map((entry) => [entry.alertKey, entry]));
  const ownerNameById = new Map(assignableUsers.map((entry) => [entry.id, entry.fullName]));

  const alertsWithStatus = derivedAlerts
    .map((alert): AlertsCenterRow | null => {
      const state = stateByKey.get(alert.alertKey);
      const metadata = parseAlertStateMetadata(state?.metadataJson);
      const assignedOwnerUserId = metadata.assignedOwnerUserId || null;
      const assignedOwnerName = assignedOwnerUserId ? ownerNameById.get(assignedOwnerUserId) || "Unknown User" : null;

      if (!state) {
        return {
          ...alert,
          assignedOwnerUserId,
          assignedOwnerName
        };
      }
      if (state.status === "RESOLVED" && !includeResolved) {
        return null;
      }
      if (state.status === "SNOOZED" && state.snoozedUntil && state.snoozedUntil.getTime() <= now.getTime()) {
        return {
          ...alert,
          assignedOwnerUserId,
          assignedOwnerName
        };
      }
      const resolvedStatus: AlertsCenterRow["status"] =
        state.status === "SNOOZED" ? "SNOOZED" : state.status === "RESOLVED" ? "RESOLVED" : "OPEN";
      return {
        ...alert,
        status: resolvedStatus,
        snoozedUntil: state.snoozedUntil ? state.snoozedUntil.toISOString() : null,
        assignedOwnerUserId,
        assignedOwnerName
      };
    })
    .filter((entry): entry is AlertsCenterRow => entry !== null)
    .sort((a, b) => {
      const severityWeight = (value: AlertsCenterRow["severity"]) => (value === "CRITICAL" ? 0 : 1);
      const statusWeight = (value: AlertsCenterRow["status"]) => (value === "OPEN" ? 0 : 1);
      const severityDiff = severityWeight(a.severity) - severityWeight(b.severity);
      if (severityDiff !== 0) {
        return severityDiff;
      }
      const statusDiff = statusWeight(a.status) - statusWeight(b.status);
      if (statusDiff !== 0) {
        return statusDiff;
      }
      const ageA = a.ageHours || 0;
      const ageB = b.ageHours || 0;
      if (ageB !== ageA) {
        return ageB - ageA;
      }
      const amountA = a.amount || 0;
      const amountB = b.amount || 0;
      return amountB - amountA;
    });

  const unresolvedAlerts = alertsWithStatus.filter((entry) => entry.status !== "RESOLVED");

  const response: AlertsCenterSummaryResponse = {
    filters: {
      clientId: clientId || "all",
      rigId: rigId || "all",
      from: request.nextUrl.searchParams.get("from"),
      to: request.nextUrl.searchParams.get("to")
    },
    summary: {
      criticalAlerts: unresolvedAlerts.filter((entry) => entry.severity === "CRITICAL").length,
      warningAlerts: unresolvedAlerts.filter((entry) => entry.severity === "WARNING").length,
      unresolvedAlerts: unresolvedAlerts.length,
      resolvedToday
    },
    owners: assignableUsers.map((entry) => ({
      userId: entry.id,
      name: entry.fullName
    })),
    alerts: alertsWithStatus,
    generatedAt: now.toISOString()
  };

  return NextResponse.json(response);
}

export async function PATCH(request: NextRequest) {
  const auth = await requireApiPermission(request, "finance:edit");
  if (!auth.ok) {
    return auth.response;
  }
  if (!isManagerOrAdmin(auth.session.role)) {
    return NextResponse.json(
      { message: "Forbidden: only ADMIN and MANAGER can modify alert status." },
      { status: 403 }
    );
  }

  const body = (await request.json().catch(() => null)) as
    | {
        alertKey?: string;
        action?: string;
        note?: string;
        snoozeHours?: number;
        ownerUserId?: string | null;
      }
    | null;

  const alertKey = typeof body?.alertKey === "string" ? body.alertKey.trim() : "";
  const action = typeof body?.action === "string" ? body.action.trim().toUpperCase() : "";
  const note = typeof body?.note === "string" ? body.note.trim() : "";
  const snoozeHours = Number.isFinite(Number(body?.snoozeHours)) ? Number(body?.snoozeHours) : 24;
  const ownerUserId = typeof body?.ownerUserId === "string" ? body.ownerUserId.trim() : "";

  if (!alertKey || !action) {
    return NextResponse.json({ message: "alertKey and action are required." }, { status: 400 });
  }

  if (action !== "RESOLVE" && action !== "SNOOZE" && action !== "REOPEN" && action !== "ASSIGN_OWNER") {
    return NextResponse.json({ message: "Unsupported action. Use RESOLVE, SNOOZE, REOPEN, or ASSIGN_OWNER." }, { status: 400 });
  }

  const previous = await prisma.alertCenterState.findUnique({
    where: { alertKey }
  });
  const now = new Date();
  const assignedOwnerUserId = ownerUserId.length > 0 ? ownerUserId : null;

  const assignmentOwner =
    action === "ASSIGN_OWNER" && assignedOwnerUserId
      ? await prisma.user.findFirst({
          where: {
            id: assignedOwnerUserId,
            isActive: true
          },
          select: {
            id: true,
            fullName: true
          }
        })
      : null;

  if (action === "ASSIGN_OWNER" && assignedOwnerUserId && !assignmentOwner) {
    return NextResponse.json({ message: "Selected owner was not found or is inactive." }, { status: 400 });
  }

  const metadataForAssignment = updateAlertStateMetadata(previous?.metadataJson || null, {
    assignedOwnerUserId,
    actorUserId: auth.session.userId,
    changedAtIso: now.toISOString()
  });

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.alertCenterState.upsert({
      where: { alertKey },
      update:
        action === "RESOLVE"
          ? {
              status: "RESOLVED",
              resolvedAt: now,
              resolvedByUserId: auth.session.userId,
              snoozedUntil: null,
              note: note || null
            }
          : action === "SNOOZE"
            ? {
                status: "SNOOZED",
                snoozedUntil: addHours(now, clamp(snoozeHours, 1, 168)),
                resolvedAt: null,
                resolvedByUserId: null,
                note: note || null
              }
            : action === "REOPEN"
              ? {
                  status: "OPEN",
                  snoozedUntil: null,
                  resolvedAt: null,
                  resolvedByUserId: null,
                  note: note || null
                }
              : {
                  metadataJson: metadataForAssignment,
                  note: note || null
                },
      create:
        action === "RESOLVE"
          ? {
              alertKey,
              status: "RESOLVED",
              resolvedAt: now,
              resolvedByUserId: auth.session.userId,
              note: note || null
            }
          : action === "SNOOZE"
            ? {
                alertKey,
                status: "SNOOZED",
                snoozedUntil: addHours(now, clamp(snoozeHours, 1, 168)),
                note: note || null
              }
            : action === "REOPEN"
              ? {
                  alertKey,
                  status: "OPEN",
                  note: note || null
                }
              : {
                  alertKey,
                  status: "OPEN",
                  metadataJson: metadataForAssignment,
                  note: note || null
                }
    });

    await recordAuditLog({
      db: tx,
      module: ALERT_MODULE,
      entityType: "alert",
      entityId: alertKey,
      action: action.toLowerCase(),
      description:
        action === "ASSIGN_OWNER"
          ? `${auth.session.name} assigned alert ${alertKey} to ${assignmentOwner?.fullName || "Unassigned"}.`
          : `${auth.session.name} set alert ${alertKey} to ${row.status}.`,
      before: previous,
      after: row,
      actor: auditActorFromSession(auth.session)
    });

    return row;
  });

  const updatedMetadata = parseAlertStateMetadata(updated.metadataJson);

  return NextResponse.json({
    success: true,
    message:
      action === "RESOLVE"
        ? "Alert marked as resolved."
        : action === "SNOOZE"
          ? "Alert snoozed."
          : action === "REOPEN"
            ? "Alert reopened."
            : "Alert owner updated.",
    data: {
      alertKey: updated.alertKey,
      status: updated.status,
      snoozedUntil: updated.snoozedUntil ? updated.snoozedUntil.toISOString() : null,
      resolvedAt: updated.resolvedAt ? updated.resolvedAt.toISOString() : null,
      assignedOwnerUserId: updatedMetadata.assignedOwnerUserId || null,
      assignedOwnerName:
        updatedMetadata.assignedOwnerUserId && assignmentOwner && assignmentOwner.id === updatedMetadata.assignedOwnerUserId
          ? assignmentOwner.fullName
          : null
    }
  });
}

function isManagerOrAdmin(role: UserRole) {
  return role === "ADMIN" || role === "MANAGER";
}

function addHours(base: Date, hours: number) {
  const next = new Date(base);
  next.setTime(next.getTime() + hours * 3600000);
  return next;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

interface AlertStateMetadata {
  assignedOwnerUserId?: string | null;
  assignedByUserId?: string | null;
  assignedAt?: string | null;
}

function parseAlertStateMetadata(metadataJson: string | null | undefined): AlertStateMetadata {
  if (!metadataJson) {
    return {};
  }
  try {
    const parsed = JSON.parse(metadataJson) as Record<string, unknown>;
    return {
      assignedOwnerUserId:
        typeof parsed.assignedOwnerUserId === "string" && parsed.assignedOwnerUserId.trim().length > 0
          ? parsed.assignedOwnerUserId.trim()
          : null,
      assignedByUserId:
        typeof parsed.assignedByUserId === "string" && parsed.assignedByUserId.trim().length > 0
          ? parsed.assignedByUserId.trim()
          : null,
      assignedAt:
        typeof parsed.assignedAt === "string" && parsed.assignedAt.trim().length > 0 ? parsed.assignedAt.trim() : null
    };
  } catch {
    return {};
  }
}

function updateAlertStateMetadata(
  previousMetadataJson: string | null,
  assignment: { assignedOwnerUserId: string | null; actorUserId: string; changedAtIso: string }
) {
  const previous = parseAlertStateMetadata(previousMetadataJson);
  const next: AlertStateMetadata = {
    ...previous,
    assignedOwnerUserId: assignment.assignedOwnerUserId,
    assignedByUserId: assignment.actorUserId,
    assignedAt: assignment.changedAtIso
  };
  return JSON.stringify(next);
}
