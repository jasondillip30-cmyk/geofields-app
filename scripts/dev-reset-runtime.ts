import { rm } from "node:fs/promises";
import { spawn, spawnSync } from "node:child_process";

const DEFAULT_PORT = 3000;
const GRACEFUL_KILL_TIMEOUT_MS = 5_000;

async function main() {
  const port = resolvePort(process.env.PORT);
  const distDir = resolveDistDir(port);

  console.log(`[dev:reset] target port: ${port}`);
  console.log(`[dev:reset] target dist dir: ${distDir}`);

  const pids = findPortPids(port);
  if (pids.length > 0) {
    console.log(`[dev:reset] stopping process(es) on :${port}: ${pids.join(", ")}`);
    await terminatePids(pids);
  } else {
    console.log(`[dev:reset] no running process found on :${port}`);
  }

  await rm(distDir, { recursive: true, force: true });
  console.log(`[dev:reset] removed ${distDir}`);

  await startDevServer(port, distDir);
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
  const lookup = spawnSync("lsof", ["-ti", `tcp:${port}`], {
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
    stdio: "inherit"
  });

  const forwardSignal = (signal: NodeJS.Signals) => {
    if (child.killed || child.exitCode !== null) {
      return;
    }
    child.kill(signal);
  };

  process.on("SIGINT", () => forwardSignal("SIGINT"));
  process.on("SIGTERM", () => forwardSignal("SIGTERM"));

  return new Promise<void>((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (signal) {
        resolve();
        return;
      }
      if (code === 0 || code === null) {
        resolve();
        return;
      }
      reject(new Error(`next dev exited with code ${code}`));
    });
  });
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
