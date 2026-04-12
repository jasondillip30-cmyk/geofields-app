"use client";

import { InputField } from "@/components/inventory/receipt-intake-panel-fields";
import type { ReviewState } from "@/components/inventory/receipt-intake-panel-types";

export function ReceiptIntakeFinalizeStep({
  review,
  mismatchDetected,
  canInspectScannedDetails,
  showScannedDetails,
  setShowScannedDetails,
  setReview,
  showFinalizePostingOptions,
  setShowFinalizePostingOptions,
  formatMoneyText
}: {
  review: ReviewState;
  mismatchDetected: boolean;
  canInspectScannedDetails: boolean;
  showScannedDetails: boolean;
  setShowScannedDetails: (updater: (current: boolean) => boolean) => void;
  setReview: (updater: (current: ReviewState | null) => ReviewState | null) => void;
  showFinalizePostingOptions: boolean;
  setShowFinalizePostingOptions: (updater: (current: boolean) => boolean) => void;
  formatMoneyText: (value: string, currency: string) => string;
}) {
  return (
    <div className="space-y-1.5">
      <p className="text-sm font-semibold text-slate-900">Step 4: Review and finalize posting</p>
      {mismatchDetected && (
        <div className="rounded-lg border border-rose-200/70 bg-rose-50/70 px-3 py-2 text-xs text-rose-900">
          <p className="font-semibold">Receipt does not match requisition</p>
          <p className="mt-0.5">Manual receipt details are being used for final posting.</p>
          {canInspectScannedDetails && (
            <button
              type="button"
              onClick={() => setShowScannedDetails((current) => !current)}
              className="mt-1 rounded border border-rose-300/80 bg-white px-2 py-0.5 text-[11px] font-semibold hover:bg-rose-100/70"
            >
              {showScannedDetails ? "Hide scanned receipt" : "Review scanned receipt"}
            </button>
          )}
        </div>
      )}
      {mismatchDetected && (
        <div className="space-y-1 rounded-lg border border-slate-200/55 bg-white px-2.5 py-1.5">
          <p className="text-[13px] font-semibold text-slate-900">Manual Receipt Details</p>
          <div className="grid gap-1.5 md:grid-cols-2 xl:grid-cols-3">
            <InputField
              label="Receipt Number"
              value={review.receiptNumber}
              onChange={(value) => setReview((current) => (current ? { ...current, receiptNumber: value } : current))}
              compact
            />
            <InputField
              label="Control / TRA Number"
              value={review.traReceiptNumber}
              onChange={(value) => setReview((current) => (current ? { ...current, traReceiptNumber: value } : current))}
              compact
            />
            <InputField
              label="Verification / Auth Code"
              value={review.verificationCode}
              onChange={(value) => setReview((current) => (current ? { ...current, verificationCode: value } : current))}
              compact
            />
            <InputField
              label="TIN"
              value={review.tin}
              onChange={(value) => setReview((current) => (current ? { ...current, tin: value } : current))}
              compact
            />
            <InputField
              label="Verification URL"
              value={review.verificationUrl}
              onChange={(value) => setReview((current) => (current ? { ...current, verificationUrl: value } : current))}
              compact
            />
            <InputField
              label="Receipt Date"
              type="date"
              value={review.receiptDate}
              onChange={(value) => setReview((current) => (current ? { ...current, receiptDate: value } : current))}
              compact
            />
          </div>
        </div>
      )}
      {mismatchDetected && (
        <div className="space-y-1 rounded-lg border border-slate-200/55 bg-white px-2.5 py-1.5">
          <p className="text-sm font-semibold text-ink-900">Requisition Line Items</p>
          {review.lines.length === 0 ? (
            <p className="text-xs text-slate-600">No approved requisition line items are available for this mismatch review.</p>
          ) : (
            <div className="space-y-1">
              {review.lines.map((line) => (
                <div
                  key={`finalize-mismatch-line-${line.id}`}
                  className="rounded-md border border-slate-200/70 bg-white px-2 py-1.5 text-[11px] text-slate-800"
                >
                  <p className="font-semibold leading-4">{line.description || "Line item"}</p>
                  <p className="mt-0.5 text-slate-700">
                    qty {line.quantity || "0"} • unit {line.unitPrice || "0"} • total {line.lineTotal || "0"}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {!mismatchDetected && review.requisitionId && (
        <p className="text-[11px] text-slate-500">
          Requisition <span className="font-medium text-slate-700">{review.requisitionCode || review.requisitionId.slice(-8)}</span>
        </p>
      )}
      <div className="rounded-lg border border-slate-200/60 bg-white px-2.5 py-1.5 text-xs text-slate-700">
        <p className="font-semibold text-slate-900">Finalize Summary</p>
        <div className="mt-1 grid gap-1 sm:grid-cols-2 xl:grid-cols-3">
          <p><span className="font-medium text-slate-800">Requisition:</span> {review.requisitionCode || review.requisitionId || "-"}</p>
          <p><span className="font-medium text-slate-800">Receipt #:</span> {review.receiptNumber || "-"}</p>
          <p><span className="font-medium text-slate-800">Supplier:</span> {review.supplierName || "-"}</p>
          <p><span className="font-medium text-slate-800">Receipt Date:</span> {review.receiptDate || "-"}</p>
          <p><span className="font-medium text-slate-800">TIN:</span> {review.tin || "-"}</p>
          <p><span className="font-medium text-slate-800">Verification URL:</span> {review.verificationUrl || "-"}</p>
          <p><span className="font-medium text-slate-800">Verification Code:</span> {review.verificationCode || "-"}</p>
          <p><span className="font-medium text-slate-800">Total:</span> {formatMoneyText(review.total, review.currency)}</p>
        </div>
      </div>
      {mismatchDetected && (
        <div>
          <button
            type="button"
            onClick={() => setShowFinalizePostingOptions((current) => !current)}
            className="text-[11px] font-medium text-slate-500 underline underline-offset-2 hover:text-slate-700"
          >
            {showFinalizePostingOptions ? "Hide posting options" : "Show posting options"}
          </button>
        </div>
      )}
    </div>
  );
}
