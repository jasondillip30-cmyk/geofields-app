import { randomUUID } from "node:crypto";

import type { ApprovalDecision, MaintenanceStatus, Prisma, UrgencyLevel } from "@prisma/client";
import { NextResponse, type NextRequest } from "next/server";

import { requireAnyApiPermission, requireApiPermission } from "@/lib/auth/api-guard";
import { auditActorFromSession, recordAuditLog } from "@/lib/audit";
import { nullableFilter, parseDateOrNull, parseNumeric, resolveExpenseApprovalStatus, roundCurrency } from "@/lib/inventory-server";
import { prisma } from "@/lib/prisma";

type MaintenanceAction = "approve" | "reject";

const maintenanceInclude = {
  rig: { select: { id: true, rigCode: true, status: true } },
  client: { select: { id: true, name: true } },
  project: { select: { id: true, name: true, status: true, clientId: true } },
  mechanic: { select: { id: true, fullName: true, specialization: true } },
  approvals: {
    orderBy: { createdAt: "desc" },
    take: 1,
    include: {
      approver: { select: { id: true, fullName: true } }
    }
  },
  inventoryMovements: {
    where: {
      movementType: "OUT"
    },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    include: {
      item: { select: { id: true, name: true, sku: true } },
      expense: { select: { id: true, amount: true, category: true, approvalStatus: true } }
    }
  }
} satisfies Prisma.MaintenanceRequestInclude;

type MaintenanceWithRelations = Prisma.MaintenanceRequestGetPayload<{ include: typeof maintenanceInclude }>;

interface PartUsageInput {
  itemId: string;
  quantity: number;
  unitCost?: number | null;
  notes?: string | null;
  createExpense?: boolean;
}

class ApiInputError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "ApiInputError";
    this.status = status;
  }
}

export async function GET(request: NextRequest) {
  const auth = await requireAnyApiPermission(request, ["maintenance:view", "inventory:view"]);
  if (!auth.ok) {
    return auth.response;
  }

  const status = parseStatus(request.nextUrl.searchParams.get("status"));
  const clientId = nullableFilter(request.nextUrl.searchParams.get("clientId"));
  const rigId = nullableFilter(request.nextUrl.searchParams.get("rigId"));
  const fromDate = parseDateOrNull(request.nextUrl.searchParams.get("from"));
  const toDate = parseDateOrNull(request.nextUrl.searchParams.get("to"), true);

  const where: Prisma.MaintenanceRequestWhereInput = {
    ...(status ? { status } : {}),
    ...(clientId ? { clientId } : {}),
    ...(rigId ? { rigId } : {}),
    ...(fromDate || toDate
      ? {
          requestDate: {
            ...(fromDate ? { gte: fromDate } : {}),
            ...(toDate ? { lte: toDate } : {})
          }
        }
      : {})
  };

  const rows = await prisma.maintenanceRequest.findMany({
    where,
    include: maintenanceInclude,
    orderBy: [{ requestDate: "desc" }, { createdAt: "desc" }]
  });

  return NextResponse.json({
    data: rows.map((row) => serializeMaintenanceForClient(row)),
    meta: { count: rows.length }
  });
}

