import sharp from "sharp";

import { parsePdfTextSafely } from "@/lib/inventory-receipt-intake-ocr-enrichment";
import { roundTo } from "@/lib/inventory-receipt-intake-ocr";
import {
  buildQrFailureResult,
  detectQrContentType,
  extractUrl,
  extractVerificationUrlCandidate,
  isTraVerificationUrl,
  mergeParsedFields,
  normalizeDecodedQrValue,
  parseGenericKeyValueText,
  parseQrFromUrl,
  parseQrKeyValueText,
  parseQrPayload,
  toUrl
} from "@/lib/inventory-receipt-intake-qr";
import {
  buildQrDetectionVariants,
  getQrDecoderStrategies,
  isValidQrAssistCrop,
  looksLikeQrOnlyImage,
  truncateQrLogValue
} from "@/lib/inventory-receipt-intake-qr-detection";
import {
  buildTraParseContext,
  countParsedFields,
  extractTraCriticalFields,
  extractTraLabelValuePairs,
  extractTraLineCandidates,
  mapTraLabelToField,
  normalizeTraFinancialFields,
  sanitizeTraFieldValue,
  selectBestTraFieldCandidates
} from "@/lib/inventory-receipt-intake-tra";
import { containsAny } from "@/lib/inventory-receipt-intake-parse-utils";
import type {
  ReceiptHeaderExtraction,
  ReceiptLineCandidate,
  ReceiptQrAssistCrop,
  ReceiptQrContentType,
  ReceiptQrDecodeStatus,
  ReceiptQrResult,
  ReceiptVerificationLookupStatus
} from "@/lib/inventory-receipt-intake-types";
import { debugLog } from "@/lib/observability";

interface TraLookupResult {
  attempted: boolean;
  success: boolean;
  status: ReceiptVerificationLookupStatus;
  reason: string;
  httpStatus: number | null;
  parsed: boolean;
  parsedFields: Partial<ReceiptHeaderExtraction>;
  parsedLineCandidates: ReceiptLineCandidate[];
  fieldsParseStatus: "NOT_ATTEMPTED" | "SUCCESS" | "PARTIAL" | "FAILED";
  lineItemsParseStatus: "NOT_ATTEMPTED" | "SUCCESS" | "PARTIAL" | "FAILED";
  parsedFieldCount: number;
  parsedLineItemsCount: number;
  debugRawTextPreview: string;
  debugFieldCandidates: Array<{ field: string; value: string; confidence: number; source: string }>;
}

const PDF_MODULE_WARNING_PREFIX = "[PDF_MODULE_ERROR]";

