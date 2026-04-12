import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";

import type { BudgetVsActualRow } from "@/lib/budget-vs-actual";
import type { CostTrackingSummaryPayload } from "@/lib/cost-tracking";
import { formatCurrency, formatPercent } from "@/lib/utils";

import type {
  DrillingPendingRow,
  InventoryPendingRow,
  MaintenancePendingRow,
  PendingApprovalAttentionRow,
  ProfitSummaryPayload,
  QueueKey,
  QueueSummary,
  ReceiptPendingRow,
  RevenueSummaryPayload
} from "./executive-overview-types";

const UNASSIGNED_RIG_ID = "__unassigned_rig__";
const UNASSIGNED_PROJECT_ID = "__unassigned_project__";

export function getRecognizedCostValue(entry: { totalRecognizedCost?: number | null }) {
  return entry.totalRecognizedCost ?? 0;
}

export function buildFiltersQuery(filters: {
  workspaceMode?: string;
  projectId?: string;
  clientId: string;
  rigId: string;
  from: string;
  to: string;
}) {
  const params = new URLSearchParams();
  if (filters.workspaceMode && filters.workspaceMode !== "all-projects") {
    params.set("workspace", filters.workspaceMode);
  }
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  if (filters.projectId && filters.projectId !== "all") {
    params.set("projectId", filters.projectId);
    return params;
  }
  if (filters.clientId !== "all") params.set("clientId", filters.clientId);
  if (filters.rigId !== "all") params.set("rigId", filters.rigId);
  return params;
}

export function buildScopedApprovalsHref(
  filters: { clientId: string; rigId: string; from: string; to: string },
  tab?: string | null
) {
  const params = buildFiltersQuery(filters);
  if (tab) {
    params.set("tab", tab);
  }
  const query = params.toString();
  return `/approvals${query ? `?${query}` : ""}`;
}

export function resolveApprovalsTabByQueueKey(key: QueueKey) {
  if (key === "drilling") {
    return "drilling-reports";
  }
  if (key === "maintenance") {
    return "maintenance";
  }
  if (key === "inventoryUsage") {
    return "inventory-usage";
  }
  if (key === "receiptSubmissions") {
    return "receipt-submissions";
  }
  return null;
}

export function resolveApprovalsTabByQueueLabel(queue: string) {
  const normalized = queue.toLowerCase();
  if (normalized.includes("drilling")) {
    return "drilling-reports";
  }
  if (normalized.includes("maintenance")) {
    return "maintenance";
  }
  if (normalized.includes("inventory")) {
    return "inventory-usage";
  }
  if (normalized.includes("receipt")) {
    return "receipt-submissions";
  }
  return null;
}

export function withStatus(base: URLSearchParams, key: string, value: string) {
  const clone = new URLSearchParams(base);
  clone.set(key, value);
  return clone.toString();
}

export async function fetchJsonSafe<T>(url: string): Promise<{
  ok: boolean;
  data: T | null;
  status: number;
}> {
  try {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) {
      return { ok: false, data: null, status: response.status };
    }
    const payload = (await response.json()) as T;
    return { ok: true, data: payload, status: response.status };
  } catch {
    return { ok: false, data: null, status: 0 };
  }
}

export function deriveDecliningProfitClient(summary: ProfitSummaryPayload) {
  const byClient = Array.isArray(summary.profitByClient) ? summary.profitByClient : [];
  if (byClient.length === 0) {
    return null;
  }
  const sorted = [...byClient].sort((a, b) => a.profit - b.profit);
  return sorted[0] || null;
}

export function deriveMissingRevenueRigAttributionAmount(summary: RevenueSummaryPayload) {
  const unassigned = summary.revenueByRig.find(
    (entry) => /unassigned/i.test(entry.id) || /unassigned/i.test(entry.name)
  );
  return unassigned?.revenue || 0;
}

