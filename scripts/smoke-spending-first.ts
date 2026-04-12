import { PrismaClient } from "@prisma/client";
import { chromium, type BrowserContext, type Page } from "playwright";

const prisma = new PrismaClient();

const SESSION_COOKIE_NAME = "gf_session";
const DEFAULT_BASE_URL = "http://127.0.0.1:3000";

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
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
      `Spending smoke needs a running app at ${baseUrl}. Start dev server first. (${formatError(error)})`
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
  const match = setCookie.match(new RegExp(`${SESSION_COOKIE_NAME}=[^;]+`));
  if (!match) {
    throw new Error(`Login succeeded for ${email} but no session cookie returned.`);
  }
  return match[0];
}

async function setSessionCookie(context: BrowserContext, baseUrl: string, cookieValue: string) {
  const [name, value] = cookieValue.split("=", 2);
  const origin = new URL(baseUrl);
  await context.addCookies([
    {
      name,
      value,
      domain: origin.hostname,
      path: "/",
      httpOnly: true,
      secure: false
    }
  ]);
}

async function checkRedirect(baseUrl: string, source: string, targetPrefix: string) {
  const response = await fetch(`${baseUrl}${source}`, { method: "GET", redirect: "manual" });
  assert(
    response.status >= 300 && response.status < 400,
    `Expected redirect for ${source}, got ${response.status}.`
  );
  const location = response.headers.get("location") || "";
  assert(
    location.startsWith(targetPrefix),
    `Unexpected redirect target for ${source}. expected prefix ${targetPrefix}, got ${location || "empty"}`
  );
}

async function runSpendingWorkspaceFlow(page: Page, baseUrl: string, projectId: string) {
  await page.goto(`${baseUrl}/spending?projectId=${encodeURIComponent(projectId)}`, {
    waitUntil: "networkidle"
  });

  await page.getByRole("button", { name: "Overview" }).waitFor({ state: "visible" });
  await page.getByRole("button", { name: "Transactions" }).waitFor({ state: "visible" });
  await page.getByRole("button", { name: "Drilling reports" }).waitFor({ state: "visible" });

  await page.getByRole("button", { name: "Transactions" }).click();
  await page.getByText("Completed live project purchases from requisition to receipt posting.").first().waitFor({
    state: "visible"
  });

  await page.getByRole("button", { name: "Drilling reports" }).click();
  await page.getByText("Drilling reports by hole").first().waitFor({ state: "visible" });

  await page.getByRole("button", { name: "Overview" }).click();
  await page.getByText("Category breakdown").first().waitFor({ state: "visible" });

  await page.getByRole("button", { name: "Profit" }).first().click();
  await page.waitForURL(/\/spending\/profit/);
  await page.getByText("Project profit view").first().waitFor({ state: "visible" });

  await page.goto(`${baseUrl}/spending?projectId=${encodeURIComponent(projectId)}`, {
    waitUntil: "networkidle"
  });
  await page.getByRole("button", { name: "Overview" }).click();

  const categoryRows = page.locator("table tbody tr");
  const rowCount = await categoryRows.count();
  assert(rowCount > 0, "No expense categories found for spending drilldown smoke.");
  await categoryRows.first().click();
  await page.waitForURL(/\/spending\/expenses\//);
  await page.getByText("Expense details").first().waitFor({ state: "visible" });
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

async function main() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Spending smoke must not run in production.");
  }

  const baseUrl = (process.env.SMOKE_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, "");
  const adminEmail = process.env.SMOKE_ADMIN_EMAIL || "admin@geofields.co.tz";
  const adminPassword = process.env.SMOKE_ADMIN_PASSWORD || "Admin123!";

  await ensureServerReachable(baseUrl);

  const movementProject = await prisma.inventoryMovement.findFirst({
    where: {
      movementType: "OUT",
      totalCost: { gt: 0 },
      projectId: { not: null }
    },
    select: { projectId: true }
  });
  assert(Boolean(movementProject?.projectId), "No project with usage expenses found for spending smoke.");

  const projectId = movementProject!.projectId as string;
  const cookie = await loginAndGetCookie(baseUrl, adminEmail, adminPassword);

  await checkRedirect(baseUrl, `/revenue?projectId=${encodeURIComponent(projectId)}`, "/spending");
  await checkRedirect(baseUrl, `/cost-tracking?projectId=${encodeURIComponent(projectId)}`, "/spending");
  await checkRedirect(
    baseUrl,
    `/cost-tracking/budget-vs-actual?projectId=${encodeURIComponent(projectId)}`,
    "/spending"
  );
  await checkRedirect(baseUrl, `/profit?projectId=${encodeURIComponent(projectId)}`, "/spending/profit");

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  try {
    await setSessionCookie(context, baseUrl, cookie);
    const page = await context.newPage();
    await runSpendingWorkspaceFlow(page, baseUrl, projectId);
    console.log(
      JSON.stringify(
        {
          ok: true,
          checks: [
            "legacy finance redirects",
            "spending tabs interaction",
            "profit drill-in",
            "category drilldown"
          ],
          projectId
        },
        null,
        2
      )
    );
  } finally {
    await context.close();
    await browser.close();
    await prisma.$disconnect();
  }
}

main().catch(async (error) => {
  console.error(error instanceof Error ? error.message : String(error));
  await prisma.$disconnect();
  process.exitCode = 1;
});
