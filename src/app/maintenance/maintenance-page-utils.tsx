export type OperationalMaintenanceStatus =
  | "OPEN"
  | "IN_REPAIR"
  | "WAITING_FOR_PARTS"
  | "COMPLETED";

export function getProjectRigIds(
  project:
    | {
        assignedRigId: string | null;
        backupRigId: string | null;
      }
    | null
) {
  if (!project) {
    return [];
  }
  const ids = [project.assignedRigId, project.backupRigId].filter(
    (value): value is string => Boolean(value)
  );
  return Array.from(new Set(ids));
}

export function normalizeMaintenanceStatus(value: string): {
  status: OperationalMaintenanceStatus;
  legacySource: string | null;
} {
  const normalized = value.trim().toUpperCase();
  if (normalized === "OPEN") {
    return { status: "OPEN", legacySource: null };
  }
  if (normalized === "COMPLETED") {
    return { status: "COMPLETED", legacySource: null };
  }
  if (normalized === "WAITING_FOR_PARTS") {
    return { status: "WAITING_FOR_PARTS", legacySource: null };
  }
  if (normalized === "IN_REPAIR") {
    return { status: "IN_REPAIR", legacySource: null };
  }
  return { status: "OPEN", legacySource: null };
}

export function maintenanceRowSortValue(
  row:
    | {
        requestDate?: string;
        createdAt?: string;
        date?: string;
      }
    | undefined
) {
  if (!row) {
    return 0;
  }
  const parsed = new Date(row.requestDate || row.createdAt || row.date || "");
  if (Number.isNaN(parsed.getTime())) {
    return 0;
  }
  return parsed.getTime();
}

export function formatMaintenanceStatus(value: string, includeLegacySource = false) {
  const normalized = normalizeMaintenanceStatus(value);
  const label =
    normalized.status === "OPEN"
      ? "Open"
      : normalized.status === "IN_REPAIR"
        ? "In repair"
        : normalized.status === "WAITING_FOR_PARTS"
          ? "Waiting for parts"
          : "Completed";
  if (!includeLegacySource || !normalized.legacySource) {
    return label;
  }
  return `${label} (legacy: ${toLabelCase(normalized.legacySource)})`;
}

export function formatMaintenanceTypeLabel(value: string) {
  const normalized = (value || "").trim().toUpperCase();
  if (normalized === "ROUTINE_MAINTENANCE") return "Routine Maintenance";
  if (normalized === "INSPECTION_CHECK") return "Inspection / Check";
  if (normalized === "PREVENTIVE_SERVICE") return "Preventive Service";
  if (normalized === "OTHER") return "Other";
  return value || "-";
}

export function toDate(value: string | null | undefined) {
  if (!value) {
    return "-";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toISOString().slice(0, 10);
}

export function toDateTime(value: string | null | undefined) {
  if (!value) {
    return "-";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toISOString().replace("T", " ").slice(0, 16);
}

export function toLabelCase(value: string) {
  return value
    .toLowerCase()
    .split("_")
    .map((entry) => entry.charAt(0).toUpperCase() + entry.slice(1))
    .join(" ");
}

export function MaintenanceStatusChip({
  status,
  legacySource
}: {
  status: OperationalMaintenanceStatus;
  legacySource: string | null;
}) {
  const className =
    status === "COMPLETED"
      ? "border-emerald-300 bg-emerald-100 text-emerald-800"
      : status === "WAITING_FOR_PARTS"
        ? "border-amber-300 bg-amber-100 text-amber-800"
        : status === "IN_REPAIR"
          ? "border-indigo-300 bg-indigo-100 text-indigo-800"
          : "border-slate-300 bg-slate-100 text-slate-800";

  return (
    <span
      className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${className}`}
      title={legacySource ? `Legacy source: ${toLabelCase(legacySource)}` : undefined}
    >
      {status === "OPEN"
        ? "Open"
        : status === "IN_REPAIR"
          ? "In repair"
          : status === "WAITING_FOR_PARTS"
            ? "Waiting for parts"
            : "Completed"}
    </span>
  );
}
