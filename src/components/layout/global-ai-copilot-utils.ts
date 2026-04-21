import type {
  CopilotNavigationTarget,
  CopilotPageContext,
  CopilotIntent,
  ContextualCopilotResponsePayload
} from "@/lib/ai/contextual-copilot";
import type { CopilotScopeMode } from "./global-ai-copilot-types";

export function resolveRoleQuickPrompts(role: string | null) {
  const normalizedRole = (role || "").toUpperCase();
  if (normalizedRole === "ADMIN" || normalizedRole === "MANAGER") {
    return [
      "What should I do first?",
      "Show biggest risks",
      "Show top revenue rig",
      "Show biggest profitability issue",
      "Take me to biggest approval issue"
    ];
  }
  if (normalizedRole === "OFFICE") {
    return [
      "What should I do first?",
      "Show pending approvals",
      "Show data gaps hurting reports",
      "Show highest value pending item",
      "Inspect linkage issues"
    ];
  }
  if (normalizedRole === "MECHANIC") {
    return [
      "What should I do first?",
      "Show pending maintenance risks",
      "Show rigs needing attention",
      "Show parts-related issues",
      "Take me to top maintenance issue"
    ];
  }
  if (normalizedRole === "FIELD" || normalizedRole === "STAFF") {
    return [
      "What should I do first?",
      "Show incomplete reports",
      "Show delayed submissions",
      "Show project updates needed",
      "Review rig assignment issues"
    ];
  }
  return [
    "What should I do first?",
    "Show biggest risks",
    "Show items I can fix quickly",
    "Take me there"
  ];
}

