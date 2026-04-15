import type {
  CopilotFocusItem
} from "@/lib/ai/contextual-copilot-types";
import type { GeoFieldsDecisionCommand } from "@/lib/ai/contextual-copilot-intents";
import { normalizeIssueType } from "@/lib/ai/contextual-copilot-context";

export function resolveFocusByCommand({
  command,
  focusItems
}: {
  command: GeoFieldsDecisionCommand;
  focusItems: CopilotFocusItem[];
}) {
  if (command === "TOP_REVENUE_RIG") {
    return (
      findFocusByIssueType(focusItems, ["REVENUE_OPPORTUNITY"]) ||
      findFocusByKeywords(focusItems, ["top revenue rig", "revenue opportunity", "highest revenue rig"])
    );
  }
  if (command === "HIGHEST_EXPENSE_RIG") {
    return (
      findFocusByKeywords(focusItems, ["highest expense rig", "highest cost rig"]) ||
      findFocusByIssueType(focusItems, ["RIG_SPEND", "COST_DRIVER"])
    );
  }
  if (command === "RIGS_NEEDING_ATTENTION") {
    return (
      findFocusByIssueType(focusItems, ["RIG_RISK", "RIG_UTILIZATION", "MAINTENANCE"]) ||
      findFocusByKeywords(focusItems, ["rig condition risk", "underutilized rig", "rig"])
    );
  }
  if (command === "PENDING_MAINTENANCE_RISKS" || command === "TOP_MAINTENANCE_ISSUE") {
    return (
      findFocusByIssueType(focusItems, ["MAINTENANCE"]) ||
      findFocusByKeywords(focusItems, ["maintenance", "waiting for parts", "repair"])
    );
  }
  if (command === "BIGGEST_PROFITABILITY_ISSUE") {
    return (
      findFocusByIssueType(focusItems, ["PROFITABILITY"]) ||
      findFocusByKeywords(focusItems, ["profitability concern", "high spend", "low revenue", "margin"])
    );
  }
  if (command === "DATA_GAPS_HURTING_REPORTS") {
    return (
      findFocusByIssueType(focusItems, ["LINKAGE", "NO_BUDGET"]) ||
      findFocusByKeywords(focusItems, ["missing linkage", "data gap", "unassigned"])
    );
  }
  if (command === "TOP_RIG_RISK") {
    return (
      findFocusByIssueType(focusItems, ["RIG_RISK", "RIG_UTILIZATION", "MAINTENANCE"]) ||
      findFocusByKeywords(focusItems, ["rig condition risk", "top rig risk", "rig"])
    );
  }
  if (command === "BIGGEST_APPROVAL_ISSUE") {
    return (
      findFocusByIssueType(focusItems, ["APPROVAL_BACKLOG"]) ||
      findFocusByKeywords(focusItems, ["approval", "pending", "submitted"])
    );
  }
  return focusItems[0] || null;
}

export function findFocusByIssueType(items: CopilotFocusItem[], issueTypes: string[]) {
  const normalizedTargets = issueTypes.map((type) => normalizeIssueType(type));
  return items.find((item) => normalizedTargets.includes(normalizeIssueType(item.issueType)));
}

export function findFocusByKeywords(items: CopilotFocusItem[], keywords: string[]) {
  const normalizedKeywords = keywords.map((entry) => entry.toLowerCase());
  return items.find((item) => {
    const haystack = `${item.label} ${item.reason}`.toLowerCase();
    return normalizedKeywords.some((keyword) => haystack.includes(keyword));
  });
}
