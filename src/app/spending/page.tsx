"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, Pencil, RotateCw, Search, X } from "lucide-react";

import { AccessGate } from "@/components/layout/access-gate";
import { AnalyticsEmptyState } from "@/components/layout/analytics-empty-state";
import { useAnalyticsFilters } from "@/components/layout/analytics-filters-provider";
import { ProjectLockedBanner } from "@/components/layout/project-locked-banner";
import { DonutStatusChart } from "@/components/charts/donut-status-chart";
import { Card } from "@/components/ui/card";
import { DataTable } from "@/components/ui/table";
import { cn, formatCurrency, formatNumber, formatPercent } from "@/lib/utils";

interface SpendingCategoryRow {
  category: string;
  total: number;
  percentOfExpenses: number;
}

interface SpendingHoleRow {
  holeNumber: string;
  total: number;
  percentOfRevenue: number;
  percentOfIncome?: number;
}

interface SpendingTransactionRow {
  id: string;
  requisitionCode: string;
  date: string;
  merchant: string;
  category: string;
  amount: number;
  editable: boolean;
}

interface SpendingTransactionsPayload {
  categories: string[];
  rows: SpendingTransactionRow[];
}

interface SpendingSummaryPayload {
  totals: {
    income: number;
    expenses: number;
    netCashFlow: number;
  };
  revenueTrend: Array<{
    bucketStart: string;
    label: string;
    revenue: number;
  }>;
  timePeriod: {
    monthly: Array<{
      bucketKey: string;
      label: string;
      income: number;
      expenses: number;
    }>;
    yearly: Array<{
      bucketKey: string;
      label: string;
      income: number;
      expenses: number;
    }>;
  };
  expenseByCategory: SpendingCategoryRow[];
  incomeByHole: SpendingHoleRow[];
  largestExpenses: Array<{
    id: string;
    label: string;
    dateLabel: string;
    amount: number;
  }>;
  mostFrequentUsage: Array<{
    itemId: string;
    itemName: string;
    usageCount: number;
  }>;
}

interface SpendingDrillingSummaryPayload {
  stageConfigured: boolean;
  summary: {
    totalMeters: number;
    totalReports: number;
    totalWorkHours: number;
    totalExpenses: number;
    totalCostPerMeter: number | null;
  };
  metersByHole: Array<{
    holeNumber: string;
    totalMeters: number;
    percentOfMeters: number;
    currentDepth: number;
    currentStageLabel: string | null;
    stageConfigured: boolean;
    stageSegments: Array<{
      label: string;
      startM: number;
      endM: number;
      fillPercent: number;
    }>;
  }>;
}

const emptySummary: SpendingSummaryPayload = {
  totals: {
    income: 0,
    expenses: 0,
    netCashFlow: 0
  },
  revenueTrend: [],
  timePeriod: {
    monthly: [],
    yearly: []
  },
  expenseByCategory: [],
  incomeByHole: [],
  largestExpenses: [],
  mostFrequentUsage: []
};

const emptyDrillingSummary: SpendingDrillingSummaryPayload = {
  stageConfigured: false,
  summary: {
    totalMeters: 0,
    totalReports: 0,
    totalWorkHours: 0,
    totalExpenses: 0,
    totalCostPerMeter: null
  },
  metersByHole: []
};

const emptyTransactions: SpendingTransactionsPayload = {
  categories: [],
  rows: []
};

