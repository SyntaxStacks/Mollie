import Fastify from "fastify";
import { Worker, type Job } from "bullmq";

import { loadWorkerEnv } from "@reselleros/config";
import { Prisma, db } from "@reselleros/db";
import { createLogger } from "@reselleros/observability";
import { getQueueConnection, getQueueName, type JobName, type JobPayload } from "@reselleros/queue";

import { processWorkerJob } from "./jobs.js";

const env = loadWorkerEnv();
const logger = createLogger("worker");

const queueWorker = new Worker(
  getQueueName(),
  async (job) => processWorkerJob(job.name as JobName, job.data as JobPayload<JobName>),
  {
    connection: getQueueConnection(),
    concurrency: env.WORKER_CONCURRENCY
  }
);

queueWorker.on("completed", (job: Job) => {
  logger.info({ jobId: job.id, name: job.name }, "job completed");
});

queueWorker.on("failed", async (job: Job | undefined, error: Error) => {
  logger.error({ jobId: job?.id, name: job?.name, error }, "job failed");

  const executionLogId = (job?.data as { executionLogId?: string } | undefined)?.executionLogId;

  if (executionLogId) {
    await db.executionLog.update({
      where: { id: executionLogId },
      data: {
        status: "FAILED",
        responsePayloadJson: {
          message: error.message
        } as Prisma.InputJsonValue,
        finishedAt: new Date()
      }
    });
  }
});

const healthApp = Fastify({
  loggerInstance: logger
});

healthApp.get("/health", async () => ({
  ok: true,
  service: "reselleros-worker",
  queue: getQueueName(),
  timestamp: new Date().toISOString()
}));

healthApp.listen({
  host: "0.0.0.0",
  port: Number(process.env.PORT ?? 4001)
});
