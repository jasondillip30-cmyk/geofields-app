import { spawn, spawnSync } from "node:child_process";
import { normalizeTrackedTsconfigIncludes } from "./tsconfig-next-include-normalizer";

const DEFAULT_PORT = 3000;
const DEFAULT_HOST = "127.0.0.1";
const GRACEFUL_KILL_TIMEOUT_MS = 4_000;
const PORT_RELEASE_TIMEOUT_MS = 6_000;
const PORT_RELEASE_POLL_INTERVAL_MS = 140;
const HEALTH_PROBE_TIMEOUT_MS = 1_800;
const APP_IDENTITY_MARKER = "GeoFields Sign In";

async function main() {
  const port = resolvePort(process.env.PORT);
  const host = resolveHost(process.env.HOST);
  const distDir = resolveDistDir(port);
  normalizeTrackedTsconfigIncludes(process.cwd());

  console.log(`[dev] starting Next.js on ${host}:${port}`);
  console.log(`[dev] NEXT_DIST_DIR=${distDir}`);

  const existingPids = findPortPids(port);
  if (existingPids.length > 0) {
    console.warn(`[dev] detected listener on :${port}: ${existingPids.join(", ")}`);
    const healthy = await probeServerHealth(port, host);
    const matchesAppIdentity = healthy ? await probeServerIdentity(port, host) : false;
    if (healthy && matchesAppIdentity) {
      console.info(
        `[dev] existing server on :${port} is already healthy. Reusing it. Run \`PORT=${port} npm run -s dev:reset\` for a clean restart.`
      );
      return;
    }

    if (healthy && !matchesAppIdentity) {
      console.warn(
        `[dev] existing listener on :${port} is healthy but does not match this GeoFields app. Cleaning up and starting the correct server...`
      );
    } else {
      console.warn(`[dev] existing listener on :${port} is unresponsive. Attempting cleanup...`);
    }
    await terminatePids(existingPids);
    const released = await waitForPortRelease(port, PORT_RELEASE_TIMEOUT_MS);
    if (!released) {
      const remaining = findPortPids(port);
      throw new Error(
        `[dev] unable to free port :${port}. Remaining listener(s): ${
          remaining.join(", ") || "unknown"
        }. Run \`PORT=${port} npm run -s dev:reset\` and retry.`
      );
    }
  }

  await startDevServerWithRetry({
    host,
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

function resolveHost(raw: string | undefined) {
  const trimmed = raw?.trim();
  if (!trimmed) {
    return DEFAULT_HOST;
  }
  return trimmed;
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

function resolveProbeHosts(host: string) {
  const hosts = [host, "127.0.0.1", "localhost"];
  return [...new Set(hosts)];
}

async function probeServerHealth(port: number, host: string) {
  const probeUrls = resolveProbeHosts(host).map(
    (entry) => `http://${entry}:${port}/api/auth/session`
  );

  for (const url of probeUrls) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), HEALTH_PROBE_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        method: "GET",
        cache: "no-store",
        redirect: "manual",
        signal: controller.signal
      });

      if (
        response.ok ||
        response.status === 401 ||
        response.status === 403 ||
        response.status === 404 ||
        response.status === 307 ||
        response.status === 308
      ) {
        return true;
      }
    } catch {
      // Try the next probe URL.
    } finally {
      clearTimeout(timeoutId);
    }
  }

  return false;
}

async function probeServerIdentity(port: number, host: string) {
  const probeUrls = resolveProbeHosts(host).map((entry) => `http://${entry}:${port}/login`);

  for (const url of probeUrls) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), HEALTH_PROBE_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        method: "GET",
        cache: "no-store",
        redirect: "follow",
        signal: controller.signal
      });
      if (!response.ok) {
        continue;
      }
      const html = await response.text();
      if (html.includes(APP_IDENTITY_MARKER)) {
        return true;
      }
    } catch {
      // Try the next probe URL.
    } finally {
      clearTimeout(timeoutId);
    }
  }

  return false;
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

function startDevServer(host: string, port: number, distDir: string) {
  let forwardedSignal: NodeJS.Signals | null = null;
  const child = spawn("next", ["dev", "-H", host, "-p", String(port)], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      HOST: host,
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
    forwardedSignal = signal;
    child.kill(signal);
  };

  process.on("SIGINT", () => forwardSignal("SIGINT"));
  process.on("SIGTERM", () => forwardSignal("SIGTERM"));

  const normalizeTimer = setInterval(() => {
    try {
      const changed = normalizeTrackedTsconfigIncludes(process.cwd());
      if (changed) {
        console.info("[dev] normalized tsconfig include patterns");
      }
    } catch (error) {
      console.warn(
        `[dev] unable to normalize tsconfig includes: ${
          error instanceof Error ? error.message : "unknown error"
        }`
      );
    }
  }, 5_000);

  return new Promise<void>((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      clearInterval(normalizeTimer);
      if (signal && forwardedSignal && signal === forwardedSignal) {
        resolve();
        return;
      }
      if (signal && !forwardedSignal) {
        const detail = recentStderr.trim();
        reject(
          new Error(
            detail
              ? `next dev exited from signal ${signal}. Last stderr:\n${detail}`
              : `next dev exited from signal ${signal}`
          )
        );
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
  host,
  port,
  distDir,
  maxAttempts
}: {
  host: string;
  port: number;
  distDir: string;
  maxAttempts: number;
}) {
  let attempt = 0;
  while (attempt < maxAttempts) {
    attempt += 1;
    try {
      await startDevServer(host, port, distDir);
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const hasKnownBindError = /eaddrinuse|eperm|address already in use/i.test(message);
      const currentPids = findPortPids(port);
      const shouldRetry = attempt < maxAttempts && (hasKnownBindError || currentPids.length > 0);

      if (!shouldRetry) {
        throw error;
      }

      console.warn(
        `[dev] startup attempt ${attempt} failed (${hasKnownBindError ? "bind error" : "port still busy"}). Retrying once...`
      );

      if (currentPids.length > 0) {
        await terminatePids(currentPids);
      }
      const released = await waitForPortRelease(port, PORT_RELEASE_TIMEOUT_MS);
      if (!released) {
        const remaining = findPortPids(port);
        throw new Error(
          `[dev] retry blocked: port :${port} still busy by ${remaining.join(", ") || "unknown"}`
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
