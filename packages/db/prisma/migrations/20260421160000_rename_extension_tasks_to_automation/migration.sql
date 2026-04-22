ALTER TYPE "ExtensionTaskAction" RENAME TO "AutomationTaskAction";
ALTER TYPE "ExtensionTaskState" RENAME TO "AutomationTaskState";

ALTER TABLE "ExtensionTask" RENAME TO "AutomationTask";

ALTER TABLE "AutomationTask" RENAME CONSTRAINT "ExtensionTask_pkey" TO "AutomationTask_pkey";
ALTER TABLE "AutomationTask" RENAME CONSTRAINT "ExtensionTask_workspaceId_fkey" TO "AutomationTask_workspaceId_fkey";
ALTER TABLE "AutomationTask" RENAME CONSTRAINT "ExtensionTask_inventoryItemId_fkey" TO "AutomationTask_inventoryItemId_fkey";
ALTER TABLE "AutomationTask" RENAME CONSTRAINT "ExtensionTask_inventoryImportRunId_fkey" TO "AutomationTask_inventoryImportRunId_fkey";
ALTER TABLE "AutomationTask" RENAME CONSTRAINT "ExtensionTask_marketplaceAccountId_fkey" TO "AutomationTask_marketplaceAccountId_fkey";

ALTER INDEX "ExtensionTask_workspaceId_createdAt_idx" RENAME TO "AutomationTask_workspaceId_createdAt_idx";
ALTER INDEX "ExtensionTask_workspaceId_state_createdAt_idx" RENAME TO "AutomationTask_workspaceId_state_createdAt_idx";
ALTER INDEX "ExtensionTask_inventoryItemId_platform_createdAt_idx" RENAME TO "AutomationTask_inventoryItemId_platform_createdAt_idx";
ALTER INDEX "ExtensionTask_inventoryImportRunId_platform_createdAt_idx" RENAME TO "AutomationTask_inventoryImportRunId_platform_createdAt_idx";
ALTER INDEX "ExtensionTask_workspaceId_state_retryAfter_createdAt_idx" RENAME TO "AutomationTask_workspaceId_state_retryAfter_createdAt_idx";
