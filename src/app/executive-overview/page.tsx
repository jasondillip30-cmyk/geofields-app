"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import { RotateCw } from "lucide-react";

import { AccessGate } from "@/components/layout/access-gate";
import { AiFocusPanel } from "@/components/layout/ai-focus-panel";
import { useRegisterCopilotContext } from "@/components/layout/ai-copilot-context";
import { useAnalyticsFilters } from "@/components/layout/analytics-filters-provider";
import { scrollToFocusElement, useCopilotFocusTarget } from "@/components/layout/copilot-focus-target";
import { FilterScopeBanner, hasActiveScopeFilters } from "@/components/layout/filter-scope-banner";
import { BarCategoryChart } from "@/components/charts/bar-category-chart";
import { Card, MetricCard } from "@/components/ui/card";
import { SectionHeader } from "@/components/ui/section-header";
import { DataTable } from "@/components/ui/table";
import type { CopilotPageContext } from "@/lib/ai/contextual-copilot";
import type { BudgetVsActualRow, BudgetVsActualSummaryResponse } from "@/lib/budget-vs-actual";
import type { CostTrackingSummaryPayload } from "@/lib/cost-tracking";
import { cn, formatCurrency, formatNumber, formatPercent } from "@/lib/utils";

interface ProfitSummaryPayload {
  totals: {
    totalRevenue: number;
    approvedExpenses: number;
    totalProfit: number;
  };
  kpis?: {
    highestProfitClient?: string;
    lowestProfitClient?: string;
  };
  trendGranularity: "day" | "month";
  profitTrend: Array<{
    bucketStart: string;
    label: string;
    revenue: number;
    expenses: number;
    profit: number;
  }>;
  profitByClient?: Array<{
    id: string;
    name: string;
    revenue: number;
    expenses: number;
    profit: number;
    margin: number;
  }>;
}

interface RevenueSummaryPayload {
  totals: {
    totalRevenue: number;
    reportsLogged: number;
  };
  revenueByClient: Array<{ id: string; name: string; revenue: number }>;
  revenueByProject: Array<{ id: string; name: string; revenue: number }>;
  revenueByRig: Array<{ id: string; name: string; revenue: number }>;
}

interface DrillingPendingRow {
  id: string;
  date?: string;
  submittedAt?: string | null;
  holeNumber?: string;
  project?: { id: string; name: string } | null;
  rig?: { id: string; rigCode: string } | null;
}

interface MaintenancePendingRow {
  id: string;
  requestCode?: string;
  date?: string;
  requestDate?: string;
  createdAt?: string;
  issueType?: string;
  urgency?: string;
  rig?: { id: string; rigCode: string } | null;
}

interface InventoryPendingRow {
  id: string;
  quantity: number;
  status: "SUBMITTED" | "PENDING";
  createdAt: string;
  requestedForDate: string | null;
  item?: { id: string; name: string; sku: string } | null;
  rig?: { id: string; rigCode: string } | null;
}

interface ReceiptPendingRow {
  id: string;
  reportDate: string;
  submittedAt: string | null;
  status: "SUBMITTED" | "APPROVED" | "REJECTED";
  summary: {
    supplierName: string;
    receiptNumber: string;
    total: number;
  };
}

type QueueKey = "drilling" | "maintenance" | "inventoryUsage" | "receiptSubmissions";

interface QueueSummary {
  key: QueueKey;
  label: string;
  count: number;
  over24h: number;
  over3d: number;
  oldestPendingAt: string | null;
}

interface PendingApprovalAttentionRow {
  id: string;
  queue: string;
  reference: string;
  pendingSince: string;
  ageHours: number;
  context: string;
}

const emptyProfitSummary: ProfitSummaryPayload = {
  totals: {
    totalRevenue: 0,
    approvedExpenses: 0,
    totalProfit: 0
  },
  trendGranularity: "day",
  profitTrend: []
};

const emptyRevenueSummary: RevenueSummaryPayload = {
  totals: {
    totalRevenue: 0,
    reportsLogged: 0
  },
  revenueByClient: [],
  revenueByProject: [],
  revenueByRig: []
};

const emptyCostSummary: CostTrackingSummaryPayload = {
  filters: {
    clientId: "all",
    rigId: "all",
    from: null,
    to: null
  },
  overview: {
    totalApprovedExpenses: 0,
    totalMaintenanceRelatedCost: 0,
    totalInventoryRelatedCost: 0,
    totalNonInventoryExpenseCost: 0,
    highestCostRig: null,
    highestCostProject: null
  },
  trendGranularity: "week",
  costByRig: [],
  costByProject: [],
  costByMaintenanceRequest: [],
  spendingCategoryBreakdown: [],
  costTrend: []
};

