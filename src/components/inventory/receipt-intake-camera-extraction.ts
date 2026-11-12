import type { CameraScanConfirmPayload } from "@/components/inventory/receipt-intake-panel-types";
import { readJsonPayload } from "@/components/inventory/receipt-intake-save-readiness";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

export async function extractCameraReceipt(
  capture: CameraScanConfirmPayload,
  signal: AbortSignal,
  request = fetch
) {
  const file = capture.capturedFrameFile;
  let frameResult: { response: Response; payload: unknown } | undefined;
  if (file) {
    const body = new FormData();
    body.set("receipt", file);
    try {
      const response = await request("/api/inventory/receipt-intake/extract", { method: "POST", body, signal });
      const payload = await readJsonPayload(response);
      frameResult = { response, payload };
      const diagnostics = asRecord(asRecord(payload).scanDiagnostics);
      if (response.ok && asRecord(payload).success === true && diagnostics.qrDecodeStatus === "DECODED") return frameResult;
    } catch (error) {
      if (signal.aborted) throw error;
    }
  }

  try {
    const response = await request("/api/inventory/receipt-intake/scan-url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rawPayload: capture.rawPayload }),
      signal
    });
    const payload = await readJsonPayload(response);
    if (frameResult && (!response.ok || asRecord(payload).success !== true)) return frameResult;
    const evidence = asRecord(asRecord(frameResult?.payload).receipt);
    return { response, payload: typeof evidence.url === "string" && evidence.url
      ? { ...asRecord(payload), receipt: evidence }
      : payload };
  } catch (error) {
    if (frameResult && !signal.aborted) return frameResult;
    throw error;
  }
}
