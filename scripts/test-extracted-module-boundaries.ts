import assert from "node:assert/strict";

import {
  fallbackCopilotContext,
  normalizeCopilotContext,
  normalizeFocusItems,
  normalizeIssueType,
  resolveScopedPageHref
} from "@/lib/ai/contextual-copilot-context";
import {
  buildIssueTypeCounts,
  dedupeNavigationTargets,
  resolveLargestMetric
} from "@/lib/ai/contextual-copilot-ranking";
import {
  buildDecisionGuidance,
  deriveIgnoreConsequence,
  resolveDecisionPlanItems
} from "@/lib/ai/contextual-copilot-response";
import type { CopilotFocusItem, CopilotPageContext } from "@/lib/ai/contextual-copilot";
import { suggestInventoryMatch } from "@/lib/inventory-receipt-intake-match";
import { calculateProjectRevenueFromBillableLines } from "@/lib/project-revenue-calculator";

function run(name: string, testFn: () => void) {
  try {
    testFn();
    console.log(`✓ ${name}`);
  } catch (error) {
    console.error(`✗ ${name}`);
    throw error;
  }
}

function rankBySeverity(items: CopilotFocusItem[]) {
  const rank = (value: CopilotFocusItem["severity"]) => {
    if (value === "CRITICAL") return 0;
    if (value === "HIGH") return 1;
    if (value === "MEDIUM") return 2;
    return 3;
  };
  return [...items].sort((a, b) => rank(a.severity) - rank(b.severity));
}

run("copilot context fallback shape is stable", () => {
  const normalized = normalizeCopilotContext(undefined);
  assert.equal(normalized.pageKey, fallbackCopilotContext.pageKey);
  assert.equal(normalized.pageName, fallbackCopilotContext.pageName);
  assert.deepEqual(normalized.filters, {
    clientId: null,
    rigId: null,
    from: null,
    to: null
  });
  assert.deepEqual(normalized.priorityItems, []);
  assert.deepEqual(normalized.navigationTargets, []);
  assert.deepEqual(normalized.summaryMetrics, []);
});

run("copilot context normalization tolerates malformed payloads", () => {
  const normalized = normalizeCopilotContext(({
    ...fallbackCopilotContext,
    pageKey: "  inventory-overview ",
    pageName: " Inventory ",
    filters: {
      clientId: " c1 ",
      rigId: "all",
      from: " 2026-01-01 ",
      to: " "
    },
    // invalid runtime shapes are intentionally passed to harden boundary behavior
    priorityItems: ({ bad: "shape" } as unknown) as CopilotFocusItem[],
    navigationTargets: [
      { label: "View", href: "/inventory" },
      { label: "Invalid missing href" },
      null
    ] as unknown as Array<Record<string, unknown>>,
    notes: ["  one ", "", "two"]
  } as unknown) as CopilotPageContext);

  assert.equal(normalized.pageKey, "inventory-overview");
  assert.equal(normalized.pageName, "Inventory");
  assert.equal(normalized.filters.clientId, "c1");
  assert.equal(normalized.filters.rigId, "all");
  assert.equal(normalized.filters.to, null);
  assert.deepEqual(normalized.priorityItems, []);
  assert.equal((normalized.navigationTargets || []).length, 1);
  assert.deepEqual(normalized.notes, ["one", "two"]);
});

run("focus items are normalized and invalid rows are dropped", () => {
  const items = normalizeFocusItems([
    {
      id: "",
      label: "  Budget pressure ",
      reason: " Overspend trend ",
      severity: "INVALID" as never,
      issueType: "overspent project",
      href: "/cost-tracking/budget-vs-actual"
    } as unknown as CopilotFocusItem,
    {
      id: "bad-empty",
      label: "   ",
      reason: "   ",
      severity: "LOW"
    } as unknown as CopilotFocusItem
  ]);

  assert.equal(items.length, 1);
  const first = items[0]!;
  assert.equal(first.severity, "MEDIUM");
  assert.equal(first.issueType, "BUDGET_PRESSURE");
  assert.equal(first.targetPageKey, "budget-vs-actual");
});

