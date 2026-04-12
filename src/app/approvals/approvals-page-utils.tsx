import type {
  ReceiptPriority,
  ReceiptSpendTag,
  ReceiptStockUse
} from "@/lib/receipt-approval-classification";
import { formatCurrency, formatNumber } from "@/lib/utils";

import type {
  ApprovalRowKind,
  ApprovalTab,
  DrillingApprovalRow,
  InventoryUsageApprovalRow,
  PendingAgeBucket,
  ReceiptSubmissionApprovalRow,
  RequisitionApprovalRow
} from "./approvals-page-types";

export const APPROVAL_TABS: Array<{ key: ApprovalTab; label: string }> = [
  { key: "requisitions", label: "Purchase Requisitions" },
  { key: "drilling", label: "Drilling Reports" },
  { key: "inventory", label: "Inventory Usage" }
];

export const APPROVAL_SECTION_IDS = {
  summary: "approvals-summary-section",
  receipts: "approvals-receipts-section",
  requisitions: "approvals-tab-purchase-requisitions",
  drilling: "approvals-tab-drilling-reports",
  inventory: "approvals-tab-inventory-usage"
} as const;

export function makeApprovalFocusRowId(kind: ApprovalRowKind, id: string) {
  return `${kind}-${id}`;
}

export function resolveApprovalTabForFocus(sectionId?: string | null, targetId?: string | null): ApprovalTab | null {
  if (sectionId === APPROVAL_SECTION_IDS.requisitions) {
    return "requisitions";
  }
  if (sectionId === APPROVAL_SECTION_IDS.drilling) {
    return "drilling";
  }
  if (sectionId === APPROVAL_SECTION_IDS.inventory) {
    return "inventory";
  }
  if (targetId) {
    if (targetId.startsWith("requisition-")) {
      return "requisitions";
    }
    if (targetId.startsWith("drilling-")) {
      return "drilling";
    }
    if (targetId.startsWith("inventory-")) {
      return "inventory";
    }
  }
  return null;
}

export function resolveApprovalSectionFromTargetId(targetId?: string | null) {
  if (!targetId) {
    return null;
  }
  if (targetId.startsWith("receipt-")) {
    return APPROVAL_SECTION_IDS.receipts;
  }
  if (targetId.startsWith("requisition-")) {
    return APPROVAL_SECTION_IDS.requisitions;
  }
  if (targetId.startsWith("drilling-")) {
    return APPROVAL_SECTION_IDS.drilling;
  }
  if (targetId.startsWith("inventory-")) {
    return APPROVAL_SECTION_IDS.inventory;
  }
  return null;
}

export function approvalSeverityRank(value: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW") {
  if (value === "CRITICAL") return 0;
  if (value === "HIGH") return 1;
  if (value === "MEDIUM") return 2;
  return 3;
}

