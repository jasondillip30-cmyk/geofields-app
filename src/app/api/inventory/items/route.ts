import type { Prisma } from "@prisma/client";
import { NextResponse, type NextRequest } from "next/server";

import { requireApiPermission } from "@/lib/auth/api-guard";
import { auditActorFromSession, recordAuditLog } from "@/lib/audit";
import {
  nullableFilter,
  parseInventoryCategory,
  parseInventoryStatus,
  parseNumeric,
  roundCurrency
} from "@/lib/inventory-server";
import { prisma } from "@/lib/prisma";
import { buildProjectConsumablesPool } from "@/lib/project-consumables-pool";

const itemInclude = {
  supplier: { select: { id: true, name: true } },
  location: { select: { id: true, name: true } },
  compatibleRig: { select: { id: true, rigCode: true } }
} as const;

type StockFilter = "all" | "low" | "out" | "healthy";

export async function GET(request: NextRequest) {
  const auth = await requireApiPermission(request, "inventory:view");
  if (!auth.ok) {
    return auth.response;
  }

  const search = request.nextUrl.searchParams.get("search")?.trim() || "";
  const category = parseInventoryCategory(request.nextUrl.searchParams.get("category"));
  const supplierId = nullableFilter(request.nextUrl.searchParams.get("supplierId"));
  const locationId = nullableFilter(request.nextUrl.searchParams.get("locationId"));
  const status = parseInventoryStatus(request.nextUrl.searchParams.get("status"));
  const stockFilter = parseStockFilter(request.nextUrl.searchParams.get("stock"));
  const projectId = nullableFilter(request.nextUrl.searchParams.get("projectId"));

  let approvedProjectItemIds: string[] | null = null;
  let approvedPoolByItemId = new Map<
    string,
    {
      approvedQuantity: number;
      availableApprovedQuantity: number;
      availableApprovedValue: number;
      usedQuantity: number;
      usedValue: number;
    }
  >();

  if (projectId) {
    const poolRows = await buildProjectConsumablesPool({
      projectId,
      includeZeroAvailable: true
    });
    approvedProjectItemIds = poolRows
      .filter((row) => row.approvedRequestQty + row.approvedPurchaseQty > 0)
      .map((row) => row.itemId);
    approvedPoolByItemId = new Map(
      poolRows.map((row) => [
        row.itemId,
        {
          approvedQuantity: roundCurrency(row.approvedRequestQty + row.approvedPurchaseQty),
          availableApprovedQuantity: row.availableNow,
          availableApprovedValue: roundCurrency(row.availableNow * row.unitCost),
          usedQuantity: row.consumedQty,
          usedValue: roundCurrency(row.consumedQty * row.unitCost)
        }
      ])
    );
  }

  const where: Prisma.InventoryItemWhereInput = {
    ...(search
      ? {
          OR: [
            { name: { contains: search, mode: "insensitive" } },
            { sku: { contains: search, mode: "insensitive" } },
            { partNumber: { contains: search, mode: "insensitive" } }
          ]
        }
      : {}),
    ...(category ? { category } : {}),
    ...(supplierId ? { supplierId } : {}),
    ...(locationId ? { locationId } : {}),
    ...(status ? { status } : {}),
    ...(approvedProjectItemIds
      ? {
          id: {
            in: approvedProjectItemIds.length > 0 ? approvedProjectItemIds : ["__none__"]
          }
        }
      : {})
  };

  const items = await prisma.inventoryItem.findMany({
    where,
    orderBy: [{ name: "asc" }],
    include: itemInclude
  });

  const movementSnapshots =
    items.length === 0
      ? []
      : await prisma.inventoryMovement.findMany({
          where: {
            itemId: { in: items.map((item) => item.id) }
          },
          orderBy: [{ date: "desc" }, { createdAt: "desc" }],
          select: {
            itemId: true,
            date: true,
            movementType: true
          }
        });

  const latestMovementByItem = new Map<string, { date: Date; movementType: string }>();
  for (const snapshot of movementSnapshots) {
    if (latestMovementByItem.has(snapshot.itemId)) {
      continue;
    }
    latestMovementByItem.set(snapshot.itemId, {
      date: snapshot.date,
      movementType: snapshot.movementType
    });
  }

  const normalizedItems = items.map((item) => {
    const inventoryValue = roundCurrency(item.quantityInStock * item.unitCost);
    const lowStock = item.quantityInStock > 0 && item.quantityInStock <= item.minimumStockLevel;
    const outOfStock = item.quantityInStock <= 0;
    const latestMovement = latestMovementByItem.get(item.id);
    return {
      id: item.id,
      name: item.name,
      sku: item.sku,
      category: item.category,
      description: item.description,
      quantityInStock: item.quantityInStock,
      minimumStockLevel: item.minimumStockLevel,
      unitCost: item.unitCost,
      inventoryValue,
      supplierId: item.supplierId,
      supplier: item.supplier || null,
      locationId: item.locationId,
      location: item.location || null,
      compatibleRigId: item.compatibleRigId,
      compatibleRig: item.compatibleRig || null,
      compatibleRigType: item.compatibleRigType,
      partNumber: item.partNumber,
      status: item.status,
      notes: item.notes,
      lowStock,
      outOfStock,
      latestMovementDate: latestMovement?.date || null,
      latestMovementType: latestMovement?.movementType || null,
      approvedProjectContext:
        projectId && approvedPoolByItemId.has(item.id)
          ? approvedPoolByItemId.get(item.id)
          : null,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt
    };
  });

  const filtered = normalizedItems.filter((item) => {
    if (stockFilter === "all") {
      return true;
    }
    if (stockFilter === "low") {
      return item.lowStock;
    }
    if (stockFilter === "out") {
      return item.outOfStock;
    }
    return !item.outOfStock && !item.lowStock;
  });

  return NextResponse.json({
    data: filtered,
    meta: {
      totalItems: normalizedItems.length,
      lowStockCount: normalizedItems.filter((item) => item.lowStock).length,
      outOfStockCount: normalizedItems.filter((item) => item.outOfStock).length,
      totalInventoryValue: roundCurrency(normalizedItems.reduce((sum, item) => sum + item.inventoryValue, 0)),
      projectId: projectId || "all"
    }
  });
}

