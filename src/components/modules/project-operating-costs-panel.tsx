"use client";

import { useEffect, useState, type FormEvent } from "react";

import { Card } from "@/components/ui/card";

type Kind = "CREW_PAY" | "FOOD" | "OTHER";
type Entry = {
  id: string;
  costDate: string;
  amountCents: number;
  status: "DRAFT" | "POSTED" | "SKIPPED";
  expenseId: string | null;
  plan: { kind: Kind; label: string; crewJob: string | null };
};
type Workspace = {
  entries: Entry[];
  employees: Array<{ id: string; fullName: string; title: string | null }>;
  plans: Array<{ id: string; kind: Kind; label: string; cadence: string; amountCents: number; nextDue: string | null }>;
};

const labels: Record<Kind, string> = { CREW_PAY: "Crew pay", FOOD: "Food", OTHER: "Other site costs" };
const fieldClass = "mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm";
const costFormatter = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const currency = (cents: number) => costFormatter.format(cents / 100);

export function ProjectOperatingCostsPanel({ projectId, onPosted }: { projectId: string; onPosted: () => void }) {
  const today = new Date().toISOString().slice(0, 10);
  const [month, setMonth] = useState(today.slice(0, 7));
  const [kind, setKind] = useState<Kind>("CREW_PAY");
  const [cadence, setCadence] = useState("MONTHLY");
  const [startsOn, setStartsOn] = useState(month + "-01");
  const [revision, setRevision] = useState(0);
  const [loaded, setLoaded] = useState<{ month: string; data: Workspace } | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<{ key: string; body: Record<string, unknown>; title: string; message: string; field?: "amount" | "reason"; initial?: string; affectsProfit?: boolean } | null>(null);
  const data = loaded?.month === month ? loaded.data : null;
  const endpoint = "/api/projects/" + encodeURIComponent(projectId) + "/operating-costs";

  useEffect(() => {
    // A direct link can load before the permission gate mounts this panel.
    if (window.location.hash === "#operating-costs") {
      document.getElementById("operating-costs")?.scrollIntoView({ block: "start" });
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(endpoint + "?month=" + encodeURIComponent(month), { signal: controller.signal, cache: "no-store" });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.message || "Operating costs are unavailable.");
        if (!controller.signal.aborted) setLoaded({ month, data: payload as Workspace });
      } catch (cause) {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Operating costs are unavailable.");
      }
    })();
    return () => controller.abort();
  }, [endpoint, month, revision]);

  async function act(body: Record<string, unknown>, message: string, affectsProfit = false) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message || "Could not update operating costs.");
      if (typeof payload.month === "string") setMonth(payload.month);
      setNotice(body.action === "generate" ? (
        payload.count ? `${payload.count} due drafts generated. Review before confirming.` : "No new drafts are due."
      ) : message);
      if (affectsProfit) onPosted();
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update operating costs.");
      return false;
    } finally {
      setRevision((value) => value + 1);
      setBusy(false);
    }
  }

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = Object.fromEntries(new FormData(form));
    const date = String(fields.startsOn || "");
    if (await act({ ...fields, action: "create", kind, cadence, startsOn: kind === "CREW_PAY" ? date + "-01" : date }, cadence === "ONCE" ? "Cost saved for review when due." : "Schedule saved. No expense was posted.")) {
      form.reset();
    }
  }

  function renderPending(key: string) {
    if (!pending || pending.key !== key) return null;
    return (
      <form className="mt-2 space-y-2 rounded-md bg-slate-50 p-3 text-sm" onSubmit={async (event) => {
        event.preventDefault();
        const fields = Object.fromEntries(new FormData(event.currentTarget));
        if (await act({ ...pending.body, ...fields }, pending.message, pending.affectsProfit)) setPending(null);
      }}>
        <p className="font-medium">{pending.title}</p>
        {pending.field === "amount" && <label>Actual amount<input name="amount" type="number" min="0.01" max="9999999.99" step="0.01" required defaultValue={pending.initial} className={fieldClass} /></label>}
        {pending.field === "reason" && <label>Correction reason<input name="reason" minLength={3} maxLength={160} required className={fieldClass} /></label>}
        <div className="flex gap-2">
          <button className="gf-btn-primary" disabled={busy}>{pending.field === "amount" ? "Save amount" : "Confirm change"}</button>
          <button type="button" className="gf-btn-secondary" disabled={busy} onClick={() => setPending(null)}>Cancel</button>
        </div>
      </form>
    );
  }

  const groups = new Map<string, Entry[]>();
  for (const entry of data?.entries || []) {
    const key = entry.status === "POSTED" ? entry.expenseId! : `${entry.status}:${entry.costDate}:${entry.plan.kind}`;
    const group = groups.get(key) || [];
    group.push(entry);
    groups.set(key, group);
  }

  return (
    <Card title="Operating Costs" subtitle="Record crew pay, meals and other site costs without moving inventory.">
      <div className="space-y-5">
        <p className="text-sm text-ink-600">Only confirmed costs affect Expenses and Profit. Enter only the crew pay allocated to this project. Individual pay details stay in this finance-only workspace.</p>
        {error && <p role="alert" className="rounded-md bg-rose-50 p-2 text-sm text-rose-800">{error}</p>}
        {notice && <p role="status" className="rounded-md bg-emerald-50 p-2 text-sm text-emerald-900">{notice}</p>}
        <details className="rounded-lg border border-slate-200 p-3">
          <summary className="cursor-pointer font-semibold text-ink-900">Add a cost or schedule</summary>
          <form onSubmit={add} className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <label className="text-sm">Cost type
              <select value={kind} className={fieldClass} onChange={(event) => {
                const next = event.target.value as Kind;
                setKind(next);
                setCadence(next === "CREW_PAY" ? "MONTHLY" : "ONCE");
                setStartsOn(next === "CREW_PAY" ? month + "-01" : today);
              }}>
                {Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            {kind === "CREW_PAY" ? (
              <>
                <label className="text-sm">Employee
                  <select name="employeeId" required defaultValue="" className={fieldClass}>
                    <option value="">Select an employee</option>
                    {data?.employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.fullName}{employee.title ? " · " + employee.title : ""}</option>)}
                  </select>
                </label>
                <label className="text-sm">Job on this project<input name="crewJob" required maxLength={160} className={fieldClass} placeholder="e.g. Driller" /></label>
              </>
            ) : <label className="text-sm">Description<input name="label" required maxLength={160} className={fieldClass} placeholder="e.g. Crew meals" /></label>}
            <label className="text-sm">{kind === "CREW_PAY" ? "Project share of monthly pay" : "Amount per entry"}
              <input name="amount" type="number" min="0.01" max="9999999.99" step="0.01" required className={fieldClass} />
            </label>
            <label className="text-sm">Repeats
              <select value={cadence} onChange={(event) => setCadence(event.target.value)} className={fieldClass}>
                <option value="ONCE">Once</option>
                {kind !== "CREW_PAY" && <><option value="DAILY">Daily</option><option value="WEEKLY">Weekly</option></>}
                <option value="MONTHLY">Monthly</option>
              </select>
            </label>
            {kind === "CREW_PAY" ? (
              <label className="text-sm">First pay month<input name="startsOn" type="month" required value={startsOn.slice(0, 7)} onChange={(event) => setStartsOn(event.target.value ? event.target.value + "-01" : "")} className={fieldClass} /></label>
            ) : (
              <label className="text-sm">{cadence === "ONCE" ? "Cost date" : "First cost date"}<input name="startsOn" type="date" required value={startsOn} onChange={(event) => setStartsOn(event.target.value)} className={fieldClass} /></label>
            )}
            {cadence !== "ONCE" && <label className="text-sm">Stop after date (optional)<input name="endsOn" type="date" min={startsOn} className={fieldClass} /></label>}
            <div className="flex items-end"><button className="gf-btn-primary" disabled={busy || !data}>{cadence === "ONCE" ? "Save cost for review" : "Save schedule"}</button></div>
          </form>
        </details>

        <div className="flex flex-wrap items-end justify-between gap-3">
          <label className="text-sm font-medium">Review month<input type="month" required value={month} onChange={(event) => { if (event.target.value) { setError(""); setMonth(event.target.value); } }} className={fieldClass} /></label>
          <button type="button" className="gf-btn-secondary" disabled={busy || !data} onClick={() => void act({ action: "generate" }, "")}>Generate due drafts</button>
        </div>
        {!data ? <p className="text-sm text-ink-600">{error ? "Unable to load costs." : "Loading operating costs..."}</p> : !groups.size ? (
          <p className="rounded-lg bg-slate-50 p-3 text-sm text-ink-600">No costs for this month. Add a cost or generate drafts from your schedules.</p>
        ) : (
          <div className="space-y-3">
            {[...groups.entries()].map(([key, entries]) => {
              const first = entries[0];
              const costDate = first.costDate.slice(0, 10);
              const total = entries.reduce((sum, entry) => sum + entry.amountCents, 0);
              return (
                <section key={key} className="space-y-2 rounded-lg border border-slate-200 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div><h3 className="font-semibold text-ink-900">{labels[first.plan.kind]} · {costDate}</h3><p className="text-sm text-ink-600">{first.status === "DRAFT" ? "Draft" : first.status === "POSTED" ? "Included in Expenses" : "Skipped"} · {currency(total)}</p></div>
                    {first.status === "DRAFT" && <button type="button" disabled={busy} className="gf-btn-primary" onClick={() => {
                      setPending({ key, body: { action: "confirm", costDate, kind: first.plan.kind, draftIds: entries.map((entry) => entry.id), expectedCents: total }, title: `Include ${currency(total)} in project Expenses for ${costDate}?`, message: "Costs confirmed and included in project Expenses.", affectsProfit: true });
                    }}>Confirm {labels[first.plan.kind].toLowerCase()}</button>}
                    {first.status === "POSTED" && <button type="button" disabled={busy} className="gf-btn-secondary" onClick={() => {
                      setPending({ key, body: { action: "reverse", id: first.expenseId }, title: "This cost will leave Expenses until confirmed again.", message: "Posting reversed. Review the drafts before confirming again.", field: "reason", affectsProfit: true });
                    }}>Reopen for correction</button>}
                  </div>
                  {renderPending(key)}
                  <ul className="divide-y divide-slate-100">
                    {entries.map((entry) => (
                      <li key={entry.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                        <span>{entry.plan.label}{entry.plan.crewJob ? " · " + entry.plan.crewJob : ""} · {currency(entry.amountCents)}</span>
                        {entry.status === "DRAFT" && <div className="flex gap-2">
                          <button type="button" className="gf-btn-secondary" disabled={busy} onClick={() => {
                            setPending({ key: entry.id, body: { action: "edit", id: entry.id }, title: "Update this draft without changing the schedule.", message: "Draft amount updated.", field: "amount", initial: (entry.amountCents / 100).toFixed(2) });
                          }}>Edit amount</button>
                          <button type="button" className="gf-btn-secondary" disabled={busy} onClick={() => void act({ action: "skip", id: entry.id }, "Draft skipped.")}>Skip</button>
                        </div>}
                        {entry.status === "SKIPPED" && <button type="button" className="gf-btn-secondary" disabled={busy} onClick={() => void act({ action: "restore", id: entry.id }, "Draft restored.")}>Restore draft</button>}
                        {renderPending(entry.id)}
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>
        )}

        {!!data?.plans.some((plan) => plan.nextDue) && <details className="rounded-lg border border-slate-200 p-3">
          <summary className="cursor-pointer font-semibold text-ink-900">Upcoming schedule dates</summary>
          <ul className="mt-2 divide-y divide-slate-100">
            {data.plans.filter((plan) => plan.nextDue).map((plan) => <li key={plan.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
              <span>{labels[plan.kind]} · {plan.label} · {currency(plan.amountCents)} · {plan.cadence.toLowerCase()} · next {plan.nextDue!.slice(0, 10)}</span>
              <button type="button" className="gf-btn-secondary" disabled={busy} onClick={() => {
                setPending({ key: plan.id, body: { action: "stop", id: plan.id }, title: "Stop future drafts? Existing entries will stay.", message: "Schedule stopped. Existing drafts and expenses were kept." });
              }}>Stop schedule</button>
              {renderPending(plan.id)}
            </li>)}
          </ul>
        </details>}
      </div>
    </Card>
  );
}
