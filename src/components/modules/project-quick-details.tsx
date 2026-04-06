import { Card } from "@/components/ui/card";
import { DataTable } from "@/components/ui/table";
import type { ProjectJobLedgerSnapshot } from "@/lib/project-job-ledger";
import { formatCurrency, formatPercent } from "@/lib/utils";

interface ProjectQuickDetailsProps {
  ledger: ProjectJobLedgerSnapshot;
}

export function ProjectQuickDetails({ ledger }: ProjectQuickDetailsProps) {
  const topCaution = ledger.riskSignals[0]?.title || null;
  const explanation = buildProfitExplanation(ledger, topCaution);

  return (
    <details className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <summary className="cursor-pointer text-sm font-semibold text-ink-900">
        Project Quick Details
      </summary>
      <p className="mt-2 text-xs text-ink-600">
        Money flow and cost context for this project. Expanded only when you need more detail.
      </p>

      <div className="mt-3 grid gap-3 lg:grid-cols-3">
        <Card title="Money Flow">
          <DataTable
            compact
            columns={["Field", "Value"]}
            rows={[
              ["Earned revenue", formatCurrency(ledger.revenueRealization.earnedRevenue)],
              ["Invoiced revenue", formatCurrency(ledger.revenueRealization.invoicedRevenue)],
              ["Collected revenue", formatCurrency(ledger.revenueRealization.collectedRevenue)],
              ["Outstanding revenue", formatCurrency(ledger.revenueRealization.outstandingRevenue)],
              [
                "Uninvoiced earned",
                formatCurrency(ledger.revenueRealization.uninvoicedEarnedRemainder)
              ],
              [
                "Overbilling / advance",
                formatCurrency(ledger.revenueRealization.overbillingAdvanceAmount)
              ]
            ]}
          />
        </Card>

        <Card title="Cost Overview">
          <DataTable
            compact
            columns={["Layer", "Known Cost"]}
            rows={[
              ["Recognized operational cost", formatCurrency(ledger.recognizedOperationalCost)],
              ["Labor cost", formatCurrency(ledger.laborCost)],
              ["Rig cost", formatCurrency(ledger.rigCost)],
              ["Fuel attributed", formatCurrency(ledger.operatingAttribution.fuelAttributedCost)],
              [
                "Consumables attributed",
                formatCurrency(ledger.operatingAttribution.consumablesAttributedCost)
              ],
              [
                "Unattributed operating",
                formatCurrency(ledger.operatingAttribution.unattributedOperatingCost)
              ],
              ["Total known project cost", formatCurrency(ledger.totalProjectCostKnown)]
            ]}
          />
        </Card>

        <Card title="Profit Explanation">
          <p className="text-sm text-ink-800">{explanation}</p>
        </Card>
      </div>
    </details>
  );
}

function buildProfitExplanation(ledger: ProjectJobLedgerSnapshot, topCaution: string | null) {
  const direction =
    ledger.currentProfitLoss >= 0 ? "currently profitable" : "currently loss-making";
  const coverageKnown =
    ledger.costCoverageStatus === "KNOWN" && ledger.revenueRealization.coverageStatus === "KNOWN";
  const marginText =
    ledger.marginPercent !== null ? formatPercent(ledger.marginPercent) : "not yet derivable";
  const base = `This project is ${direction} with a known margin of ${marginText}. We are comparing earned revenue of ${formatCurrency(
    ledger.earnedRevenue
  )} against known project cost of ${formatCurrency(ledger.totalProjectCostKnown)}.`;
  const coverage = coverageKnown
    ? "Coverage is known across both cost and revenue realization."
    : "Coverage is partial, so treat the current margin as directional.";
  const caution = topCaution ? `Main caution: ${topCaution}.` : "";
  return [base, coverage, caution].filter(Boolean).join(" ");
}
