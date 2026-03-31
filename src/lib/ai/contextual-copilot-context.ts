import type { CopilotPageContext } from "@/lib/ai/contextual-copilot";

export const fallbackCopilotContext: CopilotPageContext = {
  pageKey: "workspace",
  pageName: "Current Workspace",
  filters: {
    clientId: null,
    rigId: null,
    from: null,
    to: null
  },
  summaryMetrics: []
};

export function normalizeCopilotContext(context: CopilotPageContext): CopilotPageContext {
  return {
    ...context,
    pageKey: context.pageKey || "workspace",
    pageName: context.pageName || "Current Workspace",
    viewerRole: typeof context.viewerRole === "string" ? context.viewerRole.trim().toUpperCase() : context.viewerRole || null,
    scopeMode: context.scopeMode || "THIS_PAGE",
    sourcePageKeys: Array.isArray(context.sourcePageKeys) ? context.sourcePageKeys.slice(0, 16) : [],
    filters: context.filters || fallbackCopilotContext.filters,
    summaryMetrics: Array.isArray(context.summaryMetrics) ? context.summaryMetrics : [],
    tablePreviews: Array.isArray(context.tablePreviews) ? context.tablePreviews.slice(0, 12) : [],
    selectedItems: Array.isArray(context.selectedItems) ? context.selectedItems.slice(0, 25) : [],
    priorityItems: Array.isArray(context.priorityItems) ? context.priorityItems.slice(0, 20) : [],
    navigationTargets: Array.isArray(context.navigationTargets) ? context.navigationTargets.slice(0, 12) : [],
    notes: Array.isArray(context.notes) ? context.notes.slice(0, 10) : [],
    sessionContext: {
      recentQuestions: Array.isArray(context.sessionContext?.recentQuestions)
        ? context.sessionContext?.recentQuestions.slice(0, 8)
        : [],
      recentPageKeys: Array.isArray(context.sessionContext?.recentPageKeys)
        ? context.sessionContext?.recentPageKeys.slice(0, 8)
        : [],
      recentConversation: Array.isArray(context.sessionContext?.recentConversation)
        ? context.sessionContext?.recentConversation.slice(0, 16)
        : [],
      recentSuggestedFocus: Array.isArray(context.sessionContext?.recentSuggestedFocus)
        ? context.sessionContext?.recentSuggestedFocus.slice(0, 12)
        : [],
      currentFocusTarget: context.sessionContext?.currentFocusTarget
        ? {
            pageKey: context.sessionContext.currentFocusTarget.pageKey || null,
            href: context.sessionContext.currentFocusTarget.href || null,
            targetId: context.sessionContext.currentFocusTarget.targetId || null,
            sectionId: context.sessionContext.currentFocusTarget.sectionId || null,
            label: context.sessionContext.currentFocusTarget.label || null
          }
        : null
    }
  };
}
