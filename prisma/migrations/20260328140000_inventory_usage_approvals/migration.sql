-- CreateTable
CREATE TABLE "InventoryUsageRequest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "itemId" TEXT NOT NULL,
    "quantity" REAL NOT NULL,
    "reason" TEXT NOT NULL,
    "projectId" TEXT,
    "rigId" TEXT,
    "locationId" TEXT,
    "requestedById" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "decisionNote" TEXT,
    "decidedById" TEXT,
    "decidedAt" DATETIME,
    "approvedMovementId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "InventoryUsageRequest_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "InventoryItem" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "InventoryUsageRequest_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "InventoryUsageRequest_rigId_fkey" FOREIGN KEY ("rigId") REFERENCES "Rig" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "InventoryUsageRequest_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "InventoryLocation" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "InventoryUsageRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "InventoryUsageRequest_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "InventoryUsageRequest_status_createdAt_idx" ON "InventoryUsageRequest"("status", "createdAt");

-- CreateIndex
CREATE INDEX "InventoryUsageRequest_itemId_createdAt_idx" ON "InventoryUsageRequest"("itemId", "createdAt");

-- CreateIndex
CREATE INDEX "InventoryUsageRequest_projectId_rigId_locationId_idx" ON "InventoryUsageRequest"("projectId", "rigId", "locationId");
