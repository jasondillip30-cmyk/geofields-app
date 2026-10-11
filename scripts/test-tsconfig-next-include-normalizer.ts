import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  normalizeTrackedTsconfigIncludes,
  prepareRuntimeTsconfig,
  removeRuntimeTsconfig
} from "./tsconfig-next-include-normalizer";

const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "geofields-tsconfig-normalizer-"));

try {
  const tsconfigPath = path.join(fixtureRoot, "tsconfig.json");
  const nextTsconfigPath = path.join(fixtureRoot, "tsconfig.next.json");
  const fixture = {
    compilerOptions: { strict: true },
    include: ["**/*.ts", ".next-dev-3007/types/**/*.ts", ".next-dev-*/types/**/*.ts"]
  };

  fs.writeFileSync(tsconfigPath, `${JSON.stringify(fixture, null, 2)}\n`);
  fs.writeFileSync(nextTsconfigPath, `${JSON.stringify(fixture, null, 2)}\n`);

  let tsconfigReads = 0;
  const changed = normalizeTrackedTsconfigIncludes(fixtureRoot, {
    retryDelayMs: 0,
    sleep: () => undefined,
    readText: (filePath) => {
      if (filePath === tsconfigPath && tsconfigReads === 0) {
        tsconfigReads += 1;
        return '{"include": [';
      }
      return fs.readFileSync(filePath, "utf8");
    }
  });

  assert.equal(changed, true);
  assert.equal(tsconfigReads, 1);
  for (const filePath of [tsconfigPath, nextTsconfigPath]) {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as { include: string[] };
    assert.deepEqual(parsed.include, ["**/*.ts", ".next-dev-*/types/**/*.ts"]);
  }
  assert.equal(
    fs.readdirSync(fixtureRoot).some((fileName) => fileName.endsWith(".tmp")),
    false
  );

  const runtimeFileName = ".next-dev-3007.tsconfig.json";
  prepareRuntimeTsconfig(fixtureRoot, runtimeFileName);
  const runtimeConfig = JSON.parse(
    fs.readFileSync(path.join(fixtureRoot, runtimeFileName), "utf8")
  ) as { include: string[] };
  assert.deepEqual(runtimeConfig.include, ["**/*.ts", ".next-dev-*/types/**/*.ts"]);
  removeRuntimeTsconfig(fixtureRoot, runtimeFileName);
  assert.equal(fs.existsSync(path.join(fixtureRoot, runtimeFileName)), false);

  fs.writeFileSync(tsconfigPath, '{"include": [');
  assert.throws(
    () =>
      normalizeTrackedTsconfigIncludes(fixtureRoot, {
        readAttempts: 2,
        retryDelayMs: 0,
        sleep: () => undefined
      }),
    /Unable to parse tsconfig\.json after 2 attempts/
  );

  console.log("tsconfig normalizer regression checks passed");
} finally {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
}
