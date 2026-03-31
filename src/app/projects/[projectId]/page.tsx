import Link from "next/link";
import { notFound } from "next/navigation";

import { AccessGate } from "@/components/layout/access-gate";
import { Card, MetricCard } from "@/components/ui/card";
import { DataTable } from "@/components/ui/table";
import { prisma } from "@/lib/prisma";
import { formatCurrency, formatNumber } from "@/lib/utils";

export default async function ProjectWorkspacePage({
  params
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: {
      client: true,
      assignedRig: true,
      backupRig: true
    }
  });

  if (!project) {
    notFound();
  }

  const [revenueAgg, expenseAgg, drillReports] = await Promise.all([
    prisma.revenue.aggregate({
      where: { projectId },
      _sum: { amount: true }
    }),
    prisma.expense.aggregate({
      where: { projectId },
      _sum: { amount: true }
    }),
    prisma.drillReport.findMany({
      where: { projectId },
      orderBy: { date: "desc" },
      take: 20,
      include: {
        rig: {
          select: { rigCode: true }
        }
      }
    })
  ]);

  const revenue = revenueAgg._sum.amount || 0;
  const expenses = expenseAgg._sum.amount || 0;
  const meters = drillReports.reduce((sum, report) => sum + report.totalMetersDrilled, 0);
  const costPerMeter = meters > 0 ? expenses / meters : 0;

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
          <MetricCard label="Revenue" value={formatCurrency(revenue)} tone="good" />
          <MetricCard label="Expenses" value={formatCurrency(expenses)} tone="warn" />
          <MetricCard label="Profit" value={formatCurrency(revenue - expenses)} tone="good" />
          <MetricCard label="Cost per Meter" value={formatCurrency(costPerMeter)} />
        </section>

        <section className="grid gap-5 lg:grid-cols-2">
          <Card title="Project Details">
            <div className="space-y-2 text-sm text-ink-700">
              <p>Start Date: {project.startDate.toISOString().slice(0, 10)}</p>
              <p>End Date: {project.endDate ? project.endDate.toISOString().slice(0, 10) : "-"}</p>
              <p>Description: {project.description || "-"}</p>
              {project.photoUrl && (
                <img
                  src={project.photoUrl}
                  alt={`${project.name} photo`}
                  className="mt-2 h-32 w-full rounded border border-slate-200 object-cover"
                />
              )}
            </div>
          </Card>

          <Card title="Performance Summary">
            <DataTable
              columns={["Metric", "Value"]}
              rows={[
                ["Meters drilled (recent logs)", formatNumber(meters)],
                ["Revenue", formatCurrency(revenue)],
                ["Expenses", formatCurrency(expenses)],
                ["Profit", formatCurrency(revenue - expenses)],
                ["Cost per meter", formatCurrency(costPerMeter)]
              ]}
            />
          </Card>
        </section>

        <Card title="Recent Drilling Reports">
          <DataTable
            columns={["Date", "Rig", "Hole", "Meters", "Work Hours", "Delay", "Billable Amount"]}
            rows={drillReports.map((report) => [
              report.date.toISOString().slice(0, 10),
              report.rig?.rigCode || "-",
              report.holeNumber,
              formatNumber(report.totalMetersDrilled),
              report.workHours.toFixed(1),
              report.delayHours.toFixed(1),
              formatCurrency(report.billableAmount)
            ])}
          />
        </Card>
      </div>
    </AccessGate>
  );
}
