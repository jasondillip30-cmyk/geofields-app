"use client";

import { useEffect, useMemo, useState } from "react";

import { UsageRequestStatusBadge } from "@/components/inventory/inventory-page-shared";
import type { InventoryUsageBatchApprovalRow } from "./approvals-page-types";
import { formatUsageBatchDecision, toIsoDate } from "@/components/inventory/inventory-page-utils";
import { cn, formatNumber } from "@/lib/utils";

type LineDecisionState = {
  action: "approve" | "reject" | "";
  note: string;
};

export function InventoryUsageBatchReviewModal({
  open,
  onClose,
  batch,
  canManageInventoryApprovals,
  submitting,
  onSubmit
}: {
  open: boolean;
  onClose: () => void;
  batch: InventoryUsageBatchApprovalRow | null;
  canManageInventoryApprovals: boolean;
  submitting: boolean;
  onSubmit: (
    decisions: Array<{
      lineId: string;
      action: "approve" | "reject";
      note?: string;
    }>
  ) => Promise<void>;
}) {
  const [isMounted, setIsMounted] = useState(open);
  const [isVisible, setIsVisible] = useState(open);
  const [lineDecisions, setLineDecisions] = useState<Record<string, LineDecisionState>>({});
  const [decisionError, setDecisionError] = useState<string | null>(null);

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
    if (!open || !batch) {
      setLineDecisions({});
      setDecisionError(null);
      return;
    }
    setLineDecisions(
      Object.fromEntries(
        batch.lines.map((line) => [
          line.id,
          {
            action: "",
            note: ""
          }
        ])
      )
    );
    setDecisionError(null);
  }, [batch, open]);

  const decisionSummary = useMemo(() => {
    if (!batch) {
      return {
        decided: 0,
        remaining: 0,
        rejectReasonMissing: 0
      };
    }
    let decided = 0;
    let rejectReasonMissing = 0;
    for (const line of batch.lines) {
      const decision = lineDecisions[line.id];
      if (!decision || !decision.action) {
        continue;
      }
      decided += 1;
      if (decision.action === "reject" && decision.note.trim().length < 3) {
        rejectReasonMissing += 1;
      }
    }
    return {
      decided,
      remaining: Math.max(0, batch.lines.length - decided),
      rejectReasonMissing
    };
  }, [batch, lineDecisions]);

  function setLineDecision(lineId: string, patch: Partial<LineDecisionState>) {
    setLineDecisions((current) => ({
      ...current,
      [lineId]: {
        action: current[lineId]?.action || "",
        note: current[lineId]?.note || "",
        ...patch
      }
    }));
  }

  function applyAllDecisions(action: "approve" | "reject") {
    if (!batch) {
      return;
    }
    setLineDecisions((current) =>
      Object.fromEntries(
        batch.lines.map((line) => [
          line.id,
          {
            action,
            note: action === "reject" ? current[line.id]?.note || "" : ""
          }
        ])
      )
    );
  }

  async function submitDecisions() {
    if (!batch) {
      return;
    }
    if (!canManageInventoryApprovals) {
      setDecisionError("You do not have permission to decide inventory usage batches.");
      return;
    }
    if (decisionSummary.remaining > 0) {
      setDecisionError("Every line must be approved or rejected before submit.");
      return;
    }
    if (decisionSummary.rejectReasonMissing > 0) {
      setDecisionError("Rejected lines require a reason (minimum 3 characters).");
      return;
    }
    setDecisionError(null);
    await onSubmit(
      batch.lines.map((line) => {
        const decision = lineDecisions[line.id];
        return {
          lineId: line.id,
          action: (decision?.action || "approve") as "approve" | "reject",
          ...(decision?.note.trim() ? { note: decision.note.trim() } : {})
        };
      })
    );
  }

  if (!isMounted) {
    return null;
  }

  return (
    <div
      className={`fixed inset-0 z-[96] flex items-center justify-center p-3 transition-opacity duration-200 ease-out sm:p-6 ${
        isVisible ? "opacity-100" : "pointer-events-none opacity-0"
      }`}
    >
      <button
        type="button"
        onClick={onClose}
        className={`absolute inset-0 bg-slate-900/45 backdrop-blur-[2px] transition-opacity duration-200 ${
          isVisible ? "opacity-100" : "opacity-0"
        }`}
        aria-label="Close inventory batch review modal"
      />
      <section
        className={`relative z-10 flex h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_24px_64px_rgba(15,23,42,0.24)] transition-all duration-200 ease-out ${
          isVisible
            ? "translate-y-0 scale-100 opacity-100"
            : "translate-y-1 scale-[0.985] opacity-0"
        }`}
      >
        <div className="border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="text-sm font-semibold text-ink-900">
                {batch?.batchCode || "Batch review"}
              </p>
              <p className="text-xs text-slate-600">
                {batch
                  ? `Submitted ${toIsoDate(batch.createdAt)} • ${batch.summary.lineCount} line(s)`
                  : "Loading batch"}
              </p>
            </div>
            <button type="button" onClick={onClose} className="gf-btn-secondary px-3 py-1.5 text-xs">
              Close
            </button>
          </div>
          {batch ? (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-700">
              <UsageRequestStatusBadge status={batch.status} />
              <span>{formatUsageBatchDecision(batch)}</span>
              <span>
                Context: {batch.project?.name || "-"} /{" "}
                {batch.rig?.rigCode || batch.location?.name || "-"}
              </span>
            </div>
          ) : null}
        </div>

        {!batch ? (
          <div className="px-4 py-4 text-sm text-slate-600">Loading batch details...</div>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-4 py-2">
              <div className="text-xs text-slate-700">
                <span className="font-semibold text-ink-900">{decisionSummary.decided}</span> decided •{" "}
                <span className="font-semibold text-ink-900">{decisionSummary.remaining}</span> remaining
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  className="gf-btn-secondary px-3 py-1 text-xs"
                  onClick={() => applyAllDecisions("approve")}
                  disabled={!canManageInventoryApprovals || submitting}
                >
                  Approve all
                </button>
                <button
                  type="button"
                  className="gf-btn-secondary px-3 py-1 text-xs"
                  onClick={() => applyAllDecisions("reject")}
                  disabled={!canManageInventoryApprovals || submitting}
                >
                  Reject all
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-auto px-4 py-3">
              <div className="space-y-2">
                {batch.lines.map((line) => {
                  const decision = lineDecisions[line.id] || { action: "", note: "" };
                  const rejectReasonMissing =
                    decision.action === "reject" && decision.note.trim().length < 3;
                  return (
                    <div
                      key={line.id}
                      className={cn(
                        "rounded-xl border border-slate-200 px-3 py-3",
                        rejectReasonMissing ? "border-red-300 bg-red-50/40" : "bg-white"
                      )}
                    >
                      <div className="grid gap-2 md:grid-cols-[minmax(0,2fr)_140px_220px] md:items-end">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-ink-900">
                            {line.item?.name || "Unknown item"}
                          </p>
                          <p className="text-xs text-slate-600">
                            {line.item?.sku || "-"} • Qty: {formatNumber(line.quantity)} • Stock:{" "}
                            {formatNumber(line.item?.quantityInStock || 0)}
                          </p>
                        </div>
                        <label className="text-xs text-ink-700">
                          <span className="mb-1 block uppercase tracking-wide text-slate-500">
                            Decision
                          </span>
                          <select
                            value={decision.action}
                            onChange={(event) =>
                              setLineDecision(line.id, {
                                action: event.target.value as "approve" | "reject" | ""
                              })
                            }
                            className="w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm"
                          >
                            <option value="">Select</option>
                            <option value="approve">Approve</option>
                            <option value="reject">Reject</option>
                          </select>
                        </label>
                        <label className="text-xs text-ink-700">
                          <span className="mb-1 block uppercase tracking-wide text-slate-500">
                            Note {decision.action === "reject" ? "(required)" : "(optional)"}
                          </span>
                          <input
                            value={decision.note}
                            onChange={(event) =>
                              setLineDecision(line.id, { note: event.target.value })
                            }
                            placeholder={
                              decision.action === "reject"
                                ? "Enter rejection reason"
                                : "Optional approval note"
                            }
                            className="w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm"
                          />
                        </label>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        )}

        <div className="border-t border-slate-200 px-4 py-3">
          {decisionError ? (
            <p className="mb-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {decisionError}
            </p>
          ) : null}
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="gf-btn-secondary px-3 py-1.5 text-xs"
              disabled={submitting}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void submitDecisions()}
              className="gf-btn-primary px-3 py-1.5 text-xs"
              disabled={submitting || !batch || !canManageInventoryApprovals}
            >
              {submitting ? "Submitting..." : "Submit decisions"}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
