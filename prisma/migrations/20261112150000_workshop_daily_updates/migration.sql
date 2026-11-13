CREATE TABLE "WorkshopDailyUpdate" (
  "id" TEXT NOT NULL,
  "workDate" DATE NOT NULL,
  "workDone" TEXT NOT NULL,
  "blockers" TEXT,
  "nextSteps" TEXT,
  "authorId" TEXT NOT NULL,
  "rigId" TEXT,
  "maintenanceRequestId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WorkshopDailyUpdate_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "WorkshopDailyUpdate_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "WorkshopDailyUpdate_rigId_fkey" FOREIGN KEY ("rigId") REFERENCES "Rig"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "WorkshopDailyUpdate_maintenanceRequestId_fkey" FOREIGN KEY ("maintenanceRequestId") REFERENCES "MaintenanceRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "WorkshopDailyUpdate_workDate_createdAt_id_idx" ON "WorkshopDailyUpdate"("workDate", "createdAt", "id");
