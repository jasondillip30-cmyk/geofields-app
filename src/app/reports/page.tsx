"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, RotateCw } from "lucide-react";

import { AccessGate } from "@/components/layout/access-gate";
import { useAnalyticsFilters } from "@/components/layout/analytics-filters-provider";
import { FilterScopeBanner } from "@/components/layout/filter-scope-banner";
import { Card, MetricCard } from "@/components/ui/card";
import { SectionHeader } from "@/components/ui/section-header";
import { DataTable } from "@/components/ui/table";
import { formatCurrency, formatNumber } from "@/lib/utils";

interface RevenueAggregate {
  id: string;
  name: string;
  revenue: number;
}

interface ExpenseAggregate {
  id: string;
  name: string;
  amount: number;
}

interface ProfitabilityAggregate {
  id: string;
  name: string;
  revenue: number;
  expenses: number;
  profit: number;
  marginPercent: number | null;
}

interface SummaryReportPayload {
  totals: {
    totalRevenue: number;
    totalExpenses: number;
    grossProfit: number;
    profitMarginPercent: number | null;
  };
  summaries: {
    daily: {
      projectsWorked: number;
      rigsUsed: number;
      metersDrilled: number;
      revenue: number;
      expenses: number;
      issuesReported: number;
    };
    weekly: {
      metersDrilled: number;
      revenue: number;
      expenses: number;
      profit: number;
      mostUsedRig: string;
      highestRevenueRig: string;
      highestExpenseRig: string;
      bestProject: string;
    };
    monthly: {
      metersDrilled: number;
      revenue: number;
      expenses: number;
      profit: number;
    };
  };
  executive: {
    totalClients: number;
    totalProjects: number;
    totalRigs: number;
    activeRigs: number;
    idleRigs: number;
    maintenanceRigs: number;
    poorConditionRigs: number;
    pendingMaintenanceRequests: number;
    inventoryLowStockCount: number;
    inventoryOutOfStockCount: number;
    bestPerformingClient: string;
    bestPerformingProject: string;
    bestPerformingRig: string;
  };
  reports: {
    revenueByClient: RevenueAggregate[];
    revenueByProject: RevenueAggregate[];
    revenueByRig: RevenueAggregate[];
    expensesByCategory: ExpenseAggregate[];
    projectProfitability: ProfitabilityAggregate[];
    rigProfitability: ProfitabilityAggregate[];
  };
  dataQuality: {
    unassignedExpenseProjectCount: number;
    unassignedExpenseRigCount: number;
    unassignedExpenseClientCount: number;
  };
  availability: {
    dailySummary: boolean;
    weeklyMonthlySummary: boolean;
    executiveSummary: boolean;
    revenueBreakdowns: boolean;
    expenseCategoryBreakdown: boolean;
    projectProfitability: boolean;
    rigProfitability: boolean;
  };
  notes: string[];
}

const emptySummary: SummaryReportPayload = {
  totals: {
    totalRevenue: 0,
    totalExpenses: 0,
    grossProfit: 0,
    profitMarginPercent: null
  },
  summaries: {
    daily: {
      projectsWorked: 0,
      rigsUsed: 0,
      metersDrilled: 0,
      revenue: 0,
      expenses: 0,
      issuesReported: 0
    },
    weekly: {
      metersDrilled: 0,
      revenue: 0,
      expenses: 0,
      profit: 0,
      mostUsedRig: "No data in filters",
      highestRevenueRig: "No data in filters",
      highestExpenseRig: "No data in filters",
      bestProject: "No data in filters"
    },
    monthly: {
      metersDrilled: 0,
      revenue: 0,
      expenses: 0,
      profit: 0
    }
  },
  executive: {
    totalClients: 0,
    totalProjects: 0,
    totalRigs: 0,
    activeRigs: 0,
    idleRigs: 0,
    maintenanceRigs: 0,
    poorConditionRigs: 0,
    pendingMaintenanceRequests: 0,
    inventoryLowStockCount: 0,
    inventoryOutOfStockCount: 0,
    bestPerformingClient: "No data in filters",
    bestPerformingProject: "No data in filters",
    bestPerformingRig: "No data in filters"
  },
  reports: {
    revenueByClient: [],
    revenueByProject: [],
    revenueByRig: [],
    expensesByCategory: [],
    projectProfitability: [],
    rigProfitability: []
  },
  dataQuality: {
    unassignedExpenseProjectCount: 0,
    unassignedExpenseRigCount: 0,
    unassignedExpenseClientCount: 0
  },
  availability: {
    dailySummary: true,
    weeklyMonthlySummary: true,
    executiveSummary: true,
    revenueBreakdowns: true,
    expenseCategoryBreakdown: true,
    projectProfitability: true,
    rigProfitability: true
  },
  notes: []
};

