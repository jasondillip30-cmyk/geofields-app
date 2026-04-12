import Link from "next/link";
import type React from "react";

import type {
  GuidedBillableInputsModel,
  GuidedBillableLineBuildResult
} from "@/lib/drilling-report-guided-inputs";
import { DRILL_DELAY_REASON_OPTIONS } from "@/lib/drill-report-delay-reasons";
import { formatCurrency, formatNumber } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import {
  InputField,
  ReadOnlyField,
  SelectField,
  formatProjectStatus,
  parseDelayReasonCategoryForForm
} from "./drilling-reports-page-utils";
import type {
  DrillReportFormState,
  HoleProgressSummary,
  ProjectConsumablePoolItem,
  ProjectOption,
  StagedConsumableLine
} from "./drilling-reports-page-types";

type DrillingReportEntryFormCardProps = {
  isFormOpen: boolean;
  spendingReportsHref: string;
  saveReport: (event: React.FormEvent<HTMLFormElement>) => void;
  formMode: "create" | "edit";
  form: DrillReportFormState;
  setForm: React.Dispatch<React.SetStateAction<DrillReportFormState>>;
  formSaving: boolean;
  formError: string | null;
  isSingleProjectScope: boolean;
  formProject: ProjectOption | null;
  projects: ProjectOption[];
  reportableProjects: ProjectOption[];
  formProjectRigsLabel: string;
  formProjectRigOptions: Array<{ id: string; rigCode: string }>;
  formProjectHoleProgress: HoleProgressSummary[];
  holeProgressLoading: boolean;
  selectedHoleProgress: HoleProgressSummary | null;
  nextHoleNumberSuggestion: string;
  derivedFromMeter: number;
  derivedToMeter: number;
  stageContextText: string;
  estimatedDailyBillable: number;
  guidedBillableInputs: GuidedBillableInputsModel;
  guidedBillableLinesResult: GuidedBillableLineBuildResult;
  stagedCoverageWarning: string | null;
  requiresContinuityOverride: boolean;
  setRequiresContinuityOverride: React.Dispatch<React.SetStateAction<boolean>>;
  formConsumablesLoading: boolean;
  formConsumablesPool: ProjectConsumablePoolItem[];
  consumableSearch: string;
  setConsumableSearch: React.Dispatch<React.SetStateAction<string>>;
  filteredConsumableSearchResults: ProjectConsumablePoolItem[];
  pendingConsumable: ProjectConsumablePoolItem | null;
  pendingConsumableQuantity: string;
  setPendingConsumableQuantity: React.Dispatch<React.SetStateAction<string>>;
  setPendingConsumableItemId: React.Dispatch<React.SetStateAction<string>>;
  addPendingConsumableToStaged: () => void;
  stagedConsumables: StagedConsumableLine[];
  setStagedConsumables: React.Dispatch<React.SetStateAction<StagedConsumableLine[]>>;
  consumablesPoolByItemId: Map<string, ProjectConsumablePoolItem>;
  onProjectChange: (projectId: string) => void;
};

