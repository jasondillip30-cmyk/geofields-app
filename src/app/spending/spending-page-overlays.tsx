import { Pencil, X } from "lucide-react";

import { cn, formatCurrency } from "@/lib/utils";
import { DetailRow } from "./spending-page-table-parts";
import type { SpendingHoleStageRow, SpendingTransactionRow } from "./spending-page-types";
import { formatMeterRange, formatTransactionGroupDate } from "./spending-page-utils";

export function StageDetailsModal({
  hole,
  onClose
}: {
  hole: SpendingHoleStageRow | null;
  onClose: () => void;
}) {
  if (!hole) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[81]">
      <button type="button" onClick={onClose} className="absolute inset-0 bg-slate-900/30" aria-label="Close stage details" />
      <div className="absolute left-1/2 top-1/2 w-[min(92vw,680px)] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_24px_64px_rgba(15,23,42,0.24)] sm:p-5">
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Hole stage details</p>
            <p className="text-lg font-semibold text-ink-900">{hole.holeNumber}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 text-slate-600 transition-colors hover:bg-slate-50"
            aria-label="Close"
          >
            <X size={14} />
          </button>
        </div>

        <div className="mt-4 space-y-4">
          <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-3">
            <div className="flex flex-wrap items-center gap-3 text-sm text-slate-700">
              <p>
                <span className="font-semibold text-ink-900">Current stage:</span> {hole.currentStageLabel || "Not yet started"}
              </p>
              <p>
                <span className="font-semibold text-ink-900">Current depth:</span>{" "}
                {hole.currentDepth.toLocaleString(undefined, { maximumFractionDigits: 2 })}m
              </p>
            </div>
          </div>

          <div className="grid gap-2 sm:grid-cols-3">
            {hole.stageSegments.map((segment) => {
              const isCurrentStage = hole.currentStageLabel === segment.label;
              return (
                <div
                  key={`${hole.holeNumber}-segment-${segment.label}-${segment.startM}-${segment.endM}`}
                  className={cn(
                    "rounded-lg border px-3 py-2",
                    isCurrentStage ? "border-brand-300 bg-brand-50/45" : "border-slate-200 bg-white"
                  )}
                >
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">{segment.label}</p>
                  <div className="mt-2 h-2.5 overflow-hidden rounded-sm border border-slate-300 bg-slate-100">
                    <div
                      className={cn("h-full rounded-sm", isCurrentStage ? "bg-brand-600/80" : "bg-brand-500/65")}
                      style={{ width: `${Math.max(0, Math.min(100, segment.fillPercent))}%` }}
                    />
                  </div>
                  <p className="mt-2 text-xs text-slate-600">{formatMeterRange(segment.startM, segment.endM)}</p>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

export function TransactionDetailPanel({
  open,
  selectedTransaction,
  transactionPanelOpen,
  transactionNotice,
  transactionError,
  transactionEditMode,
  transactionEditDate,
  transactionEditMerchant,
  transactionSaving,
  onClose,
  onEditDateChange,
  onEditMerchantChange,
  onSave,
  onStartEdit,
  onCancelEdit
}: {
  open: boolean;
  selectedTransaction: SpendingTransactionRow | null;
  transactionPanelOpen: boolean;
  transactionNotice: string | null;
  transactionError: string | null;
  transactionEditMode: boolean;
  transactionEditDate: string;
  transactionEditMerchant: string;
  transactionSaving: boolean;
  onClose: () => void;
  onEditDateChange: (value: string) => void;
  onEditMerchantChange: (value: string) => void;
  onSave: () => void;
  onStartEdit: () => void;
  onCancelEdit: () => void;
}) {
  if (!open || !selectedTransaction || !transactionPanelOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[82]">
      <button
        type="button"
        onClick={onClose}
        className="absolute inset-0 bg-slate-900/30 backdrop-blur-[1px]"
        aria-label="Close transaction panel"
      />
      <aside className="absolute right-0 top-0 h-full w-full max-w-md overflow-y-auto border-l border-slate-200 bg-white p-4 shadow-[0_24px_64px_rgba(15,23,42,0.24)] sm:p-5">
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Transaction</p>
            <p className="text-lg font-semibold text-ink-900">{selectedTransaction.merchant}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 text-slate-600 transition-colors hover:bg-slate-50"
            aria-label="Close"
          >
            <X size={14} />
          </button>
        </div>

        <div className="mt-4 space-y-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Amount</p>
            <p className="mt-1 text-3xl font-semibold tracking-tight text-ink-900">{formatCurrency(selectedTransaction.amount)}</p>
          </div>

          {transactionNotice ? (
            <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">{transactionNotice}</p>
          ) : null}
          {transactionError ? (
            <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{transactionError}</p>
          ) : null}

          {transactionEditMode ? (
            <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50/60 p-3">
              <div>
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Date</label>
                <input
                  type="date"
                  value={transactionEditDate}
                  onChange={(event) => onEditDateChange(event.target.value)}
                  className="mt-1 h-10 w-full rounded-md border border-slate-300 px-2 text-sm text-ink-900"
                />
              </div>
              <div>
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Merchant</label>
                <input
                  value={transactionEditMerchant}
                  onChange={(event) => onEditMerchantChange(event.target.value)}
                  className="mt-1 h-10 w-full rounded-md border border-slate-300 px-2 text-sm text-ink-900"
                />
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onSave}
                  disabled={transactionSaving}
                  className={cn("gf-btn-primary px-3 py-1.5 text-sm", transactionSaving && "cursor-not-allowed opacity-60")}
                >
                  {transactionSaving ? "Saving..." : "Save transaction"}
                </button>
                <button type="button" onClick={onCancelEdit} className="gf-btn-subtle px-3 py-1.5 text-sm">
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50/60 p-3">
              <DetailRow label="Date" value={formatTransactionGroupDate(selectedTransaction.date)} />
              <DetailRow label="Merchant" value={selectedTransaction.merchant} />
              <DetailRow label="Category" value={selectedTransaction.category} />
              <DetailRow label="Requisition" value={selectedTransaction.requisitionCode} />
            </div>
          )}

          {!selectedTransaction.editable ? (
            <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              This legacy transaction cannot be edited here.
            </p>
          ) : null}

          {!transactionEditMode && selectedTransaction.editable ? (
            <button
              type="button"
              onClick={onStartEdit}
              className="inline-flex items-center gap-1 rounded-full border border-slate-300 px-3 py-1.5 text-sm font-medium text-ink-900 transition-colors hover:bg-slate-50"
            >
              <Pencil size={13} />
              Edit transaction
            </button>
          ) : null}
        </div>
      </aside>
    </div>
  );
}
