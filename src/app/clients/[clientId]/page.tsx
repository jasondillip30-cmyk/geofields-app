import Link from "next/link";
import { notFound } from "next/navigation";

import { AccessGate } from "@/components/layout/access-gate";
import { Card, MetricCard } from "@/components/ui/card";
import { DataTable } from "@/components/ui/table";
import { prisma } from "@/lib/prisma";
import { formatCurrency, formatNumber } from "@/lib/utils";

export default async function ClientWorkspacePage({
  params
}: {
  params: Promise<{ clientId: string }>;
}) {
  const { clientId } = await params;

  const client = await prisma.client.findUnique({
    where: { id: clientId },
    include: {
      projects: {
        include: {
          assignedRig: {
            select: {
              rigCode: true
            }
          }
        },
        orderBy: { createdAt: "desc" }
      }
    }
  });

  if (!client) {
    notFound();
  }

  const [revenueAgg, expenseAgg, drilledMeters] = await Promise.all([
    prisma.revenue.aggregate({
      where: { clientId },
      _sum: { amount: true }
    }),
    prisma.expense.aggregate({
      where: { clientId },
      _sum: { amount: true }
    }),
    prisma.drillReport.aggregate({
      where: { clientId },
      _sum: { totalMetersDrilled: true }
    })
  ]);

  const revenue = revenueAgg._sum.amount || 0;
  const expenses = expenseAgg._sum.amount || 0;
  const profit = revenue - expenses;

  return (
    <AccessGate permission="clients:view">
      <div className="gf-page-stack">
        <section className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-2xl text-ink-900">{client.name}</h2>
            <p className="text-sm text-ink-600">{client.description || "Client profile and project workspace"}</p>
          </div>
          <Link href="/clients" className="text-sm text-brand-700 underline-offset-2 hover:underline">
            Back to clients
          </Link>
        </section>

        <section className="grid gap-3 md:grid-cols-3 lg:grid-cols-6">
          <MetricCard label="Projects" value={String(client.projects.length)} />
          <MetricCard label="Active Projects" value={String(client.projects.filter((project) => project.status === "ACTIVE").length)} />
          <MetricCard label="Revenue" value={formatCurrency(revenue)} tone="good" />
          <MetricCard label="Expenses" value={formatCurrency(expenses)} tone="warn" />
          <MetricCard label="Profit" value={formatCurrency(profit)} tone="good" />
          <MetricCard label="Meters Drilled" value={formatNumber(drilledMeters._sum.totalMetersDrilled || 0)} />
        </section>

        <section className="grid gap-5 lg:grid-cols-2">
          <Card title="Client Details">
            <div className="space-y-2 text-sm text-ink-700">
              <p>Contact: {client.contactPerson || "-"}</p>
              <p>Email: {client.email || "-"}</p>
              <p>Phone: {client.phone || "-"}</p>
              <p>Address: {client.address || "-"}</p>
              {client.logoUrl && (
                <img
                  src={client.logoUrl}
                  alt={`${client.name} logo`}
                  className="mt-2 h-16 w-auto rounded border border-slate-200 object-contain"
                />
              )}
            </div>
          </Card>
          <Card title="Financial Summary">
            <DataTable
              columns={["Metric", "Value"]}
              rows={[
                ["Total Revenue", formatCurrency(revenue)],
                ["Total Expenses", formatCurrency(expenses)],
                ["Profit", formatCurrency(profit)],
                ["Meters Drilled", formatNumber(drilledMeters._sum.totalMetersDrilled || 0)]
              ]}
            />
          </Card>
        </section>

        <Card title="Project List">
          <DataTable
            columns={["Project", "Status", "Location", "Assigned Rig", "Rate/m", "Start Date"]}
            rows={client.projects.map((project) => [
              <Link key={project.id} href={`/projects/${project.id}`} className="text-brand-700 underline-offset-2 hover:underline">
                {project.name}
              </Link>,
              project.status,
              project.location,
              project.assignedRig?.rigCode || "Unassigned",
              formatCurrency(project.contractRatePerM),
              project.startDate.toISOString().slice(0, 10)
            ])}
          />
        </Card>
      </div>
    </AccessGate>
  );
}
