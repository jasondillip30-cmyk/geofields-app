import type { UserRole } from "@/lib/types";
import {
  buildGeneralExplanationAnswer,
  buildSmallTalkAnswer,
  isBroadGeneralQuestion,
  isClarificationQuestion,
  isComparisonQuestion,
  isFollowUpReference,
  isGeneralExplanationQuestion,
  isPlanningQuestion,
  isSmallTalk,
  isSummaryQuestion,
  normalizeUserQuestion,
  resolveGeoFieldsDecisionCommand,
  type GeoFieldsDecisionCommand
} from "@/lib/ai/contextual-copilot-intents";
import {
  compactSummaryLine,
  conciseFocusLine,
  condenseReason,
  dedupeText,
  normalizeKey,
  trimTrailingPeriod
} from "@/lib/ai/contextual-copilot-text";
import {
  countActiveFilters,
  inferBudgetSectionId,
  inferPageKeyFromHref,
  linkageSectionIdForType,
  normalizeFocusItems,
  normalizeIssueType,
  normalizeSeverity,
  resolveScopedPageHref
} from "@/lib/ai/contextual-copilot-context";
import {
  buildIssueTypeCounts,
  clamp,
  dedupeNavigationTargets as dedupeNavigationTargetsByPrecision,
  findMetricString,
  findMetricValue,
  focusSeverityRank,
  formatAsMoney,
  formatMetricValue,
  hasMetric,
  inferApprovalTab,
  readConfidence,
  readNumber,
  readString,
  resolveLargestMetric,
  roundNumber
} from "@/lib/ai/contextual-copilot-ranking";
import {
  buildComparisonAnswer,
  buildDecisionFirstNarrative,
  buildDecisionGuidance,
  deriveIgnoreConsequence,
  resolveDelayRisk,
  resolveEffortLabel,
  resolveEffortWeight,
  resolveImpactLabel,
  resolveUrgencyLabel,
  resolveDecisionPlanItems
} from "@/lib/ai/contextual-copilot-response";

export interface CopilotSummaryMetric {
  key?: string;
  label: string;
  value: number | string | null;
}

export interface CopilotTablePreview {
  key: string;
  title: string;
  rowCount: number;
  columns: string[];
  rows: Array<Record<string, string | number | null>>;
}

export type CopilotIntent =
  | "general_explanation"
  | "app_guidance"
  | "navigation"
  | "comparison"
  | "follow_up_reference"
  | "page_summary"
  | "whole_app_summary";

export type CopilotConversationIntent =
  | "small_talk"
  | "general_question"
  | "app_question"
  | "navigation_request"
  | "follow_up_reference"
  | "comparison"
  | "planning"
  | "clarification";

export type CopilotFocusSeverity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
export type CopilotSuggestionConfidence = "HIGH" | "MEDIUM" | "LOW";

export interface CopilotFocusItem {
  id: string;
  label: string;
  reason: string;
  severity: CopilotFocusSeverity;
  amount?: number | null;
  href?: string;
  issueType?: string;
  actionLabel?: string;
  inspectHint?: string;
  targetId?: string;
  sectionId?: string;
  targetPageKey?: string;
  confidence?: CopilotSuggestionConfidence | null;
}

export interface CopilotSelectedItem {
  id: string;
  type: string;
  label?: string;
}

export interface CopilotNavigationTarget {
  label: string;
  href: string;
  reason?: string;
  actionLabel?: string;
  inspectHint?: string;
  targetId?: string;
  sectionId?: string;
  pageKey?: string;
  targetPrecision?: "EXACT_ROW" | "SECTION" | "PAGE";
  availabilityNote?: string;
}

export type CopilotInsightCardKind =
  | "TOP_RISK"
  | "BEST_NEXT_ACTION"
  | "REVENUE_OPPORTUNITY"
  | "MAINTENANCE_CONCERN"
  | "DATA_QUALITY_ISSUE";

export interface CopilotInsightCard {
  id: string;
  kind: CopilotInsightCardKind;
  title: string;
  summary: string;
  severity?: CopilotFocusSeverity;
  focusItemId?: string;
  recordKey?: string;
  actionLabel?: string;
  inspectHint?: string;
  href?: string;
  targetId?: string;
  sectionId?: string;
  targetPageKey?: string;
}

export interface CopilotPageContext {
  pageKey: string;
  pageName: string;
  viewerRole?: UserRole | string | null;
  scopeMode?: "THIS_PAGE" | "RELATED_DATA" | "WHOLE_APP";
  sourcePageKeys?: string[];
  filters: {
    clientId?: string | null;
    rigId?: string | null;
    from?: string | null;
    to?: string | null;
  };
  summaryMetrics: CopilotSummaryMetric[];
  tablePreviews?: CopilotTablePreview[];
  selectedItems?: CopilotSelectedItem[];
  priorityItems?: CopilotFocusItem[];
  navigationTargets?: CopilotNavigationTarget[];
  notes?: string[];
  sessionContext?: {
    recentQuestions?: string[];
    recentPageKeys?: string[];
    recentConversation?: Array<{
      role?: "user" | "assistant";
      text?: string;
      pageKey?: string;
      createdAt?: number;
    }>;
    recentSuggestedFocus?: Array<{
      pageKey?: string;
      label?: string;
      reason?: string | null;
      severity?: CopilotFocusSeverity | null;
      issueType?: string | null;
      href?: string | null;
      targetId?: string | null;
      sectionId?: string | null;
      createdAt?: number;
    }>;
    currentFocusTarget?: {
      pageKey?: string | null;
      href?: string | null;
      targetId?: string | null;
      sectionId?: string | null;
      label?: string | null;
    } | null;
  };
}

export interface ContextualCopilotRequestBody {
  question?: string;
  context?: CopilotPageContext;
}

export interface ContextualCopilotResponsePayload {
  intent: CopilotIntent;
  conversationIntent: CopilotConversationIntent;
  presentationMode: "minimal" | "contextual";
  answer: string;
  summary: string;
  whyThisMatters: string[];
  recommendedNextSteps: string[];
  bestQuickWins: string[];
  keyInsights: string[];
  recommendedActions: string[];
  navigationTargets: CopilotNavigationTarget[];
  usefulShortcuts: CopilotNavigationTarget[];
  focusItems: CopilotFocusItem[];
  actionRanking: {
    mostUrgent?: string;
    highestImpact?: string;
    safestQuickWin?: string;
    needsManagerJudgment?: string;
    doNow?: string;
    doNext?: string;
    canWait?: string;
  };
  aiPriorityScore: number;
  aiPriorityLabel: "Low" | "Medium" | "High" | "Urgent";
  primaryFocusItem: CopilotFocusItem | null;
  supportingItems: CopilotFocusItem[];
  secondaryInsights: string[];
  insightCards: CopilotInsightCard[];
  followUpQuestions: string[];
}

type CopilotRoleSegment = "MANAGEMENT" | "OFFICE" | "MECHANIC" | "OPERATIONS" | "GENERAL";

interface CopilotRoleProfile {
  role: UserRole | null;
  segment: CopilotRoleSegment;
  preferredCardKinds: CopilotInsightCardKind[];
  followUpPrompts: string[];
}

function resolveCopilotRoleProfile(rawRole: UserRole | string | null | undefined): CopilotRoleProfile {
  const normalized = `${rawRole || ""}`.trim().toUpperCase();
  const role =
    normalized === "ADMIN" ||
    normalized === "MANAGER" ||
    normalized === "STAFF" ||
    normalized === "OFFICE" ||
    normalized === "MECHANIC" ||
    normalized === "FIELD"
      ? (normalized as UserRole)
      : null;

  if (role === "ADMIN" || role === "MANAGER") {
    return {
      role,
      segment: "MANAGEMENT",
      preferredCardKinds: [
        "TOP_RISK",
        "BEST_NEXT_ACTION",
        "REVENUE_OPPORTUNITY",
        "MAINTENANCE_CONCERN",
        "DATA_QUALITY_ISSUE"
      ],
      followUpPrompts: [
        "Show biggest risks",
        "Show top revenue rig",
        "Show biggest profitability issue",
        "Show biggest approval issue"
      ]
    };
  }

  if (role === "OFFICE") {
    return {
      role,
      segment: "OFFICE",
      preferredCardKinds: ["TOP_RISK", "BEST_NEXT_ACTION", "DATA_QUALITY_ISSUE", "MAINTENANCE_CONCERN"],
      followUpPrompts: [
        "Show pending approvals",
        "Show data gaps hurting reports",
        "Show highest value pending item",
        "Show biggest risks"
      ]
    };
  }

  if (role === "MECHANIC") {
    return {
      role,
      segment: "MECHANIC",
      preferredCardKinds: ["TOP_RISK", "MAINTENANCE_CONCERN", "BEST_NEXT_ACTION", "DATA_QUALITY_ISSUE"],
      followUpPrompts: [
        "Show pending maintenance risks",
        "Show rigs needing attention",
        "Show parts-related issues",
        "Take me to top maintenance issue"
      ]
    };
  }

  if (role === "FIELD" || role === "STAFF") {
    return {
      role,
      segment: "OPERATIONS",
      preferredCardKinds: ["TOP_RISK", "BEST_NEXT_ACTION", "DATA_QUALITY_ISSUE"],
      followUpPrompts: [
        "Show incomplete reports",
        "Show delayed submissions",
        "Show project updates needed",
        "Show biggest risks"
      ]
    };
  }

  return {
    role: null,
    segment: "GENERAL",
    preferredCardKinds: [
      "TOP_RISK",
      "BEST_NEXT_ACTION",
      "REVENUE_OPPORTUNITY",
      "MAINTENANCE_CONCERN",
      "DATA_QUALITY_ISSUE"
    ],
    followUpPrompts: [
      "What should I do first?",
      "Show biggest risks",
      "Show items I can fix quickly",
      "Take me to top rig risk"
    ]
  };
}

export function buildContextualCopilotResponse({
  question,
  context
}: {
  question: string;
  context: CopilotPageContext;
}): ContextualCopilotResponsePayload {
  const roleProfile = resolveCopilotRoleProfile(context.viewerRole);
  const conversationIntent = classifyConversationIntent({ question, context });
  const intent = classifyCopilotIntent({ question, context, conversationIntent });
  const baseFocusItems = deriveFocusItems(context, roleProfile);
  const focusItems = prioritizeFocusItemsForQuestion({
    question,
    focusItems: baseFocusItems
  });
  const focusSelection = derivePrimarySupportingFocus({
    focusItems,
    roleProfile
  });
  const summary = deriveSummary({ context, focusItems });
  const whyThisMatters = deriveKeyInsights({ context, focusItems });
  const actionRanking = deriveActionRanking({ context, focusItems, roleProfile });
  const recommendedNextSteps = deriveRecommendedActions({
    context,
    focusItems,
    keyInsights: whyThisMatters,
    actionRanking,
    roleProfile
  });
  const bestQuickWins = deriveBestQuickWins({ context, focusItems, roleProfile });
  const insightCards = deriveInsightCards({
    context,
    focusItems,
    actionRanking,
    keyInsights: whyThisMatters,
    recommendedNextSteps,
    roleProfile
  });
  const navigationTargets = prioritizeNavigationTargets({
    question,
    context,
    focusItems,
    navigationTargets: resolveNavigationTargets({ context, focusItems })
  });
  const followUpQuestions = deriveFollowUpQuestions({ context, focusItems, roleProfile });
  const aiPriorityScore = calculatePriorityScore({ context, focusItems });
  const aiPriorityLabel = resolvePriorityLabel(aiPriorityScore);
  const answer = buildAnswer({
    intent,
    conversationIntent,
    question,
    context,
    roleProfile,
    summary,
    focusItems,
    keyInsights: whyThisMatters,
    recommendedActions: recommendedNextSteps,
    actionRanking,
    bestQuickWins,
    navigationTargets
  });

  return {
    intent,
    conversationIntent,
    presentationMode:
      conversationIntent === "small_talk" || conversationIntent === "general_question"
        ? "minimal"
        : "contextual",
    answer,
    summary,
    whyThisMatters,
    recommendedNextSteps,
    bestQuickWins,
    keyInsights: whyThisMatters,
    recommendedActions: recommendedNextSteps,
    navigationTargets,
    usefulShortcuts: navigationTargets,
    focusItems,
    actionRanking,
    aiPriorityScore,
    aiPriorityLabel,
    primaryFocusItem: focusSelection.primaryFocusItem,
    supportingItems: focusSelection.supportingItems,
    secondaryInsights: focusSelection.secondaryInsights,
    insightCards,
    followUpQuestions
  };
}

function deriveFocusItems(context: CopilotPageContext, roleProfile: CopilotRoleProfile) {
  const explicitItems = normalizeFocusItems(context.priorityItems || []);
  const tablePreviews = context.tablePreviews || [];
  const scopedPageHref = resolveScopedPageHref(context);

  let baseItems: CopilotFocusItem[] = [];
  if (explicitItems.length > 0) {
    baseItems = explicitItems;
  } else if (context.pageKey === "executive-overview") {
    baseItems = deriveExecutiveFocusItems(tablePreviews);
  } else if (context.pageKey === "alerts-center") {
    baseItems = deriveAlertsFocusItems(tablePreviews);
  } else if (context.pageKey === "data-quality-linkage-center") {
    baseItems = deriveLinkageFocusItems(tablePreviews);
  } else if (context.pageKey === "budget-vs-actual") {
    baseItems = deriveBudgetFocusItems(tablePreviews);
  } else if (context.pageKey === "expenses") {
    baseItems = deriveExpensesFocusItems(tablePreviews);
  } else if (context.pageKey === "maintenance") {
    baseItems = deriveMaintenanceFocusItems(tablePreviews);
  } else if (context.pageKey === "rigs") {
    baseItems = deriveRigsFocusItems(tablePreviews);
  } else {
    baseItems = deriveGenericFocusItems(context);
  }

  const normalized = normalizeFocusItems([...baseItems, ...deriveMetricFocusItems(context)]).map((item) => ({
    ...item,
    href: item.href || scopedPageHref,
    targetPageKey: item.targetPageKey || context.pageKey
  }));
  const roleScoped = applyRoleFocusMetadata(mergeFocusItemsByRecord(normalized), roleProfile);
  const diversityScoped =
    context.pageKey === "executive-overview"
      ? applyExecutiveFocusDiversity(roleScoped, roleProfile)
      : roleScoped;
  return rankFocusItems(diversityScoped, roleProfile).slice(0, 8);
}

function deriveExecutiveFocusItems(tablePreviews: CopilotTablePreview[]) {
  const items: CopilotFocusItem[] = [];
  const budgetRiskPreview = tablePreviews.find((preview) => preview.key === "budget-risk");
  const approvalQueuePreview = tablePreviews.find((preview) => preview.key === "approval-queues");

  for (const row of budgetRiskPreview?.rows || []) {
    const entity = readString(row, ["entity", "name", "label"]);
    const status = readString(row, ["status", "statusLabel", "alertLevel"]);
    if (!entity || !status) {
      continue;
    }
    const percentUsed = readNumber(row, ["percentUsed"]);
    const recognizedSpend = readNumber(row, ["recognizedSpend", "spend", "amount"]);
    const severity =
      /overspent/i.test(status) ? "CRITICAL" : /critical/i.test(status) ? "HIGH" : "MEDIUM";
    items.push({
      id: readString(row, ["id", "entityId"]) || `budget-${normalizeKey(entity)}`,
      label: entity,
      severity,
      amount: recognizedSpend,
      href: readString(row, ["href"]) || "/cost-tracking/budget-vs-actual",
      targetId: readString(row, ["targetId", "id", "entityId"]) || undefined,
      sectionId: readString(row, ["sectionId"]) || undefined,
      targetPageKey: "budget-vs-actual",
      issueType: "BUDGET_PRESSURE",
      reason:
        severity === "CRITICAL"
          ? `${entity} is overspent and needs immediate containment.`
          : `${entity} is in critical budget pressure${percentUsed !== null ? ` (${roundNumber(percentUsed)}% used)` : ""}.`
    });
  }

  for (const row of approvalQueuePreview?.rows || []) {
    const queue = readString(row, ["queue", "label"]);
    const pending = readNumber(row, ["pending", "count"]) || 0;
    const over3d = readNumber(row, ["over3d"]) || 0;
    const over24h = readNumber(row, ["over24h"]) || 0;
    if (!queue || pending <= 0) {
      continue;
    }
    const severity = over3d > 0 ? "HIGH" : over24h > 0 ? "MEDIUM" : "LOW";
    const queueTab = inferApprovalTab(queue);
    const queueLooksLikeDrilling = /drilling/i.test(queue || "");
    items.push({
      id: `queue-${normalizeKey(queue)}`,
      label: queue,
      severity,
      amount: pending,
      href: readString(row, ["href"]) || (queueTab ? `/approvals?tab=${queueTab}` : "/approvals"),
      sectionId: queueTab ? `approvals-tab-${queueTab}` : undefined,
      targetPageKey: "approvals",
      issueType: queueLooksLikeDrilling ? "DRILLING_REPORT_COMPLETENESS" : "APPROVAL_BACKLOG",
      reason: queueLooksLikeDrilling
        ? over3d > 0
          ? `${queue} has ${roundNumber(over3d)} report(s) older than 3 days and daily drilling visibility is stale.`
          : `${queue} has ${roundNumber(pending)} report(s) pending approval and daily drilling completeness is at risk.`
        : over3d > 0
          ? `${queue} has ${roundNumber(over3d)} item(s) older than 3 days.`
          : `${queue} has ${roundNumber(pending)} pending approval item(s).`
    });
  }

  return items;
}

function applyExecutiveFocusDiversity(
  items: CopilotFocusItem[],
  roleProfile: CopilotRoleProfile
) {
  const ranked = rankFocusItems(items, roleProfile);
  const profitabilityItems = ranked.filter((item) => isExecutiveProfitabilityItem(item));
  if (profitabilityItems.length <= 1) {
    return ranked;
  }

  const highPriorityNonProfitabilityCount = ranked.filter(
    (item) =>
      !isExecutiveProfitabilityItem(item) &&
      (item.severity === "CRITICAL" || item.severity === "HIGH")
  ).length;
  const maxProfitabilityItems = highPriorityNonProfitabilityCount > 0 ? 1 : 2;

  let keptProfitabilityCount = 0;
  const filtered: CopilotFocusItem[] = [];
  for (const item of ranked) {
    if (isExecutiveProfitabilityItem(item)) {
      if (keptProfitabilityCount >= maxProfitabilityItems) {
        continue;
      }
      keptProfitabilityCount += 1;
    }
    filtered.push(item);
  }

  return filtered;
}

function isExecutiveProfitabilityItem(item: CopilotFocusItem) {
  const issueType = normalizeIssueType(item.issueType);
  if (issueType === "PROFITABILITY") {
    return true;
  }
  const haystack = `${item.label} ${item.reason}`.toLowerCase();
  return /profitability|lowest profit|margin|high spend|low revenue|declining client/.test(haystack);
}

