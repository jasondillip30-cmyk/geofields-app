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
import {
  buildDefaultRequisitionSetupPayload,
  normalizeMasterDataKey,
  parsePurchaseRequisitionSetupPayload,
  PURCHASE_REQUISITION_SETUP_REPORT_TYPE
} from "@/lib/requisition-master-data";

export const runtime = "nodejs";

interface RequisitionRowOutput {
  id: string;
  requisitionCode: string;
  type: RequisitionType;
  status: RequisitionStatus;
  liveProjectSpendType: LiveProjectSpendType | null;
  category: string;
  subcategory: string | null;
  categoryId: string | null;
  subcategoryId: string | null;
  requestedVendorId: string | null;
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
    breakdownReportId: string | null;
  };
  contextLabels: {
    clientName: string | null;
    projectName: string | null;
    rigCode: string | null;
    maintenanceRequestCode: string | null;
    breakdownTitle: string | null;
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
  const maintenanceRequestId = normalizeNullableId(
    request.nextUrl.searchParams.get("maintenanceRequestId")
  );
  const breakdownReportId = normalizeNullableId(
    request.nextUrl.searchParams.get("breakdownReportId")
  );
  const type = parseRequisitionType(request.nextUrl.searchParams.get("type"));
  const status = parseRequisitionStatus(request.nextUrl.searchParams.get("status"));
  const isProjectScoped = Boolean(projectId);

  const requisitionRows = await prisma.summaryReport.findMany({
    where: {
      reportType: PURCHASE_REQUISITION_REPORT_TYPE,
      ...(projectId ? { projectId } : {}),
      ...(!isProjectScoped && clientId ? { clientId } : {})
    },
    orderBy: [{ reportDate: "desc" }, { createdAt: "desc" }]
  });

  const parsedEntries = requisitionRows
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
      if (!isProjectScoped && rigId && entry.payload.context.rigId !== rigId) {
        return false;
      }
      if (
        maintenanceRequestId &&
        entry.payload.context.maintenanceRequestId !== maintenanceRequestId
      ) {
        return false;
      }
      if (
        breakdownReportId &&
        entry.payload.context.breakdownReportId !== breakdownReportId
      ) {
        return false;
      }
      const submittedAt = parseIsoTimestamp(entry.payload.submittedAt);
      if (from && (!submittedAt || submittedAt < from)) {
        return false;
      }
      if (to && (!submittedAt || submittedAt > to)) {
        return false;
      }
      return true;
    })
    .sort((a, b) => {
      const aTimestamp = getRequisitionSortTimestamp(a);
      const bTimestamp = getRequisitionSortTimestamp(b);
      return bTimestamp - aTimestamp;
    });

  const clientIds = Array.from(
    new Set(
      parsedEntries
        .map((entry) => entry.payload.context.clientId)
        .filter((value): value is string => Boolean(value))
    )
  );
  const projectIds = Array.from(
    new Set(
      parsedEntries
        .map((entry) => entry.payload.context.projectId)
        .filter((value): value is string => Boolean(value))
    )
  );
  const rigIds = Array.from(
    new Set(
      parsedEntries
        .map((entry) => entry.payload.context.rigId)
        .filter((value): value is string => Boolean(value))
    )
  );
  const maintenanceRequestIds = Array.from(
    new Set(
      parsedEntries
        .map((entry) => entry.payload.context.maintenanceRequestId)
        .filter((value): value is string => Boolean(value))
    )
  );
  const breakdownReportIds = Array.from(
    new Set(
      parsedEntries
        .map((entry) => entry.payload.context.breakdownReportId)
        .filter((value): value is string => Boolean(value))
    )
  );

  const [clients, projects, rigs, maintenanceRequests, breakdownReports] = await Promise.all([
    clientIds.length > 0
      ? prisma.client.findMany({
          where: { id: { in: clientIds } },
          select: { id: true, name: true }
        })
      : Promise.resolve([]),
    projectIds.length > 0
      ? prisma.project.findMany({
          where: { id: { in: projectIds } },
          select: { id: true, name: true }
        })
      : Promise.resolve([]),
    rigIds.length > 0
      ? prisma.rig.findMany({
          where: { id: { in: rigIds } },
          select: { id: true, rigCode: true }
        })
      : Promise.resolve([]),
    maintenanceRequestIds.length > 0
      ? prisma.maintenanceRequest.findMany({
          where: { id: { in: maintenanceRequestIds } },
          select: { id: true, requestCode: true }
        })
      : Promise.resolve([]),
    breakdownReportIds.length > 0
      ? prisma.breakdownReport.findMany({
          where: { id: { in: breakdownReportIds } },
          select: { id: true, title: true }
        })
      : Promise.resolve([])
  ]);

  const clientNameById = new Map(clients.map((entry) => [entry.id, entry.name]));
  const projectNameById = new Map(projects.map((entry) => [entry.id, entry.name]));
  const rigCodeById = new Map(rigs.map((entry) => [entry.id, entry.rigCode]));
  const maintenanceCodeById = new Map(
    maintenanceRequests.map((entry) => [entry.id, entry.requestCode])
  );
  const breakdownTitleById = new Map(
    breakdownReports.map((entry) => [entry.id, entry.title])
  );

  const parsed = parsedEntries.map((entry) =>
    serializeRequisitionRow(entry.row, entry.payload, {
      clientName:
        entry.payload.context.clientId && clientNameById.has(entry.payload.context.clientId)
          ? clientNameById.get(entry.payload.context.clientId) || null
          : null,
      projectName:
        entry.payload.context.projectId && projectNameById.has(entry.payload.context.projectId)
          ? projectNameById.get(entry.payload.context.projectId) || null
          : null,
      rigCode:
        entry.payload.context.rigId && rigCodeById.has(entry.payload.context.rigId)
          ? rigCodeById.get(entry.payload.context.rigId) || null
          : null,
      maintenanceRequestCode:
        entry.payload.context.maintenanceRequestId &&
        maintenanceCodeById.has(entry.payload.context.maintenanceRequestId)
          ? maintenanceCodeById.get(entry.payload.context.maintenanceRequestId) || null
          : null,
      breakdownTitle:
        entry.payload.context.breakdownReportId &&
        breakdownTitleById.has(entry.payload.context.breakdownReportId)
          ? breakdownTitleById.get(entry.payload.context.breakdownReportId) || null
          : null
    })
  );

  return NextResponse.json({
    data: parsed,
    meta: {
      count: parsed.length,
      filters: {
        from: from ? from.toISOString() : null,
        to: to ? to.toISOString() : null,
        clientId: isProjectScoped ? "all" : clientId || "all",
        projectId: projectId || "all",
        rigId: isProjectScoped ? "all" : rigId || "all",
        maintenanceRequestId: maintenanceRequestId || "all",
        breakdownReportId: breakdownReportId || "all",
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

  const categoryInput = normalizeText(body?.category);
  const subcategoryInput = normalizeNullableText(body?.subcategory);
  const categoryIdInput = normalizeNullableId(body?.categoryId);
  const subcategoryIdInput = normalizeNullableId(body?.subcategoryId);
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
    maintenanceRequestId: normalizeNullableId(body?.maintenanceRequestId),
    breakdownReportId: normalizeNullableId(body?.breakdownReportId)
  };
  const requestedVendorIdInput = normalizeNullableId(body?.requestedVendorId);
  const requestedVendorNameInput = normalizeNullableText(body?.requestedVendorName);

  if (type !== "MAINTENANCE_PURCHASE" && providedContext.maintenanceRequestId) {
    return NextResponse.json(
      {
        message: "Only maintenance-linked purchases can be linked to a maintenance case."
      },
      { status: 400 }
    );
  }
  if (type === "INVENTORY_STOCK_UP" && providedContext.breakdownReportId) {
    return NextResponse.json(
      {
        message: "Inventory stock-up requisitions cannot be linked to a breakdown report."
      },
      { status: 400 }
    );
  }

  const [project, rig, maintenanceRequest, breakdownReport] = await Promise.all([
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
          select: {
            id: true,
            requestCode: true,
            status: true,
            rigId: true,
            projectId: true,
            clientId: true
          }
        })
      : Promise.resolve(null),
    providedContext.breakdownReportId
      ? prisma.breakdownReport.findUnique({
          where: { id: providedContext.breakdownReportId },
          select: { id: true, rigId: true, projectId: true, clientId: true, title: true }
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
  if (providedContext.breakdownReportId && !breakdownReport) {
    return NextResponse.json(
      { message: "Selected breakdown report was not found." },
      { status: 404 }
    );
  }

  let clientId = providedContext.clientId;
  let projectId = providedContext.projectId;
  let rigId = providedContext.rigId;
  let maintenanceRequestId = providedContext.maintenanceRequestId;
  let breakdownReportId = providedContext.breakdownReportId;

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

  if (type === "MAINTENANCE_PURCHASE" && rigId && !projectId) {
    const activeProjectForRig = await prisma.project.findFirst({
      where: {
        assignedRigId: rigId,
        status: "ACTIVE"
      },
      select: {
        id: true,
        clientId: true
      }
    });
    if (activeProjectForRig) {
      projectId = activeProjectForRig.id;
      clientId = clientId || activeProjectForRig.clientId;
    }
  }

  if (breakdownReport) {
    if (projectId && projectId !== breakdownReport.projectId) {
      return NextResponse.json(
        { message: "Selected breakdown report does not match the selected project." },
        { status: 400 }
      );
    }
    if (clientId && clientId !== breakdownReport.clientId) {
      return NextResponse.json(
        { message: "Selected breakdown report does not match the selected client." },
        { status: 400 }
      );
    }
    if (rigId && rigId !== breakdownReport.rigId) {
      return NextResponse.json(
        { message: "Selected breakdown report does not match the selected rig." },
        { status: 400 }
      );
    }
    projectId = projectId || breakdownReport.projectId;
    rigId = rigId || breakdownReport.rigId;
    clientId = clientId || breakdownReport.clientId;
    breakdownReportId = breakdownReport.id;
  }

  if (maintenanceRequest && breakdownReport) {
    if (maintenanceRequest.rigId !== breakdownReport.rigId) {
      return NextResponse.json(
        { message: "Selected maintenance request and breakdown report do not match the same rig." },
        { status: 400 }
      );
    }
    if (
      maintenanceRequest.projectId &&
      breakdownReport.projectId &&
      maintenanceRequest.projectId !== breakdownReport.projectId
    ) {
      return NextResponse.json(
        {
          message:
            "Selected maintenance request and breakdown report do not match the same project."
        },
        { status: 400 }
      );
    }
  }

  if (type === "LIVE_PROJECT_PURCHASE" && !projectId) {
    return NextResponse.json(
      { message: "Project purchases require a project." },
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
  if (
    type === "MAINTENANCE_PURCHASE" &&
    maintenanceRequest &&
    !isMaintenanceOperationalOpen(maintenanceRequest.status)
  ) {
    return NextResponse.json(
      {
        message:
          "Selected maintenance case is not open. Link to an open maintenance case before submitting."
      },
      { status: 400 }
    );
  }
  if (type === "MAINTENANCE_PURCHASE" && !maintenanceRequestId) {
    return NextResponse.json(
      {
        message:
          "Maintenance purchases must be created from a maintenance case."
      },
      { status: 400 }
    );
  }

  const setupPayload = await resolveRequisitionSetupPayload();
  const setupCategories = setupPayload.categories.filter((entry) => entry.isActive);
  if (setupCategories.length === 0) {
    return NextResponse.json(
      {
        message: "No requisition categories are configured in setup."
      },
      { status: 422 }
    );
  }

  const resolvedCategory =
    setupCategories.find((entry) => entry.id === categoryIdInput) ||
    setupCategories.find(
      (entry) => normalizeMasterDataKey(entry.name) === normalizeMasterDataKey(categoryInput || "")
    ) ||
    null;
  if (!resolvedCategory) {
    return NextResponse.json(
      { message: "Category must be selected from setup." },
      { status: 400 }
    );
  }
  const category = resolvedCategory.name;
  const categoryId = resolvedCategory.id;

  let subcategory = subcategoryInput;
  let subcategoryId = subcategoryIdInput;
  const setupSubcategories = setupPayload.subcategories.filter(
    (entry) => entry.isActive && entry.categoryId === categoryId
  );

  if (subcategoryIdInput) {
    const linked = setupSubcategories.find((entry) => entry.id === subcategoryIdInput);
    if (!linked) {
      return NextResponse.json(
        { message: "Selected subcategory does not belong to the selected category." },
        { status: 400 }
      );
    }
    subcategory = linked.name;
    subcategoryId = linked.id;
  } else if (subcategoryInput) {
    const linked = setupSubcategories.find(
      (entry) =>
        normalizeMasterDataKey(entry.name) === normalizeMasterDataKey(subcategoryInput)
    );
    if (linked) {
      subcategory = linked.name;
      subcategoryId = linked.id;
    }
  }

  let requestedVendorId = requestedVendorIdInput;
  let requestedVendorName = requestedVendorNameInput;

  if (requestedVendorIdInput) {
    const vendor = await prisma.inventorySupplier.findUnique({
      where: { id: requestedVendorIdInput },
      select: { id: true, name: true }
    });
    if (!vendor) {
      return NextResponse.json({ message: "Selected vendor was not found." }, { status: 404 });
    }
    requestedVendorId = vendor.id;
    requestedVendorName = vendor.name;
  } else if (requestedVendorNameInput) {
    const vendorByName = await prisma.inventorySupplier.findFirst({
      where: {
        name: {
          equals: requestedVendorNameInput,
          mode: "insensitive"
        }
      },
      select: {
        id: true,
        name: true
      }
    });
    if (vendorByName) {
      requestedVendorId = vendorByName.id;
      requestedVendorName = vendorByName.name;
    }
  }

  const estimatedTotalCost = roundCurrency(
    lineItems.reduce((sum, line) => sum + line.estimatedTotalCost, 0)
  );
  const submittedAt = new Date();
  const resolvedLiveProjectSpendType =
    type === "LIVE_PROJECT_PURCHASE"
      ? breakdownReportId
        ? "BREAKDOWN"
        : liveProjectSpendType || "NORMAL_EXPENSE"
      : null;
  const payload = {
    schemaVersion: 1 as const,
    requisitionCode: buildRequisitionCode(submittedAt),
    type,
    status: "SUBMITTED" as const,
    liveProjectSpendType: resolvedLiveProjectSpendType,
    category,
    subcategory,
    categoryId,
    subcategoryId,
    requestedVendorId,
    requestedVendorName,
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
      maintenanceRequestId,
      breakdownReportId
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
        rigId: payload.context.rigId,
        breakdownReportId: payload.context.breakdownReportId || null
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
  payload: PurchaseRequisitionPayload,
  contextLabels?: {
    clientName: string | null;
    projectName: string | null;
    rigCode: string | null;
    maintenanceRequestCode: string | null;
    breakdownTitle: string | null;
  }
): RequisitionRowOutput {
  return {
    id: row.id,
    requisitionCode: payload.requisitionCode,
    type: payload.type,
    status: payload.status,
    liveProjectSpendType: payload.liveProjectSpendType,
    category: payload.category,
    subcategory: payload.subcategory,
    categoryId: payload.categoryId,
    subcategoryId: payload.subcategoryId,
    requestedVendorId: payload.requestedVendorId,
    requestedVendorName: payload.requestedVendorName,
    notes: payload.notes,
    submittedAt: payload.submittedAt,
    submittedBy: payload.submittedBy,
    context: {
      ...payload.context,
      breakdownReportId: payload.context.breakdownReportId || null
    },
    contextLabels: {
      clientName: contextLabels?.clientName || null,
      projectName: contextLabels?.projectName || null,
      rigCode: contextLabels?.rigCode || null,
      maintenanceRequestCode: contextLabels?.maintenanceRequestCode || null,
      breakdownTitle: contextLabels?.breakdownTitle || null
    },
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

function parseIsoTimestamp(value: string | null | undefined) {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed;
}

function getRequisitionSortTimestamp(entry: {
  row: {
    createdAt: Date;
  };
  payload: Pick<PurchaseRequisitionPayload, "submittedAt">;
}) {
  const submittedAt = parseIsoTimestamp(entry.payload.submittedAt);
  if (submittedAt) {
    return submittedAt.getTime();
  }
  return entry.row.createdAt.getTime();
}

async function resolveRequisitionSetupPayload() {
  const latestSetup = await prisma.summaryReport.findFirst({
    where: {
      reportType: PURCHASE_REQUISITION_SETUP_REPORT_TYPE
    },
    orderBy: [{ reportDate: "desc" }, { updatedAt: "desc" }],
    select: {
      payloadJson: true
    }
  });

  const parsed = parsePurchaseRequisitionSetupPayload(latestSetup?.payloadJson || null);
  if (parsed && parsed.categories.length > 0) {
    return parsed;
  }

  return buildDefaultRequisitionSetupPayload();
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

function isMaintenanceOperationalOpen(status: string | null | undefined) {
  const normalized = (status || "").trim().toUpperCase();
  return (
    normalized === "OPEN" ||
    normalized === "IN_REPAIR" ||
    normalized === "WAITING_FOR_PARTS"
  );
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
