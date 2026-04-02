-- CreateEnum
CREATE TYPE "MarketplaceConnectAttemptState" AS ENUM (
  'PENDING',
  'AWAITING_LOGIN',
  'AWAITING_2FA',
  'CAPTURING_SESSION',
  'VALIDATING',
  'CONNECTED',
  'FAILED',
  'EXPIRED'
);

-- CreateTable
CREATE TABLE "MarketplaceConnectAttempt" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "marketplaceAccountId" TEXT,
  "platform" "MarketplacePlatform" NOT NULL,
  "displayName" TEXT NOT NULL,
  "state" "MarketplaceConnectAttemptState" NOT NULL DEFAULT 'PENDING',
  "helperNonce" TEXT NOT NULL,
  "promptsJson" JSONB,
  "metadataJson" JSONB,
  "externalAccountId" TEXT,
  "lastErrorCode" TEXT,
  "lastErrorMessage" TEXT,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "MarketplaceConnectAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MarketplaceConnectAttempt_helperNonce_key" ON "MarketplaceConnectAttempt"("helperNonce");

-- CreateIndex
CREATE INDEX "MarketplaceConnectAttempt_workspaceId_platform_createdAt_idx" ON "MarketplaceConnectAttempt"("workspaceId", "platform", "createdAt");

-- CreateIndex
CREATE INDEX "MarketplaceConnectAttempt_workspaceId_state_expiresAt_idx" ON "MarketplaceConnectAttempt"("workspaceId", "state", "expiresAt");

-- AddForeignKey
ALTER TABLE "MarketplaceConnectAttempt"
ADD CONSTRAINT "MarketplaceConnectAttempt_workspaceId_fkey"
FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketplaceConnectAttempt"
ADD CONSTRAINT "MarketplaceConnectAttempt_marketplaceAccountId_fkey"
FOREIGN KEY ("marketplaceAccountId") REFERENCES "MarketplaceAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;
