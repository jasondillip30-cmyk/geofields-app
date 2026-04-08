export interface DrillReportBillableLineAmountInput {
  itemCode: string;
  unit: string;
  quantity: number;
}

export interface DrillReportBillingRateItemAmountInput {
  itemCode: string;
  unit: string;
  unitRate: number;
}

export function calculateDrillReportBillableAmount(options: {
  billableLines: DrillReportBillableLineAmountInput[] | null | undefined;
  activeRateItems: DrillReportBillingRateItemAmountInput[] | null | undefined;
  fallbackMeters: number;
  fallbackContractRate: number;
}) {
  const normalizedLines = Array.isArray(options.billableLines) ? options.billableLines : [];
  const fallbackAmount = calculateFallbackAmount({
    meters: options.fallbackMeters,
    contractRate: options.fallbackContractRate
  });

  if (normalizedLines.length === 0) {
    return fallbackAmount;
  }

  const normalizedRateItems = Array.isArray(options.activeRateItems) ? options.activeRateItems : [];
  const rateItemByCode = new Map(
    normalizedRateItems
      .map((item) => normalizeRateItem(item))
      .filter((item): item is { itemCode: string; unit: string; unitRate: number } => Boolean(item))
      .map((item) => [item.itemCode, item])
  );

  let total = 0;
  for (const line of normalizedLines) {
    const itemCode = normalizeItemCode(line.itemCode);
    if (!itemCode) {
      continue;
    }
    const rateItem = rateItemByCode.get(itemCode);
    if (!rateItem) {
      continue;
    }
    if (!unitsMatch(line.unit, rateItem.unit)) {
      continue;
    }
    const quantity = Number(line.quantity ?? 0);
    if (!Number.isFinite(quantity) || quantity < 0) {
      continue;
    }
    const lineAmount = quantity * rateItem.unitRate;
    if (!Number.isFinite(lineAmount)) {
      continue;
    }
    total += lineAmount;
  }

  if (!Number.isFinite(total) || total < 0) {
    return 0;
  }
  return total;
}

function calculateFallbackAmount(options: { meters: number; contractRate: number }) {
  const meters = Number(options.meters ?? 0);
  const contractRate = Number(options.contractRate ?? 0);
  if (!Number.isFinite(meters) || meters < 0) {
    return 0;
  }
  if (!Number.isFinite(contractRate) || contractRate < 0) {
    return 0;
  }
  const value = meters * contractRate;
  if (!Number.isFinite(value) || value < 0) {
    return 0;
  }
  return value;
}

function normalizeRateItem(value: DrillReportBillingRateItemAmountInput) {
  const itemCode = normalizeItemCode(value.itemCode);
  const unit = typeof value.unit === "string" ? value.unit.trim() : "";
  const unitRate = Number(value.unitRate ?? 0);
  if (!itemCode || !unit || !Number.isFinite(unitRate) || unitRate < 0) {
    return null;
  }
  return {
    itemCode,
    unit,
    unitRate
  };
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
