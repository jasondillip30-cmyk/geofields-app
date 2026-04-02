"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  Bot,
  MessageSquarePlus,
  Pencil,
  SendHorizontal,
  Sparkles,
  Trash2,
  X
} from "lucide-react";

import { useAiCopilotContext } from "@/components/layout/ai-copilot-context";
import { useAnalyticsFilters } from "@/components/layout/analytics-filters-provider";
import { setCopilotFocusTarget } from "@/components/layout/copilot-focus-target";
import { useRole } from "@/components/layout/role-provider";
import type {
  CopilotNavigationTarget,
  CopilotPageContext,
  CopilotIntent,
  ContextualCopilotResponsePayload
} from "@/lib/ai/contextual-copilot";
import {
  applyFilterContextToHref,
  resolveCopilotActionLabel,
  resolveCopilotInspectHint
} from "@/lib/ai/copilot-handoff";
import { parseDecisionSupportCommand } from "@/lib/ai/decision-support";
import { cn } from "@/lib/utils";

type CopilotScopeMode = "THIS_PAGE" | "RELATED_DATA" | "WHOLE_APP";

interface CopilotMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  intent?: CopilotIntent | null;
  createdAt?: string;
  responseData?: ContextualCopilotResponsePayload | null;
}

interface CopilotThreadSummary {
  id: string;
  title: string;
  scopeMode: CopilotScopeMode;
  currentPageKey: string | null;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  lastMessagePreview: string | null;
}

