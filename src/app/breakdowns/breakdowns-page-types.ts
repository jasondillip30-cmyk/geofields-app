export interface ProjectOption {
  id: string;
  name: string;
  status: string;
  clientId: string;
  assignedRigId: string | null;
  backupRigId: string | null;
  client: {
    name: string;
  };
}

export interface RigOption {
  id: string;
  rigCode: string;
}

export interface BreakdownRecord {
  id: string;
  reportDate: string;
  title: string;
  description: string;
  severity: string;
  downtimeHours: number;
  status: string;
  client: {
    name: string;
  };
  project: {
    id: string;
    name: string;
    status: string;
  };
  rig: {
    id: string;
    rigCode: string;
    status: string;
  };
  reportedBy: {
    fullName: string;
    role: string;
  };
}

export interface BreakdownFormState {
  projectId: string;
  rigId: string;
  title: string;
  description: string;
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  downtimeHours: string;
}

export interface BreakdownLogFilterState {
  projectId: string;
  rigId: string;
  status: "all" | "OPEN" | "RESOLVED";
  from: string;
  to: string;
}

export interface LinkedMaintenanceRow {
  id: string;
  requestCode: string;
  requestDate: string;
  issueDescription: string;
  status: string;
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
}

export interface AuditRow {
  id: string;
  action: string;
  description: string;
  createdAt: string;
  actorName: string | null;
}

export interface RigBreakdownHistoryRow {
  rigId: string;
  resolvedRigId: string | null;
  rigCode: string;
  currentStatus: "OPEN" | "RESOLVED" | null;
  latestBreakdownDate: string;
  caseCount: number;
  cases: BreakdownRecord[];
}

export const INITIAL_FORM_STATE: BreakdownFormState = {
  projectId: "",
  rigId: "",
  title: "",
  description: "",
  severity: "MEDIUM",
  downtimeHours: ""
};

export const INITIAL_LOG_FILTER_STATE: BreakdownLogFilterState = {
  projectId: "",
  rigId: "",
  status: "all",
  from: "",
  to: ""
};
