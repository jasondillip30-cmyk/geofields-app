import type { InventoryCategory } from "@prisma/client";

export type ReceiptFieldConfidence = "HIGH" | "MEDIUM" | "LOW" | "NONE";
export type ReceiptLineConfidence = "HIGH" | "MEDIUM" | "LOW";
export type ReceiptFieldReadability = "HIGH" | "MEDIUM" | "LOW" | "UNREADABLE";
export type ReceiptFieldSource = "QR" | "OCR" | "DERIVED" | "NONE";
export type ReceiptScanStatus = "COMPLETE" | "PARTIAL" | "UNREADABLE";
export type ReceiptType = "INVENTORY_PURCHASE" | "GENERAL_EXPENSE" | "UNCLEAR";
export type ReceiptQrContentType = "TRA_URL" | "URL" | "STRUCTURED_TEXT" | "UNKNOWN" | "NONE";
export type ReceiptQrDecodeStatus = "DECODED" | "NOT_DETECTED" | "DECODE_FAILED";
export type ReceiptQrParseStatus = "PARSED" | "PARTIAL" | "UNPARSED";
export type ReceiptVerificationLookupStatus = "NOT_ATTEMPTED" | "SUCCESS" | "FAILED";
export type ReceiptScanFailureStage =
  | "NONE"
  | "QR_NOT_DETECTED"
  | "QR_DECODE_FAILED"
  | "QR_PARSE_UNPARSED"
  | "TRA_LOOKUP_FAILED";

export interface ReceiptQrStages {
  decode: {
    success: boolean;
    status: ReceiptQrDecodeStatus;
    pass: string;
    reason: string;
  };
  classification: {
    success: boolean;
    type: ReceiptQrContentType;
    isTraUrl: boolean;
  };
  verificationLookup: {
    attempted: boolean;
    success: boolean;
    status: ReceiptVerificationLookupStatus;
    reason: string;
    httpStatus: number | null;
    parsed: boolean;
    fieldsParseStatus: "NOT_ATTEMPTED" | "SUCCESS" | "PARTIAL" | "FAILED";
    lineItemsParseStatus: "NOT_ATTEMPTED" | "SUCCESS" | "PARTIAL" | "FAILED";
    parsedFieldCount: number;
    parsedLineItemsCount: number;
  };
}