export async function POST(request: NextRequest) {
  const auth = await requireApiPermission(request, "inventory:manage");
  if (!auth.ok) {
    return auth.response;
  }

  const body = await request.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const sku = typeof body?.sku === "string" ? body.sku.trim().toUpperCase() : "";
  const category = parseInventoryCategory(body?.category);
  const quantityInStock = parseNumeric(body?.quantityInStock);
  const minimumStockLevel = parseNumeric(body?.minimumStockLevel);
  const unitCost = parseNumeric(body?.unitCost);

  if (!name || !sku || !category) {
    return NextResponse.json({ message: "name, sku, and category are required." }, { status: 400 });
  }
  if (quantityInStock === null || quantityInStock < 0) {
    return NextResponse.json({ message: "quantityInStock must be a number >= 0." }, { status: 400 });
  }
  if (minimumStockLevel === null || minimumStockLevel < 0) {
    return NextResponse.json({ message: "minimumStockLevel must be a number >= 0." }, { status: 400 });
  }
  if (unitCost === null || unitCost < 0) {
    return NextResponse.json({ message: "unitCost must be a number >= 0." }, { status: 400 });
  }

  const supplierId = nullableFilter(typeof body?.supplierId === "string" ? body.supplierId : null);
  const locationId = nullableFilter(typeof body?.locationId === "string" ? body.locationId : null);
  const compatibleRigId = nullableFilter(typeof body?.compatibleRigId === "string" ? body.compatibleRigId : null);
  const status = parseInventoryStatus(body?.status) || "ACTIVE";

  if (supplierId) {
    const supplier = await prisma.inventorySupplier.findUnique({
      where: { id: supplierId },
      select: { id: true }
    });
    if (!supplier) {
      return NextResponse.json({ message: "Supplier not found." }, { status: 404 });
    }
  }

  if (locationId) {
    const location = await prisma.inventoryLocation.findUnique({
      where: { id: locationId },
      select: { id: true }
    });
    if (!location) {
      return NextResponse.json({ message: "Location not found." }, { status: 404 });
    }
  }

  if (compatibleRigId) {
    const rig = await prisma.rig.findUnique({
      where: { id: compatibleRigId },
      select: { id: true }
    });
    if (!rig) {
      return NextResponse.json({ message: "Compatible rig not found." }, { status: 404 });
    }
  }

  const existingSku = await prisma.inventoryItem.findUnique({
    where: { sku },
    select: { id: true }
  });
  if (existingSku) {
    return NextResponse.json({ message: "An item with this SKU already exists." }, { status: 409 });
  }

  const created = await prisma.$transaction(async (tx) => {
    const inserted = await tx.inventoryItem.create({
      data: {
        name,
        sku,
        category,
        description: typeof body?.description === "string" ? body.description.trim() : null,
        quantityInStock,
        minimumStockLevel,
        unitCost,
        supplierId,
        locationId,
        compatibleRigId,
        compatibleRigType: typeof body?.compatibleRigType === "string" ? body.compatibleRigType.trim() : null,
        partNumber: typeof body?.partNumber === "string" ? body.partNumber.trim() : null,
        status,
        notes: typeof body?.notes === "string" ? body.notes.trim() : null
      },
      include: itemInclude
    });

    await recordAuditLog({
      db: tx,
      module: "inventory",
      entityType: "inventory_item",
      entityId: inserted.id,
      action: "create",
      description: `${auth.session.name} created Inventory Item ${inserted.name}.`,
      after: {
        id: inserted.id,
        name: inserted.name,
        sku: inserted.sku,
        category: inserted.category,
        quantityInStock: inserted.quantityInStock,
        minimumStockLevel: inserted.minimumStockLevel
      },
      actor: auditActorFromSession(auth.session)
    });

    return inserted;
  });

  return NextResponse.json(
    {
      data: {
        ...created,
        inventoryValue: roundCurrency(created.quantityInStock * created.unitCost),
        lowStock: created.quantityInStock > 0 && created.quantityInStock <= created.minimumStockLevel,
        outOfStock: created.quantityInStock <= 0
      }
    },
    { status: 201 }
  );
}

function parseStockFilter(value: string | null): StockFilter {
  if (value === "low" || value === "out" || value === "healthy") {
    return value;
  }
  return "all";
}
