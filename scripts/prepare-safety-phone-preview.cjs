const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { hash } = require("bcryptjs");
const { PrismaClient } = require("@prisma/client");
require("./check-phone-preview.cjs");
assert.notEqual(process.exitCode, 1, "Phone preview isolation check must pass before writes.");
assert.match(process.env.QA_SAFETY_PASSWORD || "", /^[a-f0-9]{24}$/, "A test-only password must be configured.");
const db = new PrismaClient();
const roles = ["ADMIN", "MANAGER", "OFFICE", "MECHANIC", "FIELD"];
const allowedEmails = roles.map((role) => "phone." + role.toLowerCase() + "@geofields.test");

async function main() {
  // The existing pinned Neon endpoint is QA-only; also reject unknown accounts.
  const [identity] = await db.$queryRaw`SELECT current_database() AS name`;
  assert.equal(identity.name, "neondb");
  const users = await db.$queryRaw`SELECT email FROM "User"`;
  assert.ok(users.length >= 2 && users.every(({ email }) => allowedEmails.includes(email)), "Unexpected accounts in the designated phone QA database.");
  assert.ok(users.some(({ email }) => email === "phone.admin@geofields.test"));
  assert.ok(users.some(({ email }) => email === "phone.field@geofields.test"));
  const passwordHash = await hash(process.env.QA_SAFETY_PASSWORD, 12);
  await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(17112026)`;
    const [tables] = await tx.$queryRaw`SELECT to_regclass('"SafetyIncident"') IS NOT NULL AS present`;
    if (!tables.present) {
      const sql = fs.readFileSync(path.join(__dirname, "../prisma/migrations/20261117120000_safety_incidents/migration.sql"), "utf8");
      for (const statement of sql.split(";").map((part) => part.trim()).filter(Boolean)) await tx.$executeRawUnsafe(statement);
    }
    const [column] = await tx.$queryRaw`SELECT EXISTS (
      SELECT 1 FROM information_schema.columns WHERE table_name = 'User' AND column_name = 'isSafetyReviewer'
    ) AS present`;
    if (!column.present) await tx.$executeRawUnsafe('ALTER TABLE "User" ADD COLUMN "isSafetyReviewer" BOOLEAN NOT NULL DEFAULT false');
    for (const role of roles) {
      const email = "phone." + role.toLowerCase() + "@geofields.test";
      const user = await tx.user.findUnique({ where: { email }, select: { id: true } });
      assert.ok(user, "Missing synthetic phone QA account.");
      await tx.user.update({ where: { id: user.id }, data: { passwordHash, isActive: true, isSafetyReviewer: false } });
    }
    assert.equal(await tx.safetyIncident.count({ where: { events: { none: { kind: "REPORTED" } } } }), 0);
  }, { timeout: 30000 });
  console.log("Safety phone preview ready: pinned QA database, additive safety tables, test-only accounts; no reviewers appointed.");
}
main().catch(() => { console.error("Safety preview preparation failed closed. Live database not targeted."); process.exitCode = 1; }).finally(() => db.$disconnect());
