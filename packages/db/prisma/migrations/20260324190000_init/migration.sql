-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "MarketplacePlatform" AS ENUM ('EBAY', 'DEPOP');

-- CreateEnum
CREATE TYPE "MarketplaceAccountStatus" AS ENUM ('PENDING', 'CONNECTED', 'DISABLED', 'ERROR');

-- CreateEnum
CREATE TYPE "SourceLotStatus" AS ENUM ('PENDING', 'FETCHED', 'ANALYZED', 'FAILED');

-- CreateEnum
CREATE TYPE "InventoryStatus" AS ENUM ('DRAFT', 'READY', 'LISTED', 'SOLD', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "DraftReviewStatus" AS ENUM ('DRAFT', 'NEEDS_REVIEW', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "PlatformListingStatus" AS ENUM ('PENDING', 'PUBLISHED', 'SYNCED', 'SOLD', 'ENDED', 'FAILED');

-- CreateEnum
CREATE TYPE "ExecutionStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "PayoutStatus" AS ENUM ('PENDING', 'PAID', 'DISPUTED');

-- CreateEnum
CREATE TYPE "ImageKind" AS ENUM ('ORIGINAL', 'DERIVED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Workspace" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "plan" TEXT NOT NULL DEFAULT 'pilot',
    "billingCustomerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Workspace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketplaceAccount" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "platform" "MarketplacePlatform" NOT NULL,
    "displayName" TEXT NOT NULL,
    "status" "MarketplaceAccountStatus" NOT NULL DEFAULT 'PENDING',
    "secretRef" TEXT NOT NULL,
    "lastSyncAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketplaceAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourceLot" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "sourcePlatform" TEXT NOT NULL DEFAULT 'MAC_BID',
    "externalId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "rawMetadataJson" JSONB NOT NULL,
    "estimatedResaleMin" DOUBLE PRECISION,
    "estimatedResaleMax" DOUBLE PRECISION,
    "recommendedMaxBid" DOUBLE PRECISION,
    "confidenceScore" DOUBLE PRECISION,
    "riskScore" DOUBLE PRECISION,
    "analysisSummary" TEXT,
    "analysisRationaleJson" JSONB,
    "status" "SourceLotStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SourceLot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryItem" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "sourceLotId" TEXT,
    "sku" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "brand" TEXT,
    "category" TEXT NOT NULL,
    "condition" TEXT NOT NULL,
    "size" TEXT,
    "color" TEXT,
    "attributesJson" JSONB NOT NULL,
    "imageManifestJson" JSONB,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "costBasis" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "estimatedResaleMin" DOUBLE PRECISION,
    "estimatedResaleMax" DOUBLE PRECISION,
    "priceRecommendation" DOUBLE PRECISION,
    "status" "InventoryStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InventoryItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImageAsset" (
    "id" TEXT NOT NULL,
    "inventoryItemId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "kind" "ImageKind" NOT NULL DEFAULT 'ORIGINAL',
    "width" INTEGER,
    "height" INTEGER,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImageAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ListingDraft" (
    "id" TEXT NOT NULL,
    "inventoryItemId" TEXT NOT NULL,
    "platform" "MarketplacePlatform" NOT NULL,
    "generatedTitle" TEXT NOT NULL,
    "generatedDescription" TEXT NOT NULL,
    "generatedPrice" DOUBLE PRECISION NOT NULL,
    "generatedTagsJson" JSONB NOT NULL,
    "attributesJson" JSONB NOT NULL,
    "reviewStatus" "DraftReviewStatus" NOT NULL DEFAULT 'NEEDS_REVIEW',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ListingDraft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformListing" (
    "id" TEXT NOT NULL,
    "inventoryItemId" TEXT NOT NULL,
    "marketplaceAccountId" TEXT NOT NULL,
    "platform" "MarketplacePlatform" NOT NULL,
    "externalListingId" TEXT,
    "status" "PlatformListingStatus" NOT NULL DEFAULT 'PENDING',
    "publishedTitle" TEXT,
    "publishedPrice" DOUBLE PRECISION,
    "externalUrl" TEXT,
    "lastSyncAt" TIMESTAMP(3),
    "rawLastResponseJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformListing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Sale" (
    "id" TEXT NOT NULL,
    "inventoryItemId" TEXT NOT NULL,
    "platformListingId" TEXT,
    "soldPrice" DOUBLE PRECISION NOT NULL,
    "fees" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "shippingCost" DOUBLE PRECISION,
    "soldAt" TIMESTAMP(3) NOT NULL,
    "payoutStatus" "PayoutStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Sale_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExecutionLog" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "inventoryItemId" TEXT,
    "platformListingId" TEXT,
    "jobName" TEXT NOT NULL,
    "connector" TEXT,
    "status" "ExecutionStatus" NOT NULL DEFAULT 'QUEUED',
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "correlationId" TEXT NOT NULL,
    "requestPayloadJson" JSONB,
    "responsePayloadJson" JSONB,
    "artifactUrlsJson" JSONB,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExecutionLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "actorUserId" TEXT,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "metadataJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Session_token_key" ON "Session"("token");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "MarketplaceAccount_workspaceId_platform_idx" ON "MarketplaceAccount"("workspaceId", "platform");

-- CreateIndex
CREATE INDEX "SourceLot_workspaceId_status_idx" ON "SourceLot"("workspaceId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "SourceLot_workspaceId_externalId_key" ON "SourceLot"("workspaceId", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryItem_sku_key" ON "InventoryItem"("sku");

-- CreateIndex
CREATE INDEX "InventoryItem_workspaceId_status_idx" ON "InventoryItem"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "InventoryItem_sourceLotId_idx" ON "InventoryItem"("sourceLotId");

-- CreateIndex
CREATE INDEX "ImageAsset_inventoryItemId_position_idx" ON "ImageAsset"("inventoryItemId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "ListingDraft_inventoryItemId_platform_key" ON "ListingDraft"("inventoryItemId", "platform");

-- CreateIndex
CREATE INDEX "PlatformListing_inventoryItemId_platform_idx" ON "PlatformListing"("inventoryItemId", "platform");

-- CreateIndex
CREATE INDEX "Sale_inventoryItemId_soldAt_idx" ON "Sale"("inventoryItemId", "soldAt");

-- CreateIndex
CREATE INDEX "ExecutionLog_workspaceId_createdAt_idx" ON "ExecutionLog"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "ExecutionLog_correlationId_idx" ON "ExecutionLog"("correlationId");

-- CreateIndex
CREATE INDEX "AuditLog_workspaceId_createdAt_idx" ON "AuditLog"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_targetType_targetId_idx" ON "AuditLog"("targetType", "targetId");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Workspace" ADD CONSTRAINT "Workspace_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketplaceAccount" ADD CONSTRAINT "MarketplaceAccount_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceLot" ADD CONSTRAINT "SourceLot_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_sourceLotId_fkey" FOREIGN KEY ("sourceLotId") REFERENCES "SourceLot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImageAsset" ADD CONSTRAINT "ImageAsset_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "InventoryItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ListingDraft" ADD CONSTRAINT "ListingDraft_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "InventoryItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlatformListing" ADD CONSTRAINT "PlatformListing_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "InventoryItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlatformListing" ADD CONSTRAINT "PlatformListing_marketplaceAccountId_fkey" FOREIGN KEY ("marketplaceAccountId") REFERENCES "MarketplaceAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "InventoryItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_platformListingId_fkey" FOREIGN KEY ("platformListingId") REFERENCES "PlatformListing"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExecutionLog" ADD CONSTRAINT "ExecutionLog_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExecutionLog" ADD CONSTRAINT "ExecutionLog_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "InventoryItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExecutionLog" ADD CONSTRAINT "ExecutionLog_platformListingId_fkey" FOREIGN KEY ("platformListingId") REFERENCES "PlatformListing"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

