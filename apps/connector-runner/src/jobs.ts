import { captureConnectorFailureArtifacts } from "@reselleros/artifacts";
import { loadConnectorEnv } from "@reselleros/config";
import { Prisma, db, markMarketplaceAccountConnectorFailure, resetMarketplaceAccountConnectorHealth } from "@reselleros/db";
import { ConnectorError, classifyConnectorError } from "@reselleros/marketplaces";
import { depopAdapter } from "@reselleros/marketplaces-depop";
import { poshmarkAdapter } from "@reselleros/marketplaces-poshmark";
import type { JobPayload } from "@reselleros/queue";
import { whatnotAdapter } from "@reselleros/marketplaces-whatnot";
import type { Platform } from "@reselleros/types";

const env = loadConnectorEnv();
const failureThreshold = env.CONNECTOR_FAILURE_THRESHOLD;

type ConnectorPublishJobName = "listing.publishDepop" | "listing.publishPoshmark" | "listing.publishWhatnot";
type ConnectorPublishPayload =
  | JobPayload<"listing.publishDepop">
  | JobPayload<"listing.publishPoshmark">
  | JobPayload<"listing.publishWhatnot">;

const connectorConfig = {
  "listing.publishDepop": {
    platform: "DEPOP",
    adapter: depopAdapter,
    missingMessage: "Depop publish prerequisites missing"
  },
  "listing.publishPoshmark": {
    platform: "POSHMARK",
    adapter: poshmarkAdapter,
    missingMessage: "Poshmark publish prerequisites missing"
  },
  "listing.publishWhatnot": {
    platform: "WHATNOT",
    adapter: whatnotAdapter,
    missingMessage: "Whatnot publish prerequisites missing"
  }
} as const;

async function handleConnectorFailure(input: {
  payload: ConnectorPublishPayload;
  jobName: string;
  error: unknown;
  workspaceId: string;
  connector: Platform;
}) {
  const connectorError = classifyConnectorError(input.error);

  let artifactUrls: string[] = [];
  let artifactCaptureError: string | null = null;

  try {
    artifactUrls = await captureConnectorFailureArtifacts({
      workspaceId: input.workspaceId,
      executionLogId: input.payload.executionLogId,
      connector: input.connector,
      code: connectorError.code,
      message: connectorError.message,
      jobName: input.jobName,
      metadata: connectorError.metadata
    });
  } catch (error) {
    artifactCaptureError = error instanceof Error ? error.message : "Artifact capture failed";
    connectorError.metadata = {
      ...(connectorError.metadata ?? {}),
      artifactCaptureError
    };
  }

  await markMarketplaceAccountConnectorFailure({
    marketplaceAccountId: input.payload.marketplaceAccountId,
    code: connectorError.code,
    message: connectorError.message,
    failureThreshold
  });

  await db.executionLog.update({
    where: { id: input.payload.executionLogId },
    data: {
      status: "FAILED",
      responsePayloadJson: {
        code: connectorError.code,
        message: connectorError.message,
        retryable: connectorError.retryable,
        metadata: connectorError.metadata ?? {},
        artifactCaptureError
      } as Prisma.InputJsonValue,
      artifactUrlsJson: artifactUrls as Prisma.InputJsonValue,
      finishedAt: new Date()
    }
  });

  return connectorError;
}

