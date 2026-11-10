export function canOpenMaintenanceForRig({
  rigStatus,
  breakdownReportId
}: {
  rigStatus: string | null | undefined;
  breakdownReportId: string | null | undefined;
}) {
  const normalizedStatus = (rigStatus || "").trim().toUpperCase();
  if (normalizedStatus === "IDLE") {
    return true;
  }
  return normalizedStatus === "BREAKDOWN" && Boolean(breakdownReportId?.trim());
}

export function maintenanceRigEligibilityMessage(rigStatus: string | null | undefined) {
  const normalizedStatus = (rigStatus || "").trim().toUpperCase();
  if (normalizedStatus === "BREAKDOWN") {
    return "Breakdown rigs require a linked open breakdown report before maintenance can be opened.";
  }
  return "Maintenance can be opened for idle rigs or from a linked breakdown report.";
}

export function buildBreakdownMaintenanceHref({
  breakdownReportId,
  maintenanceRequestId
}: {
  breakdownReportId: string;
  maintenanceRequestId?: string | null;
}) {
  const query = new URLSearchParams({ workspace: "workshop" });
  if (maintenanceRequestId?.trim()) {
    query.set("maintenanceRequestId", maintenanceRequestId.trim());
  } else {
    query.set("breakdownId", breakdownReportId.trim());
  }
  return `/maintenance?${query.toString()}`;
}
