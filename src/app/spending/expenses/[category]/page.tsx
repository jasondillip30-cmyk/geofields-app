"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";

import { AccessGate } from "@/components/layout/access-gate";
import { useAnalyticsFilters } from "@/components/layout/analytics-filters-provider";
import { Card } from "@/components/ui/card";
import { DataTable } from "@/components/ui/table";
import { formatCurrency, formatNumber } from "@/lib/utils";

interface SpendingCategoryLedgerRow {
  id: string;
  date: string;
  item: string;
  quantityUsed: number;
  totalCost: number;
  rig: string;
  reportHole: string;
}

interface SpendingCategoryLedgerPayload {
  summary: {
    totalCost: number;
    totalQuantity: number;
  };
  rows: SpendingCategoryLedgerRow[];
}

const emptyLedger: SpendingCategoryLedgerPayload = {
  summary: {
    totalCost: 0,
    totalQuantity: 0
  },
  rows: []
};

export default function SpendingCategoryDetailPage() {
  const params = useParams<{ category: string }>();
  const categoryParam = useMemo(() => {
    const rawValue = Array.isArray(params?.category) ? params.category[0] : params?.category || "";
    const trimmed = `${rawValue || ""}`.trim();
    if (!trimmed) {
      return "";
    }
    try {
      return decodeURIComponent(trimmed);
    } catch {
      return trimmed;
    }
  }, [params?.category]);

  const { filters } = useAnalyticsFilters();
  const scopeProjectId = filters.projectId !== "all" ? filters.projectId : "";
  const isSingleProjectScope = scopeProjectId.length > 0;
  const [loading, setLoading] = useState(false);
  const [ledger, setLedger] = useState<SpendingCategoryLedgerPayload>(emptyLedger);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const loadLedger = useCallback(async () => {
    if (!isSingleProjectScope || !categoryParam) {
      setLedger(emptyLedger);
      setErrorMessage(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setErrorMessage(null);
    try {
      const query = new URLSearchParams();
      query.set("projectId", scopeProjectId);
      query.set("category", categoryParam);
      if (filters.from) query.set("from", filters.from);
      if (filters.to) query.set("to", filters.to);

      const response = await fetch(`/api/spending/expenses?${query.toString()}`, {
        cache: "no-store"
      });
      if (!response.ok) {
        throw new Error("Failed to load category expense details.");
      }
      const payload = (await response.json()) as SpendingCategoryLedgerPayload;
      setLedger({
        summary: payload.summary || emptyLedger.summary,
        rows: Array.isArray(payload.rows) ? payload.rows : []
      });
    } catch (error) {
      setLedger(emptyLedger);
      setErrorMessage(error instanceof Error ? error.message : "Failed to load category expense details.");
    } finally {
      setLoading(false);
    }
  }, [categoryParam, filters.from, filters.to, isSingleProjectScope, scopeProjectId]);

  useEffect(() => {
    void loadLedger();
  }, [loadLedger]);

  const tableRows = useMemo(
    () =>
      ledger.rows.map((row) => [
        formatDate(row.date),
        row.item,
        formatNumber(row.quantityUsed),
        formatCurrency(row.totalCost),
        row.rig || "-",
        row.reportHole || "-"
      ]),
    [ledger.rows]
  );

  const drillingWorkspaceHref = useMemo(() => {
    const search = new URLSearchParams();
    if (isSingleProjectScope) {
      search.set("projectId", scopeProjectId);
    }
    if (filters.from) search.set("from", filters.from);
    if (filters.to) search.set("to", filters.to);
    search.set("view", "drilling-reports");
    const query = search.toString();
    return query ? `/spending?${query}` : "/spending?view=drilling-reports";
  }, [filters.from, filters.to, isSingleProjectScope, scopeProjectId]);

  return (
    <AccessGate
      permission="finance:view"
      fallback={
        <Card title="Finance permission required">
          <p className="text-sm text-ink-700">
            Expense category detail is available to finance roles only.
          </p>
          <Link href={drillingWorkspaceHref} className="gf-btn-subtle mt-3 inline-flex">
            Open drilling reports in Project Operations
          </Link>
        </Card>
      }
    >
      <div className="gf-page-stack">
        {!isSingleProjectScope ? (
          <Card title="Select one project to continue">
            <p className="text-sm text-ink-700">
              Project Operations detail is project-first. Choose one project in the top bar to open category-level expense rows.
            </p>
          </Card>
        ) : (
          <section className="gf-section space-y-4">
            <Card>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="space-y-1">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Project Operations / Expenses</p>
                  <h2 className="text-xl font-semibold text-ink-900">{categoryParam || "Category"}</h2>
                </div>
                <Link href="/spending" className="gf-btn-subtle">
                  Back to Project Operations
                </Link>
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-sm font-medium text-slate-700">
                  Total cost: {formatCurrency(ledger.summary.totalCost)}
                </span>
                <span className="rounded-full border border-brand-200 bg-brand-50 px-3 py-1 text-sm font-medium text-brand-800">
                  Quantity used: {formatNumber(ledger.summary.totalQuantity)}
                </span>
              </div>
            </Card>

            <Card title="Expense details">
              {errorMessage ? (
                <p className="text-sm text-red-700">{errorMessage}</p>
              ) : loading ? (
                <p className="text-sm text-slate-600">Loading expense details...</p>
              ) : tableRows.length === 0 ? (
                <p className="text-sm text-slate-600">No expense rows for this category in current scope.</p>
              ) : (
                <DataTable
                  columns={["Date", "Item", "Quantity used", "Total cost", "Rig", "Report/Hole"]}
                  rows={tableRows}
                  compact
                />
              )}
            </Card>
          </section>
        )}
      </div>
    </AccessGate>
  );
}

function formatDate(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toISOString().slice(0, 10);
}
