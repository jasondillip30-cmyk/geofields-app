const RESOLVED_BREAKDOWN_STATUSES = new Set(["RESOLVED", "COMPLETED", "CLOSED"]);

export type BreakdownLifecycleStatus = "OPEN" | "RESOLVED";

export function normalizeBreakdownStatus(status: string | null | undefined): BreakdownLifecycleStatus {
  const normalized = (status || "").trim().toUpperCase();
  if (RESOLVED_BREAKDOWN_STATUSES.has(normalized)) {
    return "RESOLVED";
  }
  return "OPEN";
}

export function isBreakdownResolvedStatus(status: string | null | undefined) {
  return normalizeBreakdownStatus(status) === "RESOLVED";
}

export function isBreakdownOpenStatus(status: string | null | undefined) {
  return normalizeBreakdownStatus(status) === "OPEN";
}
