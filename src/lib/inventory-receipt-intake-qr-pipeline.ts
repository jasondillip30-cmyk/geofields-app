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
  isLikelyTraLoadingShellHtml,
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
  derivedFinancialFallback: boolean;
  debugRawTextPreview: string;
  debugFieldCandidates: Array<{ field: string; value: string; confidence: number; source: string }>;
}

const PDF_MODULE_WARNING_PREFIX = "[PDF_MODULE_ERROR]";
const TRA_LOADING_SHELL_RETRY_HINT =
  "TRA verification page is still loading. Try Scan again or continue with manual review.";
const TRA_LOOKUP_ATTEMPT_PROFILES: Array<{
  label: string;
  retryDelayMs: number;
  gotoTimeoutMs: number;
  waitForBodyMs: number;
  waitForSignalMs: number;
  fallbackTimeoutMs: number;
}> = [
  {
    label: "quick",
    retryDelayMs: 0,
    gotoTimeoutMs: 7000,
    waitForBodyMs: 3500,
    waitForSignalMs: 2500,
    fallbackTimeoutMs: 5000
  },
  {
    label: "balanced",
    retryDelayMs: 900,
    gotoTimeoutMs: 10000,
    waitForBodyMs: 4500,
    waitForSignalMs: 4500,
    fallbackTimeoutMs: 7000
  },
  {
    label: "extended",
    retryDelayMs: 1800,
    gotoTimeoutMs: 13000,
    waitForBodyMs: 5000,
    waitForSignalMs: 6500,
    fallbackTimeoutMs: 8500
  },
  {
    label: "stabilize",
    retryDelayMs: 2600,
    gotoTimeoutMs: 16000,
    waitForBodyMs: 6500,
    waitForSignalMs: 9000,
    fallbackTimeoutMs: 10000
  }
];

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

