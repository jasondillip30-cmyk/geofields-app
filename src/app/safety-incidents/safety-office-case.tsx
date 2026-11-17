"use client";

import { useEffect, useState, type FormEvent } from "react";
import { isSafetyTaskOverdue } from "@/lib/safety-incident-policy";
import { SafetyActionAssignment } from "./safety-action-assignment";

type Data = {
  coordination: {
    revision: number; state: string; brief: string | null;
    actions: { id: string; dueDate: string; task: string; state: string; owner: { fullName: string } }[];
  };
  owners: { id: string; fullName: string }[];
};

export function SafetyOfficeCase({ id, onChanged }: { id: string; onChanged: () => void }) {
  const [data, setData] = useState<Data | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [refresh, setRefresh] = useState(0);
  const url = "/api/safety-incidents/" + encodeURIComponent(id);
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(url, { cache: "no-store", signal: controller.signal });
        const result = await response.json();
        if (!response.ok) throw new Error(result.message);
        setData(result);
      } catch (error) {
        if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "Could not open follow-up.");
      }
    })();
    return () => controller.abort();
  }, [refresh, url]);

  async function assign(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!data || busy) return;
    const form = event.currentTarget;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(url, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...Object.fromEntries(new FormData(form)), command: "ADD_ACTION", revision: data.coordination.revision })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message);
      setData((current) => current ? { ...current, coordination: { ...current.coordination, revision: current.coordination.revision + 1 } } : null);
      setRefresh((value) => value + 1);
      setNotice("Follow-up assigned.");
      form.reset();
      onChanged();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not assign the action.");
    } finally { setBusy(false); }
  }

  return (
    <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-4" aria-label="Office follow-up">
      <h3 className="text-lg font-semibold">Follow-up · {id.slice(-8).toUpperCase()}</h3>
      {error && <p role="alert" className="text-sm text-rose-900">{error}{" "}
        <button className="underline" onClick={() => { setError(""); setRefresh((value) => value + 1); }}>Reload follow-up</button>
      </p>}
      {!data && !error && <p role="status">Loading follow-up...</p>}
      {data && <>
        <div className="rounded-lg bg-slate-50 p-3">
          <h4 className="font-semibold">Note from Safety</h4>
          <p className="whitespace-pre-wrap break-words text-sm">{data.coordination.brief ?? "No coordination note shared."}</p>
        </div>
        {!data.coordination.actions.length && <p className="text-sm">No follow-up assigned yet.</p>}
        {data.coordination.actions.map((action) => (
          <div key={action.id} className="space-y-1 border-t border-slate-200 pt-2">
            <p className="break-words font-medium">{action.task}</p>
            <p className="text-sm">{action.owner.fullName} · Due {action.dueDate.slice(0, 10)} · {action.state === "DONE" ? "Awaiting verification" : action.state === "VERIFIED" ? "Verified" : "Open"}
              {isSafetyTaskOverdue(action) && <strong className="ml-2 text-rose-800">Overdue</strong>}
            </p>
          </div>
        ))}
        {data.coordination.state === "CLOSED"
          ? <p className="text-sm">Closed by Safety. No more actions can be assigned.</p>
          : <SafetyActionAssignment owners={data.owners} busy={busy} onSubmit={assign} />}
        {notice && <p role="status" className="text-sm text-emerald-800">{notice}</p>}
      </>}
    </section>
  );
}