export function DrillingReportEntryFormCard({
  isFormOpen,
  spendingReportsHref,
  saveReport,
  formMode,
  form,
  setForm,
  formSaving,
  formError,
  isSingleProjectScope,
  formProject,
  projects,
  reportableProjects,
  formProjectRigsLabel,
  formProjectRigOptions,
  formProjectHoleProgress,
  holeProgressLoading,
  selectedHoleProgress,
  nextHoleNumberSuggestion,
  derivedFromMeter,
  derivedToMeter,
  stageContextText,
  estimatedDailyBillable,
  guidedBillableInputs,
  guidedBillableLinesResult,
  stagedCoverageWarning,
  requiresContinuityOverride,
  setRequiresContinuityOverride,
  formConsumablesLoading,
  formConsumablesPool,
  consumableSearch,
  setConsumableSearch,
  filteredConsumableSearchResults,
  pendingConsumable,
  pendingConsumableQuantity,
  setPendingConsumableQuantity,
  setPendingConsumableItemId,
  addPendingConsumableToStaged,
  stagedConsumables,
  setStagedConsumables,
  consumablesPoolByItemId,
  onProjectChange
}: DrillingReportEntryFormCardProps) {
  if (!isFormOpen) {
    return null;
  }

  return (
    <Card
      title="New drilling report"
      subtitle="Record today's drilling activity for the locked project."
      action={
        <Link href={spendingReportsHref} className="gf-btn-subtle">
          View reports in Project Operations
        </Link>
      }
    >
      <form onSubmit={saveReport} className="px-1 py-1">
        <div className="mb-4 gf-guided-strip">
          <p className="gf-guided-strip-title">Keep it simple</p>
          <div className="gf-guided-step-list">
            <p className="gf-guided-step">Use meters drilled today as the main depth input.</p>
            <p className="gf-guided-step">Fill daily operational fields and configured extras only.</p>
            <p className="gf-guided-step">Save report to record activity and linked consumable usage.</p>
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
          <ReadOnlyField
            label="Report date"
            value={formMode === "create" ? `${form.date} (today)` : form.date}
          />

          {isSingleProjectScope ? (
            <ReadOnlyField
              label="Project (locked)"
              value={
                formProject
                  ? `${formProject.name} (${formatProjectStatus(formProject.status)})`
                  : "Selected project"
              }
            />
          ) : (
            <SelectField
              label="Project"
              value={form.projectId}
              onChange={(value) => {
                setRequiresContinuityOverride(false);
                onProjectChange(value);
              }}
              options={(reportableProjects.length > 0 ? reportableProjects : projects).map((project) => ({
                value: project.id,
                label: `${project.name} (${formatProjectStatus(project.status)})`
              }))}
              required
            />
          )}

          {isSingleProjectScope ? (
            <div className="rounded-lg border border-brand-200 bg-brand-50/70 px-3 py-2 text-sm text-brand-900 lg:col-span-2">
              <p>
                <span className="font-semibold">Client:</span> {formProject?.client.name || "-"}
              </p>
              <p>
                <span className="font-semibold">Project rig(s):</span> {formProjectRigsLabel}
              </p>
            </div>
          ) : (
            <>
              <ReadOnlyField label="Client" value={formProject?.client.name || "-"} />
              <ReadOnlyField label="Project rig(s)" value={formProjectRigsLabel} />
            </>
          )}

          {formProjectRigOptions.length > 1 ? (
            <SelectField
              label="Rig"
              value={form.rigId}
              onChange={(value) => setForm((current) => ({ ...current, rigId: value }))}
              options={formProjectRigOptions.map((rigOption) => ({
                value: rigOption.id,
                label: rigOption.rigCode
              }))}
              required
            />
          ) : formProjectRigOptions.length === 1 ? (
            <ReadOnlyField label="Rig" value={formProjectRigOptions[0]?.rigCode || "-"} />
          ) : (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 lg:col-span-2">
              This project has no assigned rig. Assign a rig to the project before saving reports.
            </div>
          )}

          <div className="lg:col-span-4 rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
            <p className="text-sm font-semibold text-ink-900">Hole progression</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={formProjectHoleProgress.length === 0}
                onClick={() =>
                  setForm((current) => ({
                    ...current,
                    holeMode: "CONTINUE",
                    selectedHoleNumber:
                      current.selectedHoleNumber || formProjectHoleProgress[0]?.holeNumber || ""
                  }))
                }
                className={`rounded-full border px-3 py-1 text-xs ${
                  form.holeMode === "CONTINUE"
                    ? "border-brand-500 bg-brand-50 text-brand-800"
                    : "border-slate-200 bg-white text-slate-700"
                } disabled:cursor-not-allowed disabled:opacity-60`}
              >
                Continue existing hole
              </button>
              <button
                type="button"
                onClick={() =>
                  setForm((current) => ({
                    ...current,
                    holeMode: "START_NEW",
                    holeNumber: nextHoleNumberSuggestion
                  }))
                }
                className={`rounded-full border px-3 py-1 text-xs ${
                  form.holeMode === "START_NEW"
                    ? "border-brand-500 bg-brand-50 text-brand-800"
                    : "border-slate-200 bg-white text-slate-700"
                }`}
              >
                Start new hole
              </button>
            </div>

            {form.holeMode === "CONTINUE" ? (
              <div className="mt-3 grid gap-2 md:grid-cols-2">
                <SelectField
                  label="Hole"
                  value={form.selectedHoleNumber}
                  onChange={(value) =>
                    setForm((current) => ({
                      ...current,
                      selectedHoleNumber: value,
                      holeNumber: value
                    }))
                  }
                  options={formProjectHoleProgress.map((hole) => ({
                    value: hole.holeNumber,
                    label: `${hole.holeNumber} (current depth ${formatNumber(hole.currentDepth)}m)`
                  }))}
                  required
                />
                <ReadOnlyField
                  label="Current drilled depth"
                  value={
                    holeProgressLoading
                      ? "Loading..."
                      : selectedHoleProgress
                        ? `${formatNumber(selectedHoleProgress.currentDepth)}m`
                        : "No saved depth yet"
                  }
                />
              </div>
            ) : (
              <ReadOnlyField label="New hole number" value={nextHoleNumberSuggestion} />
            )}
          </div>

          <div className="lg:col-span-4 rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
            <p className="text-sm font-semibold text-ink-900">Daily activity</p>
            <p className="mt-1 text-xs text-slate-600">
              Enter the daily drilling activity. Depth progression is derived automatically.
            </p>
            <div className="mt-3 grid gap-3 md:grid-cols-2 lg:grid-cols-4">
              <InputField
                label="Meters drilled today"
                type="number"
                value={form.metersDrilledToday}
                onChange={(value) => setForm((current) => ({ ...current, metersDrilledToday: value }))}
              />

              <ReadOnlyField label="Previous depth" value={`${formatNumber(derivedFromMeter)}m`} />
              <ReadOnlyField label="New depth" value={`${formatNumber(derivedToMeter)}m`} />
              <ReadOnlyField label="Stage guidance" value={stageContextText} />

              <InputField
                label="Work hours"
                type="number"
                value={form.workHours}
                onChange={(value) => setForm((current) => ({ ...current, workHours: value }))}
              />

              <InputField
                label="Delay hours"
                type="number"
                value={form.delayHours}
                onChange={(value) => setForm((current) => ({ ...current, delayHours: value }))}
              />

              {Number(form.delayHours || 0) > 0 ? (
                <SelectField
                  label="Delay reason"
                  value={form.delayReasonCategory}
                  onChange={(value) =>
                    setForm((current) => ({
                      ...current,
                      delayReasonCategory: parseDelayReasonCategoryForForm(value)
                    }))
                  }
                  options={DRILL_DELAY_REASON_OPTIONS.map((option) => ({
                    value: option.value,
                    label: option.label
                  }))}
                  required
                />
              ) : null}

              <InputField
                label="Rig moves"
                type="number"
                value={form.rigMoves}
                onChange={(value) => setForm((current) => ({ ...current, rigMoves: value }))}
              />

              <InputField
                label="Standby hours"
                type="number"
                value={form.standbyHours}
                onChange={(value) => setForm((current) => ({ ...current, standbyHours: value }))}
              />

              <InputField
                label="Lead operator"
                value={form.leadOperatorName}
                onChange={(value) => setForm((current) => ({ ...current, leadOperatorName: value }))}
              />

              <InputField
                label="Assistants"
                type="number"
                value={form.assistantCount}
                onChange={(value) => setForm((current) => ({ ...current, assistantCount: value }))}
              />
            </div>
            {Number(form.delayHours || 0) > 0 ? (
              <label className="mt-3 block text-sm text-ink-700">
                <span className="mb-1 block">Delay note (optional)</span>
                <textarea
                  value={form.delayReasonNote}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      delayReasonNote: event.target.value
                    }))
                  }
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none ring-brand-300 focus:ring"
                  rows={2}
                />
              </label>
            ) : null}
            {requiresContinuityOverride || form.holeContinuityOverrideReason.trim().length > 0 ? (
              <label className="mt-3 block text-sm text-ink-700">
                <span className="mb-1 block">Depth continuity override reason</span>
                <textarea
                  value={form.holeContinuityOverrideReason}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      holeContinuityOverrideReason: event.target.value
                    }))
                  }
                  className="w-full rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm outline-none ring-brand-300 focus:ring"
                  rows={2}
                  placeholder="Add a short reason for the depth difference."
                />
              </label>
            ) : null}
            <div className="mt-3 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700">
              Estimated revenue (preview):{" "}
              <span className="font-semibold text-ink-900">{formatCurrency(estimatedDailyBillable)}</span>
            </div>
            {guidedBillableInputs.meterMode === "single" && guidedBillableInputs.singleMeterItem ? (
              <p className="mt-2 text-xs text-slate-600">
                Meters drilled today automatically map to{" "}
                <span className="font-medium">{guidedBillableInputs.singleMeterItem.label}</span>.
              </p>
            ) : null}
            {stagedCoverageWarning ? (
              <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                {stagedCoverageWarning}
              </div>
            ) : null}
            {guidedBillableLinesResult.hasStagedAutoAllocation ? (
              <div className="mt-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700">
                <p className="font-semibold text-ink-900">Staged meter allocation (auto)</p>
                <div className="mt-1 space-y-1">
                  {guidedBillableLinesResult.stagedAllocationPreview.filter((line) => line.quantity > 0)
                    .length === 0 ? (
                    <p>No meters from this report range match configured stage bands.</p>
                  ) : (
                    guidedBillableLinesResult.stagedAllocationPreview
                      .filter((line) => line.quantity > 0)
                      .map((line) => (
                        <p key={line.itemCode}>
                          {line.label}: {formatNumber(line.quantity)} {line.unit}
                        </p>
                      ))
                  )}
                </div>
              </div>
            ) : null}
          </div>

          {guidedBillableInputs.extraItems.length > 0 ? (
            <div className="lg:col-span-4 rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
              <p className="text-sm font-semibold text-ink-900">Project extras (if used today)</p>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                {guidedBillableInputs.extraItems.map((item) => (
                  <InputField
                    key={item.itemCode}
                    label={`${item.label} (${item.unit})`}
                    type="number"
                    value={form.billableQuantities[item.itemCode] || ""}
                    onChange={(value) =>
                      setForm((current) => ({
                        ...current,
                        billableQuantities: {
                          ...current.billableQuantities,
                          [item.itemCode]: value
                        }
                      }))
                    }
                  />
                ))}
              </div>
            </div>
          ) : null}

          <div className="lg:col-span-4 rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
            <p className="text-sm font-semibold text-ink-900">Approved consumables used today</p>
            <p className="mt-1 text-xs text-slate-600">
              Optional. Search approved project consumables, then add what was actually used on this report.
            </p>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <label className="text-xs text-ink-700">
                <span className="mb-1 block uppercase tracking-wide text-slate-500">
                  Search consumables
                </span>
                <input
                  value={consumableSearch}
                  onChange={(event) => setConsumableSearch(event.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  placeholder={
                    formConsumablesLoading
                      ? "Loading approved consumables..."
                      : "Search by item name or SKU"
                  }
                  disabled={formConsumablesLoading || !form.projectId}
                />
              </label>
              <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700">
                <p className="font-semibold text-ink-900">
                  {formConsumablesLoading ? "Refreshing approved pool..." : "Approved pool"}
                </p>
                <p className="mt-1">
                  {formConsumablesLoading
                    ? "Checking approved and available quantities for this project."
                    : `${formConsumablesPool.length} item(s) currently available for use.`}
                </p>
              </div>
            </div>

            {consumableSearch.trim().length > 0 ? (
              <div className="mt-2 max-h-44 overflow-auto rounded-lg border border-slate-200 bg-white">
                {filteredConsumableSearchResults.length === 0 ? (
                  <p className="px-3 py-2 text-xs text-slate-600">
                    No approved consumables match this search.
                  </p>
                ) : (
                  filteredConsumableSearchResults.map((entry) => (
                    <button
                      key={entry.itemId}
                      type="button"
                      onClick={() => {
                        setPendingConsumableItemId(entry.itemId);
                        setPendingConsumableQuantity("1");
                        setConsumableSearch("");
                      }}
                      className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-2 border-b border-slate-100 px-3 py-2 text-left text-xs text-ink-700 last:border-b-0 hover:bg-slate-50"
                    >
                      <span className="truncate">
                        {entry.itemName} <span className="text-slate-500">({entry.sku})</span>
                      </span>
                      <span className="font-medium text-slate-600">
                        Available {formatNumber(entry.availableNow)}
                      </span>
                    </button>
                  ))
                )}
              </div>
            ) : null}

            {pendingConsumable ? (
              <div className="mt-3 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-ink-700">
                <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_120px_auto] md:items-end">
                  <div>
                    <p className="font-semibold text-ink-900">
                      {pendingConsumable.itemName}{" "}
                      <span className="text-slate-500">({pendingConsumable.sku})</span>
                    </p>
                    <p className="mt-0.5 text-slate-600">
                      Available {formatNumber(pendingConsumable.availableNow)}
                    </p>
                  </div>
                  <InputField
                    label="Quantity"
                    type="number"
                    value={pendingConsumableQuantity}
                    onChange={setPendingConsumableQuantity}
                  />
                  <div className="flex items-center gap-2 pb-1">
                    <button
                      type="button"
                      onClick={addPendingConsumableToStaged}
                      className="rounded-md bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-700"
                    >
                      Use
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setPendingConsumableItemId("");
                        setPendingConsumableQuantity("1");
                      }}
                      className="rounded-md border border-slate-200 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            ) : null}

            <div className="mt-3 rounded-lg border border-slate-200 bg-white">
              <div className="border-b border-slate-200 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Used in this report
              </div>
              {stagedConsumables.length === 0 ? (
                <p className="px-3 py-2 text-xs text-slate-600">No consumables added yet.</p>
              ) : (
                <div className="divide-y divide-slate-100">
                  {stagedConsumables.map((row) => {
                    const pool = consumablesPoolByItemId.get(row.itemId);
                    return (
                      <div
                        key={row.itemId}
                        className="grid gap-2 px-3 py-2 text-xs text-ink-700 md:grid-cols-[minmax(0,1fr)_140px_auto]"
                      >
                        <div>
                          <p className="font-medium text-ink-900">
                            {row.itemName} <span className="text-slate-500">({row.sku})</span>
                          </p>
                          <p className="mt-0.5 text-slate-600">
                            Available {formatNumber(pool?.availableNow || 0)}
                          </p>
                        </div>
                        <InputField
                          label="Quantity"
                          type="number"
                          value={row.quantity}
                          onChange={(value) =>
                            setStagedConsumables((current) =>
                              current.map((entry) =>
                                entry.itemId === row.itemId
                                  ? {
                                      ...entry,
                                      quantity: value
                                    }
                                  : entry
                              )
                            )
                          }
                        />
                        <div className="flex items-center justify-end pb-1">
                          <button
                            type="button"
                            onClick={() =>
                              setStagedConsumables((current) =>
                                current.filter((entry) => entry.itemId !== row.itemId)
                              )
                            }
                            className="rounded-md border border-slate-200 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50"
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          <label className="text-sm text-ink-700 lg:col-span-4">
            <span className="mb-1 block">Comments</span>
            <textarea
              value={form.comments}
              onChange={(event) => setForm((current) => ({ ...current, comments: event.target.value }))}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none ring-brand-300 focus:ring"
              rows={4}
            />
          </label>
        </div>

        {formError && (
          <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {formError}
          </div>
        )}

        <div className="mt-4 flex flex-wrap justify-end gap-2 border-t border-slate-200 pt-4">
          <button
            type="submit"
            disabled={formSaving}
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {formSaving ? "Saving..." : "Save report"}
          </button>
        </div>
      </form>
    </Card>
  );
}
