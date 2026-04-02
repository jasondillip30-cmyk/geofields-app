import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import { requireApiPermission } from "@/lib/auth/api-guard";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const acceptedMimeTypes = new Set([
  "application/pdf",
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif"
]);

export async function POST(request: NextRequest) {
  let savedFile: { receiptUrl: string; receiptFileName: string } | null = null;
  const routeLabel = "src/app/api/inventory/receipt-intake/extract/route.ts";
  logRouteStage("request_started");
  logRouteStage("route_loaded");
  try {
    const auth = await requireApiPermission(request, "inventory:view");
    if (!auth.ok) {
      const status = auth.response.status;
      const message = status === 401 ? "Unauthorized" : "Forbidden";
      return apiError(status, message);
    }

    const formData = await request.formData();
    const debugMode = process.env.NODE_ENV !== "production" && isDebugRequested(formData.get("debug"));
    const decodeOnlyMode = isDebugRequested(formData.get("decodeOnly"));
    const qrAssistCrop = parseQrAssistCrop(formData.get("qrCrop"));
    const receiptFileEntry = formData.get("receipt");
    if (!(receiptFileEntry instanceof File)) {
      return apiError(400, "Receipt file is required.");
    }
    if (receiptFileEntry.size <= 0) {
      return apiError(400, "Receipt file is empty.");
    }
    if (!isAcceptedMimeType(receiptFileEntry)) {
      return apiError(415, "Unsupported file type. Please upload a PDF or image receipt.");
    }

    const uploadKind = detectUploadKind(receiptFileEntry);
    const isPdfUpload = uploadKind === "pdf";
    const isImageUpload = uploadKind === "image";
    logRouteStage("file_type_detected", {
      mimeType: receiptFileEntry.type || "unknown",
      uploadKind
    });
    logRouteStage(isPdfUpload ? "pdf_branch_entered" : "image_branch_entered");

    savedFile = await saveReceiptFile(receiptFileEntry);
    const fileBuffer = Buffer.from(await receiptFileEntry.arrayBuffer());
    logRouteStage("file_loaded", {
      bytes: receiptFileEntry.size
    });

    const extractionModule = await import("@/lib/inventory-receipt-intake").catch((error) => {
      logExtractError(routeLabel, "module_import", error);
      return null;
    });
    const extractFn =
      extractionModule && typeof extractionModule === "object" && "extractReceiptData" in extractionModule
        ? extractionModule.extractReceiptData
        : null;
    const extractQrOnlyFn =
      extractionModule && typeof extractionModule === "object" && "extractQrDataOnly" in extractionModule
        ? extractionModule.extractQrDataOnly
        : null;

    if (!extractionModule) {
      const stage = isPdfUpload ? "pdf_module_error" : "module_import_error";
      return NextResponse.json(
        buildSafeFailureResponse({
          savedFile,
          message: "Unable to extract receipt data",
          debugMode,
          error: "Extraction module is unavailable.",
          stage
        })
      );
    }

    if (decodeOnlyMode) {
      if (!isImageUpload) {
        return NextResponse.json(
          buildSafeFailureResponse({
            savedFile,
            message: "Decode-only mode supports image uploads only.",
            debugMode,
            error: "PDF decode-only mode is not supported.",
            stage: "decode_only_image_required"
          })
        );
      }

      if (typeof extractQrOnlyFn !== "function") {
        return NextResponse.json(
          buildSafeFailureResponse({
            savedFile,
            message: "Unable to extract receipt data",
            debugMode,
            error: "QR-only decode module is unavailable.",
            stage: "module_import_error"
          })
        );
      }

      logRouteStage("qr_decode_started", { mode: "decode-only", uploadKind });
      const qrOnly = await extractQrOnlyFn({
        fileBuffer,
        mimeType: receiptFileEntry.type,
        qrAssistCrop
      }).catch((error: unknown) => {
        logExtractError(routeLabel, "extract_qr_only", error);
        return null;
      });

      if (!isQrExtractionResult(qrOnly)) {
        return NextResponse.json(
          buildSafeFailureResponse({
            savedFile,
            message: "Unable to extract receipt data",
            debugMode,
            error: "QR-only extraction returned invalid payload.",
            stage: "decode_failed"
          })
        );
      }

      logQrDebugInfo(qrOnly as unknown as Record<string, unknown>);
      logRouteStage("qr_decoded", {
        decodeStatus: qrOnly.decodeStatus,
        contentType: qrOnly.contentType
      });
      logLookupStagesFromQr(qrOnly as unknown as Record<string, unknown>);
      logRouteStage("final_response_sent", {
        mode: "decode-only",
        success: qrOnly.decodeStatus === "DECODED"
      });
      return NextResponse.json({
        success: qrOnly.decodeStatus === "DECODED",
        message:
          qrOnly.decodeStatus === "DECODED"
            ? "QR captured successfully."
            : qrOnly.decodeStatus === "DECODE_FAILED"
              ? "QR detected but needs review."
              : "QR was not detected automatically.",
        stage: qrOnly.decodeStatus === "DECODED" ? "decoded" : "decode_failed",
        receipt: {
          url: savedFile.receiptUrl,
          fileName: savedFile.receiptFileName,
          mimeType: receiptFileEntry.type,
          size: receiptFileEntry.size
        },
        qrDecode: {
          success: qrOnly.decodeStatus === "DECODED",
          raw: qrOnly.rawValue,
          normalizedRaw: qrOnly.normalizedRawValue,
          rawLength: typeof qrOnly.rawValue === "string" ? qrOnly.rawValue.length : 0,
          rawPreview: truncateLogValue(typeof qrOnly.rawValue === "string" ? qrOnly.rawValue : "", 200),
          type: qrOnly.contentType,
          decodeStatus: qrOnly.decodeStatus,
          decodePass: qrOnly.decodePass,
          parseStatus: qrOnly.parseStatus,
          verificationUrl: qrOnly.verificationUrl,
          isTraVerification: qrOnly.isTraVerification,
          failureReason: qrOnly.failureReason,
          stages: qrOnly.stages
        }
      });
    }

    if (typeof extractFn !== "function") {
      return NextResponse.json(
        buildSafeFailureResponse({
          savedFile,
          message: "Unable to extract receipt data",
          debugMode,
          error: "Extraction module is unavailable.",
          stage: isPdfUpload ? "pdf_module_error" : "module_import_error"
        })
      );
    }

    logRouteStage("qr_decode_started", { mode: "full", uploadKind });

    const [inventoryItems, suppliers] = await Promise.all([
      prisma.inventoryItem.findMany({
        select: {
          id: true,
          name: true,
          sku: true,
          category: true
        }
      }),
      prisma.inventorySupplier.findMany({
        select: {
          id: true,
          name: true
        }
      })
    ]);

    const extraction = await extractFn({
      fileBuffer,
      mimeType: receiptFileEntry.type,
      fileName: receiptFileEntry.name,
      inventoryItems,
      qrAssistCrop,
      debug: debugMode
    }).catch((error: unknown) => {
      logExtractError(routeLabel, "extract_receipt_data", error);
      return null;
    });
    if (!isExtractionResult(extraction)) {
      return NextResponse.json(
        buildSafeFailureResponse({
          savedFile,
          message: "Unable to extract receipt data",
          debugMode,
          error: "Extraction returned invalid payload.",
          stage: isPdfUpload ? "pdf_extract_error" : "extract_error"
        })
      );
    }

    const hydratedSupplier = hydrateSupplierInExtraction(extraction);

    logQrDebugInfo(extraction.qr);
    logRouteStage("qr_decoded", {
      decodeStatus: typeof extraction.qr.decodeStatus === "string" ? extraction.qr.decodeStatus : "UNKNOWN",
      contentType: typeof extraction.qr.contentType === "string" ? extraction.qr.contentType : "UNKNOWN"
    });
    logLookupStagesFromQr(extraction.qr);
    if (process.env.NODE_ENV !== "production") {
      console.info("[inventory][receipt-intake][supplier-mapping]", {
        parsedSupplierRaw: hydratedSupplier.parsedSupplierRaw,
        headerSupplierBefore: hydratedSupplier.headerSupplierBefore,
        headerSupplierAfter: hydratedSupplier.headerSupplierAfter,
        source: hydratedSupplier.source
      });
    }

    const message = resolveReceiptIntakeMessage(extraction);
    const debugFlags = readDebugFlagsFromExtraction(extraction as unknown as Record<string, unknown>);
    const scanDiagnostics = readScanDiagnosticsFromExtraction(extraction as unknown as Record<string, unknown>);

    const supplierSuggestion = await suggestSupplier({
      extractedSupplierName: hydratedSupplier.headerSupplierAfter,
      extractedTin: typeof extraction.header?.tin === "string" ? extraction.header.tin : "",
      suppliers
    });
    if (process.env.NODE_ENV !== "production") {
      console.info("[inventory][receipt-intake][supplier-mapping][payload]", {
        payloadSupplier: hydratedSupplier.headerSupplierAfter,
        suggestedSupplierId: supplierSuggestion.supplierId,
        suggestedSupplierName: supplierSuggestion.supplierName
      });
    }

    const hasPdfModuleError =
      isPdfUpload &&
      Array.isArray(extraction.warnings) &&
      extraction.warnings.some(
        (warning) => typeof warning === "string" && warning.includes("[PDF_MODULE_ERROR]")
      );
    if (hasPdfModuleError) {
      logRouteStage("final_response_sent", {
        mode: "full",
        success: false,
        stage: "pdf_module_error"
      });
      return NextResponse.json({
        success: false,
        stage: "pdf_module_error",
        message: "Unable to process PDF receipt automatically. Please try an image export or continue manually.",
        receipt: {
          url: savedFile.receiptUrl,
          fileName: savedFile.receiptFileName,
          mimeType: receiptFileEntry.type,
          size: receiptFileEntry.size
        },
        extracted: extraction,
        supplierSuggestion,
        debugFlags,
        scanDiagnostics,
        partialEnrichment: debugFlags.partialEnrichment,
        supplierName: typeof extraction.header?.supplierName === "string" ? extraction.header.supplierName : "",
        supplierConfidence:
          typeof extraction.fieldConfidence?.supplierName === "string"
            ? extraction.fieldConfidence.supplierName
            : "UNREADABLE",
        supplierSource:
          typeof extraction.fieldSource?.supplierName === "string" ? extraction.fieldSource.supplierName : "NONE"
      });
    }

    logRouteStage("final_response_sent", {
      mode: "full",
      success: true
    });
    return NextResponse.json({
      success: true,
      message,
      receipt: {
        url: savedFile.receiptUrl,
        fileName: savedFile.receiptFileName,
        mimeType: receiptFileEntry.type,
        size: receiptFileEntry.size
      },
      extracted: extraction,
      supplierSuggestion,
      debugFlags,
      scanDiagnostics,
      partialEnrichment: debugFlags.partialEnrichment,
      supplierName: typeof extraction.header?.supplierName === "string" ? extraction.header.supplierName : "",
      supplierConfidence:
        typeof extraction.fieldConfidence?.supplierName === "string"
          ? extraction.fieldConfidence.supplierName
          : "UNREADABLE",
      supplierSource: typeof extraction.fieldSource?.supplierName === "string" ? extraction.fieldSource.supplierName : "NONE"
    });
  } catch (error) {
    logExtractError(routeLabel, "route_handler", error);
    logRouteStage("final_response_sent", {
      mode: "full",
      success: false,
      stage: "route_handler_error"
    });
    return NextResponse.json(
      buildSafeFailureResponse({
        savedFile,
        message: "Unable to extract receipt data",
        debugMode: process.env.NODE_ENV !== "production",
        error
      })
    );
  }
}

