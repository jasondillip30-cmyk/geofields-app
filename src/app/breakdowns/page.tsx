"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { useRegisterCopilotContext } from "@/components/layout/ai-copilot-context";
import { useAnalyticsFilters } from "@/components/layout/analytics-filters-provider";
import {
  scrollToFocusElement,
  useCopilotFocusTarget
} from "@/components/layout/copilot-focus-target";
import {
  breakdownRowSortValue,
  getProjectRigIds
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
import { BreakdownsPageView } from "@/app/breakdowns/breakdowns-page-view";
import type { CopilotPageContext } from "@/lib/ai/contextual-copilot";
import { isBreakdownOpenStatus, normalizeBreakdownStatus } from "@/lib/breakdown-lifecycle";
import { buildScopedHref } from "@/lib/drilldown";

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
    <BreakdownsPageView
      notice={notice}
      errorMessage={errorMessage}
      isSingleProjectScope={isSingleProjectScope}
      scopeProjectId={scopeProjectId}
      scopedProject={scopedProject}
      effectiveProject={effectiveProject}
      effectiveProjectRigOptions={effectiveProjectRigOptions}
      activeProjects={activeProjects}
      selectedRigCode={selectedRigCode}
      form={form}
      setForm={setForm}
      formError={formError}
      submitBreakdown={submitBreakdown}
      submitting={submitting}
      focusedSectionId={focusedSectionId}
      openRecordsCount={openRecords.length}
      criticalCount={criticalCount}
      blockedProjectCount={blockedProjectCount}
      totalDowntime={totalDowntime}
      logOpen={logOpen}
      setLogOpen={setLogOpen}
      logFilters={logFilters}
      setLogFilters={setLogFilters}
      projects={projects}
      rigFilterOptions={rigFilterOptions}
      loading={loading}
      rigHistoryRows={rigHistoryRows}
      selectedRigHistoryId={selectedRigHistoryId}
      openRigDetail={openRigDetail}
      focusedRowId={focusedRowId}
      rigDetailOpen={rigDetailOpen}
      rigDetailSelectedRig={rigDetailSelectedRig}
      rigDetailCases={rigDetailCases}
      rigDetailCaseSummary={rigDetailCaseSummary}
      rigDetailLoading={rigDetailLoading}
      rigDetailError={rigDetailError}
      closeRigDetail={closeRigDetail}
      openCaseFromRigDetail={openCaseFromRigDetail}
      detailOpen={detailOpen}
      selectedRecord={selectedRecord}
      selectedRecordIsOpen={selectedRecordIsOpen}
      resolvingId={resolvingId}
      linkedMaintenanceRows={linkedMaintenanceRows}
      linkedUsageRows={linkedUsageRows}
      linkedRequisitionRows={linkedRequisitionRows}
      auditRows={auditRows}
      detailLoading={detailLoading}
      detailError={detailError}
      closeBreakdownDetail={closeBreakdownDetail}
      goToBreakdownPartsRequest={goToBreakdownPartsRequest}
      goToBreakdownPurchaseRequest={goToBreakdownPurchaseRequest}
      resolveBreakdown={resolveBreakdown}
    />
  );
}
