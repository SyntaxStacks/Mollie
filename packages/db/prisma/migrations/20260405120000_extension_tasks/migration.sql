-- CreateEnum
CREATE TYPE "ExtensionTaskAction" AS ENUM (
  'IMPORT_LISTING',
  'PREPARE_DRAFT',
  'PUBLISH_LISTING',
  'UPDATE_LISTING',
  'DELIST_LISTING',
  'RELIST_LISTING'
);

-- CreateEnum
CREATE TYPE "ExtensionTaskState" AS ENUM (
  'QUEUED',
  'RUNNING',
  'NEEDS_INPUT',
  'FAILED',
  'SUCCEEDED',
  'CANCELED'
);

-- CreateTable
CREATE TABLE "ExtensionTask" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "inventoryItemId" TEXT,
  "inventoryImportRunId" TEXT,
  "marketplaceAccountId" TEXT,
  "platform" "MarketplacePlatform" NOT NULL,
  "action" "ExtensionTaskAction" NOT NULL,
  "state" "ExtensionTaskState" NOT NULL DEFAULT 'QUEUED',
  "payloadJson" JSONB,
  "resultJson" JSONB,
  "lastErrorCode" TEXT,
  "lastErrorMessage" TEXT,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ExtensionTask_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "ExtensionTask"
ADD CONSTRAINT "ExtensionTask_workspaceId_fkey"
FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExtensionTask"
ADD CONSTRAINT "ExtensionTask_inventoryItemId_fkey"
FOREIGN KEY ("inventoryItemId") REFERENCES "InventoryItem"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExtensionTask"
ADD CONSTRAINT "ExtensionTask_inventoryImportRunId_fkey"
FOREIGN KEY ("inventoryImportRunId") REFERENCES "InventoryImportRun"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExtensionTask"
ADD CONSTRAINT "ExtensionTask_marketplaceAccountId_fkey"
FOREIGN KEY ("marketplaceAccountId") REFERENCES "MarketplaceAccount"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "ExtensionTask_workspaceId_createdAt_idx" ON "ExtensionTask"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "ExtensionTask_workspaceId_state_createdAt_idx" ON "ExtensionTask"("workspaceId", "state", "createdAt");

-- CreateIndex
CREATE INDEX "ExtensionTask_inventoryItemId_platform_createdAt_idx" ON "ExtensionTask"("inventoryItemId", "platform", "createdAt");

-- CreateIndex
CREATE INDEX "ExtensionTask_inventoryImportRunId_platform_createdAt_idx" ON "ExtensionTask"("inventoryImportRunId", "platform", "createdAt");
