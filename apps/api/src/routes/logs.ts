import { z } from "zod";

import { createExecutionLog, db, recordAuditLog } from "@reselleros/db";
import { enqueueJob } from "@reselleros/queue";

import type { ApiApp, ApiRouteContext } from "../lib/context.js";

const executionStatusSchema = z.enum(["QUEUED", "RUNNING", "SUCCEEDED", "FAILED"]);
const retryableJobNames = new Set(["listing.publishEbay", "listing.publishDepop"]);

function asRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function asStringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function isExecutionLogRetryable(log: {
  status: string;
  jobName: string;
  inventoryItemId: string | null;
  requestPayloadJson: unknown;
}) {
  const requestPayload = asRecord(log.requestPayloadJson);

  return (
    log.status === "FAILED" &&
    retryableJobNames.has(log.jobName) &&
    Boolean(log.inventoryItemId) &&
    typeof requestPayload?.draftId === "string" &&
    typeof requestPayload?.marketplaceAccountId === "string"
  );
}

function serializeExecutionLog(log: {
  id: string;
  jobName: string;
  connector: string | null;
  status: string;
  attempt: number;
  correlationId: string;
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  inventoryItemId: string | null;
  platformListingId: string | null;
  requestPayloadJson: unknown;
  responsePayloadJson: unknown;
  artifactUrlsJson: unknown;
  inventoryItem?: { title: string; sku: string } | null;
  platformListing?: { externalUrl: string | null; status: string } | null;
}) {
  const requestPayload = asRecord(log.requestPayloadJson);
  const responsePayload = asRecord(log.responsePayloadJson);
  const artifactUrls = asStringArray(log.artifactUrlsJson);

  return {
    id: log.id,
    jobName: log.jobName,
    connector: log.connector,
    status: log.status,
    attempt: log.attempt,
    correlationId: log.correlationId,
    createdAt: log.createdAt,
    startedAt: log.startedAt,
    finishedAt: log.finishedAt,
    inventoryItemId: log.inventoryItemId,
    inventoryItemTitle: log.inventoryItem?.title ?? null,
    inventoryItemSku: log.inventoryItem?.sku ?? null,
    platformListingId: log.platformListingId,
    platformListingStatus: log.platformListing?.status ?? null,
    platformListingUrl: log.platformListing?.externalUrl ?? null,
    requestPayload,
    responsePayload,
    artifactUrls,
    retryable: isExecutionLogRetryable(log)
  };
}

export function registerLogRoutes(app: ApiApp, context: ApiRouteContext) {
  app.get("/api/execution-logs", async (request) => {
    const auth = await context.requireAuth(request);
    const workspace = await context.requireWorkspace(auth);
    const query = z
      .object({
        status: executionStatusSchema.optional(),
        correlationId: z.string().trim().min(1).optional(),
        limit: z.coerce.number().int().min(1).max(100).default(50)
      })
      .parse(request.query);
    const logs = await db.executionLog.findMany({
      where: {
        workspaceId: workspace.id,
        status: query.status,
        correlationId: query.correlationId
          ? {
              contains: query.correlationId
            }
          : undefined
      },
      include: {
        inventoryItem: {
          select: {
            title: true,
            sku: true
          }
        },
        platformListing: {
          select: {
            status: true,
            externalUrl: true
          }
        }
      },
      orderBy: { createdAt: "desc" },
      take: query.limit
    });

    return {
      logs: logs.map(serializeExecutionLog)
    };
  });

  app.post("/api/execution-logs/:id/retry", async (request) => {
    const auth = await context.requireAuth(request);
    const workspace = await context.requireWorkspace(auth);
    const params = z.object({ id: z.string().min(1) }).parse(request.params);

    const log = await db.executionLog.findFirst({
      where: {
        id: params.id,
        workspaceId: workspace.id
      }
    });

    if (!log) {
      throw app.httpErrors.notFound("Execution log not found");
    }

    if (!isExecutionLogRetryable(log)) {
      throw app.httpErrors.preconditionFailed("Execution log cannot be retried");
    }

    const requestPayload = asRecord(log.requestPayloadJson);
    const draftId = requestPayload?.draftId;
    const marketplaceAccountId = requestPayload?.marketplaceAccountId;

    if (typeof draftId !== "string" || typeof marketplaceAccountId !== "string" || !log.inventoryItemId) {
      throw app.httpErrors.preconditionFailed("Execution log is missing retry prerequisites");
    }

    const [item, draft, marketplaceAccount] = await Promise.all([
      db.inventoryItem.findFirst({
        where: {
          id: log.inventoryItemId,
          workspaceId: workspace.id
        }
      }),
      db.listingDraft.findFirst({
        where: {
          id: draftId,
          inventoryItem: {
            workspaceId: workspace.id
          }
        }
      }),
      db.marketplaceAccount.findFirst({
        where: {
          id: marketplaceAccountId,
          workspaceId: workspace.id
        }
      })
    ]);

    if (!item || !draft || !marketplaceAccount) {
      throw app.httpErrors.preconditionFailed("Retry prerequisites are no longer available");
    }

    const retriedLog = await createExecutionLog({
      workspaceId: workspace.id,
      inventoryItemId: log.inventoryItemId,
      platformListingId: log.platformListingId,
      jobName: log.jobName,
      connector: log.connector,
      attempt: log.attempt + 1,
      correlationId: log.correlationId,
      requestPayload: {
        draftId,
        marketplaceAccountId
      }
    });

    await enqueueJob(log.jobName === "listing.publishDepop" ? "listing.publishDepop" : "listing.publishEbay", {
      inventoryItemId: log.inventoryItemId,
      draftId,
      marketplaceAccountId,
      executionLogId: retriedLog.id,
      correlationId: retriedLog.correlationId
    });

    await recordAuditLog({
      workspaceId: workspace.id,
      actorUserId: auth.userId,
      action: "execution.retried",
      targetType: "execution_log",
      targetId: log.id,
      metadata: {
        retriedExecutionLogId: retriedLog.id,
        correlationId: retriedLog.correlationId,
        attempt: retriedLog.attempt
      }
    });

    return {
      executionLog: serializeExecutionLog(retriedLog)
    };
  });

  app.get("/api/audit-logs", async (request) => {
    const auth = await context.requireAuth(request);
    const workspace = await context.requireWorkspace(auth);
    const logs = await db.auditLog.findMany({
      where: { workspaceId: workspace.id },
      orderBy: { createdAt: "desc" },
      take: 50
    });

    return { logs };
  });
}
