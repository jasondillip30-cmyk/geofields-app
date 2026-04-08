import type { UserRole } from "@/lib/types";
import type {
  CopilotFocusItem,
  CopilotInsightCardKind,
  CopilotPageContext,
  CopilotTablePreview
} from "@/lib/ai/contextual-copilot-types";
import { normalizeKey } from "@/lib/ai/contextual-copilot-text";
import {
  inferBudgetSectionId,
  inferPageKeyFromHref,
  linkageSectionIdForType,
  normalizeFocusItems,
  normalizeIssueType,
  resolveScopedPageHref
} from "@/lib/ai/contextual-copilot-context";
import {
  findMetricString,
  findMetricValue,
  formatAsMoney,
  inferApprovalTab,
  readConfidence,
  readNumber,
  readString,
  roundNumber
} from "@/lib/ai/contextual-copilot-ranking";
import {
  applyRoleFocusMetadata,
  mergeFocusItemsByRecord,
  rankFocusItems
} from "@/lib/ai/contextual-copilot-navigation";

type CopilotRoleSegment = "MANAGEMENT" | "OFFICE" | "MECHANIC" | "OPERATIONS" | "GENERAL";

interface CopilotRoleProfile {
  role: UserRole | null;
  segment: CopilotRoleSegment;
  preferredCardKinds: CopilotInsightCardKind[];
  followUpPrompts: string[];
}

export function deriveFocusItems(context: CopilotPageContext, roleProfile: CopilotRoleProfile) {
  const explicitItems = normalizeFocusItems(context.priorityItems || []);
  const tablePreviews = context.tablePreviews || [];
  const scopedPageHref = resolveScopedPageHref(context);

  let baseItems: CopilotFocusItem[] = [];
  if (explicitItems.length > 0) {
    baseItems = explicitItems;
  } else if (context.pageKey === "executive-overview") {
    baseItems = deriveExecutiveFocusItems(tablePreviews);
  } else if (context.pageKey === "alerts-center") {
    baseItems = deriveAlertsFocusItems(tablePreviews);
  } else if (context.pageKey === "data-quality-linkage-center") {
    baseItems = deriveLinkageFocusItems(tablePreviews);
  } else if (context.pageKey === "budget-vs-actual") {
    baseItems = deriveBudgetFocusItems(tablePreviews);
  } else if (context.pageKey === "expenses") {
    baseItems = deriveExpensesFocusItems(tablePreviews);
  } else if (context.pageKey === "maintenance") {
    baseItems = deriveMaintenanceFocusItems(tablePreviews);
  } else if (context.pageKey === "rigs") {
    baseItems = deriveRigsFocusItems(tablePreviews);
  } else {
    baseItems = deriveGenericFocusItems(context);
  }

  const normalized = normalizeFocusItems([...baseItems, ...deriveMetricFocusItems(context)]).map((item) => ({
    ...item,
    href: item.href || scopedPageHref,
    targetPageKey: item.targetPageKey || context.pageKey
  }));
  const roleScoped = applyRoleFocusMetadata(mergeFocusItemsByRecord(normalized), roleProfile);
  const diversityScoped =
    context.pageKey === "executive-overview"
      ? applyExecutiveFocusDiversity(roleScoped, roleProfile)
      : roleScoped;
  return rankFocusItems(diversityScoped, roleProfile).slice(0, 8);
}

