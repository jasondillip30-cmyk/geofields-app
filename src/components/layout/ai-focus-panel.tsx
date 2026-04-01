"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

import { useAiCopilotContext } from "@/components/layout/ai-copilot-context";
import { scrollToFocusElement, setCopilotFocusTarget } from "@/components/layout/copilot-focus-target";
import { useRole } from "@/components/layout/role-provider";
import { Card } from "@/components/ui/card";
import type {
  CopilotInsightCard,
  CopilotFocusItem,
  CopilotPageContext,
  ContextualCopilotResponsePayload
} from "@/lib/ai/contextual-copilot";
import {
  applyFilterContextToHref,
  inferCopilotPageKeyFromHref,
  resolveCopilotActionLabel,
  resolveCopilotInspectHint
} from "@/lib/ai/copilot-handoff";
import {
  decisionSupportCommandHints,
  parseDecisionSupportCommand
} from "@/lib/ai/decision-support";
import { isAssistantExperienceEnabled } from "@/lib/feature-flags";
import { cn } from "@/lib/utils";

interface AiFocusPanelProps {
  context: CopilotPageContext;
  pageKey: string;
  className?: string;
}

interface FocusPanelItem {
  id: string;
  label: string;
  reason: string;
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  issueType?: string;
  actionLabel?: string;
  inspectHint?: string;
  recordKey?: string;
  href?: string;
  targetId?: string;
  sectionId?: string;
  targetPageKey?: string;
}

