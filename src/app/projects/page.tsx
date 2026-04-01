"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { AccessGate } from "@/components/layout/access-gate";
import { FilterScopeBanner, hasActiveScopeFilters } from "@/components/layout/filter-scope-banner";
import { useAnalyticsFilters } from "@/components/layout/analytics-filters-provider";
import { Card, MetricCard } from "@/components/ui/card";
import { DataTable } from "@/components/ui/table";
import { formatCurrency, formatNumber } from "@/lib/utils";

interface ClientOption {
  id: string;
  name: string;
}

interface RigOption {
  id: string;
  rigCode: string;
}

interface ProjectRecord {
  id: string;
  name: string;
  location: string;
  startDate: string;
  endDate: string | null;
  status: string;
  contractRatePerM: number;
  clientId: string;
  assignedRigId: string | null;
  backupRigId: string | null;
  description: string | null;
  photoUrl: string | null;
  client: { id: string; name: string };
  assignedRig: { id: string; rigCode: string } | null;
  backupRig: { id: string; rigCode: string } | null;
}

const emptyForm = {
  id: "",
  name: "",
  clientId: "",
  location: "",
  description: "",
  photoUrl: "",
  startDate: "",
  endDate: "",
  status: "PLANNED",
  contractRatePerM: "0",
  assignedRigId: "",
  backupRigId: ""
};

