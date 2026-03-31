"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";

import type { CopilotFocusSeverity, CopilotPageContext } from "@/lib/ai/contextual-copilot";

interface CopilotSessionFocusTarget {
  pageKey: string;
  href?: string | null;
  targetId?: string | null;
  sectionId?: string | null;
  label?: string | null;
  requestedAt: number;
}

interface CopilotSessionPageVisit {
  pageKey: string;
  pageName: string;
  visitedAt: number;
}

interface CopilotSessionMemory {
  recentQuestions: string[];
  recentPageVisits: CopilotSessionPageVisit[];
  currentFocusTarget: CopilotSessionFocusTarget | null;
  recentSuggestedFocus: Array<{
    pageKey: string;
    label: string;
    reason?: string | null;
    severity?: CopilotFocusSeverity | null;
    issueType?: string | null;
    href?: string | null;
    targetId?: string | null;
    sectionId?: string | null;
    createdAt: number;
  }>;
  recentConversation: Array<{
    role: "user" | "assistant";
    text: string;
    pageKey: string;
    createdAt: number;
  }>;
}

interface AiCopilotContextValue {
  pageContext: CopilotPageContext | null;
  setPageContext: (next: CopilotPageContext | null) => void;
  contextRegistry: Record<string, CopilotPageContext>;
  isCopilotOpen: boolean;
  openCopilot: () => void;
  closeCopilot: () => void;
  toggleCopilot: () => void;
  sessionMemory: CopilotSessionMemory;
  rememberQuestion: (question: string) => void;
  rememberPageVisit: (visit: { pageKey: string; pageName: string }) => void;
  rememberFocusTarget: (target: Omit<CopilotSessionFocusTarget, "requestedAt">) => void;
  rememberConversationTurn: (entry: { role: "user" | "assistant"; text: string; pageKey: string }) => void;
  rememberSuggestedFocus: (entry: {
    pageKey: string;
    label: string;
    reason?: string | null;
    severity?: CopilotFocusSeverity | null;
    issueType?: string | null;
    href?: string | null;
    targetId?: string | null;
    sectionId?: string | null;
  }) => void;
}

const AiCopilotContext = createContext<AiCopilotContextValue | null>(null);

const MAX_SESSION_QUESTIONS = 8;
const MAX_SESSION_PAGE_VISITS = 8;
const MAX_SESSION_CONVERSATION = 20;
const MAX_SESSION_SUGGESTED_FOCUS = 12;

