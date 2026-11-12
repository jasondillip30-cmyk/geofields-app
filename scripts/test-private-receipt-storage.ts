import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { NextRequest } from "next/server";

import { parseReceiptSnapshot } from "../src/app/api/inventory/receipt-intake/commit/commit-request-parsing";
import { GET } from "../src/app/api/receipts/files/[owner]/[file]/route";
import { signSessionToken } from "../src/lib/auth/session";
import type { UserRole } from "../src/lib/types";
import { savePrivateReceipt } from "../src/lib/private-receipt-storage";

async function main() {
  const root = await mkdtemp(path.join(tmpdir(), "geofields-private-receipts-"));
  process.env.RECEIPT_LOCAL_STORAGE_DIR = root;
  process.env.AUTH_SECRET = randomBytes(48).toString("hex");
  delete process.env.VERCEL;
  delete process.env.RECEIPT_STORAGE;
  delete process.env.BLOB_READ_WRITE_TOKEN;
  try {
    const input = {
      owner: "receipt-owner",
      fileName: "example.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.4 synthetic storage check")
    };
    const saved = await savePrivateReceipt(input);
    const file = saved.receiptUrl.split("/").at(-1)!;
    const params = { params: Promise.resolve({ owner: input.owner, file }) };
    const url = `http://localhost${saved.receiptUrl}`;
    async function open(userId: string, role: UserRole, requestParams = params) {
      const token = await signSessionToken({ userId, role, email: "synthetic@geofields.test", name: "Receipt Test" });
      return GET(new NextRequest(url, { headers: { Cookie: `gf_session=${token}` } }), requestParams);
    }

    assert.equal((await GET(new NextRequest(url), params)).status, 401);
    assert.equal((await open("another-mechanic", "MECHANIC")).status, 404);
    assert.equal((await open("field-user", "FIELD")).status, 403);
    assert.equal((await open("manager", "MANAGER", {
      params: Promise.resolve({ owner: "..", file })
    })).status, 404);

    for (const [id, role] of [[input.owner, "MECHANIC"], ["manager", "MANAGER"], ["office", "OFFICE"], ["admin", "ADMIN"]] as const) {
      const response = await open(id, role);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("cache-control"), "private, no-store");
      assert.equal(response.headers.get("content-type"), "application/pdf");
      assert.equal(response.headers.get("x-content-type-options"), "nosniff");
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), input.buffer);
    }

    const verificationUrl = "https://verify.tra.go.tz/0192C43691_190351";
    const snapshot = parseReceiptSnapshot({ receipt: { url: saved.receiptUrl, verificationUrl } });
    assert.equal(snapshot.receiptUrl, saved.receiptUrl);
    assert.equal(snapshot.verificationUrl, verificationUrl);
    assert.equal(parseReceiptSnapshot({ receipt: { verificationUrl } }).receiptUrl, verificationUrl);

    process.env.VERCEL = "1";
    await assert.rejects(savePrivateReceipt(input), /not configured/);
    assert.equal((await open(input.owner, "MECHANIC")).status, 503);
    console.log("Private receipts: owner and finance access, denial for others, no caching, preserved attachment, and no hosted fallback.");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
