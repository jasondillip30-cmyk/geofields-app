import type { UserRole } from "@/lib/types";
import type {
  ContextualCopilotResponsePayload,
  CopilotConversationIntent,
  CopilotFocusItem,
  CopilotInsightCard,
  CopilotInsightCardKind,
  CopilotIntent,
  CopilotNavigationTarget,
  CopilotPageContext
} from "@/lib/ai/contextual-copilot-types";
import {
  buildGeneralExplanationAnswer,
  buildSmallTalkAnswer,
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
  inferPageKeyFromHref,
  normalizeIssueType,
  normalizeSeverity,
  resolveScopedPageHref
} from "@/lib/ai/contextual-copilot-context";
import {
  clamp,
  dedupeNavigationTargets as dedupeNavigationTargetsByPrecision,
  findMetricValue,
  focusSeverityRank
} from "@/lib/ai/contextual-copilot-ranking";
import {
  buildComparisonAnswer,
  buildDecisionFirstNarrative,
  buildDecisionGuidance,
  deriveIgnoreConsequence,
  resolveDelayRisk,
  resolveEffortLabel,
  resolveImpactLabel,
  resolveUrgencyLabel,
  resolveDecisionPlanItems
} from "@/lib/ai/contextual-copilot-response";

type CopilotRoleSegment = "MANAGEMENT" | "OFFICE" | "MECHANIC" | "OPERATIONS" | "GENERAL";

interface CopilotRoleProfile {
  role: UserRole | null;
  segment: CopilotRoleSegment;
  preferredCardKinds: ContextualCopilotResponsePayload["insightCards"][number]["kind"][];
  followUpPrompts: string[];
}

export function resolveNavigationTargets({
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


export function prioritizeFocusItemsForQuestion({
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

export function resolveFocusByCommand({
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


export function buildAnswer({
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

export function dedupeFocusCandidatesByRecord(items: CopilotFocusItem[]) {
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

export function findFocusByIssueType(items: CopilotFocusItem[], issueTypes: string[]) {
  const normalizedTargets = issueTypes.map((type) => normalizeIssueType(type));
  return items.find((item) => normalizedTargets.includes(normalizeIssueType(item.issueType)));
}

export function findFocusByKeywords(items: CopilotFocusItem[], keywords: string[]) {
  const normalizedKeywords = keywords.map((entry) => entry.toLowerCase());
  return items.find((item) => {
    const haystack = `${item.label} ${item.reason}`.toLowerCase();
    return normalizedKeywords.some((keyword) => haystack.includes(keyword));
  });
}

export function dedupeInsightCardsByKind(cards: CopilotInsightCard[]) {
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

export function isNavigationIntent(normalizedQuestion: string) {
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

export function prioritizeNavigationTargets({
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

export function calculatePriorityScore({
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

export function resolvePriorityLabel(score: number): ContextualCopilotResponsePayload["aiPriorityLabel"] {
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

export function mergeFocusItemsByRecord(items: CopilotFocusItem[]) {
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

export function applyRoleFocusMetadata(items: CopilotFocusItem[], roleProfile: CopilotRoleProfile) {
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

export function rankFocusItems(items: CopilotFocusItem[], roleProfile: CopilotRoleProfile | null = null) {
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

export function rankFocusItemsForDecisionGuidance(
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
