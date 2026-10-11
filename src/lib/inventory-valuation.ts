export interface InventoryValuationItem {
  quantityInStock: number;
  unitCost: number;
  locationId?: string | null;
}

export interface InventoryValuationSummary {
  totalValue: number;
  locatedValue: number;
  unassignedLocationValue: number;
  unassignedLocationItemCount: number;
}

export function summarizeInventoryValuation(
  items: InventoryValuationItem[]
): InventoryValuationSummary {
  let totalValue = 0;
  let locatedValue = 0;
  let unassignedLocationValue = 0;
  let unassignedLocationItemCount = 0;

  for (const item of items) {
    const value = safeNumber(item.quantityInStock) * safeNumber(item.unitCost);
    totalValue += value;
    if (item.locationId) {
      locatedValue += value;
    } else {
      unassignedLocationValue += value;
      unassignedLocationItemCount += 1;
    }
  }

  return {
    totalValue: roundCurrency(totalValue),
    locatedValue: roundCurrency(locatedValue),
    unassignedLocationValue: roundCurrency(unassignedLocationValue),
    unassignedLocationItemCount
  };
}

function safeNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function roundCurrency(value: number) {
  return Math.round(value * 100) / 100;
}
