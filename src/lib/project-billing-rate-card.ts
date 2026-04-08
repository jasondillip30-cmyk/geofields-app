import type { Prisma } from "@prisma/client";

export interface ProjectBillingRateItemInput {
  itemCode: string;
  label: string;
  unit: string;
  unitRate: number;
  drillingStageLabel?: string | null;
  depthBandStartM?: number | null;
  depthBandEndM?: number | null;
  sortOrder: number;
  isActive: boolean;
}

export function parseProjectBillingRateItemsInput(value: unknown): {
  items: ProjectBillingRateItemInput[];
  error: string | null;
} {
  if (value === undefined || value === null) {
    return { items: [], error: null };
  }
  if (!Array.isArray(value)) {
    return { items: [], error: "Billing lines must be provided as a list." };
  }

  const parsed: ProjectBillingRateItemInput[] = [];
  const seenCodes = new Set<string>();

  for (const entry of value) {
    if (!entry || typeof entry !== "object") {
      return { items: [], error: "Billing rate card lines must be valid objects." };
    }

    const payload = entry as Record<string, unknown>;
    const itemCode = normalizeItemCode(payload.itemCode);
    const label = typeof payload.label === "string" ? payload.label.trim() : "";
    const unit = typeof payload.unit === "string" ? payload.unit.trim() : "";
    const unitRate = Number(payload.unitRate ?? 0);
    const drillingStageLabelRaw =
      typeof payload.drillingStageLabel === "string" ? payload.drillingStageLabel.trim() : "";
    const depthBandStartRaw =
      payload.depthBandStartM === null || payload.depthBandStartM === undefined
        ? null
        : Number(payload.depthBandStartM);
    const depthBandEndRaw =
      payload.depthBandEndM === null || payload.depthBandEndM === undefined
        ? null
        : Number(payload.depthBandEndM);
    const sortOrderRaw = Number(payload.sortOrder ?? 0);
    const isActive = payload.isActive !== false;

    if (!itemCode) {
      return { items: [], error: "Each billing line must include an item code." };
    }
    if (!label) {
      return { items: [], error: "Each billing line must include a billable item label." };
    }
    if (!unit) {
      return { items: [], error: "Each billing line must include a unit." };
    }
    if (!Number.isFinite(unitRate) || unitRate <= 0) {
      return { items: [], error: "Each billing line must include a rate greater than zero." };
    }
    if (!Number.isFinite(sortOrderRaw) || sortOrderRaw < 0) {
      return { items: [], error: "Sort order must be zero or greater." };
    }
    const isMeterBased = unit.trim().toLowerCase() === "meter";
    const hasDepthStart = depthBandStartRaw !== null;
    const hasDepthEnd = depthBandEndRaw !== null;
    if (hasDepthStart !== hasDepthEnd) {
      return { items: [], error: "Enter both from depth and to depth, or leave both empty." };
    }
    if (hasDepthStart && hasDepthEnd) {
      const depthStart = depthBandStartRaw as number;
      const depthEnd = depthBandEndRaw as number;
      if (
        !Number.isFinite(depthStart) ||
        !Number.isFinite(depthEnd) ||
        depthStart < 0 ||
        depthEnd < 0
      ) {
        return { items: [], error: "Depth values must be zero or greater." };
      }
      if (depthEnd <= depthStart) {
        return { items: [], error: "To depth must be greater than from depth." };
      }
    }
    if (seenCodes.has(itemCode)) {
      return { items: [], error: `Duplicate billing item code: ${itemCode}.` };
    }

    seenCodes.add(itemCode);
    parsed.push({
      itemCode,
      label,
      unit,
      unitRate,
      drillingStageLabel: isMeterBased ? drillingStageLabelRaw || null : null,
      depthBandStartM: isMeterBased && hasDepthStart ? depthBandStartRaw : null,
      depthBandEndM: isMeterBased && hasDepthEnd ? depthBandEndRaw : null,
      sortOrder: Math.round(sortOrderRaw),
      isActive
    });
  }

  const continuityError = validateStagedMeterContinuity(parsed);
  if (continuityError) {
    return { items: [], error: continuityError };
  }

  return {
    items: parsed.sort((left, right) => left.sortOrder - right.sortOrder),
    error: null
  };
}

export async function replaceProjectBillingRateItems(
  tx: Prisma.TransactionClient,
  projectId: string,
  items: ProjectBillingRateItemInput[]
) {
  await tx.projectBillingRateItem.deleteMany({
    where: { projectId }
  });

  if (items.length === 0) {
    return;
  }

  await tx.projectBillingRateItem.createMany({
    data: items.map((entry) => ({
      projectId,
      itemCode: entry.itemCode,
      label: entry.label,
      unit: entry.unit,
      unitRate: entry.unitRate,
      drillingStageLabel: entry.drillingStageLabel || null,
      depthBandStartM: entry.depthBandStartM ?? null,
      depthBandEndM: entry.depthBandEndM ?? null,
      sortOrder: entry.sortOrder,
      isActive: entry.isActive
    }))
  });
}

function normalizeItemCode(value: unknown) {
  if (typeof value !== "string") {
    return "";
  }
  const upper = value.trim().toUpperCase();
  const sanitized = upper.replace(/[^A-Z0-9_]/g, "_").replace(/_+/g, "_");
  return sanitized.replace(/^_+|_+$/g, "");
}

function validateStagedMeterContinuity(items: ProjectBillingRateItemInput[]) {
  const stagedMeterLines = items
    .filter((item) => item.isActive)
    .filter((item) => item.unit.trim().toLowerCase() === "meter")
    .filter(
      (item) =>
        Number.isFinite(item.depthBandStartM) &&
        Number.isFinite(item.depthBandEndM)
    )
    .map((item) => ({
      itemCode: item.itemCode,
      start: Number(item.depthBandStartM),
      end: Number(item.depthBandEndM)
    }))
    .sort((left, right) => left.start - right.start);

  if (stagedMeterLines.length === 0) {
    return null;
  }

  const firstStart = stagedMeterLines[0].start;
  if (!isDepthEqual(firstStart, 0)) {
    return "Staged depth lines must continue from the previous end depth.";
  }

  for (let index = 1; index < stagedMeterLines.length; index += 1) {
    const previous = stagedMeterLines[index - 1];
    const current = stagedMeterLines[index];

    if (current.start < previous.end && !isDepthEqual(current.start, previous.end)) {
      return "Staged depth lines cannot overlap.";
    }

    if (current.start > previous.end && !isDepthEqual(current.start, previous.end)) {
      return "This stage breaks the sequence. Adjust this stage or the next stage depth.";
    }
  }

  return null;
}

function isDepthEqual(left: number, right: number) {
  return Math.abs(left - right) < 0.000001;
}
