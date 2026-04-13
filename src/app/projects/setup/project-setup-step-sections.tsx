import type { Dispatch, SetStateAction } from "react";

import { DataTable } from "@/components/ui/table";
import { formatCurrency, formatNumber } from "@/lib/utils";

import { Input, Select } from "./project-setup-fields";
import type {
  ClientOption,
  EmployeeOption,
  LocationLinkMode,
  ProjectBillingRateItemFormLine,
  ProjectFormState,
  RigOption
} from "./project-setup-types";

type ReviewSummary = {
  clientName: string;
  location: string;
  status: string;
  primaryRig: string;
  secondaryRig: string;
  team: Array<{
    id: string;
    fullName: string;
    role: string;
  }>;
};

type ProjectSetupStepSectionsProps = {
  currentStep: number;
  form: ProjectFormState;
  setForm: Dispatch<SetStateAction<ProjectFormState>>;
  clients: ClientOption[];
  locationOptions: string[];
  derivedProjectStatus: string;
  billingTemplateOptions: Array<{ itemCode: string; label: string; unit: string }>;
  billingLineCode: string;
  setBillingLineCode: Dispatch<SetStateAction<string>>;
  addModeBlocked: boolean;
  selectedBillingTemplate: { unit: string } | null;
  billingLineRate: string;
  setBillingLineRate: Dispatch<SetStateAction<string>>;
  saveBillingLine: () => void;
  editingBillingCode: string | null;
  selectedBillingTemplateIsMeter: boolean;
  billingLineStageLabel: string;
  setBillingLineStageLabel: Dispatch<SetStateAction<string>>;
  derivedBillingLineDepthStartText: string;
  billingLineDepthEnd: string;
  setBillingLineDepthEnd: Dispatch<SetStateAction<string>>;
  billingLineItemCodePreview: string;
  billingLineError: string | null;
  activeBillingRateItems: ProjectBillingRateItemFormLine[];
  startEditBillingLine: (line: ProjectBillingRateItemFormLine) => void;
  archiveBillingLine: (itemCode: string) => void;
  archivedBillingItemCount: number;
  rigs: RigOption[];
  secondaryRigOptions: RigOption[];
  employees: EmployeeOption[];
  reviewSummary: ReviewSummary;
};

