import sharp from "sharp";

import { roundCurrency } from "@/lib/inventory-server";
import {
  cleanupDescription,
  containsAny,
  findCurrency,
  findDate,
  findItemCount,
  findLabeledAmount,
  findPattern,
  findPaymentMethod,
  findTime,
  findTotalAmount,
  lineSkipKeywords,
  normalizeName,
  normalizeWhitespace,
  parseNumberSafe
} from "@/lib/inventory-receipt-intake-parse-utils";
import type {
  HeaderExtractionResult,
  ReceiptFieldConfidenceMap,
  ReceiptFieldReadability,
  ReceiptHeaderExtraction,
  ReceiptLineCandidate
} from "@/lib/inventory-receipt-intake";

export async function buildImageOcrVariants(fileBuffer: Buffer) {
  try {
    const source = sharp(fileBuffer, { failOn: "none" }).rotate();
    const metadata = await source.metadata();
    const targetWidth = metadata.width && metadata.width > 1800 ? 1800 : metadata.width && metadata.width < 1200 ? 1600 : null;
    const resizeConfig = targetWidth
      ? {
          width: targetWidth,
          withoutEnlargement: false
        }
      : null;

    const basePipeline = () => {
      let pipeline = source.clone();
      if (resizeConfig) {
        pipeline = pipeline.resize(resizeConfig);
      }
      return pipeline;
    };

    const variants: Array<{
      label: string;
      preprocessingApplied: string[];
      bufferPromise: Promise<Buffer>;
    }> = [
      {
        label: "original",
        preprocessingApplied: ["original"],
        bufferPromise: basePipeline().toBuffer()
      },
      {
        label: "thermal-enhanced",
        preprocessingApplied: ["grayscale", "normalize", "sharpen", "median", "trim"],
        bufferPromise: basePipeline().grayscale().normalize().sharpen().median(1).trim().toBuffer()
      },
      {
        label: "thermal-threshold",
        preprocessingApplied: ["grayscale", "normalize", "threshold", "trim"],
        bufferPromise: basePipeline().grayscale().normalize().threshold(165).trim().toBuffer()
      },
      {
        label: "contrast-emphasis",
        preprocessingApplied: ["grayscale", "linear-contrast", "sharpen"],
        bufferPromise: basePipeline().grayscale().linear(1.18, -14).sharpen().toBuffer()
      }
    ];

    const resolved: Array<{
      label: string;
      buffer: Buffer;
      preprocessingApplied: string[];
    }> = [];

    for (const variant of variants) {
      try {
        const buffer = await variant.bufferPromise;
        resolved.push({
          label: variant.label,
          buffer,
          preprocessingApplied: variant.preprocessingApplied
        });
      } catch {
        // Skip failed preprocessing variants and continue with others.
      }
    }

    return resolved;
  } catch {
    return [
      {
        label: "original",
        buffer: fileBuffer,
        preprocessingApplied: ["original"]
      }
    ];
  }
}

export function scoreOcrCandidate(text: string, confidence: number) {
  const cleaned = text.trim();
  if (!cleaned) {
    return 0;
  }

  const textLengthScore = Math.min(cleaned.length / 2200, 1) * 0.45;
  const confidenceScore = Math.min(Math.max(confidence, 0) / 100, 1) * 0.35;
  const digits = cleaned.match(/\d/g)?.length ?? 0;
  const alpha = cleaned.match(/[a-z]/gi)?.length ?? 0;
  const numericBalance = digits > 0 && alpha > 0 ? 0.12 : digits > 0 || alpha > 0 ? 0.06 : 0;
  const receiptHintBonus = containsAny(cleaned.toLowerCase(), ["receipt", "tin", "vat", "subtotal", "total"])
    ? 0.08
    : 0;

  return textLengthScore + confidenceScore + numericBalance + receiptHintBonus;
}

export function roundTo(value: number, decimals: number) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

