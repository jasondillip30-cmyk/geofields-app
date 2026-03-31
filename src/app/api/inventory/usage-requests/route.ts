import type { InventoryUsageRequestStatus, Prisma } from "@prisma/client";
import { NextResponse, type NextRequest } from "next/server";

import { auditActorFromSession, recordAuditLog } from "@/lib/audit";
import { requireAnyApiPermission, requireApiPermission } from "@/lib/auth/api-guard";
import { canAccess } from "@/lib/auth/permissions";
import { buildDateFilter, nullableFilter, parseDateOrNull, parseNumeric, roundCurrency } from "@/lib/inventory-server";
import { prisma } from "@/lib/prisma";

const requestInclude = {
  item: {
    select: {
      id: true,
      name: true,
      sku: true,
      quantityInStock: true
    }
  },
  project: { select: { id: true, name: true, clientId: true } },
  rig: { select: { id: true, rigCode: true } },
  maintenanceRequest: { select: { id: true, requestCode: true, status: true } },
  location: { select: { id: true, name: true } },
  requestedBy: { select: { id: true, fullName: true, role: true } },
  decidedBy: { select: { id: true, fullName: true, role: true } }
} as const;

export async function GET(request: NextRequest) {
  const auth = await requireAnyApiPermission(request, ["inventory:view", "reports:view"]);
  if (!auth.ok) {
    return auth.response;
  }

  const canManageInventory = canAccess(auth.session.role, "inventory:manage");
  const scopeParam = (request.nextUrl.searchParams.get("scope") || "").toLowerCase();
  const requestedByParam = (request.nextUrl.searchParams.get("requestedBy") || "").toLowerCase();
  const mineOnly = !canManageInventory || scopeParam === "mine" || requestedByParam === "me";

  const fromDate = parseDateOrNull(request.nextUrl.searchParams.get("from"));
  const toDate = parseDateOrNull(request.nextUrl.searchParams.get("to"), true);
  const rigId = nullableFilter(request.nextUrl.searchParams.get("rigId"));
  const clientId = nullableFilter(request.nextUrl.searchParams.get("clientId"));
  const itemId = nullableFilter(request.nextUrl.searchParams.get("itemId"));
  const statusParam = (request.nextUrl.searchParams.get("status") || "").toUpperCase();
  const date = buildDateFilter(fromDate, toDate);

  let statusWhere: Prisma.InventoryUsageRequestWhereInput = {};
  if (
    statusParam === "APPROVED" ||
    statusParam === "REJECTED" ||
    statusParam === "SUBMITTED" ||
    statusParam === "PENDING"
  ) {
    statusWhere = { status: statusParam as InventoryUsageRequestStatus };
  } else if (statusParam !== "ALL" && !mineOnly) {
    statusWhere = { status: { in: ["SUBMITTED", "PENDING"] as const } };
  }

  const where: Prisma.InventoryUsageRequestWhereInput = {
    ...statusWhere,
    ...(mineOnly ? { requestedById: auth.session.userId } : {}),
    ...(rigId ? { rigId } : {}),
    ...(clientId ? { project: { clientId } } : {}),
    ...(itemId ? { itemId } : {}),
    ...(date ? { createdAt: date } : {})
  };

  const rows = await prisma.inventoryUsageRequest.findMany({
    where,
    include: requestInclude,
    orderBy: [{ createdAt: "desc" }]
  });

  return NextResponse.json({ data: rows });
}

