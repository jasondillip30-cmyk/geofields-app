"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useAnalyticsFilters } from "@/components/layout/analytics-filters-provider";
import { incidentKinds } from "@/lib/safety-incident-policy";

export const fields = "mt-1 block min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base";

export function SafetyReportForm({ onSaved }: { onSaved: () => void }) {
  const { filters } = useAnalyticsFilters();
  const [attachScope, setAttachScope] = useState(true);
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const key = useRef<string | null>(null);
  const panel = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (window.location.hash === "#report-incident" && panel.current) panel.current.open = true;
  }, []);
  const projectId = filters.projectId !== "all" ? filters.projectId : null;
  const rigId = filters.rigId !== "all" ? filters.rigId : null;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    const form = event.currentTarget;
    const data = Object.fromEntries(new FormData(form));
    setSaving(true);
    setNotice("");
    try {
      key.current ??= crypto.randomUUID();
      const response = await fetch("/api/safety-incidents", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...data, submissionKey: key.current,
          occurredAt: new Date(String(data.occurredAt)).toISOString(),
          injuryObserved: data.injuryObserved === "yes" ? true : data.injuryObserved === "no" ? false : null,
          projectId: attachScope ? projectId : null, rigId: attachScope ? rigId : null
        })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message ?? "The report was not confirmed.");
      key.current = null;
      form.reset();
      setAttachScope(true);
      setNotice("Incident recorded in GeoFields. This does not send an emergency alert.");
      onSaved();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The report was not confirmed. Retry before closing this form.");
    } finally { setSaving(false); }
  }

  return (
    <details id="report-incident" ref={panel} className="rounded-xl border border-slate-200 bg-white p-4">
      <summary className="cursor-pointer font-semibold">Report incident</summary>
      <p className="mt-3 text-sm text-ink-700">If anyone is in immediate danger, use your site emergency process first. Do not enter medical details or personal information here.</p>
      <form onSubmit={submit} className="mt-4 space-y-3">
        <fieldset disabled={saving} className="grid gap-3 sm:grid-cols-2">
          <label>Incident type<select name="kind" className={fields} defaultValue="" required>
            <option value="" disabled>Choose type</option>
            {Object.entries(incidentKinds).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select></label>
          <label>Date and time (this device)<input name="occurredAt" className={fields} type="datetime-local" required /></label>
          <label>Where it happened<input name="location" className={fields} maxLength={150} placeholder="Site, workshop or road location" required /></label>
          <label>Was anyone hurt?<select name="injuryObserved" className={fields} defaultValue="">
            <option value="">Not sure yet</option><option value="yes">Yes</option><option value="no">No</option>
          </select></label>
          <label className="sm:col-span-2">What happened?<textarea name="description" className={fields} maxLength={2000} rows={3} required /></label>
          <label className="sm:col-span-2">What was done immediately? (optional)<textarea name="immediateResponse" className={fields} maxLength={1000} rows={2} /></label>
          {(projectId || rigId) && <label className="sm:col-span-2 flex items-center gap-2">
            <input type="checkbox" checked={attachScope} onChange={(event) => setAttachScope(event.target.checked)} /> Link the current project / rig
          </label>}
        </fieldset>
        <button className="gf-btn-primary min-h-11" disabled={saving}>{saving ? "Sending..." : "Send incident report"}</button>
        <p role="status" className="text-sm">{notice}</p>
      </form>
    </details>
  );
}