export async function POST(request: NextRequest) {
  const auth = await requireApiPermission(request, "maintenance:submit");
  if (!auth.ok) {
    return auth.response;
  }

  const body = await request.json().catch(() => null);
  const rigId = typeof body?.rigId === "string" ? body.rigId : "";
  const projectId = nullableFilter(typeof body?.projectId === "string" ? body.projectId : null);
  const clientId = nullableFilter(typeof body?.clientId === "string" ? body.clientId : null);
  const providedMechanicId = nullableFilter(typeof body?.mechanicId === "string" ? body.mechanicId : null);
  const issueDescription = typeof body?.issueDescription === "string" ? body.issueDescription.trim() : "";
  const urgency = parseUrgency(body?.urgency) || "MEDIUM";
  const notes = nullableString(typeof body?.notes === "string" ? body.notes : "");
  const requestDate = parseDateOrNull(typeof body?.requestDate === "string" ? body.requestDate : null) || new Date();
  const estimatedDowntimeHrs = parseNumeric(body?.estimatedDowntimeHrs ?? body?.estimatedDowntimeHours) ?? 0;
  const materialsNeeded = parseDelimitedValues(body?.materialsNeeded);
  const photoUrls = parseDelimitedValues(body?.photoUrls);
  const partsUsed = parsePartsUsed(body?.partsUsed);

  if (!rigId || !issueDescription) {
    return NextResponse.json(
      { message: "rigId and issueDescription are required." },
      { status: 400 }
    );
  }
  if (estimatedDowntimeHrs < 0) {
    return NextResponse.json(
      { message: "estimatedDowntimeHrs must be >= 0." },
      { status: 400 }
    );
  }

  try {
    const [rig, project, selectedClient, mechanicId] = await Promise.all([
      prisma.rig.findUnique({
        where: { id: rigId },
        select: { id: true, rigCode: true }
      }),
      projectId
        ? prisma.project.findUnique({
            where: { id: projectId },
            select: { id: true, name: true, clientId: true }
          })
        : Promise.resolve(null),
      clientId
        ? prisma.client.findUnique({
            where: { id: clientId },
            select: { id: true }
          })
        : Promise.resolve(null),
      resolveMechanicId({
        providedMechanicId,
        sessionEmail: auth.session.email,
        sessionName: auth.session.name
      })
    ]);

    if (!rig) {
      return NextResponse.json({ message: "Rig not found." }, { status: 404 });
    }
    if (projectId && !project) {
      return NextResponse.json({ message: "Project not found." }, { status: 404 });
    }
    if (clientId && !selectedClient) {
      return NextResponse.json({ message: "Client not found." }, { status: 404 });
    }
    if (!mechanicId) {
      return NextResponse.json(
        { message: "No mechanic profile found. Add a mechanic record before submitting." },
        { status: 409 }
      );
    }

    const resolvedClientId = project?.clientId || clientId || null;
    if (clientId && project?.clientId && clientId !== project.clientId) {
      return NextResponse.json(
        { message: "Selected project does not belong to the selected client." },
        { status: 400 }
      );
    }

    const created = await prisma.$transaction(async (tx) => {
      const createdRequest = await tx.maintenanceRequest.create({
        data: {
          requestCode: buildRequestCode(),
          requestDate,
          rigId: rig.id,
          clientId: resolvedClientId,
          projectId,
          mechanicId,
          issueDescription,
          materialsNeeded: JSON.stringify(materialsNeeded),
          urgency,
          photoUrls: JSON.stringify(photoUrls),
          notes,
          estimatedDowntimeHrs: roundCurrency(estimatedDowntimeHrs),
          status: "SUBMITTED"
        },
        include: maintenanceInclude
      });

      if (partsUsed.length > 0) {
        for (const part of partsUsed) {
          const item = await tx.inventoryItem.findUnique({
            where: { id: part.itemId },
            select: {
              id: true,
              name: true,
              sku: true,
              category: true,
              quantityInStock: true,
              unitCost: true
            }
          });

          if (!item) {
            throw new ApiInputError(`Inventory item not found: ${part.itemId}`, 404);
          }

          const nextStock = roundCurrency(item.quantityInStock - part.quantity);
          if (nextStock < 0) {
            throw new ApiInputError(
              `Insufficient stock for ${item.name}. Current stock: ${item.quantityInStock}, requested: ${part.quantity}.`,
              409
            );
          }

          const unitCost = part.unitCost !== null && part.unitCost !== undefined ? part.unitCost : item.unitCost;
          const totalCost = roundCurrency(part.quantity * Math.max(0, unitCost || 0));

          let createdExpenseId: string | null = null;
          if (part.createExpense !== false) {
            const expenseApprovalStatus = resolveExpenseApprovalStatus({
              role: auth.session.role,
              linkedMaintenanceStatus: createdRequest.status
            });
            const submittedAt = expenseApprovalStatus === "DRAFT" ? null : new Date();
            const approvedAt = expenseApprovalStatus === "APPROVED" ? new Date() : null;
            const approvedById = expenseApprovalStatus === "APPROVED" ? auth.session.userId : null;

            const expense = await tx.expense.create({
              data: {
                date: requestDate,
                amount: totalCost,
                category: "Spare Parts",
                subcategory: item.name,
                entrySource: "INVENTORY",
                notes: part.notes || `Maintenance parts usage for ${createdRequest.requestCode}`,
                enteredByUserId: auth.session.userId,
                submittedAt,
                approvedAt,
                approvedById,
                approvalStatus: expenseApprovalStatus,
                clientId: resolvedClientId,
                projectId,
                rigId: rig.id
              }
            });
            createdExpenseId = expense.id;
          }

          await tx.inventoryMovement.create({
            data: {
              itemId: item.id,
              movementType: "OUT",
              quantity: roundCurrency(part.quantity),
              unitCost: roundCurrency(unitCost || 0),
              totalCost,
              date: requestDate,
              performedByUserId: auth.session.userId,
              clientId: resolvedClientId,
              projectId,
              rigId: rig.id,
              maintenanceRequestId: createdRequest.id,
              expenseId: createdExpenseId,
              notes: part.notes || `Parts usage for ${createdRequest.requestCode}`
            }
          });

          await tx.inventoryItem.update({
            where: { id: item.id },
            data: {
              quantityInStock: nextStock
            }
          });
        }
      }

      await recordAuditLog({
        db: tx,
        module: "maintenance",
        entityType: "maintenance_request",
        entityId: createdRequest.id,
        action: "create",
        description: `${auth.session.name} created Maintenance Request ${createdRequest.requestCode}.`,
        after: maintenanceAuditSnapshot(createdRequest),
        actor: auditActorFromSession(auth.session)
      });

      return createdRequest;
    });

    return NextResponse.json(
      {
        message: "Maintenance request submitted.",
        data: serializeMaintenanceForClient(created)
      },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof ApiInputError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    console.error("[maintenance][create][error]", {
      message: error instanceof Error ? error.message : "Unknown error"
    });
    return NextResponse.json({ message: "Failed to submit maintenance request." }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  const auth = await requireApiPermission(request, "maintenance:approve");
  if (!auth.ok) {
    return auth.response;
  }

  const payload = await request.json().catch(() => null);
  const requestId = typeof payload?.requestId === "string" ? payload.requestId : "";
  const action = parseAction(payload?.action);
  const comment = typeof payload?.comment === "string" ? payload.comment.trim() : "";

  if (!requestId || !action) {
    return NextResponse.json(
      { message: "requestId and action (approve/reject) are required." },
      { status: 400 }
    );
  }

  if (action === "reject" && comment.length < 3) {
    return NextResponse.json(
      { message: "Rejection reason is required (minimum 3 characters)." },
      { status: 400 }
    );
  }

  const requestRow = await prisma.maintenanceRequest.findUnique({
    where: { id: requestId },
    include: {
      ...maintenanceInclude,
      inventoryMovements: {
        where: {
          movementType: "OUT",
          expenseId: { not: null }
        },
        select: { expenseId: true }
      }
    }
  });

  if (!requestRow) {
    return NextResponse.json({ message: "Maintenance request not found." }, { status: 404 });
  }

  if (requestRow.status !== "SUBMITTED") {
    return NextResponse.json(
      { message: "Only submitted maintenance requests can be approved or rejected." },
      { status: 409 }
    );
  }

  const nextStatus: MaintenanceStatus = action === "approve" ? "APPROVED" : "DENIED";
  const decision: ApprovalDecision = action === "approve" ? "APPROVED" : "DENIED";
  const linkedExpenseIds = requestRow.inventoryMovements
    .map((movement) => movement.expenseId)
    .filter((expenseId): expenseId is string => Boolean(expenseId));

  const updated = await prisma.$transaction(async (tx) => {
    const updatedRequest = await tx.maintenanceRequest.update({
      where: { id: requestId },
      data: {
        status: nextStatus
      },
      include: maintenanceInclude
    });

    await tx.approval.create({
      data: {
        maintenanceId: requestId,
        approverId: auth.session.userId,
        decision,
        note: comment || null
      }
    });

    await tx.maintenanceUpdate.create({
      data: {
        maintenanceId: requestId,
        actorUserId: auth.session.userId,
        previousStatus: requestRow.status,
        newStatus: nextStatus,
        updateNote:
          comment ||
          (action === "approve"
            ? "Approved through Approvals Hub."
            : "Rejected through Approvals Hub.")
      }
    });

    if (linkedExpenseIds.length > 0) {
      await tx.expense.updateMany({
        where: {
          id: { in: linkedExpenseIds },
          approvalStatus: { in: ["DRAFT", "SUBMITTED", "REJECTED"] }
        },
        data:
          action === "approve"
            ? {
                approvalStatus: "APPROVED",
                approvedAt: new Date(),
                approvedById: auth.session.userId,
                rejectionReason: null
              }
            : {
                approvalStatus: "REJECTED",
                approvedAt: new Date(),
                approvedById: auth.session.userId,
                rejectionReason: comment || "Rejected with maintenance request."
              }
      });
    }

    await recordAuditLog({
      db: tx,
      module: "maintenance",
      entityType: "maintenance_request",
      entityId: requestId,
      action,
      description:
        action === "approve"
          ? `${auth.session.name} approved Maintenance Request ${requestRow.requestCode}.`
          : `${auth.session.name} rejected Maintenance Request ${requestRow.requestCode}.`,
      before: maintenanceAuditSnapshot(requestRow),
      after: maintenanceAuditSnapshot(updatedRequest),
      actor: auditActorFromSession(auth.session)
    });

    return updatedRequest;
  });

  return NextResponse.json({
    message:
      action === "approve"
        ? "Maintenance request approved."
        : "Maintenance request rejected and returned to maintenance workflow.",
    data: serializeMaintenanceForClient(updated)
  });
}

async function resolveMechanicId({
  providedMechanicId,
  sessionEmail,
  sessionName
}: {
  providedMechanicId: string | null;
  sessionEmail: string;
  sessionName: string;
}) {
  if (providedMechanicId) {
    const provided = await prisma.mechanic.findUnique({
      where: { id: providedMechanicId },
      select: { id: true }
    });
    return provided?.id || null;
  }

  const byEmail = await prisma.mechanic.findFirst({
    where: {
      email: sessionEmail
    },
    select: { id: true }
  });
  if (byEmail) {
    return byEmail.id;
  }

  const byName = await prisma.mechanic.findFirst({
    where: {
      fullName: sessionName
    },
    select: { id: true }
  });
  if (byName) {
    return byName.id;
  }

  const first = await prisma.mechanic.findFirst({
    orderBy: [{ fullName: "asc" }],
    select: { id: true }
  });
  return first?.id || null;
}

function parseStatus(value: string | null): MaintenanceStatus | null {
  if (!value || value === "all") {
    return null;
  }
  const normalized = value.toUpperCase();
  if (
    normalized === "SUBMITTED" ||
    normalized === "UNDER_REVIEW" ||
    normalized === "APPROVED" ||
    normalized === "DENIED" ||
    normalized === "WAITING_FOR_PARTS" ||
    normalized === "IN_REPAIR" ||
    normalized === "COMPLETED"
  ) {
    return normalized;
  }
  return null;
}

function parseAction(value: unknown): MaintenanceAction | null {
  if (value === "approve" || value === "reject") {
    return value;
  }
  return null;
}

function parseUrgency(value: unknown): UrgencyLevel | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().toUpperCase();
  if (normalized === "LOW" || normalized === "MEDIUM" || normalized === "HIGH" || normalized === "CRITICAL") {
    return normalized;
  }
  return null;
}

function parseDelimitedValues(value: unknown) {
  if (Array.isArray(value)) {
    return value
      .map((entry) => String(entry || "").trim())
      .filter((entry) => entry.length > 0);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return [];
    }
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed
          .map((entry) => String(entry || "").trim())
          .filter((entry) => entry.length > 0);
      }
    } catch {
      // not JSON array
    }
    return trimmed
      .split(/[\n,]/g)
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
  }
  return [];
}

