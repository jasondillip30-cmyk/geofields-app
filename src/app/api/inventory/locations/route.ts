import { NextResponse, type NextRequest } from "next/server";

import { requireApiPermission } from "@/lib/auth/api-guard";
import { auditActorFromSession, recordAuditLog } from "@/lib/audit";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  const auth = await requireApiPermission(request, "inventory:view");
  if (!auth.ok) {
    return auth.response;
  }

  const locations = await prisma.inventoryLocation.findMany({
    orderBy: { name: "asc" },
    include: {
      _count: {
        select: {
          items: true,
          movementFrom: true,
          movementTo: true
        }
      }
    }
  });

  return NextResponse.json({
    data: locations.map((location) => ({
      id: location.id,
      name: location.name,
      description: location.description,
      isActive: location.isActive,
      createdAt: location.createdAt,
      updatedAt: location.updatedAt,
      itemCount: location._count.items,
      movementOutCount: location._count.movementFrom,
      movementInCount: location._count.movementTo
    }))
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
    return NextResponse.json({ message: "Location name is required." }, { status: 400 });
  }

  const existing = await prisma.inventoryLocation.findUnique({
    where: { name },
    select: { id: true }
  });
  if (existing) {
    return NextResponse.json({ message: "Location with this name already exists." }, { status: 409 });
  }

  const created = await prisma.$transaction(async (tx) => {
    const inserted = await tx.inventoryLocation.create({
      data: {
        name,
        description: typeof body?.description === "string" ? body.description.trim() : null,
        isActive: typeof body?.isActive === "boolean" ? body.isActive : true
      }
    });

    await recordAuditLog({
      db: tx,
      module: "inventory",
      entityType: "inventory_location",
      entityId: inserted.id,
      action: "create",
      description: `${auth.session.name} created Location ${inserted.name}.`,
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

