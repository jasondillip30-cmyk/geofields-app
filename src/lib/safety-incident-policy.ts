export const incidentKinds = {
  INJURY: "Injury / first aid",
  NEAR_MISS: "Near miss",
  DAMAGE: "Equipment / property damage",
  VEHICLE: "Vehicle incident"
} as const;

export const incidentImpacts = {
  NO_INJURY: "No injury",
  FIRST_AID: "First aid",
  INJURY: "Injury (no confirmed lost time)",
  LOST_TIME: "Lost-time injury",
  FATALITY: "Fatality",
  UNKNOWN: "Not yet confirmed"
} as const;

export function isIncidentKind(value: string): value is keyof typeof incidentKinds {
  return Object.hasOwn(incidentKinds, value);
}

export function isIncidentImpact(value: string): value is keyof typeof incidentImpacts {
  return Object.hasOwn(incidentImpacts, value);
}

export function isSafetyReviewerEligible(role: string, isActive: boolean) {
  return isActive && (role === "ADMIN" || role === "MANAGER");
}

export function isSafetyTaskOverdue(task: { dueDate: string; state: string }, now = new Date()) {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Dar_es_Salaam", year: "numeric", month: "2-digit", day: "2-digit"
  }).format(now);
  return task.state === "OPEN" && task.dueDate.slice(0, 10) < today;
}

export function safetyCloseoutProblem(
  incident: { state: string; confirmedImpact: string | null; highPotential: boolean | null; findings: string | null },
  actionStates: string[]
) {
  if (incident.state !== "REVIEWING" || !incident.confirmedImpact || incident.confirmedImpact === "UNKNOWN" ||
      incident.highPotential === null) return "Confirm the outcome and potential severity before closing.";
  if ((incident.highPotential || ["LOST_TIME", "FATALITY"].includes(incident.confirmedImpact)) && !incident.findings?.trim()) {
    return "Record what contributed to the incident before closing a serious or high-potential case.";
  }
  if (actionStates.some((state) => state !== "VERIFIED")) return "Verify every follow-up action before closing.";
  if (!actionStates.length && (incident.highPotential || incident.confirmedImpact !== "NO_INJURY")) {
    return "Assign and verify a follow-up action before closing this case.";
  }
  return null;
}
