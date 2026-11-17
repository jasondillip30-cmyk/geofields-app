const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { PrismaClient } = require("@prisma/client");
const { chromium, devices } = require("playwright");

assert.equal(process.env.GEOFIELDS_QA, "1");
assert.equal(process.env.DATABASE_URL, "postgresql://shiftqa@127.0.0.1:55450/geofields_offline_test");
assert.ok(process.env.QA_PASSWORD, "Use the isolated QA account's password.");
const db = new PrismaClient();

async function main() {
  const [identity] = await db.$queryRaw`SELECT current_database() AS db, current_user AS account`;
  assert.deepEqual(identity, { db: "geofields_offline_test", account: "shiftqa" });
  assert.equal(await db.user.count({ where: { NOT: { email: { endsWith: "@example.invalid" } } } }), 0);
  const browser = await chromium.launch();
  const marker = "Synthetic QA safety " + randomUUID();
  try {
    const context = await browser.newContext({ ...devices["iPhone 13"], baseURL: "http://127.0.0.1:3110" });
    context.setDefaultTimeout(16000);
    const page = await context.newPage();
    const button = (name) => page.getByRole("button", { name, exact: true });
    await page.goto("/login?next=%2Foffline-drilling.html");
    await page.getByLabel("Email").fill("receipt-preview@example.invalid");
    await page.getByLabel("Password").fill(process.env.QA_PASSWORD);
    await button("Sign In").click();
    await button("Prepare or refresh field setup").click();
    await page.getByText(/Ready for offline use/).waitFor();
    const { id, fullName, email, role, isActive, phone, title, profileImageUrl, currentAssignment } =
      await db.user.findUniqueOrThrow({ where: { email: "receipt-preview@example.invalid" } });
    const designate = await page.request.put("/api/employees/" + id, { data: {
      fullName, email, role, isActive, phone, title, profileImageUrl, currentAssignment, isSafetyReviewer: true
    } });
    assert.equal(designate.status(), 200);
    await context.setOffline(true);
    await page.reload();
    await page.locator("#offline-safety-panel summary").click();
    await page.locator("#offline-safety-form [name=kind]").selectOption("NEAR_MISS");
    await page.locator("#offline-safety-form [name=location]").fill(marker);
    await page.locator("#offline-safety-form [name=description]").fill("Synthetic QA: an item slipped without hitting anyone.");
    await button("Save report on this phone").click();
    await page.getByText(/1 incident report.s. saved here, not sent/).waitFor();
    assert.equal(await db.safetyIncident.count({ where: { location: marker } }), 0);
    await page.reload();
    await page.getByText(/1 incident report.s. saved here, not sent/).waitFor();
    assert.ok(await button("Send saved incident reports").isDisabled());
    await context.setOffline(false);
    assert.equal(await db.safetyIncident.count({ where: { location: marker } }), 0);
    await button("Send saved incident reports").click();
    await page.getByText(/Incident reports recorded in GeoFields/).waitFor();
    assert.equal(await db.safetyIncident.count({ where: { location: marker } }), 1);
    await page.goto("/safety-incidents");
    const item = page.getByRole("listitem").filter({ hasText: marker });
    await item.getByRole("button", { name: "Open case" }).click();
    await page.getByText(/Synthetic QA: an item slipped/).waitFor();
    await page.locator("[name=confirmedImpact]").selectOption("NO_INJURY");
    await page.locator("[name=highPotential]").selectOption("no");
    await button("Save review").click();
    await page.getByText(/Under review/).waitFor();
    await page.locator("[name=closeoutNote]").fill("Synthetic QA only: no follow-up needed.");
    await button("Close case").click();
    await page.getByText("Synthetic QA only: no follow-up needed.", { exact: true }).waitFor();
    assert.equal((await db.safetyIncident.findFirstOrThrow({ where: { location: marker } })).state, "CLOSED");
    console.log("Safety browser QA passed: offline local save, reload, explicit reconnect send, review and close.");
  } finally {
    await browser.close();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => db.$disconnect());
