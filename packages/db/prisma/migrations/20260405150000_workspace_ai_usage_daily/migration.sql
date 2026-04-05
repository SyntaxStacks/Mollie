-- CreateTable
CREATE TABLE "public"."WorkspaceAiUsageDaily" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "requestCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkspaceAiUsageDaily_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WorkspaceAiUsageDaily_workspaceId_day_key" ON "public"."WorkspaceAiUsageDaily"("workspaceId", "day");

-- CreateIndex
CREATE INDEX "WorkspaceAiUsageDaily_workspaceId_day_idx" ON "public"."WorkspaceAiUsageDaily"("workspaceId", "day");

-- AddForeignKey
ALTER TABLE "public"."WorkspaceAiUsageDaily" ADD CONSTRAINT "WorkspaceAiUsageDaily_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "public"."Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
