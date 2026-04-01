"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { RotateCw } from "lucide-react";

import { useAnalyticsFilters } from "@/components/layout/analytics-filters-provider";
import { AccessGate } from "@/components/layout/access-gate";
import { useRegisterCopilotContext } from "@/components/layout/ai-copilot-context";
import { scrollToFocusElement, useCopilotFocusTarget } from "@/components/layout/copilot-focus-target";
import { FilterScopeBanner, hasActiveScopeFilters } from "@/components/layout/filter-scope-banner";
import { useRole } from "@/components/layout/role-provider";
import { Card, MetricCard } from "@/components/ui/card";
import { SectionHeader } from "@/components/ui/section-header";
import { DataTable } from "@/components/ui/table";
import type { CopilotPageContext } from "@/lib/ai/contextual-copilot";
import type { AlertCopilotInsight, AlertCopilotMode } from "@/lib/ai/manager-copilot";
import {
  resolveAlertTypeLabel,
  type AlertsCenterRow,
  type AlertsCenterSummaryResponse
} from "@/lib/alerts-center";
import type { UserRole } from "@/lib/types";
import { cn, formatCurrency, formatNumber } from "@/lib/utils";

type SeverityFilter = "all" | "CRITICAL" | "WARNING";
type StatusFilter = "all" | "OPEN" | "SNOOZED" | "RESOLVED";
type TypeFilter = "all" | "APPROVAL" | "BUDGET" | "LINKAGE";
type OwnerFilter = "all" | "unassigned" | "me" | `user:${string}`;
type SortMode = "OLDEST_FIRST" | "HIGHEST_AMOUNT" | "HIGHEST_SEVERITY";
type QuickView = "none" | "NEEDS_ACTION_NOW" | "BUDGET_PRESSURE" | "LINKAGE_CLEANUP" | "STALE_APPROVALS" | "MY_ALERTS";
type AlertAction = "RESOLVE" | "SNOOZE" | "REOPEN" | "ASSIGN_OWNER";

const emptyPayload: AlertsCenterSummaryResponse = {
  filters: {
    clientId: "all",
    rigId: "all",
    from: null,
    to: null
  },
  summary: {
    criticalAlerts: 0,
    warningAlerts: 0,
    unresolvedAlerts: 0,
    resolvedToday: 0
  },
  owners: [],
  alerts: [],
  generatedAt: ""
};

