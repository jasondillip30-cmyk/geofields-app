"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";

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
import { WorkflowAssistPanel, type WorkflowAssistModel } from "@/components/layout/workflow-assist-panel";
import { Card, MetricCard } from "@/components/ui/card";
import {
  canManageDrillingApprovalActions,
  canManageInventoryApprovalActions,
  canManageMaintenanceApprovalActions
} from "@/lib/auth/approval-policy";
import {
  deriveReceiptApprovalClassification,
  normalizeReceiptPurpose,
  normalizeReceiptType,
  type ReceiptApprovalClassification,
  type ReceiptPriority,
  type ReceiptPurpose,
  type ReceiptSpendTag,
  type ReceiptStockUse,
  type ReceiptType
} from "@/lib/receipt-approval-classification";
import { formatCurrency, formatNumber } from "@/lib/utils";

type ApprovalTab = "drilling" | "maintenance" | "inventory";

interface DrillingApprovalRow {
  id: string;
  date: string;
  submittedAt?: string | null;
  holeNumber: string;
  totalMetersDrilled: number;
  workHours: number;
  approvalStatus: "SUBMITTED";
  project: { id: string; name: string };
  client: { id: string; name: string };
  rig: { id: string; rigCode: string };
  submittedBy: { id: string; fullName: string } | null;
}

interface MaintenanceApprovalRow {
  id: string;
  date: string;
  requestDate?: string;
  createdAt?: string;
  issueType: string;
  issueDescription: string;
  urgency: string;
  status: "SUBMITTED";
  rig: { id: string; rigCode: string } | null;
  client: { id: string; name: string } | null;
  mechanic: { id: string; fullName: string } | null;
}

interface InventoryUsageApprovalRow {
  id: string;
  quantity: number;
  reason: string;
  status: "SUBMITTED" | "PENDING";
  createdAt: string;
  requestedForDate: string | null;
  item: { id: string; name: string; sku: string };
  project: { id: string; name: string; clientId: string } | null;
  rig: { id: string; rigCode: string } | null;
  maintenanceRequest: { id: string; requestCode: string; status: string } | null;
  location: { id: string; name: string } | null;
  requestedBy: { id: string; fullName: string; role: string } | null;
}

interface ReceiptSubmissionApprovalRow {
  id: string;
  reportDate: string;
  submittedAt: string | null;
  status: "SUBMITTED" | "APPROVED" | "REJECTED";
  summary: {
    supplierName: string;
    receiptNumber: string;
    verificationCode: string;
    serialNumber: string;
    receiptDate: string;
    total: number;
    traReceiptNumber: string;
  };
  receiptType: ReceiptType;
  receiptPurpose: ReceiptPurpose;
  linkContext: {
    clientId: string | null;
    projectId: string | null;
    rigId: string | null;
    maintenanceRequestId: string | null;
    locationFromId: string | null;
    locationToId: string | null;
  };
  classification: ReceiptApprovalClassification;
}

