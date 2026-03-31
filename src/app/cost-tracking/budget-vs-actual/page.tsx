"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { RotateCw } from "lucide-react";

import { AccessGate } from "@/components/layout/access-gate";
import { useRegisterCopilotContext } from "@/components/layout/ai-copilot-context";
import { useAnalyticsFilters } from "@/components/layout/analytics-filters-provider";
import { scrollToFocusElement, useCopilotFocusTarget } from "@/components/layout/copilot-focus-target";
import { FilterScopeBanner, hasActiveScopeFilters } from "@/components/layout/filter-scope-banner";
import { useRole } from "@/components/layout/role-provider";
import { Card, MetricCard } from "@/components/ui/card";
import { SectionHeader } from "@/components/ui/section-header";
import { DataTable } from "@/components/ui/table";
import type { CopilotPageContext } from "@/lib/ai/contextual-copilot";
import { canAccess } from "@/lib/auth/permissions";
import type {
  BudgetAlertLevel,
  BudgetVsActualRow,
  BudgetVsActualSummaryResponse
} from "@/lib/budget-vs-actual";
import { cn, formatCurrency, formatPercent } from "@/lib/utils";

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

const emptySummary: BudgetSummaryPayload = {
  filters: { clientId: "all", rigId: "all", from: null, to: null },
  totals: { totalBudget: 0, approvedSpend: 0, remainingBudget: 0, overspentCount: 0 },
  byRig: [],
  byProject: [],
  alerts: {
    overspentCount: 0,
    criticalCount: 0,
    watchCount: 0,
    noBudgetCount: 0,
    attentionCount: 0
  }
};

const initialForm = {
  scopeType: "RIG" as BudgetScopeType,
  name: "",
  amount: "",
  periodStart: "",
  periodEnd: "",
  notes: "",
  clientId: "all",
  rigId: "all",
  projectId: "all"
};

