"use client";

import Link from "next/link";
import type { Dispatch, FormEvent, SetStateAction } from "react";

import {
  FilterSelect,
  InputField
} from "@/components/inventory/inventory-page-shared";
import { Card } from "@/components/ui/card";
import { DataTable } from "@/components/ui/table";
import { formatInventoryCategory, inventoryCategoryOptions } from "@/lib/inventory";
import { cn, formatCurrency } from "@/lib/utils";

import type {
  CategorySuggestionState,
  ItemFormState,
  InventoryLocation,
  InventorySupplier,
  LocationFormState,
  SupplierFormState
} from "./inventory-page-types";

export function InventoryManualEntrySection({
  showItems,
  showCreateItemForm,
  isSingleProjectScope,
  canManage,
  submitItemForm,
  itemForm,
  setItemForm,
  categorySuggestion,
  suggestionLoading,
  suggestionMismatch,
  suppliers,
  locations,
  rigs,
  savingItem
}: {
  showItems: boolean;
  showCreateItemForm: boolean;
  isSingleProjectScope: boolean;
  canManage: boolean;
  submitItemForm: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  itemForm: ItemFormState;
  setItemForm: Dispatch<SetStateAction<ItemFormState>>;
  categorySuggestion: CategorySuggestionState;
  suggestionLoading: boolean;
  suggestionMismatch: boolean;
  suppliers: InventorySupplier[];
  locations: InventoryLocation[];
  rigs: Array<{ id: string; rigCode: string }>;
  savingItem: boolean;
}) {
  if (!showItems || !showCreateItemForm || isSingleProjectScope) {
    return null;
  }

  return (
    <section id="inventory-actions-section" className="grid min-w-0 items-start gap-4 xl:grid-cols-[1.2fr_1fr]">
      {canManage && (
        <Card
          className="min-w-0"
          title="Inventory Manual Entry"
          subtitle="Create inventory items directly. Purchase receipt follow-up now lives in Purchasing → Receipt Follow-up."
        >
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-xs text-brand-900">
            <p className="font-medium">Need receipt-based intake? Use the dedicated Purchase Follow-up workflow.</p>
            <Link
              href="/purchasing/receipt-follow-up"
              className="inline-flex rounded border border-brand-300 bg-white px-2 py-1 font-semibold text-brand-800 hover:bg-brand-100"
            >
              Open Purchase Follow-up
            </Link>
          </div>

          <form onSubmit={submitItemForm} className="grid gap-2 md:grid-cols-2">
            <InputField label="Item Name" value={itemForm.name} onChange={(value) => setItemForm((current) => ({ ...current, name: value }))} required />
            <InputField label="SKU / Item Code" value={itemForm.sku} onChange={(value) => setItemForm((current) => ({ ...current, sku: value.toUpperCase() }))} required />
            <FilterSelect
              label="Category"
              value={itemForm.category}
              onChange={(value) => setItemForm((current) => ({ ...current, category: value }))}
              options={inventoryCategoryOptions.map((entry) => ({ value: entry.value, label: entry.label }))}
            />
            <InputField label="Part Number" value={itemForm.partNumber} onChange={(value) => setItemForm((current) => ({ ...current, partNumber: value }))} />
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700 md:col-span-2">
              <div className="mb-1 flex flex-wrap items-center gap-2">
                <span className="font-semibold text-ink-800">Suggested Category:</span>
                <span className="rounded-full border border-slate-300 bg-white px-2 py-0.5 text-[11px]">
                  {categorySuggestion.suggestedCategory
                    ? formatInventoryCategory(categorySuggestion.suggestedCategory)
                    : "No strong match"}
                </span>
                <span className="rounded-full border border-slate-300 bg-white px-2 py-0.5 text-[11px]">
                  Confidence: {categorySuggestion.confidenceLabel}
                </span>
                {suggestionLoading && <span className="text-[11px] text-slate-500">Analyzing...</span>}
              </div>
              <p>{categorySuggestion.reason}</p>
              {categorySuggestion.similarItems.length > 0 && (
                <p className="mt-1 text-[11px] text-slate-600">
                  Similar items:{" "}
                  {categorySuggestion.similarItems
                    .slice(0, 3)
                    .map((entry) => `${entry.name} (${formatInventoryCategory(entry.category)})`)
                    .join(", ")}
                </p>
              )}
              {categorySuggestion.suggestedCategory && categorySuggestion.confidence !== "NONE" && (
                <div className="mt-2">
                  <button
                    type="button"
                    onClick={() =>
                      setItemForm((current) => ({
                        ...current,
                        category: categorySuggestion.suggestedCategory || current.category
                      }))
                    }
                    className="rounded border border-brand-300 bg-brand-50 px-2 py-1 text-[11px] text-brand-800 hover:bg-brand-100"
                  >
                    Use suggested category
                  </button>
                </div>
              )}
              {suggestionMismatch && categorySuggestion.mismatchWarning && (
                <p className="mt-2 rounded border border-amber-300 bg-amber-50 px-2 py-1 text-[11px] text-amber-800">
                  {categorySuggestion.mismatchWarning}
                </p>
              )}
            </div>
            <InputField
              label="Custom Category Label (optional)"
              value={itemForm.customCategoryLabel}
              onChange={(value) => setItemForm((current) => ({ ...current, customCategoryLabel: value }))}
            />
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] text-slate-600">
              {itemForm.customCategoryLabel.trim()
                ? categorySuggestion.similarCategoryNames.length > 0
                  ? `Similar existing categories: ${categorySuggestion.similarCategoryNames.join(", ")}`
                  : "No close category name match found. This will be saved as a custom label in notes."
                : "Use this when no strong category match exists. Primary category still uses the controlled list."}
            </div>
            <InputField label="Quantity In Stock" type="number" value={itemForm.quantityInStock} onChange={(value) => setItemForm((current) => ({ ...current, quantityInStock: value }))} required />
            <InputField label="Minimum Stock" type="number" value={itemForm.minimumStockLevel} onChange={(value) => setItemForm((current) => ({ ...current, minimumStockLevel: value }))} required />
            <InputField label="Unit Cost" type="number" value={itemForm.unitCost} onChange={(value) => setItemForm((current) => ({ ...current, unitCost: value }))} required />
            <FilterSelect
              label="Status"
              value={itemForm.status}
              onChange={(value) => setItemForm((current) => ({ ...current, status: value as "ACTIVE" | "INACTIVE" }))}
              options={[
                { value: "ACTIVE", label: "Active" },
                { value: "INACTIVE", label: "Inactive" }
              ]}
            />
            <FilterSelect
              label="Supplier"
              value={itemForm.supplierId}
              onChange={(value) => setItemForm((current) => ({ ...current, supplierId: value }))}
              options={[
                { value: "", label: "No supplier" },
                ...suppliers.map((supplier) => ({ value: supplier.id, label: supplier.name }))
              ]}
            />
            <FilterSelect
              label="Location"
              value={itemForm.locationId}
              onChange={(value) => setItemForm((current) => ({ ...current, locationId: value }))}
              options={[
                { value: "", label: "No location" },
                ...locations.map((location) => ({ value: location.id, label: location.name }))
              ]}
            />
            <FilterSelect
              label="Compatible Rig"
              value={itemForm.compatibleRigId}
              onChange={(value) => setItemForm((current) => ({ ...current, compatibleRigId: value }))}
              options={[
                { value: "", label: "Any rig" },
                ...rigs.map((rig) => ({ value: rig.id, label: rig.rigCode }))
              ]}
            />
            <InputField label="Compatible Rig Type" value={itemForm.compatibleRigType} onChange={(value) => setItemForm((current) => ({ ...current, compatibleRigType: value }))} />
            <label className="text-xs text-ink-700 md:col-span-2">
              <span className="mb-1 block uppercase tracking-wide text-slate-500">Description / Notes</span>
              <textarea
                value={itemForm.description}
                onChange={(event) => setItemForm((current) => ({ ...current, description: event.target.value }))}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                rows={3}
              />
            </label>
            <div className="md:col-span-2">
              <button
                type="submit"
                disabled={savingItem}
                className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {savingItem ? "Saving..." : "Create Item"}
              </button>
            </div>
          </form>
        </Card>
      )}
    </section>
  );
}

