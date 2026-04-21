import type {
  CopilotFocusItem,
  CopilotFocusSeverity,
  CopilotNavigationTarget,
  CopilotPageContext,
  CopilotSuggestionConfidence
} from "@/lib/ai/contextual-copilot";

export const fallbackCopilotContext: CopilotPageContext = {
  pageKey: "company-dashboard",
  pageName: "Company Dashboard",
  viewerRole: null,
  scopeMode: "THIS_PAGE",
  sourcePageKeys: [],
  filters: {},
  summaryMetrics: [],
  tablePreviews: [],
  selectedItems: [],
  priorityItems: [],
  navigationTargets: [],
  notes: []
};

export function normalizeCopilotContext(context: CopilotPageContext | null | undefined): CopilotPageContext {
  const source = context && typeof context === "object" ? context : fallbackCopilotContext;
  const rawPriorityItems = Array.isArray(source.priorityItems)
    ? (source.priorityItems as CopilotFocusItem[])
    : [];
  return {
    pageKey: normalizeText(source.pageKey, fallbackCopilotContext.pageKey),
    pageName: normalizeText(source.pageName, fallbackCopilotContext.pageName),
    viewerRole: source.viewerRole || null,
    scopeMode: normalizeScopeMode(source.scopeMode),
    sourcePageKeys: normalizeStringArray(source.sourcePageKeys),
    filters: {
      clientId: normalizeOptionalText(source.filters?.clientId),
      rigId: normalizeOptionalText(source.filters?.rigId),
      from: normalizeOptionalText(source.filters?.from),
      to: normalizeOptionalText(source.filters?.to)
    },
    summaryMetrics: normalizeSummaryMetrics(source.summaryMetrics),
    tablePreviews: normalizeTablePreviews(source.tablePreviews),
    selectedItems: normalizeSelectedItems(source.selectedItems),
    priorityItems: normalizeFocusItems(rawPriorityItems),
    navigationTargets: normalizeNavigationTargets(source.navigationTargets),
    notes: normalizeStringArray(source.notes),
    sessionContext: normalizeSessionContext(source.sessionContext)
  };
}

export function normalizeFocusItems(items: CopilotFocusItem[]) {
  const normalized: CopilotFocusItem[] = [];
  for (const [index, item] of items.entries()) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const label = (item.label || "").trim();
    const reason = (item.reason || "").trim();
    if (!label || !reason) {
      continue;
    }
    normalized.push({
      id: item.id || `focus-${index}`,
      label,
      reason,
      severity: normalizeSeverity(item.severity),
      amount: item.amount ?? null,
      href: item.href || undefined,
      issueType: normalizeIssueType(item.issueType),
      actionLabel: item.actionLabel?.trim() || undefined,
      inspectHint: item.inspectHint?.trim() || undefined,
      targetId: item.targetId?.trim() || undefined,
      sectionId: item.sectionId?.trim() || undefined,
      targetPageKey: item.targetPageKey || inferPageKeyFromHref(item.href),
      confidence: normalizeConfidence(item.confidence)
    });
  }
  return normalized;
}

export function normalizeSeverity(value: CopilotFocusSeverity | string): CopilotFocusSeverity {
  if (value === "CRITICAL" || value === "HIGH" || value === "MEDIUM" || value === "LOW") {
    return value;
  }
  return "MEDIUM";
}

export function normalizeConfidence(
  value: CopilotSuggestionConfidence | string | null | undefined
): CopilotSuggestionConfidence | null {
  if (value === "HIGH" || value === "MEDIUM" || value === "LOW") {
    return value;
  }
  return null;
}

export function normalizeIssueType(value: string | undefined | null) {
  const source = (value || "").trim();
  if (!source) {
    return "GENERAL";
  }
  const normalized = source.replace(/\s+/g, "_").toUpperCase();
  if (normalized.includes("NO_BUDGET")) {
    return "NO_BUDGET";
  }
  if (normalized.includes("OVERSPENT") || normalized.includes("BUDGET")) {
    return "BUDGET_PRESSURE";
  }
  if (normalized.includes("APPROVAL")) {
    return "APPROVAL_BACKLOG";
  }
  if (normalized.includes("DRILLING")) {
    return "APPROVAL_BACKLOG";
  }
  if (normalized.includes("PROFITABILITY") || normalized.includes("MARGIN") || normalized.includes("LOW_REVENUE")) {
    return "PROFITABILITY";
  }
  if (normalized.includes("REVENUE_OPPORTUNITY") || normalized.includes("TOP_REVENUE") || normalized.includes("REVENUE")) {
    return "REVENUE_OPPORTUNITY";
  }
  if (normalized.includes("RIG_RISK") || normalized.includes("UTILIZATION")) {
    return "RIG_RISK";
  }
  if (normalized.includes("RIG_SPEND")) {
    return "RIG_SPEND";
  }
  if (normalized.includes("PROJECT_SPEND")) {
    return "PROJECT_SPEND";
  }
  if (normalized.includes("COST_DRIVER")) {
    return "COST_DRIVER";
  }
  if (normalized.includes("MAINTENANCE")) {
    return "MAINTENANCE";
  }
  if (normalized.includes("LINKAGE")) {
    return "LINKAGE";
  }
  if (normalized.includes("ALERT")) {
    return "ALERT";
  }
  return normalized;
}

