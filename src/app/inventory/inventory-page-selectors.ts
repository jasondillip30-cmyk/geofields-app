import {
  buildIssueOperationalContext,
  deriveMovementRecognitionStatus,
  isIssueCostRecognitionGap,
  isIssueNeedsLinking,
  type IssueOperationalContext
} from "@/components/inventory/inventory-page-utils";
import {
  isOperationalMaintenanceOpen,
  normalizeBreakdownLikeStatus
} from "@/components/inventory/inventory-page-shared";
import type {
  BreakdownContextOption,
  InventoryIssueRow,
  InventoryItemRow,
  InventoryMovementRow,
  MaintenanceContextOption,
  UseRequestFormState
} from "./inventory-page-types";

export function resolveScopedProject(
  projects: Array<{ id: string; name: string; clientId: string; assignedRigId: string | null; backupRigId: string | null }>,
  projectId: string,
  isSingleProjectScope: boolean
) {
  if (!isSingleProjectScope) {
    return null;
  }
  return projects.find((project) => project.id === projectId) || null;
}

export function resolveSelectedClientLabel(
  clients: Array<{ id: string; name: string }>,
  clientId: string
) {
  if (clientId === "all") {
    return null;
  }
  return clients.find((client) => client.id === clientId)?.name || null;
}

export function resolveSelectedRigLabel(
  rigs: Array<{ id: string; rigCode: string }>,
  rigId: string
) {
  if (rigId === "all") {
    return null;
  }
  return rigs.find((rig) => rig.id === rigId)?.rigCode || null;
}

export function resolveOpenMaintenanceRequests(
  maintenanceRequests: MaintenanceContextOption[]
) {
  return maintenanceRequests.filter((requestRow) => isOperationalMaintenanceOpen(requestRow.status));
}

export function resolveOpenBreakdownReports(
  breakdownReports: BreakdownContextOption[]
) {
  return breakdownReports.filter((entry) => normalizeBreakdownLikeStatus(entry.status) === "OPEN");
}

export function buildMaintenanceRigOptions(openMaintenanceRequests: MaintenanceContextOption[]) {
  const byId = new Map<string, { id: string; rigCode: string }>();
  for (const requestRow of openMaintenanceRequests) {
    if (requestRow.rig?.id && requestRow.rig?.rigCode) {
      byId.set(requestRow.rig.id, {
        id: requestRow.rig.id,
        rigCode: requestRow.rig.rigCode
      });
    }
  }
  return Array.from(byId.values()).sort((a, b) =>
    a.rigCode.localeCompare(b.rigCode)
  );
}

export function resolveSelectedMaintenanceContext(
  openMaintenanceRequests: MaintenanceContextOption[],
  useRequestForm: Pick<UseRequestFormState, "maintenanceRequestId">
) {
  return (
    openMaintenanceRequests.find((requestRow) => requestRow.id === useRequestForm.maintenanceRequestId) ||
    null
  );
}

export function resolveOpenMaintenanceRequestsForSelectedRig(
  openMaintenanceRequests: MaintenanceContextOption[],
  useRequestForm: Pick<UseRequestFormState, "maintenanceRigId">
) {
  return useRequestForm.maintenanceRigId
    ? openMaintenanceRequests.filter(
        (requestRow) => requestRow.rig?.id === useRequestForm.maintenanceRigId
      )
    : [];
}

export function resolveSelectedBreakdownContext(
  openBreakdownReports: BreakdownContextOption[],
  useRequestForm: Pick<UseRequestFormState, "breakdownReportId">
) {
  return openBreakdownReports.find((entry) => entry.id === useRequestForm.breakdownReportId) || null;
}

export function buildStockAlertRows({
  lowStockItems,
  outOfStockItems
}: {
  lowStockItems: Array<{
    id: string;
    name: string;
    sku: string;
    quantityInStock: number;
    minimumStockLevel: number;
    category: string;
  }>;
  outOfStockItems: Array<{
    id: string;
    name: string;
    sku: string;
    minimumStockLevel: number;
    category: string;
  }>;
}) {
  return [
    ...outOfStockItems.map((item) => ({
      id: `out-${item.id}`,
      name: item.name,
      sku: item.sku,
      quantityInStock: 0,
      minimumStockLevel: item.minimumStockLevel,
      severity: "CRITICAL" as const
    })),
    ...lowStockItems.map((item) => ({
      id: `low-${item.id}`,
      name: item.name,
      sku: item.sku,
      quantityInStock: item.quantityInStock,
      minimumStockLevel: item.minimumStockLevel,
      severity: "LOW" as const
    }))
  ];
}

