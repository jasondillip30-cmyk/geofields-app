"use client";

import type { ReactNode } from "react";
import Link from "next/link";

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
  showOverview: boolean;
  canManage: boolean;
  onOpenCreateItem: () => void;
  onOpenManualAdjustment: () => void;
  onOpenRequestBatch: () => void;
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
  showOverview,
  canManage,
  onOpenCreateItem,
  onOpenManualAdjustment,
  onOpenRequestBatch,
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
        <div className="flex flex-wrap items-start justify-between gap-3">
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
          <div className={cn("flex flex-wrap gap-2", showMovements ? "ml-auto justify-end" : "")}>
            {showOverview ? (
              <>
                {canManage && !isSingleProjectScope ? (
                  <>
                    <button
                      type="button"
                      onClick={onOpenCreateItem}
                      className="gf-btn-primary px-3 py-1.5 text-xs"
                    >
                      New Item
                    </button>
                    <Link href="/inventory/stock-movements" className="gf-btn-secondary px-3 py-1.5 text-xs">
                      Record Movement
                    </Link>
                  </>
                ) : null}
                {!isSingleProjectScope ? (
                  <Link href="/purchasing/receipt-follow-up" className="gf-btn-secondary px-3 py-1.5 text-xs">
                    Complete Purchase
                  </Link>
                ) : null}
                <button
                  type="button"
                  onClick={onOpenRequestBatch}
                  className="gf-btn-primary px-3 py-1.5 text-xs"
                >
                  Request Batch
                </button>
              </>
            ) : showMovements ? (
              <>
                {canManage && !isSingleProjectScope ? (
                  <button
                    type="button"
                    onClick={onOpenManualAdjustment}
                    className="gf-btn-primary px-3 py-1.5 text-xs"
                  >
                    New Manual Adjustment
                  </button>
                ) : null}
                {!isSingleProjectScope ? (
                  <Link href="/purchasing/receipt-follow-up" className="gf-btn-secondary px-3 py-1.5 text-xs">
                    Open Purchase Follow-up
                  </Link>
                ) : null}
                <Link href="/inventory?section=overview" className="gf-btn-secondary px-3 py-1.5 text-xs">
                  Back to Overview
                </Link>
              </>
            ) : (
              <>
                <Link href="/inventory" className="gf-btn-secondary px-3 py-1.5 text-xs">
                  Back to Overview
                </Link>
                {!isSingleProjectScope ? (
                  <Link href="/purchasing/receipt-follow-up" className="gf-btn-secondary px-3 py-1.5 text-xs">
                    Open Purchase Follow-up
                  </Link>
                ) : null}
              </>
            )}
          </div>
        </div>
        <div className="mt-4 border-t border-slate-200/80" />
        {isSingleProjectScope && showOverview ? (
          <div className="mt-3 gf-guided-strip">
            <p className="gf-guided-strip-title">Today in this project</p>
            <div className="gf-guided-step-list">
              <p className="gf-guided-step">1. Check what is available for this project.</p>
              <p className="gf-guided-step">2. Record usage through normal project workflows.</p>
              <p className="gf-guided-step">3. Review used quantity and recognized cost.</p>
            </div>
          </div>
        ) : null}
      </section>

      {children}
    </div>
  );
}
