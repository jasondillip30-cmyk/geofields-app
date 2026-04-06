"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

import { ReceiptIntakePanel } from "@/components/inventory/receipt-intake-panel";
import { AccessGate } from "@/components/layout/access-gate";
import { useRegisterCopilotContext } from "@/components/layout/ai-copilot-context";
import { scrollToFocusElement, useCopilotFocusTarget } from "@/components/layout/copilot-focus-target";
import { useRole } from "@/components/layout/role-provider";
import type { CopilotPageContext } from "@/lib/ai/contextual-copilot";
import { canAccess } from "@/lib/auth/permissions";
import { REQUISITION_RECEIPT_ELIGIBLE_STATUS } from "@/lib/requisition-lifecycle";
import { Card, MetricCard } from "@/components/ui/card";
import { DataTable } from "@/components/ui/table";
import { cn, formatCurrency } from "@/lib/utils";

interface ReferenceClient {
  id: string;
  name: string;
}

interface ReferenceProject {
  id: string;
  name: string;
  clientId: string;
}

interface ReferenceRig {
  id: string;
  rigCode: string;
}

interface ReferenceSupplier {
  id: string;
  name: string;
}

interface ReferenceLocation {
  id: string;
  name: string;
}

interface ReferenceItem {
  id: string;
  name: string;
  sku: string;
  category: string;
  minimumStockLevel: number;
}

interface ReferenceMaintenanceRequest {
  id: string;
  requestCode: string;
}

interface ReceiptMovementRow {
  id: string;
  date: string;
  quantity: number;
  totalCost: number | null;
  traReceiptNumber: string | null;
  supplierInvoiceNumber: string | null;
  receiptUrl: string | null;
  notes: string | null;
  item: { id: string; name: string; sku: string } | null;
  supplier: { id: string; name: string } | null;
  performedBy: { id: string; fullName: string } | null;
  project: { id: string; name: string } | null;
  client: { id: string; name: string } | null;
  rig: { id: string; rigCode: string } | null;
  expense: { id: string; amount: number } | null;
}

interface ReceiptSubmissionSummary {
  id: string;
  reportDate: string;
  status: "SUBMITTED" | "APPROVED" | "REJECTED";
  submissionStatus: string;
  submittedAt: string;
  submittedBy: { userId: string; name: string; role: string };
  reviewer:
    | {
        userId: string;
        name: string;
        role: string;
        decision: string;
        decidedAt: string;
        note: string;
      }
    | null;
  summary: {
    supplierName: string;
    receiptNumber: string;
    verificationCode: string;
    serialNumber: string;
    receiptDate: string;
    total: number;
    traReceiptNumber: string;
  };
}

interface ReceiptSubmissionDetail {
  id: string;
  status: "SUBMITTED" | "APPROVED" | "REJECTED";
  draft: {
    receiptType?:
      | "INVENTORY_PURCHASE"
      | "MAINTENANCE_LINKED_PURCHASE"
      | "EXPENSE_ONLY"
      | "INTERNAL_TRANSFER";
    expenseOnlyCategory?: "TRAVEL" | "FOOD" | "FUEL" | "MISC";
    receiptPurpose?:
      | "INVENTORY_PURCHASE"
      | "BUSINESS_EXPENSE_ONLY"
      | "INVENTORY_AND_EXPENSE"
      | "EVIDENCE_ONLY"
      | "OTHER_MANUAL";
    createExpense?: boolean;
    receipt?: {
      url?: string | null;
      fileName?: string | null;
      supplierId?: string | null;
      supplierName?: string | null;
      tin?: string | null;
      vrn?: string | null;
      serialNumber?: string | null;
      receiptNumber?: string | null;
      verificationCode?: string | null;
      verificationUrl?: string | null;
      rawQrValue?: string | null;
      receiptDate?: string | null;
      receiptTime?: string | null;
      traReceiptNumber?: string | null;
      invoiceReference?: string | null;
      paymentMethod?: string | null;
      taxOffice?: string | null;
      ocrTextPreview?: string | null;
      currency?: string | null;
      subtotal?: number | null;
      tax?: number | null;
      total?: number | null;
    };
    linkContext?: {
      clientId?: string | null;
      projectId?: string | null;
      rigId?: string | null;
      maintenanceRequestId?: string | null;
      locationFromId?: string | null;
      locationToId?: string | null;
    };
    lines?: Array<{
      id?: string;
      description?: string;
      quantity?: number;
      unitPrice?: number;
      lineTotal?: number;
      selectedItemId?: string | null;
      selectedCategory?: string | null;
      mode?: "MATCH" | "NEW" | "EXPENSE_ONLY";
      newItem?: {
        name?: string;
        sku?: string;
        category?: string;
        minimumStockLevel?: number;
        locationId?: string | null;
        status?: "ACTIVE" | "INACTIVE";
        notes?: string;
      } | null;
    }>;
  };
}

