import { ChevronDown, ChevronRight } from "lucide-react";

import { Card } from "@/components/ui/card";
import { formatCurrency } from "@/lib/utils";
import { priorityToneClass, recommendationToneClass } from "./company-dashboard-helpers";
import type { RecommendationItem } from "./company-dashboard-types";

interface RecommendationCounts {
  total: number;
  critical: number;
  warning: number;
  opportunity: number;
}

export function CompanyDashboardRecommendationsCard({
  loading,
  recommendationCounts,
  recommendationSubtitle,
  recommendationsExpanded,
  recommendations,
  onToggleExpanded,
  onNavigate,
  resolveRecommendationTargets
}: {
  loading: boolean;
  recommendationCounts: RecommendationCounts;
  recommendationSubtitle: string;
  recommendationsExpanded: boolean;
  recommendations: RecommendationItem[];
  onToggleExpanded: () => void;
  onNavigate: (href: string) => void;
  resolveRecommendationTargets: (item: RecommendationItem) => { takeActionHref: string; viewDetailsHref: string };
}) {
  return (
    <Card
      title={`Smart Recommendations (${recommendationCounts.total})`}
      subtitle={loading ? "Suggested actions based on live performance and forecast" : recommendationSubtitle}
      action={
        !loading && recommendationCounts.total > 0 ? (
          <button
            type="button"
            onClick={onToggleExpanded}
            className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-ink-700 hover:bg-slate-50"
          >
            <span>{recommendationsExpanded ? "Collapse" : "Expand"}</span>
            {recommendationsExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
        ) : undefined
      }
    >
      {loading ? (
        <p className="text-sm text-ink-600">Building recommendations...</p>
      ) : recommendationCounts.total === 0 ? (
        <p className="text-sm text-ink-600">No recommendations available for the current filter scope.</p>
      ) : !recommendationsExpanded ? (
        <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
          <div className="flex flex-wrap gap-2 text-[11px] font-semibold uppercase tracking-wide">
            <span className="rounded-full bg-red-100 px-2 py-0.5 text-red-700">{recommendationCounts.critical} critical</span>
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-700">{recommendationCounts.warning} warning</span>
            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-emerald-700">
              {recommendationCounts.opportunity} opportunity
            </span>
          </div>
          <p className="text-xs text-ink-600">Recommendations are collapsed to keep the dashboard compact.</p>
        </div>
      ) : (
        <div className="space-y-1.5">
          {recommendations.map((item, index) => {
            const targets = resolveRecommendationTargets(item);
            const primaryHref = item.primaryActionLabel === "Take Action" ? targets.takeActionHref : targets.viewDetailsHref;
            const secondaryLabel = item.secondaryActionLabel;
            let secondaryHref: string | null = null;
            if (secondaryLabel) {
              secondaryHref = secondaryLabel === "Take Action" ? targets.takeActionHref : targets.viewDetailsHref;
              if (secondaryHref === primaryHref) {
                secondaryHref = secondaryLabel === "Take Action" ? targets.viewDetailsHref : targets.takeActionHref;
              }
            }
            const actionPreview = item.actions.slice(0, 2).join(" • ");

            return (
              <div key={`${item.title}-${index}`} className={`rounded-md border px-3 py-2 ${recommendationToneClass[item.tone]}`}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <p className="text-[11px] font-semibold uppercase tracking-wide">{item.title}</p>
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${priorityToneClass[item.priority]}`}>
                        {item.priority}
                      </span>
                      {item.estimatedImpact !== null && (
                        <span className="text-[11px] font-medium text-ink-700">Impact: +{formatCurrency(item.estimatedImpact)}</span>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs leading-5">{item.message}</p>
                    {actionPreview && <p className="mt-1 text-[11px] text-ink-700">Next: {actionPreview}</p>}
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => onNavigate(primaryHref)}
                      className="rounded-md border border-slate-300 bg-white px-2 py-1 text-[11px] font-medium text-ink-800 hover:bg-slate-50"
                    >
                      {item.primaryActionLabel}
                    </button>
                    {secondaryLabel && secondaryHref ? (
                      <button
                        type="button"
                        onClick={() => onNavigate(secondaryHref)}
                        className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] text-ink-700 hover:bg-slate-100"
                      >
                        {secondaryLabel}
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
