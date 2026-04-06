import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

import type { Prisma } from "@prisma/client";
import { NextResponse, type NextRequest } from "next/server";

import { requireApiPermission } from "@/lib/auth/api-guard";
import { auditActorFromSession, recordAuditLog } from "@/lib/audit";
import {
  buildDateFilter,
  nullableFilter,
  parseDateOrNull,
  parseMovementType,
  parseNumeric,
  resolveExpenseApprovalStatus,
  resolveExpenseCategoryFromInventoryCategory,
  roundCurrency
} from "@/lib/inventory-server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

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
  breakdownReport: { select: { id: true, title: true, status: true, severity: true } },
  expense: { select: { id: true, amount: true, category: true, approvalStatus: true } },
  supplier: { select: { id: true, name: true } },
  locationFrom: { select: { id: true, name: true } },
  locationTo: { select: { id: true, name: true } }
} as const;

interface ParsedMovementInput {
  itemId: string;
  movementType: "IN" | "OUT" | "ADJUSTMENT" | "TRANSFER";
  quantity: number;
  unitCost: number | null;
  totalCost: number | null;
  date: Date;
  notes: string | null;
  rigId: string | null;
  projectId: string | null;
  clientId: string | null;
  maintenanceRequestId: string | null;
  breakdownReportId: string | null;
  expenseId: string | null;
  supplierId: string | null;
  locationFromId: string | null;
  locationToId: string | null;
  traReceiptNumber: string | null;
  supplierInvoiceNumber: string | null;
  receiptUrl: string | null;
  receiptFileName: string | null;
  createExpense: boolean;
  allowNegativeStock: boolean;
}

export async function GET(request: NextRequest) {
  const auth = await requireApiPermission(request, "inventory:view");
  if (!auth.ok) {
    return auth.response;
  }

  const fromDate = parseDateOrNull(request.nextUrl.searchParams.get("from"));
  const toDate = parseDateOrNull(request.nextUrl.searchParams.get("to"), true);
  const itemId = nullableFilter(request.nextUrl.searchParams.get("itemId"));
  const movementType = parseMovementType(request.nextUrl.searchParams.get("movementType"));
  const rigId = nullableFilter(request.nextUrl.searchParams.get("rigId"));
  const projectId = nullableFilter(request.nextUrl.searchParams.get("projectId"));
  const clientId = nullableFilter(request.nextUrl.searchParams.get("clientId"));
  const maintenanceRequestId = nullableFilter(request.nextUrl.searchParams.get("maintenanceRequestId"));
  const breakdownReportId = nullableFilter(request.nextUrl.searchParams.get("breakdownReportId"));
  const supplierId = nullableFilter(request.nextUrl.searchParams.get("supplierId"));
  const date = buildDateFilter(fromDate, toDate);

  const where: Prisma.InventoryMovementWhereInput = {
    ...(itemId ? { itemId } : {}),
    ...(movementType ? { movementType } : {}),
    ...(rigId ? { rigId } : {}),
    ...(projectId ? { projectId } : {}),
    ...(clientId ? { clientId } : {}),
    ...(maintenanceRequestId ? { maintenanceRequestId } : {}),
    ...(breakdownReportId ? { breakdownReportId } : {}),
    ...(supplierId ? { supplierId } : {}),
    ...(date ? { date } : {})
  };

  const movements = await prisma.inventoryMovement.findMany({
    where,
    include: movementInclude,
    orderBy: [{ date: "desc" }, { createdAt: "desc" }]
  });

  const totals = movements.reduce(
    (acc, movement) => {
      if (movement.movementType === "IN") {
        acc.in += movement.quantity;
      } else if (movement.movementType === "OUT") {
        acc.out += movement.quantity;
      } else if (movement.movementType === "ADJUSTMENT") {
        acc.adjustment += movement.quantity;
      } else {
        acc.transfer += movement.quantity;
      }
      acc.totalCost += movement.totalCost || 0;
      return acc;
    },
    { in: 0, out: 0, adjustment: 0, transfer: 0, totalCost: 0 }
  );

  return NextResponse.json({
    data: movements,
    meta: {
      count: movements.length,
      totals: {
        in: roundCurrency(totals.in),
        out: roundCurrency(totals.out),
        adjustment: roundCurrency(totals.adjustment),
        transfer: roundCurrency(totals.transfer),
        totalCost: roundCurrency(totals.totalCost)
      }
    }
  });
}