export function deriveProfitabilityConcern({
  costByRig,
  costByProject,
  revenueByRig,
  revenueByProject
}: {
  costByRig: CostTrackingSummaryPayload["costByRig"];
  costByProject: CostTrackingSummaryPayload["costByProject"];
  revenueByRig: RevenueSummaryPayload["revenueByRig"];
  revenueByProject: RevenueSummaryPayload["revenueByProject"];
}) {
  const candidates: Array<{
    id: string;
    scope: "Rig" | "Project";
    label: string;
    revenue: number;
    cost: number;
    gapAmount: number;
    href: string;
    sectionId: string;
    targetPageKey: "cost-tracking";
  }> = [];

  const revenueRigMap = new Map(revenueByRig.map((entry) => [entry.id, entry.revenue]));
  for (const row of costByRig) {
    if (!row.id || row.id === UNASSIGNED_RIG_ID) {
      continue;
    }
    const revenue = revenueRigMap.get(row.id) || 0;
    const rowCost = getRecognizedCostValue(row);
    const gap = rowCost - revenue;
    if (gap <= 0) {
      continue;
    }
    candidates.push({
      id: row.id,
      scope: "Rig",
      label: row.name,
      revenue,
      cost: rowCost,
      gapAmount: gap,
      href: "/spending",
      sectionId: "cost-by-rig-section",
      targetPageKey: "cost-tracking"
    });
  }

  const revenueProjectMap = new Map(revenueByProject.map((entry) => [entry.id, entry.revenue]));
  for (const row of costByProject) {
    if (!row.id || row.id === UNASSIGNED_PROJECT_ID) {
      continue;
    }
    const revenue = revenueProjectMap.get(row.id) || 0;
    const rowCost = getRecognizedCostValue(row);
    const gap = rowCost - revenue;
    if (gap <= 0) {
      continue;
    }
    candidates.push({
      id: row.id,
      scope: "Project",
      label: row.name,
      revenue,
      cost: rowCost,
      gapAmount: gap,
      href: "/spending",
      sectionId: "cost-by-project-section",
      targetPageKey: "cost-tracking"
    });
  }

  if (candidates.length === 0) {
    return null;
  }
  return candidates.sort((a, b) => b.gapAmount - a.gapAmount)[0];
}

export function resolvePendingDate(...candidates: Array<string | null | undefined>) {
  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }
    const parsed = new Date(candidate);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
  }
  return null;
}

export function summarizeQueue<T>(
  key: QueueKey,
  label: string,
  rows: T[],
  getPendingDate: (row: T) => string | null
): QueueSummary {
  let over24h = 0;
  let over3d = 0;
  let oldestPendingAt: string | null = null;

  for (const row of rows) {
    const pendingAt = getPendingDate(row);
    if (!pendingAt) {
      continue;
    }
    if (!oldestPendingAt || toTimestamp(pendingAt) < toTimestamp(oldestPendingAt)) {
      oldestPendingAt = pendingAt;
    }
    const hours = ageHours(pendingAt);
    if (hours >= 72) {
      over3d += 1;
    } else if (hours >= 24) {
      over24h += 1;
    }
  }

  return {
    key,
    label,
    count: rows.length,
    over24h,
    over3d,
    oldestPendingAt
  };
}

