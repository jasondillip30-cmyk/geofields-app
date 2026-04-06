import type { CostSpendCategoryKey } from "@/lib/cost-tracking";
import { roundCurrency } from "@/lib/cost-tracking";
import type { OperationalPurposeBucket } from "@/lib/approved-spend-classification";

interface ProjectOperatingAttributionRow {
  expenseId: string;
  amount: number;
  purposeBucket: OperationalPurposeBucket;
  accountingCategoryKey: CostSpendCategoryKey;
  category: string | null;
  subcategory: string | null;
  notes: string | null;
}

export interface ProjectOperatingCostAttributionSummary {
  operatingCostBase: number;
  fuelAttributedCost: number;
  consumablesAttributedCost: number;
  operatingAttributedTotal: number;
  unattributedOperatingCost: number;
  operatingAttributionCoveragePercent: number;
  isPartialAttribution: boolean;
  counts: {
    operatingRows: number;
    fuelRows: number;
    consumablesRows: number;
    unattributedRows: number;
  };
  reconciliationDelta: number;
}

type AttributionBucket = "FUEL" | "CONSUMABLES" | "UNATTRIBUTED";

const CONSUMABLE_STRONG_REGEX =
  /\b(consumable|consumables|ppe|glove|gloves|sealant|cleaner|grease)\b/i;

export function buildProjectOperatingCostAttributionSummary(options: {
  rows: ProjectOperatingAttributionRow[];
}): ProjectOperatingCostAttributionSummary {
  let operatingCostBase = 0;
  let fuelAttributedCost = 0;
  let consumablesAttributedCost = 0;
  let unattributedOperatingCost = 0;

  let operatingRows = 0;
  let fuelRows = 0;
  let consumablesRows = 0;
  let unattributedRows = 0;

  for (const row of options.rows) {
    const amount = roundCurrency(Math.max(0, row.amount || 0));
    if (amount <= 0 || row.purposeBucket !== "OPERATING_COST") {
      continue;
    }

    operatingRows += 1;
    operatingCostBase = roundCurrency(operatingCostBase + amount);

    const attribution = deriveAttributionBucket(row);
    if (attribution === "FUEL") {
      fuelRows += 1;
      fuelAttributedCost = roundCurrency(fuelAttributedCost + amount);
      continue;
    }
    if (attribution === "CONSUMABLES") {
      consumablesRows += 1;
      consumablesAttributedCost = roundCurrency(consumablesAttributedCost + amount);
      continue;
    }

    unattributedRows += 1;
    unattributedOperatingCost = roundCurrency(unattributedOperatingCost + amount);
  }

  const operatingAttributedTotal = roundCurrency(fuelAttributedCost + consumablesAttributedCost);
  const reconciliationDelta = roundCurrency(
    operatingCostBase - (fuelAttributedCost + consumablesAttributedCost + unattributedOperatingCost)
  );
  const operatingAttributionCoveragePercent =
    operatingCostBase > 0 ? roundCurrency((operatingAttributedTotal / operatingCostBase) * 100) : 100;

  return {
    operatingCostBase,
    fuelAttributedCost,
    consumablesAttributedCost,
    operatingAttributedTotal,
    unattributedOperatingCost,
    operatingAttributionCoveragePercent,
    isPartialAttribution: unattributedOperatingCost > 0,
    counts: {
      operatingRows,
      fuelRows,
      consumablesRows,
      unattributedRows
    },
    reconciliationDelta
  };
}

function deriveAttributionBucket(row: ProjectOperatingAttributionRow): AttributionBucket {
  const category = normalizeText(row.category);
  const subcategory = normalizeText(row.subcategory);
  const notes = normalizeText(row.notes);

  const hasStrongFuelEvidence = row.accountingCategoryKey === "fuel";
  const hasStrongConsumablesEvidence =
    hasStrongConsumablesKeyword(category) ||
    hasStrongConsumablesKeyword(subcategory) ||
    /\bconsumable(s)?\b/.test(notes);

  // Conservative conflict handling: if both strong signals exist, do not force attribution.
  if (hasStrongFuelEvidence && hasStrongConsumablesEvidence) {
    return "UNATTRIBUTED";
  }
  if (hasStrongFuelEvidence) {
    return "FUEL";
  }
  if (hasStrongConsumablesEvidence) {
    return "CONSUMABLES";
  }
  return "UNATTRIBUTED";
}

function normalizeText(value: string | null | undefined) {
  return (value || "").trim().toLowerCase();
}

function hasStrongConsumablesKeyword(value: string) {
  return CONSUMABLE_STRONG_REGEX.test(value);
}
