import type { Prisma } from "@prisma/client";
import { NextResponse, type NextRequest } from "next/server";

import { requireApiPermission } from "@/lib/auth/api-guard";
import { auditActorFromSession, recordAuditLog } from "@/lib/audit";
import {
  buildDateFilter,
  nullableFilter,
  parseDateOrNull,
  parseInventoryCategory,
  parseInventoryStatus,
  parseNumeric,
  roundCurrency
} from "@/lib/inventory-server";
import { prisma } from "@/lib/prisma";

const itemInclude = {
  supplier: { select: { id: true, name: true } },
  location: { select: { id: true, name: true } },
  compatibleRig: { select: { id: true, rigCode: true } }
} as const;

const movementInclude = {
  item: { select: { id: true, name: true, sku: true, category: true } },
  performedBy: { select: { id: true, fullName: true, role: true } },
  rig: { select: { id: true, rigCode: true } },
  project: { select: { id: true, name: true, clientId: true } },
  client: { select: { id: true, name: true } },
  maintenanceRequest: { select: { id: true, requestCode: true, status: true } },
  expense: { select: { id: true, amount: true, category: true, approvalStatus: true, receiptUrl: true } },
  supplier: { select: { id: true, name: true } },
  locationFrom: { select: { id: true, name: true } },
  locationTo: { select: { id: true, name: true } }
} as const;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ itemId: string }> }
) {
  const auth = await requireApiPermission(request, "inventory:view");
  if (!auth.ok) {
    return auth.response;
  }

  const { itemId } = await params;
  const fromDate = parseDateOrNull(request.nextUrl.searchParams.get("from"));
  const toDate = parseDateOrNull(request.nextUrl.searchParams.get("to"), true);
  const clientId = nullableFilter(request.nextUrl.searchParams.get("clientId"));
  const rigId = nullableFilter(request.nextUrl.searchParams.get("rigId"));

  const item = await prisma.inventoryItem.findUnique({
    where: { id: itemId },
    include: itemInclude
  });
  if (!item) {
    return NextResponse.json({ message: "Inventory item not found." }, { status: 404 });
  }

  const movementWhere: Prisma.InventoryMovementWhereInput = {
    itemId,
    ...(clientId ? { clientId } : {}),
    ...(rigId ? { rigId } : {}),
    ...(buildDateFilter(fromDate, toDate) ? { date: buildDateFilter(fromDate, toDate) } : {})
  };

  const movements = await prisma.inventoryMovement.findMany({
    where: movementWhere,
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    include: movementInclude
  });

  const movementTimelineMap = new Map<string, { date: string; inQty: number; outQty: number; adjustmentQty: number; transferQty: number }>();
  const monthlyConsumptionMap = new Map<string, { label: string; quantity: number; cost: number }>();

  for (const movement of movements) {
    const day = movement.date.toISOString().slice(0, 10);
    const row = movementTimelineMap.get(day) || { date: day, inQty: 0, outQty: 0, adjustmentQty: 0, transferQty: 0 };
    if (movement.movementType === "IN") {
      row.inQty += movement.quantity;
    } else if (movement.movementType === "OUT") {
      row.outQty += movement.quantity;
      const monthKey = `${movement.date.getUTCFullYear()}-${String(movement.date.getUTCMonth() + 1).padStart(2, "0")}`;
      const monthRow = monthlyConsumptionMap.get(monthKey) || { label: monthKey, quantity: 0, cost: 0 };
      monthRow.quantity += movement.quantity;
      monthRow.cost += movement.totalCost || 0;
      monthlyConsumptionMap.set(monthKey, monthRow);
    } else if (movement.movementType === "ADJUSTMENT") {
      row.adjustmentQty += movement.quantity;
    } else {
      row.transferQty += movement.quantity;
    }
    movementTimelineMap.set(day, row);
  }

  const timeline = Array.from(movementTimelineMap.values())
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((entry) => ({
      ...entry,
      inQty: roundCurrency(entry.inQty),
      outQty: roundCurrency(entry.outQty),
      adjustmentQty: roundCurrency(entry.adjustmentQty),
      transferQty: roundCurrency(entry.transferQty)
    }));

  const monthlyConsumption = Array.from(monthlyConsumptionMap.values())
    .sort((a, b) => a.label.localeCompare(b.label))
    .map((entry) => ({
      month: entry.label,
      quantity: roundCurrency(entry.quantity),
      cost: roundCurrency(entry.cost)
    }));

  const serializedMovements = movements.map((movement) => ({
    id: movement.id,
    itemId: movement.itemId,
    movementType: movement.movementType,
    quantity: movement.quantity,
    unitCost: movement.unitCost,
    totalCost: movement.totalCost,
    date: movement.date,
    notes: movement.notes,
    traReceiptNumber: movement.traReceiptNumber,
    supplierInvoiceNumber: movement.supplierInvoiceNumber,
    receiptUrl: movement.receiptUrl,
    receiptFileName: movement.receiptFileName,
    item: movement.item || null,
    performedBy: movement.performedBy || null,
    rig: movement.rig || null,
    project: movement.project || null,
    client: movement.client || null,
    maintenanceRequest: movement.maintenanceRequest || null,
    expense: movement.expense || null,
    supplier: movement.supplier || null,
    locationFrom: movement.locationFrom || null,
    locationTo: movement.locationTo || null
  }));

  const usageHistory = serializedMovements.filter((movement) => movement.movementType === "OUT");
  const purchaseHistory = serializedMovements.filter((movement) => movement.movementType === "IN");

  const linkedMaintenance = usageHistory
    .filter((movement) => movement.maintenanceRequest)
    .map((movement) => ({
      movementId: movement.id,
      requestId: movement.maintenanceRequest?.id,
      requestCode: movement.maintenanceRequest?.requestCode,
      status: movement.maintenanceRequest?.status,
      quantity: movement.quantity,
      totalCost: movement.totalCost,
      date: movement.date
    }));

  const linkedExpenses = serializedMovements
    .filter((movement) => movement.expense)
    .map((movement) => ({
      movementId: movement.id,
      expenseId: movement.expense?.id,
      amount: movement.expense?.amount,
      category: movement.expense?.category,
      approvalStatus: movement.expense?.approvalStatus,
      receiptUrl: movement.expense?.receiptUrl || movement.receiptUrl || null,
      date: movement.date
    }));

  return NextResponse.json({
    data: {
      id: item.id,
      name: item.name,
      sku: item.sku,
      category: item.category,
      description: item.description,
      quantityInStock: item.quantityInStock,
      minimumStockLevel: item.minimumStockLevel,
      unitCost: item.unitCost,
      inventoryValue: roundCurrency(item.quantityInStock * item.unitCost),
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
      createdAt: item.createdAt,
      updatedAt: item.updatedAt
    },
    movements: serializedMovements,
    usageHistory,
    purchaseHistory,
    linkedMaintenance,
    linkedExpenses,
    stockMovementOverTime: timeline,
    monthlyConsumption
  });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ itemId: string }> }
) {
  const auth = await requireApiPermission(request, "inventory:manage");
  if (!auth.ok) {
    return auth.response;
  }

  const { itemId } = await params;
  const body = await request.json().catch(() => null);

  const existing = await prisma.inventoryItem.findUnique({
    where: { id: itemId },
    include: itemInclude
  });
  if (!existing) {
    return NextResponse.json({ message: "Inventory item not found." }, { status: 404 });
  }

  if (body && "quantityInStock" in body) {
    return NextResponse.json(
      { message: "Use stock movements to change quantityInStock. Direct stock edits are not allowed." },
      { status: 400 }
    );
  }

  const category = body?.category !== undefined ? parseInventoryCategory(body.category) : null;
  const status = body?.status !== undefined ? parseInventoryStatus(body.status) : null;
  const minimumStockLevel = body?.minimumStockLevel !== undefined ? parseNumeric(body.minimumStockLevel) : undefined;
  const unitCost = body?.unitCost !== undefined ? parseNumeric(body.unitCost) : undefined;

  if (body?.category !== undefined && !category) {
    return NextResponse.json({ message: "Invalid category." }, { status: 400 });
  }
  if (body?.status !== undefined && !status) {
    return NextResponse.json({ message: "Invalid status." }, { status: 400 });
  }
  if (minimumStockLevel !== undefined && (minimumStockLevel === null || minimumStockLevel < 0)) {
    return NextResponse.json({ message: "minimumStockLevel must be >= 0." }, { status: 400 });
  }
  if (unitCost !== undefined && (unitCost === null || unitCost < 0)) {
    return NextResponse.json({ message: "unitCost must be >= 0." }, { status: 400 });
  }

  const supplierId = body?.supplierId !== undefined ? nullableFilter(body.supplierId) : undefined;
  const locationId = body?.locationId !== undefined ? nullableFilter(body.locationId) : undefined;
  const compatibleRigId = body?.compatibleRigId !== undefined ? nullableFilter(body.compatibleRigId) : undefined;

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
      return NextResponse.json({ message: "Rig not found." }, { status: 404 });
    }
  }

  const nextSku = typeof body?.sku === "string" ? body.sku.trim().toUpperCase() : undefined;
  if (nextSku && nextSku !== existing.sku) {
    const skuConflict = await prisma.inventoryItem.findUnique({
      where: { sku: nextSku },
      select: { id: true }
    });
    if (skuConflict) {
      return NextResponse.json({ message: "Another item already uses this SKU." }, { status: 409 });
    }
  }

  const updated = await prisma.$transaction(async (tx) => {
    const next = await tx.inventoryItem.update({
      where: { id: itemId },
      data: {
        name: typeof body?.name === "string" ? body.name.trim() : undefined,
        sku: nextSku,
        category: category || undefined,
        description: typeof body?.description === "string" ? body.description.trim() : undefined,
        minimumStockLevel: minimumStockLevel ?? undefined,
        unitCost: unitCost ?? undefined,
        supplierId,
        locationId,
        compatibleRigId,
        compatibleRigType:
          typeof body?.compatibleRigType === "string"
            ? body.compatibleRigType.trim()
            : body?.compatibleRigType === null
              ? null
              : undefined,
        partNumber:
          typeof body?.partNumber === "string"
            ? body.partNumber.trim()
            : body?.partNumber === null
              ? null
              : undefined,
        status: status || undefined,
        notes: typeof body?.notes === "string" ? body.notes.trim() : body?.notes === null ? null : undefined
      },
      include: itemInclude
    });

    await recordAuditLog({
      db: tx,
      module: "inventory",
      entityType: "inventory_item",
      entityId: next.id,
      action: "edit",
      description: `${auth.session.name} updated Inventory Item ${next.name}.`,
      before: {
        id: existing.id,
        name: existing.name,
        sku: existing.sku,
        category: existing.category,
        minimumStockLevel: existing.minimumStockLevel,
        unitCost: existing.unitCost,
        status: existing.status
      },
      after: {
        id: next.id,
        name: next.name,
        sku: next.sku,
        category: next.category,
        minimumStockLevel: next.minimumStockLevel,
        unitCost: next.unitCost,
        status: next.status
      },
      actor: auditActorFromSession(auth.session)
    });

    return next;
  });

  return NextResponse.json({
    data: {
      ...updated,
      inventoryValue: roundCurrency(updated.quantityInStock * updated.unitCost),
      lowStock: updated.quantityInStock > 0 && updated.quantityInStock <= updated.minimumStockLevel,
      outOfStock: updated.quantityInStock <= 0
    }
  });
}
