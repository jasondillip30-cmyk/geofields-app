"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";

import { useAnalyticsFilters } from "@/components/layout/analytics-filters-provider";
import { AccessGate } from "@/components/layout/access-gate";
import { useRole } from "@/components/layout/role-provider";
import { FilterScopeBanner } from "@/components/layout/filter-scope-banner";
import { Card } from "@/components/ui/card";
import { DataTable } from "@/components/ui/table";
import { cn, formatCurrency, formatNumber } from "@/lib/utils";
import {
  ExpenseDetailModal,
  ExpenseQueueStatusBadge
} from "./inventory-expense-detail-modal";
import {
  type ExpenseQueueFilter,
  type InventoryExpenseRow,
  type ModalOriginFrame,
  type RecognizedCostLedgerRow,
  queueFilterLabels
} from "./inventory-expenses-types";
import {
  buildOperationalContextLine,
  deriveExpenseContextLink,
  deriveExpenseQueueStatus,
  deriveExpenseSource,
  deriveExpenseTitle,
  queueFilterLabel,
  readApiError,
  recognitionChipClass,
  toIsoDate
} from "./inventory-expenses-utils";

export default function InventoryExpensesPage() {
  const { user } = useRole();
  const { filters, resetFilters } = useAnalyticsFilters();
  const [expenses, setExpenses] = useState<InventoryExpenseRow[]>([]);
  const [clients, setClients] = useState<Array<{ id: string; name: string }>>([]);
  const [rigs, setRigs] = useState<Array<{ id: string; rigCode: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [queueFilter, setQueueFilter] = useState<ExpenseQueueFilter>("ALL");
  const [selectedExpenseId, setSelectedExpenseId] = useState("");
  const [expenseModalOpen, setExpenseModalOpen] = useState(false);
  const [expenseModalOriginFrame, setExpenseModalOriginFrame] = useState<ModalOriginFrame | null>(null);
  const isSingleProjectScope = filters.projectId !== "all";

  const selectedClientLabel = useMemo(() => {
    if (filters.clientId === "all") {
      return null;
    }
    return clients.find((entry) => entry.id === filters.clientId)?.name || null;
  }, [clients, filters.clientId]);

  const selectedRigLabel = useMemo(() => {
    if (filters.rigId === "all") {
      return null;
    }
    return rigs.find((entry) => entry.id === filters.rigId)?.rigCode || null;
  }, [filters.rigId, rigs]);

  const loadScopeReferences = useCallback(async () => {
    try {
      const [clientsRes, rigsRes] = await Promise.all([
        fetch("/api/clients", { cache: "no-store" }),
        fetch("/api/rigs", { cache: "no-store" })
      ]);

      const [clientsPayload, rigsPayload] = await Promise.all([
        clientsRes.ok ? clientsRes.json() : Promise.resolve({ data: [] }),
        rigsRes.ok ? rigsRes.json() : Promise.resolve({ data: [] })
      ]);

      setClients((clientsPayload.data || []).map((entry: { id: string; name: string }) => ({ id: entry.id, name: entry.name })));
      setRigs(
        (rigsPayload.data || []).map((entry: { id: string; rigCode?: string; name?: string }) => ({
          id: entry.id,
          rigCode: entry.rigCode || entry.name || "Unknown rig"
        }))
      );
    } catch {
      setClients([]);
      setRigs([]);
    }
  }, []);

  const loadExpenses = useCallback(async () => {
    setLoading(true);
    setErrorMessage(null);
    try {
      const query = new URLSearchParams();
      if (filters.from) query.set("from", filters.from);
      if (filters.to) query.set("to", filters.to);
      if (isSingleProjectScope) {
        query.set("projectId", filters.projectId);
        query.set("recognizedOnly", "1");
      } else {
        if (filters.clientId !== "all") query.set("clientId", filters.clientId);
        if (filters.rigId !== "all") query.set("rigId", filters.rigId);
      }

      const response = await fetch(`/api/inventory/expenses?${query.toString()}`, {
        cache: "no-store"
      });
      if (!response.ok) {
        throw new Error(await readApiError(response, "Failed to load inventory expenses."));
      }
      const payload = (await response.json()) as { data?: InventoryExpenseRow[] };
      setExpenses(payload.data || []);
    } catch (error) {
      setExpenses([]);
      setErrorMessage(error instanceof Error ? error.message : "Failed to load inventory expenses.");
    } finally {
      setLoading(false);
    }
  }, [filters.clientId, filters.from, filters.projectId, filters.rigId, filters.to, isSingleProjectScope]);

  useEffect(() => {
    void loadScopeReferences();
  }, [loadScopeReferences]);

  useEffect(() => {
    void loadExpenses();
  }, [loadExpenses]);

  const queueRows = useMemo(
    () =>
      expenses.map((expense) => ({
        expense,
        status: deriveExpenseQueueStatus(expense)
      })),
    [expenses]
  );

  const queueCounts = useMemo(
    () => ({
      NEEDS_RECOGNITION: queueRows.filter((entry) => entry.status === "NEEDS_RECOGNITION").length,
      PENDING_APPROVAL: queueRows.filter((entry) => entry.status === "PENDING_APPROVAL").length,
      COST_RECOGNIZED: queueRows.filter((entry) => entry.status === "COST_RECOGNIZED").length,
      UNLINKED: queueRows.filter((entry) => entry.status === "UNLINKED").length
    }),
    [queueRows]
  );

  const filteredQueue = useMemo(() => {
    if (queueFilter === "ALL") {
      return queueRows;
    }
    return queueRows.filter((entry) => entry.status === queueFilter);
  }, [queueFilter, queueRows]);

  const selectedExpense = useMemo(
    () => queueRows.find((entry) => entry.expense.id === selectedExpenseId)?.expense || null,
    [queueRows, selectedExpenseId]
  );

  const recognizedCostLedgerRows = useMemo<RecognizedCostLedgerRow[]>(() => {
    if (!isSingleProjectScope) {
      return [];
    }

    const rows: RecognizedCostLedgerRow[] = [];

    for (const expense of expenses) {
      if (!expense.recognized) {
        continue;
      }
      const outMovements = expense.inventoryMovements.filter(
        (movement) => movement.movementType === "OUT"
      );
      if (outMovements.length === 0) {
        continue;
      }

      for (const movement of outMovements) {
        rows.push({
          id: movement.id,
          date: movement.date,
          item: movement.item?.name || deriveExpenseTitle(expense),
          quantityUsed: Number.isFinite(movement.quantity) ? movement.quantity : 0,
          cost: Number.isFinite(movement.totalCost || 0) ? movement.totalCost || 0 : 0,
          project: movement.project?.name || expense.project?.name || "Locked project",
          rig: movement.rig?.rigCode || expense.rig?.rigCode || "-",
          reportHole: movement.drillReport?.holeNumber || "-",
          reference: `Movement ${movement.id.slice(-8)}`
        });
      }
    }

    return rows
      .sort((left, right) => {
        const leftTime = new Date(left.date).getTime();
        const rightTime = new Date(right.date).getTime();
        return rightTime - leftTime;
      })
      .slice(0, 120);
  }, [expenses, isSingleProjectScope]);

  const recognizedCostSummary = useMemo(() => {
    if (!isSingleProjectScope) {
      return null;
    }
    return recognizedCostLedgerRows.reduce(
      (summary, row) => {
        summary.entryCount += 1;
        summary.totalQuantity += row.quantityUsed;
        summary.totalCost += row.cost;
        return summary;
      },
      { entryCount: 0, totalQuantity: 0, totalCost: 0 }
    );
  }, [isSingleProjectScope, recognizedCostLedgerRows]);

  useEffect(() => {
    if (!selectedExpenseId) {
      return;
    }
    if (!queueRows.some((entry) => entry.expense.id === selectedExpenseId)) {
      setSelectedExpenseId("");
      setExpenseModalOpen(false);
    }
  }, [queueRows, selectedExpenseId]);

  useEffect(() => {
    if (!isSingleProjectScope) {
      return;
    }
    if (expenseModalOpen) {
      setExpenseModalOpen(false);
    }
    if (selectedExpenseId) {
      setSelectedExpenseId("");
    }
    if (expenseModalOriginFrame) {
      setExpenseModalOriginFrame(null);
    }
    if (queueFilter !== "ALL") {
      setQueueFilter("ALL");
    }
  }, [
    expenseModalOpen,
    expenseModalOriginFrame,
    isSingleProjectScope,
    queueFilter,
    selectedExpenseId
  ]);

  return (
    <AccessGate denyBehavior="redirect" permission="inventory:view">
      <div className="gf-page-stack space-y-4 md:space-y-5">
        {errorMessage ? (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{errorMessage}</div>
        ) : null}

        {!isSingleProjectScope ? (
          <FilterScopeBanner
            filters={filters}
            clientLabel={selectedClientLabel}
            rigLabel={selectedRigLabel}
            onClearFilters={resetFilters}
          />
        ) : null}

        {isSingleProjectScope ? (
          <div className="rounded-xl border border-brand-200 bg-brand-50/70 px-4 py-3 text-sm text-brand-900">
            Project mode shows recognized used-inventory costs only. Warehouse stock ownership remains global.
          </div>
        ) : null}

        <section className="gf-page-header">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Inventory</p>
              <h1 className="text-3xl font-semibold tracking-tight text-ink-900 md:text-[2rem]">Expenses</h1>
              <p className="mt-1 text-sm text-slate-600">
                {isSingleProjectScope
                  ? "Recognized used-inventory costs for the locked project."
                  : "Recognize and track costs from inventory and operational activity."}
              </p>
            </div>
            <div className="ml-auto flex flex-wrap gap-2">
              {!isSingleProjectScope ? (
                <>
                  <Link href="/inventory/stock-movements" className="gf-btn-secondary px-3 py-1.5 text-xs">
                    Open Stock Movements
                  </Link>
                </>
              ) : null}
              <Link href="/inventory" className="gf-btn-secondary px-3 py-1.5 text-xs">
                Back to Overview
              </Link>
            </div>
          </div>
          <div className="mt-4 border-t border-slate-200/80" />
        </section>

        {isSingleProjectScope ? (
          <section className="space-y-3">
            <Card
              className="min-w-0"
              title="Recognized inventory costs (project)"
              subtitle="Project mode shows recognized costs only."
            >
              <p className="mb-2 text-xs text-slate-600">
                Review and approval queue actions stay in All projects mode.
              </p>
              <div className="mb-3 flex flex-wrap gap-2">
                <span className="rounded-full border border-slate-300 bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-700">
                  Entries: {formatNumber(recognizedCostSummary?.entryCount || 0)}
                </span>
                <span className="rounded-full border border-blue-300 bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-800">
                  Quantity used: {formatNumber(recognizedCostSummary?.totalQuantity || 0)}
                </span>
                <span className="rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-800">
                  Recognized cost: {formatCurrency(recognizedCostSummary?.totalCost || 0)}
                </span>
              </div>
              {loading ? (
                <p className="text-sm text-ink-600">Loading recognized project costs...</p>
              ) : recognizedCostLedgerRows.length === 0 ? (
                <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-700">
                  No recognized used-inventory costs found for this project in the current date range.
                </p>
              ) : (
                <DataTable
                  className="border-slate-200/70"
                  columns={["Date", "Item", "Quantity used", "Cost", "Project", "Rig", "Report/Hole", "Reference"]}
                  rows={recognizedCostLedgerRows.map((row) => [
                    toIsoDate(row.date),
                    row.item,
                    formatNumber(row.quantityUsed),
                    formatCurrency(row.cost),
                    row.project,
                    row.rig,
                    row.reportHole,
                    row.reference
                  ])}
                />
              )}
            </Card>
          </section>
        ) : (
          <>
            <section>
              <Card className="min-w-0" title="Recognition Header" subtitle="Focus on what needs cost recognition attention now.">
                <div className="flex flex-wrap gap-1.5">
                  {queueFilterLabels.map((entry) => {
                    const count =
                      entry.key === "NEEDS_RECOGNITION"
                        ? queueCounts.NEEDS_RECOGNITION
                        : entry.key === "PENDING_APPROVAL"
                          ? queueCounts.PENDING_APPROVAL
                          : entry.key === "COST_RECOGNIZED"
                            ? queueCounts.COST_RECOGNIZED
                            : queueCounts.UNLINKED;
                    const isActive = queueFilter === entry.key;
                    return (
                      <button
                        key={entry.key}
                        type="button"
                        onClick={() => setQueueFilter((current) => (current === entry.key ? "ALL" : entry.key))}
                        className={cn("rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors", recognitionChipClass(entry.key, isActive))}
                      >
                        {entry.label} ({formatNumber(count)})
                      </button>
                    );
                  })}
                </div>
                {queueFilter !== "ALL" ? (
                  <p className="mt-2 text-xs text-slate-600">
                    Filter active: {queueFilterLabel(queueFilter)}. Click the same signal again to show all expenses.
                  </p>
                ) : null}
              </Card>
            </section>

            <section>
              <Card className="min-w-0" title="Expense Queue" subtitle="Review costs tied to inventory and operational events.">
                {loading ? (
                  <p className="text-sm text-ink-600">Loading expense queue...</p>
                ) : filteredQueue.length === 0 ? (
                  <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-700">
                    No expenses found for current scope and recognition filter.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {filteredQueue.map(({ expense, status }) => {
                      const primaryMovement = expense.inventoryMovements[0] || null;
                      const contextLink = deriveExpenseContextLink(expense);
                      return (
                        <article key={expense.id} className="rounded-lg border border-slate-200 bg-slate-50/80 px-2.5 py-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <ExpenseQueueStatusBadge status={status} />
                            <p className="text-sm font-semibold text-ink-900">{deriveExpenseTitle(expense)}</p>
                          </div>
                          <p className="mt-0.5 text-xs text-slate-700">{buildOperationalContextLine(expense, status)}</p>
                          <p className="mt-0.5 text-sm font-semibold text-ink-900">
                            {formatCurrency(expense.amount)}
                            <span className="ml-1 font-normal text-slate-600">• {deriveExpenseSource(expense)}</span>
                          </p>
                          <div className="mt-1.5 flex flex-wrap gap-1.5">
                            <button
                              type="button"
                              onClick={(event) => {
                                const trigger = event.currentTarget as HTMLElement;
                                const source = trigger.closest("article");
                                const rect = (source || trigger).getBoundingClientRect();
                                setExpenseModalOriginFrame({
                                  left: rect.left,
                                  top: rect.top,
                                  width: rect.width,
                                  height: rect.height
                                });
                                setSelectedExpenseId(expense.id);
                                setExpenseModalOpen(true);
                              }}
                              className="gf-btn-primary px-2.5 py-1 text-[11px]"
                            >
                              Review Expense
                            </button>
                            {primaryMovement?.id ? (
                              <Link
                                href={`/inventory/stock-movements?movementId=${encodeURIComponent(primaryMovement.id)}`}
                                className="gf-btn-secondary px-2.5 py-1 text-[11px]"
                              >
                                Open Movement
                              </Link>
                            ) : null}
                            {contextLink ? (
                              <Link href={contextLink.href} className="gf-btn-secondary px-2.5 py-1 text-[11px]">
                                View Context
                              </Link>
                            ) : null}
                          </div>
                        </article>
                      );
                    })}
                  </div>
                )}
              </Card>
            </section>

            <ExpenseDetailModal
              open={expenseModalOpen}
              expense={selectedExpense}
              role={user?.role || null}
              userId={user?.id || null}
              originFrame={expenseModalOriginFrame}
              onRefresh={loadExpenses}
              onClose={() => setExpenseModalOpen(false)}
            />
          </>
        )}
      </div>
    </AccessGate>
  );
}
