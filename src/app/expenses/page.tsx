"use client";

import { Suspense, type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { AccessGate } from "@/components/layout/access-gate";
import { useRegisterCopilotContext } from "@/components/layout/ai-copilot-context";
import { useAnalyticsFilters } from "@/components/layout/analytics-filters-provider";
import { scrollToFocusElement, useCopilotFocusTarget } from "@/components/layout/copilot-focus-target";
import { FilterScopeBanner, hasActiveScopeFilters } from "@/components/layout/filter-scope-banner";
import { useRole } from "@/components/layout/role-provider";
import { BarCategoryChart } from "@/components/charts/bar-category-chart";
import { LineTrendChart } from "@/components/charts/line-trend-chart";
import { RequisitionWorkflowCard } from "@/components/modules/requisition-workflow-card";
import { Card, MetricCard } from "@/components/ui/card";
import { SectionHeader } from "@/components/ui/section-header";
import { DataTable } from "@/components/ui/table";
import type { CopilotPageContext } from "@/lib/ai/contextual-copilot";
import { canManageExpenseApprovalActions } from "@/lib/auth/approval-policy";
import { DEFAULT_EXPENSE_CATEGORIES } from "@/lib/expense-categories";
import { buildScopedHref, getBucketDateRange } from "@/lib/drilldown";
import { cn, formatCurrency, formatNumber } from "@/lib/utils";

interface ClientOption {
  id: string;
  name: string;
}

interface ProjectOption {
  id: string;
  name: string;
  clientId: string;
  status: string;
}

interface RigOption {
  id: string;
  name: string;
  status: string;
}

interface ExpenseRecord {
  id: string;
  date: string;
  clientId: string | null;
  projectId: string | null;
  rigId: string | null;
  category: string;
  subcategory: string | null;
  amount: number;
  quantity: number | null;
  unitCost: number | null;
  vendor: string | null;
  receiptNumber: string | null;
  notes: string | null;
  entrySource: string;
  receiptUrl: string | null;
  enteredByUserId: string | null;
  approvalStatus: "DRAFT" | "SUBMITTED" | "APPROVED" | "REJECTED";
  submittedAt: string | null;
  approvedAt: string | null;
  rejectionReason: string | null;
  enteredBy: { id: string; fullName: string } | null;
  approvedBy: { id: string; fullName: string } | null;
  client: { id: string; name: string } | null;
  project: { id: string; name: string } | null;
  rig: { id: string; rigCode: string } | null;
  createdAt: string;
  updatedAt: string;
}

interface AnalyticsBucket {
  id?: string;
  name: string;
  amount: number;
}

interface ExpenseAnalytics {
  kpis: {
    totalExpenses: number;
    approvedExpenses: number;
    highestExpenseProject: string;
    highestExpenseRig: string;
    biggestCategory: string;
  };
  trendGranularity: "day" | "month";
  expenseTrend: Array<{ bucketStart: string; label: string; amount: number }>;
  expensesByProject: AnalyticsBucket[];
  expensesByRig: AnalyticsBucket[];
  expensesByCategory: AnalyticsBucket[];
}

const emptyAnalytics: ExpenseAnalytics = {
  kpis: {
    totalExpenses: 0,
    approvedExpenses: 0,
    highestExpenseProject: "N/A",
    highestExpenseRig: "N/A",
    biggestCategory: "N/A"
  },
  trendGranularity: "day",
  expenseTrend: [],
  expensesByProject: [],
  expensesByRig: [],
  expensesByCategory: []
};

const emptyForm = {
  id: "",
  date: new Date().toISOString().slice(0, 10),
  clientId: "",
  projectId: "",
  rigId: "",
  category: "Fuel",
  subcategory: "",
  amount: "",
  quantity: "",
  unitCost: "",
  vendor: "",
  receiptNumber: "",
  notes: "",
  receiptUrl: "",
  receiptFile: null as File | null
};

export default function ExpensesPage() {
  return (
    <Suspense fallback={<ExpensesPageFallback />}>
      <ExpensesPageContent />
    </Suspense>
  );
}

function ExpensesPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useRole();
  const { filters } = useAnalyticsFilters();
  const projectIdFilter = searchParams.get("projectId") || "all";
  const categoryFilter = searchParams.get("category") || "all";
  const statusFilter = normalizeStatusFilter(searchParams.get("status"));
  const focusedExpenseId = normalizeOptionalId(searchParams.get("expenseId"));
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [rigs, setRigs] = useState<RigOption[]>([]);
  const [expenses, setExpenses] = useState<ExpenseRecord[]>([]);
  const [analytics, setAnalytics] = useState<ExpenseAnalytics>(emptyAnalytics);
  const [form, setForm] = useState(emptyForm);
  const [loading, setLoading] = useState(true);
  const [referencesLoading, setReferencesLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [statusNotes, setStatusNotes] = useState<Record<string, string>>({});
  const [focusedRowId, setFocusedRowId] = useState<string | null>(null);
  const [focusedSectionId, setFocusedSectionId] = useState<string | null>(null);

  const isEditMode = Boolean(form.id);
  const canApprove = canManageExpenseApprovalActions(user?.role);
  const isScoped = hasActiveScopeFilters(filters);
  const buildHref = useCallback(
    (path: string, overrides?: Record<string, string | null | undefined>) =>
      buildScopedHref(filters, path, {
        ...(projectIdFilter !== "all" ? { projectId: projectIdFilter } : {}),
        ...(categoryFilter !== "all" ? { category: categoryFilter } : {}),
        ...(statusFilter !== "all" ? { status: statusFilter } : {}),
        ...overrides
      }),
    [categoryFilter, filters, projectIdFilter, statusFilter]
  );

  const activeRigs = useMemo(() => rigs.filter((rig) => rig.status === "ACTIVE"), [rigs]);
  const topCategory = analytics.expensesByCategory[0] || null;
  const topProject = analytics.expensesByProject[0] || null;
  const topRig = analytics.expensesByRig[0] || null;
  const totalVisibleExpenseAmount = useMemo(
    () => expenses.reduce((sum, entry) => sum + entry.amount, 0),
    [expenses]
  );
  const submittedExpenses = useMemo(
    () => [...expenses].filter((entry) => entry.approvalStatus === "SUBMITTED"),
    [expenses]
  );
  const rejectedExpenses = useMemo(
    () => [...expenses].filter((entry) => entry.approvalStatus === "REJECTED"),
    [expenses]
  );
  const submittedExpenseAmount = useMemo(
    () => submittedExpenses.reduce((sum, entry) => sum + entry.amount, 0),
    [submittedExpenses]
  );
  const rejectedExpenseAmount = useMemo(
    () => rejectedExpenses.reduce((sum, entry) => sum + entry.amount, 0),
    [rejectedExpenses]
  );
  const missingRigLinkageRows = useMemo(
    () => expenses.filter((entry) => !entry.rigId),
    [expenses]
  );
  const missingProjectLinkageRows = useMemo(
    () => expenses.filter((entry) => !entry.projectId),
    [expenses]
  );
  const missingClientLinkageRows = useMemo(
    () => expenses.filter((entry) => !entry.clientId),
    [expenses]
  );
  const missingLinkageRows = useMemo(
    () => expenses.filter((entry) => !entry.rigId || !entry.projectId || !entry.clientId),
    [expenses]
  );
  const missingLinkageAmount = useMemo(
    () => missingLinkageRows.reduce((sum, entry) => sum + entry.amount, 0),
    [missingLinkageRows]
  );
  const unusualCostSpikeRows = useMemo(() => {
    if (expenses.length < 3) {
      return [];
    }
    const average = totalVisibleExpenseAmount / Math.max(1, expenses.length);
    const threshold = Math.max(10000, average * 2.5);
    return [...expenses]
      .filter((entry) => entry.amount >= threshold)
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 8);
  }, [expenses, totalVisibleExpenseAmount]);
  const topCategoryShare = useMemo(
    () => ratioAsPercent(topCategory?.amount || 0, analytics.kpis.totalExpenses),
    [analytics.kpis.totalExpenses, topCategory?.amount]
  );
  const topProjectShare = useMemo(
    () => ratioAsPercent(topProject?.amount || 0, analytics.kpis.totalExpenses),
    [analytics.kpis.totalExpenses, topProject?.amount]
  );
  const topRigShare = useMemo(
    () => ratioAsPercent(topRig?.amount || 0, analytics.kpis.totalExpenses),
    [analytics.kpis.totalExpenses, topRig?.amount]
  );

  const filteredProjects = useMemo(() => {
    if (!form.clientId) {
      return projects;
    }
    return projects.filter((project) => project.clientId === form.clientId);
  }, [projects, form.clientId]);

  async function loadReferenceData() {
    setReferencesLoading(true);
    try {
      const [clientsRes, projectsRes, rigsRes] = await Promise.all([
        fetch("/api/clients", { cache: "no-store" }),
        fetch("/api/projects", { cache: "no-store" }),
        fetch("/api/rigs", { cache: "no-store" })
      ]);

      const clientsPayload = clientsRes.ok ? await clientsRes.json() : { data: [] };
      const projectsPayload = projectsRes.ok ? await projectsRes.json() : { data: [] };
      const rigsPayload = rigsRes.ok ? await rigsRes.json() : { data: [] };

      setClients((clientsPayload.data || []).map((entry: { id: string; name: string }) => ({ id: entry.id, name: entry.name })));
      setProjects(
        (projectsPayload.data || []).map(
          (entry: { id: string; name: string; clientId: string; status: string }) => ({
            id: entry.id,
            name: entry.name,
            clientId: entry.clientId,
            status: entry.status
          })
        )
      );
      setRigs(
        (rigsPayload.data || []).map((entry: { id: string; name?: string; rigCode?: string; status: string }) => ({
          id: entry.id,
          name: entry.name || entry.rigCode || "Unnamed Rig",
          status: entry.status
        }))
      );
    } catch (_error) {
      setClients([]);
      setProjects([]);
      setRigs([]);
    } finally {
      setReferencesLoading(false);
    }
  }

  const loadExpenseData = useCallback(async () => {
    setLoading(true);
    try {
      const search = new URLSearchParams();
      if (filters.from) search.set("from", filters.from);
      if (filters.to) search.set("to", filters.to);
      if (filters.clientId !== "all") search.set("clientId", filters.clientId);
      if (filters.rigId !== "all") search.set("rigId", filters.rigId);
      if (projectIdFilter !== "all") search.set("projectId", projectIdFilter);
      if (categoryFilter !== "all") search.set("category", categoryFilter);
      if (statusFilter !== "all") search.set("status", statusFilter);
      if (focusedExpenseId) search.set("expenseId", focusedExpenseId);

      const query = search.toString();
      const [expensesRes, analyticsRes] = await Promise.all([
        fetch(`/api/expenses${query ? `?${query}` : ""}`, { cache: "no-store" }),
        fetch(`/api/expenses/analytics${query ? `?${query}&` : "?"}includeAllStatuses=true`, { cache: "no-store" })
      ]);

      const expensesPayload = expensesRes.ok ? await expensesRes.json() : { data: [] };
      const analyticsPayload = analyticsRes.ok ? await analyticsRes.json() : emptyAnalytics;

      setExpenses(expensesPayload.data || []);
      setAnalytics(analyticsPayload || emptyAnalytics);
    } catch (_error) {
      setExpenses([]);
      setAnalytics(emptyAnalytics);
    } finally {
      setLoading(false);
    }
  }, [
    categoryFilter,
    filters.clientId,
    filters.from,
    filters.rigId,
    filters.to,
    focusedExpenseId,
    projectIdFilter,
    statusFilter
  ]);

  useEffect(() => {
    void loadReferenceData();
  }, []);

  useEffect(() => {
    void loadExpenseData();
  }, [loadExpenseData]);

  useEffect(() => {
    if (!form.projectId) {
      return;
    }
    const selectedProject = projects.find((project) => project.id === form.projectId);
    if (!selectedProject) {
      return;
    }
    if (!form.clientId) {
      setForm((current) => ({ ...current, clientId: selectedProject.clientId }));
      return;
    }
    if (selectedProject.clientId === form.clientId) {
      return;
    }

    setForm((current) => ({ ...current, clientId: selectedProject.clientId }));
  }, [form.clientId, form.projectId, projects]);

  useEffect(() => {
    if (!focusedExpenseId || loading) {
      return;
    }
    const target = expenses.find((entry) => entry.id === focusedExpenseId);
    if (!target) {
      setErrorMessage(
        "The requested expense could not be found in the current view. Try clearing filters and reopen the record."
      );
      return;
    }
    setFocusedSectionId("expenses-records-section");
    setFocusedRowId(target.id);
    scrollToFocusElement({
      sectionId: "expenses-records-section",
      targetId: target.id
    });
    setNotice(`Opened expense ${target.id.slice(-8)} for review.`);
  }, [expenses, focusedExpenseId, loading]);

  const copilotContext = useMemo<CopilotPageContext>(
    () => ({
      pageKey: "expenses",
      pageName: "Expenses",
      filters: {
        clientId: filters.clientId,
        rigId: filters.rigId,
        from: filters.from || null,
        to: filters.to || null
      },
      summaryMetrics: [
        { key: "totalExpenses", label: "Total Expenses", value: analytics.kpis.totalExpenses },
        { key: "approvedExpenses", label: "Approved Expenses", value: analytics.kpis.approvedExpenses },
        { key: "largestCategory", label: "Largest Category", value: topCategory?.name || "N/A" },
        { key: "largestCategoryAmount", label: "Largest Category Amount", value: topCategory?.amount || 0 },
        { key: "highestCostProject", label: "Highest Cost Project", value: topProject?.name || "N/A" },
        { key: "highestCostProjectAmount", label: "Highest Cost Project Amount", value: topProject?.amount || 0 },
        { key: "highestCostRig", label: "Highest Cost Rig", value: topRig?.name || "N/A" },
        { key: "highestCostRigAmount", label: "Highest Cost Rig Amount", value: topRig?.amount || 0 },
        { key: "submittedExpenses", label: "Submitted Expenses", value: submittedExpenses.length },
        { key: "submittedExpenseAmount", label: "Submitted Expense Amount", value: submittedExpenseAmount },
        { key: "rejectedExpenses", label: "Rejected Expenses", value: rejectedExpenses.length },
        { key: "rejectedExpenseAmount", label: "Rejected Expense Amount", value: rejectedExpenseAmount },
        { key: "missingRigLinkage", label: "Missing Rig Linkage", value: missingRigLinkageRows.length },
        { key: "missingProjectLinkage", label: "Missing Project Linkage", value: missingProjectLinkageRows.length },
        { key: "missingClientLinkage", label: "Missing Client Linkage", value: missingClientLinkageRows.length },
        { key: "missingLinkageAmount", label: "Missing Linkage Amount", value: missingLinkageAmount },
        { key: "unusualCostSpikes", label: "Unusual Cost Spikes", value: unusualCostSpikeRows.length },
        { key: "visibleExpenseRows", label: "Visible Expense Rows", value: expenses.length },
        { key: "visibleExpenseAmount", label: "Visible Expense Amount", value: totalVisibleExpenseAmount }
      ],
      tablePreviews: [
        {
          key: "expenses-by-category",
          title: "Expenses by Category",
          rowCount: analytics.expensesByCategory.length,
          columns: ["Category", "Amount", "Share"],
          rows: analytics.expensesByCategory.slice(0, 8).map((entry) => ({
            id: entry.id || entry.name,
            name: entry.name,
            amount: entry.amount,
            share: ratioAsPercent(entry.amount, analytics.kpis.totalExpenses),
            href: buildHref("/expenses", { category: entry.name }),
            sectionId: "expenses-category-driver-section",
            targetPageKey: "expenses"
          }))
        },
        {
          key: "expenses-by-project",
          title: "Expenses by Project",
          rowCount: analytics.expensesByProject.length,
          columns: ["Project", "Amount", "Share"],
          rows: analytics.expensesByProject.slice(0, 8).map((entry) => ({
            id: entry.id || entry.name,
            name: entry.name,
            amount: entry.amount,
            share: ratioAsPercent(entry.amount, analytics.kpis.totalExpenses),
            href: entry.id ? buildHref(`/projects/${entry.id}`) : buildHref("/expenses", { projectId: entry.id || null }),
            sectionId: "expenses-project-driver-section",
            targetPageKey: entry.id ? "projects" : "expenses"
          }))
        },
        {
          key: "expenses-by-rig",
          title: "Expenses by Rig",
          rowCount: analytics.expensesByRig.length,
          columns: ["Rig", "Amount", "Share"],
          rows: analytics.expensesByRig.slice(0, 8).map((entry) => ({
            id: entry.id || entry.name,
            name: entry.name,
            amount: entry.amount,
            share: ratioAsPercent(entry.amount, analytics.kpis.totalExpenses),
            href:
              entry.id && entry.id !== "unassigned-rig"
                ? buildHref(`/rigs/${entry.id}`)
                : buildHref("/expenses", {
                    rigId: entry.id && entry.id !== "unassigned-rig" ? entry.id : null
                  }),
            sectionId: "expenses-rig-driver-section",
            targetPageKey: entry.id && entry.id !== "unassigned-rig" ? "rigs" : "expenses"
          }))
        },
        {
          key: "expense-approval-sensitive",
          title: "Approval-Sensitive Expenses",
          rowCount: submittedExpenses.length,
          columns: ["Date", "Project", "Rig", "Category", "Amount", "Status"],
          rows: [...submittedExpenses]
            .sort((a, b) => b.amount - a.amount)
            .slice(0, 8)
            .map((entry) => ({
              id: entry.id,
              date: entry.date.slice(0, 10),
              project: entry.project?.name || "Unassigned project",
              rig: entry.rig?.rigCode || "Unassigned rig",
              category: entry.category,
              amount: entry.amount,
              status: entry.approvalStatus,
              href: buildHref("/expenses"),
              targetId: entry.id,
              sectionId: "expenses-records-section",
              targetPageKey: "expenses"
            }))
        },
        {
          key: "expense-missing-linkage",
          title: "Missing Linkage Expenses",
          rowCount: missingLinkageRows.length,
          columns: ["Date", "Category", "Amount", "Missing"],
          rows: [...missingLinkageRows]
            .sort((a, b) => b.amount - a.amount)
            .slice(0, 8)
            .map((entry) => ({
              id: entry.id,
              date: entry.date.slice(0, 10),
              category: entry.category,
              amount: entry.amount,
              missing: [!entry.clientId ? "Client" : null, !entry.projectId ? "Project" : null, !entry.rigId ? "Rig" : null]
                .filter(Boolean)
                .join(" + "),
              href: buildHref("/expenses"),
              targetId: entry.id,
              sectionId: "expenses-records-section",
              targetPageKey: "expenses"
            }))
        },
        {
          key: "expense-cost-spikes",
          title: "Unusual Cost Spikes",
          rowCount: unusualCostSpikeRows.length,
          columns: ["Date", "Project", "Rig", "Category", "Amount"],
          rows: unusualCostSpikeRows.map((entry) => ({
            id: entry.id,
            date: entry.date.slice(0, 10),
            project: entry.project?.name || "Unassigned project",
            rig: entry.rig?.rigCode || "Unassigned rig",
            category: entry.category,
            amount: entry.amount,
            href: buildHref("/expenses"),
            targetId: entry.id,
            sectionId: "expenses-records-section",
            targetPageKey: "expenses"
          }))
        }
      ],
      priorityItems: [
        ...(topCategory && topCategory.amount > 0
          ? [
              {
                id: `expense-category-${topCategory.id || topCategory.name}`,
                label: `Cost Driver • ${topCategory.name}`,
                reason: `${formatCurrency(topCategory.amount)} (${roundPercent(topCategoryShare)}% of visible spend).`,
                severity: topCategoryShare >= 45 ? ("HIGH" as const) : ("MEDIUM" as const),
                amount: topCategory.amount,
                href: buildHref("/expenses", { category: topCategory.name }),
                issueType: "COST_DRIVER",
                sectionId: "expenses-category-driver-section",
                targetPageKey: "expenses"
              }
            ]
          : []),
        ...(topProject && topProject.amount > 0
          ? [
              {
                id: `expense-project-${topProject.id || topProject.name}`,
                label: `Highest Cost Project • ${topProject.name}`,
                reason: `${formatCurrency(topProject.amount)} (${roundPercent(topProjectShare)}% of visible spend).`,
                severity: topProjectShare >= 40 ? ("HIGH" as const) : ("MEDIUM" as const),
                amount: topProject.amount,
                href: topProject.id ? buildHref(`/projects/${topProject.id}`) : buildHref("/expenses", { projectId: topProject.id || null }),
                issueType: "PROJECT_SPEND",
                sectionId: "expenses-project-driver-section",
                targetPageKey: topProject.id ? "projects" : "expenses"
              }
            ]
          : []),
        ...(topRig && topRig.amount > 0
          ? [
              {
                id: `expense-rig-${topRig.id || topRig.name}`,
                label: `Highest Cost Rig • ${topRig.name}`,
                reason:
                  topRig.id === "unassigned-rig"
                    ? `${formatCurrency(topRig.amount)} is not rig-linked and needs cleanup.`
                    : `${formatCurrency(topRig.amount)} (${roundPercent(topRigShare)}% of visible spend).`,
                severity:
                  topRig.id === "unassigned-rig"
                    ? ("HIGH" as const)
                    : topRigShare >= 35
                      ? ("HIGH" as const)
                      : ("MEDIUM" as const),
                amount: topRig.amount,
                href: buildHref("/expenses", {
                  rigId: topRig.id && topRig.id !== "unassigned-rig" ? topRig.id : null
                }),
                ...(topRig.id && topRig.id !== "unassigned-rig"
                  ? { href: buildHref(`/rigs/${topRig.id}`), targetPageKey: "rigs" as const }
                  : {}),
                issueType: topRig.id === "unassigned-rig" ? "LINKAGE" : "RIG_SPEND",
                sectionId: "expenses-rig-driver-section",
                targetPageKey: topRig.id && topRig.id !== "unassigned-rig" ? "rigs" : "expenses"
              }
            ]
          : []),
        ...[...submittedExpenses]
          .sort((a, b) => b.amount - a.amount)
          .slice(0, 2)
          .map((entry) => ({
            id: entry.id,
            label: `Approval-Sensitive Spend • ${entry.project?.name || entry.category}`,
            reason: `${formatCurrency(entry.amount)} submitted on ${entry.date.slice(0, 10)} awaits approval.`,
            severity: entry.amount >= 30000 ? ("HIGH" as const) : ("MEDIUM" as const),
            amount: entry.amount,
            href: buildHref("/expenses"),
            issueType: "APPROVAL_BACKLOG",
            targetId: entry.id,
            sectionId: "expenses-records-section",
            targetPageKey: "expenses"
          })),
        ...[...missingLinkageRows]
          .sort((a, b) => b.amount - a.amount)
          .slice(0, 2)
          .map((entry) => ({
            id: `linkage-${entry.id}`,
            label: `Missing Linkage • ${entry.category}`,
            reason: `${formatCurrency(entry.amount)} is missing ${[
              !entry.clientId ? "client" : null,
              !entry.projectId ? "project" : null,
              !entry.rigId ? "rig" : null
            ]
              .filter(Boolean)
              .join(" + ")} linkage.`,
            severity: entry.amount >= 20000 ? ("HIGH" as const) : ("MEDIUM" as const),
            amount: entry.amount,
            href: buildHref("/expenses"),
            issueType: "LINKAGE",
            targetId: entry.id,
            sectionId: "expenses-records-section",
            targetPageKey: "expenses"
          })),
        ...unusualCostSpikeRows.slice(0, 2).map((entry) => ({
          id: `spike-${entry.id}`,
          label: `Unusual cost spike • ${entry.project?.name || entry.category}`,
          reason: `${formatCurrency(entry.amount)} on ${entry.date.slice(
            0,
            10
          )} is unusually high relative to this scope's baseline.`,
          severity: "HIGH" as const,
          amount: entry.amount,
          href: buildHref("/expenses"),
          issueType: "COST_DRIVER",
          targetId: entry.id,
          sectionId: "expenses-records-section",
          targetPageKey: "expenses"
        })),
        {
          id: "expense-kpi-snapshot",
          label: "Expense KPI Snapshot",
          reason: "Use KPI cards to compare total vs approved spend before drilling into records.",
          severity: "LOW" as const,
          href: buildHref("/expenses"),
          issueType: "SUMMARY",
          sectionId: "expenses-primary-kpi-section",
          targetPageKey: "expenses"
        },
        {
          id: "expense-entry-section-focus",
          label: "Expense Entry Section",
          reason: "Use the entry section to capture missing spend context or correct draft data quickly.",
          severity: "LOW" as const,
          href: buildHref("/expenses"),
          issueType: "WORKFLOW",
          sectionId: "expenses-entry-section",
          targetPageKey: "expenses"
        },
        ...(expenses.length === 0
          ? [
              {
                id: "expense-entry-workflow",
                label: "Expense Entry Workflow",
                reason: "No entries are visible in this scope. Add an entry or broaden filters to continue review.",
                severity: "LOW" as const,
                href: buildHref("/expenses"),
                issueType: "DATA_GAP",
                sectionId: "expenses-entry-section",
                targetPageKey: "expenses"
              }
            ]
          : [])
      ],
      navigationTargets: [
        {
          label: "Open Budget vs Actual",
          href: buildHref("/cost-tracking/budget-vs-actual"),
          reason: "Check whether expense concentration is creating budget pressure.",
          pageKey: "budget-vs-actual"
        },
        {
          label: "Open Cost Tracking",
          href: buildHref("/cost-tracking"),
          reason: "Compare expense drivers against operational cost summaries.",
          pageKey: "cost-tracking"
        },
        {
          label: "Open Approvals",
          href: buildHref("/approvals"),
          reason: "Resolve submitted requests that can affect cost visibility.",
          pageKey: "approvals"
        },
        {
          label: "Open Linkage Center",
          href: buildHref("/data-quality/linkage-center"),
          reason: "Fix missing rig/project linkage that impacts analytics quality.",
          pageKey: "data-quality-linkage-center"
        }
      ],
      notes: ["Expense copilot guidance is advisory-only and does not post or approve entries."]
    }),
    [
      analytics.expensesByCategory,
      analytics.expensesByProject,
      analytics.expensesByRig,
      analytics.kpis.approvedExpenses,
      analytics.kpis.totalExpenses,
      buildHref,
      expenses,
      filters.clientId,
      filters.from,
      filters.rigId,
      filters.to,
      missingLinkageAmount,
      missingLinkageRows,
      missingClientLinkageRows.length,
      missingProjectLinkageRows.length,
      missingRigLinkageRows.length,
      unusualCostSpikeRows,
      rejectedExpenseAmount,
      rejectedExpenses.length,
      submittedExpenseAmount,
      submittedExpenses,
      topCategory,
      topCategoryShare,
      topProject,
      topProjectShare,
      topRig,
      topRigShare,
      totalVisibleExpenseAmount
    ]
  );

  useRegisterCopilotContext(copilotContext);

  useCopilotFocusTarget({
    pageKey: "expenses",
    onFocus: (target) => {
      setFocusedRowId(target.targetId || null);
      setFocusedSectionId(target.sectionId || null);
      scrollToFocusElement({
        sectionId: target.sectionId,
        targetId: target.targetId
      });
    }
  });

  useEffect(() => {
    if (!focusedRowId && !focusedSectionId) {
      return;
    }
    const timeout = window.setTimeout(() => {
      setFocusedRowId(null);
      setFocusedSectionId(null);
    }, 2600);
    return () => window.clearTimeout(timeout);
  }, [focusedRowId, focusedSectionId]);

  async function submitExpense(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage(null);
    setNotice(null);
    setSaving(true);
    try {
      if (isEditMode) {
        const response = await fetch(`/api/expenses/${form.id}`, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            date: form.date,
            clientId: form.clientId,
            projectId: form.projectId,
            rigId: form.rigId,
            category: form.category,
            subcategory: form.subcategory,
            amount: form.amount ? Number(form.amount) : null,
            quantity: form.quantity ? Number(form.quantity) : null,
            unitCost: form.unitCost ? Number(form.unitCost) : null,
            receiptNumber: form.receiptNumber,
            vendor: form.vendor,
            notes: form.notes,
            receiptUrl: form.receiptUrl
          })
        });

        if (!response.ok) {
          setErrorMessage(await readApiError(response, "Failed to update expense."));
          return;
        }
        setNotice("Expense updated successfully.");
      } else {
        const payload = new FormData();
        const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
        const submissionMode = submitter?.dataset.mode === "submit" ? "submit" : "draft";
        payload.set("date", form.date);
        if (form.clientId) payload.set("clientId", form.clientId);
        if (form.projectId) payload.set("projectId", form.projectId);
        payload.set("category", form.category);
        payload.set("amount", form.amount);
        payload.set("submissionMode", submissionMode);
        if (form.rigId) payload.set("rigId", form.rigId);
        if (form.subcategory) payload.set("subcategory", form.subcategory);
        if (form.quantity) payload.set("quantity", form.quantity);
        if (form.unitCost) payload.set("unitCost", form.unitCost);
        if (form.receiptNumber) payload.set("receiptNumber", form.receiptNumber);
        if (form.vendor) payload.set("vendor", form.vendor);
        if (form.notes) payload.set("notes", form.notes);
        if (form.receiptUrl) payload.set("receiptUrl", form.receiptUrl);
        if (form.receiptFile) payload.set("receipt", form.receiptFile);

        const response = await fetch("/api/expenses", {
          method: "POST",
          body: payload
        });

        if (!response.ok) {
          setErrorMessage(await readApiError(response, "Failed to save expense."));
          return;
        }
        setNotice(
          submissionMode === "submit"
            ? "Expense submitted for approval."
            : "Expense saved as draft."
        );
      }

      setForm({
        ...emptyForm,
        date: new Date().toISOString().slice(0, 10)
      });
      await loadExpenseData();
      window.localStorage.setItem("gf:profit-updated-at", String(Date.now()));
      window.dispatchEvent(new Event("gf:profit-updated"));
    } finally {
      setSaving(false);
    }
  }

  async function deleteExpense(expenseId: string) {
    if (!window.confirm("Delete this expense entry?")) {
      return;
    }
    setErrorMessage(null);
    setNotice(null);

    const response = await fetch(`/api/expenses/${expenseId}`, {
      method: "DELETE"
    });

    if (!response.ok) {
      setErrorMessage(await readApiError(response, "Failed to delete expense."));
      return;
    }

    if (form.id === expenseId) {
      setForm({
        ...emptyForm,
        date: new Date().toISOString().slice(0, 10)
      });
    }
    await loadExpenseData();
    setNotice("Expense deleted.");
    window.localStorage.setItem("gf:profit-updated-at", String(Date.now()));
    window.dispatchEvent(new Event("gf:profit-updated"));
  }

  async function updateExpenseStatus(
    expenseId: string,
    action: "submit" | "approve" | "reject" | "reopen"
  ) {
    const reason = (statusNotes[expenseId] || "").trim();
    if (action === "reject" && reason.length < 3) {
      setErrorMessage("Please enter a rejection reason (minimum 3 characters).");
      return;
    }
    setErrorMessage(null);
    setNotice(null);

    const response = await fetch(`/api/expenses/${expenseId}/status`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        action,
        reason: reason || undefined
      })
    });

    if (!response.ok) {
      setErrorMessage(await readApiError(response, "Failed to update expense status."));
      return;
    }

    await loadExpenseData();
    setStatusNotes((current) => ({ ...current, [expenseId]: "" }));
    setNotice(resolveStatusActionNotice(action));
    window.localStorage.setItem("gf:profit-updated-at", String(Date.now()));
    window.dispatchEvent(new Event("gf:profit-updated"));
  }

  function startEdit(expense: ExpenseRecord) {
    setForm({
      id: expense.id,
      date: expense.date.slice(0, 10),
      clientId: expense.clientId || "",
      projectId: expense.projectId || "",
      rigId: expense.rigId || "",
      category: expense.category,
      subcategory: expense.subcategory || "",
      amount: String(expense.amount),
      quantity: expense.quantity !== null ? String(expense.quantity) : "",
      unitCost: expense.unitCost !== null ? String(expense.unitCost) : "",
      vendor: expense.vendor || "",
      receiptNumber: expense.receiptNumber || "",
      notes: expense.notes || "",
      receiptUrl: expense.receiptUrl || "",
      receiptFile: null
    });
  }

  return (
    <AccessGate permission="expenses:manual">
      <div className="gf-page-stack">
        {notice && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            {notice}
          </div>
        )}
        {errorMessage && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
            {errorMessage}
          </div>
        )}
        <FilterScopeBanner filters={filters} />

        <section
          id="expenses-requisition-section"
          className={cn(
            "gf-section",
            focusedSectionId === "expenses-requisition-section" &&
              "rounded-2xl ring-2 ring-indigo-100 ring-offset-2 ring-offset-slate-50"
          )}
        >
          <RequisitionWorkflowCard
            filters={filters}
            currentUserRole={user?.role}
            clients={clients}
            projects={projects}
            rigs={rigs}
            onWorkflowChanged={async () => {
              await loadExpenseData();
              window.localStorage.setItem("gf:profit-updated-at", String(Date.now()));
              window.dispatchEvent(new Event("gf:profit-updated"));
            }}
          />
        </section>

        <section
          id="expenses-primary-kpi-section"
          className={cn(
            "gf-section",
            focusedSectionId === "expenses-primary-kpi-section" &&
              "rounded-2xl ring-2 ring-indigo-100 ring-offset-2 ring-offset-slate-50"
          )}
        >
          <SectionHeader
            title="Primary Expense KPIs"
            description="Most important expense signals in the current scope."
          />
          <div className="gf-kpi-grid-primary">
            <MetricCard
              label={isScoped ? "Expenses in Scope" : "Total Expenses"}
              value={formatCurrency(analytics.kpis.totalExpenses)}
              change={`Approved: ${formatCurrency(analytics.kpis.approvedExpenses)}`}
              tone="warn"
            />
            <MetricCard label="Highest Expense Project" value={analytics.kpis.highestExpenseProject} />
            <MetricCard label="Highest Expense Rig" value={analytics.kpis.highestExpenseRig} />
            <MetricCard label="Biggest Category" value={analytics.kpis.biggestCategory} />
          </div>
          <p className="mt-2 text-xs text-slate-600">
            Expense analytics on this page include all visible statuses. Financial dashboards use approved expenses only.
          </p>
        </section>

        <Card
          title="Approval and Reporting Visibility"
          subtitle="Manual expenses are reviewed in this module; receipt-intake submissions are reviewed in Approvals."
        >
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <StatusPill tone="amber">
              Submitted: {submittedExpenses.length}
            </StatusPill>
            <StatusPill tone="slate">
              Draft: {expenses.filter((entry) => entry.approvalStatus === "DRAFT").length}
            </StatusPill>
            <StatusPill tone="emerald">
              Approved: {expenses.filter((entry) => entry.approvalStatus === "APPROVED").length}
            </StatusPill>
            <button
              type="button"
              onClick={() => router.push(buildHref("/expenses", { status: "SUBMITTED" }))}
              className="rounded-md border border-amber-200 bg-white px-2 py-1 text-xs font-semibold text-amber-800 hover:bg-amber-50"
            >
              Show submitted only
            </button>
            <button
              type="button"
              onClick={() => router.push(buildHref("/approvals"))}
              className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              Open approvals workspace
            </button>
          </div>
        </Card>

        {!loading && expenses.length === 0 && (
          <p className="gf-empty-state">
            No expenses found for current filters.
          </p>
        )}

        <section
          id="expenses-entry-section"
          className={cn(
            "gf-section",
            focusedSectionId === "expenses-entry-section" &&
              "rounded-2xl ring-2 ring-indigo-100 ring-offset-2 ring-offset-slate-50"
          )}
        >
          <SectionHeader
            title={isEditMode ? "Update Direct Cost Entry" : "Direct Cost Entry (Exception Flow)"}
            description="Use requisition workflow first for standard purchases. Use direct entry only when requisition-first is not practical."
          />
          <Card subtitle="Available to roles with expense entry access. Entries are saved live to database.">
            <p className="mb-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              Recommended flow: <span className="font-semibold">Requisition → Approval → Purchase/Receipt → Posted Cost</span>. Direct entry is retained for exceptions and legacy adjustments.
            </p>
            <form onSubmit={submitExpense} className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
            <Input
              label="Date"
              type="date"
              value={form.date}
              onChange={(value) => setForm((current) => ({ ...current, date: value }))}
              required
            />

            <Select
              label="Client (optional)"
              value={form.clientId}
              onChange={(value) => setForm((current) => ({ ...current, clientId: value }))}
              options={clients.map((client) => ({ value: client.id, label: client.name }))}
              loading={referencesLoading}
              emptyLabel="No clients available"
              allowEmpty
            />

            <Select
              label="Project (optional)"
              value={form.projectId}
              onChange={(value) => {
                const selectedProject = projects.find((project) => project.id === value);
                setForm((current) => ({
                  ...current,
                  projectId: value,
                  clientId: selectedProject?.clientId || current.clientId
                }));
              }}
              options={filteredProjects.map((project) => ({ value: project.id, label: project.name }))}
              loading={referencesLoading}
              emptyLabel="No projects available"
              allowEmpty
            />

            <Select
              label="Rig (optional)"
              value={form.rigId}
              onChange={(value) => setForm((current) => ({ ...current, rigId: value }))}
              options={activeRigs.map((rig) => ({ value: rig.id, label: rig.name }))}
              loading={referencesLoading}
              emptyLabel="No active rigs available"
              allowEmpty
            />

            <Select
              label="Category"
              value={form.category}
              onChange={(value) => setForm((current) => ({ ...current, category: value }))}
              options={DEFAULT_EXPENSE_CATEGORIES.map((category) => ({ value: category, label: category }))}
              required
            />
            <p className="text-xs text-slate-600 md:col-span-2 lg:col-span-4">
              Categories are controlled for reporting consistency. If a category is not exact, use{" "}
              <span className="font-semibold">Other</span> with a clear subcategory.
            </p>

            <Input
              label="Subcategory"
              value={form.subcategory}
              onChange={(value) => setForm((current) => ({ ...current, subcategory: value }))}
              placeholder="Diesel, Engine Oil, Contract Labor..."
            />

            <Input
              label="Quantity / Units (optional)"
              type="number"
              step="0.01"
              min="0"
              value={form.quantity}
              onChange={(value) => setForm((current) => ({ ...current, quantity: value }))}
              placeholder="e.g. 5"
            />

            <Input
              label="Unit Cost (optional)"
              type="number"
              step="0.01"
              min="0"
              value={form.unitCost}
              onChange={(value) => setForm((current) => ({ ...current, unitCost: value }))}
              placeholder="e.g. 1200.00"
            />

            <Input
              label="Amount"
              type="number"
              step="0.01"
              min="0"
              value={form.amount}
              onChange={(value) => setForm((current) => ({ ...current, amount: value }))}
              required
            />
            {form.quantity && form.unitCost ? (
              <p className="text-xs text-slate-600 md:col-span-2 lg:col-span-4">
                Quantity × unit cost ={" "}
                <span className="font-semibold text-ink-900">
                  {formatCurrency(Number(form.quantity) * Number(form.unitCost))}
                </span>
              </p>
            ) : null}

            <Input
              label="Vendor"
              value={form.vendor}
              onChange={(value) => setForm((current) => ({ ...current, vendor: value }))}
              placeholder="Supplier/Vendor name"
            />

            <Input
              label="Receipt Number (optional)"
              value={form.receiptNumber}
              onChange={(value) => setForm((current) => ({ ...current, receiptNumber: value }))}
              placeholder="Receipt / invoice number"
            />

            <Input
              label="Receipt URL (optional)"
              value={form.receiptUrl}
              onChange={(value) => setForm((current) => ({ ...current, receiptUrl: value }))}
              placeholder="https://..."
            />

            {!isEditMode && (
              <label className="text-sm text-ink-700">
                <span className="mb-1 block">Receipt Upload (optional)</span>
                <input
                  type="file"
                  accept="image/*,.pdf"
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      receiptFile: event.target.files?.[0] || null
                    }))
                  }
                  className="w-full rounded-lg border border-slate-200 px-3 py-2"
                />
              </label>
            )}

            <label className="text-sm text-ink-700 lg:col-span-4">
              <span className="mb-1 block">Notes</span>
              <textarea
                value={form.notes}
                onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))}
                className="w-full rounded-lg border border-slate-200 px-3 py-2"
                placeholder="Context and reason for this expense"
              />
              <span className="mt-1 block text-xs text-slate-600">
                Include maintenance request or inventory reference codes in notes when applicable.
              </span>
            </label>

            <div className="lg:col-span-4 flex gap-2">
              {isEditMode ? (
                <button
                  type="submit"
                  disabled={saving || loading}
                  className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
                >
                  {saving ? "Saving..." : "Update Expense"}
                </button>
              ) : (
                <>
                  <button
                    type="submit"
                    data-mode="draft"
                    disabled={saving || loading}
                    className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-ink-800 hover:bg-slate-50 disabled:opacity-60"
                  >
                    {saving ? "Saving..." : "Save as Draft"}
                  </button>
                  <button
                    type="submit"
                    data-mode="submit"
                    disabled={saving || loading}
                    className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
                  >
                    {saving ? "Saving..." : "Submit for Approval"}
                  </button>
                </>
              )}
              {isEditMode && (
                <button
                  type="button"
                  onClick={() =>
                    setForm({
                      ...emptyForm,
                      date: new Date().toISOString().slice(0, 10)
                    })
                  }
                  className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-ink-700 hover:bg-slate-50"
                >
                  Cancel Edit
                </button>
              )}
            </div>
            </form>
          </Card>
        </section>

        <section
          id="expenses-insights-section"
          className={cn(
            "gf-section",
            focusedSectionId === "expenses-insights-section" &&
              "rounded-2xl ring-2 ring-indigo-100 ring-offset-2 ring-offset-slate-50"
          )}
        >
          <SectionHeader
            title="Expense Insights and Trends"
            description="How costs are changing over time and where spending is concentrated."
          />
          <div className="gf-chart-grid">
          <div
            id="expenses-trend-section"
            className={cn(
              focusedSectionId === "expenses-trend-section" && "rounded-2xl ring-2 ring-indigo-100 ring-offset-2 ring-offset-slate-50"
            )}
          >
            <Card
              title="Expense Trend Over Time"
              subtitle={analytics.trendGranularity === "day" ? "Grouped by day" : "Grouped by month"}
              className="transition-shadow hover:shadow-md"
              onClick={() => {
                router.push(buildHref("/expenses"));
              }}
              clickLabel="Open expense trend details"
            >
              {loading ? (
                <p className="text-sm text-ink-600">Loading trend...</p>
              ) : analytics.expenseTrend.length === 0 ? (
                <p className="text-sm text-ink-600">No expense data yet.</p>
              ) : (
                <LineTrendChart
                  data={analytics.expenseTrend.map((point) => ({
                    bucketStart: point.bucketStart,
                    label: point.label,
                    amount: point.amount
                  }))}
                  xKey="label"
                  yKey="amount"
                  color="#f59e0b"
                  clickHint="Click trend points to drill into expense entries"
                  onBackgroundClick={() => {
                    router.push(buildHref("/expenses"));
                  }}
                  onElementClick={(entry) => {
                    const range = getBucketDateRange(entry.bucketStart);
                    if (!range) {
                      router.push(buildHref("/expenses"));
                      return;
                    }
                    router.push(
                      buildHref("/expenses", {
                        from: range.from,
                        to: range.to
                      })
                    );
                  }}
                />
              )}
            </Card>
          </div>

          <div
            id="expenses-category-driver-section"
            className={cn(
              focusedSectionId === "expenses-category-driver-section" &&
                "rounded-2xl ring-2 ring-indigo-100 ring-offset-2 ring-offset-slate-50"
            )}
          >
            <Card
              title="Expenses by Category"
              subtitle="Category-level cost distribution for the selected scope."
              className="transition-shadow hover:shadow-md"
              onClick={() => {
                router.push(buildHref("/expenses", { category: null }));
              }}
              clickLabel="Open expense category details"
            >
              {loading ? (
                <p className="text-sm text-ink-600">Loading...</p>
              ) : analytics.expensesByCategory.length === 0 ? (
                <p className="text-sm text-ink-600">No expenses found for current filters.</p>
              ) : (
                <BarCategoryChart
                  data={analytics.expensesByCategory}
                  xKey="name"
                  yKey="amount"
                  color="#ea580c"
                  clickHint="Click category bars to filter"
                  onBackgroundClick={() => {
                    router.push(buildHref("/expenses", { category: null }));
                  }}
                  onElementClick={(entry) => {
                    router.push(buildHref("/expenses", { category: entry.name }));
                  }}
                />
              )}
            </Card>
          </div>

          <div
            id="expenses-project-driver-section"
            className={cn(
              focusedSectionId === "expenses-project-driver-section" &&
                "rounded-2xl ring-2 ring-indigo-100 ring-offset-2 ring-offset-slate-50"
            )}
          >
            <Card
              title="Expenses by Project"
              subtitle="Project spend distribution in the selected scope."
              className="transition-shadow hover:shadow-md"
              onClick={() => {
                router.push(buildHref("/expenses", { projectId: null }));
              }}
              clickLabel="Open expense project details"
            >
              {loading ? (
                <p className="text-sm text-ink-600">Loading...</p>
              ) : analytics.expensesByProject.length === 0 ? (
                <p className="text-sm text-ink-600">No expenses found for current filters.</p>
              ) : (
                <BarCategoryChart
                  data={analytics.expensesByProject}
                  xKey="name"
                  yKey="amount"
                  color="#dc2626"
                  clickHint="Click project bars to filter"
                  onBackgroundClick={() => {
                    router.push(buildHref("/expenses", { projectId: null }));
                  }}
                  onElementClick={(entry) => {
                    router.push(buildHref("/expenses", { projectId: entry.id || null }));
                  }}
                />
              )}
            </Card>
          </div>

          <div
            id="expenses-rig-driver-section"
            className={cn(
              focusedSectionId === "expenses-rig-driver-section" &&
                "rounded-2xl ring-2 ring-indigo-100 ring-offset-2 ring-offset-slate-50"
            )}
          >
            <Card
              title="Expenses by Rig"
              subtitle="Rig-linked spending across active filters."
              className="transition-shadow hover:shadow-md"
              onClick={() => {
                router.push(buildHref("/expenses"));
              }}
              clickLabel="Open expense rig details"
            >
              {loading ? (
                <p className="text-sm text-ink-600">Loading...</p>
              ) : analytics.expensesByRig.length === 0 ? (
                <p className="text-sm text-ink-600">No expenses found for current filters.</p>
              ) : (
                <BarCategoryChart
                  data={analytics.expensesByRig}
                  xKey="name"
                  yKey="amount"
                  color="#b91c1c"
                  clickHint="Click rig bars to filter"
                  onBackgroundClick={() => {
                    router.push(buildHref("/expenses"));
                  }}
                  onElementClick={(entry) => {
                    if (!entry.id || entry.id === "unassigned-rig") {
                      router.push(buildHref("/expenses", { rigId: null }));
                      return;
                    }
                    router.push(buildHref("/expenses", { rigId: entry.id }));
                  }}
                />
              )}
            </Card>
          </div>
          </div>
        </section>

        <section
          id="expenses-records-section"
          className={cn(
            "gf-section",
            focusedSectionId === "expenses-records-section" &&
              "rounded-2xl ring-2 ring-indigo-100 ring-offset-2 ring-offset-slate-50"
          )}
        >
          <SectionHeader
            title="Detailed Expense Records"
            description="Operational-level records with approval status and action controls."
          />
          <Card title="Expense Entries">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Status
              </label>
              <select
                value={statusFilter}
                onChange={(event) =>
                  router.push(
                    buildHref("/expenses", {
                      status: event.target.value === "all" ? null : event.target.value
                    })
                  )
                }
                className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-ink-800"
              >
                <option value="all">All statuses</option>
                <option value="DRAFT">Draft</option>
                <option value="SUBMITTED">Submitted</option>
                <option value="APPROVED">Approved</option>
                <option value="REJECTED">Rejected</option>
              </select>
              {statusFilter !== "all" && (
                <button
                  type="button"
                  onClick={() => router.push(buildHref("/expenses", { status: null }))}
                  className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Clear status filter
                </button>
              )}
            </div>
            {loading ? (
              <p className="text-sm text-ink-600">Loading expense entries...</p>
            ) : expenses.length === 0 ? (
              <p className="text-sm text-ink-600">No expenses found for current filters.</p>
            ) : (
              <DataTable
                columns={[
                  "Date",
                  "Source",
                  "Client",
                  "Project",
                  "Rig",
                  "Status",
                  "Submitted",
                  "Submitted By",
                  "Approved/Rejected By",
                  "Decision Time",
                  "Category",
                  "Subcategory",
                  "Qty",
                  "Unit Cost",
                  "Amount",
                  "Vendor",
                  "Receipt No",
                  "Receipt",
                  "Actions"
                ]}
                rows={expenses.map((entry) => {
                const isApproved = entry.approvalStatus === "APPROVED";
                const isSubmitted = entry.approvalStatus === "SUBMITTED";
                const canSubmitAnyExpense = user?.role === "ADMIN";
                const canSubmitOwnExpense = !entry.enteredByUserId || entry.enteredByUserId === user?.id;
                const canSubmitEntry =
                  (entry.approvalStatus === "DRAFT" || entry.approvalStatus === "REJECTED") &&
                  (canSubmitAnyExpense || canSubmitOwnExpense);
                const decisionAt = formatDateCell(entry.approvedAt);
                const submittedAt = formatDateCell(entry.submittedAt, { includeTime: true });
                const entrySourceLabel = formatEntrySource(entry.entrySource);

                return [
                  formatDateCell(entry.date),
                  entrySourceLabel,
                  entry.client?.name || "-",
                  entry.project?.name || "-",
                  entry.rig?.rigCode || "-",
                  <div key={`status-${entry.id}`} className="space-y-1">
                    <StatusBadge status={entry.approvalStatus} />
                    {entry.rejectionReason && (
                      <p className="max-w-[220px] whitespace-normal text-[11px] text-red-700">
                        {entry.rejectionReason}
                      </p>
                    )}
                  </div>,
                  submittedAt,
                  entry.enteredBy?.fullName || "-",
                  entry.approvedBy?.fullName || "-",
                  decisionAt,
                  entry.category,
                  entry.subcategory || "-",
                  entry.quantity !== null ? formatNumber(entry.quantity) : "-",
                  entry.unitCost !== null ? formatCurrency(entry.unitCost) : "-",
                  formatCurrency(entry.amount),
                  entry.vendor || "-",
                  entry.receiptNumber || "-",
                  entry.receiptUrl ? (
                    <a
                      key={`receipt-${entry.id}`}
                      href={entry.receiptUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-brand-700 underline-offset-2 hover:underline"
                    >
                      View
                    </a>
                  ) : (
                    "None"
                  ),
                  <div key={`actions-${entry.id}`} className="flex max-w-[320px] flex-wrap gap-2">
                    {canSubmitEntry && (
                      <button
                        type="button"
                        className="rounded-md border border-amber-200 px-2 py-1 text-xs text-amber-800 hover:bg-amber-50"
                        onClick={() => void updateExpenseStatus(entry.id, "submit")}
                      >
                        Submit
                      </button>
                    )}

                    {canApprove && isSubmitted && (
                      <>
                        <input
                          type="text"
                          value={statusNotes[entry.id] || ""}
                          onChange={(event) =>
                            setStatusNotes((current) => ({
                              ...current,
                              [entry.id]: event.target.value
                            }))
                          }
                          placeholder="Reason (required for reject)"
                          className="w-48 rounded-md border border-slate-200 px-2 py-1 text-xs"
                        />
                        <button
                          type="button"
                          className="rounded-md border border-emerald-200 px-2 py-1 text-xs text-emerald-700 hover:bg-emerald-50"
                          onClick={() => void updateExpenseStatus(entry.id, "approve")}
                        >
                          Approve
                        </button>
                        <button
                          type="button"
                          className="rounded-md border border-red-200 px-2 py-1 text-xs text-red-700 hover:bg-red-50"
                          onClick={() => void updateExpenseStatus(entry.id, "reject")}
                        >
                          Reject
                        </button>
                      </>
                    )}

                    {canApprove && isApproved && (
                      <button
                        type="button"
                        className="rounded-md border border-slate-300 px-2 py-1 text-xs text-ink-700 hover:bg-slate-50"
                        onClick={() => void updateExpenseStatus(entry.id, "reopen")}
                      >
                        Reopen
                      </button>
                    )}

                    <button
                      type="button"
                      disabled={isApproved}
                      className="rounded-md border border-slate-200 px-2 py-1 text-xs text-ink-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                      onClick={() => startEdit(entry)}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      disabled={isApproved}
                      className="rounded-md border border-red-200 px-2 py-1 text-xs text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                      onClick={() => void deleteExpense(entry.id)}
                    >
                      Delete
                    </button>
                  </div>
                ];
                })}
                rowIds={expenses.map((entry) => `ai-focus-${entry.id}`)}
                rowClassNames={expenses.map((entry) =>
                  focusedRowId === entry.id ? "bg-indigo-50 ring-1 ring-inset ring-indigo-200" : ""
                )}
              />
            )}
          </Card>
        </section>
      </div>
    </AccessGate>
  );
}

