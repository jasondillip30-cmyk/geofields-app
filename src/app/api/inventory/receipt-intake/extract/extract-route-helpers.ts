import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";
import sharp from "sharp";

import { debugLog } from "@/lib/observability";
import { prisma } from "@/lib/prisma";
import { buildFallbackExtraction } from "@/app/api/inventory/receipt-intake/extract/extract-fallback";

const MAX_IMAGE_LONG_EDGE_PX = 3200;
const NORMALIZED_JPEG_QUALITY = 92;
const OVERSIZED_IMAGE_BYTES = 8 * 1024 * 1024;

const acceptedMimeTypes = new Set([
  "application/pdf",
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif"
]);

const heicFileBrands = new Set([
  "heic",
  "heix",
  "hevc",
  "hevx",
  "heim",
  "heis"
]);

const heifFileBrands = new Set([
  "mif1",
  "msf1",
  "heif"
]);

const supportedFileExtensions = new Map<string, string>([
  [".pdf", "application/pdf"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".png", "image/png"],
  [".webp", "image/webp"],
  [".heic", "image/heic"],
  [".heif", "image/heif"]
]);

export type UploadNormalizationPath =
  | "NONE"
  | "HEIC_TO_JPEG_ONLY"
  | "ROTATE_ONLY"
  | "RESIZE_ONLY"
  | "ROTATE_AND_RESIZE"
  | "HEIC_TO_JPEG_AND_ROTATE"
  | "HEIC_TO_JPEG_AND_RESIZE"
  | "HEIC_TO_JPEG_ROTATE_AND_RESIZE";

export interface ReceiptUploadAuditMetadata {
  original: {
    fileName: string;
    declaredMimeType: string;
    effectiveMimeType: string;
    size: number;
    width: number | null;
    height: number | null;
  };
  normalized: {
    mimeType: string;
    size: number;
    width: number | null;
    height: number | null;
  };
  normalization: {
    path: UploadNormalizationPath;
    applied: boolean;
    heicConverted: boolean;
    orientationCorrected: boolean;
    resized: boolean;
    pngConvertedForStability: boolean;
  };
  variants: {
    primary: {
      mimeType: string;
      size: number;
      width: number | null;
      height: number | null;
      preprocessingSteps: string[];
    };
    qrEnhanced: {
      mimeType: string;
      size: number;
      width: number | null;
      height: number | null;
      preprocessingSteps: string[];
    } | null;
  };
}

interface ReceiptUploadIngestionFailure {
  ok: false;
  status: 400 | 415;
  stage: string;
  message: string;
}

export interface ReceiptUploadIngestionSuccess {
  ok: true;
  uploadKind: "pdf" | "image";
  effectiveMimeType: string;
  fileBuffer: Buffer;
  imageVariants: {
    primary: {
      buffer: Buffer;
      mimeType: string;
      size: number;
      width: number | null;
      height: number | null;
      preprocessingSteps: string[];
    };
    qrEnhanced: {
      buffer: Buffer;
      mimeType: string;
      size: number;
      width: number | null;
      height: number | null;
      preprocessingSteps: string[];
    } | null;
  } | null;
  normalizationPath: UploadNormalizationPath;
  normalizationApplied: boolean;
  auditMetadata: ReceiptUploadAuditMetadata;
}

export type ReceiptUploadIngestionResult = ReceiptUploadIngestionSuccess | ReceiptUploadIngestionFailure;

export function detectUploadKind(file: File): "pdf" | "image" | "unknown" {
  const lowerMime = normalizeDeclaredMimeType(file.type);
  const lowerName = (file.name || "").toLowerCase();
  if (lowerMime.includes("pdf") || lowerName.endsWith(".pdf")) {
    return "pdf";
  }
  if (lowerMime.startsWith("image/")) {
    return "image";
  }
  return "unknown";
}

