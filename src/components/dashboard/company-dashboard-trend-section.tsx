import { Card } from "@/components/ui/card";
import { SectionHeader } from "@/components/ui/section-header";
import { DataTable } from "@/components/ui/table";
import { BarCategoryChart } from "@/components/charts/bar-category-chart";
import { DonutStatusChart } from "@/components/charts/donut-status-chart";
import { LineTrendChart } from "@/components/charts/line-trend-chart";
import { ActualVsForecastChart } from "@/components/charts/actual-vs-forecast-chart";
import { getBucketDateRange } from "@/lib/drilldown";
import { DashboardEmptyState } from "./company-dashboard-helpers";
import type { DashboardSummary } from "./company-dashboard-types";

interface CompanyDashboardTrendSectionProps {
  loading: boolean;
  summary: DashboardSummary;
  hasScopeFilters: boolean;
  handleClearFilters: () => void;
  handleLast30Days: () => void;
  handleLast90Days: () => void;
  pushWithFilters: (path: string, overrides?: Record<string, string | null | undefined>) => void;
  rigForecastRows: Array<Array<string | number>>;
  forecastInsight: string;
}

export function CompanyDashboardTrendSection({
  loading,
  summary,
  hasScopeFilters,
  handleClearFilters,
  handleLast30Days,
  handleLast90Days,
  pushWithFilters,
  rigForecastRows,
  forecastInsight
}: CompanyDashboardTrendSectionProps) {
  return (
    <section className="gf-section">
      <SectionHeader
        title="Trend Analytics"
        description="Revenue, profit, rig activity, and forecast visuals for executive drill-down."
      />
      <div className="gf-chart-grid">
      <Card
        title="Monthly Revenue vs Expenses"
        subtitle="Financial trend and margin view"
        className="transition-shadow hover:shadow-md"
        onClick={() => {
          pushWithFilters("/spending");
        }}
        clickLabel="Open revenue details"
      >
        {loading ? (
          <p className="text-sm text-ink-600">Loading financial trend...</p>
        ) : summary.financialTrend.length === 0 ? (
          <DashboardEmptyState
            message="No revenue or expense trend data for selected filters."
            onClearFilters={handleClearFilters}
            onLast30Days={handleLast30Days}
            onLast90Days={handleLast90Days}
            isFiltered={hasScopeFilters}
          />
        ) : (
          <LineTrendChart
            data={summary.financialTrend}
            xKey="label"
            yKey="revenue"
            secondaryKey="expenses"
            clickHint="Click to view revenue details"
            onBackgroundClick={() => {
              pushWithFilters("/spending");
            }}
            onElementClick={(entry) => {
              const range = getBucketDateRange(entry.bucketStart);
              if (!range) {
                pushWithFilters("/spending");
                return;
              }
              pushWithFilters("/spending", {
                from: range.from,
                to: range.to
              });
            }}
          />
        )}
      </Card>

      <Card
        title="Profit Trend Over Time"
        subtitle="Revenue minus expenses by period"
        className="transition-shadow hover:shadow-md"
        onClick={() => {
          pushWithFilters("/spending/profit");
        }}
        clickLabel="Open profit details"
      >
        {loading ? (
          <p className="text-sm text-ink-600">Loading profit trend...</p>
        ) : summary.financialTrend.length === 0 ? (
          <DashboardEmptyState
            message="No profit trend data for selected filters."
            onClearFilters={handleClearFilters}
            onLast30Days={handleLast30Days}
            onLast90Days={handleLast90Days}
            isFiltered={hasScopeFilters}
          />
        ) : (
          <LineTrendChart
            data={summary.financialTrend.map((entry) => ({
              bucketStart: entry.bucketStart,
              label: entry.label,
              profit: entry.profit
            }))}
            xKey="label"
            yKey="profit"
            color="#0f766e"
            clickHint="Click to view profit details"
            onBackgroundClick={() => {
              pushWithFilters("/spending/profit");
            }}
            onElementClick={(entry) => {
              const range = getBucketDateRange(entry.bucketStart);
              if (!range) {
                pushWithFilters("/spending/profit");
                return;
              }
              pushWithFilters("/spending/profit", {
                from: range.from,
                to: range.to
              });
            }}
          />
        )}
      </Card>

      <Card
        title="Actual vs Forecast Profit"
        subtitle="Historical cumulative profit vs projected next 30 days"
        className="transition-shadow hover:shadow-md"
        onClick={() => {
          pushWithFilters("/forecasting");
        }}
        clickLabel="Open forecasting details"
      >
        {loading ? (
          <p className="text-sm text-ink-600">Loading profit forecast...</p>
        ) : summary.profitForecast.actualVsForecastProfit.length === 0 ? (
          <DashboardEmptyState
            message="Not enough data to build a forecast for selected filters."
            onClearFilters={handleClearFilters}
            onLast30Days={handleLast30Days}
            onLast90Days={handleLast90Days}
            isFiltered={hasScopeFilters}
          />
        ) : (
          <>
            <ActualVsForecastChart
              data={summary.profitForecast.actualVsForecastProfit}
              xKey="label"
              actualKey="actualProfit"
              forecastKey="forecastProfit"
              clickHint="Click to open forecasting"
              onBackgroundClick={() => {
                pushWithFilters("/forecasting");
              }}
              onElementClick={(entry) => {
                const range = getBucketDateRange(entry.bucketStart);
                if (!range) {
                  pushWithFilters("/forecasting");
                  return;
                }
                pushWithFilters("/forecasting", {
                  from: range.from,
                  to: range.to
                });
              }}
            />
            <p className="mt-3 text-xs text-ink-600">{forecastInsight}</p>
          </>
        )}
      </Card>

      <Card
        title="Revenue by Client"
        subtitle="Client contribution to revenue in the selected scope."
        className="transition-shadow hover:shadow-md"
        onClick={() => {
          pushWithFilters("/spending");
        }}
        clickLabel="Open revenue by client details"
      >
        {loading ? (
          <p className="text-sm text-ink-600">Loading...</p>
        ) : summary.revenueByClient.length === 0 ? (
          <DashboardEmptyState
            message="No revenue data by client for selected filters."
            onClearFilters={handleClearFilters}
            onLast30Days={handleLast30Days}
            onLast90Days={handleLast90Days}
            isFiltered={hasScopeFilters}
          />
        ) : (
          <BarCategoryChart
            data={summary.revenueByClient}
            xKey="name"
            yKey="revenue"
            clickHint="Click client bar to drill into revenue"
            onBackgroundClick={() => {
              pushWithFilters("/spending");
            }}
            onElementClick={(entry) => {
              pushWithFilters("/spending", {
                clientId: entry.id || null
              });
            }}
          />
        )}
      </Card>

      <Card
        title="Revenue by Rig"
        subtitle="Rig revenue distribution for the current filters."
        className="transition-shadow hover:shadow-md"
        onClick={() => {
          pushWithFilters("/spending");
        }}
        clickLabel="Open revenue by rig details"
      >
        {loading ? (
          <p className="text-sm text-ink-600">Loading...</p>
        ) : summary.revenueByRig.length === 0 ? (
          <DashboardEmptyState
            message="No revenue data by rig for selected filters."
            onClearFilters={handleClearFilters}
            onLast30Days={handleLast30Days}
            onLast90Days={handleLast90Days}
            isFiltered={hasScopeFilters}
          />
        ) : (
          <BarCategoryChart
            data={summary.revenueByRig}
            xKey="name"
            yKey="revenue"
            color="#0f766e"
            clickHint="Click rig bar to drill into revenue"
            onBackgroundClick={() => {
              pushWithFilters("/spending");
            }}
            onElementClick={(entry) => {
              pushWithFilters("/spending", {
                rigId: entry.id || null
              });
            }}
          />
        )}
      </Card>

      <Card
        title="Meters Drilled Trend"
        subtitle="Drilling output trend by selected period."
        className="transition-shadow hover:shadow-md"
        onClick={() => {
          pushWithFilters("/drilling-reports");
        }}
        clickLabel="Open drilling report details"
      >
        {loading ? (
          <p className="text-sm text-ink-600">Loading...</p>
        ) : summary.metersTrend.length === 0 ? (
          <DashboardEmptyState
            message="No drilling activity for current filters."
            onClearFilters={handleClearFilters}
            onLast30Days={handleLast30Days}
            onLast90Days={handleLast90Days}
            isFiltered={hasScopeFilters}
          />
        ) : (
          <LineTrendChart
            data={summary.metersTrend}
            xKey="label"
            yKey="meters"
            color="#1c3d8e"
            clickHint="Click to open drilling reports"
            onBackgroundClick={() => {
              pushWithFilters("/drilling-reports");
            }}
            onElementClick={(entry) => {
              const range = getBucketDateRange(entry.bucketStart);
              if (!range) {
                pushWithFilters("/drilling-reports");
                return;
              }
              pushWithFilters("/drilling-reports", {
                from: range.from,
                to: range.to
              });
            }}
          />
        )}
      </Card>

      <Card
        title="Active vs Idle vs Maintenance"
        subtitle="Current rig utilization status mix."
        className="transition-shadow hover:shadow-md"
        onClick={() => {
          pushWithFilters("/rigs");
        }}
        clickLabel="Open rig status details"
      >
        {loading ? (
          <p className="text-sm text-ink-600">Loading...</p>
        ) : summary.rigStatusData.length === 0 ? (
          <DashboardEmptyState
            message="No rig status data for selected filters."
            onClearFilters={handleClearFilters}
            onLast30Days={handleLast30Days}
            onLast90Days={handleLast90Days}
            isFiltered={hasScopeFilters}
          />
        ) : (
          <DonutStatusChart
            data={summary.rigStatusData}
            nameKey="status"
            valueKey="value"
            clickHint="Click status slice to view rigs"
            onBackgroundClick={() => {
              pushWithFilters("/rigs");
            }}
            onElementClick={(entry) => {
              pushWithFilters("/rigs", {
                status: entry.status
              });
            }}
          />
        )}
      </Card>

      <Card
        title="Expense Breakdown by Category"
        subtitle="Category-level expense concentrations."
        className="xl:col-span-2 transition-shadow hover:shadow-md"
        onClick={() => {
          pushWithFilters("/expenses");
        }}
        clickLabel="Open expense breakdown details"
      >
        {loading ? (
          <p className="text-sm text-ink-600">Loading...</p>
        ) : summary.expenseBreakdown.length === 0 ? (
          <DashboardEmptyState
            message="No expenses recorded in this date range."
            onClearFilters={handleClearFilters}
            onLast30Days={handleLast30Days}
            onLast90Days={handleLast90Days}
            isFiltered={hasScopeFilters}
          />
        ) : (
          <BarCategoryChart
            data={summary.expenseBreakdown}
            xKey="category"
            yKey="amount"
            color="#f59e0b"
            clickHint="Click category bar to drill into expenses"
            onBackgroundClick={() => {
              pushWithFilters("/expenses");
            }}
            onElementClick={(entry) => {
              pushWithFilters("/expenses", {
                category: entry.category
              });
            }}
          />
        )}
      </Card>

      <Card
        title="Profit Forecast by Rig (Next 30 Days)"
        subtitle="Projected rig profitability based on current trend."
        className="xl:col-span-2"
      >
        {loading ? (
          <p className="text-sm text-ink-600">Loading rig forecast...</p>
        ) : summary.profitForecast.forecastByRig.length === 0 ? (
          <DashboardEmptyState
            message="No rig-level profit forecast available for selected filters."
            onClearFilters={handleClearFilters}
            onLast30Days={handleLast30Days}
            onLast90Days={handleLast90Days}
            isFiltered={hasScopeFilters}
          />
        ) : (
          <DataTable
            columns={["Rig", "Current Profit", "Avg Daily Profit", "Forecast Profit (30 Days)"]}
            rows={rigForecastRows}
          />
        )}
      </Card>
      </div>
    </section>
  );
}
