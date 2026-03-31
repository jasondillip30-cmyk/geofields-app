import { hash } from "bcryptjs";
import {
  ApprovalDecision,
  EntryApprovalStatus,
  InventoryCategory,
  InventoryItemStatus,
  InventoryMovementType,
  MaintenanceStatus,
  PrismaClient,
  ProjectStatus,
  RigCondition,
  RigStatus,
  UrgencyLevel,
  UserRole
} from "@prisma/client";

const prisma = new PrismaClient();

const DAY_MS = 24 * 60 * 60 * 1000;

interface RoleSeed {
  id: string;
  name: UserRole;
  description: string;
}

interface UserSeed {
  key: "admin" | "office" | "mechanic" | "field";
  id: string;
  fullName: string;
  email: string;
  password: string;
  role: UserRole;
  title: string;
  phone: string;
  currentAssignment: string;
}

interface ClientSeed {
  key: string;
  id: string;
  name: string;
  aliases?: string[];
  contactPerson: string;
  email: string;
  phone: string;
  address: string;
  description: string;
  logoUrl?: string;
  profilePhotoUrl?: string;
}

interface RigSeed {
  key: string;
  id: string;
  rigCode: string;
  model: string;
  serialNumber: string;
  acquisitionDate: string;
  status: RigStatus;
  condition: RigCondition;
  conditionScore: number;
  totalHoursWorked: number;
  totalMetersDrilled: number;
  totalLifetimeDays: number;
  photoUrl?: string;
}

interface ProjectSeed {
  key: string;
  id: string;
  clientKey: string;
  name: string;
  location: string;
  description: string;
  photoUrl?: string;
  startDate: string;
  endDate?: string;
  status: ProjectStatus;
  contractRatePerM: number;
  assignedRigKey?: string;
  backupRigKey?: string;
}

interface RigUsageSeed {
  id: string;
  rigKey: string;
  projectKey: string;
  clientKey: string;
  startDate: string;
  endDate?: string;
  usageDays: number;
  usageHours: number;
}

interface MechanicSeed {
  key: string;
  id: string;
  fullName: string;
  specialization: string;
  phone: string;
  email: string;
  profileImageUrl: string;
  currentAssignment: string;
  status: string;
}

interface ReportPattern {
  projectKey: string;
  rigKey: string;
  holePrefix: string;
  areaLabel: string;
  baseMeters: number;
  baseWorkHours: number;
  baseDelayHours: number;
  crews: string[];
  dayOffsets: number[];
}

interface DrillReportSeed {
  id: string;
  date: Date;
  clientId: string;
  projectId: string;
  rigId: string;
  submittedById: string;
  submittedAt: Date | null;
  approvedById: string | null;
  approvalStatus: EntryApprovalStatus;
  approvedAt: Date | null;
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
  comments: string;
  operatorCrew: string;
  billableAmount: number;
}

interface ExpenseSeed {
  id: string;
  date: Date;
  amount: number;
  category: string;
  subcategory: string | null;
  vendor: string | null;
  notes: string;
  receiptUrl: string | null;
  entrySource: string;
  enteredByUserId: string | null;
  submittedAt: Date | null;
  approvedById: string | null;
  approvalStatus: EntryApprovalStatus;
  approvedAt: Date | null;
  rejectionReason: string | null;
  clientId: string | null;
  projectId: string | null;
  rigId: string | null;
}

interface MaintenanceSeed {
  key: string;
  id: string;
  requestCode: string;
  daysAgo: number;
  rigKey: string;
  clientKey?: string;
  projectKey?: string;
  mechanicKey: string;
  issueDescription: string;
  materialsNeeded: string;
  urgency: UrgencyLevel;
  photoUrls: string[];
  notes?: string;
  estimatedDowntimeHrs: number;
  status: MaintenanceStatus;
}

interface InventorySupplierSeed {
  key: string;
  id: string;
  name: string;
  contactPerson?: string;
  email?: string;
  phone?: string;
  notes?: string;
}

interface InventoryLocationSeed {
  key: string;
  id: string;
  name: string;
  description?: string;
}

interface InventoryItemSeed {
  key: string;
  id: string;
  name: string;
  sku: string;
  category: InventoryCategory;
  description?: string;
  quantityInStock: number;
  minimumStockLevel: number;
  unitCost: number;
  supplierKey?: string;
  locationKey?: string;
  compatibleRigKey?: string;
  compatibleRigType?: string;
  partNumber?: string;
  status: InventoryItemStatus;
  notes?: string;
}

interface InventoryMovementSeed {
  id: string;
  itemKey: string;
  movementType: InventoryMovementType;
  daysAgo: number;
  quantity: number;
  unitCost?: number;
  totalCost?: number;
  projectKey?: string;
  clientKey?: string;
  rigKey?: string;
  maintenanceKey?: string;
  expenseId?: string;
  supplierKey?: string;
  locationFromKey?: string;
  locationToKey?: string;
  traReceiptNumber?: string;
  supplierInvoiceNumber?: string;
  receiptUrl?: string;
  notes?: string;
}

interface ContextMaps {
  users: Record<UserSeed["key"], string>;
  clients: Record<string, string>;
  rigs: Record<string, string>;
  projects: Record<string, string>;
  mechanics: Record<string, string>;
  inventorySuppliers: Record<string, string>;
  inventoryLocations: Record<string, string>;
  inventoryItems: Record<string, string>;
}

const ROLE_SEEDS: RoleSeed[] = [
  { id: "role-admin", name: UserRole.ADMIN, description: "Admin / management access." },
  { id: "role-office", name: UserRole.OFFICE, description: "Office operations and approvals." },
  { id: "role-mechanic", name: UserRole.MECHANIC, description: "Mechanic workshop access." },
  { id: "role-field", name: UserRole.FIELD, description: "Field operations access." }
];

const USER_SEEDS: UserSeed[] = [
  {
    key: "admin",
    id: "usr-admin-1",
    fullName: "GeoFields Admin",
    email: "admin@geofields.co.tz",
    password: "Admin123!",
    role: UserRole.ADMIN,
    title: "Operations Director",
    phone: "+255 700 000 001",
    currentAssignment: "Head Office"
  },
  {
    key: "office",
    id: "usr-office-1",
    fullName: "Office Supervisor",
    email: "office@geofields.co.tz",
    password: "Office123!",
    role: UserRole.OFFICE,
    title: "Finance & Planning",
    phone: "+255 700 000 002",
    currentAssignment: "Main Office"
  },
  {
    key: "mechanic",
    id: "usr-mech-1",
    fullName: "Workshop Lead",
    email: "mechanic@geofields.co.tz",
    password: "Mechanic123!",
    role: UserRole.MECHANIC,
    title: "Lead Mechanic",
    phone: "+255 700 000 003",
    currentAssignment: "Workshop Bay 1"
  },
  {
    key: "field",
    id: "usr-field-1",
    fullName: "Field Supervisor",
    email: "field@geofields.co.tz",
    password: "Field123!",
    role: UserRole.FIELD,
    title: "Field Operator",
    phone: "+255 700 000 004",
    currentAssignment: "North Mara Site"
  }
];

const CLIENT_SEEDS: ClientSeed[] = [
  {
    key: "barrick",
    id: "cli-barrick",
    name: "Barrick North Mara",
    contactPerson: "L. Msigwa",
    email: "operations@barrick.co.tz",
    phone: "+255 700 001 100",
    address: "Tarime, Mara",
    description: "High-volume production and grade control drilling operations.",
    logoUrl: "https://images.unsplash.com/photo-1454165804606-c3d57bc86b40?q=80&w=400",
    profilePhotoUrl: "https://images.unsplash.com/photo-1541888946425-d81bb19240f5?q=80&w=800"
  },
  {
    key: "uranium",
    id: "cli-uranium",
    name: "Tanzania Uranium JV",
    contactPerson: "P. Nyerere",
    email: "projects@uraniumjv.co.tz",
    phone: "+255 700 001 400",
    address: "Namtumbo",
    description: "Resource expansion and block-scale uranium exploration."
  },
  {
    key: "shanta",
    id: "cli-shanta",
    name: "Shanta Gold",
    aliases: ["Shanta Mining"],
    contactPerson: "M. Komba",
    email: "ops@shantagold.co.tz",
    phone: "+255 700 001 300",
    address: "Singida",
    description: "Mixed production and exploration campaigns with variable margins."
  },
  {
    key: "geita",
    id: "cli-geita",
    name: "Geita Drilling Services",
    aliases: ["Geita Gold Mine"],
    contactPerson: "R. Mwakalila",
    email: "operations@geitads.co.tz",
    phone: "+255 700 001 200",
    address: "Geita",
    description: "Regional pit expansion and support drilling programs."
  },
  {
    key: "anglogold",
    id: "cli-anglogold",
    name: "AngloGold Exploration",
    contactPerson: "J. Mtega",
    email: "exploration@anglogold.co.tz",
    phone: "+255 700 001 500",
    address: "Kahama",
    description: "Greenfield exploration drilling and resource delineation.",
    logoUrl: "https://images.unsplash.com/photo-1532619675605-1ede6c2ed2b0?q=80&w=400"
  },
  {
    key: "lakezone",
    id: "cli-lakezone",
    name: "Lake Zone Minerals",
    contactPerson: "S. Mahenga",
    email: "operations@lakezoneminerals.co.tz",
    phone: "+255 700 001 600",
    address: "Mwanza",
    description: "Pilot programs and low-activity trial drilling."
  }
];

const RIG_SEEDS: RigSeed[] = [
  {
    key: "gf001",
    id: "rig-gf001",
    rigCode: "GF-RIG-001",
    model: "Atlas Copco ROC D7",
    serialNumber: "AC-D7-2210",
    acquisitionDate: "2020-02-15",
    status: RigStatus.ACTIVE,
    condition: RigCondition.GOOD,
    conditionScore: 84,
    totalHoursWorked: 12850,
    totalMetersDrilled: 256400,
    totalLifetimeDays: 1418
  },
  {
    key: "gf002",
    id: "rig-gf002",
    rigCode: "GF-RIG-002",
    model: "Sandvik Pantera DP1100",
    serialNumber: "SV-DP-1932",
    acquisitionDate: "2019-08-03",
    status: RigStatus.ACTIVE,
    condition: RigCondition.EXCELLENT,
    conditionScore: 91,
    totalHoursWorked: 15340,
    totalMetersDrilled: 291120,
    totalLifetimeDays: 1630
  },
  {
    key: "gf003",
    id: "rig-gf003",
    rigCode: "GF-RIG-003",
    model: "Epiroc SmartROC T45",
    serialNumber: "EP-T45-4521",
    acquisitionDate: "2021-01-22",
    status: RigStatus.MAINTENANCE,
    condition: RigCondition.FAIR,
    conditionScore: 59,
    totalHoursWorked: 10110,
    totalMetersDrilled: 191440,
    totalLifetimeDays: 1148
  },
  {
    key: "gf004",
    id: "rig-gf004",
    rigCode: "GF-RIG-004",
    model: "Ingersoll Rand DM45",
    serialNumber: "IR-DM-0903",
    acquisitionDate: "2018-05-19",
    status: RigStatus.IDLE,
    condition: RigCondition.GOOD,
    conditionScore: 75,
    totalHoursWorked: 13390,
    totalMetersDrilled: 217920,
    totalLifetimeDays: 1510
  },
  {
    key: "gf005",
    id: "rig-gf005",
    rigCode: "GF-RIG-005",
    model: "Furukawa HCR1500",
    serialNumber: "FU-HCR-8241",
    acquisitionDate: "2017-10-11",
    status: RigStatus.BREAKDOWN,
    condition: RigCondition.POOR,
    conditionScore: 41,
    totalHoursWorked: 17110,
    totalMetersDrilled: 304210,
    totalLifetimeDays: 1868
  },
  {
    key: "gf006",
    id: "rig-gf006",
    rigCode: "GF-RIG-006",
    model: "Epiroc FlexiROC D65",
    serialNumber: "EP-D65-7220",
    acquisitionDate: "2022-06-01",
    status: RigStatus.ACTIVE,
    condition: RigCondition.FAIR,
    conditionScore: 66,
    totalHoursWorked: 7040,
    totalMetersDrilled: 109600,
    totalLifetimeDays: 774
  },
  {
    key: "gf007",
    id: "rig-gf007",
    rigCode: "GF-RIG-007",
    model: "Sandvik Leopard DI650i",
    serialNumber: "SV-DI-6507",
    acquisitionDate: "2023-03-18",
    status: RigStatus.ACTIVE,
    condition: RigCondition.EXCELLENT,
    conditionScore: 94,
    totalHoursWorked: 5220,
    totalMetersDrilled: 128540,
    totalLifetimeDays: 590
  }
];

