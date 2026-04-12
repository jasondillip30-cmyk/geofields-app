"use client";

import { AccessGate } from "@/components/layout/access-gate";
import { Card } from "@/components/ui/card";
import { formatProjectStatus } from "./drilling-reports-page-utils";
import type { ProjectOption } from "./drilling-reports-page-types";

interface BillingSummaryValue {
  label: string;
  value: string;
}

interface DrillingReportsWorkspaceShellCardProps {
  onCreateReport: () => void;
  isSingleProjectScope: boolean;
  orderedProjectTabs: ProjectOption[];
  visibleProjectTabs: ProjectOption[];
  overflowProjectTabs: ProjectOption[];
  recentProjectTabs: ProjectOption[];
  selectedProjectId: string;
  onSelectProject: (projectId: string) => void;
  selectedProject: ProjectOption | null;
  selectedProjectRigsLabel: string;
  selectedProjectBillingSummary: BillingSummaryValue;
}

export function DrillingReportsWorkspaceShellCard(
  props: DrillingReportsWorkspaceShellCardProps
) {
  const {
    onCreateReport,
    isSingleProjectScope,
    orderedProjectTabs,
    visibleProjectTabs,
    overflowProjectTabs,
    recentProjectTabs,
    selectedProjectId,
    onSelectProject,
    selectedProject,
    selectedProjectRigsLabel,
    selectedProjectBillingSummary
  } = props;

  return (
    <Card
      className="hidden"
      title="Drilling workspace"
      subtitle="Record what happened today. Use Project Operations for report browsing and detail review."
      action={
        <AccessGate permission="drilling:submit" fallback={null}>
          <button
            type="button"
            onClick={onCreateReport}
            className="gf-btn-primary px-3 py-2 text-xs"
          >
            Record report
          </button>
        </AccessGate>
      }
    >
      <div className="space-y-3">
        <div className="space-y-2">
          {!isSingleProjectScope ? (
            <>
              <div className="flex gap-2 overflow-x-auto pb-1">
                {orderedProjectTabs.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-slate-300 px-3 py-2 text-sm text-ink-600">
                    No active projects available in this scope.
                  </p>
                ) : (
                  visibleProjectTabs.map((project) => (
                    <button
                      key={project.id}
                      type="button"
                      onClick={() => onSelectProject(project.id)}
                      className={`whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                        project.id === selectedProjectId
                          ? "border-brand-500 bg-brand-50 text-brand-800"
                          : "border-slate-200 bg-white text-ink-700 hover:bg-slate-50"
                      }`}
                    >
                      {project.name}
                    </button>
                  ))
                )}
              </div>

              {(overflowProjectTabs.length > 0 || recentProjectTabs.length > 0) && (
                <div className="flex flex-wrap items-center gap-2">
                  {overflowProjectTabs.length > 0 && (
                    <label className="text-xs text-ink-700">
                      <span className="mr-2">More projects</span>
                      <select
                        value=""
                        onChange={(event) => {
                          if (event.target.value) {
                            onSelectProject(event.target.value);
                          }
                        }}
                        className="rounded-lg border border-slate-200 px-2 py-1 text-xs"
                      >
                        <option value="">Select project</option>
                        {overflowProjectTabs.map((project) => (
                          <option key={project.id} value={project.id}>
                            {project.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}

                  {recentProjectTabs.length > 0 && (
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs text-ink-600">Recent:</span>
                      {recentProjectTabs.map((project) => (
                        <button
                          key={`recent-${project.id}`}
                          type="button"
                          onClick={() => onSelectProject(project.id)}
                          className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] text-ink-700 hover:bg-slate-100"
                        >
                          {project.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
          ) : null}
        </div>

        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
          {!selectedProject ? (
            <p className="text-sm text-ink-600">
              {isSingleProjectScope
                ? "Select a project in the top bar to set the active drilling workspace."
                : "Select a project tab to set the active drilling workspace."}
            </p>
          ) : (
            <div className="grid gap-2 text-xs text-ink-700 md:grid-cols-2 xl:grid-cols-5">
              <p>
                <span className="font-semibold text-ink-800">Project:</span> {selectedProject.name}
              </p>
              <p>
                <span className="font-semibold text-ink-800">Client:</span> {selectedProject.client.name}
              </p>
              <p>
                <span className="font-semibold text-ink-800">Assigned Rig(s):</span> {selectedProjectRigsLabel}
              </p>
              <p>
                <span className="font-semibold text-ink-800">Status:</span>{" "}
                {formatProjectStatus(selectedProject.status)}
              </p>
              <p>
                <span className="font-semibold text-ink-800">
                  {selectedProjectBillingSummary.label}:
                </span>{" "}
                {selectedProjectBillingSummary.value}
              </p>
            </div>
          )}
          <p className="mt-1 text-[11px] text-slate-500">Top bar controls project and date scope.</p>
        </div>
        {selectedProject ? (
          <div className="gf-guided-strip">
            <p className="gf-guided-strip-title">Guided daily flow</p>
            <div className="gf-guided-step-list">
              <p className="gf-guided-step">1. Choose hole progression.</p>
              <p className="gf-guided-step">2. Enter meters and operational hours.</p>
              <p className="gf-guided-step">3. Save report to commit daily activity.</p>
            </div>
          </div>
        ) : null}
      </div>
    </Card>
  );
}