export async function extractQrDataFromReceipt({
  fileBuffer,
  mimeType,
  qrAssistCrop = null,
  mode = "full"
}: {
  fileBuffer: Buffer;
  mimeType: string;
  qrAssistCrop?: ReceiptQrAssistCrop | null;
  mode?: "full" | "decode-only";
}): Promise<ReceiptQrResult> {
  if (process.env.NODE_ENV !== "production") {
    debugLog("[inventory][receipt-intake][qr][stage]", {
      stage: "image_received",
      mimeType,
      fileBytes: fileBuffer.length
    });
  }
  if (mimeType.includes("pdf")) {
    const parsedPdf = await parsePdfTextSafely(fileBuffer, "qr");
    if (parsedPdf.ok) {
      const maybeUrl = extractUrl(parsedPdf.text);
      if (maybeUrl) {
        return resolveQrDecodedResult({
          rawValue: maybeUrl,
          decodePass: "pdf-text-url",
          attemptedPasses: ["pdf-text-url"],
          variantCount: 1,
          mode
        });
      }
      if (containsAny(parsedPdf.text.toLowerCase(), ["verification", "receipt", "tin", "vat"])) {
        return resolveQrDecodedResult({
          rawValue: parsedPdf.text,
          decodePass: "pdf-text-structured",
          attemptedPasses: ["pdf-text-structured"],
          variantCount: 1,
          mode
        });
      }
      return buildQrFailureResult({
        decodeStatus: "NOT_DETECTED",
        failureReason: "No QR detected",
        warnings: ["QR not detected in the uploaded document. Continuing with OCR fallback."],
        imageLoaded: true,
        attemptedPasses: ["pdf-text"],
        variantCount: 1
      });
    }
    const pdfWarning = `${PDF_MODULE_WARNING_PREFIX} ${parsedPdf.message || "PDF parser unavailable."}`;
    return buildQrFailureResult({
      decodeStatus: "NOT_DETECTED",
      failureReason: "No QR detected",
      warnings: [pdfWarning, "Unable to decode QR from PDF. Try exporting the receipt as an image."],
      imageLoaded: false,
      attemptedPasses: ["pdf-text"],
      variantCount: 1
    });
  }

  try {
    const image = sharp(fileBuffer, { failOn: "none" }).rotate();
    const metadata = await image.metadata();
    const isQrOnlyCandidate = Boolean(
      metadata.width && metadata.height && looksLikeQrOnlyImage(metadata.width, metadata.height)
    );
    if (!metadata.width || !metadata.height) {
      return buildQrFailureResult({
        decodeStatus: "NOT_DETECTED",
        failureReason: "No QR detected",
        warnings: ["QR not detected. Continuing with OCR fallback."],
        imageLoaded: false,
        isQrOnlyImage: isQrOnlyCandidate
      });
    }

    const qrVariants = await buildQrDetectionVariants({
      image,
      width: metadata.width,
      height: metadata.height,
      qrAssistCrop
    });
    if (process.env.NODE_ENV !== "production") {
      debugLog("[inventory][receipt-intake][qr][stage]", {
        stage: "image_loaded",
        width: metadata.width,
        height: metadata.height,
        isQrOnlyCandidate
      });
      debugLog("[inventory][receipt-intake][qr][stage]", {
        stage: "preprocessing_applied",
        variantCount: qrVariants.length,
        samplePasses: qrVariants.slice(0, 8).map((variant) => variant.label)
      });
    }
    const decoderStrategies = await getQrDecoderStrategies();
    if (decoderStrategies.length === 0) {
      return buildQrFailureResult({
        decodeStatus: "DECODE_FAILED",
        failureReason: "QR detected but decode failed",
        warnings: ["QR decoder is unavailable. Continuing with OCR fallback."],
        isQrOnlyImage: isQrOnlyCandidate,
        attemptedPasses: qrVariants.map((variant) => variant.label).slice(0, 100),
        variantCount: qrVariants.length
      });
    }
    if (process.env.NODE_ENV !== "production") {
      debugLog("[inventory][receipt-intake][qr][decode]", {
        stage: "decode_started",
        decoderStrategies: decoderStrategies.map((strategy) => strategy.name),
        variantCount: qrVariants.length
      });
    }

    const attemptLabels: string[] = [];
    for (const variant of qrVariants) {
      for (const decoderStrategy of decoderStrategies) {
        const attemptLabel = `${variant.label}|${decoderStrategy.name}`;
        attemptLabels.push(attemptLabel);
        const decodedRaw = decoderStrategy.decode(variant.data, variant.width, variant.height);
        if (!decodedRaw) {
          continue;
        }
        const parsedResult = await resolveQrDecodedResult({
          rawValue: decodedRaw,
          decodePass: attemptLabel,
          isQrOnlyImage: isQrOnlyCandidate,
          attemptedPasses: attemptLabels,
          variantCount: qrVariants.length,
          mode
        });
        if (process.env.NODE_ENV !== "production") {
          debugLog("[inventory][receipt-intake][qr][decode]", {
            stage: "decode_result",
            detected: true,
            pass: attemptLabel,
            decoder: decoderStrategy.name,
            rawQrContent: truncateQrLogValue(decodedRaw)
          });
        }
        return parsedResult;
      }
    }

    const likelyQrRegion =
      isValidQrAssistCrop(qrAssistCrop) || isQrOnlyCandidate;
    const decodeStatus: ReceiptQrDecodeStatus = likelyQrRegion ? "DECODE_FAILED" : "NOT_DETECTED";
    const failureMessage =
      decodeStatus === "DECODE_FAILED"
        ? "QR detected but could not be decoded. Try a clearer crop or continue manually."
        : "QR not detected. Continuing with OCR fallback.";
    if (process.env.NODE_ENV !== "production") {
      debugLog("[inventory][receipt-intake][qr][decode]", {
        stage: "decode_result",
        detected: false,
        decodeStatus,
        attemptedPasses: attemptLabels.slice(0, 50),
        decoderStrategies: decoderStrategies.map((strategy) => strategy.name)
      });
    }

    return buildQrFailureResult({
      decodeStatus,
      failureReason: decodeStatus === "DECODE_FAILED" ? "QR detected but decode failed" : "No QR detected",
      isQrOnlyImage: isQrOnlyCandidate,
      attemptedPasses: attemptLabels,
      variantCount: qrVariants.length,
      warnings: isValidQrAssistCrop(qrAssistCrop)
        ? ["Manual QR area could not be decoded. Continuing with OCR fallback.", failureMessage]
        : [failureMessage]
    });
  } catch {
    return buildQrFailureResult({
      decodeStatus: "DECODE_FAILED",
      failureReason: "QR detected but decode failed",
      warnings: ["QR detected but could not be decoded. Continuing with OCR fallback."],
      imageLoaded: false
    });
  }
}