const PROJECT_SEEDS: ProjectSeed[] = [
  {
    key: "north_mara_phase1",
    id: "prj-north-mara-phase1",
    clientKey: "barrick",
    name: "North Mara Phase 1",
    location: "Tarime North Zone",
    description: "Primary production drilling with strong meter output and stable rates.",
    startDate: "2025-10-01",
    status: ProjectStatus.ACTIVE,
    contractRatePerM: 128,
    assignedRigKey: "gf007",
    backupRigKey: "gf002"
  },
  {
    key: "north_pit_dewatering",
    id: "prj-north-pit",
    clientKey: "barrick",
    name: "North Pit Dewatering Program",
    location: "Mara Region",
    description: "De-watering support drilling for pit wall stability.",
    startDate: "2025-07-01",
    status: ProjectStatus.ACTIVE,
    contractRatePerM: 98,
    assignedRigKey: "gf002",
    backupRigKey: "gf001"
  },
  {
    key: "grade_control_campaign",
    id: "prj-grade-control-campaign",
    clientKey: "barrick",
    name: "Grade Control Campaign",
    location: "North Mara East Bench",
    description: "Grade-control drilling campaign completed in Q1.",
    startDate: "2025-05-15",
    endDate: "2026-02-28",
    status: ProjectStatus.COMPLETED,
    contractRatePerM: 92,
    assignedRigKey: "gf001",
    backupRigKey: "gf004"
  },
  {
    key: "uranium_west_block",
    id: "prj-uranium-west",
    clientKey: "uranium",
    name: "Uranium West Block",
    location: "Namtumbo West",
    description: "High-value uranium expansion drilling with mixed downtime.",
    startDate: "2025-09-10",
    status: ProjectStatus.ACTIVE,
    contractRatePerM: 118,
    assignedRigKey: "gf001",
    backupRigKey: "gf005"
  },
  {
    key: "uranium_resource_expansion",
    id: "prj-uranium-expansion",
    clientKey: "uranium",
    name: "Uranium Resource Expansion",
    location: "Namtumbo South",
    description: "Resource model extension program currently paused pending approvals.",
    startDate: "2025-12-05",
    status: ProjectStatus.ON_HOLD,
    contractRatePerM: 110,
    assignedRigKey: "gf003",
    backupRigKey: "gf005"
  },
  {
    key: "exploration_rc_2026",
    id: "prj-exploration-rc-2026",
    clientKey: "shanta",
    name: "Exploration RC 2026",
    location: "Singida Prospect Belt",
    description: "Underperforming RC campaign with heavy maintenance pressure.",
    startDate: "2026-01-05",
    status: ProjectStatus.ACTIVE,
    contractRatePerM: 74,
    assignedRigKey: "gf006",
    backupRigKey: "gf004"
  },
  {
    key: "trial_drilling_program",
    id: "prj-trial-drilling-program",
    clientKey: "shanta",
    name: "Trial Drilling Program",
    location: "Singida Test Zone",
    description: "Pilot program with intentionally low activity for empty-state testing.",
    startDate: "2026-03-05",
    status: ProjectStatus.PLANNED,
    contractRatePerM: 70,
    assignedRigKey: "gf004"
  },
  {
    key: "east_pit_expansion",
    id: "prj-east-pit-expansion",
    clientKey: "geita",
    name: "East Pit Expansion",
    location: "Geita East",
    description: "Expansion drilling to support pit development schedule.",
    startDate: "2025-11-11",
    status: ProjectStatus.ACTIVE,
    contractRatePerM: 102,
    assignedRigKey: "gf002",
    backupRigKey: "gf007"
  },
  {
    key: "greenfield_scout_program",
    id: "prj-greenfield-scout",
    clientKey: "anglogold",
    name: "Greenfield Scout Program",
    location: "Kahama Belt",
    description: "Exploration scout campaign with moderate output.",
    startDate: "2026-01-20",
    status: ProjectStatus.ACTIVE,
    contractRatePerM: 95,
    assignedRigKey: "gf007",
    backupRigKey: "gf006"
  },
  {
    key: "lake_zone_pilot_holes",
    id: "prj-lake-zone-pilot",
    clientKey: "lakezone",
    name: "Lake Zone Pilot Holes",
    location: "Mwanza South",
    description: "Low-activity pilot drilling package.",
    startDate: "2026-02-01",
    status: ProjectStatus.ON_HOLD,
    contractRatePerM: 82,
    assignedRigKey: "gf004",
    backupRigKey: "gf006"
  }
];

const RIG_USAGE_SEEDS: RigUsageSeed[] = [
  {
    id: "usage-seed-001",
    rigKey: "gf007",
    projectKey: "north_mara_phase1",
    clientKey: "barrick",
    startDate: "2025-10-01",
    usageDays: 174,
    usageHours: 1824
  },
  {
    id: "usage-seed-002",
    rigKey: "gf002",
    projectKey: "north_pit_dewatering",
    clientKey: "barrick",
    startDate: "2025-07-01",
    usageDays: 246,
    usageHours: 2570
  },
  {
    id: "usage-seed-003",
    rigKey: "gf001",
    projectKey: "uranium_west_block",
    clientKey: "uranium",
    startDate: "2025-09-10",
    usageDays: 199,
    usageHours: 1910
  },
  {
    id: "usage-seed-004",
    rigKey: "gf006",
    projectKey: "exploration_rc_2026",
    clientKey: "shanta",
    startDate: "2026-01-05",
    usageDays: 84,
    usageHours: 803
  },
  {
    id: "usage-seed-005",
    rigKey: "gf002",
    projectKey: "east_pit_expansion",
    clientKey: "geita",
    startDate: "2025-11-11",
    usageDays: 138,
    usageHours: 1440
  },
  {
    id: "usage-seed-006",
    rigKey: "gf007",
    projectKey: "greenfield_scout_program",
    clientKey: "anglogold",
    startDate: "2026-01-20",
    usageDays: 63,
    usageHours: 624
  },
  {
    id: "usage-seed-007",
    rigKey: "gf004",
    projectKey: "lake_zone_pilot_holes",
    clientKey: "lakezone",
    startDate: "2026-02-01",
    usageDays: 12,
    usageHours: 74
  }
];

const MECHANIC_SEEDS: MechanicSeed[] = [
  {
    key: "hydraulic",
    id: "mech-001",
    fullName: "Daniel Mlay",
    specialization: "Hydraulic mechanic",
    phone: "+255 754 100 101",
    email: "d.mlay@geofields.co.tz",
    profileImageUrl: "/mechanics/daniel-mlay.jpg",
    currentAssignment: "GF-RIG-003",
    status: "ON_JOB"
  },
  {
    key: "auto_electrician",
    id: "mech-002",
    fullName: "Asha Mushi",
    specialization: "Auto electrician",
    phone: "+255 754 100 102",
    email: "a.mushi@geofields.co.tz",
    profileImageUrl: "/mechanics/asha-mushi.jpg",
    currentAssignment: "Workshop Bay 2",
    status: "AVAILABLE"
  },
  {
    key: "compressor",
    id: "mech-003",
    fullName: "Hassan Mrope",
    specialization: "Compressor specialist",
    phone: "+255 754 100 103",
    email: "h.mrope@geofields.co.tz",
    profileImageUrl: "/mechanics/hassan-mrope.jpg",
    currentAssignment: "GF-RIG-005",
    status: "ON_JOB"
  },
  {
    key: "welder",
    id: "mech-004",
    fullName: "Neema Chuwa",
    specialization: "Welder/Fabricator",
    phone: "+255 754 100 104",
    email: "n.chuwa@geofields.co.tz",
    profileImageUrl: "/mechanics/neema-chuwa.jpg",
    currentAssignment: "Fabrication Unit",
    status: "AVAILABLE"
  },
  {
    key: "diesel",
    id: "mech-005",
    fullName: "Frank Ngowi",
    specialization: "Diesel mechanic",
    phone: "+255 754 100 105",
    email: "f.ngowi@geofields.co.tz",
    profileImageUrl: "/mechanics/frank-ngowi.jpg",
    currentAssignment: "GF-RIG-006",
    status: "ON_JOB"
  },
  {
    key: "general_fitter",
    id: "mech-006",
    fullName: "Mariam Mzava",
    specialization: "General fitter",
    phone: "+255 754 100 106",
    email: "m.mzava@geofields.co.tz",
    profileImageUrl: "/mechanics/mariam-mzava.jpg",
    currentAssignment: "Central Workshop",
    status: "AVAILABLE"
  }
];

const INVENTORY_SUPPLIER_SEEDS: InventorySupplierSeed[] = [
  {
    key: "minesupply",
    id: "inv-sup-001",
    name: "MineSupply TZ",
    contactPerson: "R. Chacha",
    email: "sales@minesupplytz.co.tz",
    phone: "+255 756 900 101",
    notes: "Primary drilling and consumables supplier."
  },
  {
    key: "hydroflow",
    id: "inv-sup-002",
    name: "HydroFlow East Africa",
    contactPerson: "D. Mgaya",
    email: "orders@hydroflowea.co.tz",
    phone: "+255 756 900 102",
    notes: "Hydraulic components and repair kits."
  },
  {
    key: "petrotz",
    id: "inv-sup-003",
    name: "PetroTZ Lubricants",
    contactPerson: "A. Mushi",
    email: "industrial@petrotz.co.tz",
    phone: "+255 756 900 103",
    notes: "Oils, filters, and grease products."
  },
  {
    key: "electromax",
    id: "inv-sup-004",
    name: "ElectroMax Industrial",
    contactPerson: "J. Mollel",
    email: "support@electromax.co.tz",
    phone: "+255 756 900 104",
    notes: "Electrical relays, sensors, and harness sets."
  },
  {
    key: "heavyrent",
    id: "inv-sup-005",
    name: "HeavyRent Parts Hub",
    contactPerson: "K. Nnko",
    email: "parts@heavyrent.co.tz",
    phone: "+255 756 900 105",
    notes: "Belts, tire inventory, and workshop emergency stock."
  }
];

const INVENTORY_LOCATION_SEEDS: InventoryLocationSeed[] = [
  {
    key: "main_warehouse",
    id: "inv-loc-001",
    name: "Main Warehouse",
    description: "Central inventory hub at GeoFields HQ."
  },
  {
    key: "site_store",
    id: "inv-loc-002",
    name: "Site Store",
    description: "On-site store for fast-moving parts."
  },
  {
    key: "mobile_workshop",
    id: "inv-loc-003",
    name: "Mobile Workshop",
    description: "Portable stock for field maintenance teams."
  }
];

