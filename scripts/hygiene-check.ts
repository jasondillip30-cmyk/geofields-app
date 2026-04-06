import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const prismaDir = path.join(repoRoot, "prisma");
const schemaPath = path.join(prismaDir, "schema.prisma");
const migrationsDir = path.join(prismaDir, "migrations");
const expectedLockPath = path.join(migrationsDir, "migration_lock.toml");
const legacyRootLockPath = path.join(prismaDir, "migration_lock.toml");

function fail(message: string) {
  throw new Error(`[hygiene-check] ${message}`);
}

function readFileText(filePath: string) {
  return fs.readFileSync(filePath, "utf8");
}

function verifyPrismaLockLayout() {
  if (!fs.existsSync(schemaPath)) {
    fail("Missing prisma/schema.prisma.");
  }
  if (!fs.existsSync(migrationsDir)) {
    fail("Missing prisma/migrations directory.");
  }
  if (!fs.existsSync(expectedLockPath)) {
    fail("Missing prisma/migrations/migration_lock.toml.");
  }
  if (fs.existsSync(legacyRootLockPath)) {
    fail(
      "Found legacy prisma/migration_lock.toml. Keep only prisma/migrations/migration_lock.toml."
    );
  }

  const schemaText = readFileText(schemaPath);
  const datasourceBlockMatch = schemaText.match(/datasource\s+\w+\s*\{[\s\S]*?\}/);
  const providerMatch = datasourceBlockMatch?.[0].match(/provider\s*=\s*"([^"]+)"/);
  const schemaProvider = providerMatch?.[1] || "";
  if (!schemaProvider) {
    fail("Could not read datasource provider from prisma/schema.prisma.");
  }
  if (schemaProvider !== "postgresql") {
    fail(`Expected datasource provider=postgresql, found ${schemaProvider}.`);
  }

  const lockText = readFileText(expectedLockPath);
  const lockProviderMatch = lockText.match(/provider\s*=\s*"([^"]+)"/);
  const lockProvider = lockProviderMatch?.[1] || "";
  if (lockProvider !== schemaProvider) {
    fail(
      `Migration lock provider mismatch. schema=${schemaProvider}, migration_lock=${lockProvider || "missing"}`
    );
  }

  const migrationEntries = fs
    .readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^\d{14}_/.test(entry.name));

  if (migrationEntries.length === 0) {
    fail("No timestamped migration directories found in prisma/migrations.");
  }
}

function main() {
  verifyPrismaLockLayout();
  console.info(
    JSON.stringify(
      {
        ok: true,
        checks: [
          "prisma lock file path",
          "provider alignment (schema vs migration lock)",
          "timestamped migration directories present"
        ]
      },
      null,
      2
    )
  );
}

main();
