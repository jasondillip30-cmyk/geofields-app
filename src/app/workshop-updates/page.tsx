"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";

import { AccessGate } from "@/components/layout/access-gate";
import { useAnalyticsFilters } from "@/components/layout/analytics-filters-provider";
import { useRole } from "@/components/layout/role-provider";
import { Card } from "@/components/ui/card";
import { canAccess } from "@/lib/auth/permissions";

type Rig = { id: string; rigCode: string };
type Job = { id: string; requestCode: string; rigId: string; rig: { rigCode: string } };
type WorkshopUpdate = {
  id: string;
  workDate: string;
  workDone: string;
  blockers: string | null;
  nextSteps: string | null;
  author: { fullName: string };
  rig: Rig | null;
  maintenanceRequest: { requestCode: string } | null;
};
type Feed = { updates: WorkshopUpdate[]; nextCursor: string | null; options: { rigs: Rig[]; jobs: Job[] } | null };

const endpoint = "/api/workshop-updates";
const fieldClass = "mt-1 block min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base";
const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "long", timeZone: "UTC" });
const workshopDate = new Intl.DateTimeFormat("en-CA", {
  year: "numeric", month: "2-digit", day: "2-digit", timeZone: "Africa/Dar_es_Salaam"
});

export default function WorkshopUpdatesPage() {
  const { filters } = useAnalyticsFilters();
  return (
    <AccessGate permission="workshop-updates:view" denyBehavior="redirect">
      <WorkshopFeed key={filters.from + ":" + filters.to} from={filters.from} to={filters.to} />
    </AccessGate>
  );
}

