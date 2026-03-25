import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";

process.env.NODE_ENV = "test";
process.env.RESELLEROS_DISABLE_API_BOOTSTRAP = "1";
process.env.DATABASE_URL ??= "postgresql://postgres:postgres@localhost:5432/reselleros";
process.env.DIRECT_URL ??= process.env.DATABASE_URL;
process.env.REDIS_URL ??= "redis://localhost:6379";
process.env.SESSION_SECRET ??= "test-session-secret";
process.env.APP_BASE_URL ??= "http://localhost:3000";
process.env.NEXT_PUBLIC_API_BASE_URL ??= "http://localhost:4000";
process.env.API_PORT ??= "4000";
process.env.GCS_BUCKET_UPLOADS ??= "reselleros-test-uploads";
process.env.GCS_BUCKET_ARTIFACTS ??= "reselleros-test-artifacts";
process.env.OPENAI_MODEL ??= "gpt-4.1-mini";

type AppModule = typeof import("../../apps/api/src/index.js");
type DbModule = typeof import("@reselleros/db");
type QueueModule = typeof import("@reselleros/queue");

type WorkspaceSession = {
  email: string;
  token: string;
  workspaceId: string;
  headers: Record<string, string>;
};

let app: Awaited<ReturnType<AppModule["buildApiApp"]>>;
let db: DbModule["db"];
let setEnqueueHandler: QueueModule["setEnqueueHandler"];
const queuedJobs: Array<{ name: string; payload: unknown }> = [];
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
  assert.ok(requestCodeBody.devCode);

  const verifyResponse = await app.inject({
    method: "POST",
    url: "/api/auth/verify-code",
    payload: {
      email,
      code: requestCodeBody.devCode
    }
  });

  assert.equal(verifyResponse.statusCode, 200);
  const verifyBody = verifyResponse.json() as { token: string };

  const workspaceResponse = await app.inject({
    method: "POST",
    url: "/api/workspace",
    headers: buildHeaders(verifyBody.token),
    payload: {
      name: `${label} Workspace`
    }
  });

  assert.equal(workspaceResponse.statusCode, 200);
  const workspace = (workspaceResponse.json() as { workspace: { id: string } }).workspace;

  return {
    email,
    token: verifyBody.token,
    workspaceId: workspace.id,
    headers: buildHeaders(verifyBody.token, workspace.id)
  };
}

async function createInventoryItem(session: WorkspaceSession) {
  const response = await app.inject({
    method: "POST",
    url: "/api/inventory",
    headers: session.headers,
    payload: {
      title: `Inventory ${crypto.randomUUID().slice(0, 6)}`,
      category: "Apparel",
      condition: "Good used condition",
      quantity: 1,
      costBasis: 14,
      attributes: {
        source: "test"
      }
    }
  });

  assert.equal(response.statusCode, 200);
  return (response.json() as { item: { id: string } }).item;
}

before(async () => {
  const [apiModule, dbModule, queueModule] = await Promise.all([
    import("../../apps/api/src/index.js"),
    import("@reselleros/db"),
    import("@reselleros/queue")
  ]);

  app = apiModule.buildApiApp();
  db = dbModule.db;
  setEnqueueHandler = queueModule.setEnqueueHandler;
  await app.ready();
  await db.$connect();
  await db.$queryRaw`SELECT 1`;
});

beforeEach(() => {
  queuedJobs.length = 0;
  setEnqueueHandler(async (name, payload) => {
    queuedJobs.push({ name, payload });
    return {
      id: `${name}-${queuedJobs.length}`
    };
  });
});

after(async () => {
  setEnqueueHandler(null);

  for (const email of createdEmails) {
    await db.user.deleteMany({
      where: { email }
    });
  }

  await app.close();
  await db.$disconnect();
});