export function GlobalAiCopilot() {
  const pathname = usePathname();
  const router = useRouter();
  const { role, loading } = useRole();
  const { filters } = useAnalyticsFilters();
  const {
    pageContext,
    contextRegistry,
    isCopilotOpen,
    closeCopilot,
    toggleCopilot,
    sessionMemory,
    rememberFocusTarget,
    rememberConversationTurn,
    rememberSuggestedFocus,
    rememberPageVisit,
    rememberQuestion
  } = useAiCopilotContext();

  const canUseCopilot = Boolean(role);
  const roleQuickPrompts = useMemo(() => resolveRoleQuickPrompts(role), [role]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [scopeMode, setScopeMode] = useState<CopilotScopeMode>("THIS_PAGE");
  const [threadsLoading, setThreadsLoading] = useState(false);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [threads, setThreads] = useState<CopilotThreadSummary[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<CopilotMessage[]>([
    {
      id: createMessageId(),
      role: "assistant",
      text: "AI-generated advisory only. I can explain concepts, guide next steps, and take you directly to the right records."
    }
  ]);
  const [renamingThreadId, setRenamingThreadId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const initializedRef = useRef(false);
  const loadingThreadRef = useRef<string | null>(null);
  const historyRef = useRef<HTMLDivElement | null>(null);

  const sessionContext = useMemo(
    () => ({
      recentQuestions: sessionMemory.recentQuestions.slice(0, 8),
      recentPageKeys: sessionMemory.recentPageVisits.slice(0, 6).map((entry) => entry.pageKey),
      recentConversation: sessionMemory.recentConversation.slice(0, 16).map((entry) => ({
        role: entry.role,
        text: entry.text,
        pageKey: entry.pageKey,
        createdAt: entry.createdAt
      })),
      recentSuggestedFocus: sessionMemory.recentSuggestedFocus.slice(0, 12).map((entry) => ({
        pageKey: entry.pageKey,
        label: entry.label,
        reason: entry.reason || null,
        severity: entry.severity || null,
        issueType: entry.issueType || null,
        href: entry.href || null,
        targetId: entry.targetId || null,
        sectionId: entry.sectionId || null,
        createdAt: entry.createdAt
      })),
      currentFocusTarget: sessionMemory.currentFocusTarget
        ? {
            pageKey: sessionMemory.currentFocusTarget.pageKey,
            href: sessionMemory.currentFocusTarget.href || null,
            targetId: sessionMemory.currentFocusTarget.targetId || null,
            sectionId: sessionMemory.currentFocusTarget.sectionId || null,
            label: sessionMemory.currentFocusTarget.label || null
          }
        : null
    }),
    [sessionMemory]
  );

  const resolvedContext = useMemo<CopilotPageContext>(() => {
    const baseFilters = {
      clientId: filters.clientId === "all" ? null : filters.clientId,
      rigId: filters.rigId === "all" ? null : filters.rigId,
      from: filters.from || null,
      to: filters.to || null
    };

    if (!pageContext) {
      return {
        pageKey: normalizePageKey(pathname),
        pageName: resolvePageName(pathname),
        viewerRole: role,
        scopeMode,
        filters: baseFilters,
        summaryMetrics: [],
        tablePreviews: [],
        selectedItems: [],
        navigationTargets: [],
        sessionContext
      };
    }

    return {
      ...pageContext,
      viewerRole: role,
      scopeMode,
      filters: {
        ...baseFilters,
        ...(pageContext.filters || {})
      },
      summaryMetrics: Array.isArray(pageContext.summaryMetrics) ? pageContext.summaryMetrics : [],
      tablePreviews: Array.isArray(pageContext.tablePreviews) ? pageContext.tablePreviews : [],
      selectedItems: Array.isArray(pageContext.selectedItems) ? pageContext.selectedItems : [],
      navigationTargets: Array.isArray(pageContext.navigationTargets) ? pageContext.navigationTargets : [],
      sessionContext
    };
  }, [filters.clientId, filters.from, filters.rigId, filters.to, pageContext, pathname, role, scopeMode, sessionContext]);

  const scopedContext = useMemo<CopilotPageContext>(
    () =>
      composeContextForScope({
        scopeMode,
        currentContext: resolvedContext,
        contextRegistry,
        recentPageKeys: sessionMemory.recentPageVisits.map((entry) => entry.pageKey)
      }),
    [contextRegistry, resolvedContext, scopeMode, sessionMemory.recentPageVisits]
  );

  const visibleMessages = useMemo(() => messages.slice(-6), [messages]);

  useEffect(() => {
    rememberPageVisit({
      pageKey: resolvedContext.pageKey,
      pageName: resolvedContext.pageName
    });
  }, [rememberPageVisit, resolvedContext.pageKey, resolvedContext.pageName]);

  useEffect(() => {
    if (!isCopilotOpen || !historyRef.current) {
      return;
    }
    historyRef.current.scrollTop = historyRef.current.scrollHeight;
  }, [isCopilotOpen, messages, messagesLoading, sending]);

  useEffect(() => {
    if (!isCopilotOpen) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeCopilot();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closeCopilot, isCopilotOpen]);

  const navigateToTarget = useCallback(
    ({
      href,
      targetId,
      sectionId,
      pageKey,
      label,
      reason,
      issueType,
      actionLabel,
      inspectHint
    }: {
      href?: string;
      targetId?: string;
      sectionId?: string;
      pageKey?: string;
      label?: string;
      reason?: string;
      issueType?: string;
      actionLabel?: string;
      inspectHint?: string;
    }) => {
      const nextHref = href || pathname;
      const nextHrefWithContext = applyFilterContextToHref(nextHref, scopedContext.filters);
      const resolvedPageKey =
        pageKey || inferPageKeyFromHref(nextHrefWithContext) || normalizePageKey(pathname);
      const resolvedActionLabel = resolveCopilotActionLabel({
        explicitActionLabel: actionLabel || null,
        fallbackLabel: "Open record",
        pageKey: resolvedPageKey,
        href: nextHrefWithContext,
        issueType: issueType || null,
        targetId: targetId || null
      });
      const resolvedInspectHint = resolveCopilotInspectHint({
        explicitInspectHint: inspectHint || null,
        reason: reason || null,
        pageKey: resolvedPageKey,
        href: nextHrefWithContext,
        issueType: issueType || null
      });
      if (targetId || sectionId || reason || resolvedInspectHint) {
        rememberFocusTarget({
          pageKey: resolvedPageKey,
          href: nextHrefWithContext,
          targetId: targetId || null,
          sectionId: sectionId || null,
          label: label || null
        });
        setCopilotFocusTarget({
          pageKey: resolvedPageKey,
          targetId: targetId || null,
          sectionId: sectionId || null,
          href: nextHrefWithContext,
          label: label || null,
          actionLabel: resolvedActionLabel,
          reason: reason || null,
          inspectHint: resolvedInspectHint,
          source: "global-copilot"
        });
      }
      closeCopilot();
      if (nextHrefWithContext === pathname) {
        return;
      }
      router.push(nextHrefWithContext);
    },
    [closeCopilot, pathname, rememberFocusTarget, router, scopedContext.filters]
  );

  const updateThreadInList = useCallback((nextThread: CopilotThreadSummary) => {
    setThreads((current) => {
      const without = current.filter((entry) => entry.id !== nextThread.id);
      return [nextThread, ...without].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
    });
  }, []);

  const loadThreadDetail = useCallback(
    async (threadId: string) => {
      if (!threadId || loadingThreadRef.current === threadId) {
        return;
      }
      loadingThreadRef.current = threadId;
      setMessagesLoading(true);
      try {
        const response = await fetch(`/api/ai/copilot/threads/${threadId}`, {
          method: "GET",
          cache: "no-store"
        });
        const payload = (await response.json().catch(() => null)) as
          | {
              message?: string;
              data?: {
                thread?: CopilotThreadSummary;
                messages?: Array<{
                  id: string;
                  role: "user" | "assistant";
                  text: string;
                  createdAt: string;
                  intent?: CopilotIntent | null;
                  responseData?: ContextualCopilotResponsePayload | null;
                }>;
              };
            }
          | null;
        if (!response.ok || !payload?.data?.thread) {
          throw new Error(payload?.message || "Could not load this chat.");
        }

        updateThreadInList(payload.data.thread);
        setScopeMode(payload.data.thread.scopeMode || "THIS_PAGE");

        const loadedMessages = (payload.data.messages || []).map((entry) => ({
          id: entry.id,
          role: entry.role,
          text: entry.text,
          intent: entry.intent || null,
          createdAt: entry.createdAt,
          responseData: entry.responseData || null
        }));

        setMessages(
          loadedMessages.length > 0
            ? loadedMessages
            : [
                {
                  id: createMessageId(),
                  role: "assistant",
                  text: "New chat ready. Ask me anything about this page, related modules, or the whole app."
                }
              ]
        );
      } catch (requestError) {
        setError(requestError instanceof Error ? requestError.message : "Could not load chat.");
      } finally {
        loadingThreadRef.current = null;
        setMessagesLoading(false);
      }
    },
    [updateThreadInList]
  );

  const createNewChat = useCallback(async (): Promise<CopilotThreadSummary | null> => {
    try {
      const response = await fetch("/api/ai/copilot/threads", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          title: "New chat",
          scopeMode,
          currentPageKey: resolvedContext.pageKey
        })
      });
      const payload = (await response.json().catch(() => null)) as
        | { message?: string; data?: CopilotThreadSummary }
        | null;
      if (!response.ok || !payload?.data) {
        throw new Error(payload?.message || "Could not create chat.");
      }

      updateThreadInList(payload.data);
      setActiveThreadId(payload.data.id);
      setScopeMode(payload.data.scopeMode || scopeMode);
      setMessages([
        {
          id: createMessageId(),
          role: "assistant",
          text: "New chat ready. Ask me anything about this page, related modules, or the whole app."
        }
      ]);
      return payload.data;
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not create chat.");
      return null;
    }
  }, [resolvedContext.pageKey, scopeMode, updateThreadInList]);

  const loadThreads = useCallback(async () => {
    setThreadsLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/ai/copilot/threads", {
        method: "GET",
        cache: "no-store"
      });
      const payload = (await response.json().catch(() => null)) as
        | { message?: string; data?: CopilotThreadSummary[] }
        | null;
      if (!response.ok) {
        throw new Error(payload?.message || "Could not load chats.");
      }
      const nextThreads = Array.isArray(payload?.data) ? payload.data : [];
      setThreads(nextThreads);

      if (nextThreads.length === 0) {
        const created = await createNewChat();
        if (created) {
          await loadThreadDetail(created.id);
        }
        return;
      }

      const preferred =
        nextThreads.find((entry) => entry.id === activeThreadId)?.id ||
        nextThreads[0]?.id ||
        null;
      setActiveThreadId(preferred);
      if (preferred) {
        await loadThreadDetail(preferred);
      }
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not load chats.");
    } finally {
      setThreadsLoading(false);
    }
  }, [activeThreadId, createNewChat, loadThreadDetail]);

  useEffect(() => {
    if (!isCopilotOpen) {
      return;
    }
    if (initializedRef.current) {
      return;
    }
    initializedRef.current = true;
    void loadThreads();
  }, [isCopilotOpen, loadThreads]);

  useEffect(() => {
    if (!isCopilotOpen || !activeThreadId) {
      return;
    }
    void loadThreadDetail(activeThreadId);
  }, [activeThreadId, isCopilotOpen, loadThreadDetail]);

  const renameThread = useCallback(
    async (threadId: string, title: string) => {
      const trimmed = title.trim();
      if (!threadId || !trimmed) {
        return;
      }
      try {
        const response = await fetch(`/api/ai/copilot/threads/${threadId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: trimmed })
        });
        const payload = (await response.json().catch(() => null)) as
          | { message?: string; data?: CopilotThreadSummary }
          | null;
        if (!response.ok || !payload?.data) {
          throw new Error(payload?.message || "Could not rename chat.");
        }
        updateThreadInList(payload.data);
        setRenamingThreadId(null);
        setRenameValue("");
      } catch (requestError) {
        setError(requestError instanceof Error ? requestError.message : "Could not rename chat.");
      }
    },
    [updateThreadInList]
  );

  const removeThread = useCallback(
    async (threadId: string) => {
      if (!threadId) {
        return;
      }
      try {
        const response = await fetch(`/api/ai/copilot/threads/${threadId}`, {
          method: "DELETE"
        });
        const payload = (await response.json().catch(() => null)) as { message?: string } | null;
        if (!response.ok) {
          throw new Error(payload?.message || "Could not delete chat.");
        }

        setThreads((current) => current.filter((entry) => entry.id !== threadId));
        const remaining = threads.filter((entry) => entry.id !== threadId);
        if (activeThreadId === threadId) {
          if (remaining[0]) {
            setActiveThreadId(remaining[0].id);
            await loadThreadDetail(remaining[0].id);
          } else {
            const created = await createNewChat();
            if (created) {
              await loadThreadDetail(created.id);
            }
          }
        }
      } catch (requestError) {
        setError(requestError instanceof Error ? requestError.message : "Could not delete chat.");
      }
    },
    [activeThreadId, createNewChat, loadThreadDetail, threads]
  );

  const updateThreadScope = useCallback(
    async (mode: CopilotScopeMode) => {
      if (!activeThreadId) {
        return;
      }
      try {
        const response = await fetch(`/api/ai/copilot/threads/${activeThreadId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            scopeMode: mode,
            currentPageKey: resolvedContext.pageKey
          })
        });
        const payload = (await response.json().catch(() => null)) as
          | { message?: string; data?: CopilotThreadSummary }
          | null;
        if (!response.ok || !payload?.data) {
          throw new Error(payload?.message || "Could not update chat scope.");
        }
        updateThreadInList(payload.data);
      } catch (requestError) {
        setError(requestError instanceof Error ? requestError.message : "Could not update scope.");
      }
    },
    [activeThreadId, resolvedContext.pageKey, updateThreadInList]
  );

  const sendQuestion = useCallback(
    async (question: string) => {
      const trimmed = question.trim();
      if (!trimmed || sending) {
        return;
      }
      const parsedCommand = parseDecisionSupportCommand(trimmed);
      if (!parsedCommand.supported) {
        setError(parsedCommand.hint || "Use decision commands like: what should I do first, show biggest risks, or take me to [item].");
        return;
      }

      const canonicalQuestion = parsedCommand.canonicalQuestion;
      setSending(true);
      setError(null);

      let threadId = activeThreadId;
      if (!threadId) {
        const created = await createNewChat();
        threadId = created?.id || null;
      }
      if (!threadId) {
        setSending(false);
        return;
      }

      rememberQuestion(canonicalQuestion);
      rememberConversationTurn({
        role: "user",
        text: canonicalQuestion,
        pageKey: scopedContext.pageKey
      });

      try {
        const response = await fetch(`/api/ai/copilot/threads/${threadId}/messages`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            question: canonicalQuestion,
            scopeMode,
            context: scopedContext
          })
        });
        const payload = (await response.json().catch(() => null)) as
          | {
              message?: string;
              data?: {
                thread?: CopilotThreadSummary | null;
                userMessage?: CopilotMessage;
                assistantMessage?: CopilotMessage;
              };
            }
          | null;

        if (!response.ok || !payload?.data?.assistantMessage || !payload?.data?.userMessage) {
          throw new Error(payload?.message || "Could not generate AI guidance right now.");
        }

        if (payload.data.thread) {
          updateThreadInList(payload.data.thread);
          setScopeMode(payload.data.thread.scopeMode || scopeMode);
        }

        const normalizedUserMessage: CopilotMessage = {
          ...payload.data.userMessage,
          text: canonicalQuestion
        };
        const nextMessages = [normalizedUserMessage, payload.data.assistantMessage];
        setMessages((current) => [...current, ...nextMessages]);

        rememberConversationTurn({
          role: "assistant",
          text: payload.data.assistantMessage.text,
          pageKey: scopedContext.pageKey
        });

        const topSuggestion = payload.data.assistantMessage.responseData?.focusItems?.[0];
        if (topSuggestion) {
          rememberSuggestedFocus({
            pageKey: topSuggestion.targetPageKey || scopedContext.pageKey,
            label: topSuggestion.label,
            reason: topSuggestion.reason,
            severity: topSuggestion.severity,
            issueType: topSuggestion.issueType || null,
            href: topSuggestion.href || null,
            targetId: topSuggestion.targetId || null,
            sectionId: topSuggestion.sectionId || null
          });
        }

        setInput("");
      } catch (requestError) {
        const message =
          requestError instanceof Error ? requestError.message : "Could not generate AI guidance right now.";
        setError(message);
        setMessages((current) => [
          ...current,
          {
            id: createMessageId(),
            role: "assistant",
            text: "I couldn’t complete that request right now. Please try again."
          }
        ]);
      } finally {
        setSending(false);
      }
    },
    [
      activeThreadId,
      createNewChat,
      rememberConversationTurn,
      rememberQuestion,
      rememberSuggestedFocus,
      scopedContext,
      scopeMode,
      sending,
      updateThreadInList
    ]
  );

  const handleScopeChange = useCallback(
    (mode: CopilotScopeMode) => {
      setScopeMode(mode);
      void updateThreadScope(mode);
    },
    [updateThreadScope]
  );

  if (!canUseCopilot) {
    return null;
  }

  return (
    <>
      <button
        type="button"
        onClick={toggleCopilot}
        className="fixed bottom-5 right-5 z-[85] inline-flex items-center gap-2 rounded-full bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white shadow-[0_10px_24px_rgba(30,99,245,0.32)] transition-all duration-200 hover:-translate-y-[1px] hover:bg-brand-700"
        aria-label={isCopilotOpen ? "Close Atlas Copilot" : "Open Atlas Copilot"}
      >
        <Bot size={15} />
        Atlas Copilot
      </button>

      <div
        className={cn(
          "fixed inset-0 z-[80] bg-slate-900/25 backdrop-blur-[2px] transition-opacity duration-200",
          isCopilotOpen ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"
        )}
        onClick={closeCopilot}
      />

      <aside
        className={cn(
          "fixed right-0 top-0 z-[90] flex h-screen w-full max-w-[760px] border-l border-slate-200 bg-white shadow-[0_10px_40px_rgba(15,23,42,0.22)] transition-transform duration-200",
          isCopilotOpen ? "translate-x-0" : "translate-x-full"
        )}
        role="dialog"
        aria-modal="true"
        aria-label="Global Atlas Copilot"
      >
        <section className="hidden">
          <header className="border-b border-slate-200 px-4 py-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold text-ink-900">Atlas Copilot</h3>
                <p className="text-xs text-slate-600">Chat history</p>
              </div>
              <button
                type="button"
                className="gf-btn-primary px-2.5 py-1.5 text-xs"
                onClick={() => void createNewChat()}
              >
                <MessageSquarePlus size={13} className="mr-1 inline" />
                New chat
              </button>
            </div>
          </header>
          <div className="flex-1 overflow-y-auto p-2.5">
            {threadsLoading ? (
              <p className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
                Loading chats...
              </p>
            ) : threads.length === 0 ? (
              <p className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
                No chats yet.
              </p>
            ) : (
              <div className="space-y-1.5">
                {threads.map((thread) => {
                  const isActive = thread.id === activeThreadId;
                  const isRenaming = renamingThreadId === thread.id;
                  return (
                    <article
                      key={thread.id}
                      className={cn(
                        "rounded-lg border px-2.5 py-2 transition-colors",
                        isActive
                          ? "border-brand-200 bg-brand-50/70"
                          : "border-slate-200 bg-white hover:border-slate-300"
                      )}
                    >
                      {isRenaming ? (
                        <form
                          onSubmit={(event) => {
                            event.preventDefault();
                            void renameThread(thread.id, renameValue);
                          }}
                          className="space-y-1.5"
                        >
                          <input
                            value={renameValue}
                            onChange={(event) => setRenameValue(event.target.value)}
                            className="w-full rounded-md border border-slate-300 px-2 py-1 text-xs"
                            autoFocus
                          />
                          <div className="flex items-center gap-1">
                            <button type="submit" className="gf-btn-primary px-2 py-1 text-[11px]">
                              Save
                            </button>
                            <button
                              type="button"
                              className="gf-btn-subtle px-2 py-1 text-[11px]"
                              onClick={() => {
                                setRenamingThreadId(null);
                                setRenameValue("");
                              }}
                            >
                              Cancel
                            </button>
                          </div>
                        </form>
                      ) : (
                        <>
                          <button
                            type="button"
                            className="w-full text-left"
                            onClick={() => setActiveThreadId(thread.id)}
                          >
                            <p className="truncate text-xs font-semibold text-slate-900">{thread.title}</p>
                            <p className="mt-0.5 line-clamp-2 text-[11px] text-slate-600">
                              {thread.lastMessagePreview || "No messages yet"}
                            </p>
                          </button>
                          <div className="mt-1.5 flex items-center justify-between gap-2">
                            <span className="text-[10px] text-slate-500">
                              {formatRelativeDate(thread.updatedAt)} • {scopeModeLabel(thread.scopeMode)}
                            </span>
                            <div className="flex items-center gap-0.5">
                              <button
                                type="button"
                                className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                                onClick={() => {
                                  setRenamingThreadId(thread.id);
                                  setRenameValue(thread.title);
                                }}
                                aria-label="Rename chat"
                              >
                                <Pencil size={12} />
                              </button>
                              <button
                                type="button"
                                className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-red-700"
                                onClick={() => void removeThread(thread.id)}
                                aria-label="Delete chat"
                              >
                                <Trash2 size={12} />
                              </button>
                            </div>
                          </div>
                        </>
                      )}
                    </article>
                  );
                })}
              </div>
            )}
          </div>
        </section>

        <section className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-10 border-b border-slate-200 bg-white px-4 py-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-ink-900">Atlas Focus Assistant</h3>
                <p className="mt-0.5 text-xs text-slate-600">
                  {resolvedContext.pageName} • {formatScopeSummary(scopedContext)}
                </p>
              </div>
              <button
                type="button"
                className="gf-btn-subtle p-1.5"
                onClick={closeCopilot}
                aria-label="Close Atlas Copilot"
              >
                <X size={14} />
              </button>
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
              <span className="rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 font-medium text-indigo-700">
                AI-generated advisory only
              </span>
              <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-slate-600">
                Scope: {scopeModeLabel(scopeMode)}
              </span>
              <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-slate-600">
                Decision commands only
              </span>
              {loading ? (
                <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-slate-500">
                  Loading access profile...
                </span>
              ) : null}
            </div>

            <div className="mt-2 inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-[11px]">
              {(Object.keys(scopeModeLabels) as CopilotScopeMode[]).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => handleScopeChange(mode)}
                  className={cn(
                    "rounded-md px-2.5 py-1 font-medium transition-colors",
                    scopeMode === mode
                      ? "bg-white text-brand-700 shadow-[0_1px_2px_rgba(15,23,42,0.08)]"
                      : "text-slate-600 hover:text-slate-800"
                  )}
                  aria-pressed={scopeMode === mode}
                >
                  {scopeModeLabel(mode)}
                </button>
              ))}
            </div>
          </header>

          <div ref={historyRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
            {visibleMessages.map((message) => (
              <article
                key={message.id}
                className={cn(
                  "max-w-[92%] rounded-2xl border px-3.5 py-2.5",
                  message.role === "user"
                    ? "ml-auto border-brand-200 bg-brand-50 text-slate-800"
                    : "mr-auto border-slate-200 bg-white text-slate-800"
                )}
              >
                <p className="text-sm leading-6">{message.text}</p>
                <div className="mt-1 flex items-center gap-1.5 text-[10px] text-slate-500">
                  <span>{message.role === "assistant" ? "Atlas" : "You"}</span>
                  <span>•</span>
                  <span>{message.createdAt ? formatClock(message.createdAt) : "now"}</span>
                  {message.intent ? (
                    <>
                      <span>•</span>
                      <span>{formatIntentLabel(message.intent)}</span>
                    </>
                  ) : null}
                </div>

                {message.role === "assistant" && message.responseData ? (
                  shouldRenderAssistantArtifacts(message.responseData) ? (
                    <div className="mt-2 space-y-2">
                      {message.responseData.focusItems?.slice(0, 2).map((item) => (
                        <div
                          key={`${message.id}-focus-${item.id}`}
                          className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2 text-xs text-slate-700"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <p className="font-semibold text-slate-900">{item.label}</p>
                            <span
                              className={cn(
                                "inline-flex rounded-full border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                                item.severity === "CRITICAL"
                                  ? "border-red-200 bg-red-50 text-red-700"
                                  : item.severity === "HIGH"
                                    ? "border-orange-200 bg-orange-50 text-orange-700"
                                    : item.severity === "MEDIUM"
                                      ? "border-amber-200 bg-amber-50 text-amber-700"
                                      : "border-slate-200 bg-slate-100 text-slate-700"
                              )}
                            >
                              {item.severity}
                            </span>
                          </div>
                          <p className="mt-1">{item.reason}</p>
                          {item.href || item.targetId || item.sectionId ? (
                            <button
                              type="button"
                              onClick={() =>
                                navigateToTarget({
                                  href: item.href,
                                  targetId: item.targetId,
                                  sectionId: item.sectionId,
                                  pageKey: item.targetPageKey,
                                  label: item.label,
                                  reason: item.reason,
                                  issueType: item.issueType,
                                  actionLabel: item.actionLabel,
                                  inspectHint: item.inspectHint
                                })
                              }
                              className="gf-btn-secondary mt-1.5 px-2 py-1 text-[11px] font-semibold text-brand-700 hover:border-brand-200 hover:bg-brand-50"
                            >
                              {resolveCopilotActionLabel({
                                explicitActionLabel: item.actionLabel || null,
                                fallbackLabel: "Take me there",
                                pageKey: item.targetPageKey || inferPageKeyFromHref(item.href || ""),
                                href: item.href,
                                issueType: item.issueType || null,
                                targetId: item.targetId || null
                              })}
                            </button>
                          ) : null}
                          {item.inspectHint ? (
                            <p className="mt-1 text-[11px] text-slate-600">
                              <span className="font-semibold text-slate-700">Inspect next:</span> {item.inspectHint}
                            </p>
                          ) : null}
                        </div>
                      ))}

                      {(message.responseData.usefulShortcuts || message.responseData.navigationTargets)?.length ? (
                        <div className="flex flex-wrap gap-1.5">
                          {(message.responseData.usefulShortcuts || message.responseData.navigationTargets || [])
                            .slice(0, 4)
                            .map((target, index) => (
                              <button
                                key={`${message.id}-target-${index}`}
                                type="button"
                                className="gf-btn-subtle px-2 py-1 text-[11px]"
                                onClick={() =>
                                  navigateToTarget({
                                    href: target.href,
                                    targetId: target.targetId,
                                    sectionId: target.sectionId,
                                    pageKey: target.pageKey,
                                    label: target.label,
                                    reason: target.reason,
                                    actionLabel: target.actionLabel,
                                    inspectHint: target.inspectHint
                                  })
                                }
                              >
                                {target.label}
                              </button>
                            ))}
                        </div>
                      ) : null}
                    </div>
                  ) : null
                ) : null}
              </article>
            ))}

            {messagesLoading ? (
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
                Loading messages...
              </div>
            ) : null}

            {sending ? (
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
                <Sparkles size={13} className="mr-1 inline-block text-brand-600" />
                Thinking...
              </div>
            ) : null}

            {error ? <p className="text-xs text-red-700">{error}</p> : null}
          </div>

          <footer className="border-t border-slate-200 bg-white px-4 py-3">
            <div className="mb-2 flex flex-wrap gap-1.5">
              {roleQuickPrompts.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  className="gf-btn-subtle text-[11px]"
                  onClick={() => void sendQuestion(prompt)}
                  disabled={sending}
                >
                  {prompt}
                </button>
              ))}
            </div>
            <form
              className="flex items-end gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                void sendQuestion(input);
              }}
            >
              <textarea
                value={input}
                onChange={(event) => setInput(event.target.value)}
                placeholder="Ask about this page..."
                rows={2}
                className="w-full resize-none rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
              <button type="submit" className="gf-btn-primary px-3 py-2" disabled={sending || !input.trim()}>
                <SendHorizontal size={14} />
              </button>
            </form>
          </footer>
        </section>
      </aside>
    </>
  );
}

