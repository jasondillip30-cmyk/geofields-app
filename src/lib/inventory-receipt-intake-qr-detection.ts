import { BarcodeFormat, BinaryBitmap, DecodeHintType, GlobalHistogramBinarizer, HybridBinarizer, MultiFormatReader, RGBLuminanceSource } from "@zxing/library";
import sharp from "sharp";

import type { ReceiptQrAssistCrop } from "@/lib/inventory-receipt-intake-types";

type QrDecoderFn = (
  data: Uint8ClampedArray,
  width: number,
  height: number,
  options?: { inversionAttempts?: "dontInvert" | "onlyInvert" | "attemptBoth" | "invertFirst" }
) => { data: string } | null;

interface QrDecoderStrategy {
  name: string;
  decode: (data: Uint8ClampedArray, width: number, height: number) => string | null;
}

let cachedQrDecoderStrategies: QrDecoderStrategy[] | undefined;

function createZxingDecoderStrategy(): QrDecoderStrategy | null {
  try {
    const hints = new Map();
    hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.QR_CODE]);
    hints.set(DecodeHintType.TRY_HARDER, true);

    const decodeWithBinarizer = (
      data: Uint8ClampedArray,
      width: number,
      height: number,
      useGlobalBinarizer = false
    ) => {
      const source = new RGBLuminanceSource(data, width, height);
      const bitmap = new BinaryBitmap(
        useGlobalBinarizer ? new GlobalHistogramBinarizer(source) : new HybridBinarizer(source)
      );
      const reader = new MultiFormatReader();
      reader.setHints(hints);
      return reader.decode(bitmap).getText();
    };

    return {
      name: "zxing",
      decode: (data, width, height) => {
        try {
          return decodeWithBinarizer(data, width, height, false);
        } catch {
          // Try alternate binarizer for difficult thermal/low-contrast images.
        }
        try {
          return decodeWithBinarizer(data, width, height, true);
        } catch {
          // Try inverted pixels as a final ZXing pass.
        }
        try {
          const inverted = invertRgbaImageData(data);
          return decodeWithBinarizer(inverted, width, height, false);
        } catch {
          return null;
        }
      }
    };
  } catch {
    return null;
  }
}

async function createJsQrDecoderStrategy(): Promise<QrDecoderStrategy | null> {
  try {
    const qrModule = await import("jsqr");
    const candidate = ("default" in qrModule ? qrModule.default : qrModule) as unknown;
    if (typeof candidate !== "function") {
      return null;
    }
    const decoder = candidate as QrDecoderFn;
    return {
      name: "jsqr",
      decode: (data, width, height) => {
        const decoded = decoder(data, width, height, {
          inversionAttempts: "attemptBoth"
        });
        if (!decoded || typeof decoded.data !== "string") {
          return null;
        }
        return decoded.data;
      }
    };
  } catch {
    return null;
  }
}

export async function getQrDecoderStrategies() {
  if (cachedQrDecoderStrategies) {
    return cachedQrDecoderStrategies;
  }

  const strategies: QrDecoderStrategy[] = [];
  const zxingStrategy = createZxingDecoderStrategy();
  if (zxingStrategy) {
    strategies.push(zxingStrategy);
  }

  const jsQrStrategy = await createJsQrDecoderStrategy();
  if (jsQrStrategy) {
    strategies.push(jsQrStrategy);
  }

  cachedQrDecoderStrategies = strategies;
  return strategies;
}

function invertRgbaImageData(data: Uint8ClampedArray) {
  const inverted = new Uint8ClampedArray(data.length);
  for (let index = 0; index < data.length; index += 4) {
    inverted[index] = 255 - data[index];
    inverted[index + 1] = 255 - data[index + 1];
    inverted[index + 2] = 255 - data[index + 2];
    inverted[index + 3] = data[index + 3];
  }
  return inverted;
}