export function filterMovementRows({
  movements,
  isSingleProjectScope,
  movementTypeFilter,
  movementQuery
}: {
  movements: InventoryMovementRow[];
  isSingleProjectScope: boolean;
  movementTypeFilter: string;
  movementQuery: string;
}) {
  const query = movementQuery.trim().toLowerCase();
  return movements.filter((movement) => {
    if (isSingleProjectScope && movement.movementType !== "IN" && movement.movementType !== "OUT") {
      return false;
    }
    if (movementTypeFilter !== "all" && movement.movementType !== movementTypeFilter) {
      return false;
    }
    if (!query) {
      return true;
    }
    const haystack = [
      movement.item?.name || "",
      movement.item?.sku || "",
      movement.project?.name || "",
      movement.rig?.rigCode || "",
      movement.client?.name || "",
      movement.supplier?.name || "",
      movement.maintenanceRequest?.requestCode || ""
    ]
      .join(" ")
      .toLowerCase();
    return haystack.includes(query);
  });
}

export function buildRecognizedProjectCostRows(movements: InventoryMovementRow[]) {
  return movements
    .filter(
      (movement) =>
        movement.movementType === "OUT" &&
        String(movement.expense?.approvalStatus || "").toUpperCase() === "APPROVED"
    )
    .slice(0, 8);
}

export function buildProjectUsageSummary(items: InventoryItemRow[], isSingleProjectScope: boolean) {
  if (!isSingleProjectScope) {
    return null;
  }
  return items.reduce(
    (summary, item) => {
      const context = item.approvedProjectContext;
      if (!context) {
        return summary;
      }
      summary.approvedItems += 1;
      summary.availableQuantity += context.availableApprovedQuantity || 0;
      summary.availableValue += context.availableApprovedValue || 0;
      summary.usedQuantity += context.usedQuantity || 0;
      summary.usedValue += context.usedValue || 0;
      return summary;
    },
    {
      approvedItems: 0,
      availableQuantity: 0,
      availableValue: 0,
      usedQuantity: 0,
      usedValue: 0
    }
  );
}

export function buildMovementLedgerSummary(filteredMovements: InventoryMovementRow[]) {
  const summary = {
    total: filteredMovements.length,
    recognized: 0,
    pending: 0,
    stockOnly: 0
  };
  for (const movement of filteredMovements) {
    const recognition = deriveMovementRecognitionStatus(movement);
    if (recognition.label === "Cost Recognized") {
      summary.recognized += 1;
    } else if (recognition.label === "Pending Recognition") {
      summary.pending += 1;
    } else {
      summary.stockOnly += 1;
    }
  }
  return summary;
}

export function buildItemByIdMap(items: InventoryItemRow[]) {
  return new Map(items.map((item) => [item.id, item]));
}

export function buildIssueCategoryOptions(
  issues: InventoryIssueRow[],
  itemById: Map<string, InventoryItemRow>
) {
  const values = new Set<string>();
  for (const issue of issues) {
    if (issue.affectedCategory) {
      values.add(issue.affectedCategory);
      continue;
    }
    for (const itemId of issue.itemIds) {
      const category = itemById.get(itemId)?.category;
      if (category) {
        values.add(category);
      }
    }
  }
  return Array.from(values).sort((a, b) => a.localeCompare(b));
}

