"use client";

import { useEffect, useMemo, useRef } from "react";
import Link from "next/link";
import { RotateCw } from "lucide-react";

import { Card, MetricCard } from "@/components/ui/card";
import { SectionHeader } from "@/components/ui/section-header";
import { DataTable } from "@/components/ui/table";
import { resolveAlertTypeLabel, type AlertsCenterRow, type AlertsCenterSummaryResponse } from "@/lib/alerts-center";
import { cn, formatCurrency, formatNumber } from "@/lib/utils";
import type {
  AlertAction,
  OwnerFilter,
  QuickView,
  SeverityFilter,
  SortMode,
  StatusFilter,
  TypeFilter
} from "@/app/alerts-center/alerts-center-page-types";
import {
  formatAge,
  QuickViewButton,
  SeverityBadge
} from "@/app/alerts-center/alerts-center-page-helpers";

interface AlertsCenterActiveSectionProps {
  isScoped: boolean;
  loading: boolean;
  refreshing: boolean;
  payload: AlertsCenterSummaryResponse;
  focusedSectionId: string | null;
  focusedAlertKey: string | null;
  severityFilter: SeverityFilter;
  statusFilter: StatusFilter;
  typeFilter: TypeFilter;
  ownerFilter: OwnerFilter;
  sortMode: SortMode;
  quickView: QuickView;
  filteredAlerts: AlertsCenterRow[];
  selectedVisibleRows: AlertsCenterRow[];
  selectedKeySet: Set<string>;
  actingAlertKey: string | null;
  assigningAlertKey: string | null;
  canManage: boolean;
  bulkAction: AlertAction | null;
  rowFeedback: Record<string, string>;
  canBulkResolve: boolean;
  canBulkSnooze: boolean;
  canBulkReopen: boolean;
  bulkFeedback: string | null;
  aiFeedback: string | null;
  aiInsights: Record<string, { aiPriorityScore: number; aiPriorityLabel: string; whyItMatters: string; suggestedNextAction: string; suggestedOwnerName: string | null }>;
  aiExpandedKeys: string[];
  aiInsightLoadingKey: string | null;
  aiActionInFlight: "EXPLAIN_SELECTED" | "SUGGEST_ASSIGNMENTS" | "PRIORITIZE_SELECTED" | "ROW_INSIGHT" | null;
  onRefresh: () => void;
  onSeverityFilterChange: (value: SeverityFilter) => void;
  onStatusFilterChange: (value: StatusFilter) => void;
  onTypeFilterChange: (value: TypeFilter) => void;
  onOwnerFilterChange: (value: OwnerFilter) => void;
  onSortModeChange: (value: SortMode) => void;
  onApplyQuickView: (value: QuickView) => void;
  onToggleRowSelection: (alertKey: string, checked: boolean) => void;
  onToggleSelectAllVisible: (checked: boolean) => void;
  onApplyBulkAlertAction: (action: AlertAction) => void;
  onRunAiForSelected: (mode: "EXPLAIN_SELECTED" | "SUGGEST_ASSIGNMENTS" | "PRIORITIZE_SELECTED") => void;
  onApplyAlertAction: (row: AlertsCenterRow, action: AlertAction) => void;
  onApplyOwnerAssignment: (row: AlertsCenterRow, ownerUserId: string | null) => void;
  onGenerateRowInsight: (row: AlertsCenterRow) => void;
  onToggleAiInsight: (alertKey: string) => void;
}

