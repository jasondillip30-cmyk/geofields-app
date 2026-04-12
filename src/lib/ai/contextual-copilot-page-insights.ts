import type { CopilotFocusItem, CopilotPageContext } from "@/lib/ai/contextual-copilot-types";
import {
  buildIssueTypeCounts,
  findMetricString,
  findMetricValue,
  formatAsMoney,
  roundNumber
} from "@/lib/ai/contextual-copilot-ranking";

export function derivePageSpecificInsights({
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
