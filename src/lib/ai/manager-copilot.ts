import type { AlertType, AlertsCenterRow } from "@/lib/alerts-center";
import type { BudgetAlertSummary } from "@/lib/budget-vs-actual";

export type AlertCopilotMode =
  | "PRIORITIZE_SELECTED"
  | "EXPLAIN_SELECTED"
  | "SUGGEST_ASSIGNMENTS"
  | "ROW_INSIGHT";

export interface AlertOwnerCandidate {
  userId: string;
  name: string;
}

export interface AlertCopilotInsight {
  alertKey: string;
  whyItMatters: string;
  suggestedNextAction: string;
  suggestedOwnerUserId: string | null;
  suggestedOwnerName: string | null;
  aiPriorityScore: number;
  aiPriorityLabel: "Low" | "Medium" | "High" | "Urgent";
}

export interface ExecutiveCopilotQueueSummary {
  label: string;
  count: number;
  over24h: number;
  over3d: number;
  oldestPendingAt: string | null;
}

export interface ExecutiveCopilotContext {
  generatedAt: string;
  totals: {
    revenue: number;
    recognizedSpend: number;
    profit: number;
    pendingApprovals: number;
  };
  budget: BudgetAlertSummary;
  highestCostRig: {
    name: string;
    totalRecognizedCost: number;
  } | null;
  highestCostProject: {
    name: string;
    totalRecognizedCost: number;
  } | null;
  topMaintenanceArea: { reference: string; rigName: string; totalLinkedCost: number } | null;
  missingLinkageCount: number;
  approvalQueues: ExecutiveCopilotQueueSummary[];
}

export interface ExecutiveCopilotOutput {
  generatedAt: string;
  todaysSummary: string;
  topRisks: string[];
  topRecommendedActions: string[];
  budgetPressureSummary: string;
  approvalBacklogSummary: string;
  answer: string | null;
}

export function buildAlertCopilotInsights({
  alerts,
  owners
}: {
  alerts: AlertsCenterRow[];
  owners: AlertOwnerCandidate[];
}): AlertCopilotInsight[] {
  return alerts.map((alert) => {
    const aiPriorityScore = calculateAlertPriorityScore(alert);
    const aiPriorityLabel = resolvePriorityLabel(aiPriorityScore);
    const suggestedOwner = suggestOwnerForAlert({ alert, owners });

    return {
      alertKey: alert.alertKey,
      whyItMatters: explainAlertImpact(alert, aiPriorityLabel),
      suggestedNextAction: suggestNextAction(alert),
      suggestedOwnerUserId: suggestedOwner?.userId || null,
      suggestedOwnerName: suggestedOwner?.name || null,
      aiPriorityScore,
      aiPriorityLabel
    };
  });
}

export function buildExecutiveCopilotSummary({
  context,
  question
}: {
  context: ExecutiveCopilotContext;
  question?: string;
}): ExecutiveCopilotOutput {
  const topRisks = deriveTopRisks(context);
  const topRecommendedActions = deriveTopRecommendedActions(context);
  const budgetPressureSummary = buildBudgetPressureSummary(context);
  const approvalBacklogSummary = buildApprovalBacklogSummary(context);

  return {
    generatedAt: new Date().toISOString(),
    todaysSummary: buildTodaysSummary(context),
    topRisks,
    topRecommendedActions,
    budgetPressureSummary,
    approvalBacklogSummary,
    answer: question ? answerExecutiveQuestion({ context, question }) : null
  };
}

function calculateAlertPriorityScore(alert: AlertsCenterRow) {
  const severityScore = alert.severity === "CRITICAL" ? 42 : 24;
  const ageScore = scoreFromAge(alert.ageHours);
  const amountScore = scoreFromAmount(alert.amount);
  const statusScore = alert.status === "OPEN" ? 12 : alert.status === "SNOOZED" ? 6 : 2;
  const typeScore = scoreFromAlertType(alert.alertType);
  const rawScore = severityScore + ageScore + amountScore + statusScore + typeScore;
  return Math.max(0, Math.min(100, rawScore));
}

function resolvePriorityLabel(score: number): AlertCopilotInsight["aiPriorityLabel"] {
  if (score >= 85) {
    return "Urgent";
  }
  if (score >= 65) {
    return "High";
  }
  if (score >= 40) {
    return "Medium";
  }
  return "Low";
}

