import { randomUUID } from "node:crypto";

import { Prisma } from "@prisma/client";
import { NextResponse, type NextRequest } from "next/server";

import { requireApiPermission } from "@/lib/auth/api-guard";
import { auditActorFromSession, recordAuditLog } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import {
  buildDefaultRequisitionSetupPayload,
  normalizeMasterDataKey,
  normalizeMasterDataName,
  parsePurchaseRequisitionSetupPayload,
  PURCHASE_REQUISITION_SETUP_REPORT_TYPE,
  type PurchaseRequisitionSetupPayload,
  type RequisitionMasterDataSource,
  type RequisitionSubcategorySetupRecord
} from "@/lib/requisition-master-data";

export const runtime = "nodejs";

type SetupSummaryRow = {
  id: string;
  payloadJson: string;
};

export async function GET(request: NextRequest) {
  const auth = await requireApiPermission(request, "expenses:manual");
  if (!auth.ok) {
    return auth.response;
  }

  const payload = await prisma.$transaction((tx) => ensureSetupPayload(tx, auth.session.userId));

  return NextResponse.json({
    data: serializeSetupPayload(payload)
  });
}

export async function POST(request: NextRequest) {
  const auth = await requireApiPermission(request, "expenses:manual");
  if (!auth.ok) {
    return auth.response;
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const action = typeof body?.action === "string" ? body.action.trim() : "";
  if (action !== "create_subcategory") {
    return NextResponse.json({ message: "Unsupported setup action." }, { status: 400 });
  }

  const categoryId = typeof body?.categoryId === "string" ? body.categoryId.trim() : "";
  const name = normalizeMasterDataName(typeof body?.name === "string" ? body.name : "");
  const source = parseSource(body?.source);

  if (!categoryId) {
    return NextResponse.json({ message: "Category is required." }, { status: 400 });
  }
  if (!name) {
    return NextResponse.json({ message: "Subcategory name is required." }, { status: 400 });
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const current = await ensureSetupPayload(tx, auth.session.userId);
      const category = current.categories.find((entry) => entry.id === categoryId && entry.isActive);
      if (!category) {
        throw new ApiError("Selected category does not exist in setup.", 404);
      }

      const normalizedName = normalizeMasterDataKey(name);
      const existing = current.subcategories.find(
        (entry) =>
          entry.isActive &&
          entry.categoryId === categoryId &&
          normalizeMasterDataKey(entry.name) === normalizedName
      );
      if (existing) {
        return {
          created: false,
          subcategory: existing,
          payload: current
        };
      }

      const now = new Date();
      const createdSubcategory: RequisitionSubcategorySetupRecord = {
        id: `sub-${randomUUID()}`,
        name,
        categoryId,
        isActive: true,
        createdAt: now.toISOString(),
        createdByUserId: auth.session.userId,
        source
      };
      const nextPayload: PurchaseRequisitionSetupPayload = {
        ...current,
        subcategories: [...current.subcategories, createdSubcategory]
      };

      await tx.summaryReport.create({
        data: {
          reportType: PURCHASE_REQUISITION_SETUP_REPORT_TYPE,
          reportDate: now,
          payloadJson: JSON.stringify(nextPayload),
          generatedById: auth.session.userId
        }
      });

      await recordAuditLog({
        db: tx,
        module: "expenses",
        entityType: "requisition_subcategory_setup",
        entityId: createdSubcategory.id,
        action: "create",
        description: `${auth.session.name} created requisition subcategory ${createdSubcategory.name} from request flow.`,
        after: {
          name: createdSubcategory.name,
          categoryId: createdSubcategory.categoryId,
          source: createdSubcategory.source
        },
        actor: auditActorFromSession(auth.session)
      });

      return {
        created: true,
        subcategory: createdSubcategory,
        payload: nextPayload
      };
    });

    return NextResponse.json({
      data: {
        ...serializeSetupPayload(result.payload),
        created: result.created,
        subcategory: result.subcategory
      }
    });
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { message: "Failed to update requisition setup." },
      { status: 500 }
    );
  }
}

async function ensureSetupPayload(
  tx: Prisma.TransactionClient,
  actorUserId: string
): Promise<PurchaseRequisitionSetupPayload> {
  const existing = await findLatestSetupRow(tx);
  if (existing) {
    const parsed = parsePurchaseRequisitionSetupPayload(existing.payloadJson);
    if (parsed && parsed.categories.length > 0) {
      return parsed;
    }
  }

  const seeded = buildDefaultRequisitionSetupPayload({
    createdByUserId: actorUserId,
    now: new Date()
  });
  await tx.summaryReport.create({
    data: {
      reportType: PURCHASE_REQUISITION_SETUP_REPORT_TYPE,
      reportDate: new Date(),
      payloadJson: JSON.stringify(seeded),
      generatedById: actorUserId
    }
  });
  return seeded;
}

async function findLatestSetupRow(tx: Prisma.TransactionClient): Promise<SetupSummaryRow | null> {
  return tx.summaryReport.findFirst({
    where: {
      reportType: PURCHASE_REQUISITION_SETUP_REPORT_TYPE
    },
    orderBy: [{ reportDate: "desc" }, { updatedAt: "desc" }],
    select: {
      id: true,
      payloadJson: true
    }
  });
}

function parseSource(value: unknown): RequisitionMasterDataSource {
  if (value === "setup" || value === "request_flow") {
    return value;
  }
  return "request_flow";
}

function serializeSetupPayload(payload: PurchaseRequisitionSetupPayload) {
  const categories = payload.categories
    .filter((entry) => entry.isActive)
    .sort((a, b) => a.name.localeCompare(b.name));
  const subcategories = payload.subcategories
    .filter((entry) => entry.isActive)
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    categories,
    subcategories
  };
}

class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}
