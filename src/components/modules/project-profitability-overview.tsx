import { Card, MetricCard } from "@/components/ui/card";
import { DataTable } from "@/components/ui/table";
import { formatCurrency, formatNumber } from "@/lib/utils";

interface ProjectProfitabilityOverviewProps {
  drilledMeters: number;
  billingBasis: string;
  revenue: number;
  totalKnownCost: number;
  profitLoss: number;
  costBreakdown: Array<{
    label: string;
    amount: number;
  }>;
}

export function ProjectProfitabilityOverview({
  drilledMeters,
  billingBasis,
  revenue,
  totalKnownCost,
  profitLoss,
  costBreakdown
}: ProjectProfitabilityOverviewProps) {
  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-lg font-semibold text-ink-900">Project Profitability Overview</h3>
        <p className="text-sm text-ink-600">
          Quick answer: work done, revenue, cost, and profit / loss.
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <MetricCard label="Drilled meters" value={formatNumber(drilledMeters)} />
        <MetricCard label="Billing basis" value={billingBasis} />
        <MetricCard label="Revenue" value={formatCurrency(revenue)} tone="good" />
        <MetricCard label="Total project cost" value={formatCurrency(totalKnownCost)} tone="warn" />
        <MetricCard
          label="Profit / Loss"
          value={formatCurrency(profitLoss)}
          tone={profitLoss >= 0 ? "good" : "danger"}
        />
      </div>

      <Card title="Cost breakdown">
        <DataTable
          compact
          columns={["Cost", "Amount"]}
          rows={costBreakdown.map((row) => [row.label, formatCurrency(row.amount)])}
        />
      </Card>
    </section>
  );
}
