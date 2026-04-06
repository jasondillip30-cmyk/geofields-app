"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";

import type { AnalyticsFilters } from "@/components/layout/analytics-filters-provider";
import { Card } from "@/components/ui/card";
import { DataTable } from "@/components/ui/table";
import {
  isRequisitionAwaitingReceipt,
  isRequisitionPendingApproval,
  isRequisitionPostedComplete
} from "@/lib/requisition-lifecycle";
import { normalizeNameForComparison, normalizeNameForStorage } from "@/lib/name-normalization";
import { formatCurrency } from "@/lib/utils";

type RequisitionType =
  | "LIVE_PROJECT_PURCHASE"
  | "INVENTORY_STOCK_UP"
  | "MAINTENANCE_PURCHASE";
type LiveProjectSpendType = "BREAKDOWN" | "NORMAL_EXPENSE";

type RequisitionStatus =
  | "SUBMITTED"
  | "APPROVED"
  | "REJECTED"
  | "PURCHASE_COMPLETED";

type RequisitionWizardStep = 1 | 2 | 3 | 4;
type MaintenancePriority = "LOW" | "MEDIUM" | "HIGH";
type InventoryReason = "LOW_STOCK" | "RESTOCK" | "EMERGENCY" | "OTHER";

interface RequisitionLineItem {
  id: string;
  description: string;
  quantity: number;
  estimatedUnitCost: number;
  estimatedTotalCost: number;
  notes: string | null;
}

interface RequisitionRow {
  id: string;
  requisitionCode: string;
  type: RequisitionType;
  status: RequisitionStatus;
  liveProjectSpendType: LiveProjectSpendType | null;
  category: string;
  subcategory: string | null;
  categoryId: string | null;
  subcategoryId: string | null;
  requestedVendorId: string | null;
  requestedVendorName: string | null;
  notes: string | null;
  submittedAt: string;
  submittedBy: {
    userId: string;
    name: string;
    role: string;
  };
  context: {
    clientId: string | null;
    projectId: string | null;
    rigId: string | null;
    maintenanceRequestId: string | null;
    breakdownReportId: string | null;
  };
  lineItems: RequisitionLineItem[];
  totals: {
    estimatedTotalCost: number;
    approvedTotalCost: number;
    actualPostedCost: number;
  };
  approval: {
    approvedAt: string | null;
    approvedBy: {
      userId: string;
      name: string;
      role: string;
    } | null;
    rejectedAt: string | null;
    rejectedBy: {
      userId: string;
      name: string;
      role: string;
    } | null;
    rejectionReason: string | null;
    lineItemMode: "FULL_ONLY";
  };
  purchase: {
    receiptSubmissionId: string | null;
    receiptNumber: string | null;
    supplierName: string | null;
    expenseId: string | null;
    movementCount: number;
    postedAt: string | null;
  };
}

interface InventoryLocationOption {
  id: string;
  name: string;
  isActive: boolean;
}

interface InventoryItemSuggestion {
  id: string;
  name: string;
  sku: string;
  category: string;
}

interface VendorSuggestion {
  id: string;
  name: string;
  additionalInfo: string | null;
}

interface RequisitionCategoryOption {
  id: string;
  name: string;
}

interface RequisitionSubcategoryOption {
  id: string;
  name: string;
  categoryId: string;
}

interface BreakdownLinkOption {
  id: string;
  title: string;
  severity: string;
  reportDate: string;
}

interface MaintenanceLinkOption {
  id: string;
  requestCode: string;
  issueDescription: string;
  status: string;
}

interface RequisitionWorkflowCardProps {
  filters: AnalyticsFilters;
  clients: Array<{ id: string; name: string }>;
  projects: Array<{ id: string; name: string; clientId: string; assignedRigId?: string | null }>;
  rigs: Array<{ id: string; name: string }>;
  initialContext?: {
    projectId?: string;
    breakdownId?: string;
    maintenanceRequestId?: string;
  };
  onWorkflowChanged?: () => Promise<void> | void;
}

function createInitialFormState(initialContext?: RequisitionWorkflowCardProps["initialContext"]) {
  const prefilledProjectId = initialContext?.projectId?.trim() || "";
  const prefilledBreakdownId = initialContext?.breakdownId?.trim() || "";
  const prefilledMaintenanceRequestId =
    initialContext?.maintenanceRequestId?.trim() || "";
  const prefilledMaintenancePurchase = prefilledMaintenanceRequestId.length > 0;
  const prefilledBreakdownPurchase =
    !prefilledMaintenancePurchase && prefilledBreakdownId.length > 0;
  const prefilledProjectPurchase =
    !prefilledMaintenancePurchase &&
    !prefilledBreakdownPurchase &&
    prefilledProjectId.length > 0;
  return {
    type: (
      prefilledMaintenancePurchase
        ? "MAINTENANCE_PURCHASE"
        : prefilledBreakdownPurchase || prefilledProjectPurchase
          ? "LIVE_PROJECT_PURCHASE"
          : ""
    ) as RequisitionType | "",
    liveProjectSpendType: "" as LiveProjectSpendType | "",
    clientId: "",
    projectId: prefilledProjectId,
    rigId: "",
    maintenanceRequestId: prefilledMaintenanceRequestId,
    breakdownReportId: prefilledBreakdownId,
    stockLocationId: "",
    maintenancePriority: "" as MaintenancePriority | "",
    inventoryReason: "" as InventoryReason | "",
    categoryId: "",
    category: "",
    subcategoryId: "",
    subcategory: "",
    requestedVendorId: "",
    requestedVendorName: "",
    shortReason: "",
    itemName: "",
    quantity: "1",
    unit: "PCS",
    estimatedUnitCost: "",
    itemNote: ""
  };
}

