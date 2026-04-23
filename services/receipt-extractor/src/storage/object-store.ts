import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export interface StoredObjectRecord {
  key: string;
  url: string;
  mimeType: string;
  size: number;
  sha256: string;
}

function normalizeKey(key: string) {
  return key
    .replace(/\\/g, "/")
    .split("/")
    .filter((segment) => segment && segment !== "." && segment !== "..")
    .join("/");
}

function resolveStorageRootDir() {
  const configured = process.env.EXTRACTOR_LOCAL_STORAGE_DIR?.trim();
  if (configured) {
    return path.resolve(configured);
  }
  return path.join(process.cwd(), "tmp", "receipt-extractor-artifacts");
}

function resolvePublicUrlForKey(key: string) {
  const base = (process.env.EXTRACTOR_STORAGE_PUBLIC_BASE_URL || "").trim().replace(/\/+$/, "");
  if (base) {
    return `${base}/${key}`;
  }
  return `/receipt-extractor-artifacts/${key}`;
}

export function extensionFromMimeType(mimeType: string) {
  switch (mimeType) {
    case "application/pdf":
      return "pdf";
    case "application/json":
      return "json";
    case "image/jpeg":
    case "image/jpg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "text/plain":
      return "txt";
    default:
      return "bin";
  }
}

export async function putObject({
  key,
  buffer,
  mimeType
}: {
  key: string;
  buffer: Buffer;
  mimeType: string;
}): Promise<StoredObjectRecord> {
  const normalizedKey = normalizeKey(key);
  const storageRoot = resolveStorageRootDir();
  const absolutePath = path.join(storageRoot, normalizedKey);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, buffer);
  const sha256 = createHash("sha256").update(buffer).digest("hex");
  return {
    key: normalizedKey,
    url: resolvePublicUrlForKey(normalizedKey),
    mimeType,
    size: buffer.length,
    sha256
  };
}

export function buildObjectKey({
  extractionId,
  variant,
  extension
}: {
  extractionId: string;
  variant: string;
  extension: string;
}) {
  const safeVariant = variant.replace(/[^a-zA-Z0-9_-]+/g, "-");
  const safeExtension = extension.replace(/[^a-zA-Z0-9]+/g, "");
  return `extractions/${extractionId}/${safeVariant}.${safeExtension || "bin"}`;
}