export function extractHeaderFields(text: string, fileName: string): HeaderExtractionResult {
  const lines = text
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter(Boolean);

  const supplierLine =
    lines.find((line) => /[a-z]/i.test(line) && !containsAny(line.toLowerCase(), ["receipt", "invoice", "tin", "tel"])) ||
    "";
  const supplierName = supplierLine || fileName.replace(/\.[^.]+$/, "") || "Unknown Supplier";

  const tin = findPattern(text, [
    /\btin\s*(?:no|number|#)?\s*[:\-]?\s*([0-9]{8,15})\b/i,
    /\btin[:\s]+([0-9]{8,15})\b/i
  ]);
  const vrn = findPattern(text, [
    /\bvrn\s*(?:no|number|#)?\s*[:\-]?\s*([0-9a-z]{8,18})\b/i,
    /\bvat\s*reg(?:istration)?\s*(?:no|number|#)?\s*[:\-]?\s*([0-9a-z]{8,18})\b/i
  ]);
  const serialNumber = findPattern(text, [
    /\bserial\s*(?:no|number|#)?\s*[:\-]?\s*([0-9a-z\-\/]{4,})\b/i,
    /\bs\/n\s*[:\-]?\s*([0-9a-z\-\/]{4,})\b/i
  ]);
  const receiptNumber = findPattern(text, [
    /\breceipt\s*(?:no|number|#)?\s*[:\-]?\s*([0-9a-z\-\/]{4,})\b/i,
    /\brct\s*no\s*[:\-]?\s*([0-9a-z\-\/]{4,})\b/i
  ]);
  const verificationCode = findPattern(text, [
    /\b(?:verification|verify|vcode)\s*(?:code|no|#)?\s*[:\-]?\s*([0-9a-z\-]{4,})\b/i
  ]);
  const receiptDate = findDate(text) || new Date().toISOString().slice(0, 10);
  const receiptTime = findTime(text);
  const traReceiptNumber = findPattern(text, [
    /\b(?:tra\s*)?(?:receipt)\s*(?:no|number|#)?\s*[:\-]?\s*([a-z0-9\-\/]+)/i,
    /\b(?:tra)\s*(?:ref|reference|no|#)?\s*[:\-]?\s*([a-z0-9\-\/]+)/i
  ]);
  const invoiceReference = findPattern(text, [
    /\b(?:invoice|inv|ref(?:erence)?)\s*(?:no|number|#)?\s*[:\-]?\s*([a-z0-9\-\/]+)/i
  ]);
  const paymentMethod = findPaymentMethod(text);
  const taxOffice = findPattern(text, [/\b(?:tax office|office)\s*[:\-]?\s*([a-z0-9\s\-]{4,})/i]);
  const currency = findCurrency(text);
  const subtotal = findLabeledAmount(text, ["sub total", "subtotal"]);
  const tax = findLabeledAmount(text, ["vat", "tax"]);
  const total = findTotalAmount(text, subtotal + tax);
  const itemCount = findItemCount(text);

  const header: ReceiptHeaderExtraction = {
    supplierName: supplierName || "Unknown Supplier",
    tin,
    vrn,
    serialNumber,
    receiptNumber,
    verificationCode,
    receiptDate,
    receiptTime,
    traReceiptNumber,
    invoiceReference,
    paymentMethod,
    taxOffice,
    currency,
    itemCount,
    subtotal: roundCurrency(subtotal),
    tax: roundCurrency(tax),
    total: roundCurrency(total)
  };

  const fieldConfidence: ReceiptFieldConfidenceMap = {
    supplierName: readabilityForText(header.supplierName, { minLength: 3, allowDefaultUnknown: true }),
    tin: readabilityForStructuredId(header.tin),
    vrn: readabilityForStructuredId(header.vrn),
    serialNumber: readabilityForStructuredId(header.serialNumber),
    receiptNumber: readabilityForStructuredId(header.receiptNumber),
    verificationCode: readabilityForStructuredId(header.verificationCode),
    receiptDate: readabilityForDate(header.receiptDate),
    receiptTime: readabilityForTime(header.receiptTime),
    traReceiptNumber: readabilityForStructuredId(header.traReceiptNumber),
    invoiceReference: readabilityForStructuredId(header.invoiceReference),
    paymentMethod: readabilityForText(header.paymentMethod, { minLength: 2 }),
    taxOffice: readabilityForText(header.taxOffice, { minLength: 4 }),
    currency: readabilityForStructuredId(header.currency),
    subtotal: readabilityForAmount(header.subtotal),
    tax: readabilityForAmount(header.tax),
    total: readabilityForAmount(header.total),
    itemCount: readabilityForCount(header.itemCount)
  };

  return {
    header,
    fieldConfidence
  };
}

export function extractLineCandidates(text: string): ReceiptLineCandidate[] {
  const lines = text
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter(Boolean);

  const results: ReceiptLineCandidate[] = [];
  for (const rawLine of lines) {
    const line = normalizeWhitespace(rawLine);
    if (!/[a-z]/i.test(line)) {
      continue;
    }
    if (containsAny(line.toLowerCase(), lineSkipKeywords)) {
      continue;
    }

    const explicit = parseExplicitLinePattern(line);
    if (explicit) {
      results.push(explicit);
      continue;
    }

    const fallback = parseFallbackLinePattern(line);
    if (fallback) {
      results.push(fallback);
    }
  }

  if (results.length === 0) {
    return [];
  }

  return mergeDuplicateLineCandidates(results);
}

function parseExplicitLinePattern(line: string): ReceiptLineCandidate | null {
  const match = line.match(
    /^(.*?)[\s\t]+(\d+(?:[.,]\d+)?)\s*(?:x|@)?\s*(\d[\d,]*(?:\.\d+)?)\s+(\d[\d,]*(?:\.\d+)?)$/i
  );
  if (!match) {
    return null;
  }

  const description = cleanupDescription(match[1] || "");
  const quantity = parseNumberSafe(match[2] || "");
  const unitPrice = parseNumberSafe(match[3] || "");
  const lineTotal = parseNumberSafe(match[4] || "");
  if (!description || quantity <= 0 || unitPrice < 0 || lineTotal < 0) {
    return null;
  }

  return {
    description,
    quantity,
    unitPrice: roundCurrency(unitPrice),
    lineTotal: roundCurrency(lineTotal),
    extractionConfidence: "HIGH"
  };
}

function parseFallbackLinePattern(line: string): ReceiptLineCandidate | null {
  const amountMatches = line.match(/-?\d[\d,]*(?:\.\d+)?/g) || [];
  const amounts = amountMatches.map((token) => parseNumberSafe(token)).filter((value) => Number.isFinite(value) && value > 0);
  if (amounts.length === 0) {
    return null;
  }

  const description = cleanupDescription(line.replace(/-?\d[\d,]*(?:\.\d+)?/g, " "));
  if (!description || description.length < 3) {
    return null;
  }

  if (amounts.length >= 2) {
    const qtyCandidate = amounts[0] <= 1000 ? amounts[0] : 1;
    const lineTotal = amounts[amounts.length - 1];
    let unitPrice = amounts.length >= 3 ? amounts[amounts.length - 2] : lineTotal / Math.max(1, qtyCandidate);
    if (Math.abs(unitPrice - lineTotal) < 0.01 && qtyCandidate > 1) {
      unitPrice = lineTotal / qtyCandidate;
    }
    return {
      description,
      quantity: roundCurrency(Math.max(1, qtyCandidate)),
      unitPrice: roundCurrency(Math.max(0, unitPrice)),
      lineTotal: roundCurrency(Math.max(0, lineTotal)),
      extractionConfidence: "MEDIUM"
    };
  }

  return {
    description,
    quantity: 1,
    unitPrice: roundCurrency(amounts[0]),
    lineTotal: roundCurrency(amounts[0]),
    extractionConfidence: "LOW"
  };
}

function mergeDuplicateLineCandidates(lines: ReceiptLineCandidate[]) {
  const byDescription = new Map<string, ReceiptLineCandidate>();
  for (const line of lines) {
    const key = normalizeName(line.description);
    if (!key) {
      continue;
    }
    const existing = byDescription.get(key);
    if (!existing) {
      byDescription.set(key, line);
      continue;
    }
    const mergedQuantity = roundCurrency(existing.quantity + line.quantity);
    const mergedTotal = roundCurrency(existing.lineTotal + line.lineTotal);
    byDescription.set(key, {
      description: existing.description,
      quantity: mergedQuantity,
      unitPrice: mergedQuantity > 0 ? roundCurrency(mergedTotal / mergedQuantity) : existing.unitPrice,
      lineTotal: mergedTotal,
      extractionConfidence:
        existing.extractionConfidence === "LOW" || line.extractionConfidence === "LOW"
          ? "LOW"
          : existing.extractionConfidence === "MEDIUM" || line.extractionConfidence === "MEDIUM"
            ? "MEDIUM"
            : "HIGH"
    });
  }
  return Array.from(byDescription.values()).slice(0, 80);
}

function readabilityForText(
  value: string,
  options?: {
    minLength?: number;
    allowDefaultUnknown?: boolean;
  }
): ReceiptFieldReadability {
  const normalized = value.trim();
  if (!normalized) {
    return "UNREADABLE";
  }
  if (options?.allowDefaultUnknown && normalized.toLowerCase() === "unknown supplier") {
    return "LOW";
  }
  const minLength = options?.minLength ?? 3;
  if (normalized.length >= Math.max(minLength + 4, 8)) {
    return "HIGH";
  }
  if (normalized.length >= minLength) {
    return "MEDIUM";
  }
  return "LOW";
}

function readabilityForStructuredId(value: string): ReceiptFieldReadability {
  const normalized = value.trim();
  if (!normalized) {
    return "UNREADABLE";
  }
  if (/^[a-z0-9\-\/]{8,}$/i.test(normalized)) {
    return "HIGH";
  }
  if (/^[a-z0-9\-\/]{5,}$/i.test(normalized)) {
    return "MEDIUM";
  }
  return "LOW";
}

function readabilityForDate(value: string): ReceiptFieldReadability {
  if (!value) {
    return "UNREADABLE";
  }
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? "HIGH" : "LOW";
}

function readabilityForTime(value: string): ReceiptFieldReadability {
  if (!value) {
    return "UNREADABLE";
  }
  return /^([01]\d|2[0-3]):[0-5]\d(?:\s[AP]M)?$/.test(value) ? "HIGH" : "LOW";
}

function readabilityForAmount(value: number): ReceiptFieldReadability {
  if (!Number.isFinite(value) || value <= 0) {
    return "UNREADABLE";
  }
  return value >= 1 ? "HIGH" : "LOW";
}

function readabilityForCount(value: number): ReceiptFieldReadability {
  if (!Number.isFinite(value) || value <= 0) {
    return "UNREADABLE";
  }
  return value >= 1 ? "HIGH" : "MEDIUM";
}
