import type { MaintenanceStatus, Prisma, UserRole } from "@prisma/client";
import { NextResponse, type NextRequest } from "next/server";

import { requireApiPermission } from "@/lib/auth/api-guard";
import type { AuthSession } from "@/lib/auth/session-types";
import { auditActorFromSession, recordAuditLog } from "@/lib/audit";
import { withFinancialExpenseApproval } from "@/lib/financial-approval-policy";
import { prisma } from "@/lib/prisma";

type LinkageType = "RIG" | "PROJECT" | "MAINTENANCE";
type SourceRecordType = "EXPENSE" | "INVENTORY_MOVEMENT";

interface MissingLinkageRow {
  id: string;
  sourceRecordType: SourceRecordType;
  linkageType: LinkageType;
  recordId: string;
  reference: string;
  date: string;
  amount: number;
  currentContext: string;
  recommendedAction: string;
  clientId: string | null;
  projectId: string | null;
  rigId: string | null;
  maintenanceRequestId: string | null;
}

const LINKAGE_AUDIT_MODULE = "data_quality_linkage";
const LINKAGE_AUDIT_ACTIONS = ["link_rig", "link_project", "link_maintenance"] as const;
const ACTIVE_MAINTENANCE_STATUSES: MaintenanceStatus[] = [
  "OPEN",
  "IN_REPAIR",
  "WAITING_FOR_PARTS",
  "COMPLETED"
];