export async function buildQrDetectionVariants({
  image,
  width,
  height,
  qrAssistCrop
}: {
  image: sharp.Sharp;
  width: number;
  height: number;
  qrAssistCrop?: ReceiptQrAssistCrop | null;
}) {
  const regionVariants = buildQrRegionVariants({
    width,
    height,
    qrAssistCrop
  });
  const enhancementVariants: Array<{
    label: string;
    apply: (pipeline: sharp.Sharp) => sharp.Sharp;
  }> = [
    {
      label: "original",
      apply: (pipeline) => pipeline
    },
    {
      label: "grayscale-contrast",
      apply: (pipeline) => pipeline.grayscale().normalize().linear(1.2, -12)
    },
    {
      label: "grayscale",
      apply: (pipeline) => pipeline.grayscale().normalize()
    },
    {
      label: "contrast-boost",
      apply: (pipeline) => pipeline.grayscale().normalize().linear(1.35, -18)
    },
    {
      label: "sharpen",
      apply: (pipeline) => pipeline.grayscale().normalize().sharpen()
    },
    {
      label: "grayscale-contrast-sharpen",
      apply: (pipeline) => pipeline.grayscale().normalize().linear(1.25, -14).sharpen()
    },
    {
      label: "threshold-150",
      apply: (pipeline) => pipeline.grayscale().normalize().threshold(150)
    },
    {
      label: "threshold-130",
      apply: (pipeline) => pipeline.grayscale().normalize().threshold(130)
    },
    {
      label: "threshold-170",
      apply: (pipeline) => pipeline.grayscale().normalize().threshold(170)
    },
    {
      label: "threshold-180",
      apply: (pipeline) => pipeline.grayscale().normalize().threshold(180)
    },
    {
      label: "threshold-190",
      apply: (pipeline) => pipeline.grayscale().normalize().threshold(190)
    },
    {
      label: "noise-reduced",
      apply: (pipeline) => pipeline.grayscale().normalize().median(1).sharpen()
    },
    {
      label: "denoised",
      apply: (pipeline) => pipeline.grayscale().normalize().median(2)
    }
  ];

  const variants: Array<{ label: string; data: Uint8ClampedArray; width: number; height: number }> = [];
  for (const regionVariant of regionVariants) {
    const baseWidth = regionVariant.extractArea?.width || width;
    const baseHeight = regionVariant.extractArea?.height || height;
    const upscaleFactors = baseWidth < 420 || baseHeight < 420 ? [1, 2, 3, 4] : [1, 2, 3];
    const shouldAddPadding =
      baseWidth < 320 ||
      baseHeight < 320 ||
      regionVariant.key.includes("manual-qr-assist") ||
      regionVariant.key.includes("qr-crop");
    const paddingOptions = shouldAddPadding ? [0, 16, 32] : [0];
    for (const factor of upscaleFactors) {
      for (const enhancementVariant of enhancementVariants) {
        for (const padding of paddingOptions) {
          try {
            let pipeline = image.clone();
            if (regionVariant.extractArea) {
              pipeline = pipeline.extract(regionVariant.extractArea);
            }

            const targetWidth =
              factor === 1
                ? Math.min(baseWidth, 2200)
                : Math.min(Math.max(Math.round(baseWidth * factor), 700), 3000);
            if (targetWidth > 0 && targetWidth !== baseWidth) {
              pipeline = pipeline.resize({
                width: targetWidth,
                withoutEnlargement: false,
                kernel: sharp.kernel.nearest
              });
            }

            let rendered = enhancementVariant.apply(pipeline).ensureAlpha();
            if (padding > 0) {
              rendered = rendered.extend({
                top: padding,
                bottom: padding,
                left: padding,
                right: padding,
                background: {
                  r: 255,
                  g: 255,
                  b: 255,
                  alpha: 1
                }
              });
            }

            const variantMeta = await rendered.metadata();
            const raw = await rendered.raw().toBuffer();
            if (!variantMeta.width || !variantMeta.height) {
              continue;
            }
            variants.push({
              label: `${regionVariant.key}-${enhancementVariant.label}-${factor}x-pad${padding}`,
              data: new Uint8ClampedArray(raw),
              width: variantMeta.width,
              height: variantMeta.height
            });
          } catch {
            // ignore variant failure and continue
          }
        }
      }
    }
  }

  return variants;
}

