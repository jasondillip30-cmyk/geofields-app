import Link from "next/link";
import { notFound } from "next/navigation";

import { AccessGate } from "@/components/layout/access-gate";
import { Card, MetricCard } from "@/components/ui/card";
import { DataTable } from "@/components/ui/table";
import { prisma } from "@/lib/prisma";
import { formatCurrency, formatNumber, formatPercent } from "@/lib/utils";

export default async function RigProfilePage({
  params
}: {
  params: Promise<{ rigId: string }>;
}) {
  const { rigId } = await params;

  const rig = await prisma.rig.findUnique({
    where: { id: rigId }
  });

  if (!rig) {
    notFound();
  }

  const [currentProject, maintenanceHistory, usageHistory, revenueAgg, expenseAgg, metersAgg] = await Promise.all([
    prisma.project.findFirst({
      where: { assignedRigId: rigId, status: "ACTIVE" },
      include: {
        client: {
          select: {
            name: true
          }
        }
      }
    }),
    prisma.maintenanceRequest.findMany({
      where: { rigId },
      orderBy: { createdAt: "desc" },
      take: 15
    }),
    prisma.rigUsage.findMany({
      where: { rigId },
      orderBy: { startDate: "desc" },
      include: {
        project: {
          select: { name: true }
        },
        client: {
          select: { name: true }
        }
      }
    }),
    prisma.revenue.aggregate({
      where: { rigId },
      _sum: { amount: true }
    }),
    prisma.expense.aggregate({
      where: { rigId },
      _sum: { amount: true }
    }),
    prisma.drillReport.aggregate({
      where: { rigId },
      _sum: { totalMetersDrilled: true }
    })
  ]);

  const revenue = revenueAgg._sum.amount || 0;
  const expenses = expenseAgg._sum.amount || 0;
  const profit = revenue - expenses;
  const utilization = rig.totalLifetimeDays > 0 ? (rig.totalHoursWorked / (rig.totalLifetimeDays * 24)) * 100 : 0;

  return (
    <AccessGate permission="rigs:view">
      <div className="gf-page-stack">
        <section className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-2xl text-ink-900">{rig.rigCode}</h2>
            <p className="text-sm text-ink-600">
              {rig.model} • Serial {rig.serialNumber}
            </p>
          </div>
          <Link href="/rigs" className="text-sm text-brand-700 underline-offset-2 hover:underline">
            Back to rigs
          </Link>
        </section>

        <section className="grid gap-3 md:grid-cols-3 lg:grid-cols-6">
          <MetricCard label="Status" value={rig.status} />
          <MetricCard label="Condition" value={rig.condition} />
          <MetricCard label="Condition Score" value={`${rig.conditionScore}/100`} />
          <MetricCard label="Current Project" value={currentProject?.name || "Unassigned"} />
          <MetricCard label="Current Client" value={currentProject?.client?.name || "Unassigned"} />
          <MetricCard label="Acquisition Date" value={rig.acquisitionDate ? rig.acquisitionDate.toISOString().slice(0, 10) : "-"} />
          <MetricCard label="Total Hours" value={formatNumber(rig.totalHoursWorked)} />
          <MetricCard label="Lifetime Days" value={formatNumber(rig.totalLifetimeDays)} />
          <MetricCard label="Total Meters" value={formatNumber(metersAgg._sum.totalMetersDrilled || 0)} />
          <MetricCard label="Revenue" value={formatCurrency(revenue)} tone="good" />
          <MetricCard label="Expenses" value={formatCurrency(expenses)} tone="warn" />
          <MetricCard label="Profitability" value={formatCurrency(profit)} tone={profit >= 0 ? "good" : "danger"} />
        </section>

        <section className="grid gap-5 lg:grid-cols-2">
          <Card title="Operational Profile">
            <div className="space-y-2 text-sm text-ink-700">
              <p>Utilization rate: {formatPercent(utilization)}</p>
              <p>Total hours worked: {formatNumber(rig.totalHoursWorked)}</p>
              <p>Total meters drilled: {formatNumber(metersAgg._sum.totalMetersDrilled || 0)}</p>
              <p>Current assignment: {currentProject?.name || "No active assignment"}</p>
              {rig.photoUrl && (
                <img
                  src={rig.photoUrl}
                  alt={`${rig.rigCode} profile`}
                  className="mt-2 h-32 w-full rounded border border-slate-200 object-cover"
                />
              )}
            </div>
          </Card>
          <Card title="Profitability Snapshot">
            <DataTable
              columns={["Metric", "Value"]}
              rows={[
                ["Revenue", formatCurrency(revenue)],
                ["Expenses", formatCurrency(expenses)],
                ["Profit", formatCurrency(profit)],
                ["Utilization", formatPercent(utilization)]
              ]}
            />
          </Card>
        </section>

        <Card title="Maintenance History">
          <DataTable
            columns={["Request Code", "Date", "Issue", "Urgency", "Status", "Estimated Downtime"]}
            rows={maintenanceHistory.map((request) => [
              request.requestCode,
              request.requestDate.toISOString().slice(0, 10),
              request.issueDescription,
              request.urgency,
              request.status,
              `${request.estimatedDowntimeHrs} hrs`
            ])}
          />
        </Card>

        <Card title="Usage History">
          <DataTable
            columns={["Project", "Client", "Start Date", "End Date", "Usage Days", "Usage Hours"]}
            rows={usageHistory.map((usage) => [
              usage.project.name,
              usage.client.name,
              usage.startDate.toISOString().slice(0, 10),
              usage.endDate ? usage.endDate.toISOString().slice(0, 10) : "Ongoing",
              formatNumber(usage.usageDays),
              formatNumber(usage.usageHours)
            ])}
          />
        </Card>
      </div>
    </AccessGate>
  );
}