const INVENTORY_ITEM_SEEDS: InventoryItemSeed[] = [
  {
    key: "drill_bits",
    id: "inv-item-001",
    name: "Drill Bits 6.5in",
    sku: "GF-DRB-650",
    category: "DRILLING",
    description: "Primary production drill bits for high-output benches.",
    quantityInStock: 48,
    minimumStockLevel: 20,
    unitCost: 410,
    supplierKey: "minesupply",
    locationKey: "main_warehouse",
    compatibleRigType: "DTH / RC",
    partNumber: "DB-6.5-PRO",
    status: "ACTIVE"
  },
  {
    key: "hydraulic_hose",
    id: "inv-item-002",
    name: "Hydraulic Hose 3/4",
    sku: "GF-HYD-034",
    category: "HYDRAULIC",
    description: "Hydraulic hose replacement set for mast and rotation systems.",
    quantityInStock: 4,
    minimumStockLevel: 8,
    unitCost: 275,
    supplierKey: "hydroflow",
    locationKey: "site_store",
    compatibleRigKey: "gf006",
    partNumber: "HYD-HOSE-34",
    status: "ACTIVE"
  },
  {
    key: "oil_filter",
    id: "inv-item-003",
    name: "Oil Filter Kit",
    sku: "GF-FLT-OIL",
    category: "FILTERS",
    description: "Oil filter kit for scheduled rig maintenance.",
    quantityInStock: 0,
    minimumStockLevel: 10,
    unitCost: 95,
    supplierKey: "petrotz",
    locationKey: "site_store",
    compatibleRigType: "All rigs",
    partNumber: "FLT-OIL-KIT",
    status: "ACTIVE"
  },
  {
    key: "fuel_filter",
    id: "inv-item-004",
    name: "Fuel Filter",
    sku: "GF-FLT-FUEL",
    category: "FILTERS",
    quantityInStock: 6,
    minimumStockLevel: 12,
    unitCost: 88,
    supplierKey: "petrotz",
    locationKey: "site_store",
    partNumber: "FLT-FUEL-01",
    status: "ACTIVE"
  },
  {
    key: "engine_oil",
    id: "inv-item-005",
    name: "Engine Oil 15W-40 (L)",
    sku: "GF-OIL-1540",
    category: "OILS",
    quantityInStock: 220,
    minimumStockLevel: 80,
    unitCost: 9.5,
    supplierKey: "petrotz",
    locationKey: "main_warehouse",
    compatibleRigType: "Diesel rigs",
    status: "ACTIVE"
  },
  {
    key: "grease",
    id: "inv-item-006",
    name: "Industrial Grease Cartridge",
    sku: "GF-GRS-001",
    category: "OILS",
    quantityInStock: 32,
    minimumStockLevel: 15,
    unitCost: 7.2,
    supplierKey: "petrotz",
    locationKey: "main_warehouse",
    status: "ACTIVE"
  },
  {
    key: "relay",
    id: "inv-item-007",
    name: "Electrical Relay 24V",
    sku: "GF-ELR-24V",
    category: "ELECTRICAL",
    quantityInStock: 3,
    minimumStockLevel: 6,
    unitCost: 64,
    supplierKey: "electromax",
    locationKey: "mobile_workshop",
    compatibleRigType: "Control panel",
    status: "ACTIVE"
  },
  {
    key: "compressor_belt",
    id: "inv-item-008",
    name: "Compressor Belt Set",
    sku: "GF-CMP-BLT",
    category: "SPARE_PARTS",
    quantityInStock: 1,
    minimumStockLevel: 5,
    unitCost: 180,
    supplierKey: "heavyrent",
    locationKey: "main_warehouse",
    compatibleRigKey: "gf005",
    status: "ACTIVE"
  },
  {
    key: "spare_tire",
    id: "inv-item-009",
    name: "Spare Tire 12R22.5",
    sku: "GF-TIR-1222",
    category: "TIRES",
    quantityInStock: 10,
    minimumStockLevel: 4,
    unitCost: 430,
    supplierKey: "heavyrent",
    locationKey: "main_warehouse",
    status: "ACTIVE"
  },
  {
    key: "drill_rod",
    id: "inv-item-010",
    name: "Drill Rod 3m",
    sku: "GF-DRD-3M",
    category: "DRILLING",
    quantityInStock: 70,
    minimumStockLevel: 30,
    unitCost: 220,
    supplierKey: "minesupply",
    locationKey: "main_warehouse",
    status: "ACTIVE"
  },
  {
    key: "rc_bit",
    id: "inv-item-011",
    name: "RC Bit 5.5in",
    sku: "GF-RCB-550",
    category: "CONSUMABLES",
    quantityInStock: 14,
    minimumStockLevel: 20,
    unitCost: 360,
    supplierKey: "minesupply",
    locationKey: "site_store",
    compatibleRigType: "RC operations",
    status: "ACTIVE"
  },
  {
    key: "maintenance_kit",
    id: "inv-item-012",
    name: "Maintenance Seal Kit",
    sku: "GF-MNT-KIT",
    category: "SPARE_PARTS",
    quantityInStock: 2,
    minimumStockLevel: 6,
    unitCost: 140,
    supplierKey: "hydroflow",
    locationKey: "mobile_workshop",
    status: "ACTIVE",
    notes: "Used heavily on GF-RIG-006 and GF-RIG-003."
  }
];

const INVENTORY_MOVEMENT_SEEDS: InventoryMovementSeed[] = [
  {
    id: "inv-mov-001",
    itemKey: "drill_bits",
    movementType: "IN",
    daysAgo: 82,
    quantity: 18,
    unitCost: 398,
    totalCost: 7164,
    supplierKey: "minesupply",
    locationToKey: "main_warehouse",
    traReceiptNumber: "TRA-DB-8821",
    supplierInvoiceNumber: "INV-DB-8821",
    receiptUrl: "/uploads/inventory-receipts/inv-db-8821.jpg",
    expenseId: "exp-seed-025",
    notes: "Restock for production campaign."
  },
  {
    id: "inv-mov-002",
    itemKey: "hydraulic_hose",
    movementType: "IN",
    daysAgo: 77,
    quantity: 10,
    unitCost: 268,
    totalCost: 2680,
    supplierKey: "hydroflow",
    locationToKey: "site_store",
    traReceiptNumber: "TRA-HYD-4410",
    supplierInvoiceNumber: "INV-HYD-4410",
    receiptUrl: "/uploads/inventory-receipts/inv-hyd-4410.pdf",
    expenseId: "exp-seed-024"
  },
  {
    id: "inv-mov-003",
    itemKey: "oil_filter",
    movementType: "IN",
    daysAgo: 74,
    quantity: 24,
    unitCost: 92,
    totalCost: 2208,
    supplierKey: "petrotz",
    locationToKey: "site_store",
    traReceiptNumber: "TRA-FLT-1120",
    supplierInvoiceNumber: "INV-FLT-1120",
    receiptUrl: "/uploads/inventory-receipts/inv-flt-1120.jpg",
    expenseId: "exp-seed-023"
  },
  {
    id: "inv-mov-004",
    itemKey: "engine_oil",
    movementType: "IN",
    daysAgo: 68,
    quantity: 160,
    unitCost: 9.2,
    totalCost: 1472,
    supplierKey: "petrotz",
    locationToKey: "main_warehouse",
    supplierInvoiceNumber: "INV-OIL-2201",
    expenseId: "exp-seed-019"
  },
  {
    id: "inv-mov-005",
    itemKey: "rc_bit",
    movementType: "IN",
    daysAgo: 63,
    quantity: 26,
    unitCost: 348,
    totalCost: 9048,
    supplierKey: "minesupply",
    locationToKey: "site_store",
    supplierInvoiceNumber: "INV-RCB-1902",
    expenseId: "exp-seed-029"
  },
  {
    id: "inv-mov-006",
    itemKey: "drill_bits",
    movementType: "OUT",
    daysAgo: 58,
    quantity: 8,
    unitCost: 398,
    totalCost: 3184,
    projectKey: "north_mara_phase1",
    clientKey: "barrick",
    rigKey: "gf007",
    locationFromKey: "main_warehouse",
    notes: "Bits issued for high-output bench campaign."
  },
  {
    id: "inv-mov-007",
    itemKey: "hydraulic_hose",
    movementType: "OUT",
    daysAgo: 54,
    quantity: 4,
    unitCost: 268,
    totalCost: 1072,
    projectKey: "exploration_rc_2026",
    clientKey: "shanta",
    rigKey: "gf006",
    maintenanceKey: "mr001",
    locationFromKey: "site_store",
    notes: "Maintenance replacement for overheating incident."
  },
  {
    id: "inv-mov-008",
    itemKey: "maintenance_kit",
    movementType: "OUT",
    daysAgo: 53,
    quantity: 3,
    unitCost: 140,
    totalCost: 420,
    projectKey: "exploration_rc_2026",
    clientKey: "shanta",
    rigKey: "gf006",
    maintenanceKey: "mr001",
    locationFromKey: "mobile_workshop"
  },
  {
    id: "inv-mov-009",
    itemKey: "oil_filter",
    movementType: "OUT",
    daysAgo: 51,
    quantity: 12,
    unitCost: 92,
    totalCost: 1104,
    projectKey: "north_pit_dewatering",
    clientKey: "barrick",
    rigKey: "gf002",
    maintenanceKey: "mr011",
    locationFromKey: "site_store"
  },
  {
    id: "inv-mov-010",
    itemKey: "fuel_filter",
    movementType: "IN",
    daysAgo: 49,
    quantity: 16,
    unitCost: 84,
    totalCost: 1344,
    supplierKey: "petrotz",
    locationToKey: "site_store",
    supplierInvoiceNumber: "INV-FF-8812",
    expenseId: "exp-seed-032"
  },
  {
    id: "inv-mov-011",
    itemKey: "fuel_filter",
    movementType: "OUT",
    daysAgo: 45,
    quantity: 10,
    unitCost: 84,
    totalCost: 840,
    projectKey: "exploration_rc_2026",
    clientKey: "shanta",
    rigKey: "gf006",
    maintenanceKey: "mr010",
    locationFromKey: "site_store"
  },
  {
    id: "inv-mov-012",
    itemKey: "relay",
    movementType: "OUT",
    daysAgo: 42,
    quantity: 2,
    unitCost: 64,
    totalCost: 128,
    projectKey: "north_pit_dewatering",
    clientKey: "barrick",
    rigKey: "gf002",
    maintenanceKey: "mr004",
    locationFromKey: "mobile_workshop"
  },
  {
    id: "inv-mov-013",
    itemKey: "compressor_belt",
    movementType: "OUT",
    daysAgo: 40,
    quantity: 2,
    unitCost: 180,
    totalCost: 360,
    projectKey: "uranium_resource_expansion",
    clientKey: "uranium",
    rigKey: "gf003",
    maintenanceKey: "mr009",
    locationFromKey: "main_warehouse"
  },
  {
    id: "inv-mov-014",
    itemKey: "drill_rod",
    movementType: "OUT",
    daysAgo: 34,
    quantity: 12,
    unitCost: 220,
    totalCost: 2640,
    projectKey: "uranium_west_block",
    clientKey: "uranium",
    rigKey: "gf001",
    locationFromKey: "main_warehouse"
  },
  {
    id: "inv-mov-015",
    itemKey: "rc_bit",
    movementType: "OUT",
    daysAgo: 30,
    quantity: 18,
    unitCost: 348,
    totalCost: 6264,
    projectKey: "exploration_rc_2026",
    clientKey: "shanta",
    rigKey: "gf006",
    locationFromKey: "site_store"
  },
  {
    id: "inv-mov-016",
    itemKey: "drill_bits",
    movementType: "TRANSFER",
    daysAgo: 28,
    quantity: 6,
    locationFromKey: "main_warehouse",
    locationToKey: "mobile_workshop",
    notes: "Field workshop allocation."
  },
  {
    id: "inv-mov-017",
    itemKey: "engine_oil",
    movementType: "OUT",
    daysAgo: 24,
    quantity: 48,
    unitCost: 9.2,
    totalCost: 441.6,
    projectKey: "north_mara_phase1",
    clientKey: "barrick",
    rigKey: "gf007",
    locationFromKey: "main_warehouse"
  },
  {
    id: "inv-mov-018",
    itemKey: "grease",
    movementType: "OUT",
    daysAgo: 21,
    quantity: 14,
    unitCost: 7.2,
    totalCost: 100.8,
    projectKey: "east_pit_expansion",
    clientKey: "geita",
    rigKey: "gf002",
    locationFromKey: "main_warehouse"
  },
  {
    id: "inv-mov-019",
    itemKey: "maintenance_kit",
    movementType: "OUT",
    daysAgo: 19,
    quantity: 3,
    unitCost: 140,
    totalCost: 420,
    projectKey: "uranium_resource_expansion",
    clientKey: "uranium",
    rigKey: "gf003",
    maintenanceKey: "mr009",
    locationFromKey: "mobile_workshop"
  },
  {
    id: "inv-mov-020",
    itemKey: "oil_filter",
    movementType: "OUT",
    daysAgo: 17,
    quantity: 12,
    unitCost: 92,
    totalCost: 1104,
    projectKey: "greenfield_scout_program",
    clientKey: "anglogold",
    rigKey: "gf001",
    maintenanceKey: "mr012",
    locationFromKey: "site_store"
  },
  {
    id: "inv-mov-021",
    itemKey: "fuel_filter",
    movementType: "OUT",
    daysAgo: 15,
    quantity: 8,
    unitCost: 84,
    totalCost: 672,
    projectKey: "east_pit_expansion",
    clientKey: "geita",
    rigKey: "gf002",
    maintenanceKey: "mr011",
    locationFromKey: "site_store"
  },
  {
    id: "inv-mov-022",
    itemKey: "relay",
    movementType: "IN",
    daysAgo: 12,
    quantity: 4,
    unitCost: 62,
    totalCost: 248,
    supplierKey: "electromax",
    locationToKey: "mobile_workshop",
    supplierInvoiceNumber: "INV-EL-5501",
    expenseId: "exp-seed-041"
  },
  {
    id: "inv-mov-023",
    itemKey: "compressor_belt",
    movementType: "IN",
    daysAgo: 10,
    quantity: 3,
    unitCost: 175,
    totalCost: 525,
    supplierKey: "heavyrent",
    locationToKey: "main_warehouse",
    supplierInvoiceNumber: "INV-CB-3008",
    expenseId: "exp-seed-039"
  },
  {
    id: "inv-mov-024",
    itemKey: "hydraulic_hose",
    movementType: "OUT",
    daysAgo: 8,
    quantity: 6,
    unitCost: 268,
    totalCost: 1608,
    projectKey: "exploration_rc_2026",
    clientKey: "shanta",
    rigKey: "gf006",
    maintenanceKey: "mr010",
    locationFromKey: "site_store"
  },
  {
    id: "inv-mov-025",
    itemKey: "rc_bit",
    movementType: "OUT",
    daysAgo: 6,
    quantity: 14,
    unitCost: 348,
    totalCost: 4872,
    projectKey: "north_mara_phase1",
    clientKey: "barrick",
    rigKey: "gf007",
    locationFromKey: "site_store"
  },
  {
    id: "inv-mov-026",
    itemKey: "oil_filter",
    movementType: "ADJUSTMENT",
    daysAgo: 5,
    quantity: -12,
    unitCost: 92,
    totalCost: 1104,
    notes: "Cycle count adjustment - missing filters not recorded in prior month."
  },
  {
    id: "inv-mov-027",
    itemKey: "maintenance_kit",
    movementType: "IN",
    daysAgo: 4,
    quantity: 4,
    unitCost: 138,
    totalCost: 552,
    supplierKey: "hydroflow",
    locationToKey: "mobile_workshop",
    supplierInvoiceNumber: "INV-MK-7741",
    expenseId: "exp-seed-047"
  },
  {
    id: "inv-mov-028",
    itemKey: "maintenance_kit",
    movementType: "OUT",
    daysAgo: 2,
    quantity: 4,
    unitCost: 138,
    totalCost: 552,
    projectKey: "exploration_rc_2026",
    clientKey: "shanta",
    rigKey: "gf006",
    maintenanceKey: "mr001",
    locationFromKey: "mobile_workshop"
  }
];

