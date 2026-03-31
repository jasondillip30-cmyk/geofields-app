import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const SESSION_COOKIE_NAME = "gf_session";
const DEFAULT_BASE_URL = "http://127.0.0.1:3000";

interface CreatedState {
  drillReportId: string | null;
  expenseId: string | null;
  usageRejectId: string | null;
  usageApproveId: string | null;
  usageApproveMovementId: string | null;
  receiptSubmissionId: string | null;
  receiptExpenseId: string | null;
  inventoryItemId: string | null;
  inventoryItemOriginalStock: number | null;
}

async function main() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Smoke workflow script must not run in production mode.");
  }

  const baseUrl = (process.env.SMOKE_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, "");
  const adminEmail = process.env.SMOKE_ADMIN_EMAIL || "admin@geofields.co.tz";
  const adminPassword = process.env.SMOKE_ADMIN_PASSWORD || "Admin123!";
  const mechanicEmail = process.env.SMOKE_MECHANIC_EMAIL || "mechanic@geofields.co.tz";
  const mechanicPassword = process.env.SMOKE_MECHANIC_PASSWORD || "Mechanic123!";
  const runToken = `smoke-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

  const created: CreatedState = {
    drillReportId: null,
    expenseId: null,
    usageRejectId: null,
    usageApproveId: null,
    usageApproveMovementId: null,
    receiptSubmissionId: null,
    receiptExpenseId: null,
    inventoryItemId: null,
    inventoryItemOriginalStock: null
  };

  try {
    await ensureServerReachable(baseUrl);

    const adminCookie = await loginAndGetCookie(baseUrl, adminEmail, adminPassword);
    const mechanicCookie = await loginAndGetCookie(baseUrl, mechanicEmail, mechanicPassword);

    const [adminUser, mechanicUser, client, project, rig, inventoryItem, supplier] = await Promise.all([
      prisma.user.findUnique({ where: { email: adminEmail.toLowerCase() }, select: { id: true, role: true } }),
      prisma.user.findUnique({ where: { email: mechanicEmail.toLowerCase() }, select: { id: true, role: true } }),
      prisma.client.findFirst({ select: { id: true } }),
      prisma.project.findFirst({ select: { id: true, clientId: true, assignedRigId: true } }),
      prisma.rig.findFirst({ select: { id: true, rigCode: true } }),
      prisma.inventoryItem.findFirst({
        where: { quantityInStock: { gte: 5 } },
        select: { id: true, quantityInStock: true, locationId: true }
      }),
      prisma.inventorySupplier.findFirst({ select: { id: true, name: true } })
    ]);

    if (!adminUser || !mechanicUser || !client || !project || !rig || !inventoryItem) {
      throw new Error("Smoke prerequisites missing. Seed baseline data first (users/client/project/rig/inventory).");
    }

    created.inventoryItemId = inventoryItem.id;
    created.inventoryItemOriginalStock = inventoryItem.quantityInStock;

    const drillReport = await prisma.drillReport.create({
      data: {
        date: new Date(),
        clientId: project.clientId || client.id,
        projectId: project.id,
        rigId: rig.id,
        submittedById: mechanicUser.id,
        submittedAt: new Date(),
        approvalStatus: "SUBMITTED",
        holeNumber: `${runToken}-hole`,
        areaLocation: "Smoke Test Area",
        fromMeter: 0,
        toMeter: 10,
        totalMetersDrilled: 10,
        workHours: 1,
        rigMoves: 0,
        standbyHours: 0,
        delayHours: 0,
        comments: `smoke test ${runToken}`,
        operatorCrew: "Smoke Crew",
        billableAmount: 1000
      },
      select: { id: true }
    });
    created.drillReportId = drillReport.id;

    const drillApproval = await postJson(baseUrl, `/api/drilling-reports/${drillReport.id}/status`, adminCookie, {
      action: "approve"
    });
    assert(drillApproval.ok, `Drilling approval failed (${drillApproval.status}): ${drillApproval.text}`);
    assert(drillApproval.json?.data?.approvalStatus === "APPROVED", "Drilling report did not move to APPROVED.");

    const expense = await prisma.expense.create({
      data: {
        date: new Date(),
        amount: 2500,
        category: "MISC",
        subcategory: "SMOKE_TEST",
        entrySource: "MANUAL",
        vendor: "Smoke Vendor",
        notes: `smoke test ${runToken}`,
        enteredByUserId: mechanicUser.id,
        approvalStatus: "SUBMITTED",
        submittedAt: new Date(),
        clientId: client.id,
        projectId: project.id,
        rigId: rig.id
      },
      select: { id: true }
    });
    created.expenseId = expense.id;

    const expenseApproval = await postJson(baseUrl, `/api/expenses/${expense.id}/status`, adminCookie, {
      action: "approve"
    });
    assert(expenseApproval.ok, `Expense approval failed (${expenseApproval.status}): ${expenseApproval.text}`);
    assert(expenseApproval.json?.data?.approvalStatus === "APPROVED", "Expense did not move to APPROVED.");

    const usageReject = await prisma.inventoryUsageRequest.create({
      data: {
        itemId: inventoryItem.id,
        quantity: 1,
        reason: `smoke reject ${runToken}`,
        projectId: project.id,
        rigId: rig.id,
        locationId: inventoryItem.locationId,
        requestedById: mechanicUser.id,
        status: "SUBMITTED"
      },
      select: { id: true }
    });
    created.usageRejectId = usageReject.id;

    const rejectResult = await postJson(
      baseUrl,
      `/api/inventory/usage-requests/${usageReject.id}/status`,
      adminCookie,
      { action: "reject", note: "Smoke test rejection" }
    );
    assert(rejectResult.ok, `Inventory usage reject failed (${rejectResult.status}): ${rejectResult.text}`);
    const usageRejectRow = await prisma.inventoryUsageRequest.findUnique({
      where: { id: usageReject.id },
      select: { status: true, approvedMovementId: true }
    });
    assert(usageRejectRow?.status === "REJECTED", "Rejected usage request did not remain in REJECTED state.");
    assert(!usageRejectRow?.approvedMovementId, "Rejected usage request should not create stock movement.");

    const usageApprove = await prisma.inventoryUsageRequest.create({
      data: {
        itemId: inventoryItem.id,
        quantity: 1,
        reason: `smoke approve ${runToken}`,
        projectId: project.id,
        rigId: rig.id,
        locationId: inventoryItem.locationId,
        requestedById: mechanicUser.id,
        status: "SUBMITTED"
      },
      select: { id: true }
    });
    created.usageApproveId = usageApprove.id;

    const approveResult = await postJson(
      baseUrl,
      `/api/inventory/usage-requests/${usageApprove.id}/status`,
      adminCookie,
      { action: "approve", note: "Smoke test approval" }
    );
    assert(approveResult.ok, `Inventory usage approve failed (${approveResult.status}): ${approveResult.text}`);
    created.usageApproveMovementId =
      typeof approveResult.json?.movementId === "string" ? approveResult.json.movementId : null;
    assert(Boolean(created.usageApproveMovementId), "Approved usage request did not return movementId.");

    const usageApproveRow = await prisma.inventoryUsageRequest.findUnique({
      where: { id: usageApprove.id },
      select: { status: true, approvedMovementId: true }
    });
    assert(usageApproveRow?.status === "APPROVED", "Approved usage request did not move to APPROVED.");
    assert(Boolean(usageApproveRow?.approvedMovementId), "Approved usage request missing approvedMovementId.");

    const itemAfterApproval = await prisma.inventoryItem.findUnique({
      where: { id: inventoryItem.id },
      select: { quantityInStock: true }
    });
    assert(
      typeof itemAfterApproval?.quantityInStock === "number" &&
        itemAfterApproval.quantityInStock === inventoryItem.quantityInStock - 1,
      "Inventory stock was not decremented correctly for approved usage request."
    );

    const receiptPayload = {
      receiptType: "EXPENSE_ONLY",
      receiptPurpose: "BUSINESS_EXPENSE_ONLY",
      createExpense: true,
      expenseOnlyCategory: "MISC",
      receipt: {
        supplierId: supplier?.id || null,
        supplierName: supplier?.name || "Smoke Supplier",
        receiptNumber: `${runToken}-receipt`,
        receiptDate: new Date().toISOString().slice(0, 10),
        total: 1450
      },
      linkContext: {
        clientId: client.id,
        projectId: project.id,
        rigId: rig.id
      },
      lines: []
    };

    const submissionResult = await postJson(
      baseUrl,
      "/api/inventory/receipt-intake/commit",
      mechanicCookie,
      receiptPayload
    );
    assert(submissionResult.ok, `Receipt submission failed (${submissionResult.status}): ${submissionResult.text}`);
    assert(
      submissionResult.json?.data?.submissionStatus === "PENDING_REVIEW",
      "Receipt submission did not land in PENDING_REVIEW."
    );

    const submissionId = submissionResult.json?.data?.submissionId;
    assert(typeof submissionId === "string" && submissionId.length > 0, "Receipt submissionId missing.");
    created.receiptSubmissionId = submissionId;

    const finalizeResult = await postJson(
      baseUrl,
      "/api/inventory/receipt-intake/commit",
      adminCookie,
      {
        ...receiptPayload,
        submissionId
      }
    );
    assert(finalizeResult.ok, `Receipt finalization failed (${finalizeResult.status}): ${finalizeResult.text}`);
    assert(
      finalizeResult.json?.data?.submissionStatus === "FINALIZED",
      "Receipt finalization did not set FINALIZED submission status."
    );

    const submissionDetails = await getJson(
      baseUrl,
      `/api/inventory/receipt-intake/submissions/${submissionId}`,
      adminCookie
    );
    assert(submissionDetails.ok, `Receipt submission detail fetch failed (${submissionDetails.status}): ${submissionDetails.text}`);
    assert(submissionDetails.json?.data?.status === "APPROVED", "Finalized receipt submission did not move to APPROVED.");

    const resolvedExpenseId = submissionDetails.json?.data?.resolution?.expenseId;
    if (typeof resolvedExpenseId === "string" && resolvedExpenseId.length > 0) {
      created.receiptExpenseId = resolvedExpenseId;
    }

    console.info("✅ Critical workflow smoke checks passed.");
    console.info(
      [
        "• drilling approval",
        "• expense approval",
        "• inventory usage reject",
        "• inventory usage approve",
        "• receipt submission + finalization"
      ].join("\n")
    );
  } finally {
    await cleanup(created);
    await prisma.$disconnect();
  }
}

async function ensureServerReachable(baseUrl: string) {
  try {
    const response = await fetch(`${baseUrl}/api/auth/session`, { method: "GET" });
    if (response.status >= 500) {
      throw new Error(`Server responded with ${response.status}`);
    }
  } catch (error) {
    throw new Error(
      `Smoke tests need a running app server at ${baseUrl}. Start it first (for example: npm run dev). (${formatError(error)})`
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
  const json = safeParseJson(text);
  if (!response.ok) {
    throw new Error(`Login failed for ${email} (${response.status}): ${json?.message || text}`);
  }
  const setCookie = response.headers.get("set-cookie") || "";
  const cookieMatch = setCookie.match(new RegExp(`${SESSION_COOKIE_NAME}=[^;]+`));
  if (!cookieMatch) {
    throw new Error(`Login succeeded for ${email} but session cookie was not returned.`);
  }
  return cookieMatch[0];
}

async function postJson(baseUrl: string, path: string, cookie: string, body: unknown) {
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

async function getJson(baseUrl: string, path: string, cookie: string) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "GET",
    headers: {
      Cookie: cookie
    }
  });
  const text = await response.text();
  return {
    ok: response.ok,
    status: response.status,
    text,
    json: safeParseJson(text)
  };
}

async function cleanup(created: CreatedState) {
  if (created.receiptSubmissionId) {
    await prisma.summaryReport
      .delete({
        where: { id: created.receiptSubmissionId }
      })
      .catch(() => null);
  }

  if (created.receiptExpenseId) {
    await prisma.expense
      .delete({
        where: { id: created.receiptExpenseId }
      })
      .catch(() => null);
  }

  if (created.usageApproveMovementId) {
    await prisma.inventoryMovement
      .delete({
        where: { id: created.usageApproveMovementId }
      })
      .catch(() => null);
  }

  if (created.usageRejectId) {
    await prisma.inventoryUsageRequest
      .delete({
        where: { id: created.usageRejectId }
      })
      .catch(() => null);
  }

  if (created.usageApproveId) {
    await prisma.inventoryUsageRequest
      .delete({
        where: { id: created.usageApproveId }
      })
      .catch(() => null);
  }

  if (created.expenseId) {
    await prisma.expense
      .delete({
        where: { id: created.expenseId }
      })
      .catch(() => null);
  }

  if (created.drillReportId) {
    await prisma.drillReport
      .delete({
        where: { id: created.drillReportId }
      })
      .catch(() => null);
  }

  if (created.inventoryItemId && typeof created.inventoryItemOriginalStock === "number") {
    await prisma.inventoryItem
      .update({
        where: { id: created.inventoryItemId },
        data: { quantityInStock: created.inventoryItemOriginalStock }
      })
      .catch(() => null);
  }
}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function safeParseJson(value: string) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function formatError(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

main().catch(async (error) => {
  console.error("❌ Critical workflow smoke checks failed.");
  console.error(formatError(error));
  await prisma.$disconnect();
  process.exit(1);
});
