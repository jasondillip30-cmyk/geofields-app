"use client";

import type { ReactNode } from "react";

import { FilterScopeBanner } from "@/components/layout/filter-scope-banner";
import { cn } from "@/lib/utils";
import type { AnalyticsFilters } from "@/components/layout/analytics-filters-provider";

interface InventoryPageChromeProps {
  notice?: string | null;
  errorMessage?: string | null;
  filters: AnalyticsFilters;
  selectedClientLabel: string | null;
  selectedRigLabel: string | null;
  isSingleProjectScope: boolean;
  isProjectScopedInventoryView: boolean;
  showMovements: boolean;
  pageTitle: string;
  pageSubtitle: string;
  children: ReactNode;
}

export function InventoryPageChrome({
  notice,
  errorMessage,
  filters,
  selectedClientLabel,
  selectedRigLabel,
  isSingleProjectScope,
  isProjectScopedInventoryView,
  showMovements,
  pageTitle,
  pageSubtitle,
  children
}: InventoryPageChromeProps) {
  return (
    <div className="gf-page-stack space-y-4 md:space-y-5">
      {notice && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {notice}
        </div>
      )}
      {errorMessage && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {errorMessage}
        </div>
      )}

      {!isSingleProjectScope || !isProjectScopedInventoryView ? (
        <FilterScopeBanner filters={filters} clientLabel={selectedClientLabel} rigLabel={selectedRigLabel} />
      ) : null}

      <section className="gf-page-header">
        <div className="min-w-0">
          {showMovements ? (
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Inventory</p>
          ) : null}
          <h1
            className={cn(
              "font-semibold tracking-tight text-ink-900",
              showMovements ? "text-3xl md:text-[2rem]" : "text-2xl md:text-[1.7rem]"
            )}
          >
            {pageTitle}
          </h1>
          <p className="mt-1 text-sm text-slate-600">{pageSubtitle}</p>
        </div>
        <div className="mt-4 border-t border-slate-200/80" />
      </section>

      {children}
    </div>
  );
}
