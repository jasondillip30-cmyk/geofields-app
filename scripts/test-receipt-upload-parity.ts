import assert from "node:assert/strict";

import sharp from "sharp";

import { evaluateRequisitionComparison } from "@/components/inventory/receipt-intake-comparison";
import { buildReviewStateFromPayload } from "@/components/inventory/receipt-intake-review-state";
import type { ReceiptIntakePanelProps } from "@/components/inventory/receipt-intake-panel-types";
import { resolveReceiptUploadIngestion } from "@/app/api/inventory/receipt-intake/extract/extract-route-helpers";
import { extractReceiptData } from "@/lib/inventory-receipt-intake";

type AsyncTest = () => Promise<void>;

async function run(name: string, testFn: AsyncTest) {
  try {
    await testFn();
    console.log(`✓ ${name}`);
  } catch (error) {
    console.error(`✗ ${name}`);
    throw error;
  }
}

const emptyInventoryItems = [] as Parameters<typeof extractReceiptData>[0]["inventoryItems"];

function toBlobPart(buffer: Buffer) {
  return Uint8Array.from(buffer);
}

function buildTestRequisition(): NonNullable<ReceiptIntakePanelProps["initialRequisition"]> {
  return {
    id: "req-parity-001",
    requisitionCode: "REQ-PARITY-001",
    type: "INVENTORY_STOCK_UP",
    requestedVendorName: "PETROTZ",
    lineItems: [
      {
        id: "rq-line-1",
        description: "fuel petrol",
        quantity: 20,
        estimatedUnitCost: 20,
        estimatedTotalCost: 400,
        notes: null
      }
    ],
    totals: {
      estimatedTotalCost: 400
    }
  };
}

function buildFakeHeicBuffer() {
  const buffer = Buffer.alloc(64, 0);
  buffer.writeUInt32BE(32, 0);
  buffer.write("ftyp", 4, "ascii");
  buffer.write("heic", 8, "ascii");
  return buffer;
}

function normalizeReviewShape(review: ReturnType<typeof buildReviewStateFromPayload>) {
  return {
    scanStatus: review.scanStatus,
    scanFallbackMode: review.scanFallbackMode,
    warningCount: review.warnings.length,
    lineCount: review.lines.length,
    scannedLineCount: review.scannedSnapshot.lines.length,
    hasSupplier: Boolean(review.supplierName.trim()),
    hasReceiptNumber: Boolean(review.receiptNumber.trim()),
    hasVerificationUrl: Boolean(review.verificationUrl.trim()),
    numericTotal: Number(review.total || 0),
    diagnostics: {
      qrDecodeStatus: review.scanDiagnostics.qrDecodeStatus,
      qrParseStatus: review.scanDiagnostics.qrParseStatus,
      qrLookupStatus: review.scanDiagnostics.qrLookupStatus,
      failureStage: review.scanDiagnostics.failureStage
    }
  };
}

function normalizeComparisonShape(
  comparison: ReturnType<typeof evaluateRequisitionComparison>
) {
  if (!comparison) {
    return null;
  }
  return {
    status: comparison.status,
    canInspectScannedDetails: comparison.canInspectScannedDetails,
    headerRowCount: comparison.headerRows.length,
    approvedLineCount: comparison.approvedLines.length,
    scannedLineCount: comparison.scannedLines.length,
    differenceRowCount: comparison.differenceRows.length
  };
}

async function createBaseReceiptJpegBuffer() {
  return sharp({
    create: {
      width: 1400,
      height: 900,
      channels: 3,
      background: { r: 255, g: 255, b: 255 }
    }
  })
    .jpeg({ quality: 90 })
    .toBuffer();
}