export async function resolveReceiptUploadIngestion(receipt: File): Promise<ReceiptUploadIngestionResult> {
  const declaredMimeType = normalizeDeclaredMimeType(receipt.type);
  const originalFileBuffer = Buffer.from(await receipt.arrayBuffer());

  if (originalFileBuffer.length <= 0) {
    return {
      ok: false,
      status: 400,
      stage: "empty_upload",
      message: "Receipt file is empty."
    };
  }

  const effectiveMimeType = detectEffectiveMimeType({
    fileBuffer: originalFileBuffer,
    declaredMimeType,
    fileName: receipt.name
  });
  if (!effectiveMimeType) {
    return {
      ok: false,
      status: 415,
      stage: "unsupported_upload",
      message: "Unsupported file type. Please upload a PDF or image receipt."
    };
  }

  const uploadKind = classifyUploadKindFromMimeType(effectiveMimeType);
  if (uploadKind === "unknown") {
    return {
      ok: false,
      status: 415,
      stage: "unsupported_upload",
      message: "Unsupported file type. Please upload a PDF or image receipt."
    };
  }

  if (uploadKind === "pdf") {
    const auditMetadata: ReceiptUploadAuditMetadata = {
      original: {
        fileName: receipt.name,
        declaredMimeType,
        effectiveMimeType,
        size: originalFileBuffer.length,
        width: null,
        height: null
      },
      normalized: {
        mimeType: effectiveMimeType,
        size: originalFileBuffer.length,
        width: null,
        height: null
      },
      normalization: {
        path: "NONE",
        applied: false,
        heicConverted: false,
        orientationCorrected: false,
        resized: false,
        pngConvertedForStability: false
      },
      variants: {
        primary: {
          mimeType: effectiveMimeType,
          size: originalFileBuffer.length,
          width: null,
          height: null,
          preprocessingSteps: ["original"]
        },
        qrEnhanced: null
      }
    };

    return {
      ok: true,
      uploadKind,
      effectiveMimeType,
      fileBuffer: originalFileBuffer,
      imageVariants: null,
      normalizationPath: "NONE",
      normalizationApplied: false,
      auditMetadata
    };
  }

  const originalMetadata = await readImageMetadataSafe(originalFileBuffer);

  let workingBuffer = originalFileBuffer;
  let workingMimeType = effectiveMimeType;
  let heicConverted = false;
  let heicConversionFailed = false;

  if (effectiveMimeType === "image/heic" || effectiveMimeType === "image/heif") {
    try {
      const convertedBuffer = await convertHeicToJpeg(originalFileBuffer);
      workingBuffer = Buffer.from(convertedBuffer);
      workingMimeType = "image/jpeg";
      heicConverted = true;
    } catch {
      heicConversionFailed = true;
    }
  }

  if (heicConversionFailed) {
    return {
      ok: false,
      status: 415,
      stage: "heic_conversion_failed",
      message:
        "HEIC/HEIF image could not be processed in this environment. Please upload or share it as JPEG or PNG."
    };
  }

  try {
    const preNormalize = sharp(workingBuffer, { failOn: "none" });
    const preMetadata = await preNormalize.metadata();
    if (!preMetadata.width || !preMetadata.height) {
      return {
        ok: false,
        status: 415,
        stage: "image_decode_failed",
        message: "Image file could not be processed. Please upload a JPEG, PNG, WEBP, or PDF receipt."
      };
    }

    const orientationCorrected = Number(preMetadata.orientation || 1) > 1;
    const longEdge = Math.max(preMetadata.width, preMetadata.height);
    const resized = longEdge > MAX_IMAGE_LONG_EDGE_PX;
    const pngConvertedForStability =
      workingMimeType === "image/png" &&
      (resized || workingBuffer.length > OVERSIZED_IMAGE_BYTES);
    const normalizationPath = classifyNormalizationPath({
      heicConverted,
      orientationCorrected,
      resized
    });

    const primaryPreprocessingSteps: string[] = [];
    if (heicConverted) {
      primaryPreprocessingSteps.push("heic_to_jpeg");
    }
    if (orientationCorrected) {
      primaryPreprocessingSteps.push("rotate");
    }
    if (resized) {
      primaryPreprocessingSteps.push(`resize_max_${MAX_IMAGE_LONG_EDGE_PX}`);
    }
    if (pngConvertedForStability) {
      primaryPreprocessingSteps.push("png_to_jpeg_for_stability");
    }
    if (primaryPreprocessingSteps.length === 0) {
      primaryPreprocessingSteps.push("original");
    }

    const needsPrimaryTransform = orientationCorrected || resized;
    const shouldReencodePrimary = heicConverted || pngConvertedForStability || needsPrimaryTransform;
    const primaryOutputMimeType = resolvePrimaryOutputMimeType({
      sourceMimeType: workingMimeType,
      heicConverted,
      pngConvertedForStability
    });

    let primaryBuffer = workingBuffer;
    let primaryMimeType = normalizeDeclaredMimeType(workingMimeType);

    if (shouldReencodePrimary) {
      let primaryPipeline = preNormalize.clone();
      if (orientationCorrected) {
        primaryPipeline = primaryPipeline.rotate();
      }
      if (resized) {
        primaryPipeline = primaryPipeline.resize({
          width: MAX_IMAGE_LONG_EDGE_PX,
          height: MAX_IMAGE_LONG_EDGE_PX,
          fit: "inside",
          withoutEnlargement: true
        });
      }
      primaryPipeline = applyOutputEncoding(primaryPipeline, primaryOutputMimeType);
      primaryBuffer = Buffer.from(await primaryPipeline.toBuffer());
      primaryMimeType = primaryOutputMimeType;
    }

    const primaryMetadata = await readImageMetadataSafe(primaryBuffer);
    const normalizationApplied =
      normalizationPath !== "NONE" || pngConvertedForStability || primaryMimeType !== effectiveMimeType;

    const qrEnhancedSteps = [
      ...primaryPreprocessingSteps.filter((step) => step !== "original"),
      "grayscale",
      "normalize",
      "contrast_boost",
      "sharpen"
    ];
    let qrEnhancedBuffer = primaryBuffer;
    let qrEnhancedMimeType = primaryMimeType;
    let qrEnhancedMetadata = primaryMetadata;
    try {
      const enhancedPipeline = sharp(primaryBuffer, { failOn: "none" })
        .grayscale()
        .normalize()
        .linear(1.14, -10)
        .sharpen(1.0)
        .png({ compressionLevel: 7 });
      qrEnhancedBuffer = Buffer.from(await enhancedPipeline.toBuffer());
      qrEnhancedMimeType = "image/png";
      qrEnhancedMetadata = await readImageMetadataSafe(qrEnhancedBuffer);
    } catch {
      qrEnhancedBuffer = primaryBuffer;
      qrEnhancedMimeType = primaryMimeType;
      qrEnhancedMetadata = primaryMetadata;
      qrEnhancedSteps.length = 0;
      qrEnhancedSteps.push(...primaryPreprocessingSteps, "enhanced_fallback_primary");
    }

    const auditMetadata: ReceiptUploadAuditMetadata = {
      original: {
        fileName: receipt.name,
        declaredMimeType,
        effectiveMimeType,
        size: originalFileBuffer.length,
        width: originalMetadata.width,
        height: originalMetadata.height
      },
      normalized: {
        mimeType: primaryMimeType,
        size: primaryBuffer.length,
        width: primaryMetadata.width,
        height: primaryMetadata.height
      },
      normalization: {
        path: normalizationPath,
        applied: normalizationApplied,
        heicConverted,
        orientationCorrected,
        resized,
        pngConvertedForStability
      },
      variants: {
        primary: {
          mimeType: primaryMimeType,
          size: primaryBuffer.length,
          width: primaryMetadata.width,
          height: primaryMetadata.height,
          preprocessingSteps: primaryPreprocessingSteps
        },
        qrEnhanced: {
          mimeType: qrEnhancedMimeType,
          size: qrEnhancedBuffer.length,
          width: qrEnhancedMetadata.width,
          height: qrEnhancedMetadata.height,
          preprocessingSteps: qrEnhancedSteps
        }
      }
    };

    return {
      ok: true,
      uploadKind,
      effectiveMimeType: primaryMimeType,
      fileBuffer: primaryBuffer,
      imageVariants: {
        primary: {
          buffer: primaryBuffer,
          mimeType: primaryMimeType,
          size: primaryBuffer.length,
          width: primaryMetadata.width,
          height: primaryMetadata.height,
          preprocessingSteps: primaryPreprocessingSteps
        },
        qrEnhanced: {
          buffer: qrEnhancedBuffer,
          mimeType: qrEnhancedMimeType,
          size: qrEnhancedBuffer.length,
          width: qrEnhancedMetadata.width,
          height: qrEnhancedMetadata.height,
          preprocessingSteps: qrEnhancedSteps
        }
      },
      normalizationPath,
      normalizationApplied,
      auditMetadata
    };
  } catch {
    return {
      ok: false,
      status: 415,
      stage: "image_decode_failed",
      message: "Image file could not be processed. Please upload a JPEG, PNG, WEBP, or PDF receipt."
    };
  }
}

