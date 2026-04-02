"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";

import type { AnalyticsFilters } from "@/components/layout/analytics-filters-provider";
import { Card } from "@/components/ui/card";
import { DataTable } from "@/components/ui/table";
import { formatCurrency } from "@/lib/utils";

type RequisitionType =
  | "LIVE_PROJECT_PURCHASE"
  | "INVENTORY_STOCK_UP"
  | "MAINTENANCE_PURCHASE";
type LiveProjectSpendType = "BREAKDOWN" | "NORMAL_EXPENSE";

type RequisitionStatus =
  | "SUBMITTED"
  | "APPROVED"
  | "REJECTED"
  | "PURCHASE_COMPLETED";

type RequisitionWizardStep = 1 | 2 | 3 | 4 | 5;

interface RequisitionLineItem {
  id: string;
  description: string;
  quantity: number;
  estimatedUnitCost: number;
  estimatedTotalCost: number;
  notes: string | null;
}

interface RequisitionRow {
  id: string;
  requisitionCode: string;
  type: RequisitionType;
  status: RequisitionStatus;
  liveProjectSpendType: LiveProjectSpendType | null;
  category: string;
  subcategory: string | null;
  requestedVendorName: string | null;
  notes: string | null;
  submittedAt: string;
  submittedBy: {
    userId: string;
    name: string;
    role: string;
  };
  context: {
    clientId: string | null;
    projectId: string | null;
    rigId: string | null;
    maintenanceRequestId: string | null;
  };
  lineItems: RequisitionLineItem[];
  totals: {
    estimatedTotalCost: number;
    approvedTotalCost: number;
    actualPostedCost: number;
  };
  approval: {
    approvedAt: string | null;
    approvedBy: {
      userId: string;
      name: string;
      role: string;
    } | null;
    rejectedAt: string | null;
    rejectedBy: {
      userId: string;
      name: string;
      role: string;
    } | null;
    rejectionReason: string | null;
    lineItemMode: "FULL_ONLY";
  };
  purchase: {
    receiptSubmissionId: string | null;
    receiptNumber: string | null;
    supplierName: string | null;
    expenseId: string | null;
    movementCount: number;
    postedAt: string | null;
  };
}

interface MaintenanceOption {
  id: string;
  requestCode: string;
  rigId: string;
}

interface RequisitionFormLine {
  id: string;
  description: string;
  quantity: string;
  estimatedUnitCost: string;
  notes: string;
}

interface RequisitionWorkflowCardProps {
  filters: AnalyticsFilters;
  clients: Array<{ id: string; name: string }>;
  projects: Array<{ id: string; name: string; clientId: string; assignedRigId?: string | null }>;
  rigs: Array<{ id: string; name: string }>;
  onWorkflowChanged?: () => Promise<void> | void;
}

