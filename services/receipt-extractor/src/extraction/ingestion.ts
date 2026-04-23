import sharp from "sharp";

const MAX_IMAGE_LONG_EDGE_PX = Number(process.env.EXTRACTOR_MAX_LONG_EDGE_PX || 3200);
const NORMALIZED_JPEG_QUALITY = Number(process.env.EXTRACTOR_JPEG_QUALITY || 92);
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

const heicFileBrands = new Set(["heic", "heix", "hevc", "hevx", "heim", "heis"]);
const heifFileBrands = new Set(["mif1", "msf1", "heif"]);

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

  if (fileBuffer.length >= 3 && fileBuffer[0] === 0xff && fileBuffer[1] === 0xd8 && fileBuffer[2] === 0xff) {
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
    return pipeline.webp({ quality: 95 });
  }
  if (mimeType === "image/png") {
    return pipeline.png({ compressionLevel: 8 });
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
    throw new Error(error instanceof Error ? error.message : "HEIC/HEIF conversion failed.");
  }
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
