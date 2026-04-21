import { parseDateOrNull } from "@/lib/inventory-server";
import type { IntakeCommitPayload } from "./commit-types";

function parseIdOrNull(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 && value !== "all"
    ? value.trim()
    : null;
}

function parseOptionalString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function isHttpUrl(value: string) {
  if (!value) {
    return false;
  }
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function parseReceiptSnapshot(body: IntakeCommitPayload | null) {
  const receipt = body?.receipt;
  const parsedReceiptUrl = parseOptionalString(receipt?.url);
  const parsedVerificationUrl = parseOptionalString(receipt?.verificationUrl);
  const canonicalReceiptUrl = isHttpUrl(parsedVerificationUrl)
    ? parsedVerificationUrl
    : parsedReceiptUrl;

  return {
    intakeDate: parseDateOrNull(typeof receipt?.receiptDate === "string" ? receipt.receiptDate : null) || new Date(),
    receiptUrl: canonicalReceiptUrl,
    receiptFileName: parseOptionalString(receipt?.fileName),
    traReceiptNumber: parseOptionalString(receipt?.traReceiptNumber),
    receiptNumber: parseOptionalString(receipt?.receiptNumber),
    receiptTin: parseOptionalString(receipt?.tin),
    receiptVrn: parseOptionalString(receipt?.vrn),
    serialNumber: parseOptionalString(receipt?.serialNumber),
    verificationCode: parseOptionalString(receipt?.verificationCode),
    verificationUrl: parsedVerificationUrl,
    rawQrValue: parseOptionalString(receipt?.rawQrValue),
    receiptTime: parseOptionalString(receipt?.receiptTime),
    invoiceReference: parseOptionalString(receipt?.invoiceReference),
    paymentMethod: parseOptionalString(receipt?.paymentMethod),
    taxOffice: parseOptionalString(receipt?.taxOffice),
    ocrTextPreview: parseOptionalString(receipt?.ocrTextPreview)
  };
}

export function parseLinkContext(body: IntakeCommitPayload | null) {
  const linkContext = body?.linkContext;
  return {
    clientId: parseIdOrNull(linkContext?.clientId),
    projectId: parseIdOrNull(linkContext?.projectId),
    rigId: parseIdOrNull(linkContext?.rigId),
    maintenanceRequestId: parseIdOrNull(linkContext?.maintenanceRequestId),
    breakdownReportId: parseIdOrNull(linkContext?.breakdownReportId),
    locationFromId: parseIdOrNull(linkContext?.locationFromId),
    locationToId: parseIdOrNull(linkContext?.locationToId)
  };
}

export function parseEntityIdentifiers(body: IntakeCommitPayload | null) {
  return {
    requisitionId: parseIdOrNull(body?.requisitionId),
    submissionId: parseIdOrNull(body?.submissionId)
  };
}

export function applyWorkflowContextReset(args: {
  workflowType: "PROJECT_PURCHASE" | "MAINTENANCE_PURCHASE" | "STOCK_PURCHASE" | "INTERNAL_TRANSFER";
  context: ReturnType<typeof parseLinkContext>;
}) {
  const {
    clientId,
    projectId,
    rigId,
    maintenanceRequestId,
    breakdownReportId,
    locationFromId,
    locationToId
  } = args.context;

  if (args.workflowType === "STOCK_PURCHASE" || args.workflowType === "INTERNAL_TRANSFER") {
    return {
      clientId: null,
      projectId: null,
      rigId: null,
      maintenanceRequestId: null,
      breakdownReportId: null,
      locationFromId,
      locationToId
    };
  }

  if (args.workflowType === "PROJECT_PURCHASE") {
    return {
      clientId,
      projectId,
      rigId,
      maintenanceRequestId: null,
      breakdownReportId: null,
      locationFromId,
      locationToId
    };
  }

  return {
    clientId,
    projectId,
    rigId,
    maintenanceRequestId,
    breakdownReportId,
    locationFromId,
    locationToId
  };
}
