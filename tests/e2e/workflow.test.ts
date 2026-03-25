import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import { after, before, beforeEach, test } from "node:test";

process.env.NODE_ENV = "test";
process.env.RESELLEROS_DISABLE_API_BOOTSTRAP = "1";
process.env.DATABASE_URL ??= "postgresql://postgres:postgres@localhost:5432/reselleros";
process.env.DIRECT_URL ??= process.env.DATABASE_URL;
process.env.REDIS_URL ??= "redis://localhost:6379";
process.env.SESSION_SECRET ??= "test-session-secret";
process.env.APP_BASE_URL ??= "http://localhost:3000";
process.env.GCS_BUCKET_UPLOADS ??= "reselleros-test-uploads";
process.env.GCS_BUCKET_ARTIFACTS ??= "reselleros-test-artifacts";
process.env.ARTIFACT_BASE_DIR ??= "tmp/artifacts";
process.env.NEXT_PUBLIC_API_BASE_URL ??= "http://localhost:4000";
process.env.API_PORT ??= "4000";
process.env.WORKER_CONCURRENCY ??= "1";
process.env.CONNECTOR_CONCURRENCY ??= "1";
process.env.CONNECTOR_FAILURE_THRESHOLD ??= "3";

type EnqueuedJob = {
  name: string;
  payload: unknown;
};

