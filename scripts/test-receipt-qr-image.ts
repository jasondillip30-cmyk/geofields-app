import assert from "node:assert/strict";

import { BarcodeFormat, EncodeHintType, QRCodeWriter } from "@zxing/library";
import sharp from "sharp";

import { extractQrDataFromReceipt } from "@/lib/inventory-receipt-intake-qr-pipeline";

const TRA_VERIFICATION_URL = "https://verify.tra.go.tz/0192C43691_190351";

async function buildSyntheticQrImage(value: string) {
  const hints = new Map<EncodeHintType, unknown>();
  hints.set(EncodeHintType.MARGIN, 4);
  const matrix = new QRCodeWriter().encode(
    value,
    BarcodeFormat.QR_CODE,
    192,
    192,
    hints
  );
  const width = matrix.getWidth();
  const height = matrix.getHeight();
  const pixels = Buffer.alloc(width * height * 4);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const channel = matrix.get(x, y) ? 0 : 255;
      pixels[offset] = channel;
      pixels[offset + 1] = channel;
      pixels[offset + 2] = channel;
      pixels[offset + 3] = 255;
    }
  }

  return sharp(pixels, {
    raw: {
      width,
      height,
      channels: 4
    }
  })
    .png()
    .toBuffer();
}

async function main() {
  const image = await buildSyntheticQrImage(TRA_VERIFICATION_URL);
  const result = await extractQrDataFromReceipt({
    fileBuffer: image,
    mimeType: "image/png",
    mode: "decode-only"
  });

  assert.equal(result.detected, true);
  assert.equal(result.decodeStatus, "DECODED");
  assert.equal(result.rawValue, TRA_VERIFICATION_URL);
  assert.equal(result.normalizedRawValue, TRA_VERIFICATION_URL);
  assert.equal(result.contentType, "TRA_URL");
  assert.equal(result.isTraVerification, true);
  assert.equal(result.verificationUrl, TRA_VERIFICATION_URL);

  console.log("[receipt-qr-image] synthetic TRA QR image decoded successfully.");
}

void main();
