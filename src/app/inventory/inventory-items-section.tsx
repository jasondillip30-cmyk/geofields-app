"use client";

import type { Dispatch, SetStateAction } from "react";
import { Eye } from "lucide-react";

import {
  formatUsageBatchDecision,
  formatUsageRequestDecision,
  toIsoDate
} from "@/components/inventory/inventory-page-utils";
import {
  FilterSelect,
  UsageRequestStatusBadge
} from "@/components/inventory/inventory-page-shared";
import { Card } from "@/components/ui/card";
import { DataTable } from "@/components/ui/table";
import { formatInventoryCategory, inventoryCategoryOptions } from "@/lib/inventory";
import { cn, formatCurrency, formatNumber } from "@/lib/utils";

import type {
  InventoryItemRow,
  InventoryLocation,
  InventorySupplier,
  InventoryUsageBatchRow,
  InventoryUsageRequestRow
} from "./inventory-page-types";

export function InventoryItemsSection({
  showItems,
  focusedSectionId,
  isSingleProjectScope,
  createFromDeepLinkBlocked,
  canManage,
  showCreateItemForm,
  setShowCreateItemForm,
  itemSearch,
  setItemSearch,
  itemCategoryFilter,
  setItemCategoryFilter,
  supplierFilter,
  setSupplierFilter,
  locationFilter,
  setLocationFilter,
  stockFilter,
  setStockFilter,
  suppliers,
  locations,
  loading,
  items,
  focusedRowId,
  openItemDetail,
  projectUsageSummary,
  usageRequestStatusFilter,
  setUsageRequestStatusFilter,
  usageRequestsLoading,
  myUsageRequests,
  usageBatchStatusFilter,
  setUsageBatchStatusFilter,
  usageBatchRequestsLoading,
  myUsageBatchRequests,
  openUsageBatchDetail,
  openMovementDetail
}: {
  showItems: boolean;
  focusedSectionId: string | null;
  isSingleProjectScope: boolean;
  createFromDeepLinkBlocked: boolean;
  canManage: boolean;
  showCreateItemForm: boolean;
  setShowCreateItemForm: Dispatch<SetStateAction<boolean>>;
  itemSearch: string;
  setItemSearch: Dispatch<SetStateAction<string>>;
  itemCategoryFilter: string;
  setItemCategoryFilter: Dispatch<SetStateAction<string>>;
  supplierFilter: string;
  setSupplierFilter: Dispatch<SetStateAction<string>>;
  locationFilter: string;
  setLocationFilter: Dispatch<SetStateAction<string>>;
  stockFilter: string;
  setStockFilter: Dispatch<SetStateAction<string>>;
  suppliers: InventorySupplier[];
  locations: InventoryLocation[];
  loading: boolean;
  items: InventoryItemRow[];
  focusedRowId: string | null;
  openItemDetail: (itemId: string) => void;
  projectUsageSummary: {
    approvedItems: number;
    availableQuantity: number;
    availableValue: number;
    usedQuantity: number;
    usedValue: number;
  } | null;
  usageRequestStatusFilter: "ALL" | "SUBMITTED" | "PENDING" | "APPROVED" | "REJECTED";
  setUsageRequestStatusFilter: Dispatch<
    SetStateAction<"ALL" | "SUBMITTED" | "PENDING" | "APPROVED" | "REJECTED">
  >;
  usageRequestsLoading: boolean;
  myUsageRequests: InventoryUsageRequestRow[];
  usageBatchStatusFilter:
    | "ALL"
    | "SUBMITTED"
    | "PENDING"
    | "APPROVED"
    | "REJECTED"
    | "PARTIALLY_APPROVED";
  setUsageBatchStatusFilter: Dispatch<
    SetStateAction<
      "ALL" | "SUBMITTED" | "PENDING" | "APPROVED" | "REJECTED" | "PARTIALLY_APPROVED"
    >
  >;
  usageBatchRequestsLoading: boolean;
  myUsageBatchRequests: InventoryUsageBatchRow[];
  openUsageBatchDetail: (batchId: string) => void;
  openMovementDetail: (movementId: string) => void;
}) {
  if (!showItems) {
    return null;
  }
  const visibleItems = items.slice(0, 50);
  const visibleUsageRequests = myUsageRequests.slice(0, 20);
  const visibleUsageBatchRequests = myUsageBatchRequests.slice(0, 20);

  return (
    <section
      id="inventory-items-section"
      className={cn(
        focusedSectionId === "inventory-items-section" && "rounded-2xl ring-2 ring-indigo-100 ring-offset-2 ring-offset-slate-50"
      )}
    >
      <Card className="min-w-0">
        <div className="space-y-4">
          {isSingleProjectScope ? (
            <div className="rounded-xl border border-brand-200 bg-brand-50/70 px-4 py-3 text-sm text-brand-900">
              Showing project-approved items for this locked project. Stock on hand remains global warehouse stock.
            </div>
          ) : null}
          {createFromDeepLinkBlocked ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              Switch to All projects mode to create a new catalog item.
            </div>
          ) : null}
          <div className="rounded-xl border border-slate-200/85 bg-slate-50/75 p-3.5">
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Filters</p>
              <p className="text-xs text-slate-500">
                {isSingleProjectScope
                  ? "Refine approved items by search and category"
                  : "Refine items by category, supplier, location, and stock status"}
              </p>
            </div>
            <div
              className={cn(
                "grid items-end gap-2 md:grid-cols-2",
                isSingleProjectScope
                  ? "xl:grid-cols-[2fr_minmax(0,1fr)]"
                  : "xl:grid-cols-[2fr_repeat(4,minmax(0,1fr))_auto]"
              )}
            >
              <label className="text-xs text-ink-700 xl:col-span-1">
                <span className="mb-1 block uppercase tracking-wide text-slate-500">Search</span>
                <input
                  type="text"
                  value={itemSearch}
                  onChange={(event) => setItemSearch(event.target.value)}
                  placeholder="Item name, SKU, part number"
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
              </label>
              <FilterSelect
                label="Category"
                value={itemCategoryFilter}
                onChange={setItemCategoryFilter}
                options={[
                  { value: "all", label: "All categories" },
                  ...inventoryCategoryOptions.map((entry) => ({ value: entry.value, label: entry.label }))
                ]}
              />
              {!isSingleProjectScope ? (
                <FilterSelect
                  label="Supplier"
                  value={supplierFilter}
                  onChange={setSupplierFilter}
                  options={[
                    { value: "all", label: "All suppliers" },
                    ...suppliers.map((supplier) => ({ value: supplier.id, label: supplier.name }))
                  ]}
                />
              ) : null}
              {!isSingleProjectScope ? (
                <FilterSelect
                  label="Location"
                  value={locationFilter}
                  onChange={setLocationFilter}
                  options={[
                    { value: "all", label: "All locations" },
                    ...locations.map((location) => ({ value: location.id, label: location.name }))
                  ]}
                />
              ) : null}
              {!isSingleProjectScope ? (
                <FilterSelect
                  label="Stock"
                  value={stockFilter}
                  onChange={setStockFilter}
                  options={[
                    { value: "all", label: "All stock" },
                    { value: "low", label: "Low stock" },
                    { value: "out", label: "Out of stock" },
                    { value: "healthy", label: "Healthy stock" }
                  ]}
                />
              ) : null}
              {canManage && !isSingleProjectScope && (
                <div className="flex justify-start xl:justify-end">
                  <button
                    type="button"
                    onClick={() => setShowCreateItemForm((current) => !current)}
                    className="gf-btn-primary px-3 py-1.5 text-xs"
                  >
                    {showCreateItemForm ? "Hide Create Form" : "Create New Item"}
                  </button>
                </div>
              )}
            </div>
          </div>

          {loading ? (
            <p className="text-sm text-ink-600">Loading inventory items...</p>
          ) : items.length === 0 ? (
            <p className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-4 text-sm text-ink-600">
              {isSingleProjectScope
                ? "No project-approved items found for this project in current filters."
                : "No inventory items found for current filters."}
            </p>
          ) : (
            <div className="space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Item List</p>
              <DataTable
                className="border-slate-200/70"
                columns={
                  isSingleProjectScope
                    ? [
                        "Item",
                        "SKU",
                        "Category",
                        "Warehouse Stock (Global)",
                        "Available for Project",
                        "Used on Project",
                        "Unit Cost",
                        "Action"
                      ]
                    : [
                        "Item",
                        "SKU",
                        "Category",
                        "Stock",
                        "Min",
                        "Unit Cost",
                        "Value",
                        "Supplier",
                        "Location",
                        "Status",
                        "Action"
                      ]
                }
                rows={visibleItems.map((item) => {
                  const actionCell = (
                    <button
                      key={`${item.id}-view`}
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        openItemDetail(item.id);
                      }}
                      className="gf-btn-subtle"
                    >
                      <span className="inline-flex items-center gap-1">
                        <Eye size={13} />
                        View
                      </span>
                    </button>
                  );
                  if (isSingleProjectScope) {
                    return [
                      item.name,
                      item.sku,
                      formatInventoryCategory(item.category),
                      `${formatNumber(item.quantityInStock)} (global)`,
                      formatNumber(item.approvedProjectContext?.availableApprovedQuantity || 0),
                      formatNumber(item.approvedProjectContext?.usedQuantity || 0),
                      formatCurrency(item.unitCost),
                      actionCell
                    ];
                  }
                  return [
                    item.name,
                    item.sku,
                    formatInventoryCategory(item.category),
                    `${formatNumber(item.quantityInStock)}${item.outOfStock ? " (Out)" : item.lowStock ? " (Low)" : ""}`,
                    formatNumber(item.minimumStockLevel),
                    formatCurrency(item.unitCost),
                    formatCurrency(item.inventoryValue),
                    item.supplier?.name || "-",
                    item.location?.name || "-",
                    item.status,
                    actionCell
                  ];
                })}
                rowIds={visibleItems.map((item) => `ai-focus-${item.id}`)}
                rowClassNames={visibleItems.map((item) =>
                  focusedRowId === item.id ? "bg-indigo-50 ring-1 ring-inset ring-indigo-200" : ""
                )}
                onRowClick={(rowIndex) => openItemDetail(visibleItems[rowIndex]?.id || "")}
              />

              {isSingleProjectScope ? (
                <div className="mt-3 rounded-xl border border-brand-200 bg-brand-50/65 p-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-brand-800">
                    Project usage summary
                  </p>
                  <p className="mt-1 text-sm text-brand-900">
                    Approved items: {formatNumber(projectUsageSummary?.approvedItems || 0)} | Available quantity:{" "}
                    {formatNumber(projectUsageSummary?.availableQuantity || 0)} | Available value:{" "}
                    {formatCurrency(projectUsageSummary?.availableValue || 0)} | Used quantity:{" "}
                    {formatNumber(projectUsageSummary?.usedQuantity || 0)} | Used value:{" "}
                    {formatCurrency(projectUsageSummary?.usedValue || 0)}
                  </p>
                </div>
              ) : null}

              <div className="mt-3 rounded-xl border border-slate-200/85 bg-slate-50/65 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                      My Usage Requests
                    </p>
                    <p className="text-xs text-slate-600">
                      Single-item requests and batch requests are both shown here with line-level outcomes.
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-1">
                    {(["ALL", "SUBMITTED", "PENDING", "APPROVED", "REJECTED"] as const).map((statusOption) => (
                      <button
                        key={`usage-status-${statusOption}`}
                        type="button"
                        onClick={() => setUsageRequestStatusFilter(statusOption)}
                        className={cn(
                          "rounded-full border px-2 py-0.5 text-[11px] font-semibold transition-colors",
                          usageRequestStatusFilter === statusOption
                            ? "border-brand-300 bg-brand-50 text-brand-800"
                            : "border-slate-300 bg-white text-slate-600 hover:border-slate-400 hover:text-slate-800"
                        )}
                      >
                        {statusOption === "ALL"
                          ? "All"
                          : statusOption.charAt(0) + statusOption.slice(1).toLowerCase()}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="mt-2">
                  {usageRequestsLoading ? (
                    <p className="text-sm text-slate-600">Loading your usage requests...</p>
                  ) : myUsageRequests.length === 0 ? (
                    <p className="rounded-lg border border-dashed border-slate-300 bg-white px-3 py-3 text-sm text-slate-600">
                      No single-item usage requests found in this status.
                    </p>
                  ) : (
                    <DataTable
                      className="border-slate-200/70"
                      columns={["Requested", "Item", "Qty", "Status", "Project / Rig", "Decision", "Action"]}
                      rows={visibleUsageRequests.map((requestRow) => [
                        toIsoDate(requestRow.createdAt),
                        requestRow.item ? `${requestRow.item.name} (${requestRow.item.sku})` : "-",
                        formatNumber(requestRow.quantity),
                        <UsageRequestStatusBadge key={`${requestRow.id}-status`} status={requestRow.status} />,
                        `${requestRow.project?.name || "-"} / ${requestRow.rig?.rigCode || requestRow.location?.name || "-"}`,
                        <span key={`${requestRow.id}-decision`} className="text-xs text-slate-700">
                          {formatUsageRequestDecision(requestRow)}
                        </span>,
                        <div key={`${requestRow.id}-actions`} className="flex flex-wrap gap-1">
                          {requestRow.item?.id ? (
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                openItemDetail(requestRow.item?.id || "");
                              }}
                              className="gf-btn-subtle"
                            >
                              Open item
                            </button>
                          ) : null}
                          {requestRow.approvedMovementId ? (
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                openMovementDetail(requestRow.approvedMovementId || "");
                              }}
                              className="gf-btn-subtle"
                            >
                              Open movement
                            </button>
                          ) : null}
                          {!requestRow.item?.id && !requestRow.approvedMovementId ? "-" : null}
                        </div>
                      ])}
                      onRowClick={(rowIndex) => openItemDetail(visibleUsageRequests[rowIndex]?.item?.id || "")}
                    />
                  )}
                </div>

                <div className="mt-4 border-t border-slate-200 pt-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                        My Batch Requests
                      </p>
                      <p className="text-xs text-slate-600">
                        First submitted as one batch, then decided per line by approver.
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-1">
                      {(
                        [
                          "ALL",
                          "SUBMITTED",
                          "PENDING",
                          "APPROVED",
                          "PARTIALLY_APPROVED",
                          "REJECTED"
                        ] as const
                      ).map((statusOption) => (
                        <button
                          key={`usage-batch-status-${statusOption}`}
                          type="button"
                          onClick={() => setUsageBatchStatusFilter(statusOption)}
                          className={cn(
                            "rounded-full border px-2 py-0.5 text-[11px] font-semibold transition-colors",
                            usageBatchStatusFilter === statusOption
                              ? "border-brand-300 bg-brand-50 text-brand-800"
                              : "border-slate-300 bg-white text-slate-600 hover:border-slate-400 hover:text-slate-800"
                          )}
                        >
                          {statusOption === "ALL"
                            ? "All"
                            : statusOption === "PARTIALLY_APPROVED"
                              ? "Partial"
                              : statusOption.charAt(0) + statusOption.slice(1).toLowerCase()}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="mt-2">
                    {usageBatchRequestsLoading ? (
                      <p className="text-sm text-slate-600">Loading your batch requests...</p>
                    ) : myUsageBatchRequests.length === 0 ? (
                      <p className="rounded-lg border border-dashed border-slate-300 bg-white px-3 py-3 text-sm text-slate-600">
                        No batch usage requests found in this status.
                      </p>
                    ) : (
                      <DataTable
                        className="border-slate-200/70"
                        columns={["Requested", "Batch", "Lines", "Status", "Project / Rig", "Decision", "Action"]}
                        rows={visibleUsageBatchRequests.map((batchRow) => [
                          toIsoDate(batchRow.createdAt),
                          batchRow.batchCode,
                          `${formatNumber(batchRow.summary.lineCount)} item(s) • Qty ${formatNumber(batchRow.summary.totalQuantity)}`,
                          <UsageRequestStatusBadge key={`${batchRow.id}-status`} status={batchRow.status} />,
                          `${batchRow.project?.name || "-"} / ${batchRow.rig?.rigCode || batchRow.location?.name || "-"}`,
                          <span key={`${batchRow.id}-decision`} className="text-xs text-slate-700">
                            {formatUsageBatchDecision(batchRow)}
                          </span>,
                          <button
                            key={`${batchRow.id}-action`}
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              openUsageBatchDetail(batchRow.id);
                            }}
                            className="gf-btn-subtle"
                          >
                            View batch
                          </button>
                        ])}
                        onRowClick={(rowIndex) =>
                          openUsageBatchDetail(visibleUsageBatchRequests[rowIndex]?.id || "")
                        }
                      />
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </Card>
    </section>
  );
}
