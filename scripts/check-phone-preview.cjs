const { env } = process;

function verify() {
  if (env.VERCEL_ENV !== "preview" || env.VERCEL_GIT_COMMIT_REF !== "codex/geofields-phone-preview") return false;
  const database = new URL(env.DATABASE_URL || "");
  return database.hostname.split(".")[0] === "ep-plain-silence-amqlwo66" &&
    database.hostname.endsWith(".neon.tech") &&
    database.pathname === "/geofields_phone_qa" &&
    database.username === "geofields_phone_preview" &&
    database.searchParams.get("sslmode") === "require" &&
    /^vercel_blob_rw_vCQuUiDN4QhHMkJq_\S+$/.test(env.BLOB_READ_WRITE_TOKEN || "") &&
    /^[a-f0-9]{64}$/.test(env.AUTH_SECRET || "");
}

try {
  if (!verify()) throw new Error();
  console.log("Phone Preview isolation verified.");
} catch {
  console.error("Phone Preview isolation check failed. Build refused.");
  process.exitCode = 1;
}