export function AiCopilotProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [pageContext, setPageContext] = useState<CopilotPageContext | null>(null);
  const [contextRegistry, setContextRegistry] = useState<Record<string, CopilotPageContext>>({});
  const [isCopilotOpen, setIsCopilotOpen] = useState(false);
  const [sessionMemory, setSessionMemory] = useState<CopilotSessionMemory>({
    recentQuestions: [],
    recentPageVisits: [],
    currentFocusTarget: null,
    recentSuggestedFocus: [],
    recentConversation: []
  });

  const rememberQuestion = useCallback((question: string) => {
    const nextQuestion = question.trim();
    if (!nextQuestion) {
      return;
    }
    setSessionMemory((current) => ({
      ...current,
      recentQuestions: [nextQuestion, ...current.recentQuestions.filter((entry) => entry !== nextQuestion)].slice(
        0,
        MAX_SESSION_QUESTIONS
      )
    }));
  }, []);

  const rememberPageVisit = useCallback(({ pageKey, pageName }: { pageKey: string; pageName: string }) => {
    const nextPageKey = pageKey.trim();
    if (!nextPageKey) {
      return;
    }
    const nextPageName = pageName.trim() || nextPageKey;
    setSessionMemory((current) => {
      if (
        current.recentPageVisits[0]?.pageKey === nextPageKey &&
        current.recentPageVisits[0]?.pageName === nextPageName
      ) {
        return current;
      }
      const deduped = current.recentPageVisits.filter((entry) => entry.pageKey !== nextPageKey);
      return {
        ...current,
        recentPageVisits: [
          {
            pageKey: nextPageKey,
            pageName: nextPageName,
            visitedAt: Date.now()
          },
          ...deduped
        ].slice(0, MAX_SESSION_PAGE_VISITS)
      };
    });
  }, []);

  const rememberFocusTarget = useCallback((target: Omit<CopilotSessionFocusTarget, "requestedAt">) => {
    setSessionMemory((current) => ({
      ...current,
      currentFocusTarget: {
        ...target,
        requestedAt: Date.now()
      }
    }));
  }, []);

  const rememberConversationTurn = useCallback(
    (entry: { role: "user" | "assistant"; text: string; pageKey: string }) => {
      const text = entry.text.trim();
      const pageKey = entry.pageKey.trim();
      if (!text || !pageKey) {
        return;
      }
      setSessionMemory((current) => ({
        ...current,
        recentConversation: [
          {
            role: entry.role,
            text,
            pageKey,
            createdAt: Date.now()
          },
          ...current.recentConversation
        ].slice(0, MAX_SESSION_CONVERSATION)
      }));
    },
    []
  );

  const rememberSuggestedFocus = useCallback(
    (entry: {
      pageKey: string;
      label: string;
      reason?: string | null;
      severity?: CopilotFocusSeverity | null;
      issueType?: string | null;
      href?: string | null;
      targetId?: string | null;
      sectionId?: string | null;
    }) => {
      const pageKey = entry.pageKey.trim();
      const label = entry.label.trim();
      if (!pageKey || !label) {
        return;
      }
      setSessionMemory((current) => {
        const dedupeKey = `${pageKey}::${entry.targetId || ""}::${entry.sectionId || ""}::${label.toLowerCase()}`;
        const deduped = current.recentSuggestedFocus.filter((focus) => {
          const currentKey = `${focus.pageKey}::${focus.targetId || ""}::${focus.sectionId || ""}::${focus.label.toLowerCase()}`;
          return currentKey !== dedupeKey;
        });
        return {
          ...current,
          recentSuggestedFocus: [
            {
              pageKey,
              label,
              reason: entry.reason?.trim() || null,
              severity: entry.severity || null,
              issueType: entry.issueType?.trim() || null,
              href: entry.href?.trim() || null,
              targetId: entry.targetId?.trim() || null,
              sectionId: entry.sectionId?.trim() || null,
              createdAt: Date.now()
            },
            ...deduped
          ].slice(0, MAX_SESSION_SUGGESTED_FOCUS)
        };
      });
    },
    []
  );

  const setPageContextWithRegistry = useCallback((next: CopilotPageContext | null) => {
    setPageContext(next);
    if (!next?.pageKey) {
      return;
    }
    setContextRegistry((current) => ({
      ...current,
      [next.pageKey]: next
    }));
  }, []);

  useEffect(() => {
    setPageContext(null);
  }, [pathname]);

  const value = useMemo<AiCopilotContextValue>(
    () => ({
      pageContext,
      setPageContext: setPageContextWithRegistry,
      contextRegistry,
      isCopilotOpen,
      openCopilot: () => setIsCopilotOpen(true),
      closeCopilot: () => setIsCopilotOpen(false),
      toggleCopilot: () => setIsCopilotOpen((current) => !current),
      sessionMemory,
      rememberQuestion,
      rememberPageVisit,
      rememberFocusTarget,
      rememberConversationTurn,
      rememberSuggestedFocus
    }),
    [
      contextRegistry,
      isCopilotOpen,
      pageContext,
      rememberConversationTurn,
      rememberFocusTarget,
      rememberPageVisit,
      rememberQuestion,
      rememberSuggestedFocus,
      sessionMemory,
      setPageContextWithRegistry
    ]
  );

  return <AiCopilotContext.Provider value={value}>{children}</AiCopilotContext.Provider>;
}

export function useAiCopilotContext() {
  const context = useContext(AiCopilotContext);
  if (!context) {
    throw new Error("useAiCopilotContext must be used inside AiCopilotProvider.");
  }
  return context;
}

export function useRegisterCopilotContext(pageContext: CopilotPageContext | null) {
  const { setPageContext } = useAiCopilotContext();

  useEffect(() => {
    setPageContext(pageContext);
    return () => {
      setPageContext(null);
    };
  }, [pageContext, setPageContext]);
}
