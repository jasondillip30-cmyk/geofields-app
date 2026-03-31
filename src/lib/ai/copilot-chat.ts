import type {
  CopilotChatIntent as PrismaCopilotChatIntent,
  CopilotChatMessage,
  CopilotChatRole,
  CopilotChatThread,
  CopilotScopeMode as PrismaCopilotScopeMode
} from "@prisma/client";

import type {
  CopilotFocusSeverity,
  CopilotIntent,
  ContextualCopilotResponsePayload,
  CopilotPageContext
} from "@/lib/ai/contextual-copilot";

export type CopilotScopeMode = "THIS_PAGE" | "RELATED_DATA" | "WHOLE_APP";

export interface CopilotThreadSummaryDto {
  id: string;
  title: string;
  scopeMode: CopilotScopeMode;
  currentPageKey: string | null;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  lastMessagePreview: string | null;
}

export interface CopilotMessageDto {
  id: string;
  role: "user" | "assistant";
  text: string;
  intent: CopilotIntent | null;
  pageKey: string | null;
  scopeMode: CopilotScopeMode | null;
  createdAt: string;
  responseData: ContextualCopilotResponsePayload | null;
}

export function normalizeScopeMode(value: unknown): CopilotScopeMode {
  if (value === "THIS_PAGE" || value === "RELATED_DATA" || value === "WHOLE_APP") {
    return value;
  }
  return "THIS_PAGE";
}

export function normalizeIntentFromDb(value: PrismaCopilotChatIntent | null): CopilotIntent | null {
  if (!value) {
    return null;
  }
  switch (value) {
    case "GENERAL_EXPLANATION":
      return "general_explanation";
    case "APP_GUIDANCE":
      return "app_guidance";
    case "NAVIGATION":
      return "navigation";
    case "COMPARISON":
      return "comparison";
    case "FOLLOW_UP_REFERENCE":
      return "follow_up_reference";
    case "PAGE_SUMMARY":
      return "page_summary";
    case "WHOLE_APP_SUMMARY":
      return "whole_app_summary";
    default:
      return null;
  }
}

export function mapIntentToDb(value: CopilotIntent): PrismaCopilotChatIntent {
  switch (value) {
    case "general_explanation":
      return "GENERAL_EXPLANATION";
    case "app_guidance":
      return "APP_GUIDANCE";
    case "navigation":
      return "NAVIGATION";
    case "comparison":
      return "COMPARISON";
    case "follow_up_reference":
      return "FOLLOW_UP_REFERENCE";
    case "page_summary":
      return "PAGE_SUMMARY";
    case "whole_app_summary":
      return "WHOLE_APP_SUMMARY";
    default:
      return "APP_GUIDANCE";
  }
}

export function mapScopeToDb(value: CopilotScopeMode): PrismaCopilotScopeMode {
  return value;
}

export function mapRoleToDb(value: "user" | "assistant"): CopilotChatRole {
  return value === "assistant" ? "ASSISTANT" : "USER";
}

export function buildThreadTitleFromQuestion(question: string) {
  const normalized = question
    .replace(/\s+/g, " ")
    .replace(/[?!.]+$/g, "")
    .trim();
  if (!normalized) {
    return "New chat";
  }
  const words = normalized.split(" ").slice(0, 8);
  const title = words.join(" ");
  if (title.length <= 56) {
    return capitalizeTitle(title);
  }
  return `${capitalizeTitle(title.slice(0, 53).trim())}…`;
}

