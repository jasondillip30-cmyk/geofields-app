"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";

import { AccessGate } from "@/components/layout/access-gate";
import { Card } from "@/components/ui/card";

interface RigRecord {
  id: string;
  rigCode: string;
  model: string;
  serialNumber: string;
  photoUrl: string | null;
  acquisitionDate: string | null;
  status: string;
  condition: string;
  conditionScore: number;
  totalHoursWorked: number;
  totalMetersDrilled: number;
  totalLifetimeDays: number;
  costAllocationBasis: "DAY" | "HOUR";
  costRatePerDay: number;
  costRatePerHour: number;
}

const emptyForm = {
  id: "",
  rigCode: "",
  model: "",
  serialNumber: "",
  photoUrl: "",
  acquisitionDate: "",
  status: "IDLE",
  condition: "GOOD",
  conditionScore: "80",
  totalHoursWorked: "0",
  totalMetersDrilled: "0",
  totalLifetimeDays: "0",
  costAllocationBasis: "DAY",
  costRatePerDay: "0",
  costRatePerHour: "0"
};

export default function RigSetupPage() {
  return (
    <Suspense fallback={<RigSetupFallback />}>
      <RigSetupPageContent />
    </Suspense>
  );
}

function RigSetupPageContent() {
  const searchParams = useSearchParams();
  const queryRigId = searchParams.get("editRigId")?.trim() || searchParams.get("rigId")?.trim() || "";

  const [rigs, setRigs] = useState<RigRecord[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hydratedRigId, setHydratedRigId] = useState("");

  const loadRigs = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/rigs", { cache: "no-store" });
      const payload = await response.json().catch(() => null);
      setRigs(Array.isArray(payload?.data) ? payload.data : []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadRigs();
  }, [loadRigs]);

  useEffect(() => {
    if (!queryRigId) {
      if (hydratedRigId) {
        setHydratedRigId("");
      }
      return;
    }
    if (queryRigId === hydratedRigId) {
      return;
    }

    const match = rigs.find((rig) => rig.id === queryRigId);
    if (!match) {
      if (!loading) {
        setError("Rig was not found for editing.");
      }
      return;
    }

    setForm({
      id: match.id,
      rigCode: match.rigCode,
      model: match.model,
      serialNumber: match.serialNumber,
      photoUrl: match.photoUrl || "",
      acquisitionDate: match.acquisitionDate ? match.acquisitionDate.slice(0, 10) : "",
      status: match.status,
      condition: match.condition,
      conditionScore: String(match.conditionScore),
      totalHoursWorked: String(match.totalHoursWorked),
      totalMetersDrilled: String(match.totalMetersDrilled),
      totalLifetimeDays: String(match.totalLifetimeDays),
      costAllocationBasis: match.costAllocationBasis,
      costRatePerDay: String(match.costRatePerDay),
      costRatePerHour: String(match.costRatePerHour)
    });
    setNotice(`Editing rig: ${match.rigCode}`);
    setError(null);
    setHydratedRigId(queryRigId);
  }, [hydratedRigId, loading, queryRigId, rigs]);

  async function saveRig(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setNotice(null);

    try {
      const isUpdate = Boolean(form.id);
      const response = await fetch(isUpdate ? `/api/rigs/${form.id}` : "/api/rigs", {
        method: isUpdate ? "PUT" : "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          ...form,
          conditionScore: Number(form.conditionScore),
          totalHoursWorked: Number(form.totalHoursWorked),
          totalMetersDrilled: Number(form.totalMetersDrilled),
          totalLifetimeDays: Number(form.totalLifetimeDays),
          costAllocationBasis: form.costAllocationBasis,
          costRatePerDay: Number(form.costRatePerDay),
          costRatePerHour: Number(form.costRatePerHour)
        })
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({ message: "Failed to save rig." }));
        setError(payload.message || "Failed to save rig.");
        return;
      }

      setForm(emptyForm);
      setHydratedRigId("");
      await loadRigs();
      setNotice(isUpdate ? "Rig updated successfully." : "Rig created successfully.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <AccessGate permission="rigs:manage">
      <div className="gf-page-stack">
        <section className="flex items-center justify-between">
          <h1 className="text-xl font-semibold text-ink-900">{form.id ? "Edit Rig" : "Create Rig"}</h1>
          <Link
            href="/rigs"
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-ink-700 hover:bg-slate-50"
          >
            Back to Rigs
          </Link>
        </section>

        <Card title={form.id ? "Edit Rig" : "Create Rig"}>
          {loading ? <p className="text-sm text-ink-600">Loading rig setup...</p> : null}

          {error ? (
            <p className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</p>
          ) : null}
          {notice ? (
            <p className="mb-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
              {notice}
            </p>
          ) : null}

          <form onSubmit={saveRig} className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            <Input
              label="Rig Code"
              value={form.rigCode}
              onChange={(value) => setForm((current) => ({ ...current, rigCode: value }))}
              required
            />
            <Input
              label="Model"
              value={form.model}
              onChange={(value) => setForm((current) => ({ ...current, model: value }))}
              required
            />
            <Input
              label="Serial Number"
              value={form.serialNumber}
              onChange={(value) => setForm((current) => ({ ...current, serialNumber: value }))}
              required
            />
            <Input
              label="Acquisition Date"
              type="date"
              value={form.acquisitionDate}
              onChange={(value) => setForm((current) => ({ ...current, acquisitionDate: value }))}
            />
            <Select
              label="Status"
              value={form.status}
              onChange={(value) => setForm((current) => ({ ...current, status: value }))}
              options={["ACTIVE", "IDLE", "MAINTENANCE", "BREAKDOWN"]}
            />
            <Select
              label="Condition"
              value={form.condition}
              onChange={(value) => setForm((current) => ({ ...current, condition: value }))}
              options={["EXCELLENT", "GOOD", "FAIR", "POOR", "CRITICAL"]}
            />
            <Input
              label="Condition Score"
              type="number"
              value={form.conditionScore}
              onChange={(value) => setForm((current) => ({ ...current, conditionScore: value }))}
            />
            <Input
              label="Total Hours Worked"
              type="number"
              value={form.totalHoursWorked}
              onChange={(value) => setForm((current) => ({ ...current, totalHoursWorked: value }))}
            />
            <Input
              label="Total Meters Drilled"
              type="number"
              value={form.totalMetersDrilled}
              onChange={(value) => setForm((current) => ({ ...current, totalMetersDrilled: value }))}
            />
            <Input
              label="Total Lifetime Days"
              type="number"
              value={form.totalLifetimeDays}
              onChange={(value) => setForm((current) => ({ ...current, totalLifetimeDays: value }))}
            />
            <Select
              label="Cost Allocation Basis"
              value={form.costAllocationBasis}
              onChange={(value) =>
                setForm((current) => ({
                  ...current,
                  costAllocationBasis: value === "HOUR" ? "HOUR" : "DAY"
                }))
              }
              options={["DAY", "HOUR"]}
            />
            <Input
              label="Rig Cost Rate Per Day"
              type="number"
              value={form.costRatePerDay}
              onChange={(value) => setForm((current) => ({ ...current, costRatePerDay: value }))}
            />
            <Input
              label="Rig Cost Rate Per Hour"
              type="number"
              value={form.costRatePerHour}
              onChange={(value) => setForm((current) => ({ ...current, costRatePerHour: value }))}
            />
            <Input
              label="Rig Photo URL"
              value={form.photoUrl}
              onChange={(value) => setForm((current) => ({ ...current, photoUrl: value }))}
            />
            <div className="flex gap-2 lg:col-span-3">
              <button
                type="submit"
                disabled={saving}
                className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
              >
                {saving ? "Saving..." : form.id ? "Update Rig" : "Create Rig"}
              </button>
              {form.id ? (
                <button
                  type="button"
                  onClick={() => {
                    setForm(emptyForm);
                    setHydratedRigId("");
                    setNotice(null);
                    setError(null);
                  }}
                  className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-ink-700 hover:bg-slate-50"
                >
                  Cancel Edit
                </button>
              ) : null}
            </div>
          </form>
        </Card>
      </div>
    </AccessGate>
  );
}

function RigSetupFallback() {
  return (
    <AccessGate permission="rigs:manage">
      <div className="gf-page-stack">
        <Card title="Create Rig">
          <p className="text-sm text-ink-600">Loading rig setup...</p>
        </Card>
      </div>
    </AccessGate>
  );
}

function Input({
  label,
  value,
  onChange,
  type = "text",
  required = false
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  required?: boolean;
}) {
  return (
    <label className="text-sm text-ink-700">
      <span className="mb-1 block">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        required={required}
        className="w-full rounded-lg border border-slate-200 px-3 py-2"
      />
    </label>
  );
}

function Select({
  label,
  value,
  onChange,
  options
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: string[];
}) {
  return (
    <label className="text-sm text-ink-700">
      <span className="mb-1 block">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-lg border border-slate-200 px-3 py-2"
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}