export default function ReportsPage() {
  const { filters } = useAnalyticsFilters();
  const [summary, setSummary] = useState<SummaryReportPayload>(emptySummary);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadSummary = useCallback(
    async (silent = false) => {
      if (!silent) {
        setLoading(true);
      } else {
        setRefreshing(true);
      }
      setError(null);

      try {
        const params = new URLSearchParams();
        if (filters.from) params.set("from", filters.from);
        if (filters.to) params.set("to", filters.to);
        if (filters.clientId !== "all") params.set("clientId", filters.clientId);
        if (filters.rigId !== "all") params.set("rigId", filters.rigId);

        const query = params.toString();
        const response = await fetch(`/api/summary-report${query ? `?${query}` : ""}`, {
          cache: "no-store"
        });

        if (!response.ok) {
          const message = response.status === 403 ? "You do not have permission to load reports." : "Failed to load live report data.";
          throw new Error(message);
        }

        const payload = (await response.json()) as SummaryReportPayload;
        setSummary(payload || emptySummary);
      } catch (loadError) {
        setSummary(emptySummary);
        setError(loadError instanceof Error ? loadError.message : "Failed to load live report data.");
      } finally {
        if (!silent) {
          setLoading(false);
        } else {
          setRefreshing(false);
        }
      }
    },
    [filters.clientId, filters.from, filters.rigId, filters.to]
  );

  useEffect(() => {
    void loadSummary();
  }, [loadSummary]);

  const alerts = useMemo(() => {
    const liveAlerts: Array<{ type: string; message: string }> = [];

    if (summary.executive.poorConditionRigs > 0) {
      liveAlerts.push({
        type: "Rig Condition Risk",
        message: `${summary.executive.poorConditionRigs} rig(s) are in poor/critical condition and should be reviewed.`
      });
    }

    if (summary.executive.pendingMaintenanceRequests > 0) {
      liveAlerts.push({
        type: "Pending Maintenance",
        message: `${summary.executive.pendingMaintenanceRequests} active maintenance request(s) are still open.`
      });
    }

    if (summary.executive.inventoryOutOfStockCount > 0 || summary.executive.inventoryLowStockCount > 0) {
      liveAlerts.push({
        type: "Inventory Pressure",
        message: `${summary.executive.inventoryOutOfStockCount} out-of-stock and ${summary.executive.inventoryLowStockCount} low-stock item(s) in scope.`
      });
    }

    const unassignedTotal =
      summary.dataQuality.unassignedExpenseClientCount +
      summary.dataQuality.unassignedExpenseProjectCount +
      summary.dataQuality.unassignedExpenseRigCount;
    if (unassignedTotal > 0) {
      liveAlerts.push({
        type: "Data Linkage Gaps",
        message: `${unassignedTotal} recognized-cost linkage gap(s) detected across client/project/rig mapping.`
      });
    }

    if (liveAlerts.length === 0) {
      liveAlerts.push({
        type: "No Material Alerts",
        message: "No material risk signal detected in current scope."
      });
    }

    return liveAlerts;
  }, [summary.dataQuality, summary.executive]);

  const renderRevenueRows = (entries: RevenueAggregate[]) =>
    entries.map((entry) => [entry.name, formatCurrency(entry.revenue)]);

  const renderExpenseRows = (entries: ExpenseAggregate[]) =>
    entries.map((entry) => [entry.name, formatCurrency(entry.amount)]);

  const renderProfitabilityRows = (entries: ProfitabilityAggregate[]) =>
    entries.map((entry) => [
      entry.name,
      formatCurrency(entry.revenue),
      formatCurrency(entry.expenses),
      formatCurrency(entry.profit),
      entry.marginPercent === null ? "-" : `${entry.marginPercent.toFixed(1)}%`
    ]);

  return (
    <AccessGate denyBehavior="redirect" permission="reports:view">
      <div className="gf-page-stack">
        <FilterScopeBanner filters={filters} />

        {error ? <div className="gf-feedback-error">{error}</div> : null}

        <section className="gf-section">
          <SectionHeader
            title="Core Financial Summary"
            description="Live recognized reporting across revenue, cost, and profitability."
            action={
              <button type="button" onClick={() => void loadSummary(true)} className="gf-btn-subtle inline-flex items-center gap-1">
                <RotateCw size={12} className={refreshing ? "animate-spin" : ""} />
                Refresh
              </button>
            }
          />
          <div className="gf-kpi-grid-primary">
            <MetricCard label="Total Revenue" value={formatCurrency(summary.totals.totalRevenue)} tone="good" />
            <MetricCard label="Total Expenses" value={formatCurrency(summary.totals.totalExpenses)} tone="warn" />
            <MetricCard
              label="Gross Profit"
              value={formatCurrency(summary.totals.grossProfit)}
              tone={summary.totals.grossProfit >= 0 ? "good" : "danger"}
            />
            <MetricCard
              label="Profit Margin"
              value={summary.totals.profitMarginPercent === null ? "-" : `${summary.totals.profitMarginPercent.toFixed(1)}%`}
              tone={
                summary.totals.profitMarginPercent === null ? "neutral" : summary.totals.profitMarginPercent >= 0 ? "good" : "danger"
              }
            />
          </div>
        </section>

        <section className="grid gap-5 xl:grid-cols-2">
          <Card title="Daily Summary (Live)">
            {loading ? (
              <p className="text-sm text-ink-600">Loading daily summary...</p>
            ) : (
              <DataTable
                columns={["Metric", "Value"]}
                rows={[
                  ["Projects worked today", String(summary.summaries.daily.projectsWorked)],
                  ["Rigs used today", String(summary.summaries.daily.rigsUsed)],
                  ["Meters drilled", formatNumber(summary.summaries.daily.metersDrilled)],
                  ["Revenue (recognized)", formatCurrency(summary.summaries.daily.revenue)],
                  ["Expenses (recognized)", formatCurrency(summary.summaries.daily.expenses)],
                  ["Issues reported", String(summary.summaries.daily.issuesReported)]
                ]}
              />
            )}
          </Card>

          <Card title="Weekly / Monthly Summary (Live)">
            {loading ? (
              <p className="text-sm text-ink-600">Loading weekly/monthly summary...</p>
            ) : (
              <DataTable
                columns={["Metric", "Weekly", "Monthly"]}
                rows={[
                  [
                    "Meters drilled",
                    formatNumber(summary.summaries.weekly.metersDrilled),
                    formatNumber(summary.summaries.monthly.metersDrilled)
                  ],
                  ["Revenue (recognized)", formatCurrency(summary.summaries.weekly.revenue), formatCurrency(summary.summaries.monthly.revenue)],
                  ["Expenses (recognized)", formatCurrency(summary.summaries.weekly.expenses), formatCurrency(summary.summaries.monthly.expenses)],
                  ["Profit", formatCurrency(summary.summaries.weekly.profit), formatCurrency(summary.summaries.monthly.profit)],
                  ["Most used rig", summary.summaries.weekly.mostUsedRig, "-"],
                  ["Highest revenue rig", summary.summaries.weekly.highestRevenueRig, "-"],
                  ["Highest expense rig", summary.summaries.weekly.highestExpenseRig, "-"],
                  ["Best project", summary.summaries.weekly.bestProject, "-"]
                ]}
              />
            )}
          </Card>
        </section>

        <Card title="Executive Summary (Live)">
          {loading ? (
            <p className="text-sm text-ink-600">Loading executive summary...</p>
          ) : (
            <DataTable
              columns={["KPI", "Value"]}
              rows={[
                ["Total clients", String(summary.executive.totalClients)],
                ["Total projects", String(summary.executive.totalProjects)],
                ["Total rigs", String(summary.executive.totalRigs)],
                ["Active rigs", String(summary.executive.activeRigs)],
                ["Idle rigs", String(summary.executive.idleRigs)],
                ["Rigs in maintenance", String(summary.executive.maintenanceRigs)],
                ["Poor/critical rigs", String(summary.executive.poorConditionRigs)],
                ["Company revenue", formatCurrency(summary.totals.totalRevenue)],
                ["Company expenses", formatCurrency(summary.totals.totalExpenses)],
                ["Company gross profit", formatCurrency(summary.totals.grossProfit)],
                ["Top performing rig", summary.executive.bestPerformingRig],
                ["Top performing client", summary.executive.bestPerformingClient],
                ["Top performing project", summary.executive.bestPerformingProject]
              ]}
            />
          )}
        </Card>

        <section className="grid gap-5 xl:grid-cols-2">
          <Card title="Revenue by Client">
            {loading ? (
              <p className="text-sm text-ink-600">Loading revenue by client...</p>
            ) : summary.reports.revenueByClient.length === 0 ? (
              <p className="gf-empty-state">No recognized revenue-by-client data in current scope.</p>
            ) : (
              <DataTable columns={["Client", "Revenue"]} rows={renderRevenueRows(summary.reports.revenueByClient)} />
            )}
          </Card>

          <Card title="Revenue by Project">
            {loading ? (
              <p className="text-sm text-ink-600">Loading revenue by project...</p>
            ) : summary.reports.revenueByProject.length === 0 ? (
              <p className="gf-empty-state">No recognized revenue-by-project data in current scope.</p>
            ) : (
              <DataTable columns={["Project", "Revenue"]} rows={renderRevenueRows(summary.reports.revenueByProject)} />
            )}
          </Card>
        </section>

        <section className="grid gap-5 xl:grid-cols-2">
          <Card title="Revenue by Rig">
            {loading ? (
              <p className="text-sm text-ink-600">Loading revenue by rig...</p>
            ) : summary.reports.revenueByRig.length === 0 ? (
              <p className="gf-empty-state">No recognized revenue-by-rig data in current scope.</p>
            ) : (
              <DataTable columns={["Rig", "Revenue"]} rows={renderRevenueRows(summary.reports.revenueByRig)} />
            )}
          </Card>

          <Card title="Expenses by Category">
            {loading ? (
              <p className="text-sm text-ink-600">Loading expense categories...</p>
            ) : summary.reports.expensesByCategory.length === 0 ? (
              <p className="gf-empty-state">No recognized cost-category data in current scope.</p>
            ) : (
              <DataTable columns={["Category", "Amount"]} rows={renderExpenseRows(summary.reports.expensesByCategory)} />
            )}
          </Card>
        </section>

        <section className="grid gap-5 xl:grid-cols-2">
          <Card title="Project Profitability">
            {loading ? (
              <p className="text-sm text-ink-600">Loading project profitability...</p>
            ) : summary.reports.projectProfitability.length === 0 ? (
              <p className="gf-empty-state">No project profitability data in current scope.</p>
            ) : (
              <DataTable
                columns={["Project", "Revenue", "Expenses", "Profit", "Margin"]}
                rows={renderProfitabilityRows(summary.reports.projectProfitability)}
              />
            )}
          </Card>

          <Card title="Rig Profitability">
            {loading ? (
              <p className="text-sm text-ink-600">Loading rig profitability...</p>
            ) : summary.reports.rigProfitability.length === 0 ? (
              <p className="gf-empty-state">No rig profitability data in current scope.</p>
            ) : (
              <DataTable
                columns={["Rig", "Revenue", "Expenses", "Profit", "Margin"]}
                rows={renderProfitabilityRows(summary.reports.rigProfitability)}
              />
            )}
          </Card>
        </section>

        <Card title="Alerts Requiring Attention">
          <div className="space-y-2">
            {alerts.map((alert) => (
              <div key={alert.type} className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
                <AlertTriangle size={16} className="mt-0.5 text-amber-700" />
                <div>
                  <p className="text-sm font-semibold text-amber-900">{alert.type}</p>
                  <p className="text-sm text-amber-900">{alert.message}</p>
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card title="Data Availability">
          <DataTable
            columns={["Section", "Status"]}
            rows={[
              [
                "Revenue by client / project / rig",
                summary.availability.revenueBreakdowns ? "Live" : "Unavailable"
              ],
              [
                "Expenses by category",
                summary.availability.expenseCategoryBreakdown ? "Live" : "Unavailable"
              ],
              [
                "Project profitability",
                summary.availability.projectProfitability ? "Live" : "Unavailable"
              ],
              [
                "Rig profitability",
                summary.availability.rigProfitability ? "Live" : "Unavailable"
              ]
            ]}
          />
          {summary.notes.length > 0 ? (
            <div className="mt-3 space-y-2">
              {summary.notes.map((note) => (
                <p key={note} className="gf-inline-note">
                  {note}
                </p>
              ))}
            </div>
          ) : null}
        </Card>
      </div>
    </AccessGate>
  );
}
