"use client";

import { useState } from "react";
import type { MaintenanceRow } from "./maintenance-page-types";
import { formatMaintenanceStatus, maintenanceRowSortValue, normalizeMaintenanceStatus } from "./maintenance-page-utils";

const urgencyRank = { CRITICAL: 3, HIGH: 2, MEDIUM: 1, LOW: 0 };
const previewLimit = 5;

export function MaintenanceActiveJobs({ rows, loading, onOpenCase }: {
  rows: MaintenanceRow[];
  loading: boolean;
  onOpenCase: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const jobs = rows
    .filter((row) => normalizeMaintenanceStatus(row.status).status !== "COMPLETED")
    .sort((a, b) => urgencyRank[b.urgency ?? "MEDIUM"] - urgencyRank[a.urgency ?? "MEDIUM"] ||
      maintenanceRowSortValue(a) - maintenanceRowSortValue(b));

  return (
    <section aria-labelledby="maintenance-active-heading" className="rounded-xl border border-slate-200 bg-white px-4 py-3.5 md:px-5">
      <div className="flex items-baseline gap-2.5 border-b border-slate-200 pb-2.5">
        <h2 id="maintenance-active-heading" className="text-lg font-semibold text-ink-900">Active jobs</h2>
        {!loading && <span className="text-sm tabular-nums text-slate-600" aria-label={`${jobs.length} active jobs`}>{jobs.length}</span>}
      </div>
      {loading ? <p role="status" className="pt-3 text-sm text-slate-600">Loading active jobs...</p>
        : jobs.length === 0 ? <p className="pt-3 text-sm text-slate-600">No active jobs in this view.</p>
          : (
            <ul id="maintenance-active-jobs" className="divide-y divide-slate-200">
              {(expanded ? jobs : jobs.slice(0, previewLimit)).map((row) => {
                const status = formatMaintenanceStatus(row.status);
                const isUrgent = row.urgency === "HIGH" || row.urgency === "CRITICAL";
                return (
                  <li key={row.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-3">
                    <div className="min-w-0 flex-1 basis-64 space-y-0.5">
                      <p className={`text-xs font-semibold ${isUrgent ? "text-rose-800" : status === "Waiting for parts" ? "text-amber-800" : "text-slate-600"}`}>
                        {isUrgent ? `${row.urgency === "CRITICAL" ? "Critical" : "High"} urgency / ` : ""}{status}
                      </p>
                      <h3 className="break-words text-sm font-semibold text-ink-900">{row.issueDescription}</h3>
                      <p className="break-words text-xs text-slate-600">
                        {[row.requestCode, row.rig?.rigCode, row.project?.name].filter(Boolean).join(" / ")}
                      </p>
                    </div>
                    <button type="button" onClick={() => onOpenCase(row.id)} aria-label={`View case ${row.requestCode}`}
                      className="gf-btn-secondary min-h-11 shrink-0">View case</button>
                  </li>
                );
              })}
            </ul>
          )}
      {!loading && jobs.length > previewLimit && (
        <button type="button" aria-expanded={expanded} aria-controls="maintenance-active-jobs"
          onClick={() => setExpanded((current) => !current)} className="gf-btn-subtle min-h-11">
          {expanded ? "Show fewer" : `Show all ${jobs.length} jobs`}
        </button>
      )}
    </section>
  );
}
