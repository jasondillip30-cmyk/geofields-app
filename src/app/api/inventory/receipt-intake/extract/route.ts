import { NextResponse, type NextRequest } from "next/server";

import { requireAnyApiPermission } from "@/lib/auth/api-guard";
import { receiptTraceLog } from "@/lib/observability";
import { prisma } from "@/lib/prisma";
import {
  apiError,
  buildSafeFailureResponse,
  hydrateSupplierInExtraction,
  isDebugRequested,
  isExtractionResult,
  isQrExtractionResult,
  logExtractError,
  logLookupStagesFromQr,
  logQrDebugInfo,
  logRouteStage,
  parseQrAssistCrop,
  readDebugFlagsFromExtraction,
  readScanDiagnosticsFromExtraction,
  resolveNormalizationQualityOutcome,
  resolveReceiptUploadIngestion,
  resolveReceiptIntakeMessage,
  saveReceiptFile,
  suggestSupplier,
  truncateLogValue
} from "@/app/api/inventory/receipt-intake/extract/extract-route-helpers";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  let savedFile: { receiptUrl: string; receiptFileName: string } | null = null;
  const routeLabel = "src/app/api/inventory/receipt-intake/extract/route.ts";
  logRouteStage("request_started");
  logRouteStage("route_loaded");
  try {
    const auth = await requireAnyApiPermission(request, ["inventory:view", "requisitions:view"]);
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

    const ingestedUpload = await resolveReceiptUploadIngestion(receiptFileEntry);
    if (!ingestedUpload.ok) {
      logRouteStage("ingestion_rejected", {
        stage: ingestedUpload.stage,
        reason: ingestedUpload.message
      });
      return apiError(ingestedUpload.status, ingestedUpload.message);
    }

    const uploadKind = ingestedUpload.uploadKind;
    const isPdfUpload = uploadKind === "pdf";
    const isImageUpload = uploadKind === "image";
    logRouteStage("file_type_detected", {
      mimeType: receiptFileEntry.type || "unknown",
      effectiveMimeType: ingestedUpload.effectiveMimeType,
      uploadKind
    });
    logRouteStage("upload_normalization_path", {
      normalizationPath: ingestedUpload.normalizationPath,
      normalizationApplied: ingestedUpload.normalizationApplied,
      heicConverted: ingestedUpload.auditMetadata.normalization.heicConverted,
      orientationCorrected: ingestedUpload.auditMetadata.normalization.orientationCorrected,
      resized: ingestedUpload.auditMetadata.normalization.resized,
      pngConvertedForStability: ingestedUpload.auditMetadata.normalization.pngConvertedForStability
    });
    logRouteStage(isPdfUpload ? "pdf_branch_entered" : "image_branch_entered");

    savedFile = await saveReceiptFile({
      originalFile: receiptFileEntry,
      normalizedFileBuffer: ingestedUpload.fileBuffer,
      normalizedMimeType: ingestedUpload.effectiveMimeType,
      auditMetadata: ingestedUpload.auditMetadata
    });
    const fileBuffer = ingestedUpload.fileBuffer;
    logRouteStage("file_loaded", {
      bytes: fileBuffer.length,
      originalBytes: ingestedUpload.auditMetadata.original.size
    });
    receiptTraceLog(
      "[inventory][receipt-intake][ingestion]",
      {
        originalFileName: ingestedUpload.auditMetadata.original.fileName,
        originalMimeType: ingestedUpload.auditMetadata.original.declaredMimeType || "unknown",
        effectiveMimeType: ingestedUpload.auditMetadata.original.effectiveMimeType,
        normalizedMimeType: ingestedUpload.auditMetadata.normalized.mimeType,
        originalBytes: ingestedUpload.auditMetadata.original.size,
        normalizedBytes: ingestedUpload.auditMetadata.normalized.size,
        originalWidth: ingestedUpload.auditMetadata.original.width,
        originalHeight: ingestedUpload.auditMetadata.original.height,
        normalizedWidth: ingestedUpload.auditMetadata.normalized.width,
        normalizedHeight: ingestedUpload.auditMetadata.normalized.height,
        normalizationPath: ingestedUpload.auditMetadata.normalization.path,
        orientationCorrected: ingestedUpload.auditMetadata.normalization.orientationCorrected,
        heicConverted: ingestedUpload.auditMetadata.normalization.heicConverted,
        resized: ingestedUpload.auditMetadata.normalization.resized,
        pngConvertedForStability: ingestedUpload.auditMetadata.normalization.pngConvertedForStability,
        primaryVariant: ingestedUpload.auditMetadata.variants.primary,
        qrEnhancedVariant: ingestedUpload.auditMetadata.variants.qrEnhanced
      }
    );

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
        mimeType: ingestedUpload.effectiveMimeType,
        qrAssistCrop,
        preprocessedImages: ingestedUpload.imageVariants
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
          mimeType: receiptFileEntry.type || ingestedUpload.effectiveMimeType,
          size: ingestedUpload.auditMetadata.original.size
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
      mimeType: ingestedUpload.effectiveMimeType,
      fileName: receiptFileEntry.name,
      inventoryItems,
      qrAssistCrop,
      preprocessedImages: ingestedUpload.imageVariants,
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
    receiptTraceLog(
      "[inventory][receipt-intake][supplier-mapping]",
      {
        parsedSupplierRaw: hydratedSupplier.parsedSupplierRaw,
        headerSupplierBefore: hydratedSupplier.headerSupplierBefore,
        headerSupplierAfter: hydratedSupplier.headerSupplierAfter,
        source: hydratedSupplier.source
      }
    );

    const message = resolveReceiptIntakeMessage(extraction);
    const debugFlags = readDebugFlagsFromExtraction(extraction as unknown as Record<string, unknown>);
    const scanDiagnostics = readScanDiagnosticsFromExtraction(extraction as unknown as Record<string, unknown>);
    const normalizationOutcome = resolveNormalizationQualityOutcome({
      normalizationApplied: ingestedUpload.normalizationApplied,
      extraction
    });
    receiptTraceLog(
      "[inventory][receipt-intake][normalization-outcome]",
      {
        normalizationPath: ingestedUpload.normalizationPath,
        normalizationApplied: ingestedUpload.normalizationApplied,
        outcome: normalizationOutcome,
        scanStatus: extraction.scanStatus,
        extractedLineCount: Array.isArray(extraction.lines) ? extraction.lines.length : 0
      }
    );

    const supplierSuggestion = await suggestSupplier({
      extractedSupplierName: hydratedSupplier.headerSupplierAfter,
      extractedTin: typeof extraction.header?.tin === "string" ? extraction.header.tin : "",
      suppliers
    });
    receiptTraceLog(
      "[inventory][receipt-intake][supplier-mapping][payload]",
      {
        payloadSupplier: hydratedSupplier.headerSupplierAfter,
        suggestedSupplierId: supplierSuggestion.supplierId,
        suggestedSupplierName: supplierSuggestion.supplierName
      }
    );

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
          mimeType: receiptFileEntry.type || ingestedUpload.effectiveMimeType,
          size: ingestedUpload.auditMetadata.original.size
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
        mimeType: receiptFileEntry.type || ingestedUpload.effectiveMimeType,
        size: ingestedUpload.auditMetadata.original.size
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
