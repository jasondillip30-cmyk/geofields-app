import type { MaintenanceStatus, ProjectStatus, RigCondition, RigStatus } from "@/lib/types";
import { Badge } from "@/components/ui/badge";

export function RigStatusBadge({ status }: { status: RigStatus }) {
  const tone = status === "ACTIVE" ? "green" : status === "IDLE" ? "slate" : status === "MAINTENANCE" ? "amber" : "red";
  return <Badge tone={tone}>{status}</Badge>;
}

export function ConditionBadge({ condition }: { condition: RigCondition }) {
  const tone =
    condition === "EXCELLENT" || condition === "GOOD"
      ? "green"
      : condition === "FAIR"
        ? "amber"
        : "red";
  return <Badge tone={tone}>{condition}</Badge>;
}

export function MaintenanceStatusBadge({ status }: { status: MaintenanceStatus }) {
  const tone =
    status === "COMPLETED"
      ? "green"
      : status === "WAITING_FOR_PARTS"
        ? "amber"
        : status === "IN_REPAIR"
          ? "blue"
          : "slate";
  return <Badge tone={tone}>{status.replaceAll("_", " ")}</Badge>;
}

export function ProjectStatusBadge({ status }: { status: ProjectStatus }) {
  const tone =
    status === "ACTIVE"
      ? "green"
      : status === "COMPLETED"
        ? "blue"
        : status === "ON_HOLD"
          ? "amber"
          : "slate";
  return <Badge tone={tone}>{status.replaceAll("_", " ")}</Badge>;
}
