"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

import { AccessGate } from "@/components/layout/access-gate";
import { useRegisterCopilotContext } from "@/components/layout/ai-copilot-context";
import { scrollToFocusElement, useCopilotFocusTarget } from "@/components/layout/copilot-focus-target";
import { useRole } from "@/components/layout/role-provider";
import type { CopilotPageContext } from "@/lib/ai/contextual-copilot";
import { canAccess } from "@/lib/auth/permissions";
import { REQUISITION_RECEIPT_ELIGIBLE_STATUS } from "@/lib/requisition-lifecycle";
import { MetricCard } from "@/components/ui/card";
import { formatCurrency } from "@/lib/utils";
import { ReceiptIntakeHistorySection } from "./receipt-intake-history-section";
import { ReceiptIntakeScanSection } from "./receipt-intake-scan-section";
import type {
  ApprovedRequisitionRow,
  ReceiptEntryMode,
  ReceiptInputMethod,
  ReceiptMovementRow,
  ReceiptSubmissionDetail,
  ReceiptSubmissionSummary,
  ReferenceClient,
  ReferenceItem,
  ReferenceLocation,
  ReferenceMaintenanceRequest,
  ReferenceProject,
  ReferenceRig,
  ReferenceSupplier,
  RequisitionPrefill
} from "./receipt-intake-page-types";
import {
  countSubmissionStatus,
  normalizeLiveProjectSpendType,
  normalizeOptionalId,
  normalizeRequisitionType,
  toIsoDate
} from "./receipt-intake-page-utils";

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
    const submittedCount = countSubmissionStatus(submissions, "SUBMITTED");
    const approvedCount = countSubmissionStatus(submissions, "APPROVED");
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
    <AccessGate denyBehavior="redirect" permission="inventory:view">
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
          <ReceiptIntakeScanSection
            focusedSectionId={focusedSectionId}
            canManage={canManage}
            activeRequisitionPrefill={activeRequisitionPrefill}
            submissionLoading={submissionLoading}
            canRenderReceiptPanel={canRenderReceiptPanel}
            entryMode={entryMode}
            receiptInputMethod={receiptInputMethod}
            items={items}
            suppliers={suppliers}
            locations={locations}
            maintenanceRequests={maintenanceRequests}
            clients={clients}
            projects={projects}
            rigs={rigs}
            activeSubmission={activeSubmission}
            onGuidedStepChange={setPanelGuidedStep}
            onCompleted={loadData}
          />
        )}

        {currentView === "history" && (
          <ReceiptIntakeHistorySection
            focusedSectionId={focusedSectionId}
            loading={loading}
            submissions={submissions}
            canManage={canManage}
            historyRows={historyRows}
            onRejectSubmission={rejectSubmission}
          />
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
