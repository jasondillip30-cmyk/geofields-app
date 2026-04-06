import { PrismaClient } from "@prisma/client";
import { purgeDanglingSmokeArtifacts } from "./smoke-isolation";

const prisma = new PrismaClient();

const SESSION_COOKIE_NAME = "gf_session";
const DEFAULT_BASE_URL = "http://127.0.0.1:3000";
const EPSILON = 0.01;

type PurposeSummary = {
  totalRecognizedSpend: number;
  breakdownCost: number;
  maintenanceCost: number;
  stockReplenishmentCost: number;
  operatingCost: number;
  otherUnlinkedCost: number;
};

interface HttpResult {
  ok: boolean;
  status: number;
  text: string;
  json: Record<string, unknown> | null;
}

function toNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function assertClose(label: string, actual: number, expected: number) {
  const delta = Math.abs(actual - expected);
  if (delta > EPSILON) {
    throw new Error(
      `${label} mismatch. expected=${expected.toFixed(2)} actual=${actual.toFixed(2)} delta=${delta.toFixed(2)}`
    );
  }
}

function normalizePurposeSummary(source: Record<string, unknown> | null): PurposeSummary {
  return {
    totalRecognizedSpend: toNumber(source?.totalRecognizedSpend),
    breakdownCost: toNumber(source?.breakdownCost),
    maintenanceCost: toNumber(source?.maintenanceCost),
    stockReplenishmentCost: toNumber(source?.stockReplenishmentCost),
    operatingCost: toNumber(source?.operatingCost),
    otherUnlinkedCost: toNumber(source?.otherUnlinkedCost)
  };
}