export async function GET(request: NextRequest) {
  const auth = await requireApiPermission(request, "finance:view");
  if (!auth.ok) {
    return auth.response;
  }

  const clientId = nullableFilter(request.nextUrl.searchParams.get("clientId"));
  const rigId = nullableFilter(request.nextUrl.searchParams.get("rigId"));
  const fromDate = parseDateOrNull(request.nextUrl.searchParams.get("from"));
  const toDate = parseDateOrNull(request.nextUrl.searchParams.get("to"), true);

  const expenseDateFilter: Prisma.DateTimeFilter | undefined = fromDate || toDate
    ? {
        ...(fromDate ? { gte: fromDate } : {}),
        ...(toDate ? { lte: toDate } : {})
      }
    : undefined;

  const approvedExpenseWhereBase = withFinancialExpenseApproval({
    ...(clientId ? { clientId } : {}),
    ...(expenseDateFilter ? { date: expenseDateFilter } : {})
  });

  const [missingRigExpenses, missingProjectExpenses, missingMaintenanceMovements, rigs, projects, maintenanceRequests, fixedToday] =
    await Promise.all([
      prisma.expense.findMany({
        where: {
          ...approvedExpenseWhereBase,
          rigId: null
        },
        include: {
          client: { select: { id: true, name: true } },
          project: { select: { id: true, name: true } }
        },
        orderBy: [{ date: "desc" }, { createdAt: "desc" }],
        take: 250
      }),
      prisma.expense.findMany({
        where: {
          ...approvedExpenseWhereBase,
          projectId: null,
          ...(rigId ? { rigId } : {})
        },
        include: {
          client: { select: { id: true, name: true } },
          rig: { select: { id: true, rigCode: true } }
        },
        orderBy: [{ date: "desc" }, { createdAt: "desc" }],
        take: 250
      }),
      prisma.inventoryMovement.findMany({
        where: {
          movementType: "OUT",
          maintenanceRequestId: null,
          breakdownReportId: null,
          expenseId: { not: null },
          ...(rigId ? { rigId } : {}),
          ...(fromDate || toDate
            ? {
                date: {
                  ...(fromDate ? { gte: fromDate } : {}),
                  ...(toDate ? { lte: toDate } : {})
                }
              }
            : {}),
          expense: withFinancialExpenseApproval({
            ...(clientId ? { clientId } : {})
          })
        },
        include: {
          item: { select: { id: true, name: true, sku: true } },
          client: { select: { id: true, name: true } },
          project: { select: { id: true, name: true } },
          rig: { select: { id: true, rigCode: true } },
          expense: {
            select: {
              id: true,
              date: true,
              amount: true,
              category: true,
              subcategory: true,
              notes: true,
              approvalStatus: true
            }
          }
        },
        orderBy: [{ date: "desc" }, { createdAt: "desc" }],
        take: 250
      }),
      prisma.rig.findMany({
        select: {
          id: true,
          rigCode: true,
          status: true
        },
        orderBy: { rigCode: "asc" }
      }),
      prisma.project.findMany({
        where: {
          ...(clientId ? { clientId } : {}),
          ...(rigId ? { assignedRigId: rigId } : {})
        },
        select: {
          id: true,
          name: true,
          status: true,
          clientId: true,
          client: { select: { id: true, name: true } }
        },
        orderBy: [{ name: "asc" }]
      }),
      prisma.maintenanceRequest.findMany({
        where: {
          status: { in: ACTIVE_MAINTENANCE_STATUSES },
          ...(clientId ? { clientId } : {}),
          ...(rigId ? { rigId } : {})
        },
        select: {
          id: true,
          requestCode: true,
          status: true,
          requestDate: true,
          client: { select: { id: true, name: true } },
          project: { select: { id: true, name: true } },
          rig: { select: { id: true, rigCode: true } }
        },
        orderBy: [{ requestDate: "desc" }],
        take: 300
      }),
      prisma.auditLog.count({
        where: {
          module: LINKAGE_AUDIT_MODULE,
          action: { in: [...LINKAGE_AUDIT_ACTIONS] },
          createdAt: {
            gte: startOfUtcDay(new Date()),
            lte: endOfUtcDay(new Date())
          }
        }
      })
    ]);

  const missingRigRows: MissingLinkageRow[] = missingRigExpenses.map((expense) => ({
    id: `rig-${expense.id}`,
    sourceRecordType: "EXPENSE",
    linkageType: "RIG",
    recordId: expense.id,
    reference: expense.receiptNumber?.trim() ? `Receipt ${expense.receiptNumber.trim()}` : `Expense ${expense.id.slice(-8)}`,
    date: expense.date.toISOString(),
    amount: roundCurrency(expense.amount),
    currentContext: `${expense.client?.name || "Unassigned Client"} • ${expense.project?.name || "Unassigned Project"}`,
    recommendedAction: "Assign rig to improve rig-level cost attribution.",
    clientId: expense.clientId,
    projectId: expense.projectId,
    rigId: expense.rigId,
    maintenanceRequestId: null
  }));

  const missingProjectRows: MissingLinkageRow[] = missingProjectExpenses.map((expense) => ({
    id: `project-${expense.id}`,
    sourceRecordType: "EXPENSE",
    linkageType: "PROJECT",
    recordId: expense.id,
    reference: expense.receiptNumber?.trim() ? `Receipt ${expense.receiptNumber.trim()}` : `Expense ${expense.id.slice(-8)}`,
    date: expense.date.toISOString(),
    amount: roundCurrency(expense.amount),
    currentContext: `${expense.client?.name || "Unassigned Client"} • ${expense.rig?.rigCode || "Unassigned Rig"}`,
    recommendedAction: "Assign project so project profitability and budget tracking are accurate.",
    clientId: expense.clientId,
    projectId: expense.projectId,
    rigId: expense.rigId,
    maintenanceRequestId: null
  }));

  const missingMaintenanceRows: MissingLinkageRow[] = missingMaintenanceMovements.map((movement) => ({
    id: `maintenance-${movement.id}`,
    sourceRecordType: "INVENTORY_MOVEMENT",
    linkageType: "MAINTENANCE",
    recordId: movement.id,
    reference: movement.item?.name
      ? `${movement.item.name} (${movement.item.sku || movement.id.slice(-6)})`
      : `Movement ${movement.id.slice(-8)}`,
    date: movement.date.toISOString(),
    amount: roundCurrency(movement.totalCost || movement.expense?.amount || 0),
    currentContext: `${movement.rig?.rigCode || "Unassigned Rig"} • ${movement.project?.name || "Unassigned Project"}`,
    recommendedAction: "Link maintenance request when this stock-out supports a repair or breakdown.",
    clientId: movement.clientId,
    projectId: movement.projectId,
    rigId: movement.rigId,
    maintenanceRequestId: movement.maintenanceRequestId
  }));

  const totalRecognizedCostAffected = sumUniqueAffectedCost({
    missingRigRows,
    missingProjectRows,
    missingMaintenanceRows
  });

  return NextResponse.json({
    filters: {
      clientId: clientId || "all",
      rigId: rigId || "all",
      from: request.nextUrl.searchParams.get("from"),
      to: request.nextUrl.searchParams.get("to")
    },
    summary: {
      missingRigCount: missingRigRows.length,
      missingProjectCount: missingProjectRows.length,
      missingMaintenanceCount: missingMaintenanceRows.length,
      totalRecognizedCostAffected: roundCurrency(totalRecognizedCostAffected),
      fixedToday
    },
    rows: {
      missingRig: missingRigRows,
      missingProject: missingProjectRows,
      missingMaintenance: missingMaintenanceRows
    },
    lookups: {
      rigs: rigs.map((rig) => ({
        id: rig.id,
        name: rig.rigCode,
        status: rig.status
      })),
      projects: projects.map((project) => ({
        id: project.id,
        name: project.name,
        status: project.status,
        clientId: project.clientId,
        clientName: project.client?.name || ""
      })),
      maintenanceRequests: maintenanceRequests.map((request) => ({
        id: request.id,
        requestCode: request.requestCode,
        status: request.status,
        requestDate: request.requestDate.toISOString(),
        clientId: request.client?.id || null,
        clientName: request.client?.name || "",
        projectId: request.project?.id || null,
        projectName: request.project?.name || "",
        rigId: request.rig?.id || null,
        rigCode: request.rig?.rigCode || ""
      }))
    }
  });
}

