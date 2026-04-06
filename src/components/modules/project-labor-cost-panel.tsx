"use client";

import { type FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { Card } from "@/components/ui/card";
import { DataTable } from "@/components/ui/table";
import { formatCurrency, formatNumber } from "@/lib/utils";

interface ProjectLaborCostPanelProps {
  projectId: string;
  entries: Array<{
    id: string;
    workDate: string;
    rigId: string | null;
    rigCode: string | null;
    crewRole: string | null;
    personLabel: string | null;
    hoursWorked: number;
    hourlyRate: number;
    totalCost: number;
    notes: string | null;
  }>;
  rigOptions: Array<{
    id: string;
    rigCode: string;
  }>;
}

export function ProjectLaborCostPanel({ projectId, entries, rigOptions }: ProjectLaborCostPanelProps) {
  const router = useRouter();
  const [workDate, setWorkDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [rigId, setRigId] = useState("");
  const [crewRole, setCrewRole] = useState("");
  const [personLabel, setPersonLabel] = useState("");
  const [hoursWorked, setHoursWorked] = useState("");
  const [hourlyRate, setHourlyRate] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const totalLaborCost = useMemo(
    () => entries.reduce((sum, entry) => sum + entry.totalCost, 0),
    [entries]
  );

  async function submitEntry(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    setSaving(true);
    try {
      const response = await fetch(`/api/projects/${projectId}/labor-entries`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          workDate,
          rigId: rigId || null,
          crewRole: crewRole || null,
          personLabel: personLabel || null,
          hoursWorked: Number(hoursWorked),
          hourlyRate: Number(hourlyRate),
          notes: notes || null
        })
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        setError(payload?.message || "Failed to save labor entry.");
        return;
      }

      setCrewRole("");
      setPersonLabel("");
      setHoursWorked("");
      setHourlyRate("");
      setNotes("");
      setRigId("");
      setNotice("Labor entry saved.");
      router.refresh();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Failed to save labor entry.");
    } finally {
      setSaving(false);
    }
  }

  async function deleteEntry(entryId: string) {
    const reason = window.prompt("Enter correction reason for deleting this labor entry:");
    if (!reason || !reason.trim()) {
      return;
    }
    setError(null);
    setNotice(null);
    setDeletingId(entryId);
    try {
      const response = await fetch(`/api/projects/${projectId}/labor-entries/${entryId}`, {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          reason: reason.trim()
        })
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        setError(payload?.message || "Failed to delete labor entry.");
        return;
      }
      setNotice("Labor entry deleted.");
      router.refresh();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Failed to delete labor entry.");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <section className="grid gap-5 lg:grid-cols-2">
      <Card
        title="Project Labor Entries"
        subtitle="Capture labor hours and rates at project level. Ledger uses hours × rate; no inferred labor values."
      >
        <div className="mb-3 grid gap-2 sm:grid-cols-2">
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-ink-700">
            Entries: <span className="font-semibold text-ink-900">{formatNumber(entries.length)}</span>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-ink-700">
            Total labor cost: <span className="font-semibold text-ink-900">{formatCurrency(totalLaborCost)}</span>
          </div>
        </div>

        {entries.length === 0 ? (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            Labor not captured yet for this project.
          </p>
        ) : (
          <DataTable
            columns={["Date", "Person/Role", "Rig", "Hours", "Rate", "Cost", "Action"]}
            rows={entries.map((entry) => [
              formatDate(entry.workDate),
              [entry.personLabel, entry.crewRole].filter(Boolean).join(" • ") || "-",
              entry.rigCode || "-",
              formatNumber(entry.hoursWorked),
              formatCurrency(entry.hourlyRate),
              formatCurrency(entry.totalCost),
              <button
                key={`delete-labor-entry-${entry.id}`}
                type="button"
                onClick={() => void deleteEntry(entry.id)}
                disabled={deletingId === entry.id}
                className="rounded-md border border-rose-200 px-2 py-1 text-xs text-rose-700 hover:bg-rose-50 disabled:opacity-60"
              >
                {deletingId === entry.id ? "Deleting..." : "Delete"}
              </button>
            ])}
          />
        )}
      </Card>

      <Card title="Add Labor Entry" subtitle="Server derives total cost from hours × hourly rate.">
        <form onSubmit={submitEntry} className="space-y-3">
          {error ? (
            <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">{error}</p>
          ) : null}
          {notice ? (
            <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">{notice}</p>
          ) : null}

          <div className="grid gap-2 sm:grid-cols-2">
            <label className="text-xs text-ink-700">
              Work date
              <input
                type="date"
                value={workDate}
                onChange={(event) => setWorkDate(event.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                required
              />
            </label>

            <label className="text-xs text-ink-700">
              Rig (optional)
              <select
                value={rigId}
                onChange={(event) => setRigId(event.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              >
                <option value="">None</option>
                {rigOptions.map((rig) => (
                  <option key={rig.id} value={rig.id}>
                    {rig.rigCode}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            <label className="text-xs text-ink-700">
              Person label (optional)
              <input
                type="text"
                value={personLabel}
                onChange={(event) => setPersonLabel(event.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                placeholder="e.g. John M."
              />
            </label>
            <label className="text-xs text-ink-700">
              Crew role (optional)
              <input
                type="text"
                value={crewRole}
                onChange={(event) => setCrewRole(event.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                placeholder="e.g. Driller"
              />
            </label>
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            <label className="text-xs text-ink-700">
              Hours worked
              <input
                type="number"
                min="0.01"
                step="0.01"
                value={hoursWorked}
                onChange={(event) => setHoursWorked(event.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                required
              />
            </label>
            <label className="text-xs text-ink-700">
              Hourly rate
              <input
                type="number"
                min="0.01"
                step="0.01"
                value={hourlyRate}
                onChange={(event) => setHourlyRate(event.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                required
              />
            </label>
          </div>

          <label className="text-xs text-ink-700">
            Notes (optional)
            <textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              rows={3}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
          </label>

          <button
            type="submit"
            disabled={saving}
            className="rounded-lg bg-brand-600 px-3 py-2 text-xs font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
          >
            {saving ? "Saving..." : "Save labor entry"}
          </button>
        </form>
      </Card>
    </section>
  );
}

function formatDate(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value.slice(0, 10);
  }
  return parsed.toISOString().slice(0, 10);
}
