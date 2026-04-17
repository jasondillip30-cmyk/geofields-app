import { Prisma, type InventoryUsageRequestStatus } from "@prisma/client";
import { NextResponse, type NextRequest } from "next/server";

import { auditActorFromSession, recordAuditLog } from "@/lib/audit";
import { requireAnyApiPermission, requireApiPermission } from "@/lib/auth/api-guard";
import { canAccess } from "@/lib/auth/permissions";
import { isBreakdownOpenStatus } from "@/lib/breakdown-lifecycle";
import {
  deriveInventoryUsageContextType,
  deriveInventoryUsageReasonType
} from "@/lib/inventory-usage-context";
import {
  buildDateFilter,
  nullableFilter,
  parseDateOrNull,
  parseNumeric,
  roundCurrency
} from "@/lib/inventory-server";
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
  drillReport: {
    select: {
      id: true,
      holeNumber: true,
      date: true,
      project: { select: { id: true, name: true } },
      rig: { select: { id: true, rigCode: true } }
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
  breakdownReport: {
    select: {
      id: true,
      title: true,
      status: true,
      severity: true
    }
  },
  location: { select: { id: true, name: true } },
  requestedBy: { select: { id: true, fullName: true, role: true } },
  decidedBy: { select: { id: true, fullName: true, role: true } }
} as const;

type UsageRequestWithRelations = Prisma.InventoryUsageRequestGetPayload<{
  include: typeof requestInclude;
}>;

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
  const projectId = nullableFilter(request.nextUrl.searchParams.get("projectId"));
  const clientId = nullableFilter(request.nextUrl.searchParams.get("clientId"));
  const itemId = nullableFilter(request.nextUrl.searchParams.get("itemId"));
  const maintenanceRequestId = nullableFilter(request.nextUrl.searchParams.get("maintenanceRequestId"));
  const breakdownReportId = nullableFilter(request.nextUrl.searchParams.get("breakdownReportId"));
  const drillReportId = nullableFilter(request.nextUrl.searchParams.get("drillReportId"));
  const statusFilter = parseUsageRequestStatusFilter(request.nextUrl.searchParams.get("status"));
  const date = buildDateFilter(fromDate, toDate);

  const statusWhere = buildUsageStatusWhere(statusFilter, mineOnly);

  const whereClauses: Prisma.InventoryUsageRequestWhereInput[] = [
    statusWhere,
    ...(mineOnly ? [{ requestedById: auth.session.userId }] : []),
    ...(rigId ? [{ rigId }] : []),
    ...(projectId ? [{ projectId }] : []),
    ...(clientId ? [{ project: { clientId } }] : []),
    ...(itemId ? [{ itemId }] : []),
    ...(maintenanceRequestId ? [{ maintenanceRequestId }] : []),
    ...(drillReportId ? [{ drillReportId }] : []),
    ...(breakdownReportId
      ? [
          {
            OR: [{ breakdownReportId }, { maintenanceRequest: { breakdownReportId } }]
          }
        ]
      : []),
    ...(date ? [{ createdAt: date }] : [])
  ];
  const where: Prisma.InventoryUsageRequestWhereInput =
    whereClauses.length === 1 ? whereClauses[0] : { AND: whereClauses };

  let rows: UsageRequestWithRelations[] = [];
  try {
    rows = await prisma.inventoryUsageRequest.findMany({
      where,
      include: requestInclude,
      orderBy: [{ createdAt: "desc" }]
    });
  } catch (error) {
    return handleUsageRequestApiError(error, {
      operation: "list",
      context: {
        mineOnly,
        statusFilter,
        rigId,
        projectId,
        clientId,
        itemId,
        maintenanceRequestId,
        drillReportId,
        breakdownReportId
      }
    });
  }

  return NextResponse.json({ data: rows.map(serializeUsageRequestForClient) });
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

  const itemId = typeof payload.itemId === "string" ? payload.itemId.trim() : "";
  const quantity = parseNumeric(payload.quantity);
  const reasonDetailsRaw =
    typeof payload.reasonDetails === "string" ? payload.reasonDetails.trim() : "";
  const legacyReasonRaw =
    typeof payload.reason === "string" ? payload.reason.trim() : "";
  let maintenanceRequestId =
    typeof payload.maintenanceRequestId === "string" && payload.maintenanceRequestId.trim()
      ? payload.maintenanceRequestId
      : null;
  const breakdownReportId =
    typeof payload.breakdownReportId === "string" && payload.breakdownReportId.trim()
      ? payload.breakdownReportId
      : null;
  const drillReportId =
    typeof payload.drillReportId === "string" && payload.drillReportId.trim()
      ? payload.drillReportId
      : null;
  const projectIdInput =
    typeof payload.projectId === "string" && payload.projectId.trim()
      ? payload.projectId
      : null;
  const rigIdInput =
    typeof payload.rigId === "string" && payload.rigId.trim() ? payload.rigId : null;
  const locationIdInput =
    typeof payload.locationId === "string" && payload.locationId.trim()
      ? payload.locationId
      : typeof payload.sourceLocationId === "string" && payload.sourceLocationId.trim()
        ? payload.sourceLocationId
      : null;
  const reasonType = deriveInventoryUsageReasonType({
    explicitReasonType:
      typeof payload.reasonType === "string"
        ? payload.reasonType
        : typeof payload.usageReason === "string"
          ? payload.usageReason
          : null,
    maintenanceRequestId,
    breakdownReportId,
    drillReportId
  });
  const contextType = deriveInventoryUsageContextType({
    explicitContextType:
      typeof payload.contextType === "string"
        ? payload.contextType
        : typeof payload.usageContextType === "string"
          ? payload.usageContextType
          : null,
    explicitReasonType:
      typeof payload.reasonType === "string"
        ? payload.reasonType
        : typeof payload.usageReason === "string"
          ? payload.usageReason
          : null,
    maintenanceRequestId,
    breakdownReportId,
    drillReportId
  });

  if (!itemId) {
    return NextResponse.json({ message: "Item is required." }, { status: 400 });
  }
  if (quantity === null || quantity <= 0) {
    return NextResponse.json(
      { message: "Quantity must be greater than zero." },
      { status: 400 }
    );
  }
  if (maintenanceRequestId && breakdownReportId) {
    return NextResponse.json(
      {
        message:
          "Link usage request to either maintenance or breakdown, not both."
      },
      { status: 400 }
    );
  }
  if (reasonType === "DRILLING_REPORT" && !projectIdInput) {
    return NextResponse.json(
      { message: "Select a project for drilling usage requests." },
      { status: 400 }
    );
  }
  if (reasonType === "DRILLING_REPORT" && !rigIdInput) {
    return NextResponse.json(
      { message: "Select a project rig for drilling usage requests." },
      { status: 400 }
    );
  }
  if (reasonType === "DRILLING_REPORT" && (maintenanceRequestId || breakdownReportId)) {
    return NextResponse.json(
      {
        message:
          "Drilling report usage cannot also be linked to maintenance or breakdown."
      },
      { status: 400 }
    );
  }
  if (reasonType === "MAINTENANCE" && drillReportId) {
    return NextResponse.json(
      {
        message:
          "Maintenance usage cannot include a drilling report link."
      },
      { status: 400 }
    );
  }
  if (reasonType === "BREAKDOWN" && drillReportId) {
    return NextResponse.json(
      {
        message:
          "Breakdown usage cannot include a drilling report link."
      },
      { status: 400 }
    );
  }
  if (reasonType === "MAINTENANCE" && breakdownReportId) {
    return NextResponse.json(
      {
        message:
          "Maintenance usage requests must link only to maintenance. Breakdown linkage is inherited through the maintenance record when applicable."
      },
      { status: 400 }
    );
  }
  if (reasonType === "BREAKDOWN" && maintenanceRequestId) {
    return NextResponse.json(
      {
        message:
          "Breakdown usage requests must link only to breakdown. Do not attach maintenanceRequestId for breakdown reason."
      },
      { status: 400 }
    );
  }
  if (reasonType === "MAINTENANCE" && !maintenanceRequestId && !rigIdInput) {
    return NextResponse.json(
      {
        message:
          "Select a rig under maintenance. The system auto-links when there is one open maintenance case."
      },
      { status: 400 }
    );
  }
  if (reasonType === "BREAKDOWN" && !breakdownReportId) {
    return NextResponse.json(
      { message: "breakdownReportId is required for breakdown usage requests." },
      { status: 400 }
    );
  }
  if (
    reasonType !== "MAINTENANCE" &&
    reasonType !== "BREAKDOWN" &&
    reasonType !== "DRILLING_REPORT"
  ) {
    return NextResponse.json(
      {
        message:
          "Inventory usage must be linked to maintenance, breakdown, or drilling report context."
      },
      { status: 400 }
    );
  }

  try {
    const [item, maintenanceContextById, maintenanceCandidates, breakdownContext, project, rig, location] =
      await Promise.all([
        prisma.inventoryItem.findUnique({
          where: { id: itemId },
          select: { id: true, name: true, quantityInStock: true, status: true }
        }),
        maintenanceRequestId
          ? prisma.maintenanceRequest.findUnique({
              where: { id: maintenanceRequestId },
              select: {
                id: true,
                requestCode: true,
                status: true,
                projectId: true,
                rigId: true,
                breakdownReportId: true
              }
            })
          : Promise.resolve(null),
        reasonType === "MAINTENANCE" && !maintenanceRequestId && rigIdInput
          ? prisma.maintenanceRequest.findMany({
              where: { rigId: rigIdInput },
              select: {
                id: true,
                requestCode: true,
                status: true,
                projectId: true,
                rigId: true,
                breakdownReportId: true
              },
              orderBy: [{ requestDate: "desc" }, { createdAt: "desc" }]
            })
          : Promise.resolve([]),
        breakdownReportId
          ? prisma.breakdownReport.findUnique({
              where: { id: breakdownReportId },
              select: { id: true, status: true, projectId: true, rigId: true }
            })
          : Promise.resolve(null),
        projectIdInput
          ? prisma.project.findUnique({
              where: { id: projectIdInput },
              select: {
                id: true,
                assignedRigId: true,
                backupRigId: true
              }
            })
          : Promise.resolve(null),
        rigIdInput
          ? prisma.rig.findUnique({ where: { id: rigIdInput }, select: { id: true } })
          : Promise.resolve(null),
        locationIdInput
          ? prisma.inventoryLocation.findUnique({
              where: { id: locationIdInput },
              select: { id: true }
            })
          : Promise.resolve(null)
      ]);

    let maintenanceContext = maintenanceContextById;

    if (!item) {
      return NextResponse.json({ message: "Inventory item not found." }, { status: 404 });
    }
    if (item.status !== "ACTIVE") {
      return NextResponse.json(
        { message: "Only active inventory items can be requested." },
        { status: 400 }
      );
    }
    if (projectIdInput && !project) {
      return NextResponse.json({ message: "Project not found." }, { status: 404 });
    }
    if (rigIdInput && !rig) {
      return NextResponse.json({ message: "Rig not found." }, { status: 404 });
    }
    if (maintenanceRequestId && !maintenanceContext) {
      return NextResponse.json(
        { message: "Maintenance request not found." },
        { status: 404 }
      );
    }
    if (breakdownReportId && !breakdownContext) {
      return NextResponse.json(
        { message: "Breakdown report not found." },
        { status: 404 }
      );
    }
    if (locationIdInput && !location) {
      return NextResponse.json({ message: "Location not found." }, { status: 404 });
    }

    if (
      reasonType === "MAINTENANCE" &&
      !maintenanceContext &&
      !maintenanceRequestId &&
      rigIdInput
    ) {
      const openCandidates = maintenanceCandidates.filter((row) =>
        isMaintenanceUsageContextOpen(row.status)
      );
      if (openCandidates.length === 0) {
        return NextResponse.json(
          {
            message:
              "No open maintenance case exists for this rig. Open a maintenance case before requesting item usage."
          },
          { status: 409 }
        );
      }
      if (openCandidates.length > 1) {
        return NextResponse.json(
          {
            message:
              "Multiple open maintenance cases exist for this rig. Select a maintenance case before submitting item usage.",
            options: openCandidates.map((row) => ({
              id: row.id,
              requestCode: row.requestCode,
              status: row.status
            }))
          },
          { status: 409 }
        );
      }
      maintenanceContext = openCandidates[0];
      maintenanceRequestId = maintenanceContext.id;
    }

    if (
      reasonType === "MAINTENANCE" &&
      maintenanceContext &&
      rigIdInput &&
      maintenanceContext.rigId !== rigIdInput
    ) {
      return NextResponse.json(
        {
          message:
            "Selected maintenance case does not match the selected rig."
        },
        { status: 400 }
      );
    }

    if (
      reasonType === "MAINTENANCE" &&
      maintenanceContext &&
      !isMaintenanceUsageContextOpen(maintenanceContext.status)
    ) {
      return NextResponse.json(
        { message: "Selected maintenance record is not open for item usage." },
        { status: 409 }
      );
    }
    if (
      reasonType === "BREAKDOWN" &&
      breakdownContext &&
      !isBreakdownOpenStatus(breakdownContext.status)
    ) {
      return NextResponse.json(
        { message: "Selected breakdown is not open for item usage." },
        { status: 409 }
      );
    }
    if (reasonType === "DRILLING_REPORT" && !project) {
      return NextResponse.json({ message: "Project not found." }, { status: 404 });
    }
    if (reasonType === "DRILLING_REPORT" && !rig) {
      return NextResponse.json({ message: "Rig not found." }, { status: 404 });
    }
    const assignedProjectRigIds =
      reasonType === "DRILLING_REPORT"
        ? [project?.assignedRigId || null, project?.backupRigId || null].filter(
            (value): value is string => Boolean(value)
          )
        : [];
    if (reasonType === "DRILLING_REPORT" && assignedProjectRigIds.length === 0) {
      return NextResponse.json(
        { message: "This project has no assigned rig. Assign a rig to the project first." },
        { status: 409 }
      );
    }
    if (
      reasonType === "DRILLING_REPORT" &&
      rigIdInput &&
      !assignedProjectRigIds.includes(rigIdInput)
    ) {
      return NextResponse.json(
        { message: "Selected rig is not assigned to this project. Choose one of the project rigs." },
        { status: 400 }
      );
    }

    const resolvedProjectId =
      reasonType === "MAINTENANCE"
        ? maintenanceContext?.projectId || null
        : reasonType === "BREAKDOWN"
          ? breakdownContext?.projectId || null
          : reasonType === "DRILLING_REPORT"
            ? projectIdInput
          : null;
    const resolvedRigId =
      reasonType === "MAINTENANCE"
        ? maintenanceContext?.rigId || null
        : reasonType === "BREAKDOWN"
          ? breakdownContext?.rigId || null
          : reasonType === "DRILLING_REPORT"
            ? rigIdInput
          : null;
    const resolvedMaintenanceRequestId =
      reasonType === "MAINTENANCE" ? maintenanceContext?.id || null : null;
    const resolvedBreakdownReportId =
      reasonType === "BREAKDOWN" ? breakdownContext?.id || null : null;
    const resolvedDrillReportId = null;
    if (reasonType === "DRILLING_REPORT" && !resolvedProjectId) {
      return NextResponse.json(
        { message: "Select a project for drilling usage requests." },
        { status: 409 }
      );
    }
    if (reasonType === "DRILLING_REPORT" && !resolvedRigId) {
      return NextResponse.json(
        { message: "Select a project rig for drilling usage requests." },
        { status: 409 }
      );
    }
    const reason =
      reasonDetailsRaw ||
      legacyReasonRaw ||
      (reasonType === "MAINTENANCE"
        ? "Maintenance item usage"
        : reasonType === "BREAKDOWN"
          ? "Breakdown item usage"
          : reasonType === "DRILLING_REPORT"
            ? "Drilling report item usage"
          : "Operational item usage");

    const created = await prisma.inventoryUsageRequest.create({
      data: {
        itemId: item.id,
        contextType,
        quantity: roundCurrency(quantity),
        reason,
        projectId: resolvedProjectId,
        rigId: resolvedRigId,
        drillReportId: resolvedDrillReportId,
        maintenanceRequestId: resolvedMaintenanceRequestId,
        breakdownReportId: resolvedBreakdownReportId,
        locationId: locationIdInput,
        requestedForDate: new Date(),
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
        reasonType,
        contextType,
        projectId: created.projectId,
        rigId: created.rigId,
        drillReportId: created.drillReportId,
        maintenanceRequestId: created.maintenanceRequestId,
        breakdownReportId: created.breakdownReportId,
        locationId: created.locationId,
        requestedForDate: created.requestedForDate,
        status: created.status
      },
      actor: auditActorFromSession(auth.session)
    });

    return NextResponse.json({ data: serializeUsageRequestForClient(created) }, { status: 201 });
  } catch (error) {
    return handleUsageRequestApiError(error, {
      operation: "create",
      context: {
        itemId,
        quantity,
        reasonType,
        maintenanceRequestId,
        drillReportId,
        breakdownReportId,
        locationId: locationIdInput,
        projectIdInput,
        rigIdInput
      }
    });
  }
}