export async function POST(request: NextRequest) {
  const auth = await requireApiPermission(request, "inventory:view");
  if (!auth.ok) {
    return auth.response;
  }

  const payload = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!payload) {
    return NextResponse.json({ message: "Invalid request payload." }, { status: 400 });
  }

  const itemId = typeof payload.itemId === "string" ? payload.itemId : "";
  const quantity = parseNumeric(payload.quantity);
  const reason = typeof payload.reason === "string" ? payload.reason.trim() : "";
  const projectId = typeof payload.projectId === "string" && payload.projectId.trim() ? payload.projectId : null;
  const rigId = typeof payload.rigId === "string" && payload.rigId.trim() ? payload.rigId : null;
  const maintenanceRequestId =
    typeof payload.maintenanceRequestId === "string" && payload.maintenanceRequestId.trim()
      ? payload.maintenanceRequestId
      : null;
  const locationId = typeof payload.locationId === "string" && payload.locationId.trim() ? payload.locationId : null;
  const requestedForDateRaw =
    typeof payload.requestedForDate === "string" && payload.requestedForDate.trim() ? payload.requestedForDate : null;
  const requestedForDate = parseDateOrNull(requestedForDateRaw);

  if (!itemId) {
    return NextResponse.json({ message: "Item is required." }, { status: 400 });
  }
  if (quantity === null || quantity <= 0) {
    return NextResponse.json({ message: "Quantity must be greater than zero." }, { status: 400 });
  }
  if (!reason) {
    return NextResponse.json({ message: "Reason is required." }, { status: 400 });
  }
  if (!projectId) {
    return NextResponse.json({ message: "Project is required." }, { status: 400 });
  }
  if (!rigId) {
    return NextResponse.json({ message: "Rig is required." }, { status: 400 });
  }
  if (requestedForDateRaw && !requestedForDate) {
    return NextResponse.json({ message: "Requested date is invalid." }, { status: 400 });
  }

  const [item, project, rig, maintenance, location] = await Promise.all([
    prisma.inventoryItem.findUnique({
      where: { id: itemId },
      select: { id: true, name: true, quantityInStock: true, status: true }
    }),
    projectId ? prisma.project.findUnique({ where: { id: projectId }, select: { id: true } }) : Promise.resolve(null),
    rigId ? prisma.rig.findUnique({ where: { id: rigId }, select: { id: true } }) : Promise.resolve(null),
    maintenanceRequestId
      ? prisma.maintenanceRequest.findUnique({ where: { id: maintenanceRequestId }, select: { id: true } })
      : Promise.resolve(null),
    locationId
      ? prisma.inventoryLocation.findUnique({ where: { id: locationId }, select: { id: true } })
      : Promise.resolve(null)
  ]);

  if (!item) {
    return NextResponse.json({ message: "Inventory item not found." }, { status: 404 });
  }
  if (item.status !== "ACTIVE") {
    return NextResponse.json({ message: "Only active inventory items can be requested." }, { status: 400 });
  }
  if (projectId && !project) {
    return NextResponse.json({ message: "Project not found." }, { status: 404 });
  }
  if (rigId && !rig) {
    return NextResponse.json({ message: "Rig not found." }, { status: 404 });
  }
  if (maintenanceRequestId && !maintenance) {
    return NextResponse.json({ message: "Maintenance request not found." }, { status: 404 });
  }
  if (locationId && !location) {
    return NextResponse.json({ message: "Location not found." }, { status: 404 });
  }

  const created = await prisma.inventoryUsageRequest.create({
    data: {
      itemId: item.id,
      quantity: roundCurrency(quantity),
      reason,
      projectId,
      rigId,
      maintenanceRequestId,
      locationId,
      requestedForDate,
      requestedById: auth.session.userId,
      status: "SUBMITTED"
    },
    include: requestInclude
  });

  await recordAuditLog({
    module: "inventory_usage_requests",
    entityType: "inventory_usage_request",
    entityId: created.id,
    action: "create",
    description: `${auth.session.name} requested ${created.quantity} of ${created.item.name}.`,
    after: {
      itemId: created.itemId,
      quantity: created.quantity,
      reason: created.reason,
      projectId: created.projectId,
      rigId: created.rigId,
      maintenanceRequestId: created.maintenanceRequestId,
      locationId: created.locationId,
      requestedForDate: created.requestedForDate,
      status: created.status
    },
    actor: auditActorFromSession(auth.session)
  });

  return NextResponse.json({ data: created }, { status: 201 });
}
