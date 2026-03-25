-- CreateEnum
CREATE TYPE "WorkspaceRole" AS ENUM ('OWNER', 'MEMBER');

-- CreateTable
CREATE TABLE "AuthChallenge" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthChallenge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkspaceMembership" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "WorkspaceRole" NOT NULL DEFAULT 'MEMBER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkspaceMembership_pkey" PRIMARY KEY ("id")
);

-- Invalidate legacy raw-token sessions before moving to hashed session tokens
DELETE FROM "Session";

-- AlterTable
ALTER TABLE "Session"
    DROP COLUMN "token",
    ADD COLUMN "sessionTokenHash" TEXT NOT NULL,
    ADD COLUMN "lastUsedAt" TIMESTAMP(3),
    ADD COLUMN "revokedAt" TIMESTAMP(3),
    ADD COLUMN "ipAddress" TEXT,
    ADD COLUMN "userAgent" TEXT;

-- DropIndex
DROP INDEX IF EXISTS "Session_token_key";

-- DropIndex
DROP INDEX IF EXISTS "InventoryItem_sku_key";

-- CreateIndex
CREATE UNIQUE INDEX "Session_sessionTokenHash_key" ON "Session"("sessionTokenHash");

-- CreateIndex
CREATE INDEX "AuthChallenge_userId_createdAt_idx" ON "AuthChallenge"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AuthChallenge_email_createdAt_idx" ON "AuthChallenge"("email", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "WorkspaceMembership_workspaceId_userId_key" ON "WorkspaceMembership"("workspaceId", "userId");

-- CreateIndex
CREATE INDEX "WorkspaceMembership_userId_workspaceId_idx" ON "WorkspaceMembership"("userId", "workspaceId");

-- Seed owner memberships for any existing workspaces after the unique index exists
INSERT INTO "WorkspaceMembership" ("id", "workspaceId", "userId", "role", "createdAt")
SELECT
    'owner_' || "id",
    "id",
    "ownerUserId",
    'OWNER'::"WorkspaceRole",
    CURRENT_TIMESTAMP
FROM "Workspace"
ON CONFLICT ("workspaceId", "userId") DO NOTHING;

-- CreateIndex
CREATE UNIQUE INDEX "InventoryItem_workspaceId_sku_key" ON "InventoryItem"("workspaceId", "sku");

-- CreateIndex
CREATE INDEX "ExecutionLog_workspaceId_jobName_status_createdAt_idx" ON "ExecutionLog"("workspaceId", "jobName", "status", "createdAt");

-- AddForeignKey
ALTER TABLE "AuthChallenge" ADD CONSTRAINT "AuthChallenge_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceMembership" ADD CONSTRAINT "WorkspaceMembership_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceMembership" ADD CONSTRAINT "WorkspaceMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