async function main() {
  const roleIds = await ensureRoles();
  const userIds = await ensureUsers(roleIds);
  const clientIds = await ensureClients();
  const rigIds = await ensureRigs();
  const projectIds = await ensureProjects(clientIds, rigIds);

  const context: ContextMaps = {
    users: userIds,
    clients: clientIds,
    rigs: rigIds,
    projects: projectIds,
    mechanics: {},
    inventorySuppliers: {},
    inventoryLocations: {},
    inventoryItems: {}
  };

  await ensureRigUsage(context);
  context.mechanics = await ensureMechanics();
  await ensureDrillReports(context);
  await ensureExpenses(context);
  const maintenanceIds = await ensureMaintenanceRequests(context);
  await ensureMaintenanceUpdates(context, maintenanceIds);
  await ensureMaintenanceApprovals(context, maintenanceIds);
  context.inventorySuppliers = await ensureInventorySuppliers();
  context.inventoryLocations = await ensureInventoryLocations();
  context.inventoryItems = await ensureInventoryItems(context);
  await ensureInventoryMovements(context, maintenanceIds);
  await ensureInspections(context);
  await ensureBreakdownReports(context);
  await ensureSummaryReports(context);

  await printCoverageSummary();

  console.log("Seed completed (idempotent enrich mode). Existing records were preserved and expanded.");
}

async function ensureRoles() {
  const roleIds = {} as Record<UserRole, string>;

  for (const roleSeed of ROLE_SEEDS) {
    const role = await prisma.role.upsert({
      where: { name: roleSeed.name },
      update: {
        description: roleSeed.description
      },
      create: {
        id: roleSeed.id,
        name: roleSeed.name,
        description: roleSeed.description
      }
    });
    roleIds[roleSeed.name] = role.id;
  }

  return roleIds;
}

async function ensureUsers(roleIds: Record<UserRole, string>) {
  const userIds = {} as Record<UserSeed["key"], string>;

  const passwordHashes = await Promise.all(USER_SEEDS.map((user) => hash(user.password, 10)));

  for (let index = 0; index < USER_SEEDS.length; index += 1) {
    const user = USER_SEEDS[index];
    const passwordHash = passwordHashes[index];
    const saved = await prisma.user.upsert({
      where: { email: user.email },
      update: {
        fullName: user.fullName,
        passwordHash,
        role: user.role,
        roleId: roleIds[user.role],
        title: user.title,
        phone: user.phone,
        currentAssignment: user.currentAssignment,
        isActive: true
      },
      create: {
        id: user.id,
        fullName: user.fullName,
        email: user.email,
        passwordHash,
        role: user.role,
        roleId: roleIds[user.role],
        title: user.title,
        phone: user.phone,
        currentAssignment: user.currentAssignment,
        isActive: true
      }
    });
    userIds[user.key] = saved.id;
  }

  return userIds;
}

async function ensureClients() {
  const clientIds: Record<string, string> = {};

  for (const clientSeed of CLIENT_SEEDS) {
    const existingExact = await prisma.client.findUnique({
      where: { name: clientSeed.name },
      select: { id: true }
    });

    let match = existingExact;
    if (!match && clientSeed.aliases && clientSeed.aliases.length > 0) {
      for (const alias of clientSeed.aliases) {
        const aliasMatch = await prisma.client.findUnique({
          where: { name: alias },
          select: { id: true }
        });
        if (aliasMatch) {
          match = aliasMatch;
          break;
        }
      }
    }

    const data = {
      name: clientSeed.name,
      contactPerson: clientSeed.contactPerson,
      email: clientSeed.email,
      phone: clientSeed.phone,
      address: clientSeed.address,
      description: clientSeed.description,
      logoUrl: clientSeed.logoUrl ?? null,
      profilePhotoUrl: clientSeed.profilePhotoUrl ?? null
    };

    if (match) {
      const updated = await prisma.client.update({
        where: { id: match.id },
        data
      });
      clientIds[clientSeed.key] = updated.id;
      continue;
    }

    const created = await prisma.client.create({
      data: {
        id: clientSeed.id,
        ...data
      }
    });
    clientIds[clientSeed.key] = created.id;
  }

  return clientIds;
}

async function ensureRigs() {
  const rigIds: Record<string, string> = {};

  for (const rigSeed of RIG_SEEDS) {
    const rig = await prisma.rig.upsert({
      where: { rigCode: rigSeed.rigCode },
      update: {
        model: rigSeed.model,
        serialNumber: rigSeed.serialNumber,
        photoUrl: rigSeed.photoUrl ?? null,
        acquisitionDate: new Date(rigSeed.acquisitionDate),
        status: rigSeed.status,
        condition: rigSeed.condition,
        conditionScore: rigSeed.conditionScore,
        totalHoursWorked: rigSeed.totalHoursWorked,
        totalMetersDrilled: rigSeed.totalMetersDrilled,
        totalLifetimeDays: rigSeed.totalLifetimeDays
      },
      create: {
        id: rigSeed.id,
        rigCode: rigSeed.rigCode,
        model: rigSeed.model,
        serialNumber: rigSeed.serialNumber,
        photoUrl: rigSeed.photoUrl ?? null,
        acquisitionDate: new Date(rigSeed.acquisitionDate),
        status: rigSeed.status,
        condition: rigSeed.condition,
        conditionScore: rigSeed.conditionScore,
        totalHoursWorked: rigSeed.totalHoursWorked,
        totalMetersDrilled: rigSeed.totalMetersDrilled,
        totalLifetimeDays: rigSeed.totalLifetimeDays
      }
    });

    rigIds[rigSeed.key] = rig.id;
  }

  return rigIds;
}

async function ensureProjects(clientIds: Record<string, string>, rigIds: Record<string, string>) {
  const projectIds: Record<string, string> = {};

  for (const projectSeed of PROJECT_SEEDS) {
    const clientId = clientIds[projectSeed.clientKey];
    const assignedRigId = projectSeed.assignedRigKey ? rigIds[projectSeed.assignedRigKey] : null;
    const backupRigId = projectSeed.backupRigKey ? rigIds[projectSeed.backupRigKey] : null;

    const data = {
      clientId,
      name: projectSeed.name,
      location: projectSeed.location,
      description: projectSeed.description,
      photoUrl: projectSeed.photoUrl ?? null,
      startDate: new Date(projectSeed.startDate),
      endDate: projectSeed.endDate ? new Date(projectSeed.endDate) : null,
      status: projectSeed.status,
      contractRatePerM: projectSeed.contractRatePerM,
      assignedRigId,
      backupRigId
    };

    const existingById = await prisma.project.findUnique({
      where: { id: projectSeed.id },
      select: { id: true }
    });

    if (existingById) {
      const updated = await prisma.project.update({
        where: { id: existingById.id },
        data
      });
      projectIds[projectSeed.key] = updated.id;
      continue;
    }

    const existingByClientAndName = await prisma.project.findFirst({
      where: {
        clientId,
        name: projectSeed.name
      },
      select: { id: true }
    });

    if (existingByClientAndName) {
      const updated = await prisma.project.update({
        where: { id: existingByClientAndName.id },
        data
      });
      projectIds[projectSeed.key] = updated.id;
      continue;
    }

    const created = await prisma.project.create({
      data: {
        id: projectSeed.id,
        ...data
      }
    });
    projectIds[projectSeed.key] = created.id;
  }

  return projectIds;
}

async function ensureRigUsage(context: ContextMaps) {
  for (const usageSeed of RIG_USAGE_SEEDS) {
    const rigId = context.rigs[usageSeed.rigKey];
    const projectId = context.projects[usageSeed.projectKey];
    const clientId = context.clients[usageSeed.clientKey];

    await prisma.rigUsage.upsert({
      where: { id: usageSeed.id },
      update: {
        rigId,
        projectId,
        clientId,
        startDate: new Date(usageSeed.startDate),
        endDate: usageSeed.endDate ? new Date(usageSeed.endDate) : null,
        usageDays: usageSeed.usageDays,
        usageHours: usageSeed.usageHours
      },
      create: {
        id: usageSeed.id,
        rigId,
        projectId,
        clientId,
        startDate: new Date(usageSeed.startDate),
        endDate: usageSeed.endDate ? new Date(usageSeed.endDate) : null,
        usageDays: usageSeed.usageDays,
        usageHours: usageSeed.usageHours
      }
    });
  }
}

async function ensureMechanics() {
  const mechanicIds: Record<string, string> = {};

  for (const mechanicSeed of MECHANIC_SEEDS) {
    const mechanic = await prisma.mechanic.upsert({
      where: { email: mechanicSeed.email },
      update: {
        fullName: mechanicSeed.fullName,
        specialization: mechanicSeed.specialization,
        phone: mechanicSeed.phone,
        profileImageUrl: mechanicSeed.profileImageUrl,
        currentAssignment: mechanicSeed.currentAssignment,
        status: mechanicSeed.status
      },
      create: {
        id: mechanicSeed.id,
        fullName: mechanicSeed.fullName,
        specialization: mechanicSeed.specialization,
        phone: mechanicSeed.phone,
        email: mechanicSeed.email,
        profileImageUrl: mechanicSeed.profileImageUrl,
        currentAssignment: mechanicSeed.currentAssignment,
        status: mechanicSeed.status
      }
    });
    mechanicIds[mechanicSeed.key] = mechanic.id;
  }

  return mechanicIds;
}

