import { normalizeNameForComparison } from "@/lib/name-normalization";
import type {
  InventoryReason,
  MaintenancePriority,
  RequisitionRow,
  RequisitionType
} from "./requisition-workflow-types";

export function buildRequisitionRowSummary({
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

export function formatRequisitionType(
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

export function buildRequestNote({
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

export function formatMaintenancePriorityLabel(priority: MaintenancePriority) {
  if (priority === "HIGH") return "High";
  if (priority === "MEDIUM") return "Medium";
  return "Low";
}

export function formatInventoryReasonLabel(reason: InventoryReason) {
  if (reason === "LOW_STOCK") return "Low stock";
  if (reason === "RESTOCK") return "Restock";
  if (reason === "EMERGENCY") return "Emergency";
  return "Other";
}

export function isMaintenanceRecordOpen(status: string) {
  const normalized = status.trim().toUpperCase();
  return (
    normalized === "OPEN" ||
    normalized === "IN_REPAIR" ||
    normalized === "WAITING_FOR_PARTS"
  );
}

export function normalizeSearchText(value: string) {
  return normalizeNameForComparison(value);
}

export function formatIsoDate(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value || "-";
  }
  return parsed.toISOString().slice(0, 10);
}

export function buildReceiptIntakeHref(row: RequisitionRow) {
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
