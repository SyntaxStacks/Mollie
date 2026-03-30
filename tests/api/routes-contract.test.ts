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
process.env.OPENAI_MODEL ??= "gpt-4.1-mini";

type AppModule = typeof import("../../apps/api/src/index.js");

let app: Awaited<ReturnType<AppModule["buildApiApp"]>>;

before(async () => {
  const apiModule = await import("../../apps/api/src/index.js");
  app = apiModule.buildApiApp();
  await app.ready();
});

after(async () => {
  if (app) {
    await app.close();
  }
});

test("health route returns service contract", async () => {
  const response = await app.inject({
    method: "GET",
    url: "/health"
  });

  assert.equal(response.statusCode, 200);
  const body = response.json() as { ok: boolean; service: string; timestamp: string };
  assert.equal(body.ok, true);
  assert.equal(body.service, "reselleros-api");
  assert.ok(Date.parse(body.timestamp) > 0);
});

test("auth route module is registered", async () => {
  const response = await app.inject({
    method: "GET",
    url: "/api/auth/me"
  });

  assert.equal(response.statusCode, 401);
  assert.match(response.json<{ error: string }>().error, /missing bearer token/i);
});

test("workspace route module is registered", async () => {
  const [workspaceResponse, membersResponse] = await Promise.all([
    app.inject({
      method: "GET",
      url: "/api/workspace"
    }),
    app.inject({
      method: "GET",
      url: "/api/workspace/members"
    })
  ]);

  assert.equal(workspaceResponse.statusCode, 401);
  assert.equal(membersResponse.statusCode, 401);
});

test("marketplace account route module is registered", async () => {
  const response = await app.inject({
    method: "GET",
    url: "/api/marketplace-accounts"
  });

  assert.equal(response.statusCode, 401);
});

test("ebay notification route module is registered publicly", async () => {
  const response = await app.inject({
    method: "GET",
    url: "/api/ebay/marketplace-account-deletion?challenge_code=test-challenge"
  });

  assert.notEqual(response.statusCode, 404);
});

test("source lot route module is registered", async () => {
  const response = await app.inject({
    method: "GET",
    url: "/api/source-lots"
  });

  assert.equal(response.statusCode, 401);
});

test("inventory route module is registered", async () => {
  const response = await app.inject({
    method: "GET",
    url: "/api/inventory"
  });

  assert.equal(response.statusCode, 401);
});

test("draft route module is registered", async () => {
  const response = await app.inject({
    method: "PATCH",
    url: "/api/drafts/test-draft"
  });

  assert.equal(response.statusCode, 401);
});

test("listing route module is registered", async () => {
  const response = await app.inject({
    method: "GET",
    url: "/api/listings/test-listing"
  });

  assert.equal(response.statusCode, 401);
});

test("log route module is registered", async () => {
  const [executionLogs, auditLogs] = await Promise.all([
    app.inject({
      method: "GET",
      url: "/api/execution-logs"
    }),
    app.inject({
      method: "GET",
      url: "/api/audit-logs"
    })
  ]);

  assert.equal(executionLogs.statusCode, 401);
  assert.equal(auditLogs.statusCode, 401);
});

test("sales route module is registered", async () => {
  const response = await app.inject({
    method: "GET",
    url: "/api/sales"
  });

  assert.equal(response.statusCode, 401);
});

test("analytics route module is registered", async () => {
  const response = await app.inject({
    method: "GET",
    url: "/api/analytics/pnl"
  });

  assert.equal(response.statusCode, 401);
});
