"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { MaintenanceStatusBadge } from "@/components/modules/status-utils";
import { AccessGate } from "@/components/layout/access-gate";
import { useRegisterCopilotContext } from "@/components/layout/ai-copilot-context";
import { FilterScopeBanner } from "@/components/layout/filter-scope-banner";
import { useAnalyticsFilters } from "@/components/layout/analytics-filters-provider";
import {
  scrollToFocusElement,
  useCopilotFocusTarget,
  type CopilotFocusTarget
} from "@/components/layout/copilot-focus-target";
import { useRole } from "@/components/layout/role-provider";
import { WorkflowAssistPanel, type WorkflowAssistModel } from "@/components/layout/workflow-assist-panel";
import { Card, MetricCard } from "@/components/ui/card";
import { DataTable } from "@/components/ui/table";
import { canSubmitMaintenanceRequests } from "@/lib/auth/approval-policy";
import type { CopilotPageContext } from "@/lib/ai/contextual-copilot";
import { buildScopedHref } from "@/lib/drilldown";
import { cn, formatCurrency, formatNumber } from "@/lib/utils";

interface MaintenanceRow {
  id: string;
  requestCode: string;
  date: string;
  rigId: string;
  clientId: string | null;
  projectId: string | null;
  issueDescription: string;
  issueType: string;
  materialsNeeded: string[];
  urgency: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  photos: string[];
  notes: string | null;
  estimatedDowntimeHours: number;
  status: "SUBMITTED" | "UNDER_REVIEW" | "APPROVED" | "DENIED" | "WAITING_FOR_PARTS" | "IN_REPAIR" | "COMPLETED";
  approvalNotes: string | null;
  rig: { id: string; rigCode: string } | null;
  client: { id: string; name: string } | null;
  project: { id: string; name: string } | null;
  mechanic: { id: string; fullName: string; specialization: string } | null;
  partsUsed: Array<{
    movementId: string;
    itemId: string;
    itemName: string;
    sku: string;
    quantity: number;
    totalCost: number;
  }>;
  totalPartsCost: number;
}

interface PartUsageInput {
  itemId: string;
  quantity: string;
}

interface MaintenanceFormState {
  requestDate: string;
  rigId: string;
  clientId: string;
  projectId: string;
  urgency: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  issueDescription: string;
  materialsNeeded: string;
  estimatedDowntimeHrs: string;
  notes: string;
  photoUrls: string;
  partsUsed: PartUsageInput[];
}

export default function MaintenancePage() {
  return (
    <AccessGate permission="maintenance:view">
      <MaintenanceWorkspace />
    </AccessGate>
  );
}

