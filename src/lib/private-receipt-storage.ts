import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { get, put } from "@vercel/blob";

const types: Record<string, string> = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
  heif: "image/heif",
  bin: "application/octet-stream"
};

const ownerPattern = /^[a-zA-Z0-9_-]{1,128}$/;
const filePattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\.(pdf|jpg|png|webp|heic|heif|bin)$/;
export const privateReceiptUrlPrefix = "/api/receipts/files/";

export function usesPrivateBlobReceipts() {
  return process.env.VERCEL === "1" || process.env.RECEIPT_STORAGE === "blob";
}

function blobToken() {
  const token = process.env.BLOB_READ_WRITE_TOKEN?.trim();
  if (!token) throw new Error("Private receipt storage is not configured.");
  return token;
}

function localReceiptRoot() {
  return process.env.RECEIPT_LOCAL_STORAGE_DIR?.trim() || path.join(process.cwd(), "tmp", "private-receipts");
}

export function isReceiptFileKey(owner: string, file: string) {
  return ownerPattern.test(owner) && filePattern.test(file);
}

export async function savePrivateReceipt({
  owner, fileName, mimeType, buffer
}: {
  owner: string;
  fileName: string;
  mimeType: string;
  buffer: Buffer;
}) {
  if (!ownerPattern.test(owner) || buffer.length === 0) throw new Error("Invalid receipt attachment.");
  const normalizedType = mimeType === "image/jpg" ? "image/jpeg" : mimeType;
  const extension = Object.keys(types).find((key) => types[key] === normalizedType) || "bin";
  const file = `${randomUUID()}.${extension}`;
  const key = `receipts/${owner}/${file}`;
  if (usesPrivateBlobReceipts()) {
    await put(key, buffer, { access: "private", addRandomSuffix: false, contentType: types[extension], token: blobToken() });
  } else {
    const dir = path.join(localReceiptRoot(), owner);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    await writeFile(path.join(dir, file), buffer, { mode: 0o600, flag: "wx" });
  }
  return { receiptUrl: `${privateReceiptUrlPrefix}${owner}/${file}`, receiptFileName: fileName };
}

export async function savePrivateReceiptUpload(owner: string, file: File) {
  if (file.size <= 0) return null;
  return savePrivateReceipt({ owner, fileName: file.name, mimeType: file.type, buffer: Buffer.from(await file.arrayBuffer()) });
}

export async function readPrivateReceipt(owner: string, file: string) {
  if (!isReceiptFileKey(owner, file)) return null;
  if (usesPrivateBlobReceipts()) {
    const result = await get(`receipts/${owner}/${file}`, { access: "private", token: blobToken(), useCache: false });
    return result?.statusCode === 200 ? result.stream : null;
  }
  try {
    return new Uint8Array(await readFile(path.join(localReceiptRoot(), owner, file)));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export function privateReceiptContentType(file: string) {
  return types[file.split(".").at(-1) || "bin"] || types.bin;
}
