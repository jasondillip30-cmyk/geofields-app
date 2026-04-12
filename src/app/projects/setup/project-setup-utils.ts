import type {
  BillableItemTemplate,
  ProjectBillingRateItemFormLine,
  ProjectBillingRateItemRecord,
  ProjectContractTypeOption,
  ProjectFormState,
  ProjectSetupProfile,
  ProjectSetupStep,
  ProjectStatusOption
} from "./project-setup-types";
import { BILLABLE_ITEM_TEMPLATES } from "./project-setup-types";

export function validateProjectSetupStep({
  form,
  step
}: {
  form: ProjectFormState;
  step: ProjectSetupStep;
}) {
  const issues: string[] = [];
  const locationValue = form.locationMode === "NEW" ? form.locationNew.trim() : form.locationExisting.trim();

  if (step >= 1) {
    if (!form.name.trim()) {
      issues.push("Project name is required.");
    }
    if (!form.clientId.trim()) {
      issues.push("Select an existing client.");
    }
    if (!locationValue) {
      issues.push(form.locationMode === "NEW" ? "Enter a new location." : "Select an existing location.");
    }
  }

  if (step >= 2) {
    if (!form.startDate) {
      issues.push("Start date is required.");
    }
    if (form.endDate && form.startDate && form.endDate < form.startDate) {
      issues.push("End date cannot be earlier than start date.");
    }
  }

  if (step >= 3) {
    if (form.budgetAmount && (!Number.isFinite(Number(form.budgetAmount)) || Number(form.budgetAmount) <= 0)) {
      issues.push("Budget must be a positive number.");
    }
    if (
      form.estimatedMeters &&
      (!Number.isFinite(Number(form.estimatedMeters)) || Number(form.estimatedMeters) <= 0)
    ) {
      issues.push("Expected meters must be a positive number.");
    }
    if (
      form.estimatedDays &&
      (!Number.isFinite(Number(form.estimatedDays)) || Number(form.estimatedDays) <= 0)
    ) {
      issues.push("Expected days must be a positive number.");
    }
  }

  if (step >= 4) {
    if (form.primaryRigId && form.primaryRigId === form.secondaryRigId) {
      issues.push("Primary and secondary rig cannot be the same.");
    }
  }

  return issues;
}

export function parseOptionalPositive(value: string) {
  const parsed = Number(value || "");
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}

export function parseOptionalNonNegative(value: string) {
  const parsed = Number(value || "");
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }
  return parsed;
}

export function normalizeContractType(value: string | undefined): ProjectContractTypeOption {
  if (value === "DAY_RATE" || value === "LUMP_SUM" || value === "PER_METER") {
    return value;
  }
  return "PER_METER";
}

export function deriveStatusFromDates(startDate: string, endDate: string): ProjectStatusOption {
  if (!startDate) {
    return "PLANNED";
  }
  const today = new Date();
  const start = new Date(startDate);
  if (Number.isNaN(start.getTime())) {
    return "PLANNED";
  }
  if (endDate) {
    const end = new Date(endDate);
    if (!Number.isNaN(end.getTime()) && end < today) {
      return "COMPLETED";
    }
  }
  if (start > today) {
    return "PLANNED";
  }
  return "ACTIVE";
}

export function normalizeSetupProfile(value: Partial<ProjectSetupProfile> | null | undefined): ProjectSetupProfile {
  return {
    expectedMeters:
      typeof value?.expectedMeters === "number" && Number.isFinite(value.expectedMeters)
        ? value.expectedMeters
        : null,
    contractReferenceUrl: typeof value?.contractReferenceUrl === "string" ? value.contractReferenceUrl : "",
    contractReferenceName:
      typeof value?.contractReferenceName === "string" ? value.contractReferenceName : "",
    teamMemberIds: Array.isArray(value?.teamMemberIds)
      ? value.teamMemberIds.filter((entry): entry is string => typeof entry === "string")
      : [],
    teamMemberNames: Array.isArray(value?.teamMemberNames)
      ? value.teamMemberNames.filter((entry): entry is string => typeof entry === "string")
      : []
  };
}

export function defaultBillingRateItems(
  contractType: ProjectContractTypeOption,
  contractRatePerM: number
): ProjectBillingRateItemFormLine[] {
  const meterTemplate = BILLABLE_ITEM_TEMPLATES.find((entry) => entry.itemCode === "METER_DRILLED");
  if (!meterTemplate) {
    return [];
  }
  const meterRate = contractType === "PER_METER" && contractRatePerM > 0 ? contractRatePerM : 0;
  if (meterRate <= 0) {
    return [];
  }
  return [
    {
      itemCode: meterTemplate.itemCode,
      label: meterTemplate.label,
      unit: meterTemplate.unit,
      unitRate: meterRate,
      drillingStageLabel: null,
      depthBandStartM: null,
      depthBandEndM: null,
      sortOrder: meterTemplate.sortOrder,
      isActive: true
    }
  ];
}

