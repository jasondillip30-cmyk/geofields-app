"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { AccessGate } from "@/components/layout/access-gate";
import { useRegisterCopilotContext } from "@/components/layout/ai-copilot-context";
import { useAnalyticsFilters } from "@/components/layout/analytics-filters-provider";
import {
  scrollToFocusElement,
  useCopilotFocusTarget
} from "@/components/layout/copilot-focus-target";
import { ProjectLockedBanner } from "@/components/layout/project-locked-banner";
import { Card } from "@/components/ui/card";
import { DataTable } from "@/components/ui/table";
import {
  BreakdownStatusChip,
  breakdownRowSortValue,
  formatMaintenanceLifecycleStatus,
  formatBreakdownCurrentState,
  getProjectRigIds,
  toDate,
  toDateTime
} from "@/app/breakdowns/breakdowns-page-utils";
import {
  INITIAL_FORM_STATE,
  INITIAL_LOG_FILTER_STATE,
  type AuditRow,
  type BreakdownFormState,
  type BreakdownLogFilterState,
  type BreakdownRecord,
  type LinkedMaintenanceRow,
  type LinkedRequisitionRow,
  type LinkedUsageRequestRow,
  type ProjectOption,
  type RigBreakdownHistoryRow,
  type RigOption
} from "@/app/breakdowns/breakdowns-page-types";
import type { CopilotPageContext } from "@/lib/ai/contextual-copilot";
import { isBreakdownOpenStatus, normalizeBreakdownStatus } from "@/lib/breakdown-lifecycle";
import { buildScopedHref } from "@/lib/drilldown";
import { cn, formatCurrency, formatNumber } from "@/lib/utils";