function normalizeDeclaredMimeType(value: string | null | undefined) {
  const normalized = (value || "").trim().toLowerCase();
  if (!normalized) {
    return "";
  }
  if (normalized === "image/jpg") {
    return "image/jpeg";
  }
  return normalized;
}

function detectEffectiveMimeType({
  fileBuffer,
  declaredMimeType,
  fileName
}: {
  fileBuffer: Buffer;
  declaredMimeType: string;
  fileName: string;
}) {
  const fromBuffer = detectMimeTypeFromBufferSignature(fileBuffer);
  if (fromBuffer) {
    return fromBuffer;
  }

  if (declaredMimeType && acceptedMimeTypes.has(declaredMimeType)) {
    return declaredMimeType;
  }

  const fromExtension = detectMimeTypeFromExtension(fileName);
  if (fromExtension) {
    return fromExtension;
  }

  return "";
}

function detectMimeTypeFromExtension(fileName: string) {
  const lowerName = (fileName || "").toLowerCase().trim();
  if (!lowerName) {
    return "";
  }
  const lastDot = lowerName.lastIndexOf(".");
  if (lastDot < 0) {
    return "";
  }
  const extension = lowerName.slice(lastDot);
  return supportedFileExtensions.get(extension) || "";
}

function detectMimeTypeFromBufferSignature(fileBuffer: Buffer) {
  if (fileBuffer.length >= 5 && fileBuffer.subarray(0, 5).toString("utf8") === "%PDF-") {
    return "application/pdf";
  }

  if (
    fileBuffer.length >= 3 &&
    fileBuffer[0] === 0xff &&
    fileBuffer[1] === 0xd8 &&
    fileBuffer[2] === 0xff
  ) {
    return "image/jpeg";
  }

  if (
    fileBuffer.length >= 8 &&
    fileBuffer[0] === 0x89 &&
    fileBuffer[1] === 0x50 &&
    fileBuffer[2] === 0x4e &&
    fileBuffer[3] === 0x47 &&
    fileBuffer[4] === 0x0d &&
    fileBuffer[5] === 0x0a &&
    fileBuffer[6] === 0x1a &&
    fileBuffer[7] === 0x0a
  ) {
    return "image/png";
  }

  if (
    fileBuffer.length >= 12 &&
    fileBuffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    fileBuffer.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }

  if (fileBuffer.length >= 12 && fileBuffer.subarray(4, 8).toString("ascii") === "ftyp") {
    const majorBrand = fileBuffer.subarray(8, 12).toString("ascii").toLowerCase();
    if (heicFileBrands.has(majorBrand)) {
      return "image/heic";
    }
    if (heifFileBrands.has(majorBrand)) {
      return "image/heif";
    }
  }

  return "";
}

