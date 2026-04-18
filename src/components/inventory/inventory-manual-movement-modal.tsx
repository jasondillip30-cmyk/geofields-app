"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

import { FilterSelect, InputField } from "@/components/inventory/inventory-page-shared";
import { inventoryMovementTypeOptions } from "@/lib/inventory";
import type {
  InventoryItemRow,
  InventoryLocation,
  InventorySupplier,
  MaintenanceContextOption,
  MovementFormState
} from "@/app/inventory/page";

export function InventoryManualMovementModal({
  open,
  onClose,
  onSubmit,
  saving,
  form,
  onFormChange,
  items,
  clients,
  projects,
  rigs,
  maintenanceRequests,
  suppliers,
  locations
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => Promise<void>;
  saving: boolean;
  form: MovementFormState;
  onFormChange: (patch: Partial<MovementFormState>) => void;
  items: InventoryItemRow[];
  clients: Array<{ id: string; name: string }>;
  projects: Array<{ id: string; name: string; clientId: string }>;
  rigs: Array<{ id: string; rigCode: string }>;
  maintenanceRequests: MaintenanceContextOption[];
  suppliers: InventorySupplier[];
  locations: InventoryLocation[];
}) {
  const [isMounted, setIsMounted] = useState(open);
  const [isVisible, setIsVisible] = useState(open);
  const [fallbackItems, setFallbackItems] = useState<InventoryItemRow[]>([]);

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
    let cancelled = false;
    const controller = new AbortController();

    async function loadFallbackItems() {
      if (!open || items.length > 0) {
        if (!cancelled) {
          setFallbackItems([]);
        }
        return;
      }

      try {
        const response = await fetch("/api/inventory/items", {
          cache: "no-store",
          signal: controller.signal
        });
        if (!response.ok) {
          if (!cancelled) {
            setFallbackItems([]);
          }
          return;
        }
        const payload = (await response.json()) as { data?: InventoryItemRow[] };
        if (!cancelled) {
          setFallbackItems(Array.isArray(payload.data) ? payload.data : []);
        }
      } catch {
        if (!cancelled) {
          setFallbackItems([]);
        }
      }
    }

    void loadFallbackItems();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [items.length, open]);

  const filteredProjects = useMemo(() => {
    if (!form.clientId) {
      return projects;
    }
    return projects.filter((project) => project.clientId === form.clientId);
  }, [form.clientId, projects]);
  const availableItems = items.length > 0 ? items : fallbackItems;

  if (!isMounted) {
    return null;
  }

  return (
    <div
      className={`fixed inset-0 z-[82] flex items-center justify-center p-3 transition-opacity duration-200 ease-out sm:p-6 ${
        isVisible ? "opacity-100" : "pointer-events-none opacity-0"
      }`}
    >
      <button
        type="button"
        onClick={onClose}
        className={`absolute inset-0 bg-slate-900/35 backdrop-blur-[2px] transition-opacity duration-200 ${
          isVisible ? "opacity-100" : "opacity-0"
        }`}
        aria-label="Close manual movement modal"
      />
      <section
        data-testid="inventory-manual-movement-modal"
        className={`relative z-10 flex h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-[0_24px_64px_rgba(15,23,42,0.24)] transition-all duration-200 ease-out ${
          isVisible ? "translate-y-0 scale-100 opacity-100" : "translate-y-1 scale-[0.985] opacity-0"
        }`}
      >
        <div className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 px-5 py-4 shadow-[0_1px_0_rgba(15,23,42,0.06)] backdrop-blur">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Manual Adjustment
              </p>
              <p className="text-xl font-semibold text-ink-900">New Manual Adjustment</p>
              <p className="mt-0.5 text-xs font-medium text-slate-600">
                Use this only when movement cannot be captured by receipt intake or approved usage workflows.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 p-1">
              <Link href="/purchasing/receipt-follow-up" className="gf-btn-secondary px-3 py-1.5 text-xs">
                Open Purchase Follow-up
              </Link>
              <button type="button" onClick={onClose} className="gf-btn-secondary px-3 py-1.5 text-xs">
                Cancel
              </button>
            </div>
          </div>
        </div>

        <form
          onSubmit={(event) => {
            if (saving) {
              event.preventDefault();
              return;
            }
            void onSubmit(event);
          }}
          className="space-y-3 overflow-y-auto bg-slate-50/40 p-4 sm:p-5"
        >
          <section className="gf-section-shell p-3">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Movement Basics</p>
            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
              <FilterSelect
                label="Item"
                value={form.itemId}
                onChange={(value) => onFormChange({ itemId: value })}
                options={[
                  { value: "", label: "Select item" },
                  ...availableItems.map((item) => ({
                    value: item.id,
                    label: `${item.name} (${item.sku})`
                  }))
                ]}
              />
              <FilterSelect
                label="Movement Type"
                value={form.movementType}
                onChange={(value) => onFormChange({ movementType: value as MovementFormState["movementType"] })}
                options={inventoryMovementTypeOptions.map((entry) => ({ value: entry.value, label: entry.label }))}
              />
              <InputField
                label="Quantity"
                type="number"
                value={form.quantity}
                onChange={(value) => onFormChange({ quantity: value })}
                required
              />
              <InputField
                label="Unit Cost"
                type="number"
                value={form.unitCost}
                onChange={(value) => onFormChange({ unitCost: value })}
              />
              <InputField
                label="Total Cost"
                type="number"
                value={form.totalCost}
                onChange={(value) => onFormChange({ totalCost: value })}
              />
              <InputField
                label="Movement Date"
                type="date"
                value={form.date}
                onChange={(value) => onFormChange({ date: value })}
                required
              />
            </div>
          </section>

          <section className="gf-section-shell p-3">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Operational Context</p>
            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
              <FilterSelect
                label="Client"
                value={form.clientId}
                onChange={(value) =>
                  onFormChange({
                    clientId: value,
                    projectId: ""
                  })
                }
                options={[
                  { value: "", label: "No client" },
                  ...clients.map((client) => ({ value: client.id, label: client.name }))
                ]}
              />
              <FilterSelect
                label="Project"
                value={form.projectId}
                onChange={(value) => onFormChange({ projectId: value })}
                options={[
                  { value: "", label: "No project" },
                  ...filteredProjects.map((project) => ({ value: project.id, label: project.name }))
                ]}
              />
              <FilterSelect
                label="Rig"
                value={form.rigId}
                onChange={(value) => onFormChange({ rigId: value })}
                options={[
                  { value: "", label: "No rig" },
                  ...rigs.map((rig) => ({ value: rig.id, label: rig.rigCode }))
                ]}
              />
              <FilterSelect
                label="Maintenance Case"
                value={form.maintenanceRequestId}
                onChange={(value) => onFormChange({ maintenanceRequestId: value })}
                options={[
                  { value: "", label: "No maintenance case" },
                  ...maintenanceRequests.map((requestRow) => ({
                    value: requestRow.id,
                    label: `${requestRow.requestCode} (${requestRow.status})`
                  }))
                ]}
              />
              <FilterSelect
                label="Location From"
                value={form.locationFromId}
                onChange={(value) => onFormChange({ locationFromId: value })}
                options={[
                  { value: "", label: "No source location" },
                  ...locations.map((location) => ({ value: location.id, label: location.name }))
                ]}
              />
              <FilterSelect
                label="Location To"
                value={form.locationToId}
                onChange={(value) => onFormChange({ locationToId: value })}
                options={[
                  { value: "", label: "No destination location" },
                  ...locations.map((location) => ({ value: location.id, label: location.name }))
                ]}
              />
            </div>
          </section>

          <section className="gf-section-shell p-3">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Source / Documents</p>
            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
              <FilterSelect
                label="Supplier"
                value={form.supplierId}
                onChange={(value) => onFormChange({ supplierId: value })}
                options={[
                  { value: "", label: "No supplier" },
                  ...suppliers.map((supplier) => ({ value: supplier.id, label: supplier.name }))
                ]}
              />
              <InputField
                label="Control / TRA Number"
                value={form.traReceiptNumber}
                onChange={(value) => onFormChange({ traReceiptNumber: value })}
              />
              <InputField
                label="Supplier Invoice Number"
                value={form.supplierInvoiceNumber}
                onChange={(value) => onFormChange({ supplierInvoiceNumber: value })}
              />
              <InputField
                label="Receipt Reference URL"
                value={form.receiptUrl}
                onChange={(value) => onFormChange({ receiptUrl: value })}
              />
              <label className="text-xs text-ink-700">
                <span className="mb-1 block uppercase tracking-wide text-slate-500">Receipt File (optional)</span>
                <input
                  type="file"
                  accept="image/*,.pdf"
                  onChange={(event) => onFormChange({ receiptFile: event.target.files?.[0] || null })}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
              </label>
            </div>
          </section>

          <section className="gf-section-shell p-3">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Notes & Controls</p>
            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
              <label className="text-xs text-ink-700 md:col-span-2 xl:col-span-2">
                <span className="mb-1 block uppercase tracking-wide text-slate-500">Notes</span>
                <textarea
                  value={form.notes}
                  onChange={(event) => onFormChange({ notes: event.target.value })}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  rows={3}
                />
              </label>
              <label className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700">
                <input
                  type="checkbox"
                  checked={form.createExpense}
                  onChange={(event) => onFormChange({ createExpense: event.target.checked })}
                />
                Create linked expense record
              </label>
              <label className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700">
                <input
                  type="checkbox"
                  checked={form.allowNegativeStock}
                  onChange={(event) => onFormChange({ allowNegativeStock: event.target.checked })}
                />
                Allow negative stock for this adjustment
              </label>
            </div>
          </section>

          <div className="sticky bottom-0 z-10 -mx-4 border-t border-slate-200 bg-white/95 px-4 py-3 shadow-[0_-1px_0_rgba(15,23,42,0.06)] backdrop-blur sm:-mx-5 sm:px-5">
            <div className="flex flex-wrap items-center justify-end gap-2">
              <button type="button" onClick={onClose} className="gf-btn-secondary px-3 py-1.5 text-xs">
                Cancel
              </button>
              <button
                type="submit"
                data-testid="manual-movement-submit"
                disabled={saving || !form.itemId || !form.quantity}
                className="gf-btn-primary px-3 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-60"
              >
                {saving ? "Recording..." : "Record Manual Movement"}
              </button>
            </div>
          </div>
        </form>
      </section>
    </div>
  );
}