const emptyBudgetSummary: BudgetVsActualSummaryResponse = {
  filters: {
    clientId: "all",
    rigId: "all",
    from: null,
    to: null
  },
  totals: {
    totalBudget: 0,
    approvedSpend: 0,
    remainingBudget: 0,
    overspentCount: 0
  },
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

const UNASSIGNED_RIG_ID = "__unassigned_rig__";
const UNASSIGNED_PROJECT_ID = "__unassigned_project__";

export default function ExecutiveOverviewPage() {
  const { filters } = useAnalyticsFilters();
  const isScoped = hasActiveScopeFilters(filters);
  const alertsCenterHref = useMemo(() => {
    const params = buildFiltersQuery(filters);
    const query = params.toString();
    return `/alerts-center${query ? `?${query}` : ""}`;
  }, [filters]);
  const linkageCenterHref = useMemo(() => {
    const params = buildFiltersQuery(filters);
    const query = params.toString();
    return `/data-quality/linkage-center${query ? `?${query}` : ""}`;
  }, [filters]);
  const budgetVsActualHref = useMemo(() => {
    const params = buildFiltersQuery(filters);
    const query = params.toString();
    return `/cost-tracking/budget-vs-actual${query ? `?${query}` : ""}`;
  }, [filters]);
  const executiveOverviewHref = useMemo(() => {
    const params = buildFiltersQuery(filters);
    const query = params.toString();
    return `/executive-overview${query ? `?${query}` : ""}`;
  }, [filters]);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [profitSummary, setProfitSummary] = useState<ProfitSummaryPayload>(emptyProfitSummary);
  const [revenueSummary, setRevenueSummary] = useState<RevenueSummaryPayload>(emptyRevenueSummary);
  const [costSummary, setCostSummary] = useState<CostTrackingSummaryPayload>(emptyCostSummary);
  const [budgetSummary, setBudgetSummary] = useState<BudgetVsActualSummaryResponse>(emptyBudgetSummary);
  const [drillingPendingRows, setDrillingPendingRows] = useState<DrillingPendingRow[]>([]);
  const [maintenancePendingRows, setMaintenancePendingRows] = useState<MaintenancePendingRow[]>([]);
  const [inventoryPendingRows, setInventoryPendingRows] = useState<InventoryPendingRow[]>([]);
  const [receiptPendingRows, setReceiptPendingRows] = useState<ReceiptPendingRow[]>([]);
  const [queueFetchWarning, setQueueFetchWarning] = useState<string | null>(null);
  const [focusedSectionId, setFocusedSectionId] = useState<string | null>(null);
  const [focusedRowId, setFocusedRowId] = useState<string | null>(null);

  const loadExecutiveOverview = useCallback(
    async (silent = false) => {
      if (!silent) {
        setLoading(true);
      } else {
        setRefreshing(true);
      }
      setError(null);
      setQueueFetchWarning(null);

      const params = buildFiltersQuery(filters);
      const query = params.toString();
      const qs = query ? `?${query}` : "";

      try {
        const [profitRes, revenueRes, costRes, budgetRes, drillingRes, maintenanceRes, inventoryRes, receiptsRes] =
          await Promise.all([
            fetchJsonSafe<ProfitSummaryPayload>(`/api/profit/summary${qs}`),
            fetchJsonSafe<RevenueSummaryPayload>(`/api/revenue/summary${qs}`),
            fetchJsonSafe<CostTrackingSummaryPayload>(`/api/cost-tracking/summary${qs}`),
            fetchJsonSafe<BudgetVsActualSummaryResponse>(`/api/budgets/summary${qs}`),
            fetchJsonSafe<{ data: DrillingPendingRow[] }>(`/api/drilling-reports?${withStatus(params, "approvalStatus", "SUBMITTED")}`),
            fetchJsonSafe<{ data: MaintenancePendingRow[] }>(`/api/maintenance-requests?${withStatus(params, "status", "SUBMITTED")}`),
            fetchJsonSafe<{ data: InventoryPendingRow[] }>(`/api/inventory/usage-requests${qs}`),
            fetchJsonSafe<{ data: ReceiptPendingRow[] }>(`/api/inventory/receipt-intake/submissions?${withStatus(params, "status", "SUBMITTED")}`)
          ]);

        if (!profitRes.ok || !revenueRes.ok || !costRes.ok || !budgetRes.ok) {
          setError("Failed to load executive summary data.");
        }

        setProfitSummary(profitRes.data || emptyProfitSummary);
        setRevenueSummary(revenueRes.data || emptyRevenueSummary);
        setCostSummary(costRes.data || emptyCostSummary);
        setBudgetSummary(budgetRes.data || emptyBudgetSummary);

        const queueFailures = [drillingRes, maintenanceRes, inventoryRes, receiptsRes].filter(
          (result) => !result.ok
        );
        if (queueFailures.length > 0) {
          setQueueFetchWarning("Some approval queues could not be loaded completely. Showing available queue data.");
        }

        setDrillingPendingRows((drillingRes.data?.data || []).filter(Boolean));
        setMaintenancePendingRows((maintenanceRes.data?.data || []).filter(Boolean));
        setInventoryPendingRows(
          (inventoryRes.data?.data || []).filter((row) => row.status === "SUBMITTED" || row.status === "PENDING")
        );
        setReceiptPendingRows(
          (receiptsRes.data?.data || []).filter((row) => row.status === "SUBMITTED")
        );
      } catch {
        setError("Failed to load executive overview data.");
        setProfitSummary(emptyProfitSummary);
        setRevenueSummary(emptyRevenueSummary);
        setCostSummary(emptyCostSummary);
        setBudgetSummary(emptyBudgetSummary);
        setDrillingPendingRows([]);
        setMaintenancePendingRows([]);
        setInventoryPendingRows([]);
        setReceiptPendingRows([]);
      } finally {
        if (!silent) {
          setLoading(false);
        } else {
          setRefreshing(false);
        }
      }
    },
    [filters]
  );

  useEffect(() => {
    void loadExecutiveOverview();
  }, [loadExecutiveOverview]);

  const alertCounts = useMemo(() => {
    if (budgetSummary.alerts) {
      return budgetSummary.alerts;
    }
    const rows = [...budgetSummary.byRig, ...budgetSummary.byProject];
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
  }, [budgetSummary.alerts, budgetSummary.byProject, budgetSummary.byRig]);

  const queueSummary = useMemo(
    () =>
      [
        summarizeQueue("drilling", "Drilling Reports", drillingPendingRows, (row) => resolvePendingDate(row.submittedAt, row.date)),
        summarizeQueue(
          "maintenance",
          "Maintenance",
          maintenancePendingRows,
          (row) => resolvePendingDate(row.requestDate, row.createdAt, row.date)
        ),
        summarizeQueue(
          "inventoryUsage",
          "Inventory Usage",
          inventoryPendingRows,
          (row) => resolvePendingDate(row.createdAt, row.requestedForDate || null)
        ),
        summarizeQueue(
          "receiptSubmissions",
          "Receipt Submissions",
          receiptPendingRows,
          (row) => resolvePendingDate(row.submittedAt, row.reportDate)
        )
      ] satisfies QueueSummary[],
    [drillingPendingRows, inventoryPendingRows, maintenancePendingRows, receiptPendingRows]
  );

  const pendingApprovals = useMemo(
    () => queueSummary.reduce((sum, queue) => sum + queue.count, 0),
    [queueSummary]
  );

  const mostUrgentQueue = useMemo(() => {
    const withCounts = queueSummary.filter((queue) => queue.count > 0);
    if (withCounts.length === 0) {
      return null;
    }
    return [...withCounts].sort((a, b) => {
      const scoreA = a.over3d * 5 + a.over24h * 2 + a.count;
      const scoreB = b.over3d * 5 + b.over24h * 2 + b.count;
      if (scoreB !== scoreA) {
        return scoreB - scoreA;
      }
      const oldestA = toTimestamp(a.oldestPendingAt);
      const oldestB = toTimestamp(b.oldestPendingAt);
      return oldestA - oldestB;
    })[0];
  }, [queueSummary]);

  const oldestPendingRows = useMemo(
    () => buildOldestPendingRows({ drillingPendingRows, maintenancePendingRows, inventoryPendingRows, receiptPendingRows }),
    [drillingPendingRows, inventoryPendingRows, maintenancePendingRows, receiptPendingRows]
  );

  const missingLinkageRows = useMemo(() => {
    const rows: Array<[string, string, string, string]> = [];
    const unassignedRig = costSummary.costByRig.find((entry) => entry.id === UNASSIGNED_RIG_ID);
    const unassignedProject = costSummary.costByProject.find((entry) => entry.id === UNASSIGNED_PROJECT_ID);

    if (unassignedRig && unassignedRig.totalApprovedCost > 0) {
      rows.push([
        "Rig",
        unassignedRig.name,
        formatCurrency(unassignedRig.totalApprovedCost),
        "Needs rig linkage"
      ]);
    }

    if (unassignedProject && unassignedProject.totalApprovedCost > 0) {
      rows.push([
        "Project",
        unassignedProject.name,
        formatCurrency(unassignedProject.totalApprovedCost),
        "Needs project linkage"
      ]);
    }

    return rows;
  }, [costSummary.costByProject, costSummary.costByRig]);

  const budgetRiskRows = useMemo(() => {
    const combined = [
      ...budgetSummary.byRig.map((entry) => ({ scope: "Rig", ...entry })),
      ...budgetSummary.byProject.map((entry) => ({ scope: "Project", ...entry }))
    ];

    return combined
      .filter((entry) => entry.alertLevel === "OVERSPENT" || entry.alertLevel === "CRITICAL_90")
      .sort((a, b) => {
        const rank = (level: BudgetVsActualRow["alertLevel"]) => (level === "OVERSPENT" ? 0 : 1);
        const rankDiff = rank(a.alertLevel) - rank(b.alertLevel);
        if (rankDiff !== 0) return rankDiff;
        const percentA = a.percentUsed || 0;
        const percentB = b.percentUsed || 0;
        return percentB - percentA;
      });
  }, [budgetSummary.byProject, budgetSummary.byRig]);

  const budgetRiskTableRows = useMemo(
    () =>
      budgetRiskRows.map((entry) => [
        entry.scope,
        entry.name,
        formatCurrency(entry.budgetAmount),
        formatCurrency(entry.approvedSpend),
        formatCurrency(entry.remainingBudget),
        formatPercentUsed(entry.percentUsed),
        <BudgetStatusBadge key={`${entry.scope}-${entry.id}`} row={entry} />
      ]),
    [budgetRiskRows]
  );

  const budgetRiskRowIds = useMemo(
    () => budgetRiskRows.map((entry) => `ai-focus-${entry.id}`),
    [budgetRiskRows]
  );

  const budgetRiskRowClassNames = useMemo(
    () =>
      budgetRiskRows.map((entry) =>
        entry.id === focusedRowId ? "bg-indigo-50/70 ring-1 ring-inset ring-indigo-200" : ""
      ),
    [budgetRiskRows, focusedRowId]
  );

  const pendingAgingChart = useMemo(() => {
    const under24h = queueSummary.reduce((sum, queue) => sum + Math.max(0, queue.count - queue.over24h - queue.over3d), 0);
    const over24h = queueSummary.reduce((sum, queue) => sum + queue.over24h, 0);
    const over3d = queueSummary.reduce((sum, queue) => sum + queue.over3d, 0);
    return [
      { label: "Under 24h", count: under24h },
      { label: "Over 24h", count: over24h },
      { label: "Over 3d", count: over3d }
    ];
  }, [queueSummary]);

  const alertsCenterAttentionCount = useMemo(() => {
    const stalePending = queueSummary.reduce((sum, entry) => sum + entry.over24h + entry.over3d, 0);
    return alertCounts.overspentCount + alertCounts.criticalCount + stalePending + missingLinkageRows.length;
  }, [alertCounts.criticalCount, alertCounts.overspentCount, missingLinkageRows.length, queueSummary]);

  const queueRowsWithMeta = useMemo(
    () =>
      queueSummary
        .filter((queue) => queue.count > 0)
        .sort((a, b) => b.count - a.count)
        .map((queue) => ({
          id: queue.key,
          cells: [
            queue.label,
            `${queue.count}`,
            `${queue.over24h}`,
            `${queue.over3d}`,
            queue.oldestPendingAt ? formatDateTime(queue.oldestPendingAt) : "—"
          ]
        })),
    [queueSummary]
  );

  const queueRows = useMemo(
    () => queueRowsWithMeta.map((entry) => entry.cells),
    [queueRowsWithMeta]
  );

  const queueRowIds = useMemo(
    () => queueRowsWithMeta.map((entry) => `ai-focus-${entry.id}`),
    [queueRowsWithMeta]
  );

  const queueRowClassNames = useMemo(
    () =>
      queueRowsWithMeta.map((entry) =>
        entry.id === focusedRowId ? "bg-indigo-50/70 ring-1 ring-inset ring-indigo-200" : ""
      ),
    [focusedRowId, queueRowsWithMeta]
  );

  const oldestPendingRowIds = useMemo(
    () => oldestPendingRows.slice(0, 8).map((entry) => `ai-focus-${entry.id}`),
    [oldestPendingRows]
  );

  const oldestPendingRowClassNames = useMemo(
    () =>
      oldestPendingRows.slice(0, 8).map((entry) =>
        entry.id === focusedRowId ? "bg-indigo-50/70 ring-1 ring-inset ring-indigo-200" : ""
      ),
    [focusedRowId, oldestPendingRows]
  );

  const topMaintenanceCost = costSummary.costByMaintenanceRequest[0] || null;
  const topRevenueRig = revenueSummary.revenueByRig[0] || null;
  const topRevenueProject = revenueSummary.revenueByProject[0] || null;
  const topRevenueClient = revenueSummary.revenueByClient[0] || null;
  const decliningProfitClient = useMemo(
    () => deriveDecliningProfitClient(profitSummary),
    [profitSummary]
  );
  const incompleteDrillingReports = useMemo(
    () => queueSummary.find((entry) => entry.key === "drilling")?.count || 0,
    [queueSummary]
  );
  const missingRevenueRigAttributionAmount = useMemo(
    () => deriveMissingRevenueRigAttributionAmount(revenueSummary),
    [revenueSummary]
  );
  const profitabilityConcern = useMemo(
    () =>
      deriveProfitabilityConcern({
        costByRig: costSummary.costByRig,
        costByProject: costSummary.costByProject,
        revenueByRig: revenueSummary.revenueByRig,
        revenueByProject: revenueSummary.revenueByProject
      }),
    [costSummary.costByProject, costSummary.costByRig, revenueSummary.revenueByProject, revenueSummary.revenueByRig]
  );

  const copilotContext = useMemo<CopilotPageContext>(
    () => ({
      pageKey: "executive-overview",
      pageName: "Executive Overview",
      filters: {
        clientId: filters.clientId,
        rigId: filters.rigId,
        from: filters.from || null,
        to: filters.to || null
      },
      summaryMetrics: [
        { key: "revenue", label: "Total Revenue", value: profitSummary.totals.totalRevenue },
        { key: "approvedExpenses", label: "Approved Expenses", value: profitSummary.totals.approvedExpenses },
        { key: "profit", label: "Profit", value: profitSummary.totals.totalProfit },
        { key: "pendingApprovals", label: "Pending Approvals", value: pendingApprovals },
        { key: "overspentBuckets", label: "Overspent Buckets", value: alertCounts.overspentCount },
        { key: "criticalBuckets", label: "Critical Buckets", value: alertCounts.criticalCount },
        { key: "noBudgetBuckets", label: "No-Budget Buckets", value: alertCounts.noBudgetCount },
        { key: "missingLinkage", label: "Missing Linkage Records", value: missingLinkageRows.length },
        { key: "topRevenueRig", label: "Top Revenue Rig", value: topRevenueRig?.name || "N/A" },
        { key: "topRevenueRigAmount", label: "Top Revenue Rig Amount", value: topRevenueRig?.revenue || 0 },
        { key: "topRevenueProject", label: "Top Revenue Project", value: topRevenueProject?.name || "N/A" },
        { key: "topRevenueProjectAmount", label: "Top Revenue Project Amount", value: topRevenueProject?.revenue || 0 },
        { key: "topRevenueClient", label: "Top Revenue Client", value: topRevenueClient?.name || "N/A" },
        { key: "topRevenueClientAmount", label: "Top Revenue Client Amount", value: topRevenueClient?.revenue || 0 },
        {
          key: "decliningProfitClient",
          label: "Declining Profitability Client",
          value: decliningProfitClient?.name || "N/A"
        },
        {
          key: "decliningProfitClientAmount",
          label: "Declining Profitability Client Amount",
          value: decliningProfitClient?.profit || 0
        },
        {
          key: "incompleteDrillingReports",
          label: "Incomplete Drilling Reports",
          value: incompleteDrillingReports
        },
        {
          key: "missingRevenueRigAttributionAmount",
          label: "Missing Revenue Rig Attribution Amount",
          value: missingRevenueRigAttributionAmount
        },
        { key: "highestCostRig", label: "Highest Cost Rig", value: costSummary.overview.highestCostRig?.name || "N/A" },
        {
          key: "highestCostProject",
          label: "Highest Cost Project",
          value: costSummary.overview.highestCostProject?.name || "N/A"
        },
        {
          key: "profitabilityConcern",
          label: "Biggest Profitability Issue",
          value: profitabilityConcern?.label || "N/A"
        },
        {
          key: "profitabilityConcernAmount",
          label: "Profitability Concern Amount",
          value: profitabilityConcern?.gapAmount || 0
        }
      ],
      tablePreviews: [
        {
          key: "approval-queues",
          title: "Approval Queues",
          rowCount: queueSummary.length,
          columns: ["Queue", "Pending", "Over24h", "Over3d", "Href"],
          rows: queueSummary.slice(0, 8).map((queue) => ({
            id: queue.key,
            queue: queue.label,
            pending: queue.count,
            over24h: queue.over24h,
            over3d: queue.over3d,
            href: buildScopedApprovalsHref(filters, resolveApprovalsTabByQueueKey(queue.key)),
            issueType: "APPROVAL_BACKLOG",
            sectionId: resolveApprovalsTabByQueueKey(queue.key)
              ? `approvals-tab-${resolveApprovalsTabByQueueKey(queue.key)}`
              : null
          }))
        },
        {
          key: "budget-risk",
          title: "Budget Risk",
          rowCount: budgetSummary.byRig.length + budgetSummary.byProject.length,
          columns: ["Scope", "Entity", "PercentUsed", "Status"],
          rows: [
            ...budgetSummary.byRig.map((entry) => ({ scope: "Rig", ...entry })),
            ...budgetSummary.byProject.map((entry) => ({ scope: "Project", ...entry }))
          ]
            .filter((entry) => entry.alertLevel === "OVERSPENT" || entry.alertLevel === "CRITICAL_90")
            .slice(0, 8)
            .map((entry) => ({
              id: entry.id,
              scope: entry.scope,
              entity: entry.name,
              approvedSpend: entry.approvedSpend,
              percentUsed: entry.percentUsed,
              status: entry.statusLabel,
              href: budgetVsActualHref,
              targetId: entry.id,
              sectionId: entry.scope === "Rig" ? "rig-budget-section" : "project-budget-section",
              targetPageKey: "budget-vs-actual"
            }))
        },
        {
          key: "profitability-risk",
          title: "Profitability Risk",
          rowCount: profitabilityConcern ? 1 : 0,
          columns: ["Scope", "Entity", "Revenue", "Cost", "Gap"],
          rows: profitabilityConcern
            ? [
                {
                  id: profitabilityConcern.id,
                  scope: profitabilityConcern.scope,
                  entity: profitabilityConcern.label,
                  revenue: profitabilityConcern.revenue,
                  cost: profitabilityConcern.cost,
                  gap: profitabilityConcern.gapAmount,
                  href: profitabilityConcern.href,
                  targetPageKey: profitabilityConcern.targetPageKey,
                  sectionId: profitabilityConcern.sectionId
                }
              ]
            : []
        }
      ],
      priorityItems: [
        ...(profitabilityConcern
          ? [
              {
                id: `profitability-${profitabilityConcern.id}`,
                label: profitabilityConcern.label,
                reason: `${profitabilityConcern.scope} has high spend (${formatCurrency(
                  profitabilityConcern.cost
                )}) relative to revenue (${formatCurrency(
                  profitabilityConcern.revenue
                )}), creating a profitability gap.`,
                severity: "HIGH" as const,
                amount: profitabilityConcern.gapAmount,
                href: profitabilityConcern.href,
                issueType: "PROFITABILITY",
                sectionId: profitabilityConcern.sectionId,
                targetPageKey: profitabilityConcern.targetPageKey
              }
            ]
          : []),
        ...(decliningProfitClient
          ? [
              {
                id: `client-profitability-${decliningProfitClient.id}`,
                label: `Client profitability concern: ${decliningProfitClient.name}`,
                reason: `${decliningProfitClient.name} is currently operating at ${formatCurrency(
                  decliningProfitClient.profit
                )} profit.`,
                severity: decliningProfitClient.profit < 0 ? ("HIGH" as const) : ("MEDIUM" as const),
                amount: Math.abs(decliningProfitClient.profit),
                href: `/clients/${decliningProfitClient.id}`,
                issueType: "PROFITABILITY",
                targetPageKey: "clients"
              }
            ]
          : []),
        ...(incompleteDrillingReports > 0
          ? [
              {
                id: "drilling-completeness-backlog",
                label: "Incomplete daily drilling reports",
                reason: `${incompleteDrillingReports} drilling report(s) remain pending approval and may block operational visibility.`,
                severity: incompleteDrillingReports >= 5 ? ("HIGH" as const) : ("MEDIUM" as const),
                amount: null,
                href: buildScopedApprovalsHref(filters, "drilling-reports"),
                issueType: "DRILLING_REPORT_COMPLETENESS",
                sectionId: "approvals-tab-drilling-reports",
                targetPageKey: "approvals"
              }
            ]
          : []),
        ...(missingRevenueRigAttributionAmount > 0
          ? [
              {
                id: "revenue-rig-attribution-gap",
                label: "Revenue records missing rig attribution",
                reason: `${formatCurrency(
                  missingRevenueRigAttributionAmount
                )} approved revenue is unassigned to a rig.`,
                severity: "HIGH" as const,
                amount: missingRevenueRigAttributionAmount,
                href: "/revenue",
                issueType: "LINKAGE",
                sectionId: "revenue-by-rig-section",
                targetPageKey: "revenue"
              }
            ]
          : []),
        ...[
          ...budgetSummary.byRig.map((entry) => ({ scope: "Rig", ...entry })),
          ...budgetSummary.byProject.map((entry) => ({ scope: "Project", ...entry }))
        ]
          .filter((entry) => entry.alertLevel === "OVERSPENT" || entry.alertLevel === "CRITICAL_90")
          .sort((a, b) => {
            const rank = (level: BudgetVsActualRow["alertLevel"]) => (level === "OVERSPENT" ? 0 : 1);
            const rankDiff = rank(a.alertLevel) - rank(b.alertLevel);
            if (rankDiff !== 0) {
              return rankDiff;
            }
            const percentA = a.percentUsed || 0;
            const percentB = b.percentUsed || 0;
            if (percentB !== percentA) {
              return percentB - percentA;
            }
            return b.approvedSpend - a.approvedSpend;
          })
          .slice(0, 4)
          .map((entry) => ({
            id: `budget-${entry.scope}-${entry.id}`,
            label: `${entry.scope}: ${entry.name}`,
            reason:
              entry.alertLevel === "OVERSPENT"
                ? "Overspent budget bucket with immediate cost containment need."
                : "Critical budget pressure nearing or above safe utilization threshold.",
            severity: entry.alertLevel === "OVERSPENT" ? ("CRITICAL" as const) : ("HIGH" as const),
            amount: entry.approvedSpend,
            href: budgetVsActualHref,
            issueType: entry.alertLevel,
            targetId: entry.id,
            sectionId: entry.scope === "Rig" ? "rig-budget-section" : "project-budget-section",
            targetPageKey: "budget-vs-actual"
          })),
        ...oldestPendingRows.slice(0, 3).map((entry) => ({
          id: entry.id,
          label: `${entry.queue}: ${entry.reference}`,
          reason: `Pending ${formatPendingAge(entry.ageHours)} • ${entry.context}`,
          severity: entry.ageHours >= 72 ? ("HIGH" as const) : ("MEDIUM" as const),
          amount: null,
          href: buildScopedApprovalsHref(filters, resolveApprovalsTabByQueueLabel(entry.queue)),
          issueType: "APPROVAL_BACKLOG",
          sectionId: resolveApprovalsTabByQueueLabel(entry.queue)
            ? `approvals-tab-${resolveApprovalsTabByQueueLabel(entry.queue)}`
            : undefined,
          targetPageKey: "approvals"
        }))
      ],
      navigationTargets: [
        {
          label: "Open Executive Risk and Attention",
          href: executiveOverviewHref,
          reason: "Jump to current risk and attention sections in this scope.",
          pageKey: "executive-overview",
          sectionId: "executive-risk-attention-section"
        },
        { label: "Open Alerts Center", href: alertsCenterHref, reason: "Triage highest-priority alerts.", pageKey: "alerts-center" },
        { label: "Open Data Quality Center", href: linkageCenterHref, reason: "Resolve missing linkage issues.", pageKey: "data-quality-linkage-center" },
        { label: "Open Budget vs Actual", href: budgetVsActualHref, reason: "Review budget pressure.", pageKey: "budget-vs-actual" },
        {
          label: "Open Drilling Reports Approvals",
          href: buildScopedApprovalsHref(filters, "drilling-reports"),
          reason: "Process drilling approvals backlog.",
          pageKey: "approvals",
          sectionId: "approvals-tab-drilling-reports"
        }
      ],
      notes: [
        "Use AI guidance for advisory triage only; no automatic approvals or edits are performed."
      ]
    }),
    [
      alertCounts.criticalCount,
      alertCounts.noBudgetCount,
      alertCounts.overspentCount,
      alertsCenterHref,
      budgetSummary.byProject,
      budgetSummary.byRig,
      budgetVsActualHref,
      costSummary.overview.highestCostProject?.name,
      costSummary.overview.highestCostRig?.name,
      executiveOverviewHref,
      filters,
      filters.clientId,
      filters.from,
      filters.rigId,
      filters.to,
      linkageCenterHref,
      missingLinkageRows.length,
      incompleteDrillingReports,
      missingRevenueRigAttributionAmount,
      decliningProfitClient,
      profitabilityConcern,
      pendingApprovals,
      profitSummary.totals.approvedExpenses,
      profitSummary.totals.totalProfit,
      profitSummary.totals.totalRevenue,
      topRevenueClient?.name,
      topRevenueClient?.revenue,
      topRevenueProject?.name,
      topRevenueProject?.revenue,
      topRevenueRig?.name,
      topRevenueRig?.revenue,
      revenueSummary.revenueByClient,
      revenueSummary.revenueByProject,
      revenueSummary.revenueByRig,
      queueSummary,
      oldestPendingRows
    ]
  );

  useRegisterCopilotContext(copilotContext);

  useCopilotFocusTarget({
    pageKey: "executive-overview",
    onFocus: (target) => {
      setFocusedSectionId(target.sectionId || null);
      setFocusedRowId(target.targetId || null);
      scrollToFocusElement({
        sectionId: target.sectionId || null,
        targetId: target.targetId || null
      });
    }
  });

  useEffect(() => {
    if (!focusedSectionId && !focusedRowId) {
      return;
    }
    const timeout = window.setTimeout(() => {
      setFocusedSectionId(null);
      setFocusedRowId(null);
    }, 4200);
    return () => {
      window.clearTimeout(timeout);
    };
  }, [focusedRowId, focusedSectionId]);

  return (
    <AccessGate permission="finance:view">
      <div className="gf-page-stack">
        <FilterScopeBanner filters={filters} />

        <section
          id="executive-overview-summary-section"
          className={cn(
            "gf-section",
            focusedSectionId === "executive-overview-summary-section" &&
              "rounded-2xl ring-2 ring-indigo-100 ring-offset-2 ring-offset-slate-50"
          )}
        >
          <SectionHeader
            title="Executive Overview"
            description="Manager snapshot across approved finance performance, approvals pressure, and operational risk."
            action={
              <button
                type="button"
                className="gf-btn-subtle inline-flex items-center gap-1"
                onClick={() => void loadExecutiveOverview(true)}
              >
                <RotateCw size={13} className={refreshing ? "animate-spin" : ""} />
                Refresh
              </button>
            }
          />
          <div className="gf-kpi-grid-primary">
            <MetricCard
              label={isScoped ? "Revenue in Scope" : "Total Revenue"}
              value={formatCurrency(profitSummary.totals.totalRevenue)}
            />
            <MetricCard label="Approved Expenses" value={formatCurrency(profitSummary.totals.approvedExpenses)} tone="warn" />
            <MetricCard
              label="Profit"
              value={formatCurrency(profitSummary.totals.totalProfit)}
              tone={profitSummary.totals.totalProfit < 0 ? "danger" : "good"}
            />
            <MetricCard label="Pending Approvals" value={`${pendingApprovals}`} tone={pendingApprovals > 0 ? "warn" : "good"} />
          </div>
          <div className="gf-kpi-grid-secondary">
            <MetricCard label="Overspent Buckets" value={`${alertCounts.overspentCount}`} tone="danger" />
            <MetricCard label="No-Budget Buckets" value={`${alertCounts.noBudgetCount}`} />
            <MetricCard label="Critical Buckets" value={`${alertCounts.criticalCount}`} tone="warn" />
            <MetricCard label="Watch Buckets" value={`${alertCounts.watchCount}`} tone="warn" />
          </div>
          {error ? <div className="gf-feedback-error">{error}</div> : null}
          {queueFetchWarning ? <div className="gf-inline-note">{queueFetchWarning}</div> : null}
        </section>

        <section
          id="executive-operational-highlights-section"
          className={cn(
            "gf-section",
            focusedSectionId === "executive-operational-highlights-section" &&
              "rounded-2xl ring-2 ring-indigo-100 ring-offset-2 ring-offset-slate-50"
          )}
        >
          <SectionHeader
            title="Operational Highlights"
            description="What needs manager attention first across operations and approvals."
          />
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <Card title="Highest Cost Rig">
              <p className="text-xl font-semibold text-ink-900">{costSummary.overview.highestCostRig?.name || "N/A"}</p>
              <p className="mt-1 text-sm text-slate-600">
                {costSummary.overview.highestCostRig
                  ? formatCurrency(costSummary.overview.highestCostRig.totalApprovedCost)
                  : "No approved cost data"}
              </p>
            </Card>
            <Card title="Highest Cost Project">
              <p className="text-xl font-semibold text-ink-900">{costSummary.overview.highestCostProject?.name || "N/A"}</p>
              <p className="mt-1 text-sm text-slate-600">
                {costSummary.overview.highestCostProject
                  ? formatCurrency(costSummary.overview.highestCostProject.totalApprovedCost)
                  : "No approved cost data"}
              </p>
            </Card>
            <Card title="Most Urgent Approval Queue">
              <p className="text-xl font-semibold text-ink-900">{mostUrgentQueue?.label || "None Pending"}</p>
              <p className="mt-1 text-sm text-slate-600">
                {mostUrgentQueue
                  ? `${mostUrgentQueue.count} pending • ${mostUrgentQueue.over3d} over 3 days`
                  : "No pending approvals in scope"}
              </p>
            </Card>
            <Card title="Most Expensive Maintenance Area">
              <p className="text-xl font-semibold text-ink-900">{topMaintenanceCost?.reference || "N/A"}</p>
              <p className="mt-1 text-sm text-slate-600">
                {topMaintenanceCost
                  ? `${topMaintenanceCost.rigName} • ${formatCurrency(topMaintenanceCost.totalLinkedCost)}`
                  : "No maintenance-linked cost in scope"}
              </p>
            </Card>
          </div>
        </section>

        <section
          id="executive-focus-panel-section"
          className={cn(
            "gf-section",
            focusedSectionId === "executive-focus-panel-section" &&
              "rounded-2xl ring-2 ring-indigo-100 ring-offset-2 ring-offset-slate-50"
          )}
        >
          <AiFocusPanel context={copilotContext} pageKey="executive-overview" />
        </section>

        <section
          id="executive-trend-section"
          className={cn(
            "gf-section",
            focusedSectionId === "executive-trend-section" &&
              "rounded-2xl ring-2 ring-indigo-100 ring-offset-2 ring-offset-slate-50"
          )}
        >
          <SectionHeader
            title="Trend"
            description="Revenue, approved expense, and profit movement plus current approvals pressure aging."
          />
          <div className="gf-chart-grid">
            <Card
              title={`Revenue vs Approved Expense vs Profit (${profitSummary.trendGranularity === "day" ? "Daily" : "Monthly"})`}
              subtitle="Approved-only finance trend from current filter scope."
            >
              {loading ? (
                <p className="text-sm text-slate-600">Loading finance trend...</p>
              ) : profitSummary.profitTrend.length === 0 ? (
                <div className="gf-empty-state">No approved finance trend data found for the selected filters.</div>
              ) : (
                <ExecutiveTrendChart data={profitSummary.profitTrend} />
              )}
            </Card>

            <Card
              title="Pending Approvals Aging"
              subtitle="Live queue aging snapshot (historical pending trend is not currently stored)."
            >
              {loading ? (
                <p className="text-sm text-slate-600">Loading approvals aging...</p>
              ) : pendingApprovals === 0 ? (
                <div className="gf-empty-state">No pending approvals in the current scope.</div>
              ) : (
                <div className="space-y-4">
                  <BarCategoryChart data={pendingAgingChart} xKey="label" yKey="count" color="#1e63f5" />
                  <DataTable
                    columns={["Queue", "Pending", "Over 24h", "Over 3d", "Oldest Pending"]}
                    rows={queueRows}
                    rowIds={queueRowIds}
                    rowClassNames={queueRowClassNames}
                  />
                </div>
              )}
            </Card>
          </div>
        </section>

        <section
          id="executive-risk-attention-section"
          className={cn(
            "gf-section",
            focusedSectionId === "executive-risk-attention-section" &&
              "rounded-2xl ring-2 ring-indigo-100 ring-offset-2 ring-offset-slate-50"
          )}
        >
          <SectionHeader
            title="Risk and Attention"
            description="Budget pressure, linkage quality, and oldest approval backlog."
          />
          <Card
            title="Alerts Center Shortcut"
            subtitle="Open consolidated manager alerts with status actions and direct routing."
            action={
              <Link href={alertsCenterHref} className="gf-btn-subtle text-xs">
                Open Alerts Center
              </Link>
            }
            className="p-4 md:p-4 lg:p-4"
          >
            <p className="text-sm text-slate-700">
              Current attention signals in scope:{" "}
              <span className="font-semibold text-ink-900">{formatNumber(alertsCenterAttentionCount)}</span>
            </p>
          </Card>
          <div className="grid gap-4 xl:grid-cols-2">
            <Card
              title="Overspent and Critical Budgets"
              subtitle="Budget buckets at immediate risk under current scope."
            >
              {loading ? (
                <p className="text-sm text-slate-600">Loading budget risk items...</p>
              ) : budgetRiskRows.length === 0 ? (
                <div className="gf-empty-state">No overspent or critical budget buckets in scope.</div>
              ) : (
                <DataTable
                  columns={["Scope", "Entity", "Budget", "Approved Spend", "Remaining", "% Used", "Status"]}
                  rows={budgetRiskTableRows}
                  rowIds={budgetRiskRowIds}
                  rowClassNames={budgetRiskRowClassNames}
                />
              )}
            </Card>

            <Card
              title="Oldest Pending Approvals"
              subtitle="Queues sorted by oldest pending timestamp to help triage stale decisions."
            >
              {loading ? (
                <p className="text-sm text-slate-600">Loading oldest pending approvals...</p>
              ) : oldestPendingRows.length === 0 ? (
                <div className="gf-empty-state">No pending approvals in scope.</div>
              ) : (
                <DataTable
                  columns={["Queue", "Record", "Pending Since", "Age", "Context"]}
                  rows={oldestPendingRows.slice(0, 8).map((entry) => [
                    entry.queue,
                    entry.reference,
                    formatDateTime(entry.pendingSince),
                    formatPendingAge(entry.ageHours),
                    entry.context
                  ])}
                  rowIds={oldestPendingRowIds}
                  rowClassNames={oldestPendingRowClassNames}
                />
              )}
            </Card>
          </div>

          <div className="mt-4">
            <Card
              title="Missing Linkage Attention"
              subtitle="Approved spend that remains unassigned to rig/project entities."
              action={
                <Link href={linkageCenterHref} className="gf-btn-subtle text-xs">
                  Open Linkage Center
                </Link>
              }
            >
              {loading ? (
                <p className="text-sm text-slate-600">Loading linkage attention items...</p>
              ) : missingLinkageRows.length === 0 ? (
                <div className="gf-empty-state">No missing linkage spend detected for the selected filters.</div>
              ) : (
                <DataTable columns={["Scope", "Entity", "Approved Cost", "Action"]} rows={missingLinkageRows} />
              )}
            </Card>
          </div>
        </section>
      </div>
    </AccessGate>
  );
}

function buildFiltersQuery(filters: { clientId: string; rigId: string; from: string; to: string }) {
  const params = new URLSearchParams();
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  if (filters.clientId !== "all") params.set("clientId", filters.clientId);
  if (filters.rigId !== "all") params.set("rigId", filters.rigId);
  return params;
}

function buildScopedApprovalsHref(
  filters: { clientId: string; rigId: string; from: string; to: string },
  tab?: string | null
) {
  const params = buildFiltersQuery(filters);
  if (tab) {
    params.set("tab", tab);
  }
  const query = params.toString();
  return `/approvals${query ? `?${query}` : ""}`;
}

function resolveApprovalsTabByQueueKey(key: QueueKey) {
  if (key === "drilling") {
    return "drilling-reports";
  }
  if (key === "maintenance") {
    return "maintenance";
  }
  if (key === "inventoryUsage") {
    return "inventory-usage";
  }
  if (key === "receiptSubmissions") {
    return "receipt-submissions";
  }
  return null;
}

function resolveApprovalsTabByQueueLabel(queue: string) {
  const normalized = queue.toLowerCase();
  if (normalized.includes("drilling")) {
    return "drilling-reports";
  }
  if (normalized.includes("maintenance")) {
    return "maintenance";
  }
  if (normalized.includes("inventory")) {
    return "inventory-usage";
  }
  if (normalized.includes("receipt")) {
    return "receipt-submissions";
  }
  return null;
}

function withStatus(base: URLSearchParams, key: string, value: string) {
  const clone = new URLSearchParams(base);
  clone.set(key, value);
  return clone.toString();
}

async function fetchJsonSafe<T>(url: string): Promise<{ ok: boolean; data: T | null; status: number }> {
  try {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) {
      return { ok: false, data: null, status: response.status };
    }
    const payload = (await response.json()) as T;
    return { ok: true, data: payload, status: response.status };
  } catch {
    return { ok: false, data: null, status: 0 };
  }
}

