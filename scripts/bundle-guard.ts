import fs from "node:fs";
import path from "node:path";

type AppBuildManifest = {
  pages?: Record<string, string[]>;
};

type RouteBudget = {
  route: string;
  maxKb: number;
};

type RouteResult = {
  route: string;
  source: "manifest" | "fallback-files";
  fileCount: number;
  bytes: number;
  kb: number;
  maxKb: number;
  ok: boolean;
};

const ROUTE_BUDGETS: RouteBudget[] = [
  { route: "/spending", maxKb: 420 },
  { route: "/spending/profit", maxKb: 760 },
  { route: "/spending/drilling-reports", maxKb: 420 },
  { route: "/drilling-reports", maxKb: 500 }
];

function fail(message: string): never {
  throw new Error(`[bundle-guard] ${message}`);
}

function getDistDir() {
  const fromEnv = process.env.NEXT_DIST_DIR?.trim();
  if (fromEnv) {
    return fromEnv;
  }
  if (fs.existsSync(path.join(process.cwd(), ".next-build", "app-build-manifest.json"))) {
    return ".next-build";
  }
  return ".next";
}

function readManifest(repoRoot: string, distDir: string) {
  const manifestPath = path.join(repoRoot, distDir, "app-build-manifest.json");
  if (!fs.existsSync(manifestPath)) {
    fail(`Missing ${distDir}/app-build-manifest.json. Run \`npm run build\` first.`);
  }
  const raw = fs.readFileSync(manifestPath, "utf8");
  return JSON.parse(raw) as AppBuildManifest;
}

function toKb(bytes: number) {
  return Math.round((bytes / 1024) * 10) / 10;
}

function routeToManifestKeys(route: string) {
  const normalized = route.endsWith("/") && route !== "/" ? route.slice(0, -1) : route;
  return [normalized, `${normalized}/page`, `app${normalized}/page`];
}

function listFilesRecursive(dir: string): string[] {
  if (!fs.existsSync(dir)) {
    return [];
  }
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const absolutePath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listFilesRecursive(absolutePath));
      continue;
    }
    files.push(absolutePath);
  }
  return files;
}

function routeToFileSegments(route: string) {
  return route
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function collectRouteFallbackFiles(repoRoot: string, distDir: string, route: string) {
  const segments = routeToFileSegments(route);
  const serverRouteDir = path.join(repoRoot, distDir, "server", "app", ...segments);
  const staticRouteDir = path.join(repoRoot, distDir, "static", "chunks", "app", ...segments);

  const fallbackCandidates = new Set<string>();

  const serverPage = path.join(serverRouteDir, "page.js");
  const serverClientManifest = path.join(serverRouteDir, "page_client-reference-manifest.js");
  if (fs.existsSync(serverPage)) {
    fallbackCandidates.add(serverPage);
  }
  if (fs.existsSync(serverClientManifest)) {
    fallbackCandidates.add(serverClientManifest);
  }

  for (const file of listFilesRecursive(staticRouteDir)) {
    if (file.endsWith(".js") || file.endsWith(".css")) {
      fallbackCandidates.add(file);
    }
  }

  return Array.from(fallbackCandidates);
}

function resolveChunkPathsFromManifest(pages: Record<string, string[]>, route: string) {
  const paths = new Set<string>();
  for (const key of routeToManifestKeys(route)) {
    for (const chunkPath of pages[key] || []) {
      if (typeof chunkPath === "string" && chunkPath.trim()) {
        paths.add(chunkPath);
      }
    }
  }
  return Array.from(paths);
}

function bytesFromManifestChunks(repoRoot: string, distDir: string, chunkPaths: string[]) {
  let bytes = 0;
  let fileCount = 0;
  for (const chunkPath of chunkPaths) {
    const absolutePath = path.join(repoRoot, distDir, chunkPath);
    if (!fs.existsSync(absolutePath)) {
      continue;
    }
    bytes += fs.statSync(absolutePath).size;
    fileCount += 1;
  }
  return { bytes, fileCount };
}

function bytesFromFiles(files: string[]) {
  let bytes = 0;
  for (const file of files) {
    bytes += fs.statSync(file).size;
  }
  return { bytes, fileCount: files.length };
}

function evaluateRouteBudget(options: {
  distDir: string;
  manifest: AppBuildManifest;
  repoRoot: string;
  routeBudget: RouteBudget;
}): RouteResult {
  const { distDir, manifest, repoRoot, routeBudget } = options;
  const pages = manifest.pages || {};
  const manifestChunkPaths = resolveChunkPathsFromManifest(pages, routeBudget.route);
  const manifestBytes = bytesFromManifestChunks(repoRoot, distDir, manifestChunkPaths);

  if (manifestBytes.fileCount > 0) {
    const kb = toKb(manifestBytes.bytes);
    return {
      route: routeBudget.route,
      source: "manifest",
      fileCount: manifestBytes.fileCount,
      bytes: manifestBytes.bytes,
      kb,
      maxKb: routeBudget.maxKb,
      ok: kb <= routeBudget.maxKb
    };
  }

  const fallbackFiles = collectRouteFallbackFiles(repoRoot, distDir, routeBudget.route);
  if (fallbackFiles.length === 0) {
    fail(`Missing route bundle artifacts for ${routeBudget.route} in ${distDir}.`);
  }
  const fallbackBytes = bytesFromFiles(fallbackFiles);
  const kb = toKb(fallbackBytes.bytes);
  return {
    route: routeBudget.route,
    source: "fallback-files",
    fileCount: fallbackBytes.fileCount,
    bytes: fallbackBytes.bytes,
    kb,
    maxKb: routeBudget.maxKb,
    ok: kb <= routeBudget.maxKb
  };
}

function main() {
  const repoRoot = process.cwd();
  const distDir = getDistDir();
  const manifest = readManifest(repoRoot, distDir);

  const results = ROUTE_BUDGETS.map((routeBudget) =>
    evaluateRouteBudget({
      distDir,
      manifest,
      repoRoot,
      routeBudget
    })
  );

  const failures = results.filter((entry) => !entry.ok);
  console.info(
    JSON.stringify({ ok: failures.length === 0, distDir, routes: results }, null, 2)
  );
  if (failures.length > 0) {
    fail(
      failures
        .map(
          (entry) =>
            `${entry.route} bundle ${entry.kb}KB exceeds budget ${entry.maxKb}KB (${entry.source}, ${entry.fileCount} files)`
        )
        .join("\n")
    );
  }
}

main();
