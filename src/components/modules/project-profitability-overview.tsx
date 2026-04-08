import { Card, MetricCard } from "@/components/ui/card";
import { DataTable } from "@/components/ui/table";
import { formatCurrency, formatNumber } from "@/lib/utils";

interface ProjectProfitabilityOverviewProps {
  drilledMeters: number;
  contractRate: number;
  revenue: number;
  cost: number;
  profitLoss: number;
  revenueBreakdown: Array<{
    itemCode: string;
    label: string;
    unit: string;
    quantity: number;
    unitRate: number;
    revenue: number;
  }>;
  isUsingSimpleRevenueModel?: boolean;
  costBreakdown: Array<{
    label: string;
    amount: number;
  }>;
}

export function ProjectProfitabilityOverview({
  drilledMeters,
  contractRate,
  revenue,
  cost,
  profitLoss,
  revenueBreakdown,
  isUsingSimpleRevenueModel = false,
  costBreakdown
}: ProjectProfitabilityOverviewProps) {
  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-lg font-semibold text-ink-900">Project profitability</h3>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <MetricCard label="Drilled meters" value={formatNumber(drilledMeters)} />
        <MetricCard label="Contract rate" value={formatCurrency(contractRate)} />
        <MetricCard label="Revenue" value={formatCurrency(revenue)} tone="good" />
        <MetricCard label="Cost" value={formatCurrency(cost)} tone="warn" />
        <MetricCard
          label="Profit / Loss"
          value={formatCurrency(profitLoss)}
          tone={profitLoss >= 0 ? "good" : "danger"}
        />
      </div>
      {isUsingSimpleRevenueModel ? (
        <p className="text-xs text-slate-600">Using simple revenue model</p>
      ) : null}

      <details className="rounded-lg border border-slate-200 bg-white">
        <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-ink-800">Revenue breakdown</summary>
        <div className="border-t border-slate-200 px-3 py-3">
          {revenueBreakdown.length === 0 ? (
            <p className="text-sm text-ink-600">No billable line data recorded yet.</p>
          ) : (
            <DataTable
              compact
              columns={["Billable item", "Quantity", "Rate", "Revenue"]}
              rows={revenueBreakdown.map((row) => [
                row.label,
                `${formatNumber(row.quantity)} ${row.unit}`,
                formatCurrency(row.unitRate),
                formatCurrency(row.revenue)
              ])}
            />
          )}
        </div>
      </details>

      <Card title="Cost breakdown">
        {costBreakdown.length === 0 ? (
          <p className="text-sm text-ink-600">No project costs recorded yet.</p>
        ) : (
          <DataTable
            compact
            columns={["Cost", "Amount"]}
            rows={costBreakdown.map((row) => [row.label, formatCurrency(row.amount)])}
          />
        )}
      </Card>
    </section>
  );
}
