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

test("poshmark readiness reports strict missing fields", async () => {
  const session = await createWorkspaceSession("remote-poshmark-readiness");
  const item = await db.inventoryItem.create({
    data: {
      workspaceId: session.workspaceId,
      sku: `SKU-${crypto.randomUUID().slice(0, 8)}`,
      title: "Nike hoodie",
      brand: null,
      category: "Apparel",
      condition: "Good used condition",
      quantity: 1,
      costBasis: 8,
      priceRecommendation: 42,
      attributesJson: {},
      imageManifestJson: []
    }
  });

  await db.imageAsset.create({
    data: {
      inventoryItemId: item.id,
      url: "https://images.example.com/hoodie.jpg",
      kind: "ORIGINAL",
      position: 0
    }
  });

  const response = await app.inject({
    method: "GET",
    url: `/api/automation/poshmark/readiness/${item.id}`,
    headers: session.headers
  });

  assert.equal(response.statusCode, 200);
  const body = response.json() as {
    readiness: {
      ready: boolean;
      missingFields: string[];
      blockingReasons: string[];
      transformPlan: { imageMode: string };
    };
  };

  assert.equal(body.readiness.ready, false);
  assert.deepEqual(body.readiness.missingFields, ["description", "size", "brand"]);
  assert.deepEqual(body.readiness.blockingReasons, ["Approve a Poshmark draft before queueing publish."]);
  assert.equal(body.readiness.transformPlan.imageMode, "PAD_TO_SQUARE");
});

test("poshmark publish queues a remote automation task and pending listing", async () => {
  const session = await createWorkspaceSession("remote-poshmark-publish");
  const item = await db.inventoryItem.create({
    data: {
      workspaceId: session.workspaceId,
      sku: `SKU-${crypto.randomUUID().slice(0, 8)}`,
      title: "Coach shoulder bag",
      brand: "Coach",
      category: "Bags",
      condition: "Excellent used condition",
      quantity: 1,
      costBasis: 20,
      priceRecommendation: 140,
      attributesJson: {
        description: "Pebbled leather shoulder bag in excellent used condition."
      },
      imageManifestJson: []
    }
  });

  await db.imageAsset.create({
    data: {
      inventoryItemId: item.id,
      url: "https://images.example.com/bag.jpg",
      kind: "ORIGINAL",
      position: 0
    }
  });

  await db.listingDraft.create({
    data: {
      inventoryItemId: item.id,
      platform: "POSHMARK",
      generatedTitle: "Coach pebbled leather shoulder bag",
      generatedDescription: "Pebbled leather shoulder bag in excellent used condition.",
      generatedPrice: 140,
      generatedTagsJson: [],
      attributesJson: {},
      reviewStatus: "APPROVED"
    }
  });

  await db.marketplaceAccount.create({
    data: {
      workspaceId: session.workspaceId,
      platform: "POSHMARK",
      displayName: "Main Poshmark closet",
      secretRef: "db-encrypted://marketplace-account/poshmark",
      credentialType: "SECRET_REF",
      validationStatus: "VALID",
      status: "CONNECTED",
      credentialMetadataJson: {
        mode: "remote-session-artifact",
        publishMode: "remote",
        accountHandle: "main-poshmark-closet"
      }
    }
  });

  const response = await app.inject({
    method: "POST",
    url: `/api/inventory/${item.id}/publish/poshmark`,
    headers: session.headers
  });

  assert.equal(response.statusCode, 200);

  const task = await db.automationTask.findFirst({
    where: {
      workspaceId: session.workspaceId,
      inventoryItemId: item.id,
      platform: "POSHMARK"
    },
    orderBy: { createdAt: "desc" }
  });
  assert.ok(task);
  assert.equal(task?.action, "PUBLISH_LISTING");
  assert.equal(task?.state, "QUEUED");
  assert.equal((task?.payloadJson as { remoteAutomation?: boolean } | null)?.remoteAutomation, true);

  const listing = await db.platformListing.findFirst({
    where: {
      inventoryItemId: item.id,
      platform: "POSHMARK"
    }
  });
  assert.ok(listing);
  assert.equal(listing?.status, "PENDING");
});

