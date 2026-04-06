import { Card, MetricCard } from "@/components/ui/card";
import { DataTable } from "@/components/ui/table";
import type { ProjectJobLedgerSnapshot } from "@/lib/project-job-ledger";
import { formatCurrency, formatPercent } from "@/lib/utils";

interface ProjectJobLedgerPanelProps {
  ledger: ProjectJobLedgerSnapshot;
}

export function ProjectJobLedgerPanel({ ledger }: ProjectJobLedgerPanelProps) {
  const partialCoverage = ledger.costCoverageStatus === "PARTIAL";
  const partialOperatingAttribution =
    ledger.operatingAttribution.operatingCostBase > 0 && ledger.operatingAttribution.isPartialAttribution;
  const partialRealizationCoverage = ledger.revenueRealization.coverageStatus === "PARTIAL";

  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-lg font-semibold text-ink-900">Project Job Ledger</h3>
        <p className="text-sm text-ink-600">
          Unified project profitability view from earned revenue and known project cost layers.
        </p>
      </div>

      <div
        className={`rounded-lg border px-3 py-2 text-xs ${
          partialCoverage
            ? "border-amber-200 bg-amber-50 text-amber-900"
            : "border-emerald-200 bg-emerald-50 text-emerald-900"
        }`}
      >
        <p className="font-semibold">
          Coverage: {partialCoverage ? "Partial (Known / Partial coverage)" : "Known"}
        </p>
        <p className="mt-1">{ledger.costCoverageNote}</p>
      </div>

      <div
        className={`rounded-lg border px-3 py-2 text-xs ${
          partialOperatingAttribution
            ? "border-amber-200 bg-amber-50 text-amber-900"
            : "border-emerald-200 bg-emerald-50 text-emerald-900"
        }`}
      >
        <p className="font-semibold">
          Operating Attribution Coverage:{" "}
          {partialOperatingAttribution ? "Partial (Known / Partial coverage)" : "Known"}
        </p>
        <p className="mt-1">
          {partialOperatingAttribution
            ? "Some recognized operating cost is intentionally left unattributed because fuel/consumables confidence is insufficient."
            : "Recognized operating cost in scope is fully attributed across fuel and consumables in this phase model."}
        </p>
      </div>

      <div
        className={`rounded-lg border px-3 py-2 text-xs ${
          partialRealizationCoverage
            ? "border-amber-200 bg-amber-50 text-amber-900"
            : "border-emerald-200 bg-emerald-50 text-emerald-900"
        }`}
      >
        <p className="font-semibold">
          Revenue Realization Coverage:{" "}
          {partialRealizationCoverage ? "Partial (Known / Partial coverage)" : "Known"}
        </p>
        <p className="mt-1">{ledger.revenueRealization.coverageNote}</p>
      </div>

      <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-7">
        <MetricCard label="Earned Revenue" value={formatCurrency(ledger.earnedRevenue)} tone="good" />
        <MetricCard
          label="Recognized Cost (Known)"
          value={formatCurrency(ledger.recognizedOperationalCost)}
          tone="warn"
        />
        <MetricCard label="Labor Cost (Known)" value={formatCurrency(ledger.laborCost)} tone="warn" />
        <MetricCard label="Rig Cost (Known)" value={formatCurrency(ledger.rigCost)} tone="warn" />
        <MetricCard
          label="Total Project Cost (Known)"
          value={formatCurrency(ledger.totalProjectCostKnown)}
          tone="warn"
        />
        <MetricCard
          label="Current Profit / Loss (Known)"
          value={formatCurrency(ledger.currentProfitLoss)}
          tone={ledger.currentProfitLoss >= 0 ? "good" : "danger"}
        />
        <MetricCard
          label="Margin % (Known)"
          value={ledger.marginPercent !== null ? formatPercent(ledger.marginPercent) : "N/A"}
          tone={
            ledger.marginPercent === null ? "neutral" : ledger.marginPercent >= 0 ? "good" : "danger"
          }
        />
        <MetricCard
          label="Adjusted Contract Value"
          value={
            ledger.adjustedContractValue !== null
              ? formatCurrency(ledger.adjustedContractValue)
              : "Variable"
          }
        />
        <MetricCard
          label="Remaining Revenue"
          value={
            ledger.remainingRevenue !== null ? formatCurrency(ledger.remainingRevenue) : "Not derivable"
          }
        />
        <MetricCard
          label="Progress"
          value={ledger.progressPercent !== null ? formatPercent(ledger.progressPercent) : "-"}
          change={progressBasisLabel(ledger.progressBasis)}
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <Card title="Known Cost Layers" subtitle="Known layers included in current project cost truth.">
          <DataTable
            columns={["Layer", "Known Cost", "% of Total Known Cost"]}
            rows={ledger.costLayerBuckets.map((bucket) => [
              bucket.label,
              formatCurrency(bucket.knownCost),
              formatPercent(bucket.percentOfTotalKnownCost)
            ])}
          />
        </Card>

        <Card
          title="Recognized Cost Drivers"
          subtitle="Operational purpose composition inside recognized operational cost."
        >
          <DataTable
            columns={["Bucket", "Recognized Cost", "% of Recognized Operational Cost"]}
            rows={ledger.costBuckets.map((bucket) => [
              bucket.label,
              formatCurrency(bucket.recognizedCost),
              formatPercent(bucket.percentOfRecognizedOperationalCost)
            ])}
          />
        </Card>

        <Card title="Commercial Context">
          <DataTable
            columns={["Field", "Value"]}
            rows={[
              ["Contract type", ledger.contractTypeLabel],
              [
                "Base contract value",
                ledger.baseContractValue !== null ? formatCurrency(ledger.baseContractValue) : "Not derivable"
              ],
              [
                "Change-order-adjusted value",
                ledger.adjustedContractValue !== null
                  ? formatCurrency(ledger.adjustedContractValue)
                  : "Not derivable"
              ],
              ["Change orders", String(ledger.changeOrderCount)],
              ["Progress basis", progressBasisLabel(ledger.progressBasis)]
            ]}
          />
          <p className="mt-3 text-xs text-ink-600">{ledger.revenueFormula}</p>
        </Card>
      </div>

      <Card
        title="Revenue Realization"
        subtitle="Project-scoped realization view keeps earned, billed, collected, and outstanding values separate."
      >
        <DataTable
          columns={["Metric", "Value", "Notes"]}
          rows={[
            ["Earned Revenue", formatCurrency(ledger.revenueRealization.earnedRevenue), "Derived from project commercials."],
            [
              "Invoiced Revenue",
              formatCurrency(ledger.revenueRealization.invoicedRevenue),
              `${ledger.revenueRealization.invoiceCount} invoice record(s)`
            ],
            [
              "Collected Revenue",
              formatCurrency(ledger.revenueRealization.collectedRevenue),
              `${ledger.revenueRealization.paymentCount} payment record(s)`
            ],
            [
              "Outstanding Revenue",
              formatCurrency(ledger.revenueRealization.outstandingRevenue),
              "Billed but not yet collected."
            ],
            [
              "Uninvoiced Earned Remainder",
              formatCurrency(ledger.revenueRealization.uninvoicedEarnedRemainder),
              "Earned revenue not yet billed."
            ],
            [
              "Overbilling / Advance Billing",
              formatCurrency(ledger.revenueRealization.overbillingAdvanceAmount),
              "Shown when invoiced revenue exceeds earned revenue."
            ]
          ]}
        />
        {ledger.revenueRealization.overCollectedAmount > 0 ? (
          <p className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-900">
            Collection anomaly: collected revenue exceeds invoiced revenue by{" "}
            {formatCurrency(ledger.revenueRealization.overCollectedAmount)}.
          </p>
        ) : null}
      </Card>

      <Card
        title="Operating Cost Attribution"
        subtitle="Conservative attribution inside recognized operating cost."
      >
        <DataTable
          columns={["Component", "Recognized Cost", "Notes"]}
          rows={[
            [
              "Fuel attributed",
              formatCurrency(ledger.operatingAttribution.fuelAttributedCost),
              "Only rows with strong fuel evidence."
            ],
            [
              "Consumables attributed",
              formatCurrency(ledger.operatingAttribution.consumablesAttributedCost),
              "Only rows with explicit consumables evidence."
            ],
            [
              "Unattributed operating remainder",
              formatCurrency(ledger.operatingAttribution.unattributedOperatingCost),
              "Left unattributed when confidence is insufficient."
            ],
            [
              "Operating attribution coverage",
              formatPercent(ledger.operatingAttribution.operatingAttributionCoveragePercent),
              `${ledger.operatingAttribution.counts.operatingRows} operating row(s) in scope`
            ]
          ]}
        />
      </Card>

      <Card
        title="Margin Risk + Forecasting Lite"
        subtitle="Project-scoped run-rate view with conservative confidence gating."
      >
        <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
          <span className="text-ink-600">Forecast confidence:</span>
          <span
            className={`rounded-full px-2 py-0.5 font-semibold ${
              ledger.forecastLite.confidenceLevel === "STRONG"
                ? "bg-emerald-100 text-emerald-800"
                : ledger.forecastLite.confidenceLevel === "PARTIAL"
                  ? "bg-amber-100 text-amber-800"
                  : "bg-rose-100 text-rose-800"
            }`}
          >
            {ledger.forecastLite.confidenceLevel}
          </span>
          <span className="ml-1 text-ink-600">Trend:</span>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 font-semibold text-slate-800">
            {formatTrendDirection(ledger.forecastLite.trendDirection)}
          </span>
        </div>

        <p className="mb-3 text-xs text-ink-700">{ledger.forecastLite.narrative}</p>

        {ledger.forecastLite.hasNumericProjection ? (
          <DataTable
            columns={["Metric", "Value"]}
            rows={[
              [
                "Daily earned revenue velocity",
                ledger.forecastLite.dailyRevenueVelocity !== null
                  ? formatCurrency(ledger.forecastLite.dailyRevenueVelocity)
                  : "-"
              ],
              [
                "Daily recognized cost velocity",
                ledger.forecastLite.dailyRecognizedCostVelocity !== null
                  ? formatCurrency(ledger.forecastLite.dailyRecognizedCostVelocity)
                  : "-"
              ],
              [
                "Projected 30-day earned revenue",
                ledger.forecastLite.projected30DayRevenue !== null
                  ? formatCurrency(ledger.forecastLite.projected30DayRevenue)
                  : "-"
              ],
              [
                "Projected 30-day recognized cost",
                ledger.forecastLite.projected30DayRecognizedCost !== null
                  ? formatCurrency(ledger.forecastLite.projected30DayRecognizedCost)
                  : "-"
              ],
              [
                "Projected 30-day profit / loss",
                ledger.forecastLite.projected30DayProfit !== null
                  ? formatCurrency(ledger.forecastLite.projected30DayProfit)
                  : "-"
              ]
            ]}
          />
        ) : (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            {ledger.forecastLite.sufficiency.weakReason ||
              "Numeric projection suppressed because sample sufficiency is weak or irregular."}
          </p>
        )}

        <p className="mt-3 text-[11px] text-ink-600">
          Sample basis: {ledger.forecastLite.sufficiency.sampleSpanDays} day span,{" "}
          {ledger.forecastLite.sufficiency.revenueSampleDays} revenue sample day(s),{" "}
          {ledger.forecastLite.sufficiency.costSampleDays} cost sample day(s).
        </p>
      </Card>

      <Card
        title="Rig Cost Allocation Basis"
        subtitle="Rig burden is derived only from approved activity and configured rig rates."
      >
        {ledger.rigAllocationRows.length === 0 ? (
          <p className="text-sm text-ink-600">No rig allocation rows in scope for this project.</p>
        ) : (
          <DataTable
            columns={["Rig", "Basis", "Configured Rate", "Approved Activity", "Derived Cost", "Status"]}
            rows={ledger.rigAllocationRows.map((row) => [
              row.rigCode,
              row.costAllocationBasis === "DAY" ? "Day" : "Hour",
              formatCurrency(row.configuredRate),
              row.costAllocationBasis === "DAY"
                ? `${row.activityDays} day(s)`
                : `${row.activityHours.toFixed(1)} hour(s)`,
              formatCurrency(row.derivedCost),
              row.status === "COST_DERIVED"
                ? "Derived"
                : row.status === "MISSING_RATE"
                  ? "Missing rate"
                  : "Missing approved activity basis"
            ])}
          />
        )}
      </Card>

      <Card
        title="Margin-Affecting Signals"
        subtitle="Operational or linkage risks that can distort or pressure project margin."
      >
        <div className="space-y-2">
          {ledger.riskSignals.map((signal, index) => (
            <div
              key={`job-ledger-signal-${index}`}
              className={`rounded-lg border px-3 py-2 text-xs ${
                signal.level === "critical"
                  ? "border-rose-200 bg-rose-50 text-rose-900"
                  : signal.level === "warn"
                    ? "border-amber-200 bg-amber-50 text-amber-900"
                    : "border-slate-200 bg-slate-50 text-slate-800"
              }`}
            >
              <p className="font-semibold">{signal.title}</p>
              <p className="mt-1">{signal.detail}</p>
            </div>
          ))}
        </div>
      </Card>
    </section>
  );
}

function formatTrendDirection(value: ProjectJobLedgerSnapshot["forecastLite"]["trendDirection"]) {
  if (value === "IMPROVING") {
    return "Improving";
  }
  if (value === "DETERIORATING") {
    return "Deteriorating";
  }
  if (value === "STABLE") {
    return "Stable";
  }
  return "Insufficient data";
}

function progressBasisLabel(value: ProjectJobLedgerSnapshot["progressBasis"]) {
  if (value === "METERS") {
    return "Meters";
  }
  if (value === "DAYS") {
    return "Days";
  }
  if (value === "STATUS") {
    return "Project completion status";
  }
  return "Not available";
}