function deriveAlertsFocusItems(tablePreviews: CopilotTablePreview[]) {
  const items: CopilotFocusItem[] = [];
  const preview = tablePreviews.find((entry) => entry.key === "visible-alerts");
  for (const row of preview?.rows || []) {
    const entity = readString(row, ["entity"]);
    const alertType = readString(row, ["type", "alertType"]);
    const status = readString(row, ["status"]);
    const severityRaw = readString(row, ["severity"]);
    if (!entity || !severityRaw) {
      continue;
    }
    const severity = /^critical$/i.test(severityRaw) ? "CRITICAL" : "HIGH";
    const ageHours = readNumber(row, ["ageHours", "age"]) || 0;
    const amount = readNumber(row, ["amount"]);
    const actionWord =
      status === "OPEN"
        ? severity === "CRITICAL"
          ? "Resolve first"
          : ageHours >= 24
            ? "Resolve or escalate"
            : "Monitor or snooze"
        : status === "SNOOZED"
          ? "Recheck snoozed state"
          : "No immediate action";
    items.push({
      id: readString(row, ["alertKey", "id"]) || `alert-${normalizeKey(entity)}`,
      label: entity,
      severity,
      amount,
      href: readString(row, ["href", "destinationHref"]) || "/alerts-center",
      targetId: readString(row, ["targetId", "alertKey", "id"]) || undefined,
      sectionId: readString(row, ["sectionId"]) || undefined,
      targetPageKey:
        readString(row, ["targetPageKey"]) ||
        inferPageKeyFromHref(readString(row, ["href", "destinationHref"]) || undefined),
      issueType: normalizeIssueType(alertType),
      reason: `${alertType || "Alert"} • ${actionWord}${ageHours > 0 ? ` • ${roundNumber(ageHours)}h old` : ""}.`
    });
  }
  return items;
}

function deriveLinkageFocusItems(tablePreviews: CopilotTablePreview[]) {
  const items: CopilotFocusItem[] = [];
  const mapping: Array<{ key: string; linkage: string }> = [
    { key: "missing-rig", linkage: "Rig" },
    { key: "missing-project", linkage: "Project" },
    { key: "missing-maintenance", linkage: "Maintenance" }
  ];

  for (const entry of mapping) {
    const preview = tablePreviews.find((candidate) => candidate.key === entry.key);
    for (const row of preview?.rows || []) {
      const reference = readString(row, ["reference", "label", "record"]);
      const amount = readNumber(row, ["amount"]);
      if (!reference) {
        continue;
      }
      const numericAmount = amount ?? 0;
      const severity = numericAmount >= 50000 ? "HIGH" : numericAmount >= 10000 ? "MEDIUM" : "LOW";
      items.push({
        id: readString(row, ["rowId", "id"]) || `${entry.key}-${normalizeKey(reference)}`,
        label: reference,
        severity,
        amount,
        href: readString(row, ["href"]) || "/data-quality/linkage-center",
        targetId: readString(row, ["targetId", "rowId", "id"]) || undefined,
        sectionId: readString(row, ["sectionId"]) || linkageSectionIdForType(entry.linkage),
        targetPageKey: "data-quality-linkage-center",
        issueType: normalizeIssueType(`${entry.linkage} linkage`),
        confidence: readConfidence(row, ["confidence", "suggestionConfidence"]),
        reason: `${entry.linkage} linkage is missing and should be corrected for reporting consistency.`
      });
    }
  }

  return items;
}

function deriveBudgetFocusItems(tablePreviews: CopilotTablePreview[]) {
  const items: CopilotFocusItem[] = [];
  const previews = tablePreviews.filter(
    (preview) => preview.key === "rig-budget-vs-actual" || preview.key === "project-budget-vs-actual"
  );

  for (const preview of previews) {
    for (const row of preview.rows) {
      const entity =
        readString(row, ["rig", "project", "entity", "name", "label"]) || readString(row, ["id"]);
      const status = readString(row, ["status", "statusLabel"]) || "On Track";
      const amount = readNumber(row, ["recognizedSpend", "amount"]);
      const percentUsed = readNumber(row, ["percentUsed"]);
      if (!entity) {
        continue;
      }
      const severity =
        /overspent/i.test(status)
          ? "CRITICAL"
          : /critical/i.test(status)
            ? "HIGH"
            : /watch/i.test(status)
              ? "MEDIUM"
              : /no budget/i.test(status)
                ? "MEDIUM"
                : "LOW";
      if (severity === "LOW") {
        continue;
      }
      items.push({
        id: readString(row, ["id", "entityId"]) || `budget-${normalizeKey(entity)}`,
        label: entity,
        severity,
        amount,
        href: readString(row, ["href"]) || "/cost-tracking/budget-vs-actual",
        targetId: readString(row, ["targetId", "id", "entityId"]) || undefined,
        sectionId: readString(row, ["sectionId"]) || inferBudgetSectionId(row),
        targetPageKey: "budget-vs-actual",
        issueType: normalizeIssueType(status),
        reason: `${status}${percentUsed !== null ? ` (${roundNumber(percentUsed)}% used)` : ""} requires attention.`
      });
    }
  }

  return items;
}

function deriveExpensesFocusItems(tablePreviews: CopilotTablePreview[]) {
  const items: CopilotFocusItem[] = [];
  const categoryPreview = tablePreviews.find((preview) => preview.key === "expenses-by-category");
  const projectPreview = tablePreviews.find((preview) => preview.key === "expenses-by-project");
  const rigPreview = tablePreviews.find((preview) => preview.key === "expenses-by-rig");
  const approvalSensitivePreview = tablePreviews.find(
    (preview) => preview.key === "expense-approval-sensitive"
  );
  const missingLinkagePreview = tablePreviews.find(
    (preview) => preview.key === "expense-missing-linkage"
  );

  const topCategory = categoryPreview?.rows[0];
  if (topCategory) {
    const categoryName = readString(topCategory, ["name", "category", "label"]);
    const amount = readNumber(topCategory, ["amount", "total", "recognizedSpend"]);
    const share = readNumber(topCategory, ["share", "percent", "percentUsed"]);
    if (categoryName) {
      items.push({
        id: readString(topCategory, ["id"]) || `expense-category-${normalizeKey(categoryName)}`,
        label: `Cost Driver • ${categoryName}`,
        severity: (share ?? 0) >= 45 ? "HIGH" : "MEDIUM",
        amount,
        href: readString(topCategory, ["href"]) || "/expenses",
        sectionId: readString(topCategory, ["sectionId"]) || "expenses-category-driver-section",
        targetPageKey: "expenses",
        issueType: "COST_DRIVER",
        reason:
          amount !== null
            ? `${categoryName} is currently the largest visible category at ${formatAsMoney(amount)}.`
            : `${categoryName} is the largest visible category in scope.`
      });
    }
  }

  const topProject = projectPreview?.rows[0];
  if (topProject) {
    const projectName = readString(topProject, ["name", "project", "label"]);
    const amount = readNumber(topProject, ["amount", "total", "recognizedSpend"]);
    const share = readNumber(topProject, ["share", "percent", "percentUsed"]);
    if (projectName) {
      items.push({
        id: readString(topProject, ["id"]) || `expense-project-${normalizeKey(projectName)}`,
        label: `Highest Cost Project • ${projectName}`,
        severity: (share ?? 0) >= 40 ? "HIGH" : "MEDIUM",
        amount,
        href: readString(topProject, ["href"]) || "/expenses",
        sectionId: readString(topProject, ["sectionId"]) || "expenses-project-driver-section",
        targetPageKey: "expenses",
        issueType: "PROJECT_SPEND",
        reason:
          amount !== null
            ? `${projectName} is the top project spend driver at ${formatAsMoney(amount)}.`
            : `${projectName} is the top project spend driver in scope.`
      });
    }
  }

  const topRig = rigPreview?.rows[0];
  if (topRig) {
    const rigName = readString(topRig, ["name", "rig", "label"]);
    const amount = readNumber(topRig, ["amount", "total", "recognizedSpend"]);
    const share = readNumber(topRig, ["share", "percent", "percentUsed"]);
    if (rigName) {
      const isUnassigned = /unassigned/i.test(rigName);
      items.push({
        id: readString(topRig, ["id"]) || `expense-rig-${normalizeKey(rigName)}`,
        label: `Highest Cost Rig • ${rigName}`,
        severity: isUnassigned ? "HIGH" : (share ?? 0) >= 35 ? "HIGH" : "MEDIUM",
        amount,
        href: readString(topRig, ["href"]) || "/expenses",
        sectionId: readString(topRig, ["sectionId"]) || "expenses-rig-driver-section",
        targetPageKey: "expenses",
        issueType: isUnassigned ? "LINKAGE" : "RIG_SPEND",
        reason: isUnassigned
          ? `Rig linkage is missing for ${formatAsMoney(amount || 0)} of spend and should be corrected.`
          : amount !== null
            ? `${rigName} currently carries ${formatAsMoney(amount)} of visible spend.`
            : `${rigName} currently leads rig-linked spend in this scope.`
      });
    }
  }

  for (const row of approvalSensitivePreview?.rows || []) {
    const id = readString(row, ["id"]);
    const amount = readNumber(row, ["amount", "total"]);
    const project = readString(row, ["project"]);
    const category = readString(row, ["category"]);
    if (!id) {
      continue;
    }
    items.push({
      id,
      label: `Approval-Sensitive Spend • ${project || category || id}`,
      severity: (amount ?? 0) >= 30000 ? "HIGH" : "MEDIUM",
      amount,
      href: readString(row, ["href"]) || "/expenses",
      targetId: readString(row, ["targetId", "id"]) || id,
      sectionId: readString(row, ["sectionId"]) || "expenses-records-section",
      targetPageKey: "expenses",
      issueType: "APPROVAL_BACKLOG",
      reason: `Submitted expense${amount !== null ? ` of ${formatAsMoney(amount)}` : ""} should be reviewed promptly.`
    });
  }

  for (const row of missingLinkagePreview?.rows || []) {
    const id = readString(row, ["id"]);
    const amount = readNumber(row, ["amount", "total"]);
    const missing = readString(row, ["missing", "issue", "linkage"]);
    const category = readString(row, ["category", "label"]);
    if (!id) {
      continue;
    }
    items.push({
      id: `linkage-${id}`,
      label: `Missing Linkage • ${category || id}`,
      severity: (amount ?? 0) >= 20000 ? "HIGH" : "MEDIUM",
      amount,
      href: readString(row, ["href"]) || "/expenses",
      targetId: readString(row, ["targetId", "id"]) || id,
      sectionId: readString(row, ["sectionId"]) || "expenses-records-section",
      targetPageKey: "expenses",
      issueType: "LINKAGE",
      reason: `${missing || "Rig/Project linkage"} is missing and can weaken expense reporting quality.`
    });
  }

  return items;
}

function deriveMaintenanceFocusItems(tablePreviews: CopilotTablePreview[]) {
  const items: CopilotFocusItem[] = [];
  const requestsPreview = tablePreviews.find((preview) => preview.key === "maintenance-requests");
  for (const row of requestsPreview?.rows || []) {
    const requestCode = readString(row, ["request", "requestCode", "label"]) || readString(row, ["id"]);
    const rig = readString(row, ["rig"]);
    const status = readString(row, ["status"]) || "";
    const urgency = readString(row, ["urgency"]) || "";
    const downtimeHours = readNumber(row, ["downtimeHours", "downtime"]);
    const partsCost = readNumber(row, ["partsCost", "amount"]);
    const pendingHours = readNumber(row, ["pendingHours", "ageHours", "hoursPending"]);
    if (!requestCode) {
      continue;
    }

    const waitingApproval = /submitted|under_review/i.test(status);
    const waitingTooLong = waitingApproval && pendingHours !== null && pendingHours >= 48;
    const unresolvedCritical = /critical/i.test(urgency) && !/completed|denied/i.test(status);
    const severity = unresolvedCritical
      ? "CRITICAL"
      : waitingTooLong
        ? pendingHours >= 72
          ? "CRITICAL"
          : "HIGH"
        : waitingApproval || /waiting_for_parts|in_repair/i.test(status)
        ? "HIGH"
        : "MEDIUM";

    items.push({
      id: readString(row, ["id"]) || `maintenance-${normalizeKey(requestCode)}`,
      label: `${requestCode}${rig ? ` • ${rig}` : ""}`,
      severity,
      amount: partsCost,
      href: readString(row, ["href"]) || "/maintenance",
      targetId: readString(row, ["targetId", "id"]) || undefined,
      sectionId: readString(row, ["sectionId"]) || "maintenance-log-section",
      targetPageKey: readString(row, ["targetPageKey"]) || "maintenance",
      issueType: waitingApproval ? "APPROVAL_BACKLOG" : "MAINTENANCE",
      reason: buildMaintenanceReason({
        status,
        urgency,
        downtimeHours,
        partsCost,
        pendingHours
      })
    });
  }
  return items;
}

function deriveRigsFocusItems(tablePreviews: CopilotTablePreview[]) {
  const items: CopilotFocusItem[] = [];
  const conditionPreview = tablePreviews.find((preview) => preview.key === "rig-condition");
  const revenuePreview = tablePreviews.find((preview) => preview.key === "rig-revenue");
  const expensePreview = tablePreviews.find((preview) => preview.key === "rig-expenses");
  const utilizationPreview = tablePreviews.find((preview) => preview.key === "rig-utilization");

  for (const row of conditionPreview?.rows || []) {
    const rig = readString(row, ["rig", "name", "label"]);
    const condition = readString(row, ["condition"]) || "";
    const score = readNumber(row, ["score", "conditionScore"]);
    if (!rig) {
      continue;
    }
    const isCritical = /critical|poor/i.test(condition) || (score !== null && score < 45);
    if (!isCritical) {
      continue;
    }
    items.push({
      id: readString(row, ["id"]) || `rig-condition-${normalizeKey(rig)}`,
      label: `Rig condition risk • ${rig}`,
      severity: /critical/i.test(condition) || (score !== null && score < 30) ? "CRITICAL" : "HIGH",
      amount: null,
      href: readString(row, ["href"]) || "/rigs",
      targetId: readString(row, ["targetId", "id"]) || undefined,
      sectionId: readString(row, ["sectionId"]) || "rig-registry-section",
      targetPageKey: readString(row, ["targetPageKey"]) || "rigs",
      issueType: "RIG_RISK",
      reason: `${condition || "Poor"} condition${score !== null ? ` (score ${roundNumber(score)})` : ""} needs manager review.`
    });
  }

  const topRevenue = revenuePreview?.rows[0];
  if (topRevenue) {
    const rig = readString(topRevenue, ["rig", "name", "label"]);
    const revenue = readNumber(topRevenue, ["revenue", "amount", "total"]);
    if (rig) {
      items.push({
        id: readString(topRevenue, ["id"]) || `rig-revenue-${normalizeKey(rig)}`,
        label: `Top revenue rig • ${rig}`,
        severity: "MEDIUM",
        amount: revenue,
        href: readString(topRevenue, ["href"]) || "/rigs",
        targetId: readString(topRevenue, ["targetId", "id"]) || undefined,
        sectionId: readString(topRevenue, ["sectionId"]) || "rig-registry-section",
        targetPageKey: readString(topRevenue, ["targetPageKey"]) || "rigs",
        issueType: "REVENUE_OPPORTUNITY",
        reason:
          revenue !== null
            ? `${rig} currently leads recognized revenue at ${formatAsMoney(revenue)}.`
            : `${rig} currently leads revenue contribution in scope.`
      });
    }
  }

  const topExpense = expensePreview?.rows[0];
  if (topExpense) {
    const rig = readString(topExpense, ["rig", "name", "label"]);
    const expense = readNumber(topExpense, ["expense", "amount", "total"]);
    if (rig) {
      items.push({
        id: readString(topExpense, ["id"]) || `rig-expense-${normalizeKey(rig)}`,
        label: `Highest expense rig • ${rig}`,
        severity: expense !== null && expense >= 50000 ? "HIGH" : "MEDIUM",
        amount: expense,
        href: readString(topExpense, ["href"]) || "/rigs",
        targetId: readString(topExpense, ["targetId", "id"]) || undefined,
        sectionId: readString(topExpense, ["sectionId"]) || "rig-registry-section",
        targetPageKey: readString(topExpense, ["targetPageKey"]) || "rigs",
        issueType: "RIG_SPEND",
        reason:
          expense !== null
            ? `${rig} currently carries ${formatAsMoney(expense)} in recognized cost.`
            : `${rig} currently carries the highest visible expense load.`
      });
    }
  }

  for (const row of utilizationPreview?.rows || []) {
    const rig = readString(row, ["rig", "name", "label"]);
    const utilization = readNumber(row, ["utilization", "utilizationPercent"]);
    const status = readString(row, ["status"]);
    if (!rig) {
      continue;
    }
    const underutilized = (utilization !== null && utilization < 35) || /idle/i.test(status || "");
    if (!underutilized) {
      continue;
    }
    items.push({
      id: readString(row, ["id"]) || `rig-utilization-${normalizeKey(rig)}`,
      label: `Underutilized rig • ${rig}`,
      severity: /idle/i.test(status || "") ? "HIGH" : "MEDIUM",
      amount: null,
      href: readString(row, ["href"]) || "/rigs",
      targetId: readString(row, ["targetId", "id"]) || undefined,
      sectionId: readString(row, ["sectionId"]) || "rig-registry-section",
      targetPageKey: readString(row, ["targetPageKey"]) || "rigs",
      issueType: "RIG_UTILIZATION",
      reason: `${rig} is underutilized${utilization !== null ? ` (${roundNumber(utilization)}% utilization)` : ""} and may be reassigned.`
    });
  }

  return items;
}

function buildMaintenanceReason({
  status,
  urgency,
  downtimeHours,
  partsCost,
  pendingHours
}: {
  status: string;
  urgency: string;
  downtimeHours: number | null;
  partsCost: number | null;
  pendingHours: number | null;
}) {
  const parts: string[] = [];
  if (urgency) {
    parts.push(`${urgency} urgency`);
  }
  if (status) {
    parts.push(status.replace(/_/g, " ").toLowerCase());
  }
  if (downtimeHours !== null && downtimeHours > 0) {
    parts.push(`${roundNumber(downtimeHours)}h estimated downtime`);
  }
  if (pendingHours !== null && pendingHours > 0 && /submitted|under_review/i.test(status)) {
    parts.push(`${roundNumber(pendingHours)}h waiting approval`);
  }
  if (partsCost !== null && partsCost > 0) {
    parts.push(`parts ${formatAsMoney(partsCost)}`);
  }
  return parts.length > 0 ? `${parts.join(" • ")}.` : "Maintenance item requires review.";
}