const initialFormLine = (): RequisitionFormLine => ({
  id: `line-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
  description: "",
  quantity: "1",
  estimatedUnitCost: "",
  notes: ""
});

function createInitialFormState() {
  return {
    type: "" as RequisitionType | "",
    liveProjectSpendType: "" as LiveProjectSpendType | "",
    clientId: "",
    projectId: "",
    rigId: "",
    maintenanceRequestId: "",
    category: "Materials",
    subcategory: "",
    requestedVendorName: "",
    notes: "",
    lines: [initialFormLine()]
  };
}

export function RequisitionWorkflowCard({
  filters,
  clients,
  projects,
  rigs,
  onWorkflowChanged
}: RequisitionWorkflowCardProps) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<RequisitionStatus | "all">("all");
  const [rows, setRows] = useState<RequisitionRow[]>([]);
  const [maintenanceOptions, setMaintenanceOptions] = useState<MaintenanceOption[]>([]);
  const [form, setForm] = useState(() => createInitialFormState());
  const [wizardStep, setWizardStep] = useState<RequisitionWizardStep>(1);

  const filteredProjects = useMemo(() => {
    if (!form.clientId) {
      return projects;
    }
    return projects.filter((project) => project.clientId === form.clientId);
  }, [form.clientId, projects]);

  const filteredMaintenanceOptions = useMemo(() => {
    if (!form.rigId) {
      return maintenanceOptions;
    }
    return maintenanceOptions.filter((entry) => entry.rigId === form.rigId);
  }, [form.rigId, maintenanceOptions]);

  const estimatedTotal = useMemo(
    () =>
      form.lines.reduce((sum, line) => {
        const quantity = Number(line.quantity);
        const unitCost = Number(line.estimatedUnitCost);
        if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(unitCost) || unitCost < 0) {
          return sum;
        }
        return sum + quantity * unitCost;
      }, 0),
    [form.lines]
  );

  const validLineItems = useMemo(
    () =>
      form.lines
        .map((line, index) => ({
          id: line.id || `line-${index + 1}`,
          description: line.description.trim(),
          quantity: Number(line.quantity),
          estimatedUnitCost: Number(line.estimatedUnitCost),
          estimatedTotalCost:
            Number(line.quantity) > 0 && Number(line.estimatedUnitCost) >= 0
              ? Number(line.quantity) * Number(line.estimatedUnitCost)
              : 0,
          notes: line.notes.trim() || null
        }))
        .filter(
          (line) =>
            line.description &&
            Number.isFinite(line.quantity) &&
            line.quantity > 0 &&
            Number.isFinite(line.estimatedUnitCost) &&
            line.estimatedUnitCost >= 0
        ),
    [form.lines]
  );

  const pendingCount = useMemo(
    () => rows.filter((row) => row.status === "SUBMITTED").length,
    [rows]
  );
  const approvedReadyCount = useMemo(
    () => rows.filter((row) => row.status === "APPROVED").length,
    [rows]
  );
  const completedCount = useMemo(
    () => rows.filter((row) => row.status === "PURCHASE_COMPLETED").length,
    [rows]
  );

  const loadRequisitions = useCallback(async () => {
    setLoading(true);
    try {
      const query = new URLSearchParams();
      if (filters.from) query.set("from", filters.from);
      if (filters.to) query.set("to", filters.to);
      if (filters.clientId !== "all") query.set("clientId", filters.clientId);
      if (filters.rigId !== "all") query.set("rigId", filters.rigId);
      if (statusFilter !== "all") query.set("status", statusFilter);
      const response = await fetch(`/api/requisitions?${query.toString()}`, {
        cache: "no-store"
      });
      const payload = (await response.json().catch(() => null)) as
        | { data?: RequisitionRow[]; message?: string }
        | null;
      if (!response.ok) {
        throw new Error(payload?.message || "Failed to load requisitions.");
      }
      setRows(Array.isArray(payload?.data) ? payload.data : []);
    } catch (loadError) {
      setRows([]);
      setError(
        loadError instanceof Error ? loadError.message : "Failed to load requisitions."
      );
    } finally {
      setLoading(false);
    }
  }, [filters.clientId, filters.from, filters.rigId, filters.to, statusFilter]);

  useEffect(() => {
    void loadRequisitions();
  }, [loadRequisitions]);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/maintenance-requests?status=SUBMITTED", { cache: "no-store" })
      .then(async (response) => {
        const payload = (await response.json().catch(() => null)) as
          | {
              data?: Array<{
                id: string;
                requestCode?: string;
                rigId?: string;
              }>;
            }
          | null;
        if (!response.ok || cancelled) {
          return;
        }
        const mapped = Array.isArray(payload?.data)
          ? payload.data.map((entry) => ({
              id: entry.id,
              requestCode: entry.requestCode || entry.id,
              rigId: entry.rigId || ""
            }))
          : [];
        setMaintenanceOptions(mapped);
      })
      .catch(() => {
        if (!cancelled) {
          setMaintenanceOptions([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const validateStep = useCallback(
    (step: RequisitionWizardStep) => {
      if (step === 1 && !form.type) {
        return "Choose a requisition type to continue.";
      }
      if (step === 2) {
        if (form.type === "LIVE_PROJECT_PURCHASE" && !form.liveProjectSpendType) {
          return "Choose Breakdown or Normal expense to continue.";
        }
      }
      if (step === 3) {
        if (form.type === "LIVE_PROJECT_PURCHASE" && !form.projectId) {
          return "Live project purchase requisitions require a project.";
        }
        if (form.type === "MAINTENANCE_PURCHASE" && !form.rigId) {
          return "Maintenance purchase requisitions require a rig.";
        }
      }
      if (step === 4 && validLineItems.length === 0) {
        return "Add at least one valid line item with quantity and estimated unit cost.";
      }
      if (step === 4 && !form.category.trim()) {
        return "Category is required.";
      }
      return null;
    },
    [form, validLineItems.length]
  );

  function continueWizard() {
    const validationError = validateStep(wizardStep);
    if (validationError) {
      setError(validationError);
      return;
    }
    setError(null);
    setWizardStep((current) => Math.min(5, current + 1) as RequisitionWizardStep);
  }

  function backWizard() {
    setError(null);
    setWizardStep((current) => Math.max(1, current - 1) as RequisitionWizardStep);
  }

  function restartWizard() {
    setForm(createInitialFormState());
    setWizardStep(1);
    setError(null);
  }

  const createRequisition = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setError(null);
      setNotice(null);

      if (wizardStep !== 5) {
        setWizardStep(5);
        setError("Review the requisition, then click Submit Requisition to continue.");
        return;
      }

      for (const step of [1, 2, 3, 4] as RequisitionWizardStep[]) {
        const validationError = validateStep(step);
        if (validationError) {
          setWizardStep(step);
          setError(validationError);
          return;
        }
      }

      setSaving(true);
      try {
        const response = await fetch("/api/requisitions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: form.type,
            liveProjectSpendType:
              form.type === "LIVE_PROJECT_PURCHASE" ? form.liveProjectSpendType : null,
            clientId: form.clientId || null,
            projectId: form.projectId || null,
            rigId: form.rigId || null,
            maintenanceRequestId: form.maintenanceRequestId || null,
            category: form.category,
            subcategory: form.subcategory || null,
            requestedVendorName: form.requestedVendorName || null,
            notes: form.notes || null,
            lineItems: validLineItems
          })
        });

        const payload = (await response.json().catch(() => null)) as
          | { message?: string }
          | null;
        if (!response.ok) {
          throw new Error(payload?.message || "Failed to create requisition.");
        }

        setNotice(
          "Purchase request submitted. Next step is manager approval, then receipt/purchase posting."
        );
        setForm(createInitialFormState());
        setWizardStep(1);
        await loadRequisitions();
        if (onWorkflowChanged) {
          await onWorkflowChanged();
        }
      } catch (submitError) {
        setError(
          submitError instanceof Error
            ? submitError.message
            : "Failed to create requisition."
        );
      } finally {
        setSaving(false);
      }
    },
    [form, loadRequisitions, onWorkflowChanged, validLineItems, validateStep, wizardStep]
  );

  const requisitionRows = useMemo(
    () =>
      rows.map((row) => {
        const receiptUrl = buildReceiptIntakeHref(row);
        const summary = buildRequisitionRowSummary({
          row,
          projects,
          rigs
        });
        return [
          row.requisitionCode,
          <StatusChip key={`${row.id}-status`} status={row.status} />,
          <div key={`${row.id}-summary`} className="space-y-0.5 text-xs">
            <p className="font-semibold text-slate-800">{summary.primary}</p>
            <p className="text-slate-600">{summary.context}</p>
            <p className="text-slate-600">{summary.items}</p>
          </div>,
          formatCurrency(row.totals.estimatedTotalCost),
          formatIsoDate(row.submittedAt),
          <div key={`${row.id}-actions`} className="flex max-w-[320px] flex-wrap gap-2">
            {row.status === "APPROVED" && (
              <Link
                href={receiptUrl}
                className="rounded-md border border-brand-300 bg-brand-50 px-2 py-1 text-xs font-semibold text-brand-800 hover:bg-brand-100"
              >
                Continue to receipt follow-up
              </Link>
            )}
            {row.status === "PURCHASE_COMPLETED" && (
              <span className="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700">
                Posted
              </span>
            )}
            {row.status === "SUBMITTED" && (
              <span className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-800">
                Pending approval
              </span>
            )}
            {row.status === "REJECTED" && (
              <span className="rounded-md border border-rose-200 bg-rose-50 px-2 py-1 text-xs font-semibold text-rose-700">
                Rejected
              </span>
            )}
          </div>
        ];
      }),
    [projects, rigs, rows]
  );
  const currentStepError = validateStep(wizardStep);

  return (
    <section id="expenses-requisition-workflow" className="space-y-4">
      {notice && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {notice}
        </div>
      )}
      {error && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
          {error}
        </div>
      )}

      <Card
        title="Create Purchase Request"
        subtitle="Guided requisition flow: type → purchase path → context → item details → review"
      >
        <div className="mb-4 grid gap-2 text-xs sm:grid-cols-2 xl:grid-cols-5">
          {([
            { step: 1, label: "Choose Type" },
            { step: 2, label: "Purchase Path" },
            { step: 3, label: "Operational Context" },
            { step: 4, label: "Item Details" },
            { step: 5, label: "Review & Submit" }
          ] as Array<{ step: RequisitionWizardStep; label: string }>).map((entry) => (
            <div
              key={entry.step}
              className={`rounded-lg border px-2 py-1.5 ${
                wizardStep === entry.step
                  ? "border-brand-300 bg-brand-50 text-brand-900"
                  : "border-slate-200 bg-slate-50 text-slate-700"
              }`}
            >
              <p className="font-semibold">Step {entry.step}</p>
              <p>{entry.label}</p>
            </div>
          ))}
        </div>
        <p className="mb-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
          Purchasing workflow: requisition submission is an estimate only. Real posted cost happens after approved purchase receipt completion.
        </p>

        <form onSubmit={createRequisition} className="space-y-4">
          {wizardStep === 1 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Step 1 — Choose Requisition Type
              </p>
              <div className="grid gap-2 md:grid-cols-3">
                <button
                  type="button"
                  onClick={() =>
                    setForm((current) => ({
                      ...current,
                      type: "LIVE_PROJECT_PURCHASE",
                      liveProjectSpendType: "",
                      projectId: "",
                      rigId: "",
                      maintenanceRequestId: ""
                    }))
                  }
                  className={`rounded-lg border px-3 py-3 text-left text-sm ${
                    form.type === "LIVE_PROJECT_PURCHASE"
                      ? "border-brand-300 bg-brand-50 text-brand-900"
                      : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  <p className="font-semibold">Live Project</p>
                  <p className="mt-1 text-xs text-slate-600">Project-linked purchase that will flow into project cost after posting.</p>
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setForm((current) => ({
                      ...current,
                      type: "INVENTORY_STOCK_UP",
                      liveProjectSpendType: "",
                      projectId: "",
                      rigId: "",
                      maintenanceRequestId: ""
                    }))
                  }
                  className={`rounded-lg border px-3 py-3 text-left text-sm ${
                    form.type === "INVENTORY_STOCK_UP"
                      ? "border-brand-300 bg-brand-50 text-brand-900"
                      : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  <p className="font-semibold">Inventory Stock-up</p>
                  <p className="mt-1 text-xs text-slate-600">Inventory replenishment with no required live project linkage.</p>
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setForm((current) => ({
                      ...current,
                      type: "MAINTENANCE_PURCHASE",
                      liveProjectSpendType: "",
                      projectId: ""
                    }))
                  }
                  className={`rounded-lg border px-3 py-3 text-left text-sm ${
                    form.type === "MAINTENANCE_PURCHASE"
                      ? "border-brand-300 bg-brand-50 text-brand-900"
                      : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  <p className="font-semibold">Maintenance (Non-live / Idle Rig)</p>
                  <p className="mt-1 text-xs text-slate-600">Rig repair or maintenance purchase outside active live-project scope.</p>
                </button>
              </div>
            </div>
          )}

          {wizardStep === 2 && (
            <div className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Step 2 — Choose Purchase Path
              </p>
              {form.type === "LIVE_PROJECT_PURCHASE" ? (
                <div className="grid gap-2 md:grid-cols-2">
                  <button
                    type="button"
                    onClick={() =>
                      setForm((current) => ({ ...current, liveProjectSpendType: "BREAKDOWN" }))
                    }
                    className={`rounded-lg border px-3 py-3 text-left text-sm ${
                      form.liveProjectSpendType === "BREAKDOWN"
                        ? "border-brand-300 bg-brand-50 text-brand-900"
                        : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                    }`}
                  >
                    <p className="font-semibold">Breakdown</p>
                    <p className="mt-1 text-xs text-slate-600">
                      Urgent purchase to recover active drilling performance.
                    </p>
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setForm((current) => ({
                        ...current,
                        liveProjectSpendType: "NORMAL_EXPENSE"
                      }))
                    }
                    className={`rounded-lg border px-3 py-3 text-left text-sm ${
                      form.liveProjectSpendType === "NORMAL_EXPENSE"
                        ? "border-brand-300 bg-brand-50 text-brand-900"
                        : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                    }`}
                  >
                    <p className="font-semibold">Normal Expense</p>
                    <p className="mt-1 text-xs text-slate-600">
                      Planned project purchase that is not breakdown-driven.
                    </p>
                  </button>
                </div>
              ) : (
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                  {form.type === "INVENTORY_STOCK_UP"
                    ? "Inventory stock-up selected. Continue to choose business context."
                    : "Maintenance purchase selected. Continue to choose rig context."}
                </div>
              )}
            </div>
          )}

          {wizardStep === 3 && (
            <div className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Step 3 — Select Operational Context
              </p>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <SelectInput
                  label="Client"
                  value={form.clientId}
                  onChange={(value) =>
                    setForm((current) => ({
                      ...current,
                      clientId: value,
                      projectId:
                        value &&
                        current.projectId &&
                        !projects.some((project) => project.id === current.projectId && project.clientId === value)
                          ? ""
                          : current.projectId
                    }))
                  }
                  options={[
                    { value: "", label: "No client" },
                    ...clients.map((client) => ({ value: client.id, label: client.name }))
                  ]}
                />
                <SelectInput
                  label={form.type === "INVENTORY_STOCK_UP" ? "Project (not required)" : "Project"}
                  value={form.projectId}
                  onChange={(value) => {
                    const selectedProject = projects.find((project) => project.id === value);
                    setForm((current) => ({
                      ...current,
                      projectId: value,
                      clientId: selectedProject?.clientId || current.clientId,
                      rigId: selectedProject?.assignedRigId || current.rigId
                    }));
                  }}
                  disabled={form.type === "INVENTORY_STOCK_UP"}
                  options={[
                    {
                      value: "",
                      label:
                        form.type === "LIVE_PROJECT_PURCHASE"
                          ? "Select project (required)"
                          : "No project"
                    },
                    ...filteredProjects.map((project) => ({
                      value: project.id,
                      label: project.name
                    }))
                  ]}
                />
                <SelectInput
                  label={form.type === "MAINTENANCE_PURCHASE" ? "Rig (required)" : "Rig"}
                  value={form.rigId}
                  onChange={(value) => setForm((current) => ({ ...current, rigId: value }))}
                  options={[
                    {
                      value: "",
                      label:
                        form.type === "MAINTENANCE_PURCHASE"
                          ? "Select rig (required)"
                          : "No rig"
                    },
                    ...rigs.map((rig) => ({ value: rig.id, label: rig.name }))
                  ]}
                />
                {form.type === "MAINTENANCE_PURCHASE" && (
                  <SelectInput
                    label="Maintenance Request (optional)"
                    value={form.maintenanceRequestId}
                    onChange={(value) =>
                      setForm((current) => ({ ...current, maintenanceRequestId: value }))
                    }
                    options={[
                      { value: "", label: "No maintenance request" },
                      ...filteredMaintenanceOptions.map((option) => ({
                        value: option.id,
                        label: option.requestCode
                      }))
                    ]}
                  />
                )}
              </div>
              {form.type === "LIVE_PROJECT_PURCHASE" && form.projectId && (
                <p className="text-xs text-slate-600">
                  Project context auto-fills known client and primary rig where available.
                </p>
              )}
            </div>
          )}

          {wizardStep === 4 && (
            <div className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Step 4 — Enter Item Details
              </p>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <TextInput
                  label="Expense Category"
                  value={form.category}
                  onChange={(value) => setForm((current) => ({ ...current, category: value }))}
                  required
                />
                <TextInput
                  label="Subcategory"
                  value={form.subcategory}
                  onChange={(value) => setForm((current) => ({ ...current, subcategory: value }))}
                />
                <TextInput
                  label="Preferred Vendor (optional)"
                  value={form.requestedVendorName}
                  onChange={(value) =>
                    setForm((current) => ({ ...current, requestedVendorName: value }))
                  }
                />
              </div>
              <label className="text-sm text-ink-700">
                <span className="mb-1 block">Reason / Notes (optional)</span>
                <textarea
                  value={form.notes}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, notes: event.target.value }))
                  }
                  className="w-full rounded-lg border border-slate-200 px-3 py-2"
                  placeholder="Explain operational need, urgency, and expected impact."
                />
              </label>
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                <div className="space-y-2">
                  {form.lines.map((line) => (
                    <div key={line.id} className="grid gap-2 rounded border border-slate-200 bg-white p-2 md:grid-cols-12">
                      <input
                        value={line.description}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            lines: current.lines.map((entry) =>
                              entry.id === line.id
                                ? { ...entry, description: event.target.value }
                                : entry
                            )
                          }))
                        }
                        placeholder="Description"
                        className="rounded border border-slate-200 px-2 py-1 text-sm md:col-span-5"
                      />
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={line.quantity}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            lines: current.lines.map((entry) =>
                              entry.id === line.id
                                ? { ...entry, quantity: event.target.value }
                                : entry
                            )
                          }))
                        }
                        placeholder="Qty"
                        className="rounded border border-slate-200 px-2 py-1 text-sm md:col-span-2"
                      />
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={line.estimatedUnitCost}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            lines: current.lines.map((entry) =>
                              entry.id === line.id
                                ? { ...entry, estimatedUnitCost: event.target.value }
                                : entry
                            )
                          }))
                        }
                        placeholder="Est. unit cost"
                        className="rounded border border-slate-200 px-2 py-1 text-sm md:col-span-2"
                      />
                      <input
                        value={line.notes}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            lines: current.lines.map((entry) =>
                              entry.id === line.id ? { ...entry, notes: event.target.value } : entry
                            )
                          }))
                        }
                        placeholder="Line note (optional)"
                        className="rounded border border-slate-200 px-2 py-1 text-sm md:col-span-2"
                      />
                      <button
                        type="button"
                        onClick={() =>
                          setForm((current) => ({
                            ...current,
                            lines:
                              current.lines.length <= 1
                                ? current.lines
                                : current.lines.filter((entry) => entry.id !== line.id)
                          }))
                        }
                        className="rounded border border-red-200 px-2 py-1 text-xs text-red-700 hover:bg-red-50 md:col-span-1"
                        disabled={form.lines.length <= 1}
                      >
                        Remove
                      </button>
                      <p className="text-xs text-slate-600 md:col-span-12">
                        Line amount:{" "}
                        <span className="font-semibold">
                          {formatCurrency(
                            Math.max(0, Number(line.quantity) || 0) *
                              Math.max(0, Number(line.estimatedUnitCost) || 0)
                          )}
                        </span>
                      </p>
                    </div>
                  ))}
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      setForm((current) => ({
                        ...current,
                        lines: [...current.lines, initialFormLine()]
                      }))
                    }
                    className="rounded border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                  >
                    Add line item
                  </button>
                  <p className="text-xs text-slate-700">
                    Estimated requisition total:{" "}
                    <span className="font-semibold">{formatCurrency(estimatedTotal)}</span>
                  </p>
                </div>
              </div>
            </div>
          )}

          {wizardStep === 5 && (
            <div className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Step 5 — Review and Submit
              </p>
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                <p>
                  <span className="font-semibold">Type:</span> {formatRequisitionType(form.type)}
                </p>
                {form.type === "LIVE_PROJECT_PURCHASE" && (
                  <p>
                    <span className="font-semibold">Live project path:</span>{" "}
                    {formatLiveProjectSpendType(form.liveProjectSpendType)}
                  </p>
                )}
                <p>
                  <span className="font-semibold">Client:</span>{" "}
                  {clients.find((entry) => entry.id === form.clientId)?.name || "-"}
                </p>
                <p>
                  <span className="font-semibold">Project:</span>{" "}
                  {projects.find((entry) => entry.id === form.projectId)?.name || "-"}
                </p>
                <p>
                  <span className="font-semibold">Rig:</span>{" "}
                  {rigs.find((entry) => entry.id === form.rigId)?.name || "-"}
                </p>
                <p>
                  <span className="font-semibold">Category:</span> {form.category || "-"}
                  {form.subcategory ? ` / ${form.subcategory}` : ""}
                </p>
                <p>
                  <span className="font-semibold">Preferred Vendor:</span>{" "}
                  {form.requestedVendorName.trim() || "-"}
                </p>
                <p>
                  <span className="font-semibold">Reason:</span>{" "}
                  {form.notes.trim() || "-"}
                </p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white">
                <DataTable
                  columns={["Description", "Qty", "Est. Unit Cost", "Est. Total", "Notes"]}
                  rows={validLineItems.map((line) => [
                    line.description,
                    line.quantity,
                    formatCurrency(line.estimatedUnitCost),
                    formatCurrency(line.estimatedTotalCost),
                    line.notes || "-"
                  ])}
                />
              </div>
              <p className="text-xs text-slate-700">
                Estimated total request value:{" "}
                <span className="font-semibold">{formatCurrency(estimatedTotal)}</span>
              </p>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2 border-t border-slate-200 pt-3">
            {wizardStep > 1 && (
              <button
                type="button"
                onClick={backWizard}
                className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
              >
                Back
              </button>
            )}
            {wizardStep < 5 ? (
              <button
                type="button"
                onClick={continueWizard}
                disabled={Boolean(currentStepError)}
                className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Continue
              </button>
            ) : (
              <button
                type="submit"
                disabled={saving}
                className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
              >
                {saving ? "Submitting..." : "Submit Requisition"}
              </button>
            )}
            <button
              type="button"
              onClick={restartWizard}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
            >
              Restart
            </button>
            {wizardStep < 5 && currentStepError && (
              <p className="text-xs text-amber-800">{currentStepError}</p>
            )}
          </div>
        </form>
      </Card>

      <details open className="rounded-xl border border-slate-200 bg-white">
        <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-slate-800">
          Requisition History
        </summary>
        <div className="space-y-3 border-t border-slate-200 p-4">
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-700">
            <span className="rounded-full border border-amber-300 bg-amber-100 px-2 py-0.5 font-semibold text-amber-800">
              Pending approval: {pendingCount}
            </span>
            <span className="rounded-full border border-indigo-300 bg-indigo-100 px-2 py-0.5 font-semibold text-indigo-800">
              Approved, awaiting receipt: {approvedReadyCount}
            </span>
            <span className="rounded-full border border-emerald-300 bg-emerald-100 px-2 py-0.5 font-semibold text-emerald-800">
              Posted cost complete: {completedCount}
            </span>
            <label className="ml-auto flex items-center gap-2">
              <span className="uppercase tracking-wide text-slate-500">Status</span>
              <select
                value={statusFilter}
                onChange={(event) =>
                  setStatusFilter(
                    event.target.value === "all"
                      ? "all"
                      : (event.target.value as RequisitionStatus)
                  )
                }
                className="rounded border border-slate-300 bg-white px-2 py-1 text-xs"
              >
                <option value="all">All</option>
                <option value="SUBMITTED">Submitted</option>
                <option value="APPROVED">Approved</option>
                <option value="REJECTED">Rejected</option>
                <option value="PURCHASE_COMPLETED">Purchase completed</option>
              </select>
            </label>
          </div>
          {loading ? (
            <p className="text-sm text-slate-600">Loading requisitions...</p>
          ) : rows.length === 0 ? (
            <p className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-3 text-sm text-slate-700">
              No requisitions found for the selected filters.
            </p>
          ) : (
            <DataTable
              columns={[
                "Requisition",
                "Status",
                "Summary",
                "Estimated",
                "Submitted",
                "Actions"
              ]}
              rows={requisitionRows}
            />
          )}
        </div>
      </details>
    </section>
  );
}

