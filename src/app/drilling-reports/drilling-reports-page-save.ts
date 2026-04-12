import type {
  GuidedBillableLineBuildResult,
  GuidedBillableLineInput
} from "@/lib/drilling-report-guided-inputs";
import { formatNumber } from "@/lib/utils";
import { readApiError } from "./drilling-reports-page-utils";
import type {
  DrillReportFormState,
  ProjectBillingRateItemOption,
  ProjectConsumablePoolItem,
  StagedConsumableLine
} from "./drilling-reports-page-types";

interface PersistDrillingReportParams {
  form: DrillReportFormState;
  formMode: "create" | "edit";
  editingReportId: string | null;
  formProjectLocation: string | null | undefined;
  formProjectRigOptions: Array<{ id: string; rigCode: string }>;
  formProjectBillingItems: ProjectBillingRateItemOption[];
  guidedBillableLinesResult: GuidedBillableLineBuildResult;
  derivedHoleNumber: string;
  metersDrilledToday: number;
  derivedFromMeter: number;
  derivedToMeter: number;
  requiresContinuityOverride: boolean;
  stagedConsumables: StagedConsumableLine[];
  consumablesPoolByItemId: Map<string, ProjectConsumablePoolItem>;
}

interface PersistDrillingReportResult {
  ok: boolean;
  error?: string;
  requiresContinuityOverride?: boolean;
}

function buildConsumablesUsedPayload(params: {
  stagedConsumables: StagedConsumableLine[];
  consumablesPoolByItemId: Map<string, ProjectConsumablePoolItem>;
}): { error: string | null; rows: Array<{ itemId: string; quantity: number }> } {
  const rows: Array<{ itemId: string; quantity: number }> = [];
  for (const row of params.stagedConsumables) {
    const quantity = Number(row.quantity);
    if (!Number.isFinite(quantity) || quantity < 0) {
      return {
        error: `Consumable quantity for ${row.itemName} must be zero or greater.`,
        rows: []
      };
    }
    if (quantity === 0) {
      continue;
    }
    const pool = params.consumablesPoolByItemId.get(row.itemId);
    if (!pool) {
      return {
        error: `${row.itemName} is no longer approved and available for this project.`,
        rows: []
      };
    }
    if (quantity > pool.availableNow) {
      return {
        error: `Cannot use more than available for ${row.itemName}. Requested ${formatNumber(quantity)}, available ${formatNumber(pool.availableNow)}.`,
        rows: []
      };
    }
    rows.push({
      itemId: row.itemId,
      quantity
    });
  }
  return { error: null, rows };
}

function buildBillableLinesInput(
  guidedBillableLinesResult: GuidedBillableLineBuildResult
): { error: string | null; lines: GuidedBillableLineInput[] } {
  if (guidedBillableLinesResult.error) {
    return {
      error: guidedBillableLinesResult.error,
      lines: []
    };
  }
  return {
    error: null,
    lines: guidedBillableLinesResult.lines
  };
}

export async function persistDrillingReport(
  params: PersistDrillingReportParams
): Promise<PersistDrillingReportResult> {
  const billableLines = buildBillableLinesInput(params.guidedBillableLinesResult);
  if (billableLines.error) {
    return { ok: false, error: billableLines.error };
  }

  if (!params.form.projectId) {
    return { ok: false, error: "Select a project first." };
  }
  if (!params.form.rigId) {
    return { ok: false, error: "Select one of the project's assigned rigs before saving." };
  }
  if (params.formProjectRigOptions.length === 0) {
    return { ok: false, error: "This project has no assigned rig. Assign a rig to the project first." };
  }
  if (!params.formProjectRigOptions.some((rigOption) => rigOption.id === params.form.rigId)) {
    return { ok: false, error: "Selected rig is not assigned to this project. Choose one of the project rigs." };
  }
  if (!params.derivedHoleNumber) {
    return { ok: false, error: "Choose a hole to continue or start a new hole." };
  }
  if (params.metersDrilledToday < 0) {
    return { ok: false, error: "Meters drilled today must be zero or greater." };
  }

  const parsedDelayHours = Number(params.form.delayHours);
  const delayHours = Number.isFinite(parsedDelayHours) ? parsedDelayHours : 0;
  if (delayHours > 0 && !params.form.delayReasonCategory) {
    return { ok: false, error: "Select a delay reason when delay hours are above zero." };
  }

  const trimmedOverrideReason = params.form.holeContinuityOverrideReason.trim();
  if (params.requiresContinuityOverride && trimmedOverrideReason.length === 0) {
    return { ok: false, error: "Add a short reason to continue with a different starting depth." };
  }

  const consumablesUsedPayload = buildConsumablesUsedPayload({
    stagedConsumables: params.stagedConsumables,
    consumablesPoolByItemId: params.consumablesPoolByItemId
  });
  if (consumablesUsedPayload.error) {
    return { ok: false, error: consumablesUsedPayload.error };
  }

  const trimmedDelayNote = params.form.delayReasonNote.trim();
  const trimmedLeadOperatorName = params.form.leadOperatorName.trim();
  const parsedAssistantCount = Number(params.form.assistantCount);
  const assistantCount =
    Number.isFinite(parsedAssistantCount) && parsedAssistantCount >= 0
      ? Math.round(parsedAssistantCount)
      : 0;

  const payload = {
    date: params.form.date,
    projectId: params.form.projectId,
    rigId: params.form.rigId,
    holeNumber: params.derivedHoleNumber,
    areaLocation: params.formProjectLocation || "Project site",
    fromMeter: params.derivedFromMeter,
    toMeter: params.derivedToMeter,
    totalMetersDrilled: params.metersDrilledToday,
    workHours: Number(params.form.workHours),
    rigMoves: Number(params.form.rigMoves),
    standbyHours: Number(params.form.standbyHours),
    delayHours,
    delayReasonCategory: delayHours > 0 ? params.form.delayReasonCategory || null : null,
    delayReasonNote: delayHours > 0 ? (trimmedDelayNote.length > 0 ? trimmedDelayNote : null) : null,
    holeContinuityOverrideReason: trimmedOverrideReason.length > 0 ? trimmedOverrideReason : null,
    leadOperatorName: trimmedLeadOperatorName.length > 0 ? trimmedLeadOperatorName : null,
    assistantCount,
    comments: params.form.comments,
    consumablesUsed: consumablesUsedPayload.rows,
    ...(params.formProjectBillingItems.length > 0 ? { billableLines: billableLines.lines } : {})
  };

  try {
    if (params.formMode === "create") {
      const response = await fetch("/api/drilling-reports", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const message = await readApiError(response, "Failed to save drilling report.");
        return {
          ok: false,
          error: message,
          requiresContinuityOverride: message.includes("Add an override reason to save.")
        };
      }
      await response.json();
      return { ok: true };
    }

    if (!params.editingReportId) {
      return { ok: false, error: "Unable to edit report. Missing report ID." };
    }

    const response = await fetch(`/api/drilling-reports/${params.editingReportId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const message = await readApiError(response, "Failed to update drilling report.");
      return {
        ok: false,
        error: message,
        requiresContinuityOverride: message.includes("Add an override reason to save.")
      };
    }

    await response.json();
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Failed to save drilling report."
    };
  }
}

export function emitDrillingAnalyticsRefresh() {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem("gf:revenue-updated-at", String(Date.now()));
  window.dispatchEvent(new Event("gf:revenue-updated"));
  window.localStorage.setItem("gf:profit-updated-at", String(Date.now()));
  window.dispatchEvent(new Event("gf:profit-updated"));
}
