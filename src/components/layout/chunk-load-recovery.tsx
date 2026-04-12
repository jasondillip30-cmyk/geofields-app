"use client";

import { useEffect } from "react";

const CHUNK_RETRY_STORAGE_KEY = "gf:chunk-load-retry";
const RETRY_COOLDOWN_MS = 5 * 60 * 1000;

type RetryState = {
  attemptedUrl: string;
  attemptedAt: number;
};

function readRetryState(): RetryState | null {
  if (typeof window === "undefined") {
    return null;
  }
  const raw = window.sessionStorage.getItem(CHUNK_RETRY_STORAGE_KEY);
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<RetryState>;
    if (typeof parsed.attemptedUrl !== "string" || typeof parsed.attemptedAt !== "number") {
      return null;
    }
    return {
      attemptedUrl: parsed.attemptedUrl,
      attemptedAt: parsed.attemptedAt
    };
  } catch {
    return null;
  }
}

function isChunkLoadMessage(message: string) {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("chunkloaderror") ||
    normalized.includes("loading chunk") ||
    normalized.includes("failed to fetch dynamically imported module")
  );
}

function resolveErrorMessage(input: unknown): string {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof Error) {
    return `${input.name}: ${input.message}`;
  }
  if (input && typeof input === "object" && "message" in input) {
    const message = (input as { message?: unknown }).message;
    if (typeof message === "string") {
      return message;
    }
  }
  return "";
}

function tryRecoverFromChunkError(source: unknown) {
  if (typeof window === "undefined") {
    return;
  }

  const message = resolveErrorMessage(source);
  if (!isChunkLoadMessage(message)) {
    return;
  }

  const currentUrl = window.location.href;
  const retryState = readRetryState();
  if (
    retryState?.attemptedUrl === currentUrl &&
    Date.now() - retryState.attemptedAt < RETRY_COOLDOWN_MS
  ) {
    return;
  }

  window.sessionStorage.setItem(
    CHUNK_RETRY_STORAGE_KEY,
    JSON.stringify({
      attemptedUrl: currentUrl,
      attemptedAt: Date.now()
    } satisfies RetryState)
  );
  window.location.reload();
}

export function ChunkLoadRecovery() {
  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const errorHandler = (event: ErrorEvent) => {
      const candidate = event.error || event.message;
      tryRecoverFromChunkError(candidate);
    };
    const rejectionHandler = (event: PromiseRejectionEvent) => {
      tryRecoverFromChunkError(event.reason);
    };

    window.addEventListener("error", errorHandler);
    window.addEventListener("unhandledrejection", rejectionHandler);

    return () => {
      window.removeEventListener("error", errorHandler);
      window.removeEventListener("unhandledrejection", rejectionHandler);
    };
  }, []);

  return null;
}