function parsePartsUsed(value: unknown): PartUsageInput[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const parsed: PartUsageInput[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") {
      continue;
    }

    const itemId = typeof (entry as { itemId?: unknown }).itemId === "string" ? (entry as { itemId: string }).itemId : "";
    const quantity = parseNumeric((entry as { quantity?: unknown }).quantity);
    const unitCost = parseNumeric((entry as { unitCost?: unknown }).unitCost);
    const notes = nullableString(typeof (entry as { notes?: unknown }).notes === "string" ? (entry as { notes: string }).notes : "");
    const createExpenseRaw = (entry as { createExpense?: unknown }).createExpense;

    if (!itemId || quantity === null || quantity <= 0) {
      continue;
    }

    parsed.push({
      itemId,
      quantity: roundCurrency(quantity),
      unitCost: unitCost === null ? null : roundCurrency(unitCost),
      notes,
      createExpense: typeof createExpenseRaw === "boolean" ? createExpenseRaw : true
    });
  }

  return parsed;
}

function nullableString(value: string | null) {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function buildRequestCode() {
  const year = new Date().getUTCFullYear();
  const token = randomUUID().slice(0, 6).toUpperCase();
  return `MR-${year}-${token}`;
}

function deriveIssueType(issueDescription: string) {
  const text = issueDescription.toLowerCase();
  if (text.includes("hydraulic")) {
    return "Hydraulic";
  }
  if (text.includes("compressor")) {
    return "Compressor";
  }
  if (text.includes("elect") || text.includes("can bus") || text.includes("panel")) {
    return "Electrical";
  }
  if (text.includes("engine")) {
    return "Engine";
  }
  return "General";
}

function parseJsonArray(value: string) {
  if (!value) {
    return [];
  }
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return parsed
        .map((entry) => String(entry || "").trim())
        .filter((entry) => entry.length > 0);
    }
  } catch {
    // fallback
  }
  return value
    .split(/[\n,]/g)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function serializeMaintenanceForClient(row: MaintenanceWithRelations) {
  const latestApproval = row.approvals[0] || null;
  const parsedMaterials = parseJsonArray(row.materialsNeeded);
  const parsedPhotos = parseJsonArray(row.photoUrls);
  const partsUsed = row.inventoryMovements.map((movement) => ({
    movementId: movement.id,
    itemId: movement.itemId,
    itemName: movement.item?.name || "Unknown Item",
    sku: movement.item?.sku || "-",
    quantity: movement.quantity,
    unitCost: movement.unitCost || 0,
    totalCost: movement.totalCost || 0,
    expenseId: movement.expense?.id || null,
    expenseStatus: movement.expense?.approvalStatus || null,
    date: movement.date.toISOString()
  }));
  const totalPartsCost = roundCurrency(partsUsed.reduce((sum, part) => sum + (part.totalCost || 0), 0));

  return {
    id: row.id,
    requestCode: row.requestCode,
    date: row.requestDate.toISOString().slice(0, 10),
    requestDate: row.requestDate.toISOString(),
    rigId: row.rigId,
    clientId: row.clientId,
    projectId: row.projectId,
    mechanicId: row.mechanicId,
    issueDescription: row.issueDescription,
    issueType: deriveIssueType(row.issueDescription),
    materialsNeeded: parsedMaterials,
    urgency: row.urgency,
    photos: parsedPhotos,
    notes: row.notes,
    estimatedDowntimeHours: row.estimatedDowntimeHrs,
    status: row.status,
    approvalNotes: latestApproval?.note || null,
    approvedBy: latestApproval?.approver
      ? {
          id: latestApproval.approver.id,
          fullName: latestApproval.approver.fullName
        }
      : null,
    approvedAt: latestApproval?.createdAt || null,
    rig: row.rig
      ? {
          id: row.rig.id,
          rigCode: row.rig.rigCode
        }
      : null,
    client: row.client
      ? {
          id: row.client.id,
          name: row.client.name
        }
      : null,
    project: row.project
      ? {
          id: row.project.id,
          name: row.project.name
        }
      : null,
    mechanic: row.mechanic
      ? {
          id: row.mechanic.id,
          fullName: row.mechanic.fullName,
          specialization: row.mechanic.specialization
        }
      : null,
    partsUsed,
    totalPartsCost,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function maintenanceAuditSnapshot(requestRow: {
  id: string;
  requestCode: string;
  status: MaintenanceStatus;
  requestDate: Date;
  rigId: string;
  clientId: string | null;
  projectId: string | null;
  mechanicId: string;
  issueDescription: string;
  urgency: UrgencyLevel;
  estimatedDowntimeHrs: number;
}) {
  return {
    id: requestRow.id,
    requestCode: requestRow.requestCode,
    status: requestRow.status,
    requestDate: requestRow.requestDate,
    rigId: requestRow.rigId,
    clientId: requestRow.clientId,
    projectId: requestRow.projectId,
    mechanicId: requestRow.mechanicId,
    issueDescription: requestRow.issueDescription,
    urgency: requestRow.urgency,
    estimatedDowntimeHrs: requestRow.estimatedDowntimeHrs
  };
}
