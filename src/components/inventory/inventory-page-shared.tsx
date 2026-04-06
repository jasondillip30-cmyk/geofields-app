import type { ChangeEvent } from "react";

export function FilterSelect({
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
    <label className="text-xs text-ink-700">
      <span className="mb-1 block uppercase tracking-wide text-slate-500">{label}</span>
      <select
        value={value}
        onChange={(event: ChangeEvent<HTMLSelectElement>) => onChange(event.target.value)}
        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
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

export function InputField({
  label,
  value,
  onChange,
  type = "text",
  required = false
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  required?: boolean;
}) {
  return (
    <label className="text-xs text-ink-700">
      <span className="mb-1 block uppercase tracking-wide text-slate-500">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(event: ChangeEvent<HTMLInputElement>) => onChange(event.target.value)}
        required={required}
        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
      />
    </label>
  );
}

export function SummaryBadge({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5">
      <p className="text-[10px] uppercase tracking-wide text-slate-500">{label}</p>
      <p className="text-sm font-medium text-ink-800">{value}</p>
    </div>
  );
}

export function IssueSeverityBadge({ severity }: { severity: "HIGH" | "MEDIUM" | "LOW" }) {
  const toneClass =
    severity === "HIGH"
      ? "border-red-300 bg-red-100 text-red-800"
      : severity === "MEDIUM"
        ? "border-amber-300 bg-amber-100 text-amber-800"
        : "border-slate-300 bg-slate-100 text-slate-700";

  return (
    <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${toneClass}`}>
      {severity}
    </span>
  );
}

export function StockSeverityBadge({ severity }: { severity: "CRITICAL" | "LOW" }) {
  const toneClass =
    severity === "CRITICAL"
      ? "border-red-300 bg-red-100 text-red-800"
      : "border-amber-300 bg-amber-100 text-amber-800";
  const label = severity === "CRITICAL" ? "Out of Stock" : "Low Stock";

  return (
    <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${toneClass}`}>
      {label}
    </span>
  );
}

export function UsageRequestStatusBadge({ status }: { status: "SUBMITTED" | "PENDING" | "APPROVED" | "REJECTED" }) {
  const toneClass =
    status === "APPROVED"
      ? "border-emerald-300 bg-emerald-100 text-emerald-800"
      : status === "REJECTED"
        ? "border-red-300 bg-red-100 text-red-800"
        : status === "PENDING"
          ? "border-amber-300 bg-amber-100 text-amber-800"
          : "border-blue-300 bg-blue-100 text-blue-800";
  const label = status.charAt(0) + status.slice(1).toLowerCase();

  return (
    <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${toneClass}`}>
      {label}
    </span>
  );
}

export function isOperationalMaintenanceOpen(status: string | null | undefined) {
  const normalized = (status || "").trim().toUpperCase();
  return normalized === "OPEN" || normalized === "IN_REPAIR" || normalized === "WAITING_FOR_PARTS";
}

export function normalizeBreakdownLikeStatus(status: string | null | undefined) {
  const normalized = (status || "").trim().toUpperCase();
  if (normalized === "RESOLVED" || normalized === "CLOSED" || normalized === "COMPLETED") {
    return "RESOLVED";
  }
  return "OPEN";
}

export async function readApiError(response: Response, fallbackMessage: string) {
  const clone = response.clone();
  const payload = await response.json().catch(() => null);
  if (payload && typeof payload === "object" && "message" in payload) {
    const message = payload.message;
    if (typeof message === "string" && message.trim()) {
      return message;
    }
  }

  const rawBody = (await clone.text().catch(() => "")).trim();
  if (rawBody) {
    return rawBody;
  }

  return `${fallbackMessage} (HTTP ${response.status})`;
}
