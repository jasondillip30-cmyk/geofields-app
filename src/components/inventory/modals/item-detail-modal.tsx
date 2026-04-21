"use client";

import { useEffect, useState } from "react";

import { DataTable } from "@/components/ui/table";
import { SummaryBadge } from "@/components/inventory/inventory-page-shared";
import type { InventoryIssueRow, InventoryItemDetailsResponse } from "@/app/inventory/page";
import { formatInventoryCategory, formatMovementType } from "@/lib/inventory";
import { formatCurrency, formatNumber } from "@/lib/utils";
import { toIsoDate } from "@/components/inventory/inventory-page-utils";

export function ItemDetailModal({
  open,
  onClose,
  itemDetails,
  issues,
  canManage,
  isProjectLocked,
  onRequestUse,
  onRequestBatch,
  onToggleStatus
}: {
  open: boolean;
  onClose: () => void;
  itemDetails: InventoryItemDetailsResponse | null;
  issues: InventoryIssueRow[];
  canManage: boolean;
  isProjectLocked: boolean;
  onRequestUse: () => void;
  onRequestBatch: () => void;
  onToggleStatus: (nextStatus: "ACTIVE" | "INACTIVE") => Promise<void>;
}) {
  const [isMounted, setIsMounted] = useState(open);
  const [isVisible, setIsVisible] = useState(open);
  const [receiptDateFilter, setReceiptDateFilter] = useState("");

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

  useEffect(() => {
    if (!open) {
      setReceiptDateFilter("");
    }
  }, [open]);

  if (!isMounted) {
    return null;
  }

  const receiptEntries = (itemDetails?.movements || [])
    .filter((movement) => movement.receiptUrl || movement.traReceiptNumber || movement.supplierInvoiceNumber)
    .map((movement) => ({
      id: movement.id,
      dateIso: toIsoDate(movement.date),
      supplierSource: movement.supplier?.name || movement.expense?.category || "-",
      traReceiptNumber: movement.traReceiptNumber || "-",
      supplierInvoiceNumber: movement.supplierInvoiceNumber || "-",
      expenseId: movement.expense?.id || "-",
      receiptUrl: movement.receiptUrl
    }));

  const filteredReceiptEntries = receiptDateFilter
    ? receiptEntries.filter((entry) => entry.dateIso === receiptDateFilter)
    : receiptEntries;

  const receiptRows = filteredReceiptEntries
    .map((movement) => [
      movement.dateIso,
      movement.supplierSource,
      movement.traReceiptNumber,
      movement.supplierInvoiceNumber,
      movement.expenseId,
      movement.receiptUrl ? (
        <a
          key={`${movement.id}-drawer-receipt`}
          href={movement.receiptUrl}
          target="_blank"
          rel="noreferrer"
          className="text-brand-700 underline"
        >
          Open Receipt
        </a>
      ) : (
        "-"
      )
    ]);

  return (
    <div
      className={`fixed inset-0 z-[80] flex items-center justify-center p-3 transition-opacity duration-200 ease-out sm:p-6 ${
        isVisible ? "opacity-100" : "pointer-events-none opacity-0"
      }`}
    >
      <button
        type="button"
        onClick={onClose}
        className={`absolute inset-0 bg-slate-900/40 backdrop-blur-[2px] transition-opacity duration-200 ${
          isVisible ? "opacity-100" : "opacity-0"
        }`}
        aria-label="Close item detail modal"
      />
      <section
        className={`relative z-10 flex h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-[0_24px_64px_rgba(15,23,42,0.24)] transition-all duration-200 ease-out ${
          isVisible ? "translate-y-0 scale-100 opacity-100" : "translate-y-1 scale-[0.985] opacity-0"
        }`}
      >
        <div className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 px-5 py-4 shadow-[0_1px_0_rgba(15,23,42,0.06)] backdrop-blur">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                {isProjectLocked ? "Project Item Details" : "Inventory Item Workspace"}
              </p>
              <p className="text-xl font-semibold text-ink-900">
                {itemDetails?.data ? itemDetails.data.name : "Inventory Item"}
              </p>
              <p className="mt-0.5 text-xs font-medium text-slate-600">
                {itemDetails?.data ? itemDetails.data.sku : "Loading details"} •{" "}
                {isProjectLocked ? "Project working view" : "Full item workspace"}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 p-1">
              {itemDetails?.data && (
                <>
                  {canManage && !isProjectLocked ? (
                    <>
                      <a
                        href={`/inventory/items?itemId=${itemDetails.data.id}`}
                        className="gf-btn-primary px-3 py-1.5 text-xs"
                      >
                        Edit Item
                      </a>
                      <a
                        href={`/inventory/stock-movements?movementItemId=${itemDetails.data.id}&movementType=ADJUSTMENT`}
                        className="gf-btn-secondary px-3 py-1.5 text-xs"
                      >
                        Adjust Stock
                      </a>
                    </>
                  ) : null}
                  <button type="button" onClick={onRequestUse} className="gf-btn-primary px-3 py-1.5 text-xs">
                    Request Use
                  </button>
                  <button
                    type="button"
                    onClick={onRequestBatch}
                    className="gf-btn-secondary px-3 py-1.5 text-xs"
                  >
                    Request Batch
                  </button>
                  {canManage && !isProjectLocked && (
                    <button
                      type="button"
                      onClick={() => void onToggleStatus(itemDetails.data.status === "ACTIVE" ? "INACTIVE" : "ACTIVE")}
                      className="gf-btn-secondary px-3 py-1.5 text-xs"
                    >
                      {itemDetails.data.status === "ACTIVE" ? "Archive" : "Restore"}
                    </button>
                  )}
                </>
              )}
              <button type="button" onClick={onClose} className="gf-btn-secondary px-3 py-1.5 text-xs">
                Back
              </button>
            </div>
          </div>
        </div>

        {!itemDetails?.data ? (
          <div className="p-4 text-sm text-ink-600">Loading selected item details...</div>
        ) : (
          <div className="space-y-5 overflow-y-auto bg-slate-50/40 p-4 sm:p-5">
            {issues.length > 0 && (
              <div className="rounded-lg border border-amber-300 bg-amber-50 p-3">
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-amber-800">Active Item Warnings</p>
                <p className="text-sm text-amber-900">
                  {issues.slice(0, 2).map((issue) => issue.title).join(" • ")}
                </p>
              </div>
            )}

            <section className="gf-section-shell p-4">
              <div className="gf-section-heading">
                <div className="gf-section-heading-block">
                  <h4 className="gf-section-title">Details</h4>
                </div>
                <span
                  className={`inline-flex rounded-full border px-2 py-1 text-[11px] font-semibold ${
                    itemDetails.data.status === "ACTIVE"
                      ? "border-emerald-300 bg-emerald-100 text-emerald-800"
                      : "border-slate-300 bg-slate-100 text-slate-700"
                  }`}
                >
                  {itemDetails.data.status}
                </span>
              </div>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <div
                  className={`rounded-xl border px-4 py-3 ${
                    itemDetails.data.quantityInStock <= itemDetails.data.minimumStockLevel
                      ? "border-amber-300 bg-amber-50"
                      : "border-emerald-300 bg-emerald-50"
                  }`}
                >
                  <p className="text-xs uppercase tracking-wide text-slate-600">Stock On Hand</p>
                  <p className="mt-1 text-2xl font-semibold text-ink-900">
                    {formatNumber(itemDetails.data.quantityInStock)}
                  </p>
                  <p className="text-xs text-slate-600">Minimum: {formatNumber(itemDetails.data.minimumStockLevel)}</p>
                </div>
                <div className="rounded-xl border border-brand-200 bg-brand-50 px-4 py-3">
                  <p className="text-xs uppercase tracking-wide text-slate-600">Inventory Value</p>
                  <p className="mt-1 text-2xl font-semibold text-brand-900">
                    {formatCurrency(itemDetails.data.inventoryValue)}
                  </p>
                  <p className="text-xs text-slate-600">Unit Cost: {formatCurrency(itemDetails.data.unitCost)}</p>
                </div>
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                <SummaryBadge label="Category" value={formatInventoryCategory(itemDetails.data.category)} />
                <SummaryBadge label="Supplier" value={itemDetails.data.supplier?.name || "-"} />
                <SummaryBadge label="Location" value={itemDetails.data.location?.name || "-"} />
                <SummaryBadge label="Part Number" value={itemDetails.data.partNumber || "-"} />
                <SummaryBadge
                  label="Compatible Rig"
                  value={itemDetails.data.compatibleRig?.rigCode || itemDetails.data.compatibleRigType || "-"}
                />
              </div>
            </section>

            <section className="gf-section-shell p-4">
              <div className="gf-section-heading">
                <div className="gf-section-heading-block">
                  <h4 className="gf-section-title">Stock History</h4>
                </div>
              </div>
              <div className="mt-3">
                <DataTable
                  className="border-slate-200/70"
                  columns={["Movement Date", "Type", "Qty", "Project", "Rig", "Maintenance", "Expense", "Receipt"]}
                  rows={(itemDetails.movements || []).slice(0, 20).map((movement) => [
                    toIsoDate(movement.date),
                    formatMovementType(movement.movementType),
                    formatNumber(movement.quantity),
                    movement.project?.name || "-",
                    movement.rig?.rigCode || "-",
                    movement.maintenanceRequest?.requestCode || "-",
                    movement.expense?.id || "-",
                    movement.receiptUrl ? (
                      <a key={`${movement.id}-movement-receipt`} href={movement.receiptUrl} target="_blank" rel="noreferrer" className="text-brand-700 underline">
                        Receipt
                      </a>
                    ) : (
                      "-"
                    )
                  ])}
                />
              </div>
            </section>

            <section className="gf-section-shell p-4">
              <div className="gf-section-heading">
                <div className="gf-section-heading-block">
                  <h4 className="gf-section-title">Receipts</h4>
                  <p className="gf-section-subtitle">Track which receipts created or updated stock.</p>
                </div>
                <div className="flex items-center gap-2">
                  <label className="text-xs text-slate-700">
                    <span className="sr-only">Filter receipts by date</span>
                    <input
                      type="date"
                      value={receiptDateFilter}
                      onChange={(event) => setReceiptDateFilter(event.target.value)}
                      className="h-8 rounded-lg border border-slate-200 bg-white px-2 text-xs text-slate-700"
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => setReceiptDateFilter("")}
                    disabled={!receiptDateFilter}
                    className="gf-btn-secondary px-2.5 py-1 text-[11px] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Clear
                  </button>
                </div>
              </div>
              <div className="mt-3">
                {receiptEntries.length === 0 ? (
                  <p className="text-sm text-ink-600">No linked receipts for this item in current scope.</p>
                ) : receiptRows.length === 0 ? (
                  <p className="text-sm text-ink-600">No linked receipts for selected date.</p>
                ) : (
                  <DataTable
                    className="border-slate-200/70"
                    columns={["Date", "Supplier/Source", "TRA Receipt", "Invoice Ref", "Linked Expense", "File"]}
                    rows={receiptRows}
                  />
                )}
              </div>
            </section>
          </div>
        )}
      </section>
    </div>
  );
}
