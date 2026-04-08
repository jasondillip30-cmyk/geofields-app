import { hash } from "bcryptjs";
import {
  EntryApprovalStatus,
  InventoryCategory,
  InventoryItemStatus,
  InventoryMovementType,
  InventoryUsageRequestStatus,
  MaintenanceStatus,
  ProjectStatus,
  RigCondition,
  RigStatus,
  UrgencyLevel,
  UserRole,
  PrismaClient
} from "@prisma/client";

import type { PurchaseRequisitionPayload, RequisitionType } from "../src/lib/requisition-workflow";
import { PURCHASE_REQUISITION_REPORT_TYPE } from "../src/lib/requisition-workflow";
import type { PurchaseRequisitionSetupPayload } from "../src/lib/requisition-master-data";
import { PURCHASE_REQUISITION_SETUP_REPORT_TYPE } from "../src/lib/requisition-master-data";
import { calculateDrillReportBillableAmount } from "../src/lib/drill-report-billable-amount";
import { buildRecognizedSpendContext } from "../src/lib/recognized-spend-context";

const prisma = new PrismaClient();
const SEED_PROFILE_ID = "project_first_operational_v3_clean";

const DAY_MS = 24 * 60 * 60 * 1000;

const ROLE_SEEDS = [
  { id: "role-admin", name: UserRole.ADMIN, description: "Admin access" },
  { id: "role-manager", name: UserRole.MANAGER, description: "Manager access" },
  { id: "role-office", name: UserRole.OFFICE, description: "Office operations" },
  { id: "role-mechanic", name: UserRole.MECHANIC, description: "Mechanic operations" },
  { id: "role-field", name: UserRole.FIELD, description: "Field operations" },
  { id: "role-staff", name: UserRole.STAFF, description: "Staff access" }
] as const;

const USER_SEEDS = [
  {
    id: "usr-admin-001",
    fullName: "Admin User",
    email: "admin@geofields.co.tz",
    password: "Admin123!",
    role: UserRole.ADMIN,
    title: "Operations Admin",
    phone: "+255700100001",
    currentAssignment: "HQ"
  },
  {
    id: "usr-manager-001",
    fullName: "Manager User",
    email: "manager@geofields.co.tz",
    password: "Manager123!",
    role: UserRole.MANAGER,
    title: "Finance Manager",
    phone: "+255700100002",
    currentAssignment: "HQ"
  },
  {
    id: "usr-office-001",
    fullName: "Office User",
    email: "office@geofields.co.tz",
    password: "Office123!",
    role: UserRole.OFFICE,
    title: "Office Coordinator",
    phone: "+255700100003",
    currentAssignment: "HQ"
  },
  {
    id: "usr-mechanic-001",
    fullName: "Mechanic User",
    email: "mechanic@geofields.co.tz",
    password: "Mechanic123!",
    role: UserRole.MECHANIC,
    title: "Lead Mechanic",
    phone: "+255700100004",
    currentAssignment: "Workshop"
  },
  {
    id: "usr-field-001",
    fullName: "Field User",
    email: "field@geofields.co.tz",
    password: "Field123!",
    role: UserRole.FIELD,
    title: "Field Supervisor",
    phone: "+255700100005",
    currentAssignment: "Project Site"
  }
] as const;

const CLIENTS = [
  {
    id: "cli-northstar",
    name: "Northstar Mining",
    contactPerson: "Amina Mushi",
    email: "amina@northstar.example",
    phone: "+255700200101",
    address: "Mwanza, Tanzania",
    description: "Large-scale gold exploration client."
  },
  {
    id: "cli-rift",
    name: "Rift Minerals",
    contactPerson: "Joel Mtema",
    email: "joel@riftminerals.example",
    phone: "+255700200102",
    address: "Geita, Tanzania",
    description: "Underground and RC drilling operations."
  },
  {
    id: "cli-horizon",
    name: "Horizon Quarry",
    contactPerson: "Neema Kaza",
    email: "neema@horizonquarry.example",
    phone: "+255700200103",
    address: "Shinyanga, Tanzania",
    description: "Aggregate and quarry drilling services."
  }
] as const;

const RIGS = [
  {
    id: "rig-gf001",
    rigCode: "GF-RIG-001",
    model: "Sandvik DE710",
    serialNumber: "GF001-2020",
    status: RigStatus.ACTIVE,
    condition: RigCondition.GOOD,
    conditionScore: 83,
    totalHoursWorked: 4120,
    totalMetersDrilled: 198420,
    totalLifetimeDays: 1430,
    acquisitionDate: "2020-02-15"
  },
  {
    id: "rig-gf002",
    rigCode: "GF-RIG-002",
    model: "Epiroc D65",
    serialNumber: "GF002-2021",
    status: RigStatus.ACTIVE,
    condition: RigCondition.GOOD,
    conditionScore: 81,
    totalHoursWorked: 3650,
    totalMetersDrilled: 171880,
    totalLifetimeDays: 1180,
    acquisitionDate: "2021-01-10"
  },
  {
    id: "rig-gf003",
    rigCode: "GF-RIG-003",
    model: "Atlas Copco ROC L8",
    serialNumber: "GF003-2019",
    status: RigStatus.BREAKDOWN,
    condition: RigCondition.POOR,
    conditionScore: 56,
    totalHoursWorked: 4980,
    totalMetersDrilled: 224900,
    totalLifetimeDays: 1660,
    acquisitionDate: "2019-07-21"
  },
  {
    id: "rig-gf004",
    rigCode: "GF-RIG-004",
    model: "Epiroc SmartROC",
    serialNumber: "GF004-2022",
    status: RigStatus.MAINTENANCE,
    condition: RigCondition.FAIR,
    conditionScore: 68,
    totalHoursWorked: 2890,
    totalMetersDrilled: 129500,
    totalLifetimeDays: 860,
    acquisitionDate: "2022-04-18"
  },
  {
    id: "rig-gf005",
    rigCode: "GF-RIG-005",
    model: "Sandvik Pantera",
    serialNumber: "GF005-2023",
    status: RigStatus.ACTIVE,
    condition: RigCondition.GOOD,
    conditionScore: 79,
    totalHoursWorked: 2140,
    totalMetersDrilled: 93400,
    totalLifetimeDays: 610,
    acquisitionDate: "2023-05-05"
  },
  {
    id: "rig-gf006",
    rigCode: "GF-RIG-006",
    model: "Epiroc FlexiROC",
    serialNumber: "GF006-2024",
    status: RigStatus.IDLE,
    condition: RigCondition.EXCELLENT,
    conditionScore: 91,
    totalHoursWorked: 880,
    totalMetersDrilled: 40220,
    totalLifetimeDays: 330,
    acquisitionDate: "2024-03-03"
  }
] as const;

const PROJECTS = [
  {
    id: "prj-alpha",
    clientId: "cli-northstar",
    name: "Alpha Deep Core 2026",
    location: "North Mara Block A",
    description: "High-production drilling campaign with stable operating profile.",
    startDate: "2026-01-05",
    endDate: null,
    status: ProjectStatus.ACTIVE,
    contractRatePerM: 790,
    assignedRigId: "rig-gf001",
    backupRigId: "rig-gf006"
  },
  {
    id: "prj-bravo",
    clientId: "cli-northstar",
    name: "Bravo East Extension",
    location: "North Mara East",
    description: "Expansion campaign with rising operating pressure.",
    startDate: "2026-01-12",
    endDate: null,
    status: ProjectStatus.ACTIVE,
    contractRatePerM: 760,
    assignedRigId: "rig-gf002",
    backupRigId: "rig-gf006"
  },
  {
    id: "prj-charlie",
    clientId: "cli-rift",
    name: "Charlie Quarry RC",
    location: "Geita Ridge",
    description: "RC campaign currently operating without an approved budget plan.",
    startDate: "2026-02-02",
    endDate: null,
    status: ProjectStatus.ACTIVE,
    contractRatePerM: 710,
    assignedRigId: "rig-gf005",
    backupRigId: null
  },
  {
    id: "prj-delta",
    clientId: "cli-horizon",
    name: "Delta Waterline Drilling",
    location: "Shinyanga South",
    description: "Maintenance-heavy drilling near waterline structures.",
    startDate: "2026-01-20",
    endDate: null,
    status: ProjectStatus.ACTIVE,
    contractRatePerM: 735,
    assignedRigId: "rig-gf004",
    backupRigId: null
  },
  {
    id: "prj-echo",
    clientId: "cli-rift",
    name: "Echo Fault Recovery",
    location: "Geita Fault Zone",
    description: "Project currently blocked by active breakdown case.",
    startDate: "2026-01-18",
    endDate: null,
    status: ProjectStatus.ON_HOLD,
    contractRatePerM: 770,
    assignedRigId: "rig-gf003",
    backupRigId: "rig-gf006"
  },
  {
    id: "prj-foxtrot",
    clientId: "cli-horizon",
    name: "Foxtrot Legacy Closeout",
    location: "Shinyanga Legacy Pit",
    description: "Completed project retained for historical profitability comparison.",
    startDate: "2025-06-01",
    endDate: "2026-02-20",
    status: ProjectStatus.COMPLETED,
    contractRatePerM: 700,
    assignedRigId: null,
    backupRigId: null
  }
] as const;

