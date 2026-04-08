import { normalizeBreakdownStatus } from "@/lib/breakdown-lifecycle";

export function getProjectRigIds(
  project:
    | {
        assignedRigId: string | null;
        backupRigId: string | null;
      }
    | null
) {
  if (!project) {
    return [];
  }
  const ids = [project.assignedRigId, project.backupRigId].filter(
    (value): value is string => Boolean(value)
  );
  return Array.from(new Set(ids));
}

export function BreakdownStatusChip({ status }: { status: string }) {
  const normalizedStatus = normalizeBreakdownStatus(status);
  const className =
    normalizedStatus === "RESOLVED"
      ? "border-emerald-300 bg-emerald-100 text-emerald-800"
      : "border-amber-300 bg-amber-100 text-amber-800";

  return (
    <span
      className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${className}`}
    >
      {normalizedStatus}
    </span>
  );
}

export function breakdownRowSortValue(
  entry: {
    reportDate?: string;
  } | undefined
) {
  if (!entry) {
    return 0;
  }
  const date = Date.parse(entry.reportDate || "");
  if (Number.isFinite(date)) {
    return date;
  }
  return 0;
}

export function formatBreakdownCurrentState(status: string | null | undefined) {
  const normalized = normalizeBreakdownStatus(status || "");
  if (normalized === "OPEN") {
    return "Open";
  }
  return "No active case";
}

export function toDate(value: string | null | undefined) {
  if (!value) {
    return "-";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toISOString().slice(0, 10);
}

export function toDateTime(value: string | null | undefined) {
  if (!value) {
    return "-";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toISOString().replace("T", " ").slice(0, 16);
}

export function formatMaintenanceLifecycleStatus(status: string | null | undefined) {
  const normalized = (status || "").trim().toUpperCase();
  if (normalized === "OPEN") return "Open";
  if (normalized === "IN_REPAIR") return "In repair";
  if (normalized === "WAITING_FOR_PARTS") return "Waiting for parts";
  if (normalized === "COMPLETED") return "Completed";
  return "Open";
}
