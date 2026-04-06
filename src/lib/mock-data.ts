import type {
  Client,
  DrillReport,
  ExpenseEntry,
  ForecastPoint,
  MaintenanceRequest,
  Mechanic,
  Project,
  RevenueEntry,
  Rig
} from "@/lib/types";

export const clients: Client[] = [
  {
    id: "cli-barrick",
    name: "Barrick North Mara",
    contactPerson: "L. Msigwa",
    segment: "Gold Mining",
    activeProjects: 2
  },
  {
    id: "cli-geita",
    name: "Geita Gold Mine",
    contactPerson: "R. Mwakalila",
    segment: "Gold Mining",
    activeProjects: 1
  },
  {
    id: "cli-shanta",
    name: "Shanta Mining",
    contactPerson: "M. Komba",
    segment: "Mining Services",
    activeProjects: 1
  },
  {
    id: "cli-uranium",
    name: "Tanzania Uranium JV",
    contactPerson: "P. Nyerere",
    segment: "Exploration",
    activeProjects: 1
  }
];

export const rigs: Rig[] = [
  {
    id: "rig-gf001",
    rigCode: "GF-RIG-001",
    model: "Atlas Copco ROC D7",
    serialNumber: "AC-D7-2210",
    acquisitionDate: "2020-02-15",
    status: "ACTIVE",
    condition: "GOOD",
    conditionScore: 84,
    totalHoursWorked: 12450,
    totalLifetimeDaysUsed: 1365
  },
  {
    id: "rig-gf002",
    rigCode: "GF-RIG-002",
    model: "Sandvik Pantera DP1100",
    serialNumber: "SV-DP-1932",
    acquisitionDate: "2019-08-03",
    status: "ACTIVE",
    condition: "EXCELLENT",
    conditionScore: 92,
    totalHoursWorked: 14990,
    totalLifetimeDaysUsed: 1580
  },
  {
    id: "rig-gf003",
    rigCode: "GF-RIG-003",
    model: "Epiroc SmartROC T45",
    serialNumber: "EP-T45-4521",
    acquisitionDate: "2021-01-22",
    status: "MAINTENANCE",
    condition: "FAIR",
    conditionScore: 61,
    totalHoursWorked: 9950,
    totalLifetimeDaysUsed: 1092
  },
  {
    id: "rig-gf004",
    rigCode: "GF-RIG-004",
    model: "Ingersoll Rand DM45",
    serialNumber: "IR-DM-0903",
    acquisitionDate: "2018-05-19",
    status: "IDLE",
    condition: "GOOD",
    conditionScore: 76,
    totalHoursWorked: 13030,
    totalLifetimeDaysUsed: 1461
  },
  {
    id: "rig-gf005",
    rigCode: "GF-RIG-005",
    model: "Furukawa HCR1500",
    serialNumber: "FU-HCR-8241",
    acquisitionDate: "2017-10-11",
    status: "BREAKDOWN",
    condition: "POOR",
    conditionScore: 42,
    totalHoursWorked: 16780,
    totalLifetimeDaysUsed: 1820
  },
  {
    id: "rig-gf006",
    rigCode: "GF-RIG-006",
    model: "Epiroc FlexiROC D65",
    serialNumber: "EP-D65-7220",
    acquisitionDate: "2022-06-01",
    status: "ACTIVE",
    condition: "GOOD",
    conditionScore: 88,
    totalHoursWorked: 6550,
    totalLifetimeDaysUsed: 720
  }
];

