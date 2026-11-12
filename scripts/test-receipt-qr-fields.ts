import assert from "node:assert/strict";

import { BarcodeFormat, EncodeHintType, QRCodeWriter } from "@zxing/library";
import sharp from "sharp";

import { extractReceiptData } from "../src/lib/inventory-receipt-intake";
import { parseQrPayload } from "../src/lib/inventory-receipt-intake-qr";

const fixture = {
  supplier: "Synthetic QA Supplies",
  receiptNumber: "GF-QA-0001",
  date: "2026-11-12",
  total: 123.45
};
const raw = JSON.stringify(fixture);
const expected = {
  supplierName: fixture.supplier,
  receiptNumber: fixture.receiptNumber,
  receiptDate: fixture.date,
  total: fixture.total
};

function assertFields(fields: Partial<typeof expected>) {
  assert.equal(fields.supplierName, expected.supplierName);
  assert.equal(fields.receiptNumber, expected.receiptNumber);
  assert.equal(fields.receiptDate, expected.receiptDate);
  assert.equal(fields.total, expected.total);
}

async function main() {
  const json = parseQrPayload(raw);
  assert.equal(json.contentType, "STRUCTURED_TEXT");
  assert.equal(json.rawValue, raw);
  assertFields(json.parsedFields);
  assertFields(parseQrPayload(encodeURIComponent(raw)).parsedFields);

  const partial = parseQrPayload(JSON.stringify({ supplier: "QA  Parts %20" }));
  assert.equal(partial.parsedFields.supplierName, "QA  Parts %20");
  assert.equal(partial.parsedFields.receiptNumber, undefined);
  assert.equal(partial.parseStatus, "PARTIAL");

  const traUrl = "https://verify.tra.go.tz/0192C43691_190351";
  const linked = parseQrPayload(JSON.stringify({ ...fixture, verificationUrl: traUrl + "?receiptNo=OTHER" }));
  assertFields(linked.parsedFields);
  assert.equal(linked.verificationUrl, traUrl + "?receiptNo=OTHER");
  assert.equal(linked.isTraVerification, true);
  assert.equal(parseQrPayload(traUrl).contentType, "TRA_URL");
  const text = parseQrPayload("receiptNumber=GF-QA-0001;date=2026-11-12;total=123.45;supplier=Synthetic QA Supplies");
  assertFields(text.parsedFields);

  const size = 360;
  const qr = new QRCodeWriter().encode(raw, BarcodeFormat.QR_CODE, size, size, new Map([[EncodeHintType.MARGIN, 4]]));
  const pixels = Buffer.alloc(size * size, 255);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (qr.get(x, y)) pixels[y * size + x] = 0;
    }
  }
  const fileBuffer = await sharp(pixels, { raw: { width: size, height: size, channels: 1 } }).png().toBuffer();
  const extraction = await extractReceiptData({
    fileBuffer,
    mimeType: "image/png",
    fileName: "synthetic-qr.png",
    inventoryItems: []
  });
  assert.equal(extraction.qr.decodeStatus, "DECODED");
  assert.equal(extraction.qr.rawValue, raw);
  assertFields(extraction.header);
  assert.deepEqual(extraction.lines, []);
  console.log("Receipt QR fields passed: JSON, encoded JSON, partial JSON, TRA URL, plain text and full image extraction.");
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
