"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";

import { AccessGate } from "@/components/layout/access-gate";
import { Card } from "@/components/ui/card";
import { formatCurrency, formatNumber } from "@/lib/utils";

interface ClientOption {
  id: string;
  name: string;
}

interface RigOption {
  id: string;
  rigCode: string;
}

interface EmployeeOption {
  id: string;
  fullName: string;
  role: string;
  isActive: boolean;
}

interface ProjectSetupProfile {
  expectedMeters: number | null;
  contractReferenceUrl: string;
  contractReferenceName: string;
  teamMemberIds: string[];
  teamMemberNames: string[];
}

interface ProjectRecord {
  id: string;
  name: string;
  location: string;
  startDate: string;
  endDate: string | null;
  status: string;
  contractType?: ProjectContractTypeOption;
  contractRatePerM: number;
  contractDayRate?: number;
  contractLumpSumValue?: number;
  estimatedMeters?: number;
  estimatedDays?: number;
  clientId: string;
  assignedRigId: string | null;
  backupRigId: string | null;
  description: string | null;
  photoUrl: string | null;
  budgetAmount?: number | null;
  setupProfile?: Partial<ProjectSetupProfile> | null;
  billingRateItems?: ProjectBillingRateItemRecord[];
}

interface ProjectBillingRateItemRecord {
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

interface ProjectBillingRateItemFormLine {
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

interface BillableItemTemplate {
  itemCode: string;
  label: string;
  unit: string;
  sortOrder: number;
  isMeterBased?: boolean;
  allowMultiple?: boolean;
}

type ProjectSetupStep = 1 | 2 | 3 | 4 | 5 | 6;
type ProjectStatusOption = "PLANNED" | "ACTIVE" | "COMPLETED";
type ProjectContractTypeOption = "PER_METER" | "DAY_RATE" | "LUMP_SUM";
type LocationLinkMode = "EXISTING" | "NEW";

interface ProjectFormState {
  id: string;
  name: string;
  clientId: string;
  locationMode: LocationLinkMode;
  locationExisting: string;
  locationNew: string;
  startDate: string;
  endDate: string;
  contractType: ProjectContractTypeOption;
  contractRatePerM: string;
  contractDayRate: string;
  contractLumpSumValue: string;
  budgetAmount: string;
  estimatedMeters: string;
  estimatedDays: string;
  contractReferenceUrl: string;
  contractReferenceName: string;
  primaryRigId: string;
  secondaryRigId: string;
  teamMemberIds: string[];
  description: string;
  photoUrl: string;
}

const STEP_LABELS: Array<{ step: ProjectSetupStep; title: string; subtitle: string }> = [
  { step: 1, title: "Client and Location", subtitle: "Define who and where this project belongs." },
  { step: 2, title: "Project Timing", subtitle: "Set project dates. Status updates automatically." },
  { step: 3, title: "Commercial Setup", subtitle: "Define how this project is billed." },
  { step: 4, title: "Rig Assignment", subtitle: "Assign primary rig and optional backup support." },
  { step: 5, title: "Team Assignment", subtitle: "Attach workers/employees to this project setup." },
  { step: 6, title: "Review and Create", subtitle: "Confirm setup details before saving." }
];

const BILLABLE_ITEM_TEMPLATES: BillableItemTemplate[] = [
  {
    itemCode: "METER_DRILLED",
    label: "Drilled meters",
    unit: "meter",
    sortOrder: 10,
    isMeterBased: true,
    allowMultiple: true
  },
  { itemCode: "WORK_TIME", label: "Work time", unit: "hour", sortOrder: 20 },
  { itemCode: "WATER_PUMP_HOURS", label: "Water pump hours", unit: "hour", sortOrder: 30 },
  { itemCode: "RIG_MOVE", label: "Rig move", unit: "move", sortOrder: 40 },
  { itemCode: "STANDBY", label: "Standby", unit: "hour", sortOrder: 50 },
  { itemCode: "SURVEY", label: "Survey", unit: "each", sortOrder: 60 },
  { itemCode: "REFLEX", label: "Reflex", unit: "run", sortOrder: 70 },
  { itemCode: "SURVEY_SHOT", label: "Survey shot", unit: "shot", sortOrder: 80 },
  { itemCode: "SURVEY_ORI", label: "Survey ori", unit: "ori", sortOrder: 90 },
  { itemCode: "ONE_OFF_CHARGE", label: "One-off project charge", unit: "each", sortOrder: 100 }
];

function createEmptyProjectForm(): ProjectFormState {
  return {
    id: "",
    name: "",
    clientId: "",
    locationMode: "EXISTING",
    locationExisting: "",
    locationNew: "",
    startDate: "",
    endDate: "",
    contractType: "PER_METER",
    contractRatePerM: "0",
    contractDayRate: "0",
    contractLumpSumValue: "0",
    budgetAmount: "",
    estimatedMeters: "",
    estimatedDays: "",
    contractReferenceUrl: "",
    contractReferenceName: "",
    primaryRigId: "",
    secondaryRigId: "",
    teamMemberIds: [],
    description: "",
    photoUrl: ""
  };
}

export default function ProjectSetupPage() {
  return (
    <Suspense fallback={<ProjectSetupFallback />}>
      <ProjectSetupPageContent />
    </Suspense>
  );
}

function ProjectSetupPageContent() {
  const searchParams = useSearchParams();
  const queryProjectId = searchParams.get("projectId")?.trim() || "";

  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [rigs, setRigs] = useState<RigOption[]>([]);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [form, setForm] = useState<ProjectFormState>(createEmptyProjectForm);
  const [currentStep, setCurrentStep] = useState<ProjectSetupStep>(1);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formNotice, setFormNotice] = useState<string | null>(null);
  const [hydratedProjectId, setHydratedProjectId] = useState("");
  const [billingRateItems, setBillingRateItems] = useState<ProjectBillingRateItemFormLine[]>(() =>
    defaultBillingRateItems("PER_METER", 0)
  );
  const [billingLineCode, setBillingLineCode] = useState(BILLABLE_ITEM_TEMPLATES[0].itemCode);
  const [billingLineRate, setBillingLineRate] = useState("");
  const [billingLineStageLabel, setBillingLineStageLabel] = useState("");
  const [billingLineDepthEnd, setBillingLineDepthEnd] = useState("");
  const [billingLineError, setBillingLineError] = useState<string | null>(null);
  const [editingBillingCode, setEditingBillingCode] = useState<string | null>(null);

  const locationOptions = useMemo(
    () =>
      Array.from(
        new Set(
          projects
            .map((project) => project.location.trim())
            .filter((location) => location.length > 0)
        )
      ).sort((a, b) => a.localeCompare(b)),
    [projects]
  );