function deriveExecutiveFocusItems(tablePreviews: CopilotTablePreview[]) {
  const items: CopilotFocusItem[] = [];
  const budgetRiskPreview = tablePreviews.find((preview) => preview.key === "budget-risk");
  const approvalQueuePreview = tablePreviews.find((preview) => preview.key === "approval-queues");

  for (const row of budgetRiskPreview?.rows || []) {
    const entity = readString(row, ["entity", "name", "label"]);
    const status = readString(row, ["status", "statusLabel", "alertLevel"]);
    if (!entity || !status) {
      continue;
    }
    const percentUsed = readNumber(row, ["percentUsed"]);
    const recognizedSpend = readNumber(row, ["recognizedSpend", "spend", "amount"]);
    const severity =
      /overspent/i.test(status) ? "CRITICAL" : /critical/i.test(status) ? "HIGH" : "MEDIUM";
    items.push({
      id: readString(row, ["id", "entityId"]) || `budget-${normalizeKey(entity)}`,
      label: entity,
      severity,
      amount: recognizedSpend,
      href: readString(row, ["href"]) || "/cost-tracking/budget-vs-actual",
      targetId: readString(row, ["targetId", "id", "entityId"]) || undefined,
      sectionId: readString(row, ["sectionId"]) || undefined,
      targetPageKey: "budget-vs-actual",
      issueType: "BUDGET_PRESSURE",
      reason:
        severity === "CRITICAL"
          ? `${entity} is overspent and needs immediate containment.`
          : `${entity} is in critical budget pressure${percentUsed !== null ? ` (${roundNumber(percentUsed)}% used)` : ""}.`
    });
  }

  for (const row of approvalQueuePreview?.rows || []) {
    const queue = readString(row, ["queue", "label"]);
    const pending = readNumber(row, ["pending", "count"]) || 0;
    const over3d = readNumber(row, ["over3d"]) || 0;
    const over24h = readNumber(row, ["over24h"]) || 0;
    if (!queue || pending <= 0) {
      continue;
    }
    const severity = over3d > 0 ? "HIGH" : over24h > 0 ? "MEDIUM" : "LOW";
    const queueTab = inferApprovalTab(queue);
    const queueLooksLikeDrilling = /drilling/i.test(queue || "");
    items.push({
      id: `queue-${normalizeKey(queue)}`,
      label: queue,
      severity,
      amount: pending,
      href: readString(row, ["href"]) || (queueTab ? `/approvals?tab=${queueTab}` : "/approvals"),
      sectionId: queueTab ? `approvals-tab-${queueTab}` : undefined,
      targetPageKey: "approvals",
      issueType: queueLooksLikeDrilling ? "DRILLING_REPORT_COMPLETENESS" : "APPROVAL_BACKLOG",
      reason: queueLooksLikeDrilling
        ? over3d > 0
          ? `${queue} has ${roundNumber(over3d)} report(s) older than 3 days and daily drilling visibility is stale.`
          : `${queue} has ${roundNumber(pending)} report(s) pending approval and daily drilling completeness is at risk.`
        : over3d > 0
          ? `${queue} has ${roundNumber(over3d)} item(s) older than 3 days.`
          : `${queue} has ${roundNumber(pending)} pending approval item(s).`
    });
  }

  return items;
}

function applyExecutiveFocusDiversity(
  items: CopilotFocusItem[],
  roleProfile: CopilotRoleProfile
) {
  const ranked = rankFocusItems(items, roleProfile);
  const profitabilityItems = ranked.filter((item) => isExecutiveProfitabilityItem(item));
  if (profitabilityItems.length <= 1) {
    return ranked;
  }

  const highPriorityNonProfitabilityCount = ranked.filter(
    (item) =>
      !isExecutiveProfitabilityItem(item) &&
      (item.severity === "CRITICAL" || item.severity === "HIGH")
  ).length;
  const maxProfitabilityItems = highPriorityNonProfitabilityCount > 0 ? 1 : 2;

  let keptProfitabilityCount = 0;
  const filtered: CopilotFocusItem[] = [];
  for (const item of ranked) {
    if (isExecutiveProfitabilityItem(item)) {
      if (keptProfitabilityCount >= maxProfitabilityItems) {
        continue;
      }
      keptProfitabilityCount += 1;
    }
    filtered.push(item);
  }

  return filtered;
}

function isExecutiveProfitabilityItem(item: CopilotFocusItem) {
  const issueType = normalizeIssueType(item.issueType);
  if (issueType === "PROFITABILITY") {
    return true;
  }
  const haystack = `${item.label} ${item.reason}`.toLowerCase();
  return /profitability|lowest profit|margin|high spend|low revenue|declining client/.test(haystack);
}

