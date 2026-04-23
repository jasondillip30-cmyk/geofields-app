export type ReceiptExtractorMode = "local" | "shadow" | "remote";

export type ReceiptExtractorSource = "desktop_upload" | "mobile_gallery" | "mobile_camera_file";

export interface ReceiptExtractorRequestContext {
  requestId?: string;
  source?: ReceiptExtractorSource;
  requisitionId?: string;
  qrCrop?: {
    x: number;
    y: number;
    width: number;
    height: number;
  } | null;
  debug?: boolean;
  inventoryItems?: Array<{
    id: string;
    name: string;
    sku: string;
    category: string;
  }>;
}

export interface ReceiptExtractorRequestOptions {
  mode?: "full" | "decode-only";
  trace?: boolean;
}

export interface ReceiptExtractorArtifactRecord {
  key: string;
  url: string;
  mimeType: string;
  size: number;
  width: number | null;
  height: number | null;
  sha256: string;
}

export interface ReceiptExtractorArtifactsPayload {
  extractionId: string;
  manifest: {
    key: string;
    url: string;
  };
  raw: ReceiptExtractorArtifactRecord;
  primary: ReceiptExtractorArtifactRecord;
  qrEnhanced: ReceiptExtractorArtifactRecord | null;
}

export interface ReceiptExtractorDiagnosticsPayload {
  normalizationPath: string;
  normalizationApplied: boolean;
  normalizationOutcome: "IMPROVED" | "STILL_FAILED" | "NOT_APPLICABLE";
  timingMs: {
    total: number;
    ingest: number;
    extract: number;
    persist: number;
  };
  serviceVersion: string;
  qrAttemptCount: number;
  runtime?: unknown;
}

export interface ReceiptExtractorBasePayload {
  success: boolean;
  message: string;
  stage: string;
  receipt: {
    url: string;
    fileName: string;
    mimeType: string;
    size: number;
  };
}

export interface ReceiptExtractorSuccessPayload extends ReceiptExtractorBasePayload {
  success: true;
  extracted: Record<string, unknown>;
  debugFlags: Record<string, unknown>;
  scanDiagnostics: Record<string, unknown>;
  partialEnrichment: boolean;
  artifacts: ReceiptExtractorArtifactsPayload;
  diagnostics: ReceiptExtractorDiagnosticsPayload;
}

export interface ReceiptExtractorDecodeOnlyPayload extends ReceiptExtractorBasePayload {
  qrDecode: Record<string, unknown>;
  artifacts: ReceiptExtractorArtifactsPayload;
  diagnostics: ReceiptExtractorDiagnosticsPayload;
}

export interface ReceiptExtractorFailurePayload {
  success: false;
  message: string;
  stage: string;
  error?: string;
  receipt?: {
    url?: string;
    fileName?: string;
    mimeType?: string;
    size?: number;
  } | null;
  extracted?: Record<string, unknown>;
  debugFlags?: Record<string, unknown>;
  scanDiagnostics?: Record<string, unknown>;
  partialEnrichment?: boolean;
  artifacts?: ReceiptExtractorArtifactsPayload;
  diagnostics?: ReceiptExtractorDiagnosticsPayload;
}

export type ReceiptExtractorPayload =
  | ReceiptExtractorSuccessPayload
  | ReceiptExtractorDecodeOnlyPayload
  | ReceiptExtractorFailurePayload;

export interface ReceiptExtractorClientCallResult {
  ok: boolean;
  status: number;
  payload: ReceiptExtractorPayload | null;
  rawPayload: unknown;
  error: string;
  attempts: number;
  durationMs: number;
}

function asRecord(value: unknown) {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

export function isReceiptExtractorSuccessPayload(
  payload: unknown
): payload is ReceiptExtractorSuccessPayload {
  const root = asRecord(payload);
  const extracted = asRecord(root?.extracted);
  const receipt = asRecord(root?.receipt);
  if (!root || !extracted || !receipt) {
    return false;
  }
  return root.success === true && typeof root.stage === "string";
}

export function isReceiptExtractorDecodeOnlyPayload(
  payload: unknown
): payload is ReceiptExtractorDecodeOnlyPayload {
  const root = asRecord(payload);
  const qrDecode = asRecord(root?.qrDecode);
  const receipt = asRecord(root?.receipt);
  if (!root || !qrDecode || !receipt) {
    return false;
  }
  return typeof root.stage === "string" && typeof root.success === "boolean";
}

export function isReceiptExtractorFailurePayload(
  payload: unknown
): payload is ReceiptExtractorFailurePayload {
  const root = asRecord(payload);
  if (!root) {
    return false;
  }
  return root.success === false && typeof root.stage === "string";
}

export function isReceiptExtractorPayload(payload: unknown): payload is ReceiptExtractorPayload {
  return (
    isReceiptExtractorSuccessPayload(payload) ||
    isReceiptExtractorDecodeOnlyPayload(payload) ||
    isReceiptExtractorFailurePayload(payload)
  );
}