export async function PATCH(request: NextRequest) {
  const auth = await requireApiPermission(request, "finance:edit");
  if (!auth.ok) {
    return auth.response;
  }

  if (!isManagerOrAdmin(auth.session.role)) {
    return NextResponse.json(
      { message: "Forbidden: only ADMIN and MANAGER can update linkage records." },
      { status: 403 }
    );
  }

  const body = (await request.json().catch(() => null)) as
    | {
        sourceRecordType?: string;
        linkageType?: string;
        recordId?: string;
        targetId?: string;
      }
    | null;

  const sourceRecordType = normalizeSourceRecordType(body?.sourceRecordType || "");
  const linkageType = normalizeLinkageType(body?.linkageType || "");
  const recordId = typeof body?.recordId === "string" ? body.recordId.trim() : "";
  const targetId = typeof body?.targetId === "string" ? body.targetId.trim() : "";

  if (!sourceRecordType || !linkageType || !recordId || !targetId) {
    return NextResponse.json(
      { message: "sourceRecordType, linkageType, recordId, and targetId are required." },
      { status: 400 }
    );
  }

  if (linkageType === "RIG" || linkageType === "PROJECT") {
    if (sourceRecordType !== "EXPENSE") {
      return NextResponse.json({ message: "RIG and PROJECT linkage updates support EXPENSE records only." }, { status: 400 });
    }
    return updateExpenseLinkage({ authSession: auth.session, linkageType, recordId, targetId });
  }

  if (linkageType === "MAINTENANCE") {
    if (sourceRecordType !== "INVENTORY_MOVEMENT") {
      return NextResponse.json(
        { message: "MAINTENANCE linkage updates support INVENTORY_MOVEMENT records only." },
        { status: 400 }
      );
    }
    return updateMovementMaintenanceLinkage({ authSession: auth.session, recordId, targetId });
  }

  return NextResponse.json({ message: "Unsupported linkage update request." }, { status: 400 });
}

async function updateExpenseLinkage({
  authSession,
  linkageType,
  recordId,
  targetId
}: {
  authSession: AuthSession;
  linkageType: "RIG" | "PROJECT";
  recordId: string;
  targetId: string;
}) {
  const expense = await prisma.expense.findUnique({
    where: { id: recordId },
    select: {
      id: true,
      approvalStatus: true,
      rigId: true,
      projectId: true,
      clientId: true,
      amount: true,
      date: true
    }
  });

  if (!expense) {
    return NextResponse.json({ message: "Expense record not found." }, { status: 404 });
  }
  if (expense.approvalStatus !== "APPROVED") {
    return NextResponse.json({ message: "Only approved expenses can be corrected in this workspace." }, { status: 400 });
  }

  if (linkageType === "RIG") {
    const rig = await prisma.rig.findUnique({
      where: { id: targetId },
      select: { id: true, rigCode: true }
    });
    if (!rig) {
      return NextResponse.json({ message: "Selected rig not found." }, { status: 404 });
    }

    const updated = await prisma.$transaction(async (tx) => {
      const row = await tx.expense.update({
        where: { id: recordId },
        data: {
          rigId: rig.id
        },
        select: {
          id: true,
          rigId: true,
          projectId: true,
          clientId: true
        }
      });

      await recordAuditLog({
        db: tx,
        module: LINKAGE_AUDIT_MODULE,
        entityType: "expense",
        entityId: row.id,
        action: "link_rig",
        description: `${authSession.name} linked expense ${row.id} to rig ${rig.rigCode}.`,
        before: expense,
        after: row,
        actor: auditActorFromSession(authSession)
      });

      return row;
    });

    return NextResponse.json({
      success: true,
      message: "Rig linkage updated.",
      data: updated
    });
  }

  const project = await prisma.project.findUnique({
    where: { id: targetId },
    select: {
      id: true,
      name: true,
      clientId: true
    }
  });
  if (!project) {
    return NextResponse.json({ message: "Selected project not found." }, { status: 404 });
  }

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.expense.update({
      where: { id: recordId },
      data: {
        projectId: project.id,
        clientId: project.clientId
      },
      select: {
        id: true,
        rigId: true,
        projectId: true,
        clientId: true
      }
    });

    await recordAuditLog({
      db: tx,
      module: LINKAGE_AUDIT_MODULE,
      entityType: "expense",
      entityId: row.id,
      action: "link_project",
      description: `${authSession.name} linked expense ${row.id} to project ${project.name}.`,
      before: expense,
      after: row,
      actor: auditActorFromSession(authSession)
    });

    return row;
  });

  return NextResponse.json({
    success: true,
    message: "Project linkage updated.",
    data: updated
  });
}

