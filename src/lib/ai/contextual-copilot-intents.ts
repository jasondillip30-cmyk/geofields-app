export type GeoFieldsDecisionCommand =
  | "TOP_REVENUE_RIG"
  | "HIGHEST_EXPENSE_RIG"
  | "RIGS_NEEDING_ATTENTION"
  | "PENDING_MAINTENANCE_RISKS"
  | "BIGGEST_PROFITABILITY_ISSUE"
  | "DATA_GAPS_HURTING_REPORTS"
  | "TOP_MAINTENANCE_ISSUE"
  | "TOP_RIG_RISK"
  | "BIGGEST_APPROVAL_ISSUE";

export function isSummaryQuestion(normalizedQuestion: string) {
  return (
    normalizedQuestion.includes("summarize this page") ||
    normalizedQuestion.includes("summarize") ||
    normalizedQuestion.includes("summary") ||
    normalizedQuestion.includes("what's happening") ||
    normalizedQuestion.includes("what is happening")
  );
}

export function isGeneralExplanationQuestion(normalizedQuestion: string) {
  const startsAsDefinition =
    normalizedQuestion.startsWith("what is ") ||
    normalizedQuestion.startsWith("what's ") ||
    normalizedQuestion.startsWith("define ") ||
    normalizedQuestion.startsWith("explain ");
  if (!startsAsDefinition) {
    return false;
  }
  return (
    normalizedQuestion.includes("expense") ||
    normalizedQuestion.includes("profit") ||
    normalizedQuestion.includes("pending approval") ||
    normalizedQuestion.includes("approval") ||
    normalizedQuestion.includes("budget") ||
    normalizedQuestion.includes("overspent") ||
    normalizedQuestion.includes("linkage") ||
    normalizedQuestion.includes("maintenance") ||
    normalizedQuestion.includes("forecast")
  );
}

export function isBroadGeneralQuestion(normalizedQuestion: string) {
  const startsGeneral =
    normalizedQuestion.startsWith("what is ") ||
    normalizedQuestion.startsWith("what's ") ||
    normalizedQuestion.startsWith("how does ") ||
    normalizedQuestion.startsWith("why does ") ||
    normalizedQuestion.startsWith("can you explain ");
  if (!startsGeneral) {
    return false;
  }
  return (
    !normalizedQuestion.includes("this page") &&
    !normalizedQuestion.includes("here") &&
    !normalizedQuestion.includes("this record") &&
    !normalizedQuestion.includes("this item")
  );
}

export function isSmallTalk(normalizedQuestion: string) {
  const punctuationTolerant = normalizedQuestion.replace(/[.!?]+$/g, "").trim();
  return (
    punctuationTolerant === "hey" ||
    punctuationTolerant === "hi" ||
    punctuationTolerant === "hello" ||
    punctuationTolerant === "what's up" ||
    punctuationTolerant === "whats up" ||
    punctuationTolerant === "you good" ||
    punctuationTolerant === "okay" ||
    punctuationTolerant === "ok" ||
    punctuationTolerant === "thanks" ||
    punctuationTolerant === "thank you" ||
    normalizedQuestion.includes("how are you") ||
    normalizedQuestion.includes("can you help me")
  );
}

export function isFollowUpReference(normalizedQuestion: string) {
  return (
    normalizedQuestion === "that one" ||
    normalizedQuestion === "that item" ||
    normalizedQuestion.includes("the one you just showed") ||
    normalizedQuestion.includes("the first one") ||
    normalizedQuestion.includes("that issue")
  );
}

export function isComparisonQuestion(normalizedQuestion: string) {
  return (
    normalizedQuestion.includes("compare the top two") ||
    normalizedQuestion.includes("compare these two") ||
    normalizedQuestion.includes("which is more urgent") ||
    normalizedQuestion.includes("which is higher value") ||
    normalizedQuestion.includes("which is easiest to fix")
  );
}

export function isPlanningQuestion(normalizedQuestion: string) {
  return (
    normalizedQuestion.includes("what should i do first") ||
    normalizedQuestion.includes("what should i do next") ||
    normalizedQuestion.includes("what should i do") ||
    normalizedQuestion.includes("what needs attention first") ||
    normalizedQuestion.includes("next 10 minutes") ||
    normalizedQuestion.includes("can wait") ||
    normalizedQuestion.includes("can this wait") ||
    normalizedQuestion.includes("quickest win") ||
    normalizedQuestion.includes("quick win")
  );
}

export function isClarificationQuestion(normalizedQuestion: string) {
  return (
    normalizedQuestion === "why" ||
    normalizedQuestion === "why?" ||
    normalizedQuestion.includes("what do you mean") ||
    normalizedQuestion.includes("explain that simply") ||
    normalizedQuestion.includes("explain this simply")
  );
}

export function normalizeUserQuestion(question: string) {
  return question.toLowerCase().trim();
}

