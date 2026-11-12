import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";

const base = "http://localhost:3011";
const url = new URL(process.env.DATABASE_URL || "postgresql://invalid");
assert.equal(process.env.GEOFIELDS_QA, "1");
assert.equal(process.env.QA_WORKTREE_ROOT, process.cwd());
assert.equal(process.env.QA_BASE_URL, base);
assert.equal(url.protocol, "postgresql:");
assert.equal(url.hostname, "127.0.0.1");
assert.equal(url.port, "55432");
assert.equal(url.pathname, "/geofields_qa");
const password = process.env.QA_SEED_PASSWORD;
assert.ok(password);
const projectId = process.argv[2];
assert.ok(projectId, "Pass the browser-created Cedar QA project ID.");
const db = new PrismaClient();
const tag = `QA-CEDAR-${randomUUID().slice(0, 8)}`;

async function request(path: string, cookie?: string, data?: object) {
  const response = await fetch(base + path, {
    method: data ? "POST" : "GET",
    headers: {
      ...(cookie ? { Cookie: cookie } : {}),
      ...(data ? { "Content-Type": "application/json" } : {})
    },
    body: data ? JSON.stringify(data) : undefined,
    signal: AbortSignal.timeout(30_000)
  });
  const json = await response.json().catch(() => null);
  return { response, json };
}

async function login(role: string) {
  const { response } = await request("/api/auth/login", undefined, {
    email: `qa.${role}@geofields.test`, password
  });
  assert.equal(response.status, 200, `QA ${role} login`);
  const cookie = response.headers.get("set-cookie")?.match(/gf_session=[^;]+/)?.[0];
  assert.ok(cookie);
  return cookie;
}

async function post(path: string, cookie: string, data: object, expected: number) {
  const { response, json } = await request(path, cookie, data);
  assert.equal(response.status, expected, `${path}: ${json?.message || json?.error || response.statusText}`);
  return json;
}

