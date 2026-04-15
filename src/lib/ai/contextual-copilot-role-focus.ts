import type { CopilotFocusItem } from "@/lib/ai/contextual-copilot-types";
import { normalizeIssueType } from "@/lib/ai/contextual-copilot-context";
import { focusSeverityRank } from "@/lib/ai/contextual-copilot-ranking";

export interface CopilotRoleProfileForFocus {
  segment: "MANAGEMENT" | "OFFICE" | "MECHANIC" | "OPERATIONS" | "GENERAL";
}

export function applyRoleFocusMetadata(
  items: CopilotFocusItem[],
  roleProfile: CopilotRoleProfileForFocus
) {
  return items.map((item) => ({
    ...item,
    actionLabel: item.actionLabel || resolveRoleActionLabel(roleProfile, item),
    inspectHint: item.inspectHint || resolveRoleInspectHint(roleProfile, item)
  }));
}

function resolveRoleActionLabel(roleProfile: CopilotRoleProfileForFocus, item: CopilotFocusItem) {
  const issueType = normalizeIssueType(item.issueType);
  const haystack = `${item.label} ${item.reason}`.toLowerCase();

  if (roleProfile.segment === "MANAGEMENT") {
    if (issueType === "APPROVAL_BACKLOG") return "Review approval";
    if (issueType === "MAINTENANCE" || issueType === "RIG_RISK") return "Review maintenance";
    if (issueType === "PROFITABILITY" || issueType === "COST_DRIVER") return "Inspect profitability";
    if (issueType === "LINKAGE") return "Review linkage impact";
    return "Inspect risk";
  }

  if (roleProfile.segment === "OFFICE") {
    if (issueType === "APPROVAL_BACKLOG") return "Review approval";
    if (issueType === "LINKAGE") return "Inspect linkage";
    if (/receipt|invoice|submission/.test(haystack)) return "Review receipt";
    if (/inventory|stock|movement/.test(haystack)) return "Inspect inventory issue";
    return "Complete record";
  }

  if (roleProfile.segment === "MECHANIC") {
    if (issueType === "MAINTENANCE") return "Review maintenance";
    if (issueType === "RIG_RISK" || /rig/.test(haystack)) return "Inspect rig";
    if (/parts|stock|filter|belt|hose|repair/.test(haystack)) return "Review parts need";
    return "Inspect downtime issue";
  }

  if (roleProfile.segment === "OPERATIONS") {
    if (/report|drilling|submission/.test(haystack)) return "Complete report";
    if (/entry|meters|production/.test(haystack)) return "Review drilling entry";
    if (/project/.test(haystack)) return "Inspect project update";
    return "Review rig assignment";
  }

  return "Open record";
}

function resolveRoleInspectHint(roleProfile: CopilotRoleProfileForFocus, item: CopilotFocusItem) {
  const issueType = normalizeIssueType(item.issueType);
  if (roleProfile.segment === "MECHANIC") {
    if (issueType === "MAINTENANCE") {
      return "Inspect urgency, downtime, and parts dependency before escalating.";
    }
    if (issueType === "RIG_RISK") {
      return "Inspect rig condition trend and recent repair history.";
    }
  }
  if (roleProfile.segment === "OFFICE" && issueType === "LINKAGE") {
    return "Inspect missing rig/project/maintenance fields and complete the record.";
  }
  if (roleProfile.segment === "OPERATIONS" && issueType === "APPROVAL_BACKLOG") {
    return "Inspect report completeness and missing production values before submission follow-up.";
  }
  if (roleProfile.segment === "MANAGEMENT" && issueType === "PROFITABILITY") {
    return "Inspect spend versus revenue concentration before deciding next containment action.";
  }
  return item.inspectHint || undefined;
}

function roleIssuePriorityBoost({
  item,
  roleProfile
}: {
  item: CopilotFocusItem;
  roleProfile: CopilotRoleProfileForFocus | null;
}) {
  if (!roleProfile || roleProfile.segment === "GENERAL") {
    return 0;
  }

  const issueType = normalizeIssueType(item.issueType);
  const haystack = `${item.label} ${item.reason}`.toLowerCase();
  let boost = 0;

  if (roleProfile.segment === "MANAGEMENT") {
    if (
      [
        "BUDGET_PRESSURE",
        "PROFITABILITY",
        "APPROVAL_BACKLOG",
        "MAINTENANCE",
        "LINKAGE",
        "COST_DRIVER",
        "RIG_SPEND",
        "PROJECT_SPEND"
      ].includes(issueType)
    ) {
      boost += 24;
    }
    if (/client|project|profit|margin|overspent|bottleneck/.test(haystack)) {
      boost += 8;
    }
  } else if (roleProfile.segment === "OFFICE") {
    if (
      ["APPROVAL_BACKLOG", "LINKAGE", "COST_DRIVER", "RIG_SPEND", "PROJECT_SPEND", "NO_BUDGET"].includes(
        issueType
      )
    ) {
      boost += 24;
    }
    if (/receipt|expense|inventory|stock|completion|missing/.test(haystack)) {
      boost += 9;
    }
  } else if (roleProfile.segment === "MECHANIC") {
    if (["MAINTENANCE", "RIG_RISK", "RIG_SPEND"].includes(issueType)) {
      boost += 28;
    }
    if (/breakdown|repair|parts|downtime|rig|workshop/.test(haystack)) {
      boost += 10;
    }
    if (["PROFITABILITY", "REVENUE_OPPORTUNITY", "COST_DRIVER", "PROJECT_SPEND", "BUDGET_PRESSURE"].includes(issueType)) {
      boost -= 22;
    }
  } else if (roleProfile.segment === "OPERATIONS") {
    if (["APPROVAL_BACKLOG", "RIG_RISK", "LINKAGE"].includes(issueType)) {
      boost += 22;
    }
    if (/report|drilling|submission|production|assignment|project update|delayed/.test(haystack)) {
      boost += 12;
    }
    if (["PROFITABILITY", "BUDGET_PRESSURE", "REVENUE_OPPORTUNITY"].includes(issueType)) {
      boost -= 14;
    }
  }

  return boost;
}

export function rankFocusItems(
  items: CopilotFocusItem[],
  roleProfile: CopilotRoleProfileForFocus | null = null
) {
  return [...items].sort((a, b) => {
    const roleScoreDiff =
      roleIssuePriorityBoost({ item: b, roleProfile }) - roleIssuePriorityBoost({ item: a, roleProfile });
    if (roleScoreDiff !== 0) {
      return roleScoreDiff;
    }
    const severityDiff = focusSeverityRank(a.severity) - focusSeverityRank(b.severity);
    if (severityDiff !== 0) {
      return severityDiff;
    }
    const amountA = a.amount ?? 0;
    const amountB = b.amount ?? 0;
    if (amountB !== amountA) {
      return amountB - amountA;
    }
    return a.label.localeCompare(b.label);
  });
}

export function rankFocusItemsForDecisionGuidance(
  items: CopilotFocusItem[],
  roleProfile: CopilotRoleProfileForFocus | null | undefined
) {
  return rankFocusItems(items, roleProfile || null);
}
