"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { AccessGate } from "@/components/layout/access-gate";
import { useRole } from "@/components/layout/role-provider";
import { Card } from "@/components/ui/card";
import { DataTable } from "@/components/ui/table";
import { canReportMaintenanceActivity } from "@/lib/auth/approval-policy";
import { formatCurrency, formatNumber } from "@/lib/utils";

type MaintenanceWizardStep = 1 | 2 | 3;
type OperationalMaintenanceStatus =
  | "OPEN"
  | "IN_REPAIR"
  | "WAITING_FOR_PARTS"
  | "COMPLETED";

interface RigOption {
  id: string;
  rigCode: string;
  status: string;
}

interface ProjectOption {
  id: string;
  name: string;
  status: string;
  clientId: string;
  assignedRigId: string | null;
}

interface BreakdownOption {
  id: string;
  title: string;
  severity: string;
  status: string;
  project?: {
    id: string;
    name: string;
  } | null;
  rig?: {
    id: string;
    rigCode: string;
  } | null;
}

interface MaintenanceRow {
  id: string;
  requestCode: string;
  date: string;
  requestDate: string;
  rigId: string;
  projectId: string | null;
  issueType: string;
  issueDescription: string;
  status: string;
  estimatedDowntimeHours: number;
  notes: string | null;
  breakdownReportId: string | null;
  rig: { id: string; rigCode: string } | null;
  project: { id: string; name: string } | null;
  breakdownReport:
    | {
        id: string;
        title: string;
        status: string;
        severity: string;
      }
    | null;
  createdAt?: string;
  updatedAt?: string;
}

interface MaintenanceFormState {
  requestDate: string;
  rigId: string;
  linkedBreakdownId: string;
  maintenanceType:
    | "ROUTINE_MAINTENANCE"
    | "INSPECTION_CHECK"
    | "PREVENTIVE_SERVICE"
    | "OTHER"
    | "";
  status: OperationalMaintenanceStatus;
  issueDescription: string;
  estimatedDowntimeHrs: string;
  notes: string;
}

interface LogFilterState {
  rigId: string;
  status: "all" | OperationalMaintenanceStatus;
  from: string;
  to: string;
  linkage: "all" | "linked" | "unlinked";
}

interface LinkedUsageRequestRow {
  id: string;
  quantity: number;
  status: string;
  reason: string;
  createdAt: string;
  item: { id: string; name: string; sku: string } | null;
  requestedBy: { id: string; fullName: string; role: string } | null;
}

interface LinkedRequisitionRow {
  id: string;
  requisitionCode: string;
  type: string;
  status: string;
  submittedAt: string;
  totals: {
    estimatedTotalCost: number;
  };
  contextLabels?: {
    projectName: string | null;
  };
}

interface AuditRow {
  id: string;
  action: string;
  description: string;
  createdAt: string;
  actorName: string | null;
}

interface RigMaintenanceHistoryRow {
  rigId: string;
  rigCode: string;
  currentStatus: OperationalMaintenanceStatus | null;
  latestMaintenanceDate: string;
  caseCount: number;
  cases: MaintenanceRow[];
}

const INITIAL_FORM_STATE: MaintenanceFormState = {
  requestDate: new Date().toISOString().slice(0, 10),
  rigId: "",
  linkedBreakdownId: "",
  maintenanceType: "",
  status: "OPEN",
  issueDescription: "",
  estimatedDowntimeHrs: "",
  notes: ""
};

const INITIAL_LOG_FILTERS: LogFilterState = {
  rigId: "",
  status: "all",
  from: "",
  to: "",
  linkage: "all"
};

const STEP_ITEMS: Array<{ step: MaintenanceWizardStep; label: string }> = [
  { step: 1, label: "Select rig" },
  { step: 2, label: "Enter details" },
  { step: 3, label: "Save" }
];