async function ensureServerReachable(baseUrl: string) {
  try {
    const response = await fetch(`${baseUrl}/api/auth/session`, { method: "GET" });
    if (response.status >= 500) {
      throw new Error(`Server responded with ${response.status}`);
    }
  } catch (error) {
    throw new Error(
      `Consistency smoke needs a running app at ${baseUrl}. Start dev server first. (${formatError(
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

async function getJson(baseUrl: string, path: string, cookie: string): Promise<HttpResult> {
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
    throw new Error("Consistency smoke must not run in production.");
  }

  const baseUrl = (process.env.SMOKE_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, "");
  const adminEmail = process.env.SMOKE_ADMIN_EMAIL || "admin@geofields.co.tz";
  const adminPassword = process.env.SMOKE_ADMIN_PASSWORD || "Admin123!";

  await purgeDanglingSmokeArtifacts(prisma);
  await ensureServerReachable(baseUrl);
  const cookie = await loginAndGetCookie(baseUrl, adminEmail, adminPassword);

  const maintenanceLinkedUsageCount = await prisma.inventoryUsageRequest.count({
    where: {
      status: "APPROVED",
      maintenanceRequestId: { not: null },
      approvedMovementId: { not: null }
    }
  });
  const breakdownLinkedUsageCount = await prisma.inventoryUsageRequest.count({
    where: {
      status: "APPROVED",
      breakdownReportId: { not: null },
      approvedMovementId: { not: null }
    }
  });

  assert(
    maintenanceLinkedUsageCount > 0,
    "No approved maintenance-linked usage requests found. Seed or workflow linkage is incomplete."
  );
  assert(
    breakdownLinkedUsageCount > 0,
    "No approved breakdown-linked usage requests found. Seed or workflow linkage is incomplete."
  );

  const query = new URLSearchParams();
  if (process.env.SMOKE_FROM) query.set("from", process.env.SMOKE_FROM);
  if (process.env.SMOKE_TO) query.set("to", process.env.SMOKE_TO);
  if (process.env.SMOKE_CLIENT_ID) query.set("clientId", process.env.SMOKE_CLIENT_ID);
  if (process.env.SMOKE_RIG_ID) query.set("rigId", process.env.SMOKE_RIG_ID);
  const queryString = query.toString();
  const scopedSuffix = queryString ? `?${queryString}` : "";

  const [dashboard, costTracking, budgets, profit, inventoryExpenses] = await Promise.all([
    getJson(baseUrl, `/api/dashboard/summary${scopedSuffix}`, cookie),
    getJson(baseUrl, `/api/cost-tracking/summary${scopedSuffix}`, cookie),
    getJson(baseUrl, `/api/budgets/summary${scopedSuffix}`, cookie),
    getJson(baseUrl, `/api/profit/summary${scopedSuffix}`, cookie),
    getJson(baseUrl, `/api/inventory/expenses${scopedSuffix}`, cookie)
  ]);

  const results = [
    ["dashboard", dashboard],
    ["cost-tracking", costTracking],
    ["budgets", budgets],
    ["profit", profit],
    ["inventory-expenses", inventoryExpenses]
  ] as const;

  for (const [label, result] of results) {
    assert(result.ok, `${label} request failed (${result.status}): ${result.text}`);
  }

  const dashboardSpend = toNumber((dashboard.json?.snapshot as Record<string, unknown> | null)?.totalExpenses);
  const costTrackingSpend = toNumber(
    (costTracking.json?.overview as Record<string, unknown> | null)?.totalRecognizedSpend
  );
  const budgetsSpend = toNumber(
    (budgets.json?.totals as Record<string, unknown> | null)?.recognizedSpend
  );
  const profitSpend = toNumber((profit.json?.totals as Record<string, unknown> | null)?.totalExpenses);
  const inventoryRecognizedSpend = Array.isArray(inventoryExpenses.json?.data)
    ? roundCurrency(
        (inventoryExpenses.json?.data as Array<Record<string, unknown>>).reduce((sum, row) => {
          return row.recognized ? sum + toNumber(row.amount) : sum;
        }, 0)
      )
    : 0;

  assertClose("Dashboard vs Cost Tracking spend", dashboardSpend, costTrackingSpend);
  assertClose("Dashboard vs Budget vs Actual spend", dashboardSpend, budgetsSpend);
  assertClose("Dashboard vs Profit spend", dashboardSpend, profitSpend);
  assertClose("Dashboard vs Inventory Expenses recognized spend", dashboardSpend, inventoryRecognizedSpend);

  const dashboardPurpose = normalizePurposeSummary(
    (dashboard.json?.operationalPurposeSummary as Record<string, unknown> | null) || null
  );
  const costPurpose = normalizePurposeSummary({
    totalRecognizedSpend: toNumber(
      (costTracking.json?.classificationAudit as Record<string, unknown> | null)?.recognizedSpendTotal
    ),
    ...((costTracking.json?.classificationAudit as Record<string, unknown> | null)
      ?.purposeTotals as Record<string, unknown> | null)
  });
  const budgetPurpose = normalizePurposeSummary({
    totalRecognizedSpend: toNumber(
      (budgets.json?.classification as Record<string, unknown> | null)?.purposeTotals
        ? ((budgets.json?.classification as Record<string, unknown> | null)
            ?.purposeTotals as Record<string, unknown>).recognizedSpendTotal
        : 0
    ),
    ...((budgets.json?.classification as Record<string, unknown> | null)
      ?.purposeTotals as Record<string, unknown> | null)
  });
  const profitPurpose = normalizePurposeSummary(
    (profit.json?.operationalPurposeSummary as Record<string, unknown> | null) || null
  );

  assertClose("Purpose total (dashboard vs cost-tracking)", dashboardPurpose.totalRecognizedSpend, costPurpose.totalRecognizedSpend);
  assertClose("Purpose total (dashboard vs budgets)", dashboardPurpose.totalRecognizedSpend, budgetPurpose.totalRecognizedSpend);
  assertClose("Purpose total (dashboard vs profit)", dashboardPurpose.totalRecognizedSpend, profitPurpose.totalRecognizedSpend);

  const purposeKeys: Array<keyof Omit<PurposeSummary, "totalRecognizedSpend">> = [
    "breakdownCost",
    "maintenanceCost",
    "stockReplenishmentCost",
    "operatingCost",
    "otherUnlinkedCost"
  ];
  for (const key of purposeKeys) {
    assertClose(`Purpose bucket ${key} (dashboard vs cost-tracking)`, dashboardPurpose[key], costPurpose[key]);
    assertClose(`Purpose bucket ${key} (dashboard vs budgets)`, dashboardPurpose[key], budgetPurpose[key]);
    assertClose(`Purpose bucket ${key} (dashboard vs profit)`, dashboardPurpose[key], profitPurpose[key]);
  }

  assert(
    dashboardPurpose.breakdownCost > 0,
    "Breakdown cost is zero in shared classification. Expected seeded or workflow-linked breakdown spend."
  );
  assert(
    dashboardPurpose.maintenanceCost > 0,
    "Maintenance cost is zero in shared classification. Expected seeded or workflow-linked maintenance spend."
  );

  const sumOfBuckets = roundCurrency(
    dashboardPurpose.breakdownCost +
      dashboardPurpose.maintenanceCost +
      dashboardPurpose.stockReplenishmentCost +
      dashboardPurpose.operatingCost +
      dashboardPurpose.otherUnlinkedCost
  );
  assertClose("Purpose bucket sum vs total recognized spend", sumOfBuckets, dashboardPurpose.totalRecognizedSpend);

  console.info("✅ Financial consistency smoke checks passed.");
  console.info(
    JSON.stringify(
      {
        scopedFilters: queryString || "none",
        totals: {
          dashboardSpend,
          costTrackingSpend,
          budgetsSpend,
          profitSpend,
          inventoryRecognizedSpend
        },
        purposeSummary: dashboardPurpose,
        linkageCoverage: {
          maintenanceLinkedApprovedUsageCount: maintenanceLinkedUsageCount,
          breakdownLinkedApprovedUsageCount: breakdownLinkedUsageCount
        }
      },
      null,
      2
    )
  );
}

function roundCurrency(value: number) {
  return Math.round(value * 100) / 100;
}

main()
  .catch(async (error) => {
    console.error("❌ Financial consistency smoke checks failed.");
    console.error(formatError(error));
    await prisma.$disconnect();
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
