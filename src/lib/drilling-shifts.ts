import type { DrillingShift, EntryApprovalStatus } from "@prisma/client";

export type ShiftReport = {
  id: string;
  date: string;
  shift: DrillingShift | null;
  rigId: string;
  rig: { rigCode: string };
  holeNumber: string;
  totalMetersDrilled: number;
  workHours: number;
  standbyHours: number;
  delayHours: number;
  delayReasonCategory: string | null;
  delayReasonNote: string | null;
  approvalStatus: EntryApprovalStatus;
};

export function parseDrillingShift(value: unknown): { value: DrillingShift | undefined; error?: never } | { value?: never; error: string } {
  if (value === undefined || value === "DAY" || value === "NIGHT") return { value };
  return { error: "Select Day or Night for the drilling shift." };
}

export function drillingWorkDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Dar_es_Salaam", year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(now);
  const get = (type: string) => parts.find((part) => part.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function shiftWeek(start: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) return null;
  const date = new Date(`${start}T00:00:00Z`);
  if (!Number.isFinite(+date) || date.toISOString().slice(0, 10) !== start) return null;
  const offset = (days: number) => new Date(+date + days * 86400000);
  if (offset(-7).getUTCFullYear() < 1 || offset(7).getUTCFullYear() > 9999) return null;
  const key = (days: number) => offset(days).toISOString().slice(0, 10);
  return { days: Array.from({ length: 7 }, (_, i) => key(i)), previous: key(-7), next: key(7), from: date, until: offset(7) };
}

export function recentShiftWeekStart(now = new Date()) {
  const today = new Date(`${drillingWorkDate(now)}T00:00:00Z`);
  today.setUTCDate(today.getUTCDate() - 6);
  return today.toISOString().slice(0, 10);
}

export function groupShiftReports(reports: ShiftReport[]) {
  const cells = new Map<string, ShiftReport[]>();
  const unclassified: ShiftReport[] = [];
  for (const report of reports) {
    if (!report.shift) {
      unclassified.push(report);
      continue;
    }
    const key = shiftCellKey(report.rigId, report.date.slice(0, 10), report.shift);
    const cell = cells.get(key) ?? [];
    cell.push(report);
    cells.set(key, cell);
  }
  return { cells, unclassified };
}

export function shiftCellKey(rigId: string, date: string, shift: DrillingShift) {
  return `${rigId}/${date}/${shift}`;
}
