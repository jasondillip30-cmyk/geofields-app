import { resolveRuntimeCapabilities } from "../runtime-capabilities";

export async function handleDiagnosticsRuntime() {
  const capabilities = await resolveRuntimeCapabilities();
  return Response.json({
    ok: true,
    service: "receipt-extractor",
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
    runtime: capabilities
  });
}
