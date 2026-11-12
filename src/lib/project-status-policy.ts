export type ProjectOperationalStatus = "PLANNED" | "ACTIVE" | "ON_HOLD" | "COMPLETED";

export function projectCalendarDay(date = new Date()) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export function scheduledProjectCloseout(endDate: Date | null, now = new Date()) {
  if (!endDate || !(endDate < projectCalendarDay(now))) return null;
  const firstClosedDay = projectCalendarDay(endDate);
  firstClosedDay.setUTCDate(firstClosedDay.getUTCDate() + 1);
  return firstClosedDay;
}

export function resolveScheduledProjectStatus(
  startDate: Date,
  endDate: Date | null,
  now = new Date()
): ProjectOperationalStatus {
  const today = projectCalendarDay(now);
  if (scheduledProjectCloseout(endDate, now)) return "COMPLETED";
  if (!Number.isFinite(startDate.getTime()) || projectCalendarDay(startDate) > today) return "PLANNED";
  return "ACTIVE";
}

export function resolveProjectOperationalStatus(
  project: { status: ProjectOperationalStatus; endDate: Date | null; closedAt: Date | null },
  now = new Date()
): ProjectOperationalStatus {
  return project.closedAt || scheduledProjectCloseout(project.endDate, now)
    ? "COMPLETED"
    : project.status;
}

export function unclosedProjectWhere(now = new Date()) {
  return {
    closedAt: null,
    OR: [{ endDate: null }, { endDate: { gte: projectCalendarDay(now) } }]
  };
}

export function canCloseProject(role: string | null | undefined) {
  return role === "ADMIN" || role === "MANAGER";
}
