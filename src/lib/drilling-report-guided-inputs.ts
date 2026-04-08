export interface GuidedBillingRateItem {
  itemCode: string;
  label: string;
  unit: string;
  sortOrder: number;
  isActive: boolean;
  drillingStageLabel?: string | null;
  depthBandStartM?: number | null;
  depthBandEndM?: number | null;
}

export interface GuidedBillableInputField {
  itemCode: string;
  label: string;
  unit: string;
  stageLabel: string | null;
  depthBandStartM: number | null;
  depthBandEndM: number | null;
}

export interface GuidedBillableInputsModel {
  meterMode: "none" | "single" | "staged";
  singleMeterItem: GuidedBillableInputField | null;
  stagedMeterItems: GuidedBillableInputField[];
  extraItems: GuidedBillableInputField[];
  hasWorkHoursLine: boolean;
  hasRigMovesLine: boolean;
  hasStandbyLine: boolean;
}

export interface GuidedBillableLineInput {
  itemCode: string;
  unit: string;
  quantity: number;
}

export interface BuildGuidedBillableLinesOptions {
  billingItems: GuidedBillingRateItem[];
  metersDrilledToday: number;
  derivedFromMeter: number;
  derivedToMeter: number;
  workHours: number;
  rigMoves: number;
  standbyHours: number;
  manualQuantities: Record<string, string>;
}

export interface GuidedStagedAllocationPreviewLine {
  itemCode: string;
  label: string;
  unit: string;
  quantity: number;
}

export interface GuidedBillableLineBuildResult {
  lines: GuidedBillableLineInput[];
  error: string | null;
  hasStagedAutoAllocation: boolean;
  stagedAllocatedMeters: number;
  stagedUnallocatedMeters: number;
  stagedAllocationPreview: GuidedStagedAllocationPreviewLine[];
}

export function buildGuidedBillableInputsModel(items: GuidedBillingRateItem[]): GuidedBillableInputsModel {
  const activeItems = sortGuidedBillingItems(items.filter((item) => item.isActive));
  const meterItems = activeItems.filter((item) => isMeterUnit(item.unit));
  const meterMode = meterItems.length === 0 ? "none" : meterItems.length === 1 ? "single" : "staged";
  const singleMeterItem = meterMode === "single" ? toGuidedField(meterItems[0]) : null;
  const stagedMeterItems = meterMode === "staged" ? meterItems.map((item) => toGuidedField(item)) : [];

  const nonMeterItems = activeItems.filter((item) => !isMeterUnit(item.unit));
  const hasWorkHoursLine = nonMeterItems.some((item) => isWorkHoursCode(item.itemCode));
  const hasRigMovesLine = nonMeterItems.some((item) => isRigMovesCode(item.itemCode));
  const hasStandbyLine = nonMeterItems.some((item) => isStandbyCode(item.itemCode));

  const extraItems = nonMeterItems
    .filter(
      (item) =>
        !isPrimaryOperationalCode(item.itemCode) &&
        !isLegacyFallbackPricingCode(item.itemCode)
    )
    .map((item) => toGuidedField(item));

  return {
    meterMode,
    singleMeterItem,
    stagedMeterItems,
    extraItems,
    hasWorkHoursLine,
    hasRigMovesLine,
    hasStandbyLine
  };
}

