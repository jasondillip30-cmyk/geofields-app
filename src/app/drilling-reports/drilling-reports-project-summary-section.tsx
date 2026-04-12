"use client";

import { Card, MetricCard } from "@/components/ui/card";
import { formatCurrency, formatNumber } from "@/lib/utils";
import {
  SummaryItem,
  formatProjectStatus
} from "./drilling-reports-page-utils";
import type { DrillStats, ProjectOption } from "./drilling-reports-page-types";

interface BillingSummaryValue {
  label: string;
  value: string;
}

interface ProjectDirectCostSummary {
  totalRevenue: number;
  totalUsedConsumablesCost: number;
  simpleResult: number;
}

interface ProjectOperationalKpiSummary {
  metersDrilled: number;
  workHours: number;
  metersPerHour: number | null;
  consumablesCostUsed: number;
  consumablesCostPerMeter: number | null;
}

interface DrillingReportsProjectSummarySectionProps {
  selectedProject: ProjectOption | null;
  selectedProjectRigsLabel: string;
  selectedProjectBillingSummary: BillingSummaryValue;
  selectedProjectDirectCostSummary: ProjectDirectCostSummary;
  selectedProjectOperationalKpis: ProjectOperationalKpiSummary;
  stats: DrillStats;
}

export function DrillingReportsProjectSummarySection(
  props: DrillingReportsProjectSummarySectionProps
) {
  const {
    selectedProject,
    selectedProjectRigsLabel,
    selectedProjectBillingSummary,
    selectedProjectDirectCostSummary,
    selectedProjectOperationalKpis,
    stats
  } = props;

  return (
    <section id="drilling-project-summary-section" className="hidden">
      <Card
        title={selectedProject ? `${selectedProject.name} Overview` : "Project Overview"}
        subtitle="Current project activity and operational KPIs"
      >
        {!selectedProject ? (
          <p className="text-sm text-ink-600">Select a project to view drilling activity.</p>
        ) : (
          <div className="space-y-4">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <SummaryItem label="Client" value={selectedProject.client.name} />
              <SummaryItem label="Assigned Rig(s)" value={selectedProjectRigsLabel} />
              <SummaryItem label="Project Status" value={formatProjectStatus(selectedProject.status)} />
              <SummaryItem label={selectedProjectBillingSummary.label} value={selectedProjectBillingSummary.value} />
            </div>

            <section className="grid gap-3 md:grid-cols-4">
              <MetricCard label="Total Meters Drilled" value={formatNumber(stats.totalMeters)} />
              <MetricCard label="Total Reports" value={String(stats.reportsLogged)} />
              <MetricCard label="Total Billable" value={formatCurrency(stats.billableActivity)} tone="good" />
              <MetricCard label="Average Work Hours" value={formatNumber(stats.averageWorkHours)} />
            </section>

            <section className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Basic direct-cost view
              </p>
              <div className="mt-2 grid gap-3 md:grid-cols-3">
                <MetricCard
                  label="Total revenue"
                  value={formatCurrency(selectedProjectDirectCostSummary.totalRevenue)}
                  tone="good"
                />
                <MetricCard
                  label="Total used consumables cost"
                  value={formatCurrency(selectedProjectDirectCostSummary.totalUsedConsumablesCost)}
                  tone="warn"
                />
                <MetricCard
                  label="Simple result"
                  value={formatCurrency(selectedProjectDirectCostSummary.simpleResult)}
                  tone={selectedProjectDirectCostSummary.simpleResult >= 0 ? "good" : "danger"}
                />
              </div>
              <p className="mt-2 text-xs text-slate-600">
                Direct-cost only: includes drilling revenue and consumables used. Other project costs are not included.
              </p>
            </section>

            <section className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Operational KPI view
              </p>
              <div className="mt-2 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                <MetricCard label="Meters drilled" value={formatNumber(selectedProjectOperationalKpis.metersDrilled)} />
                <MetricCard label="Work hours" value={formatNumber(selectedProjectOperationalKpis.workHours)} />
                <MetricCard
                  label="Meters per hour"
                  value={
                    selectedProjectOperationalKpis.metersPerHour === null
                      ? "—"
                      : formatNumber(selectedProjectOperationalKpis.metersPerHour)
                  }
                />
                <MetricCard
                  label="Consumables cost used"
                  value={formatCurrency(selectedProjectOperationalKpis.consumablesCostUsed)}
                  tone="warn"
                />
                <MetricCard
                  label="Consumables cost per meter"
                  value={
                    selectedProjectOperationalKpis.consumablesCostPerMeter === null
                      ? "—"
                      : formatCurrency(selectedProjectOperationalKpis.consumablesCostPerMeter)
                  }
                  tone="warn"
                />
              </div>
              <p className="mt-2 text-xs text-slate-600">
                Operational KPIs only: based on drilling activity and consumables used. This is not full project margin.
              </p>
            </section>
          </div>
        )}
      </Card>
    </section>
  );
}