run("scoped href keeps only active filters", () => {
  const href = resolveScopedPageHref({
    ...fallbackCopilotContext,
    pageKey: "cost-tracking",
    filters: {
      clientId: "client-1",
      rigId: "all",
      from: "2026-02-01",
      to: null
    }
  });
  assert.equal(href, "/spending?clientId=client-1&from=2026-02-01");
});

run("navigation target dedupe keeps one per precise target and defaults precision", () => {
  const deduped = dedupeNavigationTargets(
    [
      { label: "One", href: "/inventory", sectionId: "s1" },
      { label: "One duplicate", href: "/inventory", sectionId: "s1" },
      { label: "Two", href: "/inventory", targetId: "row-1" }
    ],
    ({ targetId, sectionId }) => {
      if (targetId) return "EXACT_ROW";
      if (sectionId) return "SECTION";
      return undefined;
    }
  );

  assert.equal(deduped.length, 2);
  assert.equal(deduped[0].targetPrecision, "SECTION");
  assert.equal(deduped[1].targetPrecision, "EXACT_ROW");
});

run("issue type counting normalizes categories consistently", () => {
  const counts = buildIssueTypeCounts([
    { id: "1", label: "A", reason: "r", severity: "HIGH", issueType: "overspent project" },
    { id: "2", label: "B", reason: "r", severity: "MEDIUM", issueType: "NO_BUDGET_PROJECT" },
    { id: "3", label: "C", reason: "r", severity: "LOW", issueType: "overspent project" }
  ]);
  assert.equal(counts[0]?.type, "BUDGET_PRESSURE");
  assert.equal(counts[0]?.count, 2);
  assert.equal(normalizeIssueType("approval backlog"), "APPROVAL_BACKLOG");
});

run("largest metric resolver ignores non-numeric values", () => {
  const largest = resolveLargestMetric([
    { label: "A", value: "n/a" },
    { label: "B", value: "$12,000" },
    { label: "C", value: 5000 }
  ]);
  assert.equal(largest?.label, "B");
});

run("decision planning picks do-now/do-next/can-wait in stable order", () => {
  const items: CopilotFocusItem[] = [
    { id: "1", label: "Low", reason: "r", severity: "LOW", issueType: "GENERAL" },
    { id: "2", label: "High", reason: "r", severity: "HIGH", issueType: "BUDGET_PRESSURE", amount: 10000 },
    { id: "3", label: "Medium", reason: "r", severity: "MEDIUM", issueType: "LINKAGE", amount: 5000 }
  ];

  const plan = resolveDecisionPlanItems(items, { segment: "MANAGEMENT" }, rankBySeverity);
  assert.equal(plan.doNowItem?.id, "2");
  assert.ok(plan.doNextItem);
  assert.ok(plan.canWaitItem);

  const guidance = buildDecisionGuidance(items, { segment: "MANAGEMENT" }, rankBySeverity);
  assert.ok(guidance.doNow?.includes("High"));
  assert.ok(guidance.canWait?.includes("If delayed:"));
});

run("ignore-consequence messaging remains operational and clear", () => {
  const message = deriveIgnoreConsequence({
    id: "1",
    label: "Approval queue",
    reason: "pending approvals",
    severity: "HIGH",
    issueType: "APPROVAL_BACKLOG"
  });
  assert.ok(message.toLowerCase().includes("stale"));
});

run("receipt match finds strong near-duplicate names", () => {
  const result = suggestInventoryMatch("  Hydraulic   Hose 2IN  ", [
    { id: "a", name: "Hydraulic Hose 2in", sku: "HH-2IN" },
    { id: "b", name: "Drill Lubricant", sku: "DL-01" }
  ]);
  assert.equal(result.itemId, "a");
  assert.equal(result.confidence, "HIGH");
});

