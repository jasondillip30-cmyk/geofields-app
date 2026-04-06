"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { RotateCw } from "lucide-react";

import { AccessGate } from "@/components/layout/access-gate";
import { useRegisterCopilotContext } from "@/components/layout/ai-copilot-context";
import { useAnalyticsFilters } from "@/components/layout/analytics-filters-provider";
import { scrollToFocusElement, useCopilotFocusTarget } from "@/components/layout/copilot-focus-target";
import { FilterScopeBanner, hasActiveScopeFilters } from "@/components/layout/filter-scope-banner";
import {
  AnalyticsEmptyState,
  getScopedKpiHelper,
  getScopedKpiValue
} from "@/components/layout/analytics-empty-state";
import { useRole } from "@/components/layout/role-provider";
import {
  BudgetPlanModal,
  type BudgetPlanModalInitialData,
  type BudgetPlanModalPayload
} from "@/components/modules/budget-plan-modal";
import { Card, MetricCard } from "@/components/ui/card";
import { SectionHeader } from "@/components/ui/section-header";
import { DataTable } from "@/components/ui/table";
import type { CopilotPageContext } from "@/lib/ai/contextual-copilot";
import { canAccess } from "@/lib/auth/permissions";
import {
  BudgetAlertLevel,
  BudgetClassifiedSpendRow,
  BudgetVsActualRow,
  BudgetVsActualSummaryResponse,
  roundCurrency
} from "@/lib/budget-vs-actual";
import {
  buildClassificationAudit,
  buildCompositionFromExpenses,
  buildFiltersQuery,
  deriveOperationalBudgetStatus,
  deriveProjectBudgetPeriod,
  EMPTY_SPEND_COMPOSITION,
  formatDate,
  formatPercentUsed,
  readApiError,
  reconcileCompositionToRecognizedSpend,
  toDateKey,
  type ClassificationAudit,
  type OperationalBudgetStatus,
  type SpendComposition
} from "@/lib/budget-vs-actual-workspace";
import { cn, formatCurrency } from "@/lib/utils";

type BudgetScopeType = "RIG" | "PROJECT";
type BudgetSummaryPayload = BudgetVsActualSummaryResponse;

interface BudgetPlanRow {
  id: string;
  scopeType: BudgetScopeType;
  name: string;
  amount: number;
  currency: string;
  periodStart: string;
  periodEnd: string;
  isActive: boolean;
  notes: string | null;
  clientId: string | null;
  projectId: string | null;
  rigId: string | null;
  rig: { id: string; name: string } | null;
  project: { id: string; name: string } | null;
  client: { id: string; name: string } | null;
  createdBy: { id: string; name: string };
  updatedBy: { id: string; name: string };
  createdAt: string;
  updatedAt: string;
}

interface ProjectLookupRow {
  id: string;
  name: string;
  clientId: string;
  clientName: string;
  startDate: string;
  endDate: string | null;
  assignedRigId: string | null;
  status: string;
}

interface ClassifiedExpenseRow extends BudgetClassifiedSpendRow {
  id: string;
  trace: string;
}

const UNASSIGNED_PROJECT_ID = "__unassigned_project__";

const EMPTY_CLASSIFIED_EXPENSE_ROWS: ClassifiedExpenseRow[] = [];

const emptySummary: BudgetSummaryPayload = {
  filters: { clientId: "all", rigId: "all", from: null, to: null },
  totals: { totalBudget: 0, recognizedSpend: 0, remainingBudget: 0, overspentCount: 0 },
  byRig: [],
  byProject: [],
  alerts: {
    overspentCount: 0,
    criticalCount: 0,
    watchCount: 0,
    noBudgetCount: 0,
    attentionCount: 0
  },
  classification: {
    rows: [],
    purposeTotals: {
      recognizedSpendTotal: 0,
      breakdownCost: 0,
      maintenanceCost: 0,
      stockReplenishmentCost: 0,
      operatingCost: 0,
      otherUnlinkedCost: 0
    },
    categoryTotals: {},
    audit: {
      recognizedSpendTotal: 0,
      purposeTotals: {
        recognizedSpendTotal: 0,
        breakdownCost: 0,
        maintenanceCost: 0,
        stockReplenishmentCost: 0,
        operatingCost: 0,
        otherUnlinkedCost: 0
      },
      categoryTotals: {},
      purposeCounts: {},
      legacyUnlinkedCount: 0,
      reconciliationDelta: 0
    }
  }
};

