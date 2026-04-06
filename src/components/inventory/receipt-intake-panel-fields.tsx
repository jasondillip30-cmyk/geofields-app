import type { ChangeEvent } from "react";

export type LinkedRecordType = "RECEIPT_INTAKE" | "INVENTORY_ITEM" | "STOCK_MOVEMENT" | "EXPENSE";

export interface FocusedLinkedRecord {
  id: string;
  label: string;
  type: LinkedRecordType;
  url: string;
}

export function InputField({
  label,
  value,
  onChange,
  type = "text",
  compact = false
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  compact?: boolean;
}) {
  return (
    <label className={compact ? "text-[11px] text-ink-700" : "text-xs text-ink-700"}>
      <span className={compact ? "mb-0.5 block uppercase tracking-wide text-slate-500" : "mb-1 block uppercase tracking-wide text-slate-500"}>
        {label}
      </span>
      <input
        type={type}
        value={value}
        onChange={(event: ChangeEvent<HTMLInputElement>) => onChange(event.target.value)}
        className={
          compact
            ? "w-full rounded-md border border-slate-200/70 px-2.5 py-1 text-[13px]"
            : "w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
        }
      />
    </label>
  );
}

export function SelectField({
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
    <label className="text-xs text-ink-700">
      <span className="mb-1 block uppercase tracking-wide text-slate-500">{label}</span>
      <select
        value={value}
        onChange={(event: ChangeEvent<HTMLSelectElement>) => onChange(event.target.value)}
        disabled={disabled}
        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm disabled:bg-slate-100"
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

export function DuplicateLinksGroup({
  title,
  emptyLabel,
  links,
  buttonLabel,
  onOpen
}: {
  title: string;
  emptyLabel: string;
  links: Array<{ id: string; label: string; type: string; url: string }>;
  buttonLabel: string;
  onOpen: (record: FocusedLinkedRecord) => void;
}) {
  return (
    <div className="rounded border border-slate-200 bg-slate-50 px-2 py-2">
      <p className="font-semibold text-slate-800">{title}</p>
      {links.length === 0 ? (
        <p className="mt-1 text-slate-600">{emptyLabel}</p>
      ) : (
        <div className="mt-2 space-y-1.5">
          {links.map((link) => (
            <div
              key={`${title}-${link.id}`}
              className="flex flex-wrap items-center justify-between gap-2 rounded border border-slate-200 bg-white px-2 py-1.5"
            >
              <span>{link.label}</span>
              <button
                type="button"
                onClick={() =>
                  onOpen({
                    id: link.id,
                    label: link.label,
                    type: normalizeLinkedRecordType(link.type),
                    url: link.url
                  })
                }
                className="rounded border border-slate-300 bg-white px-2 py-1 font-semibold text-slate-800 hover:bg-slate-100"
              >
                {buttonLabel}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function normalizeLinkedRecordType(value: string): LinkedRecordType {
  if (
    value === "INVENTORY_ITEM" ||
    value === "STOCK_MOVEMENT" ||
    value === "EXPENSE" ||
    value === "RECEIPT_INTAKE"
  ) {
    return value;
  }
  return "RECEIPT_INTAKE";
}

export function normalizeLinkedRecordUrl(url: string, type: LinkedRecordType, id: string) {
  const trimmed = typeof url === "string" ? url.trim() : "";
  if (trimmed.startsWith("/inventory?section=items")) {
    return `/inventory/items?itemId=${id}`;
  }
  if (trimmed.startsWith("/inventory?section=stock-movements")) {
    return `/inventory/stock-movements?movementId=${id}`;
  }
  if (
    trimmed.startsWith("/inventory/items") ||
    trimmed.startsWith("/inventory/stock-movements") ||
    trimmed.startsWith("/inventory/receipt-intake") ||
    trimmed.startsWith("/purchasing/receipt-follow-up")
  ) {
    return trimmed;
  }
  if (trimmed.startsWith("/expenses")) {
    return trimmed;
  }
  if (type === "INVENTORY_ITEM") {
    return `/inventory/items?itemId=${id}`;
  }
  if (type === "EXPENSE") {
    return `/expenses?expenseId=${id}`;
  }
  if (type === "STOCK_MOVEMENT") {
    return `/inventory/stock-movements?movementId=${id}`;
  }
  return `/purchasing/receipt-follow-up?movementId=${id}`;
}

export function formatLinkedRecordType(value: LinkedRecordType) {
  if (value === "INVENTORY_ITEM") return "Inventory Item";
  if (value === "STOCK_MOVEMENT") return "Stock Movement";
  if (value === "EXPENSE") return "Expense Record";
  return "Purchase Follow-up";
}

export function RecordSummaryGrid({ details }: { details: Record<string, unknown> }) {
  const data = asRecord(details.data) || details;
  const rows = Object.entries(data)
    .filter(([, value]) => value === null || ["string", "number", "boolean"].includes(typeof value))
    .slice(0, 20);

  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
        No summary fields available for this record.
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white">
      <p className="border-b border-slate-200 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
        Summary
      </p>
      <div className="grid gap-0.5 px-3 py-2 text-xs text-slate-800 sm:grid-cols-2">
        {rows.map(([key, value]) => (
          <p key={`summary-${key}`} className="rounded bg-slate-50 px-2 py-1">
            <span className="font-semibold">{humanizeKey(key)}:</span>{" "}
            {typeof value === "number" ? formatNumberValue(value) : value === null ? "-" : String(value)}
          </p>
        ))}
      </div>
    </div>
  );
}

export function RecordLinkedRows({ details }: { details: Record<string, unknown> }) {
  const candidates: Array<{ label: string; value: string }> = [];
  const roots = [details, asRecord(details.data)].filter(Boolean) as Array<Record<string, unknown>>;
  for (const root of roots) {
    for (const [key, raw] of Object.entries(root)) {
      const entry = asRecord(raw);
      if (!entry) continue;
      const id = asString(entry.id);
      if (!id) continue;
      const labelCandidate =
        asString(entry.name) ||
        asString(entry.rigCode) ||
        asString(entry.requestCode) ||
        asString(entry.fullName) ||
        asString(entry.label) ||
        id;
      candidates.push({
        label: humanizeKey(key),
        value: labelCandidate
      });
    }
  }

  if (candidates.length === 0) {
    return null;
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white">
      <p className="border-b border-slate-200 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
        Linked Records
      </p>
      <div className="space-y-1 px-3 py-2 text-xs text-slate-800">
        {candidates.slice(0, 16).map((candidate, index) => (
          <p key={`linked-${candidate.label}-${index}`} className="rounded bg-slate-50 px-2 py-1">
            <span className="font-semibold">{candidate.label}:</span> {candidate.value}
          </p>
        ))}
      </div>
    </div>
  );
}

function humanizeKey(value: string) {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase())
    .trim();
}

function formatNumberValue(value: number) {
  if (!Number.isFinite(value)) {
    return "0";
  }
  if (Math.abs(value) >= 1000) {
    return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
  }
  return value.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

function asString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function asRecord(value: unknown) {
  if (!value || typeof value !== "object") {
    return null;
  }
  return value as Record<string, unknown>;
}
