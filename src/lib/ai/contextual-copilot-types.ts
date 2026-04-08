import type { UserRole } from "@/lib/types";

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
