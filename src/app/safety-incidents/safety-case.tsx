"use client";

import { useEffect, useState, type FormEvent } from "react";
import { incidentImpacts, incidentKinds, safetyCloseoutProblem } from "@/lib/safety-incident-policy";
import { fields } from "./safety-report-form";
import { SafetyActionAssignment } from "./safety-action-assignment";

type Person = { id: string; fullName: string };
type Action = { id: string; task: string; dueDate: string; state: string; evidence: string | null; owner: Person };
type CaseData = {
  brief: string | null;
  owners: Person[];
  breakdowns: { id: string; title: string; rig: { rigCode: string } }[];
  maintenance: { id: string; requestCode: string; rig: { rigCode: string } }[];
  incident: {
    id: string; revision: number; kind: keyof typeof incidentKinds; location: string;
    description: string; occurredAt: string; immediateResponse: string | null; injuryObserved: boolean | null;
    state: string; confirmedImpact: string | null; highPotential: boolean | null; findings: string | null; closeoutNote: string | null;
    shift: string | null; reportedBy: Person; project: { name: string } | null; rig: { rigCode: string } | null;
    breakdownReport: { id: string; title: string } | null; maintenanceRequest: { id: string; requestCode: string } | null;
    actions: Action[]; events: { id: string; kind: string; createdAt: string; note: string | null; actor: Person }[];
  };
};

