"use client";

import type { ReactNode } from "react";
import { useMemo } from "react";
import { usePathname } from "next/navigation";

import { Card } from "@/components/ui/card";
import { useAnalyticsFilters } from "@/components/layout/analytics-filters-provider";
import {
  resolveWorkspaceRouteRule,
  WORKSPACE_MODE_LABELS
} from "@/lib/workspace-mode";

export function WorkspaceModeRouteGuard({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { filters, setWorkspaceMode } = useAnalyticsFilters();

  const rule = useMemo(() => resolveWorkspaceRouteRule(pathname), [pathname]);
  if (!rule) {
    return <>{children}</>;
  }
  if (rule.allowedModes.includes(filters.workspaceMode)) {
    return <>{children}</>;
  }

  const recommendedLabel = WORKSPACE_MODE_LABELS[rule.recommendedMode];
  const currentLabel = WORKSPACE_MODE_LABELS[filters.workspaceMode];

  return (
    <Card title="Page hidden in current workspace mode">
      <div className="space-y-3 text-sm text-ink-700">
        <p>
          This page is not available in <span className="font-semibold">{currentLabel}</span> mode.
        </p>
        <p>
          Switch to <span className="font-semibold">{recommendedLabel}</span> mode to continue.
        </p>
        <button
          type="button"
          onClick={() => setWorkspaceMode(rule.recommendedMode)}
          className="rounded-md border border-brand-200 bg-brand-50 px-3 py-1.5 text-sm font-medium text-brand-800 hover:bg-brand-100"
        >
          Switch to {recommendedLabel}
        </button>
      </div>
    </Card>
  );
}