type WorkspaceSession = {
  email: string;
  token: string;
  workspaceId: string;
  headers: Record<string, string>;
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
const createdEmails = new Set<string>();

function buildHeaders(token: string, workspaceId?: string) {
  const headers: Record<string, string> = {
    authorization: `Bearer ${token}`
  };

  if (workspaceId) {
    headers["x-workspace-id"] = workspaceId;
  }

  return headers;
}

async function drainQueuedJobs(options?: { continueOnError?: boolean }) {
  const errors: Error[] = [];

  while (queuedJobs.length > 0) {
    const job = queuedJobs.shift();

    if (!job) {
      continue;
    }

    try {
      if (job.name === "listing.publishDepop") {
        await processConnectorJob(job.name, job.payload as Parameters<ConnectorModule["processConnectorJob"]>[1]);
      } else {
        await processWorkerJob(job.name as Parameters<WorkerModule["processWorkerJob"]>[0], job.payload as never);
      }
    } catch (error) {
      const resolved = error instanceof Error ? error : new Error(String(error));
      errors.push(resolved);

      if (!options?.continueOnError) {
        throw resolved;
      }
    }
  }

  return errors;
}

async function createWorkspaceSession(label: string): Promise<WorkspaceSession> {
  const email = `${label}-${Date.now()}-${crypto.randomUUID().slice(0, 6)}@example.com`;
  createdEmails.add(email);

  const requestCodeResponse = await app.inject({
    method: "POST",
    url: "/api/auth/request-code",
    payload: {
      email,
      name: label
    }
  });

  assert.equal(requestCodeResponse.statusCode, 200);
  const requestCodeBody = requestCodeResponse.json() as { devCode: string | null };
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

  const createWorkspaceResponse = await app.inject({
    method: "POST",
    url: "/api/workspace",
    headers: buildHeaders(verifyBody.token),
    payload: {
      name: `${label} Workspace`
    }
  });

  assert.equal(createWorkspaceResponse.statusCode, 200);
  const workspace = (createWorkspaceResponse.json() as { workspace: { id: string } }).workspace;

  return {
    email,
    token: verifyBody.token,
    workspaceId: workspace.id,
    headers: buildHeaders(verifyBody.token, workspace.id)
  };
}

async function connectMarketplace(session: WorkspaceSession, platform: "EBAY" | "DEPOP") {
  const response = await app.inject({
    method: "POST",
    url: platform === "EBAY" ? "/api/marketplace-accounts/ebay/connect" : "/api/marketplace-accounts/depop/session",
    headers: session.headers,
    payload: {
      displayName: `${platform} Account`,
      secretRef: `sm://pilot/${platform.toLowerCase()}`
    }
  });

  assert.equal(response.statusCode, 200);
}

async function createInventoryItem(session: WorkspaceSession, overrides?: Record<string, unknown>) {
  const response = await app.inject({
    method: "POST",
    url: "/api/inventory",
    headers: session.headers,
    payload: {
      title: `Inventory ${crypto.randomUUID().slice(0, 6)}`,
      category: "Apparel",
      condition: "Good used condition",
      quantity: 1,
      costBasis: 12,
      attributes: {
        source: "test"
      },
      ...overrides
    }
  });

  assert.equal(response.statusCode, 200);
  return (response.json() as { item: { id: string } }).item;
}

async function createInventoryFromLot(session: WorkspaceSession) {
  const importLotResponse = await app.inject({
    method: "POST",
    url: "/api/source-lots/macbid",
    headers: session.headers,
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

  const createInventoryResponse = await app.inject({
    method: "POST",
    url: `/api/source-lots/${lot.id}/create-inventory`,
    headers: session.headers
  });

  assert.equal(createInventoryResponse.statusCode, 200);
  return (createInventoryResponse.json() as { items: Array<{ id: string }> }).items[0];
}

async function generateAndApproveDraft(
  session: WorkspaceSession,
  inventoryItemId: string,
  platform: "EBAY" | "DEPOP"
) {
  const generateDraftsResponse = await app.inject({
    method: "POST",
    url: `/api/inventory/${inventoryItemId}/generate-drafts`,
    headers: session.headers,
    payload: {
      platforms: [platform]
    }
  });

  assert.equal(generateDraftsResponse.statusCode, 200);
  await drainQueuedJobs();

  const draftsResponse = await app.inject({
    method: "GET",
    url: `/api/inventory/${inventoryItemId}/drafts`,
    headers: session.headers
  });

  assert.equal(draftsResponse.statusCode, 200);
  const draft = (draftsResponse.json() as { drafts: Array<{ id: string; reviewStatus: string; platform: string }> }).drafts.find(
    (entry) => entry.platform === platform
  );

  assert.ok(draft);
  assert.equal(draft.reviewStatus, "NEEDS_REVIEW");

  const approveDraftResponse = await app.inject({
    method: "POST",
    url: `/api/drafts/${draft.id}/approve`,
    headers: session.headers
  });

  assert.equal(approveDraftResponse.statusCode, 200);
  return draft;
}

async function queuePublish(session: WorkspaceSession, inventoryItemId: string, platform: "EBAY" | "DEPOP") {
  const response = await app.inject({
    method: "POST",
    url: platform === "EBAY" ? `/api/inventory/${inventoryItemId}/publish/ebay` : `/api/inventory/${inventoryItemId}/publish/depop`,
    headers: session.headers
  });

  assert.equal(response.statusCode, 200);
  return (response.json() as { executionLog: { id: string } }).executionLog;
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

beforeEach(() => {
  queuedJobs.length = 0;
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
  const session = await createWorkspaceSession("pilot-operator");
  await connectMarketplace(session, "EBAY");

  const item = await createInventoryFromLot(session);
  assert.ok(item);

  await generateAndApproveDraft(session, item.id, "EBAY");
  const executionLog = await queuePublish(session, item.id, "EBAY");

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

  const persistedExecutionLog = await db.executionLog.findUnique({
    where: { id: executionLog.id }
  });

  assert.ok(persistedExecutionLog);
  assert.equal(persistedExecutionLog.status, "SUCCEEDED");
});

test("depop failure captures artifacts and degrades connector health", async () => {
  const session = await createWorkspaceSession("depop-failure");
  await connectMarketplace(session, "DEPOP");

  const item = await createInventoryItem(session);
  await generateAndApproveDraft(session, item.id, "DEPOP");
  const executionLog = await queuePublish(session, item.id, "DEPOP");

  const jobErrors = await drainQueuedJobs({ continueOnError: true });
  assert.equal(jobErrors.length, 1);
  assert.match(jobErrors[0]?.message ?? "", /requires at least one image/i);

  const [persistedExecutionLog, account, persistedItem] = await Promise.all([
    db.executionLog.findUnique({
      where: { id: executionLog.id }
    }),
    db.marketplaceAccount.findFirst({
      where: {
        workspaceId: session.workspaceId,
        platform: "DEPOP"
      }
    }),
    db.inventoryItem.findUnique({
      where: { id: item.id }
    })
  ]);

  assert.ok(persistedExecutionLog);
  assert.equal(persistedExecutionLog.status, "FAILED");

  const responsePayload = persistedExecutionLog.responsePayloadJson as Record<string, unknown>;
  const artifactUrls = persistedExecutionLog.artifactUrlsJson as string[];

  assert.equal(responsePayload.code, "PREREQUISITE_MISSING");
  assert.equal(responsePayload.retryable, false);
  assert.ok(Array.isArray(artifactUrls));
  assert.equal(artifactUrls.length, 2);

  for (const artifactPath of artifactUrls) {
    await access(artifactPath);
  }

  assert.ok(account);
  assert.equal(account.consecutiveFailureCount, 1);
  assert.equal(account.status, "CONNECTED");
  assert.equal(account.lastErrorCode, "PREREQUISITE_MISSING");

  assert.ok(persistedItem);
  assert.equal(persistedItem.status, "READY");
});

test("workspace isolation blocks cross-tenant inventory reads and writes", async () => {
  const owner = await createWorkspaceSession("owner");
  const intruder = await createWorkspaceSession("intruder");
  const item = await createInventoryItem(owner, {
    title: "Owner Inventory"
  });

  const foreignRead = await app.inject({
    method: "GET",
    url: `/api/inventory/${item.id}`,
    headers: intruder.headers
  });

  assert.equal(foreignRead.statusCode, 404);

  const foreignPatch = await app.inject({
    method: "PATCH",
    url: `/api/inventory/${item.id}`,
    headers: intruder.headers,
    payload: {
      title: "Tampered Inventory"
    }
  });

  assert.equal(foreignPatch.statusCode, 404);

  const ownerRead = await app.inject({
    method: "GET",
    url: `/api/inventory/${item.id}`,
    headers: owner.headers
  });

  assert.equal(ownerRead.statusCode, 200);
});
