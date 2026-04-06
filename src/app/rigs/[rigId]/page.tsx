import Link from "next/link";
import { notFound } from "next/navigation";

import { AccessGate } from "@/components/layout/access-gate";
import { Card, MetricCard } from "@/components/ui/card";
import { DataTable } from "@/components/ui/table";
import { normalizeBreakdownStatus } from "@/lib/breakdown-lifecycle";
import { prisma } from "@/lib/prisma";
import {
  parsePurchaseRequisitionPayload,
  PURCHASE_REQUISITION_REPORT_TYPE,
  requisitionTypeLabel,
  type RequisitionStatus,
  type RequisitionType
} from "@/lib/requisition-workflow";
import { formatCurrency, formatNumber, formatPercent } from "@/lib/utils";

interface LinkedRequisitionRow {
  id: string;
  requisitionCode: string;
  status: RequisitionStatus;
  type: RequisitionType;
  submittedAt: string;
  estimatedTotalCost: number;
  projectId: string | null;
}

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

  const [
    currentProject,
    maintenanceHistory,
    breakdownHistory,
    inventoryUsageHistory,
    rigUsageHistory,
    requisitionSummaryRows,
    revenueAgg,
    expenseAgg,
    metersAgg
  ] = await Promise.all([
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
      take: 20,
      select: {
        id: true,
        requestCode: true,
        requestDate: true,
        issueDescription: true,
        maintenanceType: true,
        status: true,
        estimatedDowntimeHrs: true,
        breakdownReportId: true,
        breakdownReport: {
          select: {
            id: true,
            title: true
          }
        },
        project: {
          select: {
            id: true,
            name: true
          }
        }
      }
    }),
    prisma.breakdownReport.findMany({
      where: { rigId },
      orderBy: { reportDate: "desc" },
      take: 20,
      select: {
        id: true,
        reportDate: true,
        title: true,
        severity: true,
        downtimeHours: true,
        status: true,
        project: {
          select: {
            id: true,
            name: true
          }
        },
        client: {
          select: {
            name: true
          }
        }
      }
    }),
    prisma.inventoryUsageRequest.findMany({
      where: { rigId },
      orderBy: { createdAt: "desc" },
      take: 25,
      include: {
        item: {
          select: {
            id: true,
            name: true,
            sku: true
          }
        },
        project: {
          select: {
            id: true,
            name: true
          }
        },
        maintenanceRequest: {
          select: {
            id: true,
            requestCode: true
          }
        },
        breakdownReport: {
          select: {
            id: true,
            title: true
          }
        },
        requestedBy: {
          select: {
            id: true,
            fullName: true
          }
        },
        decidedBy: {
          select: {
            id: true,
            fullName: true
          }
        }
      }
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
    prisma.summaryReport.findMany({
      where: {
        reportType: PURCHASE_REQUISITION_REPORT_TYPE
      },
      orderBy: [{ reportDate: "desc" }, { createdAt: "desc" }],
      take: 300,
      select: {
        id: true,
        projectId: true,
        payloadJson: true
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

  const linkedRequisitions: LinkedRequisitionRow[] = requisitionSummaryRows
    .map((row) => {
      const parsed = parsePurchaseRequisitionPayload(row.payloadJson);
      if (!parsed || parsed.payload.context.rigId !== rigId) {
        return null;
      }

      return {
        id: row.id,
        requisitionCode: parsed.payload.requisitionCode,
        status: parsed.payload.status,
        type: parsed.payload.type,
        submittedAt: parsed.payload.submittedAt,
        estimatedTotalCost: parsed.payload.totals.estimatedTotalCost,
        projectId: parsed.payload.context.projectId || row.projectId
      };
    })
    .filter((entry): entry is LinkedRequisitionRow => Boolean(entry))
    .slice(0, 20);

  const requisitionProjectIds = Array.from(
    new Set(
      linkedRequisitions
        .map((entry) => entry.projectId)
        .filter((value): value is string => Boolean(value))
    )
  );
  const requisitionProjects =
    requisitionProjectIds.length > 0
      ? await prisma.project.findMany({
          where: { id: { in: requisitionProjectIds } },
          select: { id: true, name: true }
        })
      : [];
  const requisitionProjectNameById = new Map(
    requisitionProjects.map((project) => [project.id, project.name])
  );

  const revenue = revenueAgg._sum.amount || 0;
  const expenses = expenseAgg._sum.amount || 0;
  const profit = revenue - expenses;
  const utilization =
    rig.totalLifetimeDays > 0
      ? (rig.totalHoursWorked / (rig.totalLifetimeDays * 24)) * 100
      : 0;

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
          <Link
            href="/rigs"
            className="text-sm text-brand-700 underline-offset-2 hover:underline"
          >
            Back to rigs
          </Link>
        </section>

        <section className="grid gap-3 md:grid-cols-3 lg:grid-cols-6">
          <MetricCard label="Status" value={rig.status} />
          <MetricCard label="Condition" value={rig.condition} />
          <MetricCard label="Condition Score" value={`${rig.conditionScore}/100`} />
          <MetricCard
            label="Current Project"
            value={currentProject?.name || "Unassigned"}
          />
          <MetricCard
            label="Current Client"
            value={currentProject?.client?.name || "Unassigned"}
          />
          <MetricCard
            label="Acquisition Date"
            value={rig.acquisitionDate ? rig.acquisitionDate.toISOString().slice(0, 10) : "-"}
          />
          <MetricCard label="Total Hours" value={formatNumber(rig.totalHoursWorked)} />
          <MetricCard
            label="Lifetime Days"
            value={formatNumber(rig.totalLifetimeDays)}
          />
          <MetricCard
            label="Total Meters"
            value={formatNumber(metersAgg._sum.totalMetersDrilled || 0)}
          />
          <MetricCard label="Revenue" value={formatCurrency(revenue)} tone="good" />
          <MetricCard label="Expenses" value={formatCurrency(expenses)} tone="warn" />
          <MetricCard
            label="Profitability"
            value={formatCurrency(profit)}
            tone={profit >= 0 ? "good" : "danger"}
          />
        </section>

        <section className="grid gap-5 lg:grid-cols-2">
          <Card title="Operational Profile">
            <div className="space-y-2 text-sm text-ink-700">
              <p>Utilization rate: {formatPercent(utilization)}</p>
              <p>Total hours worked: {formatNumber(rig.totalHoursWorked)}</p>
              <p>
                Total meters drilled: {formatNumber(metersAgg._sum.totalMetersDrilled || 0)}
              </p>
              <p>
                Current assignment: {currentProject?.name || "No active assignment"}
              </p>
              {rig.photoUrl && (
                // eslint-disable-next-line @next/next/no-img-element
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
          {maintenanceHistory.length === 0 ? (
            <p className="text-sm text-slate-600">No maintenance records linked to this rig.</p>
          ) : (
            <DataTable
              columns={[
                "Request",
                "Date",
                "Issue",
                "Project",
                "Status",
                "Downtime",
                "Linked Breakdown"
              ]}
              rows={maintenanceHistory.map((request) => [
                request.requestCode,
                request.requestDate.toISOString().slice(0, 10),
                request.maintenanceType
                  ? `${formatMaintenanceTypeLabel(request.maintenanceType)} • ${request.issueDescription}`
                  : request.issueDescription,
                request.project?.name || "-",
                formatMaintenanceStatusLabel(request.status),
                `${formatNumber(request.estimatedDowntimeHrs)} hrs`,
                request.breakdownReport?.title || request.breakdownReportId || "-"
              ])}
            />
          )}
        </Card>

        <Card title="Breakdown History">
          {breakdownHistory.length === 0 ? (
            <p className="text-sm text-slate-600">No breakdown records linked to this rig.</p>
          ) : (
            <DataTable
              columns={[
                "Date",
                "Issue",
                "Project",
                "Client",
                "Severity",
                "Downtime",
                "Status"
              ]}
              rows={breakdownHistory.map((entry) => [
                entry.reportDate.toISOString().slice(0, 10),
                entry.title,
                entry.project?.name || "-",
                entry.client?.name || "-",
                entry.severity,
                `${formatNumber(entry.downtimeHours)} hrs`,
                normalizeBreakdownStatus(entry.status)
              ])}
            />
          )}
        </Card>

        <Card title="Inventory Usage Requests">
          {inventoryUsageHistory.length === 0 ? (
            <p className="text-sm text-slate-600">
              No inventory usage requests linked to this rig.
            </p>
          ) : (
            <DataTable
              columns={[
                "Requested",
                "Item",
                "Qty",
                "Reason",
                "Project",
                "Maintenance",
                "Status",
                "Decision"
              ]}
              rows={inventoryUsageHistory.map((entry) => {
                const reasonPrefix =
                  entry.maintenanceRequestId
                    ? "Maintenance"
                    : entry.breakdownReportId
                      ? "Breakdown"
                      : "Other";
                const reasonDetails = entry.reason || "Operational usage";
                const breakdownLabel =
                  entry.breakdownReport?.title
                    ? ` • ${entry.breakdownReport.title}`
                    : entry.breakdownReportId
                      ? ` • Breakdown ${entry.breakdownReportId.slice(0, 8)}`
                    : "";
                const decisionLabel =
                  entry.status === "APPROVED"
                    ? `Approved ${
                        entry.decidedAt ? entry.decidedAt.toISOString().slice(0, 10) : ""
                      }${entry.decidedBy ? ` by ${entry.decidedBy.fullName}` : ""}`
                    : entry.status === "REJECTED"
                      ? `Rejected${entry.decisionNote ? `: ${entry.decisionNote}` : ""}`
                      : "Pending review";

                return [
                  entry.createdAt.toISOString().slice(0, 10),
                  entry.item ? `${entry.item.name} (${entry.item.sku})` : "-",
                  formatNumber(entry.quantity),
                  `${reasonPrefix}: ${reasonDetails}${breakdownLabel}`,
                  entry.project?.name || "-",
                  entry.maintenanceRequest?.requestCode || "-",
                  entry.status,
                  decisionLabel
                ];
              })}
            />
          )}
        </Card>

        <Card title="Linked Purchase Requests">
          {linkedRequisitions.length === 0 ? (
            <p className="text-sm text-slate-600">
              No purchase requests currently linked to this rig context.
            </p>
          ) : (
            <DataTable
              columns={[
                "Requisition",
                "Type",
                "Status",
                "Submitted",
                "Project",
                "Estimated Total"
              ]}
              rows={linkedRequisitions.map((entry) => [
                entry.requisitionCode,
                requisitionTypeLabel(entry.type),
                entry.status,
                entry.submittedAt.slice(0, 10),
                entry.projectId ? requisitionProjectNameById.get(entry.projectId) || entry.projectId : "-",
                formatCurrency(entry.estimatedTotalCost)
              ])}
            />
          )}
        </Card>

        <Card title="Rig Assignment History">
          <DataTable
            columns={[
              "Project",
              "Client",
              "Start Date",
              "End Date",
              "Usage Days",
              "Usage Hours"
            ]}
            rows={rigUsageHistory.map((usage) => [
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

function formatMaintenanceStatusLabel(status: string) {
  const normalized = status.trim().toUpperCase();
  if (normalized === "OPEN") return "Open";
  if (normalized === "IN_REPAIR") return "In repair";
  if (normalized === "WAITING_FOR_PARTS") return "Waiting for parts";
  if (normalized === "COMPLETED") return "Completed";
  return "Open";
}

function formatMaintenanceTypeLabel(value: string | null | undefined) {
  const normalized = (value || "").trim().toUpperCase();
  if (normalized === "ROUTINE_MAINTENANCE") return "Routine Maintenance";
  if (normalized === "INSPECTION_CHECK") return "Inspection / Check";
  if (normalized === "PREVENTIVE_SERVICE") return "Preventive Service";
  if (normalized === "OTHER") return "Other";
  return value || "Maintenance";
}