export function filterIssueRows({
  issues,
  showLowPriorityIssues,
  issueSeverityFilter,
  issueTypeFilter,
  issueCategoryFilter,
  issueItemQuery,
  itemById
}: {
  issues: InventoryIssueRow[];
  showLowPriorityIssues: boolean;
  issueSeverityFilter: "all" | "HIGH" | "MEDIUM" | "LOW";
  issueTypeFilter: "all" | InventoryIssueRow["type"];
  issueCategoryFilter: "all" | string;
  issueItemQuery: string;
  itemById: Map<string, InventoryItemRow>;
}) {
  const query = issueItemQuery.trim().toLowerCase();
  const rows = issues.filter((issue) => {
    if (!showLowPriorityIssues && issue.severity === "LOW") {
      return false;
    }
    if (issueSeverityFilter !== "all" && issue.severity !== issueSeverityFilter) {
      return false;
    }
    if (issueTypeFilter !== "all" && issue.type !== issueTypeFilter) {
      return false;
    }
    if (issueCategoryFilter !== "all") {
      const matchedCategory =
        issue.affectedCategory ||
        issue.itemIds.map((itemId) => itemById.get(itemId)?.category).find(Boolean) ||
        "";
      if (matchedCategory !== issueCategoryFilter) {
        return false;
      }
    }
    if (query) {
      const names = issue.itemIds
        .map((itemId) => itemById.get(itemId)?.name || "")
        .join(" ")
        .toLowerCase();
      if (!names.includes(query) && !issue.title.toLowerCase().includes(query) && !issue.message.toLowerCase().includes(query)) {
        return false;
      }
    }
    return true;
  });

  const severityOrder = { HIGH: 0, MEDIUM: 1, LOW: 2 };
  const confidenceOrder = { HIGH: 0, MEDIUM: 1, LOW: 2, NONE: 3, undefined: 4 } as Record<string, number>;

  return [...rows].sort((a, b) => {
    if (severityOrder[a.severity] !== severityOrder[b.severity]) {
      return severityOrder[a.severity] - severityOrder[b.severity];
    }
    return (confidenceOrder[a.confidence || "undefined"] || 4) - (confidenceOrder[b.confidence || "undefined"] || 4);
  });
}

export function countLowPriorityIssues(issues: InventoryIssueRow[]) {
  return issues.filter((issue) => issue.severity === "LOW").length;
}

export function buildTriageQueueIssues({
  filteredIssues,
  issueTriageFilter
}: {
  filteredIssues: InventoryIssueRow[];
  issueTriageFilter: "ALL" | "HIGH_PRIORITY" | "NEEDS_LINKING" | "COST_NOT_RECOGNIZED" | "LOW_PRIORITY";
}) {
  if (issueTriageFilter === "HIGH_PRIORITY") {
    return filteredIssues.filter((issue) => issue.severity === "HIGH");
  }
  if (issueTriageFilter === "NEEDS_LINKING") {
    return filteredIssues.filter((issue) => isIssueNeedsLinking(issue));
  }
  if (issueTriageFilter === "COST_NOT_RECOGNIZED") {
    return filteredIssues.filter((issue) => isIssueCostRecognitionGap(issue));
  }
  if (issueTriageFilter === "LOW_PRIORITY") {
    return filteredIssues.filter((issue) => issue.severity === "LOW");
  }
  return filteredIssues;
}

export function buildIssueContextById({
  filteredIssues,
  itemById,
  movements
}: {
  filteredIssues: InventoryIssueRow[];
  itemById: Map<string, InventoryItemRow>;
  movements: InventoryMovementRow[];
}) {
  const contextMap = new Map<string, IssueOperationalContext>();
  for (const issue of filteredIssues) {
    contextMap.set(issue.id, buildIssueOperationalContext(issue, itemById, movements));
  }
  return contextMap;
}

export function resolveSelectedIssue({
  triageQueueIssues,
  filteredIssues,
  selectedIssueId
}: {
  triageQueueIssues: InventoryIssueRow[];
  filteredIssues: InventoryIssueRow[];
  selectedIssueId: string;
}) {
  return (
    triageQueueIssues.find((issue) => issue.id === selectedIssueId) ||
    filteredIssues.find((issue) => issue.id === selectedIssueId) ||
    triageQueueIssues[0] ||
    filteredIssues[0] ||
    null
  );
}

export function buildLowRiskNamingFixes(issues: InventoryIssueRow[]) {
  const byItemId = new Map<string, { itemId: string; suggestedName: string }>();
  for (const issue of issues) {
    if (
      issue.type !== "NAMING_INCONSISTENCY" ||
      issue.severity !== "LOW" ||
      !issue.autoFixSafe ||
      !issue.suggestedName ||
      issue.itemIds.length === 0
    ) {
      continue;
    }
    const itemId = issue.itemIds[0];
    if (!byItemId.has(itemId)) {
      byItemId.set(itemId, {
        itemId,
        suggestedName: issue.suggestedName
      });
    }
  }
  return Array.from(byItemId.values());
}
