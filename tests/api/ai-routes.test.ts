import assert from "node:assert/strict";
import { after, before, test } from "node:test";

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

type AppModule = typeof import("../../apps/api/src/index.js");
type DbModule = typeof import("@reselleros/db");

let app: Awaited<ReturnType<AppModule["buildApiApp"]>>;
let db: DbModule["db"];
const createdEmails = new Set<string>();
const originalFetch = globalThis.fetch;

function buildHeaders(token: string, workspaceId?: string) {
  const headers: Record<string, string> = {
    authorization: `Bearer ${token}`
  };

  if (workspaceId) {
    headers["x-workspace-id"] = workspaceId;
  }

  return headers;
}

async function createWorkspaceSession(label: string) {
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
    token: verifyBody.token,
    workspaceId: workspace.id,
    headers: buildHeaders(verifyBody.token, workspace.id)
  };
}

before(async () => {
  const [apiModule, dbModule] = await Promise.all([import("../../apps/api/src/index.js"), import("@reselleros/db")]);
  app = apiModule.buildApiApp();
  db = dbModule.db;
  await app.ready();
  await db.$connect();
  await db.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "WorkspaceAiUsageDaily" (
      "id" TEXT NOT NULL,
      "workspaceId" TEXT NOT NULL,
      "day" TEXT NOT NULL,
      "requestCount" INTEGER NOT NULL DEFAULT 0,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "WorkspaceAiUsageDaily_pkey" PRIMARY KEY ("id")
    );
  `);
  await db.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS "WorkspaceAiUsageDaily_workspaceId_day_key"
    ON "WorkspaceAiUsageDaily"("workspaceId", "day");
  `);
});

after(async () => {
  globalThis.fetch = originalFetch;

  for (const email of createdEmails) {
    await db.user.deleteMany({
      where: { email }
    });
  }

  if (app) {
    await app.close();
  }

  if (db) {
    await db.$disconnect();
  }
});

test("ai status is disabled when AI is not enabled", async () => {
  process.env.AI_ENABLED = "false";
  process.env.AI_PROVIDER = "null";
  process.env.AI_DAILY_LIMIT_PER_WORKSPACE = "50";

  const session = await createWorkspaceSession("ai-status-disabled");
  const response = await app.inject({
    method: "GET",
    url: "/api/ai/status",
    headers: session.headers
  });

  assert.equal(response.statusCode, 200);
  const body = response.json() as {
    enabled: boolean;
    provider: string;
    remainingDailyQuota: number;
    dailyQuota: number;
    message?: string | null;
  };

  assert.equal(body.enabled, false);
  assert.equal(body.provider, "null");
  assert.equal(body.remainingDailyQuota, 50);
  assert.equal(body.dailyQuota, 50);
  assert.match(body.message ?? "", /disabled/i);
});

test("ai listing assist uses ollama provider when enabled", async () => {
  process.env.AI_ENABLED = "true";
  process.env.AI_PROVIDER = "ollama";
  process.env.AI_DAILY_LIMIT_PER_WORKSPACE = "3";
  process.env.OLLAMA_BASE_URL = "http://localhost:11434";
  process.env.OLLAMA_MODEL = "mollie-test";

  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        response: JSON.stringify({ suggestion: "Nintendo DS Lite Cobalt Blue Console" })
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json"
        }
      }
    ) as unknown as Response;

  const session = await createWorkspaceSession("ai-assist-enabled");
  const response = await app.inject({
    method: "POST",
    url: "/api/ai/listing-assist",
    headers: session.headers,
    payload: {
      operation: "title",
      platform: "EBAY",
      item: {
        inventoryItemId: "item-1",
        sku: "SKU-1",
        title: "Nintendo DS Lite",
        description: "",
        category: "Handheld Systems",
        brand: "Nintendo",
        condition: "Used",
        price: 79.99,
        quantity: 1,
        size: null,
        color: "Blue",
        tags: [],
        labels: [],
        freeShipping: false,
        photos: [],
        marketplaceOverrides: {},
        metadata: {}
      }
    }
  });

  assert.equal(response.statusCode, 200);
  const body = response.json() as {
    enabled: boolean;
    provider: string;
    suggestion: string | number | null;
    remainingDailyQuota: number;
    dailyQuota: number;
  };

  assert.equal(body.enabled, true);
  assert.equal(body.provider, "ollama");
  assert.equal(body.suggestion, "Nintendo DS Lite Cobalt Blue Console");
  assert.equal(body.remainingDailyQuota, 2);
  assert.equal(body.dailyQuota, 3);
});

test("ai listing assist enforces the daily workspace quota", async () => {
  process.env.AI_ENABLED = "true";
  process.env.AI_PROVIDER = "ollama";
  process.env.AI_DAILY_LIMIT_PER_WORKSPACE = "1";
  process.env.OLLAMA_BASE_URL = "http://localhost:11434";
  process.env.OLLAMA_MODEL = "mollie-test";

  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        response: JSON.stringify({ suggestion: 36 })
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json"
        }
      }
    ) as unknown as Response;

  const session = await createWorkspaceSession("ai-assist-quota");
  const payload = {
    operation: "price",
    platform: "EBAY",
    item: {
      inventoryItemId: "item-2",
      sku: "SKU-2",
      title: "Vintage windbreaker",
      description: "",
      category: "Jackets",
      brand: "Nike",
      condition: "Used",
      price: 29.99,
      quantity: 1,
      size: "L",
      color: "Blue",
      tags: [],
      labels: [],
      freeShipping: false,
      photos: [],
      marketplaceOverrides: {},
      metadata: {}
    }
  };

  const firstResponse = await app.inject({
    method: "POST",
    url: "/api/ai/listing-assist",
    headers: session.headers,
    payload
  });

  assert.equal(firstResponse.statusCode, 200);

  const secondResponse = await app.inject({
    method: "POST",
    url: "/api/ai/listing-assist",
    headers: session.headers,
    payload
  });

  assert.equal(secondResponse.statusCode, 429);
  const body = secondResponse.json() as { message?: string; error?: string };
  assert.match((body.message ?? body.error ?? ""), /daily ai request limit/i);
});
