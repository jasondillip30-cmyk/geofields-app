"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

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
import { canUseElevatedDrillingEdit } from "@/lib/auth/approval-policy";
import { canAccess } from "@/lib/auth/permissions";
import type { CopilotPageContext } from "@/lib/ai/contextual-copilot";
import { buildScopedHref } from "@/lib/drilldown";
import { cn, formatCurrency, formatNumber } from "@/lib/utils";

interface ProjectOption {
  id: string;
  name: string;
  clientId: string;
  status: string;
  contractRatePerM: number;
  client: {
    id: string;
    name: string;
  };
  assignedRig: {
    id: string;
    rigCode: string;
  } | null;
  backupRig: {
    id: string;
    rigCode: string;
  } | null;
}

interface RigOption {
  id: string;
  rigCode: string;
  status: string;
}

interface DrillReportRecord {
  id: string;
  date: string;
  approvalStatus: "DRAFT" | "SUBMITTED" | "APPROVED" | "REJECTED";
  submittedAt: string | null;
  approvedAt: string | null;
  rejectionReason: string | null;
  holeNumber: string;
  areaLocation: string;
  fromMeter: number;
  toMeter: number;
  totalMetersDrilled: number;
  workHours: number;
  rigMoves: number;
  standbyHours: number;
  delayHours: number;
  operatorCrew: string | null;
  billableAmount: number;
  comments: string | null;
  client: { id: string; name: string };
  project: { id: string; name: string; status: string };
  rig: { id: string; rigCode: string; status: string };
  submittedBy: { id: string; fullName: string } | null;
  approvedBy: { id: string; fullName: string } | null;
  createdAt: string;
  updatedAt: string;
}

interface DrillStats {
  reportsLogged: number;
  totalMeters: number;
  billableActivity: number;
  averageWorkHours: number;
}

interface DrillReportFormState {
  date: string;
  projectId: string;
  rigId: string;
  holeNumber: string;
  areaLocation: string;
  fromMeter: string;
  toMeter: string;
  totalMetersDrilled: string;
  workHours: string;
  rigMoves: string;
  standbyHours: string;
  delayHours: string;
  operatorCrew: string;
  comments: string;
}

const RECENT_PROJECTS_STORAGE_KEY = "gf:drilling-recent-projects";
const MAX_VISIBLE_PROJECT_TABS = 6;
const MAX_RECENT_PROJECTS = 6;

const emptyStats: DrillStats = {
  reportsLogged: 0,
  totalMeters: 0,
  billableActivity: 0,
  averageWorkHours: 0
};