test("depop publish queues a remote automation task", async () => {
  const session = await createWorkspaceSession("remote-depop-publish");
  const item = await db.inventoryItem.create({
    data: {
      workspaceId: session.workspaceId,
      sku: `SKU-${crypto.randomUUID().slice(0, 8)}`,
      title: "Vintage canvas jacket",
      brand: "Mollie Test",
      category: "Jackets",
      condition: "Good used condition",
      quantity: 1,
      costBasis: 18,
      priceRecommendation: 64,
      attributesJson: {
        description: "Vintage canvas jacket with light wear.",
        marketplaceOverrides: {
          DEPOP: {
            attributes: {
              department: "Men",
              productType: "Jackets",
              packageSize: "Medium"
            }
          }
        }
      },
      imageManifestJson: []
    }
  });

  await db.imageAsset.create({
    data: {
      inventoryItemId: item.id,
      url: "https://images.example.com/jacket.jpg",
      kind: "ORIGINAL",
      position: 0
    }
  });

  await db.listingDraft.create({
    data: {
      inventoryItemId: item.id,
      platform: "DEPOP",
      generatedTitle: "Vintage canvas jacket",
      generatedDescription: "Vintage canvas jacket with light wear.",
      generatedPrice: 64,
      generatedTagsJson: [],
      attributesJson: {},
      reviewStatus: "APPROVED"
    }
  });

  await db.marketplaceAccount.create({
    data: {
      workspaceId: session.workspaceId,
      platform: "DEPOP",
      displayName: "Main Depop shop",
      secretRef: "db-encrypted://marketplace-account/depop",
      credentialType: "SECRET_REF",
      validationStatus: "VALID",
      status: "CONNECTED",
      credentialMetadataJson: {
        mode: "remote-session-artifact",
        publishMode: "remote",
        accountHandle: "main-depop-shop"
      }
    }
  });

  const response = await app.inject({
    method: "POST",
    url: `/api/inventory/${item.id}/publish/depop`,
    headers: {
      ...session.headers,
      "content-type": "application/json"
    }
  });

  assert.equal(response.statusCode, 200);

  const task = await db.automationTask.findFirst({
    where: {
      workspaceId: session.workspaceId,
      inventoryItemId: item.id,
      platform: "DEPOP"
    },
    orderBy: { createdAt: "desc" }
  });
  assert.ok(task);
  assert.equal(task?.action, "PUBLISH_LISTING");
  assert.equal(task?.state, "QUEUED");
  assert.equal((task?.payloadJson as { remoteAutomation?: boolean } | null)?.remoteAutomation, true);
  assert.equal((task?.payloadJson as { runtime?: string } | null)?.runtime, "browser-grid");

  const listing = await db.platformListing.findFirst({
    where: {
      inventoryItemId: item.id,
      platform: "DEPOP"
    }
  });
  assert.ok(listing);
  assert.equal(listing?.status, "PENDING");
});

test("poshmark social config saves and can queue a share closet task", async () => {
  const session = await createWorkspaceSession("remote-poshmark-social");
  const account = await db.marketplaceAccount.create({
    data: {
      workspaceId: session.workspaceId,
      platform: "POSHMARK",
      displayName: "Main Poshmark closet",
      secretRef: "db-encrypted://marketplace-account/poshmark-social",
      credentialType: "SECRET_REF",
      validationStatus: "VALID",
      status: "CONNECTED",
      credentialMetadataJson: {
        mode: "remote-session-artifact",
        publishMode: "remote",
        accountHandle: "main-poshmark-closet"
      }
    }
  });

  const saveResponse = await app.inject({
    method: "PATCH",
    url: "/api/automation/poshmark/social",
    headers: session.headers,
    payload: {
      shareCloset: {
        enabled: true,
        intervalMinutes: 90
      },
      shareListings: {
        enabled: false,
        intervalMinutes: 240
      },
      sendOffersToLikers: {
        enabled: false,
        intervalMinutes: 360
      }
    }
  });

  assert.equal(saveResponse.statusCode, 200);

  const refreshedAccount = await db.marketplaceAccount.findUnique({
    where: { id: account.id }
  });
  const metadata = refreshedAccount?.credentialMetadataJson as { poshmarkSocialConfig?: { shareCloset?: { enabled?: boolean; intervalMinutes?: number } } } | null;
  assert.equal(metadata?.poshmarkSocialConfig?.shareCloset?.enabled, true);
  assert.equal(metadata?.poshmarkSocialConfig?.shareCloset?.intervalMinutes, 90);

  const runResponse = await app.inject({
    method: "POST",
    url: "/api/automation/poshmark/social/run",
    headers: session.headers,
    payload: {
      action: "SHARE_CLOSET"
    }
  });

  assert.equal(runResponse.statusCode, 200);
  const socialTask = await db.automationTask.findFirst({
    where: {
      workspaceId: session.workspaceId,
      marketplaceAccountId: account.id,
      platform: "POSHMARK",
      action: "UPDATE_LISTING"
    },
    orderBy: { createdAt: "desc" }
  });

  assert.ok(socialTask);
  assert.equal((socialTask?.payloadJson as { remoteTaskType?: string } | null)?.remoteTaskType, "SHARE_CLOSET");
});




