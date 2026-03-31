-- CreateTable
CREATE TABLE "BudgetPlan" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "scopeType" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "periodStart" DATETIME NOT NULL,
    "periodEnd" DATETIME NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "clientId" TEXT,
    "projectId" TEXT,
    "rigId" TEXT,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "BudgetPlan_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "BudgetPlan_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "BudgetPlan_rigId_fkey" FOREIGN KEY ("rigId") REFERENCES "Rig" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "BudgetPlan_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "BudgetPlan_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "BudgetPlan_scopeType_rigId_isActive_periodStart_periodEnd_idx" ON "BudgetPlan"("scopeType", "rigId", "isActive", "periodStart", "periodEnd");

-- CreateIndex
CREATE INDEX "BudgetPlan_scopeType_projectId_isActive_periodStart_periodEnd_idx" ON "BudgetPlan"("scopeType", "projectId", "isActive", "periodStart", "periodEnd");

-- CreateIndex
CREATE INDEX "BudgetPlan_clientId_isActive_periodStart_periodEnd_idx" ON "BudgetPlan"("clientId", "isActive", "periodStart", "periodEnd");