export default function AlertsCenterPage() {
  const { filters } = useAnalyticsFilters();
  const { role, user } = useRole();
  const [payload, setPayload] = useState<AlertsCenterSummaryResponse>(emptyPayload);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actingAlertKey, setActingAlertKey] = useState<string | null>(null);
  const [rowFeedback, setRowFeedback] = useState<Record<string, string>>({});
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [ownerFilter, setOwnerFilter] = useState<OwnerFilter>("all");
  const [sortMode, setSortMode] = useState<SortMode>("HIGHEST_SEVERITY");
  const [quickView, setQuickView] = useState<QuickView>("none");
  const [selectedAlertKeys, setSelectedAlertKeys] = useState<string[]>([]);
  const [bulkAction, setBulkAction] = useState<AlertAction | null>(null);
  const [bulkFeedback, setBulkFeedback] = useState<string | null>(null);
  const [assigningAlertKey, setAssigningAlertKey] = useState<string | null>(null);
  const [aiInsights, setAiInsights] = useState<Record<string, AlertCopilotInsight>>({});
  const [aiExpandedKeys, setAiExpandedKeys] = useState<string[]>([]);
  const [aiActionInFlight, setAiActionInFlight] = useState<AlertCopilotMode | null>(null);
  const [aiInsightLoadingKey, setAiInsightLoadingKey] = useState<string | null>(null);
  const [aiFeedback, setAiFeedback] = useState<string | null>(null);
  const [focusedAlertKey, setFocusedAlertKey] = useState<string | null>(null);
  const [focusedSectionId, setFocusedSectionId] = useState<string | null>(null);
  const selectAllRef = useRef<HTMLInputElement | null>(null);
  const canManage = isManagerOrAdmin(role);
  const isScoped = hasActiveScopeFilters(filters);
  const approvalsHref = useMemo(() => {
    const params = buildFiltersQuery(filters);
    const query = params.toString();
    return `/approvals${query ? `?${query}` : ""}`;
  }, [filters]);
  const budgetVsActualHref = useMemo(() => {
    const params = buildFiltersQuery(filters);
    const query = params.toString();
    return `/cost-tracking/budget-vs-actual${query ? `?${query}` : ""}`;
  }, [filters]);
  const linkageCenterHref = useMemo(() => {
    const params = buildFiltersQuery(filters);
    const query = params.toString();
    return `/data-quality/linkage-center${query ? `?${query}` : ""}`;
  }, [filters]);
  const alertsCenterHref = useMemo(() => {
    const params = buildFiltersQuery(filters);
    const query = params.toString();
    return `/alerts-center${query ? `?${query}` : ""}`;
  }, [filters]);

  useCopilotFocusTarget({
    pageKey: "alerts-center",
    onFocus: (target) => {
      setFocusedAlertKey(target.targetId || null);
      setFocusedSectionId(target.sectionId || null);
      requestAnimationFrame(() => {
        scrollToFocusElement({
          targetId: target.targetId || null,
          sectionId: target.sectionId || null
        });
      });
    }
  });

  useEffect(() => {
    if (!focusedAlertKey && !focusedSectionId) {
      return;
    }
    const timer = setTimeout(() => {
      setFocusedAlertKey(null);
      setFocusedSectionId(null);
    }, 2400);
    return () => clearTimeout(timer);
  }, [focusedAlertKey, focusedSectionId]);

  const loadAlerts = useCallback(
    async (silent = false) => {
      if (!silent) {
        setLoading(true);
      } else {
        setRefreshing(true);
      }
      setError(null);
      try {
        const params = buildFiltersQuery(filters);
        params.set("includeResolved", "true");
        const query = params.toString();
        const response = await fetch(`/api/alerts-center${query ? `?${query}` : ""}`, {
          cache: "no-store"
        });
        if (!response.ok) {
          const payload = (await response.json().catch(() => null)) as { message?: string } | null;
          throw new Error(payload?.message || "Failed to load Alerts Center.");
        }
        const data = (await response.json()) as Partial<AlertsCenterSummaryResponse>;
        setPayload({
          ...emptyPayload,
          ...(data || {}),
          owners: Array.isArray(data?.owners) ? data.owners : []
        });
      } catch (loadError) {
        setPayload(emptyPayload);
        setError(loadError instanceof Error ? loadError.message : "Failed to load Alerts Center.");
      } finally {
        if (!silent) {
          setLoading(false);
        } else {
          setRefreshing(false);
        }
      }
    },
    [filters]
  );

  useEffect(() => {
    if (!canManage) {
      setLoading(false);
      return;
    }
    void loadAlerts();
  }, [canManage, loadAlerts]);

  const performAlertAction = useCallback(async ({
    alertKey,
    action,
    snoozeHours,
    ownerUserId
  }: {
    alertKey: string;
    action: AlertAction;
    snoozeHours?: number;
    ownerUserId?: string | null;
  }) => {
    const response = await fetch("/api/alerts-center", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        alertKey,
        action,
        snoozeHours: action === "SNOOZE" ? snoozeHours ?? 24 : undefined,
        ownerUserId: action === "ASSIGN_OWNER" ? ownerUserId ?? "" : undefined
      })
    });

    const responsePayload = (await response.json().catch(() => null)) as
      | {
          message?: string;
          data?: {
            snoozedUntil?: string | null;
            assignedOwnerUserId?: string | null;
            assignedOwnerName?: string | null;
          };
        }
      | null;

    if (!response.ok) {
      throw new Error(responsePayload?.message || "Failed to update alert.");
    }
    return responsePayload?.data || null;
  }, []);

  const applyAlertAction = useCallback(
    async (row: AlertsCenterRow, action: AlertAction) => {
      if (!canManage) {
        setError("Only Admin and Manager roles can update alert status.");
        return;
      }
      setActingAlertKey(row.alertKey);
      setError(null);
      setRowFeedback((current) => {
        const next = { ...current };
        delete next[row.alertKey];
        return next;
      });
      try {
        const actionData = await performAlertAction({
          alertKey: row.alertKey,
          action,
          snoozeHours: 24
        });
        setRowFeedback((current) => ({
          ...current,
          [row.alertKey]:
            action === "RESOLVE"
              ? "Resolved."
              : action === "SNOOZE"
                ? `Snoozed until ${formatDateTime(actionData?.snoozedUntil || null)}.`
                : "Reopened."
        }));
        await loadAlerts(true);
      } catch (actionError) {
        setError(actionError instanceof Error ? actionError.message : "Failed to update alert.");
      } finally {
        setActingAlertKey(null);
      }
    },
    [canManage, loadAlerts, performAlertAction]
  );

  const applyOwnerAssignment = useCallback(
    async (row: AlertsCenterRow, ownerUserId: string | null) => {
      if (!canManage) {
        setError("Only Admin and Manager roles can update alert ownership.");
        return;
      }
      setAssigningAlertKey(row.alertKey);
      setError(null);
      setRowFeedback((current) => {
        const next = { ...current };
        delete next[row.alertKey];
        return next;
      });
      try {
        const actionData = await performAlertAction({
          alertKey: row.alertKey,
          action: "ASSIGN_OWNER",
          ownerUserId
        });
        setRowFeedback((current) => ({
          ...current,
          [row.alertKey]: actionData?.assignedOwnerName
            ? `Assigned to ${actionData.assignedOwnerName}.`
            : "Unassigned."
        }));
        await loadAlerts(true);
      } catch (assignmentError) {
        setError(assignmentError instanceof Error ? assignmentError.message : "Failed to update owner assignment.");
      } finally {
        setAssigningAlertKey(null);
      }
    },
    [canManage, loadAlerts, performAlertAction]
  );

  const runAlertsCopilot = useCallback(
    async (mode: AlertCopilotMode, rows: AlertsCenterRow[]) => {
      if (!canManage) {
        setError("Only Admin and Manager roles can run AI triage in Alerts Center.");
        return [];
      }
      if (rows.length === 0) {
        setAiFeedback("Select at least one alert before running AI triage.");
        return [];
      }
      setAiActionInFlight(mode);
      setError(null);
      setAiFeedback(null);
      try {
        const response = await fetch("/api/ai/copilot/alerts", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            mode,
            alerts: rows,
            owners: payload.owners
          })
        });
        const responsePayload = (await response.json().catch(() => null)) as
          | { message?: string; insights?: AlertCopilotInsight[] }
          | null;
        if (!response.ok) {
          throw new Error(responsePayload?.message || "Failed to run AI copilot for alerts.");
        }
        const insights = Array.isArray(responsePayload?.insights) ? responsePayload.insights : [];
        if (insights.length > 0) {
          setAiInsights((current) => {
            const next = { ...current };
            for (const insight of insights) {
              next[insight.alertKey] = insight;
            }
            return next;
          });
          setAiExpandedKeys((current) => {
            const next = new Set(current);
            for (const insight of insights) {
              next.add(insight.alertKey);
            }
            return Array.from(next);
          });
        }
        return insights;
      } catch (copilotError) {
        setError(copilotError instanceof Error ? copilotError.message : "Failed to run AI copilot for alerts.");
        return [];
      } finally {
        setAiActionInFlight(null);
      }
    },
    [canManage, payload.owners]
  );

  const toggleAiInsight = useCallback((alertKey: string) => {
    setAiExpandedKeys((current) =>
      current.includes(alertKey) ? current.filter((entry) => entry !== alertKey) : [...current, alertKey]
    );
  }, []);

  const filteredAlerts = useMemo(() => {
    return payload.alerts
      .filter((row) => {
        if (severityFilter !== "all" && row.severity !== severityFilter) {
          return false;
        }
        if (statusFilter !== "all" && row.status !== statusFilter) {
          return false;
        }
        if (typeFilter !== "all" && resolveTypeGroup(row.alertType) !== typeFilter) {
          return false;
        }
        const rowOwnerId = row.assignedOwnerUserId || null;
        if (ownerFilter === "unassigned" && rowOwnerId) {
          return false;
        }
        if (ownerFilter === "me") {
          if (!user?.id) {
            return false;
          }
          if (rowOwnerId !== user.id) {
            return false;
          }
        }
        if (ownerFilter.startsWith("user:")) {
          if (rowOwnerId !== ownerFilter.slice(5)) {
            return false;
          }
        }
        return true;
      })
      .sort((a, b) => {
        if (sortMode === "OLDEST_FIRST") {
          const ageA = a.ageHours ?? -1;
          const ageB = b.ageHours ?? -1;
          if (ageB !== ageA) {
            return ageB - ageA;
          }
          return compareBySeverityThenAmount(a, b);
        }
        if (sortMode === "HIGHEST_AMOUNT") {
          const amountA = a.amount ?? -1;
          const amountB = b.amount ?? -1;
          if (amountB !== amountA) {
            return amountB - amountA;
          }
          return compareBySeverityThenAmount(a, b);
        }
        return compareBySeverityThenAmount(a, b);
      });
  }, [ownerFilter, payload.alerts, severityFilter, sortMode, statusFilter, typeFilter, user?.id]);

  useEffect(() => {
    const visibleKeys = new Set(filteredAlerts.map((row) => row.alertKey));
    setSelectedAlertKeys((current) => {
      if (visibleKeys.size === 0) {
        return current.length === 0 ? current : [];
      }
      const next = current.filter((alertKey) => visibleKeys.has(alertKey));
      return next.length === current.length ? current : next;
    });
  }, [filteredAlerts]);

  const selectedKeySet = useMemo(() => new Set(selectedAlertKeys), [selectedAlertKeys]);

  const selectedVisibleRows = useMemo(
    () => filteredAlerts.filter((row) => selectedKeySet.has(row.alertKey)),
    [filteredAlerts, selectedKeySet]
  );

  const allVisibleSelected = filteredAlerts.length > 0 && selectedVisibleRows.length === filteredAlerts.length;
  const someVisibleSelected = selectedVisibleRows.length > 0 && !allVisibleSelected;

  useEffect(() => {
    if (!selectAllRef.current) {
      return;
    }
    selectAllRef.current.indeterminate = someVisibleSelected;
  }, [someVisibleSelected]);

  const toggleRowSelection = useCallback((alertKey: string, checked: boolean) => {
    setSelectedAlertKeys((current) => {
      if (checked) {
        return current.includes(alertKey) ? current : [...current, alertKey];
      }
      return current.filter((entry) => entry !== alertKey);
    });
  }, []);

  const toggleSelectAllVisible = useCallback(
    (checked: boolean) => {
      if (!checked) {
        setSelectedAlertKeys([]);
        return;
      }
      setSelectedAlertKeys(filteredAlerts.map((row) => row.alertKey));
    },
    [filteredAlerts]
  );

  const applyBulkAlertAction = useCallback(
    async (action: AlertAction) => {
      if (!canManage) {
        setError("Only Admin and Manager roles can update alert status.");
        return;
      }
      if (selectedVisibleRows.length === 0) {
        setBulkFeedback("Select at least one visible alert before running a bulk action.");
        return;
      }
      const actionableRows = selectedVisibleRows.filter((row) => isActionApplicable(row.status, action));
      const skipped = selectedVisibleRows.length - actionableRows.length;
      if (actionableRows.length === 0) {
        setBulkFeedback("Selected alerts are not eligible for that action in their current status.");
        return;
      }

      setBulkAction(action);
      setError(null);
      setBulkFeedback(null);

      let successCount = 0;
      let failedCount = 0;
      let firstError: string | null = null;
      const feedbackEntries: Record<string, string> = {};
      const successKeys = new Set<string>();

      for (const row of actionableRows) {
        try {
          const actionData = await performAlertAction({
            alertKey: row.alertKey,
            action,
            snoozeHours: 24
          });
          feedbackEntries[row.alertKey] =
            action === "RESOLVE"
              ? "Resolved."
              : action === "SNOOZE"
                ? `Snoozed until ${formatDateTime(actionData?.snoozedUntil || null)}.`
                : "Reopened.";
          successCount += 1;
          successKeys.add(row.alertKey);
        } catch (bulkActionError) {
          failedCount += 1;
          if (!firstError) {
            firstError =
              bulkActionError instanceof Error ? bulkActionError.message : "Failed to update one or more alerts.";
          }
        }
      }

      if (Object.keys(feedbackEntries).length > 0) {
        setRowFeedback((current) => ({
          ...current,
          ...feedbackEntries
        }));
      }

      setSelectedAlertKeys((current) => current.filter((alertKey) => !successKeys.has(alertKey)));

      const actionLabel = action === "RESOLVE" ? "Resolved" : action === "SNOOZE" ? "Snoozed" : "Reopened";
      const messageParts = [`${actionLabel} ${successCount} alert${successCount === 1 ? "" : "s"}.`];
      if (skipped > 0) {
        messageParts.push(`${skipped} skipped (not applicable).`);
      }
      if (failedCount > 0) {
        messageParts.push(`${failedCount} failed.`);
      }
      setBulkFeedback(messageParts.join(" "));
      if (firstError) {
        setError(firstError);
      }

      await loadAlerts(true);
      setBulkAction(null);
    },
    [canManage, loadAlerts, performAlertAction, selectedVisibleRows]
  );

  const canBulkResolve = selectedVisibleRows.some((row) => isActionApplicable(row.status, "RESOLVE"));
  const canBulkSnooze = selectedVisibleRows.some((row) => isActionApplicable(row.status, "SNOOZE"));
  const canBulkReopen = selectedVisibleRows.some((row) => isActionApplicable(row.status, "REOPEN"));

  const runAiForSelected = useCallback(
    async (mode: AlertCopilotMode) => {
      const insights = await runAlertsCopilot(mode, selectedVisibleRows);
      if (insights.length === 0) {
        return;
      }
      if (mode === "PRIORITIZE_SELECTED") {
        const top = [...insights].sort((a, b) => b.aiPriorityScore - a.aiPriorityScore)[0];
        setAiFeedback(
          top
            ? `AI prioritization complete. Top priority score: ${top.aiPriorityScore} (${top.aiPriorityLabel}).`
            : "AI prioritization complete."
        );
        return;
      }
      if (mode === "SUGGEST_ASSIGNMENTS") {
        const withOwners = insights.filter((entry) => entry.suggestedOwnerName);
        setAiFeedback(
          withOwners.length > 0
            ? `AI suggested owners for ${withOwners.length} selected alert${withOwners.length === 1 ? "" : "s"}.`
            : "AI could not determine strong owner suggestions from current roster."
        );
        return;
      }
      setAiFeedback(`AI explanations generated for ${insights.length} selected alert${insights.length === 1 ? "" : "s"}.`);
    },
    [runAlertsCopilot, selectedVisibleRows]
  );

  const alertRows = useMemo(
    () =>
      filteredAlerts.map((row) => {
        const rowInsight = aiInsights[row.alertKey];
        const isAiExpanded = aiExpandedKeys.includes(row.alertKey);
        const isAiGenerating = aiInsightLoadingKey === row.alertKey;

        return [
        <label key={`${row.alertKey}-select`} className="inline-flex items-center">
          <input
            type="checkbox"
            checked={selectedKeySet.has(row.alertKey)}
            onChange={(event) => toggleRowSelection(row.alertKey, event.target.checked)}
            className="h-4 w-4 rounded border-slate-300 text-brand-700 focus:ring-brand-300"
            disabled={bulkAction !== null || assigningAlertKey !== null}
            aria-label={`Select alert ${row.entity}`}
          />
        </label>,
        <SeverityBadge key={`${row.alertKey}-severity`} severity={row.severity} />,
        resolveAlertTypeLabel(row.alertType),
        <div key={`${row.alertKey}-entity`} className="space-y-1">
          <p className="font-medium text-ink-900">{row.entity}</p>
          <p className="text-xs text-slate-500">{row.source}</p>
        </div>,
        <div key={`${row.alertKey}-owner`} className="min-w-[180px] space-y-1">
          <p className="text-xs font-semibold text-slate-700">{row.assignedOwnerName || "Unassigned"}</p>
          <select
            value={row.assignedOwnerUserId ? `user:${row.assignedOwnerUserId}` : "unassigned"}
            onChange={(event) => {
              const nextOwnerId = event.target.value.startsWith("user:") ? event.target.value.slice(5) : null;
              void applyOwnerAssignment(row, nextOwnerId);
            }}
            className="w-full rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs"
            disabled={!canManage || bulkAction !== null || assigningAlertKey === row.alertKey}
          >
            <option value="unassigned">Unassigned</option>
            {row.assignedOwnerUserId && !payload.owners.some((owner) => owner.userId === row.assignedOwnerUserId) ? (
              <option value={`user:${row.assignedOwnerUserId}`}>{row.assignedOwnerName || "Assigned User"}</option>
            ) : null}
            {payload.owners.map((owner) => (
              <option key={`${row.alertKey}-owner-option-${owner.userId}`} value={`user:${owner.userId}`}>
                {owner.name}
              </option>
            ))}
          </select>
        </div>,
        row.amount !== null ? formatCurrency(row.amount) : "-",
        formatAge(row.ageHours),
        row.currentContext,
        row.recommendedAction,
        <Link key={`${row.alertKey}-link`} href={row.destinationHref} className="gf-btn-subtle text-xs">
          Open
        </Link>,
        <span
          key={`${row.alertKey}-status`}
          className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
            row.status === "SNOOZED"
              ? "border-slate-300 bg-slate-100 text-slate-700"
              : row.status === "RESOLVED"
                ? "border-emerald-300 bg-emerald-100 text-emerald-800"
                : "border-blue-200 bg-blue-50 text-blue-700"
          }`}
        >
          {row.status === "SNOOZED" ? "Snoozed" : row.status === "RESOLVED" ? "Resolved" : "Open"}
        </span>,
        <div key={`${row.alertKey}-actions`} className="min-w-[190px] space-y-1.5">
          <div className="flex flex-wrap gap-1.5">
            {row.status !== "RESOLVED" ? (
              <button
                type="button"
                onClick={() => void applyAlertAction(row, "RESOLVE")}
                disabled={
                  actingAlertKey === row.alertKey ||
                  assigningAlertKey === row.alertKey ||
                  bulkAction !== null ||
                  !canManage
                }
                className="gf-btn-subtle text-xs"
              >
                {actingAlertKey === row.alertKey ? "Saving..." : "Resolve"}
              </button>
            ) : null}
            {row.status === "OPEN" ? (
              <button
                type="button"
                onClick={() => void applyAlertAction(row, "SNOOZE")}
                disabled={
                  actingAlertKey === row.alertKey ||
                  assigningAlertKey === row.alertKey ||
                  bulkAction !== null ||
                  !canManage
                }
                className="gf-btn-subtle text-xs"
              >
                {actingAlertKey === row.alertKey ? "Saving..." : "Snooze 24h"}
              </button>
            ) : null}
            {row.status !== "OPEN" ? (
              <button
                type="button"
                onClick={() => void applyAlertAction(row, "REOPEN")}
                disabled={
                  actingAlertKey === row.alertKey ||
                  assigningAlertKey === row.alertKey ||
                  bulkAction !== null ||
                  !canManage
                }
                className="gf-btn-subtle text-xs"
              >
                {actingAlertKey === row.alertKey ? "Saving..." : "Reopen"}
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => {
                if (!rowInsight) {
                  setAiInsightLoadingKey(row.alertKey);
                  void runAlertsCopilot("ROW_INSIGHT", [row])
                    .then(() => {
                      setAiFeedback("AI insight generated for selected row.");
                      setAiExpandedKeys((current) =>
                        current.includes(row.alertKey) ? current : [...current, row.alertKey]
                      );
                    })
                    .finally(() => {
                      setAiInsightLoadingKey((current) => (current === row.alertKey ? null : current));
                    });
                  return;
                }
                toggleAiInsight(row.alertKey);
              }}
              disabled={aiActionInFlight !== null || bulkAction !== null || assigningAlertKey !== null}
              className="gf-btn-subtle text-xs"
            >
              {isAiGenerating ? "Generating..." : rowInsight ? "AI Insight" : "Generate AI"}
            </button>
          </div>
          {rowFeedback[row.alertKey] ? <p className="text-xs text-emerald-700">{rowFeedback[row.alertKey]}</p> : null}
          {isAiExpanded ? (
            <div className="rounded-lg border border-indigo-100 bg-indigo-50/60 p-2">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-indigo-700">AI-generated advisory</p>
              {rowInsight ? (
                <div className="mt-1 space-y-1.5 text-xs text-slate-700">
                  <p>
                    <span className="font-semibold text-slate-900">Priority:</span> {rowInsight.aiPriorityLabel} (
                    {rowInsight.aiPriorityScore}/100)
                  </p>
                  <p>
                    <span className="font-semibold text-slate-900">Why:</span> {rowInsight.whyItMatters}
                  </p>
                  <p>
                    <span className="font-semibold text-slate-900">Next action:</span> {rowInsight.suggestedNextAction}
                  </p>
                  <p>
                    <span className="font-semibold text-slate-900">Suggested owner:</span>{" "}
                    {rowInsight.suggestedOwnerName || "No strong suggestion"}
                  </p>
                </div>
              ) : (
                <p className="mt-1 text-xs text-slate-600">
                  {isAiGenerating ? "Generating insight..." : "No AI insight generated yet for this alert."}
                </p>
              )}
            </div>
          ) : null}
        </div>
      ];
      }),
    [
      aiActionInFlight,
      aiExpandedKeys,
      aiInsightLoadingKey,
      aiInsights,
      actingAlertKey,
      applyAlertAction,
      assigningAlertKey,
      runAlertsCopilot,
      toggleAiInsight,
      applyOwnerAssignment,
      bulkAction,
      canManage,
      filteredAlerts,
      payload.owners,
      rowFeedback,
      selectedKeySet,
      toggleRowSelection
    ]
  );

  const alertRowIds = useMemo(
    () => filteredAlerts.map((row) => `ai-focus-${row.alertKey}`),
    [filteredAlerts]
  );

  const alertRowClassNames = useMemo(
    () =>
      filteredAlerts.map((row) =>
        row.alertKey === focusedAlertKey ? "bg-indigo-50/70 ring-1 ring-inset ring-indigo-200" : ""
      ),
    [filteredAlerts, focusedAlertKey]
  );

  const applyQuickView = useCallback((view: QuickView) => {
    setQuickView(view);
    switch (view) {
      case "NEEDS_ACTION_NOW":
        setSeverityFilter("CRITICAL");
        setStatusFilter("OPEN");
        setTypeFilter("all");
        setOwnerFilter("all");
        setSortMode("HIGHEST_SEVERITY");
        break;
      case "BUDGET_PRESSURE":
        setSeverityFilter("all");
        setStatusFilter("OPEN");
        setTypeFilter("BUDGET");
        setOwnerFilter("all");
        setSortMode("HIGHEST_AMOUNT");
        break;
      case "LINKAGE_CLEANUP":
        setSeverityFilter("all");
        setStatusFilter("OPEN");
        setTypeFilter("LINKAGE");
        setOwnerFilter("all");
        setSortMode("OLDEST_FIRST");
        break;
      case "STALE_APPROVALS":
        setSeverityFilter("all");
        setStatusFilter("OPEN");
        setTypeFilter("APPROVAL");
        setOwnerFilter("all");
        setSortMode("OLDEST_FIRST");
        break;
      case "MY_ALERTS":
        setSeverityFilter("all");
        setStatusFilter("OPEN");
        setTypeFilter("all");
        setOwnerFilter("me");
        setSortMode("HIGHEST_SEVERITY");
        break;
      default:
        setSeverityFilter("all");
        setStatusFilter("all");
        setTypeFilter("all");
        setOwnerFilter("all");
        setSortMode("HIGHEST_SEVERITY");
    }
  }, []);

  const copilotContext = useMemo<CopilotPageContext>(
    () => ({
      pageKey: "alerts-center",
      pageName: "Alerts Center",
      filters: {
        clientId: filters.clientId,
        rigId: filters.rigId,
        from: filters.from || null,
        to: filters.to || null
      },
      summaryMetrics: [
        { key: "criticalAlerts", label: "Critical Alerts", value: payload.summary.criticalAlerts },
        { key: "warningAlerts", label: "Warning Alerts", value: payload.summary.warningAlerts },
        { key: "unresolvedAlerts", label: "Unresolved Alerts", value: payload.summary.unresolvedAlerts },
        { key: "resolvedToday", label: "Resolved Today", value: payload.summary.resolvedToday },
        { key: "visibleAlerts", label: "Visible Alerts", value: filteredAlerts.length },
        { key: "selectedAlerts", label: "Selected Alerts", value: selectedVisibleRows.length }
      ],
      tablePreviews: [
        {
          key: "visible-alerts",
          title: "Visible Alerts",
          rowCount: filteredAlerts.filter((row) => row.status !== "RESOLVED").length,
          columns: ["AlertKey", "Type", "Entity", "Severity", "Status", "Amount", "AgeHours", "Destination"],
          rows: filteredAlerts.slice(0, 10).map((row) => ({
            alertKey: row.alertKey,
            id: row.alertKey,
            type: resolveAlertTypeLabel(row.alertType),
            alertType: row.alertType,
            entity: row.entity,
            severity: row.severity,
            status: row.status,
            amount: row.amount,
            ageHours: row.ageHours,
            destinationHref: row.destinationHref,
            href: alertsCenterHref,
            targetId: row.alertKey,
            sectionId: "alerts-active-section",
            targetPageKey: "alerts-center"
          }))
        }
      ],
      selectedItems: selectedVisibleRows.slice(0, 20).map((row) => ({
        id: row.alertKey,
        type: "alert",
        label: row.entity
      })),
      priorityItems: filteredAlerts
        .filter((row) => row.status !== "RESOLVED")
        .slice(0, 6)
        .map((row) => ({
          id: row.alertKey,
          label: row.entity,
          reason: `${resolveAlertTypeLabel(row.alertType)} • ${row.status === "OPEN" ? "Resolve first" : row.status} • ${formatAge(row.ageHours)} age`,
          severity: row.severity === "CRITICAL" ? ("CRITICAL" as const) : ("HIGH" as const),
          amount: row.amount,
          href: alertsCenterHref,
          issueType: row.alertType,
          targetId: row.alertKey,
          sectionId: "alerts-active-section",
          targetPageKey: "alerts-center"
        })),
      navigationTargets: [
        { label: "Open Approvals", href: approvalsHref, reason: "Process stale pending items.", pageKey: "approvals" },
        { label: "Open Budget vs Actual", href: budgetVsActualHref, reason: "Review budget-driven alerts.", pageKey: "budget-vs-actual" },
        { label: "Open Data Quality Center", href: linkageCenterHref, reason: "Resolve linkage-related alerts.", pageKey: "data-quality-linkage-center" },
        {
          label: "Open Drilling Reports Approvals",
          href: `${approvalsHref}${approvalsHref.includes("?") ? "&" : "?"}tab=drilling-reports`,
          reason: "Review drilling approvals with stale or critical alert signals.",
          pageKey: "approvals",
          sectionId: "approvals-tab-drilling-reports"
        }
      ],
      notes: [
        quickView === "none" ? "Default triage view is active." : `Quick view active: ${quickView}.`
      ]
    }),
    [
      approvalsHref,
      alertsCenterHref,
      budgetVsActualHref,
      filteredAlerts,
      filters.clientId,
      filters.from,
      filters.rigId,
      filters.to,
      linkageCenterHref,
      payload.summary.criticalAlerts,
      payload.summary.resolvedToday,
      payload.summary.unresolvedAlerts,
      payload.summary.warningAlerts,
      quickView,
      selectedVisibleRows
    ]
  );

  useRegisterCopilotContext(copilotContext);

  return (
    <AccessGate permission="finance:view">
      <div className="gf-page-stack">
        <FilterScopeBanner filters={filters} />

        {!canManage ? (
          <Card>
            <p className="text-sm text-slate-700">
              Alerts Center is available to Admin and Manager roles for operational triage actions.
            </p>
          </Card>
        ) : null}

        {canManage ? (
          <>
        {error ? <div className="gf-feedback-error">{error}</div> : null}

        <section
          id="alerts-active-section"
          className={cn(
            "gf-section",
            focusedSectionId === "alerts-active-section" && "rounded-2xl ring-2 ring-indigo-100 ring-offset-2 ring-offset-slate-50"
          )}
        >
          <SectionHeader
            title="Alerts Center"
            description="Consolidated manager workspace for budget pressure, stale approvals, and linkage attention."
            action={
              <button
                type="button"
                onClick={() => void loadAlerts(true)}
                className="gf-btn-subtle inline-flex items-center gap-1"
              >
                <RotateCw size={13} className={refreshing ? "animate-spin" : ""} />
                Refresh
              </button>
            }
          />

          <div className="gf-kpi-grid-primary">
            <MetricCard label="Critical Alerts" value={formatNumber(payload.summary.criticalAlerts)} tone="danger" />
            <MetricCard label="Warning Alerts" value={formatNumber(payload.summary.warningAlerts)} tone="warn" />
            <MetricCard
              label={isScoped ? "Unresolved Alerts in Scope" : "Unresolved Alerts"}
              value={formatNumber(payload.summary.unresolvedAlerts)}
            />
            <MetricCard label="Resolved Today" value={formatNumber(payload.summary.resolvedToday)} tone="good" />
          </div>
        </section>

        <section className="gf-section">
          <SectionHeader
            title="Active Alerts"
            description="Live derived alerts sorted by severity and urgency."
          />
          <Card className="p-4 md:p-4 lg:p-4">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
              <div className="space-y-1">
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Severity</label>
                <select
                  value={severityFilter}
                  onChange={(event) => {
                    setSeverityFilter(event.target.value as SeverityFilter);
                    setQuickView("none");
                  }}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                >
                  <option value="all">All</option>
                  <option value="CRITICAL">Critical</option>
                  <option value="WARNING">Warning</option>
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Status</label>
                <select
                  value={statusFilter}
                  onChange={(event) => {
                    setStatusFilter(event.target.value as StatusFilter);
                    setQuickView("none");
                  }}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                >
                  <option value="all">All</option>
                  <option value="OPEN">Open</option>
                  <option value="SNOOZED">Snoozed</option>
                  <option value="RESOLVED">Resolved</option>
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Type</label>
                <select
                  value={typeFilter}
                  onChange={(event) => {
                    setTypeFilter(event.target.value as TypeFilter);
                    setQuickView("none");
                  }}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                >
                  <option value="all">All</option>
                  <option value="APPROVAL">Approval</option>
                  <option value="BUDGET">Budget</option>
                  <option value="LINKAGE">Linkage</option>
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Owner</label>
                <select
                  value={ownerFilter}
                  onChange={(event) => {
                    setOwnerFilter(event.target.value as OwnerFilter);
                    setQuickView("none");
                  }}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                >
                  <option value="all">All</option>
                  <option value="unassigned">Unassigned</option>
                  <option value="me">Me</option>
                  {payload.owners.map((owner) => (
                    <option key={`owner-filter-${owner.userId}`} value={`user:${owner.userId}`}>
                      {owner.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Sort</label>
                <select
                  value={sortMode}
                  onChange={(event) => {
                    setSortMode(event.target.value as SortMode);
                    setQuickView("none");
                  }}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                >
                  <option value="OLDEST_FIRST">Oldest first</option>
                  <option value="HIGHEST_AMOUNT">Highest amount</option>
                  <option value="HIGHEST_SEVERITY">Highest severity</option>
                </select>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <QuickViewButton
                label="Needs action now"
                active={quickView === "NEEDS_ACTION_NOW"}
                onClick={() => applyQuickView("NEEDS_ACTION_NOW")}
              />
              <QuickViewButton
                label="Budget pressure"
                active={quickView === "BUDGET_PRESSURE"}
                onClick={() => applyQuickView("BUDGET_PRESSURE")}
              />
              <QuickViewButton
                label="Linkage cleanup"
                active={quickView === "LINKAGE_CLEANUP"}
                onClick={() => applyQuickView("LINKAGE_CLEANUP")}
              />
              <QuickViewButton
                label="Stale approvals"
                active={quickView === "STALE_APPROVALS"}
                onClick={() => applyQuickView("STALE_APPROVALS")}
              />
              <QuickViewButton
                label="My alerts"
                active={quickView === "MY_ALERTS"}
                onClick={() => applyQuickView("MY_ALERTS")}
              />
              <QuickViewButton
                label="Reset"
                active={quickView === "none"}
                onClick={() => applyQuickView("none")}
              />
            </div>
          </Card>
          <Card>
            {loading ? (
              <p className="text-sm text-slate-600">Loading alerts...</p>
            ) : alertRows.length === 0 ? (
              <div className="gf-empty-state">No alerts match the current triage view.</div>
            ) : (
              <>
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50/80 px-3 py-2">
                  <p className="text-xs font-medium text-slate-700">
                    {formatNumber(selectedVisibleRows.length)} selected in current view
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      onClick={() => void applyBulkAlertAction("RESOLVE")}
                      className="gf-btn-subtle text-xs"
                      disabled={!canBulkResolve || bulkAction !== null || assigningAlertKey !== null}
                    >
                      {bulkAction === "RESOLVE" ? "Applying..." : "Resolve selected"}
                    </button>
                    <button
                      type="button"
                      onClick={() => void applyBulkAlertAction("SNOOZE")}
                      className="gf-btn-subtle text-xs"
                      disabled={!canBulkSnooze || bulkAction !== null || assigningAlertKey !== null}
                    >
                      {bulkAction === "SNOOZE" ? "Applying..." : "Snooze selected 24h"}
                    </button>
                    <button
                      type="button"
                      onClick={() => void applyBulkAlertAction("REOPEN")}
                      className="gf-btn-subtle text-xs"
                      disabled={!canBulkReopen || bulkAction !== null || assigningAlertKey !== null}
                    >
                      {bulkAction === "REOPEN" ? "Applying..." : "Reopen selected"}
                    </button>
                    <button
                      type="button"
                      onClick={() => void runAiForSelected("PRIORITIZE_SELECTED")}
                      className="gf-btn-subtle text-xs"
                      disabled={selectedVisibleRows.length === 0 || aiActionInFlight !== null}
                    >
                      {aiActionInFlight === "PRIORITIZE_SELECTED" ? "AI..." : "Prioritize selected with AI"}
                    </button>
                    <button
                      type="button"
                      onClick={() => void runAiForSelected("EXPLAIN_SELECTED")}
                      className="gf-btn-subtle text-xs"
                      disabled={selectedVisibleRows.length === 0 || aiActionInFlight !== null}
                    >
                      {aiActionInFlight === "EXPLAIN_SELECTED" ? "AI..." : "Explain selected with AI"}
                    </button>
                    <button
                      type="button"
                      onClick={() => void runAiForSelected("SUGGEST_ASSIGNMENTS")}
                      className="gf-btn-subtle text-xs"
                      disabled={selectedVisibleRows.length === 0 || aiActionInFlight !== null}
                    >
                      {aiActionInFlight === "SUGGEST_ASSIGNMENTS" ? "AI..." : "Suggest assignments with AI"}
                    </button>
                  </div>
                </div>
                {bulkFeedback ? <p className="mb-2 text-xs text-emerald-700">{bulkFeedback}</p> : null}
                {aiFeedback ? <p className="mb-2 text-xs text-indigo-700">AI-generated advisory: {aiFeedback}</p> : null}
                <p className="mb-2 text-[11px] text-slate-500">
                  Use this alerts queue for page-first triage, then open the global assistant for cross-page routing if needed.
                </p>
                <DataTable
                  columns={[
                    <div key="select-all" className="inline-flex items-center gap-2">
                      <input
                        ref={selectAllRef}
                        type="checkbox"
                        checked={allVisibleSelected}
                        onChange={(event) => toggleSelectAllVisible(event.target.checked)}
                        className="h-4 w-4 rounded border-slate-300 text-brand-700 focus:ring-brand-300"
                        disabled={bulkAction !== null || assigningAlertKey !== null}
                        aria-label="Select all visible alerts"
                      />
                      <span>Select</span>
                    </div>,
                    "Severity",
                    "Alert Type",
                    "Entity / Source",
                    "Assigned To",
                    "Amount",
                    "Age",
                    "Current Context",
                    "Recommended Action",
                    "Quick Link",
                    "Status",
                    "Actions"
                  ]}
                  rows={alertRows}
                  rowIds={alertRowIds}
                  rowClassNames={alertRowClassNames}
                />
              </>
            )}
          </Card>
        </section>
          </>
        ) : null}
      </div>
    </AccessGate>
  );
}

function SeverityBadge({ severity }: { severity: AlertsCenterRow["severity"] }) {
  if (severity === "CRITICAL") {
    return (
      <span className="inline-flex rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-red-700">
        Critical
      </span>
    );
  }
  return (
    <span className="inline-flex rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700">
      Warning
    </span>
  );
}

function formatAge(ageHours: number | null) {
  if (ageHours === null) {
    return "-";
  }
  if (ageHours < 24) {
    return `${ageHours}h`;
  }
  const days = Math.floor(ageHours / 24);
  const remHours = ageHours % 24;
  if (remHours === 0) {
    return `${days}d`;
  }
  return `${days}d ${remHours}h`;
}

function formatDateTime(value: string | null) {
  if (!value) {
    return "-";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "-";
  }
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(parsed);
}

function buildFiltersQuery(filters: { clientId: string; rigId: string; from: string; to: string }) {
  const params = new URLSearchParams();
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  if (filters.clientId !== "all") params.set("clientId", filters.clientId);
  if (filters.rigId !== "all") params.set("rigId", filters.rigId);
  return params;
}

function isManagerOrAdmin(role: UserRole | null) {
  return role === "ADMIN" || role === "MANAGER";
}

function resolveTypeGroup(alertType: AlertsCenterRow["alertType"]): TypeFilter {
  if (alertType === "STALE_PENDING_APPROVAL") {
    return "APPROVAL";
  }
  if (alertType === "BUDGET_OVERSPENT" || alertType === "BUDGET_CRITICAL" || alertType === "BUDGET_WATCH") {
    return "BUDGET";
  }
  return "LINKAGE";
}

function isActionApplicable(status: AlertsCenterRow["status"], action: AlertAction) {
  if (action === "RESOLVE") {
    return status !== "RESOLVED";
  }
  if (action === "SNOOZE") {
    return status === "OPEN";
  }
  return status !== "OPEN";
}

function compareBySeverityThenAmount(a: AlertsCenterRow, b: AlertsCenterRow) {
  const severityRank = (value: AlertsCenterRow["severity"]) => (value === "CRITICAL" ? 0 : 1);
  const rankDiff = severityRank(a.severity) - severityRank(b.severity);
  if (rankDiff !== 0) {
    return rankDiff;
  }
  const amountA = a.amount || 0;
  const amountB = b.amount || 0;
  if (amountB !== amountA) {
    return amountB - amountA;
  }
  const ageA = a.ageHours || 0;
  const ageB = b.ageHours || 0;
  return ageB - ageA;
}

function QuickViewButton({
  label,
  active,
  onClick
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        active
          ? "rounded-full border border-brand-300 bg-brand-100 px-3 py-1 text-xs font-medium text-brand-900"
          : "rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
      }
    >
      {label}
    </button>
  );
}
