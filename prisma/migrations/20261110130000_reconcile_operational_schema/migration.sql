BEGIN;

-- Bring databases built from the historical migration chain up to the application schema.
-- CreateEnum
CREATE TYPE "ProjectContractType" AS ENUM ('PER_METER', 'DAY_RATE', 'LUMP_SUM');

-- CreateEnum
CREATE TYPE "ProjectInvoiceStatus" AS ENUM ('DRAFT', 'ISSUED', 'PARTIALLY_COLLECTED', 'COLLECTED', 'VOID');

-- CreateEnum
CREATE TYPE "RigCostAllocationBasis" AS ENUM ('DAY', 'HOUR');

-- CreateEnum
CREATE TYPE "DrillDelayReasonCategory" AS ENUM ('WEATHER', 'RIG_BREAKDOWN', 'RIG_MOVE_SETUP', 'MATERIAL_SUPPLY_WAIT', 'POWER_WATER_ISSUE', 'SAFETY_PERMIT_HOLD', 'SITE_ACCESS', 'OTHER');

-- AlterTable
ALTER TABLE "DrillReport" ADD COLUMN     "assistantCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "delayReasonCategory" "DrillDelayReasonCategory",
ADD COLUMN     "delayReasonNote" TEXT,
ADD COLUMN     "holeContinuityOverrideReason" TEXT,
ADD COLUMN     "leadOperatorName" TEXT;

-- AlterTable
ALTER TABLE "InventoryMovement" ADD COLUMN     "contextType" "InventoryUsageContextType",
ADD COLUMN     "drillReportId" TEXT;

-- AlterTable
ALTER TABLE "InventoryUsageRequest" ADD COLUMN     "contextType" "InventoryUsageContextType" NOT NULL DEFAULT 'OTHER',
ADD COLUMN     "drillReportId" TEXT;

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "contractDayRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "contractLumpSumValue" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "contractType" "ProjectContractType" NOT NULL DEFAULT 'PER_METER',
ADD COLUMN     "estimatedDays" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "estimatedMeters" DOUBLE PRECISION NOT NULL DEFAULT 0,
ALTER COLUMN "contractRatePerM" SET DEFAULT 0;

-- AlterTable
ALTER TABLE "Rig" ADD COLUMN     "costAllocationBasis" "RigCostAllocationBasis" NOT NULL DEFAULT 'DAY',
ADD COLUMN     "costRatePerDay" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "costRatePerHour" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "ProjectBillingRateItem" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "itemCode" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "unitRate" DOUBLE PRECISION NOT NULL,
    "drillingStageLabel" TEXT,
    "depthBandStartM" DOUBLE PRECISION,
    "depthBandEndM" DOUBLE PRECISION,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectBillingRateItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectChangeOrder" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "addedValue" DOUBLE PRECISION NOT NULL,
    "addedMeters" DOUBLE PRECISION,
    "addedDays" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectChangeOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectInvoice" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "invoiceNumber" TEXT NOT NULL,
    "issueDate" TIMESTAMP(3) NOT NULL,
    "dueDate" TIMESTAMP(3),
    "amount" DOUBLE PRECISION NOT NULL,
    "status" "ProjectInvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectInvoicePayment" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "paymentDate" TIMESTAMP(3) NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "paymentReference" TEXT,
    "paymentMethod" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectInvoicePayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectLaborEntry" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "rigId" TEXT,
    "workDate" TIMESTAMP(3) NOT NULL,
    "crewRole" TEXT,
    "personLabel" TEXT,
    "hoursWorked" DOUBLE PRECISION NOT NULL,
    "hourlyRate" DOUBLE PRECISION NOT NULL,
    "totalCost" DOUBLE PRECISION NOT NULL,
    "notes" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectLaborEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DrillReportBillableLine" (
    "id" TEXT NOT NULL,
    "drillReportId" TEXT NOT NULL,
    "itemCode" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "unit" TEXT NOT NULL,

    CONSTRAINT "DrillReportBillableLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProjectBillingRateItem_projectId_sortOrder_createdAt_idx" ON "ProjectBillingRateItem"("projectId", "sortOrder", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectBillingRateItem_projectId_itemCode_key" ON "ProjectBillingRateItem"("projectId", "itemCode");

-- CreateIndex
CREATE INDEX "ProjectChangeOrder_projectId_createdAt_idx" ON "ProjectChangeOrder"("projectId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectInvoice_invoiceNumber_key" ON "ProjectInvoice"("invoiceNumber");

-- CreateIndex
CREATE INDEX "ProjectInvoice_projectId_issueDate_idx" ON "ProjectInvoice"("projectId", "issueDate");

-- CreateIndex
CREATE INDEX "ProjectInvoice_projectId_status_issueDate_idx" ON "ProjectInvoice"("projectId", "status", "issueDate");

-- CreateIndex
CREATE INDEX "ProjectInvoicePayment_invoiceId_paymentDate_idx" ON "ProjectInvoicePayment"("invoiceId", "paymentDate");

-- CreateIndex
CREATE INDEX "ProjectLaborEntry_projectId_workDate_idx" ON "ProjectLaborEntry"("projectId", "workDate");

-- CreateIndex
CREATE INDEX "ProjectLaborEntry_rigId_workDate_idx" ON "ProjectLaborEntry"("rigId", "workDate");

-- CreateIndex
CREATE INDEX "DrillReportBillableLine_drillReportId_idx" ON "DrillReportBillableLine"("drillReportId");

-- CreateIndex
CREATE INDEX "InventoryMovement_drillReportId_date_idx" ON "InventoryMovement"("drillReportId", "date");

-- CreateIndex
CREATE INDEX "InventoryUsageRequest_drillReportId_requestedForDate_idx" ON "InventoryUsageRequest"("drillReportId", "requestedForDate");

-- AddForeignKey
ALTER TABLE "ProjectBillingRateItem" ADD CONSTRAINT "ProjectBillingRateItem_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectChangeOrder" ADD CONSTRAINT "ProjectChangeOrder_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectInvoice" ADD CONSTRAINT "ProjectInvoice_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectInvoicePayment" ADD CONSTRAINT "ProjectInvoicePayment_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "ProjectInvoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectLaborEntry" ADD CONSTRAINT "ProjectLaborEntry_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectLaborEntry" ADD CONSTRAINT "ProjectLaborEntry_rigId_fkey" FOREIGN KEY ("rigId") REFERENCES "Rig"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectLaborEntry" ADD CONSTRAINT "ProjectLaborEntry_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DrillReportBillableLine" ADD CONSTRAINT "DrillReportBillableLine_drillReportId_fkey" FOREIGN KEY ("drillReportId") REFERENCES "DrillReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_drillReportId_fkey" FOREIGN KEY ("drillReportId") REFERENCES "DrillReport"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryUsageRequest" ADD CONSTRAINT "InventoryUsageRequest_drillReportId_fkey" FOREIGN KEY ("drillReportId") REFERENCES "DrillReport"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "InventoryUsageRequestBatch_breakdownReportId_requestedForDate_i" RENAME TO "InventoryUsageRequestBatch_breakdownReportId_requestedForDa_idx";

-- RenameIndex
ALTER INDEX "InventoryUsageRequestBatch_maintenanceRequestId_requestedForDat" RENAME TO "InventoryUsageRequestBatch_maintenanceRequestId_requestedFo_idx";

COMMIT;