export function resolveScopedPageHref(context: CopilotPageContext) {
  const fallbackMap: Record<string, string> = {
    "atlas-related": "/",
    "atlas-whole-app": "/",
    "company-dashboard": "/",
    "executive-overview": "/executive-overview",
    "alerts-center": "/alerts-center",
    "data-quality-linkage-center": "/data-quality/linkage-center",
    "budget-vs-actual": "/spending",
    "cost-tracking": "/spending",
    expenses: "/expenses",
    "drilling-reports": "/drilling-reports",
    breakdowns: "/breakdowns",
    "inventory-overview": "/inventory/items",
    "inventory-items": "/inventory/items",
    "inventory-stock-movements": "/inventory/stock-movements",
    "inventory-issues": "/inventory/issues",
    "inventory-receipt-intake": "/purchasing/receipt-follow-up",
    "inventory-suppliers": "/inventory/suppliers",
    "inventory-locations": "/inventory/locations",
    maintenance: "/maintenance",
    rigs: "/rigs",
    profit: "/spending/profit",
    forecasting: "/forecasting"
  };
  const fallback = fallbackMap[context.pageKey] || "/";
  const params = new URLSearchParams();
  if (context.filters.clientId && context.filters.clientId !== "all") {
    params.set("clientId", context.filters.clientId);
  }
  if (context.filters.rigId && context.filters.rigId !== "all") {
    params.set("rigId", context.filters.rigId);
  }
  if (context.filters.from) {
    params.set("from", context.filters.from);
  }
  if (context.filters.to) {
    params.set("to", context.filters.to);
  }
  const query = params.toString();
  return query ? `${fallback}?${query}` : fallback;
}

