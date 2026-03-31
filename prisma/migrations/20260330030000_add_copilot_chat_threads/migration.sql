-- CreateTable
CREATE TABLE "CopilotChatThread" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "scopeMode" TEXT NOT NULL DEFAULT 'THIS_PAGE',
    "currentPageKey" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CopilotChatThread_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CopilotChatMessage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "threadId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "intent" TEXT,
    "content" TEXT NOT NULL,
    "pageKey" TEXT,
    "scopeMode" TEXT,
    "contextJson" TEXT,
    "responseDataJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CopilotChatMessage_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "CopilotChatThread" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "CopilotChatThread_userId_updatedAt_idx" ON "CopilotChatThread"("userId", "updatedAt");

-- CreateIndex
CREATE INDEX "CopilotChatThread_scopeMode_updatedAt_idx" ON "CopilotChatThread"("scopeMode", "updatedAt");

-- CreateIndex
CREATE INDEX "CopilotChatMessage_threadId_createdAt_idx" ON "CopilotChatMessage"("threadId", "createdAt");

-- CreateIndex
CREATE INDEX "CopilotChatMessage_intent_createdAt_idx" ON "CopilotChatMessage"("intent", "createdAt");
