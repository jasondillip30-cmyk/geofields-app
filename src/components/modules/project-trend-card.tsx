import { Card } from "@/components/ui/card";
import type { ProjectJobLedgerSnapshot } from "@/lib/project-job-ledger";
import { formatCurrency, formatNumber } from "@/lib/utils";

interface ProjectTrendCardProps {
  ledger: ProjectJobLedgerSnapshot;
  approvedReportCount: number;
  averageMetersPerDay: number;
  downtimeHours: number;
}

export function ProjectTrendCard({
  ledger,
  approvedReportCount,
  averageMetersPerDay,
  downtimeHours
}: ProjectTrendCardProps) {
  return (
    <Card
      title="Project Trend"
      subtitle="Compact trend view. Full drill-down remains inside tabs."
    >
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <TrendStat label="Trend direction" value={formatTrendDirection(ledger.forecastLite.trendDirection)} />
        <TrendStat label="Forecast confidence" value={ledger.forecastLite.confidenceLevel} />
        <TrendStat
          label="Projected 30-day profit"
          value={
            ledger.forecastLite.hasNumericProjection && ledger.forecastLite.projected30DayProfit !== null
              ? formatCurrency(ledger.forecastLite.projected30DayProfit)
              : "Insufficient data"
          }
        />
        <TrendStat
          label="Activity pulse"
          value={`${formatNumber(approvedReportCount)} reports • ${formatNumber(averageMetersPerDay)} m/day • ${formatNumber(downtimeHours)} downtime hrs`}
        />
      </div>
    </Card>
  );
}

function TrendStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-sm font-semibold text-ink-900">{value}</p>
    </div>
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
