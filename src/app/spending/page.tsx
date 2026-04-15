"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";

import { AccessGate } from "@/components/layout/access-gate";
import { useAnalyticsFilters } from "@/components/layout/analytics-filters-provider";
import { useRole } from "@/components/layout/role-provider";
import { Card } from "@/components/ui/card";
import { canAccess } from "@/lib/auth/permissions";
import { cn, formatCurrency, formatPercent } from "@/lib/utils";
import {
  emptyDrillingSummary,
  emptySummary,
  emptyTransactions,
  type SpendingDrillingPeriodBucket,
  type SpendingDrillingSummaryPayload,
  type SpendingHoleStageRow,
  type SpendingSummaryPayload,
  type SpendingTransactionPatchPayload,
  type SpendingTransactionRow,
  type SpendingTransactionsPayload
} from "./spending-page-types";
import {
  deriveScopedPeriodRange,
  readApiError,
  toDateIso
} from "./spending-page-utils";

const SpendingOverviewWorkspace = dynamic(
  () => import("./spending-overview-workspace").then((module) => module.SpendingOverviewWorkspace)
);
const SpendingTransactionsWorkspace = dynamic(
  () =>
    import("./spending-transactions-workspace").then((module) => module.SpendingTransactionsWorkspace)
);
const SpendingDrillingWorkspace = dynamic(
  () => import("./spending-drilling-workspace").then((module) => module.SpendingDrillingWorkspace)
);
const TransactionDetailPanel = dynamic(
  () => import("./spending-page-overlays").then((module) => module.TransactionDetailPanel)
);
const StageDetailsModal = dynamic(
  () => import("./spending-page-overlays").then((module) => module.StageDetailsModal)
);
const SpendingDrillingEntryModal = dynamic(
  () =>
    import("./spending-drilling-entry-modal").then((module) => module.SpendingDrillingEntryModal)
);

type SpendingWorkspaceView = "overview" | "transactions" | "drilling-reports";

