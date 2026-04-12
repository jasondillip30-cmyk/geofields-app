import { useMemo } from "react";

import {
  buildGuidedBillableInputsModel,
  buildGuidedBillableLineInputs
} from "@/lib/drilling-report-guided-inputs";
import { formatNumber } from "@/lib/utils";

import {
  getNextHoleNumberSuggestion,
  resolveStageContextRows
} from "./drilling-reports-page-utils";
import type {
  DrillReportFormState,
  HoleProgressSummary,
  ProjectConsumablePoolItem,
  ProjectOption,
  StagedConsumableLine
} from "./drilling-reports-page-types";

type UseDrillingReportsFormDerivedArgs = {
  form: DrillReportFormState;
  formMode: "create" | "edit";
  formProject: ProjectOption | null;
  holeProgressByProject: Record<string, HoleProgressSummary[]>;
  formConsumablesPool: ProjectConsumablePoolItem[];
  consumableSearch: string;
  pendingConsumableItemId: string;
  stagedConsumables: StagedConsumableLine[];
};

export function useDrillingReportsFormDerived({
  form,
  formMode,
  formProject,
  holeProgressByProject,
  formConsumablesPool,
  consumableSearch,
  pendingConsumableItemId,
  stagedConsumables
}: UseDrillingReportsFormDerivedArgs) {
  const formProjectBillingItems = useMemo(
    () =>
      (formProject?.billingRateItems || [])
        .filter((item) => item.isActive)
        .sort((left, right) => left.sortOrder - right.sortOrder),
    [formProject]
  );

  const guidedBillableInputs = useMemo(
    () => buildGuidedBillableInputsModel(formProjectBillingItems),
    [formProjectBillingItems]
  );

  const formProjectHoleProgress = useMemo(
    () => holeProgressByProject[form.projectId] || [],
    [form.projectId, holeProgressByProject]
  );

  const nextHoleNumberSuggestion = useMemo(
    () => getNextHoleNumberSuggestion(formProjectHoleProgress),
    [formProjectHoleProgress]
  );

  const selectedHoleProgress = useMemo(
    () =>
      formProjectHoleProgress.find((entry) => entry.holeNumber === form.selectedHoleNumber) || null,
    [form.selectedHoleNumber, formProjectHoleProgress]
  );

  const defaultBaselineDepth = useMemo(() => {
    if (formMode === "edit") {
      const existingFrom = Number(form.fromMeter);
      return Number.isFinite(existingFrom) ? existingFrom : 0;
    }
    if (form.holeMode === "CONTINUE") {
      return selectedHoleProgress?.currentDepth || 0;
    }
    return 0;
  }, [form.fromMeter, form.holeMode, formMode, selectedHoleProgress]);

  const metersDrilledToday = useMemo(() => {
    const parsed = Number(form.metersDrilledToday || 0);
    if (!Number.isFinite(parsed) || parsed < 0) {
      return 0;
    }
    return parsed;
  }, [form.metersDrilledToday]);

  const derivedFromMeter = defaultBaselineDepth;
  const derivedToMeter = derivedFromMeter + metersDrilledToday;

  const stageContextRows = useMemo(
    () => resolveStageContextRows(formProjectBillingItems, derivedFromMeter, derivedToMeter),
    [derivedFromMeter, derivedToMeter, formProjectBillingItems]
  );

  const stageContextText = useMemo(() => {
    if (metersDrilledToday <= 0) {
      return "Enter meters drilled today to preview stage context.";
    }
    if (stageContextRows.length === 0) {
      return "No staged billing band overlaps this report range.";
    }
    return stageContextRows
      .map((row) => `${row.label} (${formatNumber(row.rangeStart)}m-${formatNumber(row.rangeEnd)}m)`)
      .join(" • ");
  }, [metersDrilledToday, stageContextRows]);

  const guidedBillableLinesResult = useMemo(
    () =>
      buildGuidedBillableLineInputs({
        billingItems: formProjectBillingItems,
        metersDrilledToday,
        derivedFromMeter,
        derivedToMeter,
        workHours: Number(form.workHours),
        rigMoves: Number(form.rigMoves),
        standbyHours: Number(form.standbyHours),
        manualQuantities: form.billableQuantities
      }),
    [
      form.billableQuantities,
      derivedFromMeter,
      derivedToMeter,
      form.rigMoves,
      form.standbyHours,
      form.workHours,
      formProjectBillingItems,
      metersDrilledToday
    ]
  );

  const stagedCoverageWarning = useMemo(() => {
    if (!guidedBillableLinesResult.hasStagedAutoAllocation || metersDrilledToday <= 0) {
      return null;
    }
    if (guidedBillableLinesResult.stagedUnallocatedMeters <= 0) {
      return null;
    }
    return `Only ${formatNumber(guidedBillableLinesResult.stagedAllocatedMeters)}m of ${formatNumber(metersDrilledToday)}m fits configured stage bands. ${formatNumber(guidedBillableLinesResult.stagedUnallocatedMeters)}m is outside configured stage depth bands.`;
  }, [
    guidedBillableLinesResult.hasStagedAutoAllocation,
    guidedBillableLinesResult.stagedAllocatedMeters,
    guidedBillableLinesResult.stagedUnallocatedMeters,
    metersDrilledToday
  ]);

  const estimatedDailyBillable = useMemo(() => {
    const lineAmount = guidedBillableLinesResult.lines.reduce((sum, line) => {
      const rateItem = formProjectBillingItems.find((entry) => entry.itemCode === line.itemCode);
      const unitRate = Number(rateItem?.unitRate || 0);
      if (!Number.isFinite(unitRate) || unitRate <= 0) {
        return sum;
      }
      return sum + line.quantity * unitRate;
    }, 0);
    if (lineAmount > 0) {
      return lineAmount;
    }
    const fallbackRate = Number(formProject?.contractRatePerM || 0);
    return metersDrilledToday * (Number.isFinite(fallbackRate) ? fallbackRate : 0);
  }, [formProject?.contractRatePerM, formProjectBillingItems, guidedBillableLinesResult.lines, metersDrilledToday]);

  const consumablesPoolByItemId = useMemo(
    () => new Map(formConsumablesPool.map((entry) => [entry.itemId, entry])),
    [formConsumablesPool]
  );

  const pendingConsumable = useMemo(
    () => formConsumablesPool.find((entry) => entry.itemId === pendingConsumableItemId) || null,
    [formConsumablesPool, pendingConsumableItemId]
  );

  const filteredConsumableSearchResults = useMemo(() => {
    const query = consumableSearch.trim().toLowerCase();
    const stagedIds = new Set(stagedConsumables.map((row) => row.itemId));
    const filtered = formConsumablesPool.filter((entry) => {
      if (stagedIds.has(entry.itemId)) {
        return false;
      }
      if (!query) {
        return true;
      }
      return (
        entry.itemName.toLowerCase().includes(query) ||
        entry.sku.toLowerCase().includes(query)
      );
    });
    return filtered.slice(0, 8);
  }, [consumableSearch, formConsumablesPool, stagedConsumables]);

  return {
    formProjectBillingItems,
    guidedBillableInputs,
    formProjectHoleProgress,
    nextHoleNumberSuggestion,
    selectedHoleProgress,
    derivedFromMeter,
    derivedToMeter,
    metersDrilledToday,
    stageContextText,
    guidedBillableLinesResult,
    stagedCoverageWarning,
    estimatedDailyBillable,
    consumablesPoolByItemId,
    pendingConsumable,
    filteredConsumableSearchResults
  };
}
