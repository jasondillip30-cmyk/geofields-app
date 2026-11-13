CREATE TABLE "OfflineDrillingSubmission" (
  "userId" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "payloadHash" TEXT NOT NULL,
  "reportId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OfflineDrillingSubmission_pkey" PRIMARY KEY ("userId", "key")
);
