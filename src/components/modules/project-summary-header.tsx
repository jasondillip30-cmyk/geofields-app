import Link from "next/link";

import { Card } from "@/components/ui/card";
import type { ProjectJobLedgerSnapshot, ProjectLedgerRiskSignal } from "@/lib/project-job-ledger";
import { formatCurrency, formatPercent } from "@/lib/utils";

interface ProjectSummaryHeaderProps {
  ledger: ProjectJobLedgerSnapshot;
}

const SIGNAL_PRIORITY: Record<ProjectLedgerRiskSignal["level"], number> = {
  critical: 3,
  warn: 2,
  info: 1
};

export function ProjectSummaryHeader({ ledger }: ProjectSummaryHeaderProps) {
  const topSignals = [...ledger.riskSignals]
    .sort((left, right) => SIGNAL_PRIORITY[right.level] - SIGNAL_PRIORITY[left.level])
    .slice(0, 4);
  const profitable = ledger.currentProfitLoss >= 0;
  const coverageKnown =
    ledger.costCoverageStatus === "KNOWN" && ledger.revenueRealization.coverageStatus === "KNOWN";

  return (
    <section className="grid gap-3 lg:grid-cols-3">
      <Card title="Profit Status" subtitle="Is this project currently making money?">
        <p className={`text-2xl font-semibold ${profitable ? "text-emerald-700" : "text-rose-700"}`}>
          {formatCurrency(ledger.currentProfitLoss)}
        </p>
        <p className="mt-1 text-sm text-ink-700">
          Margin: {ledger.marginPercent !== null ? formatPercent(ledger.marginPercent) : "N/A"} •{" "}
          {profitable ? "Currently profitable" : "Currently loss-making"}
        </p>
        <p className="mt-2 text-xs text-ink-600">
          Based on earned revenue versus known project cost layers.
        </p>
      </Card>

      <Card title="Cash Reality" subtitle="How much earned revenue has become cash?">
        <p className="text-2xl font-semibold text-ink-900">
          {formatCurrency(ledger.revenueRealization.collectedRevenue)}
        </p>
        <p className="mt-1 text-sm text-ink-700">
          Collected • {formatCurrency(ledger.revenueRealization.outstandingRevenue)} outstanding
        </p>
        <p className="mt-2 text-xs text-ink-600">
          Invoiced: {formatCurrency(ledger.revenueRealization.invoicedRevenue)} • Uninvoiced earned:{" "}
          {formatCurrency(ledger.revenueRealization.uninvoicedEarnedRemainder)}
        </p>
      </Card>

      <Card title="Risk Snapshot" subtitle="Top risks affecting margin trust right now.">
        {topSignals.length === 0 ? (
          <p className="text-sm text-ink-700">No major margin-risk signals detected.</p>
        ) : (
          <ul className="space-y-1.5">
            {topSignals.map((signal, index) => (
              <li key={`project-top-signal-${index}`} className="text-sm text-ink-800">
                <span
                  className={`mr-2 inline-flex rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase ${
                    signal.level === "critical"
                      ? "bg-rose-100 text-rose-800"
                      : signal.level === "warn"
                        ? "bg-amber-100 text-amber-800"
                        : "bg-slate-100 text-slate-700"
                  }`}
                >
                  {signal.level}
                </span>
                {signal.title}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-xs text-ink-600">
          Coverage: {coverageKnown ? "Known" : "Partial"} • See full risk detail in{" "}
          <Link href="#project-tabs" className="text-brand-700 underline-offset-2 hover:underline">
            Ledger tab
          </Link>
          .
        </p>
      </Card>
    </section>
  );
}
