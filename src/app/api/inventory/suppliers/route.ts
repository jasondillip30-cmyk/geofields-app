import { NextResponse, type NextRequest } from "next/server";

import { requireApiPermission } from "@/lib/auth/api-guard";
import { auditActorFromSession, recordAuditLog } from "@/lib/audit";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  const auth = await requireApiPermission(request, "inventory:view");
  if (!auth.ok) {
    return auth.response;
  }

  const suppliers = await prisma.inventorySupplier.findMany({
    orderBy: { name: "asc" },
    include: {
      _count: {
        select: {
          items: true,
          movements: true
        }
      }
    }
  });

  const [purchaseAggregates, latestPurchases] = await Promise.all([
    prisma.inventoryMovement.groupBy({
      by: ["supplierId"],
      where: {
        supplierId: { not: null },
        movementType: "IN"
      },
      _count: {
        _all: true
      },
      _sum: {
        totalCost: true
      }
    }),
    prisma.inventoryMovement.findMany({
      where: {
        supplierId: { not: null },
        movementType: "IN"
      },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      select: {
        supplierId: true,
        date: true,
        unitCost: true
      }
    })
  ]);

  const aggregateBySupplier = new Map(
    purchaseAggregates
      .filter((entry) => Boolean(entry.supplierId))
      .map((entry) => [
        entry.supplierId as string,
        {
          purchaseCount: entry._count._all,
          totalPurchaseCost: Math.round(((entry._sum.totalCost || 0) + Number.EPSILON) * 100) / 100
        }
      ])
  );

  const latestPurchaseBySupplier = new Map<string, { date: Date; unitCost: number | null }>();
  for (const movement of latestPurchases) {
    if (!movement.supplierId || latestPurchaseBySupplier.has(movement.supplierId)) {
      continue;
    }
    latestPurchaseBySupplier.set(movement.supplierId, {
      date: movement.date,
      unitCost: movement.unitCost
    });
  }

  return NextResponse.json({
    data: suppliers.map((supplier) => {
      const purchaseStats = aggregateBySupplier.get(supplier.id);
      const latest = latestPurchaseBySupplier.get(supplier.id);
      return {
        id: supplier.id,
        name: supplier.name,
        contactPerson: supplier.contactPerson,
        email: supplier.email,
        phone: supplier.phone,
        notes: supplier.notes,
        isActive: supplier.isActive,
        createdAt: supplier.createdAt,
        updatedAt: supplier.updatedAt,
        itemCount: supplier._count.items,
        movementCount: supplier._count.movements,
        purchaseCount: purchaseStats?.purchaseCount || 0,
        totalPurchaseCost: purchaseStats?.totalPurchaseCost || 0,
        latestPurchaseDate: latest?.date || null,
        latestPurchaseUnitCost: latest?.unitCost ?? null
      };
    })
  });
}

export async function POST(request: NextRequest) {
  const auth = await requireApiPermission(request, "inventory:manage");
  if (!auth.ok) {
    return auth.response;
  }

  const body = await request.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name) {
    return NextResponse.json({ message: "Supplier name is required." }, { status: 400 });
  }

  const existing = await prisma.inventorySupplier.findUnique({
    where: { name },
    select: { id: true }
  });
  if (existing) {
    return NextResponse.json({ message: "Supplier with this name already exists." }, { status: 409 });
  }

  const created = await prisma.$transaction(async (tx) => {
    const inserted = await tx.inventorySupplier.create({
      data: {
        name,
        contactPerson: typeof body?.contactPerson === "string" ? body.contactPerson.trim() : null,
        email: typeof body?.email === "string" ? body.email.trim().toLowerCase() : null,
        phone: typeof body?.phone === "string" ? body.phone.trim() : null,
        notes: typeof body?.notes === "string" ? body.notes.trim() : null,
        isActive: typeof body?.isActive === "boolean" ? body.isActive : true
      }
    });

    await recordAuditLog({
      db: tx,
      module: "inventory",
      entityType: "inventory_supplier",
      entityId: inserted.id,
      action: "create",
      description: `${auth.session.name} created Supplier ${inserted.name}.`,
      after: {
        id: inserted.id,
        name: inserted.name,
        isActive: inserted.isActive
      },
      actor: auditActorFromSession(auth.session)
    });

    return inserted;
  });

  return NextResponse.json({ data: created }, { status: 201 });
}

