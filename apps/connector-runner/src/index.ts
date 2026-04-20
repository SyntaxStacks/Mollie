import Fastify from "fastify";
import { Worker, type Job } from "bullmq";

import { loadConnectorEnv } from "@reselleros/config";
import { createLogger } from "@reselleros/observability";
import { getAppQueue, getConnectorQueueName, getQueueConnection, type JobName, type JobPayload } from "@reselleros/queue";

import { processConnectorImportJob, processConnectorJob } from "./jobs.js";
import { processRemotePoshmarkAutomationCycle } from "./remote-poshmark-runtime.js";

const env = loadConnectorEnv();
const logger = createLogger("connector-runner");

const queueWorker = new Worker(
  getConnectorQueueName(),
  async (job: Job) => {
    if (job.name === "inventory.importAccountBrowser") {
      return processConnectorImportJob(job.data as JobPayload<"inventory.importAccountBrowser">);
    }

    return processConnectorJob(
      job.name as Extract<JobName, "listing.publishDepop" | "listing.publishPoshmark" | "listing.publishWhatnot">,
      job.data as
        | JobPayload<"listing.publishDepop">
        | JobPayload<"listing.publishPoshmark">
        | JobPayload<"listing.publishWhatnot">
    );
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
});

const app = Fastify({
  loggerInstance: logger
});

let remotePumpRunning = false;

async function runRemoteAutomationPump() {
  if (remotePumpRunning) {
    return;
  }

  remotePumpRunning = true;
  try {
    let processed = true;

    while (processed) {
      processed = await processRemotePoshmarkAutomationCycle();
    }
  } catch (error) {
    logger.error({ error }, "remote automation pump failed");
  } finally {
    remotePumpRunning = false;
  }
}

setInterval(() => {
  void runRemoteAutomationPump();
}, 3_000);
void runRemoteAutomationPump();

app.get("/health", async () => ({
  ok: true,
  service: "reselleros-connector-runner",
  queue: getConnectorQueueName(),
  browserGrid: {
    configured: Boolean(env.BROWSER_GRID_URL),
    url: env.BROWSER_GRID_URL ?? null
  },
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
