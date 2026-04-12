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

type ContractType = "PER_METER" | "DAY_RATE" | "LUMP_SUM";

interface ProjectRecord {
  id: string;
  name: string;
  status: string;
  location: string;
  description: string | null;
  startDate: string;
  endDate: string | null;
  contractType: ContractType;
  contractRatePerM: number;
  contractDayRate: number | null;
  contractLumpSumValue: number | null;
  assignedRigId: string | null;
  backupRigId: string | null;
  client: { id: string; name: string };
  assignedRig: { id: string; rigCode: string } | null;
  backupRig: { id: string; rigCode: string } | null;
}

export default function ProjectsPage() {
  const { filters } = useAnalyticsFilters();
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [rigs, setRigs] = useState<RigOption[]>([]);
  const [projectRevenueMap, setProjectRevenueMap] = useState<Map<string, number>>(new Map());
  const [projectExpenseMap, setProjectExpenseMap] = useState<Map<string, number>>(new Map());
  const [projectMetersMap, setProjectMetersMap] = useState<Map<string, number>>(new Map());
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const scopeProjectId = filters.projectId !== "all" ? filters.projectId : "";
  const isSingleProjectScope = scopeProjectId.length > 0;

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const search = new URLSearchParams();
      if (filters.from) search.set("from", filters.from);
      if (filters.to) search.set("to", filters.to);
      if (filters.projectId !== "all") {
        search.set("projectId", filters.projectId);
      } else {
        if (filters.clientId !== "all") search.set("clientId", filters.clientId);
        if (filters.rigId !== "all") search.set("rigId", filters.rigId);
      }
      const query = search.toString();

      const [projectsRes, clientsRes, rigsRes, revenueRes, expensesRes, drillingRes] = await Promise.all([
        fetch(`/api/projects${query ? `?${query}` : ""}`, { cache: "no-store" }),
        fetch(`/api/clients${query ? `?${query}` : ""}`, { cache: "no-store" }),
        fetch(`/api/rigs${query ? `?${query}` : ""}`, { cache: "no-store" }),
        fetch(`/api/revenue/summary${query ? `?${query}` : ""}`, { cache: "no-store" }),
        fetch(`/api/expenses/analytics${query ? `?${query}` : ""}`, { cache: "no-store" }),
        fetch(`/api/drilling-reports${query ? `?${query}` : ""}`, { cache: "no-store" })
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
  }, [filters.clientId, filters.from, filters.projectId, filters.rigId, filters.to]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  async function deleteProject(id: string) {
    if (!window.confirm("Delete this project?")) {
      return;
    }
    setError(null);
    setNotice(null);
    const response = await fetch(`/api/projects/${id}`, { method: "DELETE" });
    if (response.ok) {
      await loadAll();
      setNotice("Project deleted.");
    } else {
      setError("Unable to delete project.");
    }
  }

  const selectedProject = useMemo(
    () => (scopeProjectId ? projects.find((project) => project.id === scopeProjectId) || null : null),
    [projects, scopeProjectId]
  );

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
        return {
          project,
          revenue,
          cost,
          profit,
          meters
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

  const scopedQuery = useMemo(() => {
    const params = new URLSearchParams();
    if (scopeProjectId) params.set("projectId", scopeProjectId);
    if (filters.from) params.set("from", filters.from);
    if (filters.to) params.set("to", filters.to);
    return params.toString();
  }, [filters.from, filters.to, scopeProjectId]);

  const spendingHref = scopedQuery ? `/spending?${scopedQuery}` : "/spending";
  const drillingReportsHref = scopedQuery
    ? `/spending?view=drilling-reports&${scopedQuery}`
    : "/spending?view=drilling-reports";

  return (
    <AccessGate permission="projects:view">
      <div className="gf-page-stack">
        <FilterScopeBanner
          filters={filters}
          projectLabel={selectedProject?.name || null}
          clientLabel={selectedClientName}
          rigLabel={selectedRigName}
        />

        {isSingleProjectScope ? (
          <Card title="Project profile">
            {loading ? (
              <p className="text-sm text-ink-600">Loading project profile...</p>
            ) : selectedProject ? (
              <div className="space-y-4">
                <DataTable
                  compact
                  columns={["Detail", "Value"]}
                  rows={[
                    ["Project", selectedProject.name],
                    ["Client", selectedProject.client?.name || "-"],
                    ["Site / location", selectedProject.location || "-"],
                    ["Project status", formatStatus(selectedProject.status)],
                    ["Assigned rig", selectedProject.assignedRig?.rigCode || "Unassigned"],
                    ["Backup rig", selectedProject.backupRig?.rigCode || "Unassigned"],
                    ["Contract type", formatProjectType(selectedProject.contractType)],
                    ["Contract rate", formatContractRate(selectedProject)],
                    ["Start date", formatDateValue(selectedProject.startDate)],
                    ["End date", formatDateValue(selectedProject.endDate)],
                    ["Description", selectedProject.description || "-"]
                  ]}
                />
                <div className="flex flex-wrap gap-2">
                  <AccessGate permission="projects:manage">
                    <Link
                      href={`/projects/setup?projectId=${selectedProject.id}`}
                      className="rounded-md border border-brand-200 bg-brand-50 px-3 py-1.5 text-sm font-medium text-brand-800 hover:bg-brand-100"
                    >
                      Edit project setup
                    </Link>
                  </AccessGate>
                  <Link
                    href={spendingHref}
                    className="rounded-md border border-slate-200 px-3 py-1.5 text-sm font-medium text-ink-700 hover:bg-slate-50"
                  >
                    Open Spending
                  </Link>
                  <Link
                    href={drillingReportsHref}
                    className="rounded-md border border-slate-200 px-3 py-1.5 text-sm font-medium text-ink-700 hover:bg-slate-50"
                  >
                    Open Drilling reports
                  </Link>
                </div>
              </div>
            ) : (
              <p className="text-sm text-ink-700">
                The selected project was not found. Choose another project from the top bar.
              </p>
            )}
          </Card>
        ) : (
          <>
            <section className="grid gap-3 md:grid-cols-3">
              <MetricCard
                label={isScoped ? "Projects in Scope" : "Total Projects"}
                value={String(projects.length)}
              />
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
              <section className="flex justify-end">
                <Link
                  href="/projects/setup"
                  className="rounded-lg border border-brand-300 bg-brand-50 px-3 py-2 text-sm font-semibold text-brand-800 hover:bg-brand-100"
                >
                  Create project
                </Link>
              </section>
            </AccessGate>

            {error ? (
              <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
                {error}
              </p>
            ) : null}
            {notice ? (
              <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                {notice}
              </p>
            ) : null}

            <Card title="Project Register">
              {loading ? (
                <p className="text-sm text-ink-600">Loading projects...</p>
              ) : (
                <DataTable
                  columns={[
                    "Project",
                    "Client",
                    "Status",
                    "Assigned Rig",
                    "Revenue",
                    "Cost",
                    "Profit",
                    "Meters",
                    "Actions"
                  ]}
                  rows={projectPerformanceRows.map((row) => [
                    <Link
                      key={row.project.id}
                      href={`/projects/${row.project.id}`}
                      className="text-brand-700 underline-offset-2 hover:underline"
                    >
                      {row.project.name}
                    </Link>,
                    row.project.client?.name || "-",
                    row.project.status,
                    row.project.assignedRig?.rigCode || "-",
                    formatCurrency(row.revenue),
                    formatCurrency(row.cost),
                    <span
                      key={`profit-${row.project.id}`}
                      className={row.profit >= 0 ? "text-emerald-700" : "text-rose-700"}
                    >
                      {formatCurrency(row.profit)}
                    </span>,
                    formatNumber(row.meters),
                    <div key={`actions-${row.project.id}`} className="flex flex-wrap gap-2">
                      <Link
                        href={`/projects/${row.project.id}`}
                        className="rounded-md border border-slate-200 px-2 py-1 text-xs text-ink-700 hover:bg-slate-50"
                      >
                        View
                      </Link>
                      <AccessGate permission="projects:manage">
                        <Link
                          href={`/projects/setup?projectId=${row.project.id}`}
                          className="rounded-md border border-slate-200 px-2 py-1 text-xs text-ink-700 hover:bg-slate-50"
                        >
                          Edit
                        </Link>
                      </AccessGate>
                      <AccessGate permission="projects:manage">
                        <button
                          type="button"
                          className="rounded-md border border-red-200 px-2 py-1 text-xs text-red-700 hover:bg-red-50"
                          onClick={() => void deleteProject(row.project.id)}
                        >
                          Delete
                        </button>
                      </AccessGate>
                    </div>
                  ])}
                />
              )}
            </Card>
          </>
        )}
      </div>
    </AccessGate>
  );
}

function formatProjectType(value: ContractType) {
  if (value === "PER_METER") {
    return "Per meter";
  }
  if (value === "DAY_RATE") {
    return "Day rate";
  }
  return "Lump sum";
}

function formatContractRate(project: ProjectRecord) {
  if (project.contractType === "PER_METER") {
    return `${formatCurrency(project.contractRatePerM)} / meter`;
  }
  if (project.contractType === "DAY_RATE") {
    return `${formatCurrency(project.contractDayRate || 0)} / day`;
  }
  return formatCurrency(project.contractLumpSumValue || 0);
}

function formatDateValue(value: string | null) {
  if (!value) {
    return "-";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toISOString().slice(0, 10);
}

function formatStatus(value: string) {
  return value
    .toLowerCase()
    .split("_")
    .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : part))
    .join(" ");
}