function deriveAlertsFocusItems(tablePreviews: CopilotTablePreview[]) {
  const items: CopilotFocusItem[] = [];
  const preview = tablePreviews.find((entry) => entry.key === "visible-alerts");
  for (const row of preview?.rows || []) {
    const entity = readString(row, ["entity"]);
    const alertType = readString(row, ["type", "alertType"]);
    const status = readString(row, ["status"]);
    const severityRaw = readString(row, ["severity"]);
    if (!entity || !severityRaw) {
      continue;
    }
    const severity = /^critical$/i.test(severityRaw) ? "CRITICAL" : "HIGH";
    const ageHours = readNumber(row, ["ageHours", "age"]) || 0;
    const amount = readNumber(row, ["amount"]);
    const actionWord =
      status === "OPEN"
        ? severity === "CRITICAL"
          ? "Resolve first"
          : ageHours >= 24
            ? "Resolve or escalate"
            : "Monitor or snooze"
        : status === "SNOOZED"
          ? "Recheck snoozed state"
          : "No immediate action";
    items.push({
      id: readString(row, ["alertKey", "id"]) || `alert-${normalizeKey(entity)}`,
      label: entity,
      severity,
      amount,
      href: readString(row, ["href", "destinationHref"]) || "/alerts-center",
      targetId: readString(row, ["targetId", "alertKey", "id"]) || undefined,
      sectionId: readString(row, ["sectionId"]) || undefined,
      targetPageKey:
        readString(row, ["targetPageKey"]) ||
        inferPageKeyFromHref(readString(row, ["href", "destinationHref"]) || undefined),
      issueType: normalizeIssueType(alertType),
      reason: `${alertType || "Alert"} • ${actionWord}${ageHours > 0 ? ` • ${roundNumber(ageHours)}h old` : ""}.`
    });
  }
  return items;
}

function deriveLinkageFocusItems(tablePreviews: CopilotTablePreview[]) {
  const items: CopilotFocusItem[] = [];
  const mapping: Array<{ key: string; linkage: string }> = [
    { key: "missing-rig", linkage: "Rig" },
    { key: "missing-project", linkage: "Project" },
    { key: "missing-maintenance", linkage: "Maintenance" }
  ];

  for (const entry of mapping) {
    const preview = tablePreviews.find((candidate) => candidate.key === entry.key);
    for (const row of preview?.rows || []) {
      const reference = readString(row, ["reference", "label", "record"]);
      const amount = readNumber(row, ["amount"]);
      if (!reference) {
        continue;
      }
      const numericAmount = amount ?? 0;
      const severity = numericAmount >= 50000 ? "HIGH" : numericAmount >= 10000 ? "MEDIUM" : "LOW";
      items.push({
        id: readString(row, ["rowId", "id"]) || `${entry.key}-${normalizeKey(reference)}`,
        label: reference,
        severity,
        amount,
        href: readString(row, ["href"]) || "/data-quality/linkage-center",
        targetId: readString(row, ["targetId", "rowId", "id"]) || undefined,
        sectionId: readString(row, ["sectionId"]) || linkageSectionIdForType(entry.linkage),
        targetPageKey: "data-quality-linkage-center",
        issueType: normalizeIssueType(`${entry.linkage} linkage`),
        confidence: readConfidence(row, ["confidence", "suggestionConfidence"]),
        reason: `${entry.linkage} linkage is missing and should be corrected for reporting consistency.`
      });
    }
  }

  return items;
}

function deriveBudgetFocusItems(tablePreviews: CopilotTablePreview[]) {
  const items: CopilotFocusItem[] = [];
  const previews = tablePreviews.filter(
    (preview) => preview.key === "rig-budget-vs-actual" || preview.key === "project-budget-vs-actual"
  );

  for (const preview of previews) {
    for (const row of preview.rows) {
      const entity =
        readString(row, ["rig", "project", "entity", "name", "label"]) || readString(row, ["id"]);
      const status = readString(row, ["status", "statusLabel"]) || "On Track";
      const amount = readNumber(row, ["recognizedSpend", "amount"]);
      const percentUsed = readNumber(row, ["percentUsed"]);
      if (!entity) {
        continue;
      }
      const severity =
        /overspent/i.test(status)
          ? "CRITICAL"
          : /critical/i.test(status)
            ? "HIGH"
            : /watch/i.test(status)
              ? "MEDIUM"
              : /no budget/i.test(status)
                ? "MEDIUM"
                : "LOW";
      if (severity === "LOW") {
        continue;
      }
      items.push({
        id: readString(row, ["id", "entityId"]) || `budget-${normalizeKey(entity)}`,
        label: entity,
        severity,
        amount,
        href: readString(row, ["href"]) || "/cost-tracking/budget-vs-actual",
        targetId: readString(row, ["targetId", "id", "entityId"]) || undefined,
        sectionId: readString(row, ["sectionId"]) || inferBudgetSectionId(row),
        targetPageKey: "budget-vs-actual",
        issueType: normalizeIssueType(status),
        reason: `${status}${percentUsed !== null ? ` (${roundNumber(percentUsed)}% used)` : ""} requires attention.`
      });
    }
  }

  return items;
}

