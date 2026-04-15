"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";

import { SystemFlowBar } from "@/components/inventory/system-flow-bar";
import { movementItemLabel, toIsoDate } from "@/components/inventory/inventory-page-utils";
import { SummaryBadge, readApiError } from "@/components/inventory/inventory-page-shared";
import type { InventoryMovementRow } from "@/app/inventory/page";
import { formatMovementType } from "@/lib/inventory";
import { cn, formatCurrency, formatNumber } from "@/lib/utils";

export function MovementDetailModal({
  open,
  onClose,
  movement,
  isProjectLocked,
  canApproveMovement,
  onRefresh
}: {
  open: boolean;
  onClose: () => void;
  movement: InventoryMovementRow | null;
  isProjectLocked: boolean;
  canApproveMovement: boolean;
  onRefresh: () => Promise<void>;
}) {
  const [isMounted, setIsMounted] = useState(open);
  const [isVisible, setIsVisible] = useState(open);
  const [workflowStep, setWorkflowStep] = useState<1 | 2 | 3>(1);
  const [submittingDecision, setSubmittingDecision] = useState(false);
  const [decisionFeedback, setDecisionFeedback] = useState<{
    tone: "success" | "error" | "info";
    message: string;
  } | null>(null);

  useEffect(() => {
    let timeoutId: number | undefined;
    if (open) {
      setIsMounted(true);
      timeoutId = window.setTimeout(() => setIsVisible(true), 12);
    } else if (isMounted) {
      setIsVisible(false);
      timeoutId = window.setTimeout(() => setIsMounted(false), 180);
    }

    return () => {
      if (timeoutId !== undefined) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [isMounted, open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    setWorkflowStep(1);
    setDecisionFeedback(null);
    setSubmittingDecision(false);
  }, [movement?.id, open]);

  if (!isMounted) {
    return null;
  }

  const stepSummary = isProjectLocked
    ? [{ id: 1 as const, title: "Movement details", subtitle: "Project-linked stock flow (read-only)." }]
    : [
        { id: 1 as const, title: "Understand", subtitle: "Confirm item movement details." },
        { id: 2 as const, title: "Validate", subtitle: "Check operational context before approval." },
        { id: 3 as const, title: "Confirm", subtitle: "Approve this movement." }
      ];
  const linkedMaintenance =
    movement?.linkedUsageRequest?.maintenanceRequest || movement?.maintenanceRequest || null;
  const expenseStatus = String(movement?.expense?.approvalStatus || "").toUpperCase();
  const expenseStatusLabel = movement?.expense?.approvalStatus
    ? `${movement.expense.approvalStatus.charAt(0)}${movement.expense.approvalStatus
        .slice(1)
        .toLowerCase()}`
    : "Not linked";
  const modalTitle = movement
    ? movement.item?.name?.trim()
      ? `${movement.item.name.trim()} movement`
      : `${formatMovementType(movement.movementType)} movement`
    : "Loading movement";
  const movementTypeLabel =
    movement?.movementType === "IN"
      ? "Restocked to project (IN)"
      : movement?.movementType === "OUT"
        ? "Used on project (OUT)"
        : movement
          ? formatMovementType(movement.movementType)
          : "-";

  async function approveMovement() {
    if (!movement) {
      return;
    }
    if (!movement.expense?.id) {
      setDecisionFeedback({
        tone: "error",
        message: "No linked expense found. Add the missing expense linkage before approval."
      });
      return;
    }
    if (!canApproveMovement) {
      setDecisionFeedback({
        tone: "error",
        message: "Only Admin or Manager can approve this movement confirmation."
      });
      return;
    }
    if (expenseStatus === "APPROVED") {
      setDecisionFeedback({
        tone: "success",
        message: "Movement already confirmed. Linked expense is approved."
      });
      return;
    }
    if (expenseStatus !== "SUBMITTED") {
      setDecisionFeedback({
        tone: "error",
        message: `Linked expense is ${expenseStatus ? expenseStatus.toLowerCase() : "not submitted"}. Submit it before approval.`
      });
      return;
    }

    setSubmittingDecision(true);
    setDecisionFeedback(null);
    try {
      const response = await fetch(`/api/expenses/${encodeURIComponent(movement.expense.id)}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "approve" })
      });
      if (!response.ok) {
        throw new Error(await readApiError(response, "Failed to approve movement."));
      }
      await onRefresh();
      setDecisionFeedback({
        tone: "success",
        message: "Movement approved. Linked expense is now recognized."
      });
    } catch (error) {
      setDecisionFeedback({
        tone: "error",
        message: error instanceof Error ? error.message : "Failed to approve movement."
      });
    } finally {
      setSubmittingDecision(false);
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
        className={`absolute inset-0 bg-slate-900/35 backdrop-blur-[2px] transition-opacity duration-200 ${
          isVisible ? "opacity-100" : "opacity-0"
        }`}
        aria-label="Close movement detail modal"
      />
      <section
        className={`relative z-10 flex h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-[0_24px_64px_rgba(15,23,42,0.24)] transition-all duration-200 ease-out ${
          isVisible ? "translate-y-0 scale-100 opacity-100" : "translate-y-1 scale-[0.985] opacity-0"
        }`}
      >
        <div className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 px-5 py-4 shadow-[0_1px_0_rgba(15,23,42,0.06)] backdrop-blur">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                {isProjectLocked ? "Movement detail" : "Movement approval"}
              </p>
              <p className="text-xl font-semibold text-ink-900">{modalTitle}</p>
              {isProjectLocked ? (
                <p className="mt-0.5 text-xs font-medium text-slate-600">
                  Read-only movement history for the locked project.
                </p>
              ) : (
                <>
                  <p className="mt-0.5 text-xs font-medium text-slate-600">Step {workflowStep} of 3</p>
                  <SystemFlowBar current="movement" className="mt-2" />
                  <div className="mt-2 flex items-center gap-1.5">
                    {stepSummary.map((step) => (
                      <span
                        key={step.id}
                        className={cn(
                          "h-1.5 w-6 rounded-full",
                          workflowStep === step.id
                            ? "bg-ink-900"
                            : workflowStep > step.id
                              ? "bg-emerald-400"
                              : "bg-slate-200"
                        )}
                      />
                    ))}
                  </div>
                </>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 p-1">
              <button
                type="button"
                onClick={onClose}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-900"
                aria-label="Close movement detail"
              >
                <X size={14} />
              </button>
            </div>
          </div>
        </div>

        {!movement ? (
          <div className="p-4 text-sm text-ink-600">Loading movement details...</div>
        ) : (
          <>
            <div className="flex-1 overflow-y-auto bg-slate-50/40 p-4 sm:p-5">
              <section className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {isProjectLocked ? stepSummary[0]?.title : stepSummary[workflowStep - 1]?.title}
                </p>
                <p className="text-xs text-slate-600">
                  {isProjectLocked ? stepSummary[0]?.subtitle : stepSummary[workflowStep - 1]?.subtitle}
                </p>
              </section>

              {isProjectLocked ? (
                <section className="mt-3 rounded-lg border border-slate-200 bg-white p-3 transition-all duration-200 ease-out">
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    <SummaryBadge label="Item" value={movementItemLabel(movement)} />
                    <SummaryBadge label="Type" value={movementTypeLabel} />
                    <SummaryBadge label="Quantity" value={formatNumber(movement.quantity)} />
                    <SummaryBadge label="Total cost" value={formatCurrency(movement.totalCost || 0)} />
                    <SummaryBadge label="Date" value={toIsoDate(movement.date)} />
                    <SummaryBadge label="Project" value={movement.project?.name || "-"} />
                    <SummaryBadge label="Rig" value={movement.rig?.rigCode || "-"} />
                    <SummaryBadge
                      label="Drilling report"
                      value={
                        movement.drillReport?.holeNumber ||
                        movement.linkedUsageRequest?.drillReport?.holeNumber ||
                        "-"
                      }
                    />
                    <SummaryBadge label="Maintenance" value={linkedMaintenance?.requestCode || "-"} />
                    <SummaryBadge label="Location from" value={movement.locationFrom?.name || "-"} />
                    <SummaryBadge label="Location to" value={movement.locationTo?.name || "-"} />
                    <SummaryBadge
                      label="Recorded by"
                      value={
                        movement.performedBy?.fullName ||
                        movement.linkedUsageRequest?.requestedBy?.fullName ||
                        "-"
                      }
                    />
                  </div>
                </section>
              ) : (
                <>
                  {workflowStep === 1 ? (
                    <section className="mt-3 rounded-lg border border-slate-200 bg-white p-3 transition-all duration-200 ease-out">
                      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                        <SummaryBadge label="Item" value={movementItemLabel(movement)} />
                        <SummaryBadge label="Type" value={formatMovementType(movement.movementType)} />
                        <SummaryBadge label="Quantity" value={formatNumber(movement.quantity)} />
                        <SummaryBadge label="Location From" value={movement.locationFrom?.name || "-"} />
                        <SummaryBadge label="Location To" value={movement.locationTo?.name || "-"} />
                        <SummaryBadge label="Date" value={toIsoDate(movement.date)} />
                      </div>
                    </section>
                  ) : null}

                  {workflowStep === 2 ? (
                    <section className="mt-3 rounded-lg border border-slate-200 bg-white p-3 transition-all duration-200 ease-out">
                      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
                        <SummaryBadge label="Project" value={movement.project?.name || "-"} />
                        <SummaryBadge label="Rig" value={movement.rig?.rigCode || "-"} />
                        <SummaryBadge
                          label="Drilling report"
                          value={
                            movement.drillReport?.holeNumber ||
                            movement.linkedUsageRequest?.drillReport?.holeNumber ||
                            "-"
                          }
                        />
                        <SummaryBadge
                          label="User"
                          value={
                            movement.performedBy?.fullName ||
                            movement.linkedUsageRequest?.requestedBy?.fullName ||
                            "-"
                          }
                        />
                        <SummaryBadge label="Maintenance" value={linkedMaintenance?.requestCode || "-"} />
                      </div>
                    </section>
                  ) : null}

                  {workflowStep === 3 ? (
                    <section className="mt-3 rounded-lg border border-slate-200 bg-white p-3 transition-all duration-200 ease-out">
                      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                        <SummaryBadge label="Linked Expense" value={movement.expense?.id ? movement.expense.id.slice(-8) : "Not linked"} />
                        <SummaryBadge label="Expense Status" value={expenseStatusLabel} />
                        <SummaryBadge
                          label="Recognition"
                          value={expenseStatus === "APPROVED" ? "Cost recognized" : "Pending recognition"}
                        />
                      </div>
                      {decisionFeedback ? (
                        <div
                          className={cn(
                            "mt-2 rounded-lg border px-3 py-2 text-xs",
                            decisionFeedback.tone === "success"
                              ? "border-emerald-300 bg-emerald-50 text-emerald-900"
                              : decisionFeedback.tone === "error"
                                ? "border-red-300 bg-red-50 text-red-900"
                                : "border-slate-200 bg-slate-50 text-slate-700"
                          )}
                        >
                          {decisionFeedback.message}
                        </div>
                      ) : null}
                    </section>
                  ) : null}
                </>
              )}
            </div>

            <div className="flex items-center justify-between border-t border-slate-200 bg-white px-5 py-3">
              {isProjectLocked ? (
                <>
                  <p className="text-xs text-slate-600">
                    Project mode shows read-only movement history.
                  </p>
                  <button
                    type="button"
                    onClick={onClose}
                    className="gf-btn-secondary px-3 py-1.5 text-xs"
                  >
                    Close
                  </button>
                </>
              ) : (
                <>
                  <div>
                    {workflowStep > 1 ? (
                      <button
                        type="button"
                        onClick={() => setWorkflowStep((step) => (step > 1 ? ((step - 1) as 1 | 2 | 3) : step))}
                        className="gf-btn-secondary px-3 py-1.5 text-xs"
                      >
                        Back
                      </button>
                    ) : null}
                  </div>
                  <div>
                    {workflowStep < 3 ? (
                      <button
                        type="button"
                        onClick={() => setWorkflowStep((step) => (step < 3 ? ((step + 1) as 1 | 2 | 3) : step))}
                        className="gf-btn-primary px-3 py-1.5 text-xs"
                      >
                        Continue
                      </button>
                    ) : (
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => void approveMovement()}
                          disabled={submittingDecision}
                          className="gf-btn-primary px-3 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {submittingDecision ? "Approving..." : "Approve movement"}
                        </button>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