async function ensureDrillReports(context: ContextMaps) {
  const projectMap = new Map(PROJECT_SEEDS.map((project) => [project.key, project]));
  const rejectionReasons = [
    "Meters mismatch with field log. Please verify hole closure reading.",
    "Delay reporting incomplete. Add reason for standby hours.",
    "Incorrect rig movement count. Re-submit with corrected values."
  ];

  const reportPatterns: ReportPattern[] = [
    {
      projectKey: "north_mara_phase1",
      rigKey: "gf007",
      holePrefix: "NM",
      areaLabel: "Phase-1 Bench",
      baseMeters: 96,
      baseWorkHours: 11.1,
      baseDelayHours: 0.5,
      crews: ["Crew Alpha", "Crew Delta"],
      dayOffsets: [88, 84, 80, 76, 72, 68, 64, 60, 56, 52, 48, 44, 40, 36, 32, 28, 20, 12]
    },
    {
      projectKey: "north_pit_dewatering",
      rigKey: "gf002",
      holePrefix: "NP",
      areaLabel: "North Pit",
      baseMeters: 74,
      baseWorkHours: 10.2,
      baseDelayHours: 0.8,
      crews: ["Crew Bravo", "Crew Echo"],
      dayOffsets: [86, 78, 70, 62, 54, 46, 38, 30, 22, 14]
    },
    {
      projectKey: "uranium_west_block",
      rigKey: "gf001",
      holePrefix: "UW",
      areaLabel: "West Block",
      baseMeters: 63,
      baseWorkHours: 9.6,
      baseDelayHours: 1.2,
      crews: ["Crew Kilo", "Crew Lima"],
      dayOffsets: [82, 74, 66, 58, 50, 42, 34, 26]
    },
    {
      projectKey: "exploration_rc_2026",
      rigKey: "gf006",
      holePrefix: "RC",
      areaLabel: "RC Corridor",
      baseMeters: 38,
      baseWorkHours: 8.8,
      baseDelayHours: 2.1,
      crews: ["Crew Sierra", "Crew Tango"],
      dayOffsets: [89, 81, 73, 65, 57, 49, 41, 25, 9]
    },
    {
      projectKey: "east_pit_expansion",
      rigKey: "gf002",
      holePrefix: "EP",
      areaLabel: "East Pit",
      baseMeters: 59,
      baseWorkHours: 9.5,
      baseDelayHours: 1.1,
      crews: ["Crew Foxtrot", "Crew Golf"],
      dayOffsets: [79, 67, 55, 43, 31, 19]
    },
    {
      projectKey: "greenfield_scout_program",
      rigKey: "gf007",
      holePrefix: "GS",
      areaLabel: "Scout Block",
      baseMeters: 55,
      baseWorkHours: 8.9,
      baseDelayHours: 1.0,
      crews: ["Crew India", "Crew Juliet"],
      dayOffsets: [61, 45, 29]
    },
    {
      projectKey: "lake_zone_pilot_holes",
      rigKey: "gf004",
      holePrefix: "LZ",
      areaLabel: "Pilot Section",
      baseMeters: 22,
      baseWorkHours: 6.8,
      baseDelayHours: 1.6,
      crews: ["Crew Pico"],
      dayOffsets: [35]
    },
    {
      projectKey: "uranium_resource_expansion",
      rigKey: "gf003",
      holePrefix: "UR",
      areaLabel: "Expansion Zone",
      baseMeters: 46,
      baseWorkHours: 8.4,
      baseDelayHours: 2.2,
      crews: ["Crew Zulu"],
      dayOffsets: [24]
    },
    {
      projectKey: "grade_control_campaign",
      rigKey: "gf001",
      holePrefix: "GC",
      areaLabel: "Grade Control",
      baseMeters: 51,
      baseWorkHours: 8.5,
      baseDelayHours: 0.9,
      crews: ["Crew Omega"],
      dayOffsets: [47]
    }
  ];

  const reports: DrillReportSeed[] = [];
  let reportIndex = 1;

  for (const pattern of reportPatterns) {
    const projectDef = projectMap.get(pattern.projectKey);
    if (!projectDef) {
      continue;
    }

    const projectId = context.projects[pattern.projectKey];
    const clientId = context.clients[projectDef.clientKey];
    const rigId = context.rigs[pattern.rigKey];

    for (const dayOffset of pattern.dayOffsets) {
      const date = utcDaysAgo(dayOffset);
      const variability = ((reportIndex * 13) % 23) - 11;
      let meters = Math.max(4, pattern.baseMeters + variability);
      if (reportIndex % 10 === 0) {
        meters = Math.max(6, Math.round(meters * 0.45));
      }
      if (reportIndex % 17 === 0) {
        meters = Math.round(meters * 1.3);
      }
      if (pattern.projectKey === "exploration_rc_2026" && reportIndex % 3 === 0) {
        meters = Math.max(7, meters - 11);
      }

      const workHours = round1(Math.max(5.5, pattern.baseWorkHours + ((((reportIndex * 7) % 9) - 4) * 0.35)));
      const delayHours = round1(Math.max(0, pattern.baseDelayHours + (reportIndex % 6 === 0 ? 2.2 : (reportIndex % 4) * 0.3)));
      const standbyHours = round1(Math.max(0, (reportIndex % 5) * 0.35));
      const rigMoves = reportIndex % 3;
      const status = resolveReportStatus(reportIndex);
      const submittedAt = status === "DRAFT" ? null : addHoursUtc(date, 11);
      const approvedAt = status === "APPROVED" || status === "REJECTED" ? addHoursUtc(date, 28) : null;
      const approvedById =
        status === "APPROVED" || status === "REJECTED"
          ? reportIndex % 2 === 0
            ? context.users.office
            : context.users.admin
          : null;
      const rejectionReason = status === "REJECTED" ? rejectionReasons[reportIndex % rejectionReasons.length] : null;
      const comments =
        meters >= pattern.baseMeters + 12
          ? "High productivity shift with stable penetration rate."
          : meters <= Math.max(12, Math.round(pattern.baseMeters * 0.5))
            ? "Reduced output due to formation and maintenance checks."
            : "Normal drilling progress with standard crew output.";
      const rate = projectDef.contractRatePerM;
      const billableAmount = roundCurrency(meters * rate);

      reports.push({
        id: `dr-seed-${pad3(reportIndex)}`,
        date,
        clientId,
        projectId,
        rigId,
        submittedById: context.users.field,
        submittedAt,
        approvedById,
        approvalStatus: status,
        approvedAt,
        rejectionReason,
        holeNumber: `${pattern.holePrefix}-${220 + reportIndex}`,
        areaLocation: `${pattern.areaLabel} ${((reportIndex % 4) + 1).toString()}`,
        fromMeter: 0,
        toMeter: meters,
        totalMetersDrilled: meters,
        workHours,
        rigMoves,
        standbyHours,
        delayHours,
        comments,
        operatorCrew: pattern.crews[reportIndex % pattern.crews.length],
        billableAmount
      });

      reportIndex += 1;
    }
  }

  for (const report of reports) {
    await prisma.drillReport.upsert({
      where: { id: report.id },
      update: {
        date: report.date,
        clientId: report.clientId,
        projectId: report.projectId,
        rigId: report.rigId,
        submittedById: report.submittedById,
        submittedAt: report.submittedAt,
        approvedById: report.approvedById,
        approvalStatus: report.approvalStatus,
        approvedAt: report.approvedAt,
        rejectionReason: report.rejectionReason,
        holeNumber: report.holeNumber,
        areaLocation: report.areaLocation,
        fromMeter: report.fromMeter,
        toMeter: report.toMeter,
        totalMetersDrilled: report.totalMetersDrilled,
        workHours: report.workHours,
        rigMoves: report.rigMoves,
        standbyHours: report.standbyHours,
        delayHours: report.delayHours,
        comments: report.comments,
        operatorCrew: report.operatorCrew,
        billableAmount: report.billableAmount
      },
      create: report
    });
  }
}

async function ensureExpenses(context: ContextMaps) {
  const projectToClientKey = Object.fromEntries(PROJECT_SEEDS.map((project) => [project.key, project.clientKey]));
  const projectToPrimaryRigKey = Object.fromEntries(
    PROJECT_SEEDS.map((project) => [project.key, project.assignedRigKey ?? null])
  );

  const expenses: ExpenseSeed[] = [];

  const pushExpense = (input: {
    daysAgo: number;
    amount: number;
    category: string;
    subcategory?: string;
    vendor?: string;
    notes: string;
    projectKey?: string;
    rigKey?: string;
    clientKey?: string;
    receiptUrl?: string;
    statusOverride?: EntryApprovalStatus;
  }) => {
    const index = expenses.length + 1;
    const status = input.statusOverride ?? resolveExpenseStatus(index);
    const date = utcDaysAgo(input.daysAgo);
    const projectKey = input.projectKey ?? null;
    const inferredClientKey = projectKey ? projectToClientKey[projectKey] : null;
    const inferredRigKey = projectKey ? projectToPrimaryRigKey[projectKey] : null;
    const clientKey = input.clientKey ?? inferredClientKey;
    const rigKey = input.rigKey ?? inferredRigKey;
    const submittedAt = status === "DRAFT" ? null : addHoursUtc(date, 9);
    const approvedAt = status === "APPROVED" || status === "REJECTED" ? addHoursUtc(date, 27) : null;
    const approvedById =
      status === "APPROVED" || status === "REJECTED"
        ? index % 2 === 0
          ? context.users.office
          : context.users.admin
        : null;

    expenses.push({
      id: `exp-seed-${pad3(index)}`,
      date,
      amount: roundCurrency(input.amount),
      category: input.category,
      subcategory: input.subcategory ?? null,
      vendor: input.vendor ?? null,
      notes: input.notes,
      receiptUrl: input.receiptUrl ?? null,
      entrySource: "MANUAL",
      enteredByUserId: context.users.office,
      submittedAt,
      approvedById,
      approvalStatus: status,
      approvedAt,
      rejectionReason:
        status === "REJECTED" ? "Rejected during finance review. Update quantities and resubmit." : null,
      clientId: clientKey ? context.clients[clientKey] : null,
      projectId: projectKey ? context.projects[projectKey] : null,
      rigId: rigKey ? context.rigs[rigKey] : null
    });
  };

  const fuelTargets = [
    "north_mara_phase1",
    "north_pit_dewatering",
    "uranium_west_block",
    "exploration_rc_2026",
    "north_mara_phase1",
    "east_pit_expansion",
    "north_pit_dewatering",
    "exploration_rc_2026",
    "north_mara_phase1",
    "uranium_west_block",
    "east_pit_expansion",
    "exploration_rc_2026",
    "north_mara_phase1",
    "north_pit_dewatering",
    "exploration_rc_2026",
    "greenfield_scout_program"
  ] as const;

  const fuelOffsets = [88, 84, 80, 76, 72, 68, 64, 60, 56, 52, 48, 44, 40, 32, 24, 16] as const;
  for (let index = 0; index < fuelOffsets.length; index += 1) {
    const projectKey = fuelTargets[index];
    const amountBase =
      projectKey === "north_mara_phase1"
        ? 4300
        : projectKey === "north_pit_dewatering"
          ? 3650
          : projectKey === "exploration_rc_2026"
            ? 3300
            : projectKey === "uranium_west_block"
              ? 3450
              : 3520;

    pushExpense({
      daysAgo: fuelOffsets[index],
      amount: amountBase + (index % 3) * 210,
      category: "Fuel",
      subcategory: index % 2 === 0 ? "Diesel Bulk" : "Generator Fuel",
      vendor: "PetroTZ",
      projectKey,
      notes: "Weekly fuel top-up for active drilling shifts.",
      receiptUrl: index % 4 === 0 ? `/receipts/fuel-${index + 1}.jpg` : undefined
    });
  }

  const laborOffsets = [87, 75, 63, 51, 39, 27, 15, 3] as const;
  for (let index = 0; index < laborOffsets.length; index += 1) {
    pushExpense({
      daysAgo: laborOffsets[index],
      amount: 3450 + (index % 3) * 420,
      category: "Labor",
      subcategory: index % 2 === 0 ? "Shift Wages" : "Allowance",
      vendor: "GeoFields Payroll",
      notes: "Field and workshop labor allocation.",
      clientKey: index % 2 === 0 ? "barrick" : undefined,
      projectKey: index % 2 === 0 ? "north_mara_phase1" : undefined,
      statusOverride: index === laborOffsets.length - 1 ? "SUBMITTED" : undefined
    });
  }

  const maintenanceEntries = [
    { daysAgo: 71, amount: 6800, projectKey: "exploration_rc_2026", rigKey: "gf006", note: "Hydraulic pump replacement." },
    { daysAgo: 59, amount: 5600, projectKey: "exploration_rc_2026", rigKey: "gf006", note: "Top head service and seal kit." },
    { daysAgo: 47, amount: 7200, projectKey: "exploration_rc_2026", rigKey: "gf006", note: "Engine cooling repair and fan clutch." },
    { daysAgo: 33, amount: 8100, projectKey: "uranium_resource_expansion", rigKey: "gf003", note: "Hydraulic line repair and hose set." },
    { daysAgo: 21, amount: 9400, projectKey: "uranium_resource_expansion", rigKey: "gf003", note: "Compressor overhaul component set." },
    { daysAgo: 13, amount: 5200, projectKey: "north_pit_dewatering", rigKey: "gf002", note: "Routine hammer and feed system service." },
    { daysAgo: 8, amount: 11800, projectKey: "exploration_rc_2026", rigKey: "gf006", note: "Unexpected gearbox replacement." }
  ] as const;
  for (const entry of maintenanceEntries) {
    pushExpense({
      daysAgo: entry.daysAgo,
      amount: entry.amount,
      category: "Maintenance",
      subcategory: "Repair Work",
      vendor: "MineTech Workshop",
      projectKey: entry.projectKey,
      rigKey: entry.rigKey,
      notes: entry.note
    });
  }

  const spareEntries = [
    { daysAgo: 66, amount: 3200, projectKey: "north_mara_phase1", rigKey: "gf007", note: "RC bits replenishment." },
    { daysAgo: 53, amount: 2700, projectKey: "north_pit_dewatering", rigKey: "gf002", note: "Shrouds and coupling set." },
    { daysAgo: 29, amount: 3600, projectKey: "exploration_rc_2026", rigKey: "gf006", note: "Air valves and drill consumables." },
    { daysAgo: 11, amount: 2500, projectKey: "east_pit_expansion", rigKey: "gf002", note: "PVC lines and pressure fittings." }
  ] as const;
  for (const entry of spareEntries) {
    pushExpense({
      daysAgo: entry.daysAgo,
      amount: entry.amount,
      category: "Spare Parts",
      subcategory: "Consumables",
      vendor: "MineSupply TZ",
      projectKey: entry.projectKey,
      rigKey: entry.rigKey,
      notes: entry.note
    });
  }

  pushExpense({
    daysAgo: 58,
    amount: 1900,
    category: "Transport",
    vendor: "Savanna Logistics",
    projectKey: "uranium_west_block",
    notes: "Crew and material transport between blocks."
  });
  pushExpense({
    daysAgo: 37,
    amount: 2200,
    category: "Transport",
    vendor: "Savanna Logistics",
    projectKey: "exploration_rc_2026",
    notes: "Emergency transport for replacement parts."
  });
  pushExpense({
    daysAgo: 18,
    amount: 1700,
    category: "Transport",
    vendor: "Geita Haulers",
    projectKey: "east_pit_expansion",
    notes: "Daily shuttle and site transfer costs."
  });

  pushExpense({
    daysAgo: 57,
    amount: 1250,
    category: "Camp Food",
    vendor: "Mara Catering",
    projectKey: "north_pit_dewatering",
    notes: "Camp food supplies for rotation crew."
  });
  pushExpense({
    daysAgo: 34,
    amount: 1180,
    category: "Camp Food",
    vendor: "Mara Catering",
    projectKey: "exploration_rc_2026",
    notes: "Night shift provisions."
  });
  pushExpense({
    daysAgo: 6,
    amount: 980,
    category: "Camp Food",
    vendor: "Kahama Foods",
    projectKey: "greenfield_scout_program",
    notes: "Camp refresh supplies."
  });

  pushExpense({
    daysAgo: 42,
    amount: 4600,
    category: "Rentals",
    subcategory: "Auxiliary Compressor",
    vendor: "HeavyRent TZ",
    projectKey: "exploration_rc_2026",
    notes: "Temporary compressor rental due downtime."
  });
  pushExpense({
    daysAgo: 23,
    amount: 3400,
    category: "Rentals",
    subcategory: "Light Plant",
    vendor: "HeavyRent TZ",
    projectKey: "uranium_west_block",
    notes: "Light plant rental for night operation."
  });

  pushExpense({
    daysAgo: 31,
    amount: 1450,
    category: "Accommodation",
    vendor: "Mara Lodge",
    clientKey: "barrick",
    notes: "Accommodation for support team."
  });
  pushExpense({
    daysAgo: 7,
    amount: 1200,
    category: "Accommodation",
    vendor: "Kahama Suites",
    clientKey: "anglogold",
    notes: "Accommodation for scout crew handover."
  });

  pushExpense({
    daysAgo: 64,
    amount: 980,
    category: "Office Costs",
    vendor: "Office World",
    clientKey: "barrick",
    notes: "Reporting stationery and print costs."
  });
  pushExpense({
    daysAgo: 5,
    amount: 1320,
    category: "Office Costs",
    vendor: "DataNet TZ",
    notes: "Connectivity and reporting licenses."
  });

  pushExpense({
    daysAgo: 55,
    amount: 860,
    category: "Other",
    vendor: "Site Services",
    notes: "Miscellaneous operation support items.",
    clientKey: "uranium"
  });
  pushExpense({
    daysAgo: 10,
    amount: 1240,
    category: "Other",
    vendor: "Site Services",
    notes: "Temporary safety and compliance materials.",
    clientKey: "shanta"
  });

  for (const expense of expenses) {
    await prisma.expense.upsert({
      where: { id: expense.id },
      update: {
        date: expense.date,
        amount: expense.amount,
        category: expense.category,
        subcategory: expense.subcategory,
        entrySource: expense.entrySource,
        vendor: expense.vendor,
        receiptUrl: expense.receiptUrl,
        enteredByUserId: expense.enteredByUserId,
        submittedAt: expense.submittedAt,
        approvedById: expense.approvedById,
        approvalStatus: expense.approvalStatus,
        approvedAt: expense.approvedAt,
        rejectionReason: expense.rejectionReason,
        clientId: expense.clientId,
        projectId: expense.projectId,
        rigId: expense.rigId,
        notes: expense.notes
      },
      create: expense
    });
  }
}