function isAcceptedMimeType(file: File) {
  if (!file.type) {
    return true;
  }
  return acceptedMimeTypes.has(file.type.toLowerCase());
}

function detectUploadKind(file: File): "pdf" | "image" | "unknown" {
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

function logRouteStage(stage: string, extra?: Record<string, unknown>) {
  if (process.env.NODE_ENV === "production") {
    return;
  }
  console.info("[inventory][receipt-intake][route]", {
    stage,
    ...(extra || {})
  });
}

function logLookupStagesFromQr(qrValue: Record<string, unknown>) {
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

function apiError(status: number, message: string) {
  return NextResponse.json(
    {
      success: false,
      error: message,
      message
    },
    { status }
  );
}

function isDebugRequested(value: FormDataEntryValue | null) {
  if (typeof value !== "string") {
    return false;
  }
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function parseQrAssistCrop(entry: FormDataEntryValue | null) {
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

function isExtractionResult(value: unknown): value is {
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

function hydrateSupplierInExtraction(extraction: {
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

function isQrExtractionResult(value: unknown): value is {
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

function logQrDebugInfo(qrValue: Record<string, unknown>) {
  const rawQrContent = typeof qrValue.rawValue === "string" ? qrValue.rawValue : "";
  const detectedType = typeof qrValue.contentType === "string" ? qrValue.contentType : "UNKNOWN";
  const detected = Boolean(qrValue.detected);
  const decodeStatus = typeof qrValue.decodeStatus === "string" ? qrValue.decodeStatus : "UNKNOWN";
  const decodeSucceeded = decodeStatus === "DECODED";
  const rawPreview = truncateLogValue(rawQrContent, 200);
  console.info("[inventory][receipt-intake][qr-raw-debug]", {
    detected,
    decodeSucceeded,
    rawLength: rawQrContent.length,
    rawPreview
  });
  console.info("[inventory][receipt-intake][qr]", {
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
  });
}

function truncateLogValue(value: string, maxLength = 500) {
  if (!value) {
    return "";
  }
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength - 3)}...`;
}

function resolveReceiptIntakeMessage(extraction: { scanStatus?: unknown; qr?: unknown; intakeDebug?: unknown }) {
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

function readDebugFlagsFromExtraction(extraction: Record<string, unknown>) {
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

function readScanDiagnosticsFromExtraction(extraction: Record<string, unknown>) {
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

function buildSafeFailureResponse({
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

function buildFallbackExtraction() {
  return {
    header: {
      supplierName: "",
      tin: "",
      vrn: "",
      serialNumber: "",
      receiptNumber: "",
      verificationCode: "",
      receiptDate: new Date().toISOString().slice(0, 10),
      receiptTime: "",
      traReceiptNumber: "",
      invoiceReference: "",
      paymentMethod: "",
      taxOffice: "",
      currency: "TZS",
      itemCount: 0,
      subtotal: 0,
      tax: 0,
      total: 0
    },
    fieldConfidence: {
      supplierName: "UNREADABLE",
      tin: "UNREADABLE",
      vrn: "UNREADABLE",
      serialNumber: "UNREADABLE",
      receiptNumber: "UNREADABLE",
      verificationCode: "UNREADABLE",
      receiptDate: "LOW",
      receiptTime: "UNREADABLE",
      traReceiptNumber: "UNREADABLE",
      invoiceReference: "UNREADABLE",
      paymentMethod: "UNREADABLE",
      taxOffice: "UNREADABLE",
      subtotal: "UNREADABLE",
      tax: "UNREADABLE",
      total: "UNREADABLE",
      itemCount: "UNREADABLE"
    },
    fieldSource: {
      supplierName: "NONE",
      tin: "NONE",
      vrn: "NONE",
      serialNumber: "NONE",
      receiptNumber: "NONE",
      verificationCode: "NONE",
      receiptDate: "DERIVED",
      receiptTime: "NONE",
      traReceiptNumber: "NONE",
      invoiceReference: "NONE",
      paymentMethod: "NONE",
      taxOffice: "NONE",
      subtotal: "NONE",
      tax: "NONE",
      total: "NONE",
      itemCount: "NONE"
    },
    lines: [],
    warnings: ["Unable to extract receipt data automatically. You can continue with manual entry."],
    rawTextPreview: "",
    extractionMethod: "NONE",
    scanStatus: "UNREADABLE",
    receiptType: "UNCLEAR",
    preprocessingApplied: [],
    qr: {
      detected: false,
      rawValue: "",
      normalizedRawValue: "",
      contentType: "NONE",
      isTraVerification: false,
      isQrOnlyImage: false,
      decodeStatus: "NOT_DETECTED",
      decodePass: "",
      parseStatus: "UNPARSED",
      failureReason: "No QR detected",
      verificationUrl: "",
      parsedFields: {},
      confidence: "UNREADABLE",
      warnings: [],
      stages: {
        decode: {
          success: false,
          status: "NOT_DETECTED",
          pass: "",
          reason: "No QR detected"
        },
        classification: {
          success: false,
          type: "NONE",
          isTraUrl: false
        },
        verificationLookup: {
          attempted: false,
          success: false,
          status: "NOT_ATTEMPTED",
          reason: "",
          httpStatus: null,
          parsed: false
        }
      }
    },
    scanDiagnostics: {
      qrDetected: false,
      qrDecodeStatus: "NOT_DETECTED",
      qrDecodePass: "",
      qrParseStatus: "UNPARSED",
      qrFailureReason: "No QR detected",
      qrContentType: "NONE",
      qrRawValue: "",
      qrNormalizedRawValue: "",
      qrRawLength: 0,
      qrRawPreview: "",
      qrRawPayloadFormat: "EMPTY",
      qrVerificationUrl: "",
      qrIsTraVerification: false,
      qrParsedFieldCount: 0,
      qrParsedLineItemsCount: 0,
      qrLookupStatus: "NOT_ATTEMPTED",
      qrLookupReason: "",
      qrLookupHttpStatus: null,
      qrLookupParsed: false,
      ocrAttempted: false,
      ocrSucceeded: false,
      ocrError: "",
      scanStatus: "UNREADABLE",
      extractionMethod: "NONE",
      returnedFrom: "qr_tra",
      failureStage: "QR_NOT_DETECTED"
    }
  };
}

function logExtractError(file: string, step: string, error: unknown) {
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

async function saveReceiptFile(receipt: File) {
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

async function suggestSupplier({
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