async function resolveQrDecodedResult({
  rawValue,
  decodePass,
  isQrOnlyImage = false,
  attemptedPasses = [],
  variantCount = 0,
  mode
}: {
  rawValue: string;
  decodePass: string;
  isQrOnlyImage?: boolean;
  attemptedPasses?: string[];
  variantCount?: number;
  mode: "full" | "decode-only";
}) {
  logDecodedRawPayload(rawValue, decodePass);
  if (mode === "decode-only") {
    return buildDecodeOnlyQrResult({
      rawValue,
      decodePass,
      isQrOnlyImage,
      attemptedPasses,
      variantCount
    });
  }

  return finalizeQrResult(
    parseQrPayload(rawValue, {
      decodePass,
      isQrOnlyImage,
      attemptedPasses,
      variantCount
    })
  );
}

function logDecodedRawPayload(rawValue: string, decodePass: string) {
  const exactRaw = typeof rawValue === "string" ? rawValue : "";
  const preview = truncateQrLogValue(exactRaw, 200);
  debugLog("[inventory][receipt-intake][qr][raw-decoder]", {
    detected: true,
    decodeSucceeded: exactRaw.length > 0,
    decodePass: decodePass || "unknown",
    rawLength: exactRaw.length,
    rawPreview: preview
  });
}

function buildDecodeOnlyQrResult({
  rawValue,
  decodePass,
  isQrOnlyImage,
  attemptedPasses,
  variantCount
}: {
  rawValue: string;
  decodePass: string;
  isQrOnlyImage: boolean;
  attemptedPasses: string[];
  variantCount: number;
}): ReceiptQrResult {
  const rawDecodedValue = typeof rawValue === "string" ? rawValue : "";
  const normalizedRaw = normalizeDecodedQrValue(rawDecodedValue);
  const contentType = detectQrContentType(normalizedRaw);
  const verificationUrl =
    contentType === "URL"
      ? toUrl(normalizedRaw)?.toString() || ""
      : extractVerificationUrlCandidate(normalizedRaw);
  const isTraVerification = isTraVerificationUrl(verificationUrl);
  const classifiedType: ReceiptQrContentType =
    contentType === "URL" && isTraVerification ? "TRA_URL" : contentType;

  return {
    detected: true,
    rawValue: rawDecodedValue,
    normalizedRawValue: normalizedRaw,
    contentType: classifiedType,
    isTraVerification,
    isQrOnlyImage,
    decodeStatus: "DECODED",
    decodePass,
    parseStatus: "UNPARSED",
    failureReason: "",
    verificationUrl,
    parsedFields: {},
    parsedLineCandidates: [],
    confidence: "LOW",
    warnings: ["Decode-only mode: receipt parsing was skipped."],
    stages: {
      decode: {
        success: true,
        status: "DECODED",
        pass: decodePass,
        reason: ""
      },
      classification: {
        success: true,
        type: classifiedType,
        isTraUrl: isTraVerification
      },
      verificationLookup: {
        attempted: false,
        success: false,
        status: "NOT_ATTEMPTED",
        reason: "Decode-only mode",
        httpStatus: null,
        parsed: false,
        fieldsParseStatus: "NOT_ATTEMPTED",
        lineItemsParseStatus: "NOT_ATTEMPTED",
        parsedFieldCount: 0,
        parsedLineItemsCount: 0
      }
    },
    debug: {
      imageReceived: true,
      imageLoaded: true,
      attemptedPasses,
      successfulPass: decodePass,
      variantCount
    }
  };
}

