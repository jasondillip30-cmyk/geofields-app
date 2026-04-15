"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { AccessGate } from "@/components/layout/access-gate";
import { FilterScopeBanner } from "@/components/layout/filter-scope-banner";
import { useAnalyticsFilters } from "@/components/layout/analytics-filters-provider";
import { useRole } from "@/components/layout/role-provider";
import { WorkflowAssistPanel } from "@/components/layout/workflow-assist-panel";
import { Card } from "@/components/ui/card";
import { canUseElevatedDrillingEdit } from "@/lib/auth/approval-policy";
import { canAccess } from "@/lib/auth/permissions";
import { buildScopedHref } from "@/lib/drilldown";
import {
  buildDrillReportDirectCostSummary,
  buildDrillOperationalKpiSummary,
  buildProjectDirectCostSummaryFromReports,
  buildProjectOperationalKpiSummaryFromReports
} from "@/lib/drilling-direct-cost-summary";
import { formatNumber } from "@/lib/utils";
import {
  SummaryItem,
  buildProjectBillingSummary,
  createEmptyForm
} from "./drilling-reports-page-utils";
import { DrillingReportsBrowserSection } from "./drilling-reports-browser-section";
import { DrillingReportEntryFormCard } from "./drilling-report-entry-form-card";
import {
  loadDrillingConsumablesPool as fetchDrillingConsumablesPool,
  loadDrillingReferenceData as fetchDrillingReferenceData,
  loadDrillingReportsData as fetchDrillingReportsData,
  loadProjectHoleProgress as fetchProjectHoleProgress,
} from "./drilling-reports-page-data";
import {
  MAX_VISIBLE_PROJECT_TABS,
  MAX_RECENT_PROJECTS,
  RECENT_PROJECTS_STORAGE_KEY,
  emptyStats,
  type DrillReportFormState,
  type DrillReportRecord,
  type DrillStats,
  type HoleProgressSummary,
  type ProjectConsumablePoolItem,
  type ProjectOption,
  type RigOption,
  type StagedConsumableLine
} from "./drilling-reports-page-types";
import { DrillingReportsProjectSummarySection } from "./drilling-reports-project-summary-section";
import { DrillingReportsWorkspaceShellCard } from "./drilling-reports-workspace-shell-card";
import { useDrillingReportsFormDerived } from "./drilling-reports-page-form-derived";
import { useDrillingReportsFocus } from "./drilling-reports-page-focus";
import {
  buildCreateFormFromScopedProject,
  buildEditFormFromReport,
  buildFormStateForProjectChange,
  buildStagedConsumablesFromReport
} from "./drilling-reports-page-form-state";
import { emitDrillingAnalyticsRefresh, persistDrillingReport } from "./drilling-reports-page-save";
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
  const [requiresContinuityOverride, setRequiresContinuityOverride] = useState(false);
  const [formConsumablesPool, setFormConsumablesPool] = useState<ProjectConsumablePoolItem[]>([]);
  const [formConsumablesLoading, setFormConsumablesLoading] = useState(false);
  const [consumableSearch, setConsumableSearch] = useState("");
  const [pendingConsumableItemId, setPendingConsumableItemId] = useState("");
  const [pendingConsumableQuantity, setPendingConsumableQuantity] = useState("1");
  const [stagedConsumables, setStagedConsumables] = useState<StagedConsumableLine[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [form, setForm] = useState<DrillReportFormState>(() => createEmptyForm());
  const [holeProgressByProject, setHoleProgressByProject] = useState<Record<string, HoleProgressSummary[]>>({});
  const [holeProgressLoading, setHoleProgressLoading] = useState(false);

  const canCreateReport = Boolean(user?.role && canAccess(user.role, "drilling:submit"));
  const isSingleProjectScope = filters.projectId !== "all";
  const scopedProjectId = isSingleProjectScope ? filters.projectId : selectedProjectId;
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
      const referenceData = await fetchDrillingReferenceData();
      setProjects(referenceData.projects);
      setRigs(referenceData.rigs);
    } catch {
      setProjects([]);
      setRigs([]);
    } finally {
      setReferencesLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadReferenceData();
  }, [loadReferenceData]);

  const reportableProjects = useMemo(
    () =>
      projects.filter(
        (project) => project.status === "ACTIVE" || project.status === "PLANNED"
      ),
    [projects]
  );

  useEffect(() => {
    const defaultPool = reportableProjects.length > 0 ? reportableProjects : projects;
    if (defaultPool.length === 0) {
      setSelectedProjectId("");
      return;
    }

    if (isSingleProjectScope) {
      if (!projects.some((project) => project.id === filters.projectId)) {
        setSelectedProjectId("");
        return;
      }
      if (selectedProjectId !== filters.projectId) {
        setSelectedProjectId(filters.projectId);
        markProjectAsRecent(filters.projectId);
      }
      return;
    }

    if (selectedProjectId && defaultPool.some((project) => project.id === selectedProjectId)) {
      return;
    }

    const recentMatch = recentProjectIds.find((recentId) =>
      defaultPool.some((project) => project.id === recentId)
    );
    const fallbackProjectId = recentMatch || defaultPool[0]?.id || "";
    if (!fallbackProjectId) {
      return;
    }

    setSelectedProjectId(fallbackProjectId);
    markProjectAsRecent(fallbackProjectId);
  }, [
    filters.projectId,
    isSingleProjectScope,
    markProjectAsRecent,
    projects,
    recentProjectIds,
    reportableProjects,
    selectedProjectId
  ]);

  const loadReportsData = useCallback(async () => {
    if (!scopedProjectId) {
      setReports([]);
      setStats(emptyStats);
      setSelectedReportId(null);
      setReportsLoading(false);
      return;
    }

    setReportsLoading(true);
    try {
      const data = await fetchDrillingReportsData({
        scopedProjectId,
        filters: {
          from: filters.from,
          to: filters.to,
          clientId: filters.clientId,
          rigId: filters.rigId
        },
        isSingleProjectScope
      });

      setReports(data.rows);
      setStats(data.stats || emptyStats);
      setSelectedReportId((current) => {
        if (current && data.rows.some((row: DrillReportRecord) => row.id === current)) {
          return current;
        }
        return data.rows[0]?.id || null;
      });
    } catch {
      setReports([]);
      setStats(emptyStats);
      setSelectedReportId(null);
    } finally {
      setReportsLoading(false);
    }
  }, [filters.clientId, filters.from, filters.rigId, filters.to, isSingleProjectScope, scopedProjectId]);

  useEffect(() => {
    void loadReportsData();
  }, [loadReportsData]);

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === scopedProjectId) || null,
    [projects, scopedProjectId]
  );
  const spendingReportsHref = useMemo(() => {
    const params = new URLSearchParams();
    if (scopedProjectId) {
      params.set("projectId", scopedProjectId);
    }
    if (filters.from) {
      params.set("from", filters.from);
    }
    if (filters.to) {
      params.set("to", filters.to);
    }
    const query = params.toString();
    return query ? `/spending/drilling-reports?${query}` : "/spending/drilling-reports";
  }, [filters.from, filters.to, scopedProjectId]);

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

  const orderedProjectTabs = useMemo(() => {
    const recentOrder = new Map(recentProjectIds.map((id, index) => [id, index]));
    const sourceProjects = reportableProjects.length > 0 ? reportableProjects : projects;

    return [...sourceProjects].sort((a, b) => {
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
  }, [projects, recentProjectIds, reportableProjects]);

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
  const selectedProjectBillingSummary = useMemo(
    () => buildProjectBillingSummary(selectedProject),
    [selectedProject]
  );
  const selectedProjectDirectCostSummary = useMemo(
    () =>
      buildProjectDirectCostSummaryFromReports(
        reports.map((report) => ({
          billableAmount: report.billableAmount,
          inventoryMovements: report.inventoryMovements || []
        }))
      ),
    [reports]
  );
  const selectedProjectOperationalKpis = useMemo(
    () =>
      buildProjectOperationalKpiSummaryFromReports(
        reports.map((report) => ({
          totalMetersDrilled: report.totalMetersDrilled,
          workHours: report.workHours,
          inventoryMovements: report.inventoryMovements || []
        }))
      ),
    [reports]
  );
  const selectedReportDirectCostSummary = useMemo(
    () =>
      selectedReport
        ? buildDrillReportDirectCostSummary({
            billableAmount: selectedReport.billableAmount,
            inventoryMovements: selectedReport.inventoryMovements || []
          })
        : null,
    [selectedReport]
  );
  const selectedReportOperationalKpis = useMemo(
    () =>
      selectedReport
        ? buildDrillOperationalKpiSummary({
            totalMetersDrilled: selectedReport.totalMetersDrilled,
            workHours: selectedReport.workHours,
            inventoryMovements: selectedReport.inventoryMovements || []
          })
        : null,
    [selectedReport]
  );

  const canEditReport = useCallback(
    (report: DrillReportRecord) => {
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
  const formProjectRigOptions = useMemo(() => {
    if (!formProject) {
      return [] as Array<{ id: string; rigCode: string }>;
    }

    const rigsById = new Map<string, { id: string; rigCode: string }>();
    if (formProject.assignedRig) {
      rigsById.set(formProject.assignedRig.id, {
        id: formProject.assignedRig.id,
        rigCode: formProject.assignedRig.rigCode
      });
    }
    if (formProject.backupRig) {
      rigsById.set(formProject.backupRig.id, {
        id: formProject.backupRig.id,
        rigCode: formProject.backupRig.rigCode
      });
    }

    return Array.from(rigsById.values()).sort((left, right) => left.rigCode.localeCompare(right.rigCode));
  }, [formProject]);
  const formProjectRigsLabel = useMemo(() => {
    if (formProjectRigOptions.length === 0) {
      return "No rig assigned";
    }
    return formProjectRigOptions.map((entry) => entry.rigCode).join(" • ");
  }, [formProjectRigOptions]);

  useEffect(() => {
    if (!canCreateReport || !isSingleProjectScope || !scopedProjectId) {
      setIsFormOpen(false);
      return;
    }
    setIsFormOpen(true);
  }, [canCreateReport, isSingleProjectScope, scopedProjectId]);

  useEffect(() => {
    if (!isFormOpen || !isSingleProjectScope || !scopedProjectId) {
      return;
    }
    if (form.projectId === scopedProjectId) {
      return;
    }
    setForm((current) => ({
      ...current,
      projectId: scopedProjectId,
      rigId: "",
      selectedHoleNumber: "",
      holeNumber: "",
      holeMode: "CONTINUE",
      delayReasonCategory: "",
      delayReasonNote: "",
      holeContinuityOverrideReason: "",
      leadOperatorName: "",
      assistantCount: "0",
      billableQuantities: {}
    }));
    setConsumableSearch("");
    setPendingConsumableItemId("");
    setPendingConsumableQuantity("1");
    setStagedConsumables([]);
    setRequiresContinuityOverride(false);
  }, [form.projectId, isFormOpen, isSingleProjectScope, scopedProjectId]);
  const {
    formProjectBillingItems,
    guidedBillableInputs,
    formProjectHoleProgress,
    nextHoleNumberSuggestion,
    selectedHoleProgress,
    derivedFromMeter,
    derivedToMeter,
    metersDrilledToday,
    stageContextText,
    guidedBillableLinesResult,
    stagedCoverageWarning,
    estimatedDailyBillable,
    consumablesPoolByItemId,
    pendingConsumable,
    filteredConsumableSearchResults
  } = useDrillingReportsFormDerived({
    form,
    formMode,
    formProject,
    holeProgressByProject,
    formConsumablesPool,
    consumableSearch,
    pendingConsumableItemId,
    stagedConsumables
  });

  const derivedHoleNumber =
    form.holeMode === "START_NEW"
      ? form.holeNumber || nextHoleNumberSuggestion
      : form.selectedHoleNumber || form.holeNumber;

  const loadProjectHoleProgress = useCallback(async (projectId: string) => {
    if (!projectId) {
      return;
    }
    setHoleProgressLoading(true);
    try {
      const next = await fetchProjectHoleProgress(projectId);
      setHoleProgressByProject((current) => ({
        ...current,
        [projectId]: next
      }));
    } catch {
      setHoleProgressByProject((current) => ({
        ...current,
        [projectId]: []
      }));
    } finally {
      setHoleProgressLoading(false);
    }
  }, []);

  const loadFormConsumablesPool = useCallback(
    async (projectId: string, excludeDrillReportId: string | null) => {
      if (!projectId) {
        setFormConsumablesPool([]);
        return;
      }
      setFormConsumablesLoading(true);
      try {
        const data = await fetchDrillingConsumablesPool({
          projectId,
          excludeDrillReportId
        });
        setFormConsumablesPool(data);
      } catch {
        setFormConsumablesPool([]);
      } finally {
        setFormConsumablesLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    if (!isFormOpen || !form.projectId) {
      return;
    }
    if (holeProgressByProject[form.projectId]) {
      return;
    }
    void loadProjectHoleProgress(form.projectId);
  }, [form.projectId, holeProgressByProject, isFormOpen, loadProjectHoleProgress]);

  useEffect(() => {
    if (!isFormOpen || !form.projectId) {
      setFormConsumablesPool([]);
      return;
    }
    void loadFormConsumablesPool(
      form.projectId,
      formMode === "edit" && editingReportId ? editingReportId : null
    );
  }, [editingReportId, form.projectId, formMode, isFormOpen, loadFormConsumablesPool]);

  useEffect(() => {
    if (!isFormOpen || formMode !== "create") {
      return;
    }
    const hasExistingHoles = formProjectHoleProgress.length > 0;
    setForm((current) => {
      const nextMode = hasExistingHoles ? current.holeMode : "START_NEW";
      const nextSelectedHole =
        hasExistingHoles && !current.selectedHoleNumber
          ? formProjectHoleProgress[0]?.holeNumber || ""
          : current.selectedHoleNumber;
      const nextHoleNumber =
        nextMode === "START_NEW" ? nextHoleNumberSuggestion : nextSelectedHole || current.holeNumber;
      if (
        current.holeMode === nextMode &&
        current.selectedHoleNumber === nextSelectedHole &&
        current.holeNumber === nextHoleNumber
      ) {
        return current;
      }
      return {
        ...current,
        holeMode: nextMode,
        selectedHoleNumber: nextSelectedHole,
        holeNumber: nextHoleNumber
      };
    });
  }, [formMode, formProjectHoleProgress, isFormOpen, nextHoleNumberSuggestion]);
  useEffect(() => {
    if (!isFormOpen) {
      return;
    }
    if (formProjectBillingItems.length === 0 && Object.keys(form.billableQuantities).length === 0) {
      return;
    }

    const allowedCodes = new Set(formProjectBillingItems.map((item) => item.itemCode));
    setForm((current) => {
      const nextBillableQuantities = Object.entries(current.billableQuantities).reduce<
        Record<string, string>
      >((accumulator, [itemCode, quantity]) => {
        if (allowedCodes.has(itemCode)) {
          accumulator[itemCode] = quantity;
        }
        return accumulator;
      }, {});

      if (
        Object.keys(nextBillableQuantities).length === Object.keys(current.billableQuantities).length &&
        Object.keys(nextBillableQuantities).every(
          (itemCode) => nextBillableQuantities[itemCode] === current.billableQuantities[itemCode]
        )
      ) {
        return current;
      }

      return {
        ...current,
        billableQuantities: nextBillableQuantities
      };
    });
  }, [form.billableQuantities, formProjectBillingItems, isFormOpen]);

  const buildHref = useCallback(
    (path: string, overrides?: Record<string, string | null | undefined>) => buildScopedHref(filters, path, overrides),
    [filters]
  );

  const { focusedRowId, focusedSectionId, reportingWorkflowAssist } = useDrillingReportsFocus({
    filters,
    stats,
    reports,
    selectedReport,
    selectedProject,
    isSingleProjectScope,
    scopedProjectId,
    userRole: user?.role,
    buildHref,
    onSelectReport: setSelectedReportId
  });

  useEffect(() => {
    if (!isFormOpen || !form.projectId) {
      return;
    }
    if (formProjectRigOptions.length === 0) {
      if (form.rigId) {
        setForm((current) => ({ ...current, rigId: "" }));
      }
      return;
    }

    const hasSelectedAllowedRig = formProjectRigOptions.some((rigOption) => rigOption.id === form.rigId);
    if (hasSelectedAllowedRig) {
      return;
    }

    const fallbackRigId = formProjectRigOptions[0]?.id || "";
    setForm((current) =>
      current.rigId === fallbackRigId
        ? current
        : {
            ...current,
            rigId: fallbackRigId
          }
    );
  }, [form.projectId, form.rigId, formProjectRigOptions, isFormOpen]);

  const openCreateReportModal = useCallback(() => {
    const initialProjectId =
      scopedProjectId || reportableProjects[0]?.id || projects[0]?.id || "";
    const initialProject = projects.find((project) => project.id === initialProjectId) || null;

    setFormMode("create");
    setEditingReportId(null);
    setFormError(null);
    setRequiresContinuityOverride(false);
    setNotice(null);
    setConsumableSearch("");
    setPendingConsumableItemId("");
    setPendingConsumableQuantity("1");
    setStagedConsumables([]);
    setForm(
      buildCreateFormFromScopedProject({
        scopedProjectId,
        reportableProjectIds: reportableProjects.map((project) => project.id),
        allProjectIds: projects.map((project) => project.id),
        projectAssignedRigId: initialProject?.assignedRig?.id || null,
        projectBackupRigId: initialProject?.backupRig?.id || null
      })
    );
    if (initialProjectId && !holeProgressByProject[initialProjectId]) {
      void loadProjectHoleProgress(initialProjectId);
    }
    setIsFormOpen(true);
  }, [holeProgressByProject, loadProjectHoleProgress, projects, reportableProjects, scopedProjectId]);

  const openEditReportModal = useCallback((report: DrillReportRecord) => {
    setFormMode("edit");
    setEditingReportId(report.id);
    setFormError(null);
    setRequiresContinuityOverride(Boolean(report.holeContinuityOverrideReason));
    setNotice(null);
    setConsumableSearch("");
    setPendingConsumableItemId("");
    setPendingConsumableQuantity("1");
    setStagedConsumables(buildStagedConsumablesFromReport(report));
    setForm(buildEditFormFromReport(report));
    if (!holeProgressByProject[report.project.id]) {
      void loadProjectHoleProgress(report.project.id);
    }
    setIsFormOpen(true);
  }, [holeProgressByProject, loadProjectHoleProgress]);

  const addPendingConsumableToStaged = useCallback(() => {
    if (!pendingConsumable) {
      setFormError("Select a consumable from the approved list first.");
      return;
    }
    const parsedQuantity = Number(pendingConsumableQuantity);
    const quantity = Number.isFinite(parsedQuantity) ? parsedQuantity : 0;
    if (quantity <= 0) {
      setFormError("Consumable quantity must be greater than zero.");
      return;
    }
    if (quantity > pendingConsumable.availableNow) {
      setFormError(
        `Cannot use more than available for ${pendingConsumable.itemName}. Requested ${formatNumber(
          quantity
        )}, available ${formatNumber(pendingConsumable.availableNow)}.`
      );
      return;
    }
    setFormError(null);
    setStagedConsumables((current) => [
      ...current,
      {
        itemId: pendingConsumable.itemId,
        itemName: pendingConsumable.itemName,
        sku: pendingConsumable.sku,
        quantity: String(quantity)
      }
    ]);
    setPendingConsumableItemId("");
    setPendingConsumableQuantity("1");
  }, [pendingConsumable, pendingConsumableQuantity]);

  const handleFormProjectChange = useCallback((value: string) => {
    setConsumableSearch("");
    setPendingConsumableItemId("");
    setPendingConsumableQuantity("1");
    setStagedConsumables([]);
    setForm((current) => buildFormStateForProjectChange(current, value));
  }, []);

  const saveReport = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setFormSaving(true);
      setFormError(null);
      const result = await persistDrillingReport({
        form,
        formMode,
        editingReportId,
        formProjectLocation: formProject?.location,
        formProjectRigOptions,
        formProjectBillingItems,
        guidedBillableLinesResult,
        derivedHoleNumber,
        metersDrilledToday,
        derivedFromMeter,
        derivedToMeter,
        requiresContinuityOverride,
        stagedConsumables,
        consumablesPoolByItemId
      });
      if (!result.ok) {
        if (result.requiresContinuityOverride) {
          setRequiresContinuityOverride(true);
        }
        setFormError(result.error || "Failed to save drilling report.");
        setFormSaving(false);
        return;
      }

      try {
        await loadReportsData();
        emitDrillingAnalyticsRefresh();
        setNotice(formMode === "create" ? "Report saved." : "Report updated.");

        setIsFormOpen(false);
        setEditingReportId(null);
        setFormMode("create");
        setRequiresContinuityOverride(false);
        setForm(createEmptyForm(scopedProjectId, selectedProject?.assignedRig?.id || selectedProject?.backupRig?.id || ""));
      } catch {
        setFormError("Failed to refresh drilling reports after save.");
      } finally {
        setFormSaving(false);
      }
    },
    [
      editingReportId,
      form,
      consumablesPoolByItemId,
      formMode,
      formProjectBillingItems,
      formProjectRigOptions,
      formProject?.location,
      guidedBillableLinesResult,
      derivedFromMeter,
      derivedHoleNumber,
      derivedToMeter,
      loadReportsData,
      metersDrilledToday,
      requiresContinuityOverride,
      stagedConsumables,
      selectedProject?.assignedRig?.id,
      selectedProject?.backupRig?.id,
      scopedProjectId
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

        <DrillingReportsWorkspaceShellCard
          onCreateReport={openCreateReportModal}
          isSingleProjectScope={isSingleProjectScope}
          orderedProjectTabs={orderedProjectTabs}
          visibleProjectTabs={visibleProjectTabs}
          overflowProjectTabs={overflowProjectTabs}
          recentProjectTabs={recentProjectTabs}
          selectedProjectId={selectedProjectId}
          onSelectProject={handleSelectProject}
          selectedProject={selectedProject}
          selectedProjectRigsLabel={selectedProjectRigsLabel}
          selectedProjectBillingSummary={selectedProjectBillingSummary}
        />

        {!isSingleProjectScope ? (
          <FilterScopeBanner
            filters={filters}
            projectLabel={selectedProject?.name}
            clientLabel={selectedClientName}
            rigLabel={selectedRigLabel}
          />
        ) : null}

        <DrillingReportsProjectSummarySection
          selectedProject={selectedProject}
          selectedProjectRigsLabel={selectedProjectRigsLabel}
          selectedProjectBillingSummary={selectedProjectBillingSummary}
          selectedProjectDirectCostSummary={selectedProjectDirectCostSummary}
          selectedProjectOperationalKpis={selectedProjectOperationalKpis}
          stats={stats}
        />

        <Card
          className="hidden"
          title="Record-first workspace"
          subtitle="Use this page to create and edit drilling reports. Analysis and report browsing now live in Project Operations."
          action={
            <Link href={spendingReportsHref} className="gf-btn-subtle">
              View reports in Project Operations
            </Link>
          }
        >
          <div className="grid gap-3 md:grid-cols-3">
            <SummaryItem label="Total meters drilled" value={formatNumber(stats.totalMeters)} />
            <SummaryItem label="Total reports" value={String(stats.reportsLogged)} />
            <SummaryItem label="Average work hours" value={formatNumber(stats.averageWorkHours)} />
          </div>
          <p className="mt-3 text-xs text-slate-600">
            Record/edit stays here. Report list and detail are now in Project Operations to keep finance + report context together.
          </p>
        </Card>

        <section className="hidden grid gap-5 xl:grid-cols-[minmax(0,1.75fr)_minmax(320px,1fr)]">
          <div className="xl:col-span-2">
            <WorkflowAssistPanel model={reportingWorkflowAssist} />
          </div>
          <DrillingReportsBrowserSection
            focusedSectionId={focusedSectionId}
            focusedRowId={focusedRowId}
            selectedProjectName={selectedProject?.name || null}
            referencesLoading={referencesLoading}
            reportsLoading={reportsLoading}
            reports={reports}
            selectedReportId={selectedReportId}
            onSelectReport={setSelectedReportId}
            canCreateReport={canCreateReport}
            onCreateReport={openCreateReportModal}
            selectedReport={selectedReport}
            selectedReportDirectCostSummary={selectedReportDirectCostSummary}
            selectedReportOperationalKpis={selectedReportOperationalKpis}
            buildInventoryMovementHref={(movementId) =>
              buildHref("/inventory", {
                section: "stock-movements",
                movementId
              })
            }
            canEditReport={canEditReport}
            onEditReport={openEditReportModal}
          />
        </section>

        {!isSingleProjectScope ? (
          <Card title="Select one project to continue">
            <p className="text-sm text-ink-700">
              Recording drilling reports is project-first. Choose one project in the top filter bar to continue.
            </p>
          </Card>
        ) : null}

        {isSingleProjectScope && !canCreateReport ? (
          <Card title="Record drilling report">
            <p className="text-sm text-ink-700">
              You can view drilling data, but your role does not have permission to record reports.
            </p>
          </Card>
        ) : null}

        <DrillingReportEntryFormCard
          isFormOpen={isFormOpen}
          spendingReportsHref={spendingReportsHref}
          saveReport={saveReport}
          formMode={formMode}
          form={form}
          setForm={setForm}
          formSaving={formSaving}
          formError={formError}
          isSingleProjectScope={isSingleProjectScope}
          formProject={formProject}
          projects={projects}
          reportableProjects={reportableProjects}
          formProjectRigsLabel={formProjectRigsLabel}
          formProjectRigOptions={formProjectRigOptions}
          formProjectHoleProgress={formProjectHoleProgress}
          holeProgressLoading={holeProgressLoading}
          selectedHoleProgress={selectedHoleProgress}
          nextHoleNumberSuggestion={nextHoleNumberSuggestion}
          derivedFromMeter={derivedFromMeter}
          derivedToMeter={derivedToMeter}
          stageContextText={stageContextText}
          estimatedDailyBillable={estimatedDailyBillable}
          guidedBillableInputs={guidedBillableInputs}
          guidedBillableLinesResult={guidedBillableLinesResult}
          stagedCoverageWarning={stagedCoverageWarning}
          requiresContinuityOverride={requiresContinuityOverride}
          setRequiresContinuityOverride={setRequiresContinuityOverride}
          formConsumablesLoading={formConsumablesLoading}
          formConsumablesPool={formConsumablesPool}
          consumableSearch={consumableSearch}
          setConsumableSearch={setConsumableSearch}
          filteredConsumableSearchResults={filteredConsumableSearchResults}
          pendingConsumable={pendingConsumable}
          pendingConsumableQuantity={pendingConsumableQuantity}
          setPendingConsumableQuantity={setPendingConsumableQuantity}
          setPendingConsumableItemId={setPendingConsumableItemId}
          addPendingConsumableToStaged={addPendingConsumableToStaged}
          stagedConsumables={stagedConsumables}
          setStagedConsumables={setStagedConsumables}
          consumablesPoolByItemId={consumablesPoolByItemId}
          onProjectChange={handleFormProjectChange}
        />
      </div>
    </AccessGate>
  );
}
