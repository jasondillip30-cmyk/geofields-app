"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { AccessGate } from "@/components/layout/access-gate";
import { ProjectOperatingCostsPanel } from "@/components/modules/project-operating-costs-panel";
import { ProjectProfitabilityOverview } from "@/components/modules/project-profitability-overview";
import { Card } from "@/components/ui/card";
import { DataTable } from "@/components/ui/table";
import { formatCurrency } from "@/lib/utils";

interface ProjectFinancialSummary {
  totals: {
    income: number;
    expenses: number;
    netCashFlow: number;
    metersDrilled?: number;
  };
  expenseByCategory: Array<{
    category: string;
    total: number;
  }>;
  largestExpenses: Array<{
    id: string;
    label: string;
    dateLabel: string;
    amount: number;
  }>;
  revenueBreakdown?: Array<{
    itemCode: string;
    label: string;
    unit: string;
    quantity: number;
    unitRate: number;
    revenue: number;
  }>;
}

export function ProjectFinancialOverview(props: { projectId: string; contractRate: number }) {
  const [revision, setRevision] = useState(0);
  return (
    <>
      <ProjectFinancialSummaryCard {...props} revision={revision} />
      <AccessGate permission="finance:edit">
        <ProjectOperatingCostsPanel projectId={props.projectId} onPosted={() => setRevision((value) => value + 1)} />
      </AccessGate>
    </>
  );
}

function ProjectFinancialSummaryCard({
  projectId,
  contractRate,
  revision
}: {
  projectId: string;
  contractRate: number;
  revision: number;
}) {
  const [summary, setSummary] = useState<ProjectFinancialSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const response = await fetch(
          `/api/spending/summary?projectId=${encodeURIComponent(projectId)}`,
          { cache: "no-store" }
        );
        if (!response.ok) {
          throw new Error("Project financial summary is unavailable.");
        }
        const payload = (await response.json()) as ProjectFinancialSummary;
        if (active) {
          setSummary(payload);
          setError(null);
        }
      } catch (loadError) {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : "Project financial summary is unavailable.");
        }
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [projectId, revision]);

  if (error) {
    return (
      <Card title="Project financial overview">
        <p className="text-sm text-rose-700">{error}</p>
      </Card>
    );
  }

  if (!summary) {
    return (
      <Card title="Project financial overview">
        <p className="text-sm text-ink-600">Loading project revenue and expenses...</p>
      </Card>
    );
  }

  const spendingHref = `/spending?workspace=project&projectId=${encodeURIComponent(projectId)}`;

  return (
    <section className="space-y-4">
      <ProjectProfitabilityOverview
        drilledMeters={summary.totals.metersDrilled || 0}
        contractRate={contractRate}
        revenue={summary.totals.income}
        cost={summary.totals.expenses}
        profitLoss={summary.totals.netCashFlow}
        revenueBreakdown={summary.revenueBreakdown || []}
        costBreakdown={summary.expenseByCategory.map((row) => ({
          label: row.category,
          amount: row.total
        }))}
      />

      <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
        Expenses and Profit include confirmed operating costs only. Unrecorded crew pay and site costs are not included.
      </p>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Largest expenses" subtitle="Highest recognized project costs in the current project scope.">
          {summary.largestExpenses.length > 0 ? (
            <DataTable
              compact
              columns={["Expense", "Date", "Amount", "Record"]}
              rows={summary.largestExpenses.map((expense) => [
                expense.label,
                expense.dateLabel,
                formatCurrency(expense.amount),
                <Link
                  key={expense.id}
                  href={`/expenses?expenseId=${encodeURIComponent(expense.id)}`}
                  className="font-medium text-brand-700 underline-offset-2 hover:underline"
                >
                  Open expense
                </Link>
              ])}
            />
          ) : (
            <p className="text-sm text-ink-600">No recognized project expenses yet.</p>
          )}
        </Card>

        <Card title="Supporting records" subtitle="Open the project-scoped source views behind this overview.">
          <div className="flex flex-wrap gap-2">
            <Link href={spendingHref} className="gf-btn-secondary">
              Open Spending
            </Link>
            <Link href={`${spendingHref}&view=transactions`} className="gf-btn-secondary">
              Open transactions
            </Link>
            <Link href={`${spendingHref}&view=drilling-reports`} className="gf-btn-secondary">
              Open drilling reports
            </Link>
            <Link href={`/reports?workspace=project&projectId=${encodeURIComponent(projectId)}`} className="gf-btn-secondary">
              Open Reports
            </Link>
          </div>
        </Card>
      </div>
    </section>
  );
}