function deriveMetricFocusItems(context: CopilotPageContext) {
  const items: CopilotFocusItem[] = [];
  const topRevenueRig = findMetricString(context.summaryMetrics, [/top revenue rig/i, /highest revenue rig/i]);
  const topRevenueRigAmount = findMetricValue(context.summaryMetrics, [/top revenue rig amount/i, /highest revenue rig amount/i]);
  if (topRevenueRig && topRevenueRig !== "N/A") {
    items.push({
      id: `metric-top-revenue-rig-${normalizeKey(topRevenueRig)}`,
      label: `Top revenue rig • ${topRevenueRig}`,
      reason:
        topRevenueRigAmount > 0
          ? `${topRevenueRig} currently leads recognized revenue at ${formatAsMoney(topRevenueRigAmount)}.`
          : `${topRevenueRig} currently leads recognized revenue in scope.`,
      severity: "MEDIUM",
      amount: topRevenueRigAmount || null,
      issueType: "REVENUE_OPPORTUNITY"
    });
  }

  const topRevenueProject = findMetricString(context.summaryMetrics, [/top revenue project/i]);
  const topRevenueProjectAmount = findMetricValue(context.summaryMetrics, [/top revenue project amount/i]);
  if (topRevenueProject && topRevenueProject !== "N/A") {
    items.push({
      id: `metric-top-revenue-project-${normalizeKey(topRevenueProject)}`,
      label: `Top revenue project • ${topRevenueProject}`,
      reason:
        topRevenueProjectAmount > 0
          ? `${topRevenueProject} currently leads recognized project revenue at ${formatAsMoney(topRevenueProjectAmount)}.`
          : `${topRevenueProject} currently leads recognized project revenue in scope.`,
      severity: "MEDIUM",
      amount: topRevenueProjectAmount || null,
      issueType: "REVENUE_OPPORTUNITY"
    });
  }

  const topRevenueClient = findMetricString(context.summaryMetrics, [/top revenue client/i]);
  const topRevenueClientAmount = findMetricValue(context.summaryMetrics, [/top revenue client amount/i]);
  if (topRevenueClient && topRevenueClient !== "N/A") {
    items.push({
      id: `metric-top-revenue-client-${normalizeKey(topRevenueClient)}`,
      label: `Top revenue client • ${topRevenueClient}`,
      reason:
        topRevenueClientAmount > 0
          ? `${topRevenueClient} is currently the strongest client revenue contributor at ${formatAsMoney(topRevenueClientAmount)}.`
          : `${topRevenueClient} is currently the strongest client revenue contributor in scope.`,
      severity: "MEDIUM",
      amount: topRevenueClientAmount || null,
      issueType: "REVENUE_OPPORTUNITY"
    });
  }

  const highestExpenseRig = findMetricString(context.summaryMetrics, [/highest expense rig/i, /highest cost rig/i]);
  const highestExpenseRigAmount = findMetricValue(context.summaryMetrics, [/highest expense rig amount/i, /highest cost rig amount/i]);
  if (highestExpenseRig && highestExpenseRig !== "N/A") {
    items.push({
      id: `metric-highest-expense-rig-${normalizeKey(highestExpenseRig)}`,
      label: `Highest expense rig • ${highestExpenseRig}`,
      reason:
        highestExpenseRigAmount > 0
          ? `${highestExpenseRig} currently carries ${formatAsMoney(highestExpenseRigAmount)} of recognized spend.`
          : `${highestExpenseRig} currently carries the highest recognized spend in scope.`,
      severity: highestExpenseRigAmount >= 50000 ? "HIGH" : "MEDIUM",
      amount: highestExpenseRigAmount || null,
      issueType: "RIG_SPEND"
    });
  }

  const profitabilityIssue = findMetricString(context.summaryMetrics, [/profitability concern/i, /biggest profitability issue/i]);
  const profitabilityAmount = findMetricValue(context.summaryMetrics, [/profitability concern amount/i, /profitability impact/i]);
  if (profitabilityIssue && profitabilityIssue !== "N/A") {
    items.push({
      id: `metric-profitability-${normalizeKey(profitabilityIssue)}`,
      label: `Profitability concern • ${profitabilityIssue}`,
      reason:
        profitabilityAmount !== 0
          ? `${profitabilityIssue} has a current profitability gap of ${formatAsMoney(Math.abs(profitabilityAmount))}.`
          : `${profitabilityIssue} is the current profitability concern to review.`,
      severity: profitabilityAmount < 0 ? "HIGH" : "MEDIUM",
      amount: Math.abs(profitabilityAmount) || null,
      issueType: "PROFITABILITY"
    });
  }

  const decliningClient = findMetricString(
    context.summaryMetrics,
    [/declining profitability client/i, /lowest profit client/i]
  );
  const decliningClientAmount = findMetricValue(
    context.summaryMetrics,
    [/declining profitability client amount/i, /lowest profit client amount/i]
  );
  if (decliningClient && decliningClient !== "N/A") {
    items.push({
      id: `metric-declining-client-${normalizeKey(decliningClient)}`,
      label: `Client profitability concern • ${decliningClient}`,
      reason:
        decliningClientAmount < 0
          ? `${decliningClient} is currently below break-even (${formatAsMoney(decliningClientAmount)}).`
          : `${decliningClient} is currently the weakest profitability client in scope.`,
      severity: decliningClientAmount < 0 ? "HIGH" : "MEDIUM",
      amount: Math.abs(decliningClientAmount) || null,
      issueType: "PROFITABILITY"
    });
  }

  const revenueAttributionGapAmount = findMetricValue(
    context.summaryMetrics,
    [/missing revenue rig attribution amount/i, /revenue missing rig attribution amount/i]
  );
  if (revenueAttributionGapAmount > 0) {
    items.push({
      id: "metric-revenue-attribution-gap",
      label: "Revenue attribution gap",
      reason: `${formatAsMoney(
        revenueAttributionGapAmount
      )} in recognized revenue is missing rig attribution and can weaken rig-level performance decisions.`,
      severity: "HIGH",
      amount: revenueAttributionGapAmount,
      issueType: "LINKAGE"
    });
  }

  return items;
}

function deriveGenericFocusItems(context: CopilotPageContext) {
  const items: CopilotFocusItem[] = [];
  for (const [index, item] of (context.selectedItems || []).entries()) {
    items.push({
      id: item.id,
      label: item.label || item.id,
      severity: "MEDIUM",
      reason: "Selected item is currently in focus.",
      href: undefined,
      targetId: item.id,
      targetPageKey: context.pageKey,
      issueType: normalizeIssueType(item.type)
    });
    if (index >= 4) {
      break;
    }
  }
  return items;
}

function deriveSummary({
  context,
  focusItems
}: {
  context: CopilotPageContext;
  focusItems: CopilotFocusItem[];
}) {
  const scoped = countActiveFilters(context.filters) > 0;
  const top = focusItems[0];
  const sourceCount = context.sourcePageKeys?.length || 0;

  if (context.pageKey === "atlas-related" || context.pageKey === "atlas-whole-app") {
    const critical = focusItems.filter((item) => item.severity === "CRITICAL").length;
    const high = focusItems.filter((item) => item.severity === "HIGH").length;
    const topLabel = top?.label || "No immediate high-priority target";
    if (critical + high > 0) {
      return `Atlas ${context.pageKey === "atlas-whole-app" ? "whole-app" : "related-data"} view: ${critical} critical and ${high} high-priority items across ${sourceCount || 1} page context(s). Top focus: ${topLabel}.`;
    }
    return `Atlas ${context.pageKey === "atlas-whole-app" ? "whole-app" : "related-data"} view is stable across ${sourceCount || 1} page context(s), with no critical concentration detected.`;
  }

  if (context.pageKey === "executive-overview") {
    const overspent = findMetricValue(context.summaryMetrics, [/overspent/i]);
    const critical = findMetricValue(context.summaryMetrics, [/critical/i]);
    const pending = findMetricValue(context.summaryMetrics, [/pending approvals?/i]);
    if (overspent > 0 || critical > 0) {
      return `Risk pressure is elevated with ${overspent} overspent and ${critical} critical budget bucket(s), plus ${pending} pending approvals.`;
    }
    return scoped
      ? "Executive metrics are stable in the current filtered scope."
      : "Executive metrics are currently stable across global scope.";
  }

  if (context.pageKey === "alerts-center") {
    const critical = findMetricValue(context.summaryMetrics, [/critical alerts?/i, /critical/i]);
    const unresolved = findMetricValue(context.summaryMetrics, [/unresolved/i, /open/i]);
    return critical > 0
      ? `${critical} critical alerts require attention in ${unresolved} unresolved items.`
      : `${unresolved} unresolved alerts remain; no critical concentration detected.`;
  }

  if (context.pageKey === "data-quality-linkage-center") {
    const costAffected = findMetricValue(context.summaryMetrics, [/cost affected/i]);
    const linkageCount = findMetricValue(context.summaryMetrics, [/linkage/i]);
    return `${linkageCount} linkage record(s) can impact ${formatAsMoney(costAffected)} recognized cost reporting.`;
  }

  if (context.pageKey === "budget-vs-actual") {
    const overspent = findMetricValue(context.summaryMetrics, [/overspent/i]);
    const critical = findMetricValue(context.summaryMetrics, [/critical/i]);
    const watch = findMetricValue(context.summaryMetrics, [/watch/i]);
    const noBudget = findMetricValue(context.summaryMetrics, [/no budget/i]);
    return `Budget status: ${overspent} overspent, ${critical} critical, ${watch} watch, ${noBudget} no-budget bucket(s).`;
  }

  if (context.pageKey === "expenses") {
    const total = findMetricValue(context.summaryMetrics, [/total expenses/i, /totalExpenses/i]);
    const recognized = findMetricValue(context.summaryMetrics, [
      /recognized expenses/i,
      /recognizedExpenses/i
    ]);
    const submitted = findMetricValue(context.summaryMetrics, [/submitted expenses/i, /submittedExpenses/i]);
    const missingRig = findMetricValue(context.summaryMetrics, [/missing rig linkage/i, /missingRigLinkage/i]);
    const missingProject = findMetricValue(
      context.summaryMetrics,
      [/missing project linkage/i, /missingProjectLinkage/i]
    );
    const topCategory = findMetricString(context.summaryMetrics, [/largest category/i, /biggest category/i]);
    const topProject = findMetricString(context.summaryMetrics, [/highest cost project/i]);
    const topRig = findMetricString(context.summaryMetrics, [/highest cost rig/i]);
    if (total <= 0) {
      return "No expense spend is visible in the current scope yet.";
    }
    const details = [
      `Visible spend is ${formatAsMoney(total)} (${formatAsMoney(recognized)} recognized).`,
      topCategory && topCategory !== "N/A" ? `Largest category is ${topCategory}.` : null,
      topProject && topProject !== "N/A" ? `Highest-cost project is ${topProject}.` : null,
      topRig && topRig !== "N/A" ? `Highest-cost rig is ${topRig}.` : null,
      submitted > 0 ? `${submitted} expense(s) are approval-sensitive.` : null,
      missingRig + missingProject > 0 ? `${missingRig + missingProject} record(s) need linkage cleanup.` : null
    ].filter(Boolean);
    return details.join(" ");
  }

  if (context.pageKey === "rigs") {
    const active = findMetricValue(context.summaryMetrics, [/active/i]);
    const idle = findMetricValue(context.summaryMetrics, [/idle/i]);
    const poorCondition = findMetricValue(context.summaryMetrics, [/poor.*condition/i, /critical.*condition/i]);
    const topRevenueRig = findMetricString(context.summaryMetrics, [/top revenue rig/i]);
    const highestExpenseRig = findMetricString(context.summaryMetrics, [/highest expense rig/i, /highest cost rig/i]);
    const details = [
      `${active} active rig(s), ${idle} idle rig(s), ${poorCondition} in poor/critical condition.`,
      topRevenueRig && topRevenueRig !== "N/A" ? `Top revenue rig: ${topRevenueRig}.` : null,
      highestExpenseRig && highestExpenseRig !== "N/A" ? `Highest expense rig: ${highestExpenseRig}.` : null
    ].filter(Boolean);
    return details.join(" ");
  }

  if (context.pageKey === "drilling-reports") {
    const reports = findMetricValue(context.summaryMetrics, [/reports?/i]);
    const pending = findMetricValue(context.summaryMetrics, [/pending approvals?/i, /submitted/i]);
    const meters = findMetricValue(context.summaryMetrics, [/meters/i]);
    return `Drilling scope: ${reports} report(s), ${roundNumber(meters)} meters, ${pending} awaiting approval.`;
  }

  if (context.pageKey === "breakdowns") {
    const critical = findMetricValue(context.summaryMetrics, [/critical/i]);
    const open = findMetricValue(context.summaryMetrics, [/open|active/i]);
    const downtime = findMetricValue(context.summaryMetrics, [/downtime/i]);
    return `Breakdown pressure: ${critical} critical, ${open} open, ${roundNumber(downtime)} estimated downtime hours.`;
  }

  if (context.pageKey.startsWith("inventory")) {
    const lowStock = findMetricValue(context.summaryMetrics, [/low stock/i]);
    const outOfStock = findMetricValue(context.summaryMetrics, [/out of stock/i]);
    const issues = findMetricValue(context.summaryMetrics, [/issues?/i]);
    return `Inventory status: ${outOfStock} out-of-stock, ${lowStock} low-stock, ${issues} quality issue(s) in current scope.`;
  }

  if (context.pageKey === "maintenance") {
    const submitted = findMetricValue(context.summaryMetrics, [/submitted/i]);
    const waitingParts = findMetricValue(context.summaryMetrics, [/waiting.*parts/i]);
    const critical = findMetricValue(context.summaryMetrics, [/critical/i]);
    const oldestHours = findMetricValue(context.summaryMetrics, [/oldest pending hours/i]);
    return `Maintenance workload: ${submitted} submitted, ${waitingParts} waiting for parts, ${critical} critical urgency item(s)${oldestHours > 0 ? `, oldest pending ~${roundNumber(oldestHours)}h` : ""}.`;
  }

  if (context.pageKey === "profit") {
    const profit = findMetricValue(context.summaryMetrics, [/profit/i]);
    const margin = findMetricValue(context.summaryMetrics, [/margin/i]);
    const lowMargin = findMetricValue(context.summaryMetrics, [/low margin/i]);
    return `Profit scope: ${formatAsMoney(profit)} total profit, ${roundNumber(margin)}% margin, ${lowMargin} low-margin contributor(s).`;
  }

  if (context.pageKey === "forecasting") {
    const baseline = findMetricValue(context.summaryMetrics, [/baseline.*30 day/i]);
    const simulated = findMetricValue(context.summaryMetrics, [/simulated.*30 day/i]);
    const delta = findMetricValue(context.summaryMetrics, [/delta/i]);
    return `Forecast outlook: baseline ${formatAsMoney(baseline)}, simulated ${formatAsMoney(simulated)}, delta ${formatAsMoney(delta)}.`;
  }

  return top
    ? `Top focus in current scope: ${top.label}.`
    : "No high-priority focus items were detected in the current scope.";
}

function deriveKeyInsights({
  context,
  focusItems
}: {
  context: CopilotPageContext;
  focusItems: CopilotFocusItem[];
}) {
  const insights: string[] = [];

  const activeFilters = countActiveFilters(context.filters);
  if (activeFilters > 0) {
    insights.push(`Current view is scoped by ${activeFilters} active filter(s), so totals are not global.`);
  }

  const pageInsights = derivePageSpecificInsights({ context, focusItems });
  insights.push(...pageInsights);

  const pendingApprovals = findMetricValue(context.summaryMetrics, [/pending approvals?/i, /pending/i]);
  if (pendingApprovals > 0) {
    insights.push(`${pendingApprovals} pending approval item(s) still need manager action.`);
  }

  const overspentCount = findMetricValue(context.summaryMetrics, [/overspent/i]);
  if (overspentCount > 0) {
    insights.push(`${overspentCount} budget bucket(s) are overspent and need immediate containment.`);
  }

  const linkageCount = findMetricValue(context.summaryMetrics, [/missing.*linkage/i, /needs linkage/i]);
  if (linkageCount > 0) {
    insights.push(`${linkageCount} record(s) still need rig/project/maintenance linkage.`);
  }

  if (focusItems.length > 0) {
    const top = focusItems[0];
    insights.push(`Top recommended focus: ${top.label} — ${top.reason}`);
  }

  const sessionFocusLabel = context.sessionContext?.currentFocusTarget?.label;
  if (sessionFocusLabel) {
    insights.push(`Continuing from your current focus target: ${sessionFocusLabel}.`);
  }
  const recentSuggestedLabel = context.sessionContext?.recentSuggestedFocus?.[0]?.label;
  if (recentSuggestedLabel && recentSuggestedLabel !== sessionFocusLabel) {
    insights.push(`Recent cross-page focus to keep in mind: ${recentSuggestedLabel}.`);
  }

  const topMetric = resolveLargestMetric(context.summaryMetrics);
  if (topMetric) {
    insights.push(`Largest tracked metric in view: ${topMetric.label} (${formatMetricValue(topMetric.value)}).`);
  }

  if (insights.length === 0) {
    insights.push("No critical outliers detected from the currently provided page context.");
  }

  return dedupeText(insights).slice(0, 6);
}