function scoreFromAge(ageHours: number | null) {
  if (!ageHours || ageHours <= 0) {
    return 4;
  }
  if (ageHours >= 72) {
    return 24;
  }
  if (ageHours >= 24) {
    return 16;
  }
  return 8;
}

function scoreFromAmount(amount: number | null) {
  if (!amount || amount <= 0) {
    return 0;
  }
  if (amount >= 100000) {
    return 20;
  }
  if (amount >= 25000) {
    return 14;
  }
  if (amount >= 5000) {
    return 8;
  }
  return 4;
}

function scoreFromAlertType(type: AlertType) {
  switch (type) {
    case "BUDGET_OVERSPENT":
      return 22;
    case "BUDGET_CRITICAL":
      return 18;
    case "BUDGET_WATCH":
      return 10;
    case "STALE_PENDING_APPROVAL":
      return 16;
    case "MISSING_MAINTENANCE_LINKAGE":
      return 18;
    case "MISSING_PROJECT_LINKAGE":
    case "MISSING_RIG_LINKAGE":
      return 11;
    default:
      return 0;
  }
}

function explainAlertImpact(alert: AlertsCenterRow, priorityLabel: AlertCopilotInsight["aiPriorityLabel"]) {
  const age = alert.ageHours ? `Age ${alert.ageHours}h` : "Recently detected";
  const amountText = alert.amount ? `Amount at stake ${formatMoneyShort(alert.amount)}.` : "No direct amount attached.";
  return `${priorityLabel} priority. ${age}. ${amountText} ${alert.currentContext}`;
}

function suggestNextAction(alert: AlertsCenterRow) {
  if (alert.alertType === "STALE_PENDING_APPROVAL") {
    return "Clear pending decision first, then notify affected team if still blocked.";
  }
  if (alert.alertType === "BUDGET_OVERSPENT" || alert.alertType === "BUDGET_CRITICAL") {
    return "Review top spend drivers and enforce near-term budget controls for this entity.";
  }
  if (alert.alertType === "BUDGET_WATCH") {
    return "Monitor upcoming spend and confirm no large unplanned costs are queued.";
  }
  if (alert.alertType === "MISSING_MAINTENANCE_LINKAGE") {
    return "Link the missing maintenance reference to restore accurate maintenance costing.";
  }
  if (alert.alertType === "MISSING_RIG_LINKAGE" || alert.alertType === "MISSING_PROJECT_LINKAGE") {
    return "Fix missing linkage now so dashboards and budget tracking stay reliable.";
  }
  return alert.recommendedAction;
}

function suggestOwnerForAlert({
  alert,
  owners
}: {
  alert: AlertsCenterRow;
  owners: AlertOwnerCandidate[];
}) {
  if (alert.assignedOwnerUserId) {
    const alreadyAssigned = owners.find((owner) => owner.userId === alert.assignedOwnerUserId);
    if (alreadyAssigned) {
      return alreadyAssigned;
    }
  }

  const lowerType = alert.alertType.toLowerCase();
  if (lowerType.includes("approval")) {
    return findOwnerByKeyword(owners, ["manager", "admin", "office", "approv"]);
  }
  if (lowerType.includes("budget")) {
    return findOwnerByKeyword(owners, ["manager", "admin", "finance", "account"]);
  }
  return findOwnerByKeyword(owners, ["manager", "admin", "ops", "operat", "data"]);
}

function findOwnerByKeyword(owners: AlertOwnerCandidate[], keywords: string[]) {
  for (const keyword of keywords) {
    const found = owners.find((owner) => owner.name.toLowerCase().includes(keyword));
    if (found) {
      return found;
    }
  }
  return owners[0] || null;
}

function buildTodaysSummary(context: ExecutiveCopilotContext) {
  const recognizedSpend = context.totals.recognizedSpend;
  const direction = context.totals.profit >= 0 ? "positive" : "negative";
  return `Recognized finance snapshot is ${direction}: revenue ${formatMoneyShort(context.totals.revenue)} vs expenses ${formatMoneyShort(recognizedSpend)}, with ${context.totals.pendingApprovals} pending approvals still open.`;
}

