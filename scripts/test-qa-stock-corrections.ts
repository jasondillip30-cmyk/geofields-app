import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";

const target = new URL(process.env.DATABASE_URL || "postgresql://invalid");
const base = "http://localhost:3011";
assert.equal(process.env.GEOFIELDS_QA, "1", "Run only with the isolated QA environment.");
assert.equal(process.env.QA_BASE_URL, base);
assert.equal(target.hostname, "127.0.0.1");
assert.equal(target.port, "55432");
assert.equal(target.pathname, "/geofields_qa");
const password = process.env.QA_SEED_PASSWORD;
assert.ok(password);
const db = new PrismaClient();
const endpoint = "/api/inventory/movements";

async function post(path: string, body: unknown, cookie?: string) {
  return fetch(base + path, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(body)
  });
}

async function signIn(role: string) {
  const response = await post("/api/auth/login", { email: `qa.${role}@geofields.test`, password });
  assert.equal(response.status, 200, `QA ${role} sign-in`);
  const cookie = response.headers.get("set-cookie")?.match(/gf_session=[^;]+/)?.[0];
  assert.ok(cookie);
  return cookie;
}

async function main() {
  const [admin, manager, office, mechanic, staff, field] = await Promise.all(
    ["admin", "manager", "office", "mechanic", "staff", "field"].map(signIn)
  );
  const sku = `QA-CORRECTION-${randomUUID()}`;
  const created = await post("/api/inventory/items", {
    name: sku, sku, category: "OTHER", quantityInStock: 10, unitCost: 5, minimumStockLevel: 0
  }, admin);
  assert.equal(created.status, 201, "Create synthetic stock item");
  const { data: { id: itemId } } = await created.json();
  const adjustment = { itemId, movementType: "ADJUSTMENT", quantity: -2, notes: "QA count correction" };

  assert.equal((await post(endpoint, adjustment)).status, 401);
  for (const cookie of [office, mechanic, staff, field]) {
    assert.equal((await post(endpoint, adjustment, cookie)).status, 403);
  }
  assert.equal((await post(endpoint, { ...adjustment, notes: " " }, manager)).status, 400);
  assert.equal((await post(endpoint, { ...adjustment, createExpense: true }, manager)).status, 400);
  assert.equal((await post(endpoint, { ...adjustment, quantity: -11 }, admin)).status, 409);
  assert.equal(await db.inventoryMovement.count({ where: { itemId } }), 0);

  const adjusted = await post(endpoint, adjustment, manager);
  assert.equal(adjusted.status, 201);
  const { data: original, meta } = await adjusted.json();
  assert.deepEqual(meta, { previousStock: 10, nextStock: 8 });
  const reversalPath = `${endpoint}/${original.id}`;
  for (const cookie of [office, mechanic, staff, field]) {
    assert.equal((await post(reversalPath, { reason: "QA reverse" }, cookie)).status, 403);
  }
  assert.equal((await post(reversalPath, { reason: "" }, admin)).status, 400);

  const results = await Promise.all([
    post(reversalPath, { reason: "QA reverse" }, admin),
    post(reversalPath, { reason: "QA reverse" }, admin)
  ]);
  assert.deepEqual(results.map((response) => response.status).sort(), [201, 409]);
  const { data: reversal } = await results.find((response) => response.status === 201)!.json();
  assert.equal(reversal.reversalOfId, original.id);
  assert.equal(reversal.quantity, 2);
  assert.equal((await post(`${endpoint}/${reversal.id}`, { reason: "No chaining" }, manager)).status, 409);

  const [stock, entries, audit] = await Promise.all([
    db.inventoryItem.findUniqueOrThrow({ where: { id: itemId } }),
    db.inventoryMovement.findMany({ where: { itemId } }),
    db.auditLog.findMany({ where: { entityType: "inventory_movement", entityId: { in: [original.id, reversal.id] } } })
  ]);
  assert.equal(stock.quantityInStock, 10);
  assert.equal(stock.unitCost, 5);
  assert.equal(entries.length, 2);
  assert.equal(entries.find((entry) => entry.id === original.id)?.quantity, -2);
  assert.ok(entries.every((entry) => entry.expenseId === null && entry.totalCost === null));
  assert.deepEqual(audit.map((entry) => [entry.action, entry.actorRole]).sort(), [
    ["adjust", "MANAGER"], ["reverse", "ADMIN"]
  ]);
  assert.ok(audit.every((entry) => entry.beforeValueJson && entry.afterValueJson));

  const issued = await post(endpoint, { itemId, movementType: "OUT", quantity: 2, createExpense: true }, admin);
  assert.equal(issued.status, 201, "Create synthetic posted issue");
  const { data: postedIssue } = await issued.json();
  assert.ok(postedIssue.expenseId);
  const expenseBefore = await db.expense.findUniqueOrThrow({ where: { id: postedIssue.expenseId } });
  const originalBefore = await db.inventoryMovement.findUniqueOrThrow({ where: { id: postedIssue.id } });
  const returned = await post(`${endpoint}/${postedIssue.id}`, { reason: "QA stock returned" }, manager);
  assert.equal(returned.status, 201);
  const { data: stockReturn, meta: returnBalance } = await returned.json();
  assert.equal(stockReturn.expenseId, null);
  assert.equal(stockReturn.quantity, 2);
  assert.deepEqual(returnBalance, { previousStock: 8, nextStock: 10 });
  assert.deepEqual(await db.expense.findUniqueOrThrow({ where: { id: postedIssue.expenseId } }), expenseBefore);
  assert.deepEqual(await db.inventoryMovement.findUniqueOrThrow({ where: { id: postedIssue.id } }), originalBefore);
  console.log("QA stock correction checks passed: roles, reasons, nonnegative stock, reversal uniqueness, audit, and preservation of posted expense and movement.");
}

main().finally(() => db.$disconnect()).catch((error) => {
  console.error(error instanceof Error ? error.message : "QA stock correction check failed.");
  process.exitCode = 1;
});
