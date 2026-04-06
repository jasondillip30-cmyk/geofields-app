export type UserRole = "ADMIN" | "MANAGER" | "STAFF" | "OFFICE" | "MECHANIC" | "FIELD";

export type RigStatus = "ACTIVE" | "IDLE" | "MAINTENANCE" | "BREAKDOWN";
export type RigCondition = "EXCELLENT" | "GOOD" | "FAIR" | "POOR" | "CRITICAL";
export type ProjectStatus = "PLANNED" | "ACTIVE" | "ON_HOLD" | "COMPLETED";
export type MaintenanceStatus =
  | "OPEN"
  | "WAITING_FOR_PARTS"
  | "IN_REPAIR"
  | "COMPLETED";
export type UrgencyLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export interface Client {
  id: string;
  name: string;
  contactPerson: string;
  segment: string;
  activeProjects: number;
}

export interface Project {
  id: string;
  name: string;
  clientId: string;
  location: string;
  startDate: string;
  endDate: string | null;
  status: ProjectStatus;
  assignedRigId: string | null;
  backupRigId: string | null;
  contractRatePerMeter: number;
}

export interface Rig {
  id: string;
  rigCode: string;
  model: string;
  serialNumber: string;
  acquisitionDate: string;
  status: RigStatus;
  condition: RigCondition;
  conditionScore: number;
  totalHoursWorked: number;
  totalLifetimeDaysUsed: number;
}

export interface DrillReport {
  id: string;
  date: string;
  clientId: string;
  projectId: string;
  rigId: string;
  holeNumber: string;
  location: string;
  fromMeter: number;
  toMeter: number;
  totalMetersDrilled: number;
  workHours: number;
  rigMoves: number;
  standbyHours: number;
  delayHours: number;
  operatorCrew: string;
  billableActivityAmount: number;
  comments: string;
}

export interface RevenueEntry {
  id: string;
  date: string;
  clientId: string | null;
  projectId: string | null;
  rigId: string | null;
  amount: number;
  category: string;
}

export interface ExpenseEntry {
  id: string;
  date: string;
  clientId: string | null;
  projectId: string | null;
  rigId: string | null;
  category: string;
  amount: number;
  notes: string;
}

export interface Mechanic {
  id: string;
  name: string;
  specialization: string;
  phone: string;
  email: string;
  profileImage: string;
  currentAssignment: string;
  status: "AVAILABLE" | "ON_JOB" | "OFF_DUTY";
}

export interface MaintenanceRequest {
  id: string;
  date: string;
  rigId: string;
  clientId: string | null;
  projectId: string | null;
  mechanicId: string;
  issueDescription: string;
  materialsNeeded: string[];
  urgency: UrgencyLevel;
  photos: string[];
  notes: string;
  estimatedDowntimeHours: number;
  status: MaintenanceStatus;
  approvalNotes: string | null;
}

export interface ForecastPoint {
  day: string;
  revenueForecast: number;
  expenseForecast: number;
}