export default function BudgetVsActualPage() {
  const { filters } = useAnalyticsFilters();
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
  const [rigs, setRigs] = useState<Array<{ id: string; name: string }>>([]);
  const [projects, setProjects] = useState<Array<{ id: string; name: string; clientId: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState(initialForm);
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
    const [plansRes, clientsRes, rigsRes, projectsRes] = await Promise.all([
      fetch("/api/budgets/plans?activeOnly=false", { cache: "no-store" }),
      fetch("/api/clients", { cache: "no-store" }),
      fetch("/api/rigs", { cache: "no-store" }),
      fetch("/api/projects", { cache: "no-store" })
    ]);

    const plansPayload = plansRes.ok ? await plansRes.json() : { data: [] };
    const clientsPayload = clientsRes.ok ? await clientsRes.json() : { data: [] };
    const rigsPayload = rigsRes.ok ? await rigsRes.json() : { data: [] };
    const projectsPayload = projectsRes.ok ? await projectsRes.json() : { data: [] };

    setPlans((plansPayload.data || []) as BudgetPlanRow[]);
    setClients(
      ((clientsPayload.data || []) as Array<{ id: string; name: string }>).map((entry) => ({
        id: entry.id,
        name: entry.name
      }))
    );
    setRigs(
      ((rigsPayload.data || []) as Array<{ id: string; rigCode?: string; name?: string }>).map((entry) => ({
        id: entry.id,
        name: entry.name || entry.rigCode || "Unnamed Rig"
      }))
    );
    setProjects(
      ((projectsPayload.data || []) as Array<{ id: string; name: string; clientId: string }>).map((entry) => ({
        id: entry.id,
        name: entry.name,
        clientId: entry.clientId
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

  const filteredProjects = useMemo(() => {
    if (form.scopeType !== "PROJECT") {
      return projects;
    }
    if (filters.clientId !== "all") {
      return projects.filter((entry) => entry.clientId === filters.clientId);
    }
    return projects;
  }, [filters.clientId, form.scopeType, projects]);

  const alertCounts = useMemo(() => {
    if (summary.alerts) {
      return summary.alerts;
    }
    const rows = [...summary.byRig, ...summary.byProject];
    const overspentCount = rows.filter((entry) => entry.alertLevel === "OVERSPENT").length;
    const criticalCount = rows.filter((entry) => entry.alertLevel === "CRITICAL_90").length;
    const watchCount = rows.filter((entry) => entry.alertLevel === "WATCH_80").length;
    const noBudgetCount = rows.filter((entry) => entry.status === "NO_BUDGET").length;
    return {
      overspentCount,
      criticalCount,
      watchCount,
      noBudgetCount,
      attentionCount: overspentCount + criticalCount
    };
  }, [summary.alerts, summary.byProject, summary.byRig]);

  const rigRows = useMemo(
    () =>
      summary.byRig.map((entry) => [
        <span key={`${entry.id}-name`} className="font-medium text-ink-900">
          {entry.name}
        </span>,
        formatCurrency(entry.budgetAmount),
        formatCurrency(entry.approvedSpend),
        formatCurrency(entry.remainingBudget),
        formatPercentUsed(entry.percentUsed),
        <StatusBadge
          key={`${entry.id}-status`}
          alertLevel={entry.alertLevel}
          statusLabel={entry.statusLabel}
        />
      ]),
    [summary.byRig]
  );
  const rigRowIds = useMemo(
    () => summary.byRig.map((entry) => `ai-focus-${entry.id}`),
    [summary.byRig]
  );
  const rigRowClassNames = useMemo(
    () =>
      summary.byRig.map((entry) =>
        entry.id === focusedBudgetRowId ? "bg-indigo-50/70 ring-1 ring-inset ring-indigo-200" : ""
      ),
    [focusedBudgetRowId, summary.byRig]
  );

  const projectRows = useMemo(
    () =>
      summary.byProject.map((entry) => [
        <span key={`${entry.id}-name`} className="font-medium text-ink-900">
          {entry.name}
        </span>,
        formatCurrency(entry.budgetAmount),
        formatCurrency(entry.approvedSpend),
        formatCurrency(entry.remainingBudget),
        formatPercentUsed(entry.percentUsed),
        <StatusBadge
          key={`${entry.id}-status`}
          alertLevel={entry.alertLevel}
          statusLabel={entry.statusLabel}
        />
      ]),
    [summary.byProject]
  );
  const projectRowIds = useMemo(
    () => summary.byProject.map((entry) => `ai-focus-${entry.id}`),
    [summary.byProject]
  );
  const projectRowClassNames = useMemo(
    () =>
      summary.byProject.map((entry) =>
        entry.id === focusedBudgetRowId ? "bg-indigo-50/70 ring-1 ring-inset ring-indigo-200" : ""
      ),
    [focusedBudgetRowId, summary.byProject]
  );

  const attentionEntries = useMemo(() => {
    const combined = [
      ...summary.byRig.map((entry) => ({ scope: "Rig", ...entry })),
      ...summary.byProject.map((entry) => ({ scope: "Project", ...entry }))
    ];

    return combined
      .filter((entry) => entry.alertLevel === "OVERSPENT" || entry.alertLevel === "CRITICAL_90")
      .sort((a, b) => {
        const rank = (level: BudgetAlertLevel) => (level === "OVERSPENT" ? 0 : 1);
        const levelOrder = rank(a.alertLevel) - rank(b.alertLevel);
        if (levelOrder !== 0) {
          return levelOrder;
        }
        const percentA = a.percentUsed || 0;
        const percentB = b.percentUsed || 0;
        if (percentB !== percentA) {
          return percentB - percentA;
        }
        return b.approvedSpend - a.approvedSpend;
      });
  }, [summary.byProject, summary.byRig]);

  const attentionRows = useMemo(
    () =>
      attentionEntries
      .map((entry) => [
        entry.scope,
        <span key={`${entry.scope}-${entry.id}-name`} className="font-medium text-ink-900">
          {entry.name}
        </span>,
        formatCurrency(entry.budgetAmount),
        formatCurrency(entry.approvedSpend),
        formatCurrency(entry.remainingBudget),
        formatPercentUsed(entry.percentUsed),
        <StatusBadge
          key={`${entry.scope}-${entry.id}-status`}
          alertLevel={entry.alertLevel}
          statusLabel={entry.statusLabel}
        />
      ]),
    [attentionEntries]
  );
  const attentionRowIds = useMemo(
    () => attentionEntries.map((entry) => `ai-focus-${entry.id}`),
    [attentionEntries]
  );
  const attentionRowClassNames = useMemo(
    () =>
      attentionEntries.map((entry) =>
        entry.id === focusedBudgetRowId ? "bg-indigo-50/70 ring-1 ring-inset ring-indigo-200" : ""
      ),
    [attentionEntries, focusedBudgetRowId]
  );

  const archivePlan = useCallback(
    async (planId: string) => {
      if (!canEdit) {
        return;
      }
      setError(null);
      setNotice(null);
      const response = await fetch(`/api/budgets/plans/${planId}`, { method: "DELETE" });
      if (!response.ok) {
        setError(await readApiError(response, "Failed to archive budget plan."));
        return;
      }
      setNotice("Budget plan archived.");
      await refreshWorkspace(true);
    },
    [canEdit, refreshWorkspace]
  );

  const submitPlan = useCallback(async () => {
    if (!canEdit) {
      return;
    }
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const payload = {
        scopeType: form.scopeType,
        name: form.name,
        amount: form.amount,
        periodStart: form.periodStart,
        periodEnd: form.periodEnd,
        notes: form.notes,
        clientId: form.scopeType === "RIG" && form.clientId !== "all" ? form.clientId : null,
        rigId: form.scopeType === "RIG" && form.rigId !== "all" ? form.rigId : null,
        projectId: form.scopeType === "PROJECT" && form.projectId !== "all" ? form.projectId : null
      };

      const response = await fetch("/api/budgets/plans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (!response.ok) {
        setError(await readApiError(response, "Failed to create budget plan."));
        return;
      }
      setNotice("Budget plan created.");
      setForm(initialForm);
      await refreshWorkspace(true);
    } finally {
      setSaving(false);
    }
  }, [canEdit, form, refreshWorkspace]);

  const planRows = useMemo(
    () =>
      plans.map((plan) => [
        <div key={`${plan.id}-name`} className="space-y-0.5">
          <p className="font-medium text-ink-900">{plan.name}</p>
          <p className="text-xs text-slate-500">
            {formatDate(plan.periodStart)} - {formatDate(plan.periodEnd)}
          </p>
        </div>,
        plan.scopeType === "RIG" ? "Rig Budget" : "Project Budget",
        plan.scopeType === "RIG" ? plan.rig?.name || "-" : plan.project?.name || "-",
        plan.client?.name || "-",
        formatCurrency(plan.amount),
        plan.isActive ? (
          <span key={`${plan.id}-active`} className="rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-800">
            Active
          </span>
        ) : (
          <span key={`${plan.id}-inactive`} className="rounded-full border border-slate-300 bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700">
            Archived
          </span>
        ),
        canEdit && plan.isActive ? (
          <button
            key={`${plan.id}-archive`}
            type="button"
            className="gf-btn-subtle"
            onClick={() => void archivePlan(plan.id)}
          >
            Archive
          </button>
        ) : (
          "—"
        )
      ]),
    [archivePlan, canEdit, plans]
  );

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
        { key: "totalBudget", label: "Total Budget", value: summary.totals.totalBudget },
        { key: "approvedSpend", label: "Approved Spend", value: summary.totals.approvedSpend },
        { key: "remainingBudget", label: "Remaining Budget", value: summary.totals.remainingBudget },
        { key: "overspentBuckets", label: "Overspent Buckets", value: alertCounts.overspentCount },
        { key: "criticalBuckets", label: "Critical Buckets", value: alertCounts.criticalCount },
        { key: "watchBuckets", label: "Watch Buckets", value: alertCounts.watchCount },
        { key: "noBudgetBuckets", label: "No Budget Buckets", value: alertCounts.noBudgetCount }
      ],
      tablePreviews: [
        {
          key: "rig-budget-vs-actual",
          title: "Rig Budget vs Actual",
          rowCount: summary.byRig.length,
          columns: ["Id", "Rig", "Budget", "ApprovedSpend", "PercentUsed", "Status"],
          rows: summary.byRig.slice(0, 8).map((row) => ({
            id: row.id,
            rig: row.name,
            budget: row.budgetAmount,
            approvedSpend: row.approvedSpend,
            percentUsed: row.percentUsed,
            status: row.statusLabel,
            href: budgetVsActualHref,
            targetId: row.id,
            sectionId: "rig-budget-section",
            targetPageKey: "budget-vs-actual",
            scope: "Rig"
          }))
        },
        {
          key: "project-budget-vs-actual",
          title: "Project Budget vs Actual",
          rowCount: summary.byProject.length,
          columns: ["Id", "Project", "Budget", "ApprovedSpend", "PercentUsed", "Status"],
          rows: summary.byProject.slice(0, 8).map((row) => ({
            id: row.id,
            project: row.name,
            budget: row.budgetAmount,
            approvedSpend: row.approvedSpend,
            percentUsed: row.percentUsed,
            status: row.statusLabel,
            href: budgetVsActualHref,
            targetId: row.id,
            sectionId: "project-budget-section",
            targetPageKey: "budget-vs-actual",
            scope: "Project"
          }))
        }
      ],
      priorityItems: [
        ...summary.byRig.map((row) => ({ scope: "Rig", ...row })),
        ...summary.byProject.map((row) => ({ scope: "Project", ...row }))
      ]
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
          return b.approvedSpend - a.approvedSpend;
        })
        .slice(0, 6)
        .map((row) => ({
          id: row.id,
          label: `${row.scope}: ${row.name}`,
          reason: `${row.statusLabel}${row.percentUsed !== null ? ` • ${formatPercentUsed(row.percentUsed)} used` : ""}`,
          severity:
            row.alertLevel === "OVERSPENT"
              ? ("CRITICAL" as const)
              : row.alertLevel === "CRITICAL_90"
                ? ("HIGH" as const)
                : row.alertLevel === "WATCH_80"
                  ? ("MEDIUM" as const)
                  : ("MEDIUM" as const),
          amount: row.approvedSpend,
          href: budgetVsActualHref,
          issueType: row.status === "NO_BUDGET" ? "NO_BUDGET" : row.alertLevel,
          targetId: row.id,
          sectionId: row.scope === "Rig" ? "rig-budget-section" : "project-budget-section",
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
      alertCounts.criticalCount,
      alertCounts.noBudgetCount,
      alertCounts.overspentCount,
      alertCounts.watchCount,
      alertsCenterHref,
      budgetVsActualHref,
      costTrackingHref,
      filters.clientId,
      filters.from,
      filters.rigId,
      filters.to,
      summary.byProject,
      summary.byRig,
      summary.totals.approvedSpend,
      summary.totals.remainingBudget,
      summary.totals.totalBudget
    ]
  );

  useRegisterCopilotContext(copilotContext);

  return (
    <AccessGate permission="finance:view">
      <div className="gf-page-stack">
        <FilterScopeBanner filters={filters} />

        <section
          id="attention-needed-section"
          className={cn(
            "gf-section",
            focusedSectionId === "attention-needed-section" && "rounded-2xl ring-2 ring-indigo-100 ring-offset-2 ring-offset-slate-50"
          )}
        >
          <SectionHeader
            title="Budget vs Actual"
            description="Compare approved spend against planned rig and project budgets."
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
              label={isScoped ? "Budget in Scope" : "Total Budget"}
              value={formatCurrency(summary.totals.totalBudget)}
            />
            <MetricCard label="Approved Spend" value={formatCurrency(summary.totals.approvedSpend)} tone="warn" />
            <MetricCard
              label="Remaining Budget"
              value={formatCurrency(summary.totals.remainingBudget)}
              tone={summary.totals.remainingBudget < 0 ? "danger" : "good"}
            />
          </div>
          <div className="gf-kpi-grid-secondary">
            <MetricCard label="Overspent Buckets" value={`${alertCounts.overspentCount}`} tone="danger" />
            <MetricCard label="Critical Buckets" value={`${alertCounts.criticalCount}`} tone="warn" />
            <MetricCard label="Watch Buckets" value={`${alertCounts.watchCount}`} tone="warn" />
            <MetricCard label="No Budget Buckets" value={`${alertCounts.noBudgetCount}`} />
          </div>
          <div className="gf-inline-note">
            Missing budgets are shown as <strong>No Budget</strong> and are not treated as overspent.
          </div>
          {notice ? <div className="gf-feedback-success">{notice}</div> : null}
          {error ? <div className="gf-feedback-error">{error}</div> : null}
        </section>

        <section className="gf-section">
          <SectionHeader
            title="Attention Needed"
            description="Overspent and critical budget buckets prioritized for manager review."
          />
          {loading ? (
            <Card>
              <p className="text-sm text-slate-600">Loading budget alerts...</p>
            </Card>
          ) : attentionRows.length === 0 ? (
            <div className="gf-empty-state">No critical or overspent budget buckets in the current scope.</div>
          ) : (
            <DataTable
              columns={["Scope", "Entity", "Budget", "Approved Spend", "Remaining", "% Used", "Status"]}
              rows={attentionRows}
              rowIds={attentionRowIds}
              rowClassNames={attentionRowClassNames}
            />
          )}
        </section>

        <section
          id="rig-budget-section"
          className={cn(
            "gf-section",
            focusedSectionId === "rig-budget-section" && "rounded-2xl ring-2 ring-indigo-100 ring-offset-2 ring-offset-slate-50"
          )}
        >
          <SectionHeader
            title="Rig Budget vs Actual"
            description="Approved spend compared to matched active rig budget plans."
          />
          {loading ? (
            <Card>
              <p className="text-sm text-slate-600">Loading rig budget comparison...</p>
            </Card>
          ) : rigRows.length === 0 ? (
            <div className="gf-empty-state">No rig budget or spend data found for current filters.</div>
          ) : (
            <DataTable
              columns={["Rig", "Budget", "Approved Spend", "Remaining", "% Used", "Status"]}
              rows={rigRows}
              rowIds={rigRowIds}
              rowClassNames={rigRowClassNames}
            />
          )}
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
            description="Approved spend compared to matched active project budget plans."
          />
          {loading ? (
            <Card>
              <p className="text-sm text-slate-600">Loading project budget comparison...</p>
            </Card>
          ) : projectRows.length === 0 ? (
            <div className="gf-empty-state">No project budget or spend data found for current filters.</div>
          ) : (
            <DataTable
              columns={["Project", "Budget", "Approved Spend", "Remaining", "% Used", "Status"]}
              rows={projectRows}
              rowIds={projectRowIds}
              rowClassNames={projectRowClassNames}
            />
          )}
        </section>

        <section className="gf-section">
          <SectionHeader
            title="Budget Plans"
            description="Define active budget envelopes per rig or project. Overlapping active plans are blocked."
          />
          {canEdit ? (
            <Card title="Create Budget Plan" subtitle="Separate budget layer; existing cost tracking calculations remain unchanged.">
              <div className="grid gap-3 md:grid-cols-2">
                <label className="space-y-1 text-sm">
                  <span className="font-medium text-ink-800">Scope Type</span>
                  <select
                    value={form.scopeType}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        scopeType: event.target.value as BudgetScopeType,
                        rigId: "all",
                        projectId: "all",
                        clientId: "all"
                      }))
                    }
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  >
                    <option value="RIG">Rig</option>
                    <option value="PROJECT">Project</option>
                  </select>
                </label>
                <label className="space-y-1 text-sm">
                  <span className="font-medium text-ink-800">Plan Name</span>
                  <input
                    value={form.name}
                    onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    placeholder="Q2 Rig Budget"
                  />
                </label>
                {form.scopeType === "RIG" ? (
                  <label className="space-y-1 text-sm">
                    <span className="font-medium text-ink-800">Rig</span>
                    <select
                      value={form.rigId}
                      onChange={(event) => setForm((current) => ({ ...current, rigId: event.target.value }))}
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    >
                      <option value="all">Select rig</option>
                      {rigs.map((rig) => (
                        <option key={rig.id} value={rig.id}>
                          {rig.name}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : (
                  <label className="space-y-1 text-sm">
                    <span className="font-medium text-ink-800">Project</span>
                    <select
                      value={form.projectId}
                      onChange={(event) => setForm((current) => ({ ...current, projectId: event.target.value }))}
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    >
                      <option value="all">Select project</option>
                      {filteredProjects.map((project) => (
                        <option key={project.id} value={project.id}>
                          {project.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {form.scopeType === "RIG" ? (
                  <label className="space-y-1 text-sm">
                    <span className="font-medium text-ink-800">Client (Optional)</span>
                    <select
                      value={form.clientId}
                      onChange={(event) => setForm((current) => ({ ...current, clientId: event.target.value }))}
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    >
                      <option value="all">All clients</option>
                      {clients.map((client) => (
                        <option key={client.id} value={client.id}>
                          {client.name}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : (
                  <div />
                )}
                <label className="space-y-1 text-sm">
                  <span className="font-medium text-ink-800">Budget Amount</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.amount}
                    onChange={(event) => setForm((current) => ({ ...current, amount: event.target.value }))}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    placeholder="0.00"
                  />
                </label>
                <label className="space-y-1 text-sm">
                  <span className="font-medium text-ink-800">Period Start</span>
                  <input
                    type="date"
                    value={form.periodStart}
                    onChange={(event) => setForm((current) => ({ ...current, periodStart: event.target.value }))}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </label>
                <label className="space-y-1 text-sm">
                  <span className="font-medium text-ink-800">Period End</span>
                  <input
                    type="date"
                    value={form.periodEnd}
                    onChange={(event) => setForm((current) => ({ ...current, periodEnd: event.target.value }))}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </label>
                <label className="space-y-1 text-sm md:col-span-2">
                  <span className="font-medium text-ink-800">Notes (Optional)</span>
                  <textarea
                    value={form.notes}
                    onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    rows={3}
                    placeholder="Budget assumptions"
                  />
                </label>
              </div>
              <div className="mt-4 flex justify-end">
                <button type="button" className="gf-btn-primary" disabled={saving} onClick={() => void submitPlan()}>
                  {saving ? "Saving..." : "Create Budget Plan"}
                </button>
              </div>
            </Card>
          ) : null}

          {planRows.length === 0 ? (
            <div className="gf-empty-state">No budget plans found yet.</div>
          ) : (
            <DataTable
              columns={["Plan", "Scope", "Entity", "Client", "Amount", "Status", "Action"]}
              rows={planRows}
            />
          )}
        </section>
      </div>
    </AccessGate>
  );
}

function StatusBadge({
  alertLevel,
  statusLabel
}: {
  alertLevel: BudgetAlertLevel;
  statusLabel: BudgetVsActualRow["statusLabel"];
}) {
  if (alertLevel === "OVERSPENT") {
    return (
      <span className="rounded-full border border-red-300 bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-700">
        {statusLabel}
      </span>
    );
  }
  if (statusLabel === "No Budget") {
    return (
      <span className="rounded-full border border-slate-300 bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700">
        {statusLabel}
      </span>
    );
  }
  if (alertLevel === "CRITICAL_90") {
    return (
      <span className="rounded-full border border-orange-300 bg-orange-50 px-2 py-0.5 text-[11px] font-medium text-orange-700">
        {statusLabel}
      </span>
    );
  }
  if (alertLevel === "WATCH_80") {
    return (
      <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">
        {statusLabel}
      </span>
    );
  }
  return (
    <span className="rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
      {statusLabel}
    </span>
  );
}

function formatPercentUsed(value: number | null) {
  if (value === null) {
    return "No Budget";
  }
  if (value >= 1000) {
    return "999%+";
  }
  return formatPercent(value);
}

function formatDate(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "—";
  }
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "2-digit",
    year: "numeric"
  }).format(parsed);
}

async function readApiError(response: Response, fallback: string) {
  try {
    const payload = await response.json();
    if (typeof payload?.message === "string" && payload.message.trim()) {
      return payload.message;
    }
  } catch {}
  return fallback;
}

function buildFiltersQuery(filters: { clientId: string; rigId: string; from: string; to: string }) {
  const params = new URLSearchParams();
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  if (filters.clientId !== "all") params.set("clientId", filters.clientId);
  if (filters.rigId !== "all") params.set("rigId", filters.rigId);
  return params;
}
