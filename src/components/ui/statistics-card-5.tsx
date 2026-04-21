"use client";

import { useMemo, useState } from "react";

import { DataTable } from "@/components/ui/table";
import { formatInventoryCategory } from "@/lib/inventory";
import { cn, formatCurrency, formatNumber } from "@/lib/utils";

interface InventoryValueSegment {
  category: string;
  label: string;
  value: number;
  percent: number;
}

interface LowStockRow {
  id: string;
  name: string;
  sku: string;
  quantityInStock: number;
  minimumStockLevel: number;
  severity: "LOW" | "CRITICAL";
}

interface OutOfStockRow {
  id: string;
  name: string;
  sku: string;
  minimumStockLevel: number;
  category: string;
}

interface InventoryValueStatisticsCardProps {
  totalValue: number;
  segments: InventoryValueSegment[];
  lowStockRows: LowStockRow[];
  outOfStockRows: OutOfStockRow[];
  className?: string;
}

const segmentColors = [
  "bg-blue-500",
  "bg-indigo-500",
  "bg-sky-500",
  "bg-violet-500",
  "bg-fuchsia-500",
  "bg-cyan-500",
  "bg-emerald-500",
  "bg-amber-500",
  "bg-rose-500"
];

type StockPanel = "low" | "out" | null;

export function InventoryValueStatisticsCard({
  totalValue,
  segments,
  lowStockRows,
  outOfStockRows,
  className
}: InventoryValueStatisticsCardProps) {
  const [activePanel, setActivePanel] = useState<StockPanel>(null);
  const [activeSegmentKey, setActiveSegmentKey] = useState<string | null>(null);

  const visibleSegments = useMemo(
    () =>
      segments
        .filter((segment) => segment.value > 0)
        .sort((a, b) => b.value - a.value)
        .slice(0, 8),
    [segments]
  );

  const selectedSegment = useMemo(() => {
    if (!activeSegmentKey) {
      return visibleSegments[0] || null;
    }
    return visibleSegments.find((segment) => segment.category === activeSegmentKey) || visibleSegments[0] || null;
  }, [activeSegmentKey, visibleSegments]);

  const hasBreakdown = visibleSegments.length > 0;

  return (
    <div
      className={cn(
        "w-full rounded-2xl border border-slate-200 bg-white p-5 text-ink-900 shadow-sm sm:p-6",
        className
      )}
    >
      <div className="flex items-center justify-between gap-4">
        <h3 className="text-lg font-semibold text-slate-700">Inventory Value</h3>
      </div>

      <div className="mt-3 text-3xl font-bold tracking-tight text-ink-900">
        {formatCurrency(totalValue)}
      </div>

      <div className="my-5 border-b border-slate-200" />

      {hasBreakdown ? (
        <>
          <div className="flex items-center gap-1.5">
            {visibleSegments.map((segment, index) => (
              <button
                key={segment.category}
                type="button"
                className={cn(
                  "h-2.5 overflow-hidden rounded-sm transition-all",
                  segmentColors[index % segmentColors.length],
                  activeSegmentKey === segment.category && "ring-2 ring-indigo-200 ring-offset-2 ring-offset-white"
                )}
                style={{ width: `${Math.max(segment.percent, 1)}%` }}
                onMouseEnter={() => setActiveSegmentKey(segment.category)}
                onFocus={() => setActiveSegmentKey(segment.category)}
                onClick={() => setActiveSegmentKey(segment.category)}
                aria-label={`${segment.label} ${segment.percent.toFixed(1)} percent`}
                title={`${segment.label}: ${formatCurrency(segment.value)} (${segment.percent.toFixed(1)}%)`}
              />
            ))}
          </div>
          <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50/80 px-3 py-2">
            {selectedSegment ? (
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="font-medium text-slate-700">{selectedSegment.label}</span>
                <span className="font-semibold text-ink-900">
                  {formatCurrency(selectedSegment.value)} · {selectedSegment.percent.toFixed(1)}%
                </span>
              </div>
            ) : (
              <p className="text-sm text-slate-600">No category value data available in this scope.</p>
            )}
          </div>
        </>
      ) : (
        <p className="rounded-xl border border-slate-200 bg-slate-50/80 px-3 py-4 text-sm text-slate-600">
          No category value data is available for this scope.
        </p>
      )}

      <div className="mt-5 space-y-3">
        <button
          type="button"
          className={cn(
            "flex w-full items-center justify-between rounded-2xl border border-slate-200 bg-slate-100/80 px-4 py-3 text-left transition-colors",
            activePanel === "low" ? "border-brand-300 bg-brand-50/70" : "hover:border-slate-300 hover:bg-slate-100"
          )}
          onClick={() => setActivePanel((current) => (current === "low" ? null : "low"))}
        >
          <span className="text-2xl font-medium text-slate-800">Low stock alerts</span>
          <span className="text-4xl font-semibold text-ink-900">{formatNumber(lowStockRows.length)}</span>
        </button>
        <button
          type="button"
          className={cn(
            "flex w-full items-center justify-between rounded-2xl border border-slate-200 bg-slate-100/80 px-4 py-3 text-left transition-colors",
            activePanel === "out" ? "border-brand-300 bg-brand-50/70" : "hover:border-slate-300 hover:bg-slate-100"
          )}
          onClick={() => setActivePanel((current) => (current === "out" ? null : "out"))}
        >
          <span className="text-2xl font-medium text-slate-800">Out of stock items</span>
          <span className="text-4xl font-semibold text-ink-900">{formatNumber(outOfStockRows.length)}</span>
        </button>
      </div>

      {activePanel === "low" && (
        <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50/65 p-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
            Low stock detail
          </p>
          {lowStockRows.length === 0 ? (
            <p className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-3 text-sm text-emerald-800">
              No low stock alerts in this scope.
            </p>
          ) : (
            <div className="max-h-64 overflow-auto rounded-lg border border-slate-200 bg-white">
              <DataTable
                compact
                columns={["Item", "SKU", "Current", "Minimum", "Severity"]}
                rows={lowStockRows.map((item) => [
                  item.name,
                  item.sku,
                  <span key={`${item.id}-current`} className="inline-block w-full text-right">
                    {formatNumber(item.quantityInStock)}
                  </span>,
                  <span key={`${item.id}-minimum`} className="inline-block w-full text-right">
                    {formatNumber(item.minimumStockLevel)}
                  </span>,
                  <span
                    key={`${item.id}-severity`}
                    className={cn(
                      "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold",
                      item.severity === "CRITICAL"
                        ? "border-red-200 bg-red-50 text-red-700"
                        : "border-amber-200 bg-amber-50 text-amber-700"
                    )}
                  >
                    {item.severity}
                  </span>
                ])}
              />
            </div>
          )}
        </div>
      )}

      {activePanel === "out" && (
        <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50/65 p-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
            Out of stock detail
          </p>
          {outOfStockRows.length === 0 ? (
            <p className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-3 text-sm text-emerald-800">
              No out of stock items in this scope.
            </p>
          ) : (
            <div className="max-h-64 overflow-auto rounded-lg border border-slate-200 bg-white">
              <DataTable
                compact
                columns={["Item", "SKU", "Minimum", "Category"]}
                rows={outOfStockRows.map((item) => [
                  item.name,
                  item.sku,
                  <span key={`${item.id}-minimum`} className="inline-block w-full text-right">
                    {formatNumber(item.minimumStockLevel)}
                  </span>,
                  formatInventoryCategory(item.category)
                ])}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