export function ProjectSetupStepSections({
  currentStep,
  form,
  setForm,
  clients,
  locationOptions,
  derivedProjectStatus,
  billingTemplateOptions,
  billingLineCode,
  setBillingLineCode,
  addModeBlocked,
  selectedBillingTemplate,
  billingLineRate,
  setBillingLineRate,
  saveBillingLine,
  editingBillingCode,
  selectedBillingTemplateIsMeter,
  billingLineStageLabel,
  setBillingLineStageLabel,
  derivedBillingLineDepthStartText,
  billingLineDepthEnd,
  setBillingLineDepthEnd,
  billingLineItemCodePreview,
  billingLineError,
  activeBillingRateItems,
  startEditBillingLine,
  archiveBillingLine,
  archivedBillingItemCount,
  rigs,
  secondaryRigOptions,
  employees,
  reviewSummary
}: ProjectSetupStepSectionsProps) {
  return (
    <>
      {currentStep === 1 ? (
        <div className="grid gap-3 md:grid-cols-2">
          <Input
            label="Project Name"
            value={form.name}
            onChange={(value) => setForm((current) => ({ ...current, name: value }))}
            required
          />

          <Select
            label="Client"
            value={form.clientId}
            onChange={(value) => setForm((current) => ({ ...current, clientId: value }))}
            options={clients.map((client) => ({ value: client.id, label: client.name }))}
            required
          />

          <label className="text-sm text-ink-700">
            <span className="mb-1 block">Location source</span>
            <select
              value={form.locationMode}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  locationMode: event.target.value as LocationLinkMode
                }))
              }
              className="w-full rounded-lg border border-slate-200 px-3 py-2"
            >
              <option value="EXISTING">Select existing location</option>
              <option value="NEW">Create new location</option>
            </select>
          </label>

          {form.locationMode === "EXISTING" ? (
            <Select
              label="Location"
              value={form.locationExisting}
              onChange={(value) => setForm((current) => ({ ...current, locationExisting: value }))}
              options={locationOptions.map((location) => ({ value: location, label: location }))}
              required
            />
          ) : (
            <Input
              label="New Location"
              value={form.locationNew}
              onChange={(value) => setForm((current) => ({ ...current, locationNew: value }))}
              required
            />
          )}
        </div>
      ) : null}

      {currentStep === 2 ? (
        <div className="grid gap-3 md:grid-cols-2">
          <Input
            label="Start Date"
            type="date"
            value={form.startDate}
            onChange={(value) => setForm((current) => ({ ...current, startDate: value }))}
            required
          />
          <Input
            label="End Date"
            type="date"
            value={form.endDate}
            onChange={(value) => setForm((current) => ({ ...current, endDate: value }))}
          />
          <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 md:col-span-2">
            Project status is automatic from dates: <span className="font-semibold text-slate-900">{derivedProjectStatus}</span>
          </div>
        </div>
      ) : null}

      {currentStep === 3 ? (
        <div className="space-y-4">
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
            <p className="text-sm font-semibold text-ink-900">Billing setup</p>
            <p className="mt-1 text-xs text-slate-700">Add what you charge the client for on this project.</p>

            <div className="mt-3 grid gap-2 md:grid-cols-4">
              <label className="text-sm text-ink-700">
                <span className="mb-1 block">Billable item</span>
                <select
                  value={billingLineCode}
                  onChange={(event) => setBillingLineCode(event.target.value)}
                  disabled={addModeBlocked}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2"
                >
                  {billingTemplateOptions.length === 0 ? (
                    <option value="">All billable items already added</option>
                  ) : (
                    billingTemplateOptions.map((template) => (
                      <option key={template.itemCode} value={template.itemCode}>
                        {template.label}
                      </option>
                    ))
                  )}
                </select>
              </label>
              <label className="text-sm text-ink-700">
                <span className="mb-1 block">Unit</span>
                <input
                  value={selectedBillingTemplate?.unit || ""}
                  readOnly
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-700"
                />
              </label>
              <label className="text-sm text-ink-700">
                <span className="mb-1 block">Rate</span>
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={billingLineRate}
                  onChange={(event) => setBillingLineRate(event.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2"
                />
              </label>
              <div className="text-sm text-ink-700">
                <span className="mb-1 block">Action</span>
                <button
                  type="button"
                  onClick={saveBillingLine}
                  disabled={addModeBlocked}
                  className="w-full rounded-lg border border-brand-300 bg-brand-50 px-3 py-2 font-semibold text-brand-800 hover:bg-brand-100 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {editingBillingCode ? "Save line" : "Add line"}
                </button>
              </div>
            </div>

            {selectedBillingTemplateIsMeter ? (
              <div className="mt-2 grid gap-2 md:grid-cols-3">
                <label className="text-sm text-ink-700">
                  <span className="mb-1 block">Stage label (optional)</span>
                  <input
                    value={billingLineStageLabel}
                    onChange={(event) => setBillingLineStageLabel(event.target.value)}
                    placeholder="PQ, HQ, NQ"
                    className="w-full rounded-lg border border-slate-200 px-3 py-2"
                  />
                </label>
                <label className="text-sm text-ink-700">
                  <span className="mb-1 block">From depth (m)</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={derivedBillingLineDepthStartText}
                    readOnly
                    className="w-full rounded-lg border border-slate-200 bg-slate-100 px-3 py-2 text-slate-700"
                  />
                </label>
                <label className="text-sm text-ink-700">
                  <span className="mb-1 block">To depth (m)</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={billingLineDepthEnd}
                    onChange={(event) => setBillingLineDepthEnd(event.target.value)}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2"
                  />
                </label>
              </div>
            ) : null}

            <p className="mt-2 text-[11px] text-slate-600">
              Item code: <span className="font-semibold">{billingLineItemCodePreview}</span>
            </p>
            {addModeBlocked ? (
              <p className="mt-2 rounded-lg border border-slate-200 bg-slate-100 px-2 py-1 text-xs text-slate-700">
                All billable items are already added. Use Edit to update a line.
              </p>
            ) : null}

            {billingLineError ? (
              <p className="mt-2 rounded-lg border border-rose-200 bg-rose-50 px-2 py-1 text-xs text-rose-800">
                {billingLineError}
              </p>
            ) : null}

            <div className="mt-3">
              {activeBillingRateItems.length === 0 ? (
                <div className="rounded-lg border border-slate-200 bg-white px-3 py-3 text-sm text-slate-600">
                  No lines yet. Add line to define how this project is billed.
                </div>
              ) : (
                <DataTable
                  compact
                  columns={["Billable item", "Unit", "Rate", "Action"]}
                  rows={activeBillingRateItems.map((line) => [
                    <div key={`${line.itemCode}-label`}>
                      <p className="font-semibold text-ink-900">{line.label}</p>
                      {line.drillingStageLabel ? (
                        <p className="text-[11px] text-slate-600">Stage: {line.drillingStageLabel}</p>
                      ) : null}
                      {typeof line.depthBandStartM === "number" && typeof line.depthBandEndM === "number" ? (
                        <p className="text-[11px] text-slate-600">
                          Depth: {formatNumber(line.depthBandStartM)}m - {formatNumber(line.depthBandEndM)}m
                        </p>
                      ) : null}
                      <p className="text-[11px] text-slate-600">{line.itemCode}</p>
                    </div>,
                    line.unit,
                    formatCurrency(line.unitRate),
                    <div key={`${line.itemCode}-actions`} className="inline-flex gap-2">
                      <button
                        type="button"
                        onClick={() => startEditBillingLine(line)}
                        className="rounded border border-slate-200 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => archiveBillingLine(line.itemCode)}
                        className="rounded border border-slate-200 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50"
                      >
                        Archive
                      </button>
                    </div>
                  ])}
                />
              )}
            </div>

            {archivedBillingItemCount > 0 ? (
              <p className="mt-2 text-[11px] text-slate-600">
                Archived lines: {archivedBillingItemCount}
              </p>
            ) : null}
            {activeBillingRateItems.length === 0 ? (
              <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-900">
                No billable lines yet. You can finish setup now and add lines later.
              </p>
            ) : null}
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <Input
              label="Budget (optional)"
              type="number"
              value={form.budgetAmount}
              onChange={(value) => setForm((current) => ({ ...current, budgetAmount: value }))}
            />
            <Input
              label="Expected Meters (optional)"
              type="number"
              value={form.estimatedMeters}
              onChange={(value) => setForm((current) => ({ ...current, estimatedMeters: value }))}
            />
            <Input
              label="Expected Days (optional)"
              type="number"
              value={form.estimatedDays}
              onChange={(value) => setForm((current) => ({ ...current, estimatedDays: value }))}
            />
            <Input
              label="Contract / Reference URL (optional)"
              value={form.contractReferenceUrl}
              onChange={(value) => setForm((current) => ({ ...current, contractReferenceUrl: value }))}
            />
            <label className="text-sm text-ink-700">
              <span className="mb-1 block">Contract/Reference Document (optional)</span>
              <input
                type="file"
                onChange={(event) => {
                  const fileName =
                    event.target.files && event.target.files.length > 0
                      ? event.target.files[0].name
                      : "";
                  setForm((current) => ({
                    ...current,
                    contractReferenceName: fileName || current.contractReferenceName
                  }));
                }}
                className="w-full rounded-lg border border-slate-200 px-3 py-2"
              />
            </label>
            <Input
              label="Stored Document Name (optional)"
              value={form.contractReferenceName}
              onChange={(value) => setForm((current) => ({ ...current, contractReferenceName: value }))}
            />
          </div>
        </div>
      ) : null}

      {currentStep === 4 ? (
        <div className="grid gap-3 md:grid-cols-2">
          <Select
            label="Primary Rig"
            value={form.primaryRigId}
            onChange={(value) =>
              setForm((current) => ({
                ...current,
                primaryRigId: value,
                secondaryRigId: value === current.secondaryRigId ? "" : current.secondaryRigId
              }))
            }
            options={rigs.map((rig) => ({ value: rig.id, label: rig.rigCode }))}
          />
          <Select
            label="Secondary Rig (optional)"
            value={form.secondaryRigId}
            onChange={(value) => setForm((current) => ({ ...current, secondaryRigId: value }))}
            options={secondaryRigOptions.map((rig) => ({ value: rig.id, label: rig.rigCode }))}
          />
          <div className="md:col-span-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
            <p>
              Primary rig: <span className="font-semibold">{rigs.find((rig) => rig.id === form.primaryRigId)?.rigCode || "Not assigned"}</span>
            </p>
            <p className="mt-1">
              Secondary rig: <span className="font-semibold">{rigs.find((rig) => rig.id === form.secondaryRigId)?.rigCode || "Not assigned"}</span>
            </p>
          </div>
        </div>
      ) : null}

      {currentStep === 5 ? (
        <div className="space-y-3">
          {employees.length === 0 ? (
            <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
              Employee list is unavailable for your current permission scope. You can still create/update the project.
            </p>
          ) : (
            <div className="grid gap-2 md:grid-cols-2">
              {employees
                .filter((employee) => employee.isActive)
                .map((employee) => {
                  const selected = form.teamMemberIds.includes(employee.id);
                  return (
                    <label
                      key={`project-team-${employee.id}`}
                      className={`flex items-center justify-between rounded-lg border px-3 py-2 text-sm ${
                        selected
                          ? "border-brand-300 bg-brand-50 text-brand-900"
                          : "border-slate-200 bg-white text-slate-800"
                      }`}
                    >
                      <span>
                        {employee.fullName}{" "}
                        <span className="text-xs uppercase tracking-wide text-slate-500">
                          ({employee.role})
                        </span>
                      </span>
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            teamMemberIds: event.target.checked
                              ? [...current.teamMemberIds, employee.id]
                              : current.teamMemberIds.filter((id) => id !== employee.id)
                          }))
                        }
                      />
                    </label>
                  );
                })}
            </div>
          )}
        </div>
      ) : null}

      {currentStep === 6 ? (
        <div className="space-y-3">
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
            <p className="font-semibold text-slate-900">Setup Summary</p>
            <div className="mt-2 grid gap-1 md:grid-cols-2">
              <p>
                <span className="font-semibold">Project:</span> {form.name || "-"}
              </p>
              <p>
                <span className="font-semibold">Client:</span> {reviewSummary.clientName}
              </p>
              <p>
                <span className="font-semibold">Location:</span> {reviewSummary.location}
              </p>
              <p>
                <span className="font-semibold">Status:</span> {reviewSummary.status}
              </p>
              <p>
                <span className="font-semibold">Start Date:</span> {form.startDate || "-"}
              </p>
              <p>
                <span className="font-semibold">End Date:</span> {form.endDate || "-"}
              </p>
              <p>
                <span className="font-semibold">Budget:</span>{" "}
                {form.budgetAmount ? formatCurrency(Number(form.budgetAmount)) : "-"}
              </p>
              <p>
                <span className="font-semibold">Expected meters:</span>{" "}
                {form.estimatedMeters ? formatNumber(Number(form.estimatedMeters)) : "-"}
              </p>
              <p>
                <span className="font-semibold">Expected days:</span>{" "}
                {form.estimatedDays ? formatNumber(Number(form.estimatedDays)) : "-"}
              </p>
              <p>
                <span className="font-semibold">Contract reference:</span>{" "}
                {form.contractReferenceUrl || form.contractReferenceName || "-"}
              </p>
              <p>
                <span className="font-semibold">Billable lines:</span>{" "}
                {formatNumber(activeBillingRateItems.length)}
              </p>
              <p>
                <span className="font-semibold">Primary Rig:</span> {reviewSummary.primaryRig}
              </p>
              <p>
                <span className="font-semibold">Secondary Rig:</span> {reviewSummary.secondaryRig}
              </p>
            </div>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">
            <p className="font-semibold text-slate-900">Assigned Team</p>
            {reviewSummary.team.length === 0 ? (
              <p className="mt-1">No team members selected.</p>
            ) : (
              <ul className="mt-1 list-disc pl-5">
                {reviewSummary.team.map((member) => (
                  <li key={`review-team-${member.id}`}>
                    {member.fullName} ({member.role})
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <Input
              label="Photo URL (optional)"
              value={form.photoUrl}
              onChange={(value) => setForm((current) => ({ ...current, photoUrl: value }))}
            />
            <label className="text-sm text-ink-700 md:col-span-2">
              <span className="mb-1 block">Project Notes (optional)</span>
              <textarea
                value={form.description}
                onChange={(event) =>
                  setForm((current) => ({ ...current, description: event.target.value }))
                }
                className="w-full rounded-lg border border-slate-200 px-3 py-2"
              />
            </label>
          </div>
        </div>
      ) : null}
    </>
  );
}
