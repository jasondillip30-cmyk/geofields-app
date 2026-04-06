"use client";

import { useEffect, useMemo, useState } from "react";

type BudgetScopeType = "RIG" | "PROJECT";

export interface BudgetPlanModalPayload {
  id?: string;
  scopeType: BudgetScopeType;
  rigId: string | null;
  projectId: string | null;
  clientId: string | null;
  name: string;
  amount: string;
  periodStart: string;
  periodEnd: string;
  notes: string;
}

export interface BudgetPlanModalInitialData {
  id?: string;
  scopeType?: BudgetScopeType;
  rigId?: string | null;
  projectId?: string | null;
  clientId?: string | null;
  name?: string;
  amount?: number | string;
  periodStart?: string;
  periodEnd?: string;
  notes?: string | null;
}

export function BudgetPlanModal({
  open,
  mode,
  saving,
  initialData,
  clients,
  rigs,
  projects,
  projectOnly = false,
  onClose,
  onSave
}: {
  open: boolean;
  mode: "create" | "edit";
  saving: boolean;
  initialData: BudgetPlanModalInitialData | null;
  clients: Array<{ id: string; name: string }>;
  rigs?: Array<{ id: string; name: string }>;
  projects: Array<{ id: string; name: string; clientId: string }>;
  projectOnly?: boolean;
  onClose: () => void;
  onSave: (payload: BudgetPlanModalPayload) => Promise<void> | void;
}) {
  const defaultScopeType: BudgetScopeType = projectOnly ? "PROJECT" : "RIG";
  const selectableRigs = rigs || [];
  const [form, setForm] = useState<BudgetPlanModalPayload>({
    scopeType: defaultScopeType,
    rigId: null,
    projectId: null,
    clientId: null,
    name: "",
    amount: "",
    periodStart: "",
    periodEnd: "",
    notes: ""
  });

  useEffect(() => {
    if (!open) {
      return;
    }
    const nextScopeType: BudgetScopeType =
      projectOnly ? "PROJECT" : initialData?.scopeType || "RIG";
    setForm({
      id: initialData?.id,
      scopeType: nextScopeType,
      rigId: projectOnly ? null : initialData?.rigId || null,
      projectId: initialData?.projectId || null,
      clientId: initialData?.clientId || null,
      name: initialData?.name || "",
      amount:
        typeof initialData?.amount === "number"
          ? String(initialData.amount)
          : initialData?.amount || "",
      periodStart: toDateInput(initialData?.periodStart),
      periodEnd: toDateInput(initialData?.periodEnd),
      notes: initialData?.notes || ""
    });
  }, [defaultScopeType, initialData, open, projectOnly]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !saving) {
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, open, saving]);

  const selectedProject = useMemo(
    () => projects.find((entry) => entry.id === form.projectId) || null,
    [form.projectId, projects]
  );
  const selectedClientName = useMemo(() => {
    if (!form.clientId) {
      return "All clients";
    }
    return clients.find((entry) => entry.id === form.clientId)?.name || "Unknown client";
  }, [clients, form.clientId]);

  useEffect(() => {
    if (form.scopeType !== "PROJECT") {
      return;
    }
    if (!selectedProject) {
      return;
    }
    setForm((current) => {
      if (current.clientId === selectedProject.clientId) {
        return current;
      }
      return {
        ...current,
        clientId: selectedProject.clientId
      };
    });
  }, [form.scopeType, selectedProject]);

  if (!open) {
    return null;
  }

  const scopeLocked = mode === "edit" || projectOnly;
  const title = projectOnly
    ? mode === "edit"
      ? "Edit Project Budget"
      : "Add Project Budget"
    : mode === "edit"
      ? "Edit Budget Record"
      : "Create Budget Record";
  const actionLabel = projectOnly ? "Save budget" : mode === "edit" ? "Save Changes" : "Save budget";
  const periodLabel = [formatDateContext(form.periodStart), formatDateContext(form.periodEnd)]
    .filter(Boolean)
    .join(" - ");

  return (
    <div className="fixed inset-0 z-[92] flex items-center justify-center bg-slate-900/45 p-4">
      <button
        type="button"
        className="absolute inset-0"
        aria-label="Close budget plan modal"
        onClick={() => {
          if (!saving) {
            onClose();
          }
        }}
      />
      <div className="relative z-10 w-full max-w-2xl rounded-2xl border border-slate-200 bg-white shadow-[0_24px_64px_rgba(15,23,42,0.24)]">
        <div className="border-b border-slate-200 px-5 py-4">
          <h3 className="text-lg font-semibold text-ink-900">{title}</h3>
        </div>

        <div className="grid gap-3 px-5 py-4 md:grid-cols-2">
          {projectOnly ? (
            <div className="md:col-span-2 rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Project budget details
              </p>
              <div className="mt-2 grid gap-2 text-sm text-slate-700 sm:grid-cols-2">
                <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                  <p className="text-[11px] text-slate-500">Scope Type</p>
                  <p className="font-medium text-ink-900">Project</p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                  <p className="text-[11px] text-slate-500">Project</p>
                  <p className="font-medium text-ink-900">{selectedProject?.name || "—"}</p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                  <p className="text-[11px] text-slate-500">Client</p>
                  <p className="font-medium text-ink-900">{selectedClientName}</p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                  <p className="text-[11px] text-slate-500">Project period</p>
                  <p className="font-medium text-ink-900">{periodLabel || "Not set"}</p>
                </div>
              </div>
            </div>
          ) : (
            <label className="space-y-1 text-sm">
              <span className="font-medium text-ink-800">Scope Type</span>
              <select
                value={form.scopeType}
                disabled={scopeLocked}
                onChange={(event) => {
                  const nextScope = event.target.value as BudgetScopeType;
                  setForm((current) => ({
                    ...current,
                    scopeType: nextScope,
                    rigId: nextScope === "RIG" ? current.rigId : null,
                    projectId: nextScope === "PROJECT" ? current.projectId : null,
                    clientId: nextScope === "PROJECT" ? current.clientId : null
                  }));
                }}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-100"
              >
                <option value="RIG">Rig</option>
                <option value="PROJECT">Project</option>
              </select>
            </label>
          )}

          <label className="space-y-1 text-sm">
            <span className="font-medium text-ink-800">Budget Name</span>
            <input
              value={form.name}
              onChange={(event) =>
                setForm((current) => ({ ...current, name: event.target.value }))
              }
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder="Q2 Operations Budget"
            />
          </label>

          {!projectOnly && form.scopeType === "RIG" ? (
            <label className="space-y-1 text-sm">
              <span className="font-medium text-ink-800">Rig</span>
              <select
                value={form.rigId || ""}
                disabled={scopeLocked}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    rigId: event.target.value || null
                  }))
                }
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-100"
              >
                <option value="">Select rig</option>
                {selectableRigs.map((rig) => (
                  <option key={rig.id} value={rig.id}>
                    {rig.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {!projectOnly && form.scopeType !== "RIG" ? (
            <label className="space-y-1 text-sm">
              <span className="font-medium text-ink-800">Project</span>
              <select
                value={form.projectId || ""}
                disabled={scopeLocked}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    projectId: event.target.value || null
                  }))
                }
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-100"
              >
                <option value="">Select project</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          {!projectOnly ? (
            <label className="space-y-1 text-sm">
              <span className="font-medium text-ink-800">Client (Optional)</span>
              <select
                value={form.clientId || ""}
                disabled={scopeLocked && form.scopeType === "PROJECT"}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    clientId: event.target.value || null
                  }))
                }
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-100"
              >
                <option value="">All clients</option>
                {clients.map((client) => (
                  <option key={client.id} value={client.id}>
                    {client.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          <label className="space-y-1 text-sm">
            <span className="font-medium text-ink-800">Budget Amount</span>
            <input
              type="number"
              min="0"
              step="0.01"
              value={form.amount}
              onChange={(event) =>
                setForm((current) => ({ ...current, amount: event.target.value }))
              }
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder="0.00"
            />
          </label>

          {!projectOnly ? (
            <>
              <label className="space-y-1 text-sm">
                <span className="font-medium text-ink-800">Period Start</span>
                <input
                  type="date"
                  value={form.periodStart}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, periodStart: event.target.value }))
                  }
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </label>

              <label className="space-y-1 text-sm">
                <span className="font-medium text-ink-800">Period End</span>
                <input
                  type="date"
                  value={form.periodEnd}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, periodEnd: event.target.value }))
                  }
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </label>
            </>
          ) : null}

          <label className="space-y-1 text-sm md:col-span-2">
            <span className="font-medium text-ink-800">Notes</span>
            <textarea
              value={form.notes}
              onChange={(event) =>
                setForm((current) => ({ ...current, notes: event.target.value }))
              }
              rows={3}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder="Budget assumptions"
            />
          </label>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-5 py-4">
          <button
            type="button"
            className="gf-btn-secondary"
            disabled={saving}
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="button"
            className="gf-btn-primary"
            disabled={saving}
            onClick={() => void onSave(form)}
          >
            {saving ? "Saving..." : actionLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function toDateInput(value: string | undefined) {
  if (!value) {
    return "";
  }
  return value.slice(0, 10);
}

function formatDateContext(value: string | undefined) {
  if (!value) {
    return "";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "2-digit",
    year: "numeric"
  }).format(parsed);
}