interface RequisitionPrefill {
  id: string;
  requisitionCode: string;
  type: "LIVE_PROJECT_PURCHASE" | "INVENTORY_STOCK_UP" | "MAINTENANCE_PURCHASE";
  liveProjectSpendType: "BREAKDOWN" | "NORMAL_EXPENSE" | null;
  category: string | null;
  subcategory: string | null;
  requestedVendorName: string | null;
  clientId: string | null;
  projectId: string | null;
  rigId: string | null;
  maintenanceRequestId: string | null;
  lineItems: Array<{
    id: string;
    description: string;
    quantity: number;
    estimatedUnitCost: number;
    estimatedTotalCost: number;
    notes: string | null;
  }>;
  totals: {
    estimatedTotalCost: number;
    approvedTotalCost: number;
    actualPostedCost: number;
  };
}

type ReceiptEntryMode = "REQUISITION" | "MANUAL" | "";
type ReceiptInputMethod = "SCAN" | "MANUAL" | "";

interface ApprovedRequisitionRow {
  id: string;
  requisitionCode: string;
  type: "LIVE_PROJECT_PURCHASE" | "INVENTORY_STOCK_UP" | "MAINTENANCE_PURCHASE";
  liveProjectSpendType: "BREAKDOWN" | "NORMAL_EXPENSE" | null;
  status: "SUBMITTED" | "APPROVED" | "REJECTED" | "PURCHASE_COMPLETED";
  category: string | null;
  subcategory: string | null;
  requestedVendorName: string | null;
  submittedAt: string;
  context: {
    clientId: string | null;
    projectId: string | null;
    rigId: string | null;
    maintenanceRequestId: string | null;
  };
  lineItems: Array<{
    id: string;
    description: string;
    quantity: number;
    estimatedUnitCost: number;
    estimatedTotalCost: number;
    notes: string | null;
  }>;
  totals: {
    estimatedTotalCost: number;
    approvedTotalCost: number;
    actualPostedCost: number;
  };
}

export default function InventoryReceiptIntakePage() {
  return (
    <Suspense fallback={<InventoryReceiptIntakeFallback />}>
      <InventoryReceiptIntakePageContent />
    </Suspense>
  );
}