async function finalizeQrResult(qrResult: ReceiptQrResult): Promise<ReceiptQrResult> {
  if (!qrResult.detected || !qrResult.isTraVerification || !qrResult.verificationUrl) {
    return qrResult;
  }

  const lookup = await attemptTraVerificationLookup(qrResult.verificationUrl);
  const mergedParsedFields = mergeParsedFields(qrResult.parsedFields, lookup.parsedFields);
  const mergedWarnings = Array.from(
    new Set([
      ...qrResult.warnings,
      lookup.status === "FAILED" ? "TRA verification lookup returned limited data and needs review." : "",
      lookup.success && !lookup.parsed
        ? "TRA verification lookup succeeded, but parsing returned limited fields."
        : "",
      lookup.status === "SUCCESS" && lookup.fieldsParseStatus === "PARTIAL"
        ? "TRA fields were parsed partially. Please review mapped values."
        : "",
      lookup.status === "SUCCESS" && lookup.lineItemsParseStatus === "FAILED"
        ? "TRA line items were not detected automatically. Add or confirm line items manually."
        : ""
    ].filter(Boolean))
  );

  return {
    ...qrResult,
    parsedFields: mergedParsedFields,
    parsedLineCandidates:
      lookup.parsedLineCandidates.length > 0 ? lookup.parsedLineCandidates : qrResult.parsedLineCandidates,
    warnings: mergedWarnings,
    stages: {
      ...qrResult.stages,
      verificationLookup: {
        attempted: lookup.attempted,
        success: lookup.success,
        status: lookup.status,
        reason: lookup.reason,
        httpStatus: lookup.httpStatus,
        parsed: lookup.parsed,
        fieldsParseStatus: lookup.fieldsParseStatus,
        lineItemsParseStatus: lookup.lineItemsParseStatus,
        parsedFieldCount: lookup.parsedFieldCount,
        parsedLineItemsCount: lookup.parsedLineItemsCount
      }
    }
  };
}

