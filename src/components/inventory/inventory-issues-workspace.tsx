import Link from "next/link";

import { Card } from "@/components/ui/card";
import { SystemFlowBar } from "@/components/inventory/system-flow-bar";
import { FilterSelect, IssueSeverityBadge, SummaryBadge } from "@/components/inventory/inventory-page-shared";
import { deriveIssueTypeTag, truncateIssueText, type IssueOperationalContext } from "@/components/inventory/inventory-page-utils";
import { formatInventoryCategory } from "@/lib/inventory";
import { cn, formatCurrency, formatNumber } from "@/lib/utils";

interface InventoryIssueRowLike {
  id: string;
  severity: "HIGH" | "MEDIUM" | "LOW";
  confidence?: number | string | null;
  title: string;
  message: string;
  suggestion: string;
  itemIds: string[];
  type: string;
}

function formatIssueConfidence(value: InventoryIssueRowLike["confidence"]) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const percentage = value <= 1 ? value * 100 : value;
    return `Confidence ${Math.round(percentage)}%`;
  }
  const normalized = String(value).trim();
  if (!normalized) {
    return null;
  }
  return `Confidence ${normalized}`;
}

interface InventoryIssuesResponseLike {
  summary: {
    total: number;
    high: number;
    medium: number;
    low: number;
  };
  issues: InventoryIssueRowLike[];
}

