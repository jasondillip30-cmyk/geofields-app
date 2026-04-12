import type { AlertsCenterRow } from "@/lib/alerts-center";
import type { UserRole } from "@/lib/types";

type TypeFilter = "all" | "APPROVAL" | "BUDGET" | "LINKAGE";
type AlertAction = "RESOLVE" | "SNOOZE" | "REOPEN" | "ASSIGN_OWNER";

export function SeverityBadge({ severity }: { severity: AlertsCenterRow["severity"] }) {
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

export function formatAge(ageHours: number | null) {
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

export function formatDateTime(value: string | null) {
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

export function buildFiltersQuery(filters: {
  workspaceMode?: string;
  projectId?: string;
  clientId: string;
  rigId: string;
  from: string;
  to: string;
}) {
  const params = new URLSearchParams();
  if (filters.workspaceMode && filters.workspaceMode !== "all-projects") {
    params.set("workspace", filters.workspaceMode);
  }
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  if (filters.projectId && filters.projectId !== "all") {
    params.set("projectId", filters.projectId);
    return params;
  }
  if (filters.clientId !== "all") params.set("clientId", filters.clientId);
  if (filters.rigId !== "all") params.set("rigId", filters.rigId);
  return params;
}

export function isManagerOrAdmin(role: UserRole | null) {
  return role === "ADMIN" || role === "MANAGER";
}

export function resolveTypeGroup(alertType: AlertsCenterRow["alertType"]): TypeFilter {
  if (alertType === "STALE_PENDING_APPROVAL") {
    return "APPROVAL";
  }
  if (alertType === "BUDGET_OVERSPENT" || alertType === "BUDGET_CRITICAL" || alertType === "BUDGET_WATCH") {
    return "BUDGET";
  }
  return "LINKAGE";
}

export function isActionApplicable(status: AlertsCenterRow["status"], action: AlertAction) {
  if (action === "RESOLVE") {
    return status !== "RESOLVED";
  }
  if (action === "SNOOZE") {
    return status === "OPEN";
  }
  return status !== "OPEN";
}

export function compareBySeverityThenAmount(a: AlertsCenterRow, b: AlertsCenterRow) {
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

export function QuickViewButton({
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