async function updateMovementMaintenanceLinkage({
  authSession,
  recordId,
  targetId
}: {
  authSession: AuthSession;
  recordId: string;
  targetId: string;
}) {
  const movement = await prisma.inventoryMovement.findUnique({
    where: { id: recordId },
    select: {
      id: true,
      movementType: true,
      maintenanceRequestId: true,
      expense: {
        select: {
          id: true,
          approvalStatus: true
        }
      }
    }
  });
  if (!movement) {
    return NextResponse.json({ message: "Inventory movement not found." }, { status: 404 });
  }
  if (movement.movementType !== "OUT") {
    return NextResponse.json({ message: "Only OUT inventory movements can be linked in this workspace." }, { status: 400 });
  }
  if (!movement.expense || movement.expense.approvalStatus !== "APPROVED") {
    return NextResponse.json(
      { message: "Only approved-spend linked inventory movements can be corrected here." },
      { status: 400 }
    );
  }

  const request = await prisma.maintenanceRequest.findUnique({
    where: { id: targetId },
    select: {
      id: true,
      requestCode: true
    }
  });
  if (!request) {
    return NextResponse.json({ message: "Selected maintenance request not found." }, { status: 404 });
  }

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.inventoryMovement.update({
      where: { id: movement.id },
      data: {
        maintenanceRequestId: request.id
      },
      select: {
        id: true,
        maintenanceRequestId: true
      }
    });

    await recordAuditLog({
      db: tx,
      module: LINKAGE_AUDIT_MODULE,
      entityType: "inventory_movement",
      entityId: row.id,
      action: "link_maintenance",
      description: `${authSession.name} linked inventory movement ${row.id} to maintenance request ${request.requestCode}.`,
      before: {
        id: movement.id,
        maintenanceRequestId: movement.maintenanceRequestId
      },
      after: row,
      actor: auditActorFromSession(authSession)
    });

    return row;
  });

  return NextResponse.json({
    success: true,
    message: "Maintenance linkage updated.",
    data: updated
  });
}

function normalizeSourceRecordType(value: string): SourceRecordType | null {
  if (value === "EXPENSE" || value === "INVENTORY_MOVEMENT") {
    return value;
  }
  return null;
}

function normalizeLinkageType(value: string): LinkageType | null {
  if (value === "RIG" || value === "PROJECT" || value === "MAINTENANCE") {
    return value;
  }
  return null;
}

function nullableFilter(value: string | null) {
  return value && value !== "all" ? value : null;
}

function parseDateOrNull(value: string | null, endOfDay = false) {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  if (endOfDay) {
    parsed.setUTCHours(23, 59, 59, 999);
  } else {
    parsed.setUTCHours(0, 0, 0, 0);
  }
  return parsed;
}

function roundCurrency(value: number) {
  return Math.round(value * 100) / 100;
}

function isManagerOrAdmin(role: UserRole) {
  return role === "ADMIN" || role === "MANAGER";
}

function sumUniqueAffectedCost({
  missingRigRows,
  missingProjectRows,
  missingMaintenanceRows
}: {
  missingRigRows: MissingLinkageRow[];
  missingProjectRows: MissingLinkageRow[];
  missingMaintenanceRows: MissingLinkageRow[];
}) {
  const unique = new Map<string, number>();
  for (const row of missingRigRows) {
    unique.set(`expense:${row.recordId}`, row.amount);
  }
  for (const row of missingProjectRows) {
    const key = `expense:${row.recordId}`;
    if (!unique.has(key)) {
      unique.set(key, row.amount);
    }
  }
  for (const row of missingMaintenanceRows) {
    unique.set(`movement:${row.recordId}`, row.amount);
  }
  return Array.from(unique.values()).reduce((sum, value) => sum + value, 0);
}

function startOfUtcDay(date: Date) {
  const next = new Date(date);
  next.setUTCHours(0, 0, 0, 0);
  return next;
}

function endOfUtcDay(date: Date) {
  const next = new Date(date);
  next.setUTCHours(23, 59, 59, 999);
  return next;
}
