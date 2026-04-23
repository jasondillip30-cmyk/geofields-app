import { randomUUID } from "node:crypto";

import {
  extractQrDataOnly,
  extractReceiptData,
  extractReceiptDataFromRawPayload,
  type ReceiptQrAssistCrop
} from "@/lib/inventory-receipt-intake";

import { resolveRuntimeCapabilities } from "../runtime-capabilities";
import {
  readDebugFlagsFromExtraction,
  readScanDiagnosticsFromExtraction,
  resolveNormalizationQualityOutcome,
  resolveReceiptIntakeMessage
} from "../extraction/response-shaping";
import { resolveReceiptUploadIngestion } from "../extraction/ingestion";
import {
  buildObjectKey,
  extensionFromMimeType,
  putObject
} from "../storage/object-store";
import { persistArtifactManifest } from "../storage/artifact-manifest";

const DEFAULT_MAX_UPLOAD_MB = 20;

type InventoryReferenceItemLite = {
  id: string;
  name: string;
  sku: string;
  category: string;
};

type ExtractContext = {
  requestId?: string;
  source?: "desktop_upload" | "mobile_gallery" | "mobile_camera_file";
  requisitionId?: string;
  qrCrop?: ReceiptQrAssistCrop | null;
  debug?: boolean;
  inventoryItems?: InventoryReferenceItemLite[];
};

type ExtractOptions = {
  mode?: "full" | "decode-only";
  trace?: boolean;
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json"
    }
  });
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function isQrExtractionResult(value: unknown): value is {
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
} {
  if (!isObject(value)) {
    return false;
  }
  return (
    typeof value.detected === "boolean" &&
    typeof value.rawValue === "string" &&
    typeof value.contentType === "string" &&
    typeof value.decodeStatus === "string" &&
    typeof value.decodePass === "string" &&
    typeof value.parseStatus === "string" &&
    typeof value.failureReason === "string" &&
    typeof value.verificationUrl === "string" &&
    typeof value.isTraVerification === "boolean" &&
    isObject(value.stages)
  );
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
  if (!isObject(value)) {
    return false;
  }

  return (
    isObject(value.header) &&
    isObject(value.fieldConfidence) &&
    isObject(value.fieldSource) &&
    Array.isArray(value.lines) &&
    Array.isArray(value.warnings) &&
    typeof value.rawTextPreview === "string" &&
    typeof value.extractionMethod === "string" &&
    typeof value.scanStatus === "string" &&
    typeof value.receiptType === "string" &&
    Array.isArray(value.preprocessingApplied) &&
    isObject(value.qr)
  );
}

function toBoolean(value: unknown) {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return normalized === "1" || normalized === "true" || normalized === "yes";
  }
  return false;
}

function readApiKeyFromRequest(request: Request) {
  const fromHeader = request.headers.get("x-extractor-api-key");
  if (fromHeader && fromHeader.trim()) {
    return fromHeader.trim();
  }
  const authorization = request.headers.get("authorization") || "";
  if (authorization.toLowerCase().startsWith("bearer ")) {
    return authorization.slice(7).trim();
  }
  return "";
}

function parseJsonField<T extends Record<string, unknown>>(value: FormDataEntryValue | null) {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!isObject(parsed)) {
      return null;
    }
    return parsed as T;
  } catch {
    return null;
  }
}