export function inferPageKeyFromHref(href: string | undefined) {
  if (!href) {
    return undefined;
  }
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
  if (path.startsWith("/cost-tracking/budget-vs-actual")) {
    return "budget-vs-actual";
  }
  if (path.startsWith("/budget-vs-actual")) {
    return "budget-vs-actual";
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
  if (path.startsWith("/rigs")) {
    return "rigs";
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
  if (path.startsWith("/purchasing/receipt-follow-up")) {
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
  if (path.startsWith("/")) {
    return path.slice(1).replace(/\//g, "-") || "company-dashboard";
  }
  return undefined;
}

export function linkageSectionIdForType(linkageLabel: string) {
  const lower = linkageLabel.toLowerCase();
  if (lower.includes("rig")) {
    return "missing-rig-section";
  }
  if (lower.includes("project")) {
    return "missing-project-section";
  }
  return "missing-maintenance-section";
}

export function inferBudgetSectionId(row: Record<string, string | number | null>) {
  const scope = (readStringFromRow(row, ["scope"]) || "").toLowerCase();
  if (scope === "rig" || Boolean(readStringFromRow(row, ["rig"]))) {
    return "rig-budget-section";
  }
  if (scope === "project" || Boolean(readStringFromRow(row, ["project"]))) {
    return "project-budget-section";
  }
  return "attention-needed-section";
}

export function countActiveFilters(filters: CopilotPageContext["filters"]) {
  let active = 0;
  const values = [filters.clientId, filters.rigId, filters.from, filters.to];
  for (const value of values) {
    if (!value) {
      continue;
    }
    if (value !== "all") {
      active += 1;
    }
  }
  return active;
}

function readStringFromRow(row: Record<string, string | number | null>, keys: string[]) {
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

function normalizeText(value: unknown, fallback: string) {
  if (typeof value !== "string") {
    return fallback;
  }
  const trimmed = value.trim();
  return trimmed || fallback;
}

function normalizeOptionalText(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed || null;
}

function normalizeStringArray(values: unknown) {
  if (!Array.isArray(values)) {
    return [];
  }
  return values
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter(Boolean);
}

function normalizeScopeMode(value: CopilotPageContext["scopeMode"]) {
  if (value === "THIS_PAGE" || value === "RELATED_DATA" || value === "WHOLE_APP") {
    return value;
  }
  return "THIS_PAGE";
}

function normalizeSummaryMetrics(value: unknown): CopilotPageContext["summaryMetrics"] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }
      const row = entry as Record<string, unknown>;
      const label = normalizeText(row.label, "");
      if (!label) {
        return null;
      }
      const metricValue =
        typeof row.value === "number" || typeof row.value === "string" || row.value === null
          ? row.value
          : null;
      return {
        key: normalizeOptionalText(row.key) || undefined,
        label,
        value: metricValue
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
}

function normalizeTablePreviews(value: unknown): CopilotPageContext["tablePreviews"] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }
      const row = entry as Record<string, unknown>;
      const key = normalizeText(row.key, "");
      const title = normalizeText(row.title, "");
      if (!key || !title) {
        return null;
      }
      const rowCount =
        typeof row.rowCount === "number" && Number.isFinite(row.rowCount) ? row.rowCount : 0;
      const columns = normalizeStringArray(row.columns);
      const rows = Array.isArray(row.rows)
        ? row.rows.filter((item): item is Record<string, string | number | null> => {
            if (!item || typeof item !== "object") {
              return false;
            }
            return true;
          })
        : [];
      return {
        key,
        title,
        rowCount,
        columns,
        rows
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
}

function normalizeSelectedItems(value: unknown): CopilotPageContext["selectedItems"] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }
      const row = entry as Record<string, unknown>;
      const id = normalizeText(row.id, "");
      const type = normalizeText(row.type, "");
      if (!id || !type) {
        return null;
      }
      return {
        id,
        type,
        label: normalizeOptionalText(row.label) || undefined
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
}

function normalizeNavigationTargets(value: unknown): CopilotNavigationTarget[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const normalized: CopilotNavigationTarget[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const row = entry as Record<string, unknown>;
    const label = normalizeText(row.label, "");
    const href = normalizeText(row.href, "");
    if (!label || !href) {
      continue;
    }
    const targetPrecision =
      row.targetPrecision === "EXACT_ROW" ||
      row.targetPrecision === "SECTION" ||
      row.targetPrecision === "PAGE"
        ? row.targetPrecision
        : undefined;
    normalized.push({
      label,
      href,
      reason: normalizeOptionalText(row.reason) || undefined,
      actionLabel: normalizeOptionalText(row.actionLabel) || undefined,
      inspectHint: normalizeOptionalText(row.inspectHint) || undefined,
      targetId: normalizeOptionalText(row.targetId) || undefined,
      sectionId: normalizeOptionalText(row.sectionId) || undefined,
      pageKey: normalizeOptionalText(row.pageKey) || undefined,
      targetPrecision,
      availabilityNote: normalizeOptionalText(row.availabilityNote) || undefined
    });
  }
  return normalized;
}

function normalizeSessionContext(
  value: CopilotPageContext["sessionContext"]
): CopilotPageContext["sessionContext"] {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const recentConversation = Array.isArray(value.recentConversation)
    ? value.recentConversation
        .map((entry) => {
          if (!entry || typeof entry !== "object") {
            return null;
          }
          const role: "user" | "assistant" =
            entry.role === "assistant" ? "assistant" : "user";
          return {
            role,
            text: normalizeOptionalText(entry.text) || undefined,
            pageKey: normalizeOptionalText(entry.pageKey) || undefined,
            createdAt:
              typeof entry.createdAt === "number" && Number.isFinite(entry.createdAt)
                ? entry.createdAt
                : undefined
          };
        })
        .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
    : [];
  const recentSuggestedFocus = Array.isArray(value.recentSuggestedFocus)
    ? value.recentSuggestedFocus
        .map((entry) => {
          if (!entry || typeof entry !== "object") {
            return null;
          }
          const severity =
            entry.severity === "CRITICAL" ||
            entry.severity === "HIGH" ||
            entry.severity === "MEDIUM" ||
            entry.severity === "LOW"
              ? entry.severity
              : null;
          return {
            pageKey: normalizeOptionalText(entry.pageKey) || undefined,
            label: normalizeOptionalText(entry.label) || undefined,
            reason: normalizeOptionalText(entry.reason),
            severity,
            issueType: normalizeOptionalText(entry.issueType),
            href: normalizeOptionalText(entry.href),
            targetId: normalizeOptionalText(entry.targetId),
            sectionId: normalizeOptionalText(entry.sectionId),
            createdAt:
              typeof entry.createdAt === "number" && Number.isFinite(entry.createdAt)
                ? entry.createdAt
                : undefined
          };
        })
        .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
    : [];

  const currentFocusTarget =
    value.currentFocusTarget && typeof value.currentFocusTarget === "object"
      ? {
          pageKey: normalizeOptionalText(value.currentFocusTarget.pageKey),
          href: normalizeOptionalText(value.currentFocusTarget.href),
          targetId: normalizeOptionalText(value.currentFocusTarget.targetId),
          sectionId: normalizeOptionalText(value.currentFocusTarget.sectionId),
          label: normalizeOptionalText(value.currentFocusTarget.label)
        }
      : undefined;

  return {
    recentQuestions: normalizeStringArray(value.recentQuestions),
    recentPageKeys: normalizeStringArray(value.recentPageKeys),
    recentConversation,
    recentSuggestedFocus,
    currentFocusTarget
  };
}