async function ensureMaintenanceRequests(context: ContextMaps) {
  const maintenanceSeeds: MaintenanceSeed[] = [
    {
      key: "mr001",
      id: "mr-seed-001",
      requestCode: "MR-2026-101",
      daysAgo: 26,
      rigKey: "gf006",
      clientKey: "shanta",
      projectKey: "exploration_rc_2026",
      mechanicKey: "diesel",
      issueDescription: "Engine overheating and coolant pressure drop under load.",
      materialsNeeded: "Thermostat kit, coolant hose, fan belt set",
      urgency: UrgencyLevel.HIGH,
      photoUrls: ["/maintenance/gf006-engine-1.jpg"],
      notes: "Drilling stopped mid-shift.",
      estimatedDowntimeHrs: 18,
      status: MaintenanceStatus.SUBMITTED
    },
    {
      key: "mr002",
      id: "mr-seed-002",
      requestCode: "MR-2026-102",
      daysAgo: 24,
      rigKey: "gf003",
      clientKey: "uranium",
      projectKey: "uranium_resource_expansion",
      mechanicKey: "hydraulic",
      issueDescription: "Hydraulic hose failure near rotation head.",
      materialsNeeded: "Hydraulic hose 3/4, seal kit, oil 20L",
      urgency: UrgencyLevel.CRITICAL,
      photoUrls: ["/maintenance/gf003-hose-1.jpg", "/maintenance/gf003-hose-2.jpg"],
      estimatedDowntimeHrs: 32,
      status: MaintenanceStatus.UNDER_REVIEW
    },
    {
      key: "mr003",
      id: "mr-seed-003",
      requestCode: "MR-2026-103",
      daysAgo: 21,
      rigKey: "gf005",
      mechanicKey: "compressor",
      issueDescription: "Compressor pressure collapse after restart cycle.",
      materialsNeeded: "Valve kit, gasket pack, filter set",
      urgency: UrgencyLevel.CRITICAL,
      photoUrls: ["/maintenance/gf005-compressor-1.jpg"],
      notes: "Rig already down.",
      estimatedDowntimeHrs: 52,
      status: MaintenanceStatus.APPROVED
    },
    {
      key: "mr004",
      id: "mr-seed-004",
      requestCode: "MR-2026-104",
      daysAgo: 19,
      rigKey: "gf002",
      clientKey: "barrick",
      projectKey: "north_pit_dewatering",
      mechanicKey: "auto_electrician",
      issueDescription: "Intermittent electrical panel blackout and CAN-bus warning.",
      materialsNeeded: "Harness connector kit, sensor module",
      urgency: UrgencyLevel.MEDIUM,
      photoUrls: [],
      estimatedDowntimeHrs: 8,
      status: MaintenanceStatus.WAITING_FOR_PARTS
    },
    {
      key: "mr005",
      id: "mr-seed-005",
      requestCode: "MR-2026-105",
      daysAgo: 17,
      rigKey: "gf006",
      clientKey: "shanta",
      projectKey: "exploration_rc_2026",
      mechanicKey: "general_fitter",
      issueDescription: "Wear and tear on mast slide pads causing vibration.",
      materialsNeeded: "Slide pad set, fasteners, grease kit",
      urgency: UrgencyLevel.MEDIUM,
      photoUrls: ["/maintenance/gf006-wear-1.jpg"],
      estimatedDowntimeHrs: 10,
      status: MaintenanceStatus.IN_REPAIR
    },
    {
      key: "mr006",
      id: "mr-seed-006",
      requestCode: "MR-2026-106",
      daysAgo: 15,
      rigKey: "gf001",
      clientKey: "uranium",
      projectKey: "uranium_west_block",
      mechanicKey: "hydraulic",
      issueDescription: "Hydraulic manifold seepage during long runs.",
      materialsNeeded: "Seal ring set, hydraulic fluid",
      urgency: UrgencyLevel.LOW,
      photoUrls: [],
      estimatedDowntimeHrs: 4,
      status: MaintenanceStatus.COMPLETED
    },
    {
      key: "mr007",
      id: "mr-seed-007",
      requestCode: "MR-2026-107",
      daysAgo: 13,
      rigKey: "gf004",
      clientKey: "lakezone",
      projectKey: "lake_zone_pilot_holes",
      mechanicKey: "welder",
      issueDescription: "Cracked guard frame requiring fabrication repair.",
      materialsNeeded: "Steel plate 8mm, welding rods, primer",
      urgency: UrgencyLevel.MEDIUM,
      photoUrls: ["/maintenance/gf004-frame-1.jpg"],
      estimatedDowntimeHrs: 14,
      status: MaintenanceStatus.DENIED
    },
    {
      key: "mr008",
      id: "mr-seed-008",
      requestCode: "MR-2026-108",
      daysAgo: 11,
      rigKey: "gf007",
      clientKey: "barrick",
      projectKey: "north_mara_phase1",
      mechanicKey: "diesel",
      issueDescription: "Minor engine knock on warm start.",
      materialsNeeded: "Injector cleaning kit, filter",
      urgency: UrgencyLevel.LOW,
      photoUrls: [],
      estimatedDowntimeHrs: 2,
      status: MaintenanceStatus.SUBMITTED
    },
    {
      key: "mr009",
      id: "mr-seed-009",
      requestCode: "MR-2026-109",
      daysAgo: 9,
      rigKey: "gf003",
      clientKey: "uranium",
      projectKey: "uranium_resource_expansion",
      mechanicKey: "hydraulic",
      issueDescription: "Hydraulic pressure swings beyond tolerance.",
      materialsNeeded: "Pressure regulator, calibration kit",
      urgency: UrgencyLevel.HIGH,
      photoUrls: ["/maintenance/gf003-pressure-1.jpg"],
      estimatedDowntimeHrs: 20,
      status: MaintenanceStatus.APPROVED
    },
    {
      key: "mr010",
      id: "mr-seed-010",
      requestCode: "MR-2026-110",
      daysAgo: 7,
      rigKey: "gf006",
      clientKey: "shanta",
      projectKey: "exploration_rc_2026",
      mechanicKey: "auto_electrician",
      issueDescription: "Electrical harness burn mark detected in control cabinet.",
      materialsNeeded: "Harness set, terminal blocks",
      urgency: UrgencyLevel.HIGH,
      photoUrls: ["/maintenance/gf006-electrical-1.jpg"],
      estimatedDowntimeHrs: 16,
      status: MaintenanceStatus.UNDER_REVIEW
    },
    {
      key: "mr011",
      id: "mr-seed-011",
      requestCode: "MR-2026-111",
      daysAgo: 5,
      rigKey: "gf002",
      clientKey: "geita",
      projectKey: "east_pit_expansion",
      mechanicKey: "general_fitter",
      issueDescription: "Wear and tear on feed chain tensioner.",
      materialsNeeded: "Tensioner kit, chain links",
      urgency: UrgencyLevel.MEDIUM,
      photoUrls: [],
      estimatedDowntimeHrs: 12,
      status: MaintenanceStatus.SUBMITTED
    },
    {
      key: "mr012",
      id: "mr-seed-012",
      requestCode: "MR-2026-112",
      daysAgo: 3,
      rigKey: "gf001",
      clientKey: "anglogold",
      projectKey: "greenfield_scout_program",
      mechanicKey: "diesel",
      issueDescription: "Engine oil leak at return line coupling.",
      materialsNeeded: "Coupling set, oil seal, 15W-40 oil",
      urgency: UrgencyLevel.MEDIUM,
      photoUrls: ["/maintenance/gf001-oil-leak-1.jpg"],
      estimatedDowntimeHrs: 9,
      status: MaintenanceStatus.COMPLETED
    }
  ];

  const idMap: Record<string, string> = {};

  for (const seed of maintenanceSeeds) {
    const request = await prisma.maintenanceRequest.upsert({
      where: { requestCode: seed.requestCode },
      update: {
        requestDate: utcDaysAgo(seed.daysAgo),
        rigId: context.rigs[seed.rigKey],
        clientId: seed.clientKey ? context.clients[seed.clientKey] : null,
        projectId: seed.projectKey ? context.projects[seed.projectKey] : null,
        mechanicId: context.mechanics[seed.mechanicKey],
        issueDescription: seed.issueDescription,
        materialsNeeded: seed.materialsNeeded,
        urgency: seed.urgency,
        photoUrls: JSON.stringify(seed.photoUrls),
        notes: seed.notes ?? null,
        estimatedDowntimeHrs: seed.estimatedDowntimeHrs,
        status: seed.status
      },
      create: {
        id: seed.id,
        requestCode: seed.requestCode,
        requestDate: utcDaysAgo(seed.daysAgo),
        rigId: context.rigs[seed.rigKey],
        clientId: seed.clientKey ? context.clients[seed.clientKey] : null,
        projectId: seed.projectKey ? context.projects[seed.projectKey] : null,
        mechanicId: context.mechanics[seed.mechanicKey],
        issueDescription: seed.issueDescription,
        materialsNeeded: seed.materialsNeeded,
        urgency: seed.urgency,
        photoUrls: JSON.stringify(seed.photoUrls),
        notes: seed.notes ?? null,
        estimatedDowntimeHrs: seed.estimatedDowntimeHrs,
        status: seed.status
      }
    });

    idMap[seed.key] = request.id;
  }

  return idMap;
}

