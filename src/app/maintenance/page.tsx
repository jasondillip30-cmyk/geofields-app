"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { AccessGate } from "@/components/layout/access-gate";
import { useAnalyticsFilters } from "@/components/layout/analytics-filters-provider";
import { useRole } from "@/components/layout/role-provider";
import { Card } from "@/components/ui/card";
import { MaintenanceHistorySection } from "@/app/maintenance/maintenance-history-section";
import {
  getProjectRigIds,
  maintenanceRowSortValue,
  normalizeMaintenanceStatus
} from "@/app/maintenance/maintenance-page-utils";
import {
  INITIAL_FORM_STATE,
  INITIAL_LOG_FILTERS,
  MAINTENANCE_TYPE_OPTIONS,
  STEP_ITEMS,
  type AuditRow,
  type BreakdownOption,
  type LinkedRequisitionRow,
  type LinkedUsageRequestRow,
  type LogFilterState,
  type MaintenanceFormState,
  type MaintenanceRow,
  type MaintenanceWizardStep,
  type ProjectOption,
  type RigMaintenanceHistoryRow,
  type RigOption,
  validateMaintenanceStep as validateMaintenanceFormStep
} from "@/app/maintenance/maintenance-page-types";
import { MaintenanceRecordDetailModal, MaintenanceRigDetailModal } from "@/app/maintenance/maintenance-page-modals";
import { MaintenanceReportWizardCard } from "@/app/maintenance/maintenance-report-wizard-card";
import { canReportMaintenanceActivity } from "@/lib/auth/approval-policy";

export default function MaintenancePage() {
  return (
    <AccessGate permission="maintenance:view">
      <Suspense fallback={<MaintenanceWorkspaceFallback />}>
        <MaintenanceWorkspace />
      </Suspense>
    </AccessGate>
  );
}

function MaintenanceWorkspaceFallback() {
  return (
    <div className="gf-page-stack">
      <Card title="Maintenance">
        <p className="text-sm text-ink-600">Loading maintenance workspace...</p>
      </Card>
    </div>
  );
}