export async function extractQrDataFromRawPayload({
  rawPayload,
  decodePass = "camera-live",
  sourceLabel = "camera"
}: {
  rawPayload: string;
  decodePass?: string;
  sourceLabel?: string;
}): Promise<ReceiptQrResult> {
  const parsed = parseQrPayload(rawPayload, {
    decodePass,
    attemptedPasses: [`${sourceLabel}|raw-payload`],
    variantCount: 1
  });
  return finalizeQrResult(parsed);
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
      lookup.status === "FAILED" && lookup.reason ? lookup.reason : "",
      lookup.success && !lookup.parsed
        ? "TRA verification lookup succeeded, but parsing returned limited fields."
        : "",
      lookup.status === "SUCCESS" && lookup.fieldsParseStatus === "PARTIAL"
        ? "TRA fields were parsed partially. Please review mapped values."
        : "",
      lookup.status === "SUCCESS" && lookup.lineItemsParseStatus === "PARTIAL"
        ? "TRA line items were partially detected. Verify line quantities and totals before saving."
        : "",
      lookup.status === "SUCCESS" && lookup.lineItemsParseStatus === "FAILED"
        ? "TRA line items were not detected automatically. Add or confirm line items manually."
        : "",
      lookup.derivedFinancialFallback
        ? "Receipt totals were inferred from parsed line items. Verify total and subtotal before saving."
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
      derivedFinancialFallback: false,
      debugRawTextPreview: "",
      debugFieldCandidates: []
    };
  }

  type TraLookupAttempt = {
    profileLabel: string;
    renderedLookup: Awaited<ReturnType<typeof fetchTraRenderedHtml>>;
    parsedLookup: ReturnType<typeof parseTraLookupResponse>;
    parsedFields: Partial<ReceiptHeaderExtraction>;
    parsedCount: number;
    parsedLineItemsCount: number;
    parsed: boolean;
    isLoadingShell: boolean;
    reason: string;
    score: number;
  };

  const attempts: TraLookupAttempt[] = [];

  try {
    if (process.env.NODE_ENV !== "production") {
      debugLog("[inventory][receipt-intake][tra-lookup][request]", {
        url: target.toString(),
        attemptProfiles: TRA_LOOKUP_ATTEMPT_PROFILES.map((profile) => profile.label)
      });
    }

    for (const profile of TRA_LOOKUP_ATTEMPT_PROFILES) {
      if (profile.retryDelayMs > 0 && attempts.length > 0) {
        await sleep(profile.retryDelayMs);
      }
      const renderedLookup = await fetchTraRenderedHtml(target.toString(), profile);
      const body = renderedLookup.html;
      const parsedLookup = parseTraLookupResponse({ url: target, body });
      const parsedFields = parsedLookup.parsedFields;
      const parsedCount = countParsedFields(parsedFields);
      const parsedLineItemsCount = parsedLookup.parsedLineCandidates.length;
      const parsed = parsedCount > 0 || parsedLineItemsCount > 0;
      const isLoadingShell = isLikelyTraLoadingShellHtml(body);
      const reason = renderedLookup.ok
        ? isLoadingShell
          ? TRA_LOADING_SHELL_RETRY_HINT
          : parsed
            ? ""
            : "Lookup response could not be parsed"
        : normalizeTraLookupFailureReason(renderedLookup.error || `Lookup failed with status ${renderedLookup.httpStatus ?? "unknown"}`);
      const score = scoreTraLookupAttempt({
        ok: renderedLookup.ok,
        parsedCount,
        parsedLineItemsCount,
        isLoadingShell,
        fieldsParseStatus: parsedLookup.fieldsParseStatus,
        lineItemsParseStatus: parsedLookup.lineItemsParseStatus
      });
      attempts.push({
        profileLabel: profile.label,
        renderedLookup,
        parsedLookup,
        parsedFields,
        parsedCount,
        parsedLineItemsCount,
        parsed,
        isLoadingShell,
        reason,
        score
      });

      if (process.env.NODE_ENV !== "production") {
        debugLog("[inventory][receipt-intake][tra-lookup][attempt]", {
          profile: profile.label,
          status: renderedLookup.httpStatus,
          ok: renderedLookup.ok,
          source: renderedLookup.source,
          htmlLength: body.length,
          containsReceipt: renderedLookup.containsReceipt,
          containsTin: renderedLookup.containsTin,
          containsPurchasedItems: renderedLookup.containsPurchasedItems,
          isLoadingShell,
          parsed,
          parsedCount,
          lineItems: parsedLineItemsCount,
          fieldsParseStatus: parsedLookup.fieldsParseStatus,
          lineItemsParseStatus: parsedLookup.lineItemsParseStatus,
          reason
        });
      }

      const hasMeaningfulStructuredData = parsedCount >= 3 || parsedLineItemsCount > 0;
      if (renderedLookup.ok && !isLoadingShell && hasMeaningfulStructuredData) {
        break;
      }
    }
  } catch (error) {
    const reason = normalizeTraLookupFailureReason(error instanceof Error ? error.message : "Lookup request failed");
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
      derivedFinancialFallback: false,
      debugRawTextPreview: "",
      debugFieldCandidates: []
    };
  }

  const bestAttempt = chooseBestTraLookupAttempt(attempts);
  if (!bestAttempt) {
    return {
      attempted: true,
      success: false,
      status: "FAILED",
      reason: normalizeTraLookupFailureReason("TRA verification lookup returned limited data."),
      httpStatus: null,
      parsed: false,
      parsedFields: {},
      parsedLineCandidates: [],
      fieldsParseStatus: "FAILED",
      lineItemsParseStatus: "FAILED",
      parsedFieldCount: 0,
      parsedLineItemsCount: 0,
      derivedFinancialFallback: false,
      debugRawTextPreview: "",
      debugFieldCandidates: []
    };
  }

  const success = bestAttempt.renderedLookup.ok && !bestAttempt.isLoadingShell;
  const status: ReceiptVerificationLookupStatus = success ? "SUCCESS" : "FAILED";
  const reason = success
    ? bestAttempt.parsed
      ? ""
      : "Lookup response could not be parsed"
    : bestAttempt.reason || normalizeTraLookupFailureReason("TRA verification lookup returned limited data.");

  if (process.env.NODE_ENV !== "production") {
    debugLog("[inventory][receipt-intake][tra-lookup][response]", {
      profile: bestAttempt.profileLabel,
      status: bestAttempt.renderedLookup.httpStatus,
      ok: bestAttempt.renderedLookup.ok,
      source: bestAttempt.renderedLookup.source,
      htmlLength: bestAttempt.renderedLookup.html.length,
      containsReceipt: bestAttempt.renderedLookup.containsReceipt,
      containsTin: bestAttempt.renderedLookup.containsTin,
      containsPurchasedItems: bestAttempt.renderedLookup.containsPurchasedItems,
      isLoadingShell: bestAttempt.isLoadingShell,
      parsed: bestAttempt.parsed,
      parsedCount: bestAttempt.parsedCount,
      lineItems: bestAttempt.parsedLineItemsCount,
      fieldsParseStatus: bestAttempt.parsedLookup.fieldsParseStatus,
      lineItemsParseStatus: bestAttempt.parsedLookup.lineItemsParseStatus,
      attemptsEvaluated: attempts.length,
      attemptScores: attempts.map((attempt) => ({
        profile: attempt.profileLabel,
        score: roundTo(attempt.score, 2),
        ok: attempt.renderedLookup.ok,
        parsedCount: attempt.parsedCount,
        parsedLineItemsCount: attempt.parsedLineItemsCount,
        isLoadingShell: attempt.isLoadingShell
      }))
    });
    debugLog("[inventory][receipt-intake][tra-lookup][mapped-fields]", bestAttempt.parsedFields);
    if (bestAttempt.parsedLookup.debugRawTextPreview) {
      debugLog("[inventory][receipt-intake][tra-lookup][raw-text-preview]", {
        preview: bestAttempt.parsedLookup.debugRawTextPreview
      });
    }
    if (bestAttempt.parsedLookup.debugFieldCandidates.length > 0) {
      debugLog("[inventory][receipt-intake][tra-lookup][field-candidates]", {
        candidates: bestAttempt.parsedLookup.debugFieldCandidates.slice(0, 20)
      });
    }
  }

  return {
    attempted: true,
    success,
    status,
    reason,
    httpStatus: bestAttempt.renderedLookup.httpStatus,
    parsed: bestAttempt.parsed,
    parsedFields: bestAttempt.parsedFields,
    parsedLineCandidates: bestAttempt.parsedLookup.parsedLineCandidates,
    fieldsParseStatus: bestAttempt.parsedLookup.fieldsParseStatus,
    lineItemsParseStatus: bestAttempt.parsedLookup.lineItemsParseStatus,
    parsedFieldCount: bestAttempt.parsedCount,
    parsedLineItemsCount: bestAttempt.parsedLineItemsCount,
    derivedFinancialFallback: bestAttempt.parsedLookup.derivedFinancialFallback,
    debugRawTextPreview: bestAttempt.parsedLookup.debugRawTextPreview,
    debugFieldCandidates: bestAttempt.parsedLookup.debugFieldCandidates
  };
}

