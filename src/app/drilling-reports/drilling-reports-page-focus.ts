import { useEffect, useMemo, useState } from "react";

import { useRegisterCopilotContext } from "@/components/layout/ai-copilot-context";
import {
  scrollToFocusElement,
  useCopilotFocusTarget,
  type CopilotFocusTarget
} from "@/components/layout/copilot-focus-target";
import type { AnalyticsFilters } from "@/components/layout/analytics-filters-provider";

import {
  buildDrillingReportsCopilotContext,
  buildReportingWorkflowAssist
} from "./drilling-reports-page-copilot";
import type {
  DrillReportRecord,
  DrillStats,
  ProjectOption
} from "./drilling-reports-page-types";

type UseDrillingReportsFocusArgs = {
  filters: AnalyticsFilters;
  stats: DrillStats;
  reports: DrillReportRecord[];
  selectedReport: DrillReportRecord | null;
  selectedProject: ProjectOption | null;
  isSingleProjectScope: boolean;
  scopedProjectId: string;
  userRole: string | null | undefined;
  buildHref: (path: string, overrides?: Record<string, string | null | undefined>) => string;
  onSelectReport: (reportId: string | null) => void;
};

export function useDrillingReportsFocus({
  filters,
  stats,
  reports,
  selectedReport,
  selectedProject,
  isSingleProjectScope,
  scopedProjectId,
  userRole,
  buildHref,
  onSelectReport
}: UseDrillingReportsFocusArgs) {
  const [focusedRowId, setFocusedRowId] = useState<string | null>(null);
  const [focusedSectionId, setFocusedSectionId] = useState<string | null>(null);
  const [assistTarget, setAssistTarget] = useState<CopilotFocusTarget | null>(null);

  const copilotContext = useMemo(
    () =>
      buildDrillingReportsCopilotContext({
        filters,
        stats,
        reports,
        selectedReport,
        selectedProject,
        isSingleProjectScope,
        scopedProjectId,
        buildHref
      }),
    [
      buildHref,
      filters,
      isSingleProjectScope,
      reports,
      scopedProjectId,
      selectedProject,
      selectedReport,
      stats
    ]
  );

  useRegisterCopilotContext(copilotContext);

  useCopilotFocusTarget({
    pageKey: "drilling-reports",
    onFocus: (target) => {
      setAssistTarget(target);
      setFocusedRowId(target.targetId || null);
      setFocusedSectionId(target.sectionId || null);
      if (target.targetId) {
        onSelectReport(target.targetId);
      }
      scrollToFocusElement({
        sectionId: target.sectionId,
        targetId: target.targetId
      });
    }
  });

  useEffect(() => {
    if (!focusedRowId && !focusedSectionId) {
      return;
    }
    const timeout = window.setTimeout(() => {
      setFocusedRowId(null);
      setFocusedSectionId(null);
    }, 2600);
    return () => {
      window.clearTimeout(timeout);
    };
  }, [focusedRowId, focusedSectionId]);

  useEffect(() => {
    if (!assistTarget) {
      return;
    }
    const timeout = window.setTimeout(() => setAssistTarget(null), 7000);
    return () => window.clearTimeout(timeout);
  }, [assistTarget]);

  const reportingWorkflowAssist = useMemo(
    () =>
      buildReportingWorkflowAssist({
        assistTarget,
        selectedReport,
        userRole
      }),
    [assistTarget, selectedReport, userRole]
  );

  return {
    focusedRowId,
    focusedSectionId,
    reportingWorkflowAssist
  };
}