export function AiFocusPanel({ context, pageKey, className }: AiFocusPanelProps) {
  if (!isAssistantExperienceEnabled()) {
    return null;
  }

  const pathname = usePathname();
  const router = useRouter();
  const { role } = useRole();
  const {
    sessionMemory,
    rememberConversationTurn,
    rememberFocusTarget,
    rememberQuestion,
    rememberSuggestedFocus
  } = useAiCopilotContext();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [result, setResult] = useState<ContextualCopilotResponsePayload | null>(null);
  const roleEmptyStates = useMemo(
    () => resolveRoleEmptyStates(context.viewerRole || role || null),
    [context.viewerRole, role]
  );

  const runDecisionCommand = useCallback(
    async (question: string, options?: { suppressLoading?: boolean }) => {
      if (!context) {
        return;
      }
      if (!options?.suppressLoading) {
        setLoading(true);
      }
      setError(null);
      setFeedback(null);

      const trimmed = question.trim();
      rememberQuestion(trimmed);
      rememberConversationTurn({
        role: "user",
        text: trimmed,
        pageKey: context.pageKey
      });

      try {
        const response = await fetch("/api/ai/copilot/contextual-chat", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            question: trimmed,
            context: {
              ...context,
              viewerRole: context.viewerRole || role || null
            }
          })
        });
        const payload = (await response.json().catch(() => null)) as
          | {
              message?: string;
              data?: ContextualCopilotResponsePayload;
            }
          | null;
        if (!response.ok || !payload?.data) {
          throw new Error(payload?.message || "Could not generate focus guidance for this page.");
        }
        setResult(payload.data);
        rememberConversationTurn({
          role: "assistant",
          text: payload.data.answer,
          pageKey: context.pageKey
        });

        const topSuggestion = payload.data.focusItems?.[0];
        if (topSuggestion) {
          rememberSuggestedFocus({
            pageKey: topSuggestion.targetPageKey || context.pageKey,
            label: topSuggestion.label,
            reason: topSuggestion.reason,
            severity: topSuggestion.severity,
            issueType: topSuggestion.issueType || null,
            href: topSuggestion.href || null,
            targetId: topSuggestion.targetId || null,
            sectionId: topSuggestion.sectionId || null
          });
        }
      } catch (requestError) {
        setError(requestError instanceof Error ? requestError.message : "Could not generate focus guidance.");
      } finally {
        if (!options?.suppressLoading) {
          setLoading(false);
        }
      }
    },
    [context, rememberConversationTurn, rememberQuestion, rememberSuggestedFocus, role]
  );

  useEffect(() => {
    void runDecisionCommand("what should i do first", { suppressLoading: false });
  }, [context.pageKey, context.filters.clientId, context.filters.from, context.filters.rigId, context.filters.to, runDecisionCommand]);

  const sections = useMemo(() => partitionFocusSections(result), [result]);
  const hasMaintenanceInsight = useMemo(
    () => Boolean(result?.insightCards?.some((card) => card.kind === "MAINTENANCE_CONCERN")),
    [result?.insightCards]
  );
  const hasDataQualityInsight = useMemo(
    () => Boolean(result?.insightCards?.some((card) => card.kind === "DATA_QUALITY_ISSUE")),
    [result?.insightCards]
  );

  const navigateToTarget = useCallback(
    (target: { href?: string; targetId?: string; sectionId?: string; targetPageKey?: string; label?: string }) => {
      const nextHref = target.href || pathname;
      const nextHrefWithContext = applyFilterContextToHref(nextHref, context.filters);
      const nextPageKey = target.targetPageKey || inferCopilotPageKeyFromHref(nextHrefWithContext) || pageKey;
      const hasTarget = Boolean(target.targetId || target.sectionId);
      const resolvedActionLabel = resolveCopilotActionLabel({
        explicitActionLabel: (target as { actionLabel?: string }).actionLabel,
        fallbackLabel: "Open record",
        pageKey: nextPageKey,
        href: nextHrefWithContext,
        issueType: (target as { issueType?: string }).issueType,
        targetId: target.targetId
      });
      const resolvedInspectHint = resolveCopilotInspectHint({
        explicitInspectHint: (target as { inspectHint?: string }).inspectHint,
        reason: (target as { reason?: string }).reason || null,
        pageKey: nextPageKey,
        href: nextHrefWithContext,
        issueType: (target as { issueType?: string }).issueType
      });

      if (hasTarget) {
        rememberFocusTarget({
          pageKey: nextPageKey,
          href: nextHrefWithContext,
          targetId: target.targetId || null,
          sectionId: target.sectionId || null,
          label: target.label || null
        });
        setCopilotFocusTarget({
          pageKey: nextPageKey,
          href: nextHrefWithContext,
          targetId: target.targetId || null,
          sectionId: target.sectionId || null,
          label: target.label || null,
          actionLabel: resolvedActionLabel,
          reason: (target as { reason?: string }).reason || null,
          inspectHint: resolvedInspectHint,
          source: "ai-focus-panel"
        });
      }

      if (nextHrefWithContext === pathname) {
        if (hasTarget) {
          scrollToFocusElement({
            targetId: target.targetId || null,
            sectionId: target.sectionId || null
          });
        }
        return;
      }

      router.push(nextHrefWithContext);
    },
    [context.filters, pageKey, pathname, rememberFocusTarget, router]
  );

  const handleAsk = useCallback(async () => {
    const parsed = parseDecisionSupportCommand(input);
    if (!parsed.supported) {
      setFeedback(parsed.hint || `Use one of: ${decisionSupportCommandHints.join(" • ")}`);
      return;
    }
    await runDecisionCommand(parsed.canonicalQuestion);
    setInput("");
  }, [input, runDecisionCommand]);

  return (
    <Card className={cn("overflow-hidden p-4 md:p-5", className)}>
      <div className="rounded-xl border border-slate-200/90 bg-gradient-to-br from-white via-white to-slate-50/80 p-3.5 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-brand-700">Decision Support</p>
            <h3 className="mt-1 text-base font-semibold text-ink-900">Atlas Focus Panel</h3>
            <p className="mt-1 text-xs text-slate-600">Prioritized guidance from live page signals.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void runDecisionCommand("what should i do first")}
              className="gf-btn-primary text-xs"
              disabled={loading}
            >
              {loading ? "Thinking..." : "What should I do first?"}
            </button>
            <button
              type="button"
              onClick={() => void runDecisionCommand("show biggest risks")}
              className="gf-btn-secondary px-3 py-1.5 text-xs"
              disabled={loading}
            >
              Show biggest risks
            </button>
          </div>
        </div>

        <div className="mt-3 flex items-end gap-2 border-t border-slate-200/80 pt-3">
          <div className="flex-1">
            <label className="sr-only" htmlFor={`focus-panel-input-${pageKey}`}>
              Ask about this page
            </label>
            <input
              id={`focus-panel-input-${pageKey}`}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="Ask about this page…"
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
            />
          </div>
          <button
            type="button"
            className="gf-btn-secondary px-3 py-2 text-xs"
            onClick={() => void handleAsk()}
            disabled={loading}
          >
            Run
          </button>
        </div>
      </div>

      {result ? (
        <div className="mt-3 rounded-xl border border-brand-100 bg-brand-50/35 px-3.5 py-2.5">
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-brand-700">Top Summary</p>
          <p className="mt-1 text-sm text-slate-800">{result.answer}</p>
        </div>
      ) : null}

      {(sessionMemory.currentFocusTarget?.label || result?.secondaryInsights?.length) && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {sessionMemory.currentFocusTarget?.label ? (
            <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] text-slate-700">
              Last opened from copilot:{" "}
              <span className="ml-1 font-semibold text-ink-900">{sessionMemory.currentFocusTarget.label}</span>
            </span>
          ) : null}
          {result?.secondaryInsights?.length ? (
            <span className="inline-flex items-center rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] text-slate-600">
              Also monitor: <span className="ml-1 text-slate-700">{result.secondaryInsights[0]}</span>
            </span>
          ) : null}
        </div>
      )}

      {feedback ? (
        <p className="mt-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">{feedback}</p>
      ) : null}
      {error ? <p className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p> : null}

      {result?.insightCards?.length ? (
        <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {result.insightCards.map((card) => (
            <InsightCard key={card.id} card={card} onNavigate={navigateToTarget} />
          ))}
        </div>
      ) : (
        <div className="mt-3 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-xs text-slate-500">
          No additional operational insight cards are available for this scope yet.
        </div>
      )}

      {result && (!hasMaintenanceInsight || !hasDataQualityInsight) ? (
        <div className="mt-2.5 grid gap-2 md:grid-cols-2">
          {!hasMaintenanceInsight ? (
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
              <span className="font-semibold text-slate-700">Maintenance concern:</span>{" "}
              {roleEmptyStates.maintenance}
            </div>
          ) : null}
          {!hasDataQualityInsight ? (
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
              <span className="font-semibold text-slate-700">Data-quality issue:</span>{" "}
              {roleEmptyStates.dataQuality}
            </div>
          ) : null}
        </div>
      ) : null}

      {result?.followUpQuestions?.length ? (
        <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50/70 px-2.5 py-1.5">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Recommended follow-up questions
          </p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {result.followUpQuestions.slice(0, 4).map((question) => (
              <button
                key={question}
                type="button"
                className="rounded-md border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-medium text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-100"
                onClick={() => void runDecisionCommand(question)}
                disabled={loading}
              >
                {question}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="mt-3 grid gap-2 xl:grid-cols-3">
        <FocusColumn
          title="🔴 Focus"
          description="Highest priority issues"
          items={sections.focus}
          onNavigate={navigateToTarget}
          emptyMessage="No high-priority issues in this scope."
        />
        <FocusColumn
          title="⚡ Do next"
          description="Best quick actions"
          items={sections.doNext}
          onNavigate={navigateToTarget}
          emptyMessage="No clear quick wins right now."
        />
        <FocusColumn
          title="🟡 Can wait"
          description="Lower urgency"
          items={sections.canWait}
          onNavigate={navigateToTarget}
          emptyMessage="No low-urgency items available."
        />
      </div>
    </Card>
  );
}

function InsightCard({
  card,
  onNavigate
}: {
  card: CopilotInsightCard;
  onNavigate: (target: {
    href?: string;
    targetId?: string;
    sectionId?: string;
    targetPageKey?: string;
    label?: string;
    reason?: string;
    issueType?: string;
    actionLabel?: string;
    inspectHint?: string;
  }) => void;
}) {
  const actionLabel = resolveCopilotActionLabel({
    explicitActionLabel: card.actionLabel,
    fallbackLabel: "Open record",
    pageKey: card.targetPageKey || inferCopilotPageKeyFromHref(card.href),
    href: card.href,
    issueType: null,
    targetId: card.targetId
  });
  return (
    <article
      className={cn(
        "rounded-xl border bg-white p-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-colors",
        card.severity === "CRITICAL"
          ? "border-red-200/90 bg-red-50/35"
          : card.severity === "HIGH"
            ? "border-orange-200/90 bg-orange-50/35"
            : card.severity === "MEDIUM"
              ? "border-amber-200/90 bg-amber-50/30"
              : "border-slate-200"
      )}
    >
      <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
        {insightTitle(card.kind, card.title)}
      </p>
      {card.severity ? (
        <span className={cn("mt-1 inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold", severityBadgeClass(card.severity))}>
          {card.severity}
        </span>
      ) : null}
      <p className="mt-1.5 text-xs leading-5 text-slate-700">{card.summary}</p>
      {card.href || card.targetId || card.sectionId ? (
        <button
          type="button"
          className="gf-btn-secondary mt-2 px-2.5 py-1 text-[11px] font-semibold text-brand-700 hover:border-brand-200 hover:bg-brand-50"
          onClick={() =>
            onNavigate({
              href: card.href,
              targetId: card.targetId,
              sectionId: card.sectionId,
              targetPageKey: card.targetPageKey,
              label: card.title,
              reason: card.summary,
              actionLabel,
              inspectHint: card.inspectHint
            })
          }
        >
          {actionLabel}
        </button>
      ) : null}
    </article>
  );
}

function FocusColumn({
  title,
  description,
  items,
  onNavigate,
  emptyMessage
}: {
  title: string;
  description: string;
  items: FocusPanelItem[];
  onNavigate: (target: {
    href?: string;
    targetId?: string;
    sectionId?: string;
    targetPageKey?: string;
    label?: string;
    reason?: string;
    issueType?: string;
    actionLabel?: string;
    inspectHint?: string;
  }) => void;
  emptyMessage: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <p className="text-xs font-semibold text-ink-900">{title}</p>
      <p className="mt-0.5 text-[11px] text-slate-500">{description}</p>
      {items.length === 0 ? (
        <div className="mt-2 rounded-md border border-dashed border-slate-300 bg-slate-50 px-2.5 py-2 text-xs text-slate-500">
          {emptyMessage}
        </div>
      ) : (
        <ul className="mt-2 space-y-2">
          {items.map((item) => (
            <li
              key={`${title}-${item.id}`}
              className="rounded-lg border border-slate-200/90 bg-slate-50/70 px-2.5 py-2 shadow-[0_1px_1px_rgba(15,23,42,0.03)]"
            >
              <div className="flex items-start justify-between gap-2">
                <p className="text-xs font-semibold text-ink-900">{item.label}</p>
                <span
                  className={cn(
                    "inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold",
                    severityBadgeClass(item.severity)
                  )}
                >
                  {item.severity}
                </span>
              </div>
              <p className="mt-1 text-xs leading-5 text-slate-700">{item.reason}</p>
              {item.href || item.targetId || item.sectionId ? (
                <button
                  type="button"
                  className="gf-btn-secondary mt-1.5 px-2.5 py-1 text-[11px] font-semibold text-brand-700 hover:border-brand-200 hover:bg-brand-50"
                  onClick={() =>
                    onNavigate({
                      href: item.href,
                      targetId: item.targetId,
                      sectionId: item.sectionId,
                      targetPageKey: item.targetPageKey,
                      label: item.label,
                      reason: item.reason,
                      issueType: item.issueType,
                      actionLabel: item.actionLabel,
                      inspectHint: item.inspectHint
                    })
                  }
                >
                  {resolveCopilotActionLabel({
                    explicitActionLabel: item.actionLabel,
                    fallbackLabel: "Open record",
                    pageKey: item.targetPageKey || inferCopilotPageKeyFromHref(item.href),
                    href: item.href,
                    issueType: item.issueType,
                    targetId: item.targetId
                  })}
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function resolveRoleEmptyStates(role: string | null) {
  const normalizedRole = (role || "").toUpperCase();
  if (normalizedRole === "MECHANIC") {
    return {
      maintenance: "No material maintenance issues in your current scope.",
      dataQuality: "No major parts/linkage issue detected in your current scope."
    };
  }
  if (normalizedRole === "OFFICE") {
    return {
      maintenance: "No major approval backlog in your current scope.",
      dataQuality: "No major record-completion gap detected in your current scope."
    };
  }
  if (normalizedRole === "FIELD" || normalizedRole === "STAFF") {
    return {
      maintenance: "No urgent maintenance follow-up in your current scope.",
      dataQuality: "No urgent reporting gaps in your current scope."
    };
  }
  return {
    maintenance: "No material maintenance risk detected in current scope.",
    dataQuality: "No major linkage issue detected in current scope."
  };
}

function partitionFocusSections(result: ContextualCopilotResponsePayload | null) {
  const focusItems = normalizeFocusItems(result?.focusItems || []);
  const rankedAll = [...focusItems].sort(compareFocusItems);
  const primaryFromResult = normalizeFocusItems(result?.primaryFocusItem ? [result.primaryFocusItem] : [])[0];
  const primary =
    (primaryFromResult &&
      rankedAll.find((item) => resolveFocusPanelRecordKey(item) === resolveFocusPanelRecordKey(primaryFromResult))) ||
    primaryFromResult ||
    rankedAll[0] ||
    null;
  const supportingFromResult = normalizeFocusItems(result?.supportingItems || []);
  const supportingPool = supportingFromResult.length
    ? supportingFromResult.filter(
        (item) =>
          resolveFocusPanelRecordKey(item) !== (primary ? resolveFocusPanelRecordKey(primary) : "")
      )
    : rankedAll.filter(
        (item) =>
          resolveFocusPanelRecordKey(item) !== (primary ? resolveFocusPanelRecordKey(primary) : "")
      );

  const sectionUsedKeys = new Set<string>();
  const appearanceCounts = new Map<string, number>();
  for (const card of result?.insightCards || []) {
    const cardRecordKey =
      card.recordKey ||
      (card.focusItemId
        ? rankedAll.find((item) => item.id === card.focusItemId)?.recordKey
        : null) ||
      `card::${card.id}`;
    appearanceCounts.set(cardRecordKey, (appearanceCounts.get(cardRecordKey) || 0) + 1);
  }

  const markUsed = (item: FocusPanelItem) => {
    const key = resolveFocusPanelRecordKey(item);
    sectionUsedKeys.add(key);
    appearanceCounts.set(key, (appearanceCounts.get(key) || 0) + 1);
  };
  const canUseItem = (item: FocusPanelItem) => {
    const key = resolveFocusPanelRecordKey(item);
    if (sectionUsedKeys.has(key)) {
      return false;
    }
    return (appearanceCounts.get(key) || 0) < 2;
  };

  const focus: FocusPanelItem[] = [];
  if (primary && canUseItem(primary)) {
    focus.push(primary);
    markUsed(primary);
  } else {
    const fallbackPrimary = rankedAll.find((item) => canUseItem(item));
    if (fallbackPrimary) {
      focus.push(fallbackPrimary);
      markUsed(fallbackPrimary);
    }
  }
  const primaryIssueFamily = focus[0] ? resolveFocusIssueFamily(focus[0]) : null;

  const strongCount = rankedAll.filter(
    (item) => item.severity === "CRITICAL" || item.severity === "HIGH"
  ).length;
  const preferredDoNextPool =
    strongCount <= 1
      ? supportingPool.filter((item) => item.severity === "CRITICAL" || item.severity === "HIGH")
      : supportingPool;
  const doNextPool = preferredDoNextPool.length > 0 ? preferredDoNextPool : supportingPool;
  const diversifiedDoNextPool =
    primaryIssueFamily
      ? doNextPool.filter((item) => resolveFocusIssueFamily(item) !== primaryIssueFamily)
      : doNextPool;
  const resolvedDoNextPool = diversifiedDoNextPool.length > 0 ? diversifiedDoNextPool : doNextPool;
  const doNext = resolvedDoNextPool.filter((item) => canUseItem(item)).slice(0, 3);
  doNext.forEach((item) => markUsed(item));

  if (doNext.length === 0) {
    doNext.push({
      id: "do-next-guidance",
      label:
        strongCount <= 1 ? "No additional high-priority actions" : "No additional distinct next actions",
      reason:
        result?.actionRanking?.doNext ||
        "No additional high-priority actions detected beyond the current primary focus item.",
      severity: "MEDIUM"
    });
  }

  const canWaitPoolBase = rankedAll
    .filter((item) => item.severity === "LOW")
    .filter((item) => canUseItem(item));
  const diversifiedCanWaitPool =
    primaryIssueFamily
      ? canWaitPoolBase.filter((item) => resolveFocusIssueFamily(item) !== primaryIssueFamily)
      : canWaitPoolBase;
  const canWait = (diversifiedCanWaitPool.length > 0 ? diversifiedCanWaitPool : canWaitPoolBase).slice(0, 3);
  canWait.forEach((item) => markUsed(item));

  if (canWait.length === 0 && result?.actionRanking?.canWait) {
    canWait.push({
      id: "can-wait-guidance",
      label: "Can wait",
      reason: result.actionRanking.canWait,
      severity: "LOW"
    });
  }

  return { focus, doNext, canWait };
}

function normalizeFocusItems(items: CopilotFocusItem[]): FocusPanelItem[] {
  return items
    .filter((item) => item.label && item.reason)
    .map((item, index) => ({
      id: item.id || `focus-item-${index}`,
      label: item.label,
      reason: item.reason,
      severity: item.severity,
      issueType: item.issueType,
      actionLabel: item.actionLabel,
      inspectHint: item.inspectHint,
      recordKey: `${item.targetPageKey || "page"}::${item.targetId || item.id || item.label}`,
      href: item.href,
      targetId: item.targetId,
      sectionId: item.sectionId,
      targetPageKey: item.targetPageKey
    }));
}

function resolveFocusPanelRecordKey(item: FocusPanelItem) {
  if (item.recordKey) {
    return item.recordKey;
  }
  if (item.targetId) {
    return `${item.targetPageKey || "page"}::target::${item.targetId}`;
  }
  return `${item.targetPageKey || "page"}::${item.id || item.label}`;
}

function compareFocusItems(a: FocusPanelItem, b: FocusPanelItem) {
  const severityDiff = severityRank(a.severity) - severityRank(b.severity);
  if (severityDiff !== 0) {
    return severityDiff;
  }
  return a.label.localeCompare(b.label);
}

function resolveFocusIssueFamily(item: FocusPanelItem) {
  const issueType = (item.issueType || "").toUpperCase();
  const haystack = `${item.label} ${item.reason}`.toLowerCase();
  if (
    issueType.includes("PROFITABILITY") ||
    /profitability|lowest profit|margin|high spend|low revenue/.test(haystack)
  ) {
    return "PROFITABILITY";
  }
  if (issueType.includes("APPROVAL")) {
    return "APPROVAL";
  }
  if (issueType.includes("MAINTENANCE")) {
    return "MAINTENANCE";
  }
  if (issueType.includes("LINKAGE")) {
    return "LINKAGE";
  }
  return issueType || "GENERAL";
}

function severityRank(value: FocusPanelItem["severity"]) {
  if (value === "CRITICAL") return 0;
  if (value === "HIGH") return 1;
  if (value === "MEDIUM") return 2;
  return 3;
}

function insightTitle(kind: CopilotInsightCard["kind"], fallback: string) {
  if (kind === "TOP_RISK") return "Top risk";
  if (kind === "BEST_NEXT_ACTION") return "Best next action";
  if (kind === "REVENUE_OPPORTUNITY") return "Revenue opportunity";
  if (kind === "MAINTENANCE_CONCERN") return "Maintenance concern";
  if (kind === "DATA_QUALITY_ISSUE") return "Data-quality issue";
  return fallback;
}

function severityBadgeClass(value: FocusPanelItem["severity"]) {
  if (value === "CRITICAL") {
    return "border border-red-200 bg-red-100 text-red-800";
  }
  if (value === "HIGH") {
    return "border border-orange-200 bg-orange-100 text-orange-800";
  }
  if (value === "MEDIUM") {
    return "border border-amber-200 bg-amber-100 text-amber-800";
  }
  return "border border-slate-200 bg-slate-100 text-slate-700";
}
