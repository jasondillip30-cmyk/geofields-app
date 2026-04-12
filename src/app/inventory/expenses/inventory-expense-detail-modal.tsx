"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { X } from "lucide-react";

import { SystemFlowBar } from "@/components/inventory/system-flow-bar";
import { canManageExpenseApprovalActions } from "@/lib/auth/approval-policy";
import { cn, formatCurrency } from "@/lib/utils";
import type {
  ExpenseQueueStatus,
  InventoryExpenseRow,
  ModalOriginFrame
} from "./inventory-expenses-types";
import {
  canSubmitExpenseActions,
  clamp,
  deriveExpenseQueueStatus,
  deriveExpenseSource,
  deriveExpenseTitle,
  deriveExpenseWhyThisCost,
  expenseDecisionSuccessText,
  queueFilterLabel,
  readApiError,
  truncateExpenseExplanation
} from "./inventory-expenses-utils";

export function ExpenseQueueStatusBadge({ status }: { status: ExpenseQueueStatus }) {
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

export function ExpenseDetailModal({
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