function derivePageSpecificInsights({
  context,
  focusItems
}: {
  context: CopilotPageContext;
  focusItems: CopilotFocusItem[];
}) {
  if (context.pageKey === "atlas-related" || context.pageKey === "atlas-whole-app") {
    const groupedByType = buildIssueTypeCounts(focusItems);
    const topTypes = groupedByType
      .slice(0, 3)
      .map((entry) => `${entry.type.toLowerCase()} (${entry.count})`)
      .join(", ");
    return [
      context.pageKey === "atlas-whole-app"
        ? "Atlas whole-app mode is combining cross-module signals for manager prioritization."
        : "Atlas related-data mode is combining the current module with directly related signals.",
      topTypes
        ? `Dominant cross-page issue groups: ${topTypes}.`
        : "No dominant cross-page issue concentration is currently detected.",
      focusItems[0]
        ? `Most actionable cross-page target right now: ${focusItems[0].label}.`
        : "No high-impact cross-page target is currently surfaced."
    ];
  }

  if (context.pageKey === "executive-overview") {
    const profit = findMetricValue(context.summaryMetrics, [/^profit$/i, /\bprofit\b/i]);
    const critical = findMetricValue(context.summaryMetrics, [/critical/i]);
    const overspent = findMetricValue(context.summaryMetrics, [/overspent/i]);
    const topRevenueRig = findMetricString(context.summaryMetrics, [/top revenue rig/i]);
    const topRevenueProject = findMetricString(context.summaryMetrics, [/top revenue project/i]);
    const topRevenueClient = findMetricString(context.summaryMetrics, [/top revenue client/i]);
    const profitabilityConcern = findMetricString(context.summaryMetrics, [/profitability concern/i, /biggest profitability issue/i]);
    const decliningClient = findMetricString(
      context.summaryMetrics,
      [/declining profitability client/i, /lowest profit client/i]
    );
    const drillingPending = findMetricValue(
      context.summaryMetrics,
      [/incomplete drilling reports/i, /drilling reports pending/i]
    );
    const missingRevenueRigAttribution = findMetricValue(
      context.summaryMetrics,
      [/missing revenue rig attribution/i, /revenue missing rig attribution/i]
    );
    const insights = [
      overspent > 0 || critical > 0
        ? `Executive risk pressure is elevated: ${overspent} overspent and ${critical} critical buckets.`
        : "Executive risk pressure is currently stable."
    ];
    if (profit < 0) {
      insights.push("Profit is negative in the current scope and needs immediate spend/revenue review.");
    }
    if (focusItems.length > 0) {
      insights.push(`Operational hotspot: ${focusItems[0].label}.`);
    }
    if (topRevenueRig && topRevenueRig !== "N/A") {
      insights.push(`Best-performing rig in scope: ${topRevenueRig}.`);
    }
    if (topRevenueProject && topRevenueProject !== "N/A") {
      insights.push(`Best-performing project in scope: ${topRevenueProject}.`);
    }
    if (topRevenueClient && topRevenueClient !== "N/A") {
      insights.push(`Best-performing client in scope: ${topRevenueClient}.`);
    }
    if (profitabilityConcern && profitabilityConcern !== "N/A") {
      insights.push(`Primary profitability concern: ${profitabilityConcern}.`);
    }
    if (decliningClient && decliningClient !== "N/A") {
      insights.push(`Client profitability needs review: ${decliningClient}.`);
    }
    if (drillingPending > 0) {
      insights.push(
        `${drillingPending} drilling report(s) are still pending and can delay daily operational clarity.`
      );
    }
    if (missingRevenueRigAttribution > 0) {
      insights.push(
        `${formatAsMoney(
          missingRevenueRigAttribution
        )} revenue currently lacks rig attribution and should be linked for accurate rig performance reporting.`
      );
    }
    return insights;
  }

  if (context.pageKey === "alerts-center") {
    const critical = findMetricValue(context.summaryMetrics, [/critical alerts?/i, /critical/i]);
    const warning = findMetricValue(context.summaryMetrics, [/warning alerts?/i, /warning/i]);
    const unresolved = findMetricValue(context.summaryMetrics, [/unresolved/i, /open/i]);
    const groupedByType = buildIssueTypeCounts(focusItems);
    const staleCount = focusItems.filter((item) => /old|stale|day/i.test(item.reason)).length;
    return [
      `Alerts triage snapshot: ${critical} critical, ${warning} warning, ${unresolved} unresolved.`,
      groupedByType.length > 0
        ? `Primary alert concentrations: ${groupedByType
            .slice(0, 2)
            .map((entry) => `${entry.type.toLowerCase()} (${entry.count})`)
            .join(", ")}.`
        : "No dominant alert category concentration detected.",
      staleCount > 0
        ? `${staleCount} alert(s) are stale by age and should be triaged for resolve/snooze/escalate decisions.`
        : "No stale alert concentration detected.",
      focusItems.length > 0
        ? `Highest-priority alert in view: ${focusItems[0].label}.`
        : "No unresolved alerts detected in the current filtered view."
    ];
  }

  if (context.pageKey === "data-quality-linkage-center") {
    const costAffected = findMetricValue(context.summaryMetrics, [/cost affected/i]);
    const missingRig = findMetricValue(context.summaryMetrics, [/rig linkage/i]);
    const missingProject = findMetricValue(context.summaryMetrics, [/project linkage/i]);
    const missingMaintenance = findMetricValue(context.summaryMetrics, [/maintenance linkage/i]);
    const highValueLowConfidence = focusItems
      .filter((item) => (item.amount ?? 0) >= 50000 && item.confidence === "LOW")
      .length;
    const quickWinCount = focusItems
      .filter((item) => (item.amount ?? 0) < 25000 && item.confidence === "HIGH")
      .length;
    return [
      `Linkage impact: ${missingRig + missingProject + missingMaintenance} record(s) need correction, affecting ${formatAsMoney(costAffected)} recognized cost.`,
      highValueLowConfidence > 0
        ? `${highValueLowConfidence} high-value linkage candidate(s) have low confidence and need manager judgment.`
        : "Highest-value linkage candidates have acceptable confidence for guided review.",
      quickWinCount > 0
        ? `${quickWinCount} lower-value linkage item(s) look like high-confidence quick wins.`
        : "No clear high-confidence quick wins detected yet in current scope.",
      focusItems.length > 0
        ? `Highest-impact linkage candidate: ${focusItems[0].label}.`
        : "No high-impact linkage candidates detected in current scope."
    ];
  }

  if (context.pageKey === "budget-vs-actual") {
    const overspent = findMetricValue(context.summaryMetrics, [/overspent/i]);
    const critical = findMetricValue(context.summaryMetrics, [/critical/i]);
    const watch = findMetricValue(context.summaryMetrics, [/watch/i]);
    const noBudget = findMetricValue(context.summaryMetrics, [/no budget/i]);
    const insights = [
      `Budget pressure: ${overspent} overspent, ${critical} critical, ${watch} watch, ${noBudget} no-budget bucket(s).`,
      focusItems.length > 0
        ? `Most urgent budget item: ${focusItems[0].label}.`
        : "No urgent budget pressure detected in the current filtered scope."
    ];
    if (noBudget > 0) {
      insights.push("No-budget buckets are informational; prioritize overspent and critical buckets first.");
    }
    return insights;
  }

  if (context.pageKey === "expenses") {
    const total = findMetricValue(context.summaryMetrics, [/total expenses/i, /totalExpenses/i]);
    const recognized = findMetricValue(context.summaryMetrics, [
      /recognized expenses/i,
      /recognizedExpenses/i
    ]);
    const submittedCount = findMetricValue(context.summaryMetrics, [/submitted expenses/i, /submittedExpenses/i]);
    const submittedAmount = findMetricValue(
      context.summaryMetrics,
      [/submitted expense amount/i, /submittedExpenseAmount/i]
    );
    const missingRig = findMetricValue(context.summaryMetrics, [/missing rig linkage/i, /missingRigLinkage/i]);
    const missingProject = findMetricValue(
      context.summaryMetrics,
      [/missing project linkage/i, /missingProjectLinkage/i]
    );
    const missingClient = findMetricValue(
      context.summaryMetrics,
      [/missing client linkage/i, /missingClientLinkage/i]
    );
    const missingAmount = findMetricValue(context.summaryMetrics, [/missing linkage amount/i, /missingLinkageAmount/i]);
    const unusualSpikes = findMetricValue(
      context.summaryMetrics,
      [/unusual cost spikes/i, /unusualCostSpikes/i]
    );
    const topCategory = findMetricString(context.summaryMetrics, [/largest category/i, /biggest category/i]);
    const topProject = findMetricString(context.summaryMetrics, [/highest cost project/i]);
    const topRig = findMetricString(context.summaryMetrics, [/highest cost rig/i]);
    const linkageTotal = missingRig + missingProject + missingClient;
    return [
      total > 0
        ? `Expenses in view: ${formatAsMoney(total)} total, with ${formatAsMoney(recognized)} currently recognized.`
        : "No expenses are currently visible in this filter scope.",
      topCategory && topCategory !== "N/A"
        ? `Primary cost driver is ${topCategory}${topProject && topProject !== "N/A" ? `, with ${topProject} as top project spend` : ""}${topRig && topRig !== "N/A" ? ` and ${topRig} as top rig spend` : ""}.`
        : "No dominant cost driver is visible in this scope yet.",
      topCategory && topCategory !== "N/A"
        ? "Cross-check Budget vs Actual for this scope to confirm whether current cost concentration is driving budget pressure."
        : "No budget-pressure cross-check is needed yet from expense concentration alone.",
      submittedCount > 0
        ? `${submittedCount} submitted expense(s) worth ${formatAsMoney(submittedAmount)} may shift totals once decisions land.`
        : "No submitted expense backlog is currently affecting near-term expense visibility.",
      linkageTotal > 0
        ? `${linkageTotal} expense record(s) still need rig/project/client linkage (${formatAsMoney(missingAmount)} affected).`
        : "Rig/project/client linkage looks complete in the currently visible expense records.",
      unusualSpikes > 0
        ? `${unusualSpikes} unusual high-value expense spike(s) should be reviewed for necessity and coding accuracy.`
        : "No unusual expense spike was detected from current visible rows.",
      focusItems.length > 0
        ? `Most actionable expense target: ${focusItems[0].label}.`
        : "No high-severity expense outlier was detected in this scope."
    ];
  }

  if (context.pageKey === "rigs") {
    const topRevenueRig = findMetricString(context.summaryMetrics, [/top revenue rig/i]);
    const highestExpenseRig = findMetricString(context.summaryMetrics, [/highest expense rig/i, /highest cost rig/i]);
    const poorCondition = findMetricValue(context.summaryMetrics, [/poor.*condition/i, /critical.*condition/i]);
    const underutilized = findMetricValue(context.summaryMetrics, [/underutilized/i]);
    const dueMaintenance = findMetricValue(context.summaryMetrics, [/maintenance due/i]);
    return [
      topRevenueRig && topRevenueRig !== "N/A"
        ? `${topRevenueRig} is currently the top revenue rig in this scope.`
        : "No dominant revenue rig is currently visible in this scope.",
      highestExpenseRig && highestExpenseRig !== "N/A"
        ? `${highestExpenseRig} is currently the highest expense rig and should be reviewed against output.`
        : "No high-cost rig concentration is currently visible.",
      poorCondition > 0 || dueMaintenance > 0
        ? `${poorCondition} rig(s) are in poor/critical condition and ${dueMaintenance} are due for maintenance follow-up.`
        : "No immediate rig condition or maintenance due concentration detected.",
      underutilized > 0
        ? `${underutilized} rig(s) appear underutilized and may be candidates for reassignment.`
        : "No significant underutilization concentration detected."
    ];
  }

  if (context.pageKey === "drilling-reports") {
    const reports = findMetricValue(context.summaryMetrics, [/reports?/i]);
    const meters = findMetricValue(context.summaryMetrics, [/meters/i]);
    const pending = findMetricValue(context.summaryMetrics, [/pending approvals?/i, /submitted/i]);
    const rejected = findMetricValue(context.summaryMetrics, [/rejected/i]);
    return [
      `Drilling output: ${reports} report(s) covering ${roundNumber(meters)} meters in current scope.`,
      pending > 0
        ? `${pending} report(s) are waiting for approval decisions.`
        : "No pending drilling approvals in current scope.",
      rejected > 0
        ? `${rejected} rejected report(s) may need correction and resubmission.`
        : "No rejected reports currently blocking throughput.",
      focusItems.length > 0
        ? `Most actionable drilling item: ${focusItems[0].label}.`
        : "No high-priority drilling outliers detected."
    ];
  }

  if (context.pageKey === "breakdowns") {
    const critical = findMetricValue(context.summaryMetrics, [/critical/i]);
    const open = findMetricValue(context.summaryMetrics, [/open|active/i]);
    const downtime = findMetricValue(context.summaryMetrics, [/downtime/i]);
    return [
      `Breakdown load: ${open} open breakdown(s) with ${roundNumber(downtime)} estimated downtime hours.`,
      critical > 0
        ? `${critical} critical breakdown(s) should be triaged first to protect operations.`
        : "No critical breakdown severity concentration detected.",
      focusItems.length > 0
        ? `Top operational risk: ${focusItems[0].label}.`
        : "No urgent breakdown target detected."
    ];
  }

  if (context.pageKey.startsWith("inventory")) {
    const lowStock = findMetricValue(context.summaryMetrics, [/low stock/i]);
    const outOfStock = findMetricValue(context.summaryMetrics, [/out of stock/i]);
    const issues = findMetricValue(context.summaryMetrics, [/issues?/i]);
    const movementCount = findMetricValue(context.summaryMetrics, [/movements?/i]);
    return [
      `Inventory health snapshot: ${outOfStock} out-of-stock, ${lowStock} low-stock, ${issues} data issue(s).`,
      movementCount > 0
        ? `${movementCount} movement record(s) are visible in current scope for traceability checks.`
        : "No movement records visible in current scope.",
      focusItems.length > 0
        ? `Highest-priority inventory target: ${focusItems[0].label}.`
        : "No urgent inventory risk surfaced in current scope."
    ];
  }

  if (context.pageKey === "maintenance") {
    const waitingParts = findMetricValue(context.summaryMetrics, [/waiting.*parts/i]);
    const critical = findMetricValue(context.summaryMetrics, [/critical/i]);
    const partsCost = findMetricValue(context.summaryMetrics, [/parts cost|maintenance cost/i]);
    const oldestPendingHours = findMetricValue(context.summaryMetrics, [/oldest pending hours/i]);
    const repeatedRepairRigs = findMetricValue(context.summaryMetrics, [/repeated repair rigs/i]);
    const topMechanic = findMetricString(context.summaryMetrics, [/highest active mechanic workload/i, /top mechanic workload/i]);
    const submitted = findMetricValue(context.summaryMetrics, [/submitted/i]);
    const underReview = findMetricValue(context.summaryMetrics, [/under review/i]);
    return [
      `Maintenance queue pressure: ${critical} critical urgency request(s), ${waitingParts} waiting for parts.`,
      oldestPendingHours > 0
        ? `Oldest pending maintenance request has been waiting about ${roundNumber(oldestPendingHours)} hour(s).`
        : "No prolonged pending maintenance request is currently visible.",
      partsCost > 0
        ? `Tracked maintenance-linked parts cost in scope is ${formatAsMoney(partsCost)}.`
        : "No maintenance-linked parts cost captured in this scope.",
      repeatedRepairRigs > 0
        ? `${repeatedRepairRigs} rig(s) show repeated repair demand and should be reviewed for root-cause action.`
        : "No repeated-repair rig concentration detected in this scope.",
      topMechanic && topMechanic !== "N/A"
        ? `Highest active mechanic workload is currently on ${topMechanic}.`
        : "Mechanic workload appears balanced in current scope.",
      submitted + underReview > 0
        ? "Operational priority: handle the oldest critical/high urgency work first, then waiting-for-parts items with longest downtime."
        : "No maintenance bottleneck is currently visible.",
      focusItems.length > 0
        ? `Highest-priority maintenance item: ${focusItems[0].label}.`
        : "No urgent maintenance outlier detected."
    ];
  }

  if (context.pageKey === "profit") {
    const profit = findMetricValue(context.summaryMetrics, [/profit/i]);
    const margin = findMetricValue(context.summaryMetrics, [/margin/i]);
    const lowMargin = findMetricValue(context.summaryMetrics, [/low margin/i]);
    return [
      `Profit posture: ${formatAsMoney(profit)} profit at ${roundNumber(margin)}% margin in current scope.`,
      lowMargin > 0
        ? `${lowMargin} rig/project contributor(s) are below margin target thresholds.`
        : "No low-margin concentration detected in current scope.",
      focusItems.length > 0
        ? `Primary profit attention area: ${focusItems[0].label}.`
        : "No urgent profit outlier detected."
    ];
  }

  if (context.pageKey === "forecasting") {
    const baseline = findMetricValue(context.summaryMetrics, [/baseline.*30 day/i]);
    const simulated = findMetricValue(context.summaryMetrics, [/simulated.*30 day/i]);
    const delta = findMetricValue(context.summaryMetrics, [/delta/i]);
    return [
      `Forecast comparison: baseline ${formatAsMoney(baseline)} vs simulated ${formatAsMoney(simulated)} (${formatAsMoney(delta)} delta).`,
      delta < 0
        ? "Current scenario underperforms baseline and may need adjustment."
        : "Current scenario is at or above baseline expectation.",
      focusItems.length > 0
        ? `Most impactful forecast target: ${focusItems[0].label}.`
        : "No urgent forecast variance surfaced."
    ];
  }

  return [];
}