function ratioAsPercent(amount: number, total: number) {
  if (!Number.isFinite(amount) || !Number.isFinite(total) || total <= 0) {
    return 0;
  }
  return (amount / total) * 100;
}

function roundPercent(value: number) {
  return Math.round(value * 10) / 10;
}

function ExpensesPageFallback() {
  return (
    <AccessGate permission="expenses:manual">
      <div className="gf-page-stack">
        <Card title="Expenses">
          <p className="text-sm text-ink-600">Loading expenses view...</p>
        </Card>
      </div>
    </AccessGate>
  );
}

function Input({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
  required = false,
  min,
  step
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
  required?: boolean;
  min?: string;
  step?: string;
}) {
  return (
    <label className="text-sm text-ink-700">
      <span className="mb-1 block">{label}</span>
      <input
        value={value}
        type={type}
        placeholder={placeholder}
        min={min}
        step={step}
        onChange={(event) => onChange(event.target.value)}
        required={required}
        className="w-full rounded-lg border border-slate-200 px-3 py-2"
      />
    </label>
  );
}

function Select({
  label,
  value,
  onChange,
  options,
  loading = false,
  emptyLabel = "No options available",
  required = false,
  allowEmpty = false
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  loading?: boolean;
  emptyLabel?: string;
  required?: boolean;
  allowEmpty?: boolean;
}) {
  const hasOptions = options.length > 0;
  const placeholder = loading ? "Loading..." : hasOptions ? "Select" : emptyLabel;

  return (
    <label className="text-sm text-ink-700">
      <span className="mb-1 block">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        required={required}
        className="w-full rounded-lg border border-slate-200 px-3 py-2"
      >
        <option value="" disabled={required && (loading || !hasOptions)}>
          {allowEmpty ? "None" : placeholder}
        </option>
        {!loading &&
          options.map((option) => (
            <option key={`${option.value}-${option.label}`} value={option.value}>
              {option.label}
            </option>
          ))}
      </select>
    </label>
  );
}