function SelectInput({
  label,
  value,
  onChange,
  options,
  disabled = false
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  disabled?: boolean;
}) {
  return (
    <label className="text-sm text-ink-700">
      <span className="mb-1 block">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        className="w-full rounded-lg border border-slate-200 px-3 py-2 disabled:bg-slate-100"
      >
        {options.map((option) => (
          <option key={`${label}-${option.value}`} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function TextInput({
  label,
  value,
  onChange,
  required = false
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
}) {
  return (
    <label className="text-sm text-ink-700">
      <span className="mb-1 block">{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        required={required}
        className="w-full rounded-lg border border-slate-200 px-3 py-2"
      />
    </label>
  );
}

function buildRequisitionRowSummary({
  row,
  projects,
  rigs
}: {
  row: RequisitionRow;
  projects: Array<{ id: string; name: string }>;
  rigs: Array<{ id: string; name: string }>;
}) {
  const typeLabel = formatRequisitionType(row.type);
  const pathLabel =
    row.type === "LIVE_PROJECT_PURCHASE" ? formatLiveProjectSpendType(row.liveProjectSpendType) : "";
  const projectName = row.context.projectId ? lookupProjectName(projects, row.context.projectId) : "";
  const rigName = row.context.rigId ? lookupRigName(rigs, row.context.rigId) : "";
  const firstLine = row.lineItems[0]?.description?.trim() || "";
  const extraLines = Math.max(0, row.lineItems.length - 1);

  return {
    primary: pathLabel && pathLabel !== "-" ? `${typeLabel} • ${pathLabel}` : typeLabel,
    context:
      [projectName ? `Project: ${projectName}` : "", rigName ? `Rig: ${rigName}` : ""]
        .filter(Boolean)
        .join(" • ") || "No linked project/rig context",
    items: firstLine
      ? `${firstLine}${extraLines > 0 ? ` +${extraLines} more item${extraLines > 1 ? "s" : ""}` : ""}`
      : `${row.category}${row.subcategory ? ` / ${row.subcategory}` : ""}`
  };
}

function formatRequisitionType(type: RequisitionType | "") {
  if (!type) return "-";
  if (type === "LIVE_PROJECT_PURCHASE") return "Live project purchase";
  if (type === "MAINTENANCE_PURCHASE") return "Maintenance purchase";
  return "Stock / warehouse purchase";
}

function formatLiveProjectSpendType(
  spendType: LiveProjectSpendType | "" | null | undefined
) {
  if (spendType === "BREAKDOWN") {
    return "Breakdown";
  }
  if (spendType === "NORMAL_EXPENSE") {
    return "Normal expense";
  }
  return "-";
}

function lookupProjectName(
  projects: Array<{ id: string; name: string }>,
  projectId: string
) {
  return projects.find((project) => project.id === projectId)?.name || projectId;
}

function lookupRigName(rigs: Array<{ id: string; name: string }>, rigId: string) {
  return rigs.find((rig) => rig.id === rigId)?.name || rigId;
}

function formatIsoDate(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value || "-";
  }
  return parsed.toISOString().slice(0, 10);
}

function buildReceiptIntakeHref(row: RequisitionRow) {
  const query = new URLSearchParams();
  query.set("requisitionId", row.id);
  query.set("requisitionCode", row.requisitionCode);
  query.set("requisitionType", row.type);
  if (row.context.clientId) {
    query.set("clientId", row.context.clientId);
  }
  if (row.context.projectId) {
    query.set("projectId", row.context.projectId);
  }
  if (row.context.rigId) {
    query.set("rigId", row.context.rigId);
  }
  if (row.context.maintenanceRequestId) {
    query.set("maintenanceRequestId", row.context.maintenanceRequestId);
  }
  return `/purchasing/receipt-follow-up?${query.toString()}`;
}

function StatusChip({ status }: { status: RequisitionStatus }) {
  const style =
    status === "PURCHASE_COMPLETED"
      ? "border-emerald-300 bg-emerald-100 text-emerald-800"
      : status === "APPROVED"
        ? "border-indigo-300 bg-indigo-100 text-indigo-800"
        : status === "REJECTED"
          ? "border-red-300 bg-red-100 text-red-800"
          : "border-amber-300 bg-amber-100 text-amber-800";
  return (
    <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${style}`}>
      {status === "PURCHASE_COMPLETED"
        ? "Posted cost"
        : status.charAt(0) + status.slice(1).toLowerCase()}
    </span>
  );
}
