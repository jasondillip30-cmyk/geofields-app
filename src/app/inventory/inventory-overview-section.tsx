"use client";

import {
  movementItemLabel,
  toIsoDate
} from "@/components/inventory/inventory-page-utils";
import {
  IssueSeverityBadge,
  StockSeverityBadge
} from "@/components/inventory/inventory-page-shared";
import { Card, MetricCard } from "@/components/ui/card";
import { DataTable } from "@/components/ui/table";
import { formatMovementType } from "@/lib/inventory";
import { cn, formatCurrency, formatNumber } from "@/lib/utils";

import type {
  InventoryIssuesResponse,
  InventoryMovementRow,
  InventoryOverviewResponse
} from "./inventory-page-types";

export function InventoryOverviewSection({
  showOverview,
  isSingleProjectScope,
  focusedSectionId,
  overview,
  stockAlertRows,
  movements,
  issuesResponse,
  recognizedProjectCostRows
}: {
  showOverview: boolean;
  isSingleProjectScope: boolean;
  focusedSectionId: string | null;
  overview: InventoryOverviewResponse;
  stockAlertRows: Array<{
    id: string;
    name: string;
    sku: string;
    quantityInStock: number;
    minimumStockLevel: number;
    severity: "LOW" | "CRITICAL";
  }>;
  movements: InventoryMovementRow[];
  issuesResponse: InventoryIssuesResponse;
  recognizedProjectCostRows: InventoryMovementRow[];
}) {
  if (!showOverview) {
    return null;
  }

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
                Movement and issue activity follows your current filters.
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
        </>
      )}

      {!isSingleProjectScope && (
        <>
          <section className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
            <MetricCard label="Total Items" value={String(overview.overview.totalItems)} />
            <MetricCard label="Units In Stock" value={formatNumber(overview.overview.totalUnitsInStock)} />
            <MetricCard
              label="Inventory Value"
              value={formatCurrency(overview.overview.totalInventoryValue)}
              tone="good"
            />
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
          <section
            id="inventory-low-stock-section"
            className={cn(
              focusedSectionId === "inventory-low-stock-section" &&
                "rounded-2xl ring-2 ring-indigo-100 ring-offset-2 ring-offset-slate-50"
            )}
          >
            <Card
              className="min-w-0"
              title="Low Stock Alerts"
              subtitle="Global warehouse stock items requiring replenishment."
            >
              <div className="space-y-3">
                {stockAlertRows.length === 0 ? (
                  <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-3 text-sm text-emerald-800">
                    Global warehouse stock health is good.
                  </p>
                ) : (
                  <div className="overflow-hidden rounded-lg border border-slate-200">
                    <div className="max-h-64 overflow-auto">
                      <table className="min-w-full text-left text-sm">
                        <thead className="sticky top-0 z-10 bg-slate-50 text-xs uppercase tracking-wide text-slate-600">
                          <tr>
                            <th className="px-3 py-2">Item</th>
                            <th className="px-3 py-2">SKU</th>
                            <th className="px-3 py-2 text-right">Current</th>
                            <th className="px-3 py-2 text-right">Minimum</th>
                            <th className="px-3 py-2">Severity</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 bg-white">
                          {stockAlertRows.slice(0, 30).map((item) => (
                            <tr key={item.id}>
                              <td className="px-3 py-2 text-ink-800">{item.name}</td>
                              <td className="px-3 py-2 text-ink-700">{item.sku}</td>
                              <td className="px-3 py-2 text-right text-ink-700">
                                {formatNumber(item.quantityInStock)}
                              </td>
                              <td className="px-3 py-2 text-right text-ink-700">
                                {formatNumber(item.minimumStockLevel)}
                              </td>
                              <td className="px-3 py-2">
                                <StockSeverityBadge severity={item.severity} />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                  {overview.analytics.recommendations.length === 0
                    ? "No global stock recommendations right now."
                    : overview.analytics.recommendations.join(" ")}
                </div>
              </div>
            </Card>
          </section>
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
        ) : (
          <Card
            className="min-w-0"
            title="Recent Inventory Issues"
            subtitle="Top-priority data quality issues to resolve."
          >
            {issuesResponse.issues.length === 0 ? (
              <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-3 text-sm text-emerald-800">
                No major inventory inconsistencies detected in current scope.
              </p>
            ) : (
              <div className="space-y-2">
                {issuesResponse.issues.slice(0, 6).map((issue) => (
                  <div key={`overview-issue-${issue.id}`} className="rounded border border-slate-200 bg-slate-50 px-3 py-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <IssueSeverityBadge severity={issue.severity} />
                      <p className="text-sm font-semibold text-ink-900">{issue.title}</p>
                    </div>
                    <p className="mt-1 text-xs text-slate-700">{issue.message}</p>
                  </div>
                ))}
              </div>
            )}
          </Card>
        )}
      </section>
    </>
  );
}