export function buildOldestPendingRows({
  drillingPendingRows,
  maintenancePendingRows,
  inventoryPendingRows,
  receiptPendingRows
}: {
  drillingPendingRows: DrillingPendingRow[];
  maintenancePendingRows: MaintenancePendingRow[];
  inventoryPendingRows: InventoryPendingRow[];
  receiptPendingRows: ReceiptPendingRow[];
}): PendingApprovalAttentionRow[] {
  const rows: PendingApprovalAttentionRow[] = [];

  for (const row of drillingPendingRows) {
    const pendingAt = resolvePendingDate(row.submittedAt, row.date);
    if (!pendingAt) continue;
    rows.push({
      id: `drilling-${row.id}`,
      queue: "Drilling Reports",
      reference: row.holeNumber ? `Hole ${row.holeNumber}` : `Report ${row.id.slice(-6)}`,
      pendingSince: pendingAt,
      ageHours: ageHours(pendingAt),
      context: `${row.project?.name || "Unknown Project"} • ${row.rig?.rigCode || "Unknown Rig"}`
    });
  }

  for (const row of maintenancePendingRows) {
    const pendingAt = resolvePendingDate(row.requestDate, row.createdAt, row.date);
    if (!pendingAt) continue;
    rows.push({
      id: `maintenance-${row.id}`,
      queue: "Maintenance",
      reference: row.requestCode || row.issueType || `Request ${row.id.slice(-6)}`,
      pendingSince: pendingAt,
      ageHours: ageHours(pendingAt),
      context: `${row.rig?.rigCode || "Unknown Rig"} • ${row.urgency || "Unknown urgency"}`
    });
  }

  for (const row of inventoryPendingRows) {
    const pendingAt = resolvePendingDate(row.createdAt, row.requestedForDate || null);
    if (!pendingAt) continue;
    rows.push({
      id: `inventory-${row.id}`,
      queue: "Inventory Usage",
      reference: row.item?.name || `Request ${row.id.slice(-6)}`,
      pendingSince: pendingAt,
      ageHours: ageHours(pendingAt),
      context: `${row.quantity} units • ${row.rig?.rigCode || "Unknown Rig"}`
    });
  }

  for (const row of receiptPendingRows) {
    const pendingAt = resolvePendingDate(row.submittedAt, row.reportDate);
    if (!pendingAt) continue;
    rows.push({
      id: `receipt-${row.id}`,
      queue: "Receipt Submissions",
      reference: row.summary.receiptNumber || `Submission ${row.id.slice(-6)}`,
      pendingSince: pendingAt,
      ageHours: ageHours(pendingAt),
      context: `${row.summary.supplierName || "Unknown Supplier"} • ${formatCurrency(Number(row.summary.total || 0))}`
    });
  }

  return rows.sort((a, b) => toTimestamp(a.pendingSince) - toTimestamp(b.pendingSince));
}

export function ageHours(value: string) {
  const timestamp = toTimestamp(value);
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return 0;
  }
  return Math.max(0, Math.round((Date.now() - timestamp) / 3600000));
}

export function toTimestamp(value: string | null) {
  if (!value) {
    return Number.POSITIVE_INFINITY;
  }
  const parsed = new Date(value);
  const timestamp = parsed.getTime();
  return Number.isFinite(timestamp) ? timestamp : Number.POSITIVE_INFINITY;
}

export function formatPendingAge(hours: number) {
  if (!Number.isFinite(hours) || hours <= 0) {
    return "< 1h";
  }
  if (hours >= 72) {
    return `${Math.round(hours / 24)}d`;
  }
  return `${hours}h`;
}

export function formatPercentUsed(value: number | null) {
  if (value === null) {
    return "No Budget";
  }
  if (value >= 1000) {
    return "999%+";
  }
  return formatPercent(value);
}

export function formatDateTime(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "—";
  }
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(parsed);
}

export function BudgetStatusBadge({ row }: { row: BudgetVsActualRow }) {
  if (row.alertLevel === "OVERSPENT") {
    return (
      <span className="rounded-full border border-red-300 bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-700">
        Overspent
      </span>
    );
  }
  return (
    <span className="rounded-full border border-orange-300 bg-orange-50 px-2 py-0.5 text-[11px] font-medium text-orange-700">
      Critical
    </span>
  );
}

export function ExecutiveTrendChart({
  data
}: {
  data: Array<{
    label: string;
    revenue: number;
    expenses: number;
    profit: number;
  }>;
}) {
  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis dataKey="label" stroke="#64748b" />
          <YAxis stroke="#64748b" />
          <Tooltip />
          <Legend />
          <Line type="monotone" dataKey="revenue" stroke="#1e63f5" strokeWidth={2} dot={false} name="Revenue" />
          <Line type="monotone" dataKey="expenses" stroke="#f59e0b" strokeWidth={2} dot={false} name="Approved Expense" />
          <Line type="monotone" dataKey="profit" stroke="#0f766e" strokeWidth={2} dot={false} name="Profit" />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
