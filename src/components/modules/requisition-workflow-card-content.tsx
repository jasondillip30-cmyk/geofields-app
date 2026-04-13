"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";

import { Card } from "@/components/ui/card";
import {
  isRequisitionAwaitingReceipt,
  isRequisitionPendingApproval,
  isRequisitionPostedComplete
} from "@/lib/requisition-lifecycle";
import { formatCurrency } from "@/lib/utils";
import {
  RequisitionHistorySection,
  RequisitionStepOneSection,
  RequisitionStepFourSection,
  RequisitionStepProgress,
  RequisitionStepTwoSection,
  RequisitionStepThreeSection,
  RequisitionWizardFooterActions
} from "./requisition-workflow-sections";
import {
  buildReceiptIntakeHref,
  buildRequisitionRowSummary,
  formatIsoDate,
  isMaintenanceRecordOpen,
  normalizeSearchText
} from "./requisition-workflow-helpers";
import { useRequisitionWorkflowAutocomplete } from "./requisition-workflow-autocomplete";
import {
  coerceFormForForcedRequestType,
  deriveForcedRequestType,
  deriveHistoryTypeFilter,
  deriveLockedRequestTypeCard,
  hasRequisitionDraftStarted
} from "./requisition-workflow-mode";
import {
  StatusChip
} from "./requisition-workflow-inputs";
import {
  createInitialFormState,
  type BreakdownLinkOption,
  type InventoryLocationOption,
  type MaintenanceLinkOption,
  type RequisitionCategoryOption,
  type RequisitionRow,
  type RequisitionStatus,
  type RequisitionSubcategoryOption,
  type RequisitionWizardStep,
  type RequisitionWorkflowCardProps
} from "./requisition-workflow-types";
import {
  buildCreateRequisitionPayload,
  buildRequisitionHistorySearchParams,
  validateRequisitionWizardStep
} from "./requisition-workflow-state-utils";