const PROJECT_BILLING_RATE_ITEMS = [
  // Alpha
  {
    projectId: "prj-alpha",
    itemCode: "METER_DRILLED",
    label: "Meters drilled",
    unit: "meter",
    unitRate: 790,
    drillingStageLabel: null,
    depthBandStartM: null,
    depthBandEndM: null,
    sortOrder: 0,
    isActive: true
  },
  {
    projectId: "prj-alpha",
    itemCode: "RIG_MOVE",
    label: "Rig move",
    unit: "move",
    unitRate: 450,
    drillingStageLabel: null,
    depthBandStartM: null,
    depthBandEndM: null,
    sortOrder: 1,
    isActive: true
  },
  {
    projectId: "prj-alpha",
    itemCode: "STANDBY_HOURS",
    label: "Standby",
    unit: "hour",
    unitRate: 120,
    drillingStageLabel: null,
    depthBandStartM: null,
    depthBandEndM: null,
    sortOrder: 2,
    isActive: true
  },
  {
    projectId: "prj-alpha",
    itemCode: "SURVEY_SHOT",
    label: "Survey shot",
    unit: "count",
    unitRate: 95,
    drillingStageLabel: null,
    depthBandStartM: null,
    depthBandEndM: null,
    sortOrder: 3,
    isActive: true
  },
  {
    projectId: "prj-alpha",
    itemCode: "WATER_PUMP_HOURS",
    label: "Water pump hours",
    unit: "hour",
    unitRate: 140,
    drillingStageLabel: null,
    depthBandStartM: null,
    depthBandEndM: null,
    sortOrder: 4,
    isActive: true
  },

  // Bravo (staged meter lines)
  {
    projectId: "prj-bravo",
    itemCode: "PQ_0_100",
    label: "PQ 0-100m",
    unit: "meter",
    unitRate: 760,
    drillingStageLabel: "PQ",
    depthBandStartM: 0,
    depthBandEndM: 100,
    sortOrder: 0,
    isActive: true
  },
  {
    projectId: "prj-bravo",
    itemCode: "HQ_100_200",
    label: "HQ 100-200m",
    unit: "meter",
    unitRate: 810,
    drillingStageLabel: "HQ",
    depthBandStartM: 100,
    depthBandEndM: 200,
    sortOrder: 1,
    isActive: true
  },
  {
    projectId: "prj-bravo",
    itemCode: "NQ_200_320",
    label: "NQ 200-320m",
    unit: "meter",
    unitRate: 865,
    drillingStageLabel: "NQ",
    depthBandStartM: 200,
    depthBandEndM: 320,
    sortOrder: 2,
    isActive: true
  },
  {
    projectId: "prj-bravo",
    itemCode: "RIG_MOVE",
    label: "Rig move",
    unit: "move",
    unitRate: 420,
    drillingStageLabel: null,
    depthBandStartM: null,
    depthBandEndM: null,
    sortOrder: 3,
    isActive: true
  },
  {
    projectId: "prj-bravo",
    itemCode: "STANDBY_HOURS",
    label: "Standby",
    unit: "hour",
    unitRate: 110,
    drillingStageLabel: null,
    depthBandStartM: null,
    depthBandEndM: null,
    sortOrder: 4,
    isActive: true
  },

  // Charlie
  {
    projectId: "prj-charlie",
    itemCode: "METER_DRILLED",
    label: "Meters drilled",
    unit: "meter",
    unitRate: 710,
    drillingStageLabel: null,
    depthBandStartM: null,
    depthBandEndM: null,
    sortOrder: 0,
    isActive: true
  },
  {
    projectId: "prj-charlie",
    itemCode: "WORK_HOURS",
    label: "Work hours",
    unit: "hour",
    unitRate: 52,
    drillingStageLabel: null,
    depthBandStartM: null,
    depthBandEndM: null,
    sortOrder: 1,
    isActive: true
  },
  {
    projectId: "prj-charlie",
    itemCode: "SURVEY",
    label: "Survey",
    unit: "count",
    unitRate: 260,
    drillingStageLabel: null,
    depthBandStartM: null,
    depthBandEndM: null,
    sortOrder: 2,
    isActive: true
  },
  {
    projectId: "prj-charlie",
    itemCode: "REFLEX",
    label: "Reflex",
    unit: "count",
    unitRate: 190,
    drillingStageLabel: null,
    depthBandStartM: null,
    depthBandEndM: null,
    sortOrder: 3,
    isActive: true
  },
  {
    projectId: "prj-charlie",
    itemCode: "SURVEY_ORI",
    label: "Survey ori",
    unit: "count",
    unitRate: 210,
    drillingStageLabel: null,
    depthBandStartM: null,
    depthBandEndM: null,
    sortOrder: 4,
    isActive: true
  },

  // Delta
  {
    projectId: "prj-delta",
    itemCode: "METER_DRILLED",
    label: "Meters drilled",
    unit: "meter",
    unitRate: 735,
    drillingStageLabel: null,
    depthBandStartM: null,
    depthBandEndM: null,
    sortOrder: 0,
    isActive: true
  },
  {
    projectId: "prj-delta",
    itemCode: "WATER_PUMP_HOURS",
    label: "Water pump hours",
    unit: "hour",
    unitRate: 180,
    drillingStageLabel: null,
    depthBandStartM: null,
    depthBandEndM: null,
    sortOrder: 1,
    isActive: true
  },
  {
    projectId: "prj-delta",
    itemCode: "STANDBY_HOURS",
    label: "Standby",
    unit: "hour",
    unitRate: 100,
    drillingStageLabel: null,
    depthBandStartM: null,
    depthBandEndM: null,
    sortOrder: 2,
    isActive: true
  },
  {
    projectId: "prj-delta",
    itemCode: "RIG_MOVE",
    label: "Rig move",
    unit: "move",
    unitRate: 380,
    drillingStageLabel: null,
    depthBandStartM: null,
    depthBandEndM: null,
    sortOrder: 3,
    isActive: true
  },

  // Echo
  {
    projectId: "prj-echo",
    itemCode: "METER_DRILLED",
    label: "Meters drilled",
    unit: "meter",
    unitRate: 770,
    drillingStageLabel: null,
    depthBandStartM: null,
    depthBandEndM: null,
    sortOrder: 0,
    isActive: true
  },
  {
    projectId: "prj-echo",
    itemCode: "RIG_MOVE",
    label: "Rig move",
    unit: "move",
    unitRate: 390,
    drillingStageLabel: null,
    depthBandStartM: null,
    depthBandEndM: null,
    sortOrder: 1,
    isActive: true
  },
  {
    projectId: "prj-echo",
    itemCode: "STANDBY_HOURS",
    label: "Standby",
    unit: "hour",
    unitRate: 105,
    drillingStageLabel: null,
    depthBandStartM: null,
    depthBandEndM: null,
    sortOrder: 2,
    isActive: true
  },
  {
    projectId: "prj-echo",
    itemCode: "SURVEY_SHOT",
    label: "Survey shot",
    unit: "count",
    unitRate: 90,
    drillingStageLabel: null,
    depthBandStartM: null,
    depthBandEndM: null,
    sortOrder: 3,
    isActive: true
  },

  // Foxtrot
  {
    projectId: "prj-foxtrot",
    itemCode: "METER_DRILLED",
    label: "Meters drilled",
    unit: "meter",
    unitRate: 700,
    drillingStageLabel: null,
    depthBandStartM: null,
    depthBandEndM: null,
    sortOrder: 0,
    isActive: true
  },
  {
    projectId: "prj-foxtrot",
    itemCode: "RIG_MOVE",
    label: "Rig move",
    unit: "move",
    unitRate: 300,
    drillingStageLabel: null,
    depthBandStartM: null,
    depthBandEndM: null,
    sortOrder: 1,
    isActive: true
  }
] as const;

const RIG_USAGE = [
  {
    id: "usage-rig-alpha",
    rigId: "rig-gf001",
    projectId: "prj-alpha",
    clientId: "cli-northstar",
    startDate: "2026-01-05",
    endDate: null,
    usageDays: 88,
    usageHours: 1510
  },
  {
    id: "usage-rig-bravo",
    rigId: "rig-gf002",
    projectId: "prj-bravo",
    clientId: "cli-northstar",
    startDate: "2026-01-12",
    endDate: null,
    usageDays: 82,
    usageHours: 1422
  },
  {
    id: "usage-rig-charlie",
    rigId: "rig-gf005",
    projectId: "prj-charlie",
    clientId: "cli-rift",
    startDate: "2026-02-02",
    endDate: null,
    usageDays: 62,
    usageHours: 1138
  },
  {
    id: "usage-rig-delta",
    rigId: "rig-gf004",
    projectId: "prj-delta",
    clientId: "cli-horizon",
    startDate: "2026-01-20",
    endDate: null,
    usageDays: 74,
    usageHours: 1290
  },
  {
    id: "usage-rig-echo",
    rigId: "rig-gf003",
    projectId: "prj-echo",
    clientId: "cli-rift",
    startDate: "2026-01-18",
    endDate: null,
    usageDays: 40,
    usageHours: 700
  },
  {
    id: "usage-rig-foxtrot",
    rigId: "rig-gf006",
    projectId: "prj-foxtrot",
    clientId: "cli-horizon",
    startDate: "2025-10-01",
    endDate: "2026-02-20",
    usageDays: 142,
    usageHours: 1860
  }
] as const;

const MECHANICS = [
  {
    id: "mech-lead-001",
    fullName: "Elijah Mrema",
    specialization: "Hydraulic Systems",
    phone: "+255700300001",
    email: "elijah.mrema@geofields.co.tz",
    profileImageUrl: "/maintenance/mech-elijah.jpg",
    currentAssignment: "Central workshop",
    status: "AVAILABLE"
  },
  {
    id: "mech-field-001",
    fullName: "Sara Mganga",
    specialization: "Engine & drivetrain",
    phone: "+255700300002",
    email: "sara.mganga@geofields.co.tz",
    profileImageUrl: "/maintenance/mech-sara.jpg",
    currentAssignment: "Field support",
    status: "ASSIGNED"
  }
] as const;

const BREAKDOWNS = [
  {
    id: "bd-echo-open-001",
    reportDate: daysAgo(12),
    reportedById: "usr-field-001",
    rigId: "rig-gf003",
    projectId: "prj-echo",
    clientId: "cli-rift",
    title: "Top drive gearbox failure",
    description: "Top drive gearbox seized during active shift. Project blocked pending parts.",
    severity: UrgencyLevel.CRITICAL,
    downtimeHours: 52,
    status: "OPEN"
  },
  {
    id: "bd-alpha-resolved-001",
    reportDate: daysAgo(41),
    reportedById: "usr-field-001",
    rigId: "rig-gf001",
    projectId: "prj-alpha",
    clientId: "cli-northstar",
    title: "Hydraulic pressure collapse",
    description: "Hydraulic pressure dropped below operating threshold. Resolved after seal replacement.",
    severity: UrgencyLevel.HIGH,
    downtimeHours: 16,
    status: "RESOLVED"
  }
] as const;

