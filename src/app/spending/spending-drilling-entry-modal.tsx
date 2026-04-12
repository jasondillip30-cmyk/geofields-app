"use client";

import { X } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent
} from "react";

import { DrillingReportEntryFormCard } from "@/app/drilling-reports/drilling-report-entry-form-card";
import {
  loadDrillingConsumablesPool,
  loadDrillingReferenceData,
  loadProjectHoleProgress
} from "@/app/drilling-reports/drilling-reports-page-data";
import { useDrillingReportsFormDerived } from "@/app/drilling-reports/drilling-reports-page-form-derived";
import {
  buildCreateFormFromScopedProject,
  buildFormStateForProjectChange
} from "@/app/drilling-reports/drilling-reports-page-form-state";
import {
  emitDrillingAnalyticsRefresh,
  persistDrillingReport
} from "@/app/drilling-reports/drilling-reports-page-save";
import type {
  DrillReportFormState,
  HoleProgressSummary,
  ProjectConsumablePoolItem,
  ProjectOption,
  StagedConsumableLine
} from "@/app/drilling-reports/drilling-reports-page-types";
import { createEmptyForm } from "@/app/drilling-reports/drilling-reports-page-utils";
import { formatNumber } from "@/lib/utils";

type SpendingDrillingEntryModalProps = {
  open: boolean;
  projectId: string;
  reportsHref: string;
  onClose: () => void;
  onSaved: () => void;
};