function readContext(formData: FormData): ExtractContext {
  const parsed = parseJsonField<Record<string, unknown>>(formData.get("context"));
  if (!parsed) {
    return {};
  }

  const inventoryItems = Array.isArray(parsed.inventoryItems)
    ? parsed.inventoryItems
        .filter((value): value is Record<string, unknown> => isObject(value))
        .map((value) => ({
          id: typeof value.id === "string" ? value.id : "",
          name: typeof value.name === "string" ? value.name : "",
          sku: typeof value.sku === "string" ? value.sku : "",
          category: typeof value.category === "string" ? value.category : "UNCATEGORIZED"
        }))
        .filter((value) => value.id && value.name)
    : [];

  const qrCropCandidate = isObject(parsed.qrCrop) ? parsed.qrCrop : null;
  const qrCrop =
    qrCropCandidate &&
    Number.isFinite(Number(qrCropCandidate.x)) &&
    Number.isFinite(Number(qrCropCandidate.y)) &&
    Number.isFinite(Number(qrCropCandidate.width)) &&
    Number.isFinite(Number(qrCropCandidate.height))
      ? {
          x: Number(qrCropCandidate.x),
          y: Number(qrCropCandidate.y),
          width: Number(qrCropCandidate.width),
          height: Number(qrCropCandidate.height)
        }
      : null;

  return {
    requestId: typeof parsed.requestId === "string" ? parsed.requestId : undefined,
    source:
      parsed.source === "mobile_gallery" ||
      parsed.source === "mobile_camera_file" ||
      parsed.source === "desktop_upload"
        ? parsed.source
        : undefined,
    requisitionId: typeof parsed.requisitionId === "string" ? parsed.requisitionId : undefined,
    debug: toBoolean(parsed.debug),
    qrCrop,
    inventoryItems
  };
}

function readOptions(formData: FormData): ExtractOptions {
  const parsed = parseJsonField<Record<string, unknown>>(formData.get("options"));
  if (!parsed) {
    return { mode: "full", trace: false };
  }
  return {
    mode: parsed.mode === "decode-only" ? "decode-only" : "full",
    trace: toBoolean(parsed.trace)
  };
}

function shouldTrace(options: ExtractOptions, context: ExtractContext) {
  return process.env.NODE_ENV !== "production" || process.env.RECEIPT_QR_TRACE === "1" || options.trace || Boolean(context.debug);
}

function toReceiptInfo({
  fileName,
  mimeType,
  size,
  url
}: {
  fileName: string;
  mimeType: string;
  size: number;
  url: string;
}) {
  return {
    fileName,
    mimeType,
    size,
    url
  };
}

