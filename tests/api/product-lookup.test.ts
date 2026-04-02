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

test("product lookup returns an operator-review candidate for a known barcode", async () => {
  const session = await createWorkspaceSession("product-lookup-known");

  const response = await app.inject({
    method: "POST",
    url: "/api/product-lookup/barcode",
    headers: session.headers,
    payload: {
      barcode: "012345678905"
    }
  });

  assert.equal(response.statusCode, 200);
  const result = response.json<{
    result: {
      barcode: string;
      identifierType: string;
      providerSummary: { simulated: boolean };
      recommendedNextAction: string;
      hint: { title: string };
      candidates: Array<{
        provider: string;
        confidenceState: string;
        safeToPrefill: boolean;
        productUrl: string | null;
        title: string;
      }>;
    };
  }>().result;

  assert.equal(result.barcode, "012345678905");
  assert.equal(result.identifierType, "UPC");
  assert.equal(result.providerSummary.simulated, true);
  assert.match(result.recommendedNextAction, /review/i);
  assert.ok(result.candidates.length >= 1);
  assert.equal(result.candidates[0]?.provider, "AMAZON_ENRICHMENT");
  assert.equal(result.candidates[0]?.confidenceState, "HIGH");
  assert.equal(result.candidates[0]?.safeToPrefill, true);
  assert.match(result.candidates[0]?.productUrl ?? "", /amazon\.com/i);
  assert.match(result.candidates[0]?.title ?? "", /wii remote/i);
});

test("product lookup warns operators when only a low-confidence candidate exists", async () => {
  const session = await createWorkspaceSession("product-lookup-low");

  const response = await app.inject({
    method: "POST",
    url: "/api/product-lookup/barcode",
    headers: session.headers,
    payload: {
      barcode: "111111111111"
    }
  });

  assert.equal(response.statusCode, 200);
  const result = response.json<{
    result: {
      hint: { title: string; explanation: string; nextActions: string[] };
      candidates: Array<{
        provider: string;
        confidenceState: string;
        safeToPrefill: boolean;
      }>;
    };
  }>().result;

  assert.ok(result.candidates.length >= 1);
  assert.equal(result.candidates[0]?.provider, "SIMULATED");
  assert.equal(result.candidates[0]?.confidenceState, "LOW");
  assert.equal(result.candidates[0]?.safeToPrefill, false);
  assert.match(result.hint.title, /low-confidence|possible match|match/i);
  assert.ok(result.hint.nextActions.some((action) => /manual entry/i.test(action)));
});