export const projects: Project[] = [
  {
    id: "prj-north-pit",
    name: "North Pit Dewatering Program",
    clientId: "cli-barrick",
    location: "Mara Region",
    startDate: "2025-07-01",
    endDate: null,
    status: "ACTIVE",
    assignedRigId: "rig-gf002",
    backupRigId: "rig-gf004",
    contractRatePerMeter: 95
  },
  {
    id: "prj-east-expansion",
    name: "East Pit Expansion RC Drilling",
    clientId: "cli-barrick",
    location: "Tarime",
    startDate: "2025-09-15",
    endDate: null,
    status: "ACTIVE",
    assignedRigId: "rig-gf001",
    backupRigId: "rig-gf006",
    contractRatePerMeter: 105
  },
  {
    id: "prj-geita-grade",
    name: "Grade Control Phase II",
    clientId: "cli-geita",
    location: "Geita",
    startDate: "2025-10-03",
    endDate: null,
    status: "ACTIVE",
    assignedRigId: "rig-gf006",
    backupRigId: null,
    contractRatePerMeter: 88
  },
  {
    id: "prj-shanta-water",
    name: "Hydro Borehole Water Program",
    clientId: "cli-shanta",
    location: "Singida",
    startDate: "2025-11-20",
    endDate: null,
    status: "ON_HOLD",
    assignedRigId: "rig-gf004",
    backupRigId: null,
    contractRatePerMeter: 72
  },
  {
    id: "prj-uranium-explore",
    name: "Uranium Block C Exploration",
    clientId: "cli-uranium",
    location: "Namtumbo",
    startDate: "2025-06-10",
    endDate: null,
    status: "ACTIVE",
    assignedRigId: "rig-gf003",
    backupRigId: "rig-gf005",
    contractRatePerMeter: 120
  },
  {
    id: "prj-geita-historic",
    name: "Pit 5 Resource Delineation",
    clientId: "cli-geita",
    location: "Geita",
    startDate: "2024-11-01",
    endDate: "2025-04-20",
    status: "COMPLETED",
    assignedRigId: "rig-gf001",
    backupRigId: null,
    contractRatePerMeter: 80
  }
];

export const drillReports: DrillReport[] = [
  {
    id: "dr-001",
    date: "2026-01-03",
    clientId: "cli-barrick",
    projectId: "prj-east-expansion",
    rigId: "rig-gf001",
    holeNumber: "EP-119",
    location: "Block E2",
    fromMeter: 0,
    toMeter: 54,
    totalMetersDrilled: 54,
    workHours: 10.5,
    rigMoves: 1,
    standbyHours: 0.5,
    delayHours: 1,
    operatorCrew: "Crew A",
    billableActivityAmount: 5670,
    comments: "Stable formation, no major delay."
  },
  {
    id: "dr-002",
    date: "2026-01-03",
    clientId: "cli-barrick",
    projectId: "prj-north-pit",
    rigId: "rig-gf002",
    holeNumber: "NP-312",
    location: "Zone N4",
    fromMeter: 0,
    toMeter: 67,
    totalMetersDrilled: 67,
    workHours: 11,
    rigMoves: 2,
    standbyHours: 0.2,
    delayHours: 0.8,
    operatorCrew: "Crew C",
    billableActivityAmount: 6365,
    comments: "High productivity day."
  },
  {
    id: "dr-003",
    date: "2026-01-04",
    clientId: "cli-geita",
    projectId: "prj-geita-grade",
    rigId: "rig-gf006",
    holeNumber: "GC-210",
    location: "Bench 7",
    fromMeter: 0,
    toMeter: 49,
    totalMetersDrilled: 49,
    workHours: 9.3,
    rigMoves: 1,
    standbyHours: 0.7,
    delayHours: 2,
    operatorCrew: "Crew B",
    billableActivityAmount: 4312,
    comments: "Rain delay for about 2 hours."
  },
  {
    id: "dr-004",
    date: "2026-01-04",
    clientId: "cli-uranium",
    projectId: "prj-uranium-explore",
    rigId: "rig-gf003",
    holeNumber: "UC-089",
    location: "Grid C",
    fromMeter: 40,
    toMeter: 88,
    totalMetersDrilled: 48,
    workHours: 8.4,
    rigMoves: 0,
    standbyHours: 1.5,
    delayHours: 2.1,
    operatorCrew: "Crew D",
    billableActivityAmount: 5760,
    comments: "Hydraulic pressure issue under inspection."
  },
  {
    id: "dr-005",
    date: "2026-02-01",
    clientId: "cli-barrick",
    projectId: "prj-east-expansion",
    rigId: "rig-gf001",
    holeNumber: "EP-131",
    location: "Block E5",
    fromMeter: 0,
    toMeter: 61,
    totalMetersDrilled: 61,
    workHours: 10.7,
    rigMoves: 1,
    standbyHours: 0.3,
    delayHours: 1.2,
    operatorCrew: "Crew A",
    billableActivityAmount: 6405,
    comments: "Normal shift."
  },
  {
    id: "dr-006",
    date: "2026-02-01",
    clientId: "cli-geita",
    projectId: "prj-geita-grade",
    rigId: "rig-gf006",
    holeNumber: "GC-244",
    location: "Bench 8",
    fromMeter: 0,
    toMeter: 52,
    totalMetersDrilled: 52,
    workHours: 9.8,
    rigMoves: 1,
    standbyHours: 0.6,
    delayHours: 1.1,
    operatorCrew: "Crew B",
    billableActivityAmount: 4576,
    comments: "Better weather."
  },
  {
    id: "dr-007",
    date: "2026-03-04",
    clientId: "cli-barrick",
    projectId: "prj-north-pit",
    rigId: "rig-gf002",
    holeNumber: "NP-401",
    location: "Zone N7",
    fromMeter: 0,
    toMeter: 72,
    totalMetersDrilled: 72,
    workHours: 11.4,
    rigMoves: 2,
    standbyHours: 0.3,
    delayHours: 0.4,
    operatorCrew: "Crew C",
    billableActivityAmount: 6840,
    comments: "Strong output."
  },
  {
    id: "dr-008",
    date: "2026-03-05",
    clientId: "cli-barrick",
    projectId: "prj-east-expansion",
    rigId: "rig-gf001",
    holeNumber: "EP-142",
    location: "Block E9",
    fromMeter: 0,
    toMeter: 58,
    totalMetersDrilled: 58,
    workHours: 10,
    rigMoves: 1,
    standbyHours: 0.4,
    delayHours: 1.1,
    operatorCrew: "Crew A",
    billableActivityAmount: 6090,
    comments: "Drill string replacement at noon."
  }
];

