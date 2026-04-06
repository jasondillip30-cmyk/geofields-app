"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { X } from "lucide-react";

import { useAnalyticsFilters } from "@/components/layout/analytics-filters-provider";
import { AccessGate } from "@/components/layout/access-gate";
import { useRole } from "@/components/layout/role-provider";
import { SystemFlowBar } from "@/components/inventory/system-flow-bar";
import { FilterScopeBanner } from "@/components/layout/filter-scope-banner";
import { Card } from "@/components/ui/card";
import { canManageExpenseApprovalActions } from "@/lib/auth/approval-policy";
import { cn, formatCurrency, formatNumber } from "@/lib/utils";

type ExpenseApprovalStatus = "DRAFT" | "SUBMITTED" | "APPROVED" | "REJECTED";
type ExpenseQueueStatus =
  | "NEEDS_RECOGNITION"
  | "PENDING_APPROVAL"
  | "COST_RECOGNIZED"
  | "UNLINKED";
type ExpenseQueueFilter = "ALL" | ExpenseQueueStatus;

interface InventoryExpenseMovement {
  id: string;
  date: string;
  movementType: "IN" | "OUT" | "ADJUSTMENT" | "TRANSFER";
  quantity: number;
  unitCost: number | null;
  totalCost: number | null;
  traReceiptNumber: string | null;
  supplierInvoiceNumber: string | null;
  receiptUrl: string | null;
  notes: string | null;
  item: { id: string; name: string; sku: string } | null;
  project: { id: string; name: string } | null;
  rig: { id: string; rigCode: string } | null;
  maintenanceRequest: { id: string; requestCode: string; status: string } | null;
}

interface InventoryExpenseRow {
  id: string;
  date: string;
  amount: number;
  category: string;
  subcategory: string | null;
  entrySource: string | null;
  vendor: string | null;
  receiptNumber: string | null;
  receiptUrl: string | null;
  approvalStatus: ExpenseApprovalStatus;
  submittedAt: string | null;
  approvedAt: string | null;
  rejectionReason: string | null;
  notes: string | null;
  client: { id: string; name: string } | null;
  project: { id: string; name: string } | null;
  rig: { id: string; rigCode: string } | null;
  enteredBy: { id: string; fullName: string } | null;
  approvedBy: { id: string; fullName: string } | null;
  recognized: boolean;
  purposeBucket:
    | "BREAKDOWN_COST"
    | "MAINTENANCE_COST"
    | "STOCK_REPLENISHMENT"
    | "OPERATING_COST"
    | "OTHER_UNLINKED"
    | null;
  purposeLabel: string | null;
  purposeTraceability: string | null;
  inventoryMovements: InventoryExpenseMovement[];
}

interface ModalOriginFrame {
  left: number;
  top: number;
  width: number;
  height: number;
}

const queueFilterLabels: Array<{ key: ExpenseQueueStatus; label: string }> = [
  { key: "NEEDS_RECOGNITION", label: "Needs recognition" },
  { key: "PENDING_APPROVAL", label: "Pending approval" },
  { key: "COST_RECOGNIZED", label: "Cost recognized" },
  { key: "UNLINKED", label: "Unlinked cost" }
];

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
      if (filters.clientId !== "all") query.set("clientId", filters.clientId);
      if (filters.rigId !== "all") query.set("rigId", filters.rigId);

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
  }, [filters.clientId, filters.from, filters.rigId, filters.to]);

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

  useEffect(() => {
    if (!selectedExpenseId) {
      return;
    }
    if (!queueRows.some((entry) => entry.expense.id === selectedExpenseId)) {
      setSelectedExpenseId("");
      setExpenseModalOpen(false);
    }
  }, [queueRows, selectedExpenseId]);

  return (
    <AccessGate permission="inventory:view">
      <div className="gf-page-stack space-y-4 md:space-y-5">
        {errorMessage ? (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{errorMessage}</div>
        ) : null}

        <FilterScopeBanner
          filters={filters}
          clientLabel={selectedClientLabel}
          rigLabel={selectedRigLabel}
          onClearFilters={resetFilters}
        />

        <section className="gf-page-header">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Inventory</p>
              <h1 className="text-3xl font-semibold tracking-tight text-ink-900 md:text-[2rem]">Expenses</h1>
              <p className="mt-1 text-sm text-slate-600">
                Recognize and track costs from inventory and operational activity.
              </p>
            </div>
            <div className="ml-auto flex flex-wrap gap-2">
              <Link href="/inventory/stock-movements" className="gf-btn-secondary px-3 py-1.5 text-xs">
                Open Stock Movements
              </Link>
              <Link href="/inventory/issues" className="gf-btn-secondary px-3 py-1.5 text-xs">
                Open Issues
              </Link>
              <Link href="/inventory" className="gf-btn-secondary px-3 py-1.5 text-xs">
                Back to Overview
              </Link>
            </div>
          </div>
          <div className="mt-4 border-t border-slate-200/80" />
        </section>

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
      </div>
    </AccessGate>
  );
}