export function normalizeBillingRateItems(
  value: ProjectBillingRateItemRecord[],
  contractType: ProjectContractTypeOption,
  contractRatePerM: number
) {
  if (!Array.isArray(value) || value.length === 0) {
    return defaultBillingRateItems(contractType, contractRatePerM);
  }

  const cleaned = value
    .filter((entry) => Boolean(entry.itemCode && entry.label && entry.unit))
    .map((entry) => ({
      itemCode: entry.itemCode,
      label: entry.label,
      unit: entry.unit,
      unitRate: Number(entry.unitRate || 0),
      drillingStageLabel:
        typeof entry.drillingStageLabel === "string" && entry.drillingStageLabel.trim().length > 0
          ? entry.drillingStageLabel.trim()
          : null,
      depthBandStartM:
        typeof entry.depthBandStartM === "number" && Number.isFinite(entry.depthBandStartM)
          ? entry.depthBandStartM
          : null,
      depthBandEndM:
        typeof entry.depthBandEndM === "number" && Number.isFinite(entry.depthBandEndM)
          ? entry.depthBandEndM
          : null,
      sortOrder: Number.isFinite(entry.sortOrder) ? entry.sortOrder : 0,
      isActive: entry.isActive !== false
    }))
    .filter((entry) => Number.isFinite(entry.unitRate) && entry.unitRate > 0)
    .sort(compareBillingRateItems);

  if (cleaned.length > 0) {
    return cleaned;
  }

  return defaultBillingRateItems(contractType, contractRatePerM);
}

export function sortBillingRateItems(value: ProjectBillingRateItemFormLine[]) {
  return [...value].sort(compareBillingRateItems);
}

export function compareBillingRateItems(left: ProjectBillingRateItemFormLine, right: ProjectBillingRateItemFormLine) {
  if (left.sortOrder !== right.sortOrder) {
    return left.sortOrder - right.sortOrder;
  }
  const leftDepth = typeof left.depthBandStartM === "number" ? left.depthBandStartM : Number.POSITIVE_INFINITY;
  const rightDepth = typeof right.depthBandStartM === "number" ? right.depthBandStartM : Number.POSITIVE_INFINITY;
  if (leftDepth !== rightDepth) {
    return leftDepth - rightDepth;
  }
  return left.itemCode.localeCompare(right.itemCode);
}

export function findTemplateByItemCode(itemCode: string) {
  const direct = BILLABLE_ITEM_TEMPLATES.find((entry) => entry.itemCode === itemCode);
  if (direct) {
    return direct;
  }
  return BILLABLE_ITEM_TEMPLATES.find(
    (entry) => Boolean(entry.allowMultiple) && itemCode.startsWith(`${entry.itemCode}_`)
  );
}

export function deriveGuidedMeterStartDepth(options: {
  stagedLines: ProjectBillingRateItemFormLine[];
  editingCode: string | null;
  editingLine: ProjectBillingRateItemFormLine | null;
}) {
  if (options.editingCode) {
    const editingIndex = options.stagedLines.findIndex((line) => line.itemCode === options.editingCode);
    if (editingIndex > 0) {
      return options.stagedLines[editingIndex - 1].depthBandEndM ?? 0;
    }
    if (editingIndex === 0) {
      return 0;
    }
    if (
      options.editingLine &&
      Number.isFinite(options.editingLine.depthBandStartM)
    ) {
      return options.editingLine.depthBandStartM ?? 0;
    }
    return 0;
  }

  if (options.stagedLines.length === 0) {
    return 0;
  }

  return options.stagedLines[options.stagedLines.length - 1].depthBandEndM ?? 0;
}

export function buildBillingItemCode(options: {
  template: BillableItemTemplate;
  stageLabel: string;
  depthBandStartM: number | null;
  depthBandEndM: number | null;
}) {
  const baseCode = options.template.itemCode;
  if (!options.template.isMeterBased) {
    return baseCode;
  }
  const stageCode = normalizeCodeSegment(options.stageLabel);
  const hasDepth = Number.isFinite(options.depthBandStartM) && Number.isFinite(options.depthBandEndM);
  if (!stageCode && !hasDepth) {
    return baseCode;
  }
  const segments = [baseCode];
  if (stageCode) {
    segments.push(stageCode);
  }
  if (hasDepth) {
    segments.push(`${formatDepthCode(options.depthBandStartM as number)}M`);
    segments.push(`${formatDepthCode(options.depthBandEndM as number)}M`);
  }
  return segments.join("_");
}

export function normalizeCodeSegment(value: string) {
  const upper = value.trim().toUpperCase();
  if (!upper) {
    return "";
  }
  return upper
    .replace(/[^A-Z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function formatDepthCode(value: number) {
  const normalized = value.toString();
  return normalized.replace(".", "P");
}
