import { NextResponse, type NextRequest } from "next/server";

import { requireApiPermission } from "@/lib/auth/api-guard";
import { auditActorFromSession, recordAuditLog } from "@/lib/audit";
import { roundCurrency } from "@/lib/inventory-server";
import { prisma } from "@/lib/prisma";
import {
  buildRequisitionCode,
  parseLiveProjectSpendType,
  parsePurchaseRequisitionPayload,
  parseRequisitionStatus,
  parseRequisitionType,
  PURCHASE_REQUISITION_REPORT_TYPE,
  type LiveProjectSpendType,
  type PurchaseRequisitionPayload,
  type PurchaseRequisitionLineItem,
  type RequisitionStatus,
  type RequisitionType
} from "@/lib/requisition-workflow";

export const runtime = "nodejs";

interface RequisitionRowOutput {
  id: string;
  requisitionCode: string;
  type: RequisitionType;
  status: RequisitionStatus;
  liveProjectSpendType: LiveProjectSpendType | null;
  category: string;
  subcategory: string | null;
  requestedVendorName: string | null;
  notes: string | null;
  submittedAt: string;
  submittedBy: {
    userId: string;
    name: string;
    role: string;
  };
  context: {
    clientId: string | null;
    projectId: string | null;
    rigId: string | null;
    maintenanceRequestId: string | null;
  };
  lineItems: PurchaseRequisitionLineItem[];
  totals: {
    estimatedTotalCost: number;
    approvedTotalCost: number;
    actualPostedCost: number;
  };
  approval: {
    approvedAt: string | null;
    approvedBy: {
      userId: string;
      name: string;
      role: string;
    } | null;
    rejectedAt: string | null;
    rejectedBy: {
      userId: string;
      name: string;
      role: string;
    } | null;
    rejectionReason: string | null;
    lineItemMode: "FULL_ONLY";
  };
  purchase: {
    receiptSubmissionId: string | null;
    receiptNumber: string | null;
    supplierName: string | null;
    expenseId: string | null;
    movementCount: number;
    postedAt: string | null;
  };
  reportDate: string;
  createdAt: string;
  updatedAt: string;
}

export async function GET(request: NextRequest) {
  const auth = await requireApiPermission(request, "expenses:manual");
  if (!auth.ok) {
    return auth.response;
  }

  const from = parseDateOrNull(request.nextUrl.searchParams.get("from"), false);
  const to = parseDateOrNull(request.nextUrl.searchParams.get("to"), true);
  const projectId = normalizeNullableId(request.nextUrl.searchParams.get("projectId"));
  const clientId = normalizeNullableId(request.nextUrl.searchParams.get("clientId"));
  const rigId = normalizeNullableId(request.nextUrl.searchParams.get("rigId"));
  const type = parseRequisitionType(request.nextUrl.searchParams.get("type"));
  const status = parseRequisitionStatus(request.nextUrl.searchParams.get("status"));

  const requisitionRows = await prisma.summaryReport.findMany({
    where: {
      reportType: PURCHASE_REQUISITION_REPORT_TYPE,
      ...(projectId ? { projectId } : {}),
      ...(clientId ? { clientId } : {}),
      ...(from || to
        ? {
            reportDate: {
              ...(from ? { gte: from } : {}),
              ...(to ? { lte: to } : {})
            }
          }
        : {})
    },
    orderBy: [{ reportDate: "desc" }, { createdAt: "desc" }]
  });

  const parsed = requisitionRows
    .map((row) => {
      const parsedPayload = parsePurchaseRequisitionPayload(row.payloadJson);
      if (!parsedPayload) {
        return null;
      }
      return {
        row,
        payload: parsedPayload.payload
      };
    })
    .filter((entry): entry is { row: (typeof requisitionRows)[number]; payload: PurchaseRequisitionPayload } =>
      Boolean(entry)
    )
    .filter((entry) => {
      if (type && entry.payload.type !== type) {
        return false;
      }
      if (status && entry.payload.status !== status) {
        return false;
      }
      if (rigId && entry.payload.context.rigId !== rigId) {
        return false;
      }
      return true;
    })
    .map((entry) => serializeRequisitionRow(entry.row, entry.payload));

  return NextResponse.json({
    data: parsed,
    meta: {
      count: parsed.length,
      filters: {
        from: from ? from.toISOString() : null,
        to: to ? to.toISOString() : null,
        clientId: clientId || "all",
        projectId: projectId || "all",
        rigId: rigId || "all",
        type: type || "all",
        status: status || "all"
      }
    }
  });
}

