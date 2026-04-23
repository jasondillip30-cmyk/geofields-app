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
        })();
      } else {
        const remote = await callReceiptExtractorFromRawPayload({
          rawPayload,
          context: remoteContext
        });
        if (remote.ok && remote.payload && isReceiptExtractorSuccessPayload(remote.payload)) {
          if (isExtractionResult(remote.payload.extracted)) {
            extraction = remote.payload.extracted;
            logRouteStage("scan_url_remote_succeeded", {
              attempts: remote.attempts,
              durationMs: remote.durationMs
            });
          }
        }

        if (!extraction) {
          logRouteStage("scan_url_remote_failed", {
            status: remote.status,
            reason: remote.error || "Remote extractor response was not usable."
          });
        }
      }
    } else if (extractorMode !== "local") {
      logRouteStage("scan_url_remote_skipped", {
        reason: "RECEIPT_EXTRACTOR_BASE_URL not configured",
        mode: extractorMode
      });
    }

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
