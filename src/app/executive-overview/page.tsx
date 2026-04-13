"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { RotateCw } from "lucide-react";

import { AccessGate } from "@/components/layout/access-gate";
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
import { cn, formatCurrency, formatNumber } from "@/lib/utils";
import type {
  DrillingPendingRow,
  InventoryPendingRow,
  MaintenancePendingRow,
  ProfitSummaryPayload,
  QueueSummary,
  ReceiptPendingRow,
  RevenueSummaryPayload
} from "./executive-overview-types";
import {
  emptyBudgetSummary,
  emptyCostSummary,
  emptyProfitSummary,
  emptyRevenueSummary
} from "./executive-overview-types";
import {
  BudgetStatusBadge,
  ExecutiveTrendChart,
  buildFiltersQuery,
  buildOldestPendingRows,
  buildScopedApprovalsHref,
  deriveDecliningProfitClient,
  deriveMissingRevenueRigAttributionAmount,
  deriveProfitabilityConcern,
  fetchJsonSafe,
  formatDateTime,
  formatPendingAge,
  formatPercentUsed,
  getRecognizedCostValue,
  resolvePendingDate,
  resolveApprovalsTabByQueueKey,
  resolveApprovalsTabByQueueLabel,
  summarizeQueue,
  toTimestamp,
  withStatus
} from "./executive-overview-utils";

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
    return `/spending${query ? `?${query}` : ""}`;
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
  const recognizedSpendTotal = profitSummary.totals.recognizedSpend;

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
            fetchJsonSafe<{ data: MaintenancePendingRow[] }>(`/api/maintenance-requests?${withStatus(params, "status", "OPEN")}`),
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

    if (unassignedRig && getRecognizedCostValue(unassignedRig) > 0) {
      rows.push([
        "Rig",
        unassignedRig.name,
        formatCurrency(getRecognizedCostValue(unassignedRig)),
        "Needs rig linkage"
      ]);
    }

    if (unassignedProject && getRecognizedCostValue(unassignedProject) > 0) {
      rows.push([
        "Project",
        unassignedProject.name,
        formatCurrency(getRecognizedCostValue(unassignedProject)),
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
        formatCurrency(entry.recognizedSpend),
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
        { key: "recognizedSpend", label: "Recognized Spend", value: recognizedSpendTotal },
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
              recognizedSpend: entry.recognizedSpend,
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
                )} recognized revenue is unassigned to a rig.`,
                severity: "HIGH" as const,
                amount: missingRevenueRigAttributionAmount,
                href: "/spending",
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
            return b.recognizedSpend - a.recognizedSpend;
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
            amount: entry.recognizedSpend,
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
        {
          label: "Open Project Operations",
          href: budgetVsActualHref,
          reason: "Review budget pressure in the Spending workspace.",
          pageKey: "budget-vs-actual"
        },
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
      linkageCenterHref,
      missingLinkageRows.length,
      incompleteDrillingReports,
      missingRevenueRigAttributionAmount,
      decliningProfitClient,
      profitabilityConcern,
      pendingApprovals,
      recognizedSpendTotal,
      profitSummary.totals.totalProfit,
      profitSummary.totals.totalRevenue,
      topRevenueClient?.name,
      topRevenueClient?.revenue,
      topRevenueProject?.name,
      topRevenueProject?.revenue,
      topRevenueRig?.name,
      topRevenueRig?.revenue,
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
            description="Manager snapshot across recognized finance performance, approvals pressure, and operational risk."
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
            <MetricCard label="Recognized Spend" value={formatCurrency(recognizedSpendTotal)} tone="warn" />
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
                  ? formatCurrency(
                      costSummary.overview.highestCostRig.totalRecognizedCost
                    )
                  : "No recognized cost data"}
              </p>
            </Card>
            <Card title="Highest Cost Project">
              <p className="text-xl font-semibold text-ink-900">{costSummary.overview.highestCostProject?.name || "N/A"}</p>
              <p className="mt-1 text-sm text-slate-600">
                {costSummary.overview.highestCostProject
                  ? formatCurrency(
                      costSummary.overview.highestCostProject.totalRecognizedCost
                    )
                  : "No recognized cost data"}
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
          id="executive-trend-section"
          className={cn(
            "gf-section",
            focusedSectionId === "executive-trend-section" &&
              "rounded-2xl ring-2 ring-indigo-100 ring-offset-2 ring-offset-slate-50"
          )}
        >
          <SectionHeader
            title="Trend"
            description="Revenue, recognized spend, and profit movement plus current approvals pressure aging."
          />
          <div className="gf-chart-grid">
            <Card
              title={`Revenue vs Approved Expense vs Profit (${profitSummary.trendGranularity === "day" ? "Daily" : "Monthly"})`}
              subtitle="Approved-only finance trend from current filter scope."
            >
              {loading ? (
                <p className="text-sm text-slate-600">Loading finance trend...</p>
              ) : profitSummary.profitTrend.length === 0 ? (
                <div className="gf-empty-state">No recognized finance trend data found for the selected filters.</div>
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
                  columns={["Scope", "Entity", "Budget", "Recognized Spend", "Remaining", "% Used", "Status"]}
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
              subtitle="Recognized spend that remains unassigned to rig/project entities."
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
                <DataTable columns={["Scope", "Entity", "Recognized Cost", "Action"]} rows={missingLinkageRows} />
              )}
            </Card>
          </div>
        </section>
      </div>
    </AccessGate>
  );
}
