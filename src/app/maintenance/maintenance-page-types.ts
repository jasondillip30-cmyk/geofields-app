import type { OperationalMaintenanceStatus } from "@/app/maintenance/maintenance-page-utils";

export type MaintenanceWizardStep = 1 | 2 | 3;

export interface RigOption {
  id: string;
  rigCode: string;
  status: string;
}

export interface ProjectOption {
  id: string;
  name: string;
  status: string;
  clientId: string;
  assignedRigId: string | null;
  backupRigId: string | null;
  client: {
    name: string;
  } | null;
}

export interface BreakdownOption {
  id: string;
  title: string;
  severity: string;
  status: string;
  project?: {
    id: string;
    name: string;
  } | null;
  rig?: {
    id: string;
    rigCode: string;
  } | null;
}

export interface MaintenanceRow {
  id: string;
  requestCode: string;
  date: string;
  requestDate: string;
  rigId: string;
  projectId: string | null;
  issueType: string;
  issueDescription: string;
  status: string;
  estimatedDowntimeHours: number;
  notes: string | null;
  breakdownReportId: string | null;
  rig: { id: string; rigCode: string } | null;
  project: { id: string; name: string } | null;
  breakdownReport:
    | {
        id: string;
        title: string;
        status: string;
        severity: string;
      }
    | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface MaintenanceFormState {
  requestDate: string;
  rigId: string;
  linkedBreakdownId: string;
  maintenanceType:
    | "ROUTINE_MAINTENANCE"
    | "INSPECTION_CHECK"
    | "PREVENTIVE_SERVICE"
    | "OTHER"
    | "";
  status: OperationalMaintenanceStatus;
  issueDescription: string;
  estimatedDowntimeHrs: string;
  notes: string;
}

export interface LogFilterState {
  rigId: string;
  status: "all" | OperationalMaintenanceStatus;
  from: string;
  to: string;
  linkage: "all" | "linked" | "unlinked";
}

export interface LinkedUsageRequestRow {
  id: string;
  quantity: number;
  status: string;
  reason: string;
  createdAt: string;
  item: { id: string; name: string; sku: string } | null;
  requestedBy: { id: string; fullName: string; role: string } | null;
}

export interface LinkedRequisitionRow {
  id: string;
  requisitionCode: string;
  type: string;
  status: string;
  submittedAt: string;
  totals: {
    estimatedTotalCost: number;
  };
  contextLabels?: {
    projectName: string | null;
  };
}

export interface AuditRow {
  id: string;
  action: string;
  description: string;
  createdAt: string;
  actorName: string | null;
}

export interface RigMaintenanceHistoryRow {
  rigId: string;
  rigCode: string;
  currentStatus: OperationalMaintenanceStatus | null;
  latestMaintenanceDate: string;
  caseCount: number;
  cases: MaintenanceRow[];
}

export const INITIAL_FORM_STATE: MaintenanceFormState = {
  requestDate: new Date().toISOString().slice(0, 10),
  rigId: "",
  linkedBreakdownId: "",
  maintenanceType: "",
  status: "OPEN",
  issueDescription: "",
  estimatedDowntimeHrs: "",
  notes: ""
};

export const INITIAL_LOG_FILTERS: LogFilterState = {
  rigId: "",
  status: "all",
  from: "",
  to: "",
  linkage: "all"
};

export const STEP_ITEMS: Array<{ step: MaintenanceWizardStep; label: string }> = [
  { step: 1, label: "Select project rig" },
  { step: 2, label: "Enter details" },
  { step: 3, label: "Save" }
];

export const MAINTENANCE_TYPE_OPTIONS: Array<{
  value: MaintenanceFormState["maintenanceType"];
  label: string;
}> = [
  { value: "ROUTINE_MAINTENANCE", label: "Routine Maintenance" },
  { value: "INSPECTION_CHECK", label: "Inspection / Check" },
  { value: "PREVENTIVE_SERVICE", label: "Preventive Service" },
  { value: "OTHER", label: "Other" }
];

export function validateMaintenanceStep(step: MaintenanceWizardStep, form: MaintenanceFormState) {
  if (step === 1 && !form.rigId) {
    return "Rig is required.";
  }
  if (step === 2) {
    if (!form.requestDate) {
      return "Date is required.";
    }
    if (!form.maintenanceType) {
      return "Maintenance type is required.";
    }
    if (!form.issueDescription.trim()) {
      return "Issue / work description is required.";
    }
  }
  return null;
}
