import Link from "next/link";
import { notFound } from "next/navigation";

import { AccessGate } from "@/components/layout/access-gate";
import { ProjectProfitabilityOverview } from "@/components/modules/project-profitability-overview";
import { Card, MetricCard } from "@/components/ui/card";
import { DataTable } from "@/components/ui/table";
import {
  buildProjectDirectCostSummary,
  buildProjectOperationalKpiSummary
} from "@/lib/drilling-direct-cost-summary";
import { withFinancialDrillReportApproval } from "@/lib/financial-approval-policy";
import { prisma } from "@/lib/prisma";
import { calculateProjectRevenueFromBillableLines } from "@/lib/project-revenue-calculator";
import { buildRecognizedSpendContext } from "@/lib/recognized-spend-context";
import { formatCurrency, formatNumber } from "@/lib/utils";

export default async function ProjectWorkspacePage({
  params
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;

  const [project, approvedDrillReports, recognizedSpendContext, projectConsumablesCostAggregate] =
    await Promise.all([
      prisma.project.findUnique({
        where: { id: projectId },
        include: {
          client: true,
          billingRateItems: {
            where: {
              isActive: true
            },
            orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
            select: {
              itemCode: true,
              label: true,
              unit: true,
              unitRate: true,
              sortOrder: true,
              isActive: true
            }
          },
          assignedRig: {
            select: {
              rigCode: true
            }
          }
        }
      }),
      prisma.drillReport.findMany({
        where: withFinancialDrillReportApproval({ projectId }),
        select: {
          totalMetersDrilled: true,
          workHours: true,
          billableLines: {
            select: {
              itemCode: true,
              quantity: true,
              unit: true
            }
          }
        }
      }),
      buildRecognizedSpendContext({ projectId }),
      prisma.inventoryMovement.aggregate({
        where: {
          projectId,
          movementType: "OUT",
          contextType: "DRILLING_REPORT",
          drillReportId: {
            not: null
          }
        },
        _sum: {
          totalCost: true
        }
      })
    ]);

  if (!project) {
    notFound();
  }

  const drilledMeters = approvedDrillReports.reduce((sum, report) => sum + report.totalMetersDrilled, 0);
  const contractRate = resolveContractRate({
    perMeter: project.contractRatePerM,
    dayRate: project.contractDayRate,
    lumpSum: project.contractLumpSumValue
  });
  const lineRevenueResult = calculateProjectRevenueFromBillableLines({
    approvedReports: approvedDrillReports,
    activeRateItems: project.billingRateItems
  });
  const canUseLineRevenue = project.billingRateItems.length > 0 && lineRevenueResult.lineItems.length > 0;
  const revenue = canUseLineRevenue ? lineRevenueResult.totalRevenue : drilledMeters * contractRate;
  const cost = recognizedSpendContext.purposeTotals.recognizedSpendTotal;
  const profitLoss = revenue - cost;
  const totalWorkHours = approvedDrillReports.reduce((sum, report) => sum + report.workHours, 0);
  const directCostSummary = buildProjectDirectCostSummary({
    totalRevenue: revenue,
    totalUsedConsumablesCost: projectConsumablesCostAggregate._sum.totalCost || 0
  });
  const operationalKpis = buildProjectOperationalKpiSummary({
    totalMetersDrilled: drilledMeters,
    totalWorkHours,
    totalUsedConsumablesCost: directCostSummary.totalUsedConsumablesCost
  });

  const categoryTotals = new Map<string, number>();
  for (const expense of recognizedSpendContext.recognizedExpenses) {
    const category = expense.category?.trim() || "Other";
    categoryTotals.set(category, (categoryTotals.get(category) || 0) + expense.amount);
  }

  const costBreakdown = Array.from(categoryTotals.entries())
    .map(([label, amount]) => ({ label, amount }))
    .sort((left, right) => right.amount - left.amount);

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

        <ProjectProfitabilityOverview
          drilledMeters={drilledMeters}
          contractRate={contractRate}
          revenue={revenue}
          cost={cost}
          profitLoss={profitLoss}
          costBreakdown={costBreakdown}
          revenueBreakdown={lineRevenueResult.lineItems}
          isUsingSimpleRevenueModel={!canUseLineRevenue}
        />

        <Card title="Basic direct-cost view">
          <div className="grid gap-3 md:grid-cols-3">
            <MetricCard label="Total revenue" value={formatCurrency(directCostSummary.totalRevenue)} tone="good" />
            <MetricCard
              label="Total used consumables cost"
              value={formatCurrency(directCostSummary.totalUsedConsumablesCost)}
              tone="warn"
            />
            <MetricCard
              label="Simple result"
              value={formatCurrency(directCostSummary.simpleResult)}
              tone={directCostSummary.simpleResult >= 0 ? "good" : "danger"}
            />
          </div>
          <p className="mt-3 text-xs text-slate-600">
            Direct-cost only: includes drilling revenue and consumables used. Other project costs are not included.
          </p>
        </Card>

        <Card title="Operational KPI view">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
            <MetricCard label="Meters drilled" value={formatNumber(operationalKpis.metersDrilled)} />
            <MetricCard label="Work hours" value={formatNumber(operationalKpis.workHours)} />
            <MetricCard
              label="Meters per hour"
              value={operationalKpis.metersPerHour === null ? "—" : formatNumber(operationalKpis.metersPerHour)}
            />
            <MetricCard
              label="Consumables cost used"
              value={formatCurrency(operationalKpis.consumablesCostUsed)}
              tone="warn"
            />
            <MetricCard
              label="Consumables cost per meter"
              value={
                operationalKpis.consumablesCostPerMeter === null
                  ? "—"
                  : formatCurrency(operationalKpis.consumablesCostPerMeter)
              }
              tone="warn"
            />
          </div>
          <p className="mt-3 text-xs text-slate-600">
            Operational KPIs only: based on drilling activity and consumables used. This is not full project margin.
          </p>
        </Card>

        <Card title="Project details">
          <DataTable
            compact
            columns={["Detail", "Value"]}
            rows={[
              ["Client", project.client.name],
              ["Site / location", project.location || "-"],
              ["Assigned rig", project.assignedRig?.rigCode || "Unassigned"],
              ["Project status", project.status],
              ["Project type", formatProjectType(project.contractType)],
              ["Start date", formatDate(project.startDate)],
              ["End date", project.endDate ? formatDate(project.endDate) : "-"],
              ["Description", project.description || "-"]
            ]}
          />
        </Card>
      </div>
    </AccessGate>
  );
}

function resolveContractRate({
  perMeter,
  dayRate,
  lumpSum
}: {
  perMeter: number;
  dayRate: number | null;
  lumpSum: number | null;
}) {
  if (perMeter > 0) {
    return perMeter;
  }
  if ((dayRate || 0) > 0) {
    return dayRate || 0;
  }
  if ((lumpSum || 0) > 0) {
    return lumpSum || 0;
  }
  return 0;
}

function formatProjectType(value: "PER_METER" | "DAY_RATE" | "LUMP_SUM") {
  if (value === "PER_METER") {
    return "Per meter";
  }
  if (value === "DAY_RATE") {
    return "Day rate";
  }
  return "Lump sum";
}

function formatDate(value: Date) {
  return value.toISOString().slice(0, 10);
}
