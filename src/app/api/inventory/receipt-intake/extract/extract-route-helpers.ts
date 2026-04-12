import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { debugLog } from "@/lib/observability";
import { prisma } from "@/lib/prisma";
import { buildFallbackExtraction } from "@/app/api/inventory/receipt-intake/extract/extract-fallback";

const acceptedMimeTypes = new Set([
  "application/pdf",
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif"
]);

export function isAcceptedMimeType(file: File) {
  if (!file.type) {
    return true;
  }
  return acceptedMimeTypes.has(file.type.toLowerCase());
}

export function detectUploadKind(file: File): "pdf" | "image" | "unknown" {
  const lowerMime = (file.type || "").toLowerCase();
  const lowerName = (file.name || "").toLowerCase();
  if (lowerMime.includes("pdf") || lowerName.endsWith(".pdf")) {
    return "pdf";
  }
  if (lowerMime.startsWith("image/")) {
    return "image";
  }
  return "unknown";
}

export function logRouteStage(stage: string, extra?: Record<string, unknown>) {
  debugLog(
    "[inventory][receipt-intake][route]",
    {
      stage,
      ...(extra || {})
    },
    { channel: "inventory-receipt" }
  );
}

export function logLookupStagesFromQr(qrValue: Record<string, unknown>) {
  const stages =
    qrValue.stages && typeof qrValue.stages === "object" ? (qrValue.stages as Record<string, unknown>) : null;
  const lookup =
    stages?.verificationLookup && typeof stages.verificationLookup === "object"
      ? (stages.verificationLookup as Record<string, unknown>)
      : null;
  if (!lookup) {
    return;
  }

  const attempted = Boolean(lookup.attempted);
  if (!attempted) {
    return;
  }

  logRouteStage("tra_lookup_started");
  const status = typeof lookup.status === "string" ? lookup.status : "UNKNOWN";
  if (status === "SUCCESS") {
    logRouteStage("tra_lookup_succeeded");
  } else {
    logRouteStage("tra_lookup_failed", {
      reason: typeof lookup.reason === "string" ? lookup.reason : "Unknown"
    });
  }
}

export function apiError(status: number, message: string) {
  return NextResponse.json(
    {
      success: false,
      error: message,
      message
    },
    { status }
  );
}

export function isDebugRequested(value: FormDataEntryValue | null) {
  if (typeof value !== "string") {
    return false;
  }
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

export function parseQrAssistCrop(entry: FormDataEntryValue | null) {
  if (typeof entry !== "string" || !entry.trim()) {
    return null;
  }

  try {
    const parsed = JSON.parse(entry) as unknown;
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    const candidate = parsed as Record<string, unknown>;
    const x = Number(candidate.x);
    const y = Number(candidate.y);
    const width = Number(candidate.width);
    const height = Number(candidate.height);
    if (![x, y, width, height].every(Number.isFinite)) {
      return null;
    }
    if (width <= 0 || height <= 0) {
      return null;
    }
    return {
      x,
      y,
      width,
      height
    };
  } catch {
    return null;
  }
}

export function isExtractionResult(value: unknown): value is {
  header: Record<string, unknown>;
  fieldConfidence: Record<string, unknown>;
  fieldSource: Record<string, unknown>;
  lines: unknown[];
  warnings: unknown[];
  rawTextPreview: string;
  extractionMethod: string;
  scanStatus: string;
  receiptType: string;
  preprocessingApplied: string[];
  qr: Record<string, unknown>;
} {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    Boolean(candidate.header && typeof candidate.header === "object") &&
    Boolean(candidate.fieldConfidence && typeof candidate.fieldConfidence === "object") &&
    Boolean(candidate.fieldSource && typeof candidate.fieldSource === "object") &&
    Array.isArray(candidate.lines) &&
    Array.isArray(candidate.warnings) &&
    typeof candidate.rawTextPreview === "string" &&
    typeof candidate.extractionMethod === "string" &&
    typeof candidate.scanStatus === "string" &&
    typeof candidate.receiptType === "string" &&
    Array.isArray(candidate.preprocessingApplied) &&
    Boolean(candidate.qr && typeof candidate.qr === "object")
  );
}