async function main() {
  await run("rejects empty uploads before extraction", async () => {
    const file = new File([new Uint8Array()], "empty.jpg", { type: "image/jpeg" });
    const result = await resolveReceiptUploadIngestion(file);
    assert.equal(result.ok, false);
    if (result.ok) {
      return;
    }
    assert.equal(result.status, 400);
    assert.equal(result.stage, "empty_upload");
  });

  await run("rejects unrecognized uploads before extraction", async () => {
    const file = new File([Buffer.from("not-a-receipt")], "notes.txt", { type: "text/plain" });
    const result = await resolveReceiptUploadIngestion(file);
    assert.equal(result.ok, false);
    if (result.ok) {
      return;
    }
    assert.equal(result.status, 415);
    assert.equal(result.stage, "unsupported_upload");
  });

  await run("returns clear HEIC failure when conversion cannot proceed", async () => {
    const file = new File([toBlobPart(buildFakeHeicBuffer())], "IMG_0001.HEIC", { type: "image/heic" });
    const result = await resolveReceiptUploadIngestion(file);
    assert.equal(result.ok, false);
    if (result.ok) {
      return;
    }
    assert.equal(result.status, 415);
    assert.equal(result.stage, "heic_conversion_failed");
    assert.match(result.message, /jpeg|png/i);
  });

  await run("applies orientation correction with explicit normalization path", async () => {
    const orientedBuffer = await sharp({
      create: {
        width: 1000,
        height: 1400,
        channels: 3,
        background: { r: 240, g: 240, b: 240 }
      }
    })
      .jpeg({ quality: 90 })
      .withMetadata({ orientation: 6 })
      .toBuffer();
    const file = new File([toBlobPart(orientedBuffer)], "orientation.jpg", { type: "image/jpeg" });
    const result = await resolveReceiptUploadIngestion(file);
    assert.equal(result.ok, true);
    if (!result.ok) {
      return;
    }
    assert.equal(result.normalizationPath, "ROTATE_ONLY");
    assert.equal(result.auditMetadata.normalization.orientationCorrected, true);
  });

  await run("resizes large phone-like images with explicit normalization path", async () => {
    const largeBuffer = await sharp({
      create: {
        width: 4200,
        height: 1800,
        channels: 3,
        background: { r: 220, g: 220, b: 220 }
      }
    })
      .png({ compressionLevel: 6 })
      .toBuffer();
    const file = new File([toBlobPart(largeBuffer)], "large.png", { type: "image/png" });
    const result = await resolveReceiptUploadIngestion(file);
    assert.equal(result.ok, true);
    if (!result.ok) {
      return;
    }
    assert.equal(result.normalizationPath, "RESIZE_ONLY");
    assert.equal(result.auditMetadata.normalization.resized, true);
    assert.ok((result.auditMetadata.normalized.width || 0) <= 3200);
    assert.ok((result.auditMetadata.normalized.height || 0) <= 3200);
  });

  await run("allows practical PNG normalization for oversized artifacts", async () => {
    const oversizedPng = await sharp({
      create: {
        width: 2200,
        height: 2200,
        channels: 3,
        background: { r: 127, g: 127, b: 127 }
      }
    })
      .png({ compressionLevel: 0 })
      .toBuffer();
    assert.ok(
      oversizedPng.length > 8 * 1024 * 1024,
      `Expected oversized PNG fixture >8MB, got ${oversizedPng.length} bytes`
    );

    const file = new File([toBlobPart(oversizedPng)], "oversized.png", { type: "image/png" });
    const result = await resolveReceiptUploadIngestion(file);
    assert.equal(result.ok, true);
    if (!result.ok) {
      return;
    }
    assert.equal(result.auditMetadata.normalization.pngConvertedForStability, true);
    assert.equal(result.effectiveMimeType, "image/jpeg");
  });

  await run("laptop and mobile-origin uploads produce parity review/comparison shape", async () => {
    const baseBuffer = await createBaseReceiptJpegBuffer();
    const laptopFile = new File([toBlobPart(baseBuffer)], "receipt-laptop.jpg", { type: "image/jpeg" });
    const mobileOriginFile = new File([toBlobPart(baseBuffer)], "IMG_1765.HEIC", {
      type: "application/octet-stream"
    });

    const laptopIngestion = await resolveReceiptUploadIngestion(laptopFile);
    const mobileIngestion = await resolveReceiptUploadIngestion(mobileOriginFile);
    assert.equal(laptopIngestion.ok, true);
    assert.equal(mobileIngestion.ok, true);
    if (!laptopIngestion.ok || !mobileIngestion.ok) {
      return;
    }

    const [laptopExtraction, mobileExtraction] = await Promise.all([
      extractReceiptData({
        fileBuffer: laptopIngestion.fileBuffer,
        mimeType: laptopIngestion.effectiveMimeType,
        fileName: laptopFile.name,
        inventoryItems: emptyInventoryItems
      }),
      extractReceiptData({
        fileBuffer: mobileIngestion.fileBuffer,
        mimeType: mobileIngestion.effectiveMimeType,
        fileName: mobileOriginFile.name,
        inventoryItems: emptyInventoryItems
      })
    ]);

    const requisition = buildTestRequisition();
    const laptopReview = buildReviewStateFromPayload({
      payload: {
        receipt: {
          url: "/uploads/inventory-receipts/laptop.jpg",
          fileName: laptopFile.name
        },
        extracted: laptopExtraction as unknown as Record<string, unknown>
      },
      receiptFileName: laptopFile.name,
      defaultClientId: "all",
      defaultRigId: "all",
      receiptClassification: "INVENTORY_PURCHASE",
      receiptWorkflowChoice: "STOCK_PURCHASE",
      initialRequisition: requisition
    });
    const mobileReview = buildReviewStateFromPayload({
      payload: {
        receipt: {
          url: "/uploads/inventory-receipts/mobile.jpg",
          fileName: mobileOriginFile.name
        },
        extracted: mobileExtraction as unknown as Record<string, unknown>
      },
      receiptFileName: mobileOriginFile.name,
      defaultClientId: "all",
      defaultRigId: "all",
      receiptClassification: "INVENTORY_PURCHASE",
      receiptWorkflowChoice: "STOCK_PURCHASE",
      initialRequisition: requisition
    });

    assert.deepEqual(normalizeReviewShape(mobileReview), normalizeReviewShape(laptopReview));

    const laptopComparison = evaluateRequisitionComparison(laptopReview, requisition);
    const mobileComparison = evaluateRequisitionComparison(mobileReview, requisition);
    assert.deepEqual(normalizeComparisonShape(mobileComparison), normalizeComparisonShape(laptopComparison));
  });

  console.log("[receipt-upload-parity] all checks passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
