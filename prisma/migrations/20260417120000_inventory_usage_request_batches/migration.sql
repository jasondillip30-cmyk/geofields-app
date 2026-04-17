-- CreateEnum
CREATE TYPE "InventoryUsageRequestBatchStatus" AS ENUM (
    'SUBMITTED',
    'PENDING',
    'APPROVED',
    'REJECTED',
    'PARTIALLY_APPROVED'
);

-- CreateEnum
CREATE TYPE "InventoryUsageRequestBatchLineStatus" AS ENUM (
    'SUBMITTED',
    'APPROVED',
    'REJECTED'
);

-- CreateTable
CREATE TABLE "InventoryUsageRequestBatch" (
    "id" TEXT NOT NULL,
    "contextType" "InventoryUsageContextType" NOT NULL DEFAULT 'OTHER',
    "reason" TEXT,
    "projectId" TEXT,
    "rigId" TEXT,
    "drillReportId" TEXT,
    "maintenanceRequestId" TEXT,
    "breakdownReportId" TEXT,
    "locationId" TEXT,
    "requestedForDate" TIMESTAMP(3),
    "requestedById" TEXT,
    "status" "InventoryUsageRequestBatchStatus" NOT NULL DEFAULT 'SUBMITTED',
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InventoryUsageRequestBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryUsageRequestBatchLine" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "status" "InventoryUsageRequestBatchLineStatus" NOT NULL DEFAULT 'SUBMITTED',
    "decisionNote" TEXT,
    "approvedMovementId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InventoryUsageRequestBatchLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InventoryUsageRequestBatch_status_createdAt_idx" ON "InventoryUsageRequestBatch"("status", "createdAt");

-- CreateIndex
CREATE INDEX "InventoryUsageRequestBatch_projectId_rigId_locationId_idx" ON "InventoryUsageRequestBatch"("projectId", "rigId", "locationId");

-- CreateIndex
CREATE INDEX "InventoryUsageRequestBatch_drillReportId_requestedForDate_idx" ON "InventoryUsageRequestBatch"("drillReportId", "requestedForDate");

-- CreateIndex
CREATE INDEX "InventoryUsageRequestBatch_maintenanceRequestId_requestedForDate_idx" ON "InventoryUsageRequestBatch"("maintenanceRequestId", "requestedForDate");

-- CreateIndex
CREATE INDEX "InventoryUsageRequestBatch_breakdownReportId_requestedForDate_idx" ON "InventoryUsageRequestBatch"("breakdownReportId", "requestedForDate");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryUsageRequestBatchLine_batchId_itemId_key" ON "InventoryUsageRequestBatchLine"("batchId", "itemId");

-- CreateIndex
CREATE INDEX "InventoryUsageRequestBatchLine_status_createdAt_idx" ON "InventoryUsageRequestBatchLine"("status", "createdAt");

-- CreateIndex
CREATE INDEX "InventoryUsageRequestBatchLine_itemId_createdAt_idx" ON "InventoryUsageRequestBatchLine"("itemId", "createdAt");

-- CreateIndex
CREATE INDEX "InventoryUsageRequestBatchLine_batchId_status_idx" ON "InventoryUsageRequestBatchLine"("batchId", "status");

-- AddForeignKey
ALTER TABLE "InventoryUsageRequestBatch" ADD CONSTRAINT "InventoryUsageRequestBatch_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryUsageRequestBatch" ADD CONSTRAINT "InventoryUsageRequestBatch_rigId_fkey" FOREIGN KEY ("rigId") REFERENCES "Rig"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryUsageRequestBatch" ADD CONSTRAINT "InventoryUsageRequestBatch_drillReportId_fkey" FOREIGN KEY ("drillReportId") REFERENCES "DrillReport"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryUsageRequestBatch" ADD CONSTRAINT "InventoryUsageRequestBatch_maintenanceRequestId_fkey" FOREIGN KEY ("maintenanceRequestId") REFERENCES "MaintenanceRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryUsageRequestBatch" ADD CONSTRAINT "InventoryUsageRequestBatch_breakdownReportId_fkey" FOREIGN KEY ("breakdownReportId") REFERENCES "BreakdownReport"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryUsageRequestBatch" ADD CONSTRAINT "InventoryUsageRequestBatch_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "InventoryLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryUsageRequestBatch" ADD CONSTRAINT "InventoryUsageRequestBatch_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryUsageRequestBatch" ADD CONSTRAINT "InventoryUsageRequestBatch_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryUsageRequestBatchLine" ADD CONSTRAINT "InventoryUsageRequestBatchLine_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "InventoryUsageRequestBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryUsageRequestBatchLine" ADD CONSTRAINT "InventoryUsageRequestBatchLine_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "InventoryItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