export interface ReceiptQrAssistCrop {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ReceiptHeaderExtraction {
  supplierName: string;
  tin: string;
  vrn: string;
  serialNumber: string;
  receiptNumber: string;
  verificationCode: string;
  receiptDate: string;
  receiptTime: string;
  traReceiptNumber: string;
  invoiceReference: string;
  paymentMethod: string;
  taxOffice: string;
  currency: string;
  itemCount: number;
  subtotal: number;
  tax: number;
  total: number;
}

export interface ReceiptFieldConfidenceMap {
  supplierName: ReceiptFieldReadability;
  tin: ReceiptFieldReadability;
  vrn: ReceiptFieldReadability;
  serialNumber: ReceiptFieldReadability;
  receiptNumber: ReceiptFieldReadability;
  verificationCode: ReceiptFieldReadability;
  receiptDate: ReceiptFieldReadability;
  receiptTime: ReceiptFieldReadability;
  traReceiptNumber: ReceiptFieldReadability;
  invoiceReference: ReceiptFieldReadability;
  paymentMethod: ReceiptFieldReadability;
  taxOffice: ReceiptFieldReadability;
  currency: ReceiptFieldReadability;
  subtotal: ReceiptFieldReadability;
  tax: ReceiptFieldReadability;
  total: ReceiptFieldReadability;
  itemCount: ReceiptFieldReadability;
}

export interface ReceiptFieldSourceMap {
  supplierName: ReceiptFieldSource;
  tin: ReceiptFieldSource;
  vrn: ReceiptFieldSource;
  serialNumber: ReceiptFieldSource;
  receiptNumber: ReceiptFieldSource;
  verificationCode: ReceiptFieldSource;
  receiptDate: ReceiptFieldSource;
  receiptTime: ReceiptFieldSource;
  traReceiptNumber: ReceiptFieldSource;
  invoiceReference: ReceiptFieldSource;
  paymentMethod: ReceiptFieldSource;
  taxOffice: ReceiptFieldSource;
  currency: ReceiptFieldSource;
  subtotal: ReceiptFieldSource;
  tax: ReceiptFieldSource;
  total: ReceiptFieldSource;
  itemCount: ReceiptFieldSource;
}

export interface ReceiptLineCandidate {
  description: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  extractionConfidence: ReceiptLineConfidence;
}

export interface ReceiptQrResult {
  detected: boolean;
  rawValue: string;
  normalizedRawValue: string;
  contentType: ReceiptQrContentType;
  isTraVerification: boolean;
  isQrOnlyImage: boolean;
  decodeStatus: ReceiptQrDecodeStatus;
  decodePass: string;
  parseStatus: ReceiptQrParseStatus;
  failureReason: string;
  verificationUrl: string;
  parsedFields: Partial<ReceiptHeaderExtraction>;
  parsedLineCandidates: ReceiptLineCandidate[];
  confidence: ReceiptFieldReadability;
  warnings: string[];
  stages: ReceiptQrStages;
  debug?: {
    imageReceived: boolean;
    imageLoaded: boolean;
    attemptedPasses: string[];
    successfulPass: string;
    variantCount: number;
  };
}

export interface ReceiptScanDiagnostics {
  qrDetected: boolean;
  qrDecodeStatus: ReceiptQrDecodeStatus;
  qrDecodePass: string;
  qrParseStatus: ReceiptQrParseStatus;
  qrFailureReason: string;
  qrContentType: ReceiptQrContentType;
  qrRawValue: string;
  qrNormalizedRawValue: string;
  qrRawLength: number;
  qrRawPreview: string;
  qrRawPayloadFormat:
    | "EMPTY"
    | "URL"
    | "JSON"
    | "QUERY_STRING"
    | "KEY_VALUE"
    | "PERCENT_ENCODED"
    | "BASE64_LIKE"
    | "TEXT";
  qrVerificationUrl: string;
  qrIsTraVerification: boolean;
  qrParsedFieldCount: number;
  qrParsedLineItemsCount: number;
  qrLookupStatus: ReceiptVerificationLookupStatus;
  qrLookupReason: string;
  qrLookupHttpStatus: number | null;
  qrLookupParsed: boolean;
  ocrAttempted: boolean;
  ocrSucceeded: boolean;
  ocrError: string;
  scanStatus: ReceiptScanStatus;
  extractionMethod: string;
  returnedFrom: "qr_tra" | "qr_tra_plus_ocr";
  failureStage: ReceiptScanFailureStage;
}

export interface ReceiptLineMatchSuggestion {
  itemId: string | null;
  itemName: string | null;
  confidence: ReceiptFieldConfidence;
  score: number;
}

export interface ReceiptCategorySuggestion {
  category: InventoryCategory | null;
  confidence: ReceiptFieldConfidence;
  reason: string;
}

export interface ReceiptLineExtraction {
  id: string;
  description: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  extractionConfidence: ReceiptLineConfidence;
  matchSuggestion: ReceiptLineMatchSuggestion;
  categorySuggestion: ReceiptCategorySuggestion;
}

export interface ReceiptExtractionResult {
  header: ReceiptHeaderExtraction;
  fieldConfidence: ReceiptFieldConfidenceMap;
  fieldSource: ReceiptFieldSourceMap;
  lines: ReceiptLineExtraction[];
  warnings: string[];
  rawTextPreview: string;
  extractionMethod: "QR_ONLY" | "QR_PLUS_OCR" | "OCR_IMAGE_PREPROCESSED" | "OCR_IMAGE" | "PDF_TEXT" | "NONE";
  scanStatus: ReceiptScanStatus;
  receiptType: ReceiptType;
  preprocessingApplied: string[];
  qr: ReceiptQrResult;
  intakeDebug: {
    qrDecoded: boolean;
    traLookupSucceeded: boolean;
    traParseSucceeded: boolean;
    ocrAttempted: boolean;
    ocrSucceeded: boolean;
    ocrError: string;
    enrichmentWarning: string;
    returnedFrom: "qr_tra" | "qr_tra_plus_ocr";
    partialEnrichment: boolean;
  };
  scanDiagnostics: ReceiptScanDiagnostics;
  debug?: {
    ocrCandidates: Array<{
      label: string;
      confidence: number;
      score: number;
      textLength: number;
    }>;
  };
}

export interface InventoryReferenceItem {
  id: string;
  name: string;
  sku: string;
  category: InventoryCategory;
}

export interface HeaderExtractionResult {
  header: ReceiptHeaderExtraction;
  fieldConfidence: ReceiptFieldConfidenceMap;
}
