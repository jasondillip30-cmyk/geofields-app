import type { UserRole } from "@/lib/types";
import type {
  ContextualCopilotResponsePayload,
  CopilotConversationIntent,
  CopilotInsightCardKind,
  CopilotIntent,
  CopilotPageContext
} from "@/lib/ai/contextual-copilot-types";
import {
  isBroadGeneralQuestion,
  isClarificationQuestion,
  isComparisonQuestion,
  isFollowUpReference,
  isGeneralExplanationQuestion,
  isPlanningQuestion,
  isSmallTalk,
  isSummaryQuestion,
  normalizeUserQuestion
} from "@/lib/ai/contextual-copilot-intents";
import {
  buildAnswer,
  calculatePriorityScore,
  isNavigationIntent,
  prioritizeFocusItemsForQuestion,
  prioritizeNavigationTargets,
  resolvePriorityLabel,
  resolveNavigationTargets
} from "@/lib/ai/contextual-copilot-navigation";
import { deriveFocusItems } from "@/lib/ai/contextual-copilot-focus";
import {
  deriveActionRanking,
  deriveBestQuickWins,
  deriveFollowUpQuestions,
  deriveInsightCards,
  deriveKeyInsights,
  derivePrimarySupportingFocus,
  deriveRecommendedActions,
  deriveSummary
} from "@/lib/ai/contextual-copilot-insights";

export type {
  ContextualCopilotRequestBody,
  ContextualCopilotResponsePayload,
  CopilotConversationIntent,
  CopilotFocusItem,
  CopilotFocusSeverity,
  CopilotInsightCard,
  CopilotInsightCardKind,
  CopilotIntent,
  CopilotNavigationTarget,
  CopilotPageContext,
  CopilotSelectedItem,
  CopilotSuggestionConfidence,
  CopilotSummaryMetric,
  CopilotTablePreview
} from "@/lib/ai/contextual-copilot-types";

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
