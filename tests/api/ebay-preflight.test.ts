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
type DbModule = typeof import("@reselleros/db");

type WorkspaceSession = {
  email: string;
  token: string;
  workspaceId: string;
  headers: Record<string, string>;
};

let app: Awaited<ReturnType<AppModule["buildApiApp"]>>;
let db: DbModule["db"];
const createdEmails = new Set<string>();
const originalLiveFlag = process.env.EBAY_LIVE_PUBLISH_ENABLED;
const originalMerchantLocationKey = process.env.EBAY_MERCHANT_LOCATION_KEY;
const originalPaymentPolicyId = process.env.EBAY_PAYMENT_POLICY_ID;
const originalReturnPolicyId = process.env.EBAY_RETURN_POLICY_ID;
const originalFulfillmentPolicyId = process.env.EBAY_FULFILLMENT_POLICY_ID;

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
      costBasis: 12,
      attributes: {
        source: "test"
      }
    }
  });

  assert.equal(response.statusCode, 200);
  return (response.json() as { item: { id: string } }).item;
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
  process.env.EBAY_LIVE_PUBLISH_ENABLED = originalLiveFlag;
  process.env.EBAY_MERCHANT_LOCATION_KEY = originalMerchantLocationKey;
  process.env.EBAY_PAYMENT_POLICY_ID = originalPaymentPolicyId;
  process.env.EBAY_RETURN_POLICY_ID = originalReturnPolicyId;
  process.env.EBAY_FULFILLMENT_POLICY_ID = originalFulfillmentPolicyId;

  for (const email of createdEmails) {
    await db.user.deleteMany({
      where: { email }
    });
  }

  if (app) {
    await app.close();
  }

  await db.$disconnect();
});

test("ebay preflight shows blocked checks when inventory is not publishable", async () => {
  process.env.EBAY_LIVE_PUBLISH_ENABLED = "false";
  const session = await createWorkspaceSession("ebay-preflight-blocked");
  const item = await createInventoryItem(session);

  const response = await app.inject({
    method: "GET",
    url: `/api/inventory/${item.id}/preflight/ebay`,
    headers: session.headers
  });

  assert.equal(response.statusCode, 200);
  const body = response.json() as {
    preflight: {
      state: string | null;
      ready: boolean;
      mode: string;
      summary: string;
      hint: {
        title: string;
        severity: string;
        routeTarget: string | null;
        nextActions: string[];
      };
      checks: Array<{ key: string; status: string }>;
    };
  };

  assert.equal(body.preflight.ready, false);
  assert.equal(body.preflight.state, null);
  assert.equal(body.preflight.mode, "simulated");
  assert.match(body.preflight.summary, /add at least one image/i);
  assert.equal(body.preflight.hint.title, "Add photos before sending this item to eBay.");
  assert.equal(body.preflight.hint.severity, "ERROR");
  assert.equal(body.preflight.hint.routeTarget, null);
  assert.equal(body.preflight.hint.nextActions.some((action) => /upload at least one image/i.test(action)), true);
  assert.equal(body.preflight.checks.find((check) => check.key === "images")?.status, "BLOCKED");
  assert.equal(body.preflight.checks.find((check) => check.key === "draft")?.status, "BLOCKED");
  assert.equal(body.preflight.checks.find((check) => check.key === "account")?.status, "BLOCKED");
});

