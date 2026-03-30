import { z } from "zod";

import { createExecutionLog, db, recordAuditLog } from "@reselleros/db";
import { getEbayOperationalState } from "@reselleros/marketplaces-ebay";
import { enqueueJob, getPublishJobName } from "@reselleros/queue";
import type {
  ConnectorFeatureFamily,
  CredentialValidationStatus,
  MarketplaceAccountStatus,
  MarketplaceCredentialType,
  OperatorHint
} from "@reselleros/types";

import type { ApiApp, ApiRouteContext } from "../lib/context.js";
import { redactForOperator } from "../lib/redaction.js";

const executionStatusSchema = z.enum(["QUEUED", "RUNNING", "SUCCEEDED", "FAILED"]);
const retryableJobNames = new Set([
  "listing.publishEbay",
  "listing.publishDepop",
  "listing.publishPoshmark",
  "listing.publishWhatnot"
]);

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

function getExecutionFeatureFamily(connector: string | null): ConnectorFeatureFamily | null {
  switch (connector) {
    case "EBAY":
      return "EBAY_POLICY_CONFIGURATION";
    case "DEPOP":
      return "DEPOP_PROMOTION";
    case "POSHMARK":
      return "POSHMARK_SOCIAL";
    case "WHATNOT":
      return "WHATNOT_LIVE_SELLING";
    default:
      return null;
  }
}

function buildExecutionOperatorHint(input: {
  log: {
    jobName: string;
    connector: string | null;
    status: string;
    inventoryItemId: string | null;
    artifactUrlsJson: unknown;
  };
  responsePayload: Record<string, unknown> | null;
  retryable: boolean;
  marketplaceAccount?: {
    lastErrorMessage: string | null;
  } | null;
}): OperatorHint | null {
  if (input.log.status === "SUCCEEDED") {
    return {
      title: "This run completed successfully.",
      explanation: "Mollie finished the connector action without a blocking error.",
      severity: "SUCCESS",
      nextActions: ["Continue with the next operator step for this item or account."],
      canContinue: true,
      featureFamily: getExecutionFeatureFamily(input.log.connector)
    };
  }

  if (input.log.status !== "FAILED") {
    return null;
  }

  const code = typeof input.responsePayload?.code === "string" ? input.responsePayload.code : null;
  const message = typeof input.responsePayload?.message === "string" ? input.responsePayload.message : null;
  const inventoryRoute = input.log.inventoryItemId ? `/inventory/${input.log.inventoryItemId}` : null;
  const featureFamily = getExecutionFeatureFamily(input.log.connector);
  const artifactUrls = asStringArray(input.log.artifactUrlsJson);

  if (code === "PREREQUISITE_MISSING") {
    return {
      title: "This run is blocked by missing item or marketplace setup.",
      explanation: message ?? "The connector is waiting on a required prerequisite before it can continue.",
      severity: "WARNING",
      nextActions: [
        "Open the item and complete the missing requirement called out in the error.",
        "Return here and retry once the prerequisite is fixed."
      ],
      routeTarget: inventoryRoute,
      featureFamily,
      canContinue: false
    };
  }

  if (code === "ACCOUNT_UNAVAILABLE") {
    return {
      title: "This marketplace account needs attention before the run can continue.",
      explanation: message ?? input.marketplaceAccount?.lastErrorMessage ?? "The connector could not use the selected marketplace account.",
      severity: "ERROR",
      nextActions: [
        "Open /marketplaces and reconnect or repair the affected account.",
        input.retryable ? "Retry this execution after the account shows ready again." : "Switch this work to manual handling if it cannot wait."
      ],
      routeTarget: "/marketplaces",
      featureFamily,
      canContinue: false
    };
  }

  if (code === "RATE_LIMITED") {
    return {
      title: "The marketplace is pacing this connector right now.",
      explanation: message ?? "This run hit a marketplace or session pacing limit.",
      severity: "WARNING",
      nextActions: [
        "Wait before retrying this action.",
        input.retryable ? "Retry from this screen later when pacing clears." : "Move the work to manual handling if timing matters."
      ],
      routeTarget: null,
      featureFamily,
      canContinue: false
    };
  }

  return {
    title: "This connector run needs operator review.",
    explanation: message ?? "Mollie captured a connector failure that needs review before the next action.",
    severity: "ERROR",
    nextActions: [
      artifactUrls.length > 0 ? "Review the execution artifacts for more context." : "Inspect the execution payload details for more context.",
      input.retryable ? "Retry the run if the issue looks temporary." : "Move this workflow to manual handling if the issue persists."
    ],
    routeTarget: artifactUrls.length > 0 ? "/executions" : inventoryRoute,
    featureFamily,
    canContinue: false
  };
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
  const retryable = isExecutionLogRetryable(log);
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
  const hint = buildExecutionOperatorHint({
    log,
    responsePayload,
    retryable,
    marketplaceAccount
  });

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
    retryable,
    ebayState: ebayState?.state ?? null,
    publishMode: ebayState?.publishMode ?? null,
    hint
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

    await enqueueJob(getPublishJobName(marketplaceAccount.platform), {
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
