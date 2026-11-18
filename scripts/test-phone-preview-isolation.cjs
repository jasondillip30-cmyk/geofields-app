const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const base = {
  VERCEL_ENV: "preview",
  VERCEL_GIT_COMMIT_REF: "codex/geofields-phone-preview",
  DATABASE_URL: "postgresql://synthetic:synthetic@ep-orange-credit-bb6rfwu8-pooler.c-15.us-east-1.aws.neon.tech/neondb?sslmode=require",
  BLOB_READ_WRITE_TOKEN: "vercel_blob_rw_vCQuUiDN4QhHMkJq_synthetic",
  AUTH_SECRET: "a".repeat(64),
};
function check(overrides) {
  return spawnSync(process.execPath, [path.join(__dirname, "check-phone-preview.cjs")], {
    env: { ...base, ...overrides }, encoding: "utf8",
  }).status;
}
assert.equal(check({}), 0);
assert.notEqual(check({ VERCEL_ENV: "production" }), 0);
assert.notEqual(check({ VERCEL_GIT_COMMIT_REF: "main" }), 0);
assert.notEqual(check({ DATABASE_URL: base.DATABASE_URL.replace("ep-orange-credit-bb6rfwu8-pooler", "ep-other") }), 0);
assert.notEqual(check({ DATABASE_URL: base.DATABASE_URL.replace("require", "disable") }), 0);
assert.notEqual(check({ BLOB_READ_WRITE_TOKEN: "production-store" }), 0);
console.log("Phone preview isolation: designated QA accepted; production, other branches/databases, unsafe TLS and other storage refused.");