export default function ApprovalsPage() {
  const { user } = useRole();
  const { filters } = useAnalyticsFilters();
  const [activeTab, setActiveTab] = useState<ApprovalTab>("drilling");
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [drillingRows, setDrillingRows] = useState<DrillingApprovalRow[]>([]);
  const [maintenanceRows, setMaintenanceRows] = useState<MaintenanceApprovalRow[]>([]);
  const [inventoryRows, setInventoryRows] = useState<InventoryUsageApprovalRow[]>([]);
  const [receiptSubmissionRows, setReceiptSubmissionRows] = useState<ReceiptSubmissionApprovalRow[]>([]);
  const [drillingNotes, setDrillingNotes] = useState<Record<string, string>>({});
  const [maintenanceNotes, setMaintenanceNotes] = useState<Record<string, string>>({});
  const [inventoryNotes, setInventoryNotes] = useState<Record<string, string>>({});
  const [inventoryActionError, setInventoryActionError] = useState<string | null>(null);
  const [inventoryRowWarnings, setInventoryRowWarnings] = useState<Record<string, string>>({});
  const [inventoryActionToast, setInventoryActionToast] = useState<{
    tone: "success" | "error";
    message: string;
  } | null>(null);
  const [actingRowId, setActingRowId] = useState<string | null>(null);
  const [focusedRowId, setFocusedRowId] = useState<string | null>(null);
  const [focusedSectionId, setFocusedSectionId] = useState<string | null>(null);
  const [assistTarget, setAssistTarget] = useState<CopilotFocusTarget | null>(null);
  const canManageDrillingApprovals = canManageDrillingApprovalActions(user?.role);
  const canManageMaintenanceApprovals = canManageMaintenanceApprovalActions(user?.role);
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

  const loadMaintenanceApprovals = useCallback(async () => {
    const search = new URLSearchParams();
    if (filters.from) search.set("from", filters.from);
    if (filters.to) search.set("to", filters.to);
    if (filters.clientId !== "all") search.set("clientId", filters.clientId);
    if (filters.rigId !== "all") search.set("rigId", filters.rigId);
    search.set("status", "SUBMITTED");

    const response = await fetch(`/api/maintenance-requests?${search.toString()}`, { cache: "no-store" });
    const payload = response.ok ? await response.json() : { data: [] };
    setMaintenanceRows(payload.data || []);
  }, [filters.clientId, filters.from, filters.rigId, filters.to]);

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
      (
        (payload.data || []) as Array<{
          id: string;
          reportDate: string;
          submittedAt?: string;
          status?: string;
          summary?: {
            supplierName?: string;
            receiptNumber?: string;
            verificationCode?: string;
            serialNumber?: string;
            receiptDate?: string;
            total?: number;
            traReceiptNumber?: string;
          };
          classification?: {
            tag?: string;
            priority?: string;
            stockUse?: string | null;
            contextLabel?: string;
          };
          receiptType?: string;
          receiptPurpose?: string;
          linkContext?: {
            clientId?: string;
            projectId?: string;
            rigId?: string;
            maintenanceRequestId?: string;
            locationFromId?: string;
            locationToId?: string;
          };
        }>
      ).map((entry) => {
        const receiptType = normalizeReceiptType(entry.receiptType);
        const receiptPurpose = normalizeReceiptPurpose(entry.receiptPurpose);
        const linkContext = {
          clientId: normalizeOptionalId(entry.linkContext?.clientId),
          projectId: normalizeOptionalId(entry.linkContext?.projectId),
          rigId: normalizeOptionalId(entry.linkContext?.rigId),
          maintenanceRequestId: normalizeOptionalId(entry.linkContext?.maintenanceRequestId),
          locationFromId: normalizeOptionalId(entry.linkContext?.locationFromId),
          locationToId: normalizeOptionalId(entry.linkContext?.locationToId)
        };
        const fallbackClassification = deriveReceiptApprovalClassification({
          receiptType,
          receiptPurpose,
          maintenanceRequestId: linkContext.maintenanceRequestId
        });
        const classification = {
          tag: normalizeReceiptTag(entry.classification?.tag) || fallbackClassification.tag,
          priority: normalizeReceiptPriority(entry.classification?.priority) || fallbackClassification.priority,
          stockUse: normalizeReceiptStockUse(entry.classification?.stockUse) ?? fallbackClassification.stockUse,
          contextLabel: entry.classification?.contextLabel?.trim() || fallbackClassification.contextLabel
        };
        return {
        id: entry.id,
        reportDate: entry.reportDate,
        submittedAt: entry.submittedAt || null,
        status: normalizeSubmissionStatus(entry.status),
        summary: {
          supplierName: entry.summary?.supplierName?.trim() || "-",
          receiptNumber: entry.summary?.receiptNumber?.trim() || "-",
          verificationCode: entry.summary?.verificationCode?.trim() || "",
          serialNumber: entry.summary?.serialNumber?.trim() || "",
          receiptDate: entry.summary?.receiptDate?.trim() || "",
          total: Number(entry.summary?.total || 0),
          traReceiptNumber: entry.summary?.traReceiptNumber?.trim() || ""
        },
        receiptType,
        receiptPurpose,
        linkContext,
        classification
      };
      })
    );
  }, [filters.clientId, filters.from, filters.rigId, filters.to]);

  const refreshApprovalsWorkspace = useCallback(async () => {
    setLoading(true);
    try {
      await Promise.all([
        loadDrillingApprovals(),
        loadMaintenanceApprovals(),
        loadInventoryApprovals(),
        loadReceiptSubmissionApprovals()
      ]);
    } finally {
      setLoading(false);
    }
  }, [loadDrillingApprovals, loadInventoryApprovals, loadMaintenanceApprovals, loadReceiptSubmissionApprovals]);

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
    const maintenanceClient = maintenanceRows.find((entry) => entry.client?.id === filters.clientId)?.client?.name;
    if (maintenanceClient) {
      return maintenanceClient;
    }
    return null;
  }, [drillingRows, filters.clientId, maintenanceRows]);

  const selectedRigLabel = useMemo(() => {
    if (filters.rigId === "all") {
      return null;
    }
    const drillingRig = drillingRows.find((entry) => entry.rig.id === filters.rigId)?.rig.rigCode;
    if (drillingRig) {
      return drillingRig;
    }
    const maintenanceRig = maintenanceRows.find((entry) => entry.rig?.id === filters.rigId)?.rig?.rigCode;
    if (maintenanceRig) {
      return maintenanceRig;
    }
    return inventoryRows.find((entry) => entry.rig?.id === filters.rigId)?.rig?.rigCode || null;
  }, [drillingRows, filters.rigId, inventoryRows, maintenanceRows]);

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

  const updateMaintenanceStatus = useCallback(
    async (requestId: string, action: "approve" | "reject") => {
      if (!canManageMaintenanceApprovals) {
        setActionError("You do not have permission to approve or reject maintenance requests.");
        return;
      }
      const comment = maintenanceNotes[requestId]?.trim() || "";
      if (action === "reject" && comment.length < 3) {
        setActionError("Please enter a rejection reason (minimum 3 characters).");
        return;
      }
      setActionError(null);
      setActingRowId(requestId);
      try {
        const response = await fetch("/api/maintenance-requests", {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            requestId,
            action,
            comment: comment || undefined
          })
        });

        if (!response.ok) {
          throw new Error(await readApiError(response, "Failed to update maintenance approval status."));
        }

        setNotice(
          action === "approve"
            ? "Maintenance request approved."
            : "Maintenance request rejected and returned to maintenance workflow."
        );
        await refreshApprovalsWorkspace();
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to update maintenance approval status.";
        setActionError(message);
      } finally {
        setActingRowId(null);
      }
    },
    [canManageMaintenanceApprovals, maintenanceNotes, refreshApprovalsWorkspace]
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

  const sortedDrillingRows = useMemo(
    () => [...drillingRows].sort((a, b) => toPendingTimestamp(getDrillingPendingDate(a)) - toPendingTimestamp(getDrillingPendingDate(b))),
    [drillingRows]
  );
  const sortedMaintenanceRows = useMemo(
    () =>
      [...maintenanceRows].sort(
        (a, b) =>
          toPendingTimestamp(getMaintenancePendingDate(a)) - toPendingTimestamp(getMaintenancePendingDate(b))
      ),
    [maintenanceRows]
  );
  const sortedInventoryRows = useMemo(
    () =>
      [...inventoryRows].sort(
        (a, b) => toPendingTimestamp(getInventoryPendingDate(a)) - toPendingTimestamp(getInventoryPendingDate(b))
      ),
    [inventoryRows]
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
      maintenance: maintenanceRows.length,
      inventoryUsage: inventoryRows.length,
      drilling: drillingRows.length
    };
    const total = counts.receiptSubmissions + counts.maintenance + counts.inventoryUsage + counts.drilling;
    const buckets = {
      under24: 0,
      over24: 0,
      over3d: 0
    };
    const pendingDates = [
      ...drillingRows.map(getDrillingPendingDate),
      ...maintenanceRows.map(getMaintenancePendingDate),
      ...inventoryRows.map(getInventoryPendingDate),
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
      { key: "maintenance", label: "Maintenance", count: counts.maintenance },
      { key: "inventory", label: "Inventory Usage", count: counts.inventoryUsage },
      { key: "receipt", label: "Receipt Submissions", count: counts.receiptSubmissions }
    ].sort((a, b) => b.count - a.count);

    return {
      counts,
      total,
      buckets,
      mostAttention: attentionEntries[0] || null
    };
  }, [drillingRows, inventoryRows, maintenanceRows, receiptSubmissionRows]);

  const buildApprovalHref = useCallback(
    (extras?: Record<string, string | null | undefined>) => {
      const search = new URLSearchParams();
      if (filters.from) search.set("from", filters.from);
      if (filters.to) search.set("to", filters.to);
      if (filters.clientId !== "all") search.set("clientId", filters.clientId);
      if (filters.rigId !== "all") search.set("rigId", filters.rigId);
      Object.entries(extras || {}).forEach(([key, value]) => {
        if (!value) {
          return;
        }
        search.set(key, value);
      });
      const query = search.toString();
      return query ? `/approvals?${query}` : "/approvals";
    },
    [filters.clientId, filters.from, filters.rigId, filters.to]
  );

  const approvalCandidates = useMemo(() => {
    const candidates: Array<{
      id: string;
      label: string;
      reason: string;
      severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
      amount: number;
      pendingAt: string;
      pendingTimestamp: number;
      issueType: string;
      href: string;
      targetId: string;
      sectionId: string;
      actionLabel: string;
      inspectHint: string;
      targetPageKey: "approvals";
      score: number;
    }> = [];

    sortedDrillingRows.slice(0, 6).forEach((row) => {
      const pendingAt = getDrillingPendingDate(row);
      const pendingMeta = getPendingAgeMeta(pendingAt);
      const pendingTimestamp = toPendingTimestamp(pendingAt);
      const severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" =
        pendingMeta?.bucket === "OVER_3_DAYS" ? "HIGH" : pendingMeta?.bucket === "OVER_24_HOURS" ? "MEDIUM" : "LOW";
      const score = (severity === "HIGH" ? 40 : severity === "MEDIUM" ? 24 : 10) + (row.totalMetersDrilled > 200 ? 12 : 0);
      candidates.push({
        id: `approval-drilling-${row.id}`,
        label: `Drilling approval • ${row.project.name} / ${row.holeNumber}`,
        reason: `${row.rig.rigCode} report pending ${pendingMeta?.label || "review"}.`,
        severity,
        amount: row.totalMetersDrilled,
        pendingAt,
        pendingTimestamp,
        issueType: "APPROVAL_BACKLOG",
        href: buildApprovalHref({ tab: "drilling" }),
        targetId: makeApprovalFocusRowId("drilling", row.id),
        sectionId: APPROVAL_SECTION_IDS.drilling,
        actionLabel: "Review approval",
        inspectHint: "Inspect meters, work hours, and comments before approve/reject.",
        targetPageKey: "approvals",
        score
      });
    });

    sortedMaintenanceRows.slice(0, 8).forEach((row) => {
      const pendingAt = getMaintenancePendingDate(row);
      const pendingMeta = getPendingAgeMeta(pendingAt);
      const pendingTimestamp = toPendingTimestamp(pendingAt);
      const isCriticalUrgency = /critical|high/i.test(row.urgency || "");
      const severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" = isCriticalUrgency
        ? "CRITICAL"
        : pendingMeta?.bucket === "OVER_3_DAYS"
          ? "HIGH"
          : pendingMeta?.bucket === "OVER_24_HOURS"
            ? "MEDIUM"
            : "LOW";
      const score =
        (severity === "CRITICAL" ? 62 : severity === "HIGH" ? 38 : severity === "MEDIUM" ? 20 : 10) +
        (row.rig ? 8 : 0);
      candidates.push({
        id: `approval-maintenance-${row.id}`,
        label: `Maintenance approval • ${row.rig?.rigCode || "Unassigned rig"}`,
        reason: `${row.issueType || "General"} issue pending ${pendingMeta?.label || "review"}.`,
        severity,
        amount: isCriticalUrgency ? 1 : 0,
        pendingAt,
        pendingTimestamp,
        issueType: "MAINTENANCE",
        href: buildApprovalHref({ tab: "maintenance" }),
        targetId: makeApprovalFocusRowId("maintenance", row.id),
        sectionId: APPROVAL_SECTION_IDS.maintenance,
        actionLabel: "Review maintenance",
        inspectHint: "Inspect urgency, rig impact, and resolution note before decision.",
        targetPageKey: "approvals",
        score
      });
    });

    sortedInventoryRows.slice(0, 8).forEach((row) => {
      const pendingAt = getInventoryPendingDate(row);
      const pendingMeta = getPendingAgeMeta(pendingAt);
      const pendingTimestamp = toPendingTimestamp(pendingAt);
      const hasMaintenanceLink = Boolean(row.maintenanceRequest?.id);
      const severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" = hasMaintenanceLink
        ? "HIGH"
        : pendingMeta?.bucket === "OVER_3_DAYS"
          ? "HIGH"
          : pendingMeta?.bucket === "OVER_24_HOURS"
            ? "MEDIUM"
            : "LOW";
      const score =
        (severity === "HIGH" ? 34 : severity === "MEDIUM" ? 18 : 10) +
        (hasMaintenanceLink ? 18 : 0) +
        Math.min(12, row.quantity);
      candidates.push({
        id: `approval-inventory-${row.id}`,
        label: `Inventory usage • ${row.item.name}`,
        reason: `${formatNumber(row.quantity)} requested${hasMaintenanceLink ? " for linked maintenance" : ""}; pending ${pendingMeta?.label || "review"}.`,
        severity,
        amount: row.quantity,
        pendingAt,
        pendingTimestamp,
        issueType: "APPROVAL_BACKLOG",
        href: buildApprovalHref({ tab: "inventory" }),
        targetId: makeApprovalFocusRowId("inventory", row.id),
        sectionId: APPROVAL_SECTION_IDS.inventory,
        actionLabel: "Review approval",
        inspectHint: "Inspect stock impact, request reason, and linked rig/project before decision.",
        targetPageKey: "approvals",
        score
      });
    });

    sortedReceiptSubmissionRows.slice(0, 10).forEach((row) => {
      const pendingAt = getReceiptSubmissionPendingDate(row);
      const pendingMeta = getPendingAgeMeta(pendingAt);
      const pendingTimestamp = toPendingTimestamp(pendingAt);
      const severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" =
        row.classification.priority === "HIGH"
          ? "HIGH"
          : pendingMeta?.bucket === "OVER_3_DAYS"
            ? "HIGH"
            : pendingMeta?.bucket === "OVER_24_HOURS"
              ? "MEDIUM"
              : "LOW";
      const totalAmount = Number(row.summary.total || 0);
      const score =
        (severity === "HIGH" ? 34 : severity === "MEDIUM" ? 18 : 10) +
        Math.min(24, Math.round(totalAmount / 10000));
      candidates.push({
        id: `approval-receipt-${row.id}`,
        label: `Receipt submission • ${row.summary.supplierName}`,
        reason: `${row.classification.tag} receipt (${formatCurrency(totalAmount)}) pending ${pendingMeta?.label || "review"}.`,
        severity,
        amount: totalAmount,
        pendingAt,
        pendingTimestamp,
        issueType: row.classification.tag === "MAINTENANCE" ? "MAINTENANCE" : "APPROVAL_BACKLOG",
        href: buildApprovalHref(),
        targetId: makeApprovalFocusRowId("receipt", row.id),
        sectionId: APPROVAL_SECTION_IDS.receipts,
        actionLabel: "Review approval",
        inspectHint: "Inspect receipt classification, amount, and operational context before finalizing.",
        targetPageKey: "approvals",
        score
      });
    });

    return candidates.sort((a, b) => b.score - a.score);
  }, [
    buildApprovalHref,
    sortedDrillingRows,
    sortedInventoryRows,
    sortedMaintenanceRows,
    sortedReceiptSubmissionRows
  ]);

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
        { key: "pendingMaintenanceApprovals", label: "Pending maintenance approvals", value: pendingSummary.counts.maintenance },
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
          key: "approvals-maintenance",
          title: "Pending Maintenance Approvals",
          rowCount: sortedMaintenanceRows.length,
          columns: ["rig", "urgency", "issueType", "pendingHours"],
          rows: sortedMaintenanceRows.slice(0, 8).map((row) => ({
            id: makeApprovalFocusRowId("maintenance", row.id),
            rig: row.rig?.rigCode || "Unassigned rig",
            urgency: row.urgency,
            issueType: row.issueType,
            pendingHours: Math.max(0, (Date.now() - toPendingTimestamp(getMaintenancePendingDate(row))) / (1000 * 60 * 60))
          }))
        },
        {
          key: "approvals-inventory-usage",
          title: "Pending Inventory Usage Approvals",
          rowCount: sortedInventoryRows.length,
          columns: ["item", "qty", "rig", "project", "pendingHours"],
          rows: sortedInventoryRows.slice(0, 8).map((row) => ({
            id: makeApprovalFocusRowId("inventory", row.id),
            item: row.item.name,
            qty: row.quantity,
            rig: row.rig?.rigCode || row.location?.name || "Unlinked",
            project: row.project?.name || "Unlinked",
            pendingHours: Math.max(0, (Date.now() - toPendingTimestamp(getInventoryPendingDate(row))) / (1000 * 60 * 60))
          }))
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
          label: "Open maintenance approvals",
          href: buildApprovalHref({ tab: "maintenance" }),
          reason: "Review pending maintenance requests by urgency.",
          actionLabel: "Review maintenance",
          inspectHint: "Inspect urgency and operational downtime risk.",
          pageKey: "approvals",
          sectionId: APPROVAL_SECTION_IDS.maintenance
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
      pendingSummary.counts.maintenance,
      pendingSummary.counts.receiptSubmissions,
      pendingSummary.total,
      sortedInventoryRows,
      sortedMaintenanceRows,
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
  const focusedMaintenanceRow = useMemo(
    () =>
      sortedMaintenanceRows.find(
        (row) => makeApprovalFocusRowId("maintenance", row.id) === focusedRowId
      ) || null,
    [focusedRowId, sortedMaintenanceRows]
  );
  const focusedInventoryRow = useMemo(
    () =>
      sortedInventoryRows.find((row) => makeApprovalFocusRowId("inventory", row.id) === focusedRowId) ||
      null,
    [focusedRowId, sortedInventoryRows]
  );

  const approvalWorkflowAssist = useMemo<WorkflowAssistModel | null>(() => {
    const roleLabel = resolveApprovalsAssistRoleLabel(user?.role || null);
    if (focusedReceiptRow) {
      const pendingMeta = getPendingAgeMeta(getReceiptSubmissionPendingDate(focusedReceiptRow));
      const missingContext: string[] = [];
      if (!focusedReceiptRow.summary.supplierName) {
        missingContext.push("Supplier is missing.");
      }
      if (!focusedReceiptRow.summary.receiptNumber) {
        missingContext.push("Receipt number is missing.");
      }
      if (
        focusedReceiptRow.classification.tag !== "EXPENSE" &&
        !focusedReceiptRow.linkContext.projectId &&
        !focusedReceiptRow.linkContext.rigId &&
        !focusedReceiptRow.linkContext.maintenanceRequestId
      ) {
        missingContext.push("No operational linkage (project/rig/maintenance) is set.");
      }
      const contextLabel =
        focusedReceiptRow.classification.contextLabel && focusedReceiptRow.classification.contextLabel !== "-"
          ? focusedReceiptRow.classification.contextLabel
          : "Operational context is limited";
      return {
        heading: "Approval Workflow Assist",
        roleLabel,
        tone:
          pendingMeta?.badgeTone === "red"
            ? "amber"
            : focusedReceiptRow.classification.priority === "HIGH"
              ? "amber"
              : "indigo",
        whyThisMatters:
          assistTarget?.reason ||
          `${focusedReceiptRow.classification.tag} receipt for ${formatCurrency(
            focusedReceiptRow.summary.total || 0
          )}; ${contextLabel}.`,
        inspectFirst: [
          "Confirm supplier, receipt number, and total amount.",
          "Verify classification (STOCK / MAINTENANCE / EXPENSE) matches intent.",
          "Check pending age and duplicate warning context.",
          "Validate linkage to project/rig/maintenance where applicable."
        ],
        missingContext,
        checklist: [
          "Verify amount",
          "Review receipt evidence",
          "Confirm operational context",
          "Check approval readiness",
          "Add note before reject if needed"
        ],
        recommendedNextStep:
          pendingMeta?.badgeTone === "red"
            ? "Review this receipt now, then approve/reject to clear stale queue risk."
            : "Review receipt evidence and classification, then make an approval decision."
      };
    }

    if (focusedDrillingRow) {
      const pendingMeta = getPendingAgeMeta(getDrillingPendingDate(focusedDrillingRow));
      const missingContext: string[] = [];
      if (!focusedDrillingRow.submittedBy?.fullName) {
        missingContext.push("Submitted-by user is missing.");
      }
      if (!focusedDrillingRow.project?.name || !focusedDrillingRow.client?.name) {
        missingContext.push("Project/client context is incomplete.");
      }
      return {
        heading: "Approval Workflow Assist",
        roleLabel,
        tone: pendingMeta?.badgeTone === "red" ? "amber" : "indigo",
        whyThisMatters:
          assistTarget?.reason ||
          `Drilling report ${focusedDrillingRow.holeNumber} is pending and affects daily production visibility.`,
        inspectFirst: [
          "Verify meters drilled, work hours, and delay hours.",
          "Confirm rig/project/client alignment and hole reference.",
          "Check comment context before approve/reject."
        ],
        missingContext,
        checklist: [
          "Check report completeness",
          "Verify production values",
          "Confirm project attribution",
          "Review pending age"
        ],
        recommendedNextStep:
          pendingMeta?.badgeTone === "red"
            ? "Prioritize this stale report to restore current operational reporting."
            : "Inspect production values first, then complete approval."
      };
    }

    if (focusedMaintenanceRow) {
      const pendingMeta = getPendingAgeMeta(getMaintenancePendingDate(focusedMaintenanceRow));
      const missingContext: string[] = [];
      if (!focusedMaintenanceRow.rig?.rigCode) {
        missingContext.push("Rig linkage is missing.");
      }
      if (!focusedMaintenanceRow.mechanic?.fullName) {
        missingContext.push("Assigned mechanic is missing.");
      }
      return {
        heading: "Approval Workflow Assist",
        roleLabel,
        tone:
          focusedMaintenanceRow.urgency === "CRITICAL" || pendingMeta?.badgeTone === "red"
            ? "amber"
            : "indigo",
        whyThisMatters:
          assistTarget?.reason ||
          `${focusedMaintenanceRow.urgency} maintenance request can impact rig uptime if delayed.`,
        inspectFirst: [
          "Inspect urgency level and operational impact.",
          "Verify issue description quality and resolution context.",
          "Confirm rig assignment and maintenance ownership."
        ],
        missingContext,
        checklist: [
          "Inspect urgency",
          "Verify downtime impact",
          "Confirm maintenance evidence",
          "Review assignment completeness"
        ],
        recommendedNextStep:
          focusedMaintenanceRow.urgency === "CRITICAL"
            ? "Review immediately and prioritize decision to avoid prolonged downtime."
            : "Verify issue detail and ownership, then approve/reject with clear note."
      };
    }

    if (focusedInventoryRow) {
      const pendingMeta = getPendingAgeMeta(getInventoryPendingDate(focusedInventoryRow));
      const warning = inventoryRowWarnings[focusedInventoryRow.id];
      const missingContext: string[] = [];
      if (!focusedInventoryRow.project?.name && !focusedInventoryRow.rig?.rigCode) {
        missingContext.push("Project/rig context is missing.");
      }
      if (!focusedInventoryRow.requestedBy?.fullName) {
        missingContext.push("Requester identity is incomplete.");
      }
      if (!focusedInventoryRow.reason) {
        missingContext.push("Usage reason is missing.");
      }
      return {
        heading: "Approval Workflow Assist",
        roleLabel,
        tone: warning ? "amber" : pendingMeta?.badgeTone === "red" ? "amber" : "indigo",
        whyThisMatters:
          assistTarget?.reason ||
          `Inventory usage request for ${focusedInventoryRow.item.name} (${formatNumber(
            focusedInventoryRow.quantity
          )} qty) can affect stock availability.`,
        inspectFirst: [
          "Confirm requested quantity and stock impact.",
          "Verify project/rig/location and maintenance linkage.",
          "Check reason quality before approval."
        ],
        missingContext,
        checklist: [
          "Verify quantity",
          "Confirm rig/project linkage",
          "Check pending age",
          "Review maintenance dependency",
          "Confirm requester context"
        ],
        recommendedNextStep: warning
          ? "Resolve stock availability blocker first, then re-evaluate approval decision."
          : "Validate stock impact and context fields before approving usage."
      };
    }

    if (!assistTarget) {
      return null;
    }

    return {
      heading: "Approval Workflow Assist",
      roleLabel,
      tone: "slate",
      whyThisMatters:
        assistTarget.reason || "This queue was highlighted by copilot as the next review target.",
      inspectFirst: [
        "Check pending age and business impact.",
        "Confirm record completeness before decision.",
        "Use approve/reject with clear rationale."
      ],
      checklist: ["Review checklist", "Confirm linkage", "Verify value/impact"],
      recommendedNextStep: "Open the highlighted row and complete the highest-impact pending decision."
    };
  }, [
    assistTarget,
    focusedDrillingRow,
    focusedInventoryRow,
    focusedMaintenanceRow,
    focusedReceiptRow,
    inventoryRowWarnings,
    user?.role
  ]);

  return (
    <AccessGate permission="reports:view">
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
        <Card title="Approvals Hub" subtitle="Centralized approval workflow for drilling reports, maintenance, and inventory usage">
          <div className="space-y-4">
            <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
              Manual expense records are approved in{" "}
              <Link href="/expenses" className="font-semibold text-brand-700 underline-offset-2 hover:underline">
                Expenses
              </Link>
              . This workspace handles drilling, maintenance, inventory usage, and receipt submissions.
            </p>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <MetricCard
                label="Pending Receipt Submissions"
                value={String(pendingSummary.counts.receiptSubmissions)}
                tone={pendingSummary.counts.receiptSubmissions > 0 ? "warn" : "neutral"}
              />
              <MetricCard
                label="Pending Maintenance Approvals"
                value={String(pendingSummary.counts.maintenance)}
                tone={pendingSummary.counts.maintenance > 0 ? "warn" : "neutral"}
              />
              <MetricCard
                label="Pending Inventory Usage"
                value={String(pendingSummary.counts.inventoryUsage)}
                tone={pendingSummary.counts.inventoryUsage > 0 ? "warn" : "neutral"}
              />
              <MetricCard
                label="Total Pending Approvals"
                value={String(pendingSummary.total)}
                tone={pendingSummary.total > 0 ? "warn" : "neutral"}
              />
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">Pending Urgency Breakdown</p>
                <span className="rounded-full border border-slate-300 bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-700">
                  Oldest pending first
                </span>
              </div>
              <div className="mt-2 flex flex-wrap gap-2 text-xs">
                <StatusBadge label={`Under 24h: ${pendingSummary.buckets.under24}`} tone="green" />
                <StatusBadge label={`Over 24h: ${pendingSummary.buckets.over24}`} tone="amber" />
                <StatusBadge label={`Over 3 days: ${pendingSummary.buckets.over3d}`} tone="red" />
              </div>
              {pendingSummary.mostAttention && pendingSummary.mostAttention.count > 0 && (
                <p className="mt-2 text-xs text-slate-700">
                  Most attention needed:{" "}
                  <span className="font-semibold text-ink-900">
                    {pendingSummary.mostAttention.label} ({pendingSummary.mostAttention.count})
                  </span>
                </p>
              )}
            </div>

            <div
              id={APPROVAL_SECTION_IDS.receipts}
              className={`overflow-hidden rounded-xl border border-slate-200 ${
                focusedSectionId === APPROVAL_SECTION_IDS.receipts
                  ? "ring-2 ring-indigo-100 ring-offset-2 ring-offset-slate-50"
                  : ""
              }`}
            >
              <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-3 py-2">
                <div>
                  <h3 className="text-sm font-semibold text-ink-900">Pending Receipt Submissions</h3>
                  <p className="text-xs text-slate-600">
                    Spending visibility for stock, maintenance, and expense approvals.
                  </p>
                </div>
                <Link
                  href="/inventory/receipt-intake?view=history"
                  className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                >
                  Open Receipt Intake
                </Link>
              </div>
              {loading ? (
                <p className="px-3 py-3 text-sm text-ink-600">Loading receipt submissions...</p>
              ) : sortedReceiptSubmissionRows.length === 0 ? (
                <p className="px-3 py-3 text-sm text-ink-600">No pending receipt submissions for current filters.</p>
              ) : (
                <div className="max-h-[280px] overflow-auto">
                  <table className="min-w-full text-left text-sm">
                    <thead className="sticky top-0 z-10 bg-white text-xs uppercase tracking-wide text-slate-600">
                      <tr>
                        <th className="px-3 py-2">Submitted</th>
                        <th className="px-3 py-2">Supplier / Receipt</th>
                        <th className="px-3 py-2">Type</th>
                        <th className="px-3 py-2">Operational Context</th>
                        <th className="px-3 py-2 text-right">Total Amount</th>
                        <th className="px-3 py-2">Pending Age</th>
                        <th className="px-3 py-2">Review</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 bg-white">
                      {sortedReceiptSubmissionRows.map((row) => {
                        const pendingMeta = getPendingAgeMeta(getReceiptSubmissionPendingDate(row));
                        const isHighValue = highValueReceiptThreshold > 0 && row.summary.total >= highValueReceiptThreshold;
                        const rowToneClass =
                          row.classification.tag === "MAINTENANCE"
                            ? "bg-amber-50/50"
                            : row.classification.tag === "EXPENSE"
                              ? "bg-slate-50/65"
                              : "";
                        return (
                          <tr
                            key={row.id}
                            id={`ai-focus-${makeApprovalFocusRowId("receipt", row.id)}`}
                            className={`transition-colors duration-150 hover:bg-slate-50/80 ${
                              focusedRowId === makeApprovalFocusRowId("receipt", row.id)
                                ? "bg-indigo-50 ring-1 ring-inset ring-indigo-200"
                                : pendingMeta?.rowClass || rowToneClass
                            }`}
                          >
                            <td className="px-3 py-2 text-ink-700">
                              {formatReceiptSubmissionDate(row.submittedAt, row.reportDate)}
                            </td>
                            <td className="px-3 py-2">
                              <p className="font-medium text-ink-900">{row.summary.supplierName || "-"}</p>
                              <p className="text-xs text-slate-600">
                                Receipt: {row.summary.receiptNumber || "-"}
                                {row.summary.traReceiptNumber ? ` • TRA: ${row.summary.traReceiptNumber}` : ""}
                              </p>
                            </td>
                            <td className="px-3 py-2">
                              <div className="flex flex-wrap items-center gap-1">
                                <StatusBadge
                                  label={row.classification.tag}
                                  tone={
                                    row.classification.tag === "MAINTENANCE"
                                      ? "amber"
                                      : row.classification.tag === "EXPENSE"
                                        ? "gray"
                                        : "blue"
                                  }
                                />
                                <StatusBadge
                                  label={
                                    row.classification.priority === "HIGH"
                                      ? "High priority"
                                      : row.classification.priority === "LOW"
                                        ? "Low priority"
                                        : "Medium priority"
                                  }
                                  tone={
                                    row.classification.priority === "HIGH"
                                      ? "amber"
                                      : row.classification.priority === "LOW"
                                        ? "gray"
                                        : "amber"
                                  }
                                />
                              </div>
                            </td>
                            <td className="px-3 py-2 text-xs text-ink-800">
                              <span className="font-medium">{row.classification.contextLabel}</span>
                              {row.classification.tag === "STOCK" ? (
                                <span className="text-slate-600">
                                  {" "}
                                  • {row.classification.stockUse === "URGENT_USE" ? "Urgent use" : "Warehouse stock"}
                                </span>
                              ) : null}
                            </td>
                            <td className="px-3 py-2 text-right">
                              <div className="flex items-center justify-end gap-1">
                                <span className="font-semibold text-ink-900">{formatCurrency(row.summary.total || 0)}</span>
                                {isHighValue ? <StatusBadge label="High value" tone="amber" /> : null}
                              </div>
                            </td>
                            <td className="px-3 py-2">
                              {pendingMeta ? <StatusBadge label={pendingMeta.label} tone={pendingMeta.badgeTone} /> : "-"}
                            </td>
                            <td className="px-3 py-2">
                              <Link
                                href={`/inventory/receipt-intake?view=history&submissionId=${encodeURIComponent(row.id)}`}
                                className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                              >
                                Review
                              </Link>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200/85 bg-slate-50/75 p-2">
              {APPROVAL_TABS.map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setActiveTab(tab.key)}
                  className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${
                    activeTab === tab.key
                      ? "border-brand-500 bg-brand-50 text-brand-800"
                      : "border-slate-200 bg-white text-ink-700 hover:bg-slate-50"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <WorkflowAssistPanel model={approvalWorkflowAssist} />

            {activeTab === "drilling" ? (
              loading ? (
                <p className="text-sm text-ink-600">Loading submitted drilling reports...</p>
              ) : sortedDrillingRows.length === 0 ? (
                <p className="text-sm text-ink-600">No submitted drilling reports pending approval for current filters.</p>
              ) : (
                <div
                  id={APPROVAL_SECTION_IDS.drilling}
                  className={`overflow-hidden rounded-xl border border-slate-200 ${
                    focusedSectionId === APPROVAL_SECTION_IDS.drilling
                      ? "ring-2 ring-indigo-100 ring-offset-2 ring-offset-slate-50"
                      : ""
                  }`}
                >
                  {!canManageDrillingApprovals ? (
                    <div className="border-b border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                      View only: drilling approval actions are available to ADMIN and MANAGER roles.
                    </div>
                  ) : null}
                  <div className="max-h-[620px] overflow-auto">
                    <table className="min-w-full text-left text-sm">
                      <thead className="sticky top-0 z-10 bg-slate-50 text-xs uppercase tracking-wide text-slate-600">
                        <tr>
                          <th className="px-3 py-2">Date</th>
                          <th className="px-3 py-2">Project</th>
                          <th className="px-3 py-2">Client</th>
                          <th className="px-3 py-2">Rig</th>
                          <th className="px-3 py-2">Hole Number</th>
                          <th className="px-3 py-2 text-right">Meters Drilled</th>
                          <th className="px-3 py-2 text-right">Work Hours</th>
                          <th className="px-3 py-2">Submitted By</th>
                          <th className="px-3 py-2">Pending Age</th>
                          <th className="px-3 py-2">Status</th>
                          <th className="px-3 py-2">Comment</th>
                          <th className="px-3 py-2">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 bg-white">
                        {sortedDrillingRows.map((row) => {
                          const pendingMeta = getPendingAgeMeta(getDrillingPendingDate(row));
                          return (
                          <tr
                            key={row.id}
                            id={`ai-focus-${makeApprovalFocusRowId("drilling", row.id)}`}
                            className={`transition-colors duration-150 hover:bg-slate-50/80 ${
                              focusedRowId === makeApprovalFocusRowId("drilling", row.id)
                                ? "bg-indigo-50 ring-1 ring-inset ring-indigo-200"
                                : pendingMeta?.rowClass || ""
                            }`}
                          >
                            <td className="px-3 py-2 text-ink-700">{new Date(row.date).toISOString().slice(0, 10)}</td>
                            <td className="px-3 py-2 text-ink-800">{row.project.name}</td>
                            <td className="px-3 py-2 text-ink-700">{row.client.name}</td>
                            <td className="px-3 py-2 text-ink-700">{row.rig.rigCode}</td>
                            <td className="px-3 py-2 text-ink-700">{row.holeNumber}</td>
                            <td className="px-3 py-2 text-right text-ink-700">{formatNumber(row.totalMetersDrilled)}</td>
                            <td className="px-3 py-2 text-right text-ink-700">{row.workHours.toFixed(1)}</td>
                            <td className="px-3 py-2 text-ink-700">{row.submittedBy?.fullName || "-"}</td>
                            <td className="px-3 py-2">{pendingMeta ? <StatusBadge label={pendingMeta.label} tone={pendingMeta.badgeTone} /> : "-"}</td>
                            <td className="px-3 py-2">
                              <StatusBadge label="Submitted" tone="blue" />
                            </td>
                            <td className="px-3 py-2">
                              <input
                                type="text"
                                value={drillingNotes[row.id] || ""}
                                onChange={(event) =>
                                  setDrillingNotes((current) => ({
                                    ...current,
                                    [row.id]: event.target.value
                                  }))
                                }
                                placeholder="Optional rejection reason"
                                className="w-52 rounded-md border border-slate-200 px-2 py-1 text-xs"
                              />
                            </td>
                            <td className="px-3 py-2">
                              <div className="flex flex-wrap gap-2">
                                <button
                                  type="button"
                                  disabled={!canManageDrillingApprovals || actingRowId === row.id}
                                  onClick={() => void updateDrillingStatus(row.id, "approve")}
                                  className="rounded-md border border-emerald-200 px-2 py-1 text-xs text-emerald-700 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                  Approve
                                </button>
                                <button
                                  type="button"
                                  disabled={!canManageDrillingApprovals || actingRowId === row.id}
                                  onClick={() => void updateDrillingStatus(row.id, "reject")}
                                  className="rounded-md border border-red-200 px-2 py-1 text-xs text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                  Reject
                                </button>
                              </div>
                            </td>
                          </tr>
                        )})}
                      </tbody>
                    </table>
                  </div>
                </div>
              )
            ) : activeTab === "maintenance" ? (
              loading ? (
                <p className="text-sm text-ink-600">Loading submitted maintenance requests...</p>
              ) : sortedMaintenanceRows.length === 0 ? (
                <p className="text-sm text-ink-600">No submitted maintenance requests pending approval for current filters.</p>
              ) : (
                <div
                  id={APPROVAL_SECTION_IDS.maintenance}
                  className={`overflow-hidden rounded-xl border border-slate-200 ${
                    focusedSectionId === APPROVAL_SECTION_IDS.maintenance
                      ? "ring-2 ring-indigo-100 ring-offset-2 ring-offset-slate-50"
                      : ""
                  }`}
                >
                  {!canManageMaintenanceApprovals ? (
                    <div className="border-b border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                      View only: maintenance approval actions are available to roles with maintenance approval permission.
                    </div>
                  ) : null}
                  <div className="max-h-[620px] overflow-auto">
                    <table className="min-w-full text-left text-sm">
                      <thead className="sticky top-0 z-10 bg-slate-50 text-xs uppercase tracking-wide text-slate-600">
                        <tr>
                          <th className="px-3 py-2">Date</th>
                          <th className="px-3 py-2">Rig</th>
                          <th className="px-3 py-2">Issue Type</th>
                          <th className="px-3 py-2">Description</th>
                          <th className="px-3 py-2">Reported By</th>
                          <th className="px-3 py-2">Severity</th>
                          <th className="px-3 py-2">Pending Age</th>
                          <th className="px-3 py-2">Status</th>
                          <th className="px-3 py-2">Comment</th>
                          <th className="px-3 py-2">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 bg-white">
                        {sortedMaintenanceRows.map((row) => {
                          const pendingMeta = getPendingAgeMeta(getMaintenancePendingDate(row));
                          return (
                          <tr
                            key={row.id}
                            id={`ai-focus-${makeApprovalFocusRowId("maintenance", row.id)}`}
                            className={`transition-colors duration-150 hover:bg-slate-50/80 ${
                              focusedRowId === makeApprovalFocusRowId("maintenance", row.id)
                                ? "bg-indigo-50 ring-1 ring-inset ring-indigo-200"
                                : pendingMeta?.rowClass || ""
                            }`}
                          >
                            <td className="px-3 py-2 text-ink-700">{row.date}</td>
                            <td className="px-3 py-2 text-ink-700">{row.rig?.rigCode || "-"}</td>
                            <td className="px-3 py-2 text-ink-700">{row.issueType || "General"}</td>
                            <td className="max-w-[360px] px-3 py-2 text-ink-800">{row.issueDescription}</td>
                            <td className="px-3 py-2 text-ink-700">{row.mechanic?.fullName || "-"}</td>
                            <td className="px-3 py-2 text-ink-700">{row.urgency}</td>
                            <td className="px-3 py-2">{pendingMeta ? <StatusBadge label={pendingMeta.label} tone={pendingMeta.badgeTone} /> : "-"}</td>
                            <td className="px-3 py-2">
                              <StatusBadge label="Submitted" tone="blue" />
                            </td>
                            <td className="px-3 py-2">
                              <input
                                type="text"
                                value={maintenanceNotes[row.id] || ""}
                                onChange={(event) =>
                                  setMaintenanceNotes((current) => ({
                                    ...current,
                                    [row.id]: event.target.value
                                  }))
                                }
                                placeholder="Optional rejection note"
                                className="w-52 rounded-md border border-slate-200 px-2 py-1 text-xs"
                              />
                            </td>
                            <td className="px-3 py-2">
                              <div className="flex flex-wrap gap-2">
                                <button
                                  type="button"
                                  disabled={!canManageMaintenanceApprovals || actingRowId === row.id}
                                  onClick={() => void updateMaintenanceStatus(row.id, "approve")}
                                  className="rounded-md border border-emerald-200 px-2 py-1 text-xs text-emerald-700 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                  Approve
                                </button>
                                <button
                                  type="button"
                                  disabled={!canManageMaintenanceApprovals || actingRowId === row.id}
                                  onClick={() => void updateMaintenanceStatus(row.id, "reject")}
                                  className="rounded-md border border-red-200 px-2 py-1 text-xs text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                  Reject
                                </button>
                              </div>
                            </td>
                          </tr>
                        )})}
                      </tbody>
                    </table>
                  </div>
                </div>
              )
            ) : loading ? (
              <p className="text-sm text-ink-600">Loading inventory usage requests...</p>
            ) : sortedInventoryRows.length === 0 ? (
              <p className="text-sm text-ink-600">No pending inventory usage requests for current filters.</p>
            ) : (
              <div
                id={APPROVAL_SECTION_IDS.inventory}
                className={`overflow-hidden rounded-xl border border-slate-200 ${
                  focusedSectionId === APPROVAL_SECTION_IDS.inventory
                    ? "ring-2 ring-indigo-100 ring-offset-2 ring-offset-slate-50"
                    : ""
                }`}
              >
                {!canManageInventoryApprovals ? (
                  <div className="border-b border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    View only: approval actions are available to ADMIN and MANAGER roles.
                  </div>
                ) : null}
                <div className="max-h-[620px] overflow-auto">
                  <table className="min-w-full text-left text-sm">
                    <thead className="sticky top-0 z-10 bg-slate-50 text-xs uppercase tracking-wide text-slate-600">
                      <tr>
                        <th className="px-3 py-2">Date</th>
                        <th className="px-3 py-2">Requested For</th>
                        <th className="px-3 py-2">Item</th>
                        <th className="px-3 py-2 text-right">Qty</th>
                        <th className="px-3 py-2">Pending Age</th>
                        <th className="px-3 py-2">Requester</th>
                        <th className="px-3 py-2">Project</th>
                        <th className="px-3 py-2">Rig/Location</th>
                        <th className="px-3 py-2">Maintenance</th>
                        <th className="px-3 py-2">Reason</th>
                        <th className="px-3 py-2">Status</th>
                        <th className="px-3 py-2">Comment</th>
                        <th className="px-3 py-2">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 bg-white">
                      {sortedInventoryRows.map((row) => {
                        const pendingMeta = getPendingAgeMeta(getInventoryPendingDate(row));
                        return (
                        <tr
                          key={row.id}
                          id={`ai-focus-${makeApprovalFocusRowId("inventory", row.id)}`}
                          className={`transition-colors duration-150 hover:bg-slate-50/80 ${
                            focusedRowId === makeApprovalFocusRowId("inventory", row.id)
                              ? "bg-indigo-50 ring-1 ring-inset ring-indigo-200"
                              : inventoryRowWarnings[row.id]
                                ? "bg-amber-50/55"
                                : pendingMeta?.rowClass || ""
                          }`}
                        >
                          <td className="px-3 py-2 text-ink-700">{new Date(row.createdAt).toISOString().slice(0, 10)}</td>
                          <td className="px-3 py-2 text-ink-700">
                            {row.requestedForDate ? new Date(row.requestedForDate).toISOString().slice(0, 10) : "-"}
                          </td>
                          <td className="px-3 py-2 text-ink-800">{row.item.name}</td>
                          <td className="px-3 py-2 text-right text-ink-700">{formatNumber(row.quantity)}</td>
                          <td className="px-3 py-2">{pendingMeta ? <StatusBadge label={pendingMeta.label} tone={pendingMeta.badgeTone} /> : "-"}</td>
                          <td className="px-3 py-2 text-ink-700">{row.requestedBy?.fullName || "-"}</td>
                          <td className="px-3 py-2 text-ink-700">{row.project?.name || "-"}</td>
                          <td className="px-3 py-2 text-ink-700">{row.rig?.rigCode || row.location?.name || "-"}</td>
                          <td className="px-3 py-2 text-ink-700">{row.maintenanceRequest?.requestCode || "-"}</td>
                          <td className="max-w-[300px] px-3 py-2 text-ink-800">{row.reason}</td>
                          <td className="px-3 py-2">
                            <div className="flex flex-wrap items-center gap-1">
                              <StatusBadge
                                label={row.status === "PENDING" ? "Pending" : "Submitted"}
                                tone={row.status === "PENDING" ? "amber" : "blue"}
                              />
                              {inventoryRowWarnings[row.id] ? (
                                <StatusBadge label={inventoryRowWarnings[row.id]} tone="red" />
                              ) : null}
                            </div>
                          </td>
                          <td className="px-3 py-2">
                            <input
                              type="text"
                              value={inventoryNotes[row.id] || ""}
                              onChange={(event) =>
                                setInventoryNotes((current) => ({
                                  ...current,
                                  [row.id]: event.target.value
                                }))
                              }
                              placeholder="Optional note"
                              className="w-52 rounded-md border border-slate-200 px-2 py-1 text-xs"
                            />
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex flex-wrap gap-2">
                              <button
                                type="button"
                                disabled={!canManageInventoryApprovals || actingRowId === row.id}
                                onClick={() => void updateInventoryStatus(row.id, "approve")}
                                className="rounded-md border border-emerald-200 px-2 py-1 text-xs text-emerald-700 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                Approve
                              </button>
                              <button
                                type="button"
                                disabled={!canManageInventoryApprovals || actingRowId === row.id}
                                onClick={() => void updateInventoryStatus(row.id, "reject")}
                                className="rounded-md border border-red-200 px-2 py-1 text-xs text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                Reject
                              </button>
                            </div>
                          </td>
                        </tr>
                      )})}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </Card>
        </div>
      </div>
    </AccessGate>
  );
}

const APPROVAL_TABS: Array<{ key: ApprovalTab; label: string }> = [
  { key: "drilling", label: "Drilling Reports" },
  { key: "maintenance", label: "Maintenance" },
  { key: "inventory", label: "Inventory Usage" }
];

const APPROVAL_SECTION_IDS = {
  summary: "approvals-summary-section",
  receipts: "approvals-receipts-section",
  drilling: "approvals-tab-drilling-reports",
  maintenance: "approvals-tab-maintenance",
  inventory: "approvals-tab-inventory-usage"
} as const;

type ApprovalRowKind = "receipt" | "drilling" | "maintenance" | "inventory";

function makeApprovalFocusRowId(kind: ApprovalRowKind, id: string) {
  return `${kind}-${id}`;
}

function resolveApprovalTabForFocus(sectionId?: string | null, targetId?: string | null): ApprovalTab | null {
  if (sectionId === APPROVAL_SECTION_IDS.drilling) {
    return "drilling";
  }
  if (sectionId === APPROVAL_SECTION_IDS.maintenance) {
    return "maintenance";
  }
  if (sectionId === APPROVAL_SECTION_IDS.inventory) {
    return "inventory";
  }
  if (targetId) {
    if (targetId.startsWith("drilling-")) {
      return "drilling";
    }
    if (targetId.startsWith("maintenance-")) {
      return "maintenance";
    }
    if (targetId.startsWith("inventory-")) {
      return "inventory";
    }
  }
  return null;
}

function resolveApprovalSectionFromTargetId(targetId?: string | null) {
  if (!targetId) {
    return null;
  }
  if (targetId.startsWith("receipt-")) {
    return APPROVAL_SECTION_IDS.receipts;
  }
  if (targetId.startsWith("drilling-")) {
    return APPROVAL_SECTION_IDS.drilling;
  }
  if (targetId.startsWith("maintenance-")) {
    return APPROVAL_SECTION_IDS.maintenance;
  }
  if (targetId.startsWith("inventory-")) {
    return APPROVAL_SECTION_IDS.inventory;
  }
  return null;
}

function approvalSeverityRank(value: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW") {
  if (value === "CRITICAL") return 0;
  if (value === "HIGH") return 1;
  if (value === "MEDIUM") return 2;
  return 3;
}

function resolveApprovalsAssistRoleLabel(role: string | null) {
  if (role === "ADMIN" || role === "MANAGER") {
    return "Management review";
  }
  if (role === "OFFICE") {
    return "Office review";
  }
  if (role === "MECHANIC") {
    return "Mechanic review";
  }
  if (role === "FIELD" || role === "STAFF") {
    return "Operations review";
  }
  return null;
}

function StatusBadge({ label, tone }: { label: string; tone: "blue" | "green" | "red" | "gray" | "amber" }) {
  const toneClass =
    tone === "green"
      ? "border-emerald-300 bg-emerald-100 text-emerald-800"
      : tone === "red"
        ? "border-red-300 bg-red-100 text-red-800"
        : tone === "amber"
          ? "border-amber-300 bg-amber-100 text-amber-800"
        : tone === "gray"
          ? "border-slate-300 bg-slate-100 text-slate-700"
          : "border-blue-300 bg-blue-100 text-blue-800";

  return <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${toneClass}`}>{label}</span>;
}

async function readApiError(response: Response, fallbackMessage: string) {
  const clone = response.clone();
  const payload = await response.json().catch(() => null);
  if (payload && typeof payload === "object" && "message" in payload) {
    const message = payload.message;
    if (typeof message === "string" && message.trim()) {
      return message;
    }
  }

  const rawBody = (await clone.text().catch(() => "")).trim();
  if (rawBody) {
    return rawBody;
  }

  return `${fallbackMessage} (HTTP ${response.status})`;
}

type PendingAgeBucket = "UNDER_24_HOURS" | "OVER_24_HOURS" | "OVER_3_DAYS";

function getDrillingPendingDate(row: DrillingApprovalRow) {
  return row.submittedAt || row.date;
}

function getMaintenancePendingDate(row: MaintenanceApprovalRow) {
  return row.createdAt || row.requestDate || row.date;
}

function getInventoryPendingDate(row: InventoryUsageApprovalRow) {
  return row.createdAt;
}

function getReceiptSubmissionPendingDate(row: ReceiptSubmissionApprovalRow) {
  return row.submittedAt || row.reportDate;
}

function normalizeSubmissionStatus(value: string | undefined): "SUBMITTED" | "APPROVED" | "REJECTED" {
  if (value === "APPROVED" || value === "REJECTED" || value === "SUBMITTED") {
    return value;
  }
  return "SUBMITTED";
}

function normalizeOptionalId(value: string | undefined | null) {
  if (!value || value.trim().length === 0) {
    return null;
  }
  return value.trim();
}

function normalizeReceiptTag(value: string | undefined): ReceiptSpendTag | null {
  if (value === "STOCK" || value === "MAINTENANCE" || value === "EXPENSE") {
    return value;
  }
  return null;
}

function normalizeReceiptPriority(value: string | undefined): ReceiptPriority | null {
  if (value === "HIGH" || value === "MEDIUM" || value === "LOW") {
    return value;
  }
  return null;
}

function normalizeReceiptStockUse(value: string | null | undefined): ReceiptStockUse {
  if (value === "WAREHOUSE_STOCK" || value === "URGENT_USE") {
    return value;
  }
  return null;
}

function formatReceiptSubmissionDate(submittedAt: string | null | undefined, reportDate: string | null | undefined) {
  return formatIsoDateOnly(submittedAt) || formatIsoDateOnly(reportDate) || "-";
}

function formatIsoDateOnly(value: string | null | undefined) {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed.toISOString().slice(0, 10);
}

function toPendingTimestamp(value: string | null | undefined) {
  if (!value) {
    return Number.MAX_SAFE_INTEGER;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return Number.MAX_SAFE_INTEGER;
  }
  return parsed.getTime();
}

function getPendingAgeMeta(value: string | null | undefined): {
  bucket: PendingAgeBucket;
  label: string;
  badgeTone: "green" | "amber" | "red";
  rowClass: string;
} | null {
  const timestamp = toPendingTimestamp(value);
  if (!Number.isFinite(timestamp) || timestamp === Number.MAX_SAFE_INTEGER) {
    return null;
  }
  const hours = Math.max(0, (Date.now() - timestamp) / (1000 * 60 * 60));
  const durationLabel = formatPendingDuration(hours);
  if (hours >= 72) {
    return {
      bucket: "OVER_3_DAYS",
      label: `Over 3d (${durationLabel})`,
      badgeTone: "red",
      rowClass: "bg-red-50/45"
    };
  }
  if (hours >= 24) {
    return {
      bucket: "OVER_24_HOURS",
      label: `Over 24h (${durationLabel})`,
      badgeTone: "amber",
      rowClass: "bg-amber-50/45"
    };
  }
  return {
    bucket: "UNDER_24_HOURS",
    label: `Under 24h (${durationLabel})`,
    badgeTone: "green",
    rowClass: ""
  };
}

function formatPendingDuration(hours: number) {
  if (hours < 1) {
    return "<1h";
  }
  const wholeHours = Math.floor(hours);
  const days = Math.floor(wholeHours / 24);
  const remHours = wholeHours % 24;
  if (days <= 0) {
    return `${wholeHours}h`;
  }
  if (remHours === 0) {
    return `${days}d`;
  }
  return `${days}d ${remHours}h`;
}
