import Link from "next/link";

import { AccessGate } from "@/components/layout/access-gate";
import { Card } from "@/components/ui/card";
import type { ProjectBudgetHealth } from "@/lib/project-budget-health";

const status = {
  ON_TRACK: { label: "On track", style: "border-emerald-200 bg-emerald-50 text-emerald-900" },
  WATCH: { label: "Watch closely", style: "border-amber-200 bg-amber-50 text-amber-900" },
  AT_RISK: { label: "At risk", style: "border-rose-200 bg-rose-50 text-rose-900" },
  INSUFFICIENT: { label: "Not enough information", style: "border-slate-200 bg-slate-50 text-slate-800" }
} as const;

const number = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
const percent = new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 1 });
const money = (amount: number, currency = "USD") =>
  `${currency} ${number.format(amount)}`;

export function ProjectBudgetHealthCard({ health, projectId, categories }: {
  health: ProjectBudgetHealth;
  projectId: string;
  categories: Array<{ category: string; total: number }>;
}) {
  const selected = status[health.verdict];
  const project = encodeURIComponent(projectId);
  const scope = `workspace=project&projectId=${project}&from=&to=`;
  const spending = `/spending?${scope}`;
  const largest = categories.slice(0, 3).filter(({ total }) => total > 0);
  const action = {
    expenses: { href: "#project-largest-expenses", label: "Review largest posted expenses" },
    drilling: { href: `${spending}&view=drilling-reports`, label: "Review drilling reports" },
    reports: { href: `/reports?${scope}`, label: "Open project reports" },
    setup: { href: `/projects/setup?editProjectId=${project}`, label: "Review project setup" }
  }[health.followUp];
  const link = <Link href={action.href} className="gf-btn-secondary">{action.label}</Link>;

  return (
    <Card title="Budget Health" subtitle="Whole project · Posted results and an advisory spending check">
      <div className={`rounded-xl border p-3 sm:p-4 ${selected.style}`}>
        <p className="text-xs font-bold uppercase tracking-wide">{selected.label}</p>
        <h3 className="mt-1 text-lg font-semibold">{health.headline}</h3>
        <p className="mt-1 text-sm">{health.why}</p>
        {health.periodOverrun && <p className="mt-2 text-sm font-semibold">
          {money(health.periodOverrun.posted)} posted during the budget period, {money(health.periodOverrun.excess)} over plan.
        </p>}
      </div>

      <dl className="my-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric label="Active budget" value={health.plan ? money(health.plan.amount, health.plan.currency) : "Not confirmed"}
          hint={health.plan ? `${health.plan.periodStart} to ${health.plan.periodEnd}` : undefined} />
        <Metric label="Posted expenses" value={money(health.actual)}
          hint={health.budgetUsed === null ? undefined : `${percent.format(health.budgetUsed)} of budget used`} />
        <Metric label="Approved drilling" value={`${number.format(health.approvedMeters)} m`}
          hint={health.progress === null || health.plannedMeters === null ? "No meter target"
            : `${percent.format(health.progress)} of ${number.format(health.plannedMeters)} m planned`} />
        <Metric label="Budget left after posting" value={health.remainingBudget === null ? "Not comparable" : money(health.remainingBudget)} />
      </dl>

      <div className="space-y-2 border-t border-slate-200 pt-3">
        <p className="text-sm text-ink-800"><strong>Next step:</strong> {health.next}</p>
        {health.followUp === "setup" ? <AccessGate permission="projects:manage"
          fallback={<p className="text-sm text-ink-600">Ask a project manager to verify setup.</p>}>{link}</AccessGate> : link}
        {largest.length > 0 && (
          <div className="pt-1">
            <p className="text-xs font-semibold text-ink-700">Largest posted cost categories</p>
            <ul className="mt-1 flex flex-wrap gap-2">
              {largest.map(({ category, total }) => (
                <li key={category} className="rounded-md border border-slate-200 px-2 py-1.5 text-xs text-ink-800">
                  {category}: {money(total)}
                </li>
              ))}
            </ul>
          </div>
        )}
        {health.paceEstimate !== null && <p className="text-sm text-ink-700">
          <strong>At the current cost per meter:</strong> about {money(health.paceEstimate)} at the meter target. This is a straight-line estimate, not a forecast.
        </p>}
        <p className="text-xs text-ink-600">This check excludes unposted commitments, unrecorded costs, and the timing of mobilization. Progress uses the meter target in Project Setup.</p>
      </div>
    </Card>
  );
}

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg bg-slate-50 px-3 py-2">
      <dt className="text-xs font-medium text-ink-600">{label}</dt>
      <dd className="mt-1 font-semibold tabular-nums text-ink-900">{value}</dd>
      {hint && <dd className="mt-1 text-xs text-ink-600">{hint}</dd>}
    </div>
  );
}
