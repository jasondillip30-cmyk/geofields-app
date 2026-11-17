const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { PrismaClient } = require("@prisma/client");
const { chromium, devices } = require("playwright");

const baseURL = "http://127.0.0.1:3112";
assert.equal(process.env.GEOFIELDS_QA, "1");
assert.equal(process.env.DATABASE_URL, "postgresql://shiftqa@127.0.0.1:55450/geofields_offline_test");
assert.ok(process.env.AUTH_SECRET && process.env.AUTH_SECRET.length >= 32, "Use the isolated server session secret.");
const db = new PrismaClient();

async function main() {
  const [identity] = await db.$queryRaw`SELECT current_database() AS db, current_user AS account`;
  assert.deepEqual(identity, { db: "geofields_offline_test", account: "shiftqa" });
  assert.equal(await db.user.count({ where: { NOT: { email: { endsWith: "@example.invalid" } } } }), 0);
  const [reviewer, office, mechanic] = await Promise.all([
    db.user.findUniqueOrThrow({ where: { email: "receipt-preview@example.invalid" } }),
    db.user.findFirstOrThrow({ where: { role: "OFFICE", isActive: true } }),
    db.user.findFirstOrThrow({ where: { role: "MECHANIC", isActive: true } })
  ]);
  const { SignJWT } = await import("jose");
  const browser = await chromium.launch();
  try {
    async function openAs(user) {
      const token = await new SignJWT({ userId: user.id, email: user.email, role: user.role, name: user.fullName })
        .setProtectedHeader({ alg: "HS256" }).setExpirationTime("15m").sign(new TextEncoder().encode(process.env.AUTH_SECRET));
      const context = await browser.newContext({ ...devices["iPhone 13"], baseURL });
      context.setDefaultTimeout(16000);
      await context.addCookies([{ name: "gf_session", value: token, url: baseURL }]);
      return context.newPage();
    }
    const reviewerPage = await openAs(reviewer);
    await reviewerPage.goto("/employees/setup?workspace=all-projects");
    const createName = "Synthetic QA appointed reviewer " + randomUUID().slice(0, 8);
    const createEmail = randomUUID() + "@example.invalid";
    const reviewCheckbox = reviewerPage.getByRole("checkbox", { name: "Safety reviewer" });
    await reviewCheckbox.waitFor();
    assert.ok(await reviewCheckbox.isDisabled());
    await reviewerPage.getByLabel("Full Name", { exact: true }).fill(createName);
    await reviewerPage.getByLabel("Email", { exact: true }).fill(createEmail);
    await reviewerPage.getByLabel("Password", { exact: true }).fill(randomUUID());
    await reviewerPage.locator("form select").selectOption("MANAGER");
    await reviewCheckbox.check();
    const [creation] = await Promise.all([
      reviewerPage.waitForResponse((response) => response.url().endsWith("/api/employees") && response.request().method() === "POST"),
      reviewerPage.getByRole("button", { name: "Create Employee", exact: true }).click()
    ]);
    assert.equal(creation.status(), 201);
    await reviewerPage.getByText("Employee created successfully.", { exact: true }).waitFor();
    const created = await db.user.findUniqueOrThrow({ where: { email: createEmail } });
    assert.equal(created.isSafetyReviewer, true);
    const page = await openAs(office);
    await page.goto("/employees?workspace=all-projects");
    const reviewerRow = page.getByRole("article").filter({ hasText: createEmail });
    await reviewerRow.getByText("Safety reviewer", { exact: true }).waitFor();
    assert.equal(await reviewerRow.getByRole("link", { name: "Edit", exact: true }).count(), 0);
    await reviewerPage.goto("/employees/setup?workspace=all-projects&employeeId=" + created.id);
    await reviewerPage.getByText("Editing employee: " + createName, { exact: true }).waitFor();
    assert.ok(await reviewCheckbox.isChecked());
    await reviewCheckbox.uncheck();
    const [updated] = await Promise.all([
      reviewerPage.waitForResponse((response) => response.url().includes("/api/employees/" + created.id) && response.request().method() === "PUT"),
      reviewerPage.getByRole("button", { name: "Update Employee", exact: true }).click()
    ]);
    assert.equal(updated.status(), 200);
    assert.equal((await db.user.findUniqueOrThrow({ where: { id: created.id } })).isSafetyReviewer, false);
    const { id: employeeId, fullName, email, role, isActive, phone, title, profileImageUrl, currentAssignment } = reviewer;
    const designate = await reviewerPage.request.put("/api/employees/" + employeeId, { data: {
      fullName, email, role, isActive, phone, title, profileImageUrl, currentAssignment, isSafetyReviewer: true
    } });
    assert.equal(designate.status(), 200);
    const privateTitle = "Synthetic confidential QA " + randomUUID();
    const submitted = await reviewerPage.request.post("/api/safety-incidents", { data: {
      submissionKey: randomUUID(), occurredAt: new Date().toISOString(), kind: "INJURY",
      location: "QA workshop", description: privateTitle, injuryObserved: true
    } });
    assert.equal(submitted.status(), 201);
    const { id } = await submitted.json();
    const brief = "Arrange a guard inspection";
    const briefResponse = await reviewerPage.request.patch("/api/safety-incidents/" + id, { data: { command: "PUBLISH_BRIEF", revision: 0, brief } });
    assert.equal(briefResponse.status(), 200);
    await page.goto("/safety-incidents");
    await page.getByRole("heading", { name: "Office follow-up queue" }).waitFor();
    const row = page.getByRole("listitem").filter({ hasText: "Case " + id.slice(-8).toUpperCase() });
    await row.getByRole("button", { name: "Open follow-up" }).click();
    await page.getByText(brief, { exact: true }).waitFor();
    assert.equal(await page.getByText(privateTitle, { exact: true }).count(), 0);
    assert.equal(await row.getByText("Injury / first aid", { exact: true }).count(), 0);
    assert.equal(await page.getByRole("button", { name: "Save review", exact: true }).count(), 0);
    assert.equal(await page.getByRole("button", { name: "Close case", exact: true }).count(), 0);
    await page.locator('input[name="task"]').fill("Inspect and document the guard");
    await page.locator('select[name="ownerId"]').selectOption(mechanic.id);
    await page.locator('input[name="dueDate"]').fill("2000-01-01");
    await page.getByRole("button", { name: "Assign action", exact: true }).click();
    await page.getByText("Follow-up assigned.", { exact: true }).waitFor();
    await row.getByText("1 overdue", { exact: true }).waitFor();
    assert.equal(await db.safetyAction.count({ where: { incidentId: id, ownerId: mechanic.id } }), 1);
    console.log("Mobile safety QA passed: Manager appoints and removes a reviewer, Office sees but cannot edit the flag, and the Office queue stays redacted.");
  } finally { await browser.close(); }
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => db.$disconnect());
