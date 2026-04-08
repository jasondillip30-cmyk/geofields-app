export const DRILL_DELAY_REASON_VALUES = [
  "WEATHER",
  "RIG_BREAKDOWN",
  "RIG_MOVE_SETUP",
  "MATERIAL_SUPPLY_WAIT",
  "POWER_WATER_ISSUE",
  "SAFETY_PERMIT_HOLD",
  "SITE_ACCESS",
  "OTHER"
] as const;

export type DrillDelayReasonCategory = (typeof DRILL_DELAY_REASON_VALUES)[number];

export const DRILL_DELAY_REASON_OPTIONS: Array<{
  value: DrillDelayReasonCategory;
  label: string;
}> = [
  { value: "WEATHER", label: "Weather" },
  { value: "RIG_BREAKDOWN", label: "Rig breakdown" },
  { value: "RIG_MOVE_SETUP", label: "Rig move / setup" },
  { value: "MATERIAL_SUPPLY_WAIT", label: "Material supply wait" },
  { value: "POWER_WATER_ISSUE", label: "Power / water issue" },
  { value: "SAFETY_PERMIT_HOLD", label: "Safety / permit hold" },
  { value: "SITE_ACCESS", label: "Site access" },
  { value: "OTHER", label: "Other" }
];

export function parseDelayReasonCategory(
  value: unknown
): DrillDelayReasonCategory | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toUpperCase();
  return DRILL_DELAY_REASON_VALUES.includes(normalized as DrillDelayReasonCategory)
    ? (normalized as DrillDelayReasonCategory)
    : null;
}

export function normalizeDelayReasonNote(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function validateDelayReasonInput(input: {
  delayHours: number;
  delayReasonCategory: DrillDelayReasonCategory | null;
  delayReasonNote: string | null;
}): {
  error: string | null;
  delayReasonCategory: DrillDelayReasonCategory | null;
  delayReasonNote: string | null;
} {
  if (input.delayHours > 0 && !input.delayReasonCategory) {
    return {
      error: "Select a delay reason when delay hours are above zero.",
      delayReasonCategory: null,
      delayReasonNote: input.delayReasonNote
    };
  }

  if (input.delayHours <= 0) {
    return {
      error: null,
      delayReasonCategory: null,
      delayReasonNote: null
    };
  }

  return {
    error: null,
    delayReasonCategory: input.delayReasonCategory,
    delayReasonNote: input.delayReasonNote
  };
}
