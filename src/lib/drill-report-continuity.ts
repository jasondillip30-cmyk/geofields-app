import type { Prisma, PrismaClient } from "@prisma/client";

type DrillReportLookupClient =
  | Prisma.TransactionClient
  | Pick<PrismaClient, "drillReport">;

const DEPTH_CONTINUITY_TOLERANCE_METERS = 0.01;

export interface DrillReportContinuityInput {
  projectId: string;
  holeNumber: string;
  fromMeter: number;
  excludeReportId?: string;
}

export interface DrillReportContinuityResult {
  isBroken: boolean;
  overrideRequired: boolean;
  expectedBaselineMeter: number | null;
  message: string | null;
}

export async function evaluateDrillReportHoleContinuity(
  db: DrillReportLookupClient,
  input: DrillReportContinuityInput
): Promise<DrillReportContinuityResult> {
  const normalizedHoleNumber = input.holeNumber.trim();
  if (!normalizedHoleNumber) {
    return {
      isBroken: false,
      overrideRequired: false,
      expectedBaselineMeter: null,
      message: null
    };
  }

  const matchingReports = await db.drillReport.findMany({
    where: {
      projectId: input.projectId,
      holeNumber: normalizedHoleNumber,
      approvalStatus: {
        not: "REJECTED"
      },
      ...(input.excludeReportId ? { id: { not: input.excludeReportId } } : {})
    },
    select: {
      fromMeter: true,
      toMeter: true
    }
  });

  if (matchingReports.length === 0) {
    return {
      isBroken: false,
      overrideRequired: false,
      expectedBaselineMeter: null,
      message: null
    };
  }

  const expectedBaselineMeter = matchingReports.reduce((maxDepth, report) => {
    const fromDepth = Number(report.fromMeter);
    const toDepth = Number(report.toMeter);
    const rangeEnd = Math.max(
      Number.isFinite(fromDepth) ? fromDepth : 0,
      Number.isFinite(toDepth) ? toDepth : 0
    );
    return Math.max(maxDepth, rangeEnd);
  }, 0);

  const nextFromMeter = Number(input.fromMeter);
  const difference = Math.abs(nextFromMeter - expectedBaselineMeter);
  const isBroken = !Number.isFinite(nextFromMeter) || difference > DEPTH_CONTINUITY_TOLERANCE_METERS;

  if (!isBroken) {
    return {
      isBroken: false,
      overrideRequired: false,
      expectedBaselineMeter,
      message: null
    };
  }

  const fromLabel = formatDepth(nextFromMeter);
  const expectedLabel = formatDepth(expectedBaselineMeter);
  return {
    isBroken: true,
    overrideRequired: true,
    expectedBaselineMeter,
    message: `This hole starts at ${fromLabel}m, but expected ${expectedLabel}m from previous reports. Add an override reason to save.`
  };
}

function formatDepth(value: number) {
  if (!Number.isFinite(value)) {
    return "0";
  }
  const rounded = Math.round(value * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2);
}
