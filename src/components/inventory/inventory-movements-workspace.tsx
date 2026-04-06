import { Eye } from "lucide-react";

import { Card } from "@/components/ui/card";
import { DataTable } from "@/components/ui/table";
import { FilterSelect } from "@/components/inventory/inventory-page-shared";
import {
  deriveMovementPurpose,
  deriveMovementRecognitionStatus,
  deriveMovementRecognitionSubLine,
  movementItemLabel,
  movementLinkedToDisplay,
  toIsoDate
} from "@/components/inventory/inventory-page-utils";
import { formatMovementType, inventoryMovementTypeOptions } from "@/lib/inventory";
import { cn, formatCurrency, formatNumber } from "@/lib/utils";

interface MovementLedgerSummary {
  total: number;
  recognized: number;
  pending: number;
  stockOnly: number;
}

interface MovementWorkspaceRow {
  id: string;
  itemId: string;
  movementType: "IN" | "OUT" | "ADJUSTMENT" | "TRANSFER";
  quantity: number;
  unitCost?: number | null;
  totalCost: number | null;
  date: string;
  notes?: string | null;
  item?: { id?: string; name?: string | null; sku?: string | null } | null;
  rig?: { id?: string; rigCode?: string | null } | null;
  project?: { id?: string; name?: string | null } | null;
  maintenanceRequest?: {
    id?: string | null;
    requestCode?: string | null;
    breakdownReportId?: string | null;
  } | null;
  breakdownReport?: { id?: string | null; title?: string | null } | null;
  linkedBreakdown?: { id?: string | null; title?: string | null } | null;
  linkedUsageRequest?: {
    id?: string;
    reasonType?: string | null;
    breakdownReportId?: string | null;
    maintenanceRequestId?: string | null;
    maintenanceRequest?: { id?: string | null; requestCode?: string | null; breakdownReportId?: string | null } | null;
    breakdownReport?: { id?: string | null; title?: string | null } | null;
  } | null;
  expense?: { id?: string; approvalStatus?: string } | null;
  receiptUrl?: string | null;
  traReceiptNumber?: string | null;
  supplierInvoiceNumber?: string | null;
}