test("ebay preflight shows ready for the simulated pilot path when account, draft, and image exist", async () => {
  process.env.EBAY_LIVE_PUBLISH_ENABLED = "false";
  const session = await createWorkspaceSession("ebay-preflight-ready");
  const item = await createInventoryItem(session);

  const connectAccountResponse = await app.inject({
    method: "POST",
    url: "/api/marketplace-accounts/ebay/connect",
    headers: session.headers,
    payload: {
      displayName: "Manual eBay",
      secretRef: "secret://ebay/manual"
    }
  });
  assert.equal(connectAccountResponse.statusCode, 200);

  const imageResponse = await app.inject({
    method: "POST",
    url: `/api/inventory/${item.id}/images`,
    headers: session.headers,
    payload: {
      url: "https://cdn.example.com/item-1.jpg",
      position: 0
    }
  });
  assert.equal(imageResponse.statusCode, 200);

  const createDraftResponse = await db.listingDraft.create({
    data: {
      inventoryItemId: item.id,
      platform: "EBAY",
      generatedTitle: "Pilot eBay Draft",
      generatedDescription: "Approved eBay draft",
      generatedPrice: 42,
      generatedTagsJson: [],
      attributesJson: {},
      reviewStatus: "APPROVED"
    }
  });
  assert.ok(createDraftResponse.id);

  const response = await app.inject({
    method: "GET",
    url: `/api/inventory/${item.id}/preflight/ebay`,
    headers: session.headers
  });

  assert.equal(response.statusCode, 200);
  const body = response.json() as {
    preflight: {
      state: string | null;
      ready: boolean;
      mode: string;
      selectedCredentialType: string | null;
      summary: string;
      hint: {
        title: string;
        severity: string;
        canContinue: boolean;
      };
      checks: Array<{ key: string; status: string }>;
    };
  };

  assert.equal(body.preflight.ready, true);
  assert.equal(body.preflight.state, "SIMULATED");
  assert.equal(body.preflight.mode, "simulated");
  assert.equal(body.preflight.selectedCredentialType, "SECRET_REF");
  assert.match(body.preflight.summary, /ready for simulated ebay publish/i);
  assert.equal(body.preflight.hint.title, "This item is ready for the simulated eBay path.");
  assert.equal(body.preflight.hint.severity, "SUCCESS");
  assert.equal(body.preflight.hint.canContinue, true);
  assert.equal(body.preflight.checks.find((check) => check.key === "images")?.status, "READY");
  assert.equal(body.preflight.checks.find((check) => check.key === "draft")?.status, "READY");
  assert.equal(body.preflight.checks.find((check) => check.key === "account")?.status, "READY");
});

test("ebay preflight turns ready for live publish after updating the approved draft category", async () => {
  process.env.EBAY_LIVE_PUBLISH_ENABLED = "true";
  process.env.EBAY_MERCHANT_LOCATION_KEY = "pilot-location";
  process.env.EBAY_PAYMENT_POLICY_ID = "payment-policy";
  process.env.EBAY_RETURN_POLICY_ID = "return-policy";
  process.env.EBAY_FULFILLMENT_POLICY_ID = "fulfillment-policy";

  const session = await createWorkspaceSession("ebay-preflight-live-category");
  const item = await createInventoryItem(session);

  const imageResponse = await app.inject({
    method: "POST",
    url: `/api/inventory/${item.id}/images`,
    headers: session.headers,
    payload: {
      url: "https://cdn.example.com/live-item-1.jpg",
      position: 0
    }
  });
  assert.equal(imageResponse.statusCode, 200);

  await db.marketplaceAccount.create({
    data: {
      workspaceId: session.workspaceId,
      platform: "EBAY",
      displayName: "OAuth eBay",
      secretRef: "oauth://ebay/test",
      credentialType: "OAUTH_TOKEN_SET",
      validationStatus: "VALID",
      externalAccountId: `ebay-user-${crypto.randomUUID().slice(0, 8)}`,
      credentialMetadataJson: {
        mode: "oauth",
        publishMode: "foundation-only"
      },
      status: "CONNECTED",
      lastValidatedAt: new Date()
    }
  });

  const draft = await db.listingDraft.create({
    data: {
      inventoryItemId: item.id,
      platform: "EBAY",
      generatedTitle: "Live eBay Draft",
      generatedDescription: "Approved live draft",
      generatedPrice: 58,
      generatedTagsJson: [],
      attributesJson: {},
      reviewStatus: "APPROVED"
    }
  });

  const blockedResponse = await app.inject({
    method: "GET",
    url: `/api/inventory/${item.id}/preflight/ebay`,
    headers: session.headers
  });

  assert.equal(blockedResponse.statusCode, 200);
  const blockedBody = blockedResponse.json() as {
    preflight: {
      state: string | null;
      ready: boolean;
      mode: string;
      hint: {
        title: string;
        severity: string;
        featureFamily: string | null;
      };
      checks: Array<{ key: string; status: string }>;
    };
  };

  assert.equal(blockedBody.preflight.ready, false);
  assert.equal(blockedBody.preflight.state, "LIVE_READY");
  assert.equal(blockedBody.preflight.mode, "live");
  assert.equal(blockedBody.preflight.hint.title, "Add the eBay category mapping before live publish.");
  assert.equal(blockedBody.preflight.hint.severity, "WARNING");
  assert.equal(blockedBody.preflight.hint.featureFamily, "EBAY_POLICY_CONFIGURATION");
  assert.equal(blockedBody.preflight.checks.find((check) => check.key === "category")?.status, "BLOCKED");
  assert.equal(blockedBody.preflight.checks.find((check) => check.key === "account")?.status, "READY");
  assert.equal(blockedBody.preflight.checks.find((check) => check.key === "live-config")?.status, "READY");

  const updateDraftResponse = await app.inject({
    method: "PATCH",
    url: `/api/drafts/${draft.id}`,
    headers: session.headers,
    payload: {
      generatedTitle: "Live eBay Draft Updated",
      generatedPrice: 64,
      attributes: {
        ebayCategoryId: "15724",
        ebayStoreCategoryId: "101"
      }
    }
  });

  assert.equal(updateDraftResponse.statusCode, 200);

  const readyResponse = await app.inject({
    method: "GET",
    url: `/api/inventory/${item.id}/preflight/ebay`,
    headers: session.headers
  });

  assert.equal(readyResponse.statusCode, 200);
  const readyBody = readyResponse.json() as {
    preflight: {
      state: string | null;
      ready: boolean;
      mode: string;
      summary: string;
      hint: {
        title: string;
        severity: string;
        featureFamily: string | null;
      };
      checks: Array<{ key: string; status: string }>;
    };
  };

  assert.equal(readyBody.preflight.ready, true);
  assert.equal(readyBody.preflight.state, "LIVE_READY");
  assert.equal(readyBody.preflight.mode, "live");
  assert.match(readyBody.preflight.summary, /ready for live ebay publish/i);
  assert.equal(readyBody.preflight.hint.title, "This item is ready for live eBay publish.");
  assert.equal(readyBody.preflight.hint.severity, "SUCCESS");
  assert.equal(readyBody.preflight.hint.featureFamily, "EBAY_POLICY_CONFIGURATION");
  assert.equal(readyBody.preflight.checks.find((check) => check.key === "category")?.status, "READY");
});

