import Link from "next/link";
import { notFound } from "next/navigation";

import { AccessGate } from "@/components/layout/access-gate";
import { Card, MetricCard } from "@/components/ui/card";
import { DataTable } from "@/components/ui/table";
import { withFinancialDrillReportApproval, withFinancialExpenseApproval } from "@/lib/financial-approval-policy";
import { prisma } from "@/lib/prisma";
import {
  parsePurchaseRequisitionPayload,
  PURCHASE_REQUISITION_REPORT_TYPE,
  requisitionTypeLabel
} from "@/lib/requisition-workflow";
import { formatCurrency, formatNumber, formatPercent } from "@/lib/utils";

const RECEIPT_POSTED_EXPENSE_SUBCATEGORY = "Inventory Receipt Intake";

export default async function ProjectWorkspacePage({
  params
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;

  const projectPromise = prisma.project.findUnique({
    where: { id: projectId },
    include: {
      client: true,
      assignedRig: true,
      backupRig: true
    }
  });
  const approvedDrillReportsPromise = prisma.drillReport.findMany({
    where: withFinancialDrillReportApproval({ projectId }),
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    include: {
      rig: {
        select: {
          id: true,
          rigCode: true
        }
      }
    }
  });
  const postedCostExpensesPromise = prisma.expense.findMany({
    where: withFinancialExpenseApproval({
      projectId,
      entrySource: "INVENTORY",
      subcategory: RECEIPT_POSTED_EXPENSE_SUBCATEGORY
    }),
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    select: {
      id: true,
      date: true,
      amount: true,
      category: true,
      subcategory: true,
      vendor: true,
      receiptNumber: true,
      notes: true,
      rigId: true,
      rig: {
        select: {
          id: true,
          rigCode: true,
          status: true
        }
      }
    }
  });
  const requisitionRowsPromise = prisma.summaryReport.findMany({
    where: {
      reportType: PURCHASE_REQUISITION_REPORT_TYPE,
      projectId
    },
    orderBy: [{ reportDate: "desc" }, { createdAt: "desc" }]
  });
  const activeBudgetPromise = prisma.budgetPlan.findFirst({
    where: {
      scopeType: "PROJECT",
      projectId,
      isActive: true
    },
    orderBy: [{ periodStart: "desc" }, { updatedAt: "desc" }]
  });
  const expectedRevenueAggPromise = prisma.revenue.aggregate({
    where: {
      projectId,
      OR: [
        {
          category: {
            contains: "expected",
            mode: "insensitive"
          }
        },
        {
          category: {
            contains: "forecast",
            mode: "insensitive"
          }
        }
      ]
    },
    _sum: {
      amount: true
    }
  });
  const breakdownAggregatePromise = prisma.breakdownReport.aggregate({
    where: { projectId },
    _count: { _all: true },
    _sum: { downtimeHours: true }
  });
  const recentBreakdownsPromise = prisma.breakdownReport.findMany({
    where: { projectId },
    orderBy: [{ reportDate: "desc" }, { createdAt: "desc" }],
    take: 8,
    include: {
      rig: {
        select: {
          id: true,
          rigCode: true
        }
      }
    }
  });
  const maintenanceByStatusPromise = prisma.maintenanceRequest.groupBy({
    by: ["status"],
    where: { projectId },
    _count: { _all: true }
  });
  const recentMaintenancePromise = prisma.maintenanceRequest.findMany({
    where: { projectId },
    orderBy: [{ requestDate: "desc" }, { createdAt: "desc" }],
    take: 8,
    include: {
      rig: {
        select: {
          id: true,
          rigCode: true
        }
      },
      mechanic: {
        select: {
          fullName: true
        }
      }
    }
  });

  const [
    project,
    approvedDrillReports,
    postedCostExpenses,
    requisitionRows,
    activeBudget,
    expectedRevenueAgg,
    breakdownAggregate,
    recentBreakdowns,
    maintenanceByStatus,
    recentMaintenance
  ] = await Promise.all([
    projectPromise,
    approvedDrillReportsPromise,
    postedCostExpensesPromise,
    requisitionRowsPromise,
    activeBudgetPromise,
    expectedRevenueAggPromise,
    breakdownAggregatePromise,
    recentBreakdownsPromise,
    maintenanceByStatusPromise,
    recentMaintenancePromise
  ]);

  if (!project) {
    notFound();
  }

  const totalMetersDrilled = approvedDrillReports.reduce(
    (sum, report) => sum + report.totalMetersDrilled,
    0
  );
  const drillingReportCount = approvedDrillReports.length;
  const totalWorkingHours = approvedDrillReports.reduce((sum, report) => sum + report.workHours, 0);
  const totalStandbyHours = approvedDrillReports.reduce((sum, report) => sum + report.standbyHours, 0);
  const totalDelayHours = approvedDrillReports.reduce((sum, report) => sum + report.delayHours, 0);
  const totalDowntimeHours = totalStandbyHours + totalDelayHours;
  const reportingDayCount = new Set(
    approvedDrillReports.map((report) => report.date.toISOString().slice(0, 10))
  ).size;
  const averageMetersPerDay =
    reportingDayCount > 0 ? totalMetersDrilled / reportingDayCount : 0;

  const actualRevenue = totalMetersDrilled * project.contractRatePerM;
  const totalPostedCost = postedCostExpenses.reduce((sum, expense) => sum + expense.amount, 0);
  const profitLoss = actualRevenue - totalPostedCost;
  const marginPercent = actualRevenue > 0 ? (profitLoss / actualRevenue) * 100 : 0;
  const expectedRevenue =
    expectedRevenueAgg._sum.amount && expectedRevenueAgg._sum.amount > 0
      ? expectedRevenueAgg._sum.amount
      : null;

  const costByCategory = new Map<string, number>();
  const costBySubcategory = new Map<
    string,
    { category: string; subcategory: string; total: number }
  >();
  const costByMonth = new Map<string, number>();
  for (const expense of postedCostExpenses) {
    const category = expense.category || "Uncategorized";
    const subcategory = expense.subcategory || "Unspecified";
    costByCategory.set(category, (costByCategory.get(category) || 0) + expense.amount);

    const subcategoryKey = `${category}__${subcategory}`;
    const existingSubcategory = costBySubcategory.get(subcategoryKey) || {
      category,
      subcategory,
      total: 0
    };
    existingSubcategory.total += expense.amount;
    costBySubcategory.set(subcategoryKey, existingSubcategory);

    const monthKey = expense.date.toISOString().slice(0, 7);
    costByMonth.set(monthKey, (costByMonth.get(monthKey) || 0) + expense.amount);
  }
  const categoryRows = Array.from(costByCategory.entries())
    .map(([category, amount]) => ({ category, amount }))
    .sort((a, b) => b.amount - a.amount);
  const subcategoryRows = Array.from(costBySubcategory.values())
    .sort((a, b) => b.total - a.total)
    .slice(0, 10);
  const topPostedExpenses = [...postedCostExpenses]
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 5);
  const monthlyCostRows = Array.from(costByMonth.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([month, amount]) => ({
      month,
      amount
    }));

  const pendingRequisitions = requisitionRows
    .map((row) => {
      const parsed = parsePurchaseRequisitionPayload(row.payloadJson);
      if (!parsed) {
        return null;
      }
      const payload = parsed.payload;
      if (payload.status !== "APPROVED" || payload.purchase.postedAt) {
        return null;
      }
      const estimatedValue =
        payload.totals.approvedTotalCost > 0
          ? payload.totals.approvedTotalCost
          : payload.totals.estimatedTotalCost;
      return {
        id: row.id,
        requisitionCode: payload.requisitionCode,
        type: payload.type,
        category: payload.category,
        submittedAt: payload.submittedAt,
        approvedAt: payload.approval.approvedAt,
        estimatedValue
      };
    })
    .filter(
      (
        entry
      ): entry is {
        id: string;
        requisitionCode: string;
        type: "LIVE_PROJECT_PURCHASE" | "INVENTORY_STOCK_UP" | "MAINTENANCE_PURCHASE";
        category: string;
        submittedAt: string;
        approvedAt: string | null;
        estimatedValue: number;
      } => Boolean(entry)
    )
    .sort((a, b) => b.estimatedValue - a.estimatedValue);
  const pendingRequisitionValue = pendingRequisitions.reduce(
    (sum, requisition) => sum + requisition.estimatedValue,
    0
  );

  const rigPerformanceById = new Map<
    string,
    { meters: number; downtimeHours: number; workHours: number; reportCount: number }
  >();
  for (const report of approvedDrillReports) {
    const entry = rigPerformanceById.get(report.rigId) || {
      meters: 0,
      downtimeHours: 0,
      workHours: 0,
      reportCount: 0
    };
    entry.meters += report.totalMetersDrilled;
    entry.workHours += report.workHours;
    entry.downtimeHours += report.delayHours + report.standbyHours;
    entry.reportCount += 1;
    rigPerformanceById.set(report.rigId, entry);
  }

  const rigIds = new Set<string>(rigPerformanceById.keys());
  if (project.assignedRigId) {
    rigIds.add(project.assignedRigId);
  }
  if (project.backupRigId) {
    rigIds.add(project.backupRigId);
  }
  const linkedRigs = rigIds.size
    ? await prisma.rig.findMany({
        where: {
          id: {
            in: Array.from(rigIds)
          }
        },
        select: {
          id: true,
          rigCode: true,
          status: true
        }
      })
    : [];
  const linkedRigMap = new Map(linkedRigs.map((rig) => [rig.id, rig]));
  const rigRows = Array.from(rigIds).map((rigId) => {
    const rig = linkedRigMap.get(rigId);
    const metrics = rigPerformanceById.get(rigId) || {
      meters: 0,
      downtimeHours: 0,
      workHours: 0,
      reportCount: 0
    };
    const role =
      rigId === project.assignedRigId
        ? "Primary"
        : rigId === project.backupRigId
          ? "Backup"
          : "Contributing";
    return {
      rigId,
      rigCode: rig?.rigCode || "Unknown rig",
      status: rig?.status || "UNTRACKED",
      role,
      ...metrics
    };
  });
  rigRows.sort((a, b) => b.meters - a.meters);

  const dailyDrillingRows = new Map<
    string,
    { date: string; meters: number; workHours: number; downtimeHours: number }
  >();
  for (const report of approvedDrillReports) {
    const dateKey = report.date.toISOString().slice(0, 10);
    const row = dailyDrillingRows.get(dateKey) || {
      date: dateKey,
      meters: 0,
      workHours: 0,
      downtimeHours: 0
    };
    row.meters += report.totalMetersDrilled;
    row.workHours += report.workHours;
    row.downtimeHours += report.delayHours + report.standbyHours;
    dailyDrillingRows.set(dateKey, row);
  }
  const drillingTrendRows = Array.from(dailyDrillingRows.values())
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 14);

  const totalBreakdowns = breakdownAggregate._count._all;
  const breakdownDowntimeHours = breakdownAggregate._sum.downtimeHours || 0;
  const maintenanceOpenCount = maintenanceByStatus.reduce((sum, row) => {
    if (row.status === "COMPLETED" || row.status === "DENIED") {
      return sum;
    }
    return sum + row._count._all;
  }, 0);
  const maintenanceCompletedCount = maintenanceByStatus.reduce((sum, row) => {
    if (row.status === "COMPLETED") {
      return sum + row._count._all;
    }
    return sum;
  }, 0);

  return (
    <AccessGate permission="projects:view">
      <div className="gf-page-stack">
        <section className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-2xl text-ink-900">{project.name}</h2>
            <p className="text-sm text-ink-600">
              {project.client.name} • {project.location}
            </p>
          </div>
          <Link href="/projects" className="text-sm text-brand-700 underline-offset-2 hover:underline">
            Back to projects
          </Link>
        </section>

        <section className="grid gap-3 md:grid-cols-4">
          <MetricCard label="Status" value={project.status} />
          <MetricCard label="Assigned Rig" value={project.assignedRig?.rigCode || "Unassigned"} />
          <MetricCard label="Backup Rig" value={project.backupRig?.rigCode || "None"} />
          <MetricCard label="Contract Rate/m" value={formatCurrency(project.contractRatePerM)} />
        </section>

        <section className="space-y-3">
          <div>
            <h3 className="text-lg font-semibold text-ink-900">Financial Summary</h3>
            <p className="text-sm text-ink-600">
              Revenue uses approved drilling reports (meters × contract rate). Cost includes only posted receipt/purchase expenses.
            </p>
          </div>
          <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
            <MetricCard label="Budget" value={activeBudget ? formatCurrency(activeBudget.amount) : "No budget"} />
            <MetricCard
              label="Expected Revenue"
              value={expectedRevenue ? formatCurrency(expectedRevenue) : "Unavailable"}
            />
            <MetricCard label="Actual Revenue" value={formatCurrency(actualRevenue)} tone="good" />
            <MetricCard label="Total Posted Cost" value={formatCurrency(totalPostedCost)} tone="warn" />
            <MetricCard
              label="Profit / Loss"
              value={formatCurrency(profitLoss)}
              tone={profitLoss >= 0 ? "good" : "danger"}
            />
            <MetricCard
              label="Margin %"
              value={formatPercent(marginPercent)}
              tone={marginPercent >= 0 ? "good" : "danger"}
            />
          </div>
        </section>

        <section className="grid gap-5 lg:grid-cols-2">
          <Card title="Drilling Performance" subtitle="Approved reports only">
            <DataTable
              columns={["Metric", "Value"]}
              rows={[
                ["Total meters drilled", formatNumber(totalMetersDrilled)],
                ["Drilling reports", formatNumber(drillingReportCount)],
                ["Average meters / day", formatNumber(averageMetersPerDay)],
                ["Total working hours", formatNumber(totalWorkingHours)],
                ["Standby hours", formatNumber(totalStandbyHours)],
                ["Delay hours", formatNumber(totalDelayHours)],
                ["Downtime indicators", formatNumber(totalDowntimeHours)]
              ]}
            />
          </Card>
          <Card title="Recent Drilling Trend" subtitle="Latest 14 report dates">
            {drillingTrendRows.length === 0 ? (
              <p className="text-sm text-ink-600">No approved drilling reports found for this project.</p>
            ) : (
              <DataTable
                columns={["Date", "Meters", "Work Hours", "Downtime"]}
                rows={drillingTrendRows.map((row) => [
                  formatIsoDate(row.date),
                  formatNumber(row.meters),
                  formatNumber(row.workHours),
                  formatNumber(row.downtimeHours)
                ])}
              />
            )}
          </Card>
        </section>

        <section className="grid gap-5 lg:grid-cols-2">
          <Card title="Cost Breakdown" subtitle="Posted receipt/purchase costs only">
            {postedCostExpenses.length === 0 ? (
              <p className="text-sm text-ink-600">
                No posted project costs found yet. Requisitions and approvals do not count until purchase/receipt posting is completed.
              </p>
            ) : (
              <div className="space-y-4">
                <DataTable
                  columns={["Category", "Posted Cost"]}
                  rows={categoryRows.map((row) => [row.category, formatCurrency(row.amount)])}
                />
                <DataTable
                  columns={["Subcategory", "Category", "Posted Cost"]}
                  rows={subcategoryRows.map((row) => [
                    row.subcategory,
                    row.category,
                    formatCurrency(row.total)
                  ])}
                />
              </div>
            )}
          </Card>

          <Card title="Top 5 Largest Posted Costs">
            {topPostedExpenses.length === 0 ? (
              <p className="text-sm text-ink-600">No posted cost lines yet.</p>
            ) : (
              <DataTable
                columns={["Date", "Vendor", "Category", "Receipt", "Amount"]}
                rows={topPostedExpenses.map((expense) => [
                  formatDate(expense.date),
                  expense.vendor || "-",
                  expense.category || "-",
                  expense.receiptNumber || "-",
                  formatCurrency(expense.amount)
                ])}
              />
            )}
          </Card>
        </section>

        <section className="grid gap-5 lg:grid-cols-2">
          <Card title="Cost Over Time" subtitle="Monthly posted cost trend">
            {monthlyCostRows.length === 0 ? (
              <p className="text-sm text-ink-600">No posted costs available for trend analysis yet.</p>
            ) : (
              <DataTable
                columns={["Month", "Posted Cost"]}
                rows={monthlyCostRows.map((entry) => [formatMonthLabel(entry.month), formatCurrency(entry.amount)])}
              />
            )}
          </Card>

          <Card title="Requisition Impact" subtitle="Approved requisitions pending purchase">
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <MetricCard label="Pending requisitions" value={formatNumber(pendingRequisitions.length)} />
                <MetricCard label="Estimated pending value" value={formatCurrency(pendingRequisitionValue)} tone="warn" />
              </div>
              {pendingRequisitions.length === 0 ? (
                <p className="text-sm text-ink-600">
                  No approved-pending requisitions for this project right now.
                </p>
              ) : (
                <DataTable
                  columns={["Requisition", "Type", "Category", "Approved", "Estimated Value"]}
                  rows={pendingRequisitions.map((requisition) => [
                    requisition.requisitionCode,
                    requisitionTypeLabel(requisition.type),
                    requisition.category,
                    requisition.approvedAt ? formatDate(new Date(requisition.approvedAt)) : "-",
                    formatCurrency(requisition.estimatedValue)
                  ])}
                />
              )}
            </div>
          </Card>
        </section>

        <section className="space-y-3">
          <div>
            <h3 className="text-lg font-semibold text-ink-900">Rigs</h3>
            <p className="text-sm text-ink-600">
              Performance and status for rigs linked to this project.
            </p>
          </div>
          <Card title="Rig Performance">
            {rigRows.length === 0 ? (
              <p className="text-sm text-ink-600">No rig activity linked to this project yet.</p>
            ) : (
              <DataTable
                columns={["Rig", "Role", "Status", "Meters", "Downtime (hrs)", "Work Hours", "Reports"]}
                rows={rigRows.map((row) => [
                  <Link
                    key={`rig-link-${row.rigId}`}
                    href={`/rigs/${row.rigId}`}
                    className="text-brand-700 underline-offset-2 hover:underline"
                  >
                    {row.rigCode}
                  </Link>,
                  row.role,
                  row.status,
                  formatNumber(row.meters),
                  formatNumber(row.downtimeHours),
                  formatNumber(row.workHours),
                  formatNumber(row.reportCount)
                ])}
              />
            )}
          </Card>
        </section>

        <section className="grid gap-5 lg:grid-cols-2">
          <Card title="Breakdown / Maintenance Impact">
            <div className="grid gap-3 sm:grid-cols-2">
              <MetricCard label="Breakdowns logged" value={formatNumber(totalBreakdowns)} tone={totalBreakdowns > 0 ? "warn" : "neutral"} />
              <MetricCard label="Downtime hours" value={formatNumber(breakdownDowntimeHours)} tone={breakdownDowntimeHours > 0 ? "warn" : "neutral"} />
              <MetricCard label="Open maintenance" value={formatNumber(maintenanceOpenCount)} tone={maintenanceOpenCount > 0 ? "warn" : "neutral"} />
              <MetricCard label="Completed maintenance" value={formatNumber(maintenanceCompletedCount)} tone="good" />
            </div>
          </Card>

          <Card title="Project Details">
            <div className="space-y-2 text-sm text-ink-700">
              <p>Start Date: {project.startDate.toISOString().slice(0, 10)}</p>
              <p>End Date: {project.endDate ? project.endDate.toISOString().slice(0, 10) : "-"}</p>
              <p>Description: {project.description || "-"}</p>
              <p>
                Budget period:{" "}
                {activeBudget
                  ? `${formatDate(activeBudget.periodStart)} to ${formatDate(activeBudget.periodEnd)}`
                  : "No active project budget"}
              </p>
              {project.photoUrl && (
                <img
                  src={project.photoUrl}
                  alt={`${project.name} photo`}
                  className="mt-2 h-32 w-full rounded border border-slate-200 object-cover"
                />
              )}
            </div>
          </Card>
        </section>

        <section className="grid gap-5 lg:grid-cols-2">
          <Card title="Recent Breakdowns">
            {recentBreakdowns.length === 0 ? (
              <p className="text-sm text-ink-600">No breakdown reports logged for this project.</p>
            ) : (
              <DataTable
                columns={["Date", "Rig", "Title", "Severity", "Downtime", "Status"]}
                rows={recentBreakdowns.map((breakdown) => [
                  formatDate(breakdown.reportDate),
                  <Link
                    key={`breakdown-rig-link-${breakdown.id}`}
                    href={`/rigs/${breakdown.rigId}`}
                    className="text-brand-700 underline-offset-2 hover:underline"
                  >
                    {breakdown.rig.rigCode}
                  </Link>,
                  breakdown.title,
                  breakdown.severity,
                  `${formatNumber(breakdown.downtimeHours)} hrs`,
                  breakdown.status
                ])}
              />
            )}
          </Card>

          <Card title="Recent Maintenance Requests">
            {recentMaintenance.length === 0 ? (
              <p className="text-sm text-ink-600">No maintenance requests linked to this project.</p>
            ) : (
              <DataTable
                columns={["Request", "Date", "Rig", "Urgency", "Status", "Mechanic"]}
                rows={recentMaintenance.map((request) => [
                  request.requestCode,
                  formatDate(request.requestDate),
                  request.rig.rigCode,
                  request.urgency,
                  request.status,
                  request.mechanic.fullName
                ])}
              />
            )}
          </Card>
        </section>

        <Card title="Data Integrity Rules Applied">
          <DataTable
            columns={["Rule", "Applied Behavior"]}
            rows={[
              [
                "Only posted costs affect profitability",
                "Uses approved expense records posted through receipt/purchase stage only."
              ],
              [
                "Requisitions do not count as cost",
                "Approved requisitions are shown separately as pending cost pressure."
              ],
              [
                "Stock-up should not inflate project cost",
                "Project profitability includes only expenses explicitly linked to this project."
              ],
              [
                "Maintenance/project linkage",
                "Breakdown and maintenance sections are displayed alongside project financials for root-cause context."
              ]
            ]}
          />
        </Card>

        <Card title="Recent Approved Drilling Reports">
          {approvedDrillReports.length === 0 ? (
            <p className="text-sm text-ink-600">No approved drilling reports available yet.</p>
          ) : (
            <DataTable
              columns={["Date", "Rig", "Hole", "Meters", "Work Hours", "Standby", "Delay", "Billable"]}
              rows={approvedDrillReports.slice(0, 20).map((report) => [
                formatDate(report.date),
                report.rig?.rigCode || "-",
                report.holeNumber,
                formatNumber(report.totalMetersDrilled),
                formatNumber(report.workHours),
                formatNumber(report.standbyHours),
                formatNumber(report.delayHours),
                formatCurrency(report.billableAmount)
              ])}
            />
          )}
        </Card>
      </div>
    </AccessGate>
  );
}

function formatDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

function formatIsoDate(value: string) {
  return value.slice(0, 10);
}

function formatMonthLabel(bucket: string) {
  const date = new Date(`${bucket}-01T00:00:00.000Z`);
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC"
  }).format(date);
}
