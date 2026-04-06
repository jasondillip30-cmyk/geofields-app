import { ProjectInvoiceStatus } from "@prisma/client";

export interface ProjectRevenueRealizationInvoiceInput {
  id: string;
  invoiceNumber: string;
  issueDate: Date | string;
  dueDate: Date | string | null;
  amount: number;
  status: ProjectInvoiceStatus | string;
  notes?: string | null;
  payments: Array<{
    id: string;
    paymentDate: Date | string;
    amount: number;
    paymentReference?: string | null;
    paymentMethod?: string | null;
    notes?: string | null;
  }>;
}

export interface ProjectRevenueRealizationSignal {
  level: "critical" | "warn" | "info";
  title: string;
  detail: string;
}

export interface ProjectRevenueRealizationInvoiceSummary {
  id: string;
  invoiceNumber: string;
  issueDate: string;
  dueDate: string | null;
  amount: number;
  status: ProjectInvoiceStatus;
  notes: string | null;
  paymentCount: number;
  collectedAmount: number;
  outstandingAmount: number;
}

export interface ProjectRevenueRealizationSummary {
  earnedRevenue: number;
  invoicedRevenue: number;
  collectedRevenue: number;
  outstandingRevenue: number;
  uninvoicedEarnedRemainder: number;
  overbillingAdvanceAmount: number;
  overCollectedAmount: number;
  invoiceCount: number;
  paymentCount: number;
  hasInvoices: boolean;
  hasPayments: boolean;
  coverageStatus: "KNOWN" | "PARTIAL";
  coverageNote: string;
  signals: ProjectRevenueRealizationSignal[];
  invoices: ProjectRevenueRealizationInvoiceSummary[];
}

