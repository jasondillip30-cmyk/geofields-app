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

interface EmployeeOption {
  id: string;
  fullName: string;
  role: string;
  isActive: boolean;
}

interface ProjectSetupProfile {
  expectedMeters: number | null;
  contractReferenceUrl: string;
  contractReferenceName: string;
  teamMemberIds: string[];
  teamMemberNames: string[];
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
  budgetAmount?: number | null;
  setupProfile?: Partial<ProjectSetupProfile> | null;
}

type ProjectSetupStep = 1 | 2 | 3 | 4 | 5 | 6;
type ProjectStatusOption = "PLANNED" | "ACTIVE" | "ON_HOLD" | "COMPLETED";
type ClientLinkMode = "EXISTING" | "NEW";
type LocationLinkMode = "EXISTING" | "NEW";

interface ProjectFormState {
  id: string;
  name: string;
  clientMode: ClientLinkMode;
  clientId: string;
  newClientName: string;
  locationMode: LocationLinkMode;
  locationExisting: string;
  locationNew: string;
  startDate: string;
  endDate: string;
  status: ProjectStatusOption;
  statusManuallySet: boolean;
  contractRatePerM: string;
  budgetAmount: string;
  expectedMeters: string;
  contractReferenceUrl: string;
  contractReferenceName: string;
  primaryRigId: string;
  secondaryRigId: string;
  teamMemberIds: string[];
  description: string;
  photoUrl: string;
}

const STEP_LABELS: Array<{ step: ProjectSetupStep; title: string; subtitle: string }> = [
  { step: 1, title: "Client and Location", subtitle: "Define who and where this project belongs." },
  { step: 2, title: "Project Timing", subtitle: "Set schedule and project status." },
  { step: 3, title: "Commercial Setup", subtitle: "Capture rate, budget, and commercial references." },
  { step: 4, title: "Rig Assignment", subtitle: "Assign primary rig and optional backup support." },
  { step: 5, title: "Team Assignment", subtitle: "Attach workers/employees to this project setup." },
  { step: 6, title: "Review and Create", subtitle: "Confirm setup details before saving." }
];

function createEmptyProjectForm(): ProjectFormState {
  return {
    id: "",
    name: "",
    clientMode: "EXISTING",
    clientId: "",
    newClientName: "",
    locationMode: "EXISTING",
    locationExisting: "",
    locationNew: "",
    startDate: "",
    endDate: "",
    status: "PLANNED",
    statusManuallySet: false,
    contractRatePerM: "0",
    budgetAmount: "",
    expectedMeters: "",
    contractReferenceUrl: "",
    contractReferenceName: "",
    primaryRigId: "",
    secondaryRigId: "",
    teamMemberIds: [],
    description: "",
    photoUrl: ""
  };
}

