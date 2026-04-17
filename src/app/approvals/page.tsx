"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { useRegisterCopilotContext } from "@/components/layout/ai-copilot-context";
import { AccessGate } from "@/components/layout/access-gate";
import { FilterScopeBanner } from "@/components/layout/filter-scope-banner";
import { useAnalyticsFilters } from "@/components/layout/analytics-filters-provider";
import {
  scrollToFocusElement,
  useCopilotFocusTarget,
  type CopilotFocusTarget
} from "@/components/layout/copilot-focus-target";
import { useRole } from "@/components/layout/role-provider";
import type { WorkflowAssistModel } from "@/components/layout/workflow-assist-panel";
import {
  canManageDrillingApprovalActions,
  canManageExpenseApprovalActions,
  canManageInventoryApprovalActions
} from "@/lib/auth/approval-policy";
import { REQUISITION_APPROVAL_QUEUE_STATUS } from "@/lib/requisition-lifecycle";
import { formatCurrency } from "@/lib/utils";
import { ApprovalsWorkspaceCard } from "./approvals-workspace-card";
import { InventoryUsageBatchReviewModal } from "./inventory-usage-batch-review-modal";
import { buildApprovalWorkflowAssist } from "./approvals-page-assist";
import {
  mapReceiptSubmissionRows,
  type RawReceiptSubmissionRow
} from "./approvals-page-receipt-mapper";
import {
  type ApprovalTab,
  type DrillingApprovalRow,
  type InventoryUsageBatchApprovalRow,
  type InventoryUsageApprovalRow,
  type ReceiptSubmissionApprovalRow,
  type RequisitionApprovalRow
} from "./approvals-page-types";
import {
  APPROVAL_SECTION_IDS,
  approvalSeverityRank,
  buildApprovalCandidates,
  buildApprovalsHref,
  formatRequisitionType,
  getInventoryBatchPendingDate,
  getDrillingPendingDate,
  getInventoryPendingDate,
  getPendingAgeMeta,
  getReceiptSubmissionPendingDate,
  makeApprovalFocusRowId,
  readApiError,
  resolveApprovalSectionFromTargetId,
  resolveApprovalTabForFocus,
  toPendingTimestamp
} from "./approvals-page-utils";


