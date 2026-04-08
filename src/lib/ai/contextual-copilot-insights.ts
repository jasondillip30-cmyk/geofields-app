import type { UserRole } from "@/lib/types";
import type {
  ContextualCopilotResponsePayload,
  CopilotFocusItem,
  CopilotInsightCard,
  CopilotInsightCardKind,
  CopilotPageContext
} from "@/lib/ai/contextual-copilot-types";
import {
  condenseReason,
  dedupeText,
  normalizeKey
} from "@/lib/ai/contextual-copilot-text";
import {
  countActiveFilters,
  normalizeIssueType
} from "@/lib/ai/contextual-copilot-context";
import {
  buildIssueTypeCounts,
  findMetricString,
  findMetricValue,
  focusSeverityRank,
  formatAsMoney,
  formatMetricValue,
  hasMetric,
  resolveLargestMetric,
  roundNumber
} from "@/lib/ai/contextual-copilot-ranking";
import {
  buildDecisionGuidance,
  resolveEffortWeight,
} from "@/lib/ai/contextual-copilot-response";
import {
  dedupeFocusCandidatesByRecord,
  dedupeInsightCardsByKind,
  rankFocusItems,
  rankFocusItemsForDecisionGuidance
} from "@/lib/ai/contextual-copilot-navigation";

type CopilotRoleSegment = "MANAGEMENT" | "OFFICE" | "MECHANIC" | "OPERATIONS" | "GENERAL";

interface CopilotRoleProfile {
  role: UserRole | null;
  segment: CopilotRoleSegment;
  preferredCardKinds: CopilotInsightCardKind[];
  followUpPrompts: string[];
}

export function deriveSummary({
  context,
  focusItems
}: {
  context: CopilotPageContext;
  focusItems: CopilotFocusItem[];
}) {
  const scoped = countActiveFilters(context.filters) > 0;
  const top = focusItems[0];
  const sourceCount = context.sourcePageKeys?.length || 0;

  if (context.pageKey === "atlas-related" || context.pageKey === "atlas-whole-app") {
    const critical = focusItems.filter((item) => item.severity === "CRITICAL").length;
    const high = focusItems.filter((item) => item.severity === "HIGH").length;
    const topLabel = top?.label || "No immediate high-priority target";
    if (critical + high > 0) {
      return `Atlas ${context.pageKey === "atlas-whole-app" ? "whole-app" : "related-data"} view: ${critical} critical and ${high} high-priority items across ${sourceCount || 1} page context(s). Top focus: ${topLabel}.`;
    }
    return `Atlas ${context.pageKey === "atlas-whole-app" ? "whole-app" : "related-data"} view is stable across ${sourceCount || 1} page context(s), with no critical concentration detected.`;
  }

  if (context.pageKey === "executive-overview") {
    const overspent = findMetricValue(context.summaryMetrics, [/overspent/i]);
    const critical = findMetricValue(context.summaryMetrics, [/critical/i]);
    const pending = findMetricValue(context.summaryMetrics, [/pending approvals?/i]);
    if (overspent > 0 || critical > 0) {
      return `Risk pressure is elevated with ${overspent} overspent and ${critical} critical budget bucket(s), plus ${pending} pending approvals.`;
    }
    return scoped
      ? "Executive metrics are stable in the current filtered scope."
      : "Executive metrics are currently stable across global scope.";
  }

  if (context.pageKey === "alerts-center") {
    const critical = findMetricValue(context.summaryMetrics, [/critical alerts?/i, /critical/i]);
    const unresolved = findMetricValue(context.summaryMetrics, [/unresolved/i, /open/i]);
    return critical > 0
      ? `${critical} critical alerts require attention in ${unresolved} unresolved items.`
      : `${unresolved} unresolved alerts remain; no critical concentration detected.`;
  }

  if (context.pageKey === "data-quality-linkage-center") {
    const costAffected = findMetricValue(context.summaryMetrics, [/cost affected/i]);
    const linkageCount = findMetricValue(context.summaryMetrics, [/linkage/i]);
    return `${linkageCount} linkage record(s) can impact ${formatAsMoney(costAffected)} recognized cost reporting.`;
  }

  if (context.pageKey === "budget-vs-actual") {
    const overspent = findMetricValue(context.summaryMetrics, [/overspent/i]);
    const critical = findMetricValue(context.summaryMetrics, [/critical/i]);
    const watch = findMetricValue(context.summaryMetrics, [/watch/i]);
    const noBudget = findMetricValue(context.summaryMetrics, [/no budget/i]);
    return `Budget status: ${overspent} overspent, ${critical} critical, ${watch} watch, ${noBudget} no-budget bucket(s).`;
  }

  if (context.pageKey === "expenses") {
    const total = findMetricValue(context.summaryMetrics, [/total expenses/i, /totalExpenses/i]);
    const recognized = findMetricValue(context.summaryMetrics, [
      /recognized expenses/i,
      /recognizedExpenses/i
    ]);
    const submitted = findMetricValue(context.summaryMetrics, [/submitted expenses/i, /submittedExpenses/i]);
    const missingRig = findMetricValue(context.summaryMetrics, [/missing rig linkage/i, /missingRigLinkage/i]);
    const missingProject = findMetricValue(
      context.summaryMetrics,
      [/missing project linkage/i, /missingProjectLinkage/i]
    );
    const topCategory = findMetricString(context.summaryMetrics, [/largest category/i, /biggest category/i]);
    const topProject = findMetricString(context.summaryMetrics, [/highest cost project/i]);
    const topRig = findMetricString(context.summaryMetrics, [/highest cost rig/i]);
    if (total <= 0) {
      return "No expense spend is visible in the current scope yet.";
    }
    const details = [
      `Visible spend is ${formatAsMoney(total)} (${formatAsMoney(recognized)} recognized).`,
      topCategory && topCategory !== "N/A" ? `Largest category is ${topCategory}.` : null,
      topProject && topProject !== "N/A" ? `Highest-cost project is ${topProject}.` : null,
      topRig && topRig !== "N/A" ? `Highest-cost rig is ${topRig}.` : null,
      submitted > 0 ? `${submitted} expense(s) are approval-sensitive.` : null,
      missingRig + missingProject > 0 ? `${missingRig + missingProject} record(s) need linkage cleanup.` : null
    ].filter(Boolean);
    return details.join(" ");
  }

  if (context.pageKey === "rigs") {
    const active = findMetricValue(context.summaryMetrics, [/active/i]);
    const idle = findMetricValue(context.summaryMetrics, [/idle/i]);
    const poorCondition = findMetricValue(context.summaryMetrics, [/poor.*condition/i, /critical.*condition/i]);
    const topRevenueRig = findMetricString(context.summaryMetrics, [/top revenue rig/i]);
    const highestExpenseRig = findMetricString(context.summaryMetrics, [/highest expense rig/i, /highest cost rig/i]);
    const details = [
      `${active} active rig(s), ${idle} idle rig(s), ${poorCondition} in poor/critical condition.`,
      topRevenueRig && topRevenueRig !== "N/A" ? `Top revenue rig: ${topRevenueRig}.` : null,
      highestExpenseRig && highestExpenseRig !== "N/A" ? `Highest expense rig: ${highestExpenseRig}.` : null
    ].filter(Boolean);
    return details.join(" ");
  }

  if (context.pageKey === "drilling-reports") {
    const reports = findMetricValue(context.summaryMetrics, [/reports?/i]);
    const pending = findMetricValue(context.summaryMetrics, [/pending approvals?/i, /submitted/i]);
    const meters = findMetricValue(context.summaryMetrics, [/meters/i]);
    return `Drilling scope: ${reports} report(s), ${roundNumber(meters)} meters, ${pending} awaiting approval.`;
  }

  if (context.pageKey === "breakdowns") {
    const critical = findMetricValue(context.summaryMetrics, [/critical/i]);
    const open = findMetricValue(context.summaryMetrics, [/open|active/i]);
    const downtime = findMetricValue(context.summaryMetrics, [/downtime/i]);
    return `Breakdown pressure: ${critical} critical, ${open} open, ${roundNumber(downtime)} estimated downtime hours.`;
  }

  if (context.pageKey.startsWith("inventory")) {
    const lowStock = findMetricValue(context.summaryMetrics, [/low stock/i]);
    const outOfStock = findMetricValue(context.summaryMetrics, [/out of stock/i]);
    const issues = findMetricValue(context.summaryMetrics, [/issues?/i]);
    return `Inventory status: ${outOfStock} out-of-stock, ${lowStock} low-stock, ${issues} quality issue(s) in current scope.`;
  }

  if (context.pageKey === "maintenance") {
    const submitted = findMetricValue(context.summaryMetrics, [/submitted/i]);
    const waitingParts = findMetricValue(context.summaryMetrics, [/waiting.*parts/i]);
    const critical = findMetricValue(context.summaryMetrics, [/critical/i]);
    const oldestHours = findMetricValue(context.summaryMetrics, [/oldest pending hours/i]);
    return `Maintenance workload: ${submitted} submitted, ${waitingParts} waiting for parts, ${critical} critical urgency item(s)${oldestHours > 0 ? `, oldest pending ~${roundNumber(oldestHours)}h` : ""}.`;
  }

  if (context.pageKey === "profit") {
    const profit = findMetricValue(context.summaryMetrics, [/profit/i]);
    const margin = findMetricValue(context.summaryMetrics, [/margin/i]);
    const lowMargin = findMetricValue(context.summaryMetrics, [/low margin/i]);
    return `Profit scope: ${formatAsMoney(profit)} total profit, ${roundNumber(margin)}% margin, ${lowMargin} low-margin contributor(s).`;
  }

  if (context.pageKey === "forecasting") {
    const baseline = findMetricValue(context.summaryMetrics, [/baseline.*30 day/i]);
    const simulated = findMetricValue(context.summaryMetrics, [/simulated.*30 day/i]);
    const delta = findMetricValue(context.summaryMetrics, [/delta/i]);
    return `Forecast outlook: baseline ${formatAsMoney(baseline)}, simulated ${formatAsMoney(simulated)}, delta ${formatAsMoney(delta)}.`;
  }

  return top
    ? `Top focus in current scope: ${top.label}.`
    : "No high-priority focus items were detected in the current scope.";
}

