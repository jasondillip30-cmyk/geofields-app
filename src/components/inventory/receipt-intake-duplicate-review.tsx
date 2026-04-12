"use client";

import type { Dispatch, SetStateAction } from "react";

import {
  DuplicateLinksGroup,
  type FocusedLinkedRecord,
  type LinkedRecordType
} from "@/components/inventory/receipt-intake-panel-fields";
import type { DuplicatePromptState, ReviewState } from "@/components/inventory/receipt-intake-panel-types";

interface ReceiptIntakeDuplicateReviewProps {
  duplicatePrompt: DuplicatePromptState | null;
  duplicateConfidence: string;
  duplicateIsHighConfidence: boolean;
  showDuplicateReview: boolean;
  setShowDuplicateReview: Dispatch<SetStateAction<boolean>>;
  duplicateOverrideConfirmed: boolean;
  setDuplicateOverrideConfirmed: Dispatch<SetStateAction<boolean>>;
  canOverrideDuplicate: boolean;
  canManage: boolean;
  commitReview: (nextReview: ReviewState, options: { auto: boolean; allowDuplicateSave?: boolean }) => Promise<void>;
  openFocusedRecord: (record: FocusedLinkedRecord) => Promise<void>;
  setDuplicatePrompt: Dispatch<SetStateAction<DuplicatePromptState | null>>;
  formatCurrency: (value: number) => string;
  formatDateTimeText: (value?: string | null) => string;
  formatReceiptPurposeLabel: (value: string) => string;
}

