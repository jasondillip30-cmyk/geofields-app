import Link from "next/link";
import { useEffect, useState } from "react";

import { movementItemLabel, toIsoDate } from "@/components/inventory/inventory-page-utils";
import { Card } from "@/components/ui/card";
import { DataTable } from "@/components/ui/table";
import { formatCurrency, formatNumber } from "@/lib/utils";

import type { InventoryMovementRow, InventoryOverviewResponse, InventoryUsageRequestRow } from "./inventory-page-types";

export function WorkshopStockPriority({ overview, loading, onOpenItem, canOpenPurchases }: {
  overview: InventoryOverviewResponse | null;
  loading: boolean;
  onOpenItem: (id: string) => void;
  canOpenPurchases: boolean;
}) {
  const [shortages, setShortages] = useState<InventoryUsageRequestRow[] | null>(null);
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
        const payload: { data: InventoryUsageRequestRow[] } = await response.json();
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
    <Card title="Stock needs attention" subtitle="Stock counts are warehouse-wide. Shortage requests show what you have access to review.">
      <div className="grid gap-3 md:grid-cols-3">
        <StockList title="Out of stock" count={overview?.overview.outOfStockCount} loading={loading}
          items={(overview?.outOfStockItems ?? []).map((item) => ({ ...item, note: `${formatNumber(item.minimumStockLevel)} minimum` }))}
          onOpenItem={onOpenItem} />
        <StockList title="Low stock" count={overview?.overview.lowStockCount} loading={loading}
          items={(overview?.lowStockItems ?? []).map((item) => ({ ...item, note: `${formatNumber(item.quantityInStock)} on hand · minimum ${formatNumber(item.minimumStockLevel)}` }))}
          onOpenItem={onOpenItem} />
        <section className="min-w-0 rounded-lg border border-slate-200 p-3">
          <h3 className="font-semibold text-ink-900">Waiting for stock{shortages && !unavailable ? ` (${formatNumber(shortages.length)})` : ""}</h3>
          {unavailable ? <p className="mt-2 text-sm text-ink-600">Shortage requests could not be loaded.</p>
            : shortages === null ? <p role="status" className="mt-2 text-sm text-ink-600">Loading shortage requests...</p>
              : shortages.length === 0 ? <p className="mt-2 text-sm text-ink-600">No visible requests are waiting for stock.</p>
                : (
                  <ul className="mt-2 divide-y divide-slate-200 text-sm">
                    {shortages.slice(0, 5).map((row) => (
                      <li key={row.id} className="py-2">
                        <p className="break-words font-medium text-ink-900">{row.item?.name || "Inventory item"}</p>
                        <p className="text-xs text-ink-600">Requested: {formatNumber(row.quantity)}{row.project ? ` · ${row.project.name}` : ""}</p>
                        {canOpenPurchases && (
                          <Link className="inline-block py-1 text-xs text-brand-700 underline"
                            href={`/expenses?workspace=workshop&shortageRequestId=${encodeURIComponent(row.id)}`}>Open shortage in Purchase Requests</Link>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
          {shortages && shortages.length > 5 && <p className="mt-2 text-xs text-ink-600">Showing 5 of {formatNumber(shortages.length)}.</p>}
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
    <section className="min-w-0 rounded-lg border border-slate-200 p-3">
      <h3 className="font-semibold text-ink-900">{title}{loading || count === undefined ? "" : ` (${formatNumber(count)})`}</h3>
      {loading ? <p role="status" className="mt-2 text-sm text-ink-600">Loading stock...</p>
        : count === undefined ? <p className="mt-2 text-sm text-ink-600">Stock levels could not be loaded.</p>
        : items.length === 0 ? <p className="mt-2 text-sm text-ink-600">None.</p>
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
