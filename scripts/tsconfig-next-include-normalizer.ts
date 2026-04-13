import fs from "node:fs";
import path from "node:path";

const EXPLICIT_DEV_PORT_INCLUDE = /^\.next-dev-\d+\/types\/\*\*\/\*\.ts$/;

export function normalizeTrackedTsconfigIncludes(repoRoot: string) {
  const trackedTsconfigs = ["tsconfig.json", "tsconfig.next.json"];
  let changedAny = false;

  for (const fileName of trackedTsconfigs) {
    const tsconfigPath = path.join(repoRoot, fileName);
    if (!fs.existsSync(tsconfigPath)) {
      continue;
    }

    const originalText = fs.readFileSync(tsconfigPath, "utf8");
    const parsed = JSON.parse(originalText) as {
      include?: unknown;
    };

    const include = Array.isArray(parsed.include)
      ? parsed.include.filter((entry): entry is string => typeof entry === "string")
      : [];
    const normalizedInclude = include.filter((entry) => !EXPLICIT_DEV_PORT_INCLUDE.test(entry));
    const changed = normalizedInclude.length !== include.length;
    if (!changed) {
      continue;
    }

    parsed.include = normalizedInclude;
    fs.writeFileSync(tsconfigPath, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
    changedAny = true;
  }

  return changedAny;
}