async function main() {
  assert.ok(await db.summaryReport.findUnique({ where: { id: "qa-environment-marker" } }));
  const project = await db.project.findUniqueOrThrow({
    where: { id: projectId }, include: { assignedRig: true, backupRig: true, billingRateItems: true }
  });
  assert.equal(project.name, "QA Pilot Cedar Drilling");
  const drillingRig = project.assignedRig;
  const maintenanceRig = project.backupRig;
  assert.equal(drillingRig?.status, "ACTIVE");
  assert.equal(maintenanceRig?.status, "IDLE");
  assert.ok(drillingRig && maintenanceRig);
  const rate = project.billingRateItems.find((line) => line.isActive && line.itemCode === "METER_DRILLED_0M_200M");
  assert.equal(rate?.unitRate, 120);
  assert.ok(rate);
  const [manager, office, mechanic, field] = await Promise.all(["manager", "office", "mechanic", "field"].map(login));
  const date = new Date().toISOString().slice(0, 10);

  const invalidName = `${tag} no billing`;
  const draft = { name: invalidName, clientId: project.clientId, location: project.location, startDate: date, contractRatePerM: 120 };
  for (const body of [
    draft, { ...draft, billingRateItems: [] },
    { ...draft, billingRateItems: [{ itemCode: "METER_DRILLED", label: "Meters", unit: "meter", unitRate: 120, isActive: false }] }
  ]) {
    const rejected = await post("/api/projects", manager, body, 400);
    assert.match(rejected.message, /active billing line/i);
  }
  assert.equal(await db.project.count({ where: { name: invalidName } }), 0);
  console.log("Project creation rejects missing, empty, and archived-only billing lines.");

  async function totals(income: number, expenses: number, metersDrilled: number) {
    const { response, json } = await request(`/api/spending/summary?projectId=${project.id}`, manager);
    assert.equal(response.status, 200);
    assert.deepEqual(json.totals, { income, expenses, netCashFlow: income - expenses, metersDrilled });
  }
  await totals(0, 0, 0);

  const setup = await request("/api/requisitions/setup", office);
  assert.equal(setup.response.status, 200);
  const category = (setup.json.data.categories as Array<{ id: string; name: string }>).find(
    (entry) => entry.name === "Materials"
  );
  assert.ok(category, "Materials category must be configured for the QA requisition.");
  const item = await post("/api/inventory/items", manager, {
    name: `${tag} Workshop Seal`, sku: tag, category: "SPARE_PARTS", quantityInStock: 0, unitCost: 25,
    minimumStockLevel: 0, locationId: "qa-location-main"
  }, 201);
  const itemId: string = item.data.id;
  const requisition = await post("/api/requisitions", office, {
    type: "INVENTORY_STOCK_UP", categoryId: category.id, stockLocationId: "qa-location-main", notes: tag,
    lineItems: [{ description: item.data.name, quantity: 10, estimatedUnitCost: 25 }]
  }, 201);
  const requisitionId: string = requisition.data.id;
  assert.equal(requisition.data.status, "SUBMITTED");
  await post(`/api/requisitions/${requisitionId}/status`, office, { action: "approve" }, 403);
  const approved = await post(`/api/requisitions/${requisitionId}/status`, manager, { action: "approve" }, 200);
  assert.equal(approved.data.status, "APPROVED");

  const receipt = {
    requisitionId, receiptType: "INVENTORY_PURCHASE", receiptPurpose: "INVENTORY_PURCHASE",
    workflowType: "STOCK_PURCHASE", createExpense: false,
    receipt: { supplierId: "qa-supplier-industrial", supplierName: "QA Industrial Supplies", receiptNumber: tag, receiptDate: date, total: 250 },
    linkContext: { locationToId: "qa-location-main" },
    lines: [{ description: item.data.name, mode: "MATCH", selectedItemId: itemId, quantity: 10, unitPrice: 25 }]
  };
  const posted = await request("/api/inventory/receipt-intake/commit", manager, receipt);
  assert.ok(posted.response.ok, posted.json?.message || JSON.stringify(posted.json));
  assert.equal(posted.json.data.requisitionStatus, "PURCHASE_COMPLETED");
  const retry = await request("/api/inventory/receipt-intake/commit", manager, receipt);
  assert.equal(retry.response.status, 409);
  const stockAfterReceipt = await db.inventoryItem.findUniqueOrThrow({ where: { id: itemId } });
  const movementsAfterReceipt = await db.inventoryMovement.findMany({ where: { itemId } });
  assert.equal(stockAfterReceipt.quantityInStock, 10);
  assert.equal(movementsAfterReceipt.length, 1);
  assert.equal(movementsAfterReceipt[0].movementType, "IN");
  assert.equal(movementsAfterReceipt[0].totalCost, 250);
  assert.equal(movementsAfterReceipt[0].projectId, null);
  assert.equal(movementsAfterReceipt[0].expenseId, null);
  await totals(0, 0, 0);
  console.log(`Workshop requisition ${requisitionId}: 10 units received for $250, no project charge; duplicate blocked.`);

  const drill = await post("/api/drilling-reports", field, {
    date, projectId, rigId: drillingRig.id, holeNumber: `${tag}-01`, areaLocation: project.location,
    fromMeter: 0, toMeter: 20, workHours: 2, billableLines: [{ itemCode: rate.itemCode, unit: rate.unit, quantity: 20 }]
  }, 201);
  assert.equal(drill.data.approvalStatus, "SUBMITTED");
  await totals(0, 0, 0);
  await post(`/api/drilling-reports/${drill.data.id}/status`, office, { action: "approve" }, 403);
  await post(`/api/drilling-reports/${drill.data.id}/status`, manager, { action: "approve" }, 200);
  await totals(2400, 0, 20);
  console.log(`Drilling report ${drill.data.id}: 20 m posted $2,400 only after Manager approval.`);

  const maintenance = await post("/api/maintenance-requests", mechanic, {
    rigId: maintenanceRig.id, projectId, issueDescription: `${tag} replace seals on backup rig`, status: "OPEN"
  }, 201);
  const usage = await post("/api/inventory/usage-requests", mechanic, {
    itemId, quantity: 3, reasonType: "MAINTENANCE", reasonDetails: tag, projectId,
    rigId: maintenanceRig.id, maintenanceRequestId: maintenance.data.id, locationId: "qa-location-main"
  }, 201);
  await totals(2400, 0, 20);
  const issuePath = `/api/inventory/usage-requests/${usage.data.id}/status`;
  const issued = await post(issuePath, office, { action: "approve", note: tag }, 200);
  await post(issuePath, office, { action: "approve", note: tag }, 409);
  const stock = await db.inventoryItem.findUniqueOrThrow({ where: { id: itemId } });
  const movements = await db.inventoryMovement.findMany({ where: { itemId } });
  const expense = await db.expense.findUniqueOrThrow({ where: { id: issued.expenseId } });
  const out = movements.find((movement) => movement.id === issued.movementId);
  assert.equal(stock.quantityInStock, 7);
  assert.equal(movements.length, 2);
  assert.equal(out?.movementType, "OUT");
  assert.equal(out?.quantity, 3);
  assert.equal(out?.projectId, projectId);
  assert.equal(out?.maintenanceRequestId, maintenance.data.id);
  assert.equal(expense.amount, 75);
  assert.equal(expense.projectId, projectId);
  assert.equal(expense.approvalStatus, "APPROVED");
  await totals(2400, 75, 20);
  const { response, json } = await request(`/api/spending/drilling-reports/summary?projectId=${projectId}`, manager);
  assert.equal(response.status, 200);
  assert.equal(json.summary.totalCostPerMeter, 3.75);
  console.log(`Usage request ${usage.data.id}: 3 units issued, 7 remain, project expense $75. Profit $2,325; cost per meter $3.75.`);
}

main().finally(() => db.$disconnect()).catch((error) => {
  console.error(error instanceof Error ? error.message : "QA pilot flow failed.");
  process.exitCode = 1;
});
