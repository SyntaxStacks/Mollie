import { z } from "zod";

import { createExecutionLog, db, recordAuditLog } from "@reselleros/db";
import { getEbayOperationalState } from "@reselleros/marketplaces-ebay";
import { enqueueJob } from "@reselleros/queue";
import type { CredentialValidationStatus, MarketplaceAccountStatus, MarketplaceCredentialType } from "@reselleros/types";

import type { ApiApp, ApiRouteContext } from "../lib/context.js";
import { redactForOperator } from "../lib/redaction.js";

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
}, marketplaceAccount?: {
  id: string;
  displayName: string;
  secretRef: string;
  status: MarketplaceAccountStatus;
  credentialType: MarketplaceCredentialType;
  validationStatus: CredentialValidationStatus;
  externalAccountId: string | null;
  credentialMetadataJson: unknown;
  lastErrorMessage: string | null;
} | null) {
  const requestPayload = asRecord(log.requestPayloadJson);
  const responsePayload = asRecord(redactForOperator(log.responsePayloadJson));
  const artifactUrls = asStringArray(log.artifactUrlsJson);
  const ebayState =
    log.connector === "EBAY" && marketplaceAccount
      ? getEbayOperationalState({
          account: {
            id: marketplaceAccount.id,
            platform: "EBAY",
            displayName: marketplaceAccount.displayName,
            secretRef: marketplaceAccount.secretRef,
            status: marketplaceAccount.status,
            credentialType: marketplaceAccount.credentialType,
            validationStatus: marketplaceAccount.validationStatus,
            externalAccountId: marketplaceAccount.externalAccountId,
            credentialMetadata: (marketplaceAccount.credentialMetadataJson ?? null) as Record<string, unknown> | null
          },
          accountStatus: marketplaceAccount.status,
          lastErrorMessage: marketplaceAccount.lastErrorMessage
        })
      : null;

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
    requestPayload: asRecord(redactForOperator(requestPayload)),
    responsePayload,
    artifactUrls,
    retryable: isExecutionLogRetryable(log),
    ebayState: ebayState?.state ?? null,
    publishMode: ebayState?.publishMode ?? null
  };
}

function serializeAuditLog(log: {
  id: string;
  action: string;
  targetType: string;
  targetId: string;
  metadataJson: unknown;
  createdAt: Date;
  actorUserId?: string | null;
}) {
  return {
    id: log.id,
    action: log.action,
    targetType: log.targetType,
    targetId: log.targetId,
    metadata: asRecord(log.metadataJson),
    createdAt: log.createdAt,
    actorUserId: log.actorUserId ?? null
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
    const marketplaceAccountIds = Array.from(
      new Set(
        logs
          .map((log) => asRecord(log.requestPayloadJson)?.marketplaceAccountId)
          .filter((value): value is string => typeof value === "string")
      )
    );
    const marketplaceAccounts =
      marketplaceAccountIds.length > 0
        ? await db.marketplaceAccount.findMany({
            where: {
              workspaceId: workspace.id,
              id: {
                in: marketplaceAccountIds
              }
            }
          })
        : [];
    const marketplaceAccountMap = new Map(marketplaceAccounts.map((account) => [account.id, account]));

    return {
      logs: logs.map((log) =>
        serializeExecutionLog(
          log,
          marketplaceAccountMap.get(String(asRecord(log.requestPayloadJson)?.marketplaceAccountId ?? "")) ?? null
        )
      )
    };
  });

  app.get("/api/execution-logs/:id", async (request) => {
    const auth = await context.requireAuth(request);
    const workspace = await context.requireWorkspace(auth);
    const params = z.object({ id: z.string().min(1) }).parse(request.params);

    const log = await db.executionLog.findFirst({
      where: {
        id: params.id,
        workspaceId: workspace.id
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
      }
    });

    if (!log) {
      throw app.httpErrors.notFound("Execution log not found");
    }

    const [relatedAttempts, auditLogs] = await Promise.all([
      db.executionLog.findMany({
        where: {
          workspaceId: workspace.id,
          correlationId: log.correlationId
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
        orderBy: [{ attempt: "asc" }, { createdAt: "asc" }]
      }),
      db.auditLog.findMany({
        where: {
          workspaceId: workspace.id,
          OR: [
            log.inventoryItemId
              ? {
                  targetType: "inventory_item",
                  targetId: log.inventoryItemId
                }
              : undefined,
            log.platformListingId
              ? {
                  targetType: "platform_listing",
                  targetId: log.platformListingId
                }
              : undefined,
            {
              targetType: "execution_log",
              targetId: log.id
            }
          ].filter(Boolean) as Array<{ targetType: string; targetId: string }>
        },
        orderBy: { createdAt: "desc" },
        take: 12
      })
    ]);
    const marketplaceAccountIds = Array.from(
      new Set(
        relatedAttempts
          .map((attempt) => asRecord(attempt.requestPayloadJson)?.marketplaceAccountId)
          .filter((value): value is string => typeof value === "string")
      )
    );
    const marketplaceAccounts =
      marketplaceAccountIds.length > 0
        ? await db.marketplaceAccount.findMany({
            where: {
              workspaceId: workspace.id,
              id: {
                in: marketplaceAccountIds
              }
            }
          })
        : [];
    const marketplaceAccountMap = new Map(marketplaceAccounts.map((account) => [account.id, account]));

    return {
      log: serializeExecutionLog(
        log,
        marketplaceAccountMap.get(String(asRecord(log.requestPayloadJson)?.marketplaceAccountId ?? "")) ?? null
      ),
      relatedAttempts: relatedAttempts.map((attempt) =>
        serializeExecutionLog(
          attempt,
          marketplaceAccountMap.get(String(asRecord(attempt.requestPayloadJson)?.marketplaceAccountId ?? "")) ?? null
        )
      ),
      auditLogs: auditLogs.map(serializeAuditLog)
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
      executionLog: serializeExecutionLog(retriedLog, marketplaceAccount)
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
