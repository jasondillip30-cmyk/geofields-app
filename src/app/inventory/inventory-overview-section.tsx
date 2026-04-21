"use client";

import {
  movementItemLabel,
  toIsoDate
} from "@/components/inventory/inventory-page-utils";
import { Card, MetricCard } from "@/components/ui/card";
import { InventoryValueStatisticsCard } from "@/components/ui/statistics-card-5";
import { DataTable } from "@/components/ui/table";
import { formatInventoryCategory, formatMovementType } from "@/lib/inventory";
import { formatCurrency, formatNumber } from "@/lib/utils";

import type {
  InventoryMovementRow,
  InventoryOverviewResponse
} from "./inventory-page-types";

export function InventoryOverviewSection({
  showOverview,
  isSingleProjectScope,
  canViewInventoryValue = true,
  overview,
  movements,
  recognizedProjectCostRows
}: {
  showOverview: boolean;
  isSingleProjectScope: boolean;
  canViewInventoryValue?: boolean;
  overview: InventoryOverviewResponse;
  movements: InventoryMovementRow[];
  recognizedProjectCostRows: InventoryMovementRow[];
}) {
  if (!showOverview) {
    return null;
  }

  const inventoryValueSegments =
    overview.analytics.inventoryValueByCategory.length > 0
      ? overview.analytics.inventoryValueByCategory
      : overview.analytics.highestCostCategories.map((entry) => ({
          category: entry.category,
          label: formatInventoryCategory(entry.category),
          value: entry.cost,
          percent: entry.percentOfTotal
        }));
  const lowStockRows = overview.lowStockItems.map((item) => ({
    ...item,
    severity: item.quantityInStock <= Math.max(1, item.minimumStockLevel * 0.5) ? "CRITICAL" as const : "LOW" as const
  }));

  return (
    <>
      <section className="grid gap-3 lg:grid-cols-2">
        {isSingleProjectScope ? (
          <>
            <div className="rounded-xl border border-brand-200 bg-brand-50/75 px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-brand-800">
                Project-linked activity
              </p>
              <p className="mt-1 text-sm text-brand-900">
                This view focuses on approved, available, and used inventory for the locked project.
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                Global warehouse stock
              </p>
              <p className="text-xs text-slate-700">
                Supporting context only. Warehouse stock remains global and is not owned by this project.
              </p>
            </div>
          </>
        ) : (
          <>
            <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Global warehouse stock
              </p>
              <p className="mt-1 text-sm text-slate-700">
                Stock levels and inventory value below are global across warehouse locations.
              </p>
            </div>
            <div className="rounded-xl border border-brand-200 bg-brand-50/70 px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-brand-800">
                Activity scope
              </p>
              <p className="mt-1 text-sm text-brand-900">
                Movement activity follows your current filters.
              </p>
            </div>
          </>
        )}
      </section>

      {isSingleProjectScope && (
        <>
          <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <MetricCard label="Approved Items" value={String(overview.projectLinked?.approvedItems || 0)} />
            <MetricCard
              label="Available Approved Quantity"
              value={formatNumber(overview.projectLinked?.availableApprovedQuantity || 0)}
              tone="good"
            />
            <MetricCard
              label="Available Approved Value"
              value={formatCurrency(overview.projectLinked?.availableApprovedValue || 0)}
              tone="good"
            />
            <MetricCard label="Used Quantity" value={formatNumber(overview.projectLinked?.usedQuantity || 0)} />
            <MetricCard
              label="Used Value"
              value={formatCurrency(overview.projectLinked?.usedValue || 0)}
            />
            <MetricCard
              label="Project-linked IN"
              value={formatNumber(overview.projectLinked?.projectLinkedIn || 0)}
            />
            <MetricCard
              label="Project-linked OUT"
              value={formatNumber(overview.projectLinked?.projectLinkedOut || 0)}
            />
            <MetricCard
              label="Recognized Inventory Cost (Project)"
              value={formatCurrency(overview.projectLinked?.recognizedInventoryCost || 0)}
              tone="warn"
            />
          </section>
          <section className="rounded-xl border border-brand-200 bg-brand-50/70 px-4 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-brand-800">
              Project usage status
            </p>
            <p className="mt-1 text-sm text-brand-900">
              Usage requests recorded for this project:{" "}
              {formatNumber(overview.projectLinked?.requestContext.total || 0)}. Requests set what can be used.
              Used quantity and used value above show actual project use.
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <span className="gf-context-chip">
                Approved: {formatNumber(overview.projectLinked?.requestContext.approved || 0)}
              </span>
              <span className="gf-context-chip">
                Submitted: {formatNumber(overview.projectLinked?.requestContext.submitted || 0)}
              </span>
              <span className="gf-context-chip">
                Rejected: {formatNumber(overview.projectLinked?.requestContext.rejected || 0)}
              </span>
            </div>
          </section>
          {canViewInventoryValue ? (
            <section>
              <InventoryValueStatisticsCard
                totalValue={overview.overview.totalInventoryValue}
                segments={inventoryValueSegments}
                lowStockRows={lowStockRows}
                outOfStockRows={overview.outOfStockItems}
              />
            </section>
          ) : null}
        </>
      )}

      {!isSingleProjectScope && (
        <>
          <section className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
            <MetricCard label="Total Items" value={String(overview.overview.totalItems)} />
            <MetricCard label="Units In Stock" value={formatNumber(overview.overview.totalUnitsInStock)} />
            <MetricCard
              label="Low Stock"
              value={String(overview.overview.lowStockCount)}
              tone={overview.overview.lowStockCount > 0 ? "warn" : "neutral"}
            />
            <MetricCard
              label="Out of Stock"
              value={String(overview.overview.outOfStockCount)}
              tone={overview.overview.outOfStockCount > 0 ? "danger" : "neutral"}
            />
            <MetricCard label="Recent Movements" value={String(movements.length)} />
          </section>
          {canViewInventoryValue ? (
            <section>
              <InventoryValueStatisticsCard
                totalValue={overview.overview.totalInventoryValue}
                segments={inventoryValueSegments}
                lowStockRows={lowStockRows}
                outOfStockRows={overview.outOfStockItems}
              />
            </section>
          ) : null}
        </>
      )}

      <section className="grid min-w-0 items-start gap-4 xl:grid-cols-2">
        <Card
          className="min-w-0"
          title="Recent Stock Movements"
          subtitle={
            isSingleProjectScope
              ? "Project-linked movement activity for the locked project."
              : "Latest movement entries in current filter scope."
          }
        >
          {movements.length === 0 ? (
            <p className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-4 text-sm text-ink-600">
              {isSingleProjectScope
                ? "No project-linked stock movements found for this project."
                : "No stock movements in current scope."}
            </p>
          ) : (
            <DataTable
              className="border-slate-200/70"
              columns={["Date", "Item", "Type", "Qty", "Cost"]}
              rows={movements.slice(0, 8).map((movement) => [
                toIsoDate(movement.date),
                movementItemLabel(movement),
                formatMovementType(movement.movementType),
                formatNumber(movement.quantity),
                formatCurrency(movement.totalCost || 0)
              ])}
            />
          )}
        </Card>
        {isSingleProjectScope ? (
          <Card
            className="min-w-0"
            title="Recent Recognized Costs"
            subtitle="Recognized inventory costs linked to project usage."
          >
            {recognizedProjectCostRows.length === 0 ? (
              <p className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-4 text-sm text-ink-600">
                No recognized project-linked inventory costs found in this scope.
              </p>
            ) : (
              <DataTable
                className="border-slate-200/70"
                columns={["Date", "Item", "Qty", "Cost"]}
                rows={recognizedProjectCostRows.map((movement) => [
                  toIsoDate(movement.date),
                  movementItemLabel(movement),
                  formatNumber(movement.quantity),
                  formatCurrency(movement.totalCost || 0)
                ])}
              />
            )}
          </Card>
        ) : null}
      </section>
    </>
  );
}
