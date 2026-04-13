import fs from "node:fs";
import path from "node:path";

type FileSizeRule = {
  file: string;
  maxLines: number;
};

const WARNING_THRESHOLD = 0.9;

const rules: FileSizeRule[] = [
  { file: "src/components/inventory/receipt-intake-review-state-core.ts", maxLines: 1200 },
  { file: "src/lib/ai/contextual-copilot-navigation.ts", maxLines: 1200 },
  { file: "src/lib/inventory-receipt-intake-tra.ts", maxLines: 1200 },
  { file: "src/app/inventory/inventory-page-content.tsx", maxLines: 1200 },
  { file: "src/components/inventory/receipt-intake-panel.tsx", maxLines: 1200 },
  { file: "src/components/layout/global-ai-copilot-content.tsx", maxLines: 1200 },
  { file: "src/components/modules/requisition-workflow-sections.tsx", maxLines: 1200 },
  { file: "src/components/modules/requisition-workflow-card-content.tsx", maxLines: 1200 },
  { file: "src/lib/inventory-intelligence.ts", maxLines: 1200 },
  { file: "src/app/drilling-reports/drilling-reports-page-view.tsx", maxLines: 1200 },
  { file: "src/app/executive-overview/page.tsx", maxLines: 1200 },
  { file: "src/lib/ai/contextual-copilot-insights.ts", maxLines: 1200 },
  { file: "src/app/api/alerts-center/route.ts", maxLines: 1200 },
  { file: "src/app/data-quality/linkage-center/page.tsx", maxLines: 1200 },
  { file: "src/app/api/requisitions/route.ts", maxLines: 1200 },
  { file: "src/app/maintenance/page.tsx", maxLines: 1200 },
  { file: "src/app/forecasting/forecasting-page-view.tsx", maxLines: 1200 },
  { file: "src/app/approvals/page.tsx", maxLines: 1200 }
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