function deriveRecommendedActions({
  context,
  focusItems,
  keyInsights,
  actionRanking,
  roleProfile
}: {
  context: CopilotPageContext;
  focusItems: CopilotFocusItem[];
  keyInsights: string[];
  actionRanking: ContextualCopilotResponsePayload["actionRanking"];
  roleProfile: CopilotRoleProfile;
}) {
  const actions: string[] = [];
  const guidance = buildDecisionGuidance(
    focusItems,
    roleProfile,
    rankFocusItemsForDecisionGuidance
  );

  const roleGuidance = resolveRoleDoNowGuidance(roleProfile, focusItems);
  if (roleGuidance) {
    actions.push(roleGuidance);
  }

  if (guidance.doNow) {
    actions.push(`Do now: ${guidance.doNow}`);
  }
  if (guidance.doNext) {
    actions.push(`Do next: ${guidance.doNext}`);
  }
  if (guidance.canWait) {
    actions.push(`Can wait: ${guidance.canWait}`);
  }

  if (actionRanking.mostUrgent) {
    actions.push(`Most urgent: ${actionRanking.mostUrgent}`);
  }
  if (actionRanking.highestImpact) {
    actions.push(`Highest impact: ${actionRanking.highestImpact}`);
  }
  if (actionRanking.safestQuickWin) {
    actions.push(`Safest quick win: ${actionRanking.safestQuickWin}`);
  }
  if (actionRanking.needsManagerJudgment) {
    actions.push(`Needs manager judgment: ${actionRanking.needsManagerJudgment}`);
  }

  if (context.pageKey === "executive-overview") {
    actions.push("Prioritize overspent/critical budget buckets first, then clear oldest pending approvals.");
    actions.push("Validate missing linkage items that materially affect executive reporting.");
    actions.push("Check high-spend/low-revenue and profitability outliers before approving new discretionary spend.");
    actions.push("Prioritize incomplete drilling report approvals where operational visibility or billing velocity is blocked.");
  } else if (context.pageKey === "alerts-center") {
    actions.push("Resolve top critical open alerts first; handle stale warnings by age and amount.");
    actions.push("Snooze only non-urgent warnings with clear follow-up ownership.");
  } else if (context.pageKey === "data-quality-linkage-center") {
    actions.push("Fix highest-cost linkage gaps first to improve cost and budget accuracy quickly.");
    actions.push("Apply safe linkage updates where entity match confidence is strongest.");
  } else if (context.pageKey === "budget-vs-actual") {
    actions.push("Contain overspent and critical buckets first, then watch buckets with rising utilization.");
    actions.push("Create/assign budget plans for no-budget buckets before additional spend lands.");
  } else if (context.pageKey === "atlas-related" || context.pageKey === "atlas-whole-app") {
    actions.push("Start with the highest-severity cross-page target, then clear the highest-value blocker.");
    actions.push("Use shortcuts to jump directly to target rows/sections and confirm each fix before moving on.");
  } else if (context.pageKey === "expenses") {
    actions.push("Review the top category/project/rig spend drivers first to confirm operational necessity.");
    actions.push("Clear the highest-value submitted expenses to keep finance visibility current.");
    actions.push("Fix unlinked expense records (rig/project) so downstream cost and budget analysis stays reliable.");
    actions.push("Investigate unusual high-value spikes before they propagate into budget pressure.");
  } else if (context.pageKey === "rigs") {
    actions.push("Handle rigs in critical/poor condition first to reduce downtime risk.");
    actions.push("Review highest-expense rig against output and maintenance history.");
    actions.push("Reassign underutilized rigs to active projects where feasible.");
  } else if (context.pageKey === "drilling-reports") {
    actions.push("Clear submitted and rejected drilling reports first to protect operational data flow.");
    actions.push("Address high-delay or low-output drilling records that can impact billing velocity.");
  } else if (context.pageKey === "breakdowns") {
    actions.push("Triage critical breakdowns first by severity and downtime impact.");
    actions.push("Route long-running open breakdowns to maintenance follow-up quickly.");
  } else if (context.pageKey.startsWith("inventory")) {
    actions.push("Resolve out-of-stock and low-stock risks first, then tackle data-quality issues.");
    actions.push("Use movement and receipt trails to close high-impact inventory gaps safely.");
  } else if (context.pageKey === "maintenance") {
    actions.push("Prioritize critical and waiting-for-parts requests to restore rig availability.");
    actions.push("Resolve high-cost maintenance records with clear parts usage linkage.");
  } else if (context.pageKey === "profit") {
    actions.push("Focus on lowest-margin contributors and top cost drivers first.");
    actions.push("Validate rig/project profitability outliers before adjusting forecasts.");
  } else if (context.pageKey === "forecasting") {
    actions.push("Prioritize scenario changes that improve 30-day profit without pushing risk too high.");
    actions.push("Confirm forecast assumptions against current cost and approval pressure signals.");
  }

  if (hasMetric(context.summaryMetrics, [/pending approvals?/i, /pending/i])) {
    actions.push("Clear oldest pending approvals to reduce operational blocking.");
  }
  if (hasMetric(context.summaryMetrics, [/missing.*linkage/i, /needs linkage/i])) {
    actions.push("Fix missing linkage records so dashboards remain decision-grade.");
  }
  if (hasMetric(context.summaryMetrics, [/no[-\s]?budget/i])) {
    actions.push("Assign budget plans to no-budget entities to prevent uncontrolled spend.");
  }

  if (focusItems.length > 0 && actions.length === 0) {
    actions.push(`Start with ${focusItems[0].label}: ${focusItems[0].reason}`);
  }

  if (actions.length === 0) {
    const topMetric = resolveLargestMetric(context.summaryMetrics);
    if (topMetric) {
      actions.push(`No urgent risk detected; keep ${topMetric.label} under review and recheck after major updates.`);
    } else {
      actions.push("No urgent risk detected; recheck this scope after new approvals or linkage changes.");
    }
  }

  if (context.notes?.length) {
    actions.push(`Context note: ${context.notes[0]}`);
  }

  if (keyInsights.length > 0 && actions.length < 4) {
    actions.push("Use the top focus items to sequence your next manager actions.");
  }

  return dedupeText(filterRoleSpecificActions(actions, roleProfile)).slice(0, 5);
}

function resolveRoleDoNowGuidance(roleProfile: CopilotRoleProfile, focusItems: CopilotFocusItem[]) {
  const top = focusItems[0];
  if (!top) {
    return null;
  }
  if (roleProfile.segment === "MANAGEMENT") {
    return `Do now: Inspect risk on ${top.label}, then queue high-value approvals and profitability exceptions.`;
  }
  if (roleProfile.segment === "OFFICE") {
    return `Do now: Review approval/linkage completeness for ${top.label} and close missing record fields.`;
  }
  if (roleProfile.segment === "MECHANIC") {
    return `Do now: Review maintenance readiness for ${top.label}, focusing on downtime and parts availability.`;
  }
  if (roleProfile.segment === "OPERATIONS") {
    return `Do now: Complete reporting/update actions for ${top.label} before lower-priority entries.`;
  }
  return null;
}

function filterRoleSpecificActions(actions: string[], roleProfile: CopilotRoleProfile) {
  if (roleProfile.segment === "GENERAL") {
    return actions;
  }

  if (roleProfile.segment === "MECHANIC") {
    return actions.filter(
      (line) =>
        !/profit|margin|forecast|client profitability|revenue opportunity|budget plan/i.test(line) ||
        /maintenance|repair|rig|parts|downtime|approval/i.test(line)
    );
  }

  if (roleProfile.segment === "OPERATIONS") {
    return actions.filter(
      (line) =>
        !/profit|margin|forecast|budget containment|discretionary spend|client profitability/i.test(line) ||
        /report|drilling|submission|project|rig assignment|approval/i.test(line)
    );
  }

  return actions;
}

function derivePrimarySupportingFocus({
  focusItems,
  roleProfile
}: {
  focusItems: CopilotFocusItem[];
  roleProfile: CopilotRoleProfile;
}) {
  const ranked = dedupeFocusCandidatesByRecord(rankFocusItems(focusItems, roleProfile));
  const primaryFocusItem = ranked[0] || null;
  const supportingItems = ranked.filter((item) => item.id !== primaryFocusItem?.id).slice(0, 3);
  const secondaryInsights =
    primaryFocusItem && supportingItems.length > 0
      ? [
          `Also monitor: ${supportingItems
            .slice(0, 2)
            .map((item) => item.label)
            .join(", ")}.`
        ]
      : [];
  return {
    primaryFocusItem,
    supportingItems,
    secondaryInsights
  };
}

function deriveActionRanking({
  context,
  focusItems,
  roleProfile
}: {
  context: CopilotPageContext;
  focusItems: CopilotFocusItem[];
  roleProfile: CopilotRoleProfile;
}): ContextualCopilotResponsePayload["actionRanking"] {
  const sorted = rankFocusItems(focusItems, roleProfile);
  const mostUrgent = sorted.find((item) => item.severity === "CRITICAL") || sorted[0];
  const highestImpact = [...sorted]
    .sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0))
    .find((item) => (item.amount ?? 0) > 0);
  const safestQuickWin = [...sorted]
    .reverse()
    .find((item) => item.severity === "MEDIUM" || item.severity === "LOW");
  const needsManagerJudgment = sorted.find(
    (item) =>
      item.confidence === "LOW" ||
      /manager|judgment|uncertain|low confidence|manual/i.test(item.reason)
  );

  const ranking: ContextualCopilotResponsePayload["actionRanking"] = {};
  if (mostUrgent) {
    ranking.mostUrgent = `${mostUrgent.label} — ${mostUrgent.reason}`;
  }
  if (highestImpact) {
    ranking.highestImpact = `${highestImpact.label} (${formatAsMoney(highestImpact.amount || 0)} impact).`;
  }
  if (safestQuickWin) {
    ranking.safestQuickWin = `${safestQuickWin.label} — ${safestQuickWin.reason}`;
  }
  if (needsManagerJudgment) {
    ranking.needsManagerJudgment = `${needsManagerJudgment.label} — ${needsManagerJudgment.reason}`;
  }

  const guidance = buildDecisionGuidance(sorted, roleProfile, rankFocusItemsForDecisionGuidance);
  if (guidance.doNow) {
    ranking.doNow = guidance.doNow;
  }
  if (guidance.doNext) {
    ranking.doNext = guidance.doNext;
  }
  if (guidance.canWait) {
    ranking.canWait = guidance.canWait;
  }

  if (context.pageKey === "alerts-center" && !ranking.needsManagerJudgment) {
    const staleHigh = sorted.find((item) => /old|stale|day/i.test(item.reason));
    if (staleHigh) {
      ranking.needsManagerJudgment = `${staleHigh.label} — stale alert requires resolve vs snooze decision.`;
    }
  }

  return ranking;
}

function deriveBestQuickWins({
  context,
  focusItems,
  roleProfile
}: {
  context: CopilotPageContext;
  focusItems: CopilotFocusItem[];
  roleProfile: CopilotRoleProfile;
}) {
  const quickCandidates = rankFocusItems(focusItems, roleProfile).filter(
    (item) =>
      item.severity === "MEDIUM" ||
      item.severity === "LOW" ||
      item.confidence === "HIGH" ||
      /quick win|safe|high confidence/i.test(item.reason)
  );

  const wins = quickCandidates.slice(0, 3).map((item) => `${item.label}: ${item.reason}`);
  if (wins.length > 0) {
    return wins;
  }

  if (context.pageKey === "budget-vs-actual") {
    return ["Assign budgets to no-budget buckets to improve immediate reporting clarity."];
  }
  if (context.pageKey === "atlas-related" || context.pageKey === "atlas-whole-app") {
    return ["Open the safest high-confidence focus target first to create immediate momentum."];
  }
  if (context.pageKey === "expenses") {
    const topCategory = findMetricString(context.summaryMetrics, [/largest category/i, /biggest category/i]);
    const submittedCount = findMetricValue(context.summaryMetrics, [/submitted expenses/i, /submittedExpenses/i]);
    const missingLinkage = findMetricValue(context.summaryMetrics, [/missing.*linkage/i, /missingLinkage/i]);
    if (missingLinkage > 0) {
      return ["Fix the highest-value unlinked expense record first; it is a safe reporting quick win."];
    }
    if (submittedCount > 0) {
      return ["Approve/reject the largest submitted expense first to reduce approval-sensitive spend quickly."];
    }
    if (topCategory && topCategory !== "N/A") {
      return [`Review ${topCategory} for low-effort containment opportunities within current scope.`];
    }
  }
  if (context.pageKey === "alerts-center") {
    return ["Resolve the oldest warning alert with clear ownership to reduce queue noise quickly."];
  }
  if (context.pageKey === "rigs") {
    return [
      "Start with one underutilized but healthy rig reassignment candidate to improve utilization quickly."
    ];
  }
  return [];
}

function deriveInsightCards({
  context: _context,
  focusItems,
  actionRanking,
  keyInsights,
  recommendedNextSteps,
  roleProfile
}: {
  context: CopilotPageContext;
  focusItems: CopilotFocusItem[];
  actionRanking: ContextualCopilotResponsePayload["actionRanking"];
  keyInsights: string[];
  recommendedNextSteps: string[];
  roleProfile: CopilotRoleProfile;
}): CopilotInsightCard[] {
  const cards: CopilotInsightCard[] = [];
  const ranked = rankFocusItems(focusItems, roleProfile);
  const usedKeys = new Set<string>();
  const usedFamilies = new Set<string>();

  const topRisk = selectInsightFocus({
    candidates: ranked.filter((item) => item.severity === "CRITICAL" || item.severity === "HIGH"),
    usedKeys,
    usedFamilies,
    allowFallbackToUsed: true
  }) ||
    selectInsightFocus({
      candidates: ranked,
      usedKeys,
      usedFamilies,
      allowFallbackToUsed: true
    });

  if (topRisk) {
    cards.push(
      createInsightCard({
        item: topRisk,
        kind: "TOP_RISK",
        title: "Top risk"
      })
    );
  }

  const bestNextActionItem = selectInsightFocus({
    candidates: [...ranked].sort((a, b) => scoreActionCandidate(b) - scoreActionCandidate(a)),
    usedKeys,
    usedFamilies,
    avoidUsedFamilies: true,
    allowFallbackToUsed: false
  });
  if (bestNextActionItem) {
    cards.push(
      createInsightCard({
        item: bestNextActionItem,
        kind: "BEST_NEXT_ACTION",
        title: "Best next action"
      })
    );
  } else {
    const bestNextAction =
      actionRanking.doNow ||
      actionRanking.mostUrgent ||
      recommendedNextSteps[0] ||
      keyInsights[0] ||
      null;
    if (bestNextAction) {
      cards.push({
        id: "insight-best-next-action",
        kind: "BEST_NEXT_ACTION",
        title: "Best next action",
        summary: `Issue: Next manager step. Why: ${condenseReason(bestNextAction, 110)}. Next: Inspect the linked priority queue or section first.`,
        severity: "MEDIUM"
      });
    }
  }

  const revenueOpportunity = selectInsightFocus({
    candidates: ranked.filter(
      (item) =>
        normalizeIssueType(item.issueType) === "REVENUE_OPPORTUNITY" ||
        /revenue opportunity|top revenue rig|best-performing|highest revenue/i.test(
          `${item.label} ${item.reason}`
        )
    ),
    usedKeys,
    usedFamilies,
    avoidUsedFamilies: true,
    allowFallbackToUsed: false
  });
  if (revenueOpportunity) {
    cards.push(
      createInsightCard({
        item: revenueOpportunity,
        kind: "REVENUE_OPPORTUNITY",
        title: "Revenue opportunity"
      })
    );
  }

  const maintenanceConcern = selectInsightFocus({
    candidates: ranked.filter(
      (item) =>
        normalizeIssueType(item.issueType) === "MAINTENANCE" ||
        /maintenance|breakdown|waiting for parts|repair/i.test(`${item.label} ${item.reason}`)
    ),
    usedKeys,
    usedFamilies,
    avoidUsedFamilies: true,
    allowFallbackToUsed: false
  });
  if (maintenanceConcern) {
    cards.push(
      createInsightCard({
        item: maintenanceConcern,
        kind: "MAINTENANCE_CONCERN",
        title: "Maintenance concern"
      })
    );
  }

  const dataQualityIssue = selectInsightFocus({
    candidates: ranked.filter(
      (item) =>
        normalizeIssueType(item.issueType) === "LINKAGE" ||
        normalizeIssueType(item.issueType) === "NO_BUDGET" ||
        /missing linkage|data gap|unassigned|attribution/i.test(`${item.label} ${item.reason}`)
    ),
    usedKeys,
    usedFamilies,
    avoidUsedFamilies: true,
    allowFallbackToUsed: false
  });
  if (dataQualityIssue) {
    cards.push(
      createInsightCard({
        item: dataQualityIssue,
        kind: "DATA_QUALITY_ISSUE",
        title: "Data-quality issue"
      })
    );
  }

  return applyRoleInsightCardPreferences(dedupeInsightCardsByKind(cards), roleProfile);
}

function applyRoleInsightCardPreferences(cards: CopilotInsightCard[], roleProfile: CopilotRoleProfile) {
  const preferredOrder = roleProfile.preferredCardKinds;
  const visibleKinds = new Set(preferredOrder);

  const filtered = cards.filter((card) => {
    if (roleProfile.segment === "OFFICE" && card.kind === "REVENUE_OPPORTUNITY") {
      return false;
    }
    if (roleProfile.segment === "MECHANIC" && (card.kind === "REVENUE_OPPORTUNITY" || card.kind === "DATA_QUALITY_ISSUE")) {
      return card.kind === "DATA_QUALITY_ISSUE";
    }
    if (roleProfile.segment === "OPERATIONS" && card.kind === "REVENUE_OPPORTUNITY") {
      return false;
    }
    return visibleKinds.has(card.kind);
  });

  const renamed = filtered.map((card) => {
    if (roleProfile.segment === "OPERATIONS" && card.kind === "DATA_QUALITY_ISSUE") {
      return {
        ...card,
        title: "Reporting gap"
      };
    }
    return card;
  });

  return [...renamed]
    .sort((a, b) => {
      const aIdx = preferredOrder.indexOf(a.kind);
      const bIdx = preferredOrder.indexOf(b.kind);
      if (aIdx !== bIdx) {
        return (aIdx === -1 ? 99 : aIdx) - (bIdx === -1 ? 99 : bIdx);
      }
      return focusSeverityRank(a.severity || "LOW") - focusSeverityRank(b.severity || "LOW");
    })
    .slice(0, 5);
}

function createInsightCard({
  item,
  kind,
  title
}: {
  item: CopilotFocusItem;
  kind: CopilotInsightCardKind;
  title: string;
}): CopilotInsightCard {
  return {
    id: `insight-${kind.toLowerCase()}-${item.id}`,
    kind,
    title,
    summary: buildInsightCardSummary({ item, kind }),
    severity: item.severity,
    focusItemId: item.id,
    recordKey: resolveInsightRecordKey(item),
    actionLabel: item.actionLabel,
    inspectHint: item.inspectHint,
    href: item.href,
    targetId: item.targetId,
    sectionId: item.sectionId,
    targetPageKey: item.targetPageKey
  };
}

function selectInsightFocus({
  candidates,
  usedKeys,
  usedFamilies,
  avoidUsedFamilies = false,
  allowFallbackToUsed
}: {
  candidates: CopilotFocusItem[];
  usedKeys: Set<string>;
  usedFamilies: Set<string>;
  avoidUsedFamilies?: boolean;
  allowFallbackToUsed: boolean;
}) {
  if (candidates.length === 0) {
    return null;
  }
  const deduped = dedupeFocusCandidatesByRecord(candidates);
  const fresh = deduped.find((item) => {
    const recordKey = resolveInsightRecordKey(item);
    if (usedKeys.has(recordKey)) {
      return false;
    }
    if (!avoidUsedFamilies) {
      return true;
    }
    const family = resolveInsightDiversityFamily(item);
    return !usedFamilies.has(family);
  });
  if (fresh) {
    usedKeys.add(resolveInsightRecordKey(fresh));
    usedFamilies.add(resolveInsightDiversityFamily(fresh));
    return fresh;
  }
  const freshRecordOnly = deduped.find((item) => !usedKeys.has(resolveInsightRecordKey(item)));
  if (freshRecordOnly) {
    usedKeys.add(resolveInsightRecordKey(freshRecordOnly));
    usedFamilies.add(resolveInsightDiversityFamily(freshRecordOnly));
    return freshRecordOnly;
  }
  if (!allowFallbackToUsed) {
    return null;
  }
  const fallback =
    deduped.find((item) => {
      if (!avoidUsedFamilies) {
        return true;
      }
      return !usedFamilies.has(resolveInsightDiversityFamily(item));
    }) ||
    deduped[0] ||
    null;
  if (fallback) {
    usedKeys.add(resolveInsightRecordKey(fallback));
    usedFamilies.add(resolveInsightDiversityFamily(fallback));
  }
  return fallback;
}

function resolveInsightRecordKey(item: CopilotFocusItem) {
  if (item.targetId) {
    return `${item.targetPageKey || "page"}::${item.targetId}`;
  }
  return `${item.targetPageKey || "page"}::${normalizeKey(item.label || item.id || "focus")}`;
}