export function resolveApprovalsAssistRoleLabel(role: string | null) {
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

export function formatRequisitionType(
  type: "LIVE_PROJECT_PURCHASE" | "INVENTORY_STOCK_UP" | "MAINTENANCE_PURCHASE"
) {
  if (type === "LIVE_PROJECT_PURCHASE") {
    return "Project purchase";
  }
  if (type === "MAINTENANCE_PURCHASE") {
    return "Maintenance";
  }
  return "Inventory stock-up";
}

export function formatLiveProjectSpendType(value: "BREAKDOWN" | "NORMAL_EXPENSE" | null) {
  if (value === "BREAKDOWN") {
    return "Breakdown";
  }
  if (value === "NORMAL_EXPENSE") {
    return "Normal expense";
  }
  return "-";
}

export function formatRequisitionContext(
  type: RequisitionApprovalRow["type"],
  context: RequisitionApprovalRow["context"],
  labels?: RequisitionApprovalRow["contextLabels"]
) {
  const projectOwned = type === "LIVE_PROJECT_PURCHASE";
  const tokens: string[] = [];
  if (context.projectId) {
    tokens.push(labels?.projectName || `Project ${context.projectId.slice(0, 8)}`);
  }
  if (context.rigId) {
    if (projectOwned) {
      tokens.push(
        labels?.rigCode ? `Rig context ${labels.rigCode}` : `Rig context ${context.rigId.slice(0, 8)}`
      );
    } else {
      tokens.push(labels?.rigCode ? `Rig ${labels.rigCode}` : `Rig ${context.rigId.slice(0, 8)}`);
    }
  }
  if (context.clientId) {
    if (projectOwned) {
      tokens.push(
        labels?.clientName
          ? `Client context ${labels.clientName}`
          : `Client context ${context.clientId.slice(0, 8)}`
      );
    } else {
      tokens.push(labels?.clientName || `Client ${context.clientId.slice(0, 8)}`);
    }
  }
  if (context.maintenanceRequestId) {
    if (projectOwned) {
      tokens.push(
        labels?.maintenanceRequestCode
          ? `Maintenance link (unexpected): ${labels.maintenanceRequestCode}`
          : `Maintenance link (unexpected): ${context.maintenanceRequestId.slice(0, 8)}`
      );
    } else {
      tokens.push(
        labels?.maintenanceRequestCode
          ? `MR ${labels.maintenanceRequestCode}`
          : `MR ${context.maintenanceRequestId.slice(0, 8)}`
      );
    }
  }
  return tokens.length > 0 ? tokens.join(" • ") : "Unlinked";
}

export function StatusBadge({ label, tone }: { label: string; tone: "blue" | "green" | "red" | "gray" | "amber" }) {
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

export async function readApiError(response: Response, fallbackMessage: string) {
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

export function getDrillingPendingDate(row: DrillingApprovalRow) {
  return row.submittedAt || row.date;
}

export function getInventoryPendingDate(row: InventoryUsageApprovalRow) {
  return row.createdAt;
}

export function getReceiptSubmissionPendingDate(row: ReceiptSubmissionApprovalRow) {
  return row.submittedAt || row.reportDate;
}

export function normalizeSubmissionStatus(value: string | undefined): "SUBMITTED" | "APPROVED" | "REJECTED" {
  if (value === "APPROVED" || value === "REJECTED" || value === "SUBMITTED") {
    return value;
  }
  return "SUBMITTED";
}

export function normalizeOptionalId(value: string | undefined | null) {
  if (!value || value.trim().length === 0) {
    return null;
  }
  return value.trim();
}

export function normalizeReceiptTag(value: string | undefined): ReceiptSpendTag | null {
  if (value === "STOCK" || value === "MAINTENANCE" || value === "EXPENSE") {
    return value;
  }
  return null;
}

export function normalizeReceiptPriority(value: string | undefined): ReceiptPriority | null {
  if (value === "HIGH" || value === "MEDIUM" || value === "LOW") {
    return value;
  }
  return null;
}

export function normalizeReceiptStockUse(value: string | null | undefined): ReceiptStockUse {
  if (value === "WAREHOUSE_STOCK" || value === "URGENT_USE") {
    return value;
  }
  return null;
}

export function formatReceiptSubmissionDate(submittedAt: string | null | undefined, reportDate: string | null | undefined) {
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

export function toPendingTimestamp(value: string | null | undefined) {
  if (!value) {
    return Number.MAX_SAFE_INTEGER;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return Number.MAX_SAFE_INTEGER;
  }
  return parsed.getTime();
}

export function getPendingAgeMeta(value: string | null | undefined): {
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

export interface ApprovalCandidate {
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
}

export function buildApprovalsHref(
  filters: { from: string; to: string; clientId: string; rigId: string },
  extras?: Record<string, string | null | undefined>
) {
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
}

export function buildApprovalCandidates({
  sortedDrillingRows,
  sortedInventoryRows,
  sortedReceiptSubmissionRows,
  sortedRequisitionRows,
  buildHref
}: {
  sortedDrillingRows: DrillingApprovalRow[];
  sortedInventoryRows: InventoryUsageApprovalRow[];
  sortedReceiptSubmissionRows: ReceiptSubmissionApprovalRow[];
  sortedRequisitionRows: RequisitionApprovalRow[];
  buildHref: (extras?: Record<string, string | null | undefined>) => string;
}) {
  const candidates: ApprovalCandidate[] = [];

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
      href: buildHref({ tab: "drilling" }),
      targetId: makeApprovalFocusRowId("drilling", row.id),
      sectionId: APPROVAL_SECTION_IDS.drilling,
      actionLabel: "Review approval",
      inspectHint: "Inspect meters, work hours, and comments before approve/reject.",
      targetPageKey: "approvals",
      score
    });
  });

  sortedRequisitionRows.slice(0, 10).forEach((row) => {
    const pendingAt = row.submittedAt;
    const pendingMeta = getPendingAgeMeta(pendingAt);
    const pendingTimestamp = toPendingTimestamp(pendingAt);
    const severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" =
      pendingMeta?.bucket === "OVER_3_DAYS" ? "HIGH" : pendingMeta?.bucket === "OVER_24_HOURS" ? "MEDIUM" : "LOW";
    const score =
      (severity === "HIGH" ? 36 : severity === "MEDIUM" ? 22 : 10) +
      Math.min(18, Math.round((row.totals.estimatedTotalCost || 0) / 10000));
    candidates.push({
      id: `approval-requisition-${row.id}`,
      label: `Requisition approval • ${row.requisitionCode}`,
      reason: `${formatRequisitionType(row.type)} pending ${pendingMeta?.label || "review"}.`,
      severity,
      amount: row.totals.estimatedTotalCost || 0,
      pendingAt,
      pendingTimestamp,
      issueType: "APPROVAL_BACKLOG",
      href: buildHref({ tab: "requisitions" }),
      targetId: makeApprovalFocusRowId("requisition", row.id),
      sectionId: APPROVAL_SECTION_IDS.requisitions,
      actionLabel: "Review approval",
      inspectHint: "Inspect requisition context, line items, and estimated value before approve/reject.",
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
      href: buildHref({ tab: "inventory" }),
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
      href: buildHref(),
      targetId: makeApprovalFocusRowId("receipt", row.id),
      sectionId: APPROVAL_SECTION_IDS.receipts,
      actionLabel: "Review approval",
      inspectHint: "Inspect receipt classification, amount, and operational context before finalizing.",
      targetPageKey: "approvals",
      score
    });
  });

  return candidates.sort((a, b) => b.score - a.score);
}