export function InventorySuppliersLocationsSection({
  canManage,
  showSuppliers,
  showLocations,
  focusedSectionId,
  supplierForm,
  setSupplierForm,
  submitSupplierForm,
  savingSupplier,
  suppliers,
  locationForm,
  setLocationForm,
  submitLocationForm,
  savingLocation,
  locations,
  toIsoDate
}: {
  canManage: boolean;
  showSuppliers: boolean;
  showLocations: boolean;
  focusedSectionId: string | null;
  supplierForm: SupplierFormState;
  setSupplierForm: Dispatch<SetStateAction<SupplierFormState>>;
  submitSupplierForm: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  savingSupplier: boolean;
  suppliers: InventorySupplier[];
  locationForm: LocationFormState;
  setLocationForm: Dispatch<SetStateAction<LocationFormState>>;
  submitLocationForm: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  savingLocation: boolean;
  locations: InventoryLocation[];
  toIsoDate: (value: string) => string;
}) {
  if (!canManage || (!showSuppliers && !showLocations)) {
    return null;
  }

  return (
    <section className="grid min-w-0 items-start gap-4 xl:grid-cols-2">
      {showSuppliers && (
        <div
          id="inventory-suppliers-section"
          className={cn(
            focusedSectionId === "inventory-suppliers-section" &&
              "rounded-2xl ring-2 ring-indigo-100 ring-offset-2 ring-offset-slate-50"
          )}
        >
          <Card className="min-w-0" title="Suppliers" subtitle="Track supplier contacts and purchasing activity">
            <form onSubmit={submitSupplierForm} className="mb-3 grid gap-2 md:grid-cols-2">
              <InputField label="Supplier Name" value={supplierForm.name} onChange={(value) => setSupplierForm((current) => ({ ...current, name: value }))} required />
              <InputField label="Contact Person" value={supplierForm.contactPerson} onChange={(value) => setSupplierForm((current) => ({ ...current, contactPerson: value }))} />
              <InputField label="Email" value={supplierForm.email} onChange={(value) => setSupplierForm((current) => ({ ...current, email: value }))} />
              <InputField label="Phone" value={supplierForm.phone} onChange={(value) => setSupplierForm((current) => ({ ...current, phone: value }))} />
              <label className="text-xs text-ink-700 md:col-span-2">
                <span className="mb-1 block uppercase tracking-wide text-slate-500">Notes</span>
                <textarea
                  value={supplierForm.notes}
                  onChange={(event) => setSupplierForm((current) => ({ ...current, notes: event.target.value }))}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  rows={2}
                />
              </label>
              <div className="md:col-span-2">
                <button
                  type="submit"
                  disabled={savingSupplier}
                  className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm text-ink-800 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {savingSupplier ? "Saving..." : "Add Supplier"}
                </button>
              </div>
            </form>

            <DataTable
              className="border-slate-200/70"
              columns={["Supplier", "Items", "Purchases", "Total Cost", "Latest Purchase"]}
              rows={suppliers.slice(0, 12).map((supplier) => [
                supplier.name,
                String(supplier.itemCount),
                String(supplier.purchaseCount),
                formatCurrency(supplier.totalPurchaseCost || 0),
                supplier.latestPurchaseDate ? toIsoDate(supplier.latestPurchaseDate) : "-"
              ])}
            />
          </Card>
        </div>
      )}

      {showLocations && (
        <div
          id="inventory-locations-section"
          className={cn(
            focusedSectionId === "inventory-locations-section" &&
              "rounded-2xl ring-2 ring-indigo-100 ring-offset-2 ring-offset-slate-50"
          )}
        >
          <Card className="min-w-0" title="Locations" subtitle="Warehouse and site stock locations">
            <form onSubmit={submitLocationForm} className="mb-3 grid gap-2 md:grid-cols-2">
              <InputField label="Location Name" value={locationForm.name} onChange={(value) => setLocationForm((current) => ({ ...current, name: value }))} required />
              <InputField label="Description" value={locationForm.description} onChange={(value) => setLocationForm((current) => ({ ...current, description: value }))} />
              <div className="md:col-span-2">
                <button
                  type="submit"
                  disabled={savingLocation}
                  className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm text-ink-800 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {savingLocation ? "Saving..." : "Add Location"}
                </button>
              </div>
            </form>

            <DataTable
              className="border-slate-200/70"
              columns={["Location", "Items", "Status", "Description"]}
              rows={locations.slice(0, 12).map((location) => [
                location.name,
                String(location.itemCount),
                location.isActive ? "Active" : "Inactive",
                location.description || "-"
              ])}
            />
          </Card>
        </div>
      )}
    </section>
  );
}

