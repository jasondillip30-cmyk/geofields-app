"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { Card } from "@/components/ui/card";
import { DRILL_DELAY_REASON_OPTIONS } from "@/lib/drill-report-delay-reasons";
import { groupShiftReports, recentShiftWeekStart, shiftCellKey, shiftWeek, type ShiftReport } from "@/lib/drilling-shifts";

const styles = {
  APPROVED: { text: "Approved", mark: "A", color: "bg-emerald-100 text-emerald-900" },
  SUBMITTED: { text: "Pending approval", mark: "P", color: "bg-amber-100 text-amber-900" },
  REJECTED: { text: "Rejected", mark: "R", color: "bg-rose-100 text-rose-900" },
  DRAFT: { text: "Draft", mark: "D", color: "bg-slate-200 text-slate-800" },
  MIXED: { text: "Mixed statuses", mark: "M", color: "bg-sky-100 text-sky-900" }
} as const;
const shifts = ["DAY", "NIGHT"] as const;
const shiftLabels = { DAY: "Day", NIGHT: "Night" } as const;
const dateLabel = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const formatDate = (date: string) => dateLabel.format(new Date(date));
const number = new Intl.NumberFormat("en", { maximumFractionDigits: 2 });
type GridData = { rigs: Array<{ id: string; label: string }>; reports: ShiftReport[] };