export function AlertsCenterActiveSection({
  isScoped,
  loading,
  refreshing,
  payload,
  focusedSectionId,
  focusedAlertKey,
  severityFilter,
  statusFilter,
  typeFilter,
  ownerFilter,
  sortMode,
  quickView,
  filteredAlerts,
  selectedVisibleRows,
  selectedKeySet,
  actingAlertKey,
  assigningAlertKey,
  canManage,
  bulkAction,
  rowFeedback,
  canBulkResolve,
  canBulkSnooze,
  canBulkReopen,
  bulkFeedback,
  aiFeedback,
  aiInsights,
  aiExpandedKeys,
  aiInsightLoadingKey,
  aiActionInFlight,
  onRefresh,
  onSeverityFilterChange,
  onStatusFilterChange,
  onTypeFilterChange,
  onOwnerFilterChange,
  onSortModeChange,
  onApplyQuickView,
  onToggleRowSelection,
  onToggleSelectAllVisible,
  onApplyBulkAlertAction,
  onRunAiForSelected,
  onApplyAlertAction,
  onApplyOwnerAssignment,
  onGenerateRowInsight,
  onToggleAiInsight
}: AlertsCenterActiveSectionProps) {
  const selectAllRef = useRef<HTMLInputElement | null>(null);
  const allVisibleSelected =
    filteredAlerts.length > 0 && selectedVisibleRows.length === filteredAlerts.length;
  const someVisibleSelected =
    selectedVisibleRows.length > 0 && !allVisibleSelected;

  useEffect(() => {
    if (!selectAllRef.current) {
      return;
    }
    selectAllRef.current.indeterminate = someVisibleSelected;
  }, [someVisibleSelected]);

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
              onChange={(event) => onToggleRowSelection(row.alertKey, event.target.checked)}
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
                const nextOwnerId = event.target.value.startsWith("user:")
                  ? event.target.value.slice(5)
                  : null;
                onApplyOwnerAssignment(row, nextOwnerId);
              }}
              className="w-full rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs"
              disabled={!canManage || bulkAction !== null || assigningAlertKey === row.alertKey}
            >
              <option value="unassigned">Unassigned</option>
              {row.assignedOwnerUserId &&
              !payload.owners.some((owner) => owner.userId === row.assignedOwnerUserId) ? (
                <option value={`user:${row.assignedOwnerUserId}`}>
                  {row.assignedOwnerName || "Assigned User"}
                </option>
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
                  onClick={() => onApplyAlertAction(row, "RESOLVE")}
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
                  onClick={() => onApplyAlertAction(row, "SNOOZE")}
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
                  onClick={() => onApplyAlertAction(row, "REOPEN")}
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
                    onGenerateRowInsight(row);
                    return;
                  }
                  onToggleAiInsight(row.alertKey);
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
                <p className="text-[10px] font-semibold uppercase tracking-wide text-indigo-700">
                  AI-generated advisory
                </p>
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
                      <span className="font-semibold text-slate-900">Next action:</span>{" "}
                      {rowInsight.suggestedNextAction}
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
      assigningAlertKey,
      bulkAction,
      canManage,
      filteredAlerts,
      onApplyAlertAction,
      onApplyOwnerAssignment,
      onGenerateRowInsight,
      onToggleAiInsight,
      onToggleRowSelection,
      payload.owners,
      rowFeedback,
      selectedKeySet
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

  return (
    <>
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
            <button type="button" onClick={onRefresh} className="gf-btn-subtle inline-flex items-center gap-1">
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
        <SectionHeader title="Active Alerts" description="Live derived alerts sorted by severity and urgency." />
        <Card className="p-4 md:p-4 lg:p-4">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
            <div className="space-y-1">
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Severity</label>
              <select
                value={severityFilter}
                onChange={(event) => onSeverityFilterChange(event.target.value as SeverityFilter)}
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
                onChange={(event) => onStatusFilterChange(event.target.value as StatusFilter)}
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
                onChange={(event) => onTypeFilterChange(event.target.value as TypeFilter)}
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
                onChange={(event) => onOwnerFilterChange(event.target.value as OwnerFilter)}
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
                onChange={(event) => onSortModeChange(event.target.value as SortMode)}
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
              onClick={() => onApplyQuickView("NEEDS_ACTION_NOW")}
            />
            <QuickViewButton
              label="Budget pressure"
              active={quickView === "BUDGET_PRESSURE"}
              onClick={() => onApplyQuickView("BUDGET_PRESSURE")}
            />
            <QuickViewButton
              label="Linkage cleanup"
              active={quickView === "LINKAGE_CLEANUP"}
              onClick={() => onApplyQuickView("LINKAGE_CLEANUP")}
            />
            <QuickViewButton
              label="Stale approvals"
              active={quickView === "STALE_APPROVALS"}
              onClick={() => onApplyQuickView("STALE_APPROVALS")}
            />
            <QuickViewButton
              label="My alerts"
              active={quickView === "MY_ALERTS"}
              onClick={() => onApplyQuickView("MY_ALERTS")}
            />
            <QuickViewButton label="Reset" active={quickView === "none"} onClick={() => onApplyQuickView("none")} />
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
                    onClick={() => onApplyBulkAlertAction("RESOLVE")}
                    className="gf-btn-subtle text-xs"
                    disabled={!canBulkResolve || bulkAction !== null || assigningAlertKey !== null}
                  >
                    {bulkAction === "RESOLVE" ? "Applying..." : "Resolve selected"}
                  </button>
                  <button
                    type="button"
                    onClick={() => onApplyBulkAlertAction("SNOOZE")}
                    className="gf-btn-subtle text-xs"
                    disabled={!canBulkSnooze || bulkAction !== null || assigningAlertKey !== null}
                  >
                    {bulkAction === "SNOOZE" ? "Applying..." : "Snooze selected 24h"}
                  </button>
                  <button
                    type="button"
                    onClick={() => onApplyBulkAlertAction("REOPEN")}
                    className="gf-btn-subtle text-xs"
                    disabled={!canBulkReopen || bulkAction !== null || assigningAlertKey !== null}
                  >
                    {bulkAction === "REOPEN" ? "Applying..." : "Reopen selected"}
                  </button>
                  <button
                    type="button"
                    onClick={() => onRunAiForSelected("PRIORITIZE_SELECTED")}
                    className="gf-btn-subtle text-xs"
                    disabled={selectedVisibleRows.length === 0 || aiActionInFlight !== null}
                  >
                    {aiActionInFlight === "PRIORITIZE_SELECTED" ? "AI..." : "Prioritize selected with AI"}
                  </button>
                  <button
                    type="button"
                    onClick={() => onRunAiForSelected("EXPLAIN_SELECTED")}
                    className="gf-btn-subtle text-xs"
                    disabled={selectedVisibleRows.length === 0 || aiActionInFlight !== null}
                  >
                    {aiActionInFlight === "EXPLAIN_SELECTED" ? "AI..." : "Explain selected with AI"}
                  </button>
                  <button
                    type="button"
                    onClick={() => onRunAiForSelected("SUGGEST_ASSIGNMENTS")}
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
                Use this alerts queue for page-first triage, then open the global assistant for cross-page routing if
                needed.
              </p>
              <DataTable
                columns={[
                  <div key="select-all" className="inline-flex items-center gap-2">
                    <input
                      ref={selectAllRef}
                      type="checkbox"
                      checked={allVisibleSelected}
                      onChange={(event) => onToggleSelectAllVisible(event.target.checked)}
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
  );
}