const statusToneClass: Record<ExpenseRecord["approvalStatus"], string> = {
  DRAFT: "border-slate-300 bg-slate-100 text-slate-700",
  SUBMITTED: "border-amber-300 bg-amber-100 text-amber-800",
  APPROVED: "border-emerald-300 bg-emerald-100 text-emerald-800",
  REJECTED: "border-red-300 bg-red-100 text-red-800"
};

const pillToneClass: Record<"amber" | "slate" | "emerald", string> = {
  amber: "border-amber-200 bg-amber-50 text-amber-800",
  slate: "border-slate-200 bg-slate-100 text-slate-700",
  emerald: "border-emerald-200 bg-emerald-50 text-emerald-800"
};

function StatusBadge({ status }: { status: ExpenseRecord["approvalStatus"] }) {
  return (
    <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${statusToneClass[status]}`}>
      {status.charAt(0) + status.slice(1).toLowerCase()}
    </span>
  );
}

function StatusPill({
  tone,
  children
}: {
  tone: "amber" | "slate" | "emerald";
  children: ReactNode;
}) {
  return (
    <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${pillToneClass[tone]}`}>
      {children}
    </span>
  );
}

function formatDateCell(
  value: string | null | undefined,
  options: {
    includeTime?: boolean;
  } = {}
) {
  if (!value) {
    return "-";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "-";
  }
  if (options.includeTime) {
    return parsed.toISOString().slice(0, 16).replace("T", " ");
  }
  return parsed.toISOString().slice(0, 10);
}

