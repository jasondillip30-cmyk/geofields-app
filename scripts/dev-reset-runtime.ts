import { rm } from "node:fs/promises";
import { spawn, spawnSync } from "node:child_process";
import { normalizeTrackedTsconfigIncludes } from "./tsconfig-next-include-normalizer";

const DEFAULT_PORT = 3000;
const GRACEFUL_KILL_TIMEOUT_MS = 5_000;
const PORT_RELEASE_TIMEOUT_MS = 6_000;
const PORT_RELEASE_POLL_INTERVAL_MS = 140;

async function main() {
  const port = resolvePort(process.env.PORT);
  const distDir = resolveDistDir(port);
  normalizeTrackedTsconfigIncludes(process.cwd());

  console.log(`[dev:reset] target port: ${port}`);
  console.log(`[dev:reset] target dist dir: ${distDir}`);

  const pids = findPortPids(port);
  if (pids.length > 0) {
    console.log(`[dev:reset] stopping process(es) on :${port}: ${pids.join(", ")}`);
    await terminatePids(pids);
    const released = await waitForPortRelease(port, PORT_RELEASE_TIMEOUT_MS);
    if (!released) {
      const remaining = findPortPids(port);
      throw new Error(
        `[dev:reset] port :${port} is still busy after shutdown (${remaining.join(", ") || "unknown"}). ` +
          `Run \`kill -9 ${remaining.join(" ")}\` or pick another port, then retry.`
      );
    }
  } else {
    console.log(`[dev:reset] no running process found on :${port}`);
  }

  await rm(distDir, { recursive: true, force: true });
  console.log(`[dev:reset] removed ${distDir}`);

  await startDevServerWithRetry({
    port,
    distDir,
    maxAttempts: 2
  });
}

function resolvePort(raw: string | undefined) {
  const parsed = Number(raw || DEFAULT_PORT);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return DEFAULT_PORT;
  }
  return Math.trunc(parsed);
}

function resolveDistDir(port: number) {
  const configured = process.env.NEXT_DIST_DIR?.trim();
  if (configured) {
    return configured;
  }
  return `.next-dev-${port}`;
}

function findPortPids(port: number) {
  const lookup = spawnSync("lsof", ["-tiTCP:" + String(port), "-sTCP:LISTEN"], {
    cwd: process.cwd(),
    encoding: "utf8"
  });
  if (lookup.status !== 0 || !lookup.stdout.trim()) {
    return [];
  }

  return lookup.stdout
    .split(/\s+/)
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value > 0);
}

async function waitForPortRelease(port: number, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (findPortPids(port).length === 0) {
      return true;
    }
    await sleep(PORT_RELEASE_POLL_INTERVAL_MS);
  }
  return findPortPids(port).length === 0;
}

async function terminatePids(pids: number[]) {
  for (const pid of pids) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // Ignore already-dead processes.
    }
  }

  const deadline = Date.now() + GRACEFUL_KILL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const alive = pids.some((pid) => isAlive(pid));
    if (!alive) {
      return;
    }
    await sleep(120);
  }

  for (const pid of pids) {
    if (!isAlive(pid)) {
      continue;
    }
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // Ignore already-dead processes.
    }
  }
}

function isAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function startDevServer(port: number, distDir: string) {
  console.log(`[dev:reset] starting fresh dev server on :${port}`);
  const child = spawn("next", ["dev", "-p", String(port)], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(port),
      NEXT_DIST_DIR: distDir
    },
    stdio: ["inherit", "inherit", "pipe"]
  });
  let recentStderr = "";

  child.stderr?.on("data", (chunk: Buffer) => {
    const text = chunk.toString();
    process.stderr.write(text);
    recentStderr = `${recentStderr}${text}`.slice(-3_000);
  });

  const forwardSignal = (signal: NodeJS.Signals) => {
    if (child.killed || child.exitCode !== null) {
      return;
    }
    child.kill(signal);
  };

  process.on("SIGINT", () => forwardSignal("SIGINT"));
  process.on("SIGTERM", () => forwardSignal("SIGTERM"));

  const normalizeTimer = setInterval(() => {
    try {
      const changed = normalizeTrackedTsconfigIncludes(process.cwd());
      if (changed) {
        console.info("[dev:reset] normalized tsconfig include patterns");
      }
    } catch (error) {
      console.warn(
        `[dev:reset] unable to normalize tsconfig includes: ${
          error instanceof Error ? error.message : "unknown error"
        }`
      );
    }
  }, 5_000);

  return new Promise<void>((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      clearInterval(normalizeTimer);
      if (signal) {
        resolve();
        return;
      }
      if (code === 0 || code === null) {
        resolve();
        return;
      }
      const detail = recentStderr.trim();
      reject(
        new Error(
          detail
            ? `next dev exited with code ${code}. Last stderr:\n${detail}`
            : `next dev exited with code ${code}`
        )
      );
    });
  });
}

async function startDevServerWithRetry({
  port,
  distDir,
  maxAttempts
}: {
  port: number;
  distDir: string;
  maxAttempts: number;
}) {
  let attempt = 0;
  while (attempt < maxAttempts) {
    attempt += 1;
    try {
      await startDevServer(port, distDir);
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const hasKnownBindError = /eaddrinuse|eperm|address already in use/i.test(message);
      const currentPids = findPortPids(port);
      const portStillBusy = currentPids.length > 0;
      const shouldRetry = attempt < maxAttempts && (hasKnownBindError || portStillBusy);

      if (!shouldRetry) {
        throw error;
      }

      console.warn(
        `[dev:reset] restart attempt ${attempt} failed (${hasKnownBindError ? "bind error" : "port still busy"}). ` +
          `Retrying once...`
      );

      if (currentPids.length > 0) {
        await terminatePids(currentPids);
      }
      const released = await waitForPortRelease(port, PORT_RELEASE_TIMEOUT_MS);
      if (!released) {
        const remaining = findPortPids(port);
        throw new Error(
          `[dev:reset] retry blocked: port :${port} still busy by ${remaining.join(", ") || "unknown"}`
        );
      }
      await sleep(200);
    }
  }
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
