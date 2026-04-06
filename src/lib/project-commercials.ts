import { ProjectContractType, ProjectStatus } from "@prisma/client";

export interface ProjectCommercialTermsInput {
  contractType: ProjectContractType;
  contractRatePerM: number;
  contractDayRate: number;
  contractLumpSumValue: number;
  estimatedMeters: number;
  estimatedDays: number;
  status?: ProjectStatus | string | null;
}

export interface ProjectChangeOrderInput {
  id?: string;
  description: string;
  addedValue: number;
  addedMeters?: number | null;
  addedDays?: number | null;
  createdAt?: string | Date;
}

export interface ProjectWorkProgressInput {
  totalMetersDrilled: number;
  workedDays: number;
  reportCount: number;
}

export interface ProjectCommercialRevenueSnapshot {
  contractType: ProjectContractType;
  contractTypeLabel: string;
  revenueFormula: string;
  totalMetersDrilled: number;
  workedDays: number;
  approvedReportCount: number;
  baseContractValue: number | null;
  changeOrderTotalValue: number;
  changeOrderAdjustedContractValue: number | null;
  earnedRevenue: number;
  remainingRevenue: number | null;
  progressPercent: number | null;
  progressBasis: "METERS" | "DAYS" | "STATUS" | "NONE";
  adjustedEstimatedMeters: number;
  adjustedEstimatedDays: number;
}

interface ProgressReportLike {
  date: Date | string;
  totalMetersDrilled?: number | null;
}

export function deriveWorkProgressFromReports<T extends ProgressReportLike>(reports: T[]): ProjectWorkProgressInput {
  const workedDateSet = new Set<string>();
  let totalMetersDrilled = 0;

  for (const report of reports) {
    const meters = safeNumber(report.totalMetersDrilled);
    totalMetersDrilled += meters;

    const dateValue = report.date instanceof Date ? report.date : new Date(report.date);
    if (!Number.isNaN(dateValue.getTime())) {
      workedDateSet.add(dateValue.toISOString().slice(0, 10));
    }
  }

  return {
    totalMetersDrilled: roundCurrency(totalMetersDrilled),
    workedDays: workedDateSet.size,
    reportCount: reports.length
  };
}

