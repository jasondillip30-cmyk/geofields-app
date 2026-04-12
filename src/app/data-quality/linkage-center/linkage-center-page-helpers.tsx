import type { ReactNode } from "react";

import { Card } from "@/components/ui/card";
import { DataTable } from "@/components/ui/table";
import type { UserRole } from "@/lib/types";
import type {
  LinkageAiSuggestion,
  LinkageCenterPayload,
  LinkageSuggestionConfidence,
  LinkageType,
  MissingLinkageRow,
  SourceRecordType
} from "@/app/data-quality/linkage-center/linkage-center-page-types";

export function LinkageSection({
  loading,
  rows,
  rowIds,
  rowClassNames,
  emptyMessage
}: {
  loading: boolean;
  rows: ReactNode[][];
  rowIds: string[];
  rowClassNames: string[];
  emptyMessage: string;
}) {
  return (
    <Card>
      {loading ? (
        <p className="text-sm text-slate-600">Loading records...</p>
      ) : rows.length === 0 ? (
        <div className="gf-empty-state">{emptyMessage}</div>
      ) : (
        <DataTable
          columns={[
            "Source",
            "Reference",
            "Date",
            "Amount",
            "Current Context",
            "Recommended Action",
            "Assign & Save"
          ]}
          rows={rows}
          rowIds={rowIds}
          rowClassNames={rowClassNames}
        />
      )}
    </Card>
  );
}

