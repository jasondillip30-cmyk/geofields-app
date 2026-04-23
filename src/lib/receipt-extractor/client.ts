import { receiptTraceLog } from "@/lib/observability";

import {
  isReceiptExtractorPayload,
  type ReceiptExtractorClientCallResult,
  type ReceiptExtractorPayload,
  type ReceiptExtractorRequestContext,
  type ReceiptExtractorRequestOptions
} from "./contracts";
import {
  resolveReceiptExtractorRetryCount,
  resolveReceiptExtractorTimeoutMs
} from "./mode";

function normalizeBaseUrl() {
  const raw = (process.env.RECEIPT_EXTRACTOR_BASE_URL || "").trim();
  if (!raw) {
    return "";
  }
  return raw.replace(/\/+$/, "");
}

function resolveAuthHeaders() {
  const apiKey = (process.env.RECEIPT_EXTRACTOR_API_KEY || "").trim();
  const headers: Record<string, string> = {};
  if (apiKey) {
    headers["x-extractor-api-key"] = apiKey;
  }
  return headers;
}

function shouldRetryStatus(status: number) {
  return status >= 500 || status === 429;
}

async function parseJsonSafe(response: Response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function buildInvalidPayloadResult({
  status,
  rawPayload,
  attempts,
  durationMs,
  error
}: {
  status: number;
  rawPayload: unknown;
  attempts: number;
  durationMs: number;
  error: string;
}): ReceiptExtractorClientCallResult {
  return {
    ok: false,
    status,
    payload: null,
    rawPayload,
    error,
    attempts,
    durationMs
  };
}

export async function callReceiptExtractorService({
  receipt,
  context,
  options,
  endpoint = "/extract-receipt",
  timeoutMs = resolveReceiptExtractorTimeoutMs(),
  retryCount = resolveReceiptExtractorRetryCount()
}: {
  receipt: File;
  context?: ReceiptExtractorRequestContext;
  options?: ReceiptExtractorRequestOptions;
  endpoint?: "/extract-receipt" | "/extract-receipt-from-raw-payload";
  timeoutMs?: number;
  retryCount?: number;
}): Promise<ReceiptExtractorClientCallResult> {
  const baseUrl = normalizeBaseUrl();
  if (!baseUrl) {
    return buildInvalidPayloadResult({
      status: 0,
      rawPayload: null,
      attempts: 0,
      durationMs: 0,
      error: "RECEIPT_EXTRACTOR_BASE_URL is not configured."
    });
  }

  const maxAttempts = Math.max(1, retryCount + 1);
  const startMs = Date.now();
  let lastResult: ReceiptExtractorClientCallResult = buildInvalidPayloadResult({
    status: 0,
    rawPayload: null,
    attempts: 0,
    durationMs: 0,
    error: "Extractor call did not run."
  });

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);
    const formData = new FormData();
    formData.append("receipt", receipt);
    if (context) {
      formData.append("context", JSON.stringify(context));
    }
    if (options) {
      formData.append("options", JSON.stringify(options));
    }

    try {
      const response = await fetch(`${baseUrl}${endpoint}`, {
        method: endpoint === "/extract-receipt" ? "POST" : "POST",
        headers: {
          ...resolveAuthHeaders()
        },
        body: formData,
        signal: controller.signal,
        cache: "no-store"
      });
      const rawPayload = await parseJsonSafe(response);
      const durationMs = Date.now() - startMs;
      const validPayload = isReceiptExtractorPayload(rawPayload) ? rawPayload : null;

      if (!validPayload) {
        lastResult = buildInvalidPayloadResult({
          status: response.status,
          rawPayload,
          attempts: attempt,
          durationMs,
          error: "Extractor returned a payload that does not match the expected contract."
        });
      } else {
        const ok = response.ok && validPayload.success !== false;
        const payloadError =
          validPayload.success === false && "error" in validPayload && typeof validPayload.error === "string"
            ? validPayload.error
            : "";
        lastResult = {
          ok,
          status: response.status,
          payload: validPayload,
          rawPayload,
          error: ok
            ? ""
            : payloadError || validPayload.message || `Extractor returned status ${response.status}.`,
          attempts: attempt,
          durationMs
        };
      }

      receiptTraceLog("[inventory][receipt-extractor][client][attempt]", {
        endpoint,
        attempt,
        status: response.status,
        ok: lastResult.ok,
        durationMs,
        hasValidPayload: Boolean(validPayload)
      });

      if (lastResult.ok) {
        return lastResult;
      }

      if (attempt < maxAttempts && shouldRetryStatus(response.status)) {
        continue;
      }

      return lastResult;
    } catch (error) {
      const durationMs = Date.now() - startMs;
      const isAbort = error instanceof Error && error.name === "AbortError";
      lastResult = buildInvalidPayloadResult({
        status: isAbort ? 504 : 0,
        rawPayload: null,
        attempts: attempt,
        durationMs,
        error: isAbort
          ? `Extractor request timed out after ${timeoutMs}ms.`
          : error instanceof Error
            ? error.message
            : String(error)
      });

      receiptTraceLog("[inventory][receipt-extractor][client][attempt]", {
        endpoint,
        attempt,
        status: lastResult.status,
        ok: false,
        durationMs,
        error: lastResult.error
      });

      if (attempt < maxAttempts) {
        continue;
      }
      return lastResult;
    } finally {
      clearTimeout(timeoutHandle);
    }
  }

  return lastResult;
}