function formatEntrySource(source: string) {
  if (!source) {
    return "Unknown";
  }
  if (source === "MANUAL") {
    return "Manual";
  }
  if (source === "RECEIPT_INTAKE") {
    return "Receipt Intake";
  }
  return source
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function resolveStatusActionNotice(action: "submit" | "approve" | "reject" | "reopen") {
  if (action === "submit") {
    return "Expense submitted for approval.";
  }
  if (action === "approve") {
    return "Expense approved.";
  }
  if (action === "reject") {
    return "Expense rejected and returned for correction.";
  }
  return "Expense reopened as draft.";
}

function normalizeStatusFilter(value: string | null) {
  if (value === "DRAFT" || value === "SUBMITTED" || value === "APPROVED" || value === "REJECTED") {
    return value;
  }
  return "all";
}

function normalizeOptionalId(value: string | null) {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

async function readApiError(response: Response, fallbackMessage: string) {
  const clone = response.clone();
  const payload = await response.json().catch(() => null);
  if (payload && typeof payload === "object" && "message" in payload) {
    const message = payload.message;
    if (typeof message === "string" && message.trim()) {
      return message;
    }
  }

  const rawBody = (await clone.text().catch(() => "")).trim();
  const rawLower = rawBody.toLowerCase();
  if (rawBody && !rawLower.startsWith("<!doctype") && !rawLower.startsWith("<html")) {
    return rawBody;
  }

  return `${fallbackMessage} (HTTP ${response.status})`;
}