function resolveRoleQuickPrompts(role: string | null) {
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

function normalizePageKey(pathname: string) {
  if (pathname.startsWith("/executive-overview")) {
    return "executive-overview";
  }
  if (pathname.startsWith("/alerts-center")) {
    return "alerts-center";
  }
  if (pathname.startsWith("/data-quality/linkage-center")) {
    return "data-quality-linkage-center";
  }
  if (pathname.startsWith("/cost-tracking/budget-vs-actual")) {
    return "budget-vs-actual";
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
  if (pathname.startsWith("/profit")) {
    return "profit";
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
    return "inventory-overview";
  }
  return pathname.replace(/^\//, "").replace(/\//g, "-") || "company-dashboard";
}

function inferPageKeyFromHref(href: string) {
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
  if (path.startsWith("/cost-tracking/budget-vs-actual")) {
    return "budget-vs-actual";
  }
  if (path.startsWith("/cost-tracking")) {
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
  if (path.startsWith("/profit")) {
    return "profit";
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
    return "inventory-overview";
  }
  return normalizePageKey(path);
}

function resolvePageName(pathname: string) {
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
  if (pathname.startsWith("/cost-tracking/budget-vs-actual")) {
    return "Budget vs Actual";
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
  if (pathname.startsWith("/profit")) {
    return "Profit";
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
    return "Inventory Overview";
  }
  return pathname
    .replace(/^\//, "")
    .split("/")
    .filter(Boolean)
    .map((segment) => segment.replace(/-/g, " "))
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" / ");
}

function formatScopeSummary(context: CopilotPageContext) {
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

function scopeModeLabel(mode: CopilotScopeMode) {
  return scopeModeLabels[mode];
}

function composeContextForScope({
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

function createMessageId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2, 9)}`;
}

function formatRelativeDate(value: string) {
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

function formatClock(value: string) {
  const date = Date.parse(value);
  if (!Number.isFinite(date)) {
    return "now";
  }
  return new Date(date).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit"
  });
}

function formatIntentLabel(intent: CopilotIntent) {
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

function shouldRenderAssistantArtifacts(responseData: ContextualCopilotResponsePayload) {
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
