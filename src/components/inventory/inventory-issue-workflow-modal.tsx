"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { X } from "lucide-react";

import { SystemFlowBar } from "@/components/inventory/system-flow-bar";
import { IssueSeverityBadge, SummaryBadge } from "@/components/inventory/inventory-page-shared";
import { deriveIssueTypeTag, truncateIssueText, type IssueOperationalContext } from "@/components/inventory/inventory-page-utils";
import { cn, formatCurrency, formatNumber } from "@/lib/utils";
import type { InventoryIssueRow } from "@/app/inventory/page";

export function InventoryIssueWorkflowModal({
  open,
  onClose,
  issue,
  issueContext,
  initialStep,
  onFixIssue,
  onOpenItem,
  onOpenMovement
}: {
  open: boolean;
  onClose: () => void;
  issue: InventoryIssueRow | null;
  issueContext: IssueOperationalContext | null;
  initialStep: 1 | 2 | 3;
  onFixIssue: (issue: InventoryIssueRow) => void | Promise<void>;
  onOpenItem: (itemId: string) => void;
  onOpenMovement: (movementId: string) => void;
}) {
  const [isMounted, setIsMounted] = useState(open);
  const [isVisible, setIsVisible] = useState(open);
  const [workflowStep, setWorkflowStep] = useState<1 | 2 | 3>(1);
  const [submitting, setSubmitting] = useState(false);
  const submitInFlightRef = useRef(false);

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
    setWorkflowStep(initialStep);
    setSubmitting(false);
  }, [initialStep, issue?.id, open]);

  if (!isMounted) {
    return null;
  }

  const stepSummary = [
    { id: 1 as const, title: "Understand", subtitle: "What this issue is and what is affected." },
    { id: 2 as const, title: "Validate", subtitle: "Confirm operational context and impact." },
    { id: 3 as const, title: "Decide", subtitle: "Choose and submit the issue resolution action." }
  ];

  const canSubmit = Boolean(issue);

  async function submitIssueDecision() {
    if (submitting || submitInFlightRef.current) {
      return;
    }
    if (!issue) {
      onClose();
      return;
    }
    try {
      submitInFlightRef.current = true;
      setSubmitting(true);
      await Promise.resolve(onFixIssue(issue));
      onClose();
    } finally {
      setSubmitting(false);
      submitInFlightRef.current = false;
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
        aria-label="Close issue workflow modal"
      />
      <section
        className={`relative z-10 flex h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-[0_24px_64px_rgba(15,23,42,0.24)] transition-all duration-200 ease-out ${
          isVisible ? "translate-y-0 scale-100 opacity-100" : "translate-y-1 scale-[0.985] opacity-0"
        }`}
      >
        <div className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 px-5 py-4 shadow-[0_1px_0_rgba(15,23,42,0.06)] backdrop-blur">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Issue Workflow</p>
              <p className="text-xl font-semibold text-ink-900">{issue?.title || "Inventory issue"}</p>
              <p className="mt-0.5 text-xs font-medium text-slate-600">Step {workflowStep} of 3</p>
              <SystemFlowBar current="issue" className="mt-2" />
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
            </div>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-900"
              aria-label="Close issue workflow"
            >
              <X size={14} />
            </button>
          </div>
        </div>

        {!issue ? (
          <div className="p-4 text-sm text-ink-600">Loading issue details...</div>
        ) : (
          <>
            <div className="flex-1 overflow-y-auto bg-slate-50/40 p-4 sm:p-5">
              <section className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {stepSummary[workflowStep - 1]?.title}
                </p>
                <p className="text-xs text-slate-600">{stepSummary[workflowStep - 1]?.subtitle}</p>
              </section>

              {workflowStep === 1 ? (
                <section className="mt-3 rounded-lg border border-slate-200 bg-white p-3">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <IssueSeverityBadge severity={issue.severity} />
                    <span className="rounded-full border border-slate-300 bg-white px-1.5 py-[1px] text-[10px] font-semibold text-slate-700">
                      {deriveIssueTypeTag(issue)}
                    </span>
                  </div>
                  <p className="mt-2 text-sm font-semibold text-ink-900">{issue.title}</p>
                  <p className="mt-1 text-xs text-slate-700">{truncateIssueText(issue.message, 220)}</p>
                  <p className="mt-1 text-xs text-slate-600">{truncateIssueText(issue.suggestion, 220)}</p>
                </section>
              ) : null}

              {workflowStep === 2 ? (
                <section className="mt-3 rounded-lg border border-slate-200 bg-white p-3">
                  <div className="grid gap-2 sm:grid-cols-2">
                    <SummaryBadge label="Project" value={issueContext?.projectNames[0] || "-"} />
                    <SummaryBadge label="Rig" value={issueContext?.rigCodes[0] || "-"} />
                    <SummaryBadge label="Category" value={issueContext?.categoryLabels[0] || "-"} />
                    <SummaryBadge label="Issue Type" value={deriveIssueTypeTag(issue)} />
                    <SummaryBadge
                      label="Inventory Value Affected"
                      value={formatCurrency(issueContext?.inventoryValueAffected || 0)}
                    />
                    <SummaryBadge label="Movements Impacted" value={formatNumber(issueContext?.movementsImpacted || 0)} />
                    <SummaryBadge label="Cost at Risk" value={formatCurrency(issueContext?.costAtRisk || 0)} />
                    <SummaryBadge label="Maintenance Case" value={issueContext?.maintenanceCodes[0] || "-"} />
                  </div>
                  <div className="mt-2 space-y-0.5 text-xs text-slate-700">
                    <p>Movement: {issueContext?.movementIds[0] || "-"}</p>
                    <p>Receipt: {issueContext?.receiptRefs[0] || "-"}</p>
                  </div>
                </section>
              ) : null}

              {workflowStep === 3 ? (
                <section className="mt-3 rounded-lg border border-slate-200 bg-white p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Resolution Actions</p>
                  <p className="mt-1 text-sm text-ink-800">Fix this issue now or open linked operational records.</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {issue.itemIds[0] ? (
                      <button
                        type="button"
                        onClick={() => {
                          onOpenItem(issue.itemIds[0] || "");
                          onClose();
                        }}
                        className="gf-btn-secondary px-2.5 py-1 text-[11px]"
                      >
                        Open Item
                      </button>
                    ) : null}
                    {issueContext?.latestMovementId ? (
                      <button
                        type="button"
                        onClick={() => {
                          onOpenMovement(issueContext.latestMovementId || "");
                          onClose();
                        }}
                        className="gf-btn-secondary px-2.5 py-1 text-[11px]"
                      >
                        Open Movement
                      </button>
                    ) : null}
                    {issueContext?.maintenanceCodes.length ? (
                      <Link href="/maintenance" className="gf-btn-secondary px-2.5 py-1 text-[11px]">
                        Open Maintenance
                      </Link>
                    ) : null}
                    {issueContext?.receiptRefs.length ? (
                      <Link href="/purchasing/receipt-follow-up" className="gf-btn-secondary px-2.5 py-1 text-[11px]">
                        Open Receipt Follow-up
                      </Link>
                    ) : null}
                  </div>
                </section>
              ) : null}
            </div>

            <div className="flex items-center justify-between border-t border-slate-200 bg-white px-5 py-3">
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
                  <button
                    type="button"
                    onClick={() => void submitIssueDecision()}
                    disabled={!canSubmit || submitting}
                    className="gf-btn-primary px-3 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {submitting ? "Submitting..." : "Submit"}
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
