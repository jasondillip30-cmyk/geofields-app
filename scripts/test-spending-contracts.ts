import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const SESSION_COOKIE_NAME = "gf_session";
const DEFAULT_BASE_URL = "http://127.0.0.1:3000";
const EPSILON = 0.01;

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function toNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function assertClose(label: string, actual: number, expected: number) {
  const delta = Math.abs(actual - expected);
  if (delta > EPSILON) {
    throw new Error(
      `${label} mismatch. expected=${expected.toFixed(2)} actual=${actual.toFixed(2)} delta=${delta.toFixed(2)}`
    );
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
      `Spending contracts need a running app at ${baseUrl}. Start dev server first. (${formatError(error)})`
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

async function getJson(baseUrl: string, path: string, cookie: string) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "GET",
    headers: { Cookie: cookie }
  });
  const text = await response.text();
  return {
    ok: response.ok,
    status: response.status,
    json: safeParseJson(text),
    text
  };
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
    throw new Error("Spending contract checks must not run in production.");
  }

  const baseUrl = (process.env.SMOKE_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, "");
  const adminEmail = process.env.SMOKE_ADMIN_EMAIL || "admin@geofields.co.tz";
  const adminPassword = process.env.SMOKE_ADMIN_PASSWORD || "Admin123!";

  await ensureServerReachable(baseUrl);
  const cookie = await loginAndGetCookie(baseUrl, adminEmail, adminPassword);

  const project = await prisma.project.findFirst({
    select: { id: true, clientId: true, assignedRigId: true, backupRigId: true }
  });
  assert(Boolean(project), "No project found. Seed baseline data first.");

  const staleClient = await prisma.client.findFirst({
    where: { id: { not: project!.clientId } },
    select: { id: true }
  });
  const staleRig = await prisma.rig.findFirst({
    where: {
      id: {
        notIn: [project!.assignedRigId || "", project!.backupRigId || ""].filter(Boolean)
      }
    },
    select: { id: true }
  });

  const staleParams = new URLSearchParams({
    projectId: project!.id,
    ...(staleClient?.id ? { clientId: staleClient.id } : {}),
    ...(staleRig?.id ? { rigId: staleRig.id } : {})
  }).toString();
  const lockedParams = new URLSearchParams({ projectId: project!.id }).toString();

  const [spendingLocked, spendingStale, profitLocked, profitStale, drillingLocked, drillingStale] =
    await Promise.all([
      getJson(baseUrl, `/api/spending/summary?${lockedParams}`, cookie),
      getJson(baseUrl, `/api/spending/summary?${staleParams}`, cookie),
      getJson(baseUrl, `/api/profit/summary?${lockedParams}`, cookie),
      getJson(baseUrl, `/api/profit/summary?${staleParams}`, cookie),
      getJson(baseUrl, `/api/spending/drilling-reports/summary?${lockedParams}`, cookie),
      getJson(baseUrl, `/api/spending/drilling-reports/summary?${staleParams}`, cookie)
    ]);

  for (const [label, result] of [
    ["spending-locked", spendingLocked],
    ["spending-stale", spendingStale],
    ["profit-locked", profitLocked],
    ["profit-stale", profitStale],
    ["drilling-locked", drillingLocked],
    ["drilling-stale", drillingStale]
  ] as const) {
    assert(result.ok, `${label} failed (${result.status}): ${result.text}`);
  }

  assert(
    JSON.stringify(spendingLocked.json) === JSON.stringify(spendingStale.json),
    "Spending summary changed when stale client/rig filters were supplied with project lock."
  );
  assert(
    JSON.stringify(profitLocked.json) === JSON.stringify(profitStale.json),
    "Profit summary changed when stale client/rig filters were supplied with project lock."
  );
  assert(
    JSON.stringify(drillingLocked.json) === JSON.stringify(drillingStale.json),
    "Drilling summary changed when stale client/rig filters were supplied with project lock."
  );

  const spendingTotals = (spendingLocked.json?.totals || {}) as Record<string, unknown>;
  const income = toNumber(spendingTotals.income);
  const expenses = toNumber(spendingTotals.expenses);
  const netCashFlow = toNumber(spendingTotals.netCashFlow);
  assertClose("spending netCashFlow", netCashFlow, income - expenses);

  const profitTotals = (profitLocked.json?.totals || {}) as Record<string, unknown>;
  const totalRevenue = toNumber(profitTotals.totalRevenue);
  const totalExpenses = toNumber(profitTotals.totalExpenses);
  const totalProfit = toNumber(profitTotals.totalProfit);
  assertClose("profit totalProfit", totalProfit, totalRevenue - totalExpenses);

  assertClose("cross-endpoint revenue", income, totalRevenue);
  assertClose("cross-endpoint expenses", expenses, totalExpenses);

  console.log(
    JSON.stringify(
      {
        ok: true,
        checks: [
          "project lock precedence ignores stale client/rig",
          "spending net cash flow equation",
          "profit equation",
          "spending vs profit totals consistency"
        ],
        projectId: project!.id
      },
      null,
      2
    )
  );
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
