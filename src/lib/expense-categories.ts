export const DEFAULT_EXPENSE_CATEGORIES = [
  "Fuel",
  "Maintenance",
  "Labor",
  "Camp Food",
  "Transport",
  "Spare Parts",
  "Rentals",
  "Accommodation",
  "Office Costs",
  "Other"
] as const;

export type ExpenseCategory = (typeof DEFAULT_EXPENSE_CATEGORIES)[number];

export function isSupportedExpenseCategory(value: string) {
  return DEFAULT_EXPENSE_CATEGORIES.includes(value as ExpenseCategory);
}