export function RequisitionWorkflowCard({
  filters,
  clients,
  projects,
  rigs,
  initialContext,
  onWorkflowChanged
}: RequisitionWorkflowCardProps) {
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
  const [inventorySuggestions, setInventorySuggestions] = useState<InventoryItemSuggestion[]>([]);
  const [vendorSuggestions, setVendorSuggestions] = useState<VendorSuggestion[]>([]);
  const [vendorSuggestionLoading, setVendorSuggestionLoading] = useState(false);
  const [vendorSuggestionStatus, setVendorSuggestionStatus] = useState<
    "idle" | "ready" | "empty"
  >("idle");
  const [vendorFocused, setVendorFocused] = useState(false);
  const [activeVendorSuggestionIndex, setActiveVendorSuggestionIndex] = useState(-1);
  const [creatingVendor, setCreatingVendor] = useState(false);
  const [inventorySuggestionLoading, setInventorySuggestionLoading] = useState(false);
  const [inventorySuggestionStatus, setInventorySuggestionStatus] = useState<
    "idle" | "ready" | "empty"
  >("idle");
  const [itemNameFocused, setItemNameFocused] = useState(false);
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(-1);
  const [subcategoryFocused, setSubcategoryFocused] = useState(false);
  const [activeSubcategorySuggestionIndex, setActiveSubcategorySuggestionIndex] = useState(-1);
  const [creatingSubcategory, setCreatingSubcategory] = useState(false);
  const [form, setForm] = useState(() => createInitialFormState(initialContext));
  const hasPrefilledContext = Boolean(
    initialContext?.projectId || initialContext?.maintenanceRequestId || initialContext?.breakdownId
  );
  const [wizardStep, setWizardStep] = useState<RequisitionWizardStep>(
    hasPrefilledContext ? 2 : 1
  );
  const submitInFlightRef = useRef(false);
  const hasMaintenanceEntryContext = Boolean(
    initialContext?.maintenanceRequestId?.trim()
  );
  const hasBreakdownEntryContext = Boolean(initialContext?.breakdownId?.trim());
  const showMaintenanceTypeOption =
    hasMaintenanceEntryContext || form.type === "MAINTENANCE_PURCHASE";
  const minimumWizardStep: RequisitionWizardStep =
    hasMaintenanceEntryContext || hasBreakdownEntryContext ? 2 : 1;

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === form.projectId) || null,
    [form.projectId, projects]
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
      const query = new URLSearchParams();
      if (filters.from) query.set("from", filters.from);
      if (filters.to) query.set("to", filters.to);
      if (filters.clientId !== "all") query.set("clientId", filters.clientId);
      if (filters.rigId !== "all") query.set("rigId", filters.rigId);
      if (statusFilter !== "all") query.set("status", statusFilter);
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
  }, [filters.clientId, filters.from, filters.rigId, filters.to, statusFilter]);

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
    const searchTerm = form.requestedVendorName.trim();
    if (searchTerm.length < 2) {
      setVendorSuggestions([]);
      setVendorSuggestionStatus("idle");
      setVendorSuggestionLoading(false);
      setActiveVendorSuggestionIndex(-1);
      return;
    }

    const controller = new AbortController();
    const normalizedSearchTerm = normalizeSearchText(searchTerm);
    const timeout = window.setTimeout(() => {
      void (async () => {
        setVendorSuggestionLoading(true);
        try {
          const query = new URLSearchParams();
          query.set("search", searchTerm);
          query.set("limit", "6");
          const response = await fetch(`/api/vendors?${query.toString()}`, {
            cache: "no-store",
            signal: controller.signal
          });
          const payload = (await response.json().catch(() => null)) as
            | {
                data?: Array<{
                  id?: string;
                  name?: string;
                  additionalInfo?: string | null;
                }>;
              }
            | null;
          if (!response.ok || controller.signal.aborted) {
            setVendorSuggestions([]);
            setVendorSuggestionStatus("empty");
            return;
          }
          const nextSuggestions = Array.isArray(payload?.data)
            ? payload.data
                .map((entry) => ({
                  id: typeof entry.id === "string" ? entry.id : "",
                  name: typeof entry.name === "string" ? entry.name.trim() : "",
                  additionalInfo:
                    typeof entry.additionalInfo === "string" && entry.additionalInfo.trim().length > 0
                      ? entry.additionalInfo.trim()
                      : null
                }))
                .filter((entry) => entry.id && entry.name)
                .filter((entry) => normalizeSearchText(entry.name).includes(normalizedSearchTerm))
                .slice(0, 6)
            : [];
          setVendorSuggestions(nextSuggestions);
          setVendorSuggestionStatus(nextSuggestions.length > 0 ? "ready" : "empty");
          setActiveVendorSuggestionIndex(-1);
        } catch {
          if (!controller.signal.aborted) {
            setVendorSuggestions([]);
            setVendorSuggestionStatus("empty");
            setActiveVendorSuggestionIndex(-1);
          }
        } finally {
          if (!controller.signal.aborted) {
            setVendorSuggestionLoading(false);
          }
        }
      })();
    }, 220);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [form.requestedVendorName]);

  useEffect(() => {
    const searchTerm = form.itemName.trim();
    if (searchTerm.length < 2) {
      setInventorySuggestions([]);
      setInventorySuggestionStatus("idle");
      setInventorySuggestionLoading(false);
      setActiveSuggestionIndex(-1);
      return;
    }

    const controller = new AbortController();
    const normalizedSearchTerm = normalizeSearchText(searchTerm);
    const timeout = window.setTimeout(() => {
      void (async () => {
        setInventorySuggestionLoading(true);
        try {
          const query = new URLSearchParams();
          query.set("search", searchTerm);
          query.set("status", "ACTIVE");
          const response = await fetch(`/api/inventory/items?${query.toString()}`, {
            cache: "no-store",
            signal: controller.signal
          });
          const payload = (await response.json().catch(() => null)) as
            | {
                data?: Array<{
                  id?: string;
                  name?: string;
                  sku?: string;
                  category?: string;
                }>;
              }
            | null;
          if (!response.ok || controller.signal.aborted) {
            setInventorySuggestions([]);
            setInventorySuggestionStatus("empty");
            return;
          }
          const nextSuggestions = Array.isArray(payload?.data)
            ? payload.data
                .map((entry) => ({
                  id: typeof entry.id === "string" ? entry.id : "",
                  name: typeof entry.name === "string" ? entry.name.trim() : "",
                  sku: typeof entry.sku === "string" ? entry.sku.trim() : "",
                  category:
                    typeof entry.category === "string" && entry.category.trim().length > 0
                      ? entry.category.trim()
                      : "Materials"
                }))
                .filter((entry) => entry.id && entry.name)
                .filter((entry) => {
                  const searchable = normalizeSearchText(
                    `${entry.name} ${entry.sku} ${entry.category}`
                  );
                  return searchable.includes(normalizedSearchTerm);
                })
                .slice(0, 6)
            : [];
          setInventorySuggestions(nextSuggestions);
          setInventorySuggestionStatus(nextSuggestions.length > 0 ? "ready" : "empty");
          setActiveSuggestionIndex(-1);
        } catch {
          if (!controller.signal.aborted) {
            setInventorySuggestions([]);
            setInventorySuggestionStatus("empty");
            setActiveSuggestionIndex(-1);
          }
        } finally {
          if (!controller.signal.aborted) {
            setInventorySuggestionLoading(false);
          }
        }
      })();
    }, 220);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [form.itemName]);

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
      if (step === 1 && !form.type) {
        return "Choose a requisition type to continue.";
      }
      if (step === 2) {
        if (form.type === "LIVE_PROJECT_PURCHASE" && !form.projectId) {
          return form.breakdownReportId
            ? "Breakdown-linked purchases require the linked project context."
            : "Project Purchase requires a project.";
        }
        if (form.type === "MAINTENANCE_PURCHASE" && !form.rigId) {
          return "Maintenance-linked purchases require a rig.";
        }
        if (form.type === "MAINTENANCE_PURCHASE") {
          if (maintenanceLoading) {
            return "Loading open maintenance cases for the selected rig.";
          }
          if (maintenanceOptions.length === 0) {
            return "No open maintenance case exists for this rig. Open a maintenance case first.";
          }
          if (maintenanceOptions.length > 1 && !form.maintenanceRequestId) {
            return "Select which open maintenance case this purchase belongs to.";
          }
        }
        if (
          form.type === "INVENTORY_STOCK_UP" &&
          locationOptions.length > 0 &&
          !form.stockLocationId
        ) {
          return "Inventory Stock-up requires a stock location.";
        }
      }
      if (step === 3 && validLineItems.length === 0) {
        return "Enter item name, quantity, and estimated unit cost.";
      }
      if (step === 3 && setupLoading) {
        return "Loading setup categories.";
      }
      if (step === 3 && setupCategories.length === 0) {
        return "No setup categories are available. Configure categories in setup first.";
      }
      if (step === 3 && !form.categoryId.trim()) {
        return "Category is required.";
      }
      return null;
    },
    [
      form,
      locationOptions.length,
      maintenanceLoading,
      maintenanceOptions.length,
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
        const response = await fetch("/api/requisitions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: form.type,
            liveProjectSpendType:
              form.type === "LIVE_PROJECT_PURCHASE"
                ? form.breakdownReportId
                  ? "BREAKDOWN"
                  : "NORMAL_EXPENSE"
                : null,
            clientId:
              form.type === "LIVE_PROJECT_PURCHASE"
                ? selectedProject?.clientId || null
                : null,
            projectId:
              form.type === "LIVE_PROJECT_PURCHASE"
                ? form.projectId || null
                : null,
            rigId:
              form.type === "MAINTENANCE_PURCHASE"
                ? form.rigId || null
                : form.type === "LIVE_PROJECT_PURCHASE"
                  ? selectedProject?.assignedRigId || null
                  : null,
            maintenanceRequestId:
              form.type === "MAINTENANCE_PURCHASE" && resolvedMaintenanceRequestId
                ? resolvedMaintenanceRequestId
                : null,
            breakdownReportId:
              form.type === "LIVE_PROJECT_PURCHASE" && form.breakdownReportId
                ? form.breakdownReportId
                : null,
            category: form.category,
            subcategory: form.subcategory || null,
            categoryId: form.categoryId || null,
            subcategoryId: form.subcategoryId || null,
            requestedVendorId: form.requestedVendorId || null,
            requestedVendorName: form.requestedVendorName || null,
            notes: buildRequestNote({
              type: form.type,
              shortReason: form.shortReason,
              maintenancePriority: form.maintenancePriority,
              inventoryReason: form.inventoryReason,
              stockLocationName: selectedLocationName
            }),
            lineItems: validLineItems
          })
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
      selectedProject?.assignedRigId,
      selectedProject?.clientId,
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
  const hasStartedRequest = Boolean(form.type) || wizardStep > 1;
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
  const showItemSuggestions =
    itemNameFocused &&
    form.itemName.trim().length >= 2 &&
    (inventorySuggestionLoading || inventorySuggestionStatus !== "idle");
  const showVendorSuggestions =
    vendorFocused &&
    form.requestedVendorName.trim().length >= 2 &&
    (vendorSuggestionLoading || vendorSuggestionStatus !== "idle");
  const showCreateVendorOption =
    showVendorSuggestions &&
    !vendorSuggestionLoading &&
    !creatingVendor &&
    vendorSuggestions.length === 0 &&
    form.requestedVendorName.trim().length >= 2;
  const normalizedSubcategoryQuery = normalizeSearchText(form.subcategory);
  const filteredSubcategorySuggestions = useMemo(
    () =>
      subcategoryOptions
        .filter((subcategory) =>
          normalizeSearchText(subcategory.name).includes(normalizedSubcategoryQuery)
        )
        .slice(0, 6),
    [normalizedSubcategoryQuery, subcategoryOptions]
  );
  const showSubcategorySuggestions =
    subcategoryFocused &&
    form.categoryId.trim().length > 0 &&
    form.subcategory.trim().length >= 1;
  const showCreateSubcategoryOption =
    showSubcategorySuggestions &&
    filteredSubcategorySuggestions.length === 0 &&
    form.subcategory.trim().length >= 1;

  function applyVendorSuggestion(suggestion: VendorSuggestion) {
    setForm((current) => ({
      ...current,
      requestedVendorId: suggestion.id,
      requestedVendorName: suggestion.name
    }));
    setVendorFocused(false);
    setVendorSuggestions([]);
    setVendorSuggestionStatus("idle");
    setActiveVendorSuggestionIndex(-1);
  }

  async function createVendorFromInput() {
    if (creatingVendor) {
      return;
    }
    const candidate = normalizeNameForStorage(form.requestedVendorName);
    if (candidate.length < 2) {
      return;
    }

    setCreatingVendor(true);
    try {
      const response = await fetch("/api/vendors", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ name: candidate, source: "request_flow" })
      });

      const payload = (await response.json().catch(() => null)) as
        | {
            message?: string;
            created?: boolean;
            data?: {
              id?: string;
              name?: string;
              additionalInfo?: string | null;
            };
          }
        | null;

      if (!response.ok) {
        throw new Error(payload?.message || "Failed to create vendor.");
      }

      const createdId = typeof payload?.data?.id === "string" ? payload.data.id : "";
      const createdName = typeof payload?.data?.name === "string" ? payload.data.name.trim() : "";
      if (!createdId || !createdName) {
        throw new Error("Vendor was created but response was invalid.");
      }

      if (payload?.created === false) {
        setNotice("Using existing vendor.");
      }

      applyVendorSuggestion({
        id: createdId,
        name: createdName,
        additionalInfo:
          typeof payload?.data?.additionalInfo === "string" &&
          payload.data.additionalInfo.trim().length > 0
            ? payload.data.additionalInfo.trim()
            : null
      });
    } catch (vendorError) {
      setError(vendorError instanceof Error ? vendorError.message : "Failed to create vendor.");
    } finally {
      setCreatingVendor(false);
    }
  }

  function closeVendorSuggestions() {
    setVendorFocused(false);
    setActiveVendorSuggestionIndex(-1);
  }

  function applyInventorySuggestion(suggestion: InventoryItemSuggestion) {
    const linkedCategory =
      categoryOptions.find(
        (entry) => normalizeSearchText(entry.name) === normalizeSearchText(suggestion.category)
      ) || null;
    setForm((current) => ({
      ...current,
      itemName: suggestion.name,
      categoryId: linkedCategory?.id || current.categoryId,
      category: linkedCategory?.name || current.category,
      subcategoryId: linkedCategory?.id === current.categoryId ? current.subcategoryId : "",
      subcategory: linkedCategory?.id === current.categoryId ? current.subcategory : ""
    }));
    setItemNameFocused(false);
    setInventorySuggestions([]);
    setInventorySuggestionStatus("idle");
    setActiveSuggestionIndex(-1);
  }

  function closeItemSuggestions() {
    setItemNameFocused(false);
    setActiveSuggestionIndex(-1);
  }

  function applySubcategorySuggestion(subcategory: RequisitionSubcategoryOption) {
    setForm((current) => ({
      ...current,
      subcategoryId: subcategory.id,
      subcategory: subcategory.name
    }));
    setSubcategoryFocused(false);
    setActiveSubcategorySuggestionIndex(-1);
  }

  async function createSubcategoryFromInput() {
    if (creatingSubcategory) {
      return;
    }
    const candidate = normalizeNameForStorage(form.subcategory);
    if (!form.categoryId || !candidate) {
      return;
    }

    setCreatingSubcategory(true);
    try {
      const response = await fetch("/api/requisitions/setup", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          action: "create_subcategory",
          categoryId: form.categoryId,
          name: candidate,
          source: "request_flow"
        })
      });
      const payload = (await response.json().catch(() => null)) as
        | {
            message?: string;
            data?: {
              created?: boolean;
              subcategory?: {
                id?: string;
                name?: string;
                categoryId?: string;
              };
            };
          }
        | null;
      if (!response.ok) {
        throw new Error(payload?.message || "Failed to create subcategory.");
      }

      const created = payload?.data?.subcategory;
      const createdId = typeof created?.id === "string" ? created.id : "";
      const createdName = typeof created?.name === "string" ? created.name.trim() : "";
      const createdCategoryId =
        typeof created?.categoryId === "string" ? created.categoryId : form.categoryId;
      if (!createdId || !createdName || !createdCategoryId) {
        throw new Error("Subcategory was created but response was invalid.");
      }
      if (payload?.data?.created === false) {
        setNotice("Using existing subcategory.");
      }

      const createdOption: RequisitionSubcategoryOption = {
        id: createdId,
        name: createdName,
        categoryId: createdCategoryId
      };
      setSetupSubcategories((current) => {
        if (current.some((entry) => entry.id === createdOption.id)) {
          return current;
        }
        return [...current, createdOption];
      });
      applySubcategorySuggestion(createdOption);
    } catch (subcategoryError) {
      setError(
        subcategoryError instanceof Error
          ? subcategoryError.message
          : "Failed to create subcategory."
      );
    } finally {
      setCreatingSubcategory(false);
    }
  }

  function closeSubcategorySuggestions() {
    setSubcategoryFocused(false);
    setActiveSubcategorySuggestionIndex(-1);
  }

  function applyCategorySelection(categoryId: string) {
    const selectedCategory = categoryOptions.find((entry) => entry.id === categoryId) || null;
    setForm((current) => ({
      ...current,
      categoryId: selectedCategory?.id || "",
      category: selectedCategory?.name || "",
      subcategoryId: "",
      subcategory: ""
    }));
    setActiveSubcategorySuggestionIndex(-1);
  }

  function handleVendorNameKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      closeVendorSuggestions();
      return;
    }

    const suggestionCount = vendorSuggestions.length + (showCreateVendorOption ? 1 : 0);
    if (!showVendorSuggestions || suggestionCount === 0) {
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveVendorSuggestionIndex((current) =>
        Math.min(current < 0 ? 0 : current + 1, suggestionCount - 1)
      );
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveVendorSuggestionIndex((current) => Math.max(current - 1, 0));
      return;
    }
    if (event.key === "Enter") {
      if (activeVendorSuggestionIndex >= 0) {
        event.preventDefault();
        const selectedVendor = vendorSuggestions[activeVendorSuggestionIndex];
        if (selectedVendor) {
          applyVendorSuggestion(selectedVendor);
          return;
        }
        if (showCreateVendorOption) {
          void createVendorFromInput();
          return;
        }
      }
      if (showCreateVendorOption && vendorSuggestions.length === 0) {
        event.preventDefault();
        void createVendorFromInput();
      }
    }
  }

  function handleItemNameKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      closeItemSuggestions();
      return;
    }
    if (!showItemSuggestions || inventorySuggestions.length === 0) {
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveSuggestionIndex((current) =>
        Math.min(current < 0 ? 0 : current + 1, inventorySuggestions.length - 1)
      );
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveSuggestionIndex((current) => Math.max(current - 1, 0));
      return;
    }
    if (event.key === "Enter" && activeSuggestionIndex >= 0) {
      event.preventDefault();
      const selected = inventorySuggestions[activeSuggestionIndex];
      if (selected) {
        applyInventorySuggestion(selected);
      }
    }
  }

  function handleSubcategoryKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      closeSubcategorySuggestions();
      return;
    }
    const suggestionCount =
      filteredSubcategorySuggestions.length + (showCreateSubcategoryOption ? 1 : 0);
    if (!showSubcategorySuggestions || suggestionCount === 0) {
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveSubcategorySuggestionIndex((current) =>
        Math.min(current < 0 ? 0 : current + 1, suggestionCount - 1)
      );
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveSubcategorySuggestionIndex((current) => Math.max(current - 1, 0));
      return;
    }
    if (event.key === "Enter") {
      if (activeSubcategorySuggestionIndex >= 0) {
        event.preventDefault();
        const selected = filteredSubcategorySuggestions[activeSubcategorySuggestionIndex];
        if (selected) {
          applySubcategorySuggestion(selected);
          return;
        }
        if (showCreateSubcategoryOption) {
          void createSubcategoryFromInput();
          return;
        }
      }
      if (showCreateSubcategoryOption && filteredSubcategorySuggestions.length === 0) {
        event.preventDefault();
        void createSubcategoryFromInput();
      }
    }
  }

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
        <div className="mb-3 grid gap-2 text-xs sm:grid-cols-2 xl:grid-cols-4">
          {([
            { step: 1, label: "Request type" },
            { step: 2, label: "Request context" },
            { step: 3, label: "Item details" },
            { step: 4, label: "Review" }
          ] as Array<{ step: RequisitionWizardStep; label: string }>).map((entry) => (
            <div
              key={entry.step}
              className={`rounded-lg border px-2 py-1.5 ${
                wizardStep === entry.step
                  ? "border-brand-300 bg-brand-50 text-brand-900"
                  : "border-slate-200 bg-slate-50 text-slate-600"
              }`}
            >
              <p className="font-semibold">{entry.step}. {entry.label}</p>
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
            <div className="space-y-2">
              <p className="text-sm font-semibold text-slate-900">What is this request for?</p>
              {hasBreakdownEntryContext ? (
                <div className="rounded-lg border border-brand-200 bg-brand-50 px-3 py-3 text-sm text-brand-900">
                  <p className="font-semibold">Breakdown-linked Purchase</p>
                  <p className="mt-1 text-xs text-brand-800">
                    This request was opened from a breakdown case.
                  </p>
                </div>
              ) : (
                <div className={`grid gap-2 ${showMaintenanceTypeOption ? "md:grid-cols-3" : "md:grid-cols-2"}`}>
                  {showMaintenanceTypeOption && (
                    <button
                      type="button"
                      onClick={() =>
                        setForm((current) => ({
                          ...current,
                          type: "MAINTENANCE_PURCHASE",
                          liveProjectSpendType: "",
                          clientId: "",
                          projectId: current.projectId,
                          rigId: current.rigId,
                          maintenanceRequestId: current.maintenanceRequestId,
                          breakdownReportId: current.breakdownReportId,
                          stockLocationId: "",
                          inventoryReason: "",
                          maintenancePriority: current.maintenancePriority
                        }))
                      }
                      className={`rounded-lg border px-3 py-3 text-left text-sm ${
                        form.type === "MAINTENANCE_PURCHASE"
                          ? "border-brand-300 bg-brand-50 text-brand-900"
                          : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                      }`}
                    >
                      <p className="font-semibold">Maintenance-linked Purchase</p>
                      <p className="mt-1 text-xs text-slate-600">
                        Available only from a maintenance case.
                      </p>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() =>
                      setForm((current) => ({
                        ...current,
                        type: "LIVE_PROJECT_PURCHASE",
                        liveProjectSpendType: "NORMAL_EXPENSE",
                        projectId: "",
                        clientId: "",
                        rigId: "",
                        maintenanceRequestId: "",
                        breakdownReportId: "",
                        stockLocationId: "",
                        inventoryReason: "",
                        maintenancePriority: ""
                      }))
                    }
                    className={`rounded-lg border px-3 py-3 text-left text-sm ${
                      form.type === "LIVE_PROJECT_PURCHASE"
                        ? "border-brand-300 bg-brand-50 text-brand-900"
                        : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                    }`}
                  >
                    <p className="font-semibold">Project Purchase</p>
                    <p className="mt-1 text-xs text-slate-600">Purchase linked to a project.</p>
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setForm((current) => ({
                        ...current,
                        type: "INVENTORY_STOCK_UP",
                        liveProjectSpendType: "",
                        projectId: "",
                        clientId: "",
                        rigId: "",
                        maintenanceRequestId: "",
                        breakdownReportId: "",
                        stockLocationId: "",
                        inventoryReason: "",
                        maintenancePriority: ""
                      }))
                    }
                    className={`rounded-lg border px-3 py-3 text-left text-sm ${
                      form.type === "INVENTORY_STOCK_UP"
                        ? "border-brand-300 bg-brand-50 text-brand-900"
                        : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                    }`}
                  >
                    <p className="font-semibold">Inventory Stock-up</p>
                    <p className="mt-1 text-xs text-slate-600">
                      Replenish stock for warehouse/site use.
                    </p>
                  </button>
                </div>
              )}
            </div>
          )}

          {wizardStep === 2 && (
            <div className="space-y-3">
              {form.type === "MAINTENANCE_PURCHASE" && (
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  <SelectInput
                    label="Rig"
                    value={form.rigId}
                    onChange={(value) =>
                      setForm((current) => ({
                        ...current,
                        rigId: value,
                        maintenanceRequestId:
                          current.rigId === value ? current.maintenanceRequestId : ""
                      }))
                    }
                    options={[
                      { value: "", label: "Select rig" },
                      ...rigs.map((rig) => ({ value: rig.id, label: rig.name }))
                    ]}
                  />
                  <VendorTypeaheadInput
                    value={form.requestedVendorName}
                    onChange={(value) =>
                      setForm((current) => ({
                        ...current,
                        requestedVendorName: value,
                        requestedVendorId: ""
                      }))
                    }
                    onFocus={() => setVendorFocused(true)}
                    onBlur={() => {
                      window.setTimeout(() => closeVendorSuggestions(), 120);
                    }}
                    onKeyDown={handleVendorNameKeyDown}
                    showSuggestions={showVendorSuggestions}
                    loading={vendorSuggestionLoading || creatingVendor}
                    suggestions={vendorSuggestions}
                    activeSuggestionIndex={activeVendorSuggestionIndex}
                    onSuggestionHover={setActiveVendorSuggestionIndex}
                    onSuggestionSelect={applyVendorSuggestion}
                    showCreateOption={showCreateVendorOption}
                    onCreateOptionSelect={() => {
                      void createVendorFromInput();
                    }}
                  />
                  {form.rigId && maintenanceOptions.length === 1 && !maintenanceLoading ? (
                    <label className="text-sm text-ink-700">
                      Linked maintenance case
                      <input
                        value={`${maintenanceOptions[0].requestCode} (auto-linked)`}
                        readOnly
                        className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700"
                      />
                    </label>
                  ) : (
                    <SelectInput
                      label="Linked maintenance case"
                      value={form.maintenanceRequestId}
                      onChange={(value) =>
                        setForm((current) => ({
                          ...current,
                          maintenanceRequestId: value
                        }))
                      }
                      disabled={!form.rigId || maintenanceLoading}
                      options={[
                        {
                          value: "",
                          label:
                            !form.rigId
                              ? "Select rig first"
                              : maintenanceLoading
                                ? "Loading maintenance requests..."
                                : maintenanceOptions.length > 0
                                  ? "Select maintenance case"
                                  : "No open maintenance case"
                        },
                        ...maintenanceOptions.map((entry) => ({
                          value: entry.id,
                          label: `${entry.requestCode} - ${
                            entry.issueDescription || "Maintenance case"
                          }`
                        }))
                      ]}
                    />
                  )}
                  <SelectInput
                    label="Priority"
                    value={form.maintenancePriority}
                    onChange={(value) =>
                      setForm((current) => ({
                        ...current,
                        maintenancePriority: (value as MaintenancePriority | "") || ""
                      }))
                    }
                    options={[
                      { value: "", label: "No priority" },
                      { value: "LOW", label: "Low" },
                      { value: "MEDIUM", label: "Medium" },
                      { value: "HIGH", label: "High" }
                    ]}
                  />
                  <TextInput
                    label="Short reason"
                    value={form.shortReason}
                    onChange={(value) => setForm((current) => ({ ...current, shortReason: value }))}
                  />
                  {form.rigId && !maintenanceLoading && maintenanceOptions.length === 0 && (
                    <p className="md:col-span-2 xl:col-span-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                      No open maintenance case exists for this rig. Report maintenance first, then
                      create a maintenance-linked purchase request.
                    </p>
                  )}
                  {form.rigId &&
                    !maintenanceLoading &&
                    maintenanceOptions.length > 1 &&
                    !form.maintenanceRequestId && (
                      <p className="md:col-span-2 xl:col-span-4 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
                        Multiple open maintenance cases found. Select the case this purchase
                        belongs to.
                      </p>
                    )}
                </div>
              )}

              {form.type === "LIVE_PROJECT_PURCHASE" && (
                <div className="space-y-3">
                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                    <SelectInput
                      label="Project"
                      value={form.projectId}
                      onChange={(value) => {
                        const nextProject = projects.find((project) => project.id === value);
                        setForm((current) => ({
                          ...current,
                          projectId: value,
                          clientId: nextProject?.clientId || "",
                          rigId: nextProject?.assignedRigId || "",
                          breakdownReportId:
                            current.projectId === value ? current.breakdownReportId : ""
                        }));
                      }}
                      disabled={
                        hasBreakdownEntryContext &&
                        Boolean(form.breakdownReportId) &&
                        Boolean(form.projectId)
                      }
                      options={[
                        { value: "", label: "Select project" },
                        ...projects.map((project) => ({ value: project.id, label: project.name }))
                      ]}
                    />
                    <VendorTypeaheadInput
                      value={form.requestedVendorName}
                      onChange={(value) =>
                        setForm((current) => ({
                          ...current,
                          requestedVendorName: value,
                          requestedVendorId: ""
                        }))
                      }
                      onFocus={() => setVendorFocused(true)}
                      onBlur={() => {
                        window.setTimeout(() => closeVendorSuggestions(), 120);
                      }}
                      onKeyDown={handleVendorNameKeyDown}
                      showSuggestions={showVendorSuggestions}
                      loading={vendorSuggestionLoading || creatingVendor}
                      suggestions={vendorSuggestions}
                      activeSuggestionIndex={activeVendorSuggestionIndex}
                      onSuggestionHover={setActiveVendorSuggestionIndex}
                      onSuggestionSelect={applyVendorSuggestion}
                      showCreateOption={showCreateVendorOption}
                      onCreateOptionSelect={() => {
                        void createVendorFromInput();
                      }}
                    />
                    {hasBreakdownEntryContext ? (
                      <label className="text-sm text-ink-700">
                        Linked breakdown
                        <input
                          value={
                            breakdownOptions.find(
                              (entry) => entry.id === form.breakdownReportId
                            )
                              ? `${
                                  breakdownOptions.find(
                                    (entry) => entry.id === form.breakdownReportId
                                  )?.title
                                } (context linked)`
                              : form.breakdownReportId || "Loading breakdown context..."
                          }
                          readOnly
                          className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700"
                        />
                      </label>
                    ) : null}
                    <TextInput
                      label="Short reason"
                      value={form.shortReason}
                      onChange={(value) => setForm((current) => ({ ...current, shortReason: value }))}
                    />
                  </div>
                  {form.projectId && (
                    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
                      <p>
                        <span className="font-semibold">Client context:</span> {derivedClientName}
                      </p>
                      <p>
                        <span className="font-semibold">Rig context:</span> {derivedRigName}
                      </p>
                      {form.breakdownReportId && (
                        <p>
                          <span className="font-semibold">Linked breakdown:</span>{" "}
                          {breakdownOptions.find((entry) => entry.id === form.breakdownReportId)?.title ||
                            form.breakdownReportId}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}

              {form.type === "INVENTORY_STOCK_UP" && (
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  {locationOptions.length > 0 ? (
                    <SelectInput
                      label="Warehouse / Stock Location"
                      value={form.stockLocationId}
                      onChange={(value) =>
                        setForm((current) => ({ ...current, stockLocationId: value }))
                      }
                      options={[
                        { value: "", label: "Select location" },
                        ...locationOptions.map((location) => ({
                          value: location.id,
                          label: location.name
                        }))
                      ]}
                    />
                  ) : (
                    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
                      No active stock location is configured yet.
                    </div>
                  )}
                  <VendorTypeaheadInput
                    value={form.requestedVendorName}
                    onChange={(value) =>
                      setForm((current) => ({
                        ...current,
                        requestedVendorName: value,
                        requestedVendorId: ""
                      }))
                    }
                    onFocus={() => setVendorFocused(true)}
                    onBlur={() => {
                      window.setTimeout(() => closeVendorSuggestions(), 120);
                    }}
                    onKeyDown={handleVendorNameKeyDown}
                    showSuggestions={showVendorSuggestions}
                    loading={vendorSuggestionLoading || creatingVendor}
                    suggestions={vendorSuggestions}
                    activeSuggestionIndex={activeVendorSuggestionIndex}
                    onSuggestionHover={setActiveVendorSuggestionIndex}
                    onSuggestionSelect={applyVendorSuggestion}
                    showCreateOption={showCreateVendorOption}
                    onCreateOptionSelect={() => {
                      void createVendorFromInput();
                    }}
                  />
                  <SelectInput
                    label="Reason"
                    value={form.inventoryReason}
                    onChange={(value) =>
                      setForm((current) => ({
                        ...current,
                        inventoryReason: (value as InventoryReason | "") || ""
                      }))
                    }
                    options={[
                      { value: "", label: "No reason" },
                      { value: "LOW_STOCK", label: "Low stock" },
                      { value: "RESTOCK", label: "Restock" },
                      { value: "EMERGENCY", label: "Emergency" },
                      { value: "OTHER", label: "Other" }
                    ]}
                  />
                  <TextInput
                    label="Short reason"
                    value={form.shortReason}
                    onChange={(value) => setForm((current) => ({ ...current, shortReason: value }))}
                  />
                </div>
              )}
            </div>
          )}

          {wizardStep === 3 && (
            <div className="space-y-3">
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                <label className="text-sm text-ink-700">
                  <span className="mb-1 block">Item name</span>
                  <div className="relative">
                    <input
                      value={form.itemName}
                      onChange={(event) =>
                        setForm((current) => ({ ...current, itemName: event.target.value }))
                      }
                      onFocus={() => setItemNameFocused(true)}
                      onBlur={() => {
                        window.setTimeout(() => closeItemSuggestions(), 120);
                      }}
                      onKeyDown={handleItemNameKeyDown}
                      aria-haspopup="listbox"
                      aria-controls="requisition-item-suggestion-list"
                      className="w-full rounded-lg border border-slate-200 px-3 py-2"
                    />
                    {showItemSuggestions && (
                      <div className="absolute z-30 mt-1 w-full overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg">
                        {inventorySuggestionLoading ? (
                          <p className="px-3 py-2 text-xs text-slate-600">Searching inventory...</p>
                        ) : inventorySuggestions.length > 0 ? (
                          <ul id="requisition-item-suggestion-list" role="listbox" className="max-h-52 overflow-auto py-1.5">
                            {inventorySuggestions.map((suggestion, index) => (
                              <li key={suggestion.id}>
                                <button
                                  type="button"
                                  onMouseDown={(event) => {
                                    event.preventDefault();
                                    applyInventorySuggestion(suggestion);
                                  }}
                                  onMouseEnter={() => setActiveSuggestionIndex(index)}
                                  className={`w-full px-3 py-2 text-left ${
                                    activeSuggestionIndex === index
                                      ? "bg-slate-100"
                                      : "hover:bg-slate-50"
                                  }`}
                                >
                                  <p className="text-sm font-medium text-slate-900">{suggestion.name}</p>
                                  <p className="text-xs text-slate-600">
                                    {suggestion.sku ? `${suggestion.sku} • ` : ""}
                                    {suggestion.category}
                                  </p>
                                </button>
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p className="px-3 py-2 text-xs text-slate-600">No matching inventory item.</p>
                        )}
                      </div>
                    )}
                  </div>
                </label>
                <label className="text-sm text-ink-700">
                  <span className="mb-1 block">Quantity</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.quantity}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, quantity: event.target.value }))
                    }
                    className="w-full rounded-lg border border-slate-200 px-3 py-2"
                  />
                </label>
                <label className="text-sm text-ink-700">
                  <span className="mb-1 block">Unit</span>
                  <input
                    list="requisition-unit-options"
                    value={form.unit}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, unit: event.target.value }))
                    }
                    className="w-full rounded-lg border border-slate-200 px-3 py-2"
                  />
                  <datalist id="requisition-unit-options">
                    {unitOptions.map((unit) => (
                      <option key={unit} value={unit} />
                    ))}
                  </datalist>
                </label>
                <label className="text-sm text-ink-700">
                  <span className="mb-1 block">Estimated unit cost</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.estimatedUnitCost}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        estimatedUnitCost: event.target.value
                      }))
                    }
                    className="w-full rounded-lg border border-slate-200 px-3 py-2"
                  />
                </label>
                <label className="text-sm text-ink-700">
                  <span className="mb-1 block">Category</span>
                  <select
                    value={form.categoryId}
                    onChange={(event) => applyCategorySelection(event.target.value)}
                    disabled={setupLoading || categoryOptions.length === 0}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 disabled:bg-slate-100"
                  >
                    <option value="">
                      {setupLoading
                        ? "Loading categories..."
                        : categoryOptions.length === 0
                          ? "No setup categories"
                          : "Select category"}
                    </option>
                    {categoryOptions.map((category) => (
                      <option key={category.id} value={category.id}>
                        {category.name}
                      </option>
                    ))}
                  </select>
                  {!setupLoading && categoryOptions.length === 0 && (
                    <p className="mt-1 text-xs text-amber-800">
                      No categories are configured in setup yet. Add setup categories before submitting requests.
                    </p>
                  )}
                </label>
                <label className="text-sm text-ink-700">
                  <span className="mb-1 block">Subcategory</span>
                  <div className="relative">
                    <input
                      disabled={!form.categoryId}
                      value={form.subcategory}
                      onChange={(event) => {
                        setForm((current) => ({
                          ...current,
                          subcategory: event.target.value,
                          subcategoryId: ""
                        }));
                        setActiveSubcategorySuggestionIndex(-1);
                      }}
                      onFocus={() => setSubcategoryFocused(true)}
                      onBlur={() => {
                        window.setTimeout(() => closeSubcategorySuggestions(), 120);
                      }}
                      onKeyDown={handleSubcategoryKeyDown}
                      aria-haspopup="listbox"
                      aria-controls="requisition-subcategory-suggestion-list"
                      placeholder={form.categoryId ? "Search or enter subcategory" : "Select category first"}
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 disabled:bg-slate-100"
                    />
                    {showSubcategorySuggestions && (
                      <div className="absolute z-30 mt-1 w-full overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg">
                        {filteredSubcategorySuggestions.length > 0 ? (
                          <ul
                            id="requisition-subcategory-suggestion-list"
                            role="listbox"
                            className="max-h-48 overflow-auto py-1.5"
                          >
                            {filteredSubcategorySuggestions.map((subcategory, index) => (
                              <li key={subcategory.id}>
                                <button
                                  type="button"
                                  onMouseDown={(event) => {
                                    event.preventDefault();
                                    applySubcategorySuggestion(subcategory);
                                  }}
                                  onMouseEnter={() => setActiveSubcategorySuggestionIndex(index)}
                                  className={`w-full px-3 py-2 text-left text-sm ${
                                    activeSubcategorySuggestionIndex === index
                                      ? "bg-slate-100 text-slate-900"
                                      : "text-slate-700 hover:bg-slate-50"
                                  }`}
                                >
                                  {subcategory.name}
                                </button>
                              </li>
                            ))}
                          </ul>
                        ) : showCreateSubcategoryOption ? (
                          <div className="py-1.5">
                            <button
                              type="button"
                              onMouseDown={(event) => {
                                event.preventDefault();
                                void createSubcategoryFromInput();
                              }}
                              onMouseEnter={() => setActiveSubcategorySuggestionIndex(0)}
                              className={`w-full px-3 py-2 text-left text-sm ${
                                activeSubcategorySuggestionIndex === 0
                                  ? "bg-slate-100 text-slate-900"
                                  : "text-slate-700 hover:bg-slate-50"
                              }`}
                            >
                              {creatingSubcategory
                                ? "Creating subcategory..."
                                : `+ Create "${form.subcategory.trim()}"`}
                            </button>
                          </div>
                        ) : (
                          <p className="px-3 py-2 text-xs text-slate-600">No matching subcategory.</p>
                        )}
                      </div>
                    )}
                  </div>
                </label>
              </div>
              <label className="text-sm text-ink-700">
                <span className="mb-1 block">Optional note</span>
                <textarea
                  value={form.itemNote}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, itemNote: event.target.value }))
                  }
                  className="w-full rounded-lg border border-slate-200 px-3 py-2"
                  rows={2}
                />
              </label>
              <p className="text-sm text-slate-700">
                Estimated cost: <span className="font-semibold">{formatCurrency(estimatedTotal)}</span>
              </p>
            </div>
          )}

          {wizardStep === 4 && (
            <div className="space-y-3">
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                <p>
                  <span className="font-semibold">Request type:</span>{" "}
                  {formatRequisitionType(form.type, {
                    breakdownLinked:
                      form.type === "LIVE_PROJECT_PURCHASE" && Boolean(form.breakdownReportId)
                  })}
                </p>
                <p>
                  <span className="font-semibold">Context:</span>{" "}
                  {form.type === "MAINTENANCE_PURCHASE"
                    ? rigs.find((rig) => rig.id === form.rigId)?.name || "-"
                    : form.type === "LIVE_PROJECT_PURCHASE"
                      ? projects.find((project) => project.id === form.projectId)?.name || "-"
                      : selectedLocationName || "-"}
                </p>
                {form.type === "LIVE_PROJECT_PURCHASE" && (
                  <>
                    <p>
                      <span className="font-semibold">Client context:</span> {derivedClientName}
                    </p>
                    <p>
                      <span className="font-semibold">Rig context:</span> {derivedRigName}
                    </p>
                    {form.breakdownReportId && (
                      <p>
                        <span className="font-semibold">Linked breakdown:</span>{" "}
                        {breakdownOptions.find((entry) => entry.id === form.breakdownReportId)?.title ||
                          form.breakdownReportId}
                      </p>
                    )}
                  </>
                )}
                {form.type === "MAINTENANCE_PURCHASE" && form.maintenancePriority && (
                  <p>
                    <span className="font-semibold">Priority:</span>{" "}
                    {formatMaintenancePriorityLabel(form.maintenancePriority)}
                  </p>
                )}
                {form.type === "MAINTENANCE_PURCHASE" && form.maintenanceRequestId && (
                  <p>
                    <span className="font-semibold">Linked maintenance:</span>{" "}
                    {maintenanceOptions.find(
                      (entry) => entry.id === form.maintenanceRequestId
                    )?.requestCode || form.maintenanceRequestId}
                  </p>
                )}
                {form.type === "INVENTORY_STOCK_UP" && form.inventoryReason && (
                  <p>
                    <span className="font-semibold">Reason:</span>{" "}
                    {formatInventoryReasonLabel(form.inventoryReason)}
                  </p>
                )}
                {form.shortReason.trim() && (
                  <p>
                    <span className="font-semibold">Reason:</span> {form.shortReason.trim()}
                  </p>
                )}
                {form.requestedVendorName.trim() && (
                  <p>
                    <span className="font-semibold">Vendor:</span> {form.requestedVendorName.trim()}
                  </p>
                )}
                <p>
                  <span className="font-semibold">Item:</span> {form.itemName.trim() || "-"}
                </p>
                <p>
                  <span className="font-semibold">Quantity:</span> {form.quantity || "-"} {form.unit || ""}
                </p>
                <p>
                  <span className="font-semibold">Estimated unit cost:</span>{" "}
                  {form.estimatedUnitCost ? formatCurrency(Number(form.estimatedUnitCost) || 0) : "-"}
                </p>
                <p>
                  <span className="font-semibold">Category:</span> {form.category || "-"}
                  {form.subcategory ? ` / ${form.subcategory}` : ""}
                </p>
                {form.itemNote.trim() && (
                  <p>
                    <span className="font-semibold">Item note:</span> {form.itemNote.trim()}
                  </p>
                )}
                <p>
                  <span className="font-semibold">Estimated cost:</span> {formatCurrency(estimatedTotal)}
                </p>
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2 border-t border-slate-200 pt-3">
            {wizardStep > minimumWizardStep && (
              <button
                type="button"
                onClick={backWizard}
                className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
              >
                Back
              </button>
            )}
            {wizardStep < 4 ? (
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
                  void createRequisition();
                }}
                disabled={saving}
                className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
              >
                {saving ? "Submitting..." : "Submit request"}
              </button>
            )}
            {wizardStep < 4 && currentStepError && (
              <p className="text-xs text-amber-800">{currentStepError}</p>
            )}
          </div>
        </form>
      </Card>

      {!hasStartedRequest && (
        <details open className="rounded-xl border border-slate-200 bg-white">
          <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-slate-800">
            Requisition History
          </summary>
          <div className="space-y-3 border-t border-slate-200 p-4">
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-700">
              <span className="rounded-full border border-amber-300 bg-amber-100 px-2 py-0.5 font-semibold text-amber-800">
                Pending approval: {pendingCount}
              </span>
              <span className="rounded-full border border-indigo-300 bg-indigo-100 px-2 py-0.5 font-semibold text-indigo-800">
                Approved, awaiting receipt: {approvedReadyCount}
              </span>
              <span className="rounded-full border border-emerald-300 bg-emerald-100 px-2 py-0.5 font-semibold text-emerald-800">
                Posted cost complete: {completedCount}
              </span>
              <label className="ml-auto flex items-center gap-2">
                <span className="uppercase tracking-wide text-slate-500">Status</span>
                <select
                  value={statusFilter}
                  onChange={(event) =>
                    setStatusFilter(
                      event.target.value === "all"
                        ? "all"
                        : (event.target.value as RequisitionStatus)
                    )
                  }
                  className="rounded border border-slate-300 bg-white px-2 py-1 text-xs"
                >
                  <option value="all">All</option>
                  <option value="SUBMITTED">Submitted</option>
                  <option value="APPROVED">Approved</option>
                  <option value="REJECTED">Rejected</option>
                  <option value="PURCHASE_COMPLETED">Purchase completed</option>
                </select>
              </label>
            </div>
            {loading ? (
              <p className="text-sm text-slate-600">Loading requisitions...</p>
            ) : rows.length === 0 ? (
              <p className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-3 text-sm text-slate-700">
                No requisitions found for the selected filters.
              </p>
            ) : (
              <DataTable
                columns={[
                  "Requisition",
                  "Status",
                  "Summary",
                  "Estimated",
                  "Submitted",
                  "Actions"
                ]}
                rows={requisitionRows}
              />
            )}
          </div>
        </details>
      )}
    </section>
  );
}