function deriveDecliningProfitClient(summary: ProfitSummaryPayload) {
  const byClient = Array.isArray(summary.profitByClient) ? summary.profitByClient : [];
  if (byClient.length === 0) {
    return null;
  }
  const sorted = [...byClient].sort((a, b) => a.profit - b.profit);
  return sorted[0] || null;
}

function deriveMissingRevenueRigAttributionAmount(summary: RevenueSummaryPayload) {
  const unassigned = summary.revenueByRig.find(
    (entry) => /unassigned/i.test(entry.id) || /unassigned/i.test(entry.name)
  );
  return unassigned?.revenue || 0;
}

function deriveProfitabilityConcern({
  costByRig,
  costByProject,
  revenueByRig,
  revenueByProject
}: {
  costByRig: CostTrackingSummaryPayload["costByRig"];
  costByProject: CostTrackingSummaryPayload["costByProject"];
  revenueByRig: RevenueSummaryPayload["revenueByRig"];
  revenueByProject: RevenueSummaryPayload["revenueByProject"];
}) {
  const candidates: Array<{
    id: string;
    scope: "Rig" | "Project";
    label: string;
    revenue: number;
    cost: number;
    gapAmount: number;
    href: string;
    sectionId: string;
    targetPageKey: "cost-tracking";
  }> = [];

  const revenueRigMap = new Map(revenueByRig.map((entry) => [entry.id, entry.revenue]));
  for (const row of costByRig) {
    if (!row.id || row.id === UNASSIGNED_RIG_ID) {
      continue;
    }
    const revenue = revenueRigMap.get(row.id) || 0;
    const gap = row.totalApprovedCost - revenue;
    if (gap <= 0) {
      continue;
    }
    candidates.push({
      id: row.id,
      scope: "Rig",
      label: row.name,
      revenue,
      cost: row.totalApprovedCost,
      gapAmount: gap,
      href: "/cost-tracking",
      sectionId: "cost-by-rig-section",
      targetPageKey: "cost-tracking"
    });
  }

  const revenueProjectMap = new Map(revenueByProject.map((entry) => [entry.id, entry.revenue]));
  for (const row of costByProject) {
    if (!row.id || row.id === UNASSIGNED_PROJECT_ID) {
      continue;
    }
    const revenue = revenueProjectMap.get(row.id) || 0;
    const gap = row.totalApprovedCost - revenue;
    if (gap <= 0) {
      continue;
    }
    candidates.push({
      id: row.id,
      scope: "Project",
      label: row.name,
      revenue,
      cost: row.totalApprovedCost,
      gapAmount: gap,
      href: "/cost-tracking",
      sectionId: "cost-by-project-section",
      targetPageKey: "cost-tracking"
    });
  }

  if (candidates.length === 0) {
    return null;
  }
  return candidates.sort((a, b) => b.gapAmount - a.gapAmount)[0];
}

