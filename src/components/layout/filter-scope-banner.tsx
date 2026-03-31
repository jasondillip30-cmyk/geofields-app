"use client";

import type { AnalyticsFilters } from "@/components/layout/analytics-filters-provider";

interface FilterScopeBannerProps {
  filters: AnalyticsFilters;
  clientLabel?: string | null;
  rigLabel?: string | null;
}

export function hasActiveScopeFilters(filters: AnalyticsFilters) {
  return filters.clientId !== "all" || filters.rigId !== "all" || Boolean(filters.from) || Boolean(filters.to);
}

export function FilterScopeBanner({ filters, clientLabel, rigLabel }: FilterScopeBannerProps) {
  if (!hasActiveScopeFilters(filters)) {
    return null;
  }

  return (
    <div className="rounded-xl border border-brand-200 bg-brand-50/90 px-4 py-3 text-sm text-brand-900 shadow-[0_1px_2px_rgba(37,99,235,0.10)]">
      <p className="text-xs font-semibold uppercase tracking-wide text-brand-700">Showing filtered results</p>
      <div className="mt-2 flex flex-wrap gap-2 text-xs">
        {filters.clientId !== "all" && (
          <span className="rounded-full border border-brand-200 bg-white px-2 py-0.5 font-medium">
            Client: {clientLabel || filters.clientId}
          </span>
        )}
        {filters.rigId !== "all" && (
          <span className="rounded-full border border-brand-200 bg-white px-2 py-0.5 font-medium">
            Rig: {rigLabel || filters.rigId}
          </span>
        )}
        {(filters.from || filters.to) && (
          <span className="rounded-full border border-brand-200 bg-white px-2 py-0.5 font-medium">
            Date: {filters.from || "Any"} to {filters.to || "Any"}
          </span>
        )}
      </div>
    </div>
  );
}
