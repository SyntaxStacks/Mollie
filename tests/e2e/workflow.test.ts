import assert from "node:assert/strict";
import { after, before, test } from "node:test";

process.env.NODE_ENV = "test";
process.env.RESELLEROS_DISABLE_API_BOOTSTRAP = "1";
process.env.DATABASE_URL ??= "postgresql://postgres:postgres@localhost:5432/reselleros";
process.env.DIRECT_URL ??= process.env.DATABASE_URL;
process.env.REDIS_URL ??= "redis://localhost:6379";
process.env.SESSION_SECRET ??= "test-session-secret";
process.env.APP_BASE_URL ??= "http://localhost:3000";
process.env.GCS_BUCKET_UPLOADS ??= "reselleros-test-uploads";
process.env.GCS_BUCKET_ARTIFACTS ??= "reselleros-test-artifacts";
process.env.NEXT_PUBLIC_API_BASE_URL ??= "http://localhost:4000";
process.env.API_PORT ??= "4000";
process.env.WORKER_CONCURRENCY ??= "1";
process.env.CONNECTOR_CONCURRENCY ??= "1";
process.env.CONNECTOR_FAILURE_THRESHOLD ??= "3";

type EnqueuedJob = {
  name: string;
  payload: unknown;
};

type AppModule = typeof import("../../apps/api/src/index.js");
type DbModule = typeof import("@reselleros/db");
type QueueModule = typeof import("@reselleros/queue");
type WorkerModule = typeof import("../../apps/worker/src/jobs.js");
type ConnectorModule = typeof import("../../apps/connector-runner/src/jobs.js");

let app: Awaited<ReturnType<AppModule["buildApiApp"]>>;
let db: DbModule["db"];
let setEnqueueHandler: QueueModule["setEnqueueHandler"];
let processWorkerJob: WorkerModule["processWorkerJob"];
let processConnectorJob: ConnectorModule["processConnectorJob"];
const queuedJobs: EnqueuedJob[] = [];
const createdEmails: string[] = [];

async function drainQueuedJobs() {
  while (queuedJobs.length > 0) {
    const job = queuedJobs.shift();

    if (!job) {
      continue;
    }

    if (job.name === "listing.publishDepop") {
      await processConnectorJob(job.name, job.payload as Parameters<ConnectorModule["processConnectorJob"]>[1]);
      continue;
    }

    await processWorkerJob(job.name as Parameters<WorkerModule["processWorkerJob"]>[0], job.payload as never);
  }
}

before(async () => {
  const [apiModule, dbModule, queueModule, workerModule, connectorModule] = await Promise.all([
    import("../../apps/api/src/index.js"),
    import("@reselleros/db"),
    import("@reselleros/queue"),
    import("../../apps/worker/src/jobs.js"),
    import("../../apps/connector-runner/src/jobs.js")
  ]);

  app = apiModule.buildApiApp();
  db = dbModule.db;
  setEnqueueHandler = queueModule.setEnqueueHandler;
  processWorkerJob = workerModule.processWorkerJob;
  processConnectorJob = connectorModule.processConnectorJob;

  setEnqueueHandler(async (name, payload) => {
    queuedJobs.push({
      name,
      payload
    });

    return {
      id: `${name}-${queuedJobs.length}`
    };
  });

  await app.ready();
  await db.$connect();
  await db.$queryRaw`SELECT 1`;
});

after(async () => {
  setEnqueueHandler(null);
  queuedJobs.length = 0;

  for (const email of createdEmails) {
    await db.user.deleteMany({
      where: { email }
    });
  }

  await app.close();
  await db.$disconnect();
});