export const revenues: RevenueEntry[] = [
  { id: "rev-jan-1", date: "2026-01-31", clientId: "cli-barrick", projectId: "prj-north-pit", rigId: "rig-gf002", amount: 104000, category: "Meters Drilled" },
  { id: "rev-jan-2", date: "2026-01-31", clientId: "cli-barrick", projectId: "prj-east-expansion", rigId: "rig-gf001", amount: 98000, category: "Meters Drilled" },
  { id: "rev-jan-3", date: "2026-01-31", clientId: "cli-geita", projectId: "prj-geita-grade", rigId: "rig-gf006", amount: 76000, category: "Meters Drilled" },
  { id: "rev-jan-4", date: "2026-01-31", clientId: "cli-uranium", projectId: "prj-uranium-explore", rigId: "rig-gf003", amount: 86000, category: "Meters Drilled" },
  { id: "rev-feb-1", date: "2026-02-28", clientId: "cli-barrick", projectId: "prj-north-pit", rigId: "rig-gf002", amount: 111000, category: "Meters Drilled" },
  { id: "rev-feb-2", date: "2026-02-28", clientId: "cli-barrick", projectId: "prj-east-expansion", rigId: "rig-gf001", amount: 101000, category: "Meters Drilled" },
  { id: "rev-feb-3", date: "2026-02-28", clientId: "cli-geita", projectId: "prj-geita-grade", rigId: "rig-gf006", amount: 79000, category: "Meters Drilled" },
  { id: "rev-feb-4", date: "2026-02-28", clientId: "cli-uranium", projectId: "prj-uranium-explore", rigId: "rig-gf003", amount: 69000, category: "Meters Drilled" },
  { id: "rev-mar-1", date: "2026-03-31", clientId: "cli-barrick", projectId: "prj-north-pit", rigId: "rig-gf002", amount: 118000, category: "Meters Drilled" },
  { id: "rev-mar-2", date: "2026-03-31", clientId: "cli-barrick", projectId: "prj-east-expansion", rigId: "rig-gf001", amount: 108000, category: "Meters Drilled" },
  { id: "rev-mar-3", date: "2026-03-31", clientId: "cli-geita", projectId: "prj-geita-grade", rigId: "rig-gf006", amount: 84000, category: "Meters Drilled" },
  { id: "rev-mar-4", date: "2026-03-31", clientId: "cli-uranium", projectId: "prj-uranium-explore", rigId: "rig-gf003", amount: 72000, category: "Meters Drilled" },
  { id: "rev-mar-5", date: "2026-03-31", clientId: "cli-shanta", projectId: "prj-shanta-water", rigId: "rig-gf004", amount: 25000, category: "Demobilization" }
];

