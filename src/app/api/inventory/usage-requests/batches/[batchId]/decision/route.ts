import { Prisma } from "@prisma/client";
import { NextResponse, type NextRequest } from "next/server";

import { auditActorFromSession, recordAuditLog } from "@/lib/audit";
import { requireApiPermission } from "@/lib/auth/api-guard";
import {
  deriveInventoryUsageContextType,
  deriveInventoryUsageReasonType
} from "@/lib/inventory-usage-context";
import { roundCurrency } from "@/lib/inventory-server";
import { prisma } from "@/lib/prisma";

import {
  serializeUsageRequestBatchForClient,
  usageRequestBatchInclude
} from "../../shared";

type BatchDecisionAction = "approve" | "reject";

type BatchLineDecision = {
  lineId: string;
  action: BatchDecisionAction;
  note: string;
};

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ batchId: string }> }
) {
  const auth = await requireApiPermission(request, "inventory:manage");
  if (!auth.ok) {
    return auth.response;
  }

  const { batchId } = await context.params;
  if (!batchId) {
    return NextResponse.json({ message: "Batch ID is required." }, { status: 400 });
  }

  const payload = (await request.json().catch(() => null)) as
    | Record<string, unknown>
    | null;
  const rawDecisions = Array.isArray(payload?.decisions)
    ? payload.decisions
    : [];
  if (rawDecisions.length === 0) {
    return NextResponse.json(
      { message: "Provide line decisions before submitting." },
      { status: 400 }
    );
  }

  const decisions: BatchLineDecision[] = [];
  for (const rawEntry of rawDecisions) {
    if (!rawEntry || typeof rawEntry !== "object") {
      return NextResponse.json(
        { message: "Each line decision must include lineId and action." },
        { status: 400 }
      );
    }
    const entry = rawEntry as Record<string, unknown>;
    const lineId = typeof entry.lineId === "string" ? entry.lineId.trim() : "";
    const actionRaw =
      typeof entry.action === "string" ? entry.action.toLowerCase().trim() : "";
    const note = typeof entry.note === "string" ? entry.note.trim() : "";
    if (!lineId || (actionRaw !== "approve" && actionRaw !== "reject")) {
      return NextResponse.json(
        { message: "Each line decision must include lineId and valid action." },
        { status: 400 }
      );
    }
    if (actionRaw === "reject" && note.length < 3) {
      return NextResponse.json(
        {
          message: "Rejected lines require a reason (minimum 3 characters)."
        },
        { status: 400 }
      );
    }
    decisions.push({
      lineId,
      action: actionRaw,
      note
    });
  }

  const existing = await prisma.inventoryUsageRequestBatch.findUnique({
    where: { id: batchId },
    include: usageRequestBatchInclude
  });
  if (!existing) {
    return NextResponse.json({ message: "Usage batch not found." }, { status: 404 });
  }
  if (existing.status !== "SUBMITTED" && existing.status !== "PENDING") {
    return NextResponse.json(
      { message: "Only submitted usage batches can be decided." },
      { status: 409 }
    );
  }
  if (existing.lines.length === 0) {
    return NextResponse.json(
      { message: "This usage batch has no lines to decide." },
      { status: 409 }
    );
  }

  const decisionByLineId = new Map<string, BatchLineDecision>();
  for (const decision of decisions) {
    if (decisionByLineId.has(decision.lineId)) {
      return NextResponse.json(
        { message: "Each line can only have one decision entry." },
        { status: 400 }
      );
    }
    decisionByLineId.set(decision.lineId, decision);
  }
  if (decisionByLineId.size !== existing.lines.length) {
    return NextResponse.json(
      { message: "Every batch line must be decided before submission." },
      { status: 400 }
    );
  }
  for (const line of existing.lines) {
    if (!decisionByLineId.has(line.id)) {
      return NextResponse.json(
        { message: "Every batch line must be decided before submission." },
        { status: 400 }
      );
    }
  }

  const contextType = deriveInventoryUsageContextType({
    explicitContextType: existing.contextType,
    explicitReasonType: null,
    maintenanceRequestId: existing.maintenanceRequestId,
    breakdownReportId:
      existing.breakdownReportId ||
      existing.maintenanceRequest?.breakdownReportId ||
      null,
    drillReportId: existing.drillReportId
  });
  const reasonType = deriveInventoryUsageReasonType({
    explicitReasonType: existing.contextType,
    maintenanceRequestId: existing.maintenanceRequestId,
    breakdownReportId:
      existing.breakdownReportId ||
      existing.maintenanceRequest?.breakdownReportId ||
      null,
    drillReportId: existing.drillReportId
  });

  const stockDeficits: Array<{
    lineId: string;
    itemId: string;
    itemName: string;
    requestedQuantity: number;
    stockOnHand: number;
  }> = [];
  if (contextType !== "DRILLING_REPORT") {
    for (const line of existing.lines) {
      const decision = decisionByLineId.get(line.id);
      if (!decision || decision.action !== "approve") {
        continue;
      }
      if (line.item.status !== "ACTIVE") {
        return NextResponse.json(
          {
            message: `Cannot approve inactive item "${line.item.name}".`
          },
          { status: 409 }
        );
      }
      if (line.item.quantityInStock < line.quantity) {
        stockDeficits.push({
          lineId: line.id,
          itemId: line.item.id,
          itemName: line.item.name,
          requestedQuantity: line.quantity,
          stockOnHand: line.item.quantityInStock
        });
      }
    }
  }
  if (stockDeficits.length > 0) {
    return NextResponse.json(
      {
        message: "Cannot approve selected lines: not enough stock available.",
        deficits: stockDeficits
      },
      { status: 409 }
    );
  }

  const now = new Date();
  const movementDate = existing.requestedForDate || now;
  const breakdownReportIdResolved =
    existing.breakdownReportId ||
    existing.maintenanceRequest?.breakdownReportId ||
    null;
  const expenseCategory =
    reasonType === "BREAKDOWN"
      ? "Breakdown"
      : reasonType === "MAINTENANCE"
        ? "Maintenance"
        : "Inventory Usage";

  try {
    const decided = await prisma.$transaction(async (tx) => {
      const lock = await tx.inventoryUsageRequestBatch.updateMany({
        where: {
          id: existing.id,
          status: { in: ["SUBMITTED", "PENDING"] }
        },
        data: {
          status: "PENDING"
        }
      });
      if (lock.count === 0) {
        throw new Error("UsageBatchAlreadyProcessed");
      }

      let approvedCount = 0;
      let rejectedCount = 0;

      for (const line of existing.lines) {
        const lineDecision = decisionByLineId.get(line.id);
        if (!lineDecision) {
          throw new Error("MissingLineDecision");
        }

        if (lineDecision.action === "reject") {
          rejectedCount += 1;
          await tx.inventoryUsageRequestBatchLine.update({
            where: { id: line.id },
            data: {
              status: "REJECTED",
              decisionNote: lineDecision.note,
              approvedMovementId: null
            }
          });
          continue;
        }

        approvedCount += 1;
        if (contextType === "DRILLING_REPORT") {
          await tx.inventoryUsageRequestBatchLine.update({
            where: { id: line.id },
            data: {
              status: "APPROVED",
              decisionNote: lineDecision.note || null,
              approvedMovementId: null
            }
          });
          continue;
        }

        const currentItem = await tx.inventoryItem.findUnique({
          where: { id: line.itemId },
          select: {
            id: true,
            name: true,
            quantityInStock: true,
            unitCost: true,
            locationId: true
          }
        });
        if (!currentItem) {
          throw new Error(`Inventory item not found for line ${line.id}.`);
        }
        if (currentItem.quantityInStock < line.quantity) {
          throw new Error(`Not enough stock for ${currentItem.name}.`);
        }

        const unitCost = currentItem.unitCost || 0;
        const totalCost = roundCurrency(line.quantity * unitCost);
        const nextStock = roundCurrency(currentItem.quantityInStock - line.quantity);
        const baseReason = existing.reason?.trim() || "Batch item usage";
        const lineReason = `${baseReason} • line ${line.id.slice(-6).toUpperCase()}`;

        const expense = await tx.expense.create({
          data: {
            date: movementDate,
            amount: totalCost,
            category: expenseCategory,
            subcategory: currentItem.name,
            entrySource: "INVENTORY_USAGE",
            vendor: null,
            notes: `Recognized from approved inventory usage batch ${existing.id}${lineDecision.note ? `: ${lineDecision.note}` : ""}`,
            enteredByUserId: existing.requestedById || auth.session.userId,
            submittedAt: existing.createdAt,
            approvedById: auth.session.userId,
            approvalStatus: "APPROVED",
            approvedAt: now,
            clientId: existing.project?.clientId || null,
            projectId: existing.projectId,
            rigId: existing.rigId,
            quantity: roundCurrency(line.quantity),
            unitCost
          }
        });

        const movement = await tx.inventoryMovement.create({
          data: {
            itemId: line.itemId,
            movementType: "OUT",
            contextType,
            quantity: roundCurrency(line.quantity),
            unitCost,
            totalCost,
            date: movementDate,
            performedByUserId: auth.session.userId,
            clientId: existing.project?.clientId || null,
            projectId: existing.projectId,
            rigId: existing.rigId,
            drillReportId: existing.drillReportId,
            maintenanceRequestId: existing.maintenanceRequestId,
            breakdownReportId: breakdownReportIdResolved,
            expenseId: expense.id,
            locationFromId: existing.locationId || currentItem.locationId || null,
            notes: `Approved usage batch ${existing.id}: ${lineReason}`
          }
        });

        await tx.inventoryItem.update({
          where: { id: line.itemId },
          data: {
            quantityInStock: nextStock
          }
        });

        await tx.inventoryUsageRequestBatchLine.update({
          where: { id: line.id },
          data: {
            status: "APPROVED",
            decisionNote: lineDecision.note || null,
            approvedMovementId: movement.id
          }
        });
      }

      const finalStatus =
        approvedCount > 0 && rejectedCount > 0
          ? "PARTIALLY_APPROVED"
          : approvedCount > 0
            ? "APPROVED"
            : "REJECTED";
      const updatedBatch = await tx.inventoryUsageRequestBatch.update({
        where: { id: existing.id },
        data: {
          status: finalStatus,
          decidedById: auth.session.userId,
          decidedAt: now
        },
        include: usageRequestBatchInclude
      });

      await recordAuditLog({
        db: tx,
        module: "inventory_usage_request_batches",
        entityType: "inventory_usage_request_batch",
        entityId: updatedBatch.id,
        action: "decide",
        description: `${auth.session.name} decided inventory usage batch ${updatedBatch.id}.`,
        before: {
          status: existing.status
        },
        after: {
          status: updatedBatch.status,
          approvedLines: approvedCount,
          rejectedLines: rejectedCount,
          decidedAt: updatedBatch.decidedAt
        },
        actor: auditActorFromSession(auth.session)
      });

      return updatedBatch;
    });

    return NextResponse.json({
      data: serializeUsageRequestBatchForClient(decided)
    });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "UsageBatchAlreadyProcessed") {
        return NextResponse.json(
          { message: "Usage batch has already been processed." },
          { status: 409 }
        );
      }
      if (error.message === "MissingLineDecision") {
        return NextResponse.json(
          { message: "Every batch line must be decided before submission." },
          { status: 400 }
        );
      }
      if (error.message.toLowerCase().includes("not enough stock")) {
        return NextResponse.json(
          { message: error.message },
          { status: 409 }
        );
      }
    }
    console.error("[inventory/usage-requests/batches:decision]", {
      errorName: error instanceof Error ? error.name : "UnknownError",
      message: error instanceof Error ? error.message : String(error),
      ...(error instanceof Prisma.PrismaClientKnownRequestError
        ? {
            prismaCode: error.code,
            prismaMeta: error.meta || null
          }
        : {})
    });

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
      { message: "Failed to submit usage batch decision." },
      { status: 500 }
    );
  }
}