export function deriveKeyInsights({
  context,
  focusItems
}: {
  context: CopilotPageContext;
  focusItems: CopilotFocusItem[];
}) {
  const insights: string[] = [];

  const activeFilters = countActiveFilters(context.filters);
  if (activeFilters > 0) {
    insights.push(`Current view is scoped by ${activeFilters} active filter(s), so totals are not global.`);
  }

  const pageInsights = derivePageSpecificInsights({ context, focusItems });
  insights.push(...pageInsights);

  const pendingApprovals = findMetricValue(context.summaryMetrics, [/pending approvals?/i, /pending/i]);
  if (pendingApprovals > 0) {
    insights.push(`${pendingApprovals} pending approval item(s) still need manager action.`);
  }

  const overspentCount = findMetricValue(context.summaryMetrics, [/overspent/i]);
  if (overspentCount > 0) {
    insights.push(`${overspentCount} budget bucket(s) are overspent and need immediate containment.`);
  }

  const linkageCount = findMetricValue(context.summaryMetrics, [/missing.*linkage/i, /needs linkage/i]);
  if (linkageCount > 0) {
    insights.push(`${linkageCount} record(s) still need rig/project/maintenance linkage.`);
  }

  if (focusItems.length > 0) {
    const top = focusItems[0];
    insights.push(`Top recommended focus: ${top.label} — ${top.reason}`);
  }

  const sessionFocusLabel = context.sessionContext?.currentFocusTarget?.label;
  if (sessionFocusLabel) {
    insights.push(`Continuing from your current focus target: ${sessionFocusLabel}.`);
  }
  const recentSuggestedLabel = context.sessionContext?.recentSuggestedFocus?.[0]?.label;
  if (recentSuggestedLabel && recentSuggestedLabel !== sessionFocusLabel) {
    insights.push(`Recent cross-page focus to keep in mind: ${recentSuggestedLabel}.`);
  }

  const topMetric = resolveLargestMetric(context.summaryMetrics);
  if (topMetric) {
    insights.push(`Largest tracked metric in view: ${topMetric.label} (${formatMetricValue(topMetric.value)}).`);
  }

  if (insights.length === 0) {
    insights.push("No critical outliers detected from the currently provided page context.");
  }

  return dedupeText(insights).slice(0, 6);
}