export function resolveGeoFieldsDecisionCommand(
  normalizedQuestion: string
): GeoFieldsDecisionCommand | null {
  if (normalizedQuestion.includes("top revenue rig")) {
    return "TOP_REVENUE_RIG";
  }
  if (normalizedQuestion.includes("highest expense rig")) {
    return "HIGHEST_EXPENSE_RIG";
  }
  if (normalizedQuestion.includes("rigs needing attention")) {
    return "RIGS_NEEDING_ATTENTION";
  }
  if (
    normalizedQuestion.includes("pending maintenance risks") ||
    normalizedQuestion.includes("pending maintenance risk")
  ) {
    return "PENDING_MAINTENANCE_RISKS";
  }
  if (normalizedQuestion.includes("biggest profitability issue")) {
    return "BIGGEST_PROFITABILITY_ISSUE";
  }
  if (normalizedQuestion.includes("data gaps hurting reports")) {
    return "DATA_GAPS_HURTING_REPORTS";
  }
  if (normalizedQuestion.includes("top maintenance issue")) {
    return "TOP_MAINTENANCE_ISSUE";
  }
  if (normalizedQuestion.includes("top rig risk")) {
    return "TOP_RIG_RISK";
  }
  if (normalizedQuestion.includes("biggest approval issue")) {
    return "BIGGEST_APPROVAL_ISSUE";
  }
  return null;
}

export function buildSmallTalkAnswer(normalizedQuestion: string) {
  const punctuationTolerant = normalizedQuestion.replace(/[.!?]+$/g, "").trim();
  if (normalizedQuestion.includes("how are you")) {
    return "Doing well and ready to help. Want a quick summary or the top action to take now?";
  }
  if (
    punctuationTolerant === "hey" ||
    punctuationTolerant === "hi" ||
    punctuationTolerant === "hello" ||
    punctuationTolerant.includes("what's up") ||
    punctuationTolerant.includes("whats up") ||
    punctuationTolerant.includes("you good")
  ) {
    return "Hey — I’m here with you. Want me to break down what needs attention first?";
  }
  if (normalizedQuestion.includes("can you help me")) {
    return "Absolutely. Tell me what decision you’re trying to make, and I’ll keep it simple.";
  }
  if (punctuationTolerant.includes("thanks") || punctuationTolerant.includes("thank you")) {
    return "Anytime. If you want, I can line up the next best move.";
  }
  if (punctuationTolerant === "ok" || punctuationTolerant === "okay") {
    return "Sounds good. Want to continue with the top priority or switch scope?";
  }
  return "I’m here and ready. Ask me anything, and I’ll keep it practical.";
}

export function buildGeneralExplanationAnswer({
  question,
  context,
  topFocus,
  summary
}: {
  question: string;
  context: { pageKey: string };
  topFocus: unknown;
  summary: string;
}) {
  if (question.includes("what is an expense") || question.includes("what is expense")) {
    return buildExplanationWithAppNote(
      "An expense is money the company spends to run operations, such as fuel, labor, parts, travel, or services.",
      context,
      summary,
      topFocus
    );
  }
  if (question.includes("what is profit") || question.includes("what's profit")) {
    return buildExplanationWithAppNote(
      "Profit is the amount left after recognized costs are subtracted from revenue. In simple terms: profit = revenue - recognized expenses.",
      context,
      summary,
      topFocus
    );
  }
  if (question.includes("pending approval") || question.includes("pending approvals")) {
    return buildExplanationWithAppNote(
      "Pending approval means a record was submitted but has not been approved or rejected yet, so it is still waiting on a manager decision.",
      context,
      summary,
      topFocus
    );
  }
  if (question.includes("budget")) {
    return buildExplanationWithAppNote(
      "A budget is planned spend for a scope (like a rig or project). In Project Operations, budget comparison shows recognized spend against plan so pressure appears early.",
      context,
      summary,
      topFocus
    );
  }
  if (question.includes("linkage")) {
    return buildExplanationWithAppNote(
      "Linkage means connecting a cost record to its operational owner, such as rig, project, or maintenance request, so reporting stays accurate.",
      context,
      summary,
      topFocus
    );
  }
  if (question.includes("forecast")) {
    return buildExplanationWithAppNote(
      "Forecasting estimates future financial outcomes from current approved signals and trend direction, so managers can act before risks grow.",
      context,
      summary,
      topFocus
    );
  }

  return buildExplanationWithAppNote(
    "That term describes how operations and finance records are interpreted for decision-making. I can break it down with a concrete app example if you want.",
    context,
    summary,
    topFocus
  );
}

function buildExplanationWithAppNote(
  explanation: string,
  context: { pageKey: string },
  summary: string,
  topFocus: unknown
) {
  if (context.pageKey === "atlas-whole-app" || context.pageKey === "atlas-related") {
    return `${explanation} If you want, I can tie this back to your current app-wide priorities.`;
  }
  if (topFocus || summary) {
    return `${explanation} If helpful, I can apply that directly to what you’re looking at now.`;
  }
  return explanation;
}
