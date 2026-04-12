export interface ClientOption {
  id: string;
  name: string;
}

export interface RigOption {
  id: string;
  rigCode: string;
}

export interface EmployeeOption {
  id: string;
  fullName: string;
  role: string;
  isActive: boolean;
}

export interface ProjectSetupProfile {
  expectedMeters: number | null;
  contractReferenceUrl: string;
  contractReferenceName: string;
  teamMemberIds: string[];
  teamMemberNames: string[];
}

export interface ProjectRecord {
  id: string;
  name: string;
  location: string;
  startDate: string;
  endDate: string | null;
  status: string;
  contractType?: ProjectContractTypeOption;
  contractRatePerM: number;
  contractDayRate?: number;
  contractLumpSumValue?: number;
  estimatedMeters?: number;
  estimatedDays?: number;
  clientId: string;
  assignedRigId: string | null;
  backupRigId: string | null;
  description: string | null;
  photoUrl: string | null;
  budgetAmount?: number | null;
  setupProfile?: Partial<ProjectSetupProfile> | null;
  billingRateItems?: ProjectBillingRateItemRecord[];
}

export interface ProjectBillingRateItemRecord {
  itemCode: string;
  label: string;
  unit: string;
  unitRate: number;
  drillingStageLabel?: string | null;
  depthBandStartM?: number | null;
  depthBandEndM?: number | null;
  sortOrder: number;
  isActive: boolean;
}

export interface ProjectBillingRateItemFormLine {
  itemCode: string;
  label: string;
  unit: string;
  unitRate: number;
  drillingStageLabel?: string | null;
  depthBandStartM?: number | null;
  depthBandEndM?: number | null;
  sortOrder: number;
  isActive: boolean;
}

export interface BillableItemTemplate {
  itemCode: string;
  label: string;
  unit: string;
  sortOrder: number;
  isMeterBased?: boolean;
  allowMultiple?: boolean;
}

export type ProjectSetupStep = 1 | 2 | 3 | 4 | 5 | 6;
export type ProjectStatusOption = "PLANNED" | "ACTIVE" | "COMPLETED";
export type ProjectContractTypeOption = "PER_METER" | "DAY_RATE" | "LUMP_SUM";
export type LocationLinkMode = "EXISTING" | "NEW";

export interface ProjectFormState {
  id: string;
  name: string;
  clientId: string;
  locationMode: LocationLinkMode;
  locationExisting: string;
  locationNew: string;
  startDate: string;
  endDate: string;
  contractType: ProjectContractTypeOption;
  contractRatePerM: string;
  contractDayRate: string;
  contractLumpSumValue: string;
  budgetAmount: string;
  estimatedMeters: string;
  estimatedDays: string;
  contractReferenceUrl: string;
  contractReferenceName: string;
  primaryRigId: string;
  secondaryRigId: string;
  teamMemberIds: string[];
  description: string;
  photoUrl: string;
}

export const STEP_LABELS: Array<{ step: ProjectSetupStep; title: string; subtitle: string }> = [
  { step: 1, title: "Client and Location", subtitle: "Define who and where this project belongs." },
  { step: 2, title: "Project Timing", subtitle: "Set project dates. Status updates automatically." },
  { step: 3, title: "Commercial Setup", subtitle: "Define how this project is billed." },
  { step: 4, title: "Rig Assignment", subtitle: "Assign primary rig and optional backup support." },
  { step: 5, title: "Team Assignment", subtitle: "Attach workers/employees to this project setup." },
  { step: 6, title: "Review and Create", subtitle: "Confirm setup details before saving." }
];

export const BILLABLE_ITEM_TEMPLATES: BillableItemTemplate[] = [
  {
    itemCode: "METER_DRILLED",
    label: "Drilled meters",
    unit: "meter",
    sortOrder: 10,
    isMeterBased: true,
    allowMultiple: true
  },
  { itemCode: "WORK_TIME", label: "Work time", unit: "hour", sortOrder: 20 },
  { itemCode: "WATER_PUMP_HOURS", label: "Water pump hours", unit: "hour", sortOrder: 30 },
  { itemCode: "RIG_MOVE", label: "Rig move", unit: "move", sortOrder: 40 },
  { itemCode: "STANDBY", label: "Standby", unit: "hour", sortOrder: 50 },
  { itemCode: "SURVEY", label: "Survey", unit: "each", sortOrder: 60 },
  { itemCode: "REFLEX", label: "Reflex", unit: "run", sortOrder: 70 },
  { itemCode: "SURVEY_SHOT", label: "Survey shot", unit: "shot", sortOrder: 80 },
  { itemCode: "SURVEY_ORI", label: "Survey ori", unit: "ori", sortOrder: 90 },
  { itemCode: "ONE_OFF_CHARGE", label: "One-off project charge", unit: "each", sortOrder: 100 }
];

export function createEmptyProjectForm(): ProjectFormState {
  return {
    id: "",
    name: "",
    clientId: "",
    locationMode: "EXISTING",
    locationExisting: "",
    locationNew: "",
    startDate: "",
    endDate: "",
    contractType: "PER_METER",
    contractRatePerM: "0",
    contractDayRate: "0",
    contractLumpSumValue: "0",
    budgetAmount: "",
    estimatedMeters: "",
    estimatedDays: "",
    contractReferenceUrl: "",
    contractReferenceName: "",
    primaryRigId: "",
    secondaryRigId: "",
    teamMemberIds: [],
    description: "",
    photoUrl: ""
  };
}
