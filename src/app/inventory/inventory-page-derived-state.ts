import { useMemo } from "react";

import {
  buildIssueCategoryOptions,
  buildIssueContextById,
  buildItemByIdMap,
  buildLowRiskNamingFixes,
  buildMaintenanceRigOptions,
  buildMovementLedgerSummary,
  buildProjectUsageSummary,
  buildRecognizedProjectCostRows,
  buildStockAlertRows,
  buildTriageQueueIssues,
  countLowPriorityIssues,
  filterIssueRows,
  filterMovementRows,
  resolveOpenBreakdownReports,
  resolveOpenMaintenanceRequests,
  resolveOpenMaintenanceRequestsForSelectedRig,
  resolveScopedProject,
  resolveSelectedBreakdownContext,
  resolveSelectedClientLabel,
  resolveSelectedIssue,
  resolveSelectedMaintenanceContext,
  resolveSelectedRigLabel,
} from "./inventory-page-selectors";
import type {
  BreakdownContextOption,
  CategorySuggestionState,
  InventoryIssueRow,
  InventoryItemRow,
  InventoryMovementRow,
  InventoryOverviewResponse,
  IssueTriageFilter,
  ItemFormState,
  MaintenanceContextOption,
  UseRequestFormState,
} from "./inventory-page-types";

interface InventoryDerivedStateArgs {
  projects: Array<{
    id: string;
    name: string;
    clientId: string;
    assignedRigId: string | null;
    backupRigId: string | null;
  }>;
  projectId: string;
  clientId: string;
  rigId: string;
  isSingleProjectScope: boolean;
  clients: Array<{ id: string; name: string }>;
  rigs: Array<{ id: string; rigCode: string }>;
  maintenanceRequests: MaintenanceContextOption[];
  breakdownReports: BreakdownContextOption[];
  useRequestForm: UseRequestFormState;
  overview: InventoryOverviewResponse;
  movements: InventoryMovementRow[];
  movementTypeFilter: string;
  movementQuery: string;
  items: InventoryItemRow[];
  selectedItemId: string;
  issues: InventoryIssueRow[];
  showLowPriorityIssues: boolean;
  issueSeverityFilter: "all" | "HIGH" | "MEDIUM" | "LOW";
  issueTypeFilter: "all" | InventoryIssueRow["type"];
  issueCategoryFilter: "all" | string;
  issueItemQuery: string;
  issueTriageFilter: IssueTriageFilter;
  selectedIssueId: string;
  itemForm: ItemFormState;
  categorySuggestion: CategorySuggestionState;
}