export function SafetyCase({ id, onChanged }: { id: string; onChanged: () => void }) {
  const [data, setData] = useState<CaseData | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const url = "/api/safety-incidents/" + encodeURIComponent(id);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(url, { signal: controller.signal, cache: "no-store" });
        const result = await response.json();
        if (!response.ok) throw new Error(result.message);
        setData(result);
      } catch (error) {
        if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "Could not open the case.");
      }
    })();
    return () => controller.abort();
  }, [reload, url]);

  function change(command: string, actionId?: string) {
    return async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!data || busy) return;
      const form = event.currentTarget;
      const values = Object.fromEntries(new FormData(form));
      setBusy(true);
      setError("");
      try {
        const response = await fetch(url, {
          method: "PATCH", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...values, revision: data.incident.revision, command, actionId,
            highPotential: values.highPotential === "yes" ? true : values.highPotential === "no" ? false : null })
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.message);
        form.reset();
        setReload((value) => value + 1);
        onChanged();
      } catch (error) { setError(error instanceof Error ? error.message : "Could not save the review."); }
      finally { setBusy(false); }
    };
  }

  if (!data) return <p role="status" className="p-4">{error || "Opening case..."}</p>;
  const item = data.incident;
  const closed = item.state === "CLOSED";
  const closeProblem = safetyCloseoutProblem(item, item.actions.map((action) => action.state));
  return (
    <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-4" aria-label="Incident case">
      <header>
        <h2 className="text-xl font-semibold">{incidentKinds[item.kind]}</h2>
        <p className="text-sm">{item.location} · {new Date(item.occurredAt).toLocaleString()} · {item.reportedBy.fullName}</p>
        <p className="text-sm">{[item.project?.name, item.rig?.rigCode, item.shift === "DAY" ? "Day shift" : item.shift === "NIGHT" ? "Night shift" : null].filter(Boolean).join(" · ")}</p>
      </header>
      <p className="whitespace-pre-wrap break-words">{item.description}</p>
      <p className="text-sm">Injury observed: {item.injuryObserved === null ? "Not sure yet" : item.injuryObserved ? "Yes" : "No"}</p>
      {item.immediateResponse && <p className="whitespace-pre-wrap break-words text-sm">Immediate response: {item.immediateResponse}</p>}
      {(item.breakdownReport || item.maintenanceRequest) && <p className="text-sm">Linked: {[item.breakdownReport?.title, item.maintenanceRequest?.requestCode].filter(Boolean).join(" · ")}</p>}
      {error && <div role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-900">
        {error} <button className="underline" onClick={() => { setError(""); setReload((value) => value + 1); }}>Reload case</button>
      </div>}
      {closed ? (
        <div className="rounded-lg bg-emerald-50 p-3 text-sm"><strong>Closed</strong><p className="whitespace-pre-wrap">{item.closeoutNote}</p></div>
      ) : (
        <form key={item.revision} onSubmit={change("TRIAGE")} className="space-y-3 rounded-lg bg-slate-50 p-3">
          <h3 className="font-semibold">Review and investigate</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <label>Outcome<select name="confirmedImpact" className={fields} required defaultValue={item.confirmedImpact || ""}>
              <option value="" disabled>Choose outcome</option>
              {Object.entries(incidentImpacts).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </select></label>
            <label>High potential?<select name="highPotential" className={fields} required defaultValue={item.highPotential === null ? "" : item.highPotential ? "yes" : "no"}>
              <option value="" disabled>Choose</option><option value="yes">Yes</option><option value="no">No</option>
            </select></label>
            <label className="sm:col-span-2">Findings (optional)<textarea name="findings" maxLength={4000} rows={2} className={fields} defaultValue={item.findings || ""} /></label>
          </div>
          <details>
            <summary className="cursor-pointer text-sm">Link an existing breakdown or repair</summary>
            <div className="mt-2 grid gap-3 sm:grid-cols-2">
              <label>Recent breakdown<select name="breakdownReportId" className={fields} defaultValue={item.breakdownReport?.id || ""}>
                <option value="">No breakdown linked</option>
                {item.breakdownReport && !data.breakdowns.some(({ id }) => id === item.breakdownReport?.id) &&
                  <option value={item.breakdownReport.id}>{item.breakdownReport.title}</option>}
                {data.breakdowns.map((row) => <option key={row.id} value={row.id}>{row.title} ({row.rig.rigCode})</option>)}
              </select></label>
              <label>Recent maintenance job<select name="maintenanceRequestId" className={fields} defaultValue={item.maintenanceRequest?.id || ""}>
                <option value="">No repair linked</option>
                {item.maintenanceRequest && !data.maintenance.some(({ id }) => id === item.maintenanceRequest?.id) &&
                  <option value={item.maintenanceRequest.id}>{item.maintenanceRequest.requestCode}</option>}
                {data.maintenance.map((row) => <option key={row.id} value={row.id}>{row.requestCode} ({row.rig.rigCode})</option>)}
              </select></label>
            </div>
          </details>
          <button className="gf-btn-secondary min-h-11" disabled={busy}>Save review</button>
        </form>
      )}
      {!closed && <form key={`brief-${item.revision}`} onSubmit={change("PUBLISH_BRIEF")} className="space-y-2 rounded-lg bg-slate-50 p-3">
        <h3 className="font-semibold">Note for Office</h3>
        <label>Share only what Office needs to coordinate. No names, injury details, or investigation findings.
          <textarea name="brief" maxLength={500} rows={2} className={fields} defaultValue={data.brief ?? ""} />
        </label>
        <button className="gf-btn-secondary min-h-11" disabled={busy}>Save Office note</button>
      </form>}
      <h3 className="font-semibold">Follow-up actions</h3>
      {!item.actions.length && <p className="text-sm text-ink-700">No follow-up assigned.</p>}
      {item.actions.map((action) => (
        <div key={action.id + ":" + action.state} className="space-y-2 border-t border-slate-200 pt-3">
          <p className="break-words font-medium">{action.task}</p>
          <p className="text-sm">{action.owner.fullName} · Due {action.dueDate.slice(0, 10)} · {action.state === "DONE" ? "Awaiting verification" : action.state === "OPEN" ? "Open" : "Verified"}</p>
          {action.evidence && <p className="whitespace-pre-wrap break-words text-sm">Completion note: {action.evidence}</p>}
          {!closed && action.state === "DONE" && (
            <form className="flex flex-wrap items-end gap-2" onSubmit={(event) => {
              const trigger = (event.nativeEvent as SubmitEvent).submitter;
              void change(trigger?.getAttribute("value") === "return" ? "RETURN_ACTION" : "VERIFY_ACTION", action.id)(event);
            }}>
              <label className="min-w-48 flex-1 text-sm">Verification or return note<input name="evidence" maxLength={1000} required className={fields} /></label>
              <button className="gf-btn-primary min-h-11" disabled={busy}>Verify fix</button>
              <button value="return" className="gf-btn-secondary min-h-11" disabled={busy}>Return action</button>
            </form>
          )}
        </div>
      ))}
      {!closed && (
        <>
          <SafetyActionAssignment owners={data.owners} busy={busy} onSubmit={change("ADD_ACTION")} />
          <form onSubmit={change("CLOSE")} className="space-y-2 border-t border-slate-200 pt-4">
            <h3 className="font-semibold">Close case</h3>
            {closeProblem && <p className="text-sm">{closeProblem}</p>}
            <label>How was the fix verified, or why was no action needed?<textarea name="closeoutNote" maxLength={2000} rows={2} required className={fields} disabled={Boolean(closeProblem)} /></label>
            <button className="gf-btn-primary min-h-11" disabled={busy || Boolean(closeProblem)}>Close case</button>
          </form>
        </>
      )}
      <details className="rounded-lg bg-slate-50 p-3">
        <summary className="cursor-pointer font-medium">Case history</summary>
        <ul className="mt-2 space-y-2 text-sm">{item.events.map((event) => <li key={event.id}>
          {event.kind.toLowerCase().replaceAll("_", " ")} · {event.actor.fullName} · {new Date(event.createdAt).toLocaleString()}
          {event.note && <p className="whitespace-pre-wrap break-words">{event.note}</p>}
        </li>)}</ul>
      </details>
    </section>
  );
}