function deriveTopRisks(context: ExecutiveCopilotContext) {
  const risks: string[] = [];

  if (context.budget.overspentCount > 0) {
    risks.push(`${context.budget.overspentCount} budget bucket(s) are overspent.`);
  }
  if (context.budget.criticalCount > 0) {
    risks.push(`${context.budget.criticalCount} bucket(s) are in critical budget range (>90%).`);
  }
  const staleApprovals = context.approvalQueues.reduce((sum, queue) => sum + queue.over3d, 0);
  if (staleApprovals > 0) {
    risks.push(`${staleApprovals} approval item(s) are older than 3 days.`);
  }
  if (context.missingLinkageCount > 0) {
    risks.push(`${context.missingLinkageCount} recognized spend item(s) still need linkage cleanup.`);
  }
  if (risks.length === 0) {
    risks.push("No immediate critical risk signals detected from current scope.");
  }
  return risks.slice(0, 3);
}

function deriveTopRecommendedActions(context: ExecutiveCopilotContext) {
  const actions: string[] = [];
  if (context.budget.overspentCount > 0 || context.budget.criticalCount > 0) {
    actions.push("Review overspent and critical budget buckets first, then cap discretionary spend.");
  }
  const staleQueues = context.approvalQueues
    .filter((queue) => queue.over24h > 0 || queue.over3d > 0)
    .sort((a, b) => b.over3d - a.over3d || b.over24h - a.over24h);
  if (staleQueues.length > 0) {
    actions.push(`Clear stale approvals in ${staleQueues[0].label} queue to reduce operational blocking.`);
  }
  if (context.missingLinkageCount > 0) {
    actions.push("Run linkage corrections so rig/project reporting remains decision-grade.");
  }
  if (actions.length === 0) {
    actions.push("Continue monitoring current scope; no urgent intervention detected.");
  }
  return actions.slice(0, 3);
}

function buildBudgetPressureSummary(context: ExecutiveCopilotContext) {
  return `${context.budget.overspentCount} overspent, ${context.budget.criticalCount} critical, ${context.budget.watchCount} watch, ${context.budget.noBudgetCount} no-budget bucket(s).`;
}

function buildApprovalBacklogSummary(context: ExecutiveCopilotContext) {
  const total = context.approvalQueues.reduce((sum, queue) => sum + queue.count, 0);
  const stale24 = context.approvalQueues.reduce((sum, queue) => sum + queue.over24h, 0);
  const stale72 = context.approvalQueues.reduce((sum, queue) => sum + queue.over3d, 0);
  return `${total} pending approvals, with ${stale24} over 24h and ${stale72} over 3 days.`;
}

function answerExecutiveQuestion({
  context,
  question
}: {
  context: ExecutiveCopilotContext;
  question: string;
}) {
  const q = question.toLowerCase();
  const recognizedSpend = context.totals.recognizedSpend;
  const highestRigCost = context.highestCostRig?.totalRecognizedCost || 0;
  const highestProjectCost = context.highestCostProject?.totalRecognizedCost || 0;
  if (q.includes("budget")) {
    return `Budget pressure: ${buildBudgetPressureSummary(context)} Focus first on overspent and critical buckets.`;
  }
  if (q.includes("approval") || q.includes("backlog")) {
    return `Approval backlog: ${buildApprovalBacklogSummary(context)}`;
  }
  if (q.includes("profit") || q.includes("revenue") || q.includes("expense")) {
    return `Finance snapshot: revenue ${formatMoneyShort(context.totals.revenue)}, recognized expenses ${formatMoneyShort(recognizedSpend)}, profit ${formatMoneyShort(context.totals.profit)}.`;
  }
  if (q.includes("rig")) {
    return context.highestCostRig
      ? `Highest cost rig is ${context.highestCostRig.name} at ${formatMoneyShort(highestRigCost)} recognized spend.`
      : "No rig cost concentration found in current scope.";
  }
  if (q.includes("project")) {
    return context.highestCostProject
      ? `Highest cost project is ${context.highestCostProject.name} at ${formatMoneyShort(highestProjectCost)} recognized spend.`
      : "No project cost concentration found in current scope.";
  }
  return `Top risks right now: ${deriveTopRisks(context).join(" ")}`;
}

function formatMoneyShort(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0
  }).format(value);
}