export function useInventoryDerivedState({
  projects,
  projectId,
  clientId,
  rigId,
  isSingleProjectScope,
  clients,
  rigs,
  maintenanceRequests,
  breakdownReports,
  useRequestForm,
  overview,
  movements,
  movementTypeFilter,
  movementQuery,
  items,
  selectedItemId,
  issues,
  showLowPriorityIssues,
  issueSeverityFilter,
  issueTypeFilter,
  issueCategoryFilter,
  issueItemQuery,
  issueTriageFilter,
  selectedIssueId,
  itemForm,
  categorySuggestion,
}: InventoryDerivedStateArgs) {
  const scopedProject = useMemo(
    () => resolveScopedProject(projects, projectId, isSingleProjectScope),
    [isSingleProjectScope, projectId, projects]
  );

  const selectedClientLabel = useMemo(
    () => resolveSelectedClientLabel(clients, clientId),
    [clientId, clients]
  );

  const selectedRigLabel = useMemo(
    () => resolveSelectedRigLabel(rigs, rigId),
    [rigId, rigs]
  );

  const openMaintenanceRequests = useMemo(
    () => resolveOpenMaintenanceRequests(maintenanceRequests),
    [maintenanceRequests]
  );
  const openBreakdownReports = useMemo(
    () => resolveOpenBreakdownReports(breakdownReports),
    [breakdownReports]
  );
  const maintenanceRigOptions = useMemo(
    () => buildMaintenanceRigOptions(openMaintenanceRequests),
    [openMaintenanceRequests]
  );
  const selectedMaintenanceContext = useMemo(
    () => resolveSelectedMaintenanceContext(openMaintenanceRequests, useRequestForm),
    [openMaintenanceRequests, useRequestForm]
  );
  const openMaintenanceRequestsForSelectedRig = useMemo(
    () => resolveOpenMaintenanceRequestsForSelectedRig(openMaintenanceRequests, useRequestForm),
    [openMaintenanceRequests, useRequestForm]
  );
  const selectedBreakdownContext = useMemo(
    () => resolveSelectedBreakdownContext(openBreakdownReports, useRequestForm),
    [openBreakdownReports, useRequestForm]
  );

  const lowStockItems = useMemo(() => overview.lowStockItems || [], [overview.lowStockItems]);
  const outOfStockItems = useMemo(
    () => overview.outOfStockItems || [],
    [overview.outOfStockItems]
  );
  const stockAlertRows = useMemo(
    () => buildStockAlertRows({ lowStockItems, outOfStockItems }),
    [lowStockItems, outOfStockItems]
  );
  const filteredMovements = useMemo(
    () =>
      filterMovementRows({
        movements,
        isSingleProjectScope,
        movementTypeFilter,
        movementQuery,
      }),
    [isSingleProjectScope, movementQuery, movementTypeFilter, movements]
  );
  const visibleMovements = useMemo(() => filteredMovements.slice(0, 80), [filteredMovements]);
  const recognizedProjectCostRows = useMemo(
    () => buildRecognizedProjectCostRows(movements),
    [movements]
  );
  const projectUsageSummary = useMemo(
    () => buildProjectUsageSummary(items, isSingleProjectScope),
    [isSingleProjectScope, items]
  );
  const movementLedgerSummary = useMemo(
    () => buildMovementLedgerSummary(filteredMovements),
    [filteredMovements]
  );
  const selectedItemIssues = useMemo(() => {
    if (!selectedItemId) {
      return [];
    }
    return issues.filter((issue) => issue.itemIds.includes(selectedItemId));
  }, [issues, selectedItemId]);
  const itemById = useMemo(() => buildItemByIdMap(items), [items]);
  const issueCategoryOptions = useMemo(
    () => buildIssueCategoryOptions(issues, itemById),
    [issues, itemById]
  );
  const filteredIssues = useMemo(
    () =>
      filterIssueRows({
        issues,
        showLowPriorityIssues,
        issueSeverityFilter,
        issueTypeFilter,
        issueCategoryFilter,
        issueItemQuery,
        itemById,
      }),
    [
      issueCategoryFilter,
      issueItemQuery,
      issueSeverityFilter,
      issueTypeFilter,
      issues,
      itemById,
      showLowPriorityIssues,
    ]
  );
  const lowPriorityHiddenCount = useMemo(
    () => countLowPriorityIssues(issues),
    [issues]
  );
  const needsLinkingCount = useMemo(
    () => buildTriageQueueIssues({ filteredIssues, issueTriageFilter: "NEEDS_LINKING" }).length,
    [filteredIssues]
  );
  const costNotRecognizedCount = useMemo(
    () =>
      buildTriageQueueIssues({ filteredIssues, issueTriageFilter: "COST_NOT_RECOGNIZED" }).length,
    [filteredIssues]
  );
  const triageQueueIssues = useMemo(
    () => buildTriageQueueIssues({ filteredIssues, issueTriageFilter }),
    [filteredIssues, issueTriageFilter]
  );
  const issueContextById = useMemo(
    () => buildIssueContextById({ filteredIssues, itemById, movements }),
    [filteredIssues, itemById, movements]
  );
  const selectedIssue = useMemo(
    () => resolveSelectedIssue({ triageQueueIssues, filteredIssues, selectedIssueId }),
    [filteredIssues, selectedIssueId, triageQueueIssues]
  );
  const selectedIssueContext = useMemo(
    () => (selectedIssue ? issueContextById.get(selectedIssue.id) || null : null),
    [issueContextById, selectedIssue]
  );
  const lowRiskNamingFixes = useMemo(
    () => buildLowRiskNamingFixes(issues),
    [issues]
  );
  const suggestionMismatch =
    categorySuggestion.suggestedCategory &&
    categorySuggestion.confidence !== "NONE" &&
    itemForm.category &&
    itemForm.category !== categorySuggestion.suggestedCategory;

  return {
    scopedProject,
    selectedClientLabel,
    selectedRigLabel,
    openMaintenanceRequests,
    openBreakdownReports,
    maintenanceRigOptions,
    selectedMaintenanceContext,
    openMaintenanceRequestsForSelectedRig,
    selectedBreakdownContext,
    stockAlertRows,
    filteredMovements,
    visibleMovements,
    recognizedProjectCostRows,
    projectUsageSummary,
    movementLedgerSummary,
    selectedItemIssues,
    issueCategoryOptions,
    filteredIssues,
    lowPriorityHiddenCount,
    needsLinkingCount,
    costNotRecognizedCount,
    triageQueueIssues,
    issueContextById,
    selectedIssue,
    selectedIssueContext,
    lowRiskNamingFixes,
    suggestionMismatch,
  };
}
