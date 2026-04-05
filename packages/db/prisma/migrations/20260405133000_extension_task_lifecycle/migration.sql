ALTER TABLE "ExtensionTask"
ADD COLUMN "queuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN "attemptCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "runnerInstanceId" TEXT,
ADD COLUMN "claimedAt" TIMESTAMP(3),
ADD COLUMN "lastHeartbeatAt" TIMESTAMP(3),
ADD COLUMN "retryAfter" TIMESTAMP(3),
ADD COLUMN "needsInputReason" TEXT;

UPDATE "ExtensionTask"
SET "queuedAt" = COALESCE("createdAt", CURRENT_TIMESTAMP)
WHERE "queuedAt" IS NULL;

CREATE INDEX "ExtensionTask_workspaceId_state_retryAfter_createdAt_idx"
ON "ExtensionTask"("workspaceId", "state", "retryAfter", "createdAt");