export function RowActionCell({
  row,
  options,
  placeholder,
  value,
  disabled,
  saving,
  error,
  aiSuggestion,
  aiLoading,
  aiMessage,
  canApplyAi,
  confirmApplyAi,
  onChange,
  onSave,
  onGenerateAi,
  onRequestApplyAi,
  onConfirmApplyAi,
  onCancelApplyAi
}: {
  row: MissingLinkageRow;
  options: Array<{ id: string; label: string }>;
  placeholder: string;
  value: string;
  disabled: boolean;
  saving: boolean;
  error?: string;
  aiSuggestion?: LinkageAiSuggestion;
  aiLoading: boolean;
  aiMessage?: string;
  canApplyAi: boolean;
  confirmApplyAi: boolean;
  onChange: (value: string) => void;
  onSave: () => void;
  onGenerateAi: () => void;
  onRequestApplyAi: () => void;
  onConfirmApplyAi: () => void;
  onCancelApplyAi: () => void;
}) {
  const hasOptions = options.length > 0;
  const suggestedLabel = formatSuggestedTargetLabel(row.linkageType, aiSuggestion);

  return (
    <div className="min-w-[250px] space-y-2" data-card-ignore-click="true">
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled || !hasOptions}
        className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-ink-900 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500"
      >
        <option value="">{hasOptions ? placeholder : "No options available"}</option>
        {options.map((option) => (
          <option key={`${row.id}-${option.id}`} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={onSave}
        disabled={disabled || !value || !hasOptions}
        className="gf-btn-subtle w-full text-xs"
      >
        {saving ? "Saving..." : "Save linkage"}
      </button>
      <div className="rounded-lg border border-indigo-100 bg-indigo-50/60 p-2.5">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-indigo-700">AI suggestion (advisory)</p>
        {aiLoading ? (
          <p className="mt-1 text-xs text-slate-600">Generating suggestion...</p>
        ) : aiSuggestion ? (
          <div className="mt-1 space-y-1.5">
            <p className="text-xs text-slate-700">
              <span className="font-semibold text-slate-900">Suggested target:</span> {suggestedLabel || "No target"}
            </p>
            <p className="text-xs text-slate-700">
              <span className="font-semibold text-slate-900">Confidence:</span>{" "}
              <ConfidenceBadge confidence={aiSuggestion.confidence} />
            </p>
            <p className="text-xs text-slate-700">
              <span className="font-semibold text-slate-900">Reasoning:</span> {aiSuggestion.reasoning}
            </p>
            {!confirmApplyAi ? (
              <div className="flex flex-wrap gap-1.5">
                <button type="button" onClick={onGenerateAi} className="gf-btn-subtle text-xs" disabled={disabled}>
                  Refresh AI
                </button>
                <button
                  type="button"
                  onClick={onRequestApplyAi}
                  className="gf-btn-subtle text-xs"
                  disabled={!canApplyAi || !resolveAiSuggestedTargetId(row, aiSuggestion) || disabled}
                >
                  Apply AI suggestion
                </button>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-1.5">
                <p className="text-xs text-slate-700">Confirm applying this AI suggestion?</p>
                <button type="button" onClick={onConfirmApplyAi} className="gf-btn-subtle text-xs" disabled={disabled}>
                  Confirm
                </button>
                <button type="button" onClick={onCancelApplyAi} className="gf-btn-subtle text-xs">
                  Cancel
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="mt-1 space-y-1">
            <p className="text-xs text-slate-600">No AI suggestion generated yet.</p>
            <button type="button" onClick={onGenerateAi} className="gf-btn-subtle text-xs" disabled={disabled}>
              Generate AI suggestion
            </button>
          </div>
        )}
      </div>
      {error ? <p className="text-xs text-red-700">{error}</p> : null}
      {aiMessage ? <p className="text-xs text-slate-600">{aiMessage}</p> : null}
    </div>
  );
}

export function SourceRecordBadge({ sourceRecordType }: { sourceRecordType: SourceRecordType }) {
  const label = sourceRecordType === "EXPENSE" ? "Expense" : "Inventory Movement";
  const tone =
    sourceRecordType === "EXPENSE"
      ? "border-sky-200 bg-sky-50 text-sky-800"
      : "border-violet-200 bg-violet-50 text-violet-800";
  return (
    <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${tone}`}>
      {label}
    </span>
  );
}

export function projectOptionsForRow(
  row: MissingLinkageRow,
  projects: LinkageCenterPayload["lookups"]["projects"]
) {
  if (row.clientId) {
    const scoped = projects.filter((project) => project.clientId === row.clientId);
    if (scoped.length > 0) {
      return scoped;
    }
  }
  return projects;
}

export function maintenanceOptionsForRow(
  row: MissingLinkageRow,
  maintenanceRequests: LinkageCenterPayload["lookups"]["maintenanceRequests"]
) {
  const scoped = maintenanceRequests.filter((request) => {
    if (row.rigId && request.rigId && request.rigId !== row.rigId) {
      return false;
    }
    if (row.projectId && request.projectId && request.projectId !== row.projectId) {
      return false;
    }
    if (row.clientId && request.clientId && request.clientId !== row.clientId) {
      return false;
    }
    return true;
  });
  return scoped.length > 0 ? scoped : maintenanceRequests;
}

export function formatDisplayDate(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "-";
  }
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium"
  }).format(parsed);
}

export function buildFiltersQuery(filters: {
  workspaceMode?: string;
  projectId?: string;
  clientId: string;
  rigId: string;
  from: string;
  to: string;
}) {
  const params = new URLSearchParams();
  if (filters.workspaceMode && filters.workspaceMode !== "all-projects") {
    params.set("workspace", filters.workspaceMode);
  }
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  if (filters.projectId && filters.projectId !== "all") {
    params.set("projectId", filters.projectId);
    return params;
  }
  if (filters.clientId !== "all") params.set("clientId", filters.clientId);
  if (filters.rigId !== "all") params.set("rigId", filters.rigId);
  return params;
}

export function isManagerOrAdmin(role: UserRole | null | undefined) {
  return role === "ADMIN" || role === "MANAGER";
}

export function resolveAiSuggestedTargetId(row: MissingLinkageRow, suggestion: LinkageAiSuggestion) {
  if (row.linkageType === "RIG") {
    return suggestion.suggestedRigId;
  }
  if (row.linkageType === "PROJECT") {
    return suggestion.suggestedProjectId;
  }
  return suggestion.suggestedMaintenanceRequestId;
}

export function formatSuggestedTargetLabel(linkageType: LinkageType, suggestion?: LinkageAiSuggestion) {
  if (!suggestion) {
    return null;
  }
  if (linkageType === "RIG") {
    return suggestion.suggestedRigName;
  }
  if (linkageType === "PROJECT") {
    return suggestion.suggestedProjectName;
  }
  return suggestion.suggestedMaintenanceRequestCode;
}

export function ConfidenceBadge({ confidence }: { confidence: LinkageSuggestionConfidence }) {
  const tone =
    confidence === "HIGH"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : confidence === "MEDIUM"
        ? "border-amber-200 bg-amber-50 text-amber-700"
        : "border-slate-200 bg-slate-100 text-slate-700";
  return (
    <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${tone}`}>
      {confidence}
    </span>
  );
}
