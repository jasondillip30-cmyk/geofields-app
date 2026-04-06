import fs from "node:fs";
import path from "node:path";

const PLACEHOLDER_PATTERNS = [
  /YOUR_HOST/i,
  /YOUR_DB/i,
  /YOUR_DATABASE/i,
  /YOUR_USER/i,
  /YOUR_PASSWORD/i,
  /YOUR_PROJECT/i,
  /REPLACE_ME/i,
  /CHANGEME/i,
  /example\.com/i,
  /<.+>/i
];

function parseEnvFile(filePath: string) {
  if (!fs.existsSync(filePath)) {
    return new Map<string, string>();
  }
  const content = fs.readFileSync(filePath, "utf8");
  const map = new Map<string, string>();
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const separator = line.indexOf("=");
    if (separator <= 0) {
      continue;
    }
    const key = line.slice(0, separator).trim();
    const value = line
      .slice(separator + 1)
      .trim()
      .replace(/^['"]|['"]$/g, "");
    map.set(key, value);
  }
  return map;
}

function getDatabaseUrl() {
  if (process.env.DATABASE_URL && process.env.DATABASE_URL.trim()) {
    return process.env.DATABASE_URL.trim();
  }
  const envMap = parseEnvFile(path.join(process.cwd(), ".env"));
  return (envMap.get("DATABASE_URL") || "").trim();
}

function looksLikePlaceholder(value: string) {
  return PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(value));
}

function maskConnectionString(value: string) {
  try {
    const parsed = new URL(value);
    const host = parsed.hostname;
    const db = parsed.pathname.replace(/^\//, "") || "(none)";
    const protocol = parsed.protocol.replace(":", "");
    return `${protocol}://${host}/${db}`;
  } catch {
    return "(unparseable)";
  }
}

function main() {
  const databaseUrl = getDatabaseUrl();
  if (!databaseUrl) {
    console.error("[db-doctor] DATABASE_URL is missing.");
    console.error("[db-doctor] Add a real PostgreSQL/Neon connection string in .env before syncing.");
    process.exit(1);
  }

  if (looksLikePlaceholder(databaseUrl)) {
    console.error("[db-doctor] DATABASE_URL still contains placeholder text.");
    console.error("[db-doctor] Paste the real Neon/PostgreSQL URL in .env and rerun.");
    process.exit(1);
  }

  if (!/^postgres(ql)?:\/\//i.test(databaseUrl)) {
    console.error("[db-doctor] DATABASE_URL must be a PostgreSQL connection string.");
    process.exit(1);
  }

  console.info(
    JSON.stringify(
      {
        ok: true,
        doctor: "database-url",
        connection: maskConnectionString(databaseUrl)
      },
      null,
      2
    )
  );
}

main();