const MAINTENANCE_REQUESTS = [
  {
    id: "mr-delta-open-001",
    requestCode: "MR-2026-2001",
    requestDate: daysAgo(10),
    rigId: "rig-gf004",
    clientId: "cli-horizon",
    projectId: "prj-delta",
    breakdownReportId: null,
    mechanicId: "mech-lead-001",
    maintenanceType: "Routine Maintenance",
    issueDescription: "Pump pressure fluctuating during regular operation.",
    materialsNeeded: "Seal kit, pressure valve",
    urgency: UrgencyLevel.HIGH,
    photoUrls: JSON.stringify([]),
    notes: "Open case for scheduled replacement.",
    estimatedDowntimeHrs: 14,
    status: MaintenanceStatus.OPEN
  },
  {
    id: "mr-echo-repair-001",
    requestCode: "MR-2026-2002",
    requestDate: daysAgo(11),
    rigId: "rig-gf003",
    clientId: "cli-rift",
    projectId: "prj-echo",
    breakdownReportId: "bd-echo-open-001",
    mechanicId: "mech-field-001",
    maintenanceType: "Breakdown Repair",
    issueDescription: "Gearbox disassembly and replacement underway.",
    materialsNeeded: "Gearbox assembly, heavy-duty coupling",
    urgency: UrgencyLevel.CRITICAL,
    photoUrls: JSON.stringify([]),
    notes: "Linked to open breakdown case.",
    estimatedDowntimeHrs: 36,
    status: MaintenanceStatus.IN_REPAIR
  },
  {
    id: "mr-bravo-wait-001",
    requestCode: "MR-2026-2003",
    requestDate: daysAgo(8),
    rigId: "rig-gf002",
    clientId: "cli-northstar",
    projectId: "prj-bravo",
    breakdownReportId: null,
    mechanicId: "mech-lead-001",
    maintenanceType: "Inspection / Check",
    issueDescription: "Feed motor instability detected during shift.",
    materialsNeeded: "Motor brushes, control relay",
    urgency: UrgencyLevel.MEDIUM,
    photoUrls: JSON.stringify([]),
    notes: "Waiting for replacement relays.",
    estimatedDowntimeHrs: 20,
    status: MaintenanceStatus.WAITING_FOR_PARTS
  },
  {
    id: "mr-alpha-complete-001",
    requestCode: "MR-2026-2004",
    requestDate: daysAgo(35),
    rigId: "rig-gf001",
    clientId: "cli-northstar",
    projectId: "prj-alpha",
    breakdownReportId: "bd-alpha-resolved-001",
    mechanicId: "mech-field-001",
    maintenanceType: "Breakdown Repair",
    issueDescription: "Hydraulic seals replaced and pressure stabilized.",
    materialsNeeded: "Hydraulic seal kit",
    urgency: UrgencyLevel.HIGH,
    photoUrls: JSON.stringify([]),
    notes: "Resolved linked breakdown.",
    estimatedDowntimeHrs: 9,
    status: MaintenanceStatus.COMPLETED
  },
  {
    id: "mr-charlie-complete-001",
    requestCode: "MR-2026-2005",
    requestDate: daysAgo(18),
    rigId: "rig-gf005",
    clientId: "cli-rift",
    projectId: "prj-charlie",
    breakdownReportId: null,
    mechanicId: "mech-lead-001",
    maintenanceType: "Preventive Service",
    issueDescription: "Quarterly preventive maintenance executed.",
    materialsNeeded: "Filters and lubrication set",
    urgency: UrgencyLevel.LOW,
    photoUrls: JSON.stringify([]),
    notes: "Completed preventive activity.",
    estimatedDowntimeHrs: 6,
    status: MaintenanceStatus.COMPLETED
  }
] as const;

const MAINTENANCE_UPDATES = [
  {
    id: "mu-echo-001",
    maintenanceId: "mr-echo-repair-001",
    actorUserId: "usr-mechanic-001",
    previousStatus: MaintenanceStatus.OPEN,
    newStatus: MaintenanceStatus.IN_REPAIR,
    updateNote: "Gearbox removed; replacement unit requested.",
    createdAt: addHours(daysAgo(11), 6)
  },
  {
    id: "mu-delta-001",
    maintenanceId: "mr-delta-open-001",
    actorUserId: "usr-mechanic-001",
    previousStatus: MaintenanceStatus.OPEN,
    newStatus: MaintenanceStatus.OPEN,
    updateNote: "Awaiting maintenance window and seal kit pickup.",
    createdAt: addHours(daysAgo(9), 7)
  },
  {
    id: "mu-alpha-001",
    maintenanceId: "mr-alpha-complete-001",
    actorUserId: "usr-mechanic-001",
    previousStatus: MaintenanceStatus.IN_REPAIR,
    newStatus: MaintenanceStatus.COMPLETED,
    updateNote: "Pressure tests passed; rig returned to production.",
    createdAt: addHours(daysAgo(33), 5)
  }
] as const;

const INVENTORY_SUPPLIERS = [
  {
    id: "sup-boremax",
    name: "BoreMax Supplies",
    contactPerson: "Samuel Kweka",
    email: "orders@boremax.example",
    phone: "+255700400101",
    notes: "type: industrial | location: Mwanza"
  },
  {
    id: "sup-hydroflow",
    name: "HydroFlow Engineering",
    contactPerson: "Leila Chuwa",
    email: "sales@hydroflow.example",
    phone: "+255700400102",
    notes: "type: hydraulic"
  },
  {
    id: "sup-petrotz",
    name: "PetroTZ",
    contactPerson: "Mussa Nnko",
    email: "supply@petrotz.example",
    phone: "+255700400103",
    notes: "type: fuel-filter"
  }
] as const;

const INVENTORY_LOCATIONS = [
  {
    id: "loc-main-wh",
    name: "Main Warehouse",
    description: "Central warehouse"
  },
  {
    id: "loc-field-store",
    name: "Field Store",
    description: "On-site storage"
  },
  {
    id: "loc-mobile-workshop",
    name: "Mobile Workshop",
    description: "Workshop truck storage"
  }
] as const;

const INVENTORY_ITEMS = [
  {
    id: "inv-item-hose",
    name: "Hydraulic Hose 2in",
    sku: "GF-HOSE-2IN",
    category: InventoryCategory.HYDRAULIC,
    description: "High pressure hose",
    quantityInStock: 18,
    minimumStockLevel: 12,
    unitCost: 5500,
    supplierId: "sup-hydroflow",
    locationId: "loc-main-wh",
    compatibleRigId: "rig-gf003",
    compatibleRigType: "RC",
    partNumber: "H2-990",
    status: InventoryItemStatus.ACTIVE,
    notes: "Used in breakdown repairs."
  },
  {
    id: "inv-item-seal-kit",
    name: "Maintenance Seal Kit",
    sku: "GF-SEAL-KIT",
    category: InventoryCategory.SPARE_PARTS,
    description: "Seal kit for pump and valve maintenance",
    quantityInStock: 7,
    minimumStockLevel: 10,
    unitCost: 4200,
    supplierId: "sup-hydroflow",
    locationId: "loc-field-store",
    compatibleRigId: "rig-gf004",
    compatibleRigType: "DTH",
    partNumber: "SK-440",
    status: InventoryItemStatus.ACTIVE,
    notes: "Low stock watch item."
  },
  {
    id: "inv-item-rc-bit",
    name: "RC Drill Bit 5.5in",
    sku: "GF-RCB-55",
    category: InventoryCategory.CONSUMABLES,
    description: "RC drilling bit",
    quantityInStock: 42,
    minimumStockLevel: 20,
    unitCost: 200,
    supplierId: "sup-boremax",
    locationId: "loc-main-wh",
    compatibleRigId: "rig-gf005",
    compatibleRigType: "RC",
    partNumber: "RCB-55-2026",
    status: InventoryItemStatus.ACTIVE,
    notes: "High-volume consumable."
  },
  {
    id: "inv-item-filter",
    name: "Fuel Filter Pack",
    sku: "GF-FLT-12",
    category: InventoryCategory.FILTERS,
    description: "Bulk fuel filters",
    quantityInStock: 0,
    minimumStockLevel: 40,
    unitCost: 64,
    supplierId: "sup-petrotz",
    locationId: "loc-main-wh",
    compatibleRigId: null,
    compatibleRigType: "All",
    partNumber: "FLT-12",
    status: InventoryItemStatus.ACTIVE,
    notes: "Out of stock to test replenishment path."
  }
] as const;

const DRILL_REPORTS = [
  // Alpha (profitable, under budget)
  buildDrillReport("dr-alpha-001", 36, "prj-alpha", "cli-northstar", "rig-gf001", 112, "APPROVED"),
  buildDrillReport("dr-alpha-002", 22, "prj-alpha", "cli-northstar", "rig-gf001", 103, "APPROVED"),
  buildDrillReport("dr-alpha-003", 9, "prj-alpha", "cli-northstar", "rig-gf001", 97, "APPROVED"),
  // Bravo (overspent)
  buildDrillReport("dr-bravo-001", 35, "prj-bravo", "cli-northstar", "rig-gf002", 61, "APPROVED"),
  buildDrillReport("dr-bravo-002", 18, "prj-bravo", "cli-northstar", "rig-gf002", 51, "APPROVED"),
  buildDrillReport("dr-bravo-003", 7, "prj-bravo", "cli-northstar", "rig-gf002", 42, "APPROVED"),
  // Charlie (no budget)
  buildDrillReport("dr-charlie-001", 24, "prj-charlie", "cli-rift", "rig-gf005", 58, "APPROVED"),
  buildDrillReport("dr-charlie-002", 12, "prj-charlie", "cli-rift", "rig-gf005", 50, "APPROVED"),
  // Delta (maintenance-heavy)
  buildDrillReport("dr-delta-001", 28, "prj-delta", "cli-horizon", "rig-gf004", 95, "APPROVED"),
  buildDrillReport("dr-delta-002", 16, "prj-delta", "cli-horizon", "rig-gf004", 89, "APPROVED"),
  buildDrillReport("dr-delta-003", 6, "prj-delta", "cli-horizon", "rig-gf004", 84, "APPROVED"),
  // Echo (breakdown-heavy)
  buildDrillReport("dr-echo-001", 27, "prj-echo", "cli-rift", "rig-gf003", 40, "APPROVED"),
  buildDrillReport("dr-echo-002", 20, "prj-echo", "cli-rift", "rig-gf003", 40, "APPROVED"),
  // Foxtrot completed
  buildDrillReport("dr-foxtrot-001", 45, "prj-foxtrot", "cli-horizon", "rig-gf006", 53, "APPROVED"),
  // Pending and draft coverage
  buildDrillReport("dr-echo-submitted", 5, "prj-echo", "cli-rift", "rig-gf003", 40, "SUBMITTED"),
  buildDrillReport("dr-charlie-draft", 3, "prj-charlie", "cli-rift", "rig-gf005", 40, "DRAFT")
] as const;

