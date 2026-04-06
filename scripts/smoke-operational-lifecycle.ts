import { ProjectStatus, PrismaClient, RigStatus } from "@prisma/client";

import { buildRecognizedSpendContext } from "../src/lib/recognized-spend-context";
import { purgeDanglingSmokeArtifacts } from "./smoke-isolation";

const prisma = new PrismaClient();

const SESSION_COOKIE_NAME = "gf_session";
const DEFAULT_BASE_URL = "http://127.0.0.1:3000";
const OPEN_BREAKDOWN_STATUSES = ["OPEN", "SUBMITTED", "IN_PROGRESS", "UNDER_REVIEW"] as const;

interface CreatedState {
  projectId: string | null;
  rigId: string | null;
  itemId: string | null;
  itemOriginalStock: number | null;
  projectOriginalStatus: ProjectStatus | null;
  rigOriginalStatus: RigStatus | null;
  breakdownId: string | null;
  maintenanceId: string | null;
  standaloneMaintenanceId: string | null;
  maintenanceUsageRequestId: string | null;
  breakdownUsageRequestId: string | null;
  standaloneMaintenanceUsageRequestId: string | null;
  maintenanceMovementId: string | null;
  breakdownMovementId: string | null;
  standaloneMaintenanceMovementId: string | null;
  maintenanceExpenseId: string | null;
  breakdownExpenseId: string | null;
  standaloneMaintenanceExpenseId: string | null;
}

interface HttpResult {
  ok: boolean;
  status: number;
  text: string;
  json: Record<string, unknown> | null;
}

