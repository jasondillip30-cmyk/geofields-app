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

interface PeriodRangeIntent {
  periodView: "monthly" | "yearly";
  bucketKey: string;
  baseFrom: string;
  baseTo: string;
}

export interface LocalPeriodRange {
  from: string;
  to: string;
}

export function deriveScopedPeriodRange({
  periodView,
  bucketKey,
  baseFrom,
  baseTo
}: PeriodRangeIntent): LocalPeriodRange | null {
  const rawRange = parseRawPeriodRange(periodView, bucketKey);
  if (!rawRange) {
    return null;
  }

  const baseFromDate = parseIsoDate(baseFrom);
  const baseToDate = parseIsoDate(baseTo);
  const effectiveFrom = baseFromDate && baseFromDate > rawRange.from ? baseFromDate : rawRange.from;
  const effectiveTo = baseToDate && baseToDate < rawRange.to ? baseToDate : rawRange.to;
  if (effectiveFrom > effectiveTo) {
    return null;
  }

  return {
    from: toDateIso(effectiveFrom),
    to: toDateIso(effectiveTo)
  };
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

function parseRawPeriodRange(periodView: "monthly" | "yearly", bucketKey: string) {
  if (periodView === "monthly") {
    const matched = bucketKey.match(/^(\d{4})-(\d{2})$/);
    if (!matched) {
      return null;
    }
    const year = Number(matched[1]);
    const month = Number(matched[2]);
    if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
      return null;
    }
    const from = new Date(Date.UTC(year, month - 1, 1));
    const to = new Date(Date.UTC(year, month, 0));
    return { from, to };
  }

  const year = Number(bucketKey);
  if (!Number.isFinite(year)) {
    return null;
  }
  const from = new Date(Date.UTC(year, 0, 1));
  const to = new Date(Date.UTC(year, 11, 31));
  return { from, to };
}

function parseIsoDate(value: string) {
  const normalized = `${value || ""}`.trim();
  if (!normalized) {
    return null;
  }
  const parsed = new Date(`${normalized}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  parsed.setUTCHours(0, 0, 0, 0);
  return parsed;
}
