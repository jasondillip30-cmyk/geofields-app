import { formatCurrency } from "@/lib/utils";

export type ProjectContractTypeDisplay = "PER_METER" | "DAY_RATE" | "LUMP_SUM";

export interface ProjectBillingRateItemDisplay {
  unit?: string | null;
  drillingStageLabel?: string | null;
  depthBandStartM?: number | null;
  depthBandEndM?: number | null;
  isActive?: boolean | null;
}

export interface ProjectContractDisplayInput {
  contractType: ProjectContractTypeDisplay;
  contractRatePerM: number;
  contractDayRate?: number | null;
  contractLumpSumValue?: number | null;
  billingRateItems?: ProjectBillingRateItemDisplay[] | null;
}

export function formatProjectContractRateDisplay(input: ProjectContractDisplayInput) {
  if (input.contractType === "PER_METER" && hasStagedMeterBilling(input.billingRateItems)) {
    return "Staged billing";
  }

  if (input.contractType === "PER_METER") {
    return `${formatCurrency(safeNumber(input.contractRatePerM))} / meter`;
  }

  if (input.contractType === "DAY_RATE") {
    return `${formatCurrency(safeNumber(input.contractDayRate))} / day`;
  }

  return formatCurrency(safeNumber(input.contractLumpSumValue));
}

export function hasStagedMeterBilling(items: ProjectBillingRateItemDisplay[] | null | undefined) {
  const activeItems = (items || []).filter((entry) => entry && entry.isActive !== false);
  const meterItems = activeItems.filter((entry) => normalizeUnit(entry.unit) === "meter");

  if (meterItems.length > 1) {
    return true;
  }

  return meterItems.some((entry) => {
    const stageLabel = typeof entry.drillingStageLabel === "string" ? entry.drillingStageLabel.trim() : "";
    return (
      stageLabel.length > 0 ||
      Number.isFinite(entry.depthBandStartM) ||
      Number.isFinite(entry.depthBandEndM)
    );
  });
}

function normalizeUnit(value: string | null | undefined) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function safeNumber(value: unknown) {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  return parsed;
}