async function attemptTraVerificationLookup(url: string): Promise<TraLookupResult> {
  const target = toUrl(url);
  if (!target || !isTraVerificationUrl(url)) {
    return {
      attempted: false,
      success: false,
      status: "NOT_ATTEMPTED",
      reason: "",
      httpStatus: null,
      parsed: false,
      parsedFields: {},
      parsedLineCandidates: [],
      fieldsParseStatus: "NOT_ATTEMPTED",
      lineItemsParseStatus: "NOT_ATTEMPTED",
      parsedFieldCount: 0,
      parsedLineItemsCount: 0,
      debugRawTextPreview: "",
      debugFieldCandidates: []
    };
  }

  try {
    if (process.env.NODE_ENV !== "production") {
      debugLog("[inventory][receipt-intake][tra-lookup][request]", { url: target.toString() });
    }
    const renderedLookup = await fetchTraRenderedHtml(target.toString());
    const body = renderedLookup.html;
    const parsedLookup = parseTraLookupResponse({ url: target, body });
    const parsedFields = parsedLookup.parsedFields;
    const parsedCount = countParsedFields(parsedFields);
    const parsed = parsedCount > 0;
    const success = renderedLookup.ok;
    const reason = success
      ? parsed
        ? ""
        : "Lookup response could not be parsed"
      : renderedLookup.error || `Lookup failed with status ${renderedLookup.httpStatus ?? "unknown"}`;

    if (process.env.NODE_ENV !== "production") {
      debugLog("[inventory][receipt-intake][tra-lookup][response]", {
        status: renderedLookup.httpStatus,
        ok: renderedLookup.ok,
        source: renderedLookup.source,
        htmlLength: body.length,
        containsReceipt: renderedLookup.containsReceipt,
        containsTin: renderedLookup.containsTin,
        containsPurchasedItems: renderedLookup.containsPurchasedItems,
        parsed,
        parsedCount,
        lineItems: parsedLookup.parsedLineCandidates.length,
        fieldsParseStatus: parsedLookup.fieldsParseStatus,
        lineItemsParseStatus: parsedLookup.lineItemsParseStatus
      });
      debugLog("[inventory][receipt-intake][tra-lookup][mapped-fields]", parsedFields);
      if (parsedLookup.debugRawTextPreview) {
        debugLog("[inventory][receipt-intake][tra-lookup][raw-text-preview]", {
          preview: parsedLookup.debugRawTextPreview
        });
      }
      if (parsedLookup.debugFieldCandidates.length > 0) {
        debugLog("[inventory][receipt-intake][tra-lookup][field-candidates]", {
          candidates: parsedLookup.debugFieldCandidates.slice(0, 20)
        });
      }
    }

    return {
      attempted: true,
      success,
      status: success ? "SUCCESS" : "FAILED",
      reason,
      httpStatus: renderedLookup.httpStatus,
      parsed,
      parsedFields,
      parsedLineCandidates: parsedLookup.parsedLineCandidates,
      fieldsParseStatus: parsedLookup.fieldsParseStatus,
      lineItemsParseStatus: parsedLookup.lineItemsParseStatus,
      parsedFieldCount: parsedCount,
      parsedLineItemsCount: parsedLookup.parsedLineCandidates.length,
      debugRawTextPreview: parsedLookup.debugRawTextPreview,
      debugFieldCandidates: parsedLookup.debugFieldCandidates
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Lookup request failed";
    if (process.env.NODE_ENV !== "production") {
      debugLog("[inventory][receipt-intake][tra-lookup][error]", { reason });
    }
    return {
      attempted: true,
      success: false,
      status: "FAILED",
      reason,
      httpStatus: null,
      parsed: false,
      parsedFields: {},
      parsedLineCandidates: [],
      fieldsParseStatus: "FAILED",
      lineItemsParseStatus: "FAILED",
      parsedFieldCount: 0,
      parsedLineItemsCount: 0,
      debugRawTextPreview: "",
      debugFieldCandidates: []
    };
  }
}

async function fetchTraRenderedHtml(url: string): Promise<{
  ok: boolean;
  httpStatus: number | null;
  html: string;
  source: "playwright" | "fetch-fallback";
  containsReceipt: boolean;
  containsTin: boolean;
  containsPurchasedItems: boolean;
  error: string;
}> {
  const fallbackFetch = async (reason: string) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    try {
      const response = await fetch(url, {
        method: "GET",
        signal: controller.signal
      });
      const html = await response.text().catch(() => "");
      const metrics = buildTraHtmlKeywordMetrics(html);
      if (process.env.NODE_ENV !== "production") {
        debugLog("[inventory][receipt-intake][tra-lookup][fetch-fallback]", {
          reason,
          status: response.status,
          ok: response.ok,
          htmlLength: html.length,
          ...metrics
        });
      }
      return {
        ok: response.ok,
        httpStatus: response.status,
        html,
        source: "fetch-fallback" as const,
        containsReceipt: metrics.containsReceipt,
        containsTin: metrics.containsTin,
        containsPurchasedItems: metrics.containsPurchasedItems,
        error: reason
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : reason;
      return {
        ok: false,
        httpStatus: null,
        html: "",
        source: "fetch-fallback" as const,
        containsReceipt: false,
        containsTin: false,
        containsPurchasedItems: false,
        error: message
      };
    } finally {
      clearTimeout(timeout);
    }
  };

  try {
    const playwrightModule = await import("playwright");
    const chromium = playwrightModule.chromium;
    if (!chromium) {
      return fallbackFetch("Playwright chromium is unavailable.");
    }

    const browser = await chromium.launch({
      headless: true
    });
    try {
      const page = await browser.newPage();
      const response = await page.goto(url, {
        waitUntil: "networkidle",
        timeout: 15000
      });
      await page.waitForSelector("body", {
        timeout: 5000
      });
      await page
        .waitForFunction(
          () => {
            const text = (document.body?.innerText || "").toUpperCase();
            return text.includes("RECEIPT") || text.includes("TIN") || text.includes("PURCHASED ITEMS");
          },
          { timeout: 7000 }
        )
        .catch(() => null);

      const html = await page.content();
      const status = response?.status() ?? null;
      const ok = response ? response.ok() : true;
      const metrics = buildTraHtmlKeywordMetrics(html);

      if (process.env.NODE_ENV !== "production") {
        debugLog("[inventory][receipt-intake][tra-lookup][playwright-rendered]", {
          status,
          ok,
          htmlLength: html.length,
          ...metrics
        });
      }

      return {
        ok,
        httpStatus: status,
        html,
        source: "playwright" as const,
        containsReceipt: metrics.containsReceipt,
        containsTin: metrics.containsTin,
        containsPurchasedItems: metrics.containsPurchasedItems,
        error: ""
      };
    } finally {
      await browser.close();
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Playwright rendering failed before lookup parsing.";
    if (process.env.NODE_ENV !== "production") {
      debugLog("[inventory][receipt-intake][tra-lookup][playwright-error]", { reason: message });
    }
    return fallbackFetch(message);
  }
}

function buildTraHtmlKeywordMetrics(html: string) {
  const upper = html.toUpperCase();
  return {
    containsReceipt: upper.includes("RECEIPT"),
    containsTin: upper.includes("TIN"),
    containsPurchasedItems: upper.includes("PURCHASED ITEMS")
  };
}

function parseTraLookupResponse({
  url,
  body
}: {
  url: URL;
  body: string;
}) {
  const parseContext = buildTraParseContext(body);
  const text = parseContext.selectedText;
  const lineCandidates = extractTraLineCandidates(parseContext.selectedHtml, text);
  const fieldCandidates: Array<{ field: keyof ReceiptHeaderExtraction; value: string | number; confidence: number; source: string }> =
    [];

  const fromUrl = parseQrFromUrl(url);
  for (const [field, value] of Object.entries(fromUrl)) {
    if (typeof value === "string" && value.trim()) {
      fieldCandidates.push({
        field: field as keyof ReceiptHeaderExtraction,
        value: value.trim(),
        confidence: 0.55,
        source: "url-query"
      });
      continue;
    }
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      fieldCandidates.push({
        field: field as keyof ReceiptHeaderExtraction,
        value,
        confidence: 0.55,
        source: "url-query"
      });
    }
  }

  const labelPairs = extractTraLabelValuePairs(parseContext.selectedHtml, text);
  for (const pair of labelPairs) {
    const mappedField = mapTraLabelToField(pair.label);
    if (!mappedField) {
      continue;
    }
    const sanitized = sanitizeTraFieldValue(mappedField, pair.value, pair.label);
    if (sanitized === null) {
      continue;
    }
    fieldCandidates.push({
      field: mappedField,
      value: sanitized,
      confidence: pair.confidence,
      source: pair.source
    });
  }

  const fromBodyStructured = parseQrKeyValueText(text);
  for (const [field, value] of Object.entries(fromBodyStructured)) {
    const sanitized = sanitizeTraFieldValue(
      field as keyof ReceiptHeaderExtraction,
      value as string | number,
      field
    );
    if (sanitized === null) {
      continue;
    }
    fieldCandidates.push({
      field: field as keyof ReceiptHeaderExtraction,
      value: sanitized,
      confidence: 0.5,
      source: "structured-text"
    });
  }

  const fromBodyGeneric = parseGenericKeyValueText(text);
  for (const [field, value] of Object.entries(fromBodyGeneric)) {
    const sanitized = sanitizeTraFieldValue(
      field as keyof ReceiptHeaderExtraction,
      value as string | number,
      field
    );
    if (sanitized === null) {
      continue;
    }
    fieldCandidates.push({
      field: field as keyof ReceiptHeaderExtraction,
      value: sanitized,
      confidence: 0.4,
      source: "generic-text"
    });
  }

  const criticalFields = extractTraCriticalFields({
    selectedText: text,
    fullText: parseContext.fullText,
    selectedHtml: parseContext.selectedHtml,
    fullHtml: body
  });
  if (criticalFields.supplierName) {
    fieldCandidates.push({
      field: "supplierName",
      value: criticalFields.supplierName,
      confidence: 0.92,
      source: "critical-fallback"
    });
  }
  if (criticalFields.verificationCode) {
    fieldCandidates.push({
      field: "verificationCode",
      value: criticalFields.verificationCode,
      confidence: 0.93,
      source: "critical-fallback"
    });
  }

  const parsedFields = selectBestTraFieldCandidates(fieldCandidates);
  const parsedFieldCount = countParsedFields(parsedFields);
  if (parsedFieldCount < 3 && parseContext.selectedText !== parseContext.fullText) {
    const fallbackStructured = parseQrKeyValueText(parseContext.fullText);
    for (const [field, value] of Object.entries(fallbackStructured)) {
      const sanitized = sanitizeTraFieldValue(
        field as keyof ReceiptHeaderExtraction,
        value as string | number,
        field
      );
      if (sanitized === null) {
        continue;
      }
      fieldCandidates.push({
        field: field as keyof ReceiptHeaderExtraction,
        value: sanitized,
        confidence: 0.45,
        source: "fallback-structured-text"
      });
    }
    const fallbackGeneric = parseGenericKeyValueText(parseContext.fullText);
    for (const [field, value] of Object.entries(fallbackGeneric)) {
      const sanitized = sanitizeTraFieldValue(
        field as keyof ReceiptHeaderExtraction,
        value as string | number,
        field
      );
      if (sanitized === null) {
        continue;
      }
      fieldCandidates.push({
        field: field as keyof ReceiptHeaderExtraction,
        value: sanitized,
        confidence: 0.35,
        source: "fallback-generic-text"
      });
    }
  }
  const resolvedFields = selectBestTraFieldCandidates(fieldCandidates);
  const financiallyNormalizedFields = normalizeTraFinancialFields(resolvedFields);
  const resolvedParsedFieldCount = countParsedFields(financiallyNormalizedFields);
  const fieldsParseStatus: "NOT_ATTEMPTED" | "SUCCESS" | "PARTIAL" | "FAILED" =
    resolvedParsedFieldCount >= 8 ? "SUCCESS" : resolvedParsedFieldCount >= 3 ? "PARTIAL" : "FAILED";
  const lineItemsParseStatus: "NOT_ATTEMPTED" | "SUCCESS" | "PARTIAL" | "FAILED" =
    lineCandidates.length > 0 ? "SUCCESS" : "FAILED";

  if (process.env.NODE_ENV !== "production") {
    debugLog("[inventory][receipt-intake][tra-lookup][html-structure]", parseContext.structureSummary);
    debugLog("[inventory][receipt-intake][tra-lookup][selected-container]", {
      source: parseContext.selectedSource,
      score: parseContext.selectedScore,
      keywordHits: parseContext.selectedKeywordHits,
      preview: parseContext.selectedHtml.slice(0, 1200)
    });
    debugLog("[inventory][receipt-intake][tra-lookup][candidate-summary]", {
      candidates: parseContext.candidateSummaries.slice(0, 8)
    });
    debugLog("[inventory][receipt-intake][tra-lookup][parsed-summary]", {
      parsedFieldCount: resolvedParsedFieldCount,
      parsedLineItemsCount: lineCandidates.length,
      fieldsParseStatus,
      lineItemsParseStatus
    });
  }

  return {
    parsedFields: financiallyNormalizedFields,
    parsedLineCandidates: lineCandidates,
    fieldsParseStatus,
    lineItemsParseStatus,
    debugRawTextPreview: text.slice(0, 1200),
    debugFieldCandidates: fieldCandidates
      .slice(0, 60)
      .map((candidate) => ({
        field: candidate.field,
        value: String(candidate.value),
        confidence: roundTo(candidate.confidence, 2),
        source: candidate.source
      }))
  };
}

export {
  buildEmptyHeaderResult,
  hasMeaningfulMetadataFromQr,
  listMissingHeaderFields,
  listPresentHeaderFields,
  listReadableHeaderFields,
  mergeHeaderResults,
  resolveExtractionMethod
} from "@/lib/inventory-receipt-intake-merge";