async function ensureMaintenanceUpdates(context: ContextMaps, maintenanceIds: Record<string, string>) {
  const updates = [
    {
      id: "mu-seed-001",
      maintenanceKey: "mr002",
      actor: context.users.office,
      previousStatus: MaintenanceStatus.SUBMITTED,
      newStatus: MaintenanceStatus.UNDER_REVIEW,
      note: "Office opened review and requested part availability check."
    },
    {
      id: "mu-seed-002",
      maintenanceKey: "mr003",
      actor: context.users.admin,
      previousStatus: MaintenanceStatus.UNDER_REVIEW,
      newStatus: MaintenanceStatus.APPROVED,
      note: "Critical compressor repair approved for immediate procurement."
    },
    {
      id: "mu-seed-003",
      maintenanceKey: "mr004",
      actor: context.users.office,
      previousStatus: MaintenanceStatus.APPROVED,
      newStatus: MaintenanceStatus.WAITING_FOR_PARTS,
      note: "Vendor lead time confirmed at 4 days."
    },
    {
      id: "mu-seed-004",
      maintenanceKey: "mr005",
      actor: context.users.office,
      previousStatus: MaintenanceStatus.WAITING_FOR_PARTS,
      newStatus: MaintenanceStatus.IN_REPAIR,
      note: "Workshop started physical replacement work."
    },
    {
      id: "mu-seed-005",
      maintenanceKey: "mr006",
      actor: context.users.office,
      previousStatus: MaintenanceStatus.IN_REPAIR,
      newStatus: MaintenanceStatus.COMPLETED,
      note: "Rig tested and returned to service."
    },
    {
      id: "mu-seed-006",
      maintenanceKey: "mr007",
      actor: context.users.admin,
      previousStatus: MaintenanceStatus.UNDER_REVIEW,
      newStatus: MaintenanceStatus.DENIED,
      note: "Deferred until pilot project restarts."
    },
    {
      id: "mu-seed-007",
      maintenanceKey: "mr009",
      actor: context.users.admin,
      previousStatus: MaintenanceStatus.UNDER_REVIEW,
      newStatus: MaintenanceStatus.APPROVED,
      note: "Approved under urgent hydraulic reliability budget."
    },
    {
      id: "mu-seed-008",
      maintenanceKey: "mr012",
      actor: context.users.office,
      previousStatus: MaintenanceStatus.IN_REPAIR,
      newStatus: MaintenanceStatus.COMPLETED,
      note: "Leak test passed after seal and coupling replacement."
    }
  ] as const;

  for (const update of updates) {
    const maintenanceId = maintenanceIds[update.maintenanceKey];
    if (!maintenanceId) {
      continue;
    }
    await prisma.maintenanceUpdate.upsert({
      where: { id: update.id },
      update: {
        maintenanceId,
        actorUserId: update.actor,
        previousStatus: update.previousStatus,
        newStatus: update.newStatus,
        updateNote: update.note
      },
      create: {
        id: update.id,
        maintenanceId,
        actorUserId: update.actor,
        previousStatus: update.previousStatus,
        newStatus: update.newStatus,
        updateNote: update.note
      }
    });
  }
}

async function ensureMaintenanceApprovals(context: ContextMaps, maintenanceIds: Record<string, string>) {
  const approvals = [
    {
      id: "app-seed-001",
      maintenanceKey: "mr003",
      approverId: context.users.admin,
      decision: ApprovalDecision.APPROVED,
      note: "Critical breakdown approved."
    },
    {
      id: "app-seed-002",
      maintenanceKey: "mr007",
      approverId: context.users.admin,
      decision: ApprovalDecision.DENIED,
      note: "Deferred until pilot restarts."
    },
    {
      id: "app-seed-003",
      maintenanceKey: "mr009",
      approverId: context.users.office,
      decision: ApprovalDecision.APPROVED,
      note: "Approved with expedited procurement."
    },
    {
      id: "app-seed-004",
      maintenanceKey: "mr010",
      approverId: context.users.office,
      decision: ApprovalDecision.NEEDS_INFO,
      note: "Need updated photo and wiring diagram."
    }
  ] as const;

  for (const approval of approvals) {
    const maintenanceId = maintenanceIds[approval.maintenanceKey];
    if (!maintenanceId) {
      continue;
    }
    await prisma.approval.upsert({
      where: { id: approval.id },
      update: {
        maintenanceId,
        approverId: approval.approverId,
        decision: approval.decision,
        note: approval.note
      },
      create: {
        id: approval.id,
        maintenanceId,
        approverId: approval.approverId,
        decision: approval.decision,
        note: approval.note
      }
    });
  }
}

async function ensureInventorySuppliers() {
  const supplierIds: Record<string, string> = {};

  for (const supplierSeed of INVENTORY_SUPPLIER_SEEDS) {
    const supplier = await prisma.inventorySupplier.upsert({
      where: { name: supplierSeed.name },
      update: {
        contactPerson: supplierSeed.contactPerson ?? null,
        email: supplierSeed.email ?? null,
        phone: supplierSeed.phone ?? null,
        notes: supplierSeed.notes ?? null,
        isActive: true
      },
      create: {
        id: supplierSeed.id,
        name: supplierSeed.name,
        contactPerson: supplierSeed.contactPerson ?? null,
        email: supplierSeed.email ?? null,
        phone: supplierSeed.phone ?? null,
        notes: supplierSeed.notes ?? null,
        isActive: true
      }
    });
    supplierIds[supplierSeed.key] = supplier.id;
  }

  return supplierIds;
}

async function ensureInventoryLocations() {
  const locationIds: Record<string, string> = {};

  for (const locationSeed of INVENTORY_LOCATION_SEEDS) {
    const location = await prisma.inventoryLocation.upsert({
      where: { name: locationSeed.name },
      update: {
        description: locationSeed.description ?? null,
        isActive: true
      },
      create: {
        id: locationSeed.id,
        name: locationSeed.name,
        description: locationSeed.description ?? null,
        isActive: true
      }
    });
    locationIds[locationSeed.key] = location.id;
  }

  return locationIds;
}

async function ensureInventoryItems(context: ContextMaps) {
  const itemIds: Record<string, string> = {};

  for (const itemSeed of INVENTORY_ITEM_SEEDS) {
    const item = await prisma.inventoryItem.upsert({
      where: { sku: itemSeed.sku },
      update: {
        name: itemSeed.name,
        category: itemSeed.category,
        description: itemSeed.description ?? null,
        quantityInStock: itemSeed.quantityInStock,
        minimumStockLevel: itemSeed.minimumStockLevel,
        unitCost: itemSeed.unitCost,
        supplierId: itemSeed.supplierKey ? context.inventorySuppliers[itemSeed.supplierKey] : null,
        locationId: itemSeed.locationKey ? context.inventoryLocations[itemSeed.locationKey] : null,
        compatibleRigId: itemSeed.compatibleRigKey ? context.rigs[itemSeed.compatibleRigKey] : null,
        compatibleRigType: itemSeed.compatibleRigType ?? null,
        partNumber: itemSeed.partNumber ?? null,
        status: itemSeed.status,
        notes: itemSeed.notes ?? null
      },
      create: {
        id: itemSeed.id,
        name: itemSeed.name,
        sku: itemSeed.sku,
        category: itemSeed.category,
        description: itemSeed.description ?? null,
        quantityInStock: itemSeed.quantityInStock,
        minimumStockLevel: itemSeed.minimumStockLevel,
        unitCost: itemSeed.unitCost,
        supplierId: itemSeed.supplierKey ? context.inventorySuppliers[itemSeed.supplierKey] : null,
        locationId: itemSeed.locationKey ? context.inventoryLocations[itemSeed.locationKey] : null,
        compatibleRigId: itemSeed.compatibleRigKey ? context.rigs[itemSeed.compatibleRigKey] : null,
        compatibleRigType: itemSeed.compatibleRigType ?? null,
        partNumber: itemSeed.partNumber ?? null,
        status: itemSeed.status,
        notes: itemSeed.notes ?? null
      }
    });
    itemIds[itemSeed.key] = item.id;
  }

  return itemIds;
}

async function ensureInventoryMovements(context: ContextMaps, maintenanceIds: Record<string, string>) {
  for (const movementSeed of INVENTORY_MOVEMENT_SEEDS) {
    const movementDate = utcDaysAgo(movementSeed.daysAgo);
    const quantity = roundCurrency(movementSeed.quantity);
    const itemId = context.inventoryItems[movementSeed.itemKey];
    const clientId = movementSeed.clientKey ? context.clients[movementSeed.clientKey] : null;
    const projectId = movementSeed.projectKey ? context.projects[movementSeed.projectKey] : null;
    const rigId = movementSeed.rigKey ? context.rigs[movementSeed.rigKey] : null;
    const maintenanceId = movementSeed.maintenanceKey ? maintenanceIds[movementSeed.maintenanceKey] : null;
    const supplierId = movementSeed.supplierKey ? context.inventorySuppliers[movementSeed.supplierKey] : null;
    const locationFromId = movementSeed.locationFromKey ? context.inventoryLocations[movementSeed.locationFromKey] : null;
    const locationToId = movementSeed.locationToKey ? context.inventoryLocations[movementSeed.locationToKey] : null;

    const unitCost = movementSeed.unitCost ?? null;
    const totalCost =
      movementSeed.totalCost !== undefined
        ? roundCurrency(movementSeed.totalCost)
        : unitCost !== null
          ? roundCurrency(Math.abs(quantity) * unitCost)
          : null;

    await prisma.inventoryMovement.upsert({
      where: { id: movementSeed.id },
      update: {
        itemId,
        movementType: movementSeed.movementType,
        quantity,
        unitCost,
        totalCost,
        date: movementDate,
        performedByUserId: context.users.office,
        clientId,
        rigId,
        projectId,
        maintenanceRequestId: maintenanceId,
        expenseId: movementSeed.expenseId ?? null,
        supplierId,
        locationFromId,
        locationToId,
        traReceiptNumber: movementSeed.traReceiptNumber ?? null,
        supplierInvoiceNumber: movementSeed.supplierInvoiceNumber ?? null,
        receiptUrl: movementSeed.receiptUrl ?? null,
        receiptFileName: movementSeed.receiptUrl ? movementSeed.receiptUrl.split("/").pop() || null : null,
        notes: movementSeed.notes ?? null
      },
      create: {
        id: movementSeed.id,
        itemId,
        movementType: movementSeed.movementType,
        quantity,
        unitCost,
        totalCost,
        date: movementDate,
        performedByUserId: context.users.office,
        clientId,
        rigId,
        projectId,
        maintenanceRequestId: maintenanceId,
        expenseId: movementSeed.expenseId ?? null,
        supplierId,
        locationFromId,
        locationToId,
        traReceiptNumber: movementSeed.traReceiptNumber ?? null,
        supplierInvoiceNumber: movementSeed.supplierInvoiceNumber ?? null,
        receiptUrl: movementSeed.receiptUrl ?? null,
        receiptFileName: movementSeed.receiptUrl ? movementSeed.receiptUrl.split("/").pop() || null : null,
        notes: movementSeed.notes ?? null
      }
    });
  }
}

