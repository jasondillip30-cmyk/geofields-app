import { NextResponse, type NextRequest } from "next/server";

import { requireAnyApiPermission } from "@/lib/auth/api-guard";
import { canAccess } from "@/lib/auth/permissions";
import { isReceiptFileKey, privateReceiptContentType, readPrivateReceipt } from "@/lib/private-receipt-storage";

export const runtime = "nodejs";

export async function GET(request: NextRequest, { params }: { params: Promise<{ owner: string; file: string }> }) {
  const auth = await requireAnyApiPermission(request, ["inventory:view", "requisitions:view", "expenses:manual", "finance:view"]);
  if (!auth.ok) return auth.response;

  const { owner, file } = await params;
  const notFound = () => NextResponse.json({ message: "Receipt not found." }, { status: 404 });
  if (!isReceiptFileKey(owner, file) ||
      (auth.session.userId !== owner && !canAccess(auth.session.role, "finance:view"))) return notFound();

  try {
    const body = await readPrivateReceipt(owner, file);
    if (!body) return notFound();
    const contentType = privateReceiptContentType(file);
    return new Response(body, {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Type": contentType,
        "Content-Disposition": `${contentType === "application/octet-stream" ? "attachment" : "inline"}; filename="${file}"`,
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox"
      }
    });
  } catch {
    return NextResponse.json({ message: "Receipt storage is unavailable." }, { status: 503 });
  }
}
