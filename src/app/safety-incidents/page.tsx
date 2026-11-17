"use client";

import { useEffect, useState, type FormEvent } from "react";
import { incidentKinds, isSafetyTaskOverdue } from "@/lib/safety-incident-policy";
import { SafetyCase } from "./safety-case";
import { SafetyOfficeCase } from "./safety-office-case";
import { fields, SafetyReportForm } from "./safety-report-form";

type Report = {
  id: string; kind?: keyof typeof incidentKinds; occurredAt?: string; reportedAt: string; state: string;
  location?: string; highPotential?: boolean; confirmedImpact?: string; injuryObserved?: boolean;
  actions?: { dueDate: string; state: string }[];
};
type AssignedAction = { id: string; incidentId: string; task: string; state: string; dueDate: string; incident: { revision: number } };
type Feed = { reports: Report[]; canReview: boolean; canCoordinate: boolean; nextCursor: string | null; assignedActions: AssignedAction[] };
const endpoint = "/api/safety-incidents";
const labels: Record<string, string> = { REPORTED: "New report", REVIEWING: "Under review", CLOSED: "Closed" };

async function readFeed(scope: string, signal?: AbortSignal, cursor?: string) {
  const params = new URLSearchParams({ scope });
  if (cursor) params.set("cursor", cursor);
  const response = await fetch(endpoint + "?" + params, { cache: "no-store", signal });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || "Could not load reports.");
  return data as Feed;
}

export default function SafetyIncidentsPage() {
  const [feed, setFeed] = useState<Feed | null>(null);
  const [scope, setScope] = useState("open");
  const [selected, setSelected] = useState("");
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    void readFeed(scope, controller.signal).then(
      (result) => { if (!controller.signal.aborted) setFeed(result); },
      (error) => { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "Could not load reports."); }
    );
    return () => controller.abort();
  }, [scope, revision]);

  async function complete(event: FormEvent<HTMLFormElement>, action: AssignedAction) {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(endpoint + "/" + action.incidentId, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: "COMPLETE_ACTION", actionId: action.id, revision: action.incident.revision, evidence: new FormData(form).get("evidence") })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message);
      form.reset();
      setRevision((value) => value + 1);
    } catch (error) { setError(error instanceof Error ? error.message : "Could not save the action."); }
    finally { setBusy(false); }
  }

  async function loadOlder() {
    if (!feed?.nextCursor || busy) return;
    setBusy(true);
    setError("");
    try {
      const older = await readFeed(scope, undefined, feed.nextCursor);
      setFeed({ ...older, reports: [...feed.reports, ...older.reports] });
    } catch (error) { setError(error instanceof Error ? error.message : "Could not load older reports."); }
    finally { setBusy(false); }
  }

  const reviewerQueue = feed?.canReview && scope !== "mine";
  const officeQueue = feed?.canCoordinate && scope !== "mine";
  useEffect(() => {
    if (selected) document.getElementById("safety-selected-case")?.focus();
  }, [selected]);
  return (
    <main className="mx-auto max-w-5xl space-y-4 pb-6">
      <header className="border-b border-slate-200 pb-3">
        <h2 className="text-xl font-semibold">Record what happened. Verify what changed.</h2>
        <p className="mt-1 text-sm text-ink-700">For injuries, near misses, damage and vehicle incidents.</p>
      </header>
      <SafetyReportForm onSaved={() => setRevision((value) => value + 1)} />
      {error && <div role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-900">
        {error} <button className="underline" onClick={() => { setError(""); setRevision((value) => value + 1); }}>Reload list</button>
      </div>}
      {!feed && !error && <p role="status">Loading safety records...</p>}
      {!!feed?.assignedActions.length && (
        <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
          <h3 className="font-semibold">My follow-up actions</h3>
          {feed.assignedActions.map((action) => (
            <div className="border-t border-slate-200 pt-2" key={action.id}>
              <p className="font-medium break-words">{action.task}</p>
              <p className="text-sm">Due {action.dueDate.slice(0, 10)} · {action.state === "DONE" ? "Awaiting verification" : "Open"}</p>
              {action.state === "OPEN" && (
                <form className="mt-2 flex flex-wrap items-end gap-2" onSubmit={(event) => void complete(event, action)}>
                  <label className="min-w-48 flex-1 text-sm">What was done?<input name="evidence" required maxLength={1000} className={fields} /></label>
                  <button className="gf-btn-secondary min-h-11" disabled={busy}>Mark done</button>
                </form>
              )}
            </div>
          ))}
        </section>
      )}
      {feed && <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-semibold">{reviewerQueue ? "Safety review queue" : officeQueue ? "Office follow-up queue" : "My reported incidents"}</h3>
          {(feed.canReview || feed.canCoordinate) && <label className="text-sm">Show <select aria-label="Incident list" value={scope} disabled={busy} className={fields} onChange={(event) => { setScope(event.target.value); setSelected(""); setError(""); }}>
            <option value="open">Open cases</option><option value="closed">Closed cases</option><option value="mine">My reports</option>
          </select></label>}
        </div>
        {officeQueue && <p className="text-sm text-ink-700">Assign tasks and track due dates. Safety handles investigations, verification, and closeout.</p>}
        {feed.reports.length ? <ul className="divide-y divide-slate-200">
          {feed.reports.map((report) => <li key={report.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
            <div>
              <p className="font-medium">{officeQueue || !report.kind ? "Case " + report.id.slice(-8).toUpperCase() : incidentKinds[report.kind]}</p>
              <p className="text-sm text-ink-700">
                {new Date((!officeQueue && report.occurredAt) || report.reportedAt).toLocaleString()} · {labels[report.state] ?? report.state}
                {reviewerQueue && report.location ? " · " + report.location : ""}
                {reviewerQueue && report.highPotential ? " · High potential" : ""}
                {reviewerQueue && report.state === "REPORTED" && report.injuryObserved ? " · Injury reported" : ""}
              </p>
              {officeQueue && <p className="text-sm">{report.actions?.filter(({ state }) => state === "OPEN").length ?? 0} open · {report.actions?.filter(({ state }) => state === "DONE").length ?? 0} awaiting verification
                {!!report.actions?.some((action) => isSafetyTaskOverdue(action)) && <strong className="ml-2 text-rose-800">{report.actions.filter((action) => isSafetyTaskOverdue(action)).length} overdue</strong>}
              </p>}
            </div>
            {(reviewerQueue || officeQueue) && <button className="gf-btn-secondary min-h-11" onClick={() => setSelected(report.id)} aria-pressed={selected === report.id}>{officeQueue ? "Open follow-up" : "Open case"}</button>}
          </li>)}
        </ul> : <p className="text-sm text-ink-700">No incidents in this list.</p>}
        {feed.nextCursor && <button className="gf-btn-secondary min-h-11" disabled={busy} onClick={() => void loadOlder()}>Load older cases</button>}
      </section>}
      {selected && (reviewerQueue || officeQueue) && <div id="safety-selected-case" tabIndex={-1} className="scroll-mt-28">
        {reviewerQueue
          ? <SafetyCase key={selected} id={selected} onChanged={() => setRevision((value) => value + 1)} />
          : <SafetyOfficeCase key={selected} id={selected} onChanged={() => setRevision((value) => value + 1)} />}
      </div>}
    </main>
  );
}
