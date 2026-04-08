interface BillableLineInput {
  itemCode: string;
  quantity: number;
  unit: string;
}

interface DrillReportInput {
  billableLines?: BillableLineInput[] | null;
}

interface BillingRateItemInput {
  itemCode: string;
  label: string;
  unit: string;
  unitRate: number;
}

export interface ProjectRevenueLineItem {
  itemCode: string;
  label: string;
  unit: string;
  quantity: number;
  unitRate: number;
  revenue: number;
}

export interface ProjectRevenueCalculationResult {
  lineItems: ProjectRevenueLineItem[];
  totalRevenue: number;
}

export function calculateProjectRevenueFromBillableLines(options: {
  approvedReports: DrillReportInput[];
  activeRateItems: BillingRateItemInput[];
}): ProjectRevenueCalculationResult {
  try {
    const rateItemByCode = new Map(
      options.activeRateItems
        .map((item) => normalizeRateItem(item))
        .filter((item): item is BillingRateItemInput => Boolean(item))
        .map((item) => [normalizeItemCode(item.itemCode), item])
    );

    const quantityByCode = new Map<string, number>();

    for (const report of options.approvedReports) {
      const lines = Array.isArray(report.billableLines) ? report.billableLines : [];
      for (const line of lines) {
        const itemCode = normalizeItemCode(line.itemCode);
        const rateItem = rateItemByCode.get(itemCode);
        if (!itemCode || !rateItem) {
          continue;
        }

        const quantity = Number(line.quantity ?? 0);
        if (!Number.isFinite(quantity) || quantity < 0) {
          continue;
        }

        if (!unitsMatch(line.unit, rateItem.unit)) {
          continue;
        }

        quantityByCode.set(itemCode, (quantityByCode.get(itemCode) || 0) + quantity);
      }
    }

    const lineItems: ProjectRevenueLineItem[] = [];
    for (const [itemCode, quantity] of quantityByCode.entries()) {
      const rateItem = rateItemByCode.get(itemCode);
      if (!rateItem) {
        continue;
      }
      if (!Number.isFinite(quantity) || quantity < 0) {
        continue;
      }

      const unitRate = Number(rateItem.unitRate ?? 0);
      if (!Number.isFinite(unitRate) || unitRate < 0) {
        continue;
      }

      const revenue = quantity * unitRate;
      if (!Number.isFinite(revenue)) {
        continue;
      }

      lineItems.push({
        itemCode: rateItem.itemCode,
        label: rateItem.label,
        unit: rateItem.unit,
        quantity,
        unitRate,
        revenue
      });
    }

    lineItems.sort((left, right) => right.revenue - left.revenue);
    const totalRevenue = lineItems.reduce((sum, item) => sum + item.revenue, 0);

    return {
      lineItems,
      totalRevenue: Number.isFinite(totalRevenue) ? totalRevenue : 0
    };
  } catch {
    return {
      lineItems: [],
      totalRevenue: 0
    };
  }
}

function normalizeRateItem(value: BillingRateItemInput): BillingRateItemInput | null {
  const itemCode = normalizeItemCode(value.itemCode);
  const label = typeof value.label === "string" ? value.label.trim() : "";
  const unit = typeof value.unit === "string" ? value.unit.trim() : "";
  const unitRate = Number(value.unitRate ?? 0);

  if (!itemCode || !label || !unit || !Number.isFinite(unitRate) || unitRate < 0) {
    return null;
  }

  return {
    itemCode: value.itemCode,
    label,
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
