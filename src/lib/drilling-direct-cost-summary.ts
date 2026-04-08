export interface ReportMovementCostRow {
  totalCost: number | null | undefined;
}

export interface DrillReportDirectCostInput {
  billableAmount: number;
  inventoryMovements: ReportMovementCostRow[];
}

export interface DrillReportDirectCostSummary {
  revenue: number;
  consumablesCostUsed: number;
  simpleResult: number;
}

export interface ProjectDirectCostSummary {
  totalRevenue: number;
  totalUsedConsumablesCost: number;
  simpleResult: number;
}

export interface DrillOperationalKpiSummary {
  metersDrilled: number;
  workHours: number;
  metersPerHour: number | null;
  consumablesCostUsed: number;
  consumablesCostPerMeter: number | null;
}

function toFiniteNumber(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function roundCurrency(value: number) {
  return Math.round(value * 100) / 100;
}

function roundMetric(value: number) {
  return Math.round(value * 100) / 100;
}

function sumMovementCosts(rows: ReportMovementCostRow[]) {
  const total = rows.reduce((sum, row) => sum + toFiniteNumber(row.totalCost), 0);
  return roundCurrency(total);
}

export function buildDrillReportDirectCostSummary(
  input: DrillReportDirectCostInput
): DrillReportDirectCostSummary {
  const revenue = roundCurrency(toFiniteNumber(input.billableAmount));
  const consumablesCostUsed = sumMovementCosts(input.inventoryMovements || []);
  return {
    revenue,
    consumablesCostUsed,
    simpleResult: roundCurrency(revenue - consumablesCostUsed)
  };
}

export function buildProjectDirectCostSummary(input: {
  totalRevenue: number;
  totalUsedConsumablesCost: number;
}): ProjectDirectCostSummary {
  const totalRevenue = roundCurrency(toFiniteNumber(input.totalRevenue));
  const totalUsedConsumablesCost = roundCurrency(toFiniteNumber(input.totalUsedConsumablesCost));
  return {
    totalRevenue,
    totalUsedConsumablesCost,
    simpleResult: roundCurrency(totalRevenue - totalUsedConsumablesCost)
  };
}

export function buildProjectDirectCostSummaryFromReports(
  reports: DrillReportDirectCostInput[]
): ProjectDirectCostSummary {
  const totals = reports.reduce(
    (accumulator, report) => {
      const next = buildDrillReportDirectCostSummary(report);
      return {
        revenue: accumulator.revenue + next.revenue,
        cost: accumulator.cost + next.consumablesCostUsed
      };
    },
    { revenue: 0, cost: 0 }
  );

  return buildProjectDirectCostSummary({
    totalRevenue: totals.revenue,
    totalUsedConsumablesCost: totals.cost
  });
}

function buildRatio(numerator: number, denominator: number) {
  if (denominator <= 0) {
    return null;
  }
  return roundMetric(numerator / denominator);
}

export function buildDrillOperationalKpiSummary(input: {
  totalMetersDrilled: number;
  workHours: number;
  inventoryMovements: ReportMovementCostRow[];
}): DrillOperationalKpiSummary {
  const metersDrilled = roundMetric(toFiniteNumber(input.totalMetersDrilled));
  const workHours = roundMetric(toFiniteNumber(input.workHours));
  const consumablesCostUsed = sumMovementCosts(input.inventoryMovements || []);
  return {
    metersDrilled,
    workHours,
    metersPerHour: buildRatio(metersDrilled, workHours),
    consumablesCostUsed,
    consumablesCostPerMeter: buildRatio(consumablesCostUsed, metersDrilled)
  };
}

export function buildProjectOperationalKpiSummary(input: {
  totalMetersDrilled: number;
  totalWorkHours: number;
  totalUsedConsumablesCost: number;
}): DrillOperationalKpiSummary {
  const metersDrilled = roundMetric(toFiniteNumber(input.totalMetersDrilled));
  const workHours = roundMetric(toFiniteNumber(input.totalWorkHours));
  const consumablesCostUsed = roundCurrency(toFiniteNumber(input.totalUsedConsumablesCost));
  return {
    metersDrilled,
    workHours,
    metersPerHour: buildRatio(metersDrilled, workHours),
    consumablesCostUsed,
    consumablesCostPerMeter: buildRatio(consumablesCostUsed, metersDrilled)
  };
}

export function buildProjectOperationalKpiSummaryFromReports(
  reports: Array<{
    totalMetersDrilled: number;
    workHours: number;
    inventoryMovements: ReportMovementCostRow[];
  }>
): DrillOperationalKpiSummary {
  const totals = reports.reduce(
    (accumulator, report) => {
      const summary = buildDrillOperationalKpiSummary(report);
      return {
        meters: accumulator.meters + summary.metersDrilled,
        hours: accumulator.hours + summary.workHours,
        cost: accumulator.cost + summary.consumablesCostUsed
      };
    },
    { meters: 0, hours: 0, cost: 0 }
  );

  return buildProjectOperationalKpiSummary({
    totalMetersDrilled: totals.meters,
    totalWorkHours: totals.hours,
    totalUsedConsumablesCost: totals.cost
  });
}
