import { PrismaClient } from "@prisma/client";
import { chromium, type BrowserContext, type Page } from "playwright";

const prisma = new PrismaClient();

const SESSION_COOKIE_NAME = "gf_session";
const DEFAULT_BASE_URL = "http://127.0.0.1:3000";
const DEFAULT_ADMIN_EMAIL = "admin@geofields.co.tz";
const DEFAULT_ADMIN_PASSWORD = "Admin123!";
const DEFAULT_VIEWPORT = { width: 1365, height: 900 };

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
  rigsOneProjectId: string | null;
  rigsTwoProjectId: string | null;
  rigsNoRigProjectId: string | null;
  backupRigId: string | null;
}

async function main() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Interaction workflow tests must not run in production mode.");
  }

  const baseUrl = (process.env.INTERACTION_BASE_URL || process.env.SMOKE_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, "");
  const adminEmail = process.env.SMOKE_ADMIN_EMAIL || DEFAULT_ADMIN_EMAIL;
  const adminPassword = process.env.SMOKE_ADMIN_PASSWORD || DEFAULT_ADMIN_PASSWORD;
  const runToken = `interaction-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const viewport = resolveInteractionViewport();

  console.log(
    `[interaction] running with viewport ${viewport.width}x${viewport.height} (mobile=${viewport.isMobile ? "yes" : "no"})`
  );

  await ensureServerReachable(baseUrl);
  const sessionCookie = await loginAndGetCookie(baseUrl, adminEmail, adminPassword);

  let fixtures: InteractionFixtures | null = null;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;
  let context: BrowserContext | null = null;

  try {
    fixtures = await createFixtures(baseUrl, sessionCookie, runToken);

    browser = await chromium.launch({ headless: true });
    context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      isMobile: viewport.isMobile,
      hasTouch: viewport.isMobile
    });
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

    await runStep("purchase requests mode split + project lock scoping", async () => {
      await testPurchaseRequestsModeSplit(page, baseUrl, fixtures!);
    });

    await runStep("rigs project-locked profile mode behavior", async () => {
      await testRigsProjectLockedProfileMode(page, baseUrl, fixtures!);
    });

    await runStep("workspace launch marker lock + swipe roundtrip", async () => {
      await testWorkspaceLaunchRoundTrip(page, baseUrl);
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
  await page.goto(
    `${baseUrl}/inventory/stock-movements?workspace=all-projects&projectId=all&clientId=all&rigId=all`,
    { waitUntil: "domcontentloaded" }
  );
  await waitForHydratedApp(page);
  const modeMismatchGuard = page.getByText("Page hidden in current workspace mode").first();
  assert(
    !(await modeMismatchGuard.isVisible().catch(() => false)),
    "Inventory stock movements should render in all-projects mode, not workspace-mode guard."
  );
  await page.getByText("Movement History").first().waitFor({ state: "visible", timeout: 60_000 });

  await page.getByRole("button", { name: "New Manual Adjustment" }).click();
  const modal = page.getByTestId("inventory-manual-movement-modal");
  await modal.waitFor({ state: "visible" });

  const submitButton = modal.getByTestId("manual-movement-submit");
  assert(await submitButton.isDisabled(), "Manual movement submit should be disabled before required fields are set.");

  const itemSelect = modal.getByLabel("Item");
  let itemOptionFound = false;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const optionValues = await itemSelect
      .locator("option")
      .evaluateAll((options) => options.map((option) => (option as HTMLOptionElement).value));
    if (optionValues.includes(fixtures.itemId)) {
      itemOptionFound = true;
      break;
    }
    await sleep(200);
  }
  const availableItemOptions = await itemSelect
    .locator("option")
    .evaluateAll((options) => options.map((option) => (option as HTMLOptionElement).value));
  assert(
    itemOptionFound,
    `Manual movement modal item dropdown did not include fixture item ${fixtures.itemId}. Available: ${availableItemOptions.join(", ")}`
  );
  await itemSelect.selectOption(fixtures.itemId);
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
  await page.goto(`${baseUrl}/inventory/issues`, { waitUntil: "domcontentloaded" });
  await waitForHydratedApp(page);
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
    waitUntil: "domcontentloaded"
  });
  await waitForHydratedApp(page);
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
  await page.goto(`${baseUrl}/inventory/expenses?workspace=all-projects&projectId=all&clientId=all&rigId=all`, {
    waitUntil: "domcontentloaded"
  });
  await waitForHydratedApp(page);
  const queueHeading = page.getByText("Expense Queue").first();
  if (!(await queueHeading.isVisible().catch(() => false))) {
    const projectSelect = page.getByLabel("Project").first();
    if (await projectSelect.isVisible().catch(() => false)) {
      await projectSelect.selectOption("all").catch(() => undefined);
      await page.waitForLoadState("domcontentloaded");
    }
  }
  await queueHeading.waitFor({ state: "visible" });

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
  await page.goto(`${baseUrl}/approvals?workspace=workshop&projectId=all&clientId=all&rigId=all`, {
    waitUntil: "domcontentloaded"
  });
  await waitForHydratedApp(page);
  await page.getByRole("button", { name: "Purchase Requisitions" }).first().waitFor({ state: "visible" });

  const row = page
    .locator("tr:visible, article:visible")
    .filter({ hasText: fixtures.requisitionCode })
    .first();
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

async function testPurchaseRequestsModeSplit(page: Page, baseUrl: string, fixtures: InteractionFixtures) {
  const requisitionsRoutePattern = "**/api/requisitions?*";

  const projectModeCalls: string[] = [];
  await page.route(requisitionsRoutePattern, async (route) => {
    if (route.request().method() === "GET") {
      projectModeCalls.push(route.request().url());
    }
    await route.continue();
  });
  await page.goto(
    `${baseUrl}/expenses?workspace=project&projectId=${encodeURIComponent(fixtures.projectId)}&clientId=all&rigId=all`,
    {
      waitUntil: "domcontentloaded"
    }
  );
  await waitForHydratedApp(page);
  const requisitionWorkflow = page.locator("#expenses-requisition-workflow").first();
  await page.getByText("Requisition History").first().waitFor({ state: "visible" });
  await requisitionWorkflow.getByText("Project Request").first().waitFor({ state: "visible" });
  assert(
    !(await requisitionWorkflow.getByText("Inventory Stock-up Request").first().isVisible().catch(() => false)),
    "Project-mode purchase requests must not expose inventory stock-up request type controls."
  );
  assert(
    await requisitionWorkflow
      .locator("label:has-text('Project') input[readonly]")
      .first()
      .isVisible()
      .catch(() => false),
    "Project-mode request context must show a locked project as read-only."
  );
  assert(
    !(await requisitionWorkflow
      .locator("label:has-text('Project') select")
      .first()
      .isVisible()
      .catch(() => false)),
    "Project-mode request context must not show a project selector."
  );
  await waitFor(
    () => projectModeCalls.length > 0,
    10_000,
    "Project-mode purchase requests did not issue a requisition history query."
  );
  await page.unroute(requisitionsRoutePattern);

  const projectModeUrl = new URL(projectModeCalls.at(-1) || projectModeCalls[0]);
  assert(
    projectModeUrl.searchParams.get("projectId") === fixtures.projectId,
    "Project-mode requisition history must be scoped to the locked project."
  );
  assert(
    projectModeUrl.searchParams.get("type") === "LIVE_PROJECT_PURCHASE",
    "Project-mode requisition history must be limited to project purchases."
  );

  const workshopModeCalls: string[] = [];
  await page.route(requisitionsRoutePattern, async (route) => {
    if (route.request().method() === "GET") {
      workshopModeCalls.push(route.request().url());
    }
    await route.continue();
  });
  await page.goto(`${baseUrl}/expenses?workspace=workshop&projectId=all&clientId=all&rigId=all`, {
    waitUntil: "domcontentloaded"
  });
  await waitForHydratedApp(page);
  const workshopRequisitionWorkflow = page.locator("#expenses-requisition-workflow").first();
  await page.getByText("Requisition History").first().waitFor({ state: "visible" });
  await workshopRequisitionWorkflow.getByText("Inventory Stock-up Request").first().waitFor({ state: "visible" });
  assert(
    !(await workshopRequisitionWorkflow.getByText("Project Request").first().isVisible().catch(() => false)),
    "Workshop-mode purchase requests must not expose project purchase controls."
  );
  await waitFor(
    () => workshopModeCalls.length > 0,
    10_000,
    "Workshop-mode purchase requests did not issue a requisition history query."
  );
  await page.unroute(requisitionsRoutePattern);

  const workshopModeUrl = new URL(workshopModeCalls.at(-1) || workshopModeCalls[0]);
  assert(
    workshopModeUrl.searchParams.get("type") === "INVENTORY_STOCK_UP",
    "Workshop-mode requisition history must default to inventory stock-up requests."
  );

  if (fixtures.maintenanceRequestId) {
    const maintenanceWorkshopCalls: string[] = [];
    await page.route(requisitionsRoutePattern, async (route) => {
      if (route.request().method() === "GET") {
        maintenanceWorkshopCalls.push(route.request().url());
      }
      await route.continue();
    });
    await page.goto(
      `${baseUrl}/expenses?workspace=workshop&projectId=all&clientId=all&rigId=all&maintenanceRequestId=${encodeURIComponent(fixtures.maintenanceRequestId)}`,
      {
        waitUntil: "domcontentloaded"
      }
    );
    await waitForHydratedApp(page);
    await page.locator("#expenses-requisition-workflow").getByText("Maintenance Request").first().waitFor({ state: "visible" });
    await waitFor(
      () => maintenanceWorkshopCalls.length > 0,
      10_000,
      "Workshop maintenance-context purchase requests did not issue a requisition history query."
    );
    await page.unroute(requisitionsRoutePattern);

    const maintenanceWorkshopUrl = new URL(
      maintenanceWorkshopCalls.at(-1) || maintenanceWorkshopCalls[0]
    );
    assert(
      maintenanceWorkshopUrl.searchParams.get("type") === "MAINTENANCE_PURCHASE",
      "Workshop maintenance-context requisition history must use maintenance purchase type."
    );
    assert(
      maintenanceWorkshopUrl.searchParams.get("maintenanceRequestId") === fixtures.maintenanceRequestId,
      "Workshop maintenance-context requisition history must stay scoped to the maintenance request."
    );
  }
}

async function testRigsProjectLockedProfileMode(page: Page, baseUrl: string, fixtures: InteractionFixtures) {
  if (!fixtures.rigsOneProjectId || !fixtures.rigsTwoProjectId || !fixtures.rigsNoRigProjectId) {
    throw new Error("Rigs locked-mode fixtures are missing.");
  }

  await page.goto(
    `${baseUrl}/rigs?workspace=project&projectId=${encodeURIComponent(fixtures.rigsOneProjectId)}&clientId=all&rigId=all`,
    {
      waitUntil: "domcontentloaded"
    }
  );
  await waitForHydratedApp(page);
  await page.getByText("Rig profiles").first().waitFor({ state: "visible" });
  assert(
    !(await page.getByText("No assigned or backup rig is linked to this project yet.").first().isVisible().catch(() => false)),
    "Locked project with one assigned rig should not show the empty no-rig state."
  );
  assert(
    (await fetchProjectRigCount(page, baseUrl, fixtures.rigsOneProjectId)) === 1,
    "Locked project mode API should return exactly one rig when only assigned rig exists."
  );
  assert(
    !(await page.locator("#rig-registry-section").first().isVisible().catch(() => false)),
    "Locked project mode should not show the rig registry table."
  );
  assert(
    !(await page.getByText("Rig focus").first().isVisible().catch(() => false)),
    "Locked project mode should not show status filter controls."
  );
  assert(
    !(await page.getByRole("link", { name: "Create rig" }).first().isVisible().catch(() => false)),
    "Locked project mode should not show create rig action."
  );
  assert(
    !(await page.getByRole("button", { name: "Mark Out of Service" }).first().isVisible().catch(() => false)),
    "Locked project mode should not show out-of-service action."
  );

  await page.goto(
    `${baseUrl}/rigs?workspace=project&projectId=${encodeURIComponent(fixtures.rigsTwoProjectId)}&clientId=all&rigId=all`,
    {
      waitUntil: "domcontentloaded"
    }
  );
  await waitForHydratedApp(page);
  await page.getByText("Rig profiles").first().waitFor({ state: "visible" });
  assert(
    (await fetchProjectRigCount(page, baseUrl, fixtures.rigsTwoProjectId)) === 2,
    "Locked project mode API should return two rigs when assigned and backup rigs exist."
  );

  await page.goto(
    `${baseUrl}/rigs?workspace=project&projectId=${encodeURIComponent(fixtures.rigsNoRigProjectId)}&clientId=all&rigId=all`,
    {
      waitUntil: "domcontentloaded"
    }
  );
  await waitForHydratedApp(page);
  assert(
    (await fetchProjectRigCount(page, baseUrl, fixtures.rigsNoRigProjectId)) === 0,
    "Locked project mode API should return no rigs when the project has no assigned/backup rig."
  );
  const noRigMessage = page
    .getByText("No assigned or backup rig is linked to this project yet.")
    .first();
  const editProjectSetupLink = page.getByRole("link", { name: "Edit project setup" }).first();
  const noRigMessageVisible = await noRigMessage.isVisible().catch(() => false);
  if (!noRigMessageVisible) {
    await editProjectSetupLink.waitFor({ state: "visible", timeout: 30_000 });
  } else {
    await noRigMessage.waitFor({ state: "visible", timeout: 30_000 });
    await editProjectSetupLink.waitFor({ state: "visible", timeout: 30_000 });
  }

  await page.goto(`${baseUrl}/rigs?workspace=all-projects&projectId=all&clientId=all&rigId=all`, {
    waitUntil: "domcontentloaded"
  });
  await waitForHydratedApp(page);
  await page.getByText("Rig Registry").first().waitFor({ state: "visible" });
  await page.getByText("Rig focus").first().waitFor({ state: "visible" });
}

async function testWorkspaceLaunchRoundTrip(page: Page, baseUrl: string) {
  await page.goto(
    `${baseUrl}/rigs?workspace=all-projects&projectId=all&clientId=all&rigId=all&launch=1`,
    { waitUntil: "domcontentloaded" }
  );
  await waitForHydratedApp(page);

  const launchLayer = page.getByTestId("workspace-launch-layer");
  await launchLayer.waitFor({ state: "visible", timeout: 30_000 });
  await page.getByText("Choose your operations view").first().waitFor({ state: "visible", timeout: 30_000 });
  const unlabeledMarkerButtons = await launchLayer
    .locator("button[data-marker-id]")
    .evaluateAll((nodes) =>
      nodes.filter((node) => !((node as HTMLButtonElement).innerText || "").trim()).length
    );
  assert(
    unlabeledMarkerButtons === 0,
    "Globe overlay should not render unlabeled project marker buttons."
  );

  const firstProjectMarker = launchLayer.locator("button[data-marker-id]:not([disabled])").first();
  await firstProjectMarker.waitFor({ state: "visible", timeout: 30_000 });
  const markerProjectId = await firstProjectMarker.getAttribute("data-marker-id");
  const markerProjectName = await firstProjectMarker.getAttribute("data-marker-name");
  assert(Boolean(markerProjectId), "Workspace launch marker must expose data-marker-id for scope locking.");
  assert(Boolean(markerProjectName), "Workspace launch marker must expose full project name metadata.");

  const markerBeforeExpand = launchLayer.locator(`button[data-marker-id="${markerProjectId}"]`);
  const shortLabel = (await markerBeforeExpand.innerText()).trim();
  assert(shortLabel.length > 0, "Collapsed marker must render a short label.");
  await page.evaluate((markerId) => {
    if (!markerId) {
      return;
    }
    const marker = document.querySelector(
      `button[data-marker-id="${markerId}"]:not([disabled])`
    ) as HTMLButtonElement | null;
    marker?.click();
  }, markerProjectId);

  await page.waitForFunction(
    (markerId) => {
      const marker = document.querySelector(`button[data-marker-id="${markerId}"]`);
      return marker?.getAttribute("data-marker-expanded") === "true";
    },
    markerProjectId,
    { timeout: 8_000 }
  );
  assert(
    page.url().includes("launch=1"),
    "First marker click should only expand full name, not navigate."
  );
  const expandedLabel = (await markerBeforeExpand.innerText()).trim();
  assert(
    expandedLabel.toLowerCase() === (markerProjectName || "").toLowerCase(),
    "Expanded marker should display the full project name."
  );

  await page.evaluate((markerId) => {
    if (!markerId) {
      return;
    }
    const marker = document.querySelector(
      `button[data-marker-id="${markerId}"]:not([disabled])`
    ) as HTMLButtonElement | null;
    marker?.click();
  }, markerProjectId);

  await waitFor(
    () => page.url().includes("/spending?"),
    30_000,
    "Second marker click did not navigate to /spending."
  );
  await waitForHydratedApp(page);
  const markerUrl = new URL(page.url());
  assert(
    markerUrl.searchParams.get("workspace") === "project",
    "Marker click must force project workspace mode."
  );
  assert(
    markerUrl.searchParams.get("projectId") === markerProjectId,
    "Marker click must lock to the exact clicked project."
  );
  assert(
    !(await page.getByText("Select one project to continue.").first().isVisible().catch(() => false)),
    "Project marker navigation must not land in all-projects prompt state."
  );

  await page.evaluate(() => {
    const host = document.getElementById("gf-app-main-scroll");
    if (host) {
      host.scrollTop = 0;
      return;
    }
    window.scrollTo(0, 0);
  });
  const topbar = page.locator("header").first();
  await topbar.hover();
  await page.mouse.wheel(0, -130);
  await page.mouse.wheel(0, -130);
  await launchLayer.waitFor({ state: "visible", timeout: 30_000 });
  await page.getByText("Choose your operations view").first().waitFor({ state: "visible", timeout: 30_000 });

  await launchLayer.hover();
  for (let step = 0; step < 8; step += 1) {
    await page.mouse.wheel(0, 220);
    await page.waitForTimeout(25);
  }
  await waitFor(
    () => !page.url().includes("launch=1") && !page.url().includes("/spending?workspace=project"),
    20_000,
    "Swipe-up unlock from launch layer did not transition to all-projects destination."
  );
  const unlockedUrl = new URL(page.url());
  assert(
    unlockedUrl.searchParams.get("workspace") === "all-projects",
    "Launch swipe-up must set all-projects workspace mode."
  );
}

async function fetchProjectRigCount(page: Page, baseUrl: string, projectId: string) {
  const response = await page.request.get(
    `${baseUrl}/api/rigs?projectId=${encodeURIComponent(projectId)}&clientId=all&rigId=all`
  );
  assert(response.ok(), "Failed to load project-scoped rigs from /api/rigs.");
  const payload = (await response.json()) as { data?: unknown[] };
  return Array.isArray(payload.data) ? payload.data.length : 0;
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

  if (!adminUser || !mechanic || !project || !rig) {
    throw new Error("Interaction test prerequisites missing. Seed users/project/rig/item first.");
  }

  const fixtureSku = `IT-${runToken.replace(/[^a-z0-9]/gi, "").slice(-12).toUpperCase() || Date.now().toString(36).toUpperCase()}`;
  const fixtureInventoryItem = await prisma.inventoryItem.create({
    data: {
      name: `Interaction Manual Item ${runToken}`,
      sku: fixtureSku,
      category: "CONSUMABLES",
      quantityInStock: 20,
      minimumStockLevel: 2,
      unitCost: 150,
      status: "ACTIVE",
      notes: `interaction fixture ${runToken}`
    },
    select: { id: true }
  });

  const backupRig = await prisma.rig.create({
    data: {
      rigCode: `IT-BACKUP-${runToken.slice(-8).toUpperCase()}`,
      model: "Interaction Backup Model",
      serialNumber: `IT-SN-${runToken.slice(-8).toUpperCase()}`,
      status: "IDLE",
      condition: "GOOD",
      conditionScore: 82,
      totalHoursWorked: 0,
      totalMetersDrilled: 0,
      totalLifetimeDays: 0
    },
    select: { id: true }
  });

  const rigTestProjectBase = {
    clientId: project.clientId,
    location: "Interaction Test Site",
    startDate: new Date(),
    status: "ACTIVE" as const
  };

  const [rigsOneProject, rigsTwoProject, rigsNoRigProject] = await prisma.$transaction([
    prisma.project.create({
      data: {
        ...rigTestProjectBase,
        name: `Interaction Rigs One ${runToken}`,
        assignedRigId: rig.id
      },
      select: { id: true }
    }),
    prisma.project.create({
      data: {
        ...rigTestProjectBase,
        name: `Interaction Rigs Two ${runToken}`,
        assignedRigId: rig.id,
        backupRigId: backupRig.id
      },
      select: { id: true }
    }),
    prisma.project.create({
      data: {
        ...rigTestProjectBase,
        name: `Interaction Rigs None ${runToken}`
      },
      select: { id: true }
    })
  ]);

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
      receiptNumber: `INT-${runToken}`.slice(0, 48),
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
    itemId: fixtureInventoryItem.id,
    rigsOneProjectId: rigsOneProject.id,
    rigsTwoProjectId: rigsTwoProject.id,
    rigsNoRigProjectId: rigsNoRigProject.id,
    backupRigId: backupRig.id
  };
}

async function cleanupFixtures(fixtures: InteractionFixtures) {
  try {
    if (fixtures.rigsOneProjectId || fixtures.rigsTwoProjectId || fixtures.rigsNoRigProjectId) {
      const projectIds = [fixtures.rigsOneProjectId, fixtures.rigsTwoProjectId, fixtures.rigsNoRigProjectId].filter(
        (value): value is string => Boolean(value)
      );
      if (projectIds.length > 0) {
        await prisma.project.deleteMany({ where: { id: { in: projectIds } } });
      }
    }
    if (fixtures.backupRigId) {
      await prisma.rig.deleteMany({ where: { id: fixtures.backupRigId } });
    }
    if (fixtures.requisitionId) {
      await prisma.summaryReport.deleteMany({ where: { id: fixtures.requisitionId } });
      await prisma.auditLog.deleteMany({ where: { entityId: fixtures.requisitionId } });
    }
    if (fixtures.itemId) {
      await prisma.inventoryMovement.deleteMany({ where: { itemId: fixtures.itemId } });
      await prisma.inventoryUsageRequest.deleteMany({ where: { itemId: fixtures.itemId } });
      await prisma.inventoryItem.deleteMany({ where: { id: fixtures.itemId } });
      await prisma.auditLog.deleteMany({ where: { entityId: fixtures.itemId } });
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
  const maxAttempts = 6;
  let lastError = "Unknown login failure";

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/api/auth/login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ email, password })
      });

      const responseText = await response.clone().text().catch(() => "");
      if (!response.ok) {
        lastError = `Login failed (${response.status}): ${responseText}`;
        const retryableStatus = response.status >= 500 && response.status <= 504;
        if (retryableStatus && attempt < maxAttempts) {
          await sleep(1_250);
          continue;
        }
        throw new Error(lastError);
      }

      const setCookieHeader = response.headers.get("set-cookie") || "";
      const cookie = readCookieValue(setCookieHeader, SESSION_COOKIE_NAME);
      if (!cookie) {
        lastError = "Login succeeded but session cookie was not returned.";
        if (attempt < maxAttempts) {
          await sleep(1_250);
          continue;
        }
        throw new Error(lastError);
      }
      return cookie;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      if (attempt < maxAttempts) {
        await sleep(1_250);
        continue;
      }
      throw new Error(lastError);
    }
  }

  throw new Error(lastError);
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

async function waitForHydratedApp(page: Page, timeoutMs = 30_000) {
  await page.waitForFunction(() => document.documentElement.dataset.gfHydrated === "1", undefined, {
    timeout: timeoutMs
  });
}

function resolveInteractionViewport() {
  const raw = (process.env.INTERACTION_VIEWPORT || "").trim();
  if (!raw) {
    return {
      ...DEFAULT_VIEWPORT,
      isMobile: false
    };
  }
  const match = raw.match(/^(\d{2,5})x(\d{2,5})$/i);
  if (!match) {
    throw new Error(
      `Invalid INTERACTION_VIEWPORT "${raw}". Use WIDTHxHEIGHT format (example: 390x844).`
    );
  }
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 200 || height < 200) {
    throw new Error(
      `Invalid INTERACTION_VIEWPORT "${raw}". Width/height must be numeric and >= 200.`
    );
  }
  return {
    width,
    height,
    isMobile: width < 1024
  };
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
