-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "module" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "description" TEXT,
    "beforeValueJson" TEXT,
    "afterValueJson" TEXT,
    "actorId" TEXT,
    "actorName" TEXT,
    "actorRole" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_DrillReport" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "date" DATETIME NOT NULL,
    "clientId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "rigId" TEXT NOT NULL,
    "submittedById" TEXT,
    "submittedAt" DATETIME,
    "approvedById" TEXT,
    "approvalStatus" TEXT NOT NULL DEFAULT 'SUBMITTED',
    "approvedAt" DATETIME,
    "rejectionReason" TEXT,
    "holeNumber" TEXT NOT NULL,
    "areaLocation" TEXT NOT NULL,
    "fromMeter" REAL NOT NULL,
    "toMeter" REAL NOT NULL,
    "totalMetersDrilled" REAL NOT NULL,
    "workHours" REAL NOT NULL,
    "rigMoves" INTEGER NOT NULL DEFAULT 0,
    "standbyHours" REAL NOT NULL DEFAULT 0,
    "delayHours" REAL NOT NULL DEFAULT 0,
    "comments" TEXT,
    "operatorCrew" TEXT,
    "billableAmount" REAL NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "DrillReport_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "DrillReport_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "DrillReport_rigId_fkey" FOREIGN KEY ("rigId") REFERENCES "Rig" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "DrillReport_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "DrillReport_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_DrillReport" (
    "areaLocation",
    "billableAmount",
    "clientId",
    "comments",
    "createdAt",
    "date",
    "delayHours",
    "fromMeter",
    "holeNumber",
    "id",
    "operatorCrew",
    "projectId",
    "rigId",
    "rigMoves",
    "standbyHours",
    "submittedById",
    "submittedAt",
    "toMeter",
    "totalMetersDrilled",
    "updatedAt",
    "workHours"
)
SELECT
    "areaLocation",
    "billableAmount",
    "clientId",
    "comments",
    "createdAt",
    "date",
    "delayHours",
    "fromMeter",
    "holeNumber",
    "id",
    "operatorCrew",
    "projectId",
    "rigId",
    "rigMoves",
    "standbyHours",
    "submittedById",
    COALESCE("createdAt", "date"),
    "toMeter",
    "totalMetersDrilled",
    "updatedAt",
    "workHours"
FROM "DrillReport";
DROP TABLE "DrillReport";
ALTER TABLE "new_DrillReport" RENAME TO "DrillReport";
CREATE TABLE "new_Expense" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "date" DATETIME NOT NULL,
    "amount" REAL NOT NULL,
    "category" TEXT NOT NULL,
    "subcategory" TEXT,
    "entrySource" TEXT NOT NULL DEFAULT 'SYSTEM',
    "vendorName" TEXT,
    "receiptNumber" TEXT,
    "quantity" REAL,
    "unitCost" REAL,
    "receiptUrl" TEXT,
    "receiptFileName" TEXT,
    "submittedById" TEXT,
    "submittedAt" DATETIME,
    "approvedById" TEXT,
    "approvalStatus" TEXT NOT NULL DEFAULT 'DRAFT',
    "approvedAt" DATETIME,
    "rejectionReason" TEXT,
    "clientId" TEXT,
    "projectId" TEXT,
    "rigId" TEXT,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Expense_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Expense_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Expense_rigId_fkey" FOREIGN KEY ("rigId") REFERENCES "Rig" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Expense_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Expense_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Expense" (
    "amount",
    "approvalStatus",
    "approvedAt",
    "approvedById",
    "category",
    "clientId",
    "createdAt",
    "date",
    "entrySource",
    "id",
    "notes",
    "projectId",
    "quantity",
    "receiptFileName",
    "receiptNumber",
    "receiptUrl",
    "rigId",
    "submittedById",
    "submittedAt",
    "unitCost",
    "updatedAt",
    "vendorName"
)
SELECT
    "amount",
    CASE
      WHEN "approvalStatus" = 'PENDING' THEN 'SUBMITTED'
      WHEN "approvalStatus" = 'DENIED' THEN 'REJECTED'
      WHEN "approvalStatus" = 'APPROVED' THEN 'APPROVED'
      WHEN "approvalStatus" = 'DRAFT' THEN 'DRAFT'
      WHEN "approvalStatus" = 'SUBMITTED' THEN 'SUBMITTED'
      WHEN "approvalStatus" = 'REJECTED' THEN 'REJECTED'
      ELSE 'DRAFT'
    END AS "approvalStatus",
    "approvedAt",
    "approvedById",
    "category",
    "clientId",
    "createdAt",
    "date",
    "entrySource",
    "id",
    "notes",
    "projectId",
    "quantity",
    "receiptFileName",
    "receiptNumber",
    "receiptUrl",
    "rigId",
    "submittedById",
    CASE
      WHEN "approvalStatus" = 'PENDING' THEN COALESCE("createdAt", "date")
      WHEN "approvalStatus" = 'APPROVED' THEN COALESCE("approvedAt", "createdAt", "date")
      WHEN "approvalStatus" = 'DENIED' THEN COALESCE("approvedAt", "createdAt", "date")
      WHEN "approvalStatus" = 'SUBMITTED' THEN COALESCE("createdAt", "date")
      WHEN "approvalStatus" = 'REJECTED' THEN COALESCE("approvedAt", "createdAt", "date")
      ELSE NULL
    END AS "submittedAt",
    "unitCost",
    "updatedAt",
    "vendorName"
FROM "Expense";
DROP TABLE "Expense";
ALTER TABLE "new_Expense" RENAME TO "Expense";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_module_action_idx" ON "AuditLog"("module", "action");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");
