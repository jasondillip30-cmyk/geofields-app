import type { DrillDelayReasonCategory } from "@/lib/drill-report-delay-reasons";

export interface ProjectOption {
  id: string;
  name: string;
  location: string;
  clientId: string;
  status: string;
  contractType?: "PER_METER" | "DAY_RATE" | "LUMP_SUM";
  contractRatePerM: number;
  billingRateItems?: ProjectBillingRateItemOption[];
  client: {
    id: string;
    name: string;
  };
  assignedRig: {
    id: string;
    rigCode: string;
  } | null;
  backupRig: {
    id: string;
    rigCode: string;
  } | null;
}

export interface ProjectBillingRateItemOption {
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

export interface RigOption {
  id: string;
  rigCode: string;
  status: string;
}

export interface DrillReportRecord {
  id: string;
  date: string;
  approvalStatus: "DRAFT" | "SUBMITTED" | "APPROVED" | "REJECTED";
  submittedAt: string | null;
  approvedAt: string | null;
  rejectionReason: string | null;
  holeNumber: string;
  areaLocation: string;
  fromMeter: number;
  toMeter: number;
  totalMetersDrilled: number;
  workHours: number;
  rigMoves: number;
  standbyHours: number;
  delayHours: number;
  delayReasonCategory: DrillDelayReasonCategory | null;
  delayReasonNote: string | null;
  holeContinuityOverrideReason: string | null;
  leadOperatorName: string | null;
  assistantCount: number;
  operatorCrew: string | null;
  billableAmount: number;
  comments: string | null;
  client: { id: string; name: string };
  project: { id: string; name: string; status: string };
  rig: { id: string; rigCode: string; status: string };
  submittedBy: { id: string; fullName: string } | null;
  approvedBy: { id: string; fullName: string } | null;
  billableLines: Array<{ itemCode: string; unit: string; quantity: number }>;
  inventoryMovements: Array<{
    id: string;
    date: string;
    quantity: number;
    totalCost: number;
    item: { id: string; name: string; sku: string } | null;
    expense: { id: string; amount: number; approvalStatus: string } | null;
  }>;
  inventoryUsageRequests: Array<{
    id: string;
    status: "SUBMITTED" | "PENDING" | "APPROVED" | "REJECTED";
    quantity: number;
    reason: string;
    approvedMovementId: string | null;
    createdAt: string;
    decidedAt: string | null;
    item: { id: string; name: string; sku: string } | null;
  }>;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectConsumablePoolItem {
  itemId: string;
  itemName: string;
  sku: string;
  stockOnHand: number;
  approvedRequestQty: number;
  approvedPurchaseQty: number;
  consumedQty: number;
  poolQty: number;
  availableNow: number;
  unitCost: number;
}

export interface StagedConsumableLine {
  itemId: string;
  itemName: string;
  sku: string;
  quantity: string;
}

export interface DrillStats {
  reportsLogged: number;
  totalMeters: number;
  billableActivity: number;
  averageWorkHours: number;
}

export interface HoleProgressSummary {
  holeNumber: string;
  currentDepth: number;
  lastReportDate: string;
}

export interface DrillReportFormState {
  date: string;
  projectId: string;
  rigId: string;
  holeMode: "CONTINUE" | "START_NEW";
  selectedHoleNumber: string;
  holeNumber: string;
  fromMeter: string;
  toMeter: string;
  metersDrilledToday: string;
  workHours: string;
  rigMoves: string;
  standbyHours: string;
  delayHours: string;
  delayReasonCategory: DrillDelayReasonCategory | "";
  delayReasonNote: string;
  holeContinuityOverrideReason: string;
  leadOperatorName: string;
  assistantCount: string;
  comments: string;
  billableQuantities: Record<string, string>;
}

export const RECENT_PROJECTS_STORAGE_KEY = "gf:drilling-recent-projects";
export const MAX_VISIBLE_PROJECT_TABS = 6;
export const MAX_RECENT_PROJECTS = 6;

export const emptyStats: DrillStats = {
  reportsLogged: 0,
  totalMeters: 0,
  billableActivity: 0,
  averageWorkHours: 0
};