export const expenses: ExpenseEntry[] = [
  { id: "exp-jan-1", date: "2026-01-31", clientId: null, projectId: null, rigId: null, category: "Salaries", amount: 64000, notes: "Monthly payroll" },
  { id: "exp-jan-2", date: "2026-01-31", clientId: "cli-barrick", projectId: "prj-east-expansion", rigId: "rig-gf001", category: "Fuel", amount: 18200, notes: "Rig and support trucks" },
  { id: "exp-jan-3", date: "2026-01-31", clientId: "cli-barrick", projectId: "prj-north-pit", rigId: "rig-gf002", category: "Fuel", amount: 19100, notes: "High shift days" },
  { id: "exp-jan-4", date: "2026-01-31", clientId: "cli-geita", projectId: "prj-geita-grade", rigId: "rig-gf006", category: "Hammer Oil", amount: 7200, notes: "Consumables" },
  { id: "exp-jan-5", date: "2026-01-31", clientId: "cli-uranium", projectId: "prj-uranium-explore", rigId: "rig-gf003", category: "Maintenance Costs", amount: 14800, notes: "Hydraulic troubleshooting" },
  { id: "exp-feb-1", date: "2026-02-28", clientId: null, projectId: null, rigId: null, category: "Salaries", amount: 64000, notes: "Monthly payroll" },
  { id: "exp-feb-2", date: "2026-02-28", clientId: "cli-barrick", projectId: "prj-east-expansion", rigId: "rig-gf001", category: "Fuel", amount: 17500, notes: "Fuel reduction from route optimization" },
  { id: "exp-feb-3", date: "2026-02-28", clientId: "cli-barrick", projectId: "prj-north-pit", rigId: "rig-gf002", category: "RC Bits", amount: 11200, notes: "New bit set" },
  { id: "exp-feb-4", date: "2026-02-28", clientId: "cli-geita", projectId: "prj-geita-grade", rigId: "rig-gf006", category: "Camp Fuel", amount: 6400, notes: "Generator and camp logistics" },
  { id: "exp-feb-5", date: "2026-02-28", clientId: "cli-uranium", projectId: "prj-uranium-explore", rigId: "rig-gf003", category: "Hydraulic Oil", amount: 9400, notes: "Top-up and replacement" },
  { id: "exp-mar-1", date: "2026-03-31", clientId: null, projectId: null, rigId: null, category: "Salaries", amount: 66000, notes: "Overtime month" },
  { id: "exp-mar-2", date: "2026-03-31", clientId: "cli-barrick", projectId: "prj-east-expansion", rigId: "rig-gf001", category: "Fuel", amount: 20400, notes: "Longer hauls" },
  { id: "exp-mar-3", date: "2026-03-31", clientId: "cli-barrick", projectId: "prj-north-pit", rigId: "rig-gf002", category: "Maintenance Costs", amount: 15300, notes: "Compressor service" },
  { id: "exp-mar-4", date: "2026-03-31", clientId: "cli-geita", projectId: "prj-geita-grade", rigId: "rig-gf006", category: "Food", amount: 8100, notes: "Camp support" },
  { id: "exp-mar-5", date: "2026-03-31", clientId: "cli-uranium", projectId: "prj-uranium-explore", rigId: "rig-gf003", category: "Rentals", amount: 7300, notes: "Auxiliary compressor rental" },
  { id: "exp-mar-6", date: "2026-03-31", clientId: null, projectId: null, rigId: "rig-gf005", category: "Maintenance Costs", amount: 12900, notes: "Breakdown recovery estimate" }
];