function buildQrRegionVariants({
  width,
  height,
  qrAssistCrop
}: {
  width: number;
  height: number;
  qrAssistCrop?: ReceiptQrAssistCrop | null;
}) {
  const variants: Array<{
    key: string;
    extractArea: { left: number; top: number; width: number; height: number } | null;
  }> = [];
  const used = new Set<string>();

  const pushRegion = ({
    key,
    x,
    y,
    cropWidth,
    cropHeight
  }: {
    key: string;
    x: number;
    y: number;
    cropWidth: number;
    cropHeight: number;
  }) => {
    const area = toPixelCrop({
      imageWidth: width,
      imageHeight: height,
      x,
      y,
      cropWidth,
      cropHeight
    });
    if (!area) {
      return;
    }
    const dedupeKey = `${area.left}:${area.top}:${area.width}:${area.height}`;
    if (used.has(dedupeKey)) {
      return;
    }
    used.add(dedupeKey);
    variants.push({
      key,
      extractArea: area
    });
  };

  if (isValidQrAssistCrop(qrAssistCrop)) {
    pushRegion({
      key: "manual-qr-assist",
      x: qrAssistCrop.x,
      y: qrAssistCrop.y,
      cropWidth: qrAssistCrop.width,
      cropHeight: qrAssistCrop.height
    });
  }

  if (looksLikeQrOnlyImage(width, height)) {
    pushRegion({
      key: "qr-crop-full",
      x: 0,
      y: 0,
      cropWidth: 1,
      cropHeight: 1
    });
    pushRegion({
      key: "qr-crop-centered",
      x: 0.05,
      y: 0.05,
      cropWidth: 0.9,
      cropHeight: 0.9
    });
    return variants.length > 0
      ? variants
      : [
          {
            key: "fallback-full",
            extractArea: null
          }
        ];
  }

  pushRegion({
    key: "full-image",
    x: 0,
    y: 0,
    cropWidth: 1,
    cropHeight: 1
  });
  pushRegion({
    key: "bottom-half",
    x: 0,
    y: 0.45,
    cropWidth: 1,
    cropHeight: 0.55
  });
  pushRegion({
    key: "bottom-third",
    x: 0,
    y: 0.62,
    cropWidth: 1,
    cropHeight: 0.38
  });
  pushRegion({
    key: "bottom-center",
    x: 0.15,
    y: 0.52,
    cropWidth: 0.7,
    cropHeight: 0.45
  });
  pushRegion({
    key: "bottom-right",
    x: 0.48,
    y: 0.48,
    cropWidth: 0.52,
    cropHeight: 0.52
  });
  pushRegion({
    key: "center",
    x: 0.18,
    y: 0.18,
    cropWidth: 0.64,
    cropHeight: 0.64
  });

  const bottomWindowRows = [0.52, 0.62];
  const bottomWindowColumns = [0, 0.25, 0.5];
  for (const rowStart of bottomWindowRows) {
    for (const columnStart of bottomWindowColumns) {
      pushRegion({
        key: `bottom-window-${rowStart}-${columnStart}`,
        x: columnStart,
        y: rowStart,
        cropWidth: 0.5,
        cropHeight: 0.38
      });
    }
  }

  return variants.length > 0
    ? variants
    : [
        {
          key: "fallback-full",
          extractArea: null
        }
      ];
}

function toPixelCrop({
  imageWidth,
  imageHeight,
  x,
  y,
  cropWidth,
  cropHeight
}: {
  imageWidth: number;
  imageHeight: number;
  x: number;
  y: number;
  cropWidth: number;
  cropHeight: number;
}) {
  if (imageWidth <= 0 || imageHeight <= 0) {
    return null;
  }

  const normalizedX = clamp01(x);
  const normalizedY = clamp01(y);
  const normalizedWidth = clamp01(cropWidth);
  const normalizedHeight = clamp01(cropHeight);
  if (normalizedWidth <= 0 || normalizedHeight <= 0) {
    return null;
  }

  const left = Math.max(0, Math.floor(normalizedX * imageWidth));
  const top = Math.max(0, Math.floor(normalizedY * imageHeight));
  const rawWidth = Math.floor(normalizedWidth * imageWidth);
  const rawHeight = Math.floor(normalizedHeight * imageHeight);
  const width = Math.min(imageWidth - left, Math.max(rawWidth, 48));
  const height = Math.min(imageHeight - top, Math.max(rawHeight, 48));
  if (width < 48 || height < 48) {
    return null;
  }

  return {
    left,
    top,
    width,
    height
  };
}

export function isValidQrAssistCrop(value: ReceiptQrAssistCrop | null | undefined): value is ReceiptQrAssistCrop {
  if (!value) {
    return false;
  }
  const numbers = [value.x, value.y, value.width, value.height];
  if (numbers.some((entry) => !Number.isFinite(entry))) {
    return false;
  }
  if (value.width <= 0 || value.height <= 0) {
    return false;
  }
  if (value.x >= 1 || value.y >= 1) {
    return false;
  }
  if (value.x + value.width <= 0 || value.y + value.height <= 0) {
    return false;
  }
  return true;
}

function clamp01(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  if (value < 0) {
    return 0;
  }
  if (value > 1) {
    return 1;
  }
  return value;
}

export function looksLikeQrOnlyImage(width: number, height: number) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return false;
  }
  const ratio = width / height;
  const maxDimension = Math.max(width, height);
  return ratio >= 0.65 && ratio <= 1.55 && maxDimension <= 1400;
}

export function truncateQrLogValue(value: string, maxLength = 500) {
  if (!value) {
    return "";
  }
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength - 3)}...`;
}