function deriveExpensesFocusItems(tablePreviews: CopilotTablePreview[]) {
  const items: CopilotFocusItem[] = [];
  const categoryPreview = tablePreviews.find((preview) => preview.key === "expenses-by-category");
  const projectPreview = tablePreviews.find((preview) => preview.key === "expenses-by-project");
  const rigPreview = tablePreviews.find((preview) => preview.key === "expenses-by-rig");
  const approvalSensitivePreview = tablePreviews.find(
    (preview) => preview.key === "expense-approval-sensitive"
  );
  const missingLinkagePreview = tablePreviews.find(
    (preview) => preview.key === "expense-missing-linkage"
  );

  const topCategory = categoryPreview?.rows[0];
  if (topCategory) {
    const categoryName = readString(topCategory, ["name", "category", "label"]);
    const amount = readNumber(topCategory, ["amount", "total", "recognizedSpend"]);
    const share = readNumber(topCategory, ["share", "percent", "percentUsed"]);
    if (categoryName) {
      items.push({
        id: readString(topCategory, ["id"]) || `expense-category-${normalizeKey(categoryName)}`,
        label: `Cost Driver • ${categoryName}`,
        severity: (share ?? 0) >= 45 ? "HIGH" : "MEDIUM",
        amount,
        href: readString(topCategory, ["href"]) || "/expenses",
        sectionId: readString(topCategory, ["sectionId"]) || "expenses-category-driver-section",
        targetPageKey: "expenses",
        issueType: "COST_DRIVER",
        reason:
          amount !== null
            ? `${categoryName} is currently the largest visible category at ${formatAsMoney(amount)}.`
            : `${categoryName} is the largest visible category in scope.`
      });
    }
  }

  const topProject = projectPreview?.rows[0];
  if (topProject) {
    const projectName = readString(topProject, ["name", "project", "label"]);
    const amount = readNumber(topProject, ["amount", "total", "recognizedSpend"]);
    const share = readNumber(topProject, ["share", "percent", "percentUsed"]);
    if (projectName) {
      items.push({
        id: readString(topProject, ["id"]) || `expense-project-${normalizeKey(projectName)}`,
        label: `Highest Cost Project • ${projectName}`,
        severity: (share ?? 0) >= 40 ? "HIGH" : "MEDIUM",
        amount,
        href: readString(topProject, ["href"]) || "/expenses",
        sectionId: readString(topProject, ["sectionId"]) || "expenses-project-driver-section",
        targetPageKey: "expenses",
        issueType: "PROJECT_SPEND",
        reason:
          amount !== null
            ? `${projectName} is the top project spend driver at ${formatAsMoney(amount)}.`
            : `${projectName} is the top project spend driver in scope.`
      });
    }
  }

  const topRig = rigPreview?.rows[0];
  if (topRig) {
    const rigName = readString(topRig, ["name", "rig", "label"]);
    const amount = readNumber(topRig, ["amount", "total", "recognizedSpend"]);
    const share = readNumber(topRig, ["share", "percent", "percentUsed"]);
    if (rigName) {
      const isUnassigned = /unassigned/i.test(rigName);
      items.push({
        id: readString(topRig, ["id"]) || `expense-rig-${normalizeKey(rigName)}`,
        label: `Highest Cost Rig • ${rigName}`,
        severity: isUnassigned ? "HIGH" : (share ?? 0) >= 35 ? "HIGH" : "MEDIUM",
        amount,
        href: readString(topRig, ["href"]) || "/expenses",
        sectionId: readString(topRig, ["sectionId"]) || "expenses-rig-driver-section",
        targetPageKey: "expenses",
        issueType: isUnassigned ? "LINKAGE" : "RIG_SPEND",
        reason: isUnassigned
          ? `Rig linkage is missing for ${formatAsMoney(amount || 0)} of spend and should be corrected.`
          : amount !== null
            ? `${rigName} currently carries ${formatAsMoney(amount)} of visible spend.`
            : `${rigName} currently leads rig-linked spend in this scope.`
      });
    }
  }

  for (const row of approvalSensitivePreview?.rows || []) {
    const id = readString(row, ["id"]);
    const amount = readNumber(row, ["amount", "total"]);
    const project = readString(row, ["project"]);
    const category = readString(row, ["category"]);
    if (!id) {
      continue;
    }
    items.push({
      id,
      label: `Approval-Sensitive Spend • ${project || category || id}`,
      severity: (amount ?? 0) >= 30000 ? "HIGH" : "MEDIUM",
      amount,
      href: readString(row, ["href"]) || "/expenses",
      targetId: readString(row, ["targetId", "id"]) || id,
      sectionId: readString(row, ["sectionId"]) || "expenses-records-section",
      targetPageKey: "expenses",
      issueType: "APPROVAL_BACKLOG",
      reason: `Submitted expense${amount !== null ? ` of ${formatAsMoney(amount)}` : ""} should be reviewed promptly.`
    });
  }

  for (const row of missingLinkagePreview?.rows || []) {
    const id = readString(row, ["id"]);
    const amount = readNumber(row, ["amount", "total"]);
    const missing = readString(row, ["missing", "issue", "linkage"]);
    const category = readString(row, ["category", "label"]);
    if (!id) {
      continue;
    }
    items.push({
      id: `linkage-${id}`,
      label: `Missing Linkage • ${category || id}`,
      severity: (amount ?? 0) >= 20000 ? "HIGH" : "MEDIUM",
      amount,
      href: readString(row, ["href"]) || "/expenses",
      targetId: readString(row, ["targetId", "id"]) || id,
      sectionId: readString(row, ["sectionId"]) || "expenses-records-section",
      targetPageKey: "expenses",
      issueType: "LINKAGE",
      reason: `${missing || "Rig/Project linkage"} is missing and can weaken expense reporting quality.`
    });
  }

  return items;
}

