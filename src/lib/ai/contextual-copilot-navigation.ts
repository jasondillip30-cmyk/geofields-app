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
  resolveGeoFieldsDecisionCommand
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
  findMetricValue
} from "@/lib/ai/contextual-copilot-ranking";
import { COPILOT_NAVIGATION_FALLBACKS } from "@/lib/ai/contextual-copilot-navigation-fallbacks";
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
import { buildGeoFieldsCommandAnswer } from "@/lib/ai/contextual-copilot-geo-command";
import {
  findFocusByIssueType,
  findFocusByKeywords,
  resolveFocusByCommand
} from "@/lib/ai/contextual-copilot-focus-selection";
import {
  applyRoleFocusMetadata,
  rankFocusItems,
  rankFocusItemsForDecisionGuidance
} from "@/lib/ai/contextual-copilot-role-focus";
import { isForecastingEnabled } from "@/lib/feature-flags";

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
  const explicitTargets = dedupeNavigationTargets(filterForecastingTargets(context.navigationTargets || []));
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
  const filteredFocusTargets = filterForecastingTargets(focusTargets);
  const fallbackTargets = filterForecastingTargets(COPILOT_NAVIGATION_FALLBACKS[context.pageKey] || []);

  if (explicitTargets.length > 0) {
    return dedupeNavigationTargets([...explicitTargets, ...filteredFocusTargets]).slice(0, 6);
  }

  return dedupeNavigationTargets([...fallbackTargets, ...filteredFocusTargets]).slice(0, 6);
}

function filterForecastingTargets(targets: CopilotNavigationTarget[]) {
  if (isForecastingEnabled()) {
    return targets;
  }
  return targets.filter((target) => {
    const href = target.href || "";
    return !href.startsWith("/forecasting");
  });
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
      topTarget,
      resolveFocusByCommand,
      describeTargetPrecision,
      rankFocusItems
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

function dedupeNavigationTargets(targets: CopilotNavigationTarget[]) {
  return dedupeNavigationTargetsByPrecision(targets, resolveTargetPrecision);
}

export {
  applyRoleFocusMetadata,
  findFocusByIssueType,
  findFocusByKeywords,
  rankFocusItems,
  rankFocusItemsForDecisionGuidance,
  resolveFocusByCommand
};