test("execution logs can be filtered by correlationId and include failure details", async () => {
  const session = await createWorkspaceSession("execution-log-filter");
  const item = await createInventoryItem(session);

  await db.executionLog.createMany({
    data: [
      {
        workspaceId: session.workspaceId,
        inventoryItemId: item.id,
        jobName: "listing.publishDepop",
        connector: "DEPOP",
        status: "FAILED",
        attempt: 1,
        correlationId: "pilot-correlation-observe-123",
        requestPayloadJson: {
          draftId: "draft-filter-1",
          marketplaceAccountId: "account-filter-1"
        },
        responsePayloadJson: {
          code: "ACCOUNT_UNAVAILABLE",
          message: "Depop session expired",
          retryable: true,
          accessToken: "raw-access-token",
          authorization: "Bearer raw-token",
          secretRef: "secret://depop/private"
        },
        artifactUrlsJson: ["artifact://failure/screenshot.png"]
      },
      {
        workspaceId: session.workspaceId,
        inventoryItemId: item.id,
        jobName: "listing.publishEbay",
        connector: "EBAY",
        status: "SUCCEEDED",
        attempt: 1,
        correlationId: "pilot-correlation-success-456"
      }
    ]
  });

  const response = await app.inject({
    method: "GET",
    url: "/api/execution-logs?status=FAILED&correlationId=observe-123",
    headers: session.headers
  });

  assert.equal(response.statusCode, 200);
  const body = response.json() as {
    logs: Array<{
      correlationId: string;
      status: string;
      responsePayload:
        | {
            code?: string;
            message?: string;
            accessToken?: string;
            authorization?: string;
            secretRef?: string | null;
          }
        | null;
      requestPayload: Record<string, unknown> | null;
      artifactUrls: string[];
      retryable: boolean;
    }>;
  };

  assert.equal(body.logs.length, 1);
  assert.equal(body.logs[0]?.correlationId, "pilot-correlation-observe-123");
  assert.equal(body.logs[0]?.status, "FAILED");
  assert.equal(body.logs[0]?.responsePayload?.code, "ACCOUNT_UNAVAILABLE");
  assert.equal(body.logs[0]?.responsePayload?.message, "Depop session expired");
  assert.equal(body.logs[0]?.responsePayload?.accessToken, "[REDACTED]");
  assert.equal(body.logs[0]?.responsePayload?.authorization, "[REDACTED]");
  assert.equal(body.logs[0]?.responsePayload?.secretRef, "secret://...rivate");
  assert.deepEqual(body.logs[0]?.artifactUrls, ["artifact://failure/screenshot.png"]);
  assert.equal(body.logs[0]?.retryable, true);
});

test("failed publish execution logs can be retried from the log route", async () => {
  const session = await createWorkspaceSession("execution-log-retry");
  const item = await createInventoryItem(session);
  const account = await db.marketplaceAccount.create({
    data: {
      workspaceId: session.workspaceId,
      platform: "EBAY",
      displayName: "Retryable eBay",
      secretRef: "secret://ebay/retry",
      credentialType: "SECRET_REF",
      validationStatus: "VALID",
      status: "CONNECTED"
    }
  });
  const draft = await db.listingDraft.create({
    data: {
      inventoryItemId: item.id,
      platform: "EBAY",
      generatedTitle: "Retry Draft",
      generatedDescription: "Retry me",
      generatedPrice: 44,
      generatedTagsJson: [],
      attributesJson: {},
      reviewStatus: "APPROVED"
    }
  });
  const failedLog = await db.executionLog.create({
    data: {
      workspaceId: session.workspaceId,
      inventoryItemId: item.id,
      jobName: "listing.publishEbay",
      connector: "EBAY",
      status: "FAILED",
      attempt: 1,
      correlationId: "pilot-correlation-retry-789",
      requestPayloadJson: {
        draftId: draft.id,
        marketplaceAccountId: account.id
      },
      responsePayloadJson: {
        code: "ACCOUNT_UNAVAILABLE",
        message: "Refresh required"
      }
    }
  });

  const response = await app.inject({
    method: "POST",
    url: `/api/execution-logs/${failedLog.id}/retry`,
    headers: session.headers
  });

  assert.equal(response.statusCode, 200);
  const body = response.json() as {
    executionLog: {
      id: string;
      correlationId: string;
      attempt: number;
      status: string;
      ebayState: string | null;
      publishMode: string | null;
    };
  };

  assert.equal(body.executionLog.attempt, 2);
  assert.equal(body.executionLog.correlationId, failedLog.correlationId);
  assert.equal(body.executionLog.status, "QUEUED");
  assert.equal(body.executionLog.ebayState, "SIMULATED");
  assert.equal(body.executionLog.publishMode, "simulated");
  assert.equal(queuedJobs.length, 1);
  assert.equal(queuedJobs[0]?.name, "listing.publishEbay");
  assert.deepEqual(queuedJobs[0]?.payload, {
    inventoryItemId: item.id,
    draftId: draft.id,
    marketplaceAccountId: account.id,
    executionLogId: body.executionLog.id,
    correlationId: failedLog.correlationId
  });

  const auditLog = await db.auditLog.findFirst({
    where: {
      workspaceId: session.workspaceId,
      action: "execution.retried",
      targetId: failedLog.id
    },
    orderBy: {
      createdAt: "desc"
    }
  });

  assert.ok(auditLog);
});