export function buildProjectRevenueRealizationSummary(options: {
  earnedRevenue: number;
  invoices: ProjectRevenueRealizationInvoiceInput[];
}): ProjectRevenueRealizationSummary {
  const earnedRevenue = roundCurrency(safeNumber(options.earnedRevenue));
  const normalizedInvoices = options.invoices.map((invoice) => {
    const status = normalizeInvoiceStatus(invoice.status);
    const amount = roundCurrency(safeNumber(invoice.amount));
    const payments = invoice.payments.map((payment) => ({
      id: payment.id,
      paymentDate: toIsoDate(payment.paymentDate),
      amount: roundCurrency(safeNumber(payment.amount)),
      paymentReference: normalizeText(payment.paymentReference),
      paymentMethod: normalizeText(payment.paymentMethod),
      notes: normalizeText(payment.notes)
    }));
    const collectedAmount = roundCurrency(payments.reduce((sum, payment) => sum + payment.amount, 0));
    const outstandingAmount = status === ProjectInvoiceStatus.VOID ? 0 : roundCurrency(Math.max(0, amount - collectedAmount));

    return {
      id: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      issueDate: toIsoDate(invoice.issueDate),
      dueDate: invoice.dueDate ? toIsoDate(invoice.dueDate) : null,
      amount,
      status,
      notes: normalizeText(invoice.notes),
      paymentCount: payments.length,
      collectedAmount,
      outstandingAmount,
      payments
    };
  });

  const invoiceCount = normalizedInvoices.length;
  const paymentCount = normalizedInvoices.reduce((sum, invoice) => sum + invoice.paymentCount, 0);
  const invoicedRevenue = roundCurrency(
    normalizedInvoices
      .filter((invoice) => invoice.status !== ProjectInvoiceStatus.VOID)
      .reduce((sum, invoice) => sum + invoice.amount, 0)
  );
  const collectedRevenue = roundCurrency(
    normalizedInvoices.reduce((sum, invoice) => sum + invoice.collectedAmount, 0)
  );
  const outstandingRevenue = roundCurrency(Math.max(0, invoicedRevenue - collectedRevenue));
  const uninvoicedEarnedRemainder = roundCurrency(Math.max(0, earnedRevenue - invoicedRevenue));
  const overbillingAdvanceAmount = roundCurrency(Math.max(0, invoicedRevenue - earnedRevenue));
  const overCollectedAmount = roundCurrency(Math.max(0, collectedRevenue - invoicedRevenue));

  const hasInvoices = invoiceCount > 0;
  const hasPayments = paymentCount > 0;

  const hasCoverageGaps =
    !hasInvoices || !hasPayments || outstandingRevenue > 0 || overCollectedAmount > 0;
  const coverageStatus: ProjectRevenueRealizationSummary["coverageStatus"] = hasCoverageGaps
    ? "PARTIAL"
    : "KNOWN";

  let coverageNote =
    "Invoicing and collections coverage is known for this project scope.";
  if (!hasInvoices) {
    coverageNote =
      "No invoice records are captured yet. Earned revenue is available, but billed and collected coverage remains partial.";
  } else if (!hasPayments) {
    coverageNote =
      "Invoices are captured but no payment records are posted yet. Collections coverage remains partial.";
  } else if (overCollectedAmount > 0) {
    coverageNote =
      "Collection records exceed billed value. Revenue realization has an anomaly that needs review.";
  } else if (outstandingRevenue > 0) {
    coverageNote =
      "Collection is partially complete against billed value. Outstanding revenue remains open.";
  }

  const signals: ProjectRevenueRealizationSignal[] = [];
  if (!hasInvoices) {
    signals.push({
      level: "warn",
      title: "No invoice records",
      detail: "Earned revenue exists, but invoiced and collected coverage is not yet captured for this project."
    });
  }

  if (hasInvoices && !hasPayments) {
    signals.push({
      level: "warn",
      title: "No payment records",
      detail: "Invoices are present, but no collections have been posted yet."
    });
  }

  if (overbillingAdvanceAmount > 0) {
    signals.push({
      level: "warn",
      title: "Overbilling / advance billing context",
      detail: `Invoiced revenue exceeds earned revenue by ${formatCurrencyCompact(overbillingAdvanceAmount)}.`
    });
  }

  if (overCollectedAmount > 0) {
    signals.push({
      level: "critical",
      title: "Collection anomaly (over-collected)",
      detail: `Collected revenue exceeds billed value by ${formatCurrencyCompact(overCollectedAmount)}.`
    });
  }

  if (outstandingRevenue > 0) {
    signals.push({
      level: "info",
      title: "Outstanding collections",
      detail: `${formatCurrencyCompact(outstandingRevenue)} remains outstanding against billed revenue.`
    });
  }

  return {
    earnedRevenue,
    invoicedRevenue,
    collectedRevenue,
    outstandingRevenue,
    uninvoicedEarnedRemainder,
    overbillingAdvanceAmount,
    overCollectedAmount,
    invoiceCount,
    paymentCount,
    hasInvoices,
    hasPayments,
    coverageStatus,
    coverageNote,
    signals,
    invoices: normalizedInvoices.map((invoice) => ({
      id: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      issueDate: invoice.issueDate,
      dueDate: invoice.dueDate,
      amount: invoice.amount,
      status: invoice.status,
      notes: invoice.notes,
      paymentCount: invoice.paymentCount,
      collectedAmount: invoice.collectedAmount,
      outstandingAmount: invoice.outstandingAmount
    }))
  };
}

export function deriveInvoiceCollectionStatus(args: {
  invoiceAmount: number;
  totalPaid: number;
  existingStatus?: ProjectInvoiceStatus;
}) {
  if (args.existingStatus === ProjectInvoiceStatus.VOID) {
    return ProjectInvoiceStatus.VOID;
  }
  const invoiceAmount = roundCurrency(safeNumber(args.invoiceAmount));
  const totalPaid = roundCurrency(safeNumber(args.totalPaid));
  if (invoiceAmount <= 0) {
    return ProjectInvoiceStatus.DRAFT;
  }
  if (totalPaid <= 0) {
    return ProjectInvoiceStatus.ISSUED;
  }
  if (totalPaid >= invoiceAmount) {
    return ProjectInvoiceStatus.COLLECTED;
  }
  return ProjectInvoiceStatus.PARTIALLY_COLLECTED;
}

function normalizeInvoiceStatus(value: ProjectInvoiceStatus | string) {
  if (typeof value !== "string") {
    return ProjectInvoiceStatus.DRAFT;
  }
  const upper = value.toUpperCase();
  if (upper in ProjectInvoiceStatus) {
    return ProjectInvoiceStatus[upper as keyof typeof ProjectInvoiceStatus];
  }
  return ProjectInvoiceStatus.DRAFT;
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

function normalizeText(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toIsoDate(value: Date | string) {
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }
  return parsed.toISOString().slice(0, 10);
}

function formatCurrencyCompact(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0
  }).format(value);
}