export default function BudgetVsActualPage() {
  const { filters, resetFilters, setFilters } = useAnalyticsFilters();
  const { user } = useRole();
  const canEdit = Boolean(user?.role && canAccess(user.role, "finance:edit"));
  const isScoped = hasActiveScopeFilters(filters);
  const costTrackingHref = useMemo(() => {
    const params = buildFiltersQuery(filters);
    const query = params.toString();
    return `/cost-tracking${query ? `?${query}` : ""}`;
  }, [filters]);
  const alertsCenterHref = useMemo(() => {
    const params = buildFiltersQuery(filters);
    const query = params.toString();
    return `/alerts-center${query ? `?${query}` : ""}`;
  }, [filters]);
  const budgetVsActualHref = useMemo(() => {
    const params = buildFiltersQuery(filters);
    const query = params.toString();
    return `/cost-tracking/budget-vs-actual${query ? `?${query}` : ""}`;
  }, [filters]);

  const [summary, setSummary] = useState<BudgetSummaryPayload>(emptySummary);
  const [plans, setPlans] = useState<BudgetPlanRow[]>([]);
  const [clients, setClients] = useState<Array<{ id: string; name: string }>>([]);
  const [projects, setProjects] = useState<ProjectLookupRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [budgetModal, setBudgetModal] = useState<{
    open: boolean;
    mode: "create" | "edit";
    data: BudgetPlanModalInitialData | null;
  }>({
    open: false,
    mode: "create",
    data: null
  });
  const [rowDetailsModal, setRowDetailsModal] = useState<{
    open: boolean;
    rowId: string | null;
  }>({
    open: false,
    rowId: null
  });
  const [focusedBudgetRowId, setFocusedBudgetRowId] = useState<string | null>(null);
  const [focusedSectionId, setFocusedSectionId] = useState<string | null>(null);

  useCopilotFocusTarget({
    pageKey: "budget-vs-actual",
    onFocus: (target) => {
      setFocusedBudgetRowId(target.targetId || null);
      setFocusedSectionId(target.sectionId || null);
      requestAnimationFrame(() => {
        scrollToFocusElement({
          targetId: target.targetId || null,
          sectionId: target.sectionId || null
        });
      });
    }
  });

  useEffect(() => {
    if (!focusedBudgetRowId && !focusedSectionId) {
      return;
    }
    const timer = setTimeout(() => {
      setFocusedBudgetRowId(null);
      setFocusedSectionId(null);
    }, 2400);
    return () => clearTimeout(timer);
  }, [focusedBudgetRowId, focusedSectionId]);

  const loadBudgetSummary = useCallback(
    async (silent = false) => {
      if (!silent) {
        setLoading(true);
      } else {
        setRefreshing(true);
      }
      try {
        const params = new URLSearchParams();
        if (filters.from) params.set("from", filters.from);
        if (filters.to) params.set("to", filters.to);
        if (filters.clientId !== "all") params.set("clientId", filters.clientId);
        if (filters.rigId !== "all") params.set("rigId", filters.rigId);

        const query = params.toString();
        const response = await fetch(`/api/budgets/summary${query ? `?${query}` : ""}`, {
          cache: "no-store"
        });
        const payload = response.ok ? ((await response.json()) as BudgetSummaryPayload) : emptySummary;
        setSummary(payload || emptySummary);
      } catch {
        setSummary(emptySummary);
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

  const loadPlansAndLookups = useCallback(async () => {
    const [plansRes, clientsRes, projectsRes] = await Promise.all([
      fetch("/api/budgets/plans?activeOnly=false", { cache: "no-store" }),
      fetch("/api/clients", { cache: "no-store" }),
      fetch("/api/projects", { cache: "no-store" })
    ]);

    const plansPayload = plansRes.ok ? await plansRes.json() : { data: [] };
    const clientsPayload = clientsRes.ok ? await clientsRes.json() : { data: [] };
    const projectsPayload = projectsRes.ok ? await projectsRes.json() : { data: [] };

    setPlans((plansPayload.data || []) as BudgetPlanRow[]);
    setClients(
      ((clientsPayload.data || []) as Array<{ id: string; name: string }>).map((entry) => ({
        id: entry.id,
        name: entry.name
      }))
    );
    setProjects(
      (
        (projectsPayload.data || []) as Array<{
          id: string;
          name: string;
          clientId: string;
          startDate: string;
          endDate?: string | null;
          status?: string;
          assignedRigId?: string | null;
          client?: { id: string; name: string } | null;
        }>
      ).map((entry) => ({
        id: entry.id,
        name: entry.name,
        clientId: entry.clientId,
        clientName: entry.client?.name || "",
        startDate: entry.startDate,
        endDate: entry.endDate || null,
        assignedRigId: entry.assignedRigId || null,
        status: entry.status || "PLANNED"
      }))
    );
  }, []);

  const refreshWorkspace = useCallback(
    async (silent = false) => {
      await Promise.all([loadBudgetSummary(silent), loadPlansAndLookups()]);
    },
    [loadBudgetSummary, loadPlansAndLookups]
  );

  useEffect(() => {
    void refreshWorkspace();
  }, [refreshWorkspace]);

  useEffect(() => {
    const interval = setInterval(() => {
      void loadBudgetSummary(true);
    }, 12000);
    return () => clearInterval(interval);
  }, [loadBudgetSummary]);

  const projectBudgetRows = useMemo(() => summary.byProject, [summary.byProject]);
  const projectTotals = useMemo(() => {
    let totalBudget = 0;
    let recognizedSpend = 0;
    for (const row of projectBudgetRows) {
      totalBudget += row.budgetAmount;
      recognizedSpend += row.recognizedSpend;
    }
    return {
      totalBudget: roundCurrency(totalBudget),
      recognizedSpend: roundCurrency(recognizedSpend),
      remainingBudget: roundCurrency(totalBudget - recognizedSpend)
    };
  }, [projectBudgetRows]);
  const hasBudgetData = useMemo(
    () =>
      projectBudgetRows.length > 0 ||
      projectTotals.totalBudget > 0 ||
      projectTotals.recognizedSpend > 0,
    [projectBudgetRows.length, projectTotals.recognizedSpend, projectTotals.totalBudget]
  );
  const isFilteredEmpty = !loading && isScoped && !hasBudgetData;
  const applyDatePreset = useCallback(
    (days: number) => {
      const end = new Date();
      end.setUTCHours(0, 0, 0, 0);
      const start = new Date(end);
      start.setUTCDate(end.getUTCDate() - Math.max(days - 1, 0));
      setFilters((current) => ({
        ...current,
        from: toDateKey(start),
        to: toDateKey(end)
      }));
    },
    [setFilters]
  );
  const handleClearFilters = useCallback(() => {
    resetFilters();
  }, [resetFilters]);
  const handleLast30Days = useCallback(() => {
    applyDatePreset(30);
  }, [applyDatePreset]);
  const handleLast90Days = useCallback(() => {
    applyDatePreset(90);
  }, [applyDatePreset]);
  const clientNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const client of clients) {
      map.set(client.id, client.name);
    }
    return map;
  }, [clients]);
  const projectById = useMemo(() => {
    const map = new Map<string, ProjectLookupRow>();
    for (const project of projects) {
      map.set(project.id, project);
    }
    return map;
  }, [projects]);
  const overviewCounts = useMemo(() => {
    let overspentCount = 0;
    let noBudgetCount = 0;
    let watchlistCount = 0;

    for (const row of projectBudgetRows) {
      const status = deriveOperationalBudgetStatus(row);
      if (status === "Overspent") {
        overspentCount += 1;
        continue;
      }
      if (status === "No Budget" && row.recognizedSpend > 0) {
        noBudgetCount += 1;
        continue;
      }
      if (status === "Watch") {
        watchlistCount += 1;
      }
    }

    return {
      overspentCount,
      noBudgetCount,
      watchlistCount
    };
  }, [projectBudgetRows]);
  const projectBudgetPlans = useMemo(
    () => plans.filter((plan) => plan.scopeType === "PROJECT"),
    [plans]
  );
  const findActiveProjectPlan = useCallback(
    (projectId: string) => {
      const candidates = projectBudgetPlans
        .filter((plan) => plan.isActive && plan.projectId === projectId)
        .sort((a, b) => {
          const byPeriodEnd = new Date(b.periodEnd).getTime() - new Date(a.periodEnd).getTime();
          if (byPeriodEnd !== 0) {
            return byPeriodEnd;
          }
          return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
        });
      return candidates[0] || null;
    },
    [projectBudgetPlans]
  );
  const openBudgetEditorForProject = useCallback(
    (entry: BudgetVsActualRow) => {
      const project = projectById.get(entry.id) || null;
      const existingPlan = findActiveProjectPlan(entry.id);
      const projectPeriod = deriveProjectBudgetPeriod(project, existingPlan);
      const resolvedClientId = project?.clientId || existingPlan?.clientId || null;
      setBudgetModal({
        open: true,
        mode: existingPlan ? "edit" : "create",
        data: {
          id: existingPlan?.id,
          scopeType: "PROJECT",
          projectId: entry.id,
          clientId: resolvedClientId,
          name: existingPlan?.name || `${entry.name} Budget`,
          amount: existingPlan ? existingPlan.amount : entry.budgetAmount > 0 ? entry.budgetAmount : "",
          periodStart: projectPeriod.periodStart,
          periodEnd: projectPeriod.periodEnd,
          notes: existingPlan?.notes || ""
        }
      });
    },
    [findActiveProjectPlan, projectById]
  );

  const classifiedExpenseRows = useMemo(() => {
    return (summary.classification?.rows || []).map((row) => ({
      ...row,
      id: row.expenseId,
      trace: row.traceability
    }));
  }, [summary.classification?.rows]);

  const classifiedExpenseRowsByProject = useMemo(() => {
    const map = new Map<string, ClassifiedExpenseRow[]>();
    for (const row of classifiedExpenseRows) {
      const key = row.linkedProjectId || UNASSIGNED_PROJECT_ID;
      const bucket = map.get(key) || [];
      bucket.push(row);
      map.set(key, bucket);
    }
    return map;
  }, [classifiedExpenseRows]);

  const deterministicSpendByProject = useMemo(() => {
    const map = new Map<string, SpendComposition>();
    for (const [key, rows] of classifiedExpenseRowsByProject) {
      map.set(key, buildCompositionFromExpenses(rows));
    }
    return map;
  }, [classifiedExpenseRowsByProject]);

  const spendCompositionByProject = useMemo(() => {
    const map = new Map<string, SpendComposition>();
    for (const row of projectBudgetRows) {
      map.set(
        row.id,
        reconcileCompositionToRecognizedSpend(
          deterministicSpendByProject.get(row.id) || EMPTY_SPEND_COMPOSITION,
          row.recognizedSpend
        )
      );
    }
    return map;
  }, [deterministicSpendByProject, projectBudgetRows]);

  const spendPurposeSummary = useMemo(() => {
    const sharedPurposeTotals = summary.classification?.purposeTotals || {
      recognizedSpendTotal: 0,
      breakdownCost: 0,
      maintenanceCost: 0,
      operatingCost: 0,
      stockReplenishmentCost: 0,
      otherUnlinkedCost: 0
    };
    return reconcileCompositionToRecognizedSpend(
      {
        totalRecognizedSpend: sharedPurposeTotals.recognizedSpendTotal,
        breakdownCost: sharedPurposeTotals.breakdownCost,
        maintenanceCost: sharedPurposeTotals.maintenanceCost,
        operatingCost: sharedPurposeTotals.operatingCost,
        stockReplenishmentCost: sharedPurposeTotals.stockReplenishmentCost,
        otherUnlinkedCost: sharedPurposeTotals.otherUnlinkedCost
      },
      projectTotals.recognizedSpend
    );
  }, [projectTotals.recognizedSpend, summary.classification?.purposeTotals]);

  const openRowDetails = useCallback((rowId: string) => {
    setRowDetailsModal({
      open: true,
      rowId
    });
  }, []);

  const renderProjectActionCell = useCallback(
    (entry: BudgetVsActualRow) => {
      const hasActivePlan = Boolean(findActiveProjectPlan(entry.id));
      return (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => openRowDetails(entry.id)}
            className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-ink-700 hover:bg-slate-50"
          >
            View details
          </button>
          <Link
            href={`/projects/${entry.id}`}
            className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-ink-700 hover:bg-slate-50"
          >
            Open project
          </Link>
          {canEdit ? (
            <button
              type="button"
              onClick={() => openBudgetEditorForProject(entry)}
              className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50"
            >
              {hasActivePlan ? "Edit budget" : "Add budget"}
            </button>
          ) : null}
        </div>
      );
    },
    [canEdit, findActiveProjectPlan, openBudgetEditorForProject, openRowDetails]
  );

  const sortedProjectBudgetRows = useMemo(() => {
    return [...projectBudgetRows].sort((a, b) => {
      const statusRank = (row: BudgetVsActualRow) => {
        const status = deriveOperationalBudgetStatus(row);
        if (status === "Overspent") {
          return 0;
        }
        if (status === "No Budget") {
          return 1;
        }
        if (status === "Watch") {
          return 2;
        }
        return 3;
      };

      const rankDelta = statusRank(a) - statusRank(b);
      if (rankDelta !== 0) {
        return rankDelta;
      }

      if (deriveOperationalBudgetStatus(a) === "No Budget" && deriveOperationalBudgetStatus(b) === "No Budget") {
        return b.recognizedSpend - a.recognizedSpend;
      }

      const percentA = a.percentUsed || 0;
      const percentB = b.percentUsed || 0;
      if (percentB !== percentA) {
        return percentB - percentA;
      }
      return b.recognizedSpend - a.recognizedSpend;
    });
  }, [projectBudgetRows]);

  const projectRows = useMemo(
    () =>
      sortedProjectBudgetRows.map((entry) => [
        <div key={`${entry.id}-name`} className="space-y-0.5">
          <p className="font-medium text-ink-900">{entry.name}</p>
        </div>,
        projectById.get(entry.id)?.clientName ||
          clientNameById.get(projectById.get(entry.id)?.clientId || "") ||
          "—",
        formatCurrency(entry.budgetAmount),
        formatCurrency(entry.recognizedSpend),
        formatCurrency(entry.remainingBudget),
        formatPercentUsed(entry.percentUsed),
        <StatusBadge
          key={`${entry.id}-status`}
          status={deriveOperationalBudgetStatus(entry)}
        />,
        renderProjectActionCell(entry)
      ]),
    [
      clientNameById,
      projectById,
      renderProjectActionCell,
      sortedProjectBudgetRows
    ]
  );
  const projectRowIds = useMemo(
    () => sortedProjectBudgetRows.map((entry) => `ai-focus-${entry.id}`),
    [sortedProjectBudgetRows]
  );
  const projectRowClassNames = useMemo(
    () =>
      sortedProjectBudgetRows.map((entry) =>
        entry.id === focusedBudgetRowId ? "bg-indigo-50/70 ring-1 ring-inset ring-indigo-200" : ""
      ),
    [focusedBudgetRowId, sortedProjectBudgetRows]
  );

  const saveBudgetPlanFromModal = useCallback(async (payload: BudgetPlanModalPayload) => {
    if (!canEdit) {
      return;
    }
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const linkedProject = payload.projectId ? projectById.get(payload.projectId) || null : null;
      const projectPeriod = deriveProjectBudgetPeriod(linkedProject, payload);
      const periodStart = projectPeriod.periodStart || payload.periodStart;
      const periodEnd = projectPeriod.periodEnd || payload.periodEnd;

      if (!payload.projectId) {
        setError("Project context is required to save project budget details.");
        return;
      }
      if (!periodStart || !periodEnd) {
        setError("Project timeline is missing. Set project dates before saving budget.");
        return;
      }

      if (budgetModal.mode === "edit" && payload.id) {
        const response = await fetch(`/api/budgets/plans/${payload.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: payload.name,
            amount: payload.amount,
            periodStart,
            periodEnd,
            notes: payload.notes
          })
        });
        if (!response.ok) {
          setError(await readApiError(response, "Failed to update project budget."));
          return;
        }
        setNotice("Project budget updated.");
      } else {
        const response = await fetch("/api/budgets/plans", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            scopeType: "PROJECT",
            name: payload.name,
            amount: payload.amount,
            periodStart,
            periodEnd,
            notes: payload.notes,
            clientId: linkedProject?.clientId || payload.clientId,
            rigId: null,
            projectId: payload.projectId
          })
        });
        if (!response.ok) {
          setError(await readApiError(response, "Failed to add project budget."));
          return;
        }
        setNotice("Project budget added.");
      }
      setBudgetModal({ open: false, mode: "create", data: null });
      await refreshWorkspace(true);
    } finally {
      setSaving(false);
    }
  }, [budgetModal.mode, canEdit, projectById, refreshWorkspace]);

  const selectedRowDetails = useMemo(() => {
    if (!rowDetailsModal.open || !rowDetailsModal.rowId) {
      return null;
    }
    const row = projectBudgetRows.find((entry) => entry.id === rowDetailsModal.rowId) || null;
    if (!row) {
      return null;
    }
    const composition = spendCompositionByProject.get(row.id) || EMPTY_SPEND_COMPOSITION;
    const linkedExpenses = classifiedExpenseRowsByProject.get(row.id) || EMPTY_CLASSIFIED_EXPENSE_ROWS;
    const linkedSum = roundCurrency(
      linkedExpenses.reduce((sum, entry) => sum + entry.amount, 0)
    );
    const reconciliationDelta = roundCurrency(row.recognizedSpend - linkedSum);
    const classificationAudit = buildClassificationAudit({
      linkedExpenses,
      composition,
      recognizedSpend: row.recognizedSpend
    });
    return {
      row,
      composition,
      linkedExpenses,
      reconciliationDelta,
      classificationAudit
    };
  }, [
    classifiedExpenseRowsByProject,
    rowDetailsModal.open,
    rowDetailsModal.rowId,
    spendCompositionByProject,
    projectBudgetRows
  ]);

  const copilotContext = useMemo<CopilotPageContext>(
    () => ({
      pageKey: "budget-vs-actual",
      pageName: "Budget vs Actual",
      filters: {
        clientId: filters.clientId,
        rigId: filters.rigId,
        from: filters.from || null,
        to: filters.to || null
      },
      summaryMetrics: [
        { key: "totalProjectBudget", label: "Total Project Budget", value: projectTotals.totalBudget },
        { key: "recognizedSpend", label: "Recognized Spend", value: projectTotals.recognizedSpend },
        { key: "remainingBudget", label: "Remaining Budget", value: projectTotals.remainingBudget },
        { key: "overspentProjects", label: "Overspent Projects", value: overviewCounts.overspentCount },
        { key: "watchlistProjects", label: "Watchlist Projects", value: overviewCounts.watchlistCount },
        { key: "noBudgetProjects", label: "No Budget Projects", value: overviewCounts.noBudgetCount }
      ],
      tablePreviews: [
        {
          key: "project-budget-vs-actual",
          title: "Project Budget vs Actual",
          rowCount: sortedProjectBudgetRows.length,
          columns: ["Id", "Project", "Budget", "RecognizedSpend", "PercentUsed", "Status"],
          rows: sortedProjectBudgetRows.slice(0, 8).map((row) => ({
            id: row.id,
            project: row.name,
            budget: row.budgetAmount,
            recognizedSpend: row.recognizedSpend,
            percentUsed: row.percentUsed,
            status: row.statusLabel,
            href: budgetVsActualHref,
            targetId: row.id,
            sectionId: "project-budget-section",
            targetPageKey: "budget-vs-actual"
          }))
        }
      ],
      priorityItems: sortedProjectBudgetRows
        .map((row) => ({ ...row }))
        .filter((row) => row.alertLevel !== "NONE" || row.status === "NO_BUDGET")
        .sort((a, b) => {
          const rank = (level: BudgetAlertLevel) =>
            level === "OVERSPENT" ? 0 : level === "CRITICAL_90" ? 1 : level === "WATCH_80" ? 2 : 3;
          const levelDiff = rank(a.alertLevel) - rank(b.alertLevel);
          if (levelDiff !== 0) {
            return levelDiff;
          }
          const percentA = a.percentUsed || 0;
          const percentB = b.percentUsed || 0;
          if (percentB !== percentA) {
            return percentB - percentA;
          }
          return b.recognizedSpend - a.recognizedSpend;
        })
        .slice(0, 6)
        .map((row) => ({
          id: row.id,
          label: `Project: ${row.name}`,
          reason: `${row.statusLabel}${row.percentUsed !== null ? ` • ${formatPercentUsed(row.percentUsed)} used` : ""}`,
          severity:
            row.alertLevel === "OVERSPENT"
              ? ("CRITICAL" as const)
              : row.alertLevel === "CRITICAL_90"
                ? ("HIGH" as const)
                : row.alertLevel === "WATCH_80"
                  ? ("MEDIUM" as const)
                  : ("MEDIUM" as const),
          amount: row.recognizedSpend,
          href: budgetVsActualHref,
          issueType: row.status === "NO_BUDGET" ? "NO_BUDGET" : row.alertLevel,
          targetId: row.id,
          sectionId: "project-budget-section",
          targetPageKey: "budget-vs-actual"
        })),
      navigationTargets: [
        { label: "Open Cost Tracking", href: costTrackingHref, reason: "Inspect spend drivers behind budget pressure.", pageKey: "cost-tracking" },
        { label: "Open Alerts Center", href: alertsCenterHref, reason: "Triage budget-related alerts.", pageKey: "alerts-center" },
        { label: "Open Approvals", href: "/approvals", reason: "Review approvals impacting upcoming spend.", pageKey: "approvals" }
      ],
      notes: [
        "Missing budgets are tracked as No Budget and not treated as overspent."
      ]
    }),
    [
      alertsCenterHref,
      budgetVsActualHref,
      costTrackingHref,
      filters.clientId,
      filters.from,
      filters.rigId,
      filters.to,
      overviewCounts.noBudgetCount,
      overviewCounts.overspentCount,
      overviewCounts.watchlistCount,
      sortedProjectBudgetRows,
      projectTotals.recognizedSpend,
      projectTotals.remainingBudget,
      projectTotals.totalBudget
    ]
  );

  useRegisterCopilotContext(copilotContext);

  return (
    <AccessGate permission="finance:view">
      <div className="gf-page-stack">
        <FilterScopeBanner filters={filters} onClearFilters={handleClearFilters} />

        {!loading && !hasBudgetData ? (
          <Card title={isFilteredEmpty ? "No data for selected filters" : "No data recorded yet"}>
            <AnalyticsEmptyState
              variant={isFilteredEmpty ? "filtered-empty" : "no-data"}
              moduleHint="Add project budgets and recognized spend to populate budget tracking."
              scopeHint={`${projectBudgetRows.length} projects in current scope`}
              onClearFilters={handleClearFilters}
              onLast30Days={handleLast30Days}
              onLast90Days={handleLast90Days}
            />
          </Card>
        ) : null}

        <section
          id="budget-overview-section"
          className={cn(
            "gf-section",
            focusedSectionId === "budget-overview-section" && "rounded-2xl ring-2 ring-indigo-100 ring-offset-2 ring-offset-slate-50"
          )}
        >
          <SectionHeader
            title="Budget Performance Overview"
            description="Compare project budgets against recognized operating spend to confirm profitability pressure."
            action={
              <button
                type="button"
                className="gf-btn-subtle inline-flex items-center gap-1"
                onClick={() => void refreshWorkspace(true)}
              >
                <RotateCw size={13} className={refreshing ? "animate-spin" : ""} />
                Refresh
              </button>
            }
          />
          <div className="gf-kpi-grid-primary">
            <MetricCard
              label={isScoped ? "Project Budget in Scope" : "Total Project Budget"}
              value={getScopedKpiValue(formatCurrency(projectTotals.totalBudget), isFilteredEmpty)}
              change={getScopedKpiHelper(undefined, isFilteredEmpty)}
            />
            <MetricCard
              label="Recognized Spend"
              value={getScopedKpiValue(formatCurrency(projectTotals.recognizedSpend), isFilteredEmpty)}
              tone="warn"
              change={getScopedKpiHelper(undefined, isFilteredEmpty)}
            />
            <MetricCard
              label="Remaining Budget"
              value={getScopedKpiValue(formatCurrency(projectTotals.remainingBudget), isFilteredEmpty)}
              tone={projectTotals.remainingBudget < 0 ? "danger" : "good"}
              change={getScopedKpiHelper(undefined, isFilteredEmpty)}
            />
          </div>
          <div className="gf-kpi-grid-secondary">
            <MetricCard
              label="Overspent Project Count"
              value={getScopedKpiValue(`${overviewCounts.overspentCount}`, isFilteredEmpty)}
              tone="danger"
              change={getScopedKpiHelper(undefined, isFilteredEmpty)}
            />
            <MetricCard
              label="No-Budget Project Count"
              value={getScopedKpiValue(`${overviewCounts.noBudgetCount}`, isFilteredEmpty)}
              change={getScopedKpiHelper(undefined, isFilteredEmpty)}
            />
            <MetricCard
              label="Watchlist Project Count"
              value={getScopedKpiValue(`${overviewCounts.watchlistCount}`, isFilteredEmpty)}
              tone="warn"
              change={getScopedKpiHelper(undefined, isFilteredEmpty)}
            />
          </div>
          <div className="gf-inline-note">
            Approval grants permission. Financial reporting on this page uses posted / recognized operating costs, including completed receipt postings and approved stock-out recognition.
          </div>
          {summary.classification?.audit.legacyUnlinkedCount ? (
            <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              {summary.classification.audit.legacyUnlinkedCount} legacy records remain in Other / Unlinked due to incomplete historical linkage.
            </div>
          ) : null}
          <div className="mt-3 grid gap-2 rounded-xl border border-slate-200/80 bg-slate-50/70 p-3 sm:grid-cols-2 lg:grid-cols-5">
            <ScopeBreakdownBadge
              label="Breakdown Cost"
              value={getScopedKpiValue(formatCurrency(spendPurposeSummary.breakdownCost), isFilteredEmpty)}
            />
            <ScopeBreakdownBadge
              label="Maintenance Cost"
              value={getScopedKpiValue(formatCurrency(spendPurposeSummary.maintenanceCost), isFilteredEmpty)}
            />
            <ScopeBreakdownBadge
              label="Operating Cost"
              value={getScopedKpiValue(formatCurrency(spendPurposeSummary.operatingCost), isFilteredEmpty)}
            />
            <ScopeBreakdownBadge
              label="Stock Replenishment"
              value={getScopedKpiValue(formatCurrency(spendPurposeSummary.stockReplenishmentCost), isFilteredEmpty)}
            />
            <ScopeBreakdownBadge
              label="Other / Unlinked"
              value={getScopedKpiValue(formatCurrency(spendPurposeSummary.otherUnlinkedCost), isFilteredEmpty)}
            />
          </div>
          {notice ? <div className="gf-feedback-success">{notice}</div> : null}
          {error ? <div className="gf-feedback-error">{error}</div> : null}
        </section>

        <section
          id="project-budget-section"
          className={cn(
            "gf-section",
            focusedSectionId === "project-budget-section" && "rounded-2xl ring-2 ring-indigo-100 ring-offset-2 ring-offset-slate-50"
          )}
        >
          <SectionHeader
            title="Project Budget vs Actual"
            description="Project-level budget comparison with client context and recognized operating spend."
          />
          <p className="mb-3 text-xs text-slate-600">
            Recognized spend is sourced from posted operating costs already used in cost tracking and profitability views.
          </p>
          {loading ? (
            <Card>
              <p className="text-sm text-slate-600">Loading project budget comparison...</p>
            </Card>
          ) : projectRows.length === 0 ? (
            <AnalyticsEmptyState
              variant={isScoped ? "filtered-empty" : "no-data"}
              moduleHint="No project budget or spend data found yet."
              scopeHint={`${projectRows.length} project budget rows in current scope`}
              onClearFilters={handleClearFilters}
              onLast30Days={handleLast30Days}
              onLast90Days={handleLast90Days}
            />
          ) : (
            <DataTable
              columns={[
                "Project",
                "Client",
                "Budget",
                "Recognized Spend",
                "Remaining",
                "% Used",
                "Status",
                "Action"
              ]}
              rows={projectRows}
              rowIds={projectRowIds}
              rowClassNames={projectRowClassNames}
            />
          )}
        </section>

        <BudgetPlanModal
          open={budgetModal.open}
          mode={budgetModal.mode}
          saving={saving}
          initialData={budgetModal.data}
          clients={clients}
          projects={projects.map((entry) => ({
            id: entry.id,
            name: entry.name,
            clientId: entry.clientId
          }))}
          projectOnly
          onClose={() => {
            if (!saving) {
              setBudgetModal({ open: false, mode: "create", data: null });
            }
          }}
          onSave={saveBudgetPlanFromModal}
        />

        <BudgetRowDetailsModal
          open={rowDetailsModal.open}
          row={selectedRowDetails?.row || null}
          composition={selectedRowDetails?.composition || null}
          linkedExpenses={selectedRowDetails?.linkedExpenses || EMPTY_CLASSIFIED_EXPENSE_ROWS}
          reconciliationDelta={selectedRowDetails?.reconciliationDelta || 0}
          classificationAudit={selectedRowDetails?.classificationAudit || null}
          onClose={() =>
            setRowDetailsModal({
              open: false,
              rowId: null
            })
          }
        />
      </div>
    </AccessGate>
  );
}

function StatusBadge({
  status
}: {
  status: OperationalBudgetStatus;
}) {
  if (status === "Overspent") {
    return (
      <span className="rounded-full border border-red-300 bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-700">
        Overspent
      </span>
    );
  }
  if (status === "No Budget") {
    return (
      <span className="rounded-full border border-slate-300 bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700">
        No Budget
      </span>
    );
  }
  if (status === "Watch") {
    return (
      <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">
        Watch
      </span>
    );
  }
  return (
    <span className="rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
      Within Budget
    </span>
  );
}

function BudgetRowDetailsModal({
  open,
  row,
  composition,
  linkedExpenses,
  reconciliationDelta,
  classificationAudit,
  onClose
}: {
  open: boolean;
  row: BudgetVsActualRow | null;
  composition: SpendComposition | null;
  linkedExpenses: ClassifiedExpenseRow[];
  reconciliationDelta: number;
  classificationAudit: ClassificationAudit | null;
  onClose: () => void;
}) {
  if (!open || !row || !composition) {
    return null;
  }

  const expenseRows = linkedExpenses.map((entry) => [
    formatDate(entry.date),
    <a
      key={`${entry.id}-link`}
      href={`/expenses?expenseId=${entry.id}`}
      className="font-medium text-brand-700 underline"
    >
      {entry.id.slice(-8).toUpperCase()}
    </a>,
    entry.purposeLabel,
    formatCurrency(entry.amount),
    <div key={`${entry.id}-trace`} className="space-y-0.5">
      <p className="text-xs text-slate-700">{entry.trace}</p>
      <p className="text-[11px] text-slate-500">
        {entry.requisitionCode ? `Req ${entry.requisitionCode}` : null}
        {entry.movementSummary
          ? `${entry.requisitionCode ? " • " : ""}${entry.movementSummary}`
          : ""}
      </p>
    </div>
  ]);

  return (
    <div className="fixed inset-0 z-[93] flex items-center justify-center bg-slate-900/45 p-4">
      <button
        type="button"
        className="absolute inset-0"
        aria-label="Close spend details"
        onClick={onClose}
      />
      <div className="relative z-10 max-h-[92vh] w-full max-w-5xl overflow-y-auto rounded-2xl border border-slate-200 bg-white shadow-[0_24px_64px_rgba(15,23,42,0.24)]">
        <div className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 px-5 py-4 backdrop-blur">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Project Budget Detail
              </p>
              <h3 className="text-xl font-semibold text-ink-900">{row.name}</h3>
            </div>
            <button type="button" className="gf-btn-secondary" onClick={onClose}>
              Close
            </button>
          </div>
        </div>

        <div className="space-y-4 px-5 py-4">
          <div className="grid gap-3 md:grid-cols-4">
            <Card>
              <p className="text-xs text-slate-500">Budget</p>
              <p className="text-lg font-semibold text-ink-900">{formatCurrency(row.budgetAmount)}</p>
            </Card>
            <Card>
              <p className="text-xs text-slate-500">Recognized Spend</p>
              <p className="text-lg font-semibold text-ink-900">{formatCurrency(row.recognizedSpend)}</p>
            </Card>
            <Card>
              <p className="text-xs text-slate-500">Remaining</p>
              <p className="text-lg font-semibold text-ink-900">{formatCurrency(row.remainingBudget)}</p>
            </Card>
            <Card>
              <p className="text-xs text-slate-500">% Used</p>
              <div className="mt-1 flex items-center gap-2">
                <p className="text-lg font-semibold text-ink-900">{formatPercentUsed(row.percentUsed)}</p>
                <StatusBadge status={deriveOperationalBudgetStatus(row)} />
              </div>
            </Card>
          </div>

          <Card title="Spend Composition">
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
              <CompositionMetricCard label="Breakdown Cost" value={composition.breakdownCost} />
              <CompositionMetricCard label="Maintenance Cost" value={composition.maintenanceCost} />
              <CompositionMetricCard label="Operating Cost" value={composition.operatingCost} />
              <CompositionMetricCard
                label="Stock Replenishment"
                value={composition.stockReplenishmentCost}
              />
              <CompositionMetricCard label="Other / Unlinked" value={composition.otherUnlinkedCost} />
            </div>
          </Card>

          <Card title="Linked Recognized Expenses">
            {expenseRows.length === 0 ? (
              <p className="text-sm text-slate-600">
                No recognized expense records were linked directly for this row in the current scope.
              </p>
            ) : (
              <DataTable
                columns={["Date", "Expense", "Bucket", "Amount", "Traceability"]}
                rows={expenseRows}
                stickyHeader={false}
              />
            )}
          </Card>

          {reconciliationDelta !== 0 ? (
            <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              Some recognized spend in this scope is not fully linked to operational context yet.
              It is included under Other / Unlinked: {formatCurrency(reconciliationDelta)}.
            </div>
          ) : null}

          {classificationAudit && classificationAudit.delta !== 0 ? (
            <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              Classification delta detected: {formatCurrency(classificationAudit.delta)}.
              Review linked records for missing operational context.
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function CompositionMetricCard({
  label,
  value
}: {
  label: string;
  value: number;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
      <p className="text-[11px] text-slate-600">{label}</p>
      <p className="mt-1 text-sm font-semibold text-ink-900">{formatCurrency(value)}</p>
    </div>
  );
}

function ScopeBreakdownBadge({
  label,
  value
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
      <p className="text-[11px] text-slate-600">{label}</p>
      <p className="mt-1 text-sm font-semibold text-ink-900">{value}</p>
    </div>
  );
}
