"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";

import { AccessGate } from "@/components/layout/access-gate";
import { useRegisterCopilotContext } from "@/components/layout/ai-copilot-context";
import { FilterScopeBanner, hasActiveScopeFilters } from "@/components/layout/filter-scope-banner";
import { useAnalyticsFilters } from "@/components/layout/analytics-filters-provider";
import { scrollToFocusElement, useCopilotFocusTarget } from "@/components/layout/copilot-focus-target";
import { Card, MetricCard } from "@/components/ui/card";
import { DataTable } from "@/components/ui/table";
import type { CopilotPageContext } from "@/lib/ai/contextual-copilot";
import { buildScopedHref } from "@/lib/drilldown";
import { cn, formatCurrency } from "@/lib/utils";

interface RigRecord {
  id: string;
  rigCode: string;
  model: string;
  serialNumber: string;
  photoUrl: string | null;
  acquisitionDate: string | null;
  status: string;
  condition: string;
  conditionScore: number;
  totalHoursWorked: number;
  totalMetersDrilled: number;
  totalLifetimeDays: number;
}

interface RevenueRigBucket {
  id: string;
  name: string;
  revenue: number;
}

interface ExpenseRigBucket {
  id: string;
  name: string;
  amount: number;
}

export default function RigsPage() {
  const { filters } = useAnalyticsFilters();
  const pathname = usePathname();
  const [rigs, setRigs] = useState<RigRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [revenueByRig, setRevenueByRig] = useState<RevenueRigBucket[]>([]);
  const [expensesByRig, setExpensesByRig] = useState<ExpenseRigBucket[]>([]);
  const [focusedRowId, setFocusedRowId] = useState<string | null>(null);
  const [focusedSectionId, setFocusedSectionId] = useState<string | null>(null);
  const scopeProjectId = filters.projectId !== "all" ? filters.projectId : "";
  const isSingleProjectScope = scopeProjectId.length > 0;

  const visibleRigs = useMemo(() => {
    if (isSingleProjectScope) {
      return rigs;
    }
    if (statusFilter === "ALL") {
      return rigs;
    }
    if (statusFilter === "NEEDS_ATTENTION") {
      return rigs.filter(
        (rig) =>
          rig.status === "BREAKDOWN" ||
          rig.status === "MAINTENANCE" ||
          ["POOR", "CRITICAL"].includes(rig.condition.toUpperCase()) ||
          rig.conditionScore < 45
      );
    }
    return rigs.filter((rig) => rig.status === statusFilter);
  }, [isSingleProjectScope, rigs, statusFilter]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const searchParams = new URLSearchParams(window.location.search);
    const raw = (searchParams.get("status") || "").toUpperCase();
    setStatusFilter(["ACTIVE", "IDLE", "MAINTENANCE", "BREAKDOWN", "NEEDS_ATTENTION"].includes(raw) ? raw : "ALL");
  }, [pathname]);

  const loadRigs = useCallback(async () => {
    setLoading(true);
    try {
      const search = new URLSearchParams();
      if (filters.from) search.set("from", filters.from);
      if (filters.to) search.set("to", filters.to);
      if (filters.projectId !== "all") {
        search.set("projectId", filters.projectId);
      } else {
        if (filters.clientId !== "all") search.set("clientId", filters.clientId);
        if (filters.rigId !== "all") search.set("rigId", filters.rigId);
      }

      const query = search.toString();
      const response = await fetch(`/api/rigs${query ? `?${query}` : ""}`, { cache: "no-store" });
      const payload = await response.json();
      setRigs(payload.data || []);
    } finally {
      setLoading(false);
    }
  }, [filters.clientId, filters.from, filters.projectId, filters.rigId, filters.to]);

  const loadFinancialSignals = useCallback(async () => {
    const search = new URLSearchParams();
    if (filters.from) search.set("from", filters.from);
    if (filters.to) search.set("to", filters.to);
    if (filters.projectId !== "all") {
      search.set("projectId", filters.projectId);
    } else {
      if (filters.clientId !== "all") search.set("clientId", filters.clientId);
      if (filters.rigId !== "all") search.set("rigId", filters.rigId);
    }
    const query = search.toString();
    const suffix = query ? `?${query}` : "";

    try {
      const [revenueResponse, expenseResponse] = await Promise.all([
        fetch(`/api/revenue/summary${suffix}`, { cache: "no-store" }),
        fetch(`/api/expenses/analytics${suffix}`, { cache: "no-store" })
      ]);

      const revenuePayload = revenueResponse.ok ? await revenueResponse.json() : null;
      const expensePayload = expenseResponse.ok ? await expenseResponse.json() : null;

      setRevenueByRig(
        Array.isArray(revenuePayload?.revenueByRig)
          ? revenuePayload.revenueByRig.map((entry: { id: string; name: string; revenue: number }) => ({
              id: entry.id,
              name: entry.name,
              revenue: Number(entry.revenue || 0)
            }))
          : []
      );
      setExpensesByRig(
        Array.isArray(expensePayload?.expensesByRig)
          ? expensePayload.expensesByRig.map((entry: { id: string; name: string; amount: number }) => ({
              id: entry.id,
              name: entry.name,
              amount: Number(entry.amount || 0)
            }))
          : []
      );
    } catch {
      setRevenueByRig([]);
      setExpensesByRig([]);
    }
  }, [filters.clientId, filters.from, filters.projectId, filters.rigId, filters.to]);

  useEffect(() => {
    void loadRigs();
  }, [loadRigs]);

  useEffect(() => {
    void loadFinancialSignals();
  }, [loadFinancialSignals]);

  const selectedRigLabel = useMemo(() => {
    if (filters.rigId === "all") {
      return null;
    }
    return rigs.find((rig) => rig.id === filters.rigId)?.rigCode || null;
  }, [filters.rigId, rigs]);
  const isScoped = hasActiveScopeFilters(filters);
  const buildHref = useCallback(
    (path: string, overrides?: Record<string, string | null | undefined>) =>
      buildScopedHref(filters, path, overrides),
    [filters]
  );
  const rigRevenueMap = useMemo(
    () => new Map(revenueByRig.map((entry) => [entry.id, entry.revenue])),
    [revenueByRig]
  );
  const rigExpenseMap = useMemo(
    () => new Map(expensesByRig.map((entry) => [entry.id, entry.amount])),
    [expensesByRig]
  );
  const topRevenueRig = revenueByRig[0] || null;
  const topExpenseRig = expensesByRig[0] || null;
  const poorConditionRigs = useMemo(
    () =>
      visibleRigs.filter(
        (rig) => ["POOR", "CRITICAL"].includes(rig.condition.toUpperCase()) || rig.conditionScore < 45
      ),
    [visibleRigs]
  );
  const underutilizedRigs = useMemo(
    () =>
      visibleRigs.filter((rig) => {
        const lifetimeHours = Math.max(1, rig.totalLifetimeDays * 24);
        const utilization = (rig.totalHoursWorked / lifetimeHours) * 100;
        return rig.status === "IDLE" || utilization < 35;
      }),
    [visibleRigs]
  );
  const maintenanceDueRigs = useMemo(
    () => visibleRigs.filter((rig) => rig.status === "MAINTENANCE" || rig.status === "BREAKDOWN"),
    [visibleRigs]
  );

  const copilotContext = useMemo<CopilotPageContext>(
    () => ({
      pageKey: "rigs",
      pageName: "Rigs",
      filters: {
        clientId: filters.clientId,
        rigId: filters.rigId,
        from: filters.from || null,
        to: filters.to || null
      },
      summaryMetrics: [
        { key: "totalRigs", label: "Total Rigs", value: visibleRigs.length },
        { key: "activeRigs", label: "Active", value: visibleRigs.filter((rig) => rig.status === "ACTIVE").length },
        { key: "idleRigs", label: "Idle", value: visibleRigs.filter((rig) => rig.status === "IDLE").length },
        { key: "poorConditionRigs", label: "Poor/Critical Condition", value: poorConditionRigs.length },
        { key: "maintenanceDueRigs", label: "Maintenance Due", value: maintenanceDueRigs.length },
        { key: "underutilizedRigs", label: "Underutilized Rigs", value: underutilizedRigs.length },
        { key: "topRevenueRig", label: "Top Revenue Rig", value: topRevenueRig?.name || "N/A" },
        { key: "topRevenueRigAmount", label: "Top Revenue Rig Amount", value: topRevenueRig?.revenue || 0 },
        { key: "highestExpenseRig", label: "Highest Expense Rig", value: topExpenseRig?.name || "N/A" },
        { key: "highestExpenseRigAmount", label: "Highest Expense Rig Amount", value: topExpenseRig?.amount || 0 }
      ],
      tablePreviews: [
        {
          key: "rig-condition",
          title: "Rig Condition",
          rowCount: visibleRigs.length,
          columns: ["Rig", "Condition", "Score", "Status"],
          rows: visibleRigs.slice(0, 12).map((rig) => ({
            id: rig.id,
            rig: rig.rigCode,
            condition: rig.condition,
            score: rig.conditionScore,
            status: rig.status,
            href: buildHref("/rigs"),
            targetId: rig.id,
            sectionId: "rig-registry-section",
            targetPageKey: "rigs"
          }))
        },
        {
          key: "rig-revenue",
          title: "Rig Revenue",
          rowCount: revenueByRig.length,
          columns: ["Rig", "Revenue"],
          rows: revenueByRig.slice(0, 8).map((entry) => ({
            id: entry.id,
            rig: entry.name,
            revenue: entry.revenue,
            href: buildHref("/rigs", { rigId: entry.id }),
            targetId: entry.id,
            sectionId: "rig-registry-section",
            targetPageKey: "rigs"
          }))
        },
        {
          key: "rig-expenses",
          title: "Rig Expenses",
          rowCount: expensesByRig.length,
          columns: ["Rig", "Expense"],
          rows: expensesByRig.slice(0, 8).map((entry) => ({
            id: entry.id,
            rig: entry.name,
            expense: entry.amount,
            href: buildHref("/rigs", { rigId: entry.id }),
            targetId: entry.id,
            sectionId: "rig-registry-section",
            targetPageKey: "rigs"
          }))
        },
        {
          key: "rig-utilization",
          title: "Rig Utilization",
          rowCount: visibleRigs.length,
          columns: ["Rig", "Utilization", "Status"],
          rows: visibleRigs.slice(0, 12).map((rig) => {
            const lifetimeHours = Math.max(1, rig.totalLifetimeDays * 24);
            const utilization = (rig.totalHoursWorked / lifetimeHours) * 100;
            return {
              id: rig.id,
              rig: rig.rigCode,
              utilizationPercent: Math.round(utilization * 10) / 10,
              status: rig.status,
              href: buildHref("/rigs"),
              targetId: rig.id,
              sectionId: "rig-registry-section",
              targetPageKey: "rigs"
            };
          })
        }
      ],
      priorityItems: visibleRigs
        .map((rig) => {
          const expense = rigExpenseMap.get(rig.id) || 0;
          const revenue = rigRevenueMap.get(rig.id) || 0;
          const lifetimeHours = Math.max(1, rig.totalLifetimeDays * 24);
          const utilization = (rig.totalHoursWorked / lifetimeHours) * 100;
          const isPoorCondition =
            ["POOR", "CRITICAL"].includes(rig.condition.toUpperCase()) || rig.conditionScore < 45;
          const isMaintenanceRisk = rig.status === "BREAKDOWN" || rig.status === "MAINTENANCE";
          const isUnderutilized = rig.status === "IDLE" || utilization < 35;
          const hasCostPressure = expense > 0 && revenue > 0 && expense > revenue * 0.85;

          let severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" = "LOW";
          let reason = "Rig operating normally in current scope.";
          let issueType = "RIG";

          if (isPoorCondition || isMaintenanceRisk) {
            severity = rig.status === "BREAKDOWN" || rig.condition.toUpperCase() === "CRITICAL" ? "CRITICAL" : "HIGH";
            reason = `${rig.condition} condition / ${rig.status} status needs immediate maintenance coordination.`;
            issueType = "RIG_RISK";
          } else if (hasCostPressure) {
            severity = "HIGH";
            reason = `${rig.rigCode} has high spend (${formatCurrency(expense)}) relative to approved revenue (${formatCurrency(revenue)}).`;
            issueType = "PROFITABILITY";
          } else if (isUnderutilized) {
            severity = "MEDIUM";
            reason = `${rig.rigCode} appears underutilized (${Math.round(utilization)}% utilization) and may be reassigned.`;
            issueType = "RIG_UTILIZATION";
          } else if (revenue > 0) {
            severity = "MEDIUM";
            reason = `${rig.rigCode} has strong approved revenue contribution (${formatCurrency(revenue)}).`;
            issueType = "REVENUE_OPPORTUNITY";
          }

          return {
            id: rig.id,
            label: rig.rigCode,
            reason,
            severity,
            amount: Math.max(expense, revenue, 0) || null,
            href: buildHref(`/rigs/${rig.id}`),
            issueType,
            targetId: rig.id,
            sectionId: "rig-registry-section",
            targetPageKey: "rigs"
          };
        })
        .filter((item) => item.severity !== "LOW")
        .sort((a, b) => {
          const rank = (value: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW") =>
            value === "CRITICAL" ? 0 : value === "HIGH" ? 1 : value === "MEDIUM" ? 2 : 3;
          const rankDiff = rank(a.severity) - rank(b.severity);
          if (rankDiff !== 0) {
            return rankDiff;
          }
          return (b.amount || 0) - (a.amount || 0);
        })
        .slice(0, 8),
      navigationTargets: [
        {
          label: "Open Maintenance",
          href: buildHref("/maintenance"),
          reason: "Check maintenance queue for high-risk rigs.",
          pageKey: "maintenance",
          sectionId: "maintenance-log-section"
        },
        {
          label: "Open Project Operations",
          href: buildHref("/spending"),
          reason: "Review rig cost concentration in the Spending workspace.",
          pageKey: "cost-tracking"
        },
        {
          label: "Open Data Quality Center",
          href: buildHref("/data-quality/linkage-center"),
          reason: "Fix missing rig linkage affecting reports.",
          pageKey: "data-quality-linkage-center",
          sectionId: "missing-rig-section"
        }
      ],
      notes: ["Rig AI guidance is advisory-only and does not change assignments or approvals automatically."]
    }),
    [
      buildHref,
      expensesByRig,
      filters.clientId,
      filters.from,
      filters.rigId,
      filters.to,
      maintenanceDueRigs.length,
      poorConditionRigs.length,
      revenueByRig,
      rigExpenseMap,
      rigRevenueMap,
      topExpenseRig?.amount,
      topExpenseRig?.name,
      topRevenueRig?.name,
      topRevenueRig?.revenue,
      underutilizedRigs.length,
      visibleRigs
    ]
  );

  useRegisterCopilotContext(copilotContext);

  useCopilotFocusTarget({
    pageKey: "rigs",
    onFocus: (target) => {
      setFocusedRowId(target.targetId || null);
      setFocusedSectionId(target.sectionId || null);
      scrollToFocusElement({
        sectionId: target.sectionId || undefined,
        targetId: target.targetId || undefined
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
    }, 2400);
    return () => window.clearTimeout(timeout);
  }, [focusedRowId, focusedSectionId]);

  async function markRigOutOfService(rig: RigRecord) {
    if (
      !window.confirm(
        `Mark ${rig.rigCode} as out of service? This keeps historical data and sets status to IDLE with CRITICAL condition.`
      )
    ) {
      return;
    }
    const response = await fetch(`/api/rigs/${rig.id}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        rigCode: rig.rigCode,
        model: rig.model,
        serialNumber: rig.serialNumber,
        photoUrl: rig.photoUrl || "",
        acquisitionDate: rig.acquisitionDate ? rig.acquisitionDate.slice(0, 10) : "",
        status: "IDLE",
        condition: "CRITICAL",
        conditionScore: Math.min(rig.conditionScore, 30),
        totalHoursWorked: rig.totalHoursWorked,
        totalMetersDrilled: rig.totalMetersDrilled,
        totalLifetimeDays: rig.totalLifetimeDays
      })
    });
    if (response.ok) {
      await loadRigs();
    }
  }

  return (
    <AccessGate denyBehavior="redirect" permission="rigs:view">
      <div className="gf-page-stack">
        <FilterScopeBanner filters={filters} rigLabel={selectedRigLabel} />

        {isSingleProjectScope ? (
          <Card
            title="Rig profiles"
            action={
              <AccessGate permission="rigs:manage">
                <Link
                  href="/rigs/setup"
                  className="rounded-md border border-brand-300 bg-brand-50 px-3 py-1.5 text-xs font-semibold text-brand-800 hover:bg-brand-100"
                >
                  Add a Rig Setup
                </Link>
              </AccessGate>
            }
          >
            {loading ? (
              <p className="text-sm text-ink-600">Loading project rigs...</p>
            ) : visibleRigs.length === 0 ? (
              <div className="space-y-3">
                <p className="text-sm text-ink-700">
                  No assigned or backup rig is linked to this project yet. Add rigs in project setup to continue.
                </p>
                <AccessGate permission="projects:manage">
                  <Link
                    href={`/projects/setup?editProjectId=${scopeProjectId}`}
                    className="inline-flex rounded-md border border-brand-200 bg-brand-50 px-3 py-1.5 text-sm font-medium text-brand-800 hover:bg-brand-100"
                  >
                    Edit project setup
                  </Link>
                </AccessGate>
              </div>
            ) : (
              <div className="grid gap-4 lg:grid-cols-2">
                {visibleRigs.map((rig) => {
                  const revenue = rigRevenueMap.get(rig.id) || 0;
                  const expenses = rigExpenseMap.get(rig.id) || 0;
                  const profitability = revenue - expenses;
                  return (
                    <Card
                      key={rig.id}
                      title={rig.rigCode}
                      subtitle={`${rig.model} • Serial ${rig.serialNumber}`}
                    >
                      <DataTable
                        compact
                        columns={["Detail", "Value"]}
                        rows={[
                          ["Status", rig.status],
                          ["Condition", rig.condition],
                          ["Condition score", String(rig.conditionScore)],
                          [
                            "Acquisition date",
                            rig.acquisitionDate ? rig.acquisitionDate.slice(0, 10) : "-"
                          ],
                          ["Total hours", String(rig.totalHoursWorked)],
                          ["Lifetime days", String(rig.totalLifetimeDays)],
                          ["Total meters", String(rig.totalMetersDrilled)],
                          ["Revenue", formatCurrency(revenue)],
                          ["Expenses", formatCurrency(expenses)],
                          ["Profitability", formatCurrency(profitability)]
                        ]}
                      />
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Link
                          href={`/rigs/${rig.id}`}
                          className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-ink-700 hover:bg-slate-50"
                        >
                          Open rig details
                        </Link>
                      </div>
                    </Card>
                  );
                })}
              </div>
            )}
          </Card>
        ) : (
          <>
            <section className="grid gap-3 md:grid-cols-5">
              <MetricCard
                label={
                  statusFilter === "ALL"
                    ? isScoped
                      ? "Rigs in Scope"
                      : "Total Rigs"
                    : statusFilter === "NEEDS_ATTENTION"
                      ? "Rigs Needing Attention"
                    : `Rigs (${statusFilter})`
                }
                value={String(visibleRigs.length)}
              />
              <MetricCard
                label="Active"
                value={String(visibleRigs.filter((rig) => rig.status === "ACTIVE").length)}
                tone="good"
              />
              <MetricCard label="Idle" value={String(visibleRigs.filter((rig) => rig.status === "IDLE").length)} />
              <MetricCard
                label="Maintenance"
                value={String(visibleRigs.filter((rig) => rig.status === "MAINTENANCE").length)}
                tone="warn"
              />
              <MetricCard
                label="Breakdown"
                value={String(visibleRigs.filter((rig) => rig.status === "BREAKDOWN").length)}
                tone="danger"
              />
            </section>

            <section className="flex flex-wrap items-center gap-2">
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Rig focus</label>
              <select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value)}
                className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-sm text-ink-700"
              >
                <option value="ALL">All rigs</option>
                <option value="ACTIVE">Active</option>
                <option value="IDLE">Idle</option>
                <option value="MAINTENANCE">Maintenance</option>
                <option value="BREAKDOWN">Breakdown</option>
                <option value="NEEDS_ATTENTION">Needs attention</option>
              </select>
            </section>

            <AccessGate permission="rigs:manage">
              <section className="flex justify-end">
                <Link
                  href="/rigs/setup"
                  className="rounded-lg border border-brand-300 bg-brand-50 px-3 py-2 text-sm font-semibold text-brand-800 hover:bg-brand-100"
                >
                  Create rig
                </Link>
              </section>
            </AccessGate>

            <section
              id="rig-registry-section"
              className={cn(
                focusedSectionId === "rig-registry-section" &&
                  "rounded-2xl ring-2 ring-indigo-100 ring-offset-2 ring-offset-slate-50"
              )}
            >
              <Card title="Rig Registry" subtitle={statusFilter === "ALL" ? undefined : `Filtered by status: ${statusFilter}`}>
                {loading ? (
                  <p className="text-sm text-ink-600">Loading rigs...</p>
                ) : (
                  <DataTable
                    columns={["Rig", "Model", "Status", "Condition", "Score", "Hours", "Meters", "Actions"]}
                    rows={visibleRigs.map((rig) => [
                      <Link key={rig.id} href={`/rigs/${rig.id}`} className="text-brand-700 underline-offset-2 hover:underline">
                        {rig.rigCode}
                      </Link>,
                      rig.model,
                      rig.status,
                      rig.condition,
                      String(rig.conditionScore),
                      String(rig.totalHoursWorked),
                      String(rig.totalMetersDrilled),
                      <div key={`actions-${rig.id}`} className="flex gap-2">
                        <AccessGate permission="rigs:manage">
                          <Link
                            href={`/rigs/setup?editRigId=${rig.id}`}
                            className="rounded-md border border-slate-200 px-2 py-1 text-xs text-ink-700 hover:bg-slate-50"
                          >
                            Edit
                          </Link>
                        </AccessGate>
                        <button
                          type="button"
                          className="rounded-md border border-amber-200 px-2 py-1 text-xs text-amber-800 hover:bg-amber-50"
                          onClick={() => void markRigOutOfService(rig)}
                        >
                          Mark Out of Service
                        </button>
                      </div>
                    ])}
                    rowIds={visibleRigs.map((rig) => `ai-focus-${rig.id}`)}
                    rowClassNames={visibleRigs.map((rig) =>
                      focusedRowId === rig.id ? "bg-indigo-50 ring-1 ring-inset ring-indigo-200" : ""
                    )}
                  />
                )}
              </Card>
            </section>
          </>
        )}
      </div>
    </AccessGate>
  );
}
