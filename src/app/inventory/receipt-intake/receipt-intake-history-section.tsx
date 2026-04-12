"use client";

import Link from "next/link";

import { Card } from "@/components/ui/card";
import { DataTable } from "@/components/ui/table";
import { cn, formatCurrency } from "@/lib/utils";
import type {
  ReceiptMovementRow,
  ReceiptSubmissionSummary
} from "./receipt-intake-page-types";
import { toIsoDate } from "./receipt-intake-page-utils";

interface ReceiptIntakeHistorySectionProps {
  focusedSectionId: string | null;
  loading: boolean;
  submissions: ReceiptSubmissionSummary[];
  canManage: boolean;
  historyRows: ReceiptMovementRow[];
  onRejectSubmission: (submissionId: string) => Promise<void>;
}

export function ReceiptIntakeHistorySection({
  focusedSectionId,
  loading,
  submissions,
  canManage,
  historyRows,
  onRejectSubmission
}: ReceiptIntakeHistorySectionProps) {
  return (
    <section
      id="inventory-receipt-history-section"
      className={cn(
        focusedSectionId === "inventory-receipt-history-section" &&
          "rounded-2xl ring-2 ring-indigo-100 ring-offset-2 ring-offset-slate-50"
      )}
    >
      <div className="mb-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
        Receipt history is secondary. Primary lifecycle tracking is under{" "}
        <Link href="/expenses" className="font-semibold text-brand-700 underline-offset-2 hover:underline">
          Purchase Requests → Requisition History
        </Link>
        .
      </div>
      <Card
        className="min-w-0"
        title="Legacy Receipt Submission History"
        subtitle="Secondary receipt evidence and submission log"
      >
        {loading ? (
          <p className="text-sm text-ink-600">Loading receipt history...</p>
        ) : (
          <div className="space-y-4">
            <section className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-ink-900">Receipt Submissions</h3>
                <span className="text-xs text-slate-500">{submissions.length} total</span>
              </div>
              {submissions.length === 0 ? (
                <p className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-3 text-sm text-ink-600">
                  No receipt submissions found yet.
                </p>
              ) : (
                <DataTable
                  className="border-slate-200/70"
                  columns={[
                    "Submitted",
                    "Status",
                    "Supplier",
                    "Receipt #",
                    "Total",
                    "Submitted By",
                    "Reviewer",
                    "Action"
                  ]}
                  rows={submissions.slice(0, 80).map((row) => [
                    toIsoDate(row.submittedAt || row.reportDate),
                    <span
                      key={`${row.id}-status`}
                      className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
                        row.status === "APPROVED"
                          ? "border-emerald-300 bg-emerald-100 text-emerald-800"
                          : row.status === "REJECTED"
                            ? "border-red-300 bg-red-100 text-red-800"
                            : "border-amber-300 bg-amber-100 text-amber-800"
                      }`}
                    >
                      {row.status === "SUBMITTED"
                        ? "Pending review"
                        : row.status === "APPROVED"
                          ? "Finalized"
                          : "Rejected"}
                    </span>,
                    row.summary.supplierName || "-",
                    row.summary.receiptNumber || "-",
                    formatCurrency(row.summary.total || 0),
                    row.submittedBy?.name || "-",
                    row.reviewer?.name || "-",
                    <div key={`${row.id}-action`} className="flex flex-wrap gap-2">
                      {canManage && row.status !== "APPROVED" ? (
                        <Link
                          href={`/purchasing/receipt-follow-up?submissionId=${row.id}`}
                          className="rounded border border-brand-300 bg-brand-50 px-2 py-1 text-xs font-semibold text-brand-800 hover:bg-brand-100"
                        >
                          Review & finalize
                        </Link>
                      ) : (
                        <span className="text-xs text-slate-500">-</span>
                      )}
                      {canManage && row.status === "SUBMITTED" && (
                        <button
                          type="button"
                          onClick={() => void onRejectSubmission(row.id)}
                          className="rounded border border-red-300 bg-red-50 px-2 py-1 text-xs font-semibold text-red-700 hover:bg-red-100"
                        >
                          Reject
                        </button>
                      )}
                    </div>
                  ])}
                />
              )}
            </section>

            <section className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-ink-900">Finalized Stock Movements</h3>
                <span className="text-xs text-slate-500">{historyRows.length} rows</span>
              </div>
              {historyRows.length === 0 ? (
                <p className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-4 text-sm text-ink-600">
                  No receipt-linked inventory movements found yet.
                </p>
              ) : (
                <DataTable
                  className="border-slate-200/70"
                  columns={[
                    "Date",
                    "Supplier",
                    "Receipt #",
                    "TRA #",
                    "Item",
                    "Value",
                    "Project",
                    "Rig",
                    "Linked Expense",
                    "Receipt",
                    "Action"
                  ]}
                  rows={historyRows.slice(0, 80).map((row) => [
                    toIsoDate(row.date),
                    row.supplier?.name || "-",
                    row.supplierInvoiceNumber || "-",
                    row.traReceiptNumber || "-",
                    row.item?.name || "-",
                    formatCurrency(row.totalCost || 0),
                    row.project?.name || "-",
                    row.rig?.rigCode || "-",
                    row.expense?.id || "-",
                    row.receiptUrl ? (
                      <a
                        key={`${row.id}-receipt`}
                        href={row.receiptUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-brand-700 underline"
                      >
                        Open
                      </a>
                    ) : (
                      "-"
                    ),
                    <Link
                      key={`${row.id}-detail`}
                      href={`/inventory/stock-movements?movementId=${row.id}`}
                      className="rounded border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-800 hover:bg-slate-100"
                    >
                      Open Detail
                    </Link>
                  ])}
                />
              )}
            </section>
          </div>
        )}
      </Card>
    </section>
  );
}
