import { loadWorkerEnv } from "@reselleros/config";
import { db } from "@reselleros/db";
import { createLogger } from "@reselleros/observability";
import { enqueueJob } from "@reselleros/queue";

const env = loadWorkerEnv();
const logger = createLogger("jobs");

async function main() {
  if (process.env.JOBS_SMOKE_MODE === "1") {
    logger.info(
      {
        environment: env.NODE_ENV
      },
      "jobs smoke check passed"
    );
    return;
  }

  const listings = await db.platformListing.findMany({
    where: {
      status: {
        in: ["PUBLISHED", "SYNCED"]
      }
    },
    take: 100
  });

  for (const listing of listings) {
    await enqueueJob("listing.syncStatus", {
      listingId: listing.id,
      correlationId: crypto.randomUUID()
    });
  }

  const workspaces = await db.workspace.findMany({
    select: { id: true }
  });

  for (const workspace of workspaces) {
    await enqueueJob("sales.sync", {
      workspaceId: workspace.id,
      correlationId: crypto.randomUUID()
    });
  }

  logger.info(
    {
      environment: env.NODE_ENV,
      listings: listings.length,
      workspaces: workspaces.length
    },
    "scheduled jobs enqueued"
  );
}

main()
  .catch((error) => {
    logger.error({ error }, "jobs runner failed");
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