function resolveInsightDiversityFamily(item: CopilotFocusItem) {
  const issueType = normalizeIssueType(item.issueType);
  if (issueType === "MAINTENANCE") {
    return "MAINTENANCE";
  }
  if (issueType === "LINKAGE" || issueType === "NO_BUDGET") {
    return "DATA_QUALITY";
  }
  if (issueType === "REVENUE_OPPORTUNITY") {
    return "REVENUE";
  }
  if (issueType === "RIG_RISK" || issueType === "RIG_SPEND") {
    return "RIG";
  }
  if (issueType === "APPROVAL_BACKLOG") {
    return "APPROVAL";
  }
  if (issueType === "PROJECT_SPEND" || issueType === "COST_DRIVER" || issueType === "PROFITABILITY") {
    return "FINANCE";
  }
  const haystack = `${item.label} ${item.reason}`.toLowerCase();
  if (/maintenance|breakdown|repair|downtime/.test(haystack)) {
    return "MAINTENANCE";
  }
  if (/linkage|unassigned|attribution|missing/.test(haystack)) {
    return "DATA_QUALITY";
  }
  if (/revenue|output|performing/.test(haystack)) {
    return "REVENUE";
  }
  if (/rig/.test(haystack)) {
    return "RIG";
  }
  if (/expense|cost|spend|profit|margin|budget/.test(haystack)) {
    return "FINANCE";
  }
  return issueType || "GENERAL";
}

function buildInsightCardSummary({
  item,
  kind
}: {
  item: CopilotFocusItem;
  kind: CopilotInsightCardKind;
}) {
  const issue = item.label;
  const why = condenseReason(item.reason, 96);
  const next = resolveInspectNextHint({ item, kind });
  return `Issue: ${issue}. Why: ${why}. Next: ${next}`;
}

function resolveInspectNextHint({
  item,
  kind
}: {
  item: CopilotFocusItem;
  kind: CopilotInsightCardKind;
}) {
  if (kind === "TOP_RISK") {
    return item.targetId
      ? "Open the exact record and confirm containment."
      : "Open the linked section and validate the top driver.";
  }
  if (kind === "BEST_NEXT_ACTION") {
    return item.targetId
      ? "Open the exact record and complete the next decision."
      : "Open the linked page and execute this before lower-priority work.";
  }
  if (kind === "REVENUE_OPPORTUNITY") {
    return "Open the linked rig/project and verify output versus cost.";
  }
  if (kind === "MAINTENANCE_CONCERN") {
    return "Open maintenance details and confirm urgency, downtime, and parts dependency.";
  }
  return "Open linkage details and assign missing fields to restore reporting confidence.";
}

function scoreActionCandidate(item: CopilotFocusItem) {
  const severityWeight =
    item.severity === "CRITICAL"
      ? 100
      : item.severity === "HIGH"
        ? 72
        : item.severity === "MEDIUM"
          ? 46
          : 24;
  const impactWeight = Math.min(28, Math.log10((item.amount || 0) + 1) * 8);
  const urgencyWeight = /critical|overspent|waiting approval|stale|downtime|older than/i.test(item.reason)
    ? 14
    : 0;
  const ageHoursMatch = item.reason.match(/(\d+(?:\.\d+)?)h/);
  const ageHours = ageHoursMatch ? Number(ageHoursMatch[1]) : 0;
  const stalenessWeight = ageHours > 0 ? Math.min(10, ageHours / 24) : 0;
  const effortPenalty = resolveEffortWeight(item) * 6;
  return severityWeight + impactWeight + urgencyWeight + stalenessWeight - effortPenalty;
}

function deriveFollowUpQuestions({
  context,
  focusItems,
  roleProfile
}: {
  context: CopilotPageContext;
  focusItems: CopilotFocusItem[];
  roleProfile: CopilotRoleProfile;
}) {
  const base = [
    "What should I do first?",
    "Show biggest risks",
    "Take me to top rig risk"
  ];

  if (context.pageKey === "maintenance") {
    base.unshift("Show pending maintenance risks", "Take me to top maintenance issue");
  }
  if (context.pageKey === "expenses") {
    base.unshift("Show highest expense rig");
  }
  if (context.pageKey === "executive-overview") {
    base.unshift("Show biggest profitability issue", "Show data gaps hurting reports");
  }

  const hasRevenueOpportunity = focusItems.some(
    (item) =>
      normalizeIssueType(item.issueType) === "REVENUE_OPPORTUNITY" ||
      /revenue opportunity|top revenue rig/i.test(`${item.label} ${item.reason}`)
  );
  if (hasRevenueOpportunity) {
    base.unshift("Show top revenue rig");
  }

  return dedupeText([...roleProfile.followUpPrompts, ...base]).slice(0, 6);
}

function resolveNavigationTargets({
  context,
  focusItems
}: {
  context: CopilotPageContext;
  focusItems: CopilotFocusItem[];
}) {
  const explicitTargets = dedupeNavigationTargets(context.navigationTargets || []);
  const focusTargets = dedupeNavigationTargets(
    focusItems
      .filter((item) => Boolean(item.href))
      .map((item) => ({
        label: `Open ${item.label}`,
        href: item.href || "",
        reason: item.reason,
        actionLabel: item.actionLabel,
        inspectHint: item.inspectHint,
        targetId: item.targetId,
        sectionId: item.sectionId,
        pageKey: item.targetPageKey || inferPageKeyFromHref(item.href)
      }))
  );

  if (explicitTargets.length > 0) {
    return dedupeNavigationTargets([...explicitTargets, ...focusTargets]).slice(0, 6);
  }

  const fallbackMap: Record<string, CopilotNavigationTarget[]> = {
    "atlas-related": [
      { label: "Open Alerts Center", href: "/alerts-center", reason: "Triage operational alerts first.", pageKey: "alerts-center" },
      { label: "Open Budget vs Actual", href: "/cost-tracking/budget-vs-actual", reason: "Check budget pressure behind current risks.", pageKey: "budget-vs-actual" },
      { label: "Open Data Quality Center", href: "/data-quality/linkage-center", reason: "Fix missing linkage impacts quickly.", pageKey: "data-quality-linkage-center" }
    ],
    "atlas-whole-app": [
      { label: "Open Executive Overview", href: "/executive-overview", reason: "Start from top-level risk posture.", pageKey: "executive-overview" },
      { label: "Open Alerts Center", href: "/alerts-center", reason: "Clear urgent alert backlog.", pageKey: "alerts-center" },
      { label: "Open Budget vs Actual", href: "/cost-tracking/budget-vs-actual", reason: "Prioritize overspent and critical buckets.", pageKey: "budget-vs-actual" }
    ],
    "executive-overview": [
      { label: "Open Alerts Center", href: "/alerts-center", reason: "Triage current risk signals.", pageKey: "alerts-center" },
      { label: "Open Budget vs Actual", href: "/cost-tracking/budget-vs-actual", reason: "Review budget pressure.", pageKey: "budget-vs-actual" },
      { label: "Open Drilling Reports Approvals", href: "/approvals?tab=drilling-reports", reason: "Process drilling backlog.", pageKey: "approvals", sectionId: "approvals-tab-drilling-reports" }
    ],
    "alerts-center": [
      { label: "Open Alerts Center", href: "/alerts-center", reason: "Continue triage in current queue.", pageKey: "alerts-center", sectionId: "alerts-active-section" },
      { label: "Open Approvals", href: "/approvals", reason: "Process pending queue items.", pageKey: "approvals" },
      { label: "Open Data Quality Center", href: "/data-quality/linkage-center", reason: "Fix linkage-driven alerts.", pageKey: "data-quality-linkage-center" },
      { label: "Open Drilling Reports Approvals", href: "/approvals?tab=drilling-reports", reason: "Resolve stale drilling approvals first.", pageKey: "approvals", sectionId: "approvals-tab-drilling-reports" }
    ],
    "data-quality-linkage-center": [
      { label: "Open Data Quality Center", href: "/data-quality/linkage-center", reason: "Apply linkage corrections.", pageKey: "data-quality-linkage-center" },
      { label: "Open Cost Tracking", href: "/cost-tracking", reason: "Validate impact after corrections.", pageKey: "cost-tracking" }
    ],
    "budget-vs-actual": [
      { label: "Open Budget vs Actual", href: "/cost-tracking/budget-vs-actual", reason: "Review budget buckets.", pageKey: "budget-vs-actual" },
      { label: "Open Cost Tracking", href: "/cost-tracking", reason: "Inspect spend drivers.", pageKey: "cost-tracking" },
      { label: "Open Alerts Center", href: "/alerts-center", reason: "Review related budget alerts.", pageKey: "alerts-center" }
    ],
    expenses: [
      { label: "Open Expenses", href: "/expenses", reason: "Review cost drivers and expense records.", pageKey: "expenses", sectionId: "expenses-records-section" },
      { label: "Open Budget vs Actual", href: "/cost-tracking/budget-vs-actual", reason: "Check budget pressure related to current spend.", pageKey: "budget-vs-actual" },
      { label: "Open Approvals", href: "/approvals", reason: "Clear submitted records affecting expense visibility.", pageKey: "approvals" },
      { label: "Open Linkage Center", href: "/data-quality/linkage-center", reason: "Fix missing rig/project linkage from expense records.", pageKey: "data-quality-linkage-center" }
    ],
    "drilling-reports": [
      { label: "Open Drilling Reports", href: "/drilling-reports", reason: "Review drilling records and status.", pageKey: "drilling-reports", sectionId: "drilling-reports-table-section" },
      { label: "Open Approvals", href: "/approvals?tab=drilling-reports", reason: "Resolve drilling approval queue.", pageKey: "approvals", sectionId: "approvals-tab-drilling-reports" },
      { label: "Open Revenue", href: "/revenue", reason: "Validate drilling impact on revenue.", pageKey: "revenue" }
    ],
    breakdowns: [
      { label: "Open Breakdown Reports", href: "/breakdowns", reason: "Review breakdown severity and downtime.", pageKey: "breakdowns", sectionId: "breakdown-log-section" },
      { label: "Open Maintenance", href: "/maintenance", reason: "Coordinate maintenance response.", pageKey: "maintenance", sectionId: "maintenance-log-section" }
    ],
    "inventory-overview": [
      { label: "Open Inventory Items", href: "/inventory/items", reason: "Review inventory item health.", pageKey: "inventory-items", sectionId: "inventory-items-section" },
      { label: "Open Stock Movements", href: "/inventory/stock-movements", reason: "Trace stock changes.", pageKey: "inventory-stock-movements", sectionId: "inventory-movements-section" },
      { label: "Open Inventory Issues", href: "/inventory/issues", reason: "Resolve data quality risks.", pageKey: "inventory-issues", sectionId: "inventory-issues-section" }
    ],
    "inventory-items": [
      { label: "Open Inventory Items", href: "/inventory/items", reason: "Manage inventory items.", pageKey: "inventory-items", sectionId: "inventory-items-section" },
      { label: "Open Stock Movements", href: "/inventory/stock-movements", reason: "Review linked movements.", pageKey: "inventory-stock-movements", sectionId: "inventory-movements-section" },
      { label: "Open Inventory Issues", href: "/inventory/issues", reason: "Clean inventory data issues.", pageKey: "inventory-issues", sectionId: "inventory-issues-section" }
    ],
    "inventory-stock-movements": [
      { label: "Open Stock Movements", href: "/inventory/stock-movements", reason: "Trace movement records.", pageKey: "inventory-stock-movements", sectionId: "inventory-movements-section" },
      { label: "Open Inventory Items", href: "/inventory/items", reason: "Inspect affected items.", pageKey: "inventory-items", sectionId: "inventory-items-section" }
    ],
    "inventory-issues": [
      { label: "Open Inventory Issues", href: "/inventory/issues", reason: "Resolve quality issues.", pageKey: "inventory-issues", sectionId: "inventory-issues-section" },
      { label: "Open Data Quality Center", href: "/data-quality/linkage-center", reason: "Fix cross-module linkage risks.", pageKey: "data-quality-linkage-center" }
    ],
    "inventory-receipt-intake": [
      { label: "Open Purchase Follow-up", href: "/purchasing/receipt-follow-up", reason: "Review receipt scan and intake flow.", pageKey: "inventory-receipt-intake", sectionId: "inventory-receipt-scan-section" },
      { label: "Open Intake History", href: "/purchasing/receipt-follow-up?view=history", reason: "Review pending and finalized intake records.", pageKey: "inventory-receipt-intake", sectionId: "inventory-receipt-history-section" },
      { label: "Open Stock Movements", href: "/inventory/stock-movements", reason: "Trace inventory impact from receipt intake.", pageKey: "inventory-stock-movements", sectionId: "inventory-movements-section" }
    ],
    maintenance: [
      { label: "Open Maintenance", href: "/maintenance", reason: "Review maintenance activity log and rig status.", pageKey: "maintenance", sectionId: "maintenance-log-section" },
      { label: "Open Breakdowns", href: "/breakdowns", reason: "Check open breakdowns linked to maintenance work.", pageKey: "breakdowns", sectionId: "breakdown-log-section" }
    ],
    rigs: [
      { label: "Open Rigs", href: "/rigs", reason: "Review rig condition and utilization risk.", pageKey: "rigs", sectionId: "rig-registry-section" },
      { label: "Open Maintenance", href: "/maintenance", reason: "Confirm maintenance demand for attention rigs.", pageKey: "maintenance", sectionId: "maintenance-log-section" },
      { label: "Open Cost Tracking", href: "/cost-tracking", reason: "Check rig cost concentration.", pageKey: "cost-tracking" }
    ],
    profit: [
      { label: "Open Profit", href: "/profit", reason: "Review profitability drivers.", pageKey: "profit", sectionId: "profit-primary-kpi-section" },
      { label: "Open Forecasting", href: "/forecasting", reason: "Compare forecast scenarios.", pageKey: "forecasting", sectionId: "forecast-kpi-section" },
      { label: "Open Expenses", href: "/expenses", reason: "Inspect cost contributors.", pageKey: "expenses" }
    ],
    forecasting: [
      { label: "Open Forecasting", href: "/forecasting", reason: "Review simulation details.", pageKey: "forecasting", sectionId: "forecast-kpi-section" },
      { label: "Open Profit", href: "/profit", reason: "Validate profitability impact.", pageKey: "profit", sectionId: "profit-primary-kpi-section" }
    ]
  };

  return dedupeNavigationTargets([...(fallbackMap[context.pageKey] || []), ...focusTargets]).slice(0, 6);
}

export function classifyConversationIntent({
  question,
  context
}: {
  question: string;
  context: CopilotPageContext;
}): CopilotConversationIntent {
  const normalized = normalizeUserQuestion(question);

  if (isSmallTalk(normalized)) {
    return "small_talk";
  }
  if (isNavigationIntent(normalized) || normalized.includes("open the record") || normalized.includes("open the item")) {
    return "navigation_request";
  }
  if (isFollowUpReference(normalized)) {
    return "follow_up_reference";
  }
  if (isComparisonQuestion(normalized)) {
    return "comparison";
  }
  if (isPlanningQuestion(normalized)) {
    return "planning";
  }
  if (isClarificationQuestion(normalized)) {
    return "clarification";
  }
  if (isGeneralExplanationQuestion(normalized) || isBroadGeneralQuestion(normalized)) {
    return "general_question";
  }

  if (isSummaryQuestion(normalized) && context.scopeMode === "WHOLE_APP") {
    return "app_question";
  }

  return "app_question";
}

export function classifyCopilotIntent({
  question,
  context,
  conversationIntent
}: {
  question: string;
  context: CopilotPageContext;
  conversationIntent?: CopilotConversationIntent;
}): CopilotIntent {
  const normalized = normalizeUserQuestion(question);
  const wholeAppScoped = context.scopeMode === "WHOLE_APP" || context.pageKey === "atlas-whole-app";
  const resolvedConversationIntent =
    conversationIntent || classifyConversationIntent({ question, context });

  if (resolvedConversationIntent === "navigation_request") {
    return "navigation";
  }
  if (resolvedConversationIntent === "comparison") {
    return "comparison";
  }
  if (resolvedConversationIntent === "follow_up_reference") {
    return "follow_up_reference";
  }
  if (resolvedConversationIntent === "small_talk" || resolvedConversationIntent === "general_question") {
    return "general_explanation";
  }

  if (isSummaryQuestion(normalized)) {
    if (wholeAppScoped || normalized.includes("whole app") || normalized.includes("across the app")) {
      return "whole_app_summary";
    }
    return "page_summary";
  }

  if (
    wholeAppScoped &&
    (normalized.includes("what should i do first across") ||
      normalized.includes("across the whole app") ||
      normalized.includes("whole app"))
  ) {
    return "whole_app_summary";
  }

  return "app_guidance";
}


function prioritizeFocusItemsForQuestion({
  question,
  focusItems
}: {
  question: string;
  focusItems: CopilotFocusItem[];
}) {
  const command = resolveGeoFieldsDecisionCommand(normalizeUserQuestion(question));
  if (!command || focusItems.length <= 1) {
    return focusItems;
  }
  const matched = resolveFocusByCommand({ command, focusItems });
  if (!matched) {
    return focusItems;
  }
  const remainder = focusItems.filter((item) => item.id !== matched.id);
  return [matched, ...remainder];
}

function resolveFocusByCommand({
  command,
  focusItems
}: {
  command: GeoFieldsDecisionCommand;
  focusItems: CopilotFocusItem[];
}) {
  if (command === "TOP_REVENUE_RIG") {
    return (
      findFocusByIssueType(focusItems, ["REVENUE_OPPORTUNITY"]) ||
      findFocusByKeywords(focusItems, ["top revenue rig", "revenue opportunity", "highest revenue rig"])
    );
  }
  if (command === "HIGHEST_EXPENSE_RIG") {
    return (
      findFocusByKeywords(focusItems, ["highest expense rig", "highest cost rig"]) ||
      findFocusByIssueType(focusItems, ["RIG_SPEND", "COST_DRIVER"])
    );
  }
  if (command === "RIGS_NEEDING_ATTENTION") {
    return (
      findFocusByIssueType(focusItems, ["RIG_RISK", "RIG_UTILIZATION", "MAINTENANCE"]) ||
      findFocusByKeywords(focusItems, ["rig condition risk", "underutilized rig", "rig"])
    );
  }
  if (command === "PENDING_MAINTENANCE_RISKS" || command === "TOP_MAINTENANCE_ISSUE") {
    return (
      findFocusByIssueType(focusItems, ["MAINTENANCE"]) ||
      findFocusByKeywords(focusItems, ["maintenance", "waiting for parts", "repair"])
    );
  }
  if (command === "BIGGEST_PROFITABILITY_ISSUE") {
    return (
      findFocusByIssueType(focusItems, ["PROFITABILITY"]) ||
      findFocusByKeywords(focusItems, ["profitability concern", "high spend", "low revenue", "margin"])
    );
  }
  if (command === "DATA_GAPS_HURTING_REPORTS") {
    return (
      findFocusByIssueType(focusItems, ["LINKAGE", "NO_BUDGET"]) ||
      findFocusByKeywords(focusItems, ["missing linkage", "data gap", "unassigned"])
    );
  }
  if (command === "TOP_RIG_RISK") {
    return (
      findFocusByIssueType(focusItems, ["RIG_RISK", "RIG_UTILIZATION", "MAINTENANCE"]) ||
      findFocusByKeywords(focusItems, ["rig condition risk", "top rig risk", "rig"])
    );
  }
  if (command === "BIGGEST_APPROVAL_ISSUE") {
    return (
      findFocusByIssueType(focusItems, ["APPROVAL_BACKLOG"]) ||
      findFocusByKeywords(focusItems, ["approval", "pending", "submitted"])
    );
  }
  return focusItems[0] || null;
}