export function RequisitionWorkflowCard({
  filters,
  clients,
  projects,
  rigs,
  initialContext,
  onWorkflowChanged
}: RequisitionWorkflowCardProps) {
  const hasMaintenanceEntryContext = Boolean(initialContext?.maintenanceRequestId?.trim());
  const hasBreakdownEntryContext = Boolean(initialContext?.breakdownId?.trim());
  const isProjectMode = filters.workspaceMode === "project";
  const isWorkshopMode = filters.workspaceMode === "workshop";
  const isProjectLocked = isProjectMode && filters.projectId !== "all";
  const forcedRequestType = deriveForcedRequestType({
    hasBreakdownEntryContext,
    hasMaintenanceEntryContext,
    isProjectMode,
    isWorkshopMode
  });
  const hasPrefilledContext = Boolean(
    initialContext?.projectId || initialContext?.maintenanceRequestId || initialContext?.breakdownId
  );

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<RequisitionStatus | "all">("all");
  const [rows, setRows] = useState<RequisitionRow[]>([]);
  const [setupCategories, setSetupCategories] = useState<RequisitionCategoryOption[]>([]);
  const [setupSubcategories, setSetupSubcategories] = useState<RequisitionSubcategoryOption[]>([]);
  const [breakdownOptions, setBreakdownOptions] = useState<BreakdownLinkOption[]>([]);
  const [_breakdownLoading, setBreakdownLoading] = useState(false);
  const [maintenanceOptions, setMaintenanceOptions] = useState<MaintenanceLinkOption[]>([]);
  const [maintenanceLoading, setMaintenanceLoading] = useState(false);
  const [setupLoading, setSetupLoading] = useState(true);
  const [locationOptions, setLocationOptions] = useState<InventoryLocationOption[]>([]);
  const [form, setForm] = useState(() => createInitialFormState(initialContext));
  const [wizardStep, setWizardStep] = useState<RequisitionWizardStep>(
    hasPrefilledContext || forcedRequestType ? 2 : 1
  );
  const submitInFlightRef = useRef(false);
  const showMaintenanceTypeOption =
    !forcedRequestType && (hasMaintenanceEntryContext || form.type === "MAINTENANCE_PURCHASE");
  const allowProjectPurchaseOption = !forcedRequestType && !isWorkshopMode;
  const allowInventoryStockUpOption = !forcedRequestType && !isProjectMode;
  const minimumWizardStep: RequisitionWizardStep =
    forcedRequestType || hasMaintenanceEntryContext || hasBreakdownEntryContext ? 2 : 1;

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === form.projectId) || null,
    [form.projectId, projects]
  );
  const lockedProject = useMemo(
    () =>
      isProjectLocked
        ? projects.find((project) => project.id === filters.projectId) || null
        : null,
    [filters.projectId, isProjectLocked, projects]
  );
  const historyTypeFilter = deriveHistoryTypeFilter({
    hasMaintenanceEntryContext,
    isProjectMode,
    isWorkshopMode
  });
  const lockedRequestTypeCard = useMemo(
    () =>
      deriveLockedRequestTypeCard({
        hasBreakdownEntryContext,
        hasMaintenanceEntryContext,
        isProjectLocked,
        isProjectMode,
        isWorkshopMode
      }),
    [
    hasBreakdownEntryContext,
    hasMaintenanceEntryContext,
    isProjectLocked,
    isProjectMode,
    isWorkshopMode
    ]
  );
  const derivedClientName = useMemo(
    () =>
      selectedProject
        ? clients.find((client) => client.id === selectedProject.clientId)?.name || "-"
        : "-",
    [clients, selectedProject]
  );
  const derivedRigName = useMemo(
    () =>
      selectedProject?.assignedRigId
        ? rigs.find((rig) => rig.id === selectedProject.assignedRigId)?.name || "-"
        : "-",
    [rigs, selectedProject]
  );
  const selectedLocationName = useMemo(
    () => locationOptions.find((location) => location.id === form.stockLocationId)?.name || "",
    [form.stockLocationId, locationOptions]
  );

  useEffect(() => {
    if (!forcedRequestType) {
      return;
    }

    setForm((current) =>
      coerceFormForForcedRequestType({
        current,
        forcedRequestType,
        filtersProjectId: filters.projectId,
        initialMaintenanceRequestId: initialContext?.maintenanceRequestId?.trim() || "",
        initialProjectId: initialContext?.projectId?.trim() || "",
        isProjectLocked,
        projects
      })
    );
  }, [
    filters.projectId,
    forcedRequestType,
    initialContext?.maintenanceRequestId,
    initialContext?.projectId,
    isProjectLocked,
    projects
  ]);

  const estimatedTotal = useMemo(
    () => {
      const quantity = Number(form.quantity);
      const unitCost = Number(form.estimatedUnitCost);
      if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(unitCost) || unitCost < 0) {
        return 0;
      }
      return quantity * unitCost;
    },
    [form.estimatedUnitCost, form.quantity]
  );

  const validLineItems = useMemo(
    () => {
      const description = form.itemName.trim();
      const quantity = Number(form.quantity);
      const estimatedUnitCost = Number(form.estimatedUnitCost);
      if (
        !description ||
        !Number.isFinite(quantity) ||
        quantity <= 0 ||
        !Number.isFinite(estimatedUnitCost) ||
        estimatedUnitCost < 0
      ) {
        return [];
      }
      const noteParts = [
        form.unit.trim() ? `Unit: ${form.unit.trim()}` : "",
        form.itemNote.trim()
      ].filter(Boolean);
      return [
        {
          id: "line-1",
          description,
          quantity,
          estimatedUnitCost,
          estimatedTotalCost: quantity * estimatedUnitCost,
          notes: noteParts.length > 0 ? noteParts.join(" | ") : null
        }
      ];
    },
    [form.estimatedUnitCost, form.itemName, form.itemNote, form.quantity, form.unit]
  );

  const pendingCount = useMemo(
    () => rows.filter((row) => isRequisitionPendingApproval(row.status)).length,
    [rows]
  );
  const approvedReadyCount = useMemo(
    () => rows.filter((row) => isRequisitionAwaitingReceipt(row.status)).length,
    [rows]
  );
  const completedCount = useMemo(
    () => rows.filter((row) => isRequisitionPostedComplete(row.status)).length,
    [rows]
  );

  const loadRequisitions = useCallback(async () => {
    setLoading(true);
    try {
      const query = buildRequisitionHistorySearchParams({
        filters,
        isProjectLocked,
        statusFilter,
        historyTypeFilter,
        isWorkshopMode,
        hasMaintenanceEntryContext,
        maintenanceRequestId: initialContext?.maintenanceRequestId || ""
      });
      const response = await fetch(`/api/requisitions?${query.toString()}`, {
        cache: "no-store"
      });
      const payload = (await response.json().catch(() => null)) as
        | { data?: RequisitionRow[]; message?: string }
        | null;
      if (!response.ok) {
        throw new Error(payload?.message || "Failed to load requisitions.");
      }
      setRows(Array.isArray(payload?.data) ? payload.data : []);
    } catch (loadError) {
      setRows([]);
      setError(
        loadError instanceof Error ? loadError.message : "Failed to load requisitions."
      );
    } finally {
      setLoading(false);
    }
  }, [
    filters,
    hasMaintenanceEntryContext,
    historyTypeFilter,
    initialContext?.maintenanceRequestId,
    isProjectLocked,
    isWorkshopMode,
    statusFilter
  ]);

  useEffect(() => {
    void loadRequisitions();
  }, [loadRequisitions]);

  const loadRequisitionSetup = useCallback(async () => {
    setSetupLoading(true);
    try {
      const response = await fetch("/api/requisitions/setup", {
        cache: "no-store"
      });
      const payload = (await response.json().catch(() => null)) as
        | {
            data?: {
              categories?: Array<{ id?: string; name?: string }>;
              subcategories?: Array<{ id?: string; name?: string; categoryId?: string }>;
            };
            message?: string;
          }
        | null;
      if (!response.ok) {
        throw new Error(payload?.message || "Failed to load requisition setup.");
      }

      const categories = Array.isArray(payload?.data?.categories)
        ? payload.data.categories
            .map((entry) => ({
              id: typeof entry.id === "string" ? entry.id : "",
              name: typeof entry.name === "string" ? entry.name.trim() : ""
            }))
            .filter((entry) => entry.id && entry.name)
        : [];
      const subcategories = Array.isArray(payload?.data?.subcategories)
        ? payload.data.subcategories
            .map((entry) => ({
              id: typeof entry.id === "string" ? entry.id : "",
              name: typeof entry.name === "string" ? entry.name.trim() : "",
              categoryId: typeof entry.categoryId === "string" ? entry.categoryId : ""
            }))
            .filter((entry) => entry.id && entry.name && entry.categoryId)
        : [];

      setSetupCategories(categories);
      setSetupSubcategories(subcategories);

      setForm((current) => {
        if (current.categoryId) {
          const linked = categories.find((entry) => entry.id === current.categoryId);
          if (linked) {
            return {
              ...current,
              category: linked.name
            };
          }
        }
        if (current.category.trim()) {
          const linked = categories.find(
            (entry) => normalizeSearchText(entry.name) === normalizeSearchText(current.category)
          );
          if (linked) {
            return {
              ...current,
              categoryId: linked.id,
              category: linked.name
            };
          }
        }
        return {
          ...current,
          categoryId: "",
          category: "",
          subcategoryId: "",
          subcategory: ""
        };
      });
    } catch (setupError) {
      setSetupCategories([]);
      setSetupSubcategories([]);
      setError(
        setupError instanceof Error ? setupError.message : "Failed to load requisition setup."
      );
    } finally {
      setSetupLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadRequisitionSetup();
  }, [loadRequisitionSetup]);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/inventory/locations", { cache: "no-store" })
      .then(async (response) => {
        const payload = (await response.json().catch(() => null)) as
          | {
              data?: Array<{
                id: string;
                name: string;
                isActive?: boolean;
              }>;
            }
          | null;
        if (!response.ok || cancelled) {
          return;
        }
        const mapped = Array.isArray(payload?.data)
          ? payload.data
              .filter((entry) => entry.isActive !== false)
              .map((entry) => ({
                id: entry.id,
                name: entry.name,
                isActive: entry.isActive !== false
              }))
          : [];
        setLocationOptions(mapped);
      })
      .catch(() => {
        if (!cancelled) {
          setLocationOptions([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!notice) {
      return;
    }
    const timeout = window.setTimeout(() => setNotice(null), 5000);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  useEffect(() => {
    if (!initialContext?.breakdownId) {
      return;
    }
    setNotice("Breakdown context loaded. This request is linked to that breakdown case.");
  }, [initialContext?.breakdownId]);

  useEffect(() => {
    if (!initialContext?.maintenanceRequestId) {
      return;
    }
    setNotice("Maintenance context loaded. This request can be linked to that maintenance record.");
  }, [initialContext?.maintenanceRequestId]);

  useEffect(() => {
    if (form.type !== "MAINTENANCE_PURCHASE") {
      return;
    }
    if (!form.maintenanceRequestId || form.rigId) {
      return;
    }

    let cancelled = false;
    const maintenanceRequestId = form.maintenanceRequestId;
    void (async () => {
      try {
        const query = new URLSearchParams({
          maintenanceRequestId
        });
        const response = await fetch(`/api/maintenance-requests?${query.toString()}`, {
          cache: "no-store"
        });
        const payload = (await response.json().catch(() => null)) as
          | {
              data?: Array<{
                id?: string;
                rigId?: string;
                projectId?: string | null;
              }>;
            }
          | null;
        if (!response.ok || cancelled) {
          return;
        }
        const matched = Array.isArray(payload?.data) ? payload.data[0] : null;
        const rigId = typeof matched?.rigId === "string" ? matched.rigId : "";
        const projectId =
          typeof matched?.projectId === "string" ? matched.projectId : "";
        if (!rigId) {
          return;
        }

        setForm((current) => {
          if (
            current.type !== "MAINTENANCE_PURCHASE" ||
            current.maintenanceRequestId !== maintenanceRequestId
          ) {
            return current;
          }
          return {
            ...current,
            rigId: current.rigId || rigId,
            projectId: current.projectId || projectId
          };
        });
      } catch {
        // keep manual fallback if context preload fails
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [form.maintenanceRequestId, form.rigId, form.type]);

  useEffect(() => {
    if (form.type !== "LIVE_PROJECT_PURCHASE" || !form.projectId) {
      setBreakdownOptions([]);
      setBreakdownLoading(false);
      return;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      void (async () => {
        setBreakdownLoading(true);
        try {
          const query = new URLSearchParams();
          query.set("projectId", form.projectId);
          query.set("status", "OPEN");
          const response = await fetch(`/api/breakdowns?${query.toString()}`, {
            cache: "no-store",
            signal: controller.signal
          });
          const payload = (await response.json().catch(() => null)) as
            | {
                data?: Array<{
                  id?: string;
                  title?: string;
                  severity?: string;
                  reportDate?: string;
                }>;
              }
            | null;
          if (!response.ok || controller.signal.aborted) {
            setBreakdownOptions([]);
            return;
          }
          const nextOptions = Array.isArray(payload?.data)
            ? payload.data
                .map((entry) => ({
                  id: typeof entry.id === "string" ? entry.id : "",
                  title: typeof entry.title === "string" ? entry.title.trim() : "",
                  severity: typeof entry.severity === "string" ? entry.severity.trim() : "MEDIUM",
                  reportDate:
                    typeof entry.reportDate === "string" ? entry.reportDate : new Date().toISOString()
                }))
                .filter((entry) => entry.id && entry.title)
            : [];
          setBreakdownOptions(nextOptions);
          setForm((current) => {
            if (!current.breakdownReportId) {
              return current;
            }
            const stillExists = nextOptions.some((entry) => entry.id === current.breakdownReportId);
            return stillExists
              ? current
              : {
                  ...current,
                  breakdownReportId: ""
                };
          });
        } catch {
          if (!controller.signal.aborted) {
            setBreakdownOptions([]);
          }
        } finally {
          if (!controller.signal.aborted) {
            setBreakdownLoading(false);
          }
        }
      })();
    }, 120);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [form.projectId, form.type]);

  useEffect(() => {
    if (form.type !== "MAINTENANCE_PURCHASE" || !form.rigId) {
      setMaintenanceOptions([]);
      setMaintenanceLoading(false);
      return;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      void (async () => {
        setMaintenanceLoading(true);
        try {
          const query = new URLSearchParams();
          query.set("rigId", form.rigId);
          const response = await fetch(`/api/maintenance-requests?${query.toString()}`, {
            cache: "no-store",
            signal: controller.signal
          });
          const payload = (await response.json().catch(() => null)) as
            | {
                data?: Array<{
                  id?: string;
                  requestCode?: string;
                  issueDescription?: string;
                  status?: string;
                }>;
              }
            | null;
          if (!response.ok || controller.signal.aborted) {
            setMaintenanceOptions([]);
            return;
          }
          const nextOptions = Array.isArray(payload?.data)
            ? payload.data
                .map((entry) => ({
                  id: typeof entry.id === "string" ? entry.id : "",
                  requestCode:
                    typeof entry.requestCode === "string" ? entry.requestCode.trim() : "",
                  issueDescription:
                    typeof entry.issueDescription === "string"
                      ? entry.issueDescription.trim()
                      : "",
                  status: typeof entry.status === "string" ? entry.status : "SUBMITTED"
                }))
                .filter((entry) => entry.id && entry.requestCode)
                .filter((entry) => isMaintenanceRecordOpen(entry.status))
            : [];
          setMaintenanceOptions(nextOptions);
          setForm((current) => {
            if (nextOptions.length === 1) {
              return {
                ...current,
                maintenanceRequestId: nextOptions[0].id
              };
            }
            if (!current.maintenanceRequestId) {
              return current;
            }
            const exists = nextOptions.some((entry) => entry.id === current.maintenanceRequestId);
            return exists
              ? current
              : {
                  ...current,
                  maintenanceRequestId: ""
                };
          });
        } catch {
          if (!controller.signal.aborted) {
            setMaintenanceOptions([]);
          }
        } finally {
          if (!controller.signal.aborted) {
            setMaintenanceLoading(false);
          }
        }
      })();
    }, 120);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [form.rigId, form.type]);

  const validateStep = useCallback(
    (step: RequisitionWizardStep) => {
      return validateRequisitionWizardStep({
        step,
        form,
        maintenanceLoading,
        maintenanceOptions,
        locationOptions,
        setupLoading,
        setupCategoriesCount: setupCategories.length,
        validLineItemsCount: validLineItems.length
      });
    },
    [
      form,
      locationOptions,
      maintenanceLoading,
      maintenanceOptions,
      setupCategories.length,
      setupLoading,
      validLineItems.length
    ]
  );

  function continueWizard() {
    const validationError = validateStep(wizardStep);
    if (validationError) {
      setError(validationError);
      return;
    }
    setError(null);
    setWizardStep((current) => Math.min(4, current + 1) as RequisitionWizardStep);
  }

  function backWizard() {
    setError(null);
    setWizardStep(
      (current) => Math.max(minimumWizardStep, current - 1) as RequisitionWizardStep
    );
  }

  const createRequisition = useCallback(
    async () => {
      if (saving || submitInFlightRef.current) {
        return;
      }

      setError(null);
      setNotice(null);

      if (wizardStep !== 4) {
        setError("Review the request, then submit.");
        return;
      }

      for (const step of [1, 2, 3] as RequisitionWizardStep[]) {
        const validationError = validateStep(step);
        if (validationError) {
          setWizardStep(step);
          setError(validationError);
          return;
        }
      }

      submitInFlightRef.current = true;
      setSaving(true);
      try {
        const resolvedMaintenanceRequestId =
          form.type === "MAINTENANCE_PURCHASE"
            ? form.maintenanceRequestId || maintenanceOptions[0]?.id || ""
            : "";
        const effectiveProjectId =
          form.type === "LIVE_PROJECT_PURCHASE"
            ? isProjectLocked
              ? filters.projectId
              : form.projectId
            : "";
        const effectiveProject =
          effectiveProjectId
            ? projects.find((project) => project.id === effectiveProjectId) || null
            : null;
        const body = buildCreateRequisitionPayload({
          form,
          selectedLocationName,
          validLineItems,
          resolvedMaintenanceRequestId,
          effectiveProject,
          effectiveProjectId
        });
        const response = await fetch("/api/requisitions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body)
        });

        const payload = (await response.json().catch(() => null)) as
          | { message?: string }
          | null;
        if (!response.ok) {
          throw new Error(payload?.message || "Failed to create requisition.");
        }

        setNotice("Purchase request submitted.");
        setForm(createInitialFormState(initialContext));
        setWizardStep(minimumWizardStep);
        await loadRequisitions();
        if (onWorkflowChanged) {
          await onWorkflowChanged();
        }
      } catch (submitError) {
        setError(
          submitError instanceof Error
            ? submitError.message
            : "Failed to create requisition."
        );
      } finally {
        setSaving(false);
        submitInFlightRef.current = false;
      }
    },
    [
      form,
      initialContext,
      loadRequisitions,
      maintenanceOptions,
      minimumWizardStep,
      onWorkflowChanged,
      saving,
      selectedLocationName,
      filters.projectId,
      isProjectLocked,
      projects,
      validLineItems,
      validateStep,
      wizardStep
    ]
  );

  const requisitionRows = useMemo(
    () =>
      rows.map((row) => {
        const receiptUrl = buildReceiptIntakeHref(row);
        const summary = buildRequisitionRowSummary({
          row,
          projects,
          rigs
        });
        return [
          row.requisitionCode,
          <StatusChip key={`${row.id}-status`} status={row.status} />,
          <div key={`${row.id}-summary`} className="space-y-0.5 text-xs">
            <p className="font-semibold text-slate-800">{summary.primary}</p>
            <p className="text-slate-600">{summary.context}</p>
            <p className="text-slate-600">{summary.items}</p>
          </div>,
          formatCurrency(row.totals.estimatedTotalCost),
          formatIsoDate(row.submittedAt),
          <div key={`${row.id}-actions`} className="flex max-w-[320px] flex-wrap gap-2">
            {isRequisitionAwaitingReceipt(row.status) && (
              <Link
                href={receiptUrl}
                className="rounded-md border border-brand-300 bg-brand-50 px-2 py-1 text-xs font-semibold text-brand-800 hover:bg-brand-100"
              >
                Continue to receipt follow-up
              </Link>
            )}
            {isRequisitionPostedComplete(row.status) && (
              <span className="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700">
                Posted
              </span>
            )}
            {isRequisitionPendingApproval(row.status) && (
              <span className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-800">
                Pending approval
              </span>
            )}
            {row.status === "REJECTED" && (
              <span className="rounded-md border border-rose-200 bg-rose-50 px-2 py-1 text-xs font-semibold text-rose-700">
                Rejected
              </span>
            )}
          </div>
        ];
      }),
    [projects, rigs, rows]
  );
  const categoryOptions = setupCategories;
  const subcategoryOptions = useMemo(
    () =>
      setupSubcategories
        .filter((entry) => entry.categoryId === form.categoryId)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [form.categoryId, setupSubcategories]
  );
  const unitOptions = ["PCS", "SET", "LITER", "KG", "METER", "BOX"];
  const hasStartedRequest = useMemo(
    () =>
      hasRequisitionDraftStarted({
        form,
        minimumWizardStep,
        wizardStep
      }),
    [form, minimumWizardStep, wizardStep]
  );
  const currentStepError = validateStep(wizardStep);
  const requestCardTitle = useMemo(() => {
    if (form.type === "MAINTENANCE_PURCHASE") {
      return "Maintenance Request";
    }
    if (form.type === "LIVE_PROJECT_PURCHASE" && form.breakdownReportId) {
      return "Breakdown-linked Purchase";
    }
    if (form.type === "LIVE_PROJECT_PURCHASE") {
      return "Project Request";
    }
    if (form.type === "INVENTORY_STOCK_UP") {
      return "Inventory Stock-up Request";
    }
    return "New Request";
  }, [form.breakdownReportId, form.type]);
  const {
    activeSuggestionIndex,
    activeSubcategorySuggestionIndex,
    activeVendorSuggestionIndex,
    applyCategorySelection,
    applyInventorySuggestion,
    applySubcategorySuggestion,
    applyVendorSuggestion,
    closeItemSuggestions,
    closeSubcategorySuggestions,
    closeVendorSuggestions,
    createSubcategoryFromInput,
    createVendorFromInput,
    creatingSubcategory,
    creatingVendor,
    filteredSubcategorySuggestions,
    handleItemNameKeyDown,
    handleSubcategoryKeyDown,
    handleVendorNameKeyDown,
    inventorySuggestionLoading,
    inventorySuggestions,
    setActiveSubcategorySuggestionIndex,
    setActiveSuggestionIndex,
    setActiveVendorSuggestionIndex,
    setItemNameFocused,
    setSubcategoryFocused,
    setVendorFocused,
    showCreateSubcategoryOption,
    showCreateVendorOption,
    showItemSuggestions,
    showSubcategorySuggestions,
    showVendorSuggestions,
    vendorSuggestionLoading,
    vendorSuggestions
  } = useRequisitionWorkflowAutocomplete({
    form,
    setForm,
    categoryOptions,
    subcategoryOptions,
    setSetupSubcategories,
    setError,
    setNotice
  });

  return (
    <section id="expenses-requisition-workflow" className="space-y-4">
      {notice && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-emerald-200/90 bg-emerald-50/70 px-3.5 py-2.5 text-sm text-emerald-900 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
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
      {error && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
          {error}
        </div>
      )}

      <Card title={requestCardTitle}>
        <RequisitionStepProgress wizardStep={wizardStep} />

        <form
          onSubmit={(event) => {
            event.preventDefault();
          }}
          className="space-y-3"
        >
          {wizardStep === 1 && (
            <RequisitionStepOneSection
              form={form}
              setForm={setForm}
              lockedRequestTypeCard={lockedRequestTypeCard}
              showMaintenanceTypeOption={showMaintenanceTypeOption}
              allowProjectPurchaseOption={allowProjectPurchaseOption}
              allowInventoryStockUpOption={allowInventoryStockUpOption}
            />
          )}

          {wizardStep === 2 && (
            <RequisitionStepTwoSection
              form={form}
              setForm={setForm}
              rigs={rigs}
              projects={projects}
              hasBreakdownEntryContext={hasBreakdownEntryContext}
              breakdownOptions={breakdownOptions}
              maintenanceOptions={maintenanceOptions}
              maintenanceLoading={maintenanceLoading}
              locationOptions={locationOptions}
              lockProjectContext={isProjectLocked}
              lockedProjectName={lockedProject?.name || "Locked project"}
              derivedClientName={derivedClientName}
              derivedRigName={derivedRigName}
              onVendorFocus={() => setVendorFocused(true)}
              closeVendorSuggestions={closeVendorSuggestions}
              handleVendorNameKeyDown={handleVendorNameKeyDown}
              showVendorSuggestions={showVendorSuggestions}
              vendorSuggestionLoading={vendorSuggestionLoading}
              creatingVendor={creatingVendor}
              vendorSuggestions={vendorSuggestions}
              activeVendorSuggestionIndex={activeVendorSuggestionIndex}
              setActiveVendorSuggestionIndex={setActiveVendorSuggestionIndex}
              applyVendorSuggestion={applyVendorSuggestion}
              showCreateVendorOption={showCreateVendorOption}
              createVendorFromInput={createVendorFromInput}
            />
          )}

          {wizardStep === 3 && (
            <RequisitionStepThreeSection
              form={form}
              setForm={setForm}
              onItemNameFocus={() => setItemNameFocused(true)}
              closeItemSuggestions={closeItemSuggestions}
              handleItemNameKeyDown={handleItemNameKeyDown}
              showItemSuggestions={showItemSuggestions}
              inventorySuggestionLoading={inventorySuggestionLoading}
              inventorySuggestions={inventorySuggestions}
              activeSuggestionIndex={activeSuggestionIndex}
              setActiveSuggestionIndex={setActiveSuggestionIndex}
              applyInventorySuggestion={applyInventorySuggestion}
              unitOptions={unitOptions}
              estimatedTotal={estimatedTotal}
              categoryOptions={categoryOptions}
              setupLoading={setupLoading}
              applyCategorySelection={applyCategorySelection}
              onSubcategoryFocus={() => setSubcategoryFocused(true)}
              closeSubcategorySuggestions={closeSubcategorySuggestions}
              handleSubcategoryKeyDown={handleSubcategoryKeyDown}
              showSubcategorySuggestions={showSubcategorySuggestions}
              filteredSubcategorySuggestions={filteredSubcategorySuggestions}
              activeSubcategorySuggestionIndex={activeSubcategorySuggestionIndex}
              setActiveSubcategorySuggestionIndex={setActiveSubcategorySuggestionIndex}
              applySubcategorySuggestion={applySubcategorySuggestion}
              showCreateSubcategoryOption={showCreateSubcategoryOption}
              createSubcategoryFromInput={createSubcategoryFromInput}
              creatingSubcategory={creatingSubcategory}
            />
          )}

          {wizardStep === 4 && (
            <RequisitionStepFourSection
              form={form}
              rigs={rigs}
              projects={projects}
              selectedLocationName={selectedLocationName}
              derivedClientName={derivedClientName}
              derivedRigName={derivedRigName}
              breakdownOptions={breakdownOptions}
              maintenanceOptions={maintenanceOptions}
              estimatedTotal={estimatedTotal}
            />
          )}

          <RequisitionWizardFooterActions
            wizardStep={wizardStep}
            minimumWizardStep={minimumWizardStep}
            currentStepError={currentStepError}
            saving={saving}
            onBack={backWizard}
            onContinue={continueWizard}
            onSubmit={() => {
              void createRequisition();
            }}
          />
        </form>
      </Card>

      {!hasStartedRequest && (
        <RequisitionHistorySection
          loading={loading}
          rowsCount={rows.length}
          pendingCount={pendingCount}
          approvedReadyCount={approvedReadyCount}
          completedCount={completedCount}
          statusFilter={statusFilter}
          setStatusFilter={setStatusFilter}
          requisitionRows={requisitionRows}
        />
      )}
    </section>
  );
}