function normalizeError(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function maxUploadBytes() {
  const configuredMb = Number(process.env.EXTRACTOR_MAX_UPLOAD_MB || DEFAULT_MAX_UPLOAD_MB);
  if (!Number.isFinite(configuredMb) || configuredMb <= 0) {
    return DEFAULT_MAX_UPLOAD_MB * 1024 * 1024;
  }
  return Math.round(configuredMb * 1024 * 1024);
}

export async function handleExtractReceipt(request: Request) {
  const expectedApiKey = (process.env.EXTRACTOR_API_KEY || "").trim();
  if (expectedApiKey) {
    const providedApiKey = readApiKeyFromRequest(request);
    if (!providedApiKey) {
      return jsonResponse({
        success: false,
        stage: "auth_required",
        message: "Extractor API key is required.",
        error: "Unauthorized"
      }, 401);
    }
    if (providedApiKey !== expectedApiKey) {
      return jsonResponse({
        success: false,
        stage: "auth_failed",
        message: "Extractor API key is invalid.",
        error: "Forbidden"
      }, 403);
    }
  }

  const startedAt = Date.now();
  const formData = await request.formData().catch(() => null);
  if (!formData) {
    return jsonResponse(
      {
        success: false,
        stage: "invalid_form_data",
        message: "Multipart form data is required.",
        error: "Bad Request"
      },
      400
    );
  }

  const context = readContext(formData);
  const options = readOptions(formData);
  const traceEnabled = shouldTrace(options, context);

  const receiptFileEntry = formData.get("receipt");
  if (!(receiptFileEntry instanceof File)) {
    return jsonResponse(
      {
        success: false,
        stage: "missing_receipt",
        message: "Receipt file is required.",
        error: "Bad Request"
      },
      400
    );
  }

  const rawBuffer = Buffer.from(await receiptFileEntry.arrayBuffer());
  if (rawBuffer.length === 0) {
    return jsonResponse(
      {
        success: false,
        stage: "empty_upload",
        message: "Receipt file is empty.",
        error: "Bad Request"
      },
      400
    );
  }
  if (rawBuffer.length > maxUploadBytes()) {
    return jsonResponse(
      {
        success: false,
        stage: "upload_too_large",
        message: `Receipt upload exceeds ${Math.round(maxUploadBytes() / (1024 * 1024))}MB limit.`,
        error: "Bad Request"
      },
      400
    );
  }

  const ingestStartedAt = Date.now();
  const ingestion = await resolveReceiptUploadIngestion(receiptFileEntry);
  const ingestElapsedMs = Date.now() - ingestStartedAt;

  if (!ingestion.ok) {
    return jsonResponse(
      {
        success: false,
        stage: ingestion.stage,
        message: ingestion.message,
        error: ingestion.message
      },
      ingestion.status
    );
  }

  const extractStartedAt = Date.now();
  const inventoryItems = (context.inventoryItems || []) as Parameters<typeof extractReceiptData>[0]["inventoryItems"];

  const extractionId = context.requestId || randomUUID();

  let extractedPayload: Awaited<ReturnType<typeof extractReceiptData>> | null = null;
  let qrDecodePayload: Awaited<ReturnType<typeof extractQrDataOnly>> | null = null;
  try {
    if (options.mode === "decode-only") {
      qrDecodePayload = await extractQrDataOnly({
        fileBuffer: ingestion.fileBuffer,
        mimeType: ingestion.effectiveMimeType,
        qrAssistCrop: context.qrCrop || null,
        preprocessedImages: ingestion.imageVariants
      });
    } else {
      extractedPayload = await extractReceiptData({
        fileBuffer: ingestion.fileBuffer,
        mimeType: ingestion.effectiveMimeType,
        fileName: receiptFileEntry.name,
        inventoryItems,
        qrAssistCrop: context.qrCrop || null,
        preprocessedImages: ingestion.imageVariants,
        debug: context.debug
      });
    }
  } catch (error) {
    const message = normalizeError(error);
    return jsonResponse(
      {
        success: false,
        stage: "extract_failed",
        message: "Extraction failed. Please retry or continue manually.",
        error: message
      },
      504
    );
  }

  const extractElapsedMs = Date.now() - extractStartedAt;

  if (options.mode === "decode-only") {
    if (!isQrExtractionResult(qrDecodePayload)) {
      return jsonResponse(
        {
          success: false,
          stage: "decode_failed",
          message: "QR decode returned invalid payload.",
          error: "Invalid decode payload"
        },
        504
      );
    }

    const persistStartedAt = Date.now();
    const rawObject = await putObject({
      key: buildObjectKey({
        extractionId,
        variant: "raw",
        extension: extensionFromMimeType(ingestion.auditMetadata.original.effectiveMimeType || receiptFileEntry.type || "application/octet-stream")
      }),
      buffer: rawBuffer,
      mimeType: ingestion.auditMetadata.original.effectiveMimeType || receiptFileEntry.type || "application/octet-stream"
    });
    const primaryObject = await putObject({
      key: buildObjectKey({
        extractionId,
        variant: "primary",
        extension: extensionFromMimeType(ingestion.effectiveMimeType)
      }),
      buffer: ingestion.fileBuffer,
      mimeType: ingestion.effectiveMimeType
    });

    const qrEnhancedObject = ingestion.imageVariants?.qrEnhanced
      ? await putObject({
          key: buildObjectKey({
            extractionId,
            variant: "qr-enhanced",
            extension: extensionFromMimeType(ingestion.imageVariants.qrEnhanced.mimeType)
          }),
          buffer: ingestion.imageVariants.qrEnhanced.buffer,
          mimeType: ingestion.imageVariants.qrEnhanced.mimeType
        })
      : null;

    const persistElapsedMs = Date.now() - persistStartedAt;

    const diagnosticsTiming = {
      total: Date.now() - startedAt,
      ingest: ingestElapsedMs,
      extract: extractElapsedMs,
      persist: persistElapsedMs
    };

    const { storedManifest } = await persistArtifactManifest({
      extractionId,
      source: {
        fileName: receiptFileEntry.name,
        mimeType: ingestion.auditMetadata.original.effectiveMimeType || receiptFileEntry.type || "application/octet-stream",
        size: ingestion.auditMetadata.original.size,
        width: ingestion.auditMetadata.original.width,
        height: ingestion.auditMetadata.original.height
      },
      normalized: {
        mimeType: ingestion.effectiveMimeType,
        size: ingestion.auditMetadata.normalized.size,
        width: ingestion.auditMetadata.normalized.width,
        height: ingestion.auditMetadata.normalized.height,
        normalizationPath: ingestion.normalizationPath,
        normalizationApplied: ingestion.normalizationApplied,
        preprocessingPrimary: ingestion.auditMetadata.variants.primary.preprocessingSteps,
        preprocessingQrEnhanced: ingestion.auditMetadata.variants.qrEnhanced?.preprocessingSteps || []
      },
      raw: {
        object: rawObject,
        width: ingestion.auditMetadata.original.width,
        height: ingestion.auditMetadata.original.height
      },
      primary: {
        object: primaryObject,
        width: ingestion.auditMetadata.normalized.width,
        height: ingestion.auditMetadata.normalized.height
      },
      qrEnhanced: qrEnhancedObject
        ? {
            object: qrEnhancedObject,
            width: ingestion.auditMetadata.variants.qrEnhanced?.width || null,
            height: ingestion.auditMetadata.variants.qrEnhanced?.height || null
          }
        : null,
      diagnostics: {
        serviceVersion: process.env.SERVICE_VERSION || "0.1.0",
        timingMs: diagnosticsTiming
      }
    });

    const runtime = traceEnabled ? await resolveRuntimeCapabilities() : null;

    return jsonResponse({
      success: qrDecodePayload.decodeStatus === "DECODED",
      message:
        qrDecodePayload.decodeStatus === "DECODED"
          ? "QR captured successfully."
          : qrDecodePayload.decodeStatus === "DECODE_FAILED"
            ? "QR detected but needs review."
            : "QR was not detected automatically.",
      stage: qrDecodePayload.decodeStatus === "DECODED" ? "decoded" : "decode_failed",
      receipt: toReceiptInfo({
        fileName: receiptFileEntry.name,
        mimeType: ingestion.effectiveMimeType,
        size: ingestion.auditMetadata.original.size,
        url: primaryObject.url
      }),
      qrDecode: {
        success: qrDecodePayload.decodeStatus === "DECODED",
        raw: qrDecodePayload.rawValue,
        normalizedRaw: qrDecodePayload.normalizedRawValue,
        rawLength: typeof qrDecodePayload.rawValue === "string" ? qrDecodePayload.rawValue.length : 0,
        rawPreview:
          typeof qrDecodePayload.rawValue === "string" ? qrDecodePayload.rawValue.slice(0, 200) : "",
        type: qrDecodePayload.contentType,
        decodeStatus: qrDecodePayload.decodeStatus,
        decodePass: qrDecodePayload.decodePass,
        parseStatus: qrDecodePayload.parseStatus,
        verificationUrl: qrDecodePayload.verificationUrl,
        isTraVerification: qrDecodePayload.isTraVerification,
        failureReason: qrDecodePayload.failureReason,
        stages: qrDecodePayload.stages
      },
      artifacts: {
        extractionId,
        manifest: {
          key: storedManifest.key,
          url: storedManifest.url
        },
        raw: {
          key: rawObject.key,
          url: rawObject.url,
          mimeType: rawObject.mimeType,
          size: rawObject.size,
          width: ingestion.auditMetadata.original.width,
          height: ingestion.auditMetadata.original.height,
          sha256: rawObject.sha256
        },
        primary: {
          key: primaryObject.key,
          url: primaryObject.url,
          mimeType: primaryObject.mimeType,
          size: primaryObject.size,
          width: ingestion.auditMetadata.normalized.width,
          height: ingestion.auditMetadata.normalized.height,
          sha256: primaryObject.sha256
        },
        qrEnhanced: qrEnhancedObject
          ? {
              key: qrEnhancedObject.key,
              url: qrEnhancedObject.url,
              mimeType: qrEnhancedObject.mimeType,
              size: qrEnhancedObject.size,
              width: ingestion.auditMetadata.variants.qrEnhanced?.width || null,
              height: ingestion.auditMetadata.variants.qrEnhanced?.height || null,
              sha256: qrEnhancedObject.sha256
            }
          : null
      },
      diagnostics: {
        normalizationPath: ingestion.normalizationPath,
        normalizationApplied: ingestion.normalizationApplied,
        normalizationOutcome: "NOT_APPLICABLE",
        timingMs: diagnosticsTiming,
        serviceVersion: process.env.SERVICE_VERSION || "0.1.0",
        qrAttemptCount:
          qrDecodePayload.stages &&
          typeof qrDecodePayload.stages === "object" &&
          (qrDecodePayload.stages as Record<string, unknown>).decode &&
          typeof (qrDecodePayload.stages as Record<string, unknown>).decode === "object" &&
          typeof ((qrDecodePayload.stages as Record<string, unknown>).decode as Record<string, unknown>).attemptCount === "number"
            ? (((qrDecodePayload.stages as Record<string, unknown>).decode as Record<string, unknown>).attemptCount as number)
            : 0,
        runtime
      }
    });
  }

  if (!isExtractionResult(extractedPayload)) {
    return jsonResponse(
      {
        success: false,
        stage: "extract_invalid_payload",
        message: "Extraction returned invalid payload.",
        error: "Invalid extraction payload"
      },
      504
    );
  }

  const persistStartedAt = Date.now();
  const rawObject = await putObject({
    key: buildObjectKey({
      extractionId,
      variant: "raw",
      extension: extensionFromMimeType(ingestion.auditMetadata.original.effectiveMimeType || receiptFileEntry.type || "application/octet-stream")
    }),
    buffer: rawBuffer,
    mimeType: ingestion.auditMetadata.original.effectiveMimeType || receiptFileEntry.type || "application/octet-stream"
  });
  const primaryObject = await putObject({
    key: buildObjectKey({
      extractionId,
      variant: "primary",
      extension: extensionFromMimeType(ingestion.effectiveMimeType)
    }),
    buffer: ingestion.fileBuffer,
    mimeType: ingestion.effectiveMimeType
  });
  const qrEnhancedObject = ingestion.imageVariants?.qrEnhanced
    ? await putObject({
        key: buildObjectKey({
          extractionId,
          variant: "qr-enhanced",
          extension: extensionFromMimeType(ingestion.imageVariants.qrEnhanced.mimeType)
        }),
        buffer: ingestion.imageVariants.qrEnhanced.buffer,
        mimeType: ingestion.imageVariants.qrEnhanced.mimeType
      })
    : null;
  const persistElapsedMs = Date.now() - persistStartedAt;

  const diagnosticsTiming = {
    total: Date.now() - startedAt,
    ingest: ingestElapsedMs,
    extract: extractElapsedMs,
    persist: persistElapsedMs
  };

  const { storedManifest } = await persistArtifactManifest({
    extractionId,
    source: {
      fileName: receiptFileEntry.name,
      mimeType: ingestion.auditMetadata.original.effectiveMimeType || receiptFileEntry.type || "application/octet-stream",
      size: ingestion.auditMetadata.original.size,
      width: ingestion.auditMetadata.original.width,
      height: ingestion.auditMetadata.original.height
    },
    normalized: {
      mimeType: ingestion.effectiveMimeType,
      size: ingestion.auditMetadata.normalized.size,
      width: ingestion.auditMetadata.normalized.width,
      height: ingestion.auditMetadata.normalized.height,
      normalizationPath: ingestion.normalizationPath,
      normalizationApplied: ingestion.normalizationApplied,
      preprocessingPrimary: ingestion.auditMetadata.variants.primary.preprocessingSteps,
      preprocessingQrEnhanced: ingestion.auditMetadata.variants.qrEnhanced?.preprocessingSteps || []
    },
    raw: {
      object: rawObject,
      width: ingestion.auditMetadata.original.width,
      height: ingestion.auditMetadata.original.height
    },
    primary: {
      object: primaryObject,
      width: ingestion.auditMetadata.normalized.width,
      height: ingestion.auditMetadata.normalized.height
    },
    qrEnhanced: qrEnhancedObject
      ? {
          object: qrEnhancedObject,
          width: ingestion.auditMetadata.variants.qrEnhanced?.width || null,
          height: ingestion.auditMetadata.variants.qrEnhanced?.height || null
        }
      : null,
    diagnostics: {
      serviceVersion: process.env.SERVICE_VERSION || "0.1.0",
      timingMs: diagnosticsTiming
    }
  });

  const debugFlags = readDebugFlagsFromExtraction(extractedPayload as unknown as Record<string, unknown>);
  const scanDiagnostics = readScanDiagnosticsFromExtraction(extractedPayload as unknown as Record<string, unknown>);
  const normalizationOutcome = resolveNormalizationQualityOutcome({
    normalizationApplied: ingestion.normalizationApplied,
    extraction: extractedPayload
  });
  const runtime = traceEnabled ? await resolveRuntimeCapabilities() : null;

  return jsonResponse({
    success: true,
    message: resolveReceiptIntakeMessage(extractedPayload),
    stage: extractedPayload.scanStatus === "COMPLETE" ? "complete" : extractedPayload.scanStatus === "PARTIAL" ? "partial" : "unreadable",
    receipt: toReceiptInfo({
      fileName: receiptFileEntry.name,
      mimeType: ingestion.effectiveMimeType,
      size: ingestion.auditMetadata.original.size,
      url: primaryObject.url
    }),
    extracted: extractedPayload,
    debugFlags,
    scanDiagnostics,
    partialEnrichment: debugFlags.partialEnrichment,
    artifacts: {
      extractionId,
      manifest: {
        key: storedManifest.key,
        url: storedManifest.url
      },
      raw: {
        key: rawObject.key,
        url: rawObject.url,
        mimeType: rawObject.mimeType,
        size: rawObject.size,
        width: ingestion.auditMetadata.original.width,
        height: ingestion.auditMetadata.original.height,
        sha256: rawObject.sha256
      },
      primary: {
        key: primaryObject.key,
        url: primaryObject.url,
        mimeType: primaryObject.mimeType,
        size: primaryObject.size,
        width: ingestion.auditMetadata.normalized.width,
        height: ingestion.auditMetadata.normalized.height,
        sha256: primaryObject.sha256
      },
      qrEnhanced: qrEnhancedObject
        ? {
            key: qrEnhancedObject.key,
            url: qrEnhancedObject.url,
            mimeType: qrEnhancedObject.mimeType,
            size: qrEnhancedObject.size,
            width: ingestion.auditMetadata.variants.qrEnhanced?.width || null,
            height: ingestion.auditMetadata.variants.qrEnhanced?.height || null,
            sha256: qrEnhancedObject.sha256
          }
        : null
    },
    diagnostics: {
      normalizationPath: ingestion.normalizationPath,
      normalizationApplied: ingestion.normalizationApplied,
      normalizationOutcome,
      timingMs: diagnosticsTiming,
      serviceVersion: process.env.SERVICE_VERSION || "0.1.0",
      qrAttemptCount:
        extractedPayload.qr &&
        typeof extractedPayload.qr === "object" &&
        (extractedPayload.qr as Record<string, unknown>).stages &&
        typeof (extractedPayload.qr as Record<string, unknown>).stages === "object" &&
        ((extractedPayload.qr as Record<string, unknown>).stages as Record<string, unknown>).decode &&
        typeof ((extractedPayload.qr as Record<string, unknown>).stages as Record<string, unknown>).decode === "object" &&
        typeof ((((extractedPayload.qr as Record<string, unknown>).stages as Record<string, unknown>).decode as Record<string, unknown>).attemptCount) === "number"
          ? ((((extractedPayload.qr as Record<string, unknown>).stages as Record<string, unknown>).decode as Record<string, unknown>).attemptCount as number)
          : 0,
      runtime
    }
  });
}

function readRawPayload(body: unknown) {
  if (!isObject(body)) {
    return "";
  }
  if (typeof body.rawPayload === "string" && body.rawPayload.trim()) {
    return body.rawPayload.trim();
  }
  if (typeof body.rawValue === "string" && body.rawValue.trim()) {
    return body.rawValue.trim();
  }
  return "";
}

function readRawContext(body: unknown): ExtractContext {
  if (!isObject(body) || !isObject(body.context)) {
    return {};
  }
  return body.context as ExtractContext;
}

export async function handleExtractReceiptFromRawPayload(request: Request) {
  const expectedApiKey = (process.env.EXTRACTOR_API_KEY || "").trim();
  if (expectedApiKey) {
    const providedApiKey = readApiKeyFromRequest(request);
    if (!providedApiKey) {
      return jsonResponse(
        {
          success: false,
          stage: "auth_required",
          message: "Extractor API key is required.",
          error: "Unauthorized"
        },
        401
      );
    }
    if (providedApiKey !== expectedApiKey) {
      return jsonResponse(
        {
          success: false,
          stage: "auth_failed",
          message: "Extractor API key is invalid.",
          error: "Forbidden"
        },
        403
      );
    }
  }

  const body = await request.json().catch(() => null);
  const rawPayload = readRawPayload(body);
  if (!rawPayload) {
    return jsonResponse(
      {
        success: false,
        stage: "missing_raw_payload",
        message: "rawPayload is required.",
        error: "Bad Request"
      },
      400
    );
  }

  const context = readRawContext(body);
  const inventoryItems = Array.isArray(context.inventoryItems)
    ? (context.inventoryItems as Parameters<typeof extractReceiptDataFromRawPayload>[0]["inventoryItems"])
    : ([] as Parameters<typeof extractReceiptDataFromRawPayload>[0]["inventoryItems"]);

  try {
    const extraction = await extractReceiptDataFromRawPayload({
      rawPayload,
      inventoryItems
    });
    if (!isExtractionResult(extraction)) {
      return jsonResponse(
        {
          success: false,
          stage: "extract_invalid_payload",
          message: "Extraction returned invalid payload.",
          error: "Invalid extraction payload"
        },
        504
      );
    }

    const debugFlags = readDebugFlagsFromExtraction(extraction as unknown as Record<string, unknown>);
    const scanDiagnostics = readScanDiagnosticsFromExtraction(extraction as unknown as Record<string, unknown>);

    return jsonResponse({
      success: true,
      message: resolveReceiptIntakeMessage(extraction),
      stage: extraction.scanStatus === "COMPLETE" ? "complete" : extraction.scanStatus === "PARTIAL" ? "partial" : "unreadable",
      receipt: {
        url: typeof extraction.qr?.verificationUrl === "string" ? extraction.qr.verificationUrl : "",
        fileName: "camera-qr-scan",
        mimeType: "text/plain",
        size: rawPayload.length
      },
      extracted: extraction,
      debugFlags,
      scanDiagnostics,
      partialEnrichment: debugFlags.partialEnrichment
    });
  } catch (error) {
    return jsonResponse(
      {
        success: false,
        stage: "extract_failed",
        message: "Extraction failed. Please retry or continue manually.",
        error: normalizeError(error)
      },
      504
    );
  }
}
