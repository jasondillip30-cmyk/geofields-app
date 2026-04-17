"use client";

import type { Dispatch, SetStateAction } from "react";

import { Card } from "@/components/ui/card";
import {
  formatMaintenanceStatus,
  formatMaintenanceTypeLabel
} from "@/app/maintenance/maintenance-page-utils";
import type {
  BreakdownOption,
  MaintenanceFormState,
  MaintenanceWizardStep,
  ProjectOption,
  RigOption
} from "@/app/maintenance/maintenance-page-types";

interface WizardStepItem {
  step: MaintenanceWizardStep;
  label: string;
}

interface MaintenanceReportWizardCardProps {
  shouldSkipRigSelectionStep: boolean;
  visibleWizardSteps: WizardStepItem[];
  activeWizardStep: MaintenanceWizardStep;
  isSingleProjectScope: boolean;
  scopedProject: ProjectOption | null;
  scopedProjectRigOptions: RigOption[];
  rigOptionsForForm: RigOption[];
  stepOneBlockingMessage: string | null;
  loadingRefs: boolean;
  form: MaintenanceFormState;
  setForm: Dispatch<SetStateAction<MaintenanceFormState>>;
  isPrefilledFromBreakdown: boolean;
  linkedBreakdown: BreakdownOption | null;
  breakdownOptionsForRig: BreakdownOption[];
  selectedRig: RigOption | null;
  projectContextForForm: ProjectOption | null;
  detailsStepNumber: number;
  saveStepNumber: number;
  maintenanceTypeOptions: Array<{ value: MaintenanceFormState["maintenanceType"]; label: string }>;
  canReportMaintenance: boolean;
  submitting: boolean;
  currentStepError: string | null;
  onContinueWizard: () => void;
  onBackWizard: () => void;
  onSave: () => void;
}