function MaintenanceWorkspace() {
  const { user } = useRole();
  const { filters } = useAnalyticsFilters();
  const canSubmit = canSubmitMaintenanceRequests(user?.role);
  const canManageInventoryUsage = canSubmit;

  const [rows, setRows] = useState<MaintenanceRow[]>([]);
  const [clients, setClients] = useState<Array<{ id: string; name: string }>>([]);
  const [projects, setProjects] = useState<Array<{ id: string; name: string; clientId: string }>>([]);
  const [rigs, setRigs] = useState<Array<{ id: string; rigCode: string }>>([]);
  const [inventoryItems, setInventoryItems] = useState<Array<{ id: string; name: string; sku: string; quantityInStock: number }>>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [focusedRowId, setFocusedRowId] = useState<string | null>(null);
  const [focusedSectionId, setFocusedSectionId] = useState<string | null>(null);
  const [assistTarget, setAssistTarget] = useState<CopilotFocusTarget | null>(null);

  const [form, setForm] = useState<MaintenanceFormState>({
    requestDate: new Date().toISOString().slice(0, 10),
    rigId: "",
    clientId: "",
    projectId: "",
    urgency: "MEDIUM",
    issueDescription: "",
    materialsNeeded: "",
    estimatedDowntimeHrs: "",
    notes: "",
    photoUrls: "",
    partsUsed: [{ itemId: "", quantity: "" }]
  });

  const selectedClientLabel = useMemo(() => {
    if (filters.clientId === "all") {
      return null;
    }
    return rows.find((entry) => entry.client?.id === filters.clientId)?.client?.name || null;
  }, [filters.clientId, rows]);

  const selectedRigLabel = useMemo(() => {
    if (filters.rigId === "all") {
      return null;
    }
    return rows.find((entry) => entry.rig?.id === filters.rigId)?.rig?.rigCode || null;
  }, [filters.rigId, rows]);

  const filteredProjects = useMemo(() => {
    if (!form.clientId) {
      return projects;
    }
    return projects.filter((project) => project.clientId === form.clientId);
  }, [form.clientId, projects]);

  const submittedCount = rows.filter((requestRow) => requestRow.status === "SUBMITTED").length;
  const underReviewCount = rows.filter((requestRow) => requestRow.status === "UNDER_REVIEW").length;
  const waitingPartsCount = rows.filter((requestRow) => requestRow.status === "WAITING_FOR_PARTS").length;
  const completedCount = rows.filter((requestRow) => requestRow.status === "COMPLETED").length;
  const criticalCount = rows.filter((requestRow) => requestRow.urgency === "CRITICAL").length;
  const totalPartsCost = useMemo(
    () => rows.reduce((sum, requestRow) => sum + (requestRow.totalPartsCost || 0), 0),
    [rows]
  );
  const openRows = useMemo(
    () =>
      rows.filter(
        (requestRow) => requestRow.status !== "COMPLETED" && requestRow.status !== "DENIED"
      ),
    [rows]
  );
  const oldestPendingHours = useMemo(() => {
    if (openRows.length === 0) {
      return 0;
    }
    const now = Date.now();
    let maxHours = 0;
    for (const requestRow of openRows) {
      const parsed = Date.parse(requestRow.date);
      if (Number.isNaN(parsed)) {
        continue;
      }
      const hours = Math.max(0, (now - parsed) / 3600000);
      if (hours > maxHours) {
        maxHours = hours;
      }
    }
    return Math.round(maxHours);
  }, [openRows]);
  const repeatedRepairRigCount = useMemo(() => {
    const counts = new Map<string, number>();
    for (const requestRow of openRows) {
      const rigKey = requestRow.rig?.rigCode || requestRow.rigId;
      counts.set(rigKey, (counts.get(rigKey) || 0) + 1);
    }
    return Array.from(counts.values()).filter((value) => value >= 2).length;
  }, [openRows]);
  const topMechanicWorkload = useMemo(() => {
    const counts = new Map<string, number>();
    for (const requestRow of openRows) {
      const key = requestRow.mechanic?.fullName || requestRow.mechanic?.id || "Unassigned";
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    const sorted = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
    const [name, count] = sorted[0] || [];
    if (!name) {
      return null;
    }
    return { name, count };
  }, [openRows]);
  const buildHref = useCallback(
    (path: string, overrides?: Record<string, string | null | undefined>) => buildScopedHref(filters, path, overrides),
    [filters]
  );

  const loadReferenceData = useCallback(async () => {
    const [clientsRes, projectsRes, rigsRes, itemsRes] = await Promise.all([
      fetch("/api/clients", { cache: "no-store" }),
      fetch("/api/projects", { cache: "no-store" }),
      fetch("/api/rigs", { cache: "no-store" }),
      fetch("/api/inventory/items?status=ACTIVE", { cache: "no-store" })
    ]);

    const [clientsPayload, projectsPayload, rigsPayload, itemsPayload] = await Promise.all([
      clientsRes.ok ? clientsRes.json() : Promise.resolve({ data: [] }),
      projectsRes.ok ? projectsRes.json() : Promise.resolve({ data: [] }),
      rigsRes.ok ? rigsRes.json() : Promise.resolve({ data: [] }),
      itemsRes.ok ? itemsRes.json() : Promise.resolve({ data: [] })
    ]);

    setClients((clientsPayload.data || []).map((entry: { id: string; name: string }) => ({ id: entry.id, name: entry.name })));
    setProjects(
      (projectsPayload.data || []).map((entry: { id: string; name: string; clientId: string }) => ({
        id: entry.id,
        name: entry.name,
        clientId: entry.clientId
      }))
    );
    setRigs((rigsPayload.data || []).map((entry: { id: string; rigCode: string }) => ({ id: entry.id, rigCode: entry.rigCode })));
    setInventoryItems(
      (itemsPayload.data || []).map((entry: { id: string; name: string; sku: string; quantityInStock: number }) => ({
        id: entry.id,
        name: entry.name,
        sku: entry.sku,
        quantityInStock: entry.quantityInStock
      }))
    );
  }, []);

  const loadMaintenance = useCallback(async () => {
    setLoading(true);
    setErrorMessage(null);
    try {
      const query = new URLSearchParams();
      if (filters.from) query.set("from", filters.from);
      if (filters.to) query.set("to", filters.to);
      if (filters.clientId !== "all") query.set("clientId", filters.clientId);
      if (filters.rigId !== "all") query.set("rigId", filters.rigId);
      const response = await fetch(`/api/maintenance-requests?${query.toString()}`, { cache: "no-store" });
      if (!response.ok) {
        throw new Error(await readApiError(response, "Failed to load maintenance requests."));
      }
      const payload = await response.json();
      setRows(payload.data || []);
    } catch (error) {
      setRows([]);
      setErrorMessage(error instanceof Error ? error.message : "Failed to load maintenance requests.");
    } finally {
      setLoading(false);
    }
  }, [filters.clientId, filters.from, filters.rigId, filters.to]);

  useEffect(() => {
    void loadReferenceData();
  }, [loadReferenceData]);

  useEffect(() => {
    void loadMaintenance();
  }, [loadMaintenance]);

  const copilotContext = useMemo<CopilotPageContext>(
    () => ({
      pageKey: "maintenance",
      pageName: "Maintenance",
      filters: {
        clientId: filters.clientId,
        rigId: filters.rigId,
        from: filters.from || null,
        to: filters.to || null
      },
      summaryMetrics: [
        { key: "submittedRequests", label: "Submitted", value: submittedCount },
        { key: "underReviewRequests", label: "Under Review", value: underReviewCount },
        { key: "waitingForPartsRequests", label: "Waiting for Parts", value: waitingPartsCount },
        { key: "completedRequests", label: "Completed", value: completedCount },
        { key: "criticalUrgency", label: "Critical Urgency", value: criticalCount },
        { key: "maintenancePartsCost", label: "Maintenance Parts Cost", value: totalPartsCost },
        { key: "oldestPendingHours", label: "Oldest Pending Hours", value: oldestPendingHours },
        { key: "repeatedRepairRigs", label: "Repeated Repair Rigs", value: repeatedRepairRigCount },
        {
          key: "highestActiveMechanicWorkload",
          label: "Highest Active Mechanic Workload",
          value: topMechanicWorkload ? `${topMechanicWorkload.name} (${topMechanicWorkload.count})` : "N/A"
        }
      ],
      tablePreviews: [
        {
          key: "maintenance-requests",
          title: "Maintenance Requests",
          rowCount: rows.length,
          columns: ["Request", "Rig", "Urgency", "Status", "Downtime", "Parts Cost"],
          rows: rows.slice(0, 10).map((requestRow) => ({
            id: requestRow.id,
            request: requestRow.requestCode,
            rig: requestRow.rig?.rigCode || requestRow.rigId,
            urgency: requestRow.urgency,
            status: requestRow.status,
            downtimeHours: requestRow.estimatedDowntimeHours,
            pendingHours: calculatePendingHours(requestRow.date),
            partsCost: requestRow.totalPartsCost || 0,
            href: buildHref("/maintenance"),
            targetId: requestRow.id,
            sectionId: "maintenance-log-section",
            targetPageKey: "maintenance"
          }))
        },
        {
          key: "maintenance-workload",
          title: "Mechanic Workload",
          rowCount: topMechanicWorkload ? 1 : 0,
          columns: ["Mechanic", "Active Requests"],
          rows: topMechanicWorkload
            ? [
                {
                  id: `mechanic-${topMechanicWorkload.name}`,
                  mechanic: topMechanicWorkload.name,
                  activeRequests: topMechanicWorkload.count
                }
              ]
            : []
        }
      ],
      priorityItems: rows
        .filter((requestRow) => requestRow.status !== "COMPLETED" && requestRow.status !== "DENIED")
        .sort((a, b) => {
          const urgencyRank = (value: MaintenanceRow["urgency"]) =>
            value === "CRITICAL" ? 0 : value === "HIGH" ? 1 : value === "MEDIUM" ? 2 : 3;
          const urgencyDiff = urgencyRank(a.urgency) - urgencyRank(b.urgency);
          if (urgencyDiff !== 0) {
            return urgencyDiff;
          }
          return (b.totalPartsCost || 0) - (a.totalPartsCost || 0);
        })
        .slice(0, 6)
        .map((requestRow) => ({
          id: requestRow.id,
          label: `${requestRow.requestCode} • ${requestRow.rig?.rigCode || requestRow.rigId}`,
          reason: `${requestRow.urgency} urgency • ${requestRow.status.replace(/_/g, " ").toLowerCase()}${requestRow.totalPartsCost ? ` • parts ${formatCurrency(requestRow.totalPartsCost)}` : ""}.`,
          severity:
            requestRow.urgency === "CRITICAL"
              ? ("CRITICAL" as const)
              : requestRow.urgency === "HIGH"
                ? ("HIGH" as const)
                : ("MEDIUM" as const),
          amount: requestRow.totalPartsCost || null,
          href: buildHref("/maintenance"),
          issueType: "MAINTENANCE",
          targetId: requestRow.id,
          sectionId: "maintenance-log-section",
          targetPageKey: "maintenance"
        })),
      navigationTargets: [
        {
          label: "Open Maintenance Approvals",
          href: buildHref("/approvals", { tab: "maintenance" }),
          reason: "Clear maintenance approval queue.",
          pageKey: "approvals",
          sectionId: "approvals-tab-maintenance"
        },
        {
          label: "Open Inventory Usage Approvals",
          href: buildHref("/approvals", { tab: "inventory-usage" }),
          reason: "Review maintenance-related parts usage approvals.",
          pageKey: "approvals",
          sectionId: "approvals-tab-inventory-usage"
        },
        {
          label: "Open Data Quality Center",
          href: buildHref("/data-quality/linkage-center"),
          reason: "Fix missing maintenance linkage records.",
          pageKey: "data-quality-linkage-center",
          sectionId: "missing-maintenance-section"
        },
        {
          label: "Open Rigs",
          href: buildHref("/rigs"),
          reason: "Inspect rigs with repeated maintenance demand.",
          pageKey: "rigs",
          sectionId: "rig-registry-section"
        }
      ],
      notes: ["Maintenance AI guidance is advisory-only and does not auto-approve workflow decisions."]
    }),
    [
      buildHref,
      completedCount,
      criticalCount,
      filters.clientId,
      filters.from,
      filters.rigId,
      filters.to,
      oldestPendingHours,
      repeatedRepairRigCount,
      rows,
      submittedCount,
      topMechanicWorkload,
      totalPartsCost,
      underReviewCount,
      waitingPartsCount
    ]
  );

  useRegisterCopilotContext(copilotContext);

  useCopilotFocusTarget({
    pageKey: "maintenance",
    onFocus: (target) => {
      setAssistTarget(target);
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

  useEffect(() => {
    if (!assistTarget) {
      return;
    }
    const timeout = window.setTimeout(() => setAssistTarget(null), 7000);
    return () => window.clearTimeout(timeout);
  }, [assistTarget]);

  const focusedMaintenanceRequest = useMemo(
    () => rows.find((entry) => entry.id === focusedRowId) || null,
    [focusedRowId, rows]
  );

  const maintenanceWorkflowAssist = useMemo<WorkflowAssistModel | null>(() => {
    if (!assistTarget && !focusedMaintenanceRequest) {
      return null;
    }

    const active = focusedMaintenanceRequest;
    const missingContext: string[] = [];
    if (active && !active.rig?.rigCode) {
      missingContext.push("Rig linkage is missing.");
    }
    if (active && active.photos.length === 0) {
      missingContext.push("Photo evidence has not been attached.");
    }
    if (active && !active.materialsNeeded.length) {
      missingContext.push("Parts/material requirements are not listed.");
    }
    if (active && !active.mechanic?.fullName) {
      missingContext.push("Assigned mechanic is missing.");
    }

    const isMechanic = user?.role === "MECHANIC";
    const roleLabel = isMechanic
      ? "Mechanic workflow assist"
      : user?.role === "OFFICE"
        ? "Office maintenance assist"
        : "Manager maintenance assist";

    const repeatedRigRequests = active?.rig?.id
      ? rows.filter((row) => row.rig?.id === active.rig?.id && row.status !== "COMPLETED").length
      : 0;

    return {
      heading: "Maintenance Workflow Assist",
      roleLabel,
      tone:
        active?.urgency === "CRITICAL" || active?.status === "WAITING_FOR_PARTS" ? "amber" : "indigo",
      whyThisMatters:
        assistTarget?.reason ||
        (active
          ? `${active.urgency} maintenance request on ${active.rig?.rigCode || "unlinked rig"} can affect uptime and parts planning.`
          : "This maintenance queue area was prioritized by copilot for workflow review."),
      inspectFirst: [
        "Inspect urgency versus operational downtime estimate.",
        "Verify parts dependency and current stock impact.",
        "Check photo/evidence quality and issue description clarity.",
        "Confirm if this rig has repeat-failure patterns."
      ],
      missingContext,
      checklist: [
        "Inspect urgency",
        "Verify downtime",
        "Confirm parts dependency",
        "Check photo evidence",
        "Review repeat-failure history"
      ],
      recommendedNextStep: active
        ? repeatedRigRequests >= 2
          ? "Prioritize this request and confirm root-cause follow-up to avoid repeat downtime."
          : "Review evidence and parts readiness, then move this request through the next status step."
        : "Open a highlighted maintenance request and run the checklist before updating status."
    };
  }, [assistTarget, focusedMaintenanceRequest, rows, user?.role]);

  async function submitMaintenanceRequest(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setErrorMessage(null);
    setNotice(null);

    try {
      const parsedParts = form.partsUsed
        .map((entry) => ({
          itemId: entry.itemId,
          quantity: Number(entry.quantity)
        }))
        .filter((entry) => entry.itemId && Number.isFinite(entry.quantity) && entry.quantity > 0);

      const response = await fetch("/api/maintenance-requests", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          requestDate: form.requestDate,
          rigId: form.rigId,
          clientId: form.clientId || null,
          projectId: form.projectId || null,
          issueDescription: form.issueDescription,
          materialsNeeded: form.materialsNeeded,
          urgency: form.urgency,
          estimatedDowntimeHrs: Number(form.estimatedDowntimeHrs || 0),
          notes: form.notes || null,
          photoUrls: form.photoUrls
            .split(",")
            .map((entry) => entry.trim())
            .filter((entry) => entry.length > 0),
          partsUsed: parsedParts
        })
      });

      if (!response.ok) {
        throw new Error(await readApiError(response, "Failed to submit maintenance request."));
      }

      setNotice("Maintenance request submitted.");
      setForm({
        requestDate: new Date().toISOString().slice(0, 10),
        rigId: "",
        clientId: "",
        projectId: "",
        urgency: "MEDIUM",
        issueDescription: "",
        materialsNeeded: "",
        estimatedDowntimeHrs: "",
        notes: "",
        photoUrls: "",
        partsUsed: [{ itemId: "", quantity: "" }]
      });
      await loadMaintenance();
      await loadReferenceData();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to submit maintenance request.");
    } finally {
      setSubmitting(false);
    }
  }

  function updatePart(index: number, key: "itemId" | "quantity", value: string) {
    setForm((current) => ({
      ...current,
      partsUsed: current.partsUsed.map((entry, entryIndex) =>
        entryIndex === index
          ? {
              ...entry,
              [key]: value
            }
          : entry
      )
    }));
  }

  function addPartRow() {
    setForm((current) => {
      if (current.partsUsed.length >= 4) {
        return current;
      }
      return {
        ...current,
        partsUsed: [...current.partsUsed, { itemId: "", quantity: "" }]
      };
    });
  }

  function removePartRow(index: number) {
    setForm((current) => ({
      ...current,
      partsUsed:
        current.partsUsed.length <= 1
          ? [{ itemId: "", quantity: "" }]
          : current.partsUsed.filter((_, entryIndex) => entryIndex !== index)
    }));
  }

  return (
    <div className="gf-page-stack">
      {notice && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{notice}</div>
      )}
      {errorMessage && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{errorMessage}</div>
      )}

      <FilterScopeBanner filters={filters} clientLabel={selectedClientLabel} rigLabel={selectedRigLabel} />

      <section>
        <WorkflowAssistPanel model={maintenanceWorkflowAssist} />
      </section>

      <section className="grid gap-3 md:grid-cols-4">
        <MetricCard label="Submitted" value={String(submittedCount)} />
        <MetricCard label="Under Review" value={String(underReviewCount)} tone="warn" />
        <MetricCard label="Waiting for Parts" value={String(waitingPartsCount)} tone="warn" />
        <MetricCard label="Completed" value={String(completedCount)} tone="good" />
      </section>

      {canSubmit && (
        <Card title="Mechanic Maintenance Request Form" subtitle="Submit damage reports, required parts, urgency, and downtime estimate">
          <form onSubmit={submitMaintenanceRequest} className="grid gap-3 md:grid-cols-2">
            <InputField label="Request Date" type="date" value={form.requestDate} onChange={(value) => setForm((current) => ({ ...current, requestDate: value }))} required />
            <SelectField
              label="Rig"
              value={form.rigId}
              onChange={(value) => setForm((current) => ({ ...current, rigId: value }))}
              options={[
                { value: "", label: "Select rig" },
                ...rigs.map((rig) => ({ value: rig.id, label: rig.rigCode }))
              ]}
              required
            />
            <SelectField
              label="Client"
              value={form.clientId}
              onChange={(value) =>
                setForm((current) => ({
                  ...current,
                  clientId: value,
                  projectId: value && current.projectId && !projects.some((project) => project.id === current.projectId && project.clientId === value) ? "" : current.projectId
                }))
              }
              options={[
                { value: "", label: "Company Level / Not Linked" },
                ...clients.map((client) => ({ value: client.id, label: client.name }))
              ]}
            />
            <SelectField
              label="Project"
              value={form.projectId}
              onChange={(value) => setForm((current) => ({ ...current, projectId: value }))}
              options={[
                { value: "", label: "Not linked to project" },
                ...filteredProjects.map((project) => ({ value: project.id, label: project.name }))
              ]}
            />
            <SelectField
              label="Urgency"
              value={form.urgency}
              onChange={(value) => setForm((current) => ({ ...current, urgency: value as MaintenanceFormState["urgency"] }))}
              options={[
                { value: "LOW", label: "LOW" },
                { value: "MEDIUM", label: "MEDIUM" },
                { value: "HIGH", label: "HIGH" },
                { value: "CRITICAL", label: "CRITICAL" }
              ]}
            />
            <InputField
              label="Estimated Downtime (hrs)"
              type="number"
              value={form.estimatedDowntimeHrs}
              onChange={(value) => setForm((current) => ({ ...current, estimatedDowntimeHrs: value }))}
              placeholder="12"
            />
            <TextAreaField
              className="md:col-span-2"
              label="Issue Description"
              value={form.issueDescription}
              onChange={(value) => setForm((current) => ({ ...current, issueDescription: value }))}
              placeholder="Describe issue..."
              required
            />
            <TextAreaField
              className="md:col-span-2"
              label="Materials Needed"
              value={form.materialsNeeded}
              onChange={(value) => setForm((current) => ({ ...current, materialsNeeded: value }))}
              placeholder="List parts/materials..."
            />

            {canManageInventoryUsage && (
              <div className="md:col-span-2 space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-ink-900">Parts Used (Optional)</p>
                  <button
                    type="button"
                    onClick={addPartRow}
                    className="rounded border border-slate-200 bg-white px-2 py-1 text-xs text-ink-700 hover:bg-slate-100"
                  >
                    Add Part
                  </button>
                </div>
                {form.partsUsed.map((entry, index) => (
                  <div key={`part-${index}`} className="grid gap-2 md:grid-cols-[1fr_180px_auto]">
                    <SelectField
                      label={`Item ${index + 1}`}
                      value={entry.itemId}
                      onChange={(value) => updatePart(index, "itemId", value)}
                      options={[
                        { value: "", label: "Select item" },
                        ...inventoryItems.map((item) => ({
                          value: item.id,
                          label: `${item.name} (${item.sku}) - Stock ${formatNumber(item.quantityInStock)}`
                        }))
                      ]}
                    />
                    <InputField
                      label="Quantity"
                      type="number"
                      value={entry.quantity}
                      onChange={(value) => updatePart(index, "quantity", value)}
                      placeholder="0"
                    />
                    <div className="flex items-end">
                      <button
                        type="button"
                        onClick={() => removePartRow(index)}
                        className="w-full rounded border border-red-200 bg-white px-2 py-2 text-xs text-red-700 hover:bg-red-50"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <InputField
              className="md:col-span-2"
              label="Photo URLs (comma separated)"
              value={form.photoUrls}
              onChange={(value) => setForm((current) => ({ ...current, photoUrls: value }))}
              placeholder="https://.../damage1.jpg, https://.../damage2.jpg"
            />
            <TextAreaField
              className="md:col-span-2"
              label="Notes"
              value={form.notes}
              onChange={(value) => setForm((current) => ({ ...current, notes: value }))}
              placeholder="Additional notes..."
            />
            <button
              type="submit"
              disabled={submitting}
              className="md:col-span-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting ? "Submitting..." : "Submit Maintenance Request"}
            </button>
          </form>
        </Card>
      )}

      <section
        id="maintenance-log-section"
        className={cn(
          focusedSectionId === "maintenance-log-section" && "rounded-2xl ring-2 ring-indigo-100 ring-offset-2 ring-offset-slate-50"
        )}
      >
      <Card title="Maintenance Requests Log" subtitle="Live maintenance records with linked parts usage and cost">
        {loading ? (
          <p className="text-sm text-ink-600">Loading maintenance requests...</p>
        ) : rows.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-4 text-sm text-ink-600">
            No maintenance requests found for current filters.
          </p>
        ) : (
          <DataTable
            columns={[
              "Request",
              "Date",
              "Rig",
              "Client",
              "Project",
              "Mechanic",
              "Issue",
              "Materials",
              "Urgency",
              "Photos",
              "Downtime",
              "Parts Used",
              "Parts Cost",
              "Status",
              "Approval Notes"
            ]}
            rows={rows.map((requestRow) => [
              requestRow.requestCode,
              requestRow.date,
              requestRow.rig?.rigCode || requestRow.rigId,
              requestRow.client?.name || "Company",
              requestRow.project?.name || "-",
              requestRow.mechanic?.fullName || requestRow.mechanic?.id || "-",
              requestRow.issueDescription,
              requestRow.materialsNeeded.length > 0 ? requestRow.materialsNeeded.join(", ") : "-",
              requestRow.urgency,
              requestRow.photos.length > 0 ? `${requestRow.photos.length} image(s)` : "None",
              `${formatNumber(requestRow.estimatedDowntimeHours)} hrs`,
              requestRow.partsUsed.length > 0 ? `${requestRow.partsUsed.length} item(s)` : "None",
              formatCurrency(requestRow.totalPartsCost || 0),
              <MaintenanceStatusBadge key={`${requestRow.id}-status`} status={requestRow.status} />,
              requestRow.approvalNotes || "-"
            ])}
            rowIds={rows.map((requestRow) => `ai-focus-${requestRow.id}`)}
            rowClassNames={rows.map((requestRow) =>
              focusedRowId === requestRow.id ? "bg-indigo-50 ring-1 ring-inset ring-indigo-200" : ""
            )}
          />
        )}
      </Card>
      </section>
    </div>
  );
}

function InputField({
  label,
  type = "text",
  value,
  onChange,
  placeholder,
  required,
  className
}: {
  label: string;
  type?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  required?: boolean;
  className?: string;
}) {
  return (
    <label className={`text-sm text-ink-700 ${className || ""}`}>
      <span className="mb-1 block">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        required={required}
        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none ring-brand-300 focus:ring"
      />
    </label>
  );
}

function TextAreaField({
  label,
  value,
  onChange,
  placeholder,
  className,
  required
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  required?: boolean;
}) {
  return (
    <label className={`text-sm text-ink-700 ${className || ""}`}>
      <span className="mb-1 block">{label}</span>
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        required={required}
        rows={3}
        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none ring-brand-300 focus:ring"
      />
    </label>
  );
}

function SelectField({
  label,
  value,
  onChange,
  options,
  required,
  className
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  required?: boolean;
  className?: string;
}) {
  return (
    <label className={`text-sm text-ink-700 ${className || ""}`}>
      <span className="mb-1 block">{label}</span>
      <select
        value={value}
        required={required}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none ring-brand-300 focus:ring"
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

async function readApiError(response: Response, fallbackMessage: string) {
  const clone = response.clone();
  const payload = await response.json().catch(() => null);
  if (payload && typeof payload === "object" && "message" in payload) {
    const message = payload.message;
    if (typeof message === "string" && message.trim()) {
      return message;
    }
  }

  const rawBody = (await clone.text().catch(() => "")).trim();
  if (rawBody) {
    return rawBody;
  }

  return `${fallbackMessage} (HTTP ${response.status})`;
}

function calculatePendingHours(value: string) {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  const diffMs = Date.now() - parsed.getTime();
  return diffMs > 0 ? Math.round(diffMs / (1000 * 60 * 60)) : 0;
}
