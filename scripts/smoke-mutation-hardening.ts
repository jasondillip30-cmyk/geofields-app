import { PrismaClient } from "@prisma/client";

import {
  parsePurchaseRequisitionPayload,
  PURCHASE_REQUISITION_REPORT_TYPE
} from "../src/lib/requisition-workflow";
import { purgeDanglingSmokeArtifacts } from "./smoke-isolation";

const prisma = new PrismaClient();

const SESSION_COOKIE_NAME = "gf_session";
const DEFAULT_BASE_URL = "http://127.0.0.1:3000";

interface HttpResult {
  ok: boolean;
  status: number;
  text: string;
  json: Record<string, unknown> | null;
}

interface CreatedState {
  expenseId: string | null;
  requisitionId: string | null;
}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function safeParseJson(text: string) {
  try {
    return JSON.parse(text) as Record<string, unknown>;
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

async function ensureServerReachable(baseUrl: string) {
  try {
    const response = await fetch(`${baseUrl}/api/auth/session`, { method: "GET" });
    if (response.status >= 500) {
      throw new Error(`Server responded with ${response.status}`);
    }
  } catch (error) {
    throw new Error(
      `Mutation hardening smoke needs a running app server at ${baseUrl}. Start it first (npm run dev). (${formatError(
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
    throw new Error(`Login succeeded for ${email} but no session cookie returned.`);
  }
  return cookieMatch[0];
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

async function main() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Mutation hardening smoke must not run in production.");
  }

  const baseUrl = (process.env.SMOKE_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, "");
  const adminEmail = process.env.SMOKE_ADMIN_EMAIL || "admin@geofields.co.tz";
  const adminPassword = process.env.SMOKE_ADMIN_PASSWORD || "Admin123!";
  const runToken = `mut-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

  const created: CreatedState = {
    expenseId: null,
    requisitionId: null
  };

  try {
    await purgeDanglingSmokeArtifacts(prisma);
    await ensureServerReachable(baseUrl);

    const adminCookie = await loginAndGetCookie(baseUrl, adminEmail, adminPassword);
    const [adminUser, project] = await Promise.all([
      prisma.user.findUnique({
        where: { email: adminEmail.toLowerCase() },
        select: { id: true }
      }),
      prisma.project.findFirst({
        select: { id: true, clientId: true, assignedRigId: true }
      })
    ]);

    if (!adminUser) {
      throw new Error("Missing admin user in database.");
    }
    if (!project) {
      throw new Error("Missing project seed data for mutation hardening smoke.");
    }

    const expense = await prisma.expense.create({
      data: {
        date: new Date(),
        amount: 987,
        category: "MISC",
        subcategory: `Mutation ${runToken}`,
        entrySource: "MANUAL",
        vendor: "Mutation Smoke Vendor",
        notes: `mutation smoke ${runToken}`,
        enteredByUserId: adminUser.id,
        approvalStatus: "SUBMITTED",
        submittedAt: new Date(),
        clientId: project.clientId,
        projectId: project.id,
        rigId: project.assignedRigId
      },
      select: { id: true }
    });
    created.expenseId = expense.id;

    const [expenseApprove, expenseReject] = await Promise.all([
      postJson(baseUrl, `/api/expenses/${expense.id}/status`, adminCookie, { action: "approve" }),
      postJson(baseUrl, `/api/expenses/${expense.id}/status`, adminCookie, {
        action: "reject",
        reason: "mutation race reject"
      })
    ]);

    const expenseStatuses = [expenseApprove.status, expenseReject.status].sort((a, b) => a - b);
    assert(
      expenseStatuses[0] === 200 && expenseStatuses[1] === 409,
      `Expense race expected [200,409], got [${expenseStatuses.join(",")}] with responses: approve=${expenseApprove.text} reject=${expenseReject.text}`
    );

    const expenseAfterRace = await prisma.expense.findUnique({
      where: { id: expense.id },
      select: { approvalStatus: true }
    });
    assert(
      expenseAfterRace?.approvalStatus === "APPROVED" ||
        expenseAfterRace?.approvalStatus === "REJECTED",
      `Expense race left invalid status: ${expenseAfterRace?.approvalStatus || "missing"}`
    );

    const requisitionTemplateRow = await prisma.summaryReport.findFirst({
      where: { reportType: PURCHASE_REQUISITION_REPORT_TYPE },
      orderBy: [{ reportDate: "desc" }, { createdAt: "desc" }]
    });
    if (!requisitionTemplateRow) {
      throw new Error("Missing requisition template data for mutation hardening smoke.");
    }

    const parsedTemplate = parsePurchaseRequisitionPayload(requisitionTemplateRow.payloadJson);
    if (!parsedTemplate) {
      throw new Error("Requisition template payload is invalid.");
    }

    const nowIso = new Date().toISOString();
    const payload = {
      ...parsedTemplate.payload,
      requisitionCode: `REQ-${runToken}`,
      status: "SUBMITTED" as const,
      submittedAt: nowIso,
      submittedBy: {
        userId: adminUser.id,
        name: "Mutation Smoke Admin",
        role: "ADMIN"
      },
      approval: {
        ...parsedTemplate.payload.approval,
        approvedAt: null,
        approvedBy: null,
        rejectedAt: null,
        rejectedBy: null,
        rejectionReason: null
      },
      purchase: {
        ...parsedTemplate.payload.purchase,
        receiptSubmissionId: null,
        receiptNumber: null,
        supplierName: null,
        expenseId: null,
        movementCount: 0,
        postedAt: null
      },
      totals: {
        ...parsedTemplate.payload.totals,
        actualPostedCost: 0
      }
    };

    const createdRequisition = await prisma.summaryReport.create({
      data: {
        reportType: PURCHASE_REQUISITION_REPORT_TYPE,
        reportDate: new Date(),
        payloadJson: JSON.stringify(payload),
        clientId: payload.context.clientId,
        projectId: payload.context.projectId
      },
      select: { id: true }
    });
    created.requisitionId = createdRequisition.id;

    const [requisitionApprove, requisitionReject] = await Promise.all([
      postJson(baseUrl, `/api/requisitions/${createdRequisition.id}/status`, adminCookie, {
        action: "approve"
      }),
      postJson(baseUrl, `/api/requisitions/${createdRequisition.id}/status`, adminCookie, {
        action: "reject",
        reason: "mutation race reject"
      })
    ]);

    const requisitionStatuses = [requisitionApprove.status, requisitionReject.status].sort(
      (a, b) => a - b
    );
    assert(
      requisitionStatuses[0] === 200 && requisitionStatuses[1] === 409,
      `Requisition race expected [200,409], got [${requisitionStatuses.join(",")}] with responses: approve=${requisitionApprove.text} reject=${requisitionReject.text}`
    );

    const requisitionAfterRace = await prisma.summaryReport.findUnique({
      where: { id: createdRequisition.id },
      select: { payloadJson: true }
    });
    if (!requisitionAfterRace) {
      throw new Error("Requisition row disappeared during mutation race test.");
    }
    const parsedAfterRace = parsePurchaseRequisitionPayload(requisitionAfterRace.payloadJson);
    if (!parsedAfterRace) {
      throw new Error("Requisition payload became invalid after mutation race test.");
    }
    assert(
      parsedAfterRace.payload.status === "APPROVED" ||
        parsedAfterRace.payload.status === "REJECTED",
      `Requisition race left invalid status: ${parsedAfterRace.payload.status}`
    );

    console.info("✅ Mutation hardening smoke checks passed.");
    console.info(
      [
        "• expense approve/reject race returns deterministic conflict",
        "• requisition approve/reject race returns deterministic conflict"
      ].join("\n")
    );
  } finally {
    if (created.expenseId) {
      await prisma.expense.delete({ where: { id: created.expenseId } }).catch(() => null);
    }
    if (created.requisitionId) {
      await prisma.summaryReport.delete({ where: { id: created.requisitionId } }).catch(() => null);
    }
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error("❌ Mutation hardening smoke checks failed.");
  console.error(formatError(error));
  process.exit(1);
});
