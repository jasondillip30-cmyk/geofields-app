import type {
  CopilotFocusItem,
  CopilotNavigationTarget,
  CopilotSummaryMetric,
  CopilotSuggestionConfidence
} from "@/lib/ai/contextual-copilot";
import { normalizeIssueType } from "@/lib/ai/contextual-copilot-context";

export function focusSeverityRank(value: CopilotFocusItem["severity"]) {
  if (value === "CRITICAL") {
    return 0;
  }
  if (value === "HIGH") {
    return 1;
  }
  if (value === "MEDIUM") {
    return 2;
  }
  return 3;
}

export function resolveLargestMetric(metrics: CopilotSummaryMetric[]) {
  let candidate: CopilotSummaryMetric | null = null;
  let largest = Number.NEGATIVE_INFINITY;
  for (const metric of metrics) {
    const numeric = parseMetricNumber(metric.value);
    if (numeric === null) {
      continue;
    }
    if (numeric > largest) {
      largest = numeric;
      candidate = metric;
    }
  }
  return candidate;
}

export function hasMetric(metrics: CopilotSummaryMetric[], patterns: RegExp[]) {
  return findMetricValue(metrics, patterns) > 0;
}

export function findMetricValue(metrics: CopilotSummaryMetric[], patterns: RegExp[]) {
  for (const metric of metrics) {
    const searchTarget = `${metric.key || ""} ${metric.label}`.trim();
    if (!patterns.some((pattern) => pattern.test(searchTarget))) {
      continue;
    }
    const parsed = parseMetricNumber(metric.value);
    if (parsed !== null) {
      return parsed;
    }
  }
  return 0;
}

export function findMetricString(metrics: CopilotSummaryMetric[], patterns: RegExp[]) {
  for (const metric of metrics) {
    const searchTarget = `${metric.key || ""} ${metric.label}`.trim();
    if (!patterns.some((pattern) => pattern.test(searchTarget))) {
      continue;
    }
    if (typeof metric.value === "string") {
      const normalized = metric.value.trim();
      if (normalized) {
        return normalized;
      }
    }
  }
  return null;
}

export function parseMetricNumber(value: CopilotSummaryMetric["value"]) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.replace(/[^0-9.-]/g, "");
  if (!normalized) {
    return null;
  }
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

export function readString(row: Record<string, string | number | null>, keys: string[]) {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
  }
  return null;
}

export function readNumber(row: Record<string, string | number | null>, keys: string[]) {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string") {
      const parsed = Number(value.replace(/[^0-9.-]/g, ""));
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }
  return null;
}

export function readConfidence(row: Record<string, string | number | null>, keys: string[]) {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string") {
      const normalized = value.trim().toUpperCase();
      if (normalized === "HIGH" || normalized === "MEDIUM" || normalized === "LOW") {
        return normalized as CopilotSuggestionConfidence;
      }
    }
  }
  return null;
}

export function formatMetricValue(value: CopilotSummaryMetric["value"]) {
  if (typeof value === "number") {
    return new Intl.NumberFormat("en-US").format(value);
  }
  return value || "0";
}

export function formatAsMoney(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0
  }).format(value || 0);
}

export function roundNumber(value: number) {
  return Math.round(value * 100) / 100;
}

export function inferApprovalTab(queueLabel: string) {
  const lower = queueLabel.toLowerCase();
  if (lower.includes("drilling")) {
    return "drilling-reports";
  }
  if (lower.includes("maintenance")) {
    return "maintenance";
  }
  if (lower.includes("inventory")) {
    return "inventory-usage";
  }
  if (lower.includes("receipt")) {
    return "receipt-submissions";
  }
  return null;
}

export function buildIssueTypeCounts(items: CopilotFocusItem[]) {
  const counts = new Map<string, number>();
  for (const item of items) {
    const key = normalizeIssueType(item.issueType);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count);
}

export function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function dedupeNavigationTargets(
  targets: CopilotNavigationTarget[],
  resolveTargetPrecision: (input: {
    targetId?: string;
    sectionId?: string;
  }) => "EXACT_ROW" | "SECTION" | "PAGE" | undefined
) {
  const seen = new Set<string>();
  const unique: CopilotNavigationTarget[] = [];
  for (const target of targets) {
    const dedupeKey = `${target.href}::${target.targetId || ""}::${target.sectionId || ""}`;
    if (!target.href || seen.has(dedupeKey)) {
      continue;
    }
    seen.add(dedupeKey);
    unique.push({
      ...target,
      targetPrecision:
        target.targetPrecision ||
        resolveTargetPrecision({
          targetId: target.targetId,
          sectionId: target.sectionId
        }) ||
        "PAGE",
      availabilityNote: target.availabilityNote || undefined
    });
  }
  return unique;
}
