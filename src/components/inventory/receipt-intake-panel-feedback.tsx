"use client";

import type { Dispatch, SetStateAction } from "react";

import type { NoticeTone, ScanDiagnosticsState } from "@/components/inventory/receipt-intake-panel-types";

interface ReceiptIntakePanelFeedbackProps {
  actionToast: {
    tone: "SUCCESS" | "WARNING" | "ERROR";
    message: string;
    actionLabel: string;
  } | null;
  setActionToast: Dispatch<
    SetStateAction<{
      tone: "SUCCESS" | "WARNING" | "ERROR";
      message: string;
      actionLabel: string;
    } | null>
  >;
  notice: string | null;
  error: string | null;
  noticeTone: NoticeTone;
  showDeveloperDebugUi: boolean;
  panelRenderTimestamp: string;
  hasScanAttempted: boolean;
  visibleScanDiagnostics: ScanDiagnosticsState | null;
}

export function ReceiptIntakePanelFeedback({
  actionToast,
  setActionToast,
  notice,
  error,
  noticeTone,
  showDeveloperDebugUi,
  panelRenderTimestamp,
  hasScanAttempted,
  visibleScanDiagnostics
}: ReceiptIntakePanelFeedbackProps) {
  return (
    <>
      {actionToast && (
        <aside className="pointer-events-none fixed bottom-5 right-5 z-[91] w-[min(440px,calc(100vw-2rem))]">
          <div
            className={`pointer-events-auto rounded-2xl border px-3.5 py-3 shadow-[0_16px_36px_rgba(15,23,42,0.16)] backdrop-blur-sm ${
              actionToast.tone === "SUCCESS"
                ? "border-emerald-200 bg-white/95 text-emerald-900"
                : actionToast.tone === "ERROR"
                  ? "border-red-200 bg-white/95 text-red-900"
                  : "border-amber-200 bg-white/95 text-amber-900"
            }`}
          >
            <p className="text-xs font-semibold uppercase tracking-wide">{actionToast.actionLabel}</p>
            <p className="mt-1 text-sm leading-5">{actionToast.message}</p>
            <button
              type="button"
              onClick={() => setActionToast(null)}
              className="mt-2 text-xs font-semibold underline underline-offset-2"
            >
              Dismiss
            </button>
          </div>
        </aside>
      )}
      {(notice || error) && (
        <p
          className={`rounded-lg px-3 py-2 text-sm ${
            !error && noticeTone === "SUCCESS"
              ? "border border-emerald-200 bg-emerald-50 text-emerald-800"
              : "border border-amber-300 bg-amber-50 text-amber-900"
          }`}
        >
          {error || notice}
        </p>
      )}
      {showDeveloperDebugUi && (
        <section className="rounded-xl border-2 border-fuchsia-600 bg-fuchsia-100 px-3 py-3 text-sm text-fuchsia-950 shadow-sm">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-fuchsia-900">
            receipt-follow-up debug build active
          </p>
          <p className="mt-1 text-base font-black uppercase tracking-wide text-fuchsia-900">
            RECEIPT INTAKE PANEL RENDERED
          </p>
          <div className="mt-2 grid gap-1 sm:grid-cols-2">
            <p>
              component name: <span className="font-semibold">ReceiptIntakePanel</span>
            </p>
            <p>
              page path: <span className="font-semibold">/purchasing/receipt-follow-up</span>
            </p>
            <p>
              current timestamp at render: <span className="font-semibold">{panelRenderTimestamp}</span>
            </p>
            <p>
              version: <span className="font-semibold">receipt-follow-up-debug-v1</span>
            </p>
          </div>
          <div className="mt-3 rounded-lg border-2 border-fuchsia-500 bg-white p-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-fuchsia-900">RAW QR DEBUG PANEL</p>
            <div className="mt-2 grid gap-1 sm:grid-cols-2">
              <p>
                hasScanAttempted: <span className="font-medium">{hasScanAttempted ? "true" : "false"}</span>
              </p>
              <p>
                qrDetected:{" "}
                <span className="font-medium">
                  {visibleScanDiagnostics ? (visibleScanDiagnostics.qrDetected ? "true" : "false") : "not attempted"}
                </span>
              </p>
              <p>
                qrDecodeStatus:{" "}
                <span className="font-medium">{visibleScanDiagnostics?.qrDecodeStatus || "NOT_ATTEMPTED"}</span>
              </p>
              <p>
                qrRawLength: <span className="font-medium">{visibleScanDiagnostics?.qrRawLength ?? 0}</span>
              </p>
              <p>
                qrRawPayloadFormat:{" "}
                <span className="font-medium">{visibleScanDiagnostics?.qrRawPayloadFormat || "NOT_ATTEMPTED"}</span>
              </p>
              <p>
                qrRawPreview:{" "}
                <span className="font-medium">{visibleScanDiagnostics?.qrRawPreview || "(not attempted)"}</span>
              </p>
            </div>
            <div className="mt-2 rounded border-2 border-fuchsia-300 bg-slate-50 p-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-fuchsia-900">full raw qrRawValue</p>
              <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded border border-slate-200 bg-white p-2 text-xs text-slate-900">
                {visibleScanDiagnostics?.qrRawValue || "(not attempted)"}
              </pre>
            </div>
          </div>
        </section>
      )}
    </>
  );
}
