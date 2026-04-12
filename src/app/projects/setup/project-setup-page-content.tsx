"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { AccessGate } from "@/components/layout/access-gate";
import { Card } from "@/components/ui/card";
import { ProjectSetupFallback } from "./project-setup-page-fallback";
import { ProjectSetupStepSections } from "./project-setup-step-sections";
import {
  BILLABLE_ITEM_TEMPLATES,
  STEP_LABELS,
  createEmptyProjectForm,
  type ClientOption,
  type EmployeeOption,
  type ProjectBillingRateItemFormLine,
  type ProjectFormState,
  type ProjectRecord,
  type ProjectSetupStep,
  type RigOption
} from "./project-setup-types";
import {
  buildBillingItemCode,
  defaultBillingRateItems,
  deriveGuidedMeterStartDepth,
  deriveStatusFromDates,
  findTemplateByItemCode,
  normalizeBillingRateItems,
  normalizeContractType,
  normalizeSetupProfile,
  parseOptionalNonNegative,
  parseOptionalPositive,
  sortBillingRateItems,
  validateProjectSetupStep
} from "./project-setup-utils";
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
      Array.from(new Set(projects.map((project) => project.location.trim()).filter((location) => location.length > 0))).sort(
        (a, b) => a.localeCompare(b)
      ),
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
                <ProjectSetupStepSections
                  currentStep={currentStep}
                  form={form}
                  setForm={setForm}
                  clients={clients}
                  locationOptions={locationOptions}
                  derivedProjectStatus={derivedProjectStatus}
                  billingTemplateOptions={billingTemplateOptions}
                  billingLineCode={billingLineCode}
                  setBillingLineCode={setBillingLineCode}
                  addModeBlocked={addModeBlocked}
                  selectedBillingTemplate={selectedBillingTemplate}
                  billingLineRate={billingLineRate}
                  setBillingLineRate={setBillingLineRate}
                  saveBillingLine={saveBillingLine}
                  editingBillingCode={editingBillingCode}
                  selectedBillingTemplateIsMeter={selectedBillingTemplateIsMeter}
                  billingLineStageLabel={billingLineStageLabel}
                  setBillingLineStageLabel={setBillingLineStageLabel}
                  derivedBillingLineDepthStartText={derivedBillingLineDepthStartText}
                  billingLineDepthEnd={billingLineDepthEnd}
                  setBillingLineDepthEnd={setBillingLineDepthEnd}
                  billingLineItemCodePreview={billingLineItemCodePreview}
                  billingLineError={billingLineError}
                  activeBillingRateItems={activeBillingRateItems}
                  startEditBillingLine={startEditBillingLine}
                  archiveBillingLine={archiveBillingLine}
                  archivedBillingItemCount={archivedBillingItemCount}
                  rigs={rigs}
                  secondaryRigOptions={secondaryRigOptions}
                  employees={employees}
                  reviewSummary={reviewSummary}
                />

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
