import fs from "node:fs";
import path from "node:path";

const EXPLICIT_DEV_PORT_INCLUDE = /^\.next-dev-\d+\/types\/\*\*\/\*\.ts$/;
const DEFAULT_READ_ATTEMPTS = 3;
const DEFAULT_RETRY_DELAY_MS = 25;

type NormalizeOptions = {
  readAttempts?: number;
  retryDelayMs?: number;
  readText?: (filePath: string) => string;
  sleep?: (delayMs: number) => void;
};

export function normalizeTrackedTsconfigIncludes(
  repoRoot: string,
  options: NormalizeOptions = {}
) {
  const trackedTsconfigs = ["tsconfig.json", "tsconfig.next.json"];
  let changedAny = false;

  for (const fileName of trackedTsconfigs) {
    const tsconfigPath = path.join(repoRoot, fileName);
    if (!fs.existsSync(tsconfigPath)) {
      continue;
    }

    const parsed = readTrackedTsconfig(tsconfigPath, options);

    const include = Array.isArray(parsed.include)
      ? parsed.include.filter((entry): entry is string => typeof entry === "string")
      : [];
    const normalizedInclude = include.filter((entry) => !EXPLICIT_DEV_PORT_INCLUDE.test(entry));
    const changed = normalizedInclude.length !== include.length;
    if (!changed) {
      continue;
    }

    parsed.include = normalizedInclude;
    writeFileAtomically(tsconfigPath, `${JSON.stringify(parsed, null, 2)}\n`);
    changedAny = true;
  }

  return changedAny;
}

export function prepareRuntimeTsconfig(
  repoRoot: string,
  runtimeFileName: string,
  options: NormalizeOptions = {}
) {
  const sourcePath = path.join(repoRoot, "tsconfig.next.json");
  const runtimePath = path.join(repoRoot, runtimeFileName);
  const parsed = readTrackedTsconfig(sourcePath, options);
  const include = Array.isArray(parsed.include)
    ? parsed.include.filter((entry): entry is string => typeof entry === "string")
    : [];

  parsed.include = include.filter((entry) => !EXPLICIT_DEV_PORT_INCLUDE.test(entry));
  writeFileAtomically(runtimePath, `${JSON.stringify(parsed, null, 2)}\n`, fs.statSync(sourcePath).mode);

  return runtimeFileName;
}

export function removeRuntimeTsconfig(repoRoot: string, runtimeFileName: string) {
  fs.rmSync(path.join(repoRoot, runtimeFileName), { force: true });
}

function readTrackedTsconfig(tsconfigPath: string, options: NormalizeOptions) {
  const readAttempts = Math.max(1, options.readAttempts ?? DEFAULT_READ_ATTEMPTS);
  const retryDelayMs = Math.max(0, options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS);
  const readText = options.readText ?? ((filePath: string) => fs.readFileSync(filePath, "utf8"));
  const sleep = options.sleep ?? sleepSync;

  for (let attempt = 1; attempt <= readAttempts; attempt += 1) {
    const originalText = readText(tsconfigPath);
    try {
      return JSON.parse(originalText) as { include?: unknown };
    } catch (error) {
      const canRetry = attempt < readAttempts && looksLikeIncompleteJson(originalText, error);
      if (canRetry) {
        sleep(retryDelayMs);
        continue;
      }

      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Unable to parse ${path.basename(tsconfigPath)} after ${attempt} attempt${
          attempt === 1 ? "" : "s"
        }: ${reason}`,
        { cause: error }
      );
    }
  }

  throw new Error(`Unable to read ${path.basename(tsconfigPath)}`);
}

function looksLikeIncompleteJson(contents: string, error: unknown) {
  if (!(error instanceof SyntaxError)) {
    return false;
  }

  const trimmed = contents.trim();
  return (
    trimmed.length === 0 ||
    !/[}\]]$/.test(trimmed) ||
    /unexpected end/i.test(error.message)
  );
}

function writeFileAtomically(filePath: string, contents: string, mode = fs.statSync(filePath).mode) {
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;

  try {
    fs.writeFileSync(temporaryPath, contents, { encoding: "utf8", mode });
    fs.renameSync(temporaryPath, filePath);
  } finally {
    if (fs.existsSync(temporaryPath)) {
      fs.unlinkSync(temporaryPath);
    }
  }
}

function sleepSync(delayMs: number) {
  if (delayMs <= 0) {
    return;
  }
  const signal = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(signal, 0, 0, delayMs);
}
