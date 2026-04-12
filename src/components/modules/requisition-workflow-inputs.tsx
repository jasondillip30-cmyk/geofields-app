"use client";

import type { KeyboardEvent as ReactKeyboardEvent } from "react";

import type {
  RequisitionStatus,
  VendorSuggestion
} from "./requisition-workflow-types";

export function SelectInput({
  label,
  value,
  onChange,
  options,
  disabled = false
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  disabled?: boolean;
}) {
  return (
    <label className="text-sm text-ink-700">
      <span className="mb-1 block">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        className="w-full rounded-lg border border-slate-200 px-3 py-2 disabled:bg-slate-100"
      >
        {options.map((option) => (
          <option key={`${label}-${option.value}`} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function TextInput({
  label,
  value,
  onChange,
  required = false
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
}) {
  return (
    <label className="text-sm text-ink-700">
      <span className="mb-1 block">{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        required={required}
        className="w-full rounded-lg border border-slate-200 px-3 py-2"
      />
    </label>
  );
}

export function VendorTypeaheadInput({
  value,
  onChange,
  onFocus,
  onBlur,
  onKeyDown,
  showSuggestions,
  loading,
  suggestions,
  activeSuggestionIndex,
  onSuggestionHover,
  onSuggestionSelect,
  showCreateOption,
  onCreateOptionSelect
}: {
  value: string;
  onChange: (value: string) => void;
  onFocus: () => void;
  onBlur: () => void;
  onKeyDown: (event: ReactKeyboardEvent<HTMLInputElement>) => void;
  showSuggestions: boolean;
  loading: boolean;
  suggestions: VendorSuggestion[];
  activeSuggestionIndex: number;
  onSuggestionHover: (index: number) => void;
  onSuggestionSelect: (vendor: VendorSuggestion) => void;
  showCreateOption: boolean;
  onCreateOptionSelect: () => void;
}) {
  return (
    <label className="text-sm text-ink-700">
      <span className="mb-1 block">Vendor</span>
      <div className="relative">
        <input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onFocus={onFocus}
          onBlur={onBlur}
          onKeyDown={onKeyDown}
          aria-haspopup="listbox"
          aria-controls="requisition-vendor-suggestion-list"
          className="w-full rounded-lg border border-slate-200 px-3 py-2"
        />
        {showSuggestions && (
          <div className="absolute z-30 mt-1 w-full overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg">
            {loading ? (
              <p className="px-3 py-2 text-xs text-slate-600">Searching vendors...</p>
            ) : suggestions.length > 0 ? (
              <ul id="requisition-vendor-suggestion-list" role="listbox" className="max-h-52 overflow-auto py-1.5">
                {suggestions.map((suggestion, index) => (
                  <li key={suggestion.id}>
                    <button
                      type="button"
                      onMouseDown={(event) => {
                        event.preventDefault();
                        onSuggestionSelect(suggestion);
                      }}
                      onMouseEnter={() => onSuggestionHover(index)}
                      className={`w-full px-3 py-2 text-left ${
                        activeSuggestionIndex === index ? "bg-slate-100" : "hover:bg-slate-50"
                      }`}
                    >
                      <p className="text-sm font-medium text-slate-900">{suggestion.name}</p>
                      {suggestion.additionalInfo && (
                        <p className="text-xs text-slate-600">{suggestion.additionalInfo}</p>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            ) : showCreateOption ? (
              <div className="py-1.5">
                <button
                  type="button"
                  onMouseDown={(event) => {
                    event.preventDefault();
                    onCreateOptionSelect();
                  }}
                  onMouseEnter={() => onSuggestionHover(0)}
                  className={`w-full px-3 py-2 text-left text-sm ${
                    activeSuggestionIndex === 0 ? "bg-slate-100 text-slate-900" : "text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  + Create &quot;{value.trim()}&quot; as new vendor
                </button>
              </div>
            ) : (
              <p className="px-3 py-2 text-xs text-slate-600">No matching vendor.</p>
            )}
          </div>
        )}
      </div>
    </label>
  );
}

export function StatusChip({ status }: { status: RequisitionStatus }) {
  const style =
    status === "PURCHASE_COMPLETED"
      ? "border-emerald-300 bg-emerald-100 text-emerald-800"
      : status === "APPROVED"
        ? "border-indigo-300 bg-indigo-100 text-indigo-800"
        : status === "REJECTED"
          ? "border-red-300 bg-red-100 text-red-800"
          : "border-amber-300 bg-amber-100 text-amber-800";
  return (
    <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${style}`}>
      {status === "PURCHASE_COMPLETED"
        ? "Posted cost"
        : status.charAt(0) + status.slice(1).toLowerCase()}
    </span>
  );
}
