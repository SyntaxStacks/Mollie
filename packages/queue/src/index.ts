import { Queue } from "bullmq";
import { z } from "zod";

export const jobNameSchema = z.enum([
  "macbid.fetchLot",
  "macbid.analyzeLot",
  "inventory.generateListingDraft",
  "listing.publishEbay",
  "listing.publishDepop",
  "listing.syncStatus",
  "sales.sync",
  "maintenance.retryFailures"
]);

export type JobName = z.infer<typeof jobNameSchema>;

export const jobSchemas = {
  "macbid.fetchLot": z.object({
    lotId: z.string().min(1),
    workspaceId: z.string().min(1),
    correlationId: z.string()
  }),
  "macbid.analyzeLot": z.object({
    lotId: z.string().min(1),
    workspaceId: z.string().min(1),
    correlationId: z.string()
  }),
  "inventory.generateListingDraft": z.object({
    inventoryItemId: z.string().min(1),
    workspaceId: z.string().min(1),
    platforms: z.array(z.enum(["EBAY", "DEPOP"])).min(1),
    correlationId: z.string()
  }),
  "listing.publishEbay": z.object({
    inventoryItemId: z.string().min(1),
    draftId: z.string().min(1),
    marketplaceAccountId: z.string().min(1),
    executionLogId: z.string().min(1),
    correlationId: z.string()
  }),
  "listing.publishDepop": z.object({
    inventoryItemId: z.string().min(1),
    draftId: z.string().min(1),
    marketplaceAccountId: z.string().min(1),
    executionLogId: z.string().min(1),
    correlationId: z.string()
  }),
  "listing.syncStatus": z.object({
    listingId: z.string().min(1),
    correlationId: z.string()
  }),
  "sales.sync": z.object({
    workspaceId: z.string().min(1),
    correlationId: z.string()
  }),
  "maintenance.retryFailures": z.object({
    workspaceId: z.string().optional(),
    correlationId: z.string()
  })
} as const;

export type JobPayload<TName extends JobName> = z.infer<(typeof jobSchemas)[TName]>;
type EnqueueHandler = <TName extends JobName>(
  name: TName,
  payload: JobPayload<TName>,
  options?: { jobId?: string }
) => Promise<unknown>;

const mainQueueName = "reselleros";
const connectorQueueName = "reselleros-connectors";
const queues = new Map<string, Queue>();
let enqueueHandler: EnqueueHandler | null = null;

export function getQueueConnection(redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379") {
  return {
    url: redisUrl,
    maxRetriesPerRequest: null as null
  };
}

export function getJobQueueName(name: JobName) {
  return name === "listing.publishDepop" ? connectorQueueName : mainQueueName;
}

export function getAppQueue(name: JobName | "main" | "connector" = "main") {
  const resolvedName =
    name === "main" ? mainQueueName : name === "connector" ? connectorQueueName : getJobQueueName(name);

  const existing = queues.get(resolvedName);

  if (existing) {
    return existing;
  }

  const created = new Queue(resolvedName, {
      connection: getQueueConnection(),
      defaultJobOptions: {
        removeOnComplete: 250,
        removeOnFail: 500,
        attempts: 3,
        backoff: {
          type: "exponential",
          delay: 2000
        }
      }
    });

  queues.set(resolvedName, created);
  return created;
}

export async function enqueueJob<TName extends JobName>(
  name: TName,
  payload: JobPayload<TName>,
  options?: { jobId?: string }
) {
  const parsed = jobSchemas[name].parse(payload);

  if (enqueueHandler) {
    return enqueueHandler(name, parsed, options);
  }

  return getAppQueue(name).add(name, parsed, {
    jobId: options?.jobId
  });
}

export function setEnqueueHandler(handler: EnqueueHandler | null) {
  enqueueHandler = handler;
}

export function buildIdempotencyKey(name: JobName, identifier: string) {
  return `${name}:${identifier}`;
}

export function getQueueName() {
  return mainQueueName;
}

export function getConnectorQueueName() {
  return connectorQueueName;
}
