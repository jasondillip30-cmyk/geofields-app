"use client";

import type { Dispatch, PointerEvent as ReactPointerEvent, RefObject, SetStateAction } from "react";
import Link from "next/link";

import { InputField } from "@/components/inventory/receipt-intake-panel-fields";
import { formatPercent } from "@/components/inventory/receipt-intake-scan-utils";
import type {
  ExtractState,
  IntakeAllocationStatus,
  QrCropSelection,
  ReceiptCaptureMode,
  ReceiptFollowUpStage,
  ReceiptWorkflowChoice,
  ReviewState
} from "@/components/inventory/receipt-intake-panel-types";

export function ReceiptIntakeScanStep({
  manualInputSelected,
  handleReceiptCaptureModeChange,
  lastSavedAllocationStatus,
  requisitionContextLocked,
  initialRequisition,
  activeWorkflowChoice,
  applyWorkflowChoice,
  receiptFile,
  extracting,
  receiptWorkflowChoice,
  extractState,
  handleReceiptFileChange,
  handleExtract,
  canManage,
  autoSaveEnabled,
  setAutoSaveEnabled,
  manualQrAssistEnabled,
  setManualQrAssistEnabled,
  clearQrAssistSelection,
  canPreviewReceiptImage,
  receiptPreviewUrl,
  qrPreviewContainerRef,
  handleQrPointerDown,
  handleQrPointerMove,
  handleQrPointerUp,
  qrAssistSelection,
  debugMode,
  setDebugMode,
  review,
  mismatchDetected,
  showScannedDetails,
  setShowScannedDetails,
  setReview,
  setFollowUpStage,
  resetScanSessionState
}: {
  manualInputSelected: boolean;
  handleReceiptCaptureModeChange: (mode: ReceiptCaptureMode) => void;
  lastSavedAllocationStatus: IntakeAllocationStatus | null;
  requisitionContextLocked: boolean;
  initialRequisition:
    | {
        id: string;
        requisitionCode: string;
      }
    | null
    | undefined;
  activeWorkflowChoice: ReceiptWorkflowChoice | "";
  applyWorkflowChoice: (choice: ReceiptWorkflowChoice) => void;
  receiptFile: File | null;
  extracting: boolean;
  receiptWorkflowChoice: ReceiptWorkflowChoice | "" | null;
  extractState: ExtractState;
  handleReceiptFileChange: (file: File | null) => void;
  handleExtract: (opts?: { userInitiated?: boolean }) => Promise<void>;
  canManage: boolean;
  autoSaveEnabled: boolean;
  setAutoSaveEnabled: (value: boolean) => void;
  manualQrAssistEnabled: boolean;
  setManualQrAssistEnabled: (value: boolean) => void;
  clearQrAssistSelection: () => void;
  canPreviewReceiptImage: boolean;
  receiptPreviewUrl: string;
  qrPreviewContainerRef: RefObject<HTMLDivElement | null>;
  handleQrPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  handleQrPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  handleQrPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => void;
  qrAssistSelection: QrCropSelection | null;
  debugMode: boolean;
  setDebugMode: (value: boolean) => void;
  review: ReviewState | null;
  mismatchDetected: boolean;
  showScannedDetails: boolean;
  setShowScannedDetails: Dispatch<SetStateAction<boolean>>;
  setReview: Dispatch<SetStateAction<ReviewState | null>>;
  setFollowUpStage: (stage: ReceiptFollowUpStage) => void;
  resetScanSessionState: () => void;
}) {
  return (
    <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
      <p className="text-sm font-semibold text-slate-900">Step 1: Enter receipt details</p>
      <div className="grid gap-2 sm:grid-cols-2">
        <button
          type="button"
          onClick={() => handleReceiptCaptureModeChange("SCAN")}
          className={`rounded-lg border px-3 py-2 text-left text-sm font-semibold ${
            !manualInputSelected
              ? "border-brand-300 bg-brand-50 text-brand-900"
              : "border-slate-200 bg-white text-slate-700 hover:bg-slate-100"
          }`}
        >
          Scan receipt
        </button>
        <button
          type="button"
          onClick={() => handleReceiptCaptureModeChange("MANUAL")}
          className={`rounded-lg border px-3 py-2 text-left text-sm font-semibold ${
            manualInputSelected
              ? "border-brand-300 bg-brand-50 text-brand-900"
              : "border-slate-200 bg-white text-slate-700 hover:bg-slate-100"
          }`}
        >
          Manual intake
        </button>
      </div>
      {lastSavedAllocationStatus && lastSavedAllocationStatus !== "ALLOCATED" && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-amber-900">
          <span className="rounded-full border border-amber-300 bg-amber-100 px-2 py-0.5 font-semibold">
            Context link incomplete
          </span>
          <span>Saved with incomplete project/client linkage. You can complete context later.</span>
          <Link href="/inventory" className="rounded border border-amber-400 bg-white px-2 py-1 font-semibold hover:bg-amber-100">
            Open inventory
          </Link>
        </div>
      )}
      {requisitionContextLocked ? (
        <p className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs text-indigo-900">
          Approved requisition{" "}
          <span className="font-semibold">{initialRequisition?.requisitionCode || initialRequisition?.id.slice(-8)}</span> is already linked.
        </p>
      ) : (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Receipt workflow type</p>
          <div className="mt-2 grid gap-2 md:grid-cols-2">
            {(
              [
                ["PROJECT_PURCHASE", "Project Purchase"],
                ["MAINTENANCE_PURCHASE", "Maintenance Purchase"],
                ["STOCK_PURCHASE", "Stock Purchase (Inventory)"],
                ["INTERNAL_TRANSFER", "Internal Transfer"]
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => applyWorkflowChoice(value)}
                className={`rounded-lg border px-3 py-2 text-sm font-semibold ${
                  activeWorkflowChoice === value
                    ? "border-brand-300 bg-brand-50 text-brand-800"
                    : "border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}
      {!manualInputSelected && (
        <>
          <div className="grid gap-3 lg:grid-cols-[1fr_auto] lg:items-end">
            <label className="text-xs text-ink-700">
              <span className="mb-1 block uppercase tracking-wide text-slate-500">Receipt File (Image or PDF)</span>
              <input
                type="file"
                accept="image/*,.pdf"
                capture="environment"
                onChange={(event) => handleReceiptFileChange(event.target.files?.[0] || null)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              />
            </label>
            <button
              type="button"
              onClick={() => void handleExtract({ userInitiated: true })}
              disabled={!receiptFile || extracting || !receiptWorkflowChoice}
              className="gf-btn-primary"
            >
              {extractState === "UPLOADING" ? "Capturing..." : extractState === "PROCESSING" ? "Reading..." : "Scan Receipt"}
            </button>
          </div>
          {canManage ? (
            <label className="inline-flex items-center gap-2 text-xs text-slate-700">
              <input type="checkbox" checked={autoSaveEnabled} onChange={(event) => setAutoSaveEnabled(event.target.checked)} />
              Auto-save when confidence is high
            </label>
          ) : (
            <p className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-900">
              Saved as pending review until manager/admin finalization.
            </p>
          )}
          <details className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
            <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-slate-600">
              Advanced scan tools
            </summary>
            <div className="mt-2 space-y-2">
              <label className="inline-flex items-center gap-2 text-xs text-slate-700">
                <input
                  type="checkbox"
                  checked={manualQrAssistEnabled}
                  onChange={(event) => {
                    setManualQrAssistEnabled(event.target.checked);
                    if (!event.target.checked) {
                      clearQrAssistSelection();
                    }
                  }}
                />
                Manual QR assist: select the QR area and retry scan if automatic detection misses it.
              </label>

              {manualQrAssistEnabled && receiptFile && !canPreviewReceiptImage && (
                <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                  Manual QR selection currently works with receipt images. For PDFs, we still run QR/OCR automatically.
                </p>
              )}

              {manualQrAssistEnabled && canPreviewReceiptImage && (
                <div className="space-y-2 rounded-lg border border-slate-200 bg-white p-3">
                  <p className="text-xs text-slate-700">
                    Drag on the receipt preview to mark the QR area. We prioritize this region, then fall back to OCR.
                  </p>
                  <div
                    ref={qrPreviewContainerRef}
                    onPointerDown={handleQrPointerDown}
                    onPointerMove={handleQrPointerMove}
                    onPointerUp={handleQrPointerUp}
                    onPointerCancel={handleQrPointerUp}
                    className="relative overflow-hidden rounded-lg border border-slate-300 bg-white"
                    style={{ touchAction: "none" }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={receiptPreviewUrl} alt="Receipt preview" className="max-h-[320px] w-full select-none object-contain" draggable={false} />
                    {qrAssistSelection && (
                      <div
                        className="pointer-events-none absolute border-2 border-brand-500 bg-brand-500/15"
                        style={{
                          left: `${qrAssistSelection.x * 100}%`,
                          top: `${qrAssistSelection.y * 100}%`,
                          width: `${qrAssistSelection.width * 100}%`,
                          height: `${qrAssistSelection.height * 100}%`
                        }}
                      />
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-700">
                    <button
                      type="button"
                      onClick={clearQrAssistSelection}
                      className="rounded border border-slate-300 bg-white px-2 py-1 text-slate-700 hover:bg-slate-100"
                    >
                      Clear QR Area
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleExtract({ userInitiated: true })}
                      disabled={!receiptFile || !qrAssistSelection || extracting || !receiptWorkflowChoice}
                      className="rounded border border-brand-300 bg-brand-50 px-2 py-1 font-semibold text-brand-800 hover:bg-brand-100 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Retry With Selected QR Area
                    </button>
                    <span>
                      {qrAssistSelection
                        ? `Selected area: x ${formatPercent(qrAssistSelection.x)}, y ${formatPercent(qrAssistSelection.y)}, w ${formatPercent(qrAssistSelection.width)}, h ${formatPercent(qrAssistSelection.height)}`
                        : "No manual QR area selected yet."}
                    </span>
                  </div>
                </div>
              )}

              {process.env.NODE_ENV !== "production" && (
                <label className="inline-flex items-center gap-2 text-xs text-slate-600">
                  <input type="checkbox" checked={debugMode} onChange={(event) => setDebugMode(event.target.checked)} />
                  Include OCR debug candidates (development only)
                </label>
              )}
            </div>
          </details>
        </>
      )}
      {manualInputSelected && (
        <div className="space-y-2 rounded-lg border border-slate-200/70 bg-slate-50/70 p-3">
          {review ? (
            <>
              {mismatchDetected && (
                <div className="rounded-lg border border-rose-200/80 bg-rose-50/70 px-3 py-2 text-sm text-rose-900">
                  <p className="font-semibold">Receipt does not match requisition</p>
                  <p className="mt-1 text-xs">Review scanned receipt details or complete receipt fields manually.</p>
                  <div className="mt-2">
                    <button
                      type="button"
                      onClick={() => setShowScannedDetails((current) => !current)}
                      className="rounded-md border border-rose-300/80 bg-white px-2.5 py-1 text-xs font-medium text-rose-900 hover:bg-rose-100/70"
                    >
                      {showScannedDetails ? "Hide scanned receipt" : "Review scanned receipt"}
                    </button>
                  </div>
                </div>
              )}
              <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
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
                <InputField
                  label="Receipt Reference"
                  value={review.receiptUrl}
                  onChange={(value) => setReview((current) => (current ? { ...current, receiptUrl: value } : current))}
                  compact
                />
              </div>
              {review.receiptUrl && (
                <a
                  href={review.receiptUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex rounded-md border border-slate-300/80 bg-white px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                >
                  Open Uploaded Receipt Reference
                </a>
              )}
            </>
          ) : (
            <p className="text-xs text-slate-600">Manual intake is ready. Complete receipt fields to continue.</p>
          )}
        </div>
      )}
      {review && !manualInputSelected && mismatchDetected && (
        <div className="rounded-lg border border-rose-200/80 bg-rose-50/70 px-3 py-2 text-sm text-rose-900">
          <p className="font-semibold">Receipt does not match requisition</p>
          <p className="mt-1 text-xs">Review scanned receipt details or switch to manual intake.</p>
          <button
            type="button"
            onClick={() => setShowScannedDetails((current) => !current)}
            className="mt-2 rounded-md border border-rose-300/80 bg-white px-2.5 py-1 text-xs font-medium text-rose-900 hover:bg-rose-100/70"
          >
            {showScannedDetails ? "Hide scanned receipt" : "Review scanned receipt"}
          </button>
        </div>
      )}
      {review && (
        <div className="flex flex-wrap items-center gap-2 border-t border-slate-200 pt-2">
          <button type="button" onClick={() => setFollowUpStage("REVIEW")} className="gf-btn-primary">
            Continue to items
          </button>
          {!manualInputSelected && (
            <button
              type="button"
              onClick={() => {
                setReview(null);
                resetScanSessionState();
                setFollowUpStage("SCAN");
              }}
              className="gf-btn-secondary"
            >
              Rescan
            </button>
          )}
        </div>
      )}
    </div>
  );
}
