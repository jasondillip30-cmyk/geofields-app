import { RigCostAllocationBasis } from "@prisma/client";

export interface ProjectLaborEntryCostInput {
  hoursWorked: number;
  hourlyRate: number;
}

export interface ProjectLaborCostSummary {
  totalLaborCost: number;
  entryCount: number;
  hasCapturedLabor: boolean;
}

export interface ProjectRigCostConfigInput {
  id: string;
  rigCode: string;
  costAllocationBasis: RigCostAllocationBasis;
  costRatePerDay: number;
  costRatePerHour: number;
}

export interface ApprovedRigActivityInput {
  rigId: string;
  date: Date | string;
  workHours: number;
}

export type ProjectRigCostAllocationStatus =
  | "COST_DERIVED"
  | "MISSING_RATE"
  | "MISSING_ACTIVITY_BASIS";

export interface ProjectRigCostAllocationRow {
  rigId: string;
  rigCode: string;
  costAllocationBasis: RigCostAllocationBasis;
  configuredRate: number;
  activityDays: number;
  activityHours: number;
  basisUnits: number;
  derivedCost: number;
  status: ProjectRigCostAllocationStatus;
}

export interface ProjectRigCostSummary {
  totalRigCost: number;
  rows: ProjectRigCostAllocationRow[];
  rigsEvaluated: number;
  rigsWithMissingRate: number;
  rigsWithMissingActivityBasis: number;
  hasCoverageGaps: boolean;
}

export function buildProjectLaborCostSummary(
  entries: ProjectLaborEntryCostInput[]
): ProjectLaborCostSummary {
  const entryCount = entries.length;
  const totalLaborCost = roundCurrency(
    entries.reduce((sum, entry) => {
      return sum + safeNumber(entry.hoursWorked) * safeNumber(entry.hourlyRate);
    }, 0)
  );

  return {
    totalLaborCost,
    entryCount,
    hasCapturedLabor: entryCount > 0
  };
}

export function buildProjectRigCostSummary(options: {
  rigs: ProjectRigCostConfigInput[];
  approvedActivity: ApprovedRigActivityInput[];
}): ProjectRigCostSummary {
  const activityByRig = new Map<
    string,
    { dayKeys: Set<string>; workHours: number }
  >();

  for (const activity of options.approvedActivity) {
    const existing = activityByRig.get(activity.rigId) || {
      dayKeys: new Set<string>(),
      workHours: 0
    };
    const parsedDate = activity.date instanceof Date ? activity.date : new Date(activity.date);
    if (!Number.isNaN(parsedDate.getTime())) {
      existing.dayKeys.add(parsedDate.toISOString().slice(0, 10));
    }
    existing.workHours += safeNumber(activity.workHours);
    activityByRig.set(activity.rigId, existing);
  }

  const rows = options.rigs.map<ProjectRigCostAllocationRow>((rig) => {
    const activity = activityByRig.get(rig.id);
    const activityDays = activity?.dayKeys.size || 0;
    const activityHours = roundCurrency(activity?.workHours || 0);
    const configuredRate =
      rig.costAllocationBasis === RigCostAllocationBasis.DAY
        ? safeNumber(rig.costRatePerDay)
        : safeNumber(rig.costRatePerHour);
    const basisUnits =
      rig.costAllocationBasis === RigCostAllocationBasis.DAY ? activityDays : activityHours;

    if (configuredRate <= 0) {
      return {
        rigId: rig.id,
        rigCode: rig.rigCode,
        costAllocationBasis: rig.costAllocationBasis,
        configuredRate,
        activityDays,
        activityHours,
        basisUnits,
        derivedCost: 0,
        status: "MISSING_RATE"
      };
    }

    if (basisUnits <= 0) {
      return {
        rigId: rig.id,
        rigCode: rig.rigCode,
        costAllocationBasis: rig.costAllocationBasis,
        configuredRate,
        activityDays,
        activityHours,
        basisUnits,
        derivedCost: 0,
        status: "MISSING_ACTIVITY_BASIS"
      };
    }

    return {
      rigId: rig.id,
      rigCode: rig.rigCode,
      costAllocationBasis: rig.costAllocationBasis,
      configuredRate,
      activityDays,
      activityHours,
      basisUnits,
      derivedCost: roundCurrency(configuredRate * basisUnits),
      status: "COST_DERIVED"
    };
  });

  rows.sort((a, b) => b.derivedCost - a.derivedCost || a.rigCode.localeCompare(b.rigCode));

  const rigsWithMissingRate = rows.filter((row) => row.status === "MISSING_RATE").length;
  const rigsWithMissingActivityBasis = rows.filter(
    (row) => row.status === "MISSING_ACTIVITY_BASIS"
  ).length;
  const totalRigCost = roundCurrency(rows.reduce((sum, row) => sum + row.derivedCost, 0));

  return {
    totalRigCost,
    rows,
    rigsEvaluated: rows.length,
    rigsWithMissingRate,
    rigsWithMissingActivityBasis,
    hasCoverageGaps: rigsWithMissingRate > 0 || rigsWithMissingActivityBasis > 0
  };
}

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
