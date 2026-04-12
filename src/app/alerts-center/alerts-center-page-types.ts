import type { AlertsCenterSummaryResponse } from "@/lib/alerts-center";

export type SeverityFilter = "all" | "CRITICAL" | "WARNING";
export type StatusFilter = "all" | "OPEN" | "SNOOZED" | "RESOLVED";
export type TypeFilter = "all" | "APPROVAL" | "BUDGET" | "LINKAGE";
export type OwnerFilter = "all" | "unassigned" | "me" | `user:${string}`;
export type SortMode = "OLDEST_FIRST" | "HIGHEST_AMOUNT" | "HIGHEST_SEVERITY";
export type QuickView =
  | "none"
  | "NEEDS_ACTION_NOW"
  | "BUDGET_PRESSURE"
  | "LINKAGE_CLEANUP"
  | "STALE_APPROVALS"
  | "MY_ALERTS";
export type AlertAction = "RESOLVE" | "SNOOZE" | "REOPEN" | "ASSIGN_OWNER";

export const emptyPayload: AlertsCenterSummaryResponse = {
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
