"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { AlertTriangle, RotateCw } from "lucide-react";

import { AccessGate } from "@/components/layout/access-gate";
import { useAnalyticsFilters, type AnalyticsFilters } from "@/components/layout/analytics-filters-provider";
import { FilterScopeBanner } from "@/components/layout/filter-scope-banner";
import { RankedAmountBars } from "@/components/charts/ranked-amount-bars";
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
  const { filters, scopeBootstrapped } = useAnalyticsFilters();
  const params = new URLSearchParams();
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  if (filters.projectId !== "all") params.set("projectId", filters.projectId);
  if (filters.clientId !== "all") params.set("clientId", filters.clientId);
  if (filters.rigId !== "all") params.set("rigId", filters.rigId);
  const query = params.toString();

  return (
    <AccessGate denyBehavior="redirect" permission="reports:view">
      {scopeBootstrapped ? <ScopedReports key={query} filters={filters} query={query} /> : (
        <p className="text-sm text-ink-600">Loading report scope...</p>
      )}
    </AccessGate>
  );
}

function ScopedReports({ filters, query }: { filters: AnalyticsFilters; query: string }) {
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
    [query]
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
        message: `${summary.executive.inventoryOutOfStockCount} out-of-stock and ${summary.executive.inventoryLowStockCount} low-stock item(s) in inventory. Stock counts are not filtered by project or date.`
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

  const projectScoped = filters.projectId !== "all";
  const projectName = summary.reports.projectProfitability.find((entry) => entry.id === filters.projectId)?.name;
  const financeScope = projectScoped ? "Project" : filters.clientId !== "all" || filters.rigId !== "all" ? "Filtered" : "Company";
  const showTotals = !loading && !error;

  return (
      <div className="gf-page-stack">
        <FilterScopeBanner filters={filters} projectLabel={projectName} />

        {error ? <div className="gf-feedback-error">{error}</div> : null}

        <section className="gf-section">
          <SectionHeader
            title={`${financeScope} Financial Summary`}
            description={projectScoped
              ? `Recognized revenue, expenses, and profit for ${projectName || "the selected project"} only.`
              : "Recognized revenue, expenses, and profit for the current report filters."}
            action={
              <button type="button" disabled={loading || refreshing} onClick={() => void loadSummary(true)} className="gf-btn-subtle inline-flex items-center gap-1">
                <RotateCw size={12} className={refreshing ? "animate-spin" : ""} />
                Refresh
              </button>
            }
          />
          <div className="gf-kpi-grid-primary">
            <MetricCard label={`${financeScope} Revenue`} value={showTotals ? formatCurrency(summary.totals.totalRevenue) : "-"} tone="good" />
            <MetricCard label={`${financeScope} Expenses`} value={showTotals ? formatCurrency(summary.totals.totalExpenses) : "-"} tone="warn" />
            <MetricCard
              label={`${financeScope} Gross Profit`}
              value={showTotals ? formatCurrency(summary.totals.grossProfit) : "-"}
              tone={summary.totals.grossProfit >= 0 ? "good" : "danger"}
            />
            <MetricCard
              label="Profit Margin"
              value={!showTotals || summary.totals.profitMarginPercent === null ? "-" : `${summary.totals.profitMarginPercent.toFixed(1)}%`}
              tone={
                summary.totals.profitMarginPercent === null ? "neutral" : summary.totals.profitMarginPercent >= 0 ? "good" : "danger"
              }
            />
          </div>
        </section>

        {showTotals && (
          <>
            <section className="gf-section" aria-labelledby="report-comparisons">
              <h2 id="report-comparisons" className="text-lg font-semibold text-ink-900">Costs and profitability</h2>
              <div className="grid items-start gap-4 xl:grid-cols-3">
                <ReportComparison title="Expenses by Category" available={summary.availability.expenseCategoryBreakdown}
                  columns={["Category", "Amount"]}
                  rows={summary.reports.expensesByCategory.map(({ id, name, amount }) => ({ id, label: name, amount }))}
                  details={renderExpenseRows(summary.reports.expensesByCategory)} />
                <ReportComparison title="Project Profitability" available={summary.availability.projectProfitability}
                  columns={["Project", "Revenue", "Expenses", "Profit", "Margin"]}
                  rows={summary.reports.projectProfitability.map(({ id, name, profit }) => ({ id, label: name, amount: profit }))}
                  details={renderProfitabilityRows(summary.reports.projectProfitability)} profit />
                <ReportComparison title="Rig Profitability" available={summary.availability.rigProfitability}
                  columns={["Rig", "Revenue", "Expenses", "Profit", "Margin"]}
                  rows={summary.reports.rigProfitability.map(({ id, name, profit }) => ({ id, label: name, amount: profit }))}
                  details={renderProfitabilityRows(summary.reports.rigProfitability)} profit />
              </div>
            </section>

            <ReportDisclosure title="Revenue breakdowns" hint="By client, project, and rig">
              <div className="grid items-start gap-4 xl:grid-cols-3">
                {([
                  ["Client", summary.reports.revenueByClient],
                  ["Project", summary.reports.revenueByProject],
                  ["Rig", summary.reports.revenueByRig]
                ] as const).map(([label, entries]) => (
                  <ReportComparison key={label} title={`Revenue by ${label}`} available={summary.availability.revenueBreakdowns}
                    columns={[label, "Revenue"]}
                    rows={entries.map(({ id, name, revenue }) => ({ id, label: name, amount: revenue }))}
                    details={renderRevenueRows(entries)} />
                ))}
              </div>
            </ReportDisclosure>
            <ReportDisclosure title="Activity summaries" hint="Daily, weekly, monthly, and operational figures">
              <div className="grid gap-4 xl:grid-cols-2">
                <Card title="Daily Summary">
                  {summary.availability.dailySummary ? (
                    <DataTable columns={["Metric", "Value"]} rows={[
                      ["Projects worked today", String(summary.summaries.daily.projectsWorked)],
                      ["Rigs used today", String(summary.summaries.daily.rigsUsed)],
                      ["Meters drilled", formatNumber(summary.summaries.daily.metersDrilled)],
                      ["Revenue (recognized)", formatCurrency(summary.summaries.daily.revenue)],
                      ["Expenses (recognized)", formatCurrency(summary.summaries.daily.expenses)],
                      ["Issues reported", String(summary.summaries.daily.issuesReported)]
                    ]} />
                  ) : <p className="gf-empty-state">Daily summary is unavailable.</p>}
                </Card>
                <Card title="Weekly / Monthly Summary">
                  {summary.availability.weeklyMonthlySummary ? (
                    <DataTable columns={["Metric", "Weekly", "Monthly"]} rows={[
                      ["Meters drilled", formatNumber(summary.summaries.weekly.metersDrilled), formatNumber(summary.summaries.monthly.metersDrilled)],
                      ["Revenue (recognized)", formatCurrency(summary.summaries.weekly.revenue), formatCurrency(summary.summaries.monthly.revenue)],
                      ["Expenses (recognized)", formatCurrency(summary.summaries.weekly.expenses), formatCurrency(summary.summaries.monthly.expenses)],
                      ["Profit", formatCurrency(summary.summaries.weekly.profit), formatCurrency(summary.summaries.monthly.profit)],
                      ["Most used rig", summary.summaries.weekly.mostUsedRig, "-"],
                      ["Highest revenue rig", summary.summaries.weekly.highestRevenueRig, "-"],
                      ["Highest expense rig", summary.summaries.weekly.highestExpenseRig, "-"],
                      ["Best project", summary.summaries.weekly.bestProject, "-"]
                    ]} />
                  ) : <p className="gf-empty-state">Weekly and monthly summaries are unavailable.</p>}
                </Card>
                <Card title="Operational Summary">
                  {summary.availability.executiveSummary ? (
                    <DataTable columns={["KPI", "Value"]} rows={[
                      ["Total clients", String(summary.executive.totalClients)],
                      ["Total projects", String(summary.executive.totalProjects)],
                      ["Total rigs", String(summary.executive.totalRigs)],
                      ["Active rigs", String(summary.executive.activeRigs)],
                      ["Idle rigs", String(summary.executive.idleRigs)],
                      ["Rigs in maintenance", String(summary.executive.maintenanceRigs)],
                      ["Poor/critical rigs", String(summary.executive.poorConditionRigs)],
                      ["Top performing rig", summary.executive.bestPerformingRig],
                      ["Top performing client", summary.executive.bestPerformingClient],
                      ["Top performing project", summary.executive.bestPerformingProject]
                    ]} />
                  ) : <p className="gf-empty-state">Operational summary is unavailable.</p>}
                </Card>
              </div>
            </ReportDisclosure>
          </>
        )}

        {showTotals && <Card title="Alerts Requiring Attention">
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
        </Card>}

        {showTotals && <ReportDisclosure title="Data availability" hint="Source coverage and report notes">
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
        </ReportDisclosure>}
      </div>
  );
}

