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
  additionalFiltersOnly?: boolean;
}

export function hasActiveScopeFilters(filters: AnalyticsFilters) {
  return (
    filters.workspaceMode !== "all-projects" ||
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

  if (filters.workspaceMode === "workshop") {
    return `Workshop mode • Global workshop operations • ${dateScope}`;
  }

  if (filters.workspaceMode === "project" && filters.projectId === "all") {
    return `Project mode • Select one project to lock scope • ${dateScope}`;
  }

  if (filters.projectId !== "all") {
    return `Project locked: ${projectLabel || "Selected project"} • ${dateScope}`;
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
  className,
  additionalFiltersOnly = false
}: FilterScopeBannerProps) {
  if (!hasActiveScopeFilters(filters)) {
    return null;
  }

  const additionalFilters =
    filters.workspaceMode !== "workshop" && filters.projectId === "all"
      ? [
          filters.clientId === "all" ? null : clientLabel || "Selected client",
          filters.rigId === "all" ? null : rigLabel || "Selected rig"
        ].filter(Boolean)
      : [];
  if (additionalFiltersOnly && additionalFilters.length === 0 && !onClearFilters) {
    return null;
  }
  const scopeSummary = additionalFiltersOnly
    ? ["Additional filters", ...additionalFilters].join(" • ")
    : buildFilterScopeSummary({ filters, projectLabel, clientLabel, rigLabel });

  return (
    <div
      className={cn(
        additionalFiltersOnly
          ? "rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
          : "rounded-2xl border border-brand-200 bg-gradient-to-r from-brand-50/95 to-white px-4 py-3 text-sm text-brand-900 shadow-[0_1px_2px_rgba(37,99,235,0.08)]",
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

export function formatScopeDate(value: string) {
  if (!value) {
    return "";
  }

  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleDateString("en-US", { timeZone: "UTC" });
}
