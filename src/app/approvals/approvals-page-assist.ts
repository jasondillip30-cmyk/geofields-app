import type { CopilotFocusTarget } from "@/components/layout/copilot-focus-target";
import type { WorkflowAssistModel } from "@/components/layout/workflow-assist-panel";
import type {
  DrillingApprovalRow,
  InventoryUsageApprovalRow,
  ReceiptSubmissionApprovalRow
} from "./approvals-page-types";
import type { UserRole } from "@/lib/types";
import { formatCurrency, formatNumber } from "@/lib/utils";
import {
  getDrillingPendingDate,
  getInventoryPendingDate,
  getPendingAgeMeta,
  getReceiptSubmissionPendingDate,
  resolveApprovalsAssistRoleLabel
} from "./approvals-page-utils";

interface BuildApprovalWorkflowAssistInput {
  assistTarget: CopilotFocusTarget | null;
  focusedReceiptRow: ReceiptSubmissionApprovalRow | null;
  focusedDrillingRow: DrillingApprovalRow | null;
  focusedInventoryRow: InventoryUsageApprovalRow | null;
  inventoryRowWarnings: Record<string, string>;
  userRole: UserRole | null;
}

export function buildApprovalWorkflowAssist({
  assistTarget,
  focusedReceiptRow,
  focusedDrillingRow,
  focusedInventoryRow,
  inventoryRowWarnings,
  userRole
}: BuildApprovalWorkflowAssistInput): WorkflowAssistModel | null {
  const roleLabel = resolveApprovalsAssistRoleLabel(userRole);
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
}
