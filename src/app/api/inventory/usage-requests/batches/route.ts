import { Prisma } from "@prisma/client";
import { NextResponse, type NextRequest } from "next/server";

import { auditActorFromSession, recordAuditLog } from "@/lib/audit";
import {
  requireAnyApiPermission,
  requireApiPermission
} from "@/lib/auth/api-guard";
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

import {
  buildUsageBatchStatusWhere,
  parseUsageRequestBatchStatusFilter,
  serializeUsageRequestBatchForClient,
  usageRequestBatchInclude
} from "./shared";

export async function GET(request: NextRequest) {
  const auth = await requireAnyApiPermission(request, [
    "inventory:view",
    "reports:view"
  ]);
  if (!auth.ok) {
    return auth.response;
  }

  const canManageInventory = canAccess(auth.session.role, "inventory:manage");
  const scopeParam = (request.nextUrl.searchParams.get("scope") || "").toLowerCase();
  const requestedByParam = (
    request.nextUrl.searchParams.get("requestedBy") || ""
  ).toLowerCase();
  const mineOnly =
    !canManageInventory || scopeParam === "mine" || requestedByParam === "me";

  const fromDate = parseDateOrNull(request.nextUrl.searchParams.get("from"));
  const toDate = parseDateOrNull(request.nextUrl.searchParams.get("to"), true);
  const rigId = nullableFilter(request.nextUrl.searchParams.get("rigId"));
  const clientId = nullableFilter(request.nextUrl.searchParams.get("clientId"));
  const projectId = nullableFilter(request.nextUrl.searchParams.get("projectId"));
  const itemId = nullableFilter(request.nextUrl.searchParams.get("itemId"));
  const maintenanceRequestId = nullableFilter(
    request.nextUrl.searchParams.get("maintenanceRequestId")
  );
  const breakdownReportId = nullableFilter(
    request.nextUrl.searchParams.get("breakdownReportId")
  );
  const statusFilter = parseUsageRequestBatchStatusFilter(
    request.nextUrl.searchParams.get("status")
  );
  const date = buildDateFilter(fromDate, toDate);

  const whereClauses: Prisma.InventoryUsageRequestBatchWhereInput[] = [
    buildUsageBatchStatusWhere(statusFilter, mineOnly),
    ...(mineOnly ? [{ requestedById: auth.session.userId }] : []),
    ...(rigId ? [{ rigId }] : []),
    ...(projectId ? [{ projectId }] : []),
    ...(clientId ? [{ project: { clientId } }] : []),
    ...(itemId ? [{ lines: { some: { itemId } } }] : []),
    ...(maintenanceRequestId ? [{ maintenanceRequestId }] : []),
    ...(breakdownReportId
      ? [
          {
            OR: [
              { breakdownReportId },
              { maintenanceRequest: { breakdownReportId } }
            ]
          }
        ]
      : []),
    ...(date ? [{ createdAt: date }] : [])
  ];
  const where: Prisma.InventoryUsageRequestBatchWhereInput =
    whereClauses.length === 1 ? whereClauses[0] : { AND: whereClauses };

  try {
    const rows = await prisma.inventoryUsageRequestBatch.findMany({
      where,
      include: usageRequestBatchInclude,
      orderBy: [{ createdAt: "desc" }]
    });

    return NextResponse.json({
      data: rows.map(serializeUsageRequestBatchForClient)
    });
  } catch (error) {
    return handleBatchApiError(error, "list");
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireApiPermission(request, "inventory:view");
  if (!auth.ok) {
    return auth.response;
  }

  const payload = (await request.json().catch(() => null)) as
    | Record<string, unknown>
    | null;
  if (!payload) {
    return NextResponse.json(
      { message: "Invalid request payload." },
      { status: 400 }
    );
  }

  const lines = Array.isArray(payload.lines)
    ? payload.lines
    : [];
  if (lines.length === 0) {
    return NextResponse.json(
      { message: "Add at least one item to submit a batch request." },
      { status: 400 }
    );
  }

  let maintenanceRequestId =
    typeof payload.maintenanceRequestId === "string" &&
    payload.maintenanceRequestId.trim()
      ? payload.maintenanceRequestId.trim()
      : null;
  const breakdownReportId =
    typeof payload.breakdownReportId === "string" &&
    payload.breakdownReportId.trim()
      ? payload.breakdownReportId.trim()
      : null;
  const drillReportId =
    typeof payload.drillReportId === "string" && payload.drillReportId.trim()
      ? payload.drillReportId.trim()
      : null;
  const projectIdInput =
    typeof payload.projectId === "string" && payload.projectId.trim()
      ? payload.projectId.trim()
      : null;
  const rigIdInput =
    typeof payload.rigId === "string" && payload.rigId.trim()
      ? payload.rigId.trim()
      : null;
  const locationIdInput =
    typeof payload.locationId === "string" && payload.locationId.trim()
      ? payload.locationId.trim()
      : typeof payload.sourceLocationId === "string" &&
          payload.sourceLocationId.trim()
        ? payload.sourceLocationId.trim()
        : null;
  const reasonDetailsRaw =
    typeof payload.reasonDetails === "string" ? payload.reasonDetails.trim() : "";
  const legacyReasonRaw =
    typeof payload.reason === "string" ? payload.reason.trim() : "";

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

  if (maintenanceRequestId && breakdownReportId) {
    return NextResponse.json(
      {
        message:
          "Link usage batch to either maintenance or breakdown, not both."
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
        message: "Maintenance usage cannot include a drilling report link."
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
  if (reasonType === "BREAKDOWN" && drillReportId) {
    return NextResponse.json(
      {
        message: "Breakdown usage cannot include a drilling report link."
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

  const aggregatedQuantities = new Map<string, number>();
  for (const rawLine of lines) {
    if (!rawLine || typeof rawLine !== "object") {
      return NextResponse.json(
        { message: "Every batch line must include itemId and quantity." },
        { status: 400 }
      );
    }
    const line = rawLine as Record<string, unknown>;
    const itemId = typeof line.itemId === "string" ? line.itemId.trim() : "";
    const quantity = parseNumeric(line.quantity);
    if (!itemId) {
      return NextResponse.json(
        { message: "Each batch line must include an item." },
        { status: 400 }
      );
    }
    if (quantity === null || quantity <= 0) {
      return NextResponse.json(
        { message: "Each batch line quantity must be greater than zero." },
        { status: 400 }
      );
    }
    const previous = aggregatedQuantities.get(itemId) || 0;
    aggregatedQuantities.set(itemId, roundCurrency(previous + quantity));
  }

  try {
    const itemIds = Array.from(aggregatedQuantities.keys());
    const [
      items,
      maintenanceContextById,
      maintenanceCandidates,
      breakdownContext,
      project,
      rig,
      location
    ] = await Promise.all([
      prisma.inventoryItem.findMany({
        where: { id: { in: itemIds } },
        select: {
          id: true,
          name: true,
          status: true,
          quantityInStock: true
        }
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
        ? prisma.rig.findUnique({
            where: { id: rigIdInput },
            select: { id: true }
          })
        : Promise.resolve(null),
      locationIdInput
        ? prisma.inventoryLocation.findUnique({
            where: { id: locationIdInput },
            select: { id: true }
          })
        : Promise.resolve(null)
    ]);

    const itemById = new Map(items.map((item) => [item.id, item]));
    const missingItems = itemIds.filter((itemId) => !itemById.has(itemId));
    if (missingItems.length > 0) {
      return NextResponse.json(
        { message: "One or more inventory items were not found." },
        { status: 404 }
      );
    }

    const inactiveItems = items.filter((item) => item.status !== "ACTIVE");
    if (inactiveItems.length > 0) {
      return NextResponse.json(
        {
          message: "Only active inventory items can be requested in a batch.",
          items: inactiveItems.map((item) => ({
            id: item.id,
            name: item.name
          }))
        },
        { status: 400 }
      );
    }

    const insufficientLines = itemIds
      .map((itemId) => {
        const item = itemById.get(itemId);
        if (!item) return null;
        const quantity = aggregatedQuantities.get(itemId) || 0;
        if (quantity <= item.quantityInStock) {
          return null;
        }
        return {
          itemId,
          name: item.name,
          requestedQuantity: quantity,
          stockOnHand: item.quantityInStock
        };
      })
      .filter(Boolean);
    if (insufficientLines.length > 0) {
      return NextResponse.json(
        {
          message:
            "Requested quantity exceeds stock on hand for one or more items.",
          items: insufficientLines
        },
        { status: 409 }
      );
    }

    let maintenanceContext = maintenanceContextById;
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
          message: "Selected maintenance case does not match the selected rig."
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
        {
          message:
            "This project has no assigned rig. Assign a rig to the project first."
        },
        { status: 409 }
      );
    }
    if (
      reasonType === "DRILLING_REPORT" &&
      rigIdInput &&
      !assignedProjectRigIds.includes(rigIdInput)
    ) {
      return NextResponse.json(
        {
          message:
            "Selected rig is not assigned to this project. Choose one of the project rigs."
        },
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

    const reason =
      reasonDetailsRaw ||
      legacyReasonRaw ||
      (reasonType === "MAINTENANCE"
        ? "Maintenance batch item usage"
        : reasonType === "BREAKDOWN"
          ? "Breakdown batch item usage"
          : reasonType === "DRILLING_REPORT"
            ? "Drilling report batch item usage"
            : "Operational batch item usage");

    const created = await prisma.inventoryUsageRequestBatch.create({
      data: {
        contextType,
        reason,
        projectId: resolvedProjectId,
        rigId: resolvedRigId,
        drillReportId: null,
        maintenanceRequestId: resolvedMaintenanceRequestId,
        breakdownReportId: resolvedBreakdownReportId,
        locationId: locationIdInput,
        requestedForDate: new Date(),
        requestedById: auth.session.userId,
        status: "SUBMITTED",
        lines: {
          create: itemIds.map((itemId) => ({
            itemId,
            quantity: roundCurrency(aggregatedQuantities.get(itemId) || 0),
            status: "SUBMITTED"
          }))
        }
      },
      include: usageRequestBatchInclude
    });

    await recordAuditLog({
      module: "inventory_usage_request_batches",
      entityType: "inventory_usage_request_batch",
      entityId: created.id,
      action: "create",
      description: `${auth.session.name} submitted inventory usage batch ${created.id}.`,
      after: {
        contextType: created.contextType,
        reasonType,
        status: created.status,
        projectId: created.projectId,
        rigId: created.rigId,
        maintenanceRequestId: created.maintenanceRequestId,
        breakdownReportId: created.breakdownReportId,
        locationId: created.locationId,
        lineCount: created.lines.length
      },
      actor: auditActorFromSession(auth.session)
    });

    return NextResponse.json(
      { data: serializeUsageRequestBatchForClient(created) },
      { status: 201 }
    );
  } catch (error) {
    return handleBatchApiError(error, "create");
  }
}

function isMaintenanceUsageContextOpen(status: string | null | undefined) {
  const normalized = (status || "").trim().toUpperCase();
  return normalized !== "COMPLETED" && normalized !== "DENIED";
}

function handleBatchApiError(error: unknown, operation: "list" | "create") {
  const operationLabel = `inventory/usage-requests/batches:${operation}`;
  console.error(`[${operationLabel}]`, {
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
    error.code === "P2002"
  ) {
    return NextResponse.json(
      {
        message:
          "Duplicate item detected in this batch. Remove duplicates and try again."
      },
      { status: 409 }
    );
  }

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
    {
      message:
        operation === "create"
          ? "Failed to submit inventory usage batch request."
          : "Failed to load inventory usage batch requests."
    },
    { status: 500 }
  );
}
