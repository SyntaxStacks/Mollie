import Fastify from "fastify";
import { Worker, type Job } from "bullmq";

import { loadConnectorEnv } from "@reselleros/config";
import { createLogger } from "@reselleros/observability";
import { getAppQueue, getConnectorQueueName, getQueueConnection, type JobName, type JobPayload } from "@reselleros/queue";

import { processConnectorJob } from "./jobs.js";

const env = loadConnectorEnv();
const logger = createLogger("connector-runner");

const queueWorker = new Worker(
  getConnectorQueueName(),
  async (job: Job) =>
    processConnectorJob(
      job.name as Extract<JobName, "listing.publishDepop" | "listing.publishPoshmark" | "listing.publishWhatnot">,
      job.data as
        | JobPayload<"listing.publishDepop">
        | JobPayload<"listing.publishPoshmark">
        | JobPayload<"listing.publishWhatnot">
    ),
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
