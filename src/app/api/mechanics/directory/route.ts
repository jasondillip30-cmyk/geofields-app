import type { MaintenanceStatus, Prisma, UrgencyLevel } from "@prisma/client";
import { NextResponse, type NextRequest } from "next/server";

import { requireApiPermission } from "@/lib/auth/api-guard";
import { nullableFilter, parseDateOrNull, roundCurrency } from "@/lib/inventory-server";
import type { MechanicDirectoryRow, MechanicsDirectoryPayload } from "@/lib/mechanics-directory";
import { prisma } from "@/lib/prisma";

const OPEN_MAINTENANCE_STATUSES: MaintenanceStatus[] = [
  "OPEN",
  "IN_REPAIR",
  "WAITING_FOR_PARTS"
];
const OVERDUE_THRESHOLD_HOURS = 72;

export async function GET(request: NextRequest) {
  const auth = await requireApiPermission(request, "mechanics:view");
  if (!auth.ok) {
    return auth.response;
  }

  const fromDate = parseDateOrNull(request.nextUrl.searchParams.get("from"));
  const toDate = parseDateOrNull(request.nextUrl.searchParams.get("to"), true);
  const clientId = nullableFilter(request.nextUrl.searchParams.get("clientId"));
  const rigId = nullableFilter(request.nextUrl.searchParams.get("rigId"));

  const maintenanceWhere: Prisma.MaintenanceRequestWhereInput = {
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

  const [mechanics, mechanicUsers, maintenanceRequests] = await Promise.all([
    prisma.mechanic.findMany({
      orderBy: [{ fullName: "asc" }],
      select: {
        id: true,
        fullName: true,
        specialization: true,
        phone: true,
        email: true,
        currentAssignment: true,
        status: true
      }
    }),
    prisma.user.findMany({
      where: {
        role: "MECHANIC"
      },
      select: {
        id: true,
        fullName: true,
        email: true,
        role: true,
        isActive: true
      }
    }),
    prisma.maintenanceRequest.findMany({
      where: maintenanceWhere,
      orderBy: [{ requestDate: "desc" }, { createdAt: "desc" }],
      select: {
        id: true,
        requestCode: true,
        requestDate: true,
        mechanicId: true,
        rigId: true,
        urgency: true,
        status: true,
        estimatedDowntimeHrs: true,
        rig: { select: { id: true, rigCode: true } }
      }
    })
  ]);

  const requestsByMechanicId = new Map<string, typeof maintenanceRequests>();
  for (const requestRow of maintenanceRequests) {
    const existing = requestsByMechanicId.get(requestRow.mechanicId) || [];
    existing.push(requestRow);
    requestsByMechanicId.set(requestRow.mechanicId, existing);
  }

  const userByEmail = new Map<string, (typeof mechanicUsers)[number]>();
  const userByName = new Map<string, (typeof mechanicUsers)[number]>();
  for (const user of mechanicUsers) {
    userByEmail.set(normalizeKey(user.email), user);
    userByName.set(normalizeKey(user.fullName), user);
  }

  const linkedUserIds = new Set<string>();
  const now = Date.now();

  const rows: MechanicDirectoryRow[] = mechanics.map((mechanic) => {
    const linkedUser =
      (mechanic.email ? userByEmail.get(normalizeKey(mechanic.email)) : null) || userByName.get(normalizeKey(mechanic.fullName)) || null;
    if (linkedUser) {
      linkedUserIds.add(linkedUser.id);
    }

    const scopedRequests = requestsByMechanicId.get(mechanic.id) || [];
    const openRequests = scopedRequests.filter((requestRow) => OPEN_MAINTENANCE_STATUSES.includes(requestRow.status));
    const completedRequests = scopedRequests.filter((requestRow) => requestRow.status === "COMPLETED");
    const urgentOpenItems = openRequests.filter((requestRow) => isUrgent(requestRow.urgency)).length;
    const overdueOpenItems = openRequests.filter((requestRow) => {
      const elapsedHours = (now - requestRow.requestDate.getTime()) / 3600000;
      return elapsedHours >= OVERDUE_THRESHOLD_HOURS;
    }).length;
    const rigsWorkedOn = Array.from(
      new Set(scopedRequests.map((requestRow) => requestRow.rig?.rigCode || requestRow.rigId).filter(Boolean))
    );
    const inRepairCount = scopedRequests.filter((requestRow) => requestRow.status === "IN_REPAIR").length;
    const waitingForPartsCount = scopedRequests.filter((requestRow) => requestRow.status === "WAITING_FOR_PARTS").length;
    const totalEstimatedDowntimeOpenHours = roundCurrency(
      openRequests.reduce((sum, requestRow) => sum + Math.max(0, requestRow.estimatedDowntimeHrs || 0), 0)
    );

    return {
      id: mechanic.id,
      name: mechanic.fullName,
      roleType: linkedUser?.role || "MECHANIC",
      specialization: normalizeNullableString(mechanic.specialization),
      phone: normalizeNullableString(mechanic.phone),
      email: normalizeNullableString(mechanic.email),
      currentAssignment: normalizeNullableString(mechanic.currentAssignment),
      status: normalizeStatus(mechanic.status),
      source: linkedUser ? "MECHANIC_PROFILE_WITH_USER_LINK" : "MECHANIC_PROFILE",
      linkedUserId: linkedUser?.id || null,
      linkedUserRole: linkedUser?.role || null,
      activeMaintenanceWorkload: openRequests.length,
      completedMaintenanceCount: completedRequests.length,
      rigsWorkedOn,
      currentOpenRequests: openRequests.length,
      urgentOpenItems,
      overdueOpenItems,
      inRepairCount,
      waitingForPartsCount,
      totalEstimatedDowntimeOpenHours,
      repairActivityHistoryIndicator: deriveRepairIndicator({
        openCount: openRequests.length,
        completedCount: completedRequests.length,
        inRepairCount,
        waitingForPartsCount
      }),
      openRequestReferences: openRequests.map((requestRow) => requestRow.requestCode).slice(0, 5)
    };
  });

  rows.sort((a, b) => {
    if (b.urgentOpenItems !== a.urgentOpenItems) {
      return b.urgentOpenItems - a.urgentOpenItems;
    }
    if (b.activeMaintenanceWorkload !== a.activeMaintenanceWorkload) {
      return b.activeMaintenanceWorkload - a.activeMaintenanceWorkload;
    }
    if (b.overdueOpenItems !== a.overdueOpenItems) {
      return b.overdueOpenItems - a.overdueOpenItems;
    }
    return a.name.localeCompare(b.name);
  });

  const unmatchedMechanicUsers = mechanicUsers.filter((user) => !linkedUserIds.has(user.id) && user.isActive);
  const allRigsWorkedOn = new Set<string>();
  for (const row of rows) {
    for (const rigCode of row.rigsWorkedOn) {
      allRigsWorkedOn.add(rigCode);
    }
  }

  const totalActiveRequests = rows.reduce((sum, row) => sum + row.currentOpenRequests, 0);
  const totalCompletedRequests = rows.reduce((sum, row) => sum + row.completedMaintenanceCount, 0);
  const totalUrgentOpenItems = rows.reduce((sum, row) => sum + row.urgentOpenItems, 0);
  const totalOverdueOpenItems = rows.reduce((sum, row) => sum + row.overdueOpenItems, 0);
  const unresolvedDowntimeHours = roundCurrency(rows.reduce((sum, row) => sum + row.totalEstimatedDowntimeOpenHours, 0));
  const specializationCount = new Set(rows.map((row) => row.specialization).filter(Boolean)).size;

  const notes: string[] = [];
  if (mechanics.length === 0) {
    notes.push("No mechanic profiles found in the database yet.");
  }
  if (maintenanceRequests.length === 0) {
    notes.push("No maintenance requests matched the current scope; workload fields are currently zero for this view.");
  }
  if (unmatchedMechanicUsers.length > 0) {
    notes.push(
      `${unmatchedMechanicUsers.length} mechanic user account(s) have no linked mechanic profile and are not included in workload calculations.`
    );
  }
  if (!maintenanceRequests.some((requestRow) => requestRow.status === "IN_REPAIR" || requestRow.status === "WAITING_FOR_PARTS")) {
    notes.push("Workshop stage activity is currently limited in this scope (no records in IN_REPAIR or WAITING_FOR_PARTS).");
  }

  const payload: MechanicsDirectoryPayload = {
    filters: {
      from: request.nextUrl.searchParams.get("from"),
      to: request.nextUrl.searchParams.get("to"),
      clientId: clientId || "all",
      rigId: rigId || "all"
    },
    summary: {
      totalMechanics: rows.length,
      activeRequests: totalActiveRequests,
      completedRequests: totalCompletedRequests,
      urgentOpenItems: totalUrgentOpenItems,
      overdueOpenItems: totalOverdueOpenItems,
      rigsCovered: allRigsWorkedOn.size,
      specializationsTracked: specializationCount,
      unresolvedDowntimeHours
    },
    data: rows,
    availability: {
      mechanicProfiles: rows.length > 0 ? "LIVE" : "UNAVAILABLE",
      userRoleLinkage: rows.length === 0 ? "UNAVAILABLE" : unmatchedMechanicUsers.length > 0 ? "PARTIAL" : "LIVE",
      specialization: specializationCount > 0 ? "LIVE" : "PARTIAL",
      maintenanceWorkload: maintenanceRequests.length > 0 ? "LIVE" : "PARTIAL",
      rigHistory: allRigsWorkedOn.size > 0 ? "LIVE" : "PARTIAL",
      downtimeActivity: unresolvedDowntimeHours > 0 ? "LIVE" : "PARTIAL",
      workshopRepairActivity: maintenanceRequests.some(
        (requestRow) => requestRow.status === "IN_REPAIR" || requestRow.status === "WAITING_FOR_PARTS"
      )
        ? "LIVE"
        : "PARTIAL"
    },
    notes
  };

  return NextResponse.json(payload);
}

function normalizeNullableString(value: string | null) {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeStatus(value: string | null) {
  if (!value) {
    return "UNKNOWN";
  }
  return value.trim().toUpperCase().replace(/\s+/g, "_");
}

function normalizeKey(value: string | null) {
  return (value || "").trim().toLowerCase();
}

function isUrgent(urgency: UrgencyLevel) {
  return urgency === "HIGH" || urgency === "CRITICAL";
}

function deriveRepairIndicator({
  openCount,
  completedCount,
  inRepairCount,
  waitingForPartsCount
}: {
  openCount: number;
  completedCount: number;
  inRepairCount: number;
  waitingForPartsCount: number;
}) {
  if (inRepairCount > 0) {
    return "In repair";
  }
  if (waitingForPartsCount > 0) {
    return "Waiting for parts";
  }
  if (openCount > 0) {
    return "Active requests pending";
  }
  if (completedCount > 0) {
    return "Completed repair history";
  }
  return "No repair history in scope";
}