function resolvePendingDate(...candidates: Array<string | null | undefined>) {
  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }
    const parsed = new Date(candidate);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
  }
  return null;
}

function summarizeQueue<T>(
  key: QueueKey,
  label: string,
  rows: T[],
  getPendingDate: (row: T) => string | null
): QueueSummary {
  let over24h = 0;
  let over3d = 0;
  let oldestPendingAt: string | null = null;

  for (const row of rows) {
    const pendingAt = getPendingDate(row);
    if (!pendingAt) {
      continue;
    }
    if (!oldestPendingAt || toTimestamp(pendingAt) < toTimestamp(oldestPendingAt)) {
      oldestPendingAt = pendingAt;
    }
    const hours = ageHours(pendingAt);
    if (hours >= 72) {
      over3d += 1;
    } else if (hours >= 24) {
      over24h += 1;
    }
  }

  return {
    key,
    label,
    count: rows.length,
    over24h,
    over3d,
    oldestPendingAt
  };
}

function buildOldestPendingRows({
  drillingPendingRows,
  maintenancePendingRows,
  inventoryPendingRows,
  receiptPendingRows
}: {
  drillingPendingRows: DrillingPendingRow[];
  maintenancePendingRows: MaintenancePendingRow[];
  inventoryPendingRows: InventoryPendingRow[];
  receiptPendingRows: ReceiptPendingRow[];
}): PendingApprovalAttentionRow[] {
  const rows: PendingApprovalAttentionRow[] = [];

  for (const row of drillingPendingRows) {
    const pendingAt = resolvePendingDate(row.submittedAt, row.date);
    if (!pendingAt) continue;
    rows.push({
      id: `drilling-${row.id}`,
      queue: "Drilling Reports",
      reference: row.holeNumber ? `Hole ${row.holeNumber}` : `Report ${row.id.slice(-6)}`,
      pendingSince: pendingAt,
      ageHours: ageHours(pendingAt),
      context: `${row.project?.name || "Unknown Project"} • ${row.rig?.rigCode || "Unknown Rig"}`
    });
  }

  for (const row of maintenancePendingRows) {
    const pendingAt = resolvePendingDate(row.requestDate, row.createdAt, row.date);
    if (!pendingAt) continue;
    rows.push({
      id: `maintenance-${row.id}`,
      queue: "Maintenance",
      reference: row.requestCode || row.issueType || `Request ${row.id.slice(-6)}`,
      pendingSince: pendingAt,
      ageHours: ageHours(pendingAt),
      context: `${row.rig?.rigCode || "Unknown Rig"} • ${row.urgency || "Unknown urgency"}`
    });
  }

  for (const row of inventoryPendingRows) {
    const pendingAt = resolvePendingDate(row.createdAt, row.requestedForDate || null);
    if (!pendingAt) continue;
    rows.push({
      id: `inventory-${row.id}`,
      queue: "Inventory Usage",
      reference: row.item?.name || `Request ${row.id.slice(-6)}`,
      pendingSince: pendingAt,
      ageHours: ageHours(pendingAt),
      context: `${row.quantity} units • ${row.rig?.rigCode || "Unknown Rig"}`
    });
  }

  for (const row of receiptPendingRows) {
    const pendingAt = resolvePendingDate(row.submittedAt, row.reportDate);
    if (!pendingAt) continue;
    rows.push({
      id: `receipt-${row.id}`,
      queue: "Receipt Submissions",
      reference: row.summary.receiptNumber || `Submission ${row.id.slice(-6)}`,
      pendingSince: pendingAt,
      ageHours: ageHours(pendingAt),
      context: `${row.summary.supplierName || "Unknown Supplier"} • ${formatCurrency(Number(row.summary.total || 0))}`
    });
  }

  return rows.sort((a, b) => toTimestamp(a.pendingSince) - toTimestamp(b.pendingSince));
}

