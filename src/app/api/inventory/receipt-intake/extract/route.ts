import { NextResponse, type NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import type { InventoryCategory } from "@prisma/client";

import { requireAnyApiPermission } from "@/lib/auth/api-guard";
import { receiptTraceLog } from "@/lib/observability";
import { prisma } from "@/lib/prisma";
import { savePrivateReceipt, usesPrivateBlobReceipts } from "@/lib/private-receipt-storage";
import {
  isReceiptExtractorDecodeOnlyPayload,
  isReceiptExtractorFailurePayload,
  isReceiptExtractorSuccessPayload,
  type ReceiptExtractorRequestContext
} from "@/lib/receipt-extractor/contracts";
import {
  callReceiptExtractorService
} from "@/lib/receipt-extractor/client";
import { resolveReceiptExtractorMode } from "@/lib/receipt-extractor/mode";
import {
  apiError,
  buildSafeFailureResponse,
  detectUploadKind,
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
  suggestSupplier,
  truncateLogValue
} from "@/app/api/inventory/receipt-intake/extract/extract-route-helpers";

export const runtime = "nodejs";

type ExtractServedBy = "local" | "shadow_local" | "remote" | "remote_fallback_local";

function logModeServingPath({
  mode,
  servedBy,
  route,
  remoteAttemptStatus,
  remoteStatus,
  remoteAttempts,
  remoteDurationMs,
  remoteReason
}: {
  mode: "local" | "shadow" | "remote";
  servedBy: ExtractServedBy;
  route: "extract" | "scan-url";
  remoteAttemptStatus: string;
  remoteStatus?: number | null;
  remoteAttempts?: number | null;
  remoteDurationMs?: number | null;
  remoteReason?: string;
}) {
  if (process.env.NODE_ENV === "production") {
    return;
  }
  const statusSegment = typeof remoteStatus === "number" ? String(remoteStatus) : "n/a";
  const attemptsSegment = typeof remoteAttempts === "number" ? String(remoteAttempts) : "n/a";
  const durationSegment = typeof remoteDurationMs === "number" ? String(remoteDurationMs) : "n/a";
  const reasonSegment = remoteReason && remoteReason.trim() ? remoteReason.trim() : "n/a";
  console.info(
    `[inventory][receipt-intake][mode] route=${route} mode=${mode} servedBy=${servedBy} remoteAttemptStatus=${remoteAttemptStatus} remoteStatus=${statusSegment} remoteAttempts=${attemptsSegment} remoteDurationMs=${durationSegment} remoteReason=${reasonSegment}`
  );
}

function resolveExtractorSource(formData: FormData): ReceiptExtractorRequestContext["source"] {
  const sourceEntry = formData.get("source");
  if (typeof sourceEntry !== "string") {
    return "desktop_upload";
  }
  const normalized = sourceEntry.trim().toLowerCase();
  if (normalized === "mobile_gallery") {
    return "mobile_gallery";
  }
  if (normalized === "mobile_camera_file") {
    return "mobile_camera_file";
  }
  return "desktop_upload";
}

function resolveReceiptInfoFromRemotePayload({
  payload,
  fallbackFileName,
  fallbackMimeType,
  fallbackSize
}: {
  payload: {
    receipt: {
      url: string;
      fileName: string;
      mimeType: string;
      size: number;
    };
  };
  fallbackFileName: string;
  fallbackMimeType: string;
  fallbackSize: number;
}) {
  const remoteReceipt = payload.receipt;
  return {
    receiptUrl: typeof remoteReceipt?.url === "string" && remoteReceipt.url ? remoteReceipt.url : "",
    receiptFileName:
      typeof remoteReceipt?.fileName === "string" && remoteReceipt.fileName
        ? remoteReceipt.fileName
        : fallbackFileName,
    mimeType:
      typeof remoteReceipt?.mimeType === "string" && remoteReceipt.mimeType
        ? remoteReceipt.mimeType
        : fallbackMimeType,
    size:
      typeof remoteReceipt?.size === "number" && Number.isFinite(remoteReceipt.size) && remoteReceipt.size > 0
        ? remoteReceipt.size
        : fallbackSize
  };
}

async function finalizeFullExtractionResponse({
  extraction,
  savedFile,
  receiptMimeType,
  receiptSize,
  suppliers,
  isPdfUpload
}: {
  extraction: {
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
  };
  savedFile: {
    receiptUrl: string;
    receiptFileName: string;
  };
  receiptMimeType: string;
  receiptSize: number;
  suppliers: Array<{ id: string; name: string }>;
  isPdfUpload: boolean;
}) {
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
        mimeType: receiptMimeType,
        size: receiptSize
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
      mimeType: receiptMimeType,
      size: receiptSize
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

function finalizeDecodeOnlyResponse({
  qrOnly,
  savedFile,
  receiptMimeType,
  receiptSize
}: {
  qrOnly: {
    detected: boolean;
    rawValue: string;
    normalizedRawValue?: string;
    contentType: string;
    decodeStatus: string;
    decodePass: string;
    parseStatus: string;
    failureReason: string;
    verificationUrl: string;
    isTraVerification: boolean;
    stages: Record<string, unknown>;
  };
  savedFile: {
    receiptUrl: string;
    receiptFileName: string;
  };
  receiptMimeType: string;
  receiptSize: number;
}) {
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
      mimeType: receiptMimeType,
      size: receiptSize
    },
    qrDecode: {
      success: qrOnly.decodeStatus === "DECODED",
      raw: qrOnly.rawValue,
      normalizedRaw: typeof qrOnly.normalizedRawValue === "string" ? qrOnly.normalizedRawValue : qrOnly.rawValue,
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
    // The remote extractor currently returns its own file URLs. Hosted receipt evidence must stay private.
    const extractorMode = usesPrivateBlobReceipts() ? "local" : resolveReceiptExtractorMode();
    const extractorSource = resolveExtractorSource(formData);
    let servedBy: ExtractServedBy = extractorMode === "shadow" ? "shadow_local" : "local";
    let remoteAttemptStatus = "not_attempted";
    let remoteStatus: number | null = null;
    let remoteAttempts: number | null = null;
    let remoteDurationMs: number | null = null;
    let remoteReason = "";
    logRouteStage("extractor_mode_resolved", {
      mode: extractorMode
    });

    type InventoryItemLookup = {
      id: string;
      name: string;
      sku: string;
      category: InventoryCategory;
    };

    let inventoryItemsPromise: Promise<InventoryItemLookup[]> | null = null;
    let suppliersPromise: Promise<Array<{ id: string; name: string }>> | null = null;

    const loadInventoryItems = async (): Promise<InventoryItemLookup[]> => {
      if (!inventoryItemsPromise) {
        inventoryItemsPromise = prisma.inventoryItem.findMany({
          select: {
            id: true,
            name: true,
            sku: true,
            category: true
          }
        });
      }
      return inventoryItemsPromise;
    };

    const loadSuppliers = async (): Promise<Array<{ id: string; name: string }>> => {
      if (!suppliersPromise) {
        suppliersPromise = prisma.inventorySupplier.findMany({
          select: {
            id: true,
            name: true
          }
        });
      }
      return suppliersPromise;
    };

    const remoteEnabled = extractorMode !== "local" && Boolean(process.env.RECEIPT_EXTRACTOR_BASE_URL?.trim());
    if (remoteEnabled) {
      const remoteContextBase: ReceiptExtractorRequestContext = {
        requestId: randomUUID(),
        source: extractorSource,
        debug: debugMode,
        qrCrop: qrAssistCrop
      };

      if (extractorMode === "shadow") {
        remoteAttemptStatus = "shadow_async_started";
        servedBy = "shadow_local";
        void (async () => {
          const shadowInventoryItems = decodeOnlyMode
            ? []
            : (await loadInventoryItems()).map((item) => ({
                id: item.id,
                name: item.name,
                sku: item.sku,
                category: typeof item.category === "string" ? item.category : String(item.category || "")
              }));
          const shadowCall = await callReceiptExtractorService({
            receipt: receiptFileEntry,
            context: {
              ...remoteContextBase,
              inventoryItems: decodeOnlyMode ? undefined : shadowInventoryItems
            },
            options: {
              mode: decodeOnlyMode ? "decode-only" : "full",
              trace: debugMode
            }
          });
          receiptTraceLog("[inventory][receipt-intake][extractor-shadow]", {
            ok: shadowCall.ok,
            status: shadowCall.status,
            attempts: shadowCall.attempts,
            durationMs: shadowCall.durationMs,
            error: shadowCall.error
          });
          logModeServingPath({
            mode: extractorMode,
            servedBy: "shadow_local",
            route: "extract",
            remoteAttemptStatus: shadowCall.ok ? "shadow_async_succeeded" : "shadow_async_failed",
            remoteStatus: shadowCall.status,
            remoteAttempts: shadowCall.attempts,
            remoteDurationMs: shadowCall.durationMs,
            remoteReason: shadowCall.error
          });
        })();
      } else {
        logRouteStage("remote_extract_started", {
          mode: decodeOnlyMode ? "decode-only" : "full"
        });
        const remoteInventoryItems = decodeOnlyMode
          ? []
          : (await loadInventoryItems()).map((item) => ({
              id: item.id,
              name: item.name,
              sku: item.sku,
              category: typeof item.category === "string" ? item.category : String(item.category || "")
            }));
        const remoteCall = await callReceiptExtractorService({
          receipt: receiptFileEntry,
          context: {
            ...remoteContextBase,
            inventoryItems: decodeOnlyMode ? undefined : remoteInventoryItems
          },
          options: {
            mode: decodeOnlyMode ? "decode-only" : "full",
            trace: debugMode
          }
        });

        if (remoteCall.ok && remoteCall.payload) {
          if (decodeOnlyMode && isReceiptExtractorDecodeOnlyPayload(remoteCall.payload)) {
            const qrOnly = remoteCall.payload.qrDecode;
            if (isQrExtractionResult(qrOnly)) {
              const remoteReceiptInfo = resolveReceiptInfoFromRemotePayload({
                payload: remoteCall.payload,
                fallbackFileName: receiptFileEntry.name,
                fallbackMimeType: receiptFileEntry.type || "application/octet-stream",
                fallbackSize: receiptFileEntry.size
              });
              savedFile = {
                receiptUrl: remoteReceiptInfo.receiptUrl,
                receiptFileName: remoteReceiptInfo.receiptFileName
              };
              logRouteStage("remote_extract_succeeded", {
                mode: "decode-only",
                attempts: remoteCall.attempts,
                durationMs: remoteCall.durationMs
              });
              logModeServingPath({
                mode: extractorMode,
                servedBy: "remote",
                route: "extract",
                remoteAttemptStatus: "succeeded",
                remoteStatus: remoteCall.status,
                remoteAttempts: remoteCall.attempts,
                remoteDurationMs: remoteCall.durationMs
              });
              return finalizeDecodeOnlyResponse({
                qrOnly,
                savedFile,
                receiptMimeType: remoteReceiptInfo.mimeType,
                receiptSize: remoteReceiptInfo.size
              });
            }
          }

          if (!decodeOnlyMode && isReceiptExtractorSuccessPayload(remoteCall.payload)) {
            const remoteExtraction = remoteCall.payload.extracted;
            if (isExtractionResult(remoteExtraction)) {
              const remoteReceiptInfo = resolveReceiptInfoFromRemotePayload({
                payload: remoteCall.payload,
                fallbackFileName: receiptFileEntry.name,
                fallbackMimeType: receiptFileEntry.type || "application/octet-stream",
                fallbackSize: receiptFileEntry.size
              });
              savedFile = {
                receiptUrl: remoteReceiptInfo.receiptUrl,
                receiptFileName: remoteReceiptInfo.receiptFileName
              };
              const suppliers = await loadSuppliers();
              logRouteStage("remote_extract_succeeded", {
                mode: "full",
                attempts: remoteCall.attempts,
                durationMs: remoteCall.durationMs
              });
              logModeServingPath({
                mode: extractorMode,
                servedBy: "remote",
                route: "extract",
                remoteAttemptStatus: "succeeded",
                remoteStatus: remoteCall.status,
                remoteAttempts: remoteCall.attempts,
                remoteDurationMs: remoteCall.durationMs
              });
              return finalizeFullExtractionResponse({
                extraction: remoteExtraction,
                savedFile,
                receiptMimeType: remoteReceiptInfo.mimeType,
                receiptSize: remoteReceiptInfo.size,
                suppliers,
                isPdfUpload: detectUploadKind(receiptFileEntry) === "pdf"
              });
            }
          }
        }

        const remoteFailureReason =
          isReceiptExtractorFailurePayload(remoteCall.payload) && remoteCall.payload.error
            ? remoteCall.payload.error
            : remoteCall.error || "Remote extractor returned an unusable payload.";
        servedBy = "remote_fallback_local";
        remoteAttemptStatus = "failed";
        remoteStatus = remoteCall.status;
        remoteAttempts = remoteCall.attempts;
        remoteDurationMs = remoteCall.durationMs;
        remoteReason = remoteFailureReason;
        logRouteStage("remote_extract_failed", {
          status: remoteCall.status,
          reason: remoteFailureReason
        });
      }
    } else if (extractorMode !== "local") {
      servedBy = extractorMode === "shadow" ? "shadow_local" : "remote_fallback_local";
      remoteAttemptStatus = "skipped";
      remoteReason = "RECEIPT_EXTRACTOR_BASE_URL not configured";
      logRouteStage("remote_extract_skipped", {
        reason: "RECEIPT_EXTRACTOR_BASE_URL not configured",
        mode: extractorMode
      });
    } else {
      servedBy = "local";
    }

    logModeServingPath({
      mode: extractorMode,
      servedBy,
      route: "extract",
      remoteAttemptStatus,
      remoteStatus,
      remoteAttempts,
      remoteDurationMs,
      remoteReason
    });

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

    try {
      savedFile = await savePrivateReceipt({
        owner: auth.session.userId,
        fileName: receiptFileEntry.name,
        buffer: ingestedUpload.fileBuffer,
        mimeType: ingestedUpload.effectiveMimeType
      });
    } catch {
      return apiError(503, "Receipt could not be saved. Try uploading again.");
    }
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

      return finalizeDecodeOnlyResponse({
        qrOnly,
        savedFile,
        receiptMimeType: receiptFileEntry.type || ingestedUpload.effectiveMimeType,
        receiptSize: ingestedUpload.auditMetadata.original.size
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

    const [inventoryItems, suppliers] = await Promise.all([loadInventoryItems(), loadSuppliers()]);

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
    return finalizeFullExtractionResponse({
      extraction,
      savedFile,
      receiptMimeType: receiptFileEntry.type || ingestedUpload.effectiveMimeType,
      receiptSize: ingestedUpload.auditMetadata.original.size,
      suppliers,
      isPdfUpload
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