export function buildGuidedBillableLineInputs(
  options: BuildGuidedBillableLinesOptions
): GuidedBillableLineBuildResult {
  const activeItems = sortGuidedBillingItems(options.billingItems.filter((item) => item.isActive));
  if (activeItems.length === 0) {
    return {
      lines: [],
      error: null,
      hasStagedAutoAllocation: false,
      stagedAllocatedMeters: 0,
      stagedUnallocatedMeters: 0,
      stagedAllocationPreview: []
    };
  }

  const guidedModel = buildGuidedBillableInputsModel(activeItems);
  const lines: GuidedBillableLineInput[] = [];
  const meterItems = activeItems.filter((item) => isMeterUnit(item.unit));
  const stagedMeterItems = meterItems.filter((item) => hasDepthBand(item));
  const hasStagedAutoAllocation = stagedMeterItems.length > 0;
  const stagedAllocationPreview: GuidedStagedAllocationPreviewLine[] = [];
  const normalizedMetersDrilled = sanitizeNonNegativeNumber(options.metersDrilledToday);
  let stagedAllocatedMeters = 0;

  if (hasStagedAutoAllocation) {
    const rangeStart = Math.min(options.derivedFromMeter, options.derivedToMeter);
    const rangeEnd = Math.max(options.derivedFromMeter, options.derivedToMeter);
    const hasUsableRange =
      Number.isFinite(rangeStart) &&
      Number.isFinite(rangeEnd) &&
      rangeEnd > rangeStart &&
      normalizedMetersDrilled > 0;

    if (hasUsableRange) {
      for (const item of stagedMeterItems) {
        const bandStart = Math.min(item.depthBandStartM as number, item.depthBandEndM as number);
        const bandEnd = Math.max(item.depthBandStartM as number, item.depthBandEndM as number);
        const overlap = Math.max(0, Math.min(rangeEnd, bandEnd) - Math.max(rangeStart, bandStart));
        const quantity = sanitizeNonNegativeNumber(overlap);
        stagedAllocationPreview.push({
          itemCode: item.itemCode,
          label: item.label,
          unit: item.unit,
          quantity
        });
        if (quantity <= 0) {
          continue;
        }
        lines.push({
          itemCode: item.itemCode,
          unit: item.unit,
          quantity
        });
        stagedAllocatedMeters += quantity;
      }
    } else {
      for (const item of stagedMeterItems) {
        stagedAllocationPreview.push({
          itemCode: item.itemCode,
          label: item.label,
          unit: item.unit,
          quantity: 0
        });
      }
    }
  } else if (guidedModel.meterMode === "single" && guidedModel.singleMeterItem) {
    const quantity = normalizedMetersDrilled;
    if (quantity > 0) {
      lines.push({
        itemCode: guidedModel.singleMeterItem.itemCode,
        unit: guidedModel.singleMeterItem.unit,
        quantity
      });
    }
  }

  const stagedUnallocatedMeters = hasStagedAutoAllocation
    ? Math.max(0, normalizedMetersDrilled - stagedAllocatedMeters)
    : 0;

  for (const item of activeItems) {
    if (isMeterUnit(item.unit)) {
      continue;
    }
    let quantity: number | null = null;
    if (isWorkHoursCode(item.itemCode)) {
      quantity = sanitizeNonNegativeNumber(options.workHours);
    } else if (isRigMovesCode(item.itemCode)) {
      quantity = sanitizeNonNegativeNumber(options.rigMoves);
    } else if (isStandbyCode(item.itemCode)) {
      quantity = sanitizeNonNegativeNumber(options.standbyHours);
    } else {
      const rawValue = options.manualQuantities[item.itemCode];
      if (typeof rawValue !== "string" || rawValue.trim().length === 0) {
        continue;
      }
      const parsed = Number(rawValue);
      if (!Number.isFinite(parsed) || parsed < 0) {
        return {
          lines: [],
          error: `Quantity for ${item.label} must be zero or greater.`,
          hasStagedAutoAllocation,
          stagedAllocatedMeters,
          stagedUnallocatedMeters,
          stagedAllocationPreview
        };
      }
      quantity = parsed;
    }

    if (!Number.isFinite(quantity) || quantity === null || quantity <= 0) {
      continue;
    }

    lines.push({
      itemCode: item.itemCode,
      unit: item.unit,
      quantity
    });
  }

  return {
    lines,
    error: null,
    hasStagedAutoAllocation,
    stagedAllocatedMeters,
    stagedUnallocatedMeters,
    stagedAllocationPreview
  };
}

