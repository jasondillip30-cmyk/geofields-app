const STAGE_EPSILON = 0.000001;

export interface SpendingStageBandInput {
  label?: string | null;
  startM?: number | null;
  endM?: number | null;
  sortOrder?: number | null;
}

export interface SpendingStageSegment {
  label: string;
  startM: number;
  endM: number;
  fillPercent: number;
}

export interface SpendingStageProgress {
  stageConfigured: boolean;
  currentDepth: number;
  currentStageLabel: string | null;
  stageSegments: SpendingStageSegment[];
}

interface NormalizedStageBand {
  label: string;
  startM: number;
  endM: number;
}

export function normalizeSpendingStageBands(inputs: SpendingStageBandInput[]) {
  return inputs
    .map((input, index) => {
      const startRaw = toFiniteNumber(input.startM);
      const endRaw = toFiniteNumber(input.endM);
      if (startRaw === null || endRaw === null) {
        return null;
      }
      const startM = Math.min(startRaw, endRaw);
      const endM = Math.max(startRaw, endRaw);
      if (endM - startM <= STAGE_EPSILON) {
        return null;
      }
      const label = normalizeLabel(input.label, `Stage ${index + 1}`);
      const sortOrder = toFiniteNumber(input.sortOrder);
      return {
        label,
        startM,
        endM,
        sortOrder: sortOrder === null ? Number.POSITIVE_INFINITY : sortOrder
      };
    })
    .filter((entry): entry is NormalizedStageBand & { sortOrder: number } => entry !== null)
    .sort((left, right) => {
      if (left.startM !== right.startM) {
        return left.startM - right.startM;
      }
      if (left.endM !== right.endM) {
        return left.endM - right.endM;
      }
      if (left.sortOrder !== right.sortOrder) {
        return left.sortOrder - right.sortOrder;
      }
      return left.label.localeCompare(right.label);
    })
    .map(({ label, startM, endM }) => ({
      label,
      startM,
      endM
    }));
}

export function buildSpendingStageProgress(options: {
  depthM: number;
  stageBands: SpendingStageBandInput[];
}): SpendingStageProgress {
  const currentDepth = Math.max(0, toFiniteNumber(options.depthM) ?? 0);
  const bands = normalizeSpendingStageBands(options.stageBands);
  if (bands.length === 0) {
    return {
      stageConfigured: false,
      currentDepth,
      currentStageLabel: null,
      stageSegments: []
    };
  }

  const stageSegments = bands.map<SpendingStageSegment>((band) => ({
    label: band.label,
    startM: roundMetric(band.startM),
    endM: roundMetric(band.endM),
    fillPercent: roundPercent(calculateFillPercent(currentDepth, band.startM, band.endM))
  }));

  return {
    stageConfigured: true,
    currentDepth: roundMetric(currentDepth),
    currentStageLabel: resolveCurrentStageLabel(currentDepth, stageSegments),
    stageSegments
  };
}

function resolveCurrentStageLabel(depthM: number, segments: SpendingStageSegment[]) {
  for (const segment of segments) {
    if (depthM >= segment.startM - STAGE_EPSILON && depthM < segment.endM - STAGE_EPSILON) {
      return segment.label;
    }
  }
  const lastSegment = segments[segments.length - 1];
  if (lastSegment && depthM >= lastSegment.endM - STAGE_EPSILON) {
    return lastSegment.label;
  }
  return null;
}

function calculateFillPercent(depthM: number, startM: number, endM: number) {
  if (depthM <= startM + STAGE_EPSILON) {
    return 0;
  }
  if (depthM >= endM - STAGE_EPSILON) {
    return 100;
  }
  const span = endM - startM;
  if (span <= STAGE_EPSILON) {
    return 0;
  }
  const progress = (depthM - startM) / span;
  return Math.max(0, Math.min(1, progress)) * 100;
}

function normalizeLabel(value: string | null | undefined, fallback: string) {
  const trimmed = `${value || ""}`.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

function toFiniteNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function roundMetric(value: number) {
  return Math.round(value * 100) / 100;
}

function roundPercent(value: number) {
  return Math.round(value * 100) / 100;
}
