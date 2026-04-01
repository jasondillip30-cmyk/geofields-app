import { resolveAuthSecretValue } from "@/lib/auth/secret";
import type { AuthSession } from "@/lib/auth/session";

interface EdgeSessionPayload extends AuthSession {
  exp?: number;
  nbf?: number;
}

function decodeBase64UrlToString(value: string) {
  try {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    return atob(padded);
  } catch {
    return null;
  }
}

function decodeBase64UrlToBytes(value: string) {
  const binary = decodeBase64UrlToString(value);
  if (!binary) {
    return null;
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function parsePayload(payloadSegment: string): EdgeSessionPayload | null {
  const decoded = decodeBase64UrlToString(payloadSegment);
  if (!decoded) {
    return null;
  }

  try {
    const payload = JSON.parse(decoded) as EdgeSessionPayload;
    if (
      !payload ||
      typeof payload.userId !== "string" ||
      typeof payload.email !== "string" ||
      typeof payload.name !== "string" ||
      typeof payload.role !== "string"
    ) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

async function verifySignature({
  headerSegment,
  payloadSegment,
  signatureSegment
}: {
  headerSegment: string;
  payloadSegment: string;
  signatureSegment: string;
}) {
  const signature = decodeBase64UrlToBytes(signatureSegment);
  if (!signature) {
    return false;
  }

  const secret = resolveAuthSecretValue();
  const data = new TextEncoder().encode(`${headerSegment}.${payloadSegment}`);
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"]
  );

  return crypto.subtle.verify("HMAC", key, signature, data);
}

export async function verifyEdgeSessionToken(token: string): Promise<AuthSession | null> {
  const [headerSegment, payloadSegment, signatureSegment] = token.split(".");
  if (!headerSegment || !payloadSegment || !signatureSegment) {
    return null;
  }

  const headerRaw = decodeBase64UrlToString(headerSegment);
  if (!headerRaw) {
    return null;
  }

  let header: { alg?: string };
  try {
    header = JSON.parse(headerRaw) as { alg?: string };
  } catch {
    return null;
  }

  if (header.alg !== "HS256") {
    return null;
  }

  const signatureIsValid = await verifySignature({
    headerSegment,
    payloadSegment,
    signatureSegment
  });
  if (!signatureIsValid) {
    return null;
  }

  const payload = parsePayload(payloadSegment);
  if (!payload) {
    return null;
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (typeof payload.exp === "number" && payload.exp <= nowSeconds) {
    return null;
  }
  if (typeof payload.nbf === "number" && payload.nbf > nowSeconds) {
    return null;
  }

  return {
    userId: payload.userId,
    email: payload.email,
    name: payload.name,
    role: payload.role
  };
}