export const mechanics: Mechanic[] = [
  {
    id: "mech-001",
    name: "Daniel Mlay",
    specialization: "Hydraulic Mechanic",
    phone: "+255 754 100 101",
    email: "d.mlay@geofields.co.tz",
    profileImage: "/mechanics/daniel-mlay.jpg",
    currentAssignment: "GF-RIG-003",
    status: "ON_JOB"
  },
  {
    id: "mech-002",
    name: "Asha Mushi",
    specialization: "Auto Electrician",
    phone: "+255 754 100 102",
    email: "a.mushi@geofields.co.tz",
    profileImage: "/mechanics/asha-mushi.jpg",
    currentAssignment: "Workshop Bay 2",
    status: "AVAILABLE"
  },
  {
    id: "mech-003",
    name: "Hassan Mrope",
    specialization: "Compressor Specialist",
    phone: "+255 754 100 103",
    email: "h.mrope@geofields.co.tz",
    profileImage: "/mechanics/hassan-mrope.jpg",
    currentAssignment: "GF-RIG-002",
    status: "ON_JOB"
  },
  {
    id: "mech-004",
    name: "Neema Chuwa",
    specialization: "Welder/Fabricator",
    phone: "+255 754 100 104",
    email: "n.chuwa@geofields.co.tz",
    profileImage: "/mechanics/neema-chuwa.jpg",
    currentAssignment: "Fabrication Unit",
    status: "AVAILABLE"
  }
];

export const maintenanceRequests: MaintenanceRequest[] = [
  {
    id: "mr-2026-031",
    date: "2026-03-05",
    rigId: "rig-gf003",
    clientId: "cli-uranium",
    projectId: "prj-uranium-explore",
    mechanicId: "mech-001",
    issueDescription: "Hydraulic hose leak near rotation head and pressure loss under load.",
    materialsNeeded: ["Hydraulic hose 3/4", "Seal kit", "Hydraulic oil 20L"],
    urgency: "HIGH",
    photos: ["/maintenance/gf003-hose-leak-1.jpg", "/maintenance/gf003-hose-leak-2.jpg"],
    notes: "Can continue at reduced output for 1-2 days maximum.",
    estimatedDowntimeHours: 16,
    status: "OPEN",
    approvalNotes: null
  },
  {
    id: "mr-2026-032",
    date: "2026-03-08",
    rigId: "rig-gf005",
    clientId: null,
    projectId: null,
    mechanicId: "mech-003",
    issueDescription: "Compressor not building full pressure after shutdown event.",
    materialsNeeded: ["Compressor valve kit", "Gasket pack", "Filter set"],
    urgency: "CRITICAL",
    photos: ["/maintenance/gf005-compressor-1.jpg"],
    notes: "Rig currently unavailable.",
    estimatedDowntimeHours: 48,
    status: "IN_REPAIR",
    approvalNotes: "Approved by office for immediate purchase and repair."
  },
  {
    id: "mr-2026-033",
    date: "2026-03-10",
    rigId: "rig-gf002",
    clientId: "cli-barrick",
    projectId: "prj-north-pit",
    mechanicId: "mech-002",
    issueDescription: "Intermittent CAN bus fault affecting panel readings.",
    materialsNeeded: ["Harness connector kit", "Sensor module"],
    urgency: "MEDIUM",
    photos: [],
    notes: "Monitoring continues during operations.",
    estimatedDowntimeHours: 6,
    status: "WAITING_FOR_PARTS",
    approvalNotes: "Supplier lead time is 4 days."
  }
];

export const monthlyRevenueExpense = [
  { month: "Jan", revenue: 364000, expenses: 123300 },
  { month: "Feb", revenue: 360000, expenses: 118500 },
  { month: "Mar", revenue: 407000, expenses: 136000 }
];

export const monthlyMeters = [
  { month: "Jan", meters: 3840 },
  { month: "Feb", meters: 3735 },
  { month: "Mar", meters: 4150 }
];