function deriveMaintenanceFocusItems(tablePreviews: CopilotTablePreview[]) {
  const items: CopilotFocusItem[] = [];
  const requestsPreview = tablePreviews.find((preview) => preview.key === "maintenance-requests");
  for (const row of requestsPreview?.rows || []) {
    const requestCode = readString(row, ["request", "requestCode", "label"]) || readString(row, ["id"]);
    const rig = readString(row, ["rig"]);
    const status = readString(row, ["status"]) || "";
    const urgency = readString(row, ["urgency"]) || "";
    const downtimeHours = readNumber(row, ["downtimeHours", "downtime"]);
    const partsCost = readNumber(row, ["partsCost", "amount"]);
    const pendingHours = readNumber(row, ["pendingHours", "ageHours", "hoursPending"]);
    if (!requestCode) {
      continue;
    }

    const waitingApproval = /submitted|under_review/i.test(status);
    const waitingTooLong = waitingApproval && pendingHours !== null && pendingHours >= 48;
    const unresolvedCritical = /critical/i.test(urgency) && !/completed|denied/i.test(status);
    const severity = unresolvedCritical
      ? "CRITICAL"
      : waitingTooLong
        ? pendingHours >= 72
          ? "CRITICAL"
          : "HIGH"
        : waitingApproval || /waiting_for_parts|in_repair/i.test(status)
        ? "HIGH"
        : "MEDIUM";

    items.push({
      id: readString(row, ["id"]) || `maintenance-${normalizeKey(requestCode)}`,
      label: `${requestCode}${rig ? ` • ${rig}` : ""}`,
      severity,
      amount: partsCost,
      href: readString(row, ["href"]) || "/maintenance",
      targetId: readString(row, ["targetId", "id"]) || undefined,
      sectionId: readString(row, ["sectionId"]) || "maintenance-log-section",
      targetPageKey: readString(row, ["targetPageKey"]) || "maintenance",
      issueType: waitingApproval ? "APPROVAL_BACKLOG" : "MAINTENANCE",
      reason: buildMaintenanceReason({
        status,
        urgency,
        downtimeHours,
        partsCost,
        pendingHours
      })
    });
  }
  return items;
}

