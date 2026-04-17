"use client";

import { useEffect, useState } from "react";

import { UsageRequestStatusBadge } from "@/components/inventory/inventory-page-shared";
import type { InventoryUsageBatchRow } from "@/app/inventory/inventory-page-types";
import { formatUsageBatchDecision, toIsoDate } from "@/components/inventory/inventory-page-utils";
import { formatNumber } from "@/lib/utils";

export function UsageRequestBatchDetailModal({
  open,
  onClose,
  batch,
  onOpenMovement
}: {
  open: boolean;
  onClose: () => void;
  batch: InventoryUsageBatchRow | null;
  onOpenMovement: (movementId: string) => void;
}) {
  const [isMounted, setIsMounted] = useState(open);
  const [isVisible, setIsVisible] = useState(open);

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

  if (!isMounted) {
    return null;
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
        aria-label="Close usage batch detail modal"
      />
      <section
        className={`relative z-10 w-full max-w-3xl rounded-2xl border border-slate-200 bg-white shadow-[0_20px_50px_rgba(15,23,42,0.24)] transition-all duration-200 ease-out ${
          isVisible
            ? "translate-y-0 scale-100 opacity-100"
            : "translate-y-1 scale-[0.985] opacity-0"
        }`}
      >
        <div className="border-b border-slate-200 px-4 py-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-sm font-semibold text-ink-900">
                {batch?.batchCode || "Usage batch detail"}
              </p>
              <p className="text-xs text-slate-600">
                {batch
                  ? `Submitted ${toIsoDate(batch.createdAt)} • ${batch.summary.lineCount} line(s)`
                  : "Loading batch detail"}
              </p>
            </div>
            <button type="button" onClick={onClose} className="gf-btn-secondary px-3 py-1.5 text-xs">
              Close
            </button>
          </div>
        </div>
        {!batch ? (
          <div className="px-4 py-4 text-sm text-slate-600">Loading batch details...</div>
        ) : (
          <div className="space-y-3 px-4 py-4">
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-700">
              <UsageRequestStatusBadge status={batch.status} />
              <span>{formatUsageBatchDecision(batch)}</span>
              <span>
                Context: {batch.project?.name || "-"} /{" "}
                {batch.rig?.rigCode || batch.location?.name || "-"}
              </span>
            </div>
            <div className="max-h-[52vh] overflow-auto rounded-lg border border-slate-200">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-600">
                  <tr>
                    <th className="px-3 py-2 text-left">Item</th>
                    <th className="px-3 py-2 text-left">Qty</th>
                    <th className="px-3 py-2 text-left">Status</th>
                    <th className="px-3 py-2 text-left">Decision</th>
                    <th className="px-3 py-2 text-left">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {batch.lines.map((line) => (
                    <tr key={line.id}>
                      <td className="px-3 py-2">
                        <p className="font-medium text-ink-900">
                          {line.item?.name || "Unknown item"}
                        </p>
                        <p className="text-xs text-slate-600">
                          {line.item?.sku || "-"}
                        </p>
                      </td>
                      <td className="px-3 py-2">{formatNumber(line.quantity)}</td>
                      <td className="px-3 py-2">
                        <UsageRequestStatusBadge status={line.status} />
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-700">
                        {line.decisionNote?.trim() || "-"}
                      </td>
                      <td className="px-3 py-2">
                        {line.approvedMovementId ? (
                          <button
                            type="button"
                            onClick={() => onOpenMovement(line.approvedMovementId || "")}
                            className="gf-btn-subtle"
                          >
                            Open movement
                          </button>
                        ) : (
                          "-"
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