function derivePageSpecificInsights({
  context,
  focusItems
}: {
  context: CopilotPageContext;
  focusItems: CopilotFocusItem[];
}) {
  if (context.pageKey === "atlas-related" || context.pageKey === "atlas-whole-app") {
    const groupedByType = buildIssueTypeCounts(focusItems);
    const topTypes = groupedByType
      .slice(0, 3)
      .map((entry) => `${entry.type.toLowerCase()} (${entry.count})`)
      .join(", ");
    return [
      context.pageKey === "atlas-whole-app"
        ? "Atlas whole-app mode is combining cross-module signals for manager prioritization."
        : "Atlas related-data mode is combining the current module with directly related signals.",
      topTypes
        ? `Dominant cross-page issue groups: ${topTypes}.`
        : "No dominant cross-page issue concentration is currently detected.",
      focusItems[0]
        ? `Most actionable cross-page target right now: ${focusItems[0].label}.`
        : "No high-impact cross-page target is currently surfaced."
    ];
  }

  if (context.pageKey === "executive-overview") {
    const profit = findMetricValue(context.summaryMetrics, [/^profit$/i, /\bprofit\b/i]);
    const critical = findMetricValue(context.summaryMetrics, [/critical/i]);
    const overspent = findMetricValue(context.summaryMetrics, [/overspent/i]);
    const topRevenueRig = findMetricString(context.summaryMetrics, [/top revenue rig/i]);
    const topRevenueProject = findMetricString(context.summaryMetrics, [/top revenue project/i]);
    const topRevenueClient = findMetricString(context.summaryMetrics, [/top revenue client/i]);
    const profitabilityConcern = findMetricString(context.summaryMetrics, [/profitability concern/i, /biggest profitability issue/i]);
    const decliningClient = findMetricString(
      context.summaryMetrics,
      [/declining profitability client/i, /lowest profit client/i]
    );
    const drillingPending = findMetricValue(
      context.summaryMetrics,
      [/incomplete drilling reports/i, /drilling reports pending/i]
    );
    const missingRevenueRigAttribution = findMetricValue(
      context.summaryMetrics,
      [/missing revenue rig attribution/i, /revenue missing rig attribution/i]
    );
    const insights = [
      overspent > 0 || critical > 0
        ? `Executive risk pressure is elevated: ${overspent} overspent and ${critical} critical buckets.`
        : "Executive risk pressure is currently stable."
    ];
    if (profit < 0) {
      insights.push("Profit is negative in the current scope and needs immediate spend/revenue review.");
    }
    if (focusItems.length > 0) {
      insights.push(`Operational hotspot: ${focusItems[0].label}.`);
    }
    if (topRevenueRig && topRevenueRig !== "N/A") {
      insights.push(`Best-performing rig in scope: ${topRevenueRig}.`);
    }
    if (topRevenueProject && topRevenueProject !== "N/A") {
      insights.push(`Best-performing project in scope: ${topRevenueProject}.`);
    }
    if (topRevenueClient && topRevenueClient !== "N/A") {
      insights.push(`Best-performing client in scope: ${topRevenueClient}.`);
    }
    if (profitabilityConcern && profitabilityConcern !== "N/A") {
      insights.push(`Primary profitability concern: ${profitabilityConcern}.`);
    }
    if (decliningClient && decliningClient !== "N/A") {
      insights.push(`Client profitability needs review: ${decliningClient}.`);
    }
    if (drillingPending > 0) {
      insights.push(
        `${drillingPending} drilling report(s) are still pending and can delay daily operational clarity.`
      );
    }
    if (missingRevenueRigAttribution > 0) {
      insights.push(
        `${formatAsMoney(
          missingRevenueRigAttribution
        )} revenue currently lacks rig attribution and should be linked for accurate rig performance reporting.`
      );
    }
    return insights;
  }

  if (context.pageKey === "alerts-center") {
    const critical = findMetricValue(context.summaryMetrics, [/critical alerts?/i, /critical/i]);
    const warning = findMetricValue(context.summaryMetrics, [/warning alerts?/i, /warning/i]);
    const unresolved = findMetricValue(context.summaryMetrics, [/unresolved/i, /open/i]);
    const groupedByType = buildIssueTypeCounts(focusItems);
    const staleCount = focusItems.filter((item) => /old|stale|day/i.test(item.reason)).length;
    return [
      `Alerts triage snapshot: ${critical} critical, ${warning} warning, ${unresolved} unresolved.`,
      groupedByType.length > 0
        ? `Primary alert concentrations: ${groupedByType
            .slice(0, 2)
            .map((entry) => `${entry.type.toLowerCase()} (${entry.count})`)
            .join(", ")}.`
        : "No dominant alert category concentration detected.",
      staleCount > 0
        ? `${staleCount} alert(s) are stale by age and should be triaged for resolve/snooze/escalate decisions.`
        : "No stale alert concentration detected.",
      focusItems.length > 0
        ? `Highest-priority alert in view: ${focusItems[0].label}.`
        : "No unresolved alerts detected in the current filtered view."
    ];
  }

  if (context.pageKey === "data-quality-linkage-center") {
    const costAffected = findMetricValue(context.summaryMetrics, [/cost affected/i]);
    const missingRig = findMetricValue(context.summaryMetrics, [/rig linkage/i]);
    const missingProject = findMetricValue(context.summaryMetrics, [/project linkage/i]);
    const missingMaintenance = findMetricValue(context.summaryMetrics, [/maintenance linkage/i]);
    const highValueLowConfidence = focusItems
      .filter((item) => (item.amount ?? 0) >= 50000 && item.confidence === "LOW")
      .length;
    const quickWinCount = focusItems
      .filter((item) => (item.amount ?? 0) < 25000 && item.confidence === "HIGH")
      .length;
    return [
      `Linkage impact: ${missingRig + missingProject + missingMaintenance} record(s) need correction, affecting ${formatAsMoney(costAffected)} recognized cost.`,
      highValueLowConfidence > 0
        ? `${highValueLowConfidence} high-value linkage candidate(s) have low confidence and need manager judgment.`
        : "Highest-value linkage candidates have acceptable confidence for guided review.",
      quickWinCount > 0
        ? `${quickWinCount} lower-value linkage item(s) look like high-confidence quick wins.`
        : "No clear high-confidence quick wins detected yet in current scope.",
      focusItems.length > 0
        ? `Highest-impact linkage candidate: ${focusItems[0].label}.`
        : "No high-impact linkage candidates detected in current scope."
    ];
  }

  if (context.pageKey === "budget-vs-actual") {
    const overspent = findMetricValue(context.summaryMetrics, [/overspent/i]);
    const critical = findMetricValue(context.summaryMetrics, [/critical/i]);
    const watch = findMetricValue(context.summaryMetrics, [/watch/i]);
    const noBudget = findMetricValue(context.summaryMetrics, [/no budget/i]);
    const insights = [
      `Budget pressure: ${overspent} overspent, ${critical} critical, ${watch} watch, ${noBudget} no-budget bucket(s).`,
      focusItems.length > 0
        ? `Most urgent budget item: ${focusItems[0].label}.`
        : "No urgent budget pressure detected in the current filtered scope."
    ];
    if (noBudget > 0) {
      insights.push("No-budget buckets are informational; prioritize overspent and critical buckets first.");
    }
    return insights;
  }

  if (context.pageKey === "expenses") {
    const total = findMetricValue(context.summaryMetrics, [/total expenses/i, /totalExpenses/i]);
    const recognized = findMetricValue(context.summaryMetrics, [
      /recognized expenses/i,
      /recognizedExpenses/i
    ]);
    const submittedCount = findMetricValue(context.summaryMetrics, [/submitted expenses/i, /submittedExpenses/i]);
    const submittedAmount = findMetricValue(
      context.summaryMetrics,
      [/submitted expense amount/i, /submittedExpenseAmount/i]
    );
    const missingRig = findMetricValue(context.summaryMetrics, [/missing rig linkage/i, /missingRigLinkage/i]);
    const missingProject = findMetricValue(
      context.summaryMetrics,
      [/missing project linkage/i, /missingProjectLinkage/i]
    );
    const missingClient = findMetricValue(
      context.summaryMetrics,
      [/missing client linkage/i, /missingClientLinkage/i]
    );
    const missingAmount = findMetricValue(context.summaryMetrics, [/missing linkage amount/i, /missingLinkageAmount/i]);
    const unusualSpikes = findMetricValue(
      context.summaryMetrics,
      [/unusual cost spikes/i, /unusualCostSpikes/i]
    );
    const topCategory = findMetricString(context.summaryMetrics, [/largest category/i, /biggest category/i]);
    const topProject = findMetricString(context.summaryMetrics, [/highest cost project/i]);
    const topRig = findMetricString(context.summaryMetrics, [/highest cost rig/i]);
    const linkageTotal = missingRig + missingProject + missingClient;
    return [
      total > 0
        ? `Expenses in view: ${formatAsMoney(total)} total, with ${formatAsMoney(recognized)} currently recognized.`
        : "No expenses are currently visible in this filter scope.",
      topCategory && topCategory !== "N/A"
        ? `Primary cost driver is ${topCategory}${topProject && topProject !== "N/A" ? `, with ${topProject} as top project spend` : ""}${topRig && topRig !== "N/A" ? ` and ${topRig} as top rig spend` : ""}.`
        : "No dominant cost driver is visible in this scope yet.",
      topCategory && topCategory !== "N/A"
        ? "Cross-check Budget vs Actual for this scope to confirm whether current cost concentration is driving budget pressure."
        : "No budget-pressure cross-check is needed yet from expense concentration alone.",
      submittedCount > 0
        ? `${submittedCount} submitted expense(s) worth ${formatAsMoney(submittedAmount)} may shift totals once decisions land.`
        : "No submitted expense backlog is currently affecting near-term expense visibility.",
      linkageTotal > 0
        ? `${linkageTotal} expense record(s) still need rig/project/client linkage (${formatAsMoney(missingAmount)} affected).`
        : "Rig/project/client linkage looks complete in the currently visible expense records.",
      unusualSpikes > 0
        ? `${unusualSpikes} unusual high-value expense spike(s) should be reviewed for necessity and coding accuracy.`
        : "No unusual expense spike was detected from current visible rows.",
      focusItems.length > 0
        ? `Most actionable expense target: ${focusItems[0].label}.`
        : "No high-severity expense outlier was detected in this scope."
    ];
  }

  if (context.pageKey === "rigs") {
    const topRevenueRig = findMetricString(context.summaryMetrics, [/top revenue rig/i]);
    const highestExpenseRig = findMetricString(context.summaryMetrics, [/highest expense rig/i, /highest cost rig/i]);
    const poorCondition = findMetricValue(context.summaryMetrics, [/poor.*condition/i, /critical.*condition/i]);
    const underutilized = findMetricValue(context.summaryMetrics, [/underutilized/i]);
    const dueMaintenance = findMetricValue(context.summaryMetrics, [/maintenance due/i]);
    return [
      topRevenueRig && topRevenueRig !== "N/A"
        ? `${topRevenueRig} is currently the top revenue rig in this scope.`
        : "No dominant revenue rig is currently visible in this scope.",
      highestExpenseRig && highestExpenseRig !== "N/A"
        ? `${highestExpenseRig} is currently the highest expense rig and should be reviewed against output.`
        : "No high-cost rig concentration is currently visible.",
      poorCondition > 0 || dueMaintenance > 0
        ? `${poorCondition} rig(s) are in poor/critical condition and ${dueMaintenance} are due for maintenance follow-up.`
        : "No immediate rig condition or maintenance due concentration detected.",
      underutilized > 0
        ? `${underutilized} rig(s) appear underutilized and may be candidates for reassignment.`
        : "No significant underutilization concentration detected."
    ];
  }

  if (context.pageKey === "drilling-reports") {
    const reports = findMetricValue(context.summaryMetrics, [/reports?/i]);
    const meters = findMetricValue(context.summaryMetrics, [/meters/i]);
    const pending = findMetricValue(context.summaryMetrics, [/pending approvals?/i, /submitted/i]);
    const rejected = findMetricValue(context.summaryMetrics, [/rejected/i]);
    return [
      `Drilling output: ${reports} report(s) covering ${roundNumber(meters)} meters in current scope.`,
      pending > 0
        ? `${pending} report(s) are waiting for approval decisions.`
        : "No pending drilling approvals in current scope.",
      rejected > 0
        ? `${rejected} rejected report(s) may need correction and resubmission.`
        : "No rejected reports currently blocking throughput.",
      focusItems.length > 0
        ? `Most actionable drilling item: ${focusItems[0].label}.`
        : "No high-priority drilling outliers detected."
    ];
  }

  if (context.pageKey === "breakdowns") {
    const critical = findMetricValue(context.summaryMetrics, [/critical/i]);
    const open = findMetricValue(context.summaryMetrics, [/open|active/i]);
    const downtime = findMetricValue(context.summaryMetrics, [/downtime/i]);
    return [
      `Breakdown load: ${open} open breakdown(s) with ${roundNumber(downtime)} estimated downtime hours.`,
      critical > 0
        ? `${critical} critical breakdown(s) should be triaged first to protect operations.`
        : "No critical breakdown severity concentration detected.",
      focusItems.length > 0
        ? `Top operational risk: ${focusItems[0].label}.`
        : "No urgent breakdown target detected."
    ];
  }

  if (context.pageKey.startsWith("inventory")) {
    const lowStock = findMetricValue(context.summaryMetrics, [/low stock/i]);
    const outOfStock = findMetricValue(context.summaryMetrics, [/out of stock/i]);
    const issues = findMetricValue(context.summaryMetrics, [/issues?/i]);
    const movementCount = findMetricValue(context.summaryMetrics, [/movements?/i]);
    return [
      `Inventory health snapshot: ${outOfStock} out-of-stock, ${lowStock} low-stock, ${issues} data issue(s).`,
      movementCount > 0
        ? `${movementCount} movement record(s) are visible in current scope for traceability checks.`
        : "No movement records visible in current scope.",
      focusItems.length > 0
        ? `Highest-priority inventory target: ${focusItems[0].label}.`
        : "No urgent inventory risk surfaced in current scope."
    ];
  }

  if (context.pageKey === "maintenance") {
    const waitingParts = findMetricValue(context.summaryMetrics, [/waiting.*parts/i]);
    const critical = findMetricValue(context.summaryMetrics, [/critical/i]);
    const partsCost = findMetricValue(context.summaryMetrics, [/parts cost|maintenance cost/i]);
    const oldestPendingHours = findMetricValue(context.summaryMetrics, [/oldest pending hours/i]);
    const repeatedRepairRigs = findMetricValue(context.summaryMetrics, [/repeated repair rigs/i]);
    const topMechanic = findMetricString(context.summaryMetrics, [/highest active mechanic workload/i, /top mechanic workload/i]);
    const submitted = findMetricValue(context.summaryMetrics, [/submitted/i]);
    const underReview = findMetricValue(context.summaryMetrics, [/under review/i]);
    return [
      `Maintenance queue pressure: ${critical} critical urgency request(s), ${waitingParts} waiting for parts.`,
      oldestPendingHours > 0
        ? `Oldest pending maintenance request has been waiting about ${roundNumber(oldestPendingHours)} hour(s).`
        : "No prolonged pending maintenance request is currently visible.",
      partsCost > 0
        ? `Tracked maintenance-linked parts cost in scope is ${formatAsMoney(partsCost)}.`
        : "No maintenance-linked parts cost captured in this scope.",
      repeatedRepairRigs > 0
        ? `${repeatedRepairRigs} rig(s) show repeated repair demand and should be reviewed for root-cause action.`
        : "No repeated-repair rig concentration detected in this scope.",
      topMechanic && topMechanic !== "N/A"
        ? `Highest active mechanic workload is currently on ${topMechanic}.`
        : "Mechanic workload appears balanced in current scope.",
      submitted + underReview > 0
        ? "Operational priority: handle the oldest critical/high urgency work first, then waiting-for-parts items with longest downtime."
        : "No maintenance bottleneck is currently visible.",
      focusItems.length > 0
        ? `Highest-priority maintenance item: ${focusItems[0].label}.`
        : "No urgent maintenance outlier detected."
    ];
  }

  if (context.pageKey === "profit") {
    const profit = findMetricValue(context.summaryMetrics, [/profit/i]);
    const margin = findMetricValue(context.summaryMetrics, [/margin/i]);
    const lowMargin = findMetricValue(context.summaryMetrics, [/low margin/i]);
    return [
      `Profit posture: ${formatAsMoney(profit)} profit at ${roundNumber(margin)}% margin in current scope.`,
      lowMargin > 0
        ? `${lowMargin} rig/project contributor(s) are below margin target thresholds.`
        : "No low-margin concentration detected in current scope.",
      focusItems.length > 0
        ? `Primary profit attention area: ${focusItems[0].label}.`
        : "No urgent profit outlier detected."
    ];
  }

  if (context.pageKey === "forecasting") {
    const baseline = findMetricValue(context.summaryMetrics, [/baseline.*30 day/i]);
    const simulated = findMetricValue(context.summaryMetrics, [/simulated.*30 day/i]);
    const delta = findMetricValue(context.summaryMetrics, [/delta/i]);
    return [
      `Forecast comparison: baseline ${formatAsMoney(baseline)} vs simulated ${formatAsMoney(simulated)} (${formatAsMoney(delta)} delta).`,
      delta < 0
        ? "Current scenario underperforms baseline and may need adjustment."
        : "Current scenario is at or above baseline expectation.",
      focusItems.length > 0
        ? `Most impactful forecast target: ${focusItems[0].label}.`
        : "No urgent forecast variance surfaced."
    ];
  }

  return [];
}