export default function DrillingReportsPage() {
  const { filters } = useAnalyticsFilters();
  const { user } = useRole();
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [rigs, setRigs] = useState<RigOption[]>([]);
  const [reports, setReports] = useState<DrillReportRecord[]>([]);
  const [stats, setStats] = useState<DrillStats>(emptyStats);
  const [recentProjectIds, setRecentProjectIds] = useState<string[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);
  const [referencesLoading, setReferencesLoading] = useState(true);
  const [reportsLoading, setReportsLoading] = useState(true);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [formMode, setFormMode] = useState<"create" | "edit">("create");
  const [editingReportId, setEditingReportId] = useState<string | null>(null);
  const [formSaving, setFormSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [focusedRowId, setFocusedRowId] = useState<string | null>(null);
  const [focusedSectionId, setFocusedSectionId] = useState<string | null>(null);
  const [assistTarget, setAssistTarget] = useState<CopilotFocusTarget | null>(null);
  const [form, setForm] = useState<DrillReportFormState>(() => createEmptyForm());

  const canCreateReport = Boolean(user?.role && canAccess(user.role, "drilling:submit"));

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    try {
      const raw = window.localStorage.getItem(RECENT_PROJECTS_STORAGE_KEY);
      if (!raw) {
        return;
      }
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        setRecentProjectIds(parsed.filter((value): value is string => typeof value === "string"));
      }
    } catch {
      setRecentProjectIds([]);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(RECENT_PROJECTS_STORAGE_KEY, JSON.stringify(recentProjectIds.slice(0, MAX_RECENT_PROJECTS)));
  }, [recentProjectIds]);

  const markProjectAsRecent = useCallback((projectId: string) => {
    if (!projectId) {
      return;
    }

    setRecentProjectIds((current) => {
      const next = [projectId, ...current.filter((id) => id !== projectId)];
      return next.slice(0, MAX_RECENT_PROJECTS);
    });
  }, []);

  const handleSelectProject = useCallback(
    (projectId: string) => {
      setSelectedProjectId(projectId);
      markProjectAsRecent(projectId);
      setFormError(null);
    },
    [markProjectAsRecent]
  );

  const loadReferenceData = useCallback(async () => {
    setReferencesLoading(true);
    try {
      const query = new URLSearchParams();
      if (filters.clientId !== "all") query.set("clientId", filters.clientId);
      if (filters.rigId !== "all") query.set("rigId", filters.rigId);
      const search = query.toString();

      const [projectsRes, rigsRes] = await Promise.all([
        fetch(`/api/projects${search ? `?${search}` : ""}`, { cache: "no-store" }),
        fetch(`/api/rigs${search ? `?${search}` : ""}`, { cache: "no-store" })
      ]);

      const [projectsPayload, rigsPayload] = await Promise.all([
        projectsRes.ok ? projectsRes.json() : Promise.resolve({ data: [] }),
        rigsRes.ok ? rigsRes.json() : Promise.resolve({ data: [] })
      ]);

      const activeProjects = (projectsPayload.data || []).filter((project: ProjectOption) => project.status === "ACTIVE");
      setProjects(activeProjects);
      setRigs(rigsPayload.data || []);
    } catch {
      setProjects([]);
      setRigs([]);
    } finally {
      setReferencesLoading(false);
    }
  }, [filters.clientId, filters.rigId]);

  useEffect(() => {
    void loadReferenceData();
  }, [loadReferenceData]);

  useEffect(() => {
    if (projects.length === 0) {
      setSelectedProjectId("");
      return;
    }

    if (selectedProjectId && projects.some((project) => project.id === selectedProjectId)) {
      return;
    }

    const recentMatch = recentProjectIds.find((recentId) => projects.some((project) => project.id === recentId));
    const fallbackProjectId = recentMatch || projects[0]?.id || "";
    if (!fallbackProjectId) {
      return;
    }

    setSelectedProjectId(fallbackProjectId);
    markProjectAsRecent(fallbackProjectId);
  }, [markProjectAsRecent, projects, recentProjectIds, selectedProjectId]);

  const loadReportsData = useCallback(async () => {
    if (!selectedProjectId) {
      setReports([]);
      setStats(emptyStats);
      setSelectedReportId(null);
      setReportsLoading(false);
      return;
    }

    setReportsLoading(true);
    try {
      const search = new URLSearchParams();
      if (filters.from) search.set("from", filters.from);
      if (filters.to) search.set("to", filters.to);
      if (filters.clientId !== "all") search.set("clientId", filters.clientId);
      if (filters.rigId !== "all") search.set("rigId", filters.rigId);
      search.set("projectId", selectedProjectId);

      const response = await fetch(`/api/drilling-reports?${search.toString()}`, { cache: "no-store" });
      const payload = response.ok ? await response.json() : { data: [], stats: emptyStats };
      const rows = payload.data || [];

      setReports(rows);
      setStats(payload.stats || emptyStats);
      setSelectedReportId((current) => {
        if (current && rows.some((row: DrillReportRecord) => row.id === current)) {
          return current;
        }
        return rows[0]?.id || null;
      });
    } catch {
      setReports([]);
      setStats(emptyStats);
      setSelectedReportId(null);
    } finally {
      setReportsLoading(false);
    }
  }, [filters.clientId, filters.from, filters.rigId, filters.to, selectedProjectId]);

  useEffect(() => {
    void loadReportsData();
  }, [loadReportsData]);

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId) || null,
    [projects, selectedProjectId]
  );

  const selectedReport = useMemo(
    () => reports.find((report) => report.id === selectedReportId) || null,
    [reports, selectedReportId]
  );

  const selectedClientName = useMemo(() => {
    if (filters.clientId === "all") {
      return null;
    }
    const fromProjects = projects.find((project) => project.client.id === filters.clientId)?.client.name;
    if (fromProjects) {
      return fromProjects;
    }
    return reports.find((report) => report.client.id === filters.clientId)?.client.name || null;
  }, [filters.clientId, projects, reports]);

  const selectedRigLabel = useMemo(() => {
    if (filters.rigId === "all") {
      return null;
    }
    return rigs.find((rig) => rig.id === filters.rigId)?.rigCode || null;
  }, [filters.rigId, rigs]);

  const activeRigs = useMemo(
    () => rigs.filter((rig) => rig.status === "ACTIVE"),
    [rigs]
  );

  const orderedProjectTabs = useMemo(() => {
    const recentOrder = new Map(recentProjectIds.map((id, index) => [id, index]));

    return [...projects].sort((a, b) => {
      const recentA = recentOrder.get(a.id);
      const recentB = recentOrder.get(b.id);

      if (recentA !== undefined && recentB !== undefined) {
        return recentA - recentB;
      }
      if (recentA !== undefined) {
        return -1;
      }
      if (recentB !== undefined) {
        return 1;
      }
      return a.name.localeCompare(b.name);
    });
  }, [projects, recentProjectIds]);

  const visibleProjectTabs = useMemo(
    () => orderedProjectTabs.slice(0, MAX_VISIBLE_PROJECT_TABS),
    [orderedProjectTabs]
  );

  const overflowProjectTabs = useMemo(
    () => orderedProjectTabs.slice(MAX_VISIBLE_PROJECT_TABS),
    [orderedProjectTabs]
  );

  const recentProjectTabs = useMemo(
    () =>
      recentProjectIds
        .map((recentId) => projects.find((project) => project.id === recentId) || null)
        .filter((project): project is ProjectOption => Boolean(project))
        .filter((project) => project.id !== selectedProjectId)
        .slice(0, 4),
    [projects, recentProjectIds, selectedProjectId]
  );

  const pendingApprovals = useMemo(
    () => reports.filter((entry) => entry.approvalStatus === "SUBMITTED").length,
    [reports]
  );
  const rejectedReports = useMemo(
    () => reports.filter((entry) => entry.approvalStatus === "REJECTED").length,
    [reports]
  );
  const draftReports = useMemo(
    () => reports.filter((entry) => entry.approvalStatus === "DRAFT").length,
    [reports]
  );

  const selectedProjectRigsLabel = useMemo(() => {
    if (!selectedProject) {
      return "No project selected";
    }

    const rigCodes = [
      selectedProject.assignedRig?.rigCode || null,
      selectedProject.backupRig?.rigCode || null
    ].filter((value): value is string => Boolean(value));

    if (rigCodes.length === 0) {
      return "No rig assigned";
    }

    return rigCodes.join(" • ");
  }, [selectedProject]);

  const canSubmitReport = useCallback(
    (report: DrillReportRecord) => {
      if (!(report.approvalStatus === "DRAFT" || report.approvalStatus === "REJECTED")) {
        return false;
      }
      const elevatedEditor = canUseElevatedDrillingEdit(user?.role);
      if (elevatedEditor) {
        return true;
      }
      return !report.submittedBy?.id || report.submittedBy.id === user?.id;
    },
    [user?.id, user?.role]
  );

  const canEditReport = useCallback(
    (report: DrillReportRecord) => {
      if (!(report.approvalStatus === "DRAFT" || report.approvalStatus === "REJECTED")) {
        return false;
      }
      const elevatedEditor = canUseElevatedDrillingEdit(user?.role);
      if (elevatedEditor) {
        return true;
      }
      return !report.submittedBy?.id || report.submittedBy.id === user?.id;
    },
    [user?.id, user?.role]
  );

  const formProject = useMemo(
    () => projects.find((project) => project.id === form.projectId) || null,
    [form.projectId, projects]
  );

  const computedMeters = useMemo(() => {
    const explicitMeters = Number(form.totalMetersDrilled || 0);
    if (explicitMeters > 0) {
      return explicitMeters;
    }
    const from = Number(form.fromMeter || 0);
    const to = Number(form.toMeter || 0);
    return Math.max(0, to - from);
  }, [form.fromMeter, form.toMeter, form.totalMetersDrilled]);

  const computedBillable = useMemo(() => {
    if (!formProject) {
      return 0;
    }
    const rate = Number(formProject.contractRatePerM || 0);
    return Math.round(computedMeters * rate * 100) / 100;
  }, [computedMeters, formProject]);

  const buildHref = useCallback(
    (path: string, overrides?: Record<string, string | null | undefined>) => buildScopedHref(filters, path, overrides),
    [filters]
  );

  const copilotContext = useMemo<CopilotPageContext>(
    () => ({
      pageKey: "drilling-reports",
      pageName: "Drilling Reports",
      filters: {
        clientId: filters.clientId,
        rigId: filters.rigId,
        from: filters.from || null,
        to: filters.to || null
      },
      summaryMetrics: [
        { key: "reportsLogged", label: "Reports Logged", value: stats.reportsLogged },
        { key: "totalMeters", label: "Total Meters", value: stats.totalMeters },
        { key: "billableActivity", label: "Total Billable", value: stats.billableActivity },
        { key: "pendingApprovals", label: "Pending Approvals", value: pendingApprovals },
        { key: "rejectedReports", label: "Rejected Reports", value: rejectedReports },
        { key: "draftReports", label: "Draft Reports", value: draftReports }
      ],
      tablePreviews: [
        {
          key: "drilling-reports",
          title: "Drilling Reports",
          rowCount: reports.length,
          columns: ["Date", "Project", "Rig", "Hole", "Meters", "WorkHours", "DelayHours", "Status"],
          rows: reports.slice(0, 10).map((report) => ({
            id: report.id,
            date: toIsoDate(report.date),
            project: report.project.name,
            rig: report.rig.rigCode,
            hole: report.holeNumber,
            meters: report.totalMetersDrilled,
            workHours: report.workHours,
            delayHours: report.delayHours,
            status: report.approvalStatus,
            billable: report.billableAmount,
            href: buildHref("/drilling-reports"),
            targetId: report.id,
            sectionId: "drilling-reports-table-section",
            targetPageKey: "drilling-reports"
          }))
        }
      ],
      selectedItems: selectedReport
        ? [
            {
              id: selectedReport.id,
              type: "drilling-report",
              label: `${selectedReport.project.name} • ${selectedReport.holeNumber}`
            }
          ]
        : [],
      priorityItems: [
        ...reports
          .filter((report) => report.approvalStatus === "SUBMITTED")
          .sort((a, b) => b.delayHours - a.delayHours)
          .slice(0, 3)
          .map((report) => ({
            id: report.id,
            label: `${report.project.name} • ${report.holeNumber}`,
            reason: `Submitted for approval${report.delayHours > 0 ? ` with ${report.delayHours.toFixed(1)} delay hours` : ""}.`,
            severity: report.delayHours >= 4 ? ("HIGH" as const) : ("MEDIUM" as const),
            amount: report.billableAmount,
            href: buildHref("/drilling-reports"),
            issueType: "APPROVAL_BACKLOG",
            targetId: report.id,
            sectionId: "drilling-reports-table-section",
            targetPageKey: "drilling-reports"
          })),
        ...reports
          .filter((report) => report.approvalStatus === "REJECTED")
          .slice(0, 2)
          .map((report) => ({
            id: `rejected-${report.id}`,
            label: `${report.project.name} • ${report.holeNumber}`,
            reason: `Rejected report${report.rejectionReason ? ` (${report.rejectionReason})` : ""} needs correction before billing.`,
            severity: "MEDIUM" as const,
            amount: report.billableAmount,
            href: buildHref("/drilling-reports"),
            issueType: "REJECTED_REPORT",
            targetId: report.id,
            sectionId: "drilling-reports-table-section",
            targetPageKey: "drilling-reports"
          }))
      ],
      navigationTargets: [
        {
          label: "Open Drilling Approvals",
          href: buildHref("/approvals", { tab: "drilling-reports" }),
          reason: "Clear submitted drilling reports quickly.",
          pageKey: "approvals",
          sectionId: "approvals-tab-drilling-reports"
        },
        {
          label: "Open Revenue",
          href: buildHref("/revenue", { projectId: selectedProjectId || null }),
          reason: "Validate drilling output impact on revenue.",
          pageKey: "revenue"
        },
        {
          label: "Open Profit",
          href: buildHref("/profit", { projectId: selectedProjectId || null }),
          reason: "Review profitability impact for drilling scope.",
          pageKey: "profit"
        }
      ],
      notes: selectedProject
        ? [
            `Active project: ${selectedProject.name} (${selectedProject.client.name}).`,
            "Project tabs define operational context; top bar filters define scope."
          ]
        : ["Select an active project tab to anchor drilling operations context."]
    }),
    [
      buildHref,
      draftReports,
      filters.clientId,
      filters.from,
      filters.rigId,
      filters.to,
      pendingApprovals,
      rejectedReports,
      reports,
      selectedProject,
      selectedProjectId,
      selectedReport,
      stats.billableActivity,
      stats.reportsLogged,
      stats.totalMeters
    ]
  );

  useRegisterCopilotContext(copilotContext);

  useCopilotFocusTarget({
    pageKey: "drilling-reports",
    onFocus: (target) => {
      setAssistTarget(target);
      setFocusedRowId(target.targetId || null);
      setFocusedSectionId(target.sectionId || null);
      if (target.targetId) {
        setSelectedReportId(target.targetId);
      }
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
    return () => {
      window.clearTimeout(timeout);
    };
  }, [focusedRowId, focusedSectionId]);

  useEffect(() => {
    if (!assistTarget) {
      return;
    }
    const timeout = window.setTimeout(() => setAssistTarget(null), 7000);
    return () => window.clearTimeout(timeout);
  }, [assistTarget]);

  const reportingWorkflowAssist = useMemo<WorkflowAssistModel | null>(() => {
    if (!assistTarget && !selectedReport) {
      return null;
    }
    const active = selectedReport;
    const missingContext: string[] = [];
    if (active && !active.operatorCrew) {
      missingContext.push("Crew/operator field is missing.");
    }
    if (active && !active.areaLocation) {
      missingContext.push("Area/location field is missing.");
    }
    if (active && !active.comments) {
      missingContext.push("Comments/context note is missing.");
    }
    const roleLabel =
      user?.role === "FIELD"
        ? "Field reporting assist"
        : user?.role === "OFFICE"
          ? "Office reporting assist"
          : "Operations reporting assist";

    return {
      heading: "Field / Reporting Workflow Assist",
      roleLabel,
      tone:
        active?.approvalStatus === "REJECTED" || (active?.delayHours || 0) > 6
          ? "amber"
          : "indigo",
      whyThisMatters:
        assistTarget?.reason ||
        (active
          ? `Report ${active.holeNumber} affects daily production completeness and approval readiness.`
          : "This reporting target was prioritized to improve operational visibility."),
      inspectFirst: [
        "Confirm drilling meters, work hours, and delay values are accurate.",
        "Verify rig/project alignment and hole reference fields.",
        "Check whether submission is delayed or missing key context."
      ],
      missingContext,
      checklist: [
        "Complete before submission",
        "Review drilling entry",
        "Confirm rig/project assignment",
        "Add operational context note",
        "Check reporting completeness"
      ],
      recommendedNextStep: active
        ? active.approvalStatus === "REJECTED"
          ? "Fix missing/rejected fields first, then resubmit with clear context."
          : "Review missing context and finalize this report for cleaner approval flow."
        : "Open the highlighted report row and complete missing reporting context first."
    };
  }, [assistTarget, selectedReport, user?.role]);

  useEffect(() => {
    if (!isFormOpen || !form.projectId || form.rigId) {
      return;
    }

    const formSelectedProject = projects.find((project) => project.id === form.projectId);
    if (!formSelectedProject?.assignedRig?.id) {
      return;
    }

    if (!activeRigs.some((rig) => rig.id === formSelectedProject.assignedRig?.id)) {
      return;
    }

    setForm((current) => ({
      ...current,
      rigId: formSelectedProject.assignedRig?.id || ""
    }));
  }, [activeRigs, form.projectId, form.rigId, isFormOpen, projects]);

  const openCreateReportModal = useCallback(() => {
    const initialProjectId = selectedProjectId || projects[0]?.id || "";
    const initialProject = projects.find((project) => project.id === initialProjectId) || null;
    const rigFromProject = initialProject?.assignedRig?.id || "";
    const rigFromFilter = filters.rigId !== "all" ? filters.rigId : "";
    const initialRigId = rigFromProject || rigFromFilter;

    setFormMode("create");
    setEditingReportId(null);
    setFormError(null);
    setNotice(null);
    setForm(createEmptyForm(initialProjectId, initialRigId));
    setIsFormOpen(true);
  }, [filters.rigId, projects, selectedProjectId]);

  const openEditReportModal = useCallback((report: DrillReportRecord) => {
    setFormMode("edit");
    setEditingReportId(report.id);
    setFormError(null);
    setNotice(null);
    setForm({
      date: new Date(report.date).toISOString().slice(0, 10),
      projectId: report.project.id,
      rigId: report.rig.id,
      holeNumber: report.holeNumber,
      areaLocation: report.areaLocation,
      fromMeter: String(report.fromMeter),
      toMeter: String(report.toMeter),
      totalMetersDrilled: String(report.totalMetersDrilled),
      workHours: String(report.workHours),
      rigMoves: String(report.rigMoves),
      standbyHours: String(report.standbyHours),
      delayHours: String(report.delayHours),
      operatorCrew: report.operatorCrew || "",
      comments: report.comments || ""
    });
    setIsFormOpen(true);
  }, []);

  const closeFormModal = useCallback(() => {
    if (formSaving) {
      return;
    }
    setIsFormOpen(false);
    setFormError(null);
  }, [formSaving]);

  const emitAnalyticsRefresh = useCallback(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem("gf:revenue-updated-at", String(Date.now()));
    window.dispatchEvent(new Event("gf:revenue-updated"));
    window.localStorage.setItem("gf:profit-updated-at", String(Date.now()));
    window.dispatchEvent(new Event("gf:profit-updated"));
  }, []);

  const submitStatusAction = useCallback(
    async (reportId: string, action: "submit" | "approve" | "reject" | "reopen", reason?: string) => {
      const response = await fetch(`/api/drilling-reports/${reportId}/status`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          action,
          reason: reason || undefined
        })
      });

      if (!response.ok) {
        throw new Error(await readApiError(response, "Failed to update report status."));
      }
    },
    []
  );

  const updateReportStatus = useCallback(
    async (reportId: string, action: "submit" | "approve" | "reject" | "reopen") => {
      try {
        let reason = "";
        if (action === "reject") {
          reason = window.prompt("Enter rejection reason (required):", "")?.trim() || "";
          if (!reason) {
            return;
          }
        }

        await submitStatusAction(reportId, action, reason || undefined);
        await loadReportsData();
        emitAnalyticsRefresh();
        if (action === "submit") {
          setNotice("Report submitted for approval.");
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to update report status.";
        window.alert(message);
      }
    },
    [emitAnalyticsRefresh, loadReportsData, submitStatusAction]
  );

  const saveReport = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setFormSaving(true);
      setFormError(null);

      const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
      const submissionMode = submitter?.dataset.mode === "submit" ? "submit" : "draft";

      const payload = {
        date: form.date,
        projectId: form.projectId,
        rigId: form.rigId,
        holeNumber: form.holeNumber,
        areaLocation: form.areaLocation,
        fromMeter: Number(form.fromMeter),
        toMeter: Number(form.toMeter),
        totalMetersDrilled: Number(form.totalMetersDrilled || 0),
        workHours: Number(form.workHours),
        rigMoves: Number(form.rigMoves),
        standbyHours: Number(form.standbyHours),
        delayHours: Number(form.delayHours),
        operatorCrew: form.operatorCrew,
        comments: form.comments
      };

      try {
        let savedReportId = editingReportId || "";

        if (formMode === "create") {
          const response = await fetch("/api/drilling-reports", {
            method: "POST",
            headers: {
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              ...payload,
              submissionMode
            })
          });

          if (!response.ok) {
            setFormError(await readApiError(response, "Failed to save drilling report."));
            return;
          }

          const result = await response.json();
          savedReportId = result?.data?.id || "";
        } else {
          if (!editingReportId) {
            setFormError("Unable to edit report. Missing report ID.");
            return;
          }

          const response = await fetch(`/api/drilling-reports/${editingReportId}`, {
            method: "PATCH",
            headers: {
              "Content-Type": "application/json"
            },
            body: JSON.stringify(payload)
          });

          if (!response.ok) {
            setFormError(await readApiError(response, "Failed to update drilling report."));
            return;
          }

          const result = await response.json();
          savedReportId = result?.data?.id || editingReportId;

          if (submissionMode === "submit") {
            await submitStatusAction(savedReportId, "submit");
          }
        }

        await loadReportsData();
        emitAnalyticsRefresh();
        if (submissionMode === "submit") {
          setNotice("Report submitted for approval.");
        } else if (formMode === "create") {
          setNotice("Draft report saved.");
        } else {
          setNotice("Draft report updated.");
        }

        setIsFormOpen(false);
        setEditingReportId(null);
        setFormMode("create");
        setForm(createEmptyForm(selectedProjectId, selectedProject?.assignedRig?.id || ""));
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to save drilling report.";
        setFormError(message);
      } finally {
        setFormSaving(false);
      }
    },
    [
      editingReportId,
      emitAnalyticsRefresh,
      form,
      formMode,
      loadReportsData,
      selectedProject?.assignedRig?.id,
      selectedProjectId,
      submitStatusAction
    ]
  );

  return (
    <AccessGate permission="drilling:view">
      <div className="gf-page-stack">
        {notice && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            {notice}
          </div>
        )}

        <Card
          title="Drilling Operations Workspace"
          subtitle="Project-first drilling console for daily reporting and approvals"
          action={
            <AccessGate permission="drilling:submit" fallback={null}>
              <button
                type="button"
                onClick={openCreateReportModal}
                className="rounded-lg bg-brand-600 px-3 py-2 text-xs font-semibold text-white hover:bg-brand-700"
              >
                New Drilling Report
              </button>
            </AccessGate>
          }
        >
          <div className="space-y-3">
            <div className="space-y-2">
              <div className="flex gap-2 overflow-x-auto pb-1">
                {orderedProjectTabs.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-slate-300 px-3 py-2 text-sm text-ink-600">
                    No active projects available in this scope.
                  </p>
                ) : (
                  visibleProjectTabs.map((project) => (
                    <button
                      key={project.id}
                      type="button"
                      onClick={() => handleSelectProject(project.id)}
                      className={`whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                        project.id === selectedProjectId
                          ? "border-brand-500 bg-brand-50 text-brand-800"
                          : "border-slate-200 bg-white text-ink-700 hover:bg-slate-50"
                      }`}
                    >
                      {project.name}
                    </button>
                  ))
                )}
              </div>

              {(overflowProjectTabs.length > 0 || recentProjectTabs.length > 0) && (
                <div className="flex flex-wrap items-center gap-2">
                  {overflowProjectTabs.length > 0 && (
                    <label className="text-xs text-ink-700">
                      <span className="mr-2">More projects</span>
                      <select
                        value=""
                        onChange={(event) => {
                          if (event.target.value) {
                            handleSelectProject(event.target.value);
                          }
                        }}
                        className="rounded-lg border border-slate-200 px-2 py-1 text-xs"
                      >
                        <option value="">Select project</option>
                        {overflowProjectTabs.map((project) => (
                          <option key={project.id} value={project.id}>
                            {project.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}

                  {recentProjectTabs.length > 0 && (
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs text-ink-600">Recent:</span>
                      {recentProjectTabs.map((project) => (
                        <button
                          key={`recent-${project.id}`}
                          type="button"
                          onClick={() => handleSelectProject(project.id)}
                          className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] text-ink-700 hover:bg-slate-100"
                        >
                          {project.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
              {!selectedProject ? (
                <p className="text-sm text-ink-600">Select a project tab to set the active drilling workspace.</p>
              ) : (
                <div className="grid gap-2 text-xs text-ink-700 md:grid-cols-2 xl:grid-cols-5">
                  <p>
                    <span className="font-semibold text-ink-800">Project:</span> {selectedProject.name}
                  </p>
                  <p>
                    <span className="font-semibold text-ink-800">Client:</span> {selectedProject.client.name}
                  </p>
                  <p>
                    <span className="font-semibold text-ink-800">Assigned Rig(s):</span> {selectedProjectRigsLabel}
                  </p>
                  <p>
                    <span className="font-semibold text-ink-800">Status:</span> {formatProjectStatus(selectedProject.status)}
                  </p>
                  <p>
                    <span className="font-semibold text-ink-800">Contract Rate:</span> {formatCurrency(selectedProject.contractRatePerM)} / meter
                  </p>
                </div>
              )}
              <p className="mt-1 text-[11px] text-slate-500">
                Global client, rig, and date filters are controlled from the top filter bar.
              </p>
            </div>
          </div>
        </Card>

        <FilterScopeBanner filters={filters} clientLabel={selectedClientName} rigLabel={selectedRigLabel} />

        <section
          id="drilling-project-summary-section"
          className={cn(
            focusedSectionId === "drilling-project-summary-section" &&
              "rounded-2xl ring-2 ring-indigo-100 ring-offset-2 ring-offset-slate-50"
          )}
        >
        <Card title={selectedProject ? `${selectedProject.name} Overview` : "Project Overview"} subtitle="Current project context and operational KPIs">
          {!selectedProject ? (
            <p className="text-sm text-ink-600">Select a project to view drilling activity.</p>
          ) : (
            <div className="space-y-4">
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <SummaryItem label="Client" value={selectedProject.client.name} />
                <SummaryItem label="Assigned Rig(s)" value={selectedProjectRigsLabel} />
                <SummaryItem label="Project Status" value={formatProjectStatus(selectedProject.status)} />
                <SummaryItem label="Contract Rate" value={`${formatCurrency(selectedProject.contractRatePerM)} / meter`} />
              </div>

              <section className="grid gap-3 md:grid-cols-4">
                <MetricCard label="Total Meters Drilled" value={formatNumber(stats.totalMeters)} />
                <MetricCard label="Total Reports" value={String(stats.reportsLogged)} />
                <MetricCard label="Total Billable" value={formatCurrency(stats.billableActivity)} tone="good" />
                <MetricCard label="Pending Approvals" value={String(pendingApprovals)} tone={pendingApprovals > 0 ? "warn" : "neutral"} />
              </section>
            </div>
          )}
        </Card>
        </section>

        <section className="grid gap-5 xl:grid-cols-[minmax(0,1.75fr)_minmax(320px,1fr)]">
          <div className="xl:col-span-2">
            <WorkflowAssistPanel model={reportingWorkflowAssist} />
          </div>
          <div
            id="drilling-reports-table-section"
            className={cn(
              focusedSectionId === "drilling-reports-table-section" &&
                "rounded-2xl ring-2 ring-indigo-100 ring-offset-2 ring-offset-slate-50"
            )}
          >
          <Card title="Drilling Reports" subtitle={selectedProject ? `Project: ${selectedProject.name}` : "Select a project"} className="min-h-[420px]">
            {referencesLoading || reportsLoading ? (
              <p className="text-sm text-ink-600">Loading drilling reports workspace...</p>
            ) : reports.length === 0 ? (
              <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center">
                <p className="text-sm font-medium text-ink-800">No drilling reports for this project</p>
                <p className="mt-1 text-xs text-ink-600">Create your first report to start tracking drilling activity.</p>
                {canCreateReport && (
                  <button
                    type="button"
                    onClick={openCreateReportModal}
                    className="mt-3 rounded-lg bg-brand-600 px-3 py-2 text-xs font-semibold text-white hover:bg-brand-700"
                  >
                    Create first report
                  </button>
                )}
              </div>
            ) : (
              <div className="overflow-hidden rounded-xl border border-slate-200">
                <div className="max-h-[560px] overflow-auto">
                  <table className="min-w-full text-left text-sm">
                    <thead className="sticky top-0 z-10 bg-slate-50 text-xs uppercase tracking-wide text-slate-600">
                      <tr>
                        <th className="px-3 py-2">Date</th>
                        <th className="px-3 py-2">Hole Number</th>
                        <th className="px-3 py-2">Rig</th>
                        <th className="px-3 py-2 text-right">Meters</th>
                        <th className="px-3 py-2 text-right">Work Hrs</th>
                        <th className="px-3 py-2 text-right">Delay Hrs</th>
                        <th className="px-3 py-2 text-right">Rig Moves</th>
                        <th className="px-3 py-2">Crew / Operator</th>
                        <th className="px-3 py-2">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 bg-white">
                      {reports.map((report) => (
                        <tr
                          key={report.id}
                          id={`ai-focus-${report.id}`}
                          onClick={() => setSelectedReportId(report.id)}
                          className={`cursor-pointer transition-colors ${
                            focusedRowId === report.id
                              ? "bg-indigo-50 ring-1 ring-inset ring-indigo-200"
                              : report.id === selectedReportId
                                ? "bg-brand-50"
                                : "hover:bg-slate-50"
                          }`}
                        >
                          <td className="px-3 py-2 text-xs text-ink-700">{toIsoDate(report.date)}</td>
                          <td className="px-3 py-2 font-medium text-ink-800">{report.holeNumber}</td>
                          <td className="px-3 py-2 text-ink-700">{report.rig.rigCode}</td>
                          <td className="px-3 py-2 text-right text-ink-700">{formatNumber(report.totalMetersDrilled)}</td>
                          <td className="px-3 py-2 text-right text-ink-700">{report.workHours.toFixed(1)}</td>
                          <td className="px-3 py-2 text-right text-ink-700">{report.delayHours.toFixed(1)}</td>
                          <td className="px-3 py-2 text-right text-ink-700">{report.rigMoves}</td>
                          <td className="px-3 py-2 text-ink-700">{report.operatorCrew || "-"}</td>
                          <td className="px-3 py-2">
                            <StatusBadge status={report.approvalStatus} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </Card>
          </div>

          <div
            id="drilling-report-detail-section"
            className={cn(
              focusedSectionId === "drilling-report-detail-section" &&
                "rounded-2xl ring-2 ring-indigo-100 ring-offset-2 ring-offset-slate-50"
            )}
          >
          <Card
            title="Detailed Report View"
            subtitle={selectedReport ? `Report ${selectedReport.holeNumber}` : "Select a report from the table"}
            className="min-h-[420px] xl:sticky xl:top-24"
          >
            {!selectedReport ? (
              <p className="text-sm text-ink-600">Click any row to inspect full drilling report details.</p>
            ) : (
              <div className="space-y-4 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <StatusBadge status={selectedReport.approvalStatus} />
                  {selectedReport.rejectionReason && (
                    <span className="rounded-md bg-red-50 px-2 py-1 text-xs text-red-700">
                      Rejection: {selectedReport.rejectionReason}
                    </span>
                  )}
                </div>

                <div className="grid gap-2">
                  <DetailRow label="Date" value={toIsoDate(selectedReport.date)} />
                  <DetailRow label="Client" value={selectedReport.client.name} />
                  <DetailRow label="Project" value={selectedReport.project.name} />
                  <DetailRow label="Rig" value={selectedReport.rig.rigCode} />
                  <DetailRow label="Hole Number" value={selectedReport.holeNumber} />
                  <DetailRow label="Area / Location" value={selectedReport.areaLocation} />
                  <DetailRow label="From Meter" value={selectedReport.fromMeter.toFixed(1)} />
                  <DetailRow label="To Meter" value={selectedReport.toMeter.toFixed(1)} />
                  <DetailRow label="Total Meters Drilled" value={formatNumber(selectedReport.totalMetersDrilled)} />
                  <DetailRow label="Work Hours" value={selectedReport.workHours.toFixed(1)} />
                  <DetailRow label="Rig Moves" value={String(selectedReport.rigMoves)} />
                  <DetailRow label="Standby Hours" value={selectedReport.standbyHours.toFixed(1)} />
                  <DetailRow label="Delay Hours" value={selectedReport.delayHours.toFixed(1)} />
                  <DetailRow label="Crew / Operator" value={selectedReport.operatorCrew || "-"} />
                  <DetailRow label="Calculated Billable" value={formatCurrency(selectedReport.billableAmount)} />
                  <DetailRow label="Comments" value={selectedReport.comments || "-"} />
                  <DetailRow label="Submitted By" value={selectedReport.submittedBy?.fullName || "-"} />
                  <DetailRow label="Approved/Rejected By" value={selectedReport.approvedBy?.fullName || "-"} />
                  <DetailRow label="Submitted At" value={formatDateTime(selectedReport.submittedAt)} />
                  <DetailRow label="Decision Time" value={formatDateTime(selectedReport.approvedAt)} />
                  <DetailRow label="Created At" value={formatDateTime(selectedReport.createdAt)} />
                  <DetailRow label="Updated At" value={formatDateTime(selectedReport.updatedAt)} />
                </div>

                <div className="flex flex-wrap gap-2 border-t border-slate-200 pt-3">
                  {canEditReport(selectedReport) && (
                    <button
                      type="button"
                      onClick={() => openEditReportModal(selectedReport)}
                      className="rounded-md border border-slate-300 px-3 py-1.5 text-xs text-ink-700 hover:bg-slate-50"
                    >
                      Edit Draft
                    </button>
                  )}

                  {canSubmitReport(selectedReport) && (
                    <button
                      type="button"
                      onClick={() => void updateReportStatus(selectedReport.id, "submit")}
                      className="rounded-md border border-amber-200 px-3 py-1.5 text-xs text-amber-800 hover:bg-amber-50"
                    >
                      Submit for Approval
                    </button>
                  )}
                </div>
              </div>
            )}
          </Card>
          </div>
        </section>

        {isFormOpen && (
          <div className="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/40 p-4">
            <div className="w-full max-w-5xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl">
              <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
                <div>
                  <h3 className="font-display text-lg text-ink-900">
                    {formMode === "create" ? "New Drilling Report" : "Edit Drilling Report"}
                  </h3>
                  <p className="text-xs text-ink-600">
                    {formMode === "create"
                      ? "Create a report for the selected project context."
                      : "Update draft values before submitting for approval."}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={closeFormModal}
                  className="rounded-md border border-slate-200 px-3 py-1.5 text-xs text-ink-700 hover:bg-slate-50"
                >
                  Close
                </button>
              </div>

              <form onSubmit={saveReport} className="max-h-[78vh] overflow-auto px-5 py-4">
                <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
                  <InputField
                    label="Date"
                    type="date"
                    value={form.date}
                    onChange={(value) => setForm((current) => ({ ...current, date: value }))}
                    required
                  />

                  <SelectField
                    label="Project"
                    value={form.projectId}
                    onChange={(value) => setForm((current) => ({ ...current, projectId: value }))}
                    options={projects.map((project) => ({
                      value: project.id,
                      label: project.name
                    }))}
                    required
                  />

                  <SelectField
                    label="Rig"
                    value={form.rigId}
                    onChange={(value) => setForm((current) => ({ ...current, rigId: value }))}
                    options={activeRigs.map((rig) => ({
                      value: rig.id,
                      label: rig.rigCode
                    }))}
                    required
                  />

                  <ReadOnlyField label="Linked Client" value={formProject?.client.name || "-"} />

                  <InputField
                    label="Hole Number"
                    value={form.holeNumber}
                    onChange={(value) => setForm((current) => ({ ...current, holeNumber: value }))}
                    required
                  />

                  <InputField
                    label="Area / Location"
                    value={form.areaLocation}
                    onChange={(value) => setForm((current) => ({ ...current, areaLocation: value }))}
                    required
                  />

                  <InputField
                    label="From Meter"
                    type="number"
                    value={form.fromMeter}
                    onChange={(value) => setForm((current) => ({ ...current, fromMeter: value }))}
                  />

                  <InputField
                    label="To Meter"
                    type="number"
                    value={form.toMeter}
                    onChange={(value) => setForm((current) => ({ ...current, toMeter: value }))}
                  />

                  <InputField
                    label="Total Meters Drilled"
                    type="number"
                    value={form.totalMetersDrilled}
                    onChange={(value) => setForm((current) => ({ ...current, totalMetersDrilled: value }))}
                  />

                  <InputField
                    label="Work Hours"
                    type="number"
                    value={form.workHours}
                    onChange={(value) => setForm((current) => ({ ...current, workHours: value }))}
                  />

                  <InputField
                    label="Rig Moves"
                    type="number"
                    value={form.rigMoves}
                    onChange={(value) => setForm((current) => ({ ...current, rigMoves: value }))}
                  />

                  <InputField
                    label="Standby Hours"
                    type="number"
                    value={form.standbyHours}
                    onChange={(value) => setForm((current) => ({ ...current, standbyHours: value }))}
                  />

                  <InputField
                    label="Delay Hours"
                    type="number"
                    value={form.delayHours}
                    onChange={(value) => setForm((current) => ({ ...current, delayHours: value }))}
                  />

                  <InputField
                    label="Operator / Crew"
                    value={form.operatorCrew}
                    onChange={(value) => setForm((current) => ({ ...current, operatorCrew: value }))}
                  />

                  <ReadOnlyField label="Computed Meters" value={formatNumber(computedMeters)} />
                  <ReadOnlyField label="Calculated Billable Amount" value={formatCurrency(computedBillable)} />

                  <label className="text-sm text-ink-700 lg:col-span-4">
                    <span className="mb-1 block">Comments</span>
                    <textarea
                      value={form.comments}
                      onChange={(event) => setForm((current) => ({ ...current, comments: event.target.value }))}
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none ring-brand-300 focus:ring"
                      rows={4}
                    />
                  </label>
                </div>

                {formError && (
                  <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                    {formError}
                  </div>
                )}

                <div className="mt-4 flex flex-wrap justify-end gap-2 border-t border-slate-200 pt-4">
                  <button
                    type="button"
                    onClick={closeFormModal}
                    className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-ink-700 hover:bg-slate-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    data-mode="draft"
                    disabled={formSaving}
                    className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-ink-800 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {formSaving ? "Saving..." : formMode === "create" ? "Save Draft" : "Save Changes"}
                  </button>
                  <button
                    type="submit"
                    data-mode="submit"
                    disabled={formSaving}
                    className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {formSaving
                      ? "Saving..."
                      : formMode === "create"
                        ? "Submit for Approval"
                        : "Save + Submit"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </AccessGate>
  );
}

const statusToneClass: Record<DrillReportRecord["approvalStatus"], string> = {
  DRAFT: "border-slate-300 bg-slate-100 text-slate-700",
  SUBMITTED: "border-blue-300 bg-blue-100 text-blue-800",
  APPROVED: "border-emerald-300 bg-emerald-100 text-emerald-800",
  REJECTED: "border-red-300 bg-red-100 text-red-800"
};

function StatusBadge({ status }: { status: DrillReportRecord["approvalStatus"] }) {
  return (
    <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${statusToneClass[status]}`}>
      {status.charAt(0) + status.slice(1).toLowerCase()}
    </span>
  );
}

function SummaryItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
      <p className="text-[11px] uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-sm font-medium text-ink-800">{value}</p>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[140px_minmax(0,1fr)] gap-3 rounded-md border border-slate-100 bg-slate-50 px-3 py-2">
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <p className="break-words text-sm text-ink-800">{value}</p>
    </div>
  );
}

function InputField({
  label,
  type = "text",
  value,
  onChange,
  required = false
}: {
  label: string;
  type?: string;
  value: string;
  onChange: (value: string) => void;
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
        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none ring-brand-300 focus:ring"
      >
        <option value="">Select</option>
        {options.map((option) => (
          <option key={`${label}-${option.value}`} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return (
    <label className="text-sm text-ink-700">
      <span className="mb-1 block">{label}</span>
      <div className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-ink-800">{value}</div>
    </label>
  );
}

function createEmptyForm(projectId = "", rigId = ""): DrillReportFormState {
  return {
    date: new Date().toISOString().slice(0, 10),
    projectId,
    rigId,
    holeNumber: "",
    areaLocation: "",
    fromMeter: "0",
    toMeter: "0",
    totalMetersDrilled: "",
    workHours: "0",
    rigMoves: "0",
    standbyHours: "0",
    delayHours: "0",
    operatorCrew: "",
    comments: ""
  };
}

function formatProjectStatus(value: string) {
  return value.replace(/_/g, " ").toLowerCase().replace(/(^|\s)\w/g, (match) => match.toUpperCase());
}

function toIsoDate(value: string | Date) {
  return new Date(value).toISOString().slice(0, 10);
}

function formatDateTime(value: string | null) {
  if (!value) {
    return "-";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "-";
  }
  return parsed.toLocaleString("en-US");
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
