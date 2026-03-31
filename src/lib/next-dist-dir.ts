import path from "node:path";

const DEFAULT_NEXT_DIST_DIR = ".next";

export function resolveNextDistDir() {
  const raw = process.env.NEXT_DIST_DIR?.trim();
  return raw || DEFAULT_NEXT_DIST_DIR;
}

export function resolveNextDistPath(...segments: string[]) {
  const distDir = resolveNextDistDir();
  const baseDir = path.isAbsolute(distDir) ? distDir : path.join(process.cwd(), distDir);
  return path.join(baseDir, ...segments);
}
