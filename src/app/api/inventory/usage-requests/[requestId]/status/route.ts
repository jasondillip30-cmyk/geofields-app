import { Prisma } from "@prisma/client";
import { NextResponse, type NextRequest } from "next/server";

import { auditActorFromSession, recordAuditLog } from "@/lib/audit";
import { requireApiPermission } from "@/lib/auth/api-guard";
import { deriveInventoryUsageReasonType } from "@/lib/inventory-usage-context";
import { roundCurrency } from "@/lib/inventory-server";
import { prisma } from "@/lib/prisma";

const includeRequest = {
  item: {
    select: {
      id: true,
      name: true,
      sku: true,
      category: true,
      quantityInStock: true,
      unitCost: true,
      locationId: true
    }
  },
  project: {
    select: {
      id: true,
      clientId: true
    }
  },
  maintenanceRequest: {
    select: {
      id: true,
      requestCode: true,
      status: true,
      breakdownReportId: true
    }
  },
  requestedBy: {
    select: {
      id: true,
      fullName: true
    }
  }
} as const;

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ requestId: string }> }
) {
  const auth = await requireApiPermission(request, "inventory:manage");
  if (!auth.ok) {
    return auth.response;
  }

  const { requestId } = await context.params;
  if (!requestId) {
    return NextResponse.json({ message: "Request ID is required." }, { status: 400 });
  }

  const payload = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const action = typeof payload?.action === "string" ? payload.action.toLowerCase() : "";
  const note = typeof payload?.note === "string" ? payload.note.trim() : "";
  if (action !== "approve" && action !== "reject") {
    return NextResponse.json({ message: "Action must be approve or reject." }, { status: 400 });
  }

  const existing = await prisma.inventoryUsageRequest.findUnique({
    where: { id: requestId },
    include: includeRequest
  });

  if (!existing) {
    return NextResponse.json({ message: "Usage request not found." }, { status: 404 });
  }
  if (existing.status !== "SUBMITTED" && existing.status !== "PENDING") {
    return NextResponse.json({ message: "Only submitted usage requests can be updated." }, { status: 409 });
  }

  if (action === "reject" && note.length < 3) {
    return NextResponse.json({ message: "Rejection reason must be at least 3 characters." }, { status: 400 });
  }

  if (action === "reject") {
    const rejected = await prisma.inventoryUsageRequest.update({
      where: { id: requestId },
      data: {
        status: "REJECTED",
        decisionNote: note || null,
        decidedById: auth.session.userId,
        decidedAt: new Date()
      }
    });

    await recordAuditLog({
      module: "inventory_usage_requests",
      entityType: "inventory_usage_request",
      entityId: rejected.id,
      action: "reject",
      description: `${auth.session.name} rejected usage request ${rejected.id}.`,
      before: { status: existing.status },
      after: { status: rejected.status, decisionNote: rejected.decisionNote },
      actor: auditActorFromSession(auth.session)
    });

    return NextResponse.json({ data: rejected });
  }

  const now = new Date();
  const movementDate = existing.requestedForDate || now;
  const resolvedBreakdownReportId =
    existing.breakdownReportId ||
    existing.maintenanceRequest?.breakdownReportId ||
    null;
  const movementBreakdownReportId =
    resolvedBreakdownReportId || existing.maintenanceRequest?.breakdownReportId || null;
  const noteReason = existing.reason;
  try {
    const result = await prisma.$transaction(async (tx) => {
      const approvalLock = await tx.inventoryUsageRequest.updateMany({
        where: {
          id: existing.id,
          status: { in: ["SUBMITTED", "PENDING"] },
          approvedMovementId: null
        },
        data: {
          status: "APPROVED",
          decisionNote: note || null,
          decidedById: auth.session.userId,
          decidedAt: now,
          breakdownReportId: existing.maintenanceRequestId ? null : resolvedBreakdownReportId
        }
      });

      if (approvalLock.count === 0) {
        throw new Error("UsageRequestAlreadyProcessed");
      }

      const currentItem = await tx.inventoryItem.findUnique({
        where: { id: existing.itemId },
        select: { id: true, quantityInStock: true, unitCost: true, locationId: true }
      });

      if (!currentItem) {
        throw new Error("Inventory item not found.");
      }

      if (currentItem.quantityInStock < existing.quantity) {
        throw new Error("Not enough stock");
      }

      const nextStock = roundCurrency(currentItem.quantityInStock - existing.quantity);
      const unitCost = currentItem.unitCost || 0;
      const totalCost = roundCurrency(existing.quantity * unitCost);
      const reasonType = deriveInventoryUsageReasonType({
        explicitReasonType: null,
        maintenanceRequestId: existing.maintenanceRequestId,
        breakdownReportId: resolvedBreakdownReportId
      });
      const expenseCategory =
        reasonType === "BREAKDOWN"
          ? "Breakdown"
          : reasonType === "MAINTENANCE"
            ? "Maintenance"
            : "Inventory Usage";
      const expense = await tx.expense.create({
        data: {
          date: movementDate,
          amount: totalCost,
          category: expenseCategory,
          subcategory: existing.item.name,
          entrySource: "INVENTORY_USAGE",
          vendor: null,
          notes: `Recognized from approved inventory usage request ${existing.id}${
            noteReason ? `: ${noteReason}` : ""
          }`,
          enteredByUserId: existing.requestedById || auth.session.userId,
          submittedAt: existing.createdAt,
          approvedById: auth.session.userId,
          approvalStatus: "APPROVED",
          approvedAt: now,
          clientId: existing.project?.clientId || null,
          projectId: existing.projectId,
          rigId: existing.rigId,
          quantity: roundCurrency(existing.quantity),
          unitCost
        }
      });

      const movement = await tx.inventoryMovement.create({
        data: {
          itemId: existing.itemId,
          movementType: "OUT",
          quantity: roundCurrency(existing.quantity),
          unitCost,
          totalCost,
          date: movementDate,
          performedByUserId: auth.session.userId,
          clientId: existing.project?.clientId || null,
          projectId: existing.projectId,
          rigId: existing.rigId,
          maintenanceRequestId: existing.maintenanceRequestId,
          breakdownReportId: movementBreakdownReportId,
          expenseId: expense.id,
          locationFromId: existing.locationId || currentItem.locationId || null,
          notes: `Approved usage request ${existing.id}${noteReason ? `: ${noteReason}` : ""}`
        }
      });

      await tx.inventoryItem.update({
        where: { id: existing.itemId },
        data: {
          quantityInStock: nextStock
        }
      });

      const approved = await tx.inventoryUsageRequest.update({
        where: { id: existing.id },
        data: {
          approvedMovementId: movement.id
        }
      });

      await recordAuditLog({
        db: tx,
        module: "inventory_usage_requests",
        entityType: "inventory_usage_request",
        entityId: approved.id,
        action: "approve",
        description: `${auth.session.name} approved usage request ${approved.id}.`,
        before: { status: existing.status, stock: currentItem.quantityInStock },
        after: {
          status: approved.status,
          breakdownReportId: approved.breakdownReportId,
          approvedMovementId: approved.approvedMovementId,
          movementBreakdownReportId,
          recognizedExpenseId: expense.id,
          stock: nextStock
        },
        actor: auditActorFromSession(auth.session)
      });

      return { approved, movementId: movement.id, expenseId: expense.id };
    });

    return NextResponse.json({
      data: result.approved,
      movementId: result.movementId,
      expenseId: result.expenseId
    });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "UsageRequestAlreadyProcessed") {
        return NextResponse.json(
          { message: "Usage request has already been processed." },
          { status: 409 }
        );
      }
      if (error.message === "Not enough stock") {
        return NextResponse.json({ message: "Not enough stock" }, { status: 409 });
      }
      if (error.message === "Inventory item not found.") {
        return NextResponse.json({ message: "Inventory item not found." }, { status: 404 });
      }
    }
    if (isBreakdownLinkageSchemaMismatch(error)) {
      return NextResponse.json(
        {
          message:
            "Database schema is out of sync for inventory movement linkage. Missing breakdown linkage column(s) in the current database.",
          code: "SCHEMA_OUT_OF_SYNC",
          nextStep:
            "Fix DATABASE_URL, then run: npx prisma migrate dev --name inventory_breakdown_linkage_hardening. If local migration state is intentionally reset, run npx prisma db push."
        },
        { status: 500 }
      );
    }
    console.error("[inventory/usage-requests:status]", {
      errorName: error instanceof Error ? error.name : "UnknownError",
      message: error instanceof Error ? error.message : String(error),
      ...(error instanceof Prisma.PrismaClientKnownRequestError
        ? {
            prismaCode: error.code,
            prismaMeta: error.meta || null
          }
        : {})
    });
    return NextResponse.json(
      { message: "Failed to update usage request status." },
      { status: 500 }
    );
  }
}

function isBreakdownLinkageSchemaMismatch(error: unknown) {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2022") {
    const column = `${(error.meta as { column?: unknown } | undefined)?.column || ""}`.toLowerCase();
    if (column.includes("breakdownreportid") || message.includes("breakdownreportid")) {
      return true;
    }
  }
  return (
    message.includes("column") &&
    message.includes("breakdownreportid") &&
    (message.includes("does not exist") || message.includes("unknown"))
  );
}
