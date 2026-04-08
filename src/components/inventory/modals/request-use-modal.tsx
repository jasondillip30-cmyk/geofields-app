"use client";

import { useEffect, useMemo, useState } from "react";
import type { Dispatch, FormEvent, SetStateAction } from "react";

import { FilterSelect, InputField } from "@/components/inventory/inventory-page-shared";
import type {
  BreakdownContextOption,
  InventoryItemRow,
  InventoryLocation,
  MaintenanceContextOption,
  UseRequestFormState
} from "@/app/inventory/page";
import { cn, formatNumber } from "@/lib/utils";

export function RequestUseModal({
  open,
  onClose,
  onSubmit,
  onContinueToPurchaseRequest,
  form,
  onFormChange,
  projects,
  rigs,
  lockedProject,
  maintenanceRequests,
  breakdownReports,
  locations,
  item,
  submitting,
  errorMessage
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  onContinueToPurchaseRequest: () => void;
  form: UseRequestFormState;
  onFormChange: Dispatch<SetStateAction<UseRequestFormState>>;
  projects: Array<{
    id: string;
    name: string;
    clientId: string;
    assignedRigId: string | null;
    backupRigId: string | null;
  }>;
  rigs: Array<{ id: string; rigCode: string }>;
  lockedProject: {
    id: string;
    name: string;
    clientId: string;
    assignedRigId: string | null;
    backupRigId: string | null;
  } | null;
  maintenanceRequests: MaintenanceContextOption[];
  breakdownReports: BreakdownContextOption[];
  locations: InventoryLocation[];
  item: InventoryItemRow | null;
  submitting: boolean;
  errorMessage: string | null;
}) {
  const [isMounted, setIsMounted] = useState(open);
  const [isVisible, setIsVisible] = useState(open);

  useEffect(() => {
    let timeoutId: number | undefined;
    if (open) {
      setIsMounted(true);
      timeoutId = window.setTimeout(() => setIsVisible(true), 12);
    } else if (isMounted) {
      setIsVisible(false);
      timeoutId = window.setTimeout(() => setIsMounted(false), 180);
    }

    return () => {
      if (timeoutId !== undefined) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [isMounted, open]);

  const isLockedProjectMode = Boolean(lockedProject?.id);

  const maintenanceRigOptions = useMemo(() => {
    const byId = new Map<string, { id: string; rigCode: string }>();
    for (const requestRow of maintenanceRequests) {
      if (requestRow.rig?.id && requestRow.rig?.rigCode) {
        byId.set(requestRow.rig.id, {
          id: requestRow.rig.id,
          rigCode: requestRow.rig.rigCode
        });
      }
    }
    return Array.from(byId.values()).sort((a, b) => a.rigCode.localeCompare(b.rigCode));
  }, [maintenanceRequests]);
  const maintenanceRequestsForSelectedRig = useMemo(() => {
    if (!form.maintenanceRigId) {
      return [];
    }
    return maintenanceRequests.filter(
      (requestRow) => requestRow.rig?.id === form.maintenanceRigId
    );
  }, [form.maintenanceRigId, maintenanceRequests]);
  const projectById = useMemo(() => {
    const byId = new Map<
      string,
      {
        id: string;
        name: string;
        clientId: string;
        assignedRigId: string | null;
        backupRigId: string | null;
      }
    >();
    for (const project of projects) {
      byId.set(project.id, project);
    }
    return byId;
  }, [projects]);
  const selectedDrillingProject = isLockedProjectMode
    ? lockedProject
    : form.projectId
      ? projectById.get(form.projectId) || null
      : null;
  const drillingProjectOptions = useMemo(
    () =>
      isLockedProjectMode && lockedProject
        ? [lockedProject]
        : [...projects].sort((left, right) => left.name.localeCompare(right.name)),
    [isLockedProjectMode, lockedProject, projects]
  );
  const allowedProjectRigIds = useMemo(() => {
    if (!selectedDrillingProject) {
      return [] as string[];
    }
    const uniqueIds = new Set<string>();
    if (selectedDrillingProject.assignedRigId) {
      uniqueIds.add(selectedDrillingProject.assignedRigId);
    }
    if (selectedDrillingProject.backupRigId) {
      uniqueIds.add(selectedDrillingProject.backupRigId);
    }
    return Array.from(uniqueIds.values());
  }, [selectedDrillingProject]);
  const drillingProjectRigOptions = useMemo(
    () =>
      rigs
        .filter((rig) => allowedProjectRigIds.includes(rig.id))
        .sort((left, right) => left.rigCode.localeCompare(right.rigCode)),
    [allowedProjectRigIds, rigs]
  );

  useEffect(() => {
    if (!open || !isLockedProjectMode || !lockedProject) {
      return;
    }
    onFormChange((current) => {
      const nextProjectId = lockedProject.id;
      if (
        current.reasonType === "DRILLING_REPORT" &&
        current.projectId === nextProjectId &&
        current.maintenanceRigId === "" &&
        current.maintenanceRequestId === "" &&
        current.breakdownReportId === ""
      ) {
        return current;
      }
      return {
        ...current,
        reasonType: "DRILLING_REPORT",
        projectId: nextProjectId,
        drillReportId: "",
        maintenanceRigId: "",
        maintenanceRequestId: "",
        breakdownReportId: ""
      };
    });
  }, [isLockedProjectMode, lockedProject, onFormChange, open]);

  useEffect(() => {
    if (form.reasonType !== "MAINTENANCE") {
      return;
    }
    if (!form.maintenanceRigId) {
      if (form.maintenanceRequestId) {
        onFormChange((current) =>
          current.reasonType === "MAINTENANCE" && !current.maintenanceRigId
            ? { ...current, maintenanceRequestId: "" }
            : current
        );
      }
      return;
    }

    if (maintenanceRequestsForSelectedRig.length === 1) {
      const autoLinkedId = maintenanceRequestsForSelectedRig[0].id;
      if (form.maintenanceRequestId !== autoLinkedId) {
        onFormChange((current) =>
          current.reasonType === "MAINTENANCE" &&
          current.maintenanceRigId === form.maintenanceRigId
            ? { ...current, maintenanceRequestId: autoLinkedId, rigId: current.maintenanceRigId }
            : current
        );
      }
      return;
    }

    if (
      form.maintenanceRequestId &&
      !maintenanceRequestsForSelectedRig.some(
        (requestRow) => requestRow.id === form.maintenanceRequestId
      )
    ) {
      onFormChange((current) =>
        current.reasonType === "MAINTENANCE" &&
        current.maintenanceRigId === form.maintenanceRigId
          ? { ...current, maintenanceRequestId: "" }
          : current
      );
    }
  }, [
    form.maintenanceRequestId,
    form.maintenanceRigId,
    form.reasonType,
    maintenanceRequestsForSelectedRig,
    onFormChange
  ]);
  const effectiveReasonType: UseRequestFormState["reasonType"] = isLockedProjectMode
    ? "DRILLING_REPORT"
    : form.reasonType;

  useEffect(() => {
    if (effectiveReasonType !== "DRILLING_REPORT") {
      return;
    }
    const rigIsAllowed = form.rigId ? allowedProjectRigIds.includes(form.rigId) : false;
    const nextRigId =
      rigIsAllowed
        ? form.rigId
        : drillingProjectRigOptions.length === 1
          ? drillingProjectRigOptions[0].id
          : "";
    if (nextRigId !== form.rigId) {
      onFormChange((current) =>
        (isLockedProjectMode || current.reasonType === "DRILLING_REPORT")
          ? { ...current, rigId: nextRigId }
          : current
      );
    }
  }, [
    allowedProjectRigIds,
    drillingProjectRigOptions,
    effectiveReasonType,
    form.rigId,
    isLockedProjectMode,
    onFormChange
  ]);

  if (!isMounted) {
    return null;
  }

  const projectedStock = Number(form.quantity || 0) > 0 ? item ? item.quantityInStock - Number(form.quantity || 0) : null : null;
  const selectedMaintenanceContext =
    maintenanceRequests.find((requestRow) => requestRow.id === form.maintenanceRequestId) || null;
  const resolvedMaintenanceContext =
    selectedMaintenanceContext ||
    (maintenanceRequestsForSelectedRig.length === 1
      ? maintenanceRequestsForSelectedRig[0]
      : null);
  const selectedBreakdownContext =
    breakdownReports.find((entry) => entry.id === form.breakdownReportId) || null;
  const effectiveProjectId =
    effectiveReasonType === "DRILLING_REPORT"
      ? (form.projectId || selectedDrillingProject?.id || "").trim()
      : "";
  const workflowStep = isLockedProjectMode ? 2 : effectiveReasonType ? 2 : 1;
  const hasStockShortage =
    projectedStock !== null && Number.isFinite(projectedStock) && projectedStock < 0;
  const hasRequiredContextSelection = isLockedProjectMode
    ? Boolean(effectiveProjectId && form.rigId)
    : effectiveReasonType === "MAINTENANCE"
      ? form.maintenanceRigId
        ? maintenanceRequestsForSelectedRig.length === 1
          ? true
          : maintenanceRequestsForSelectedRig.length > 1
            ? Boolean(form.maintenanceRequestId)
            : false
        : false
      : effectiveReasonType === "BREAKDOWN"
        ? Boolean(form.breakdownReportId)
        : effectiveReasonType === "DRILLING_REPORT"
          ? Boolean(effectiveProjectId && form.rigId)
        : false;
  const projectedStockWarning =
    hasStockShortage
      ? "Requested quantity exceeds stock on hand. Approval will be blocked unless stock is replenished."
      : null;

  return (
    <div
      className={`fixed inset-0 z-[82] flex items-center justify-center p-3 transition-opacity duration-200 ease-out sm:p-6 ${
        isVisible ? "opacity-100" : "pointer-events-none opacity-0"
      }`}
    >
      <button
        type="button"
        onClick={onClose}
        className={`absolute inset-0 bg-slate-900/35 backdrop-blur-[2px] transition-opacity duration-200 ${
          isVisible ? "opacity-100" : "opacity-0"
        }`}
        aria-label="Close request use modal"
      />
      <section
        className={`relative z-10 w-full max-w-xl rounded-2xl border border-slate-200 bg-white shadow-[0_20px_50px_rgba(15,23,42,0.24)] transition-all duration-200 ease-out ${
          isVisible ? "translate-y-0 scale-100 opacity-100" : "translate-y-1 scale-[0.985] opacity-0"
        }`}
      >
        <div className="space-y-2 border-b border-slate-200 px-4 py-3">
          <p className="text-sm font-semibold text-ink-900">Request item use</p>
          <p className="text-xs text-slate-600">
            {item ? `${item.name} (${item.sku})` : "Submit usage request for approval"}
          </p>
          {item && <p className="mt-1 text-xs text-slate-500">Stock on hand: {formatNumber(item.quantityInStock)}</p>}
          <div className="flex flex-wrap gap-1.5">
            {isLockedProjectMode ? (
              <span className="rounded-full border border-brand-300 bg-brand-50 px-2 py-0.5 text-[11px] font-semibold text-brand-800">
                Project-guided request
              </span>
            ) : (
              <>
                <span
                  className={cn(
                    "rounded-full border px-2 py-0.5 text-[11px] font-semibold",
                    workflowStep === 1
                      ? "border-brand-300 bg-brand-50 text-brand-800"
                      : "border-slate-200 bg-slate-50 text-slate-500"
                  )}
                >
                  1. Reason
                </span>
                <span
                  className={cn(
                    "rounded-full border px-2 py-0.5 text-[11px] font-semibold",
                    workflowStep === 2
                      ? "border-brand-300 bg-brand-50 text-brand-800"
                      : "border-slate-200 bg-slate-50 text-slate-500"
                  )}
                >
                  2. Operational context
                </span>
              </>
            )}
          </div>
        </div>
        {item?.status !== "ACTIVE" && (
          <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-900">
            This item is inactive. Reactivate it before submitting a usage request.
          </div>
        )}
        {projectedStockWarning && (
          <div className="space-y-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-900">
            <p>{projectedStockWarning}</p>
            <button
              type="button"
              onClick={onContinueToPurchaseRequest}
              className="rounded-md border border-amber-300 bg-amber-100 px-2 py-1 text-[11px] font-semibold text-amber-900 hover:bg-amber-200"
            >
              Create purchase request
            </button>
          </div>
        )}
        {errorMessage && (
          <div className="border-b border-red-200 bg-red-50 px-4 py-2 text-xs text-red-800">{errorMessage}</div>
        )}
        <form onSubmit={(event) => void onSubmit(event)} className="space-y-3 px-4 py-4">
          {isLockedProjectMode ? (
            <section className="space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Project request flow
              </p>
              <div className="space-y-1 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-xs text-brand-900">
                <p>
                  1. Item selected:{" "}
                  <span className="font-semibold">{item ? `${item.name} (${item.sku})` : "Current item"}</span>
                </p>
                <p>2. Enter quantity and confirm project rig.</p>
                <p>3. Submit request.</p>
              </div>
            </section>
          ) : (
            <section className="space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Step 1 — Reason for request
              </p>
              <div className="grid gap-2 md:grid-cols-2">
                {([
                  { value: "MAINTENANCE", label: "Maintenance" },
                  { value: "BREAKDOWN", label: "Breakdown" },
                  { value: "DRILLING_REPORT", label: "Drilling report" }
                ] as const).map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() =>
                      onFormChange((current) => ({
                        ...current,
                        reasonType: option.value,
                        maintenanceRigId:
                          option.value === "MAINTENANCE"
                            ? current.maintenanceRigId
                            : "",
                        projectId:
                          option.value === "DRILLING_REPORT" ? current.projectId : "",
                        rigId: option.value === "DRILLING_REPORT" ? current.rigId : "",
                        drillReportId:
                          option.value === "DRILLING_REPORT" ? current.drillReportId : "",
                        maintenanceRequestId:
                          option.value === "MAINTENANCE" ? current.maintenanceRequestId : "",
                        breakdownReportId:
                          option.value === "BREAKDOWN" ? current.breakdownReportId : ""
                      }))
                    }
                    className={cn(
                      "rounded-lg border px-3 py-2 text-left text-sm font-medium transition-colors",
                      form.reasonType === option.value
                        ? "border-brand-300 bg-brand-50 text-brand-900"
                        : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                    )}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </section>
          )}

          <section className="space-y-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              {isLockedProjectMode ? "Request details" : "Step 2 — Operational context"}
            </p>
            {!effectiveReasonType ? (
              <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                {isLockedProjectMode ? "Preparing project request..." : "Select a reason to continue."}
              </p>
            ) : (
              <div className="grid gap-3 md:grid-cols-2">
                <InputField
                  label={isLockedProjectMode ? "Quantity to request" : "Quantity"}
                  type="number"
                  value={form.quantity}
                  onChange={(value) =>
                    onFormChange((current) => ({ ...current, quantity: value }))
                  }
                  required
                />
                {!isLockedProjectMode ? (
                  <FilterSelect
                    label="From Location"
                    value={form.locationId}
                    onChange={(value) =>
                      onFormChange((current) => ({ ...current, locationId: value }))
                    }
                    options={[
                      { value: "", label: "Select location" },
                      ...locations.map((location) => ({ value: location.id, label: location.name }))
                    ]}
                  />
                ) : null}

                {effectiveReasonType === "MAINTENANCE" && (
                  <>
                    <FilterSelect
                      label="Rig Under Maintenance"
                      value={form.maintenanceRigId}
                      onChange={(value) =>
                        onFormChange((current) => ({
                          ...current,
                          maintenanceRigId: value,
                          maintenanceRequestId: ""
                        }))
                      }
                      options={[
                        {
                          value: "",
                          label:
                            maintenanceRigOptions.length > 0
                              ? "Select rig"
                              : "No rigs currently under maintenance"
                        },
                        ...maintenanceRigOptions.map((entry) => ({
                          value: entry.id,
                          label: entry.rigCode
                        }))
                      ]}
                    />
                    {form.maintenanceRigId && maintenanceRequestsForSelectedRig.length === 1 ? (
                      <label className="text-xs text-ink-700">
                        <span className="mb-1 block uppercase tracking-wide text-slate-500">
                          Open Maintenance
                        </span>
                        <input
                          value={`${maintenanceRequestsForSelectedRig[0].requestCode} (auto-linked)`}
                          readOnly
                          className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700"
                        />
                      </label>
                    ) : (
                      <FilterSelect
                        label="Open Maintenance"
                        value={form.maintenanceRequestId}
                        onChange={(value) =>
                          onFormChange((current) => ({
                            ...current,
                            maintenanceRequestId: value
                          }))
                        }
                        options={[
                          {
                            value: "",
                            label:
                              form.maintenanceRigId
                                ? maintenanceRequestsForSelectedRig.length > 1
                                  ? "Select maintenance record"
                                  : "No open records for selected rig"
                                : "Select rig first"
                          },
                          ...maintenanceRequestsForSelectedRig.map((requestRow) => ({
                            value: requestRow.id,
                            label: `${requestRow.requestCode} • ${
                              requestRow.rig?.rigCode || "No rig"
                            }`
                          }))
                        ]}
                      />
                    )}
                    <label className="text-xs text-ink-700">
                      <span className="mb-1 block uppercase tracking-wide text-slate-500">
                        Note (optional)
                      </span>
                      <input
                        value={form.reasonDetails}
                        onChange={(event) =>
                          onFormChange((current) => ({
                            ...current,
                            reasonDetails: event.target.value
                          }))
                        }
                        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                        placeholder="Short usage note"
                      />
                    </label>
                    {form.maintenanceRigId &&
                      maintenanceRequestsForSelectedRig.length === 0 && (
                        <p className="md:col-span-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                          No open maintenance case found for this rig. Report maintenance first,
                          then request item usage.
                        </p>
                      )}
                    {form.maintenanceRigId &&
                      maintenanceRequestsForSelectedRig.length > 1 &&
                      !form.maintenanceRequestId && (
                        <p className="md:col-span-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
                          Multiple open maintenance cases found for this rig. Select the case this
                          request belongs to.
                        </p>
                      )}
                    {resolvedMaintenanceContext && (
                      <div className="md:col-span-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
                        <p>
                          <span className="font-semibold">Rig:</span>{" "}
                          {resolvedMaintenanceContext.rig?.rigCode || "-"}
                        </p>
                        <p>
                          <span className="font-semibold">Project:</span>{" "}
                          {resolvedMaintenanceContext.project?.name || "No active project"}
                        </p>
                        {resolvedMaintenanceContext.issueDescription ? (
                          <p>
                            <span className="font-semibold">Work:</span>{" "}
                            {resolvedMaintenanceContext.issueDescription}
                          </p>
                        ) : null}
                      </div>
                    )}
                  </>
                )}

                {effectiveReasonType === "BREAKDOWN" && (
                  <>
                    <FilterSelect
                      label="Open Breakdown"
                      value={form.breakdownReportId}
                      onChange={(value) =>
                        onFormChange((current) => ({
                          ...current,
                          breakdownReportId: value
                        }))
                      }
                      options={[
                        {
                          value: "",
                          label:
                            breakdownReports.length > 0
                              ? "Select breakdown record"
                              : "No open breakdown records"
                        },
                        ...breakdownReports.map((entry) => ({
                          value: entry.id,
                          label: `${entry.title} • ${entry.rig?.rigCode || "No rig"}`
                        }))
                      ]}
                    />
                    <label className="text-xs text-ink-700">
                      <span className="mb-1 block uppercase tracking-wide text-slate-500">
                        Note (optional)
                      </span>
                      <input
                        value={form.reasonDetails}
                        onChange={(event) =>
                          onFormChange((current) => ({
                            ...current,
                            reasonDetails: event.target.value
                          }))
                        }
                        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                        placeholder="Short usage note"
                      />
                    </label>
                    {selectedBreakdownContext && (
                      <div className="md:col-span-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
                        <p>
                          <span className="font-semibold">Rig:</span>{" "}
                          {selectedBreakdownContext.rig?.rigCode || "-"}
                        </p>
                        <p>
                          <span className="font-semibold">Project:</span>{" "}
                          {selectedBreakdownContext.project?.name || "-"}
                        </p>
                        <p>
                          <span className="font-semibold">Severity:</span>{" "}
                          {selectedBreakdownContext.severity}
                        </p>
                      </div>
                    )}
                  </>
                )}

                {effectiveReasonType === "DRILLING_REPORT" && (
                  <>
                    {isLockedProjectMode ? (
                      <label className="text-xs text-ink-700">
                        <span className="mb-1 block uppercase tracking-wide text-slate-500">Project (locked)</span>
                        <input
                          readOnly
                          value={lockedProject?.name || "Selected project"}
                          className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700"
                        />
                      </label>
                    ) : (
                      <FilterSelect
                        label="Project"
                        value={form.projectId}
                        onChange={(value) =>
                          onFormChange((current) => ({
                            ...current,
                            projectId: value,
                            rigId: ""
                          }))
                        }
                        options={[
                          {
                            value: "",
                            label:
                              drillingProjectOptions.length > 0
                                ? "Select project"
                                : "No projects available"
                          },
                          ...drillingProjectOptions.map((project) => ({
                            value: project.id,
                            label: project.name
                          }))
                        ]}
                      />
                    )}
                    {drillingProjectRigOptions.length <= 1 ? (
                      <label className="text-xs text-ink-700">
                        <span className="mb-1 block uppercase tracking-wide text-slate-500">Project rig</span>
                        <input
                          readOnly
                          value={
                            drillingProjectRigOptions[0]?.rigCode ||
                            (effectiveProjectId ? "No rigs assigned to this project" : "Select project first")
                          }
                          className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700"
                        />
                      </label>
                    ) : (
                      <FilterSelect
                        label={isLockedProjectMode ? "Project rig" : "Rig"}
                        value={form.rigId}
                        onChange={(value) =>
                          onFormChange((current) => ({
                            ...current,
                            rigId: value
                          }))
                        }
                        options={[
                          {
                            value: "",
                            label:
                              !effectiveProjectId
                                ? "Select project first"
                                : drillingProjectRigOptions.length > 0
                                  ? "Select project rig"
                                  : "No rigs assigned to this project"
                          },
                          ...drillingProjectRigOptions.map((rigOption) => ({
                            value: rigOption.id,
                            label: rigOption.rigCode
                          }))
                        ]}
                      />
                    )}
                    <label className="text-xs text-ink-700">
                      <span className="mb-1 block uppercase tracking-wide text-slate-500">
                        Note (optional)
                      </span>
                      <input
                        value={form.reasonDetails}
                        onChange={(event) =>
                          onFormChange((current) => ({
                            ...current,
                            reasonDetails: event.target.value
                          }))
                        }
                        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                        placeholder={isLockedProjectMode ? "Optional field note" : "Short usage note"}
                      />
                    </label>
                    {effectiveProjectId && drillingProjectRigOptions.length === 0 ? (
                      <p className="md:col-span-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                        This project has no assigned rig. Assign a rig to the project first.
                      </p>
                    ) : null}
                  </>
                )}
              </div>
            )}
          </section>

          <div className="flex flex-wrap justify-end gap-2 md:col-span-2">
            <button type="button" onClick={onClose} className="gf-btn-secondary px-3 py-1.5 text-xs">
              Cancel
            </button>
            {hasStockShortage && (
              <button
                type="button"
                onClick={onContinueToPurchaseRequest}
                className="rounded-md border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-900 hover:bg-amber-100"
              >
                Create purchase request
              </button>
            )}
            <button
              type="submit"
              disabled={
                submitting ||
                item?.status !== "ACTIVE" ||
                hasStockShortage ||
                !hasRequiredContextSelection
              }
              className="gf-btn-primary px-3 py-1.5 text-xs"
            >
              {submitting ? "Submitting..." : "Submit usage request"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