const EXPENSES = [
  // Alpha (operating + resolved breakdown-linked)
  buildExpense("exp-alpha-fuel", 30, 22_000, "Fuel", "Diesel", "prj-alpha", "cli-northstar", "rig-gf001", "APPROVED"),
  buildExpense("exp-alpha-logistics", 19, 12_000, "Transport", "Logistics", "prj-alpha", "cli-northstar", "rig-gf001", "APPROVED"),
  buildExpense("exp-alpha-project-purchase", 8, 18_000, "Materials", "Drilling Supplies", "prj-alpha", "cli-northstar", "rig-gf001", "APPROVED"),
  buildExpense("exp-alpha-breakdown-resolved", 34, 14_000, "Maintenance", "Repair Work", "prj-alpha", "cli-northstar", "rig-gf001", "APPROVED"),

  // Bravo (overspent + waiting-for-parts maintenance)
  buildExpense("exp-bravo-fuel", 29, 36_000, "Fuel", "Diesel", "prj-bravo", "cli-northstar", "rig-gf002", "APPROVED"),
  buildExpense("exp-bravo-travel", 15, 21_000, "Travel", "Crew transport", "prj-bravo", "cli-northstar", "rig-gf002", "APPROVED"),
  buildExpense("exp-bravo-maint-wait", 9, 43_000, "Maintenance", "Waiting parts", "prj-bravo", "cli-northstar", "rig-gf002", "APPROVED"),
  buildExpense("exp-bravo-services", 4, 12_000, "Services", "Rig diagnostics", "prj-bravo", "cli-northstar", "rig-gf002", "APPROVED"),

  // Charlie (no budget)
  buildExpense("exp-charlie-fuel", 20, 26_000, "Fuel", "Diesel", "prj-charlie", "cli-rift", "rig-gf005", "APPROVED"),
  buildExpense("exp-charlie-oper", 11, 28_000, "Services", "Contractor support", "prj-charlie", "cli-rift", "rig-gf005", "APPROVED"),
  buildExpense("exp-charlie-project-purchase", 6, 16_000, "Materials", "Site piping", "prj-charlie", "cli-rift", "rig-gf005", "APPROVED"),

  // Delta (maintenance-heavy)
  buildExpense("exp-delta-maint-usage", 10, 42_000, "Maintenance", "Seal kits", "prj-delta", "cli-horizon", "rig-gf004", "APPROVED"),
  buildExpense("exp-delta-maint-purchase", 9, 28_000, "Maintenance", "Pump module", "prj-delta", "cli-horizon", "rig-gf004", "APPROVED"),
  buildExpense("exp-delta-fuel", 14, 16_000, "Fuel", "Generator fuel", "prj-delta", "cli-horizon", "rig-gf004", "APPROVED"),
  buildExpense("exp-delta-consumables", 8, 12_000, "Spare Parts", "Consumables", "prj-delta", "cli-horizon", "rig-gf004", "APPROVED"),

  // Echo (breakdown-heavy)
  buildExpense("exp-echo-break-usage", 11, 55_000, "Maintenance", "Breakdown repair", "prj-echo", "cli-rift", "rig-gf003", "APPROVED"),
  buildExpense("exp-echo-break-purchase", 10, 34_000, "Materials", "Gearbox assembly", "prj-echo", "cli-rift", "rig-gf003", "APPROVED"),
  buildExpense("exp-echo-oper", 7, 9_000, "Services", "Temporary support", "prj-echo", "cli-rift", "rig-gf003", "APPROVED"),

  // Foxtrot
  buildExpense("exp-foxtrot-closeout", 44, 18_000, "Services", "Closeout logistics", "prj-foxtrot", "cli-horizon", "rig-gf006", "APPROVED"),

  // Stock replenishment
  buildExpense("exp-stock-001", 13, 34_000, "Stock", "Warehouse replenishment", null, null, null, "APPROVED"),
  buildExpense("exp-stock-002", 5, 16_000, "Stock", "Filter replenishment", null, null, null, "APPROVED"),

  // Intentional unlinked data-quality case
  buildExpense("exp-unlinked-001", 6, 9_000, "Miscellaneous", "Intentional unlinked QA case", null, null, null, "APPROVED"),

  // Pending approvals coverage
  buildExpense("exp-submitted-001", 2, 7_500, "Materials", "Pending office approval", "prj-charlie", "cli-rift", "rig-gf005", "SUBMITTED"),
  buildExpense("exp-draft-001", 1, 4_800, "Travel", "Draft claim", "prj-bravo", "cli-northstar", "rig-gf002", "DRAFT")
] as const;

const INVENTORY_MOVEMENTS = [
  {
    id: "mov-stock-in-001",
    itemId: "inv-item-rc-bit",
    movementType: InventoryMovementType.IN,
    quantity: 170,
    unitCost: 200,
    totalCost: 34_000,
    date: addHours(daysAgo(13), 8),
    performedByUserId: "usr-office-001",
    clientId: null,
    rigId: null,
    projectId: null,
    maintenanceRequestId: null,
    expenseId: "exp-stock-001",
    supplierId: "sup-boremax",
    locationFromId: null,
    locationToId: "loc-main-wh",
    traReceiptNumber: "TRA-STOCK-34000",
    supplierInvoiceNumber: "INV-STOCK-34000",
    receiptUrl: "/uploads/inventory-receipts/stock-34000.jpg",
    receiptFileName: "stock-34000.jpg",
    notes: "Stock replenishment for RC consumables."
  },
  {
    id: "mov-stock-in-002",
    itemId: "inv-item-filter",
    movementType: InventoryMovementType.IN,
    quantity: 250,
    unitCost: 64,
    totalCost: 16_000,
    date: addHours(daysAgo(5), 9),
    performedByUserId: "usr-office-001",
    clientId: null,
    rigId: null,
    projectId: null,
    maintenanceRequestId: null,
    expenseId: "exp-stock-002",
    supplierId: "sup-petrotz",
    locationFromId: null,
    locationToId: "loc-main-wh",
    traReceiptNumber: "TRA-STOCK-16000",
    supplierInvoiceNumber: "INV-STOCK-16000",
    receiptUrl: "/uploads/inventory-receipts/stock-16000.jpg",
    receiptFileName: "stock-16000.jpg",
    notes: "Filter replenishment."
  },
  {
    id: "mov-echo-break-out-001",
    itemId: "inv-item-hose",
    movementType: InventoryMovementType.OUT,
    quantity: 10,
    unitCost: 5_500,
    totalCost: 55_000,
    date: addHours(daysAgo(11), 11),
    performedByUserId: "usr-mechanic-001",
    clientId: "cli-rift",
    rigId: "rig-gf003",
    projectId: "prj-echo",
    maintenanceRequestId: "mr-echo-repair-001",
    expenseId: "exp-echo-break-usage",
    supplierId: null,
    locationFromId: "loc-main-wh",
    locationToId: null,
    traReceiptNumber: null,
    supplierInvoiceNumber: null,
    receiptUrl: null,
    receiptFileName: null,
    notes: "Breakdown repair hose issue."
  },
  {
    id: "mov-delta-maint-out-001",
    itemId: "inv-item-seal-kit",
    movementType: InventoryMovementType.OUT,
    quantity: 10,
    unitCost: 4_200,
    totalCost: 42_000,
    date: addHours(daysAgo(10), 13),
    performedByUserId: "usr-mechanic-001",
    clientId: "cli-horizon",
    rigId: "rig-gf004",
    projectId: "prj-delta",
    maintenanceRequestId: "mr-delta-open-001",
    expenseId: "exp-delta-maint-usage",
    supplierId: null,
    locationFromId: "loc-field-store",
    locationToId: null,
    traReceiptNumber: null,
    supplierInvoiceNumber: null,
    receiptUrl: null,
    receiptFileName: null,
    notes: "Maintenance usage for pump stabilization."
  },
  {
    id: "mov-bravo-maint-out-001",
    itemId: "inv-item-filter",
    movementType: InventoryMovementType.OUT,
    quantity: 670,
    unitCost: 64,
    totalCost: 42_880,
    date: addHours(daysAgo(9), 14),
    performedByUserId: "usr-mechanic-001",
    clientId: "cli-northstar",
    rigId: "rig-gf002",
    projectId: "prj-bravo",
    maintenanceRequestId: "mr-bravo-wait-001",
    expenseId: "exp-bravo-maint-wait",
    supplierId: null,
    locationFromId: "loc-main-wh",
    locationToId: null,
    traReceiptNumber: null,
    supplierInvoiceNumber: null,
    receiptUrl: null,
    receiptFileName: null,
    notes: "Partial parts release while awaiting full set."
  },
  {
    id: "mov-alpha-break-out-001",
    itemId: "inv-item-seal-kit",
    movementType: InventoryMovementType.OUT,
    quantity: 3,
    unitCost: 4_666.67,
    totalCost: 14_000,
    date: addHours(daysAgo(34), 12),
    performedByUserId: "usr-mechanic-001",
    clientId: "cli-northstar",
    rigId: "rig-gf001",
    projectId: "prj-alpha",
    maintenanceRequestId: "mr-alpha-complete-001",
    expenseId: "exp-alpha-breakdown-resolved",
    supplierId: null,
    locationFromId: "loc-field-store",
    locationToId: null,
    traReceiptNumber: null,
    supplierInvoiceNumber: null,
    receiptUrl: null,
    receiptFileName: null,
    notes: "Resolved breakdown repair usage."
  }
] as const;

const INVENTORY_USAGE_REQUESTS = [
  {
    id: "iur-breakdown-approved-001",
    itemId: "inv-item-hose",
    quantity: 10,
    reason: "BREAKDOWN",
    projectId: "prj-echo",
    rigId: "rig-gf003",
    maintenanceRequestId: null,
    breakdownReportId: "bd-echo-open-001",
    locationId: "loc-main-wh",
    requestedForDate: daysAgo(11),
    requestedById: "usr-field-001",
    status: InventoryUsageRequestStatus.APPROVED,
    decisionNote: "Approved for critical breakdown response.",
    decidedById: "usr-manager-001",
    decidedAt: addHours(daysAgo(11), 2),
    approvedMovementId: "mov-echo-break-out-001"
  },
  {
    id: "iur-maint-approved-001",
    itemId: "inv-item-seal-kit",
    quantity: 10,
    reason: "MAINTENANCE",
    projectId: "prj-delta",
    rigId: "rig-gf004",
    maintenanceRequestId: "mr-delta-open-001",
    breakdownReportId: null,
    locationId: "loc-field-store",
    requestedForDate: daysAgo(10),
    requestedById: "usr-mechanic-001",
    status: InventoryUsageRequestStatus.APPROVED,
    decisionNote: "Approved for active maintenance case.",
    decidedById: "usr-manager-001",
    decidedAt: addHours(daysAgo(10), 1),
    approvedMovementId: "mov-delta-maint-out-001"
  },
  {
    id: "iur-maint-submitted-001",
    itemId: "inv-item-filter",
    quantity: 40,
    reason: "MAINTENANCE",
    projectId: "prj-bravo",
    rigId: "rig-gf002",
    maintenanceRequestId: "mr-bravo-wait-001",
    breakdownReportId: null,
    locationId: "loc-main-wh",
    requestedForDate: daysAgo(2),
    requestedById: "usr-mechanic-001",
    status: InventoryUsageRequestStatus.SUBMITTED,
    decisionNote: null,
    decidedById: null,
    decidedAt: null,
    approvedMovementId: null
  }
] as const;