run("receipt match avoids over-linking generic single-token text", () => {
  const result = suggestInventoryMatch("Hydraulic", [
    { id: "a", name: "Hydraulic Pump Assembly", sku: "HPA-1" },
    { id: "b", name: "Hydraulic Pump Fitting", sku: "HPF-1" }
  ]);
  assert.equal(result.itemId, null);
  assert.equal(result.confidence, "NONE");
});

run("receipt match avoids ambiguous generic family matches", () => {
  const result = suggestInventoryMatch("RC Bits", [
    { id: "a", name: "RC Bits 6 inch", sku: "RC6" },
    { id: "b", name: "RC Bits 7 inch", sku: "RC7" }
  ]);
  assert.equal(result.itemId, null);
  assert.equal(result.confidence, "NONE");
});

run("receipt match still links when signal is specific", () => {
  const result = suggestInventoryMatch("RC Bits 6", [
    { id: "a", name: "RC Bits 6 inch", sku: "RC6" },
    { id: "b", name: "RC Bits 7 inch", sku: "RC7" }
  ]);
  assert.equal(result.itemId, "a");
  assert.notEqual(result.confidence, "NONE");
});

run("project revenue calculator handles single mapped line", () => {
  const result = calculateProjectRevenueFromBillableLines({
    activeRateItems: [{ itemCode: "METER_DRILLED", label: "Meters drilled", unit: "m", unitRate: 50 }],
    approvedReports: [{ billableLines: [{ itemCode: "METER_DRILLED", quantity: 100, unit: "m" }] }]
  });
  assert.equal(result.lineItems.length, 1);
  assert.equal(result.totalRevenue, 5000);
  assert.equal(result.lineItems[0]?.revenue, 5000);
});

run("project revenue calculator aggregates multiple items", () => {
  const result = calculateProjectRevenueFromBillableLines({
    activeRateItems: [
      { itemCode: "METER_DRILLED", label: "Meters drilled", unit: "m", unitRate: 40 },
      { itemCode: "RIG_MOVE", label: "Rig move", unit: "move", unitRate: 300 }
    ],
    approvedReports: [
      {
        billableLines: [
          { itemCode: "METER_DRILLED", quantity: 50, unit: "m" },
          { itemCode: "RIG_MOVE", quantity: 2, unit: "move" }
        ]
      },
      {
        billableLines: [
          { itemCode: "METER_DRILLED", quantity: 25, unit: "m" },
          { itemCode: "RIG_MOVE", quantity: 1, unit: "move" }
        ]
      }
    ]
  });
  assert.equal(result.lineItems.length, 2);
  assert.equal(result.totalRevenue, 3900);
});

run("project revenue calculator skips orphan item codes", () => {
  const result = calculateProjectRevenueFromBillableLines({
    activeRateItems: [{ itemCode: "METER_DRILLED", label: "Meters drilled", unit: "m", unitRate: 20 }],
    approvedReports: [{ billableLines: [{ itemCode: "RIG_MOVE", quantity: 3, unit: "move" }] }]
  });
  assert.equal(result.lineItems.length, 0);
  assert.equal(result.totalRevenue, 0);
});

run("project revenue calculator skips unit mismatches", () => {
  const result = calculateProjectRevenueFromBillableLines({
    activeRateItems: [{ itemCode: "METER_DRILLED", label: "Meters drilled", unit: "m", unitRate: 20 }],
    approvedReports: [{ billableLines: [{ itemCode: "METER_DRILLED", quantity: 10, unit: "meter" }] }]
  });
  assert.equal(result.lineItems.length, 0);
  assert.equal(result.totalRevenue, 0);
});

run("project revenue calculator ignores invalid numeric values", () => {
  const result = calculateProjectRevenueFromBillableLines({
    activeRateItems: [{ itemCode: "METER_DRILLED", label: "Meters drilled", unit: "m", unitRate: Number.NaN }],
    approvedReports: [{ billableLines: [{ itemCode: "METER_DRILLED", quantity: Number.NaN, unit: "m" }] }]
  });
  assert.equal(result.lineItems.length, 0);
  assert.equal(result.totalRevenue, 0);
});

console.log("All extracted module boundary checks passed.");