export function ProjectShiftGrid({ projectId, reportsHref }: { projectId: string; reportsHref: string }) {
  const [start, setStart] = useState(() => recentShiftWeekStart());
  const week = shiftWeek(start)!;
  const [selected, setSelected] = useState<{ key: string; title: string } | null>(null);
  const [result, setResult] = useState<{ key: string; data: GridData | null } | null>(null);
  const [retry, setRetry] = useState(0);
  const key = `${projectId}/${start}/${retry}`;
  const current = result?.key === key ? result : null;
  const data = current?.data;

  useEffect(() => {
    const controller = new AbortController();
    const query = new URLSearchParams({ projectId, start });
    void fetch(`/api/drilling-reports/shift-grid?${query}`, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Unable to load shift reports.");
        const payload: GridData = await response.json();
        if (!controller.signal.aborted) setResult({ key, data: payload });
      })
      .catch(() => {
        if (!controller.signal.aborted) setResult({ key, data: null });
      });
    return () => controller.abort();
  }, [projectId, start, key]);

  const { cells, unclassified } = groupShiftReports(data?.reports ?? []);
  const selectedReports = selected ? cells.get(selected.key) : undefined;
  function move(to: string) {
    setSelected(null);
    setStart(to);
  }

  return (
    <Card title="Shift Grid" subtitle="See which rigs have reported by day and night. Select a square to see the reports.">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold" aria-live="polite">{formatDate(start)} to {formatDate(week.days[6])}, {week.days[6].slice(0, 4)}</p>
        <div className="flex gap-2">
          <button type="button" className="gf-btn-subtle" onClick={() => move(week.previous)}>Previous week</button>
          <button type="button" className="gf-btn-subtle" onClick={() => move(week.next)}>Next week</button>
        </div>
      </div>
      {!current && <p role="status" className="text-sm text-ink-600">Loading shifts...</p>}
      {current && !data && (
        <div className="flex items-center gap-2 text-sm">
          <p role="status">Could not load shift reports.</p>
          <button type="button" className="gf-btn-subtle" onClick={() => setRetry((value) => value + 1)}>Retry</button>
        </div>
      )}
      {data && data.rigs.length === 0 && <p className="text-sm text-ink-600">No assigned rigs or reports for this week.</p>}
      {data && data.rigs.length > 0 && (
        <>
          <ul className="mb-3 flex flex-wrap gap-x-3 gap-y-2 text-xs text-ink-700" aria-label="Shift status legend">
            {Object.values(styles).map(({ text, mark, color }) => (
              <li key={mark}><span className={`mr-1 rounded px-1.5 py-0.5 font-semibold ${color}`}>{mark}</span>{text}</li>
            ))}
            <li><span className="mr-1 rounded bg-slate-100 px-1.5 py-0.5">-</span>No report recorded</li>
          </ul>
          <div className="overflow-x-auto" role="region" aria-label="Shift grid by rig and date" tabIndex={0}>
            <table className="w-full min-w-[400px] table-fixed border-separate border-spacing-1 text-center text-xs">
              <thead>
                <tr>
                  <th scope="col" className="w-20 text-left sm:w-32">Rig / shift</th>
                  {week.days.map((day) => <th scope="col" key={day}>{formatDate(day)}</th>)}
                </tr>
              </thead>
              <tbody>
                {data.rigs.flatMap((rig) => shifts.map((shift) => (
                  <tr key={`${rig.id}/${shift}`}>
                    <th scope="row" className="break-words text-left">{rig.label}<span className="block font-normal text-ink-600">{shiftLabels[shift]}</span></th>
                    {week.days.map((day) => {
                      const cellKey = shiftCellKey(rig.id, day, shift);
                      const reports = cells.get(cellKey);
                      if (!reports?.length) return <td key={day} className="rounded bg-slate-50 text-slate-500"><span aria-hidden="true">-</span><span className="sr-only">No report recorded</span></td>;
                      const style = reports.every((report) => report.approvalStatus === reports[0].approvalStatus) ? styles[reports[0].approvalStatus] : styles.MIXED;
                      const title = `${rig.label} / ${formatDate(day)} / ${shiftLabels[shift]}`;
                      return (
                        <td key={day}>
                          <button
                            type="button"
                            className={`min-h-11 w-full rounded font-semibold hover:brightness-95 focus-visible:ring-2 focus-visible:ring-brand-600 aria-pressed:ring-2 aria-pressed:ring-brand-600 ${style.color}`}
                            aria-label={`${title}: ${style.text}, ${reports.length} ${reports.length === 1 ? "report" : "reports"}`}
                            aria-pressed={selected?.key === cellKey}
                            aria-controls="selected-shift-reports"
                            onClick={() => setSelected({ key: cellKey, title })}
                          >{style.mark}{reports.length > 1 ? ` ${reports.length}` : ""}</button>
                        </td>
                      );
                    })}
                  </tr>
                )))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <section id="selected-shift-reports" aria-live="polite">
        {selectedReports && selected && (
          <div className="mt-3 rounded-lg border border-slate-200 p-3">
            <h3 className="font-semibold">{selected.title}</h3>
            <ReportDetails reports={selectedReports} />
          </div>
        )}
      </section>
      {unclassified.length > 0 && (
        <details className="mt-3 rounded-lg border border-slate-200 p-3">
          <summary className="cursor-pointer text-sm font-medium">Shift not recorded ({unclassified.length})</summary>
          <ReportDetails reports={unclassified} />
        </details>
      )}
      <Link href={reportsHref} className="mt-3 inline-block text-sm text-brand-700 underline underline-offset-2">Open drilling report list</Link>
    </Card>
  );
}

function ReportDetails({ reports }: { reports: ShiftReport[] }) {
  return (
    <ul className="mt-2 divide-y divide-slate-200 text-sm">
      {reports.map((report) => (
        <li key={report.id} className="py-2">
          <p className="font-medium">Hole {report.holeNumber} <span className="font-normal text-ink-600">/ {styles[report.approvalStatus].text}{!report.shift && ` / ${report.rig.rigCode} / ${formatDate(report.date)}`}</span></p>
          <p className="text-ink-600">
            {number.format(report.totalMetersDrilled)} m drilled / {number.format(report.workHours)} h work / {number.format(report.standbyHours)} h standby / {number.format(report.delayHours)} h delay
          </p>
          {(report.delayReasonCategory || report.delayReasonNote) && (
            <p className="text-ink-600">{[DRILL_DELAY_REASON_OPTIONS.find(({ value }) => value === report.delayReasonCategory)?.label, report.delayReasonNote].filter(Boolean).join(": ")}</p>
          )}
        </li>
      ))}
    </ul>
  );
}
