"use client";

import type { Dispatch, SetStateAction } from "react";

import { InputField, SelectField } from "@/components/inventory/receipt-intake-panel-fields";
import type {
  ReceiptFollowUpStage,
  RequisitionComparisonResult,
  ReviewLineState,
  ReviewState
} from "@/components/inventory/receipt-intake-panel";

interface ItemLike {
  id: string;
  name: string;
  sku: string;
}

export function ReceiptIntakeReviewStep({
  showMismatchInventoryHandling,
  requisitionComparison,
  showScannedDetails,
  setShowScannedDetails,
  inventoryActionNeeded,
  setShowMismatchInventoryHandling,
  unmatchedLines,
  showAdvancedLineItemEditor,
  review,
  mismatchDetected,
  items,
  updateLine,
  inventoryActionEditorByLine,
  setInventoryActionEditorByLine,
  inventoryCategoryOptions,
  formatInventoryCategory,
  setShowMismatchFinalizeConfirm,
  setFollowUpStage,
  manualInputSelected,
  setReview,
  resetScanSessionState
}: {
  showMismatchInventoryHandling: boolean;
  requisitionComparison: RequisitionComparisonResult | null;
  showScannedDetails: boolean;
  setShowScannedDetails: Dispatch<SetStateAction<boolean>>;
  inventoryActionNeeded: boolean;
  setShowMismatchInventoryHandling: Dispatch<SetStateAction<boolean>>;
  unmatchedLines: ReviewLineState[];
  showAdvancedLineItemEditor: boolean;
  review: ReviewState;
  mismatchDetected: boolean;
  items: ItemLike[];
  updateLine: (lineId: string, patch: Partial<ReviewLineState>) => void;
  inventoryActionEditorByLine: Record<string, boolean>;
  setInventoryActionEditorByLine: Dispatch<SetStateAction<Record<string, boolean>>>;
  inventoryCategoryOptions: Array<{ value: string; label: string }>;
  formatInventoryCategory: (value: string) => string;
  setShowMismatchFinalizeConfirm: Dispatch<SetStateAction<boolean>>;
  setFollowUpStage: Dispatch<SetStateAction<ReceiptFollowUpStage>>;
  manualInputSelected: boolean;
  setReview: Dispatch<SetStateAction<ReviewState | null>>;
  resetScanSessionState: () => void;
}) {
  return (
    <>
      {!showMismatchInventoryHandling &&
        requisitionComparison &&
        requisitionComparison.status !== "MISMATCH" && (
          <div
            className={`rounded-lg border px-2.5 py-1.5 text-xs ${
              requisitionComparison.status === "MATCHED"
                ? "border-emerald-300 bg-emerald-50 text-emerald-900"
                : requisitionComparison.status === "SCAN_FAILED"
                    ? "border-amber-300 bg-amber-50 text-amber-900"
                    : requisitionComparison.status === "MANUAL_ENTRY"
                      ? "border-slate-300 bg-slate-50 text-slate-800"
                      : "border-amber-300 bg-amber-50 text-amber-900"
            }`}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-semibold">{requisitionComparison.label}</span>
              {requisitionComparison.canInspectScannedDetails && (
                <button
                  type="button"
                  onClick={() => setShowScannedDetails((current) => !current)}
                  className="rounded border border-current/70 bg-white/75 px-2 py-0.5 text-[11px] font-semibold"
                >
                  {showScannedDetails ? "Hide scanned receipt" : "Review scanned receipt"}
                </button>
              )}
            </div>
            <p className="mt-0.5 leading-4">{requisitionComparison.message}</p>
            {requisitionComparison.differenceRows.length > 0 && (
              <div className="mt-2 space-y-1 rounded border border-current/30 bg-white/60 px-2 py-1.5">
                {requisitionComparison.differenceRows.map((row) => (
                  <p key={row.label}>
                    <span className="font-semibold">{row.label}:</span> Approved <span className="font-medium">{row.approved || "-"}</span> | Scanned{" "}
                    <span className="font-medium">{row.scanned || "-"}</span>
                  </p>
                ))}
              </div>
            )}
          </div>
        )}

      <div className="space-y-1.5 rounded-lg border border-slate-200/60 bg-white px-2.5 py-1.5">
        <p className="text-sm font-semibold text-slate-900">
          {showMismatchInventoryHandling ? "Step 3: Link item to inventory" : "Step 2: Confirm items from requisition"}
        </p>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-semibold text-ink-900">Requisition Line Items</p>
          <div className="flex flex-wrap items-center gap-2">
            {requisitionComparison?.canInspectScannedDetails && (
              <button
                type="button"
                onClick={() => setShowScannedDetails((current) => !current)}
                className="text-[11px] font-medium text-slate-500 underline underline-offset-2 hover:text-slate-700"
              >
                {showScannedDetails ? "Hide scanned receipt" : "Review scanned receipt"}
              </button>
            )}
            {inventoryActionNeeded && (
              <button
                type="button"
                onClick={() => setShowMismatchInventoryHandling((current) => !current)}
                className="text-[11px] font-medium text-slate-500 underline underline-offset-2 hover:text-slate-700"
              >
                {showMismatchInventoryHandling ? "Hide inventory options" : "Show inventory options"}
              </button>
            )}
          </div>
        </div>

        {unmatchedLines.length > 0 && showAdvancedLineItemEditor && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            <p className="font-semibold">Unmatched items need inventory action</p>
            <div className="mt-1 space-y-1">
              {unmatchedLines.map((line) => (
                <p key={`unmatched-${line.id}`}>
                  {line.description || "Item"} • category {line.suggestedCategory ? formatInventoryCategory(line.suggestedCategory) : "Other"} • action{" "}
                  {line.mode === "EXPENSE_ONLY" ? "Receipt/expense evidence only" : line.mode === "NEW" ? "Create new item" : "Link to existing item"}
                </p>
              ))}
            </div>
          </div>
        )}

        {review.lines.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-300 bg-white px-2.5 py-3 text-xs text-slate-700">
            {mismatchDetected
              ? "No approved requisition line items are available for this mismatch review."
              : "No requisition line items are currently available for review."}
          </div>
        ) : (
          review.lines.map((line) =>
            !showAdvancedLineItemEditor ? (
              <div key={line.id} className="rounded-lg border border-slate-200/80 bg-white px-2.5 py-2 text-[11px] text-slate-800">
                <p className="font-semibold leading-4">{line.description || "Line item"}</p>
                <p className="mt-0.5 text-slate-700">
                  qty {line.quantity || "0"} • unit {line.unitPrice || "0"} • total {line.lineTotal || "0"}
                </p>
              </div>
            ) : (
              <div
                key={line.id}
                className={`space-y-2 rounded-lg border p-3 ${
                  line.extractionConfidence === "LOW" ? "border-amber-300 bg-amber-50" : "border-slate-200 bg-white"
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs text-slate-600">
                    {mismatchDetected
                      ? "Requisition line item"
                      : line.mode === "MATCH"
                        ? "Linked to existing inventory item"
                        : line.mode === "NEW"
                          ? "Create as new inventory item"
                          : "Receipt evidence only"}
                  </span>
                </div>

                <div className="rounded border border-slate-200/80 bg-slate-50 px-2 py-1.5 text-xs text-slate-700">
                  <p className="font-semibold text-slate-800">{line.description || "Line item"}</p>
                  <p className="mt-0.5">
                    Category context: {line.selectedCategory ? formatInventoryCategory(line.selectedCategory) : "Other"}
                  </p>
                </div>

                {(() => {
                  const lineNeedsInventoryAction = line.mode === "NEW" || (line.mode === "MATCH" && !line.selectedItemId);
                  const showInventoryActionEditor = Boolean(inventoryActionEditorByLine[line.id]);
                  const matchedItemName = line.selectedItemId
                    ? items.find((item) => item.id === line.selectedItemId)?.name || line.selectedItemId
                    : "";

                  if (lineNeedsInventoryAction && !showInventoryActionEditor) {
                    return (
                      <div className="rounded border border-slate-200 bg-slate-50 px-2.5 py-2 text-xs text-slate-700">
                        <p className="font-medium text-slate-800">
                          This item is not yet linked to inventory. What do you want to do?
                        </p>
                        <div className="mt-2 flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              updateLine(line.id, { mode: "MATCH" });
                              setInventoryActionEditorByLine((current) => ({ ...current, [line.id]: true }));
                            }}
                            className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
                          >
                            Match existing item
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              updateLine(line.id, {
                                mode: "NEW",
                                selectedItemId: "",
                                newItemName: line.newItemName || line.description
                              });
                              setInventoryActionEditorByLine((current) => ({ ...current, [line.id]: true }));
                            }}
                            className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
                          >
                            Create new item
                          </button>
                        </div>
                      </div>
                    );
                  }

                  if (!showInventoryActionEditor) {
                    return (
                      <div className="rounded border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs text-slate-700">
                        <p>
                          {line.mode === "MATCH"
                            ? `Inventory action resolved: linked to ${matchedItemName}.`
                            : "Inventory action resolved: this line is receipt/expense evidence only."}
                        </p>
                        <button
                          type="button"
                          onClick={() =>
                            setInventoryActionEditorByLine((current) => ({
                              ...current,
                              [line.id]: true
                            }))
                          }
                          className="mt-1 rounded border border-slate-300 bg-white px-2 py-0.5 text-[11px] text-slate-700 hover:bg-slate-100"
                        >
                          Edit inventory action
                        </button>
                      </div>
                    );
                  }

                  return (
                    <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                      <SelectField
                        label="Inventory Action"
                        value={line.mode}
                        onChange={(value) =>
                          updateLine(line.id, {
                            mode:
                              review.receiptClassification === "EXPENSE_ONLY"
                                ? "EXPENSE_ONLY"
                                : review.receiptClassification === "INTERNAL_TRANSFER"
                                  ? "MATCH"
                                  : value === "NEW"
                                    ? "NEW"
                                    : value === "EXPENSE_ONLY"
                                      ? "EXPENSE_ONLY"
                                      : "MATCH",
                            selectedItemId:
                              review.receiptClassification === "INTERNAL_TRANSFER" || value === "MATCH"
                                ? line.selectedItemId
                                : ""
                          })
                        }
                        options={
                          review.receiptClassification === "EXPENSE_ONLY"
                            ? [{ value: "EXPENSE_ONLY", label: "Expense evidence only (no stock item)" }]
                            : review.receiptClassification === "INTERNAL_TRANSFER"
                              ? [{ value: "MATCH", label: "Match existing item (required for transfer)" }]
                              : [
                                  { value: "MATCH", label: "Match existing item" },
                                  { value: "NEW", label: "Create new item" },
                                  { value: "EXPENSE_ONLY", label: "Expense evidence only (no stock item)" }
                                ]
                        }
                      />
                      {line.mode === "MATCH" ? (
                        <>
                          <SelectField
                            label="Matched Inventory Item"
                            value={line.selectedItemId}
                            onChange={(value) => updateLine(line.id, { selectedItemId: value })}
                            options={[
                              { value: "", label: "No match selected" },
                              ...items.map((item) => ({
                                value: item.id,
                                label: `${item.name} (${item.sku})`
                              }))
                            ]}
                          />
                          {!line.selectedItemId && (
                            <div className="col-span-full rounded border border-amber-300 bg-amber-50 px-2 py-1.5 text-xs text-amber-900">
                              {review.receiptClassification === "INTERNAL_TRANSFER"
                                ? "Select an existing item. Internal transfers can only move stock for existing inventory items."
                                : "No existing item selected. This line will be auto-created as a new inventory item when you save."}
                            </div>
                          )}
                        </>
                      ) : line.mode === "NEW" ? (
                        <>
                          <InputField
                            label="Item Name"
                            value={line.newItemName}
                            onChange={(value) => updateLine(line.id, { newItemName: value })}
                          />
                          <SelectField
                            label="Category"
                            value={line.selectedCategory}
                            onChange={(value) => updateLine(line.id, { selectedCategory: value })}
                            options={inventoryCategoryOptions.map((entry) => ({ value: entry.value, label: entry.label }))}
                          />
                          <InputField
                            label="SKU (optional)"
                            value={line.newItemSku}
                            onChange={(value) => updateLine(line.id, { newItemSku: value.toUpperCase() })}
                          />
                        </>
                      ) : (
                        <div className="col-span-full rounded border border-amber-300 bg-amber-50 px-2 py-1.5 text-xs text-amber-900">
                          This line will be kept as receipt/expense evidence only. No inventory item or stock movement will be created.
                        </div>
                      )}
                      {!lineNeedsInventoryAction && (
                        <div className="col-span-full">
                          <button
                            type="button"
                            onClick={() =>
                              setInventoryActionEditorByLine((current) => ({
                                ...current,
                                [line.id]: false
                              }))
                            }
                            className="rounded border border-slate-300 bg-white px-2 py-0.5 text-[11px] text-slate-700 hover:bg-slate-100"
                          >
                            Hide inventory action options
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
            )
          )
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-slate-200 pt-2">
        {inventoryActionNeeded && !showMismatchInventoryHandling ? (
          <button type="button" onClick={() => setShowMismatchInventoryHandling(true)} className="gf-btn-primary">
            Continue to inventory
          </button>
        ) : (
          <>
            {inventoryActionNeeded && showMismatchInventoryHandling && (
              <button type="button" onClick={() => setShowMismatchInventoryHandling(false)} className="gf-btn-secondary">
                Back to items
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                if (mismatchDetected) {
                  setShowMismatchFinalizeConfirm(true);
                  return;
                }
                setFollowUpStage("FINALIZE");
              }}
              className="gf-btn-primary"
            >
              Continue to finalize
            </button>
          </>
        )}
        {!manualInputSelected && (
          <button
            type="button"
            onClick={() => {
              setReview(null);
              resetScanSessionState();
              setFollowUpStage("SCAN");
            }}
            className="gf-btn-secondary"
          >
            Rescan
          </button>
        )}
      </div>
    </>
  );
}
