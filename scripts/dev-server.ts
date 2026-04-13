import { spawn } from "node:child_process";

const DEFAULT_PORT = 3000;

async function main() {
  const port = resolvePort(process.env.PORT);
  const distDir = resolveDistDir(port);

  console.log(`[dev] starting Next.js on :${port}`);
  console.log(`[dev] NEXT_DIST_DIR=${distDir}`);

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

  await new Promise<void>((resolve, reject) => {
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

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