function ReportDisclosure({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <details className="rounded-xl border border-slate-200 bg-white">
      <summary className="cursor-pointer rounded-xl px-4 py-3 text-sm font-semibold text-ink-900 focus-visible:ring-2 focus-visible:ring-brand-500">
        {title}
        {hint && <span className="ml-2 font-normal text-ink-600">{hint}</span>}
      </summary>
      <div className="border-t border-slate-200 p-3">{children}</div>
    </details>
  );
}

function ReportComparison({ title, available, columns, rows, details, profit = false }: {
  title: string;
  available: boolean;
  columns: string[];
  rows: Array<{ id: string; label: string; amount: number }>;
  details: string[][];
  profit?: boolean;
}) {
  return (
    <Card title={title}>
      {!available ? <p className="gf-empty-state">This breakdown is unavailable in this scope.</p>
        : rows.length === 0 ? <p className="gf-empty-state">No recorded data in this scope.</p>
          : (
            <div className="space-y-4">
              <RankedAmountBars rows={rows} label={title} limit={5} signed={profit}
                positive={profit ? "Profits" : "Amounts"} negative={profit ? "Losses" : undefined} />
              <ReportDisclosure title="View details" hint={`${rows.length} ${rows.length === 1 ? "row" : "rows"}`}>
                <DataTable columns={columns} rows={details} compact />
              </ReportDisclosure>
            </div>
          )}
    </Card>
  );
}
