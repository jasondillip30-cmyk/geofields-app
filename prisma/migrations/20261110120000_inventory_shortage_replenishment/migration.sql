ALTER TYPE "InventoryUsageRequestStatus" ADD VALUE IF NOT EXISTS 'WAITING_FOR_STOCK';
ALTER TYPE "InventoryUsageRequestStatus" ADD VALUE IF NOT EXISTS 'READY_TO_ISSUE';

ALTER TABLE "InventoryUsageRequest"
ADD COLUMN "replenishmentRequisitionId" TEXT;

CREATE INDEX "InventoryUsageRequest_replenishmentRequisitionId_idx"
ON "InventoryUsageRequest"("replenishmentRequisitionId");