function InventoryReceiptIntakePageContent() {
  const renderTimestamp = new Date().toISOString();
  const showDeveloperDebugUi = process.env.NEXT_PUBLIC_RECEIPT_INTAKE_DEBUG_UI === "1";
  if (showDeveloperDebugUi && process.env.NODE_ENV !== "production") {
    console.info("RECEIPT FOLLOW-UP PAGE RENDERED", {
      component: "InventoryReceiptIntakePageContent",
      pagePath: "/purchasing/receipt-follow-up",
      timestamp: renderTimestamp,
      version: "receipt-follow-up-debug-v1"
    });
  }

  const searchParams = useSearchParams();
  const { user } = useRole();
  const canManage = Boolean(user?.role && canAccess(user.role, "inventory:manage"));
  const requestedView = (searchParams.get("view") || "").toLowerCase();
  const activeSubmissionId = searchParams.get("submissionId") || "";
  const currentView = activeSubmissionId ? "scan" : requestedView === "history" ? "history" : "scan";
  const urlRequisitionPrefill = useMemo<RequisitionPrefill | null>(() => {
    const requisitionId = normalizeOptionalId(searchParams.get("requisitionId"));
    if (!requisitionId) {
      return null;
    }
    const type = normalizeRequisitionType(searchParams.get("requisitionType"));
    if (!type) {
      return null;
    }
    return {
      id: requisitionId,
      requisitionCode: normalizeOptionalId(searchParams.get("requisitionCode")) || requisitionId.slice(-8),
      type,
      liveProjectSpendType: normalizeLiveProjectSpendType(searchParams.get("liveProjectSpendType")),
      category: null,
      subcategory: null,
      requestedVendorName: null,
      clientId: normalizeOptionalId(searchParams.get("clientId")),
      projectId: normalizeOptionalId(searchParams.get("projectId")),
      rigId: normalizeOptionalId(searchParams.get("rigId")),
      maintenanceRequestId: normalizeOptionalId(searchParams.get("maintenanceRequestId")),
      lineItems: [],
      totals: {
        estimatedTotalCost: 0,
        approvedTotalCost: 0,
        actualPostedCost: 0
      }
    };
  }, [searchParams]);

  const isApprovedContinuationEntry = Boolean(urlRequisitionPrefill);
  const [entryMode, setEntryMode] = useState<ReceiptEntryMode>(
    () => (isApprovedContinuationEntry ? "REQUISITION" : "")
  );
  const [receiptInputMethod] =
    useState<ReceiptInputMethod>("");
  const [selectedRequisitionId, setSelectedRequisitionId] = useState<string>(
    () => urlRequisitionPrefill?.id || ""
  );
  const [approvedRequisitions, setApprovedRequisitions] = useState<ApprovedRequisitionRow[]>([]);
  const [_requisitionLookupError, setRequisitionLookupError] = useState<string | null>(null);

  const [clients, setClients] = useState<ReferenceClient[]>([]);
  const [projects, setProjects] = useState<ReferenceProject[]>([]);
  const [rigs, setRigs] = useState<ReferenceRig[]>([]);
  const [suppliers, setSuppliers] = useState<ReferenceSupplier[]>([]);
  const [locations, setLocations] = useState<ReferenceLocation[]>([]);
  const [items, setItems] = useState<ReferenceItem[]>([]);
  const [maintenanceRequests, setMaintenanceRequests] = useState<ReferenceMaintenanceRequest[]>([]);
  const [historyRows, setHistoryRows] = useState<ReceiptMovementRow[]>([]);
  const [submissions, setSubmissions] = useState<ReceiptSubmissionSummary[]>([]);
  const [activeSubmission, setActiveSubmission] = useState<ReceiptSubmissionDetail | null>(null);
  const [submissionLoading, setSubmissionLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [focusedSectionId, setFocusedSectionId] = useState<string | null>(null);

  const selectedApprovedRequisition = useMemo(
    () => approvedRequisitions.find((row) => row.id === selectedRequisitionId) || null,
    [approvedRequisitions, selectedRequisitionId]
  );
  const selectedRequisitionPrefill = useMemo<RequisitionPrefill | null>(() => {
    if (!selectedRequisitionId) {
      return null;
    }
    if (selectedApprovedRequisition) {
      return {
        id: selectedApprovedRequisition.id,
        requisitionCode: selectedApprovedRequisition.requisitionCode,
        type: selectedApprovedRequisition.type,
        liveProjectSpendType: selectedApprovedRequisition.liveProjectSpendType,
        category: selectedApprovedRequisition.category,
        subcategory: selectedApprovedRequisition.subcategory,
        requestedVendorName: selectedApprovedRequisition.requestedVendorName,
        clientId: selectedApprovedRequisition.context.clientId,
        projectId: selectedApprovedRequisition.context.projectId,
        rigId: selectedApprovedRequisition.context.rigId,
        maintenanceRequestId: selectedApprovedRequisition.context.maintenanceRequestId,
        lineItems: selectedApprovedRequisition.lineItems,
        totals: selectedApprovedRequisition.totals
      };
    }
    if (urlRequisitionPrefill?.id === selectedRequisitionId) {
      return urlRequisitionPrefill;
    }
    return null;
  }, [selectedApprovedRequisition, selectedRequisitionId, urlRequisitionPrefill]);
  const activeRequisitionPrefill = useMemo<RequisitionPrefill | null>(
    () => (entryMode === "REQUISITION" ? selectedRequisitionPrefill : null),
    [entryMode, selectedRequisitionPrefill]
  );
  const [panelGuidedStep, setPanelGuidedStep] = useState<1 | 2 | 3 | 4>(1);
  const canRenderReceiptPanel =
    entryMode === "MANUAL" || Boolean(activeRequisitionPrefill) || Boolean(activeSubmission);
  const workflowStepLabels = [
    "1. Receipt",
    "2. Items",
    "3. Inventory",
    "4. Finalize"
  ];
  const activeWorkflowStepIndex = panelGuidedStep - 1;

  useEffect(() => {
    if (!urlRequisitionPrefill) {
      return;
    }
    setEntryMode("REQUISITION");
    setSelectedRequisitionId(urlRequisitionPrefill.id);
  }, [urlRequisitionPrefill]);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const movementQuery = new URLSearchParams();
      const submissionsQuery = new URLSearchParams(movementQuery);
      const requisitionsQuery = new URLSearchParams(movementQuery);
      requisitionsQuery.set("status", REQUISITION_RECEIPT_ELIGIBLE_STATUS);

      const [
        clientsRes,
        projectsRes,
        rigsRes,
        suppliersRes,
        locationsRes,
        itemsRes,
        maintenanceRes,
        movementsRes,
        submissionsRes,
        requisitionsRes
      ] =
        await Promise.all([
          fetch("/api/clients", { cache: "no-store" }),
          fetch("/api/projects", { cache: "no-store" }),
          fetch("/api/rigs", { cache: "no-store" }),
          fetch("/api/inventory/suppliers", { cache: "no-store" }),
          fetch("/api/inventory/locations", { cache: "no-store" }),
          fetch("/api/inventory/items", { cache: "no-store" }),
          fetch("/api/maintenance-requests", { cache: "no-store" }),
          fetch(`/api/inventory/movements?${movementQuery.toString()}`, { cache: "no-store" }),
          fetch(`/api/inventory/receipt-intake/submissions?${submissionsQuery.toString()}`, { cache: "no-store" }),
          fetch(`/api/requisitions?${requisitionsQuery.toString()}`, { cache: "no-store" })
        ]);

      const [
        clientsPayload,
        projectsPayload,
        rigsPayload,
        suppliersPayload,
        locationsPayload,
        itemsPayload,
        maintenancePayload,
        movementsPayload,
        submissionsPayload,
        requisitionsPayload
      ] =
        await Promise.all([
          clientsRes.ok ? clientsRes.json() : Promise.resolve({ data: [] }),
          projectsRes.ok ? projectsRes.json() : Promise.resolve({ data: [] }),
          rigsRes.ok ? rigsRes.json() : Promise.resolve({ data: [] }),
          suppliersRes.ok ? suppliersRes.json() : Promise.resolve({ data: [] }),
          locationsRes.ok ? locationsRes.json() : Promise.resolve({ data: [] }),
          itemsRes.ok ? itemsRes.json() : Promise.resolve({ data: [] }),
          maintenanceRes.ok ? maintenanceRes.json() : Promise.resolve({ data: [] }),
          movementsRes.ok ? movementsRes.json() : Promise.resolve({ data: [] }),
          submissionsRes.ok ? submissionsRes.json() : Promise.resolve({ data: [] }),
          requisitionsRes.ok ? requisitionsRes.json() : Promise.resolve({ data: [] })
        ]);

      setClients((clientsPayload.data || []).map((entry: { id: string; name: string }) => ({ id: entry.id, name: entry.name })));
      setProjects(
        (projectsPayload.data || []).map((entry: { id: string; name: string; clientId: string }) => ({
          id: entry.id,
          name: entry.name,
          clientId: entry.clientId
        }))
      );
      setRigs((rigsPayload.data || []).map((entry: { id: string; rigCode: string }) => ({ id: entry.id, rigCode: entry.rigCode })));
      setSuppliers((suppliersPayload.data || []).map((entry: { id: string; name: string }) => ({ id: entry.id, name: entry.name })));
      setLocations((locationsPayload.data || []).map((entry: { id: string; name: string }) => ({ id: entry.id, name: entry.name })));
      setItems(
        (itemsPayload.data || []).map((entry: { id: string; name: string; sku: string; category: string; minimumStockLevel: number }) => ({
          id: entry.id,
          name: entry.name,
          sku: entry.sku,
          category: entry.category,
          minimumStockLevel: entry.minimumStockLevel
        }))
      );
      setMaintenanceRequests(
        (maintenancePayload.data || []).map((entry: { id: string; requestCode?: string }) => ({
          id: entry.id,
          requestCode: entry.requestCode || entry.id
        }))
      );

      const receiptHistory = ((movementsPayload.data || []) as ReceiptMovementRow[]).filter(
        (movement) => movement.receiptUrl || movement.traReceiptNumber || movement.supplierInvoiceNumber
      );
      setHistoryRows(receiptHistory);
      setSubmissions(
        ((submissionsPayload.data || []) as ReceiptSubmissionSummary[]).map((entry) => ({
          id: entry.id,
          reportDate: entry.reportDate,
          status: entry.status,
          submissionStatus: entry.submissionStatus,
          submittedAt: entry.submittedAt,
          submittedBy: entry.submittedBy,
          reviewer: entry.reviewer || null,
          summary: entry.summary
        }))
      );
      setApprovedRequisitions(
        ((requisitionsPayload.data || []) as ApprovedRequisitionRow[])
          .filter((entry) => entry.status === REQUISITION_RECEIPT_ELIGIBLE_STATUS)
          .map((entry) => ({
            id: entry.id,
            requisitionCode: entry.requisitionCode,
            type: entry.type,
            liveProjectSpendType: normalizeLiveProjectSpendType(entry.liveProjectSpendType),
            status: entry.status,
            category: typeof entry.category === "string" ? entry.category : null,
            subcategory: typeof entry.subcategory === "string" ? entry.subcategory : null,
            requestedVendorName:
              typeof entry.requestedVendorName === "string" ? entry.requestedVendorName : null,
            submittedAt: entry.submittedAt,
            context: {
              clientId: entry.context?.clientId || null,
              projectId: entry.context?.projectId || null,
              rigId: entry.context?.rigId || null,
              maintenanceRequestId: entry.context?.maintenanceRequestId || null
            },
            lineItems: Array.isArray(entry.lineItems)
              ? entry.lineItems
                  .map((line) => ({
                    id: String(line?.id || ""),
                    description: String(line?.description || "").trim(),
                    quantity: Number(line?.quantity || 0),
                    estimatedUnitCost: Number(line?.estimatedUnitCost || 0),
                    estimatedTotalCost: Number(line?.estimatedTotalCost || 0),
                    notes: typeof line?.notes === "string" ? line.notes : null
                  }))
                  .filter((line) => line.description.length > 0)
              : [],
            totals: {
              estimatedTotalCost: Number(entry.totals?.estimatedTotalCost || 0),
              approvedTotalCost: Number(entry.totals?.approvedTotalCost || 0),
              actualPostedCost: Number(entry.totals?.actualPostedCost || 0)
            }
          }))
      );
      if (!requisitionsRes.ok) {
        setRequisitionLookupError(
          requisitionsRes.status === 403
            ? "Approved requisitions are not available for your role. Use manual entry when no requisition is assigned."
            : "Could not load approved requisitions right now. You can continue with manual entry."
        );
      } else {
        setRequisitionLookupError(null);
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load receipt intake workspace.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    if (!activeSubmissionId) {
      setActiveSubmission(null);
      return;
    }
    let cancelled = false;
    setSubmissionLoading(true);
    setError(null);
    void fetch(`/api/inventory/receipt-intake/submissions/${activeSubmissionId}`, { cache: "no-store" })
      .then(async (response) => {
        const payload = (await response.json().catch(() => null)) as { data?: ReceiptSubmissionDetail; message?: string } | null;
        if (!response.ok) {
          throw new Error(payload?.message || "Failed to load receipt submission.");
        }
        if (!cancelled) {
          setActiveSubmission(payload?.data || null);
        }
      })
      .catch((submissionError) => {
        if (!cancelled) {
          setActiveSubmission(null);
          setError(submissionError instanceof Error ? submissionError.message : "Failed to load receipt submission.");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setSubmissionLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [activeSubmissionId]);

  const rejectSubmission = useCallback(
    async (submissionId: string) => {
      const reason = window.prompt("Enter rejection reason:");
      if (reason === null) {
        return;
      }
      const trimmed = reason.trim();
      if (trimmed.length < 3) {
        setError("Rejection reason must be at least 3 characters.");
        return;
      }
      setError(null);
      const response = await fetch(`/api/inventory/receipt-intake/submissions/${submissionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reject", reason: trimmed })
      });
      const payload = (await response.json().catch(() => null)) as { message?: string } | null;
      if (!response.ok) {
        setError(payload?.message || "Failed to reject receipt submission.");
        return;
      }
      await loadData();
    },
    [loadData]
  );

  const totalReceiptValue = useMemo(
    () => historyRows.reduce((sum, row) => sum + Number(row.totalCost || 0), 0),
    [historyRows]
  );
  const copilotContext = useMemo<CopilotPageContext>(() => {
    const submittedCount = submissions.filter((row) => row.status === "SUBMITTED").length;
    const approvedCount = submissions.filter((row) => row.status === "APPROVED").length;
    const receiptPriorityItems: NonNullable<CopilotPageContext["priorityItems"]> = [
      ...submissions
        .filter((row) => row.status === "SUBMITTED")
        .slice(0, 3)
        .map((row) => ({
          id: row.id,
          label: row.summary.receiptNumber
            ? `Pending receipt • ${row.summary.receiptNumber}`
            : `Pending receipt • ${row.id.slice(-8)}`,
          reason: `${row.summary.supplierName || "Unknown supplier"} pending review at ${formatCurrency(
            row.summary.total || 0
          )}.`,
          severity: (row.summary.total || 0) >= 10000 ? ("HIGH" as const) : ("MEDIUM" as const),
          amount: row.summary.total || 0,
          href: `/purchasing/receipt-follow-up?submissionId=${row.id}`,
          issueType: "APPROVAL_BACKLOG",
          targetId: row.id,
          sectionId: "inventory-receipt-history-section",
          targetPageKey: "inventory-receipt-intake"
        })),
      ...historyRows
        .filter((row) => (row.totalCost || 0) > 0)
        .sort((a, b) => (b.totalCost || 0) - (a.totalCost || 0))
        .slice(0, 2)
        .map((row) => ({
          id: row.id,
          label: `Receipt-linked movement • ${row.item?.name || "Unknown item"}`,
          reason: `Movement value ${formatCurrency(row.totalCost || 0)} with linked receipt evidence.`,
          severity: (row.totalCost || 0) >= 10000 ? ("HIGH" as const) : ("MEDIUM" as const),
          amount: row.totalCost || 0,
          href: `/purchasing/receipt-follow-up`,
          issueType: "INVENTORY_MOVEMENT",
          targetId: row.id,
          sectionId: "inventory-receipt-history-section",
          targetPageKey: "inventory-receipt-intake"
        }))
    ];

    return {
      pageKey: "inventory-receipt-intake",
      pageName: "Purchase Receipt Follow-up",
      filters: {
        clientId: null,
        rigId: null,
        from: null,
        to: null
      },
      summaryMetrics: [
        { key: "receiptsInScope", label: "Receipts in Scope", value: historyRows.length },
        { key: "receiptLinkedValue", label: "Receipt-Linked Value", value: totalReceiptValue },
        { key: "pendingReceiptSubmissions", label: "Pending Receipt Submissions", value: submittedCount },
        { key: "approvedReceiptSubmissions", label: "Approved Receipt Submissions", value: approvedCount }
      ],
      tablePreviews: [
        {
          key: "receipt-submissions",
          title: "Receipt Submissions",
          rowCount: submissions.length,
          columns: ["Submitted", "Status", "Supplier", "Receipt", "Total"],
          rows: submissions.slice(0, 10).map((row) => ({
            id: row.id,
            submitted: toIsoDate(row.submittedAt || row.reportDate),
            status: row.status,
            supplier: row.summary.supplierName || "-",
            receipt: row.summary.receiptNumber || "-",
            total: row.summary.total || 0,
            href: `/purchasing/receipt-follow-up?submissionId=${row.id}`,
            targetId: row.id,
            sectionId: "inventory-receipt-history-section",
            targetPageKey: "inventory-receipt-intake"
          }))
        },
        {
          key: "receipt-linked-movements",
          title: "Finalized Stock Movements",
          rowCount: historyRows.length,
          columns: ["Date", "Supplier", "Item", "Value"],
          rows: historyRows.slice(0, 10).map((row) => ({
            id: row.id,
            date: toIsoDate(row.date),
            supplier: row.supplier?.name || "-",
            item: row.item?.name || "-",
            value: row.totalCost || 0,
            href: "/purchasing/receipt-follow-up",
            targetId: row.id,
            sectionId: "inventory-receipt-history-section",
            targetPageKey: "inventory-receipt-intake"
          }))
        }
      ],
      priorityItems: receiptPriorityItems,
      navigationTargets: [
        {
          label: "Open Purchase Follow-up",
          href: "/purchasing/receipt-follow-up",
          reason: "Capture and review receipt submissions.",
          pageKey: "inventory-receipt-intake",
          sectionId: "inventory-receipt-scan-section"
        },
        {
          label: "Open Follow-up History",
          href: "/purchasing/receipt-follow-up",
          reason: "Review pending/finalized receipt records.",
          pageKey: "inventory-receipt-intake",
          sectionId: "inventory-receipt-history-section"
        },
        {
          label: "Open Stock Movements",
          href: "/inventory/stock-movements",
          reason: "Inspect movement-level inventory impact.",
          pageKey: "inventory-stock-movements",
          sectionId: "inventory-movements-section"
        },
        {
          label: "Open Approvals",
          href: "/approvals",
          reason: "Finalize pending receipt submissions.",
          pageKey: "approvals",
          sectionId: "approvals-receipts-section"
        }
      ],
      notes: [
        "Receipt processing is a review-first workflow with manager/admin finalization controls.",
        "Use the global copilot to triage pending receipt submissions and linked inventory impact."
      ]
    };
  }, [historyRows, submissions, totalReceiptValue]);

  useRegisterCopilotContext(copilotContext);
  useCopilotFocusTarget({
    pageKey: "inventory-receipt-intake",
    onFocus: (target) => {
      setFocusedSectionId(target.sectionId || null);
      scrollToFocusElement({
        sectionId: target.sectionId,
        targetId: target.targetId
      });
    }
  });

  useEffect(() => {
    if (!focusedSectionId) {
      return;
    }
    const timeout = window.setTimeout(() => setFocusedSectionId(null), 2600);
    return () => window.clearTimeout(timeout);
  }, [focusedSectionId]);

  return (
    <AccessGate permission="inventory:view">
      <div className="gf-page-stack space-y-3 md:space-y-4">
        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
        )}

        <section className="rounded-2xl border border-slate-200/70 bg-white px-4 py-3 shadow-[0_1px_2px_rgba(15,23,42,0.03),0_8px_20px_rgba(15,23,42,0.04)] md:px-5 md:py-3.5">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-ink-900 md:text-[1.6rem]">
              Complete Approved Purchase
            </h1>
            {showDeveloperDebugUi && (
              <div className="mt-2 rounded-xl border-2 border-rose-500 bg-rose-50 px-3 py-2.5 text-sm text-rose-950 shadow-sm">
                <p className="text-base font-extrabold uppercase tracking-wide">
                  RENDER PATH TEST — RECEIPT FOLLOW-UP DEBUG ACTIVE
                </p>
                <div className="mt-2 grid gap-1 sm:grid-cols-2">
                  <p>
                    component name: <span className="font-semibold">InventoryReceiptIntakePageContent</span>
                  </p>
                  <p>
                    page path: <span className="font-semibold">/purchasing/receipt-follow-up</span>
                  </p>
                  <p>
                    current timestamp at render: <span className="font-semibold">{renderTimestamp}</span>
                  </p>
                  <p>
                    version: <span className="font-semibold">receipt-follow-up-debug-v1</span>
                  </p>
                </div>
              </div>
            )}
          </div>
        </section>

        {currentView === "scan" && (
          <section className="space-y-2 rounded-2xl border border-slate-200/70 bg-white px-4 py-3 md:px-5">
            {activeRequisitionPrefill && (
              <p className="text-xs font-medium text-slate-500">
                Requisition: <span className="text-slate-700">{activeRequisitionPrefill.requisitionCode}</span>
              </p>
            )}
            <div className="grid gap-1 text-[11px] sm:grid-cols-2 xl:grid-cols-4">
              {workflowStepLabels.map((label, index) => (
                <div
                  key={label}
                  className={`rounded-full px-2.5 py-1 ${
                    index === activeWorkflowStepIndex
                      ? "bg-slate-100 text-slate-800"
                      : "bg-slate-50 text-slate-500"
                  }`}
                >
                  {label}
                </div>
              ))}
            </div>
          </section>
        )}

        {currentView === "scan" && (
          <section
            id="inventory-receipt-scan-section"
            className={cn(
              focusedSectionId === "inventory-receipt-scan-section" &&
                "rounded-2xl ring-2 ring-indigo-100 ring-offset-2 ring-offset-slate-50"
            )}
          >
          <Card
            className="min-w-0"
            title={undefined}
            subtitle={undefined}
          >
            {!canManage && (
              <p className="mb-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                Saved as <span className="font-semibold">Pending review</span> until manager/admin finalization.
              </p>
            )}
            {activeRequisitionPrefill && (
              <p className="mb-2 text-[11px] text-slate-500">
                Requisition <span className="font-medium text-slate-700">{activeRequisitionPrefill.requisitionCode}</span>
              </p>
            )}
            {submissionLoading && (
              <p className="mb-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                Loading selected submission...
              </p>
            )}
            {canRenderReceiptPanel ? (
              <ReceiptIntakePanel
                key={`${entryMode}:${receiptInputMethod}:${activeRequisitionPrefill?.id || "manual"}`}
                renderCard={false}
                canManage={canManage}
                items={items}
                suppliers={suppliers}
                locations={locations}
                maintenanceRequests={maintenanceRequests}
                clients={clients}
                projects={projects}
                rigs={rigs}
                defaultClientId={activeRequisitionPrefill?.clientId || ""}
                defaultRigId={activeRequisitionPrefill?.rigId || ""}
                initialRequisition={activeRequisitionPrefill}
                preferredInputMethod={receiptInputMethod || "SCAN"}
                activeSubmission={activeSubmission}
                onGuidedStepChange={(step) => setPanelGuidedStep(step)}
                onCompleted={async () => {
                  await loadData();
                }}
              />
            ) : (
              <div className="rounded-lg border border-dashed border-indigo-300 bg-indigo-50 px-3 py-3 text-sm text-indigo-900">
                Select an approved requisition to continue with receipt posting.
              </div>
            )}
          </Card>
          </section>
        )}

        {currentView === "history" && (
          <section
            id="inventory-receipt-history-section"
            className={cn(
              focusedSectionId === "inventory-receipt-history-section" &&
                "rounded-2xl ring-2 ring-indigo-100 ring-offset-2 ring-offset-slate-50"
            )}
          >
          <div className="mb-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
            Receipt history is secondary. Primary lifecycle tracking is under{" "}
            <Link href="/expenses" className="font-semibold text-brand-700 underline-offset-2 hover:underline">
              Purchase Requests → Requisition History
            </Link>
            .
          </div>
          <Card
            className="min-w-0"
            title="Legacy Receipt Submission History"
            subtitle="Secondary receipt evidence and submission log"
          >
            {loading ? (
              <p className="text-sm text-ink-600">Loading receipt history...</p>
            ) : (
              <div className="space-y-4">
                <section className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold text-ink-900">Receipt Submissions</h3>
                    <span className="text-xs text-slate-500">{submissions.length} total</span>
                  </div>
                  {submissions.length === 0 ? (
                    <p className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-3 text-sm text-ink-600">
                      No receipt submissions found yet.
                    </p>
                  ) : (
                    <DataTable
                      className="border-slate-200/70"
                      columns={[
                        "Submitted",
                        "Status",
                        "Supplier",
                        "Receipt #",
                        "Total",
                        "Submitted By",
                        "Reviewer",
                        "Action"
                      ]}
                      rows={submissions.slice(0, 80).map((row) => [
                        toIsoDate(row.submittedAt || row.reportDate),
                        <span
                          key={`${row.id}-status`}
                          className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
                            row.status === "APPROVED"
                              ? "border-emerald-300 bg-emerald-100 text-emerald-800"
                              : row.status === "REJECTED"
                                ? "border-red-300 bg-red-100 text-red-800"
                                : "border-amber-300 bg-amber-100 text-amber-800"
                          }`}
                        >
                          {row.status === "SUBMITTED"
                            ? "Pending review"
                            : row.status === "APPROVED"
                              ? "Finalized"
                              : "Rejected"}
                        </span>,
                        row.summary.supplierName || "-",
                        row.summary.receiptNumber || "-",
                        formatCurrency(row.summary.total || 0),
                        row.submittedBy?.name || "-",
                        row.reviewer?.name || "-",
                        <div key={`${row.id}-action`} className="flex flex-wrap gap-2">
                          {canManage && row.status !== "APPROVED" ? (
                            <Link
                              href={`/purchasing/receipt-follow-up?submissionId=${row.id}`}
                              className="rounded border border-brand-300 bg-brand-50 px-2 py-1 text-xs font-semibold text-brand-800 hover:bg-brand-100"
                            >
                              Review & finalize
                            </Link>
                          ) : (
                            <span className="text-xs text-slate-500">-</span>
                          )}
                          {canManage && row.status === "SUBMITTED" && (
                            <button
                              type="button"
                              onClick={() => void rejectSubmission(row.id)}
                              className="rounded border border-red-300 bg-red-50 px-2 py-1 text-xs font-semibold text-red-700 hover:bg-red-100"
                            >
                              Reject
                            </button>
                          )}
                        </div>
                      ])}
                    />
                  )}
                </section>

                <section className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold text-ink-900">Finalized Stock Movements</h3>
                    <span className="text-xs text-slate-500">{historyRows.length} rows</span>
                  </div>
                  {historyRows.length === 0 ? (
                    <p className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-4 text-sm text-ink-600">
                      No receipt-linked inventory movements found yet.
                    </p>
                  ) : (
                    <DataTable
                      className="border-slate-200/70"
                      columns={["Date", "Supplier", "Receipt #", "TRA #", "Item", "Value", "Project", "Rig", "Linked Expense", "Receipt", "Action"]}
                      rows={historyRows.slice(0, 80).map((row) => [
                        toIsoDate(row.date),
                        row.supplier?.name || "-",
                        row.supplierInvoiceNumber || "-",
                        row.traReceiptNumber || "-",
                        row.item?.name || "-",
                        formatCurrency(row.totalCost || 0),
                        row.project?.name || "-",
                        row.rig?.rigCode || "-",
                        row.expense?.id || "-",
                        row.receiptUrl ? (
                          <a
                            key={`${row.id}-receipt`}
                            href={row.receiptUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-brand-700 underline"
                          >
                            Open
                          </a>
                        ) : (
                          "-"
                        ),
                        <Link
                          key={`${row.id}-detail`}
                          href={`/inventory/stock-movements?movementId=${row.id}`}
                          className="rounded border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-800 hover:bg-slate-100"
                        >
                          Open Detail
                        </Link>
                      ])}
                    />
                  )}
                </section>
              </div>
            )}
          </Card>
          </section>
        )}

        <details className="rounded-xl border border-slate-200 bg-white">
          <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-slate-800">
            Receipt Metrics / KPIs
          </summary>
          <div className="grid gap-3 border-t border-slate-200 p-4 md:grid-cols-3">
            <MetricCard label="Receipts in Scope" value={String(historyRows.length)} />
            <MetricCard label="Receipt-Linked Value" value={formatCurrency(totalReceiptValue)} />
            <MetricCard label="Suppliers in Intake" value={String(new Set(historyRows.map((row) => row.supplier?.id || "")).size)} />
          </div>
        </details>
      </div>
    </AccessGate>
  );
}

function InventoryReceiptIntakeFallback() {
  return (
    <AccessGate permission="inventory:view">
      <div className="gf-page-stack">
        <p className="text-sm text-ink-600">Loading receipt processing workspace...</p>
      </div>
    </AccessGate>
  );
}

function toIsoDate(value: string) {
  if (!value) {
    return "-";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toISOString().slice(0, 10);
}

function normalizeOptionalId(value: string | null) {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed !== "all" ? trimmed : null;
}

function normalizeRequisitionType(value: string | null) {
  if (
    value === "LIVE_PROJECT_PURCHASE" ||
    value === "INVENTORY_STOCK_UP" ||
    value === "MAINTENANCE_PURCHASE"
  ) {
    return value;
  }
  return null;
}

function normalizeLiveProjectSpendType(value: unknown): "BREAKDOWN" | "NORMAL_EXPENSE" | null {
  if (value === "BREAKDOWN" || value === "NORMAL_EXPENSE") {
    return value;
  }
  return null;
}
