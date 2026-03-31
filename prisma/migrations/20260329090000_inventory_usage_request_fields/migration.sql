-- Add SUBMITTED status for existing rows (legacy compatibility with PENDING)
UPDATE "InventoryUsageRequest"
SET "status" = 'SUBMITTED'
WHERE "status" = 'PENDING';

-- Add maintenance linkage and requested date metadata
ALTER TABLE "InventoryUsageRequest"
ADD COLUMN "maintenanceRequestId" TEXT;

ALTER TABLE "InventoryUsageRequest"
ADD COLUMN "requestedForDate" DATETIME;

-- Foreign key is nullable so requests can still be submitted without a maintenance record.
CREATE INDEX "InventoryUsageRequest_maintenanceRequestId_requestedForDate_idx"
ON "InventoryUsageRequest"("maintenanceRequestId", "requestedForDate");