export { InventoryOverviewSection } from "./inventory-overview-section";
export { InventoryItemsSection } from "./inventory-items-section";

export function UsageRequestToast({
  toast,
  onDismiss
}: {
  toast:
    | {
        tone: "success" | "error";
        message: string;
      }
    | null;
  onDismiss: () => void;
}) {
  if (!toast) {
    return null;
  }

  return (
    <aside className="pointer-events-none fixed bottom-5 right-5 z-[91] w-[min(420px,calc(100vw-2rem))]">
      <div
        className={cn(
          "pointer-events-auto rounded-2xl border px-3.5 py-3 shadow-[0_16px_36px_rgba(15,23,42,0.16)] backdrop-blur-sm",
          toast.tone === "success"
            ? "border-emerald-200 bg-white/95 text-emerald-900"
            : "border-red-200 bg-white/95 text-red-900"
        )}
      >
        <p className="text-xs font-semibold uppercase tracking-wide">
          {toast.tone === "success" ? "Usage Request Submitted" : "Usage Request Update"}
        </p>
        <p className="mt-1 text-sm leading-5">{toast.message}</p>
        <button
          type="button"
          onClick={onDismiss}
          className="mt-2 text-xs font-semibold underline underline-offset-2"
        >
          Dismiss
        </button>
      </div>
    </aside>
  );
}
