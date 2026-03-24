import Fastify from "fastify";
import { Worker, type Job } from "bullmq";

import { loadConnectorEnv } from "@reselleros/config";
import { Prisma, db } from "@reselleros/db";
import { depopAdapter } from "@reselleros/marketplaces-depop";
import { createLogger } from "@reselleros/observability";
import { getAppQueue, getConnectorQueueName, getQueueConnection, type JobPayload } from "@reselleros/queue";

const env = loadConnectorEnv();
const logger = createLogger("connector-runner");

const queueWorker = new Worker(
  getConnectorQueueName(),
  async (job: Job) => {
    const payload = job.data as JobPayload<"listing.publishDepop">;

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
      throw new Error("Depop publish prerequisites missing");
    }

    const publishResult = await depopAdapter.publishListing({
      inventoryItemId: item.id,
      marketplaceAccountId: account.id,
      marketplaceAccountDisplayName: account.displayName,
      title: draft.generatedTitle,
      description: draft.generatedDescription,
      price: draft.generatedPrice,
      images: item.images.map((image) => image.url),
      attributes: draft.attributesJson as Record<string, unknown>
    });

    const existingListing = await db.platformListing.findFirst({
      where: {
        inventoryItemId: item.id,
        marketplaceAccountId: account.id,
        platform: "DEPOP"
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
            platform: "DEPOP",
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
  },
  {
    connection: getQueueConnection(),
    concurrency: env.CONNECTOR_CONCURRENCY
  }
);

queueWorker.on("completed", (job: Job) => {
  logger.info({ jobId: job.id, name: job.name }, "connector job completed");
});

queueWorker.on("failed", async (job: Job | undefined, error: Error) => {
  logger.error({ jobId: job?.id, name: job?.name, error }, "connector job failed");

  const executionLogId = (job?.data as { executionLogId?: string } | undefined)?.executionLogId;

  if (executionLogId) {
    await db.executionLog.update({
      where: { id: executionLogId },
      data: {
        status: "FAILED",
        responsePayloadJson: {
          message: error.message
        },
        finishedAt: new Date()
      }
    });
  }
});

const app = Fastify({
  logger
});

app.get("/health", async () => ({
  ok: true,
  service: "reselleros-connector-runner",
  queue: getConnectorQueueName(),
  timestamp: new Date().toISOString()
}));

app.get("/health/queue", async () => {
  const queue = getAppQueue("connector");
  return queue.getJobCounts();
});

app.listen({
  host: "0.0.0.0",
  port: Number(process.env.PORT ?? env.API_PORT)
});
