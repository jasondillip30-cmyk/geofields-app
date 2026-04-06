"use client";

import { ProjectInvoiceStatus } from "@prisma/client";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { Card } from "@/components/ui/card";
import { DataTable } from "@/components/ui/table";
import { formatCurrency } from "@/lib/utils";

interface ProjectInvoiceCollectionsPanelProps {
  projectId: string;
  invoices: Array<{
    id: string;
    invoiceNumber: string;
    issueDate: string;
    dueDate: string | null;
    amount: number;
    status: ProjectInvoiceStatus;
    notes: string | null;
    collectedAmount: number;
    outstandingAmount: number;
    paymentCount: number;
    payments: Array<{
      id: string;
      paymentDate: string;
      amount: number;
      paymentReference: string | null;
      paymentMethod: string | null;
      notes: string | null;
    }>;
  }>;
  realizationCoverage: {
    status: "KNOWN" | "PARTIAL";
    note: string;
  };
}

export function ProjectInvoiceCollectionsPanel({
  projectId,
  invoices,
  realizationCoverage
}: ProjectInvoiceCollectionsPanelProps) {
  const router = useRouter();
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [invoiceIssueDate, setInvoiceIssueDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [invoiceDueDate, setInvoiceDueDate] = useState("");
  const [invoiceAmount, setInvoiceAmount] = useState("");
  const [invoiceNotes, setInvoiceNotes] = useState("");
  const [creatingInvoice, setCreatingInvoice] = useState(false);
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string>("");
  const [editStatus, setEditStatus] = useState<ProjectInvoiceStatus>(ProjectInvoiceStatus.ISSUED);
  const [editDueDate, setEditDueDate] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [savingInvoiceEdit, setSavingInvoiceEdit] = useState(false);
  const [paymentDate, setPaymentDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentReference, setPaymentReference] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("");
  const [paymentNotes, setPaymentNotes] = useState("");
  const [postingPayment, setPostingPayment] = useState(false);
  const [updatingInvoiceId, setUpdatingInvoiceId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const selectedInvoice = useMemo(
    () => invoices.find((invoice) => invoice.id === selectedInvoiceId) || null,
    [invoices, selectedInvoiceId]
  );

  useEffect(() => {
    if (!invoices.length) {
      setSelectedInvoiceId("");
      return;
    }
    if (!selectedInvoiceId || !invoices.some((invoice) => invoice.id === selectedInvoiceId)) {
      const preferred = invoices.find((invoice) => invoice.status !== ProjectInvoiceStatus.VOID) || invoices[0];
      setSelectedInvoiceId(preferred.id);
    }
  }, [invoices, selectedInvoiceId]);

  useEffect(() => {
    if (!selectedInvoice) {
      return;
    }
    setEditStatus(selectedInvoice.status);
    setEditDueDate(selectedInvoice.dueDate || "");
    setEditNotes(selectedInvoice.notes || "");
  }, [selectedInvoice]);

  async function createInvoice(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    setCreatingInvoice(true);
    try {
      const response = await fetch(`/api/projects/${projectId}/invoices`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          invoiceNumber,
          issueDate: invoiceIssueDate,
          dueDate: invoiceDueDate || null,
          amount: Number(invoiceAmount),
          notes: invoiceNotes || null
        })
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        setError(payload?.message || "Failed to create invoice.");
        return;
      }
      setInvoiceNumber("");
      setInvoiceDueDate("");
      setInvoiceAmount("");
      setInvoiceNotes("");
      setNotice("Invoice created.");
      router.refresh();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Failed to create invoice.");
    } finally {
      setCreatingInvoice(false);
    }
  }

  async function saveInvoiceDetails(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedInvoice) {
      return;
    }
    setError(null);
    setNotice(null);
    setSavingInvoiceEdit(true);
    try {
      const response = await fetch(`/api/projects/${projectId}/invoices/${selectedInvoice.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          status: editStatus,
          dueDate: editDueDate || null,
          notes: editNotes || null
        })
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        setError(payload?.message || "Failed to update invoice.");
        return;
      }
      setNotice(`Invoice ${selectedInvoice.invoiceNumber} updated.`);
      router.refresh();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to update invoice.");
    } finally {
      setSavingInvoiceEdit(false);
    }
  }

  async function postPayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedInvoice) {
      setError("Select an invoice first.");
      return;
    }
    setError(null);
    setNotice(null);
    setPostingPayment(true);
    try {
      const response = await fetch(
        `/api/projects/${projectId}/invoices/${selectedInvoice.id}/payments`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            paymentDate,
            amount: Number(paymentAmount),
            paymentReference: paymentReference || null,
            paymentMethod: paymentMethod || null,
            notes: paymentNotes || null
          })
        }
      );
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        setError(payload?.message || "Failed to record payment.");
        return;
      }
      setPaymentAmount("");
      setPaymentReference("");
      setPaymentMethod("");
      setPaymentNotes("");
      setNotice("Payment recorded.");
      router.refresh();
    } catch (paymentError) {
      setError(paymentError instanceof Error ? paymentError.message : "Failed to record payment.");
    } finally {
      setPostingPayment(false);
    }
  }

  async function quickUpdateInvoiceStatus(invoiceId: string, status: ProjectInvoiceStatus) {
    setError(null);
    setNotice(null);
    setUpdatingInvoiceId(invoiceId);
    try {
      const response = await fetch(`/api/projects/${projectId}/invoices/${invoiceId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ status })
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        setError(payload?.message || "Failed to update invoice status.");
        return;
      }
      setNotice(`Invoice status updated to ${statusLabel(status)}.`);
      router.refresh();
    } catch (statusError) {
      setError(statusError instanceof Error ? statusError.message : "Failed to update invoice status.");
    } finally {
      setUpdatingInvoiceId(null);
    }
  }

  return (
    <section className="grid gap-5 lg:grid-cols-2">
      <Card
        title="Project Invoices"
        subtitle="Invoice values are explicit project records and stay separate from earned revenue."
      >
        <div
          className={`mb-3 rounded-lg border px-3 py-2 text-xs ${
            realizationCoverage.status === "PARTIAL"
              ? "border-amber-200 bg-amber-50 text-amber-900"
              : "border-emerald-200 bg-emerald-50 text-emerald-900"
          }`}
        >
          <p className="font-semibold">
            Realization coverage: {realizationCoverage.status === "PARTIAL" ? "Partial" : "Known"}
          </p>
          <p className="mt-1">{realizationCoverage.note}</p>
        </div>

        {error ? (
          <p className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">{error}</p>
        ) : null}
        {notice ? (
          <p className="mb-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">{notice}</p>
        ) : null}

        {invoices.length === 0 ? (
          <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            No invoice records captured yet for this project.
          </p>
        ) : (
          <DataTable
            columns={["Invoice", "Issue", "Due", "Amount", "Status", "Collected", "Outstanding", "Actions"]}
            rows={invoices.map((invoice) => [
              invoice.invoiceNumber,
              invoice.issueDate,
              invoice.dueDate || "-",
              formatCurrency(invoice.amount),
              statusLabel(invoice.status),
              formatCurrency(invoice.collectedAmount),
              formatCurrency(invoice.outstandingAmount),
              <div key={`invoice-action-${invoice.id}`} className="flex flex-wrap gap-1">
                <button
                  type="button"
                  onClick={() => setSelectedInvoiceId(invoice.id)}
                  className="rounded-md border border-slate-200 px-2 py-1 text-[11px] text-ink-700 hover:bg-slate-50"
                >
                  Manage
                </button>
                {invoice.status === ProjectInvoiceStatus.DRAFT ? (
                  <button
                    type="button"
                    onClick={() => void quickUpdateInvoiceStatus(invoice.id, ProjectInvoiceStatus.ISSUED)}
                    disabled={updatingInvoiceId === invoice.id}
                    className="rounded-md border border-brand-200 px-2 py-1 text-[11px] text-brand-700 hover:bg-brand-50 disabled:opacity-60"
                  >
                    Issue
                  </button>
                ) : null}
                {invoice.status !== ProjectInvoiceStatus.VOID ? (
                  <button
                    type="button"
                    onClick={() => void quickUpdateInvoiceStatus(invoice.id, ProjectInvoiceStatus.VOID)}
                    disabled={updatingInvoiceId === invoice.id}
                    className="rounded-md border border-rose-200 px-2 py-1 text-[11px] text-rose-700 hover:bg-rose-50 disabled:opacity-60"
                  >
                    Void
                  </button>
                ) : null}
              </div>
            ])}
            compact
          />
        )}

        <form onSubmit={createInvoice} className="mt-4 space-y-3">
          <p className="text-xs font-semibold text-ink-700">Create invoice</p>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="text-xs text-ink-700">
              Invoice number
              <input
                type="text"
                value={invoiceNumber}
                onChange={(event) => setInvoiceNumber(event.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                required
              />
            </label>
            <label className="text-xs text-ink-700">
              Issue date
              <input
                type="date"
                value={invoiceIssueDate}
                onChange={(event) => setInvoiceIssueDate(event.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                required
              />
            </label>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="text-xs text-ink-700">
              Due date (optional)
              <input
                type="date"
                value={invoiceDueDate}
                onChange={(event) => setInvoiceDueDate(event.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              />
            </label>
            <label className="text-xs text-ink-700">
              Amount
              <input
                type="number"
                min="0.01"
                step="0.01"
                value={invoiceAmount}
                onChange={(event) => setInvoiceAmount(event.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                required
              />
            </label>
          </div>
          <label className="text-xs text-ink-700">
            Notes (optional)
            <textarea
              rows={2}
              value={invoiceNotes}
              onChange={(event) => setInvoiceNotes(event.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
          </label>
          <button
            type="submit"
            disabled={creatingInvoice}
            className="rounded-lg bg-brand-600 px-3 py-2 text-xs font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
          >
            {creatingInvoice ? "Saving..." : "Create invoice"}
          </button>
        </form>
      </Card>

      <Card
        title="Collections"
        subtitle="Record payments against project invoices. Collections remain explicit and auditable."
      >
        {invoices.length === 0 ? (
          <p className="text-sm text-ink-600">Create an invoice first to track collections.</p>
        ) : (
          <div className="space-y-4">
            <label className="block text-xs text-ink-700">
              Selected invoice
              <select
                value={selectedInvoiceId}
                onChange={(event) => setSelectedInvoiceId(event.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              >
                {invoices.map((invoice) => (
                  <option key={invoice.id} value={invoice.id}>
                    {invoice.invoiceNumber} • {statusLabel(invoice.status)} • {formatCurrency(invoice.amount)}
                  </option>
                ))}
              </select>
            </label>

            {selectedInvoice ? (
              <>
                <DataTable
                  columns={["Field", "Value"]}
                  rows={[
                    ["Invoice", selectedInvoice.invoiceNumber],
                    ["Status", statusLabel(selectedInvoice.status)],
                    ["Amount", formatCurrency(selectedInvoice.amount)],
                    ["Collected", formatCurrency(selectedInvoice.collectedAmount)],
                    ["Outstanding", formatCurrency(selectedInvoice.outstandingAmount)]
                  ]}
                  compact
                />

                <form onSubmit={saveInvoiceDetails} className="space-y-3">
                  <p className="text-xs font-semibold text-ink-700">Update invoice details</p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <label className="text-xs text-ink-700">
                      Status
                      <select
                        value={editStatus}
                        onChange={(event) => setEditStatus(event.target.value as ProjectInvoiceStatus)}
                        className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                      >
                        <option value={ProjectInvoiceStatus.DRAFT}>Draft</option>
                        <option value={ProjectInvoiceStatus.ISSUED}>Issued</option>
                        <option value={ProjectInvoiceStatus.PARTIALLY_COLLECTED}>Partially collected</option>
                        <option value={ProjectInvoiceStatus.COLLECTED}>Collected</option>
                        <option value={ProjectInvoiceStatus.VOID}>Void</option>
                      </select>
                    </label>
                    <label className="text-xs text-ink-700">
                      Due date
                      <input
                        type="date"
                        value={editDueDate}
                        onChange={(event) => setEditDueDate(event.target.value)}
                        className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                      />
                    </label>
                  </div>
                  <label className="text-xs text-ink-700">
                    Notes
                    <textarea
                      rows={2}
                      value={editNotes}
                      onChange={(event) => setEditNotes(event.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                    />
                  </label>
                  <button
                    type="submit"
                    disabled={savingInvoiceEdit}
                    className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-ink-700 hover:bg-slate-50 disabled:opacity-60"
                  >
                    {savingInvoiceEdit ? "Saving..." : "Save invoice details"}
                  </button>
                </form>

                <div className="space-y-2">
                  <p className="text-xs font-semibold text-ink-700">Payment history</p>
                  {selectedInvoice.payments.length === 0 ? (
                    <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                      No payment records posted for this invoice yet.
                    </p>
                  ) : (
                    <DataTable
                      columns={["Date", "Amount", "Reference", "Method", "Notes"]}
                      rows={selectedInvoice.payments.map((payment) => [
                        payment.paymentDate,
                        formatCurrency(payment.amount),
                        payment.paymentReference || "-",
                        payment.paymentMethod || "-",
                        payment.notes || "-"
                      ])}
                      compact
                    />
                  )}
                </div>

                <form onSubmit={postPayment} className="space-y-3">
                  <p className="text-xs font-semibold text-ink-700">Record payment</p>
                  {selectedInvoice.status === ProjectInvoiceStatus.VOID ? (
                    <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                      Payments cannot be posted to void invoices.
                    </p>
                  ) : null}
                  <div className="grid gap-2 sm:grid-cols-2">
                    <label className="text-xs text-ink-700">
                      Payment date
                      <input
                        type="date"
                        value={paymentDate}
                        onChange={(event) => setPaymentDate(event.target.value)}
                        className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                        required
                      />
                    </label>
                    <label className="text-xs text-ink-700">
                      Amount
                      <input
                        type="number"
                        min="0.01"
                        step="0.01"
                        value={paymentAmount}
                        onChange={(event) => setPaymentAmount(event.target.value)}
                        className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                        required
                      />
                    </label>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <label className="text-xs text-ink-700">
                      Payment reference (optional)
                      <input
                        type="text"
                        value={paymentReference}
                        onChange={(event) => setPaymentReference(event.target.value)}
                        className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                      />
                    </label>
                    <label className="text-xs text-ink-700">
                      Payment method (optional)
                      <input
                        type="text"
                        value={paymentMethod}
                        onChange={(event) => setPaymentMethod(event.target.value)}
                        className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                      />
                    </label>
                  </div>
                  <label className="text-xs text-ink-700">
                    Notes (optional)
                    <textarea
                      rows={2}
                      value={paymentNotes}
                      onChange={(event) => setPaymentNotes(event.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                    />
                  </label>
                  <button
                    type="submit"
                    disabled={postingPayment || selectedInvoice.status === ProjectInvoiceStatus.VOID}
                    className="rounded-lg bg-brand-600 px-3 py-2 text-xs font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
                  >
                    {postingPayment ? "Posting..." : "Record payment"}
                  </button>
                </form>
              </>
            ) : null}
          </div>
        )}
      </Card>
    </section>
  );
}

function statusLabel(status: ProjectInvoiceStatus) {
  if (status === ProjectInvoiceStatus.PARTIALLY_COLLECTED) {
    return "Partially collected";
  }
  if (status === ProjectInvoiceStatus.COLLECTED) {
    return "Collected";
  }
  if (status === ProjectInvoiceStatus.ISSUED) {
    return "Issued";
  }
  if (status === ProjectInvoiceStatus.VOID) {
    return "Void";
  }
  return "Draft";
}