function scoreTraLookupAttempt({
  ok,
  parsedCount,
  parsedLineItemsCount,
  isLoadingShell,
  fieldsParseStatus,
  lineItemsParseStatus
}: {
  ok: boolean;
  parsedCount: number;
  parsedLineItemsCount: number;
  isLoadingShell: boolean;
  fieldsParseStatus: "NOT_ATTEMPTED" | "SUCCESS" | "PARTIAL" | "FAILED";
  lineItemsParseStatus: "NOT_ATTEMPTED" | "SUCCESS" | "PARTIAL" | "FAILED";
}) {
  const fieldStatusWeight =
    fieldsParseStatus === "SUCCESS" ? 4 : fieldsParseStatus === "PARTIAL" ? 2 : fieldsParseStatus === "FAILED" ? -1 : 0;
  const lineStatusWeight =
    lineItemsParseStatus === "SUCCESS"
      ? 4
      : lineItemsParseStatus === "PARTIAL"
        ? 2
        : lineItemsParseStatus === "FAILED"
          ? -1
          : 0;
  const base = (ok ? 5 : 0) + parsedCount * 1.5 + parsedLineItemsCount * 2 + fieldStatusWeight + lineStatusWeight;
  return isLoadingShell ? base - 10 : base;
}

function chooseBestTraLookupAttempt<T extends { score: number; renderedLookup: { html: string } }>(attempts: T[]) {
  if (attempts.length === 0) {
    return null;
  }
  return [...attempts].sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score;
    }
    return (right.renderedLookup.html?.length || 0) - (left.renderedLookup.html?.length || 0);
  })[0];
}