function ExpenseDetailModal({
  open,
  expense,
  role,
  userId,
  originFrame,
  onRefresh,
  onClose
}: {
  open: boolean;
  expense: InventoryExpenseRow | null;
  role: string | null;
  userId: string | null;
  originFrame: ModalOriginFrame | null;
  onRefresh: () => Promise<void>;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLElement | null>(null);
  const [isMounted, setIsMounted] = useState(open);
  const [isVisible, setIsVisible] = useState(open);
  const [entryTransform, setEntryTransform] = useState<{
    x: number;
    y: number;
    scaleX: number;
    scaleY: number;
  } | null>(null);
  const [reviewStep, setReviewStep] = useState<1 | 2 | 3>(1);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [rejectionReason, setRejectionReason] = useState("");

  useEffect(() => {
    let timeoutId: number | undefined;
    if (open) {
      setIsMounted(true);
      setIsVisible(false);
    } else if (isMounted) {
      setIsVisible(false);
      timeoutId = window.setTimeout(() => {
        setIsMounted(false);
        setEntryTransform(null);
      }, 220);
    }
    return () => {
      if (timeoutId !== undefined) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [isMounted, open]);

  useLayoutEffect(() => {
    if (!open || !isMounted) {
      return;
    }
    const panel = panelRef.current;
    if (!panel) {
      return;
    }

    let rafA = 0;
    let rafB = 0;

    if (originFrame) {
      const finalRect = panel.getBoundingClientRect();
      const originCenterX = originFrame.left + originFrame.width / 2;
      const originCenterY = originFrame.top + originFrame.height / 2;
      const finalCenterX = finalRect.left + finalRect.width / 2;
      const finalCenterY = finalRect.top + finalRect.height / 2;
      const scaleX = clamp(originFrame.width / Math.max(finalRect.width, 1), 0.42, 1);
      const scaleY = clamp(originFrame.height / Math.max(finalRect.height, 1), 0.22, 1);

      setEntryTransform({
        x: originCenterX - finalCenterX,
        y: originCenterY - finalCenterY,
        scaleX,
        scaleY
      });

      rafA = window.requestAnimationFrame(() => {
        rafB = window.requestAnimationFrame(() => setIsVisible(true));
      });
    } else {
      setEntryTransform(null);
      rafA = window.requestAnimationFrame(() => setIsVisible(true));
    }

    return () => {
      if (rafA) {
        window.cancelAnimationFrame(rafA);
      }
      if (rafB) {
        window.cancelAnimationFrame(rafB);
      }
    };
  }, [expense?.id, isMounted, open, originFrame]);

  useEffect(() => {
    if (!open) {
      return;
    }
    setReviewStep(1);
    setActionBusy(false);
    setActionError(null);
    setActionNotice(null);
    setRejectionReason("");
  }, [open, expense?.id]);

  if (!isMounted) {
    return null;
  }

  const queueStatus = expense ? deriveExpenseQueueStatus(expense) : "PENDING_APPROVAL";
  const primaryMovement = expense?.inventoryMovements[0] || null;
  const modalTitle = expense ? `${deriveExpenseTitle(expense)} expense` : "Operational expense";
  const canManageApproval = canManageExpenseApprovalActions(role);
  const canSubmit = Boolean(
    expense &&
      canSubmitExpenseActions(role) &&
      (expense.approvalStatus === "DRAFT" || expense.approvalStatus === "REJECTED") &&
      (expense.enteredBy?.id ? expense.enteredBy.id === userId : true)
  );
  const canApprove = Boolean(expense && canManageApproval && expense.approvalStatus === "SUBMITTED");
  const canReject = canApprove;
  const canReopen = Boolean(expense && canManageApproval && expense.approvalStatus === "APPROVED");
  const canTakeDecisionAction = canSubmit || canApprove || canReject || canReopen;
  const hiddenTransform = entryTransform
    ? `translate3d(${entryTransform.x}px, ${entryTransform.y}px, 0) scale(${entryTransform.scaleX}, ${entryTransform.scaleY})`
    : "translate3d(0, 10px, 0) scale(0.985)";
  const panelMotionStyle = {
    transform: isVisible ? "translate3d(0, 0, 0) scale(1, 1)" : hiddenTransform,
    opacity: isVisible ? 1 : 0,
    transformOrigin: "center center",
    transition:
      "transform 320ms cubic-bezier(0.2, 0.8, 0.2, 1), opacity 220ms ease"
  } as const;

  const stepSummary = [
    { id: 1 as const, title: "Understand", subtitle: "Item, amount, source" },
    { id: 2 as const, title: "Validate", subtitle: "Project, rig, maintenance, movement" },
    { id: 3 as const, title: "Decide", subtitle: "Approve, link, or reject" }
  ];

  async function runDecision(action: "submit" | "approve" | "reject" | "reopen") {
    if (!expense || actionBusy) {
      return;
    }
    if (action === "reject" && rejectionReason.trim().length < 3) {
      setActionError("Rejection reason must be at least 3 characters.");
      return;
    }

    setActionBusy(true);
    setActionError(null);
    setActionNotice(null);

    try {
      const payload =
        action === "reject"
          ? { action, reason: rejectionReason.trim() }
          : { action };
      const response = await fetch(`/api/expenses/${expense.id}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (!response.ok) {
        throw new Error(await readApiError(response, "Failed to update expense status."));
      }
      await onRefresh();
      setActionNotice(expenseDecisionSuccessText(action));
      if (action === "reject") {
        setRejectionReason("");
      }
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Failed to update expense status.");
    } finally {
      setActionBusy(false);
    }
  }

  return (
    <div
      className={`fixed inset-0 z-[84] flex items-center justify-center p-3 transition-opacity duration-200 ease-out sm:p-6 ${
        isVisible ? "opacity-100" : "pointer-events-none opacity-0"
      }`}
    >
      <button
        type="button"
        onClick={onClose}
        className={`absolute inset-0 bg-slate-900/28 backdrop-blur-[2px] transition-opacity duration-200 ${
          isVisible ? "opacity-100" : "opacity-0"
        }`}
        aria-label="Close expense detail modal"
      />
      <section
        ref={panelRef}
        style={panelMotionStyle}
        className="relative z-10 flex h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-[0_24px_64px_rgba(15,23,42,0.24)]"
      >
        <div className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 px-5 py-4 shadow-[0_1px_0_rgba(15,23,42,0.06)] backdrop-blur">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Expense Review</p>
              <p className="text-xl font-semibold text-ink-900">{modalTitle}</p>
              <p className="mt-0.5 text-xs font-medium text-slate-600">
                Ref {expense?.id?.slice(-8) || "Loading"} • {queueFilterLabel(queueStatus)}
              </p>
              <SystemFlowBar current="expense" className="mt-2" />
              <div className="mt-2 flex flex-wrap gap-1.5">
                {stepSummary.map((step) => {
                  const active = reviewStep === step.id;
                  const complete = reviewStep > step.id;
                  return (
                    <span
                      key={step.id}
                      className={cn(
                        "rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors",
                        active
                          ? "border-ink-900 bg-ink-900 text-white"
                          : complete
                            ? "border-emerald-300 bg-emerald-50 text-emerald-800"
                            : "border-slate-200 bg-slate-50 text-slate-600"
                      )}
                    >
                      {step.id}. {step.title}
                    </span>
                  );
                })}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 p-1">
              <button
                type="button"
                onClick={onClose}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-900"
                aria-label="Close expense detail"
              >
                <X size={14} />
              </button>
            </div>
          </div>
        </div>

        {!expense ? (
          <div className="p-4 text-sm text-ink-600">Loading expense details...</div>
        ) : (
          <>
            <div className="flex-1 overflow-y-auto bg-slate-50/40 p-4 sm:p-5">
              <div key={reviewStep} className="space-y-3 transition-all duration-200 ease-out">
                <section className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Step {reviewStep} of 3
                  </p>
                  <p className="text-sm font-semibold text-ink-900">{stepSummary[reviewStep - 1]?.title || "Review"}</p>
                  <p className="text-xs text-slate-600">{stepSummary[reviewStep - 1]?.subtitle || ""}</p>
                </section>

                {reviewStep === 1 ? (
                  <>
                    <section className="gf-section-shell p-3">
                      <div className="gf-section-heading">
                        <div className="gf-section-heading-block">
                          <h4 className="gf-section-title">Expense Summary</h4>
                        </div>
                      </div>
                      <div className="mt-3 grid gap-2 sm:grid-cols-3">
                        <SummaryBadge label="Item" value={deriveExpenseTitle(expense)} />
                        <SummaryBadge label="Amount" value={formatCurrency(expense.amount)} />
                        <SummaryBadge label="Source" value={deriveExpenseSource(expense)} />
                      </div>
                    </section>

                    <section className="gf-section-shell p-3">
                      <div className="gf-section-heading">
                        <div className="gf-section-heading-block">
                          <h4 className="gf-section-title">Why this cost exists</h4>
                        </div>
                      </div>
                      <p className="mt-2 text-sm text-slate-700">
                        {truncateExpenseExplanation(deriveExpenseWhyThisCost(expense, queueStatus), 140)}
                      </p>
                    </section>
                  </>
                ) : null}

                {reviewStep === 2 ? (
                  <>
                    <section className="gf-section-shell p-3">
                      <div className="gf-section-heading">
                        <div className="gf-section-heading-block">
                          <h4 className="gf-section-title">Validation Context</h4>
                        </div>
                      </div>
                      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                        <SummaryBadge
                          label="Project"
                          value={expense.project?.name || primaryMovement?.project?.name || "-"}
                        />
                        <SummaryBadge
                          label="Rig"
                          value={expense.rig?.rigCode || primaryMovement?.rig?.rigCode || "-"}
                        />
                        <SummaryBadge
                          label="Maintenance Case"
                          value={primaryMovement?.maintenanceRequest?.requestCode || "-"}
                        />
                        <SummaryBadge
                          label="Movement"
                          value={primaryMovement?.id ? primaryMovement.id.slice(-8) : "-"}
                        />
                      </div>
                    </section>
                  </>
                ) : null}

                {reviewStep === 3 ? (
                  <>
                    <section className="gf-section-shell p-3">
                      <div className="gf-section-heading">
                        <div className="gf-section-heading-block">
                          <h4 className="gf-section-title">Decision</h4>
                        </div>
                      </div>

                      {actionNotice ? (
                        <p className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-2 text-xs text-emerald-700">
                          {actionNotice}
                        </p>
                      ) : null}
                      {actionError ? (
                        <p className="mt-3 rounded-md border border-red-200 bg-red-50 px-2.5 py-2 text-xs text-red-700">
                          {actionError}
                        </p>
                      ) : null}

                      {canReject ? (
                        <div className="mt-3">
                          <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500" htmlFor="expense-rejection-reason">
                            Rejection reason
                          </label>
                          <input
                            id="expense-rejection-reason"
                            value={rejectionReason}
                            onChange={(event) => setRejectionReason(event.target.value)}
                            placeholder="Enter reason if you reject this expense"
                            className="mt-1 w-full rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-sm text-ink-900 outline-none transition focus:border-ink-300 focus:ring-2 focus:ring-ink-100"
                          />
                        </div>
                      ) : null}

                      <div className="mt-3 flex flex-wrap gap-2">
                        {canApprove ? (
                          <button
                            type="button"
                            onClick={() => void runDecision("approve")}
                            disabled={actionBusy}
                            className="gf-btn-primary px-3 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {actionBusy ? "Approving..." : "Approve Expense"}
                          </button>
                        ) : null}
                        {canSubmit ? (
                          <button
                            type="button"
                            onClick={() => void runDecision("submit")}
                            disabled={actionBusy}
                            className="gf-btn-secondary px-3 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {actionBusy ? "Submitting..." : "Submit for approval"}
                          </button>
                        ) : null}
                        <Link href="/data-quality/linkage-center" className="gf-btn-secondary px-3 py-1.5 text-xs">
                          Link
                        </Link>
                        {canReject ? (
                          <button
                            type="button"
                            onClick={() => void runDecision("reject")}
                            disabled={actionBusy}
                            className="gf-btn-secondary px-3 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {actionBusy ? "Rejecting..." : "Reject"}
                          </button>
                        ) : null}
                        {canReopen ? (
                          <button
                            type="button"
                            onClick={() => void runDecision("reopen")}
                            disabled={actionBusy}
                            className="gf-btn-secondary px-3 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {actionBusy ? "Reopening..." : "Reopen"}
                          </button>
                        ) : null}
                        {!canTakeDecisionAction ? (
                          <p className="text-xs text-slate-600">No decision action is available for your role or this status.</p>
                        ) : null}
                      </div>
                    </section>
                  </>
                ) : null}
              </div>
            </div>

            <div className="flex items-center justify-between border-t border-slate-200 bg-white px-5 py-3">
              <div>
                {reviewStep > 1 ? (
                  <button
                    type="button"
                    onClick={() => setReviewStep((step) => (step > 1 ? ((step - 1) as 1 | 2 | 3) : step))}
                    className="gf-btn-secondary px-3 py-1.5 text-xs"
                  >
                    Back
                  </button>
                ) : null}
              </div>
              <div className="flex items-center gap-2">
                {reviewStep < 3 ? (
                  <button
                    type="button"
                    onClick={() => setReviewStep((step) => (step < 3 ? ((step + 1) as 1 | 2 | 3) : step))}
                    className="gf-btn-primary px-3 py-1.5 text-xs"
                  >
                    Continue
                  </button>
                ) : (
                  <button type="button" onClick={onClose} className="gf-btn-primary px-3 py-1.5 text-xs">
                    Submit
                  </button>
                )}
              </div>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

function ExpenseQueueStatusBadge({ status }: { status: ExpenseQueueStatus }) {
  const tone =
    status === "COST_RECOGNIZED"
      ? "border-emerald-300 bg-emerald-100 text-emerald-800"
      : status === "NEEDS_RECOGNITION"
        ? "border-amber-300 bg-amber-100 text-amber-800"
        : status === "PENDING_APPROVAL"
          ? "border-blue-300 bg-blue-100 text-blue-800"
          : "border-red-300 bg-red-100 text-red-800";
  return (
    <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${tone}`}>
      {queueFilterLabel(status)}
    </span>
  );
}

function SummaryBadge({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5">
      <p className="text-[10px] uppercase tracking-wide text-slate-500">{label}</p>
      <p className="text-sm font-medium text-ink-800">{value}</p>
    </div>
  );
}

function queueFilterLabel(filter: ExpenseQueueStatus | ExpenseQueueFilter) {
  if (filter === "NEEDS_RECOGNITION") return "Needs recognition";
  if (filter === "PENDING_APPROVAL") return "Pending approval";
  if (filter === "COST_RECOGNIZED") return "Cost recognized";
  if (filter === "UNLINKED") return "Unlinked cost";
  return "All";
}

function recognitionChipClass(status: ExpenseQueueStatus, isActive: boolean) {
  if (status === "UNLINKED") {
    return isActive
      ? "border-red-400 bg-red-100 text-red-900 shadow-sm"
      : "border-red-300 bg-red-50 text-red-800 hover:bg-red-100";
  }
  if (status === "NEEDS_RECOGNITION") {
    return isActive
      ? "border-amber-400 bg-amber-100 text-amber-900 shadow-sm"
      : "border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100";
  }
  if (status === "PENDING_APPROVAL") {
    return isActive
      ? "border-blue-400 bg-blue-100 text-blue-900 shadow-sm"
      : "border-blue-300 bg-blue-50 text-blue-800 hover:bg-blue-100";
  }
  return isActive
    ? "border-emerald-400 bg-emerald-100 text-emerald-900 shadow-sm"
    : "border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100";
}

function deriveExpenseTitle(expense: InventoryExpenseRow) {
  const primaryMovement = expense.inventoryMovements[0] || null;
  if (primaryMovement?.item?.name) {
    return primaryMovement.item.name;
  }
  if (expense.subcategory?.trim()) {
    return expense.subcategory.trim();
  }
  return formatCategoryLabel(expense.category);
}

function deriveExpenseSource(expense: InventoryExpenseRow) {
  const primaryMovement = expense.inventoryMovements[0] || null;
  if (primaryMovement?.movementType === "OUT") {
    return "Inventory usage";
  }
  if (primaryMovement?.movementType === "IN") {
    return "Receipt intake";
  }
  if (expense.receiptUrl || expense.receiptNumber) {
    return "Receipt intake";
  }
  if ((expense.entrySource || "").toUpperCase() === "INVENTORY") {
    return "Inventory movement";
  }
  return "Operational activity";
}

function buildOperationalContextLine(expense: InventoryExpenseRow, status: ExpenseQueueStatus) {
  const primaryMovement = expense.inventoryMovements[0] || null;
  const project = expense.project?.name || primaryMovement?.project?.name || "No project";
  const rig = expense.rig?.rigCode || primaryMovement?.rig?.rigCode || "No rig";
  const maintenance = primaryMovement?.maintenanceRequest?.requestCode || "No maintenance case";
  const baseContext = `${project} • ${rig} • ${maintenance}`;
  if (status === "UNLINKED") {
    return `${baseContext} • Link this cost to restore operational traceability.`;
  }
  return baseContext;
}

function deriveExpenseWhyThisCost(expense: InventoryExpenseRow, status: ExpenseQueueStatus) {
  const primaryMovement = expense.inventoryMovements[0] || null;
  if (expense.purposeTraceability && status !== "UNLINKED") {
    return expense.purposeTraceability;
  }
  if (status === "UNLINKED") {
    return "This cost is not linked to a movement, receipt, or issue record yet.";
  }
  if (primaryMovement?.maintenanceRequest?.requestCode) {
    return `Created from maintenance usage linked to ${primaryMovement.maintenanceRequest.requestCode}.`;
  }
  if (primaryMovement?.movementType === "OUT") {
    return "Created when stock was issued out of inventory for operational use.";
  }
  if (primaryMovement?.movementType === "IN") {
    return "Created from stock replenishment captured during receipt intake.";
  }
  if (expense.receiptNumber || expense.receiptUrl) {
    return "Created from receipt-linked purchase intake.";
  }
  if (status === "COST_RECOGNIZED") {
    return "Recognized from a confirmed operational expense record.";
  }
  if (status === "PENDING_APPROVAL") {
    return "Waiting for approval before it can move into recognized financial totals.";
  }
  return "Approved intent exists; posting confirmation is still required for recognition.";
}

function truncateExpenseExplanation(value: string, maxLength: number) {
  const trimmed = value.trim();
  if (trimmed.length <= maxLength) {
    return trimmed;
  }
  return `${trimmed.slice(0, maxLength - 1).trimEnd()}…`;
}

function deriveExpenseQueueStatus(expense: InventoryExpenseRow): ExpenseQueueStatus {
  if (!hasOperationalExpenseLink(expense)) {
    return "UNLINKED";
  }
  if (expense.recognized) {
    return "COST_RECOGNIZED";
  }
  if (expense.approvalStatus === "APPROVED") {
    return "NEEDS_RECOGNITION";
  }
  return "PENDING_APPROVAL";
}

function hasOperationalExpenseLink(expense: InventoryExpenseRow) {
  if (expense.inventoryMovements.length > 0) {
    return true;
  }
  if (expense.receiptNumber || expense.receiptUrl) {
    return true;
  }
  const contextText = `${expense.entrySource || ""} ${expense.notes || ""}`.toLowerCase();
  return contextText.includes("issue");
}

function deriveExpenseContextLink(expense: InventoryExpenseRow): { href: string; label: string } | null {
  const primaryMovement = expense.inventoryMovements[0] || null;
  if (primaryMovement?.maintenanceRequest?.id) {
    return { href: "/maintenance", label: "Open Maintenance" };
  }
  if (expense.project?.id || primaryMovement?.project?.id) {
    const projectId = expense.project?.id || primaryMovement?.project?.id;
    return projectId ? { href: `/projects/${projectId}`, label: "Open Project" } : null;
  }
  if (expense.rig?.id || primaryMovement?.rig?.id) {
    const rigId = expense.rig?.id || primaryMovement?.rig?.id;
    return rigId ? { href: `/rigs/${rigId}`, label: "Open Rig" } : null;
  }
  return null;
}

function canSubmitExpenseActions(role: string | null | undefined) {
  return role === "ADMIN" || role === "MANAGER" || role === "OFFICE";
}

function expenseDecisionSuccessText(action: "submit" | "approve" | "reject" | "reopen") {
  if (action === "submit") {
    return "Expense submitted for approval.";
  }
  if (action === "approve") {
    return "Expense approved successfully.";
  }
  if (action === "reject") {
    return "Expense rejected successfully.";
  }
  return "Expense reopened to draft.";
}

function formatCategoryLabel(category: string) {
  return category
    .toLowerCase()
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
    .join(" ");
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
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
  const raw = (await clone.text().catch(() => "")).trim();
  if (raw) {
    return raw;
  }
  return `${fallbackMessage} (HTTP ${response.status})`;
}
