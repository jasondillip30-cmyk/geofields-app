import { NextResponse, type NextRequest } from "next/server";

import { requireApiPermission } from "@/lib/auth/api-guard";
import { prisma } from "@/lib/prisma";

const movementInclude = {
  item: {
    select: {
      id: true,
      name: true,
      sku: true,
      category: true,
      quantityInStock: true,
      minimumStockLevel: true,
      unitCost: true
    }
  },
  performedBy: { select: { id: true, fullName: true, role: true } },
  client: { select: { id: true, name: true } },
  rig: { select: { id: true, rigCode: true } },
  project: { select: { id: true, name: true } },
  maintenanceRequest: { select: { id: true, requestCode: true, status: true } },
  expense: {
    select: {
      id: true,
      amount: true,
      category: true,
      subcategory: true,
      approvalStatus: true,
      date: true,
      client: { select: { id: true, name: true } },
      project: { select: { id: true, name: true } },
      rig: { select: { id: true, rigCode: true } },
      enteredBy: { select: { id: true, fullName: true } }
    }
  },
  supplier: { select: { id: true, name: true } },
  locationFrom: { select: { id: true, name: true } },
  locationTo: { select: { id: true, name: true } }
} as const;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ movementId: string }> }
) {
  const auth = await requireApiPermission(request, "inventory:view");
  if (!auth.ok) {
    return auth.response;
  }

  const { movementId } = await params;
  const movement = await prisma.inventoryMovement.findUnique({
    where: { id: movementId },
    include: movementInclude
  });

  if (!movement) {
    return NextResponse.json({ message: "Stock movement not found." }, { status: 404 });
  }

  const relatedFilters: Array<{ receiptUrl?: string; traReceiptNumber?: string; supplierInvoiceNumber?: string }> = [];
  if (movement.receiptUrl) {
    relatedFilters.push({ receiptUrl: movement.receiptUrl });
  }
  if (movement.traReceiptNumber) {
    relatedFilters.push({ traReceiptNumber: movement.traReceiptNumber });
  }
  if (movement.supplierInvoiceNumber) {
    relatedFilters.push({ supplierInvoiceNumber: movement.supplierInvoiceNumber });
  }

  const relatedMovements =
    relatedFilters.length === 0
      ? []
      : await prisma.inventoryMovement.findMany({
          where: {
            id: { not: movement.id },
            OR: relatedFilters
          },
          orderBy: [{ date: "desc" }, { createdAt: "desc" }],
          take: 10,
          include: {
            item: { select: { id: true, name: true, sku: true } },
            expense: { select: { id: true, amount: true, approvalStatus: true } },
            rig: { select: { id: true, rigCode: true } },
            project: { select: { id: true, name: true } }
          }
        });

  return NextResponse.json({
    data: movement,
    relatedMovements
  });
}