export async function processConnectorJob(jobName: ConnectorPublishJobName, payload: ConnectorPublishPayload) {
  const config = connectorConfig[jobName];

  await db.executionLog.update({
    where: { id: payload.executionLogId },
    data: {
      status: "RUNNING",
      startedAt: new Date()
    }
  });

  const [item, draft, account] = await Promise.all([
    db.inventoryItem.findUnique({
      where: { id: payload.inventoryItemId },
      include: {
        images: {
          orderBy: { position: "asc" }
        }
      }
    }),
    db.listingDraft.findUnique({
      where: { id: payload.draftId }
    }),
    db.marketplaceAccount.findUnique({
      where: { id: payload.marketplaceAccountId }
    })
  ]);

  if (!item || !draft || !account) {
    const error = await handleConnectorFailure({
      payload,
      jobName,
      error: new ConnectorError({
        code: "PREREQUISITE_MISSING",
        message: config.missingMessage,
        retryable: false
      }),
      workspaceId: item?.workspaceId ?? account?.workspaceId ?? "unknown-workspace",
      connector: config.platform
    });
    throw error;
  }

  const workspace = await db.workspace.findUnique({
    where: { id: item.workspaceId }
  });

  if (!workspace) {
    const error = await handleConnectorFailure({
      payload,
      jobName,
      error: new ConnectorError({
        code: "PREREQUISITE_MISSING",
        message: "Workspace not found for connector job",
        retryable: false
      }),
      workspaceId: item.workspaceId,
      connector: config.platform
    });
    throw error;
  }

  if (!workspace.connectorAutomationEnabled) {
    const error = await handleConnectorFailure({
      payload,
      jobName,
      error: new ConnectorError({
        code: "WORKSPACE_AUTOMATION_DISABLED",
        message: "Connector automation is disabled for this workspace",
        retryable: false
      }),
      workspaceId: workspace.id,
      connector: config.platform
    });
    throw error;
  }

  if (account.status === "DISABLED" || account.status === "ERROR") {
    const error = await handleConnectorFailure({
      payload,
      jobName,
      error: new ConnectorError({
        code: "ACCOUNT_UNAVAILABLE",
        message: `Marketplace account is ${account.status.toLowerCase()}`,
        retryable: false
      }),
      workspaceId: workspace.id,
      connector: config.platform
    });
    throw error;
  }

  try {
    const publishResult = await config.adapter.publishListing({
      inventoryItemId: item.id,
      sku: item.sku,
      quantity: item.quantity,
      title: draft.generatedTitle,
      description: draft.generatedDescription,
      price: draft.generatedPrice,
      images: item.images.map((image) => image.url),
      category: item.category,
      condition: item.condition,
      brand: item.brand,
      attributes: draft.attributesJson as Record<string, unknown>,
      marketplaceAccount: {
        id: account.id,
        platform: config.platform,
        displayName: account.displayName,
        secretRef: account.secretRef,
        status: account.status,
        credentialType: account.credentialType,
        validationStatus: account.validationStatus,
        externalAccountId: account.externalAccountId,
        credentialMetadata: (account.credentialMetadataJson ?? null) as Record<string, unknown> | null,
        credentialPayload: (account.credentialPayloadJson ?? null) as Record<string, unknown> | null
      }
    });

    const existingListing = await db.platformListing.findFirst({
      where: {
        inventoryItemId: item.id,
        marketplaceAccountId: account.id,
        platform: config.platform
      }
    });

    const listing = existingListing
      ? await db.platformListing.update({
          where: { id: existingListing.id },
          data: {
            externalListingId: publishResult.externalListingId,
            externalUrl: publishResult.externalUrl,
            publishedTitle: publishResult.title,
            publishedPrice: publishResult.price,
            rawLastResponseJson: publishResult.rawResponse as Prisma.InputJsonValue,
            lastSyncAt: new Date(),
            status: "PUBLISHED"
          }
        })
      : await db.platformListing.create({
          data: {
            inventoryItemId: item.id,
            marketplaceAccountId: account.id,
            platform: config.platform,
            externalListingId: publishResult.externalListingId,
            externalUrl: publishResult.externalUrl,
            publishedTitle: publishResult.title,
            publishedPrice: publishResult.price,
            rawLastResponseJson: publishResult.rawResponse as Prisma.InputJsonValue,
            lastSyncAt: new Date(),
            status: "PUBLISHED"
          }
        });

    await db.inventoryItem.update({
      where: { id: item.id },
      data: {
        status: "LISTED"
      }
    });

    await resetMarketplaceAccountConnectorHealth(account.id);

    await db.executionLog.update({
      where: { id: payload.executionLogId },
      data: {
        platformListingId: listing.id,
        status: "SUCCEEDED",
        responsePayloadJson: publishResult.rawResponse as Prisma.InputJsonValue,
        artifactUrlsJson: (publishResult.artifactUrls ?? []) as Prisma.InputJsonValue,
        finishedAt: new Date()
      }
    });

    return listing;
  } catch (error) {
    const handled = await handleConnectorFailure({
      payload,
      jobName,
      error,
      workspaceId: workspace.id,
      connector: config.platform
    });
    throw handled;
  }
}