export function hydrateSupplierInExtraction(extraction: {
  header: Record<string, unknown>;
  fieldConfidence: Record<string, unknown>;
  fieldSource: Record<string, unknown>;
  qr: Record<string, unknown>;
}) {
  const header = extraction.header || {};
  const qr = extraction.qr || {};
  const qrParsedFields =
    qr.parsedFields && typeof qr.parsedFields === "object" ? (qr.parsedFields as Record<string, unknown>) : null;

  const headerSupplierBefore = normalizeSupplierValue(
    typeof header.supplierName === "string" ? header.supplierName : typeof header.supplier === "string" ? header.supplier : ""
  );
  const parsedSupplierRaw = normalizeSupplierValue(
    qrParsedFields
      ? typeof qrParsedFields.supplierName === "string"
        ? qrParsedFields.supplierName
        : typeof qrParsedFields.supplier === "string"
          ? qrParsedFields.supplier
          : ""
      : ""
  );

  const resolvedSupplier =
    parsedSupplierRaw || headerSupplierBefore || normalizeSupplierValue(typeof header.supplierName === "string" ? header.supplierName : "");

  if (resolvedSupplier) {
    header.supplierName = resolvedSupplier;
    const currentConfidence =
      typeof extraction.fieldConfidence?.supplierName === "string" ? extraction.fieldConfidence.supplierName : "";
    if (!currentConfidence || currentConfidence === "UNREADABLE" || currentConfidence === "LOW") {
      extraction.fieldConfidence.supplierName = parsedSupplierRaw ? "HIGH" : "MEDIUM";
    }
    const currentSource =
      typeof extraction.fieldSource?.supplierName === "string" ? extraction.fieldSource.supplierName : "";
    if (!currentSource || currentSource === "NONE") {
      extraction.fieldSource.supplierName = parsedSupplierRaw ? "QR" : "OCR";
    }
  }

  return {
    parsedSupplierRaw,
    headerSupplierBefore,
    headerSupplierAfter: resolvedSupplier,
    source: parsedSupplierRaw ? "TRA_PARSED" : headerSupplierBefore ? "HEADER" : "NONE"
  };
}

function normalizeSupplierValue(value: string) {
  return value
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

export function isQrExtractionResult(value: unknown): value is {
  detected: boolean;
  rawValue: string;
  contentType: string;
  decodeStatus: string;
  decodePass: string;
  parseStatus: string;
  failureReason: string;
  verificationUrl: string;
  isTraVerification: boolean;
  stages: Record<string, unknown>;
} {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.detected === "boolean" &&
    typeof candidate.rawValue === "string" &&
    typeof candidate.contentType === "string" &&
    typeof candidate.decodeStatus === "string" &&
    typeof candidate.decodePass === "string" &&
    typeof candidate.parseStatus === "string" &&
    typeof candidate.failureReason === "string" &&
    typeof candidate.verificationUrl === "string" &&
    typeof candidate.isTraVerification === "boolean" &&
    Boolean(candidate.stages && typeof candidate.stages === "object")
  );
}

