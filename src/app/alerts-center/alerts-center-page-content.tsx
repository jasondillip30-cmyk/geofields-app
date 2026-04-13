"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAnalyticsFilters } from "@/components/layout/analytics-filters-provider";
import { AccessGate } from "@/components/layout/access-gate";
import { useRegisterCopilotContext } from "@/components/layout/ai-copilot-context";
import { scrollToFocusElement, useCopilotFocusTarget } from "@/components/layout/copilot-focus-target";
import { FilterScopeBanner, hasActiveScopeFilters } from "@/components/layout/filter-scope-banner";
import { useRole } from "@/components/layout/role-provider";
import { Card } from "@/components/ui/card";
import type { CopilotPageContext } from "@/lib/ai/contextual-copilot";
import type { AlertCopilotInsight, AlertCopilotMode } from "@/lib/ai/manager-copilot";
import {
  resolveAlertTypeLabel,
  type AlertsCenterRow,
  type AlertsCenterSummaryResponse
} from "@/lib/alerts-center";
import {
  type AlertAction,
  type OwnerFilter,
  type QuickView,
  type SeverityFilter,
  type SortMode,
  type StatusFilter,
  type TypeFilter,
  emptyPayload
} from "@/app/alerts-center/alerts-center-page-types";
import {
  buildFiltersQuery,
  compareBySeverityThenAmount,
  formatAge,
  formatDateTime,
  isActionApplicable,
  isManagerOrAdmin,
  resolveTypeGroup
} from "@/app/alerts-center/alerts-center-page-helpers";
import { AlertsCenterActiveSection } from "@/app/alerts-center/alerts-center-active-section";

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
  const canManage = isManagerOrAdmin(role);
  const isScoped = hasActiveScopeFilters(filters);
  const approvalsHref = useMemo(() => {
    const params = buildFiltersQuery(filters);
    const query = params.toString();
    return `/approvals${query ? `?${query}` : ""}`;
  }, [filters]);
  const projectOperationsHref = useMemo(() => {
    const params = buildFiltersQuery(filters);
    const query = params.toString();
    return `/spending${query ? `?${query}` : ""}`;
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

  const generateRowAiInsight = useCallback(
    (row: AlertsCenterRow) => {
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
    },
    [runAlertsCopilot]
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
        {
          label: "Open Project Operations",
          href: projectOperationsHref,
          reason: "Review project finance context in the Spending workspace.",
          pageKey: "project-operations"
        },
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
      projectOperationsHref,
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

        <AlertsCenterActiveSection
          isScoped={isScoped}
          loading={loading}
          refreshing={refreshing}
          payload={payload}
          focusedSectionId={focusedSectionId}
          focusedAlertKey={focusedAlertKey}
          severityFilter={severityFilter}
          statusFilter={statusFilter}
          typeFilter={typeFilter}
          ownerFilter={ownerFilter}
          sortMode={sortMode}
          quickView={quickView}
          filteredAlerts={filteredAlerts}
          selectedVisibleRows={selectedVisibleRows}
          selectedKeySet={selectedKeySet}
          actingAlertKey={actingAlertKey}
          assigningAlertKey={assigningAlertKey}
          canManage={canManage}
          bulkAction={bulkAction}
          rowFeedback={rowFeedback}
          canBulkResolve={canBulkResolve}
          canBulkSnooze={canBulkSnooze}
          canBulkReopen={canBulkReopen}
          bulkFeedback={bulkFeedback}
          aiFeedback={aiFeedback}
          aiInsights={aiInsights}
          aiExpandedKeys={aiExpandedKeys}
          aiInsightLoadingKey={aiInsightLoadingKey}
          aiActionInFlight={aiActionInFlight}
          onRefresh={() => void loadAlerts(true)}
          onSeverityFilterChange={(value) => {
            setSeverityFilter(value);
            setQuickView("none");
          }}
          onStatusFilterChange={(value) => {
            setStatusFilter(value);
            setQuickView("none");
          }}
          onTypeFilterChange={(value) => {
            setTypeFilter(value);
            setQuickView("none");
          }}
          onOwnerFilterChange={(value) => {
            setOwnerFilter(value);
            setQuickView("none");
          }}
          onSortModeChange={(value) => {
            setSortMode(value);
            setQuickView("none");
          }}
          onApplyQuickView={applyQuickView}
          onToggleRowSelection={toggleRowSelection}
          onToggleSelectAllVisible={toggleSelectAllVisible}
          onApplyBulkAlertAction={(action) => void applyBulkAlertAction(action)}
          onRunAiForSelected={(mode) => void runAiForSelected(mode)}
          onApplyAlertAction={(row, action) => void applyAlertAction(row, action)}
          onApplyOwnerAssignment={(row, ownerUserId) => void applyOwnerAssignment(row, ownerUserId)}
          onGenerateRowInsight={generateRowAiInsight}
          onToggleAiInsight={toggleAiInsight}
        />
          </>
        ) : null}
      </div>
    </AccessGate>
  );
}