test("execution log detail returns related attempts and audit trail", async () => {
  const session = await createWorkspaceSession("execution-log-detail");
  const item = await createInventoryItem(session);
  const firstLog = await db.executionLog.create({
    data: {
      workspaceId: session.workspaceId,
      inventoryItemId: item.id,
      jobName: "listing.publishDepop",
      connector: "DEPOP",
      status: "FAILED",
      attempt: 1,
      correlationId: "pilot-correlation-detail-001",
      requestPayloadJson: {
        draftId: "draft-detail-1",
        marketplaceAccountId: "account-detail-1"
      },
      responsePayloadJson: {
        code: "RATE_LIMITED",
        message: "Connector pacing limit hit"
      }
    }
  });
  await db.executionLog.create({
    data: {
      workspaceId: session.workspaceId,
      inventoryItemId: item.id,
      jobName: "listing.publishDepop",
      connector: "DEPOP",
      status: "QUEUED",
      attempt: 2,
      correlationId: "pilot-correlation-detail-001",
      requestPayloadJson: {
        draftId: "draft-detail-1",
        marketplaceAccountId: "account-detail-1"
      }
    }
  });
  await db.auditLog.createMany({
    data: [
      {
        workspaceId: session.workspaceId,
        action: "inventory.updated",
        targetType: "inventory_item",
        targetId: item.id,
        metadataJson: {
          source: "test"
        }
      },
      {
        workspaceId: session.workspaceId,
        action: "execution.retried",
        targetType: "execution_log",
        targetId: firstLog.id,
        metadataJson: {
          attempt: 2
        }
      }
    ]
  });

  const response = await app.inject({
    method: "GET",
    url: `/api/execution-logs/${firstLog.id}`,
    headers: session.headers
  });

  assert.equal(response.statusCode, 200);
  const body = response.json() as {
    log: {
      id: string;
      correlationId: string;
      ebayState: string | null;
    };
    relatedAttempts: Array<{ attempt: number; correlationId: string }>;
    auditLogs: Array<{ action: string; targetType: string }>;
  };

  assert.equal(body.log.id, firstLog.id);
  assert.equal(body.log.correlationId, "pilot-correlation-detail-001");
  assert.equal(body.log.ebayState, null);
  assert.equal(body.relatedAttempts.length, 2);
  assert.deepEqual(
    body.relatedAttempts.map((entry) => entry.attempt),
    [1, 2]
  );
  assert.equal(body.relatedAttempts[0]?.correlationId, "pilot-correlation-detail-001");
  assert.equal(body.auditLogs.length >= 2, true);
  assert.equal(body.auditLogs.some((entry) => entry.action === "inventory.updated" && entry.targetType === "inventory_item"), true);
  assert.equal(body.auditLogs.some((entry) => entry.action === "execution.retried" && entry.targetType === "execution_log"), true);
});
