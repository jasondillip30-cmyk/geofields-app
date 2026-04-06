"use client";

import { cn } from "@/lib/utils";

interface AnalyticsEmptyStateProps {
  variant: "filtered-empty" | "no-data";
  moduleHint: string;
  scopeHint?: string;
  onClearFilters?: () => void;
  onLast30Days?: () => void;
  onLast90Days?: () => void;
  className?: string;
}

export function AnalyticsEmptyState({
  variant,
  moduleHint,
  scopeHint,
  onClearFilters,
  onLast30Days,
  onLast90Days,
  className
}: AnalyticsEmptyStateProps) {
  const title = variant === "filtered-empty" ? "No data for selected filters" : "No data recorded yet";
  const helper =
    variant === "filtered-empty" ? "Try adjusting or clearing filters" : moduleHint;

  return (
    <div
      className={cn(
        "rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-4 text-center",
        className
      )}
    >
      <p className="text-sm font-medium text-ink-900">{title}</p>
      <p className="mt-1 text-xs text-ink-600">{helper}</p>
      {scopeHint ? <p className="mt-2 text-xs font-medium text-slate-500">{scopeHint}</p> : null}
      {variant === "filtered-empty" ? (
        <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            onClick={onClearFilters}
            className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs text-ink-700 hover:bg-slate-100"
          >
            Clear filters
          </button>
          <button
            type="button"
            onClick={onLast30Days}
            className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs text-ink-700 hover:bg-slate-100"
          >
            Last 30 days
          </button>
          <button
            type="button"
            onClick={onLast90Days}
            className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs text-ink-700 hover:bg-slate-100"
          >
            Last 90 days
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function getScopedKpiValue(value: string, isFilteredEmpty: boolean) {
  return isFilteredEmpty ? "—" : value;
}

export function getScopedKpiHelper(
  original: string | undefined,
  isFilteredEmpty: boolean
) {
  return isFilteredEmpty ? "No data for current filters" : original;
}