export function formatGuidedBillableFieldLabel(field: GuidedBillableInputField) {
  const hasDepthBand =
    typeof field.depthBandStartM === "number" &&
    Number.isFinite(field.depthBandStartM) &&
    typeof field.depthBandEndM === "number" &&
    Number.isFinite(field.depthBandEndM);
  if (field.stageLabel && hasDepthBand) {
    return `${field.stageLabel} (${field.depthBandStartM}m-${field.depthBandEndM}m)`;
  }
  if (field.stageLabel) {
    return field.stageLabel;
  }
  if (hasDepthBand) {
    return `${field.label} (${field.depthBandStartM}m-${field.depthBandEndM}m)`;
  }
  return field.label;
}

function toGuidedField(item: GuidedBillingRateItem): GuidedBillableInputField {
  return {
    itemCode: item.itemCode,
    label: item.label,
    unit: item.unit,
    stageLabel:
      typeof item.drillingStageLabel === "string" && item.drillingStageLabel.trim().length > 0
        ? item.drillingStageLabel.trim()
        : null,
    depthBandStartM:
      typeof item.depthBandStartM === "number" && Number.isFinite(item.depthBandStartM)
        ? item.depthBandStartM
        : null,
    depthBandEndM:
      typeof item.depthBandEndM === "number" && Number.isFinite(item.depthBandEndM)
        ? item.depthBandEndM
        : null
  };
}

function sortGuidedBillingItems(items: GuidedBillingRateItem[]) {
  return [...items].sort((left, right) => {
    if (left.sortOrder !== right.sortOrder) {
      return left.sortOrder - right.sortOrder;
    }
    const leftDepth =
      typeof left.depthBandStartM === "number" && Number.isFinite(left.depthBandStartM)
        ? left.depthBandStartM
        : Number.POSITIVE_INFINITY;
    const rightDepth =
      typeof right.depthBandStartM === "number" && Number.isFinite(right.depthBandStartM)
        ? right.depthBandStartM
        : Number.POSITIVE_INFINITY;
    if (leftDepth !== rightDepth) {
      return leftDepth - rightDepth;
    }
    return left.itemCode.localeCompare(right.itemCode);
  });
}

function sanitizeNonNegativeNumber(value: number) {
  if (!Number.isFinite(value) || value < 0) {
    return 0;
  }
  return value;
}

function isMeterUnit(unit: string) {
  return unit.trim().toLowerCase() === "meter";
}

function hasDepthBand(item: GuidedBillingRateItem) {
  return (
    typeof item.depthBandStartM === "number" &&
    Number.isFinite(item.depthBandStartM) &&
    typeof item.depthBandEndM === "number" &&
    Number.isFinite(item.depthBandEndM)
  );
}

function normalizeGuidedItemCode(itemCode: string) {
  return itemCode.trim().toUpperCase();
}

function isWorkHoursCode(itemCode: string) {
  const normalized = normalizeGuidedItemCode(itemCode);
  return normalized === "WORK_TIME" || normalized === "WORK_HOURS";
}

function isRigMovesCode(itemCode: string) {
  const normalized = normalizeGuidedItemCode(itemCode);
  return normalized === "RIG_MOVE" || normalized === "RIG_MOVES";
}

function isStandbyCode(itemCode: string) {
  const normalized = normalizeGuidedItemCode(itemCode);
  return normalized === "STANDBY" || normalized === "STANDBY_HOURS";
}

function isPrimaryOperationalCode(itemCode: string) {
  return isWorkHoursCode(itemCode) || isRigMovesCode(itemCode) || isStandbyCode(itemCode);
}

function isLegacyFallbackPricingCode(itemCode: string) {
  const normalized = normalizeGuidedItemCode(itemCode);
  return (
    normalized === "METER_RATE" ||
    normalized === "DAY_RATE" ||
    normalized === "LUMP_SUM" ||
    normalized === "CONTRACT_RATE" ||
    normalized === "CONTRACT_VALUE"
  );
}