export default function BreakdownsPage() {
  const router = useRouter();
  const { filters } = useAnalyticsFilters();
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [rigs, setRigs] = useState<RigOption[]>([]);
  const [records, setRecords] = useState<BreakdownRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [focusedRowId, setFocusedRowId] = useState<string | null>(null);
  const [focusedSectionId, setFocusedSectionId] = useState<string | null>(null);
  const [logOpen, setLogOpen] = useState(true);
  const [logFilters, setLogFilters] = useState<BreakdownLogFilterState>(
    INITIAL_LOG_FILTER_STATE
  );
  const [form, setForm] = useState<BreakdownFormState>(INITIAL_FORM_STATE);
  const [selectedRecordId, setSelectedRecordId] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [linkedMaintenanceRows, setLinkedMaintenanceRows] = useState<LinkedMaintenanceRow[]>([]);
  const [linkedUsageRows, setLinkedUsageRows] = useState<LinkedUsageRequestRow[]>([]);
  const [linkedRequisitionRows, setLinkedRequisitionRows] = useState<LinkedRequisitionRow[]>([]);
  const [auditRows, setAuditRows] = useState<AuditRow[]>([]);
  const [selectedRigHistoryId, setSelectedRigHistoryId] = useState<string | null>(null);
  const [rigDetailOpen, setRigDetailOpen] = useState(false);
  const [rigDetailLoading, setRigDetailLoading] = useState(false);
  const [rigDetailError, setRigDetailError] = useState<string | null>(null);
  const [rigDetailCases, setRigDetailCases] = useState<BreakdownRecord[]>([]);
  const scopeProjectId = filters.projectId !== "all" ? filters.projectId : "";
  const isSingleProjectScope = scopeProjectId.length > 0;

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const breakdownsQuery = new URLSearchParams();
      if (isSingleProjectScope) {
        breakdownsQuery.set("projectId", scopeProjectId);
      }
      const breakdownsUrl = breakdownsQuery.size
        ? `/api/breakdowns?${breakdownsQuery.toString()}`
        : "/api/breakdowns";
      const [projectsRes, rigsRes, recordsRes] = await Promise.all([
        fetch("/api/projects", { cache: "no-store" }),
        fetch("/api/rigs", { cache: "no-store" }),
        fetch(breakdownsUrl, { cache: "no-store" })
      ]);

      const [projectsData, rigsData, recordsData] = await Promise.all([
        projectsRes.json(),
        rigsRes.json(),
        recordsRes.json()
      ]);

      setProjects(projectsData.data || []);
      setRigs(rigsData.data || []);
      setRecords(
        Array.isArray(recordsData.data)
          ? recordsData.data.map((entry: BreakdownRecord) => ({
              ...entry,
              status: normalizeBreakdownStatus(entry.status)
            }))
          : []
      );
    } finally {
      setLoading(false);
    }
  }, [isSingleProjectScope, scopeProjectId]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  useEffect(() => {
    if (!notice) {
      return;
    }
    const timeout = window.setTimeout(() => setNotice(null), 5000);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === form.projectId) || null,
    [form.projectId, projects]
  );
  const scopedProject = useMemo(
    () => projects.find((project) => project.id === scopeProjectId) || null,
    [projects, scopeProjectId]
  );
  const effectiveProject = isSingleProjectScope ? scopedProject : selectedProject;
  const scopedProjectRigIds = useMemo(() => getProjectRigIds(scopedProject), [scopedProject]);
  const effectiveProjectRigIds = useMemo(
    () => getProjectRigIds(effectiveProject),
    [effectiveProject]
  );
  const effectiveProjectRigOptions = useMemo(
    () => rigs.filter((rig) => effectiveProjectRigIds.includes(rig.id)),
    [effectiveProjectRigIds, rigs]
  );
  const rigFilterOptions = useMemo(
    () =>
      isSingleProjectScope
        ? rigs.filter((rig) => scopedProjectRigIds.includes(rig.id))
        : rigs,
    [isSingleProjectScope, rigs, scopedProjectRigIds]
  );

  useEffect(() => {
    if (!isSingleProjectScope) {
      return;
    }
    if (!scopedProject) {
      return;
    }
    setForm((current) =>
      current.projectId === scopedProject.id
        ? current
        : { ...current, projectId: scopedProject.id, rigId: "" }
    );
  }, [isSingleProjectScope, scopedProject]);

  useEffect(() => {
    if (!effectiveProject) {
      return;
    }
    if (effectiveProjectRigOptions.length === 1) {
      const onlyRigId = effectiveProjectRigOptions[0].id;
      setForm((current) =>
        current.rigId === onlyRigId ? current : { ...current, rigId: onlyRigId }
      );
      return;
    }
    if (
      effectiveProjectRigOptions.length > 1 &&
      form.rigId &&
      !effectiveProjectRigOptions.some((rig) => rig.id === form.rigId)
    ) {
      setForm((current) => ({ ...current, rigId: "" }));
    }
    if (effectiveProjectRigOptions.length === 0 && form.rigId) {
      setForm((current) => ({ ...current, rigId: "" }));
    }
  }, [effectiveProject, effectiveProjectRigOptions, form.rigId]);

  useEffect(() => {
    if (!isSingleProjectScope) {
      return;
    }
    setLogFilters((current) => {
      const scopedRigId =
        current.rigId && scopedProjectRigIds.includes(current.rigId) ? current.rigId : "";
      if (current.projectId === scopeProjectId && current.rigId === scopedRigId) {
        return current;
      }
      return {
        ...current,
        projectId: scopeProjectId,
        rigId: scopedRigId
      };
    });
  }, [isSingleProjectScope, scopeProjectId, scopedProjectRigIds]);

  const selectedRigCode = useMemo(() => {
    if (effectiveProjectRigOptions.length === 1) {
      return effectiveProjectRigOptions[0]?.rigCode || "";
    }
    if (!form.rigId) {
      return "";
    }
    return rigs.find((rig) => rig.id === form.rigId)?.rigCode || "";
  }, [effectiveProjectRigOptions, form.rigId, rigs]);
  const openRecords = useMemo(
    () => records.filter((record) => isBreakdownOpenStatus(record.status)),
    [records]
  );
  const criticalCount = useMemo(
    () => openRecords.filter((record) => record.severity === "CRITICAL").length,
    [openRecords]
  );
  const blockedProjectCount = useMemo(
    () => new Set(openRecords.map((record) => record.project.id)).size,
    [openRecords]
  );
  const totalDowntime = useMemo(
    () => records.reduce((sum, record) => sum + record.downtimeHours, 0),
    [records]
  );
  const activeProjects = useMemo(
    () => projects.filter((project) => project.status === "ACTIVE"),
    [projects]
  );
  const filteredRecords = useMemo(() => {
    return records.filter((record) => {
      if (logFilters.projectId && record.project?.id !== logFilters.projectId) {
        return false;
      }
      if (logFilters.rigId && record.rig?.id !== logFilters.rigId) {
        return false;
      }
      const normalizedStatus = normalizeBreakdownStatus(record.status);
      if (logFilters.status !== "all" && normalizedStatus !== logFilters.status) {
        return false;
      }
      const reportDate = new Date(record.reportDate).toISOString().slice(0, 10);
      if (logFilters.from && reportDate < logFilters.from) {
        return false;
      }
      if (logFilters.to && reportDate > logFilters.to) {
        return false;
      }
      return true;
    });
  }, [logFilters.from, logFilters.projectId, logFilters.rigId, logFilters.status, logFilters.to, records]);
  const rigHistoryRows = useMemo(() => {
    const rigIdByCode = new Map(rigs.map((entry) => [entry.rigCode, entry.id] as const));
    const byRig = new Map<string, RigBreakdownHistoryRow>();

    for (const row of filteredRecords) {
      const rigCode = row.rig?.rigCode || "Unassigned rig";
      const resolvedRigId =
        row.rig?.id || (row.rig?.rigCode ? rigIdByCode.get(row.rig.rigCode) || null : null);
      const rigGroupId = resolvedRigId || `rig-code-${rigCode.toLowerCase()}`;
      const existing = byRig.get(rigGroupId);
      if (existing) {
        existing.cases.push(row);
        if (!existing.resolvedRigId && resolvedRigId) {
          existing.resolvedRigId = resolvedRigId;
        }
      } else {
        byRig.set(rigGroupId, {
          rigId: rigGroupId,
          resolvedRigId,
          rigCode,
          currentStatus: null,
          latestBreakdownDate: row.reportDate,
          caseCount: 0,
          cases: [row]
        });
      }
    }

    return Array.from(byRig.values())
      .map((entry) => {
        const cases = [...entry.cases].sort(
          (a, b) => breakdownRowSortValue(b) - breakdownRowSortValue(a)
        );
        const hasOpenCase = cases.some((row) => isBreakdownOpenStatus(row.status));

        return {
          ...entry,
          cases,
          caseCount: cases.length,
          latestBreakdownDate: cases[0]?.reportDate || "",
          currentStatus: hasOpenCase ? "OPEN" : "RESOLVED"
        };
      })
      .sort((a, b) => {
        const byLatest = breakdownRowSortValue(b.cases[0]) - breakdownRowSortValue(a.cases[0]);
        if (byLatest !== 0) {
          return byLatest;
        }
        return a.rigCode.localeCompare(b.rigCode);
      });
  }, [filteredRecords, rigs]);
  const rigDetailSelectedRig = useMemo(
    () => rigHistoryRows.find((entry) => entry.rigId === selectedRigHistoryId) || null,
    [rigHistoryRows, selectedRigHistoryId]
  );
  const rigDetailCaseSummary = useMemo(
    () =>
      rigDetailCases.reduce(
        (acc, entry) => {
          const status = normalizeBreakdownStatus(entry.status);
          acc.total += 1;
          if (status === "OPEN") {
            acc.open += 1;
          } else {
            acc.resolved += 1;
          }
          if (entry.severity === "CRITICAL") {
            acc.critical += 1;
          }
          return acc;
        },
        {
          total: 0,
          open: 0,
          resolved: 0,
          critical: 0
        }
      ),
    [rigDetailCases]
  );
  const selectedRecord = useMemo(
    () => records.find((entry) => entry.id === selectedRecordId) || null,
    [records, selectedRecordId]
  );
  const formError = useMemo(() => {
    if (!effectiveProject) {
      return isSingleProjectScope
        ? "Select an active project in the top bar first."
        : "Select the affected active project.";
    }
    if (effectiveProjectRigOptions.length === 0) {
      return "This project has no assigned rig. Assign a rig to the project first.";
    }
    if (effectiveProjectRigOptions.length > 1 && !form.rigId) {
      return "Select one of the project rigs.";
    }
    if (!form.title.trim()) {
      return "Enter a short issue summary.";
    }
    return null;
  }, [
    effectiveProject,
    effectiveProjectRigOptions.length,
    form.rigId,
    form.title,
    isSingleProjectScope
  ]);

  const buildHref = useMemo(
    () =>
      (
        path: string,
        overrides?: Record<string, string | null | undefined>
      ) => buildScopedHref(filters, path, overrides),
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
        { key: "criticalBreakdowns", label: "Critical Open", value: criticalCount },
        { key: "openBreakdowns", label: "Open Breakdowns", value: openRecords.length },
        { key: "blockedProjects", label: "Blocked Projects", value: blockedProjectCount },
        { key: "downtimeHours", label: "Estimated Downtime Hours", value: totalDowntime }
      ],
      tablePreviews: [
        {
          key: "breakdown-log",
          title: "Breakdown Log",
          rowCount: records.length,
          columns: ["Date", "Issue", "Project", "Rig", "Severity", "Status"],
          rows: records.slice(0, 10).map((record) => ({
            id: record.id,
            date: new Date(record.reportDate).toISOString().slice(0, 10),
            issue: record.title,
            project: record.project?.name || "-",
            rig: record.rig?.rigCode || "-",
            severity: record.severity,
            status: normalizeBreakdownStatus(record.status),
            href: buildHref("/breakdowns"),
            targetId: record.id,
            sectionId: "breakdown-log-section",
            targetPageKey: "breakdowns"
          }))
        }
      ],
      priorityItems: openRecords
        .sort((a, b) => b.downtimeHours - a.downtimeHours)
        .slice(0, 5)
        .map((record) => ({
          id: record.id,
          label: `${record.rig?.rigCode || "Unassigned Rig"} • ${record.title}`,
          reason: `${record.severity} breakdown with ${record.downtimeHours.toFixed(
            1
          )} estimated downtime hour(s).`,
          severity:
            record.severity === "CRITICAL"
              ? ("CRITICAL" as const)
              : record.severity === "HIGH"
                ? ("HIGH" as const)
                : ("MEDIUM" as const),
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
          reason: "Create and manage repair work linked to breakdowns.",
          pageKey: "maintenance",
          sectionId: "maintenance-log-section"
        },
        {
          label: "Open Purchase Requests",
          href: buildHref("/expenses"),
          reason: "Create breakdown-linked procurement requests.",
          pageKey: "expenses",
          sectionId: "expenses-requisition-workflow"
        }
      ],
      notes: [
        "Breakdowns are operational events; maintenance and purchasing should link back to the event."
      ]
    }),
    [
      blockedProjectCount,
      buildHref,
      criticalCount,
      filters.clientId,
      filters.from,
      filters.rigId,
      filters.to,
      openRecords,
      records,
      totalDowntime
    ]
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

  useEffect(() => {
    if (rigHistoryRows.length === 0) {
      setSelectedRigHistoryId(null);
      return;
    }

    setSelectedRigHistoryId((current) =>
      current && rigHistoryRows.some((entry) => entry.rigId === current)
        ? current
        : rigHistoryRows[0].rigId
    );
  }, [rigHistoryRows]);

  useEffect(() => {
    if (!rigDetailOpen || !selectedRigHistoryId) {
      return;
    }
    const rigCases =
      rigHistoryRows.find((entry) => entry.rigId === selectedRigHistoryId)?.cases || [];
    setRigDetailCases(rigCases);
    setRigDetailError(null);
    setRigDetailLoading(false);
  }, [rigDetailOpen, rigHistoryRows, selectedRigHistoryId]);

  async function submitBreakdown(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (formError) {
      setErrorMessage(formError);
      return;
    }

    setSubmitting(true);
    setErrorMessage(null);
    try {
      const selectedRigId =
        form.rigId || (effectiveProjectRigOptions.length === 1 ? effectiveProjectRigOptions[0].id : "");
      const selectedProjectId = effectiveProject?.id || form.projectId;
      const response = await fetch("/api/breakdowns", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          projectId: selectedProjectId,
          rigId: selectedRigId || null,
          title: form.title.trim(),
          description: form.description.trim(),
          severity: form.severity,
          downtimeHours: form.downtimeHours ? Number(form.downtimeHours) : 0
        })
      });

      const payload = (await response.json().catch(() => null)) as
        | { message?: string }
        | null;
      if (!response.ok) {
        throw new Error(payload?.message || "Failed to submit breakdown.");
      }

      setForm(INITIAL_FORM_STATE);
      setNotice(
        "Breakdown reported. Project is on hold and rig status is now marked as breakdown."
      );
      await loadAll();
    } catch (submitError) {
      setErrorMessage(
        submitError instanceof Error
          ? submitError.message
          : "Failed to submit breakdown."
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function resolveBreakdown(record: BreakdownRecord) {
    const note = window.prompt(
      "Optional resolution note (short):",
      ""
    );
    if (note === null) {
      return;
    }

    setResolvingId(record.id);
    setErrorMessage(null);
    try {
      const response = await fetch(`/api/breakdowns/${record.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          action: "resolve",
          resolutionNote: note.trim() || null
        })
      });
      const payload = (await response.json().catch(() => null)) as
        | { message?: string }
        | null;
      if (!response.ok) {
        throw new Error(payload?.message || "Failed to resolve breakdown.");
      }
      setNotice(
        "Breakdown marked as resolved. Project and rig statuses were refreshed."
      );
      await loadAll();
      if (selectedRecordId && selectedRecordId === record.id) {
        await loadBreakdownDetail(record.id);
      }
    } catch (resolveError) {
      setErrorMessage(
        resolveError instanceof Error
          ? resolveError.message
          : "Failed to resolve breakdown."
      );
    } finally {
      setResolvingId(null);
    }
  }

  async function openBreakdownDetail(recordId: string) {
    setSelectedRecordId(recordId);
    setDetailOpen(true);
    await loadBreakdownDetail(recordId);
  }

  function openRigDetail(rigId: string) {
    setSelectedRigHistoryId(rigId);
    setRigDetailOpen(true);
    setRigDetailLoading(false);
    setRigDetailError(null);
    const rigCases = rigHistoryRows.find((entry) => entry.rigId === rigId)?.cases || [];
    setRigDetailCases(rigCases);
  }

  function closeBreakdownDetail() {
    setDetailOpen(false);
    setSelectedRecordId(null);
    setDetailError(null);
    setDetailLoading(false);
    setLinkedMaintenanceRows([]);
    setLinkedUsageRows([]);
    setLinkedRequisitionRows([]);
    setAuditRows([]);
  }

  function closeRigDetail() {
    setRigDetailOpen(false);
    setRigDetailLoading(false);
    setRigDetailError(null);
    setRigDetailCases([]);
  }

  function openCaseFromRigDetail(recordId: string) {
    closeRigDetail();
    void openBreakdownDetail(recordId);
  }

  async function loadBreakdownDetail(recordId: string) {
    setDetailLoading(true);
    setDetailError(null);
    try {
      const usageQuery = new URLSearchParams({
        breakdownReportId: recordId,
        scope: "all",
        status: "ALL"
      });
      const maintenanceQuery = new URLSearchParams({
        breakdownReportId: recordId
      });
      const requisitionsQuery = new URLSearchParams({
        breakdownReportId: recordId
      });
      const auditQuery = new URLSearchParams({
        entityType: "breakdown_report",
        entityId: recordId,
        limit: "20"
      });

      const [maintenanceRes, usageRes, requisitionsRes, auditRes] = await Promise.all([
        fetch(`/api/maintenance-requests?${maintenanceQuery.toString()}`, {
          cache: "no-store"
        }),
        fetch(`/api/inventory/usage-requests?${usageQuery.toString()}`, {
          cache: "no-store"
        }),
        fetch(`/api/requisitions?${requisitionsQuery.toString()}`, {
          cache: "no-store"
        }),
        fetch(`/api/audit-logs?${auditQuery.toString()}`, {
          cache: "no-store"
        })
      ]);

      const maintenancePayload = (await maintenanceRes.json().catch(() => null)) as
        | { data?: LinkedMaintenanceRow[] }
        | null;
      const usagePayload = (await usageRes.json().catch(() => null)) as
        | { data?: LinkedUsageRequestRow[] }
        | null;
      const requisitionPayload = (await requisitionsRes.json().catch(() => null)) as
        | { data?: LinkedRequisitionRow[] }
        | null;
      const auditPayload = (await auditRes.json().catch(() => null)) as
        | { data?: AuditRow[] }
        | null;

      if (!maintenanceRes.ok) {
        throw new Error("Failed to load linked maintenance records.");
      }
      if (!usageRes.ok) {
        throw new Error("Failed to load linked inventory usage requests.");
      }
      if (!requisitionsRes.ok) {
        throw new Error("Failed to load linked purchase requests.");
      }

      setLinkedMaintenanceRows(
        Array.isArray(maintenancePayload?.data) ? maintenancePayload.data : []
      );
      setLinkedUsageRows(Array.isArray(usagePayload?.data) ? usagePayload.data : []);
      setLinkedRequisitionRows(
        Array.isArray(requisitionPayload?.data) ? requisitionPayload.data : []
      );
      setAuditRows(auditRes.ok && Array.isArray(auditPayload?.data) ? auditPayload.data : []);
    } catch (error) {
      setLinkedMaintenanceRows([]);
      setLinkedUsageRows([]);
      setLinkedRequisitionRows([]);
      setAuditRows([]);
      setDetailError(
        error instanceof Error
          ? error.message
          : "Failed to load breakdown case details."
      );
    } finally {
      setDetailLoading(false);
    }
  }

  function goToBreakdownPartsRequest(record: BreakdownRecord) {
    const query = new URLSearchParams({
      section: "items",
      usageReason: "BREAKDOWN",
      breakdownId: record.id
    });
    closeBreakdownDetail();
    router.push(`/inventory?${query.toString()}`);
  }

  function goToBreakdownPurchaseRequest(record: BreakdownRecord) {
    const query = new URLSearchParams({
      breakdownId: record.id
    });
    if (record.project?.id) {
      query.set("projectId", record.project.id);
    }
    closeBreakdownDetail();
    router.push(`/expenses?${query.toString()}`);
  }

  const selectedRecordIsOpen = selectedRecord
    ? isBreakdownOpenStatus(selectedRecord.status)
    : false;

  return (
    <AccessGate permission="breakdowns:view">
      <div className="gf-page-stack">
        {notice && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            {notice}
          </div>
        )}
        {errorMessage && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {errorMessage}
          </div>
        )}
        {isSingleProjectScope ? (
          <ProjectLockedBanner
            projectId={scopeProjectId}
            projectName={scopedProject?.name || null}
          />
        ) : null}

        <AccessGate permission="breakdowns:submit">
          <Card
            title="Report breakdown"
            subtitle="Capture the issue quickly, then continue with repair actions."
          >
            <form onSubmit={submitBreakdown} className="space-y-3">
              <div className="gf-guided-strip">
                <p className="gf-guided-strip-title">Guided workflow</p>
                <div className="gf-guided-step-list">
                  <p className="gf-guided-step">1. Confirm project rig context.</p>
                  <p className="gf-guided-step">2. Enter issue summary and severity.</p>
                  <p className="gf-guided-step">3. Save and continue with repair actions.</p>
                </div>
              </div>
              {isSingleProjectScope ? (
                <div className="rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-xs text-brand-900">
                  <p>
                    <span className="font-semibold">Project locked:</span>{" "}
                    {scopedProject?.name || "Selected project"}
                  </p>
                  <p>
                    <span className="font-semibold">Client:</span>{" "}
                    {scopedProject?.client?.name || "-"}
                  </p>
                  <p>
                    <span className="font-semibold">Allowed rigs:</span>{" "}
                    {effectiveProjectRigOptions.length > 0
                      ? effectiveProjectRigOptions.map((entry) => entry.rigCode).join(", ")
                      : "None"}
                  </p>
                </div>
              ) : null}
              {effectiveProject && effectiveProjectRigOptions.length === 0 ? (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  This project has no assigned rig. Assign a rig to the project first.
                </div>
              ) : null}
              <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
                {isSingleProjectScope ? (
                  <label className="text-sm text-ink-700">
                    Project
                    <input
                      value={scopedProject?.name || "Selected project"}
                      disabled
                      className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-slate-700"
                    />
                  </label>
                ) : (
                  <label className="text-sm text-ink-700">
                    Project
                    <select
                      value={form.projectId}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          projectId: event.target.value,
                          rigId: ""
                        }))
                      }
                      className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
                      required
                    >
                      <option value="">Select active project</option>
                      {activeProjects.map((project) => (
                        <option key={project.id} value={project.id}>
                          {project.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {effectiveProjectRigOptions.length > 1 ? (
                  <label className="text-sm text-ink-700">
                    Project rig
                    <select
                      value={form.rigId}
                      onChange={(event) =>
                        setForm((current) => ({ ...current, rigId: event.target.value }))
                      }
                      className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
                      required
                    >
                      <option value="">Select project rig</option>
                      {effectiveProjectRigOptions.map((rig) => (
                        <option key={rig.id} value={rig.id}>
                          {rig.rigCode}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : (
                  <label className="text-sm text-ink-700">
                    Project rig
                    <input
                      value={
                        selectedRigCode ||
                        (effectiveProject ? "No assigned project rig" : "Select project first")
                      }
                      disabled
                      className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-slate-700"
                    />
                  </label>
                )}
                <label className="text-sm text-ink-700">
                  Severity / priority
                  <select
                    value={form.severity}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        severity: event.target.value as BreakdownFormState["severity"]
                      }))
                    }
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
                  >
                    <option value="LOW">LOW</option>
                    <option value="MEDIUM">MEDIUM</option>
                    <option value="HIGH">HIGH</option>
                    <option value="CRITICAL">CRITICAL</option>
                  </select>
                </label>
                <label className="text-sm text-ink-700 lg:col-span-2">
                  Issue summary
                  <input
                    value={form.title}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, title: event.target.value }))
                    }
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
                    placeholder="e.g. Hydraulic pressure loss while drilling"
                    required
                  />
                </label>
                <label className="text-sm text-ink-700">
                  Estimated downtime (hrs)
                  <input
                    type="number"
                    min="0"
                    step="0.1"
                    value={form.downtimeHours}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        downtimeHours: event.target.value
                      }))
                    }
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
                    placeholder="Optional"
                  />
                </label>
                <label className="text-sm text-ink-700 lg:col-span-4">
                  Problem description (optional)
                  <textarea
                    value={form.description}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, description: event.target.value }))
                    }
                    className="mt-1 min-h-20 w-full rounded-lg border border-slate-200 px-3 py-2"
                    placeholder="Quick details for maintenance handoff"
                  />
                </label>
              </div>
              {effectiveProject && effectiveProjectRigOptions.length === 1 ? (
                <p className="rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-xs text-brand-900">
                  Project rig is fixed to {effectiveProjectRigOptions[0].rigCode}. Continue with issue details.
                </p>
              ) : null}

              <div className="flex flex-wrap items-center gap-2 border-t border-slate-200 pt-3">
                <button
                  type="submit"
                  disabled={submitting || Boolean(formError)}
                  className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
                >
                  {submitting ? "Reporting..." : "Report breakdown"}
                </button>
                {formError && <p className="text-xs text-amber-800">{formError}</p>}
              </div>
            </form>
          </Card>
        </AccessGate>

        <section
          id="breakdown-log-section"
          className={cn(
            focusedSectionId === "breakdown-log-section" &&
              "rounded-2xl ring-2 ring-indigo-100 ring-offset-2 ring-offset-slate-50"
          )}
        >
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">Breakdown Log</h2>
              <p className="text-xs text-slate-600">
                Open {openRecords.length} • Critical {criticalCount} • Blocked projects{" "}
                {blockedProjectCount} • Downtime {totalDowntime.toFixed(1)} hrs
              </p>
            </div>
            <button
              type="button"
              onClick={() => setLogOpen((current) => !current)}
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
            >
              {logOpen ? "Hide log" : "View log"}
            </button>
          </div>

          {logOpen && (
            <div className="space-y-3">
              <Card title="Log Filters">
                {isSingleProjectScope ? (
                  <p className="mb-3 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-xs text-brand-900">
                    Project locked to {scopedProject?.name || "selected project"}. Filters below apply only within this project.
                  </p>
                ) : null}
                <div className={`grid gap-3 md:grid-cols-2 ${isSingleProjectScope ? "lg:grid-cols-4" : "lg:grid-cols-5"}`}>
                  {!isSingleProjectScope ? (
                    <label className="text-sm text-ink-700">
                      Project
                      <select
                        value={logFilters.projectId}
                        onChange={(event) =>
                          setLogFilters((current) => ({
                            ...current,
                            projectId: event.target.value
                          }))
                        }
                        className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
                      >
                        <option value="">All projects</option>
                        {projects.map((project) => (
                          <option key={project.id} value={project.id}>
                            {project.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                  <label className="text-sm text-ink-700">
                    Rig
                    <select
                      value={logFilters.rigId}
                      onChange={(event) =>
                        setLogFilters((current) => ({
                          ...current,
                          rigId: event.target.value
                        }))
                      }
                      className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
                    >
                      <option value="">All rigs</option>
                      {rigFilterOptions.map((rig) => (
                        <option key={rig.id} value={rig.id}>
                          {rig.rigCode}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="text-sm text-ink-700">
                    Status
                    <select
                      value={logFilters.status}
                      onChange={(event) =>
                        setLogFilters((current) => ({
                          ...current,
                          status: event.target.value as BreakdownLogFilterState["status"]
                        }))
                      }
                      className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
                    >
                      <option value="all">All statuses</option>
                      <option value="OPEN">Open</option>
                      <option value="RESOLVED">Resolved</option>
                    </select>
                  </label>
                  <label className="text-sm text-ink-700">
                    From
                    <input
                      type="date"
                      value={logFilters.from}
                      onChange={(event) =>
                        setLogFilters((current) => ({ ...current, from: event.target.value }))
                      }
                      className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
                    />
                  </label>
                  <label className="text-sm text-ink-700">
                    To
                    <input
                      type="date"
                      value={logFilters.to}
                      onChange={(event) =>
                        setLogFilters((current) => ({ ...current, to: event.target.value }))
                      }
                      className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
                    />
                  </label>
                </div>
              </Card>

              <Card title="Rigs with Breakdown Activity">
                {loading ? (
                  <p className="text-sm text-ink-600">Loading breakdown records...</p>
                ) : rigHistoryRows.length === 0 ? (
                  <p className="text-sm text-slate-600">
                    No breakdown records found for the selected filters.
                  </p>
                ) : (
                  <DataTable
                    columns={[
                      "Rig",
                      "Current breakdown state",
                      "Breakdown cases",
                      "Latest breakdown",
                      "Action"
                    ]}
                    rows={rigHistoryRows.map((entry) => [
                      entry.rigCode,
                      entry.currentStatus ? (
                        <BreakdownStatusChip
                          key={`${entry.rigId}-state`}
                          status={entry.currentStatus}
                        />
                      ) : (
                        "No active case"
                      ),
                      formatNumber(entry.caseCount),
                      toDate(entry.latestBreakdownDate),
                      <button
                        key={`${entry.rigId}-view`}
                        type="button"
                        onClick={() => {
                          void openRigDetail(entry.rigId);
                        }}
                        className={`rounded-md border px-2 py-1 text-xs font-semibold ${
                          selectedRigHistoryId === entry.rigId
                            ? "border-brand-300 bg-brand-50 text-brand-800"
                            : "border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
                        }`}
                      >
                        View
                      </button>
                    ])}
                    rowClassNames={rigHistoryRows.map((entry) =>
                      focusedRowId && entry.cases.some((record) => record.id === focusedRowId)
                        ? "bg-indigo-50 ring-1 ring-inset ring-indigo-200"
                        : ""
                    )}
                  />
                )}
              </Card>
            </div>
          )}
        </section>

        {rigDetailOpen && (
          <div className="fixed inset-0 z-[88] flex items-center justify-center bg-slate-900/45 p-4">
            <section className="max-h-[90vh] w-full max-w-5xl overflow-y-auto rounded-2xl border border-slate-200 bg-white shadow-2xl">
              <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3">
                <div>
                  <h3 className="text-base font-semibold text-slate-900">
                    Rig Breakdown View{" "}
                    {rigDetailSelectedRig?.rigCode ? `• ${rigDetailSelectedRig.rigCode}` : ""}
                  </h3>
                  <p className="text-xs text-slate-600">
                    Rig-level breakdown summary and case list
                  </p>
                </div>
                <button
                  type="button"
                  onClick={closeRigDetail}
                  className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                >
                  Close
                </button>
              </div>

              <div className="space-y-4 px-4 py-4">
                <div className="grid gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-700 md:grid-cols-2 lg:grid-cols-4">
                  <p>
                    <span className="font-semibold">Rig:</span>{" "}
                    {rigDetailSelectedRig?.rigCode || "-"}
                  </p>
                  <p>
                    <span className="font-semibold">Current breakdown state:</span>{" "}
                    {formatBreakdownCurrentState(rigDetailSelectedRig?.currentStatus)}
                  </p>
                  <p>
                    <span className="font-semibold">Active breakdown case:</span>{" "}
                    {rigDetailCases.find((entry) => isBreakdownOpenStatus(entry.status))?.id ||
                      "None"}
                  </p>
                  <p>
                    <span className="font-semibold">Total breakdown cases:</span>{" "}
                    {formatNumber(rigDetailCases.length)}
                  </p>
                </div>

                {rigDetailError && (
                  <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                    {rigDetailError}
                  </p>
                )}

                {rigDetailLoading ? (
                  <p className="text-sm text-slate-600">Loading rig breakdown details...</p>
                ) : (
                  <div className="space-y-3">
                    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
                      <p>
                        Open breakdown cases:{" "}
                        <span className="font-semibold">{rigDetailCaseSummary.open}</span>
                      </p>
                      <p>
                        Resolved breakdown cases:{" "}
                        <span className="font-semibold">{rigDetailCaseSummary.resolved}</span>
                      </p>
                      <p>
                        Critical severity cases:{" "}
                        <span className="font-semibold">{rigDetailCaseSummary.critical}</span>
                      </p>
                      <p className="mt-1 text-slate-600">
                        Rig-level view is summary only. Open a case to see linked requests and
                        actions.
                      </p>
                    </div>

                    <Card title="Breakdown Cases">
                      {rigDetailCases.length === 0 ? (
                        <p className="text-sm text-slate-600">
                          No breakdown cases found for this rig.
                        </p>
                      ) : (
                        <DataTable
                          columns={[
                            "Breakdown case ID",
                            "Date opened",
                            "Issue summary",
                            "Severity",
                            "Status",
                            "View details"
                          ]}
                          rows={rigDetailCases.map((row) => [
                            row.id,
                            toDate(row.reportDate),
                            row.title || "-",
                            row.severity || "-",
                            <BreakdownStatusChip key={`${row.id}-rig-status`} status={row.status} />,
                            <button
                              key={`${row.id}-open`}
                              type="button"
                              onClick={() => openCaseFromRigDetail(row.id)}
                              className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                            >
                              View details
                            </button>
                          ])}
                        />
                      )}
                    </Card>
                  </div>
                )}
              </div>
            </section>
          </div>
        )}

        {detailOpen && selectedRecord && (
          <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-900/45 p-4">
            <section className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-2xl border border-slate-200 bg-white shadow-2xl">
              <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3">
                <div>
                  <h3 className="text-base font-semibold text-slate-900">
                    Breakdown Case {selectedRecord.id}
                  </h3>
                  <p className="text-xs text-slate-600">
                    Operational case details and next actions
                  </p>
                </div>
                <button
                  type="button"
                  onClick={closeBreakdownDetail}
                  className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                >
                  Close
                </button>
              </div>

              <div className="space-y-4 px-4 py-4">
                <div className="grid gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-700 md:grid-cols-2">
                  <p>
                    <span className="font-semibold">Breakdown ID:</span> {selectedRecord.id}
                  </p>
                  <p>
                    <span className="font-semibold">Status:</span>{" "}
                    {normalizeBreakdownStatus(selectedRecord.status)}
                  </p>
                  <p>
                    <span className="font-semibold">Project:</span>{" "}
                    {selectedRecord.project?.name || "-"}
                  </p>
                  <p>
                    <span className="font-semibold">Rig:</span>{" "}
                    {selectedRecord.rig?.rigCode || "-"}
                  </p>
                  <p>
                    <span className="font-semibold">Client:</span>{" "}
                    {selectedRecord.client?.name || "-"}
                  </p>
                  <p>
                    <span className="font-semibold">Date reported:</span>{" "}
                    {toDate(selectedRecord.reportDate)}
                  </p>
                  <p>
                    <span className="font-semibold">Severity:</span>{" "}
                    {selectedRecord.severity}
                  </p>
                  <p>
                    <span className="font-semibold">Downtime:</span>{" "}
                    {formatNumber(selectedRecord.downtimeHours)} hrs
                  </p>
                  <p className="md:col-span-2">
                    <span className="font-semibold">Issue summary:</span>{" "}
                    {selectedRecord.title}
                  </p>
                  <p className="md:col-span-2">
                    <span className="font-semibold">Problem description:</span>{" "}
                    {selectedRecord.description || "-"}
                  </p>
                </div>

                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => goToBreakdownPartsRequest(selectedRecord)}
                    disabled={!selectedRecordIsOpen}
                    className="rounded-md border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-800 hover:bg-indigo-100 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Request parts
                  </button>
                  <button
                    type="button"
                    onClick={() => goToBreakdownPurchaseRequest(selectedRecord)}
                    disabled={!selectedRecordIsOpen}
                    className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Create purchase request
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      void resolveBreakdown(selectedRecord);
                    }}
                    disabled={!selectedRecordIsOpen || resolvingId === selectedRecord.id}
                    className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-800 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {resolvingId === selectedRecord.id
                      ? "Resolving..."
                      : "Mark breakdown resolved"}
                  </button>
                </div>
                {!selectedRecordIsOpen && (
                  <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
                    This breakdown case is resolved. Linked history remains viewable, but new
                    item or purchase actions are disabled.
                  </p>
                )}

                {detailError && (
                  <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                    {detailError}
                  </p>
                )}

                {detailLoading ? (
                  <p className="text-sm text-slate-600">Loading linked case details...</p>
                ) : (
                  <div className="grid gap-3 lg:grid-cols-2">
                    <Card title="Linked Maintenance Records">
                      {linkedMaintenanceRows.length === 0 ? (
                        <p className="text-sm text-slate-600">
                          No linked maintenance records yet.
                        </p>
                      ) : (
                        <DataTable
                          columns={["Record", "Date", "Status", "Description"]}
                          rows={linkedMaintenanceRows.map((row) => [
                            row.requestCode,
                            toDate(row.requestDate),
                            formatMaintenanceLifecycleStatus(row.status),
                            row.issueDescription || "-"
                          ])}
                        />
                      )}
                    </Card>

                    <Card title="Linked Inventory Usage Requests">
                      {linkedUsageRows.length === 0 ? (
                        <p className="text-sm text-slate-600">
                          No linked inventory usage requests yet.
                        </p>
                      ) : (
                        <DataTable
                          columns={["Requested", "Item", "Qty", "Status", "Requester"]}
                          rows={linkedUsageRows.map((row) => [
                            toDate(row.createdAt),
                            row.item ? `${row.item.name} (${row.item.sku})` : "-",
                            formatNumber(row.quantity),
                            row.status,
                            row.requestedBy?.fullName || "-"
                          ])}
                        />
                      )}
                    </Card>

                    <Card title="Linked Purchase Requests">
                      {linkedRequisitionRows.length === 0 ? (
                        <p className="text-sm text-slate-600">
                          No linked purchase requests yet.
                        </p>
                      ) : (
                        <DataTable
                          columns={["Requisition", "Type", "Status", "Submitted", "Estimated"]}
                          rows={linkedRequisitionRows.map((row) => [
                            row.requisitionCode,
                            row.type,
                            row.status,
                            toDate(row.submittedAt),
                            formatCurrency(row.totals?.estimatedTotalCost || 0)
                          ])}
                        />
                      )}
                    </Card>

                    <Card title="Case Update History">
                      {auditRows.length === 0 ? (
                        <p className="text-sm text-slate-600">
                          No update history available for this record.
                        </p>
                      ) : (
                        <div className="space-y-2">
                          {auditRows.map((entry) => (
                            <div
                              key={entry.id}
                              className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700"
                            >
                              <p className="font-semibold text-slate-900">
                                {entry.action.replaceAll("_", " ")}
                              </p>
                              <p className="mt-0.5">
                                {entry.description || "Breakdown case updated."}
                              </p>
                              <p className="mt-0.5 text-slate-500">
                                {toDateTime(entry.createdAt)}
                                {entry.actorName ? ` • ${entry.actorName}` : ""}
                              </p>
                            </div>
                          ))}
                        </div>
                      )}
                    </Card>
                  </div>
                )}
              </div>
            </section>
          </div>
        )}
      </div>
    </AccessGate>
  );
}
