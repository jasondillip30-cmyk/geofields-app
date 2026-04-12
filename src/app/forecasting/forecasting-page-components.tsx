import {
  CUSTOM_CATEGORY_OPTION,
  type AdjustmentMode,
  type SimulationRow
} from "./forecasting-page-types";
import {
  clamp,
  formatSignedPercent,
  parseNumber
} from "./forecasting-page-utils";

export function Select({
  label,
  value,
  onChange,
  options
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <label className="text-sm text-ink-700">
      <span className="mb-1 block">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-lg border border-slate-200 px-3 py-2"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function SimulationRowEditor({
  row,
  options,
  duplicateCustomName,
  note,
  onCategoryChange,
  onModeChange,
  onValueChange,
  onCustomNameChange,
  onRemove
}: {
  row: SimulationRow;
  options: string[];
  duplicateCustomName: boolean;
  note?: string;
  onCategoryChange: (value: string) => void;
  onModeChange: (mode: AdjustmentMode) => void;
  onValueChange: (value: number) => void;
  onCustomNameChange: (value: string) => void;
  onRemove: () => void;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
      <div className="grid gap-2 md:grid-cols-[1.2fr_0.9fr_0.9fr_auto]">
        <label className="text-xs text-ink-700">
          <span className="mb-1 block">Category</span>
          <select
            value={row.categorySelection}
            onChange={(event) => onCategoryChange(event.target.value)}
            className="w-full rounded-lg border border-slate-200 px-3 py-2"
          >
            {options.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
            <option value={CUSTOM_CATEGORY_OPTION}>Add Custom Category</option>
          </select>
        </label>

        <label className="text-xs text-ink-700">
          <span className="mb-1 block">Change type</span>
          <select
            value={row.mode}
            onChange={(event) => onModeChange(event.target.value as AdjustmentMode)}
            className="w-full rounded-lg border border-slate-200 px-3 py-2"
          >
            <option value="percent">Percent (%)</option>
            <option value="fixed">Fixed amount ($)</option>
          </select>
        </label>

        <label className="text-xs text-ink-700">
          <span className="mb-1 block">Value</span>
          <input
            type="number"
            value={row.value}
            onChange={(event) => onValueChange(parseNumber(event.target.value))}
            className="w-full rounded-lg border border-slate-200 px-3 py-2"
          />
        </label>

        <button
          type="button"
          onClick={onRemove}
          className="self-end rounded-md border border-slate-200 px-3 py-2 text-xs text-ink-700 hover:bg-white"
        >
          Remove
        </button>
      </div>

      {row.categorySelection === CUSTOM_CATEGORY_OPTION && (
        <label className="mt-2 block text-xs text-ink-700">
          <span className="mb-1 block">Custom category name</span>
          <input
            type="text"
            value={row.customCategoryName}
            onChange={(event) => onCustomNameChange(event.target.value)}
            placeholder="e.g. Insurance"
            className="w-full rounded-lg border border-slate-200 px-3 py-2"
          />
        </label>
      )}

      {row.mode === "percent" && (
        <div className="mt-2">
          <input
            type="range"
            min={-100}
            max={100}
            step={1}
            value={clamp(row.value, -100, 100)}
            onChange={(event) => onValueChange(Number(event.target.value))}
            className="w-full accent-blue-600"
          />
          <div className="mt-1 flex justify-between text-[11px] text-ink-500">
            <span>-100%</span>
            <span>+100%</span>
          </div>
          {Math.abs(row.value) > 100 && (
            <p className="mt-1 text-[11px] text-amber-700">
              Manual percent value beyond slider range is active: {formatSignedPercent(row.value)}.
            </p>
          )}
        </div>
      )}

      {duplicateCustomName && (
        <p className="mt-1 text-[11px] text-amber-700">This custom category is duplicated in another row.</p>
      )}
      {note && <p className="mt-1 text-[11px] text-ink-600">{note}</p>}
    </div>
  );
}
