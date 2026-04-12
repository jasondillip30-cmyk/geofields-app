"use client";

import {
  RecordLinkedRows,
  RecordSummaryGrid,
  formatLinkedRecordType,
  type FocusedLinkedRecord
} from "@/components/inventory/receipt-intake-panel-fields";

interface FocusedRecordPayload {
  record: FocusedLinkedRecord;
  details: Record<string, unknown>;
}

interface ReceiptIntakeFocusedOverlayProps {
  focusedOverlayMounted: boolean;
  focusedOverlayVisible: boolean;
  closeFocusedRecordOverlay: () => void;
  focusedRecordPayload: FocusedRecordPayload | null;
  focusedRecordLoading: boolean;
  focusedRecordError: string | null;
  extractReceiptPurposeFromDetails: (details: Record<string, unknown>) => string;
}

export function ReceiptIntakeFocusedOverlay({
  focusedOverlayMounted,
  focusedOverlayVisible,
  closeFocusedRecordOverlay,
  focusedRecordPayload,
  focusedRecordLoading,
  focusedRecordError,
  extractReceiptPurposeFromDetails
}: ReceiptIntakeFocusedOverlayProps) {
  if (!focusedOverlayMounted) {
    return null;
  }

  return (
    <div
      className={`fixed inset-0 z-[90] flex transition-opacity duration-200 ease-out ${
        focusedOverlayVisible ? "opacity-100" : "pointer-events-none opacity-0"
      }`}
    >
      <button
        type="button"
        onClick={closeFocusedRecordOverlay}
        className={`flex-1 bg-slate-900/35 backdrop-blur-[2px] transition-opacity duration-200 ${
          focusedOverlayVisible ? "opacity-100" : "opacity-0"
        }`}
        aria-label="Close focused record detail"
      />
      <aside
        className={`h-full w-full max-w-3xl overflow-y-auto border-l border-slate-200 bg-white shadow-[0_18px_42px_rgba(15,23,42,0.22)] transition-transform duration-200 ease-out ${
          focusedOverlayVisible ? "translate-x-0" : "translate-x-3"
        }`}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3">
          <div>
            <p className="text-sm font-semibold text-ink-900">
              {focusedRecordPayload?.record.label || "Linked Record Detail"}
            </p>
            <p className="text-xs text-slate-600">
              Focused full-view detail
            </p>
          </div>
          <button
            type="button"
            onClick={closeFocusedRecordOverlay}
            className="rounded border border-slate-300 bg-white px-2 py-1 text-xs text-ink-700 hover:bg-slate-100"
          >
            Close
          </button>
        </div>
        <div className="space-y-3 p-4 text-sm">
          {focusedRecordLoading && <p className="text-ink-600">Loading linked record details...</p>}
          {focusedRecordError && (
            <p className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-amber-900">{focusedRecordError}</p>
          )}
          {focusedRecordPayload && (
            <>
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                <p><span className="font-semibold">Record type:</span> {formatLinkedRecordType(focusedRecordPayload.record.type)}</p>
                <p><span className="font-semibold">Record ID:</span> {focusedRecordPayload.record.id}</p>
                <p><span className="font-semibold">Receipt Purpose:</span> {extractReceiptPurposeFromDetails(focusedRecordPayload.details)}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <a
                  href={focusedRecordPayload.record.url}
                  className="rounded border border-brand-300 bg-brand-50 px-3 py-1.5 text-xs font-semibold text-brand-800 hover:bg-brand-100"
                >
                  Open in module
                </a>
                {focusedRecordPayload.record.type === "EXPENSE" && (
                  <a
                    href={`/expenses?expenseId=${focusedRecordPayload.record.id}`}
                    className="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs text-ink-700 hover:bg-slate-100"
                  >
                    Edit expense
                  </a>
                )}
              </div>
              <RecordSummaryGrid details={focusedRecordPayload.details} />
              <RecordLinkedRows details={focusedRecordPayload.details} />
            </>
          )}
        </div>
      </aside>
    </div>
  );
}