const BUDGET_PLANS = [
  {
    id: "budget-alpha-2026",
    scopeType: "PROJECT" as const,
    name: "Alpha 2026 Project Budget",
    amount: 160_000,
    currency: "USD",
    periodStart: "2026-01-01",
    periodEnd: "2026-12-31",
    isActive: true,
    notes: "Planned full-year budget for Alpha.",
    clientId: "cli-northstar",
    projectId: "prj-alpha",
    rigId: null,
    createdById: "usr-manager-001",
    updatedById: "usr-manager-001"
  },
  {
    id: "budget-bravo-2026",
    scopeType: "PROJECT" as const,
    name: "Bravo 2026 Project Budget",
    amount: 90_000,
    currency: "USD",
    periodStart: "2026-01-01",
    periodEnd: "2026-12-31",
    isActive: true,
    notes: "Tight budget with expected margin pressure.",
    clientId: "cli-northstar",
    projectId: "prj-bravo",
    rigId: null,
    createdById: "usr-manager-001",
    updatedById: "usr-manager-001"
  },
  {
    id: "budget-delta-2026",
    scopeType: "PROJECT" as const,
    name: "Delta 2026 Project Budget",
    amount: 130_000,
    currency: "USD",
    periodStart: "2026-01-01",
    periodEnd: "2026-12-31",
    isActive: true,
    notes: "Maintenance-heavy project budget.",
    clientId: "cli-horizon",
    projectId: "prj-delta",
    rigId: null,
    createdById: "usr-manager-001",
    updatedById: "usr-manager-001"
  },
  {
    id: "budget-echo-2026",
    scopeType: "PROJECT" as const,
    name: "Echo 2026 Project Budget",
    amount: 120_000,
    currency: "USD",
    periodStart: "2026-01-01",
    periodEnd: "2026-12-31",
    isActive: true,
    notes: "Breakdown-sensitive project budget.",
    clientId: "cli-rift",
    projectId: "prj-echo",
    rigId: null,
    createdById: "usr-manager-001",
    updatedById: "usr-manager-001"
  },
  {
    id: "budget-foxtrot-2026",
    scopeType: "PROJECT" as const,
    name: "Foxtrot Closeout Budget",
    amount: 50_000,
    currency: "USD",
    periodStart: "2025-06-01",
    periodEnd: "2026-12-31",
    isActive: true,
    notes: "Historical closeout budget.",
    clientId: "cli-horizon",
    projectId: "prj-foxtrot",
    rigId: null,
    createdById: "usr-manager-001",
    updatedById: "usr-manager-001"
  }
] as const;

const REQUISITION_SETUP_PAYLOAD: PurchaseRequisitionSetupPayload = {
  schemaVersion: 1,
  categories: [
    {
      id: "cat-materials",
      name: "Materials",
      isActive: true,
      createdAt: iso(daysAgo(90)),
      createdByUserId: "usr-manager-001",
      source: "setup_seed"
    },
    {
      id: "cat-services",
      name: "Services",
      isActive: true,
      createdAt: iso(daysAgo(90)),
      createdByUserId: "usr-manager-001",
      source: "setup_seed"
    },
    {
      id: "cat-maintenance",
      name: "Maintenance",
      isActive: true,
      createdAt: iso(daysAgo(90)),
      createdByUserId: "usr-manager-001",
      source: "setup_seed"
    },
    {
      id: "cat-stock",
      name: "Stock",
      isActive: true,
      createdAt: iso(daysAgo(90)),
      createdByUserId: "usr-manager-001",
      source: "setup_seed"
    }
  ],
  subcategories: [
    {
      id: "sub-drilling-supplies",
      name: "Drilling Supplies",
      categoryId: "cat-materials",
      isActive: true,
      createdAt: iso(daysAgo(90)),
      createdByUserId: "usr-manager-001",
      source: "setup_seed"
    },
    {
      id: "sub-breakdown-repair",
      name: "Breakdown Repair",
      categoryId: "cat-maintenance",
      isActive: true,
      createdAt: iso(daysAgo(90)),
      createdByUserId: "usr-manager-001",
      source: "setup_seed"
    },
    {
      id: "sub-stock-replenishment",
      name: "Warehouse Replenishment",
      categoryId: "cat-stock",
      isActive: true,
      createdAt: iso(daysAgo(90)),
      createdByUserId: "usr-manager-001",
      source: "setup_seed"
    }
  ]
};

const PURCHASE_REQUISITIONS: Array<{
  id: string;
  reportDate: Date;
  projectId: string | null;
  clientId: string | null;
  payload: PurchaseRequisitionPayload;
}> = [
  buildRequisition({
    id: "sum-req-alpha-approved",
    daysAgo: 8,
    requisitionCode: "REQ-20260401-A001",
    type: "LIVE_PROJECT_PURCHASE",
    status: "APPROVED",
    liveProjectSpendType: "NORMAL_EXPENSE",
    category: "Materials",
    subcategory: "Drilling Supplies",
    categoryId: "cat-materials",
    subcategoryId: "sub-drilling-supplies",
    requestedVendorId: "sup-boremax",
    requestedVendorName: "BoreMax Supplies",
    notes: "Project-linked operating purchase.",
    submittedByUserId: "usr-office-001",
    context: {
      clientId: "cli-northstar",
      projectId: "prj-alpha",
      rigId: "rig-gf001",
      maintenanceRequestId: null,
      breakdownReportId: null
    },
    lineItems: [
      lineItem("line-alpha-1", "Drill collars", 6, 3000, "Operating campaign supplies")
    ],
    approvedTotalCost: 18_000,
    actualPostedCost: 18_000,
    expenseId: "exp-alpha-project-purchase",
    movementCount: 0,
    postedAt: iso(addHours(daysAgo(8), 6)),
    reportProjectId: "prj-alpha",
    reportClientId: "cli-northstar"
  }),
  buildRequisition({
    id: "sum-req-echo-break-approved",
    daysAgo: 10,
    requisitionCode: "REQ-20260330-E001",
    type: "LIVE_PROJECT_PURCHASE",
    status: "APPROVED",
    liveProjectSpendType: "BREAKDOWN",
    category: "Maintenance",
    subcategory: "Breakdown Repair",
    categoryId: "cat-maintenance",
    subcategoryId: "sub-breakdown-repair",
    requestedVendorId: "sup-hydroflow",
    requestedVendorName: "HydroFlow Engineering",
    notes: "Breakdown-linked purchase initiated from breakdown case.",
    submittedByUserId: "usr-office-001",
    context: {
      clientId: "cli-rift",
      projectId: "prj-echo",
      rigId: "rig-gf003",
      maintenanceRequestId: "mr-echo-repair-001",
      breakdownReportId: "bd-echo-open-001"
    },
    lineItems: [
      lineItem("line-echo-1", "Gearbox assembly", 1, 34_000, "Critical replacement")
    ],
    approvedTotalCost: 34_000,
    actualPostedCost: 34_000,
    expenseId: "exp-echo-break-purchase",
    movementCount: 0,
    postedAt: iso(addHours(daysAgo(10), 4)),
    reportProjectId: "prj-echo",
    reportClientId: "cli-rift"
  }),
  buildRequisition({
    id: "sum-req-delta-maint-approved",
    daysAgo: 9,
    requisitionCode: "REQ-20260331-D001",
    type: "MAINTENANCE_PURCHASE",
    status: "APPROVED",
    liveProjectSpendType: null,
    category: "Maintenance",
    subcategory: "Pump module",
    categoryId: "cat-maintenance",
    subcategoryId: null,
    requestedVendorId: "sup-hydroflow",
    requestedVendorName: "HydroFlow Engineering",
    notes: "Maintenance-case purchase.",
    submittedByUserId: "usr-office-001",
    context: {
      clientId: "cli-horizon",
      projectId: "prj-delta",
      rigId: "rig-gf004",
      maintenanceRequestId: "mr-delta-open-001",
      breakdownReportId: null
    },
    lineItems: [
      lineItem("line-delta-1", "Pump module", 1, 28_000, "Required for maintenance completion")
    ],
    approvedTotalCost: 28_000,
    actualPostedCost: 28_000,
    expenseId: "exp-delta-maint-purchase",
    movementCount: 0,
    postedAt: iso(addHours(daysAgo(9), 5)),
    reportProjectId: "prj-delta",
    reportClientId: "cli-horizon"
  }),
  buildRequisition({
    id: "sum-req-stock-approved",
    daysAgo: 13,
    requisitionCode: "REQ-20260327-S001",
    type: "INVENTORY_STOCK_UP",
    status: "APPROVED",
    liveProjectSpendType: null,
    category: "Stock",
    subcategory: "Warehouse Replenishment",
    categoryId: "cat-stock",
    subcategoryId: "sub-stock-replenishment",
    requestedVendorId: "sup-boremax",
    requestedVendorName: "BoreMax Supplies",
    notes: "Warehouse stock-up purchase.",
    submittedByUserId: "usr-office-001",
    context: {
      clientId: null,
      projectId: null,
      rigId: null,
      maintenanceRequestId: null,
      breakdownReportId: null
    },
    lineItems: [
      lineItem("line-stock-1", "RC drill bits", 170, 200, "Stock replenishment")
    ],
    approvedTotalCost: 34_000,
    actualPostedCost: 34_000,
    expenseId: "exp-stock-001",
    movementCount: 1,
    postedAt: iso(addHours(daysAgo(13), 3)),
    reportProjectId: null,
    reportClientId: null
  }),
  buildRequisition({
    id: "sum-req-charlie-approved",
    daysAgo: 6,
    requisitionCode: "REQ-20260402-C001",
    type: "LIVE_PROJECT_PURCHASE",
    status: "APPROVED",
    liveProjectSpendType: "NORMAL_EXPENSE",
    category: "Materials",
    subcategory: "Site piping",
    categoryId: "cat-materials",
    subcategoryId: null,
    requestedVendorId: "sup-boremax",
    requestedVendorName: "BoreMax Supplies",
    notes: "Project purchase for Charlie operating work.",
    submittedByUserId: "usr-office-001",
    context: {
      clientId: "cli-rift",
      projectId: "prj-charlie",
      rigId: "rig-gf005",
      maintenanceRequestId: null,
      breakdownReportId: null
    },
    lineItems: [
      lineItem("line-charlie-1", "Pipe set", 8, 2000, "Operating installation")
    ],
    approvedTotalCost: 16_000,
    actualPostedCost: 16_000,
    expenseId: "exp-charlie-project-purchase",
    movementCount: 0,
    postedAt: iso(addHours(daysAgo(6), 4)),
    reportProjectId: "prj-charlie",
    reportClientId: "cli-rift"
  }),
  buildRequisition({
    id: "sum-req-alpha-breakdown-approved",
    daysAgo: 34,
    requisitionCode: "REQ-20260306-A002",
    type: "LIVE_PROJECT_PURCHASE",
    status: "APPROVED",
    liveProjectSpendType: "BREAKDOWN",
    category: "Maintenance",
    subcategory: "Breakdown Repair",
    categoryId: "cat-maintenance",
    subcategoryId: "sub-breakdown-repair",
    requestedVendorId: "sup-hydroflow",
    requestedVendorName: "HydroFlow Engineering",
    notes: "Resolved breakdown replacement purchase.",
    submittedByUserId: "usr-office-001",
    context: {
      clientId: "cli-northstar",
      projectId: "prj-alpha",
      rigId: "rig-gf001",
      maintenanceRequestId: "mr-alpha-complete-001",
      breakdownReportId: "bd-alpha-resolved-001"
    },
    lineItems: [
      lineItem("line-alpha-2", "Seal replacement", 3, 4_666.67, "Resolved breakdown")
    ],
    approvedTotalCost: 14_000,
    actualPostedCost: 14_000,
    expenseId: "exp-alpha-breakdown-resolved",
    movementCount: 1,
    postedAt: iso(addHours(daysAgo(34), 2)),
    reportProjectId: "prj-alpha",
    reportClientId: "cli-northstar"
  }),
  buildRequisition({
    id: "sum-req-bravo-submitted",
    daysAgo: 2,
    requisitionCode: "REQ-20260403-BP1",
    type: "MAINTENANCE_PURCHASE",
    status: "SUBMITTED",
    liveProjectSpendType: null,
    category: "Maintenance",
    subcategory: "Electrical relay",
    categoryId: "cat-maintenance",
    subcategoryId: null,
    requestedVendorId: "sup-hydroflow",
    requestedVendorName: "HydroFlow Engineering",
    notes: "Submitted from maintenance case; awaiting approval.",
    submittedByUserId: "usr-office-001",
    context: {
      clientId: "cli-northstar",
      projectId: "prj-bravo",
      rigId: "rig-gf002",
      maintenanceRequestId: "mr-bravo-wait-001",
      breakdownReportId: null
    },
    lineItems: [
      lineItem("line-bravo-pending", "Control relay", 5, 900, "Waiting-for-parts case")
    ],
    approvedTotalCost: 0,
    actualPostedCost: 0,
    expenseId: null,
    movementCount: 0,
    postedAt: null,
    reportProjectId: "prj-bravo",
    reportClientId: "cli-northstar"
  }),
  buildRequisition({
    id: "sum-req-charlie-submitted",
    daysAgo: 1,
    requisitionCode: "REQ-20260404-CP1",
    type: "LIVE_PROJECT_PURCHASE",
    status: "SUBMITTED",
    liveProjectSpendType: "NORMAL_EXPENSE",
    category: "Services",
    subcategory: "Contractor support",
    categoryId: "cat-services",
    subcategoryId: null,
    requestedVendorId: "sup-boremax",
    requestedVendorName: "BoreMax Supplies",
    notes: "Submitted project purchase awaiting approval.",
    submittedByUserId: "usr-office-001",
    context: {
      clientId: "cli-rift",
      projectId: "prj-charlie",
      rigId: "rig-gf005",
      maintenanceRequestId: null,
      breakdownReportId: null
    },
    lineItems: [
      lineItem("line-charlie-pending", "Site survey support", 2, 2_500, "Operating support")
    ],
    approvedTotalCost: 0,
    actualPostedCost: 0,
    expenseId: null,
    movementCount: 0,
    postedAt: null,
    reportProjectId: "prj-charlie",
    reportClientId: "cli-rift"
  })
];

