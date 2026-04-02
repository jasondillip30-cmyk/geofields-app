"use client";

import { useEffect, useMemo, useState } from "react";

import { AccessGate } from "@/components/layout/access-gate";
import { useRegisterCopilotContext } from "@/components/layout/ai-copilot-context";
import { useAnalyticsFilters } from "@/components/layout/analytics-filters-provider";
import { scrollToFocusElement, useCopilotFocusTarget } from "@/components/layout/copilot-focus-target";
import { Card, MetricCard } from "@/components/ui/card";
import { DataTable } from "@/components/ui/table";
import type { CopilotPageContext } from "@/lib/ai/contextual-copilot";
import { buildScopedHref } from "@/lib/drilldown";
import { cn } from "@/lib/utils";

interface ProjectOption {
  id: string;
  name: string;
  assignedRigId: string | null;
  client: { name: string };
}

interface RigOption {
  id: string;
  rigCode: string;
}

interface BreakdownRecord {
  id: string;
  reportDate: string;
  title: string;
  description: string;
  severity: string;
  downtimeHours: number;
  status: string;
  client: { name: string };
  project: { name: string };
  rig: { rigCode: string };
  reportedBy: { fullName: string; role: string };
}

type BreakdownWizardStep = 1 | 2 | 3;

export default function BreakdownsPage() {
  const { filters } = useAnalyticsFilters();
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [rigs, setRigs] = useState<RigOption[]>([]);
  const [records, setRecords] = useState<BreakdownRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [focusedRowId, setFocusedRowId] = useState<string | null>(null);
  const [focusedSectionId, setFocusedSectionId] = useState<string | null>(null);
  const [wizardStep, setWizardStep] = useState<BreakdownWizardStep>(1);
  const [form, setForm] = useState({
    projectId: "",
    rigId: "",
    title: "",
    description: "",
    severity: "MEDIUM",
    downtimeHours: "0"
  });

  async function loadAll() {
    setLoading(true);
    try {
      const [projectsRes, rigsRes, recordsRes] = await Promise.all([
        fetch("/api/projects", { cache: "no-store" }),
        fetch("/api/rigs", { cache: "no-store" }),
        fetch("/api/breakdowns", { cache: "no-store" })
      ]);

      const [projectsData, rigsData, recordsData] = await Promise.all([
        projectsRes.json(),
        rigsRes.json(),
        recordsRes.json()
      ]);

      setProjects(projectsData.data || []);
      setRigs(rigsData.data || []);
      setRecords(recordsData.data || []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadAll();
  }, []);

  const criticalCount = useMemo(
    () => records.filter((record) => record.severity === "CRITICAL").length,
    [records]
  );
  const openCount = useMemo(
    () => records.filter((record) => !["RESOLVED", "COMPLETED", "CLOSED"].includes(record.status)).length,
    [records]
  );
  const totalDowntime = useMemo(
    () => records.reduce((sum, record) => sum + record.downtimeHours, 0),
    [records]
  );
  const buildHref = useMemo(
    () => (path: string, overrides?: Record<string, string | null | undefined>) => buildScopedHref(filters, path, overrides),
    [filters]
  );

  const copilotContext = useMemo<CopilotPageContext>(
    () => ({
      pageKey: "breakdowns",
      pageName: "Breakdown Reports",
      filters: {
        clientId: filters.clientId,
        rigId: filters.rigId,
        from: filters.from || null,
        to: filters.to || null
      },
      summaryMetrics: [
        { key: "breakdownsLogged", label: "Breakdowns Logged", value: records.length },
        { key: "criticalBreakdowns", label: "Critical Breakdowns", value: criticalCount },
        { key: "openBreakdowns", label: "Open Breakdowns", value: openCount },
        { key: "downtimeHours", label: "Estimated Downtime Hours", value: totalDowntime }
      ],
      tablePreviews: [
        {
          key: "breakdown-log",
          title: "Breakdown Log",
          rowCount: records.length,
          columns: ["Date", "Title", "Rig", "Severity", "Status", "Downtime"],
          rows: records.slice(0, 10).map((record) => ({
            id: record.id,
            date: new Date(record.reportDate).toISOString().slice(0, 10),
            title: record.title,
            rig: record.rig?.rigCode || "-",
            severity: record.severity,
            status: record.status,
            downtimeHours: record.downtimeHours,
            amount: record.downtimeHours,
            href: buildHref("/breakdowns"),
            targetId: record.id,
            sectionId: "breakdown-log-section",
            targetPageKey: "breakdowns"
          }))
        }
      ],
      priorityItems: records
        .filter((record) => record.severity === "CRITICAL" || record.severity === "HIGH")
        .sort((a, b) => b.downtimeHours - a.downtimeHours)
        .slice(0, 5)
        .map((record) => ({
          id: record.id,
          label: `${record.rig?.rigCode || "Unassigned Rig"} • ${record.title}`,
          reason: `${record.severity} breakdown with ${record.downtimeHours.toFixed(1)} estimated downtime hour(s).`,
          severity: record.severity === "CRITICAL" ? ("CRITICAL" as const) : ("HIGH" as const),
          amount: record.downtimeHours,
          href: buildHref("/breakdowns"),
          issueType: "BREAKDOWN",
          targetId: record.id,
          sectionId: "breakdown-log-section",
          targetPageKey: "breakdowns"
        })),
      navigationTargets: [
        {
          label: "Open Maintenance",
          href: buildHref("/maintenance"),
          reason: "Coordinate maintenance action for breakdowns.",
          pageKey: "maintenance",
          sectionId: "maintenance-log-section"
        },
        {
          label: "Open Drilling Reports",
          href: buildHref("/drilling-reports"),
          reason: "Cross-check drilling impact from breakdown downtime.",
          pageKey: "drilling-reports",
          sectionId: "drilling-reports-table-section"
        }
      ],
      notes: ["Breakdown insights are advisory-only and should be validated by maintenance leads."]
    }),
    [buildHref, criticalCount, filters.clientId, filters.from, filters.rigId, filters.to, openCount, records, totalDowntime]
  );

  useRegisterCopilotContext(copilotContext);

  useCopilotFocusTarget({
    pageKey: "breakdowns",
    onFocus: (target) => {
      setFocusedRowId(target.targetId || null);
      setFocusedSectionId(target.sectionId || null);
      scrollToFocusElement({
        sectionId: target.sectionId,
        targetId: target.targetId
      });
    }
  });

  useEffect(() => {
    if (!focusedRowId && !focusedSectionId) {
      return;
    }
    const timeout = window.setTimeout(() => {
      setFocusedRowId(null);
      setFocusedSectionId(null);
    }, 2600);
    return () => window.clearTimeout(timeout);
  }, [focusedRowId, focusedSectionId]);

  const currentStepError =
    wizardStep === 1
      ? !form.projectId
        ? "Select the affected project to continue."
        : ""
      : wizardStep === 2
        ? !form.title.trim()
          ? "Enter a breakdown title."
          : !form.description.trim()
            ? "Enter a breakdown description."
            : ""
        : "";

  function goToNextStep() {
    if (currentStepError) {
      return;
    }
    setWizardStep((current) => Math.min(3, current + 1) as BreakdownWizardStep);
  }

  function goToPreviousStep() {
    setWizardStep((current) => Math.max(1, current - 1) as BreakdownWizardStep);
  }

  async function submitBreakdown(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (currentStepError) {
      return;
    }
    setSaving(true);
    try {
      const response = await fetch("/api/breakdowns", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          ...form,
          downtimeHours: Number(form.downtimeHours)
        })
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({ message: "Failed to submit breakdown." }));
        alert(payload.message || "Failed to submit breakdown.");
        return;
      }

      setForm({
        projectId: "",
        rigId: "",
        title: "",
        description: "",
        severity: "MEDIUM",
        downtimeHours: "0"
      });
      setWizardStep(1);
      await loadAll();
    } finally {
      setSaving(false);
    }
  }

  const linkedProject = projects.find((project) => project.id === form.projectId);

  return (
    <AccessGate permission="breakdowns:view">
      <div className="gf-page-stack">
        <section className="grid gap-3 md:grid-cols-4">
          <MetricCard label="Breakdowns Logged" value={String(records.length)} />
          <MetricCard
            label="Critical Reports"
            value={String(criticalCount)}
            tone="warn"
          />
          <MetricCard
            label="Submitted by Field Team"
            value={String(records.filter((record) => record.reportedBy.role === "FIELD").length)}
          />
          <MetricCard
            label="Total Estimated Downtime"
            value={`${totalDowntime.toFixed(1)} hrs`}
          />
        </section>

        <AccessGate permission="breakdowns:submit">
          <Card
            title="Field Breakdown Reporting"
            subtitle="Automatically links breakdown to project, rig, and client for faster response."
          >
            <form onSubmit={submitBreakdown} className="space-y-3">
              <div className="grid gap-2 text-xs sm:grid-cols-3">
                {[
                  { step: 1, label: "Project context" },
                  { step: 2, label: "Issue details" },
                  { step: 3, label: "Review & submit" }
                ].map((entry) => (
                  <div
                    key={`breakdown-step-${entry.step}`}
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

              {wizardStep === 1 && (
                <div className="grid gap-3 md:grid-cols-2">
                  <label className="text-sm text-ink-700">
                    Project
                    <select
                      value={form.projectId}
                      onChange={(event) =>
                        setForm((current) => ({ ...current, projectId: event.target.value }))
                      }
                      className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
                      required
                    >
                      <option value="">Select project</option>
                      {projects.map((project) => (
                        <option key={project.id} value={project.id}>
                          {project.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="text-sm text-ink-700">
                    Rig (optional)
                    <select
                      value={form.rigId}
                      onChange={(event) =>
                        setForm((current) => ({ ...current, rigId: event.target.value }))
                      }
                      className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
                    >
                      <option value="">Use project assigned rig</option>
                      {rigs.map((rig) => (
                        <option key={rig.id} value={rig.id}>
                          {rig.rigCode}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              )}

              {wizardStep === 2 && (
                <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                  <label className="text-sm text-ink-700">
                    Severity
                    <select
                      value={form.severity}
                      onChange={(event) =>
                        setForm((current) => ({ ...current, severity: event.target.value }))
                      }
                      className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
                    >
                      <option>LOW</option>
                      <option>MEDIUM</option>
                      <option>HIGH</option>
                      <option>CRITICAL</option>
                    </select>
                  </label>
                  <label className="text-sm text-ink-700">
                    Breakdown Title
                    <input
                      value={form.title}
                      onChange={(event) =>
                        setForm((current) => ({ ...current, title: event.target.value }))
                      }
                      className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
                      required
                    />
                  </label>
                  <label className="text-sm text-ink-700">
                    Estimated Downtime (hrs)
                    <input
                      type="number"
                      min="0"
                      value={form.downtimeHours}
                      onChange={(event) =>
                        setForm((current) => ({ ...current, downtimeHours: event.target.value }))
                      }
                      className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
                    />
                  </label>
                  <label className="text-sm text-ink-700 md:col-span-2 lg:col-span-3">
                    Description
                    <textarea
                      value={form.description}
                      onChange={(event) =>
                        setForm((current) => ({ ...current, description: event.target.value }))
                      }
                      className="mt-1 min-h-24 w-full rounded-lg border border-slate-200 px-3 py-2"
                      required
                    />
                  </label>
                </div>
              )}

              {wizardStep === 3 && (
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-ink-700">
                  <p>
                    <span className="font-semibold">Project:</span>{" "}
                    {projects.find((project) => project.id === form.projectId)?.name || "-"}
                  </p>
                  <p>
                    <span className="font-semibold">Rig:</span>{" "}
                    {rigs.find((rig) => rig.id === form.rigId)?.rigCode || "Project assigned rig"}
                  </p>
                  <p>
                    <span className="font-semibold">Severity:</span> {form.severity}
                  </p>
                  <p>
                    <span className="font-semibold">Title:</span> {form.title || "-"}
                  </p>
                  <p>
                    <span className="font-semibold">Estimated Downtime:</span>{" "}
                    {form.downtimeHours || "0"} hrs
                  </p>
                  <p>
                    <span className="font-semibold">Description:</span> {form.description || "-"}
                  </p>
                  <p className="mt-1">
                    <span className="font-semibold">Linked client:</span>{" "}
                    {linkedProject?.client?.name || "-"}
                  </p>
                </div>
              )}

              <div className="flex flex-wrap items-center gap-2 border-t border-slate-200 pt-3">
                {wizardStep > 1 && (
                  <button
                    type="button"
                    onClick={goToPreviousStep}
                    className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
                  >
                    Back
                  </button>
                )}
                {wizardStep < 3 ? (
                  <button
                    type="button"
                    onClick={goToNextStep}
                    disabled={Boolean(currentStepError)}
                    className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
                  >
                    Continue
                  </button>
                ) : (
                  <button
                    type="submit"
                    disabled={saving}
                    className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
                  >
                    {saving ? "Submitting..." : "Submit Breakdown"}
                  </button>
                )}
                {currentStepError && wizardStep < 3 && (
                  <p className="text-xs text-amber-800">{currentStepError}</p>
                )}
              </div>
            </form>
          </Card>
        </AccessGate>

        <section
          id="breakdown-log-section"
          className={cn(
            focusedSectionId === "breakdown-log-section" && "rounded-2xl ring-2 ring-indigo-100 ring-offset-2 ring-offset-slate-50"
          )}
        >
        <Card title="Breakdown Log">
          {loading ? (
            <p className="text-sm text-ink-600">Loading breakdown records...</p>
          ) : (
            <DataTable
              columns={[
                "Date",
                "Title",
                "Client",
                "Project",
                "Rig",
                "Severity",
                "Downtime",
                "Status",
                "Reported By"
              ]}
              rows={records.map((record) => [
                new Date(record.reportDate).toLocaleDateString(),
                record.title,
                record.client?.name || "-",
                record.project?.name || "-",
                record.rig?.rigCode || "-",
                record.severity,
                `${record.downtimeHours} hrs`,
                record.status,
                record.reportedBy?.fullName || "-"
              ])}
              rowIds={records.map((record) => `ai-focus-${record.id}`)}
              rowClassNames={records.map((record) =>
                focusedRowId === record.id ? "bg-indigo-50 ring-1 ring-inset ring-indigo-200" : ""
              )}
            />
          )}
        </Card>
        </section>
      </div>
    </AccessGate>
  );
}