function classifyUploadKindFromMimeType(mimeType: string): "pdf" | "image" | "unknown" {
  if (!mimeType) {
    return "unknown";
  }
  if (mimeType === "application/pdf") {
    return "pdf";
  }
  if (mimeType.startsWith("image/")) {
    return "image";
  }
  return "unknown";
}

function classifyNormalizationPath({
  heicConverted,
  orientationCorrected,
  resized
}: {
  heicConverted: boolean;
  orientationCorrected: boolean;
  resized: boolean;
}): UploadNormalizationPath {
  if (heicConverted && orientationCorrected && resized) {
    return "HEIC_TO_JPEG_ROTATE_AND_RESIZE";
  }
  if (heicConverted && orientationCorrected) {
    return "HEIC_TO_JPEG_AND_ROTATE";
  }
  if (heicConverted && resized) {
    return "HEIC_TO_JPEG_AND_RESIZE";
  }
  if (heicConverted) {
    return "HEIC_TO_JPEG_ONLY";
  }
  if (orientationCorrected && resized) {
    return "ROTATE_AND_RESIZE";
  }
  if (orientationCorrected) {
    return "ROTATE_ONLY";
  }
  if (resized) {
    return "RESIZE_ONLY";
  }
  return "NONE";
}

function resolvePrimaryOutputMimeType({
  sourceMimeType,
  heicConverted,
  pngConvertedForStability
}: {
  sourceMimeType: string;
  heicConverted: boolean;
  pngConvertedForStability: boolean;
}) {
  if (heicConverted || pngConvertedForStability) {
    return "image/jpeg";
  }
  const normalized = normalizeDeclaredMimeType(sourceMimeType);
  if (normalized === "image/jpg") {
    return "image/jpeg";
  }
  return normalized || "image/jpeg";
}

function applyOutputEncoding(pipeline: sharp.Sharp, mimeType: string) {
  if (mimeType === "image/webp") {
    return pipeline.webp({
      quality: 95
    });
  }
  if (mimeType === "image/png") {
    return pipeline.png({
      compressionLevel: 8
    });
  }
  return pipeline.jpeg({
    quality: 96,
    mozjpeg: true
  });
}