test("ebay preflight accepts account-level live defaults when env policy settings are absent", async () => {
  process.env.EBAY_LIVE_PUBLISH_ENABLED = "true";
  process.env.EBAY_MERCHANT_LOCATION_KEY = undefined;
  process.env.EBAY_PAYMENT_POLICY_ID = undefined;
  process.env.EBAY_RETURN_POLICY_ID = undefined;
  process.env.EBAY_FULFILLMENT_POLICY_ID = undefined;

  const session = await createWorkspaceSession("ebay-preflight-account-defaults");
  const item = await createInventoryItem(session);

  const imageResponse = await app.inject({
    method: "POST",
    url: `/api/inventory/${item.id}/images`,
    headers: session.headers,
    payload: {
      url: "https://cdn.example.com/account-defaults-item.jpg",
      position: 0
    }
  });
  assert.equal(imageResponse.statusCode, 200);

  await db.marketplaceAccount.create({
    data: {
      workspaceId: session.workspaceId,
      platform: "EBAY",
      displayName: "OAuth eBay",
      secretRef: "oauth://ebay/test",
      credentialType: "OAUTH_TOKEN_SET",
      validationStatus: "VALID",
      externalAccountId: `ebay-user-${crypto.randomUUID().slice(0, 8)}`,
      credentialMetadataJson: {
        mode: "oauth",
        publishMode: "foundation-only",
        ebayLiveDefaults: {
          merchantLocationKey: "pilot-warehouse",
          paymentPolicyId: "payment-policy",
          returnPolicyId: "return-policy",
          fulfillmentPolicyId: "fulfillment-policy"
        }
      },
      status: "CONNECTED",
      lastValidatedAt: new Date()
    }
  });

  await db.listingDraft.create({
    data: {
      inventoryItemId: item.id,
      platform: "EBAY",
      generatedTitle: "Live eBay Draft",
      generatedDescription: "Approved live draft",
      generatedPrice: 58,
      generatedTagsJson: [],
      attributesJson: {
        ebayCategoryId: "15724"
      },
      reviewStatus: "APPROVED"
    }
  });

  const response = await app.inject({
    method: "GET",
    url: `/api/inventory/${item.id}/preflight/ebay`,
    headers: session.headers
  });

  assert.equal(response.statusCode, 200);
  const body = response.json() as {
    preflight: {
      state: string | null;
      ready: boolean;
      mode: string;
      checks: Array<{ key: string; status: string; detail: string }>;
    };
  };

  assert.equal(body.preflight.ready, true);
  assert.equal(body.preflight.state, "LIVE_READY");
  assert.equal(body.preflight.mode, "live");
  assert.equal(body.preflight.checks.find((check) => check.key === "live-config")?.status, "READY");
});
