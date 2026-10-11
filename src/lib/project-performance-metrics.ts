export function calculateCostPerMeter(expenses: number, approvedMeters: number) {
  const normalizedExpenses = safeNumber(expenses);
  const normalizedMeters = safeNumber(approvedMeters);
  if (normalizedMeters <= 0) {
    return null;
  }
  return roundCurrency(normalizedExpenses / normalizedMeters);
}

function safeNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function roundCurrency(value: number) {
  return Math.round(value * 100) / 100;
}
