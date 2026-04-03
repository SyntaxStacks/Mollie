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
process.env.EBAY_LIVE_PUBLISH_ENABLED ??= "1";

type AppModule = typeof import("../../apps/api/src/index.js");
type DbModule = typeof import("@reselleros/db");
type QueueModule = typeof import("@reselleros/queue");

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
  const [apiModule, dbModule, queueModule] = await Promise.all([
    import("../../apps/api/src/index.js"),
    import("@reselleros/db"),
    import("@reselleros/queue")
  ]);

  app = apiModule.buildApiApp();
  db = dbModule.db;
  setEnqueueHandler = queueModule.setEnqueueHandler;
  setEnqueueHandler(async (name, payload) => {
    queuedJobs.push({ name, payload });
    return { id: `${name}-${queuedJobs.length}` };
  });
  await app.ready();
  await db.$connect();
});

after(async () => {
  setEnqueueHandler(null);

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

test("public URL import applies reviewed candidate into inventory and import run", async () => {
  const session = await createWorkspaceSession("import-url-apply");

  const response = await app.inject({
    method: "POST",
    url: "/api/imports/url/apply",
    headers: session.headers,
    payload: {
      sourcePlatform: "CROSSLIST",
      url: "https://example.com/listing/123",
      candidate: {
        title: "Vintage Denim Jacket",
        brand: "Levi's",
        category: "Outerwear",
        condition: "Good used condition",
        quantity: 1,
        costBasis: 0,
        estimatedResaleMin: 40,
        estimatedResaleMax: 65,
        priceRecommendation: 54,
        sourceUrl: "https://example.com/listing/123",
        externalItemId: "listing-123",
        imageUrls: ["https://images.example.com/jacket.jpg"],
        attributes: {
          source: "crosslist"
        }
      },
      generateDrafts: true,
      draftPlatforms: ["EBAY", "DEPOP"]
    }
  });

  assert.equal(response.statusCode, 200);
  const body = response.json() as {
    item: { id: string; title: string };
    run: { id: string; status: string; appliedCount: number; items: Array<{ status: string }> };
  };

  assert.equal(body.item.title, "Vintage Denim Jacket");
  assert.equal(body.run.status, "SUCCEEDED");
  assert.equal(body.run.appliedCount, 1);
  assert.equal(body.run.items[0]?.status, "APPLIED");
  assert.equal(queuedJobs.at(-1)?.name, "inventory.generateListingDraft");
});

test("linked draft generation queues only ready accounts and reports blocked platforms", async () => {
  queuedJobs.length = 0;
  const session = await createWorkspaceSession("linked-drafts");

  const item = await db.inventoryItem.create({
    data: {
      workspaceId: session.workspaceId,
      sku: `SKU-${crypto.randomUUID().slice(0, 8)}`,
      title: "Nintendo Switch Joy-Con",
      category: "Video Games",
      condition: "Good used condition",
      quantity: 1,
      costBasis: 10,
      attributesJson: {},
      imageManifestJson: []
    }
  });

  await db.marketplaceAccount.create({
    data: {
      workspaceId: session.workspaceId,
      platform: "EBAY",
      displayName: "Main eBay",
      secretRef: "db-encrypted://marketplace-account/oauth",
      credentialType: "OAUTH_TOKEN_SET",
      validationStatus: "VALID",
      status: "CONNECTED",
      credentialMetadataJson: {
        mode: "oauth",
        publishMode: "live-api",
        ebayLiveDefaults: {
          merchantLocationKey: "main-warehouse",
          paymentPolicyId: "payment-policy",
          returnPolicyId: "return-policy",
          fulfillmentPolicyId: "fulfillment-policy"
        }
      },
      credentialPayloadJson: {
        scheme: "db-encrypted-v1"
      }
    }
  });

  await db.marketplaceAccount.create({
    data: {
      workspaceId: session.workspaceId,
      platform: "DEPOP",
      displayName: "Main Depop",
      secretRef: "db-encrypted://marketplace-account/depop",
      credentialType: "SECRET_REF",
      validationStatus: "INVALID",
      status: "ERROR",
      credentialMetadataJson: {
        mode: "browser-session",
        publishMode: "browser-session"
      },
      credentialPayloadJson: {
        scheme: "db-encrypted-v1"
      }
    }
  });

  const response = await app.inject({
    method: "POST",
    url: `/api/inventory/${item.id}/drafts/generate-linked`,
    headers: session.headers
  });

  assert.equal(response.statusCode, 200);
  const body = response.json() as {
    inventoryItemId: string;
    results: Array<{ platform: string; state: string }>;
  };

  assert.equal(body.inventoryItemId, item.id);
  assert.equal(queuedJobs.length, 1);
  assert.equal(queuedJobs[0]?.name, "inventory.generateListingDraft");
  assert.equal(body.results.find((result) => result.platform === "EBAY")?.state, "QUEUED");
  assert.equal(body.results.find((result) => result.platform === "DEPOP")?.state, "BLOCKED");
});