export async function POST(request: NextRequest) {
  const auth = await requireApiPermission(request, "inventory:manage");
  if (!auth.ok) {
    return auth.response;
  }

  const parsed = await parseMovementInput(request);
  if (!parsed.ok) {
    return parsed.response;
  }
  const input = parsed.value;

  const [item, project, rig, maintenanceRequest, breakdownReport, expense, supplier, locationFrom, locationTo] =
    await Promise.all([
    prisma.inventoryItem.findUnique({
      where: { id: input.itemId },
      select: {
        id: true,
        name: true,
        sku: true,
        category: true,
        quantityInStock: true,
        minimumStockLevel: true,
        unitCost: true,
        locationId: true
      }
    }),
    input.projectId
      ? prisma.project.findUnique({
          where: { id: input.projectId },
          select: { id: true, clientId: true, name: true }
        })
      : Promise.resolve(null),
    input.rigId
      ? prisma.rig.findUnique({
          where: { id: input.rigId },
          select: { id: true, rigCode: true }
        })
      : Promise.resolve(null),
    input.maintenanceRequestId
      ? prisma.maintenanceRequest.findUnique({
          where: { id: input.maintenanceRequestId },
          select: { id: true, requestCode: true, status: true, breakdownReportId: true }
        })
      : Promise.resolve(null),
    input.breakdownReportId
      ? prisma.breakdownReport.findUnique({
          where: { id: input.breakdownReportId },
          select: { id: true, rigId: true, projectId: true }
        })
      : Promise.resolve(null),
    input.expenseId
      ? prisma.expense.findUnique({
          where: { id: input.expenseId },
          select: { id: true }
        })
      : Promise.resolve(null),
    input.supplierId
      ? prisma.inventorySupplier.findUnique({
          where: { id: input.supplierId },
          select: { id: true, name: true }
        })
      : Promise.resolve(null),
    input.locationFromId
      ? prisma.inventoryLocation.findUnique({
          where: { id: input.locationFromId },
          select: { id: true, name: true }
        })
      : Promise.resolve(null),
    input.locationToId
      ? prisma.inventoryLocation.findUnique({
          where: { id: input.locationToId },
          select: { id: true, name: true }
        })
      : Promise.resolve(null)
  ]);

  if (!item) {
    return NextResponse.json({ message: "Inventory item not found." }, { status: 404 });
  }
  if (input.projectId && !project) {
    return NextResponse.json({ message: "Project not found." }, { status: 404 });
  }
  if (input.rigId && !rig) {
    return NextResponse.json({ message: "Rig not found." }, { status: 404 });
  }
  if (input.maintenanceRequestId && !maintenanceRequest) {
    return NextResponse.json({ message: "Maintenance request not found." }, { status: 404 });
  }
  if (input.breakdownReportId && !breakdownReport) {
    return NextResponse.json({ message: "Breakdown report not found." }, { status: 404 });
  }
  if (input.expenseId && !expense) {
    return NextResponse.json({ message: "Linked expense not found." }, { status: 404 });
  }
  if (input.supplierId && !supplier) {
    return NextResponse.json({ message: "Supplier not found." }, { status: 404 });
  }
  if (input.locationFromId && !locationFrom) {
    return NextResponse.json({ message: "From location not found." }, { status: 404 });
  }
  if (input.locationToId && !locationTo) {
    return NextResponse.json({ message: "To location not found." }, { status: 404 });
  }
  if (
    input.breakdownReportId &&
    maintenanceRequest?.breakdownReportId &&
    maintenanceRequest.breakdownReportId !== input.breakdownReportId
  ) {
    return NextResponse.json(
      {
        message:
          "Selected maintenance request is linked to a different breakdown. Align maintenance and breakdown linkage before recording movement."
      },
      { status: 400 }
    );
  }
  if (input.breakdownReportId && breakdownReport && input.projectId && breakdownReport.projectId !== input.projectId) {
    return NextResponse.json(
      {
        message: "Selected breakdown does not belong to the selected project."
      },
      { status: 400 }
    );
  }
  if (input.breakdownReportId && breakdownReport && input.rigId && breakdownReport.rigId !== input.rigId) {
    return NextResponse.json(
      {
        message: "Selected breakdown does not belong to the selected rig."
      },
      { status: 400 }
    );
  }

  let resolvedClientId = input.clientId;
  if (project?.clientId) {
    resolvedClientId = project.clientId;
  }
  if (input.clientId && project?.clientId && input.clientId !== project.clientId) {
    return NextResponse.json(
      { message: "Selected project does not belong to the selected client." },
      { status: 400 }
    );
  }

  const deltaQuantity = resolveDeltaQuantity(input.movementType, input.quantity);
  const nextStock = roundCurrency(item.quantityInStock + deltaQuantity);
  if (nextStock < 0 && !(input.allowNegativeStock && auth.session.role === "ADMIN")) {
    return NextResponse.json(
      {
        message: `Stock cannot go negative. Current stock: ${item.quantityInStock}, requested change: ${deltaQuantity}.`
      },
      { status: 409 }
    );
  }

  const effectiveUnitCost = input.unitCost ?? item.unitCost;
  const resolvedBreakdownReportId =
    input.breakdownReportId || maintenanceRequest?.breakdownReportId || null;
  const totalCost =
    input.totalCost !== null
      ? roundCurrency(input.totalCost)
      : roundCurrency(Math.abs(input.quantity) * Math.max(0, effectiveUnitCost || 0));

  const nextLocationId =
    input.movementType === "TRANSFER"
      ? input.locationToId || item.locationId
      : input.movementType === "IN"
        ? input.locationToId || item.locationId
        : item.locationId;

  const result = await prisma.$transaction(async (tx) => {
    let createdExpenseId = input.expenseId;
    if (!createdExpenseId && input.createExpense) {
      const expenseApprovalStatus = resolveExpenseApprovalStatus({
        role: auth.session.role,
        linkedMaintenanceStatus: maintenanceRequest?.status || null
      });
      const submittedAt = expenseApprovalStatus === "DRAFT" ? null : new Date();
      const approvedAt = expenseApprovalStatus === "APPROVED" ? new Date() : null;
      const approvedById = expenseApprovalStatus === "APPROVED" ? auth.session.userId : null;
      const expense = await tx.expense.create({
        data: {
          date: input.date,
          amount: totalCost,
          category: resolveExpenseCategoryFromInventoryCategory(item.category),
          subcategory: item.name,
          entrySource: "INVENTORY",
          vendor: supplier?.name || null,
          notes: input.notes || `Inventory movement ${input.movementType} for ${item.name}`,
          receiptUrl: input.receiptUrl,
          receiptFileName: input.receiptFileName,
          enteredByUserId: auth.session.userId,
          submittedAt,
          approvedById,
          approvalStatus: expenseApprovalStatus,
          approvedAt,
          clientId: resolvedClientId,
          projectId: input.projectId,
          rigId: input.rigId
        }
      });
      createdExpenseId = expense.id;
    }

    const createdMovement = await tx.inventoryMovement.create({
      data: {
        itemId: item.id,
        movementType: input.movementType,
        quantity: roundCurrency(input.quantity),
        unitCost: effectiveUnitCost,
        totalCost,
        date: input.date,
        performedByUserId: auth.session.userId,
        clientId: resolvedClientId,
        rigId: input.rigId,
        projectId: input.projectId,
        maintenanceRequestId: input.maintenanceRequestId,
        breakdownReportId: resolvedBreakdownReportId,
        expenseId: createdExpenseId,
        supplierId: input.supplierId,
        locationFromId: input.locationFromId,
        locationToId: input.locationToId,
        traReceiptNumber: input.traReceiptNumber,
        supplierInvoiceNumber: input.supplierInvoiceNumber,
        receiptUrl: input.receiptUrl,
        receiptFileName: input.receiptFileName,
        notes: input.notes
      },
      include: movementInclude
    });

    await tx.inventoryItem.update({
      where: { id: item.id },
      data: {
        quantityInStock: nextStock,
        unitCost: input.movementType === "IN" && input.unitCost !== null ? input.unitCost : undefined,
        locationId: nextLocationId
      }
    });

    await recordAuditLog({
      db: tx,
      module: "inventory",
      entityType: "inventory_movement",
      entityId: createdMovement.id,
      action: "create",
      description: `${auth.session.name} recorded ${input.movementType} movement for ${item.name}.`,
      after: {
        movementId: createdMovement.id,
        itemId: item.id,
        movementType: input.movementType,
        quantity: input.quantity,
        maintenanceRequestId: input.maintenanceRequestId,
        breakdownReportId: resolvedBreakdownReportId,
        totalCost,
        previousStock: item.quantityInStock,
        nextStock
      },
      actor: auditActorFromSession(auth.session)
    });

    return createdMovement;
  });

  return NextResponse.json(
    {
      data: result,
      meta: {
        previousStock: item.quantityInStock,
        nextStock
      }
    },
    { status: 201 }
  );
}

