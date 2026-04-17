"use client";

import { useEffect, useMemo, useState } from "react";
import type { Dispatch, SetStateAction } from "react";

import { FilterSelect, InputField, readApiError } from "@/components/inventory/inventory-page-shared";
import type {
  BreakdownContextOption,
  InventoryLocation,
  MaintenanceContextOption,
  UseRequestBatchFormState
} from "@/app/inventory/inventory-page-types";
import { cn, formatNumber } from "@/lib/utils";

type SearchInventoryItem = {
  id: string;
  name: string;
  sku: string;
  quantityInStock: number;
  status: "ACTIVE" | "INACTIVE";
  locationId: string | null;
};

type BatchRequestLine = {
  itemId: string;
  name: string;
  sku: string;
  quantityInStock: number;
  quantity: string;
};

const defaultBatchFormState: UseRequestBatchFormState = {
  reasonType: "",
  reasonDetails: "",
  maintenanceRigId: "",
  projectId: "",
  rigId: "",
  maintenanceRequestId: "",
  breakdownReportId: "",
  locationId: ""
};

export function RequestUseBatchModal({
  open,
  onClose,
  onSubmitted,
  projects,
  rigs,
  lockedProject,
  maintenanceRequests,
  breakdownReports,
  locations,
  preselectedItem
}: {
  open: boolean;
  onClose: () => void;
  onSubmitted: () => Promise<void>;
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
  preselectedItem: {
    id: string;
    name: string;
    sku: string;
    quantityInStock: number;
    status: "ACTIVE" | "INACTIVE";
    locationId: string | null;
  } | null;
}) {
  const [isMounted, setIsMounted] = useState(open);
  const [isVisible, setIsVisible] = useState(open);
  const [form, setForm] = useState<UseRequestBatchFormState>({
    ...defaultBatchFormState
  });
  const [lines, setLines] = useState<BatchRequestLine[]>([]);
  const [searchText, setSearchText] = useState("");
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchInventoryItem[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const isLockedProjectMode = Boolean(lockedProject?.id);

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

  useEffect(() => {
    if (!open) {
      return;
    }
    const nextForm: UseRequestBatchFormState = {
      ...defaultBatchFormState,
      reasonType: isLockedProjectMode ? "DRILLING_REPORT" : "",
      projectId: isLockedProjectMode ? lockedProject?.id || "" : "",
      rigId:
        isLockedProjectMode && lockedProject
          ? lockedProject.assignedRigId || lockedProject.backupRigId || ""
          : "",
      locationId: preselectedItem?.locationId || ""
    };
    setForm(nextForm);
    setSearchText("");
    setSearchResults([]);
    setErrorMessage(null);
    setSubmitting(false);
    setLines(() => {
      if (!preselectedItem || preselectedItem.status !== "ACTIVE") {
        return [];
      }
      return [
        {
          itemId: preselectedItem.id,
          name: preselectedItem.name,
          sku: preselectedItem.sku,
          quantityInStock: preselectedItem.quantityInStock,
          quantity: "1"
        }
      ];
    });
  }, [isLockedProjectMode, lockedProject, open, preselectedItem]);

  useEffect(() => {
    if (!open) {
      return;
    }
    if (form.reasonType !== "MAINTENANCE") {
      if (form.maintenanceRigId || form.maintenanceRequestId) {
        setForm((current) => ({
          ...current,
          maintenanceRigId: "",
          maintenanceRequestId: ""
        }));
      }
      return;
    }

    if (!form.maintenanceRigId) {
      if (form.maintenanceRequestId) {
        setForm((current) => ({ ...current, maintenanceRequestId: "" }));
      }
      return;
    }

    if (maintenanceRequestsForSelectedRig.length === 1) {
      const autoLinkedId = maintenanceRequestsForSelectedRig[0].id;
      if (form.maintenanceRequestId !== autoLinkedId) {
        setForm((current) => ({
          ...current,
          maintenanceRequestId: autoLinkedId
        }));
      }
      return;
    }

    if (
      form.maintenanceRequestId &&
      !maintenanceRequestsForSelectedRig.some(
        (requestRow) => requestRow.id === form.maintenanceRequestId
      )
    ) {
      setForm((current) => ({ ...current, maintenanceRequestId: "" }));
    }
  }, [
    form.maintenanceRequestId,
    form.maintenanceRigId,
    form.reasonType,
    maintenanceRequestsForSelectedRig,
    open
  ]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const effectiveReasonType = isLockedProjectMode ? "DRILLING_REPORT" : form.reasonType;
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
      setForm((current) => ({ ...current, rigId: nextRigId }));
    }
  }, [
    allowedProjectRigIds,
    drillingProjectRigOptions,
    form.reasonType,
    form.rigId,
    isLockedProjectMode,
    open
  ]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const trimmed = searchText.trim();
    if (trimmed.length < 2) {
      setSearchResults([]);
      setSearchLoading(false);
      return;
    }
    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setSearchLoading(true);
      try {
        const query = new URLSearchParams();
        query.set("search", trimmed);
        query.set("status", "ACTIVE");
        const response = await fetch(`/api/inventory/items?${query.toString()}`, {
          cache: "no-store",
          signal: controller.signal
        });
        const payload = response.ok ? await response.json() : { data: [] };
        const nextResults: SearchInventoryItem[] = Array.isArray(payload.data)
          ? payload.data.map((item: Record<string, unknown>) => ({
              id: String(item.id || ""),
              name: String(item.name || ""),
              sku: String(item.sku || ""),
              quantityInStock: Number(item.quantityInStock || 0),
              status: String(item.status || "ACTIVE") === "INACTIVE" ? "INACTIVE" : "ACTIVE",
              locationId:
                typeof item.locationId === "string" && item.locationId.trim()
                  ? item.locationId
                  : null
            }))
          : [];
        setSearchResults(nextResults.filter((item) => item.id && item.status === "ACTIVE"));
      } catch {
        setSearchResults([]);
      } finally {
        setSearchLoading(false);
      }
    }, 200);

    return () => {
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [open, searchText]);

  function addItemToBatch(item: SearchInventoryItem) {
    setLines((current) => {
      const existingIndex = current.findIndex((entry) => entry.itemId === item.id);
      if (existingIndex === -1) {
        return [
          ...current,
          {
            itemId: item.id,
            name: item.name,
            sku: item.sku,
            quantityInStock: item.quantityInStock,
            quantity: "1"
          }
        ];
      }
      const next = [...current];
      const parsed = Number(next[existingIndex].quantity || 0);
      next[existingIndex] = {
        ...next[existingIndex],
        quantity: String(Math.max(1, parsed + 1))
      };
      return next;
    });
    if (!form.locationId && item.locationId) {
      setForm((current) => ({ ...current, locationId: item.locationId || "" }));
    }
  }

  function removeLine(lineId: string) {
    setLines((current) => current.filter((entry) => entry.itemId !== lineId));
  }

  function updateLineQuantity(lineId: string, value: string) {
    setLines((current) =>
      current.map((entry) =>
        entry.itemId === lineId
          ? {
              ...entry,
              quantity: value
            }
          : entry
      )
    );
  }

  async function submitBatchRequest() {
    if (submitting) {
      return;
    }
    setErrorMessage(null);

    const effectiveReasonType = isLockedProjectMode ? "DRILLING_REPORT" : form.reasonType;
    const normalizedLines = lines
      .map((line) => ({
        ...line,
        requestedQuantity: Number(line.quantity)
      }))
      .filter((line) => line.itemId.trim().length > 0);

    if (normalizedLines.length === 0) {
      setErrorMessage("Add at least one item before submitting a batch request.");
      return;
    }
    const invalidQuantityLine = normalizedLines.find(
      (line) =>
        !Number.isFinite(line.requestedQuantity) ||
        line.requestedQuantity <= 0 ||
        line.requestedQuantity > line.quantityInStock
    );
    if (invalidQuantityLine) {
      setErrorMessage(
        `Check quantity for ${invalidQuantityLine.name}. Quantity must be greater than zero and not exceed stock on hand.`
      );
      return;
    }

    if (
      effectiveReasonType !== "MAINTENANCE" &&
      effectiveReasonType !== "BREAKDOWN" &&
      effectiveReasonType !== "DRILLING_REPORT"
    ) {
      setErrorMessage(
        "Select Maintenance, Breakdown, or Drilling report context before submitting."
      );
      return;
    }

    const effectiveProjectId =
      effectiveReasonType === "DRILLING_REPORT"
        ? (isLockedProjectMode ? lockedProject?.id || "" : form.projectId).trim()
        : "";
    const effectiveRigId =
      effectiveReasonType === "DRILLING_REPORT" ? (form.rigId || "").trim() : "";

    if (effectiveReasonType === "DRILLING_REPORT" && !effectiveProjectId) {
      setErrorMessage("Select a project before submitting drilling usage batch.");
      return;
    }
    if (effectiveReasonType === "DRILLING_REPORT" && !effectiveRigId) {
      setErrorMessage("Select a project rig before submitting drilling usage batch.");
      return;
    }

    let resolvedMaintenanceRequestId = form.maintenanceRequestId.trim();
    if (effectiveReasonType === "MAINTENANCE") {
      if (!form.maintenanceRigId) {
        setErrorMessage("Select a rig under maintenance.");
        return;
      }
      if (maintenanceRequestsForSelectedRig.length === 0) {
        setErrorMessage(
          "No open maintenance case exists for the selected rig. Open a maintenance case first."
        );
        return;
      }
      if (maintenanceRequestsForSelectedRig.length > 1 && !resolvedMaintenanceRequestId) {
        setErrorMessage("Select which maintenance case this batch belongs to.");
        return;
      }
      if (maintenanceRequestsForSelectedRig.length === 1) {
        resolvedMaintenanceRequestId = maintenanceRequestsForSelectedRig[0].id;
      }
    }
    if (effectiveReasonType === "BREAKDOWN" && !form.breakdownReportId) {
      setErrorMessage("Select an open breakdown record.");
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch("/api/inventory/usage-requests/batches", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          reasonType: effectiveReasonType,
          usageReason: effectiveReasonType,
          reasonDetails: form.reasonDetails.trim(),
          projectId:
            effectiveReasonType === "DRILLING_REPORT" ? effectiveProjectId || null : null,
          rigId:
            effectiveReasonType === "MAINTENANCE"
              ? form.maintenanceRigId || null
              : effectiveReasonType === "DRILLING_REPORT"
                ? effectiveRigId || null
                : null,
          maintenanceRequestId:
            effectiveReasonType === "MAINTENANCE"
              ? resolvedMaintenanceRequestId || null
              : null,
          breakdownReportId:
            effectiveReasonType === "BREAKDOWN" ? form.breakdownReportId || null : null,
          locationId: form.locationId || null,
          lines: normalizedLines.map((line) => ({
            itemId: line.itemId,
            quantity: line.requestedQuantity
          }))
        })
      });
      if (!response.ok) {
        throw new Error(await readApiError(response, "Failed to submit usage batch request."));
      }
      await onSubmitted();
      onClose();
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Failed to submit usage batch request."
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (!isMounted) {
    return null;
  }

  const effectiveReasonType = isLockedProjectMode ? "DRILLING_REPORT" : form.reasonType;
  const workflowStep = isLockedProjectMode ? 2 : effectiveReasonType ? 2 : 1;
  const batchTotalQuantity = lines.reduce((sum, line) => {
    const quantity = Number(line.quantity || 0);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      return sum;
    }
    return sum + quantity;
  }, 0);

  return (
    <div
      className={`fixed inset-0 z-[83] flex items-center justify-center p-3 transition-opacity duration-200 ease-out sm:p-6 ${
        isVisible ? "opacity-100" : "pointer-events-none opacity-0"
      }`}
    >
      <button
        type="button"
        onClick={onClose}
        className={`absolute inset-0 bg-slate-900/35 backdrop-blur-[2px] transition-opacity duration-200 ${
          isVisible ? "opacity-100" : "opacity-0"
        }`}
        aria-label="Close request batch modal"
      />
      <section
        className={`relative z-10 w-full max-w-4xl rounded-2xl border border-slate-200 bg-white shadow-[0_20px_50px_rgba(15,23,42,0.24)] transition-all duration-200 ease-out ${
          isVisible
            ? "translate-y-0 scale-100 opacity-100"
            : "translate-y-1 scale-[0.985] opacity-0"
        }`}
      >
        <div className="space-y-2 border-b border-slate-200 px-4 py-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-sm font-semibold text-ink-900">Request item batch</p>
              <p className="text-xs text-slate-600">
                Search the full warehouse inventory, add items, and submit one requisition.
              </p>
            </div>
            <button type="button" onClick={onClose} className="gf-btn-secondary px-3 py-1.5 text-xs">
              Close
            </button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {isLockedProjectMode ? (
              <span className="rounded-full border border-brand-300 bg-brand-50 px-2 py-0.5 text-[11px] font-semibold text-brand-800">
                Project-guided batch request
              </span>
            ) : null}
            <span
              className={cn(
                "rounded-full border px-2 py-0.5 text-[11px] font-semibold",
                workflowStep === 1
                  ? "border-brand-300 bg-brand-50 text-brand-800"
                  : "border-slate-200 bg-slate-50 text-slate-500"
              )}
            >
              1. Context
            </span>
            <span
              className={cn(
                "rounded-full border px-2 py-0.5 text-[11px] font-semibold",
                workflowStep === 2
                  ? "border-brand-300 bg-brand-50 text-brand-800"
                  : "border-slate-200 bg-slate-50 text-slate-500"
              )}
            >
              2. Build batch
            </span>
          </div>
        </div>

        <div className="space-y-4 px-4 py-4">
          {!isLockedProjectMode ? (
            <div>
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Request context
              </p>
              <div className="grid gap-2 md:grid-cols-2">
                <FilterSelect
                  label="Reason"
                  value={form.reasonType}
                  onChange={(value) =>
                    setForm((current) => ({
                      ...current,
                      reasonType: value as UseRequestBatchFormState["reasonType"],
                      projectId: value === "DRILLING_REPORT" ? current.projectId : "",
                      rigId: value === "DRILLING_REPORT" ? current.rigId : "",
                      maintenanceRigId: value === "MAINTENANCE" ? current.maintenanceRigId : "",
                      maintenanceRequestId:
                        value === "MAINTENANCE" ? current.maintenanceRequestId : "",
                      breakdownReportId:
                        value === "BREAKDOWN" ? current.breakdownReportId : ""
                    }))
                  }
                  options={[
                    { value: "", label: "Select reason" },
                    { value: "DRILLING_REPORT", label: "Project drilling use" },
                    { value: "MAINTENANCE", label: "Maintenance use" },
                    { value: "BREAKDOWN", label: "Breakdown use" }
                  ]}
                />
                <FilterSelect
                  label="Source location"
                  value={form.locationId}
                  onChange={(value) => setForm((current) => ({ ...current, locationId: value }))}
                  options={[
                    { value: "", label: "Default item location" },
                    ...locations.map((location) => ({
                      value: location.id,
                      label: location.name
                    }))
                  ]}
                />
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-xs text-brand-800">
              Context is locked to this project. Choose a project rig then submit your batch.
            </div>
          )}

          {effectiveReasonType === "DRILLING_REPORT" ? (
            <div className="grid gap-2 md:grid-cols-2">
              <FilterSelect
                label="Project"
                value={isLockedProjectMode ? lockedProject?.id || "" : form.projectId}
                onChange={(value) =>
                  setForm((current) => ({
                    ...current,
                    projectId: value,
                    rigId: ""
                  }))
                }
                options={drillingProjectOptions.map((project) => ({
                  value: project.id,
                  label: project.name
                }))}
              />
              <FilterSelect
                label="Project rig"
                value={form.rigId}
                onChange={(value) => setForm((current) => ({ ...current, rigId: value }))}
                options={[
                  { value: "", label: "Select project rig" },
                  ...drillingProjectRigOptions.map((rig) => ({
                    value: rig.id,
                    label: rig.rigCode
                  }))
                ]}
              />
            </div>
          ) : null}

          {effectiveReasonType === "MAINTENANCE" ? (
            <div className="grid gap-2 md:grid-cols-2">
              <FilterSelect
                label="Maintenance rig"
                value={form.maintenanceRigId}
                onChange={(value) =>
                  setForm((current) => ({
                    ...current,
                    maintenanceRigId: value,
                    maintenanceRequestId: "",
                    rigId: value
                  }))
                }
                options={[
                  { value: "", label: "Select maintenance rig" },
                  ...maintenanceRigOptions.map((entry) => ({
                    value: entry.id,
                    label: entry.rigCode
                  }))
                ]}
              />
              <FilterSelect
                label="Maintenance case"
                value={form.maintenanceRequestId}
                onChange={(value) =>
                  setForm((current) => ({ ...current, maintenanceRequestId: value }))
                }
                options={[
                  { value: "", label: "Select maintenance case" },
                  ...maintenanceRequestsForSelectedRig.map((entry) => ({
                    value: entry.id,
                    label: `${entry.requestCode} • ${entry.status}`
                  }))
                ]}
              />
            </div>
          ) : null}

          {effectiveReasonType === "BREAKDOWN" ? (
            <FilterSelect
              label="Breakdown case"
              value={form.breakdownReportId}
              onChange={(value) =>
                setForm((current) => ({ ...current, breakdownReportId: value }))
              }
              options={[
                { value: "", label: "Select breakdown" },
                ...breakdownReports.map((entry) => ({
                  value: entry.id,
                  label: `${entry.title} • ${entry.severity}`
                }))
              ]}
            />
          ) : null}

          <InputField
            label="Reason notes (optional)"
            value={form.reasonDetails}
            onChange={(value) => setForm((current) => ({ ...current, reasonDetails: value }))}
          />

          <div className="grid gap-4 md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
            <section className="space-y-2 rounded-xl border border-slate-200 bg-slate-50/45 p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Search warehouse inventory
              </p>
              <label className="text-xs text-ink-700">
                <span className="mb-1 block uppercase tracking-wide text-slate-500">Search items</span>
                <input
                  value={searchText}
                  onChange={(event) => setSearchText(event.target.value)}
                  placeholder="Type item name, SKU, or part number"
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                />
              </label>
              <div className="max-h-60 space-y-1 overflow-auto rounded-lg border border-slate-200 bg-white p-2">
                {searchLoading ? (
                  <p className="px-2 py-1 text-xs text-slate-600">Searching inventory...</p>
                ) : searchText.trim().length < 2 ? (
                  <p className="px-2 py-1 text-xs text-slate-600">
                    Enter at least 2 characters to search.
                  </p>
                ) : searchResults.length === 0 ? (
                  <p className="px-2 py-1 text-xs text-slate-600">No active items found.</p>
                ) : (
                  searchResults.map((entry) => (
                    <div
                      key={entry.id}
                      className="flex items-center justify-between gap-2 rounded-md border border-slate-200 px-2 py-1.5"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-ink-900">
                          {entry.name}
                        </p>
                        <p className="text-xs text-slate-600">
                          {entry.sku} • Stock: {formatNumber(entry.quantityInStock)}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => addItemToBatch(entry)}
                        className="gf-btn-primary px-2 py-1 text-[11px]"
                      >
                        Add
                      </button>
                    </div>
                  ))
                )}
              </div>
            </section>

            <section className="space-y-2 rounded-xl border border-slate-200 bg-white p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  Batch lines
                </p>
                <span className="text-xs text-slate-600">
                  {lines.length} item(s) • Qty {formatNumber(batchTotalQuantity)}
                </span>
              </div>
              <div className="max-h-60 space-y-2 overflow-auto">
                {lines.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-3 text-xs text-slate-600">
                    No items added yet. Search and add items to build your batch.
                  </p>
                ) : (
                  lines.map((line) => {
                    const quantityValue = Number(line.quantity);
                    const hasQuantityError =
                      !Number.isFinite(quantityValue) ||
                      quantityValue <= 0 ||
                      quantityValue > line.quantityInStock;
                    return (
                      <div
                        key={line.itemId}
                        className={cn(
                          "rounded-lg border border-slate-200 px-2 py-2",
                          hasQuantityError ? "border-red-300 bg-red-50/70" : "bg-slate-50/40"
                        )}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-ink-900">
                              {line.name}
                            </p>
                            <p className="text-xs text-slate-600">
                              {line.sku} • Stock: {formatNumber(line.quantityInStock)}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => removeLine(line.itemId)}
                            className="gf-btn-subtle px-2 py-1 text-[11px]"
                          >
                            Remove
                          </button>
                        </div>
                        <label className="mt-2 block text-xs text-ink-700">
                          <span className="mb-1 block uppercase tracking-wide text-slate-500">
                            Request qty
                          </span>
                          <input
                            type="number"
                            min={1}
                            value={line.quantity}
                            onChange={(event) =>
                              updateLineQuantity(line.itemId, event.target.value)
                            }
                            className="w-full rounded-md border border-slate-200 px-2 py-1 text-sm"
                          />
                        </label>
                      </div>
                    );
                  })
                )}
              </div>
            </section>
          </div>

          {errorMessage ? (
            <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {errorMessage}
            </p>
          ) : null}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-slate-200 px-4 py-3">
          <p className="text-xs text-slate-600">
            Duplicate items are merged automatically in this batch.
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="gf-btn-secondary px-3 py-1.5 text-xs"
              disabled={submitting}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void submitBatchRequest()}
              className="gf-btn-primary px-3 py-1.5 text-xs"
              disabled={submitting}
            >
              {submitting ? "Submitting..." : "Submit batch request"}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

export type SetBatchFormState = Dispatch<SetStateAction<UseRequestBatchFormState>>;
