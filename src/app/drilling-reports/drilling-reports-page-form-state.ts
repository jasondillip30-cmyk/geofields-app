import { createEmptyForm, parseDelayReasonCategoryForForm } from "./drilling-reports-page-utils";
import type {
  DrillReportFormState,
  DrillReportRecord,
  StagedConsumableLine
} from "./drilling-reports-page-types";

export function buildStagedConsumablesFromReport(report: DrillReportRecord): StagedConsumableLine[] {
  const stagedByItemId = new Map<string, StagedConsumableLine>();
  for (const movement of report.inventoryMovements || []) {
    const itemId = movement.item?.id || "";
    if (!itemId) {
      continue;
    }
    const existingLine = stagedByItemId.get(itemId);
    const movementQuantity = Math.max(0, Number(movement.quantity || 0));
    if (existingLine) {
      const nextQuantity = Number(existingLine.quantity) + movementQuantity;
      existingLine.quantity = String(nextQuantity);
    } else {
      stagedByItemId.set(itemId, {
        itemId,
        itemName: movement.item?.name || "Item",
        sku: movement.item?.sku || "",
        quantity: String(movementQuantity)
      });
    }
  }
  return Array.from(stagedByItemId.values());
}

export function buildEditFormFromReport(report: DrillReportRecord): DrillReportFormState {
  const billableQuantities = report.billableLines.reduce<Record<string, string>>(
    (accumulator, line) => {
      accumulator[line.itemCode] = String(line.quantity);
      return accumulator;
    },
    {}
  );

  return {
    date: new Date(report.date).toISOString().slice(0, 10),
    projectId: report.project.id,
    rigId: report.rig.id,
    holeMode: "CONTINUE",
    selectedHoleNumber: report.holeNumber,
    holeNumber: report.holeNumber,
    fromMeter: String(report.fromMeter),
    toMeter: String(report.toMeter),
    metersDrilledToday: String(report.totalMetersDrilled),
    workHours: String(report.workHours),
    rigMoves: String(report.rigMoves),
    standbyHours: String(report.standbyHours),
    delayHours: String(report.delayHours),
    delayReasonCategory: parseDelayReasonCategoryForForm(report.delayReasonCategory),
    delayReasonNote: report.delayReasonNote || "",
    holeContinuityOverrideReason: report.holeContinuityOverrideReason || "",
    leadOperatorName: report.leadOperatorName || report.operatorCrew || "",
    assistantCount: String(Math.max(0, Number(report.assistantCount || 0))),
    comments: report.comments || "",
    billableQuantities
  };
}

export function buildCreateFormFromScopedProject(params: {
  scopedProjectId: string;
  reportableProjectIds: string[];
  allProjectIds: string[];
  projectAssignedRigId: string | null;
  projectBackupRigId: string | null;
}) {
  const {
    scopedProjectId,
    reportableProjectIds,
    allProjectIds,
    projectAssignedRigId,
    projectBackupRigId
  } = params;
  const initialProjectId = scopedProjectId || reportableProjectIds[0] || allProjectIds[0] || "";
  const initialRigId = projectAssignedRigId || projectBackupRigId || "";
  return createEmptyForm(initialProjectId, initialRigId);
}

export function buildFormStateForProjectChange(
  current: DrillReportFormState,
  projectId: string
): DrillReportFormState {
  return {
    ...current,
    projectId,
    rigId: "",
    selectedHoleNumber: "",
    holeNumber: "",
    holeMode: "CONTINUE",
    delayReasonCategory: "",
    delayReasonNote: "",
    holeContinuityOverrideReason: "",
    leadOperatorName: "",
    assistantCount: "0",
    billableQuantities: {}
  };
}