export function SpendingDrillingEntryModal({
  open,
  projectId,
  reportsHref,
  onClose,
  onSaved
}: SpendingDrillingEntryModalProps) {
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [referencesLoading, setReferencesLoading] = useState(false);
  const [form, setForm] = useState<DrillReportFormState>(() => createEmptyForm(projectId, ""));
  const [formSaving, setFormSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [requiresContinuityOverride, setRequiresContinuityOverride] = useState(false);
  const [holeProgressByProject, setHoleProgressByProject] = useState<
    Record<string, HoleProgressSummary[]>
  >({});
  const [holeProgressLoading, setHoleProgressLoading] = useState(false);
  const [formConsumablesPool, setFormConsumablesPool] = useState<ProjectConsumablePoolItem[]>([]);
  const [formConsumablesLoading, setFormConsumablesLoading] = useState(false);
  const [consumableSearch, setConsumableSearch] = useState("");
  const [pendingConsumableItemId, setPendingConsumableItemId] = useState("");
  const [pendingConsumableQuantity, setPendingConsumableQuantity] = useState("1");
  const [stagedConsumables, setStagedConsumables] = useState<StagedConsumableLine[]>([]);
  const initializedProjectRef = useRef<string>("");

  const reportableProjects = useMemo(
    () =>
      projects.filter(
        (project) => project.status === "ACTIVE" || project.status === "PLANNED"
      ),
    [projects]
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

    return Array.from(rigsById.values()).sort((left, right) =>
      left.rigCode.localeCompare(right.rigCode)
    );
  }, [formProject]);

  const formProjectRigsLabel = useMemo(() => {
    if (formProjectRigOptions.length === 0) {
      return "No rig assigned";
    }
    return formProjectRigOptions.map((entry) => entry.rigCode).join(" • ");
  }, [formProjectRigOptions]);

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
    formMode: "create",
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

  const loadReferences = useCallback(async () => {
    setReferencesLoading(true);
    try {
      const referenceData = await loadDrillingReferenceData();
      setProjects(referenceData.projects);
    } catch {
      setProjects([]);
    } finally {
      setReferencesLoading(false);
    }
  }, []);

  const handleFormProjectChange = useCallback((value: string) => {
    setConsumableSearch("");
    setPendingConsumableItemId("");
    setPendingConsumableQuantity("1");
    setStagedConsumables([]);
    setForm((current) => buildFormStateForProjectChange(current, value));
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

  useEffect(() => {
    if (!open) {
      initializedProjectRef.current = "";
      return;
    }
    setFormError(null);
    setRequiresContinuityOverride(false);
    setConsumableSearch("");
    setPendingConsumableItemId("");
    setPendingConsumableQuantity("1");
    setStagedConsumables([]);
    void loadReferences();
  }, [loadReferences, open]);

  useEffect(() => {
    if (!open || !projectId || projects.length === 0) {
      return;
    }
    if (initializedProjectRef.current === projectId) {
      return;
    }

    const scopedProject = projects.find((project) => project.id === projectId) || null;
    setForm(
      buildCreateFormFromScopedProject({
        scopedProjectId: projectId,
        reportableProjectIds: reportableProjects.map((project) => project.id),
        allProjectIds: projects.map((project) => project.id),
        projectAssignedRigId: scopedProject?.assignedRig?.id || null,
        projectBackupRigId: scopedProject?.backupRig?.id || null
      })
    );
    if (!holeProgressByProject[projectId]) {
      void (async () => {
        setHoleProgressLoading(true);
        try {
          const next = await loadProjectHoleProgress(projectId);
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
      })();
    }
    initializedProjectRef.current = projectId;
  }, [holeProgressByProject, open, projectId, projects, reportableProjects]);

  useEffect(() => {
    if (!open || !form.projectId) {
      setFormConsumablesPool([]);
      return;
    }
    let active = true;
    setFormConsumablesLoading(true);
    (async () => {
      try {
        const data = await loadDrillingConsumablesPool({
          projectId: form.projectId,
          excludeDrillReportId: null
        });
        if (active) {
          setFormConsumablesPool(data);
        }
      } catch {
        if (active) {
          setFormConsumablesPool([]);
        }
      } finally {
        if (active) {
          setFormConsumablesLoading(false);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [form.projectId, open]);

  useEffect(() => {
    if (!open || !form.projectId) {
      return;
    }
    if (holeProgressByProject[form.projectId]) {
      return;
    }
    let active = true;
    setHoleProgressLoading(true);
    (async () => {
      try {
        const next = await loadProjectHoleProgress(form.projectId);
        if (active) {
          setHoleProgressByProject((current) => ({
            ...current,
            [form.projectId]: next
          }));
        }
      } catch {
        if (active) {
          setHoleProgressByProject((current) => ({
            ...current,
            [form.projectId]: []
          }));
        }
      } finally {
        if (active) {
          setHoleProgressLoading(false);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [form.projectId, holeProgressByProject, open]);

  useEffect(() => {
    if (!open || !form.projectId) {
      return;
    }
    if (formProjectRigOptions.length === 0) {
      if (form.rigId) {
        setForm((current) => ({ ...current, rigId: "" }));
      }
      return;
    }

    const hasSelectedAllowedRig = formProjectRigOptions.some(
      (rigOption) => rigOption.id === form.rigId
    );
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
  }, [form.projectId, form.rigId, formProjectRigOptions, open]);

  const saveReport = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setFormSaving(true);
      setFormError(null);

      const result = await persistDrillingReport({
        form,
        formMode: "create",
        editingReportId: null,
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

      emitDrillingAnalyticsRefresh();
      onSaved();
      onClose();
      setForm(createEmptyForm(projectId, formProjectRigOptions[0]?.id || ""));
      setFormSaving(false);
    },
    [
      consumablesPoolByItemId,
      derivedFromMeter,
      derivedHoleNumber,
      derivedToMeter,
      form,
      formProject?.location,
      formProjectBillingItems,
      formProjectRigOptions,
      guidedBillableLinesResult,
      metersDrilledToday,
      onClose,
      onSaved,
      projectId,
      requiresContinuityOverride,
      stagedConsumables
    ]
  );

  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[90]">
      <button
        type="button"
        onClick={onClose}
        className="absolute inset-0 bg-slate-900/40 backdrop-blur-[1px]"
        aria-label="Close drilling report form"
      />
      <div className="absolute left-1/2 top-4 h-[calc(100vh-2rem)] w-[min(1100px,96vw)] -translate-x-1/2 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_24px_64px_rgba(15,23,42,0.28)] sm:p-5">
        <div className="mb-3 flex items-start justify-between gap-3 border-b border-slate-100 pb-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Project Operations / Drilling reports
            </p>
            <p className="text-lg font-semibold text-ink-900">New drilling report</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 text-slate-600 transition-colors hover:bg-slate-50"
            aria-label="Close"
          >
            <X size={14} />
          </button>
        </div>

        {referencesLoading ? (
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
            Loading drilling report form...
          </div>
        ) : (
          <DrillingReportEntryFormCard
            isFormOpen
            spendingReportsHref={reportsHref}
            saveReport={saveReport}
            formMode="create"
            form={form}
            setForm={setForm}
            formSaving={formSaving}
            formError={formError}
            isSingleProjectScope
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
        )}
      </div>
    </div>
  );
}