function WorkshopFeed({ from, to }: { from?: string | null; to?: string | null }) {
  const { role } = useRole();
  const canPost = Boolean(role && canAccess(role, "workshop-updates:post"));
  const [feed, setFeed] = useState<Feed | null>(null);
  const [revision, setRevision] = useState(0);
  const [readError, setReadError] = useState("");
  const [writeError, setWriteError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [rigId, setRigId] = useState("");
  const [jobId, setJobId] = useState("");
  const moreRequest = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const activeMoreRequest = moreRequest;
    void readFeed(from, to, controller.signal).then(
      (result) => { if (!controller.signal.aborted) setFeed(result); },
      (error: Error) => { if (!controller.signal.aborted) setReadError(error.message); }
    );
    return () => {
      controller.abort();
      activeMoreRequest.current?.abort();
    };
  }, [from, to, revision]);

  async function loadOlder() {
    if (!feed?.nextCursor || loadingMore || busy) return;
    const controller = new AbortController();
    moreRequest.current = controller;
    setLoadingMore(true);
    setReadError("");
    try {
      const older = await readFeed(from, to, controller.signal, feed.nextCursor);
      if (!controller.signal.aborted) {
        setFeed({ ...feed, updates: [...feed.updates, ...older.updates], nextCursor: older.nextCursor });
      }
    } catch (error) {
      if (!controller.signal.aborted) setReadError(error instanceof Error ? error.message : "Could not load older updates.");
    } finally {
      if (!controller.signal.aborted) setLoadingMore(false);
    }
  }

  async function post(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || loadingMore) return;
    const form = event.currentTarget;
    const fields = Object.fromEntries(new FormData(form));
    setBusy(true);
    setWriteError("");
    setNotice("");
    try {
      const response = await fetch(endpoint, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(fields)
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || "Could not post the update.");
      form.reset();
      setRigId("");
      setJobId("");
      const date = String(fields.workDate);
      setNotice((from && date < from) || (to && date > to)
        ? "Update posted. Its work date is outside the current feed filter."
        : "Workshop update posted.");
      setReadError("");
      setRevision((value) => value + 1);
    } catch (error) {
      setWriteError(error instanceof Error ? error.message : "Could not post the update.");
    } finally {
      setBusy(false);
    }
  }

  const options = feed?.options;
  return (
    <div className="gf-page-stack mx-auto max-w-4xl">
      <p className="max-w-xl text-sm text-slate-600">See what was worked on, what is blocked, and what needs attention next. Updates do not change maintenance or rig status.</p>
      <Link href="/safety-incidents#report-incident" className="gf-btn-secondary inline-flex min-h-11 items-center self-start">Report incident</Link>
      {canPost && (
        <Card title="Post a workshop update">
          <form onSubmit={post} className="space-y-4">
            <label className="block text-sm font-medium">Work date
              <input name="workDate" type="date" defaultValue={workshopDate.format(new Date())} required className={fieldClass} />
            </label>
            <label className="block text-sm font-medium">What did you work on?
              <textarea name="workDone" required maxLength={2000} rows={3} className={fieldClass} placeholder="Repairs, checks, or other work completed" />
            </label>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block text-sm font-medium">Blockers (optional)
                <textarea name="blockers" maxLength={2000} rows={2} className={fieldClass} placeholder="Parts, tools, or decisions needed" />
              </label>
              <label className="block text-sm font-medium">Next steps (optional)
                <textarea name="nextSteps" maxLength={2000} rows={2} className={fieldClass} placeholder="What needs attention next" />
              </label>
            </div>
            <details className="rounded-lg border border-slate-200 px-3">
              <summary className="min-h-11 cursor-pointer py-3 text-sm font-medium">Link a rig or maintenance job (optional)</summary>
              <div className="grid gap-3 pb-3 sm:grid-cols-2">
                <label className="block text-sm font-medium">Rig
                  <select name="rigId" value={rigId} onChange={(event) => { setRigId(event.target.value); setJobId(""); }} className={fieldClass}>
                    <option value="">No rig selected</option>
                    {options?.rigs.map((rig) => <option key={rig.id} value={rig.id}>{rig.rigCode}</option>)}
                  </select>
                </label>
                <label className="block text-sm font-medium">Recent maintenance job
                  <select name="maintenanceRequestId" value={jobId} onChange={(event) => setJobId(event.target.value)} className={fieldClass}>
                    <option value="">No job selected</option>
                    {options?.jobs.filter((job) => !rigId || job.rigId === rigId).map((job) =>
                      <option key={job.id} value={job.id}>{job.requestCode} ({job.rig.rigCode})</option>)}
                  </select>
                </label>
              </div>
            </details>
            <button type="submit" disabled={busy || loadingMore} className="gf-btn-primary min-h-11 w-full sm:w-auto">
              {busy ? "Posting..." : "Post update"}
            </button>
            {writeError && <p role="alert" className="text-sm text-rose-800">{writeError}</p>}
            {notice && <p role="status" className="text-sm text-emerald-800">{notice}</p>}
          </form>
        </Card>
      )}
      <section aria-labelledby="workshop-feed-heading" className="space-y-3">
        <h2 id="workshop-feed-heading" className="font-display text-xl text-ink-900">Recent updates</h2>
        {readError && <p role="alert" className="text-sm text-rose-800">{readError}{" "}
          <button type="button" disabled={busy || loadingMore} className="underline" onClick={() => { setReadError(""); setRevision((value) => value + 1); }}>Retry</button>
        </p>}
        {!feed && !readError && <p role="status" className="text-sm text-slate-600">Loading updates...</p>}
        {feed?.updates.length === 0 && <p className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-600">No workshop updates {from || to ? "for the selected dates" : "yet"}.</p>}
        {feed?.updates.map((update) => (
          <Card key={update.id}>
            <article className="space-y-3">
              <header className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <h3 className="font-semibold text-ink-900">{update.author.fullName}</h3>
                <time className="text-sm text-slate-600" dateTime={update.workDate.slice(0, 10)}>{dateFormat.format(new Date(update.workDate))}</time>
              </header>
              <p className="whitespace-pre-wrap break-words text-sm text-ink-900">{update.workDone}</p>
              {update.blockers && <p className="whitespace-pre-wrap break-words rounded-lg bg-amber-50 p-2.5 text-sm text-amber-950"><strong>Blocked:</strong> {update.blockers}</p>}
              {update.nextSteps && <p className="whitespace-pre-wrap break-words text-sm text-slate-700"><strong>Next:</strong> {update.nextSteps}</p>}
              {(update.rig || update.maintenanceRequest) && (
                <div className="flex flex-wrap gap-3 text-sm text-slate-600">
                  {update.rig && <Link className="font-medium text-brand-700 underline" href={`/rigs/${encodeURIComponent(update.rig.id)}`}>{update.rig.rigCode}</Link>}
                  {update.maintenanceRequest && <span>Maintenance job {update.maintenanceRequest.requestCode}</span>}
                </div>
              )}
            </article>
          </Card>
        ))}
        {feed?.nextCursor && <button type="button" disabled={loadingMore || busy} className="gf-btn-secondary min-h-11" onClick={() => void loadOlder()}>{loadingMore ? "Loading..." : "Load older updates"}</button>}
      </section>
    </div>
  );
}

async function readFeed(from: string | null | undefined, to: string | null | undefined, signal: AbortSignal, cursor?: string): Promise<Feed> {
  const params = new URLSearchParams();
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  if (cursor) params.set("cursor", cursor);
  const response = await fetch(endpoint + "?" + params, { signal, cache: "no-store" });
  if (!response.ok) throw new Error("Workshop updates could not load. Try again.");
  return response.json();
}