export function logQrDebugInfo(qrValue: Record<string, unknown>) {
  const rawQrContent = typeof qrValue.rawValue === "string" ? qrValue.rawValue : "";
  const detectedType = typeof qrValue.contentType === "string" ? qrValue.contentType : "UNKNOWN";
  const detected = Boolean(qrValue.detected);
  const decodeStatus = typeof qrValue.decodeStatus === "string" ? qrValue.decodeStatus : "UNKNOWN";
  const decodeSucceeded = decodeStatus === "DECODED";
  const rawPreview = truncateLogValue(rawQrContent, 200);
  debugLog(
    "[inventory][receipt-intake][qr-raw-debug]",
    {
      detected,
      decodeSucceeded,
      rawLength: rawQrContent.length,
      rawPreview
    },
    { channel: "inventory-receipt" }
  );
  debugLog(
    "[inventory][receipt-intake][qr]",
    {
      detected,
      type: detectedType,
      decodeStatus,
      decodePass: typeof qrValue.decodePass === "string" ? qrValue.decodePass : "",
      parseStatus: typeof qrValue.parseStatus === "string" ? qrValue.parseStatus : "UNKNOWN",
      failureReason: typeof qrValue.failureReason === "string" ? qrValue.failureReason : "",
      lookupStatus:
        qrValue.stages &&
        typeof qrValue.stages === "object" &&
        (qrValue.stages as Record<string, unknown>).verificationLookup &&
        typeof (qrValue.stages as Record<string, unknown>).verificationLookup === "object" &&
        typeof ((qrValue.stages as Record<string, unknown>).verificationLookup as Record<string, unknown>).status === "string"
          ? (((qrValue.stages as Record<string, unknown>).verificationLookup as Record<string, unknown>).status as string)
          : "UNKNOWN",
      rawQrContent: truncateLogValue(rawQrContent),
      isTraVerification: Boolean(qrValue.isTraVerification)
    },
    { channel: "inventory-receipt" }
  );
}