export function deriveRecommendedActions({
  context,
  focusItems,
  keyInsights,
  actionRanking,
  roleProfile
}: {
  context: CopilotPageContext;
  focusItems: CopilotFocusItem[];
  keyInsights: string[];
  actionRanking: ContextualCopilotResponsePayload["actionRanking"];
  roleProfile: CopilotRoleProfile;
}) {
  const actions: string[] = [];
  const guidance = buildDecisionGuidance(
    focusItems,
    roleProfile,
    rankFocusItemsForDecisionGuidance
  );

  const roleGuidance = resolveRoleDoNowGuidance(roleProfile, focusItems);
  if (roleGuidance) {
    actions.push(roleGuidance);
  }

  if (guidance.doNow) {
    actions.push(`Do now: ${guidance.doNow}`);
  }
  if (guidance.doNext) {
    actions.push(`Do next: ${guidance.doNext}`);
  }
  if (guidance.canWait) {
    actions.push(`Can wait: ${guidance.canWait}`);
  }

  if (actionRanking.mostUrgent) {
    actions.push(`Most urgent: ${actionRanking.mostUrgent}`);
  }
  if (actionRanking.highestImpact) {
    actions.push(`Highest impact: ${actionRanking.highestImpact}`);
  }
  if (actionRanking.safestQuickWin) {
    actions.push(`Safest quick win: ${actionRanking.safestQuickWin}`);
  }
  if (actionRanking.needsManagerJudgment) {
    actions.push(`Needs manager judgment: ${actionRanking.needsManagerJudgment}`);
  }

  if (context.pageKey === "executive-overview") {
    actions.push("Prioritize overspent/critical budget buckets first, then clear oldest pending approvals.");
    actions.push("Validate missing linkage items that materially affect executive reporting.");
    actions.push("Check high-spend/low-revenue and profitability outliers before approving new discretionary spend.");
    actions.push("Prioritize incomplete drilling report approvals where operational visibility or billing velocity is blocked.");
  } else if (context.pageKey === "alerts-center") {
    actions.push("Resolve top critical open alerts first; handle stale warnings by age and amount.");
    actions.push("Snooze only non-urgent warnings with clear follow-up ownership.");
  } else if (context.pageKey === "data-quality-linkage-center") {
    actions.push("Fix highest-cost linkage gaps first to improve cost and budget accuracy quickly.");
    actions.push("Apply safe linkage updates where entity match confidence is strongest.");
  } else if (context.pageKey === "budget-vs-actual") {
    actions.push("Contain overspent and critical buckets first, then watch buckets with rising utilization.");
    actions.push("Create/assign budget plans for no-budget buckets before additional spend lands.");
  } else if (context.pageKey === "atlas-related" || context.pageKey === "atlas-whole-app") {
    actions.push("Start with the highest-severity cross-page target, then clear the highest-value blocker.");
    actions.push("Use shortcuts to jump directly to target rows/sections and confirm each fix before moving on.");
  } else if (context.pageKey === "expenses") {
    actions.push("Review the top category/project/rig spend drivers first to confirm operational necessity.");
    actions.push("Clear the highest-value submitted expenses to keep finance visibility current.");
    actions.push("Fix unlinked expense records (rig/project) so downstream cost and budget analysis stays reliable.");
    actions.push("Investigate unusual high-value spikes before they propagate into budget pressure.");
  } else if (context.pageKey === "rigs") {
    actions.push("Handle rigs in critical/poor condition first to reduce downtime risk.");
    actions.push("Review highest-expense rig against output and maintenance history.");
    actions.push("Reassign underutilized rigs to active projects where feasible.");
  } else if (context.pageKey === "drilling-reports") {
    actions.push("Clear submitted and rejected drilling reports first to protect operational data flow.");
    actions.push("Address high-delay or low-output drilling records that can impact billing velocity.");
  } else if (context.pageKey === "breakdowns") {
    actions.push("Triage critical breakdowns first by severity and downtime impact.");
    actions.push("Route long-running open breakdowns to maintenance follow-up quickly.");
  } else if (context.pageKey.startsWith("inventory")) {
    actions.push("Resolve out-of-stock and low-stock risks first, then tackle data-quality issues.");
    actions.push("Use movement and receipt trails to close high-impact inventory gaps safely.");
  } else if (context.pageKey === "maintenance") {
    actions.push("Prioritize critical and waiting-for-parts requests to restore rig availability.");
    actions.push("Resolve high-cost maintenance records with clear parts usage linkage.");
  } else if (context.pageKey === "profit") {
    actions.push("Focus on lowest-margin contributors and top cost drivers first.");
    actions.push("Validate rig/project profitability outliers before adjusting forecasts.");
  } else if (context.pageKey === "forecasting") {
    actions.push("Prioritize scenario changes that improve 30-day profit without pushing risk too high.");
    actions.push("Confirm forecast assumptions against current cost and approval pressure signals.");
  }

  if (hasMetric(context.summaryMetrics, [/pending approvals?/i, /pending/i])) {
    actions.push("Clear oldest pending approvals to reduce operational blocking.");
  }
  if (hasMetric(context.summaryMetrics, [/missing.*linkage/i, /needs linkage/i])) {
    actions.push("Fix missing linkage records so dashboards remain decision-grade.");
  }
  if (hasMetric(context.summaryMetrics, [/no[-\s]?budget/i])) {
    actions.push("Assign budget plans to no-budget entities to prevent uncontrolled spend.");
  }

  if (focusItems.length > 0 && actions.length === 0) {
    actions.push(`Start with ${focusItems[0].label}: ${focusItems[0].reason}`);
  }

  if (actions.length === 0) {
    const topMetric = resolveLargestMetric(context.summaryMetrics);
    if (topMetric) {
      actions.push(`No urgent risk detected; keep ${topMetric.label} under review and recheck after major updates.`);
    } else {
      actions.push("No urgent risk detected; recheck this scope after new approvals or linkage changes.");
    }
  }

  if (context.notes?.length) {
    actions.push(`Context note: ${context.notes[0]}`);
  }

  if (keyInsights.length > 0 && actions.length < 4) {
    actions.push("Use the top focus items to sequence your next manager actions.");
  }

  return dedupeText(filterRoleSpecificActions(actions, roleProfile)).slice(0, 5);
}