export default function ProjectsPage() {
  const { filters } = useAnalyticsFilters();
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [rigs, setRigs] = useState<RigOption[]>([]);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [projectRevenueMap, setProjectRevenueMap] = useState<Map<string, number>>(new Map());
  const [projectExpenseMap, setProjectExpenseMap] = useState<Map<string, number>>(new Map());
  const [projectMetersMap, setProjectMetersMap] = useState<Map<string, number>>(new Map());
  const [form, setForm] = useState<ProjectFormState>(createEmptyProjectForm);
  const [currentStep, setCurrentStep] = useState<ProjectSetupStep>(1);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formNotice, setFormNotice] = useState<string | null>(null);

  const locationOptions = useMemo(
    () =>
      Array.from(
        new Set(
          projects
            .map((project) => project.location.trim())
            .filter((location) => location.length > 0)
        )
      ).sort((a, b) => a.localeCompare(b)),
    [projects]
  );

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const search = new URLSearchParams();
      if (filters.from) search.set("from", filters.from);
      if (filters.to) search.set("to", filters.to);
      if (filters.clientId !== "all") search.set("clientId", filters.clientId);
      if (filters.rigId !== "all") search.set("rigId", filters.rigId);
      const query = search.toString();

      const [projectsRes, clientsRes, rigsRes, employeesRes] = await Promise.all([
        fetch(`/api/projects${query ? `?${query}` : ""}`, { cache: "no-store" }),
        fetch(`/api/clients${query ? `?${query}` : ""}`, { cache: "no-store" }),
        fetch(`/api/rigs${query ? `?${query}` : ""}`, { cache: "no-store" }),
        fetch("/api/employees", { cache: "no-store" }).catch(() => null)
      ]);

      const [projectsPayload, clientsPayload, rigsPayload] = await Promise.all([
        projectsRes.json(),
        clientsRes.json(),
        rigsRes.json()
      ]);

      setProjects((projectsPayload.data || []) as ProjectRecord[]);
      setClients(
        (clientsPayload.data || []).map((entry: { id: string; name: string }) => ({
          id: entry.id,
          name: entry.name
        }))
      );
      setRigs(
        (rigsPayload.data || []).map((entry: { id: string; rigCode: string }) => ({
          id: entry.id,
          rigCode: entry.rigCode
        }))
      );

      if (employeesRes && employeesRes.ok) {
        const employeesPayload = await employeesRes.json().catch(() => null);
        setEmployees(
          Array.isArray(employeesPayload?.data)
            ? employeesPayload.data.map(
                (entry: { id: string; fullName: string; role: string; isActive: boolean }) => ({
                  id: entry.id,
                  fullName: entry.fullName,
                  role: entry.role,
                  isActive: entry.isActive !== false
                })
              )
            : []
        );
      } else {
        setEmployees([]);
      }

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

  useEffect(() => {
    if (form.statusManuallySet) {
      return;
    }
    const suggestedStatus = deriveStatusFromDates(form.startDate, form.endDate);
    setForm((current) => ({ ...current, status: suggestedStatus }));
  }, [form.endDate, form.startDate, form.statusManuallySet]);

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

  const stepIssues = useMemo(
    () =>
      validateProjectSetupStep({
        form,
        step: currentStep
      }),
    [currentStep, form]
  );

  const reviewSummary = useMemo(() => {
    const resolvedClientName =
      form.clientMode === "NEW"
        ? form.newClientName.trim() || "New client"
        : clients.find((client) => client.id === form.clientId)?.name || "-";
    const resolvedLocation =
      form.locationMode === "NEW"
        ? form.locationNew.trim()
        : form.locationExisting.trim();
    const primaryRig = rigs.find((rig) => rig.id === form.primaryRigId)?.rigCode || "-";
    const secondaryRig = rigs.find((rig) => rig.id === form.secondaryRigId)?.rigCode || "-";
    const selectedTeam = employees.filter((employee) =>
      form.teamMemberIds.includes(employee.id)
    );
    return {
      clientName: resolvedClientName,
      location: resolvedLocation || "-",
      status: form.status,
      primaryRig,
      secondaryRig,
      team: selectedTeam
    };
  }, [
    clients,
    employees,
    form.clientId,
    form.clientMode,
    form.locationExisting,
    form.locationMode,
    form.locationNew,
    form.newClientName,
    form.primaryRigId,
    form.secondaryRigId,
    form.status,
    form.teamMemberIds,
    rigs
  ]);

  function resetFormState() {
    setForm(createEmptyProjectForm());
    setCurrentStep(1);
    setFormError(null);
  }

  function applyEditProject(project: ProjectRecord) {
    const setupProfile = normalizeSetupProfile(project.setupProfile);
    const locationExists = locationOptions.includes(project.location);
    setForm({
      id: project.id,
      name: project.name,
      clientMode: "EXISTING",
      clientId: project.clientId,
      newClientName: "",
      locationMode: locationExists ? "EXISTING" : "NEW",
      locationExisting: locationExists ? project.location : "",
      locationNew: locationExists ? "" : project.location,
      startDate: project.startDate.slice(0, 10),
      endDate: project.endDate ? project.endDate.slice(0, 10) : "",
      status: normalizeProjectStatus(project.status),
      statusManuallySet: true,
      contractRatePerM: String(project.contractRatePerM),
      budgetAmount:
        typeof project.budgetAmount === "number" && Number.isFinite(project.budgetAmount)
          ? String(project.budgetAmount)
          : "",
      expectedMeters:
        setupProfile.expectedMeters !== null ? String(setupProfile.expectedMeters) : "",
      contractReferenceUrl: setupProfile.contractReferenceUrl,
      contractReferenceName: setupProfile.contractReferenceName,
      primaryRigId: project.assignedRigId || "",
      secondaryRigId: project.backupRigId || "",
      teamMemberIds: setupProfile.teamMemberIds,
      description: project.description || "",
      photoUrl: project.photoUrl || ""
    });
    setCurrentStep(1);
    setFormError(null);
    setFormNotice(`Editing project: ${project.name}`);
  }

  function moveStep(direction: "next" | "back") {
    setFormError(null);
    if (direction === "back") {
      setCurrentStep((current) => (current <= 1 ? 1 : ((current - 1) as ProjectSetupStep)));
      return;
    }
    if (stepIssues.length > 0) {
      setFormError(stepIssues[0]);
      return;
    }
    setCurrentStep((current) => (current >= 6 ? 6 : ((current + 1) as ProjectSetupStep)));
  }

  async function createClientIfNeeded() {
    if (form.clientMode !== "NEW") {
      return form.clientId;
    }
    const newClientName = form.newClientName.trim();
    if (!newClientName) {
      throw new Error("Enter a client name or switch to an existing client.");
    }
    const response = await fetch("/api/clients", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        name: newClientName
      })
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      throw new Error(payload?.message || "Unable to create client.");
    }
    const payload = await response.json().catch(() => null);
    const createdClientId = typeof payload?.data?.id === "string" ? payload.data.id : "";
    if (!createdClientId) {
      throw new Error("Client was created but the response was incomplete.");
    }
    return createdClientId;
  }

  async function saveProject(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setFormNotice(null);

    const finalStepIssues = validateProjectSetupStep({
      form,
      step: 6
    });
    if (finalStepIssues.length > 0) {
      setCurrentStep(6);
      setFormError(finalStepIssues[0]);
      return;
    }

    setSaving(true);
    try {
      const clientId = await createClientIfNeeded();
      const location =
        form.locationMode === "NEW"
          ? form.locationNew.trim()
          : form.locationExisting.trim();
      const statusToSave =
        form.statusManuallySet
          ? form.status
          : deriveStatusFromDates(form.startDate, form.endDate);
      const selectedTeam = employees.filter((employee) =>
        form.teamMemberIds.includes(employee.id)
      );
      const payload = {
        name: form.name.trim(),
        clientId,
        location,
        description: form.description.trim() || null,
        photoUrl: form.photoUrl.trim() || null,
        startDate: form.startDate,
        endDate: form.endDate || null,
        status: statusToSave,
        contractRatePerM: Number(form.contractRatePerM),
        assignedRigId: form.primaryRigId || null,
        backupRigId: form.secondaryRigId || null,
        budgetAmount: parseOptionalPositive(form.budgetAmount),
        setupProfile: {
          expectedMeters: parseOptionalPositive(form.expectedMeters),
          contractReferenceUrl: form.contractReferenceUrl.trim(),
          contractReferenceName: form.contractReferenceName.trim(),
          teamMemberIds: form.teamMemberIds,
          teamMemberNames: selectedTeam.map((employee) => employee.fullName)
        }
      };
      const isUpdate = Boolean(form.id);
      const response = await fetch(isUpdate ? `/api/projects/${form.id}` : "/api/projects", {
        method: isUpdate ? "PUT" : "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const failedPayload = await response.json().catch(() => null);
        setFormError(
          failedPayload?.message || "Failed to save project setup. Review the required fields and retry."
        );
        return;
      }

      resetFormState();
      await loadAll();
      setFormNotice(isUpdate ? "Project updated successfully." : "Project created successfully.");
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Failed to save project.");
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
      setFormNotice("Project deleted.");
    } else {
      setFormError("Unable to delete project.");
    }
  }

  const recommendedStatus = deriveStatusFromDates(form.startDate, form.endDate);
  const activeStepMeta = STEP_LABELS.find((entry) => entry.step === currentStep) || STEP_LABELS[0];
  const secondaryRigOptions = rigs.filter((rig) => rig.id !== form.primaryRigId);

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
          <Card title={form.id ? "Edit Project Setup" : "Create Project Setup"}>
            <div className="space-y-4">
              <div className="grid gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 md:grid-cols-3 xl:grid-cols-6">
                {STEP_LABELS.map((entry) => (
                  <button
                    key={`project-step-${entry.step}`}
                    type="button"
                    onClick={() => setCurrentStep(entry.step)}
                    className={`rounded-lg border px-2 py-2 text-left transition ${
                      currentStep === entry.step
                        ? "border-brand-300 bg-brand-50 text-brand-900"
                        : "border-slate-200 bg-white text-slate-700 hover:bg-slate-100"
                    }`}
                  >
                    <p className="text-xs font-semibold uppercase tracking-wide">Step {entry.step}</p>
                    <p className="mt-1 text-sm font-semibold">{entry.title}</p>
                  </button>
                ))}
              </div>

              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Step {activeStepMeta.step} — {activeStepMeta.title}
                </p>
                <p className="mt-1 text-sm text-slate-700">{activeStepMeta.subtitle}</p>
              </div>

              {formError && (
                <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
                  {formError}
                </p>
              )}
              {formNotice && (
                <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                  {formNotice}
                </p>
              )}

              <form onSubmit={saveProject} className="space-y-4">
                {currentStep === 1 && (
                  <div className="grid gap-3 md:grid-cols-2">
                    <Input
                      label="Project Name"
                      value={form.name}
                      onChange={(value) => setForm((current) => ({ ...current, name: value }))}
                      required
                    />

                    <label className="text-sm text-ink-700">
                      <span className="mb-1 block">Client source</span>
                      <select
                        value={form.clientMode}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            clientMode: event.target.value as ClientLinkMode
                          }))
                        }
                        className="w-full rounded-lg border border-slate-200 px-3 py-2"
                      >
                        <option value="EXISTING">Select existing client</option>
                        <option value="NEW">Create new client</option>
                      </select>
                    </label>

                    {form.clientMode === "EXISTING" ? (
                      <Select
                        label="Client"
                        value={form.clientId}
                        onChange={(value) => setForm((current) => ({ ...current, clientId: value }))}
                        options={clients.map((client) => ({ value: client.id, label: client.name }))}
                        required
                      />
                    ) : (
                      <Input
                        label="New Client Name"
                        value={form.newClientName}
                        onChange={(value) => setForm((current) => ({ ...current, newClientName: value }))}
                        required
                      />
                    )}

                    <label className="text-sm text-ink-700">
                      <span className="mb-1 block">Location source</span>
                      <select
                        value={form.locationMode}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            locationMode: event.target.value as LocationLinkMode
                          }))
                        }
                        className="w-full rounded-lg border border-slate-200 px-3 py-2"
                      >
                        <option value="EXISTING">Select existing location</option>
                        <option value="NEW">Create new location</option>
                      </select>
                    </label>

                    {form.locationMode === "EXISTING" ? (
                      <Select
                        label="Location"
                        value={form.locationExisting}
                        onChange={(value) => setForm((current) => ({ ...current, locationExisting: value }))}
                        options={locationOptions.map((location) => ({ value: location, label: location }))}
                        required
                      />
                    ) : (
                      <Input
                        label="New Location"
                        value={form.locationNew}
                        onChange={(value) => setForm((current) => ({ ...current, locationNew: value }))}
                        required
                      />
                    )}
                  </div>
                )}

                {currentStep === 2 && (
                  <div className="grid gap-3 md:grid-cols-2">
                    <Input
                      label="Start Date"
                      type="date"
                      value={form.startDate}
                      onChange={(value) => setForm((current) => ({ ...current, startDate: value }))}
                      required
                    />
                    <Input
                      label="End Date"
                      type="date"
                      value={form.endDate}
                      onChange={(value) => setForm((current) => ({ ...current, endDate: value }))}
                    />
                    <Select
                      label="Project Status"
                      value={form.status}
                      onChange={(value) =>
                        setForm((current) => ({
                          ...current,
                          status: normalizeProjectStatus(value),
                          statusManuallySet: true
                        }))
                      }
                      options={[
                        { value: "PLANNED", label: "PLANNED" },
                        { value: "ACTIVE", label: "ACTIVE" },
                        { value: "ON_HOLD", label: "ON_HOLD" },
                        { value: "COMPLETED", label: "COMPLETED" }
                      ]}
                      required
                    />
                    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">
                      <p>
                        Suggested status from dates:{" "}
                        <span className="font-semibold">{recommendedStatus}</span>
                      </p>
                      <button
                        type="button"
                        onClick={() =>
                          setForm((current) => ({
                            ...current,
                            status: recommendedStatus,
                            statusManuallySet: false
                          }))
                        }
                        className="mt-2 rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 hover:bg-slate-100"
                      >
                        Use suggested status
                      </button>
                    </div>
                  </div>
                )}

                {currentStep === 3 && (
                  <div className="grid gap-3 md:grid-cols-2">
                    <Input
                      label="Price per Meter"
                      type="number"
                      value={form.contractRatePerM}
                      onChange={(value) => setForm((current) => ({ ...current, contractRatePerM: value }))}
                      required
                    />
                    <Input
                      label="Budget (optional)"
                      type="number"
                      value={form.budgetAmount}
                      onChange={(value) => setForm((current) => ({ ...current, budgetAmount: value }))}
                    />
                    <Input
                      label="Expected Meters (optional)"
                      type="number"
                      value={form.expectedMeters}
                      onChange={(value) => setForm((current) => ({ ...current, expectedMeters: value }))}
                    />
                    <Input
                      label="Contract / Reference URL (optional)"
                      value={form.contractReferenceUrl}
                      onChange={(value) =>
                        setForm((current) => ({ ...current, contractReferenceUrl: value }))
                      }
                    />
                    <label className="text-sm text-ink-700">
                      <span className="mb-1 block">Contract/Reference Document (optional)</span>
                      <input
                        type="file"
                        onChange={(event) => {
                          const fileName =
                            event.target.files && event.target.files.length > 0
                              ? event.target.files[0].name
                              : "";
                          setForm((current) => ({
                            ...current,
                            contractReferenceName: fileName || current.contractReferenceName
                          }));
                        }}
                        className="w-full rounded-lg border border-slate-200 px-3 py-2"
                      />
                    </label>
                    <Input
                      label="Stored Document Name (optional)"
                      value={form.contractReferenceName}
                      onChange={(value) =>
                        setForm((current) => ({ ...current, contractReferenceName: value }))
                      }
                    />
                  </div>
                )}

                {currentStep === 4 && (
                  <div className="grid gap-3 md:grid-cols-2">
                    <Select
                      label="Primary Rig"
                      value={form.primaryRigId}
                      onChange={(value) =>
                        setForm((current) => ({
                          ...current,
                          primaryRigId: value,
                          secondaryRigId: value === current.secondaryRigId ? "" : current.secondaryRigId
                        }))
                      }
                      options={rigs.map((rig) => ({ value: rig.id, label: rig.rigCode }))}
                    />
                    <Select
                      label="Secondary Rig (optional)"
                      value={form.secondaryRigId}
                      onChange={(value) => setForm((current) => ({ ...current, secondaryRigId: value }))}
                      options={secondaryRigOptions.map((rig) => ({ value: rig.id, label: rig.rigCode }))}
                    />
                    <div className="md:col-span-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                      <p>
                        Primary rig:{" "}
                        <span className="font-semibold">
                          {rigs.find((rig) => rig.id === form.primaryRigId)?.rigCode || "Not assigned"}
                        </span>
                      </p>
                      <p className="mt-1">
                        Secondary rig:{" "}
                        <span className="font-semibold">
                          {rigs.find((rig) => rig.id === form.secondaryRigId)?.rigCode || "Not assigned"}
                        </span>
                      </p>
                    </div>
                  </div>
                )}

                {currentStep === 5 && (
                  <div className="space-y-3">
                    {employees.length === 0 ? (
                      <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                        Employee list is unavailable for your current permission scope. You can still create/update the project.
                      </p>
                    ) : (
                      <div className="grid gap-2 md:grid-cols-2">
                        {employees
                          .filter((employee) => employee.isActive)
                          .map((employee) => {
                            const selected = form.teamMemberIds.includes(employee.id);
                            return (
                              <label
                                key={`project-team-${employee.id}`}
                                className={`flex items-center justify-between rounded-lg border px-3 py-2 text-sm ${
                                  selected
                                    ? "border-brand-300 bg-brand-50 text-brand-900"
                                    : "border-slate-200 bg-white text-slate-800"
                                }`}
                              >
                                <span>
                                  {employee.fullName}{" "}
                                  <span className="text-xs uppercase tracking-wide text-slate-500">
                                    ({employee.role})
                                  </span>
                                </span>
                                <input
                                  type="checkbox"
                                  checked={selected}
                                  onChange={(event) =>
                                    setForm((current) => ({
                                      ...current,
                                      teamMemberIds: event.target.checked
                                        ? [...current.teamMemberIds, employee.id]
                                        : current.teamMemberIds.filter((id) => id !== employee.id)
                                    }))
                                  }
                                />
                              </label>
                            );
                          })}
                      </div>
                    )}
                  </div>
                )}

                {currentStep === 6 && (
                  <div className="space-y-3">
                    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                      <p className="font-semibold text-slate-900">Setup Summary</p>
                      <div className="mt-2 grid gap-1 md:grid-cols-2">
                        <p>
                          <span className="font-semibold">Project:</span> {form.name || "-"}
                        </p>
                        <p>
                          <span className="font-semibold">Client:</span> {reviewSummary.clientName}
                        </p>
                        <p>
                          <span className="font-semibold">Location:</span> {reviewSummary.location}
                        </p>
                        <p>
                          <span className="font-semibold">Status:</span> {reviewSummary.status}
                        </p>
                        <p>
                          <span className="font-semibold">Start Date:</span> {form.startDate || "-"}
                        </p>
                        <p>
                          <span className="font-semibold">End Date:</span> {form.endDate || "-"}
                        </p>
                        <p>
                          <span className="font-semibold">Price per Meter:</span>{" "}
                          {formatCurrency(Number(form.contractRatePerM || 0))}
                        </p>
                        <p>
                          <span className="font-semibold">Budget:</span>{" "}
                          {form.budgetAmount ? formatCurrency(Number(form.budgetAmount)) : "-"}
                        </p>
                        <p>
                          <span className="font-semibold">Expected meters:</span>{" "}
                          {form.expectedMeters ? formatNumber(Number(form.expectedMeters)) : "-"}
                        </p>
                        <p>
                          <span className="font-semibold">Contract reference:</span>{" "}
                          {form.contractReferenceUrl || form.contractReferenceName || "-"}
                        </p>
                        <p>
                          <span className="font-semibold">Primary Rig:</span> {reviewSummary.primaryRig}
                        </p>
                        <p>
                          <span className="font-semibold">Secondary Rig:</span> {reviewSummary.secondaryRig}
                        </p>
                      </div>
                    </div>
                    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">
                      <p className="font-semibold text-slate-900">Assigned Team</p>
                      {reviewSummary.team.length === 0 ? (
                        <p className="mt-1">No team members selected.</p>
                      ) : (
                        <ul className="mt-1 list-disc pl-5">
                          {reviewSummary.team.map((member) => (
                            <li key={`review-team-${member.id}`}>
                              {member.fullName} ({member.role})
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                    <div className="grid gap-3 md:grid-cols-2">
                      <Input
                        label="Photo URL (optional)"
                        value={form.photoUrl}
                        onChange={(value) => setForm((current) => ({ ...current, photoUrl: value }))}
                      />
                      <label className="text-sm text-ink-700 md:col-span-2">
                        <span className="mb-1 block">Project Notes (optional)</span>
                        <textarea
                          value={form.description}
                          onChange={(event) =>
                            setForm((current) => ({ ...current, description: event.target.value }))
                          }
                          className="w-full rounded-lg border border-slate-200 px-3 py-2"
                        />
                      </label>
                    </div>
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-2 border-t border-slate-200 pt-3">
                  <button
                    type="button"
                    onClick={() => moveStep("back")}
                    disabled={currentStep === 1 || saving}
                    className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-ink-700 hover:bg-slate-50 disabled:opacity-60"
                  >
                    Back
                  </button>
                  {currentStep < 6 ? (
                    <button
                      type="button"
                      onClick={() => moveStep("next")}
                      disabled={saving}
                      className="rounded-lg border border-brand-300 bg-brand-50 px-4 py-2 text-sm font-semibold text-brand-800 hover:bg-brand-100 disabled:opacity-60"
                    >
                      Next Step
                    </button>
                  ) : (
                    <button
                      type="submit"
                      disabled={saving}
                      className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
                    >
                      {saving ? "Saving..." : form.id ? "Update Project" : "Create Project"}
                    </button>
                  )}
                  {form.id ? (
                    <button
                      type="button"
                      onClick={resetFormState}
                      className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-ink-700 hover:bg-slate-50"
                    >
                      Cancel Edit
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={resetFormState}
                      className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-ink-700 hover:bg-slate-50"
                    >
                      Reset
                    </button>
                  )}
                </div>
              </form>
            </div>
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
                    onClick={() => applyEditProject(row.project)}
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

function validateProjectSetupStep({
  form,
  step
}: {
  form: ProjectFormState;
  step: ProjectSetupStep;
}) {
  const issues: string[] = [];
  const locationValue =
    form.locationMode === "NEW" ? form.locationNew.trim() : form.locationExisting.trim();
  const clientValue =
    form.clientMode === "NEW" ? form.newClientName.trim() : form.clientId.trim();

  if (step >= 1) {
    if (!form.name.trim()) {
      issues.push("Project name is required.");
    }
    if (!clientValue) {
      issues.push(
        form.clientMode === "NEW" ? "Enter a new client name." : "Select an existing client."
      );
    }
    if (!locationValue) {
      issues.push(
        form.locationMode === "NEW"
          ? "Enter a new location."
          : "Select an existing location."
      );
    }
  }

  if (step >= 2) {
    if (!form.startDate) {
      issues.push("Start date is required.");
    }
    if (form.endDate && form.startDate && form.endDate < form.startDate) {
      issues.push("End date cannot be earlier than start date.");
    }
  }

  if (step >= 3) {
    const rate = Number(form.contractRatePerM);
    if (!Number.isFinite(rate) || rate <= 0) {
      issues.push("Price per meter must be greater than zero.");
    }
    if (form.budgetAmount && (!Number.isFinite(Number(form.budgetAmount)) || Number(form.budgetAmount) <= 0)) {
      issues.push("Budget must be a positive number.");
    }
    if (form.expectedMeters && (!Number.isFinite(Number(form.expectedMeters)) || Number(form.expectedMeters) <= 0)) {
      issues.push("Expected meters must be a positive number.");
    }
  }

  if (step >= 4) {
    if (form.primaryRigId && form.primaryRigId === form.secondaryRigId) {
      issues.push("Primary and secondary rig cannot be the same.");
    }
  }

  return issues;
}

function parseOptionalPositive(value: string) {
  const parsed = Number(value || "");
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}

function normalizeProjectStatus(value: string): ProjectStatusOption {
  if (value === "ACTIVE" || value === "ON_HOLD" || value === "COMPLETED" || value === "PLANNED") {
    return value;
  }
  return "PLANNED";
}

function deriveStatusFromDates(startDate: string, endDate: string): ProjectStatusOption {
  if (!startDate) {
    return "PLANNED";
  }
  const today = new Date();
  const start = new Date(startDate);
  if (Number.isNaN(start.getTime())) {
    return "PLANNED";
  }
  if (endDate) {
    const end = new Date(endDate);
    if (!Number.isNaN(end.getTime()) && end < today) {
      return "COMPLETED";
    }
  }
  if (start > today) {
    return "PLANNED";
  }
  return "ACTIVE";
}

function normalizeSetupProfile(value: Partial<ProjectSetupProfile> | null | undefined): ProjectSetupProfile {
  return {
    expectedMeters:
      typeof value?.expectedMeters === "number" && Number.isFinite(value.expectedMeters)
        ? value.expectedMeters
        : null,
    contractReferenceUrl:
      typeof value?.contractReferenceUrl === "string" ? value.contractReferenceUrl : "",
    contractReferenceName:
      typeof value?.contractReferenceName === "string" ? value.contractReferenceName : "",
    teamMemberIds: Array.isArray(value?.teamMemberIds)
      ? value.teamMemberIds.filter((entry): entry is string => typeof entry === "string")
      : [],
    teamMemberNames: Array.isArray(value?.teamMemberNames)
      ? value.teamMemberNames.filter((entry): entry is string => typeof entry === "string")
      : []
  };
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
