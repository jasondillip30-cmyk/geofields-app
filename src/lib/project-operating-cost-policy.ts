export const PROJECT_OPERATING_COST_SOURCE = "PROJECT_OPERATING_COST";

export function parseOperatingCostDate(value: unknown) {
  if (typeof value !== "string" || !/^(?:19|[2-9]\d)\d{2}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(value + "T00:00:00.000Z");
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? date : null;
}

export function parseOperatingCostCents(value: unknown) {
  if (typeof value !== "string" || !/^\d{1,7}(?:\.\d{1,2})?$/.test(value.trim())) return null;
  const [whole, fraction = ""] = value.trim().split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return cents > 0 ? cents : null;
}

export function nextOperatingCostDate(date: Date, cadence: "ONCE" | "DAILY" | "WEEKLY" | "MONTHLY", anchorDay: number) {
  if (cadence === "ONCE") return null;
  if (cadence === "MONTHLY") {
    const year = date.getUTCFullYear();
    const month = date.getUTCMonth() + 1;
    const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    return new Date(Date.UTC(year, month, Math.min(anchorDay, lastDay)));
  }
  return new Date(date.getTime() + (cadence === "DAILY" ? 1 : 7) * 86_400_000);
}
