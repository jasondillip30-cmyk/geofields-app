import Link from "next/link";
import { useEffect, useState } from "react";

import { movementItemLabel, toIsoDate } from "@/components/inventory/inventory-page-utils";
import { Card } from "@/components/ui/card";
import { DataTable } from "@/components/ui/table";
import { canCreateShortageReplenishment, replenishmentLabels } from "@/lib/inventory-shortage-workflow";
import type { RequisitionStatus } from "@/lib/requisition-workflow";
import { formatCurrency, formatNumber } from "@/lib/utils";

import type { InventoryMovementRow, InventoryOverviewResponse, InventoryUsageRequestRow } from "./inventory-page-types";

type WorkshopShortageRow = InventoryUsageRequestRow & { replenishmentStatus: RequisitionStatus | null };

export function WorkshopStockPriority({ overview, loading, onOpenItem, canOpenPurchases }: {
  overview: InventoryOverviewResponse | null;
  loading: boolean;
  onOpenItem: (id: string) => void;
  canOpenPurchases: (row: InventoryUsageRequestRow) => boolean;
}) {
  const [shortages, setShortages] = useState<WorkshopShortageRow[] | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    if (loading) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch("/api/inventory/usage-requests?status=WAITING_FOR_STOCK", {
          cache: "no-store", signal: controller.signal
        });
        if (!response.ok) throw new Error("Could not load shortage requests.");
        const payload: { data: WorkshopShortageRow[] } = await response.json();
        if (!controller.signal.aborted) {
          setShortages(payload.data);
          setUnavailable(false);
        }
      } catch {
        if (!controller.signal.aborted) setUnavailable(true);
      }
    })();
    return () => controller.abort();
  }, [loading]);

  return (
    <Card title="Stock needs attention">
      <div className="grid gap-3 md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <section className="min-w-0 rounded-xl border border-brand-100 bg-brand-50/40 px-3 py-2">
          <h4 className="flex flex-wrap items-center gap-2 text-sm font-semibold text-ink-900">
            Waiting for stock
            {shortages && !unavailable && (
              <span className="rounded-full bg-white px-2 py-0.5 text-xs tabular-nums text-brand-900">{formatNumber(shortages.length)}</span>
            )}
          </h4>
          {unavailable ? <p className="mt-1 text-xs text-slate-700">Shortage requests could not be loaded.</p>
            : shortages === null ? <p role="status" className="mt-1 text-xs text-slate-700">Loading shortage requests...</p>
              : shortages.length === 0 ? <p className="mt-1 text-xs text-slate-700">No visible requests are waiting for stock.</p>
                : (
                  <ul className="mt-1 divide-y divide-brand-100 text-sm">
                    {shortages.slice(0, 5).map((row) => (
                      <li key={row.id} className="py-2">
                        <p className="break-words font-medium text-ink-900">{row.item?.name || "Inventory item"}</p>
                        <p className="break-words text-xs text-slate-700">Requested: {formatNumber(row.quantity)}{row.project ? ` · ${row.project.name}` : ""}</p>
                        {row.replenishmentRequisitionId && (
                          <p className="mt-1 text-xs font-semibold text-brand-900">
                            {row.replenishmentStatus ? replenishmentLabels[row.replenishmentStatus] : "Replenishment status unavailable"}
                          </p>
                        )}
                        {canOpenPurchases(row) && canCreateShortageReplenishment(row) && (
                          <Link className="inline-flex min-h-11 items-center text-xs font-semibold text-brand-700 underline underline-offset-4"
                            href={`/expenses?workspace=workshop&shortageRequestId=${encodeURIComponent(row.id)}`}>Open shortage in Purchase Requests</Link>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
          {!unavailable && shortages && shortages.length > 5 && <p className="mt-1 text-xs text-slate-700">Showing 5 of {formatNumber(shortages.length)}.</p>}
        </section>
        <section className="min-w-0 px-1 md:px-2">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-600">Warehouse stock</h4>
          <div className="mt-1 divide-y divide-slate-200">
            <StockList title="Out of stock" count={overview?.overview.outOfStockCount} loading={loading}
              items={(overview?.outOfStockItems ?? []).map((item) => ({ ...item, note: `${formatNumber(item.minimumStockLevel)} minimum` }))}
              onOpenItem={onOpenItem} />
            <StockList title="Low stock" count={overview?.overview.lowStockCount} loading={loading}
              items={(overview?.lowStockItems ?? []).map((item) => ({ ...item, note: `${formatNumber(item.quantityInStock)} on hand · minimum ${formatNumber(item.minimumStockLevel)}` }))}
              onOpenItem={onOpenItem} />
          </div>
        </section>
      </div>
    </Card>
  );
}

function StockList({ title, count, loading, items, onOpenItem }: {
  title: string;
  count?: number;
  loading: boolean;
  items: Array<{ id: string; name: string; note: string }>;
  onOpenItem: (id: string) => void;
}) {
  return (
    <section className="min-w-0 py-2">
      <h5 className="flex items-center justify-between gap-2 text-sm font-semibold text-ink-900">
        {title}
        {!loading && count !== undefined && (
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs tabular-nums text-slate-700">{formatNumber(count)}</span>
        )}
      </h5>
      {loading ? <p role="status" className="mt-1 text-xs text-slate-700">Loading stock...</p>
        : count === undefined ? <p className="mt-1 text-xs text-slate-700">Stock levels could not be loaded.</p>
        : items.length === 0 ? null
          : (
            <ul className="mt-2 divide-y divide-slate-200">
              {items.slice(0, 5).map((item) => (
                <li key={item.id}>
                  <button type="button" className="block min-h-11 w-full break-words py-2 text-left text-sm text-brand-700 hover:underline"
                    onClick={() => onOpenItem(item.id)}>
                    {item.name}<span className="block text-xs text-ink-600">{item.note}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
      {!loading && count !== undefined && count > 5 && <p className="mt-2 text-xs text-ink-600">Showing 5 of {formatNumber(count)}. Use the Stock filter below for more.</p>}
    </section>
  );
}

export function ProjectInventoryPriority({ projectId, summary, movements, loading, canViewCost, movementsHref, onOpenMovement }: {
  projectId: string;
  summary: InventoryOverviewResponse["projectLinked"];
  movements: InventoryMovementRow[];
  loading: boolean;
  canViewCost: boolean;
  movementsHref: string;
  onOpenMovement: (id: string) => void;
}) {
  const issued = movements.filter((row) => row.project?.id === projectId && row.movementType === "OUT");
  const visible = issued.slice(0, 5);
  return (
    <Card title="Issued to this project" subtitle="Recorded stock OUT movements in the selected date range. Requests that have not issued stock are separate.">
      {loading ? <p role="status" className="text-sm text-ink-600">Loading project inventory...</p>
        : !summary ? <p className="text-sm text-ink-600">Project inventory totals are unavailable.</p>
          : (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-3 text-sm">
                <span className="gf-context-chip">Stock issues: {formatNumber(issued.length)}</span>
                {canViewCost && <span className="gf-context-chip">Recognized issue cost: {formatCurrency(summary.recognizedInventoryCost)}</span>}
              </div>
              {visible.length ? (
                <DataTable compact columns={canViewCost ? ["Date", "Item", "Issued", "Recognized cost"] : ["Date", "Item", "Issued"]}
                  rows={visible.map((row) => [
                    toIsoDate(row.date),
                    <button key={row.id} type="button" className="text-left font-medium text-brand-700 underline"
                      onClick={() => onOpenMovement(row.id)}>{movementItemLabel(row)}</button>,
                    formatNumber(row.quantity),
                    ...(canViewCost ? [row.expense?.approvalStatus === "APPROVED" ? formatCurrency(row.totalCost ?? 0) : "Not recognized"] : [])
                  ])} />
              ) : <p className="text-sm text-ink-600">No stock issues in this scope.</p>}
              <Link href={movementsHref} className="gf-btn-secondary inline-flex">Open stock movements</Link>
            </div>
          )}
    </Card>
  );
}