const SUMMARY_REPORTS = [
  {
    id: "sum-weekly-ops",
    reportDate: daysAgo(1),
    reportType: "WEEKLY",
    projectId: "prj-echo",
    generatedById: "usr-office-001",
    payloadJson: JSON.stringify({
      note: "Operational week summary",
      priority: "Breakdown recovery and maintenance closure",
      pendingApprovals: "Inventory usage and purchase requisitions"
    })
  }
] as const;

async function resetDatabase() {
  await prisma.copilotChatMessage.deleteMany();
  await prisma.copilotChatThread.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.approval.deleteMany();
  await prisma.maintenanceUpdate.deleteMany();
  await prisma.inventoryUsageRequest.deleteMany();
  await prisma.inventoryMovement.deleteMany();
  await prisma.inspection.deleteMany();
  await prisma.budgetPlan.deleteMany();
  await prisma.drillReport.deleteMany();
  await prisma.revenue.deleteMany();
  await prisma.expense.deleteMany();
  await prisma.summaryReport.deleteMany();
  await prisma.maintenanceRequest.deleteMany();
  await prisma.breakdownReport.deleteMany();
  await prisma.rigUsage.deleteMany();
  await prisma.project.deleteMany();
  await prisma.inventoryItem.deleteMany();
  await prisma.inventorySupplier.deleteMany();
  await prisma.inventoryLocation.deleteMany();
  await prisma.mechanic.deleteMany();
  await prisma.alertCenterState.deleteMany();
  await prisma.user.deleteMany();
  await prisma.role.deleteMany();
  await prisma.client.deleteMany();
  await prisma.rig.deleteMany();
}

async function seedRolesAndUsers() {
  await prisma.role.createMany({ data: ROLE_SEEDS.map((entry) => ({ ...entry })), skipDuplicates: true });

  const roleByName = new Map(ROLE_SEEDS.map((entry) => [entry.name, entry.id]));

  for (const user of USER_SEEDS) {
    const passwordHash = await hash(user.password, 10);
    await prisma.user.create({
      data: {
        id: user.id,
        fullName: user.fullName,
        email: user.email,
        passwordHash,
        role: user.role,
        roleId: roleByName.get(user.role) || null,
        title: user.title,
        phone: user.phone,
        currentAssignment: user.currentAssignment,
        isActive: true
      }
    });
  }
}

async function seedCoreReferences() {
  await prisma.client.createMany({ data: CLIENTS.map((entry) => ({ ...entry })), skipDuplicates: true });

  await prisma.rig.createMany({
    data: RIGS.map((entry) => ({
      id: entry.id,
      rigCode: entry.rigCode,
      model: entry.model,
      serialNumber: entry.serialNumber,
      acquisitionDate: new Date(entry.acquisitionDate),
      status: entry.status,
      condition: entry.condition,
      conditionScore: entry.conditionScore,
      totalHoursWorked: entry.totalHoursWorked,
      totalMetersDrilled: entry.totalMetersDrilled,
      totalLifetimeDays: entry.totalLifetimeDays
    })),
    skipDuplicates: true
  });

  for (const project of PROJECTS) {
    await prisma.project.create({
      data: {
        id: project.id,
        clientId: project.clientId,
        name: project.name,
        location: project.location,
        description: project.description,
        startDate: new Date(project.startDate),
        endDate: project.endDate ? new Date(project.endDate) : null,
        status: project.status,
        contractRatePerM: project.contractRatePerM,
        assignedRigId: project.assignedRigId,
        backupRigId: project.backupRigId
      }
    });
  }

  await prisma.projectBillingRateItem.createMany({
    data: PROJECT_BILLING_RATE_ITEMS.map((item) => ({
      projectId: item.projectId,
      itemCode: item.itemCode,
      label: item.label,
      unit: item.unit,
      unitRate: item.unitRate,
      drillingStageLabel: item.drillingStageLabel,
      depthBandStartM: item.depthBandStartM,
      depthBandEndM: item.depthBandEndM,
      sortOrder: item.sortOrder,
      isActive: item.isActive
    })),
    skipDuplicates: true
  });

  await prisma.rigUsage.createMany({
    data: RIG_USAGE.map((entry) => ({
      id: entry.id,
      rigId: entry.rigId,
      projectId: entry.projectId,
      clientId: entry.clientId,
      startDate: new Date(entry.startDate),
      endDate: entry.endDate ? new Date(entry.endDate) : null,
      usageDays: entry.usageDays,
      usageHours: entry.usageHours
    })),
    skipDuplicates: true
  });

  await prisma.mechanic.createMany({
    data: MECHANICS.map((entry) => ({ ...entry })),
    skipDuplicates: true
  });
}

async function seedOperationalCases() {
  await prisma.breakdownReport.createMany({
    data: BREAKDOWNS.map((entry) => ({
      id: entry.id,
      reportDate: entry.reportDate,
      reportedById: entry.reportedById,
      rigId: entry.rigId,
      projectId: entry.projectId,
      clientId: entry.clientId,
      title: entry.title,
      description: entry.description,
      severity: entry.severity,
      downtimeHours: entry.downtimeHours,
      status: entry.status
    })),
    skipDuplicates: true
  });

  await prisma.maintenanceRequest.createMany({
    data: MAINTENANCE_REQUESTS.map((entry) => ({
      id: entry.id,
      requestCode: entry.requestCode,
      requestDate: entry.requestDate,
      rigId: entry.rigId,
      clientId: entry.clientId,
      projectId: entry.projectId,
      breakdownReportId: entry.breakdownReportId,
      mechanicId: entry.mechanicId,
      maintenanceType: entry.maintenanceType,
      issueDescription: entry.issueDescription,
      materialsNeeded: entry.materialsNeeded,
      urgency: entry.urgency,
      photoUrls: entry.photoUrls,
      notes: entry.notes,
      estimatedDowntimeHrs: entry.estimatedDowntimeHrs,
      status: entry.status
    })),
    skipDuplicates: true
  });

  await prisma.maintenanceUpdate.createMany({
    data: MAINTENANCE_UPDATES.map((entry) => ({ ...entry })),
    skipDuplicates: true
  });
}