export function InventoryMovementsWorkspace({
  focusedSectionId,
  movementLedgerSummary,
  movementTypeFilter,
  setMovementTypeFilter,
  movementQuery,
  setMovementQuery,
  filteredMovements,
  visibleMovements,
  focusedRowId,
  openMovementDetail
}: {
  focusedSectionId: string | null;
  movementLedgerSummary: MovementLedgerSummary;
  movementTypeFilter: string;
  setMovementTypeFilter: (value: string) => void;
  movementQuery: string;
  setMovementQuery: (value: string) => void;
  filteredMovements: MovementWorkspaceRow[];
  visibleMovements: MovementWorkspaceRow[];
  focusedRowId: string | null;
  openMovementDetail: (movementId: string) => void;
}) {
  return (
    <section
      id="inventory-movements-section"
      className={cn(
        focusedSectionId === "inventory-movements-section" &&
          "rounded-2xl ring-2 ring-indigo-100 ring-offset-2 ring-offset-slate-50"
      )}
    >
      <Card
        className="min-w-0"
        title="Movement History"
        subtitle="Track inventory movement history, operational linkage, and cost recognition."
      >
        <div id="inventory-stock-movements-section" />
        <div className="mb-3 space-y-2 rounded-xl border border-slate-200/80 bg-slate-50/70 p-3">
          <p className="text-xs text-slate-600">
            Review stock changes with operational and financial traceability.
          </p>
          <p className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
            Most movements are created from receipt intake, approved usage, maintenance, and breakdown workflows.
            Use manual adjustment only when a movement cannot be captured through the normal process.
          </p>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="rounded-full border border-slate-300 bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-700">
              In scope: {formatNumber(movementLedgerSummary.total)}
            </span>
            <span className="rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-800">
              Cost recognized: {formatNumber(movementLedgerSummary.recognized)}
            </span>
            <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
              Pending: {formatNumber(movementLedgerSummary.pending)}
            </span>
            <span className="rounded-full border border-slate-300 bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-700">
              Stock only: {formatNumber(movementLedgerSummary.stockOnly)}
            </span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Filters</p>
            <p className="text-xs text-slate-500">Search and narrow movement history quickly</p>
          </div>
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
            <FilterSelect
              label="Movement Type"
              value={movementTypeFilter}
              onChange={setMovementTypeFilter}
              options={[
                { value: "all", label: "All movement types" },
                ...inventoryMovementTypeOptions.map((entry) => ({ value: entry.value, label: entry.label }))
              ]}
            />
            <label className="text-xs text-ink-700 md:col-span-2 xl:col-span-3">
              <span className="mb-1 block uppercase tracking-wide text-slate-500">Search movements</span>
              <input
                type="text"
                value={movementQuery}
                onChange={(event) => setMovementQuery(event.target.value)}
                placeholder="Item, project, rig, supplier, maintenance code"
                className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-sm"
              />
            </label>
          </div>
        </div>
        {filteredMovements.length === 0 ? (
          <p className="text-sm text-ink-600">No stock movements found for current scope.</p>
        ) : (
          <div>
            <DataTable
              className="border-slate-200/70"
              compact
              columns={["Date", "Item", "Type", "Qty", "Total Cost", "Purpose", "Linked To", "Financial Status", "Receipt", "Actions"]}
              rows={visibleMovements.map((movement) => {
                const purpose = deriveMovementPurpose(movement);
                const recognition = deriveMovementRecognitionStatus(movement);
                const financialSubLine = deriveMovementRecognitionSubLine(movement, recognition);
                return [
                  toIsoDate(movement.date),
                  movementItemLabel(movement),
                  formatMovementType(movement.movementType),
                  formatNumber(movement.quantity),
                  formatCurrency(movement.totalCost || 0),
                  <span
                    key={`${movement.id}-purpose`}
                    className="inline-flex rounded-full border border-slate-300 bg-slate-100 px-1.5 py-[1px] text-[10px] font-semibold text-slate-700"
                  >
                    {purpose.label}
                  </span>,
                  movementLinkedToDisplay(movement),
                  <div key={`${movement.id}-financial`} className="space-y-0.5">
                    <span
                      className={cn(
                        "inline-flex rounded-full border px-1.5 py-[1px] text-[10px] font-semibold",
                        recognition.tone === "good"
                          ? "border-emerald-300 bg-emerald-100 text-emerald-800"
                          : recognition.tone === "warn"
                            ? "border-amber-300 bg-amber-100 text-amber-800"
                            : "border-slate-300 bg-slate-100 text-slate-700"
                      )}
                    >
                      {recognition.label}
                    </span>
                    <p className="text-[10px] text-slate-600">{financialSubLine}</p>
                  </div>,
                  movement.receiptUrl ? (
                    <a
                      key={`${movement.id}-receipt`}
                      href={movement.receiptUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-brand-700 underline"
                    >
                      Open
                    </a>
                  ) : movement.traReceiptNumber || movement.supplierInvoiceNumber ? (
                    "Attached"
                  ) : (
                    "—"
                  ),
                  <button
                    key={`${movement.id}-view`}
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      openMovementDetail(movement.id);
                    }}
                    className="gf-btn-subtle"
                  >
                    <span className="inline-flex items-center gap-1">
                      <Eye size={13} />
                      View
                    </span>
                  </button>
                ];
              })}
              rowIds={visibleMovements.map((movement) => `ai-focus-${movement.id}`)}
              rowClassNames={visibleMovements.map((movement) =>
                focusedRowId === movement.id ? "bg-indigo-50 ring-1 ring-inset ring-indigo-200" : ""
              )}
              onRowClick={(rowIndex) => openMovementDetail(visibleMovements[rowIndex]?.id || "")}
            />
          </div>
        )}
      </Card>
    </section>
  );
}