export function truncateLogValue(value: string, maxLength = 500) {
  if (!value) {
    return "";
  }
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength - 3)}...`;
}

export function resolveReceiptIntakeMessage(extraction: { scanStatus?: unknown; qr?: unknown; intakeDebug?: unknown }) {
  const qr = extraction.qr && typeof extraction.qr === "object" ? (extraction.qr as Record<string, unknown>) : null;
  const intakeDebug =
    extraction.intakeDebug && typeof extraction.intakeDebug === "object"
      ? (extraction.intakeDebug as Record<string, unknown>)
      : null;
  const decodeStatus = typeof qr?.decodeStatus === "string" ? qr.decodeStatus : "";
  const parseStatus = typeof qr?.parseStatus === "string" ? qr.parseStatus : "";
  const stages = qr?.stages && typeof qr.stages === "object" ? (qr.stages as Record<string, unknown>) : null;
  const verificationLookup =
    stages?.verificationLookup && typeof stages.verificationLookup === "object"
      ? (stages.verificationLookup as Record<string, unknown>)
      : null;
  const lookupStatus = typeof verificationLookup?.status === "string" ? verificationLookup.status : "";
  const lookupSuccess = Boolean(verificationLookup?.success);
  const scanStatus = typeof extraction.scanStatus === "string" ? extraction.scanStatus : "";
  const traParseSucceeded = Boolean(intakeDebug?.traParseSucceeded);
  const ocrAttempted = Boolean(intakeDebug?.ocrAttempted);
  const ocrSucceeded = Boolean(intakeDebug?.ocrSucceeded);
  if (traParseSucceeded && ocrAttempted && !ocrSucceeded) {
    return "Captured from QR/TRA. Core receipt data is ready; some optional details may need review.";
  }
  if (decodeStatus === "NOT_DETECTED") {
    return scanStatus === "COMPLETE" || scanStatus === "PARTIAL"
      ? "QR was not detected automatically. OCR/manual assist was used."
      : "QR was not detected automatically.";
  }
  if (decodeStatus === "DECODE_FAILED") {
    return scanStatus === "COMPLETE" || scanStatus === "PARTIAL"
      ? "QR was detected but needs review. OCR/manual assist was used."
      : "QR was detected but needs review.";
  }
  if (decodeStatus === "DECODED" && parseStatus === "UNPARSED") {
    return "QR captured. Structured parsing needs review.";
  }
  if (decodeStatus === "DECODED" && lookupStatus === "FAILED") {
    return "QR captured. TRA lookup returned limited data and may need review.";
  }
  if (decodeStatus === "DECODED" && lookupStatus === "SUCCESS" && !lookupSuccess) {
    return "QR captured. TRA lookup returned partial data for review.";
  }
  if (scanStatus === "COMPLETE") {
    return "Captured from QR/TRA. Ready for review.";
  }
  if (scanStatus === "PARTIAL") {
    return "Receipt captured with partial data. Review recommended before saving.";
  }
  return "Receipt capture needs review. You can continue manually or retry with a clearer image.";
}

export function readDebugFlagsFromExtraction(extraction: Record<string, unknown>) {
  const qr = extraction.qr && typeof extraction.qr === "object" ? (extraction.qr as Record<string, unknown>) : null;
  const stages = qr?.stages && typeof qr.stages === "object" ? (qr.stages as Record<string, unknown>) : null;
  const lookup =
    stages?.verificationLookup && typeof stages.verificationLookup === "object"
      ? (stages.verificationLookup as Record<string, unknown>)
      : null;
  const intakeDebug =
    extraction.intakeDebug && typeof extraction.intakeDebug === "object"
      ? (extraction.intakeDebug as Record<string, unknown>)
      : null;

  const qrDecoded =
    typeof intakeDebug?.qrDecoded === "boolean"
      ? intakeDebug.qrDecoded
      : typeof qr?.decodeStatus === "string" && qr.decodeStatus === "DECODED";
  const traLookupSucceeded =
    typeof intakeDebug?.traLookupSucceeded === "boolean"
      ? intakeDebug.traLookupSucceeded
      : Boolean(lookup?.attempted) && typeof lookup?.status === "string" && lookup.status === "SUCCESS";
  const traParseSucceeded =
    typeof intakeDebug?.traParseSucceeded === "boolean"
      ? intakeDebug.traParseSucceeded
      : traLookupSucceeded && Boolean(lookup?.parsed);
  const ocrAttempted = typeof intakeDebug?.ocrAttempted === "boolean" ? intakeDebug.ocrAttempted : false;
  const ocrSucceeded = typeof intakeDebug?.ocrSucceeded === "boolean" ? intakeDebug.ocrSucceeded : false;
  const ocrError = typeof intakeDebug?.ocrError === "string" ? intakeDebug.ocrError : "";
  const enrichmentWarning = typeof intakeDebug?.enrichmentWarning === "string" ? intakeDebug.enrichmentWarning : "";
  const returnedFromRaw = typeof intakeDebug?.returnedFrom === "string" ? intakeDebug.returnedFrom : "";
  const returnedFrom = returnedFromRaw === "qr_tra_plus_ocr" ? "qr_tra_plus_ocr" : "qr_tra";

  return {
    qrDecoded,
    traLookupSucceeded,
    traParseSucceeded,
    ocrAttempted,
    ocrSucceeded,
    ocrError,
    enrichmentWarning,
    returnedFrom,
    partialEnrichment: traParseSucceeded && ocrAttempted && !ocrSucceeded
  };
}

export function readScanDiagnosticsFromExtraction(extraction: Record<string, unknown>) {
  const qr = extraction.qr && typeof extraction.qr === "object" ? (extraction.qr as Record<string, unknown>) : null;
  const stages = qr?.stages && typeof qr.stages === "object" ? (qr.stages as Record<string, unknown>) : null;
  const lookup =
    stages?.verificationLookup && typeof stages.verificationLookup === "object"
      ? (stages.verificationLookup as Record<string, unknown>)
      : null;
  const intakeDebug =
    extraction.intakeDebug && typeof extraction.intakeDebug === "object"
      ? (extraction.intakeDebug as Record<string, unknown>)
      : null;
  const scanDiagnostics =
    extraction.scanDiagnostics && typeof extraction.scanDiagnostics === "object"
      ? (extraction.scanDiagnostics as Record<string, unknown>)
      : null;

  const qrParsedFields =
    qr?.parsedFields && typeof qr.parsedFields === "object" ? (qr.parsedFields as Record<string, unknown>) : null;
  const parsedFieldCount =
    typeof scanDiagnostics?.qrParsedFieldCount === "number"
      ? scanDiagnostics.qrParsedFieldCount
      : countPopulatedFields(qrParsedFields);
  const parsedLineItemsCount =
    typeof scanDiagnostics?.qrParsedLineItemsCount === "number"
      ? scanDiagnostics.qrParsedLineItemsCount
      : Array.isArray(qr?.parsedLineCandidates)
        ? qr.parsedLineCandidates.length
        : 0;

  const decodeStatus = typeof qr?.decodeStatus === "string" ? qr.decodeStatus : "NOT_DETECTED";
  const parseStatus = typeof qr?.parseStatus === "string" ? qr.parseStatus : "UNPARSED";
  const lookupStatus = typeof lookup?.status === "string" ? lookup.status : "NOT_ATTEMPTED";
  const failureStageRaw =
    typeof scanDiagnostics?.failureStage === "string" ? scanDiagnostics.failureStage : resolveQrFailureStageFromRoute({
      decodeStatus,
      parseStatus,
      lookupStatus
    });

  return {
    qrDetected:
      typeof scanDiagnostics?.qrDetected === "boolean"
        ? scanDiagnostics.qrDetected
        : Boolean(qr?.detected),
    qrDecodeStatus: decodeStatus,
    qrDecodePass: typeof qr?.decodePass === "string" ? qr.decodePass : "",
    qrParseStatus: parseStatus,
    qrFailureReason: typeof qr?.failureReason === "string" ? qr.failureReason : "",
    qrContentType: typeof qr?.contentType === "string" ? qr.contentType : "NONE",
    qrRawValue: typeof qr?.rawValue === "string" ? qr.rawValue : "",
    qrNormalizedRawValue:
      typeof qr?.normalizedRawValue === "string" ? qr.normalizedRawValue : typeof qr?.rawValue === "string" ? qr.rawValue : "",
    qrRawLength:
      typeof scanDiagnostics?.qrRawLength === "number"
        ? scanDiagnostics.qrRawLength
        : typeof qr?.rawValue === "string"
          ? qr.rawValue.length
          : 0,
    qrRawPreview:
      typeof scanDiagnostics?.qrRawPreview === "string"
        ? scanDiagnostics.qrRawPreview
        : truncateLogValue(typeof qr?.rawValue === "string" ? qr.rawValue : "", 200),
    qrRawPayloadFormat:
      typeof scanDiagnostics?.qrRawPayloadFormat === "string" ? scanDiagnostics.qrRawPayloadFormat : "EMPTY",
    qrVerificationUrl: typeof qr?.verificationUrl === "string" ? qr.verificationUrl : "",
    qrIsTraVerification: Boolean(qr?.isTraVerification),
    qrParsedFieldCount: parsedFieldCount,
    qrParsedLineItemsCount: parsedLineItemsCount,
    qrLookupStatus: lookupStatus,
    qrLookupReason: typeof lookup?.reason === "string" ? lookup.reason : "",
    qrLookupHttpStatus: typeof lookup?.httpStatus === "number" ? lookup.httpStatus : null,
    qrLookupParsed: Boolean(lookup?.parsed),
    ocrAttempted:
      typeof scanDiagnostics?.ocrAttempted === "boolean"
        ? scanDiagnostics.ocrAttempted
        : Boolean(intakeDebug?.ocrAttempted),
    ocrSucceeded:
      typeof scanDiagnostics?.ocrSucceeded === "boolean"
        ? scanDiagnostics.ocrSucceeded
        : Boolean(intakeDebug?.ocrSucceeded),
    ocrError:
      typeof scanDiagnostics?.ocrError === "string"
        ? scanDiagnostics.ocrError
        : typeof intakeDebug?.ocrError === "string"
          ? intakeDebug.ocrError
          : "",
    scanStatus: typeof extraction.scanStatus === "string" ? extraction.scanStatus : "UNREADABLE",
    extractionMethod: typeof extraction.extractionMethod === "string" ? extraction.extractionMethod : "UNKNOWN",
    returnedFrom:
      typeof scanDiagnostics?.returnedFrom === "string"
        ? scanDiagnostics.returnedFrom
        : typeof intakeDebug?.returnedFrom === "string"
          ? intakeDebug.returnedFrom
          : "qr_tra",
    failureStage: failureStageRaw
  };
}

function resolveQrFailureStageFromRoute({
  decodeStatus,
  parseStatus,
  lookupStatus
}: {
  decodeStatus: string;
  parseStatus: string;
  lookupStatus: string;
}) {
  if (decodeStatus === "NOT_DETECTED") {
    return "QR_NOT_DETECTED";
  }
  if (decodeStatus === "DECODE_FAILED") {
    return "QR_DECODE_FAILED";
  }
  if (decodeStatus === "DECODED" && parseStatus === "UNPARSED") {
    return "QR_PARSE_UNPARSED";
  }
  if (decodeStatus === "DECODED" && lookupStatus === "FAILED") {
    return "TRA_LOOKUP_FAILED";
  }
  return "NONE";
}

function countPopulatedFields(value: Record<string, unknown> | null) {
  if (!value) {
    return 0;
  }
  let count = 0;
  Object.values(value).forEach((entry) => {
    if (typeof entry === "string" && entry.trim()) {
      count += 1;
      return;
    }
    if (typeof entry === "number" && Number.isFinite(entry) && entry > 0) {
      count += 1;
    }
  });
  return count;
}

export function buildSafeFailureResponse({
  savedFile,
  message,
  debugMode,
  error,
  stage = "extract_failed"
}: {
  savedFile: { receiptUrl: string; receiptFileName: string } | null;
  message: string;
  debugMode: boolean;
  error: unknown;
  stage?: string;
}) {
  const fallbackExtraction = buildFallbackExtraction();
  const scanDiagnostics = readScanDiagnosticsFromExtraction(fallbackExtraction as unknown as Record<string, unknown>);
  return {
    success: false,
    stage,
    message,
    error: "Receipt processing needs review",
    receipt: savedFile
      ? {
          url: savedFile.receiptUrl,
          fileName: savedFile.receiptFileName
        }
      : null,
    extracted: fallbackExtraction,
    supplierSuggestion: {
      supplierId: null,
      supplierName: "",
      confidence: "NONE",
      score: 0
    },
    supplierName: "",
    supplierConfidence: "UNREADABLE",
    supplierSource: "NONE",
    debugFlags: {
      qrDecoded: false,
      traLookupSucceeded: false,
      traParseSucceeded: false,
      ocrAttempted: false,
      ocrSucceeded: false,
      ocrError: "",
      enrichmentWarning: "",
      returnedFrom: "qr_tra",
      partialEnrichment: false
    },
    scanDiagnostics,
    partialEnrichment: false,
    debug: debugMode
      ? {
          reason: formatErrorForDebug(error)
        }
      : undefined
  };
}

export function logExtractError(file: string, step: string, error: unknown) {
  if (error instanceof Error) {
    console.error("[inventory][receipt-intake][extract] failure", {
      file,
      step,
      message: error.message,
      stack: error.stack
    });
    return;
  }
  console.error("[inventory][receipt-intake][extract] failure", {
    file,
    step,
    message: String(error)
  });
}

function formatErrorForDebug(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message
    };
  }
  return {
    name: "UnknownError",
    message: String(error)
  };
}

export async function saveReceiptFile(receipt: File) {
  const uploadsDir = path.join(process.cwd(), "public", "uploads", "inventory-receipts");
  await mkdir(uploadsDir, { recursive: true });
  const extension = receipt.name.includes(".") ? receipt.name.split(".").pop() : "bin";
  const safeFileName = `${Date.now()}-${randomUUID()}.${extension}`;
  const absoluteFilePath = path.join(uploadsDir, safeFileName);
  const arrayBuffer = await receipt.arrayBuffer();
  await writeFile(absoluteFilePath, Buffer.from(arrayBuffer));

  return {
    receiptUrl: `/uploads/inventory-receipts/${safeFileName}`,
    receiptFileName: receipt.name
  };
}

export async function suggestSupplier({
  extractedSupplierName,
  extractedTin,
  suppliers
}: {
  extractedSupplierName: string;
  extractedTin: string;
  suppliers: Array<{ id: string; name: string }>;
}) {
  const normalizedTin = extractedTin.replace(/[^0-9]/g, "");
  if (normalizedTin.length >= 8) {
    const supplierFromTin = await resolveSupplierByTinSignal(normalizedTin);
    if (supplierFromTin) {
      return {
        supplierId: supplierFromTin.id,
        supplierName: supplierFromTin.name,
        confidence: "HIGH" as const,
        score: 1
      };
    }
  }

  const normalized = normalize(extractedSupplierName);
  if (!normalized) {
    return {
      supplierId: null,
      supplierName: "",
      confidence: "NONE" as const,
      score: 0
    };
  }

  let best: { id: string; name: string; score: number } | null = null;
  for (const supplier of suppliers) {
    const score = similarityScore(normalized, normalize(supplier.name));
    if (!best || score > best.score) {
      best = {
        id: supplier.id,
        name: supplier.name,
        score
      };
    }
  }

  if (!best || best.score < 0.35) {
    return {
      supplierId: null,
      supplierName: extractedSupplierName,
      confidence: "LOW" as const,
      score: best ? round(best.score) : 0
    };
  }

  return {
    supplierId: best.id,
    supplierName: best.name,
    confidence: best.score >= 0.78 ? ("HIGH" as const) : best.score >= 0.55 ? ("MEDIUM" as const) : ("LOW" as const),
    score: round(best.score)
  };
}

async function resolveSupplierByTinSignal(tin: string) {
  const movements = await prisma.inventoryMovement.findMany({
    where: {
      supplierId: { not: null },
      notes: {
        contains: "TIN:"
      }
    },
    select: {
      supplierId: true,
      notes: true
    },
    orderBy: {
      date: "desc"
    },
    take: 1200
  });

  const scoredSupplierIds = new Map<string, number>();
  for (const movement of movements) {
    const supplierId = movement.supplierId;
    if (!supplierId || !movement.notes) {
      continue;
    }
    const tinMatch = movement.notes.match(/\bTIN:\s*([0-9]{8,15})\b/i);
    const noteTin = tinMatch?.[1] || "";
    if (!noteTin) {
      continue;
    }
    if (noteTin === tin) {
      scoredSupplierIds.set(supplierId, (scoredSupplierIds.get(supplierId) || 0) + 1);
    }
  }

  if (scoredSupplierIds.size === 0) {
    return null;
  }

  const winner = [...scoredSupplierIds.entries()].sort((a, b) => b[1] - a[1])[0];
  if (!winner) {
    return null;
  }

  return prisma.inventorySupplier.findUnique({
    where: { id: winner[0] },
    select: { id: true, name: true }
  });
}

function normalize(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function similarityScore(a: string, b: string) {
  if (!a || !b) {
    return 0;
  }
  if (a === b) {
    return 1;
  }
  const aTokens = new Set(a.split(" "));
  const bTokens = new Set(b.split(" "));
  let intersection = 0;
  for (const token of aTokens) {
    if (bTokens.has(token)) {
      intersection += 1;
    }
  }
  const union = new Set([...aTokens, ...bTokens]).size;
  return union === 0 ? 0 : intersection / union;
}

function round(value: number) {
  return Math.round(value * 100) / 100;
}
