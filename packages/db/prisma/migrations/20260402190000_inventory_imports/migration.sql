CREATE TYPE "InventoryImportSourceKind" AS ENUM ('LINKED_ACCOUNT', 'CSV_EXPORT', 'PUBLIC_URL');
CREATE TYPE "InventoryImportSourcePlatform" AS ENUM ('EBAY', 'DEPOP', 'POSHMARK', 'WHATNOT', 'NIFTY', 'CROSSLIST');
CREATE TYPE "InventoryImportRunStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELED');
CREATE TYPE "InventoryImportItemStatus" AS ENUM ('PENDING', 'PREVIEWED', 'APPLIED', 'SKIPPED', 'FAILED');

CREATE TABLE "InventoryImportRun" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "marketplaceAccountId" TEXT,
  "sourceKind" "InventoryImportSourceKind" NOT NULL,
  "sourcePlatform" "InventoryImportSourcePlatform" NOT NULL,
  "sourceUrl" TEXT,
  "uploadFilename" TEXT,
  "status" "InventoryImportRunStatus" NOT NULL DEFAULT 'PENDING',
  "cursorJson" JSONB,
  "statsJson" JSONB,
  "artifactUrlsJson" JSONB,
  "progressCount" INTEGER NOT NULL DEFAULT 0,
  "appliedCount" INTEGER NOT NULL DEFAULT 0,
  "failedCount" INTEGER NOT NULL DEFAULT 0,
  "skippedCount" INTEGER NOT NULL DEFAULT 0,
  "lastErrorCode" TEXT,
  "lastErrorMessage" TEXT,
  "startedAt" TIMESTAMP(3),
  "finishedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "InventoryImportRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "InventoryImportItem" (
  "id" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "matchedInventoryItemId" TEXT,
  "externalItemId" TEXT,
  "sourceUrl" TEXT,
  "dedupeKey" TEXT NOT NULL,
  "status" "InventoryImportItemStatus" NOT NULL DEFAULT 'PENDING',
  "rawSourcePayloadJson" JSONB,
  "normalizedCandidateJson" JSONB,
  "lastErrorMessage" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "InventoryImportItem_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "InventoryImportRun_workspaceId_createdAt_idx" ON "InventoryImportRun"("workspaceId", "createdAt");
CREATE INDEX "InventoryImportRun_workspaceId_status_createdAt_idx" ON "InventoryImportRun"("workspaceId", "status", "createdAt");
CREATE INDEX "InventoryImportRun_marketplaceAccountId_createdAt_idx" ON "InventoryImportRun"("marketplaceAccountId", "createdAt");
CREATE INDEX "InventoryImportItem_runId_createdAt_idx" ON "InventoryImportItem"("runId", "createdAt");
CREATE INDEX "InventoryImportItem_runId_status_createdAt_idx" ON "InventoryImportItem"("runId", "status", "createdAt");
CREATE INDEX "InventoryImportItem_dedupeKey_idx" ON "InventoryImportItem"("dedupeKey");

ALTER TABLE "InventoryImportRun"
  ADD CONSTRAINT "InventoryImportRun_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "InventoryImportRun"
  ADD CONSTRAINT "InventoryImportRun_marketplaceAccountId_fkey"
  FOREIGN KEY ("marketplaceAccountId") REFERENCES "MarketplaceAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "InventoryImportItem"
  ADD CONSTRAINT "InventoryImportItem_runId_fkey"
  FOREIGN KEY ("runId") REFERENCES "InventoryImportRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "InventoryImportItem"
  ADD CONSTRAINT "InventoryImportItem_matchedInventoryItemId_fkey"
  FOREIGN KEY ("matchedInventoryItemId") REFERENCES "InventoryItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