test("operator can import, analyze, inventory, draft, approve, and publish an ebay listing", async () => {
  const email = `pilot-${Date.now()}-${crypto.randomUUID().slice(0, 6)}@example.com`;
  createdEmails.push(email);

  const requestCodeResponse = await app.inject({
    method: "POST",
    url: "/api/auth/request-code",
    payload: {
      email,
      name: "Pilot User"
    }
  });

  assert.equal(requestCodeResponse.statusCode, 200);
  const requestCodeBody = requestCodeResponse.json() as {
    devCode: string | null;
  };
  assert.ok(requestCodeBody.devCode, "dev code should be returned in test mode");

  const verifyResponse = await app.inject({
    method: "POST",
    url: "/api/auth/verify-code",
    payload: {
      email,
      code: requestCodeBody.devCode
    }
  });

  assert.equal(verifyResponse.statusCode, 200);
  const verifyBody = verifyResponse.json() as {
    token: string;
    workspace: { id: string } | null;
    workspaces: Array<{ id: string }>;
  };
  assert.ok(verifyBody.token);
  assert.equal(verifyBody.workspace, null);
  assert.equal(verifyBody.workspaces.length, 0);

  const authHeaders = {
    authorization: `Bearer ${verifyBody.token}`
  };

  const createWorkspaceResponse = await app.inject({
    method: "POST",
    url: "/api/workspace",
    headers: authHeaders,
    payload: {
      name: "Pilot Workspace"
    }
  });

  assert.equal(createWorkspaceResponse.statusCode, 200);
  const workspace = (createWorkspaceResponse.json() as { workspace: { id: string } }).workspace;
  const scopedHeaders = {
    ...authHeaders,
    "x-workspace-id": workspace.id
  };

  const connectAccountResponse = await app.inject({
    method: "POST",
    url: "/api/marketplace-accounts/ebay/connect",
    headers: scopedHeaders,
    payload: {
      displayName: "Pilot eBay",
      secretRef: "sm://pilot/ebay"
    }
  });

  assert.equal(connectAccountResponse.statusCode, 200);

  const importLotResponse = await app.inject({
    method: "POST",
    url: "/api/source-lots/macbid",
    headers: scopedHeaders,
    payload: {
      url: `https://www.mac.bid/lot/nike-hoodie-sealed?lot=${crypto.randomUUID()}`,
      titleHint: "Nike Hoodie Sealed"
    }
  });

  assert.equal(importLotResponse.statusCode, 200);
  const lot = (importLotResponse.json() as { lot: { id: string } }).lot;

  await drainQueuedJobs();

  const analyzedLot = await db.sourceLot.findUnique({
    where: { id: lot.id }
  });

  assert.ok(analyzedLot);
  assert.equal(analyzedLot.status, "ANALYZED");
  assert.ok(analyzedLot.recommendedMaxBid);

  const createInventoryResponse = await app.inject({
    method: "POST",
    url: `/api/source-lots/${lot.id}/create-inventory`,
    headers: scopedHeaders
  });

  assert.equal(createInventoryResponse.statusCode, 200);
  const item = (createInventoryResponse.json() as { items: Array<{ id: string }> }).items[0];
  assert.ok(item);

  const generateDraftsResponse = await app.inject({
    method: "POST",
    url: `/api/inventory/${item.id}/generate-drafts`,
    headers: scopedHeaders,
    payload: {
      platforms: ["EBAY"]
    }
  });

  assert.equal(generateDraftsResponse.statusCode, 200);
  await drainQueuedJobs();

  const draftsResponse = await app.inject({
    method: "GET",
    url: `/api/inventory/${item.id}/drafts`,
    headers: scopedHeaders
  });

  assert.equal(draftsResponse.statusCode, 200);
  const draft = (draftsResponse.json() as { drafts: Array<{ id: string; reviewStatus: string }> }).drafts[0];
  assert.ok(draft);
  assert.equal(draft.reviewStatus, "NEEDS_REVIEW");

  const approveDraftResponse = await app.inject({
    method: "POST",
    url: `/api/drafts/${draft.id}/approve`,
    headers: scopedHeaders
  });

  assert.equal(approveDraftResponse.statusCode, 200);

  const publishResponse = await app.inject({
    method: "POST",
    url: `/api/inventory/${item.id}/publish/ebay`,
    headers: scopedHeaders
  });

  assert.equal(publishResponse.statusCode, 200);
  const publishBody = publishResponse.json() as {
    executionLog: { id: string };
  };
  assert.ok(publishBody.executionLog.id);

  await drainQueuedJobs();

  const publishedItem = await db.inventoryItem.findUnique({
    where: { id: item.id },
    include: {
      platformListings: true
    }
  });

  assert.ok(publishedItem);
  assert.equal(publishedItem.status, "LISTED");
  assert.equal(publishedItem.platformListings.length, 1);
  assert.equal(publishedItem.platformListings[0]?.platform, "EBAY");
  assert.equal(publishedItem.platformListings[0]?.status, "PUBLISHED");

  const executionLog = await db.executionLog.findUnique({
    where: { id: publishBody.executionLog.id }
  });

  assert.ok(executionLog);
  assert.equal(executionLog.status, "SUCCEEDED");
});