async function seedFinanceAndInventory() {
  await prisma.inventorySupplier.createMany({
    data: INVENTORY_SUPPLIERS.map((entry) => ({
      id: entry.id,
      name: entry.name,
      contactPerson: entry.contactPerson,
      email: entry.email,
      phone: entry.phone,
      notes: entry.notes,
      isActive: true
    })),
    skipDuplicates: true
  });

  await prisma.inventoryLocation.createMany({
    data: INVENTORY_LOCATIONS.map((entry) => ({
      id: entry.id,
      name: entry.name,
      description: entry.description,
      isActive: true
    })),
    skipDuplicates: true
  });

  await prisma.inventoryItem.createMany({
    data: INVENTORY_ITEMS.map((entry) => ({
      id: entry.id,
      name: entry.name,
      sku: entry.sku,
      category: entry.category,
      description: entry.description,
      quantityInStock: entry.quantityInStock,
      minimumStockLevel: entry.minimumStockLevel,
      unitCost: entry.unitCost,
      supplierId: entry.supplierId,
      locationId: entry.locationId,
      compatibleRigId: entry.compatibleRigId,
      compatibleRigType: entry.compatibleRigType,
      partNumber: entry.partNumber,
      status: entry.status,
      notes: entry.notes
    })),
    skipDuplicates: true
  });

  const contractRateByProjectId = new Map<string, number>(
    PROJECTS.map((project) => [project.id, project.contractRatePerM] as [string, number])
  );
  const activeRateItemsByProjectId = new Map<
    string,
    Array<{
      itemCode: string;
      unit: string;
      unitRate: number;
      depthBandStartM: number | null;
      depthBandEndM: number | null;
    }>
  >();
  for (const item of PROJECT_BILLING_RATE_ITEMS) {
    if (!item.isActive) {
      continue;
    }
    const current = activeRateItemsByProjectId.get(item.projectId) || [];
    current.push({
      itemCode: item.itemCode,
      unit: item.unit,
      unitRate: item.unitRate,
      depthBandStartM: item.depthBandStartM,
      depthBandEndM: item.depthBandEndM
    });
    activeRateItemsByProjectId.set(item.projectId, current);
  }

  for (const report of DRILL_REPORTS) {
    await prisma.drillReport.create({ data: report });

    const activeRateItems = activeRateItemsByProjectId.get(report.projectId) || [];
    const shouldSeedBillableLines = report.approvalStatus === EntryApprovalStatus.APPROVED;
    const billableLines = shouldSeedBillableLines
      ? buildSeedDrillReportBillableLines(report, activeRateItems)
      : [];

    if (billableLines.length > 0) {
      await prisma.drillReportBillableLine.createMany({
        data: billableLines.map((line) => ({
          drillReportId: report.id,
          itemCode: line.itemCode,
          unit: line.unit,
          quantity: line.quantity
        })),
        skipDuplicates: true
      });
    }

    const fallbackContractRate = contractRateByProjectId.get(report.projectId) || 0;
    const billableAmount = calculateDrillReportBillableAmount({
      billableLines,
      activeRateItems: activeRateItems.map((item) => ({
        itemCode: item.itemCode,
        unit: item.unit,
        unitRate: item.unitRate
      })),
      fallbackMeters: report.totalMetersDrilled,
      fallbackContractRate
    });

    if (shouldSeedBillableLines && billableLines.length === 0) {
      throw new Error(
        `Seed quality gate failed: approved drill report ${report.id} has no billable lines.`
      );
    }
    if (shouldSeedBillableLines && billableAmount <= 0) {
      throw new Error(
        `Seed quality gate failed: approved drill report ${report.id} has non-positive billable amount.`
      );
    }

    await prisma.drillReport.update({
      where: { id: report.id },
      data: {
        billableAmount: roundCurrency(billableAmount)
      }
    });
  }

  for (const expense of EXPENSES) {
    await prisma.expense.create({ data: expense });
  }

  await prisma.inventoryMovement.createMany({
    data: INVENTORY_MOVEMENTS.map((entry) => ({ ...entry })),
    skipDuplicates: true
  });

  await prisma.inventoryUsageRequest.createMany({
    data: INVENTORY_USAGE_REQUESTS.map((entry) => ({ ...entry })),
    skipDuplicates: true
  });

  await prisma.budgetPlan.createMany({
    data: BUDGET_PLANS.map((entry) => ({
      id: entry.id,
      scopeType: entry.scopeType,
      name: entry.name,
      amount: entry.amount,
      currency: entry.currency,
      periodStart: new Date(entry.periodStart),
      periodEnd: new Date(entry.periodEnd),
      isActive: entry.isActive,
      notes: entry.notes,
      clientId: entry.clientId,
      projectId: entry.projectId,
      rigId: entry.rigId,
      createdById: entry.createdById,
      updatedById: entry.updatedById
    })),
    skipDuplicates: true
  });
}

async function seedSummaryReports() {
  await prisma.summaryReport.create({
    data: {
      id: "sum-requisition-setup-001",
      reportDate: daysAgo(90),
      reportType: PURCHASE_REQUISITION_SETUP_REPORT_TYPE,
      projectId: null,
      generatedById: "usr-manager-001",
      payloadJson: JSON.stringify(REQUISITION_SETUP_PAYLOAD)
    }
  });

  for (const requisition of PURCHASE_REQUISITIONS) {
    await prisma.summaryReport.create({
      data: {
        id: requisition.id,
        reportDate: requisition.reportDate,
        reportType: PURCHASE_REQUISITION_REPORT_TYPE,
        clientId: requisition.clientId,
        projectId: requisition.projectId,
        generatedById: requisition.payload.submittedBy.userId,
        payloadJson: JSON.stringify(requisition.payload)
      }
    });
  }

  await prisma.summaryReport.createMany({
    data: SUMMARY_REPORTS.map((entry) => ({ ...entry })),
    skipDuplicates: true
  });
}

async function printSeedSummary() {
  const [
    users,
    clients,
    projects,
    rigs,
    approvedDrillReports,
    submittedDrillReports,
    approvedExpenses,
    submittedExpenses,
    maintenanceRequests,
    breakdownReports,
    approvedUsage,
    pendingUsage,
    budgetPlans,
    purchaseRequisitions,
    billingRateItems,
    drillReportBillableLines
  ] = await Promise.all([
    prisma.user.count(),
    prisma.client.count(),
    prisma.project.count(),
    prisma.rig.count(),
    prisma.drillReport.count({ where: { approvalStatus: EntryApprovalStatus.APPROVED } }),
    prisma.drillReport.count({ where: { approvalStatus: EntryApprovalStatus.SUBMITTED } }),
    prisma.expense.count({ where: { approvalStatus: EntryApprovalStatus.APPROVED } }),
    prisma.expense.count({ where: { approvalStatus: EntryApprovalStatus.SUBMITTED } }),
    prisma.maintenanceRequest.count(),
    prisma.breakdownReport.count(),
    prisma.inventoryUsageRequest.count({ where: { status: InventoryUsageRequestStatus.APPROVED } }),
    prisma.inventoryUsageRequest.count({ where: { status: InventoryUsageRequestStatus.SUBMITTED } }),
    prisma.budgetPlan.count({ where: { scopeType: "PROJECT" } }),
    prisma.summaryReport.count({ where: { reportType: PURCHASE_REQUISITION_REPORT_TYPE } }),
    prisma.projectBillingRateItem.count({ where: { isActive: true } }),
    prisma.drillReportBillableLine.count()
  ]);

  console.log(
    JSON.stringify(
      {
        seedProfile: SEED_PROFILE_ID,
        records: {
          users,
          clients,
          projects,
          rigs,
          approvedDrillReports,
          submittedDrillReports,
          approvedExpenses,
          submittedExpenses,
          maintenanceRequests,
          breakdownReports,
          approvedInventoryUsageRequests: approvedUsage,
          submittedInventoryUsageRequests: pendingUsage,
          projectBudgetPlans: budgetPlans,
          purchaseRequisitionReports: purchaseRequisitions,
          activeBillingRateItems: billingRateItems,
          drillReportBillableLines
        },
        scenarios: {
          underBudgetProject: "prj-alpha",
          overspentProject: "prj-bravo",
          noBudgetProjectWithSpend: "prj-charlie",
          maintenanceHeavyProject: "prj-delta",
          breakdownHeavyProject: "prj-echo",
          mostlyOperatingCostProject: "prj-alpha",
          intentionalUnlinkedExpense: "exp-unlinked-001"
        },
        legacyPolicy: {
          legacyRecordsIncluded: false,
          intentionalDataQualityRows: ["exp-unlinked-001"]
        }
      },
      null,
      2
    )
  );
}

async function validateSeedClassificationCoverage() {
  const context = await buildRecognizedSpendContext({});
  const { purposeTotals, classificationAudit, recognizedExpenses } = context;

  if (recognizedExpenses.length === 0) {
    throw new Error("Seed quality gate failed: no recognized expenses found.");
  }

  if (classificationAudit.reconciliationDelta !== 0) {
    throw new Error(
      `Seed quality gate failed: classification reconciliation delta is ${classificationAudit.reconciliationDelta}.`
    );
  }

  const requiredPositiveBuckets: Array<{
    key:
      | "breakdownCost"
      | "maintenanceCost"
      | "stockReplenishmentCost"
      | "operatingCost"
      | "otherUnlinkedCost";
    label: string;
  }> = [
    { key: "breakdownCost", label: "breakdown cost" },
    { key: "maintenanceCost", label: "maintenance cost" },
    { key: "stockReplenishmentCost", label: "stock replenishment cost" },
    { key: "operatingCost", label: "operating cost" },
    { key: "otherUnlinkedCost", label: "other/unlinked cost" }
  ];

  for (const bucket of requiredPositiveBuckets) {
    if ((purposeTotals[bucket.key] ?? 0) <= 0) {
      throw new Error(
        `Seed quality gate failed: expected positive ${bucket.label}, found ${purposeTotals[bucket.key]}.`
      );
    }
  }
}

