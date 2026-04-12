import {
  AnalyticsEmptyState
} from "@/components/layout/analytics-empty-state";
import type { DashboardSummary, RecommendationItem } from "./company-dashboard-types";
import { emptySummary } from "./company-dashboard-types";

export const recommendationToneClass: Record<RecommendationItem["tone"], string> = {
  danger: "border-red-200 bg-red-50 text-red-900",
  warn: "border-amber-200 bg-amber-50 text-amber-900",
  good: "border-emerald-200 bg-emerald-50 text-emerald-900"
};

export const priorityToneClass: Record<RecommendationItem["priority"], string> = {
  HIGH: "bg-red-100 text-red-800",
  MEDIUM: "bg-amber-100 text-amber-800",
  LOW: "bg-emerald-100 text-emerald-800"
};

export function extractRecommendationRigName(item: RecommendationItem) {
  const titleMatch = item.title.match(/rig action:\s*(.+)$/i);
  if (titleMatch && titleMatch[1]) {
    return titleMatch[1].trim();
  }

  const codeMatch = `${item.title} ${item.message}`.match(/\bGF-RIG-[A-Z0-9-]+\b/i);
  if (codeMatch && codeMatch[0]) {
    return codeMatch[0].trim();
  }

  return null;
}

export function isMeaningfulEntity(value: string | null | undefined) {
  if (!value) {
    return false;
  }
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  return normalized !== "n/a" && normalized !== "unavailable" && !normalized.startsWith("no ");
}

export function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export function startOfCurrentWeekIso() {
  const date = new Date();
  const day = date.getUTCDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  date.setUTCDate(date.getUTCDate() + mondayOffset);
  return date.toISOString().slice(0, 10);
}

export function toIsoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

export async function readApiError(response: Response, fallbackMessage: string) {
  const clone = response.clone();
  const payload = await response.json().catch(() => null);
  if (payload && typeof payload === "object" && "message" in payload) {
    const message = payload.message;
    if (typeof message === "string" && message.trim()) {
      return message;
    }
  }

  const rawBody = (await clone.text().catch(() => "")).trim();
  if (rawBody) {
    return rawBody;
  }

  return `${fallbackMessage} (HTTP ${response.status})`;
}

export function isDashboardSummaryPayload(payload: unknown): payload is Partial<DashboardSummary> {
  if (!payload || typeof payload !== "object") {
    return false;
  }

  const candidate = payload as Partial<DashboardSummary>;
  if (!candidate.snapshot || typeof candidate.snapshot !== "object") {
    return false;
  }

  return true;
}

export function normalizeDashboardSummaryPayload(payload: Partial<DashboardSummary>): DashboardSummary {
  const snapshot = payload.snapshot ?? {};
  const profitForecast: Partial<DashboardSummary["profitForecast"]> = payload.profitForecast ?? {};

  return {
    ...emptySummary,
    ...payload,
    snapshot: {
      ...emptySummary.snapshot,
      ...snapshot
    },
    financialTrend: Array.isArray(payload.financialTrend) ? payload.financialTrend : [],
    revenueByClient: Array.isArray(payload.revenueByClient) ? payload.revenueByClient : [],
    revenueByRig: Array.isArray(payload.revenueByRig) ? payload.revenueByRig : [],
    metersTrend: Array.isArray(payload.metersTrend) ? payload.metersTrend : [],
    rigStatusData: Array.isArray(payload.rigStatusData) ? payload.rigStatusData : [],
    expenseBreakdown: Array.isArray(payload.expenseBreakdown) ? payload.expenseBreakdown : [],
    projectAssignments: Array.isArray(payload.projectAssignments) ? payload.projectAssignments : [],
    recommendations: Array.isArray(payload.recommendations) ? payload.recommendations : [],
    profitForecast: {
      ...emptySummary.profitForecast,
      ...profitForecast,
      actualVsForecastProfit: Array.isArray(profitForecast.actualVsForecastProfit)
        ? profitForecast.actualVsForecastProfit
        : [],
      forecastByRig: Array.isArray(profitForecast.forecastByRig) ? profitForecast.forecastByRig : []
    }
  };
}

export function buildDevFallbackSummary(): DashboardSummary {
  return {
    ...emptySummary,
    snapshot: {
      ...emptySummary.snapshot,
      bestPerformingClient: "Unavailable",
      bestPerformingRig: "Unavailable",
      topRevenueRig: "Unavailable",
      topForecastRig: "Unavailable"
    }
  };
}

export function DashboardSummarySkeleton({ count = 8 }: { count?: number }) {
  return (
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {Array.from({ length: count }).map((_, index) => (
        <div key={`kpi-skeleton-${index}`} className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="h-3 w-24 animate-pulse rounded bg-slate-200" />
          <div className="mt-3 h-7 w-20 animate-pulse rounded bg-slate-200" />
          <div className="mt-3 h-3 w-16 animate-pulse rounded bg-slate-100" />
        </div>
      ))}
    </section>
  );
}

export function DashboardEmptyState({
  message,
  isFiltered,
  onClearFilters,
  onLast30Days,
  onLast90Days
}: {
  message: string;
  isFiltered: boolean;
  onClearFilters: () => void;
  onLast30Days: () => void;
  onLast90Days: () => void;
}) {
  return (
    <AnalyticsEmptyState
      variant={isFiltered ? "filtered-empty" : "no-data"}
      moduleHint={message}
      onClearFilters={onClearFilters}
      onLast30Days={onLast30Days}
      onLast90Days={onLast90Days}
    />
  );
}
