import { extractHeaderFields } from "@/lib/inventory-receipt-intake-ocr";
import type {
  HeaderExtractionResult,
  ReceiptFieldConfidenceMap,
  ReceiptFieldSourceMap,
  ReceiptHeaderExtraction
} from "@/lib/inventory-receipt-intake-types";

export function hasMeaningfulMetadataFromQr(parsed: Partial<ReceiptHeaderExtraction>) {
  const meaningfulKeys: Array<keyof ReceiptHeaderExtraction> = [
    "receiptNumber",
    "verificationCode",
    "tin",
    "supplierName",
    "receiptDate",
    "total"
  ];
  return meaningfulKeys.some((key) => {
    const value = parsed[key];
    if (typeof value === "number") {
      return value > 0;
    }
    return typeof value === "string" && value.trim().length > 0;
  });
}

function hasHeaderFieldValue(value: unknown) {
  if (typeof value === "number") {
    return Number.isFinite(value) && value > 0;
  }
  return typeof value === "string" && value.trim().length > 0;
}

export function listMissingHeaderFields(
  header: Partial<ReceiptHeaderExtraction>,
  fields: Array<keyof ReceiptHeaderExtraction>
) {
  return fields.filter((field) => !hasHeaderFieldValue(header[field]));
}

export function listPresentHeaderFields(
  header: Partial<ReceiptHeaderExtraction>,
  fields: Array<keyof ReceiptHeaderExtraction>
) {
  return fields.filter((field) => hasHeaderFieldValue(header[field]));
}

export function listReadableHeaderFields(
  header: Partial<ReceiptHeaderExtraction>,
  confidence: Partial<ReceiptFieldConfidenceMap>,
  fields: Array<keyof ReceiptHeaderExtraction>
) {
  return fields.filter(
    (field) => hasHeaderFieldValue(header[field]) && confidence[field as keyof ReceiptFieldConfidenceMap] !== "UNREADABLE"
  );
}

export function buildEmptyHeaderResult(fileName: string): HeaderExtractionResult {
  const fallback = extractHeaderFields("", fileName);
  return {
    header: {
      ...fallback.header,
      supplierName: ""
    },
    fieldConfidence: {
      ...fallback.fieldConfidence,
      supplierName: "UNREADABLE"
    }
  };
}

export function mergeHeaderResults({
  qrParsed,
  ocrHeader,
  ocrConfidence
}: {
  qrParsed: Partial<ReceiptHeaderExtraction>;
  ocrHeader: ReceiptHeaderExtraction;
  ocrConfidence: ReceiptFieldConfidenceMap;
}) {
  const mergedHeader = { ...ocrHeader };
  const mergedConfidence = { ...ocrConfidence };
  const mergedSource: ReceiptFieldSourceMap = {
    supplierName: "NONE",
    tin: "NONE",
    vrn: "NONE",
    serialNumber: "NONE",
    receiptNumber: "NONE",
    verificationCode: "NONE",
    receiptDate: "NONE",
    receiptTime: "NONE",
    traReceiptNumber: "NONE",
    invoiceReference: "NONE",
    paymentMethod: "NONE",
    taxOffice: "NONE",
    currency: "NONE",
    subtotal: "NONE",
    tax: "NONE",
    total: "NONE",
    itemCount: "NONE"
  };

  const qrEntries: Array<keyof ReceiptFieldConfidenceMap> = [
    "supplierName",
    "tin",
    "vrn",
    "serialNumber",
    "receiptNumber",
    "verificationCode",
    "receiptDate",
    "receiptTime",
    "traReceiptNumber",
    "invoiceReference",
    "paymentMethod",
    "taxOffice",
    "currency",
    "subtotal",
    "tax",
    "total",
    "itemCount"
  ];

  for (const key of qrEntries) {
    const qrValue = qrParsed[key as keyof ReceiptHeaderExtraction];
    const hasQrValue =
      (typeof qrValue === "string" && qrValue.trim().length > 0) ||
      (typeof qrValue === "number" && Number.isFinite(qrValue) && qrValue > 0);
    if (hasQrValue) {
      // Prefer QR for official metadata when available.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (mergedHeader as any)[key] = qrValue;
      mergedConfidence[key] = "HIGH";
      mergedSource[key] = "QR";
    } else {
      const ocrValue = ocrHeader[key as keyof ReceiptHeaderExtraction];
      const hasOcrValue =
        (typeof ocrValue === "string" && ocrValue.trim().length > 0) ||
        (typeof ocrValue === "number" && Number.isFinite(ocrValue) && ocrValue > 0);
      if (hasOcrValue) {
        mergedConfidence[key] = "MEDIUM";
      }
      mergedSource[key] = hasOcrValue ? "OCR" : "NONE";
    }
  }

  return {
    header: mergedHeader,
    fieldConfidence: mergedConfidence,
    fieldSource: mergedSource
  };
}

export function resolveExtractionMethod({
  qrDetected,
  ocrMethod
}: {
  qrDetected: boolean;
  ocrMethod: "OCR_IMAGE_PREPROCESSED" | "OCR_IMAGE" | "PDF_TEXT" | "NONE";
}): "QR_ONLY" | "QR_PLUS_OCR" | "OCR_IMAGE_PREPROCESSED" | "OCR_IMAGE" | "PDF_TEXT" | "NONE" {
  if (qrDetected && ocrMethod !== "NONE") {
    return "QR_PLUS_OCR";
  }
  if (qrDetected) {
    return "QR_ONLY";
  }
  return ocrMethod;
}