function resolveRoleDoNowGuidance(roleProfile: CopilotRoleProfile, focusItems: CopilotFocusItem[]) {
  const top = focusItems[0];
  if (!top) {
    return null;
  }
  if (roleProfile.segment === "MANAGEMENT") {
    return `Do now: Inspect risk on ${top.label}, then queue high-value approvals and profitability exceptions.`;
  }
  if (roleProfile.segment === "OFFICE") {
    return `Do now: Review approval/linkage completeness for ${top.label} and close missing record fields.`;
  }
  if (roleProfile.segment === "MECHANIC") {
    return `Do now: Review maintenance readiness for ${top.label}, focusing on downtime and parts availability.`;
  }
  if (roleProfile.segment === "OPERATIONS") {
    return `Do now: Complete reporting/update actions for ${top.label} before lower-priority entries.`;
  }
  return null;
}

function filterRoleSpecificActions(actions: string[], roleProfile: CopilotRoleProfile) {
  if (roleProfile.segment === "GENERAL") {
    return actions;
  }

  if (roleProfile.segment === "MECHANIC") {
    return actions.filter(
      (line) =>
        !/profit|margin|forecast|client profitability|revenue opportunity|budget plan/i.test(line) ||
        /maintenance|repair|rig|parts|downtime|approval/i.test(line)
    );
  }

  if (roleProfile.segment === "OPERATIONS") {
    return actions.filter(
      (line) =>
        !/profit|margin|forecast|budget containment|discretionary spend|client profitability/i.test(line) ||
        /report|drilling|submission|project|rig assignment|approval/i.test(line)
    );
  }

  return actions;
}

