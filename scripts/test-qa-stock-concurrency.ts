import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { PrismaClient, type Prisma } from "@prisma/client";

const base = "http://localhost:3011";
const database = new URL(process.env.DATABASE_URL || "postgresql://invalid");
assert.equal(process.env.GEOFIELDS_QA, "1");
assert.equal(process.env.QA_WORKTREE_ROOT, process.cwd());
assert.equal(process.env.QA_BASE_URL, base);
assert.equal(database.protocol, "postgresql:");
assert.equal(database.hostname, "127.0.0.1");
assert.equal(database.port, "55432");
assert.equal(database.pathname, "/geofields_qa");
const password = process.env.QA_SEED_PASSWORD;
assert.ok(password);
const db = new PrismaClient();

async function post(path: string, body: unknown, cookie?: string) {
  const response = await fetch(base + path, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(body)
  });
  return {
    status: response.status,
    payload: await response.json(),
    session: response.headers.get("set-cookie")?.match(/gf_session=[^;]+/)?.[0]
  };
}

async function login(role: string) {
  const result = await post("/api/auth/login", { email: `qa.${role}@geofields.test`, password });
  assert.equal(result.status, 200, `QA ${role} login`);
  assert.ok(result.session);
  return result.session;
}

async function waitForBlockedClients(blockerPid: number, count: number) {
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    const [row] = await db.$queryRaw<Array<{ blocked: number }>>`
      WITH RECURSIVE lock_queue(pid) AS (
        SELECT ${blockerPid}::int
        UNION
        SELECT activity.pid FROM pg_stat_activity activity JOIN lock_queue
          ON lock_queue.pid = ANY(pg_blocking_pids(activity.pid))
        WHERE activity.datname = current_database()
      )
      SELECT (count(*) - 1)::int AS blocked FROM lock_queue`;
    if (row.blocked >= count) return;
    await delay(35);
  }
  throw new Error(`Expected ${count} stock writers to queue in PostgreSQL.`);
}

async function overlap(
  hold: (tx: Prisma.TransactionClient) => Promise<unknown>,
  first: () => ReturnType<typeof post>,
  second: () => ReturnType<typeof post>
) {
  const requests: Array<ReturnType<typeof post>> = [];
  try {
    await db.$transaction(async (tx) => {
      await hold(tx);
      const [blocker] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
      requests.push(first());
      await waitForBlockedClients(blocker.pid, 1);
      requests.push(second());
      await waitForBlockedClients(blocker.pid, 2);
    }, { timeout: 20_000 });
  } catch (error) {
    await Promise.allSettled(requests);
    throw error;
  }
  return Promise.all(requests);
}