export function getCompanySnapshot() {
  const totalRevenue = revenues.reduce((sum, entry) => sum + entry.amount, 0);
  const totalExpenses = expenses.reduce((sum, entry) => sum + entry.amount, 0);
  const totalMeters = drillReports.reduce((sum, report) => sum + report.totalMetersDrilled, 0);

  const activeRigs = rigs.filter((rig) => rig.status === "ACTIVE").length;
  const idleRigs = rigs.filter((rig) => rig.status === "IDLE").length;
  const maintenanceRigs = rigs.filter((rig) => rig.status === "MAINTENANCE" || rig.status === "BREAKDOWN").length;

  const revenueByClient = groupByAmount(revenues, "clientId");
  const revenueByRig = groupByAmount(revenues, "rigId");

  const bestClient = topEntity(revenueByClient, clients.map((client) => ({ id: client.id, name: client.name })));
  const bestRig = topEntity(revenueByRig, rigs.map((rig) => ({ id: rig.id, name: rig.rigCode })));

  return {
    totalClients: clients.length,
    totalProjects: projects.length,
    totalRigs: rigs.length,
    activeRigs,
    idleRigs,
    maintenanceRigs,
    totalRevenue,
    totalExpenses,
    grossProfit: totalRevenue - totalExpenses,
    totalMeters,
    bestPerformingClient: bestClient.name,
    bestPerformingRig: bestRig.name,
    topRevenueRig: bestRig.name
  };
}

export function getRevenueByClientData() {
  return clients.map((client) => ({
    name: client.name,
    revenue: revenues.filter((entry) => entry.clientId === client.id).reduce((sum, entry) => sum + entry.amount, 0)
  }));
}

export function getRevenueByRigData() {
  return rigs.map((rig) => ({
    name: rig.rigCode,
    revenue: revenues.filter((entry) => entry.rigId === rig.id).reduce((sum, entry) => sum + entry.amount, 0)
  }));
}

export function getExpenseBreakdownData() {
  const grouped: Record<string, number> = {};
  for (const entry of expenses) {
    grouped[entry.category] = (grouped[entry.category] || 0) + entry.amount;
  }

  return Object.entries(grouped).map(([category, amount]) => ({
    category,
    amount
  }));
}

export function getRigStatusData() {
  return [
    { status: "Active", value: rigs.filter((rig) => rig.status === "ACTIVE").length },
    { status: "Idle", value: rigs.filter((rig) => rig.status === "IDLE").length },
    { status: "Maintenance", value: rigs.filter((rig) => rig.status === "MAINTENANCE").length },
    { status: "Breakdown", value: rigs.filter((rig) => rig.status === "BREAKDOWN").length }
  ];
}

export function getClientWorkspaceData(clientId: string) {
  const client = clients.find((item) => item.id === clientId);
  if (!client) {
    return null;
  }

  const clientProjects = projects.filter((project) => project.clientId === clientId);
  const clientRevenue = revenues.filter((entry) => entry.clientId === clientId).reduce((sum, entry) => sum + entry.amount, 0);
  const clientExpenses = expenses.filter((entry) => entry.clientId === clientId).reduce((sum, entry) => sum + entry.amount, 0);
  const metersDrilled = drillReports.filter((report) => report.clientId === clientId).reduce((sum, report) => sum + report.totalMetersDrilled, 0);
  const assignedRigs = rigs.filter((rig) => clientProjects.some((project) => project.assignedRigId === rig.id));

  return {
    client,
    projects: clientProjects,
    revenue: clientRevenue,
    expenses: clientExpenses,
    profit: clientRevenue - clientExpenses,
    metersDrilled,
    assignedRigs
  };
}