function deriveRigsFocusItems(tablePreviews: CopilotTablePreview[]) {
  const items: CopilotFocusItem[] = [];
  const conditionPreview = tablePreviews.find((preview) => preview.key === "rig-condition");
  const revenuePreview = tablePreviews.find((preview) => preview.key === "rig-revenue");
  const expensePreview = tablePreviews.find((preview) => preview.key === "rig-expenses");
  const utilizationPreview = tablePreviews.find((preview) => preview.key === "rig-utilization");

  for (const row of conditionPreview?.rows || []) {
    const rig = readString(row, ["rig", "name", "label"]);
    const condition = readString(row, ["condition"]) || "";
    const score = readNumber(row, ["score", "conditionScore"]);
    if (!rig) {
      continue;
    }
    const isCritical = /critical|poor/i.test(condition) || (score !== null && score < 45);
    if (!isCritical) {
      continue;
    }
    items.push({
      id: readString(row, ["id"]) || `rig-condition-${normalizeKey(rig)}`,
      label: `Rig condition risk • ${rig}`,
      severity: /critical/i.test(condition) || (score !== null && score < 30) ? "CRITICAL" : "HIGH",
      amount: null,
      href: readString(row, ["href"]) || "/rigs",
      targetId: readString(row, ["targetId", "id"]) || undefined,
      sectionId: readString(row, ["sectionId"]) || "rig-registry-section",
      targetPageKey: readString(row, ["targetPageKey"]) || "rigs",
      issueType: "RIG_RISK",
      reason: `${condition || "Poor"} condition${score !== null ? ` (score ${roundNumber(score)})` : ""} needs manager review.`
    });
  }

  const topRevenue = revenuePreview?.rows[0];
  if (topRevenue) {
    const rig = readString(topRevenue, ["rig", "name", "label"]);
    const revenue = readNumber(topRevenue, ["revenue", "amount", "total"]);
    if (rig) {
      items.push({
        id: readString(topRevenue, ["id"]) || `rig-revenue-${normalizeKey(rig)}`,
        label: `Top revenue rig • ${rig}`,
        severity: "MEDIUM",
        amount: revenue,
        href: readString(topRevenue, ["href"]) || "/rigs",
        targetId: readString(topRevenue, ["targetId", "id"]) || undefined,
        sectionId: readString(topRevenue, ["sectionId"]) || "rig-registry-section",
        targetPageKey: readString(topRevenue, ["targetPageKey"]) || "rigs",
        issueType: "REVENUE_OPPORTUNITY",
        reason:
          revenue !== null
            ? `${rig} currently leads recognized revenue at ${formatAsMoney(revenue)}.`
            : `${rig} currently leads revenue contribution in scope.`
      });
    }
  }

  const topExpense = expensePreview?.rows[0];
  if (topExpense) {
    const rig = readString(topExpense, ["rig", "name", "label"]);
    const expense = readNumber(topExpense, ["expense", "amount", "total"]);
    if (rig) {
      items.push({
        id: readString(topExpense, ["id"]) || `rig-expense-${normalizeKey(rig)}`,
        label: `Highest expense rig • ${rig}`,
        severity: expense !== null && expense >= 50000 ? "HIGH" : "MEDIUM",
        amount: expense,
        href: readString(topExpense, ["href"]) || "/rigs",
        targetId: readString(topExpense, ["targetId", "id"]) || undefined,
        sectionId: readString(topExpense, ["sectionId"]) || "rig-registry-section",
        targetPageKey: readString(topExpense, ["targetPageKey"]) || "rigs",
        issueType: "RIG_SPEND",
        reason:
          expense !== null
            ? `${rig} currently carries ${formatAsMoney(expense)} in recognized cost.`
            : `${rig} currently carries the highest visible expense load.`
      });
    }
  }

  for (const row of utilizationPreview?.rows || []) {
    const rig = readString(row, ["rig", "name", "label"]);
    const utilization = readNumber(row, ["utilization", "utilizationPercent"]);
    const status = readString(row, ["status"]);
    if (!rig) {
      continue;
    }
    const underutilized = (utilization !== null && utilization < 35) || /idle/i.test(status || "");
    if (!underutilized) {
      continue;
    }
    items.push({
      id: readString(row, ["id"]) || `rig-utilization-${normalizeKey(rig)}`,
      label: `Underutilized rig • ${rig}`,
      severity: /idle/i.test(status || "") ? "HIGH" : "MEDIUM",
      amount: null,
      href: readString(row, ["href"]) || "/rigs",
      targetId: readString(row, ["targetId", "id"]) || undefined,
      sectionId: readString(row, ["sectionId"]) || "rig-registry-section",
      targetPageKey: readString(row, ["targetPageKey"]) || "rigs",
      issueType: "RIG_UTILIZATION",
      reason: `${rig} is underutilized${utilization !== null ? ` (${roundNumber(utilization)}% utilization)` : ""} and may be reassigned.`
    });
  }

  return items;
}

