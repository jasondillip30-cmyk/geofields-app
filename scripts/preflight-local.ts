import { spawn, type ChildProcess } from "node:child_process";

const PREFLIGHT_PORT = Number(process.env.PREFLIGHT_PORT || 3012);
const PREFLIGHT_BASE_URL = process.env.PREFLIGHT_BASE_URL || `http://127.0.0.1:${PREFLIGHT_PORT}`;
const PREFLIGHT_NEXT_DIST_DIR = process.env.PREFLIGHT_NEXT_DIST_DIR || ".next-preflight";

async function main() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("preflight:local must not run in production mode.");
  }

  console.log(`[preflight] base URL: ${PREFLIGHT_BASE_URL}`);
  console.log(`[preflight] NEXT_DIST_DIR: ${PREFLIGHT_NEXT_DIST_DIR}`);

  await runNpmScript("typecheck");
  await runStaticQualityChecks();
  await runNpmScript("test:module-boundaries");

  let server: ChildProcess | null = null;
  try {
    server = startLocalServer(PREFLIGHT_PORT, PREFLIGHT_NEXT_DIST_DIR);
    await waitForServer(PREFLIGHT_BASE_URL, server);

    await runNpmScript("test:interaction:workflows", {
      INTERACTION_BASE_URL: PREFLIGHT_BASE_URL
    });
    await runNpmScript("smoke:critical", {
      SMOKE_BASE_URL: PREFLIGHT_BASE_URL
    });
    await runNpmScript("smoke:ops", {
      SMOKE_BASE_URL: PREFLIGHT_BASE_URL
    });
    await runNpmScript("smoke:mutations", {
      SMOKE_BASE_URL: PREFLIGHT_BASE_URL
    });
  } finally {
    if (server) {
      await stopLocalServer(server);
    }
  }

  console.log("[preflight] local preflight completed successfully.");
}

function startLocalServer(port: number, distDir: string) {
  const child = spawn(
    "./node_modules/.bin/next",
    ["dev", "-p", String(port)],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        NEXT_DIST_DIR: distDir
      },
      stdio: ["ignore", "pipe", "pipe"]
    }
  );

  if (child.stdout) {
    child.stdout.on("data", (chunk) => {
      process.stdout.write(`[preflight:dev] ${String(chunk)}`);
    });
  }
  if (child.stderr) {
    child.stderr.on("data", (chunk) => {
      process.stderr.write(`[preflight:dev] ${String(chunk)}`);
    });
  }
  child.on("exit", (code, signal) => {
    process.stdout.write(`[preflight:dev] exited (code=${code ?? "null"}, signal=${signal ?? "null"})\n`);
  });

  return child;
}

async function stopLocalServer(server: ChildProcess) {
  if (server.killed || server.exitCode !== null) {
    return;
  }

  await new Promise<void>((resolve) => {
    let resolved = false;
    const timeoutId = setTimeout(() => {
      if (!resolved) {
        server.kill("SIGKILL");
      }
    }, 10_000);

    server.once("exit", () => {
      if (resolved) {
        return;
      }
      resolved = true;
      clearTimeout(timeoutId);
      resolve();
    });

    server.kill("SIGTERM");
  });
}

async function waitForServer(baseUrl: string, server: ChildProcess) {
  const timeoutAt = Date.now() + 90_000;
  while (Date.now() < timeoutAt) {
    if (server.exitCode !== null) {
      throw new Error(`Local dev server exited early with code ${server.exitCode}.`);
    }
    try {
      const response = await fetch(`${baseUrl}/login`, { method: "GET" });
      if (response.ok || response.status === 307 || response.status === 308) {
        return;
      }
    } catch {
      // continue polling
    }
    await sleep(750);
  }
  throw new Error(`Timed out waiting for local server at ${baseUrl}.`);
}

async function runNpmScript(scriptName: string, extraEnv?: Record<string, string>) {
  await runCommand("npm", ["run", "-s", scriptName], extraEnv);
}

async function runStaticQualityChecks() {
  console.log("[preflight] running static quality checks");
  await runNpmScript("lint");
  await runCommand("node", ["--import", "tsx", "scripts/hygiene-check.ts"]);
  await runCommand("node", ["--import", "tsx", "scripts/architecture-guard.ts"]);
}

async function runCommand(command: string, args: string[], extraEnv?: Record<string, string>) {
  console.log(`[preflight] running: ${command} ${args.join(" ")}`);
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: {
        ...process.env,
        ...(extraEnv || {})
      },
      stdio: "inherit"
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} ${args.join(" ")} failed with exit code ${code ?? "null"}.`));
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
