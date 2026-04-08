"use client";

import type { AnalyticsFilters } from "@/components/layout/analytics-filters-provider";
import { cn } from "@/lib/utils";

interface FilterScopeBannerProps {
  filters: AnalyticsFilters;
  projectLabel?: string | null;
  clientLabel?: string | null;
  rigLabel?: string | null;
  onClearFilters?: () => void;
  className?: string;
}

export function hasActiveScopeFilters(filters: AnalyticsFilters) {
  return (
    filters.projectId !== "all" ||
    filters.clientId !== "all" ||
    filters.rigId !== "all" ||
    Boolean(filters.from) ||
    Boolean(filters.to)
  );
}

export function buildFilterScopeSummary({
  filters,
  projectLabel,
  clientLabel,
  rigLabel
}: {
  filters: AnalyticsFilters;
  projectLabel?: string | null;
  clientLabel?: string | null;
  rigLabel?: string | null;
}) {
  const dateScope =
    !filters.from && !filters.to
      ? "Any date"
      : `Date ${formatScopeDate(filters.from) || "Any"} to ${formatScopeDate(filters.to) || "Any"}`;

  if (filters.projectId !== "all") {
    return `Project locked: ${projectLabel || filters.projectId} • ${dateScope}`;
  }

  const rigScope = filters.rigId === "all" ? null : `Rig ${rigLabel || filters.rigId}`;
  const clientScope = filters.clientId === "all" ? null : `Client ${clientLabel || filters.clientId}`;
  const optionalScopes = [clientScope, rigScope].filter(Boolean).join(" • ");
  return optionalScopes
    ? `All projects mode • ${optionalScopes} • ${dateScope}`
    : `All projects mode • ${dateScope}`;
}

export function FilterScopeBanner({
  filters,
  projectLabel,
  clientLabel,
  rigLabel,
  onClearFilters,
  className
}: FilterScopeBannerProps) {
  if (!hasActiveScopeFilters(filters)) {
    return null;
  }

  const scopeSummary = buildFilterScopeSummary({ filters, projectLabel, clientLabel, rigLabel });

  return (
    <div
      className={cn(
        "rounded-2xl border border-brand-200 bg-gradient-to-r from-brand-50/95 to-white px-4 py-3 text-sm text-brand-900 shadow-[0_1px_2px_rgba(37,99,235,0.08)]",
        className
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm font-medium text-brand-900">{scopeSummary}</p>
        {onClearFilters ? (
          <button
            type="button"
            onClick={onClearFilters}
            className="rounded-lg border border-brand-200 bg-white px-2.5 py-1 text-xs font-medium text-brand-800 hover:bg-brand-100/40"
          >
            Reset scope
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