function buildMaintenanceReason({
  status,
  urgency,
  downtimeHours,
  partsCost,
  pendingHours
}: {
  status: string;
  urgency: string;
  downtimeHours: number | null;
  partsCost: number | null;
  pendingHours: number | null;
}) {
  const parts: string[] = [];
  if (urgency) {
    parts.push(`${urgency} urgency`);
  }
  if (status) {
    parts.push(status.replace(/_/g, " ").toLowerCase());
  }
  if (downtimeHours !== null && downtimeHours > 0) {
    parts.push(`${roundNumber(downtimeHours)}h estimated downtime`);
  }
  if (pendingHours !== null && pendingHours > 0 && /submitted|under_review/i.test(status)) {
    parts.push(`${roundNumber(pendingHours)}h waiting approval`);
  }
  if (partsCost !== null && partsCost > 0) {
    parts.push(`parts ${formatAsMoney(partsCost)}`);
  }
  return parts.length > 0 ? `${parts.join(" • ")}.` : "Maintenance item requires review.";
}

function deriveMetricFocusItems(context: CopilotPageContext) {
  const items: CopilotFocusItem[] = [];
  const topRevenueRig = findMetricString(context.summaryMetrics, [/top revenue rig/i, /highest revenue rig/i]);
  const topRevenueRigAmount = findMetricValue(context.summaryMetrics, [/top revenue rig amount/i, /highest revenue rig amount/i]);
  if (topRevenueRig && topRevenueRig !== "N/A") {
    items.push({
      id: `metric-top-revenue-rig-${normalizeKey(topRevenueRig)}`,
      label: `Top revenue rig • ${topRevenueRig}`,
      reason:
        topRevenueRigAmount > 0
          ? `${topRevenueRig} currently leads recognized revenue at ${formatAsMoney(topRevenueRigAmount)}.`
          : `${topRevenueRig} currently leads recognized revenue in scope.`,
      severity: "MEDIUM",
      amount: topRevenueRigAmount || null,
      issueType: "REVENUE_OPPORTUNITY"
    });
  }

  const topRevenueProject = findMetricString(context.summaryMetrics, [/top revenue project/i]);
  const topRevenueProjectAmount = findMetricValue(context.summaryMetrics, [/top revenue project amount/i]);
  if (topRevenueProject && topRevenueProject !== "N/A") {
    items.push({
      id: `metric-top-revenue-project-${normalizeKey(topRevenueProject)}`,
      label: `Top revenue project • ${topRevenueProject}`,
      reason:
        topRevenueProjectAmount > 0
          ? `${topRevenueProject} currently leads recognized project revenue at ${formatAsMoney(topRevenueProjectAmount)}.`
          : `${topRevenueProject} currently leads recognized project revenue in scope.`,
      severity: "MEDIUM",
      amount: topRevenueProjectAmount || null,
      issueType: "REVENUE_OPPORTUNITY"
    });
  }

  const topRevenueClient = findMetricString(context.summaryMetrics, [/top revenue client/i]);
  const topRevenueClientAmount = findMetricValue(context.summaryMetrics, [/top revenue client amount/i]);
  if (topRevenueClient && topRevenueClient !== "N/A") {
    items.push({
      id: `metric-top-revenue-client-${normalizeKey(topRevenueClient)}`,
      label: `Top revenue client • ${topRevenueClient}`,
      reason:
        topRevenueClientAmount > 0
          ? `${topRevenueClient} is currently the strongest client revenue contributor at ${formatAsMoney(topRevenueClientAmount)}.`
          : `${topRevenueClient} is currently the strongest client revenue contributor in scope.`,
      severity: "MEDIUM",
      amount: topRevenueClientAmount || null,
      issueType: "REVENUE_OPPORTUNITY"
    });
  }

  const highestExpenseRig = findMetricString(context.summaryMetrics, [/highest expense rig/i, /highest cost rig/i]);
  const highestExpenseRigAmount = findMetricValue(context.summaryMetrics, [/highest expense rig amount/i, /highest cost rig amount/i]);
  if (highestExpenseRig && highestExpenseRig !== "N/A") {
    items.push({
      id: `metric-highest-expense-rig-${normalizeKey(highestExpenseRig)}`,
      label: `Highest expense rig • ${highestExpenseRig}`,
      reason:
        highestExpenseRigAmount > 0
          ? `${highestExpenseRig} currently carries ${formatAsMoney(highestExpenseRigAmount)} of recognized spend.`
          : `${highestExpenseRig} currently carries the highest recognized spend in scope.`,
      severity: highestExpenseRigAmount >= 50000 ? "HIGH" : "MEDIUM",
      amount: highestExpenseRigAmount || null,
      issueType: "RIG_SPEND"
    });
  }

  const profitabilityIssue = findMetricString(context.summaryMetrics, [/profitability concern/i, /biggest profitability issue/i]);
  const profitabilityAmount = findMetricValue(context.summaryMetrics, [/profitability concern amount/i, /profitability impact/i]);
  if (profitabilityIssue && profitabilityIssue !== "N/A") {
    items.push({
      id: `metric-profitability-${normalizeKey(profitabilityIssue)}`,
      label: `Profitability concern • ${profitabilityIssue}`,
      reason:
        profitabilityAmount !== 0
          ? `${profitabilityIssue} has a current profitability gap of ${formatAsMoney(Math.abs(profitabilityAmount))}.`
          : `${profitabilityIssue} is the current profitability concern to review.`,
      severity: profitabilityAmount < 0 ? "HIGH" : "MEDIUM",
      amount: Math.abs(profitabilityAmount) || null,
      issueType: "PROFITABILITY"
    });
  }

  const decliningClient = findMetricString(
    context.summaryMetrics,
    [/declining profitability client/i, /lowest profit client/i]
  );
  const decliningClientAmount = findMetricValue(
    context.summaryMetrics,
    [/declining profitability client amount/i, /lowest profit client amount/i]
  );
  if (decliningClient && decliningClient !== "N/A") {
    items.push({
      id: `metric-declining-client-${normalizeKey(decliningClient)}`,
      label: `Client profitability concern • ${decliningClient}`,
      reason:
        decliningClientAmount < 0
          ? `${decliningClient} is currently below break-even (${formatAsMoney(decliningClientAmount)}).`
          : `${decliningClient} is currently the weakest profitability client in scope.`,
      severity: decliningClientAmount < 0 ? "HIGH" : "MEDIUM",
      amount: Math.abs(decliningClientAmount) || null,
      issueType: "PROFITABILITY"
    });
  }

  const revenueAttributionGapAmount = findMetricValue(
    context.summaryMetrics,
    [/missing revenue rig attribution amount/i, /revenue missing rig attribution amount/i]
  );
  if (revenueAttributionGapAmount > 0) {
    items.push({
      id: "metric-revenue-attribution-gap",
      label: "Revenue attribution gap",
      reason: `${formatAsMoney(
        revenueAttributionGapAmount
      )} in recognized revenue is missing rig attribution and can weaken rig-level performance decisions.`,
      severity: "HIGH",
      amount: revenueAttributionGapAmount,
      issueType: "LINKAGE"
    });
  }

  return items;
}

function deriveGenericFocusItems(context: CopilotPageContext) {
  const items: CopilotFocusItem[] = [];
  for (const [index, item] of (context.selectedItems || []).entries()) {
    items.push({
      id: item.id,
      label: item.label || item.id,
      severity: "MEDIUM",
      reason: "Selected item is currently in focus.",
      href: undefined,
      targetId: item.id,
      targetPageKey: context.pageKey,
      issueType: normalizeIssueType(item.type)
    });
    if (index >= 4) {
      break;
    }
  }
  return items;
}
