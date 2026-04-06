import type { CopilotFocusItem } from "@/lib/ai/contextual-copilot";
import { condenseReason } from "@/lib/ai/contextual-copilot-text";
import { focusSeverityRank, formatAsMoney } from "@/lib/ai/contextual-copilot-ranking";
import { normalizeIssueType } from "@/lib/ai/contextual-copilot-context";

export interface CopilotRoleProfileLike {
  segment: "MANAGEMENT" | "OFFICE" | "MECHANIC" | "OPERATIONS" | "GENERAL";
}

export function buildComparisonAnswer({
  normalizedQuestion,
  first,
  second
}: {
  normalizedQuestion: string;
  first: CopilotFocusItem | undefined | null;
  second: CopilotFocusItem | undefined | null;
}) {
  if (!first && !second) {
    return "I don’t have two comparable issues in this scope yet. Ask me to surface more focus items first.";
  }
  if (!first || !second) {
    const item = first || second;
    return `${item?.label} is the only strong focus item right now, so it stays first.`;
  }

  const urgencyWinner =
    focusSeverityRank(first.severity) <= focusSeverityRank(second.severity) ? first : second;
  const valueWinner = (first.amount ?? 0) >= (second.amount ?? 0) ? first : second;
  const effortWinner =
    resolveEffortWeight(first) <= resolveEffortWeight(second) ? first : second;

  if (normalizedQuestion.includes("more urgent")) {
    return `${urgencyWinner.label} is more urgent because it carries ${resolveUrgencyLabel(urgencyWinner).toLowerCase()} urgency (${urgencyWinner.reason}).`;
  }
  if (normalizedQuestion.includes("higher value")) {
    if ((valueWinner.amount ?? 0) <= 0) {
      return `Both issues have limited value metadata, so urgency is a better tiebreaker: ${urgencyWinner.label} first.`;
    }
    return `${valueWinner.label} is higher value at ${formatAsMoney(valueWinner.amount || 0)} impact.`;
  }
  if (normalizedQuestion.includes("easiest to fix")) {
    return `${effortWinner.label} looks easier to fix first (${resolveEffortLabel(effortWinner).toLowerCase()} effort).`;
  }

  const valueLine =
    (valueWinner.amount ?? 0) > 0
      ? `Higher value: ${valueWinner.label} (${formatAsMoney(valueWinner.amount || 0)}).`
      : "Value impact is similar from available data.";
  return [
    `Urgency: ${urgencyWinner.label} should go first.`,
    valueLine,
    `Easiest fix: ${effortWinner.label} (${resolveEffortLabel(effortWinner).toLowerCase()} effort).`
  ].join(" ");
}

export function deriveIgnoreConsequence(topFocus: CopilotFocusItem | undefined) {
  if (!topFocus) {
    return "If this is ignored, hidden risk can accumulate and shift from manageable to urgent without visibility.";
  }
  const issueType = normalizeIssueType(topFocus.issueType);
  if (issueType === "APPROVAL_BACKLOG") {
    return "Ignoring this keeps approval-sensitive data stale, delays decisions, and can distort near-term operational visibility.";
  }
  if (issueType === "BUDGET_PRESSURE" || issueType === "NO_BUDGET") {
    return "Ignoring this can let spend continue without containment and increase budget variance risk.";
  }
  if (issueType === "LINKAGE") {
    return "Ignoring this can keep reporting linkage gaps unresolved, which weakens decision-grade analytics.";
  }
  if (issueType === "MAINTENANCE") {
    return "Ignoring this can extend downtime risk and delay operational recovery.";
  }
  if (issueType === "RIG_RISK") {
    return "Ignoring this can degrade reliability and leave utilization losses unresolved.";
  }
  if (issueType === "PROFITABILITY") {
    return "Ignoring this can let low-margin activity continue and compress net profit.";
  }
  if (issueType === "REVENUE_OPPORTUNITY") {
    return "Ignoring this can delay high-yield production opportunities.";
  }
  if (issueType === "COST_DRIVER") {
    return "Ignoring this can allow concentrated spend to continue without review or corrective action.";
  }
  return `Ignoring ${topFocus.label} can increase operational and financial pressure over time.`;
}

export function buildDecisionGuidance(
  candidates: CopilotFocusItem[],
  roleProfile: CopilotRoleProfileLike | null,
  rankFocusItems: (items: CopilotFocusItem[], roleProfile?: CopilotRoleProfileLike | null) => CopilotFocusItem[]
) {
  const { doNowItem, doNextItem, canWaitItem } = resolveDecisionPlanItems(candidates, roleProfile, rankFocusItems);

  return {
    doNow: doNowItem ? formatDecisionLine(doNowItem) : undefined,
    doNext: doNextItem ? formatDecisionLine(doNextItem) : undefined,
    canWait: canWaitItem
      ? `${formatDecisionLine(canWaitItem)} If delayed: ${resolveDelayRisk(canWaitItem)}`
      : undefined
  };
}

