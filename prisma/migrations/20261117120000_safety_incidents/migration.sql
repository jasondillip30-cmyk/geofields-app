-- CreateTable
CREATE TABLE "SafetyIncident" (
    "id" TEXT NOT NULL,
    "submissionKey" TEXT NOT NULL,
    "reportedById" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "reportedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "kind" TEXT NOT NULL,
    "injuryObserved" BOOLEAN,
    "location" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "immediateResponse" TEXT,
    "shift" "DrillingShift",
    "projectId" TEXT,
    "rigId" TEXT,
    "breakdownReportId" TEXT,
    "maintenanceRequestId" TEXT,
    "state" TEXT NOT NULL DEFAULT 'REPORTED',
    "highPotential" BOOLEAN,
    "confirmedImpact" TEXT,
    "findings" TEXT,
    "closeoutNote" TEXT,
    "closedAt" TIMESTAMP(3),
    "revision" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "SafetyIncident_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SafetyAction" (
    "id" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "task" TEXT NOT NULL,
    "dueDate" DATE NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'OPEN',
    "evidence" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SafetyAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SafetyIncidentEvent" (
    "id" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "actionId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SafetyIncidentEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SafetyIncident_state_reportedAt_idx" ON "SafetyIncident"("state", "reportedAt");

-- CreateIndex
CREATE UNIQUE INDEX "SafetyIncident_reportedById_submissionKey_key" ON "SafetyIncident"("reportedById", "submissionKey");

-- CreateIndex
CREATE INDEX "SafetyAction_incidentId_state_idx" ON "SafetyAction"("incidentId", "state");

-- CreateIndex
CREATE INDEX "SafetyAction_ownerId_state_dueDate_idx" ON "SafetyAction"("ownerId", "state", "dueDate");

-- CreateIndex
CREATE INDEX "SafetyIncidentEvent_incidentId_createdAt_idx" ON "SafetyIncidentEvent"("incidentId", "createdAt");

-- AddForeignKey
ALTER TABLE "SafetyIncident" ADD CONSTRAINT "SafetyIncident_reportedById_fkey" FOREIGN KEY ("reportedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SafetyIncident" ADD CONSTRAINT "SafetyIncident_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SafetyIncident" ADD CONSTRAINT "SafetyIncident_rigId_fkey" FOREIGN KEY ("rigId") REFERENCES "Rig"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SafetyIncident" ADD CONSTRAINT "SafetyIncident_breakdownReportId_fkey" FOREIGN KEY ("breakdownReportId") REFERENCES "BreakdownReport"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SafetyIncident" ADD CONSTRAINT "SafetyIncident_maintenanceRequestId_fkey" FOREIGN KEY ("maintenanceRequestId") REFERENCES "MaintenanceRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SafetyAction" ADD CONSTRAINT "SafetyAction_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "SafetyIncident"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SafetyAction" ADD CONSTRAINT "SafetyAction_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SafetyIncidentEvent" ADD CONSTRAINT "SafetyIncidentEvent_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "SafetyIncident"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SafetyIncidentEvent" ADD CONSTRAINT "SafetyIncidentEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