function serializeUsageRequestForClient(row: UsageRequestWithRelations) {
  const fallbackBreakdownId =
    row.breakdownReportId || row.maintenanceRequest?.breakdownReportId || null;
  const normalizedStatus: InventoryUsageRequestStatus =
    row.status === "APPROVED" || row.approvedMovementId ? "APPROVED" : row.status;
      const reasonType = deriveInventoryUsageReasonType({
    explicitReasonType: row.contextType,
    maintenanceRequestId: row.maintenanceRequestId,
    breakdownReportId: fallbackBreakdownId,
    drillReportId: row.drillReportId
  });

  return {
    ...row,
    status: normalizedStatus,
    reason: row.reason,
    reasonType,
    contextType: row.contextType,
    breakdownReportId: fallbackBreakdownId,
    legacyStatusNormalized: normalizedStatus !== row.status
  };
}

type UsageRequestStatusFilter =
  | "ALL"
  | "SUBMITTED"
  | "PENDING"
  | "APPROVED"
  | "REJECTED"
  | "DEFAULT";

function parseUsageRequestStatusFilter(rawStatus: string | null): UsageRequestStatusFilter {
  const normalized = (rawStatus || "").trim().toUpperCase();
  if (!normalized) {
    return "DEFAULT";
  }
  if (
    normalized === "ALL" ||
    normalized === "SUBMITTED" ||
    normalized === "PENDING" ||
    normalized === "APPROVED" ||
    normalized === "REJECTED"
  ) {
    return normalized;
  }
  return "DEFAULT";
}

