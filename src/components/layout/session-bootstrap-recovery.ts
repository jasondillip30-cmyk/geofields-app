"use client";

export const SESSION_BOOTSTRAP_LOADING_TIMEOUT_MS = 12_000;

export function resolveDevRuntimeResetCommand() {
  if (typeof window === "undefined") {
    return "npm run dev:reset";
  }
  const port = window.location.port?.trim() || "3000";
  if (port === "3000" || port === "3001") {
    return `npm run dev:reset:${port}`;
  }
  return `PORT=${port} npm run dev:reset`;
}
