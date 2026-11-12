CREATE TYPE "ProjectOperatingCostKind" AS ENUM ('CREW_PAY', 'FOOD', 'OTHER');
CREATE TYPE "ProjectOperatingCostCadence" AS ENUM ('ONCE', 'DAILY', 'WEEKLY', 'MONTHLY');
CREATE TYPE "ProjectOperatingCostDraftStatus" AS ENUM ('DRAFT', 'POSTED', 'SKIPPED');

CREATE TABLE "ProjectOperatingCostPlan" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "kind" "ProjectOperatingCostKind" NOT NULL,
    "label" TEXT NOT NULL,
    "employeeId" TEXT,
    "crewJob" TEXT,
    "amountCents" INTEGER NOT NULL CHECK ("amountCents" > 0),
    "cadence" "ProjectOperatingCostCadence" NOT NULL,
    "startsOn" DATE NOT NULL,
    "endsOn" DATE,
    "nextDue" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProjectOperatingCostPlan_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ProjectOperatingCostPlan_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "ProjectOperatingCostDraft" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "employeeId" TEXT,
    "costDate" DATE NOT NULL,
    "amountCents" INTEGER NOT NULL CHECK ("amountCents" > 0),
    "status" "ProjectOperatingCostDraftStatus" NOT NULL DEFAULT 'DRAFT',
    "expenseId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProjectOperatingCostDraft_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ProjectOperatingCostDraft_planId_fkey" FOREIGN KEY ("planId") REFERENCES "ProjectOperatingCostPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ProjectOperatingCostDraft_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "Expense"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "ProjectOperatingCostPlan_projectId_nextDue_idx" ON "ProjectOperatingCostPlan"("projectId", "nextDue");
CREATE UNIQUE INDEX "ProjectOperatingCostDraft_planId_costDate_key" ON "ProjectOperatingCostDraft"("planId", "costDate");
CREATE UNIQUE INDEX "ProjectOperatingCostDraft_projectId_employeeId_costDate_key" ON "ProjectOperatingCostDraft"("projectId", "employeeId", "costDate");
CREATE INDEX "ProjectOperatingCostDraft_projectId_status_costDate_idx" ON "ProjectOperatingCostDraft"("projectId", "status", "costDate");
CREATE INDEX "ProjectOperatingCostDraft_expenseId_idx" ON "ProjectOperatingCostDraft"("expenseId");

CREATE TABLE "ProjectOperatingCostCorrection" (
    "id" TEXT NOT NULL,
    "expenseId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProjectOperatingCostCorrection_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ProjectOperatingCostCorrection_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "Expense"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "ProjectOperatingCostCorrection_expenseId_key" ON "ProjectOperatingCostCorrection"("expenseId");
CREATE INDEX "ProjectOperatingCostCorrection_projectId_createdAt_idx" ON "ProjectOperatingCostCorrection"("projectId", "createdAt");