function buildUsageStatusWhere(
  statusFilter: UsageRequestStatusFilter,
  mineOnly: boolean
): Prisma.InventoryUsageRequestWhereInput {
  if (statusFilter === "APPROVED") {
    return {
      OR: [{ status: "APPROVED" }, { approvedMovementId: { not: null } }]
    };
  }
  if (statusFilter === "SUBMITTED") {
    return { status: "SUBMITTED" };
  }
  if (statusFilter === "PENDING") {
    return { status: "PENDING" };
  }
  if (statusFilter === "REJECTED") {
    return { status: "REJECTED" };
  }
  if (statusFilter === "ALL") {
    return {};
  }
  if (!mineOnly) {
    return { status: { in: ["SUBMITTED", "PENDING"] as const } };
  }
  return {};
}

function isMaintenanceUsageContextOpen(status: string | null | undefined) {
  const normalized = (status || "").trim().toUpperCase();
  return normalized !== "COMPLETED" && normalized !== "DENIED";
}

function handleUsageRequestApiError(
  error: unknown,
  options: {
    operation: "list" | "create";
    context?: Record<string, unknown>;
  }
) {
  const operationLabel = `inventory/usage-requests:${options.operation}`;
  console.error(`[${operationLabel}]`, {
    errorName: error instanceof Error ? error.name : "UnknownError",
    message: getErrorMessage(error),
    ...(error instanceof Prisma.PrismaClientKnownRequestError
      ? {
          prismaCode: error.code,
          prismaMeta: error.meta || null
        }
      : {}),
    ...(options.context ? { context: options.context } : {})
  });

  if (isLinkageSchemaMismatch(error)) {
    return NextResponse.json(
      {
        message:
          "Database schema is out of sync for inventory usage linkage fields. Missing breakdown linkage column(s) in the current database.",
        code: "SCHEMA_OUT_OF_SYNC",
        nextStep:
          "Fix DATABASE_URL, then run: npx prisma migrate dev --name add_breakdown_usage_linkage. If migrate reports local drift, run npx prisma db push for local schema alignment."
      },
      { status: 500 }
    );
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2003") {
      return NextResponse.json(
        {
          message:
            "Linked record is invalid or missing. Confirm selected breakdown/maintenance/location still exists."
        },
        { status: 409 }
      );
    }
  }

  if (error instanceof Prisma.PrismaClientInitializationError) {
    return NextResponse.json(
      {
        message:
          "Database connection/configuration error. Verify DATABASE_URL is valid for the configured Prisma provider."
      },
      { status: 500 }
    );
  }

  return NextResponse.json(
    {
      message:
        options.operation === "create"
          ? "Failed to submit inventory usage request."
          : "Failed to load inventory usage requests."
    },
    { status: 500 }
  );
}

function isLinkageSchemaMismatch(error: unknown) {
  const message = getErrorMessage(error).toLowerCase();

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2022") {
      const column = `${(error.meta as { column?: unknown } | undefined)?.column || ""}`.toLowerCase();
      if (column.includes("breakdownreportid")) {
        return true;
      }
      if (column.includes("maintenancerequest.breakdownreportid")) {
        return true;
      }
      if (message.includes("breakdownreportid")) {
        return true;
      }
      if (message.includes("maintenancerequest.breakdownreportid")) {
        return true;
      }
    }
  }

  return (
    message.includes("column") &&
    message.includes("breakdownreportid") &&
    (message.includes("does not exist") || message.includes("unknown"))
  );
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return String(error);
}