export default function ProjectsPage() {
  const { filters } = useAnalyticsFilters();
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [rigs, setRigs] = useState<RigOption[]>([]);
  const [projectRevenueMap, setProjectRevenueMap] = useState<Map<string, number>>(new Map());
  const [projectExpenseMap, setProjectExpenseMap] = useState<Map<string, number>>(new Map());
  const [projectMetersMap, setProjectMetersMap] = useState<Map<string, number>>(new Map());
  const [form, setForm] = useState(emptyForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const search = new URLSearchParams();
      if (filters.from) search.set("from", filters.from);
      if (filters.to) search.set("to", filters.to);
      if (filters.clientId !== "all") search.set("clientId", filters.clientId);
      if (filters.rigId !== "all") search.set("rigId", filters.rigId);
      const query = search.toString();

      const [projectsRes, clientsRes, rigsRes] = await Promise.all([
        fetch(`/api/projects${query ? `?${query}` : ""}`, { cache: "no-store" }),
        fetch(`/api/clients${query ? `?${query}` : ""}`, { cache: "no-store" }),
        fetch(`/api/rigs${query ? `?${query}` : ""}`, { cache: "no-store" })
      ]);

      const [projectsPayload, clientsPayload, rigsPayload] = await Promise.all([
        projectsRes.json(),
        clientsRes.json(),
        rigsRes.json()
      ]);

      setProjects(projectsPayload.data || []);
      setClients((clientsPayload.data || []).map((entry: { id: string; name: string }) => ({ id: entry.id, name: entry.name })));
      setRigs((rigsPayload.data || []).map((entry: { id: string; rigCode: string }) => ({ id: entry.id, rigCode: entry.rigCode })));

      const [revenueRes, expensesRes, drillingRes] = await Promise.all([
        fetch(`/api/revenue/summary${query ? `?${query}` : ""}`, { cache: "no-store" }),
        fetch(`/api/expenses/analytics${query ? `?${query}` : ""}`, { cache: "no-store" }),
        fetch(`/api/drilling-reports${query ? `?${query}` : ""}`, { cache: "no-store" })
      ]);

      if (revenueRes.ok) {
        const revenuePayload = await revenueRes.json().catch(() => null);
        const revenueByProject = Array.isArray(revenuePayload?.revenueByProject)
          ? revenuePayload.revenueByProject
          : [];
        setProjectRevenueMap(
          new Map(
            revenueByProject.map((entry: { id?: string; revenue?: number }) => [
              entry.id || "",
              Number(entry.revenue || 0)
            ])
          )
        );
      } else {
        setProjectRevenueMap(new Map());
      }

      if (expensesRes.ok) {
        const expensesPayload = await expensesRes.json().catch(() => null);
        const expensesByProject = Array.isArray(expensesPayload?.expensesByProject)
          ? expensesPayload.expensesByProject
          : [];
        setProjectExpenseMap(
          new Map(
            expensesByProject.map((entry: { id?: string; amount?: number }) => [
              entry.id || "",
              Number(entry.amount || 0)
            ])
          )
        );
      } else {
        setProjectExpenseMap(new Map());
      }

      if (drillingRes.ok) {
        const drillingPayload = await drillingRes.json().catch(() => null);
        const reports = Array.isArray(drillingPayload?.data) ? drillingPayload.data : [];
        const metersMap = new Map<string, number>();
        for (const report of reports) {
          if (
            !report ||
            typeof report.projectId !== "string" ||
            (report.approvalStatus !== "APPROVED" && report.approvalStatus !== "SUBMITTED")
          ) {
            continue;
          }
          const projectId = report.projectId;
          const meters = Number(report.totalMetersDrilled || 0);
          metersMap.set(projectId, (metersMap.get(projectId) || 0) + meters);
        }
        setProjectMetersMap(metersMap);
      } else {
        setProjectMetersMap(new Map());
      }
    } finally {
      setLoading(false);
    }
  }, [filters.clientId, filters.from, filters.rigId, filters.to]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const selectedClientName = useMemo(() => {
    if (filters.clientId === "all") {
      return null;
    }
    return clients.find((client) => client.id === filters.clientId)?.name || null;
  }, [clients, filters.clientId]);
  const selectedRigName = useMemo(() => {
    if (filters.rigId === "all") {
      return null;
    }
    return rigs.find((rig) => rig.id === filters.rigId)?.rigCode || null;
  }, [filters.rigId, rigs]);
  const isScoped = hasActiveScopeFilters(filters);
  const projectPerformanceRows = useMemo(
    () =>
      projects.map((project) => {
        const revenue = projectRevenueMap.get(project.id) || 0;
        const cost = projectExpenseMap.get(project.id) || 0;
        const profit = revenue - cost;
        const meters = projectMetersMap.get(project.id) || 0;
        const margin = revenue > 0 ? (profit / revenue) * 100 : 0;
        return {
          project,
          revenue,
          cost,
          profit,
          meters,
          margin
        };
      }),
    [projectExpenseMap, projectMetersMap, projectRevenueMap, projects]
  );
  const totals = useMemo(() => {
    let revenue = 0;
    let cost = 0;
    let meters = 0;
    for (const row of projectPerformanceRows) {
      revenue += row.revenue;
      cost += row.cost;
      meters += row.meters;
    }
    const profit = revenue - cost;
    const margin = revenue > 0 ? (profit / revenue) * 100 : 0;
    return { revenue, cost, profit, meters, margin };
  }, [projectPerformanceRows]);
  const activeProjectCount = useMemo(
    () => projects.filter((project) => project.status === "ACTIVE").length,
    [projects]
  );
  const assignedRigCount = useMemo(
    () => projects.filter((project) => Boolean(project.assignedRigId)).length,
    [projects]
  );

  async function saveProject(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    try {
      const isUpdate = Boolean(form.id);
      const response = await fetch(isUpdate ? `/api/projects/${form.id}` : "/api/projects", {
        method: isUpdate ? "PUT" : "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          ...form,
          contractRatePerM: Number(form.contractRatePerM)
        })
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({ message: "Failed to save project." }));
        alert(payload.message || "Failed to save project.");
        return;
      }

      setForm(emptyForm);
      await loadAll();
    } finally {
      setSaving(false);
    }
  }

  async function deleteProject(id: string) {
    if (!window.confirm("Delete this project?")) {
      return;
    }
    const response = await fetch(`/api/projects/${id}`, { method: "DELETE" });
    if (response.ok) {
      await loadAll();
    }
  }

  return (
    <AccessGate permission="projects:view">
      <div className="gf-page-stack">
        <FilterScopeBanner filters={filters} clientLabel={selectedClientName} rigLabel={selectedRigName} />

        <section className="grid gap-3 md:grid-cols-3">
          <MetricCard label={isScoped ? "Projects in Scope" : "Total Projects"} value={String(projects.length)} />
          <MetricCard label="Active Projects" value={String(activeProjectCount)} tone="good" />
          <MetricCard label="Assigned Rigs" value={String(assignedRigCount)} />
        </section>

        <section className="grid gap-3 md:grid-cols-4">
          <MetricCard
            label={isScoped ? "Revenue (Scope)" : "Project Revenue"}
            value={formatCurrency(totals.revenue)}
            tone="good"
          />
          <MetricCard
            label={isScoped ? "Costs (Scope)" : "Project Costs"}
            value={formatCurrency(totals.cost)}
            tone="warn"
          />
          <MetricCard
            label={isScoped ? "Profit (Scope)" : "Project Profit"}
            value={formatCurrency(totals.profit)}
            tone={totals.profit >= 0 ? "good" : "danger"}
          />
          <MetricCard
            label={isScoped ? "Meters (Scope)" : "Meters Drilled"}
            value={formatNumber(totals.meters)}
            change={`${totals.margin.toFixed(1)}% margin`}
          />
        </section>

        <AccessGate permission="projects:manage">
          <Card title={form.id ? "Edit Project" : "Create Project"}>
            <form onSubmit={saveProject} className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
              <Input label="Project Name" value={form.name} onChange={(value) => setForm((current) => ({ ...current, name: value }))} required />
              <Select
                label="Client"
                value={form.clientId}
                onChange={(value) => setForm((current) => ({ ...current, clientId: value }))}
                options={clients.map((client) => ({ value: client.id, label: client.name }))}
                required
              />
              <Input label="Location" value={form.location} onChange={(value) => setForm((current) => ({ ...current, location: value }))} required />
              <Input label="Start Date" type="date" value={form.startDate} onChange={(value) => setForm((current) => ({ ...current, startDate: value }))} required />
              <Input label="End Date" type="date" value={form.endDate} onChange={(value) => setForm((current) => ({ ...current, endDate: value }))} />
              <Select
                label="Status"
                value={form.status}
                onChange={(value) => setForm((current) => ({ ...current, status: value }))}
                options={[
                  { value: "PLANNED", label: "PLANNED" },
                  { value: "ACTIVE", label: "ACTIVE" },
                  { value: "ON_HOLD", label: "ON_HOLD" },
                  { value: "COMPLETED", label: "COMPLETED" }
                ]}
                required
              />
              <Input label="Contract Rate per Meter" type="number" value={form.contractRatePerM} onChange={(value) => setForm((current) => ({ ...current, contractRatePerM: value }))} required />
              <Select
                label="Assigned Rig"
                value={form.assignedRigId}
                onChange={(value) => setForm((current) => ({ ...current, assignedRigId: value }))}
                options={[{ value: "", label: "Unassigned" }, ...rigs.map((rig) => ({ value: rig.id, label: rig.rigCode }))]}
              />
              <Select
                label="Backup Rig"
                value={form.backupRigId}
                onChange={(value) => setForm((current) => ({ ...current, backupRigId: value }))}
                options={[{ value: "", label: "None" }, ...rigs.map((rig) => ({ value: rig.id, label: rig.rigCode }))]}
              />
              <Input label="Photo URL" value={form.photoUrl} onChange={(value) => setForm((current) => ({ ...current, photoUrl: value }))} />
              <label className="text-sm text-ink-700 lg:col-span-3">
                <span className="mb-1 block">Description</span>
                <textarea
                  value={form.description}
                  onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2"
                />
              </label>
              <div className="lg:col-span-3 flex gap-2">
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
                >
                  {saving ? "Saving..." : form.id ? "Update Project" : "Create Project"}
                </button>
                {form.id && (
                  <button
                    type="button"
                    onClick={() => setForm(emptyForm)}
                    className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-ink-700 hover:bg-slate-50"
                  >
                    Cancel Edit
                  </button>
                )}
              </div>
            </form>
          </Card>
        </AccessGate>

        <Card title="Project Register">
          {loading ? (
            <p className="text-sm text-ink-600">Loading projects...</p>
          ) : (
            <DataTable
              columns={["Project", "Client", "Status", "Assigned Rig", "Revenue", "Cost", "Profit", "Meters", "Actions"]}
              rows={projectPerformanceRows.map((row) => [
                <Link key={row.project.id} href={`/projects/${row.project.id}`} className="text-brand-700 underline-offset-2 hover:underline">
                  {row.project.name}
                </Link>,
                row.project.client?.name || "-",
                row.project.status,
                row.project.assignedRig?.rigCode || "-",
                formatCurrency(row.revenue),
                formatCurrency(row.cost),
                <span key={`profit-${row.project.id}`} className={row.profit >= 0 ? "text-emerald-700" : "text-rose-700"}>
                  {formatCurrency(row.profit)}
                </span>,
                formatNumber(row.meters),
                <div key={`actions-${row.project.id}`} className="flex gap-2">
                  <button
                    type="button"
                    className="rounded-md border border-slate-200 px-2 py-1 text-xs text-ink-700 hover:bg-slate-50"
                    onClick={() =>
                      setForm({
                        id: row.project.id,
                        name: row.project.name,
                        clientId: row.project.clientId,
                        location: row.project.location,
                        description: row.project.description || "",
                        photoUrl: row.project.photoUrl || "",
                        startDate: row.project.startDate.slice(0, 10),
                        endDate: row.project.endDate ? row.project.endDate.slice(0, 10) : "",
                        status: row.project.status,
                        contractRatePerM: String(row.project.contractRatePerM),
                        assignedRigId: row.project.assignedRigId || "",
                        backupRigId: row.project.backupRigId || ""
                      })
                    }
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className="rounded-md border border-red-200 px-2 py-1 text-xs text-red-700 hover:bg-red-50"
                    onClick={() => void deleteProject(row.project.id)}
                  >
                    Delete
                  </button>
                </div>
              ])}
            />
          )}
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
  options,
  required = false
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  required?: boolean;
}) {
  return (
    <label className="text-sm text-ink-700">
      <span className="mb-1 block">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        required={required}
        className="w-full rounded-lg border border-slate-200 px-3 py-2"
      >
        <option value="">Select</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