export function MaintenanceReportWizardCard(props: MaintenanceReportWizardCardProps) {
  return (
    <Card
      title="Report maintenance activity"
      subtitle="Keep this simple: pick project rig, enter work details, save."
    >
      <div className="mb-3 gf-guided-strip">
        <p className="gf-guided-strip-title">Guided workflow</p>
        <div className="gf-guided-step-list">
          {props.shouldSkipRigSelectionStep ? (
            <>
              <p className="gf-guided-step">1. Confirm maintenance details.</p>
              <p className="gf-guided-step">2. Save maintenance record.</p>
              <p className="gf-guided-step">Project rig is already fixed by project setup.</p>
            </>
          ) : (
            <>
              <p className="gf-guided-step">1. Select the project rig.</p>
              <p className="gf-guided-step">2. Enter maintenance details.</p>
              <p className="gf-guided-step">3. Save maintenance record.</p>
            </>
          )}
        </div>
      </div>
      <div className="mb-3 grid gap-2 text-xs sm:grid-cols-3">
        {props.visibleWizardSteps.map((entry, index) => (
          <div
            key={entry.step}
            className={`rounded-lg border px-2 py-1.5 ${
              props.activeWizardStep === entry.step
                ? "border-brand-300 bg-brand-50 text-brand-900"
                : "border-slate-200 bg-slate-50 text-slate-600"
            }`}
          >
            <p className="font-semibold">
              {index + 1}. {entry.label}
            </p>
          </div>
        ))}
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault();
        }}
        className="space-y-3"
      >
        {props.activeWizardStep === 1 && (
          <div className="space-y-3">
            <p className="text-sm font-semibold text-slate-900">
              {props.isSingleProjectScope ? "Step 1 — Confirm project rig" : "Step 1 — Select rig"}
            </p>
            {props.isSingleProjectScope && (
              <div className="rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-xs text-brand-900">
                <p>
                  <span className="font-semibold">Project locked:</span>{" "}
                  {props.scopedProject?.name || "Selected project"}
                </p>
                <p>
                  <span className="font-semibold">Client:</span>{" "}
                  {props.scopedProject?.client?.name || "-"}
                </p>
                <p>
                  <span className="font-semibold">Allowed rigs:</span>{" "}
                  {props.scopedProjectRigOptions.length > 0
                    ? props.scopedProjectRigOptions.map((entry) => entry.rigCode).join(", ")
                    : "None"}
                </p>
              </div>
            )}

            {props.stepOneBlockingMessage ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                {props.stepOneBlockingMessage}
              </div>
            ) : props.rigOptionsForForm.length === 1 ? (
              <label className="text-sm text-ink-700">
                Rig
                <input
                  value={props.rigOptionsForForm[0]?.rigCode || "No project rig"}
                  disabled
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-slate-700"
                />
              </label>
            ) : (
              <label className="text-sm text-ink-700">
                Rig
                <select
                  value={props.form.rigId}
                  onChange={(event) =>
                    props.setForm((current) => ({
                      ...current,
                      rigId: event.target.value,
                      linkedBreakdownId:
                        current.rigId === event.target.value || props.isPrefilledFromBreakdown
                          ? current.linkedBreakdownId
                          : ""
                    }))
                  }
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
                  required
                  disabled={props.loadingRefs || props.isPrefilledFromBreakdown}
                >
                  <option value="">{props.loadingRefs ? "Loading rigs..." : "Select rig"}</option>
                  {props.rigOptionsForForm.map((rig) => (
                    <option key={rig.id} value={rig.id}>
                      {rig.rigCode}
                    </option>
                  ))}
                </select>
              </label>
            )}

            {props.isPrefilledFromBreakdown ? (
              <label className="text-sm text-ink-700">
                Linked breakdown
                <input
                  value={
                    props.linkedBreakdown
                      ? `${props.linkedBreakdown.title} (${props.linkedBreakdown.severity})`
                      : props.form.linkedBreakdownId
                  }
                  disabled
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-slate-700"
                />
              </label>
            ) : (
              <label className="text-sm text-ink-700">
                Link breakdown (optional)
                <select
                  value={props.form.linkedBreakdownId}
                  onChange={(event) =>
                    props.setForm((current) => ({
                      ...current,
                      linkedBreakdownId: event.target.value
                    }))
                  }
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
                  disabled={!props.form.rigId}
                >
                  <option value="">
                    {props.form.rigId ? "No breakdown link" : "Select a rig first"}
                  </option>
                  {props.breakdownOptionsForRig.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.title} ({entry.severity})
                    </option>
                  ))}
                </select>
              </label>
            )}

            {props.form.rigId && (
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
                <p>
                  <span className="font-semibold">Rig status:</span> {props.selectedRig?.status || "-"}
                </p>
                <p>
                  <span className="font-semibold">Project:</span>{" "}
                  {props.projectContextForForm?.name || "Rig is idle (no active project)"}
                </p>
                {props.selectedRig?.status === "BREAKDOWN" && (
                  <p className="text-amber-800">Rig is currently in breakdown status.</p>
                )}
              </div>
            )}
          </div>
        )}

        {props.activeWizardStep === 2 && (
          <div className="space-y-3">
            <p className="text-sm font-semibold text-slate-900">
              Step {props.detailsStepNumber} — Enter details
            </p>
            {props.isSingleProjectScope ? (
              <p className="rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-xs text-brand-900">
                Project mode is locked to {props.scopedProject?.name || "the selected project"}.
                {props.selectedRig?.rigCode ? ` Using rig ${props.selectedRig.rigCode}.` : ""}
              </p>
            ) : null}
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
              <label className="text-sm text-ink-700">
                Date
                <input
                  type="date"
                  value={props.form.requestDate}
                  onChange={(event) =>
                    props.setForm((current) => ({ ...current, requestDate: event.target.value }))
                  }
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
                  required
                />
              </label>
              <label className="text-sm text-ink-700">
                Status
                <select
                  value={props.form.status}
                  onChange={(event) =>
                    props.setForm((current) => ({
                      ...current,
                      status: event.target.value as MaintenanceFormState["status"]
                    }))
                  }
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
                >
                  <option value="OPEN">Open</option>
                  <option value="IN_REPAIR">In repair</option>
                  <option value="WAITING_FOR_PARTS">Waiting for parts</option>
                  <option value="COMPLETED">Completed</option>
                </select>
              </label>
              <label className="text-sm text-ink-700">
                Maintenance type
                <select
                  value={props.form.maintenanceType}
                  onChange={(event) =>
                    props.setForm((current) => ({
                      ...current,
                      maintenanceType:
                        event.target.value as MaintenanceFormState["maintenanceType"]
                    }))
                  }
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
                  required
                >
                  <option value="">Select type</option>
                  {props.maintenanceTypeOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm text-ink-700">
                Estimated downtime (hrs)
                <input
                  type="number"
                  min="0"
                  step="0.1"
                  value={props.form.estimatedDowntimeHrs}
                  onChange={(event) =>
                    props.setForm((current) => ({
                      ...current,
                      estimatedDowntimeHrs: event.target.value
                    }))
                  }
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
                  placeholder="Optional"
                />
              </label>
              <label className="text-sm text-ink-700 lg:col-span-3">
                Issue / work description
                <textarea
                  value={props.form.issueDescription}
                  onChange={(event) =>
                    props.setForm((current) => ({
                      ...current,
                      issueDescription: event.target.value
                    }))
                  }
                  className="mt-1 min-h-24 w-full rounded-lg border border-slate-200 px-3 py-2"
                  placeholder="Describe the maintenance activity."
                  required
                />
              </label>
              <label className="text-sm text-ink-700 lg:col-span-3">
                Notes (optional)
                <textarea
                  value={props.form.notes}
                  onChange={(event) =>
                    props.setForm((current) => ({ ...current, notes: event.target.value }))
                  }
                  className="mt-1 min-h-20 w-full rounded-lg border border-slate-200 px-3 py-2"
                />
              </label>
            </div>
          </div>
        )}

        {props.activeWizardStep === 3 && (
          <div className="space-y-3">
            <p className="text-sm font-semibold text-slate-900">Step {props.saveStepNumber} — Save</p>
            <div className="grid gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 md:grid-cols-2">
              <p>
                <span className="font-semibold">Rig:</span>{" "}
                {props.selectedRig?.rigCode || props.form.rigId || "-"}
              </p>
              <p>
                <span className="font-semibold">Date:</span> {props.form.requestDate || "-"}
              </p>
              <p>
                <span className="font-semibold">Project:</span>{" "}
                {props.projectContextForForm?.name || "Idle (no active project)"}
              </p>
              <p>
                <span className="font-semibold">Linked breakdown:</span>{" "}
                {props.linkedBreakdown?.title || props.form.linkedBreakdownId || "-"}
              </p>
              <p>
                <span className="font-semibold">Maintenance type:</span>{" "}
                {formatMaintenanceTypeLabel(props.form.maintenanceType)}
              </p>
              <p>
                <span className="font-semibold">Status:</span>{" "}
                {formatMaintenanceStatus(props.form.status)}
              </p>
              <p>
                <span className="font-semibold">Downtime:</span>{" "}
                {props.form.estimatedDowntimeHrs ? `${props.form.estimatedDowntimeHrs} hrs` : "-"}
              </p>
              <p className="md:col-span-2">
                <span className="font-semibold">Description:</span>{" "}
                {props.form.issueDescription || "-"}
              </p>
              <p className="md:col-span-2">
                <span className="font-semibold">Notes:</span> {props.form.notes.trim() || "-"}
              </p>
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 border-t border-slate-200 pt-3">
          {props.activeWizardStep > 1 && (
            <button
              type="button"
              onClick={props.onBackWizard}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
            >
              Back
            </button>
          )}
          {props.activeWizardStep < 3 ? (
            <button
              type="button"
              onClick={props.onContinueWizard}
              disabled={Boolean(props.currentStepError)}
              className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Continue
            </button>
          ) : (
            <button
              type="button"
              onClick={props.onSave}
              disabled={!props.canReportMaintenance || props.submitting}
              className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
            >
              {props.submitting ? "Saving..." : "Save maintenance record"}
            </button>
          )}
          {!props.canReportMaintenance && (
            <p className="text-xs text-amber-800">
              Your role can view maintenance history but cannot create records.
            </p>
          )}
          {props.activeWizardStep < 3 && props.currentStepError && (
            <p className="text-xs text-amber-800">{props.currentStepError}</p>
          )}
        </div>
      </form>
    </Card>
  );
}
