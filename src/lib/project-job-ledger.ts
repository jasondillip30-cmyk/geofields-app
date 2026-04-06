import type { FinancialExpenseRecognitionStats } from "@/lib/financial-expense-recognition";
import type { ProjectRigCostAllocationRow } from "@/lib/project-cost-allocation";
import type { ProjectOperatingCostAttributionSummary } from "@/lib/project-operating-cost-attribution";
import type { ProjectMarginForecastLiteSummary } from "@/lib/project-margin-forecast-lite";
import type { ProjectRevenueRealizationSummary } from "@/lib/project-revenue-realization";

export interface ProjectJobLedgerInput {
  earnedRevenue: number;
  recognizedCost: {
    total: number;
    breakdownCost: number;
    maintenanceCost: number;
    stockReplenishmentCost: number;
    operatingCost: number;
    otherUnlinkedCost: number;
  };
  commercial: {
    contractTypeLabel: string;
    baseContractValue: number | null;
    adjustedContractValue: number | null;
    remainingRevenue: number | null;
    progressPercent: number | null;
    progressBasis: "METERS" | "DAYS" | "STATUS" | "NONE";
    revenueFormula: string;
    changeOrderCount: number;
  };
  recognitionStats: FinancialExpenseRecognitionStats;
  classificationAudit: {
    legacyUnlinkedCount: number;
    reconciliationDelta: number;
  };
  pendingRequisition: {
    count: number;
    value: number;
  };
  operationalRisk: {
    openBreakdowns: number;
    openMaintenance: number;
    downtimeHours: number;
  };
  labor: {
    total: number;
    entryCount: number;
    captured: boolean;
  };
  rigCost: {
    total: number;
    rigsEvaluated: number;
    rigsWithMissingRate: number;
    rigsWithMissingActivityBasis: number;
    rows: ProjectRigCostAllocationRow[];
  };
  operatingAttribution: ProjectOperatingCostAttributionSummary;
  forecastLite: ProjectMarginForecastLiteSummary;
  revenueRealization: ProjectRevenueRealizationSummary;
}

export interface ProjectLedgerRiskSignal {
  level: "critical" | "warn" | "info";
  title: string;
  detail: string;
}

export interface ProjectJobLedgerSnapshot {
  earnedRevenue: number;
  recognizedOperationalCost: number;
  laborCost: number;
  rigCost: number;
  totalProjectCostKnown: number;
  costCoverageStatus: "KNOWN" | "PARTIAL";
  costCoverageNote: string;
  currentProfitLoss: number;
  marginPercent: number | null;
  contractTypeLabel: string;
  baseContractValue: number | null;
  adjustedContractValue: number | null;
  remainingRevenue: number | null;
  progressPercent: number | null;
  progressBasis: "METERS" | "DAYS" | "STATUS" | "NONE";
  revenueFormula: string;
  changeOrderCount: number;
  costBuckets: Array<{
    key: "breakdown" | "maintenance" | "stock" | "operating" | "other";
    label: string;
    recognizedCost: number;
    percentOfRecognizedOperationalCost: number;
  }>;
  costLayerBuckets: Array<{
    key: "recognized" | "labor" | "rig";
    label: string;
    knownCost: number;
    percentOfTotalKnownCost: number;
  }>;
  operatingAttribution: ProjectOperatingCostAttributionSummary;
  forecastLite: ProjectMarginForecastLiteSummary;
  revenueRealization: ProjectRevenueRealizationSummary;
  rigAllocationRows: ProjectRigCostAllocationRow[];
  riskSignals: ProjectLedgerRiskSignal[];
}

