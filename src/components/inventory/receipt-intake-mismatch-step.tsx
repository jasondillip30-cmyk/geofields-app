"use client";

import type { Dispatch, SetStateAction } from "react";

import type { ReceiptFollowUpStage, RequisitionComparisonResult } from "@/components/inventory/receipt-intake-panel-types";
import { DataTable } from "@/components/ui/table";

export function ReceiptIntakeMismatchStep({
  showMismatchFinalizeConfirm,
  setShowMismatchFinalizeConfirm,
  setFollowUpStage,
  showScannedDetails,
  setShowScannedDetails,
  requisitionComparison
}: {
  showMismatchFinalizeConfirm: boolean;
  setShowMismatchFinalizeConfirm: Dispatch<SetStateAction<boolean>>;
  setFollowUpStage: Dispatch<SetStateAction<ReceiptFollowUpStage>>;
  showScannedDetails: boolean;
  setShowScannedDetails: Dispatch<SetStateAction<boolean>>;
  requisitionComparison: RequisitionComparisonResult | null;
}) {
  return (
    <>
      {showMismatchFinalizeConfirm && (
        <div className="fixed inset-0 z-[95] flex items-center justify-center p-4">
          <button
            type="button"
            onClick={() => setShowMismatchFinalizeConfirm(false)}
            className="absolute inset-0 bg-slate-900/35"
            aria-label="Close mismatch confirmation"
          />
          <div className="relative w-full max-w-md rounded-xl border border-slate-200 bg-white p-4 shadow-[0_16px_40px_rgba(15,23,42,0.24)]">
            <p className="text-base font-semibold text-slate-900">Receipt does not match requisition</p>
            <p className="mt-1 text-sm text-slate-600">
              This receipt does not match the approved requisition.
              You are about to continue using manually entered receipt details.
              Proceed?
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowMismatchFinalizeConfirm(false)}
                className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100"
              >
                Go back
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowMismatchFinalizeConfirm(false);
                  setFollowUpStage("FINALIZE");
                }}
                className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-700"
              >
                Continue to finalize
              </button>
            </div>
          </div>
        </div>
      )}

      {showScannedDetails && requisitionComparison && (
        <div className="fixed inset-0 z-[96] flex">
          <button
            type="button"
            onClick={() => setShowScannedDetails(false)}
            className="flex-1 bg-slate-900/35 backdrop-blur-[1px]"
            aria-label="Close scanned receipt details"
          />
          <aside className="h-full w-full max-w-2xl overflow-y-auto border-l border-slate-200 bg-white shadow-[0_18px_42px_rgba(15,23,42,0.22)]">
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3">
              <p className="text-sm font-semibold text-slate-900">Scanned receipt details</p>
              <button
                type="button"
                onClick={() => setShowScannedDetails(false)}
                className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
              >
                Close
              </button>
            </div>
            <div className="space-y-3 p-4">
              <DataTable
                compact
                columns={["Field", "Approved Requisition", "Scanned Receipt"]}
                rows={requisitionComparison.headerRows.map((row) => [
                  <span key={`${row.label}-field`} className="font-medium">
                    {row.label}
                  </span>,
                  row.approved || "-",
                  row.scanned || "-"
                ])}
                rowClassNames={requisitionComparison.headerRows.map((row) =>
                  row.mismatch ? "bg-red-50/70 text-red-900 hover:bg-red-50/80" : ""
                )}
              />
              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded border border-slate-200 bg-slate-50 p-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    Approved Requisition Lines
                  </p>
                  {requisitionComparison.approvedLines.length === 0 ? (
                    <p className="mt-1 text-xs text-slate-600">No requisition line items available.</p>
                  ) : (
                    <div className="mt-1 space-y-1 text-xs text-slate-700">
                      {requisitionComparison.approvedLines.map((line) => (
                        <p key={`approved-${line.id}`}>
                          {line.description} • qty {line.quantity || "0"} • unit {line.unitPrice || "0"} • total {line.lineTotal || "0"}
                        </p>
                      ))}
                    </div>
                  )}
                </div>
                <div className="rounded border border-slate-200 bg-slate-50 p-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    Scanned Receipt Lines
                  </p>
                  {requisitionComparison.scannedLines.length === 0 ? (
                    <p className="mt-1 text-xs text-slate-600">No line items extracted from scan.</p>
                  ) : (
                    <div className="mt-1 space-y-1 text-xs text-slate-700">
                      {requisitionComparison.scannedLines.map((line) => (
                        <p key={`scanned-${line.id}`}>
                          {line.description} • qty {line.quantity || "0"} • unit {line.unitPrice || "0"} • total {line.lineTotal || "0"}
                        </p>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </aside>
        </div>
      )}
    </>
  );
}
