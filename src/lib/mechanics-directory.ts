export type MechanicsAvailabilityStatus = "LIVE" | "PARTIAL" | "UNAVAILABLE";

export interface MechanicsDirectoryFilters {
  from: string | null;
  to: string | null;
  clientId: string;
  rigId: string;
}

export interface MechanicDirectoryRow {
  id: string;
  name: string;
  roleType: string;
  specialization: string | null;
  phone: string | null;
  email: string | null;
  currentAssignment: string | null;
  status: string;
  source: "MECHANIC_PROFILE" | "MECHANIC_PROFILE_WITH_USER_LINK";
  linkedUserId: string | null;
  linkedUserRole: string | null;
  activeMaintenanceWorkload: number;
  completedMaintenanceCount: number;
  rigsWorkedOn: string[];
  currentOpenRequests: number;
  urgentOpenItems: number;
  overdueOpenItems: number;
  inRepairCount: number;
  waitingForPartsCount: number;
  totalEstimatedDowntimeOpenHours: number;
  repairActivityHistoryIndicator: string;
  openRequestReferences: string[];
}

export interface MechanicsDirectorySummary {
  totalMechanics: number;
  activeRequests: number;
  completedRequests: number;
  urgentOpenItems: number;
  overdueOpenItems: number;
  rigsCovered: number;
  specializationsTracked: number;
  unresolvedDowntimeHours: number;
}

export interface MechanicsDirectoryAvailability {
  mechanicProfiles: MechanicsAvailabilityStatus;
  userRoleLinkage: MechanicsAvailabilityStatus;
  specialization: MechanicsAvailabilityStatus;
  maintenanceWorkload: MechanicsAvailabilityStatus;
  rigHistory: MechanicsAvailabilityStatus;
  downtimeActivity: MechanicsAvailabilityStatus;
  workshopRepairActivity: MechanicsAvailabilityStatus;
}

export interface MechanicsDirectoryPayload {
  filters: MechanicsDirectoryFilters;
  summary: MechanicsDirectorySummary;
  data: MechanicDirectoryRow[];
  availability: MechanicsDirectoryAvailability;
  notes: string[];
}