export default function SpendingPage() {
  const router = useRouter();
  const { filters, resetFilters, setFilters } = useAnalyticsFilters();
  const scopeProjectId = filters.projectId !== "all" ? filters.projectId : "";
  const isSingleProjectScope = scopeProjectId.length > 0;

  const [workspaceView, setWorkspaceView] = useState<"overview" | "transactions" | "drilling-reports">(
    "overview"
  );
  const [activeView, setActiveView] = useState<"expenses" | "revenue">("expenses");
  const [timePeriodView, setTimePeriodView] = useState<"monthly" | "yearly">("monthly");
  const [timePeriodOffset, setTimePeriodOffset] = useState(0);
  const [summary, setSummary] = useState<SpendingSummaryPayload>(emptySummary);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const [transactions, setTransactions] = useState<SpendingTransactionsPayload>(emptyTransactions);
  const [transactionsLoading, setTransactionsLoading] = useState(false);
  const [transactionsRefreshing, setTransactionsRefreshing] = useState(false);
  const [transactionCategoryFilter, setTransactionCategoryFilter] = useState("all");
  const [transactionSearch, setTransactionSearch] = useState("");
  const [selectedTransaction, setSelectedTransaction] = useState<SpendingTransactionRow | null>(null);
  const [transactionPanelOpen, setTransactionPanelOpen] = useState(false);
  const [transactionEditMode, setTransactionEditMode] = useState(false);
  const [transactionEditDate, setTransactionEditDate] = useState("");
  const [transactionEditMerchant, setTransactionEditMerchant] = useState("");
  const [transactionSaving, setTransactionSaving] = useState(false);
  const [transactionError, setTransactionError] = useState<string | null>(null);
  const [transactionNotice, setTransactionNotice] = useState<string | null>(null);
  const [drillingSummary, setDrillingSummary] =
    useState<SpendingDrillingSummaryPayload>(emptyDrillingSummary);
  const [drillingLoading, setDrillingLoading] = useState(false);
  const [drillingRefreshing, setDrillingRefreshing] = useState(false);
  const [selectedStageHole, setSelectedStageHole] = useState<
    SpendingDrillingSummaryPayload["metersByHole"][number] | null
  >(null);

  const hasData = useMemo(
    () =>
      summary.totals.income > 0 ||
      summary.totals.expenses > 0 ||
      summary.expenseByCategory.length > 0 ||
      summary.incomeByHole.length > 0,
    [
      summary.expenseByCategory.length,
      summary.incomeByHole.length,
      summary.totals.expenses,
      summary.totals.income
    ]
  );

  const loadSummary = useCallback(
    async (silent = false) => {
      if (!isSingleProjectScope) {
        setSummary(emptySummary);
        setLoading(false);
        setRefreshing(false);
        return;
      }

      if (silent) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }

      try {
        const params = new URLSearchParams();
        params.set("projectId", scopeProjectId);
        if (filters.from) params.set("from", filters.from);
        if (filters.to) params.set("to", filters.to);
        const response = await fetch(`/api/spending/summary?${params.toString()}`, {
          cache: "no-store"
        });
        const payload = response.ok ? ((await response.json()) as SpendingSummaryPayload) : emptySummary;
        setSummary(payload || emptySummary);
      } catch {
        setSummary(emptySummary);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [filters.from, filters.to, isSingleProjectScope, scopeProjectId]
  );

  const loadTransactions = useCallback(
    async (silent = false) => {
      if (!isSingleProjectScope) {
        setTransactions(emptyTransactions);
        setTransactionsLoading(false);
        setTransactionsRefreshing(false);
        return;
      }

      if (silent) {
        setTransactionsRefreshing(true);
      } else {
        setTransactionsLoading(true);
      }

      try {
        const params = new URLSearchParams();
        params.set("projectId", scopeProjectId);
        if (filters.from) params.set("from", filters.from);
        if (filters.to) params.set("to", filters.to);
        if (transactionCategoryFilter && transactionCategoryFilter !== "all") {
          params.set("category", transactionCategoryFilter);
        }
        if (transactionSearch.trim()) {
          params.set("q", transactionSearch.trim());
        }

        const response = await fetch(`/api/spending/transactions?${params.toString()}`, {
          cache: "no-store"
        });
        const payload = response.ok
          ? ((await response.json()) as SpendingTransactionsPayload)
          : emptyTransactions;
        setTransactions({
          categories: Array.isArray(payload.categories) ? payload.categories : [],
          rows: Array.isArray(payload.rows) ? payload.rows : []
        });
      } catch {
        setTransactions(emptyTransactions);
      } finally {
        setTransactionsLoading(false);
        setTransactionsRefreshing(false);
      }
    },
    [
      filters.from,
      filters.to,
      isSingleProjectScope,
      scopeProjectId,
      transactionCategoryFilter,
      transactionSearch
    ]
  );

  const loadDrillingSummary = useCallback(
    async (silent = false) => {
      if (!isSingleProjectScope) {
        setDrillingSummary(emptyDrillingSummary);
        setDrillingLoading(false);
        setDrillingRefreshing(false);
        return;
      }

      if (silent) {
        setDrillingRefreshing(true);
      } else {
        setDrillingLoading(true);
      }

      try {
        const params = new URLSearchParams();
        params.set("projectId", scopeProjectId);
        if (filters.from) params.set("from", filters.from);
        if (filters.to) params.set("to", filters.to);
        const response = await fetch(`/api/spending/drilling-reports/summary?${params.toString()}`, {
          cache: "no-store"
        });
        const payload = response.ok
          ? ((await response.json()) as SpendingDrillingSummaryPayload)
          : emptyDrillingSummary;
        setDrillingSummary({
          stageConfigured: Boolean(payload.stageConfigured),
          summary: payload.summary || emptyDrillingSummary.summary,
          metersByHole: Array.isArray(payload.metersByHole)
            ? payload.metersByHole.map((entry) => ({
                holeNumber: entry.holeNumber,
                totalMeters: Number.isFinite(entry.totalMeters) ? entry.totalMeters : 0,
                percentOfMeters: Number.isFinite(entry.percentOfMeters) ? entry.percentOfMeters : 0,
                currentDepth: Number.isFinite(entry.currentDepth) ? entry.currentDepth : 0,
                currentStageLabel: entry.currentStageLabel || null,
                stageConfigured: Boolean(entry.stageConfigured),
                stageSegments: Array.isArray(entry.stageSegments)
                  ? entry.stageSegments
                      .map((segment) => ({
                        label: `${segment.label || ""}`.trim(),
                        startM: Number(segment.startM),
                        endM: Number(segment.endM),
                        fillPercent: Number(segment.fillPercent)
                      }))
                      .filter(
                        (segment) =>
                          segment.label.length > 0 &&
                          Number.isFinite(segment.startM) &&
                          Number.isFinite(segment.endM) &&
                          Number.isFinite(segment.fillPercent)
                      )
                  : []
              }))
            : []
        });
      } catch {
        setDrillingSummary(emptyDrillingSummary);
      } finally {
        setDrillingLoading(false);
        setDrillingRefreshing(false);
      }
    },
    [filters.from, filters.to, isSingleProjectScope, scopeProjectId]
  );

  useEffect(() => {
    void loadSummary();
  }, [loadSummary]);

  useEffect(() => {
    if (workspaceView !== "transactions") {
      return;
    }
    void loadTransactions();
  }, [loadTransactions, workspaceView]);

  useEffect(() => {
    if (workspaceView !== "drilling-reports") {
      setSelectedStageHole(null);
      return;
    }
    void loadDrillingSummary();
  }, [loadDrillingSummary, workspaceView]);

  useEffect(() => {
    if (isSingleProjectScope) {
      return;
    }
    setTransactions(emptyTransactions);
    setDrillingSummary(emptyDrillingSummary);
    setSelectedTransaction(null);
    setTransactionPanelOpen(false);
    setTransactionEditMode(false);
    setTransactionError(null);
    setTransactionNotice(null);
    setSelectedStageHole(null);
  }, [isSingleProjectScope]);

  const applyDatePreset = useCallback(
    (days: number) => {
      const end = new Date();
      end.setUTCHours(0, 0, 0, 0);
      const start = new Date(end);
      start.setUTCDate(end.getUTCDate() - Math.max(days - 1, 0));
      setFilters((current) => ({
        ...current,
        from: toDateIso(start),
        to: toDateIso(end)
      }));
    },
    [setFilters]
  );

  const expenseRows = useMemo(
    () =>
      summary.expenseByCategory.map((entry) => [
        <span key={`${entry.category}-name`} className="font-medium text-ink-900">
          {entry.category}
        </span>,
        formatCurrency(entry.total),
        formatPercent(entry.percentOfExpenses)
      ]),
    [summary.expenseByCategory]
  );

  const incomeRows = useMemo(
    () =>
      summary.incomeByHole.map((entry) => [
        <span key={`${entry.holeNumber}-name`} className="font-medium text-ink-900">
          {entry.holeNumber}
        </span>,
        formatCurrency(entry.total),
        formatPercent(entry.percentOfRevenue ?? entry.percentOfIncome ?? 0)
      ]),
    [summary.incomeByHole]
  );

  const drillingRows = useMemo(
    () =>
      drillingSummary.metersByHole.map((entry) => [
        <span key={`${entry.holeNumber}-meters`} className="font-medium text-ink-900">
          {entry.holeNumber}
        </span>,
        entry.totalMeters.toLocaleString(undefined, { maximumFractionDigits: 2 }),
        formatPercent(entry.percentOfMeters),
        entry.stageConfigured ? (
          <button
            key={`${entry.holeNumber}-stage`}
            type="button"
            onClick={() => setSelectedStageHole(entry)}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-2 py-1.5 transition-colors hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
            title="Open stage details"
          >
            <span className="w-8 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-600">
              {entry.currentStageLabel || "—"}
            </span>
            <span className="inline-flex w-36 items-center gap-1">
              {entry.stageSegments.map((segment) => (
                <span
                  key={`${entry.holeNumber}-${segment.label}-${segment.startM}-${segment.endM}`}
                  className="relative h-2.5 min-w-0 flex-1 overflow-hidden rounded-sm border border-slate-300 bg-slate-100"
                >
                  <span
                    className="absolute inset-y-0 left-0 rounded-sm bg-brand-500/75"
                    style={{
                      width: `${Math.max(0, Math.min(100, segment.fillPercent))}%`
                    }}
                  />
                </span>
              ))}
            </span>
          </button>
        ) : (
          <span
            key={`${entry.holeNumber}-stage-na`}
            className="inline-flex rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700"
          >
            Not configured
          </span>
        )
      ]),
    [drillingSummary.metersByHole]
  );

  const largestExpenseRows = useMemo(
    () =>
      summary.largestExpenses.map((entry) => (
        <div key={entry.id} className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-ink-900">{entry.label}</p>
            <p className="text-xs text-slate-500">{entry.dateLabel}</p>
          </div>
          <p className="shrink-0 text-sm font-semibold text-ink-900">{formatCurrency(entry.amount)}</p>
        </div>
      )),
    [summary.largestExpenses]
  );

  const frequentUsageTiles = useMemo(
    () =>
      summary.mostFrequentUsage.map((entry) => (
        <div
          key={entry.itemId}
          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-center shadow-[0_1px_2px_rgba(15,23,42,0.04)]"
        >
          <p className="text-2xl font-semibold leading-none text-ink-900">{entry.usageCount}x</p>
          <p className="mt-1 line-clamp-2 text-sm text-slate-600">{entry.itemName}</p>
        </div>
      )),
    [summary.mostFrequentUsage]
  );

  const transactionGroups = useMemo(() => {
    const grouped: Array<{ date: string; rows: SpendingTransactionRow[] }> = [];
    for (const row of transactions.rows) {
      const lastGroup = grouped[grouped.length - 1];
      if (lastGroup && lastGroup.date === row.date) {
        lastGroup.rows.push(row);
      } else {
        grouped.push({
          date: row.date,
          rows: [row]
        });
      }
    }
    return grouped;
  }, [transactions.rows]);

  const flowBase = Math.max(summary.totals.income + summary.totals.expenses, 1);
  const revenueShare = Math.max(0, Math.min(100, (summary.totals.income / flowBase) * 100));
  const expenseShare = Math.max(0, Math.min(100, (summary.totals.expenses / flowBase) * 100));
  const isFilteredEmpty = (filters.from || filters.to) && !hasData;
  const activeHasData =
    activeView === "expenses" ? summary.expenseByCategory.length > 0 : summary.incomeByHole.length > 0;
  const centerTotal = activeView === "expenses" ? summary.totals.expenses : summary.totals.income;
  const periodBuckets =
    timePeriodView === "monthly" ? summary.timePeriod.monthly : summary.timePeriod.yearly;
  const visibleBucketCount = timePeriodView === "monthly" ? 10 : 6;
  const maxOffset = Math.max(0, periodBuckets.length - visibleBucketCount);
  const safeOffset = Math.min(timePeriodOffset, maxOffset);
  const visibleBuckets = periodBuckets.slice(safeOffset, safeOffset + visibleBucketCount);
  const periodMaxValue = periodBuckets.reduce((maxValue, entry) => {
    return Math.max(maxValue, entry.income, entry.expenses);
  }, 0);
  const canGoPrev = safeOffset > 0;
  const canGoNext = safeOffset < maxOffset;
  const hasDrillingData =
    drillingSummary.summary.totalMeters > 0 ||
    drillingSummary.summary.totalReports > 0 ||
    drillingSummary.metersByHole.length > 0;

  useEffect(() => {
    const targetOffset = Math.max(0, periodBuckets.length - visibleBucketCount);
    setTimePeriodOffset(targetOffset);
  }, [periodBuckets.length, timePeriodView, visibleBucketCount]);

  const openExpenseCategoryDrilldown = useCallback(
    (category: string) => {
      if (!isSingleProjectScope || !category) {
        return;
      }
      const params = new URLSearchParams();
      params.set("projectId", scopeProjectId);
      if (filters.from) params.set("from", filters.from);
      if (filters.to) params.set("to", filters.to);
      const query = params.toString();
      const basePath = `/spending/expenses/${encodeURIComponent(category)}`;
      router.push(query ? `${basePath}?${query}` : basePath);
    },
    [filters.from, filters.to, isSingleProjectScope, router, scopeProjectId]
  );

  const openProfitSubview = useCallback(() => {
    if (!isSingleProjectScope) {
      return;
    }
    const params = new URLSearchParams();
    params.set("projectId", scopeProjectId);
    if (filters.from) params.set("from", filters.from);
    if (filters.to) params.set("to", filters.to);
    const query = params.toString();
    router.push(query ? `/spending/profit?${query}` : "/spending/profit");
  }, [filters.from, filters.to, isSingleProjectScope, router, scopeProjectId]);

  const openSpendingDrillingReports = useCallback(() => {
    if (!isSingleProjectScope) {
      return;
    }
    const params = new URLSearchParams();
    params.set("projectId", scopeProjectId);
    if (filters.from) params.set("from", filters.from);
    if (filters.to) params.set("to", filters.to);
    const query = params.toString();
    router.push(query ? `/spending/drilling-reports?${query}` : "/spending/drilling-reports");
  }, [filters.from, filters.to, isSingleProjectScope, router, scopeProjectId]);

  const openTransactionPanel = useCallback((row: SpendingTransactionRow) => {
    setSelectedTransaction(row);
    setTransactionPanelOpen(true);
    setTransactionEditMode(false);
    setTransactionEditDate(row.date);
    setTransactionEditMerchant(row.merchant);
    setTransactionError(null);
    setTransactionNotice(null);
  }, []);

  const closeTransactionPanel = useCallback(() => {
    setTransactionPanelOpen(false);
    setTransactionEditMode(false);
    setTransactionError(null);
    setTransactionNotice(null);
  }, []);

  const handleSaveTransaction = useCallback(async () => {
    if (!selectedTransaction || !selectedTransaction.editable || transactionSaving) {
      return;
    }

    const nextMerchant = transactionEditMerchant.trim();
    if (!nextMerchant || !transactionEditDate) {
      setTransactionError("Date and merchant are required.");
      return;
    }

    setTransactionSaving(true);
    setTransactionError(null);
    setTransactionNotice(null);

    try {
      const response = await fetch(`/api/spending/transactions/${selectedTransaction.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          date: transactionEditDate,
          merchant: nextMerchant
        })
      });

      if (!response.ok) {
        throw new Error(await readApiError(response, "Failed to update transaction."));
      }

      const payload = (await response.json()) as {
        row?: SpendingTransactionRow;
      };
      const row = payload.row;
      if (!row) {
        throw new Error("Failed to update transaction.");
      }

      setTransactions((current) => ({
        ...current,
        rows: current.rows.map((entry) => (entry.id === row.id ? row : entry))
      }));
      setSelectedTransaction(row);
      setTransactionEditDate(row.date);
      setTransactionEditMerchant(row.merchant);
      setTransactionEditMode(false);
      setTransactionNotice("Transaction updated.");
    } catch (error) {
      setTransactionError(error instanceof Error ? error.message : "Failed to update transaction.");
    } finally {
      setTransactionSaving(false);
    }
  }, [selectedTransaction, transactionEditDate, transactionEditMerchant, transactionSaving]);

  return (
    <AccessGate permission="finance:view">
      <div className="gf-page-stack">
        {isSingleProjectScope ? <ProjectLockedBanner projectId={scopeProjectId} /> : null}

        {!isSingleProjectScope ? (
          <Card title="Select one project to continue">
            <p className="text-sm text-ink-700">
              Spending is project-first. Choose one project in the top bar to see overview, transactions, and drilling reports.
            </p>
          </Card>
        ) : (
          <section className="gf-section space-y-4">
            <Card>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setWorkspaceView("overview")}
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-sm font-medium transition-colors",
                    workspaceView === "overview"
                      ? "border-slate-300 bg-white text-ink-900"
                      : "border-transparent text-slate-600 hover:bg-slate-100 hover:text-ink-900"
                  )}
                >
                  Overview
                </button>
                <button
                  type="button"
                  onClick={() => setWorkspaceView("transactions")}
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-sm font-medium transition-colors",
                    workspaceView === "transactions"
                      ? "border-slate-300 bg-white text-ink-900"
                      : "border-transparent text-slate-600 hover:bg-slate-100 hover:text-ink-900"
                  )}
                >
                  Transactions
                </button>
                <button
                  type="button"
                  onClick={() => setWorkspaceView("drilling-reports")}
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-sm font-medium transition-colors",
                    workspaceView === "drilling-reports"
                      ? "border-slate-300 bg-white text-ink-900"
                      : "border-transparent text-slate-600 hover:bg-slate-100 hover:text-ink-900"
                  )}
                >
                  Drilling reports
                </button>
              </div>
            </Card>

            {workspaceView === "overview" ? (
              <>
                <Card>
                  <div className="space-y-4">
                    <div className="border-b border-slate-100 pb-3">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-500">TIME PERIOD</p>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <div className="inline-flex items-center rounded-full border border-slate-300 bg-white px-2 py-1">
                        <select
                          value={timePeriodView}
                          onChange={(event) => {
                            setTimePeriodView(event.target.value as "monthly" | "yearly");
                          }}
                          className="rounded-full border-none bg-transparent px-2 py-0.5 text-base text-ink-900 focus:outline-none"
                        >
                          <option value="monthly">Monthly</option>
                          <option value="yearly">Yearly</option>
                        </select>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setTimePeriodOffset((current) => Math.max(0, current - 1))}
                          disabled={!canGoPrev}
                          className={cn(
                            "inline-flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 transition-colors",
                            canGoPrev ? "hover:bg-slate-50" : "cursor-not-allowed opacity-45"
                          )}
                          aria-label="Previous period buckets"
                        >
                          <ChevronLeft size={14} />
                        </button>
                        <button
                          type="button"
                          onClick={() => setTimePeriodOffset((current) => Math.min(maxOffset, current + 1))}
                          disabled={!canGoNext}
                          className={cn(
                            "inline-flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 transition-colors",
                            canGoNext ? "hover:bg-slate-50" : "cursor-not-allowed opacity-45"
                          )}
                          aria-label="Next period buckets"
                        >
                          <ChevronRight size={14} />
                        </button>
                      </div>
                    </div>
                    {loading ? (
                      <p className="text-sm text-slate-600">Loading time period comparison...</p>
                    ) : visibleBuckets.length === 0 ? (
                      <p className="text-sm text-slate-600">No time period data for this scope.</p>
                    ) : (
                      <>
                        <div className="h-28 rounded-xl border border-slate-100 bg-slate-50/45 px-3 py-2">
                          <div className="flex h-full items-end justify-between gap-2">
                            {visibleBuckets.map((bucket) => (
                              <div key={bucket.bucketKey} className="flex min-w-0 flex-1 flex-col items-center gap-2">
                                <div className="flex h-20 items-end gap-1.5">
                                  <div
                                    className="w-4 rounded bg-emerald-700/35"
                                    style={{
                                      height: `${scaledBarHeight(bucket.income, periodMaxValue)}px`
                                    }}
                                    title={`Revenue: ${formatCurrency(bucket.income)}`}
                                  />
                                  <div
                                    className="w-4 rounded bg-lime-200"
                                    style={{
                                      height: `${scaledBarHeight(bucket.expenses, periodMaxValue)}px`
                                    }}
                                    title={`Expenses: ${formatCurrency(bucket.expenses)}`}
                                  />
                                </div>
                                <p className="truncate text-xs text-slate-500">{bucket.label}</p>
                              </div>
                            ))}
                          </div>
                        </div>
                        <div className="flex items-center gap-4 text-xs text-slate-500">
                          <span className="inline-flex items-center gap-1">
                            <span className="h-2.5 w-2.5 rounded bg-emerald-700/35" />
                            Revenue
                          </span>
                          <span className="inline-flex items-center gap-1">
                            <span className="h-2.5 w-2.5 rounded bg-lime-200" />
                            Expenses
                          </span>
                        </div>
                      </>
                    )}
                  </div>
                </Card>

                <div className="grid gap-4 lg:grid-cols-[2.2fr_1fr]">
                  <Card
                    title="Category breakdown"
                    action={
                      <button
                        type="button"
                        onClick={() => void loadSummary(true)}
                        className="gf-btn-subtle inline-flex items-center gap-1"
                      >
                        <RotateCw size={13} className={refreshing ? "animate-spin" : ""} />
                        Refresh
                      </button>
                    }
                  >
                    <div className="mb-4 flex items-center gap-2 border-b border-slate-100 pb-3">
                      <button
                        type="button"
                        onClick={() => setActiveView("expenses")}
                        className={cn(
                          "rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors",
                          activeView === "expenses"
                            ? "border border-slate-300 bg-white text-ink-900"
                            : "text-slate-600 hover:bg-slate-100 hover:text-ink-900"
                        )}
                      >
                        Expenses
                      </button>
                      <button
                        type="button"
                        onClick={() => setActiveView("revenue")}
                        className={cn(
                          "rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors",
                          activeView === "revenue"
                            ? "border border-slate-300 bg-white text-ink-900"
                            : "text-slate-600 hover:bg-slate-100 hover:text-ink-900"
                        )}
                      >
                        Revenue
                      </button>
                    </div>

                    {loading ? (
                      <p className="text-sm text-slate-600">Loading breakdown...</p>
                    ) : !hasData ? (
                      <AnalyticsEmptyState
                        variant={isFilteredEmpty ? "filtered-empty" : "no-data"}
                        moduleHint="Create drilling reports and recognized spend records to populate Spending."
                        onClearFilters={resetFilters}
                        onLast30Days={() => applyDatePreset(30)}
                        onLast90Days={() => applyDatePreset(90)}
                      />
                    ) : !activeHasData ? (
                      <p className="text-sm text-slate-600">
                        {activeView === "expenses"
                          ? "No recognized expense categories for this scope."
                          : "No hole-level revenue data for this scope."}
                      </p>
                    ) : (
                      <>
                        <div className="relative">
                          {activeView === "expenses" ? (
                            <DonutStatusChart
                              data={summary.expenseByCategory}
                              nameKey="category"
                              valueKey="total"
                              onElementClick={(payload) => openExpenseCategoryDrilldown(payload.category)}
                              clickHint="Click category to open expense details"
                            />
                          ) : (
                            <DonutStatusChart data={summary.incomeByHole} nameKey="holeNumber" valueKey="total" />
                          )}
                          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                            <p className="text-3xl font-semibold tracking-tight text-ink-900">{formatCurrency(centerTotal)}</p>
                            <p className="mt-1 text-xs text-slate-500">
                              {activeView === "expenses" ? "Amount spent" : "Revenue earned"}
                            </p>
                          </div>
                        </div>

                        <DataTable
                          className="mt-3"
                          columns={
                            activeView === "expenses"
                              ? ["Category", "Amount spent", "% of expenses"]
                              : ["Hole", "Amount", "% of revenue"]
                          }
                          rows={activeView === "expenses" ? expenseRows : incomeRows}
                          onRowClick={
                            activeView === "expenses"
                              ? (rowIndex) => {
                                  const category = summary.expenseByCategory[rowIndex]?.category || "";
                                  openExpenseCategoryDrilldown(category);
                                }
                              : undefined
                          }
                          compact
                        />
                      </>
                    )}
                  </Card>

                  <div className="space-y-4">
                    <Card title="Cash flow summary" subtitle="Revenue, expenses, and profit.">
                      <div className="space-y-3">
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Revenue</p>
                          <div className="mt-1 h-3 rounded-full bg-slate-100">
                            <div
                              className="h-3 rounded-full bg-emerald-600"
                              style={{ width: `${revenueShare}%` }}
                            />
                          </div>
                          <p className="mt-1 text-sm font-medium text-ink-900">{formatCurrency(summary.totals.income)}</p>
                        </div>
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Expenses</p>
                          <div className="mt-1 h-3 rounded-full bg-slate-100">
                            <div
                              className="h-3 rounded-full bg-amber-500"
                              style={{ width: `${expenseShare}%` }}
                            />
                          </div>
                          <p className="mt-1 text-sm font-medium text-ink-900">{formatCurrency(summary.totals.expenses)}</p>
                        </div>
                        <button
                          type="button"
                          onClick={openProfitSubview}
                          className="w-full rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-left transition-colors hover:bg-brand-100/70"
                        >
                          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Profit</p>
                          <p className="mt-1 text-base font-semibold text-ink-900">
                            {formatCurrency(summary.totals.netCashFlow)}
                          </p>
                        </button>
                      </div>
                    </Card>

                    <Card title="Largest expenses">
                      {loading ? (
                        <p className="text-sm text-slate-600">Loading largest expenses...</p>
                      ) : summary.largestExpenses.length === 0 ? (
                        <p className="text-sm text-slate-600">No recognized expenses in this scope.</p>
                      ) : (
                        <div className="space-y-3">{largestExpenseRows}</div>
                      )}
                    </Card>

                    <Card title="Most frequent usage">
                      {loading ? (
                        <p className="text-sm text-slate-600">Loading usage frequency...</p>
                      ) : summary.mostFrequentUsage.length === 0 ? (
                        <p className="text-sm text-slate-600">No usage recorded in this scope.</p>
                      ) : (
                        <div className="grid grid-cols-3 gap-2">{frequentUsageTiles}</div>
                      )}
                    </Card>
                  </div>
                </div>
              </>
            ) : workspaceView === "transactions" ? (
              <Card
                title="Transactions"
                subtitle="Completed live project purchases from requisition to receipt posting."
                action={
                  <button
                    type="button"
                    onClick={() => void loadTransactions(true)}
                    className="gf-btn-subtle inline-flex items-center gap-1"
                  >
                    <RotateCw size={13} className={transactionsRefreshing ? "animate-spin" : ""} />
                    Refresh
                  </button>
                }
              >
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="inline-flex items-center rounded-full border border-slate-300 bg-white px-2 py-1">
                        <select
                          value={transactionCategoryFilter}
                          onChange={(event) => {
                            setTransactionCategoryFilter(event.target.value);
                          }}
                          className="rounded-full border-none bg-transparent px-2 py-0.5 text-sm text-ink-900 focus:outline-none"
                        >
                          <option value="all">All categories</option>
                          {transactions.categories.map((category) => (
                            <option key={category} value={category}>
                              {category}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <label className="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-600">
                      <Search size={14} />
                      <input
                        value={transactionSearch}
                        onChange={(event) => setTransactionSearch(event.target.value)}
                        placeholder="Search merchant"
                        className="w-44 border-none bg-transparent text-sm text-ink-900 placeholder:text-slate-400 focus:outline-none"
                      />
                    </label>
                  </div>

                  {transactionsLoading ? (
                    <p className="text-sm text-slate-600">Loading transactions...</p>
                  ) : transactionGroups.length === 0 ? (
                    <p className="text-sm text-slate-600">No transactions found for this scope.</p>
                  ) : (
                    <div className="overflow-hidden rounded-xl border border-slate-200/85 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03),0_6px_14px_rgba(15,23,42,0.04)]">
                      <div className="overflow-x-auto">
                        <table className="min-w-full text-left">
                          <thead className="border-b border-slate-200/85 bg-slate-50/90">
                            <tr>
                              <th className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                                Merchant
                              </th>
                              <th className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                                Category
                              </th>
                              <th className="px-3 py-2 text-right text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                                Amount
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {transactionGroups.map((group) => (
                              <GroupRows
                                key={group.date}
                                groupDate={group.date}
                                rows={group.rows}
                                onRowClick={openTransactionPanel}
                              />
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              </Card>
            ) : (
              <div className="grid gap-4 lg:grid-cols-[2.2fr_1fr]">
                <Card
                  title="Drilling reports by hole"
                  subtitle="Meters drilled in this project scope."
                  action={
                    <button
                      type="button"
                      onClick={() => void loadDrillingSummary(true)}
                      className="gf-btn-subtle inline-flex items-center gap-1"
                    >
                      <RotateCw size={13} className={drillingRefreshing ? "animate-spin" : ""} />
                      Refresh
                    </button>
                  }
                >
                  {drillingLoading ? (
                    <p className="text-sm text-slate-600">Loading drilling summary...</p>
                  ) : !hasDrillingData ? (
                    <p className="text-sm text-slate-600">No drilling report data in this scope yet.</p>
                  ) : (
                    <>
                      <div className="relative">
                        <DonutStatusChart
                          data={drillingSummary.metersByHole}
                          nameKey="holeNumber"
                          valueKey="totalMeters"
                        />
                        <button
                          type="button"
                          onClick={openSpendingDrillingReports}
                          className="absolute left-1/2 top-1/2 w-44 -translate-x-1/2 -translate-y-1/2 rounded-full px-5 py-5 text-center transition-transform duration-200 hover:scale-[1.04] focus:scale-[1.04] focus:outline-none"
                          aria-label="Open drilling reports list"
                          title="Open drilling reports"
                        >
                          <p className="text-3xl font-semibold tracking-tight text-ink-900">
                            {drillingSummary.summary.totalMeters.toLocaleString(undefined, {
                              maximumFractionDigits: 2
                            })}
                          </p>
                          <p className="mt-1 text-xs text-slate-500">Meters drilled</p>
                        </button>
                      </div>

                      <DataTable
                        className="mt-3"
                        columns={["Hole", "Meters drilled", "% of meters", "Stage"]}
                        rows={drillingRows}
                        compact
                      />
                    </>
                  )}
                </Card>

                <div className="space-y-4">
                  <Card title="Total cost per meter">
                    <p className="text-2xl font-semibold tracking-tight text-ink-900">
                      {drillingSummary.summary.totalCostPerMeter === null
                        ? "—"
                        : formatCurrency(drillingSummary.summary.totalCostPerMeter)}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">Based on project expenses and total meters in scope.</p>
                  </Card>

                  <Card title="Work hours">
                    <p className="text-2xl font-semibold tracking-tight text-ink-900">
                      {drillingSummary.summary.totalWorkHours.toLocaleString(undefined, {
                        maximumFractionDigits: 2
                      })}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      Average work hours:{" "}
                      {drillingSummary.summary.totalReports > 0
                        ? formatNumber(
                            drillingSummary.summary.totalWorkHours / drillingSummary.summary.totalReports
                          )
                        : "—"}
                    </p>
                  </Card>

                  <Card title="Total reports">
                    <p className="text-2xl font-semibold tracking-tight text-ink-900">
                      {drillingSummary.summary.totalReports.toLocaleString()}
                    </p>
                    <button
                      type="button"
                      onClick={openSpendingDrillingReports}
                      className="mt-3 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-xs font-medium text-brand-800 transition-colors hover:bg-brand-100/70"
                    >
                      Open report list
                    </button>
                  </Card>
                </div>
              </div>
            )}
          </section>
        )}
      </div>

      {selectedStageHole ? (
        <div className="fixed inset-0 z-[81]">
          <button
            type="button"
            onClick={() => setSelectedStageHole(null)}
            className="absolute inset-0 bg-slate-900/30"
            aria-label="Close stage details"
          />
          <div className="absolute left-1/2 top-1/2 w-[min(92vw,680px)] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_24px_64px_rgba(15,23,42,0.24)] sm:p-5">
            <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Hole stage details</p>
                <p className="text-lg font-semibold text-ink-900">{selectedStageHole.holeNumber}</p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedStageHole(null)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 text-slate-600 transition-colors hover:bg-slate-50"
                aria-label="Close"
              >
                <X size={14} />
              </button>
            </div>

            <div className="mt-4 space-y-4">
              <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-3">
                <div className="flex flex-wrap items-center gap-3 text-sm text-slate-700">
                  <p>
                    <span className="font-semibold text-ink-900">Current stage:</span>{" "}
                    {selectedStageHole.currentStageLabel || "Not yet started"}
                  </p>
                  <p>
                    <span className="font-semibold text-ink-900">Current depth:</span>{" "}
                    {selectedStageHole.currentDepth.toLocaleString(undefined, {
                      maximumFractionDigits: 2
                    })}
                    m
                  </p>
                </div>
              </div>

              <div className="grid gap-2 sm:grid-cols-3">
                {selectedStageHole.stageSegments.map((segment) => {
                  const isCurrentStage = selectedStageHole.currentStageLabel === segment.label;
                  return (
                    <div
                      key={`${selectedStageHole.holeNumber}-segment-${segment.label}-${segment.startM}-${segment.endM}`}
                      className={cn(
                        "rounded-lg border px-3 py-2",
                        isCurrentStage ? "border-brand-300 bg-brand-50/45" : "border-slate-200 bg-white"
                      )}
                    >
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                        {segment.label}
                      </p>
                      <div className="mt-2 h-2.5 overflow-hidden rounded-sm border border-slate-300 bg-slate-100">
                        <div
                          className={cn(
                            "h-full rounded-sm",
                            isCurrentStage ? "bg-brand-600/80" : "bg-brand-500/65"
                          )}
                          style={{ width: `${Math.max(0, Math.min(100, segment.fillPercent))}%` }}
                        />
                      </div>
                      <p className="mt-2 text-xs text-slate-600">
                        {formatMeterRange(segment.startM, segment.endM)}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {transactionPanelOpen && selectedTransaction ? (
        <div className="fixed inset-0 z-[82]">
          <button
            type="button"
            onClick={closeTransactionPanel}
            className="absolute inset-0 bg-slate-900/30 backdrop-blur-[1px]"
            aria-label="Close transaction panel"
          />
          <aside className="absolute right-0 top-0 h-full w-full max-w-md overflow-y-auto border-l border-slate-200 bg-white p-4 shadow-[0_24px_64px_rgba(15,23,42,0.24)] sm:p-5">
            <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Transaction</p>
                <p className="text-lg font-semibold text-ink-900">{selectedTransaction.merchant}</p>
              </div>
              <button
                type="button"
                onClick={closeTransactionPanel}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 text-slate-600 transition-colors hover:bg-slate-50"
                aria-label="Close"
              >
                <X size={14} />
              </button>
            </div>

            <div className="mt-4 space-y-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Amount</p>
                <p className="mt-1 text-3xl font-semibold tracking-tight text-ink-900">
                  {formatCurrency(selectedTransaction.amount)}
                </p>
              </div>

              {transactionNotice ? (
                <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
                  {transactionNotice}
                </p>
              ) : null}
              {transactionError ? (
                <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                  {transactionError}
                </p>
              ) : null}

              {transactionEditMode ? (
                <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50/60 p-3">
                  <div>
                    <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Date</label>
                    <input
                      type="date"
                      value={transactionEditDate}
                      onChange={(event) => setTransactionEditDate(event.target.value)}
                      className="mt-1 h-10 w-full rounded-md border border-slate-300 px-2 text-sm text-ink-900"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Merchant</label>
                    <input
                      value={transactionEditMerchant}
                      onChange={(event) => setTransactionEditMerchant(event.target.value)}
                      className="mt-1 h-10 w-full rounded-md border border-slate-300 px-2 text-sm text-ink-900"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void handleSaveTransaction()}
                      disabled={transactionSaving}
                      className={cn(
                        "gf-btn-primary px-3 py-1.5 text-sm",
                        transactionSaving && "cursor-not-allowed opacity-60"
                      )}
                    >
                      {transactionSaving ? "Saving..." : "Save transaction"}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setTransactionEditMode(false);
                        setTransactionEditDate(selectedTransaction.date);
                        setTransactionEditMerchant(selectedTransaction.merchant);
                        setTransactionError(null);
                      }}
                      className="gf-btn-subtle px-3 py-1.5 text-sm"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50/60 p-3">
                  <DetailRow label="Date" value={formatTransactionGroupDate(selectedTransaction.date)} />
                  <DetailRow label="Merchant" value={selectedTransaction.merchant} />
                  <DetailRow label="Category" value={selectedTransaction.category} />
                  <DetailRow label="Requisition" value={selectedTransaction.requisitionCode} />
                </div>
              )}

              {!selectedTransaction.editable ? (
                <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  This legacy transaction cannot be edited here.
                </p>
              ) : null}

              {!transactionEditMode && selectedTransaction.editable ? (
                <button
                  type="button"
                  onClick={() => {
                    setTransactionEditMode(true);
                    setTransactionEditDate(selectedTransaction.date);
                    setTransactionEditMerchant(selectedTransaction.merchant);
                    setTransactionError(null);
                    setTransactionNotice(null);
                  }}
                  className="inline-flex items-center gap-1 rounded-full border border-slate-300 px-3 py-1.5 text-sm font-medium text-ink-900 transition-colors hover:bg-slate-50"
                >
                  <Pencil size={13} />
                  Edit transaction
                </button>
              ) : null}
            </div>
          </aside>
        </div>
      ) : null}
    </AccessGate>
  );
}

function GroupRows({
  groupDate,
  rows,
  onRowClick
}: {
  groupDate: string;
  rows: SpendingTransactionRow[];
  onRowClick: (row: SpendingTransactionRow) => void;
}) {
  return (
    <>
      <tr>
        <td colSpan={3} className="bg-slate-50/75 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          {formatTransactionGroupDate(groupDate)}
        </td>
      </tr>
      {rows.map((row) => (
        <tr
          key={row.id}
          onClick={() => onRowClick(row)}
          className="cursor-pointer border-b border-slate-100/85 transition-colors hover:bg-brand-50/35 last:border-b-0"
        >
          <td className="px-3 py-2.5 text-sm font-medium text-ink-900">{row.merchant}</td>
          <td className="px-3 py-2.5 text-sm text-slate-700">{row.category}</td>
          <td className="px-3 py-2.5 text-right text-sm font-semibold text-ink-900">{formatCurrency(row.amount)}</td>
        </tr>
      ))}
    </>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="text-sm text-ink-900">{value}</p>
    </div>
  );
}

async function readApiError(response: Response, fallback: string) {
  try {
    const payload = (await response.json()) as { message?: string };
    if (payload?.message) {
      return payload.message;
    }
  } catch {
    return fallback;
  }
  return fallback;
}

function toDateIso(value: Date) {
  return value.toISOString().slice(0, 10);
}

function scaledBarHeight(value: number, maxValue: number) {
  if (value <= 0 || maxValue <= 0) {
    return 0;
  }
  return Math.max(8, Math.round((value / maxValue) * 72));
}

function formatTransactionGroupDate(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
    year: "numeric"
  });
}

function formatMeterRange(startM: number, endM: number) {
  const safeStart = Number.isFinite(startM) ? startM : 0;
  const safeEnd = Number.isFinite(endM) ? endM : 0;
  return `${safeStart.toLocaleString(undefined, { maximumFractionDigits: 2 })}m - ${safeEnd.toLocaleString(
    undefined,
    { maximumFractionDigits: 2 }
  )}m`;
}
