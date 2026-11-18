const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { hash } = require("bcryptjs");
const { PrismaClient } = require("@prisma/client");
const dns = require("node:dns/promises");
const net = require("node:net");
require("./check-phone-preview.cjs");
assert.notEqual(process.exitCode, 1, "Phone preview isolation check must pass before writes.");
assert.match(process.env.QA_SAFETY_PASSWORD || "", /^[a-f0-9]{24}$/, "A test-only password must be configured.");
const qaUrl = new URL(process.env.DATABASE_URL);
qaUrl.searchParams.set("connect_timeout", "20");
const db = new PrismaClient({ datasources: { db: { url: qaUrl.toString() } } });
const roles = ["ADMIN", "MANAGER", "OFFICE", "MECHANIC", "FIELD", "STAFF"];
const allowedEmails = roles.map((role) => "phone." + role.toLowerCase() + "@geofields.test");
let stage = "database identity";

async function main() {
  // The existing pinned Neon endpoint is QA-only; also reject unknown accounts.
  stage = "QA endpoint DNS";
  await dns.lookup(qaUrl.hostname);
  stage = "QA endpoint TCP";
  await new Promise((resolve, reject) => {
    const socket = net.connect({ host: qaUrl.hostname, port: Number(qaUrl.port || 5432) });
    socket.setTimeout(15000);
    socket.once("connect", () => { socket.destroy(); resolve(); });
    socket.once("error", reject);
    socket.once("timeout", () => { socket.destroy(); reject(Object.assign(new Error("timeout"), { code: "ETIMEDOUT" })); });
  });
  stage = "database identity";
  for (let attempt = 1; attempt <= 3; attempt++) {
    try { await db.$connect(); break; }
    catch (error) {
      if (attempt === 3) throw error;
      console.log("Waiting for isolated QA database to wake", { attempt });
      await new Promise((resolve) => setTimeout(resolve, 7000));
    }
  }
  const [identity] = await db.$queryRaw`SELECT current_database() AS name`;
  assert.equal(identity.name, "neondb");
  stage = "synthetic account verification";
  const users = await db.$queryRaw`SELECT email FROM "User"`;
  console.log("Safety QA account check", {
    total: users.length,
    expected: users.filter(({ email }) => allowedEmails.includes(email)).length,
    legacyOfflineFixture: users.filter(({ email }) => email === "offline.phone@geofields.test").length
  });
  assert.ok(users.length >= 2 && users.every(({ email }) => allowedEmails.includes(email)), "Unexpected accounts in the designated phone QA database.");
  assert.ok(users.some(({ email }) => email === "phone.admin@geofields.test"));
  assert.ok(users.some(({ email }) => email === "phone.field@geofields.test"));
  stage = "test password hashing";
  const passwordHash = await hash(process.env.QA_SAFETY_PASSWORD, 12);
  await db.$transaction(async (tx) => {
    stage = "QA migration lock";
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(17112026)`;
    const [tables] = await tx.$queryRaw`SELECT to_regclass('"SafetyIncident"') IS NOT NULL AS present`;
    if (!tables.present) {
      stage = "additive safety tables";
      const sql = fs.readFileSync(path.join(__dirname, "../prisma/migrations/20261117120000_safety_incidents/migration.sql"), "utf8");
      for (const statement of sql.split(";").map((part) => part.trim()).filter(Boolean)) await tx.$executeRawUnsafe(statement);
    }
    const [column] = await tx.$queryRaw`SELECT EXISTS (
      SELECT 1 FROM information_schema.columns WHERE table_name = 'User' AND column_name = 'isSafetyReviewer'
    ) AS present`;
    stage = "reviewer column";
    if (!column.present) await tx.$executeRawUnsafe('ALTER TABLE "User" ADD COLUMN "isSafetyReviewer" BOOLEAN NOT NULL DEFAULT false');
    stage = "test account password preparation";
    for (const role of roles) {
      const email = "phone." + role.toLowerCase() + "@geofields.test";
      const user = await tx.user.findUnique({ where: { email }, select: { id: true } });
      assert.ok(user, "Missing synthetic phone QA account.");
      await tx.user.update({ where: { id: user.id }, data: { passwordHash, isActive: true } });
    }
    assert.equal(await tx.safetyIncident.count({ where: { events: { none: { kind: "REPORTED" } } } }), 0);
  }, { timeout: 30000 });
  console.log("Safety phone preview ready: pinned QA database, additive safety tables, test-only accounts; reviewer appointments preserved.");
}
main().catch((error) => {
  const rawCode = error.code || error.errorCode;
  const code = typeof rawCode === "string" && /^(P\d{4}|ERR_ASSERTION|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN)$/.test(rawCode) ? rawCode : "UNCLASSIFIED";
  const name = String(error.name ?? "").replace(/[^A-Za-z]/g, "").slice(0, 60);
  const message = String(error.message ?? "").toLowerCase();
  const clues = ["certificate", "authentication", "reach database", "database string", "connection string", "not supported", "timeout", "timed out", "denied", "environment variable", "ssl", "not found"]
    .filter((clue) => message.includes(clue));
  console.error("Safety preview preparation failed closed.", { stage, code, name, clues });
  process.exitCode = 1;
}).finally(() => db.$disconnect());