export function resolveDecisionPlanItems(
  candidates: CopilotFocusItem[],
  roleProfile: CopilotRoleProfileLike | null,
  rankFocusItems: (items: CopilotFocusItem[], roleProfile?: CopilotRoleProfileLike | null) => CopilotFocusItem[]
) {
  const ranked = rankFocusItems(candidates, roleProfile);
  const doNowItem = ranked.find((item) => item.severity === "CRITICAL" || item.severity === "HIGH") || ranked[0] || null;
  const remaining = ranked.filter((item) => item.id !== doNowItem?.id);
  const doNextItem =
    [...remaining].sort((a, b) => {
      const amountDiff = (b.amount ?? 0) - (a.amount ?? 0);
      if (amountDiff !== 0) {
        return amountDiff;
      }
      return focusSeverityRank(a.severity) - focusSeverityRank(b.severity);
    })[0] || remaining[0] || null;
  const canWaitItem =
    [...remaining]
      .reverse()
      .find((item) => item.severity === "LOW" || item.severity === "MEDIUM") || null;
  return {
    ranked,
    doNowItem,
    doNextItem,
    canWaitItem
  };
}

export function buildDecisionFirstNarrative({
  doNowItem,
  doNextItem,
  canWaitItem,
  includeCanWait = true
}: {
  doNowItem: CopilotFocusItem | null;
  doNextItem: CopilotFocusItem | null;
  canWaitItem: CopilotFocusItem | null;
  includeCanWait?: boolean;
}) {
  if (!doNowItem) {
    return "";
  }
  const reasonLine = condenseReason(
    doNowItem.reason || "it has the strongest current operational impact",
    68
  );
  const startLine = `Start with ${doNowItem.label} (${reasonLine}).`;
  const nextLine = doNextItem ? `Then ${doNextItem.label}.` : "";
  const canWaitLine =
    includeCanWait && canWaitItem && canWaitItem.id !== doNextItem?.id
      ? `${canWaitItem.label} can wait until later.`
      : "";
  return [startLine, nextLine, canWaitLine].filter(Boolean).join(" ");
}

export function formatDecisionLine(item: CopilotFocusItem) {
  const urgency = resolveUrgencyLabel(item).toLowerCase();
  const impact = resolveImpactLabel(item).toLowerCase();
  const effort = resolveEffortLabel(item).toLowerCase();
  return `${item.label} (${urgency} urgency, ${impact} impact, ${effort} effort).`;
}

export function resolveUrgencyLabel(item: CopilotFocusItem) {
  if (item.severity === "CRITICAL") {
    return "High";
  }
  if (item.severity === "HIGH") {
    return "High";
  }
  if (item.severity === "MEDIUM") {
    return "Medium";
  }
  return "Low";
}

export function resolveImpactLabel(item: CopilotFocusItem) {
  const amount = item.amount ?? 0;
  if (amount >= 100000) {
    return "High";
  }
  if (amount >= 25000) {
    return "Medium";
  }
  if (amount > 0) {
    return "Low";
  }
  return "Unknown";
}

export function resolveEffortWeight(item: CopilotFocusItem) {
  const issueType = normalizeIssueType(item.issueType);
  if (issueType === "APPROVAL_BACKLOG") {
    return 1;
  }
  if (issueType === "LINKAGE") {
    return item.confidence === "HIGH" ? 1 : item.confidence === "MEDIUM" ? 2 : 3;
  }
  if (issueType === "BUDGET_PRESSURE" || issueType === "NO_BUDGET") {
    return 3;
  }
  if (issueType === "MAINTENANCE" || issueType === "RIG_RISK") {
    return 2;
  }
  if (issueType === "REVENUE_OPPORTUNITY") {
    return 1;
  }
  if (issueType === "COST_DRIVER") {
    return 2;
  }
  return 2;
}

export function resolveEffortLabel(item: CopilotFocusItem) {
  const weight = resolveEffortWeight(item);
  if (weight <= 1) {
    return "Low";
  }
  if (weight === 2) {
    return "Medium";
  }
  return "High";
}

export function resolveDelayRisk(item: CopilotFocusItem) {
  const issueType = normalizeIssueType(item.issueType);
  if (issueType === "APPROVAL_BACKLOG") {
    return "pending decisions keep operational numbers stale.";
  }
  if (issueType === "BUDGET_PRESSURE") {
    return "overspend can compound before containment actions are taken.";
  }
  if (issueType === "NO_BUDGET") {
    return "unplanned spend can continue without guardrails.";
  }
  if (issueType === "LINKAGE") {
    return "reporting quality stays degraded and can hide real cost ownership.";
  }
  if (issueType === "MAINTENANCE") {
    return "maintenance queue pressure can increase downtime and service delays.";
  }
  if (issueType === "RIG_RISK") {
    return "rig availability and reliability risk can compound.";
  }
  if (issueType === "PROFITABILITY") {
    return "low-margin operations can continue reducing overall profitability.";
  }
  if (issueType === "REVENUE_OPPORTUNITY") {
    return "revenue opportunity can be delayed by unresolved blockers.";
  }
  if (issueType === "COST_DRIVER") {
    return "concentrated spend may continue without review.";
  }
  return "risk can escalate quietly and require more effort later.";
}
