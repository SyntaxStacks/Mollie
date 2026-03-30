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
  await db.$queryRaw`SELECT 1`;
});

after(async () => {
  delete process.env.AMAZON_CATALOG_LOOKUP_MODE;

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

test("catalog lookup explains when Amazon lookup is not configured", async () => {
  delete process.env.AMAZON_CATALOG_LOOKUP_MODE;
  const session = await createWorkspaceSession("catalog-lookup-manual");

  const response = await app.inject({
    method: "POST",
    url: "/api/catalog/lookup",
    headers: session.headers,
    payload: {
      provider: "AMAZON",
      barcode: "012345678905"
    }
  });

  assert.equal(response.statusCode, 200);
  const result = response.json<{
    result: {
      status: string;
      mode: string;
      hint: { title: string; nextActions: string[] };
    };
  }>().result;
  assert.equal(result.status, "NOT_CONFIGURED");
  assert.equal(result.mode, "MANUAL");
  assert.match(result.hint.title, /not configured/i);
  assert.ok(result.hint.nextActions.length > 0);
});

test("catalog lookup can return a fixture-backed Amazon item for autofill", async () => {
  process.env.AMAZON_CATALOG_LOOKUP_MODE = "fixture";
  const session = await createWorkspaceSession("catalog-lookup-fixture");

  const response = await app.inject({
    method: "POST",
    url: "/api/catalog/lookup",
    headers: session.headers,
    payload: {
      provider: "AMAZON",
      barcode: "012345678905"
    }
  });

  assert.equal(response.statusCode, 200);
  const result = response.json<{
    result: {
      status: string;
      mode: string;
      item: {
        title: string;
        imageUrls: string[];
        observations: Array<{ market: string; price: number }>;
      };
    };
  }>().result;
  assert.equal(result.status, "READY");
  assert.equal(result.mode, "FIXTURE");
  assert.match(result.item.title, /amazon fixture item/i);
  assert.equal(result.item.imageUrls.length, 2);
  assert.equal(result.item.observations[0]?.market, "AMAZON");
  assert.equal(result.item.observations[0]?.price, 39.99);
});