export function getProjectWorkspaceData(projectId: string) {
  const project = projects.find((entry) => entry.id === projectId);
  if (!project) {
    return null;
  }

  const projectRevenue = revenues.filter((entry) => entry.projectId === projectId).reduce((sum, entry) => sum + entry.amount, 0);
  const projectExpenses = expenses.filter((entry) => entry.projectId === projectId).reduce((sum, entry) => sum + entry.amount, 0);
  const projectMeters = drillReports
    .filter((entry) => entry.projectId === projectId)
    .reduce((sum, entry) => sum + entry.totalMetersDrilled, 0);

  return {
    project,
    client: clients.find((entry) => entry.id === project.clientId) || null,
    assignedRig: rigs.find((entry) => entry.id === project.assignedRigId) || null,
    backupRig: rigs.find((entry) => entry.id === project.backupRigId) || null,
    revenue: projectRevenue,
    expenses: projectExpenses,
    profit: projectRevenue - projectExpenses,
    meters: projectMeters,
    costPerMeter: projectMeters > 0 ? projectExpenses / projectMeters : 0
  };
}

export function getRigWorkspaceData(rigId: string) {
  const rig = rigs.find((entry) => entry.id === rigId);
  if (!rig) {
    return null;
  }

  const rigRevenue = revenues.filter((entry) => entry.rigId === rigId).reduce((sum, entry) => sum + entry.amount, 0);
  const rigExpenses = expenses.filter((entry) => entry.rigId === rigId).reduce((sum, entry) => sum + entry.amount, 0);
  const rigMeters = drillReports.filter((entry) => entry.rigId === rigId).reduce((sum, entry) => sum + entry.totalMetersDrilled, 0);
  const currentProject = projects.find((project) => project.assignedRigId === rigId && project.status === "ACTIVE") || null;
  const currentClient = currentProject ? clients.find((entry) => entry.id === currentProject.clientId) || null : null;
  const rigRequests = maintenanceRequests.filter((entry) => entry.rigId === rigId);

  return {
    rig,
    revenue: rigRevenue,
    expenses: rigExpenses,
    profitContribution: rigRevenue - rigExpenses,
    meters: rigMeters,
    utilizationRate: Math.min(100, (rig.totalHoursWorked / (rig.totalLifetimeDaysUsed * 24)) * 100),
    currentProject,
    currentClient,
    maintenanceHistory: rigRequests
  };
}

export function getForecastData(): ForecastPoint[] {
  return [
    { day: "Day 1", revenueForecast: 13100, expenseForecast: 5200 },
    { day: "Day 5", revenueForecast: 13650, expenseForecast: 5350 },
    { day: "Day 10", revenueForecast: 13950, expenseForecast: 5540 },
    { day: "Day 15", revenueForecast: 14400, expenseForecast: 5700 },
    { day: "Day 20", revenueForecast: 14900, expenseForecast: 5820 },
    { day: "Day 25", revenueForecast: 15200, expenseForecast: 5960 },
    { day: "Day 30", revenueForecast: 15800, expenseForecast: 6100 }
  ];
}

export function getSummaryReportData() {
  const daily = {
    projectsWorked: 4,
    rigsUsed: 4,
    metersDrilled: 241,
    revenue: 22830,
    expenses: 9200,
    issuesReported: 2
  };

  const weekly = {
    metersDrilled: 1540,
    mostUsedRig: "GF-RIG-002",
    highestRevenueRig: "GF-RIG-002",
    highestExpenseRig: "GF-RIG-001",
    bestProject: "North Pit Dewatering Program"
  };

  const monthly = {
    metersDrilled: 4150,
    revenue: 407000,
    expenses: 136000,
    profit: 271000
  };

  return { daily, weekly, monthly, executive: getCompanySnapshot() };
}

function groupByAmount(items: RevenueEntry[], key: "clientId" | "rigId") {
  const totals: Record<string, number> = {};

  for (const item of items) {
    const entityId = item[key];
    if (!entityId) {
      continue;
    }
    totals[entityId] = (totals[entityId] || 0) + item.amount;
  }

  return totals;
}

function topEntity(
  grouped: Record<string, number>,
  list: Array<{ id: string; name: string }>
) {
  const [topId] = Object.entries(grouped).sort((a, b) => b[1] - a[1])[0] || [];
  const match = list.find((item) => item.id === topId);
  return { id: topId || "N/A", name: match?.name || "N/A" };
}
