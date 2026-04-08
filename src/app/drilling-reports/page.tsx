"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { AccessGate } from "@/components/layout/access-gate";
import { useRegisterCopilotContext } from "@/components/layout/ai-copilot-context";
import { FilterScopeBanner } from "@/components/layout/filter-scope-banner";
import { ProjectLockedBanner } from "@/components/layout/project-locked-banner";
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
import {
  buildDrillReportDirectCostSummary,
  buildDrillOperationalKpiSummary,
  buildProjectDirectCostSummaryFromReports,
  buildProjectOperationalKpiSummaryFromReports
} from "@/lib/drilling-direct-cost-summary";
import {
  buildGuidedBillableInputsModel,
  buildGuidedBillableLineInputs
} from "@/lib/drilling-report-guided-inputs";
import {
  DRILL_DELAY_REASON_OPTIONS,
  type DrillDelayReasonCategory
} from "@/lib/drill-report-delay-reasons";
import { cn, formatCurrency, formatNumber } from "@/lib/utils";

interface ProjectOption {
  id: string;
  name: string;
  location: string;
  clientId: string;
  status: string;
  contractType?: "PER_METER" | "DAY_RATE" | "LUMP_SUM";
  contractRatePerM: number;
  billingRateItems?: ProjectBillingRateItemOption[];
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

interface ProjectBillingRateItemOption {
  itemCode: string;
  label: string;
  unit: string;
  unitRate: number;
  drillingStageLabel?: string | null;
  depthBandStartM?: number | null;
  depthBandEndM?: number | null;
  sortOrder: number;
  isActive: boolean;
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
  delayReasonCategory: DrillDelayReasonCategory | null;
  delayReasonNote: string | null;
  holeContinuityOverrideReason: string | null;
  leadOperatorName: string | null;
  assistantCount: number;
  operatorCrew: string | null;
  billableAmount: number;
  comments: string | null;
  client: { id: string; name: string };
  project: { id: string; name: string; status: string };
  rig: { id: string; rigCode: string; status: string };
  submittedBy: { id: string; fullName: string } | null;
  approvedBy: { id: string; fullName: string } | null;
  billableLines: Array<{ itemCode: string; unit: string; quantity: number }>;
  inventoryMovements: Array<{
    id: string;
    date: string;
    quantity: number;
    totalCost: number;
    item: { id: string; name: string; sku: string } | null;
    expense: { id: string; amount: number; approvalStatus: string } | null;
  }>;
  inventoryUsageRequests: Array<{
    id: string;
    status: "SUBMITTED" | "PENDING" | "APPROVED" | "REJECTED";
    quantity: number;
    reason: string;
    approvedMovementId: string | null;
    createdAt: string;
    decidedAt: string | null;
    item: { id: string; name: string; sku: string } | null;
  }>;
  createdAt: string;
  updatedAt: string;
}

interface ProjectConsumablePoolItem {
  itemId: string;
  itemName: string;
  sku: string;
  stockOnHand: number;
  approvedRequestQty: number;
  approvedPurchaseQty: number;
  consumedQty: number;
  poolQty: number;
  availableNow: number;
  unitCost: number;
}

interface StagedConsumableLine {
  itemId: string;
  itemName: string;
  sku: string;
  quantity: string;
}

interface DrillStats {
  reportsLogged: number;
  totalMeters: number;
  billableActivity: number;
  averageWorkHours: number;
}

interface HoleProgressSummary {
  holeNumber: string;
  currentDepth: number;
  lastReportDate: string;
}

interface DrillReportFormState {
  date: string;
  projectId: string;
  rigId: string;
  holeMode: "CONTINUE" | "START_NEW";
  selectedHoleNumber: string;
  holeNumber: string;
  fromMeter: string;
  toMeter: string;
  metersDrilledToday: string;
  workHours: string;
  rigMoves: string;
  standbyHours: string;
  delayHours: string;
  delayReasonCategory: DrillDelayReasonCategory | "";
  delayReasonNote: string;
  holeContinuityOverrideReason: string;
  leadOperatorName: string;
  assistantCount: string;
  comments: string;
  billableQuantities: Record<string, string>;
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
  const [requiresContinuityOverride, setRequiresContinuityOverride] = useState(false);
  const [formConsumablesPool, setFormConsumablesPool] = useState<ProjectConsumablePoolItem[]>([]);
  const [formConsumablesLoading, setFormConsumablesLoading] = useState(false);
  const [consumableSearch, setConsumableSearch] = useState("");
  const [pendingConsumableItemId, setPendingConsumableItemId] = useState("");
  const [pendingConsumableQuantity, setPendingConsumableQuantity] = useState("1");
  const [stagedConsumables, setStagedConsumables] = useState<StagedConsumableLine[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [focusedRowId, setFocusedRowId] = useState<string | null>(null);
  const [focusedSectionId, setFocusedSectionId] = useState<string | null>(null);
  const [assistTarget, setAssistTarget] = useState<CopilotFocusTarget | null>(null);
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
      const [projectsRes, rigsRes] = await Promise.all([
        fetch("/api/projects", { cache: "no-store" }),
        fetch("/api/rigs", { cache: "no-store" })
      ]);

      const [projectsPayload, rigsPayload] = await Promise.all([
        projectsRes.ok ? projectsRes.json() : Promise.resolve({ data: [] }),
        rigsRes.ok ? rigsRes.json() : Promise.resolve({ data: [] })
      ]);

      setProjects(projectsPayload.data || []);
      setRigs(rigsPayload.data || []);
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
      const search = new URLSearchParams();
      if (filters.from) search.set("from", filters.from);
      if (filters.to) search.set("to", filters.to);
      if (!isSingleProjectScope && filters.clientId !== "all") search.set("clientId", filters.clientId);
      if (!isSingleProjectScope && filters.rigId !== "all") search.set("rigId", filters.rigId);
      search.set("projectId", scopedProjectId);

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
  const formProjectBillingItems = useMemo(
    () =>
      (formProject?.billingRateItems || [])
        .filter((item) => item.isActive)
        .sort((left, right) => left.sortOrder - right.sortOrder),
    [formProject]
  );
  const guidedBillableInputs = useMemo(
    () => buildGuidedBillableInputsModel(formProjectBillingItems),
    [formProjectBillingItems]
  );
  const formProjectHoleProgress = useMemo(
    () => holeProgressByProject[form.projectId] || [],
    [form.projectId, holeProgressByProject]
  );
  const nextHoleNumberSuggestion = useMemo(
    () => getNextHoleNumberSuggestion(formProjectHoleProgress),
    [formProjectHoleProgress]
  );
  const selectedHoleProgress = useMemo(
    () =>
      formProjectHoleProgress.find((entry) => entry.holeNumber === form.selectedHoleNumber) || null,
    [form.selectedHoleNumber, formProjectHoleProgress]
  );
  const defaultBaselineDepth = useMemo(() => {
    if (formMode === "edit") {
      const existingFrom = Number(form.fromMeter);
      return Number.isFinite(existingFrom) ? existingFrom : 0;
    }
    if (form.holeMode === "CONTINUE") {
      return selectedHoleProgress?.currentDepth || 0;
    }
    return 0;
  }, [form.fromMeter, form.holeMode, formMode, selectedHoleProgress]);
  const metersDrilledToday = useMemo(() => {
    const parsed = Number(form.metersDrilledToday || 0);
    if (!Number.isFinite(parsed) || parsed < 0) {
      return 0;
    }
    return parsed;
  }, [form.metersDrilledToday]);
  const derivedFromMeter = defaultBaselineDepth;
  const derivedToMeter = derivedFromMeter + metersDrilledToday;
  const derivedHoleNumber =
    form.holeMode === "START_NEW"
      ? form.holeNumber || nextHoleNumberSuggestion
      : form.selectedHoleNumber || form.holeNumber;
  const stageContextRows = useMemo(
    () => resolveStageContextRows(formProjectBillingItems, derivedFromMeter, derivedToMeter),
    [derivedFromMeter, derivedToMeter, formProjectBillingItems]
  );
  const stageContextText = useMemo(() => {
    if (metersDrilledToday <= 0) {
      return "Enter meters drilled today to preview stage context.";
    }
    if (stageContextRows.length === 0) {
      return "No staged billing band overlaps this report range.";
    }
    return stageContextRows
      .map((row) => `${row.label} (${formatNumber(row.rangeStart)}m-${formatNumber(row.rangeEnd)}m)`)
      .join(" • ");
  }, [metersDrilledToday, stageContextRows]);
  const guidedBillableLinesResult = useMemo(
    () =>
      buildGuidedBillableLineInputs({
        billingItems: formProjectBillingItems,
        metersDrilledToday,
        derivedFromMeter,
        derivedToMeter,
        workHours: Number(form.workHours),
        rigMoves: Number(form.rigMoves),
        standbyHours: Number(form.standbyHours),
        manualQuantities: form.billableQuantities
      }),
    [
      form.billableQuantities,
      derivedFromMeter,
      derivedToMeter,
      form.rigMoves,
      form.standbyHours,
      form.workHours,
      formProjectBillingItems,
      metersDrilledToday
    ]
  );
  const stagedCoverageWarning = useMemo(() => {
    if (!guidedBillableLinesResult.hasStagedAutoAllocation || metersDrilledToday <= 0) {
      return null;
    }
    if (guidedBillableLinesResult.stagedUnallocatedMeters <= 0) {
      return null;
    }
    return `Only ${formatNumber(guidedBillableLinesResult.stagedAllocatedMeters)}m of ${formatNumber(metersDrilledToday)}m fits configured stage bands. ${formatNumber(guidedBillableLinesResult.stagedUnallocatedMeters)}m is outside configured stage depth bands.`;
  }, [
    guidedBillableLinesResult.hasStagedAutoAllocation,
    guidedBillableLinesResult.stagedAllocatedMeters,
    guidedBillableLinesResult.stagedUnallocatedMeters,
    metersDrilledToday
  ]);
  const estimatedDailyBillable = useMemo(() => {
    const lineAmount = guidedBillableLinesResult.lines.reduce((sum, line) => {
      const rateItem = formProjectBillingItems.find((entry) => entry.itemCode === line.itemCode);
      const unitRate = Number(rateItem?.unitRate || 0);
      if (!Number.isFinite(unitRate) || unitRate <= 0) {
        return sum;
      }
      return sum + line.quantity * unitRate;
    }, 0);
    if (lineAmount > 0) {
      return lineAmount;
    }
    const fallbackRate = Number(formProject?.contractRatePerM || 0);
    return metersDrilledToday * (Number.isFinite(fallbackRate) ? fallbackRate : 0);
  }, [formProject?.contractRatePerM, formProjectBillingItems, guidedBillableLinesResult.lines, metersDrilledToday]);
  const consumablesPoolByItemId = useMemo(
    () => new Map(formConsumablesPool.map((entry) => [entry.itemId, entry])),
    [formConsumablesPool]
  );
  const pendingConsumable = useMemo(
    () => formConsumablesPool.find((entry) => entry.itemId === pendingConsumableItemId) || null,
    [formConsumablesPool, pendingConsumableItemId]
  );
  const filteredConsumableSearchResults = useMemo(() => {
    const query = consumableSearch.trim().toLowerCase();
    const stagedIds = new Set(stagedConsumables.map((row) => row.itemId));
    const filtered = formConsumablesPool.filter((entry) => {
      if (stagedIds.has(entry.itemId)) {
        return false;
      }
      if (!query) {
        return true;
      }
      return (
        entry.itemName.toLowerCase().includes(query) ||
        entry.sku.toLowerCase().includes(query)
      );
    });
    return filtered.slice(0, 8);
  }, [consumableSearch, formConsumablesPool, stagedConsumables]);

  const loadProjectHoleProgress = useCallback(async (projectId: string) => {
    if (!projectId) {
      return;
    }
    setHoleProgressLoading(true);
    try {
      const response = await fetch(`/api/drilling-reports?projectId=${encodeURIComponent(projectId)}`, {
        cache: "no-store"
      });
      const payload = response.ok ? await response.json() : { data: [] };
      const next = buildHoleProgressSummaries(Array.isArray(payload.data) ? payload.data : []);
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
        const search = new URLSearchParams({ projectId });
        if (excludeDrillReportId) {
          search.set("excludeDrillReportId", excludeDrillReportId);
        }
        const response = await fetch(`/api/drilling-reports/consumables?${search.toString()}`, {
          cache: "no-store"
        });
        const payload = response.ok ? await response.json() : { data: [] };
        setFormConsumablesPool(Array.isArray(payload.data) ? payload.data : []);
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
        { key: "averageWorkHours", label: "Average Work Hours", value: stats.averageWorkHours }
      ],
      tablePreviews: [
        {
          key: "drilling-reports",
          title: "Drilling Reports",
          rowCount: reports.length,
          columns: ["Date", "Project", "Rig", "Hole", "Meters", "WorkHours", "DelayHours"],
          rows: reports.slice(0, 10).map((report) => ({
            id: report.id,
            date: toIsoDate(report.date),
            project: report.project.name,
            rig: report.rig.rigCode,
            hole: report.holeNumber,
            meters: report.totalMetersDrilled,
            workHours: report.workHours,
            delayHours: report.delayHours,
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
          .filter((report) => report.delayHours > 0)
          .sort((a, b) => b.delayHours - a.delayHours)
          .slice(0, 3)
          .map((report) => ({
            id: report.id,
            label: `${report.project.name} • ${report.holeNumber}`,
            reason: `Delay recorded (${report.delayHours.toFixed(1)} hours). Review report context.`,
            severity: report.delayHours >= 4 ? ("HIGH" as const) : ("MEDIUM" as const),
            amount: report.billableAmount,
            href: buildHref("/drilling-reports"),
            issueType: "DRILLING_REPORT_COMPLETENESS",
            targetId: report.id,
            sectionId: "drilling-reports-table-section",
            targetPageKey: "drilling-reports"
          }))
      ],
      navigationTargets: [
        {
          label: "Open Revenue",
          href: buildHref("/revenue", { projectId: scopedProjectId || null }),
          reason: "Validate drilling output impact on revenue.",
          pageKey: "revenue"
        },
        {
          label: "Open Profit",
          href: buildHref("/profit", { projectId: scopedProjectId || null }),
          reason: "Review profitability impact for drilling scope.",
          pageKey: "profit"
        }
      ],
      notes: selectedProject
        ? [
            `Active project: ${selectedProject.name} (${selectedProject.client.name}).`,
            isSingleProjectScope
              ? "Project scope is set from the top bar."
              : "Project tabs define operational context while top bar filters refine scope."
          ]
        : ["Select an active project to anchor drilling operations context."]
    }),
    [
      buildHref,
      filters.clientId,
      filters.from,
      filters.rigId,
      filters.to,
      isSingleProjectScope,
      reports,
      selectedProject,
      scopedProjectId,
      selectedReport,
      stats.averageWorkHours,
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
    if (active && !active.leadOperatorName && !active.operatorCrew) {
      missingContext.push("Lead operator is missing.");
    }
    if (active && !active.areaLocation) {
      missingContext.push("Area/location field is missing.");
    }
    if (active && !active.comments) {
      missingContext.push("Comments note is missing.");
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
        (active?.delayHours || 0) > 6 ? "amber" : "indigo",
      whyThisMatters:
        assistTarget?.reason ||
        (active
          ? `Report ${active.holeNumber} affects daily production completeness.`
          : "This reporting target was prioritized to improve operational visibility."),
      inspectFirst: [
        "Confirm drilling meters, work hours, and delay values are accurate.",
        "Verify rig/project alignment and hole reference fields.",
        "Check for missing daily notes."
      ],
      missingContext,
      checklist: [
        "Complete daily report",
        "Review drilling details",
        "Confirm rig/project assignment",
        "Add comments if needed",
        "Check reporting completeness"
      ],
      recommendedNextStep: active
        ? "Complete missing notes and save this report."
        : "Open the highlighted report and complete missing details first."
    };
  }, [assistTarget, selectedReport, user?.role]);

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
    const initialRigId = initialProject?.assignedRig?.id || initialProject?.backupRig?.id || "";

    setFormMode("create");
    setEditingReportId(null);
    setFormError(null);
    setRequiresContinuityOverride(false);
    setNotice(null);
    setConsumableSearch("");
    setPendingConsumableItemId("");
    setPendingConsumableQuantity("1");
    setStagedConsumables([]);
    setForm(createEmptyForm(initialProjectId, initialRigId));
    if (initialProjectId && !holeProgressByProject[initialProjectId]) {
      void loadProjectHoleProgress(initialProjectId);
    }
    setIsFormOpen(true);
  }, [holeProgressByProject, loadProjectHoleProgress, projects, reportableProjects, scopedProjectId]);

  const openEditReportModal = useCallback((report: DrillReportRecord) => {
    const billableQuantities = report.billableLines.reduce<Record<string, string>>(
      (accumulator, line) => {
        accumulator[line.itemCode] = String(line.quantity);
        return accumulator;
      },
      {}
    );

    setFormMode("edit");
    setEditingReportId(report.id);
    setFormError(null);
    setRequiresContinuityOverride(Boolean(report.holeContinuityOverrideReason));
    setNotice(null);
    setConsumableSearch("");
    setPendingConsumableItemId("");
    setPendingConsumableQuantity("1");
    const stagedByItemId = new Map<string, StagedConsumableLine>();
    for (const movement of report.inventoryMovements || []) {
      const itemId = movement.item?.id || "";
      if (!itemId) {
        continue;
      }
      const existingLine = stagedByItemId.get(itemId);
      const movementQuantity = Math.max(0, Number(movement.quantity || 0));
      if (existingLine) {
        const nextQuantity = Number(existingLine.quantity) + movementQuantity;
        existingLine.quantity = String(nextQuantity);
      } else {
        stagedByItemId.set(itemId, {
          itemId,
          itemName: movement.item?.name || "Item",
          sku: movement.item?.sku || "",
          quantity: String(movementQuantity)
        });
      }
    }
    setStagedConsumables(Array.from(stagedByItemId.values()));
    setForm({
      date: new Date(report.date).toISOString().slice(0, 10),
      projectId: report.project.id,
      rigId: report.rig.id,
      holeMode: "CONTINUE",
      selectedHoleNumber: report.holeNumber,
      holeNumber: report.holeNumber,
      fromMeter: String(report.fromMeter),
      toMeter: String(report.toMeter),
      metersDrilledToday: String(report.totalMetersDrilled),
      workHours: String(report.workHours),
      rigMoves: String(report.rigMoves),
      standbyHours: String(report.standbyHours),
      delayHours: String(report.delayHours),
      delayReasonCategory: parseDelayReasonCategoryForForm(report.delayReasonCategory),
      delayReasonNote: report.delayReasonNote || "",
      holeContinuityOverrideReason: report.holeContinuityOverrideReason || "",
      leadOperatorName: report.leadOperatorName || report.operatorCrew || "",
      assistantCount: String(Math.max(0, Number(report.assistantCount || 0))),
      comments: report.comments || "",
      billableQuantities
    });
    if (!holeProgressByProject[report.project.id]) {
      void loadProjectHoleProgress(report.project.id);
    }
    setIsFormOpen(true);
  }, [holeProgressByProject, loadProjectHoleProgress]);

  const emitAnalyticsRefresh = useCallback(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem("gf:revenue-updated-at", String(Date.now()));
    window.dispatchEvent(new Event("gf:revenue-updated"));
    window.localStorage.setItem("gf:profit-updated-at", String(Date.now()));
    window.dispatchEvent(new Event("gf:profit-updated"));
  }, []);

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

  const saveReport = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setFormSaving(true);
      setFormError(null);
      const billableLinesInput = guidedBillableLinesResult.lines;
      if (guidedBillableLinesResult.error) {
        setFormError(guidedBillableLinesResult.error);
        setFormSaving(false);
        return;
      }

      if (!form.projectId) {
        setFormError("Select a project first.");
        setFormSaving(false);
        return;
      }
      if (!form.rigId) {
        setFormError("Select one of the project's assigned rigs before saving.");
        setFormSaving(false);
        return;
      }
      if (formProjectRigOptions.length === 0) {
        setFormError("This project has no assigned rig. Assign a rig to the project first.");
        setFormSaving(false);
        return;
      }
      if (!formProjectRigOptions.some((rigOption) => rigOption.id === form.rigId)) {
        setFormError("Selected rig is not assigned to this project. Choose one of the project rigs.");
        setFormSaving(false);
        return;
      }
      if (!derivedHoleNumber) {
        setFormError("Choose a hole to continue or start a new hole.");
        setFormSaving(false);
        return;
      }
      if (metersDrilledToday < 0) {
        setFormError("Meters drilled today must be zero or greater.");
        setFormSaving(false);
        return;
      }
      const parsedDelayHours = Number(form.delayHours);
      const delayHours = Number.isFinite(parsedDelayHours) ? parsedDelayHours : 0;
      if (delayHours > 0 && !form.delayReasonCategory) {
        setFormError("Select a delay reason when delay hours are above zero.");
        setFormSaving(false);
        return;
      }
      const trimmedOverrideReason = form.holeContinuityOverrideReason.trim();
      if (requiresContinuityOverride && trimmedOverrideReason.length === 0) {
        setFormError("Add a short reason to continue with a different starting depth.");
        setFormSaving(false);
        return;
      }
      const trimmedDelayNote = form.delayReasonNote.trim();
      const trimmedLeadOperatorName = form.leadOperatorName.trim();
      const parsedAssistantCount = Number(form.assistantCount);
      const assistantCount =
        Number.isFinite(parsedAssistantCount) && parsedAssistantCount >= 0
          ? Math.round(parsedAssistantCount)
          : 0;
      const consumablesUsedPayload: Array<{ itemId: string; quantity: number }> = [];
      for (const row of stagedConsumables) {
        const quantity = Number(row.quantity);
        if (!Number.isFinite(quantity) || quantity < 0) {
          setFormError(`Consumable quantity for ${row.itemName} must be zero or greater.`);
          setFormSaving(false);
          return;
        }
        if (quantity === 0) {
          continue;
        }
        const pool = consumablesPoolByItemId.get(row.itemId);
        if (!pool) {
          setFormError(`${row.itemName} is no longer approved and available for this project.`);
          setFormSaving(false);
          return;
        }
        if (quantity > pool.availableNow) {
          setFormError(
            `Cannot use more than available for ${row.itemName}. Requested ${formatNumber(
              quantity
            )}, available ${formatNumber(pool.availableNow)}.`
          );
          setFormSaving(false);
          return;
        }
        consumablesUsedPayload.push({
          itemId: row.itemId,
          quantity
        });
      }

      const payload = {
        date: form.date,
        projectId: form.projectId,
        rigId: form.rigId,
        holeNumber: derivedHoleNumber,
        areaLocation: formProject?.location || "Project site",
        fromMeter: derivedFromMeter,
        toMeter: derivedToMeter,
        totalMetersDrilled: metersDrilledToday,
        workHours: Number(form.workHours),
        rigMoves: Number(form.rigMoves),
        standbyHours: Number(form.standbyHours),
        delayHours,
        delayReasonCategory: delayHours > 0 ? form.delayReasonCategory || null : null,
        delayReasonNote: delayHours > 0 ? (trimmedDelayNote.length > 0 ? trimmedDelayNote : null) : null,
        holeContinuityOverrideReason: trimmedOverrideReason.length > 0 ? trimmedOverrideReason : null,
        leadOperatorName: trimmedLeadOperatorName.length > 0 ? trimmedLeadOperatorName : null,
        assistantCount,
        comments: form.comments,
        consumablesUsed: consumablesUsedPayload,
        ...(formProjectBillingItems.length > 0 ? { billableLines: billableLinesInput } : {})
      };

      try {
        if (formMode === "create") {
          const response = await fetch("/api/drilling-reports", {
            method: "POST",
            headers: {
              "Content-Type": "application/json"
            },
            body: JSON.stringify(payload)
          });

          if (!response.ok) {
            const message = await readApiError(response, "Failed to save drilling report.");
            if (message.includes("Add an override reason to save.")) {
              setRequiresContinuityOverride(true);
            }
            setFormError(message);
            return;
          }

          await response.json();
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
            const message = await readApiError(response, "Failed to update drilling report.");
            if (message.includes("Add an override reason to save.")) {
              setRequiresContinuityOverride(true);
            }
            setFormError(message);
            return;
          }

          await response.json();
        }

        await loadReportsData();
        emitAnalyticsRefresh();
        setNotice(formMode === "create" ? "Report saved." : "Report updated.");

        setIsFormOpen(false);
        setEditingReportId(null);
        setFormMode("create");
        setRequiresContinuityOverride(false);
        setForm(createEmptyForm(scopedProjectId, selectedProject?.assignedRig?.id || selectedProject?.backupRig?.id || ""));
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
      consumablesPoolByItemId,
      formMode,
      formProjectBillingItems,
      formProjectRigOptions,
      formProject?.location,
      guidedBillableLinesResult.error,
      guidedBillableLinesResult.lines,
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

        <Card
          className="hidden"
          title="Drilling workspace"
          subtitle="Record what happened today. Use Spending for report browsing and detail review."
          action={
            <AccessGate permission="drilling:submit" fallback={null}>
              <button
                type="button"
                onClick={openCreateReportModal}
                className="gf-btn-primary px-3 py-2 text-xs"
              >
                Record report
              </button>
            </AccessGate>
          }
        >
          <div className="space-y-3">
            <div className="space-y-2">
              {!isSingleProjectScope ? (
                <>
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
                </>
              ) : null}
            </div>

            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
              {!selectedProject ? (
                <p className="text-sm text-ink-600">
                  {isSingleProjectScope
                    ? "Select a project in the top bar to set the active drilling workspace."
                    : "Select a project tab to set the active drilling workspace."}
                </p>
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
                    <span className="font-semibold text-ink-800">{selectedProjectBillingSummary.label}:</span>{" "}
                    {selectedProjectBillingSummary.value}
                  </p>
                </div>
              )}
              <p className="mt-1 text-[11px] text-slate-500">Top bar controls project and date scope.</p>
            </div>
            {selectedProject ? (
              <div className="gf-guided-strip">
                <p className="gf-guided-strip-title">Guided daily flow</p>
                <div className="gf-guided-step-list">
                  <p className="gf-guided-step">1. Choose hole progression.</p>
                  <p className="gf-guided-step">2. Enter meters and operational hours.</p>
                  <p className="gf-guided-step">3. Save report to commit daily activity.</p>
                </div>
              </div>
            ) : null}
          </div>
        </Card>

        {isSingleProjectScope ? (
          <ProjectLockedBanner projectId={scopedProjectId} projectName={selectedProject?.name || null} />
        ) : (
          <FilterScopeBanner
            filters={filters}
            projectLabel={selectedProject?.name}
            clientLabel={selectedClientName}
            rigLabel={selectedRigLabel}
          />
        )}

        <section id="drilling-project-summary-section" className="hidden">
        <Card title={selectedProject ? `${selectedProject.name} Overview` : "Project Overview"} subtitle="Current project activity and operational KPIs">
          {!selectedProject ? (
            <p className="text-sm text-ink-600">Select a project to view drilling activity.</p>
          ) : (
            <div className="space-y-4">
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <SummaryItem label="Client" value={selectedProject.client.name} />
                <SummaryItem label="Assigned Rig(s)" value={selectedProjectRigsLabel} />
                <SummaryItem label="Project Status" value={formatProjectStatus(selectedProject.status)} />
                <SummaryItem label={selectedProjectBillingSummary.label} value={selectedProjectBillingSummary.value} />
              </div>

              <section className="grid gap-3 md:grid-cols-4">
                <MetricCard label="Total Meters Drilled" value={formatNumber(stats.totalMeters)} />
                <MetricCard label="Total Reports" value={String(stats.reportsLogged)} />
                <MetricCard label="Total Billable" value={formatCurrency(stats.billableActivity)} tone="good" />
                <MetricCard label="Average Work Hours" value={formatNumber(stats.averageWorkHours)} />
              </section>

              <section className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Basic direct-cost view
                </p>
                <div className="mt-2 grid gap-3 md:grid-cols-3">
                  <MetricCard
                    label="Total revenue"
                    value={formatCurrency(selectedProjectDirectCostSummary.totalRevenue)}
                    tone="good"
                  />
                  <MetricCard
                    label="Total used consumables cost"
                    value={formatCurrency(selectedProjectDirectCostSummary.totalUsedConsumablesCost)}
                    tone="warn"
                  />
                  <MetricCard
                    label="Simple result"
                    value={formatCurrency(selectedProjectDirectCostSummary.simpleResult)}
                    tone={selectedProjectDirectCostSummary.simpleResult >= 0 ? "good" : "danger"}
                  />
                </div>
                <p className="mt-2 text-xs text-slate-600">
                  Direct-cost only: includes drilling revenue and consumables used. Other project costs are not included.
                </p>
              </section>

              <section className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Operational KPI view
                </p>
                <div className="mt-2 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                  <MetricCard label="Meters drilled" value={formatNumber(selectedProjectOperationalKpis.metersDrilled)} />
                  <MetricCard label="Work hours" value={formatNumber(selectedProjectOperationalKpis.workHours)} />
                  <MetricCard
                    label="Meters per hour"
                    value={
                      selectedProjectOperationalKpis.metersPerHour === null
                        ? "—"
                        : formatNumber(selectedProjectOperationalKpis.metersPerHour)
                    }
                  />
                  <MetricCard
                    label="Consumables cost used"
                    value={formatCurrency(selectedProjectOperationalKpis.consumablesCostUsed)}
                    tone="warn"
                  />
                  <MetricCard
                    label="Consumables cost per meter"
                    value={
                      selectedProjectOperationalKpis.consumablesCostPerMeter === null
                        ? "—"
                        : formatCurrency(selectedProjectOperationalKpis.consumablesCostPerMeter)
                    }
                    tone="warn"
                  />
                </div>
                <p className="mt-2 text-xs text-slate-600">
                  Operational KPIs only: based on drilling activity and consumables used. This is not full project margin.
                </p>
              </section>
            </div>
          )}
        </Card>
        </section>

        <Card
          className="hidden"
          title="Record-first workspace"
          subtitle="Use this page to create and edit drilling reports. Analysis and report browsing now live in Spending."
          action={
            <Link href={spendingReportsHref} className="gf-btn-subtle">
              View reports in Spending
            </Link>
          }
        >
          <div className="grid gap-3 md:grid-cols-3">
            <SummaryItem label="Total meters drilled" value={formatNumber(stats.totalMeters)} />
            <SummaryItem label="Total reports" value={String(stats.reportsLogged)} />
            <SummaryItem label="Average work hours" value={formatNumber(stats.averageWorkHours)} />
          </div>
          <p className="mt-3 text-xs text-slate-600">
            Record/edit stays here. Report list and detail are now in Spending to keep finance + report context together.
          </p>
        </Card>

        <section className="hidden grid gap-5 xl:grid-cols-[minmax(0,1.75fr)_minmax(320px,1fr)]">
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
                    Record first report
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
                        <th className="px-3 py-2">Crew</th>
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
                          <td className="px-3 py-2 text-ink-700">{formatCrewSummary(report)}</td>
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
            title="Report details"
            subtitle={selectedReport ? `Hole ${selectedReport.holeNumber}` : "Select a report from the table"}
            className="min-h-[420px] xl:sticky xl:top-24"
          >
            {!selectedReport ? (
              <p className="text-sm text-ink-600">Select a report to view daily activity and usage details.</p>
            ) : (
              <div className="space-y-4 text-sm">
                <div className="grid gap-2">
                  <DetailRow label="Date" value={toIsoDate(selectedReport.date)} />
                  <DetailRow label="Client" value={selectedReport.client.name} />
                  <DetailRow label="Project" value={selectedReport.project.name} />
                  <DetailRow label="Rig" value={selectedReport.rig.rigCode} />
                  <DetailRow label="Hole" value={selectedReport.holeNumber} />
                  <DetailRow label="Area" value={selectedReport.areaLocation} />
                  <DetailRow label="Start depth" value={selectedReport.fromMeter.toFixed(1)} />
                  <DetailRow label="End depth" value={selectedReport.toMeter.toFixed(1)} />
                  <DetailRow label="Meters drilled today" value={formatNumber(selectedReport.totalMetersDrilled)} />
                  <DetailRow label="Work hours" value={selectedReport.workHours.toFixed(1)} />
                  <DetailRow label="Rig moves" value={String(selectedReport.rigMoves)} />
                  <DetailRow label="Standby hours" value={selectedReport.standbyHours.toFixed(1)} />
                  <DetailRow label="Delay hours" value={selectedReport.delayHours.toFixed(1)} />
                  <DetailRow
                    label="Delay reason"
                    value={formatDelayReasonLabel(selectedReport.delayReasonCategory)}
                  />
                  <DetailRow label="Delay note" value={selectedReport.delayReasonNote || "-"} />
                  <DetailRow
                    label="Continuity override reason"
                    value={selectedReport.holeContinuityOverrideReason || "-"}
                  />
                  <DetailRow label="Lead operator" value={selectedReport.leadOperatorName || "-"} />
                  <DetailRow
                    label="Assistants"
                    value={String(Math.max(0, Math.round(Number(selectedReport.assistantCount || 0))))}
                  />
                  <DetailRow label="Crew" value={formatCrewSummary(selectedReport)} />
                  <DetailRow label="Revenue" value={formatCurrency(selectedReport.billableAmount)} />
                  <DetailRow label="Comments" value={selectedReport.comments || "-"} />
                  <DetailRow label="Recorded by" value={selectedReport.submittedBy?.fullName || "-"} />
                  <DetailRow
                    label="Recorded at"
                    value={formatDateTime(selectedReport.submittedAt || selectedReport.createdAt)}
                  />
                  <DetailRow label="Created At" value={formatDateTime(selectedReport.createdAt)} />
                  <DetailRow label="Updated At" value={formatDateTime(selectedReport.updatedAt)} />
                </div>

                {selectedReportDirectCostSummary ? (
                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Basic financial summary
                    </p>
                    <div className="mt-2 grid gap-1">
                      <DetailRow label="Revenue" value={formatCurrency(selectedReportDirectCostSummary.revenue)} />
                      <DetailRow
                        label="Consumables cost used"
                        value={formatCurrency(selectedReportDirectCostSummary.consumablesCostUsed)}
                      />
                      <DetailRow
                        label="Simple result"
                        value={formatCurrency(selectedReportDirectCostSummary.simpleResult)}
                      />
                    </div>
                    <p className="mt-2 text-xs text-slate-600">
                      Direct-cost only: includes drilling revenue and consumables used. Other project costs are not included.
                    </p>
                  </div>
                ) : null}

                {selectedReportOperationalKpis ? (
                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Operational KPI view
                    </p>
                    <div className="mt-2 grid gap-1">
                      <DetailRow label="Meters drilled" value={formatNumber(selectedReportOperationalKpis.metersDrilled)} />
                      <DetailRow label="Work hours" value={formatNumber(selectedReportOperationalKpis.workHours)} />
                      <DetailRow
                        label="Meters per hour"
                        value={
                          selectedReportOperationalKpis.metersPerHour === null
                            ? "—"
                            : formatNumber(selectedReportOperationalKpis.metersPerHour)
                        }
                      />
                      <DetailRow
                        label="Consumables cost used"
                        value={formatCurrency(selectedReportOperationalKpis.consumablesCostUsed)}
                      />
                      <DetailRow
                        label="Consumables cost per meter"
                        value={
                          selectedReportOperationalKpis.consumablesCostPerMeter === null
                            ? "—"
                            : formatCurrency(selectedReportOperationalKpis.consumablesCostPerMeter)
                        }
                      />
                    </div>
                    <p className="mt-2 text-xs text-slate-600">
                      Operational KPIs only: based on drilling activity and consumables used. This is not full project margin.
                    </p>
                  </div>
                ) : null}

                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Consumables used
                  </p>
                  {(selectedReport.inventoryMovements || []).length === 0 ? (
                    <p className="mt-1 text-xs text-slate-600">
                      No consumables were recorded on this report.
                    </p>
                  ) : (
                    <div className="mt-2 space-y-1.5">
                      {(selectedReport.inventoryMovements || []).slice(0, 8).map((movementRow) => (
                        <div
                          key={movementRow.id}
                          className="grid gap-1 rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-700 sm:grid-cols-[minmax(0,1fr)_auto_auto]"
                        >
                          <p className="truncate">
                            {formatNumber(movementRow.quantity)} x{" "}
                            {movementRow.item?.name || "Item"}
                          </p>
                          <p className="font-medium">{formatCurrency(movementRow.totalCost || 0)}</p>
                          {movementRow.id ? (
                            <a
                              href={buildHref("/inventory", {
                                section: "stock-movements",
                                movementId: movementRow.id
                              })}
                              className="text-brand-700 underline"
                            >
                              Movement
                            </a>
                          ) : (
                            <span className="text-slate-500">—</span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap gap-2 border-t border-slate-200 pt-3">
                  {canEditReport(selectedReport) && (
                    <button
                      type="button"
                      onClick={() => openEditReportModal(selectedReport)}
                      className="rounded-md border border-slate-300 px-3 py-1.5 text-xs text-ink-700 hover:bg-slate-50"
                    >
                      Edit Report
                    </button>
                  )}
                </div>
              </div>
            )}
          </Card>
          </div>
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

        {isFormOpen && (
          <Card
            title="New drilling report"
            subtitle="Record today's drilling activity for the locked project."
            action={
              <Link href={spendingReportsHref} className="gf-btn-subtle">
                View reports in Spending
              </Link>
            }
          >
            <form onSubmit={saveReport} className="px-1 py-1">
                <div className="mb-4 gf-guided-strip">
                  <p className="gf-guided-strip-title">Keep it simple</p>
                  <div className="gf-guided-step-list">
                    <p className="gf-guided-step">Use meters drilled today as the main depth input.</p>
                    <p className="gf-guided-step">Fill daily operational fields and configured extras only.</p>
                    <p className="gf-guided-step">Save report to record activity and linked consumable usage.</p>
                  </div>
                </div>
                <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
                  <ReadOnlyField
                    label="Report date"
                    value={formMode === "create" ? `${form.date} (today)` : form.date}
                  />

                  {isSingleProjectScope ? (
                    <ReadOnlyField
                      label="Project (locked)"
                      value={
                        formProject
                          ? `${formProject.name} (${formatProjectStatus(formProject.status)})`
                          : "Selected project"
                      }
                    />
                  ) : (
                    <SelectField
                      label="Project"
                      value={form.projectId}
                      onChange={(value) => {
                        setRequiresContinuityOverride(false);
                        setConsumableSearch("");
                        setPendingConsumableItemId("");
                        setPendingConsumableQuantity("1");
                        setStagedConsumables([]);
                        setForm((current) => ({
                          ...current,
                          projectId: value,
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
                      }}
                      options={(reportableProjects.length > 0 ? reportableProjects : projects).map((project) => ({
                        value: project.id,
                        label: `${project.name} (${formatProjectStatus(project.status)})`
                      }))}
                      required
                    />
                  )}

                  {isSingleProjectScope ? (
                    <div className="rounded-lg border border-brand-200 bg-brand-50/70 px-3 py-2 text-sm text-brand-900 lg:col-span-2">
                      <p>
                        <span className="font-semibold">Client:</span> {formProject?.client.name || "-"}
                      </p>
                      <p>
                        <span className="font-semibold">Project rig(s):</span> {formProjectRigsLabel}
                      </p>
                    </div>
                  ) : (
                    <>
                      <ReadOnlyField label="Client" value={formProject?.client.name || "-"} />
                      <ReadOnlyField label="Project rig(s)" value={formProjectRigsLabel} />
                    </>
                  )}

                  {formProjectRigOptions.length > 1 ? (
                    <SelectField
                      label="Rig"
                      value={form.rigId}
                      onChange={(value) => setForm((current) => ({ ...current, rigId: value }))}
                      options={formProjectRigOptions.map((rigOption) => ({
                        value: rigOption.id,
                        label: rigOption.rigCode
                      }))}
                      required
                    />
                  ) : formProjectRigOptions.length === 1 ? (
                    <ReadOnlyField label="Rig" value={formProjectRigOptions[0]?.rigCode || "-"} />
                  ) : (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 lg:col-span-2">
                      This project has no assigned rig. Assign a rig to the project before saving reports.
                    </div>
                  )}

                  <div className="lg:col-span-4 rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
                    <p className="text-sm font-semibold text-ink-900">Hole progression</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={formProjectHoleProgress.length === 0}
                        onClick={() =>
                          setForm((current) => ({
                            ...current,
                            holeMode: "CONTINUE",
                            selectedHoleNumber:
                              current.selectedHoleNumber || formProjectHoleProgress[0]?.holeNumber || ""
                          }))
                        }
                        className={`rounded-full border px-3 py-1 text-xs ${
                          form.holeMode === "CONTINUE"
                            ? "border-brand-500 bg-brand-50 text-brand-800"
                            : "border-slate-200 bg-white text-slate-700"
                        } disabled:cursor-not-allowed disabled:opacity-60`}
                      >
                        Continue existing hole
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setForm((current) => ({
                            ...current,
                            holeMode: "START_NEW",
                            holeNumber: nextHoleNumberSuggestion
                          }))
                        }
                        className={`rounded-full border px-3 py-1 text-xs ${
                          form.holeMode === "START_NEW"
                            ? "border-brand-500 bg-brand-50 text-brand-800"
                            : "border-slate-200 bg-white text-slate-700"
                        }`}
                      >
                        Start new hole
                      </button>
                    </div>

                    {form.holeMode === "CONTINUE" ? (
                      <div className="mt-3 grid gap-2 md:grid-cols-2">
                        <SelectField
                          label="Hole"
                          value={form.selectedHoleNumber}
                          onChange={(value) =>
                            setForm((current) => ({
                              ...current,
                              selectedHoleNumber: value,
                              holeNumber: value
                            }))
                          }
                          options={formProjectHoleProgress.map((hole) => ({
                            value: hole.holeNumber,
                            label: `${hole.holeNumber} (current depth ${formatNumber(hole.currentDepth)}m)`
                          }))}
                          required
                        />
                        <ReadOnlyField
                          label="Current drilled depth"
                          value={
                            holeProgressLoading
                              ? "Loading..."
                              : selectedHoleProgress
                                ? `${formatNumber(selectedHoleProgress.currentDepth)}m`
                                : "No saved depth yet"
                          }
                        />
                      </div>
                    ) : (
                      <ReadOnlyField label="New hole number" value={nextHoleNumberSuggestion} />
                    )}
                  </div>

                  <div className="lg:col-span-4 rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
                    <p className="text-sm font-semibold text-ink-900">Daily activity</p>
                    <p className="mt-1 text-xs text-slate-600">
                      Enter the daily drilling activity. Depth progression is derived automatically.
                    </p>
                    <div className="mt-3 grid gap-3 md:grid-cols-2 lg:grid-cols-4">
                      <InputField
                        label="Meters drilled today"
                        type="number"
                        value={form.metersDrilledToday}
                        onChange={(value) => setForm((current) => ({ ...current, metersDrilledToday: value }))}
                      />

                      <ReadOnlyField label="Previous depth" value={`${formatNumber(derivedFromMeter)}m`} />
                      <ReadOnlyField label="New depth" value={`${formatNumber(derivedToMeter)}m`} />
                      <ReadOnlyField label="Stage guidance" value={stageContextText} />

                      <InputField
                        label="Work hours"
                        type="number"
                        value={form.workHours}
                        onChange={(value) => setForm((current) => ({ ...current, workHours: value }))}
                      />

                      <InputField
                        label="Delay hours"
                        type="number"
                        value={form.delayHours}
                        onChange={(value) => setForm((current) => ({ ...current, delayHours: value }))}
                      />

                      {Number(form.delayHours || 0) > 0 ? (
                        <SelectField
                          label="Delay reason"
                          value={form.delayReasonCategory}
                          onChange={(value) =>
                            setForm((current) => ({
                              ...current,
                              delayReasonCategory: parseDelayReasonCategoryForForm(value)
                            }))
                          }
                          options={DRILL_DELAY_REASON_OPTIONS.map((option) => ({
                            value: option.value,
                            label: option.label
                          }))}
                          required
                        />
                      ) : null}

                      <InputField
                        label="Rig moves"
                        type="number"
                        value={form.rigMoves}
                        onChange={(value) => setForm((current) => ({ ...current, rigMoves: value }))}
                      />

                      <InputField
                        label="Standby hours"
                        type="number"
                        value={form.standbyHours}
                        onChange={(value) => setForm((current) => ({ ...current, standbyHours: value }))}
                      />

                      <InputField
                        label="Lead operator"
                        value={form.leadOperatorName}
                        onChange={(value) => setForm((current) => ({ ...current, leadOperatorName: value }))}
                      />

                      <InputField
                        label="Assistants"
                        type="number"
                        value={form.assistantCount}
                        onChange={(value) => setForm((current) => ({ ...current, assistantCount: value }))}
                      />
                    </div>
                    {Number(form.delayHours || 0) > 0 ? (
                      <label className="mt-3 block text-sm text-ink-700">
                        <span className="mb-1 block">Delay note (optional)</span>
                        <textarea
                          value={form.delayReasonNote}
                          onChange={(event) =>
                            setForm((current) => ({
                              ...current,
                              delayReasonNote: event.target.value
                            }))
                          }
                          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none ring-brand-300 focus:ring"
                          rows={2}
                        />
                      </label>
                    ) : null}
                    {requiresContinuityOverride || form.holeContinuityOverrideReason.trim().length > 0 ? (
                      <label className="mt-3 block text-sm text-ink-700">
                        <span className="mb-1 block">Depth continuity override reason</span>
                        <textarea
                          value={form.holeContinuityOverrideReason}
                          onChange={(event) =>
                            setForm((current) => ({
                              ...current,
                              holeContinuityOverrideReason: event.target.value
                            }))
                          }
                          className="w-full rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm outline-none ring-brand-300 focus:ring"
                          rows={2}
                          placeholder="Add a short reason for the depth difference."
                        />
                      </label>
                    ) : null}
                    <div className="mt-3 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700">
                      Estimated revenue (preview):{" "}
                      <span className="font-semibold text-ink-900">{formatCurrency(estimatedDailyBillable)}</span>
                    </div>
                    {guidedBillableInputs.meterMode === "single" && guidedBillableInputs.singleMeterItem ? (
                      <p className="mt-2 text-xs text-slate-600">
                        Meters drilled today automatically map to{" "}
                        <span className="font-medium">{guidedBillableInputs.singleMeterItem.label}</span>.
                      </p>
                    ) : null}
                    {stagedCoverageWarning ? (
                      <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                        {stagedCoverageWarning}
                      </div>
                    ) : null}
                    {guidedBillableLinesResult.hasStagedAutoAllocation ? (
                      <div className="mt-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700">
                        <p className="font-semibold text-ink-900">Staged meter allocation (auto)</p>
                        <div className="mt-1 space-y-1">
                          {guidedBillableLinesResult.stagedAllocationPreview.filter((line) => line.quantity > 0).length === 0 ? (
                            <p>No meters from this report range match configured stage bands.</p>
                          ) : (
                            guidedBillableLinesResult.stagedAllocationPreview
                              .filter((line) => line.quantity > 0)
                              .map((line) => (
                                <p key={line.itemCode}>
                                  {line.label}: {formatNumber(line.quantity)} {line.unit}
                                </p>
                              ))
                          )}
                        </div>
                      </div>
                    ) : null}
                  </div>

                  {guidedBillableInputs.extraItems.length > 0 ? (
                    <div className="lg:col-span-4 rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
                      <p className="text-sm font-semibold text-ink-900">Project extras (if used today)</p>
                      <div className="mt-3 grid gap-3 md:grid-cols-2">
                        {guidedBillableInputs.extraItems.map((item) => (
                          <InputField
                            key={item.itemCode}
                            label={`${item.label} (${item.unit})`}
                            type="number"
                            value={form.billableQuantities[item.itemCode] || ""}
                            onChange={(value) =>
                              setForm((current) => ({
                                ...current,
                                billableQuantities: {
                                  ...current.billableQuantities,
                                  [item.itemCode]: value
                                }
                              }))
                            }
                          />
                        ))}
                      </div>
                    </div>
                  ) : null}

                  <div className="lg:col-span-4 rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
                    <p className="text-sm font-semibold text-ink-900">Approved consumables used today</p>
                    <p className="mt-1 text-xs text-slate-600">
                      Optional. Search approved project consumables, then add what was actually used on this report.
                    </p>
                    <div className="mt-3 grid gap-3 md:grid-cols-2">
                      <label className="text-xs text-ink-700">
                        <span className="mb-1 block uppercase tracking-wide text-slate-500">
                          Search consumables
                        </span>
                        <input
                          value={consumableSearch}
                          onChange={(event) => setConsumableSearch(event.target.value)}
                          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                          placeholder={
                            formConsumablesLoading
                              ? "Loading approved consumables..."
                              : "Search by item name or SKU"
                          }
                          disabled={formConsumablesLoading || !form.projectId}
                        />
                      </label>
                      <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700">
                        <p className="font-semibold text-ink-900">
                          {formConsumablesLoading ? "Refreshing approved pool..." : "Approved pool"}
                        </p>
                        <p className="mt-1">
                          {formConsumablesLoading
                            ? "Checking approved and available quantities for this project."
                            : `${formConsumablesPool.length} item(s) currently available for use.`}
                        </p>
                      </div>
                    </div>

                    {consumableSearch.trim().length > 0 ? (
                      <div className="mt-2 max-h-44 overflow-auto rounded-lg border border-slate-200 bg-white">
                        {filteredConsumableSearchResults.length === 0 ? (
                          <p className="px-3 py-2 text-xs text-slate-600">
                            No approved consumables match this search.
                          </p>
                        ) : (
                          filteredConsumableSearchResults.map((entry) => (
                            <button
                              key={entry.itemId}
                              type="button"
                              onClick={() => {
                                setPendingConsumableItemId(entry.itemId);
                                setPendingConsumableQuantity("1");
                                setConsumableSearch("");
                              }}
                              className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-2 border-b border-slate-100 px-3 py-2 text-left text-xs text-ink-700 last:border-b-0 hover:bg-slate-50"
                            >
                              <span className="truncate">
                                {entry.itemName} <span className="text-slate-500">({entry.sku})</span>
                              </span>
                              <span className="font-medium text-slate-600">
                                Available {formatNumber(entry.availableNow)}
                              </span>
                            </button>
                          ))
                        )}
                      </div>
                    ) : null}

                    {pendingConsumable ? (
                      <div className="mt-3 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-ink-700">
                        <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_120px_auto] md:items-end">
                          <div>
                            <p className="font-semibold text-ink-900">
                              {pendingConsumable.itemName}{" "}
                              <span className="text-slate-500">({pendingConsumable.sku})</span>
                            </p>
                            <p className="mt-0.5 text-slate-600">
                              Available {formatNumber(pendingConsumable.availableNow)}
                            </p>
                          </div>
                          <InputField
                            label="Quantity"
                            type="number"
                            value={pendingConsumableQuantity}
                            onChange={setPendingConsumableQuantity}
                          />
                          <div className="flex items-center gap-2 pb-1">
                            <button
                              type="button"
                              onClick={addPendingConsumableToStaged}
                              className="rounded-md bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-700"
                            >
                              Use
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setPendingConsumableItemId("");
                                setPendingConsumableQuantity("1");
                              }}
                              className="rounded-md border border-slate-200 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      </div>
                    ) : null}

                    <div className="mt-3 rounded-lg border border-slate-200 bg-white">
                      <div className="border-b border-slate-200 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Used in this report
                      </div>
                      {stagedConsumables.length === 0 ? (
                        <p className="px-3 py-2 text-xs text-slate-600">
                          No consumables added yet.
                        </p>
                      ) : (
                        <div className="divide-y divide-slate-100">
                          {stagedConsumables.map((row) => {
                            const pool = consumablesPoolByItemId.get(row.itemId);
                            return (
                              <div
                                key={row.itemId}
                                className="grid gap-2 px-3 py-2 text-xs text-ink-700 md:grid-cols-[minmax(0,1fr)_140px_auto]"
                              >
                                <div>
                                  <p className="font-medium text-ink-900">
                                    {row.itemName} <span className="text-slate-500">({row.sku})</span>
                                  </p>
                                  <p className="mt-0.5 text-slate-600">
                                    Available {formatNumber(pool?.availableNow || 0)}
                                  </p>
                                </div>
                                <InputField
                                  label="Quantity"
                                  type="number"
                                  value={row.quantity}
                                  onChange={(value) =>
                                    setStagedConsumables((current) =>
                                      current.map((entry) =>
                                        entry.itemId === row.itemId
                                          ? {
                                              ...entry,
                                              quantity: value
                                            }
                                          : entry
                                      )
                                    )
                                  }
                                />
                                <div className="flex items-center justify-end pb-1">
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setStagedConsumables((current) =>
                                        current.filter((entry) => entry.itemId !== row.itemId)
                                      )
                                    }
                                    className="rounded-md border border-slate-200 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50"
                                  >
                                    Remove
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>

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
                    type="submit"
                    disabled={formSaving}
                    className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {formSaving ? "Saving..." : "Save report"}
                  </button>
                </div>
              </form>
          </Card>
        )}
      </div>
    </AccessGate>
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
    holeMode: "CONTINUE",
    selectedHoleNumber: "",
    holeNumber: "",
    fromMeter: "0",
    toMeter: "0",
    metersDrilledToday: "0",
    workHours: "0",
    rigMoves: "0",
    standbyHours: "0",
    delayHours: "0",
    delayReasonCategory: "",
    delayReasonNote: "",
    holeContinuityOverrideReason: "",
    leadOperatorName: "",
    assistantCount: "0",
    comments: "",
    billableQuantities: {}
  };
}

function buildHoleProgressSummaries(reports: DrillReportRecord[]) {
  const byHole = new Map<string, HoleProgressSummary>();
  for (const report of reports) {
    if (report.approvalStatus === "REJECTED") {
      continue;
    }
    const holeNumber = report.holeNumber?.trim();
    if (!holeNumber) {
      continue;
    }
    const rangeEnd = Math.max(Number(report.fromMeter || 0), Number(report.toMeter || 0));
    const existing = byHole.get(holeNumber);
    if (!existing) {
      byHole.set(holeNumber, {
        holeNumber,
        currentDepth: rangeEnd,
        lastReportDate: report.date
      });
      continue;
    }
    const nextDepth = Math.max(existing.currentDepth, rangeEnd);
    const nextDate = new Date(report.date).getTime() > new Date(existing.lastReportDate).getTime()
      ? report.date
      : existing.lastReportDate;
    byHole.set(holeNumber, {
      holeNumber,
      currentDepth: nextDepth,
      lastReportDate: nextDate
    });
  }

  return Array.from(byHole.values()).sort((left, right) => {
    const numDiff = extractHoleSequence(left.holeNumber) - extractHoleSequence(right.holeNumber);
    if (numDiff !== 0) {
      return numDiff;
    }
    return left.holeNumber.localeCompare(right.holeNumber);
  });
}

function getNextHoleNumberSuggestion(holes: HoleProgressSummary[]) {
  const maxSequence = holes.reduce((max, hole) => Math.max(max, extractHoleSequence(hole.holeNumber)), 0);
  return `H-${maxSequence + 1}`;
}

function extractHoleSequence(holeNumber: string) {
  const match = holeNumber.match(/(\d+)(?!.*\d)/);
  if (!match) {
    return 0;
  }
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : 0;
}

function resolveStageContextRows(
  billingItems: ProjectBillingRateItemOption[],
  fromMeter: number,
  toMeter: number
) {
  const rangeStart = Math.min(fromMeter, toMeter);
  const rangeEnd = Math.max(fromMeter, toMeter);
  if (!Number.isFinite(rangeStart) || !Number.isFinite(rangeEnd) || rangeEnd <= rangeStart) {
    return [] as Array<{ label: string; rangeStart: number; rangeEnd: number }>;
  }

  return billingItems
    .filter((item) => item.isActive && item.unit.toLowerCase() === "meter")
    .filter(
      (item) =>
        Number.isFinite(item.depthBandStartM) &&
        Number.isFinite(item.depthBandEndM)
    )
    .map((item) => {
      const bandStart = Math.min(item.depthBandStartM as number, item.depthBandEndM as number);
      const bandEnd = Math.max(item.depthBandStartM as number, item.depthBandEndM as number);
      const overlapStart = Math.max(rangeStart, bandStart);
      const overlapEnd = Math.min(rangeEnd, bandEnd);
      return {
        label: item.drillingStageLabel || item.label,
        rangeStart: overlapStart,
        rangeEnd: overlapEnd
      };
    })
    .filter((item) => item.rangeEnd > item.rangeStart)
    .sort((left, right) => left.rangeStart - right.rangeStart);
}

function parseDelayReasonCategoryForForm(
  value: string | null
): DrillDelayReasonCategory | "" {
  if (!value) {
    return "";
  }
  return DRILL_DELAY_REASON_OPTIONS.some((option) => option.value === value)
    ? (value as DrillDelayReasonCategory)
    : "";
}

function formatDelayReasonLabel(value: DrillDelayReasonCategory | null) {
  if (!value) {
    return "-";
  }
  return DRILL_DELAY_REASON_OPTIONS.find((option) => option.value === value)?.label || value;
}

function formatCrewSummary(report: {
  leadOperatorName: string | null;
  assistantCount: number;
  operatorCrew: string | null;
}) {
  const leadOperatorName = report.leadOperatorName?.trim() || "";
  const assistantCount = Math.max(0, Math.round(Number(report.assistantCount || 0)));
  if (leadOperatorName && assistantCount > 0) {
    return `${leadOperatorName} + ${assistantCount} assistant${assistantCount === 1 ? "" : "s"}`;
  }
  if (leadOperatorName) {
    return leadOperatorName;
  }
  if (assistantCount > 0) {
    return `${assistantCount} assistant${assistantCount === 1 ? "" : "s"}`;
  }
  return report.operatorCrew || "-";
}

function buildProjectBillingSummary(project: ProjectOption | null) {
  if (!project) {
    return {
      label: "Billing setup",
      value: "-"
    };
  }

  const activeBillingItems = (project.billingRateItems || [])
    .filter((item) => item.isActive)
    .sort((left, right) => left.sortOrder - right.sortOrder);
  const stagedMeterItems = activeBillingItems.filter(
    (item) =>
      isMeterUnitValue(item.unit) &&
      Number.isFinite(item.depthBandStartM) &&
      Number.isFinite(item.depthBandEndM)
  );
  const singleMeterItems = activeBillingItems.filter(
    (item) => isMeterUnitValue(item.unit) && !Number.isFinite(item.depthBandStartM) && !Number.isFinite(item.depthBandEndM)
  );

  if (stagedMeterItems.length > 1) {
    const stagedSummary = stagedMeterItems
      .slice(0, 3)
      .map((item) => {
        const bandStart = Math.min(Number(item.depthBandStartM || 0), Number(item.depthBandEndM || 0));
        const bandEnd = Math.max(Number(item.depthBandStartM || 0), Number(item.depthBandEndM || 0));
        const label = item.drillingStageLabel?.trim() || item.label;
        return `${label} ${formatCurrency(item.unitRate)}/m (${formatNumber(bandStart)}m-${formatNumber(bandEnd)}m)`;
      });
    const remainingCount = stagedMeterItems.length - stagedSummary.length;
    return {
      label: "Staged billing",
      value: remainingCount > 0 ? `${stagedSummary.join(" • ")} • +${remainingCount} more` : stagedSummary.join(" • ")
    };
  }

  if (singleMeterItems.length === 1) {
    return {
      label: "Contract rate",
      value: `${formatCurrency(singleMeterItems[0].unitRate)} / meter`
    };
  }

  if (activeBillingItems.length > 0) {
    return {
      label: "Billing setup",
      value: `${activeBillingItems.length} line${activeBillingItems.length === 1 ? "" : "s"} configured`
    };
  }

  return {
    label: "Contract rate",
    value: `${formatCurrency(project.contractRatePerM)} / meter`
  };
}

function isMeterUnitValue(unit: string) {
  const normalized = unit.trim().toLowerCase();
  return normalized === "meter" || normalized === "m";
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