async function readImageMetadataSafe(fileBuffer: Buffer) {
  try {
    const metadata = await sharp(fileBuffer, { failOn: "none" }).metadata();
    return {
      width: metadata.width ?? null,
      height: metadata.height ?? null
    };
  } catch {
    return {
      width: null,
      height: null
    };
  }
}

async function convertHeicToJpeg(fileBuffer: Buffer) {
  try {
    const heicModule = await import("heic-convert");
    const converter = ("default" in heicModule ? heicModule.default : heicModule) as unknown;
    if (typeof converter !== "function") {
      throw new Error("HEIC converter module did not expose a conversion function.");
    }
    const converted = await (
      converter as (options: {
        buffer: Buffer;
        format: "JPEG";
        quality: number;
      }) => Promise<Buffer | Uint8Array | ArrayBuffer>
    )({
      buffer: fileBuffer,
      format: "JPEG",
      quality: NORMALIZED_JPEG_QUALITY / 100
    });
    if (Buffer.isBuffer(converted)) {
      return converted;
    }
    if (converted instanceof Uint8Array) {
      return Buffer.from(converted);
    }
    if (converted instanceof ArrayBuffer) {
      return Buffer.from(new Uint8Array(converted));
    }
    return Buffer.from(converted as ArrayBufferLike);
  } catch (error) {
    throw new Error(
      error instanceof Error ? error.message : "HEIC/HEIF conversion failed."
    );
  }
}

export function isAcceptedMimeType(file: File) {
  if (!file.type) {
    return true;
  }
  return acceptedMimeTypes.has(file.type.toLowerCase());
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

export function resolveNormalizationQualityOutcome({
  normalizationApplied,
  extraction
}: {
  normalizationApplied: boolean;
  extraction: {
    header?: unknown;
    lines?: unknown;
    scanStatus?: unknown;
  };
}) {
  if (!normalizationApplied) {
    return "NOT_APPLICABLE" as const;
  }
  const scanStatus = typeof extraction.scanStatus === "string" ? extraction.scanStatus : "UNREADABLE";
  const header = extraction.header && typeof extraction.header === "object" ? (extraction.header as Record<string, unknown>) : null;
  const headerFieldCount = countPopulatedFields(header);
  const lineCount = Array.isArray(extraction.lines) ? extraction.lines.length : 0;
  const completeEnough =
    scanStatus === "COMPLETE" ||
    (scanStatus === "PARTIAL" && (headerFieldCount >= 4 || lineCount > 0));
  return completeEnough ? ("IMPROVED" as const) : ("STILL_FAILED" as const);
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

export async function saveReceiptFile({
  originalFile,
  normalizedFileBuffer,
  normalizedMimeType,
  auditMetadata
}: {
  originalFile: File;
  normalizedFileBuffer: Buffer;
  normalizedMimeType: string;
  auditMetadata: ReceiptUploadAuditMetadata;
}) {
  const uploadsDir = path.join(process.cwd(), "public", "uploads", "inventory-receipts");
  await mkdir(uploadsDir, { recursive: true });
  const normalizedExtension =
    extensionFromMimeType(normalizedMimeType) ||
    (originalFile.name.includes(".") ? originalFile.name.split(".").pop() : "bin") ||
    "bin";
  const safeFileBase = `${Date.now()}-${randomUUID()}`;
  const safeFileName = `${safeFileBase}.${normalizedExtension}`;
  const absoluteFilePath = path.join(uploadsDir, safeFileName);
  const metadataFileName = `${safeFileBase}.meta.json`;
  const metadataPath = path.join(uploadsDir, metadataFileName);
  await writeFile(absoluteFilePath, normalizedFileBuffer);
  await writeFile(
    metadataPath,
    JSON.stringify(
      {
        ...auditMetadata,
        stored: {
          createdAt: new Date().toISOString(),
          storedFileName: safeFileName,
          storedMimeType: normalizedMimeType,
          storedSize: normalizedFileBuffer.length
        }
      },
      null,
      2
    ),
    "utf8"
  );

  return {
    receiptUrl: `/uploads/inventory-receipts/${safeFileName}`,
    receiptFileName: originalFile.name
  };
}

function extensionFromMimeType(mimeType: string) {
  if (mimeType === "application/pdf") {
    return "pdf";
  }
  if (mimeType === "image/jpeg" || mimeType === "image/jpg") {
    return "jpg";
  }
  if (mimeType === "image/png") {
    return "png";
  }
  if (mimeType === "image/webp") {
    return "webp";
  }
  return "";
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