function ageHours(value: string) {
  const timestamp = toTimestamp(value);
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return 0;
  }
  return Math.max(0, Math.round((Date.now() - timestamp) / 3600000));
}

function toTimestamp(value: string | null) {
  if (!value) {
    return Number.POSITIVE_INFINITY;
  }
  const parsed = new Date(value);
  const timestamp = parsed.getTime();
  return Number.isFinite(timestamp) ? timestamp : Number.POSITIVE_INFINITY;
}

function formatPendingAge(hours: number) {
  if (!Number.isFinite(hours) || hours <= 0) {
    return "< 1h";
  }
  if (hours >= 72) {
    return `${Math.round(hours / 24)}d`;
  }
  return `${hours}h`;
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

function formatDateTime(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "—";
  }
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(parsed);
}

function BudgetStatusBadge({ row }: { row: BudgetVsActualRow }) {
  if (row.alertLevel === "OVERSPENT") {
    return (
      <span className="rounded-full border border-red-300 bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-700">
        Overspent
      </span>
    );
  }
  return (
    <span className="rounded-full border border-orange-300 bg-orange-50 px-2 py-0.5 text-[11px] font-medium text-orange-700">
      Critical
    </span>
  );
}

function ExecutiveTrendChart({
  data
}: {
  data: Array<{
    label: string;
    revenue: number;
    expenses: number;
    profit: number;
  }>;
}) {
  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis dataKey="label" stroke="#64748b" />
          <YAxis stroke="#64748b" />
          <Tooltip />
          <Legend />
          <Line type="monotone" dataKey="revenue" stroke="#1e63f5" strokeWidth={2} dot={false} name="Revenue" />
          <Line type="monotone" dataKey="expenses" stroke="#f59e0b" strokeWidth={2} dot={false} name="Approved Expense" />
          <Line type="monotone" dataKey="profit" stroke="#0f766e" strokeWidth={2} dot={false} name="Profit" />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
