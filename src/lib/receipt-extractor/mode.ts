import type { ReceiptExtractorMode } from "./contracts";

const allowedModes = new Set<ReceiptExtractorMode>(["local", "shadow", "remote"]);

export function resolveReceiptExtractorMode(): ReceiptExtractorMode {
  const configured = (process.env.RECEIPT_EXTRACTOR_MODE || "").trim().toLowerCase();
  if (configured && allowedModes.has(configured as ReceiptExtractorMode)) {
    return configured as ReceiptExtractorMode;
  }
  return "local";
}

export function isRemoteExtractorEnabled(mode = resolveReceiptExtractorMode()) {
  return mode === "remote" || mode === "shadow";
}

export function resolveReceiptExtractorTimeoutMs() {
  const configured = Number(process.env.RECEIPT_EXTRACTOR_TIMEOUT_MS || 90000);
  if (!Number.isFinite(configured) || configured < 1000) {
    return 90000;
  }
  return Math.round(configured);
}

export function resolveReceiptExtractorRetryCount() {
  const configured = Number(process.env.RECEIPT_EXTRACTOR_RETRY_COUNT || 1);
  if (!Number.isFinite(configured) || configured < 0) {
    return 1;
  }
  return Math.min(3, Math.round(configured));
}
