import { NextResponse, type NextRequest } from "next/server";
import type { InventoryCategory } from "@prisma/client";

import { requireAnyApiPermission } from "@/lib/auth/api-guard";
import { debugLog } from "@/lib/observability";
import { prisma } from "@/lib/prisma";
import {
  isReceiptExtractorSuccessPayload,
  type ReceiptExtractorRequestContext
} from "@/lib/receipt-extractor/contracts";
import { callReceiptExtractorFromRawPayload } from "@/lib/receipt-extractor/client";
import { resolveReceiptExtractorMode } from "@/lib/receipt-extractor/mode";
import {
  apiError,
  buildSafeFailureResponse,
  hydrateSupplierInExtraction,
  isDebugRequested,
  isExtractionResult,
  logExtractError,
  logLookupStagesFromQr,
  logQrDebugInfo,
  logRouteStage,
  readDebugFlagsFromExtraction,
  readScanDiagnosticsFromExtraction,
  resolveReceiptIntakeMessage,
  suggestSupplier
} from "@/app/api/inventory/receipt-intake/extract/extract-route-helpers";

export const runtime = "nodejs";

type ScanUrlServedBy = "local" | "shadow_local" | "remote" | "remote_fallback_local";

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
  servedBy: ScanUrlServedBy;
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

function readRawPayload(body: unknown) {
  if (!body || typeof body !== "object") {
    return "";
  }
  const candidate = body as Record<string, unknown>;
  if (typeof candidate.rawPayload === "string" && candidate.rawPayload.trim().length > 0) {
    return candidate.rawPayload.trim();
  }
  if (typeof candidate.rawValue === "string" && candidate.rawValue.trim().length > 0) {
    return candidate.rawValue.trim();
  }
  return "";
}

function readDebugValue(body: unknown) {
  if (!body || typeof body !== "object") {
    return false;
  }
  const candidate = body as Record<string, unknown>;
  if (typeof candidate.debug === "boolean") {
    return candidate.debug;
  }
  if (typeof candidate.debug === "string") {
    return isDebugRequested(candidate.debug);
  }
  return false;
}

