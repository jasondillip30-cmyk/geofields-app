import assert from "node:assert/strict";
import { NextRequest } from "next/server";

import { GET as spendingSummary } from "../src/app/api/spending/summary/route";
import { GET, POST } from "../src/app/api/projects/[projectId]/operating-costs/route";
import { POST as expenseStatus } from "../src/app/api/expenses/[expenseId]/status/route";
import { signSessionToken } from "../src/lib/auth/session";
import type { AuthSession } from "../src/lib/auth/session-types";
import { nextOperatingCostDate, parseOperatingCostCents, PROJECT_OPERATING_COST_SOURCE } from "../src/lib/project-operating-cost-policy";
import { prisma } from "../src/lib/prisma";

async function main() {
  const url = new URL(process.env.DATABASE_URL || "http://invalid");
  assert.equal(process.env.GEOFIELDS_OPERATING_COST_TEST, "1");
  assert.equal(url.protocol, "postgresql:");
  assert.equal(url.hostname, "127.0.0.1");
  assert.equal(url.port, "55442");
  assert.equal(url.pathname, "/geofields_operating_costs_test");
  assert.equal(url.search, "");
  const [db] = await prisma.$queryRaw<Array<{ name: string }>>`SELECT current_database() AS name`;
  assert.equal(db.name, "geofields_operating_costs_test");
  assert.equal(await prisma.user.count(), 0, "Start with an empty disposable database.");
  assert.equal(await prisma.project.count(), 0, "Start with an empty disposable database.");
  assert.equal(await prisma.expense.count(), 0, "Start with an empty disposable database.");
  assert.equal(parseOperatingCostCents("0.10"), 10);
  assert.equal(parseOperatingCostCents("1.001"), null);
  const feb = nextOperatingCostDate(new Date("2025-01-31"), "MONTHLY", 31)!;
  assert.equal(feb.toISOString().slice(0, 10), "2025-02-28");
  assert.equal(nextOperatingCostDate(feb, "MONTHLY", 31)?.toISOString().slice(0, 10), "2025-03-31");

  async function user(email: string, role: AuthSession["role"], isActive = true) {
    return prisma.user.create({ data: { email, fullName: email.split("@")[0], passwordHash: "synthetic-not-a-login", role, isActive } });
  }
  const manager = await user("QA Manager@example.invalid", "MANAGER");
  const office = await user("QA Office@example.invalid", "OFFICE");
  const inactive = await user("Inactive Admin@example.invalid", "ADMIN", false);
  const driller = await user("Private Driller@example.invalid", "FIELD");
  const helper = await user("Private Helper@example.invalid", "FIELD");
  const client = await prisma.client.create({ data: { name: "Operating Cost Test Client" } });
  const project = await prisma.project.create({ data: {
    clientId: client.id, name: "Operating Cost Test Project", location: "Test Site", startDate: new Date("2025-01-01")
  } });
  const context = { params: Promise.resolve({ projectId: project.id }) };

  async function request(path: string, actor = manager, body?: object) {
    const jwt = await signSessionToken({ userId: actor.id, name: actor.fullName, role: actor.role, email: actor.email });
    return new NextRequest("http://localhost" + path, {
      method: body ? "POST" : "GET",
      headers: { cookie: "gf_session=" + jwt, "content-type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
  }
  const endpoint = "/api/projects/" + project.id + "/operating-costs";
  async function action(body: object, expected = 200) {
    const response = await POST(await request(endpoint, manager, body), context);
    const result = await response.json();
    assert.equal(response.status, expected, JSON.stringify(result));
    return result;
  }
  async function assertTotals(expenses: number) {
    const response = await spendingSummary(await request("/api/spending/summary?projectId=" + project.id + "&from=2025-01-01&to=2025-01-31", office));
    const result = await response.json();
    assert.equal(response.status, 200, JSON.stringify(result));
    assert.equal(result.totals.expenses, expenses);
    assert.equal(result.totals.netCashFlow, -expenses || 0);
    assert.doesNotMatch(JSON.stringify(result), /Private Driller|Private Helper|private correction/i);
    return result;
  }

  for (const actor of [office, inactive, driller]) {
    assert.equal((await GET(await request(endpoint, actor), context)).status, 403);
    assert.equal((await POST(await request(endpoint, actor, { action: "generate" }), context)).status, 403);
  }
  const crew = { action: "create", kind: "CREW_PAY", cadence: "MONTHLY", startsOn: "2025-01-01", endsOn: "2025-01-31", crewJob: "Driller" };
  await action({ ...crew, employeeId: driller.id, amount: "1200.00" });
  await action({ ...crew, employeeId: driller.id, amount: "1200.00" }, 409);
  await action({ ...crew, employeeId: helper.id, amount: "800.00", crewJob: "Assistant" });
  await action({ action: "create", kind: "FOOD", cadence: "DAILY", startsOn: "2025-01-02", endsOn: "2025-01-04", amount: "50", label: "Crew meals" });
  const generations = await Promise.all([action({ action: "generate" }), action({ action: "generate" })]);
  assert.deepEqual(generations.map((result) => result.count).sort(), [0, 2]);
  await assertTotals(0);
  const workspaceResponse = await GET(await request(endpoint + "?month=2025-01"), context);
  assert.equal(workspaceResponse.status, 200);
  assert.equal(workspaceResponse.headers.get("cache-control"), "private, no-store");
  const entries = await prisma.projectOperatingCostDraft.findMany({ include: { plan: true } });
  assert.equal(entries.length, 5);
  const crewIds = entries.filter((row) => row.plan.kind === "CREW_PAY").map((row) => row.id);
  const meals = entries.find((row) => row.costDate.toISOString().startsWith("2025-01-02"))!;
  const confirmMeals = { action: "confirm", kind: "FOOD", costDate: "2025-01-02", draftIds: [meals.id], expectedCents: 7500 };
  const confirmCrew = { action: "confirm", kind: "CREW_PAY", costDate: "2025-01-01", draftIds: crewIds, expectedCents: 200000 };
  await action({ action: "skip", id: meals.id });
  await action(confirmMeals, 409);
  await action({ action: "restore", id: meals.id });
  await action({ action: "edit", id: meals.id, amount: "75" });
  await action({ ...confirmMeals, expectedCents: 5000 }, 409);
  await action(confirmMeals);
  const results = await Promise.all([0, 1].map(async () => POST(await request(endpoint, manager, confirmCrew), context)));
  assert.deepEqual(results.map((response) => response.status).sort(), [200, 409]);
  const { expenseId } = await results.find((response) => response.ok)!.json();
  const posted = await prisma.expense.findMany({ where: { entrySource: PROJECT_OPERATING_COST_SOURCE } });
  assert.equal(posted.length, 2);
  assert.equal(posted.find((row) => row.id === expenseId)?.amount, 2000);
  assert.equal(await prisma.inventoryMovement.count(), 0);
  const summary = await assertTotals(2075);
  assert.deepEqual(Object.fromEntries(summary.expenseByCategory.map((row: { category: string; total: number }) => [row.category, row.total])), { Labor: 2000, "Camp Food": 75 });
  assert.equal((await expenseStatus(await request("/api/expenses/" + expenseId + "/status", manager, { action: "reopen" }), { params: Promise.resolve({ expenseId }) })).status, 409);
  await action({ action: "reverse", id: expenseId, reason: "Private correction" });
  await assertTotals(75);
  assert.equal((await prisma.projectOperatingCostCorrection.findUnique({ where: { expenseId } }))?.reason, "Private correction");
  assert.doesNotMatch(JSON.stringify(await prisma.auditLog.findMany()), /Private Driller|Private Helper|private correction/i);
  await action(confirmCrew);
  await assertTotals(2075);
  console.log("Operating-cost regression passed: recurrence, approval boundaries, privacy, reconciliation, and reversal.");
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