export function buildProjectJobLedgerSnapshot(input: ProjectJobLedgerInput): ProjectJobLedgerSnapshot {
  const earnedRevenue = roundCurrency(input.earnedRevenue);
  const recognizedOperationalCost = roundCurrency(input.recognizedCost.total);
  const laborCost = roundCurrency(input.labor.total);
  const rigCost = roundCurrency(input.rigCost.total);
  const totalProjectCostKnown = roundCurrency(recognizedOperationalCost + laborCost + rigCost);
  const currentProfitLoss = roundCurrency(earnedRevenue - totalProjectCostKnown);
  const marginPercent = earnedRevenue > 0 ? roundPercent((currentProfitLoss / earnedRevenue) * 100) : null;
  const hasMissingLabor = !input.labor.captured;
  const hasMissingRigRate = input.rigCost.rigsWithMissingRate > 0;
  const hasMissingRigActivityBasis = input.rigCost.rigsWithMissingActivityBasis > 0;
  const hasPartialOperatingAttribution =
    input.operatingAttribution.operatingCostBase > 0 && input.operatingAttribution.isPartialAttribution;
  const costCoverageStatus =
    hasMissingLabor || hasMissingRigRate || hasMissingRigActivityBasis || hasPartialOperatingAttribution
      ? "PARTIAL"
      : "KNOWN";
  const costCoverageNote =
    costCoverageStatus === "KNOWN"
      ? "Known cost coverage complete for recognized operational, labor, and rig layers."
      : "Known cost coverage is partial. Missing labor capture, rig allocation inputs, or operating-cost attribution confidence can understate or blur project cost truth.";

  const recognizedCostForPercent = recognizedOperationalCost > 0 ? recognizedOperationalCost : 0;
  const costBuckets: ProjectJobLedgerSnapshot["costBuckets"] = [
    {
      key: "breakdown",
      label: "Breakdown Cost",
      recognizedCost: roundCurrency(input.recognizedCost.breakdownCost),
      percentOfRecognizedOperationalCost: percentOf(
        input.recognizedCost.breakdownCost,
        recognizedCostForPercent
      )
    },
    {
      key: "maintenance",
      label: "Maintenance Cost",
      recognizedCost: roundCurrency(input.recognizedCost.maintenanceCost),
      percentOfRecognizedOperationalCost: percentOf(
        input.recognizedCost.maintenanceCost,
        recognizedCostForPercent
      )
    },
    {
      key: "stock",
      label: "Stock Replenishment",
      recognizedCost: roundCurrency(input.recognizedCost.stockReplenishmentCost),
      percentOfRecognizedOperationalCost: percentOf(
        input.recognizedCost.stockReplenishmentCost,
        recognizedCostForPercent
      )
    },
    {
      key: "operating",
      label: "Operating Cost",
      recognizedCost: roundCurrency(input.recognizedCost.operatingCost),
      percentOfRecognizedOperationalCost: percentOf(
        input.recognizedCost.operatingCost,
        recognizedCostForPercent
      )
    },
    {
      key: "other",
      label: "Other / Unlinked",
      recognizedCost: roundCurrency(input.recognizedCost.otherUnlinkedCost),
      percentOfRecognizedOperationalCost: percentOf(
        input.recognizedCost.otherUnlinkedCost,
        recognizedCostForPercent
      )
    }
  ];
  const totalKnownCostForPercent = totalProjectCostKnown > 0 ? totalProjectCostKnown : 0;
  const costLayerBuckets: ProjectJobLedgerSnapshot["costLayerBuckets"] = [
    {
      key: "recognized",
      label: "Recognized Operational Cost",
      knownCost: recognizedOperationalCost,
      percentOfTotalKnownCost: percentOf(recognizedOperationalCost, totalKnownCostForPercent)
    },
    {
      key: "labor",
      label: "Labor Cost",
      knownCost: laborCost,
      percentOfTotalKnownCost: percentOf(laborCost, totalKnownCostForPercent)
    },
    {
      key: "rig",
      label: "Rig Cost",
      knownCost: rigCost,
      percentOfTotalKnownCost: percentOf(rigCost, totalKnownCostForPercent)
    }
  ];

  const riskSignals: ProjectLedgerRiskSignal[] = [];

  if (input.classificationAudit.reconciliationDelta !== 0) {
    riskSignals.push({
      level: "critical",
      title: "Classification reconciliation mismatch",
      detail:
        "Recognized-cost totals and classification totals are out of sync. Review cost-linkage integrity before relying on margin."
    });
  }

  const otherUnlinkedCost = input.recognizedCost.otherUnlinkedCost;
  if (otherUnlinkedCost > 0) {
    riskSignals.push({
      level: "warn",
      title: "Unlinked recognized cost detected",
      detail:
        "Some recognized cost is falling into Other / Unlinked. Margin is valid, but attribution quality needs cleanup."
    });
  }

  if (input.classificationAudit.legacyUnlinkedCount > 0) {
    riskSignals.push({
      level: "warn",
      title: "Legacy/unlinked expense records in scope",
      detail: `${input.classificationAudit.legacyUnlinkedCount} recognized expense rows still rely on legacy or partial linkage context.`
    });
  }

  if (input.recognitionStats.excludedUnpostedPurchaseCount > 0) {
    riskSignals.push({
      level: "info",
      title: "Pending purchase posting pressure",
      detail: `${input.recognitionStats.excludedUnpostedPurchaseCount} approved purchase expenses are not yet recognized because posting is incomplete.`
    });
  }

  if (input.pendingRequisition.count > 0 && input.pendingRequisition.value > 0) {
    riskSignals.push({
      level: "info",
      title: "Approved requisitions pending posting",
      detail: `${input.pendingRequisition.count} approved requisitions (~${formatCompactCurrency(
        input.pendingRequisition.value
      )}) may convert into future recognized cost.`
    });
  }

  if (input.operationalRisk.openBreakdowns > 0 || input.operationalRisk.openMaintenance > 0) {
    riskSignals.push({
      level: "warn",
      title: "Active operational disruption risk",
      detail: `${input.operationalRisk.openBreakdowns} open breakdowns and ${input.operationalRisk.openMaintenance} open maintenance cases can continue to pressure margin.`
    });
  }

  if (!input.labor.captured) {
    riskSignals.push({
      level: "warn",
      title: "Labor not captured yet",
      detail:
        "No labor entries exist for this project. Total project cost and margin are partial until labor is captured."
    });
  }

  if (input.rigCost.rigsWithMissingRate > 0) {
    riskSignals.push({
      level: "warn",
      title: "Missing rig cost rate configuration",
      detail: `${input.rigCost.rigsWithMissingRate} rig(s) have no configured allocation rate for the selected basis, so rig burden is not fully reflected.`
    });
  }

  if (input.rigCost.rigsWithMissingActivityBasis > 0) {
    riskSignals.push({
      level: "info",
      title: "Missing approved activity basis for rig allocation",
      detail: `${input.rigCost.rigsWithMissingActivityBasis} rig(s) have configured rates but no approved activity basis for allocation in this project scope.`
    });
  }

  if (input.operatingAttribution.reconciliationDelta !== 0) {
    riskSignals.push({
      level: "critical",
      title: "Operating attribution reconciliation mismatch",
      detail:
        "Fuel/consumables attribution totals do not reconcile to operating-cost base. Review attribution logic integrity."
    });
  }

  if (hasPartialOperatingAttribution) {
    riskSignals.push({
      level: "warn",
      title: "Operating cost attribution is partial",
      detail: `${formatCompactCurrency(
        input.operatingAttribution.unattributedOperatingCost
      )} of recognized operating cost is not confidently classifiable as fuel or consumables.`
    });
  }

  if (input.forecastLite.confidenceLevel === "WEAK") {
    riskSignals.push({
      level: "warn",
      title: "Forecast confidence is weak",
      detail:
        "Forward-looking margin projection is qualitative only. Treat near-term trend direction as cautionary, not numeric certainty."
    });
  }

  if (input.forecastLite.trendDirection === "DETERIORATING") {
    riskSignals.push({
      level: "warn",
      title: "Forward-looking margin trend is deteriorating",
      detail:
        "Recent run-rate indicates recognized cost velocity is outpacing earned-revenue velocity in project scope."
    });
  }

  if (
    input.forecastLite.hasNumericProjection &&
    input.forecastLite.projected30DayProfit !== null &&
    input.forecastLite.projected30DayProfit < 0
  ) {
    riskSignals.push({
      level: "warn",
      title: "Projected 30-day run-rate is loss-making",
      detail:
        "If current trend persists, near-term project run-rate points to negative margin pressure."
    });
  }

  if (input.revenueRealization.coverageStatus === "PARTIAL") {
    riskSignals.push({
      level: "warn",
      title: "Revenue realization coverage is partial",
      detail: input.revenueRealization.coverageNote
    });
  }

  for (const signal of input.revenueRealization.signals) {
    riskSignals.push({
      level: signal.level,
      title: signal.title,
      detail: signal.detail
    });
  }

  for (const signal of input.forecastLite.riskSignals) {
    riskSignals.push({
      level: signal.level,
      title: signal.title,
      detail: signal.detail
    });
  }

  if (riskSignals.length === 0) {
    riskSignals.push({
      level: "info",
      title: "No immediate linkage or recognition risks detected",
      detail: "Current profitability view has no active data-quality or posting risk flags."
    });
  }

  return {
    earnedRevenue,
    recognizedOperationalCost,
    laborCost,
    rigCost,
    totalProjectCostKnown,
    costCoverageStatus,
    costCoverageNote,
    currentProfitLoss,
    marginPercent,
    contractTypeLabel: input.commercial.contractTypeLabel,
    baseContractValue: input.commercial.baseContractValue,
    adjustedContractValue: input.commercial.adjustedContractValue,
    remainingRevenue: input.commercial.remainingRevenue,
    progressPercent: input.commercial.progressPercent,
    progressBasis: input.commercial.progressBasis,
    revenueFormula: input.commercial.revenueFormula,
    changeOrderCount: input.commercial.changeOrderCount,
    costBuckets,
    costLayerBuckets,
    operatingAttribution: input.operatingAttribution,
    forecastLite: input.forecastLite,
    revenueRealization: input.revenueRealization,
    rigAllocationRows: input.rigCost.rows,
    riskSignals
  };
}

function percentOf(part: number, total: number) {
  if (total <= 0) {
    return 0;
  }
  return roundPercent((part / total) * 100);
}

function roundCurrency(value: number) {
  return Math.round(value * 100) / 100;
}

function roundPercent(value: number) {
  return Math.round(value * 10) / 10;
}

function formatCompactCurrency(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0
  }).format(value);
}