function resolveViewPrefix(context: CopilotPageContext) {
  if (context.pageKey === "atlas-whole-app") {
    return "Across the app, ";
  }
  if (context.pageKey === "atlas-related") {
    return "Across related data, ";
  }
  return "";
}


function buildAnswer({
  intent,
  conversationIntent,
  question,
  context,
  roleProfile,
  summary,
  focusItems,
  keyInsights,
  recommendedActions,
  actionRanking,
  bestQuickWins,
  navigationTargets
}: {
  intent: CopilotIntent;
  conversationIntent: CopilotConversationIntent;
  question: string;
  context: CopilotPageContext;
  roleProfile: CopilotRoleProfile;
  summary: string;
  focusItems: CopilotFocusItem[];
  keyInsights: string[];
  recommendedActions: string[];
  actionRanking: ContextualCopilotResponsePayload["actionRanking"];
  bestQuickWins: string[];
  navigationTargets: CopilotNavigationTarget[];
}) {
  const normalizedQuestion = normalizeUserQuestion(question);
  const viewPrefix = resolveViewPrefix(context);
  const sessionSuggested = resolveSessionSuggestedFocus(context);
  const decisionCandidates = dedupeFocusCandidatesByRecord([...focusItems, ...sessionSuggested]);
  const salaryRequested = isSalaryReference(normalizedQuestion);
  const salaryFocus = findSalaryFocus(decisionCandidates);
  const topFocus =
    resolveReferencedFocus(normalizedQuestion, context, decisionCandidates) || decisionCandidates[0];
  const secondFocus = decisionCandidates.find((item) => item.id !== topFocus?.id) || null;
  const topFocusTarget = topFocus?.href
    ? {
        label: topFocus.label,
        href: topFocus.href,
        reason: topFocus.reason,
        targetId: topFocus.targetId,
        sectionId: topFocus.sectionId,
        pageKey: topFocus.targetPageKey,
        targetPrecision: resolveTargetPrecision({
          targetId: topFocus.targetId,
          sectionId: topFocus.sectionId
        }),
        availabilityNote: topFocus.targetId
          ? "Exact row target available."
          : topFocus.sectionId
            ? "Exact row is unavailable; best section focus is available."
            : "Direct page open is available; specific focus target is unavailable."
      }
    : null;
  const topTarget =
    intent === "navigation" && topFocusTarget
      ? topFocusTarget
      : navigationTargets[0] || topFocusTarget;
  const latestAssistantContext = context.sessionContext?.recentConversation?.find(
    (entry) => entry.role === "assistant" && typeof entry.text === "string" && entry.text.trim().length > 0
  )?.text;
  const decisionGuidance = buildDecisionGuidance(
    decisionCandidates,
    roleProfile,
    rankFocusItemsForDecisionGuidance
  );
  const decisionPlan = resolveDecisionPlanItems(
    decisionCandidates,
    roleProfile,
    rankFocusItemsForDecisionGuidance
  );
  const decisionNarrative = buildDecisionFirstNarrative(decisionPlan);
  const conciseSummary = compactSummaryLine(summary);

  if (conversationIntent === "small_talk") {
    return buildSmallTalkAnswer(normalizedQuestion);
  }

  if (conversationIntent === "general_question") {
    return buildGeneralExplanationAnswer({
      question: normalizedQuestion,
      context,
      topFocus,
      summary
    });
  }

  const decisionCommand = resolveGeoFieldsDecisionCommand(normalizedQuestion);
  if (decisionCommand) {
    const commandAnswer = buildGeoFieldsCommandAnswer({
      command: decisionCommand,
      focusItems: decisionCandidates,
      summary,
      topTarget
    });
    if (commandAnswer) {
      return commandAnswer;
    }
  }

  if (intent === "whole_app_summary") {
    if (decisionPlan.doNowItem) {
      const nextMove = buildDecisionFirstNarrative({
        ...decisionPlan,
        includeCanWait: false
      });
      const contextLine = conciseSummary ? `Context: ${conciseSummary}.` : "";
      return `${nextMove}${contextLine ? ` ${contextLine}` : ""}`.trim();
    }
    const firstInsight = keyInsights[0] ? condenseReason(keyInsights[0], 120) : "";
    if (firstInsight) {
      return [conciseSummary, firstInsight].filter(Boolean).join(" ");
    }
    return conciseSummary || "No major cross-page exceptions in the current scope.";
  }

  if (intent === "page_summary") {
    if (decisionPlan.doNowItem) {
      const nextMove = buildDecisionFirstNarrative({
        ...decisionPlan,
        includeCanWait: false
      });
      const contextLine = conciseSummary ? `Context: ${conciseSummary}.` : "";
      return `${nextMove}${contextLine ? ` ${contextLine}` : ""}`.trim();
    }
    const firstInsight = keyInsights[0] ? condenseReason(keyInsights[0], 118) : "";
    return [conciseSummary, firstInsight].filter(Boolean).join(" ");
  }

  if (salaryRequested && !salaryFocus) {
    return `I don’t see a salary-specific issue in this scope yet. The strongest current target is ${topFocus?.label || "not available"}; ask me to compare it with the next item if helpful.`;
  }

  if (
    intent === "follow_up_reference" ||
    normalizedQuestion === "that item" ||
    normalizedQuestion === "that one" ||
    normalizedQuestion.includes("the first one") ||
    normalizedQuestion.includes("the one you just showed") ||
    normalizedQuestion.includes("that issue")
  ) {
    if (!topFocus) {
      return "I don’t have a prior item anchored yet. Ask me to “show biggest risks” and I’ll pick one.";
    }
    return `You’re referring to ${conciseFocusLine(topFocus, 80)}. ${
      topTarget ? describeTargetPrecision(topTarget) : "I can walk through it with you here."
    }`.trim();
  }

  if (intent === "navigation" || isNavigationIntent(normalizedQuestion)) {
    if (topTarget) {
      const targetLabel = normalizeNavigationLabel(topTarget.label) || "the recommended target";
      const precisionLine = describeTargetPrecision(topTarget);
      return `I can take you to ${targetLabel}. ${precisionLine} Use “Take me there”.`;
    }
    return "I don’t have a safe direct target yet. Ask for the top item and I’ll route you to the best section.";
  }

  if (
    normalizedQuestion.includes("why that one") ||
    normalizedQuestion.includes("why this one") ||
    normalizedQuestion.includes("why this item")
  ) {
    if (!topFocus) {
      return "There isn’t a standout focus item right now. The view looks stable, so I’d monitor the top metric and re-check after updates.";
    }
    const urgency = resolveUrgencyLabel(topFocus);
    const impact = resolveImpactLabel(topFocus);
    const effort = resolveEffortLabel(topFocus);
    const delay = deriveIgnoreConsequence(topFocus);
    return `${topFocus.label} is first because ${condenseReason(topFocus.reason, 86)}. It’s ${urgency.toLowerCase()} urgency, ${impact.toLowerCase()} impact, and ${effort.toLowerCase()} effort. If delayed: ${delay}`;
  }

  if (
    intent === "comparison" ||
    normalizedQuestion.includes("compare the top two") ||
    normalizedQuestion.includes("compare these two") ||
    normalizedQuestion.includes("which is more urgent") ||
    normalizedQuestion.includes("which is higher value") ||
    normalizedQuestion.includes("which is easiest to fix") ||
    normalizedQuestion.includes("compare")
  ) {
    return buildComparisonAnswer({
      normalizedQuestion,
      first: topFocus,
      second: secondFocus
    });
  }

  if (
    normalizedQuestion.includes("next 10 minutes") ||
    normalizedQuestion.includes("next ten minutes") ||
    normalizedQuestion.includes("in 10 minutes")
  ) {
    const nowStep = decisionPlan.doNowItem;
    const nextStep = decisionPlan.doNextItem;
    if (nowStep) {
      const doNowLine = `In the next 10 minutes, start with ${nowStep.label}.`;
      const doNextLine = nextStep
        ? `Then move to ${nextStep.label}.`
        : "Then clear one safe quick win.";
      return `${doNowLine} ${doNextLine}`.trim();
    }
    const fallbackNow = decisionGuidance.doNow || actionRanking.doNow || actionRanking.mostUrgent;
    const fallbackNext = decisionGuidance.doNext || actionRanking.doNext || actionRanking.highestImpact;
    return `${
      fallbackNow ? `Do now: ${trimTrailingPeriod(fallbackNow)}. ` : ""
    }${
      fallbackNext
        ? `Then: ${trimTrailingPeriod(fallbackNext)}.`
        : "Start with the top urgent item, then clear one safe quick win."
    }`.trim();
  }

  if (
    normalizedQuestion.includes("can wait until later") ||
    normalizedQuestion.includes("can wait") ||
    normalizedQuestion.includes("can this wait") ||
    normalizedQuestion.includes("wait until later")
  ) {
    if (decisionPlan.canWaitItem) {
      return `${decisionPlan.canWaitItem.label} can wait for now. If delayed, ${resolveDelayRisk(
        decisionPlan.canWaitItem
      )}`;
    }
    const canWait = decisionGuidance.canWait || actionRanking.canWait;
    if (canWait) {
      return canWait;
    }
    return "There’s no obvious low-risk defer item in this scope right now; keep focus on the top urgent target first.";
  }

  if (normalizedQuestion.includes("is it urgent") || normalizedQuestion.includes("is this urgent")) {
    if (!topFocus) {
      return "Nothing stands out as urgent in this view right now.";
    }
    const urgent = topFocus.severity === "CRITICAL" || topFocus.severity === "HIGH";
    return urgent
      ? `Yes — ${topFocus.label} is the urgent one to handle first.`
      : `${topFocus.label} is not urgent yet; it can be handled after higher-severity items.`;
  }

  if (
    normalizedQuestion === "why" ||
    normalizedQuestion === "why?" ||
    normalizedQuestion.includes("why") ||
    normalizedQuestion.includes("what do you mean")
  ) {
    if (topFocus) {
      if (normalizedQuestion.includes("what do you mean")) {
        return `I mean ${topFocus.label} should be first because ${trimTrailingPeriod(
          topFocus.reason
        )}.`;
      }
      return `${topFocus.label} is leading because ${trimTrailingPeriod(topFocus.reason)}.`;
    }
    const relevantInsight =
      keyInsights.find((entry) => !/scoped by \d+ active filter/i.test(entry)) ||
      keyInsights.find((entry) => !/totals are not global/i.test(entry)) ||
      keyInsights[0] ||
      summary;
    if (normalizedQuestion.includes("what do you mean") && latestAssistantContext) {
      return `I mean: ${latestAssistantContext}`;
    }
    return relevantInsight;
  }

  if (
    normalizedQuestion.includes("what should i do next") ||
    normalizedQuestion.includes("what should i do") ||
    normalizedQuestion.includes("what should i do first")
  ) {
    return (
      decisionNarrative ||
      decisionGuidance.doNow ||
      actionRanking.doNow ||
      recommendedActions[0] ||
      "Start with the top urgent item, then continue in severity order."
    );
  }

  if (normalizedQuestion.includes("summarize this page") || normalizedQuestion.includes("summarize")) {
    const firstInsight = keyInsights[0] ? condenseReason(keyInsights[0], 118) : "";
    return [conciseSummary, firstInsight].filter(Boolean).join(" ");
  }

  if (
    normalizedQuestion.includes("why is this page important") ||
    normalizedQuestion.includes("why this page matters") ||
    normalizedQuestion.includes("why does this page matter")
  ) {
    const relevantInsight =
      keyInsights.find((entry) => !/scoped by \d+ active filter/i.test(entry)) ||
      keyInsights.find((entry) => !/totals are not global/i.test(entry)) ||
      keyInsights[0] ||
      summary;
    return relevantInsight;
  }

  if (normalizedQuestion.includes("biggest risks") || normalizedQuestion.includes("risk")) {
    const risks = dedupeFocusCandidatesByRecord(decisionCandidates).filter(
      (item) => item.severity === "CRITICAL" || item.severity === "HIGH"
    );
    if (risks.length === 0) {
      return conciseSummary || "No critical risks detected in this scope.";
    }
    if (risks.length === 1) {
      return `Top risk: ${conciseFocusLine(risks[0], 84)}.`;
    }
    return `Top risks: 1) ${conciseFocusLine(risks[0], 72)} 2) ${conciseFocusLine(risks[1], 72)}`;
  }

  if (
    normalizedQuestion.includes("what happens if i ignore this") ||
    normalizedQuestion.includes("if i ignore") ||
    normalizedQuestion.includes("ignore this")
  ) {
    return deriveIgnoreConsequence(topFocus);
  }

  if (
    normalizedQuestion.includes("what needs attention first") ||
    normalizedQuestion.includes("attention first") ||
    normalizedQuestion.includes("attention") ||
    normalizedQuestion.includes("what matters most")
  ) {
    return (
      decisionNarrative ||
      actionRanking.mostUrgent ||
      recommendedActions[0] ||
      "Start with the highest severity focus item."
    );
  }

  if (normalizedQuestion.includes("fix quickly")) {
    if (bestQuickWins.length > 0) {
      return bestQuickWins[0];
    }
    return `Most items are still high-priority, so start with ${topFocus?.label || "the top risk item"} before quick wins.`;
  }

  if (normalizedQuestion.includes("quickest win") || normalizedQuestion.includes("quick win")) {
    if (bestQuickWins.length > 0) {
      return bestQuickWins[0];
    }
    return topFocus
      ? `Fastest safe move: ${topFocus.label}.`
      : "I don’t see a clear quick win right now in this scope.";
  }

  if (normalizedQuestion.includes("explain this simply") || normalizedQuestion.includes("explain that simply")) {
    if (topFocus) {
      return `Simply put: ${topFocus.label} matters because ${topFocus.reason}`;
    }
    return "Simply put: there isn’t a major risk in this scope right now.";
  }

  if (normalizedQuestion.includes("show me")) {
    if (topTarget) {
      const targetLabel = normalizeNavigationLabel(topTarget.label) || "the top recommended target";
      return `Top target: ${targetLabel}. ${describeTargetPrecision(topTarget)} Use “Take me there”.`;
    }
    if (topFocus) {
      return `Top item right now is ${conciseFocusLine(topFocus, 86)}`;
    }
  }

  if (decisionNarrative) {
    return `${viewPrefix}${decisionNarrative}`.trim();
  }
  if (summary || keyInsights[0]) {
    return `${viewPrefix}${conciseSummary || keyInsights[0]}`.trim();
  }
  return "I’m not seeing a major exception right now. If you want, I can still rank the next best checks.";
}

function buildGeoFieldsCommandAnswer({
  command,
  focusItems,
  summary,
  topTarget
}: {
  command: GeoFieldsDecisionCommand;
  focusItems: CopilotFocusItem[];
  summary: string;
  topTarget: CopilotNavigationTarget | null;
}) {
  const focus = resolveFocusByCommand({ command, focusItems });
  const focusTarget =
    focus && focus.href
      ? ({
          label: focus.label,
          href: focus.href,
          reason: focus.reason,
          targetId: focus.targetId,
          sectionId: focus.sectionId,
          pageKey: focus.targetPageKey
        } satisfies CopilotNavigationTarget)
      : topTarget;

  if (!focus) {
    if (command === "DATA_GAPS_HURTING_REPORTS") {
      return `${compactSummaryLine(summary)} No major linkage or attribution gaps are visible in this scope.`.trim();
    }
    return `${compactSummaryLine(summary)} I don’t have a strong scoped record for that command yet.`.trim();
  }

  const targetHint =
    focus.href || focus.targetId || focus.sectionId
      ? ` ${focusTarget ? describeTargetPrecision(focusTarget) : "Use the action link to jump to this record."}`
      : "";

  if (command === "TOP_REVENUE_RIG") {
    return `Top revenue rig: ${focus.label}. Why: ${condenseReason(focus.reason, 88)}.${targetHint}`.trim();
  }
  if (command === "HIGHEST_EXPENSE_RIG") {
    return `Highest expense rig: ${focus.label}. Why: ${condenseReason(
      focus.reason,
      82
    )}. Next: confirm cost controls and operational necessity.${targetHint}`.trim();
  }
  if (command === "RIGS_NEEDING_ATTENTION") {
    const additional = rankFocusItems(
      focusItems.filter((item) =>
        ["RIG_RISK", "RIG_UTILIZATION", "MAINTENANCE"].includes(normalizeIssueType(item.issueType))
      )
    )
      .slice(1, 3)
      .map((item) => item.label);
    return `${focus.label} should be first. Why: ${condenseReason(focus.reason, 78)}.${
      additional.length > 0 ? ` Then review ${additional.join(", ")}.` : ""
    }${targetHint}`.trim();
  }
  if (command === "PENDING_MAINTENANCE_RISKS" || command === "TOP_MAINTENANCE_ISSUE") {
    return `Top maintenance risk: ${focus.label}. Why: ${condenseReason(
      focus.reason,
      84
    )}. Next: prioritize approval/escalation based on downtime and urgency.${targetHint}`.trim();
  }
  if (command === "BIGGEST_PROFITABILITY_ISSUE") {
    return `Biggest profitability issue: ${focus.label}. Why: ${condenseReason(
      focus.reason,
      86
    )}.${targetHint}`.trim();
  }
  if (command === "DATA_GAPS_HURTING_REPORTS") {
    return `Top data gap: ${focus.label}. Why: ${condenseReason(
      focus.reason,
      84
    )}. Next: fix linkage to improve reporting confidence.${targetHint}`.trim();
  }
  if (command === "TOP_RIG_RISK") {
    return `Top rig risk: ${focus.label}. Why: ${condenseReason(
      focus.reason,
      84
    )}. Next: inspect this before lower-severity rig items.${targetHint}`.trim();
  }
  if (command === "BIGGEST_APPROVAL_ISSUE") {
    return `Biggest approval issue: ${focus.label}. Why: ${condenseReason(
      focus.reason,
      84
    )}. Next: clear this first to unblock downstream decisions.${targetHint}`.trim();
  }
  return null;
}

