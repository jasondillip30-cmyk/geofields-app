import {
  applyInventoryIssueQuickFix,
  applyInventoryNamingAutoFix,
  mergeDuplicateInventoryItems
} from "./inventory-page-actions";
import type { InventoryIssueRow, InventoryMovementRow } from "./inventory-page-types";

type NamingFixPayload = Array<{ itemId: string; suggestedName: string }>;

type CreateInventoryIssueHandlersParams = {
  issues: InventoryIssueRow[];
  movements: InventoryMovementRow[];
  selectedItemId: string;
  lowRiskNamingFixes: NamingFixPayload;
  setErrorMessage: (value: string | null) => void;
  setNotice: (value: string | null) => void;
  setSelectedItemId: (value: string) => void;
  setSelectedMovementId: (value: string) => void;
  setMovementDetailDrawerOpen: (value: boolean) => void;
  setSelectedIssueId: (value: string) => void;
  setIssueWorkflowInitialStep: (value: 1 | 2 | 3) => void;
  setIssueWorkflowModalOpen: (value: boolean) => void;
  setItemDetailModalOpen: (value: boolean) => void;
  loadInventoryData: () => Promise<void>;
  loadSelectedItemDetails: () => Promise<void>;
  routerPush: (href: string) => void;
};

export function createInventoryIssueHandlers({
  issues,
  movements,
  selectedItemId,
  lowRiskNamingFixes,
  setErrorMessage,
  setNotice,
  setSelectedItemId,
  setSelectedMovementId,
  setMovementDetailDrawerOpen,
  setSelectedIssueId,
  setIssueWorkflowInitialStep,
  setIssueWorkflowModalOpen,
  setItemDetailModalOpen,
  loadInventoryData,
  loadSelectedItemDetails,
  routerPush
}: CreateInventoryIssueHandlersParams) {
  async function applyIssueQuickFix(issue: InventoryIssueRow, fix: "category" | "name") {
    if (!issue.itemIds[0]) {
      return;
    }
    const targetItemId = issue.itemIds[0];

    setErrorMessage(null);
    setNotice(null);
    try {
      await applyInventoryIssueQuickFix({
        issue,
        fix
      });
      setNotice("Issue resolved.");
      await loadInventoryData();
      if (selectedItemId === targetItemId) {
        await loadSelectedItemDetails();
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to apply quick fix.");
    }
  }

  async function applyNamingAutoFix(itemId: string, suggestedName: string) {
    if (!itemId || !suggestedName) {
      return;
    }
    setErrorMessage(null);
    setNotice(null);
    try {
      await applyInventoryNamingAutoFix([{ itemId, suggestedName }]);
      setNotice("Issue resolved.");
      await loadInventoryData();
      if (selectedItemId === itemId) {
        await loadSelectedItemDetails();
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to auto-fix naming.");
    }
  }

  async function applyBulkLowRiskNamingAutoFix() {
    if (lowRiskNamingFixes.length === 0) {
      return;
    }
    setErrorMessage(null);
    setNotice(null);
    try {
      const payload = await applyInventoryNamingAutoFix(lowRiskNamingFixes);
      const updatedCount = Number(payload?.data?.updatedCount || 0);
      setNotice(updatedCount > 0 ? `Resolved ${updatedCount} low-risk issue(s).` : "No naming fixes were needed.");
      await loadInventoryData();
      await loadSelectedItemDetails();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to auto-fix low-risk naming issues.");
    }
  }

  async function mergeDuplicateIssue(issue: InventoryIssueRow) {
    if (issue.type !== "DUPLICATE_ITEM" || issue.itemIds.length < 2) {
      return;
    }

    const [primaryItemId, ...duplicateItemIds] = issue.itemIds;
    setErrorMessage(null);
    setNotice(null);
    try {
      await mergeDuplicateInventoryItems({
        primaryItemId,
        duplicateItemIds
      });
      setNotice("Issue resolved.");
      setSelectedItemId(primaryItemId);
      await loadInventoryData();
      await loadSelectedItemDetails();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to merge duplicate items.");
    }
  }

  function focusStockAdjustment(itemId: string) {
    if (!itemId) {
      return;
    }
    const query = new URLSearchParams();
    query.set("movementItemId", itemId);
    query.set("movementType", "ADJUSTMENT");
    routerPush(`/inventory/stock-movements?${query.toString()}`);
  }

  function focusPricingReview(itemId: string) {
    if (!itemId) {
      return;
    }
    routerPush(`/inventory/items?itemId=${encodeURIComponent(itemId)}`);
  }

  function openItemDetail(itemId: string) {
    if (!itemId) {
      return;
    }
    setSelectedItemId(itemId);
    setItemDetailModalOpen(true);
  }

  function openMovementDetail(movementId: string) {
    if (!movementId) {
      return;
    }
    const movementExists = movements.some((movement) => movement.id === movementId);
    if (!movementExists) {
      setErrorMessage("Movement record is no longer available. Refresh and try again.");
      return;
    }
    setSelectedMovementId(movementId);
    setMovementDetailDrawerOpen(true);
  }

  function openIssueQueueForMovement(movementId: string) {
    if (!movementId) {
      return;
    }
    setMovementDetailDrawerOpen(false);
    routerPush(`/inventory/issues?movementId=${encodeURIComponent(movementId)}`);
  }

  function openIssueWorkflow(issueId: string, initialStep: 1 | 2 | 3 = 1) {
    if (!issueId) {
      return;
    }
    const issueExists = issues.some((issue) => issue.id === issueId);
    if (!issueExists) {
      setErrorMessage("Issue context could not be found. Refresh and try again.");
      return;
    }
    setSelectedIssueId(issueId);
    setIssueWorkflowInitialStep(initialStep);
    setIssueWorkflowModalOpen(true);
  }

  function fixInventoryIssue(issue: InventoryIssueRow) {
    if (issue.suggestedCategory) {
      void applyIssueQuickFix(issue, "category");
      return;
    }
    if (issue.suggestedName) {
      const targetItemId = issue.itemIds[0] || "";
      if (issue.autoFixSafe && targetItemId) {
        void applyNamingAutoFix(targetItemId, issue.suggestedName);
      } else {
        void applyIssueQuickFix(issue, "name");
      }
      return;
    }
    if (issue.type === "DUPLICATE_ITEM" && issue.itemIds.length > 1) {
      void mergeDuplicateIssue(issue);
      return;
    }
    if (issue.type === "STOCK_ANOMALY") {
      focusStockAdjustment(issue.itemIds[0] || "");
      return;
    }
    if (issue.type === "PRICE_ANOMALY") {
      focusPricingReview(issue.itemIds[0] || "");
      return;
    }
    if (issue.itemIds[0]) {
      openItemDetail(issue.itemIds[0]);
    }
  }

  return {
    applyIssueQuickFix,
    applyNamingAutoFix,
    applyBulkLowRiskNamingAutoFix,
    mergeDuplicateIssue,
    focusStockAdjustment,
    focusPricingReview,
    fixInventoryIssue,
    openItemDetail,
    openMovementDetail,
    openIssueQueueForMovement,
    openIssueWorkflow
  };
}