export function derivePrimarySupportingFocus({
  focusItems,
  roleProfile
}: {
  focusItems: CopilotFocusItem[];
  roleProfile: CopilotRoleProfile;
}) {
  const ranked = dedupeFocusCandidatesByRecord(rankFocusItems(focusItems, roleProfile));
  const primaryFocusItem = ranked[0] || null;
  const supportingItems = ranked.filter((item) => item.id !== primaryFocusItem?.id).slice(0, 3);
  const secondaryInsights =
    primaryFocusItem && supportingItems.length > 0
      ? [
          `Also monitor: ${supportingItems
            .slice(0, 2)
            .map((item) => item.label)
            .join(", ")}.`
        ]
      : [];
  return {
    primaryFocusItem,
    supportingItems,
    secondaryInsights
  };
}

export function deriveActionRanking({
  context,
  focusItems,
  roleProfile
}: {
  context: CopilotPageContext;
  focusItems: CopilotFocusItem[];
  roleProfile: CopilotRoleProfile;
}): ContextualCopilotResponsePayload["actionRanking"] {
  const sorted = rankFocusItems(focusItems, roleProfile);
  const mostUrgent = sorted.find((item) => item.severity === "CRITICAL") || sorted[0];
  const highestImpact = [...sorted]
    .sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0))
    .find((item) => (item.amount ?? 0) > 0);
  const safestQuickWin = [...sorted]
    .reverse()
    .find((item) => item.severity === "MEDIUM" || item.severity === "LOW");
  const needsManagerJudgment = sorted.find(
    (item) =>
      item.confidence === "LOW" ||
      /manager|judgment|uncertain|low confidence|manual/i.test(item.reason)
  );

  const ranking: ContextualCopilotResponsePayload["actionRanking"] = {};
  if (mostUrgent) {
    ranking.mostUrgent = `${mostUrgent.label} — ${mostUrgent.reason}`;
  }
  if (highestImpact) {
    ranking.highestImpact = `${highestImpact.label} (${formatAsMoney(highestImpact.amount || 0)} impact).`;
  }
  if (safestQuickWin) {
    ranking.safestQuickWin = `${safestQuickWin.label} — ${safestQuickWin.reason}`;
  }
  if (needsManagerJudgment) {
    ranking.needsManagerJudgment = `${needsManagerJudgment.label} — ${needsManagerJudgment.reason}`;
  }

  const guidance = buildDecisionGuidance(sorted, roleProfile, rankFocusItemsForDecisionGuidance);
  if (guidance.doNow) {
    ranking.doNow = guidance.doNow;
  }
  if (guidance.doNext) {
    ranking.doNext = guidance.doNext;
  }
  if (guidance.canWait) {
    ranking.canWait = guidance.canWait;
  }

  if (context.pageKey === "alerts-center" && !ranking.needsManagerJudgment) {
    const staleHigh = sorted.find((item) => /old|stale|day/i.test(item.reason));
    if (staleHigh) {
      ranking.needsManagerJudgment = `${staleHigh.label} — stale alert requires resolve vs snooze decision.`;
    }
  }

  return ranking;
}

export function deriveBestQuickWins({
  context,
  focusItems,
  roleProfile
}: {
  context: CopilotPageContext;
  focusItems: CopilotFocusItem[];
  roleProfile: CopilotRoleProfile;
}) {
  const quickCandidates = rankFocusItems(focusItems, roleProfile).filter(
    (item) =>
      item.severity === "MEDIUM" ||
      item.severity === "LOW" ||
      item.confidence === "HIGH" ||
      /quick win|safe|high confidence/i.test(item.reason)
  );

  const wins = quickCandidates.slice(0, 3).map((item) => `${item.label}: ${item.reason}`);
  if (wins.length > 0) {
    return wins;
  }

  if (context.pageKey === "budget-vs-actual") {
    return ["Assign budgets to no-budget buckets to improve immediate reporting clarity."];
  }
  if (context.pageKey === "atlas-related" || context.pageKey === "atlas-whole-app") {
    return ["Open the safest high-confidence focus target first to create immediate momentum."];
  }
  if (context.pageKey === "expenses") {
    const topCategory = findMetricString(context.summaryMetrics, [/largest category/i, /biggest category/i]);
    const submittedCount = findMetricValue(context.summaryMetrics, [/submitted expenses/i, /submittedExpenses/i]);
    const missingLinkage = findMetricValue(context.summaryMetrics, [/missing.*linkage/i, /missingLinkage/i]);
    if (missingLinkage > 0) {
      return ["Fix the highest-value unlinked expense record first; it is a safe reporting quick win."];
    }
    if (submittedCount > 0) {
      return ["Approve/reject the largest submitted expense first to reduce approval-sensitive spend quickly."];
    }
    if (topCategory && topCategory !== "N/A") {
      return [`Review ${topCategory} for low-effort containment opportunities within current scope.`];
    }
  }
  if (context.pageKey === "alerts-center") {
    return ["Resolve the oldest warning alert with clear ownership to reduce queue noise quickly."];
  }
  if (context.pageKey === "rigs") {
    return [
      "Start with one underutilized but healthy rig reassignment candidate to improve utilization quickly."
    ];
  }
  return [];
}

