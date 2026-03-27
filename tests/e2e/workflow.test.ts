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
type EbayModule = typeof import("../../packages/marketplaces-ebay/src/index.js");

let app: Awaited<ReturnType<AppModule["buildApiApp"]>>;
let db: DbModule["db"];
let setEnqueueHandler: QueueModule["setEnqueueHandler"];
let processWorkerJob: WorkerModule["processWorkerJob"];
let processConnectorJob: ConnectorModule["processConnectorJob"];
let encryptEbayCredentialPayload: EbayModule["encryptEbayCredentialPayload"];
const queuedJobs: EnqueuedJob[] = [];
const createdEmails = new Set<string>();
const originalFetch = global.fetch;
const originalLiveFlag = process.env.EBAY_LIVE_PUBLISH_ENABLED;
const originalMarketplaceId = process.env.EBAY_MARKETPLACE_ID;
const originalCurrency = process.env.EBAY_CURRENCY;
const originalMerchantLocationKey = process.env.EBAY_MERCHANT_LOCATION_KEY;
const originalPaymentPolicyId = process.env.EBAY_PAYMENT_POLICY_ID;
const originalReturnPolicyId = process.env.EBAY_RETURN_POLICY_ID;
const originalFulfillmentPolicyId = process.env.EBAY_FULFILLMENT_POLICY_ID;
const originalScopes = process.env.EBAY_SCOPES;
const originalClientId = process.env.EBAY_CLIENT_ID;
const originalClientSecret = process.env.EBAY_CLIENT_SECRET;
const originalRedirectUri = process.env.EBAY_REDIRECT_URI;
const originalEnvironment = process.env.EBAY_ENVIRONMENT;

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
      if (
        job.name === "listing.publishDepop" ||
        job.name === "listing.publishPoshmark" ||
        job.name === "listing.publishWhatnot"
      ) {
        await processConnectorJob(
          job.name as Parameters<ConnectorModule["processConnectorJob"]>[0],
          job.payload as Parameters<ConnectorModule["processConnectorJob"]>[1]
        );
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

async function connectMarketplace(session: WorkspaceSession, platform: "EBAY" | "DEPOP" | "POSHMARK" | "WHATNOT") {
  const url =
    platform === "EBAY"
      ? "/api/marketplace-accounts/ebay/connect"
      : platform === "DEPOP"
        ? "/api/marketplace-accounts/depop/session"
        : platform === "POSHMARK"
          ? "/api/marketplace-accounts/poshmark/session"
          : "/api/marketplace-accounts/whatnot/session";
  const response = await app.inject({
    method: "POST",
    url,
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
  platform: "EBAY" | "DEPOP" | "POSHMARK" | "WHATNOT"
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

async function queuePublish(
  session: WorkspaceSession,
  inventoryItemId: string,
  platform: "EBAY" | "DEPOP" | "POSHMARK" | "WHATNOT"
) {
  const url =
    platform === "EBAY"
      ? `/api/inventory/${inventoryItemId}/publish/ebay`
      : platform === "DEPOP"
        ? `/api/inventory/${inventoryItemId}/publish/depop`
        : platform === "POSHMARK"
          ? `/api/inventory/${inventoryItemId}/publish/poshmark`
          : `/api/inventory/${inventoryItemId}/publish/whatnot`;
  const response = await app.inject({
    method: "POST",
    url,
    headers: session.headers
  });

  assert.equal(response.statusCode, 200);
  return (response.json() as { executionLog: { id: string } }).executionLog;
}

before(async () => {
  const [apiModule, dbModule, queueModule, workerModule, connectorModule, ebayModule] = await Promise.all([
    import("../../apps/api/src/index.js"),
    import("@reselleros/db"),
    import("@reselleros/queue"),
    import("../../apps/worker/src/jobs.js"),
    import("../../apps/connector-runner/src/jobs.js"),
    import("../../packages/marketplaces-ebay/src/index.js")
  ]);

  app = apiModule.buildApiApp();
  db = dbModule.db;
  setEnqueueHandler = queueModule.setEnqueueHandler;
  processWorkerJob = workerModule.processWorkerJob;
  processConnectorJob = connectorModule.processConnectorJob;
  encryptEbayCredentialPayload = ebayModule.encryptEbayCredentialPayload;

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
  global.fetch = originalFetch;
  process.env.EBAY_LIVE_PUBLISH_ENABLED = originalLiveFlag;
  process.env.EBAY_MARKETPLACE_ID = originalMarketplaceId;
  process.env.EBAY_CURRENCY = originalCurrency;
  process.env.EBAY_MERCHANT_LOCATION_KEY = originalMerchantLocationKey;
  process.env.EBAY_PAYMENT_POLICY_ID = originalPaymentPolicyId;
  process.env.EBAY_RETURN_POLICY_ID = originalReturnPolicyId;
  process.env.EBAY_FULFILLMENT_POLICY_ID = originalFulfillmentPolicyId;
  process.env.EBAY_SCOPES = originalScopes;
  process.env.EBAY_CLIENT_ID = originalClientId;
  process.env.EBAY_CLIENT_SECRET = originalClientSecret;
  process.env.EBAY_REDIRECT_URI = originalRedirectUri;
  process.env.EBAY_ENVIRONMENT = originalEnvironment;
});

after(async () => {
  global.fetch = originalFetch;
  process.env.EBAY_LIVE_PUBLISH_ENABLED = originalLiveFlag;
  process.env.EBAY_MARKETPLACE_ID = originalMarketplaceId;
  process.env.EBAY_CURRENCY = originalCurrency;
  process.env.EBAY_MERCHANT_LOCATION_KEY = originalMerchantLocationKey;
  process.env.EBAY_PAYMENT_POLICY_ID = originalPaymentPolicyId;
  process.env.EBAY_RETURN_POLICY_ID = originalReturnPolicyId;
  process.env.EBAY_FULFILLMENT_POLICY_ID = originalFulfillmentPolicyId;
  process.env.EBAY_SCOPES = originalScopes;
  process.env.EBAY_CLIENT_ID = originalClientId;
  process.env.EBAY_CLIENT_SECRET = originalClientSecret;
  process.env.EBAY_REDIRECT_URI = originalRedirectUri;
  process.env.EBAY_ENVIRONMENT = originalEnvironment;

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

test("worker publishes a live ebay listing for an oauth account and persists refreshed credentials", async () => {
  process.env.EBAY_LIVE_PUBLISH_ENABLED = "true";
  process.env.EBAY_ENVIRONMENT = "sandbox";
  process.env.EBAY_CLIENT_ID = "pilot-ebay-client-id";
  process.env.EBAY_CLIENT_SECRET = "pilot-ebay-client-secret";
  process.env.EBAY_REDIRECT_URI = "http://localhost:4000/api/marketplace-accounts/ebay/oauth/callback";
  process.env.EBAY_SCOPES =
    "https://api.ebay.com/oauth/api_scope/sell.inventory https://api.ebay.com/oauth/api_scope/commerce.identity.readonly";
  process.env.EBAY_MARKETPLACE_ID = "EBAY_US";
  process.env.EBAY_CURRENCY = "USD";
  process.env.EBAY_MERCHANT_LOCATION_KEY = "pilot-warehouse";
  process.env.EBAY_PAYMENT_POLICY_ID = "payment-policy";
  process.env.EBAY_RETURN_POLICY_ID = "return-policy";
  process.env.EBAY_FULFILLMENT_POLICY_ID = "fulfillment-policy";

  const requests: Array<{ url: string; method: string; body: unknown }> = [];
  global.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : init?.body ?? null;
    requests.push({ url, method, body });

    if (url.includes("/identity/v1/oauth2/token")) {
      return new Response(
        JSON.stringify({
          access_token: "fresh-access-token",
          token_type: "User Access Token",
          expires_in: 7200,
          refresh_token: "fresh-refresh-token",
          refresh_token_expires_in: 47304000,
          scope: process.env.EBAY_SCOPES
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json"
          }
        }
      );
    }

    if (url.includes("/sell/inventory/v1/inventory_item/")) {
      return new Response(null, { status: 204 });
    }

    if (url.endsWith("/sell/inventory/v1/offer")) {
      return new Response(JSON.stringify({ offerId: "offer-live-123" }), {
        status: 200,
        headers: {
          "Content-Type": "application/json"
        }
      });
    }

    if (url.endsWith("/sell/inventory/v1/offer/offer-live-123/publish")) {
      return new Response(JSON.stringify({ listingId: "2200000002" }), {
        status: 200,
        headers: {
          "Content-Type": "application/json"
        }
      });
    }

    throw new Error(`Unexpected fetch request: ${method} ${url}`);
  }) as typeof fetch;

  const session = await createWorkspaceSession("pilot-live-ebay");
  const item = await createInventoryItem(session, {
    title: "Vintage Jacket",
    brand: "Levi's",
    category: "Outerwear",
    condition: "Good used condition"
  });

  const imageResponse = await app.inject({
    method: "POST",
    url: `/api/inventory/${item.id}/images`,
    headers: session.headers,
    payload: {
      url: "https://cdn.example.com/jacket-live-1.jpg",
      position: 0
    }
  });
  assert.equal(imageResponse.statusCode, 200);

  const oauthAccount = await db.marketplaceAccount.create({
    data: {
      workspaceId: session.workspaceId,
      platform: "EBAY",
      displayName: "Pilot Seller",
      secretRef: "db-encrypted://marketplace-account/oauth",
      credentialType: "OAUTH_TOKEN_SET",
      validationStatus: "VALID",
      externalAccountId: "ebay-user-live",
      credentialMetadataJson: {
        mode: "oauth",
        username: "pilot-seller",
        accessTokenExpiresAt: new Date(Date.now() - 30_000).toISOString(),
        publishMode: "foundation-only"
      },
      credentialPayloadJson: encryptEbayCredentialPayload({
        accessToken: "expired-access-token",
        refreshToken: "refresh-token",
        tokenType: "User Access Token",
        scopes: process.env.EBAY_SCOPES?.split(" ") ?? [],
        issuedAt: new Date(Date.now() - 60_000).toISOString(),
        accessTokenExpiresAt: new Date(Date.now() - 30_000).toISOString(),
        refreshTokenExpiresAt: new Date(Date.now() + 86400000).toISOString()
      }),
      status: "CONNECTED",
      lastValidatedAt: new Date()
    }
  });

  const draft = await generateAndApproveDraft(session, item.id, "EBAY");

  const updateDraftResponse = await app.inject({
    method: "PATCH",
    url: `/api/drafts/${draft.id}`,
    headers: session.headers,
    payload: {
      attributes: {
        ebayCategoryId: "57988"
      }
    }
  });
  assert.equal(updateDraftResponse.statusCode, 200);

  const executionLog = await queuePublish(session, item.id, "EBAY");
  await drainQueuedJobs();

  const [publishedItem, listing, persistedExecutionLog, refreshedAccount] = await Promise.all([
    db.inventoryItem.findUnique({
      where: { id: item.id }
    }),
    db.platformListing.findFirst({
      where: {
        inventoryItemId: item.id,
        marketplaceAccountId: oauthAccount.id,
        platform: "EBAY"
      }
    }),
    db.executionLog.findUnique({
      where: { id: executionLog.id }
    }),
    db.marketplaceAccount.findUnique({
      where: { id: oauthAccount.id }
    })
  ]);

  assert.ok(publishedItem);
  assert.equal(publishedItem.status, "LISTED");

  assert.ok(listing);
  assert.equal(listing.status, "PUBLISHED");
  assert.equal(listing.externalListingId, "2200000002");
  assert.equal(listing.externalUrl, "https://www.sandbox.ebay.com/itm/2200000002");
  assert.equal((listing.rawLastResponseJson as { mode?: string }).mode, "live");

  assert.ok(persistedExecutionLog);
  assert.equal(persistedExecutionLog.status, "SUCCEEDED");

  assert.ok(refreshedAccount);
  assert.equal(refreshedAccount.validationStatus, "VALID");
  assert.equal(refreshedAccount.lastErrorCode, null);
  assert.equal(refreshedAccount.lastErrorMessage, null);
  assert.equal((refreshedAccount.credentialMetadataJson as { publishMode?: string }).publishMode, "live-api");
  assert.equal(JSON.stringify(refreshedAccount.credentialPayloadJson).includes("fresh-access-token"), false);
  assert.equal(requests.length, 4);
  assert.match(requests[0]?.url ?? "", /identity\/v1\/oauth2\/token/i);
  assert.match(requests[1]?.url ?? "", /sell\/inventory\/v1\/inventory_item/i);
  assert.equal((requests[2]?.body as { categoryId?: string })?.categoryId, "57988");

  global.fetch = originalFetch;
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

test("poshmark and whatnot failures also run through connector isolation and artifact capture", async () => {
  const session = await createWorkspaceSession("connector-isolation");
  await connectMarketplace(session, "POSHMARK");
  await connectMarketplace(session, "WHATNOT");

  const item = await createInventoryItem(session, {
    title: "Connector Isolation Item"
  });

  await generateAndApproveDraft(session, item.id, "POSHMARK");
  await generateAndApproveDraft(session, item.id, "WHATNOT");

  const [poshmarkExecutionLog, whatnotExecutionLog] = await Promise.all([
    queuePublish(session, item.id, "POSHMARK"),
    queuePublish(session, item.id, "WHATNOT")
  ]);

  const jobErrors = await drainQueuedJobs({ continueOnError: true });
  assert.equal(jobErrors.length, 2);
  assert.ok(jobErrors.every((error) => /requires at least one image/i.test(error.message)));

  const [persistedExecutionLogs, accounts, persistedItem] = await Promise.all([
    db.executionLog.findMany({
      where: {
        id: {
          in: [poshmarkExecutionLog.id, whatnotExecutionLog.id]
        }
      },
      orderBy: { jobName: "asc" }
    }),
    db.marketplaceAccount.findMany({
      where: {
        workspaceId: session.workspaceId,
        platform: {
          in: ["POSHMARK", "WHATNOT"]
        }
      },
      orderBy: { platform: "asc" }
    }),
    db.inventoryItem.findUnique({
      where: { id: item.id }
    })
  ]);

  assert.equal(persistedExecutionLogs.length, 2);
  assert.ok(persistedExecutionLogs.every((log) => log.status === "FAILED"));

  for (const log of persistedExecutionLogs) {
    const responsePayload = log.responsePayloadJson as Record<string, unknown>;
    const artifactUrls = log.artifactUrlsJson as string[];

    assert.equal(responsePayload.code, "PREREQUISITE_MISSING");
    assert.equal(responsePayload.retryable, false);
    assert.ok(Array.isArray(artifactUrls));
    assert.equal(artifactUrls.length, 2);

    for (const artifactPath of artifactUrls) {
      await access(artifactPath);
    }
  }

  assert.equal(accounts.length, 2);
  assert.ok(accounts.every((account) => account.consecutiveFailureCount === 1));
  assert.ok(accounts.every((account) => account.status === "CONNECTED"));
  assert.ok(accounts.every((account) => account.lastErrorCode === "PREREQUISITE_MISSING"));

  assert.ok(persistedItem);
  assert.equal(persistedItem.status, "READY");
});

test("operator can cross-list to poshmark and whatnot with simulated accounts", async () => {
  const session = await createWorkspaceSession("cross-list-operator");
  await connectMarketplace(session, "POSHMARK");
  await connectMarketplace(session, "WHATNOT");

  const item = await createInventoryItem(session, {
    title: "Vintage Denim Jacket",
    brand: "Levi's",
    category: "Outerwear",
    condition: "Good used condition"
  });

  const imageResponse = await app.inject({
    method: "POST",
    url: `/api/inventory/${item.id}/images`,
    headers: session.headers,
    payload: {
      url: "https://cdn.example.com/vintage-denim-jacket.jpg",
      position: 0
    }
  });
  assert.equal(imageResponse.statusCode, 200);

  await generateAndApproveDraft(session, item.id, "POSHMARK");
  await generateAndApproveDraft(session, item.id, "WHATNOT");

  const [poshmarkExecutionLog, whatnotExecutionLog] = await Promise.all([
    queuePublish(session, item.id, "POSHMARK"),
    queuePublish(session, item.id, "WHATNOT")
  ]);

  await drainQueuedJobs();

  const [publishedItem, listings, executionLogs] = await Promise.all([
    db.inventoryItem.findUnique({
      where: { id: item.id }
    }),
    db.platformListing.findMany({
      where: {
        inventoryItemId: item.id
      },
      orderBy: {
        platform: "asc"
      }
    }),
    db.executionLog.findMany({
      where: {
        id: {
          in: [poshmarkExecutionLog.id, whatnotExecutionLog.id]
        }
      }
    })
  ]);

  assert.ok(publishedItem);
  assert.equal(publishedItem.status, "LISTED");
  assert.equal(listings.length, 2);
  assert.deepEqual(
    listings.map((listing) => listing.platform).sort(),
    ["POSHMARK", "WHATNOT"]
  );
  assert.ok(listings.every((listing) => listing.status === "PUBLISHED"));
  assert.ok(listings.find((listing) => listing.platform === "POSHMARK")?.externalUrl?.includes("poshmark.com"));
  assert.ok(listings.find((listing) => listing.platform === "WHATNOT")?.externalUrl?.includes("whatnot.com"));
  assert.ok(executionLogs.every((log) => log.status === "SUCCEEDED"));
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