async function ensureInspections(context: ContextMaps) {
  const inspectionSeeds = [
    {
      id: "insp-seed-001",
      rigKey: "gf007",
      mechanicKey: "diesel",
      daysAgo: 28,
      condition: RigCondition.EXCELLENT,
      score: 94,
      findings: "Rig in strong condition with stable operating pressure.",
      actions: "Continue weekly preventive checks."
    },
    {
      id: "insp-seed-002",
      rigKey: "gf006",
      mechanicKey: "hydraulic",
      daysAgo: 22,
      condition: RigCondition.FAIR,
      score: 63,
      findings: "Frequent hydraulic instability and wear on feed chain.",
      actions: "Prioritize hydraulic rebuild and tensioner replacement."
    },
    {
      id: "insp-seed-003",
      rigKey: "gf003",
      mechanicKey: "hydraulic",
      daysAgo: 20,
      condition: RigCondition.POOR,
      score: 48,
      findings: "Hydraulic pressure drop and hose fatigue observed.",
      actions: "Full hose replacement and pressure regulation service."
    },
    {
      id: "insp-seed-004",
      rigKey: "gf002",
      mechanicKey: "auto_electrician",
      daysAgo: 16,
      condition: RigCondition.GOOD,
      score: 86,
      findings: "Overall performance healthy, minor panel signal noise.",
      actions: "Monitor CAN-bus with next scheduled electrical service."
    },
    {
      id: "insp-seed-005",
      rigKey: "gf005",
      mechanicKey: "compressor",
      daysAgo: 14,
      condition: RigCondition.CRITICAL,
      score: 34,
      findings: "Compressor failure and pressure retention loss.",
      actions: "Complete compressor overhaul before redeployment."
    },
    {
      id: "insp-seed-006",
      rigKey: "gf001",
      mechanicKey: "general_fitter",
      daysAgo: 9,
      condition: RigCondition.GOOD,
      score: 82,
      findings: "No severe structural issues. Minor oil seepage.",
      actions: "Replace return line coupling at next maintenance window."
    },
    {
      id: "insp-seed-007",
      rigKey: "gf004",
      mechanicKey: "welder",
      daysAgo: 7,
      condition: RigCondition.FAIR,
      score: 68,
      findings: "Idle rig with frame stress marks at guard mount.",
      actions: "Fabrication patch recommended before reactivation."
    }
  ] as const;

  for (const inspection of inspectionSeeds) {
    await prisma.inspection.upsert({
      where: { id: inspection.id },
      update: {
        rigId: context.rigs[inspection.rigKey],
        mechanicId: context.mechanics[inspection.mechanicKey],
        inspectionDate: utcDaysAgo(inspection.daysAgo),
        condition: inspection.condition,
        conditionScore: inspection.score,
        findings: inspection.findings,
        recommendedActions: inspection.actions
      },
      create: {
        id: inspection.id,
        rigId: context.rigs[inspection.rigKey],
        mechanicId: context.mechanics[inspection.mechanicKey],
        inspectionDate: utcDaysAgo(inspection.daysAgo),
        condition: inspection.condition,
        conditionScore: inspection.score,
        findings: inspection.findings,
        recommendedActions: inspection.actions
      }
    });
  }
}

async function ensureBreakdownReports(context: ContextMaps) {
  const breakdownSeeds = [
    {
      id: "bd-seed-001",
      daysAgo: 33,
      rigKey: "gf006",
      projectKey: "exploration_rc_2026",
      clientKey: "shanta",
      title: "Hydraulic pressure drop during drilling",
      description: "Pressure fluctuates under heavy penetration load.",
      severity: UrgencyLevel.HIGH,
      downtimeHours: 4,
      status: "SUBMITTED"
    },
    {
      id: "bd-seed-002",
      daysAgo: 28,
      rigKey: "gf003",
      projectKey: "uranium_resource_expansion",
      clientKey: "uranium",
      title: "Hose rupture near mast",
      description: "Hydraulic hose ruptured during setup phase.",
      severity: UrgencyLevel.CRITICAL,
      downtimeHours: 11,
      status: "SUBMITTED"
    },
    {
      id: "bd-seed-003",
      daysAgo: 21,
      rigKey: "gf002",
      projectKey: "north_pit_dewatering",
      clientKey: "barrick",
      title: "Electrical panel communication fault",
      description: "CAN bus fault triggered intermittent sensor loss.",
      severity: UrgencyLevel.MEDIUM,
      downtimeHours: 2,
      status: "UNDER_REVIEW"
    },
    {
      id: "bd-seed-004",
      daysAgo: 18,
      rigKey: "gf005",
      projectKey: "uranium_west_block",
      clientKey: "uranium",
      title: "Compressor shutdown event",
      description: "Compressor failed to hold pressure after restart.",
      severity: UrgencyLevel.CRITICAL,
      downtimeHours: 14,
      status: "IN_PROGRESS"
    },
    {
      id: "bd-seed-005",
      daysAgo: 14,
      rigKey: "gf007",
      projectKey: "north_mara_phase1",
      clientKey: "barrick",
      title: "Minor engine vibration spike",
      description: "Vibration spike observed at warm start only.",
      severity: UrgencyLevel.LOW,
      downtimeHours: 1,
      status: "SUBMITTED"
    },
    {
      id: "bd-seed-006",
      daysAgo: 10,
      rigKey: "gf001",
      projectKey: "uranium_west_block",
      clientKey: "uranium",
      title: "Oil return coupling leak",
      description: "Slow leak from return coupling connection.",
      severity: UrgencyLevel.MEDIUM,
      downtimeHours: 3,
      status: "RESOLVED"
    },
    {
      id: "bd-seed-007",
      daysAgo: 6,
      rigKey: "gf002",
      projectKey: "east_pit_expansion",
      clientKey: "geita",
      title: "Feed chain tension drop",
      description: "Chain tension reduced below operating threshold.",
      severity: UrgencyLevel.MEDIUM,
      downtimeHours: 5,
      status: "SUBMITTED"
    },
    {
      id: "bd-seed-008",
      daysAgo: 3,
      rigKey: "gf004",
      projectKey: "lake_zone_pilot_holes",
      clientKey: "lakezone",
      title: "Guard frame crack observed",
      description: "Structural crack on idle rig frame guard mount.",
      severity: UrgencyLevel.MEDIUM,
      downtimeHours: 7,
      status: "SUBMITTED"
    }
  ] as const;

  for (const breakdown of breakdownSeeds) {
    await prisma.breakdownReport.upsert({
      where: { id: breakdown.id },
      update: {
        reportDate: utcDaysAgo(breakdown.daysAgo),
        reportedById: context.users.field,
        rigId: context.rigs[breakdown.rigKey],
        projectId: context.projects[breakdown.projectKey],
        clientId: context.clients[breakdown.clientKey],
        title: breakdown.title,
        description: breakdown.description,
        severity: breakdown.severity,
        downtimeHours: breakdown.downtimeHours,
        status: breakdown.status
      },
      create: {
        id: breakdown.id,
        reportDate: utcDaysAgo(breakdown.daysAgo),
        reportedById: context.users.field,
        rigId: context.rigs[breakdown.rigKey],
        projectId: context.projects[breakdown.projectKey],
        clientId: context.clients[breakdown.clientKey],
        title: breakdown.title,
        description: breakdown.description,
        severity: breakdown.severity,
        downtimeHours: breakdown.downtimeHours,
        status: breakdown.status
      }
    });
  }
}

async function ensureSummaryReports(context: ContextMaps) {
  const summarySeeds = [
    {
      id: "sum-seed-monthly-01",
      daysAgo: 60,
      type: "MONTHLY",
      payload: {
        window: "Last 30 days",
        focusClient: "Barrick North Mara",
        note: "Revenue trend recovered after mid-window dip."
      }
    },
    {
      id: "sum-seed-monthly-02",
      daysAgo: 30,
      type: "MONTHLY",
      payload: {
        window: "Last 30 days",
        focusRig: "GF-RIG-007",
        note: "Fuel remained largest cost driver."
      }
    },
    {
      id: "sum-seed-weekly-01",
      daysAgo: 7,
      type: "WEEKLY",
      payload: {
        pendingApprovalsHint: "Submitted drilling and maintenance items available for review.",
        weakProject: "Exploration RC 2026",
        topProject: "North Mara Phase 1"
      }
    }
  ] as const;

  for (const summary of summarySeeds) {
    await prisma.summaryReport.upsert({
      where: { id: summary.id },
      update: {
        reportDate: utcDaysAgo(summary.daysAgo),
        reportType: summary.type,
        generatedById: context.users.office,
        payloadJson: JSON.stringify(summary.payload)
      },
      create: {
        id: summary.id,
        reportDate: utcDaysAgo(summary.daysAgo),
        reportType: summary.type,
        generatedById: context.users.office,
        payloadJson: JSON.stringify(summary.payload)
      }
    });
  }
}

async function printCoverageSummary() {
  const ninetyDaysAgo = utcDaysAgo(90);

  const [
    users,
    clients,
    projects,
    rigs,
    reports,
    expenses,
    maintenance,
    approvedReports,
    submittedReports,
    draftReports,
    rejectedReports,
    seedManagedReportCount,
    seedManagedExpenseCount,
    seedManagedMaintenanceCount,
    inventoryItemCount,
    inventoryMovementCount,
    lowStockInventoryCount,
    outOfStockInventoryCount
  ] = await Promise.all([
    prisma.user.count(),
    prisma.client.count(),
    prisma.project.count(),
    prisma.rig.count(),
    prisma.drillReport.count({
      where: {
        date: {
          gte: ninetyDaysAgo
        }
      }
    }),
    prisma.expense.count({
      where: {
        date: {
          gte: ninetyDaysAgo
        }
      }
    }),
    prisma.maintenanceRequest.count(),
    prisma.drillReport.count({ where: { approvalStatus: "APPROVED" } }),
    prisma.drillReport.count({ where: { approvalStatus: "SUBMITTED" } }),
    prisma.drillReport.count({ where: { approvalStatus: "DRAFT" } }),
    prisma.drillReport.count({ where: { approvalStatus: "REJECTED" } }),
    prisma.drillReport.count({ where: { id: { startsWith: "dr-seed-" } } }),
    prisma.expense.count({ where: { id: { startsWith: "exp-seed-" } } }),
    prisma.maintenanceRequest.count({ where: { requestCode: { startsWith: "MR-2026-1" } } }),
    prisma.inventoryItem.count(),
    prisma.inventoryMovement.count(),
    prisma.inventoryItem.count({
      where: {
        quantityInStock: {
          gt: 0
        }
      }
    }),
    prisma.inventoryItem.count({
      where: {
        quantityInStock: {
          lte: 0
        }
      }
    })
  ]);

  console.log(
    JSON.stringify(
      {
        seededCoverage: {
          users,
          clients,
          projects,
          rigs,
          reportsLast90Days: reports,
          expensesLast90Days: expenses,
          maintenanceRequests: maintenance,
          inventoryItems: inventoryItemCount,
          inventoryMovements: inventoryMovementCount
        },
        seedManagedRecords: {
          drillReports: seedManagedReportCount,
          expenses: seedManagedExpenseCount,
          maintenanceRequests: seedManagedMaintenanceCount,
          inventoryItems: INVENTORY_ITEM_SEEDS.length,
          inventoryMovements: INVENTORY_MOVEMENT_SEEDS.length
        },
        drillingReportStatusMix: {
          approved: approvedReports,
          submitted: submittedReports,
          draft: draftReports,
          rejected: rejectedReports
        },
        inventoryStatusMix: {
          lowStockCandidates: lowStockInventoryCount,
          outOfStock: outOfStockInventoryCount
        }
      },
      null,
      2
    )
  );
}

function resolveReportStatus(index: number): EntryApprovalStatus {
  if (index % 15 === 0) {
    return "DRAFT";
  }
  if (index % 9 === 0) {
    return "REJECTED";
  }
  if (index % 5 === 0) {
    return "SUBMITTED";
  }
  return "APPROVED";
}

function resolveExpenseStatus(index: number): EntryApprovalStatus {
  if (index % 17 === 0) {
    return "REJECTED";
  }
  if (index % 11 === 0) {
    return "DRAFT";
  }
  if (index % 7 === 0) {
    return "SUBMITTED";
  }
  return "APPROVED";
}

function utcDaysAgo(daysAgo: number) {
  const now = new Date();
  const utcStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return new Date(utcStart - daysAgo * DAY_MS);
}

function addHoursUtc(date: Date, hours: number) {
  return new Date(date.getTime() + hours * 60 * 60 * 1000);
}

function roundCurrency(value: number) {
  return Math.round(value * 100) / 100;
}

function round1(value: number) {
  return Math.round(value * 10) / 10;
}

function pad3(value: number) {
  return String(value).padStart(3, "0");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
