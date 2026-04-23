function truncateLogValue(value: string, maxLength = 500) {
  if (!value) {
    return "";
  }
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength - 3)}...`;
}

function countPopulatedFields(value: Record<string, unknown> | null) {
  if (!value) {
    return 0;
  }
  let count = 0;
  Object.values(value).forEach((entry) => {
    if (typeof entry === "string" && entry.trim()) {
      count += 1;
      return;
    }
    if (typeof entry === "number" && Number.isFinite(entry) && entry > 0) {
      count += 1;
    }
  });
  return count;
}

function resolveQrFailureStageFromRoute({
  decodeStatus,
  parseStatus,
  lookupStatus
}: {
  decodeStatus: string;
  parseStatus: string;
  lookupStatus: string;
}) {
  if (decodeStatus === "NOT_DETECTED") {
    return "QR_NOT_DETECTED";
  }
  if (decodeStatus === "DECODE_FAILED") {
    return "QR_DECODE_FAILED";
  }
  if (decodeStatus === "DECODED" && parseStatus === "UNPARSED") {
    return "QR_PARSE_UNPARSED";
  }
  if (decodeStatus === "DECODED" && lookupStatus === "FAILED") {
    return "TRA_LOOKUP_FAILED";
  }
  return "NONE";
}

export function resolveReceiptIntakeMessage(extraction: { scanStatus?: unknown; qr?: unknown; intakeDebug?: unknown }) {
  const qr = extraction.qr && typeof extraction.qr === "object" ? (extraction.qr as Record<string, unknown>) : null;
  const intakeDebug =
    extraction.intakeDebug && typeof extraction.intakeDebug === "object"
      ? (extraction.intakeDebug as Record<string, unknown>)
      : null;
  const decodeStatus = typeof qr?.decodeStatus === "string" ? qr.decodeStatus : "";
  const parseStatus = typeof qr?.parseStatus === "string" ? qr.parseStatus : "";
  const stages = qr?.stages && typeof qr.stages === "object" ? (qr.stages as Record<string, unknown>) : null;
  const verificationLookup =
    stages?.verificationLookup && typeof stages.verificationLookup === "object"
      ? (stages.verificationLookup as Record<string, unknown>)
      : null;
  const lookupStatus = typeof verificationLookup?.status === "string" ? verificationLookup.status : "";
  const lookupSuccess = Boolean(verificationLookup?.success);
  const scanStatus = typeof extraction.scanStatus === "string" ? extraction.scanStatus : "";
  const traParseSucceeded = Boolean(intakeDebug?.traParseSucceeded);
  const ocrAttempted = Boolean(intakeDebug?.ocrAttempted);
  const ocrSucceeded = Boolean(intakeDebug?.ocrSucceeded);
  if (traParseSucceeded && ocrAttempted && !ocrSucceeded) {
    return "Captured from QR/TRA. Core receipt data is ready; some optional details may need review.";
  }
  if (decodeStatus === "NOT_DETECTED") {
    return scanStatus === "COMPLETE" || scanStatus === "PARTIAL"
      ? "QR was not detected automatically. OCR/manual assist was used."
      : "QR was not detected automatically.";
  }
  if (decodeStatus === "DECODE_FAILED") {
    return scanStatus === "COMPLETE" || scanStatus === "PARTIAL"
      ? "QR was detected but needs review. OCR/manual assist was used."
      : "QR was detected but needs review.";
  }
  if (decodeStatus === "DECODED" && parseStatus === "UNPARSED") {
    return "QR captured. Structured parsing needs review.";
  }
  if (decodeStatus === "DECODED" && lookupStatus === "FAILED") {
    return "QR captured. TRA lookup returned limited data and may need review.";
  }
  if (decodeStatus === "DECODED" && lookupStatus === "SUCCESS" && !lookupSuccess) {
    return "QR captured. TRA lookup returned partial data for review.";
  }
  if (scanStatus === "COMPLETE") {
    return "Captured from QR/TRA. Ready for review.";
  }
  if (scanStatus === "PARTIAL") {
    return "Receipt captured with partial data. Review recommended before saving.";
  }
  return "Receipt capture needs review. You can continue manually or retry with a clearer image.";
}

export function readDebugFlagsFromExtraction(extraction: Record<string, unknown>) {
  const qr = extraction.qr && typeof extraction.qr === "object" ? (extraction.qr as Record<string, unknown>) : null;
  const stages = qr?.stages && typeof qr.stages === "object" ? (qr.stages as Record<string, unknown>) : null;
  const lookup =
    stages?.verificationLookup && typeof stages.verificationLookup === "object"
      ? (stages.verificationLookup as Record<string, unknown>)
      : null;
  const intakeDebug =
    extraction.intakeDebug && typeof extraction.intakeDebug === "object"
      ? (extraction.intakeDebug as Record<string, unknown>)
      : null;

  const qrDecoded =
    typeof intakeDebug?.qrDecoded === "boolean"
      ? intakeDebug.qrDecoded
      : typeof qr?.decodeStatus === "string" && qr.decodeStatus === "DECODED";
  const traLookupSucceeded =
    typeof intakeDebug?.traLookupSucceeded === "boolean"
      ? intakeDebug.traLookupSucceeded
      : Boolean(lookup?.attempted) && typeof lookup?.status === "string" && lookup.status === "SUCCESS";
  const traParseSucceeded =
    typeof intakeDebug?.traParseSucceeded === "boolean"
      ? intakeDebug.traParseSucceeded
      : traLookupSucceeded && Boolean(lookup?.parsed);
  const ocrAttempted = typeof intakeDebug?.ocrAttempted === "boolean" ? intakeDebug.ocrAttempted : false;
  const ocrSucceeded = typeof intakeDebug?.ocrSucceeded === "boolean" ? intakeDebug.ocrSucceeded : false;
  const ocrError = typeof intakeDebug?.ocrError === "string" ? intakeDebug.ocrError : "";
  const enrichmentWarning = typeof intakeDebug?.enrichmentWarning === "string" ? intakeDebug.enrichmentWarning : "";
  const returnedFromRaw = typeof intakeDebug?.returnedFrom === "string" ? intakeDebug.returnedFrom : "";
  const returnedFrom = returnedFromRaw === "qr_tra_plus_ocr" ? "qr_tra_plus_ocr" : "qr_tra";

  return {
    qrDecoded,
    traLookupSucceeded,
    traParseSucceeded,
    ocrAttempted,
    ocrSucceeded,
    ocrError,
    enrichmentWarning,
    returnedFrom,
    partialEnrichment: traParseSucceeded && ocrAttempted && !ocrSucceeded
  };
}

export function readScanDiagnosticsFromExtraction(extraction: Record<string, unknown>) {
  const qr = extraction.qr && typeof extraction.qr === "object" ? (extraction.qr as Record<string, unknown>) : null;
  const stages = qr?.stages && typeof qr.stages === "object" ? (qr.stages as Record<string, unknown>) : null;
  const lookup =
    stages?.verificationLookup && typeof stages.verificationLookup === "object"
      ? (stages.verificationLookup as Record<string, unknown>)
      : null;
  const intakeDebug =
    extraction.intakeDebug && typeof extraction.intakeDebug === "object"
      ? (extraction.intakeDebug as Record<string, unknown>)
      : null;
  const scanDiagnostics =
    extraction.scanDiagnostics && typeof extraction.scanDiagnostics === "object"
      ? (extraction.scanDiagnostics as Record<string, unknown>)
      : null;

  const qrParsedFields =
    qr?.parsedFields && typeof qr.parsedFields === "object" ? (qr.parsedFields as Record<string, unknown>) : null;
  const parsedFieldCount =
    typeof scanDiagnostics?.qrParsedFieldCount === "number"
      ? scanDiagnostics.qrParsedFieldCount
      : countPopulatedFields(qrParsedFields);
  const parsedLineItemsCount =
    typeof scanDiagnostics?.qrParsedLineItemsCount === "number"
      ? scanDiagnostics.qrParsedLineItemsCount
      : Array.isArray(qr?.parsedLineCandidates)
        ? qr.parsedLineCandidates.length
        : 0;

  const decodeStatus = typeof qr?.decodeStatus === "string" ? qr.decodeStatus : "NOT_DETECTED";
  const parseStatus = typeof qr?.parseStatus === "string" ? qr.parseStatus : "UNPARSED";
  const lookupStatus = typeof lookup?.status === "string" ? lookup.status : "NOT_ATTEMPTED";
  const failureStageRaw =
    typeof scanDiagnostics?.failureStage === "string"
      ? scanDiagnostics.failureStage
      : resolveQrFailureStageFromRoute({
          decodeStatus,
          parseStatus,
          lookupStatus
        });

  return {
    qrDetected: typeof scanDiagnostics?.qrDetected === "boolean" ? scanDiagnostics.qrDetected : Boolean(qr?.detected),
    qrDecodeStatus: decodeStatus,
    qrDecodePass: typeof qr?.decodePass === "string" ? qr.decodePass : "",
    qrParseStatus: parseStatus,
    qrFailureReason: typeof qr?.failureReason === "string" ? qr.failureReason : "",
    qrContentType: typeof qr?.contentType === "string" ? qr.contentType : "NONE",
    qrRawValue: typeof qr?.rawValue === "string" ? qr.rawValue : "",
    qrNormalizedRawValue:
      typeof qr?.normalizedRawValue === "string" ? qr.normalizedRawValue : typeof qr?.rawValue === "string" ? qr.rawValue : "",
    qrRawLength:
      typeof scanDiagnostics?.qrRawLength === "number"
        ? scanDiagnostics.qrRawLength
        : typeof qr?.rawValue === "string"
          ? qr.rawValue.length
          : 0,
    qrRawPreview:
      typeof scanDiagnostics?.qrRawPreview === "string"
        ? scanDiagnostics.qrRawPreview
        : truncateLogValue(typeof qr?.rawValue === "string" ? qr.rawValue : "", 200),
    qrRawPayloadFormat: typeof scanDiagnostics?.qrRawPayloadFormat === "string" ? scanDiagnostics.qrRawPayloadFormat : "EMPTY",
    qrVerificationUrl: typeof qr?.verificationUrl === "string" ? qr.verificationUrl : "",
    qrIsTraVerification: Boolean(qr?.isTraVerification),
    qrParsedFieldCount: parsedFieldCount,
    qrParsedLineItemsCount: parsedLineItemsCount,
    qrLookupStatus: lookupStatus,
    qrLookupReason: typeof lookup?.reason === "string" ? lookup.reason : "",
    qrLookupHttpStatus: typeof lookup?.httpStatus === "number" ? lookup.httpStatus : null,
    qrLookupParsed: Boolean(lookup?.parsed),
    ocrAttempted:
      typeof scanDiagnostics?.ocrAttempted === "boolean"
        ? scanDiagnostics.ocrAttempted
        : Boolean(intakeDebug?.ocrAttempted),
    ocrSucceeded:
      typeof scanDiagnostics?.ocrSucceeded === "boolean"
        ? scanDiagnostics.ocrSucceeded
        : Boolean(intakeDebug?.ocrSucceeded),
    ocrError:
      typeof scanDiagnostics?.ocrError === "string"
        ? scanDiagnostics.ocrError
        : typeof intakeDebug?.ocrError === "string"
          ? intakeDebug.ocrError
          : "",
    scanStatus: typeof extraction.scanStatus === "string" ? extraction.scanStatus : "UNREADABLE",
    extractionMethod: typeof extraction.extractionMethod === "string" ? extraction.extractionMethod : "UNKNOWN",
    returnedFrom:
      typeof scanDiagnostics?.returnedFrom === "string"
        ? scanDiagnostics.returnedFrom
        : typeof intakeDebug?.returnedFrom === "string"
          ? intakeDebug.returnedFrom
          : "qr_tra",
    failureStage: failureStageRaw
  };
}

export function resolveNormalizationQualityOutcome({
  normalizationApplied,
  extraction
}: {
  normalizationApplied: boolean;
  extraction: {
    header?: unknown;
    lines?: unknown;
    scanStatus?: unknown;
  };
}) {
  if (!normalizationApplied) {
    return "NOT_APPLICABLE" as const;
  }
  const scanStatus = typeof extraction.scanStatus === "string" ? extraction.scanStatus : "UNREADABLE";
  const header = extraction.header && typeof extraction.header === "object" ? (extraction.header as Record<string, unknown>) : null;
  const headerFieldCount = countPopulatedFields(header);
  const lineCount = Array.isArray(extraction.lines) ? extraction.lines.length : 0;
  const completeEnough = scanStatus === "COMPLETE" || (scanStatus === "PARTIAL" && (headerFieldCount >= 4 || lineCount > 0));
  return completeEnough ? ("IMPROVED" as const) : ("STILL_FAILED" as const);
}