export function InventoryIssuesWorkspace({
  isProjectLocked,
  projectName,
  focusedSectionId,
  issuesLoading,
  issuesResponse,
  issueTriageFilter,
  setIssueTriageFilter,
  needsLinkingCount,
  costNotRecognizedCount,
  showLowPriorityIssues,
  setShowLowPriorityIssues,
  lowPriorityHiddenCount,
  filteredIssues,
  issueSeverityFilter,
  setIssueSeverityFilter,
  issueTypeFilter,
  setIssueTypeFilter,
  issueCategoryFilter,
  setIssueCategoryFilter,
  issueCategoryOptions,
  issueItemQuery,
  setIssueItemQuery,
  triageQueueIssues,
  issueContextById,
  selectedIssue,
  selectedIssueContext,
  openIssueWorkflow,
  openItemDetail,
  openMovementDetail,
  canManage,
  lowRiskNamingFixes,
  applyBulkLowRiskNamingAutoFix
}: {
  isProjectLocked: boolean;
  projectName?: string | null;
  focusedSectionId: string | null;
  issuesLoading: boolean;
  issuesResponse: InventoryIssuesResponseLike;
  issueTriageFilter: "HIGH_PRIORITY" | "NEEDS_LINKING" | "COST_NOT_RECOGNIZED" | "LOW_PRIORITY" | "ALL";
  setIssueTriageFilter: (value: "HIGH_PRIORITY" | "NEEDS_LINKING" | "COST_NOT_RECOGNIZED" | "LOW_PRIORITY" | "ALL") => void;
  needsLinkingCount: number;
  costNotRecognizedCount: number;
  showLowPriorityIssues: boolean;
  setShowLowPriorityIssues: (value: boolean) => void;
  lowPriorityHiddenCount: number;
  filteredIssues: InventoryIssueRowLike[];
  issueSeverityFilter: "all" | "HIGH" | "MEDIUM" | "LOW";
  setIssueSeverityFilter: (value: "all" | "HIGH" | "MEDIUM" | "LOW") => void;
  issueTypeFilter: "all" | "CATEGORY_CONFLICT" | "DUPLICATE_ITEM" | "NAMING_INCONSISTENCY" | "STOCK_ANOMALY" | "PRICE_ANOMALY";
  setIssueTypeFilter: (
    value: "all" | "CATEGORY_CONFLICT" | "DUPLICATE_ITEM" | "NAMING_INCONSISTENCY" | "STOCK_ANOMALY" | "PRICE_ANOMALY"
  ) => void;
  issueCategoryFilter: string;
  setIssueCategoryFilter: (value: string) => void;
  issueCategoryOptions: string[];
  issueItemQuery: string;
  setIssueItemQuery: (value: string) => void;
  triageQueueIssues: InventoryIssueRowLike[];
  issueContextById: Map<string, IssueOperationalContext>;
  selectedIssue: InventoryIssueRowLike | null;
  selectedIssueContext: IssueOperationalContext | null;
  openIssueWorkflow: (issueId: string, step: 1 | 2 | 3) => void;
  openItemDetail: (itemId: string) => void;
  openMovementDetail: (movementId: string) => void;
  canManage: boolean;
  lowRiskNamingFixes: unknown[];
  applyBulkLowRiskNamingAutoFix: () => Promise<void>;
}) {
  return (
    <section
      id="inventory-issues-section"
      className={cn(
        "grid min-w-0 items-start gap-3 xl:grid-cols-[1.35fr_0.95fr]",
        focusedSectionId === "inventory-issues-section" &&
          "rounded-2xl ring-2 ring-indigo-100 ring-offset-2 ring-offset-slate-50"
      )}
    >
      <div className="space-y-3">
        <Card
          className="min-w-0"
          title="Triage Header"
          subtitle={
            isProjectLocked
              ? `Resolve project-linked inventory flow gaps for ${projectName || "the locked project"} (warehouse stock remains global).`
              : "Resolve gaps in inventory, usage, and cost flow."
          }
        >
          {isProjectLocked ? (
            <p className="mb-2 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-xs text-brand-900">
              Project-linked issue view only. Warehouse stock on hand remains global.
            </p>
          ) : null}
          {issuesLoading ? (
            <p className="text-sm text-ink-600">Analyzing inventory quality issues...</p>
          ) : issuesResponse.summary.total === 0 ? (
            <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-3 text-sm text-emerald-800">
              {isProjectLocked
                ? "No major project-linked inventory inconsistencies detected."
                : "No major inventory inconsistencies detected in current scope."}
            </p>
          ) : (
            <div className="space-y-2.5">
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => setIssueTriageFilter("HIGH_PRIORITY")}
                  className={cn(
                    "rounded-full border px-2 py-1 text-[11px] font-semibold transition-colors",
                    issueTriageFilter === "HIGH_PRIORITY"
                      ? "border-red-300 bg-red-100 text-red-900"
                      : "border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
                  )}
                >
                  High priority ({formatNumber(issuesResponse.summary.high)})
                </button>
                <button
                  type="button"
                  onClick={() => setIssueTriageFilter("NEEDS_LINKING")}
                  className={cn(
                    "rounded-full border px-2 py-1 text-[11px] font-semibold transition-colors",
                    issueTriageFilter === "NEEDS_LINKING"
                      ? "border-amber-300 bg-amber-100 text-amber-900"
                      : "border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
                  )}
                >
                  Needs linking ({formatNumber(needsLinkingCount)})
                </button>
                <button
                  type="button"
                  onClick={() => setIssueTriageFilter("COST_NOT_RECOGNIZED")}
                  className={cn(
                    "rounded-full border px-2 py-1 text-[11px] font-semibold transition-colors",
                    issueTriageFilter === "COST_NOT_RECOGNIZED"
                      ? "border-blue-300 bg-blue-100 text-blue-900"
                      : "border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
                  )}
                >
                  Cost not recognized ({formatNumber(costNotRecognizedCount)})
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowLowPriorityIssues(true);
                    setIssueTriageFilter("LOW_PRIORITY");
                  }}
                  className={cn(
                    "rounded-full border px-2 py-1 text-[11px] font-semibold transition-colors",
                    issueTriageFilter === "LOW_PRIORITY"
                      ? "border-slate-400 bg-slate-200 text-slate-900"
                      : "border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
                  )}
                >
                  Hidden low-priority ({showLowPriorityIssues ? 0 : formatNumber(lowPriorityHiddenCount)})
                </button>
                <button
                  type="button"
                  onClick={() => setIssueTriageFilter("ALL")}
                  className={cn(
                    "rounded-full border px-2 py-1 text-[11px] font-semibold transition-colors",
                    issueTriageFilter === "ALL"
                      ? "border-brand-300 bg-brand-50 text-brand-900"
                      : "border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
                  )}
                >
                  All ({formatNumber(filteredIssues.length)})
                </button>
              </div>
              <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-5">
                <FilterSelect
                  label="Severity"
                  value={issueSeverityFilter}
                  onChange={(value) => setIssueSeverityFilter((value as "all" | "HIGH" | "MEDIUM" | "LOW") || "all")}
                  options={[
                    { value: "all", label: "All severities" },
                    { value: "HIGH", label: "High" },
                    { value: "MEDIUM", label: "Medium" },
                    { value: "LOW", label: "Low" }
                  ]}
                />
                <FilterSelect
                  label="Issue Type"
                  value={issueTypeFilter}
                  onChange={(value) =>
                    setIssueTypeFilter(
                      (value as "all" | "CATEGORY_CONFLICT" | "DUPLICATE_ITEM" | "NAMING_INCONSISTENCY" | "STOCK_ANOMALY" | "PRICE_ANOMALY") ||
                        "all"
                    )
                  }
                  options={[
                    { value: "all", label: "All types" },
                    { value: "CATEGORY_CONFLICT", label: "Category conflict" },
                    { value: "DUPLICATE_ITEM", label: "Duplicate item" },
                    { value: "NAMING_INCONSISTENCY", label: "Naming" },
                    { value: "STOCK_ANOMALY", label: "Stock anomaly" },
                    { value: "PRICE_ANOMALY", label: "Price anomaly" }
                  ]}
                />
                <FilterSelect
                  label="Affected Category"
                  value={issueCategoryFilter}
                  onChange={(value) => setIssueCategoryFilter(value || "all")}
                  options={[
                    { value: "all", label: "All categories" },
                    ...issueCategoryOptions.map((category) => ({
                      value: category,
                      label: formatInventoryCategory(category)
                    }))
                  ]}
                />
                <label className="text-xs text-ink-700 md:col-span-2 xl:col-span-2">
                  <span className="mb-1 block uppercase tracking-wide text-slate-500">Search issues</span>
                  <input
                    type="text"
                    value={issueItemQuery}
                    onChange={(event) => setIssueItemQuery(event.target.value)}
                    placeholder="Item, maintenance code, movement, linkage"
                    className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-sm"
                  />
                </label>
              </div>
            </div>
          )}
        </Card>

        <Card className="min-w-0" title="Issue Queue" subtitle="Fix broken operational flow and restore stock + cost traceability.">
          {issuesLoading ? (
            <p className="text-sm text-ink-600">Loading issue queue...</p>
          ) : triageQueueIssues.length === 0 ? (
            <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-700">
              No issues found for current triage filter.
            </p>
          ) : (
            <div className="space-y-2">
              {triageQueueIssues.slice(0, 18).map((issue) => {
                const issueContext = issueContextById.get(issue.id) || null;
                const confidenceLabel = formatIssueConfidence(issue.confidence);
                const contextRef =
                  issueContext?.maintenanceCodes[0] ||
                  issueContext?.projectNames[0] ||
                  issueContext?.rigCodes[0] ||
                  issueContext?.affectedItemNames[0] ||
                  "Operational context";
                return (
                  <article
                    key={issue.id}
                    className={cn(
                      "rounded-lg border border-slate-200 bg-slate-50/80 p-2.5",
                      selectedIssue?.id === issue.id && "border-brand-300 bg-brand-50/45"
                    )}
                  >
                    <div className="flex flex-wrap items-center gap-1.5">
                      <IssueSeverityBadge severity={issue.severity} />
                      <span className="rounded-full border border-slate-300 bg-white px-1.5 py-[1px] text-[10px] font-semibold text-slate-700">
                        {deriveIssueTypeTag(issue)}
                      </span>
                      <p className="text-sm font-semibold text-ink-900">{issue.title}</p>
                      {confidenceLabel ? (
                        <span className="ml-auto text-[10px] text-slate-500">{confidenceLabel}</span>
                      ) : null}
                    </div>
                    <p className="mt-1 text-xs text-slate-700">
                      {contextRef} • {truncateIssueText(issue.message, 100)}
                    </p>
                    <p className="mt-1 text-xs text-slate-600">
                      {truncateIssueText(issue.suggestion, 120)}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <button
                        type="button"
                        onClick={() => openIssueWorkflow(issue.id, 3)}
                        className="gf-btn-primary px-2 py-1 text-[11px]"
                      >
                        Fix Issue
                      </button>
                      <button
                        type="button"
                        onClick={() => openItemDetail(issue.itemIds[0] || "")}
                        className="gf-btn-secondary px-2 py-1 text-[11px]"
                      >
                        Open Item
                      </button>
                      <button
                        type="button"
                        onClick={() => openIssueWorkflow(issue.id, 1)}
                        className="gf-btn-secondary px-2 py-1 text-[11px]"
                      >
                        View Context
                      </button>
                    </div>
                  </article>
                );
              })}
              {!showLowPriorityIssues && lowPriorityHiddenCount > 0 ? (
                <div className="pt-1">
                  <button
                    type="button"
                    onClick={() => setShowLowPriorityIssues(true)}
                    className="rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 hover:bg-slate-100"
                  >
                    Show low-priority issues ({formatNumber(lowPriorityHiddenCount)})
                  </button>
                </div>
              ) : null}
              {canManage && lowRiskNamingFixes.length > 0 ? (
                <button
                  type="button"
                  onClick={() => void applyBulkLowRiskNamingAutoFix()}
                  className="rounded border border-emerald-300 bg-emerald-50 px-2 py-1 text-xs text-emerald-800 hover:bg-emerald-100"
                >
                  Fix all low-risk naming issues ({lowRiskNamingFixes.length})
                </button>
              ) : null}
            </div>
          )}
        </Card>
      </div>

      <Card className="min-w-0" title="Issue Context" subtitle="Understand affected entities and impact before resolving.">
        <SystemFlowBar current="issue" className="mb-2" />
        {!selectedIssue || !selectedIssueContext ? (
          <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-700">
            Select an issue from the queue to view operational context.
          </p>
        ) : (
          <div className="space-y-3">
            <section className="space-y-1.5">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Affected Entities</p>
              <div className="grid gap-2 sm:grid-cols-2">
                <SummaryBadge label="Project" value={selectedIssueContext.projectNames[0] || "-"} />
                <SummaryBadge label="Rig" value={selectedIssueContext.rigCodes[0] || "-"} />
                <SummaryBadge label="Category" value={selectedIssueContext.categoryLabels[0] || "-"} />
                <SummaryBadge label="Issue Type" value={deriveIssueTypeTag(selectedIssue)} />
              </div>
            </section>

            <section className="space-y-1.5">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Impact Summary</p>
              <div className="grid gap-2 sm:grid-cols-3">
                <div className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5">
                  <p className="text-[10px] uppercase tracking-wide text-slate-500">Inventory Value Affected</p>
                  <p className="text-sm font-semibold text-ink-800">{formatCurrency(selectedIssueContext.inventoryValueAffected)}</p>
                </div>
                <div className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5">
                  <p className="text-[10px] uppercase tracking-wide text-slate-500">Movements Impacted</p>
                  <p className="text-sm font-semibold text-ink-800">{formatNumber(selectedIssueContext.movementsImpacted)}</p>
                </div>
                <div className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5">
                  <p className="text-[10px] uppercase tracking-wide text-slate-500">Cost at Risk</p>
                  <p className="text-sm font-semibold text-ink-800">{formatCurrency(selectedIssueContext.costAtRisk)}</p>
                </div>
              </div>
            </section>

            <section className="space-y-1.5">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Related Records</p>
              <div className="space-y-1 text-xs text-slate-700">
                <p>Maintenance case: {selectedIssueContext.maintenanceCodes[0] || "-"}</p>
                <p>Movement: {selectedIssueContext.movementIds[0] || "-"}</p>
                <p>Receipt: {selectedIssueContext.receiptRefs[0] || "-"}</p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {selectedIssue.itemIds[0] ? (
                  <button
                    type="button"
                    onClick={() => openItemDetail(selectedIssue.itemIds[0] || "")}
                    className="gf-btn-secondary px-2 py-1 text-[11px]"
                  >
                    Open Item
                  </button>
                ) : null}
                {selectedIssueContext.latestMovementId ? (
                  <button
                    type="button"
                    onClick={() => openMovementDetail(selectedIssueContext.latestMovementId || "")}
                    className="gf-btn-secondary px-2 py-1 text-[11px]"
                  >
                    Open Movement
                  </button>
                ) : null}
                {selectedIssueContext.maintenanceCodes.length > 0 ? (
                  <Link href="/maintenance" className="gf-btn-secondary px-2 py-1 text-[11px]">
                    Open Maintenance
                  </Link>
                ) : null}
                {selectedIssueContext.receiptRefs.length > 0 ? (
                  <Link href="/purchasing/receipt-follow-up" className="gf-btn-secondary px-2 py-1 text-[11px]">
                    Open Receipt Follow-up
                  </Link>
                ) : null}
              </div>
            </section>
          </div>
        )}
      </Card>
    </section>
  );
}
