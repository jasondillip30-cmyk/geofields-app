export type DecisionSupportCommandKind =
  | "WHAT_FIRST"
  | "BIGGEST_RISKS"
  | "TOP_REVENUE_RIG"
  | "HIGHEST_EXPENSE_RIG"
  | "RIGS_NEEDING_ATTENTION"
  | "PENDING_MAINTENANCE_RISKS"
  | "BIGGEST_PROFITABILITY_ISSUE"
  | "DATA_GAPS_HURTING_REPORTS"
  | "TOP_MAINTENANCE_ISSUE"
  | "TOP_RIG_RISK"
  | "BIGGEST_APPROVAL_ISSUE"
  | "TAKE_ME_TO"
  | "UNSUPPORTED";

export interface DecisionSupportCommandResult {
  kind: DecisionSupportCommandKind;
  supported: boolean;
  canonicalQuestion: string;
  hint?: string;
}

export const decisionSupportCommandHints = [
  "what should i do first",
  "show biggest risks",
  "show top revenue rig",
  "show highest expense rig",
  "show rigs needing attention",
  "show pending maintenance risks",
  "show biggest profitability issue",
  "show data gaps hurting reports",
  "take me to top maintenance issue",
  "take me to top rig risk",
  "take me to biggest approval issue",
  "take me to [item]"
] as const;

export function parseDecisionSupportCommand(input: string): DecisionSupportCommandResult {
  const normalized = normalizeInput(input);
  if (!normalized) {
    return {
      kind: "UNSUPPORTED",
      supported: false,
      canonicalQuestion: "",
      hint: buildHint()
    };
  }

  if (
    normalized.includes("what should i do first") ||
    normalized.includes("what needs attention first") ||
    normalized.includes("what should i do next") ||
    normalized === "do first" ||
    normalized === "do next"
  ) {
    return {
      kind: "WHAT_FIRST",
      supported: true,
      canonicalQuestion: "what should i do first"
    };
  }

  if (
    normalized.includes("show biggest risks") ||
    normalized.includes("biggest risks") ||
    normalized.includes("show risks")
  ) {
    return {
      kind: "BIGGEST_RISKS",
      supported: true,
      canonicalQuestion: "show biggest risks"
    };
  }

  if (normalized.includes("show top revenue rig") || normalized.includes("top revenue rig")) {
    return {
      kind: "TOP_REVENUE_RIG",
      supported: true,
      canonicalQuestion: "show top revenue rig"
    };
  }

  if (normalized.includes("show highest expense rig") || normalized.includes("highest expense rig")) {
    return {
      kind: "HIGHEST_EXPENSE_RIG",
      supported: true,
      canonicalQuestion: "show highest expense rig"
    };
  }

  if (normalized.includes("show rigs needing attention") || normalized.includes("rigs needing attention")) {
    return {
      kind: "RIGS_NEEDING_ATTENTION",
      supported: true,
      canonicalQuestion: "show rigs needing attention"
    };
  }

  if (
    normalized.includes("show pending maintenance risks") ||
    normalized.includes("show pending maintenance risk") ||
    normalized.includes("pending maintenance risks")
  ) {
    return {
      kind: "PENDING_MAINTENANCE_RISKS",
      supported: true,
      canonicalQuestion: "show pending maintenance risks"
    };
  }

  if (
    normalized.includes("show biggest profitability issue") ||
    normalized.includes("biggest profitability issue")
  ) {
    return {
      kind: "BIGGEST_PROFITABILITY_ISSUE",
      supported: true,
      canonicalQuestion: "show biggest profitability issue"
    };
  }

  if (
    normalized.includes("show data gaps hurting reports") ||
    normalized.includes("data gaps hurting reports")
  ) {
    return {
      kind: "DATA_GAPS_HURTING_REPORTS",
      supported: true,
      canonicalQuestion: "show data gaps hurting reports"
    };
  }

  if (
    normalized.includes("take me to top maintenance issue") ||
    normalized.includes("show top maintenance issue")
  ) {
    return {
      kind: "TOP_MAINTENANCE_ISSUE",
      supported: true,
      canonicalQuestion: "take me to top maintenance issue"
    };
  }

  if (normalized.includes("take me to top rig risk") || normalized.includes("show top rig risk")) {
    return {
      kind: "TOP_RIG_RISK",
      supported: true,
      canonicalQuestion: "take me to top rig risk"
    };
  }

  if (
    normalized.includes("take me to biggest approval issue") ||
    normalized.includes("show biggest approval issue")
  ) {
    return {
      kind: "BIGGEST_APPROVAL_ISSUE",
      supported: true,
      canonicalQuestion: "take me to biggest approval issue"
    };
  }

  if (
    normalized.includes("take me to") ||
    normalized === "take me there" ||
    normalized.includes("show me")
  ) {
    return {
      kind: "TAKE_ME_TO",
      supported: true,
      canonicalQuestion: normalized
    };
  }

  return {
    kind: "UNSUPPORTED",
    supported: false,
    canonicalQuestion: normalized,
    hint: buildHint()
  };
}

function normalizeInput(input: string) {
  return input.toLowerCase().trim().replace(/\s+/g, " ").replace(/[.!?]+$/g, "");
}

function buildHint() {
  return `Use one of: ${decisionSupportCommandHints.join(" • ")}`;
}
