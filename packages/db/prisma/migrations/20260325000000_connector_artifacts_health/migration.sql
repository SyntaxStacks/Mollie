-- AlterTable
ALTER TABLE "Workspace"
    ADD COLUMN "connectorAutomationEnabled" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "MarketplaceAccount"
    ADD COLUMN "consecutiveFailureCount" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "lastFailureAt" TIMESTAMP(3),
    ADD COLUMN "lastErrorCode" TEXT,
    ADD COLUMN "lastErrorMessage" TEXT;
