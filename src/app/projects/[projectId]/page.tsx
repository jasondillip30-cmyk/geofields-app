import Link from "next/link";
import { notFound } from "next/navigation";

import { AccessGate } from "@/components/layout/access-gate";
import { Card } from "@/components/ui/card";
import { DataTable } from "@/components/ui/table";
import { formatCurrency } from "@/lib/utils";
import { prisma } from "@/lib/prisma";

type ContractType = "PER_METER" | "DAY_RATE" | "LUMP_SUM";

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
      assignedRig: {
        select: {
          rigCode: true
        }
      },
      backupRig: {
        select: {
          rigCode: true
        }
      },
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
          drillingStageLabel: true,
          depthBandStartM: true,
          depthBandEndM: true
        }
      }
    }
  });

  if (!project) {
    notFound();
  }

  const spendingHref = `/spending?projectId=${encodeURIComponent(project.id)}`;
  const drillingReportsHref = `/spending?view=drilling-reports&projectId=${encodeURIComponent(project.id)}`;

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
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={spendingHref}
              className="rounded-md border border-slate-200 px-3 py-1.5 text-sm font-medium text-ink-700 hover:bg-slate-50"
            >
              Open Spending
            </Link>
            <Link
              href={drillingReportsHref}
              className="rounded-md border border-slate-200 px-3 py-1.5 text-sm font-medium text-ink-700 hover:bg-slate-50"
            >
              Open Drilling reports
            </Link>
            <AccessGate permission="projects:manage">
              <Link
                href={`/projects/setup?projectId=${project.id}`}
                className="rounded-md border border-brand-200 bg-brand-50 px-3 py-1.5 text-sm font-medium text-brand-800 hover:bg-brand-100"
              >
                Edit project setup
              </Link>
            </AccessGate>
            <Link href="/projects" className="text-sm text-brand-700 underline-offset-2 hover:underline">
              Back to projects
            </Link>
          </div>
        </section>

        <Card title="Project details">
          <DataTable
            compact
            columns={["Detail", "Value"]}
            rows={[
              ["Project", project.name],
              ["Client", project.client.name],
              ["Site / location", project.location || "-"],
              ["Project status", formatStatus(project.status)],
              ["Assigned rig", project.assignedRig?.rigCode || "Unassigned"],
              ["Backup rig", project.backupRig?.rigCode || "Unassigned"],
              ["Project type", formatProjectType(project.contractType)],
              ["Contract rate", formatContractRate(project)],
              ["Start date", formatDate(project.startDate)],
              ["End date", project.endDate ? formatDate(project.endDate) : "-"],
              ["Description", project.description || "-"]
            ]}
          />
        </Card>

        <Card title="Active billing setup">
          {project.billingRateItems.length > 0 ? (
            <DataTable
              compact
              columns={["Line", "Stage / Depth", "Unit", "Rate"]}
              rows={project.billingRateItems.map((line) => [
                line.label || line.itemCode,
                formatStageDepth(line.drillingStageLabel, line.depthBandStartM, line.depthBandEndM),
                line.unit,
                formatCurrency(line.unitRate)
              ])}
            />
          ) : (
            <p className="text-sm text-ink-600">
              No active billing lines are configured for this project yet.
            </p>
          )}
        </Card>
      </div>
    </AccessGate>
  );
}

function formatProjectType(value: ContractType) {
  if (value === "PER_METER") {
    return "Per meter";
  }
  if (value === "DAY_RATE") {
    return "Day rate";
  }
  return "Lump sum";
}

function formatContractRate(project: {
  contractType: ContractType;
  contractRatePerM: number;
  contractDayRate: number | null;
  contractLumpSumValue: number | null;
}) {
  if (project.contractType === "PER_METER") {
    return `${formatCurrency(project.contractRatePerM)} / meter`;
  }
  if (project.contractType === "DAY_RATE") {
    return `${formatCurrency(project.contractDayRate || 0)} / day`;
  }
  return formatCurrency(project.contractLumpSumValue || 0);
}

function formatStageDepth(stageLabel: string | null, startM: number | null, endM: number | null) {
  const cleanedStage = stageLabel?.trim() || "";
  const hasBand = Number.isFinite(startM) || Number.isFinite(endM);
  if (!cleanedStage && !hasBand) {
    return "—";
  }
  if (cleanedStage && hasBand) {
    return `${cleanedStage} • ${formatDepthBand(startM, endM)}`;
  }
  if (cleanedStage) {
    return cleanedStage;
  }
  return formatDepthBand(startM, endM);
}

function formatDepthBand(startM: number | null, endM: number | null) {
  const start = Number.isFinite(startM) ? Number(startM) : null;
  const end = Number.isFinite(endM) ? Number(endM) : null;
  if (start === null && end === null) {
    return "—";
  }
  if (start !== null && end !== null) {
    return `${start}-${end}m`;
  }
  if (start !== null) {
    return `${start}m+`;
  }
  return `Up to ${end}m`;
}

function formatStatus(value: string) {
  return value
    .toLowerCase()
    .split("_")
    .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : part))
    .join(" ");
}

function formatDate(value: Date) {
  return value.toISOString().slice(0, 10);
}