function buildDrillReport(
  id: string,
  days: number,
  projectId: string,
  clientId: string,
  rigId: string,
  totalMetersDrilled: number,
  approvalStatus: EntryApprovalStatus
) {
  const date = daysAgo(days);
  const totalMeters = Math.max(0, Math.round(totalMetersDrilled));
  const fromMeter = 0;
  const toMeter = totalMeters;

  return {
    id,
    date,
    clientId,
    projectId,
    rigId,
    submittedById: "usr-field-001",
    submittedAt: addHours(date, 6),
    approvedById: approvalStatus === "APPROVED" ? "usr-manager-001" : null,
    approvalStatus,
    approvedAt: approvalStatus === "APPROVED" ? addHours(date, 18) : null,
    rejectionReason: null,
    holeNumber: `${projectId.slice(-4).toUpperCase()}-${Math.abs(days).toString().padStart(3, "0")}`,
    areaLocation: "Primary drill zone",
    fromMeter,
    toMeter,
    totalMetersDrilled: totalMeters,
    workHours: 11,
    rigMoves: 1,
    standbyHours: 0.5,
    delayHours: approvalStatus === "SUBMITTED" ? 1.5 : 0.8,
    comments: "Seeded project-first operational report.",
    operatorCrew: "Crew A",
    billableAmount: 0
  };
}

function buildSeedDrillReportBillableLines(
  report: {
    id: string;
    fromMeter: number;
    toMeter: number;
    totalMetersDrilled: number;
    workHours: number;
    rigMoves: number;
    standbyHours: number;
  },
  activeRateItems: Array<{
    itemCode: string;
    unit: string;
    unitRate: number;
    depthBandStartM: number | null;
    depthBandEndM: number | null;
  }>
) {
  const lines: Array<{ itemCode: string; unit: string; quantity: number }> = [];
  const rangeStart = Math.min(report.fromMeter, report.toMeter);
  const rangeEnd = Math.max(report.fromMeter, report.toMeter);

  const meterItems = activeRateItems.filter((item) => item.unit.trim().toLowerCase() === "meter");
  const stagedMeterItems = meterItems
    .filter((item) => Number.isFinite(item.depthBandStartM) && Number.isFinite(item.depthBandEndM))
    .map((item) => {
      const start = Math.min(item.depthBandStartM as number, item.depthBandEndM as number);
      const end = Math.max(item.depthBandStartM as number, item.depthBandEndM as number);
      return {
        itemCode: item.itemCode,
        unit: item.unit,
        start,
        end
      };
    })
    .sort((left, right) => left.start - right.start);

  if (stagedMeterItems.length > 0) {
    for (const stage of stagedMeterItems) {
      const overlap = Math.max(0, Math.min(rangeEnd, stage.end) - Math.max(rangeStart, stage.start));
      if (overlap > 0) {
        lines.push({
          itemCode: stage.itemCode,
          unit: stage.unit,
          quantity: roundQuantity(overlap)
        });
      }
    }
  } else {
    const primaryMeterItem = meterItems[0];
    if (primaryMeterItem && report.totalMetersDrilled > 0) {
      lines.push({
        itemCode: primaryMeterItem.itemCode,
        unit: primaryMeterItem.unit,
        quantity: roundQuantity(report.totalMetersDrilled)
      });
    }
  }

  addOptionalLine(lines, activeRateItems, "RIG_MOVE", report.rigMoves);
  addOptionalLine(lines, activeRateItems, "WORK_HOURS", report.workHours);
  addOptionalLine(lines, activeRateItems, "STANDBY_HOURS", report.standbyHours);
  addOptionalLine(lines, activeRateItems, "WATER_PUMP_HOURS", report.totalMetersDrilled / 30);
  addOptionalLine(lines, activeRateItems, "SURVEY", report.totalMetersDrilled / 55);
  addOptionalLine(lines, activeRateItems, "REFLEX", report.totalMetersDrilled / 120);
  addOptionalLine(lines, activeRateItems, "SURVEY_SHOT", report.totalMetersDrilled / 45);
  addOptionalLine(lines, activeRateItems, "SURVEY_ORI", report.totalMetersDrilled / 90);

  return lines
    .map((line) => ({
      itemCode: line.itemCode,
      unit: line.unit,
      quantity: roundQuantity(line.quantity)
    }))
    .filter((line) => line.quantity > 0 && Number.isFinite(line.quantity));
}

function addOptionalLine(
  lines: Array<{ itemCode: string; unit: string; quantity: number }>,
  activeRateItems: Array<{ itemCode: string; unit: string }>,
  itemCode: string,
  quantity: number
) {
  const item = activeRateItems.find((entry) => entry.itemCode === itemCode);
  if (!item) {
    return;
  }
  const normalizedQuantity = roundQuantity(quantity);
  if (!Number.isFinite(normalizedQuantity) || normalizedQuantity <= 0) {
    return;
  }
  lines.push({
    itemCode: item.itemCode,
    unit: item.unit,
    quantity: normalizedQuantity
  });
}

function roundQuantity(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.round(value * 100) / 100;
}

function buildExpense(
  id: string,
  days: number,
  amount: number,
  category: string,
  subcategory: string,
  projectId: string | null,
  clientId: string | null,
  rigId: string | null,
  approvalStatus: EntryApprovalStatus
) {
  const date = daysAgo(days);
  const submittedAt = addHours(date, 4);
  const approvedAt = approvalStatus === "APPROVED" ? addHours(date, 20) : null;

  return {
    id,
    date,
    amount,
    category,
    subcategory,
    entrySource: "MANUAL",
    vendor: "Seed Vendor",
    notes: `[${SEED_PROFILE_ID}] Seeded expense ${id}`,
    receiptUrl: null,
    receiptFileName: null,
    enteredByUserId: "usr-office-001",
    submittedAt,
    approvedById: approvalStatus === "APPROVED" ? "usr-manager-001" : null,
    approvalStatus,
    approvedAt,
    rejectionReason: null,
    clientId,
    projectId,
    rigId,
    quantity: null,
    unitCost: null,
    receiptNumber: null
  };
}

function lineItem(
  id: string,
  description: string,
  quantity: number,
  estimatedUnitCost: number,
  notes: string
) {
  return {
    id,
    description,
    quantity,
    estimatedUnitCost,
    estimatedTotalCost: roundCurrency(quantity * estimatedUnitCost),
    notes
  };
}

function buildRequisition(input: {
  id: string;
  daysAgo: number;
  requisitionCode: string;
  type: RequisitionType;
  status: "SUBMITTED" | "APPROVED" | "REJECTED" | "PURCHASE_COMPLETED";
  liveProjectSpendType: "BREAKDOWN" | "NORMAL_EXPENSE" | null;
  category: string;
  subcategory: string | null;
  categoryId: string | null;
  subcategoryId: string | null;
  requestedVendorId: string | null;
  requestedVendorName: string | null;
  notes: string | null;
  submittedByUserId: string;
  context: {
    clientId: string | null;
    projectId: string | null;
    rigId: string | null;
    maintenanceRequestId: string | null;
    breakdownReportId: string | null;
  };
  lineItems: Array<{
    id: string;
    description: string;
    quantity: number;
    estimatedUnitCost: number;
    estimatedTotalCost: number;
    notes: string | null;
  }>;
  approvedTotalCost: number;
  actualPostedCost: number;
  expenseId: string | null;
  movementCount: number;
  postedAt: string | null;
  reportProjectId: string | null;
  reportClientId: string | null;
}) {
  const submittedAt = iso(addHours(daysAgo(input.daysAgo), 2));
  const approvedAt = input.status === "APPROVED" || input.status === "PURCHASE_COMPLETED" ? iso(addHours(daysAgo(input.daysAgo), 8)) : null;

  const submittedBy = resolveActor(input.submittedByUserId);
  const approvedBy = approvedAt ? resolveActor("usr-manager-001") : null;

  const estimatedTotalCost = roundCurrency(
    input.lineItems.reduce((sum, entry) => sum + entry.estimatedTotalCost, 0)
  );

  const payload: PurchaseRequisitionPayload = {
    schemaVersion: 1,
    requisitionCode: input.requisitionCode,
    type: input.type,
    status: input.status,
    liveProjectSpendType: input.type === "LIVE_PROJECT_PURCHASE" ? input.liveProjectSpendType : null,
    category: input.category,
    subcategory: input.subcategory,
    categoryId: input.categoryId,
    subcategoryId: input.subcategoryId,
    requestedVendorId: input.requestedVendorId,
    requestedVendorName: input.requestedVendorName,
    notes: input.notes,
    submittedAt,
    submittedBy,
    approval: {
      approvedAt,
      approvedBy,
      rejectedAt: null,
      rejectedBy: null,
      rejectionReason: null,
      lineItemMode: "FULL_ONLY"
    },
    context: {
      clientId: input.context.clientId,
      projectId: input.context.projectId,
      rigId: input.context.rigId,
      maintenanceRequestId: input.context.maintenanceRequestId,
      breakdownReportId: input.context.breakdownReportId
    },
    lineItems: input.lineItems,
    totals: {
      estimatedTotalCost,
      approvedTotalCost: input.approvedTotalCost,
      actualPostedCost: input.actualPostedCost
    },
    purchase: {
      receiptSubmissionId: null,
      receiptNumber: null,
      supplierName: input.requestedVendorName,
      expenseId: input.expenseId,
      movementCount: input.movementCount,
      postedAt: input.postedAt
    }
  };

  return {
    id: input.id,
    reportDate: daysAgo(input.daysAgo),
    projectId: input.reportProjectId,
    clientId: input.reportClientId,
    payload
  };
}

function resolveActor(userId: string) {
  const user = USER_SEEDS.find((entry) => entry.id === userId);
  if (!user) {
    throw new Error(`Unknown user for actor ${userId}`);
  }
  return {
    userId: user.id,
    name: user.fullName,
    role: user.role
  };
}

function roundCurrency(value: number) {
  return Math.round(value * 100) / 100;
}

function daysAgo(days: number) {
  const now = new Date();
  const utcStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return new Date(utcStart - days * DAY_MS);
}

function addHours(date: Date, hours: number) {
  return new Date(date.getTime() + hours * 60 * 60 * 1000);
}

function iso(date: Date) {
  return date.toISOString();
}

async function main() {
  await resetDatabase();
  await seedRolesAndUsers();
  await seedCoreReferences();
  await seedOperationalCases();
  await seedFinanceAndInventory();
  await seedSummaryReports();
  await validateSeedClassificationCoverage();
  await printSeedSummary();
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