export async function POST(request: NextRequest) {
  const auth = await requireApiPermission(request, "expenses:manual");
  if (!auth.ok) {
    return auth.response;
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const type = parseRequisitionType(body?.type);
  if (!type) {
    return NextResponse.json(
      {
        message:
          "Requisition type is required (LIVE_PROJECT_PURCHASE, INVENTORY_STOCK_UP, MAINTENANCE_PURCHASE)."
      },
      { status: 400 }
    );
  }

  const category = normalizeText(body?.category);
  if (!category) {
    return NextResponse.json({ message: "Category is required." }, { status: 400 });
  }
  const liveProjectSpendType = parseLiveProjectSpendType(body?.liveProjectSpendType);

  const lineItems = normalizeLineItems(body?.lineItems);
  if (lineItems.length === 0) {
    return NextResponse.json(
      { message: "Add at least one valid requisition line item." },
      { status: 400 }
    );
  }

  const providedContext = {
    clientId: normalizeNullableId(body?.clientId),
    projectId: normalizeNullableId(body?.projectId),
    rigId: normalizeNullableId(body?.rigId),
    maintenanceRequestId: normalizeNullableId(body?.maintenanceRequestId)
  };

  const [project, rig, maintenanceRequest] = await Promise.all([
    providedContext.projectId
      ? prisma.project.findUnique({
          where: { id: providedContext.projectId },
          select: { id: true, clientId: true }
        })
      : Promise.resolve(null),
    providedContext.rigId
      ? prisma.rig.findUnique({
          where: { id: providedContext.rigId },
          select: { id: true }
        })
      : Promise.resolve(null),
    providedContext.maintenanceRequestId
      ? prisma.maintenanceRequest.findUnique({
          where: { id: providedContext.maintenanceRequestId },
          select: { id: true, rigId: true, projectId: true, clientId: true }
        })
      : Promise.resolve(null)
  ]);

  if (providedContext.projectId && !project) {
    return NextResponse.json({ message: "Selected project was not found." }, { status: 404 });
  }
  if (providedContext.rigId && !rig) {
    return NextResponse.json({ message: "Selected rig was not found." }, { status: 404 });
  }
  if (providedContext.maintenanceRequestId && !maintenanceRequest) {
    return NextResponse.json(
      { message: "Selected maintenance request was not found." },
      { status: 404 }
    );
  }

  let clientId = providedContext.clientId;
  let projectId = providedContext.projectId;
  let rigId = providedContext.rigId;
  let maintenanceRequestId = providedContext.maintenanceRequestId;

  if (project) {
    if (clientId && clientId !== project.clientId) {
      return NextResponse.json(
        { message: "Selected project does not belong to the selected client." },
        { status: 400 }
      );
    }
    clientId = project.clientId;
    projectId = project.id;
  }

  if (maintenanceRequest) {
    if (rigId && rigId !== maintenanceRequest.rigId) {
      return NextResponse.json(
        {
          message:
            "Selected maintenance request does not match the selected rig."
        },
        { status: 400 }
      );
    }
    if (projectId && maintenanceRequest.projectId && projectId !== maintenanceRequest.projectId) {
      return NextResponse.json(
        {
          message:
            "Selected maintenance request does not match the selected project."
        },
        { status: 400 }
      );
    }
    rigId = maintenanceRequest.rigId;
    projectId = projectId || maintenanceRequest.projectId || null;
    clientId = clientId || maintenanceRequest.clientId || clientId;
    maintenanceRequestId = maintenanceRequest.id;
  }

  if (type === "LIVE_PROJECT_PURCHASE" && !projectId) {
    return NextResponse.json(
      { message: "Live project purchases require a project." },
      { status: 400 }
    );
  }
  if (type === "LIVE_PROJECT_PURCHASE" && !liveProjectSpendType) {
    return NextResponse.json(
      {
        message:
          "Live project purchases require selecting whether this is a breakdown or normal expense."
      },
      { status: 400 }
    );
  }
  if (type === "MAINTENANCE_PURCHASE" && !rigId) {
    return NextResponse.json(
      { message: "Maintenance purchases require a rig." },
      { status: 400 }
    );
  }
  if (type === "INVENTORY_STOCK_UP" && projectId) {
    return NextResponse.json(
      {
        message:
          "Inventory stock-up requisitions should not be linked directly to a live project."
      },
      { status: 400 }
    );
  }

  const estimatedTotalCost = roundCurrency(
    lineItems.reduce((sum, line) => sum + line.estimatedTotalCost, 0)
  );
  const submittedAt = new Date();
  const payload = {
    schemaVersion: 1 as const,
    requisitionCode: buildRequisitionCode(submittedAt),
    type,
    status: "SUBMITTED" as const,
    liveProjectSpendType: type === "LIVE_PROJECT_PURCHASE" ? liveProjectSpendType : null,
    category,
    subcategory: normalizeNullableText(body?.subcategory),
    requestedVendorName: normalizeNullableText(body?.requestedVendorName),
    notes: normalizeNullableText(body?.notes),
    submittedAt: submittedAt.toISOString(),
    submittedBy: {
      userId: auth.session.userId,
      name: auth.session.name,
      role: auth.session.role
    },
    approval: {
      approvedAt: null,
      approvedBy: null,
      rejectedAt: null,
      rejectedBy: null,
      rejectionReason: null,
      lineItemMode: "FULL_ONLY" as const
    },
    context: {
      clientId,
      projectId,
      rigId,
      maintenanceRequestId
    },
    lineItems,
    totals: {
      estimatedTotalCost,
      approvedTotalCost: estimatedTotalCost,
      actualPostedCost: 0
    },
    purchase: {
      receiptSubmissionId: null,
      receiptNumber: null,
      supplierName: null,
      expenseId: null,
      movementCount: 0,
      postedAt: null
    }
  };

  const created = await prisma.$transaction(async (tx) => {
    const createdRow = await tx.summaryReport.create({
      data: {
        reportType: PURCHASE_REQUISITION_REPORT_TYPE,
        reportDate: submittedAt,
        clientId,
        projectId,
        payloadJson: JSON.stringify(payload),
        generatedById: auth.session.userId
      }
    });

    await recordAuditLog({
      db: tx,
      module: "expenses",
      entityType: "purchase_requisition",
      entityId: createdRow.id,
      action: "submit",
      description: `${auth.session.name} submitted purchase requisition ${payload.requisitionCode}.`,
      after: {
        requisitionCode: payload.requisitionCode,
        type: payload.type,
        status: payload.status,
        estimatedTotalCost: payload.totals.estimatedTotalCost,
        projectId: payload.context.projectId,
        rigId: payload.context.rigId
      },
      actor: auditActorFromSession(auth.session)
    });

    return createdRow;
  });

  return NextResponse.json(
    {
      data: serializeRequisitionRow(created, payload)
    },
    { status: 201 }
  );
}

function serializeRequisitionRow(
  row: {
    id: string;
    reportDate: Date;
    createdAt: Date;
    updatedAt: Date;
  },
  payload: PurchaseRequisitionPayload
): RequisitionRowOutput {
  return {
    id: row.id,
    requisitionCode: payload.requisitionCode,
    type: payload.type,
    status: payload.status,
    liveProjectSpendType: payload.liveProjectSpendType,
    category: payload.category,
    subcategory: payload.subcategory,
    requestedVendorName: payload.requestedVendorName,
    notes: payload.notes,
    submittedAt: payload.submittedAt,
    submittedBy: payload.submittedBy,
    context: payload.context,
    lineItems: payload.lineItems,
    totals: payload.totals,
    approval: payload.approval,
    purchase: payload.purchase,
    reportDate: row.reportDate.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

function normalizeLineItems(value: unknown): PurchaseRequisitionLineItem[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((line, index) => {
      const row = asRecord(line);
      if (!row) {
        return null;
      }
      const description = normalizeText(row.description);
      const quantity = parsePositiveNumber(row.quantity);
      const estimatedUnitCost = parseNonNegativeNumber(row.estimatedUnitCost);
      const estimatedTotalCostRaw = parseNonNegativeNumber(row.estimatedTotalCost);
      if (!description || !quantity || estimatedUnitCost === null) {
        return null;
      }
      const estimatedTotalCost =
        estimatedTotalCostRaw !== null && estimatedTotalCostRaw > 0
          ? roundCurrency(estimatedTotalCostRaw)
          : roundCurrency(quantity * estimatedUnitCost);

      return {
        id: normalizeText(row.id) || `line-${index + 1}`,
        description,
        quantity: roundCurrency(quantity),
        estimatedUnitCost: roundCurrency(estimatedUnitCost),
        estimatedTotalCost,
        notes: normalizeNullableText(row.notes)
      };
    })
    .filter((line): line is PurchaseRequisitionLineItem => Boolean(line));
}

function parseDateOrNull(value: string | null, endOfDay: boolean) {
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

function normalizeNullableId(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  if (!normalized || normalized === "all") {
    return null;
  }
  return normalized;
}

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeNullableText(value: unknown) {
  const normalized = normalizeText(value);
  return normalized.length > 0 ? normalized : null;
}

function parsePositiveNumber(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}

function parseNonNegativeNumber(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }
  return parsed;
}

function asRecord(value: unknown) {
  if (!value || typeof value !== "object") {
    return null;
  }
  return value as Record<string, unknown>;
}