export async function callReceiptExtractorFromRawPayload({
  rawPayload,
  context,
  timeoutMs = resolveReceiptExtractorTimeoutMs(),
  retryCount = resolveReceiptExtractorRetryCount()
}: {
  rawPayload: string;
  context?: ReceiptExtractorRequestContext;
  timeoutMs?: number;
  retryCount?: number;
}): Promise<ReceiptExtractorClientCallResult> {
  const baseUrl = normalizeBaseUrl();
  if (!baseUrl) {
    return buildInvalidPayloadResult({
      status: 0,
      rawPayload: null,
      attempts: 0,
      durationMs: 0,
      error: "RECEIPT_EXTRACTOR_BASE_URL is not configured."
    });
  }

  const maxAttempts = Math.max(1, retryCount + 1);
  const startMs = Date.now();
  let lastResult: ReceiptExtractorClientCallResult = buildInvalidPayloadResult({
    status: 0,
    rawPayload: null,
    attempts: 0,
    durationMs: 0,
    error: "Extractor call did not run."
  });

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`${baseUrl}/extract-receipt-from-raw-payload`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...resolveAuthHeaders()
        },
        body: JSON.stringify({
          rawPayload,
          context
        }),
        signal: controller.signal,
        cache: "no-store"
      });
      const raw = await parseJsonSafe(response);
      const durationMs = Date.now() - startMs;
      const validPayload = isReceiptExtractorPayload(raw) ? raw : null;

      if (!validPayload) {
        lastResult = buildInvalidPayloadResult({
          status: response.status,
          rawPayload: raw,
          attempts: attempt,
          durationMs,
          error: "Extractor returned a payload that does not match the expected contract."
        });
      } else {
        const ok = response.ok && validPayload.success !== false;
        const payloadError =
          validPayload.success === false && "error" in validPayload && typeof validPayload.error === "string"
            ? validPayload.error
            : "";
        lastResult = {
          ok,
          status: response.status,
          payload: validPayload,
          rawPayload: raw,
          error: ok
            ? ""
            : payloadError || validPayload.message || `Extractor returned status ${response.status}.`,
          attempts: attempt,
          durationMs
        };
      }

      receiptTraceLog("[inventory][receipt-extractor][client][raw-attempt]", {
        attempt,
        status: response.status,
        ok: lastResult.ok,
        durationMs,
        hasValidPayload: Boolean(validPayload)
      });

      if (lastResult.ok) {
        return lastResult;
      }

      if (attempt < maxAttempts && shouldRetryStatus(response.status)) {
        continue;
      }

      return lastResult;
    } catch (error) {
      const durationMs = Date.now() - startMs;
      const isAbort = error instanceof Error && error.name === "AbortError";
      lastResult = buildInvalidPayloadResult({
        status: isAbort ? 504 : 0,
        rawPayload: null,
        attempts: attempt,
        durationMs,
        error: isAbort
          ? `Extractor request timed out after ${timeoutMs}ms.`
          : error instanceof Error
            ? error.message
            : String(error)
      });

      receiptTraceLog("[inventory][receipt-extractor][client][raw-attempt]", {
        attempt,
        status: lastResult.status,
        ok: false,
        durationMs,
        error: lastResult.error
      });

      if (attempt < maxAttempts) {
        continue;
      }
      return lastResult;
    } finally {
      clearTimeout(timeoutHandle);
    }
  }

  return lastResult;
}

export function readExtractorPayload(payload: ReceiptExtractorPayload | null) {
  if (!payload) {
    return null;
  }
  return payload;
}