export function deriveInsightCards({
  context: _context,
  focusItems,
  actionRanking,
  keyInsights,
  recommendedNextSteps,
  roleProfile
}: {
  context: CopilotPageContext;
  focusItems: CopilotFocusItem[];
  actionRanking: ContextualCopilotResponsePayload["actionRanking"];
  keyInsights: string[];
  recommendedNextSteps: string[];
  roleProfile: CopilotRoleProfile;
}): CopilotInsightCard[] {
  const cards: CopilotInsightCard[] = [];
  const ranked = rankFocusItems(focusItems, roleProfile);
  const usedKeys = new Set<string>();
  const usedFamilies = new Set<string>();

  const topRisk = selectInsightFocus({
    candidates: ranked.filter((item) => item.severity === "CRITICAL" || item.severity === "HIGH"),
    usedKeys,
    usedFamilies,
    allowFallbackToUsed: true
  }) ||
    selectInsightFocus({
      candidates: ranked,
      usedKeys,
      usedFamilies,
      allowFallbackToUsed: true
    });

  if (topRisk) {
    cards.push(
      createInsightCard({
        item: topRisk,
        kind: "TOP_RISK",
        title: "Top risk"
      })
    );
  }

  const bestNextActionItem = selectInsightFocus({
    candidates: [...ranked].sort((a, b) => scoreActionCandidate(b) - scoreActionCandidate(a)),
    usedKeys,
    usedFamilies,
    avoidUsedFamilies: true,
    allowFallbackToUsed: false
  });
  if (bestNextActionItem) {
    cards.push(
      createInsightCard({
        item: bestNextActionItem,
        kind: "BEST_NEXT_ACTION",
        title: "Best next action"
      })
    );
  } else {
    const bestNextAction =
      actionRanking.doNow ||
      actionRanking.mostUrgent ||
      recommendedNextSteps[0] ||
      keyInsights[0] ||
      null;
    if (bestNextAction) {
      cards.push({
        id: "insight-best-next-action",
        kind: "BEST_NEXT_ACTION",
        title: "Best next action",
        summary: `Issue: Next manager step. Why: ${condenseReason(bestNextAction, 110)}. Next: Inspect the linked priority queue or section first.`,
        severity: "MEDIUM"
      });
    }
  }

  const revenueOpportunity = selectInsightFocus({
    candidates: ranked.filter(
      (item) =>
        normalizeIssueType(item.issueType) === "REVENUE_OPPORTUNITY" ||
        /revenue opportunity|top revenue rig|best-performing|highest revenue/i.test(
          `${item.label} ${item.reason}`
        )
    ),
    usedKeys,
    usedFamilies,
    avoidUsedFamilies: true,
    allowFallbackToUsed: false
  });
  if (revenueOpportunity) {
    cards.push(
      createInsightCard({
        item: revenueOpportunity,
        kind: "REVENUE_OPPORTUNITY",
        title: "Revenue opportunity"
      })
    );
  }

  const maintenanceConcern = selectInsightFocus({
    candidates: ranked.filter(
      (item) =>
        normalizeIssueType(item.issueType) === "MAINTENANCE" ||
        /maintenance|breakdown|waiting for parts|repair/i.test(`${item.label} ${item.reason}`)
    ),
    usedKeys,
    usedFamilies,
    avoidUsedFamilies: true,
    allowFallbackToUsed: false
  });
  if (maintenanceConcern) {
    cards.push(
      createInsightCard({
        item: maintenanceConcern,
        kind: "MAINTENANCE_CONCERN",
        title: "Maintenance concern"
      })
    );
  }

  const dataQualityIssue = selectInsightFocus({
    candidates: ranked.filter(
      (item) =>
        normalizeIssueType(item.issueType) === "LINKAGE" ||
        normalizeIssueType(item.issueType) === "NO_BUDGET" ||
        /missing linkage|data gap|unassigned|attribution/i.test(`${item.label} ${item.reason}`)
    ),
    usedKeys,
    usedFamilies,
    avoidUsedFamilies: true,
    allowFallbackToUsed: false
  });
  if (dataQualityIssue) {
    cards.push(
      createInsightCard({
        item: dataQualityIssue,
        kind: "DATA_QUALITY_ISSUE",
        title: "Data-quality issue"
      })
    );
  }

  return applyRoleInsightCardPreferences(dedupeInsightCardsByKind(cards), roleProfile);
}

function applyRoleInsightCardPreferences(cards: CopilotInsightCard[], roleProfile: CopilotRoleProfile) {
  const preferredOrder = roleProfile.preferredCardKinds;
  const visibleKinds = new Set(preferredOrder);

  const filtered = cards.filter((card) => {
    if (roleProfile.segment === "OFFICE" && card.kind === "REVENUE_OPPORTUNITY") {
      return false;
    }
    if (roleProfile.segment === "MECHANIC" && (card.kind === "REVENUE_OPPORTUNITY" || card.kind === "DATA_QUALITY_ISSUE")) {
      return card.kind === "DATA_QUALITY_ISSUE";
    }
    if (roleProfile.segment === "OPERATIONS" && card.kind === "REVENUE_OPPORTUNITY") {
      return false;
    }
    return visibleKinds.has(card.kind);
  });

  const renamed = filtered.map((card) => {
    if (roleProfile.segment === "OPERATIONS" && card.kind === "DATA_QUALITY_ISSUE") {
      return {
        ...card,
        title: "Reporting gap"
      };
    }
    return card;
  });

  return [...renamed]
    .sort((a, b) => {
      const aIdx = preferredOrder.indexOf(a.kind);
      const bIdx = preferredOrder.indexOf(b.kind);
      if (aIdx !== bIdx) {
        return (aIdx === -1 ? 99 : aIdx) - (bIdx === -1 ? 99 : bIdx);
      }
      return focusSeverityRank(a.severity || "LOW") - focusSeverityRank(b.severity || "LOW");
    })
    .slice(0, 5);
}

function createInsightCard({
  item,
  kind,
  title
}: {
  item: CopilotFocusItem;
  kind: CopilotInsightCardKind;
  title: string;
}): CopilotInsightCard {
  return {
    id: `insight-${kind.toLowerCase()}-${item.id}`,
    kind,
    title,
    summary: buildInsightCardSummary({ item, kind }),
    severity: item.severity,
    focusItemId: item.id,
    recordKey: resolveInsightRecordKey(item),
    actionLabel: item.actionLabel,
    inspectHint: item.inspectHint,
    href: item.href,
    targetId: item.targetId,
    sectionId: item.sectionId,
    targetPageKey: item.targetPageKey
  };
}

