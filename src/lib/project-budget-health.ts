export const budgetHealthThresholds = {
  minimumProgressForPace: 0.2,
  watchGap: 0.05,
  riskGap: 0.15,
  lowHeadroom: 0.9
} as const;

export type BudgetHealthVerdict = "ON_TRACK" | "WATCH" | "AT_RISK" | "INSUFFICIENT";
export type BudgetHealthPlan = {
  amount: number;
  currency: string;
  periodStart: string;
  periodEnd: string;
};
export type ProjectBudgetHealth = {
  verdict: BudgetHealthVerdict;
  headline: string;
  why: string;
  next: string;
  followUp: "setup" | "expenses" | "drilling" | "reports";
  plan: BudgetHealthPlan | null;
  actual: number;
  approvedMeters: number;
  plannedMeters: number | null;
  budgetUsed: number | null;
  progress: number | null;
  remainingBudget: number | null;
  paceEstimate: number | null;
  periodOverrun?: { posted: number; excess: number };
};

export function assessProjectBudgetHealth(input: {
  plans: BudgetHealthPlan[];
  projectStart: string;
  projectEnd: string | null;
  firstActualDate: string | null;
  lastActualDate: string | null;
  completed: boolean;
  actual: number;
  approvedMeters: number;
  plannedMeters: number | null;
  budgetPeriodPosted?: number;
}): ProjectBudgetHealth {
  const { actual, approvedMeters, completed } = input;
  const plannedMeters = input.plannedMeters && input.plannedMeters > 0 ? input.plannedMeters : null;
  const progress = plannedMeters ? approvedMeters / plannedMeters : null;
  const plan = input.plans.length === 1 ? input.plans[0] : null;
  const comparable = Boolean(plan && plan.amount > 0 && plan.currency === "USD" && input.projectEnd &&
    plan.periodStart <= input.projectStart && plan.periodEnd >= input.projectEnd &&
    (!input.firstActualDate || plan.periodStart <= input.firstActualDate) &&
    (!input.lastActualDate || plan.periodEnd >= input.lastActualDate));
  const budgetUsed = comparable && plan ? actual / plan.amount : null;
  const base = {
    plan, actual, approvedMeters, plannedMeters, budgetUsed, progress,
    remainingBudget: comparable && plan ? plan.amount - actual : null,
    paceEstimate: null
  };
  if (!plan || budgetUsed === null) {
    const posted = input.budgetPeriodPosted;
    if (plan && plan.amount > 0 && plan.currency === "USD" && posted !== undefined && posted > plan.amount) {
      return { ...base, verdict: "AT_RISK", headline: "Posted expenses exceed the budget for its stated period.",
        why: "Costs posted within the budget dates already exceed the plan. This does not establish whether the whole project is over budget.",
        next: "Review posted costs for that period and confirm the remaining project scope.", followUp: "expenses",
        periodOverrun: { posted, excess: Math.round((posted - plan.amount) * 100) / 100 } };
    }
    const why = input.plans.length > 1 ? "More than one active project budget exists. We cannot safely pick or combine them."
      : !plan || plan.amount <= 0 ? "There is no positive active project budget to compare against posted expenses."
      : plan.currency !== "USD" ? "The budget currency differs from the USD spending view. No currency conversion has been applied."
      : !input.projectEnd ? "The project has no end date, so we cannot confirm that the budget covers the whole job."
      : "The budget dates do not cover the project and all posted activity. A part-period plan cannot be compared to whole-project expenses.";
    return { ...base, verdict: "INSUFFICIENT", headline: "We can’t judge spend against this budget yet.", why,
      next: "Confirm one active, full-project budget in the same currency as Spending.", followUp: "setup" };
  }
  if (budgetUsed > 1) {
    return { ...base, verdict: "AT_RISK", headline: "Posted expenses are already over budget.",
      why: "The recorded cost exceeds the active project budget, before any costs still awaiting posting.",
      next: "Review the largest cost categories and confirm whether the approved scope or cost plan changed.", followUp: "expenses" };
  }
  if (completed) {
    return { ...base, verdict: "INSUFFICIENT", headline: "Posted costs are within budget; closeout needs review.",
      why: "A completed project can still have unposted bills or costs. The available records do not confirm final cost.",
      next: "Reconcile the final expenses and any outstanding invoices before treating this as the closeout result.", followUp: "expenses" };
  }
  if (budgetUsed >= 1 && (progress === null || progress < 1)) {
    return { ...base, verdict: "AT_RISK", headline: "The budget is spent, with no confirmed room to finish.",
      why: "Posted expenses have used the full budget and approved meters have not confirmed completion against the target.",
      next: "Confirm the remaining work and any unposted costs before committing more spend.", followUp: "expenses" };
  }
  if (progress === null) {
    return { ...base, verdict: "INSUFFICIENT", headline: "We can’t tell whether spending is on pace.",
      why: "There is no planned meter target to compare with approved drilling progress.",
      next: "Add or verify estimated meters in Project Setup.", followUp: "setup" };
  }
  if (progress >= 1) {
    return { ...base, verdict: "WATCH", headline: "The meter target is met; check remaining costs.",
      why: "Approved meters have reached the target and posted costs are within budget. That does not confirm the job is financially closed.",
      next: "Check for unfinished work and costs that have not posted.", followUp: "expenses" };
  }
  if (progress < budgetHealthThresholds.minimumProgressForPace || actual <= 0) {
    return { ...base, verdict: budgetUsed >= budgetHealthThresholds.lowHeadroom ? "AT_RISK" : "INSUFFICIENT",
      headline: budgetUsed >= budgetHealthThresholds.lowHeadroom ? "Budget headroom is tight this early." : "It’s too early to judge spending pace.",
      why: actual <= 0 ? "There are no positive net posted costs to estimate a spending pace from."
        : "Less than 20% of planned meters are approved. Mobilization or reports awaiting approval can skew the comparison.",
      next: "Check approved drilling progress and whether early setup costs are one-off.", followUp: "drilling" };
  }
  const gap = budgetUsed - progress;
  const paceEstimate = actual / progress;
  if (gap >= budgetHealthThresholds.riskGap - 1e-9) {
    return { ...base, paceEstimate, verdict: "AT_RISK", headline: "Spending is well ahead of drilling progress.",
      why: "Budget use is at least 15 percentage points ahead of approved meters. If the pattern continues, posted costs could exceed the budget.",
      next: "Separate one-off mobilization from recurring costs, then check the biggest cost category.", followUp: "expenses" };
  }
  if (gap >= budgetHealthThresholds.watchGap - 1e-9 || budgetUsed >= budgetHealthThresholds.lowHeadroom) {
    return { ...base, paceEstimate, verdict: "WATCH", headline: "Check the remaining budget before committing more.",
      why: budgetUsed >= budgetHealthThresholds.lowHeadroom ? "At least 90% of the budget is already posted and the meter target is not yet met."
        : "Budget use is at least 5 percentage points ahead of approved drilling progress.",
      next: "Check what is still needed to finish and whether recent costs will repeat.", followUp: "expenses" };
  }
  return { ...base, paceEstimate, verdict: "ON_TRACK", headline: "Posted spending is broadly in line with drilling progress.",
    why: "Budget use is less than 5 percentage points ahead of approved meters, with more than 10% of the budget unspent.",
    next: "Check remaining crew, fuel and parts costs before relying on the current pace.", followUp: "reports" };
}