export function normalizePageKey(pathname: string) {
  if (pathname.startsWith("/executive-overview")) {
    return "executive-overview";
  }
  if (pathname.startsWith("/alerts-center")) {
    return "alerts-center";
  }
  if (pathname.startsWith("/data-quality/linkage-center")) {
    return "data-quality-linkage-center";
  }
  if (pathname.startsWith("/spending/drilling-reports")) {
    return "drilling-reports";
  }
  if (pathname.startsWith("/spending/expenses")) {
    return "expenses";
  }
  if (pathname.startsWith("/spending/profit")) {
    return "profit";
  }
  if (pathname.startsWith("/spending")) {
    return "cost-tracking";
  }
  if (pathname.startsWith("/expenses")) {
    return "expenses";
  }
  if (pathname.startsWith("/drilling-reports")) {
    return "drilling-reports";
  }
  if (pathname.startsWith("/breakdowns")) {
    return "breakdowns";
  }
  if (pathname.startsWith("/maintenance")) {
    return "maintenance";
  }
  if (pathname.startsWith("/forecasting")) {
    return "forecasting";
  }
  if (pathname.startsWith("/inventory/items")) {
    return "inventory-items";
  }
  if (pathname.startsWith("/inventory/stock-movements")) {
    return "inventory-stock-movements";
  }
  if (pathname.startsWith("/inventory/issues")) {
    return "inventory-issues";
  }
  if (
    pathname.startsWith("/purchasing/receipt-follow-up") ||
    pathname.startsWith("/inventory/receipt-intake")
  ) {
    return "inventory-receipt-intake";
  }
  if (pathname.startsWith("/inventory/suppliers")) {
    return "inventory-suppliers";
  }
  if (pathname.startsWith("/inventory/locations")) {
    return "inventory-locations";
  }
  if (pathname.startsWith("/inventory")) {
    return "inventory-items";
  }
  return pathname.replace(/^\//, "").replace(/\//g, "-") || "company-dashboard";
}

export function inferPageKeyFromHref(href: string) {
  const path = href.split("?")[0] || "";
  if (path.startsWith("/executive-overview")) {
    return "executive-overview";
  }
  if (path.startsWith("/alerts-center")) {
    return "alerts-center";
  }
  if (path.startsWith("/data-quality/linkage-center")) {
    return "data-quality-linkage-center";
  }
  if (path.startsWith("/spending/drilling-reports")) {
    return "drilling-reports";
  }
  if (path.startsWith("/spending/expenses")) {
    return "expenses";
  }
  if (path.startsWith("/spending/profit")) {
    return "profit";
  }
  if (path.startsWith("/spending")) {
    return "cost-tracking";
  }
  if (path.startsWith("/expenses")) {
    return "expenses";
  }
  if (path.startsWith("/approvals")) {
    return "approvals";
  }
  if (path.startsWith("/drilling-reports")) {
    return "drilling-reports";
  }
  if (path.startsWith("/breakdowns")) {
    return "breakdowns";
  }
  if (path.startsWith("/maintenance")) {
    return "maintenance";
  }
  if (path.startsWith("/forecasting")) {
    return "forecasting";
  }
  if (path.startsWith("/inventory/items")) {
    return "inventory-items";
  }
  if (path.startsWith("/inventory/stock-movements")) {
    return "inventory-stock-movements";
  }
  if (path.startsWith("/inventory/issues")) {
    return "inventory-issues";
  }
  if (
    path.startsWith("/purchasing/receipt-follow-up") ||
    path.startsWith("/inventory/receipt-intake")
  ) {
    return "inventory-receipt-intake";
  }
  if (path.startsWith("/inventory/suppliers")) {
    return "inventory-suppliers";
  }
  if (path.startsWith("/inventory/locations")) {
    return "inventory-locations";
  }
  if (path.startsWith("/inventory")) {
    return "inventory-items";
  }
  return normalizePageKey(path);
}

export function resolvePageName(pathname: string) {
  if (pathname === "/") {
    return "Company Dashboard";
  }
  if (pathname.startsWith("/executive-overview")) {
    return "Executive Overview";
  }
  if (pathname.startsWith("/alerts-center")) {
    return "Alerts Center";
  }
  if (pathname.startsWith("/data-quality/linkage-center")) {
    return "Data Quality / Linkage Center";
  }
  if (pathname.startsWith("/spending/profit")) {
    return "Spending / Profit";
  }
  if (pathname.startsWith("/spending/drilling-reports")) {
    return "Spending / Drilling Reports";
  }
  if (pathname.startsWith("/spending/expenses")) {
    return "Spending / Expenses";
  }
  if (pathname.startsWith("/spending")) {
    return "Spending";
  }
  if (pathname.startsWith("/expenses")) {
    return "Expenses";
  }
  if (pathname.startsWith("/drilling-reports")) {
    return "Drilling Reports";
  }
  if (pathname.startsWith("/breakdowns")) {
    return "Breakdown Reports";
  }
  if (pathname.startsWith("/maintenance")) {
    return "Maintenance";
  }
  if (pathname.startsWith("/forecasting")) {
    return "Forecasting";
  }
  if (pathname.startsWith("/inventory/items")) {
    return "Inventory Items";
  }
  if (pathname.startsWith("/inventory/stock-movements")) {
    return "Inventory Stock Movements";
  }
  if (pathname.startsWith("/inventory/issues")) {
    return "Inventory Issues";
  }
  if (
    pathname.startsWith("/purchasing/receipt-follow-up") ||
    pathname.startsWith("/inventory/receipt-intake")
  ) {
    return "Purchase Receipt Follow-up";
  }
  if (pathname.startsWith("/inventory/suppliers")) {
    return "Inventory Suppliers";
  }
  if (pathname.startsWith("/inventory/locations")) {
    return "Inventory Locations";
  }
  if (pathname.startsWith("/inventory")) {
    return "Inventory Items";
  }
  return pathname
    .replace(/^\//, "")
    .split("/")
    .filter(Boolean)
    .map((segment) => segment.replace(/-/g, " "))
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" / ");
}

export function formatScopeSummary(context: CopilotPageContext) {
  const parts: string[] = [];
  if (context.filters.clientId && context.filters.clientId !== "all") {
    parts.push("Client scoped");
  }
  if (context.filters.rigId && context.filters.rigId !== "all") {
    parts.push("Rig scoped");
  }
  if (context.filters.from || context.filters.to) {
    parts.push("Date scoped");
  }
  if (parts.length === 0) {
    return "All data scope";
  }
  return parts.join(" • ");
}

const scopeModeLabels: Record<CopilotScopeMode, string> = {
  THIS_PAGE: "This page",
  RELATED_DATA: "Related data",
  WHOLE_APP: "Whole app"
};

export const scopeModeOptions: CopilotScopeMode[] = ["THIS_PAGE", "RELATED_DATA", "WHOLE_APP"];

export function scopeModeLabel(mode: CopilotScopeMode) {
  return scopeModeLabels[mode];
}

export function composeContextForScope({
  scopeMode,
  currentContext,
  contextRegistry,
  recentPageKeys
}: {
  scopeMode: CopilotScopeMode;
  currentContext: CopilotPageContext;
  contextRegistry: Record<string, CopilotPageContext>;
  recentPageKeys: string[];
}): CopilotPageContext {
  if (scopeMode === "THIS_PAGE") {
    return {
      ...currentContext,
      scopeMode: "THIS_PAGE",
      sourcePageKeys: [currentContext.pageKey]
    };
  }

  const knownContexts = Object.values(contextRegistry);
  if (knownContexts.length === 0) {
    return {
      ...currentContext,
      scopeMode,
      sourcePageKeys: [currentContext.pageKey]
    };
  }

  const relatedPageKeys = new Set<string>([currentContext.pageKey]);
  for (const target of currentContext.navigationTargets || []) {
    if (target.pageKey) {
      relatedPageKeys.add(target.pageKey);
    } else if (target.href) {
      relatedPageKeys.add(inferPageKeyFromHref(target.href));
    }
  }
  for (const pageKey of recentPageKeys.slice(0, 4)) {
    relatedPageKeys.add(pageKey);
  }

  const selectedContexts =
    scopeMode === "RELATED_DATA"
      ? knownContexts.filter((entry) => relatedPageKeys.has(entry.pageKey))
      : knownContexts;

  if (selectedContexts.length === 0) {
    selectedContexts.push(currentContext);
  }

  const dedupeNav = new Set<string>();
  const mergedNavigationTargets: CopilotNavigationTarget[] = [];
  const mergedSummaryMetrics: CopilotPageContext["summaryMetrics"] = [];
  const mergedTablePreviews: NonNullable<CopilotPageContext["tablePreviews"]> = [];
  const mergedPriorityItems: NonNullable<CopilotPageContext["priorityItems"]> = [];
  const mergedNotes: string[] = [];

  for (const context of selectedContexts) {
    for (const metric of context.summaryMetrics || []) {
      mergedSummaryMetrics.push({
        ...metric,
        key: `${context.pageKey}:${metric.key || metric.label}`,
        label:
          context.pageKey === currentContext.pageKey
            ? metric.label
            : `${context.pageName} • ${metric.label}`
      });
    }

    for (const preview of context.tablePreviews || []) {
      mergedTablePreviews.push({
        ...preview,
        key: `${context.pageKey}:${preview.key}`,
        title:
          context.pageKey === currentContext.pageKey
            ? preview.title
            : `${context.pageName} • ${preview.title}`
      });
    }

    for (const item of context.priorityItems || []) {
      mergedPriorityItems.push({
        ...item,
        id: `${context.pageKey}:${item.id}`
      });
    }

    for (const target of context.navigationTargets || []) {
      const key = `${target.href}::${target.targetId || ""}::${target.sectionId || ""}`;
      if (!target.href || dedupeNav.has(key)) {
        continue;
      }
      dedupeNav.add(key);
      mergedNavigationTargets.push(target);
    }

    if (Array.isArray(context.notes)) {
      mergedNotes.push(...context.notes);
    }
  }

  return {
    ...currentContext,
    pageKey: scopeMode === "RELATED_DATA" ? "atlas-related" : "atlas-whole-app",
    pageName: scopeMode === "RELATED_DATA" ? "Atlas Related Data" : "Atlas Whole App",
    scopeMode,
    sourcePageKeys: selectedContexts.map((entry) => entry.pageKey),
    summaryMetrics: mergedSummaryMetrics.slice(0, 80),
    tablePreviews: mergedTablePreviews.slice(0, 12),
    priorityItems: mergedPriorityItems.slice(0, 30),
    navigationTargets: mergedNavigationTargets.slice(0, 16),
    notes: dedupeNotes([
      scopeMode === "RELATED_DATA"
        ? "Scope set to related data. Atlas is using current and linked modules."
        : "Scope set to whole app. Atlas is using cross-module context.",
      ...mergedNotes
    ]).slice(0, 12)
  };
}

function dedupeNotes(notes: string[]) {
  const seen = new Set<string>();
  const next: string[] = [];
  for (const note of notes) {
    const normalized = note.trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    next.push(normalized);
  }
  return next;
}

export function createMessageId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2, 9)}`;
}

export function formatRelativeDate(value: string) {
  const date = Date.parse(value);
  if (!Number.isFinite(date)) {
    return "now";
  }
  const diff = Date.now() - date;
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < minute) {
    return "just now";
  }
  if (diff < hour) {
    return `${Math.max(1, Math.round(diff / minute))}m ago`;
  }
  if (diff < day) {
    return `${Math.max(1, Math.round(diff / hour))}h ago`;
  }
  return `${Math.max(1, Math.round(diff / day))}d ago`;
}

export function formatClock(value: string) {
  const date = Date.parse(value);
  if (!Number.isFinite(date)) {
    return "now";
  }
  return new Date(date).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit"
  });
}

export function formatIntentLabel(intent: CopilotIntent) {
  switch (intent) {
    case "general_explanation":
      return "General explanation";
    case "app_guidance":
      return "App guidance";
    case "navigation":
      return "Navigation";
    case "comparison":
      return "Comparison";
    case "follow_up_reference":
      return "Follow-up";
    case "page_summary":
      return "Page summary";
    case "whole_app_summary":
      return "Whole-app summary";
    default:
      return "Guidance";
  }
}

export function shouldRenderAssistantArtifacts(responseData: ContextualCopilotResponsePayload) {
  if (responseData.presentationMode === "minimal") {
    return false;
  }
  if (responseData.conversationIntent === "small_talk" || responseData.conversationIntent === "general_question") {
    return false;
  }
  if (responseData.intent === "navigation") {
    return true;
  }
  if ((responseData.focusItems || []).length > 0) {
    return true;
  }
  return (responseData.navigationTargets || []).length > 0;
}