async function parseMovementInput(request: NextRequest) {
  const contentType = request.headers.get("content-type") || "";

  if (contentType.includes("multipart/form-data")) {
    const formData = await request.formData();
    const savedReceipt = formData.get("receipt") instanceof File ? await saveReceiptFile(formData.get("receipt") as File) : null;

    const movementType = parseMovementType(asString(formData.get("movementType")));
    const quantity = parseNumeric(asString(formData.get("quantity")));
    const date = parseDateOrNull(asString(formData.get("date"))) || new Date();
    const unitCost = nullableNumber(asString(formData.get("unitCost")));
    const totalCost = nullableNumber(asString(formData.get("totalCost")));
    const itemId = asString(formData.get("itemId"));

    const validationError = validateMovementInput({
      itemId,
      movementType,
      quantity
    });
    if (validationError) {
      return {
        ok: false as const,
        response: NextResponse.json({ message: validationError }, { status: 400 })
      };
    }

    return {
      ok: true as const,
      value: {
        itemId,
        movementType: movementType as ParsedMovementInput["movementType"],
        quantity: quantity as number,
        unitCost,
        totalCost,
        date,
        notes: nullableString(asString(formData.get("notes"))),
        rigId: nullableString(asString(formData.get("rigId"))),
        projectId: nullableString(asString(formData.get("projectId"))),
        clientId: nullableString(asString(formData.get("clientId"))),
        maintenanceRequestId: nullableString(asString(formData.get("maintenanceRequestId"))),
        breakdownReportId: nullableString(asString(formData.get("breakdownReportId"))),
        expenseId: nullableString(asString(formData.get("expenseId"))),
        supplierId: nullableString(asString(formData.get("supplierId"))),
        locationFromId: nullableString(asString(formData.get("locationFromId"))),
        locationToId: nullableString(asString(formData.get("locationToId"))),
        traReceiptNumber: nullableString(asString(formData.get("traReceiptNumber"))),
        supplierInvoiceNumber: nullableString(asString(formData.get("supplierInvoiceNumber"))),
        receiptUrl: savedReceipt?.receiptUrl || nullableString(asString(formData.get("receiptUrl"))),
        receiptFileName: savedReceipt?.receiptFileName || null,
        createExpense: parseBoolean(asString(formData.get("createExpense"))),
        allowNegativeStock: parseBoolean(asString(formData.get("allowNegativeStock")))
      }
    };
  }

  const body = await request.json().catch(() => null);
  const movementType = parseMovementType(body?.movementType);
  const quantity = parseNumeric(body?.quantity);
  const itemId = typeof body?.itemId === "string" ? body.itemId.trim() : "";
  const validationError = validateMovementInput({
    itemId,
    movementType,
    quantity
  });
  if (validationError) {
    return {
      ok: false as const,
      response: NextResponse.json({ message: validationError }, { status: 400 })
    };
  }

  const date = parseDateOrNull(typeof body?.date === "string" ? body.date : null) || new Date();
  const unitCost = body?.unitCost === undefined || body?.unitCost === null ? null : parseNumeric(body.unitCost);
  const totalCost = body?.totalCost === undefined || body?.totalCost === null ? null : parseNumeric(body.totalCost);

  return {
    ok: true as const,
    value: {
      itemId,
      movementType: movementType as ParsedMovementInput["movementType"],
      quantity: quantity as number,
      unitCost,
      totalCost,
      date,
      notes: typeof body?.notes === "string" ? body.notes.trim() : null,
      rigId: nullableString(typeof body?.rigId === "string" ? body.rigId : ""),
      projectId: nullableString(typeof body?.projectId === "string" ? body.projectId : ""),
      clientId: nullableString(typeof body?.clientId === "string" ? body.clientId : ""),
      maintenanceRequestId: nullableString(
        typeof body?.maintenanceRequestId === "string" ? body.maintenanceRequestId : ""
      ),
      breakdownReportId: nullableString(
        typeof body?.breakdownReportId === "string" ? body.breakdownReportId : ""
      ),
      expenseId: nullableString(typeof body?.expenseId === "string" ? body.expenseId : ""),
      supplierId: nullableString(typeof body?.supplierId === "string" ? body.supplierId : ""),
      locationFromId: nullableString(typeof body?.locationFromId === "string" ? body.locationFromId : ""),
      locationToId: nullableString(typeof body?.locationToId === "string" ? body.locationToId : ""),
      traReceiptNumber: nullableString(typeof body?.traReceiptNumber === "string" ? body.traReceiptNumber : ""),
      supplierInvoiceNumber: nullableString(
        typeof body?.supplierInvoiceNumber === "string" ? body.supplierInvoiceNumber : ""
      ),
      receiptUrl: nullableString(typeof body?.receiptUrl === "string" ? body.receiptUrl : ""),
      receiptFileName: null,
      createExpense: Boolean(body?.createExpense),
      allowNegativeStock: Boolean(body?.allowNegativeStock)
    }
  };
}