function resolveSessionSuggestedFocus(context: CopilotPageContext) {
  const items = (context.sessionContext?.recentSuggestedFocus || [])
    .map((entry, index) => {
      const label = (entry.label || "").trim();
      if (!label) {
        return null;
      }
      return {
        id: `session-focus-${index}-${normalizeKey(label)}`,
        label,
        reason:
          (entry.reason || "").trim() || "Recent copilot recommendation from your previous context.",
        severity: normalizeSeverity(entry.severity || "MEDIUM"),
        amount: null,
        href: entry.href || undefined,
        issueType: normalizeIssueType(entry.issueType),
        targetId: entry.targetId || undefined,
        sectionId: entry.sectionId || undefined,
        targetPageKey: entry.pageKey || inferPageKeyFromHref(entry.href || undefined),
        confidence: null
      } satisfies CopilotFocusItem;
    })
    .filter(Boolean) as CopilotFocusItem[];

  const currentFocusLabel = context.sessionContext?.currentFocusTarget?.label?.trim();
  if (currentFocusLabel) {
    items.unshift({
      id: `session-current-focus-${normalizeKey(currentFocusLabel)}`,
      label: currentFocusLabel,
      reason: "Current focus target from your recent navigation.",
      severity: "MEDIUM",
      amount: null,
      href: context.sessionContext?.currentFocusTarget?.href || undefined,
      issueType: "GENERAL",
      targetId: context.sessionContext?.currentFocusTarget?.targetId || undefined,
      sectionId: context.sessionContext?.currentFocusTarget?.sectionId || undefined,
      targetPageKey:
        context.sessionContext?.currentFocusTarget?.pageKey ||
        inferPageKeyFromHref(context.sessionContext?.currentFocusTarget?.href || undefined),
      confidence: null
    });
  }

  return dedupeFocusCandidatesByRecord(items).slice(0, 8);
}

function dedupeFocusCandidatesByRecord(items: CopilotFocusItem[]) {
  const seen = new Set<string>();
  const deduped: CopilotFocusItem[] = [];
  for (const item of items) {
    const key =
      (item.targetPageKey || "page") +
      "::" +
      (item.targetId || item.id || normalizeKey(item.label || "item"));
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(item);
  }
  return deduped;
}

function findFocusByIssueType(items: CopilotFocusItem[], issueTypes: string[]) {
  const normalizedTargets = issueTypes.map((type) => normalizeIssueType(type));
  return items.find((item) => normalizedTargets.includes(normalizeIssueType(item.issueType)));
}

function findFocusByKeywords(items: CopilotFocusItem[], keywords: string[]) {
  const normalizedKeywords = keywords.map((entry) => entry.toLowerCase());
  return items.find((item) => {
    const haystack = `${item.label} ${item.reason}`.toLowerCase();
    return normalizedKeywords.some((keyword) => haystack.includes(keyword));
  });
}

function dedupeInsightCardsByKind(cards: CopilotInsightCard[]) {
  const seen = new Set<CopilotInsightCardKind>();
  const deduped: CopilotInsightCard[] = [];
  for (const card of cards) {
    if (seen.has(card.kind)) {
      continue;
    }
    seen.add(card.kind);
    deduped.push(card);
  }
  return deduped;
}

function resolveReferencedFocus(
  normalizedQuestion: string,
  context: CopilotPageContext,
  candidates: CopilotFocusItem[]
) {
  if (candidates.length === 0) {
    return null;
  }

  const currentFocusTarget = context.sessionContext?.currentFocusTarget;
  const referencesPrevious =
    normalizedQuestion.includes("that item") ||
    normalizedQuestion.includes("that one") ||
    normalizedQuestion.includes("that issue") ||
    normalizedQuestion.includes("the one you just showed") ||
    normalizedQuestion.includes("you just showed") ||
    normalizedQuestion.includes("previous one") ||
    normalizedQuestion.includes("the one from earlier");

  if (normalizedQuestion.includes("biggest budget problem")) {
    return (
      rankFocusItems(
        candidates.filter((item) => {
          const issueType = normalizeIssueType(item.issueType);
          return issueType === "BUDGET_PRESSURE" || issueType === "NO_BUDGET";
        })
      )[0] || candidates[0]
    );
  }

  if (isSalaryReference(normalizedQuestion)) {
    const salaryFocus = findSalaryFocus(candidates);
    return salaryFocus || null;
  }

  if (referencesPrevious && currentFocusTarget) {
    const byTarget =
      (currentFocusTarget.targetId
        ? candidates.find((item) => item.targetId === currentFocusTarget.targetId)
        : null) ||
      (currentFocusTarget.sectionId
        ? candidates.find((item) => item.sectionId === currentFocusTarget.sectionId)
        : null) ||
      (currentFocusTarget.label
        ? candidates.find(
            (item) => normalizeKey(item.label) === normalizeKey(currentFocusTarget.label || "")
          )
        : null);
    if (byTarget) {
      return byTarget;
    }
  }

  if (referencesPrevious) {
    const recentSuggested = resolveSessionSuggestedFocus(context)[0];
    if (recentSuggested) {
      return recentSuggested;
    }
  }

  return candidates[0] || null;
}

function isSalaryReference(normalizedQuestion: string) {
  return (
    normalizedQuestion.includes("salary issue") ||
    normalizedQuestion.includes("salary") ||
    normalizedQuestion.includes("payroll")
  );
}

function findSalaryFocus(candidates: CopilotFocusItem[]) {
  return candidates.find((item) => /salary|payroll|wage|labor/i.test(`${item.label} ${item.reason}`));
}

function resolveTargetPrecision({
  targetId,
  sectionId
}: {
  targetId?: string | null;
  sectionId?: string | null;
}): CopilotNavigationTarget["targetPrecision"] {
  if (targetId) {
    return "EXACT_ROW";
  }
  if (sectionId) {
    return "SECTION";
  }
  return "PAGE";
}

function describeTargetPrecision(target: CopilotNavigationTarget) {
  const precision = target.targetPrecision || resolveTargetPrecision(target);
  if (target.availabilityNote) {
    return target.availabilityNote;
  }
  if (precision === "EXACT_ROW") {
    return "I’ll open and highlight the exact row.";
  }
  if (precision === "SECTION") {
    return "I’ll open the page and focus the closest section.";
  }
  return "I’ll open the right page (exact row targeting isn’t available here).";
}

function isNavigationIntent(normalizedQuestion: string) {
  return (
    normalizedQuestion.includes("show me") ||
    normalizedQuestion === "show me" ||
    normalizedQuestion === "show me." ||
    normalizedQuestion === "take me there" ||
    normalizedQuestion === "take me there." ||
    normalizedQuestion.includes("take me there") ||
    normalizedQuestion.includes("take me to") ||
    normalizedQuestion.includes("open this") ||
    normalizedQuestion.includes("open that") ||
    normalizedQuestion.includes("open the record") ||
    normalizedQuestion.includes("open the item") ||
    normalizedQuestion.includes("open the one") ||
    normalizedQuestion.includes("go there") ||
    normalizedQuestion.includes("navigate")
  );
}

function normalizeNavigationLabel(label: string) {
  return label.replace(/^open\s+/i, "").trim();
}

function prioritizeNavigationTargets({
  question,
  context,
  focusItems,
  navigationTargets
}: {
  question: string;
  context: CopilotPageContext;
  focusItems: CopilotFocusItem[];
  navigationTargets: CopilotNavigationTarget[];
}) {
  const normalizedQuestion = question.toLowerCase();
  if (!isNavigationIntent(normalizedQuestion) && !normalizedQuestion.includes("show me")) {
    return navigationTargets;
  }

  const topFocus = focusItems.find((item) => item.href || item.targetId || item.sectionId);
  if (!topFocus) {
    return navigationTargets;
  }

  const directTarget: CopilotNavigationTarget = {
    label: topFocus.label || "Top recommendation",
    href: topFocus.href || resolveScopedPageHref(context),
    reason: topFocus.reason,
    targetId: topFocus.targetId,
    sectionId: topFocus.sectionId,
    pageKey: topFocus.targetPageKey || inferPageKeyFromHref(topFocus.href),
    targetPrecision: resolveTargetPrecision({
      targetId: topFocus.targetId,
      sectionId: topFocus.sectionId
    }),
    availabilityNote: topFocus.targetId
      ? "I’ll open the exact row/card and highlight it."
      : topFocus.sectionId
        ? "Exact row isn’t available here, so I’ll focus the closest section."
        : "I’ll open the related page; exact in-page targeting is unavailable for this item."
  };

  return dedupeNavigationTargets([directTarget, ...navigationTargets]).slice(0, 6);
}

function calculatePriorityScore({
  context,
  focusItems
}: {
  context: CopilotPageContext;
  focusItems: CopilotFocusItem[];
}) {
  let score = 20;
  score += clamp(findMetricValue(context.summaryMetrics, [/overspent/i]) * 18, 0, 42);
  score += clamp(findMetricValue(context.summaryMetrics, [/critical/i]) * 10, 0, 24);
  score += clamp(findMetricValue(context.summaryMetrics, [/pending approvals?/i]) * 2, 0, 16);
  score += clamp(findMetricValue(context.summaryMetrics, [/missing.*linkage/i]) * 4, 0, 18);
  score += clamp(focusItems.filter((item) => item.severity === "CRITICAL").length * 8, 0, 20);
  score += clamp(focusItems.filter((item) => item.severity === "HIGH").length * 4, 0, 12);
  return clamp(score, 0, 100);
}

function resolvePriorityLabel(score: number): ContextualCopilotResponsePayload["aiPriorityLabel"] {
  if (score >= 85) {
    return "Urgent";
  }
  if (score >= 65) {
    return "High";
  }
  if (score >= 40) {
    return "Medium";
  }
  return "Low";
}

function mergeFocusItemsByRecord(items: CopilotFocusItem[]) {
  const grouped = new Map<string, CopilotFocusItem[]>();
  for (const item of items) {
    const key = resolveFocusRecordKey(item);
    const current = grouped.get(key) || [];
    current.push(item);
    grouped.set(key, current);
  }

  const merged: CopilotFocusItem[] = [];
  for (const [, group] of grouped) {
    const ranked = rankFocusItems(group);
    const primary = ranked[0];
    if (!primary) {
      continue;
    }

    const issueTypes = dedupeText(group.map((item) => normalizeIssueType(item.issueType)));
    const reasons = dedupeText(group.map((item) => item.reason));
    const numericAmounts = group
      .map((item) => item.amount)
      .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
    const mergedAmount = numericAmounts.length > 0 ? Math.max(...numericAmounts) : null;
    const mergedReason =
      reasons.length <= 1
        ? primary.reason
        : `${primary.reason} Also: ${reasons
            .filter((reason) => reason !== primary.reason)
            .slice(0, 2)
            .join(" | ")}`;

    merged.push({
      ...primary,
      severity: ranked[0].severity,
      amount: mergedAmount,
      reason: mergedReason,
      issueType: issueTypes.length > 1 ? issueTypes.join("+") : issueTypes[0] || primary.issueType,
      actionLabel: primary.actionLabel || group.find((item) => Boolean(item.actionLabel))?.actionLabel,
      inspectHint: primary.inspectHint || group.find((item) => Boolean(item.inspectHint))?.inspectHint,
      href: primary.href || group.find((item) => Boolean(item.href))?.href,
      targetId: primary.targetId || group.find((item) => Boolean(item.targetId))?.targetId,
      sectionId: primary.sectionId || group.find((item) => Boolean(item.sectionId))?.sectionId,
      targetPageKey: primary.targetPageKey || group.find((item) => Boolean(item.targetPageKey))?.targetPageKey,
      confidence: primary.confidence || group.find((item) => item.confidence)?.confidence || null
    });
  }

  return merged;
}

function resolveFocusRecordKey(item: CopilotFocusItem) {
  if (item.targetId) {
    return `${item.targetPageKey || "page"}::target::${item.targetId}`;
  }
  if (item.id) {
    const normalizedId = item.id.replace(/^(queue|budget|alert|linkage|focus)-/i, "");
    return `${item.targetPageKey || "page"}::id::${normalizedId}`;
  }
  return `${item.targetPageKey || "page"}::label::${normalizeKey(item.label)}`;
}

function applyRoleFocusMetadata(items: CopilotFocusItem[], roleProfile: CopilotRoleProfile) {
  return items.map((item) => ({
    ...item,
    actionLabel: item.actionLabel || resolveRoleActionLabel(roleProfile, item),
    inspectHint: item.inspectHint || resolveRoleInspectHint(roleProfile, item)
  }));
}

function resolveRoleActionLabel(roleProfile: CopilotRoleProfile, item: CopilotFocusItem) {
  const issueType = normalizeIssueType(item.issueType);
  const haystack = `${item.label} ${item.reason}`.toLowerCase();

  if (roleProfile.segment === "MANAGEMENT") {
    if (issueType === "APPROVAL_BACKLOG") return "Review approval";
    if (issueType === "MAINTENANCE" || issueType === "RIG_RISK") return "Review maintenance";
    if (issueType === "PROFITABILITY" || issueType === "COST_DRIVER") return "Inspect profitability";
    if (issueType === "LINKAGE") return "Review linkage impact";
    return "Inspect risk";
  }

  if (roleProfile.segment === "OFFICE") {
    if (issueType === "APPROVAL_BACKLOG") return "Review approval";
    if (issueType === "LINKAGE") return "Inspect linkage";
    if (/receipt|invoice|submission/.test(haystack)) return "Review receipt";
    if (/inventory|stock|movement/.test(haystack)) return "Inspect inventory issue";
    return "Complete record";
  }

  if (roleProfile.segment === "MECHANIC") {
    if (issueType === "MAINTENANCE") return "Review maintenance";
    if (issueType === "RIG_RISK" || /rig/.test(haystack)) return "Inspect rig";
    if (/parts|stock|filter|belt|hose|repair/.test(haystack)) return "Review parts need";
    return "Inspect downtime issue";
  }

  if (roleProfile.segment === "OPERATIONS") {
    if (/report|drilling|submission/.test(haystack)) return "Complete report";
    if (/entry|meters|production/.test(haystack)) return "Review drilling entry";
    if (/project/.test(haystack)) return "Inspect project update";
    return "Review rig assignment";
  }

  return "Open record";
}

function resolveRoleInspectHint(roleProfile: CopilotRoleProfile, item: CopilotFocusItem) {
  const issueType = normalizeIssueType(item.issueType);
  if (roleProfile.segment === "MECHANIC") {
    if (issueType === "MAINTENANCE") {
      return "Inspect urgency, downtime, and parts dependency before escalating.";
    }
    if (issueType === "RIG_RISK") {
      return "Inspect rig condition trend and recent repair history.";
    }
  }
  if (roleProfile.segment === "OFFICE" && issueType === "LINKAGE") {
    return "Inspect missing rig/project/maintenance fields and complete the record.";
  }
  if (roleProfile.segment === "OPERATIONS" && issueType === "APPROVAL_BACKLOG") {
    return "Inspect report completeness and missing production values before submission follow-up.";
  }
  if (roleProfile.segment === "MANAGEMENT" && issueType === "PROFITABILITY") {
    return "Inspect spend versus revenue concentration before deciding next containment action.";
  }
  return item.inspectHint || undefined;
}

function roleIssuePriorityBoost({
  item,
  roleProfile
}: {
  item: CopilotFocusItem;
  roleProfile: CopilotRoleProfile | null;
}) {
  if (!roleProfile || roleProfile.segment === "GENERAL") {
    return 0;
  }

  const issueType = normalizeIssueType(item.issueType);
  const haystack = `${item.label} ${item.reason}`.toLowerCase();
  let boost = 0;

  if (roleProfile.segment === "MANAGEMENT") {
    if (["BUDGET_PRESSURE", "PROFITABILITY", "APPROVAL_BACKLOG", "MAINTENANCE", "LINKAGE", "COST_DRIVER", "RIG_SPEND", "PROJECT_SPEND"].includes(issueType)) {
      boost += 24;
    }
    if (/client|project|profit|margin|overspent|bottleneck/.test(haystack)) {
      boost += 8;
    }
  } else if (roleProfile.segment === "OFFICE") {
    if (["APPROVAL_BACKLOG", "LINKAGE", "COST_DRIVER", "RIG_SPEND", "PROJECT_SPEND", "NO_BUDGET"].includes(issueType)) {
      boost += 24;
    }
    if (/receipt|expense|inventory|stock|completion|missing/.test(haystack)) {
      boost += 9;
    }
  } else if (roleProfile.segment === "MECHANIC") {
    if (["MAINTENANCE", "RIG_RISK", "RIG_SPEND"].includes(issueType)) {
      boost += 28;
    }
    if (/breakdown|repair|parts|downtime|rig|workshop/.test(haystack)) {
      boost += 10;
    }
    if (["PROFITABILITY", "REVENUE_OPPORTUNITY", "COST_DRIVER", "PROJECT_SPEND", "BUDGET_PRESSURE"].includes(issueType)) {
      boost -= 22;
    }
  } else if (roleProfile.segment === "OPERATIONS") {
    if (["APPROVAL_BACKLOG", "RIG_RISK", "LINKAGE"].includes(issueType)) {
      boost += 22;
    }
    if (/report|drilling|submission|production|assignment|project update|delayed/.test(haystack)) {
      boost += 12;
    }
    if (["PROFITABILITY", "BUDGET_PRESSURE", "REVENUE_OPPORTUNITY"].includes(issueType)) {
      boost -= 14;
    }
  }

  return boost;
}

function rankFocusItems(items: CopilotFocusItem[], roleProfile: CopilotRoleProfile | null = null) {
  return [...items].sort((a, b) => {
    const roleScoreDiff =
      roleIssuePriorityBoost({ item: b, roleProfile }) - roleIssuePriorityBoost({ item: a, roleProfile });
    if (roleScoreDiff !== 0) {
      return roleScoreDiff;
    }
    const severityDiff = focusSeverityRank(a.severity) - focusSeverityRank(b.severity);
    if (severityDiff !== 0) {
      return severityDiff;
    }
    const amountA = a.amount ?? 0;
    const amountB = b.amount ?? 0;
    if (amountB !== amountA) {
      return amountB - amountA;
    }
    return a.label.localeCompare(b.label);
  });
}

function rankFocusItemsForDecisionGuidance(
  items: CopilotFocusItem[],
  roleProfile:
    | {
        segment: "MANAGEMENT" | "OFFICE" | "MECHANIC" | "OPERATIONS" | "GENERAL";
      }
    | null
    | undefined
) {
  return rankFocusItems(items, (roleProfile as CopilotRoleProfile | null) || null);
}

function dedupeNavigationTargets(targets: CopilotNavigationTarget[]) {
  return dedupeNavigationTargetsByPrecision(targets, resolveTargetPrecision);
}
