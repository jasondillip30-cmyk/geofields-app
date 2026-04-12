import type { CopilotPageContext } from "@/lib/ai/contextual-copilot";

type CopilotFilters = CopilotPageContext["filters"];

const FILTER_KEYS = ["clientId", "rigId", "from", "to"] as const;

export function applyFilterContextToHref(href: string | undefined, filters: CopilotFilters): string {
  if (!href || !href.startsWith("/")) {
    return href || "";
  }

  const [pathWithQuery, hashFragment] = href.split("#", 2);
  const url = new URL(pathWithQuery, "https://geofields.local");
  for (const key of FILTER_KEYS) {
    if (url.searchParams.has(key)) {
      continue;
    }
    const value = normalizeFilterValue(filters[key]);
    if (!value) {
      continue;
    }
    url.searchParams.set(key, value);
  }

  const query = url.searchParams.toString();
  return `${url.pathname}${query ? `?${query}` : ""}${hashFragment ? `#${hashFragment}` : ""}`;
}

export function inferCopilotPageKeyFromHref(href: string | undefined) {
  if (!href) {
    return null;
  }
  const path = href.split("?")[0] || "";
  if (path.startsWith("/alerts-center")) return "alerts-center";
  if (path.startsWith("/data-quality/linkage-center")) return "data-quality-linkage-center";
  if (path.startsWith("/spending/drilling-reports")) return "drilling-reports";
  if (path.startsWith("/spending/expenses")) return "expenses";
  if (path.startsWith("/spending/profit")) return "profit";
  if (path.startsWith("/spending")) return "cost-tracking";
  if (path.startsWith("/approvals")) return "approvals";
  if (path.startsWith("/maintenance")) return "maintenance";
  if (path.startsWith("/rigs")) return "rigs";
  if (path.startsWith("/expenses")) return "expenses";
  if (path.startsWith("/executive-overview")) return "executive-overview";
  if (path.startsWith("/inventory")) return "inventory-overview";
  return null;
}

export function resolveCopilotActionLabel({
  explicitActionLabel,
  fallbackLabel,
  pageKey,
  href,
  issueType,
  targetId
}: {
  explicitActionLabel?: string | null;
  fallbackLabel?: string;
  pageKey?: string | null;
  href?: string | null;
  issueType?: string | null;
  targetId?: string | null;
}) {
  if (explicitActionLabel && explicitActionLabel.trim()) {
    return explicitActionLabel.trim();
  }
  const resolvedPageKey = (pageKey || inferCopilotPageKeyFromHref(href || undefined) || "").toLowerCase();
  const normalizedIssueType = (issueType || "").toUpperCase();

  if (resolvedPageKey.includes("approvals") || normalizedIssueType.includes("APPROVAL")) {
    return "Review approval";
  }
  if (resolvedPageKey.includes("data-quality") || normalizedIssueType.includes("LINKAGE")) {
    return "Inspect linkage";
  }
  if (resolvedPageKey.includes("maintenance") || normalizedIssueType.includes("MAINTENANCE")) {
    return "Review maintenance";
  }
  if (resolvedPageKey.includes("rigs") || normalizedIssueType.includes("RIG")) {
    return "Inspect rig";
  }
  if (resolvedPageKey.includes("expenses") || normalizedIssueType.includes("COST")) {
    return targetId ? "Open expense" : "Open expenses";
  }
  if (resolvedPageKey.includes("alerts")) {
    return "Review alert";
  }
  if (resolvedPageKey.includes("inventory")) {
    return targetId ? "Open item" : "Open inventory";
  }
  return fallbackLabel || "Open record";
}

export function resolveCopilotInspectHint({
  explicitInspectHint,
  reason,
  pageKey,
  href,
  issueType
}: {
  explicitInspectHint?: string | null;
  reason?: string | null;
  pageKey?: string | null;
  href?: string | null;
  issueType?: string | null;
}) {
  if (explicitInspectHint && explicitInspectHint.trim()) {
    return explicitInspectHint.trim();
  }
  const resolvedPageKey = (pageKey || inferCopilotPageKeyFromHref(href || undefined) || "").toLowerCase();
  const normalizedIssueType = (issueType || "").toUpperCase();

  if (resolvedPageKey.includes("approvals") || normalizedIssueType.includes("APPROVAL")) {
    return "Inspect pending age, value, and decision note.";
  }
  if (resolvedPageKey.includes("data-quality") || normalizedIssueType.includes("LINKAGE")) {
    return "Inspect suggested linkage and apply only if it is correct.";
  }
  if (resolvedPageKey.includes("maintenance") || normalizedIssueType.includes("MAINTENANCE")) {
    return "Inspect urgency, downtime risk, and parts dependency.";
  }
  if (resolvedPageKey.includes("rigs") || normalizedIssueType.includes("RIG")) {
    return "Inspect condition, utilization, and cost-vs-output signals.";
  }
  if (resolvedPageKey.includes("expenses") || normalizedIssueType.includes("COST")) {
    return "Inspect amount, category, and linkage completeness.";
  }
  if (resolvedPageKey.includes("alerts")) {
    return "Inspect severity, owner, and recommended next step.";
  }
  if (reason && reason.trim()) {
    return reason.trim();
  }
  return "Inspect this record and apply the next recommended step.";
}

function normalizeFilterValue(value: string | null | undefined) {
  if (!value || value === "all") {
    return null;
  }
  return value;
}
