import type { SpendingApiErrorPayload } from "./spending-page-types";

export async function readApiError(response: Response, fallback: string) {
  try {
    const payload = (await response.json()) as SpendingApiErrorPayload;
    if (payload?.message) {
      return payload.message;
    }
  } catch {
    return fallback;
  }
  return fallback;
}

export function toDateIso(value: Date) {
  return value.toISOString().slice(0, 10);
}

export function scaledBarHeight(value: number, maxValue: number) {
  if (value <= 0 || maxValue <= 0) {
    return 0;
  }
  return Math.max(8, Math.round((value / maxValue) * 72));
}

export function formatTransactionGroupDate(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
    year: "numeric"
  });
}

export function formatMeterRange(startM: number, endM: number) {
  const safeStart = Number.isFinite(startM) ? startM : 0;
  const safeEnd = Number.isFinite(endM) ? endM : 0;
  return `${safeStart.toLocaleString(undefined, { maximumFractionDigits: 2 })}m - ${safeEnd.toLocaleString(
    undefined,
    { maximumFractionDigits: 2 }
  )}m`;
}