function selectInsightFocus({
  candidates,
  usedKeys,
  usedFamilies,
  avoidUsedFamilies = false,
  allowFallbackToUsed
}: {
  candidates: CopilotFocusItem[];
  usedKeys: Set<string>;
  usedFamilies: Set<string>;
  avoidUsedFamilies?: boolean;
  allowFallbackToUsed: boolean;
}) {
  if (candidates.length === 0) {
    return null;
  }
  const deduped = dedupeFocusCandidatesByRecord(candidates);
  const fresh = deduped.find((item) => {
    const recordKey = resolveInsightRecordKey(item);
    if (usedKeys.has(recordKey)) {
      return false;
    }
    if (!avoidUsedFamilies) {
      return true;
    }
    const family = resolveInsightDiversityFamily(item);
    return !usedFamilies.has(family);
  });
  if (fresh) {
    usedKeys.add(resolveInsightRecordKey(fresh));
    usedFamilies.add(resolveInsightDiversityFamily(fresh));
    return fresh;
  }
  const freshRecordOnly = deduped.find((item) => !usedKeys.has(resolveInsightRecordKey(item)));
  if (freshRecordOnly) {
    usedKeys.add(resolveInsightRecordKey(freshRecordOnly));
    usedFamilies.add(resolveInsightDiversityFamily(freshRecordOnly));
    return freshRecordOnly;
  }
  if (!allowFallbackToUsed) {
    return null;
  }
  const fallback =
    deduped.find((item) => {
      if (!avoidUsedFamilies) {
        return true;
      }
      return !usedFamilies.has(resolveInsightDiversityFamily(item));
    }) ||
    deduped[0] ||
    null;
  if (fallback) {
    usedKeys.add(resolveInsightRecordKey(fallback));
    usedFamilies.add(resolveInsightDiversityFamily(fallback));
  }
  return fallback;
}

function resolveInsightRecordKey(item: CopilotFocusItem) {
  if (item.targetId) {
    return `${item.targetPageKey || "page"}::${item.targetId}`;
  }
  return `${item.targetPageKey || "page"}::${normalizeKey(item.label || item.id || "focus")}`;
}

function resolveInsightDiversityFamily(item: CopilotFocusItem) {
  const issueType = normalizeIssueType(item.issueType);
  if (issueType === "MAINTENANCE") {
    return "MAINTENANCE";
  }
  if (issueType === "LINKAGE" || issueType === "NO_BUDGET") {
    return "DATA_QUALITY";
  }
  if (issueType === "REVENUE_OPPORTUNITY") {
    return "REVENUE";
  }
  if (issueType === "RIG_RISK" || issueType === "RIG_SPEND") {
    return "RIG";
  }
  if (issueType === "APPROVAL_BACKLOG") {
    return "APPROVAL";
  }
  if (issueType === "PROJECT_SPEND" || issueType === "COST_DRIVER" || issueType === "PROFITABILITY") {
    return "FINANCE";
  }
  const haystack = `${item.label} ${item.reason}`.toLowerCase();
  if (/maintenance|breakdown|repair|downtime/.test(haystack)) {
    return "MAINTENANCE";
  }
  if (/linkage|unassigned|attribution|missing/.test(haystack)) {
    return "DATA_QUALITY";
  }
  if (/revenue|output|performing/.test(haystack)) {
    return "REVENUE";
  }
  if (/rig/.test(haystack)) {
    return "RIG";
  }
  if (/expense|cost|spend|profit|margin|budget/.test(haystack)) {
    return "FINANCE";
  }
  return issueType || "GENERAL";
}

function buildInsightCardSummary({
  item,
  kind
}: {
  item: CopilotFocusItem;
  kind: CopilotInsightCardKind;
}) {
  const issue = item.label;
  const why = condenseReason(item.reason, 96);
  const next = resolveInspectNextHint({ item, kind });
  return `Issue: ${issue}. Why: ${why}. Next: ${next}`;
}

function resolveInspectNextHint({
  item,
  kind
}: {
  item: CopilotFocusItem;
  kind: CopilotInsightCardKind;
}) {
  if (kind === "TOP_RISK") {
    return item.targetId
      ? "Open the exact record and confirm containment."
      : "Open the linked section and validate the top driver.";
  }
  if (kind === "BEST_NEXT_ACTION") {
    return item.targetId
      ? "Open the exact record and complete the next decision."
      : "Open the linked page and execute this before lower-priority work.";
  }
  if (kind === "REVENUE_OPPORTUNITY") {
    return "Open the linked rig/project and verify output versus cost.";
  }
  if (kind === "MAINTENANCE_CONCERN") {
    return "Open maintenance details and confirm urgency, downtime, and parts dependency.";
  }
  return "Open linkage details and assign missing fields to restore reporting confidence.";
}

function scoreActionCandidate(item: CopilotFocusItem) {
  const severityWeight =
    item.severity === "CRITICAL"
      ? 100
      : item.severity === "HIGH"
        ? 72
        : item.severity === "MEDIUM"
          ? 46
          : 24;
  const impactWeight = Math.min(28, Math.log10((item.amount || 0) + 1) * 8);
  const urgencyWeight = /critical|overspent|waiting approval|stale|downtime|older than/i.test(item.reason)
    ? 14
    : 0;
  const ageHoursMatch = item.reason.match(/(\d+(?:\.\d+)?)h/);
  const ageHours = ageHoursMatch ? Number(ageHoursMatch[1]) : 0;
  const stalenessWeight = ageHours > 0 ? Math.min(10, ageHours / 24) : 0;
  const effortPenalty = resolveEffortWeight(item) * 6;
  return severityWeight + impactWeight + urgencyWeight + stalenessWeight - effortPenalty;
}

export function deriveFollowUpQuestions({
  context,
  focusItems,
  roleProfile
}: {
  context: CopilotPageContext;
  focusItems: CopilotFocusItem[];
  roleProfile: CopilotRoleProfile;
}) {
  const base = [
    "What should I do first?",
    "Show biggest risks",
    "Take me to top rig risk"
  ];

  if (context.pageKey === "maintenance") {
    base.unshift("Show pending maintenance risks", "Take me to top maintenance issue");
  }
  if (context.pageKey === "expenses") {
    base.unshift("Show highest expense rig");
  }
  if (context.pageKey === "executive-overview") {
    base.unshift("Show biggest profitability issue", "Show data gaps hurting reports");
  }

  const hasRevenueOpportunity = focusItems.some(
    (item) =>
      normalizeIssueType(item.issueType) === "REVENUE_OPPORTUNITY" ||
      /revenue opportunity|top revenue rig/i.test(`${item.label} ${item.reason}`)
  );
  if (hasRevenueOpportunity) {
    base.unshift("Show top revenue rig");
  }

  return dedupeText([...roleProfile.followUpPrompts, ...base]).slice(0, 6);
}