function normalizeTraLookupFailureReason(rawReason: string) {
  const reason = (rawReason || "").trim();
  if (!reason) {
    return "TRA verification lookup returned limited data. Try Scan again or continue with manual review.";
  }
  const lower = reason.toLowerCase();
  if (lower.includes("aborted") || lower.includes("aborterror") || lower.includes("operation was aborted")) {
    return "TRA verification timed out before the receipt fully loaded. Try Scan again or continue with manual review.";
  }
  if (lower.includes("timeout") || lower.includes("timed out")) {
    return "TRA verification is taking longer than expected. Try Scan again or continue with manual review.";
  }
  if (lower.includes("loading")) {
    return TRA_LOADING_SHELL_RETRY_HINT;
  }
  return reason;
}

async function sleep(ms: number) {
  if (!Number.isFinite(ms) || ms <= 0) {
    return;
  }
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchTraRenderedHtml(
  url: string,
  profile: {
    label: string;
    gotoTimeoutMs: number;
    waitForBodyMs: number;
    waitForSignalMs: number;
    fallbackTimeoutMs: number;
  }
): Promise<{
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
    const timeout = setTimeout(() => controller.abort(), profile.fallbackTimeoutMs);
    try {
      const response = await fetch(url, {
        method: "GET",
        signal: controller.signal
      });
      const html = await response.text().catch(() => "");
      const metrics = buildTraHtmlKeywordMetrics(html);
      if (process.env.NODE_ENV !== "production") {
        debugLog("[inventory][receipt-intake][tra-lookup][fetch-fallback]", {
          profile: profile.label,
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
        timeout: profile.gotoTimeoutMs
      });
      await page.waitForSelector("body", {
        timeout: profile.waitForBodyMs
      });
      await page
        .waitForFunction(
          () => {
            const text = (document.body?.innerText || "").toUpperCase();
            const hasCoreSignals =
              text.includes("START OF LEGAL RECEIPT") ||
              text.includes("PURCHASED ITEMS") ||
              text.includes("RECEIPT NO") ||
              (text.includes("TIN") && text.includes("VRN"));
            const stillLoading =
              text.includes("PAGE IS LOADING") ||
              text.includes("PLEASE WAIT") ||
              text.includes("PROCESSING REQUEST");
            return hasCoreSignals && !stillLoading;
          },
          { timeout: profile.waitForSignalMs }
        )
        .catch(() => null);

      const html = await page.content();
      const status = response?.status() ?? null;
      const ok = response ? response.ok() : true;
      const metrics = buildTraHtmlKeywordMetrics(html);

      if (process.env.NODE_ENV !== "production") {
        debugLog("[inventory][receipt-intake][tra-lookup][playwright-rendered]", {
          profile: profile.label,
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
  const selectedLineCandidates = extractTraLineCandidates(parseContext.selectedHtml, text);
  const fullTextLineCandidates =
    selectedLineCandidates.length === 0 && parseContext.selectedHtml !== body
      ? extractTraLineCandidates(body, parseContext.fullText)
      : [];
  const lineCandidates =
    selectedLineCandidates.length > 0 ? selectedLineCandidates : fullTextLineCandidates;
  const fieldCandidates: Array<{ field: keyof ReceiptHeaderExtraction; value: string | number; confidence: number; source: string }> =
    [];

  const fromUrl = parseQrFromUrl(url);
  for (const [field, value] of Object.entries(fromUrl)) {
    if ((typeof value === "string" && value.trim()) || (typeof value === "number" && Number.isFinite(value) && value > 0)) {
      const sanitized = sanitizeTraFieldValue(field as keyof ReceiptHeaderExtraction, value as string | number, field);
      if (sanitized === null) {
        continue;
      }
      fieldCandidates.push({
        field: field as keyof ReceiptHeaderExtraction,
        value: sanitized,
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
  if (labelPairs.length === 0 && parseContext.selectedHtml !== body) {
    const fullBodyLabelPairs = extractTraLabelValuePairs(body, parseContext.fullText);
    for (const pair of fullBodyLabelPairs) {
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
        confidence: Math.max(0.35, pair.confidence - 0.08),
        source: `${pair.source}-full-body`
      });
    }
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
  const totalBeforeNormalization = Number((resolvedFields as Record<string, unknown>).total || 0);
  const subtotalBeforeNormalization = Number((resolvedFields as Record<string, unknown>).subtotal || 0);
  const financiallyNormalizedFields = normalizeTraFinancialFields(resolvedFields, lineCandidates);
  const totalAfterNormalization = Number((financiallyNormalizedFields as Record<string, unknown>).total || 0);
  const subtotalAfterNormalization = Number((financiallyNormalizedFields as Record<string, unknown>).subtotal || 0);
  const totalDerivedFromLines =
    (!Number.isFinite(totalBeforeNormalization) || totalBeforeNormalization <= 0) &&
    Number.isFinite(totalAfterNormalization) &&
    totalAfterNormalization > 0;
  const subtotalDerivedFromLines =
    (!Number.isFinite(subtotalBeforeNormalization) || subtotalBeforeNormalization <= 0) &&
    Number.isFinite(subtotalAfterNormalization) &&
    subtotalAfterNormalization > 0;
  const derivedFinancialFallback =
    lineCandidates.length > 0 && (totalDerivedFromLines || subtotalDerivedFromLines);
  const resolvedParsedFieldCount = countParsedFields(financiallyNormalizedFields);
  const fieldsParseStatus: "NOT_ATTEMPTED" | "SUCCESS" | "PARTIAL" | "FAILED" =
    resolvedParsedFieldCount >= 8 ? "SUCCESS" : resolvedParsedFieldCount >= 3 ? "PARTIAL" : "FAILED";
  const hasLineSignals = hasLikelyTraLineSignals(parseContext.selectedHtml, text) || hasLikelyTraLineSignals(body, parseContext.fullText);
  const lineItemsParseStatus: "NOT_ATTEMPTED" | "SUCCESS" | "PARTIAL" | "FAILED" =
    lineCandidates.length > 0 ? "SUCCESS" : hasLineSignals ? "PARTIAL" : "FAILED";

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
      lineItemsParseStatus,
      derivedFinancialFallback
    });
  }

  return {
    parsedFields: financiallyNormalizedFields,
    parsedLineCandidates: lineCandidates,
    fieldsParseStatus,
    lineItemsParseStatus,
    derivedFinancialFallback,
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

function hasLikelyTraLineSignals(html: string, text: string) {
  const lowerText = (text || "").toLowerCase();
  const lowerHtml = (html || "").toLowerCase();
  if (!lowerText && !lowerHtml) {
    return false;
  }
  if (
    containsAny(lowerText, [
      "purchased items",
      "description",
      "qty",
      "quantity",
      "unit price",
      "line total",
      "amount"
    ])
  ) {
    return true;
  }
  const hasRowStructures = /<(?:tr|li|div|p)\b/i.test(html || "");
  const hasMoneyTokens = /\b\d[\d,]*(?:\.\d{1,2})\b/.test(text || "");
  return hasRowStructures && hasMoneyTokens;
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
