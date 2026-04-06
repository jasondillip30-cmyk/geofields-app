import fs from "node:fs";
import path from "node:path";

type FileSizeRule = {
  file: string;
  maxLines: number;
};

const WARNING_THRESHOLD = 0.95;

const rules: FileSizeRule[] = [
  { file: "src/app/inventory/page.tsx", maxLines: 5600 },
  { file: "src/components/inventory/receipt-intake-panel.tsx", maxLines: 7000 },
  { file: "src/lib/inventory-receipt-intake.ts", maxLines: 5200 },
  { file: "src/lib/ai/contextual-copilot.ts", maxLines: 4800 },
  { file: "src/app/maintenance/page.tsx", maxLines: 1900 },
  { file: "src/app/breakdowns/page.tsx", maxLines: 1600 },
  { file: "src/app/cost-tracking/budget-vs-actual/page.tsx", maxLines: 1600 },
  { file: "src/app/profit/page.tsx", maxLines: 1500 }
];

function fail(message: string) {
  throw new Error(`[architecture-guard] ${message}`);
}

function countLines(filePath: string) {
  const text = fs.readFileSync(filePath, "utf8");
  if (!text) {
    return 0;
  }
  return text.split(/\r?\n/).length;
}

function main() {
  const repoRoot = process.cwd();
  const failures: string[] = [];
  const warnings: string[] = [];
  const results = rules.map((rule) => {
    const absolutePath = path.join(repoRoot, rule.file);
    if (!fs.existsSync(absolutePath)) {
      failures.push(`Missing guarded file: ${rule.file}`);
      return { ...rule, lines: 0 };
    }
    const lines = countLines(absolutePath);
    if (lines > rule.maxLines) {
      failures.push(
        `${rule.file} is ${lines} lines (max ${rule.maxLines}). Split or extract modules before merging.`
      );
    } else if (lines > Math.floor(rule.maxLines * WARNING_THRESHOLD)) {
      const percent = Math.round((lines / rule.maxLines) * 100);
      warnings.push(`${rule.file} is at ${percent}% of max size (${lines}/${rule.maxLines}).`);
    }
    return { ...rule, lines };
  });

  if (failures.length > 0) {
    fail(failures.join("\n"));
  }

  console.info(
    JSON.stringify(
      {
        ok: true,
        guard: "file-size",
        files: results,
        warnings
      },
      null,
      2
    )
  );
}

main();