  const loadSetupData = useCallback(async () => {
    setLoading(true);
    try {
      const [projectsRes, clientsRes, rigsRes, employeesRes] = await Promise.all([
        fetch("/api/projects", { cache: "no-store" }),
        fetch("/api/clients", { cache: "no-store" }),
        fetch("/api/rigs", { cache: "no-store" }),
        fetch("/api/employees", { cache: "no-store" }).catch(() => null)
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

      if (employeesRes && employeesRes.ok) {
        const employeesPayload = await employeesRes.json().catch(() => null);
        setEmployees(
          Array.isArray(employeesPayload?.data)
            ? employeesPayload.data.map(
                (entry: { id: string; fullName: string; role: string; isActive: boolean }) => ({
                  id: entry.id,
                  fullName: entry.fullName,
                  role: entry.role,
                  isActive: entry.isActive !== false
                })
              )
            : []
        );
      } else {
        setEmployees([]);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSetupData();
  }, [loadSetupData]);

  useEffect(() => {
    if (billingLineRate.trim().length > 0) {
      return;
    }
    const selectedTemplate = BILLABLE_ITEM_TEMPLATES.find((entry) => entry.itemCode === billingLineCode);
    if (!selectedTemplate?.isMeterBased) {
      return;
    }
    const meterRate = Number(form.contractRatePerM);
    if (!Number.isFinite(meterRate) || meterRate <= 0) {
      return;
    }
    setBillingLineRate(String(meterRate));
  }, [billingLineCode, billingLineRate, form.contractRatePerM]);

  const activeBillingItemCodeSet = useMemo(
    () =>
      new Set(
        billingRateItems.filter((entry) => entry.isActive).map((entry) => entry.itemCode)
      ),
    [billingRateItems]
  );

  const addModeBillingTemplates = useMemo(
    () =>
      BILLABLE_ITEM_TEMPLATES.filter(
        (entry) => Boolean(entry.allowMultiple) || !activeBillingItemCodeSet.has(entry.itemCode)
      ),
    [activeBillingItemCodeSet]
  );

  useEffect(() => {
    const selectedTemplate = BILLABLE_ITEM_TEMPLATES.find((entry) => entry.itemCode === billingLineCode);
    if (selectedTemplate?.isMeterBased) {
      return;
    }
    if (billingLineStageLabel || billingLineDepthEnd) {
      setBillingLineStageLabel("");
      setBillingLineDepthEnd("");
    }
  }, [billingLineCode, billingLineDepthEnd, billingLineStageLabel]);

  useEffect(() => {
    if (editingBillingCode) {
      return;
    }
    if (addModeBillingTemplates.length === 0) {
      if (billingLineCode) {
        setBillingLineCode("");
      }
      return;
    }
    const hasSelectedTemplate = addModeBillingTemplates.some((entry) => entry.itemCode === billingLineCode);
    if (!hasSelectedTemplate) {
      setBillingLineCode(addModeBillingTemplates[0].itemCode);
      setBillingLineRate("");
      setBillingLineStageLabel("");
      setBillingLineDepthEnd("");
      setBillingLineError(null);
    }
  }, [addModeBillingTemplates, billingLineCode, editingBillingCode]);

  const stepIssues = useMemo(
    () =>
      validateProjectSetupStep({
        form,
        step: currentStep
      }),
    [currentStep, form]
  );

  const reviewSummary = useMemo(() => {
    const resolvedClientName = clients.find((client) => client.id === form.clientId)?.name || "-";
    const resolvedLocation =
      form.locationMode === "NEW" ? form.locationNew.trim() : form.locationExisting.trim();
    const primaryRig = rigs.find((rig) => rig.id === form.primaryRigId)?.rigCode || "-";
    const secondaryRig = rigs.find((rig) => rig.id === form.secondaryRigId)?.rigCode || "-";
    const selectedTeam = employees.filter((employee) => form.teamMemberIds.includes(employee.id));

    return {
      clientName: resolvedClientName,
      location: resolvedLocation || "-",
      status: deriveStatusFromDates(form.startDate, form.endDate),
      primaryRig,
      secondaryRig,
      team: selectedTeam
    };
  }, [
    clients,
    employees,
    form.clientId,
    form.locationExisting,
    form.locationMode,
    form.locationNew,
    form.primaryRigId,
    form.secondaryRigId,
    form.startDate,
    form.endDate,
    form.teamMemberIds,
    rigs
  ]);

  function resetFormState() {
    setForm(createEmptyProjectForm());
    setBillingRateItems(defaultBillingRateItems("PER_METER", 0));
    setBillingLineCode(BILLABLE_ITEM_TEMPLATES[0].itemCode);
    setBillingLineRate("");
    setBillingLineStageLabel("");
    setBillingLineDepthEnd("");
    setBillingLineError(null);
    setEditingBillingCode(null);
    setCurrentStep(1);
    setFormError(null);
  }

  const applyEditProject = useCallback(
    (project: ProjectRecord) => {
      const setupProfile = normalizeSetupProfile(project.setupProfile);
      const locationExists = locationOptions.includes(project.location);

      setForm({
        id: project.id,
        name: project.name,
        clientId: project.clientId,
        locationMode: locationExists ? "EXISTING" : "NEW",
        locationExisting: locationExists ? project.location : "",
        locationNew: locationExists ? "" : project.location,
        startDate: project.startDate.slice(0, 10),
        endDate: project.endDate ? project.endDate.slice(0, 10) : "",
        contractType: normalizeContractType(project.contractType),
        contractRatePerM: String(project.contractRatePerM),
        contractDayRate: String(project.contractDayRate || 0),
        contractLumpSumValue: String(project.contractLumpSumValue || 0),
        budgetAmount:
          typeof project.budgetAmount === "number" && Number.isFinite(project.budgetAmount)
            ? String(project.budgetAmount)
            : "",
        estimatedMeters:
          typeof project.estimatedMeters === "number" && project.estimatedMeters > 0
            ? String(project.estimatedMeters)
            : setupProfile.expectedMeters !== null
              ? String(setupProfile.expectedMeters)
              : "",
        estimatedDays:
          typeof project.estimatedDays === "number" && project.estimatedDays > 0
            ? String(project.estimatedDays)
            : "",
        contractReferenceUrl: setupProfile.contractReferenceUrl,
        contractReferenceName: setupProfile.contractReferenceName,
        primaryRigId: project.assignedRigId || "",
        secondaryRigId: project.backupRigId || "",
        teamMemberIds: setupProfile.teamMemberIds,
        description: project.description || "",
        photoUrl: project.photoUrl || ""
      });
      setBillingRateItems(
        normalizeBillingRateItems(
          project.billingRateItems || [],
          normalizeContractType(project.contractType),
          project.contractRatePerM
        )
      );
      setBillingLineCode(BILLABLE_ITEM_TEMPLATES[0].itemCode);
      setBillingLineRate("");
      setBillingLineStageLabel("");
      setBillingLineDepthEnd("");
      setBillingLineError(null);
      setEditingBillingCode(null);

      setCurrentStep(1);
      setFormError(null);
      setFormNotice(`Editing project: ${project.name}`);
    },
    [locationOptions]
  );

  useEffect(() => {
    if (!queryProjectId) {
      if (hydratedProjectId) {
        setHydratedProjectId("");
      }
      return;
    }

    if (queryProjectId === hydratedProjectId) {
      return;
    }

    const match = projects.find((project) => project.id === queryProjectId);
    if (!match) {
      return;
    }

    applyEditProject(match);
    setHydratedProjectId(queryProjectId);
  }, [applyEditProject, hydratedProjectId, projects, queryProjectId]);

  function moveStep(direction: "next" | "back") {
    setFormError(null);
    if (direction === "back") {
      setCurrentStep((current) => (current <= 1 ? 1 : ((current - 1) as ProjectSetupStep)));
      return;
    }
    if (stepIssues.length > 0) {
      setFormError(stepIssues[0]);
      return;
    }
    setCurrentStep((current) => (current >= 6 ? 6 : ((current + 1) as ProjectSetupStep)));
  }

  function resetBillingLineForm(nextCode?: string) {
    const fallbackCode = addModeBillingTemplates[0]?.itemCode || "";
    setBillingLineCode(nextCode ?? fallbackCode);
    setBillingLineRate("");
    setBillingLineStageLabel("");
    setBillingLineDepthEnd("");
    setBillingLineError(null);
    setEditingBillingCode(null);
  }

  function startEditBillingLine(line: ProjectBillingRateItemFormLine) {
    const template =
      findTemplateByItemCode(line.itemCode) ||
      BILLABLE_ITEM_TEMPLATES.find((entry) => entry.itemCode === line.itemCode) ||
      BILLABLE_ITEM_TEMPLATES[0];
    setEditingBillingCode(line.itemCode);
    setBillingLineCode(template?.itemCode || line.itemCode);
    setBillingLineRate(String(line.unitRate));
    setBillingLineStageLabel(line.drillingStageLabel || "");
    setBillingLineDepthEnd(
      typeof line.depthBandEndM === "number" && Number.isFinite(line.depthBandEndM)
        ? String(line.depthBandEndM)
        : ""
    );
    setBillingLineError(null);
  }

  function archiveBillingLine(itemCode: string) {
    setBillingRateItems((current) =>
      current.map((entry) =>
        entry.itemCode === itemCode
          ? {
              ...entry,
              isActive: false
            }
          : entry
      )
    );
    if (editingBillingCode === itemCode) {
      resetBillingLineForm();
    }
  }

  function saveBillingLine() {
    setBillingLineError(null);
    if (!editingBillingCode && addModeBillingTemplates.length === 0) {
      setBillingLineError("All billable items are already added. Use Edit to update a line.");
      return;
    }
    if (
      !editingBillingCode &&
      !addModeBillingTemplates.some((entry) => entry.itemCode === billingLineCode)
    ) {
      setBillingLineError("Select a billable item.");
      return;
    }
    const template = BILLABLE_ITEM_TEMPLATES.find((entry) => entry.itemCode === billingLineCode);
    if (!template) {
      setBillingLineError("Select a billable item.");
      return;
    }

    const rate = Number(billingLineRate);
    if (!Number.isFinite(rate) || rate <= 0) {
      setBillingLineError("Rate must be greater than zero.");
      return;
    }
    const isMeterBased = Boolean(template.isMeterBased);
    const stageLabel = isMeterBased ? billingLineStageLabel.trim() : "";
    const hasDepthEnd = billingLineDepthEnd.trim().length > 0;
    if (isMeterBased && !hasDepthEnd) {
      setBillingLineError("Enter the next end depth.");
      return;
    }
    const depthStart =
      isMeterBased && Number.isFinite(derivedBillingLineDepthStartM)
        ? (derivedBillingLineDepthStartM as number)
        : null;
    const depthEnd = hasDepthEnd ? Number(billingLineDepthEnd) : null;
    if (isMeterBased && hasDepthEnd && (!Number.isFinite(depthEnd) || (depthEnd as number) < 0)) {
      setBillingLineError("Depth values must be zero or greater.");
      return;
    }
    if (isMeterBased && depthStart !== null && depthEnd !== null && depthEnd <= depthStart) {
      setBillingLineError("End depth must be higher than the current start depth.");
      return;
    }

    const nextLine: ProjectBillingRateItemFormLine = {
      itemCode: buildBillingItemCode({
        template,
        stageLabel,
        depthBandStartM: depthStart,
        depthBandEndM: depthEnd
      }),
      label: template.label,
      unit: template.unit,
      unitRate: rate,
      drillingStageLabel: isMeterBased && stageLabel ? stageLabel : null,
      depthBandStartM: isMeterBased ? depthStart : null,
      depthBandEndM: isMeterBased ? depthEnd : null,
      sortOrder: template.sortOrder,
      isActive: true
    };

    const existingIndex = editingBillingCode
      ? billingRateItems.findIndex((entry) => entry.itemCode === editingBillingCode)
      : billingRateItems.findIndex((entry) => entry.itemCode === nextLine.itemCode);
    const duplicateIndex = billingRateItems.findIndex((entry) => entry.itemCode === nextLine.itemCode);
    if (duplicateIndex >= 0 && duplicateIndex !== existingIndex) {
      setBillingLineError("That billable item line already exists.");
      return;
    }

    setBillingRateItems((current) => {
      if (existingIndex >= 0) {
        const next = [...current];
        next[existingIndex] = nextLine;
        return sortBillingRateItems(next);
      }

      return sortBillingRateItems([...current, nextLine]);
    });

    resetBillingLineForm();
  }

  async function saveProject() {
    setFormError(null);
    setFormNotice(null);

    if (currentStep !== 6) {
      setFormError("Use Next Step and confirm on the final step before saving.");
      return;
    }

    const finalStepIssues = validateProjectSetupStep({ form, step: 6 });
    if (finalStepIssues.length > 0) {
      setCurrentStep(6);
      setFormError(finalStepIssues[0]);
      return;
    }

    setSaving(true);
    try {
      const location = form.locationMode === "NEW" ? form.locationNew.trim() : form.locationExisting.trim();
      const statusToSave = deriveStatusFromDates(form.startDate, form.endDate);
      const selectedTeam = employees.filter((employee) => form.teamMemberIds.includes(employee.id));

      const payload = {
        name: form.name.trim(),
        clientId: form.clientId,
        location,
        description: form.description.trim() || null,
        photoUrl: form.photoUrl.trim() || null,
        startDate: form.startDate,
        endDate: form.endDate || null,
        status: statusToSave,
        contractType: form.contractType,
        contractRatePerM: Number(form.contractRatePerM),
        contractDayRate: Number(form.contractDayRate),
        contractLumpSumValue: Number(form.contractLumpSumValue),
        estimatedMeters: parseOptionalNonNegative(form.estimatedMeters),
        estimatedDays: parseOptionalNonNegative(form.estimatedDays),
        assignedRigId: form.primaryRigId || null,
        backupRigId: form.secondaryRigId || null,
        budgetAmount: parseOptionalPositive(form.budgetAmount),
        setupProfile: {
          expectedMeters: parseOptionalPositive(form.estimatedMeters),
          contractReferenceUrl: form.contractReferenceUrl.trim(),
          contractReferenceName: form.contractReferenceName.trim(),
          teamMemberIds: form.teamMemberIds,
          teamMemberNames: selectedTeam.map((employee) => employee.fullName)
        },
        billingRateItems: billingRateItems.map((line) => ({
          itemCode: line.itemCode,
          label: line.label,
          unit: line.unit,
          unitRate: line.unitRate,
          drillingStageLabel: line.drillingStageLabel || null,
          depthBandStartM: line.depthBandStartM ?? null,
          depthBandEndM: line.depthBandEndM ?? null,
          sortOrder: line.sortOrder,
          isActive: line.isActive
        }))
      };

      const isUpdate = Boolean(form.id);
      const response = await fetch(isUpdate ? `/api/projects/${form.id}` : "/api/projects", {
        method: isUpdate ? "PUT" : "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const failedPayload = await response.json().catch(() => null);
        setFormError(
          failedPayload?.message || "Failed to save project setup. Review the required fields and retry."
        );
        return;
      }

      resetFormState();
      await loadSetupData();
      setFormNotice(isUpdate ? "Project updated successfully." : "Project created successfully.");
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Failed to save project.");
    } finally {
      setSaving(false);
    }
  }

  const derivedProjectStatus = deriveStatusFromDates(form.startDate, form.endDate);
  const activeStepMeta = STEP_LABELS.find((entry) => entry.step === currentStep) || STEP_LABELS[0];
  const secondaryRigOptions = rigs.filter((rig) => rig.id !== form.primaryRigId);
  const activeBillingRateItems = sortBillingRateItems(billingRateItems.filter((entry) => entry.isActive));
  const archivedBillingItemCount = billingRateItems.filter((entry) => !entry.isActive).length;
  const billingTemplateOptions = editingBillingCode ? BILLABLE_ITEM_TEMPLATES : addModeBillingTemplates;
  const addModeBlocked = !editingBillingCode && addModeBillingTemplates.length === 0;
  const selectedBillingTemplate =
    billingTemplateOptions.find((entry) => entry.itemCode === billingLineCode) ||
    billingTemplateOptions[0] ||
    null;
  const selectedBillingTemplateIsMeter = Boolean(selectedBillingTemplate?.isMeterBased);
  const activeStagedMeterLines = activeBillingRateItems.filter(
    (line) =>
      line.unit.trim().toLowerCase() === "meter" &&
      Number.isFinite(line.depthBandStartM) &&
      Number.isFinite(line.depthBandEndM)
  );
  const editingLine = editingBillingCode
    ? activeBillingRateItems.find((line) => line.itemCode === editingBillingCode) || null
    : null;
  const derivedBillingLineDepthStartM = selectedBillingTemplateIsMeter
    ? deriveGuidedMeterStartDepth({
        stagedLines: activeStagedMeterLines,
        editingCode: editingBillingCode,
        editingLine
      })
    : null;
  const derivedBillingLineDepthStartText =
    selectedBillingTemplateIsMeter && Number.isFinite(derivedBillingLineDepthStartM)
      ? String(derivedBillingLineDepthStartM)
      : "";
  const billingLineItemCodePreview = selectedBillingTemplate
    ? buildBillingItemCode({
        template: selectedBillingTemplate,
        stageLabel: billingLineStageLabel.trim(),
        depthBandStartM: selectedBillingTemplateIsMeter ? derivedBillingLineDepthStartM : null,
        depthBandEndM: billingLineDepthEnd.trim().length > 0 ? Number(billingLineDepthEnd) : null
      })
    : "-";

  return (
    <AccessGate permission="projects:manage">
      <div className="gf-page-stack">
        <section className="flex items-center justify-between">
          <h1 className="text-xl font-semibold text-ink-900">{form.id ? "Edit Project Setup" : "Create Project"}</h1>
          <Link
            href="/projects"
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-ink-700 hover:bg-slate-50"
          >
            Back to Projects
          </Link>
        </section>

        <Card title={form.id ? "Edit Project Setup" : "Create Project Setup"}>
          {loading ? (
            <p className="text-sm text-ink-600">Loading setup options...</p>
          ) : (
            <div className="space-y-4">
              <div className="grid gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 md:grid-cols-3 xl:grid-cols-6">
                {STEP_LABELS.map((entry) => (
                  <button
                    key={`project-step-${entry.step}`}
                    type="button"
                    onClick={() => {
                      if (entry.step <= currentStep) {
                        setCurrentStep(entry.step);
                      }
                    }}
                    disabled={entry.step > currentStep}
                    className={`rounded-lg border px-2 py-2 text-left transition ${
                      currentStep === entry.step
                        ? "border-brand-300 bg-brand-50 text-brand-900"
                        : entry.step > currentStep
                          ? "border-slate-200 bg-slate-100 text-slate-400"
                          : "border-slate-200 bg-white text-slate-700 hover:bg-slate-100"
                    }`}
                  >
                    <p className="text-xs font-semibold uppercase tracking-wide">Step {entry.step}</p>
                    <p className="mt-1 text-sm font-semibold">{entry.title}</p>
                  </button>
                ))}
              </div>

              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Step {activeStepMeta.step} - {activeStepMeta.title}
                </p>
                <p className="mt-1 text-sm text-slate-700">{activeStepMeta.subtitle}</p>
              </div>

              {formError ? (
                <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
                  {formError}
                </p>
              ) : null}
              {formNotice ? (
                <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                  {formNotice}
                </p>
              ) : null}

              <form
                onSubmit={(event) => {
                  event.preventDefault();
                }}
                className="space-y-4"
              >
                {currentStep === 1 ? (
                  <div className="grid gap-3 md:grid-cols-2">
                    <Input
                      label="Project Name"
                      value={form.name}
                      onChange={(value) => setForm((current) => ({ ...current, name: value }))}
                      required
                    />

                    <Select
                      label="Client"
                      value={form.clientId}
                      onChange={(value) => setForm((current) => ({ ...current, clientId: value }))}
                      options={clients.map((client) => ({ value: client.id, label: client.name }))}
                      required
                    />

                    <label className="text-sm text-ink-700">
                      <span className="mb-1 block">Location source</span>
                      <select
                        value={form.locationMode}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            locationMode: event.target.value as LocationLinkMode
                          }))
                        }
                        className="w-full rounded-lg border border-slate-200 px-3 py-2"
                      >
                        <option value="EXISTING">Select existing location</option>
                        <option value="NEW">Create new location</option>
                      </select>
                    </label>

                    {form.locationMode === "EXISTING" ? (
                      <Select
                        label="Location"
                        value={form.locationExisting}
                        onChange={(value) => setForm((current) => ({ ...current, locationExisting: value }))}
                        options={locationOptions.map((location) => ({ value: location, label: location }))}
                        required
                      />
                    ) : (
                      <Input
                        label="New Location"
                        value={form.locationNew}
                        onChange={(value) => setForm((current) => ({ ...current, locationNew: value }))}
                        required
                      />
                    )}
                  </div>
                ) : null}

                {currentStep === 2 ? (
                  <div className="grid gap-3 md:grid-cols-2">
                    <Input
                      label="Start Date"
                      type="date"
                      value={form.startDate}
                      onChange={(value) => setForm((current) => ({ ...current, startDate: value }))}
                      required
                    />
                    <Input
                      label="End Date"
                      type="date"
                      value={form.endDate}
                      onChange={(value) => setForm((current) => ({ ...current, endDate: value }))}
                    />
                    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 md:col-span-2">
                      Project status is automatic from dates:{" "}
                      <span className="font-semibold text-slate-900">{derivedProjectStatus}</span>
                    </div>
                  </div>
                ) : null}

                {currentStep === 3 ? (
                  <div className="space-y-4">
                    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
                      <p className="text-sm font-semibold text-ink-900">Billing setup</p>
                      <p className="mt-1 text-xs text-slate-700">Add what you charge the client for on this project.</p>

                      <div className="mt-3 grid gap-2 md:grid-cols-4">
                        <label className="text-sm text-ink-700">
                          <span className="mb-1 block">Billable item</span>
                          <select
                            value={billingLineCode}
                            onChange={(event) => setBillingLineCode(event.target.value)}
                            disabled={addModeBlocked}
                            className="w-full rounded-lg border border-slate-200 px-3 py-2"
                          >
                            {billingTemplateOptions.length === 0 ? (
                              <option value="">All billable items already added</option>
                            ) : (
                              billingTemplateOptions.map((template) => (
                                <option key={template.itemCode} value={template.itemCode}>
                                  {template.label}
                                </option>
                              ))
                            )}
                          </select>
                        </label>
                        <label className="text-sm text-ink-700">
                          <span className="mb-1 block">Unit</span>
                          <input
                            value={selectedBillingTemplate?.unit || ""}
                            readOnly
                            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-700"
                          />
                        </label>
                        <label className="text-sm text-ink-700">
                          <span className="mb-1 block">Rate</span>
                          <input
                            type="number"
                            min="0.01"
                            step="0.01"
                            value={billingLineRate}
                            onChange={(event) => setBillingLineRate(event.target.value)}
                            className="w-full rounded-lg border border-slate-200 px-3 py-2"
                          />
                        </label>
                        <div className="text-sm text-ink-700">
                          <span className="mb-1 block">Action</span>
                          <button
                            type="button"
                            onClick={saveBillingLine}
                            disabled={addModeBlocked}
                            className="w-full rounded-lg border border-brand-300 bg-brand-50 px-3 py-2 font-semibold text-brand-800 hover:bg-brand-100 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {editingBillingCode ? "Save line" : "Add line"}
                          </button>
                        </div>
                      </div>

                      {selectedBillingTemplateIsMeter ? (
                        <div className="mt-2 grid gap-2 md:grid-cols-3">
                          <label className="text-sm text-ink-700">
                            <span className="mb-1 block">Stage label (optional)</span>
                            <input
                              value={billingLineStageLabel}
                              onChange={(event) => setBillingLineStageLabel(event.target.value)}
                              placeholder="PQ, HQ, NQ"
                              className="w-full rounded-lg border border-slate-200 px-3 py-2"
                            />
                          </label>
                          <label className="text-sm text-ink-700">
                            <span className="mb-1 block">From depth (m)</span>
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              value={derivedBillingLineDepthStartText}
                              readOnly
                              className="w-full rounded-lg border border-slate-200 bg-slate-100 px-3 py-2 text-slate-700"
                            />
                          </label>
                          <label className="text-sm text-ink-700">
                            <span className="mb-1 block">To depth (m)</span>
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              value={billingLineDepthEnd}
                              onChange={(event) => setBillingLineDepthEnd(event.target.value)}
                              className="w-full rounded-lg border border-slate-200 px-3 py-2"
                            />
                          </label>
                        </div>
                      ) : null}

                      <p className="mt-2 text-[11px] text-slate-600">
                        Item code: <span className="font-semibold">{billingLineItemCodePreview}</span>
                      </p>
                      {addModeBlocked ? (
                        <p className="mt-2 rounded-lg border border-slate-200 bg-slate-100 px-2 py-1 text-xs text-slate-700">
                          All billable items are already added. Use Edit to update a line.
                        </p>
                      ) : null}

                      {billingLineError ? (
                        <p className="mt-2 rounded-lg border border-rose-200 bg-rose-50 px-2 py-1 text-xs text-rose-800">
                          {billingLineError}
                        </p>
                      ) : null}

                      <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200 bg-white">
                        <table className="min-w-full text-sm">
                          <thead className="bg-slate-100 text-left text-xs uppercase tracking-wide text-slate-600">
                            <tr>
                              <th className="px-3 py-2">Billable item</th>
                              <th className="px-3 py-2">Unit</th>
                              <th className="px-3 py-2">Rate</th>
                              <th className="px-3 py-2 text-right">Action</th>
                            </tr>
                          </thead>
                          <tbody>
                            {activeBillingRateItems.length === 0 ? (
                              <tr>
                                <td colSpan={4} className="px-3 py-3 text-sm text-slate-600">
                                  No lines yet. Add line to define how this project is billed.
                                </td>
                              </tr>
                            ) : (
                              activeBillingRateItems.map((line) => (
                                <tr key={line.itemCode} className="border-t border-slate-200">
                                  <td className="px-3 py-2">
                                    <p className="font-semibold text-ink-900">{line.label}</p>
                                    {line.drillingStageLabel ? (
                                      <p className="text-[11px] text-slate-600">
                                        Stage: {line.drillingStageLabel}
                                      </p>
                                    ) : null}
                                    {typeof line.depthBandStartM === "number" && typeof line.depthBandEndM === "number" ? (
                                      <p className="text-[11px] text-slate-600">
                                        Depth: {formatNumber(line.depthBandStartM)}m - {formatNumber(line.depthBandEndM)}m
                                      </p>
                                    ) : null}
                                    <p className="text-[11px] text-slate-600">{line.itemCode}</p>
                                  </td>
                                  <td className="px-3 py-2 text-slate-700">{line.unit}</td>
                                  <td className="px-3 py-2 text-slate-700">{formatCurrency(line.unitRate)}</td>
                                  <td className="px-3 py-2 text-right">
                                    <div className="inline-flex gap-2">
                                      <button
                                        type="button"
                                        onClick={() => startEditBillingLine(line)}
                                        className="rounded border border-slate-200 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50"
                                      >
                                        Edit
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => archiveBillingLine(line.itemCode)}
                                        className="rounded border border-slate-200 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50"
                                      >
                                        Archive
                                      </button>
                                    </div>
                                  </td>
                                </tr>
                              ))
                            )}
                          </tbody>
                        </table>
                      </div>

                      {archivedBillingItemCount > 0 ? (
                        <p className="mt-2 text-[11px] text-slate-600">
                          Archived lines: {archivedBillingItemCount}
                        </p>
                      ) : null}
                      {activeBillingRateItems.length === 0 ? (
                        <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-900">
                          No billable lines yet. You can finish setup now and add lines later.
                        </p>
                      ) : null}
                    </div>

                    <div className="grid gap-3 md:grid-cols-2">
                      <Input
                        label="Budget (optional)"
                        type="number"
                        value={form.budgetAmount}
                        onChange={(value) => setForm((current) => ({ ...current, budgetAmount: value }))}
                      />
                      <Input
                        label="Expected Meters (optional)"
                        type="number"
                        value={form.estimatedMeters}
                        onChange={(value) => setForm((current) => ({ ...current, estimatedMeters: value }))}
                      />
                      <Input
                        label="Expected Days (optional)"
                        type="number"
                        value={form.estimatedDays}
                        onChange={(value) => setForm((current) => ({ ...current, estimatedDays: value }))}
                      />
                      <Input
                        label="Contract / Reference URL (optional)"
                        value={form.contractReferenceUrl}
                        onChange={(value) => setForm((current) => ({ ...current, contractReferenceUrl: value }))}
                      />
                      <label className="text-sm text-ink-700">
                        <span className="mb-1 block">Contract/Reference Document (optional)</span>
                        <input
                          type="file"
                          onChange={(event) => {
                            const fileName =
                              event.target.files && event.target.files.length > 0
                                ? event.target.files[0].name
                                : "";
                            setForm((current) => ({
                              ...current,
                              contractReferenceName: fileName || current.contractReferenceName
                            }));
                          }}
                          className="w-full rounded-lg border border-slate-200 px-3 py-2"
                        />
                      </label>
                      <Input
                        label="Stored Document Name (optional)"
                        value={form.contractReferenceName}
                        onChange={(value) => setForm((current) => ({ ...current, contractReferenceName: value }))}
                      />
                    </div>
                  </div>
                ) : null}

                {currentStep === 4 ? (
                  <div className="grid gap-3 md:grid-cols-2">
                    <Select
                      label="Primary Rig"
                      value={form.primaryRigId}
                      onChange={(value) =>
                        setForm((current) => ({
                          ...current,
                          primaryRigId: value,
                          secondaryRigId: value === current.secondaryRigId ? "" : current.secondaryRigId
                        }))
                      }
                      options={rigs.map((rig) => ({ value: rig.id, label: rig.rigCode }))}
                    />
                    <Select
                      label="Secondary Rig (optional)"
                      value={form.secondaryRigId}
                      onChange={(value) => setForm((current) => ({ ...current, secondaryRigId: value }))}
                      options={secondaryRigOptions.map((rig) => ({ value: rig.id, label: rig.rigCode }))}
                    />
                    <div className="md:col-span-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                      <p>
                        Primary rig:{" "}
                        <span className="font-semibold">
                          {rigs.find((rig) => rig.id === form.primaryRigId)?.rigCode || "Not assigned"}
                        </span>
                      </p>
                      <p className="mt-1">
                        Secondary rig:{" "}
                        <span className="font-semibold">
                          {rigs.find((rig) => rig.id === form.secondaryRigId)?.rigCode || "Not assigned"}
                        </span>
                      </p>
                    </div>
                  </div>
                ) : null}

                {currentStep === 5 ? (
                  <div className="space-y-3">
                    {employees.length === 0 ? (
                      <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                        Employee list is unavailable for your current permission scope. You can still create/update the project.
                      </p>
                    ) : (
                      <div className="grid gap-2 md:grid-cols-2">
                        {employees
                          .filter((employee) => employee.isActive)
                          .map((employee) => {
                            const selected = form.teamMemberIds.includes(employee.id);
                            return (
                              <label
                                key={`project-team-${employee.id}`}
                                className={`flex items-center justify-between rounded-lg border px-3 py-2 text-sm ${
                                  selected
                                    ? "border-brand-300 bg-brand-50 text-brand-900"
                                    : "border-slate-200 bg-white text-slate-800"
                                }`}
                              >
                                <span>
                                  {employee.fullName}{" "}
                                  <span className="text-xs uppercase tracking-wide text-slate-500">
                                    ({employee.role})
                                  </span>
                                </span>
                                <input
                                  type="checkbox"
                                  checked={selected}
                                  onChange={(event) =>
                                    setForm((current) => ({
                                      ...current,
                                      teamMemberIds: event.target.checked
                                        ? [...current.teamMemberIds, employee.id]
                                        : current.teamMemberIds.filter((id) => id !== employee.id)
                                    }))
                                  }
                                />
                              </label>
                            );
                          })}
                      </div>
                    )}
                  </div>
                ) : null}

                {currentStep === 6 ? (
                  <div className="space-y-3">
                    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                      <p className="font-semibold text-slate-900">Setup Summary</p>
                      <div className="mt-2 grid gap-1 md:grid-cols-2">
                        <p>
                          <span className="font-semibold">Project:</span> {form.name || "-"}
                        </p>
                        <p>
                          <span className="font-semibold">Client:</span> {reviewSummary.clientName}
                        </p>
                        <p>
                          <span className="font-semibold">Location:</span> {reviewSummary.location}
                        </p>
                        <p>
                          <span className="font-semibold">Status:</span> {reviewSummary.status}
                        </p>
                        <p>
                          <span className="font-semibold">Start Date:</span> {form.startDate || "-"}
                        </p>
                        <p>
                          <span className="font-semibold">End Date:</span> {form.endDate || "-"}
                        </p>
                        <p>
                          <span className="font-semibold">Budget:</span>{" "}
                          {form.budgetAmount ? formatCurrency(Number(form.budgetAmount)) : "-"}
                        </p>
                        <p>
                          <span className="font-semibold">Expected meters:</span>{" "}
                          {form.estimatedMeters ? formatNumber(Number(form.estimatedMeters)) : "-"}
                        </p>
                        <p>
                          <span className="font-semibold">Expected days:</span>{" "}
                          {form.estimatedDays ? formatNumber(Number(form.estimatedDays)) : "-"}
                        </p>
                        <p>
                          <span className="font-semibold">Contract reference:</span>{" "}
                          {form.contractReferenceUrl || form.contractReferenceName || "-"}
                        </p>
                        <p>
                          <span className="font-semibold">Billable lines:</span>{" "}
                          {formatNumber(activeBillingRateItems.length)}
                        </p>
                        <p>
                          <span className="font-semibold">Primary Rig:</span> {reviewSummary.primaryRig}
                        </p>
                        <p>
                          <span className="font-semibold">Secondary Rig:</span> {reviewSummary.secondaryRig}
                        </p>
                      </div>
                    </div>
                    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">
                      <p className="font-semibold text-slate-900">Assigned Team</p>
                      {reviewSummary.team.length === 0 ? (
                        <p className="mt-1">No team members selected.</p>
                      ) : (
                        <ul className="mt-1 list-disc pl-5">
                          {reviewSummary.team.map((member) => (
                            <li key={`review-team-${member.id}`}>
                              {member.fullName} ({member.role})
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                    <div className="grid gap-3 md:grid-cols-2">
                      <Input
                        label="Photo URL (optional)"
                        value={form.photoUrl}
                        onChange={(value) => setForm((current) => ({ ...current, photoUrl: value }))}
                      />
                      <label className="text-sm text-ink-700 md:col-span-2">
                        <span className="mb-1 block">Project Notes (optional)</span>
                        <textarea
                          value={form.description}
                          onChange={(event) =>
                            setForm((current) => ({ ...current, description: event.target.value }))
                          }
                          className="w-full rounded-lg border border-slate-200 px-3 py-2"
                        />
                      </label>
                    </div>
                  </div>
                ) : null}

                <div className="flex flex-wrap items-center gap-2 border-t border-slate-200 pt-3">
                  <button
                    type="button"
                    onClick={() => moveStep("back")}
                    disabled={currentStep === 1 || saving}
                    className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-ink-700 hover:bg-slate-50 disabled:opacity-60"
                  >
                    Back
                  </button>
                  {currentStep < 6 ? (
                    <button
                      type="button"
                      onClick={() => moveStep("next")}
                      disabled={saving || stepIssues.length > 0}
                      className="rounded-lg border border-brand-300 bg-brand-50 px-4 py-2 text-sm font-semibold text-brand-800 hover:bg-brand-100 disabled:opacity-60"
                    >
                      Next Step
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void saveProject()}
                      disabled={saving}
                      className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
                    >
                      {saving ? "Saving..." : form.id ? "Update Project" : "Create Project"}
                    </button>
                  )}
                  {form.id ? (
                    <button
                      type="button"
                      onClick={resetFormState}
                      className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-ink-700 hover:bg-slate-50"
                    >
                      Cancel Edit
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={resetFormState}
                      className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-ink-700 hover:bg-slate-50"
                    >
                      Reset
                    </button>
                  )}
                  {currentStep < 6 && stepIssues.length > 0 ? (
                    <p className="text-xs text-amber-800">{stepIssues[0]}</p>
                  ) : null}
                </div>
              </form>
            </div>
          )}
        </Card>
      </div>
    </AccessGate>
  );
}

function ProjectSetupFallback() {
  return (
    <AccessGate permission="projects:manage">
      <div className="gf-page-stack">
        <Card title="Create Project">
          <p className="text-sm text-ink-600">Loading project setup...</p>
        </Card>
      </div>
    </AccessGate>
  );
}

function validateProjectSetupStep({
  form,
  step
}: {
  form: ProjectFormState;
  step: ProjectSetupStep;
}) {
  const issues: string[] = [];
  const locationValue = form.locationMode === "NEW" ? form.locationNew.trim() : form.locationExisting.trim();

  if (step >= 1) {
    if (!form.name.trim()) {
      issues.push("Project name is required.");
    }
    if (!form.clientId.trim()) {
      issues.push("Select an existing client.");
    }
    if (!locationValue) {
      issues.push(form.locationMode === "NEW" ? "Enter a new location." : "Select an existing location.");
    }
  }

  if (step >= 2) {
    if (!form.startDate) {
      issues.push("Start date is required.");
    }
    if (form.endDate && form.startDate && form.endDate < form.startDate) {
      issues.push("End date cannot be earlier than start date.");
    }
  }

  if (step >= 3) {
    if (form.budgetAmount && (!Number.isFinite(Number(form.budgetAmount)) || Number(form.budgetAmount) <= 0)) {
      issues.push("Budget must be a positive number.");
    }
    if (
      form.estimatedMeters &&
      (!Number.isFinite(Number(form.estimatedMeters)) || Number(form.estimatedMeters) <= 0)
    ) {
      issues.push("Expected meters must be a positive number.");
    }
    if (
      form.estimatedDays &&
      (!Number.isFinite(Number(form.estimatedDays)) || Number(form.estimatedDays) <= 0)
    ) {
      issues.push("Expected days must be a positive number.");
    }
  }

  if (step >= 4) {
    if (form.primaryRigId && form.primaryRigId === form.secondaryRigId) {
      issues.push("Primary and secondary rig cannot be the same.");
    }
  }

  return issues;
}

function parseOptionalPositive(value: string) {
  const parsed = Number(value || "");
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}

function parseOptionalNonNegative(value: string) {
  const parsed = Number(value || "");
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }
  return parsed;
}

function normalizeContractType(value: string | undefined): ProjectContractTypeOption {
  if (value === "DAY_RATE" || value === "LUMP_SUM" || value === "PER_METER") {
    return value;
  }
  return "PER_METER";
}

function deriveStatusFromDates(startDate: string, endDate: string): ProjectStatusOption {
  if (!startDate) {
    return "PLANNED";
  }
  const today = new Date();
  const start = new Date(startDate);
  if (Number.isNaN(start.getTime())) {
    return "PLANNED";
  }
  if (endDate) {
    const end = new Date(endDate);
    if (!Number.isNaN(end.getTime()) && end < today) {
      return "COMPLETED";
    }
  }
  if (start > today) {
    return "PLANNED";
  }
  return "ACTIVE";
}

function normalizeSetupProfile(value: Partial<ProjectSetupProfile> | null | undefined): ProjectSetupProfile {
  return {
    expectedMeters:
      typeof value?.expectedMeters === "number" && Number.isFinite(value.expectedMeters)
        ? value.expectedMeters
        : null,
    contractReferenceUrl: typeof value?.contractReferenceUrl === "string" ? value.contractReferenceUrl : "",
    contractReferenceName:
      typeof value?.contractReferenceName === "string" ? value.contractReferenceName : "",
    teamMemberIds: Array.isArray(value?.teamMemberIds)
      ? value.teamMemberIds.filter((entry): entry is string => typeof entry === "string")
      : [],
    teamMemberNames: Array.isArray(value?.teamMemberNames)
      ? value.teamMemberNames.filter((entry): entry is string => typeof entry === "string")
      : []
  };
}

function defaultBillingRateItems(
  contractType: ProjectContractTypeOption,
  contractRatePerM: number
): ProjectBillingRateItemFormLine[] {
  const meterTemplate = BILLABLE_ITEM_TEMPLATES.find((entry) => entry.itemCode === "METER_DRILLED");
  if (!meterTemplate) {
    return [];
  }
  const meterRate = contractType === "PER_METER" && contractRatePerM > 0 ? contractRatePerM : 0;
  if (meterRate <= 0) {
    return [];
  }
  return [
    {
      itemCode: meterTemplate.itemCode,
      label: meterTemplate.label,
      unit: meterTemplate.unit,
      unitRate: meterRate,
      drillingStageLabel: null,
      depthBandStartM: null,
      depthBandEndM: null,
      sortOrder: meterTemplate.sortOrder,
      isActive: true
    }
  ];
}

function normalizeBillingRateItems(
  value: ProjectBillingRateItemRecord[],
  contractType: ProjectContractTypeOption,
  contractRatePerM: number
) {
  if (!Array.isArray(value) || value.length === 0) {
    return defaultBillingRateItems(contractType, contractRatePerM);
  }

  const cleaned = value
    .filter((entry) => Boolean(entry.itemCode && entry.label && entry.unit))
    .map((entry) => ({
      itemCode: entry.itemCode,
      label: entry.label,
      unit: entry.unit,
      unitRate: Number(entry.unitRate || 0),
      drillingStageLabel:
        typeof entry.drillingStageLabel === "string" && entry.drillingStageLabel.trim().length > 0
          ? entry.drillingStageLabel.trim()
          : null,
      depthBandStartM:
        typeof entry.depthBandStartM === "number" && Number.isFinite(entry.depthBandStartM)
          ? entry.depthBandStartM
          : null,
      depthBandEndM:
        typeof entry.depthBandEndM === "number" && Number.isFinite(entry.depthBandEndM)
          ? entry.depthBandEndM
          : null,
      sortOrder: Number.isFinite(entry.sortOrder) ? entry.sortOrder : 0,
      isActive: entry.isActive !== false
    }))
    .filter((entry) => Number.isFinite(entry.unitRate) && entry.unitRate > 0)
    .sort(compareBillingRateItems);

  if (cleaned.length > 0) {
    return cleaned;
  }

  return defaultBillingRateItems(contractType, contractRatePerM);
}

function sortBillingRateItems(value: ProjectBillingRateItemFormLine[]) {
  return [...value].sort(compareBillingRateItems);
}

function compareBillingRateItems(left: ProjectBillingRateItemFormLine, right: ProjectBillingRateItemFormLine) {
  if (left.sortOrder !== right.sortOrder) {
    return left.sortOrder - right.sortOrder;
  }
  const leftDepth = typeof left.depthBandStartM === "number" ? left.depthBandStartM : Number.POSITIVE_INFINITY;
  const rightDepth = typeof right.depthBandStartM === "number" ? right.depthBandStartM : Number.POSITIVE_INFINITY;
  if (leftDepth !== rightDepth) {
    return leftDepth - rightDepth;
  }
  return left.itemCode.localeCompare(right.itemCode);
}

function findTemplateByItemCode(itemCode: string) {
  const direct = BILLABLE_ITEM_TEMPLATES.find((entry) => entry.itemCode === itemCode);
  if (direct) {
    return direct;
  }
  return BILLABLE_ITEM_TEMPLATES.find(
    (entry) => Boolean(entry.allowMultiple) && itemCode.startsWith(`${entry.itemCode}_`)
  );
}

function deriveGuidedMeterStartDepth(options: {
  stagedLines: ProjectBillingRateItemFormLine[];
  editingCode: string | null;
  editingLine: ProjectBillingRateItemFormLine | null;
}) {
  if (options.editingCode) {
    const editingIndex = options.stagedLines.findIndex((line) => line.itemCode === options.editingCode);
    if (editingIndex > 0) {
      return options.stagedLines[editingIndex - 1].depthBandEndM ?? 0;
    }
    if (editingIndex === 0) {
      return 0;
    }
    if (
      options.editingLine &&
      Number.isFinite(options.editingLine.depthBandStartM)
    ) {
      return options.editingLine.depthBandStartM ?? 0;
    }
    return 0;
  }

  if (options.stagedLines.length === 0) {
    return 0;
  }

  return options.stagedLines[options.stagedLines.length - 1].depthBandEndM ?? 0;
}

function buildBillingItemCode(options: {
  template: BillableItemTemplate;
  stageLabel: string;
  depthBandStartM: number | null;
  depthBandEndM: number | null;
}) {
  const baseCode = options.template.itemCode;
  if (!options.template.isMeterBased) {
    return baseCode;
  }
  const stageCode = normalizeCodeSegment(options.stageLabel);
  const hasDepth = Number.isFinite(options.depthBandStartM) && Number.isFinite(options.depthBandEndM);
  if (!stageCode && !hasDepth) {
    return baseCode;
  }
  const segments = [baseCode];
  if (stageCode) {
    segments.push(stageCode);
  }
  if (hasDepth) {
    segments.push(`${formatDepthCode(options.depthBandStartM as number)}M`);
    segments.push(`${formatDepthCode(options.depthBandEndM as number)}M`);
  }
  return segments.join("_");
}

function normalizeCodeSegment(value: string) {
  const upper = value.trim().toUpperCase();
  if (!upper) {
    return "";
  }
  return upper
    .replace(/[^A-Z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function formatDepthCode(value: number) {
  const normalized = value.toString();
  return normalized.replace(".", "P");
}

function Input({
  label,
  value,
  onChange,
  type = "text",
  required = false
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
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
        className="w-full rounded-lg border border-slate-200 px-3 py-2"
      />
    </label>
  );
}

function Select({
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
        className="w-full rounded-lg border border-slate-200 px-3 py-2"
      >
        <option value="">Select</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