function SelectInput({
  label,
  value,
  onChange,
  options,
  disabled = false
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  disabled?: boolean;
}) {
  return (
    <label className="text-sm text-ink-700">
      <span className="mb-1 block">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        className="w-full rounded-lg border border-slate-200 px-3 py-2 disabled:bg-slate-100"
      >
        {options.map((option) => (
          <option key={`${label}-${option.value}`} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function TextInput({
  label,
  value,
  onChange,
  required = false
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
}) {
  return (
    <label className="text-sm text-ink-700">
      <span className="mb-1 block">{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        required={required}
        className="w-full rounded-lg border border-slate-200 px-3 py-2"
      />
    </label>
  );
}

function VendorTypeaheadInput({
  value,
  onChange,
  onFocus,
  onBlur,
  onKeyDown,
  showSuggestions,
  loading,
  suggestions,
  activeSuggestionIndex,
  onSuggestionHover,
  onSuggestionSelect,
  showCreateOption,
  onCreateOptionSelect
}: {
  value: string;
  onChange: (value: string) => void;
  onFocus: () => void;
  onBlur: () => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void;
  showSuggestions: boolean;
  loading: boolean;
  suggestions: VendorSuggestion[];
  activeSuggestionIndex: number;
  onSuggestionHover: (index: number) => void;
  onSuggestionSelect: (vendor: VendorSuggestion) => void;
  showCreateOption: boolean;
  onCreateOptionSelect: () => void;
}) {
  return (
    <label className="text-sm text-ink-700">
      <span className="mb-1 block">Vendor</span>
      <div className="relative">
        <input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onFocus={onFocus}
          onBlur={onBlur}
          onKeyDown={onKeyDown}
          aria-haspopup="listbox"
          aria-controls="requisition-vendor-suggestion-list"
          className="w-full rounded-lg border border-slate-200 px-3 py-2"
        />
        {showSuggestions && (
          <div className="absolute z-30 mt-1 w-full overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg">
            {loading ? (
              <p className="px-3 py-2 text-xs text-slate-600">Searching vendors...</p>
            ) : suggestions.length > 0 ? (
              <ul id="requisition-vendor-suggestion-list" role="listbox" className="max-h-52 overflow-auto py-1.5">
                {suggestions.map((suggestion, index) => (
                  <li key={suggestion.id}>
                    <button
                      type="button"
                      onMouseDown={(event) => {
                        event.preventDefault();
                        onSuggestionSelect(suggestion);
                      }}
                      onMouseEnter={() => onSuggestionHover(index)}
                      className={`w-full px-3 py-2 text-left ${
                        activeSuggestionIndex === index ? "bg-slate-100" : "hover:bg-slate-50"
                      }`}
                    >
                      <p className="text-sm font-medium text-slate-900">{suggestion.name}</p>
                      {suggestion.additionalInfo && (
                        <p className="text-xs text-slate-600">{suggestion.additionalInfo}</p>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            ) : showCreateOption ? (
              <div className="py-1.5">
                <button
                  type="button"
                  onMouseDown={(event) => {
                    event.preventDefault();
                    onCreateOptionSelect();
                  }}
                  onMouseEnter={() => onSuggestionHover(0)}
                  className={`w-full px-3 py-2 text-left text-sm ${
                    activeSuggestionIndex === 0 ? "bg-slate-100 text-slate-900" : "text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  + Create &quot;{value.trim()}&quot; as new vendor
                </button>
              </div>
            ) : (
              <p className="px-3 py-2 text-xs text-slate-600">No matching vendor.</p>
            )}
          </div>
        )}
      </div>
    </label>
  );
}

function buildRequisitionRowSummary({
  row,
  projects,
  rigs
}: {
  row: RequisitionRow;
  projects: Array<{ id: string; name: string }>;
  rigs: Array<{ id: string; name: string }>;
}) {
  const typeLabel = formatRequisitionType(row.type, {
    breakdownLinked: row.type === "LIVE_PROJECT_PURCHASE" && Boolean(row.context.breakdownReportId)
  });
  const projectName = row.context.projectId ? lookupProjectName(projects, row.context.projectId) : "";
  const rigName = row.context.rigId ? lookupRigName(rigs, row.context.rigId) : "";
  const firstLine = row.lineItems[0]?.description?.trim() || "";
  const extraLines = Math.max(0, row.lineItems.length - 1);
  const contextTokens =
    row.type === "LIVE_PROJECT_PURCHASE"
      ? [
          projectName ? `Project: ${projectName}` : "",
          rigName ? `Rig context: ${rigName}` : "",
          row.context.breakdownReportId ? "Breakdown-linked" : ""
        ]
      : [
          projectName ? `Project: ${projectName}` : "",
          rigName ? `Rig: ${rigName}` : "",
          row.context.maintenanceRequestId ? "Maintenance-linked" : ""
        ];

  return {
    primary: typeLabel,
    context:
      contextTokens.filter(Boolean).join(" • ") ||
      (row.type === "LIVE_PROJECT_PURCHASE"
        ? "No linked project context"
        : "No linked project/rig context"),
    items: firstLine
      ? `${firstLine}${extraLines > 0 ? ` +${extraLines} more item${extraLines > 1 ? "s" : ""}` : ""}`
      : `${row.category}${row.subcategory ? ` / ${row.subcategory}` : ""}`
  };
}

function formatRequisitionType(
  type: RequisitionType | "",
  options?: { breakdownLinked?: boolean }
) {
  if (!type) return "-";
  if (type === "LIVE_PROJECT_PURCHASE") {
    return options?.breakdownLinked ? "Breakdown-linked Purchase" : "Project Purchase";
  }
  if (type === "MAINTENANCE_PURCHASE") return "Maintenance-linked Purchase";
  return "Inventory Stock-up";
}

function lookupProjectName(
  projects: Array<{ id: string; name: string }>,
  projectId: string
) {
  return projects.find((project) => project.id === projectId)?.name || projectId;
}

function lookupRigName(rigs: Array<{ id: string; name: string }>, rigId: string) {
  return rigs.find((rig) => rig.id === rigId)?.name || rigId;
}

function buildRequestNote({
  type,
  shortReason,
  maintenancePriority,
  inventoryReason,
  stockLocationName
}: {
  type: RequisitionType | "";
  shortReason: string;
  maintenancePriority: MaintenancePriority | "";
  inventoryReason: InventoryReason | "";
  stockLocationName: string;
}) {
  const parts: string[] = [];
  if (type === "MAINTENANCE_PURCHASE" && maintenancePriority) {
    parts.push(`Priority: ${formatMaintenancePriorityLabel(maintenancePriority)}`);
  }
  if (type === "INVENTORY_STOCK_UP" && stockLocationName) {
    parts.push(`Stock location: ${stockLocationName}`);
  }
  if (type === "INVENTORY_STOCK_UP" && inventoryReason) {
    parts.push(`Reason: ${formatInventoryReasonLabel(inventoryReason)}`);
  }
  if (shortReason.trim()) {
    parts.push(shortReason.trim());
  }
  return parts.length > 0 ? parts.join(" | ") : null;
}

function formatMaintenancePriorityLabel(priority: MaintenancePriority) {
  if (priority === "HIGH") return "High";
  if (priority === "MEDIUM") return "Medium";
  return "Low";
}

function formatInventoryReasonLabel(reason: InventoryReason) {
  if (reason === "LOW_STOCK") return "Low stock";
  if (reason === "RESTOCK") return "Restock";
  if (reason === "EMERGENCY") return "Emergency";
  return "Other";
}

function isMaintenanceRecordOpen(status: string) {
  const normalized = status.trim().toUpperCase();
  return (
    normalized === "OPEN" ||
    normalized === "IN_REPAIR" ||
    normalized === "WAITING_FOR_PARTS"
  );
}

function normalizeSearchText(value: string) {
  return normalizeNameForComparison(value);
}

function formatIsoDate(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value || "-";
  }
  return parsed.toISOString().slice(0, 10);
}

function buildReceiptIntakeHref(row: RequisitionRow) {
  const query = new URLSearchParams();
  query.set("requisitionId", row.id);
  query.set("requisitionCode", row.requisitionCode);
  query.set("requisitionType", row.type);
  if (row.context.clientId) {
    query.set("clientId", row.context.clientId);
  }
  if (row.context.projectId) {
    query.set("projectId", row.context.projectId);
  }
  if (row.context.rigId) {
    query.set("rigId", row.context.rigId);
  }
  if (row.context.maintenanceRequestId) {
    query.set("maintenanceRequestId", row.context.maintenanceRequestId);
  }
  if (row.context.breakdownReportId) {
    query.set("breakdownReportId", row.context.breakdownReportId);
  }
  return `/purchasing/receipt-follow-up?${query.toString()}`;
}

function StatusChip({ status }: { status: RequisitionStatus }) {
  const style =
    status === "PURCHASE_COMPLETED"
      ? "border-emerald-300 bg-emerald-100 text-emerald-800"
      : status === "APPROVED"
        ? "border-indigo-300 bg-indigo-100 text-indigo-800"
        : status === "REJECTED"
          ? "border-red-300 bg-red-100 text-red-800"
          : "border-amber-300 bg-amber-100 text-amber-800";
  return (
    <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${style}`}>
      {status === "PURCHASE_COMPLETED"
        ? "Posted cost"
        : status.charAt(0) + status.slice(1).toLowerCase()}
    </span>
  );
}