function capitalizeTitle(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function toThreadSummaryDto({
  thread,
  messageCount,
  lastMessage
}: {
  thread: CopilotChatThread;
  messageCount: number;
  lastMessage: CopilotChatMessage | null;
}): CopilotThreadSummaryDto {
  return {
    id: thread.id,
    title: thread.title,
    scopeMode: normalizeScopeMode(thread.scopeMode),
    currentPageKey: thread.currentPageKey || null,
    createdAt: thread.createdAt.toISOString(),
    updatedAt: thread.updatedAt.toISOString(),
    messageCount,
    lastMessagePreview: lastMessage?.content?.slice(0, 120) || null
  };
}

export function toMessageDto(message: CopilotChatMessage): CopilotMessageDto {
  return {
    id: message.id,
    role: message.role === "ASSISTANT" ? "assistant" : "user",
    text: message.content,
    intent: normalizeIntentFromDb(message.intent),
    pageKey: message.pageKey || null,
    scopeMode: message.scopeMode ? normalizeScopeMode(message.scopeMode) : null,
    createdAt: message.createdAt.toISOString(),
    responseData: parseJson<ContextualCopilotResponsePayload>(message.responseDataJson)
  };
}

export function parseJson<T>(value: string | null | undefined): T | null {
  if (!value) {
    return null;
  }
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

export function mergeThreadConversationContext({
  context,
  previousMessages
}: {
  context: CopilotPageContext;
  previousMessages: CopilotMessageDto[];
}): CopilotPageContext {
  const priorConversation = previousMessages
    .slice(-16)
    .map((message) => ({
      role: message.role,
      text: message.text,
      pageKey: message.pageKey || context.pageKey,
      createdAt: new Date(message.createdAt).getTime()
    }))
    .reverse();

  const priorSuggestedFocus = previousMessages
    .filter((message) => message.role === "assistant" && message.responseData?.focusItems?.length)
    .slice(-10)
    .flatMap((message) => {
      const top = message.responseData?.focusItems?.[0];
      if (!top) {
        return [];
      }
      return [
        {
          pageKey: top.targetPageKey || message.pageKey || context.pageKey,
          label: top.label,
          reason: top.reason || null,
          severity: top.severity || null,
          issueType: top.issueType || null,
          href: top.href || null,
          targetId: top.targetId || null,
          sectionId: top.sectionId || null,
          createdAt: new Date(message.createdAt).getTime()
        }
      ];
    });

  return {
    ...context,
    sessionContext: {
      recentQuestions: context.sessionContext?.recentQuestions || [],
      recentPageKeys: context.sessionContext?.recentPageKeys || [],
      recentConversation: dedupeConversation([
        ...priorConversation,
        ...(context.sessionContext?.recentConversation || [])
      ]),
      recentSuggestedFocus: dedupeSuggestedFocus([
        ...priorSuggestedFocus,
        ...(context.sessionContext?.recentSuggestedFocus || [])
      ]),
      currentFocusTarget: context.sessionContext?.currentFocusTarget || null
    }
  };
}

function dedupeConversation(
  entries: Array<{
    role?: "user" | "assistant";
    text?: string;
    pageKey?: string;
    createdAt?: number;
  }>
) {
  const seen = new Set<string>();
  const result: Array<{
    role: "user" | "assistant";
    text: string;
    pageKey: string;
    createdAt: number;
  }> = [];
  for (const entry of entries) {
    const role = entry.role === "assistant" ? "assistant" : "user";
    const text = (entry.text || "").trim();
    const pageKey = (entry.pageKey || "workspace").trim() || "workspace";
    const createdAt = typeof entry.createdAt === "number" ? entry.createdAt : Date.now();
    if (!text) {
      continue;
    }
    const key = `${role}:${pageKey}:${text.toLowerCase()}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push({ role, text, pageKey, createdAt });
    if (result.length >= 16) {
      break;
    }
  }
  return result;
}

function dedupeSuggestedFocus(
  entries: Array<{
    pageKey?: string;
    label?: string;
    reason?: string | null;
    severity?: CopilotFocusSeverity | string | null;
    issueType?: string | null;
    href?: string | null;
    targetId?: string | null;
    sectionId?: string | null;
    createdAt?: number;
  }>
) {
  const seen = new Set<string>();
  const result: Array<{
    pageKey?: string;
    label?: string;
    reason?: string | null;
    severity?: CopilotFocusSeverity | null;
    issueType?: string | null;
    href?: string | null;
    targetId?: string | null;
    sectionId?: string | null;
    createdAt?: number;
  }> = [];

  for (const entry of entries) {
    const label = (entry.label || "").trim();
    if (!label) {
      continue;
    }
    const key = `${entry.pageKey || "workspace"}::${entry.targetId || ""}::${entry.sectionId || ""}::${label.toLowerCase()}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push({
      pageKey: entry.pageKey || "workspace",
      label,
      reason: entry.reason || null,
      severity: normalizeFocusSeverity(entry.severity),
      issueType: entry.issueType || null,
      href: entry.href || null,
      targetId: entry.targetId || null,
      sectionId: entry.sectionId || null,
      createdAt: entry.createdAt || Date.now()
    });
    if (result.length >= 12) {
      break;
    }
  }

  return result;
}

function normalizeFocusSeverity(value: CopilotFocusSeverity | string | null | undefined): CopilotFocusSeverity | null {
  if (value === "CRITICAL" || value === "HIGH" || value === "MEDIUM" || value === "LOW") {
    return value;
  }
  return null;
}
