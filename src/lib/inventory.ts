import type { InventoryCategory, InventoryMovementType } from "@prisma/client";

export const inventoryCategoryOptions: Array<{ value: InventoryCategory; label: string }> = [
  { value: "DRILLING", label: "Drilling" },
  { value: "HYDRAULIC", label: "Hydraulic" },
  { value: "ELECTRICAL", label: "Electrical" },
  { value: "CONSUMABLES", label: "Consumables" },
  { value: "TIRES", label: "Tires" },
  { value: "OILS", label: "Oils" },
  { value: "FILTERS", label: "Filters" },
  { value: "SPARE_PARTS", label: "Spare Parts" },
  { value: "OTHER", label: "Other" }
];

export const inventoryMovementTypeOptions: Array<{ value: InventoryMovementType; label: string }> = [
  { value: "IN", label: "IN (Purchase / Restock)" },
  { value: "OUT", label: "OUT (Usage / Consumption)" },
  { value: "ADJUSTMENT", label: "Adjustment" },
  { value: "TRANSFER", label: "Transfer" }
];

export function formatInventoryCategory(value: string | null | undefined) {
  if (!value) {
    return "Unknown";
  }
  const found = inventoryCategoryOptions.find((entry) => entry.value === value);
  if (found) {
    return found.label;
  }
  return value.replace(/_/g, " ").toLowerCase().replace(/(^|\s)\w/g, (letter) => letter.toUpperCase());
}

export function formatMovementType(value: string | null | undefined) {
  if (!value) {
    return "Unknown";
  }
  const found = inventoryMovementTypeOptions.find((entry) => entry.value === value);
  if (found) {
    return found.label;
  }
  return value.toUpperCase();
}

