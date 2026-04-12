import { DRILL_DELAY_REASON_OPTIONS, type DrillDelayReasonCategory } from "@/lib/drill-report-delay-reasons";
import { formatCurrency, formatNumber } from "@/lib/utils";

import type {
  DrillReportFormState,
  DrillReportRecord,
  HoleProgressSummary,
  ProjectOption,
  ProjectBillingRateItemOption
} from "./drilling-reports-page-types";

export function SummaryItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
      <p className="text-[11px] uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-sm font-medium text-ink-800">{value}</p>
    </div>
  );
}

export function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[140px_minmax(0,1fr)] gap-3 rounded-md border border-slate-100 bg-slate-50 px-3 py-2">
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <p className="break-words text-sm text-ink-800">{value}</p>
    </div>
  );
}

export function InputField({
  label,
  type = "text",
  value,
  onChange,
  required = false
}: {
  label: string;
  type?: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
}) {
  return (
    <label className="text-sm text-ink-700">
      <span className="mb-1 block">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        required={required}
        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none ring-brand-300 focus:ring"
      />
    </label>
  );
}

export function SelectField({
  label,
  value,
  onChange,
  options,
  required = false
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  required?: boolean;
}) {
  return (
    <label className="text-sm text-ink-700">
      <span className="mb-1 block">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        required={required}
        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none ring-brand-300 focus:ring"
      >
        <option value="">Select</option>
        {options.map((option) => (
          <option key={`${label}-${option.value}`} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return (
    <label className="text-sm text-ink-700">
      <span className="mb-1 block">{label}</span>
      <div className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-ink-800">{value}</div>
    </label>
  );
}

export function createEmptyForm(projectId = "", rigId = ""): DrillReportFormState {
  return {
    date: new Date().toISOString().slice(0, 10),
    projectId,
    rigId,
    holeMode: "CONTINUE",
    selectedHoleNumber: "",
    holeNumber: "",
    fromMeter: "0",
    toMeter: "0",
    metersDrilledToday: "0",
    workHours: "0",
    rigMoves: "0",
    standbyHours: "0",
    delayHours: "0",
    delayReasonCategory: "",
    delayReasonNote: "",
    holeContinuityOverrideReason: "",
    leadOperatorName: "",
    assistantCount: "0",
    comments: "",
    billableQuantities: {}
  };
}

export function buildHoleProgressSummaries(reports: DrillReportRecord[]) {
  const byHole = new Map<string, HoleProgressSummary>();
  for (const report of reports) {
    if (report.approvalStatus === "REJECTED") {
      continue;
    }
    const holeNumber = report.holeNumber?.trim();
    if (!holeNumber) {
      continue;
    }
    const rangeEnd = Math.max(Number(report.fromMeter || 0), Number(report.toMeter || 0));
    const existing = byHole.get(holeNumber);
    if (!existing) {
      byHole.set(holeNumber, {
        holeNumber,
        currentDepth: rangeEnd,
        lastReportDate: report.date
      });
      continue;
    }
    const nextDepth = Math.max(existing.currentDepth, rangeEnd);
    const nextDate = new Date(report.date).getTime() > new Date(existing.lastReportDate).getTime()
      ? report.date
      : existing.lastReportDate;
    byHole.set(holeNumber, {
      holeNumber,
      currentDepth: nextDepth,
      lastReportDate: nextDate
    });
  }

  return Array.from(byHole.values()).sort((left, right) => {
    const numDiff = extractHoleSequence(left.holeNumber) - extractHoleSequence(right.holeNumber);
    if (numDiff !== 0) {
      return numDiff;
    }
    return left.holeNumber.localeCompare(right.holeNumber);
  });
}

export function getNextHoleNumberSuggestion(holes: HoleProgressSummary[]) {
  const maxSequence = holes.reduce((max, hole) => Math.max(max, extractHoleSequence(hole.holeNumber)), 0);
  return `H-${maxSequence + 1}`;
}

function extractHoleSequence(holeNumber: string) {
  const match = holeNumber.match(/(\d+)(?!.*\d)/);
  if (!match) {
    return 0;
  }
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function resolveStageContextRows(
  billingItems: ProjectBillingRateItemOption[],
  fromMeter: number,
  toMeter: number
) {
  const rangeStart = Math.min(fromMeter, toMeter);
  const rangeEnd = Math.max(fromMeter, toMeter);
  if (!Number.isFinite(rangeStart) || !Number.isFinite(rangeEnd) || rangeEnd <= rangeStart) {
    return [] as Array<{ label: string; rangeStart: number; rangeEnd: number }>;
  }

  return billingItems
    .filter((item) => item.isActive && item.unit.toLowerCase() === "meter")
    .filter(
      (item) =>
        Number.isFinite(item.depthBandStartM) &&
        Number.isFinite(item.depthBandEndM)
    )
    .map((item) => {
      const bandStart = Math.min(item.depthBandStartM as number, item.depthBandEndM as number);
      const bandEnd = Math.max(item.depthBandStartM as number, item.depthBandEndM as number);
      const overlapStart = Math.max(rangeStart, bandStart);
      const overlapEnd = Math.min(rangeEnd, bandEnd);
      return {
        label: item.drillingStageLabel || item.label,
        rangeStart: overlapStart,
        rangeEnd: overlapEnd
      };
    })
    .filter((item) => item.rangeEnd > item.rangeStart)
    .sort((left, right) => left.rangeStart - right.rangeStart);
}

export function parseDelayReasonCategoryForForm(
  value: string | null
): DrillDelayReasonCategory | "" {
  if (!value) {
    return "";
  }
  return DRILL_DELAY_REASON_OPTIONS.some((option) => option.value === value)
    ? (value as DrillDelayReasonCategory)
    : "";
}

export function formatDelayReasonLabel(value: DrillDelayReasonCategory | null) {
  if (!value) {
    return "-";
  }
  return DRILL_DELAY_REASON_OPTIONS.find((option) => option.value === value)?.label || value;
}

export function formatCrewSummary(report: {
  leadOperatorName: string | null;
  assistantCount: number;
  operatorCrew: string | null;
}) {
  const leadOperatorName = report.leadOperatorName?.trim() || "";
  const assistantCount = Math.max(0, Math.round(Number(report.assistantCount || 0)));
  if (leadOperatorName && assistantCount > 0) {
    return `${leadOperatorName} + ${assistantCount} assistant${assistantCount === 1 ? "" : "s"}`;
  }
  if (leadOperatorName) {
    return leadOperatorName;
  }
  if (assistantCount > 0) {
    return `${assistantCount} assistant${assistantCount === 1 ? "" : "s"}`;
  }
  return report.operatorCrew || "-";
}

export function buildProjectBillingSummary(project: ProjectOption | null) {
  if (!project) {
    return {
      label: "Billing setup",
      value: "-"
    };
  }

  const activeBillingItems = (project.billingRateItems || [])
    .filter((item) => item.isActive)
    .sort((left, right) => left.sortOrder - right.sortOrder);
  const stagedMeterItems = activeBillingItems.filter(
    (item) =>
      isMeterUnitValue(item.unit) &&
      Number.isFinite(item.depthBandStartM) &&
      Number.isFinite(item.depthBandEndM)
  );
  const singleMeterItems = activeBillingItems.filter(
    (item) => isMeterUnitValue(item.unit) && !Number.isFinite(item.depthBandStartM) && !Number.isFinite(item.depthBandEndM)
  );

  if (stagedMeterItems.length > 1) {
    const stagedSummary = stagedMeterItems
      .slice(0, 3)
      .map((item) => {
        const bandStart = Math.min(Number(item.depthBandStartM || 0), Number(item.depthBandEndM || 0));
        const bandEnd = Math.max(Number(item.depthBandStartM || 0), Number(item.depthBandEndM || 0));
        const label = item.drillingStageLabel?.trim() || item.label;
        return `${label} ${formatCurrency(item.unitRate)}/m (${formatNumber(bandStart)}m-${formatNumber(bandEnd)}m)`;
      });
    const remainingCount = stagedMeterItems.length - stagedSummary.length;
    return {
      label: "Staged billing",
      value: remainingCount > 0 ? `${stagedSummary.join(" • ")} • +${remainingCount} more` : stagedSummary.join(" • ")
    };
  }

  if (singleMeterItems.length === 1) {
    return {
      label: "Contract rate",
      value: `${formatCurrency(singleMeterItems[0].unitRate)} / meter`
    };
  }

  if (activeBillingItems.length > 0) {
    return {
      label: "Billing setup",
      value: `${activeBillingItems.length} line${activeBillingItems.length === 1 ? "" : "s"} configured`
    };
  }

  return {
    label: "Contract rate",
    value: `${formatCurrency(project.contractRatePerM)} / meter`
  };
}

function isMeterUnitValue(unit: string) {
  const normalized = unit.trim().toLowerCase();
  return normalized === "meter" || normalized === "m";
}

export function formatProjectStatus(value: string) {
  return value.replace(/_/g, " ").toLowerCase().replace(/(^|\s)\w/g, (match) => match.toUpperCase());
}

export function toIsoDate(value: string | Date) {
  return new Date(value).toISOString().slice(0, 10);
}

export function formatDateTime(value: string | null) {
  if (!value) {
    return "-";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "-";
  }
  return parsed.toLocaleString("en-US");
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
