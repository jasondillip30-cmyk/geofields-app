import assert from "node:assert/strict";
import { extractCameraReceipt } from "@/components/inventory/receipt-intake-camera-extraction";

const rawPayload = "https://verify.tra.go.tz/0192C43691_190351";
const capturedFrameFile = new File(["synthetic frame"], "camera.jpg", { type: "image/jpeg" });
const receipt = { url: "/api/receipts/files/test/camera.jpg", fileName: "camera.jpg" };
const decoded = { success: true, scanDiagnostics: { qrDecodeStatus: "DECODED" } };
const signal = new AbortController().signal;

async function main() {
  const frame = await extractCameraReceipt({ rawPayload, capturedFrameFile }, signal, async (url, options) => {
    assert.equal(url, "/api/inventory/receipt-intake/extract");
    assert.equal(options?.signal, signal);
    assert.equal((options?.body as FormData).get("receipt"), capturedFrameFile);
    return Response.json({ ...decoded, receipt });
  });
  assert.deepEqual(frame.payload, { ...decoded, receipt });

  const paths: string[] = [];
  const fallback = await extractCameraReceipt({ rawPayload, capturedFrameFile }, signal, async (url, options) => {
    paths.push(String(url));
    if (paths.length === 1) return Response.json({ success: true, receipt });
    assert.deepEqual(JSON.parse(String(options?.body)), { rawPayload });
    return Response.json({ ...decoded, receipt: { url: rawPayload } });
  });
  assert.deepEqual(paths, ["/api/inventory/receipt-intake/extract", "/api/inventory/receipt-intake/scan-url"]);
  assert.deepEqual(fallback.payload, { ...decoded, receipt });

  const rawOnly = await extractCameraReceipt({ rawPayload }, signal, async (url) => {
    assert.equal(url, "/api/inventory/receipt-intake/scan-url");
    return Response.json(decoded);
  });
  assert.deepEqual(rawOnly.payload, decoded);

  const failed = await extractCameraReceipt({ rawPayload, capturedFrameFile }, signal, async (url) =>
    Response.json(String(url).endsWith("/extract") ? { success: false, receipt } : { success: false })
  );
  assert.deepEqual(failed.payload, { success: false, receipt });

  const controller = new AbortController();
  let calls = 0;
  await assert.rejects(extractCameraReceipt({ rawPayload, capturedFrameFile }, controller.signal, async () => {
    calls++;
    controller.abort();
    throw controller.signal.reason;
  }), { name: "AbortError" });
  assert.equal(calls, 1);
  console.log("Receipt camera extraction routing, evidence, fallback, and cancellation passed.");
}

void main().catch((error) => { console.error(error); process.exitCode = 1; });