export function buildProjectCommercialRevenueSnapshot(options: {
  terms: ProjectCommercialTermsInput;
  work: ProjectWorkProgressInput;
  changeOrders?: ProjectChangeOrderInput[];
}): ProjectCommercialRevenueSnapshot {
  const terms = options.terms;
  const work = options.work;
  const changeOrders = options.changeOrders || [];

  const contractType = terms.contractType || ProjectContractType.PER_METER;
  const meterRate = safeNumber(terms.contractRatePerM);
  const dayRate = safeNumber(terms.contractDayRate);
  const lumpSumValue = safeNumber(terms.contractLumpSumValue);
  const estimatedMeters = safeNumber(terms.estimatedMeters);
  const estimatedDays = safeNumber(terms.estimatedDays);
  const drilledMeters = safeNumber(work.totalMetersDrilled);
  const workedDays = Math.max(0, Math.floor(safeNumber(work.workedDays)));
  const approvedReportCount = Math.max(0, Math.floor(safeNumber(work.reportCount)));

  const changeOrderTotalValue = roundCurrency(
    changeOrders.reduce((sum, order) => sum + safeNumber(order.addedValue), 0)
  );
  const addedMetersTotal = changeOrders.reduce((sum, order) => sum + safeNumber(order.addedMeters), 0);
  const addedDaysTotal = changeOrders.reduce((sum, order) => sum + safeNumber(order.addedDays), 0);
  const adjustedEstimatedMeters = roundCurrency(estimatedMeters + addedMetersTotal);
  const adjustedEstimatedDays = roundCurrency(estimatedDays + addedDaysTotal);

  let baseContractValue: number | null = null;
  let changeOrderAdjustedContractValue: number | null = null;
  let earnedRevenue = 0;
  let remainingRevenue: number | null = null;
  let progressPercent: number | null = null;
  let progressBasis: ProjectCommercialRevenueSnapshot["progressBasis"] = "NONE";
  let revenueFormula = "No commercial formula configured.";

  if (contractType === ProjectContractType.PER_METER) {
    revenueFormula = "Earned revenue = drilled meters x meter rate.";
    earnedRevenue = drilledMeters * meterRate;
    if (adjustedEstimatedMeters > 0) {
      baseContractValue = estimatedMeters > 0 ? estimatedMeters * meterRate : adjustedEstimatedMeters * meterRate;
      changeOrderAdjustedContractValue = baseContractValue + changeOrderTotalValue;
      progressPercent = toProgressPercent(drilledMeters, adjustedEstimatedMeters);
      progressBasis = "METERS";
    } else {
      baseContractValue = null;
      changeOrderAdjustedContractValue = null;
      progressPercent = null;
      progressBasis = "NONE";
    }
  } else if (contractType === ProjectContractType.DAY_RATE) {
    revenueFormula = "Earned revenue = days worked x day rate.";
    earnedRevenue = workedDays * dayRate;
    if (adjustedEstimatedDays > 0) {
      baseContractValue = estimatedDays > 0 ? estimatedDays * dayRate : adjustedEstimatedDays * dayRate;
      changeOrderAdjustedContractValue = baseContractValue + changeOrderTotalValue;
      progressPercent = toProgressPercent(workedDays, adjustedEstimatedDays);
      progressBasis = "DAYS";
    } else {
      baseContractValue = null;
      changeOrderAdjustedContractValue = null;
      progressPercent = null;
      progressBasis = "NONE";
    }
  } else {
    revenueFormula =
      "Earned revenue = (completion progress x lump-sum commercial value). Progress is derived from approved work scope.";
    baseContractValue = lumpSumValue > 0 ? lumpSumValue : null;
    changeOrderAdjustedContractValue =
      baseContractValue !== null ? baseContractValue + changeOrderTotalValue : null;

    let progressRatio = 0;
    if (adjustedEstimatedMeters > 0) {
      progressRatio = drilledMeters / adjustedEstimatedMeters;
      progressBasis = "METERS";
    } else if (adjustedEstimatedDays > 0) {
      progressRatio = workedDays / adjustedEstimatedDays;
      progressBasis = "DAYS";
    } else if ((terms.status || "").toString().toUpperCase() === ProjectStatus.COMPLETED) {
      progressRatio = 1;
      progressBasis = "STATUS";
    } else {
      progressRatio = 0;
      progressBasis = "NONE";
    }

    const boundedProgress = clamp(progressRatio, 0, 1);
    progressPercent = roundCurrency(boundedProgress * 100);
    if (changeOrderAdjustedContractValue !== null) {
      earnedRevenue = changeOrderAdjustedContractValue * boundedProgress;
    } else {
      earnedRevenue = 0;
    }
  }

  earnedRevenue = roundCurrency(earnedRevenue);
  if (changeOrderAdjustedContractValue !== null) {
    remainingRevenue = roundCurrency(Math.max(0, changeOrderAdjustedContractValue - earnedRevenue));
  } else {
    remainingRevenue = null;
  }

  return {
    contractType,
    contractTypeLabel: PROJECT_CONTRACT_TYPE_LABEL[contractType],
    revenueFormula,
    totalMetersDrilled: roundCurrency(drilledMeters),
    workedDays,
    approvedReportCount,
    baseContractValue: baseContractValue === null ? null : roundCurrency(baseContractValue),
    changeOrderTotalValue,
    changeOrderAdjustedContractValue:
      changeOrderAdjustedContractValue === null ? null : roundCurrency(changeOrderAdjustedContractValue),
    earnedRevenue,
    remainingRevenue,
    progressPercent,
    progressBasis,
    adjustedEstimatedMeters,
    adjustedEstimatedDays
  };
}

export const PROJECT_CONTRACT_TYPE_LABEL: Record<ProjectContractType, string> = {
  [ProjectContractType.PER_METER]: "Per meter drilled",
  [ProjectContractType.DAY_RATE]: "Per day / day rate",
  [ProjectContractType.LUMP_SUM]: "Lump sum"
};

function safeNumber(value: unknown) {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }
  return parsed;
}

function roundCurrency(value: number) {
  return Math.round(value * 100) / 100;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function toProgressPercent(current: number, total: number) {
  if (total <= 0) {
    return null;
  }
  return roundCurrency(clamp((current / total) * 100, 0, 100));
}