async function main() {
  assert.ok(await db.summaryReport.findUnique({ where: { id: "qa-environment-marker" } }));
  const [manager, office, mechanic] = await Promise.all(["manager", "office", "mechanic"].map(login));
  const maintenance = await db.maintenanceRequest.findUniqueOrThrow({ where: { id: "qa-maintenance-routine" } });
  const context = {
    reasonType: "MAINTENANCE", maintenanceRequestId: maintenance.id,
    projectId: maintenance.projectId, rigId: maintenance.rigId
  };
  async function createItem() {
    const sku = `QA-STOCK-RACE-${randomUUID()}`;
    const item = await post("/api/inventory/items", {
      name: sku, sku, category: "OTHER", quantityInStock: 10, unitCost: 5, minimumStockLevel: 0
    }, manager);
    assert.equal(item.status, 201, "Create synthetic inventory item");
    return { itemId: item.payload.data.id as string, sku };
  }
  async function submit(itemId: string, quantity: number, sku: string) {
    const result = await post("/api/inventory/usage-requests", {
      ...context, itemId, quantity, reasonDetails: sku
    }, mechanic);
    assert.equal(result.status, 201, result.payload.message);
    return result.payload.data as { id: string; status: string };
  }
  const decide = (id: string, action: "approve" | "reject", note: string) =>
    post(`/api/inventory/usage-requests/${id}/status`, { action, note }, office);
  const holdItem = (itemId: string) => (tx: Prisma.TransactionClient) =>
    tx.$queryRaw`SELECT id FROM "InventoryItem" WHERE id = ${itemId} FOR NO KEY UPDATE`;
  for (const scenario of [
    { name: "two Office issues fit", first: 3, second: 4, firstIsIssue: true, bothFit: true },
    { name: "two Office issues overdraw", first: 7, second: 6, firstIsIssue: true, bothFit: false },
    { name: "Manager adjustment and Office issue fit", first: 3, second: 4, firstIsIssue: false, bothFit: true },
    { name: "Manager adjustment and Office issue overdraw", first: 7, second: 6, firstIsIssue: false, bothFit: false }
  ]) {
    const { itemId, sku } = await createItem();
    const first = scenario.firstIsIssue ? await submit(itemId, scenario.first, sku) : null;
    const second = await submit(itemId, scenario.second, sku);
    // Force the write attempts to overlap without changing fixture stock outside the API.
    const results = await overlap(holdItem(itemId),
      () => first ? decide(first.id, "approve", sku) : post("/api/inventory/movements", {
          itemId, movementType: "ADJUSTMENT", quantity: -scenario.first, notes: sku
      }, manager),
      () => decide(second.id, "approve", sku));
    const [stock, movements, usageRequests, expenses] = await Promise.all([
      db.inventoryItem.findUniqueOrThrow({ where: { id: itemId } }),
      db.inventoryMovement.findMany({ where: { itemId } }),
      db.inventoryUsageRequest.findMany({ where: { itemId } }),
      db.expense.count({ where: { notes: { contains: sku } } })
    ]);
    const ledgerStock = movements.reduce((balance, movement) =>
      balance + (movement.movementType === "OUT" ? -movement.quantity : movement.quantity), 10);
    console.log(`${scenario.name}: HTTP ${results.map((result) => result.status).join("/")}, balance=${stock.quantityInStock}, ledger=${ledgerStock}, expenses=${expenses}`);
    assert.equal(stock.quantityInStock, ledgerStock, "Physical stock must match the movement ledger");
    assert.ok(stock.quantityInStock >= 0);
    const successes = results.map((result, index) => result.status === (index === 0 && !first ? 201 : 200));
    assert.equal(successes.filter(Boolean).length, scenario.bothFit ? 2 : 1);
    results.forEach((result, index) => { if (!successes[index]) assert.equal(result.status, 409); });
    assert.equal(movements.length, scenario.bothFit ? 2 : 1);
    assert.equal(expenses, Number(Boolean(first && successes[0])) + Number(successes[1]));
    [first, second].forEach((submitted, index) => {
      if (!submitted) return;
      const request = usageRequests.find((entry) => entry.id === submitted.id);
      assert.equal(request?.status, successes[index] ? "APPROVED" : submitted.status);
      assert.equal(Boolean(request?.approvedMovementId), successes[index]);
    });
  }

  const { itemId, sku } = await createItem();
  const submittedBatch = await post("/api/inventory/usage-requests/batches", {
    ...context, reasonDetails: sku, lines: [{ itemId, quantity: 4 }]
  }, mechanic);
  assert.equal(submittedBatch.status, 201, submittedBatch.payload.message);
  const batch = submittedBatch.payload.data;
  const receipt = {
    receiptType: "INVENTORY_PURCHASE",
    receiptPurpose: "INVENTORY_PURCHASE",
    workflowType: "STOCK_PURCHASE",
    createExpense: false,
    receipt: { supplierId: "qa-supplier-industrial", supplierName: "QA Industrial Supplies", receiptNumber: sku, total: 25 },
    linkContext: { locationToId: "qa-location-main" },
    lines: [2, 3].map((quantity) => ({ description: sku, mode: "MATCH", selectedItemId: itemId, quantity, unitPrice: 5 }))
  };
  const [intake, usage] = await overlap(holdItem(itemId),
    () => post("/api/inventory/receipt-intake/commit", receipt, manager),
    () => post(`/api/inventory/usage-requests/batches/${batch.id}/decision`, {
      decisions: [{ lineId: batch.lines[0].id, action: "approve", note: sku }]
    }, office));
  assert.ok(intake.status >= 200 && intake.status < 300, intake.payload.message);
  assert.equal(usage.status, 200, usage.payload.message);
  const finalStock = await db.inventoryItem.findUniqueOrThrow({ where: { id: itemId } });
  const batchMovements = await db.inventoryMovement.findMany({ where: { itemId } });
  assert.equal(finalStock.quantityInStock, 11);
  assert.deepEqual(batchMovements.map((entry) => [entry.movementType, entry.quantity]).sort(), [
    ["IN", 2], ["IN", 3], ["OUT", 4]
  ]);
  console.log("Receipt plus Office batch: balance=11, ledger=11, both receipt lines counted");

  const dispute = await createItem();
  const submitted = await submit(dispute.itemId, 4, dispute.sku);
  const decisions = await overlap(
    (tx) => tx.$queryRaw`SELECT id FROM "InventoryUsageRequest" WHERE id = ${submitted.id} FOR NO KEY UPDATE`,
    () => decide(submitted.id, "approve", dispute.sku),
    () => decide(submitted.id, "reject", dispute.sku));
  assert.deepEqual(decisions.map((result) => result.status).sort(), [200, 409]);
  const decided = await db.inventoryUsageRequest.findUniqueOrThrow({ where: { id: submitted.id } });
  const approved = decisions[0].status === 200;
  assert.equal(decided.status, approved ? "APPROVED" : "REJECTED");
  assert.equal(Boolean(decided.approvedMovementId), approved);
  assert.equal(await db.inventoryMovement.count({ where: { itemId: dispute.itemId } }), approved ? 1 : 0);
  assert.equal(await db.expense.count({ where: { notes: { contains: dispute.sku } } }), approved ? 1 : 0);
  console.log("Simultaneous approve/reject: exactly one decision posted");
}

main().finally(() => db.$disconnect()).catch((error) => {
  console.error(error instanceof Error ? error.message : "QA stock concurrency check failed.");
  process.exitCode = 1;
});