function validateMovementInput({
  itemId,
  movementType,
  quantity
}: {
  itemId: string;
  movementType: ReturnType<typeof parseMovementType>;
  quantity: number | null;
}) {
  if (!itemId || !movementType || quantity === null) {
    return "itemId, movementType, and numeric quantity are required.";
  }
  if ((movementType === "IN" || movementType === "OUT" || movementType === "TRANSFER") && quantity <= 0) {
    return "quantity must be greater than 0 for IN/OUT/TRANSFER movements.";
  }
  if (movementType === "ADJUSTMENT" && quantity === 0) {
    return "quantity cannot be 0 for ADJUSTMENT movement.";
  }
  return null;
}

function resolveDeltaQuantity(
  movementType: ParsedMovementInput["movementType"],
  quantity: number
) {
  if (movementType === "IN") {
    return quantity;
  }
  if (movementType === "OUT") {
    return -quantity;
  }
  if (movementType === "ADJUSTMENT") {
    return quantity;
  }
  return 0;
}

function parseBoolean(value: string) {
  const normalized = value.trim().toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "on";
}

function asString(value: FormDataEntryValue | null) {
  return typeof value === "string" ? value.trim() : "";
}

function nullableString(value: string) {
  return value ? value : null;
}

function nullableNumber(value: string) {
  if (!value) {
    return null;
  }
  const parsed = parseNumeric(value);
  if (parsed === null) {
    return null;
  }
  return parsed;
}

async function saveReceiptFile(receipt: File) {
  if (receipt.size <= 0) {
    return null;
  }

  const uploadsDir = path.join(process.cwd(), "public", "uploads", "inventory-receipts");
  await mkdir(uploadsDir, { recursive: true });
  const extension = receipt.name.includes(".") ? receipt.name.split(".").pop() : "bin";
  const safeFileName = `${Date.now()}-${randomUUID()}.${extension}`;
  const absoluteFilePath = path.join(uploadsDir, safeFileName);
  const arrayBuffer = await receipt.arrayBuffer();
  await writeFile(absoluteFilePath, Buffer.from(arrayBuffer));

  return {
    receiptUrl: `/uploads/inventory-receipts/${safeFileName}`,
    receiptFileName: receipt.name
  };
}
