import type { EntryApprovalStatus, Prisma } from "@prisma/client";

export const FINANCIAL_DRILL_REPORT_APPROVAL_STATUS = "APPROVED" as const;
export const FINANCIAL_EXPENSE_APPROVAL_STATUSES: EntryApprovalStatus[] = ["APPROVED"];
export const FINANCIAL_INCLUSION_POLICY = {
  revenue: {
    source: "DRILL_REPORTS",
    approvalStatus: FINANCIAL_DRILL_REPORT_APPROVAL_STATUS
  },
  expenses: {
    source: "EXPENSES",
    approvalStatuses: [...FINANCIAL_EXPENSE_APPROVAL_STATUSES]
  }
} as const;

export function withFinancialDrillReportApproval(
  where: Prisma.DrillReportWhereInput = {}
): Prisma.DrillReportWhereInput {
  return {
    ...where,
    approvalStatus: FINANCIAL_DRILL_REPORT_APPROVAL_STATUS
  };
}

export function withFinancialExpenseApproval(where: Prisma.ExpenseWhereInput = {}): Prisma.ExpenseWhereInput {
  return {
    ...where,
    approvalStatus: { in: FINANCIAL_EXPENSE_APPROVAL_STATUSES }
  };
}

export function getFinancialInclusionPolicy() {
  return FINANCIAL_INCLUSION_POLICY;
}
