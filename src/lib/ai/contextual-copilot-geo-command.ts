import type {
  CopilotFocusItem,
  CopilotNavigationTarget
} from "@/lib/ai/contextual-copilot-types";
import type { GeoFieldsDecisionCommand } from "@/lib/ai/contextual-copilot-intents";
import { normalizeIssueType } from "@/lib/ai/contextual-copilot-context";
import { condenseReason } from "@/lib/ai/contextual-copilot-text";
import { compactSummaryLine } from "@/lib/ai/contextual-copilot-text";

export function buildGeoFieldsCommandAnswer({
  command,
  focusItems,
  summary,
  topTarget,
  resolveFocusByCommand,
  describeTargetPrecision,
  rankFocusItems
}: {
  command: GeoFieldsDecisionCommand;
  focusItems: CopilotFocusItem[];
  summary: string;
  topTarget: CopilotNavigationTarget | null;
  resolveFocusByCommand: (args: {
    command: GeoFieldsDecisionCommand;
    focusItems: CopilotFocusItem[];
  }) => CopilotFocusItem | null | undefined;
  describeTargetPrecision: (target: CopilotNavigationTarget) => string;
  rankFocusItems: (items: CopilotFocusItem[]) => CopilotFocusItem[];
}) {
  const focus = resolveFocusByCommand({ command, focusItems });
  const focusTarget =
    focus && focus.href
      ? ({
          label: focus.label,
          href: focus.href,
          reason: focus.reason,
          targetId: focus.targetId,
          sectionId: focus.sectionId,
          pageKey: focus.targetPageKey
        } satisfies CopilotNavigationTarget)
      : topTarget;

  if (!focus) {
    if (command === "DATA_GAPS_HURTING_REPORTS") {
      return `${compactSummaryLine(summary)} No major linkage or attribution gaps are visible in this scope.`.trim();
    }
    return `${compactSummaryLine(summary)} I don’t have a strong scoped record for that command yet.`.trim();
  }

  const targetHint =
    focus.href || focus.targetId || focus.sectionId
      ? ` ${focusTarget ? describeTargetPrecision(focusTarget) : "Use the action link to jump to this record."}`
      : "";

  if (command === "TOP_REVENUE_RIG") {
    return `Top revenue rig: ${focus.label}. Why: ${condenseReason(focus.reason, 88)}.${targetHint}`.trim();
  }
  if (command === "HIGHEST_EXPENSE_RIG") {
    return `Highest expense rig: ${focus.label}. Why: ${condenseReason(
      focus.reason,
      82
    )}. Next: confirm cost controls and operational necessity.${targetHint}`.trim();
  }
  if (command === "RIGS_NEEDING_ATTENTION") {
    const additional = rankFocusItems(
      focusItems.filter((item) =>
        ["RIG_RISK", "RIG_UTILIZATION", "MAINTENANCE"].includes(normalizeIssueType(item.issueType))
      )
    )
      .slice(1, 3)
      .map((item) => item.label);
    return `${focus.label} should be first. Why: ${condenseReason(focus.reason, 78)}.${
      additional.length > 0 ? ` Then review ${additional.join(", ")}.` : ""
    }${targetHint}`.trim();
  }
  if (command === "PENDING_MAINTENANCE_RISKS" || command === "TOP_MAINTENANCE_ISSUE") {
    return `Top maintenance risk: ${focus.label}. Why: ${condenseReason(
      focus.reason,
      84
    )}. Next: prioritize approval/escalation based on downtime and urgency.${targetHint}`.trim();
  }
  if (command === "BIGGEST_PROFITABILITY_ISSUE") {
    return `Biggest profitability issue: ${focus.label}. Why: ${condenseReason(
      focus.reason,
      86
    )}.${targetHint}`.trim();
  }
  if (command === "DATA_GAPS_HURTING_REPORTS") {
    return `Top data gap: ${focus.label}. Why: ${condenseReason(
      focus.reason,
      84
    )}. Next: fix linkage to improve reporting confidence.${targetHint}`.trim();
  }
  if (command === "TOP_RIG_RISK") {
    return `Top rig risk: ${focus.label}. Why: ${condenseReason(
      focus.reason,
      84
    )}. Next: inspect this before lower-severity rig items.${targetHint}`.trim();
  }
  if (command === "BIGGEST_APPROVAL_ISSUE") {
    return `Biggest approval issue: ${focus.label}. Why: ${condenseReason(
      focus.reason,
      84
    )}. Next: clear this first to unblock downstream decisions.${targetHint}`.trim();
  }
  return null;
}