export default function ApprovalsPage() {
  const { user } = useRole();
  const { filters } = useAnalyticsFilters();
  const [activeTab, setActiveTab] = useState<ApprovalTab>("requisitions");
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [drillingRows, setDrillingRows] = useState<DrillingApprovalRow[]>([]);
  const [requisitionRows, setRequisitionRows] = useState<RequisitionApprovalRow[]>([]);
  const [inventoryRows, setInventoryRows] = useState<InventoryUsageApprovalRow[]>([]);
  const [inventoryBatchRows, setInventoryBatchRows] = useState<InventoryUsageBatchApprovalRow[]>([]);
  const [receiptSubmissionRows, setReceiptSubmissionRows] = useState<ReceiptSubmissionApprovalRow[]>([]);
  const [drillingNotes, setDrillingNotes] = useState<Record<string, string>>({});
  const [requisitionNotes, setRequisitionNotes] = useState<Record<string, string>>({});
  const [inventoryNotes, setInventoryNotes] = useState<Record<string, string>>({});
  const [inventoryActionError, setInventoryActionError] = useState<string | null>(null);
  const [inventoryRowWarnings, setInventoryRowWarnings] = useState<Record<string, string>>({});
  const [inventoryActionToast, setInventoryActionToast] = useState<{
    tone: "success" | "error";
    message: string;
  } | null>(null);
  const [inventoryBatchReviewOpen, setInventoryBatchReviewOpen] = useState(false);
  const [selectedInventoryBatchId, setSelectedInventoryBatchId] = useState("");
  const [selectedInventoryBatch, setSelectedInventoryBatch] =
    useState<InventoryUsageBatchApprovalRow | null>(null);
  const [actingRowId, setActingRowId] = useState<string | null>(null);
  const [focusedRowId, setFocusedRowId] = useState<string | null>(null);
  const [focusedSectionId, setFocusedSectionId] = useState<string | null>(null);
  const [assistTarget, setAssistTarget] = useState<CopilotFocusTarget | null>(null);
  const canManageDrillingApprovals = canManageDrillingApprovalActions(user?.role);
  const canManageRequisitionApprovals = canManageExpenseApprovalActions(user?.role);
  const canManageInventoryApprovals = canManageInventoryApprovalActions(user?.role);

  const loadDrillingApprovals = useCallback(async () => {
    const search = new URLSearchParams();
    if (filters.from) search.set("from", filters.from);
    if (filters.to) search.set("to", filters.to);
    if (filters.clientId !== "all") search.set("clientId", filters.clientId);
    if (filters.rigId !== "all") search.set("rigId", filters.rigId);
    search.set("approvalStatus", "SUBMITTED");

    const response = await fetch(`/api/drilling-reports?${search.toString()}`, { cache: "no-store" });
    const payload = response.ok ? await response.json() : { data: [] };
    setDrillingRows(payload.data || []);
  }, [filters.clientId, filters.from, filters.rigId, filters.to]);

  const loadRequisitionApprovals = useCallback(async () => {
    const search = new URLSearchParams();
    search.set("status", REQUISITION_APPROVAL_QUEUE_STATUS);

    const response = await fetch(`/api/requisitions?${search.toString()}`, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(
        await readApiError(response, "Failed to load submitted purchase requisitions.")
      );
    }
    const payload = await response.json();
    setRequisitionRows(payload.data || []);
  }, []);

  const loadInventoryApprovals = useCallback(async () => {
    const search = new URLSearchParams();
    if (filters.from) search.set("from", filters.from);
    if (filters.to) search.set("to", filters.to);
    if (filters.clientId !== "all") search.set("clientId", filters.clientId);
    if (filters.rigId !== "all") search.set("rigId", filters.rigId);
    const response = await fetch(`/api/inventory/usage-requests?${search.toString()}`, { cache: "no-store" });
    const payload = response.ok ? await response.json() : { data: [] };
    const rows = payload.data || [];
    setInventoryRows(rows);
    setInventoryRowWarnings((current) => {
      const activeIds = new Set(rows.map((row: InventoryUsageApprovalRow) => row.id));
      return Object.fromEntries(Object.entries(current).filter(([rowId]) => activeIds.has(rowId)));
    });
  }, [filters.clientId, filters.from, filters.rigId, filters.to]);

  const loadInventoryBatchApprovals = useCallback(async () => {
    const search = new URLSearchParams();
    if (filters.from) search.set("from", filters.from);
    if (filters.to) search.set("to", filters.to);
    if (filters.clientId !== "all") search.set("clientId", filters.clientId);
    if (filters.rigId !== "all") search.set("rigId", filters.rigId);
    const response = await fetch(
      `/api/inventory/usage-requests/batches?${search.toString()}`,
      { cache: "no-store" }
    );
    const payload = response.ok ? await response.json() : { data: [] };
    setInventoryBatchRows(payload.data || []);
  }, [filters.clientId, filters.from, filters.rigId, filters.to]);

  const loadReceiptSubmissionApprovals = useCallback(async () => {
    const search = new URLSearchParams();
    if (filters.from) search.set("from", filters.from);
    if (filters.to) search.set("to", filters.to);
    if (filters.clientId !== "all") search.set("clientId", filters.clientId);
    if (filters.rigId !== "all") search.set("rigId", filters.rigId);
    search.set("status", "SUBMITTED");
    const response = await fetch(`/api/inventory/receipt-intake/submissions?${search.toString()}`, {
      cache: "no-store"
    });
    const payload = response.ok ? await response.json() : { data: [] };
    setReceiptSubmissionRows(
      mapReceiptSubmissionRows((payload.data || []) as RawReceiptSubmissionRow[])
    );
  }, [filters.clientId, filters.from, filters.rigId, filters.to]);

  const refreshApprovalsWorkspace = useCallback(async () => {
    setLoading(true);
    setActionError(null);
    try {
      const results = await Promise.allSettled([
        loadRequisitionApprovals(),
        loadDrillingApprovals(),
        loadInventoryApprovals(),
        loadInventoryBatchApprovals(),
        loadReceiptSubmissionApprovals()
      ]);
      const failure = results.find(
        (result): result is PromiseRejectedResult => result.status === "rejected"
      );
      if (failure) {
        const message =
          failure.reason instanceof Error
            ? failure.reason.message
            : "Failed to load one or more approval queues.";
        setActionError(message);
      }
    } finally {
      setLoading(false);
    }
  }, [
    loadDrillingApprovals,
    loadInventoryApprovals,
    loadInventoryBatchApprovals,
    loadReceiptSubmissionApprovals,
    loadRequisitionApprovals
  ]);

  useEffect(() => {
    void refreshApprovalsWorkspace();
  }, [refreshApprovalsWorkspace]);

  useEffect(() => {
    if (activeTab !== "inventory" && inventoryActionError) {
      setInventoryActionError(null);
    }
  }, [activeTab, inventoryActionError]);

  useEffect(() => {
    setActionError((current) => (current ? null : current));
  }, [activeTab]);

  const selectedClientName = useMemo(() => {
    if (filters.clientId === "all") {
      return null;
    }
    const drillingClient = drillingRows.find((entry) => entry.client.id === filters.clientId)?.client.name;
    if (drillingClient) {
      return drillingClient;
    }
    return null;
  }, [drillingRows, filters.clientId]);

  const selectedRigLabel = useMemo(() => {
    if (filters.rigId === "all") {
      return null;
    }
    const drillingRig = drillingRows.find((entry) => entry.rig.id === filters.rigId)?.rig.rigCode;
    if (drillingRig) {
      return drillingRig;
    }
    const batchRig =
      inventoryBatchRows.find((entry) => entry.rig?.id === filters.rigId)?.rig?.rigCode ||
      null;
    if (batchRig) {
      return batchRig;
    }
    return inventoryRows.find((entry) => entry.rig?.id === filters.rigId)?.rig?.rigCode || null;
  }, [drillingRows, filters.rigId, inventoryBatchRows, inventoryRows]);

  const updateRequisitionStatus = useCallback(
    async (requisitionId: string, action: "approve" | "reject") => {
      if (!canManageRequisitionApprovals) {
        setActionError("You do not have permission to approve or reject purchase requisitions.");
        return;
      }
      const note = requisitionNotes[requisitionId]?.trim() || "";
      if (action === "reject" && note.length < 3) {
        setActionError("Please enter a rejection reason (minimum 3 characters).");
        return;
      }

      setActionError(null);
      setActingRowId(requisitionId);
      try {
        const response = await fetch(`/api/requisitions/${requisitionId}/status`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            action,
            reason: action === "reject" ? note : undefined
          })
        });

        if (!response.ok) {
          throw new Error(await readApiError(response, "Failed to update requisition status."));
        }

        setNotice(
          action === "approve"
            ? "Purchase requisition approved."
            : "Purchase requisition rejected and returned to requester."
        );
        setRequisitionNotes((current) => ({ ...current, [requisitionId]: "" }));
        await refreshApprovalsWorkspace();
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to update requisition status.";
        setActionError(message);
      } finally {
        setActingRowId(null);
      }
    },
    [canManageRequisitionApprovals, requisitionNotes, refreshApprovalsWorkspace]
  );

  const updateDrillingStatus = useCallback(
    async (reportId: string, action: "approve" | "reject") => {
      if (!canManageDrillingApprovals) {
        setActionError("You do not have permission to approve or reject drilling reports.");
        return;
      }
      const reason = drillingNotes[reportId]?.trim() || "";
      if (action === "reject" && reason.length < 3) {
        setActionError("Please enter a rejection reason (minimum 3 characters).");
        return;
      }

      setActionError(null);
      setActingRowId(reportId);
      try {
        const response = await fetch(`/api/drilling-reports/${reportId}/status`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            action,
            reason: action === "reject" ? reason : undefined
          })
        });

        if (!response.ok) {
          throw new Error(await readApiError(response, "Failed to update drilling approval status."));
        }

        setNotice(action === "approve" ? "Drilling report approved." : "Drilling report rejected and returned to entry workflow.");
        await refreshApprovalsWorkspace();
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to update drilling approval status.";
        setActionError(message);
      } finally {
        setActingRowId(null);
      }
    },
    [canManageDrillingApprovals, drillingNotes, refreshApprovalsWorkspace]
  );

  const updateInventoryStatus = useCallback(
    async (requestId: string, action: "approve" | "reject") => {
      if (!canManageInventoryApprovals) {
        const message = "You do not have permission to approve or reject inventory usage requests.";
        setInventoryActionError(message);
        setInventoryActionToast({ tone: "error", message });
        return;
      }
      const note = inventoryNotes[requestId]?.trim() || "";
      if (action === "reject" && note.length < 3) {
        const message = "Please enter a rejection reason (minimum 3 characters).";
        setInventoryActionError(message);
        setInventoryActionToast({ tone: "error", message });
        return;
      }

      setInventoryActionError(null);
      setInventoryRowWarnings((current) => {
        if (!current[requestId]) {
          return current;
        }
        const next = { ...current };
        delete next[requestId];
        return next;
      });
      setActingRowId(requestId);
      try {
        const response = await fetch(`/api/inventory/usage-requests/${requestId}/status`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            action,
            note: note || undefined
          })
        });

        if (!response.ok) {
          throw new Error(await readApiError(response, "Failed to update inventory usage request."));
        }

        setNotice(
          action === "approve"
            ? "Inventory usage request approved and stock updated."
            : "Inventory usage request rejected."
        );
        setInventoryActionToast({
          tone: "success",
          message:
            action === "approve"
              ? "Inventory usage request approved. Stock was updated and history recorded."
              : "Inventory usage request rejected. No stock movement was recorded."
        });
        setInventoryActionError(null);
        setInventoryRowWarnings((current) => {
          if (!current[requestId]) {
            return current;
          }
          const next = { ...current };
          delete next[requestId];
          return next;
        });
        await refreshApprovalsWorkspace();
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to update inventory usage request.";
        if (message.toLowerCase().includes("not enough stock")) {
          const insufficientStockMessage = "Cannot approve: not enough stock available for this request.";
          setInventoryActionError(insufficientStockMessage);
          setInventoryActionToast({ tone: "error", message: insufficientStockMessage });
          setInventoryRowWarnings((current) => ({
            ...current,
            [requestId]: "Insufficient stock"
          }));
          return;
        }
        setInventoryActionError(message);
        setInventoryActionToast({ tone: "error", message });
      } finally {
        setActingRowId(null);
      }
    },
    [canManageInventoryApprovals, inventoryNotes, refreshApprovalsWorkspace]
  );

  const openInventoryBatchReview = useCallback((batchId: string) => {
    if (!batchId) {
      return;
    }
    setSelectedInventoryBatchId(batchId);
    setInventoryBatchReviewOpen(true);
  }, []);

  const closeInventoryBatchReview = useCallback(() => {
    setInventoryBatchReviewOpen(false);
    setSelectedInventoryBatchId("");
    setSelectedInventoryBatch(null);
  }, []);

  useEffect(() => {
    if (!inventoryBatchReviewOpen || !selectedInventoryBatchId) {
      setSelectedInventoryBatch(null);
      return;
    }
    let ignore = false;
    const query = new URLSearchParams();
    if (filters.from) query.set("from", filters.from);
    if (filters.to) query.set("to", filters.to);
    if (filters.clientId !== "all") query.set("clientId", filters.clientId);
    if (filters.rigId !== "all") query.set("rigId", filters.rigId);

    void (async () => {
      try {
        const response = await fetch(
          `/api/inventory/usage-requests/batches/${selectedInventoryBatchId}?${query.toString()}`,
          { cache: "no-store" }
        );
        if (!response.ok) {
          throw new Error(await readApiError(response, "Failed to load usage batch detail."));
        }
        const payload = (await response.json()) as {
          data?: InventoryUsageBatchApprovalRow;
        };
        if (!ignore) {
          setSelectedInventoryBatch(payload.data || null);
        }
      } catch (error) {
        if (!ignore) {
          setSelectedInventoryBatch(null);
          setInventoryActionError(
            error instanceof Error ? error.message : "Failed to load usage batch detail."
          );
        }
      }
    })();

    return () => {
      ignore = true;
    };
  }, [
    filters.clientId,
    filters.from,
    filters.rigId,
    filters.to,
    inventoryBatchReviewOpen,
    selectedInventoryBatchId
  ]);

  const submitInventoryBatchDecisions = useCallback(
    async (
      decisions: Array<{
        lineId: string;
        action: "approve" | "reject";
        note?: string;
      }>
    ) => {
      if (!canManageInventoryApprovals) {
        const message =
          "You do not have permission to approve or reject inventory usage batches.";
        setInventoryActionError(message);
        setInventoryActionToast({ tone: "error", message });
        return;
      }
      if (!selectedInventoryBatchId) {
        const message = "No usage batch selected.";
        setInventoryActionError(message);
        setInventoryActionToast({ tone: "error", message });
        return;
      }
      setInventoryActionError(null);
      setActingRowId(selectedInventoryBatchId);
      try {
        const response = await fetch(
          `/api/inventory/usage-requests/batches/${selectedInventoryBatchId}/decision`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json"
            },
            body: JSON.stringify({ decisions })
          }
        );
        if (!response.ok) {
          throw new Error(
            await readApiError(
              response,
              "Failed to submit inventory usage batch decisions."
            )
          );
        }
        setInventoryActionToast({
          tone: "success",
          message: "Inventory usage batch decisions submitted."
        });
        setNotice("Inventory usage batch decisions submitted.");
        setInventoryBatchReviewOpen(false);
        setSelectedInventoryBatchId("");
        setSelectedInventoryBatch(null);
        await refreshApprovalsWorkspace();
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Failed to submit inventory usage batch decisions.";
        setInventoryActionError(message);
        setInventoryActionToast({ tone: "error", message });
      } finally {
        setActingRowId(null);
      }
    },
    [canManageInventoryApprovals, refreshApprovalsWorkspace, selectedInventoryBatchId]
  );

  const sortedDrillingRows = useMemo(
    () => [...drillingRows].sort((a, b) => toPendingTimestamp(getDrillingPendingDate(a)) - toPendingTimestamp(getDrillingPendingDate(b))),
    [drillingRows]
  );
  const sortedRequisitionRows = useMemo(
    () =>
      [...requisitionRows].sort(
        (a, b) => toPendingTimestamp(b.submittedAt) - toPendingTimestamp(a.submittedAt)
      ),
    [requisitionRows]
  );
  const sortedInventoryRows = useMemo(
    () =>
      [...inventoryRows].sort(
        (a, b) => toPendingTimestamp(getInventoryPendingDate(a)) - toPendingTimestamp(getInventoryPendingDate(b))
      ),
    [inventoryRows]
  );
  const sortedInventoryBatchRows = useMemo(
    () =>
      [...inventoryBatchRows].sort(
        (a, b) =>
          toPendingTimestamp(getInventoryBatchPendingDate(a)) -
          toPendingTimestamp(getInventoryBatchPendingDate(b))
      ),
    [inventoryBatchRows]
  );
  const sortedReceiptSubmissionRows = useMemo(
    () =>
      [...receiptSubmissionRows].sort(
        (a, b) =>
          toPendingTimestamp(getReceiptSubmissionPendingDate(a)) - toPendingTimestamp(getReceiptSubmissionPendingDate(b))
      ),
    [receiptSubmissionRows]
  );
  const highValueReceiptThreshold = useMemo(() => {
    const totals = sortedReceiptSubmissionRows
      .map((row) => Number(row.summary.total || 0))
      .filter((value) => Number.isFinite(value) && value > 0)
      .sort((a, b) => b - a);
    if (totals.length === 0) {
      return 0;
    }
    const quartileIndex = Math.max(0, Math.ceil(totals.length * 0.25) - 1);
    return totals[quartileIndex] || totals[0] || 0;
  }, [sortedReceiptSubmissionRows]);

  const pendingSummary = useMemo(() => {
    const counts = {
      receiptSubmissions: receiptSubmissionRows.length,
      requisitions: requisitionRows.length,
      inventoryUsage: inventoryRows.length + inventoryBatchRows.length,
      drilling: drillingRows.length
    };
    const total =
      counts.receiptSubmissions +
      counts.requisitions +
      counts.inventoryUsage +
      counts.drilling;
    const buckets = {
      under24: 0,
      over24: 0,
      over3d: 0
    };
    const pendingDates = [
      ...drillingRows.map(getDrillingPendingDate),
      ...requisitionRows.map((row) => row.submittedAt),
      ...inventoryRows.map(getInventoryPendingDate),
      ...inventoryBatchRows.map(getInventoryBatchPendingDate),
      ...receiptSubmissionRows.map(getReceiptSubmissionPendingDate)
    ];
    for (const pendingAt of pendingDates) {
      const meta = getPendingAgeMeta(pendingAt);
      if (!meta) continue;
      if (meta.bucket === "OVER_3_DAYS") {
        buckets.over3d += 1;
      } else if (meta.bucket === "OVER_24_HOURS") {
        buckets.over24 += 1;
      } else {
        buckets.under24 += 1;
      }
    }

    const attentionEntries = [
      { key: "drilling", label: "Drilling Reports", count: counts.drilling },
      { key: "requisitions", label: "Purchase Requisitions", count: counts.requisitions },
      { key: "inventory", label: "Inventory Usage", count: counts.inventoryUsage },
      { key: "receipt", label: "Receipt Submissions", count: counts.receiptSubmissions }
    ].sort((a, b) => b.count - a.count);

    return {
      counts,
      total,
      buckets,
      mostAttention: attentionEntries[0] || null
    };
  }, [
    drillingRows,
    inventoryBatchRows,
    inventoryRows,
    receiptSubmissionRows,
    requisitionRows
  ]);

  const buildApprovalHref = useCallback(
    (extras?: Record<string, string | null | undefined>) =>
      buildApprovalsHref(
        {
          from: filters.from,
          to: filters.to,
          clientId: filters.clientId,
          rigId: filters.rigId
        },
        extras
      ),
    [filters.clientId, filters.from, filters.rigId, filters.to]
  );

  const approvalCandidates = useMemo(
    () =>
      buildApprovalCandidates({
        sortedDrillingRows,
        sortedInventoryBatchRows,
        sortedInventoryRows,
        sortedReceiptSubmissionRows,
        sortedRequisitionRows,
        buildHref: buildApprovalHref
      }),
    [
      buildApprovalHref,
      sortedDrillingRows,
      sortedInventoryBatchRows,
      sortedInventoryRows,
      sortedReceiptSubmissionRows,
      sortedRequisitionRows
    ]
  );

  const oldestPendingApproval = useMemo(
    () =>
      [...approvalCandidates]
        .filter((entry) => Number.isFinite(entry.pendingTimestamp) && entry.pendingTimestamp !== Number.MAX_SAFE_INTEGER)
        .sort((a, b) => a.pendingTimestamp - b.pendingTimestamp)[0] || null,
    [approvalCandidates]
  );

  const highestValuePendingApproval = useMemo(
    () =>
      [...approvalCandidates]
        .filter((entry) => entry.amount > 0)
        .sort((a, b) => b.amount - a.amount)[0] || null,
    [approvalCandidates]
  );

  const highestOperationalImpactApproval = useMemo(
    () =>
      [...approvalCandidates]
        .sort((a, b) => {
          const severityDiff = approvalSeverityRank(a.severity) - approvalSeverityRank(b.severity);
          if (severityDiff !== 0) {
            return severityDiff;
          }
          return b.score - a.score;
        })[0] || null,
    [approvalCandidates]
  );

  const bestNextApproval = useMemo(() => approvalCandidates[0] || null, [approvalCandidates]);

  const copilotContext = useMemo(
    () => ({
      pageKey: "approvals",
      pageName: "Approvals",
      filters: {
        clientId: filters.clientId === "all" ? null : filters.clientId,
        rigId: filters.rigId === "all" ? null : filters.rigId,
        from: filters.from || null,
        to: filters.to || null
      },
      summaryMetrics: [
        { key: "pendingReceiptSubmissions", label: "Pending receipt submissions", value: pendingSummary.counts.receiptSubmissions },
        { key: "pendingRequisitionApprovals", label: "Pending requisition approvals", value: pendingSummary.counts.requisitions },
        { key: "pendingInventoryUsageApprovals", label: "Pending inventory usage approvals", value: pendingSummary.counts.inventoryUsage },
        { key: "pendingDrillingApprovals", label: "Pending drilling approvals", value: pendingSummary.counts.drilling },
        { key: "totalPendingApprovals", label: "Total pending approvals", value: pendingSummary.total },
        { key: "pendingOver24Hours", label: "Pending over 24 hours", value: pendingSummary.buckets.over24 + pendingSummary.buckets.over3d },
        { key: "pendingOver3Days", label: "Pending over 3 days", value: pendingSummary.buckets.over3d },
        { key: "highestValuePendingApproval", label: "Highest value pending approval", value: highestValuePendingApproval?.amount || 0 },
        { key: "oldestPendingApproval", label: "Oldest pending approval", value: oldestPendingApproval?.label || "N/A" },
        { key: "bestNextApproval", label: "Best next approval to review", value: bestNextApproval?.label || "N/A" }
      ],
      tablePreviews: [
        {
          key: "approvals-requisitions",
          title: "Pending Purchase Requisitions",
          rowCount: sortedRequisitionRows.length,
          columns: ["requisitionCode", "type", "project", "rig", "estimatedTotal", "pendingHours"],
          rows: sortedRequisitionRows.slice(0, 8).map((row) => ({
            id: makeApprovalFocusRowId("requisition", row.id),
            requisitionCode: row.requisitionCode,
            type: formatRequisitionType(row.type),
            project: row.contextLabels?.projectName || row.context.projectId || "Unlinked",
            rig: row.contextLabels?.rigCode || row.context.rigId || "Unlinked",
            estimatedTotal: row.totals.estimatedTotalCost,
            pendingHours: Math.max(0, (Date.now() - toPendingTimestamp(row.submittedAt)) / (1000 * 60 * 60))
          }))
        },
        {
          key: "approvals-receipt-submissions",
          title: "Pending Receipt Submissions",
          rowCount: sortedReceiptSubmissionRows.length,
          columns: ["supplier", "receiptNumber", "tag", "priority", "total", "pendingHours"],
          rows: sortedReceiptSubmissionRows.slice(0, 8).map((row) => ({
            id: makeApprovalFocusRowId("receipt", row.id),
            supplier: row.summary.supplierName,
            receiptNumber: row.summary.receiptNumber,
            tag: row.classification.tag,
            priority: row.classification.priority,
            total: Number(row.summary.total || 0),
            pendingHours: Math.max(0, (Date.now() - toPendingTimestamp(getReceiptSubmissionPendingDate(row))) / (1000 * 60 * 60))
          }))
        },
        {
          key: "approvals-inventory-usage",
          title: "Pending Inventory Usage Approvals",
          rowCount: sortedInventoryRows.length + sortedInventoryBatchRows.length,
          columns: ["item", "qty", "rig", "project", "pendingHours"],
          rows: [
            ...sortedInventoryRows.slice(0, 6).map((row) => ({
              id: makeApprovalFocusRowId("inventory", row.id),
              item: row.item.name,
              qty: row.quantity,
              rig: row.rig?.rigCode || row.location?.name || "Unlinked",
              project: row.project?.name || "Unlinked",
              pendingHours: Math.max(
                0,
                (Date.now() - toPendingTimestamp(getInventoryPendingDate(row))) /
                  (1000 * 60 * 60)
              )
            })),
            ...sortedInventoryBatchRows.slice(0, 2).map((row) => ({
              id: makeApprovalFocusRowId("inventory", row.id),
              item: `${row.batchCode} (batch)`,
              qty: row.summary.totalQuantity,
              rig: row.rig?.rigCode || row.location?.name || "Unlinked",
              project: row.project?.name || "Unlinked",
              pendingHours: Math.max(
                0,
                (Date.now() - toPendingTimestamp(getInventoryBatchPendingDate(row))) /
                  (1000 * 60 * 60)
              )
            }))
          ]
        }
      ],
      priorityItems: [
        ...(oldestPendingApproval
          ? [
              {
                id: "approval-oldest-pending",
                label: `Oldest pending approval • ${oldestPendingApproval.label}`,
                reason: `Aged the longest in queue (${getPendingAgeMeta(oldestPendingApproval.pendingAt)?.label || "pending"}).`,
                severity: oldestPendingApproval.severity,
                amount: oldestPendingApproval.amount,
                href: oldestPendingApproval.href,
                issueType: "APPROVAL_BACKLOG",
                targetId: oldestPendingApproval.targetId,
                sectionId: oldestPendingApproval.sectionId,
                targetPageKey: "approvals",
                actionLabel: oldestPendingApproval.actionLabel,
                inspectHint: oldestPendingApproval.inspectHint
              }
            ]
          : []),
        ...(highestValuePendingApproval
          ? [
              {
                id: "approval-highest-value",
                label: `Highest value pending • ${highestValuePendingApproval.label}`,
                reason: `${formatCurrency(highestValuePendingApproval.amount)} is awaiting review.`,
                severity: "HIGH" as const,
                amount: highestValuePendingApproval.amount,
                href: highestValuePendingApproval.href,
                issueType: "APPROVAL_BACKLOG",
                targetId: highestValuePendingApproval.targetId,
                sectionId: highestValuePendingApproval.sectionId,
                targetPageKey: "approvals",
                actionLabel: highestValuePendingApproval.actionLabel,
                inspectHint: highestValuePendingApproval.inspectHint
              }
            ]
          : []),
        ...(highestOperationalImpactApproval
          ? [
              {
                id: "approval-operational-impact",
                label: `Highest operational impact • ${highestOperationalImpactApproval.label}`,
                reason: highestOperationalImpactApproval.reason,
                severity: highestOperationalImpactApproval.severity,
                amount: highestOperationalImpactApproval.amount,
                href: highestOperationalImpactApproval.href,
                issueType: highestOperationalImpactApproval.issueType,
                targetId: highestOperationalImpactApproval.targetId,
                sectionId: highestOperationalImpactApproval.sectionId,
                targetPageKey: "approvals",
                actionLabel: highestOperationalImpactApproval.actionLabel,
                inspectHint: highestOperationalImpactApproval.inspectHint
              }
            ]
          : []),
        ...(bestNextApproval
          ? [
              {
                id: "approval-best-next",
                label: `Best next approval • ${bestNextApproval.label}`,
                reason: bestNextApproval.reason,
                severity: bestNextApproval.severity,
                amount: bestNextApproval.amount,
                href: bestNextApproval.href,
                issueType: bestNextApproval.issueType,
                targetId: bestNextApproval.targetId,
                sectionId: bestNextApproval.sectionId,
                targetPageKey: "approvals",
                actionLabel: bestNextApproval.actionLabel,
                inspectHint: bestNextApproval.inspectHint
              }
            ]
          : []),
        ...approvalCandidates.slice(0, 8).map((entry) => ({
          id: entry.id,
          label: entry.label,
          reason: entry.reason,
          severity: entry.severity,
          amount: entry.amount,
          href: entry.href,
          issueType: entry.issueType,
          targetId: entry.targetId,
          sectionId: entry.sectionId,
          targetPageKey: "approvals" as const,
          actionLabel: entry.actionLabel,
          inspectHint: entry.inspectHint
        }))
      ],
      navigationTargets: [
        {
          label: "Open requisition approvals",
          href: buildApprovalHref({ tab: "requisitions" }),
          reason: "Review submitted purchase requisitions before procurement proceeds.",
          actionLabel: "Review approval",
          inspectHint: "Inspect requisition type, operational context, and total estimate.",
          pageKey: "approvals",
          sectionId: APPROVAL_SECTION_IDS.requisitions
        },
        {
          label: "Open receipt submissions",
          href: buildApprovalHref(),
          reason: "Review pending receipt submissions first.",
          actionLabel: "Review approval",
          inspectHint: "Inspect receipt type, amount, and operational context.",
          pageKey: "approvals",
          sectionId: APPROVAL_SECTION_IDS.receipts
        },
        {
          label: "Open drilling approvals",
          href: buildApprovalHref({ tab: "drilling" }),
          reason: "Review pending drilling report approvals.",
          actionLabel: "Review approval",
          inspectHint: "Inspect production values and reviewer notes.",
          pageKey: "approvals",
          sectionId: APPROVAL_SECTION_IDS.drilling
        },
        {
          label: "Open inventory usage approvals",
          href: buildApprovalHref({ tab: "inventory" }),
          reason: "Review inventory usage requests before stock decisions.",
          actionLabel: "Review approval",
          inspectHint: "Inspect quantity, maintenance linkage, and stock impact.",
          pageKey: "approvals",
          sectionId: APPROVAL_SECTION_IDS.inventory
        }
      ],
      notes: ["Approval copilot guidance is advisory-only and does not approve or reject requests automatically."]
    }),
    [
      approvalCandidates,
      bestNextApproval,
      buildApprovalHref,
      filters.clientId,
      filters.from,
      filters.rigId,
      filters.to,
      highestOperationalImpactApproval,
      highestValuePendingApproval,
      oldestPendingApproval,
      pendingSummary.buckets.over24,
      pendingSummary.buckets.over3d,
      pendingSummary.counts.drilling,
      pendingSummary.counts.inventoryUsage,
      pendingSummary.counts.requisitions,
      pendingSummary.counts.receiptSubmissions,
      pendingSummary.total,
      sortedInventoryBatchRows,
      sortedInventoryRows,
      sortedRequisitionRows,
      sortedReceiptSubmissionRows
    ]
  );

  useRegisterCopilotContext(copilotContext);

  useCopilotFocusTarget({
    pageKey: "approvals",
    onFocus: (target) => {
      setAssistTarget(target);
      const nextTab = resolveApprovalTabForFocus(target.sectionId, target.targetId);
      if (nextTab) {
        setActiveTab(nextTab);
      }
      const nextSectionId = target.sectionId || resolveApprovalSectionFromTargetId(target.targetId);
      setFocusedRowId(target.targetId || null);
      setFocusedSectionId(nextSectionId || null);
      const delay = nextTab && nextTab !== activeTab ? 120 : 0;
      window.setTimeout(() => {
        scrollToFocusElement({
          sectionId: nextSectionId,
          targetId: target.targetId
        });
      }, delay);
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
    return () => window.clearTimeout(timeout);
  }, [focusedRowId, focusedSectionId]);

  useEffect(() => {
    if (!assistTarget) {
      return;
    }
    const timeout = window.setTimeout(() => setAssistTarget(null), 7000);
    return () => window.clearTimeout(timeout);
  }, [assistTarget]);

  useEffect(() => {
    if (!inventoryActionToast) {
      return;
    }
    const timeout = window.setTimeout(() => setInventoryActionToast(null), 4200);
    return () => window.clearTimeout(timeout);
  }, [inventoryActionToast]);

  const focusedReceiptRow = useMemo(
    () =>
      sortedReceiptSubmissionRows.find(
        (row) => makeApprovalFocusRowId("receipt", row.id) === focusedRowId
      ) || null,
    [focusedRowId, sortedReceiptSubmissionRows]
  );
  const focusedDrillingRow = useMemo(
    () =>
      sortedDrillingRows.find((row) => makeApprovalFocusRowId("drilling", row.id) === focusedRowId) ||
      null,
    [focusedRowId, sortedDrillingRows]
  );
  const focusedInventoryRow = useMemo(
    () =>
      sortedInventoryRows.find((row) => makeApprovalFocusRowId("inventory", row.id) === focusedRowId) ||
      null,
    [focusedRowId, sortedInventoryRows]
  );

  const approvalWorkflowAssist = useMemo<WorkflowAssistModel | null>(
    () =>
      buildApprovalWorkflowAssist({
        assistTarget,
        focusedReceiptRow,
        focusedDrillingRow,
        focusedInventoryRow,
        inventoryRowWarnings,
        userRole: user?.role || null
      }),
    [
      assistTarget,
      focusedDrillingRow,
      focusedInventoryRow,
      focusedReceiptRow,
      inventoryRowWarnings,
      user?.role
    ]
  );

  return (
    <AccessGate denyBehavior="redirect" permission="reports:view">
      <div className="gf-page-stack">
        {notice && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            {notice}
          </div>
        )}
        {actionError && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {actionError}
          </div>
        )}
        {inventoryActionError && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {inventoryActionError}
          </div>
        )}
        {inventoryActionToast && (
          <aside className="pointer-events-none fixed bottom-5 right-5 z-[91] w-[min(420px,calc(100vw-2rem))]">
            <div
              className={`pointer-events-auto rounded-2xl border px-3.5 py-3 shadow-[0_16px_36px_rgba(15,23,42,0.16)] backdrop-blur-sm ${
                inventoryActionToast.tone === "success"
                  ? "border-emerald-200 bg-white/95 text-emerald-900"
                  : "border-red-200 bg-white/95 text-red-900"
              }`}
            >
              <p className="text-xs font-semibold uppercase tracking-wide">
                {inventoryActionToast.tone === "success" ? "Inventory Request Updated" : "Inventory Request Attention"}
              </p>
              <p className="mt-1 text-sm leading-5">{inventoryActionToast.message}</p>
              <button
                type="button"
                onClick={() => setInventoryActionToast(null)}
                className="mt-2 text-xs font-semibold underline underline-offset-2"
              >
                Dismiss
              </button>
            </div>
          </aside>
        )}

        <FilterScopeBanner filters={filters} clientLabel={selectedClientName} rigLabel={selectedRigLabel} />

        <div
          id={APPROVAL_SECTION_IDS.summary}
          className={
            focusedSectionId === APPROVAL_SECTION_IDS.summary
              ? "rounded-2xl ring-2 ring-indigo-100 ring-offset-2 ring-offset-slate-50"
              : undefined
          }
        >
        <ApprovalsWorkspaceCard
          activeTab={activeTab}
          approvalWorkflowAssist={approvalWorkflowAssist}
          actingRowId={actingRowId}
          canManageDrillingApprovals={canManageDrillingApprovals}
          canManageInventoryApprovals={canManageInventoryApprovals}
          canManageRequisitionApprovals={canManageRequisitionApprovals}
          focusedRowId={focusedRowId}
          focusedSectionId={focusedSectionId}
          highValueReceiptThreshold={highValueReceiptThreshold}
          inventoryNotes={inventoryNotes}
          inventoryRowWarnings={inventoryRowWarnings}
          loading={loading}
          pendingSummary={pendingSummary}
          requisitionNotes={requisitionNotes}
          drillingNotes={drillingNotes}
          sortedDrillingRows={sortedDrillingRows}
          sortedInventoryBatchRows={sortedInventoryBatchRows}
          sortedInventoryRows={sortedInventoryRows}
          sortedReceiptSubmissionRows={sortedReceiptSubmissionRows}
          sortedRequisitionRows={sortedRequisitionRows}
          onDrillingNoteChange={(rowId, value) =>
            setDrillingNotes((current) => ({
              ...current,
              [rowId]: value
            }))
          }
          onDrillingStatus={(rowId, action) => void updateDrillingStatus(rowId, action)}
          onOpenInventoryBatchReview={openInventoryBatchReview}
          onInventoryNoteChange={(rowId, value) =>
            setInventoryNotes((current) => ({
              ...current,
              [rowId]: value
            }))
          }
          onInventoryStatus={(rowId, action) => void updateInventoryStatus(rowId, action)}
          onRequisitionNoteChange={(rowId, value) =>
            setRequisitionNotes((current) => ({
              ...current,
              [rowId]: value
            }))
          }
          onRequisitionStatus={(rowId, action) => void updateRequisitionStatus(rowId, action)}
          onTabChange={setActiveTab}
        />
        </div>

        <InventoryUsageBatchReviewModal
          open={inventoryBatchReviewOpen}
          onClose={closeInventoryBatchReview}
          batch={selectedInventoryBatch}
          canManageInventoryApprovals={canManageInventoryApprovals}
          submitting={Boolean(
            actingRowId && selectedInventoryBatchId && actingRowId === selectedInventoryBatchId
          )}
          onSubmit={submitInventoryBatchDecisions}
        />
      </div>
    </AccessGate>
  );
}