export function ReceiptIntakeDuplicateReview({
  duplicatePrompt,
  duplicateConfidence,
  duplicateIsHighConfidence,
  showDuplicateReview,
  setShowDuplicateReview,
  duplicateOverrideConfirmed,
  setDuplicateOverrideConfirmed,
  canOverrideDuplicate,
  canManage,
  commitReview,
  openFocusedRecord,
  setDuplicatePrompt,
  formatCurrency,
  formatDateTimeText,
  formatReceiptPurposeLabel
}: ReceiptIntakeDuplicateReviewProps) {
  if (!duplicatePrompt) {
    return null;
  }

  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-3 text-sm text-amber-900">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-semibold">{duplicatePrompt.message}</p>
        <span
          className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
            duplicateIsHighConfidence
              ? "border-red-300 bg-red-100 text-red-800"
              : "border-amber-300 bg-amber-100 text-amber-900"
          }`}
        >
          Duplicate confidence: {duplicateConfidence}
        </span>
      </div>
      <p className="mt-1 text-xs text-amber-900">
        Current receipt data closely matches a previously processed receipt. Review the prior record relationship before deciding.
      </p>
      {duplicatePrompt.matches.length > 0 && (
        <div className="mt-2 space-y-1 text-xs">
          {duplicatePrompt.matches.slice(0, 3).map((match) => (
            <p key={`${match.source}-${match.id}`}>
              {match.source === "expense" ? "Expense" : "Stock movement"} {match.id.slice(-8)} • {match.reason}
            </p>
          ))}
        </div>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setShowDuplicateReview((current) => !current)}
          className="rounded border border-amber-400 bg-white px-3 py-1.5 text-xs font-semibold text-amber-900 hover:bg-amber-100"
        >
          {showDuplicateReview ? "Hide duplicate review" : "Review duplicate"}
        </button>
        {!duplicateIsHighConfidence || canManage ? (
          <label className="inline-flex items-center gap-2 rounded border border-amber-300 bg-white px-2 py-1 text-xs text-amber-900">
            <input
              type="checkbox"
              checked={duplicateOverrideConfirmed}
              onChange={(event) => setDuplicateOverrideConfirmed(event.target.checked)}
            />
            {duplicateIsHighConfidence
              ? "I confirm this is intentional and should override duplicate protection"
              : "I understand and want to continue anyway"}
          </label>
        ) : (
          <span className="rounded border border-red-300 bg-red-50 px-2 py-1 text-xs text-red-800">
            High-confidence duplicates require manager/admin override.
          </span>
        )}
        <button
          type="button"
          onClick={() =>
            void commitReview(duplicatePrompt.reviewSnapshot, {
              auto: duplicatePrompt.auto,
              allowDuplicateSave: true
            })
          }
          disabled={!canOverrideDuplicate}
          className="rounded border border-brand-300 bg-brand-50 px-3 py-1.5 text-xs font-semibold text-brand-800 hover:bg-brand-100 disabled:cursor-not-allowed disabled:opacity-60"
        >
          Override duplicate and continue
        </button>
        <button
          type="button"
          onClick={() => {
            setDuplicatePrompt(null);
            setShowDuplicateReview(false);
            setDuplicateOverrideConfirmed(false);
          }}
          className="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-100"
        >
          Cancel
        </button>
      </div>
      {showDuplicateReview && (
        <div className="mt-3 space-y-3 rounded-lg border border-amber-300 bg-white p-3 text-xs text-slate-800">
          <p className="text-sm font-semibold text-slate-900">Duplicate Receipt Review</p>
          {duplicatePrompt.review ? (
            <>
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                <p><span className="font-semibold">Supplier:</span> {duplicatePrompt.review.summary.supplierName || "-"}</p>
                <p><span className="font-semibold">Receipt #:</span> {duplicatePrompt.review.summary.receiptNumber || "-"}</p>
                <p><span className="font-semibold">Verification:</span> {duplicatePrompt.review.summary.verificationCode || "-"}</p>
                <p><span className="font-semibold">Serial #:</span> {duplicatePrompt.review.summary.serialNumber || "-"}</p>
                <p><span className="font-semibold">Receipt Date:</span> {duplicatePrompt.review.summary.receiptDate || "-"}</p>
                <p><span className="font-semibold">TRA Receipt #:</span> {duplicatePrompt.review.summary.traReceiptNumber || "-"}</p>
                <p><span className="font-semibold">Total:</span> {formatCurrency(duplicatePrompt.review.summary.total || 0)}</p>
                <p><span className="font-semibold">Processed:</span> {formatDateTimeText(duplicatePrompt.review.summary.processedAt)}</p>
                <p><span className="font-semibold">Confidence:</span> {duplicatePrompt.review.summary.duplicateConfidence}</p>
                <p><span className="font-semibold">Receipt Purpose:</span> {formatReceiptPurposeLabel(duplicatePrompt.review.summary.receiptPurpose)}</p>
              </div>
              <div className="rounded border border-slate-200 bg-slate-50 px-2 py-1.5">
                <p className="font-semibold">Match reason</p>
                <p className="mt-0.5">{duplicatePrompt.review.summary.matchReason || "-"}</p>
                {duplicatePrompt.review.summary.matchedFields.length > 0 && (
                  <p className="mt-1 text-slate-600">
                    Matched fields: {duplicatePrompt.review.summary.matchedFields.join(", ")}
                  </p>
                )}
              </div>
              {duplicatePrompt.review.primaryRecord && (
                <div className="rounded border border-emerald-300 bg-emerald-50 px-2 py-1.5 text-emerald-900">
                  <p className="font-semibold">Primary prior receipt record</p>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <span>{duplicatePrompt.review.primaryRecord.label}</span>
                    <button
                      type="button"
                      onClick={() =>
                        void openFocusedRecord({
                          id: duplicatePrompt.review?.primaryRecord?.id || "",
                          label: duplicatePrompt.review?.primaryRecord?.label || "Primary record",
                          type: (duplicatePrompt.review?.primaryRecord?.type || "RECEIPT_INTAKE") as LinkedRecordType,
                          url: duplicatePrompt.review?.primaryRecord?.url || "/inventory"
                        })
                      }
                      className="rounded border border-emerald-400 bg-white px-2 py-1 font-semibold hover:bg-emerald-100"
                    >
                      {duplicatePrompt.review.primaryRecord.type === "EXPENSE"
                        ? "Open expense record"
                        : duplicatePrompt.review.primaryRecord.type === "INVENTORY_ITEM"
                          ? "Open inventory item"
                          : "Open receipt intake"}
                    </button>
                  </div>
                </div>
              )}
              <div className="grid gap-2 sm:grid-cols-2">
                <DuplicateLinksGroup
                  title="Receipt intake record"
                  emptyLabel="No receipt intake record linked"
                  links={duplicatePrompt.review.linkedRecords.receiptIntake}
                  buttonLabel="Open receipt intake"
                  onOpen={(link) => void openFocusedRecord(link)}
                />
                <DuplicateLinksGroup
                  title="Inventory items created"
                  emptyLabel="No linked inventory items"
                  links={duplicatePrompt.review.linkedRecords.inventoryItems}
                  buttonLabel="Open inventory item"
                  onOpen={(link) => void openFocusedRecord(link)}
                />
                <DuplicateLinksGroup
                  title="Stock movements created"
                  emptyLabel="No linked stock movements"
                  links={duplicatePrompt.review.linkedRecords.stockMovements}
                  buttonLabel="Open stock movement"
                  onOpen={(link) => void openFocusedRecord(link)}
                />
                <DuplicateLinksGroup
                  title="Expense records created"
                  emptyLabel="No linked expenses"
                  links={duplicatePrompt.review.linkedRecords.expenses}
                  buttonLabel="Open expense record"
                  onOpen={(link) => void openFocusedRecord(link)}
                />
              </div>
            </>
          ) : (
            <p>Duplicate details are available. You can still save anyway if this is intentional.</p>
          )}
        </div>
      )}
    </div>
  );
}