export default function SpendingPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { role } = useRole();
  const { filters, resetFilters, setFilters, applyScope } = useAnalyticsFilters();
  const workspaceQuery = (searchParams.get("workspace") || "").trim().toLowerCase();
  const projectIdQuery = (searchParams.get("projectId") || "").trim();
  const fromQuery = searchParams.get("from");
  const toQuery = searchParams.get("to");
  const scopeProjectId = filters.projectId !== "all" ? filters.projectId : "";
  const isSingleProjectScope = scopeProjectId.length > 0;
  const canViewFinance = Boolean(role && canAccess(role, "finance:view"));
  const canViewDrilling = Boolean(role && canAccess(role, "drilling:view"));
  const canCreateDrillingReport = Boolean(role && canAccess(role, "drilling:submit"));

  const [workspaceView, setWorkspaceView] = useState<SpendingWorkspaceView>("overview");
  const [activeView, setActiveView] = useState<"expenses" | "revenue">("expenses");
  const [timePeriodView, setTimePeriodView] = useState<"monthly" | "yearly">("monthly");
  const [selectedPeriodKey, setSelectedPeriodKey] = useState("");
  const [timePeriodOffset, setTimePeriodOffset] = useState(0);
  const [drillingTimePeriodOffset, setDrillingTimePeriodOffset] = useState(0);
  const [summary, setSummary] = useState<SpendingSummaryPayload>(emptySummary);
  const [baseSummary, setBaseSummary] = useState<SpendingSummaryPayload>(emptySummary);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [focusedLoading, setFocusedLoading] = useState(false);

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
  const [baseDrillingSummary, setBaseDrillingSummary] =
    useState<SpendingDrillingSummaryPayload>(emptyDrillingSummary);
  const [drillingLoading, setDrillingLoading] = useState(false);
  const [drillingRefreshing, setDrillingRefreshing] = useState(false);
  const [focusedDrillingLoading, setFocusedDrillingLoading] = useState(false);
  const [selectedStageHole, setSelectedStageHole] = useState<SpendingHoleStageRow | null>(null);
  const [drillingEntryOpen, setDrillingEntryOpen] = useState(false);
  const [drillingEntryNotice, setDrillingEntryNotice] = useState<string | null>(null);
  const [requestedWorkspaceView, setRequestedWorkspaceView] =
    useState<SpendingWorkspaceView | null>(null);

  useEffect(() => {
    if (workspaceQuery !== "project" || !projectIdQuery || projectIdQuery === "all") {
      return;
    }

    applyScope({
      workspaceMode: "project",
      projectId: projectIdQuery,
      clientId: "all",
      rigId: "all",
      from: fromQuery ?? "",
      to: toQuery ?? ""
    });
  }, [applyScope, fromQuery, projectIdQuery, toQuery, workspaceQuery]);

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

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const syncRequestedView = () => {
      const query = new URLSearchParams(window.location.search);
      const rawView = (query.get("view") || "").trim().toLowerCase();
      if (rawView === "overview") {
        setRequestedWorkspaceView("overview");
        return;
      }
      if (rawView === "transactions") {
        setRequestedWorkspaceView("transactions");
        return;
      }
      if (rawView === "drilling-reports" || rawView === "drilling_reports") {
        setRequestedWorkspaceView("drilling-reports");
        return;
      }
      setRequestedWorkspaceView(null);
    };

    syncRequestedView();
    window.addEventListener("popstate", syncRequestedView);
    return () => {
      window.removeEventListener("popstate", syncRequestedView);
    };
  }, []);

  const requestSummary = useCallback(
    async (range?: { from?: string; to?: string }) => {
      if (!canViewFinance || !isSingleProjectScope) {
        return emptySummary;
      }
      const params = new URLSearchParams();
      params.set("projectId", scopeProjectId);
      if (range?.from) params.set("from", range.from);
      if (range?.to) params.set("to", range.to);

      const response = await fetch(`/api/spending/summary?${params.toString()}`, {
        cache: "no-store"
      });
      const payload = response.ok ? ((await response.json()) as SpendingSummaryPayload) : emptySummary;
      return normalizeSummaryPayload(payload);
    },
    [canViewFinance, isSingleProjectScope, scopeProjectId]
  );

  const loadTransactions = useCallback(
    async (silent = false) => {
      if (!canViewFinance || !isSingleProjectScope) {
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
      canViewFinance,
      filters.from,
      filters.to,
      isSingleProjectScope,
      scopeProjectId,
      transactionCategoryFilter,
      transactionSearch
    ]
  );

  const requestDrillingSummary = useCallback(
    async (range?: { from?: string; to?: string }) => {
      if (!isSingleProjectScope) {
        return emptyDrillingSummary;
      }

      const params = new URLSearchParams();
      params.set("projectId", scopeProjectId);
      if (range?.from) params.set("from", range.from);
      if (range?.to) params.set("to", range.to);

      const response = await fetch(`/api/spending/drilling-reports/summary?${params.toString()}`, {
        cache: "no-store"
      });
      const payload = response.ok
        ? ((await response.json()) as SpendingDrillingSummaryPayload)
        : emptyDrillingSummary;
      return normalizeDrillingSummaryPayload(payload);
    },
    [isSingleProjectScope, scopeProjectId]
  );

  const selectedPeriodRange = useMemo(() => {
    if (!selectedPeriodKey) {
      return null;
    }
    return deriveScopedPeriodRange({
      periodView: timePeriodView,
      bucketKey: selectedPeriodKey,
      baseFrom: filters.from,
      baseTo: filters.to
    });
  }, [filters.from, filters.to, selectedPeriodKey, timePeriodView]);

  const loadBaseSummary = useCallback(
    async (silent = false) => {
      if (!canViewFinance || !isSingleProjectScope) {
        setBaseSummary(emptySummary);
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
        const nextSummary = await requestSummary({
          from: filters.from,
          to: filters.to
        });
        setBaseSummary(nextSummary);
      } catch {
        setBaseSummary(emptySummary);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [canViewFinance, filters.from, filters.to, isSingleProjectScope, requestSummary]
  );

  const loadFocusedSummary = useCallback(
    async (range: { from: string; to: string }, silent = false) => {
      if (!canViewFinance || !isSingleProjectScope) {
        setSummary(emptySummary);
        setFocusedLoading(false);
        return;
      }

      if (silent) {
        setRefreshing(true);
      } else {
        setFocusedLoading(true);
      }

      try {
        const nextSummary = await requestSummary(range);
        setSummary(nextSummary);
      } catch {
        setSummary(emptySummary);
      } finally {
        setFocusedLoading(false);
        setRefreshing(false);
      }
    },
    [canViewFinance, isSingleProjectScope, requestSummary]
  );

  const loadBaseDrillingSummary = useCallback(
    async (silent = false) => {
      if (!isSingleProjectScope) {
        setBaseDrillingSummary(emptyDrillingSummary);
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
        const nextSummary = await requestDrillingSummary({
          from: filters.from,
          to: filters.to
        });
        setBaseDrillingSummary(nextSummary);
      } catch {
        setBaseDrillingSummary(emptyDrillingSummary);
      } finally {
        setDrillingLoading(false);
        setDrillingRefreshing(false);
      }
    },
    [filters.from, filters.to, isSingleProjectScope, requestDrillingSummary]
  );

  const loadFocusedDrillingSummary = useCallback(
    async (range: { from: string; to: string }, silent = false) => {
      if (!isSingleProjectScope) {
        setDrillingSummary(emptyDrillingSummary);
        setFocusedDrillingLoading(false);
        return;
      }

      if (silent) {
        setDrillingRefreshing(true);
      } else {
        setFocusedDrillingLoading(true);
      }

      try {
        const nextSummary = await requestDrillingSummary(range);
        setDrillingSummary(nextSummary);
      } catch {
        setDrillingSummary(emptyDrillingSummary);
      } finally {
        setFocusedDrillingLoading(false);
        setDrillingRefreshing(false);
      }
    },
    [isSingleProjectScope, requestDrillingSummary]
  );

  useEffect(() => {
    if (!canViewDrilling && !canViewFinance) {
      return;
    }

    if (!canViewFinance && canViewDrilling) {
      setWorkspaceView("drilling-reports");
      return;
    }

    if (!requestedWorkspaceView) {
      return;
    }

    if (!canViewFinance && requestedWorkspaceView !== "drilling-reports") {
      setWorkspaceView("drilling-reports");
      return;
    }

    setWorkspaceView(requestedWorkspaceView);
  }, [canViewDrilling, canViewFinance, requestedWorkspaceView]);

  useEffect(() => {
    void loadBaseSummary();
  }, [loadBaseSummary]);

  useEffect(() => {
    if (workspaceView !== "transactions") {
      return;
    }
    void loadTransactions();
  }, [loadTransactions, workspaceView]);

  useEffect(() => {
    void loadBaseDrillingSummary();
  }, [loadBaseDrillingSummary]);

  useEffect(() => {
    if (!selectedPeriodRange) {
      setSummary(baseSummary);
      setFocusedLoading(false);
      return;
    }
    if (!canViewFinance) {
      setSummary(emptySummary);
      return;
    }
    void loadFocusedSummary(selectedPeriodRange);
  }, [baseSummary, canViewFinance, loadFocusedSummary, selectedPeriodRange]);

  useEffect(() => {
    if (!selectedPeriodRange) {
      setDrillingSummary(baseDrillingSummary);
      setFocusedDrillingLoading(false);
      return;
    }
    void loadFocusedDrillingSummary(selectedPeriodRange);
  }, [baseDrillingSummary, loadFocusedDrillingSummary, selectedPeriodRange]);

  useEffect(() => {
    if (workspaceView !== "drilling-reports") {
      setSelectedStageHole(null);
    }
  }, [workspaceView]);

  useEffect(() => {
    if (isSingleProjectScope) {
      return;
    }
    setSummary(emptySummary);
    setBaseSummary(emptySummary);
    setTransactions(emptyTransactions);
    setBaseDrillingSummary(emptyDrillingSummary);
    setDrillingSummary(emptyDrillingSummary);
    setSelectedPeriodKey("");
    setSelectedTransaction(null);
    setTransactionPanelOpen(false);
    setTransactionEditMode(false);
    setTransactionError(null);
    setTransactionNotice(null);
    setSelectedStageHole(null);
    setDrillingEntryOpen(false);
    setDrillingEntryNotice(null);
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

  const handleTimePeriodViewChange = useCallback((nextView: "monthly" | "yearly") => {
    setTimePeriodView(nextView);
    setSelectedPeriodKey("");
  }, []);

  const handleSelectPeriodBucket = useCallback((bucketKey: string) => {
    setSelectedPeriodKey((current) => (current === bucketKey ? "" : bucketKey));
  }, []);

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
  const isFilteredEmpty = Boolean((filters.from || filters.to) && !hasData);
  const activeHasData =
    activeView === "expenses" ? summary.expenseByCategory.length > 0 : summary.incomeByHole.length > 0;
  const centerTotal = activeView === "expenses" ? summary.totals.expenses : summary.totals.income;
  const periodBuckets =
    timePeriodView === "monthly" ? baseSummary.timePeriod.monthly : baseSummary.timePeriod.yearly;
  const visibleBucketCount = timePeriodView === "monthly" ? 10 : 6;
  const maxOffset = Math.max(0, periodBuckets.length - visibleBucketCount);
  const safeOffset = Math.min(timePeriodOffset, maxOffset);
  const visibleBuckets = periodBuckets.slice(safeOffset, safeOffset + visibleBucketCount);
  const periodMaxValue = periodBuckets.reduce((maxValue, entry) => {
    return Math.max(maxValue, entry.income, entry.expenses);
  }, 0);
  const canGoPrev = safeOffset > 0;
  const canGoNext = safeOffset < maxOffset;
  const drillingPeriodBuckets =
    timePeriodView === "monthly"
      ? baseDrillingSummary.timePeriod.monthly
      : baseDrillingSummary.timePeriod.yearly;
  const drillingVisibleBucketCount = timePeriodView === "monthly" ? 10 : 6;
  const drillingMaxOffset = Math.max(0, drillingPeriodBuckets.length - drillingVisibleBucketCount);
  const safeDrillingOffset = Math.min(drillingTimePeriodOffset, drillingMaxOffset);
  const visibleDrillingBuckets = drillingPeriodBuckets.slice(
    safeDrillingOffset,
    safeDrillingOffset + drillingVisibleBucketCount
  );
  const drillingPeriodMaxMeters = drillingPeriodBuckets.reduce((maxValue, entry) => {
    return Math.max(maxValue, entry.totalMeters);
  }, 0);
  const canGoPrevDrilling = safeDrillingOffset > 0;
  const canGoNextDrilling = safeDrillingOffset < drillingMaxOffset;
  const hasDrillingData =
    drillingSummary.summary.totalMeters > 0 ||
    drillingSummary.summary.totalReports > 0 ||
    drillingSummary.metersByHole.length > 0;
  const selectedPeriodLabel = useMemo(() => {
    if (!selectedPeriodKey) {
      return "";
    }
    const combinedBuckets: SpendingDrillingPeriodBucket[] = [
      ...baseDrillingSummary.timePeriod.monthly,
      ...baseDrillingSummary.timePeriod.yearly
    ];
    const fromDrilling = combinedBuckets.find((bucket) => bucket.bucketKey === selectedPeriodKey);
    if (fromDrilling) {
      return fromDrilling.label;
    }
    const fromSummary = [...baseSummary.timePeriod.monthly, ...baseSummary.timePeriod.yearly].find(
      (bucket) => bucket.bucketKey === selectedPeriodKey
    );
    return fromSummary?.label || selectedPeriodKey;
  }, [baseDrillingSummary.timePeriod.monthly, baseDrillingSummary.timePeriod.yearly, baseSummary.timePeriod.monthly, baseSummary.timePeriod.yearly, selectedPeriodKey]);
  const summaryLoading = selectedPeriodRange ? focusedLoading : loading;
  const drillingDataLoading = selectedPeriodRange ? focusedDrillingLoading : drillingLoading;

  useEffect(() => {
    const targetOffset = Math.max(0, periodBuckets.length - visibleBucketCount);
    setTimePeriodOffset(targetOffset);
  }, [periodBuckets.length, timePeriodView, visibleBucketCount]);

  useEffect(() => {
    const targetOffset = Math.max(0, drillingPeriodBuckets.length - drillingVisibleBucketCount);
    setDrillingTimePeriodOffset(targetOffset);
  }, [drillingPeriodBuckets.length, drillingVisibleBucketCount, timePeriodView]);

  useEffect(() => {
    if (!selectedPeriodKey) {
      return;
    }
    const existsInSummary = periodBuckets.some((bucket) => bucket.bucketKey === selectedPeriodKey);
    const existsInDrilling = drillingPeriodBuckets.some((bucket) => bucket.bucketKey === selectedPeriodKey);
    if (!existsInSummary && !existsInDrilling) {
      setSelectedPeriodKey("");
    }
  }, [drillingPeriodBuckets, periodBuckets, selectedPeriodKey]);

  const handleOverviewRefresh = useCallback(() => {
    void loadBaseSummary(true);
    if (selectedPeriodRange) {
      void loadFocusedSummary(selectedPeriodRange, true);
    }
  }, [loadBaseSummary, loadFocusedSummary, selectedPeriodRange]);

  const handleDrillingRefresh = useCallback(() => {
    void loadBaseDrillingSummary(true);
    if (selectedPeriodRange) {
      void loadFocusedDrillingSummary(selectedPeriodRange, true);
    }
  }, [loadBaseDrillingSummary, loadFocusedDrillingSummary, selectedPeriodRange]);

  const openExpenseCategoryDrilldown = useCallback(
    (category: string) => {
      if (!canViewFinance || !isSingleProjectScope || !category) {
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
    [canViewFinance, filters.from, filters.to, isSingleProjectScope, router, scopeProjectId]
  );

  const openProfitSubview = useCallback(() => {
    if (!canViewFinance || !isSingleProjectScope) {
      return;
    }
    const params = new URLSearchParams();
    params.set("projectId", scopeProjectId);
    if (filters.from) params.set("from", filters.from);
    if (filters.to) params.set("to", filters.to);
    const query = params.toString();
    router.push(query ? `/spending/profit?${query}` : "/spending/profit");
  }, [canViewFinance, filters.from, filters.to, isSingleProjectScope, router, scopeProjectId]);

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

  const spendingDrillingReportsHref = useMemo(() => {
    if (!isSingleProjectScope) {
      return "/spending/drilling-reports";
    }
    const params = new URLSearchParams();
    params.set("projectId", scopeProjectId);
    if (filters.from) params.set("from", filters.from);
    if (filters.to) params.set("to", filters.to);
    const query = params.toString();
    return query ? `/spending/drilling-reports?${query}` : "/spending/drilling-reports";
  }, [filters.from, filters.to, isSingleProjectScope, scopeProjectId]);

  const openDrillingEntryModal = useCallback(() => {
    if (!isSingleProjectScope || !canCreateDrillingReport) {
      return;
    }
    setDrillingEntryNotice(null);
    setDrillingEntryOpen(true);
  }, [canCreateDrillingReport, isSingleProjectScope]);

  const handleDrillingEntrySaved = useCallback(() => {
    setDrillingEntryNotice("Report saved.");
    void loadBaseDrillingSummary(true);
    if (selectedPeriodRange) {
      void loadFocusedDrillingSummary(selectedPeriodRange, true);
    }
    if (canViewFinance) {
      void loadBaseSummary(true);
      if (selectedPeriodRange) {
        void loadFocusedSummary(selectedPeriodRange, true);
      }
    }
  }, [
    canViewFinance,
    loadBaseDrillingSummary,
    loadBaseSummary,
    loadFocusedDrillingSummary,
    loadFocusedSummary,
    selectedPeriodRange
  ]);

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

  const startTransactionEdit = useCallback(() => {
    if (!selectedTransaction || !selectedTransaction.editable) {
      return;
    }
    setTransactionEditMode(true);
    setTransactionEditDate(selectedTransaction.date);
    setTransactionEditMerchant(selectedTransaction.merchant);
    setTransactionError(null);
    setTransactionNotice(null);
  }, [selectedTransaction]);

  const cancelTransactionEdit = useCallback(() => {
    if (!selectedTransaction) {
      return;
    }
    setTransactionEditMode(false);
    setTransactionEditDate(selectedTransaction.date);
    setTransactionEditMerchant(selectedTransaction.merchant);
    setTransactionError(null);
  }, [selectedTransaction]);

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

      const payload = (await response.json()) as SpendingTransactionPatchPayload;
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
    <AccessGate anyOf={["finance:view", "drilling:view"]}>
      <div className="gf-page-stack">
        {!isSingleProjectScope ? (
          <Card title="Select one project to continue">
            <p className="text-sm text-ink-700">
              Project Operations is project-first. Choose one project in the top bar to continue.
            </p>
          </Card>
        ) : (
          <section className="gf-section space-y-4">
            {drillingEntryNotice ? (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                {drillingEntryNotice}
              </div>
            ) : null}
            <Card>
              <div className="flex flex-wrap items-center gap-2">
                {canViewFinance ? (
                  <>
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
                  </>
                ) : null}
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

            {canViewFinance && workspaceView === "overview" ? (
              <SpendingOverviewWorkspace
                loading={summaryLoading}
                periodLoading={loading}
                refreshing={refreshing}
                summary={summary}
                hasData={hasData}
                isFilteredEmpty={isFilteredEmpty}
                activeHasData={activeHasData}
                activeView={activeView}
                centerTotal={centerTotal}
                expenseRows={expenseRows}
                incomeRows={incomeRows}
                largestExpenseRows={largestExpenseRows}
                frequentUsageTiles={frequentUsageTiles}
                revenueShare={revenueShare}
                expenseShare={expenseShare}
                timePeriodView={timePeriodView}
                selectedPeriodKey={selectedPeriodKey}
                selectedPeriodLabel={selectedPeriodLabel}
                isPeriodScoped={Boolean(selectedPeriodRange)}
                visibleBuckets={visibleBuckets}
                periodMaxValue={periodMaxValue}
                canGoPrev={canGoPrev}
                canGoNext={canGoNext}
                onRefresh={handleOverviewRefresh}
                onActiveViewChange={setActiveView}
                onTimePeriodViewChange={handleTimePeriodViewChange}
                onSelectPeriodBucket={handleSelectPeriodBucket}
                onResetPeriodScope={() => setSelectedPeriodKey("")}
                onPrevPeriod={() => setTimePeriodOffset((current) => Math.max(0, current - 1))}
                onNextPeriod={() => setTimePeriodOffset((current) => Math.min(maxOffset, current + 1))}
                onClearFilters={resetFilters}
                onLast30Days={() => applyDatePreset(30)}
                onLast90Days={() => applyDatePreset(90)}
                onOpenExpenseCategory={openExpenseCategoryDrilldown}
                onOpenProfit={openProfitSubview}
              />
            ) : canViewFinance && workspaceView === "transactions" ? (
              <SpendingTransactionsWorkspace
                transactionsLoading={transactionsLoading}
                transactionsRefreshing={transactionsRefreshing}
                transactions={transactions}
                transactionCategoryFilter={transactionCategoryFilter}
                transactionSearch={transactionSearch}
                transactionGroups={transactionGroups}
                onRefresh={() => void loadTransactions(true)}
                onTransactionCategoryFilterChange={setTransactionCategoryFilter}
                onTransactionSearchChange={setTransactionSearch}
                onTransactionRowClick={openTransactionPanel}
              />
            ) : (
              <SpendingDrillingWorkspace
                canCreateReport={canCreateDrillingReport}
                showFinanceMetrics={canViewFinance}
                drillingLoading={drillingDataLoading}
                periodLoading={drillingLoading}
                drillingRefreshing={drillingRefreshing}
                timePeriodView={timePeriodView}
                selectedPeriodKey={selectedPeriodKey}
                selectedPeriodLabel={selectedPeriodLabel}
                isPeriodScoped={Boolean(selectedPeriodRange)}
                visiblePeriodBuckets={visibleDrillingBuckets}
                periodMaxMeters={drillingPeriodMaxMeters}
                canGoPrevPeriod={canGoPrevDrilling}
                canGoNextPeriod={canGoNextDrilling}
                drillingSummary={drillingSummary}
                hasDrillingData={hasDrillingData}
                drillingRows={drillingRows}
                onRefresh={handleDrillingRefresh}
                onTimePeriodViewChange={handleTimePeriodViewChange}
                onSelectPeriodBucket={handleSelectPeriodBucket}
                onResetPeriodScope={() => setSelectedPeriodKey("")}
                onPrevPeriod={() => setDrillingTimePeriodOffset((current) => Math.max(0, current - 1))}
                onNextPeriod={() => setDrillingTimePeriodOffset((current) => Math.min(drillingMaxOffset, current + 1))}
                onCreateReport={openDrillingEntryModal}
                onOpenReportsList={openSpendingDrillingReports}
              />
            )}
          </section>
        )}
      </div>

      <StageDetailsModal hole={selectedStageHole} onClose={() => setSelectedStageHole(null)} />
      <TransactionDetailPanel
        open={Boolean(transactionPanelOpen && selectedTransaction)}
        selectedTransaction={selectedTransaction}
        transactionPanelOpen={transactionPanelOpen}
        transactionNotice={transactionNotice}
        transactionError={transactionError}
        transactionEditMode={transactionEditMode}
        transactionEditDate={transactionEditDate}
        transactionEditMerchant={transactionEditMerchant}
        transactionSaving={transactionSaving}
        onClose={closeTransactionPanel}
        onEditDateChange={setTransactionEditDate}
        onEditMerchantChange={setTransactionEditMerchant}
        onSave={() => void handleSaveTransaction()}
        onStartEdit={startTransactionEdit}
        onCancelEdit={cancelTransactionEdit}
      />
      <SpendingDrillingEntryModal
        open={drillingEntryOpen}
        projectId={scopeProjectId}
        reportsHref={spendingDrillingReportsHref}
        onClose={() => setDrillingEntryOpen(false)}
        onSaved={handleDrillingEntrySaved}
      />
    </AccessGate>
  );
}

function normalizeSummaryPayload(payload: SpendingSummaryPayload | null | undefined) {
  const nextSummary = payload || emptySummary;
  return {
    ...emptySummary,
    ...nextSummary,
    revenueRateCard: nextSummary.revenueRateCard || emptySummary.revenueRateCard
  };
}

function normalizeDrillingSummaryPayload(payload: SpendingDrillingSummaryPayload | null | undefined) {
  const nextSummary = payload || emptyDrillingSummary;
  return {
    stageConfigured: Boolean(nextSummary.stageConfigured),
    timePeriod: {
      monthly: Array.isArray(nextSummary.timePeriod?.monthly)
        ? nextSummary.timePeriod.monthly
            .map((entry) => ({
              bucketKey: `${entry.bucketKey || ""}`.trim(),
              label: `${entry.label || ""}`.trim(),
              totalMeters: Number.isFinite(entry.totalMeters) ? entry.totalMeters : 0,
              totalReports: Number.isFinite(entry.totalReports) ? entry.totalReports : 0,
              totalWorkHours: Number.isFinite(entry.totalWorkHours) ? entry.totalWorkHours : 0
            }))
            .filter((entry) => entry.bucketKey.length > 0)
        : [],
      yearly: Array.isArray(nextSummary.timePeriod?.yearly)
        ? nextSummary.timePeriod.yearly
            .map((entry) => ({
              bucketKey: `${entry.bucketKey || ""}`.trim(),
              label: `${entry.label || ""}`.trim(),
              totalMeters: Number.isFinite(entry.totalMeters) ? entry.totalMeters : 0,
              totalReports: Number.isFinite(entry.totalReports) ? entry.totalReports : 0,
              totalWorkHours: Number.isFinite(entry.totalWorkHours) ? entry.totalWorkHours : 0
            }))
            .filter((entry) => entry.bucketKey.length > 0)
        : []
    },
    summary: nextSummary.summary || emptyDrillingSummary.summary,
    metersByHole: Array.isArray(nextSummary.metersByHole)
      ? nextSummary.metersByHole.map((entry) => ({
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
  };
}
