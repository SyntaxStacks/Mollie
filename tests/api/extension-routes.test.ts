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

test("extension handoff creates a universal listing task for an inventory item", async () => {
  const session = await createWorkspaceSession("extension-handoff");
  const item = await db.inventoryItem.create({
    data: {
      workspaceId: session.workspaceId,
      sku: `SKU-${crypto.randomUUID().slice(0, 8)}`,
      title: "Vintage flannel shirt",
      brand: "Pendleton",
      category: "Shirts",
      condition: "Good used condition",
      quantity: 1,
      costBasis: 6,
      priceRecommendation: 42,
      attributesJson: {
        description: "Soft wool flannel with a classic plaid pattern."
      },
      imageManifestJson: []
    }
  });

  await db.imageAsset.create({
    data: {
      inventoryItemId: item.id,
      url: "https://images.example.com/flannel.jpg",
      kind: "ORIGINAL",
      position: 0
    }
  });

  const response = await app.inject({
    method: "POST",
    url: "/api/extension/tasks/handoff",
    headers: session.headers,
    payload: {
      inventoryItemId: item.id,
      platform: "EBAY",
      action: "PREPARE_DRAFT"
    }
  });

  assert.equal(response.statusCode, 200);
  const body = response.json() as {
    task: { platform: string; action: string; state: string };
    listing: { inventoryItemId: string; title: string; photos: Array<{ url: string }> };
  };

  assert.equal(body.task.platform, "EBAY");
  assert.equal(body.task.action, "PREPARE_DRAFT");
  assert.equal(body.task.state, "QUEUED");
  assert.equal(body.listing.inventoryItemId, item.id);
  assert.equal(body.listing.title, "Vintage flannel shirt");
  assert.equal(body.listing.photos[0]?.url, "https://images.example.com/flannel.jpg");
});

test("extension eBay import creates inventory and links a published listing", async () => {
  const session = await createWorkspaceSession("extension-ebay-import");

  const ebayAccount = await db.marketplaceAccount.create({
    data: {
      workspaceId: session.workspaceId,
      platform: "EBAY",
      displayName: "Main eBay",
      secretRef: "db-encrypted://marketplace-account/oauth",
      credentialType: "OAUTH_TOKEN_SET",
      validationStatus: "VALID",
      status: "CONNECTED",
      credentialMetadataJson: {
        mode: "oauth"
      },
      credentialPayloadJson: {
        scheme: "db-encrypted-v1"
      }
    }
  });

  const response = await app.inject({
    method: "POST",
    url: "/api/extension/imports/ebay",
    headers: session.headers,
    payload: {
      externalListingId: "135791357913",
      externalUrl: "https://www.ebay.com/itm/135791357913",
      title: "Nintendo Game Boy Advance SP AGS-101",
      description: "Backlit handheld console with charger.",
      price: 129.99,
      category: "Video Game Consoles",
      condition: "Used",
      brand: "Nintendo",
      quantity: 1,
      photos: [
        {
          url: "https://i.ebayimg.com/images/g/example/s-l1600.jpg",
          kind: "PRIMARY"
        }
      ],
      sourceUrl: "https://www.ebay.com/itm/135791357913",
      sourceListingState: "PUBLISHED",
      attributes: {
        Model: "AGS-101"
      }
    }
  });

  assert.equal(response.statusCode, 200);
  const body = response.json() as {
    duplicate: boolean;
    inventoryItemId: string;
    platformListingId: string | null;
    task: { action: string; state: string };
  };

  assert.equal(body.duplicate, false);
  assert.equal(body.task.action, "IMPORT_LISTING");
  assert.equal(body.task.state, "SUCCEEDED");
  assert.ok(body.inventoryItemId);
  assert.ok(body.platformListingId);

  const importedItem = await db.inventoryItem.findUnique({
    where: { id: body.inventoryItemId },
    include: {
      platformListings: true,
      images: true
    }
  });

  assert.ok(importedItem);
  assert.equal(importedItem?.status, "LISTED");
  assert.equal(importedItem?.images[0]?.url, "https://i.ebayimg.com/images/g/example/s-l1600.jpg");
  assert.equal(importedItem?.platformListings[0]?.externalListingId, "135791357913");
  assert.equal(importedItem?.platformListings[0]?.marketplaceAccountId, ebayAccount.id);
});
