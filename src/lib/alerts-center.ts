export type AlertSeverity = "CRITICAL" | "WARNING";
export type AlertType =
  | "BUDGET_OVERSPENT"
  | "BUDGET_CRITICAL"
  | "BUDGET_WATCH"
  | "STALE_PENDING_APPROVAL"
  | "MISSING_RIG_LINKAGE"
  | "MISSING_PROJECT_LINKAGE"
  | "MISSING_MAINTENANCE_LINKAGE";

export type AlertWorkflowStatus = "OPEN" | "SNOOZED" | "RESOLVED";

export interface AlertsCenterRow {
  alertKey: string;
  severity: AlertSeverity;
  alertType: AlertType;
  entity: string;
  source: string;
  amount: number | null;
  ageHours: number | null;
  currentContext: string;
  recommendedAction: string;
  destinationHref: string;
  status: AlertWorkflowStatus;
  detectedAt: string | null;
  snoozedUntil: string | null;
  assignedOwnerUserId?: string | null;
  assignedOwnerName?: string | null;
}

export interface AlertsCenterSummaryResponse {
  filters: {
    clientId: string;
    rigId: string;
    from: string | null;
    to: string | null;
  };
  summary: {
    criticalAlerts: number;
    warningAlerts: number;
    unresolvedAlerts: number;
    resolvedToday: number;
  };
  owners: {
    userId: string;
    name: string;
  }[];
  alerts: AlertsCenterRow[];
  generatedAt: string;
}

export function nullableFilter(value: string | null) {
  return value && value !== "all" ? value : null;
}

export function parseDateOrNull(value: string | null, endOfDay = false) {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  if (endOfDay) {
    parsed.setUTCHours(23, 59, 59, 999);
  } else {
    parsed.setUTCHours(0, 0, 0, 0);
  }
  return parsed;
}

export function roundCurrency(value: number) {
  return Math.round(value * 100) / 100;
}

export function buildScopedHref({
  path,
  filters,
  extra
}: {
  path: string;
  filters: { clientId: string | null; rigId: string | null; from: string | null; to: string | null };
  extra?: Record<string, string | null | undefined>;
}) {
  const params = new URLSearchParams();
  if (filters.clientId) params.set("clientId", filters.clientId);
  if (filters.rigId) params.set("rigId", filters.rigId);
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  if (extra) {
    for (const [key, value] of Object.entries(extra)) {
      if (!value) {
        continue;
      }
      params.set(key, value);
    }
  }
  const query = params.toString();
  return `${path}${query ? `?${query}` : ""}`;
}

export function calculateAgeHours(value: Date | null, now: Date) {
  if (!value) {
    return null;
  }
  const diff = now.getTime() - value.getTime();
  if (diff <= 0) {
    return 0;
  }
  return Math.floor(diff / 3600000);
}

export function resolveAlertTypeLabel(type: AlertType) {
  switch (type) {
    case "BUDGET_OVERSPENT":
      return "Budget Overspent";
    case "BUDGET_CRITICAL":
      return "Budget Critical";
    case "BUDGET_WATCH":
      return "Budget Watch";
    case "STALE_PENDING_APPROVAL":
      return "Stale Pending Approval";
    case "MISSING_RIG_LINKAGE":
      return "Missing Rig Linkage";
    case "MISSING_PROJECT_LINKAGE":
      return "Missing Project Linkage";
    case "MISSING_MAINTENANCE_LINKAGE":
      return "Missing Maintenance Linkage";
    default:
      return "Alert";
  }
}

export function startOfUtcDay(date: Date) {
  const next = new Date(date);
  next.setUTCHours(0, 0, 0, 0);
  return next;
}

export function endOfUtcDay(date: Date) {
  const next = new Date(date);
  next.setUTCHours(23, 59, 59, 999);
  return next;
}
