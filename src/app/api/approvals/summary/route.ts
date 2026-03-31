import { NextResponse, type NextRequest } from "next/server";

import { requireApiPermission } from "@/lib/auth/api-guard";
import { prisma } from "@/lib/prisma";
import { parseReceiptSubmissionPayload } from "@/lib/receipt-intake-submission";

const RECEIPT_SUBMISSION_REPORT_TYPE = "INVENTORY_RECEIPT_SUBMISSION";

export async function GET(request: NextRequest) {
  const auth = await requireApiPermission(request, "dashboard:view");
  if (!auth.ok) {
    return auth.response;
  }

  const now = new Date();
  const startToday = startOfUtcDay(now);
  const endToday = endOfUtcDay(now);
  const startWeek = startOfUtcWeek(now);

  const [
    pendingExpenses,
    pendingDrillingReports,
    pendingMaintenance,
    pendingInventoryUsage,
    receiptSubmissionRows,
    rejectedExpensesThisWeek,
    rejectedDrillingReportsThisWeek,
    rejectedMaintenanceThisWeek,
    rejectedInventoryUsageThisWeek,
    approvedExpensesToday,
    approvedDrillingReportsToday,
    approvedMaintenanceToday,
    approvedInventoryUsageToday
  ] = await Promise.all([
    prisma.expense.count({
      where: {
        approvalStatus: "SUBMITTED"
      }
    }),
    prisma.drillReport.count({
      where: {
        approvalStatus: "SUBMITTED"
      }
    }),
    prisma.maintenanceRequest.count({
      where: {
        status: "SUBMITTED"
      }
    }),
    prisma.inventoryUsageRequest.count({
      where: {
        status: {
          in: ["SUBMITTED", "PENDING"]
        }
      }
    }),
    prisma.summaryReport.findMany({
      where: {
        reportType: RECEIPT_SUBMISSION_REPORT_TYPE
      },
      select: {
        reportDate: true,
        payloadJson: true
      }
    }),
    prisma.expense.count({
      where: {
        approvalStatus: "REJECTED",
        approvedAt: { gte: startWeek, lte: now }
      }
    }),
    prisma.drillReport.count({
      where: {
        approvalStatus: "REJECTED",
        approvedAt: { gte: startWeek, lte: now }
      }
    }),
    prisma.maintenanceRequest.count({
      where: {
        status: "DENIED",
        updatedAt: { gte: startWeek, lte: now }
      }
    }),
    prisma.inventoryUsageRequest.count({
      where: {
        status: "REJECTED",
        decidedAt: { gte: startWeek, lte: now }
      }
    }),
    prisma.expense.count({
      where: {
        approvalStatus: "APPROVED",
        approvedAt: { gte: startToday, lte: endToday }
      }
    }),
    prisma.drillReport.count({
      where: {
        approvalStatus: "APPROVED",
        approvedAt: { gte: startToday, lte: endToday }
      }
    }),
    prisma.maintenanceRequest.count({
      where: {
        status: "APPROVED",
        updatedAt: { gte: startToday, lte: endToday }
      }
    }),
    prisma.inventoryUsageRequest.count({
      where: {
        status: "APPROVED",
        decidedAt: { gte: startToday, lte: endToday }
      }
    })
  ]);

  let pendingReceiptSubmissions = 0;
  let rejectedReceiptSubmissionsThisWeek = 0;
  let approvedReceiptSubmissionsToday = 0;

  for (const row of receiptSubmissionRows) {
    const parsed = parseReceiptSubmissionPayload(row.payloadJson);
    if (!parsed) {
      continue;
    }
    if (parsed.status === "SUBMITTED") {
      pendingReceiptSubmissions += 1;
      continue;
    }
    if (parsed.status === "REJECTED" && row.reportDate >= startWeek && row.reportDate <= now) {
      rejectedReceiptSubmissionsThisWeek += 1;
      continue;
    }
    if (parsed.status === "APPROVED" && row.reportDate >= startToday && row.reportDate <= endToday) {
      approvedReceiptSubmissionsToday += 1;
    }
  }

  const pendingApprovals =
    pendingExpenses + pendingDrillingReports + pendingMaintenance + pendingInventoryUsage + pendingReceiptSubmissions;
  const rejectedThisWeek =
    rejectedExpensesThisWeek +
    rejectedDrillingReportsThisWeek +
    rejectedMaintenanceThisWeek +
    rejectedInventoryUsageThisWeek +
    rejectedReceiptSubmissionsThisWeek;
  const approvedToday =
    approvedExpensesToday +
    approvedDrillingReportsToday +
    approvedMaintenanceToday +
    approvedInventoryUsageToday +
    approvedReceiptSubmissionsToday;

  return NextResponse.json({
    pendingApprovals,
    rejectedThisWeek,
    approvedToday,
    breakdown: {
      pendingExpenses,
      pendingDrillingReports,
      pendingMaintenance,
      pendingInventoryUsage,
      pendingReceiptSubmissions
    },
    resolutionBreakdown: {
      rejectedThisWeek: {
        expenses: rejectedExpensesThisWeek,
        drillingReports: rejectedDrillingReportsThisWeek,
        maintenance: rejectedMaintenanceThisWeek,
        inventoryUsage: rejectedInventoryUsageThisWeek,
        receiptSubmissions: rejectedReceiptSubmissionsThisWeek
      },
      approvedToday: {
        expenses: approvedExpensesToday,
        drillingReports: approvedDrillingReportsToday,
        maintenance: approvedMaintenanceToday,
        inventoryUsage: approvedInventoryUsageToday,
        receiptSubmissions: approvedReceiptSubmissionsToday
      }
    }
  });
}

function startOfUtcDay(date: Date) {
  const next = new Date(date);
  next.setUTCHours(0, 0, 0, 0);
  return next;
}

function endOfUtcDay(date: Date) {
  const next = new Date(date);
  next.setUTCHours(23, 59, 59, 999);
  return next;
}

function startOfUtcWeek(date: Date) {
  const next = startOfUtcDay(date);
  const day = next.getUTCDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  next.setUTCDate(next.getUTCDate() + mondayOffset);
  return next;
}
