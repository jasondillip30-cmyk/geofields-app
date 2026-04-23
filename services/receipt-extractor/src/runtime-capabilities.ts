import sharp from "sharp";

let cachedCapabilities: {
  checkedAt: string;
  sharp: {
    available: boolean;
    rotate: boolean;
    grayscale: boolean;
    normalize: boolean;
    sharpen: boolean;
    message: string;
  };
  decoders: {
    jsqrAvailable: boolean;
    zxingAvailable: boolean;
  };
} | null = null;

export async function resolveRuntimeCapabilities() {
  if (cachedCapabilities) {
    return cachedCapabilities;
  }

  let sharpAvailable = false;
  let rotate = false;
  let grayscale = false;
  let normalize = false;
  let sharpenEnabled = false;
  let sharpMessage = "";

  try {
    const sample = await sharp({
      create: {
        width: 8,
        height: 8,
        channels: 3,
        background: { r: 255, g: 255, b: 255 }
      }
    })
      .rotate()
      .grayscale()
      .normalize()
      .sharpen(0.6)
      .png()
      .toBuffer();

    sharpAvailable = sample.length > 0;
    rotate = true;
    grayscale = true;
    normalize = true;
    sharpenEnabled = true;
    sharpMessage = "sharp transform chain available";
  } catch (error) {
    sharpAvailable = false;
    sharpMessage = error instanceof Error ? error.message : String(error);
  }

  let jsqrAvailable = false;
  let zxingAvailable = false;
  try {
    await import("jsqr");
    jsqrAvailable = true;
  } catch {
    jsqrAvailable = false;
  }

  try {
    await import("@zxing/library");
    zxingAvailable = true;
  } catch {
    zxingAvailable = false;
  }

  cachedCapabilities = {
    checkedAt: new Date().toISOString(),
    sharp: {
      available: sharpAvailable,
      rotate,
      grayscale,
      normalize,
      sharpen: sharpenEnabled,
      message: sharpMessage
    },
    decoders: {
      jsqrAvailable,
      zxingAvailable
    }
  };

  return cachedCapabilities;
}
