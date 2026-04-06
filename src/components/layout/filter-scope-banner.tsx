"use client";

import type { AnalyticsFilters } from "@/components/layout/analytics-filters-provider";
import { cn } from "@/lib/utils";

interface FilterScopeBannerProps {
  filters: AnalyticsFilters;
  clientLabel?: string | null;
  rigLabel?: string | null;
  onClearFilters?: () => void;
  className?: string;
}

export function hasActiveScopeFilters(filters: AnalyticsFilters) {
  return filters.clientId !== "all" || filters.rigId !== "all" || Boolean(filters.from) || Boolean(filters.to);
}

export function buildFilterScopeSummary({
  filters,
  clientLabel,
  rigLabel
}: {
  filters: AnalyticsFilters;
  clientLabel?: string | null;
  rigLabel?: string | null;
}) {
  const rigScope = filters.rigId === "all" ? "All rigs" : `Rig ${rigLabel || filters.rigId}`;
  const clientScope = filters.clientId === "all" ? "All clients" : `Client ${clientLabel || filters.clientId}`;
  const dateScope =
    !filters.from && !filters.to
      ? "Any date"
      : `Date ${formatScopeDate(filters.from) || "Any"} to ${formatScopeDate(filters.to) || "Any"}`;

  return `Filtered view: ${rigScope} • ${clientScope} • ${dateScope}`;
}

export function FilterScopeBanner({
  filters,
  clientLabel,
  rigLabel,
  onClearFilters,
  className
}: FilterScopeBannerProps) {
  if (!hasActiveScopeFilters(filters)) {
    return null;
  }

  const scopeSummary = buildFilterScopeSummary({ filters, clientLabel, rigLabel });

  return (
    <div
      className={cn(
        "rounded-xl border border-brand-200 bg-brand-50/90 px-4 py-3 text-sm text-brand-900 shadow-[0_1px_2px_rgba(37,99,235,0.10)]",
        className
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm font-medium text-brand-900">{scopeSummary}</p>
        {onClearFilters ? (
          <button
            type="button"
            onClick={onClearFilters}
            className="rounded-md border border-brand-200 bg-white px-2.5 py-1 text-xs font-medium text-brand-800 hover:bg-brand-100/40"
          >
            Clear filters
          </button>
        ) : null}
      </div>
    </div>
  );
}

function formatScopeDate(value: string) {
  if (!value) {
    return "";
  }

  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleDateString("en-US");
}
