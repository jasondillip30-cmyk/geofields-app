import type { WorkflowAssistModel } from "@/components/layout/workflow-assist-panel";
import type { CopilotPageContext } from "@/lib/ai/contextual-copilot";

import { toIsoDate } from "./drilling-reports-page-utils";
import type { DrillReportRecord, DrillStats, ProjectOption } from "./drilling-reports-page-types";

export function buildDrillingReportsCopilotContext(params: {
  filters: {
    clientId: string;
    rigId: string;
    from: string;
    to: string;
  };
  stats: DrillStats;
  reports: DrillReportRecord[];
  selectedReport: DrillReportRecord | null;
  selectedProject: ProjectOption | null;
  isSingleProjectScope: boolean;
  scopedProjectId: string;
  buildHref: (path: string, overrides?: Record<string, string | null | undefined>) => string;
}): CopilotPageContext {
  const {
    filters,
    stats,
    reports,
    selectedReport,
    selectedProject,
    isSingleProjectScope,
    scopedProjectId,
    buildHref
  } = params;

  return {
    pageKey: "drilling-reports",
    pageName: "Drilling Reports",
    filters: {
      clientId: filters.clientId,
      rigId: filters.rigId,
      from: filters.from || null,
      to: filters.to || null
    },
    summaryMetrics: [
      { key: "reportsLogged", label: "Reports Logged", value: stats.reportsLogged },
      { key: "totalMeters", label: "Total Meters", value: stats.totalMeters },
      { key: "billableActivity", label: "Total Billable", value: stats.billableActivity },
      { key: "averageWorkHours", label: "Average Work Hours", value: stats.averageWorkHours }
    ],
    tablePreviews: [
      {
        key: "drilling-reports",
        title: "Drilling Reports",
        rowCount: reports.length,
        columns: ["Date", "Project", "Rig", "Hole", "Meters", "WorkHours", "DelayHours"],
        rows: reports.slice(0, 10).map((report) => ({
          id: report.id,
          date: toIsoDate(report.date),
          project: report.project.name,
          rig: report.rig.rigCode,
          hole: report.holeNumber,
          meters: report.totalMetersDrilled,
          workHours: report.workHours,
          delayHours: report.delayHours,
          billable: report.billableAmount,
          href: buildHref("/drilling-reports"),
          targetId: report.id,
          sectionId: "drilling-reports-table-section",
          targetPageKey: "drilling-reports"
        }))
      }
    ],
    selectedItems: selectedReport
      ? [
          {
            id: selectedReport.id,
            type: "drilling-report",
            label: `${selectedReport.project.name} • ${selectedReport.holeNumber}`
          }
        ]
      : [],
    priorityItems: reports
      .filter((report) => report.delayHours > 0)
      .sort((a, b) => b.delayHours - a.delayHours)
      .slice(0, 3)
      .map((report) => ({
        id: report.id,
        label: `${report.project.name} • ${report.holeNumber}`,
        reason: `Delay recorded (${report.delayHours.toFixed(1)} hours). Review report context.`,
        severity: report.delayHours >= 4 ? ("HIGH" as const) : ("MEDIUM" as const),
        amount: report.billableAmount,
        href: buildHref("/drilling-reports"),
        issueType: "DRILLING_REPORT_COMPLETENESS",
        targetId: report.id,
        sectionId: "drilling-reports-table-section",
        targetPageKey: "drilling-reports"
      })),
    navigationTargets: [
      {
        label: "Open Revenue",
        href: buildHref("/spending", { projectId: scopedProjectId || null }),
        reason: "Validate drilling output impact on revenue.",
        pageKey: "revenue"
      },
      {
        label: "Open Profit",
        href: buildHref("/spending/profit", { projectId: scopedProjectId || null }),
        reason: "Review profitability impact for drilling scope.",
        pageKey: "profit"
      }
    ],
    notes: selectedProject
      ? [
          `Active project: ${selectedProject.name} (${selectedProject.client.name}).`,
          isSingleProjectScope
            ? "Project scope is set from the top bar."
            : "Project tabs define operational context while top bar filters refine scope."
        ]
      : ["Select an active project to anchor drilling operations context."]
  };
}

export function buildReportingWorkflowAssist(params: {
  assistTarget: { reason?: string | null } | null;
  selectedReport: DrillReportRecord | null;
  userRole: string | null | undefined;
}): WorkflowAssistModel | null {
  const { assistTarget, selectedReport, userRole } = params;
  if (!assistTarget && !selectedReport) {
    return null;
  }
  const active = selectedReport;
  const missingContext: string[] = [];
  if (active && !active.leadOperatorName && !active.operatorCrew) {
    missingContext.push("Lead operator is missing.");
  }
  if (active && !active.areaLocation) {
    missingContext.push("Area/location field is missing.");
  }
  if (active && !active.comments) {
    missingContext.push("Comments note is missing.");
  }
  const roleLabel =
    userRole === "FIELD"
      ? "Field reporting assist"
      : userRole === "OFFICE"
        ? "Office reporting assist"
        : "Operations reporting assist";

  return {
    heading: "Field / Reporting Workflow Assist",
    roleLabel,
    tone: (active?.delayHours || 0) > 6 ? "amber" : "indigo",
    whyThisMatters:
      assistTarget?.reason ||
      (active
        ? `Report ${active.holeNumber} affects daily production completeness.`
        : "This reporting target was prioritized to improve operational visibility."),
    inspectFirst: [
      "Confirm drilling meters, work hours, and delay values are accurate.",
      "Verify rig/project alignment and hole reference fields.",
      "Check for missing daily notes."
    ],
    missingContext,
    checklist: [
      "Complete daily report",
      "Review drilling details",
      "Confirm rig/project assignment",
      "Add comments if needed",
      "Check reporting completeness"
    ],
    recommendedNextStep: active
      ? "Complete missing notes and save this report."
      : "Open the highlighted report and complete missing details first."
  };
}