async function main() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Operational lifecycle smoke must not run in production.");
  }

  const baseUrl = (process.env.SMOKE_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, "");
  const adminEmail = process.env.SMOKE_ADMIN_EMAIL || "admin@geofields.co.tz";
  const adminPassword = process.env.SMOKE_ADMIN_PASSWORD || "Admin123!";
  const mechanicEmail = process.env.SMOKE_MECHANIC_EMAIL || "mechanic@geofields.co.tz";
  const mechanicPassword = process.env.SMOKE_MECHANIC_PASSWORD || "Mechanic123!";
  const runToken = `ops-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

  const created: CreatedState = {
    projectId: null,
    rigId: null,
    itemId: null,
    itemOriginalStock: null,
    projectOriginalStatus: null,
    rigOriginalStatus: null,
    breakdownId: null,
    maintenanceId: null,
    standaloneMaintenanceId: null,
    maintenanceUsageRequestId: null,
    breakdownUsageRequestId: null,
    standaloneMaintenanceUsageRequestId: null,
    maintenanceMovementId: null,
    breakdownMovementId: null,
    standaloneMaintenanceMovementId: null,
    maintenanceExpenseId: null,
    breakdownExpenseId: null,
    standaloneMaintenanceExpenseId: null
  };

  try {
    await purgeDanglingSmokeArtifacts(prisma);
    await ensureServerReachable(baseUrl);
    const adminCookie = await loginAndGetCookie(baseUrl, adminEmail, adminPassword);
    const mechanicCookie = await loginAndGetCookie(baseUrl, mechanicEmail, mechanicPassword);

    const project = await findOperationalProjectCandidate();
    assert(project, "No active project+rig candidate found for operational smoke test.");

    const rig = await prisma.rig.findUnique({
      where: { id: project.assignedRigId! },
      select: { id: true, status: true, rigCode: true }
    });
    assert(rig, "Candidate rig was not found.");

    const item = await prisma.inventoryItem.findFirst({
      where: {
        status: "ACTIVE",
        quantityInStock: { gte: 8 }
      },
      select: {
        id: true,
        name: true,
        quantityInStock: true,
        locationId: true
      },
      orderBy: [{ quantityInStock: "desc" }, { createdAt: "asc" }]
    });
    assert(item, "No active inventory item with enough stock found.");
    assert(item.locationId, "Selected inventory item has no locationId.");

    created.projectId = project.id;
    created.rigId = rig.id;
    created.itemId = item.id;
    created.itemOriginalStock = item.quantityInStock;
    created.projectOriginalStatus = project.status;
    created.rigOriginalStatus = rig.status;

    const breakdownCreate = await postJson(baseUrl, "/api/breakdowns", adminCookie, {
      projectId: project.id,
      title: `Smoke Breakdown ${runToken}`,
      description: `Operational lifecycle smoke breakdown ${runToken}`,
      severity: "HIGH",
      downtimeHours: 2
    });
    assert(
      breakdownCreate.ok,
      `Breakdown create failed (${breakdownCreate.status}): ${breakdownCreate.text}`
    );
    const breakdownId = asString(
      ((breakdownCreate.json?.data as Record<string, unknown> | null)?.id as string) || ""
    );
    assert(breakdownId, "Breakdown create did not return breakdown id.");
    created.breakdownId = breakdownId;

    const postBreakdownProject = await prisma.project.findUnique({
      where: { id: project.id },
      select: { status: true }
    });
    const postBreakdownRig = await prisma.rig.findUnique({
      where: { id: rig.id },
      select: { status: true }
    });
    assert(
      postBreakdownProject?.status === "ON_HOLD",
      `Project did not move to ON_HOLD after breakdown. Found ${postBreakdownProject?.status}.`
    );
    assert(
      postBreakdownRig?.status === "BREAKDOWN",
      `Rig did not move to BREAKDOWN after breakdown. Found ${postBreakdownRig?.status}.`
    );

    const maintenanceCreate = await postJson(baseUrl, "/api/maintenance-requests", adminCookie, {
      rigId: rig.id,
      projectId: project.id,
      breakdownReportId: breakdownId,
      issueType: "ROUTINE_MAINTENANCE",
      issueDescription: `Smoke maintenance from breakdown ${runToken}`,
      status: "IN_REPAIR",
      urgency: "HIGH",
      estimatedDowntimeHrs: 2,
      notes: `maintenance smoke ${runToken}`,
      requestDate: new Date().toISOString().slice(0, 10)
    });
    assert(
      maintenanceCreate.ok,
      `Maintenance create failed (${maintenanceCreate.status}): ${maintenanceCreate.text}`
    );
    const maintenanceId = asString(
      ((maintenanceCreate.json?.data as Record<string, unknown> | null)?.id as string) || ""
    );
    assert(maintenanceId, "Maintenance create did not return maintenance id.");
    created.maintenanceId = maintenanceId;

    const standaloneMaintenanceCreate = await postJson(
      baseUrl,
      "/api/maintenance-requests",
      adminCookie,
      {
        rigId: rig.id,
        projectId: project.id,
        issueType: "ROUTINE_MAINTENANCE",
        issueDescription: `Smoke standalone maintenance ${runToken}`,
        status: "IN_REPAIR",
        urgency: "MEDIUM",
        estimatedDowntimeHrs: 1,
        notes: `standalone maintenance smoke ${runToken}`,
        requestDate: new Date().toISOString().slice(0, 10)
      }
    );
    assert(
      standaloneMaintenanceCreate.ok,
      `Standalone maintenance create failed (${standaloneMaintenanceCreate.status}): ${standaloneMaintenanceCreate.text}`
    );
    const standaloneMaintenanceId = asString(
      ((standaloneMaintenanceCreate.json?.data as Record<string, unknown> | null)?.id as string) || ""
    );
    assert(standaloneMaintenanceId, "Standalone maintenance create did not return maintenance id.");
    created.standaloneMaintenanceId = standaloneMaintenanceId;

    const maintenanceUsage = await postJson(baseUrl, "/api/inventory/usage-requests", mechanicCookie, {
      itemId: item.id,
      quantity: 1,
      reasonType: "MAINTENANCE",
      reasonDetails: `Operational lifecycle smoke ${runToken} maintenance usage`,
      maintenanceRequestId: maintenanceId,
      projectId: project.id,
      rigId: rig.id,
      locationId: item.locationId
    });
    assert(
      maintenanceUsage.ok,
      `Maintenance usage request create failed (${maintenanceUsage.status}): ${maintenanceUsage.text}`
    );
    created.maintenanceUsageRequestId = asString(
      ((maintenanceUsage.json?.data as Record<string, unknown> | null)?.id as string) || ""
    );
    assert(created.maintenanceUsageRequestId, "Missing maintenance usage request id.");

    const breakdownUsage = await postJson(baseUrl, "/api/inventory/usage-requests", mechanicCookie, {
      itemId: item.id,
      quantity: 1,
      reasonType: "BREAKDOWN",
      reasonDetails: `Operational lifecycle smoke ${runToken} breakdown usage`,
      breakdownReportId: breakdownId,
      projectId: project.id,
      rigId: rig.id,
      locationId: item.locationId
    });
    assert(
      breakdownUsage.ok,
      `Breakdown usage request create failed (${breakdownUsage.status}): ${breakdownUsage.text}`
    );
    created.breakdownUsageRequestId = asString(
      ((breakdownUsage.json?.data as Record<string, unknown> | null)?.id as string) || ""
    );
    assert(created.breakdownUsageRequestId, "Missing breakdown usage request id.");

    const standaloneMaintenanceUsage = await postJson(
      baseUrl,
      "/api/inventory/usage-requests",
      mechanicCookie,
      {
        itemId: item.id,
        quantity: 1,
        reasonType: "MAINTENANCE",
        reasonDetails: `Operational lifecycle smoke ${runToken} standalone maintenance usage`,
        maintenanceRequestId: standaloneMaintenanceId,
        projectId: project.id,
        rigId: rig.id,
        locationId: item.locationId
      }
    );
    assert(
      standaloneMaintenanceUsage.ok,
      `Standalone maintenance usage request create failed (${standaloneMaintenanceUsage.status}): ${standaloneMaintenanceUsage.text}`
    );
    created.standaloneMaintenanceUsageRequestId = asString(
      ((standaloneMaintenanceUsage.json?.data as Record<string, unknown> | null)?.id as string) || ""
    );
    assert(created.standaloneMaintenanceUsageRequestId, "Missing standalone maintenance usage request id.");

    const mineSubmitted = await getJson(
      baseUrl,
      "/api/inventory/usage-requests?scope=mine&status=submitted",
      mechanicCookie
    );
    assert(
      mineSubmitted.ok,
      `Failed to query submitted usage requests (${mineSubmitted.status}): ${mineSubmitted.text}`
    );
    assert(
      usageListContains(mineSubmitted.json, created.maintenanceUsageRequestId),
      "Maintenance usage request is missing from My Usage Requests (submitted)."
    );
    assert(
      usageListContains(mineSubmitted.json, created.breakdownUsageRequestId),
      "Breakdown usage request is missing from My Usage Requests (submitted)."
    );
    assert(
      usageListContains(mineSubmitted.json, created.standaloneMaintenanceUsageRequestId),
      "Standalone maintenance usage request is missing from My Usage Requests (submitted)."
    );

    const approveMaintenanceUsage = await postJson(
      baseUrl,
      `/api/inventory/usage-requests/${created.maintenanceUsageRequestId}/status`,
      adminCookie,
      { action: "approve", note: "Operational smoke approve maintenance usage." }
    );
    assert(
      approveMaintenanceUsage.ok,
      `Maintenance usage approval failed (${approveMaintenanceUsage.status}): ${approveMaintenanceUsage.text}`
    );
    created.maintenanceMovementId = asString(
      (approveMaintenanceUsage.json?.movementId as string) || ""
    );
    created.maintenanceExpenseId = asString(
      (approveMaintenanceUsage.json?.expenseId as string) || ""
    );
    assert(created.maintenanceMovementId, "Maintenance usage approval missing movement id.");
    assert(created.maintenanceExpenseId, "Maintenance usage approval missing expense id.");

    const approveBreakdownUsage = await postJson(
      baseUrl,
      `/api/inventory/usage-requests/${created.breakdownUsageRequestId}/status`,
      adminCookie,
      { action: "approve", note: "Operational smoke approve breakdown usage." }
    );
    assert(
      approveBreakdownUsage.ok,
      `Breakdown usage approval failed (${approveBreakdownUsage.status}): ${approveBreakdownUsage.text}`
    );
    created.breakdownMovementId = asString(
      (approveBreakdownUsage.json?.movementId as string) || ""
    );
    created.breakdownExpenseId = asString((approveBreakdownUsage.json?.expenseId as string) || "");
    assert(created.breakdownMovementId, "Breakdown usage approval missing movement id.");
    assert(created.breakdownExpenseId, "Breakdown usage approval missing expense id.");

    const approveStandaloneMaintenanceUsage = await postJson(
      baseUrl,
      `/api/inventory/usage-requests/${created.standaloneMaintenanceUsageRequestId}/status`,
      adminCookie,
      { action: "approve", note: "Operational smoke approve standalone maintenance usage." }
    );
    assert(
      approveStandaloneMaintenanceUsage.ok,
      `Standalone maintenance usage approval failed (${approveStandaloneMaintenanceUsage.status}): ${approveStandaloneMaintenanceUsage.text}`
    );
    created.standaloneMaintenanceMovementId = asString(
      (approveStandaloneMaintenanceUsage.json?.movementId as string) || ""
    );
    created.standaloneMaintenanceExpenseId = asString(
      (approveStandaloneMaintenanceUsage.json?.expenseId as string) || ""
    );
    assert(
      created.standaloneMaintenanceMovementId,
      "Standalone maintenance usage approval missing movement id."
    );
    assert(
      created.standaloneMaintenanceExpenseId,
      "Standalone maintenance usage approval missing expense id."
    );

    const mineApproved = await getJson(
      baseUrl,
      "/api/inventory/usage-requests?scope=mine&status=approved",
      mechanicCookie
    );
    assert(
      mineApproved.ok,
      `Failed to query approved usage requests (${mineApproved.status}): ${mineApproved.text}`
    );
    assert(
      usageListContains(mineApproved.json, created.maintenanceUsageRequestId),
      "Maintenance usage request is missing from My Usage Requests (approved)."
    );
    assert(
      usageListContains(mineApproved.json, created.breakdownUsageRequestId),
      "Breakdown usage request is missing from My Usage Requests (approved)."
    );
    assert(
      usageListContains(mineApproved.json, created.standaloneMaintenanceUsageRequestId),
      "Standalone maintenance usage request is missing from My Usage Requests (approved)."
    );

    const [
      maintenanceUsageRow,
      breakdownUsageRow,
      standaloneMaintenanceUsageRow,
      maintenanceMovement,
      breakdownMovement,
      standaloneMaintenanceMovement
    ] =
      await Promise.all([
        prisma.inventoryUsageRequest.findUnique({
          where: { id: created.maintenanceUsageRequestId },
          select: {
            id: true,
            status: true,
            maintenanceRequestId: true,
            breakdownReportId: true,
            approvedMovementId: true
          }
        }),
        prisma.inventoryUsageRequest.findUnique({
          where: { id: created.breakdownUsageRequestId },
          select: {
            id: true,
            status: true,
            maintenanceRequestId: true,
            breakdownReportId: true,
            approvedMovementId: true
          }
        }),
        prisma.inventoryUsageRequest.findUnique({
          where: { id: created.standaloneMaintenanceUsageRequestId },
          select: {
            id: true,
            status: true,
            maintenanceRequestId: true,
            breakdownReportId: true,
            approvedMovementId: true
          }
        }),
        prisma.inventoryMovement.findUnique({
          where: { id: created.maintenanceMovementId },
          select: {
            id: true,
            maintenanceRequestId: true,
            breakdownReportId: true,
            expenseId: true,
            movementType: true
          }
        }),
        prisma.inventoryMovement.findUnique({
          where: { id: created.breakdownMovementId },
          select: {
            id: true,
            maintenanceRequestId: true,
            breakdownReportId: true,
            expenseId: true,
            movementType: true
          }
        }),
        prisma.inventoryMovement.findUnique({
          where: { id: created.standaloneMaintenanceMovementId },
          select: {
            id: true,
            maintenanceRequestId: true,
            breakdownReportId: true,
            expenseId: true,
            movementType: true
          }
        })
      ]);

    assert(
      maintenanceUsageRow?.status === "APPROVED" &&
        maintenanceUsageRow.maintenanceRequestId === maintenanceId &&
        maintenanceUsageRow.breakdownReportId === null,
      "Breakdown-linked maintenance usage linkage did not persist correctly after approval."
    );
    assert(
      breakdownUsageRow?.status === "APPROVED" &&
        breakdownUsageRow.breakdownReportId === breakdownId &&
        breakdownUsageRow.maintenanceRequestId === null,
      "Breakdown usage linkage did not persist correctly after approval."
    );
    assert(
      standaloneMaintenanceUsageRow?.status === "APPROVED" &&
        standaloneMaintenanceUsageRow.maintenanceRequestId === standaloneMaintenanceId &&
        standaloneMaintenanceUsageRow.breakdownReportId === null,
      "Standalone maintenance usage linkage did not persist correctly after approval."
    );
    assert(
      maintenanceMovement?.movementType === "OUT" &&
        maintenanceMovement.maintenanceRequestId === maintenanceId &&
        maintenanceMovement.breakdownReportId === breakdownId &&
        maintenanceMovement.expenseId === created.maintenanceExpenseId,
      "Maintenance movement linkage is inconsistent."
    );
    assert(
      breakdownMovement?.movementType === "OUT" &&
        breakdownMovement.maintenanceRequestId === null &&
        breakdownMovement.breakdownReportId === breakdownId &&
        breakdownMovement.expenseId === created.breakdownExpenseId,
      "Breakdown movement linkage is inconsistent."
    );
    assert(
      standaloneMaintenanceMovement?.movementType === "OUT" &&
        standaloneMaintenanceMovement.maintenanceRequestId === standaloneMaintenanceId &&
        standaloneMaintenanceMovement.breakdownReportId === null &&
        standaloneMaintenanceMovement.expenseId === created.standaloneMaintenanceExpenseId,
      "Standalone maintenance movement linkage is inconsistent."
    );

    const recognizedContext = await buildRecognizedSpendContext({});
    const breakdownLinkedMaintenanceClassified = recognizedContext.classifiedRows.find(
      (row) => row.expenseId === created.maintenanceExpenseId
    );
    const breakdownClassified = recognizedContext.classifiedRows.find(
      (row) => row.expenseId === created.breakdownExpenseId
    );
    const standaloneMaintenanceClassified = recognizedContext.classifiedRows.find(
      (row) => row.expenseId === created.standaloneMaintenanceExpenseId
    );
    assert(
      breakdownLinkedMaintenanceClassified?.purposeBucket === "BREAKDOWN_COST",
      `Breakdown-linked maintenance expense classified incorrectly: ${
        breakdownLinkedMaintenanceClassified?.purposeBucket || "missing"
      }`
    );
    assert(
      breakdownClassified?.purposeBucket === "BREAKDOWN_COST",
      `Breakdown expense classified incorrectly: ${breakdownClassified?.purposeBucket || "missing"}`
    );
    assert(
      standaloneMaintenanceClassified?.purposeBucket === "MAINTENANCE_COST",
      `Standalone maintenance expense classified incorrectly: ${
        standaloneMaintenanceClassified?.purposeBucket || "missing"
      }`
    );

    const resolveMaintenance = await patchJson(baseUrl, "/api/maintenance-requests", adminCookie, {
      id: maintenanceId,
      action: "resolve",
      resolutionNote: `Maintenance completed in smoke ${runToken}`
    });
    assert(
      resolveMaintenance.ok,
      `Maintenance resolve failed (${resolveMaintenance.status}): ${resolveMaintenance.text}`
    );

    const resolveBreakdown = await patchJson(
      baseUrl,
      `/api/breakdowns/${breakdownId}`,
      adminCookie,
      {
        action: "resolve",
        resolutionNote: `Breakdown resolved in smoke ${runToken}`
      }
    );
    assert(
      resolveBreakdown.ok,
      `Breakdown resolve failed (${resolveBreakdown.status}): ${resolveBreakdown.text}`
    );

    const [resolvedProject, resolvedRig] = await Promise.all([
      prisma.project.findUnique({
        where: { id: project.id },
        select: { status: true }
      }),
      prisma.rig.findUnique({
        where: { id: rig.id },
        select: { status: true }
      })
    ]);
    assert(
      resolvedProject?.status === "ACTIVE",
      `Project did not return to ACTIVE after breakdown resolve. Found ${resolvedProject?.status}.`
    );
    assert(
      resolvedRig?.status !== "BREAKDOWN",
      `Rig remained BREAKDOWN after breakdown resolve. Found ${resolvedRig?.status}.`
    );

    console.info("✅ Operational lifecycle smoke checks passed.");
    console.info(
      [
        "• breakdown report -> project/rig state transition",
        "• maintenance linked from breakdown",
        "• maintenance + breakdown usage requests visible in My Usage Requests",
        "• approvals create stock-out movement + recognized expenses",
        "• purpose classification for maintenance/breakdown spend",
        "• maintenance resolve + breakdown resolve lifecycle"
      ].join("\n")
    );
  } finally {
    await cleanup(created);
    await prisma.$disconnect();
  }
}

async function findOperationalProjectCandidate() {
  const candidates = await prisma.project.findMany({
    where: {
      status: "ACTIVE",
      assignedRigId: { not: null }
    },
    select: {
      id: true,
      status: true,
      clientId: true,
      assignedRigId: true
    },
    orderBy: { createdAt: "asc" },
    take: 25
  });

  for (const candidate of candidates) {
    if (!candidate.assignedRigId) {
      continue;
    }
    const openBreakdowns = await prisma.breakdownReport.count({
      where: {
        rigId: candidate.assignedRigId,
        status: { in: [...OPEN_BREAKDOWN_STATUSES] }
      }
    });
    if (openBreakdowns === 0) {
      return candidate;
    }
  }

  return candidates[0] || null;
}

async function ensureServerReachable(baseUrl: string) {
  try {
    const response = await fetch(`${baseUrl}/api/auth/session`, { method: "GET" });
    if (response.status >= 500) {
      throw new Error(`Server responded with ${response.status}`);
    }
  } catch (error) {
    throw new Error(
      `Operational smoke needs a running app server at ${baseUrl}. Start it first (npm run dev). (${formatError(
        error
      )})`
    );
  }
}

async function loginAndGetCookie(baseUrl: string, email: string, password: string) {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password })
  });
  const text = await response.text();
  const payload = safeParseJson(text);
  if (!response.ok) {
    throw new Error(`Login failed for ${email} (${response.status}): ${payload?.message || text}`);
  }
  const setCookie = response.headers.get("set-cookie") || "";
  const cookieMatch = setCookie.match(new RegExp(`${SESSION_COOKIE_NAME}=[^;]+`));
  if (!cookieMatch) {
    throw new Error(`Login succeeded for ${email} but session cookie was not returned.`);
  }
  return cookieMatch[0];
}

async function getJson(baseUrl: string, path: string, cookie: string): Promise<HttpResult> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "GET",
    headers: { Cookie: cookie }
  });
  const text = await response.text();
  return {
    ok: response.ok,
    status: response.status,
    text,
    json: safeParseJson(text)
  };
}

async function postJson(baseUrl: string, path: string, cookie: string, body: unknown): Promise<HttpResult> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie
    },
    body: JSON.stringify(body)
  });
  const text = await response.text();
  return {
    ok: response.ok,
    status: response.status,
    text,
    json: safeParseJson(text)
  };
}

async function patchJson(baseUrl: string, path: string, cookie: string, body: unknown): Promise<HttpResult> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie
    },
    body: JSON.stringify(body)
  });
  const text = await response.text();
  return {
    ok: response.ok,
    status: response.status,
    text,
    json: safeParseJson(text)
  };
}

function usageListContains(payload: Record<string, unknown> | null, usageRequestId: string | null) {
  if (!usageRequestId) {
    return false;
  }
  if (!payload || !Array.isArray(payload.data)) {
    return false;
  }
  return payload.data.some((entry) => {
    if (!entry || typeof entry !== "object") {
      return false;
    }
    return (entry as Record<string, unknown>).id === usageRequestId;
  });
}

async function cleanup(state: CreatedState) {
  if (state.maintenanceUsageRequestId) {
    await prisma.inventoryUsageRequest
      .delete({ where: { id: state.maintenanceUsageRequestId } })
      .catch(() => null);
  }

  if (state.breakdownUsageRequestId) {
    await prisma.inventoryUsageRequest
      .delete({ where: { id: state.breakdownUsageRequestId } })
      .catch(() => null);
  }

  if (state.standaloneMaintenanceUsageRequestId) {
    await prisma.inventoryUsageRequest
      .delete({ where: { id: state.standaloneMaintenanceUsageRequestId } })
      .catch(() => null);
  }

  if (state.maintenanceMovementId) {
    await prisma.inventoryMovement
      .delete({ where: { id: state.maintenanceMovementId } })
      .catch(() => null);
  }

  if (state.breakdownMovementId) {
    await prisma.inventoryMovement
      .delete({ where: { id: state.breakdownMovementId } })
      .catch(() => null);
  }

  if (state.standaloneMaintenanceMovementId) {
    await prisma.inventoryMovement
      .delete({ where: { id: state.standaloneMaintenanceMovementId } })
      .catch(() => null);
  }

  if (state.maintenanceExpenseId) {
    await prisma.expense.delete({ where: { id: state.maintenanceExpenseId } }).catch(() => null);
  }

  if (state.breakdownExpenseId) {
    await prisma.expense.delete({ where: { id: state.breakdownExpenseId } }).catch(() => null);
  }

  if (state.standaloneMaintenanceExpenseId) {
    await prisma.expense
      .delete({ where: { id: state.standaloneMaintenanceExpenseId } })
      .catch(() => null);
  }

  if (state.maintenanceId) {
    await prisma.maintenanceRequest.delete({ where: { id: state.maintenanceId } }).catch(() => null);
  }

  if (state.standaloneMaintenanceId) {
    await prisma.maintenanceRequest
      .delete({ where: { id: state.standaloneMaintenanceId } })
      .catch(() => null);
  }

  if (state.breakdownId) {
    await prisma.breakdownReport.delete({ where: { id: state.breakdownId } }).catch(() => null);
  }

  if (state.itemId && typeof state.itemOriginalStock === "number") {
    await prisma.inventoryItem
      .update({
        where: { id: state.itemId },
        data: { quantityInStock: state.itemOriginalStock }
      })
      .catch(() => null);
  }

  if (state.projectId && state.projectOriginalStatus) {
    await prisma.project
      .update({
        where: { id: state.projectId },
        data: { status: state.projectOriginalStatus }
      })
      .catch(() => null);
  }

  if (state.rigId && state.rigOriginalStatus) {
    await prisma.rig
      .update({
        where: { id: state.rigId },
        data: { status: state.rigOriginalStatus }
      })
      .catch(() => null);
  }
}

function safeParseJson(value: string) {
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function asString(value: string | null | undefined) {
  if (!value) {
    return "";
  }
  return value.trim();
}

function formatError(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

main().catch(async (error) => {
  console.error("❌ Operational lifecycle smoke checks failed.");
  console.error(formatError(error));
  await prisma.$disconnect();
  process.exit(1);
});