export async function POST(request: NextRequest) {
  const routeLabel = "src/app/api/inventory/receipt-intake/scan-url/route.ts";
  logRouteStage("scan_url_request_started");
  try {
    const auth = await requireAnyApiPermission(request, ["inventory:view", "requisitions:view"]);
    if (!auth.ok) {
      const status = auth.response.status;
      const message = status === 401 ? "Unauthorized" : "Forbidden";
      return apiError(status, message);
    }

    const body = await request.json().catch(() => null);
    const rawPayload = readRawPayload(body);
    if (!rawPayload) {
      return apiError(400, "rawPayload is required.");
    }

    const debugMode = process.env.NODE_ENV !== "production" && readDebugValue(body);
    const extractorMode = resolveReceiptExtractorMode();
    let servedBy: ScanUrlServedBy = extractorMode === "shadow" ? "shadow_local" : "local";
    let remoteAttemptStatus = "not_attempted";
    let remoteStatus: number | null = null;
    let remoteAttempts: number | null = null;
    let remoteDurationMs: number | null = null;
    let remoteReason = "";
    logRouteStage("scan_url_extractor_mode_resolved", {
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

    let extraction: unknown = null;

    const remoteEnabled = extractorMode !== "local" && Boolean(process.env.RECEIPT_EXTRACTOR_BASE_URL?.trim());
    if (remoteEnabled) {
      const remoteContext: ReceiptExtractorRequestContext = {
        requestId: `scan-url-${Date.now()}`,
        source: "mobile_camera_file",
        debug: debugMode,
        inventoryItems: (await loadInventoryItems()).map((item) => ({
          id: item.id,
          name: item.name,
          sku: item.sku,
          category: typeof item.category === "string" ? item.category : String(item.category || "")
        }))
      };

      if (extractorMode === "shadow") {
        servedBy = "shadow_local";
        remoteAttemptStatus = "shadow_async_started";
        void (async () => {
          const shadow = await callReceiptExtractorFromRawPayload({
            rawPayload,
            context: remoteContext
          });
          debugLog(
            "[inventory][receipt-intake][scan-url][extractor-shadow]",
            {
              ok: shadow.ok,
              status: shadow.status,
              attempts: shadow.attempts,
              durationMs: shadow.durationMs,
              error: shadow.error
            },
            { channel: "inventory-receipt" }
          );
          logModeServingPath({
            mode: extractorMode,
            servedBy: "shadow_local",
            route: "scan-url",
            remoteAttemptStatus: shadow.ok ? "shadow_async_succeeded" : "shadow_async_failed",
            remoteStatus: shadow.status,
            remoteAttempts: shadow.attempts,
            remoteDurationMs: shadow.durationMs,
            remoteReason: shadow.error
          });
        })();
      } else {
        const remote = await callReceiptExtractorFromRawPayload({
          rawPayload,
          context: remoteContext
        });
        if (remote.ok && remote.payload && isReceiptExtractorSuccessPayload(remote.payload)) {
          if (isExtractionResult(remote.payload.extracted)) {
            extraction = remote.payload.extracted;
            servedBy = "remote";
            remoteAttemptStatus = "succeeded";
            remoteStatus = remote.status;
            remoteAttempts = remote.attempts;
            remoteDurationMs = remote.durationMs;
            logRouteStage("scan_url_remote_succeeded", {
              attempts: remote.attempts,
              durationMs: remote.durationMs
            });
          }
        }

        if (!extraction) {
          servedBy = "remote_fallback_local";
          remoteAttemptStatus = "failed";
          remoteStatus = remote.status;
          remoteAttempts = remote.attempts;
          remoteDurationMs = remote.durationMs;
          remoteReason = remote.error || "Remote extractor response was not usable.";
          logRouteStage("scan_url_remote_failed", {
            status: remote.status,
            reason: remoteReason
          });
        }
      }
    } else if (extractorMode !== "local") {
      servedBy = extractorMode === "shadow" ? "shadow_local" : "remote_fallback_local";
      remoteAttemptStatus = "skipped";
      remoteReason = "RECEIPT_EXTRACTOR_BASE_URL not configured";
      logRouteStage("scan_url_remote_skipped", {
        reason: "RECEIPT_EXTRACTOR_BASE_URL not configured",
        mode: extractorMode
      });
    } else {
      servedBy = "local";
    }

    logModeServingPath({
      mode: extractorMode,
      servedBy,
      route: "scan-url",
      remoteAttemptStatus,
      remoteStatus,
      remoteAttempts,
      remoteDurationMs,
      remoteReason
    });

    if (!extraction) {
      const extractionModule = await import("@/lib/inventory-receipt-intake").catch((error) => {
        logExtractError(routeLabel, "module_import", error);
        return null;
      });

      const extractFromRawPayloadFn =
        extractionModule &&
        typeof extractionModule === "object" &&
        "extractReceiptDataFromRawPayload" in extractionModule
          ? extractionModule.extractReceiptDataFromRawPayload
          : null;

      if (typeof extractFromRawPayloadFn !== "function") {
        logRouteStage("scan_url_failed", { stage: "module_import_error" });
        return NextResponse.json(
          buildSafeFailureResponse({
            savedFile: null,
            message: "Unable to extract receipt data",
            debugMode,
            error: "Extraction module is unavailable.",
            stage: "module_import_error"
          })
        );
      }

      const inventoryItems = await loadInventoryItems();
      extraction = await extractFromRawPayloadFn({ rawPayload, inventoryItems }).catch((error: unknown) => {
        logExtractError(routeLabel, "extract_receipt_data_from_raw_payload", error);
        return null;
      });
    }

    if (!isExtractionResult(extraction)) {
      logRouteStage("scan_url_failed", { stage: "extract_error" });
      return NextResponse.json(
        buildSafeFailureResponse({
          savedFile: null,
          message: "Unable to extract receipt data",
          debugMode,
          error: "Extraction returned invalid payload.",
          stage: "extract_error"
        })
      );
    }

    const hydratedSupplier = hydrateSupplierInExtraction(extraction);

    logQrDebugInfo(extraction.qr as unknown as Record<string, unknown>);
    logLookupStagesFromQr(extraction.qr as unknown as Record<string, unknown>);

    debugLog(
      "[inventory][receipt-intake][scan-url][supplier-mapping]",
      {
        parsedSupplierRaw: hydratedSupplier.parsedSupplierRaw,
        headerSupplierBefore: hydratedSupplier.headerSupplierBefore,
        headerSupplierAfter: hydratedSupplier.headerSupplierAfter,
        source: hydratedSupplier.source
      },
      { channel: "inventory-receipt" }
    );

    const suppliers = await loadSuppliers();
    const supplierSuggestion = await suggestSupplier({
      extractedSupplierName: hydratedSupplier.headerSupplierAfter,
      extractedTin: typeof extraction.header?.tin === "string" ? extraction.header.tin : "",
      suppliers
    });

    const message = resolveReceiptIntakeMessage(extraction as unknown as Record<string, unknown>);
    const debugFlags = readDebugFlagsFromExtraction(extraction as unknown as Record<string, unknown>);
    const scanDiagnostics = readScanDiagnosticsFromExtraction(extraction as unknown as Record<string, unknown>);

    logRouteStage("scan_url_response_sent", { success: true });

    return NextResponse.json({
      success: true,
      message,
      receipt: {
        url: typeof extraction.qr?.verificationUrl === "string" ? extraction.qr.verificationUrl : "",
        fileName: "camera-qr-scan",
        mimeType: "text/plain",
        size: rawPayload.length
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
  } catch (error) {
    logExtractError(routeLabel, "route_handler", error);
    logRouteStage("scan_url_response_sent", {
      success: false,
      stage: "route_handler_error"
    });
    return NextResponse.json(
      buildSafeFailureResponse({
        savedFile: null,
        message: "Unable to extract receipt data",
        debugMode: process.env.NODE_ENV !== "production",
        error,
        stage: "route_handler_error"
      })
    );
  }
}
