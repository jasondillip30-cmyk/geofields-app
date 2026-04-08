import type { Prisma, PrismaClient } from "@prisma/client";

export interface DrillReportBillableLineInput {
  itemCode: string;
  unit: string;
  quantity: number;
}

type BillingRateLookupClient =
  | Prisma.TransactionClient
  | Pick<PrismaClient, "projectBillingRateItem">;

export function parseDrillReportBillableLinesInput(value: unknown): {
  lines: DrillReportBillableLineInput[];
  error: string | null;
} {
  if (value === undefined || value === null) {
    return { lines: [], error: null };
  }
  if (!Array.isArray(value)) {
    return { lines: [], error: "Billable items must be provided as a list." };
  }

  const parsed: DrillReportBillableLineInput[] = [];
  const seenCodes = new Set<string>();

  for (const entry of value) {
    if (!entry || typeof entry !== "object") {
      return { lines: [], error: "Each billable item line must be a valid entry." };
    }

    const payload = entry as Record<string, unknown>;
    const itemCode = normalizeItemCode(payload.itemCode);
    const unit = typeof payload.unit === "string" ? payload.unit.trim() : "";
    const quantity = Number(payload.quantity ?? 0);

    if (!itemCode) {
      return { lines: [], error: "Each billable item line must include an item code." };
    }
    if (!unit) {
      return { lines: [], error: "Each billable item line must include a unit." };
    }
    if (!Number.isFinite(quantity) || quantity < 0) {
      return { lines: [], error: "Quantity must be zero or greater for each billable item." };
    }
    if (seenCodes.has(itemCode)) {
      return { lines: [], error: `Duplicate billable item code: ${itemCode}.` };
    }

    seenCodes.add(itemCode);
    parsed.push({
      itemCode,
      unit,
      quantity
    });
  }

  return { lines: parsed, error: null };
}

export async function validateDrillReportBillableLinesForProject(
  db: BillingRateLookupClient,
  projectId: string,
  lines: DrillReportBillableLineInput[],
  context: {
    holeNumber: string;
    fromMeter: number;
    toMeter: number;
  }
): Promise<{ lines: DrillReportBillableLineInput[]; error: string | null }> {
  const rateCardItems = await db.projectBillingRateItem.findMany({
    where: {
      projectId,
      isActive: true
    },
    select: {
      itemCode: true,
      unit: true,
      depthBandStartM: true,
      depthBandEndM: true
    }
  });
  const overlapError = findOverlappingStagedBandError(rateCardItems);
  if (overlapError) {
    return {
      lines: [],
      error: overlapError
    };
  }
  if (lines.length === 0) {
    return { lines: [], error: null };
  }

  const itemByCode = new Map(
    rateCardItems.map((item) => [
      normalizeItemCode(item.itemCode),
      {
        itemCode: item.itemCode,
        unit: item.unit.trim(),
        depthBandStartM: item.depthBandStartM,
        depthBandEndM: item.depthBandEndM
      }
    ])
  );

  const fromMeter = Number(context.fromMeter);
  const toMeter = Number(context.toMeter);
  const hasUsableRange = Number.isFinite(fromMeter) && Number.isFinite(toMeter) && fromMeter !== toMeter;
  const rangeStart = hasUsableRange ? Math.min(fromMeter, toMeter) : 0;
  const rangeEnd = hasUsableRange ? Math.max(fromMeter, toMeter) : 0;

  const normalized: DrillReportBillableLineInput[] = [];
  for (const line of lines) {
    const rateCardItem = itemByCode.get(line.itemCode);
    if (!rateCardItem) {
      return {
        lines: [],
        error: `Billable item ${line.itemCode} is not active for this project's billing setup.`
      };
    }

    if (!unitsMatch(line.unit, rateCardItem.unit)) {
      return {
        lines: [],
        error: `Unit mismatch for ${line.itemCode}. Use ${rateCardItem.unit}.`
      };
    }

    const isStagedMeterItem =
      rateCardItem.unit.toLowerCase() === "meter" &&
      Number.isFinite(rateCardItem.depthBandStartM) &&
      Number.isFinite(rateCardItem.depthBandEndM);

    if (isStagedMeterItem && line.quantity > 0) {
      if (!hasUsableRange) {
        return {
          lines: [],
          error: "Enter a valid from/to depth range to use staged meter billing lines."
        };
      }

      const bandStart = Math.min(rateCardItem.depthBandStartM as number, rateCardItem.depthBandEndM as number);
      const bandEnd = Math.max(rateCardItem.depthBandStartM as number, rateCardItem.depthBandEndM as number);
      const allowedMeters = Math.max(0, Math.min(rangeEnd, bandEnd) - Math.max(rangeStart, bandStart));

      if (allowedMeters <= 0) {
        return {
          lines: [],
          error: "This billable line is outside this report's depth range."
        };
      }

      if (line.quantity > allowedMeters) {
        return {
          lines: [],
          error: "Billable quantity is higher than the allowed meters for this depth band."
        };
      }
    }

    normalized.push({
      itemCode: rateCardItem.itemCode,
      unit: rateCardItem.unit,
      quantity: line.quantity
    });
  }

  return { lines: normalized, error: null };
}

export async function replaceDrillReportBillableLines(
  tx: Prisma.TransactionClient,
  drillReportId: string,
  lines: DrillReportBillableLineInput[]
) {
  await tx.drillReportBillableLine.deleteMany({
    where: { drillReportId }
  });

  if (lines.length === 0) {
    return;
  }

  await tx.drillReportBillableLine.createMany({
    data: lines.map((line) => ({
      drillReportId,
      itemCode: line.itemCode,
      unit: line.unit,
      quantity: line.quantity
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

function unitsMatch(sourceUnit: string, targetUnit: string) {
  return sourceUnit.trim().toLowerCase() === targetUnit.trim().toLowerCase();
}

function findOverlappingStagedBandError(items: Array<{
  itemCode: string;
  unit: string;
  depthBandStartM: number | null;
  depthBandEndM: number | null;
}>) {
  const stagedMeterBands = items
    .filter((item) => item.unit.trim().toLowerCase() === "meter")
    .filter(
      (item) =>
        Number.isFinite(item.depthBandStartM) &&
        Number.isFinite(item.depthBandEndM)
    )
    .map((item) => {
      const start = Math.min(item.depthBandStartM as number, item.depthBandEndM as number);
      const end = Math.max(item.depthBandStartM as number, item.depthBandEndM as number);
      return {
        itemCode: item.itemCode,
        start,
        end
      };
    })
    .sort((left, right) => left.start - right.start);

  for (let index = 1; index < stagedMeterBands.length; index += 1) {
    const previous = stagedMeterBands[index - 1];
    const current = stagedMeterBands[index];
    if (current.start < previous.end) {
      return "Staged depth bands overlap in this project's billing setup. Fix the stage depth ranges first.";
    }
  }

  return null;
}
