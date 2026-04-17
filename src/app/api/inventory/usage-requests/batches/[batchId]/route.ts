import { NextResponse, type NextRequest } from "next/server";
import { Prisma } from "@prisma/client";

import { requireAnyApiPermission } from "@/lib/auth/api-guard";
import { canAccess } from "@/lib/auth/permissions";
import { prisma } from "@/lib/prisma";

import {
  type UsageRequestBatchWithRelations,
  serializeUsageRequestBatchForClient,
  usageRequestBatchInclude
} from "../shared";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ batchId: string }> }
) {
  const auth = await requireAnyApiPermission(request, [
    "inventory:view",
    "reports:view"
  ]);
  if (!auth.ok) {
    return auth.response;
  }

  const canManageInventory = canAccess(auth.session.role, "inventory:manage");
  const scopeParam = (request.nextUrl.searchParams.get("scope") || "").toLowerCase();
  const requestedByParam = (
    request.nextUrl.searchParams.get("requestedBy") || ""
  ).toLowerCase();
  const mineOnly =
    !canManageInventory || scopeParam === "mine" || requestedByParam === "me";

  const { batchId } = await context.params;
  if (!batchId) {
    return NextResponse.json({ message: "Batch ID is required." }, { status: 400 });
  }

  let row: UsageRequestBatchWithRelations | null = null;
  try {
    const found = await prisma.inventoryUsageRequestBatch.findUnique({
      where: { id: batchId },
      include: usageRequestBatchInclude
    });
    row = found as UsageRequestBatchWithRelations | null;
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      (error.code === "P2021" || error.code === "P2022")
    ) {
      return NextResponse.json(
        {
          message:
            "Batch request tables are not available in the current database. Run `npm run db:sync` in development (or `prisma migrate deploy` in production) and retry."
        },
        { status: 503 }
      );
    }
    if (
      error instanceof Error &&
      error.message.toLowerCase().includes("does not exist")
    ) {
      return NextResponse.json(
        {
          message:
            "Batch request tables are missing in the database. Run `npm run db:sync` and retry."
        },
        { status: 503 }
      );
    }
    return NextResponse.json(
      { message: "Failed to load usage batch detail." },
      { status: 500 }
    );
  }
  if (!row) {
    return NextResponse.json({ message: "Usage batch not found." }, { status: 404 });
  }
  if (mineOnly && row.requestedById !== auth.session.userId) {
    return NextResponse.json({ message: "Usage batch not found." }, { status: 404 });
  }

  return NextResponse.json({
    data: serializeUsageRequestBatchForClient(row)
  });
}