function MaintenanceWorkspace() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { filters } = useAnalyticsFilters();
  const { user } = useRole();
  const canReportMaintenance = canReportMaintenanceActivity(user?.role);
  const breakdownPrefillId = searchParams.get("breakdownId")?.trim() || "";
  const hasBreakdownPrefill = Boolean(breakdownPrefillId);
  const scopeProjectId = filters.projectId !== "all" ? filters.projectId : "";
  const isSingleProjectScope = scopeProjectId.length > 0;

  const [wizardStep, setWizardStep] = useState<MaintenanceWizardStep>(1);
  const [form, setForm] = useState<MaintenanceFormState>(INITIAL_FORM_STATE);
  const [logFilters, setLogFilters] = useState<LogFilterState>(INITIAL_LOG_FILTERS);
  const [rigs, setRigs] = useState<RigOption[]>([]);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [breakdowns, setBreakdowns] = useState<BreakdownOption[]>([]);
  const [rows, setRows] = useState<MaintenanceRow[]>([]);
  const [loadingRefs, setLoadingRefs] = useState(true);
  const [loadingRows, setLoadingRows] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [prefillApplied, setPrefillApplied] = useState(false);
  const [logOpen, setLogOpen] = useState(true);

  const [selectedRecordId, setSelectedRecordId] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [linkedUsageRows, setLinkedUsageRows] = useState<LinkedUsageRequestRow[]>([]);
  const [linkedRequisitionRows, setLinkedRequisitionRows] = useState<LinkedRequisitionRow[]>([]);
  const [auditRows, setAuditRows] = useState<AuditRow[]>([]);
  const [resolvingRecordId, setResolvingRecordId] = useState<string | null>(null);
  const [selectedRigHistoryId, setSelectedRigHistoryId] = useState<string | null>(null);
  const [rigDetailOpen, setRigDetailOpen] = useState(false);
  const [rigDetailLoading, setRigDetailLoading] = useState(false);
  const [rigDetailError, setRigDetailError] = useState<string | null>(null);
  const [rigDetailCases, setRigDetailCases] = useState<MaintenanceRow[]>([]);

  const selectedRig = useMemo(
    () => rigs.find((entry) => entry.id === form.rigId) || null,
    [form.rigId, rigs]
  );
  const scopedProject = useMemo(
    () => projects.find((entry) => entry.id === scopeProjectId) || null,
    [projects, scopeProjectId]
  );
  const scopedProjectRigIds = useMemo(() => getProjectRigIds(scopedProject), [scopedProject]);
  const scopedProjectRigOptions = useMemo(
    () => rigs.filter((entry) => scopedProjectRigIds.includes(entry.id)),
    [rigs, scopedProjectRigIds]
  );
  const rigOptionsForForm = useMemo(
    () => (isSingleProjectScope ? scopedProjectRigOptions : rigs),
    [isSingleProjectScope, rigs, scopedProjectRigOptions]
  );
  const shouldSkipRigSelectionStep = isSingleProjectScope && scopedProjectRigOptions.length === 1;
  const activeProjectForSelectedRig = useMemo(
    () =>
      projects.find(
        (entry) =>
          entry.status === "ACTIVE" &&
          (entry.assignedRigId === form.rigId || entry.backupRigId === form.rigId)
      ) || null,
    [form.rigId, projects]
  );
  const projectContextForForm = isSingleProjectScope ? scopedProject : activeProjectForSelectedRig;
  const linkedBreakdown = useMemo(
    () => breakdowns.find((entry) => entry.id === form.linkedBreakdownId) || null,
    [breakdowns, form.linkedBreakdownId]
  );
  const breakdownOptionsForRig = useMemo(() => {
    if (!form.rigId) {
      return isSingleProjectScope
        ? breakdowns.filter((entry) => entry.project?.id === scopeProjectId)
        : breakdowns;
    }
    return breakdowns.filter(
      (entry) =>
        entry.rig?.id === form.rigId &&
        (!isSingleProjectScope || entry.project?.id === scopeProjectId)
    );
  }, [breakdowns, form.rigId, isSingleProjectScope, scopeProjectId]);
  const selectedRecord = useMemo(
    () => rows.find((entry) => entry.id === selectedRecordId) || null,
    [rows, selectedRecordId]
  );
  const statusCounts = useMemo(() => {
    return rows.reduce(
      (acc, entry) => {
        const normalized = normalizeMaintenanceStatus(entry.status).status;
        acc.total += 1;
        if (normalized === "OPEN") acc.open += 1;
        if (normalized === "IN_REPAIR") acc.inRepair += 1;
        if (normalized === "WAITING_FOR_PARTS") acc.waitingParts += 1;
        if (normalized === "COMPLETED") acc.completed += 1;
        return acc;
      },
      {
        total: 0,
        open: 0,
        inRepair: 0,
        waitingParts: 0,
        completed: 0
      }
    );
  }, [rows]);
  const rowsWithLocalLinkFilter = useMemo(() => {
    if (logFilters.linkage === "linked") {
      return rows.filter((entry) => Boolean(entry.breakdownReportId));
    }
    if (logFilters.linkage === "unlinked") {
      return rows.filter((entry) => !entry.breakdownReportId);
    }
    return rows;
  }, [logFilters.linkage, rows]);
  const rigHistoryRows = useMemo(() => {
    const byRig = new Map<string, RigMaintenanceHistoryRow>();
    for (const row of rowsWithLocalLinkFilter) {
      const rigId = row.rig?.id || row.rigId;
      const rigCode = row.rig?.rigCode || row.rigId;
      const existing = byRig.get(rigId);
      if (existing) {
        existing.cases.push(row);
      } else {
        byRig.set(rigId, {
          rigId,
          rigCode,
          currentStatus: null,
          latestMaintenanceDate: row.date,
          caseCount: 0,
          cases: [row]
        });
      }
    }

    return Array.from(byRig.values())
      .map((entry) => {
        const cases = [...entry.cases].sort(
          (a, b) => maintenanceRowSortValue(b) - maintenanceRowSortValue(a)
        );
        const activeCase = cases.find(
          (row) => normalizeMaintenanceStatus(row.status).status !== "COMPLETED"
        );

        return {
          ...entry,
          cases,
          caseCount: cases.length,
          latestMaintenanceDate: cases[0]?.date || "-",
          currentStatus: activeCase
            ? normalizeMaintenanceStatus(activeCase.status).status
            : null
        };
      })
      .sort((a, b) => {
        const byLatest =
          maintenanceRowSortValue(b.cases[0]) - maintenanceRowSortValue(a.cases[0]);
        if (byLatest !== 0) {
          return byLatest;
        }
        return a.rigCode.localeCompare(b.rigCode);
      });
  }, [rowsWithLocalLinkFilter]);
  const rigDetailSelectedRig = useMemo(
    () => rigHistoryRows.find((entry) => entry.rigId === selectedRigHistoryId) || null,
    [rigHistoryRows, selectedRigHistoryId]
  );
  const rigDetailCaseSummary = useMemo(
    () =>
      rigDetailCases.reduce(
        (acc, entry) => {
          const status = normalizeMaintenanceStatus(entry.status).status;
          acc.total += 1;
          if (status === "OPEN") acc.open += 1;
          if (status === "IN_REPAIR") acc.inRepair += 1;
          if (status === "WAITING_FOR_PARTS") acc.waitingParts += 1;
          if (status === "COMPLETED") acc.completed += 1;
          return acc;
        },
        {
          total: 0,
          open: 0,
          inRepair: 0,
          waitingParts: 0,
          completed: 0
        }
      ),
    [rigDetailCases]
  );
  const isPrefilledFromBreakdown = hasBreakdownPrefill && Boolean(form.linkedBreakdownId);
  const validateMaintenanceStep = useCallback(
    (step: MaintenanceWizardStep) => {
      const baseError = validateMaintenanceFormStep(step, form);
      if (baseError) {
        return baseError;
      }
      if (step === 1 && isSingleProjectScope) {
        if (!scopedProject) {
          return "Select an active project in the top bar first.";
        }
        if (scopedProjectRigOptions.length === 0) {
          return "This project has no assigned rig. Assign a rig to the project first.";
        }
      }
      return null;
    },
    [form, isSingleProjectScope, scopedProject, scopedProjectRigOptions.length]
  );
  const activeWizardStep: MaintenanceWizardStep =
    shouldSkipRigSelectionStep && wizardStep === 1 ? 2 : wizardStep;
  const currentStepError = useMemo(
    () => validateMaintenanceStep(activeWizardStep),
    [activeWizardStep, validateMaintenanceStep]
  );
  const detailsStepNumber = shouldSkipRigSelectionStep ? 1 : 2;
  const saveStepNumber = shouldSkipRigSelectionStep ? 2 : 3;
  const visibleWizardSteps = useMemo(
    () => (shouldSkipRigSelectionStep ? STEP_ITEMS.filter((entry) => entry.step !== 1) : STEP_ITEMS),
    [shouldSkipRigSelectionStep]
  );
  const loadMaintenanceRows = useCallback(async () => {
    setLoadingRows(true);
    setErrorMessage(null);
    try {
      const query = new URLSearchParams();
      if (isSingleProjectScope) {
        query.set("projectId", scopeProjectId);
      }
      if (logFilters.rigId) query.set("rigId", logFilters.rigId);
      if (logFilters.status !== "all") query.set("status", logFilters.status);
      if (logFilters.from) query.set("from", logFilters.from);
      if (logFilters.to) query.set("to", logFilters.to);

      const response = await fetch(`/api/maintenance-requests?${query.toString()}`, {
        cache: "no-store"
      });
      const payload = (await response.json().catch(() => null)) as
        | { data?: MaintenanceRow[]; message?: string }
        | null;
      if (!response.ok) {
        throw new Error(payload?.message || "Failed to load maintenance log.");
      }
      setRows(Array.isArray(payload?.data) ? payload.data : []);
    } catch (error) {
      setRows([]);
      setErrorMessage(
        error instanceof Error ? error.message : "Failed to load maintenance log."
      );
    } finally {
      setLoadingRows(false);
    }
  }, [
    isSingleProjectScope,
    logFilters.from,
    logFilters.rigId,
    logFilters.status,
    logFilters.to,
    scopeProjectId
  ]);

  useEffect(() => {
    void loadMaintenanceRows();
  }, [loadMaintenanceRows]);

  useEffect(() => {
    if (!notice) {
      return;
    }
    const timeout = window.setTimeout(() => setNotice(null), 5000);
    return () => window.clearTimeout(timeout);
  }, [notice]);

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
    if (!breakdownPrefillId || prefillApplied) {
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(`/api/breakdowns/${breakdownPrefillId}`, {
          cache: "no-store"
        });
        const payload = (await response.json().catch(() => null)) as
          | {
              data?: {
                id?: string;
                title?: string;
                description?: string;
                downtimeHours?: number;
                rig?: { id?: string };
              };
            }
          | null;
        if (!response.ok || cancelled || !payload?.data) {
          return;
        }
        const breakdown = payload.data;
        const breakdownId = typeof breakdown.id === "string" ? breakdown.id : "";
        if (!breakdownId) {
          return;
        }
        const title = typeof breakdown.title === "string" ? breakdown.title.trim() : "";
        const description =
          typeof breakdown.description === "string"
            ? breakdown.description.trim()
            : "";
        setForm((current) => ({
          ...current,
          rigId:
            current.rigId ||
            (typeof breakdown.rig?.id === "string" ? breakdown.rig.id : ""),
          linkedBreakdownId: breakdownId,
          maintenanceType: current.maintenanceType || "OTHER",
          estimatedDowntimeHrs:
            current.estimatedDowntimeHrs ||
            (typeof breakdown.downtimeHours === "number" && breakdown.downtimeHours > 0
              ? String(breakdown.downtimeHours)
              : ""),
          issueDescription:
            current.issueDescription ||
            (description ? `${title}: ${description}` : title)
        }));
        setNotice("Linked breakdown prefilled.");
        setPrefillApplied(true);
      } catch {
        // keep flow usable even when prefill fails
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [breakdownPrefillId, prefillApplied]);

  useEffect(() => {
    if (!isSingleProjectScope) {
      return;
    }
    setForm((current) => {
      const allowedRigIds = scopedProjectRigOptions.map((entry) => entry.id);
      if (allowedRigIds.length === 1) {
        const onlyRigId = allowedRigIds[0];
        if (current.rigId === onlyRigId) {
          return current;
        }
        return {
          ...current,
          rigId: onlyRigId,
          linkedBreakdownId: ""
        };
      }
      if (!current.rigId || allowedRigIds.includes(current.rigId)) {
        return current;
      }
      return {
        ...current,
        rigId: "",
        linkedBreakdownId: ""
      };
    });
  }, [isSingleProjectScope, scopedProjectRigOptions]);

  useEffect(() => {
    if (!shouldSkipRigSelectionStep) {
      return;
    }
    setWizardStep((current) => (current === 1 ? 2 : current));
  }, [shouldSkipRigSelectionStep]);

  useEffect(() => {
    if (!isSingleProjectScope) {
      return;
    }
    setLogFilters((current) => {
      if (!current.rigId || scopedProjectRigIds.includes(current.rigId)) {
        return current;
      }
      return {
        ...current,
        rigId: ""
      };
    });
  }, [isSingleProjectScope, scopedProjectRigIds]);

  const loadReferenceData = useCallback(async () => {
    setLoadingRefs(true);
    try {
      const breakdownsQuery = new URLSearchParams({ status: "OPEN" });
      if (isSingleProjectScope) {
        breakdownsQuery.set("projectId", scopeProjectId);
      }
      const [rigsRes, projectsRes, breakdownsRes] = await Promise.all([
        fetch("/api/rigs", { cache: "no-store" }),
        fetch("/api/projects", { cache: "no-store" }),
        fetch(`/api/breakdowns?${breakdownsQuery.toString()}`, { cache: "no-store" })
      ]);
      const [rigsPayload, projectsPayload, breakdownsPayload] = await Promise.all([
        rigsRes.ok ? rigsRes.json() : Promise.resolve({ data: [] }),
        projectsRes.ok ? projectsRes.json() : Promise.resolve({ data: [] }),
        breakdownsRes.ok ? breakdownsRes.json() : Promise.resolve({ data: [] })
      ]);

      setRigs(
        Array.isArray(rigsPayload.data)
          ? rigsPayload.data.map((entry: { id: string; rigCode: string; status: string }) => ({
              id: entry.id,
              rigCode: entry.rigCode,
              status: entry.status
            }))
          : []
      );
      setProjects(
        Array.isArray(projectsPayload.data)
          ? projectsPayload.data.map(
              (entry: {
                id: string;
                name: string;
                status: string;
                clientId: string;
                client?: { name: string } | null;
                assignedRigId?: string | null;
                backupRigId?: string | null;
              }) => ({
                id: entry.id,
                name: entry.name,
                status: entry.status,
                clientId: entry.clientId,
                assignedRigId: entry.assignedRigId || null,
                backupRigId: entry.backupRigId || null,
                client: entry.client || null
              })
            )
          : []
      );
      setBreakdowns(
        Array.isArray(breakdownsPayload.data)
          ? breakdownsPayload.data.map(
              (entry: {
                id: string;
                title: string;
                severity: string;
                status: string;
                project?: { id: string; name: string } | null;
                rig?: { id: string; rigCode: string } | null;
              }) => ({
                id: entry.id,
                title: entry.title,
                severity: entry.severity,
                status: entry.status,
                project: entry.project || null,
                rig: entry.rig || null
              })
            )
          : []
      );
    } finally {
      setLoadingRefs(false);
    }
  }, [isSingleProjectScope, scopeProjectId]);

  useEffect(() => {
    void loadReferenceData();
  }, [loadReferenceData]);

  function continueWizard() {
    const validationError = validateMaintenanceStep(activeWizardStep);
    if (validationError) {
      setErrorMessage(validationError);
      return;
    }
    setErrorMessage(null);
    setWizardStep((current) => {
      const effectiveCurrent =
        shouldSkipRigSelectionStep && current === 1 ? 2 : current;
      return effectiveCurrent < 3
        ? ((effectiveCurrent + 1) as MaintenanceWizardStep)
        : effectiveCurrent;
    });
  }

  function backWizard() {
    setErrorMessage(null);
    setWizardStep((current) => {
      const effectiveCurrent =
        shouldSkipRigSelectionStep && current === 1 ? 2 : current;
      if (shouldSkipRigSelectionStep && effectiveCurrent <= 2) {
        return 2;
      }
      return effectiveCurrent > 1
        ? ((effectiveCurrent - 1) as MaintenanceWizardStep)
        : effectiveCurrent;
    });
  }

  async function saveMaintenance() {
    if (!canReportMaintenance) {
      setErrorMessage("You do not have permission to report maintenance activity.");
      return;
    }

    for (const step of [1, 2] as MaintenanceWizardStep[]) {
      const validationError = validateMaintenanceStep(step);
      if (validationError) {
        setWizardStep(step);
        setErrorMessage(validationError);
        return;
      }
    }

    setSubmitting(true);
    setErrorMessage(null);
    try {
      const response = await fetch("/api/maintenance-requests", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          requestDate: form.requestDate,
          rigId: form.rigId,
          projectId: projectContextForForm?.id || null,
          clientId: projectContextForForm?.clientId || null,
          breakdownReportId: form.linkedBreakdownId || null,
          issueType: form.maintenanceType,
          issueDescription: form.issueDescription.trim(),
          status: form.status,
          estimatedDowntimeHrs: Number(form.estimatedDowntimeHrs || 0),
          notes: form.notes.trim() || null
        })
      });
      const payload = (await response.json().catch(() => null)) as
        | { message?: string }
        | null;
      if (!response.ok) {
        throw new Error(payload?.message || "Failed to save maintenance report.");
      }

      setNotice("Maintenance activity recorded.");
      setForm(INITIAL_FORM_STATE);
      setWizardStep(shouldSkipRigSelectionStep ? 2 : 1);
      await loadMaintenanceRows();
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Failed to save maintenance report."
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function openRecordDetail(recordId: string) {
    setSelectedRecordId(recordId);
    setDetailOpen(true);
    setDetailLoading(true);
    setDetailError(null);
    try {
      const usageQuery = new URLSearchParams({
        maintenanceRequestId: recordId,
        scope: "all",
        status: "ALL"
      });
      const requisitionsQuery = new URLSearchParams({
        maintenanceRequestId: recordId
      });
      const auditQuery = new URLSearchParams({
        entityType: "maintenance_request",
        entityId: recordId,
        limit: "20"
      });

      const [usageRes, requisitionsRes, auditRes] = await Promise.all([
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

      const usagePayload = (await usageRes.json().catch(() => null)) as
        | { data?: LinkedUsageRequestRow[] }
        | null;
      const requisitionPayload = (await requisitionsRes.json().catch(() => null)) as
        | { data?: LinkedRequisitionRow[] }
        | null;
      const auditPayload = (await auditRes.json().catch(() => null)) as
        | { data?: AuditRow[]; message?: string }
        | null;

      if (!usageRes.ok) {
        throw new Error("Failed to load linked inventory usage requests.");
      }
      if (!requisitionsRes.ok) {
        throw new Error("Failed to load linked purchase requests.");
      }

      setLinkedUsageRows(Array.isArray(usagePayload?.data) ? usagePayload.data : []);
      setLinkedRequisitionRows(
        Array.isArray(requisitionPayload?.data) ? requisitionPayload.data : []
      );

      if (auditRes.ok) {
        setAuditRows(Array.isArray(auditPayload?.data) ? auditPayload.data : []);
      } else {
        setAuditRows([]);
      }
    } catch (error) {
      setLinkedUsageRows([]);
      setLinkedRequisitionRows([]);
      setAuditRows([]);
      setDetailError(
        error instanceof Error
          ? error.message
          : "Failed to load maintenance case details."
      );
    } finally {
      setDetailLoading(false);
    }
  }

  async function openRigDetail(rigId: string) {
    setSelectedRigHistoryId(rigId);
    setRigDetailOpen(true);
    setRigDetailLoading(true);
    setRigDetailError(null);

    try {
      const maintenanceQuery = new URLSearchParams({ rigId });
      if (isSingleProjectScope) {
        maintenanceQuery.set("projectId", scopeProjectId);
      }
      const maintenanceRes = await fetch(
        `/api/maintenance-requests?${maintenanceQuery.toString()}`,
        {
          cache: "no-store"
        }
      );
      const maintenancePayload = (await maintenanceRes.json().catch(() => null)) as
        | { data?: MaintenanceRow[]; message?: string }
        | null;

      if (!maintenanceRes.ok) {
        throw new Error(maintenancePayload?.message || "Failed to load maintenance history.");
      }

      const maintenanceRows = Array.isArray(maintenancePayload?.data)
        ? [...maintenancePayload.data].sort(
            (a, b) => maintenanceRowSortValue(b) - maintenanceRowSortValue(a)
          )
        : [];

      setRigDetailCases(maintenanceRows);
    } catch (error) {
      setRigDetailCases([]);
      setRigDetailError(
        error instanceof Error ? error.message : "Failed to load rig maintenance detail."
      );
    } finally {
      setRigDetailLoading(false);
    }
  }

  function closeRigDetail() {
    setRigDetailOpen(false);
    setRigDetailLoading(false);
    setRigDetailError(null);
    setRigDetailCases([]);
  }

  function closeRecordDetail() {
    setDetailOpen(false);
    setSelectedRecordId(null);
    setDetailError(null);
    setDetailLoading(false);
    setLinkedUsageRows([]);
    setLinkedRequisitionRows([]);
    setAuditRows([]);
  }

  async function markMaintenanceResolved() {
    if (!selectedRecord) {
      return;
    }

    setResolvingRecordId(selectedRecord.id);
    setErrorMessage(null);
    try {
      const response = await fetch("/api/maintenance-requests", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: selectedRecord.id,
          action: "resolve"
        })
      });
      const payload = (await response.json().catch(() => null)) as
        | { message?: string; data?: MaintenanceRow }
        | null;
      if (!response.ok) {
        throw new Error(payload?.message || "Failed to resolve maintenance record.");
      }
      setNotice("Maintenance marked as completed.");
      await loadMaintenanceRows();
      if (selectedRecordId) {
        await openRecordDetail(selectedRecordId);
      }
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Failed to resolve maintenance record."
      );
    } finally {
      setResolvingRecordId(null);
    }
  }

  function goToInventoryRequest() {
    if (!selectedRecord) {
      return;
    }
    if (normalizeMaintenanceStatus(selectedRecord.status).status === "COMPLETED") {
      setErrorMessage("Completed maintenance cases are read-only.");
      return;
    }
    const query = new URLSearchParams({
      section: "items",
      usageReason: "MAINTENANCE",
      maintenanceRequestId: selectedRecord.id
    });
    closeRecordDetail();
    router.push(`/inventory?${query.toString()}`);
  }

  function goToPurchaseRequest() {
    if (!selectedRecord) {
      return;
    }
    if (normalizeMaintenanceStatus(selectedRecord.status).status === "COMPLETED") {
      setErrorMessage("Completed maintenance cases are read-only.");
      return;
    }
    const query = new URLSearchParams({
      maintenanceRequestId: selectedRecord.id
    });
    if (selectedRecord.project?.id) {
      query.set("projectId", selectedRecord.project.id);
    }
    if (selectedRecord.breakdownReportId) {
      query.set("breakdownId", selectedRecord.breakdownReportId);
    }
    closeRecordDetail();
    router.push(`/expenses?${query.toString()}`);
  }

  function openCaseFromRigDetail(recordId: string) {
    closeRigDetail();
    void openRecordDetail(recordId);
  }

  const selectedRecordStatus = selectedRecord
    ? normalizeMaintenanceStatus(selectedRecord.status).status
    : null;

  return (
    <div className="gf-page-stack">
      {notice && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-emerald-200/90 bg-emerald-50/70 px-3.5 py-2.5 text-sm text-emerald-900">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-2 w-2 rounded-full bg-emerald-500" aria-hidden />
            <p className="font-medium">{notice}</p>
          </div>
          <button
            type="button"
            onClick={() => setNotice(null)}
            className="shrink-0 rounded-md px-2 py-1 text-xs font-semibold text-emerald-900 hover:bg-emerald-100"
          >
            Dismiss
          </button>
        </div>
      )}
      {errorMessage && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {errorMessage}
        </div>
      )}
      <MaintenanceReportWizardCard
        shouldSkipRigSelectionStep={shouldSkipRigSelectionStep}
        visibleWizardSteps={visibleWizardSteps}
        activeWizardStep={activeWizardStep}
        isSingleProjectScope={isSingleProjectScope}
        scopedProject={scopedProject}
        scopedProjectRigOptions={scopedProjectRigOptions}
        rigOptionsForForm={rigOptionsForForm}
        loadingRefs={loadingRefs}
        form={form}
        setForm={setForm}
        isPrefilledFromBreakdown={isPrefilledFromBreakdown}
        linkedBreakdown={linkedBreakdown}
        breakdownOptionsForRig={breakdownOptionsForRig}
        selectedRig={selectedRig}
        projectContextForForm={projectContextForForm}
        detailsStepNumber={detailsStepNumber}
        saveStepNumber={saveStepNumber}
        maintenanceTypeOptions={MAINTENANCE_TYPE_OPTIONS}
        canReportMaintenance={canReportMaintenance}
        submitting={submitting}
        currentStepError={currentStepError}
        onContinueWizard={continueWizard}
        onBackWizard={backWizard}
        onSave={() => {
          void saveMaintenance();
        }}
      />

      <MaintenanceHistorySection
        isSingleProjectScope={isSingleProjectScope}
        scopedProjectName={scopedProject?.name || null}
        logOpen={logOpen}
        onToggleLogOpen={() => setLogOpen((current) => !current)}
        statusCounts={statusCounts}
        logFilters={logFilters}
        setLogFilters={setLogFilters}
        scopedProjectRigOptions={scopedProjectRigOptions}
        rigs={rigs}
        loadingRows={loadingRows}
        rigHistoryRows={rigHistoryRows}
        selectedRigHistoryId={selectedRigHistoryId}
        onOpenRigDetail={(rigId) => {
          void openRigDetail(rigId);
        }}
      />

      <MaintenanceRigDetailModal
        open={rigDetailOpen}
        selectedRig={rigDetailSelectedRig}
        loading={rigDetailLoading}
        error={rigDetailError}
        cases={rigDetailCases}
        summary={rigDetailCaseSummary}
        onClose={closeRigDetail}
        onOpenCase={openCaseFromRigDetail}
      />

      <MaintenanceRecordDetailModal
        open={detailOpen}
        selectedRecord={selectedRecord}
        selectedRecordStatus={selectedRecordStatus}
        resolvingRecordId={resolvingRecordId}
        loading={detailLoading}
        error={detailError}
        linkedUsageRows={linkedUsageRows}
        linkedRequisitionRows={linkedRequisitionRows}
        auditRows={auditRows}
        onClose={closeRecordDetail}
        onRequestItem={goToInventoryRequest}
        onCreatePurchaseRequest={goToPurchaseRequest}
        onResolve={() => {
          void markMaintenanceResolved();
        }}
      />
    </div>
  );
}