const MAINTENANCE_TYPE_OPTIONS: Array<{
  value: MaintenanceFormState["maintenanceType"];
  label: string;
}> = [
  { value: "ROUTINE_MAINTENANCE", label: "Routine Maintenance" },
  { value: "INSPECTION_CHECK", label: "Inspection / Check" },
  { value: "PREVENTIVE_SERVICE", label: "Preventive Service" },
  { value: "OTHER", label: "Other" }
];

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
  const { user } = useRole();
  const canReportMaintenance = canReportMaintenanceActivity(user?.role);
  const breakdownPrefillId = searchParams.get("breakdownId")?.trim() || "";
  const hasBreakdownPrefill = Boolean(breakdownPrefillId);

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
  const activeProjectForSelectedRig = useMemo(
    () =>
      projects.find(
        (entry) => entry.assignedRigId === form.rigId && entry.status === "ACTIVE"
      ) || null,
    [form.rigId, projects]
  );
  const linkedBreakdown = useMemo(
    () => breakdowns.find((entry) => entry.id === form.linkedBreakdownId) || null,
    [breakdowns, form.linkedBreakdownId]
  );
  const breakdownOptionsForRig = useMemo(() => {
    if (!form.rigId) {
      return breakdowns;
    }
    return breakdowns.filter((entry) => entry.rig?.id === form.rigId);
  }, [breakdowns, form.rigId]);
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
  const currentStepError = useMemo(() => validateStep(wizardStep, form), [form, wizardStep]);
  const loadMaintenanceRows = useCallback(async () => {
    setLoadingRows(true);
    setErrorMessage(null);
    try {
      const query = new URLSearchParams();
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
  }, [logFilters.from, logFilters.rigId, logFilters.status, logFilters.to]);

  useEffect(() => {
    void loadReferenceData();
  }, []);

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

  async function loadReferenceData() {
    setLoadingRefs(true);
    try {
      const [rigsRes, projectsRes, breakdownsRes] = await Promise.all([
        fetch("/api/rigs", { cache: "no-store" }),
        fetch("/api/projects", { cache: "no-store" }),
        fetch("/api/breakdowns?status=OPEN", { cache: "no-store" })
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
                assignedRigId?: string | null;
              }) => ({
                id: entry.id,
                name: entry.name,
                status: entry.status,
                clientId: entry.clientId,
                assignedRigId: entry.assignedRigId || null
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
  }

  function continueWizard() {
    const validationError = validateStep(wizardStep, form);
    if (validationError) {
      setErrorMessage(validationError);
      return;
    }
    setErrorMessage(null);
    setWizardStep((current) =>
      current < 3 ? ((current + 1) as MaintenanceWizardStep) : current
    );
  }

  function backWizard() {
    setErrorMessage(null);
    setWizardStep((current) =>
      current > 1 ? ((current - 1) as MaintenanceWizardStep) : current
    );
  }

  async function saveMaintenance() {
    if (!canReportMaintenance) {
      setErrorMessage("You do not have permission to report maintenance activity.");
      return;
    }

    for (const step of [1, 2] as MaintenanceWizardStep[]) {
      const validationError = validateStep(step, form);
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
          projectId: activeProjectForSelectedRig?.id || null,
          clientId: activeProjectForSelectedRig?.clientId || null,
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
      setWizardStep(1);
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

      <Card title="Report Maintenance Activity">
        <div className="mb-3 grid gap-2 text-xs sm:grid-cols-3">
          {STEP_ITEMS.map((entry) => (
            <div
              key={entry.step}
              className={`rounded-lg border px-2 py-1.5 ${
                wizardStep === entry.step
                  ? "border-brand-300 bg-brand-50 text-brand-900"
                  : "border-slate-200 bg-slate-50 text-slate-600"
              }`}
            >
              <p className="font-semibold">
                {entry.step}. {entry.label}
              </p>
            </div>
          ))}
        </div>

        <form
          onSubmit={(event) => {
            event.preventDefault();
          }}
          className="space-y-3"
        >
          {wizardStep === 1 && (
            <div className="space-y-3">
              <p className="text-sm font-semibold text-slate-900">Step 1 — Select rig</p>
              <label className="text-sm text-ink-700">
                Rig
                <select
                  value={form.rigId}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      rigId: event.target.value,
                      linkedBreakdownId:
                        current.rigId === event.target.value || isPrefilledFromBreakdown
                          ? current.linkedBreakdownId
                          : ""
                    }))
                  }
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
                  required
                  disabled={loadingRefs || isPrefilledFromBreakdown}
                >
                  <option value="">{loadingRefs ? "Loading rigs..." : "Select rig"}</option>
                  {rigs.map((rig) => (
                    <option key={rig.id} value={rig.id}>
                      {rig.rigCode}
                    </option>
                  ))}
                </select>
              </label>

              {isPrefilledFromBreakdown ? (
                <label className="text-sm text-ink-700">
                  Linked breakdown
                  <input
                    value={
                      linkedBreakdown
                        ? `${linkedBreakdown.title} (${linkedBreakdown.severity})`
                        : form.linkedBreakdownId
                    }
                    disabled
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-slate-700"
                  />
                </label>
              ) : (
                <label className="text-sm text-ink-700">
                  Link open breakdown (optional)
                  <select
                    value={form.linkedBreakdownId}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        linkedBreakdownId: event.target.value
                      }))
                    }
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
                    disabled={!form.rigId}
                  >
                    <option value="">
                      {form.rigId ? "No breakdown link" : "Select a rig first"}
                    </option>
                    {breakdownOptionsForRig.map((entry) => (
                      <option key={entry.id} value={entry.id}>
                        {entry.title} ({entry.severity})
                      </option>
                    ))}
                  </select>
                </label>
              )}

              {form.rigId && (
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
                  <p>
                    <span className="font-semibold">Rig status:</span> {selectedRig?.status || "-"}
                  </p>
                  <p>
                    <span className="font-semibold">Project context:</span>{" "}
                    {activeProjectForSelectedRig?.name || "Rig is idle (no active project)"}
                  </p>
                  {selectedRig?.status === "BREAKDOWN" && (
                    <p className="text-amber-800">Rig is currently in breakdown status.</p>
                  )}
                </div>
              )}
            </div>
          )}

          {wizardStep === 2 && (
            <div className="space-y-3">
              <p className="text-sm font-semibold text-slate-900">Step 2 — Enter details</p>
              <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                <label className="text-sm text-ink-700">
                  Date
                  <input
                    type="date"
                    value={form.requestDate}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, requestDate: event.target.value }))
                    }
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
                    required
                  />
                </label>
                <label className="text-sm text-ink-700">
                  Status
                  <select
                    value={form.status}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        status: event.target.value as MaintenanceFormState["status"]
                      }))
                    }
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
                  >
                    <option value="OPEN">Open</option>
                    <option value="IN_REPAIR">In repair</option>
                    <option value="WAITING_FOR_PARTS">Waiting for parts</option>
                    <option value="COMPLETED">Completed</option>
                  </select>
                </label>
                <label className="text-sm text-ink-700">
                  Maintenance type
                  <select
                    value={form.maintenanceType}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        maintenanceType:
                          event.target.value as MaintenanceFormState["maintenanceType"]
                      }))
                    }
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
                    required
                  >
                    <option value="">Select type</option>
                    {MAINTENANCE_TYPE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-sm text-ink-700">
                  Estimated downtime (hrs)
                  <input
                    type="number"
                    min="0"
                    step="0.1"
                    value={form.estimatedDowntimeHrs}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        estimatedDowntimeHrs: event.target.value
                      }))
                    }
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
                    placeholder="Optional"
                  />
                </label>
                <label className="text-sm text-ink-700 lg:col-span-3">
                  Issue / work description
                  <textarea
                    value={form.issueDescription}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        issueDescription: event.target.value
                      }))
                    }
                    className="mt-1 min-h-24 w-full rounded-lg border border-slate-200 px-3 py-2"
                    placeholder="Describe the maintenance activity."
                    required
                  />
                </label>
                <label className="text-sm text-ink-700 lg:col-span-3">
                  Notes (optional)
                  <textarea
                    value={form.notes}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, notes: event.target.value }))
                    }
                    className="mt-1 min-h-20 w-full rounded-lg border border-slate-200 px-3 py-2"
                  />
                </label>
              </div>
            </div>
          )}

          {wizardStep === 3 && (
            <div className="space-y-3">
              <p className="text-sm font-semibold text-slate-900">Step 3 — Save</p>
              <div className="grid gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 md:grid-cols-2">
                <p>
                  <span className="font-semibold">Rig:</span>{" "}
                  {selectedRig?.rigCode || form.rigId || "-"}
                </p>
                <p>
                  <span className="font-semibold">Date:</span> {form.requestDate || "-"}
                </p>
                <p>
                  <span className="font-semibold">Project context:</span>{" "}
                  {activeProjectForSelectedRig?.name || "Idle (no active project)"}
                </p>
                <p>
                  <span className="font-semibold">Linked breakdown:</span>{" "}
                  {linkedBreakdown?.title || form.linkedBreakdownId || "-"}
                </p>
                <p>
                  <span className="font-semibold">Maintenance type:</span>{" "}
                  {formatMaintenanceTypeLabel(form.maintenanceType)}
                </p>
                <p>
                  <span className="font-semibold">Status:</span>{" "}
                  {formatMaintenanceStatus(form.status)}
                </p>
                <p>
                  <span className="font-semibold">Downtime:</span>{" "}
                  {form.estimatedDowntimeHrs ? `${form.estimatedDowntimeHrs} hrs` : "-"}
                </p>
                <p className="md:col-span-2">
                  <span className="font-semibold">Description:</span>{" "}
                  {form.issueDescription || "-"}
                </p>
                <p className="md:col-span-2">
                  <span className="font-semibold">Notes:</span> {form.notes.trim() || "-"}
                </p>
              </div>
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
            {wizardStep < 3 ? (
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
                type="button"
                onClick={() => {
                  void saveMaintenance();
                }}
                disabled={!canReportMaintenance || submitting}
                className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
              >
                {submitting ? "Saving..." : "Save maintenance record"}
              </button>
            )}
            {!canReportMaintenance && (
              <p className="text-xs text-amber-800">
                Your role can view maintenance history but cannot create records.
              </p>
            )}
            {wizardStep < 3 && currentStepError && (
              <p className="text-xs text-amber-800">{currentStepError}</p>
            )}
          </div>
        </form>
      </Card>

      <section id="maintenance-log-section" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Maintenance History</h2>
            <p className="text-xs text-slate-600">
              Total {statusCounts.total} • Open {statusCounts.open} • In repair{" "}
              {statusCounts.inRepair} • Waiting for parts {statusCounts.waitingParts} • Completed{" "}
              {statusCounts.completed}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setLogOpen((current) => !current)}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
          >
            {logOpen ? "Hide history" : "View history"}
          </button>
        </div>

        {logOpen && (
          <div className="space-y-3">
            <Card title="History Filters">
              <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-5">
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
                    {rigs.map((rig) => (
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
                        status: event.target.value as LogFilterState["status"]
                      }))
                    }
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
                  >
                    <option value="all">All statuses</option>
                    <option value="OPEN">Open</option>
                    <option value="IN_REPAIR">In repair</option>
                    <option value="WAITING_FOR_PARTS">Waiting for parts</option>
                    <option value="COMPLETED">Completed</option>
                  </select>
                </label>
                <label className="text-sm text-ink-700">
                  From
                  <input
                    type="date"
                    value={logFilters.from}
                    onChange={(event) =>
                      setLogFilters((current) => ({
                        ...current,
                        from: event.target.value
                      }))
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
                      setLogFilters((current) => ({
                        ...current,
                        to: event.target.value
                      }))
                    }
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
                  />
                </label>
                <label className="text-sm text-ink-700">
                  Linked breakdown
                  <select
                    value={logFilters.linkage}
                    onChange={(event) =>
                      setLogFilters((current) => ({
                        ...current,
                        linkage: event.target.value as LogFilterState["linkage"]
                      }))
                    }
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
                  >
                    <option value="all">All</option>
                    <option value="linked">Linked only</option>
                    <option value="unlinked">Unlinked only</option>
                  </select>
                </label>
              </div>
            </Card>

            <Card title="Rigs with Maintenance Activity">
              {loadingRows ? (
                <p className="text-sm text-slate-600">Loading maintenance records...</p>
              ) : rigHistoryRows.length === 0 ? (
                <p className="text-sm text-slate-600">
                  No maintenance records found for the current filters.
                </p>
              ) : (
                <DataTable
                  columns={[
                    "Rig",
                    "Current maintenance state",
                    "Maintenance cases",
                    "Latest maintenance",
                    "Action"
                  ]}
                  rows={rigHistoryRows.map((entry) => [
                    entry.rigCode,
                    entry.currentStatus ? (
                      <MaintenanceStatusChip
                        key={`${entry.rigId}-state`}
                        status={entry.currentStatus}
                        legacySource={null}
                      />
                    ) : (
                      "No active case"
                    ),
                    formatNumber(entry.caseCount),
                    entry.latestMaintenanceDate,
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
                  Rig Maintenance View {rigDetailSelectedRig?.rigCode ? `• ${rigDetailSelectedRig.rigCode}` : ""}
                </h3>
                <p className="text-xs text-slate-600">
                  Rig-level maintenance history and linked operational records
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
                  <span className="font-semibold">Current maintenance state:</span>{" "}
                  {rigDetailSelectedRig?.currentStatus
                    ? formatMaintenanceStatus(rigDetailSelectedRig.currentStatus)
                    : "No active case"}
                </p>
                <p>
                  <span className="font-semibold">Active maintenance case:</span>{" "}
                  {rigDetailCases.find(
                    (entry) => normalizeMaintenanceStatus(entry.status).status !== "COMPLETED"
                  )?.requestCode || "None"}
                </p>
                <p>
                  <span className="font-semibold">Total maintenance cases:</span>{" "}
                  {formatNumber(rigDetailCases.length)}
                </p>
              </div>

              {rigDetailError && (
                <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                  {rigDetailError}
                </p>
              )}

              {rigDetailLoading ? (
                <p className="text-sm text-slate-600">Loading rig maintenance details...</p>
              ) : (
                <div className="space-y-3">
                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
                    <p>
                      Active maintenance cases:{" "}
                      <span className="font-semibold">
                        {rigDetailCaseSummary.open +
                          rigDetailCaseSummary.inRepair +
                          rigDetailCaseSummary.waitingParts}
                      </span>
                    </p>
                    <p>
                      Historical completed cases:{" "}
                      <span className="font-semibold">{rigDetailCaseSummary.completed}</span>
                    </p>
                    <p className="mt-1 text-slate-600">
                      Rig-level view is summary only. Open a case to manage linked requests and
                      actions.
                    </p>
                  </div>
                  <Card title="Maintenance Cases">
                    {rigDetailCases.length === 0 ? (
                      <p className="text-sm text-slate-600">
                        No maintenance cases found for this rig.
                      </p>
                    ) : (
                      <DataTable
                        columns={[
                          "Maintenance case ID",
                          "Date opened",
                          "Type",
                          "Status",
                          "Linked breakdown",
                          "View details"
                        ]}
                        rows={rigDetailCases.map((row) => {
                          const normalizedStatus = normalizeMaintenanceStatus(row.status);
                          return [
                            row.requestCode,
                            row.date,
                            formatMaintenanceTypeLabel(
                              (row.issueType || "").toUpperCase() as MaintenanceFormState["maintenanceType"]
                            ),
                            <MaintenanceStatusChip
                              key={`${row.id}-rig-status`}
                              status={normalizedStatus.status}
                              legacySource={normalizedStatus.legacySource}
                            />,
                            row.breakdownReport?.title || row.breakdownReportId || "-",
                            <button
                              key={`${row.id}-open`}
                              type="button"
                              onClick={() => openCaseFromRigDetail(row.id)}
                              className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                            >
                              View details
                            </button>
                          ];
                        })}
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
                  Maintenance Case {selectedRecord.requestCode}
                </h3>
                <p className="text-xs text-slate-600">
                  Operational case details and next actions
                </p>
              </div>
              <button
                type="button"
                onClick={closeRecordDetail}
                className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100"
              >
                Close
              </button>
            </div>

            <div className="space-y-4 px-4 py-4">
              <div className="grid gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-700 md:grid-cols-2">
                <p>
                  <span className="font-semibold">Maintenance ID:</span> {selectedRecord.id}
                </p>
                <p>
                  <span className="font-semibold">Current status:</span>{" "}
                  {formatMaintenanceStatus(selectedRecord.status, true)}
                </p>
                <p>
                  <span className="font-semibold">Rig:</span>{" "}
                  {selectedRecord.rig?.rigCode || selectedRecord.rigId}
                </p>
                <p>
                  <span className="font-semibold">Project:</span>{" "}
                  {selectedRecord.project?.name || "No active project"}
                </p>
                <p>
                  <span className="font-semibold">Linked breakdown:</span>{" "}
                  {selectedRecord.breakdownReport?.title ||
                    selectedRecord.breakdownReportId ||
                    "-"}
                </p>
                <p>
                  <span className="font-semibold">Date opened:</span> {selectedRecord.date}
                </p>
                <p>
                  <span className="font-semibold">Maintenance type:</span>{" "}
                  {formatMaintenanceTypeLabel(selectedRecord.issueType)}
                </p>
                <p>
                  <span className="font-semibold">Downtime:</span>{" "}
                  {formatNumber(selectedRecord.estimatedDowntimeHours)} hrs
                </p>
                <p className="md:col-span-2">
                  <span className="font-semibold">Issue / work description:</span>{" "}
                  {selectedRecord.issueDescription}
                </p>
                <p className="md:col-span-2">
                  <span className="font-semibold">Notes:</span> {selectedRecord.notes || "-"}
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={goToInventoryRequest}
                  disabled={selectedRecordStatus === "COMPLETED"}
                  className="rounded-md border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-800 hover:bg-indigo-100 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Request item
                </button>
                <button
                  type="button"
                  onClick={goToPurchaseRequest}
                  disabled={selectedRecordStatus === "COMPLETED"}
                  className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Create purchase request
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void markMaintenanceResolved();
                  }}
                  disabled={
                    selectedRecordStatus === "COMPLETED" ||
                    resolvingRecordId === selectedRecord.id
                  }
                  className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-800 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {resolvingRecordId === selectedRecord.id
                    ? "Resolving..."
                    : "Mark resolved"}
                </button>
              </div>
              {selectedRecordStatus === "COMPLETED" && (
                <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
                  This maintenance case is completed. Linked history remains viewable, but new
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

                  <Card title="Activity History">
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
                              {entry.description || "Maintenance case updated."}
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
  );
}

function validateStep(step: MaintenanceWizardStep, form: MaintenanceFormState) {
  if (step === 1 && !form.rigId) {
    return "Rig is required.";
  }
  if (step === 2) {
    if (!form.requestDate) {
      return "Date is required.";
    }
    if (!form.maintenanceType) {
      return "Maintenance type is required.";
    }
    if (!form.issueDescription.trim()) {
      return "Issue / work description is required.";
    }
  }
  return null;
}

function normalizeMaintenanceStatus(value: string): {
  status: OperationalMaintenanceStatus;
  legacySource: string | null;
} {
  const normalized = value.trim().toUpperCase();
  if (normalized === "OPEN") {
    return { status: "OPEN", legacySource: null };
  }
  if (normalized === "COMPLETED") {
    return { status: "COMPLETED", legacySource: null };
  }
  if (normalized === "WAITING_FOR_PARTS") {
    return { status: "WAITING_FOR_PARTS", legacySource: null };
  }
  if (normalized === "IN_REPAIR") {
    return { status: "IN_REPAIR", legacySource: null };
  }
  return { status: "OPEN", legacySource: null };
}

function maintenanceRowSortValue(row: MaintenanceRow | undefined) {
  if (!row) {
    return 0;
  }
  const parsed = new Date(row.requestDate || row.createdAt || row.date || "");
  if (Number.isNaN(parsed.getTime())) {
    return 0;
  }
  return parsed.getTime();
}

function formatMaintenanceStatus(value: string, includeLegacySource = false) {
  const normalized = normalizeMaintenanceStatus(value);
  const label =
    normalized.status === "OPEN"
      ? "Open"
      : normalized.status === "IN_REPAIR"
        ? "In repair"
        : normalized.status === "WAITING_FOR_PARTS"
          ? "Waiting for parts"
          : "Completed";
  if (!includeLegacySource || !normalized.legacySource) {
    return label;
  }
  return `${label} (legacy: ${toLabelCase(normalized.legacySource)})`;
}

function formatMaintenanceTypeLabel(value: MaintenanceFormState["maintenanceType"] | string) {
  const normalized = (value || "").trim().toUpperCase();
  if (normalized === "ROUTINE_MAINTENANCE") return "Routine Maintenance";
  if (normalized === "INSPECTION_CHECK") return "Inspection / Check";
  if (normalized === "PREVENTIVE_SERVICE") return "Preventive Service";
  if (normalized === "OTHER") return "Other";
  return value || "-";
}

function toDate(value: string | null | undefined) {
  if (!value) {
    return "-";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toISOString().slice(0, 10);
}

function toDateTime(value: string | null | undefined) {
  if (!value) {
    return "-";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toISOString().replace("T", " ").slice(0, 16);
}

function toLabelCase(value: string) {
  return value
    .toLowerCase()
    .split("_")
    .map((entry) => entry.charAt(0).toUpperCase() + entry.slice(1))
    .join(" ");
}

function MaintenanceStatusChip({
  status,
  legacySource
}: {
  status: OperationalMaintenanceStatus;
  legacySource: string | null;
}) {
  const className =
    status === "COMPLETED"
      ? "border-emerald-300 bg-emerald-100 text-emerald-800"
      : status === "WAITING_FOR_PARTS"
        ? "border-amber-300 bg-amber-100 text-amber-800"
        : status === "IN_REPAIR"
          ? "border-indigo-300 bg-indigo-100 text-indigo-800"
          : "border-slate-300 bg-slate-100 text-slate-800";

  return (
    <span
      className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${className}`}
      title={legacySource ? `Legacy source: ${toLabelCase(legacySource)}` : undefined}
    >
      {status === "OPEN"
        ? "Open"
        : status === "IN_REPAIR"
          ? "In repair"
          : status === "WAITING_FOR_PARTS"
            ? "Waiting for parts"
            : "Completed"}
    </span>
  );
}
