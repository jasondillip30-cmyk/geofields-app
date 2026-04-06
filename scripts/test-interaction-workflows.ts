import { PrismaClient } from "@prisma/client";
import { chromium, type BrowserContext, type Page } from "playwright";

const prisma = new PrismaClient();

const SESSION_COOKIE_NAME = "gf_session";
const DEFAULT_BASE_URL = "http://127.0.0.1:3000";
const DEFAULT_ADMIN_EMAIL = "admin@geofields.co.tz";
const DEFAULT_ADMIN_PASSWORD = "Admin123!";

interface InteractionFixtures {
  maintenanceRequestId: string | null;
  maintenanceRequestCode: string;
  expenseId: string | null;
  expenseSubcategory: string;
  requisitionId: string | null;
  requisitionCode: string;
  projectId: string;
  clientId: string;
  rigId: string;
  itemId: string;
}

async function main() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Interaction workflow tests must not run in production mode.");
  }

  const baseUrl = (process.env.INTERACTION_BASE_URL || process.env.SMOKE_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, "");
  const adminEmail = process.env.SMOKE_ADMIN_EMAIL || DEFAULT_ADMIN_EMAIL;
  const adminPassword = process.env.SMOKE_ADMIN_PASSWORD || DEFAULT_ADMIN_PASSWORD;
  const runToken = `interaction-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

  await ensureServerReachable(baseUrl);
  const sessionCookie = await loginAndGetCookie(baseUrl, adminEmail, adminPassword);

  let fixtures: InteractionFixtures | null = null;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;
  let context: BrowserContext | null = null;

  try {
    fixtures = await createFixtures(baseUrl, sessionCookie, runToken);

    browser = await chromium.launch({ headless: true });
    context = await browser.newContext();
    await setSessionCookie(context, baseUrl, sessionCookie);

    const page = await context.newPage();

    await runStep("inventory manual movement modal interaction", async () => {
      await testManualMovementModal(page, baseUrl, fixtures!);
    });

    await runStep("inventory issue workflow modal progression", async () => {
      await testIssueWorkflowModal(page, baseUrl, fixtures!);
    });

    await runStep("receipt intake staged flow + finalize validation", async () => {
      await testReceiptIntakeStageFlow(page, baseUrl, fixtures!);
    });

    await runStep("expense status action UI pending/decision behavior", async () => {
      await testExpenseStatusActions(page, baseUrl, fixtures!);
    });

    await runStep("requisition status action UI validation + approve flow", async () => {
      await testRequisitionStatusActions(page, baseUrl, fixtures!);
    });

    console.log("[interaction] all interaction workflow checks passed.");
  } finally {
    if (context) {
      await context.close();
    }
    if (browser) {
      await browser.close();
    }
    if (fixtures) {
      await cleanupFixtures(fixtures);
    }
    await prisma.$disconnect();
  }
}

async function testManualMovementModal(page: Page, baseUrl: string, fixtures: InteractionFixtures) {
  await page.goto(`${baseUrl}/inventory/stock-movements`, { waitUntil: "networkidle" });
  await page.getByText("Movement History").first().waitFor({ state: "visible" });

  await page.getByRole("button", { name: "New Manual Adjustment" }).click();
  const modal = page.getByTestId("inventory-manual-movement-modal");
  await modal.waitFor({ state: "visible" });

  const submitButton = modal.getByTestId("manual-movement-submit");
  assert(await submitButton.isDisabled(), "Manual movement submit should be disabled before required fields are set.");

  await modal.getByLabel("Item").selectOption(fixtures.itemId);
  await modal.getByLabel("Quantity").fill("1");
  assert(!(await submitButton.isDisabled()), "Manual movement submit should enable after item + quantity are provided.");

  let createCalls = 0;
  await page.route("**/api/inventory/movements", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    createCalls += 1;
    await sleep(500);
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({ data: { id: `mock-movement-${Date.now().toString(36)}` } })
    });
  });

  await submitButton.click();
  await submitButton.click().catch(() => undefined);
  await waitFor(() => createCalls > 0, 10_000, "Manual movement request was not sent.");
  await modal.waitFor({ state: "hidden" });
  await page.unroute("**/api/inventory/movements");

  assert(createCalls === 1, `Manual movement submit should issue exactly one POST request (got ${createCalls}).`);
}

async function testIssueWorkflowModal(page: Page, baseUrl: string, fixtures: InteractionFixtures) {
  await page.goto(`${baseUrl}/inventory/issues`, { waitUntil: "networkidle" });
  await page.getByText("Issue Queue").first().waitFor({ state: "visible" });

  await page.getByPlaceholder("Item, maintenance code, movement, linkage").fill(fixtures.maintenanceRequestCode);

  const issueCardByCode = page.locator("article").filter({ hasText: fixtures.maintenanceRequestCode }).first();
  const issueCardFallback = page
    .locator("article")
    .filter({ hasText: "Maintenance request missing inventory linkage" })
    .first();
  const issueCard = (await issueCardByCode.count()) > 0 ? issueCardByCode : issueCardFallback;
  await issueCard.waitFor({ state: "visible" });

  await issueCard.getByRole("button", { name: "View Context" }).click();
  const modal = page.locator("section").filter({ hasText: "Issue Workflow" }).first();
  await modal.waitFor({ state: "visible" });
  await modal.getByText("Step 1 of 3").first().waitFor({ state: "visible" });

  await modal.getByRole("button", { name: "Continue" }).click();
  await modal.getByText("Step 2 of 3").first().waitFor({ state: "visible" });

  await modal.getByRole("button", { name: "Continue" }).click();
  await modal.getByText("Step 3 of 3").first().waitFor({ state: "visible" });

  await modal.getByRole("button", { name: "Back" }).click();
  await modal.getByText("Step 2 of 3").first().waitFor({ state: "visible" });

  await modal.getByRole("button", { name: "Continue" }).click();
  await modal.getByText("Step 3 of 3").first().waitFor({ state: "visible" });

  await modal.getByRole("button", { name: "Submit" }).click();
  await modal.waitFor({ state: "hidden" });
}

async function testReceiptIntakeStageFlow(page: Page, baseUrl: string, fixtures: InteractionFixtures) {
  const requisitionPrefillQuery = new URLSearchParams({
    requisitionId: fixtures.requisitionId || "",
    requisitionType: "LIVE_PROJECT_PURCHASE",
    requisitionCode: fixtures.requisitionCode,
    projectId: fixtures.projectId,
    clientId: fixtures.clientId,
    rigId: fixtures.rigId
  });
  await page.goto(`${baseUrl}/inventory/receipt-intake?${requisitionPrefillQuery.toString()}`, {
    waitUntil: "networkidle"
  });
  const manualIntakeButton = page.getByRole("button", { name: "Manual intake" }).first();
  await manualIntakeButton.waitFor({ state: "visible" });

  const projectPurchaseButton = page.getByRole("button", { name: "Project Purchase" }).first();
  if (await projectPurchaseButton.isVisible().catch(() => false)) {
    await projectPurchaseButton.click();
  }
  await manualIntakeButton.click();

  const continueToItemsButton = page.getByRole("button", { name: "Continue to items" }).first();
  if (!(await continueToItemsButton.isVisible().catch(() => false))) {
    if (await projectPurchaseButton.isVisible().catch(() => false)) {
      await projectPurchaseButton.click();
    }
    await manualIntakeButton.click();
  }
  await continueToItemsButton.waitFor({ state: "visible" });
  await continueToItemsButton.click();

  const reviewStep = page.getByText("Step 2: Confirm items from requisition").first();
  await reviewStep.waitFor({ state: "visible" });

  const continueToFinalize = page.getByRole("button", { name: "Continue to finalize" });
  if (!(await continueToFinalize.isVisible().catch(() => false))) {
    const continueToInventory = page.getByRole("button", { name: "Continue to inventory" });
    if (await continueToInventory.isVisible().catch(() => false)) {
      await continueToInventory.click();
    }
  }
  await page.getByRole("button", { name: "Continue to finalize" }).click();

  await page.getByText("Step 4: Review and finalize posting").first().waitFor({ state: "visible" });
  await page.getByRole("button", { name: "Finalize posting" }).click();
  await page.getByText(/before saving/i).first().waitFor({ state: "visible" });
}

async function testExpenseStatusActions(page: Page, baseUrl: string, fixtures: InteractionFixtures) {
  await page.goto(`${baseUrl}/inventory/expenses`, { waitUntil: "networkidle" });
  await page.getByText("Expense Queue").first().waitFor({ state: "visible" });

  await page.getByRole("button", { name: /Pending approval/i }).click();
  const expenseCard = page.locator("article").filter({ hasText: fixtures.expenseSubcategory }).first();
  await expenseCard.waitFor({ state: "visible" });
  await expenseCard.getByRole("button", { name: "Review Expense" }).click();

  const modal = page.locator("section").filter({ hasText: "Expense Review" }).first();
  await modal.waitFor({ state: "visible" });
  await modal.getByText("Step 1 of 3").first().waitFor({ state: "visible" });

  await modal.getByRole("button", { name: "Continue" }).click();
  await modal.getByText("Step 2 of 3").first().waitFor({ state: "visible" });

  await modal.getByRole("button", { name: "Continue" }).click();
  await modal.getByText("Step 3 of 3").first().waitFor({ state: "visible" });

  let decisionCalls = 0;
  const decisionUrl = `**/api/expenses/${fixtures.expenseId}/status`;
  await page.route(decisionUrl, async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    decisionCalls += 1;
    await sleep(500);
    await route.continue();
  });

  const approveButton = modal.getByRole("button", { name: "Approve Expense" });
  await approveButton.click();
  await modal.getByRole("button", { name: "Approving..." }).waitFor({ state: "visible" });
  assert(await modal.getByRole("button", { name: "Approving..." }).isDisabled(), "Expense approve button should be disabled while request is pending.");
  await modal.getByText("Expense approved successfully.").first().waitFor({ state: "visible" });
  await page.unroute(decisionUrl);

  assert(decisionCalls === 1, `Expense decision should issue exactly one POST request (got ${decisionCalls}).`);
  await modal.getByRole("button", { name: "Close expense detail" }).click();
  await modal.waitFor({ state: "hidden" });
}

async function testRequisitionStatusActions(page: Page, baseUrl: string, fixtures: InteractionFixtures) {
  await page.goto(`${baseUrl}/approvals`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Purchase Requisitions" }).first().waitFor({ state: "visible" });

  const row = page.locator("tr").filter({ hasText: fixtures.requisitionCode }).first();
  await row.waitFor({ state: "visible" });

  await row.getByRole("button", { name: "Reject" }).click();
  await page.getByText("Please enter a rejection reason (minimum 3 characters).").first().waitFor({ state: "visible" });

  await row.getByPlaceholder("Optional rejection reason").fill("Interaction validation note");

  let statusCalls = 0;
  const statusUrl = `**/api/requisitions/${fixtures.requisitionId}/status`;
  await page.route(statusUrl, async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    statusCalls += 1;
    await sleep(500);
    await route.continue();
  });

  const approveButton = row.getByRole("button", { name: "Approve" });
  await approveButton.click();
  await sleep(80);
  assert(await approveButton.isDisabled(), "Requisition action buttons should be disabled while approval request is in flight.");
  await page.getByText("Purchase requisition approved.").first().waitFor({ state: "visible" });
  await page.unroute(statusUrl);

  assert(statusCalls === 1, `Requisition status update should issue exactly one POST request (got ${statusCalls}).`);
}

async function createFixtures(baseUrl: string, sessionCookie: string, runToken: string): Promise<InteractionFixtures> {
  const adminUser = await prisma.user.findUnique({
    where: { email: DEFAULT_ADMIN_EMAIL.toLowerCase() },
    select: { id: true, fullName: true }
  });
  const mechanic = await prisma.mechanic.findFirst({
    select: { id: true }
  });
  const projectCandidates = await prisma.project.findMany({
    take: 25,
    orderBy: [{ createdAt: "desc" }],
    select: { id: true, name: true, clientId: true, assignedRigId: true }
  });
  const project = projectCandidates.find((entry) => Boolean(entry.clientId)) || null;
  const rig = project?.assignedRigId
    ? await prisma.rig.findUnique({ where: { id: project.assignedRigId }, select: { id: true, rigCode: true } })
    : await prisma.rig.findFirst({ select: { id: true, rigCode: true } });
  const item = await prisma.inventoryItem.findFirst({
    where: { quantityInStock: { gte: 2 } },
    select: { id: true }
  });

  if (!adminUser || !mechanic || !project || !rig || !item) {
    throw new Error("Interaction test prerequisites missing. Seed users/project/rig/item first.");
  }

  const maintenanceRequestCode = `MR-IT-${Date.now().toString(36).toUpperCase()}`;
  const maintenanceRequest = await prisma.maintenanceRequest.create({
    data: {
      requestCode: maintenanceRequestCode,
      requestDate: new Date(),
      rigId: rig.id,
      clientId: project.clientId,
      projectId: project.id,
      mechanicId: mechanic.id,
      maintenanceType: "Routine Maintenance",
      issueDescription: `Interaction test maintenance ${runToken}`,
      materialsNeeded: "Pending parts linkage",
      urgency: "HIGH",
      photoUrls: "",
      notes: `interaction fixture ${runToken}`,
      status: "IN_REPAIR",
      estimatedDowntimeHrs: 2
    },
    select: { id: true, requestCode: true }
  });

  const expenseSubcategory = `interaction-expense-${runToken}`;
  const expense = await prisma.expense.create({
    data: {
      date: new Date(),
      amount: 9876.54,
      category: "MISC",
      subcategory: expenseSubcategory,
      entrySource: "MANUAL",
      vendor: `Interaction Vendor ${runToken}`,
      notes: `interaction fixture ${runToken}`,
      enteredByUserId: adminUser.id,
      submittedAt: new Date(),
      approvalStatus: "SUBMITTED",
      clientId: project.clientId,
      projectId: project.id,
      rigId: rig.id
    },
    select: { id: true }
  });

  const setupResponse = await getJson(baseUrl, "/api/requisitions/setup", sessionCookie);
  const setupRoot = asRecord(setupResponse.json);
  const setupData = asRecord(setupRoot?.data);
  const categories = (Array.isArray(setupData?.categories) ? setupData.categories : [])
    .map((entry) => asRecord(entry))
    .filter((entry): entry is Record<string, unknown> => Boolean(entry));
  if (categories.length === 0 || typeof categories[0]?.id !== "string") {
    throw new Error("No requisition categories are configured; cannot create requisition fixture.");
  }

  const categoryId = String(categories[0].id);
  const subcategories = (Array.isArray(setupData?.subcategories) ? setupData.subcategories : [])
    .map((entry) => asRecord(entry))
    .filter((entry): entry is Record<string, unknown> => Boolean(entry));
  const matchingSubcategory = subcategories.find((entry) => asString(entry.categoryId) === categoryId);

  const requisitionCreateResponse = await postJson(baseUrl, "/api/requisitions", sessionCookie, {
    type: "LIVE_PROJECT_PURCHASE",
    projectId: project.id,
    categoryId,
    subcategoryId: asString(matchingSubcategory?.id) || null,
    requestedVendorName: `Interaction Supplier ${runToken}`,
    lineItems: [
      {
        description: `Interaction requisition ${runToken}`,
        quantity: 1,
        estimatedUnitCost: 1200,
        estimatedTotalCost: 1200
      }
    ],
    notes: `interaction fixture ${runToken}`
  });
  if (!requisitionCreateResponse.ok) {
    throw new Error(
      `Failed to create requisition fixture (${requisitionCreateResponse.status}): ${requisitionCreateResponse.text}`
    );
  }

  const requisitionRoot = asRecord(requisitionCreateResponse.json);
  const requisitionData = asRecord(requisitionRoot?.data);
  const requisitionId = asString(requisitionData?.id);
  const requisitionCode = asString(requisitionData?.requisitionCode);
  if (!requisitionId || !requisitionCode) {
    throw new Error("Requisition fixture response did not include id/requisitionCode.");
  }

  return {
    maintenanceRequestId: maintenanceRequest.id,
    maintenanceRequestCode: maintenanceRequest.requestCode,
    expenseId: expense.id,
    expenseSubcategory,
    requisitionId,
    requisitionCode,
    projectId: project.id,
    clientId: project.clientId || "",
    rigId: rig.id,
    itemId: item.id
  };
}

async function cleanupFixtures(fixtures: InteractionFixtures) {
  try {
    if (fixtures.requisitionId) {
      await prisma.summaryReport.deleteMany({ where: { id: fixtures.requisitionId } });
      await prisma.auditLog.deleteMany({ where: { entityId: fixtures.requisitionId } });
    }
    if (fixtures.expenseId) {
      await prisma.inventoryMovement.updateMany({
        where: { expenseId: fixtures.expenseId },
        data: { expenseId: null }
      });
      await prisma.expense.deleteMany({ where: { id: fixtures.expenseId } });
      await prisma.auditLog.deleteMany({ where: { entityId: fixtures.expenseId } });
    }
    if (fixtures.maintenanceRequestId) {
      await prisma.inventoryUsageRequest.updateMany({
        where: { maintenanceRequestId: fixtures.maintenanceRequestId },
        data: { maintenanceRequestId: null }
      });
      await prisma.inventoryMovement.updateMany({
        where: { maintenanceRequestId: fixtures.maintenanceRequestId },
        data: { maintenanceRequestId: null }
      });
      await prisma.maintenanceUpdate.deleteMany({ where: { maintenanceId: fixtures.maintenanceRequestId } });
      await prisma.approval.deleteMany({ where: { maintenanceId: fixtures.maintenanceRequestId } });
      await prisma.maintenanceRequest.deleteMany({ where: { id: fixtures.maintenanceRequestId } });
      await prisma.auditLog.deleteMany({ where: { entityId: fixtures.maintenanceRequestId } });
    }
  } catch (error) {
    console.error(
      "[interaction] fixture cleanup warning:",
      error instanceof Error ? error.message : String(error)
    );
  }
}

async function setSessionCookie(context: BrowserContext, baseUrl: string, token: string) {
  const parsed = new URL(baseUrl);
  await context.addCookies([
    {
      name: SESSION_COOKIE_NAME,
      value: token,
      domain: parsed.hostname,
      path: "/",
      httpOnly: true,
      secure: parsed.protocol === "https:",
      sameSite: "Lax"
    }
  ]);
}

async function ensureServerReachable(baseUrl: string) {
  const timeoutAt = Date.now() + 30_000;
  while (Date.now() < timeoutAt) {
    try {
      const response = await fetch(`${baseUrl}/login`, {
        method: "GET"
      });
      if (response.ok || response.status === 307 || response.status === 308) {
        return;
      }
    } catch {
      // keep retrying
    }
    await sleep(750);
  }
  throw new Error(`Unable to reach app server at ${baseUrl}. Start the local app server first.`);
}

async function loginAndGetCookie(baseUrl: string, email: string, password: string) {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ email, password })
  });

  const responseText = await response.clone().text().catch(() => "");
  if (!response.ok) {
    throw new Error(`Login failed (${response.status}): ${responseText}`);
  }

  const setCookieHeader = response.headers.get("set-cookie") || "";
  const cookie = readCookieValue(setCookieHeader, SESSION_COOKIE_NAME);
  if (!cookie) {
    throw new Error("Login succeeded but session cookie was not returned.");
  }
  return cookie;
}

function readCookieValue(setCookieHeader: string, cookieName: string) {
  const matcher = new RegExp(`${cookieName}=([^;]+)`);
  const match = setCookieHeader.match(matcher);
  return match?.[1] || "";
}

async function getJson(baseUrl: string, path: string, cookie: string) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "GET",
    headers: {
      cookie: `${SESSION_COOKIE_NAME}=${cookie}`
    }
  });
  const text = await response.text();
  const json = parseJson(text);
  return { ok: response.ok, status: response.status, text, json };
}

async function postJson(baseUrl: string, path: string, cookie: string, payload: unknown) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      cookie: `${SESSION_COOKIE_NAME}=${cookie}`
    },
    body: JSON.stringify(payload)
  });
  const text = await response.text();
  const json = parseJson(text);
  return { ok: response.ok, status: response.status, text, json };
}

function parseJson(value: string) {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function asString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

async function runStep(label: string, fn: () => Promise<void>) {
  console.log(`[interaction] ${label}`);
  await fn();
  console.log(`[interaction] ✔ ${label}`);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function waitFor(check: () => boolean, timeoutMs: number, errorMessage: string) {
  const timeoutAt = Date.now() + timeoutMs;
  while (Date.now() < timeoutAt) {
    if (check()) {
      return;
    }
    await sleep(80);
  }
  throw new Error(errorMessage);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
